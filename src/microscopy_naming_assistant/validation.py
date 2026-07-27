from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .profiles import ProfileRules

# Windows' classic MAX_PATH limit. Exceeding it makes a path unusable (or
# silently unreliable) on plain Win32 APIs; we WARN rather than truncate,
# because truncating a name is exactly the kind of silent identity loss this
# tool exists to prevent.
MAX_PATH_LENGTH = 260


@dataclass
class ValidationIssue:
    field: str
    message: str
    severity: str = "error"


def _split_markers(markers_value: str) -> list[str]:
    parts = re.split(r"[-,;|/]+", markers_value)
    return [p.strip().upper() for p in parts if p.strip()]


def validate_target_path(target_path: Path) -> list[ValidationIssue]:
    """Warn (never truncate) when a full target path would exceed Windows'
    MAX_PATH limit (260 characters).

    This must be checked against the FULL path (directory + filename), not
    just the filename, since it is the combined length that Win32 rejects.
    Severity is "warning", not "error": the path may still work (long-path
    opt-in, WSL, a non-Windows filesystem), so this must never silently block
    or mutate a plan -- it only surfaces the risk for the user to judge.
    """
    path_str = str(target_path)
    if len(path_str) <= MAX_PATH_LENGTH:
        return []
    return [
        ValidationIssue(
            field="target_path",
            message=(
                f"Target path is {len(path_str)} characters, exceeding the Windows "
                f"MAX_PATH limit of {MAX_PATH_LENGTH}: '{path_str}'"
            ),
            severity="warning",
        )
    ]


def validate_fields(fields: dict[str, str], profile: ProfileRules) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    exptype = str(fields.get("exptype", "")).upper()
    if (
        exptype
        and profile.allowed_experiment_types
        and exptype not in {x.upper() for x in profile.allowed_experiment_types}
    ):
        issues.append(
            ValidationIssue(
                field="exptype",
                message=f"Value '{exptype}' is not in allowed_experiment_types.",
                severity="error",
            )
        )

    sample = str(fields.get("sample", ""))
    if sample and not re.fullmatch(profile.sample_pattern, sample):
        issues.append(
            ValidationIssue(
                field="sample",
                message=(
                    f"Value '{sample}' does not match sample_pattern '{profile.sample_pattern}'."
                ),
                severity="error",
            )
        )

    magnification = str(fields.get("magnification", ""))
    if magnification and not re.fullmatch(profile.magnification_pattern, magnification):
        issues.append(
            ValidationIssue(
                field="magnification",
                message=(
                    f"Value '{magnification}' does not match magnification_pattern "
                    f"'{profile.magnification_pattern}'."
                ),
                severity="error",
            )
        )

    notes = str(fields.get("notes", ""))
    if notes and not re.fullmatch(profile.notes_pattern, notes):
        issues.append(
            ValidationIssue(
                field="notes",
                message=f"Value '{notes}' does not match notes_pattern '{profile.notes_pattern}'.",
                severity="error",
            )
        )

    if profile.allowed_markers:
        allowed_markers = {m.upper() for m in profile.allowed_markers}
        markers = _split_markers(str(fields.get("markers", "")))
        unknown_markers = [m for m in markers if m not in allowed_markers]
        if unknown_markers:
            severity = "warning" if profile.unknown_marker_policy == "warn" else "error"
            if profile.unknown_marker_policy != "allow":
                issues.append(
                    ValidationIssue(
                        field="markers",
                        message=(
                            "Unknown markers not in allowed_markers: "
                            + ", ".join(sorted(unknown_markers))
                        ),
                        severity=severity,
                    )
                )

    return issues
