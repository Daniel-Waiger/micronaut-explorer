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

// Color-panel patch: a qualitative default detection-filter suggestion, shown
// pre-filled in the filter inputs (ui/steps/panel.js) the moment a channel's
// fluorophore resolves, rather than an empty pair waiting on the user to look
// up their own numbers first. WIDTH_NM=30 is the midpoint of the "20-40 nm
// wide" range spectra.json's own overlapRules note already documents for
// typical bandpass emission filters -- same domain-judgment posture as that
// note and spectra.js's peak-proximity thresholds, not a claim about any real
// vendor part. Centered on the EMISSION peak: `filterCenterNm`/
// `filterBandwidthNm` describe the detection filter the user's camera/PMT
// actually looks through, which observes emitted light, not excitation.
const DEFAULT_FILTER_BANDWIDTH_NM = 30;

/**
 * The default (unedited) filter suggestion for a channel whose fluorophore
 * resolved to a known emission peak -- `null` when it didn't, so a caller
 * never renders a fabricated center wavelength for a fluorophore this app
 * has no spectral data for.
 */
export function defaultChannelFilterPair(emissionPeakNm) {
  if (typeof emissionPeakNm !== 'number' || !Number.isFinite(emissionPeakNm)) return null;
  return { filterCenterNm: Math.round(emissionPeakNm), filterBandwidthNm: DEFAULT_FILTER_BANDWIDTH_NM };
}

/**
 * The filter pair a spectrum should show for a channel. A complete saved
 * pair is an explicit microscope setting and wins; otherwise use the same
 * emission-derived suggestion displayed in the channel row. Keeping this
 * decision here prevents the form from showing a suggested filter that the
 * spectrum silently omits.
 */
export function effectiveChannelFilterPair(channel, emissionPeakNm) {
  const saved = normalizePanelFilterPair(channel || {});
  if (saved.filterCenterNm !== null) return saved;
  return defaultChannelFilterPair(emissionPeakNm);
}

/**
 * The color actually shown for a channel: the user's explicit `channel.color`
 * override when set, else `computedDefault` (engine/color.js's
 * `wavelengthToColor` over the channel's resolved emission peak), else `null`
 * when neither exists -- the UI renders `null` as a neutral placeholder
 * swatch, never a guessed color.
 */
export function effectiveChannelColor(channel, computedDefault) {
  const override = channel && typeof channel.color === 'string' ? channel.color.trim() : '';
  return override || computedDefault || null;
}

function panelFluorophoreFinitePeaks(entry) {
  return (
    entry &&
    typeof entry.excitationPeakNm === 'number' &&
    Number.isFinite(entry.excitationPeakNm) &&
    typeof entry.emissionPeakNm === 'number' &&
    Number.isFinite(entry.emissionPeakNm)
  );
}

function panelFluorophoreDisplayName(value) {
  if (!value.includes(' ')) return value === value.toLowerCase() ? value.toUpperCase() : value;
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Flatten the normalized spectra map into the complete native-select catalog.
 * A non-family contributes its canonical key; a family contributes each exact
 * variant key because selecting the bare family would be spectrally ambiguous.
 * TOTAL and immutable: malformed entries are skipped and never break the UI.
 */
export function panelFluorophoreOptions(fluorophores) {
  if (!fluorophores || typeof fluorophores !== 'object' || Array.isArray(fluorophores)) return [];
  const options = [];
  const seenValues = new Set();

  function appendOption(value, canonical, peaks, isVariant) {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    const dedupeKey = normalizedValue.toLowerCase();
    if (!normalizedValue || seenValues.has(dedupeKey) || !panelFluorophoreFinitePeaks(peaks)) return;
    seenValues.add(dedupeKey);
    options.push({
      value: normalizedValue,
      label:
        `${panelFluorophoreDisplayName(normalizedValue)} — ` +
        `Ex ${peaks.excitationPeakNm} / Em ${peaks.emissionPeakNm} nm`,
      canonical,
      excitationPeakNm: peaks.excitationPeakNm,
      emissionPeakNm: peaks.emissionPeakNm,
      isVariant,
    });
  }

  for (const [canonical, entry] of Object.entries(fluorophores)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (entry.isFamily === true) {
      const variants = entry.variants;
      if (!variants || typeof variants !== 'object' || Array.isArray(variants)) continue;
      for (const [variantKey, peaks] of Object.entries(variants)) {
        appendOption(variantKey, canonical, peaks, true);
      }
    } else {
      appendOption(canonical, canonical, entry, false);
    }
  }

  return options.sort(
    (left, right) =>
      left.label.localeCompare(right.label, 'en', { numeric: true, sensitivity: 'base' }) ||
      left.value.localeCompare(right.value)
  );
}

/** Write one picker value into the mode-appropriate field by stable channel id. */
export function panelFluorophoreWriteValue(channels, channelId, value, options = {}) {
  const savedValue = typeof value === 'string' ? value : '';
  const resetFilter = Boolean(options && options.resetFilter);
  if (!Array.isArray(channels)) return [];
  return channels.map((channel) => {
    if (!channel || channel.id !== channelId) return channel;
    const spectralField = channel.conjugation === 'tag-ligand' ? 'conjugateDye' : 'fluorophore';
    return {
      ...channel,
      [spectralField]: savedValue,
      // A library pick changes which dye the channel represents, so an old
      // bandpass suggestion must not masquerade as a setting for the new
      // dye. The UI then immediately derives the new default from emission.
      ...(resetFilter ? { filterCenterNm: null, filterBandwidthNm: null } : {}),
    };
  });
}

/** A brand-new, empty channel. `id` is caller-supplied (shortId()). */
export function emptyChannel(id) {
  return {
    id,
    target: '',
    fluorophore: '',
    conjugation: 'direct-probe',
    conjugateDye: '',
    filterCenterNm: null,
    filterBandwidthNm: null,
    // '' means "use the spectrum-derived default color" (engine/color.js) --
    // only a non-empty value is a user override, mirroring how `color` !==
    // '' is the one signal the UI needs to show a "reset to default" control.
    color: '',
  };
}

// The detection-filter BANDWIDTH rule `normalizePanelFilterPair` enforces
// below, exported so ui/steps/panel.js validates/renders against this ONE
// source instead of repeating literals (V3-N5). The lower bound is
// EXCLUSIVE: any positive width is stored (0.5 nm is accepted, 0 is not);
// the upper bound is inclusive. The normalizer reads these same fields, so
// the constant cannot drift from the producer (red-team A1-P1). A filter
// CENTER's plausible range is the 300-900 nm window engine/spectra.js
// exports as MIN/MAX_PLAUSIBLE_PEAK_NM.
export const FILTER_BANDWIDTH_BOUNDS_NM = Object.freeze({ minExclusiveNm: 0, maxNm: 300 });

// Detection filters are deliberately an all-or-nothing user statement: a
// center without a bandwidth (or vice versa) cannot honestly describe a band.
// Keep this local so the serialized channel shape has one normalization rule.
function normalizePanelFilterPair(entry) {
  const center = entry.filterCenterNm;
  const bandwidth = entry.filterBandwidthNm;
  if (
    typeof center === 'number' &&
    Number.isFinite(center) &&
    center >= 300 &&
    center <= 900 &&
    typeof bandwidth === 'number' &&
    Number.isFinite(bandwidth) &&
    bandwidth > FILTER_BANDWIDTH_BOUNDS_NM.minExclusiveNm &&
    bandwidth <= FILTER_BANDWIDTH_BOUNDS_NM.maxNm
  ) {
    return { filterCenterNm: center, filterBandwidthNm: bandwidth };
  }
  return { filterCenterNm: null, filterBandwidthNm: null };
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
      ...normalizePanelFilterPair(entry),
      color: typeof entry.color === 'string' ? entry.color : '',
    });
  }
  return channels;
}

/**
 * Return a new channel array with `sourceId` immediately before `targetId`.
 * Invalid ids and self-drops intentionally leave the ordering unchanged.
 */
export function reorderPanelChannels(channels, sourceId, targetId) {
  const ordered = Array.isArray(channels) ? channels.slice() : [];
  if (typeof sourceId !== 'string' || !sourceId || typeof targetId !== 'string' || !targetId || sourceId === targetId) {
    return ordered;
  }
  const sourceIndex = ordered.findIndex((channel) => channel && channel.id === sourceId);
  const targetIndex = ordered.findIndex((channel) => channel && channel.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return ordered;

  const [source] = ordered.splice(sourceIndex, 1);
  ordered.splice(ordered.findIndex((channel) => channel && channel.id === targetId), 0, source);
  return ordered;
}

/** Return a new array after moving one channel by an integer offset. */
export function shiftPanelChannel(channels, id, delta) {
  const ordered = Array.isArray(channels) ? channels.slice() : [];
  if (typeof id !== 'string' || !id || !Number.isInteger(delta) || delta === 0) return ordered;
  const sourceIndex = ordered.findIndex((channel) => channel && channel.id === id);
  const targetIndex = sourceIndex + delta;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return ordered;

  const [source] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, source);
  return ordered;
}

/**
 * Return channels ordered by a caller-supplied emission resolver. Finite
 * emission values come first in ascending order; unresolved values retain
 * their relative order at the end.
 */
export function sortPanelChannelsByEmission(channels, emissionForChannel) {
  const ordered = Array.isArray(channels) ? channels.slice() : [];
  if (typeof emissionForChannel !== 'function') return ordered;

  return ordered
    .map((channel, index) => {
      let emission = null;
      try {
        const candidate = emissionForChannel(channel);
        if (typeof candidate === 'number' && Number.isFinite(candidate)) emission = candidate;
      } catch {
        // A malformed resolver makes this channel unresolved, not fatal.
      }
      return { channel, index, emission };
    })
    .sort((left, right) => {
      if (left.emission === null && right.emission === null) return left.index - right.index;
      if (left.emission === null) return 1;
      if (right.emission === null) return -1;
      return left.emission - right.emission || left.index - right.index;
    })
    .map(({ channel }) => channel);
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
        ...emptyChannel(makeId()),
        fluorophore: conjugation === 'tag-ligand' ? '' : entry.token,
        conjugation,
        conjugateDye: conjugation === 'tag-ligand' ? entry.token : '',
      };
    });
}

// --- Spillover acknowledgements (V3-N1): panel.spillover.acknowledged ----
//
// A spectral-overlap flag (spectra.js's flagPanelOverlaps) that a person has
// reviewed and accepted -- e.g. two dyes with close emission peaks that are
// actually fine because they're never imaged in the same acquisition, or are
// separated by a hardware filter the tool has no way to know about. Recording
// that decision downgrades the flag from a hard export block to a visible
// warning (conformance.js/A3 wires this in); it must NOT silently make the
// overlap disappear, and it must NOT survive a panel edit that changes which
// two dyes are actually paired (pruneSpilloverAcks, below).

const SPILLOVER_ACK_REASONS = new Set(['sequential-acquisition', 'filter-separated', 'other']);

function isNonEmptySpilloverPairMember(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate and normalize a raw `panel.spillover.acknowledged` array. TOTAL:
 * never throws. A surviving entry has: `pair` (its two dye ids, SORTED so
 * ['A','B'] and ['B','A'] are the same acknowledgement regardless of which
 * order the flag or the user encountered them in), `reason` restricted to the
 * app's three enumerated choices, an optional string `notes`, and `at` (an
 * ISO timestamp -- the entry's own recorded time, or "now" when absent or the
 * wrong type). A malformed entry (wrong pair shape/types, unrecognized or
 * missing reason, or not an object at all) is dropped rather than repaired --
 * this is reviewable user-entered state, not authored KB content, matching
 * normalizeChannels' posture above.
 */
export function normalizeSpilloverAcks(raw) {
  if (!Array.isArray(raw)) return [];
  const acks = [];
  const seenPairs = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const pair = entry.pair;
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !isNonEmptySpilloverPairMember(pair[0]) ||
      !isNonEmptySpilloverPairMember(pair[1])
    ) {
      continue;
    }
    const sortedPair = [pair[0].trim(), pair[1].trim()].sort();
    // A dye cannot be acknowledged against itself, and one pair is one
    // acknowledgement (the first recorded wins).
    if (sortedPair[0] === sortedPair[1]) continue;
    const key = spilloverPairKey(sortedPair[0], sortedPair[1]);
    if (seenPairs.has(key)) continue;
    if (typeof entry.reason !== 'string' || !SPILLOVER_ACK_REASONS.has(entry.reason)) continue;

    const at = typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at))
      ? entry.at
      : new Date().toISOString();
    const ack = { pair: sortedPair, reason: entry.reason, at };
    if (typeof entry.notes === 'string') ack.notes = entry.notes;
    seenPairs.add(key);
    acks.push(ack);
  }
  return acks;
}

/**
 * The ONE pair-key convention shared by acknowledgements and
 * engine/spectra.js's flagPanelOverlaps (which builds
 * `[a.canonical, b.canonical].sort().join('|')`): sorted CANONICAL ids joined
 * by '|'. Acknowledgements are keyed on canonicals -- not on the
 * `canonical::variantKey` dedupe id resolvePanel uses -- because the flag the
 * user acknowledges is itself keyed on canonicals; keying the two differently
 * left every family dye's flag permanently unclearable (red-team A2-P1).
 */
export function spilloverPairKey(a, b) {
  return [a, b].sort().join('|');
}

/**
 * The id an acknowledgement refers to for a resolved entry: its CANONICAL
 * name only (see spilloverPairKey). `null` for anything that isn't a
 * resolved ('known') entry.
 */
function spilloverAckEntryId(entry) {
  if (!entry || typeof entry.canonical !== 'string' || !entry.canonical) return null;
  return entry.canonical;
}

/**
 * Drop any acknowledgement whose two dye ids are not BOTH still present among
 * the panel's current resolved `entries` -- editing a channel so it resolves
 * to a different dye must make the old acknowledgement stop applying rather
 * than silently keep suppressing a flag about a pair that no longer exists.
 * TOTAL: never throws; malformed input degrades to "prune everything".
 */
export function pruneSpilloverAcks(acks, entries) {
  const list = Array.isArray(acks) ? acks : [];
  const validEntries = Array.isArray(entries) ? entries : [];
  const liveIds = new Set(validEntries.map(spilloverAckEntryId).filter(Boolean));
  return list.filter(
    (ack) =>
      ack &&
      Array.isArray(ack.pair) &&
      ack.pair.length === 2 &&
      liveIds.has(ack.pair[0]) &&
      liveIds.has(ack.pair[1])
  );
}
