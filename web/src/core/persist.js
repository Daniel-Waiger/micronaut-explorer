import { uuid } from './ids.js';
import { migrate } from './schema.js';
import { validateImportedExperiment } from './importValidate.js';
import { nsKey } from './storageScope.js';

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
// Namespaced through nsKey so the practice tab (?demo=1) reads and writes a
// distinct ring, index and change counter from the user's own study --
// without this, opening the example would autosave into (and evict slots
// from) the same ring the real study relies on for recovery. RING_INDEX_KEY,
// PROTECTED_SLOTS_KEY, CHANGES_KEY and slotKey() below all derive from this
// constant, so they inherit the scoping for free.
//
// The non-collision property clearAll()'s prefix sweep depends on holds in
// both directions: 'micronaut.demo.v1.ring'.startsWith('micronaut.v1.') is
// false (the scoped key does not start with the unscoped prefix), and
// 'micronaut.v1.ring'.startsWith('micronaut.demo.v1.') is false (the
// unscoped key does not start with the scoped prefix either). So a clearAll()
// run in one scope's STORAGE_PREFIX can never delete -- or leave behind --
// the other scope's keys, in either direction.
export const STORAGE_PREFIX = nsKey(`micronaut.v${STORAGE_SCHEMA_VERSION}.`);

const RING_SIZE = 5;
const RING_INDEX_KEY = STORAGE_PREFIX + 'ring';
const PROTECTED_SLOTS_KEY = STORAGE_PREFIX + 'protectedSlots';
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
  // Privacy-mode browsers can make globalThis.localStorage THROW on access
  // (not merely return undefined), and this is a default parameter of every
  // exported function below -- it runs before any internal try/catch, so an
  // unguarded read here would escape past all of them and white-screen the
  // app at startup. Pattern mirrors core/guidedProgress.js's
  // guidedProgressBackend().
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
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

// Returns whether the key is actually gone. Callers that report success to a
// user (clearAll -> main's "Cleared all locally stored data" toast) cannot
// tell a real deletion from a suppressed failure otherwise -- removeItem can
// throw on a backend this module does not control, and a silently swallowed
// throw is how "all your data is cleared" gets said over data that is still
// there.
function removeKey(storage, key, onQuotaExceeded) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (err) {
    if (onQuotaExceeded) onQuotaExceeded(err);
    return false;
  }
}

/**
 * Save `experiment` into a fresh ring-buffer slot (a new id every call, not
 * keyed by experiment.meta.id) and evict the oldest slot(s) beyond
 * RING_SIZE. Returns the new slot id, or null if the write itself failed
 * (e.g. quota exceeded -- onQuotaExceeded still fires in that case).
 */
export function saveExperiment(experiment, {
  storage = defaultBackend(),
  onQuotaExceeded,
  protectFromAutomaticEviction = false,
} = {}) {
  const id = uuid();
  const ok = writeJSON(storage, slotKey(id), experiment, onQuotaExceeded);
  if (!ok) return null;

  const ids = readRing(storage);
  ids.push(id);
  const protectedIds = new Set(readJSON(storage, PROTECTED_SLOTS_KEY, []));
  if (protectFromAutomaticEviction) protectedIds.add(id);
  const evicted = [];
  while (ids.length > RING_SIZE) {
    const evictionIndex = ids.findIndex((candidate) => !protectedIds.has(candidate));
    // Protected snapshots are deliberately allowed to extend the recovery
    // list beyond the ordinary five-slot ring. Example activity must never
    // age out the user's study that was open before the example.
    if (evictionIndex < 0) break;
    evicted.push(ids.splice(evictionIndex, 1)[0]);
  }
  if (!writeJSON(storage, RING_INDEX_KEY, ids, onQuotaExceeded)) {
    // A slot without a ring entry is unusable, so report this save as failed
    // rather than claiming recovery succeeded. Best-effort cleanup is itself
    // total and reports any storage failure through the same callback.
    removeKey(storage, slotKey(id), onQuotaExceeded);
    return null;
  }
  if (protectFromAutomaticEviction && !writeJSON(storage, PROTECTED_SLOTS_KEY, [...protectedIds], onQuotaExceeded)) {
    // Without the protection marker this save would make a promise it cannot
    // keep. Remove it from both the slot store and ring and report failure so
    // callers can leave the user's current workspace untouched.
    removeKey(storage, slotKey(id), onQuotaExceeded);
    writeJSON(storage, RING_INDEX_KEY, ids.filter((candidate) => candidate !== id), onQuotaExceeded);
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
  const protectedIds = readJSON(storage, PROTECTED_SLOTS_KEY, [])
    .filter((existingId) => existingId !== id);
  writeJSON(storage, PROTECTED_SLOTS_KEY, protectedIds, onQuotaExceeded);
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
 *
 * Returns an explicit result -- { ok, removed, error } -- instead of
 * undefined: storage.length/storage.key(i) below are unguarded reads into a
 * backend this module does not control (a privacy-mode browser, a hostile or
 * incomplete Storage shim), and a caller that cannot tell "actually cleared"
 * from "silently did nothing" has no honest way to report success to the
 * user. `removed` lists the STORAGE_PREFIX keys this call attempted to
 * delete (empty on failure); `error` is the caught exception on failure,
 * otherwise null.
 */
export function clearAll({ storage = defaultBackend(), onQuotaExceeded } = {}) {
  if (!storage) {
    return { ok: false, removed: [], error: new Error('No storage backend is available.') };
  }
  const doomed = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith(STORAGE_PREFIX)) {
        doomed.push(key);
      }
    }
  } catch (err) {
    return { ok: false, removed: [], error: err };
  }
  // Collect first, delete second: removing while iterating by index reindexes
  // the remaining keys and silently skips every other one.
  //
  // Keep going after a failed delete rather than bailing on the first one: a
  // partial clear is still worth completing, and `removed` then reports what
  // genuinely went. `ok` is false if ANY key survived, so a caller can never
  // announce a clear that did not happen.
  const removed = [];
  const failed = [];
  for (const key of doomed) {
    if (removeKey(storage, key, onQuotaExceeded)) removed.push(key);
    else failed.push(key);
  }
  if (failed.length > 0) {
    return {
      ok: false,
      removed,
      error: new Error(`Could not remove ${failed.length} stored key(s): ${failed.join(', ')}`),
    };
  }
  return { ok: true, removed, error: null };
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
