"""AppTest smoke coverage for T11 (B-3 + B-4): the four-tier, token-first
metadata picker that replaced the flat ~95-row "Harvested metadata keys"
dataframe in the "Metadata read from files" expander.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from app_smoke_utils import boot_app, make_files, preview
from streamlit.testing.v1.app_test import AppTest

from microscopy_naming_assistant.metadata import ExtractionDetail
from microscopy_naming_assistant.profiles import default_profile, save_profile

# Same synthetic fixture as T9's tests/test_key_ranking.py::_fixture_images --
# two objectives (40x/63x), a shared-then-varying dye panel, long-float probes
# (Begin/StagePosX) that must NEVER become suggested tokens, and a block of
# instrument constants that never vary across series.
_CONSTANT = {
    "BitSize": "8",
    "Immersion": "DRY",
    "SystemSerialNumber": "8300000294",
    "ScanMode": "xyz",
    "MicroscopeModel": "DMI8-CS",
    "ChannelCount": "3",
    "CanDoSTED": "0",
    "FlipX": "1",
    "FlipY": "1",
    "IsInverseMicroscopeModel": "1",
}

FIXTURE_IMAGES = [
    {
        **_CONSTANT,
        "Magnification": "40",
        "ObjectiveName": "HC PL APO 40x/0.95 DRY",
        "Dyes": "Leica/ALEXA 488;Leica/DAPI",
        "SeriesName": "overview_x40",
        "Zoom": "1.0",
        "Sections": "120",
        "NumericalAperture": "0.95",
        "InDimension": "512",
        "Begin": "1.26582981665594E-04",
        "StagePosX": "0.05173623815947",
        "Channel": "1",
    },
    {
        **_CONSTANT,
        "Magnification": "40",
        "ObjectiveName": "HC PL APO 40x/0.95 DRY",
        "Dyes": "Leica/ALEXA 488;Leica/DAPI",
        "SeriesName": "overview_x40_merged",
        "Zoom": "1.0",
        "Sections": "120",
        "NumericalAperture": "0.95",
        "InDimension": "512",
        "Begin": "2.5E-04",
        "StagePosX": "0.06",
        "Channel": "1",
    },
    {
        **_CONSTANT,
        "Magnification": "63",
        "ObjectiveName": "HC PL APO CS2 63x/1.40 OIL",
        "Dyes": "Leica/ALEXA 488;Leica/DAPI;Leica/Cy3",
        "SeriesName": "closeup_x63",
        "Zoom": "1.1",
        "Sections": "90",
        "NumericalAperture": "1.40",
        "InDimension": "1024",
        "Begin": "3.7E-04",
        "StagePosX": "0.09",
        "Channel": "2",
    },
    {
        **_CONSTANT,
        "Magnification": "63",
        "ObjectiveName": "HC PL APO CS2 63x/1.40 OIL",
        "Dyes": "Leica/ALEXA 488;Leica/DAPI;Leica/Cy3",
        "SeriesName": "closeup_x63_zoom",
        "Zoom": "1.3",
        "Sections": "85",
        "NumericalAperture": "1.40",
        "InDimension": "1024",
        "Begin": "4.9E-04",
        "StagePosX": "0.11",
        "Channel": "2",
    },
]

_ALL_FIXTURE_KEYS = {k for image in FIXTURE_IMAGES for k in image}


def _stub_extraction(
    file_path: Path,
    timeout_seconds: int = 20,
    extraction_mask: str | None = None,
    field_key_map: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict[str, str], ExtractionDetail]:
    """`alpha.tif` carries the full T9 ranking fixture (including
    "ObjectiveName", never offered anywhere else). `beta.tif` carries a
    deliberately disjoint, smaller key set -- this asymmetry is what test
    (d) below needs to prove a mapping saved while viewing alpha survives a
    save made later while viewing beta."""
    fields = {
        "date": "2024-01-01",
        "exptype": "CT",
        "sample": "E01",
        "magnification": "X40",
        "markers": "DAPI-GFP",
        "notes": "STUB",
    }
    sources = {key: "metadata" for key in fields}

    if file_path.stem == "alpha":
        image_key_paths = [dict(image) for image in FIXTURE_IMAGES]
        key_paths = dict(FIXTURE_IMAGES[0])
    else:
        image_key_paths = [{"Foo": "Bar", "Zoom": "2.0"}]
        key_paths = dict(image_key_paths[0])

    detail = ExtractionDetail(
        metadata_text=f"[stub metadata for {file_path.name}]",
        reader="stub-reader",
        key_paths=key_paths,
        image_key_paths=image_key_paths,
    )
    return dict(fields), dict(sources), detail


def _select_metadata_file(at: AppTest, filename: str) -> AppTest:
    at.selectbox(key="metadata_viewer_file").set_value(filename)
    return at.run()


@pytest.mark.smoke
def test_suggested_tier_stays_small_and_excludes_floats_and_constants(
    tmp_path: Path, monkeypatch
) -> None:
    """(a) The Suggested tier is capped small (<=10) and contains none of the
    long-float probes or the instrument constants -- the exact ~95-keys-to-8
    ratio T11 exists to enforce, not just "a table renders"."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])

    at = boot_app(monkeypatch, tmp_path, extraction=_stub_extraction)
    preview(at, input_dir)
    assert len(at.exception) == 0

    suggested_expander = next(e for e in at.expander if str(e.label).startswith("Suggested ("))
    suggested_count = int(str(suggested_expander.label).split("(")[1].rstrip(")"))
    assert suggested_count <= 10

    suggested_text = " ".join(w.value for w in suggested_expander.markdown)
    for excluded in ("Begin", "StagePosX", *_CONSTANT):
        assert excluded not in suggested_text, f"{excluded} leaked into the suggested tier"


@pytest.mark.smoke
def test_suggested_rows_read_token_first(tmp_path: Path, monkeypatch) -> None:
    """(b) A suggested row shows the rendered TOKEN ('X40'), not just the raw
    prose value ('HC PL APO 40x/0.95 DRY') -- the whole point of "the user
    picks the token that lands in the filename"."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])

    at = boot_app(monkeypatch, tmp_path, extraction=_stub_extraction)
    preview(at, input_dir)
    assert len(at.exception) == 0

    suggested_expander = next(e for e in at.expander if str(e.label).startswith("Suggested ("))
    suggested_text = " ".join(w.value for w in suggested_expander.markdown)
    assert "X40" in suggested_text


@pytest.mark.smoke
def test_every_fixture_key_is_reachable_somewhere_in_the_four_tiers(
    tmp_path: Path, monkeypatch
) -> None:
    """(c) Nothing is silently dropped: every key harvested across the fixture
    must show up somewhere across the four tiers (checked via the
    "Everything" tier, which by construction always holds the full set)."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])

    at = boot_app(monkeypatch, tmp_path, extraction=_stub_extraction)
    preview(at, input_dir)
    assert len(at.exception) == 0

    everything_expander = next(e for e in at.expander if str(e.label).startswith("Everything ("))
    everything_text = " ".join(w.value for w in everything_expander.markdown)
    missing = [key for key in _ALL_FIXTURE_KEYS if key not in everything_text]
    assert not missing, f"keys missing from the 'Everything' tier: {missing}"


@pytest.mark.smoke
def test_field_key_mapping_for_file_a_survives_a_later_save_while_viewing_file_b(
    tmp_path: Path, monkeypatch
) -> None:
    """(d) E6 REGRESSION GUARD: a mapping chosen while viewing file A (keyed
    to "ObjectiveName", a key only alpha.tif offers) must still be present in
    the saved profile after saving again while viewing file B (beta.tif),
    whose key_paths do NOT contain "ObjectiveName" -- the merge-not-replace
    bug from a prior run must not resurface."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif", "beta.tif"])
    # profile_path must exist BEFORE boot: the sidebar's "Profile path
    # (optional)" input silently resets to None for any path that doesn't
    # already exist on disk (app_streamlit.py), so the profile is created
    # directly via profiles.py rather than through an in-app wizard.
    profile_path = tmp_path / "profile.json"
    save_profile(profile_path, default_profile())

    at = boot_app(monkeypatch, tmp_path, extraction=_stub_extraction)
    profile_field = next(t for t in at.sidebar.text_input if t.label == "Profile path (optional)")
    profile_field.set_value(str(profile_path))
    at = at.run()
    assert len(at.exception) == 0

    preview(at, input_dir)
    assert len(at.exception) == 0

    at = _select_metadata_file(at, "alpha.tif")
    at.selectbox(key="fieldmap_magnification").set_value("ObjectiveName")
    at = at.run()
    save_button = next(b for b in at.button if b.label == "Save mapping to profile")
    save_button.click()
    at = at.run()
    assert len(at.exception) == 0

    saved = json.loads(profile_path.read_text(encoding="utf-8"))
    assert saved["field_key_map"]["magnification"] == "ObjectiveName"

    at = _select_metadata_file(at, "beta.tif")
    assert "ObjectiveName" not in at.selectbox(key="fieldmap_magnification").options
    save_button = next(b for b in at.button if b.label == "Save mapping to profile")
    save_button.click()
    at = at.run()
    assert len(at.exception) == 0

    saved_again = json.loads(profile_path.read_text(encoding="utf-8"))
    assert saved_again["field_key_map"]["magnification"] == "ObjectiveName", (
        "file A's mapping must survive a save made while viewing file B, whose "
        "key options don't include it"
    )
