#!/usr/bin/env python3
"""Generate web/kb/markers.json from the Python source of truth.

Stdlib only, apart from importing the project's own `markers` module. Per
docs/plans/planner-web-p1.md ("the marker KB is generated, never retyped")
and cma-lessons.md lesson 40, this script never re-derives or retypes
`MARKER_ALIASES` / `AMBIGUOUS_IN_FREE_TEXT` from memory -- it imports the
real objects from src/microscopy_naming_assistant/markers.py and mechanically
transforms them.

Output shape (docs/plans/planner-web-p1-task-graph.json, task C1-1):
    {
      "version": 1,
      "markers": {
        "<CANONICAL>": {
          "aliases": [...lowercased, sorted...],
          "freeTextAliases": [...aliases MINUS anything in
                               AMBIGUOUS_IN_FREE_TEXT...],
          "class": "dye" | "protein" | "tag" | "moiety" | "stain" | "indicator",
          "isFamily": bool,
          "variants": [...]
        }
      },
      "ambiguousInFreeText": [...sorted...]
    }

The class/isFamily/variants split resolves the content prerequisite the
parent plan flagged (K-1): MITOTRACKER, LYSOTRACKER, SYTOX, GCAMP and BODIPY
are families spanning several spectra; HALO/SNAP/CLIP are protein tags with
no spectrum of their own; PHALLOIDIN/WGA are targeting moieties with no
spectrum. Everything else defaults to "dye" unless it is plainly a
fluorescent protein or a calcium indicator. Every one of these is an
editorial decision, not something to guess per-marker at runtime, so each
classification lives in an explicit, reviewable-in-one-place literal set
below rather than being inferred.

Two runs over the same markers.py produce byte-identical JSON: sort_keys,
fixed separators, sorted list contents, trailing newline.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_SRC = _ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from microscopy_naming_assistant.markers import (  # noqa: E402
    AMBIGUOUS_IN_FREE_TEXT,
    MARKER_ALIASES,
)

KB_DIR = _ROOT / "web" / "kb"
MARKERS_JSON_PATH = KB_DIR / "markers.json"
# Dev-mode aggregate of every web/kb/*.json, consumed by web/index.html's
# unbuilt <script src="./kb.dev.js"> block. Generated -- never committed,
# see .gitignore.
KB_DEV_JS_PATH = _ROOT / "web" / "kb.dev.js"

KB_SCHEMA_VERSION = 1

# --- Editorial classification (literal, reviewable sets) -------------------
# Do NOT infer these per-marker at runtime -- see module docstring.

# Self-labeling protein TAGS: no spectrum of their own until dye-conjugated.
TAG_MARKERS: frozenset[str] = frozenset({"HALO", "SNAP", "CLIP"})

# Targeting MOIETIES: no spectrum of their own until dye-conjugated.
MOIETY_MARKERS: frozenset[str] = frozenset({"PHALLOIDIN", "WGA"})

# Fluorescent proteins.
PROTEIN_MARKERS: frozenset[str] = frozenset(
    {
        "GFP",
        "RFP",
        "CFP",
        "YFP",
        "BFP",
        "MCHERRY",
        "TDTOMATO",
        "MNEONGREEN",
        "MSCARLET",
        "MTURQUOISE",
        "CERULEAN",
        "VENUS",
        "CITRINE",
        "IRFP",
        "MIRFP",
        "MEMERALD",
        "MRUBY",
    }
)

# Calcium indicators.
INDICATOR_MARKERS: frozenset[str] = frozenset({"FLUO4", "FURA2", "GCAMP"})

# FAMILIES spanning several spectra: a channel naming one of these alone is
# under-specified (P2's panel engine uses isFamily to refuse a spectrum-less
# channel). `variants` lists the spelled-out, spectrum/isoform-qualified
# members already present in that canonical's OWN alias list in
# MARKER_ALIASES -- e.g. "mitotracker red" -- as opposed to the bare/spacing
# spellings of the family name itself ("mitotracker", "mito tracker"), which
# are not variants. This selection is an editorial judgement call (which
# alias strings actually denote a distinct spectrum), so it is a literal,
# reviewable list here rather than a runtime heuristic; build_kb() below
# asserts every entry is still present in MARKER_ALIASES so a future edit to
# the alias table that drops one of these spellings fails loudly instead of
# shipping a stale variant list.
FAMILY_VARIANTS: dict[str, list[str]] = {
    "MITOTRACKER": [
        "mitotracker deep red",
        "mitotracker green",
        "mitotracker orange",
        "mitotracker red",
    ],
    "LYSOTRACKER": ["lysotracker green", "lysotracker red"],
    "SYTOX": ["sytox blue", "sytox green", "sytox orange", "sytox red"],
    "GCAMP": [
        "gcamp3",
        "gcamp5",
        "gcamp6",
        "gcamp6f",
        "gcamp6m",
        "gcamp6s",
        "gcamp7",
        "gcamp7f",
        "gcamp7s",
    ],
    "BODIPY": [],
}


def _classify(canonical: str) -> str:
    """Return this canonical's KB `class`. Order matters only in that these
    sets are disjoint by construction (see module docstring); no canonical
    appears in more than one."""
    if canonical in TAG_MARKERS:
        return "tag"
    if canonical in MOIETY_MARKERS:
        return "moiety"
    if canonical in PROTEIN_MARKERS:
        return "protein"
    if canonical in INDICATOR_MARKERS:
        return "indicator"
    return "dye"


def build_kb() -> dict:
    """Transform the real MARKER_ALIASES / AMBIGUOUS_IN_FREE_TEXT objects
    into the JSON-serializable KB structure. Pure function of the imported
    data -- no filesystem access here, so it is trivially testable."""
    ambiguous = frozenset(alias.lower() for alias in AMBIGUOUS_IN_FREE_TEXT)

    markers: dict[str, dict] = {}
    for canonical, aliases in MARKER_ALIASES.items():
        alias_list = sorted({alias.lower() for alias in aliases})
        free_text_aliases = [alias for alias in alias_list if alias not in ambiguous]

        is_family = canonical in FAMILY_VARIANTS
        variants = sorted(FAMILY_VARIANTS[canonical]) if is_family else []
        if is_family:
            stale = [v for v in variants if v not in alias_list]
            if stale:
                raise ValueError(
                    f"{canonical}: FAMILY_VARIANTS entries {stale!r} are not "
                    "present in MARKER_ALIASES's own alias list -- update the "
                    "literal FAMILY_VARIANTS list in this script to match the "
                    "real alias table before exporting"
                )

        markers[canonical] = {
            "aliases": alias_list,
            "freeTextAliases": free_text_aliases,
            "class": _classify(canonical),
            "isFamily": is_family,
            "variants": variants,
        }

    return {
        "version": KB_SCHEMA_VERSION,
        "markers": markers,
        "ambiguousInFreeText": sorted(ambiguous),
    }


def _dumps(obj: dict) -> str:
    # sort_keys + fixed separators + a trailing newline: deterministic across
    # runs and machines. (List *contents* are pre-sorted in build_kb() itself
    # -- sort_keys only orders dict keys, not list elements.)
    return json.dumps(obj, sort_keys=True, indent=2, separators=(",", ": ")) + "\n"


def write_markers_json(out_path: Path = MARKERS_JSON_PATH) -> str:
    text = _dumps(build_kb())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8", newline="\n")
    return text


def write_kb_dev_js(kb_dir: Path = KB_DIR, out_path: Path = KB_DEV_JS_PATH) -> str:
    """Emit web/kb.dev.js: a single line assigning globalThis.__MICRONAUT_KB__
    to the aggregate of every web/kb/*.json, keyed by filename stem -- the
    exact aggregation tools/build_single_file.py's `_load_kb` performs at
    build time (see that module), reproduced here so the UNBUILT dev page
    (web/index.html opened directly, or served with no build step) has the
    same global available via a classic <script src="./kb.dev.js">. Never
    committed -- see .gitignore.
    """
    kb: dict[str, object] = {}
    for f in sorted(kb_dir.glob("*.json")):
        kb[f.stem] = json.loads(f.read_text(encoding="utf-8"))
    kb_json = json.dumps(kb, sort_keys=True, separators=(",", ":"))
    text = f"globalThis.__MICRONAUT_KB__ = {kb_json};\n"
    out_path.write_text(text, encoding="utf-8", newline="\n")
    return text


def main() -> int:
    write_markers_json()
    print(f"wrote {MARKERS_JSON_PATH}")
    write_kb_dev_js()
    print(f"wrote {KB_DEV_JS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
