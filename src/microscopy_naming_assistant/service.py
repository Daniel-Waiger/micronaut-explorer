from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import load_config
from .llm import suggest_fields_with_ollama
from .metadata import extract_metadata
from .naming import finalize_fields, render_name
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
    extracted = extract_metadata(file_path, timeout_seconds=int(config.extraction_timeout_seconds))

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

    fields = finalize_fields(file_path, extracted, config)

    issues: list[ValidationIssue] = []
    if profile_path is not None:
        profile = load_profile(profile_path)
        issues = validate_fields(fields, profile)

    target_name = render_name(fields, config)
    return SuggestionResult(source=file_path, target_name=target_name, fields=fields, issues=issues)


def recalculate_batch(
    input_dir: Path,
    suggestions: list[SuggestionResult],
    strict: bool = False,
    conflict_strategy: str = "suffix",
) -> BatchResult:
    collisions: set[Path] = set()
    planned: list[tuple[Path, Path]] = []
    skipped: list[str] = []

    for result in suggestions:
        has_blocking = any(i.severity == "error" for i in result.issues)
        if strict and has_blocking:
            skipped.append(f"{result.source.name}: validation failed in strict mode")
            continue

        target = result.source.with_name(result.target_name)
        
        if target in collisions:
            if conflict_strategy == "skip":
                skipped.append(f"{result.source.name}: duplicate target {target.name}")
                continue
            elif conflict_strategy == "fail":
                skipped.append(f"{result.source.name}: collision error, failing batch")
                continue
            else:
                counter = 1
                original_stem = target.stem
                ext = target.suffix
                while target in collisions:
                    target = target.with_name(f"{original_stem}_{counter:02d}{ext}")
                    counter += 1

        collisions.add(target)
        planned.append((result.source, target))

    return BatchResult(planned=planned, suggestions=suggestions, skipped=skipped)


def plan_batch(
    input_dir: Path,
    pattern: str,
    config_path: Path,
    recursive: bool = False,
    use_llm: bool = False,
    profile_path: Path | None = None,
    strict: bool = False,
    llm_model_override: str | None = None,
    conflict_strategy: str = "suffix",
) -> BatchResult:
    matches = input_dir.rglob(pattern) if recursive else input_dir.glob(pattern)
    files = [p for p in matches if p.is_file()]
    suggestions: list[SuggestionResult] = []

    for file_path in files:
        result = suggest_for_file(
            file_path=file_path,
            config_path=config_path,
            use_llm=use_llm,
            profile_path=profile_path,
            llm_model_override=llm_model_override,
        )
        suggestions.append(result)

    return recalculate_batch(
        input_dir=input_dir,
        suggestions=suggestions,
        strict=strict,
        conflict_strategy=conflict_strategy,
    )


def apply_batch(input_dir: Path, planned: list[tuple[Path, Path]]) -> tuple[int, Path | None]:
    from .manifest import save_manifest
    renamed = 0
    actually_renamed = []
    for src, dst in planned:
        if src == dst:
            continue
        src.rename(dst)
        actually_renamed.append((src, dst))
        renamed += 1
        
    manifest_path = save_manifest(input_dir, actually_renamed)
    return renamed, manifest_path
