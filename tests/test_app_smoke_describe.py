"""AppTest smoke coverage for T10 (A-1 UI): a description may propose
changing an already-populated field, but only ever applies through an
explicit Accept -- never silently, never via a rerun, never via "Apply
tags & preview names".
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app_smoke_utils import boot_app, make_files, preview
from streamlit.testing.v1.app_test import AppTest

from microscopy_naming_assistant.metadata import ExtractionDetail


def _stub_with_populated_magnification(
    file_path: Path,
    timeout_seconds: int = 20,
    extraction_mask: str | None = None,
    field_key_map: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict[str, str], ExtractionDetail]:
    """`magnification` is already populated from real metadata (X2, source
    'metadata') -- the exact shape that made the describer inert before
    T10: a populated field was never even reconsidered."""
    fields = {
        "date": "2024-01-01",
        "exptype": "CT",
        "sample": "E01",
        "magnification": "X2",
        "markers": "DAPI-GFP",
        "notes": "STUB",
    }
    sources = {key: "metadata" for key in fields}
    return dict(fields), dict(sources), ExtractionDetail()


def _set_use_llm(at: AppTest, value: bool) -> AppTest:
    checkbox = next(c for c in at.sidebar.checkbox if c.label == "Use Ollama suggestions")
    checkbox.set_value(value)
    return at.run()


def _set_description(at: AppTest, text: str) -> AppTest:
    at.text_area(key="experiment_description").set_value(text)
    return at.run()


def _click_suggest_with_llm(at: AppTest) -> AppTest:
    button = next(b for b in at.button if b.label == "Suggest missing fields with LLM")
    button.click()
    return at.run()


def _boot_and_preview_one_file(monkeypatch, tmp_path: Path, recorder: list) -> AppTest:
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])
    at = boot_app(
        monkeypatch,
        tmp_path,
        extraction=_stub_with_populated_magnification,
        request_recorder=recorder,
    )
    preview(at, input_dir)
    assert len(at.exception) == 0
    at = _set_use_llm(at, True)
    return at


@pytest.mark.smoke
def test_accepting_a_proposal_actually_changes_the_field_and_the_target_name(
    tmp_path: Path, monkeypatch
) -> None:
    """End-to-end proof of A-1: a description disagreeing with an already-
    populated field produces an Accept-able proposal, and accepting it
    changes the real field value, tags it llm_description, and the
    rendered target name reflects the new value."""
    recorder: list = []
    at = _boot_and_preview_one_file(monkeypatch, tmp_path, recorder)

    at = _set_description(at, "93x objective, not the 2x it currently says")
    monkeypatch.setattr(
        "microscopy_naming_assistant.llm.suggest_fields_with_ollama",
        lambda **kwargs: {"magnification": "X40"},
    )
    at = _click_suggest_with_llm(at)
    assert len(at.exception) == 0

    accept_button = next(b for b in at.button if b.label == "Accept" and "alpha.tif" in str(b.key))
    accept_button.click()
    at = at.run()
    assert len(at.exception) == 0

    suggestions = at.session_state["suggestions"]
    assert len(suggestions) == 1
    result = suggestions[0]
    assert result.fields["magnification"] == "X40"
    assert result.sources["magnification"] == "llm_description"
    assert "X40" in result.target_name
    assert "X2" not in result.target_name


@pytest.mark.smoke
def test_not_accepting_a_proposal_leaves_the_original_value_untouched(
    tmp_path: Path, monkeypatch
) -> None:
    """A proposal that is never accepted (rejected, or simply left pending)
    must never be applied by any other path -- not by a rerun, not by
    anything else on the page."""
    recorder: list = []
    at = _boot_and_preview_one_file(monkeypatch, tmp_path, recorder)

    at = _set_description(at, "93x objective, not the 2x it currently says")
    monkeypatch.setattr(
        "microscopy_naming_assistant.llm.suggest_fields_with_ollama",
        lambda **kwargs: {"magnification": "X40"},
    )
    at = _click_suggest_with_llm(at)
    assert len(at.exception) == 0

    # A pending proposal must exist and be visibly rendered...
    rendered = [w.value for w in at.markdown] + [w.value for w in at.text]
    assert any("X2" in w and "X40" in w for w in rendered)

    # ...but nothing has been applied: another rerun alone must not apply it.
    at = at.run()
    assert len(at.exception) == 0
    suggestions = at.session_state["suggestions"]
    assert suggestions[0].fields["magnification"] == "X2"
    assert suggestions[0].sources["magnification"] == "metadata"

    reject_button = next(b for b in at.button if b.label == "Reject" and "alpha.tif" in str(b.key))
    reject_button.click()
    at = at.run()
    assert len(at.exception) == 0
    suggestions = at.session_state["suggestions"]
    assert suggestions[0].fields["magnification"] == "X2"
    assert suggestions[0].sources["magnification"] == "metadata"
    assert st_session_pending_is_empty(at)


def st_session_pending_is_empty(at: AppTest) -> bool:
    if "pending_overrides" not in at.session_state:
        return True
    pending = at.session_state["pending_overrides"]
    return not any(pending.values())


@pytest.mark.smoke
def test_no_description_never_proposes_an_override_even_if_model_disagrees(
    tmp_path: Path, monkeypatch
) -> None:
    """With NO description typed, a populated field must never be proposed
    for override, even when the stubbed model returns a disagreeing value --
    the guardrail this whole feature must never weaken."""
    recorder: list = []
    at = _boot_and_preview_one_file(monkeypatch, tmp_path, recorder)

    # No description typed. Model would happily disagree if asked.
    monkeypatch.setattr(
        "microscopy_naming_assistant.llm.suggest_fields_with_ollama",
        lambda **kwargs: {"magnification": "X40"},
    )
    at = _click_suggest_with_llm(at)
    assert len(at.exception) == 0

    suggestions = at.session_state["suggestions"]
    assert suggestions[0].fields["magnification"] == "X2"
    assert suggestions[0].sources["magnification"] == "metadata"
    assert st_session_pending_is_empty(at)
    assert not any(b.label == "Accept" for b in at.button)
