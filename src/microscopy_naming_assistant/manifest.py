from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def save_manifest(input_dir: Path, planned: list[tuple[Path, Path]]) -> Path | None:
    if not planned:
        return None

    manifests_dir = input_dir / ".manifests"
    manifests_dir.mkdir(exist_ok=True, parents=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    manifest_path = manifests_dir / f"rename_manifest_{timestamp}.json"

    data = []
    for src, dst in planned:
        if src != dst:
            data.append(
                {
                    "original": str(src.relative_to(input_dir)),
                    "target": str(dst.relative_to(input_dir)),
                }
            )

    if not data:
        return None

    manifest_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return manifest_path


def rollback_manifest(manifest_path: Path, input_dir: Path) -> tuple[int, list[str]]:
    if not manifest_path.exists():
        return 0, ["Manifest not found."]

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return 0, ["Invalid JSON manifest."]

    reverted = 0
    errors = []

    # Process in reverse order to unwind safely.
    #
    # The decision for each entry must never infer "already restored" from
    # `original.exists()` alone -- something other than this rollback pass
    # may occupy `original` (a second process, a stray file, a careless
    # manual write) while the renamed file is still sitting at `target`
    # under its new name. The only fact that tells us whether THIS entry
    # still needs restoring is whether `target` still exists:
    #
    #   - `target` exists  -> this rename was never undone. If `original`
    #     is free, undo it now (the common case). If `original` is ALSO
    #     occupied, check whether it is the SAME file as `target`
    #     (`target.samefile(original)`) before declaring a conflict: for a
    #     case-only rename (e.g. "a.tif" -> "A.tif") Windows reports both
    #     paths as existing because they are the identical file on disk, not
    #     two different ones, so the rename back is safe and we perform it.
    #     Only when `original` is occupied by a genuinely DIFFERENT file do
    #     we have a real conflict -- we cannot revert without either
    #     clobbering whatever is there or silently abandoning the file stuck
    #     at `target` under the wrong name -- that is a genuine, reportable
    #     conflict, never a silent no-op. A `samefile` call can itself raise
    #     `OSError` if either path vanishes between the `exists()` check and
    #     the call; that failure degrades to the conflict-error path rather
    #     than crashing the rollback.
    #   - `target` does NOT exist -> there is nothing left at `target` to
    #     lose by skipping. `original` already holding a file is then
    #     exactly the legitimate already-reverted state (this same call
    #     having just restored it in an earlier loop iteration, an earlier
    #     `mna rollback` run having already completed, or the forward
    #     rename never having reached this entry before failing) that a
    #     rollback re-run must be able to treat as a harmless no-op. Only
    #     when NEITHER path exists is the file actually missing.
    for item in reversed(data):
        target = input_dir / item["target"]
        original = input_dir / item["original"]

        if target.exists():
            if original.exists():
                try:
                    same_file = target.samefile(original)
                except OSError:
                    same_file = False

                if same_file:
                    try:
                        target.rename(original)
                        reverted += 1
                    except Exception as e:
                        errors.append(f"Failed to revert {target.name}: {e}")
                else:
                    errors.append(
                        f"Cannot revert {target.name}: original path "
                        f"{original.name} is occupied by a different file, so "
                        f"{target.name} still holds the renamed content."
                    )
            else:
                try:
                    target.rename(original)
                    reverted += 1
                except Exception as e:
                    errors.append(f"Failed to revert {target.name}: {e}")
        elif original.exists():
            # Already reverted -- by this pass or an earlier run. Nothing
            # is stranded at `target`, so there is nothing to do.
            continue
        else:
            errors.append(f"Target {target.name} not found to revert.")

    return reverted, errors
