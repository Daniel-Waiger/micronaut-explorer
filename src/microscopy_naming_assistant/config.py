from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from microscopy_naming_assistant.llm import DEFAULT_PREFERRED_MODELS


@dataclass
class NamingConfig:
    template: str = "{date}_{exptype}_{sample}_{magnification}_{markers}_{notes}{ext}"
    defaults: dict[str, str] = field(
        default_factory=lambda: {
            "date": "1970-01-01",
            "exptype": "UNKNOWN",
            "sample": "UNKNOWN",
            "magnification": "UNKNOWN",
            "markers": "UNKNOWN",
            "notes": "UNSPECIFIED",
        }
    )
    uppercase_fields: list[str] = field(
        default_factory=lambda: ["exptype", "sample", "magnification", "markers"]
    )
    safe_char_pattern: str = r"[^A-Za-z0-9_-]+"
    extraction_timeout_seconds: int = 20
    llm: dict[str, Any] = field(
        default_factory=lambda: {
            "enabled": False,
            "model": "auto",
            "preferred_models": list(DEFAULT_PREFERRED_MODELS),
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
        "safe_char_pattern": config.safe_char_pattern,
        "extraction_timeout_seconds": config.extraction_timeout_seconds,
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
        safe_char_pattern=payload.get("safe_char_pattern", base.safe_char_pattern),
        extraction_timeout_seconds=payload.get(
            "extraction_timeout_seconds", base.extraction_timeout_seconds
        ),
        llm={**base.llm, **payload.get("llm", {})},
    )
