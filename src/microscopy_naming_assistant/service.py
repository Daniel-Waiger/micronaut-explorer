from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from .config import NamingConfig, load_config
from .llm import suggest_fields_with_ollama
from .metadata import extract_metadata_detailed
from .naming import finalize_fields, render_name
from .profiles import load_profile
from .safety import check_source_safety
from .validation import ValidationIssue, validate_fields, validate_target_path


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
    # Raw addressable metadata keys for EVERY image (one dict per series),
    # unlike `key_paths` above (first image only) -- lets downstream code
    # (B-2's ranker) tell whether a key VARIES across series. The two must
    # stay consistent: `image_key_paths[0] == key_paths` whenever any image
    # was harvested.
    image_key_paths: list[dict[str, str]] = field(default_factory=list)
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
        # actually extracted from the file (or already derived from the
        # filename/mtime) outranks anything the model proposes -- `extracted`
        # at this point holds exactly those genuine gaps, so this can never
        # clobber a metadata- or filename-sourced value.
        #
        # A field the model justified with help from the user's free-text
        # `user_description` carries materially weaker evidence than one
        # grounded only in the file's own metadata/filename: prose is the
        # user's recollection, not an instrument record. Tag such fields with
        # the distinct `"llm_description"` provenance rather than folding them
        # into plain `"llm"` -- collapsing the two would erase exactly the
        # "refined an extracted value" vs. "invented from prose" distinction
        # C2 needs to flag description-derived fields as provisional / needs
        # review all the way to the final name.
        llm_source_tag = "llm_description" if user_description else "llm"
        for key, value in llm_fields.items():
            if key not in extracted:
                extracted[key] = value
                ex_sources[key] = llm_source_tag

    fields = finalize_fields(file_path, extracted, config)

    # A key present in the final fields but not in `extracted`/`llm` was
    # supplied by config.defaults inside `finalize_fields`.
    sources: dict[str, str] = {
        key: ex_sources.get(key, "default") for key in fields if key != "ext"
    }

    issues: list[ValidationIssue] = []
    if profile is not None:
        issues = validate_fields(fields, profile)

    # A3: cheap, never-raising probes for a source that cannot safely be
    # renamed right now (locked/read-only) or that lives in a cloud-synced
    # folder. These are WARNING severity only -- they never block a plan,
    # never change `fields`/`target_name`, and never affect which files get
    # planned or renamed (see safety.check_source_safety).
    issues.extend(check_source_safety(file_path))

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
        image_key_paths=detail.image_key_paths,
        field_key_provenance=detail.field_key_provenance,
        images=detail.images,
    )


def _casefold_key(path: Path) -> str:
    """Collision key for `path` that treats case-only differences as the SAME
    target, matching Windows/NTFS semantics regardless of the host OS running
    this code (CI may run on a case-sensitive filesystem even though the
    files this tool renames ultimately live on Windows).

    Deliberately NOT `Path.__eq__`/hash: on native WindowsPath those already
    happen to casefold, which would make this bug invisible on Windows but
    very much alive on Linux/macOS -- an explicit string key makes the
    semantics platform-independent and intentional rather than incidental.
    """
    return str(path).casefold()


def _distinguishing_token(source: Path) -> str:
    """A short, deterministic, content-derived token identifying `source`.

    Used to disambiguate a naming collision: two different acquisitions that
    happen to render to the same target name must not become indistinguishable
    `_01`/`_02` siblings, since a user can no longer tell them apart (or which
    is which) from the filename alone. Hashing the source path itself (rather
    than e.g. current time) keeps this deterministic and dependency-free.
    """
    digest = hashlib.sha1(str(source).encode("utf-8", errors="surrogateescape"))
    return digest.hexdigest()[:8]


def _resolve_numeric_suffix_collision(target: Path, collision_keys: set[str]) -> Path:
    """Legacy bare `_NN` disambiguation.

    Kept reachable via `conflict_strategy="suffix_numeric"` for callers that
    already depend on the old ambiguous-but-simple naming; the default
    strategy is `_resolve_distinguishing_suffix_collision` instead.
    """
    original_stem = target.stem
    ext = target.suffix
    counter = 1
    while _casefold_key(target) in collision_keys:
        target = target.with_name(f"{original_stem}_{counter:02d}{ext}")
        counter += 1
    return target


def _resolve_distinguishing_suffix_collision(
    target: Path, source: Path, collision_keys: set[str]
) -> Path:
    """Default disambiguation: append a short content-derived token instead of
    a bare counter, so the two targets stay distinguishable rather than
    collapsing into ambiguous `_01`/`_02` siblings."""
    original_stem = target.stem
    ext = target.suffix
    token = _distinguishing_token(source)
    candidate = target.with_name(f"{original_stem}_{token}{ext}")
    counter = 1
    while _casefold_key(candidate) in collision_keys:
        # Vanishingly unlikely hash collision fallback: keep the (still
        # distinguishing) token and add a numeric tiebreaker after it.
        candidate = target.with_name(f"{original_stem}_{token}_{counter:02d}{ext}")
        counter += 1
    return candidate


def recalculate_batch(
    input_dir: Path,
    suggestions: list[SuggestionResult],
    strict: bool = False,
    conflict_strategy: str = "suffix",
) -> BatchResult:
    collision_keys: set[str] = set()
    planned: list[tuple[Path, Path]] = []
    skipped: list[str] = []

    for result in suggestions:
        has_blocking = any(i.severity == "error" for i in result.issues)
        if strict and has_blocking:
            skipped.append(f"{result.source.name}: validation failed in strict mode")
            continue

        target = result.source.with_name(result.target_name)

        if _casefold_key(target) in collision_keys:
            if conflict_strategy == "skip":
                skipped.append(f"{result.source.name}: duplicate target {target.name}")
                continue
            elif conflict_strategy == "fail":
                skipped.append(f"{result.source.name}: collision error, failing batch")
                continue
            elif conflict_strategy == "suffix_numeric":
                target = _resolve_numeric_suffix_collision(target, collision_keys)
            else:
                target = _resolve_distinguishing_suffix_collision(
                    target, result.source, collision_keys
                )

        collision_keys.add(_casefold_key(target))
        planned.append((result.source, target))

        # MAX_PATH is a property of the FULL path (dir + filename), so it can
        # only be known here, once `target` is final. Warn only -- never
        # truncate, since that would silently destroy the identity this tool
        # exists to preserve.
        result.issues.extend(validate_target_path(target))

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
    from .original_name import LEDGER_FILENAME

    matches = input_dir.rglob(pattern) if recursive else input_dir.glob(pattern)
    # A2/A8: never plan a rename of the tool's OWN state -- the durable
    # per-folder ledger (`LEDGER_FILENAME`) and anything under `.manifests/`
    # (the rollback-journal directory `manifest.save_manifest` writes to).
    # A broad pattern (e.g. `*` or `*.json` under `--recursive`) would
    # otherwise match these self-written artifacts: `apply_batch` would
    # physically rename the ledger file itself, `update_ledger` would then
    # find it missing, silently degrade to `{}`, and overwrite it with a
    # brand-new history-free ledger -- permanently orphaning every prior
    # batch's true-original mapping. Report/sidecar files (`--report`/
    # `--sidecar`) are deliberately NOT excluded here: they land at
    # arbitrary user-chosen paths (often outside `input_dir` entirely), carry
    # no state this tool depends on for correctness, and a generic
    # filename-based exclusion could wrongly skip a legitimate user file that
    # happens to share that name.
    files = [
        p
        for p in matches
        if p.is_file()
        # A11: casefold both -- Windows/NTFS is case-insensitive, so a ledger
        # or .manifests entry that merely differs in case (e.g. an OS/sync
        # client that wrote `.ORIGINAL_NAMES.JSON`) must still be excluded,
        # or the data-loss bug above reproduces via that one path.
        and p.name.casefold() != LEDGER_FILENAME.casefold()
        and ".manifests" not in {part.casefold() for part in p.relative_to(input_dir).parts}
    ]
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


def apply_batch(
    input_dir: Path,
    planned: list[tuple[Path, Path]],
    embed_original_name: bool = False,
) -> tuple[int, Path | None]:
    """Rename every planned pair, all-or-nothing.

    Contract:
    - The manifest is written as an intent journal BEFORE any rename, so a
      hard crash mid-batch still leaves a recoverable trail on disk (a
      ``None`` manifest means the plan was empty / all no-op, exactly as
      ``save_manifest`` already defines).
    - On success, returns ``(renamed_count, manifest_path)`` exactly as
      before.
    - On ANY exception during renaming, every rename already completed is
      undone (in reverse order, reusing ``rollback_manifest``'s existing
      skip-if-original-exists semantics) and the ORIGINAL exception is
      re-raised unchanged, so callers that already propagate it need no
      changes.
    - If the rollback itself cannot fully restore the files, that failure is
      never swallowed: a ``RuntimeError`` naming the un-restorable files is
      raised instead, chained (``raise ... from``) from the original
      exception, since that is the one state a user must act on manually.
    - A2 original-name preservation, run ONLY after every rename in this
      batch has actually succeeded (never inside the try/rollback block
      above, and never able to undo a rename):
        * the durable per-folder ledger (`original_name.update_ledger`) is
          ALWAYS updated, for every format, merging into any existing ledger
          rather than replacing it;
        * iff `embed_original_name` is True, the CHAIN-RESOLVED true original
          filename (from `update_ledger`'s `resolved` return, not the
          immediate `src.name`) is also written into the ImageDescription tag
          of TIFF/OME-TIFF targets only (never CZI/LIF/ND2), so a multi-hop
          rename embeds the true original rather than an intermediate name.
          A failed embed is swallowed here too, as defense in depth on top of
          `embed_original_name_in_tiff` already never raising -- the ledger,
          not this tag, is the source of truth.
    """
    from .manifest import rollback_manifest, save_manifest
    from .original_name import embed_original_name_in_tiff, update_ledger

    actual_pairs = [(src, dst) for src, dst in planned if src != dst]

    # Intent journal: write BEFORE renaming anything so a hard crash
    # (power loss, kill -9) mid-batch still leaves a recoverable trail.
    manifest_path = save_manifest(input_dir, planned)

    completed: list[tuple[Path, Path]] = []
    try:
        for src, dst in actual_pairs:
            src.rename(dst)
            completed.append((src, dst))
    except Exception as exc:
        rollback_errors: list[str] = []
        if manifest_path is not None:
            _, rollback_errors = rollback_manifest(manifest_path, input_dir)
        if rollback_errors:
            raise RuntimeError(
                "Apply failed and rollback could not fully restore all files: "
                + "; ".join(rollback_errors)
            ) from exc
        raise

    if completed:
        # Sidecar ledger: ALWAYS, every format. Runs only once every rename
        # above has actually succeeded, so it can never gate or roll back
        # them; a write failure here is a ledger-write problem, not a rename
        # problem, and is deliberately not caught so it is never silently
        # lost -- but it happens after the filesystem is already in its
        # final, successful state.
        _, resolved = update_ledger(input_dir, completed)

        if embed_original_name:
            for src, dst in completed:
                # A8: embed the CHAIN-RESOLVED true original, not `src.name`
                # (the immediate previous filename) -- on a multi-hop rename,
                # `src.name` is only an intermediate name, not the true
                # original the ledger already resolved back to.
                dst_key = str(dst.relative_to(input_dir))
                original = resolved.get(dst_key, src.name)
                try:
                    embed_original_name_in_tiff(dst, original)
                except Exception:
                    # Opt-in convenience only (A2): even an unexpected
                    # failure that somehow escapes the helper's own
                    # never-raise contract must not undo an
                    # already-successful rename.
                    pass

    return len(completed), manifest_path
