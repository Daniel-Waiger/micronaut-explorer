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

export function sanitizeToken(value, config) {
  const pattern = new RegExp(config.safeCharPattern, 'g');
  const cleaned = String(value).trim().replaceAll(' ', '_').replace(pattern, '');
  return cleaned || 'UNSPECIFIED';
}

export function normalizeFields(fields, config) {
  const normalized = {};
  for (const [key, value] of Object.entries(fields)) {
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
  const merged = { ...config.defaults, ...extracted };
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
