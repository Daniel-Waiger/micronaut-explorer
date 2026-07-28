from __future__ import annotations

from pathlib import Path

import microscopy_naming_assistant.metadata as metadata_module
import microscopy_naming_assistant.service as service
from microscopy_naming_assistant.config import default_config, save_config
from microscopy_naming_assistant.service import classify_description_proposals


def test_spec_example_with_description_supplied() -> None:
    cur = {"magnification": "X2", "sample": "UNKNOWN"}
    src = {"magnification": "metadata", "sample": "default"}
    llm = {"magnification": "X40", "sample": "E03"}

    fills, overrides = classify_description_proposals(cur, src, llm, description_supplied=True)

    assert fills == {"sample": "E03"}
    assert overrides == {"magnification": ("X2", "X40")}


def test_spec_example_without_description_has_no_overrides() -> None:
    cur = {"magnification": "X2", "sample": "UNKNOWN"}
    src = {"magnification": "metadata", "sample": "default"}
    llm = {"magnification": "X40", "sample": "E03"}

    fills, overrides = classify_description_proposals(cur, src, llm, description_supplied=False)

    assert fills == {"sample": "E03"}
    assert overrides == {}


def test_default_source_is_always_a_fill_never_an_override() -> None:
    fills, overrides = classify_description_proposals(
        {"markers": "UNKNOWN"},
        {"markers": "default"},
        {"markers": "GFP"},
        description_supplied=True,
    )
    assert fills == {"markers": "GFP"}
    assert overrides == {}


def test_empty_current_value_is_a_fill_even_if_source_is_not_default() -> None:
    # A source key present but the value happens to be empty must still be
    # treated as a genuine gap, not an override candidate.
    fills, overrides = classify_description_proposals(
        {"sample": ""},
        {"sample": "metadata"},
        {"sample": "E03"},
        description_supplied=True,
    )
    assert fills == {"sample": "E03"}
    assert overrides == {}


def test_ext_is_never_in_either_dict() -> None:
    fills, overrides = classify_description_proposals(
        {"ext": ".tif"},
        {"ext": "default"},
        {"ext": ".ome.tif"},
        description_supplied=True,
    )
    assert "ext" not in fills
    assert "ext" not in overrides


def test_user_edited_field_is_never_proposed_as_an_override() -> None:
    fills, overrides = classify_description_proposals(
        {"sample": "E07"},
        {"sample": "user_edited"},
        {"sample": "E03"},
        description_supplied=True,
    )
    assert overrides == {}
    assert fills == {}


def test_identical_proposed_value_is_not_an_override() -> None:
    fills, overrides = classify_description_proposals(
        {"magnification": "X40"},
        {"magnification": "metadata"},
        {"magnification": "X40"},
        description_supplied=True,
    )
    assert overrides == {}
    assert fills == {}


def test_empty_proposed_value_is_not_an_override() -> None:
    fills, overrides = classify_description_proposals(
        {"magnification": "X40"},
        {"magnification": "metadata"},
        {"magnification": ""},
        description_supplied=True,
    )
    assert overrides == {}
    assert fills == {}


def test_a_field_never_appears_in_both_fills_and_overrides() -> None:
    fills, overrides = classify_description_proposals(
        {"sample": "UNKNOWN", "magnification": "X2"},
        {"sample": "default", "magnification": "metadata"},
        {"sample": "E03", "magnification": "X40"},
        description_supplied=True,
    )
    assert set(fills) & set(overrides) == set()
    assert fills == {"sample": "E03"}
    assert overrides == {"magnification": ("X2", "X40")}


def test_pure_function_does_not_mutate_its_inputs() -> None:
    cur = {"magnification": "X2"}
    src = {"magnification": "metadata"}
    llm = {"magnification": "X40"}
    cur_copy, src_copy, llm_copy = dict(cur), dict(src), dict(llm)

    classify_description_proposals(cur, src, llm, description_supplied=True)

    assert cur == cur_copy
    assert src == src_copy
    assert llm == llm_copy


def test_suggest_for_file_with_description_still_leaves_metadata_field_untouched(
    tmp_path: Path, monkeypatch
) -> None:
    """`suggest_for_file` (the non-interactive CLI/batch path) must NOT apply
    override proposals -- classify_description_proposals only classifies, and
    an override there would be exactly the silent overwrite the LLM-as-
    enhancer guardrail forbids. A description may still fill a genuine gap."""
    config = default_config()
    config.llm["enabled"] = True
    config_path = tmp_path / "naming_scheme.json"
    save_config(config_path, config)

    source = tmp_path / "test_E1.tif"
    source.write_bytes(b"x")

    def fake_extract(file_path, **kwargs):
        # "sample" is a genuine gap: absent from `extracted`, exactly as real
        # extraction leaves an un-derivable field absent (the "UNKNOWN"
        # placeholder is only added later, by finalize_fields' defaults).
        return (
            {"magnification": "X2"},
            {"magnification": "metadata"},
            metadata_module.ExtractionDetail(),
        )

    def fake_llm(**kwargs):
        # The model disagrees with the real metadata-sourced magnification
        # AND fills the genuinely-missing sample.
        return {"magnification": "X40", "sample": "E03"}

    monkeypatch.setattr(service, "extract_metadata_detailed", fake_extract)
    monkeypatch.setattr(service, "suggest_fields_with_ollama", fake_llm)

    result = service.suggest_for_file(
        file_path=source,
        config_path=config_path,
        use_llm=True,
        user_description="93x objective, embryo 3",
    )

    # The metadata-sourced value survives untouched -- no silent override.
    assert result.fields["magnification"] == "X2"
    assert result.sources["magnification"] == "metadata"
    # The genuine gap is still filled, tagged as description-derived.
    assert result.fields["sample"] == "E03"
    assert result.sources["sample"] == "llm_description"
