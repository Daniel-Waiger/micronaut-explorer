import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changesSinceExport,
  deleteExperiment,
  deserializeExperiment,
  listSaved,
  loadExperiment,
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
  experiment.naming.fields.sample = 'E02';
  experiment.provenance.slots['naming.fields.sample'] = { tag: 'user', detail: null };

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
