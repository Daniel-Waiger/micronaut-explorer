from __future__ import annotations

import json
from dataclasses import dataclass, field
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
    filename_extraction_mask: str | None = None
    # Maps a naming field name (one of field_map.MAPPABLE_FIELDS) to an exact
    # metadata key name; consumed by field_map.resolve_fields as `overrides`.
    # profiles.py stays dependency-free, so field_map is not imported here.
    field_key_map: dict[str, str] = field(default_factory=dict)


def default_profile() -> ProfileRules:
    # Neutral/permissive starter profile: empty allow-lists mean "no restriction"
    # (see validation.py), not "reject everything". profiles/facsi_default.json is
    # a separate, explicitly-named example of a restrictive lab profile.
    return ProfileRules(
        name="default",
        allowed_experiment_types=[],
        allowed_markers=[],
        sample_pattern=r"^[A-Za-z0-9_-]+$",
        magnification_pattern=r"^[A-Za-z0-9]+$",
        notes_pattern=r"^[A-Za-z0-9_-]+$",
        unknown_marker_policy="warn",
        filename_extraction_mask=None,
        field_key_map={},
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
        "filename_extraction_mask": profile.filename_extraction_mask,
        "field_key_map": profile.field_key_map,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_profile(path: Path) -> ProfileRules:
    payload = json.loads(path.read_text(encoding="utf-8"))
    base = default_profile()
    return ProfileRules(
        name=payload.get("name", base.name),
        allowed_experiment_types=payload.get(
            "allowed_experiment_types", base.allowed_experiment_types
        ),
        allowed_markers=payload.get("allowed_markers", base.allowed_markers),
        sample_pattern=payload.get("sample_pattern", base.sample_pattern),
        magnification_pattern=payload.get("magnification_pattern", base.magnification_pattern),
        notes_pattern=payload.get("notes_pattern", base.notes_pattern),
        unknown_marker_policy=payload.get("unknown_marker_policy", base.unknown_marker_policy),
        filename_extraction_mask=payload.get(
            "filename_extraction_mask", base.filename_extraction_mask
        ),
        field_key_map=payload.get("field_key_map", base.field_key_map),
    )
