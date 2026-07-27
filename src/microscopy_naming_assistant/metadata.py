from __future__ import annotations

import logging
import multiprocessing
import queue
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .field_map import resolve_fields
from .markers import AMBIGUOUS_IN_FREE_TEXT, alias_map
from .metadata_keys import ImageMetadata, harvest

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
    if ext in (".tif", ".tiff"):
        return "TIFF"
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


def _render_metadata_text(images: list[ImageMetadata]) -> str:
    """Render harvested keys as readable `Key = Value` sections.

    Built from the addressable records rather than by stringifying reader
    objects. That matters twice over: stringifying an `ElementTree.Element`
    yields `<Element 'LMSDataContainerHeader' at 0x...>` -- a memory address,
    not a document -- and dumping the raw XML instead would spend the whole
    budget on `BeamRoute`/`Aotf` boilerplate. Keys are the signal; this is what
    the user reads and what grounds the LLM.
    """
    sections: list[str] = []
    for image in images:
        lines = [f"{key} = {value}" for key, value in sorted(image.keys.items())]
        label = f"image[{image.index}] {image.name}" if len(images) > 1 else "metadata"
        sections.append(f"=== {label} ===\n" + "\n".join(lines))
    return _join_within_budget(sections, MAX_METADATA_TEXT_CHARS)


def _resolve_per_image(
    images: list[ImageMetadata], file_format: str, overrides: dict[str, str] | None
) -> list[tuple[dict[str, str], dict[str, str]]]:
    """Resolve naming fields for every image once.

    Both `_shared_fields` (the container-level view) and `_per_image_records`
    (the per-series sidecar view) need the same per-image `resolve_fields`
    result; factored out so a caller holding both concerns -- `_read_with_bioio`
    -- can compute it once and hand it to each, instead of resolving every
    image's fields twice over.
    """
    return [resolve_fields(image, file_format, overrides) for image in images]


def _shared_fields(
    images: list[ImageMetadata],
    file_format: str,
    overrides: dict[str, str] | None,
    resolved: list[tuple[dict[str, str], dict[str, str]]] | None = None,
) -> tuple[dict[str, str], dict[str, str], set[str]]:
    """Fields that hold for EVERY image in a container.

    A container is one file, so its name may only claim what is true of all of
    it. Where series disagree -- a LIF holding both a 20x overview and a 40x
    closeup -- the field is omitted rather than taking series 0's value and
    stating it as fact. The per-series detail is not lost; it goes to the
    sidecar.

    Markers are compared as a SET: detector enumeration order varies between
    series that imaged the same dyes, and "these three dyes are present" is
    true of the container even when the ordering differs.

    Returns `(shared, provenance, contested)`. `contested` names every field
    the key map resolved for at least one image but which didn't hold across
    all of them. Callers must treat a contested field as a hard "no" for any
    further guessing (e.g. a regex fallback over the whole container's text):
    the map already proved real, disagreeing per-series data exists for it, so
    picking any single value would silently reintroduce the exact bug this
    function exists to prevent -- one series's fact stated as the file's.

    `resolved` lets a caller that already ran `_resolve_per_image` (see above)
    pass the result in instead of resolving every image's fields again; when
    omitted this resolves them itself so the function stays usable standalone.
    """
    if not images:
        return {}, {}, set()

    if resolved is None:
        resolved = _resolve_per_image(images, file_format, overrides)
    first_fields, first_provenance = resolved[0]

    all_field_names: set[str] = set()
    for image_fields, _ in resolved:
        all_field_names.update(image_fields)

    shared: dict[str, str] = {}
    provenance: dict[str, str] = {}
    for field_name, value in first_fields.items():
        others = [fields.get(field_name) for fields, _ in resolved[1:]]
        if field_name == "markers":
            agree = all(
                o is not None and set(o.split("-")) == set(value.split("-")) for o in others
            )
        else:
            agree = all(o == value for o in others)
        if agree:
            shared[field_name] = value
            provenance[field_name] = first_provenance[field_name]

    contested = all_field_names - set(shared)
    return shared, provenance, contested


def _per_image_records(
    images: list[ImageMetadata],
    file_format: str,
    overrides: dict[str, str] | None,
    resolved: list[tuple[dict[str, str], dict[str, str]]] | None = None,
) -> list[dict[str, str]]:
    """Per-image (per-series) resolved fields, for the sidecar.

    `_shared_fields` states only what holds across the whole container; a 20x
    overview and a 40x closeup in one LIF both have a real, individual
    magnification even though the container-level name cannot claim either.
    This is where that per-series detail goes.

    Each record is a FLAT `str -> str` dict -- `{"index": ..., "name": ...,
    **resolved_fields}` -- never nested, because it must survive a pickle
    across the multiprocessing spawn Queue (see `_read_with_bioio`).

    `resolved` mirrors `_shared_fields`: pass in an already-computed
    `_resolve_per_image` result to avoid resolving every image's fields twice;
    when omitted this resolves them itself.
    """
    if resolved is None:
        resolved = _resolve_per_image(images, file_format, overrides)

    records: list[dict[str, str]] = []
    for image, (fields, _provenance) in zip(images, resolved):
        record: dict[str, str] = {"index": str(image.index), "name": image.name}
        record.update(fields)
        records.append(record)
    return records


def _collect_metadata_text(image: object, file_path: Path) -> str:
    """Deprecated shim retained for the `_imagej_info_text` path.

    Superseded by `metadata_keys.harvest` + `_render_metadata_text`.
    """
    tiff_text = _imagej_info_text(file_path)
    return f"=== tiff-tags ===\n{tiff_text}" if tiff_text else ""


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

    Every known alias (see `markers.alias_map`) except those in
    `markers.AMBIGUOUS_IN_FREE_TEXT` is searched for as a whole word,
    case-insensitively, directly in `text` -- so "CFP" no longer
    false-positives inside a larger token like "SCFPX", and spelled-out
    aliases (e.g. "Alexa Fluor 488") normalize to their canonical form
    (e.g. "ALEXA488"). `AMBIGUOUS_IN_FREE_TEXT` aliases (e.g. "snap", "halo",
    "venus", "citrine") are real marker spellings but are ALSO common English
    words or standard instrument/camera-software terms, so they are skipped
    here entirely -- they still resolve through an exact metadata-value
    lookup (`field_map.py::_canonical_marker`), which never sees surrounding
    prose to collide with.

    Longest-match-wins is a STRUCTURAL guarantee, not an accident of
    `MARKER_ALIASES`'s dict insertion order: candidate matches are sorted by
    `(start, -length)` and then a match is only kept if its span does not
    overlap any already-accepted match's span. So when two aliases both
    match at (or overlapping) the same position -- e.g. "atto 647" and
    "atto 647-n" both matching at the start of "ATTO 647-N" -- the longer,
    more specific alias always wins and the shorter one is discarded
    outright, never appended as a second, spurious marker. This holds
    regardless of which alias happens to appear first in the dict (see
    test_markers.py for the adversarial-order proof).

    Once a span is accepted, matches are ordered by first occurrence in
    `text` and deduped by canonical (first occurrence wins), then joined
    with "-".

    `hints` (format-specific metadata keys such as "Channel"/"Fluor") are
    kept as a secondary signal via `_extract_near_key`, in case a marker only
    surfaces near one of those keys and isn't otherwise picked up verbatim by
    the whole-text scan above; any it finds are appended after, only if not
    already found. The same ambiguous-alias exclusion and longest-match/
    span-overlap rules apply there too.
    """
    amap = alias_map()

    def _non_overlapping_matches(haystack: str, exclude: set[str]) -> list[tuple[int, int, str]]:
        candidates: list[tuple[int, int, str]] = []
        for alias, canonical in amap.items():
            if alias in AMBIGUOUS_IN_FREE_TEXT or canonical in exclude:
                continue
            # B3: every occurrence, not just the first. re.search finds one
            # candidate per alias, so when that one candidate happens to be
            # nested inside a longer alias's span the overlap rule below
            # correctly discards it -- but then nothing is left for this
            # alias's own separate, later occurrence, silently dropping a
            # real second marker (order-dependent: 'ch1 ATTO 647-N ch2 ATTO
            # 647' lost channel 2's dye under re.search).
            for match in re.finditer(r"\b" + re.escape(alias) + r"\b", haystack, re.IGNORECASE):
                candidates.append((match.start(), match.end(), canonical))
        # Longer alias wins any tie/overlap at the same start index -- sort by
        # (start, -length) so it is considered, and therefore accepted, first.
        candidates.sort(key=lambda item: (item[0], -(item[1] - item[0])))

        accepted: list[tuple[int, int, str]] = []
        accepted_spans: list[tuple[int, int]] = []
        for start, end, canonical in candidates:
            if any(start < a_end and end > a_start for a_start, a_end in accepted_spans):
                continue  # overlaps an already-accepted (longer or earlier) match
            accepted_spans.append((start, end))
            accepted.append((start, end, canonical))
        return accepted

    found: list[str] = []
    for _, _, canonical in _non_overlapping_matches(text, exclude=set()):
        if canonical not in found:
            found.append(canonical)

    for key in hints:
        near = _extract_near_key(text, key)
        if not near:
            continue
        for _, _, canonical in _non_overlapping_matches(near, exclude=set(found)):
            if canonical not in found:
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


def _read_with_bioio(
    file_path: Path, field_key_map: dict[str, str] | None = None
) -> dict[str, object]:
    """Read a file's addressable metadata and return parsed fields plus the raw text.

    Returns `{"fields": dict, "metadata_text": str, "reader": str, "error": str,
    "key_paths": dict, "field_key_provenance": dict, "images": list[dict]}`.
    `metadata_text` is the full harvested blob so callers can show it to the
    user and ground an LLM prompt in it, rather than it being scanned once and
    thrown away. `images` is the per-series sidecar detail: one flat str->str
    record per image (see `_per_image_records`), for containers whose series
    disagree on a field the container-level `fields` had to omit.

    Must stay module-level and picklable (no closures, no reliance on outer
    state) so it can run in a separate process to bound its runtime (see P0-3).

    PRIMARY source is `metadata_keys.harvest` + `field_map.resolve_fields`: an
    exact key -> naming-field mapping (see `_shared_fields`). The legacy regex
    scanners (`_extract_markers` etc.) and bioio's `channel_names` are FALLBACK
    only, used per-field when the key map left that field unset -- see the
    module docstring in `metadata_keys.py` for why a keyword scan over a
    stringified blob is a guess and the addressable form is not.

    `harvest` runs FIRST and never raises (LIF reads via `readlif`, which needs
    no bioio at all), so a slow or failing `BioImage` construction below can
    never discard the harvested keys/metadata_text -- constructing a `BioImage`
    for a large LIF costs seconds where `harvest` costs a fraction of a second.
    """
    file_format = _detect_format(file_path)

    images = harvest(file_path, file_format)
    metadata_text = _render_metadata_text(images)

    if file_format in ("TIFF", "OME-TIFF"):
        # ImageJ/Fiji stashes the vendor record in the IJMetadata `Info` tag,
        # which `metadata_keys._harvest_tiff` already parses into keys -- but
        # keep the raw shim text too so users can see the untouched tag block.
        tiff_shim = _collect_metadata_text(None, file_path)
        if tiff_shim:
            metadata_text = f"{metadata_text}\n\n{tiff_shim}" if metadata_text else tiff_shim

    resolved = _resolve_per_image(images, file_format, field_key_map)
    fields, provenance, contested = _shared_fields(
        images, file_format, field_key_map, resolved=resolved
    )
    image_records = _per_image_records(images, file_format, field_key_map, resolved=resolved)

    # FALLBACK: any field the key map left unset for this container is filled,
    # if possible, by scanning the rendered metadata text the old way -- but
    # ONLY when the map found nothing anywhere for that field. A `contested`
    # field is one the map DID resolve for at least one image, just not the
    # same value for all of them (e.g. a 20x overview and a 40x closeup in one
    # LIF); guessing a value from the concatenated multi-image text there would
    # pick whichever series's data appears first and state it as a file-wide
    # fact -- the same bug `_shared_fields` exists to prevent, reintroduced via
    # the regex path instead of the key map. Never overwrites a value the key
    # map already produced.
    text = _extract_text_chunks(metadata_text)
    hints = FORMAT_FIELD_HINTS.get(file_format, FORMAT_FIELD_HINTS.get("OME-TIFF", {}))

    if "markers" not in fields and "markers" not in contested:
        markers = _extract_markers(text, hints.get("markers", []))
        if markers:
            fields["markers"] = markers

    if "magnification" not in fields and "magnification" not in contested:
        magnification = _extract_magnification(text, hints.get("magnification", []))
        if magnification:
            fields["magnification"] = magnification

    if "exptype" not in fields and "exptype" not in contested:
        exptype = _extract_exptype(text, hints.get("exptype", []))
        if exptype:
            fields["exptype"] = exptype

    if "sample" not in fields and "sample" not in contested:
        sample = _extract_sample(text, hints.get("sample", []))
        if sample:
            fields["sample"] = sample

    if "date" not in fields and "date" not in contested:
        acquired = _extract_acquisition_date(text)
        if acquired:
            fields["date"] = acquired

    # BioImage is only needed now for its reader name and, as a last-resort
    # marker fallback, its `channel_names`. Isolated in its own try/except so
    # a slow/failing construction records `error` but never discards anything
    # harvested above.
    reader_name = ""
    error = ""
    try:
        from bioio import BioImage  # type: ignore

        image = BioImage(str(file_path))
        reader_name = type(getattr(image, "reader", image)).__module__.split(".")[0]

        # Real channel names are a reliable marker source only when the format
        # actually carried dye names -- bioio synthesizes placeholder names
        # ("Channel:0:0") or, worse, LUT display colours ("Green"/"Blue"/"Red")
        # when it has neither. `_is_placeholder_channel` catches the former but
        # not the latter, so this must stay a fallback used ONLY when nothing
        # above (key map or regex scan) already identified the markers -- else
        # a correct 'DAPI-CY3-ALEXA488' gets silently overwritten by LUT colours.
        # Also skipped when markers is `contested` (per-series dyes genuinely
        # disagree): a single BioImage-wide channel_names list can't state a
        # fact about the whole container any more validly than the regex scan
        # can.
        if "markers" not in fields and "markers" not in contested:
            channel_names = getattr(image, "channel_names", None) or []
            named_channels = [
                str(c).strip().upper()
                for c in channel_names
                if str(c).strip() and not _is_placeholder_channel(str(c))
            ]
            if named_channels:
                fields["markers"] = "-".join(dict.fromkeys(named_channels))
    except ImportError:
        error = "bioio is not installed"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        logger.warning("Failed to extract metadata using bioio for %s: %s", file_path.name, e)

    return {
        "fields": fields,
        "metadata_text": metadata_text,
        "reader": reader_name,
        "error": error,
        "key_paths": dict(images[0].keys) if images else {},
        "field_key_provenance": provenance,
        "images": image_records,
    }


def _bioio_worker(
    file_path_str: str,
    q: multiprocessing.Queue,
    field_key_map: dict[str, str] | None = None,
) -> None:
    """Top-level, picklable child-process entry point for `_extract_bioio_fields`.

    Must stay module-level (spawn imports it by reference) and must never let
    an exception escape uncaught — an uncaught exception would kill the child
    without putting anything on the queue, leaving the parent to wait out the
    full timeout for no reason.
    """
    try:
        q.put(_read_with_bioio(Path(file_path_str), field_key_map))
    except Exception as exc:
        q.put(
            {
                "fields": {},
                "metadata_text": "",
                "reader": "",
                "error": f"{type(exc).__name__}",
                "key_paths": {},
                "field_key_provenance": {},
                "images": [],
            }
        )


@dataclass
class ExtractionDetail:
    """What the reader saw, beyond the handful of fields we parse out of it.

    `metadata_text` is the full harvested metadata blob, kept so the UI can show
    users what was actually in their file and so the LLM can be grounded in it.

    `images` is the per-series sidecar detail: one flat str->str record per
    image (see `_per_image_records`), carrying the fields the key map resolved
    for that image alone -- including any the container-level `fields` had to
    omit because series disagreed.
    """

    metadata_text: str = ""
    reader: str = ""
    error: str = ""
    timed_out: bool = False
    key_paths: dict[str, str] = field(default_factory=dict)
    field_key_provenance: dict[str, str] = field(default_factory=dict)
    images: list[dict[str, str]] = field(default_factory=list)


def extract_metadata_detailed(
    file_path: Path,
    timeout_seconds: int = 20,
    extraction_mask: str | None = None,
    field_key_map: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict[str, str], ExtractionDetail]:
    """Extract naming-relevant metadata, tagging where each field came from.

    Returns `(fields, sources)`: `fields` is identical to what
    `extract_metadata` returns. `sources` maps each key present in `fields` to
    `"filename"` for parent-computed heuristics parsed out of the filename
    itself (date/sample/markers/... guessed from the stem), `"mtime"` for the
    weakest heuristic -- the file's modification timestamp, used only as a
    `date` fallback when nothing else supplied one -- or `"metadata"` for
    anything supplied by the bioio worker (`_extract_bioio_fields`). `"mtime"`
    is deliberately distinct from `"filename"`: mtime is frequently the date a
    file was *copied*, not acquired, so callers that would otherwise treat it
    as a confident guess need to be able to tell the two apart (see E7 --
    provenance must not blur a weaker origin into a stronger-sounding one).
    bioio values override the heuristics, so they're tagged `"metadata"` even
    when they replace a `"filename"`- or `"mtime"`-sourced value (e.g.
    `sample`, `date`). The one exception is `extraction_mask`, a
    user-configured placeholder mask (see `_extract_from_mask`), which is
    applied last and wins outright.

    `field_key_map` overrides the curated per-format key -> field mapping (see
    `field_map.resolve_fields`); forwarded through to the worker unchanged.

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

    # Derive date from file mtime as a last-resort baseline. This is the
    # weakest possible origin -- mtime is frequently the date the file was
    # *copied*, not acquired -- so it gets its own "mtime" tag rather than
    # being folded into "filename", which callers reasonably treat as a
    # stronger, content-derived guess.
    mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
    result["date"] = mtime.strftime("%Y-%m-%d")
    sources["date"] = "mtime"

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
    p = ctx.Process(target=_bioio_worker, args=(str(file_path), q, field_key_map))
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

    key_paths = payload.get("key_paths") or {}
    if isinstance(key_paths, dict):
        detail.key_paths = key_paths
    field_key_provenance = payload.get("field_key_provenance") or {}
    if isinstance(field_key_provenance, dict):
        detail.field_key_provenance = field_key_provenance
    images = payload.get("images") or []
    if isinstance(images, list):
        detail.images = images

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
