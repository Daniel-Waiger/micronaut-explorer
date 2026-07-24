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
