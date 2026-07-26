"""Addressable metadata: a flat key -> value map per image.

Vendor metadata is not prose. It is a key/value record -- exactly what Fiji
shows under Image > Show Info::

    ATLConfocalSettingDefinition #0|Magnification = 40
    ATLConfocalSettingDefinition #0|ObjectiveName = HC PL APO 40x/0.95 DRY

Reading a field by its key is *exact*. Scanning a stringified blob for a
keyword that happens to sit near a number is a *guess*, and guesses fail
silently in the worst way: before this module existed, a Leica LIF acquired on
a 40x objective was named `X1`, because the magnification scanner matched the
substring "zoom=1" inside a series *name*. It was then tagged as coming from
metadata, i.e. trusted.

So this module produces the addressable form, and `field_map.py` decides which
key feeds which naming field. Nothing here guesses.

Per-image, not per-file: a container (LIF series, CZI scene, ND2 point) holds
many images whose metadata genuinely differs -- different objectives, zooms and
z-ranges in the same file -- so each one gets its own record.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Convenience keys this module synthesizes on top of whatever the vendor wrote,
# so a naming field can map to exactly one key instead of needing to know that
# dyes arrive as an indexed family.
SYNTHETIC_KEYS = ("SeriesName", "SeriesIndex", "Dyes", "LUTNames", "ChannelCount")


@dataclass
class ImageMetadata:
    """Flat, addressable metadata for one image.

    `index`/`name` identify the image within its container. Match series by
    NAME, never by index: readers disagree on numbering (Bio-Formats splits a
    6-tile mosaic into 6 series where readlif reports 1, so the same image is
    Fiji's series 7 and bioio's scene 2).
    """

    index: int
    name: str
    keys: dict[str, str] = field(default_factory=dict)

    def get(self, key: str) -> str | None:
        value = self.keys.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None


def _clean(value: object) -> str:
    return " ".join(str(value).split())


def _dedupe(values: list[str]) -> list[str]:
    """First-seen order, no duplicates."""
    return list(dict.fromkeys(v for v in values if v))


def _collect_attr(element: ET.Element, attr: str) -> list[str]:
    """Every value of `attr` anywhere in the subtree, first-seen order.

    Leica repeats each detector's settings across `LDM_Block_Sequential`
    blocks, so the same dye appears several times; dedupe rather than emitting
    `ALEXA488-ALEXA488-ALEXA488`.
    """
    return _dedupe([e.get(attr, "") for e in element.iter() if e.get(attr)])


# --------------------------------------------------------------------------
# Leica LIF
# --------------------------------------------------------------------------


def _lif_series_element(xml_root: ET.Element, name: str) -> ET.Element | None:
    for element in xml_root.iter("Element"):
        if element.get("Name") == name:
            return element
    return None


def _harvest_lif(file_path: Path) -> list[ImageMetadata]:
    """Per-series metadata for a Leica LIF.

    Read via `readlif` rather than bioio: bioio's `.metadata` returns the
    whole-file XML root and does NOT narrow on `set_scene()`, so it cannot
    express per-series values at all, while readlif exposes a flat 89-key
    `settings` dict per series. Dyes are not in `settings`; they live as
    `DyeName` attributes in the series' XML subtree.
    """
    from readlif.reader import LifFile  # type: ignore

    lif = LifFile(str(file_path))
    xml_root = lif.xml_root
    images: list[ImageMetadata] = []

    for index, image in enumerate(lif.get_iter_image()):
        keys: dict[str, str] = {}

        for key, value in (getattr(image, "settings", None) or {}).items():
            cleaned = _clean(value)
            if cleaned:
                keys[str(key)] = cleaned

        name = str(getattr(image, "name", "") or f"Series {index}")
        keys["SeriesName"] = name
        keys["SeriesIndex"] = str(index)
        channels = getattr(image, "channels", None)
        if channels is not None:
            keys["ChannelCount"] = str(channels)

        subtree = _lif_series_element(xml_root, name)
        if subtree is not None:
            dyes = _collect_attr(subtree, "DyeName")
            if dyes:
                keys["Dyes"] = ";".join(dyes)
                for position, dye in enumerate(dyes):
                    keys[f"DyeName #{position}"] = dye
            luts = _collect_attr(subtree, "LUTName")
            if luts:
                keys["LUTNames"] = ";".join(luts)

        images.append(ImageMetadata(index=index, name=name, keys=keys))

    return images


# --------------------------------------------------------------------------
# ImageJ / Fiji TIFF
# --------------------------------------------------------------------------

_INFO_LINE = re.compile(r"^\s*([A-Za-z][\w .#|/-]{0,80}?)\s*[=:]\s*(.+?)\s*$")


def _parse_info_block(text: str) -> dict[str, str]:
    """Parse a `Key = Value` block (ImageJ `Info`, Fiji Show Info) into keys."""
    keys: dict[str, str] = {}
    for line in text.splitlines():
        match = _INFO_LINE.match(line)
        if not match:
            continue
        key, value = match.group(1).strip(), _clean(match.group(2))
        if key and value and key not in keys:
            keys[key] = value
    return keys


def _harvest_tiff(file_path: Path) -> list[ImageMetadata]:
    """Metadata for a TIFF, including the ImageJ `Info` block.

    A Fiji-exported TIFF keeps the original vendor record in the ImageJ
    `Info` string (TIFF tag `IJMetadata`); the standard tags carry only the
    structural header. That `Info` block is itself `Key = Value` text, so it
    parses straight into addressable keys.
    """
    import tifffile  # type: ignore

    keys: dict[str, str] = {}
    with tifffile.TiffFile(str(file_path)) as handle:
        ij_metadata = handle.imagej_metadata or {}
        for key, value in ij_metadata.items():
            if key == "Info" and isinstance(value, str):
                keys.update(_parse_info_block(value))
            elif isinstance(value, (str, int, float)):
                keys[str(key)] = _clean(value)

        page = handle.pages[0] if handle.pages else None
        if page is not None:
            for tag_name in ("ImageDescription", "Software", "DateTime", "Make", "Model"):
                tag = page.tags.get(tag_name)
                if tag is not None and isinstance(tag.value, str):
                    keys.setdefault(tag_name, _clean(tag.value))

        if handle.ome_metadata:
            keys.update(_flatten_xml_text(str(handle.ome_metadata)))

    return [ImageMetadata(index=0, name=file_path.stem, keys=keys)]


# --------------------------------------------------------------------------
# Generic XML / OME fallback
# --------------------------------------------------------------------------


def _flatten_element(element: ET.Element, prefix: str, out: dict[str, str], depth: int) -> None:
    if depth > 12:
        return
    tag = element.tag.rsplit("}", 1)[-1]
    path = f"{prefix}|{tag}" if prefix else tag
    for attr, value in element.attrib.items():
        cleaned = _clean(value)
        if cleaned:
            out.setdefault(f"{path}/@{attr}", cleaned)
    if element.text and element.text.strip():
        out.setdefault(path, _clean(element.text))
    counts: dict[str, int] = {}
    for child in element:
        child_tag = child.tag.rsplit("}", 1)[-1]
        position = counts.get(child_tag, 0)
        counts[child_tag] = position + 1
        _flatten_element(child, f"{path} #{position}" if position else path, out, depth + 1)


def _flatten_xml_text(xml_text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        _flatten_element(ET.fromstring(xml_text), "", out, 0)
    except ET.ParseError as exc:
        logger.debug("XML flatten failed: %s", exc)
    return out


def _harvest_generic(file_path: Path) -> list[ImageMetadata]:
    """Last resort: whatever bioio exposes, flattened into keys."""
    from bioio import BioImage  # type: ignore

    image = BioImage(str(file_path))
    keys: dict[str, str] = {}

    metadata = getattr(image, "metadata", None)
    if isinstance(metadata, ET.Element):
        _flatten_element(metadata, "", keys, 0)
    elif metadata is not None:
        text = str(metadata)
        keys.update(_flatten_xml_text(text) if text.lstrip().startswith("<") else {})

    try:
        ome = getattr(image, "ome_metadata", None)
        if ome is not None:
            keys.update(_flatten_xml_text(str(ome)))
    except Exception as exc:  # NotImplementedError for readers without OME
        logger.debug("ome_metadata unavailable for %s: %s", file_path.name, exc)

    channel_names = [str(c) for c in (getattr(image, "channel_names", None) or [])]
    if channel_names:
        keys["LUTNames"] = ";".join(channel_names)
        keys["ChannelCount"] = str(len(channel_names))

    scenes = list(getattr(image, "scenes", []) or [])
    return [
        ImageMetadata(index=i, name=str(scene), keys={**keys, "SeriesName": str(scene)})
        for i, scene in enumerate(scenes)
    ] or [ImageMetadata(index=0, name=file_path.stem, keys=keys)]


# --------------------------------------------------------------------------
# Dispatch
# --------------------------------------------------------------------------

_HARVESTERS = {
    "LIF": _harvest_lif,
    "OME-TIFF": _harvest_tiff,
    "TIFF": _harvest_tiff,
}


def harvest(file_path: Path, file_format: str) -> list[ImageMetadata]:
    """Return one `ImageMetadata` per image in `file_path`.

    Never raises: an unreadable file yields an empty list, and the caller falls
    back to filename heuristics. Reads metadata only, never pixels.
    """
    harvester = _HARVESTERS.get(file_format, _harvest_generic)
    try:
        return harvester(file_path)
    except ImportError as exc:
        logger.warning("reader for %s unavailable: %s", file_format, exc)
    except Exception as exc:
        logger.warning("metadata harvest failed for %s: %s", file_path.name, exc)
    return []
