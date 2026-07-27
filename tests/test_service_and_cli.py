from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

import microscopy_naming_assistant.cli as cli
import microscopy_naming_assistant.metadata as metadata
import microscopy_naming_assistant.service as service
from microscopy_naming_assistant.cli import build_parser
from microscopy_naming_assistant.config import default_config, save_config
from microscopy_naming_assistant.naming import finalize_fields, render_name
from microscopy_naming_assistant.profiles import default_profile, save_profile
from microscopy_naming_assistant.validation import ValidationIssue


def test_plan_batch_strict_skips_validation_errors(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    f1 = tmp_path / "a.tif"
    f2 = tmp_path / "b.tif"
    f1.write_bytes(b"a")
    f2.write_bytes(b"b")

    def fake_suggest(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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

    def fake_suggest(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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
    # The default "suffix" strategy no longer uses a bare `_NN` counter (A4):
    # two DIFFERENT sources colliding on the same target must get a
    # distinguishable (content-derived) suffix instead of ambiguous `_01`.
    other = [t for t in targets if t != "DUPLICATE.tif"]
    assert len(other) == 1
    assert re.fullmatch(r"DUPLICATE_[0-9a-f]{8}\.tif", other[0])
    assert other[0] != "DUPLICATE_01.tif"


def test_plan_batch_suffix_numeric_keeps_legacy_bare_counter(tmp_path: Path, monkeypatch) -> None:
    """The legacy `_NN` behaviour stays reachable via conflict_strategy='suffix_numeric'."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    f1 = tmp_path / "a.tif"
    f2 = tmp_path / "b.tif"
    f1.write_bytes(b"a")
    f2.write_bytes(b"b")

    def fake_suggest(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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
        conflict_strategy="suffix_numeric",
    )
    targets = [p[1].name for p in result.planned]
    assert "DUPLICATE.tif" in targets
    assert "DUPLICATE_01.tif" in targets


def test_recalculate_batch_treats_case_only_targets_as_colliding(tmp_path: Path) -> None:
    """On Windows, 'A.tif' and 'a.tif' are the SAME file -- two suggestions
    that render to targets differing only by case must not both plan as
    non-colliding, or the second apply_batch rename would silently overwrite
    the first (A4 point 2)."""
    src_a = tmp_path / "one.tif"
    src_b = tmp_path / "two.tif"
    src_a.write_bytes(b"a")
    src_b.write_bytes(b"b")

    suggestion_a = service.SuggestionResult(source=src_a, target_name="A.tif", fields={}, issues=[])
    suggestion_b = service.SuggestionResult(source=src_b, target_name="a.tif", fields={}, issues=[])

    result = service.recalculate_batch(input_dir=tmp_path, suggestions=[suggestion_a, suggestion_b])

    assert len(result.planned) == 2
    target_names = [dst.name for _, dst in result.planned]
    # The two planned targets must not be a case-only pair -- casefolding
    # them must yield two DISTINCT keys, or apply_batch's rename loop would
    # have the second rename silently collide with/overwrite the first on a
    # real Windows filesystem.
    casefolded = {name.casefold() for name in target_names}
    assert len(casefolded) == 2


def test_recalculate_batch_warns_on_max_path_exceeded(tmp_path: Path) -> None:
    """A full target path over 260 chars must surface a ValidationIssue, not
    be silently truncated (A4 point 3)."""
    long_name = "A" * 300 + ".tif"
    src = tmp_path / "short.tif"
    src.write_bytes(b"x")

    suggestion = service.SuggestionResult(source=src, target_name=long_name, fields={}, issues=[])

    result = service.recalculate_batch(input_dir=tmp_path, suggestions=[suggestion])

    assert len(result.planned) == 1
    _, dst = result.planned[0]
    # Never truncated: the full (unsafe) name must survive intact.
    assert dst.name == long_name
    assert any(
        issue.severity == "warning" and "MAX_PATH" in issue.message for issue in suggestion.issues
    )


def test_recalculate_batch_does_not_warn_on_short_path(tmp_path: Path) -> None:
    src = tmp_path / "short.tif"
    src.write_bytes(b"x")
    suggestion = service.SuggestionResult(
        source=src, target_name="short_result.tif", fields={}, issues=[]
    )

    service.recalculate_batch(input_dir=tmp_path, suggestions=[suggestion])

    assert not any("MAX_PATH" in issue.message for issue in suggestion.issues)


def test_plan_batch_default_is_not_recursive(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    top = tmp_path / "a.tif"
    top.write_bytes(b"a")
    nested_dir = tmp_path / "sub"
    nested_dir.mkdir()
    nested = nested_dir / "b.tif"
    nested.write_bytes(b"b")

    def fake_suggest(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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

    def fake_suggest(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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


def _fake_suggest_renamed_prefix(
    file_path,
    config_path,
    use_llm=False,
    profile_path=None,
    llm_model_override=None,
    user_description=None,
):
    return service.SuggestionResult(
        source=file_path,
        target_name=f"RENAMED_{file_path.name}",
        fields={},
        issues=[],
    )


def test_plan_batch_excludes_own_ledger_and_history_survives_broad_pattern(
    tmp_path: Path, monkeypatch
) -> None:
    """A8: reproduces the proven self-consumption defect. A broad pattern
    (`*`) run in a folder that already has a real ledger must NEVER plan a
    rename of `.original_names.json` itself -- doing so lets `apply_batch`
    physically rename the ledger file, so `update_ledger` finds it missing,
    silently degrades to `{}`, and overwrites it with a brand-new
    history-free ledger, permanently orphaning every prior batch's
    true-original mapping. A real data file and a plain user `.json` file
    must still be planned -- the exclusion must not over-filter."""
    from microscopy_naming_assistant import original_name

    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    input_dir = tmp_path / "data"
    input_dir.mkdir()

    # Pre-existing ledger holding REAL history from a prior batch: this file
    # was already renamed once, from "important_file_A.tif" to "A_renamed.tif".
    important = input_dir / "A_renamed.tif"
    important.write_bytes(b"a")
    original_name.update_ledger(input_dir, [(input_dir / "important_file_A.tif", important)])
    assert original_name.load_ledger(input_dir) == {"A_renamed.tif": "important_file_A.tif"}

    # A legitimate user file that merely happens to have a `.json` extension
    # -- must NOT be swept up by the ledger exclusion.
    user_json = input_dir / "user_data.json"
    user_json.write_bytes(b"{}")

    monkeypatch.setattr(service, "suggest_for_file", _fake_suggest_renamed_prefix)

    batch = service.plan_batch(input_dir=input_dir, pattern="*", config_path=config_path)

    planned_source_names = {src.name for src, _ in batch.planned}
    # The ledger itself must never be a rename candidate...
    assert original_name.LEDGER_FILENAME not in planned_source_names
    # ...while the real data file it describes, and an ordinary user .json
    # file, are still planned like any other match.
    assert "A_renamed.tif" in planned_source_names
    assert "user_data.json" in planned_source_names

    # Exactly the real, non-excluded files got planned -- no more, no fewer.
    real_files = [
        p for p in input_dir.iterdir() if p.is_file() and p.name != original_name.LEDGER_FILENAME
    ]
    assert len(batch.planned) == len(real_files)

    service.apply_batch(input_dir, batch.planned)

    # The ledger file was never renamed off its well-known path.
    assert original_name.ledger_path(input_dir).exists()

    ledger_after = original_name.load_ledger(input_dir)
    # The stale intermediate key is gone (the file really was renamed away)...
    assert "A_renamed.tif" not in ledger_after
    # ...but the TRUE ORIGINAL mapping survived the batch, correctly chained
    # forward to whatever "A_renamed.tif" became.
    assert ledger_after.get("RENAMED_A_renamed.tif") == "important_file_A.tif"


def test_plan_batch_excludes_manifests_dir_under_recursive(tmp_path: Path, monkeypatch) -> None:
    """A8: `.manifests/` holds A1's rollback journals. Under `recursive=True`
    a broad pattern must not sweep them into the plan the way it must not
    sweep up the ledger."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    input_dir = tmp_path / "data"
    input_dir.mkdir()

    real = input_dir / "sample.tif"
    real.write_bytes(b"x")

    manifests_dir = input_dir / ".manifests"
    manifests_dir.mkdir()
    journal = manifests_dir / "rename_manifest_20260101_000000.json"
    journal.write_text("[]", encoding="utf-8")

    monkeypatch.setattr(service, "suggest_for_file", _fake_suggest_renamed_prefix)

    batch = service.plan_batch(
        input_dir=input_dir, pattern="*", config_path=config_path, recursive=True
    )

    planned_sources = {src for src, _ in batch.planned}
    assert journal not in planned_sources
    assert real in planned_sources
    assert len(batch.planned) == 1

    service.apply_batch(input_dir, batch.planned)

    # The journal was never touched.
    assert journal.exists()
    assert journal.read_text(encoding="utf-8") == "[]"


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


def test_apply_batch_empty_plan_returns_zero_and_none(tmp_path: Path) -> None:
    renamed, manifest_path = service.apply_batch(tmp_path, [])
    assert (renamed, manifest_path) == (0, None)


def test_apply_batch_all_noop_plan_returns_zero_and_none(tmp_path: Path) -> None:
    same = tmp_path / "same.tif"
    same.write_bytes(b"x")

    renamed, manifest_path = service.apply_batch(tmp_path, [(same, same)])
    assert (renamed, manifest_path) == (0, None)
    assert same.exists()


def test_apply_batch_rolls_back_on_mid_batch_failure(tmp_path: Path, monkeypatch) -> None:
    """A.1's core guarantee: a failure partway through a batch must leave the
    filesystem exactly as it started (all-or-nothing), the ORIGINAL exception
    must propagate to the caller unchanged, and the manifest written BEFORE
    any rename (the intent journal) must still be on disk describing the
    full attempted batch."""
    files = []
    for i in range(4):
        p = tmp_path / f"f{i}.tif"
        p.write_bytes(b"x")
        files.append(p)
    targets = [tmp_path / f"g{i}.tif" for i in range(4)]
    planned = list(zip(files, targets))

    original_rename = Path.rename
    call_count = {"n": 0}

    def flaky_rename(self, target):
        call_count["n"] += 1
        if call_count["n"] == 3:
            raise OSError("simulated failure at file 3")
        return original_rename(self, target)

    monkeypatch.setattr(Path, "rename", flaky_rename)

    with pytest.raises(OSError, match="simulated failure at file 3"):
        service.apply_batch(tmp_path, planned)

    # Every already-renamed file (the first two) is back at its original name.
    for src in files:
        assert src.exists()
    for dst in targets:
        assert not dst.exists()

    # The intent journal was written before any rename and still describes
    # the full attempted batch, even though the batch itself failed.
    manifest_files = list((tmp_path / ".manifests").glob("rename_manifest_*.json"))
    assert len(manifest_files) == 1
    manifest_data = json.loads(manifest_files[0].read_text(encoding="utf-8"))
    assert len(manifest_data) == 4


def test_apply_batch_surfaces_unrestorable_files_when_rollback_fails(
    tmp_path: Path, monkeypatch
) -> None:
    """If the undo itself fails, that failure must never be swallowed: the
    raised error must name the file that could not be restored, and it must
    be chained from the original failure rather than replacing it."""
    f0 = tmp_path / "f0.tif"
    f1 = tmp_path / "f1.tif"
    f0.write_bytes(b"x")
    f1.write_bytes(b"x")
    g0 = tmp_path / "g0.tif"
    g1 = tmp_path / "g1.tif"
    planned = [(f0, g0), (f1, g1)]

    original_rename = Path.rename
    call_count = {"n": 0}

    def flaky_rename(self, target):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise OSError("simulated failure at file 2")
        if call_count["n"] > 2:
            # Every rename attempted while unwinding (rollback) also fails.
            raise OSError("simulated rollback failure")
        return original_rename(self, target)

    monkeypatch.setattr(Path, "rename", flaky_rename)

    with pytest.raises(RuntimeError, match="could not fully restore") as excinfo:
        service.apply_batch(tmp_path, planned)

    assert isinstance(excinfo.value.__cause__, OSError)
    assert "simulated failure at file 2" in str(excinfo.value.__cause__)
    assert "g0.tif" in str(excinfo.value)

    # f0->g0's rollback failed, so g0 is left in its renamed state (surfaced,
    # not silently lost); f1 was never touched.
    assert g0.exists()
    assert not f0.exists()
    assert f1.exists()
    assert not g1.exists()


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
    args = parser.parse_args(["suggest", "--input", "x.tif", "--config", "cfg.json", "--json"])
    assert args.json is True


def test_cmd_suggest_json_prints_single_json_object(tmp_path: Path, monkeypatch, capsys) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_suggest_for_file(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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
    assert payload["issues"] == [{"field": "sample", "message": "looks odd", "severity": "warning"}]
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

    def fake_suggest_for_file(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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

    def fake_suggest_for_file(
        file_path,
        config_path,
        use_llm=False,
        profile_path=None,
        llm_model_override=None,
        user_description=None,
    ):
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
        user_description=None,
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
        user_description=None,
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
        user_description=None,
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


def test_cmd_batch_report_json_parses_to_expected_list(tmp_path: Path, monkeypatch, capsys) -> None:
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
        user_description=None,
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


def _fake_plan_batch_returning(fake_batch: service.BatchResult):
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
        user_description=None,
    ):
        return fake_batch

    return fake_plan_batch


def test_cmd_batch_sidecar_csv_writes_series_rows(tmp_path: Path, monkeypatch, capsys) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "container.lif"
    target = tmp_path / "Container.lif"
    sidecar_path = tmp_path / "series.csv"

    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={},
        issues=[],
        images=[
            {"index": "0", "name": "Series001"},
            {"index": "1", "name": "Series002"},
            {"index": "2", "name": "Series003"},
            {"index": "3", "name": "Series004"},
        ],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=[],
    )
    monkeypatch.setattr(cli, "plan_batch", _fake_plan_batch_returning(fake_batch))

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--sidecar",
            str(sidecar_path),
        ]
    )
    exit_code = cli.cmd_batch(args)
    assert exit_code == 0

    assert sidecar_path.exists()
    lines = sidecar_path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "source,series_index,internal_name,suggested_name"
    assert len(lines) == 5  # header + 4 per-series rows

    captured = capsys.readouterr()
    assert f"Sidecar written to: {sidecar_path}" in captured.out


def test_cmd_batch_sidecar_json_parses_to_expected_list(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "container.lif"
    target = tmp_path / "Container.lif"
    sidecar_path = tmp_path / "series.json"

    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={},
        issues=[],
        images=[
            {"index": "0", "name": "Series001"},
            {"index": "1", "name": "Series002"},
            {"index": "2", "name": "Series003"},
            {"index": "3", "name": "Series004"},
        ],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=[],
    )
    monkeypatch.setattr(cli, "plan_batch", _fake_plan_batch_returning(fake_batch))

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--sidecar",
            str(sidecar_path),
        ]
    )
    exit_code = cli.cmd_batch(args)
    assert exit_code == 0

    payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert isinstance(payload, list)
    assert len(payload) == 4
    for row in payload:
        assert set(row.keys()) == {"source", "series_index", "internal_name", "suggested_name"}


def test_cmd_batch_sidecar_no_multi_image_records_writes_nothing(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "a.tif"
    target = tmp_path / "A.tif"
    sidecar_path = tmp_path / "series.csv"

    # A single-image file (or one with no per-image records at all) has
    # nothing extra to say -- build_series_rows must contribute no rows.
    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={},
        issues=[],
        images=[],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=[],
    )
    monkeypatch.setattr(cli, "plan_batch", _fake_plan_batch_returning(fake_batch))

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--sidecar",
            str(sidecar_path),
        ]
    )
    exit_code = cli.cmd_batch(args)
    assert exit_code == 0
    assert not sidecar_path.exists()

    captured = capsys.readouterr()
    assert "No multi-image containers found" in captured.out


def test_cmd_batch_sidecar_does_not_affect_apply_or_manifest(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    # Target differs by more than case: apply_batch's `src == dst` skip-guard
    # compares WindowsPath equality, which normalizes case, so a case-only
    # rename (e.g. container.lif -> Container.lif) would be treated as a
    # no-op on Windows and never hit `src.rename(dst)`.
    source = tmp_path / "container.lif"
    target = tmp_path / "container_renamed.lif"
    source.write_bytes(b"fake-lif-bytes")
    sidecar_path = tmp_path / "series.csv"

    # 4 per-image records would produce 4 sidecar rows -- proving the real
    # `apply_batch` only ever sees the 1-entry `planned` list (never the
    # sidecar rows) is the point of this test.
    suggestion = service.SuggestionResult(
        source=source,
        target_name=target.name,
        fields={},
        issues=[],
        images=[
            {"index": "0", "name": "Series001"},
            {"index": "1", "name": "Series002"},
            {"index": "2", "name": "Series003"},
            {"index": "3", "name": "Series004"},
        ],
    )
    fake_batch = service.BatchResult(
        planned=[(source, target)],
        suggestions=[suggestion],
        skipped=[],
    )
    monkeypatch.setattr(cli, "plan_batch", _fake_plan_batch_returning(fake_batch))

    parser = build_parser()
    args = parser.parse_args(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--config",
            str(config_path),
            "--sidecar",
            str(sidecar_path),
            "--apply",
        ]
    )
    exit_code = cli.cmd_batch(args)
    assert exit_code == 0

    assert not source.exists()
    assert target.exists()

    manifests = list((tmp_path / ".manifests").glob("rename_manifest_*.json"))
    assert len(manifests) == 1

    captured = capsys.readouterr()
    assert "Renamed 1 files." in captured.out
    assert "Manifest saved to:" in captured.out


def test_suggest_for_file_forwards_configured_timeout(tmp_path: Path, monkeypatch) -> None:
    config = default_config()
    config.extraction_timeout_seconds = 7
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    captured_kwargs: dict = {}

    def fake_extract_metadata_detailed(file_path, **kwargs):
        captured_kwargs.update(kwargs)
        return {}, {}, metadata.ExtractionDetail()

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

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

    def fake_extract_metadata_detailed(file_path, **kwargs):
        return (
            {"markers": "GFP", "sample": "E05"},
            {"markers": "metadata", "sample": "metadata"},
            metadata.ExtractionDetail(),
        )

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

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

    def fake_extract_metadata_detailed(file_path, **kwargs):
        return (
            {"date": "2025-01-02", "sample": "E03"},
            {"date": "filename", "sample": "filename"},
            metadata.ExtractionDetail(),
        )

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    # markers/notes were never in `extracted`, so they must come from
    # config.defaults inside finalize_fields and be tagged "default".
    assert result.sources["markers"] == "default"
    assert result.sources["notes"] == "default"


def test_suggest_for_file_tags_filename_derived_date_as_filename(
    tmp_path: Path, monkeypatch
) -> None:
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract_metadata_detailed(file_path, **kwargs):
        return (
            {"date": "2025-01-02", "sample": "E03"},
            {"date": "filename", "sample": "filename"},
            metadata.ExtractionDetail(),
        )

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    assert result.sources["date"] == "filename"
    assert result.sources["sample"] == "filename"
    assert "ext" not in result.sources


def test_llm_cannot_overwrite_a_field_read_from_the_file(tmp_path: Path, monkeypatch) -> None:
    # The LLM is an enhancer: a value actually extracted from the file always
    # wins over one the model proposes, no matter how confident the model is.
    config = default_config()
    config.llm["enabled"] = True
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract(file_path, **kwargs):
        return (
            {"markers": "GFP", "sample": "E03"},
            {"markers": "metadata", "sample": "metadata"},
            metadata.ExtractionDetail(metadata_text="ChannelName = GFP"),
        )

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract)
    monkeypatch.setattr(
        service, "suggest_fields_with_ollama", lambda **kwargs: {"markers": "MCHERRY"}
    )

    result = service.suggest_for_file(file_path=source, config_path=config_path, use_llm=True)

    assert result.fields["markers"] == "GFP"
    assert result.sources["markers"] == "metadata"


def test_suggest_for_file_passes_metadata_text_to_llm(tmp_path: Path, monkeypatch) -> None:
    config = default_config()
    config.llm["enabled"] = True
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")
    captured: dict = {}

    def fake_extract(file_path, **kwargs):
        return {}, {}, metadata.ExtractionDetail(metadata_text="ObjectiveName = 93x")

    def fake_llm(**kwargs):
        captured.update(kwargs)
        return {}

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract)
    monkeypatch.setattr(service, "suggest_fields_with_ollama", fake_llm)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
        use_llm=True,
        user_description="93x glycerol objective",
    )

    assert captured["metadata_text"] == "ObjectiveName = 93x"
    assert captured["user_description"] == "93x glycerol objective"
    assert result.metadata_text == "ObjectiveName = 93x"


def test_suggest_for_file_tags_llm_filled_field_as_llm(tmp_path: Path, monkeypatch) -> None:
    config = default_config()
    config.llm["enabled"] = True
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract_metadata_detailed(file_path, **kwargs):
        return (
            {"date": "2025-01-02", "sample": "E03"},
            {"date": "filename", "sample": "filename"},
            metadata.ExtractionDetail(),
        )

    def fake_suggest_fields_with_ollama(**kwargs):
        return {"markers": "GFP"}

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)
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
    # The default profile's magnification_pattern is now a permissive
    # alphanumeric pattern (P3-4b), so use a value that still violates it.
    # A hyphen survives config.safe_char_pattern's sanitization (unlike e.g.
    # "!", which sanitize_token would strip before validation ever sees it)
    # but is not in the alphanumeric-only magnification_pattern.
    config.defaults["magnification"] = "90-X"
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


def test_suggest_for_file_passes_profile_field_key_map_to_extraction(
    tmp_path: Path, monkeypatch
) -> None:
    """Touchpoint (e): profile.field_key_map must reach extract_metadata_detailed."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    profile = default_profile()
    profile.field_key_map = {"markers": "ChannelName", "sample": "Sample"}
    profile_path = tmp_path / "profile.json"
    save_profile(profile_path, profile)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    captured_kwargs: dict = {}

    def fake_extract_metadata_detailed(file_path, **kwargs):
        captured_kwargs.update(kwargs)
        return {}, {}, metadata.ExtractionDetail()

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

    service.suggest_for_file(
        file_path=source,
        config_path=config_path,
        profile_path=profile_path,
    )

    assert captured_kwargs.get("field_key_map") == {"markers": "ChannelName", "sample": "Sample"}


def test_suggest_for_file_field_key_map_is_none_without_profile(
    tmp_path: Path, monkeypatch
) -> None:
    """No profile means no field key map: extraction must receive None, not {}."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    captured_kwargs: dict = {}

    def fake_extract_metadata_detailed(file_path, **kwargs):
        captured_kwargs.update(kwargs)
        return {}, {}, metadata.ExtractionDetail()

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

    service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    assert captured_kwargs.get("field_key_map") is None


def test_suggest_for_file_copies_key_provenance_from_extraction_detail(
    tmp_path: Path, monkeypatch
) -> None:
    """SuggestionResult.key_paths/field_key_provenance mirror ExtractionDetail."""
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, default_config())

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    detail = metadata.ExtractionDetail(
        key_paths={"ChannelName": "GFP"},
        field_key_provenance={"markers": "ChannelName"},
    )

    def fake_extract_metadata_detailed(file_path, **kwargs):
        return {}, {}, detail

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract_metadata_detailed)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
    )

    assert result.key_paths == {"ChannelName": "GFP"}
    assert result.field_key_provenance == {"markers": "ChannelName"}


def _make_multi_series_suggestion(tmp_path: Path, config) -> service.SuggestionResult:
    source = tmp_path / "container.lif"
    source.write_bytes(b"x")
    # magnification is deliberately absent from the container-level fields --
    # this stands in for a real container where series disagree (a 20x
    # overview and a 40x closeup) so `_shared_fields` had to omit it.
    fields = finalize_fields(
        source,
        {"date": "2025-06-01", "exptype": "CT", "sample": "E01", "markers": "GFP"},
        config,
    )
    return service.SuggestionResult(
        source=source,
        target_name=render_name(fields, config),
        fields=fields,
        issues=[],
        images=[
            {"index": "0", "name": "Series001_overview", "magnification": "X20"},
            {"index": "1", "name": "Series002_overview", "magnification": "X20"},
            {"index": "2", "name": "Series003_closeup", "magnification": "X40"},
            {"index": "3", "name": "Series004_closeup", "magnification": "X40"},
        ],
    )


def test_build_series_rows_yields_one_row_per_image_with_series_specific_names(
    tmp_path: Path,
) -> None:
    config = default_config()
    suggestion = _make_multi_series_suggestion(tmp_path, config)

    rows = service.build_series_rows([suggestion], config)

    assert len(rows) == 4
    assert all(row["source"] == suggestion.source.name for row in rows)
    for row in rows:
        assert list(row.keys()) == ["source", "series_index", "internal_name", "suggested_name"]

    by_index = {row["series_index"]: row for row in rows}
    assert by_index["0"]["internal_name"] == "Series001_overview"
    assert by_index["2"]["internal_name"] == "Series003_closeup"

    x20_name = by_index["0"]["suggested_name"]
    x40_name = by_index["2"]["suggested_name"]
    assert "X20" in x20_name
    assert "X40" in x40_name
    assert x20_name != x40_name


def test_build_series_rows_skips_single_image_containers(tmp_path: Path) -> None:
    config = default_config()
    source = tmp_path / "single.tif"
    source.write_bytes(b"x")
    fields = finalize_fields(source, {"sample": "E01"}, config)
    suggestion = service.SuggestionResult(
        source=source,
        target_name=render_name(fields, config),
        fields=fields,
        issues=[],
        images=[{"index": "0", "name": "OnlySeries", "magnification": "X20"}],
    )

    rows = service.build_series_rows([suggestion], config)

    assert rows == []


def test_build_series_rows_never_leaks_into_batch_planned(tmp_path: Path) -> None:
    """THE SAFETY GATE: sidecar rows must never become extra rename entries.

    apply_batch does an unguarded `src.rename(dst)` in a loop, so if the 4
    per-series rows this suggestion produces ever leaked into
    `BatchResult.planned`, the same source path would appear 4 times and the
    second `rename` call would raise `FileNotFoundError`, aborting the batch
    before `save_manifest` runs and leaving the first rename unrollbackable.
    """
    config = default_config()
    suggestion = _make_multi_series_suggestion(tmp_path, config)

    rows = service.build_series_rows([suggestion], config)
    assert len(rows) == 4  # sanity: the sidecar view really has 4 entries

    batch = service.recalculate_batch(input_dir=tmp_path, suggestions=[suggestion])

    assert len(batch.planned) == 1
    assert [src for src, _ in batch.planned] == [suggestion.source]
