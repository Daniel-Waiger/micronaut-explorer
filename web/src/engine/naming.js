// Filename construction: token sanitization, reserved-stem repair,
// extension handling, and template rendering. Faithful port of
// src/microscopy_naming_assistant/naming.py — behaviour must stay
// identical; only the snake_case -> camelCase names changed.
//
// Leaf module: import nothing.

// Windows reserves these device names as a filename STEM (i.e. the base
// name before the extension) case-insensitively -- "CON", "con", and
// "CON.tif" are all unusable on a real Windows filesystem, even though
// "CONSOLE" is fine.
export const RESERVED_WINDOWS_STEMS = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

// Appended to a stem that collides with a reserved Windows device name so
// the resulting filename is always creatable, while staying recognizably
// close to what the template originally produced.
const RESERVED_STEM_REPAIR_SUFFIX = '_FILE';

const COMPOUND_EXTENSIONS = ['.ome.tif', '.ome.tiff'];

/**
 * True if `stem` is a reserved Windows device name, case-insensitively.
 *
 * This checks the WHOLE stem (no extension), matching Windows' own rule:
 * "CON" and "con" are reserved, but "CONSOLE" and "ICON" are not.
 */
export function isReservedWindowsStem(stem) {
  return RESERVED_WINDOWS_STEMS.has(String(stem).trim().toUpperCase());
}

/**
 * Return a filesystem-safe variant of `stem` if it is a reserved Windows
 * device name, otherwise return it unchanged.
 */
export function repairReservedStem(stem) {
  if (isReservedWindowsStem(stem)) {
    return `${stem}${RESERVED_STEM_REPAIR_SUFFIX}`;
  }
  return stem;
}

// Trim + space->underscore normalization shared by sanitizeToken and
// sanitizationLossIssue below, so the two never disagree about what counts
// as "the value before unsafe characters are stripped".
function preClean(value) {
  return String(value).trim().replaceAll(' ', '_');
}

export function sanitizeToken(value, config) {
  const pattern = new RegExp(config.safeCharPattern, 'g');
  const cleaned = preClean(value).replace(pattern, '');
  return cleaned || 'UNSPECIFIED';
}

/**
 * Build a {field, message, severity} issue describing information LOST when
 * `original` was sanitized down for use in a filename, or null if nothing
 * REAL was lost.
 *
 * Only a letter or digit from ANY script (Unicode categories L/N) counts as
 * real loss. Plain ASCII punctuation and separators -- '(', ')', ',', '/',
 * '#', '.', a space (already folded to '_' by preClean) -- are exactly what
 * config.safeCharPattern is FOR stripping, including the app's own supported
 * marker separator (','): a value like 'GFP,DAPI' or 'Zeiss LSM 880
 * (Airyscan)' must never raise a "lost character" warning, because nothing
 * a person would call information actually disappeared.
 *
 * Two shapes when a real (letter/digit) loss is found, both against
 * config.safeCharPattern (ASCII-only by default -- see namingConfig.js):
 *  - TOTAL loss (severity 'error'): every character `original` contains gets
 *    stripped, so sanitizeToken's 'UNSPECIFIED' fallback is what actually
 *    appears in the filename. The value is not merely reformatted, it is
 *    invisible -- e.g. a group level typed entirely in a non-Latin script.
 *  - PARTIAL loss (severity 'warning'): some, but not all, characters are
 *    stripped -- e.g. an accented letter or a Greek symbol mixed into an
 *    otherwise-Latin label. The filename still carries information, just
 *    less than the researcher typed, so this warns rather than errors and
 *    names exactly which characters did not survive. The quoted filename
 *    segment is the FINAL token (after this field's own uppercasing, if
 *    any) -- the same string that actually appears in the rendered name --
 *    never the pre-uppercase intermediate.
 *
 * A value that is empty (or all whitespace) to begin with returns null: there
 * is nothing to have LOST there, and an unanswered required field is already
 * a separate, existing concern (engine/conformance.js's
 * defaultPlaceholderIssues).
 */
function sanitizationLossIssue(field, value, config) {
  const shown = String(value).trim();
  if (!shown) return null;
  const source = preClean(value);
  const pattern = new RegExp(config.safeCharPattern, 'g');
  const droppedRuns = source.match(pattern) || [];
  if (droppedRuns.length === 0) return null; // every character survived
  let cleaned = source.replace(pattern, '');
  if (config.uppercaseFields && config.uppercaseFields.includes(field)) {
    cleaned = cleaned.toUpperCase();
  }
  const droppedChars = [...new Set(droppedRuns.join(''))].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  // TOTAL loss is always reported, whatever was dropped: an emoji-only or
  // punctuation-only name still becomes the UNSPECIFIED placeholder in every
  // filename (red-team E1r2 #1). The letters/digits filter below gates only
  // the PARTIAL-loss warning, where stripped punctuation/separators (the
  // marker comma, slashes, parentheses) are expected and must stay silent.
  if (!cleaned) {
    return {
      field,
      severity: 'error',
      message:
        `${label} '${shown}' has no characters that can be used in a filename -- ` +
        `add a Latin label (letters, digits, - or _).`,
    };
  }
  if (droppedChars.length === 0) return null; // only punctuation/separators were stripped
  return {
    field,
    severity: 'warning',
    message:
      `${label} '${shown}' lost the character${droppedChars.length > 1 ? 's' : ''} ` +
      `${droppedChars.join(', ')} when turned into the filename segment '${cleaned}' -- ` +
      `consider using a Latin label instead.`,
  };
}

// Shared by finalizeFields and sanitizationLossIssues below, so the two can
// never disagree about what a field's pre-sanitization value actually is.
function mergeWithDefaults(extracted, config) {
  const merged = { ...config.defaults, ...extracted };
  // Optional fields get NO default: config.defaults may still list one (so a
  // caller can opt a field back into being required by dropping it from
  // optionalFields), but an optional field the caller did not supply must
  // stay absent rather than inheriting a placeholder.
  for (const key of config.optionalFields || []) {
    const supplied = extracted && extracted[key];
    if (supplied === undefined || supplied === null || supplied === '') {
      merged[key] = '';
    }
  }
  return merged;
}

/**
 * Pure, standalone: the sanitization-loss issues finalizeFields(sourceName,
 * extracted, config) would produce for the SAME `extracted` fields, without
 * needing a finalized/rendered name in hand.
 *
 * This is deliberately a separate export rather than a hidden property on
 * finalizeFields' return value (an earlier version attached one via
 * Object.defineProperty, non-enumerable) -- that channel silently vanished
 * through structuredClone/JSON/spread/Object.assign, since none of those
 * copy non-enumerable properties, and a second attach on the same object
 * threw (Object.defineProperty cannot redefine a non-configurable
 * property). A plain pure function callers invoke explicitly alongside
 * finalizeFields has none of those failure modes and needs no change to any
 * of finalizeFields' many existing callers, which keep receiving exactly
 * the plain fields object they always have.
 *
 * Callers: engine/plan.js's planFilenames attaches this to each planned
 * row's `issues` (design.js renders them; conformance.js folds them into
 * the study report) -- see docs/plans/app-review-remediation-task-graph.json
 * task E1 and docs/plans/app-review-2026-09-11.md finding V4-N1.
 */
// Exported alongside sanitizationLossIssues (which merges in config.defaults
// first, for a whole "raw fields" object): engine/plan.js needs this
// single-field version directly for a design's group/factor levels, which
// arrive one axis at a time (row.group, each row.factorLevels entry) and
// must NOT be merged with config.defaults (they are not template fields
// with their own defaults/placeholders at all).
export { sanitizationLossIssue };

export function sanitizationLossIssues(extracted, config) {
  const merged = mergeWithDefaults(extracted, config);
  const issues = [];
  for (const [key, value] of Object.entries(merged)) {
    const issue = sanitizationLossIssue(key, String(value), config);
    if (issue) issues.push(issue);
  }
  return issues;
}

export function normalizeFields(fields, config) {
  const optional = config.optionalFields || [];
  const normalized = {};
  for (const [key, value] of Object.entries(fields)) {
    // An OPTIONAL field that carries no value renders as the empty string
    // rather than sanitizeToken's 'UNSPECIFIED' fallback. renderName's
    // existing `_{2,}` -> `_` collapse then removes the orphaned separator,
    // so the token disappears from the name entirely instead of padding it
    // with a placeholder for an axis this experiment simply does not use.
    if (optional.includes(key) && (value === undefined || value === null || value === '')) {
      normalized[key] = '';
      continue;
    }
    let token = sanitizeToken(String(value), config);
    if (config.uppercaseFields.includes(key)) {
      token = token.toUpperCase();
    }
    normalized[key] = token;
  }
  return normalized;
}

function basename(name) {
  const str = String(name);
  const idx = Math.max(str.lastIndexOf('/'), str.lastIndexOf('\\'));
  return idx >= 0 ? str.slice(idx + 1) : str;
}

/**
 * Compute the extension to use for `name`, preserving known compound
 * extensions.
 *
 * A naive last-dot split would collapse "foo.ome.tif" to ".tif", silently
 * dropping the ".ome" infix that marks the file as an OME-TIFF. Detect that
 * case (and its ".ome.tiff" sibling) explicitly and keep the compound,
 * lowercased. Everything else keeps the existing single-suffix behavior,
 * defaulting to ".tif" when there is no extension at all.
 */
export function compoundExt(name) {
  const base = basename(name);
  const lower = base.toLowerCase();
  for (const compound of COMPOUND_EXTENSIONS) {
    if (lower.endsWith(compound)) return compound;
  }

  // Mirrors pathlib's Path.suffix: a leading dot with nothing before it
  // (e.g. ".hidden") is NOT treated as an extension.
  const dotIndex = base.lastIndexOf('.');
  const ext = dotIndex > 0 ? base.slice(dotIndex).toLowerCase() : '';
  if (!ext) return '.tif';
  return ext.startsWith('.') ? ext : `.${ext}`;
}

/**
 * Merge defaults with extracted fields, attach the extension, and
 * normalize.
 *
 * This is the single source of truth for the final field dict used both
 * for validation and for rendering the filename.
 */
export function finalizeFields(sourceName, extracted, config) {
  const merged = mergeWithDefaults(extracted, config);
  const ext = compoundExt(sourceName);

  const normalized = normalizeFields(merged, config);
  normalized.ext = ext;
  return normalized;
}

function formatTemplate(template, fields) {
  return template.replace(/\{([^{}]+)\}/g, (match, key) => {
    if (!(key in fields)) {
      throw new Error(`Missing template field: ${key}`);
    }
    return String(fields[key]);
  });
}

/** Format an already-finalized field dict into a filename. */
export function renderName(fields, config) {
  let rawName = formatTemplate(config.template, fields);

  // Collapse duplicate separators and strip separator around extension.
  rawName = rawName.replace(/_{2,}/g, '_');
  rawName = rawName.replaceAll('_.', '.');
  // An omitted OPTIONAL field at the very START of the template leaves a
  // leading separator, which the collapse above cannot see (there is only one
  // of it). Harmless today -- {date} leads and is required -- but a filename
  // must never begin with '_' if the template is ever reordered.
  rawName = rawName.replace(/^_+/, '');

  // Reject/repair Windows reserved device names as the filename STEM --
  // "CON.tif" is unusable on Windows exactly like bare "CON" is. Split off
  // the extension using fields.ext (not a naive suffix split, which would
  // collapse a compound extension like ".ome.tif" to ".tif") so the check
  // covers the true stem regardless of extension shape.
  let ext = fields.ext !== undefined && fields.ext !== null ? String(fields.ext) : '';
  let stemPart;
  if (ext && rawName.toLowerCase().endsWith(ext.toLowerCase())) {
    stemPart = rawName.slice(0, rawName.length - ext.length);
  } else {
    stemPart = rawName;
    ext = '';
  }
  const repairedStem = repairReservedStem(stemPart);
  if (repairedStem !== stemPart) {
    rawName = `${repairedStem}${ext}`;
  }
  return rawName;
}
