// Shape-validate a MIGRATED experiment root before it can become the live
// store state (core/persist.js's parseAndMigrateExperiment, the only path a
// project-backup file reaches store.replace() through).
//
// core/schema.js's migrate() only guarantees schemaVersion has been walked
// forward to SCHEMA_VERSION -- and, worse, walks nothing at all when the
// imported file's schemaVersion is ALREADY current, since the migration loop
// is `while (version < SCHEMA_VERSION)`. A hand-edited or hostile file that
// simply claims `"schemaVersion": 6` skips every migration step's own
// defensive `{...base, ...(src.field || {})}` merging (see schema.js's
// migrateV2toV3) and reaches main.js's store.replace() completely as-is.
// Every downstream engine module (predicate.js, conditions.js, plan.js,
// interview.js, validation.js) is TOTAL against a documented v6 shape with
// MISSING fields, never against a field present but of the wrong TYPE (a
// string where core/assay.js's assayView expects an object, an assay with
// no id at all) -- that is risk (a) this module exists to close.
//
// Risk (b): provenance.slots is not just descriptive metadata. provenance.js
// enforces canOverwrite in core/store.js's setValueAtPath on every WEAK/
// PROVISIONAL write (a KB default, a free-text parse, an LLM suggestion), so
// a crafted file that pre-seeds provenance.slots with a STRONG tag can
// permanently refuse those going forward. A STRONG tag on a real field the
// backup actually filled in is exactly what `imported` tags are FOR (see
// provenance.js) and is left alone. What is NOT legitimate is a STRONG tag
// addressed at an assay id this experiment does not have -- there is no
// experiment fact that entry could be recording, and if a future assay ever
// reused that id (core/ids.js's shortId has a large but non-zero collision
// space), its very first field would already read as locked. That is
// dropped. A slot whose tag is not one of provenance.js's own TAG_TIERS
// keys is worse than merely useless: tierOf()/canOverwrite() THROW on an
// unrecognized tag, so leaving one in place would crash the very next write
// to that slot rather than just refuse it. That is dropped too.
//
// Mirrors core/kb.js's loadKb() philosophy for a malformed knowledge pack:
// damage severe enough that no consumer could safely treat the result as
// this shape at all ('fatal' -- kb.js: a non-object pack or wrong version;
// here: a non-object root, or assays not a non-empty array of plain objects
// each with a real id) rejects the WHOLE file, exactly like migrate()
// throwing on a future schemaVersion already does -- core/persist.js turns
// both into the same kind of caller-visible error. Everything else (one
// malformed provenance slot, one assay whose specimen/design/... container
// is the wrong type) is 'error': the offending piece is dropped or reset to
// its emptyAssay() default and recorded in `issues`, but the rest of the
// file is still usable -- degrade loudly, never white-screen.
//
// TOTAL: never throws, for any input.

import { TAG_TIERS } from './provenance.js';
import { emptyAssay } from './assay.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The assay-scoped container roots core/assay.js's assayView reads directly
// off the assay object with no defaulting (`specimen: assay.specimen`, not
// `assay.specimen || {}`) -- a wrong-typed one here is a downstream crash,
// not a downstream default. Kept as an inline list rather than importing
// core/assay.js's own ASSAY_SCOPED_ROOTS: that set also contains 'timing',
// which IS in this list, so the two happen to already agree; naming.fields
// is handled separately below (it nests one level deeper on the assay), and
// this module intentionally does not depend on which roots scopeWrite()
// considers assay-scoped -- it only needs to know what emptyAssay() shaped.
const ASSAY_CONTAINER_KEYS = ['specimen', 'design', 'panel', 'acquisition', 'controls', 'timing'];

/**
 * Sanitize one assay entry against emptyAssay()'s skeleton. Returns the
 * sanitized assay, or null if the entry is too damaged to recover (not an
 * object, or missing a real string id) -- the caller treats that as fatal,
 * because a missing/duplicate id breaks assayIndexById, scopeWrite, and
 * activeAssayId lookups throughout the app; there is no safe default id to
 * invent that could not silently collide with, or shadow, a real assay.
 */
function sanitizeAssay(raw, issues) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;

  const base = emptyAssay(raw.id);
  const sanitized = { ...base, id: raw.id };

  for (const key of ASSAY_CONTAINER_KEYS) {
    if (isPlainObject(raw[key])) {
      sanitized[key] = { ...base[key], ...raw[key] };
    } else {
      if (raw[key] !== undefined) {
        issues.push({
          severity: 'error',
          message: `assay '${raw.id}': '${key}' was not an object -- reset to defaults`,
        });
      }
      sanitized[key] = base[key];
    }
  }

  if (isPlainObject(raw.naming)) {
    sanitized.naming = { fields: isPlainObject(raw.naming.fields) ? { ...raw.naming.fields } : {} };
    if (raw.naming.fields !== undefined && !isPlainObject(raw.naming.fields)) {
      issues.push({ severity: 'error', message: `assay '${raw.id}': 'naming.fields' was not an object -- reset to empty` });
    }
  } else {
    if (raw.naming !== undefined) {
      issues.push({ severity: 'error', message: `assay '${raw.id}': 'naming' was not an object -- reset to defaults` });
    }
    sanitized.naming = { fields: {} };
  }

  sanitized.label = typeof raw.label === 'string' ? raw.label : base.label;
  sanitized.readout = typeof raw.readout === 'string' ? raw.readout : base.readout;
  sanitized.readoutText = typeof raw.readoutText === 'string' ? raw.readoutText : base.readoutText;

  return sanitized;
}

/**
 * Sanitize provenance.unanswered / .skipped: both are documented as arrays
 * of field-path strings (core/schema.js's emptyExperiment). Non-string
 * entries are dropped rather than the whole array, matching core/kb.js's
 * loadKb (e.g. its `aliases.filter((a) => typeof a === 'string')`).
 */
function sanitizeStringArray(raw, label, issues) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ severity: 'error', message: `provenance.${label} was not an array -- discarded` });
    return [];
  }
  const clean = raw.filter((entry) => typeof entry === 'string');
  if (clean.length !== raw.length) {
    issues.push({ severity: 'error', message: `provenance.${label} contained non-string entries -- dropped` });
  }
  return clean;
}

/**
 * Sanitize provenance.slots: drop any entry that is not a plain object, any
 * entry whose tag is not one of provenance.js's own known TAG_TIERS keys
 * (an unrecognized tag would later throw out of tierOf/canOverwrite rather
 * than just misbehave), and any `assay:<id>.<path>` entry whose `<id>` does
 * not name a real, surviving assay in this experiment (see module header,
 * risk (b)) -- a bare, study-level path (no `assay:` prefix) is left alone;
 * there is no comprehensive whitelist of study-level paths available to a
 * leaf module like this one, so that half of risk (b) is a documented,
 * accepted gap rather than a silent one.
 */
function sanitizeSlots(raw, knownAssayIds, issues) {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) {
    issues.push({ severity: 'error', message: 'provenance.slots was not an object -- discarded' });
    return {};
  }
  const slots = {};
  for (const [slotKey, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      issues.push({ severity: 'error', message: `provenance slot '${slotKey}' was not an object -- dropped` });
      continue;
    }
    if (typeof entry.tag !== 'string' || !Object.prototype.hasOwnProperty.call(TAG_TIERS, entry.tag)) {
      issues.push({
        severity: 'error',
        message: `provenance slot '${slotKey}' had an unrecognized tag (${JSON.stringify(entry.tag ?? null)}) -- dropped`,
      });
      continue;
    }
    if (slotKey.startsWith('assay:')) {
      const assayId = slotKey.slice('assay:'.length).split('.', 1)[0];
      if (!knownAssayIds.has(assayId)) {
        issues.push({
          severity: 'error',
          message: `provenance slot '${slotKey}' names an assay that does not exist in this file -- dropped`,
        });
        continue;
      }
    }
    slots[slotKey] = {
      tag: entry.tag,
      detail: entry.detail ?? null,
      ...(entry.needsReview !== undefined ? { needsReview: Boolean(entry.needsReview) } : {}),
    };
  }
  return slots;
}

/**
 * Validate and sanitize a migrated experiment root. TOTAL: never throws.
 *
 * `{ experiment: null, issues }` (issues contains at least one 'fatal'
 * entry) means the whole file must be rejected -- core/persist.js's
 * parseAndMigrateExperiment turns this into the same kind of thrown error
 * migrate() already produces for an unsupported future schema version, so
 * callers (main.js's importProjectBackup) need no new error-handling path.
 *
 * `{ experiment, issues }` with only 'error'-severity issues (or none at
 * all) means `experiment` is safe to store.replace() with; any issues
 * should still be surfaced to the person importing (see main.js), since a
 * silently-sanitized field is exactly the kind of change a project owner
 * needs to notice, not a change that should vanish into the console alone.
 */
export function validateImportedExperiment(migrated) {
  const issues = [];

  if (!isPlainObject(migrated)) {
    issues.push({ severity: 'fatal', message: 'imported file is not a JSON object' });
    return { experiment: null, issues };
  }

  const rawAssays = migrated.assays;
  if (!Array.isArray(rawAssays) || rawAssays.length === 0) {
    issues.push({ severity: 'fatal', message: 'imported file has no assays' });
    return { experiment: null, issues };
  }

  const sanitizedAssays = [];
  for (const rawAssay of rawAssays) {
    const sanitized = sanitizeAssay(rawAssay, issues);
    if (!sanitized) {
      issues.push({ severity: 'fatal', message: 'an assay in the imported file is missing a valid id' });
      return { experiment: null, issues };
    }
    sanitizedAssays.push(sanitized);
  }
  const knownAssayIds = new Set(sanitizedAssays.map((assay) => assay.id));

  if (!isPlainObject(migrated.meta)) {
    // Should not be reachable in practice -- migrate() already normalizes
    // meta to a plain object with a valid origin at its own boundary (see
    // schema.js's migrate) -- but this module must not assume that a
    // caller-supplied helper elsewhere keeps that invariant forever.
    issues.push({ severity: 'fatal', message: 'imported file is missing meta' });
    return { experiment: null, issues };
  }

  const activeAssayId = knownAssayIds.has(migrated.activeAssayId) ? migrated.activeAssayId : sanitizedAssays[0].id;
  if (migrated.activeAssayId !== undefined && activeAssayId !== migrated.activeAssayId) {
    issues.push({ severity: 'error', message: 'activeAssayId did not name a real assay -- reset to the first one' });
  }

  const rawProvenance = migrated.provenance;
  if (rawProvenance !== undefined && !isPlainObject(rawProvenance)) {
    issues.push({ severity: 'error', message: 'provenance was not an object -- starting with none recorded' });
  }
  const provenanceSource = isPlainObject(rawProvenance) ? rawProvenance : {};
  const provenance = {
    slots: sanitizeSlots(provenanceSource.slots, knownAssayIds, issues),
    unanswered: sanitizeStringArray(provenanceSource.unanswered, 'unanswered', issues),
    skipped: sanitizeStringArray(provenanceSource.skipped, 'skipped', issues),
  };

  return {
    experiment: { ...migrated, assays: sanitizedAssays, activeAssayId, provenance },
    issues,
  };
}
