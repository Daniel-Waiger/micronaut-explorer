from __future__ import annotations

from pathlib import Path

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


def test_apply_batch_renames_files(tmp_path: Path) -> None:
    src = tmp_path / "old.tif"
    dst = tmp_path / "new.tif"
    src.write_bytes(b"x")

    renamed = service.apply_batch([(src, dst)])
    assert renamed == 1
    assert dst.exists()
    assert not src.exists()


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
