from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT_SCRIPT = ROOT / "tools" / "export_markers_kb.py"
COMMITTED_MARKERS_JSON = ROOT / "web" / "kb" / "markers.json"

_spec = importlib.util.spec_from_file_location("export_markers_kb", EXPORT_SCRIPT)
export_markers_kb = importlib.util.module_from_spec(_spec)
sys.modules["export_markers_kb"] = export_markers_kb
_spec.loader.exec_module(export_markers_kb)


def test_committed_markers_json_matches_a_fresh_export_byte_for_byte(tmp_path: Path) -> None:
    """web/kb/markers.json is a GENERATED artifact, never hand-edited (repo
    lesson 40): a markers.py edit that is not re-exported must fail this
    test rather than silently shipping a stale table."""
    out_path = tmp_path / "markers.json"
    export_markers_kb.write_markers_json(out_path)

    fresh_bytes = out_path.read_bytes()
    committed_bytes = COMMITTED_MARKERS_JSON.read_bytes()
    assert fresh_bytes == committed_bytes, (
        "web/kb/markers.json is stale relative to markers.py -- re-run "
        "`python tools/export_markers_kb.py` and commit the result"
    )


def test_exporter_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    first = tmp_path / "run1.json"
    second = tmp_path / "run2.json"
    export_markers_kb.write_markers_json(first)
    export_markers_kb.write_markers_json(second)
    assert first.read_bytes() == second.read_bytes()

    # build_kb() itself (no filesystem involved) must also be stable.
    assert export_markers_kb.build_kb() == export_markers_kb.build_kb()


def test_ambiguous_aliases_never_leak_into_any_markers_free_text_aliases() -> None:
    kb = export_markers_kb.build_kb()
    ambiguous = set(kb["ambiguousInFreeText"])
    for canonical, entry in kb["markers"].items():
        overlap = ambiguous & set(entry["freeTextAliases"])
        assert not overlap, f"{canonical}: {overlap} leaked into freeTextAliases"


def test_free_text_aliases_is_a_subset_of_aliases_for_every_marker() -> None:
    kb = export_markers_kb.build_kb()
    for canonical, entry in kb["markers"].items():
        assert set(entry["freeTextAliases"]) <= set(entry["aliases"]), canonical


def test_ambiguous_aliases_are_still_present_somewhere_in_the_alias_table() -> None:
    """Ambiguous entries are EXCLUDED from free-text scanning, not deleted --
    they must still resolve via an exact alias lookup somewhere."""
    kb = export_markers_kb.build_kb()
    all_aliases: set[str] = set()
    for entry in kb["markers"].values():
        all_aliases |= set(entry["aliases"])
    for ambiguous in kb["ambiguousInFreeText"]:
        assert ambiguous in all_aliases, ambiguous


def test_family_markers_have_variants_that_are_real_members_of_their_alias_list() -> None:
    kb = export_markers_kb.build_kb()
    for canonical in ("MITOTRACKER", "LYSOTRACKER", "SYTOX", "GCAMP"):
        entry = kb["markers"][canonical]
        assert entry["isFamily"] is True
        assert len(entry["variants"]) > 0
        assert set(entry["variants"]) <= set(entry["aliases"])


def test_bodipy_is_a_family_even_with_no_spelled_out_variants_yet() -> None:
    entry = export_markers_kb.build_kb()["markers"]["BODIPY"]
    assert entry["isFamily"] is True
    assert entry["variants"] == []


def test_tag_and_moiety_classes() -> None:
    kb = export_markers_kb.build_kb()
    for canonical in ("HALO", "SNAP", "CLIP"):
        assert kb["markers"][canonical]["class"] == "tag"
    for canonical in ("PHALLOIDIN", "WGA"):
        assert kb["markers"][canonical]["class"] == "moiety"


def test_protein_and_indicator_classes() -> None:
    kb = export_markers_kb.build_kb()
    proteins = ("GFP", "RFP", "CFP", "YFP", "BFP", "MCHERRY", "TDTOMATO")
    for canonical in proteins:
        assert kb["markers"][canonical]["class"] == "protein"
    for canonical in ("FLUO4", "FURA2", "GCAMP"):
        assert kb["markers"][canonical]["class"] == "indicator"


def test_committed_file_is_valid_json_with_the_documented_shape() -> None:
    data = json.loads(COMMITTED_MARKERS_JSON.read_text(encoding="utf-8"))
    assert data["version"] == 1
    assert isinstance(data["markers"], dict) and len(data["markers"]) > 0
    assert isinstance(data["ambiguousInFreeText"], list)
    for canonical, entry in data["markers"].items():
        assert isinstance(entry["aliases"], list) and entry["aliases"], canonical
        assert set(entry["freeTextAliases"]) <= set(entry["aliases"]), canonical
        assert entry["class"] in {"dye", "protein", "tag", "moiety", "stain", "indicator"}
        assert isinstance(entry["isFamily"], bool)
        assert isinstance(entry["variants"], list)
