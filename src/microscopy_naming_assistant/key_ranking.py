"""Rank a container's ~95 harvested metadata keys down to the handful worth
showing a user by default.

Measured on a real 4-series Leica LIF: 95 keys per series, only 26 vary
across series at all, and most of THOSE are long floats
(`Begin=1.26582981665594E-04`, `StagePosX=0.05173623815947`) useless as
filename tokens. The genuinely useful set is closer to 8 keys. Scanning the
raw list to find them is exactly the "sifting through mountains of
information" this module exists to replace.

Three independent axes decide a key's tier:
  (a) DISCRIMINATING -- does the value differ across the images in this
      container? A key that reads the same everywhere can't tell one image
      from another (though it may still be a fine constant to display).
  (b) YIELDS A CLEAN TOKEN -- run the value through the SAME transform
      field_map.py would use to turn it into a filename fragment, and
      reject anything that wouldn't actually make a usable token (empty,
      scientific notation, a long float, a bare boolean-ish flag, or too
      long to be a sane filename component).
  (c) SEMANTICALLY NAMED -- does the key's normalized stem (field_map's
      `normalize_key_stem`, reused rather than duplicated) match a family a
      user would recognize as naming-relevant?

Pure functions only: no I/O, no Streamlit, no file reading. Callers pass in
the per-image raw key dicts (`SuggestionResult.image_key_paths`) themselves.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .field_map import TRANSFORMS, normalize_key_stem

# The semantic stems this module recognizes as naming-relevant.
#
# "series" is not one of the stems named in this module's original spec, but
# it MUST be here: normalize_key_stem strips a trailing "Name" suffix (the
# same rule that turns "ObjectiveName" into "objective"), so "SeriesName" --
# the single most common per-image identity key across every format this
# tool reads -- normalizes to "series", never to "name". A bare "Name" key
# with nothing before it normalizes to "" (empty), so the literal stem
# "name" can never actually be produced by normalize_key_stem for any real
# key; it is kept here only so a hypothetical bare "Name" key (matched via
# the empty-stem special case below) still has somewhere to map to.
#
# Matched tolerant of simple plurals (`_resolve_stem_info` also tries the
# singular), since normalize_key_stem does not strip trailing "s" -- "Dyes"
# normalizes to "dyes", not "dye".
SUGGESTED_STEMS: frozenset[str] = frozenset(
    {
        "objective",
        "magnification",
        "dye",
        "channel",
        "zoom",
        "name",
        "series",
        "sections",
        "date",
        "sample",
    }
)

# stem -> (naming field this key most likely feeds, TRANSFORMS entry to test
# it with). A stem with no real naming-field equivalent (zoom, sections) still
# gets the generic "token" transform -- informative even without a field.
# Every member of SUGGESTED_STEMS has an entry here; kept as two structures
# (rather than deriving one from the other) because SUGGESTED_STEMS is the
# semantic axis's gate while this table also carries formatting information
# axis (c) doesn't need.
_STEM_INFO: dict[str, tuple[str, str]] = {
    "objective": ("magnification", "magnification"),
    "magnification": ("magnification", "magnification"),
    "dye": ("markers", "markers"),
    "channel": ("markers", "markers"),
    "date": ("date", "date"),
    "sample": ("sample", "token"),
    "name": ("notes", "token"),
    "series": ("notes", "token"),
    "zoom": ("", "token"),
    "sections": ("", "token"),
}

# One table serving both this module's semantic axis (via SUGGESTED_STEMS,
# above) and T11's display grouping (B-4) -- deliberately broader than
# SUGGESTED_STEMS so the long tail of constant/system keys still lands
# somewhere recognizable instead of an undifferentiated "Other" bucket.
KEY_FAMILIES: dict[str, str] = {
    # Optics
    "objective": "Optics",
    "magnification": "Optics",
    "zoom": "Optics",
    "numericalaperture": "Optics",
    "immersion": "Optics",
    "pinhole": "Optics",
    # Channels & dyes
    "dye": "Channels & dyes",
    "channel": "Channels & dyes",
    "fluor": "Channels & dyes",
    "lut": "Channels & dyes",
    # Acquisition
    "date": "Acquisition",
    "acquisitiondate": "Acquisition",
    "exposuretime": "Acquisition",
    "pixeldwelltime": "Acquisition",
    "scanspeed": "Acquisition",
    # Geometry
    "sections": "Geometry",
    "dimension": "Geometry",
    "stagepos": "Geometry",
    "position": "Geometry",
    "zposition": "Geometry",
    # Identity
    "name": "Identity",
    "sample": "Identity",
    "series": "Identity",
    "experimentname": "Identity",
    # System
    "systemserialnumber": "System",
    "microscopemodel": "System",
    "scanmode": "System",
    "bitsize": "System",
    "usersettingname": "System",
}

# Raw-value shapes that make a poor filename token regardless of what
# transform would otherwise run on them.
_SCIENTIFIC_NOTATION = re.compile(r"[eE][-+]?\d")
_MANY_DECIMAL_PLACES = re.compile(r"-?\d+\.\d{4,}")  # more than 3 decimal places
_BARE_FLAG_VALUES = {"0", "1", "-1"}
_MAX_TOKEN_LEN = 24


@dataclass(frozen=True)
class KeyScore:
    """One metadata key's ranking, for one container."""

    key: str
    value: str
    field: str
    token: str
    discriminating: bool
    semantic_family: str
    tier: str  # "suggested" | "varying" | "constant"


def _singularize(stem: str) -> str:
    return stem[:-1] if stem.endswith("s") and len(stem) > 1 else stem


def _resolve_stem_info(stem: str) -> tuple[str, str] | None:
    """Axis (c): does `stem` (or its singular) match a known family?

    Gates on SUGGESTED_STEMS membership specifically -- that IS the semantic
    axis -- then looks up formatting info for it, falling back to the
    generic "token" transform with no specific naming field if a matched
    stem somehow lacks its own _STEM_INFO entry, rather than silently
    treating a recognized stem as non-semantic.
    """
    for candidate in (stem, _singularize(stem)):
        if candidate in SUGGESTED_STEMS:
            return _STEM_INFO.get(candidate, ("", "token"))
    return None


def family_for(key: str) -> str:
    """Display group for `key`, for B-4's grouping. 'Other' if unmatched."""
    stem = normalize_key_stem(key)
    if stem in KEY_FAMILIES:
        return KEY_FAMILIES[stem]
    return KEY_FAMILIES.get(_singularize(stem), "Other")


def _clean_token(transform_name: str, raw: str) -> str:
    """Run `raw` through the named transform; "" if it wouldn't make a
    usable filename token (see module docstring, axis (b))."""
    stripped = raw.strip()
    if not stripped:
        return ""
    if _SCIENTIFIC_NOTATION.search(stripped):
        return ""
    if _MANY_DECIMAL_PLACES.fullmatch(stripped):
        return ""
    if stripped in _BARE_FLAG_VALUES:
        return ""

    transform = TRANSFORMS.get(transform_name, TRANSFORMS["token"])
    token = transform(raw)
    if not token or len(token) > _MAX_TOKEN_LEN:
        return ""
    return token


def rank_keys(images: list[dict[str, str]], file_format: str) -> list[KeyScore]:
    """Score every key harvested across `images` (one raw key dict per
    image/series) on the three axes described in the module docstring.

    `file_format` is accepted for a future per-format tuning hook but not
    yet used to vary scoring -- the three axes are format-agnostic today.
    """
    del file_format  # not yet used; kept in the signature for a future hook

    if not images:
        return []

    all_keys: set[str] = set()
    for image in images:
        all_keys.update(image.keys())

    # Fewer than 2 images: nothing CAN vary between them, so every key counts
    # as discriminating rather than emptying the suggested tier for a
    # perfectly ordinary single-image file.
    single_image = len(images) < 2

    scores: list[KeyScore] = []
    for key in sorted(all_keys):
        values_seen = {image[key] for image in images if key in image}
        discriminating = single_image or len(values_seen) > 1
        value = next((image[key] for image in images if key in image), "")

        stem = normalize_key_stem(key)
        info = _resolve_stem_info(stem)
        if info is not None:
            field_name, transform_name = info
            token = _clean_token(transform_name, value)
        else:
            field_name, token = "", ""

        semantic = info is not None
        family = family_for(key)

        if discriminating and semantic and token:
            tier = "suggested"
        elif discriminating:
            tier = "varying"
        else:
            tier = "constant"

        scores.append(
            KeyScore(
                key=key,
                value=value,
                field=field_name,
                token=token,
                discriminating=discriminating,
                semantic_family=family,
                tier=tier,
            )
        )

    return scores
