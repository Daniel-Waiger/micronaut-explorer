from __future__ import annotations

from microscopy_naming_assistant.profiles import ProfileRules, default_profile
from microscopy_naming_assistant.validation import validate_fields


def test_validate_fields_happy_path() -> None:
    profile = default_profile()
    fields = {
        "exptype": "CT",
        "sample": "E02",
        "magnification": "X90",
        "markers": "ARL-DAPI",
        "notes": "OK_01",
    }
    issues = validate_fields(fields, profile)
    assert issues == []


def test_validate_fields_allows_mixed_case_notes() -> None:
    profile = default_profile()
    fields = {
        "exptype": "CT",
        "sample": "E02",
        "magnification": "X90",
        "markers": "ARL-DAPI",
        "notes": "Trial-1b",
    }
    issues = validate_fields(fields, profile)
    assert not any(issue.field == "notes" for issue in issues)


def test_validate_fields_reports_pattern_and_allowlist_errors() -> None:
    profile = default_profile()
    fields = {
        "exptype": "BAD",
        "sample": "sample-02",
        "magnification": "90x",
        "markers": "ARL-UNKNOWN",
        "notes": "bad note",
    }
    issues = validate_fields(fields, profile)

    by_field = {issue.field: issue for issue in issues}
    assert by_field["exptype"].severity == "error"
    assert by_field["sample"].severity == "error"
    assert by_field["magnification"].severity == "error"
    assert by_field["notes"].severity == "error"
    assert by_field["markers"].severity in {"warning", "error"}


def test_unknown_marker_policy_warn_and_allow() -> None:
    profile_warn = ProfileRules(
        name="warn",
        allowed_experiment_types=["CT"],
        allowed_markers=["ARL"],
        sample_pattern=r"^E\\d{2}$",
        magnification_pattern=r"^X\\d{2,3}$",
        notes_pattern=r"^[A-Z0-9_-]+$",
        unknown_marker_policy="warn",
    )
    warn_issues = validate_fields(
        {
            "exptype": "CT",
            "sample": "E01",
            "magnification": "X90",
            "markers": "ARL-XYZ",
            "notes": "OK",
        },
        profile_warn,
    )
    assert any(i.field == "markers" and i.severity == "warning" for i in warn_issues)

    profile_allow = ProfileRules(
        name="allow",
        allowed_experiment_types=["CT"],
        allowed_markers=["ARL"],
        sample_pattern=r"^E\\d{2}$",
        magnification_pattern=r"^X\\d{2,3}$",
        notes_pattern=r"^[A-Z0-9_-]+$",
        unknown_marker_policy="allow",
    )
    allow_issues = validate_fields(
        {
            "exptype": "CT",
            "sample": "E01",
            "magnification": "X90",
            "markers": "ARL-XYZ",
            "notes": "OK",
        },
        profile_allow,
    )
    assert not any(i.field == "markers" for i in allow_issues)
