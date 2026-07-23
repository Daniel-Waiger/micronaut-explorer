from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from microscopy_naming_assistant.metadata import _extract_markers, extract_metadata


def test_extract_markers_word_boundary_avoids_false_positive() -> None:
    result = _extract_markers("this is SCFPX region", [])
    assert result is None or "CFP" not in result.split("-")


def test_extract_markers_normalizes_alias_to_canonical() -> None:
    result = _extract_markers("stained with Alexa Fluor 488 and DAPI", [])
    assert result is not None
    markers = result.split("-")
    assert "ALEXA488" in markers
    assert "DAPI" in markers


def test_extract_markers_matches_real_token() -> None:
    result = _extract_markers("channel: GFP", [])
    assert result is not None
    assert "GFP" in result.split("-")


def test_extract_markers_orders_by_first_match_position() -> None:
    assert _extract_markers("DAPI then GFP", []) == "DAPI-GFP"


@pytest.mark.integration
def test_extract_metadata_fallback_includes_date_and_sample_guess(tmp_path: Path) -> None:
    file_path = tmp_path / "run_E3_trial.tif"
    file_path.write_bytes(b"dummy")

    dt = datetime(2025, 1, 2, 3, 4, 5)
    ts = dt.timestamp()
    file_path.touch()
    import os

    os.utime(file_path, (ts, ts))

    metadata = extract_metadata(file_path)

    assert metadata["date"] == "2025-01-02"
    assert metadata["sample"] == "E03"
