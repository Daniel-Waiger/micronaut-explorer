import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changesSinceExport,
  deleteExperiment,
  deserializeExperiment,
  parseAndMigrateExperiment,
  listSaved,
  loadExperiment,
  loadMostRecentRecoverable,
  loadRecoverableSlot,
  markChanged,
  markExported,
  saveExperiment,
  serializeExperiment,
  clearAll,
  STORAGE_PREFIX,
} from '../src/core/persist.js';
import { SCHEMA_VERSION, emptyExperiment } from '../src/core/schema.js';

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

test('a user snapshot protected before opening demo data is never evicted by demo saves', () => {
  const storage = makeFakeStorage();
  const userStudy = emptyExperiment();
  userStudy.meta.title = 'My irreplaceable study';
  const userId = saveExperiment(userStudy, { storage, protectFromAutomaticEviction: true });

  for (let i = 0; i < 20; i += 1) {
    const demo = emptyExperiment();
    demo.meta.title = `demo-edit-${i}`;
    saveExperiment(demo, { storage });
  }

  assert.ok(listSaved({ storage }).includes(userId));
  assert.equal(loadExperiment(userId, { storage }).meta.title, 'My irreplaceable study');
  assert.equal(listSaved({ storage }).length, 5);
});

test('only an explicit delete removes a protected pre-demo snapshot', () => {
  const storage = makeFakeStorage();
  const id = saveExperiment(emptyExperiment(), { storage, protectFromAutomaticEviction: true });

  deleteExperiment(id, { storage });

  assert.equal(loadExperiment(id, { storage }), null);
  assert.deepEqual(listSaved({ storage }), []);
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

test('parseAndMigrateExperiment accepts current and older project backups without storage side effects', () => {
  const current = emptyExperiment();
  current.meta.title = 'Current backup';
  const { experiment: migratedCurrent, issues: currentIssues } = parseAndMigrateExperiment(serializeExperiment(current));
  assert.deepEqual(migratedCurrent, current);
  assert.deepEqual(currentIssues, []);

  const v1 = {
    schemaVersion: 1, meta: {}, narrative: {}, specimen: {},
    design: { factors: [], replicates: 2, idScheme: '', conditions: [] },
    panel: {}, acquisition: {}, controls: {},
    naming: { template: 't', fields: {}, plannedNames: [] },
    provenance: { slots: {}, unanswered: [], skipped: [] }, derived: {}, interview: {}, conformance: {},
  };
  const { experiment: migratedV1, issues: v1Issues } = parseAndMigrateExperiment(JSON.stringify(v1));
  assert.equal(migratedV1.schemaVersion, SCHEMA_VERSION);
  assert.equal(migratedV1.assays[0].design.biologicalReplicates, 2);
  assert.deepEqual(v1Issues, []);
});

test('parseAndMigrateExperiment rejects invalid JSON and unsupported future schemas', () => {
  assert.throws(() => parseAndMigrateExperiment('{not JSON'), SyntaxError);
  assert.throws(
    () => parseAndMigrateExperiment(JSON.stringify({ schemaVersion: 999 })),
    /newer than this app supports/
  );
});

// --- shape validation (core/importValidate.js), wired in via
// parseAndMigrateExperiment ------------------------------------------------
// These specifically target files whose schemaVersion is ALREADY current --
// migrate()'s `while (version < SCHEMA_VERSION)` loop runs zero migration
// steps for those, so none of migrateV2toV3/etc.'s own defensive
// `{...base, ...(src.field || {})}` merging ever runs on them.

test('parseAndMigrateExperiment rejects a current-schema file whose assays is not an array', () => {
  const bad = { ...emptyExperiment(), assays: 'not-an-array' };
  assert.throws(
    () => parseAndMigrateExperiment(JSON.stringify(bad)),
    /no assays/
  );
});

test('parseAndMigrateExperiment rejects a current-schema file whose assay has no id', () => {
  const bad = emptyExperiment();
  bad.assays = [{ ...bad.assays[0], id: undefined }];
  assert.throws(
    () => parseAndMigrateExperiment(JSON.stringify(bad)),
    /missing a valid id/
  );
});

test('parseAndMigrateExperiment sanitizes (does not reject) an assay whose container fields are the wrong type, resetting them to defaults', () => {
  const source = emptyExperiment();
  const assayId = source.activeAssayId;
  source.assays = [{ ...source.assays[0], specimen: 'not-an-object', design: ['also', 'wrong'] }];
  const { experiment, issues } = parseAndMigrateExperiment(JSON.stringify(source));

  assert.deepEqual(experiment.assays[0].specimen, { organism: '', sampleType: '', preparation: '', notes: '' });
  assert.deepEqual(experiment.assays[0].design.groups, { levels: [] });
  assert.equal(experiment.assays[0].id, assayId);
  assert.ok(issues.length >= 2);
  assert.ok(issues.every((issue) => issue.severity === 'error'));
});

test('parseAndMigrateExperiment drops a malformed provenance slot entry rather than rejecting the whole file', () => {
  const source = emptyExperiment();
  const assayId = source.activeAssayId;
  const goodKey = `assay:${assayId}.naming.fields.sample`;
  source.assays[0].naming.fields.sample = 'E02';
  source.provenance.slots = {
    [goodKey]: { tag: 'user', detail: null },
    'not-an-object': 'boom',
    'unrecognized-tag': { tag: 'totally-made-up-tag', detail: null },
  };
  const { experiment, issues } = parseAndMigrateExperiment(JSON.stringify(source));

  assert.deepEqual(Object.keys(experiment.provenance.slots), [goodKey]);
  assert.equal(experiment.provenance.slots[goodKey].tag, 'user');
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.severity === 'error'));
});

test('parseAndMigrateExperiment drops a STRONG-tag flood of provenance slots addressed at assay ids that do not exist in the file', () => {
  const source = emptyExperiment();
  const realAssayId = source.activeAssayId;
  const realKey = `assay:${realAssayId}.design.groups`;
  source.provenance.slots = { [realKey]: { tag: 'user', detail: null } };
  // Flood: a hundred STRONG tags on assay ids this file does not have.
  for (let i = 0; i < 100; i += 1) {
    source.provenance.slots[`assay:fake-${i}.acquisition.modality`] = { tag: 'imported', detail: null };
  }
  const { experiment, issues } = parseAndMigrateExperiment(JSON.stringify(source));

  assert.deepEqual(Object.keys(experiment.provenance.slots), [realKey]);
  assert.equal(issues.length, 100);
  assert.ok(issues.every((issue) => /does not exist/.test(issue.message)));
});

test('parseAndMigrateExperiment resets an activeAssayId that does not name a real assay', () => {
  const source = emptyExperiment();
  source.activeAssayId = 'nonexistent-assay-id';
  const { experiment, issues } = parseAndMigrateExperiment(JSON.stringify(source));

  assert.equal(experiment.activeAssayId, experiment.assays[0].id);
  assert.ok(issues.some((issue) => /activeAssayId/.test(issue.message)));
});

test('parseAndMigrateExperiment rejects a non-object root even when it happens to look current-versioned', () => {
  // A bare JSON scalar can never carry a numeric schemaVersion property, so
  // migrate() already throws its own "no migration path" error for these --
  // this asserts the caller-visible behavior (a thrown, catchable error),
  // not which of the two layers happened to be the one that caught it.
  assert.throws(() => parseAndMigrateExperiment('"just a string"'));
  assert.throws(() => parseAndMigrateExperiment('42'));
  assert.throws(() => parseAndMigrateExperiment('null'));
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
  assert.equal(experiment.schemaVersion, SCHEMA_VERSION);
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
  assert.equal(experiment.schemaVersion, SCHEMA_VERSION);
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

test('loadRecoverableSlot loads a user-selected older slot and migrates it', () => {
  const storage = makeFakeStorage();
  const olderId = saveExperiment({
    schemaVersion: 1, meta: {}, narrative: {}, specimen: {},
    design: { factors: [], replicates: 3, idScheme: '', conditions: [] },
    panel: {}, acquisition: {}, controls: {},
    naming: { template: 't', fields: {}, plannedNames: [] },
    provenance: { slots: {}, unanswered: [], skipped: [] }, derived: {}, interview: {}, conformance: {},
  }, { storage });
  saveExperiment(emptyExperiment(), { storage });

  const result = loadRecoverableSlot(olderId, { storage });

  assert.equal(result.id, olderId);
  assert.equal(result.error, null);
  assert.equal(result.experiment.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.experiment.assays[0].design.biologicalReplicates, 3);
});

test('loadRecoverableSlot reports missing or unmigrateable selections without throwing', () => {
  const storage = makeFakeStorage();
  const missing = loadRecoverableSlot('gone', { storage });
  assert.equal(missing.experiment, null);
  assert.match(missing.error.message, /no longer available/);

  const badId = saveExperiment({ schemaVersion: 999 }, { storage });
  let reported = null;
  const unreadable = loadRecoverableSlot(badId, {
    storage,
    onUnreadable: (id, error) => { reported = { id, error }; },
  });
  assert.equal(unreadable.experiment, null);
  assert.match(unreadable.error.message, /newer than this app supports/);
  assert.equal(reported.id, badId);
});
