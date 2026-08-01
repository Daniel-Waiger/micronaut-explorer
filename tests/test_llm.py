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
    monkeypatch.setattr(llm, "_detect_vram_gb", lambda: None)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["llama3.1:8b", "phi3:mini"],
    )
    assert resolved == "phi3:mini"


def test_resolve_model_picks_best_installed_not_merely_first_preference(monkeypatch) -> None:
    # Preference order is [best, second, third]; only the SECOND preference is
    # actually installed alongside an unrelated model. Ranking must not settle
    # for installed[0] ("other:model") just because it appears first in the
    # Ollama tags listing.
    monkeypatch.setattr(
        llm,
        "list_local_ollama_models",
        lambda endpoint, timeout_seconds=5: ["other:model", "gemma2:9b"],
    )
    monkeypatch.setattr(llm, "_detect_vram_gb", lambda: None)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["qwen3.5:14b", "gemma2:9b", "phi3:mini"],
    )
    assert resolved == "gemma2:9b"


def test_resolve_model_matches_tag_suffixed_install(monkeypatch) -> None:
    # A real Ollama install commonly carries a build/quantization suffix
    # (e.g. "-instruct-q4_K_M"); the preference list uses the short canonical
    # size tag and must still match it.
    monkeypatch.setattr(
        llm,
        "list_local_ollama_models",
        lambda endpoint, timeout_seconds=5: ["qwen3.5:14b-instruct-q4_K_M"],
    )
    monkeypatch.setattr(llm, "_detect_vram_gb", lambda: None)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["qwen3.5:14b", "gemma2:9b"],
    )
    assert resolved == "qwen3.5:14b-instruct-q4_K_M"


def test_resolve_model_tag_suffix_boundary_is_safe(monkeypatch) -> None:
    # A preference of "qwen3.5:14b" must NOT match an install like
    # "qwen3.5:140b-instruct" -- "14b" is a prefix of "140b" as a raw string,
    # but not as a size token, so the boundary check must reject it.
    monkeypatch.setattr(
        llm,
        "list_local_ollama_models",
        lambda endpoint, timeout_seconds=5: ["qwen3.5:140b-instruct", "qwen3.5:7b"],
    )
    monkeypatch.setattr(llm, "_detect_vram_gb", lambda: None)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["qwen3.5:14b", "qwen3.5:7b"],
    )
    assert resolved == "qwen3.5:7b"


def test_resolve_model_explicit_override_beats_auto_detection(monkeypatch) -> None:
    # Even if a "better" preferred model is installed, an explicit user value
    # (not "auto") is authoritative and must win outright -- resolve_ollama_model
    # must not even consult list_local_ollama_models.
    def _boom(*args, **kwargs):
        raise AssertionError("list_local_ollama_models must not be called for an override")

    monkeypatch.setattr(llm, "list_local_ollama_models", _boom)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="my-custom-model:latest",
        timeout_seconds=5,
        preferred_models=["qwen3.5:14b"],
    )
    assert resolved == "my-custom-model:latest"


def test_resolve_model_prefers_size_that_fits_detected_vram(monkeypatch) -> None:
    # Both a 14B and a 7B model are installed; on an 8 GB-VRAM machine the 14B
    # tier does not fit, so ranking should prefer the 7B model that does,
    # even though 14B ranks higher in plain preference order.
    monkeypatch.setattr(
        llm,
        "list_local_ollama_models",
        lambda endpoint, timeout_seconds=5: ["qwen3.5:14b-q4", "qwen3.5:7b-q4"],
    )
    monkeypatch.setattr(llm, "_detect_vram_gb", lambda: 8.0)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["qwen3.5:14b", "qwen3.5:7b"],
    )
    assert resolved == "qwen3.5:7b-q4"


def test_resolve_model_vram_undetectable_degrades_to_plain_preference_order(monkeypatch) -> None:
    # When VRAM can't be determined (no GPU / nvidia-smi missing / probe
    # error), ranking must still work via plain preference order -- it must
    # never raise or block.
    monkeypatch.setattr(
        llm,
        "list_local_ollama_models",
        lambda endpoint, timeout_seconds=5: ["qwen3.5:14b-q4", "qwen3.5:7b-q4"],
    )
    monkeypatch.setattr(llm, "_detect_vram_gb", lambda: None)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
        preferred_models=["qwen3.5:14b", "qwen3.5:7b"],
    )
    assert resolved == "qwen3.5:14b-q4"


def test_detect_vram_gb_never_raises_when_probe_is_unavailable(monkeypatch) -> None:
    # Simulate the common "no NVIDIA GPU / nvidia-smi not installed" case: the
    # probe must degrade to None, never raise.
    def _missing_binary(*args, **kwargs):
        raise FileNotFoundError("nvidia-smi not found")

    monkeypatch.setattr(llm.subprocess, "run", _missing_binary)
    assert llm._detect_vram_gb() is None


def test_list_local_models_returns_empty_on_connection_refused(monkeypatch) -> None:
    def _refused(*args, **kwargs):
        raise llm.requests.exceptions.ConnectionError("connection refused")

    monkeypatch.setattr(llm.requests, "get", _refused)
    assert llm.list_local_ollama_models(endpoint="http://localhost:11434/api/chat") == []


def test_list_local_models_returns_empty_on_timeout(monkeypatch) -> None:
    def _timeout(*args, **kwargs):
        raise llm.requests.exceptions.Timeout("timed out")

    monkeypatch.setattr(llm.requests, "get", _timeout)
    assert llm.list_local_ollama_models(endpoint="http://localhost:11434/api/chat") == []


def test_list_local_models_returns_empty_on_garbage_response_shape(monkeypatch) -> None:
    # /api/tags returning valid JSON that isn't a dict (e.g. a bare list) must
    # not raise AttributeError from an unguarded .get() call.
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = ["not", "a", "dict"]
    monkeypatch.setattr(llm.requests, "get", lambda *args, **kwargs: response)

    assert llm.list_local_ollama_models(endpoint="http://localhost:11434/api/chat") == []


def test_resolve_model_auto_returns_none_when_ollama_endpoint_raises(monkeypatch) -> None:
    def _boom(*args, **kwargs):
        raise RuntimeError("endpoint refusing connections")

    monkeypatch.setattr(llm.requests, "get", _boom)
    resolved = llm.resolve_ollama_model(
        endpoint="http://localhost:11434/api/chat",
        requested_model="auto",
        timeout_seconds=5,
    )
    assert resolved is None


def test_suggest_fields_returns_empty_on_garbage_json_response_shape(monkeypatch) -> None:
    # A malformed/garbage response body (valid JSON, wrong shape) must degrade
    # to {} rather than raising AttributeError out of the naming path.
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = ["garbage", "not", "a", "dict"]
    monkeypatch.setattr(llm.requests, "post", lambda *args, **kwargs: response)

    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
    )
    assert result == {}


def test_suggest_fields_with_description_degrades_gracefully_on_malformed_response(
    monkeypatch,
) -> None:
    # C1 degraded-mode proof: a malformed/non-JSON model response must not
    # raise into the naming path even when a user_description is supplied --
    # the describer path shares the exact same never-raise contract as the
    # plain metadata-enhancer path.
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"message": {"content": "not json at all {{{"}}
    monkeypatch.setattr(llm.requests, "post", lambda *args, **kwargs: response)

    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
        user_description="stained for GFP and DAPI",
    )
    assert result == {}


def test_suggest_fields_with_description_degrades_gracefully_when_ollama_unreachable(
    monkeypatch,
) -> None:
    def _refused(*args, **kwargs):
        raise llm.requests.exceptions.ConnectionError("connection refused")

    monkeypatch.setattr(llm.requests, "post", _refused)

    result = llm.suggest_fields_with_ollama(
        current_fields={},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
        user_description="stained for GFP and DAPI",
    )
    assert result == {}


def test_suggest_fields_returns_empty_when_content_parses_to_non_dict(monkeypatch) -> None:
    # Content is valid JSON but not an object (e.g. a bare list) -- must not
    # raise AttributeError from .items() on a non-dict.
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"message": {"content": "[1, 2, 3]"}}
    monkeypatch.setattr(llm.requests, "post", lambda *args, **kwargs: response)

    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
    )
    assert result == {}


def test_suggest_fields_returns_empty_on_endpoint_timeout(monkeypatch) -> None:
    def _timeout(*args, **kwargs):
        raise llm.requests.exceptions.Timeout("timed out")

    monkeypatch.setattr(llm.requests, "post", _timeout)
    result = llm.suggest_fields_with_ollama(
        current_fields={"sample": "E01"},
        original_name="a.tif",
        endpoint="http://localhost:11434/api/chat",
        model="llama3.1:8b",
        timeout_seconds=3,
    )
    assert result == {}


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


def test_suggest_fields_prompt_flags_description_as_weakest_evidence(monkeypatch) -> None:
    # C1 (1): the free-text description is structured as strictly weaker
    # evidence than metadata/filename -- the prompt must say so explicitly,
    # not just rely on the generic never-fabricate rules.
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
        user_description="stained for GFP and DAPI",
    )

    prompt_text = _captured_prompt_text(captured["payload"]).lower()
    assert "weakest evidence" in prompt_text
    assert "stained for gfp and dapi" in prompt_text


def test_suggest_fields_prompt_never_states_old_never_override_policy(monkeypatch) -> None:
    # T3 (A-1 policy reversal): the old "a description may never override a
    # populated field" wording must be gone from the prompt entirely -- with
    # or without a description supplied -- so the prompt no longer
    # contradicts the new reviewable-override policy.
    captured: dict = {}

    def _capture_post(url, json=None, timeout=None):
        captured["payload"] = json
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"message": {"content": "{}"}}
        return response

    monkeypatch.setattr(llm.requests, "post", _capture_post)

    for description in (None, "stained for GFP and DAPI"):
        llm.suggest_fields_with_ollama(
            current_fields={"sample": "E01"},
            original_name="a.tif",
            endpoint="http://localhost:11434/api/chat",
            model="llama3.1:8b",
            timeout_seconds=3,
            user_description=description,
        )
        prompt_text = _captured_prompt_text(captured["payload"])
        assert "Never let the description override" not in prompt_text
        assert "only ever fill a field" not in prompt_text


def test_suggest_fields_prompt_with_description_permits_reviewable_override(monkeypatch) -> None:
    # (ii) With a user_description supplied, the prompt must state the new
    # permission (description may replace an already-populated field, but
    # only when it plainly states it) AND still carry the no-fabrication
    # guardrail -- the reversal is scoped to the user's own typed words, not
    # a relaxation of "never fabricate".
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
        user_description="stained for GFP and DAPI",
    )

    prompt_text = _captured_prompt_text(captured["payload"])
    assert "It is the ONE input allowed to replace a value" in prompt_text
    assert "NEVER fabricate" in prompt_text


def test_suggest_fields_prompt_without_description_still_forbids_field_changes(
    monkeypatch,
) -> None:
    # (iii) With no user_description at all, the prompt must still forbid
    # changing any populated field -- the fill-only default is unchanged.
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
    assert "Do NOT change or overwrite any value already present" in prompt_text
    assert "NEVER fabricate" in prompt_text
    # No user_description was passed, so the description block (and its
    # override permission) must not appear in the prompt at all.
    assert "User-provided description" not in prompt_text
