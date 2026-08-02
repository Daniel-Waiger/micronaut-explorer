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

const DEFAULT_REVIEW_STATUS = 'claude-drafted';
const DEFAULT_EMISSION_PROXIMITY_NM = 25;
const DEFAULT_EXCITATION_PROXIMITY_NM = 20;

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
  if (markerClass === 'tag' || markerClass === 'moiety') {
    return { token, canonical, state: 'no-intrinsic-spectrum' };
  }

  const spectraEntry = fluorophores ? fluorophores[canonical] : undefined;
  if (!spectraEntry) {
    return { token, canonical, state: 'spectrum-unavailable' };
  }

  if (spectraEntry.isFamily) {
    const variant = spectraEntry.variants[needle];
    if (!variant) {
      return { token, canonical, state: 'ambiguous-family' };
    }
    return {
      token,
      canonical,
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

/**
 * Resolve the WHOLE markers free-text field (naming.fields.markers, the
 * one source of truth per docs/plans/planner-web-color-panel.md Decision 1)
 * into `{panelState, entries}`. `panelState` is `'unanswered'` (field is
 * empty -- the panel has nothing to check yet, never silently equivalent to
 * "0 conflicts") or `'has-entries'`. Deduplicates by resolved canonical (an
 * unrecognized token dedupes by its own text instead, since it has none),
 * keeping the FIRST-seen token spelling for display -- so typing the same
 * marker twice under different casing/spacing doesn't double-count a pair.
 */
export function resolvePanel(markersFieldText, markerIndex, markersKb, fluorophores) {
  const text = typeof markersFieldText === 'string' ? markersFieldText.trim() : '';
  if (!text) return { panelState: 'unanswered', entries: [] };

  const tokens = splitMarkers(text);
  const seen = new Set();
  const entries = [];
  for (const token of tokens) {
    const resolved = resolveMarkerToken(token, markerIndex, markersKb, fluorophores);
    const dedupeKey = resolved.canonical || `token:${resolved.token}`;
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
 * Deterministic order: ascending gap size, ties broken by the pair's sorted
 * canonical ids then by severity -- so re-rendering the same panel never
 * reorders the flags.
 */
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

  flags.sort((x, y) => x.gap - y.gap || x.pairKey.localeCompare(y.pairKey) || x.severity.localeCompare(y.severity));
  return flags.map(({ field, message, severity }) => ({ field, message, severity }));
}
