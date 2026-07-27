"""Local-LLM enhancement layer for microscopy filename suggestions.

Naming in this project is deterministic-first: the base name is always built
from extracted metadata and filename keywords, before any LLM is consulted.
This module's job is strictly to *enhance* that deterministic base -- filling
in genuinely missing fields, formatting/tidying values, and (only when the
user typed a description) proposing a reviewable replacement for a field the
description plainly states -- grounded only in the extracted metadata, the
original filename, and (when supplied) the user's own description. It must
never *originate* biological identity (experiment type, marker/fluorophore,
sample, magnification, date) that isn't already evidenced in those inputs.
When in doubt, the model is instructed to omit a key rather than guess.

Description-override policy, stated once here and kept consistent everywhere
below: the free-text describer path (a user-written experiment description
passed as ``user_description``) is the weakest-evidence input this module
accepts -- it is the user's recollection, not an instrument record. WITHOUT
a description, every populated field stays untouchable: the model may only
fill genuinely missing ones, exactly as when no description is given at all.
WITH a description, the model MAY additionally propose a replacement value
for an already-populated field, but only for a field the description states
plainly -- never by inference, never beyond what it states. This module
never applies anything itself; it always returns one flat ``{field: value}``
dict regardless of whether an entry is a fill or a proposed override, and it
is the CALLER's job to tell the two apart (by diffing against the current
fields) and decide what to do with each: the non-interactive CLI path
(``service.suggest_for_file``) keeps only fills, since it has no review step
and applying an override there would be exactly the silent overwrite this
policy exists to prevent; the Streamlit UI path classifies the response into
fills (applied immediately) and overrides (held for an explicit user
accept/reject, never auto-applied). Callers are responsible for tagging any
field filled or proposed while a description was supplied with the distinct
``"llm_description"`` provenance -- never plain ``"llm"`` -- so downstream
code can flag it provisional / needs-review rather than presenting it as
ground truth.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
from typing import Any

import requests

logger = logging.getLogger(__name__)

# Open-weights general-reasoning models (NOT coding models) for local
# naming-metadata enrichment, ordered best-first for a 64 GB RAM / 16 GB VRAM
# machine (a 14B model fits fully on GPU at that tier). Sizes here mirror the
# tiers in scripts/hardware_check.py::recommend_model so the two stay
# consistent. Entries are "family:tag" -- resolve_ollama_model tolerates any
# installed tag that starts with a listed tag (e.g. "qwen3.5:14b" matches an
# install named "qwen3.5:14b-instruct-q4_K_M"), so these are deliberately the
# short canonical size tags rather than exact quantization/build strings.
DEFAULT_PREFERRED_MODELS = [
    "qwen3.5:14b",
    "gemma2:9b",
    "llama3.1:8b",
    "qwen3.5:7b",
    "gemma2:2b",
    "qwen3.5:3b",
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

    if not isinstance(data, dict):
        logger.warning("Unexpected /api/tags response shape from Ollama: %r", type(data))
        return []

    models = data.get("models", [])
    if not isinstance(models, list):
        logger.warning("Unexpected 'models' field shape from Ollama: %r", type(models))
        return []

    names: list[str] = []
    for item in models:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if name:
            names.append(name)

    # Keep order from Ollama while removing duplicates.
    return list(dict.fromkeys(names))


def _detect_vram_gb() -> float | None:
    """Best-effort local GPU VRAM probe. Never raises; ``None`` means undetectable.

    Mirrors the ``nvidia-smi`` query in ``scripts/hardware_check.py``, kept as a
    self-contained copy here since ``scripts/`` is a developer utility folder,
    not part of the installed package, and this module must add no new
    dependency. VRAM awareness is a nice-to-have for ranking, never a
    requirement -- any failure (no GPU, missing binary, timeout, unparsable
    output) degrades to "unknown" rather than raising.
    """
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        )
    except Exception:
        return None

    try:
        first_line = result.stdout.strip().splitlines()[0].strip()
        return float(first_line) / 1024
    except (IndexError, ValueError):
        return None


_SIZE_TOKEN_RE = re.compile(r"^(\d+(?:\.\d+)?)b$", re.IGNORECASE)


def _approx_min_vram_gb(size_tag: str) -> float:
    """Rough VRAM (GB) needed to fully offload a model of this size tag.

    Mirrors the tiers in ``scripts/hardware_check.py::recommend_model``. A
    non-numeric tag (e.g. "mini") is assumed to fit anywhere.
    """
    match = _SIZE_TOKEN_RE.match(size_tag)
    if not match:
        return 0.0
    size_b = float(match.group(1))
    if size_b >= 9:
        return 15.5
    if size_b >= 7:
        return 7.5
    if size_b >= 3:
        return 3.5
    return 0.0


def _parse_model_ref(name: str) -> tuple[str, str]:
    family, _, tag = name.partition(":")
    return family.strip().lower(), tag.strip().lower()


def _tag_matches(preference_tag: str, installed_tag: str) -> bool:
    """True if ``installed_tag`` is ``preference_tag``, optionally with a
    trailing ``-suffix`` (build/quantization info). Boundary-checked so a
    preference of "14b" matches an install tagged "14b-instruct-q4_K_M" but
    not one tagged "140b-instruct"."""
    if not preference_tag:
        return True
    if installed_tag == preference_tag:
        return True
    if not installed_tag.startswith(preference_tag):
        return False
    boundary_char = installed_tag[len(preference_tag)]
    return not boundary_char.isalnum()


def _model_matches_preference(preference: str, installed_name: str) -> bool:
    pref_family, pref_tag = _parse_model_ref(preference)
    inst_family, inst_tag = _parse_model_ref(installed_name)
    if pref_family != inst_family:
        return False
    return _tag_matches(pref_tag, inst_tag)


def _rank_installed_models(
    installed: list[str],
    preferred_models: list[str],
    vram_gb: float | None,
) -> str | None:
    """Pick the best installed model per ``preferred_models`` order.

    When ``vram_gb`` is known, a first pass restricts consideration to
    preference entries whose approximate size fits the available VRAM, so a
    16 GB machine is not steered toward a model too large to fully offload.
    If nothing matches under that restriction (or VRAM is unknown), a second
    pass ranks the full, unrestricted preference list.
    """

    def _fits_vram(preference: str) -> bool:
        if vram_gb is None:
            return True
        _, tag = _parse_model_ref(preference)
        return _approx_min_vram_gb(tag) <= vram_gb

    for preference in preferred_models:
        if not _fits_vram(preference):
            continue
        for candidate in installed:
            if _model_matches_preference(preference, candidate):
                return candidate

    for preference in preferred_models:
        for candidate in installed:
            if _model_matches_preference(preference, candidate):
                return candidate

    return None


def resolve_ollama_model(
    endpoint: str,
    requested_model: str,
    timeout_seconds: int,
    preferred_models: list[str] | None = None,
) -> str | None:
    """Resolve a concrete model name.

    If ``requested_model`` is an explicit value (anything but "auto"), it is
    authoritative and returned unchanged -- a user override always beats
    auto-detection. Otherwise, rank what is ACTUALLY installed (via
    ``list_local_ollama_models``) against ``preferred_models`` (default
    ``DEFAULT_PREFERRED_MODELS``), tolerating tag suffixes and, when local
    VRAM can be determined cheaply, preferring a size that fits it. Falls back
    to the first installed model if nothing on the preference list matches.
    Returns ``None`` only when no models are installed at all.
    """
    requested = requested_model.strip()
    if requested and requested.lower() != "auto":
        return requested

    installed = list_local_ollama_models(endpoint=endpoint, timeout_seconds=timeout_seconds)
    if not installed:
        return None

    preferred = preferred_models or DEFAULT_PREFERRED_MODELS
    vram_gb = _detect_vram_gb()
    ranked = _rank_installed_models(installed, preferred, vram_gb)
    if ranked is not None:
        return ranked

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
    original filename, or an optional user-supplied description -- and, only
    when a description is supplied and states a field plainly, propose a
    replacement for a field that is already populated (see hard rule 8 in
    the prompt below). It must never fabricate biological identity (marker,
    experiment type, sample, magnification, date) that isn't evidenced in
    those inputs.

    `metadata_text` is the raw metadata blob read from the file. Passing it
    matters: the deterministic scanners only recognize patterns we thought to
    write regexes for, whereas vendor metadata states things in prose and in
    per-vendor key names. Giving the model the actual record -- alongside the
    filename -- is what lets it recover fields the regexes miss, while keeping
    it grounded in evidence rather than guessing from the filename alone.

    Returns a partial dictionary of suggested fields -- deliberately a flat
    ``{field: value}`` mapping regardless of which input(s) justified each
    value, and regardless of whether an entry is a fill for a missing field
    or (only possible when `user_description` was supplied and plainly
    states it) a proposed replacement for an already-populated one; the
    omit-over-guess guardrail holds identically for all of them. This
    function never applies anything -- the caller decides both provenance
    tagging and, when a value competes with a populated field, whether to
    use it at all: `suggest_for_file` tags every field filled here with
    `"llm_description"` when a `user_description` was supplied (weaker,
    prose-derived evidence -- flagged provisional for review) and plain
    `"llm"` otherwise (metadata/filename-grounded refinement), and keeps
    only fills -- never overrides -- since its non-interactive CLI caller
    has no review step. Invalid JSON responses, an unreachable endpoint, or
    any other failure are ignored safely and never raise -- this function
    always degrades to `{}` rather than breaking the naming path.
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
        "fields -- only fill genuinely missing ones. The ONE exception is a "
        "user-provided description that plainly states a replacement value "
        "for that exact field -- see rule 8.",
        "4. Do not infer biological identity (which fluorophore/marker, which "
        "experiment type) unless it is explicitly present in the inputs.",
        "5. Format only: uppercase exptype/sample/magnification/markers/notes; "
        "keep date as YYYY-MM-DD.",
        "6. Return a compact JSON object containing ONLY the keys you can "
        "justify from the inputs. If nothing can be justified, return {}.",
        "7. The file metadata below is the authoritative record of how the image "
        "was acquired. Prefer it over the filename when the two disagree, and "
        "quote values from it rather than reformulating them.",
        "8. A user-provided description (if present below) is the weakest "
        "evidence here -- it is the user's own recollection, not an "
        "instrument record. Only propose a field from it when the "
        "description states that field plainly; still OMIT anything vague, "
        "ambiguous, or not explicitly said. It is the ONE input allowed to "
        "replace a value already present in the current fields or the file "
        "metadata: when it plainly and explicitly states a different value "
        "for that field, propose the replacement instead of omitting it. "
        "Every other rule above stays fill-only -- never use the "
        "description to merely reformulate or infer a value that's already "
        "been established some other way.",
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
            "User-provided description (weaker evidence than metadata -- see "
            f"rule 8 for when it may replace an already-filled field): {user_description}"
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

    if not isinstance(data, dict):
        logger.warning("Unexpected /api/chat response shape from Ollama: %r", type(data))
        return {}

    message = data.get("message", {})
    content = message.get("content", "{}") if isinstance(message, dict) else "{}"
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning("Failed to parse JSON from Ollama: %s", e)
        return {}

    if not isinstance(parsed, dict):
        logger.warning("Unexpected parsed content shape from Ollama: %r", type(parsed))
        return {}

    allowed = {"date", "exptype", "sample", "magnification", "markers", "notes"}
    return {k: str(v) for k, v in parsed.items() if k in allowed and v is not None}
