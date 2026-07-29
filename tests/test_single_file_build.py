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
    with pytest.raises(BuildError, match="duplicate exported symbol"):
        build(web_dir, tmp_path / "dist")


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
    stdlib_modules = {"argparse", "hashlib", "json", "re", "sys", "pathlib", "__future__"}
    for line in import_lines:
        tokens = line.replace(",", " ").split()
        # tokens like: ['from', 'pathlib', 'import', 'Path'] or ['import', 'sys']
        module = tokens[1]
        assert module in stdlib_modules, f"non-stdlib import found: {line}"
