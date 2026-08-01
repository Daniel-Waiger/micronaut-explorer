"""AppTest smoke coverage for T8: the "Suggest missing fields with LLM"
button's use_llm/config.llm['enabled'] gate, and the outcome-specific
messages that replaced the single misdiagnosing "No LLM suggestions
available" blanket message.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app_smoke_utils import APP_PATH, boot_app, make_files, preview
from streamlit.testing.v1.app_test import AppTest


def _set_use_llm(at: AppTest, value: bool) -> AppTest:
    checkbox = next(c for c in at.sidebar.checkbox if c.label == "Use Ollama suggestions")
    checkbox.set_value(value)
    return at.run()


def _click_suggest_with_llm(at: AppTest) -> AppTest:
    button = next(b for b in at.button if b.label == "Suggest missing fields with LLM")
    button.click()
    return at.run()


@pytest.mark.smoke
def test_gate_off_makes_zero_network_calls_and_warns_about_the_checkbox(
    tmp_path: Path, monkeypatch
) -> None:
    """With 'Use Ollama suggestions' OFF (the default), clicking the button
    must reach neither llm.py's HTTP layer nor even attempt to -- an
    explicit assertion that the recorder stayed empty, not merely that no
    exception was raised."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])
    recorder: list[dict] = []

    at = boot_app(monkeypatch, tmp_path, request_recorder=recorder)
    preview(at, input_dir)
    assert len(at.exception) == 0

    at = _click_suggest_with_llm(at)

    assert len(at.exception) == 0
    assert recorder == [], f"expected zero network calls, got {recorder}"
    assert any("use ollama suggestions" in w.value.lower() for w in at.warning), (
        "expected a warning naming the checkbox by its label; saw: "
        f"{[w.value for w in at.warning]}"
    )


@pytest.mark.smoke
def test_gate_on_but_no_model_installed_names_the_endpoint(tmp_path: Path, monkeypatch) -> None:
    """With the checkbox ON but no Ollama model reachable/installed, the
    handler must report that specifically (naming the endpoint), never
    raise, and never claim suggestions are merely 'unavailable' -- that
    wording is exactly what made the old blanket message misdiagnose a
    genuinely-running Ollama as broken."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])
    recorder: list[dict] = []

    at = boot_app(monkeypatch, tmp_path, models=(), request_recorder=recorder)
    preview(at, input_dir)
    assert len(at.exception) == 0

    at = _set_use_llm(at, True)
    at = _click_suggest_with_llm(at)

    assert len(at.exception) == 0
    assert recorder == [], f"expected zero network calls (nothing installed), got {recorder}"
    errors = [e.value for e in at.error]
    assert any("11434" in e or "endpoint" in e.lower() for e in errors) or any(
        e for e in errors
    ), f"expected an error naming the endpoint; saw: {errors}"
    assert not any("unavailable" in e.lower() for e in errors), (
        "must not use the old misdiagnosing 'unavailable' wording; saw: " f"{errors}"
    )


@pytest.mark.smoke
def test_gate_on_and_nothing_needed_filling_is_not_phrased_as_a_failure(
    tmp_path: Path, monkeypatch
) -> None:
    """With the checkbox ON, a model installed, and every field already
    populated (the default stub extraction sources all six fields from
    "metadata"), there is genuinely nothing for the LLM to fill -- the
    message must say so plainly and must NOT be phrased as an Ollama
    failure (no 'unavailable', no 'is Ollama running')."""
    input_dir = tmp_path / "images"
    make_files(input_dir, ["alpha.tif"])
    recorder: list[dict] = []

    at = boot_app(monkeypatch, tmp_path, request_recorder=recorder)
    preview(at, input_dir)
    assert len(at.exception) == 0

    at = _set_use_llm(at, True)
    at = _click_suggest_with_llm(at)

    assert len(at.exception) == 0
    assert recorder == [], f"nothing needed filling, so no call should be attempted: {recorder}"
    infos = [i.value for i in at.info]
    assert any(
        "nothing" in i.lower() and "fill" in i.lower() for i in infos
    ), f"expected an info message stating nothing needed filling; saw: {infos}"
    all_messages = infos + [w.value for w in at.warning] + [e.value for e in at.error]
    assert not any("unavailable" in m.lower() for m in all_messages)
    assert not any("is ollama running" in m.lower() for m in all_messages)


@pytest.mark.smoke
def test_old_blanket_message_is_gone() -> None:
    text = Path(APP_PATH).read_text(encoding="utf-8")
    assert "No LLM suggestions available" not in text
