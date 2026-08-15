"""AppTest UI smoke suite for app_streamlit.py.

These four tests are the regression baseline for the Streamlit app: every
one of them passes against the app as it exists today, and any later change
to app_streamlit.py / service.py / manifest.py must keep them green. See
docs/cma-lessons.md E entries for this repo's standing invariants (E6, in
particular, on Streamlit-specific gotchas this harness works around).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app_smoke_utils import boot_app, make_files, preview
from streamlit.testing.v1.app_test import AppTest
from streamlit.testing.v1.element_tree import Dataframe

from microscopy_naming_assistant.manifest import rollback_manifest, save_manifest


def _dataframe_with_columns(at: AppTest, required_columns: set[str]) -> Dataframe:
    """Find the one rendered `st.dataframe(...)` whose columns are a superset
    of `required_columns`, identifying it by CONTENT rather than by a
    hard-coded position in `at.dataframe` (there are several dataframes on
    this page and their order is an implementation detail)."""
    candidates = []
    for element in at.dataframe:
        columns = set(element.value.columns)
        candidates.append(columns)
        if required_columns <= columns:
            return element
    raise AssertionError(
        f"no dataframe found with columns >= {required_columns}; saw: {candidates}"
    )


@pytest.mark.smoke
def test_folder_preview_renders_one_row_per_file(tmp_path: Path, monkeypatch) -> None:
    """Previewing a folder of 3 files must produce exactly 3 suggestions,
    with no unhandled exception surfaced anywhere on the page."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif", "beta.tif", "gamma.tif"])

    at = boot_app(monkeypatch, tmp_path)
    preview(at, input_dir)

    assert len(at.exception) == 0
    assert len(at.session_state["suggestions"]) == 3


@pytest.mark.smoke
def test_apply_batch_plan_stays_1to1_with_real_files(tmp_path: Path, monkeypatch) -> None:
    """The single most safety-critical invariant in the app: the planned
    batch must stay strictly 1:1 with real files, both in the rendered
    "Planned Renames" table AND when actually applied.

    `apply_batch` does an unguarded `src.rename(dst)` loop, so a duplicated
    source would raise FileNotFoundError on the second iteration and skip
    save_manifest, leaving the first rename unrollbackable -- proving only
    the table (the surface) would miss that; this also clicks "Apply
    Renames" and checks the real filesystem (the mechanism) afterwards.
    """
    input_dir = tmp_path / "images"
    sources = make_files(input_dir, ["alpha.tif", "beta.tif", "gamma.tif"])

    at = boot_app(monkeypatch, tmp_path)
    preview(at, input_dir)
    assert len(at.exception) == 0

    planned_table = _dataframe_with_columns(at, {"source", "suggested"})
    rows = planned_table.value.to_dict("records")
    assert len(rows) == 3
    source_names = {row["source"] for row in rows}
    target_names = {row["suggested"] for row in rows}
    assert len(source_names) == 3, f"expected 3 distinct sources, got {source_names}"
    assert len(target_names) == 3, f"expected 3 distinct targets, got {target_names}"

    apply_button = next(b for b in at.button if b.label == "Apply Renames")
    apply_button.click()
    at.run()

    assert len(at.exception) == 0
    assert any("Successfully renamed 3 files" in s.value for s in at.success)

    # The mechanism, not just the surface: every original file is gone and
    # exactly 3 distinct, real files now exist under the new names.
    for src in sources:
        assert not src.exists(), f"{src.name} should have been renamed away"
    remaining = sorted(p.name for p in input_dir.glob("*.tif"))
    assert len(remaining) == 3
    assert len(set(remaining)) == 3

    manifests = list((input_dir / ".manifests").glob("rename_manifest_*.json"))
    assert len(manifests) == 1, "apply_batch must have written a rollback manifest"


@pytest.mark.smoke
def test_series_sidecar_offers_one_row_per_image(tmp_path: Path, monkeypatch) -> None:
    """A multi-image container's per-series sidecar must offer one row per
    image, and the download button for it must be present in the UI."""
    from microscopy_naming_assistant.config import load_config
    from microscopy_naming_assistant.service import build_series_rows

    input_dir = tmp_path / "images"
    make_files(input_dir, ["container.tif"])

    at = boot_app(monkeypatch, tmp_path)
    preview(at, input_dir)
    assert len(at.exception) == 0

    config = load_config(tmp_path / "naming_scheme.json")
    rows = build_series_rows(at.session_state["suggestions"], config)
    assert len(rows) == 2

    # Streamlit 1.37 (the project's supported floor) renders download
    # buttons as generic UnknownElements in AppTest and does not expose the
    # later `at.download_button` convenience accessor. `get` is stable at
    # both the floor and current versions and still proves the real widget
    # is present by its protocol element type and label.
    assert any(
        b.label == "Download per-series sidecar (CSV)" for b in at.get("download_button")
    )


@pytest.mark.smoke
def test_rollback_round_trips_renamed_files(tmp_path: Path) -> None:
    """save_manifest + rollback_manifest must round-trip: after renaming a
    batch of files and rolling the manifest back, the original names come
    back and the renamed names are gone."""
    names = ["a.tif", "b.tif", "c.tif"]
    sources = make_files(tmp_path, names)
    targets = [tmp_path / f"renamed_{name}" for name in names]

    manifest_path = save_manifest(tmp_path, list(zip(sources, targets)))
    assert manifest_path is not None

    for src, dst in zip(sources, targets):
        src.rename(dst)
    for dst in targets:
        assert dst.exists()
    for src in sources:
        assert not src.exists()

    reverted, errors = rollback_manifest(manifest_path, tmp_path)

    assert errors == []
    assert reverted == len(names)
    for src in sources:
        assert src.exists()
    for dst in targets:
        assert not dst.exists()
