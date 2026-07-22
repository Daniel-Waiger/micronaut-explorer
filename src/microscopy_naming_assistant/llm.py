from __future__ import annotations

import json
import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

DEFAULT_PREFERRED_MODELS = [
    "llama3.1:8b",
    "qwen2.5-coder:7b",
    "phi3:mini",
]


def _to_tags_endpoint(chat_endpoint: str) -> str:
    endpoint = chat_endpoint.rstrip("/")
    if endpoint.endswith("/api/chat"):
        return endpoint[: -len("/api/chat")] + "/api/tags"
    if endpoint.endswith("/api"):
        return endpoint + "/tags"
    return endpoint + "/api/tags"


def list_local_ollama_models(endpoint: str, timeout_seconds: int = 5) -> list[str]:
    """Return locally available Ollama model names.

    Returns an empty list when Ollama is unavailable.
    """
    tags_endpoint = _to_tags_endpoint(endpoint)
    try:
        response = requests.get(tags_endpoint, timeout=timeout_seconds)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logger.warning("Failed to connect to Ollama at %s: %s", tags_endpoint, e)
        return []
    except Exception as e:
        logger.warning("Unexpected error listing Ollama models: %s", e)
        return []

    models = data.get("models", [])
    names: list[str] = []
    for item in models:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if name:
            names.append(name)

    # Keep order from Ollama while removing duplicates.
    return list(dict.fromkeys(names))


def resolve_ollama_model(
    endpoint: str,
    requested_model: str,
    timeout_seconds: int,
    preferred_models: list[str] | None = None,
) -> str | None:
    """Resolve a concrete model name.

    If requested_model is "auto", pick the first preferred model available
    locally, otherwise fallback to the first installed model.
    """
    requested = requested_model.strip()
    if requested and requested.lower() != "auto":
        return requested

    installed = list_local_ollama_models(endpoint=endpoint, timeout_seconds=timeout_seconds)
    if not installed:
        return None

    preferred = preferred_models or DEFAULT_PREFERRED_MODELS
    installed_set = set(installed)
    for candidate in preferred:
        if candidate in installed_set:
            return candidate

    return installed[0]


def suggest_fields_with_ollama(
    current_fields: dict[str, str],
    original_name: str,
    endpoint: str,
    model: str,
    timeout_seconds: int,
    preferred_models: list[str] | None = None,
) -> dict[str, str]:
    """Ask a local/free LLM (via Ollama) to refine naming fields.

    Returns a partial dictionary of suggested fields. Invalid JSON responses are
    ignored safely.
    """
    resolved_model = resolve_ollama_model(
        endpoint=endpoint,
        requested_model=model,
        timeout_seconds=timeout_seconds,
        preferred_models=preferred_models,
    )
    if resolved_model is None:
        return {}

    prompt = (
        "You are helping standardize microscopy filenames. Return only JSON with any of these keys: "
        "date, exptype, sample, magnification, markers, notes. "
        "Use uppercase for exptype/sample/magnification/markers/notes. "
        "Do not invent values if uncertain.\n\n"
        f"Original filename: {original_name}\n"
        f"Current extracted fields: {json.dumps(current_fields)}"
    )

    payload: dict[str, Any] = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": "Respond with valid compact JSON only."},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "format": "json",
    }

    try:
        response = requests.post(endpoint, json=payload, timeout=timeout_seconds)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logger.warning("Failed to get suggestion from Ollama: %s", e)
        return {}
    except Exception as e:
        logger.warning("Unexpected error communicating with Ollama: %s", e)
        return {}

    content = data.get("message", {}).get("content", "{}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse JSON from Ollama: %s", e)
        return {}

    allowed = {"date", "exptype", "sample", "magnification", "markers", "notes"}
    return {k: str(v) for k, v in parsed.items() if k in allowed and v is not None}
