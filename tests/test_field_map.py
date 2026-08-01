from __future__ import annotations

from microscopy_naming_assistant.field_map import (
    FALLBACK_KEYS,
    _canonical_marker,
    _transform_magnification,
    normalize_key_stem,
    resolve_fields,
)
from microscopy_naming_assistant.metadata_keys import ImageMetadata


def test_unit_anchored_magnification_from_full_objective_strings() -> None:
    assert _transform_magnification("HC PL APO 40x/0.95 DRY") == "X40"
    assert _transform_magnification("HC PL APO CS2 20x/0.75 DRY") == "X20"
    assert _transform_magnification("HC PL APO CS2 63x/1.40 OIL") == "X63"
    assert _transform_magnification("Plan-Apochromat 20x/0.8 M27") == "X20"


def test_bare_number_fallback_for_lif_and_ome_atomic_values() -> None:
    """LIF's atomic `Magnification` key is literally '40'; OME's
    `NominalMagnification` is '63' -- neither has a unit to anchor on, so the
    whole-string bare-number fallback is mandatory, not optional."""
    assert _transform_magnification("40") == "X40"
    assert _transform_magnification("63") == "X63"
    assert _transform_magnification("1.0") == "X1"


def test_non_positive_and_empty_values_return_none() -> None:
    assert _transform_magnification("0") is None
    assert _transform_magnification("") is None


def test_objective_string_never_yields_the_numerical_aperture_or_model_number() -> None:
    """The exact regression this rewrite fixes: taking the first digit run
    anywhere in 'HC PL APO CS2 63x/1.40 OIL' would grab '1' from the NA
    ('/1.40') if it were scanned last-to-first, or '2' from the 'CS2' model
    designation if scanned first-to-first (bug's actual historical shape).
    Neither may ever be the result -- only the unit-anchored '63x' may."""
    result = _transform_magnification("HC PL APO CS2 63x/1.40 OIL")
    assert result == "X63"
    assert result != "X1"
    assert result != "X2"


def test_normalize_key_stem() -> None:
    assert normalize_key_stem("ObjectiveName") == "objective"
    assert normalize_key_stem("Objective") == "objective"
    assert normalize_key_stem("objective_name") == "objective"
    assert normalize_key_stem("ATLConfocalSettingDefinition #0|ObjectiveName") == "objective"


def test_resolve_magnification_atomic_vs_descriptive() -> None:
    # Only ObjectiveName
    image1 = ImageMetadata(0, "s", {"ObjectiveName": "HC PL APO CS2 20x/0.75 DRY"})
    fields1, prov1 = resolve_fields(image1, "LIF")
    assert fields1.get("magnification") == "X20"

    # Both Magnification and ObjectiveName (atomic wins)
    image2 = ImageMetadata(0, "s", {"Magnification": "40", "ObjectiveName": "...20x..."})
    fields2, prov2 = resolve_fields(image2, "LIF")
    assert fields2.get("magnification") == "X40"
    assert prov2.get("magnification") == "Magnification"


def test_vendor_spelled_objective_name_family_match() -> None:
    image = ImageMetadata(0, "s", {"objective_name": "HC PL APO 63x"})
    fields, prov = resolve_fields(image, "LIF")
    assert fields.get("magnification") == "X63"
    assert prov.get("magnification") == "objective_name"


def test_dyes_and_channel_name_resolves_from_dyes() -> None:
    image = ImageMetadata(0, "s", {"Dyes": "DAPI", "ChannelName": "Green"})
    fields, prov = resolve_fields(image, "LIF")
    assert fields.get("markers") == "DAPI"
    assert prov.get("markers") == "Dyes"


def test_fallback_keys_are_atomic_first() -> None:
    # Verify that in FALLBACK_KEYS['magnification'], Magnification comes before ObjectiveName
    for keys_list in FALLBACK_KEYS["magnification"].values():
        if "Magnification" in keys_list and "ObjectiveName" in keys_list:
            assert keys_list.index("Magnification") < keys_list.index("ObjectiveName")


def test_canonical_marker_finds_alias_word_in_free_text_label() -> None:
    """A per-channel value is often a short label, not a bare dye name -- e.g.
    an ImageJ 'ChannelName #0 = GFP green'. Neither the direct nor the
    compacted-whitespace lookup matches "GFP green" as a whole, so this must
    fall back to scanning for a known alias as a whole word within it."""
    assert _canonical_marker("GFP green") == "GFP"
    assert _canonical_marker("DAPI blue") == "DAPI"
    assert _canonical_marker("Alexa Fluor 488 channel") == "ALEXA488"


def test_multiple_channel_name_siblings_join_into_one_markers_candidate() -> None:
    """The exact regression this fixes: family-matching newly discovers
    indexed sibling keys ("ChannelName #0", "#1", ...) that the old
    exact-string FALLBACK_KEYS never matched (its literal "ChannelName" entry
    has no "#0" suffix). Offering each sibling as its own single-shot
    candidate to a first-non-empty-wins resolver locked onto channel 0's raw
    value alone -- "GFP green" run through the "markers" transform (which
    expects a ";"-delimited list, like the pre-joined "Dyes" key) produced
    the mangled token "GFPGREEN", and channel 1 ("DAPI blue") was never even
    reached, silently dropping a real second marker."""
    image = ImageMetadata(0, "s", {"ChannelName #0": "GFP green", "ChannelName #1": "DAPI blue"})
    fields, prov = resolve_fields(image, "TIFF")
    assert set(fields.get("markers", "").split("-")) == {"GFP", "DAPI"}
    assert "GFPGREEN" not in fields.get("markers", "")
    assert prov.get("markers") == "ChannelName #0, ChannelName #1"


def test_single_channel_name_sibling_is_not_wrapped_in_a_tuple() -> None:
    """Exactly one matching sibling key must resolve like any other single
    key (str, not tuple) -- the join path only applies when there is
    something to join."""
    image = ImageMetadata(0, "s", {"ChannelName #0": "GFP green"})
    fields, prov = resolve_fields(image, "TIFF")
    assert fields.get("markers") == "GFP"
    assert prov.get("markers") == "ChannelName #0"


def test_curated_dyes_key_still_wins_over_channel_name_siblings() -> None:
    """E2 regression guard: an image carrying both a curated 'Dyes' key and
    placeholder-shaped per-channel keys must resolve markers from Dyes, not
    get confused into picking up the LUT colour names via the newer
    family-matching tier (the exact shape of the historical GREEN-BLUE-RED
    bug -- see docs/cma-lessons.md E2)."""
    image = ImageMetadata(
        0,
        "s",
        {
            "Dyes": "Leica/ALEXA 488;Leica/DAPI",
            "ChannelName #0": "Green",
            "ChannelName #1": "Blue",
        },
    )
    fields, prov = resolve_fields(image, "LIF")
    assert fields.get("markers") == "ALEXA488-DAPI"
    assert prov.get("markers") == "Dyes"
