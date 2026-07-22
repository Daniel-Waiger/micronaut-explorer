from __future__ import annotations

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

    path = tmp_path / "profile.json"
    save_profile(path, profile)
    loaded = load_profile(path)

    assert loaded.name == profile.name
    assert loaded.unknown_marker_policy == "block"
    assert "CT" in loaded.allowed_experiment_types
