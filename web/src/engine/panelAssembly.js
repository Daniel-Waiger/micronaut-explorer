// The structured panel assembly (Wave 2A, alpha-pilot-readiness): a
// per-channel model over the long-reserved, previously zero-consumer
// `panel.channels` (core/assay.js's emptyAssay -- `panel: { targets: [],
// channels: [] }`). `targets` stays reserved and unused; a channel already
// carries its own target as a field (see CHANNEL shape below), and splitting
// "targets" and "channels" into two separately-edited arrays that have to
// stay in sync was rejected as the same two-renderings-of-one-fact risk
// this codebase has already shipped (docs/cma-lessons.md lessons 49/50) --
// see spectra.js's own header for the same principle applied to the
// free-text panel.
//
// WHY THIS EXISTS ALONGSIDE THE FREE-TEXT MARKERS FIELD (not replacing it):
// naming.fields.markers stays the quick path AND the seed (seedChannelsFrom
// MarkersText below) -- a one-line answer is enough to get a filename and a
// first Color-panel read. But the free-text field cannot express WHY a
// marker has no intrinsic spectrum (spectra.js's 'no-intrinsic-spectrum'
// state covers tag/moiety/target alike with one sentence), and specifically
// cannot tell an antibody-conjugate channel apart from a non-antibody
// direct-conjugate probe -- see `conjugation` below, which is precisely the
// fact engine/controls.js's isotype/secondary-antibody rules need and the
// free-text path can only approximate via markers.json's `class`
// (derivePanelFacts in spectra.js). A filled-in structured channel is
// unambiguous by construction; studydoc.js prefers it over the free-text
// derivation whenever at least one channel exists.
//
// Pure module: no DOM, no store. `id` values are caller-supplied (core/ids.js's
// shortId(), matching every other array-of-entities pattern in this app --
// design.factors, assays themselves).

export const CONJUGATION_MODES = [
  'antibody-direct',
  'antibody-indirect',
  'genetically-encoded',
  'direct-probe',
  'tag-ligand',
];

export const CONJUGATION_LABELS = {
  'antibody-direct': 'Direct-conjugate antibody',
  'antibody-indirect': 'Indirect (primary + secondary antibody)',
  'genetically-encoded': 'Genetically encoded (fusion protein)',
  'direct-probe': 'Direct-binding probe (dye, peptide, lectin -- no antibody)',
  'tag-ligand': 'Self-labeling tag + dye ligand (HaloTag, SNAP, CLIP)',
};

// The two conjugation modes that mean "an antibody is actually involved" --
// the fact engine/controls.js's isotype-control / secondary-antibody-only-
// control / biological-specificity-control rules need. Exported so
// studydoc.js and any future caller share the ONE definition rather than
// re-deriving it (the exact defect class the free-text path's `hasAntibody`
// fix was written to close -- see spectra.js's derivePanelFacts header).
export const ANTIBODY_CONJUGATION_MODES = new Set(['antibody-direct', 'antibody-indirect']);

/** A brand-new, empty channel. `id` is caller-supplied (shortId()). */
export function emptyChannel(id) {
  return { id, target: '', fluorophore: '', conjugation: 'direct-probe', conjugateDye: '' };
}

/**
 * Validate and normalize a raw `panel.channels` array into a clean channel
 * list. TOTAL: never throws. A malformed entry is dropped silently rather
 * than reported via an issues list (unlike the KB loaders) -- this is
 * user-entered UI state, not authored content; a malformed entry can only
 * come from a corrupted autosave, and dropping it is strictly better than
 * rendering a broken row.
 */
export function normalizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  const channels = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    if (!id) continue;
    channels.push({
      id,
      target: typeof entry.target === 'string' ? entry.target : '',
      fluorophore: typeof entry.fluorophore === 'string' ? entry.fluorophore : '',
      conjugation: CONJUGATION_MODES.includes(entry.conjugation) ? entry.conjugation : 'direct-probe',
      conjugateDye: typeof entry.conjugateDye === 'string' ? entry.conjugateDye : '',
    });
  }
  return channels;
}

/**
 * The fluorophore-bearing field for spectral resolution: `conjugateDye` for
 * a tag-ligand channel (the tag itself has no spectrum -- see spectra.js's
 * 'no-intrinsic-spectrum' state, the same reasoning HaloTag/SNAP/CLIP
 * already get in the free-text path), `fluorophore` for every other
 * conjugation mode.
 */
export function channelSpectralField(channel) {
  if (!channel) return '';
  return channel.conjugation === 'tag-ligand' ? channel.conjugateDye : channel.fluorophore;
}

/**
 * Seed a fresh `channels` array from the free-text markers field -- the
 * one-time migration path (Decision in the Wave 2A plan note): resolves
 * `markersFieldText` via spectra.js's resolvePanel (so seeding and the
 * Color panel's own reading of the SAME text can never disagree), then maps
 * each resolved entry to a channel stub with a best-guess `conjugation`
 * from the marker's KB `class` -- 'target' -> antibody-indirect (the common
 * case for an antibody target with no stated secondary), 'tag' ->
 * tag-ligand, everything else -> direct-probe. A best guess, not a claim:
 * the UI surfaces every seeded channel for the user to correct, especially
 * conjugation, which the free-text field never stated in the first place.
 *
 * Never called automatically on render -- see ui/steps/panel.js's "Seed
 * from markers field" button. Automatic seeding on every render would
 * silently overwrite a user's in-progress structured edits the moment they
 * touched the free-text field again.
 *
 * `resolvePanel`/`kbMarker` are the caller's responsibility to have
 * available (same dependency shape as spectra.js's own resolvePanel);
 * `markerIndex`/`markersKb` are threaded through unchanged.
 */
export function seedChannelsFromMarkers(resolvePanelResult, markersKb, kbMarker, makeId) {
  const entries = resolvePanelResult && Array.isArray(resolvePanelResult.entries) ? resolvePanelResult.entries : [];
  return entries
    .filter((e) => e.state !== 'unrecognized')
    .map((entry) => {
      const markerEntry = entry.canonical ? kbMarker(markersKb, entry.canonical) : undefined;
      const markerClass = markerEntry ? markerEntry.class : undefined;
      let conjugation = 'direct-probe';
      if (markerClass === 'target') conjugation = 'antibody-indirect';
      else if (markerClass === 'tag') conjugation = 'tag-ligand';
      return {
        id: makeId(),
        target: '',
        fluorophore: conjugation === 'tag-ligand' ? '' : entry.token,
        conjugation,
        conjugateDye: conjugation === 'tag-ligand' ? entry.token : '',
      };
    });
}
