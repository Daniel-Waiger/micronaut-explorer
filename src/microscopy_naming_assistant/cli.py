from __future__ import annotations

import argparse
from pathlib import Path

from .config import default_config, load_config, save_config
from .llm import suggest_fields_with_ollama
from .metadata import extract_metadata
from .naming import build_filename


def _iter_files(input_dir: Path, pattern: str) -> list[Path]:
    return [p for p in input_dir.rglob(pattern) if p.is_file()]


def cmd_init_config(args: argparse.Namespace) -> int:
    config = default_config()
    output = Path(args.output)
    if output.exists() and not args.force:
        print(f"Config already exists at {output}. Use --force to overwrite.")
        return 1
    save_config(output, config)
    print(f"Wrote default config to {output}")
    return 0


def _suggest_name(file_path: Path, config_path: Path, use_llm: bool) -> tuple[str, dict[str, str]]:
    config = load_config(config_path)
    fields = extract_metadata(file_path)

    if use_llm and bool(config.llm.get("enabled", False)):
        llm_fields = suggest_fields_with_ollama(
            current_fields=fields,
            original_name=file_path.name,
            endpoint=str(config.llm["endpoint"]),
            model=str(config.llm["model"]),
            timeout_seconds=int(config.llm.get("timeout_seconds", 30)),
        )
        fields = {**fields, **llm_fields}

    new_name = build_filename(file_path, fields, config)
    return new_name, fields


def cmd_suggest(args: argparse.Namespace) -> int:
    source = Path(args.input)
    config_path = Path(args.config)

    if not source.exists():
        print(f"Input file not found: {source}")
        return 1

    new_name, fields = _suggest_name(source, config_path, use_llm=args.llm)
    print(f"Source: {source.name}")
    print(f"Suggested: {new_name}")
    print(f"Fields: {fields}")
    return 0


def cmd_batch(args: argparse.Namespace) -> int:
    input_dir = Path(args.input_dir)
    config_path = Path(args.config)

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}")
        return 1

    files = _iter_files(input_dir, args.pattern)
    if not files:
        print("No matching files found.")
        return 0

    collisions: set[Path] = set()
    planned: list[tuple[Path, Path]] = []

    for f in files:
        new_name, _ = _suggest_name(f, config_path, use_llm=args.llm)
        target = f.with_name(new_name)
        if target in collisions:
            print(f"Skipping due to duplicate target name: {target.name}")
            continue
        collisions.add(target)
        planned.append((f, target))

    for src, dst in planned:
        print(f"{src.name} -> {dst.name}")

    if args.apply:
        for src, dst in planned:
            if src == dst:
                continue
            src.rename(dst)
        print(f"Renamed {len(planned)} files.")
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

    p_suggest = sub.add_parser("suggest", help="Suggest a normalized filename for one file")
    p_suggest.add_argument("--input", required=True, help="Source microscopy file")
    p_suggest.add_argument("--config", default="naming_scheme.json", help="Path to config JSON")
    p_suggest.add_argument("--llm", action="store_true", help="Use Ollama if enabled in config")
    p_suggest.set_defaults(func=cmd_suggest)

    p_batch = sub.add_parser("batch", help="Batch rename files")
    p_batch.add_argument("--input-dir", required=True, help="Folder containing files")
    p_batch.add_argument("--pattern", default="*.tif", help="Glob pattern")
    p_batch.add_argument("--config", default="naming_scheme.json", help="Path to config JSON")
    p_batch.add_argument("--llm", action="store_true", help="Use Ollama if enabled in config")
    p_batch.add_argument("--apply", action="store_true", help="Actually rename files")
    p_batch.set_defaults(func=cmd_batch)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
