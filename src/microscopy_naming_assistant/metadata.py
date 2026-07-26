from __future__ import annotations

import logging
import multiprocessing
import queue
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

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


MASK_PLACEHOLDERS = ("date", "exptype", "sample", "magnification", "markers", "notes")


def _extract_from_mask(stem: str, mask: str) -> dict[str, str]:
    """Parse `stem` against a user-configured placeholder mask.

    A mask such as `{date}_{exptype}_{sample}` becomes a regex where each
    `{field}` is a named group. Two rules keep the result honest rather than
    merely plausible:

    - Each placeholder is bounded by its adjacent literal delimiter, so it
      matches a single filename segment and cannot swallow the separator.
      Without this the trailing placeholder absorbs whatever is left over,
      turning `..._E03_extra` into `sample=E03_extra`.
    - The whole stem must match. A mask describes the entire filename
      convention, so a partial match means this file doesn't follow it, and we
      return nothing rather than half-parsing it into confidently-wrong fields.
    """
    tokens = re.split(r"(\{\w+\})", mask)

    def is_placeholder(token: str) -> bool:
        return token.startswith("{") and token.endswith("}")

    pattern_parts: list[str] = []
    for index, token in enumerate(tokens):
        if not is_placeholder(token):
            pattern_parts.append(re.escape(token))
            continue

        field = token[1:-1]
        if field not in MASK_PLACEHOLDERS:
            logger.warning(
                "filename_extraction_mask has unknown placeholder %s; known placeholders: %s",
                token,
                ", ".join(MASK_PLACEHOLDERS),
            )
            return {}

        following = tokens[index + 1] if index + 1 < len(tokens) else ""
        preceding = tokens[index - 1] if index > 0 else ""
        delimiter = following[:1] or preceding[-1:]
        body = rf"[^{re.escape(delimiter)}]+" if delimiter else ".+"
        pattern_parts.append(rf"(?P<{field}>{body})")

    match = re.fullmatch("".join(pattern_parts), stem, re.IGNORECASE)
    if not match:
        return {}

    return {k: v.strip() for k, v in match.groupdict().items() if v and v.strip()}


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


# Upper bound on the metadata blob we keep. Container formats can carry
# megabytes of XML; we only need enough to scan and to ground an LLM prompt,
# and the blob has to survive a pickle across the extraction subprocess.
MAX_METADATA_TEXT_CHARS = 60_000

# bioio synthesizes positional channel names ("Channel:0:0", "Channel 1", "C0")
# when a format carries none. They are not markers, and letting them through
# means a filename confidently states a fluorophore that nothing identified.
_PLACEHOLDER_CHANNEL = re.compile(
    r"^(?:channel[\s:_-]*\d+(?:[\s:_-]*\d+)?|c\d+|\d+)$", re.IGNORECASE
)


def _is_placeholder_channel(name: str) -> bool:
    return bool(_PLACEHOLDER_CHANNEL.match(name.strip()))


def _imagej_info_text(file_path: Path) -> str:
    """Read metadata that bioio's `.metadata` does not surface for TIFFs.

    When Fiji/ImageJ exports a TIFF it drops the vendor metadata block into the
    ImageJ `Info` string (TIFF tag `IJMetadata`), which is what Fiji's
    Image > Show Info displays. bioio's `.metadata` for such a file returns only
    the structural `ImageDescription` header (`ImageJ=1.54f images=210 ...`), so
    the entire acquisition record -- objective, channel/dye names, timestamps --
    is invisible to us unless we read the tag directly.
    """
    try:
        import tifffile  # type: ignore
    except ImportError:
        return ""

    chunks: list[str] = []
    try:
        with tifffile.TiffFile(str(file_path)) as handle:
            ij_metadata = handle.imagej_metadata or {}
            for key, value in ij_metadata.items():
                if isinstance(value, (str, int, float)):
                    chunks.append(f"{key} = {value}")

            for tag_name in ("ImageDescription", "Software", "DateTime", "Artist", "Make", "Model"):
                for page in handle.pages[:1]:
                    tag = page.tags.get(tag_name)
                    if tag is not None and isinstance(tag.value, str):
                        chunks.append(f"{tag_name} = {tag.value}")

            if handle.ome_metadata:
                chunks.append(str(handle.ome_metadata))
    except Exception as exc:
        logger.debug("tifffile tag read failed for %s: %s", file_path.name, exc)

    return "\n".join(chunks)


def _collect_metadata_text(image: object, file_path: Path) -> str:
    """Gather every metadata surface we can reach into one searchable blob.

    `image.metadata` alone is often a thin structural header (see
    `_imagej_info_text`), so we also pull the structured OME model, per-scene
    metadata for multi-series containers, and raw TIFF tags. Sections are
    labelled so both the regex scanners and the LLM can tell them apart.
    """
    sections: list[str] = []

    def add(label: str, value: object) -> None:
        if value is None:
            return
        text = str(value).strip()
        if text and text.lower() != "none":
            sections.append(f"=== {label} ===\n{text}")

    add("metadata", getattr(image, "metadata", None))

    try:
        add("ome-metadata", getattr(image, "ome_metadata", None))
    except Exception as exc:
        logger.debug("ome_metadata unavailable for %s: %s", file_path.name, exc)

    for attribute in ("channel_names", "physical_pixel_sizes", "dims"):
        try:
            add(attribute, getattr(image, attribute, None))
        except Exception as exc:
            logger.debug("%s unavailable for %s: %s", attribute, file_path.name, exc)

    # Multi-series containers (LIF series, CZI scenes, ND2 points) keep
    # per-image metadata behind the scene selector; the default scene alone can
    # miss most of the record.
    try:
        scenes = list(getattr(image, "scenes", []) or [])
        if len(scenes) > 1:
            add("scenes", ", ".join(str(s) for s in scenes))
            current = getattr(image, "current_scene", None)
            for scene in scenes[:8]:
                try:
                    image.set_scene(scene)  # type: ignore[attr-defined]
                    add(f"scene[{scene}] metadata", getattr(image, "metadata", None))
                    add(f"scene[{scene}] channel_names", getattr(image, "channel_names", None))
                except Exception as exc:
                    logger.debug("scene %s unreadable in %s: %s", scene, file_path.name, exc)
            if current is not None:
                try:
                    image.set_scene(current)  # type: ignore[attr-defined]
                except Exception:
                    pass
    except Exception as exc:
        logger.debug("scene enumeration failed for %s: %s", file_path.name, exc)

    tiff_text = _imagej_info_text(file_path)
    if tiff_text:
        # Prepended, not appended: for a stripped ImageJ export this is the only
        # section carrying real acquisition detail, and a blob truncated from
        # the front would drop it in favour of boilerplate like dims.
        sections.insert(0, f"=== tiff-tags ===\n{tiff_text}")

    return _join_within_budget(sections, MAX_METADATA_TEXT_CHARS)


def _join_within_budget(sections: list[str], budget: int) -> str:
    """Join sections, trimming oversized ones so every section survives.

    Truncating the joined string instead would let one verbose section (a
    megabyte of OME-XML, say) crowd out every later one entirely.
    """
    if not sections:
        return ""

    joined = "\n\n".join(sections)
    if len(joined) <= budget:
        return joined

    per_section = max(budget // len(sections), 500)
    trimmed = [
        s if len(s) <= per_section else s[:per_section] + "\n... [section truncated]"
        for s in sections
    ]
    result = "\n\n".join(trimmed)
    if len(result) > budget:
        result = result[:budget] + "\n... [truncated]"
    return result


def _extract_near_key(text: str, key: str) -> str | None:
    """Find the value written next to `key` in a metadata blob.

    The `\\w*` after the key matters: vendors overwhelmingly write compound key
    names of which our hint is only a prefix -- `ObjectiveName = HC PL APO 93x`,
    `ExperimentName = ...`, `ChannelName #0 = GFP`. Anchoring on the bare hint
    would match the key but then capture the rest of the key name instead of the
    value, and silently find nothing.
    """
    pattern = re.compile(
        rf"{re.escape(key)}\w*[^A-Za-z0-9]{{0,8}}([A-Za-z0-9_. -]{{2,40}})", re.IGNORECASE
    )
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


def _extract_magnification(text: str, hints: list[str], allow_bare_x: bool = False) -> str | None:
    """Find a magnification like `X63` in `text`.

    `allow_bare_x` enables a loose `x 63` / `X63` match with no nearby keyword.
    That is safe for short filename stems but not for raw metadata dumps, where
    dimension strings like "512 x 512" would be misread as a magnification.
    """
    for key in hints:
        near = _extract_near_key(text, key)
        if not near:
            continue
        match = re.search(r"(\d{1,3}(?:\.\d+)?)", near)
        if match:
            value = int(float(match.group(1)))
            return f"X{value}"

    fallback = re.search(
        r"(?:MAGNIFICATION|OBJECTIVE|ZOOM)[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)", text, re.IGNORECASE
    )
    if fallback:
        value = int(float(fallback.group(1)))
        return f"X{value}"

    if allow_bare_x:
        x_match = re.search(r"\bX\s?(\d{1,3}(?:\.\d+)?)\b", text, re.IGNORECASE)
        if x_match:
            value = int(float(x_match.group(1)))
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

    embryo_match = re.search(r"\b(?:EMBRYO|SAMPLE)\s*(\d{1,3})\b", text, re.IGNORECASE)
    if embryo_match:
        return f"E{int(embryo_match.group(1)):02d}"

    for key in hints:
        near = _extract_near_key(text, key)
        if near:
            candidate = re.search(r"E\d{1,3}", near, re.IGNORECASE)
            if candidate:
                return f"E{int(candidate.group(0)[1:]):02d}"
    return None


_ACQUISITION_DATE_KEYS = (
    "AcquisitionDate",
    "AcquisitionTime",
    "CreationDate",
    "DateTime",
    "ImageDate",
)


def _extract_acquisition_date(text: str) -> str | None:
    """Pull the acquisition date out of a metadata blob.

    Worth doing even though a date is always available from the file's mtime:
    mtime is usually the date the file was *copied*, not acquired, so an
    mtime-derived date can silently misdate an experiment by months.
    """
    for key in _ACQUISITION_DATE_KEYS:
        match = re.search(
            rf"{re.escape(key)}\s*[=:]\s*[\"']?((?:19|20)\d{{2}})[-:/](\d{{1,2}})[-:/](\d{{1,2}})",
            text,
            re.IGNORECASE,
        )
        if match:
            year, month, day = match.group(1), int(match.group(2)), int(match.group(3))
            if 1 <= month <= 12 and 1 <= day <= 31:
                return f"{year}-{month:02d}-{day:02d}"
    return None


def _extract_bioio_fields(file_path: Path) -> dict[str, str]:
    """Extract markers/magnification/exptype/sample using bioio, if available.

    Thin wrapper over `_read_with_bioio` kept for callers that only want the
    parsed fields. See that function for the full payload (raw metadata text,
    reader name, error).
    """
    fields = _read_with_bioio(file_path)["fields"]
    return fields if isinstance(fields, dict) else {}


def _read_with_bioio(file_path: Path) -> dict[str, object]:
    """Read a file with bioio and return parsed fields plus the raw metadata.

    Returns `{"fields": dict, "metadata_text": str, "reader": str, "error": str}`.
    `metadata_text` is the full harvested blob (see `_collect_metadata_text`) so
    callers can show it to the user and ground an LLM prompt in it, rather than
    it being scanned once and thrown away.

    Must stay module-level and picklable (no closures, no reliance on outer
    state) so it can run in a separate process to bound its runtime (see P0-3).

    No reader is selected here explicitly: bioio picks a plugin per file
    extension from whatever is installed, preferring the most specific
    native reader (bioio-ome-tiff/-tifffile/-czi/-lif/-nd2) over the generic
    bioio-bioformats plugin, which only steps in for formats none of the
    native readers claim. Native reads are plain Python/C and return
    quickly; bioio-bioformats spins up a JVM (via jpype/scyjava/jgo), which
    is slower and occasionally hangs -- the process timeout around this call
    (see `extract_metadata_with_sources`) mainly exists to guard that rarer
    Java fallback path now.
    """
    result: dict[str, str] = {}
    file_format = _detect_format(file_path)
    metadata_text = ""
    reader_name = ""
    error = ""

    try:
        from bioio import BioImage  # type: ignore

        image = BioImage(str(file_path))
        reader_name = type(getattr(image, "reader", image)).__module__.split(".")[0]

        metadata_text = _collect_metadata_text(image, file_path)

        if metadata_text:
            text = _extract_text_chunks(metadata_text)

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

            acquired = _extract_acquisition_date(text)
            if acquired:
                result["date"] = acquired

        # Real channel names are the single most reliable marker source, but
        # only when the format actually carried them -- see
        # `_is_placeholder_channel`. Never let synthesized names overwrite a
        # marker the metadata scan already identified.
        channel_names = getattr(image, "channel_names", None) or []
        named_channels = [
            str(c).strip().upper()
            for c in channel_names
            if str(c).strip() and not _is_placeholder_channel(str(c))
        ]
        if named_channels:
            result["markers"] = "-".join(dict.fromkeys(named_channels))
    except ImportError:
        error = "bioio is not installed"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        logger.warning("Failed to extract metadata using bioio for %s: %s", file_path.name, e)

    return {
        "fields": result,
        "metadata_text": metadata_text,
        "reader": reader_name,
        "error": error,
    }


def _bioio_worker(file_path_str: str, q: multiprocessing.Queue) -> None:
    """Top-level, picklable child-process entry point for `_extract_bioio_fields`.

    Must stay module-level (spawn imports it by reference) and must never let
    an exception escape uncaught — an uncaught exception would kill the child
    without putting anything on the queue, leaving the parent to wait out the
    full timeout for no reason.
    """
    try:
        q.put(_read_with_bioio(Path(file_path_str)))
    except Exception as exc:
        q.put({"fields": {}, "metadata_text": "", "reader": "", "error": f"{type(exc).__name__}"})


@dataclass
class ExtractionDetail:
    """What the reader saw, beyond the handful of fields we parse out of it.

    `metadata_text` is the full harvested metadata blob, kept so the UI can show
    users what was actually in their file and so the LLM can be grounded in it.
    """

    metadata_text: str = ""
    reader: str = ""
    error: str = ""
    timed_out: bool = False


def extract_metadata_detailed(
    file_path: Path, timeout_seconds: int = 20, extraction_mask: str | None = None
) -> tuple[dict[str, str], dict[str, str], ExtractionDetail]:
    """Extract naming-relevant metadata, tagging where each field came from.

    Returns `(fields, sources)`: `fields` is identical to what
    `extract_metadata` returns. `sources` maps each key present in `fields` to
    `"filename"` for the parent-computed heuristics (date from mtime or
    filename, sample guessed from filename) or `"metadata"` for anything
    supplied by the bioio worker (`_extract_bioio_fields`) -- bioio values
    override the heuristics, so they're tagged `"metadata"` even when they
    replace a `"filename"`-sourced value (e.g. `sample`). The one exception is
    `extraction_mask`, a user-configured placeholder mask (see
    `_extract_from_mask`), which is applied last and wins outright.

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
    detail = ExtractionDetail()

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

    mask_fields = _extract_from_mask(file_path.stem, extraction_mask) if extraction_mask else {}
    result.update(mask_fields)
    for key in mask_fields:
        sources[key] = "filename"

    # Keyword scan of the stem, for images whose embedded metadata was stripped
    # (e.g. ImageJ .tif exports). Only fills fields nothing else has supplied.
    stem_text = file_path.stem.replace("_", " ").replace("-", " ")

    if "markers" not in result:
        marker_guess = _extract_markers(stem_text, [])
        if marker_guess:
            result["markers"] = marker_guess
            sources["markers"] = "filename"

    if "exptype" not in result:
        exptype_guess = _extract_exptype(stem_text, [])
        if exptype_guess:
            result["exptype"] = exptype_guess
            sources["exptype"] = "filename"

    if "magnification" not in result:
        mag_guess = _extract_magnification(stem_text, [], allow_bare_x=True)
        if mag_guess:
            result["magnification"] = mag_guess
            sources["magnification"] = "filename"

    if "sample" not in result:
        stem_sample = _extract_sample(stem_text, [])
        if stem_sample:
            result["sample"] = stem_sample
            sources["sample"] = "filename"

    ctx = multiprocessing.get_context("spawn")
    q = ctx.Queue()
    p = ctx.Process(target=_bioio_worker, args=(str(file_path), q))
    p.start()

    # Read BEFORE joining. A Queue.put is handed to a feeder thread that writes
    # into an OS pipe (~64KB buffer); the child cannot exit until that drains.
    # Joining first would therefore deadlock on any metadata blob larger than
    # the buffer -- the child would still be alive at the timeout, get killed,
    # and the payload lost on exactly the metadata-rich files we care about.
    payload: dict[str, object]
    try:
        payload = q.get(timeout=timeout_seconds)
    except queue.Empty:
        payload = {}

    p.join(5)
    if p.is_alive():
        p.terminate()
        p.join(5)
        if p.is_alive():
            # Child didn't die from terminate() (e.g. stuck in bioio/JVM
            # startup on Windows spawn) -- escalate to a hard kill so this
            # branch can never hang past a bounded worst case.
            p.kill()
            p.join(5)

    if not payload:
        detail.timed_out = True
        detail.error = f"extraction exceeded {timeout_seconds}s timeout"
        logger.warning(
            "bioio extraction for %s exceeded %ss timeout; using heuristics only",
            file_path.name,
            timeout_seconds,
        )
        return result, sources, detail

    detail.metadata_text = str(payload.get("metadata_text") or "")
    detail.reader = str(payload.get("reader") or "")
    detail.error = str(payload.get("error") or "")

    bioio_fields = payload.get("fields") or {}
    if isinstance(bioio_fields, dict):
        result.update(bioio_fields)
        for key in bioio_fields:
            sources[key] = "metadata"

    # A mask is an explicit statement by the user that their filenames encode
    # these fields, so it outranks bioio's regex-over-a-metadata-blob guesses.
    result.update(mask_fields)
    for key in mask_fields:
        sources[key] = "filename"

    return result, sources, detail


def extract_metadata_with_sources(
    file_path: Path, timeout_seconds: int = 20, extraction_mask: str | None = None
) -> tuple[dict[str, str], dict[str, str]]:
    """`extract_metadata_detailed` without the reader detail."""
    fields, sources, _detail = extract_metadata_detailed(
        file_path, timeout_seconds=timeout_seconds, extraction_mask=extraction_mask
    )
    return fields, sources


def extract_metadata(
    file_path: Path, timeout_seconds: int = 20, extraction_mask: str | None = None
) -> dict[str, str]:
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
    fields, _sources = extract_metadata_with_sources(
        file_path, timeout_seconds=timeout_seconds, extraction_mask=extraction_mask
    )
    return fields
