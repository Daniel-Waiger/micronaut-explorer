from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ProfileRules:
    name: str
    allowed_experiment_types: list[str]
    allowed_markers: list[str]
    sample_pattern: str
    magnification_pattern: str
    notes_pattern: str
    unknown_marker_policy: str = "warn"


def default_profile() -> ProfileRules:
    return ProfileRules(
        name="default",
        allowed_experiment_types=["CT", "G1G2", "G1G2G3"],
        allowed_markers=["ARL", "GFP", "DAPI", "SOX"],
        sample_pattern=r"^E\d{2}$",
        magnification_pattern=r"^X\d{2,3}$",
        notes_pattern=r"^[A-Z0-9_-]+$",
        unknown_marker_policy="warn",
    )


def save_profile(path: Path, profile: ProfileRules) -> None:
    payload = {
        "name": profile.name,
        "allowed_experiment_types": profile.allowed_experiment_types,
        "allowed_markers": profile.allowed_markers,
        "sample_pattern": profile.sample_pattern,
        "magnification_pattern": profile.magnification_pattern,
        "notes_pattern": profile.notes_pattern,
        "unknown_marker_policy": profile.unknown_marker_policy,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_profile(path: Path) -> ProfileRules:
    payload = json.loads(path.read_text(encoding="utf-8"))
    base = default_profile()
    return ProfileRules(
        name=payload.get("name", base.name),
        allowed_experiment_types=payload.get("allowed_experiment_types", base.allowed_experiment_types),
        allowed_markers=payload.get("allowed_markers", base.allowed_markers),
        sample_pattern=payload.get("sample_pattern", base.sample_pattern),
        magnification_pattern=payload.get("magnification_pattern", base.magnification_pattern),
        notes_pattern=payload.get("notes_pattern", base.notes_pattern),
        unknown_marker_policy=payload.get("unknown_marker_policy", base.unknown_marker_policy),
    )
