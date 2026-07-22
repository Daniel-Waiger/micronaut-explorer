from __future__ import annotations

import re
from pathlib import Path

from .config import NamingConfig


SAFE_CHAR_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")


def sanitize_token(value: str) -> str:
    cleaned = SAFE_CHAR_PATTERN.sub("", value.strip().replace(" ", "_"))
    return cleaned or "UNSPECIFIED"


def normalize_fields(fields: dict[str, str], config: NamingConfig) -> dict[str, str]:
    normalized = {}
    for key, value in fields.items():
        token = sanitize_token(str(value))
        if key in config.uppercase_fields:
            token = token.upper()
        normalized[key] = token
    return normalized


def build_filename(
    source_path: Path,
    extracted_fields: dict[str, str],
    config: NamingConfig,
) -> str:
    merged = {**config.defaults, **extracted_fields}
    merged["ext"] = source_path.suffix.lower() or ".tif"

    normalized = normalize_fields(merged, config)
    raw_name = config.template.format(**normalized)

    # Collapse duplicate separators and strip separator around extension.
    raw_name = re.sub(r"_{2,}", "_", raw_name)
    raw_name = raw_name.replace("_.", ".")
    return raw_name
