from __future__ import annotations

from datetime import datetime
import logging
import multiprocessing
from pathlib import Path
import queue
import re

from .markers import alias_map

logger = logging.getLogger(__name__)

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


def _guess_sample_from_name(stem: str) -> str | None:
    parts = stem.replace("-", "_").split("_")
    for token in parts:
        up = token.upper()
        if up.startswith("E") and up[1:].isdigit():
            return f"E{int(up[1:]):02d}"
    return None


def _extract_date_from_name(stem: str) -> str | None:
    # Look for YYYY-MM-DD or YYYY_MM_DD
    match = re.search(r"((?:19|20)\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])", stem)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    
    # Look for YYYYMMDD
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)", stem)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        
    # Look for YYMMDD (assuming 20YY)
    match = re.search(r"(?<!\d)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)", stem)
    if match:
        return f"20{match.group(1)}-{match.group(2)}-{match.group(3)}"
        
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
    """Find canonical marker/fluorophore names in `text`.

    Every known alias (see `markers.alias_map`) is searched for as a whole
    word, case-insensitively, directly in `text` -- so "CFP" no longer
    false-positives inside a larger token like "SCFPX", and spelled-out
    aliases (e.g. "Alexa Fluor 488") normalize to their canonical form
    (e.g. "ALEXA488"). Matches are ordered by first occurrence in `text` and
    deduped (first occurrence wins), then joined with "-".

    `hints` (format-specific metadata keys such as "Channel"/"Fluor") are
    kept as a secondary signal via `_extract_near_key`, in case a marker only
    surfaces near one of those keys and isn't otherwise picked up verbatim by
    the whole-text scan above; any it finds are appended after, only if not
    already found.
    """
    amap = alias_map()

    matches: list[tuple[int, str]] = []
    for alias, canonical in amap.items():
        match = re.search(r"\b" + re.escape(alias) + r"\b", text, re.IGNORECASE)
        if match:
            matches.append((match.start(), canonical))
    matches.sort(key=lambda item: item[0])

    found: list[str] = []
    for _, canonical in matches:
        if canonical not in found:
            found.append(canonical)

    for key in hints:
        near = _extract_near_key(text, key)
        if not near:
            continue
        for alias, canonical in amap.items():
            if canonical in found:
                continue
            if re.search(r"\b" + re.escape(alias) + r"\b", near, re.IGNORECASE):
                found.append(canonical)

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


def _extract_bioio_fields(file_path: Path) -> dict[str, str]:
    """Extract markers/magnification/exptype/sample using bioio, if available.

    Returns only the bioio-derived fields; date/sample-from-filename heuristics
    live in `extract_metadata`. Must stay module-level and picklable (no
    closures, no reliance on outer state) so it can later be run in a separate
    process to bound its runtime (see P0-3).
    """
    result: dict[str, str] = {}
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
    except ImportError:
        pass  # Graceful fallback if bioio is missing
    except Exception as e:
        logger.warning("Failed to extract metadata using bioio for %s: %s", file_path.name, e)

    return result


def _bioio_worker(file_path_str: str, q: multiprocessing.Queue) -> None:
    """Top-level, picklable child-process entry point for `_extract_bioio_fields`.

    Must stay module-level (spawn imports it by reference) and must never let
    an exception escape uncaught — an uncaught exception would kill the child
    without putting anything on the queue, leaving the parent to wait out the
    full timeout for no reason.
    """
    try:
        q.put(_extract_bioio_fields(Path(file_path_str)))
    except Exception:
        q.put({})


def extract_metadata_with_sources(
    file_path: Path, timeout_seconds: int = 20
) -> tuple[dict[str, str], dict[str, str]]:
    """Extract naming-relevant metadata, tagging where each field came from.

    Returns `(fields, sources)`: `fields` is identical to what
    `extract_metadata` returns. `sources` maps each key present in `fields` to
    `"filename"` for the parent-computed heuristics (date from mtime or
    filename, sample guessed from filename) or `"metadata"` for anything
    supplied by the bioio worker (`_extract_bioio_fields`) -- bioio values are
    applied last and override the heuristics, so they're tagged `"metadata"`
    even when they replace a `"filename"`-sourced value (e.g. `sample`).

    Falls back to file timestamps and filename heuristics if scientific readers
    are unavailable or cannot read the file. The bioio read itself runs in a
    bounded child process: some files (e.g. ones the Bio-Formats/Java backend
    cannot parse) make bioio hang indefinitely, so `_extract_bioio_fields` is
    run in a `multiprocessing` child that is terminated after `timeout_seconds`.
    The filename/mtime heuristics below always run in the parent, so a timeout
    still yields a usable name instead of freezing the caller.
    """
    result: dict[str, str] = {}
    sources: dict[str, str] = {}

    # Always derive date from file mtime as a reliable baseline.
    mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
    result["date"] = mtime.strftime("%Y-%m-%d")
    sources["date"] = "filename"

    date_guess = _extract_date_from_name(file_path.stem)
    if date_guess:
        result["date"] = date_guess
        sources["date"] = "filename"

    sample_guess = _guess_sample_from_name(file_path.stem)
    if sample_guess:
        result["sample"] = sample_guess
        sources["sample"] = "filename"

    ctx = multiprocessing.get_context("spawn")
    q = ctx.Queue()
    p = ctx.Process(target=_bioio_worker, args=(str(file_path), q))
    p.start()
    p.join(timeout_seconds)

    if p.is_alive():
        p.terminate()
        p.join(5)
        if p.is_alive():
            # Child didn't die from terminate() (e.g. stuck in bioio/JVM
            # startup on Windows spawn) -- escalate to a hard kill so this
            # branch can never hang past a bounded worst case.
            p.kill()
            p.join(5)
        logger.warning(
            "bioio extraction for %s exceeded %ss timeout; using heuristics only",
            file_path.name,
            timeout_seconds,
        )
        return result, sources

    try:
        bioio_fields = q.get(timeout=1)
    except queue.Empty:
        bioio_fields = {}

    result.update(bioio_fields)
    for key in bioio_fields:
        sources[key] = "metadata"

    return result, sources


def extract_metadata(file_path: Path, timeout_seconds: int = 20) -> dict[str, str]:
    """Extract naming-relevant metadata using bioio when available.

    Falls back to file timestamps and filename heuristics if scientific readers
    are unavailable or cannot read the file. The bioio read itself runs in a
    bounded child process: some files (e.g. ones the Bio-Formats/Java backend
    cannot parse) make bioio hang indefinitely, so `_extract_bioio_fields` is
    run in a `multiprocessing` child that is terminated after `timeout_seconds`.
    The filename/mtime heuristics below always run in the parent, so a timeout
    still yields a usable name instead of freezing the caller.

    See `extract_metadata_with_sources` for a variant that also reports where
    each field came from.
    """
    fields, _sources = extract_metadata_with_sources(file_path, timeout_seconds=timeout_seconds)
    return fields
