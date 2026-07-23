from __future__ import annotations

import time
from pathlib import Path

from microscopy_naming_assistant.metadata import extract_metadata


def test_extract_metadata_bounds_bioio_with_timeout(tmp_path: Path) -> None:
    """A file bioio cannot parse must not hang the caller past `timeout_seconds`.

    Uses a real, unreadable dummy `.tif` rather than monkeypatching
    `_extract_bioio_fields`: the worker runs in a `multiprocessing.get_context
    ("spawn")` child, which re-imports the module fresh, so a monkeypatch
    applied here in the parent process would be invisible to it. Calling with
    a genuinely unparsable file lets bioio actually hang in the child and get
    terminated by the timeout - the true end-to-end proof of the P0-3 fix.
    """
    file_path = tmp_path / "2025-01-02_E03_x.tif"
    file_path.write_bytes(b"not a real tiff file")

    start = time.time()
    metadata = extract_metadata(file_path, timeout_seconds=3)
    elapsed = time.time() - start

    # Bound is generous (not a tight ~6-10s window) because the timeout branch
    # itself now escalates terminate() -> join(5) -> kill() -> join(5) on top
    # of the initial timeout_seconds=3 wait, so the worst case is materially
    # more than 3s; 20s stays comfortably under the 60s pytest-timeout safety
    # net while still proving the call is bounded, not hung.
    assert elapsed < 20, f"extract_metadata took {elapsed:.1f}s; expected well under 20s (timeout-bounded)"
    assert metadata["date"] == "2025-01-02"
    assert metadata["sample"] == "E03"
