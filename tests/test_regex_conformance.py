from __future__ import annotations

import json
import re
from pathlib import Path

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "regex_conformance.json"


def _load_fixtures() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_fullmatch_agrees_with_the_shared_regex_conformance_fixture() -> None:
    for case in _load_fixtures():
        pattern, input_str, expected = case["pattern"], case["input"], case["expected"]
        actual = re.fullmatch(pattern, input_str) is not None
        assert actual is expected, f"pattern={pattern!r} input={input_str!r}"


def test_landmine_cases_prove_the_portability_gap_is_real() -> None:
    # The fixture MUST contain at least one case where a naive unanchored
    # search (re.search) would give the WRONG answer, and re.fullmatch the
    # correct one -- this proves the fixture actually exercises the
    # Python/JS anchoring landmine rather than only trivial patterns.
    landmines = [case for case in _load_fixtures() if case.get("landmine")]
    assert landmines, "fixture must contain at least one landmine case"
    for case in landmines:
        pattern, input_str, expected = case["pattern"], case["input"], case["expected"]
        naive = re.search(pattern, input_str) is not None
        correct = re.fullmatch(pattern, input_str) is not None
        assert correct is expected
        assert naive is not expected, "landmine case must trip up a naive unanchored search"
