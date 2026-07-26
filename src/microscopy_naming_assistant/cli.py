from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict
from pathlib import Path

from .config import default_config, save_config
from .profiles import default_profile, save_profile
from .service import BatchResult, apply_batch, plan_batch, suggest_for_file


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
        }
        if args.show_metadata:
            payload["metadata"] = result.metadata_text
        print(json.dumps(payload))
        return 2 if strict_blocked else 0

    print(f"Source: {source.name}")
    print(f"Suggested: {result.target_name}")
    print(f"Fields: {result.fields}")

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


def _write_batch_report(report_path: Path, batch: BatchResult) -> None:
    rows = _batch_report_rows(batch)
    if report_path.suffix.lower() == ".json":
        report_path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    else:
        with report_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["source", "target", "issues"])
            writer.writeheader()
            writer.writerows(rows)


def cmd_batch(args: argparse.Namespace) -> int:
    input_dir = Path(args.input_dir)
    config_path = Path(args.config)
    profile_path = Path(args.profile) if args.profile else None

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}")
        return 1

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
            "applied": args.apply,
            "renamed": renamed,
            "manifest": str(manifest) if manifest else None,
        }
        print(json.dumps(payload))
        return 0

    for src, dst in batch.planned:
        print(f"{src.name} -> {dst.name}")

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
