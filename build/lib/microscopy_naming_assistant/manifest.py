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
            data.append({
                "original": str(src.relative_to(input_dir)),
                "target": str(dst.relative_to(input_dir))
            })
            
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
    
    # Process in reverse order to unwind safely
    for item in reversed(data):
        target = input_dir / item["target"]
        original = input_dir / item["original"]
        
        if target.exists() and not original.exists():
            try:
                target.rename(original)
                reverted += 1
            except Exception as e:
                errors.append(f"Failed to revert {target.name}: {e}")
        elif original.exists():
            continue
        else:
            errors.append(f"Target {target.name} not found to revert.")
            
    return reverted, errors
