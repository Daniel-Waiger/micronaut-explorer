"""Cross-language conformance check for web/src/engine/freetext.js's marker
scan against the real Python producer it was ported from.

Per repo lesson 40 (never re-derive a producer's behavior from memory), this
runs the ACTUAL `_extract_markers` over the shared fixture paragraphs used by
web/tests/freetext.test.js, rather than trusting that the JS port matches by
inspection. Marker order is not compared (lesson E3: container/series order
is not stable) -- only the canonical SET.
"""

from __future__ import annotations

import json
from pathlib import Path

from microscopy_naming_assistant.metadata import _extract_markers

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "freetext_conformance.json"


def _load_fixtures() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_python_extractor_agrees_with_the_shared_fixture_expectations() -> None:
    for case in _load_fixtures():
        text, expected = case["text"], case["expectedMarkers"]
        found = _extract_markers(text, hints=[])
        found_set = set(found.split("-")) if found else set()
        assert found_set == set(expected), f"{case['note']}\ntext: {text}"


def test_overlap_resolution_matches_the_documented_defect_fix() -> None:
    # The exact B2/B3 regression case: re.search-style extraction (one match
    # per alias) would silently drop the second, standalone ATTO 647 -- this
    # proves the CURRENT Python producer still gets both, so the JS port's
    # fixture expectation is anchored to real behavior, not a stale memory of it.
    found = _extract_markers("ch1 ATTO 647-N ch2 ATTO 647", hints=[])
    assert set(found.split("-")) == {"ATTO647N", "ATTO647"}
