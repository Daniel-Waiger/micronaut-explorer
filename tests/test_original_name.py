from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import tifffile

import microscopy_naming_assistant.original_name as original_name
import microscopy_naming_assistant.service as service


def _write_tiff(path: Path, description: str = "") -> None:
    tifffile.imwrite(str(path), np.zeros((4, 4), dtype="uint8"), description=description)


# --- Ledger: basic record -------------------------------------------------


def test_apply_batch_ledger_records_original_to_new(tmp_path: Path) -> None:
    src = tmp_path / "old.tif"
    dst = tmp_path / "new.tif"
    src.write_bytes(b"x")

    service.apply_batch(tmp_path, [(src, dst)])

    ledger = original_name.load_ledger(tmp_path)
    assert ledger == {"new.tif": "old.tif"}
    assert original_name.ledger_path(tmp_path).exists()


def test_ledger_lives_independently_of_manifests_dir(tmp_path: Path) -> None:
    """The ledger must not be nested inside `.manifests/` -- it has to
    survive even if that whole directory is lost or pruned."""
    src = tmp_path / "old.tif"
    dst = tmp_path / "new.tif"
    src.write_bytes(b"x")

    service.apply_batch(tmp_path, [(src, dst)])

    ledger_file = original_name.ledger_path(tmp_path)
    assert ".manifests" not in ledger_file.parts
    assert ledger_file.parent == tmp_path


# --- Ledger: THE MERGE GATE ------------------------------------------------


def test_second_batch_in_same_folder_preserves_first_batchs_ledger_entries(
    tmp_path: Path,
) -> None:
    """Would fail if the code REPLACED the ledger file instead of merging
    into it (cma-lessons E6's map-replacement bug, applied to this ledger)."""
    a_src = tmp_path / "a_old.tif"
    a_dst = tmp_path / "a_new.tif"
    a_src.write_bytes(b"a")
    service.apply_batch(tmp_path, [(a_src, a_dst)])

    first_ledger = original_name.load_ledger(tmp_path)
    assert first_ledger == {"a_new.tif": "a_old.tif"}

    # A wholly unrelated second batch, over different files, in the same
    # folder.
    b_src = tmp_path / "b_old.tif"
    b_dst = tmp_path / "b_new.tif"
    b_src.write_bytes(b"b")
    service.apply_batch(tmp_path, [(b_src, b_dst)])

    merged_ledger = original_name.load_ledger(tmp_path)
    # First batch's entry must still be present, untouched...
    assert merged_ledger["a_new.tif"] == "a_old.tif"
    # ...AND the second batch's entry must also be present.
    assert merged_ledger["b_new.tif"] == "b_old.tif"
    assert len(merged_ledger) == 2


# --- Ledger: chain correctness ---------------------------------------------


def test_file_renamed_twice_keeps_correct_chain_to_true_original(tmp_path: Path) -> None:
    a = tmp_path / "a.tif"
    b = tmp_path / "b.tif"
    c = tmp_path / "c.tif"
    a.write_bytes(b"x")

    service.apply_batch(tmp_path, [(a, b)])
    ledger_after_first = original_name.load_ledger(tmp_path)
    assert ledger_after_first == {"b.tif": "a.tif"}

    service.apply_batch(tmp_path, [(b, c)])
    ledger_after_second = original_name.load_ledger(tmp_path)

    # The chain must resolve all the way back to "a.tif", not just "b.tif".
    assert ledger_after_second["c.tif"] == "a.tif"
    # The stale intermediate key must not linger and orphan the chain.
    assert "b.tif" not in ledger_after_second


# --- Embed: default OFF -----------------------------------------------------


def test_embed_defaults_off_bytes_unchanged(tmp_path: Path) -> None:
    src = tmp_path / "old.tif"
    dst = tmp_path / "new.tif"
    _write_tiff(src, description="")
    original_bytes = src.read_bytes()

    renamed, _ = service.apply_batch(tmp_path, [(src, dst)])

    assert renamed == 1
    assert dst.read_bytes() == original_bytes
    # No embed attempted: the ImageDescription tag is whatever imwrite wrote,
    # not our provenance line.
    assert "Original-Filename" not in (tifffile.tiffcomment(str(dst)) or "")


# --- Embed: enabled, non-TIFF format is skipped -----------------------------


def test_embed_enabled_skips_non_tiff_format_bytes_unchanged(tmp_path: Path) -> None:
    src = tmp_path / "old.czi"
    dst = tmp_path / "new.czi"
    src.write_bytes(b"fake-czi-bytes-not-a-real-container")
    original_bytes = src.read_bytes()

    renamed, _ = service.apply_batch(tmp_path, [(src, dst)], embed_original_name=True)

    assert renamed == 1
    assert dst.exists()
    assert not src.exists()
    # Byte-for-byte: a vendor raw container must never be opened/rewritten.
    assert dst.read_bytes() == original_bytes


# --- Embed: enabled, TIFF actually gets the original name embedded ----------


def test_embed_enabled_on_tiff_original_name_is_readable_back_out(tmp_path: Path) -> None:
    src = tmp_path / "acquisition_001.tif"
    dst = tmp_path / "SAMPLE_E01.tif"
    _write_tiff(src, description="")

    renamed, _ = service.apply_batch(tmp_path, [(src, dst)], embed_original_name=True)

    assert renamed == 1
    comment = tifffile.tiffcomment(str(dst)) or ""
    if isinstance(comment, bytes):
        comment = comment.decode("utf-8")
    assert "Original-Filename: acquisition_001.tif" in comment


def test_embed_enabled_on_ome_tiff_name_is_readable_back_out(tmp_path: Path) -> None:
    src = tmp_path / "raw.ome.tif"
    dst = tmp_path / "renamed.ome.tif"
    _write_tiff(src, description="")

    service.apply_batch(tmp_path, [(src, dst)], embed_original_name=True)

    comment = tifffile.tiffcomment(str(dst)) or ""
    if isinstance(comment, bytes):
        comment = comment.decode("utf-8")
    assert "Original-Filename: raw.ome.tif" in comment


# --- Embed: preserves any existing real description -------------------------


def test_embed_on_multi_hop_rename_uses_chain_resolved_true_original(tmp_path: Path) -> None:
    """A8: reproduces the proven defect where the embed step wrote the
    IMMEDIATE previous filename instead of the ledger's chain-resolved true
    original. After two hops (a -> b -> c), the tag embedded in `c` must name
    "acquisition_001.tif" (the true original), never "intermediate.tif" (the
    intermediate name `update_ledger`'s own `resolved` return already
    exists to look up -- see its docstring)."""
    a = tmp_path / "acquisition_001.tif"
    b = tmp_path / "intermediate.tif"
    c = tmp_path / "final.tif"
    _write_tiff(a, description="")

    service.apply_batch(tmp_path, [(a, b)], embed_original_name=True)
    service.apply_batch(tmp_path, [(b, c)], embed_original_name=True)

    comment = tifffile.tiffcomment(str(c)) or ""
    if isinstance(comment, bytes):
        comment = comment.decode("utf-8")
    assert "Original-Filename: acquisition_001.tif" in comment
    assert "Original-Filename: intermediate.tif" not in comment


def test_embed_appends_to_existing_description_rather_than_overwriting(tmp_path: Path) -> None:
    src = tmp_path / "acq.tif"
    dst = tmp_path / "renamed.tif"
    _write_tiff(src, description="Genuine-Acquisition-Note: pH 7.4")

    service.apply_batch(tmp_path, [(src, dst)], embed_original_name=True)

    comment = tifffile.tiffcomment(str(dst)) or ""
    if isinstance(comment, bytes):
        comment = comment.decode("utf-8")
    assert "Genuine-Acquisition-Note: pH 7.4" in comment
    assert "Original-Filename: acq.tif" in comment


# --- Embed: a failure must never undo the rename or trigger rollback -------


def test_embed_failure_does_not_undo_rename_or_trigger_rollback(
    tmp_path: Path, monkeypatch
) -> None:
    src = tmp_path / "old.tif"
    dst = tmp_path / "new.tif"
    _write_tiff(src, description="")

    def raising_embed(target: Path, original_name_str: str) -> tuple[bool, str]:
        raise RuntimeError("simulated embed failure")

    monkeypatch.setattr(original_name, "embed_original_name_in_tiff", raising_embed)

    renamed, manifest_path = service.apply_batch(tmp_path, [(src, dst)], embed_original_name=True)

    # The rename succeeded and was never rolled back despite the embed
    # helper raising.
    assert renamed == 1
    assert dst.exists()
    assert not src.exists()
    assert manifest_path is not None

    # The ledger (the actual source of truth) was still updated even though
    # the embed step blew up.
    ledger = original_name.load_ledger(tmp_path)
    assert ledger == {"new.tif": "old.tif"}


def test_embed_original_name_in_tiff_never_raises_on_garbage_file(tmp_path: Path) -> None:
    """Direct unit check of the helper's own never-raise contract for a
    TIFF-suffixed file that is not actually a valid TIFF."""
    not_really_tiff = tmp_path / "corrupt.tif"
    not_really_tiff.write_bytes(b"this is not a tiff file at all")

    ok, reason = original_name.embed_original_name_in_tiff(not_really_tiff, "whatever.tif")

    assert ok is False
    assert "embed failed" in reason


def test_embed_original_name_in_tiff_skips_unsupported_format(tmp_path: Path) -> None:
    czi_like = tmp_path / "file.czi"
    czi_like.write_bytes(b"fake")

    ok, reason = original_name.embed_original_name_in_tiff(czi_like, "orig.czi")

    assert ok is False
    assert "not TIFF/OME-TIFF" in reason
    assert czi_like.read_bytes() == b"fake"


# --- Ledger helpers: tolerate a missing/corrupt ledger file -----------------


def test_load_ledger_missing_file_returns_empty_dict(tmp_path: Path) -> None:
    assert original_name.load_ledger(tmp_path) == {}


def test_load_ledger_corrupt_json_degrades_to_empty_dict(tmp_path: Path) -> None:
    original_name.ledger_path(tmp_path).write_text("{not valid json", encoding="utf-8")
    assert original_name.load_ledger(tmp_path) == {}


def test_update_ledger_writes_sorted_json(tmp_path: Path) -> None:
    src = tmp_path / "z.tif"
    dst = tmp_path / "a.tif"
    src.write_bytes(b"x")

    path, resolved = original_name.update_ledger(tmp_path, [(src, dst)])

    assert resolved == {"a.tif": "z.tif"}
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data == {"a.tif": "z.tif"}
