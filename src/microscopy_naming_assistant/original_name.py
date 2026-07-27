from __future__ import annotations

import json
from pathlib import Path

# Durable per-folder ledger mapping CURRENT filename -> TRUE ORIGINAL filename
# (relative to the folder being renamed). This is deliberately separate from
# the timestamped `.manifests/rename_manifest_*.json` files: those describe
# one batch's intent and can be lost, moved, or pruned independently, but
# original-name identity must survive regardless. One ledger per folder (not
# one file per image) keeps this cheap to append to and easy to audit.
LEDGER_FILENAME = ".original_names.json"

# Prefix used when embedding the original filename into a TIFF/OME-TIFF
# ImageDescription tag (A2 point 2). Kept distinct from any real acquisition
# description text so it is unambiguous on read-back and so a later embed
# can detect "already recorded" instead of duplicating the line forever.
_ORIGINAL_NAME_TAG_PREFIX = "Original-Filename: "


def ledger_path(input_dir: Path) -> Path:
    """Location of the folder's durable original-name ledger."""
    return input_dir / LEDGER_FILENAME


def load_ledger(input_dir: Path) -> dict[str, str]:
    """Load the folder's ledger, tolerating a missing or corrupt file.

    A missing, unreadable, or non-JSON-object ledger degrades to an empty
    mapping rather than raising -- callers (notably `update_ledger`) treat
    that the same as "no prior batch has run here yet".
    """
    path = ledger_path(input_dir)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def update_ledger(
    input_dir: Path, renamed_pairs: list[tuple[Path, Path]]
) -> tuple[Path, dict[str, str]]:
    """Merge newly-renamed pairs into the folder's durable ledger and persist it.

    APPEND/MERGE, never replace: the existing ledger is loaded first and only
    the keys implicated by *this* batch's renames are touched. A second batch
    in the same folder must never erase the first batch's records (this repo
    has already shipped one bug of exactly this shape -- cma-lessons E6's
    selectbox/map-replacement note).

    Chain correctness: if `src` is itself already a ledger key (i.e. it was
    the TARGET of a previous rename), its recorded true original is carried
    forward to `dst` and the stale `src` key is dropped -- a file renamed
    twice keeps a correct chain back to its true original instead of being
    orphaned under an intermediate name that no longer exists on disk.

    Returns the ledger path and a `{dst_key: true_original_key}` mapping for
    just this batch, so callers (e.g. the opt-in TIFF embed) can look up the
    resolved original without re-reading the file.
    """
    ledger = load_ledger(input_dir)
    resolved: dict[str, str] = {}

    for src, dst in renamed_pairs:
        src_key = str(src.relative_to(input_dir))
        dst_key = str(dst.relative_to(input_dir))
        true_original = ledger.pop(src_key, src_key)
        ledger[dst_key] = true_original
        resolved[dst_key] = true_original

    path = ledger_path(input_dir)
    path.write_text(json.dumps(ledger, indent=2, sort_keys=True), encoding="utf-8")
    return path, resolved


def _is_supported_tiff(path: Path) -> bool:
    """TIFF/OME-TIFF only -- an OME-TIFF's name always still ends `.tif`/`.tiff`
    (e.g. `foo.ome.tif`), so a plain suffix check covers both without needing
    format sniffing. Every other format (CZI/LIF/ND2/anything else) is
    intentionally excluded: rewriting a proprietary raw acquisition container
    contradicts the raw-data-immutability (ALCOA) posture in ROADMAP.md."""
    name = path.name.lower()
    return name.endswith(".tif") or name.endswith(".tiff")


def embed_original_name_in_tiff(target: Path, original_name: str) -> tuple[bool, str]:
    """Best-effort: record `original_name` in `target`'s ImageDescription tag.

    Opt-in, narrow, default OFF (A2 point 2): callers only invoke this when
    the user has explicitly enabled embedding, and only TIFF/OME-TIFF targets
    are ever touched -- `_is_supported_tiff` gates this before any file I/O,
    so a CZI/LIF/ND2 (or any other format) is skipped without being opened at
    all, let alone rewritten.

    NEVER raises. Any failure -- unsupported format, missing `tifffile`, a
    locked/corrupt file, an unexpected tifffile error -- is reported back as
    `(False, reason)` instead of propagating, because a failed embed must
    never fail or roll back the rename that has already succeeded on disk.
    The sidecar ledger (`update_ledger`), not this tag, is the source of
    truth for original-name recovery; this is a convenience on top of it.
    """
    if not _is_supported_tiff(target):
        suffix = target.suffix or "(no extension)"
        return False, f"embed skipped: {suffix} is not TIFF/OME-TIFF"

    try:
        import tifffile  # type: ignore

        existing = tifffile.tiffcomment(str(target)) or ""
        if isinstance(existing, bytes):
            existing = existing.decode("utf-8", errors="replace")

        line = f"{_ORIGINAL_NAME_TAG_PREFIX}{original_name}"
        if line in existing:
            return True, "embed skipped: already recorded"

        # Append rather than overwrite: a real TIFF/OME-TIFF may already
        # carry a genuine acquisition description, and destroying that to
        # make room for provenance we can get from the ledger anyway would
        # be a pointless act of data loss.
        combined = f"{existing}\n{line}" if existing else line
        tifffile.tiffcomment(str(target), combined)
        return True, "embedded"
    except Exception as exc:  # noqa: BLE001 - must never propagate, see docstring
        return False, f"embed failed: {exc}"
