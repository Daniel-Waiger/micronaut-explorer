import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changesSinceExport,
  deleteExperiment,
  deserializeExperiment,
  listSaved,
  loadExperiment,
  loadMostRecentRecoverable,
  markChanged,
  markExported,
  saveExperiment,
  serializeExperiment,
  clearAll,
  STORAGE_PREFIX,
} from '../src/core/persist.js';
import { emptyExperiment } from '../src/core/schema.js';

function makeFakeStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    // length/key() complete the real Storage interface -- clearAll enumerates
    // keys by index rather than reconstructing them from the ring index.
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
  };
}

function makeQuotaExceededStorage() {
  const err = new Error('quota exceeded');
  err.name = 'QuotaExceededError';
  return {
    getItem() {
      return null;
    },
    setItem() {
      throw err;
    },
    removeItem() {},
  };
}

test('saveExperiment writes a slot and lists it most-recent-first', () => {
  const storage = makeFakeStorage();
  const id = saveExperiment(emptyExperiment(), { storage });
  assert.ok(id);
  assert.deepEqual(listSaved({ storage }), [id]);
});

test('the ring buffer keeps exactly 5 entries and evicts oldest-first', () => {
  const storage = makeFakeStorage();
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const experiment = emptyExperiment();
    experiment.meta.title = `run-${i}`;
    ids.push(saveExperiment(experiment, { storage }));
  }

  const saved = listSaved({ storage });
  assert.equal(saved.length, 5);
  // Most-recent-first: the last 5 ids saved, newest first.
  assert.deepEqual(saved, [ids[6], ids[5], ids[4], ids[3], ids[2]]);
  // The two oldest slots were actually evicted from storage, not just the index.
  assert.equal(loadExperiment(ids[0], { storage }), null);
  assert.equal(loadExperiment(ids[1], { storage }), null);
  assert.notEqual(loadExperiment(ids[2], { storage }), null);
});

test('a QuotaExceededError storage backend fires onQuotaExceeded and does not throw', () => {
  const storage = makeQuotaExceededStorage();
  let caught = null;
  const id = saveExperiment(emptyExperiment(), {
    storage,
    onQuotaExceeded: (err) => {
      caught = err;
    },
  });

  assert.equal(id, null);
  assert.ok(caught);
  assert.equal(caught.name, 'QuotaExceededError');
});

test('deleteExperiment removes the slot and the ring index entry', () => {
  const storage = makeFakeStorage();
  const id = saveExperiment(emptyExperiment(), { storage });
  deleteExperiment(id, { storage });

  assert.deepEqual(listSaved({ storage }), []);
  assert.equal(loadExperiment(id, { storage }), null);
});

test('serializeExperiment/deserializeExperiment round-trip to a deeply-equal object', () => {
  const experiment = emptyExperiment();
  experiment.assays[0].naming.fields.sample = 'E02';
  experiment.provenance.slots[`assay:${experiment.activeAssayId}.naming.fields.sample`] = {
    tag: 'user',
    detail: null,
  };

  const text = serializeExperiment(experiment);
  const roundTripped = deserializeExperiment(text);

  assert.deepEqual(roundTripped, experiment);
});

test('changesSinceExport increments on markChanged and resets on markExported', () => {
  const storage = makeFakeStorage();
  assert.equal(changesSinceExport({ storage }), 0);

  markChanged({ storage });
  markChanged({ storage });
  markChanged({ storage });
  assert.equal(changesSinceExport({ storage }), 3);

  markExported({ storage });
  assert.equal(changesSinceExport({ storage }), 0);
});

test('storage backend is injectable, not hard-wired to globalThis.localStorage', () => {
  // This test running at all under `node --test` (no globalThis.localStorage)
  // without throwing already proves injectability; this assertion is the
  // belt-and-suspenders check that a custom backend is actually being read.
  const storage = makeFakeStorage();
  const id = saveExperiment(emptyExperiment(), { storage });
  assert.ok(loadExperiment(id, { storage }));
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

test('clearAll removes every key this app owns', () => {
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage });
  saveExperiment(emptyExperiment(), { storage });
  markChanged({ storage });
  assert.ok(storage.length > 0);
  assert.ok(listSaved({ storage }).length > 0);

  clearAll({ storage });

  assert.equal(storage.length, 0);
  assert.deepEqual(listSaved({ storage }), []);
  assert.equal(changesSinceExport({ storage }), 0);
});

test('clearAll leaves foreign keys in the same storage untouched', () => {
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage });
  storage.setItem('someOtherApp.session', 'keep me');

  clearAll({ storage });

  assert.equal(storage.getItem('someOtherApp.session'), 'keep me');
  assert.deepEqual(listSaved({ storage }), []);
});

test('clearAll also removes an orphaned slot missing from the ring index', () => {
  // The reason clearAll sweeps by prefix instead of walking the ring index: a
  // slot orphaned by an interrupted write would survive an index-driven clear
  // and then be resurrected by the next listSaved().
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage });
  storage.setItem(STORAGE_PREFIX + 'slot.orphan', '{"schemaVersion":1}');

  clearAll({ storage });

  assert.equal(storage.getItem(STORAGE_PREFIX + 'slot.orphan'), null);
  assert.equal(storage.length, 0);
});

// --- loadMostRecentRecoverable ---------------------------------------------
// Extracted from main.js's loadInitialExperiment for the same reason
// engine/kbpack.js's shapeAppKb was extracted from main.js's loadAppKb:
// main.js calls init() at module scope, so nothing inside it can ever be
// imported by a test.

test('loadMostRecentRecoverable with nothing saved returns experiment: null and zero counts', () => {
  const storage = makeFakeStorage();
  const result = loadMostRecentRecoverable({ storage });
  assert.deepEqual(result, { experiment: null, skippedCount: 0, totalSaved: 0 });
});

test('loadMostRecentRecoverable returns the newest slot MIGRATED, when it is readable', () => {
  const storage = makeFakeStorage();
  saveExperiment({ schemaVersion: 1, meta: {}, narrative: {}, specimen: {}, design: { factors: [], replicates: 2, idScheme: '', conditions: [] }, panel: {}, acquisition: {}, controls: {}, naming: { template: 't', fields: {}, plannedNames: [] }, provenance: { slots: {}, unanswered: [], skipped: [] }, derived: {}, interview: {}, conformance: {} }, { storage });

  const { experiment, skippedCount, totalSaved } = loadMostRecentRecoverable({ storage });

  assert.equal(skippedCount, 0);
  assert.equal(totalSaved, 1);
  // Migrated all the way from v1 to the current version, not merely loaded raw.
  assert.equal(experiment.schemaVersion, 3);
  assert.equal(experiment.assays[0].design.biologicalReplicates, 2);
});

test('loadMostRecentRecoverable skips a newest slot that fails to MIGRATE and falls back to an older good one', () => {
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage }); // older, good
  saveExperiment({ schemaVersion: 999 }, { storage }); // newest, unmigrateable

  const seen = [];
  const { experiment, skippedCount, totalSaved } = loadMostRecentRecoverable({
    storage,
    onUnreadable: (id, err) => seen.push({ id, message: err.message }),
  });

  assert.equal(skippedCount, 1);
  assert.equal(totalSaved, 2);
  assert.ok(experiment, 'must have recovered the older slot');
  assert.equal(experiment.schemaVersion, 3);
  assert.equal(seen.length, 1);
  assert.match(seen[0].message, /newer than this app supports/);
});

test('loadMostRecentRecoverable returns experiment: null when EVERY slot fails to migrate', () => {
  const storage = makeFakeStorage();
  saveExperiment({ schemaVersion: 999 }, { storage });
  saveExperiment({ schemaVersion: 998 }, { storage });

  const { experiment, skippedCount, totalSaved } = loadMostRecentRecoverable({ storage });

  assert.equal(experiment, null);
  assert.equal(skippedCount, 2);
  assert.equal(totalSaved, 2);
});

test('loadMostRecentRecoverable skips an orphaned ring entry (no slot data) WITHOUT calling onUnreadable, and still recovers an older slot', () => {
  // Mirrors clearAll's own documented scenario: a slot orphaned by an
  // interrupted write survives in the ring index with no slot data behind
  // it. This is a pre-existing "raw is falsy" case (readJSON already
  // silently degrades to a fallback), NOT a migration failure, so
  // onUnreadable -- which only reports migrate() throwing -- correctly
  // does not fire for it.
  const storage = makeFakeStorage();
  const olderId = saveExperiment(emptyExperiment(), { storage });
  saveExperiment(emptyExperiment(), { storage }); // newer, then orphaned below
  const ring = JSON.parse(storage.getItem(STORAGE_PREFIX + 'ring'));
  const newerId = ring[ring.length - 1];
  storage.removeItem(STORAGE_PREFIX + 'slot.' + newerId); // orphan the newest entry

  let calls = 0;
  const { experiment, skippedCount, totalSaved } = loadMostRecentRecoverable({
    storage,
    onUnreadable: () => {
      calls += 1;
    },
  });

  assert.ok(experiment, 'must have recovered the older, non-orphaned slot');
  assert.equal(skippedCount, 1);
  assert.equal(totalSaved, 2);
  assert.equal(calls, 0);
  assert.notEqual(olderId, newerId);
});

test('loadMostRecentRecoverable works with no onUnreadable callback at all', () => {
  const storage = makeFakeStorage();
  saveExperiment({ schemaVersion: 999 }, { storage });
  assert.doesNotThrow(() => loadMostRecentRecoverable({ storage }));
});
