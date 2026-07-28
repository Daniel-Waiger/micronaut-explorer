"""Which metadata key feeds which naming field.

This is the layer that replaces guessing with declaring. A mapping entry says
"`magnification` comes from the key `Magnification`, formatted as `X40`" --
an address plus a transform. Because the address is exact, provenance becomes
exact too: the UI can state which key a value came from instead of asserting a
vague "metadata", which is what let an objective of 40x be reported as `X1`.

Curated defaults ship per format so the tool works out of the box; a profile
can override any entry (see `ProfileRules.field_key_map`), because only the
person who ran the experiment knows where their lab writes a field.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .markers import AMBIGUOUS_IN_FREE_TEXT, alias_map
from .metadata_keys import ImageMetadata

# Naming fields a mapping may target. `date` is included but left unmapped by
# default for most formats: the filename/mtime heuristics already cover it, and
# a wrong date is worse than a late one.
MAPPABLE_FIELDS = ("date", "exptype", "sample", "magnification", "markers", "notes")


@dataclass(frozen=True)
class FieldSource:
    """A naming field's address in the metadata, plus how to format it.

    `key` is normally a single metadata key. It may also be a tuple of keys
    when several sibling keys must be combined into one value before
    transforming -- e.g. per-channel dye names stored as "ChannelName #0",
    "ChannelName #1", ... rather than one pre-joined "Dyes" key. Offering such
    siblings one at a time to a first-non-empty-wins resolver locks onto
    channel 0 and silently drops every channel after it.
    """

    key: str | tuple[str, ...]
    transform: str = "verbatim"


# --------------------------------------------------------------------------
# Transforms
# --------------------------------------------------------------------------

_VENDOR_PREFIX = re.compile(r"^[A-Za-z]+/")
_PARENTHETICAL = re.compile(r"\([^)]*\)")
_UNSAFE = re.compile(r"[^A-Za-z0-9]+")


def _transform_verbatim(value: str) -> str | None:
    return value.strip() or None


def _transform_upper(value: str) -> str | None:
    cleaned = value.strip().upper()
    return cleaned or None


def _transform_token(value: str) -> str | None:
    """Collapse free text into a single filename-safe token."""
    cleaned = _UNSAFE.sub("_", value.strip()).strip("_")
    return cleaned or None


_MAGNIFICATION_UNIT = re.compile(r"(\d+(?:\.\d+)?)\s*[xX]\b")
_MAGNIFICATION_BARE = re.compile(r"^\d+(?:\.\d+)?$")


def _transform_magnification(value: str) -> str | None:
    """`HC PL APO CS2 63x/1.40 OIL` -> `X63`; bare `40` (LIF) / `63` (OME) -> `X40` / `X63`.

    Objective strings pack several numbers together -- model designations
    ("CS2"), the magnification, and the numerical aperture ("/1.40") -- and
    taking "the first digit run anywhere" grabs whichever one happens to come
    first, which is how a 63x/1.40 objective could be reported as X1 (the NA)
    or X2 (the "CS2" designation). The magnification is the ONLY number in
    these strings followed by a literal `x`/`X`, so anchor on that unit
    first. Only when no unit-anchored match exists do we fall back to
    treating the whole (stripped) value as a bare number, because some
    formats store magnification as a number with no unit at all: LIF's
    atomic `Magnification` key is literally `'40'` and OME's
    `NominalMagnification` is `'63'`. We never fall back further than that --
    "first number anywhere" is the bug this function exists to not have.
    """
    stripped = value.strip()
    match = _MAGNIFICATION_UNIT.search(stripped)
    if match:
        number = float(match.group(1))
    elif _MAGNIFICATION_BARE.match(stripped):
        number = float(stripped)
    else:
        return None
    if number <= 0:
        return None
    return f"X{int(number)}"


def _canonical_marker(raw: str) -> str | None:
    """Map one vendor dye string to a canonical marker name.

    Vendors qualify dye names in ways that defeat a literal lookup:
    `Leica/DAPI (dsDNA bound)` is DAPI. Strip the vendor prefix and any
    parenthetical qualifier, then consult the shared alias table so LIF, CZI
    and filename-derived markers all normalize identically.
    """
    aliases = alias_map()
    cleaned = _PARENTHETICAL.sub(" ", _VENDOR_PREFIX.sub("", raw)).strip()
    if not cleaned:
        return None

    direct = aliases.get(cleaned.lower())
    if direct:
        return direct

    compact = re.sub(r"\s+", "", cleaned).lower()
    if compact in aliases:
        return aliases[compact]

    # The value may be a short free-text label rather than a bare dye name --
    # e.g. a per-channel key holding "GFP green" or "DAPI blue" -- so look for
    # a known alias as a whole word within it before giving up on it as
    # unknown. Same principle as metadata._extract_markers (word-boundary,
    # AMBIGUOUS_IN_FREE_TEXT excluded so words like "snap"/"halo" don't
    # false-positive here either), applied to one isolated value instead of a
    # whole document; prefer the longest match so e.g. "Alexa Fluor 488
    # channel" resolves to ALEXA488 rather than a shorter substring alias.
    best: tuple[int, str] | None = None
    for alias, canonical in aliases.items():
        if alias in AMBIGUOUS_IN_FREE_TEXT:
            continue
        if re.search(r"\b" + re.escape(alias) + r"\b", cleaned, re.IGNORECASE):
            if best is None or len(alias) > best[0]:
                best = (len(alias), canonical)
    if best:
        return best[1]

    # Unknown dye: keep it rather than dropping evidence, but make it safe.
    return _UNSAFE.sub("", cleaned).upper() or None


def _transform_markers(value: str) -> str | None:
    """`Leica/ALEXA 488;Leica/DAPI (dsDNA bound);Leica/Cy3` -> `ALEXA488-DAPI-CY3`."""
    parts = [p for p in re.split(r"[;,|]", value) if p.strip()]
    canonical = [m for m in (_canonical_marker(p) for p in parts) if m]
    return "-".join(dict.fromkeys(canonical)) or None


def _transform_date(value: str) -> str | None:
    match = re.search(r"((?:19|20)\d{2})[-:/._]?(\d{2})[-:/._]?(\d{2})", value)
    if not match:
        return None
    year, month, day = match.group(1), int(match.group(2)), int(match.group(3))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year}-{month:02d}-{day:02d}"


TRANSFORMS = {
    "verbatim": _transform_verbatim,
    "upper": _transform_upper,
    "token": _transform_token,
    "magnification": _transform_magnification,
    "markers": _transform_markers,
    "date": _transform_date,
}


# --------------------------------------------------------------------------
# Curated defaults
# --------------------------------------------------------------------------

DEFAULT_FIELD_MAPS: dict[str, dict[str, FieldSource]] = {
    "LIF": {
        "magnification": FieldSource("Magnification", "magnification"),
        "markers": FieldSource("Dyes", "markers"),
        "notes": FieldSource("SeriesName", "token"),
    },
    "OME-TIFF": {
        "magnification": FieldSource("NominalMagnification", "magnification"),
        "markers": FieldSource("Dyes", "markers"),
        "date": FieldSource("AcquisitionDate", "date"),
    },
    "TIFF": {
        "magnification": FieldSource("NominalMagnification", "magnification"),
        "markers": FieldSource("Dyes", "markers"),
        "date": FieldSource("AcquisitionDate", "date"),
    },
}

# Alternates tried when the primary default key is absent. Keeps the curated
# defaults useful across vendor spellings without reintroducing fuzzy search:
# every candidate is still an exact key name.
FALLBACK_KEYS: dict[str, dict[str, list[str]]] = {
    "magnification": {
        "LIF": ["Magnification", "ObjectiveName"],
        "*": ["NominalMagnification", "Magnification", "ObjectiveName", "Objective"],
    },
    "markers": {"*": ["Dyes", "DyeName", "Fluor", "ChannelName"]},
    "date": {"*": ["AcquisitionDate", "CreationDate", "DateTime", "ImageDate"]},
}


def default_map_for(file_format: str) -> dict[str, FieldSource]:
    return dict(DEFAULT_FIELD_MAPS.get(file_format, {}))


def normalize_key_stem(key: str) -> str:
    """Normalize a metadata key into its base semantic stem."""
    if "|" in key:
        key = key.split("|")[-1]
    key = re.sub(r"\s*#\d+$", "", key)
    key = re.sub(r"([a-z])([A-Z])", r"\1 \2", key)
    key = key.replace("_", " ")
    words = key.split()
    if words and words[-1].lower() in {"name", "value", "setting", "settings", "number", "id"}:
        words.pop()
    return "".join(words).lower()


def _is_atomic_value(value: str) -> bool:
    """Return True if value has no whitespace and is either fully numeric or <= 12 chars."""
    if not value or value.isspace() or re.search(r"\s", value):
        return False
    if value.replace(".", "", 1).replace("-", "", 1).isdigit():
        return True
    return len(value) <= 12


def _candidate_sources(
    field_name: str, source: FieldSource | None, file_format: str, image: ImageMetadata
) -> list[FieldSource]:
    candidates: list[FieldSource] = [source] if source else []
    per_field = FALLBACK_KEYS.get(field_name, {})
    tier0_keys = {source.key} if source else set()

    for key in per_field.get(file_format, []) + per_field.get("*", []):
        if key not in tier0_keys:
            transform = source.transform if source else field_name
            candidates.append(
                FieldSource(key, transform if transform in TRANSFORMS else "verbatim")
            )
            tier0_keys.add(key)

    families = {
        "magnification": {"magnification", "nominalmagnification", "objective"},
        "markers": {"dye", "fluor", "channel", "lut"},
        "date": {"acquisitiondate", "creationdate", "datetime", "imagedate", "date"},
    }
    family = families.get(field_name, set())

    if family:
        tier1_keys = [
            key for key in image.keys if key not in tier0_keys and normalize_key_stem(key) in family
        ]

        def sort_key(k: str) -> int:
            val = image.get(k)
            return 0 if val and _is_atomic_value(val) else 1

        tier1_keys.sort(key=sort_key)

        transform = source.transform if source else field_name
        transform = transform if transform in TRANSFORMS else "verbatim"

        if field_name == "markers" and len(tier1_keys) > 1:
            # Multiple sibling keys in the same family (e.g. "ChannelName #0",
            # "#1", "#2") each hold ONE dye name, not a delimited list. Join
            # them into a single candidate so _transform_markers sees every
            # channel, instead of stopping at the first non-empty result and
            # silently dropping the rest.
            candidates.append(FieldSource(tuple(tier1_keys), "markers"))
        else:
            for key in tier1_keys:
                candidates.append(FieldSource(key, transform))

    return candidates


def resolve_fields(
    image: ImageMetadata,
    file_format: str,
    overrides: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """Resolve naming fields from `image`'s keys.

    `overrides` maps a naming field to a metadata key (from a profile), and
    wins over the curated default for that field — the user knows their own
    files better than any shipped table.

    Returns `(fields, key_provenance)`, where `key_provenance` names the exact
    metadata key each value came from, so the UI can show its work.
    """
    mapping = default_map_for(file_format)
    for field_name, key in (overrides or {}).items():
        if field_name in MAPPABLE_FIELDS and key:
            existing = mapping.get(field_name)
            mapping[field_name] = FieldSource(key, existing.transform if existing else "verbatim")

    fields: dict[str, str] = {}
    provenance: dict[str, str] = {}

    for field_name in MAPPABLE_FIELDS:
        for candidate in _candidate_sources(
            field_name, mapping.get(field_name), file_format, image
        ):
            if isinstance(candidate.key, tuple):
                parts = [v for k in candidate.key if (v := image.get(k))]
                raw = ";".join(parts) if parts else None
                provenance_key = ", ".join(candidate.key)
            else:
                raw = image.get(candidate.key)
                provenance_key = candidate.key
            if raw is None:
                continue
            transform = TRANSFORMS.get(candidate.transform, _transform_verbatim)
            value = transform(raw)
            if value:
                fields[field_name] = value
                provenance[field_name] = provenance_key
                break

    return fields, provenance
