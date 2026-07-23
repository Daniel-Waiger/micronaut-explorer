from __future__ import annotations

import json
from pathlib import Path

import pytest

import microscopy_naming_assistant.cli as cli
import microscopy_naming_assistant.service as service
from microscopy_naming_assistant.cli import build_parser
from microscopy_naming_assistant.config import default_config, save_config
from microscopy_naming_assistant.profiles import default_profile, save_profile
from microscopy_naming_assistant.validation import ValidationIssue


def test_plan_batch_strict_skips_validation_errors(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    f1 = tmp_path / "a.tif"
    f2 = tmp_path / "b.tif"
    f1.write_bytes(b"a")
    f2.write_bytes(b"b")

    def fake_suggest(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name="SAME.tif",
            fields={},
            issues=[ValidationIssue(field="sample", message="bad", severity="error")],
        )

    monkeypatch.setattr(service, "suggest_for_file", fake_suggest)

    result = service.plan_batch(
        input_dir=tmp_path,
        pattern="*.tif",
        config_path=config_path,
        strict=True,
    )
    assert result.planned == []
    assert len(result.skipped) == 2


def test_plan_batch_detects_collisions(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    f1 = tmp_path / "a.tif"
    f2 = tmp_path / "b.tif"
    f1.write_bytes(b"a")
    f2.write_bytes(b"b")

    def fake_suggest(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name="DUPLICATE.tif",
            fields={},
            issues=[],
        )

    monkeypatch.setattr(service, "suggest_for_file", fake_suggest)

    result = service.plan_batch(
        input_dir=tmp_path,
        pattern="*.tif",
        config_path=config_path,
    )
    assert len(result.planned) == 2
    assert len(result.skipped) == 0
    targets = [p[1].name for p in result.planned]
    assert "DUPLICATE.tif" in targets
    assert "DUPLICATE_01.tif" in targets


def test_plan_batch_default_is_not_recursive(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    top = tmp_path / "a.tif"
    top.write_bytes(b"a")
    nested_dir = tmp_path / "sub"
    nested_dir.mkdir()
    nested = nested_dir / "b.tif"
    nested.write_bytes(b"b")

    def fake_suggest(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name=f"{file_path.stem.upper()}.tif",
            fields={},
            issues=[],
        )

    monkeypatch.setattr(service, "suggest_for_file", fake_suggest)

    result = service.plan_batch(
        input_dir=tmp_path,
        pattern="*.tif",
        config_path=config_path,
    )
    sources = {p[0] for p in result.planned}
    assert sources == {top}


def test_plan_batch_recursive_true_includes_nested_files(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    top = tmp_path / "a.tif"
    top.write_bytes(b"a")
    nested_dir = tmp_path / "sub"
    nested_dir.mkdir()
    nested = nested_dir / "b.tif"
    nested.write_bytes(b"b")

    def fake_suggest(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name=f"{file_path.stem.upper()}.tif",
            fields={},
            issues=[],
        )

    monkeypatch.setattr(service, "suggest_for_file", fake_suggest)

    result = service.plan_batch(
        input_dir=tmp_path,
        pattern="*.tif",
        config_path=config_path,
        recursive=True,
    )
    sources = {p[0] for p in result.planned}
    assert sources == {top, nested}


def test_apply_batch_renames_files(tmp_path: Path) -> None:
    src = tmp_path / "old.tif"
    dst = tmp_path / "new.tif"
    src.write_bytes(b"x")

    renamed, manifest_path = service.apply_batch(tmp_path, [(src, dst)])
    assert renamed == 1
    assert dst.exists()
    assert not src.exists()
    assert manifest_path is not None
    assert manifest_path.exists()


def test_cli_parser_accepts_llm_model_option() -> None:
    parser = build_parser()
    args = parser.parse_args(
        [
            "suggest",
            "--input",
            "x.tif",
            "--config",
            "cfg.json",
            "--llm",
            "--llm-model",
            "llama3.1:8b",
        ]
    )
    assert args.llm is True
    assert args.llm_model == "llama3.1:8b"


def test_cli_parser_accepts_recursive_flag() -> None:
    parser = build_parser()
    args = parser.parse_args(["batch", "--input-dir", "x", "--recursive"])
    assert args.recursive is True


def test_cli_parser_recursive_defaults_to_false() -> None:
    parser = build_parser()
    args = parser.parse_args(["batch", "--input-dir", "x"])
    assert args.recursive is False


def test_cli_parser_accepts_json_flag() -> None:
    parser = build_parser()
    args = parser.parse_args(
        ["suggest", "--input", "x.tif", "--config", "cfg.json", "--json"]
    )
    assert args.json is True


def test_cmd_suggest_json_prints_single_json_object(tmp_path: Path, monkeypatch, capsys) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_suggest_for_file(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name="TEST_E01_GFP.tif",
            fields={"sample": "E01", "markers": "GFP"},
            issues=[ValidationIssue(field="sample", message="looks odd", severity="warning")],
        )

    monkeypatch.setattr(cli, "suggest_for_file", fake_suggest_for_file)

    parser = build_parser()
    args = parser.parse_args(
        ["suggest", "--input", str(source), "--config", str(config_path), "--json"]
    )
    exit_code = cli.cmd_suggest(args)

    captured = capsys.readouterr()
    assert exit_code == 0

    payload = json.loads(captured.out)
    assert payload["source"] == source.name
    assert payload["suggested"] == "TEST_E01_GFP.tif"
    assert payload["fields"] == {"sample": "E01", "markers": "GFP"}
    assert payload["issues"] == [
        {"field": "sample", "message": "looks odd", "severity": "warning"}
    ]
    # Human-readable output must be suppressed in JSON mode.
    assert "Source:" not in captured.out
    assert "Suggested:" not in captured.out


def test_cmd_suggest_json_includes_sources_map(tmp_path: Path, monkeypatch, capsys) -> None:
    """--json must surface per-field provenance so defaulted fields are visible (P2-3b)."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    known_sources = {
        "sample": "filename",
        "markers": "default",
        "notes": "default",
        "date": "metadata",
    }

    def fake_suggest_for_file(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name="TEST_E01_GFP.tif",
            fields={"sample": "E01", "markers": "GFP"},
            issues=[],
            sources=known_sources,
        )

    monkeypatch.setattr(cli, "suggest_for_file", fake_suggest_for_file)

    parser = build_parser()
    args = parser.parse_args(
        ["suggest", "--input", str(source), "--config", str(config_path), "--json"]
    )
    exit_code = cli.cmd_suggest(args)

    captured = capsys.readouterr()
    assert exit_code == 0

    payload = json.loads(captured.out)
    assert payload["sources"] == known_sources


def test_cmd_suggest_json_strict_mode_blocks_without_human_line(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_suggest_for_file(file_path, config_path, use_llm=False, profile_path=None, llm_model_override=None):
        return service.SuggestionResult(
            source=file_path,
            target_name="TEST_E01.tif",
            fields={"sample": "E01"},
            issues=[ValidationIssue(field="sample", message="bad", severity="error")],
        )

    monkeypatch.setattr(cli, "suggest_for_file", fake_suggest_for_file)

    parser = build_parser()
    args = parser.parse_args(
        [
            "suggest",
            "--input",
            str(source),
            "--config",
            str(config_path),
            "--json",
            "--strict",
        ]
    )
    exit_code = cli.cmd_suggest(args)

    captured = capsys.readouterr()
    assert exit_code == 2

    payload = json.loads(captured.out)
    assert payload["issues"] == [{"field": "sample", "message": "bad", "severity": "error"}]
    assert "Strict mode" not in captured.out


def test_cli_parser_accepts_batch_json_flag() -> None:
    parser = build_parser()
    args = parser.parse_args(["batch", "--input-dir", "x", "--json"])
    assert args.json is True


def test_cmd_batch_json_dry_run_prints_single_json_object(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "a.tif"
    target = tmp_path / "A.tif"

    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={"sample": "E01"},
        issues=[ValidationIssue(field="sample", message="looks odd", severity="warning")],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=["b.tif: duplicate target"],
    )

    def fake_plan_batch(
        input_dir,
        pattern,
        config_path,
        recursive=False,
        use_llm=False,
        profile_path=None,
        strict=False,
        llm_model_override=None,
        conflict_strategy="suffix",
    ):
        return fake_batch

    def fake_apply_batch_not_expected(input_dir, planned):
        raise AssertionError("apply_batch must not run in dry-run mode")

    monkeypatch.setattr(cli, "plan_batch", fake_plan_batch)
    monkeypatch.setattr(cli, "apply_batch", fake_apply_batch_not_expected)

    parser = build_parser()
    args = parser.parse_args(
        ["batch", "--input-dir", str(tmp_path), "--config", str(config_path), "--json"]
    )
    exit_code = cli.cmd_batch(args)

    captured = capsys.readouterr()
    assert exit_code == 0

    payload = json.loads(captured.out)
    assert payload["planned"] == [{"source": "a.tif", "target": "A.tif"}]
    assert payload["skipped"] == ["b.tif: duplicate target"]
    assert payload["issues"] == [
        {"source": "a.tif", "field": "sample", "message": "looks odd", "severity": "warning"}
    ]
    assert payload["applied"] is False
    assert payload["renamed"] is None
    assert payload["manifest"] is None

    # Human-readable output must be suppressed in JSON mode.
    assert "SKIP:" not in captured.out
    assert "Validation summary:" not in captured.out
    assert "Dry-run only" not in captured.out
    assert "->" not in captured.out


def test_cmd_batch_json_apply_reports_renamed_and_manifest(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "a.tif"
    target = tmp_path / "A.tif"

    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={"sample": "E01"},
        issues=[],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=["b.tif: duplicate target"],
    )
    manifest_path = tmp_path / ".manifests" / "rename_manifest_fake.json"

    def fake_plan_batch(
        input_dir,
        pattern,
        config_path,
        recursive=False,
        use_llm=False,
        profile_path=None,
        strict=False,
        llm_model_override=None,
        conflict_strategy="suffix",
    ):
        return fake_batch

    def fake_apply_batch(input_dir, planned):
        return 3, manifest_path

    monkeypatch.setattr(cli, "plan_batch", fake_plan_batch)
    monkeypatch.setattr(cli, "apply_batch", fake_apply_batch)

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--json",
            "--apply",
        ]
    )
    exit_code = cli.cmd_batch(args)

    captured = capsys.readouterr()
    assert exit_code == 0

    payload = json.loads(captured.out)
    assert payload["applied"] is True
    assert payload["renamed"] == 3
    assert payload["manifest"] == str(manifest_path)
    assert payload["planned"] == [{"source": "a.tif", "target": "A.tif"}]

    # Human-readable output must be suppressed in JSON mode.
    assert "Renamed" not in captured.out
    assert "Manifest saved" not in captured.out
    assert "->" not in captured.out


def test_cmd_batch_report_csv_writes_source_target_issues(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "a.tif"
    target = tmp_path / "A.tif"
    report_path = tmp_path / "out.csv"

    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={"sample": "E01"},
        issues=[ValidationIssue(field="sample", message="looks odd", severity="warning")],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=[],
    )

    def fake_plan_batch(
        input_dir,
        pattern,
        config_path,
        recursive=False,
        use_llm=False,
        profile_path=None,
        strict=False,
        llm_model_override=None,
        conflict_strategy="suffix",
    ):
        return fake_batch

    monkeypatch.setattr(cli, "plan_batch", fake_plan_batch)

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--report",
            str(report_path),
        ]
    )
    exit_code = cli.cmd_batch(args)
    assert exit_code == 0

    assert report_path.exists()
    lines = report_path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "source,target,issues"
    assert len(lines) == 2
    assert lines[1] == "a.tif,A.tif,warning:sample"

    captured = capsys.readouterr()
    assert f"Report written to: {report_path}" in captured.out


def test_cmd_batch_report_json_parses_to_expected_list(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "a.tif"
    target = tmp_path / "A.tif"
    report_path = tmp_path / "out.json"

    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={"sample": "E01"},
        issues=[],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=[],
    )

    def fake_plan_batch(
        input_dir,
        pattern,
        config_path,
        recursive=False,
        use_llm=False,
        profile_path=None,
        strict=False,
        llm_model_override=None,
        conflict_strategy="suffix",
    ):
        return fake_batch

    monkeypatch.setattr(cli, "plan_batch", fake_plan_batch)

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--report",
            str(report_path),
            "--json",
        ]
    )
    exit_code = cli.cmd_batch(args)
    assert exit_code == 0

    assert report_path.exists()
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert isinstance(payload, list)
    assert payload == [{"source": "a.tif", "target": "A.tif", "issues": ""}]

    # --json mode suppresses the human-readable "Report written to" line.
    captured = capsys.readouterr()
    assert "Report written to" not in captured.out


def test_suggest_for_file_forwards_configured_timeout(tmp_path: Path, monkeypatch) -> None:
    config = default_config()
    config.extraction_timeout_seconds = 7
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    captured_kwargs: dict = {}

    def fake_extract_metadata_with_sources(file_path, **kwargs):
        captured_kwargs.update(kwargs)
        return {}, {}

    monkeypatch.setattr(service, "extract_metadata_with_sources", fake_extract_metadata_with_sources)

    service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    assert captured_kwargs.get("timeout_seconds") == 7


def test_suggest_for_file_unifies_fields_and_name(tmp_path: Path, monkeypatch) -> None:
    """fields and target_name must derive from the same finalized dict (P1-2b)."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract_metadata_with_sources(file_path, **kwargs):
        return {"markers": "GFP", "sample": "E05"}, {"markers": "metadata", "sample": "metadata"}

    monkeypatch.setattr(service, "extract_metadata_with_sources", fake_extract_metadata_with_sources)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    assert result.fields["markers"] == "GFP"
    assert result.fields["sample"] == "E05"
    assert "GFP" in result.target_name
    assert "E05" in result.target_name


def test_suggest_for_file_tags_defaulted_field_as_default(tmp_path: Path, monkeypatch) -> None:
    """A field with no extracted/llm value falls back to config.defaults (P2-3a)."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract_metadata_with_sources(file_path, **kwargs):
        return {"date": "2025-01-02", "sample": "E03"}, {"date": "filename", "sample": "filename"}

    monkeypatch.setattr(service, "extract_metadata_with_sources", fake_extract_metadata_with_sources)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    # markers/notes were never in `extracted`, so they must come from
    # config.defaults inside finalize_fields and be tagged "default".
    assert result.sources["markers"] == "default"
    assert result.sources["notes"] == "default"


def test_suggest_for_file_tags_filename_derived_date_as_filename(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract_metadata_with_sources(file_path, **kwargs):
        return {"date": "2025-01-02", "sample": "E03"}, {"date": "filename", "sample": "filename"}

    monkeypatch.setattr(service, "extract_metadata_with_sources", fake_extract_metadata_with_sources)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    assert result.sources["date"] == "filename"
    assert result.sources["sample"] == "filename"
    assert "ext" not in result.sources


def test_suggest_for_file_tags_llm_overridden_field_as_llm(tmp_path: Path, monkeypatch) -> None:
    config = default_config()
    config.llm["enabled"] = True
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract_metadata_with_sources(file_path, **kwargs):
        return {"date": "2025-01-02", "sample": "E03"}, {"date": "filename", "sample": "filename"}

    def fake_suggest_fields_with_ollama(**kwargs):
        return {"markers": "GFP"}

    monkeypatch.setattr(service, "extract_metadata_with_sources", fake_extract_metadata_with_sources)
    monkeypatch.setattr(service, "suggest_fields_with_ollama", fake_suggest_fields_with_ollama)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
        use_llm=True,
    )

    assert result.fields["markers"] == "GFP"
    assert result.sources["markers"] == "llm"
    # Untouched-by-llm fields keep their original source.
    assert result.sources["date"] == "filename"


@pytest.mark.integration
def test_suggest_for_file_with_profile_generates_issues(tmp_path: Path) -> None:
    config = default_config()
    config.defaults["magnification"] = "90x"
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    profile = default_profile()
    profile_path = tmp_path / "profile.json"
    save_profile(profile_path, profile)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
        use_llm=False,
        profile_path=profile_path,
    )

    assert result.target_name.endswith(".tif")
    assert any(issue.field == "magnification" for issue in result.issues)
