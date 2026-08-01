from __future__ import annotations

import json
from pathlib import Path

import pytest

import microscopy_naming_assistant.service as service
from microscopy_naming_assistant.manifest import rollback_manifest, save_manifest


def test_rollback_manifest_normal_full_rollback(tmp_path: Path) -> None:
    """A plain, uncontested rollback must revert every entry, report the
    correct count, and return an empty error list."""
    src1 = tmp_path / "one.tif"
    src2 = tmp_path / "two.tif"
    dst1 = tmp_path / "one_renamed.tif"
    dst2 = tmp_path / "two_renamed.tif"
    src1.write_bytes(b"content-1")
    src2.write_bytes(b"content-2")

    manifest_path = save_manifest(tmp_path, [(src1, dst1), (src2, dst2)])
    assert manifest_path is not None

    src1.rename(dst1)
    src2.rename(dst2)

    reverted, errors = rollback_manifest(manifest_path, tmp_path)

    assert reverted == 2
    assert errors == []
    assert src1.exists() and src1.read_bytes() == b"content-1"
    assert src2.exists() and src2.read_bytes() == b"content-2"
    assert not dst1.exists()
    assert not dst2.exists()


def test_rollback_manifest_reverse_order_unwinding(tmp_path: Path) -> None:
    """Entries must be undone in reverse of manifest order. We prove this by
    recording the actual order of `rename` calls made during rollback."""
    srcs = [tmp_path / f"src{i}.tif" for i in range(3)]
    dsts = [tmp_path / f"dst{i}.tif" for i in range(3)]
    for src in srcs:
        src.write_bytes(src.name.encode())

    manifest_path = save_manifest(tmp_path, list(zip(srcs, dsts)))
    assert manifest_path is not None

    for src, dst in zip(srcs, dsts):
        src.rename(dst)

    call_order: list[str] = []
    original_rename = Path.rename

    def recording_rename(self: Path, target):
        call_order.append(self.name)
        return original_rename(self, target)

    Path.rename = recording_rename
    try:
        reverted, errors = rollback_manifest(manifest_path, tmp_path)
    finally:
        Path.rename = original_rename

    assert reverted == 3
    assert errors == []
    # dst2 must be renamed back before dst1, before dst0 (reverse of manifest order).
    assert call_order == ["dst2.tif", "dst1.tif", "dst0.tif"]


def test_rollback_manifest_reports_error_when_original_path_is_masked(
    tmp_path: Path,
) -> None:
    """The core regression: if something else now occupies `original` while
    `target` still holds the renamed content, that must be reported as an
    ERROR, not silently skipped as 'already reverted'."""
    src = tmp_path / "a.tif"
    dst = tmp_path / "b.tif"
    src.write_bytes(b"content-A (must not be silently lost)")

    manifest_path = save_manifest(tmp_path, [(src, dst)])
    assert manifest_path is not None

    src.rename(dst)
    assert dst.exists()
    assert not src.exists()

    # Something else -- a second process, a stray file, a careless write --
    # now occupies the ORIGINAL path before rollback runs.
    src.write_bytes(b"STRAY FILE -- unrelated to the original rename")

    reverted, errors = rollback_manifest(manifest_path, tmp_path)

    assert reverted == 0
    assert len(errors) == 1
    assert "a.tif" in errors[0]
    assert "b.tif" in errors[0]

    # Nothing was clobbered or lost: the stray file is untouched and the
    # orphaned content is still visible (surfaced, not silently discarded).
    assert src.read_bytes() == b"STRAY FILE -- unrelated to the original rename"
    assert dst.read_bytes() == b"content-A (must not be silently lost)"


def test_apply_batch_raises_runtime_error_when_rollback_is_masked(
    tmp_path: Path, monkeypatch
) -> None:
    """End-to-end: apply_batch must surface the masked-rollback conflict as
    a RuntimeError naming the affected file, never a bare re-raise of the
    original exception with 0 rollback errors."""
    a = tmp_path / "a.tif"
    a.write_bytes(b"content-A (this is the file that would get silently lost)")
    b = tmp_path / "b.tif"
    c = tmp_path / "c.tif"
    c.write_bytes(b"content-C")
    d = tmp_path / "d.tif"

    planned = [(a, b), (c, d)]

    original_rename = Path.rename

    def flaky(self: Path, target):
        if self.name == "c.tif":
            # Simulate an external actor planting an unrelated stray file at
            # "a.tif" (the ORIGINAL path of the already-completed a->b
            # rename) in the window between a->b succeeding and the
            # exception handler's rollback running.
            a.write_bytes(b"STRAY FILE -- unrelated to the original rename")
            raise OSError("simulated forward failure renaming c.tif -> d.tif")
        return original_rename(self, target)

    monkeypatch.setattr(Path, "rename", flaky)

    with pytest.raises(RuntimeError, match="could not fully restore") as excinfo:
        service.apply_batch(tmp_path, planned)

    assert isinstance(excinfo.value.__cause__, OSError)
    assert "b.tif" in str(excinfo.value)

    # The orphaned content is surfaced on disk, not silently lost.
    assert b.exists()
    assert b.read_bytes() == b"content-A (this is the file that would get silently lost)"
    assert a.read_bytes() == b"STRAY FILE -- unrelated to the original rename"


def test_rollback_manifest_second_run_on_already_reverted_manifest_is_not_an_error(
    tmp_path: Path,
) -> None:
    """A legitimate case: the user runs `mna rollback` against a manifest
    that a previous rollback run already fully reverted. Every target is
    already gone and every original is already back in place -- this must
    be treated as a harmless no-op, not a masking conflict."""
    src = tmp_path / "a.tif"
    dst = tmp_path / "b.tif"
    src.write_bytes(b"content-A")

    manifest_path = save_manifest(tmp_path, [(src, dst)])
    assert manifest_path is not None

    src.rename(dst)

    # First rollback run: genuinely reverts it.
    reverted1, errors1 = rollback_manifest(manifest_path, tmp_path)
    assert reverted1 == 1
    assert errors1 == []
    assert src.exists() and src.read_bytes() == b"content-A"
    assert not dst.exists()

    # Second rollback run against the SAME manifest (e.g. user re-runs
    # `mna rollback` by mistake): target is gone, original already holds the
    # correct content -- must be a silent no-op, not an error.
    reverted2, errors2 = rollback_manifest(manifest_path, tmp_path)
    assert reverted2 == 0
    assert errors2 == []
    assert src.exists() and src.read_bytes() == b"content-A"


def test_rollback_manifest_case_only_rename_reverts_successfully(tmp_path: Path) -> None:
    """A case-only rename ("a.tif" -> "A.tif") is the SAME file on a
    case-insensitive filesystem (Windows/NTFS): `target.exists()` and
    `original.exists()` both report True, but `target.samefile(original)`
    is also True because they are the identical file, not two different
    ones. Rollback must detect this and revert it, not report a false
    occupied-by-a-different-file conflict."""
    src = tmp_path / "a.tif"
    dst = tmp_path / "A.tif"
    src.write_bytes(b"case-only-content")

    # `save_manifest` filters out entries where `src == dst`, and pathlib's
    # WindowsPath equality is case-insensitive (normcase), so a case-only
    # pair never survives that filter. Write the manifest directly instead,
    # the same way the other "both missing" test below does.
    manifest_path = tmp_path / "rename_manifest_case_only.json"
    manifest_path.write_text(
        json.dumps([{"original": "a.tif", "target": "A.tif"}]), encoding="utf-8"
    )

    # Forward rename already completed (case-only).
    src.rename(dst)
    assert dst.exists()
    # On a case-insensitive filesystem this also reports True for the same file.
    assert (tmp_path / "a.tif").exists()

    reverted, errors = rollback_manifest(manifest_path, tmp_path)

    assert errors == []
    assert reverted == 1
    # The lowercase name is restored and content is preserved.
    restored = tmp_path / "a.tif"
    entries = {p.name for p in tmp_path.iterdir() if p.suffix == ".tif"}
    assert entries == {"a.tif"}
    assert restored.read_bytes() == b"case-only-content"


def test_rollback_manifest_samefile_raising_degrades_to_conflict_error(
    tmp_path: Path, monkeypatch
) -> None:
    """Prove the `samefile` guard is load-bearing: if `samefile` itself
    raises OSError (e.g. a path vanishes between the `exists()` check and
    the call), rollback must degrade to the existing conflict-error
    behavior rather than crashing."""
    src = tmp_path / "a.tif"
    dst = tmp_path / "b.tif"
    src.write_bytes(b"content-A (must not be silently lost)")

    manifest_path = save_manifest(tmp_path, [(src, dst)])
    assert manifest_path is not None

    src.rename(dst)
    src.write_bytes(b"STRAY FILE -- unrelated to the original rename")

    def raising_samefile(self: Path, other) -> bool:
        raise OSError("simulated vanished path during samefile check")

    monkeypatch.setattr(Path, "samefile", raising_samefile)

    reverted, errors = rollback_manifest(manifest_path, tmp_path)

    assert reverted == 0
    assert len(errors) == 1
    assert "a.tif" in errors[0]
    assert "b.tif" in errors[0]
    assert src.read_bytes() == b"STRAY FILE -- unrelated to the original rename"
    assert dst.read_bytes() == b"content-A (must not be silently lost)"


def test_rollback_manifest_missing_manifest_and_invalid_json_unchanged(
    tmp_path: Path,
) -> None:
    missing = tmp_path / "does_not_exist.json"
    reverted, errors = rollback_manifest(missing, tmp_path)
    assert (reverted, errors) == (0, ["Manifest not found."])

    bad = tmp_path / "bad.json"
    bad.write_text("{not valid json", encoding="utf-8")
    reverted, errors = rollback_manifest(bad, tmp_path)
    assert (reverted, errors) == (0, ["Invalid JSON manifest."])


def test_rollback_manifest_target_and_original_both_missing_is_reported(
    tmp_path: Path,
) -> None:
    """If neither the target nor the original exists at all (the file is
    genuinely gone), that stays a reportable error, unchanged from before."""
    src = tmp_path / "a.tif"
    dst = tmp_path / "b.tif"
    manifest_path = tmp_path / "rename_manifest_fake.json"
    manifest_path.write_text(
        json.dumps([{"original": "a.tif", "target": "b.tif"}]), encoding="utf-8"
    )

    reverted, errors = rollback_manifest(manifest_path, tmp_path)

    assert reverted == 0
    assert len(errors) == 1
    assert "b.tif" in errors[0]
    assert not src.exists()
    assert not dst.exists()
