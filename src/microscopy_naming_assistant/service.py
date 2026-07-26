from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .config import NamingConfig, load_config
from .llm import suggest_fields_with_ollama
from .metadata import extract_metadata_detailed
from .naming import finalize_fields, render_name
from .profiles import load_profile
from .validation import ValidationIssue, validate_fields


@dataclass
class SuggestionResult:
    source: Path
    target_name: str
    fields: dict[str, str]
    issues: list[ValidationIssue]
    sources: dict[str, str] = field(default_factory=dict)
    metadata_text: str = ""
    reader: str = ""
    extraction_error: str = ""
    # Key-provenance surfaced from ExtractionDetail: `key_paths` is the raw
    # addressable metadata keys harvested for the (first) image, and
    # `field_key_provenance` maps each naming field the key map resolved to
    # the exact metadata key that supplied it (see field_map.resolve_fields).
    key_paths: dict[str, str] = field(default_factory=dict)
    field_key_provenance: dict[str, str] = field(default_factory=dict)
    # Per-image (per-series) resolved-field records straight from
    # ExtractionDetail.images (see metadata._per_image_records): one flat
    # str->str dict per image, `{"index": ..., "name": ..., **resolved_fields}`.
    # Feeds build_series_rows' sidecar view; never used for renaming here.
    images: list[dict[str, str]] = field(default_factory=list)


@dataclass
class BatchResult:
    # INVARIANT: `planned` must stay strictly 1:1 with real filesystem entries.
    # apply_batch does an unguarded `src.rename(dst)` in a loop, so two results
    # sharing one source path raise FileNotFoundError on the second iteration
    # AND skip save_manifest, leaving the first rename unrollbackable.
    planned: list[tuple[Path, Path]]
    suggestions: list[SuggestionResult]
    skipped: list[str]


def suggest_for_file(
    file_path: Path,
    config_path: Path,
    use_llm: bool = False,
    profile_path: Path | None = None,
    llm_model_override: str | None = None,
    user_description: str | None = None,
) -> SuggestionResult:
    config = load_config(config_path)

    profile = load_profile(profile_path) if profile_path is not None else None

    extracted, ex_sources, detail = extract_metadata_detailed(
        file_path,
        timeout_seconds=int(config.extraction_timeout_seconds),
        extraction_mask=profile.filename_extraction_mask if profile else None,
        field_key_map=profile.field_key_map if profile else None,
    )

    if use_llm and bool(config.llm.get("enabled", False)):
        llm_model = llm_model_override or str(config.llm.get("model", "auto"))
        llm_fields = suggest_fields_with_ollama(
            current_fields=extracted,
            original_name=file_path.name,
            endpoint=str(config.llm["endpoint"]),
            model=llm_model,
            timeout_seconds=int(config.llm.get("timeout_seconds", 30)),
            preferred_models=[str(x) for x in config.llm.get("preferred_models", [])],
            user_description=user_description,
            metadata_text=detail.metadata_text,
        )
        # Fill only genuinely missing fields. The LLM is an enhancer: a value we
        # actually extracted from the file outranks anything the model proposes.
        for key, value in llm_fields.items():
            if key not in extracted:
                extracted[key] = value
                ex_sources[key] = "llm"

    fields = finalize_fields(file_path, extracted, config)

    # A key present in the final fields but not in `extracted`/`llm` was
    # supplied by config.defaults inside `finalize_fields`.
    sources: dict[str, str] = {
        key: ex_sources.get(key, "default") for key in fields if key != "ext"
    }

    issues: list[ValidationIssue] = []
    if profile is not None:
        issues = validate_fields(fields, profile)

    target_name = render_name(fields, config)
    return SuggestionResult(
        source=file_path,
        target_name=target_name,
        fields=fields,
        issues=issues,
        sources=sources,
        metadata_text=detail.metadata_text,
        reader=detail.reader,
        extraction_error=detail.error,
        key_paths=detail.key_paths,
        field_key_provenance=detail.field_key_provenance,
        images=detail.images,
    )


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


def build_series_rows(
    suggestions: list[SuggestionResult], config: NamingConfig
) -> list[dict[str, str]]:
    """Per-series sidecar rows for multi-image containers (LIF/ND2/CZI/OME-TIFF).

    SAFETY CONSTRAINT: these rows are SIDECAR-ONLY. They must never be
    appended to `BatchResult.planned` and must never drive a per-series
    rename or pixel export -- `apply_batch` does an unguarded `src.rename(dst)`
    in a loop, so N rows sharing one source path would raise
    `FileNotFoundError` on the second iteration AND skip `save_manifest`,
    leaving the first rename unrollbackable. This function therefore neither
    takes nor mutates a `BatchResult`: it is a pure `suggestions -> rows`
    transform, callable only for display/export, never wired into
    `recalculate_batch`, `plan_batch`, or `apply_batch`.

    A single-image file has nothing extra to say -- the ordinary rename
    already covers it -- so containers with one image contribute no rows.
    For a multi-image container, each per-image record's fields (excluding
    the `index`/`name` bookkeeping keys) are overlaid onto the container's
    already-finalized `result.fields` and re-run through the normal
    `finalize_fields` + `render_name` pipeline, so a series-specific value
    (e.g. a 40x closeup inside a container whose shared name says nothing
    about magnification) is reflected in `suggested_name` without altering
    the container's own rename.
    """
    rows: list[dict[str, str]] = []
    for result in suggestions:
        if len(result.images) <= 1:
            continue

        for record in result.images:
            overlay = {k: v for k, v in record.items() if k not in ("index", "name")}
            merged_fields = {**result.fields, **overlay}
            finalized = finalize_fields(result.source, merged_fields, config)
            suggested_name = render_name(finalized, config)
            rows.append(
                {
                    "source": result.source.name,
                    "series_index": record["index"],
                    "internal_name": record["name"],
                    "suggested_name": suggested_name,
                }
            )

    return rows


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
    user_description: str | None = None,
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
            user_description=user_description,
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
