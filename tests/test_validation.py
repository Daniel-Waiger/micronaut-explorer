from __future__ import annotations

from pathlib import Path

from microscopy_naming_assistant.profiles import ProfileRules, default_profile
from microscopy_naming_assistant.validation import (
    MAX_PATH_LENGTH,
    validate_fields,
    validate_target_path,
)


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
    # The default profile is now neutral/permissive (P3-4b), so this test exercises
    # an explicit restrictive profile to prove pattern/allow-list errors are still
    # reported when a lab actually configures restrictions.
    profile = ProfileRules(
        name="restrictive",
        allowed_experiment_types=["CT"],
        allowed_markers=["ARL"],
        sample_pattern=r"^E\d{2}$",
        magnification_pattern=r"^X\d{2,3}$",
        notes_pattern=r"^[A-Za-z0-9_-]+$",
        unknown_marker_policy="warn",
    )
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


def test_default_profile_empty_allowlists_mean_unrestricted() -> None:
    # An empty allow-list on the (now neutral) default profile means "no
    # restriction", not "reject everything" (P3-4b).
    profile = default_profile()
    fields = {
        "exptype": "FOO",
        "sample": "sample-01",
        "magnification": "10x",
        "markers": "WHATEVER-ELSE",
        "notes": "note_1",
    }
    issues = validate_fields(fields, profile)
    assert issues == []

    # The same novel exptype/markers are still flagged once a lab opts into an
    # explicit restrictive profile.
    restrictive = ProfileRules(
        name="restrictive",
        allowed_experiment_types=["CT"],
        allowed_markers=["ARL"],
        sample_pattern=profile.sample_pattern,
        magnification_pattern=profile.magnification_pattern,
        notes_pattern=profile.notes_pattern,
        unknown_marker_policy="warn",
    )
    restricted_issues = validate_fields(fields, restrictive)
    by_field = {issue.field: issue for issue in restricted_issues}
    assert by_field["exptype"].severity == "error"
    assert by_field["markers"].severity == "warning"


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


def test_validate_target_path_warns_when_over_max_path_length() -> None:
    long_path = Path("C:/" + ("a" * (MAX_PATH_LENGTH + 50)) + ".tif")
    issues = validate_target_path(long_path)

    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert issues[0].field == "target_path"
    assert "MAX_PATH" in issues[0].message
    # The offending path must be visible in the message, not summarized away.
    assert str(long_path) in issues[0].message


def test_validate_target_path_silent_when_within_limit() -> None:
    short_path = Path("C:/data/sample.tif")
    assert validate_target_path(short_path) == []


def test_validate_target_path_boundary_is_inclusive() -> None:
    # Exactly MAX_PATH_LENGTH characters must NOT warn; MAX_PATH_LENGTH + 1 must.
    exact = Path("a" * MAX_PATH_LENGTH)
    over = Path("a" * (MAX_PATH_LENGTH + 1))

    assert validate_target_path(exact) == []
    assert len(validate_target_path(over)) == 1
