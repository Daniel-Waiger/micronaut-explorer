from __future__ import annotations

import argparse
from pathlib import Path

from .config import default_config, save_config
from .profiles import default_profile, save_profile
from .service import apply_batch, plan_batch, suggest_for_file


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
    )

    print(f"Source: {source.name}")
    print(f"Suggested: {result.target_name}")
    print(f"Fields: {result.fields}")

    if result.issues:
        print("Validation:")
        for issue in result.issues:
            print(f"- {issue.severity.upper()} [{issue.field}] {issue.message}")

        if args.strict and any(i.severity == "error" for i in result.issues):
            print("Strict mode: suggestion blocked due to validation errors.")
            return 2

    return 0


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
        use_llm=args.llm,
        profile_path=profile_path,
        strict=args.strict,
    )

    if not batch.suggestions:
        print("No matching files found.")
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

    if args.apply:
        renamed = apply_batch(batch.planned)
        print(f"Renamed {renamed} files.")
    else:
        print("Dry-run only. Add --apply to perform renames.")

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mna",
        description="Microscopy Naming Assistant",
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
    p_suggest.add_argument("--strict", action="store_true", help="Fail on validation errors")
    p_suggest.set_defaults(func=cmd_suggest)

    p_batch = sub.add_parser("batch", help="Batch rename files")
    p_batch.add_argument("--input-dir", required=True, help="Folder containing files")
    p_batch.add_argument("--pattern", default="*.tif", help="Glob pattern")
    p_batch.add_argument("--config", default="naming_scheme.json", help="Path to config JSON")
    p_batch.add_argument("--profile", default=None, help="Optional profile JSON path")
    p_batch.add_argument("--llm", action="store_true", help="Use Ollama if enabled in config")
    p_batch.add_argument("--strict", action="store_true", help="Skip files with validation errors")
    p_batch.add_argument("--apply", action="store_true", help="Actually rename files")
    p_batch.set_defaults(func=cmd_batch)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
