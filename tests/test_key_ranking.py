"""Tests for T9 (B-2): the pure metadata key ranker.

The synthetic fixture uses REAL key names measured on the production LIF
(Magnification, ObjectiveName, Dyes, SeriesName, Zoom, Sections,
NumericalAperture, InDimension, Begin, StagePosX) with clean illustrative
values (40x/63x objectives), plus ~10 constant instrument/system keys also
drawn from the real file's constant list (BitSize, Immersion,
SystemSerialNumber, ScanMode, MicroscopeModel, ChannelCount, CanDoSTED,
FlipX, FlipY, IsInverseMicroscopeModel).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from microscopy_naming_assistant.key_ranking import KEY_FAMILIES, KeyScore, rank_keys

REAL_LIF_PATH = Path(
    r"C:\Users\Owner\Desktop\sandbox\micronaut\hidden\GnRH1-GFP_42dpf_fish1_20072026.lif"
)

_CONSTANT = {
    "BitSize": "8",
    "Immersion": "DRY",
    "SystemSerialNumber": "8300000294",
    "ScanMode": "xyz",
    "MicroscopeModel": "DMI8-CS",
    "ChannelCount": "3",
    "CanDoSTED": "0",
    "FlipX": "1",
    "FlipY": "1",
    "IsInverseMicroscopeModel": "1",
}


def _fixture_images() -> list[dict[str, str]]:
    """Four images: two at 40x sharing a 2-dye panel, two at 63x sharing a
    3-dye panel -- realistic (a real container's Dyes value varies between
    images mainly by which subset/order of a shared panel each series used,
    not necessarily a wholesale change), and enough to discriminate every
    field the suggested tier is expected to contain."""
    return [
        {
            **_CONSTANT,
            "Magnification": "40",
            "ObjectiveName": "HC PL APO 40x/0.95 DRY",
            "Dyes": "Leica/ALEXA 488;Leica/DAPI",
            "SeriesName": "overview_x40",
            "Zoom": "1.0",
            "Sections": "120",
            "NumericalAperture": "0.95",
            "InDimension": "512",
            "Begin": "1.26582981665594E-04",
            "StagePosX": "0.05173623815947",
            "Channel": "1",  # bare-flag probe: semantic + discriminating, bad value
        },
        {
            **_CONSTANT,
            "Magnification": "40",
            "ObjectiveName": "HC PL APO 40x/0.95 DRY",
            "Dyes": "Leica/ALEXA 488;Leica/DAPI",
            "SeriesName": "overview_x40_merged",
            "Zoom": "1.0",
            "Sections": "120",
            "NumericalAperture": "0.95",
            "InDimension": "512",
            "Begin": "2.5E-04",
            "StagePosX": "0.06",
            "Channel": "1",
        },
        {
            **_CONSTANT,
            "Magnification": "63",
            "ObjectiveName": "HC PL APO CS2 63x/1.40 OIL",
            "Dyes": "Leica/ALEXA 488;Leica/DAPI;Leica/Cy3",
            "SeriesName": "closeup_x63",
            "Zoom": "1.1",
            "Sections": "90",
            "NumericalAperture": "1.40",
            "InDimension": "1024",
            "Begin": "3.7E-04",
            "StagePosX": "0.09",
            "Channel": "2",
        },
        {
            **_CONSTANT,
            "Magnification": "63",
            "ObjectiveName": "HC PL APO CS2 63x/1.40 OIL",
            "Dyes": "Leica/ALEXA 488;Leica/DAPI;Leica/Cy3",
            "SeriesName": "closeup_x63_zoom",
            "Zoom": "1.3",
            "Sections": "85",
            "NumericalAperture": "1.40",
            "InDimension": "1024",
            "Begin": "4.9E-04",
            "StagePosX": "0.11",
            "Channel": "2",
        },
    ]


def _by_tier(scores: list[KeyScore], tier: str) -> dict[str, KeyScore]:
    return {s.key: s for s in scores if s.tier == tier}


def test_suggested_tier_contains_the_core_keys_and_stays_small() -> None:
    scores = rank_keys(_fixture_images(), "LIF")
    suggested = _by_tier(scores, "suggested")

    assert len(suggested) <= 10
    assert "Magnification" in suggested
    assert "Dyes" in suggested
    assert "SeriesName" in suggested


def test_suggested_tier_excludes_long_floats_and_the_bare_flag() -> None:
    scores = rank_keys(_fixture_images(), "LIF")
    suggested = _by_tier(scores, "suggested")

    assert "Begin" not in suggested, "scientific-notation float must not be a token"
    assert "StagePosX" not in suggested, "long float must not be a token"
    assert "Channel" not in suggested, "bare '1'/'2' flag must not be a token"


def test_every_constant_key_lands_in_the_constant_tier() -> None:
    """Nothing is silently dropped -- the full ~95 keys must remain
    reachable, just deprioritized."""
    scores = rank_keys(_fixture_images(), "LIF")
    constant = _by_tier(scores, "constant")

    for key in _CONSTANT:
        assert key in constant, f"{key} (identical across every image) must be in 'constant'"


def test_suggested_and_constant_and_varying_partition_every_key() -> None:
    images = _fixture_images()
    scores = rank_keys(images, "LIF")
    all_keys = {k for image in images for k in image}

    seen = {s.key for s in scores}
    assert seen == all_keys

    tiers = {s.key: s.tier for s in scores}
    assert set(tiers.values()) <= {"suggested", "varying", "constant"}


def test_magnification_token_is_correct_for_both_objectives() -> None:
    """Direct regression tie-in to T1/B-0: the ranker must surface the
    CORRECT unit-anchored token (X40/X63), not the old first-digit-run bug's
    X1/X2."""
    scores = rank_keys(_fixture_images(), "LIF")
    by_key = {s.key: s for s in scores}

    assert by_key["Magnification"].token == "X40"
    assert by_key["ObjectiveName"].token == "X40"


def test_single_image_treats_every_key_as_discriminating() -> None:
    """Fewer than 2 images: nothing CAN vary between them, so a single-image
    file must still get a non-empty suggested tier rather than every key
    being (vacuously) non-discriminating."""
    scores = rank_keys([_fixture_images()[0]], "LIF")
    suggested = [s for s in scores if s.tier == "suggested"]

    assert len(suggested) > 0
    assert all(s.discriminating for s in scores)


def test_empty_images_returns_empty_list() -> None:
    assert rank_keys([], "LIF") == []


def test_key_families_covers_exactly_six_display_groups() -> None:
    groups = set(KEY_FAMILIES.values())
    assert groups == {
        "Optics",
        "Channels & dyes",
        "Acquisition",
        "Geometry",
        "Identity",
        "System",
    }


def test_family_for_returns_other_for_an_unrecognized_key() -> None:
    from microscopy_naming_assistant.key_ranking import family_for

    assert family_for("SomeTotallyUnknownVendorSpecificKey") == "Other"


def test_family_for_matches_known_stems() -> None:
    from microscopy_naming_assistant.key_ranking import family_for

    assert family_for("ObjectiveName") == "Optics"
    assert family_for("Dyes") == "Channels & dyes"
    assert family_for("SeriesName") == "Identity"
    assert family_for("BitSize") == "System"


def test_key_ranking_module_has_no_streamlit_dependency() -> None:
    """Pure module: no I/O, no Streamlit import. Matches this task's exact
    verification command (`grep -c 'streamlit' key_ranking.py` == 0) -- case
    sensitive, so prose mentioning "Streamlit" (capitalized, as a proper
    noun) in a docstring is fine; only an actual `import streamlit` (always
    lowercase) would trip either check."""
    import microscopy_naming_assistant.key_ranking as module

    source = Path(module.__file__).read_text(encoding="utf-8")
    assert "streamlit" not in source


@pytest.mark.integration
@pytest.mark.skipif(
    not REAL_LIF_PATH.exists(), reason="real sample LIF not present on this machine"
)
def test_real_lif_suggested_tier_stays_small_and_useful() -> None:
    """Metadata only -- never touches .data/.get_image_data/.xarray_data."""
    from microscopy_naming_assistant.metadata_keys import harvest

    images = harvest(REAL_LIF_PATH, "LIF")
    scores = rank_keys([dict(image.keys) for image in images], "LIF")
    suggested = _by_tier(scores, "suggested")

    assert len(suggested) <= 10
    assert "Magnification" in suggested
    assert "Dyes" in suggested
