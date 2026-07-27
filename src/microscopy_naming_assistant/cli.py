from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .config import NamingConfig, default_config, load_config, save_config
from .profiles import default_profile, save_profile
from .service import BatchResult, apply_batch, build_series_rows, plan_batch, suggest_for_file

# C1's provenance tags this CLI must surface as provisional / weak rather
# than silently as ground truth. Kept as named sets (not inlined string
# comparisons) so both `cmd_suggest` and `cmd_batch` stay in lockstep with
# service.py's tagging vocabulary.
PROVISIONAL_SOURCE_TAGS = {"llm_description"}
WEAK_DATE_SOURCE_TAGS = {"mtime"}


def _provisional_fields(sources: dict[str, str]) -> list[str]:
    """Fields whose value came from the user's free-text description
    (C1's ``"llm_description"`` provenance tag) -- materially weaker evidence
    than metadata/filename/plain-``"llm"``, so any caller surfacing a name
    built from these fields must flag them provisional / needs review rather
    than presenting them as ground truth."""
    return sorted(key for key, tag in sources.items() if tag in PROVISIONAL_SOURCE_TAGS)


def _date_is_weak(sources: dict[str, str]) -> bool:
    """True when ``date`` was derived only from the file's mtime (A5) --
    frequently the date the file was *copied*, not acquired -- rather than
    real metadata or a filename-embedded date."""
    return sources.get("date") in WEAK_DATE_SOURCE_TAGS


def _provenance_payload(sources: dict[str, str]) -> dict[str, object]:
    """Shared provenance/provisional block for the `--json` payloads of both
    `suggest` and `batch` -- one place computing it keeps the two commands'
    JSON contracts from drifting apart."""
    return {
        "provisional_fields": _provisional_fields(sources),
        "date_is_weak": _date_is_weak(sources),
    }


def _warn_if_describe_inert(args: argparse.Namespace, config: NamingConfig) -> None:
    """A-4: `--describe` is silently discarded today whenever the LLM isn't
    active -- there is no argparse dependency linking `--describe` to
    `--llm`/`config.llm['enabled']`, so a user who types a description with
    `--llm` omitted (or with the config's LLM disabled) gets no error, no
    warning, exit code 0, and the description simply never reaches the
    model. Both `cmd_suggest` and `cmd_batch` forward `args.describe`
    straight into `suggest_for_file`/`plan_batch` with the exact same hole,
    so this is one shared guard rather than two copies that could drift.

    Never a hard error and never changes the exit code -- `--describe` stays
    inert exactly as before, it just stops being silent about it."""
    if not args.describe:
        return
    if not args.llm or not bool(config.llm.get("enabled", False)):
        print(
            "WARNING: --describe was ignored because the LLM is off "
            "(pass --llm, and ensure llm.enabled is true in the config). "
            "The description had no effect on the suggested name.",
            file=sys.stderr,
        )


def cmd_init_config(args: argparse.Namespace) -> int:
    config = default_config()
    output = Path(args.output)
    if output.exists() and not args.force:
        print(f"Config already exists at {output}. Use --force to overwrite.")
        return 1
    save_config(output, config)
    print(f"Wrote default config to {output}")
    return 0


def cmd_init_profile(args: argparse.Namespace) -> int:
    profile = default_profile()
    output = Path(args.output)
    if output.exists() and not args.force:
        print(f"Profile already exists at {output}. Use --force to overwrite.")
        return 1
    save_profile(output, profile)
    print(f"Wrote default profile to {output}")
    return 0


def cmd_suggest(args: argparse.Namespace) -> int:
    source = Path(args.input)
    config_path = Path(args.config)
    profile_path = Path(args.profile) if args.profile else None

    if not source.exists():
        print(f"Input file not found: {source}")
        return 1

    config = load_config(config_path)
    _warn_if_describe_inert(args, config)

    result = suggest_for_file(
        file_path=source,
        config_path=config_path,
        use_llm=args.llm,
        profile_path=profile_path,
        llm_model_override=args.llm_model,
        user_description=args.describe,
    )

    strict_blocked = args.strict and any(i.severity == "error" for i in result.issues)

    if args.json:
        payload = {
            "source": source.name,
            "suggested": result.target_name,
            "fields": result.fields,
            "issues": [asdict(issue) for issue in result.issues],
            "sources": result.sources,
            "reader": result.reader,
            "extraction_error": result.extraction_error,
            # C2: provisional/provenance info alongside the plain `sources`
            # map above -- a field tagged "llm_description" (from the
            # free-text --describe input) or a "mtime"-sourced date must
            # still read as provisional/weak once surfaced, not silently as
            # ground truth.
            **_provenance_payload(result.sources),
        }
        if args.show_metadata:
            payload["metadata"] = result.metadata_text
        print(json.dumps(payload))
        return 2 if strict_blocked else 0

    print(f"Source: {source.name}")
    print(f"Suggested: {result.target_name}")
    print(f"Fields: {result.fields}")

    provisional = _provisional_fields(result.sources)
    if provisional:
        print(f"PROVISIONAL (from description, needs review): {', '.join(provisional)}")
    if _date_is_weak(result.sources):
        print("Date: WEAK -- derived from file mtime, not confirmed acquisition metadata.")

    if args.show_metadata:
        print(f"Reader: {result.reader or 'none'}")
        if result.extraction_error:
            print(f"Extraction problem: {result.extraction_error}")
        print("Metadata read from file:")
        print(result.metadata_text or "(none)")

    if result.issues:
        print("Validation:")
        for issue in result.issues:
            print(f"- {issue.severity.upper()} [{issue.field}] {issue.message}")

        if strict_blocked:
            print("Strict mode: suggestion blocked due to validation errors.")
            return 2

    return 0


def _batch_report_rows(batch: BatchResult) -> list[dict[str, str]]:
    """Build source/target/issues rows for a planned batch (used by --report)."""
    issues_by_source = {
        suggestion.source.name: "; ".join(
            f"{issue.severity}:{issue.field}" for issue in suggestion.issues
        )
        for suggestion in batch.suggestions
    }
    return [
        {
            "source": src.name,
            "target": dst.name,
            "issues": issues_by_source.get(src.name, ""),
        }
        for src, dst in batch.planned
    ]


REPORT_COLUMNS = ["source", "target", "issues"]
SIDECAR_COLUMNS = ["source", "series_index", "internal_name", "suggested_name"]


def rows_to_csv(rows: list[dict[str, str]], fieldnames: list[str] | None = None) -> str:
    """Render `rows` as CSV text.

    Columns come from `fieldnames` when given, else from the first row's keys
    (dicts preserve insertion order, so a caller controls column order just by
    the order it builds each row in).

    Pass `fieldnames` whenever the row list may be empty. A batch can legitimately
    plan nothing while still having suggestions -- `--strict` where every file has
    an error, or `--conflict-strategy skip` with all targets colliding -- and
    without it that report would be a bare newline with no header, silently
    breaking any script that reads the column names.
    """
    buffer = io.StringIO()
    columns = fieldnames if fieldnames is not None else (list(rows[0].keys()) if rows else [])
    writer = csv.DictWriter(buffer, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def _write_rows(
    path: Path, rows: list[dict[str, str]], fieldnames: list[str] | None = None
) -> None:
    """Write `rows` as JSON (path ends in .json) or CSV.

    Shared by --report (source/target/issues) and --sidecar
    (source/series_index/internal_name/suggested_name), so there is exactly
    one report writer in the CLI.
    """
    if path.suffix.lower() == ".json":
        path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    else:
        # newline="" so the CSV module's own \r\n terminators reach disk
        # unchanged -- text-mode translation would otherwise double them.
        with path.open("w", newline="", encoding="utf-8") as handle:
            handle.write(rows_to_csv(rows, fieldnames))


def _write_batch_report(report_path: Path, batch: BatchResult) -> None:
    _write_rows(report_path, _batch_report_rows(batch), REPORT_COLUMNS)


def cmd_batch(args: argparse.Namespace) -> int:
    input_dir = Path(args.input_dir)
    config_path = Path(args.config)
    profile_path = Path(args.profile) if args.profile else None

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}")
        return 1

    config = load_config(config_path)
    _warn_if_describe_inert(args, config)

    batch = plan_batch(
        input_dir=input_dir,
        pattern=args.pattern,
        config_path=config_path,
        recursive=args.recursive,
        use_llm=args.llm,
        profile_path=profile_path,
        strict=args.strict,
        llm_model_override=args.llm_model,
        conflict_strategy=args.conflict_strategy,
        user_description=args.describe,
    )

    if not batch.suggestions:
        print("No matching files found.")
        return 0

    if args.report:
        _write_batch_report(Path(args.report), batch)

    # SAFETY: sidecar rows are a pure side report -- never fed into
    # batch.planned/apply_batch/the manifest, computed here only to be
    # written out or reflected in the printed payload below.
    sidecar_rows: list[dict[str, str]] = []
    if args.sidecar:
        sidecar_rows = build_series_rows(batch.suggestions, config)
        if sidecar_rows:
            _write_rows(Path(args.sidecar), sidecar_rows, SIDECAR_COLUMNS)

    if args.json:
        renamed = None
        manifest = None
        if args.apply:
            renamed, manifest = apply_batch(input_dir, batch.planned)

        payload = {
            "planned": [{"source": src.name, "target": dst.name} for src, dst in batch.planned],
            "skipped": list(batch.skipped),
            "issues": [
                {"source": suggestion.source.name, **asdict(issue)}
                for suggestion in batch.suggestions
                for issue in suggestion.issues
            ],
            # C2: per-file provenance, additive to "issues"/"planned" above --
            # `sources` is the raw map (see SuggestionResult.sources) and
            # `provisional_fields`/`date_is_weak` are the derived flags a
            # caller needs to render a field as provisional/weak rather than
            # as ground truth.
            "provenance": [
                {
                    "source": suggestion.source.name,
                    "sources": suggestion.sources,
                    **_provenance_payload(suggestion.sources),
                }
                for suggestion in batch.suggestions
            ],
            "applied": args.apply,
            "renamed": renamed,
            "manifest": str(manifest) if manifest else None,
        }
        if args.sidecar:
            payload["sidecar"] = str(args.sidecar) if sidecar_rows else None
        print(json.dumps(payload))
        return 0

    for src, dst in batch.planned:
        print(f"{src.name} -> {dst.name}")

    provisional_by_source = {
        suggestion.source.name: _provisional_fields(suggestion.sources)
        for suggestion in batch.suggestions
        if _provisional_fields(suggestion.sources)
    }
    if provisional_by_source:
        print("Provisional fields (from description, needs review):")
        for name, provisional in provisional_by_source.items():
            print(f"- {name}: {', '.join(provisional)}")

    weak_date_sources = [s.source.name for s in batch.suggestions if _date_is_weak(s.sources)]
    if weak_date_sources:
        print(
            "Weak date (from file mtime, not confirmed acquisition metadata): "
            + ", ".join(weak_date_sources)
        )

    for reason in batch.skipped:
        print(f"SKIP: {reason}")

    with_issues = [s for s in batch.suggestions if s.issues]
    if with_issues:
        print("Validation summary:")
        for suggestion in with_issues:
            for issue in suggestion.issues:
                print(
                    f"- {suggestion.source.name}: {issue.severity.upper()} "
                    f"[{issue.field}] {issue.message}"
                )

    if args.report:
        print(f"Report written to: {args.report}")

    if args.sidecar:
        if sidecar_rows:
            print(f"Sidecar written to: {args.sidecar}")
        else:
            print("No multi-image containers found; sidecar not written.")

    if args.apply:
        renamed, manifest = apply_batch(input_dir, batch.planned)
        print(f"Renamed {renamed} files.")
        if manifest:
            print(f"Manifest saved to: {manifest}")
    else:
        print("Dry-run only. Add --apply to perform renames.")

    return 0


def cmd_rollback(args: argparse.Namespace) -> int:
    from .manifest import rollback_manifest

    manifest_path = Path(args.manifest)
    input_dir = Path(args.input_dir)

    if not manifest_path.exists():
        print(f"Manifest not found: {manifest_path}")
        return 1

    reverted, errors = rollback_manifest(manifest_path, input_dir)
    print(f"Successfully reverted {reverted} files.")
    for err in errors:
        print(f"Error: {err}")

    return 0 if not errors else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mna",
        description="Micronaut - microscopy file naming assistant",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init-config", help="Create a default naming config file")
    p_init.add_argument("--output", default="naming_scheme.json", help="Path to config JSON")
    p_init.add_argument("--force", action="store_true", help="Overwrite existing config")
    p_init.set_defaults(func=cmd_init_config)

    p_profile = sub.add_parser("init-profile", help="Create a default validation profile")
    p_profile.add_argument("--output", default="profile.json", help="Path to profile JSON")
    p_profile.add_argument("--force", action="store_true", help="Overwrite existing profile")
    p_profile.set_defaults(func=cmd_init_profile)

    p_suggest = sub.add_parser("suggest", help="Suggest a normalized filename for one file")
    p_suggest.add_argument("--input", required=True, help="Source microscopy file")
    p_suggest.add_argument("--config", default="naming_scheme.json", help="Path to config JSON")
    p_suggest.add_argument("--profile", default=None, help="Optional profile JSON path")
    p_suggest.add_argument("--llm", action="store_true", help="Use Ollama if enabled in config")
    p_suggest.add_argument(
        "--llm-model",
        default=None,
        help="Optional Ollama model override (use 'auto' to auto-select local model)",
    )
    p_suggest.add_argument("--strict", action="store_true", help="Fail on validation errors")
    p_suggest.add_argument(
        "--json", action="store_true", help="Print machine-readable JSON instead of text"
    )
    p_suggest.add_argument(
        "--show-metadata",
        action="store_true",
        help="Print the raw metadata read from the file (what Fiji's Show Info displays)",
    )
    p_suggest.add_argument(
        "--describe",
        default=None,
        help="Plain-language description of the experiment, passed to the LLM as context",
    )
    p_suggest.set_defaults(func=cmd_suggest)

    p_batch = sub.add_parser("batch", help="Batch rename files")
    p_batch.add_argument("--input-dir", required=True, help="Folder containing files")
    p_batch.add_argument("--pattern", default="*.tif", help="Glob pattern")
    p_batch.add_argument("--config", default="naming_scheme.json", help="Path to config JSON")
    p_batch.add_argument("--profile", default=None, help="Optional profile JSON path")
    p_batch.add_argument("--llm", action="store_true", help="Use Ollama if enabled in config")
    p_batch.add_argument(
        "--llm-model",
        default=None,
        help="Optional Ollama model override (use 'auto' to auto-select local model)",
    )
    p_batch.add_argument(
        "--describe",
        default=None,
        help="Plain-language description of the experiment, passed to the LLM as context",
    )
    p_batch.add_argument("--strict", action="store_true", help="Skip files with validation errors")
    p_batch.add_argument(
        "--conflict-strategy",
        choices=["suffix", "skip", "fail"],
        default="suffix",
        help="How to handle filename collisions",
    )
    p_batch.add_argument("--apply", action="store_true", help="Actually rename files")
    p_batch.add_argument(
        "--recursive",
        action="store_true",
        help="Recurse into subfolders (default: top folder only)",
    )
    p_batch.add_argument(
        "--json", action="store_true", help="Print machine-readable JSON instead of text"
    )
    p_batch.add_argument(
        "--report",
        default=None,
        help="Write a source/target/issues report for the planned batch "
        "(CSV, or JSON if the path ends in .json)",
    )
    p_batch.add_argument(
        "--sidecar",
        default=None,
        help="Write a per-series CSV/JSON for multi-image containers such as "
        "LIF/ND2/CZI (JSON if the path ends in .json)",
    )
    p_batch.set_defaults(func=cmd_batch)

    p_rollback = sub.add_parser("rollback", help="Revert a batch renaming using a manifest")
    p_rollback.add_argument("--manifest", required=True, help="Path to JSON manifest")
    p_rollback.add_argument(
        "--input-dir", required=True, help="Folder containing the renamed files"
    )
    p_rollback.set_defaults(func=cmd_rollback)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
