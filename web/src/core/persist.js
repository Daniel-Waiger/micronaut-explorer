import { uuid } from './ids.js';
import { migrate } from './schema.js';
import { validateImportedExperiment } from './importValidate.js';

// localStorage is a CONVENIENCE, never the record of truth: two users on a
// shared-scope PC share one storage bucket under file://, IT can clear
// browsing data, incognito loses everything, and QuotaExceededError can
// fire at any write. Every write below is wrapped in try/catch and a quota
// failure is surfaced LOUDLY through onQuotaExceeded -- never swallowed.
//
// The storage backend is injectable (default globalThis.localStorage)
// because it does not exist at all under `node --test`; tests supply an
// in-memory fake, and a fake that throws QuotaExceededError.

export const STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_PREFIX = `micronaut.v${STORAGE_SCHEMA_VERSION}.`;

const RING_SIZE = 5;
const RING_INDEX_KEY = STORAGE_PREFIX + 'ring';
const CHANGES_KEY = STORAGE_PREFIX + 'changesSinceExport';

function slotKey(id) {
  return STORAGE_PREFIX + 'slot.' + id;
}

function readRing(storage) {
  const ids = readJSON(storage, RING_INDEX_KEY, []);
  // Corrupt or hand-edited storage must not turn routine saving/recovery
  // into a TypeError. Unknown values are treated as an empty recoverable
  // history, while valid id strings retain their existing order.
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}

function defaultBackend() {
  return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
}

function readJSON(storage, key, fallback) {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    // A read failure (corrupt JSON, backend unavailable) falls back to the
    // caller's default rather than throwing -- reads are not the risky
    // side of this module, writes are, so only writes report quota errors.
    return fallback;
  }
}

function writeJSON(storage, key, value, onQuotaExceeded) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (onQuotaExceeded) onQuotaExceeded(err);
    return false;
  }
}

function removeKey(storage, key, onQuotaExceeded) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (err) {
    if (onQuotaExceeded) onQuotaExceeded(err);
  }
}

/**
 * Save `experiment` into a fresh ring-buffer slot (a new id every call, not
 * keyed by experiment.meta.id) and evict the oldest slot(s) beyond
 * RING_SIZE. Returns the new slot id, or null if the write itself failed
 * (e.g. quota exceeded -- onQuotaExceeded still fires in that case).
 */
export function saveExperiment(experiment, { storage = defaultBackend(), onQuotaExceeded } = {}) {
  const id = uuid();
  const ok = writeJSON(storage, slotKey(id), experiment, onQuotaExceeded);
  if (!ok) return null;

  const ids = readRing(storage);
  ids.push(id);
  const evicted = [];
  while (ids.length > RING_SIZE) {
    evicted.push(ids.shift());
  }
  if (!writeJSON(storage, RING_INDEX_KEY, ids, onQuotaExceeded)) {
    // A slot without a ring entry is unusable, so report this save as failed
    // rather than claiming recovery succeeded. Best-effort cleanup is itself
    // total and reports any storage failure through the same callback.
    removeKey(storage, slotKey(id), onQuotaExceeded);
    return null;
  }
  for (const oldId of evicted) removeKey(storage, slotKey(oldId), onQuotaExceeded);
  return id;
}

/** Most-recently-saved id first. */
export function listSaved({ storage = defaultBackend() } = {}) {
  return readRing(storage).reverse();
}

export function loadExperiment(id, { storage = defaultBackend() } = {}) {
  return readJSON(storage, slotKey(id), null);
}

/**
 * Load one user-selected recovery slot as a migrated experiment. Unlike the
 * boot-time scanner, a selected slot is not allowed to silently fall through
 * to a different snapshot: callers receive its recoverable experiment or a
 * concrete error and can keep the current in-memory study intact.
 */
export function loadRecoverableSlot(id, { storage = defaultBackend(), onUnreadable } = {}) {
  const raw = typeof id === 'string' && id ? loadExperiment(id, { storage }) : null;
  if (raw === null) {
    return { id, experiment: null, error: new Error('That saved version is no longer available.') };
  }
  try {
    return { id, experiment: migrate(raw), error: null };
  } catch (err) {
    if (onUnreadable) onUnreadable(id, err);
    return { id, experiment: null, error: err };
  }
}

/**
 * Load the most recent RECOVERABLE saved experiment, walking the ring
 * newest to oldest rather than giving up after the newest slot. Without
 * this, a single unmigrateable slot (corrupt JSON, or a bug in a
 * migration) silently discards the WHOLE session -- every other, possibly
 * perfectly good, ring slot along with it. A schema-version bump (like the
 * v2->v3 assay tier) is exactly the kind of change this protects against:
 * a bug in a fresh migration would previously have looked identical to "no
 * autosave ever existed."
 *
 * Extracted here rather than living inline in main.js's loadInitialExperiment
 * for the same reason engine/kbpack.js's shapeAppKb was extracted from
 * main.js's loadAppKb: main.js calls init() at module scope, so nothing
 * inside it can ever be imported by a test. This function's only dependency
 * on schema.js is migrate() itself -- it deliberately does NOT know what an
 * empty experiment looks like, so `experiment: null` (never
 * emptyExperiment()) signals "nothing recoverable" and leaves the fallback
 * decision to the caller.
 *
 * Returns { experiment, skippedCount, totalSaved }: `skippedCount` and
 * `totalSaved` let a caller distinguish "recovered using an older save"
 * from "every save was unreadable" -- materially different, and more
 * worrying, messages.
 */
export function loadMostRecentRecoverable({ storage = defaultBackend(), onUnreadable } = {}) {
  const saved = listSaved({ storage });
  let skippedCount = 0;
  for (const id of saved) {
    const raw = loadExperiment(id, { storage });
    if (!raw) {
      skippedCount += 1;
      continue;
    }
    try {
      return { experiment: migrate(raw), skippedCount, totalSaved: saved.length };
    } catch (err) {
      if (onUnreadable) onUnreadable(id, err);
      skippedCount += 1;
    }
  }
  return { experiment: null, skippedCount, totalSaved: saved.length };
}

export function deleteExperiment(id, { storage = defaultBackend(), onQuotaExceeded } = {}) {
  removeKey(storage, slotKey(id), onQuotaExceeded);
  const ids = readRing(storage).filter((existingId) => existingId !== id);
  writeJSON(storage, RING_INDEX_KEY, ids, onQuotaExceeded);
}

/**
 * Delete EVERY key this app owns -- all ring slots, the ring index, and the
 * change counter -- so the next load genuinely starts from emptyExperiment().
 *
 * Keys are matched by STORAGE_PREFIX rather than reconstructed from the ring
 * index, because a slot orphaned by an earlier interrupted write would survive
 * an index-driven sweep and then be picked up by the next listSaved() -- a
 * "start over" that silently restores the old experiment is worse than none.
 * Foreign keys sharing the same storage are left untouched.
 */
export function clearAll({ storage = defaultBackend(), onQuotaExceeded } = {}) {
  if (!storage) return;
  const doomed = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (typeof key === 'string' && key.startsWith(STORAGE_PREFIX)) {
      doomed.push(key);
    }
  }
  // Collect first, delete second: removing while iterating by index reindexes
  // the remaining keys and silently skips every other one.
  for (const key of doomed) {
    removeKey(storage, key, onQuotaExceeded);
  }
}

export function markChanged({ storage = defaultBackend(), onQuotaExceeded } = {}) {
  const current = readJSON(storage, CHANGES_KEY, 0);
  writeJSON(storage, CHANGES_KEY, current + 1, onQuotaExceeded);
}

export function markExported({ storage = defaultBackend(), onQuotaExceeded } = {}) {
  writeJSON(storage, CHANGES_KEY, 0, onQuotaExceeded);
}

export function changesSinceExport({ storage = defaultBackend() } = {}) {
  return readJSON(storage, CHANGES_KEY, 0);
}

// Serialization is split out from the DOM-triggering mechanics below so the
// actual round-trip logic is testable under plain `node --test` (no Blob,
// document, or FileReader available there).
export function serializeExperiment(experiment) {
  return JSON.stringify(experiment, null, 2);
}

export function deserializeExperiment(text) {
  return JSON.parse(text);
}

/**
 * Parse a portable project backup, migrate it to the current schema, and
 * shape-validate the result (core/importValidate.js) before it is allowed
 * anywhere near store.replace(). This function deliberately has no storage
 * side effects: main owns the replace/autosave lifecycle, so an invalid or
 * future-schema import cannot partially overwrite either the current study
 * or the recovery ring.
 *
 * Returns `{ experiment, issues }` -- `issues` is normally empty, but can
 * list non-fatal shape problems that were sanitized rather than rejected
 * (a malformed provenance slot, an assay container reset to defaults);
 * callers should surface a non-empty `issues` to the person importing
 * (main.js's importProjectBackup does), not merely proceed silently.
 *
 * Throws (same as migrate() already does for an unsupported future
 * schemaVersion, and JSON.parse already does for invalid JSON) when the
 * file is damaged badly enough that validateImportedExperiment rejects it
 * outright -- callers that already catch those two cases need no new
 * error-handling path for this one.
 */
export function parseAndMigrateExperiment(text) {
  const migrated = migrate(deserializeExperiment(text));
  const { experiment, issues } = validateImportedExperiment(migrated);
  if (!experiment) {
    const fatal = issues.find((issue) => issue.severity === 'fatal');
    throw new Error(fatal ? fatal.message : 'That file is not a valid project backup.');
  }
  return { experiment, issues };
}

/**
 * Trigger a real `<a download>` click for arbitrary `text`. Works under
 * file:// (no fetch, no server, no permission prompt) -- the general form
 * exportToFile below already relied on; extracted so ui/steps/overview.js's
 * Markdown export can reuse the same DOM mechanics rather than a second,
 * independently-written copy of them.
 */
export function downloadTextFile(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a real `<a download>` click for `experiment` as a .micronaut.json
 * file. Works under file:// (no fetch, no server, no permission prompt).
 */
export function exportToFile(experiment, filename = 'experiment.micronaut.json') {
  downloadTextFile(serializeExperiment(experiment), filename, 'application/json');
}

/** Read a File (e.g. from a file input) as JSON via FileReader. */
export function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseAndMigrateExperiment(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
