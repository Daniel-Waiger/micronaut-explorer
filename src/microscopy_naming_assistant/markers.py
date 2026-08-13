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
    # Additional Alexa Fluor dyes (P2-1a broad extension).
    "ALEXA405": ["alexa fluor 405", "alexa 405", "af405", "alexa405"],
    "ALEXA430": ["alexa fluor 430", "alexa 430", "af430", "alexa430"],
    "ALEXA514": ["alexa fluor 514", "alexa 514", "af514", "alexa514"],
    "ALEXA532": ["alexa fluor 532", "alexa 532", "af532", "alexa532"],
    "ALEXA546": ["alexa fluor 546", "alexa 546", "af546", "alexa546"],
    "ALEXA660": ["alexa fluor 660", "alexa 660", "af660", "alexa660"],
    "ALEXA680": ["alexa fluor 680", "alexa 680", "af680", "alexa680"],
    "ALEXA750": ["alexa fluor 750", "alexa 750", "af750", "alexa750"],
    # ATTO dyes. ATTO647 and ATTO647N are distinct real dyes -- both are kept
    # as separate canonicals on purpose. Word-boundary matching alone is NOT
    # enough to keep them apart: it blocks the shorter "atto647" alias only
    # for the compact "atto647n" spelling (no boundary between "7" and "n"),
    # but "atto 647" (ATTO647) is a legitimate PREFIX of "atto 647-n"
    # (ATTO647N) and "atto647" is a prefix of "atto647-n" -- in both cases the
    # character right after the shorter alias ("-" or " ") IS a word
    # boundary, so both aliases match at the same start index in real text
    # like "ATTO 647-N" or "Atto647-N". `_extract_markers` resolves this
    # structurally (longest match wins, shorter overlapping matches are
    # discarded -- see metadata.py), but the alias table must still list
    # every real spelling of ATTO647N, including the hyphenated-no-space form
    # ("atto647-n"), or ATTO647N is simply never reached and the N gets
    # silently dropped. See test_markers.py for the execution proof of both
    # failure modes and the fix.
    "ATTO425": ["atto 425", "atto425"],
    "ATTO488": ["atto 488", "atto488"],
    "ATTO520": ["atto 520", "atto520"],
    "ATTO550": ["atto 550", "atto550"],
    "ATTO565": ["atto 565", "atto565"],
    "ATTO590": ["atto 590", "atto590"],
    "ATTO633": ["atto 633", "atto633"],
    "ATTO647": ["atto 647", "atto647"],
    "ATTO647N": ["atto 647n", "atto647n", "atto 647-n", "atto647-n"],
    "ATTO700": ["atto 700", "atto700"],
    # Janelia Fluor dyes.
    "JF549": ["jf549", "jf 549", "janelia fluor 549"],
    "JF646": ["jf646", "jf 646", "janelia fluor 646"],
    # SiR (silicon-rhodamine) probes. No bare "SIR" canonical is included --
    # see the module docstring note below on deliberately-omitted aliases.
    "SIRTUBULIN": ["sir-tubulin", "sirtubulin", "sir tubulin"],
    "SIRACTIN": ["sir-actin", "siractin", "sir actin"],
    # Fluorescent proteins.
    "MNEONGREEN": ["mneongreen", "neongreen"],
    "MSCARLET": ["mscarlet"],
    "MTURQUOISE": ["mturquoise"],
    "CERULEAN": ["cerulean"],
    "VENUS": ["venus"],
    "CITRINE": ["citrine"],
    "IRFP": ["irfp"],
    "MIRFP": ["mirfp"],
    "MEMERALD": ["memerald", "emerald"],
    "MRUBY": ["mruby"],
    # Self-labeling protein tags (chemical dyes are named separately).
    "HALO": ["halotag", "halo-tag", "halo tag", "halo"],
    "SNAP": ["snaptag", "snap-tag", "snap tag", "snap"],
    "CLIP": ["cliptag", "clip-tag", "clip tag", "clip"],
    # Stains and probes. "PI" (a common abbreviation for propidium iodide) is
    # deliberately NOT included as an alias -- see the module docstring.
    "PHALLOIDIN": ["phalloidin"],
    "WGA": ["wga"],
    "PROPIDIUMIODIDE": ["propidium iodide", "propidiumiodide"],
    "DRAQ5": ["draq5", "draq 5"],
    "SYTOX": ["sytox", "sytox green", "sytox blue", "sytox red", "sytox orange"],
    "MITOTRACKER": [
        "mitotracker",
        "mito tracker",
        "mitotracker red",
        "mitotracker green",
        "mitotracker deep red",
        "mitotracker orange",
    ],
    "LYSOTRACKER": ["lysotracker", "lyso tracker", "lysotracker red", "lysotracker green"],
    # ER-Tracker (BODIPY-glibenclamide conjugates) ships in three colors, the
    # same "bare name is under-specified" shape as MitoTracker/LysoTracker --
    # promoted to a family below (export_markers_kb.py's FAMILY_VARIANTS) now
    # that the Color panel (PAN-1..8) needs a per-color spectrum, not just a
    # canonical name.
    "ERTRACKER": [
        "er-tracker",
        "ertracker",
        "er tracker",
        "er-tracker green",
        "er-tracker red",
        "er-tracker blue-white dpx",
    ],
    # Plasma-membrane stain, likewise three colors under one bare name --
    # promoted to a family below for the same reason as ER-Tracker.
    "CELLMASK": [
        "cellmask",
        "cell mask",
        "cellmask green",
        "cellmask orange",
        "cellmask deep red",
    ],
    # BODIPY is a whole dye CLASS (20+ published variants with wildly
    # different colors -- FL is green, TMR is orange, 630/650 is far-red),
    # not one spectrum; the bare canonical stays 'ambiguous-family' by
    # design (docs/plans/planner-web-color-panel.md's "near-zero info in the
    # bare family name"). These four are the variants common enough to be
    # worth naming explicitly; many real BODIPY dyes are still, correctly,
    # not covered.
    "BODIPY": ["bodipy", "bodipy fl", "bodipy tmr", "bodipy tr", "bodipy 630"],
    # Calcium indicators.
    "FLUO4": ["fluo-4", "fluo4", "fluo 4"],
    # Fura-2 is RATIOMETRIC (two excitation peaks depending on Ca2+-bound
    # state, ~340/380 nm) -- it does not fit this app's single
    # excitation/emission-peak spillover model at all, so it is deliberately
    # left with no spectra.json entry (an honest content gap, not an
    # oversight) -- see docs/plans/planner-web-color-panel.md.
    "FURA2": ["fura-2", "fura2", "fura 2"],
    "GCAMP": [
        "gcamp",
        "gcamp3",
        "gcamp5",
        "gcamp6",
        "gcamp6f",
        "gcamp6s",
        "gcamp6m",
        "gcamp7",
        "gcamp7f",
        "gcamp7s",
    ],
    "CALCEIN": ["calcein", "calcein am", "calcein-am"],
    # --- SYTO (nucleic-acid stains; distinct from SYTOX above, which is
    # dead-cell-impermeant only) -- a family for the same "bare name is
    # under-specified" reason. Seeded because "SYTO9" (paired with
    # PROPIDIUMIODIDE, above) is the standard BacLight bacterial live/dead
    # stain and was previously entirely absent from this table -- the app's
    # own default study used it and the Color panel could not recognize it.
    # No alternate-spacing variant spellings ("syto 9") on purpose: the
    # variant lookup in engine/spectra.js keys strictly on the alias string
    # that resolved the token, so a second spelling of the same color that
    # ISN'T the one FAMILY_VARIANTS/spectra.json key by would silently
    # resolve 'ambiguous-family' instead of 'known' -- see MITOTRACKER above,
    # which has the same one-spelling-per-variant discipline.
    "SYTO": ["syto", "syto9", "syto13", "syto60", "syto82", "syto85"],
    # A ROS (reactive-oxygen-species) indicator dye: DCFH-DA/H2DCFDA is
    # non-fluorescent until intracellular esterases and oxidation convert it
    # to fluorescent DCF, which is what's actually imaged and what the
    # published excitation/emission values below describe. Bare "DCF" is a
    # short alias, consistent with this table's existing precedent (ARL,
    # SOX, CFP, YFP, RFP, BFP) -- unlike "PI" below, no comparably common
    # non-microscopy meaning collides with it in this domain.
    "DCFDA": ["dcf", "dcfda", "dcf-da", "h2dcfda", "cm-h2dcfda"],
    # --- Common-dye sweep (PAN-1..8 alpha-readiness pass): well-documented
    # additions with real, stable published spectra, filling the most
    # obvious gaps in a FACSI-relevant panel.
    "CELLTRACKERGREEN": ["celltracker green", "cmfda", "celltracker-green"],
    "CELLTRACKERRED": ["celltracker red", "cmtpx", "celltracker-red"],
    "CELLTRACKERBLUE": ["celltracker blue", "cmac", "celltracker-blue"],
    "CELLTRACEVIOLET": ["celltrace violet", "celltrace-violet"],
    "CFSE": ["cfse"],
    "DIO": ["dio"],
    "DII": ["dii"],
    "DID": ["did"],
    "TMRM": ["tmrm"],
    "TMRE": ["tmre"],
    "NILERED": ["nile red", "nilered"],
    "SIRDNA": ["sir-dna", "sirdna", "sir dna"],
    # Sold and used as a fluorophore CONJUGATE ("Annexin V-FITC", "Annexin
    # V-APC", ...); Annexin V itself has no intrinsic spectrum, the same
    # semantics as PHALLOIDIN/WGA above -- see MOIETY_MARKERS in
    # export_markers_kb.py.
    "ANNEXINV": ["annexin v", "annexinv", "annexin-v"],
    # LIVE/DEAD Fixable viability stains: a numbered color series under one
    # product line, the same "bare name is under-specified" family shape.
    # Real spellings use a '/' ("LIVE/DEAD"), which splitMarkers treats as a
    # delimiter -- these aliases use a hyphen or plain space instead so the
    # spelling actually round-trips through this app's tokenizer; the
    # slashed spelling is still recognizable to a human reading the alias.
    "LIVEDEAD": [
        "livedead",
        "live dead",
        "live-dead",
        "livedead blue",
        "livedead green",
        "livedead violet",
        "livedead red",
        "livedead far red",
    ],
    "ALEXA350": ["alexa fluor 350", "alexa 350", "af350", "alexa350"],
    "CF488A": ["cf488a", "cf 488a", "cf488"],
    "CF568": ["cf568", "cf 568"],
    "CF647": ["cf647", "cf 647"],
}

# Deliberately-omitted aliases (checked against word-boundary substring
# false positives before being ruled out -- see docs/plans/
# safe-renaming-describer-openweights.md task B1):
#   - Bare "SIR": would tie with "SIR-TUBULIN"/"SIR-ACTIN" at the same match
#     start (all match position 0 in e.g. "SiR-tubulin" since "-" is a
#     non-word boundary), and "Sir" is a common English honorific, so it
#     would false-positive broadly with no reliable disambiguation.
#   - Bare "PI" for propidium iodide: a 2-letter token far too ambiguous
#     (Principal Investigator, the mathematical constant, etc.) for
#     whole-word matching to disambiguate safely.
#   - Bare "ruby"/"turquoise": common English/color words with no
#     microscopy-specific spelling backing them (unlike "mRuby"/"mTurquoise",
#     which ARE included), so they are left out to avoid needless false
#     positives in free-text descriptions.

# Aliases that ARE real, legitimate marker/fluorophore spellings -- unlike the
# entries above, they stay in MARKER_ALIASES and keep resolving via an EXACT
# metadata-value lookup (field_map.py::_canonical_marker, which only ever
# compares a whole, vendor-prefix-stripped metadata value against the alias
# table, never surrounding prose) -- but each one is ALSO a common English
# word or standard microscope/camera-software term, so scanning a raw
# metadata blob or filename stem for it as a substring produces real false
# positives. `_extract_markers` (metadata.py) excludes exactly these aliases
# from its free-text scan; every other alias of the same canonical (e.g.
# "halotag", "snap-tag") is unambiguous and still matches in free text.
AMBIGUOUS_IN_FREE_TEXT: frozenset[str] = frozenset(
    {
        # "Snap" is the standard single-frame-acquisition command/state in
        # Micro-Manager, MetaMorph and NIS-Elements UI/log text (e.g. "Live/
        # Snap acquisition", "Snap Shot triggered by user").
        "snap",
        # "Halo" is an optical-artifact term (lens/lamp halo) and a plain
        # English word; also collides with "halogen" lamp descriptions in
        # illumination metadata.
        "halo",
        # "Clip"/"clipping" is standard exposure/signal terminology (a
        # clipped histogram, a clipped sensor value) as well as a common
        # English word ("video clip").
        "clip",
        # Planet/mythological name; also "Venus flytrap" (a common assay
        # organism name) in unrelated experiment-description text.
        "venus",
        # Gem/color name that shows up in unrelated reagent/buffer text
        # ("citrine acid buffer").
        "citrine",
        # Gem/color name ("Emerald Isle", "emerald green" filter/dye
        # descriptions unrelated to the mEmerald fluorescent protein).
        "emerald",
        # Common color-name word.
        "cerulean",
        # Common English word (also a literal specimen in plant-imaging
        # notes, e.g. "tomato leaf cross-section").
        "tomato",
    }
)


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
