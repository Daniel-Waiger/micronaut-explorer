from __future__ import annotations

import microscopy_naming_assistant.metadata as metadata_mod
from microscopy_naming_assistant.field_map import _canonical_marker
from microscopy_naming_assistant.markers import (
    AMBIGUOUS_IN_FREE_TEXT,
    MARKER_ALIASES,
    alias_map,
    canonical_markers,
)
from microscopy_naming_assistant.metadata import _extract_markers


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


def test_no_alias_collides_across_two_different_canonicals() -> None:
    """Every alias (and each canonical's own lowercased spelling) must map to
    exactly one canonical. alias_map() silently lets a later dict entry
    overwrite an earlier one, so a collision here would be invisible without
    this check."""
    owner: dict[str, str] = {}
    collisions: list[tuple[str, str, str]] = []
    for canonical, aliases in MARKER_ALIASES.items():
        for spelling in [canonical.lower(), *[a.lower() for a in aliases]]:
            if spelling in owner and owner[spelling] != canonical:
                collisions.append((spelling, owner[spelling], canonical))
            owner[spelling] = canonical
    assert collisions == []


def test_no_boundary_prefix_collision_across_two_different_canonicals() -> None:
    """A stronger collision check than the identical-alias-string test above.

    The identical-string test can only see two canonicals owning the exact
    same spelling. It cannot see the shape that actually shipped a defect:
    alias A (from canonical X) is a strict PREFIX of alias B (from a
    DIFFERENT canonical Y), and the character in B immediately following A's
    length is a non-word character. Because `_extract_markers` matches with
    `\\b...\\b` word boundaries, a non-word character there means A's own
    trailing boundary is satisfied too, so BOTH aliases match starting at the
    same index in real text -- e.g. "atto 647" (ATTO647) is a prefix of
    "atto 647-n" (ATTO647N) and is followed by "-", so real text like
    "ATTO 647-N" matched both aliases at start 0 before this was fixed.

    (Contrast with "sox"/"sox2" or "cy3"/"cy35", where the character right
    after the shorter alias is a WORD character -- \\b then blocks the
    shorter alias entirely, so those are not collisions of this shape and
    correctly do not appear below.)

    Some such pairs are inherent to the domain (ATTO647/ATTO647N will always
    have this relationship -- "647" really is a prefix of "647n") and can't
    be designed away in the alias table, so this test does not outlaw the
    shape outright. Instead, for every pair it finds, it feeds the LONGER
    alias's literal spelling to `_extract_markers` and asserts the
    resolver's structural longest-match-wins guarantee actually holds: the
    longer, more specific canonical must be the one returned, and the
    shorter canonical must NOT also appear alongside it.

    Proven load-bearing by execution against the ORIGINAL shipped state
    (pre-fix `_extract_markers` -- sort by start index alone, dedup by
    canonical only, no span-overlap check -- with `ATTO647N`'s aliases as
    they originally shipped): this test's own pair-detection loop still
    finds the ("atto 647", ATTO647) / ("atto 647-n", ATTO647N) pair (that
    part of the alias table is unchanged by this task), but feeding
    "atto 647-n" through the ORIGINAL `_extract_markers` returns
    "ATTO647-ATTO647N" instead of "ATTO647N" alone, so `canon_a in markers`
    trips and the test fails. Restoring the shipped `_extract_markers` fix
    makes it pass again -- confirming the span-overlap suppression, not the
    alias table, is what this test is actually exercising. (Reverting only
    the alias table's new "atto647-n" spelling, with the fixed
    `_extract_markers` still in place, does NOT fail this test, since the
    structural fix alone already resolves the existing "atto 647" /
    "atto 647-n" pair correctly -- the missing-alias/dropped-N failure mode
    is instead covered explicitly by
    test_atto647_hyphen_n_spellings_resolve_to_atto647n_only above.)
    """
    flat: list[tuple[str, str]] = []
    for canonical, aliases in MARKER_ALIASES.items():
        for spelling in [canonical.lower(), *[a.lower() for a in aliases]]:
            flat.append((spelling, canonical))

    pairs: list[tuple[str, str, str, str]] = []
    for alias_a, canon_a in flat:
        for alias_b, canon_b in flat:
            if canon_a == canon_b or alias_a == alias_b:
                continue
            if len(alias_a) >= len(alias_b) or not alias_b.startswith(alias_a):
                continue
            next_char = alias_b[len(alias_a)]
            if not next_char.isalnum():
                pairs.append((alias_a, canon_a, alias_b, canon_b))

    assert pairs, "expected at least the ATTO647/ATTO647N pair(s) to be found"

    unresolved: list[tuple[str, str, str, str, str | None]] = []
    for alias_a, canon_a, alias_b, canon_b in pairs:
        result = _extract_markers(alias_b, [])
        markers = (result or "").split("-")
        if canon_b not in markers or canon_a in markers:
            unresolved.append((alias_a, canon_a, alias_b, canon_b, result))

    assert unresolved == []


# --- Broad extension: representative alias -> canonical mappings ----------


def test_new_alexa_fluor_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["alexa fluor 405"] == "ALEXA405"
    assert mapping["af532"] == "ALEXA532"
    assert mapping["alexa 750"] == "ALEXA750"


def test_new_atto_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["atto488"] == "ATTO488"
    assert mapping["atto 565"] == "ATTO565"
    assert mapping["atto647n"] == "ATTO647N"


def test_janelia_fluor_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["jf549"] == "JF549"
    assert mapping["janelia fluor 646"] == "JF646"


def test_sir_probe_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["sir-tubulin"] == "SIRTUBULIN"
    assert mapping["sir-actin"] == "SIRACTIN"


def test_new_fluorescent_protein_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["mneongreen"] == "MNEONGREEN"
    assert mapping["mscarlet"] == "MSCARLET"
    assert mapping["mturquoise"] == "MTURQUOISE"
    assert mapping["cerulean"] == "CERULEAN"
    assert mapping["venus"] == "VENUS"
    assert mapping["citrine"] == "CITRINE"
    assert mapping["irfp"] == "IRFP"
    assert mapping["mirfp"] == "MIRFP"
    assert mapping["memerald"] == "MEMERALD"
    assert mapping["mruby"] == "MRUBY"


def test_tag_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["halotag"] == "HALO"
    assert mapping["snap-tag"] == "SNAP"
    assert mapping["clip tag"] == "CLIP"


def test_stain_and_probe_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["phalloidin"] == "PHALLOIDIN"
    assert mapping["wga"] == "WGA"
    assert mapping["propidium iodide"] == "PROPIDIUMIODIDE"
    assert mapping["draq5"] == "DRAQ5"
    assert mapping["sytox green"] == "SYTOX"
    assert mapping["mitotracker red"] == "MITOTRACKER"
    assert mapping["lysotracker"] == "LYSOTRACKER"
    assert mapping["er-tracker"] == "ERTRACKER"
    assert mapping["cellmask"] == "CELLMASK"
    assert mapping["bodipy"] == "BODIPY"


def test_calcium_indicator_aliases_map_to_canonical() -> None:
    mapping = alias_map()
    assert mapping["fluo-4"] == "FLUO4"
    assert mapping["fura-2"] == "FURA2"
    assert mapping["gcamp6f"] == "GCAMP"
    assert mapping["calcein"] == "CALCEIN"


def test_pi_abbreviation_was_deliberately_not_added() -> None:
    """See markers.py's deliberately-omitted-aliases note: 'pi' is too
    ambiguous (Principal Investigator, the constant) to map safely."""
    assert "pi" not in alias_map()


# --- False-positive gates: proven by execution against _extract_markers ---


def test_cy3_does_not_match_inside_cy35() -> None:
    result = _extract_markers("sample-CY35-slide1", [])
    assert result is None or "CY3" not in (result.split("-"))


def test_sox_does_not_swallow_sox2() -> None:
    result = _extract_markers("clone SOX2-positive", [])
    assert result is not None
    markers = result.split("-")
    assert "SOX2" in markers
    assert "SOX" not in markers


def test_atto647_does_not_match_inside_atto647n() -> None:
    result = _extract_markers("stained with ATTO647N secondary", [])
    assert result is not None
    markers = result.split("-")
    assert "ATTO647N" in markers
    assert "ATTO647" not in markers


def test_atto647_bare_still_matches_on_its_own() -> None:
    """Confirms ATTO647 is reachable (not merely a dead canonical) when the
    text genuinely says ATTO647 without a trailing N."""
    result = _extract_markers("stained with ATTO647 secondary", [])
    assert result is not None
    assert "ATTO647" in result.split("-")
    assert "ATTO647N" not in result.split("-")


def test_rfp_does_not_match_inside_irfp() -> None:
    """A longer new alias (IRFP) must beat the shorter, pre-existing
    canonical (RFP) it textually contains -- the exact P2-1b regression shape."""
    result = _extract_markers("cells expressing iRFP protein", [])
    assert result is not None
    markers = result.split("-")
    assert "IRFP" in markers
    assert "RFP" not in markers


def test_rfp_and_irfp_do_not_match_inside_mirfp() -> None:
    """A longer new alias (MIRFP) must beat both shorter overlapping
    canonicals (RFP and IRFP) it textually contains."""
    result = _extract_markers("cells expressing miRFP protein", [])
    assert result is not None
    markers = result.split("-")
    assert "MIRFP" in markers
    assert "RFP" not in markers
    assert "IRFP" not in markers


# --- Defect 1 (boundary-prefix collision): ATTO647 vs ATTO647N -------------


def test_atto647_hyphen_n_spellings_resolve_to_atto647n_only() -> None:
    """Both real-world hyphen/space spellings of ATTO647N must yield exactly
    ATTO647N -- never ATTO647 alone (the N silently dropped) and never both
    canonicals joined together (the spurious-extra-marker shape)."""
    for text in [
        "stained with ATTO 647-N secondary antibody",  # space then hyphen-N
        "Fluorophore = Atto647-N",  # no space, hyphen-N
    ]:
        result = _extract_markers(text, [])
        assert result == "ATTO647N", f"{text!r} -> {result!r}"


def test_atto647_plain_spelling_still_resolves_to_atto647() -> None:
    """Plain 'ATTO 647' (no N at all) must still resolve to ATTO647, proving
    the fix didn't just make everything resolve to ATTO647N."""
    for text in ["Fluorophore = ATTO 647", "stained with ATTO647 secondary"]:
        result = _extract_markers(text, [])
        assert result == "ATTO647", f"{text!r} -> {result!r}"


def test_longest_match_wins_regardless_of_alias_dict_insertion_order(monkeypatch) -> None:
    """The tie-break must be STRUCTURAL (sort by (start, -length) + span
    overlap suppression), not an accident of MARKER_ALIASES's insertion
    order. Feed `_extract_markers` the real alias map but with insertion
    order reversed and confirm the ATTO647/ATTO647N repro cases resolve
    identically either way -- under the pre-fix algorithm (sort by start
    index alone, dedup by canonical only, no overlap check) this reordering
    was capable of changing which canonical(s) ended up in the result."""
    forward = metadata_mod.alias_map()
    reversed_map = dict(reversed(list(forward.items())))
    assert list(reversed_map) != list(forward)  # sanity: genuinely reordered

    monkeypatch.setattr(metadata_mod, "alias_map", lambda: reversed_map)

    cases = [
        ("stained with ATTO 647-N secondary antibody", "ATTO647N"),
        ("Fluorophore = Atto647-N", "ATTO647N"),
        ("stained with ATTO647 secondary", "ATTO647"),
    ]
    for text, expected in cases:
        result = metadata_mod._extract_markers(text, [])
        assert result == expected, f"{text!r} -> {result!r} (reversed alias order)"


# --- Defect 3: ambiguous-in-free-text aliases -------------------------------


def test_ambiguous_aliases_are_still_valid_exact_lookup_aliases() -> None:
    """Every AMBIGUOUS_IN_FREE_TEXT entry must still be a real alias in the
    table -- it is excluded from free-text scanning, not deleted."""
    mapping = alias_map()
    for alias in AMBIGUOUS_IN_FREE_TEXT:
        assert alias in mapping, alias


def test_ambiguous_aliases_do_not_false_positive_in_free_text_scanning() -> None:
    """Realistic vendor/camera-software metadata text containing SNAP, HALO,
    VENUS or CITRINE as ordinary instrument vocabulary or common English
    words must NOT produce those markers via the free-text blob/filename
    scan -- this is the exact false-positive risk named in the defect
    report."""
    cases = [
        "Snap Mode: enabled, Live/Snap acquisition",
        "Camera: Snap Shot triggered by user",
        "Objective: HALO 20x lamp housing check",
        "Venus flytrap assay control channel",
        "Citrine acid buffer pH 4.5",
    ]
    for text in cases:
        result = _extract_markers(text, [])
        markers = (result or "").split("-")
        assert "SNAP" not in markers, text
        assert "HALO" not in markers, text
        assert "VENUS" not in markers, text
        assert "CITRINE" not in markers, text


def test_ambiguous_aliases_still_match_in_their_unambiguous_compound_form() -> None:
    """Excluding the bare ambiguous alias must not disable the canonical
    entirely -- its other, unambiguous compound spellings still match in
    free text."""
    assert _extract_markers("cells labeled with HaloTag construct", []) == "HALO"
    assert _extract_markers("SNAP-tag fusion protein expressed", []) == "SNAP"
    assert _extract_markers("imaged with a CLIP-tag reporter", []) == "CLIP"


def test_ambiguous_aliases_still_resolve_via_exact_field_map_lookup() -> None:
    """field_map._canonical_marker does a whole-value dict lookup (never a
    free-text substring scan), so it must still resolve these markers when a
    metadata VALUE is exactly one of them."""
    assert _canonical_marker("Snap") == "SNAP"
    assert _canonical_marker("Halo") == "HALO"
    assert _canonical_marker("Venus") == "VENUS"
    assert _canonical_marker("Citrine") == "CITRINE"


def test_gfp_does_not_match_inside_egfp_tag() -> None:
    result = _extract_markers("construct EGFP-tag fusion", [])
    assert result is not None
    assert "GFP" in result.split("-")
