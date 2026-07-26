from __future__ import annotations

import json
from pathlib import Path

from microscopy_naming_assistant.config import default_config, load_config, save_config
from microscopy_naming_assistant.profiles import default_profile, load_profile, save_profile


def test_config_round_trip(tmp_path: Path) -> None:
    config = default_config()
    config.llm["enabled"] = True
    config.llm["model"] = "auto"

    path = tmp_path / "naming_scheme.json"
    save_config(path, config)
    loaded = load_config(path)

    assert loaded.llm["enabled"] is True
    assert loaded.llm["model"] == "auto"
    assert "preferred_models" in loaded.llm


def test_profile_round_trip(tmp_path: Path) -> None:
    profile = default_profile()
    profile.unknown_marker_policy = "block"
    # Use an arbitrary, non-FACSI-specific list: the round trip should preserve
    # whatever was saved, not any particular lab's values.
    profile.allowed_experiment_types = ["FOO", "BAR"]
    profile.filename_extraction_mask = "{date}_{exptype}_{sample}"

    path = tmp_path / "profile.json"
    save_profile(path, profile)
    loaded = load_profile(path)

    assert loaded.name == profile.name
    assert loaded.unknown_marker_policy == "block"
    assert loaded.allowed_experiment_types == ["FOO", "BAR"]
    assert loaded.filename_extraction_mask == "{date}_{exptype}_{sample}"


def test_profile_field_key_map_round_trip(tmp_path: Path) -> None:
    profile = default_profile()
    profile.field_key_map = {"magnification": "Magnification"}

    path = tmp_path / "profile.json"
    save_profile(path, profile)
    loaded = load_profile(path)

    assert loaded.field_key_map == {"magnification": "Magnification"}

    # The payload dict in save_profile() is hand-written, not asdict(), so a
    # round trip through the dataclass alone would not catch a forgotten key.
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["field_key_map"] == {"magnification": "Magnification"}


def test_profile_without_extraction_mask_loads(tmp_path: Path) -> None:
    # Profiles written before the mask existed must still load.
    path = tmp_path / "legacy.json"
    path.write_text('{"name": "legacy"}', encoding="utf-8")

    assert load_profile(path).filename_extraction_mask is None


def test_profile_without_field_key_map_loads(tmp_path: Path) -> None:
    # Profiles written before field_key_map existed must still load.
    path = tmp_path / "legacy.json"
    path.write_text('{"name": "legacy"}', encoding="utf-8")

    assert load_profile(path).field_key_map == {}
