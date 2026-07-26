from __future__ import annotations

from unittest.mock import Mock

import microscopy_naming_assistant.llm as llm


def test_resolve_model_uses_requested_value() -> None:
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="llama3.1:8b",
        timeout_seconds=5,
    )
    assert resolved == "llama3.1:8b"


def test_resolve_model_auto_prefers_available(monkeypatch) -> None:
    monkeypatch.setattr(
        llm,
        "list_local_ollama_models",
        lambda endpoint, timeout_seconds=5: ["phi3:mini", "mistral:7b"],
    )
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["llama3.1:8b", "phi3:mini"],
    )
    assert resolved == "phi3:mini"


def test_suggest_fields_returns_empty_on_request_failure(monkeypatch) -> None:
    def _boom(*args, **kwargs):
        raise RuntimeError("network")

    monkeypatch.setattr(llm.requests, "post", _boom)
    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
    )
    assert result == {}


def test_suggest_fields_filters_allowed_keys(monkeypatch) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "message": {"content": '{"sample":"E03","notes":"GOOD","ignored":"x"}'}
    }
    monkeypatch.setattr(llm.requests, "post", lambda *args, **kwargs: response)

    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
    )
    assert result == {"sample": "E03", "notes": "GOOD"}


def _captured_prompt_text(captured_payload: dict) -> str:
    return " ".join(str(m.get("content", "")) for m in captured_payload["messages"])


def test_suggest_fields_includes_user_description_in_prompt(monkeypatch) -> None:
    captured: dict = {}

    def _capture_post(url, json=None, timeout=None):
        captured["payload"] = json
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"message": {"content": "{}"}}
        return response

    monkeypatch.setattr(llm.requests, "post", _capture_post)

    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
        user_description="stained for GFP and DAPI",
    )

    assert result == {}
    prompt_text = _captured_prompt_text(captured["payload"])
    assert "stained for GFP and DAPI" in prompt_text


def test_suggest_fields_includes_file_metadata_in_prompt(monkeypatch) -> None:
    captured: dict = {}

    def _capture_post(url, json=None, timeout=None):
        captured["payload"] = json
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"message": {"content": "{}"}}
        return response

    monkeypatch.setattr(llm.requests, "post", _capture_post)

    llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
        metadata_text="ObjectiveName = HC PL APO 93x\nChannelName #0 = GFP green",
    )

    prompt_text = _captured_prompt_text(captured["payload"])
    assert "HC PL APO 93x" in prompt_text
    assert "GFP green" in prompt_text


def test_suggest_fields_truncates_huge_metadata_blob(monkeypatch) -> None:
    # A vendor XML dump must not blow a small local model's context window.
    captured: dict = {}

    def _capture_post(url, json=None, timeout=None):
        captured["payload"] = json
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"message": {"content": "{}"}}
        return response

    monkeypatch.setattr(llm.requests, "post", _capture_post)

    llm.suggest_fields_with_ollama(
        current_fields={},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
        metadata_text="X" * (llm.MAX_PROMPT_METADATA_CHARS * 3),
    )

    prompt_text = _captured_prompt_text(captured["payload"])
    assert "[truncated]" in prompt_text
    assert len(prompt_text) < llm.MAX_PROMPT_METADATA_CHARS * 2


def test_suggest_fields_prompt_contains_guardrail_language(monkeypatch) -> None:
    captured: dict = {}

    def _capture_post(url, json=None, timeout=None):
        captured["payload"] = json
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"message": {"content": "{}"}}
        return response

    monkeypatch.setattr(llm.requests, "post", _capture_post)

    llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
    )

    prompt_text = _captured_prompt_text(captured["payload"])
    # Robust substring checks for the guardrail philosophy, not brittle exact wording.
    assert "OMIT" in prompt_text
    assert "do not" in prompt_text.lower()
    assert "do not invent facts" in prompt_text.lower()
    for key in ("date", "exptype", "sample", "magnification", "markers", "notes"):
        assert key in prompt_text
