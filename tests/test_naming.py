from __future__ import annotations

from pathlib import Path

from microscopy_naming_assistant.config import NamingConfig
from microscopy_naming_assistant.naming import build_filename, normalize_fields, sanitize_token


def test_sanitize_token_removes_unsafe_chars() -> None:
    assert sanitize_token(" GFP + DAPI ") == "GFP__DAPI"
    assert sanitize_token("***") == "UNSPECIFIED"


def test_normalize_fields_applies_uppercase_policy() -> None:
    config = NamingConfig()
    fields = {
        "exptype": "ct",
        "sample": "e1",
        "notes": "note-1",
        "date": "2026-07-22",
    }
    normalized = normalize_fields(fields, config)
    assert normalized["exptype"] == "CT"
    assert normalized["sample"] == "E1"
    assert normalized["notes"] == "NOTE-1"
    assert normalized["date"] == "2026-07-22"


def test_build_filename_uses_defaults_and_extension() -> None:
    config = NamingConfig()
    source = Path("image_a.tif")
    extracted = {
        "date": "2026-07-22",
        "sample": "E03",
    }

    result = build_filename(source, extracted, config)
    assert result.startswith("2026-07-22_CT_E03_")
    assert result.endswith(".tif")
