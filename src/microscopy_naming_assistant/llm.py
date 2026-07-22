from __future__ import annotations

import json
from typing import Any

import requests


def suggest_fields_with_ollama(
    current_fields: dict[str, str],
    original_name: str,
    endpoint: str,
    model: str,
    timeout_seconds: int,
) -> dict[str, str]:
    """Ask a local/free LLM (via Ollama) to refine naming fields.

    Returns a partial dictionary of suggested fields. Invalid JSON responses are
    ignored safely.
    """
    prompt = (
        "You are helping standardize microscopy filenames. Return only JSON with any of these keys: "
        "date, exptype, sample, magnification, markers, notes. "
        "Use uppercase for exptype/sample/magnification/markers/notes. "
        "Do not invent values if uncertain.\n\n"
        f"Original filename: {original_name}\n"
        f"Current extracted fields: {json.dumps(current_fields)}"
    )

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Respond with valid compact JSON only."},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "format": "json",
    }

    response = requests.post(endpoint, json=payload, timeout=timeout_seconds)
    response.raise_for_status()
    data = response.json()

    content = data.get("message", {}).get("content", "{}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return {}

    allowed = {"date", "exptype", "sample", "magnification", "markers", "notes"}
    return {k: str(v) for k, v in parsed.items() if k in allowed and v is not None}
