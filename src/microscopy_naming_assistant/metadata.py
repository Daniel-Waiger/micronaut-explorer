from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re


FORMAT_FIELD_HINTS: dict[str, dict[str, list[str]]] = {
    "OME-TIFF": {
        "markers": ["Channel", "Fluor", "DyeName", "EmissionWavelength"],
        "magnification": ["NominalMagnification", "Objective", "Magnification"],
        "sample": ["Image Name", "Sample", "Specimen"],
        "exptype": ["Experiment", "Protocol", "Group"],
    },
    "CZI": {
        "markers": ["Fluor", "Dye", "ChannelName"],
        "magnification": ["NominalMagnification", "Objective", "Zoom"],
        "sample": ["Sample", "StageLabel", "Name"],
        "exptype": ["Experiment", "AcquisitionMode", "Project"],
    },
    "LIF": {
        "markers": ["ChannelDescription", "DyeName", "Fluor"],
        "magnification": ["Objective", "Magnification", "Zoom"],
        "sample": ["Series Name", "Sample", "Name"],
        "exptype": ["Experiment", "Protocol", "Condition"],
    },
    "ND2": {
        "markers": ["Channel", "Emission", "Fluor"],
        "magnification": ["Objective", "Magnification", "Zoom"],
        "sample": ["Sample", "Field", "Position"],
        "exptype": ["Experiment", "Description", "Group"],
    },
}

KNOWN_MARKERS = [
    "ARL",
    "GFP",
    "DAPI",
    "SOX",
    "SOX2",
    "RFP",
    "CFP",
    "YFP",
    "HOECHST",
]


def _guess_sample_from_name(stem: str) -> str | None:
    parts = stem.replace("-", "_").split("_")
    for token in parts:
        up = token.upper()
        if up.startswith("E") and up[1:].isdigit():
            return f"E{int(up[1:]):02d}"
    return None


def _detect_format(file_path: Path) -> str:
    name = file_path.name.lower()
    if name.endswith(".ome.tif") or name.endswith(".ome.tiff"):
        return "OME-TIFF"
    ext = file_path.suffix.lower()
    if ext == ".czi":
        return "CZI"
    if ext == ".lif":
        return "LIF"
    if ext == ".nd2":
        return "ND2"
    return "GENERIC"


def _extract_text_chunks(metadata_obj: object) -> str:
    text = str(metadata_obj)
    return " ".join(text.split())


def _extract_near_key(text: str, key: str) -> str | None:
    pattern = re.compile(rf"{re.escape(key)}[^A-Za-z0-9]{{0,8}}([A-Za-z0-9_. -]{{2,40}})", re.IGNORECASE)
    match = pattern.search(text)
    if not match:
        return None
    value = match.group(1).strip()
    value = re.split(r"[<>{}\[\]();]", value)[0].strip()
    return value or None


def _extract_markers(text: str, hints: list[str]) -> str | None:
    found: list[str] = []
    upper_text = text.upper()

    for marker in KNOWN_MARKERS:
        if marker in upper_text and marker not in found:
            found.append(marker)

    for key in hints:
        near = _extract_near_key(text, key)
        if not near:
            continue
        for token in re.split(r"[-_,;/| ]+", near.upper()):
            token = token.strip()
            if token in KNOWN_MARKERS and token not in found:
                found.append(token)

    if not found:
        return None
    return "-".join(found)


def _extract_magnification(text: str, hints: list[str]) -> str | None:
    for key in hints:
        near = _extract_near_key(text, key)
        if not near:
            continue
        match = re.search(r"(\d{1,3}(?:\.\d+)?)", near)
        if match:
            value = int(float(match.group(1)))
            return f"X{value}"

    fallback = re.search(r"(?:MAGNIFICATION|OBJECTIVE|ZOOM)[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)", text, re.IGNORECASE)
    if fallback:
        value = int(float(fallback.group(1)))
        return f"X{value}"
    return None


def _extract_exptype(text: str, hints: list[str]) -> str | None:
    if re.search(r"\bCT\b", text, re.IGNORECASE):
        return "CT"

    group_match = re.search(r"\bG\d(?:G\d)+\b", text, re.IGNORECASE)
    if group_match:
        return group_match.group(0).upper()

    for key in hints:
        near = _extract_near_key(text, key)
        if near:
            token = near.upper().replace(" ", "")
            if token.startswith("G") and any(ch.isdigit() for ch in token):
                return token
    return None


def _extract_sample(text: str, hints: list[str]) -> str | None:
    sample_match = re.search(r"\bE\d{1,3}\b", text, re.IGNORECASE)
    if sample_match:
        return f"E{int(sample_match.group(0)[1:]):02d}"

    for key in hints:
        near = _extract_near_key(text, key)
        if near:
            candidate = re.search(r"E\d{1,3}", near, re.IGNORECASE)
            if candidate:
                return f"E{int(candidate.group(0)[1:]):02d}"
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

    file_format = _detect_format(file_path)

    try:
        from bioio import BioImage  # type: ignore

        image = BioImage(str(file_path))
        md = getattr(image, "metadata", None)

        if md is not None:
            text = _extract_text_chunks(md)

            hints = FORMAT_FIELD_HINTS.get(file_format, FORMAT_FIELD_HINTS.get("OME-TIFF", {}))

            markers = _extract_markers(text, hints.get("markers", []))
            if markers:
                result["markers"] = markers

            magnification = _extract_magnification(text, hints.get("magnification", []))
            if magnification:
                result["magnification"] = magnification

            exptype = _extract_exptype(text, hints.get("exptype", []))
            if exptype:
                result["exptype"] = exptype

            sample = _extract_sample(text, hints.get("sample", []))
            if sample:
                result["sample"] = sample

        channel_names = getattr(image, "channel_names", None)
        if channel_names:
            marker_tokens = [str(c).strip().upper() for c in channel_names if str(c).strip()]
            marker_tokens = [m for m in marker_tokens if m]
            if marker_tokens:
                result["markers"] = "-".join(dict.fromkeys(marker_tokens))
    except Exception:
        # Keep graceful fallback behavior for unsupported formats/environments.
        pass

    return result
