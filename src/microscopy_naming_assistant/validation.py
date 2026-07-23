from __future__ import annotations

import re
from dataclasses import dataclass

from .profiles import ProfileRules


@dataclass
class ValidationIssue:
    field: str
    message: str
    severity: str = "error"


def _split_markers(markers_value: str) -> list[str]:
    parts = re.split(r"[-,;|/]+", markers_value)
    return [p.strip().upper() for p in parts if p.strip()]


def validate_fields(fields: dict[str, str], profile: ProfileRules) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    exptype = str(fields.get("exptype", "")).upper()
    if exptype and exptype not in {x.upper() for x in profile.allowed_experiment_types}:
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
