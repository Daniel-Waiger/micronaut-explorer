from __future__ import annotations

import re
from pathlib import Path

from .config import NamingConfig


def sanitize_token(value: str, config: NamingConfig) -> str:
    pattern = re.compile(config.safe_char_pattern)
    cleaned = pattern.sub("", value.strip().replace(" ", "_"))
    return cleaned or "UNSPECIFIED"


def normalize_fields(fields: dict[str, str], config: NamingConfig) -> dict[str, str]:
    normalized = {}
    for key, value in fields.items():
        token = sanitize_token(str(value), config)
        if key in config.uppercase_fields:
            token = token.upper()
        normalized[key] = token
    return normalized


_COMPOUND_EXTENSIONS = (".ome.tif", ".ome.tiff")


def _compound_ext(source_path: Path) -> str:
    """Compute the extension to use, preserving known compound extensions.

    ``Path.suffix`` only ever returns the last dotted segment, so
    ``"foo.ome.tif"`` would collapse to ``".tif"`` and silently drop the
    ``.ome`` infix that marks the file as an OME-TIFF. Detect that case (and
    its ``.ome.tiff`` sibling) explicitly and keep the compound, lowercased.
    Everything else keeps the existing single-suffix behavior.
    """
    name = source_path.name.lower()
    for compound in _COMPOUND_EXTENSIONS:
        if name.endswith(compound):
            return compound

    ext = source_path.suffix.lower() or ".tif"
    if not ext.startswith("."):
        ext = f".{ext}"
    return ext


def finalize_fields(
    source_path: Path,
    extracted: dict[str, str],
    config: NamingConfig,
) -> dict[str, str]:
    """Merge defaults with extracted fields, attach the extension, and normalize.

    This is the single source of truth for the final field dict used both for
    validation and for rendering the filename.
    """
    merged = {**config.defaults, **extracted}
    ext = _compound_ext(source_path)

    normalized = normalize_fields(merged, config)
    normalized["ext"] = ext
    return normalized


def render_name(fields: dict[str, str], config: NamingConfig) -> str:
    """Format an already-finalized field dict into a filename."""
    raw_name = config.template.format(**fields)

    # Collapse duplicate separators and strip separator around extension.
    raw_name = re.sub(r"_{2,}", "_", raw_name)
    raw_name = raw_name.replace("_.", ".")
    return raw_name


def build_filename(
    source_path: Path,
    extracted_fields: dict[str, str],
    config: NamingConfig,
) -> str:
    return render_name(finalize_fields(source_path, extracted_fields, config), config)
