"""Curated dictionary of marker/fluorophore canonical names and aliases.

This module is the single source of truth for mapping the many ways a
marker or fluorophore can be spelled in filenames or acquisition metadata
(e.g. "eGFP", "Alexa Fluor 488", "AF488") to one canonical, filename-safe
form (e.g. "GFP", "ALEXA488").

The list below is a reasonable starting point, not an exhaustive catalog of
every antibody target or dye in existence. It is meant to be reviewed and
extended per lab (see TASKS.md P2-1a) to match the markers actually in use.
"""

from __future__ import annotations

# Canonical marker name -> list of case-insensitive source spellings (aliases).
# Canonical names are uppercase and filename-safe (no spaces/punctuation).
MARKER_ALIASES: dict[str, list[str]] = {
    # Carried over from the original hardcoded KNOWN_MARKERS list.
    "ARL": ["arl"],
    "GFP": ["gfp", "egfp", "gfp+"],
    "DAPI": ["dapi"],
    "SOX": ["sox"],
    "SOX2": ["sox2"],
    "RFP": ["rfp"],
    "CFP": ["cfp"],
    "YFP": ["yfp"],
    "HOECHST": ["hoechst", "hoechst 33342", "hoechst 33258", "hoechst33342", "hoechst33258"],
    # Fluorescent proteins.
    "BFP": ["bfp"],
    "MCHERRY": ["mcherry"],
    "TDTOMATO": ["tdtomato", "td-tomato", "tomato"],
    # Alexa Fluor dyes.
    "ALEXA488": ["alexa fluor 488", "alexa 488", "af488", "alexa488"],
    "ALEXA555": ["alexa fluor 555", "alexa 555", "af555", "alexa555"],
    "ALEXA568": ["alexa fluor 568", "alexa 568", "af568", "alexa568"],
    "ALEXA594": ["alexa fluor 594", "alexa 594", "af594", "alexa594"],
    "ALEXA647": ["alexa fluor 647", "alexa 647", "af647", "alexa647"],
    # Cyanine dyes.
    "CY2": ["cy2", "cyanine2"],
    "CY3": ["cy3", "cyanine3"],
    "CY5": ["cy5", "cyanine5"],
    "CY7": ["cy7", "cyanine7"],
    # DyLight dyes.
    "DYLIGHT488": ["dylight 488", "dylight488"],
    "DYLIGHT550": ["dylight 550", "dylight550"],
    "DYLIGHT650": ["dylight 650", "dylight650"],
    # Classic dyes/stains.
    "FITC": ["fitc"],
    "TRITC": ["tritc"],
    "TEXASRED": ["texas red", "texas-red", "texasred"],
}


def canonical_markers() -> list[str]:
    """Return the list of canonical marker names."""
    return list(MARKER_ALIASES.keys())


def alias_map() -> dict[str, str]:
    """Return a flat {lowercased-alias: CANONICAL} map built from MARKER_ALIASES.

    Each canonical name's own lowercased spelling is included as an alias of
    itself, so callers can look up any spelling (canonical or aliased) the
    same way.
    """
    mapping: dict[str, str] = {}
    for canonical, aliases in MARKER_ALIASES.items():
        mapping[canonical.lower()] = canonical
        for alias in aliases:
            mapping[alias.lower()] = canonical
    return mapping
