"""Every web/kb/*.json file parses, and web/kb/advisor.json matches its
documented shape.

Why this exists as a PYTHON test even though CI's web-test job already runs
`node --test web/tests/*.test.js` (which includes web/tests/advisor.test.js's
much more thorough field-by-field validation of advisor.json's loader,
web/src/engine/advisor.js): CI's `test` job (the one this file lives under)
runs only `pytest` against a short explicit list of files
(.github/workflows/ci.yml), so this shallow shape check is what makes a
malformed web/kb/*.json (a trailing comma, a rule missing a required key)
fail fast in that job specifically, rather than only in web-test -- belt and
suspenders across the two jobs, not a substitute for either.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KB_DIR = ROOT / "web" / "kb"
ADVISOR_JSON = KB_DIR / "advisor.json"

REQUIRED_RULE_KEYS = {"id", "surfaces", "kind", "concept", "title", "body", "when"}
KNOWN_KINDS = {"pitfall", "tip"}
# Mirrors ADVICE_SURFACES in web/src/engine/advisor.js. Kept as a local
# literal, not imported (this is Python; that module is JS) -- if the two
# ever diverge, web/tests/advisor.test.js's surface-acceptance tests are the
# ones that will actually catch it.
KNOWN_SURFACES = {"describe", "design", "naming", "panel"}


def test_every_kb_json_file_parses() -> None:
    kb_files = sorted(KB_DIR.glob("*.json"))
    assert kb_files, f"expected at least one *.json file under {KB_DIR}"
    for f in kb_files:
        try:
            json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise AssertionError(f"{f} is not valid JSON: {exc}") from exc


def test_advisor_json_has_the_documented_top_level_shape() -> None:
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    assert isinstance(data, dict), "advisor.json must be an object, not a bare array"
    assert data.get("version") == 1
    assert isinstance(data.get("rules"), list), "advisor.json must have a 'rules' array"


def test_every_advisor_rule_carries_the_required_keys() -> None:
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    for rule in data["rules"]:
        assert isinstance(rule, dict), f"rule entry is not an object: {rule!r}"
        missing = REQUIRED_RULE_KEYS - rule.keys()
        assert not missing, f"rule {rule.get('id', '<no id>')!r} is missing keys: {missing}"


def test_every_advisor_rule_id_is_a_unique_lowercase_slug() -> None:
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    seen: set[str] = set()
    for rule in data["rules"]:
        rule_id = rule["id"]
        assert isinstance(rule_id, str) and rule_id, f"rule has a non-string/empty id: {rule_id!r}"
        assert rule_id == rule_id.lower(), f"rule id {rule_id!r} must be lowercase"
        assert rule_id not in seen, f"duplicate rule id: {rule_id!r}"
        seen.add(rule_id)


def test_every_advisor_rule_kind_and_surfaces_are_known() -> None:
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    for rule in data["rules"]:
        assert rule["kind"] in KNOWN_KINDS, f"rule {rule['id']!r} has unknown kind {rule['kind']!r}"
        surfaces = rule["surfaces"]
        assert isinstance(surfaces, list) and surfaces, f"{rule['id']!r}: empty/non-list surfaces"
        unknown = set(surfaces) - KNOWN_SURFACES
        assert not unknown, f"rule {rule['id']!r} references unknown surface(s): {unknown}"


def test_every_advisor_rule_concept_is_a_non_empty_string() -> None:
    # The concept names the phenomenon a note is about ("spectral spillover")
    # -- its reason for existing, as opposed to `when`, which only says when
    # it applies. Required, and checked here because this is the gate CI
    # actually runs.
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    for rule in data["rules"]:
        concept = rule["concept"]
        assert (
            isinstance(concept, str) and concept.strip()
        ), f"rule {rule['id']!r} has an empty or non-string concept: {concept!r}"


def test_every_advisor_rule_body_is_substantive() -> None:
    # Mirrors MIN_ADVICE_BODY_LENGTH in web/src/engine/advisor.js -- the
    # mechanical enforcement of "the why, not just the what."
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    for rule in data["rules"]:
        body = rule["body"]
        assert (
            isinstance(body, str) and len(body) >= 40
        ), f"rule {rule['id']!r} has a body under 40 characters: {body!r}"


def test_every_advisor_rule_has_a_non_trivial_when_predicate() -> None:
    # The loader's own most important guard (missing `when`, or `when: true`,
    # would mean permanent unconditional advice) -- pinned here too since
    # this is the check that actually runs on every push.
    data = json.loads(ADVISOR_JSON.read_text(encoding="utf-8"))
    for rule in data["rules"]:
        when = rule["when"]
        assert when is not None, f"rule {rule['id']!r} has when: null"
        assert (
            when is not True
        ), f"rule {rule['id']!r} has when: true (always fires -- must be a real condition)"
