"""Local-LLM enhancement layer for microscopy filename suggestions.

Naming in this project is deterministic-first: the base name is always built
from extracted metadata and filename keywords, before any LLM is consulted.
This module's job is strictly to *enhance* that deterministic base -- filling
in genuinely missing fields, and formatting/tidying values -- grounded only in
the extracted metadata, the original filename, and (when supplied) the user's
own description. It must never *originate* biological identity (experiment
type, marker/fluorophore, sample, magnification, date) that isn't already
evidenced in those inputs. When in doubt, the model is instructed to omit a
key rather than guess.
"""

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

# How much of the metadata blob to put in the prompt. Vendor metadata can run to
# megabytes of XML, which would blow a small local model's context window and
# bury the few lines that matter.
MAX_PROMPT_METADATA_CHARS = 8_000


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
    user_description: str | None = None,
    metadata_text: str | None = None,
) -> dict[str, str]:
    """Ask a local/free LLM (via Ollama) to refine naming fields.

    This is an *enhancer*, not an originator: the model may only fill in or
    tidy fields that are directly supported by the extracted metadata, the
    original filename, or an optional user-supplied description. It must
    never fabricate biological identity (marker, experiment type, sample,
    magnification, date) that isn't evidenced in those inputs.

    `metadata_text` is the raw metadata blob read from the file. Passing it
    matters: the deterministic scanners only recognize patterns we thought to
    write regexes for, whereas vendor metadata states things in prose and in
    per-vendor key names. Giving the model the actual record -- alongside the
    filename -- is what lets it recover fields the regexes miss, while keeping
    it grounded in evidence rather than guessing from the filename alone.

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

    prompt_lines = [
        "Role: You refine and format microscopy filename fields. You do NOT invent facts.",
        "Allowed keys only: date, exptype, sample, magnification, markers, notes.",
        "Hard rules:",
        "1. Only propose a value directly supported by the provided extracted "
        "metadata, the original filename, or the user's description.",
        "2. NEVER fabricate markers, experiment type, sample, magnification, or "
        "date from weak or absent cues. If a field is not evidenced, OMIT its "
        "key entirely. Omission is always better than a guess.",
        "3. Do NOT change or overwrite any value already present in the current "
        "fields -- only fill genuinely missing ones.",
        "4. Do not infer biological identity (which fluorophore/marker, which "
        "experiment type) unless it is explicitly present in the inputs.",
        "5. Format only: uppercase exptype/sample/magnification/markers/notes; "
        "keep date as YYYY-MM-DD.",
        "6. Return a compact JSON object containing ONLY the keys you can "
        "justify from the inputs. If nothing can be justified, return {}.",
        "7. The file metadata below is the authoritative record of how the image "
        "was acquired. Prefer it over the filename when the two disagree, and "
        "quote values from it rather than reformulating them.",
        "",
        f"Original filename: {original_name}",
        f"Current extracted fields: {json.dumps(current_fields)}",
    ]
    if metadata_text:
        excerpt = metadata_text[:MAX_PROMPT_METADATA_CHARS]
        if len(metadata_text) > MAX_PROMPT_METADATA_CHARS:
            excerpt += "\n... [truncated]"
        prompt_lines += [
            "",
            "File metadata read from the image (may be empty if the file carried none):",
            excerpt,
        ]
    if user_description:
        prompt_lines.append(
            "User-provided description (authoritative context -- use this to "
            f"enhance the name): {user_description}"
        )
    prompt = "\n".join(prompt_lines)

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
