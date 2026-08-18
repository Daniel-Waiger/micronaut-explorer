# `markers.json` — marker knowledge base

**This file is now the canonical, hand-edited source of truth.** It used to
be *generated* by `tools/export_markers_kb.py` from the Python source of
truth (`src/microscopy_naming_assistant/markers.py`'s `MARKER_ALIASES` /
`AMBIGUOUS_IN_FREE_TEXT`). As part of packing the Python "Micronaut Classic"
side out of this repo, that generator has been retired/archived and
`web/kb/markers.json` is no longer regenerated from anything — it is edited
directly. This document captures the editorial knowledge that used to live
only in the generator's comments, so it survives the generator's removal.

Anyone hand-editing `markers.json` going forward must follow the invariants
below; they were previously enforced mechanically by the generator and are
now the reader/editor's responsibility.

## JSON shape

```jsonc
{
  "version": 1,
  "markers": {
    "<CANONICAL>": {
      "aliases": ["...lowercased, sorted..."],
      "freeTextAliases": ["...aliases MINUS anything in ambiguousInFreeText..."],
      "class": "dye" | "protein" | "tag" | "moiety" | "target" | "stain" | "indicator",
      "isFamily": true | false,
      "variants": ["...spectrum-qualified members, only when isFamily is true..."]
    }
  },
  "ambiguousInFreeText": ["...sorted..."]
}
```

- Top level: `version` (schema version, currently `1`), `markers` (a map from
  CANONICAL marker name to its entry), and `ambiguousInFreeText` (a sorted
  list of alias strings that are too ambiguous to auto-match against free
  text anywhere in the KB, regardless of which canonical they belong to).
- Each entry in `markers` is keyed by the CANONICAL marker name and has:
  - `aliases`: lowercased, sorted list of every alias string that maps to
    this canonical.
  - `freeTextAliases`: `aliases` minus any alias also present in
    `ambiguousInFreeText` — the subset safe to match against free-form user
    text.
  - `class`: the editorial classification (taxonomy below).
  - `isFamily`: whether this canonical is a family spanning several spectra.
  - `variants`: for family canonicals, the spectrum/isoform-qualified
    alias spellings that belong to that family (see Family rule below);
    empty list otherwise.

## Class taxonomy

Classification is an editorial decision, not something to infer per-marker
at runtime — it must stay reviewable as a small set of explicit lists. The
sets below are disjoint by construction (no canonical appears in more than
one). Any canonical not present in one of the named sets defaults to class
`"dye"`.

### `tag` — TAG_MARKERS (3 members)

```
HALO, SNAP, CLIP
```

Self-labeling protein tags: no spectrum of their own until dye-conjugated.

### `moiety` — MOIETY_MARKERS (3 members)

```
PHALLOIDIN, WGA, ANNEXINV
```

Targeting moieties: direct-conjugate probes (sold and imaged AS the
fluorophore, e.g. "Phalloidin-Alexa 488", "Annexin V-FITC") — no spectrum of
their own until dye-conjugated, but **no antibody is involved**. This
distinction matters beyond the Color panel: the controls engine gates
isotype-control / secondary-antibody-only-control rules on whether a panel
actually uses an antibody (see `target` below), and an isotype control for a
phalloidin/WGA/Annexin V panel would be nonsensical — none of the three
involves a primary or secondary antibody to control for.

### `target` — TARGET_MARKERS (2 members)

```
SOX, SOX2
```

Antibody targets: no spectrum of their own (same "depends on the conjugate"
semantics as `moiety`), but specifically detected via a primary antibody
(plus, usually, a fluorophore-conjugated secondary) — this is the class
isotype-control / secondary-only-control content should gate on. SOX/SOX2
were previously classified `dye` by the generator's fallback, a genuine
misclassification: `dye` silently implied "we haven't drafted this dye's
spectrum yet" when the real answer was "this is not a dye, and the
isotype-control rule's own gate was too broad to tell the difference."

### `protein` — PROTEIN_MARKERS (34 members)

Fluorescent proteins:

```
GFP, RFP, CFP, YFP, BFP, MCHERRY, TDTOMATO, MNEONGREEN, MSCARLET,
MTURQUOISE, CERULEAN, VENUS, CITRINE, IRFP, MIRFP, MEMERALD, MRUBY,
TAGBFP2, MTURQUOISE2, MCERULEAN3, SUPERFOLDERGFP, MCLOVER3, MGREENLANTERN,
MORANGE2, MAPPLE, MRUBY3, MSCARLETI, MSCARLET3, MKATE2, FUSIONRED,
IRFP670, IRFP713, MIRFP680, MIRFP720
```

### `indicator` — INDICATOR_MARKERS (15 members)

Functional calcium, ROS, mitochondrial, and pH indicators:

```
FLUO4, FURA2, GCAMP, FLUO3, CALCIUMGREEN1, CALCIUMORANGE, RHOD2, XRHOD1,
CELLROXGREEN, CELLROXORANGE, CELLROXDEEPRED, DHE, MITOSOXGREEN,
PHRODOGREEN, PHRODORED
```

### `stain` — STAIN_MARKERS (16 members)

Intrinsically fluorescent stains and tracers used for live-cell/organelle or
nucleic-acid labeling. These remain distinct from general conjugatable dyes
because downstream panel guidance can reason about their assay role:

```
RHODAMINE123, FM143, FM464, LIPIDTOXGREEN, LIPIDTOXRED, LIPIDTOXDEEPRED,
7AAD, ETHIDIUMHOMODIMER1, TOPRO1, TOPRO3, TOPRO5, YOPRO1, YOPRO3,
LYSOTRACKER, LIVEDEAD, SYTO
```

### `dye` (fallback, not a literal set)

Every canonical not in one of the six sets above. Historically this meant
"a conjugatable dye with its own spectrum" but could also silently mean "not
yet classified" — see the `target`/SOX note above for why that ambiguity
was a real bug once.

## Family rule

`isFamily` is `true` for canonicals present in the `FAMILY_VARIANTS` map
(families spanning several spectra — a channel naming one of these alone is
under-specified; the panel engine uses `isFamily` to refuse a spectrum-less
channel). `variants` lists the spelled-out, spectrum/isoform-qualified alias
spellings for that canonical — these must **also appear in that canonical's
own `aliases` list**. Bare/spacing spellings of the family name itself (e.g.
"mitotracker", "mito tracker") are NOT variants. Choosing which alias
strings denote a distinct spectrum is an editorial judgement call, which is
why this mapping must stay a literal, reviewable list rather than a runtime
heuristic.

`FAMILY_VARIANTS` (verbatim from the generator):

```
MITOTRACKER: mitotracker deep red, mitotracker green, mitotracker orange,
             mitotracker red

LYSOTRACKER: lysotracker blue, lysotracker deep red, lysotracker green,
             lysotracker red, lysotracker yellow

SYTOX:       sytox blue, sytox green, sytox orange, sytox red

GCAMP:       gcamp3, gcamp5, gcamp6, gcamp6f, gcamp6m, gcamp6s, gcamp7,
             gcamp7f, gcamp7s

BODIPY:      bodipy fl, bodipy tmr, bodipy tr, bodipy 630
             (Was `[]` -- a family with NO variants, meaning every "BODIPY
             ..." spelling was unreachable and always 'ambiguous-family' at
             best. These four are the BODIPY variants common enough to name
             explicitly with stable published spectra; the bare "bodipy"
             alias correctly stays 'ambiguous-family' since BODIPY names a
             whole dye class, not one color.)

ERTRACKER:   er-tracker green, er-tracker red, er-tracker blue-white dpx

CELLMASK:    cellmask green, cellmask orange, cellmask deep red

SYTO:        syto 40, syto 41, syto 42, syto 45, syto rnaselect, syto9,
             syto13, syto60, syto82, syto85

LIVEDEAD:    livedead aqua, livedead blue, livedead far red, livedead green,
             livedead near ir, livedead red, livedead violet, livedead
             yellow
```

## Hand-edit contract

These invariants were previously enforced mechanically by
`tools/export_markers_kb.py` (`sort_keys`, fixed separators, sorted list
contents, deterministic byte-identical output across runs). With the
generator retired, they are now **hand-maintained invariants** — anyone
editing `markers.json` directly must preserve them:

- `markers` object keys are sorted (canonical names in sorted order).
- Every `aliases` list is lowercased and sorted.
- `freeTextAliases` = `aliases` minus any alias also present in
  `ambiguousInFreeText` (top-level, case-insensitive/lowercased).
- `ambiguousInFreeText` itself is sorted.
- Every marker has exactly **one** canonical entry — an alias string must
  not be duplicated across two different canonicals.
- For family canonicals (`isFamily: true`), every string in `variants` must
  also be present in that same canonical's own `aliases` list — a variant
  spelling that isn't also a recognized alias of its own canonical is
  inconsistent and should be treated as a bug in the edit, not shipped.
- `class` must be one of: `dye`, `protein`, `tag`, `moiety`, `target`,
  `indicator`, `stain` — assigned per the taxonomy above, not inferred ad
  hoc.
- There is no generator anymore. Any future addition, rename, or
  reclassification of a marker is made directly in this JSON file by a
  human editor following the rules above, not regenerated from Python.
