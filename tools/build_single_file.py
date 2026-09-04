#!/usr/bin/env python3
"""Flatten a web/ ES module tree into one self-contained HTML file.

Stdlib only, by design: this is the build step that makes the released
planner artifact runnable from file:// with no npm install and no server.
See docs/plans/planner-web.md (task C0-5) for the full rationale.

Algorithm: scan <web-dir>/src/**/*.js, parse single-line static relative
imports and named exports, topologically sort the modules by dependency,
strip import lines and the leading `export` keyword, then concatenate every
module body inside one IIFE. That script, the inlined stylesheet, and an
optional inlined knowledge-pack blob are substituted into <web-dir>/index.html
at BUILD:* marker comments.

Hard-fail build gates (each raises BuildError with a specific message):
  - two modules declaring the same top-level symbol name, exported or not
    (both share one scope once concatenated)
  - an import cycle
  - top-level `await` inside any module (the assembled IIFE cannot be async)
  - `type="module"` or a dynamic `import(` surviving into the assembled output
  - assembled output larger than 2 MB

Two consecutive runs over the same input produce byte-identical output: file
lists and dependency order are sorted, and the knowledge-pack JSON uses
sort_keys, so nothing in the pipeline is timestamp- or filesystem-order
dependent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

MAX_OUTPUT_BYTES = 2 * 1024 * 1024

IMPORT_RE = re.compile(r"^\s*import\s*\{\s*([^}]*?)\s*\}\s*from\s*['\"](\.[^'\"]+)['\"]\s*;?\s*$")
# A multi-line `import {\n  a,\n  b,\n} from '...'` -- what Prettier produces the
# moment a named-import list gets long enough to wrap. IMPORT_RE is anchored
# ^...$ against ONE line, so a wrapped import never matched it and passed
# through verbatim into the assembled classic script, where `import` is a
# SyntaxError that kills the whole bundle at parse time. These two let
# parse_module fold a wrapped import back into one logical line first.
IMPORT_START_RE = re.compile(r"^\s*import\s*\{")
IMPORT_END_RE = re.compile(r"\}\s*from\s*['\"](\.[^'\"]+)['\"]\s*;?\s*$")
EXPORT_DEFAULT_RE = re.compile(r"^\s*export\s+default\b")
EXPORT_LIST_RE = re.compile(r"^\s*export\s*\{\s*([^}]*?)\s*\}\s*;?\s*$")
EXPORT_DECL_RE = re.compile(
    r"^(\s*)export\s+(?=(?:async\s+)?(?:const|let|var|function\*?|class)\b)"
)
DECL_NAME_RE = re.compile(
    r"^\s*(?:async\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)"
    r"|^\s*(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)"
    r"|^\s*class\s+([A-Za-z_$][\w$]*)"
)
FUNCTION_OPEN_RE = re.compile(r"(\bfunction\b[^{;]*\{)|(=>\s*\{)")
AWAIT_RE = re.compile(r"\bawait\b")

FORBIDDEN_IN_OUTPUT = [
    (re.compile(r'type\s*=\s*["\']module["\']'), 'type="module"'),
    (re.compile(r"\bimport\s*\("), "a dynamic import()"),
    # A STATIC import surviving the flattening step. This gate exists because
    # its absence was not theoretical: a wrapped multi-line import slipped
    # through IMPORT_RE, and every other gate still passed, so the build
    # reported success while emitting a bundle that threw
    # "Cannot use import statement outside a module" before rendering a single
    # pixel. Anchored per-line so `// import ...` prose and ` * import` in doc
    # comments do not trip it.
    (
        re.compile(r"""(?m)^\s*import\s+[{*'"A-Za-z_$]"""),
        "a static import statement",
    ),
]


class BuildError(RuntimeError):
    """A hard-fail build gate was tripped."""


class Module:
    __slots__ = ("path", "declared", "body", "deps")

    def __init__(self, path: Path):
        self.path = path
        self.declared: list[str] = []
        self.body: list[str] = []
        self.deps: list[Path] = []


def _declared_name(line: str) -> str | None:
    m = DECL_NAME_RE.match(line)
    if not m:
        return None
    return next(g for g in m.groups() if g)


# A `/` opens a regex literal (rather than meaning division) when the
# previous significant character is one of these, or when it's the first
# thing on the line -- the same heuristic real lightweight JS tools use to
# tell `a / b` from `/regex/`.
_REGEX_PRECEDING_CHARS = set("=([{,;:!&|?~+-*%^<>")


def _strip_comments_for_scope_tracking(line: str, in_block_comment: bool) -> tuple[str, bool]:
    """Return (line with comments/regex-literal bodies blanked out, whether a
    block comment is still open after this line).

    Used ONLY to decide where the scope trackers below look for
    `await`/`{`/`}`/declarations -- the original line (comments, regex
    literals, and all) still reaches the build output unchanged. Handles `//`
    line comments, `/* ... */` block comments (including ones spanning into
    or out of this line), string/template literals, and regex literals well
    enough to avoid the false positives a naive scan would hit: a comment
    merely mentioning "await", a JSDoc block doing the same, a comment
    containing a stray brace, or a regex literal containing "//" (e.g.
    `/\\/\\//g`, which is NOT a line comment). Deliberately a heuristic, not a
    full JS lexer, matching this module's documented scope.
    """
    out: list[str] = []
    quote: str | None = None  # one of "'", '"', "`", "regex", or None
    i = 0
    n = len(line)
    prev_significant = ""
    while i < n:
        if in_block_comment:
            end = line.find("*/", i)
            if end == -1:
                return "".join(out), True
            i = end + 2
            in_block_comment = False
            continue
        ch = line[i]
        if quote == "regex":
            if ch == "\\":
                i += 2
                continue
            if ch == "[":
                # a character class: '/' doesn't end the regex inside [...]
                j = i + 1
                while j < n and line[j] != "]":
                    j += 2 if line[j] == "\\" else 1
                i = j + 1
                continue
            if ch == "/":
                quote = None
            i += 1
            continue
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            continue
        if ch == "/" and i + 1 < n and line[i + 1] == "/":
            break  # rest of the line is a line comment
        if ch == "/" and i + 1 < n and line[i + 1] == "*":
            in_block_comment = True
            i += 2
            continue
        if ch == "/" and (prev_significant == "" or prev_significant in _REGEX_PRECEDING_CHARS):
            quote = "regex"
            i += 1
            continue
        out.append(ch)
        if not ch.isspace():
            prev_significant = ch
        i += 1
    return "".join(out), in_block_comment


def _check_no_top_level_await(path: Path, body_lines: list[str]) -> None:
    """Heuristic scope tracker: forbid `await` that isn't inside a function.

    Only tracks whether a line *opens* a function-like body on the same line
    (the codebase's style throughout); good enough to catch the real mistake
    (a stray top-level await) without needing a full JS parser. Comments,
    strings, and regex literals are blanked out first (see
    _strip_comments_for_scope_tracking) so none of them can corrupt the scope
    depth or trip a false positive.
    """
    depth = 0
    func_open_depths: list[int] = []
    in_block_comment = False
    for raw_line in body_lines:
        line, in_block_comment = _strip_comments_for_scope_tracking(raw_line, in_block_comment)
        if AWAIT_RE.search(line) and not func_open_depths:
            raise BuildError(
                f"{path}: top-level await is not allowed (the build's IIFE "
                "cannot be async) - wrap it in an async function"
            )
        opens_function = bool(FUNCTION_OPEN_RE.search(line))
        opens = line.count("{")
        closes = line.count("}")
        if opens_function and opens:
            func_open_depths.append(depth + 1)
        depth += opens - closes
        while func_open_depths and depth < func_open_depths[-1]:
            func_open_depths.pop()


def _collect_top_level_declared_names(body_lines: list[str]) -> list[str]:
    """All top-level const/let/var/function/class names in `body_lines`
    (which has already had any leading `export` keyword stripped) -- exported
    or private, since both share the very same scope once every module is
    concatenated into one IIFE. A private name colliding with another
    module's name breaks the assembled script exactly as badly as two
    exported names colliding does.
    """
    names: list[str] = []
    depth = 0
    in_block_comment = False
    for raw_line in body_lines:
        line, in_block_comment = _strip_comments_for_scope_tracking(raw_line, in_block_comment)
        if depth == 0:
            name = _declared_name(line)
            if name:
                names.append(name)
        depth += line.count("{") - line.count("}")
    return names


def _join_multiline_imports(path: Path, lines: list[str]) -> list[str]:
    """Fold each wrapped `import { ... } from '...'` back onto one logical line.

    Only import statements are touched; every other line is passed through
    unchanged, so this cannot perturb module bodies.
    """
    out: list[str] = []
    pending: list[str] | None = None
    for line in lines:
        if pending is None:
            # A single-line import already ends with its `from '...'` clause and
            # needs no folding -- leave it for IMPORT_RE to match directly.
            if IMPORT_START_RE.match(line) and not IMPORT_END_RE.search(line):
                pending = [line.rstrip()]
            else:
                out.append(line)
            continue

        pending.append(line.strip())
        if IMPORT_END_RE.search(line):
            out.append(" ".join(pending))
            pending = None

    if pending is not None:
        raise BuildError(f"{path}: unterminated multi-line import statement")
    return out


def parse_module(path: Path) -> Module:
    mod = Module(path)
    text = path.read_text(encoding="utf-8")
    for line in _join_multiline_imports(path, text.splitlines()):
        m_import = IMPORT_RE.match(line)
        if m_import:
            spec = m_import.group(2)
            dep = (path.parent / spec).resolve()
            if not dep.exists():
                raise BuildError(f"{path}: cannot resolve import '{spec}' -> {dep}")
            mod.deps.append(dep)
            continue

        if EXPORT_DEFAULT_RE.match(line):
            raise BuildError(f"{path}: default exports are not supported")

        m_export_list = EXPORT_LIST_RE.match(line)
        if m_export_list:
            continue  # a re-export list; the names are declared elsewhere in this file

        m_decl = EXPORT_DECL_RE.match(line)
        if m_decl:
            mod.body.append(EXPORT_DECL_RE.sub(r"\1", line))
            continue

        mod.body.append(line)

    _check_no_top_level_await(path, mod.body)
    mod.declared = _collect_top_level_declared_names(mod.body)
    return mod


def _check_deps_in_scope(modules: dict[Path, Module]) -> None:
    for path, mod in modules.items():
        for dep in mod.deps:
            if dep not in modules:
                raise BuildError(
                    f"{path}: import target {dep} is outside the scanned web/src module set"
                )


def _check_duplicate_declarations(modules: dict[Path, Module]) -> None:
    owners: dict[str, list[Path]] = {}
    for path, mod in modules.items():
        for name in mod.declared:
            owners.setdefault(name, []).append(path)
    duplicates = {name: paths for name, paths in owners.items() if len(paths) > 1}
    if duplicates:
        lines = [
            f"  '{name}' declared by: {', '.join(str(p) for p in paths)}"
            for name, paths in sorted(duplicates.items())
        ]
        raise BuildError(
            "duplicate top-level symbol name(s) across web/src (exported or "
            "private -- both share one scope once concatenated):\n" + "\n".join(lines)
        )


def _topo_sort(modules: dict[Path, Module]) -> list[Path]:
    """Return modules in dependency-first order; raise on an import cycle."""
    order: list[Path] = []
    visited: set[Path] = set()
    on_stack: list[Path] = []
    on_stack_set: set[Path] = set()

    def visit(node: Path) -> None:
        if node in visited:
            return
        if node in on_stack_set:
            cycle = on_stack[on_stack.index(node) :] + [node]
            chain = " -> ".join(str(p) for p in cycle)
            raise BuildError(f"import cycle detected: {chain}")
        on_stack.append(node)
        on_stack_set.add(node)
        for dep in sorted(modules[node].deps):
            visit(dep)
        on_stack.pop()
        on_stack_set.remove(node)
        visited.add(node)
        order.append(node)

    for node in sorted(modules):
        visit(node)
    return order


def flatten_modules(src_dir: Path) -> str:
    src_dir = src_dir.resolve()
    js_files = sorted(p.resolve() for p in src_dir.rglob("*.js"))
    if not js_files:
        raise BuildError(f"no .js modules found under {src_dir}")

    modules = {f: parse_module(f) for f in js_files}
    _check_deps_in_scope(modules)
    _check_duplicate_declarations(modules)
    order = _topo_sort(modules)

    parts = ["(function () {", "'use strict';"]
    for path in order:
        mod = modules[path]
        rel = path.relative_to(src_dir).as_posix()
        parts.append(f"  // ---- src/{rel} ----")
        parts.extend(mod.body)
    parts.append("})();")
    return "\n".join(parts)


def _load_css(web_dir: Path) -> str:
    css_path = web_dir / "styles" / "app.css"
    if not css_path.exists():
        return ""
    return css_path.read_text(encoding="utf-8")


def _load_kb(web_dir: Path) -> dict:
    kb_dir = web_dir / "kb"
    if not kb_dir.exists():
        return {}
    kb: dict = {}
    for f in sorted(kb_dir.rglob("*.json")):
        key = f.relative_to(kb_dir).as_posix()[: -len(".json")]
        kb[key] = json.loads(f.read_text(encoding="utf-8"))
    return kb


def _replace_marker(html: str, marker: str, replacement: str) -> str:
    pattern = re.compile(
        r"<!--\s*BUILD:" + marker + r"\s*-->.*?<!--\s*/BUILD:" + marker + r"\s*-->",
        re.DOTALL,
    )
    if not pattern.search(html):
        raise BuildError(f"index.html is missing the BUILD:{marker} marker pair")
    # A function replacement is used (rather than a plain string) so that any
    # backslashes in the replacement (regex source in JS, etc.) are inserted
    # verbatim instead of being interpreted as re.sub backreferences.
    return pattern.sub(lambda _m: replacement, html, count=1)


def _replace_marker_if_present(html: str, marker: str, replacement: str) -> str:
    """Like `_replace_marker`, but a no-op (instead of a BuildError) when the
    marker pair is absent -- used for BUILD:VERSION, which is optional so
    that the test fixtures in tests/test_single_file_build.py (built from a
    minimal index.html with no VERSION marker) don't all need updating.
    """
    pattern = re.compile(
        r"<!--\s*BUILD:" + marker + r"\s*-->.*?<!--\s*/BUILD:" + marker + r"\s*-->",
        re.DOTALL,
    )
    if not pattern.search(html):
        return html
    return pattern.sub(lambda _m: replacement, html, count=1)


def _get_git_version(web_dir: Path) -> str | None:
    """Best-effort short git commit SHA for the checkout containing `web_dir`,
    or None if git isn't installed or web_dir isn't inside a git repo (e.g.
    a bare tmp_path in the pytest fixtures). Never raises: an unrecoverable
    version is surfaced honestly as no version tag at all (see
    web/src/ui/steps/settings.js), never a fabricated placeholder.
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(web_dir), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    version = result.stdout.strip()
    return version or None


def build(web_dir: Path, out_dir: Path, version: str | None = None) -> bytes:
    web_dir = web_dir.resolve()
    out_dir = out_dir.resolve()
    index_path = web_dir / "index.html"
    if not index_path.exists():
        raise BuildError(f"{index_path} does not exist")
    src_dir = web_dir / "src"

    script_body = flatten_modules(src_dir)
    css_body = _load_css(web_dir)
    kb = _load_kb(web_dir)
    kb_json = json.dumps(kb, sort_keys=True, separators=(",", ":"))
    resolved_version = version if version is not None else _get_git_version(web_dir)

    html = index_path.read_text(encoding="utf-8")
    html = _replace_marker(html, "STYLE", f"<style>\n{css_body}\n</style>")
    html = _replace_marker(
        html, "KB", f"<script>\nglobalThis.__MICRONAUT_KB__ = {kb_json};\n</script>"
    )
    html = _replace_marker(html, "SCRIPT", f"<script>\n{script_body}\n</script>")
    if resolved_version:
        html = _replace_marker_if_present(
            html,
            "VERSION",
            f"<script>\nglobalThis.__MICRONAUT_VERSION__ = {json.dumps(resolved_version)};\n</script>",
        )

    for pattern, label in FORBIDDEN_IN_OUTPUT:
        if pattern.search(html):
            raise BuildError(f"forbidden {label} survived into the built output")

    output_bytes = html.encode("utf-8")
    if len(output_bytes) > MAX_OUTPUT_BYTES:
        raise BuildError(
            f"built output is {len(output_bytes)} bytes, "
            f"exceeds the {MAX_OUTPUT_BYTES}-byte limit"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.html"
    out_path.write_bytes(output_bytes)
    digest = hashlib.sha256(output_bytes).hexdigest()
    print(f"wrote {out_path} ({len(output_bytes)} bytes, sha256={digest})")
    return output_bytes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--web-dir", type=Path, default=Path("web"), help="root containing src/ and index.html"
    )
    parser.add_argument("--out", type=Path, default=Path("dist"), help="output directory")
    parser.add_argument(
        "--version",
        type=str,
        default=None,
        help="version tag embedded as globalThis.__MICRONAUT_VERSION__ "
        "(defaults to the checkout's short git commit SHA, or no tag if git is unavailable)",
    )
    args = parser.parse_args(argv)
    try:
        build(args.web_dir, args.out, version=args.version)
    except BuildError as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
