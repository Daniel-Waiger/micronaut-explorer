from __future__ import annotations

from datetime import datetime
from pathlib import Path

from microscopy_naming_assistant.metadata import extract_metadata


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
