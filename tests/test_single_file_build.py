from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "tools" / "build_single_file.py"

_spec = importlib.util.spec_from_file_location("build_single_file", BUILD_SCRIPT)
build_single_file = importlib.util.module_from_spec(_spec)
sys.modules["build_single_file"] = build_single_file
_spec.loader.exec_module(build_single_file)

BuildError = build_single_file.BuildError
build = build_single_file.build

MINIMAL_INDEX = """<!doctype html>
<html>
<head>
<!-- BUILD:STYLE -->
<link rel="stylesheet" href="./styles/app.css" />
<!-- /BUILD:STYLE -->
</head>
<body>
<div id="app"></div>
<!-- BUILD:KB -->
<!-- /BUILD:KB -->
<!-- BUILD:SCRIPT -->
<script type="module" src="./src/main.js"></script>
<!-- /BUILD:SCRIPT -->
</body>
</html>
"""


def _write_fixture(web_dir: Path, modules: dict[str, str], index_html: str = MINIMAL_INDEX) -> None:
    web_dir.mkdir(parents=True, exist_ok=True)
    (web_dir / "index.html").write_text(index_html, encoding="utf-8")
    src_dir = web_dir / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    for rel_path, content in modules.items():
        path = src_dir / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def test_topological_flattening_order(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "export const FOO = 1;\n",
            "b.js": "import { FOO } from './a.js';\nexport const BAR = FOO + 1;\n",
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert output.index("src/a.js") < output.index("src/b.js")
    assert "const FOO = 1;" in output
    assert "const BAR = FOO + 1;" in output
    assert "import" not in output.split("<!-- BUILD")[0]  # sanity: head is untouched


def test_topological_order_across_subdirectories(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "core/ids.js": "export function makeId() { return 'x'; }\n",
            "engine/naming.js": (
                "import { makeId } from '../core/ids.js';\n"
                "export function nameFor() { return makeId(); }\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert output.index("src/core/ids.js") < output.index("src/engine/naming.js")


def test_duplicate_exported_symbol_raises(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "export const FOO = 1;\n",
            "b.js": "export const FOO = 2;\n",
        },
    )
    with pytest.raises(BuildError, match="duplicate top-level symbol"):
        build(web_dir, tmp_path / "dist")


def test_duplicate_private_symbol_raises(tmp_path: Path) -> None:
    # Regression: the gate originally only inspected EXPORTED names. Two
    # modules each declaring the same PRIVATE (non-exported) top-level const
    # collide exactly as badly once concatenated into one IIFE, but used to
    # sail through this gate and produce an unparseable bundle.
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "const HELPER = 1;\nexport function useA() { return HELPER; }\n",
            "b.js": "const HELPER = 2;\nexport function useB() { return HELPER; }\n",
        },
    )
    with pytest.raises(BuildError, match="duplicate top-level symbol"):
        build(web_dir, tmp_path / "dist")


def test_private_name_reused_inside_different_functions_is_fine(tmp_path: Path) -> None:
    # The SAME local name in two different function bodies (or nested
    # blocks) must NOT trip the duplicate gate -- only true top-level
    # (depth-0) declarations collide once concatenated.
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "export function a() { const local = 1; return local; }\n",
            "b.js": "export function b() { const local = 2; return local; }\n",
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "function a()" in output
    assert "function b()" in output


def test_import_cycle_raises(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "import { BAR } from './b.js';\nexport const FOO = BAR;\n",
            "b.js": "import { FOO } from './a.js';\nexport const BAR = FOO;\n",
        },
    )
    with pytest.raises(BuildError, match="import cycle"):
        build(web_dir, tmp_path / "dist")


def test_top_level_await_raises(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "export const FOO = 1;\nawait Promise.resolve();\n",
        },
    )
    with pytest.raises(BuildError, match="top-level await"):
        build(web_dir, tmp_path / "dist")


def test_comment_mentioning_await_does_not_false_positive(tmp_path: Path) -> None:
    # Regression: a `//` comment merely containing the word "await" (e.g. a
    # doc comment explaining why a function ISN'T top-level await) must not
    # trip the top-level-await gate. AWAIT_RE must only see the code portion
    # of the line, never the comment portion.
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": (
                "// Bootstrap, not top-level await -- the inliner forbids it.\n"
                "export function init() {\n"
                "  return 1;\n"
                "}\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "function init()" in output


def test_comment_containing_a_brace_does_not_corrupt_scope_depth(tmp_path: Path) -> None:
    # Regression: a comment like `// if (x) { do it }` has an unbalanced-
    # looking brace pair that must not be counted -- otherwise it could
    # desync the function-open-depth tracker for the rest of the file.
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": (
                "export async function load() {\n"
                "  // comment with a brace: { not real code }\n"
                "  const value = await Promise.resolve(1);\n"
                "  return value;\n"
                "}\n"
                "export const AFTER = 1;\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "await Promise.resolve(1);" in output
    assert "const AFTER = 1;" in output


def test_block_comment_mentioning_await_does_not_false_positive(tmp_path: Path) -> None:
    # Regression: the // fix above left /* */ block comments (including
    # JSDoc) unhandled -- the exact same bug, one comment syntax over.
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": (
                "/**\n"
                " * Caller must await the returned promise.\n"
                " */\n"
                "export function f() {\n"
                "  return 1;\n"
                "}\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "function f()" in output


def test_single_line_block_comment_mentioning_await_does_not_false_positive(
    tmp_path: Path,
) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "/* not top-level await */ export const FOO = 1;\n",
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "const FOO = 1;" in output


def test_regex_literal_containing_double_slash_does_not_truncate_the_line(
    tmp_path: Path,
) -> None:
    # Regression: a regex literal like /\/\//g contains "//" from its own
    # escaped-slash tokens, which a naive line-comment scan mistakes for a
    # comment start, silently dropping everything after it on the line --
    # including a following brace, which would desync the scope tracker.
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": (
                "export function hasDoubleSlash(s) {\n"
                "  const re = /\\/\\//g;\n"
                "  return re.test(s);\n"
                "}\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "const re = /\\/\\//g;" in output
    assert "return re.test(s);" in output


def test_await_inside_async_function_is_allowed(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": (
                "export async function load() {\n"
                "  const value = await Promise.resolve(1);\n"
                "  return value;\n"
                "}\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "await Promise.resolve(1);" in output


def test_output_contains_no_module_script_or_dynamic_import(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": "export const FOO = 1;\n"})
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert 'type="module"' not in output
    assert "import(" not in output


def test_build_is_byte_identical_across_two_runs(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "core/ids.js": "export function makeId() { return 'x'; }\n",
            "engine/naming.js": (
                "import { makeId } from '../core/ids.js';\n"
                "export function nameFor() { return makeId(); }\n"
            ),
        },
    )
    first = build(web_dir, tmp_path / "dist1")
    second = build(web_dir, tmp_path / "dist2")
    assert first == second


def test_missing_marker_raises(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    broken_index = MINIMAL_INDEX.replace("<!-- BUILD:KB -->\n<!-- /BUILD:KB -->\n", "")
    _write_fixture(web_dir, {"a.js": "export const FOO = 1;\n"}, index_html=broken_index)
    with pytest.raises(BuildError, match="BUILD:KB"):
        build(web_dir, tmp_path / "dist")


def test_import_outside_scanned_src_raises(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": "import { X } from '../../outside.js';\n"})
    outside = web_dir.parent.parent / "outside.js"
    outside.write_text("export const X = 1;\n", encoding="utf-8")
    with pytest.raises(BuildError):
        build(web_dir, tmp_path / "dist")


def test_knowledge_pack_embeds_when_present(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": "export const FOO = 1;\n"})
    kb_dir = web_dir / "kb"
    kb_dir.mkdir()
    (kb_dir / "dyes.json").write_text(json.dumps({"z": 1, "a": 2}), encoding="utf-8")
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "__MICRONAUT_KB__" in output
    assert '"dyes"' in output
    # sort_keys means "a" (from within the dyes object) sorts before "z"
    assert output.index('"a":2') < output.index('"z":1')


def test_output_over_size_limit_raises(tmp_path: Path) -> None:
    web_dir = tmp_path / "web"
    huge_string = json.dumps("x" * (build_single_file.MAX_OUTPUT_BYTES + 1))
    huge_body = f"export const FOO = {huge_string};\n"
    _write_fixture(web_dir, {"a.js": huge_body})
    with pytest.raises(BuildError, match="exceeds the"):
        build(web_dir, tmp_path / "dist")


def test_real_web_index_html_has_all_three_marker_pairs() -> None:
    real_index = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    for marker in ("STYLE", "KB", "SCRIPT"):
        assert f"<!-- BUILD:{marker} -->" in real_index
        assert f"<!-- /BUILD:{marker} -->" in real_index


def test_real_web_build_succeeds() -> None:
    output = build(ROOT / "web", ROOT / "dist")
    assert len(output) > 0
    assert (ROOT / "dist" / "index.html").exists()


def test_script_imports_only_stdlib() -> None:
    text = BUILD_SCRIPT.read_text(encoding="utf-8")
    import_lines = [
        line
        for line in text.splitlines()
        if line.strip().startswith("import ") or line.strip().startswith("from ")
    ]
    stdlib_modules = {"argparse", "hashlib", "json", "re", "shutil", "sys", "pathlib", "__future__"}
    for line in import_lines:
        tokens = line.replace(",", " ").split()
        # tokens like: ['from', 'pathlib', 'import', 'Path'] or ['import', 'sys']
        module = tokens[1]
        assert module in stdlib_modules, f"non-stdlib import found: {line}"


def test_multiline_import_is_flattened(tmp_path: Path) -> None:
    """A wrapped named-import list must flatten like a single-line one.

    Regression: IMPORT_RE is anchored ^...$ against ONE line, so the
    Prettier-style wrapped form below never matched, passed through verbatim,
    and made the assembled classic script die at parse time with
    "Cannot use import statement outside a module" -- while every other build
    gate still reported success.
    """
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": "export const FOO = 1;\nexport const BAZ = 3;\n",
            "b.js": (
                "import {\n"
                "  FOO,\n"
                "  BAZ,\n"
                "} from './a.js';\n"
                "export const BAR = FOO + BAZ;\n"
            ),
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")

    assert "const BAR = FOO + BAZ;" in output
    # Dependency order must still be resolved from the folded import.
    assert output.index("src/a.js") < output.index("src/b.js")


def test_surviving_static_import_fails_the_build(tmp_path: Path) -> None:
    """The output gate must reject any static import that reaches the bundle.

    This is the backstop the multi-line bug slipped past: a bare-specifier
    import is never rewritten by the flattener (it resolves no local module),
    so if it is not rejected it ships in a bundle that cannot parse.
    """
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": "import x from 'left-pad';\nexport const FOO = 1;\n"})
    with pytest.raises(Exception) as excinfo:
        build(web_dir, tmp_path / "dist")
    assert "import" in str(excinfo.value).lower()


@pytest.mark.parametrize(
    "snippet",
    [
        "export function load() { return fetch('/x'); }\n",
        "export function load() { return new XMLHttpRequest(); }\n",
        "export function load() { return new WebSocket('wss://x'); }\n",
        "export function ping() { navigator.sendBeacon('/x', 'y'); }\n",
        "export function sub() { return new EventSource('/x'); }\n",
    ],
)
def test_network_primitive_in_source_fails_the_build(tmp_path: Path, snippet: str) -> None:
    """The no-network promise (README) is a build gate, not just a review
    habit: any of the five network primitives available to plain browser JS
    must fail the build if it survives into the bundled output."""
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": snippet})
    with pytest.raises(BuildError, match="forbidden"):
        build(web_dir, tmp_path / "dist")


def test_network_words_in_comments_do_not_false_positive(tmp_path: Path) -> None:
    """Prose mentioning these words (without an actual call) must not trip
    the gate -- it checks the assembled output verbatim, comments included,
    so the patterns require the callable form (a following "(") rather than
    a bare substring match. Mirrors this repo's real comments, e.g.
    core/persist.js's "no fetch, no server, no permission prompt"."""
    web_dir = tmp_path / "web"
    _write_fixture(
        web_dir,
        {
            "a.js": (
                "// Works under file:// (no fetch, no server, no permission "
                "prompt). Also: no XMLHttpRequests, WebSockets, sendBeacon "
                "or EventSource calls anywhere in this file.\n"
                "export const FOO = 1;\n"
            )
        },
    )
    output = build(web_dir, tmp_path / "dist").decode("utf-8")
    assert "const FOO = 1;" in output


def test_real_web_source_has_no_network_primitives() -> None:
    """The actual app must currently pass the new gate (not just the
    synthetic fixtures above)."""
    output = build(ROOT / "web", ROOT / "dist")
    assert len(output) > 0


def test_release_notes_folder_is_copied_into_dist(tmp_path: Path) -> None:
    """shell.js's Release notes nav link is a relative `release-notes/` URL,
    so dist/ must carry that folder itself -- otherwise the link 404s
    whenever dist/ is served (or opened via file://) without a separate,
    easy-to-forget copy step outside this script."""
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": "export const FOO = 1;\n"})
    release_notes_dir = web_dir / "release-notes"
    release_notes_dir.mkdir()
    (release_notes_dir / "index.html").write_text("<p>notes</p>", encoding="utf-8")
    (release_notes_dir / "CHANGELOG.md").write_text("## [1.0.0]\n", encoding="utf-8")

    out_dir = tmp_path / "dist"
    build(web_dir, out_dir)

    copied = out_dir / "release-notes"
    assert (copied / "index.html").read_text(encoding="utf-8") == "<p>notes</p>"
    assert (copied / "CHANGELOG.md").read_text(encoding="utf-8") == "## [1.0.0]\n"


def test_missing_release_notes_folder_does_not_fail_the_build(tmp_path: Path) -> None:
    """A web/ tree with no release-notes/ folder (as most of this test
    file's synthetic fixtures are) must build successfully and just skip the
    copy, not raise."""
    web_dir = tmp_path / "web"
    _write_fixture(web_dir, {"a.js": "export const FOO = 1;\n"})
    out_dir = tmp_path / "dist"
    build(web_dir, out_dir)
    assert not (out_dir / "release-notes").exists()


def test_real_web_release_notes_folder_is_copied_into_dist() -> None:
    """The actual app's dist/ output must carry the real release-notes/
    folder, not just a synthetic one."""
    build(ROOT / "web", ROOT / "dist")
    assert (ROOT / "dist" / "release-notes" / "index.html").exists()
