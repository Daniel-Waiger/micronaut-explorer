from __future__ import annotations

from datetime import datetime
from pathlib import Path


def _guess_sample_from_name(stem: str) -> str | None:
    parts = stem.replace("-", "_").split("_")
    for token in parts:
        up = token.upper()
        if up.startswith("E") and up[1:].isdigit():
            return f"E{int(up[1:]):02d}"
    return None


def extract_metadata(file_path: Path) -> dict[str, str]:
    """Extract naming-relevant metadata using bioio when available.

    Falls back to file timestamps and filename heuristics if scientific readers
    are unavailable or cannot read the file.
    """
    result: dict[str, str] = {}

    # Always derive date from file mtime as a reliable baseline.
    mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
    result["date"] = mtime.strftime("%Y-%m-%d")

    sample_guess = _guess_sample_from_name(file_path.stem)
    if sample_guess:
        result["sample"] = sample_guess

    try:
        from bioio import BioImage  # type: ignore

        image = BioImage(str(file_path))
        md = getattr(image, "metadata", None)

        if md is not None:
            text = str(md)
            # Minimal heuristics to populate known fields from metadata text.
            if "DAPI" in text.upper():
                result["markers"] = "DAPI"
    except Exception:
        # Keep graceful fallback behavior for unsupported formats/environments.
        pass

    return result
