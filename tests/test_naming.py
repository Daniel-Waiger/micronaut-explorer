from __future__ import annotations

from pathlib import Path

from microscopy_naming_assistant.config import NamingConfig
from microscopy_naming_assistant.naming import (
    build_filename,
    finalize_fields,
    normalize_fields,
    render_name,
    sanitize_token,
)


def test_sanitize_token_removes_unsafe_chars() -> None:
    config = NamingConfig()
    assert sanitize_token(" GFP + DAPI ", config) == "GFP__DAPI"
    assert sanitize_token("***", config) == "UNSPECIFIED"


def test_normalize_fields_applies_uppercase_policy() -> None:
    config = NamingConfig()
    fields = {
        "exptype": "ct",
        "sample": "e1",
        "notes": "Trial-1b",
        "date": "2026-07-22",
    }
    normalized = normalize_fields(fields, config)
    assert normalized["exptype"] == "CT"
    assert normalized["sample"] == "E1"
    # "notes" is no longer in uppercase_fields (P1-7), so mixed case survives.
    assert normalized["notes"] == "Trial-1b"
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


def test_finalize_fields_merges_defaults_once() -> None:
    config = NamingConfig()
    source = Path("image_a.tif")
    extracted = {"sample": "e03"}

    fields = finalize_fields(source, extracted, config)

    # Extracted value wins; everything else falls back to config.defaults.
    assert fields["sample"] == "E03"
    assert fields["exptype"] == config.defaults["exptype"]
    assert fields["magnification"] == config.defaults["magnification"]
    assert fields["markers"] == config.defaults["markers"]
    assert fields["notes"] == config.defaults["notes"]
    assert fields["date"] == config.defaults["date"]


def test_finalize_fields_sets_extension_lowercase_and_unsanitized() -> None:
    config = NamingConfig()

    fields = finalize_fields(Path("image_a.TIF"), {}, config)
    assert fields["ext"] == ".tif"

    # Missing suffix falls back to the default ".tif".
    fields_no_suffix = finalize_fields(Path("image_a"), {}, config)
    assert fields_no_suffix["ext"] == ".tif"


def test_finalize_fields_preserves_ome_tif_compound_extension() -> None:
    config = NamingConfig()

    fields = finalize_fields(Path("foo.ome.tif"), {}, config)
    assert fields["ext"] == ".ome.tif"
    assert build_filename(Path("foo.ome.tif"), {}, config).endswith(".ome.tif")


def test_finalize_fields_preserves_ome_tiff_compound_extension() -> None:
    config = NamingConfig()

    fields = finalize_fields(Path("foo.ome.tiff"), {}, config)
    assert fields["ext"] == ".ome.tiff"
    assert build_filename(Path("foo.ome.tiff"), {}, config).endswith(".ome.tiff")


def test_finalize_fields_leaves_non_ome_extensions_unchanged() -> None:
    config = NamingConfig()

    assert build_filename(Path("bar.tif"), {}, config).endswith(".tif")
    assert build_filename(Path("baz.czi"), {}, config).endswith(".czi")


def test_finalize_fields_applies_uppercase_policy_to_correct_fields() -> None:
    config = NamingConfig()
    extracted = {
        "exptype": "ct",
        "sample": "e1",
        "notes": "Trial-1b",
        "date": "2026-07-22",
    }

    fields = finalize_fields(Path("image.czi"), extracted, config)

    assert fields["exptype"] == "CT"
    assert fields["sample"] == "E1"
    # "notes" is no longer in uppercase_fields (P1-7), so mixed case survives.
    assert fields["notes"] == "Trial-1b"
    # "date" is not in uppercase_fields, so it must stay unchanged.
    assert fields["date"] == "2026-07-22"
    # ext must never be uppercased or sanitized.
    assert fields["ext"] == ".czi"


def test_render_name_collapses_duplicate_separators() -> None:
    config = NamingConfig()
    fields = {
        "date": "2026-07-22",
        "exptype": "CT",
        "sample": "E03",
        "magnification": "X90",
        "markers": "",
        "notes": "UNSPECIFIED",
        "ext": ".tif",
    }

    assert render_name(fields, config) == "2026-07-22_CT_E03_X90_UNSPECIFIED.tif"


def test_render_name_strips_separator_before_extension() -> None:
    config = NamingConfig()
    fields = {
        "date": "2026-07-22",
        "exptype": "CT",
        "sample": "E03",
        "magnification": "X90",
        "markers": "ARL",
        "notes": "",
        "ext": ".tif",
    }

    assert render_name(fields, config) == "2026-07-22_CT_E03_X90_ARL.tif"
