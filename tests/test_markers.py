from __future__ import annotations

from microscopy_naming_assistant.markers import alias_map, canonical_markers


def test_alias_map_maps_known_aliases_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["alexa fluor 488"] == "ALEXA488"
    assert mapping["egfp"] == "GFP"
    assert mapping["dapi"] == "DAPI"


def test_every_canonical_is_listed_and_maps_to_itself() -> None:
    canonicals = canonical_markers()
    mapping = alias_map()

    assert len(canonicals) == len(set(canonicals))
    for canonical in canonicals:
        assert canonical in canonicals
        assert mapping[canonical.lower()] == canonical
