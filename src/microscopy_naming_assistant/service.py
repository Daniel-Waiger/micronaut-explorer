from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import load_config
from .llm import suggest_fields_with_ollama
from .metadata import extract_metadata
from .naming import build_filename, normalize_fields
from .profiles import load_profile
from .validation import ValidationIssue, validate_fields


@dataclass
class SuggestionResult:
    source: Path
    target_name: str
    fields: dict[str, str]
    issues: list[ValidationIssue]


@dataclass
class BatchResult:
    planned: list[tuple[Path, Path]]
    suggestions: list[SuggestionResult]
    skipped: list[str]


def suggest_for_file(
    file_path: Path,
    config_path: Path,
    use_llm: bool = False,
    profile_path: Path | None = None,
    llm_model_override: str | None = None,
) -> SuggestionResult:
    config = load_config(config_path)
    extracted = extract_metadata(file_path)

    if use_llm and bool(config.llm.get("enabled", False)):
        llm_model = llm_model_override or str(config.llm.get("model", "auto"))
        llm_fields = suggest_fields_with_ollama(
            current_fields=extracted,
            original_name=file_path.name,
            endpoint=str(config.llm["endpoint"]),
            model=llm_model,
            timeout_seconds=int(config.llm.get("timeout_seconds", 30)),
            preferred_models=[str(x) for x in config.llm.get("preferred_models", [])],
        )
        extracted = {**extracted, **llm_fields}

    merged = {**config.defaults, **extracted}
    merged["ext"] = file_path.suffix.lower() or ".tif"
    normalized = normalize_fields(merged, config)

    issues: list[ValidationIssue] = []
    if profile_path is not None:
        profile = load_profile(profile_path)
        issues = validate_fields(normalized, profile)

    target_name = build_filename(file_path, extracted, config)
    return SuggestionResult(source=file_path, target_name=target_name, fields=normalized, issues=issues)


def plan_batch(
    input_dir: Path,
    pattern: str,
    config_path: Path,
    use_llm: bool = False,
    profile_path: Path | None = None,
    strict: bool = False,
    llm_model_override: str | None = None,
) -> BatchResult:
    files = [p for p in input_dir.rglob(pattern) if p.is_file()]
    collisions: set[Path] = set()
    planned: list[tuple[Path, Path]] = []
    suggestions: list[SuggestionResult] = []
    skipped: list[str] = []

    for file_path in files:
        result = suggest_for_file(
            file_path=file_path,
            config_path=config_path,
            use_llm=use_llm,
            profile_path=profile_path,
            llm_model_override=llm_model_override,
        )
        suggestions.append(result)

        has_blocking = any(i.severity == "error" for i in result.issues)
        if strict and has_blocking:
            skipped.append(f"{file_path.name}: validation failed in strict mode")
            continue

        target = file_path.with_name(result.target_name)
        if target in collisions:
            skipped.append(f"{file_path.name}: duplicate target {target.name}")
            continue

        collisions.add(target)
        planned.append((file_path, target))

    return BatchResult(planned=planned, suggestions=suggestions, skipped=skipped)


def apply_batch(planned: list[tuple[Path, Path]]) -> int:
    renamed = 0
    for src, dst in planned:
        if src == dst:
            continue
        src.rename(dst)
        renamed += 1
    return renamed
