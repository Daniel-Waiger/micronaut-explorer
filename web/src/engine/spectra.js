// The color panel (qualitative spectral-spillover advisor): a loader for
// web/kb/spectra.json, a five-state resolver from a free-text markers field
// to spectral data, and a pairwise peak-proximity evaluator.
//
// Mirrors engine/controls.js's loader discipline deliberately: an explicit
// whitelist per entry, never a spread of the raw JSON, so a new/misspelled
// property is silently DROPPED here until it is added to this list by name
// -- see advisor.js's own header for why (this project has shipped the
// opposite failure once already).
//
// QUALITATIVE, NOT AN INTEGRAL: the pairwise check below is peak-proximity
// on two numbers (excitation/emission peak nanometers), not a real spectral-
// overlap-integral over excitation/emission curves. See
// docs/plans/planner-web-color-panel.md, Decision 2, for why proximity was
// chosen and why the thresholds live in the KB as data rather than as
// engine constants.
//
// Five-state resolution (Decision 5, same plan doc), never a boolean
// known/unknown -- mirrors controls.js's readoutState never-silent
// discipline one level deeper:
//   'unrecognized'         -- no alias match at all (likely a typo).
//   'ambiguous-family'     -- resolves to an isFamily canonical, but the
//                             matched alias isn't one of its listed variants
//                             (e.g. bare "MitoTracker") -- cannot check
//                             spillover without knowing which color.
//   'no-intrinsic-spectrum'-- resolves to a tag/moiety (HaloTag, phalloidin,
//                             ...) -- spillover depends on the conjugate
//                             dye, not the tag itself.
//   'spectrum-unavailable' -- a real, recognized dye/protein/indicator, just
//                             not yet drafted in spectra.json -- an honest
//                             content gap, not a silent drop.
//   'known'                -- full peaks available; participates in the
//                             pairwise check.
//
// A SIXTH, panel-level state lives outside this list: resolvePanel's
// `panelState` can be 'no-markers-declared' (the field holds one of the
// app's own "nothing here" sentinels -- 'NONE', 'N/A', 'unstained', ...,
// see defaultStudy.js's scratch-migration assay) rather than 'has-entries'.
// That is a deliberate DECLARATION, not a typo, and rendering it through
// 'unrecognized' (as commit 1 of this feature did) told the user their own
// app's sentinel was a misspelling -- exactly the silence/false-alarm
// asymmetry this module otherwise refuses to allow.
//
// Pure module: no DOM, no store. Imports splitMarkers (the ONE existing
// tokenizer for this field, not a second regex) and kbMarker (the one
// existing marker-class/isFamily lookup, already reserved but previously
// uncalled in production).

import { splitMarkers } from './validation.js';
import { kbMarker } from '../core/kb.js';

export const SPECTRAL_STATES = [
  'unrecognized',
  'ambiguous-family',
  'no-intrinsic-spectrum',
  'spectrum-unavailable',
  'known',
];

// The app's own "there is nothing to check here" sentinels (see
// defaultStudy.js's scratch-migration assay, which seeds literal 'NONE').
// Matched against the WHOLE field, case-insensitively, with internal
// whitespace collapsed -- so 'NONE', ' none ', 'N/A', and 'label-free' all
// resolve the same declarative way instead of through per-token
// 'unrecognized'. Deliberately does NOT match ambiguous prose containing
// other words (e.g. "none yet, TBD") -- that is likely user note-taking,
// not a sentinel, and still deserves per-token resolution.
const NO_MARKERS_SENTINELS = new Set([
  'none',
  'no markers',
  'no marker',
  'no stain',
  'no staining',
  'unstained',
  'label-free',
  'label free',
  'n/a',
  'na',
  'unknown',
  'tbd',
]);

const DEFAULT_REVIEW_STATUS = 'claude-drafted';
const DEFAULT_EMISSION_PROXIMITY_NM = 25;
const DEFAULT_EXCITATION_PROXIMITY_NM = 20;

// Peak plausibility (Decision: content is hand-drafted and hand-edited, so a
// type check alone lets a transposed digit through clean). The visible
// spectrum plus a safety margin into near-UV/near-IR, where FACSI-relevant
// dyes/FPs/indicators actually live; anything outside it is far more likely
// a typo than a real fluorophore this app should be advising on.
const MIN_PLAUSIBLE_PEAK_NM = 300;
const MAX_PLAUSIBLE_PEAK_NM = 900;

/**
 * A Stokes shift is always positive (emission is always redder / lower-
 * energy than excitation) -- `emissionPeakNm <= excitationPeakNm` is
 * physically impossible for real fluorescence and is a strong signal of a
 * transposed excitation/emission pair.
 */
function peaksArePlausible(excitationPeakNm, emissionPeakNm) {
  return (
    excitationPeakNm >= MIN_PLAUSIBLE_PEAK_NM &&
    excitationPeakNm <= MAX_PLAUSIBLE_PEAK_NM &&
    emissionPeakNm >= MIN_PLAUSIBLE_PEAK_NM &&
    emissionPeakNm <= MAX_PLAUSIBLE_PEAK_NM &&
    emissionPeakNm > excitationPeakNm
  );
}

const KNOWN_FLUOROPHORE_KEYS = new Set([
  'excitationPeakNm',
  'emissionPeakNm',
  'isFamily',
  'variants',
  'reviewStatus',
  'note',
]);
const KNOWN_VARIANT_KEYS = new Set(['excitationPeakNm', 'emissionPeakNm']);

function spectraIssue(field, message) {
  return { field, message, severity: 'error' };
}

function normalizeVariantEntry(canonical, variantKey, entry, issues) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(spectraIssue(canonical, `variant '${variantKey}' entry is not an object`));
    return null;
  }
  for (const key of Object.keys(entry)) {
    if (!KNOWN_VARIANT_KEYS.has(key)) {
      issues.push(spectraIssue(canonical, `variant '${variantKey}' has an unrecognized property '${key}' -- it will be ignored`));
    }
  }
  const excitationPeakNm = entry.excitationPeakNm;
  const emissionPeakNm = entry.emissionPeakNm;
  if (typeof excitationPeakNm !== 'number' || typeof emissionPeakNm !== 'number') {
    issues.push(spectraIssue(canonical, `variant '${variantKey}' is missing numeric excitationPeakNm/emissionPeakNm`));
    return null;
  }
  if (!peaksArePlausible(excitationPeakNm, emissionPeakNm)) {
    issues.push(
      spectraIssue(
        canonical,
        `variant '${variantKey}' has an implausible excitationPeakNm/emissionPeakNm (${excitationPeakNm}/${emissionPeakNm} nm -- expected ${MIN_PLAUSIBLE_PEAK_NM}-${MAX_PLAUSIBLE_PEAK_NM} nm with emission > excitation) -- likely a data-entry error`
      )
    );
    return null;
  }
  return { excitationPeakNm, emissionPeakNm };
}

/**
 * Validate and normalize one raw fluorophore entry. Returns `null` (with
 * issues pushed) if the entry cannot be shipped; otherwise a normalized
 * `{isFamily, reviewStatus, excitationPeakNm, emissionPeakNm}` (non-family)
 * or `{isFamily: true, reviewStatus, variants: {variantKey: {excitationPeakNm, emissionPeakNm}}}`.
 *
 * Deliberately independent of markers.json's own `isFamily` flag (Decision 3):
 * this pack's `isFamily` may disagree (e.g. GCaMP is isFamily in markers.json
 * but ONE spectrum here, since its variants differ in kinetics, not color).
 */
function normalizeFluorophoreEntry(canonical, entry, issues) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(spectraIssue(canonical, 'fluorophore entry is not an object'));
    return null;
  }
  for (const key of Object.keys(entry)) {
    if (!KNOWN_FLUOROPHORE_KEYS.has(key)) {
      issues.push(spectraIssue(canonical, `fluorophore entry has an unrecognized property '${key}' -- it will be ignored`));
    }
  }

  const reviewStatus =
    typeof entry.reviewStatus === 'string' && entry.reviewStatus.trim() ? entry.reviewStatus.trim() : DEFAULT_REVIEW_STATUS;

  if (entry.isFamily === true) {
    const rawVariants = entry.variants;
    const isPlainObject = rawVariants !== null && typeof rawVariants === 'object' && !Array.isArray(rawVariants);
    if (!isPlainObject || Object.keys(rawVariants).length === 0) {
      issues.push(spectraIssue(canonical, "family fluorophore 'variants' must be a non-empty object"));
      return null;
    }
    const variants = {};
    for (const [variantKey, variantEntry] of Object.entries(rawVariants)) {
      const normalized = normalizeVariantEntry(canonical, variantKey, variantEntry, issues);
      if (normalized) variants[variantKey.toLowerCase()] = normalized;
    }
    if (Object.keys(variants).length === 0) return null;
    return { isFamily: true, reviewStatus, variants };
  }

  const excitationPeakNm = entry.excitationPeakNm;
  const emissionPeakNm = entry.emissionPeakNm;
  if (typeof excitationPeakNm !== 'number' || typeof emissionPeakNm !== 'number') {
    issues.push(
      spectraIssue(canonical, "fluorophore entry is missing numeric excitationPeakNm/emissionPeakNm (or isFamily:true with 'variants')")
    );
    return null;
  }
  if (!peaksArePlausible(excitationPeakNm, emissionPeakNm)) {
    issues.push(
      spectraIssue(
        canonical,
        `fluorophore entry has an implausible excitationPeakNm/emissionPeakNm (${excitationPeakNm}/${emissionPeakNm} nm -- expected ${MIN_PLAUSIBLE_PEAK_NM}-${MAX_PLAUSIBLE_PEAK_NM} nm with emission > excitation) -- likely a data-entry error`
      )
    );
    return null;
  }
  return { isFamily: false, reviewStatus, excitationPeakNm, emissionPeakNm };
}

/**
 * Validate and normalize a raw spectra pack into
 * `{fluorophores, overlapRules, issues}`. TOTAL: never throws. A malformed
 * entry is dropped and reported rather than aborting the whole pack -- one
 * bad entry must not silence every entry.
 *
 * `raw` is the parsed contents of web/kb/spectra.json: `{version,
 * fluorophores, overlapRules}`.
 */
export function loadSpectraKb(raw) {
  const issues = [];
  const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const source = isPlainObject ? raw : {};

  if (!isPlainObject) {
    issues.push(spectraIssue('spectra', 'spectra pack is missing -- run tools/export_markers_kb.py'));
  } else if (source.version !== 1) {
    issues.push(spectraIssue('spectra', `spectra pack version is ${JSON.stringify(source.version ?? null)}, expected 1`));
  }

  const rawFluorophores =
    source.fluorophores && typeof source.fluorophores === 'object' && !Array.isArray(source.fluorophores) ? source.fluorophores : {};
  const fluorophores = {};
  for (const [canonical, entry] of Object.entries(rawFluorophores)) {
    const normalized = normalizeFluorophoreEntry(canonical, entry, issues);
    if (normalized) fluorophores[canonical] = normalized;
  }

  const rawOverlapRules =
    source.overlapRules && typeof source.overlapRules === 'object' && !Array.isArray(source.overlapRules) ? source.overlapRules : {};

  const emissionProximityNm =
    typeof rawOverlapRules.emissionProximityNm === 'number' ? rawOverlapRules.emissionProximityNm : DEFAULT_EMISSION_PROXIMITY_NM;
  if (typeof rawOverlapRules.emissionProximityNm !== 'number') {
    issues.push(spectraIssue('overlapRules', `overlapRules.emissionProximityNm is missing/non-numeric -- defaulting to ${emissionProximityNm}`));
  }

  const excitationProximityNm =
    typeof rawOverlapRules.excitationProximityNm === 'number' ? rawOverlapRules.excitationProximityNm : DEFAULT_EXCITATION_PROXIMITY_NM;
  if (typeof rawOverlapRules.excitationProximityNm !== 'number') {
    issues.push(
      spectraIssue('overlapRules', `overlapRules.excitationProximityNm is missing/non-numeric -- defaulting to ${excitationProximityNm}`)
    );
  }

  const overlapReviewStatus =
    typeof rawOverlapRules.reviewStatus === 'string' && rawOverlapRules.reviewStatus.trim()
      ? rawOverlapRules.reviewStatus.trim()
      : DEFAULT_REVIEW_STATUS;

  return {
    fluorophores,
    overlapRules: { emissionProximityNm, excitationProximityNm, reviewStatus: overlapReviewStatus },
    issues,
  };
}

/**
 * Resolve ONE already-split token (a canonical-cased or free-typed marker
 * spelling, as produced by engine/validation.js's splitMarkers) to its
 * five-state spectral resolution. TOTAL: never throws, and always returns a
 * `{token, canonical, state, ...}` shape -- `excitationPeakNm`/
 * `emissionPeakNm`/`reviewStatus` are present only when `state === 'known'`.
 *
 * `markerIndex` is core/kb.js's indexKb() output (for alias -> canonical);
 * `markersKb` is core/kb.js's loadKb() `{kb}` (for kbMarker's class/
 * isFamily/variants); `fluorophores` is this module's loadSpectraKb()
 * `fluorophores` map.
 */
export function resolveMarkerToken(token, markerIndex, markersKb, fluorophores) {
  const needle = typeof token === 'string' ? token.trim().toLowerCase() : '';
  const canonical = markerIndex && markerIndex.aliasToCanonical ? markerIndex.aliasToCanonical.get(needle) : undefined;

  if (!canonical) {
    return { token, canonical: null, state: 'unrecognized' };
  }

  const markerEntry = kbMarker(markersKb, canonical);
  const markerClass = markerEntry ? markerEntry.class : undefined;
  // 'tag' (HaloTag/SNAP/CLIP), 'moiety' (phalloidin/WGA/Annexin V -- a
  // direct-conjugate probe, no antibody), and 'target' (Sox2 and friends --
  // an ANTIBODY target, no antibody-free conjugate) all render identically
  // here: none has a spectrum of its own. They stay three DISTINCT KB
  // classes, not folded into one, because engine/controls.js's isotype/
  // secondary-antibody-control rules need to tell 'target' apart from
  // 'moiety' precisely (an isotype control makes no sense for a
  // phalloidin/WGA/Annexin V panel -- no antibody is involved) -- see
  // derivePanelFacts below and export_markers_kb.py's TARGET_MARKERS.
  if (markerClass === 'tag' || markerClass === 'moiety' || markerClass === 'target') {
    return { token, canonical, state: 'no-intrinsic-spectrum' };
  }

  const spectraEntry = fluorophores ? fluorophores[canonical] : undefined;
  if (!spectraEntry) {
    return { token, canonical, state: 'spectrum-unavailable' };
  }

  if (spectraEntry.isFamily) {
    // Some branded families have punctuation-only alias variants (for
    // example LIVE-DEAD versus LIVEDEAD) while spectra.json deliberately
    // keeps one semantic variant record. Try the exact spelling first,
    // then the punctuation-collapsed spelling already owned by the same
    // canonical. This preserves one source-backed peak record without
    // degrading an exact branded alias to an ambiguous bare family.
    const collapsedNeedle = needle.replaceAll('-', '');
    const variantKey = spectraEntry.variants[needle] ? needle : collapsedNeedle;
    const variant = spectraEntry.variants[variantKey];
    if (!variant) {
      return { token, canonical, state: 'ambiguous-family' };
    }
    return {
      token,
      canonical,
      // `variantKey` (the specific matched variant, e.g. 'mitotracker deep
      // red') rides along ONLY for a resolved family member -- resolvePanel
      // needs it to dedupe two different colors of the same family as two
      // entries, not one (see its own header). Absent for every other
      // state/non-family entry, so a caller can branch on its presence
      // instead of re-deriving isFamily.
      variantKey,
      state: 'known',
      excitationPeakNm: variant.excitationPeakNm,
      emissionPeakNm: variant.emissionPeakNm,
      reviewStatus: spectraEntry.reviewStatus,
    };
  }

  return {
    token,
    canonical,
    state: 'known',
    excitationPeakNm: spectraEntry.excitationPeakNm,
    emissionPeakNm: spectraEntry.emissionPeakNm,
    reviewStatus: spectraEntry.reviewStatus,
  };
}

// splitMarkers (engine/validation.js) tokenizes on `/[-,;|/]+/` -- correct
// for Classic's filename semantics, where '-' is a field separator, not a
// character inside a marker name. But markers.json deliberately lists
// hyphenated ALIASES for this same field ('calcein-am', 'fura-2',
// 'texas-red', 'halo-tag', ...), so splitMarkers shreds them into
// unreachable fragments ("CALCEIN"/"AM", "FURA"/"2") before this module
// ever sees them.
//
// Rather than forking a second tokenizer (the module header's whole point),
// this is a REJOIN pass over splitMarkers' own output: try gluing 2-3
// consecutive tokens back together with '-' and see if that exact string is
// a known alias. Longest span first, so a genuine 3-token alias is not
// pre-empted by an accidental 2-token match inside it. A false-positive
// rejoin requires an EXACT alias-table hit, so two unrelated tokens
// (e.g. "GFP" then "AM" from "GFP,AM") only collide if some future KB entry
// happens to alias exactly "gfp-am" -- vanishingly unlikely, and a content
// question for spectra.json review, not a code defect.
const MAX_REJOIN_SPAN = 3;

function rejoinHyphenatedAliases(tokens, markerIndex) {
  const aliasToCanonical = markerIndex && markerIndex.aliasToCanonical;
  if (!aliasToCanonical || tokens.length < 2) return tokens;

  const result = [];
  let i = 0;
  while (i < tokens.length) {
    let joined = null;
    for (let span = Math.min(MAX_REJOIN_SPAN, tokens.length - i); span >= 2; span--) {
      const candidate = tokens.slice(i, i + span).join('-');
      if (aliasToCanonical.has(candidate.toLowerCase())) {
        joined = { candidate, span };
        break;
      }
    }
    if (joined) {
      result.push(joined.candidate);
      i += joined.span;
    } else {
      result.push(tokens[i]);
      i += 1;
    }
  }
  return result;
}

/**
 * Resolve the WHOLE markers free-text field (naming.fields.markers, the
 * one source of truth per docs/plans/planner-web-color-panel.md Decision 1)
 * into `{panelState, entries}`. `panelState` is `'unanswered'` (field is
 * empty -- the panel has nothing to check yet, never silently equivalent to
 * "0 conflicts"), `'no-markers-declared'` (the field is one of the app's own
 * "nothing here" sentinels -- 'NONE', 'N/A', 'unstained', ... -- a
 * DECLARATION, not a typo; see NO_MARKERS_SENTINELS above), or
 * `'has-entries'`.
 *
 * Deduplicates by resolved canonical, PLUS `variantKey` when the entry
 * resolved to a specific family member -- so "MitoTracker Green,
 * MitoTracker Deep Red" keeps both colors as distinct entries instead of
 * collapsing to whichever was seen first (a real defect this project
 * shipped once: two colors of the same family sharing ONE canonical, and a
 * dedupe keyed on canonical alone silently dropped the second). An
 * unrecognized token dedupes by its own text instead, since it has no
 * canonical. Keeps the FIRST-seen token spelling for display -- so typing
 * the same marker twice under different casing/spacing doesn't double-count
 * a pair.
 */
export function resolvePanel(markersFieldText, markerIndex, markersKb, fluorophores) {
  const text = typeof markersFieldText === 'string' ? markersFieldText.trim() : '';
  if (!text) return { panelState: 'unanswered', entries: [] };

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (NO_MARKERS_SENTINELS.has(normalized)) {
    return { panelState: 'no-markers-declared', entries: [] };
  }

  const tokens = rejoinHyphenatedAliases(splitMarkers(text), markerIndex);
  const seen = new Set();
  const entries = [];
  for (const token of tokens) {
    const resolved = resolveMarkerToken(token, markerIndex, markersKb, fluorophores);
    const dedupeKey = resolved.canonical
      ? resolved.canonical + (resolved.variantKey ? `::${resolved.variantKey}` : '')
      : `token:${resolved.token}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    entries.push(resolved);
  }
  return { panelState: 'has-entries', entries };
}

/**
 * The pairwise qualitative overlap check (Decision 2): every unordered pair
 * of 'known' entries, flagged on emission-peak proximity (severity 'error')
 * and independently on excitation-peak proximity (severity 'warning').
 * Returns `{field, message, severity}` records -- the same shape as
 * engine/validation.js's validationIssue, so callers reuse the existing
 * `.issues-list`/`.issue-{severity}` rendering unchanged.
 *
 * Deterministic order: SEVERITY FIRST (every 'error' -- an emission-peak
 * conflict, the one that actually invalidates the panel -- ahead of every
 * 'warning'), then ascending gap size within a severity, ties broken by the
 * pair's sorted canonical ids -- so re-rendering the same panel never
 * reorders the flags, and a reader scanning top-to-bottom sees the flags
 * that matter most first regardless of how close together their nm gaps
 * happen to be. An earlier version sorted by gap alone, which routinely put
 * a 2 nm excitation warning above a 12 nm emission error.
 */
const SEVERITY_RANK = { error: 0, warning: 1 };

export function flagPanelOverlaps(entries, overlapRules) {
  const known = entries.filter((e) => e.state === 'known');
  const rules = overlapRules || { emissionProximityNm: DEFAULT_EMISSION_PROXIMITY_NM, excitationProximityNm: DEFAULT_EXCITATION_PROXIMITY_NM };
  const flags = [];

  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      // Order the pair by a stable key (canonical, falling back to token),
      // NOT by array/loop index -- otherwise "A and B" vs "B and A" in the
      // message text would depend on the caller's iteration order, breaking
      // the determinism this function promises regardless of input order.
      const left = known[i];
      const right = known[j];
      const [a, b] =
        (left.canonical || left.token) <= (right.canonical || right.token) ? [left, right] : [right, left];
      const pairKey = [a.canonical, b.canonical].sort().join('|');

      const emissionGapNm = Math.abs(a.emissionPeakNm - b.emissionPeakNm);
      if (emissionGapNm < rules.emissionProximityNm) {
        flags.push({
          field: 'panel',
          message: `${a.token} and ${b.token}: emission peaks ${emissionGapNm} nm apart (under the ${rules.emissionProximityNm} nm proximity threshold) -- likely to co-register in each other's detection window.`,
          severity: 'error',
          gap: emissionGapNm,
          pairKey,
        });
      }

      const excitationGapNm = Math.abs(a.excitationPeakNm - b.excitationPeakNm);
      if (excitationGapNm < rules.excitationProximityNm) {
        flags.push({
          field: 'panel',
          message: `${a.token} and ${b.token}: excitation peaks ${excitationGapNm} nm apart (under the ${rules.excitationProximityNm} nm proximity threshold) -- likely both excited by a single laser line.`,
          severity: 'warning',
          gap: excitationGapNm,
          pairKey,
        });
      }
    }
  }

  flags.sort(
    (x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || x.gap - y.gap || x.pairKey.localeCompare(y.pairKey)
  );
  return flags.map(({ field, message, severity }) => ({ field, message, severity }));
}

/**
 * Derive the panel-level FACTS engine/controls.js's predicate DSL needs but
 * cannot compute itself -- the DSL only reads plain paths off the flat
 * assay view (evaluatePredicate never resolves an alias, never asks "is
 * this marker an antibody"), so anything that requires resolving markers
 * against the KB has to be pre-computed here and handed in as ordinary
 * data at `panel.derived.*`.
 *
 * This exists because of a real, verified defect: every 'panel'-kind
 * control rule used to share ONE predicate (`exists(markers) AND markers
 * != 'NONE'`), so on the app's own default study three of four assays
 * (SYTO9/PI, phalloidin/DAPI, DCF/DAPI -- none of them antibody-based) were
 * told to run an isotype control and a secondary-antibody-only control.
 * `hasAntibody` lets those two rules gate on the right fact instead of
 * firing as a block; `fluorophoreCount` lets single-stain/FMO controls gate
 * on actual panel complexity instead of "any markers at all";
 * `hasMarkersDeclared` replaces the old exact-string `!= 'NONE'` guard
 * (case-sensitive, untrimmed -- verified to let 'none', 'N/A', 'unstained',
 * 'label-free' all slip through) with the same sentinel-aware resolution
 * resolvePanel already does for the Color panel step, so the two surfaces
 * can never disagree about what counts as "no markers here."
 *
 * Returns `{fluorophoreCount, hasAntibody, hasTag, classes, hasMarkersDeclared}`.
 * `fluorophoreCount` counts every resolved, non-typo entry (known,
 * ambiguous-family, no-intrinsic-spectrum, spectrum-unavailable) -- a
 * phalloidin or a not-yet-drafted dye is still a real channel in the panel,
 * it just isn't 'known' to the spillover checker; only 'unrecognized'
 * tokens (likely typos) are excluded. TOTAL: never throws.
 */
export function derivePanelFacts(markersFieldText, markerIndex, markersKb, fluorophores) {
  const { panelState, entries } = resolvePanel(markersFieldText, markerIndex, markersKb, fluorophores);
  if (panelState !== 'has-entries') {
    return { fluorophoreCount: 0, hasAntibody: false, hasTag: false, classes: [], hasMarkersDeclared: false };
  }

  const recognized = entries.filter((e) => e.state !== 'unrecognized');
  const classes = new Set();
  for (const entry of recognized) {
    const markerEntry = entry.canonical ? kbMarker(markersKb, entry.canonical) : undefined;
    if (markerEntry && typeof markerEntry.class === 'string') classes.add(markerEntry.class);
  }

  return {
    fluorophoreCount: recognized.length,
    hasAntibody: classes.has('target'),
    hasTag: classes.has('tag'),
    classes: [...classes].sort(),
    hasMarkersDeclared: true,
  };
}
