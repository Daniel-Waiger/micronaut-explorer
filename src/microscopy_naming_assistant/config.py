from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class NamingConfig:
    template: str = "{date}_{exptype}_{sample}_{magnification}_{markers}_{notes}{ext}"
    defaults: dict[str, str] = field(
        default_factory=lambda: {
            "date": "1970-01-01",
            "exptype": "CT",
            "sample": "E01",
            "magnification": "X90",
            "markers": "ARL",
            "notes": "UNSPECIFIED",
        }
    )
    uppercase_fields: list[str] = field(
        default_factory=lambda: ["exptype", "sample", "magnification", "markers", "notes"]
    )
    field_separator: str = "_"
    marker_separator: str = "-"
    llm: dict[str, Any] = field(
        default_factory=lambda: {
            "enabled": False,
            "model": "auto",
            "preferred_models": ["llama3.1:8b", "qwen2.5-coder:7b", "phi3:mini"],
            "endpoint": "http://localhost:11434/api/chat",
            "timeout_seconds": 30,
        }
    )


def default_config() -> NamingConfig:
    return NamingConfig()


def save_config(path: Path, config: NamingConfig) -> None:
    payload = {
        "template": config.template,
        "defaults": config.defaults,
        "uppercase_fields": config.uppercase_fields,
        "field_separator": config.field_separator,
        "marker_separator": config.marker_separator,
        "llm": config.llm,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_config(path: Path) -> NamingConfig:
    payload = json.loads(path.read_text(encoding="utf-8"))
    base = default_config()

    return NamingConfig(
        template=payload.get("template", base.template),
        defaults={**base.defaults, **payload.get("defaults", {})},
        uppercase_fields=payload.get("uppercase_fields", base.uppercase_fields),
        field_separator=payload.get("field_separator", base.field_separator),
        marker_separator=payload.get("marker_separator", base.marker_separator),
        llm={**base.llm, **payload.get("llm", {})},
    )
