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
    "ALEXA700": ["alexa fluor 700", "alexa 700", "af700", "alexa700"],
    "ALEXA750": ["alexa fluor 750", "alexa 750", "af750", "alexa750"],
    "ALEXA790": ["alexa fluor 790", "alexa 790", "af790", "alexa790"],
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
    "ATTO390": ["atto 390", "atto390"],
    "ATTO425": ["atto 425", "atto425"],
    "ATTO465": ["atto 465", "atto465"],
    "ATTO488": ["atto 488", "atto488"],
    "ATTO520": ["atto 520", "atto520"],
    "ATTO532": ["atto 532", "atto532"],
    "ATTO550": ["atto 550", "atto550"],
    "ATTO565": ["atto 565", "atto565"],
    "ATTO590": ["atto 590", "atto590"],
    "ATTO594": ["atto 594", "atto594"],
    "ATTO633": ["atto 633", "atto633"],
    "ATTO647": ["atto 647", "atto647"],
    "ATTO647N": ["atto 647n", "atto647n", "atto 647-n", "atto647-n"],
    "ATTO680": ["atto 680", "atto680"],
    "ATTO700": ["atto 700", "atto700"],
    "ATTO725": ["atto 725", "atto725"],
    "ATTO740": ["atto 740", "atto740"],
    # Biotium CF dyes. The S suffix in CF405S is part of the product name,
    # not a state label; keep it in every spelling.
    "CF350": ["cf350", "cf 350"],
    "CF405S": ["cf405s", "cf 405s", "cf 405 s"],
    "CF514": ["cf514", "cf 514"],
    "CF555": ["cf555", "cf 555"],
    "CF594": ["cf594", "cf 594"],
    "CF633": ["cf633", "cf 633"],
    "CF680": ["cf680", "cf 680"],
    "CF750": ["cf750", "cf 750"],
    "CF790": ["cf790", "cf 790"],
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
    # Exact fluorescent-protein variants with distinct source-backed peaks.
    # Their generic parents above remain independently reachable.
    "TAGBFP2": ["mtagbfp2", "m-tagbfp2", "tagbfp2", "tag bfp2"],
    "MTURQUOISE2": ["mturquoise2", "m-turquoise2", "m turquoise2"],
    "MCERULEAN3": ["mcerulean3", "m-cerulean3", "m cerulean3"],
    "SUPERFOLDERGFP": ["superfolder gfp", "superfoldergfp", "sfgfp", "sf gfp"],
    "MCLOVER3": ["mclover3", "m-clover3", "m clover3"],
    "MGREENLANTERN": ["mgreenlantern", "m-greenlantern", "m greenlantern"],
    "MORANGE2": ["morange2", "m-orange2", "m orange2"],
    "MAPPLE": ["mapple", "m-apple", "m apple"],
    "MRUBY3": ["mruby3", "m-ruby3", "m ruby3"],
    "MSCARLETI": ["mscarlet-i", "mscarlet i", "mscarleti"],
    "MSCARLET3": ["mscarlet3", "mscarlet 3", "m-scarlet3"],
    "MKATE2": ["mkate2", "mkate 2", "m-kate2"],
    "FUSIONRED": ["fusionred", "fusion red", "fusion-red"],
    "IRFP670": ["irfp670", "irfp 670", "i-rfp670"],
    "IRFP713": ["irfp713", "irfp 713", "i-rfp713"],
    "MIRFP680": ["mirfp680", "mirfp 680", "mi-rfp680"],
    "MIRFP720": ["mirfp720", "mirfp 720", "mi-rfp720"],
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
    "LYSOTRACKER": [
        "lysotracker",
        "lyso tracker",
        "lysotracker red",
        "lysotracker green",
        "lysotracker blue",
        "lysotracker yellow",
        "lysotracker deep red",
    ],
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
    "SYTO": [
        "syto",
        "syto9",
        "syto13",
        "syto60",
        "syto82",
        "syto85",
        "syto 40",
        "syto 41",
        "syto 42",
        "syto 45",
        "syto rnaselect",
    ],
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
        "livedead aqua",
        "live-dead aqua",
        "livedead yellow",
        "live-dead yellow",
        "livedead near ir",
        "live-dead near ir",
    ],
    "ALEXA350": ["alexa fluor 350", "alexa 350", "af350", "alexa350"],
    "CF488A": ["cf488a", "cf 488a", "cf488"],
    "CF568": ["cf568", "cf 568"],
    "CF647": ["cf647", "cf 647"],
    # Additional source-backed organic labels and NIR dyes.
    "DYLIGHT405": ["dylight 405", "dylight405"],
    "DYLIGHT594": ["dylight 594", "dylight594"],
    "DYLIGHT680": ["dylight 680", "dylight680"],
    "DYLIGHT755": ["dylight 755", "dylight755"],
    "DYLIGHT800": ["dylight 800", "dylight800"],
    "OREGONGREEN488": ["oregon green 488", "oregon green488", "oregongreen 488", "oregongreen488"],
    "PACIFICBLUE": ["pacific blue", "pacificblue"],
    "PACIFICORANGE": ["pacific orange", "pacificorange"],
    "CASCADEBLUE": ["cascade blue", "cascadeblue"],
    "IRDYE680RD": ["irdye 680rd", "ir dye 680rd", "irdye680rd"],
    "IRDYE800CW": ["irdye 800cw", "ir dye 800cw", "irdye800cw"],
    "DIR": ["dir", "di-r", "diic18(7)", "diic18 7"],
    # Live-cell/organelle probes.
    "RHODAMINE123": ["rhodamine 123", "rhodamine123", "rho 123", "rho123"],
    "FM143": ["fm 1-43", "fm1-43", "fm 1 43", "fm143"],
    "FM464": ["fm 4-64", "fm4-64", "fm 4 64", "fm464"],
    "LIPIDTOXGREEN": [
        "lipidtox green",
        "hcs lipidtox green",
        "hcs lipidtox green neutral lipid stain",
    ],
    "LIPIDTOXRED": ["lipidtox red", "hcs lipidtox red", "hcs lipidtox red neutral lipid stain"],
    "LIPIDTOXDEEPRED": [
        "lipidtox deep red",
        "hcs lipidtox deep red",
        "hcs lipidtox deep red neutral lipid stain",
    ],
    # Nucleic-acid stains.
    "7AAD": ["7-aad", "7 aad", "7aad", "7-aminoactinomycin d"],
    "ETHIDIUMHOMODIMER1": [
        "ethidium homodimer-1",
        "ethidium homodimer 1",
        "ethidiumhomodimer1",
        "ethd-1",
        "ethd 1",
        "ethd1",
    ],
    "TOPRO1": ["to-pro-1", "to pro 1", "topro 1", "topro1"],
    "TOPRO3": ["to-pro-3", "to pro 3", "topro 3", "topro3"],
    "TOPRO5": ["to-pro-5", "to pro 5", "topro 5", "topro5"],
    "YOPRO1": ["yo-pro-1", "yo pro 1", "yopro 1", "yopro1"],
    "YOPRO3": ["yo-pro-3", "yo pro 3", "yopro 3", "yopro3"],
    # Functional calcium, ROS, mitochondrial, and pH indicators.
    "FLUO3": ["fluo-3", "fluo3", "fluo 3"],
    "CALCIUMGREEN1": ["calcium green-1", "calcium green 1", "calciumgreen1"],
    "CALCIUMORANGE": ["calcium orange", "calciumorange"],
    "RHOD2": ["rhod-2", "rhod2", "rhod 2"],
    "XRHOD1": ["x-rhod-1", "x rhod 1", "xrhod1"],
    "CELLROXGREEN": ["cellrox green", "cellroxgreen", "cellrox green reagent"],
    "CELLROXORANGE": ["cellrox orange", "cellroxorange", "cellrox orange reagent"],
    "CELLROXDEEPRED": ["cellrox deep red", "cellroxdeepred", "cellrox deep red reagent"],
    "DHE": ["dhe", "dihydroethidium"],
    "MITOSOXGREEN": ["mitosox green", "mitosoxgreen"],
    "PHRODOGREEN": ["phrodo green", "phrodogreen"],
    "PHRODORED": ["phrodo red", "phrodored"],
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
        # Windows/Unix directory-listing command and a common metadata field
        # abbreviation; DiR remains available through exact-value lookup and
        # through its unambiguous DiIC18(7) spelling.
        "dir",
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
