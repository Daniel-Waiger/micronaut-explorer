// Pure loader/validator/indexer for the generated marker knowledge pack
// (web/kb/markers.json, produced by tools/export_markers_kb.py -- see
// docs/plans/planner-web-p1.md, "the marker KB is generated, never
// retyped"). Nothing here reads globalThis -- wiring the real
// __MICRONAUT_KB__ global into these functions is main.js's job (C1-6).
//
// Leaf module: import nothing.

/**
 * Validate and normalize a raw KB object (the parsed contents of
 * web/kb/markers.json) into { kb, issues }.
 *
 * TOTAL: never throws on a malformed KB. A missing/wrong `version` is a
 * 'fatal' issue; a marker entry missing `aliases` is an 'error' issue naming
 * the marker and that entry is dropped. `kb` is always a usable (possibly
 * empty) { version, markers, ambiguousInFreeText } object even when
 * `issues` is non-empty, so a bad KB degrades to "no markers known" rather
 * than a white screen.
 */
export function loadKb(raw) {
  const issues = [];
  const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const source = isPlainObject ? raw : {};

  if (!isPlainObject) {
    issues.push({ severity: 'fatal', message: 'knowledge pack is missing or is not an object' });
  } else if (source.version !== 1) {
    issues.push({
      severity: 'fatal',
      message: `knowledge pack version is ${JSON.stringify(source.version ?? null)}, expected 1`,
    });
  }

  const rawMarkers =
    source.markers !== null &&
    source.markers !== undefined &&
    typeof source.markers === 'object' &&
    !Array.isArray(source.markers)
      ? source.markers
      : {};

  const markers = {};
  for (const [canonical, entry] of Object.entries(rawMarkers)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({ severity: 'error', message: `marker '${canonical}' entry is not an object` });
      continue;
    }
    if (!Array.isArray(entry.aliases)) {
      issues.push({ severity: 'error', message: `marker '${canonical}' is missing 'aliases'` });
      continue;
    }
    markers[canonical] = {
      aliases: entry.aliases.filter((a) => typeof a === 'string'),
      freeTextAliases: Array.isArray(entry.freeTextAliases)
        ? entry.freeTextAliases.filter((a) => typeof a === 'string')
        : [],
      class: typeof entry.class === 'string' ? entry.class : 'dye',
      isFamily: entry.isFamily === true,
      variants: Array.isArray(entry.variants)
        ? entry.variants.filter((v) => typeof v === 'string')
        : [],
    };
  }

  const ambiguousInFreeText = Array.isArray(source.ambiguousInFreeText)
    ? source.ambiguousInFreeText.filter((a) => typeof a === 'string')
    : [];

  return {
    kb: { version: source.version ?? null, markers, ambiguousInFreeText },
    issues,
  };
}

/**
 * Build the lookup indices used by the free-text parser (C1-4) and the
 * interview engine (C1-3). Both maps use LOWERCASED keys so callers never
 * need to re-lowercase a candidate spelling before looking it up.
 *
 * `aliasToCanonical` covers every alias of every marker (exact metadata
 * value lookups, mirroring field_map.py's `_canonical_marker`).
 * `freeTextAliasToCanonical` is built ONLY from each marker's
 * `freeTextAliases` -- which the exporter has already stripped of anything
 * in `ambiguousInFreeText` -- so free-text prose scanning MUST read from
 * this map, never `aliasToCanonical`, or the whole point of
 * AMBIGUOUS_IN_FREE_TEXT is defeated.
 *
 * Never throws: an unusable/empty `kb` (e.g. one `loadKb` already flagged
 * fatal) simply indexes to empty maps.
 */
export function indexKb(kb) {
  const aliasToCanonical = new Map();
  const freeTextAliasToCanonical = new Map();
  const canonicals = [];

  const markers =
    kb !== null &&
    kb !== undefined &&
    typeof kb === 'object' &&
    kb.markers !== null &&
    kb.markers !== undefined &&
    typeof kb.markers === 'object'
      ? kb.markers
      : {};

  for (const [canonical, entry] of Object.entries(markers)) {
    canonicals.push(canonical);
    const aliases = entry && Array.isArray(entry.aliases) ? entry.aliases : [];
    for (const alias of aliases) {
      aliasToCanonical.set(String(alias).toLowerCase(), canonical);
    }
    const freeTextAliases = entry && Array.isArray(entry.freeTextAliases) ? entry.freeTextAliases : [];
    for (const alias of freeTextAliases) {
      freeTextAliasToCanonical.set(String(alias).toLowerCase(), canonical);
    }
  }

  return { aliasToCanonical, freeTextAliasToCanonical, canonicals };
}

/** Look up one canonical marker's KB entry, or undefined if unknown/malformed. */
export function kbMarker(kb, canonical) {
  const markers =
    kb !== null &&
    kb !== undefined &&
    typeof kb === 'object' &&
    kb.markers !== null &&
    kb.markers !== undefined &&
    typeof kb.markers === 'object'
      ? kb.markers
      : {};
  return markers[canonical];
}
