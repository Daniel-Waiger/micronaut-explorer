from __future__ import annotations

import re
from pathlib import Path

from .config import NamingConfig

# Windows reserves these device names as a filename STEM (i.e. the base name
# before the extension) case-insensitively -- "CON", "con", and "CON.tif" are
# all unusable on a real Windows filesystem, even though "CONSOLE" is fine.
RESERVED_WINDOWS_STEMS = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)

# Appended to a stem that collides with a reserved Windows device name so the
# resulting filename is always creatable, while staying recognizably close to
# what the template originally produced.
_RESERVED_STEM_REPAIR_SUFFIX = "_FILE"


def is_reserved_windows_stem(stem: str) -> bool:
    """True if `stem` is a reserved Windows device name, case-insensitively.

    This checks the WHOLE stem (no extension), matching Windows' own rule:
    "CON" and "con" are reserved, but "CONSOLE" and "ICON" are not.
    """
    return stem.strip().upper() in RESERVED_WINDOWS_STEMS


def repair_reserved_stem(stem: str) -> str:
    """Return a filesystem-safe variant of `stem` if it is a reserved Windows
    device name, otherwise return it unchanged."""
    if is_reserved_windows_stem(stem):
        return f"{stem}{_RESERVED_STEM_REPAIR_SUFFIX}"
    return stem


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

    # Reject/repair Windows reserved device names as the filename STEM --
    # "CON.tif" is unusable on Windows exactly like bare "CON" is. Split off
    # the extension using fields["ext"] (not Path.suffix, which would
    # collapse a compound extension like ".ome.tif" to ".tif") so the check
    # covers the true stem regardless of extension shape.
    ext = str(fields.get("ext", ""))
    if ext and raw_name.lower().endswith(ext.lower()):
        stem_part = raw_name[: -len(ext)]
    else:
        stem_part = raw_name
        ext = ""
    repaired_stem = repair_reserved_stem(stem_part)
    if repaired_stem != stem_part:
        raw_name = f"{repaired_stem}{ext}"
    return raw_name


def build_filename(
    source_path: Path,
    extracted_fields: dict[str, str],
    config: NamingConfig,
) -> str:
    return render_name(finalize_fields(source_path, extracted_fields, config), config)
