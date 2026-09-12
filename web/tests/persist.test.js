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

// A backend that throws on every single member a real (locked-down, or
// otherwise hostile) Storage implementation might refuse: reads, writes, AND
// the length/key() enumeration clearAll relies on. Every exported function
// that accepts an injected storage must degrade to its documented fallback
// against this, never let the throw escape.
function makeHostileStorage() {
  return {
    getItem() {
      throw new Error('hostile getItem');
    },
    setItem() {
      throw new Error('hostile setItem');
    },
    removeItem() {
      throw new Error('hostile removeItem');
    },
    get length() {
      throw new Error('hostile length');
    },
    key() {
      throw new Error('hostile key');
    },
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

// Retitled from "...is never evicted by demo saves": with only a single
// protected snapshot in play, it stays within PROTECTED_CAP (3) forever, so
// it is in fact never evicted here -- but the module-wide guarantee is now
// "at most PROTECTED_CAP protected slots survive", not "protected is
// unbounded/permanent". See the PROTECTED_CAP tests below for the bound
// itself.
test('a single protected pre-demo snapshot survives many ordinary demo saves', () => {
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

// R5-01/V5-NEW-02: repeated protected saves (e.g. clicking "Start a blank
// study" over and over) used to grow the protected set without bound,
// eventually filling the entire ring and leaving no room for an ordinary
// autosave to land -- the save would report success (a non-null id) while
// silently being unrecoverable moments later, or a LATER plain autosave
// would be discarded outright. This test proves the bound: after any number
// of protected saves, at most PROTECTED_CAP survive, the ring never exceeds
// RING_SIZE, and -- critically -- every id this function returns is
// immediately loadable via loadExperiment, never a promise the ring cannot
// keep.
test('protected saves are capped at PROTECTED_CAP and every returned id is immediately loadable', () => {
  const storage = makeFakeStorage();
  const returnedIds = [];
  for (let i = 0; i < 8; i += 1) {
    const experiment = emptyExperiment();
    experiment.meta.title = `protected-${i}`;
    const id = saveExperiment(experiment, { storage, protectFromAutomaticEviction: true });
    assert.ok(id, `save ${i} must return a non-null id`);
    returnedIds.push(id);
    // The invariant holds after EVERY save, not just the last one.
    assert.ok(loadExperiment(id, { storage }) !== null, `returned id ${i} must be loadable immediately`);
    const ring = listSaved({ storage });
    assert.ok(ring.length <= 5, `ring length ${ring.length} must never exceed 5 (save ${i})`);
  }

  const finalRing = listSaved({ storage });
  // Every one of the 8 saves above was protected, so the ring can never grow
  // past PROTECTED_CAP itself (a protected id is only ever evicted along
  // with its ring entry) -- it converges to exactly 3, not 5, which is a
  // stronger confirmation of the cap than "<= 5" alone would be.
  assert.ok(finalRing.length <= 5, `ring length ${finalRing.length} must never exceed 5`);
  assert.equal(finalRing.length, 3, 'an all-protected sequence converges to exactly PROTECTED_CAP');
  const protectedInRing = finalRing.filter((rid) => returnedIds.includes(rid));
  assert.ok(protectedInRing.length <= 3, `at most 3 protected ids may remain, got ${protectedInRing.length}`);

  // After 8 protected saves, ordinary (unprotected) autosaves must still
  // find room -- the whole point of PROTECTED_CAP -- rather than being
  // unable to evict anything and silently vanishing. Three plain saves in a
  // row: each one, at the moment it is made, survives loadExperiment and
  // appears in listSaved (only up to RING_SIZE - PROTECTED_CAP = 2 of them
  // can coexist with the 3 protected survivors at any one time, so an OLDER
  // plain save can still be aged out by a newer one -- that is ordinary ring
  // rotation, not the starvation bug this task fixes).
  for (let i = 0; i < 3; i += 1) {
    const plain = emptyExperiment();
    plain.meta.title = `ordinary-autosave-${i}`;
    const plainId = saveExperiment(plain, { storage });
    assert.ok(plainId, `plain save ${i} must return an id`);
    assert.ok(loadExperiment(plainId, { storage }) !== null, `plain save ${i} must be loadable`);
    assert.ok(listSaved({ storage }).includes(plainId), `plain save ${i} must appear in listSaved`);
  }
});

// Direct reviewer repro (a4f_ringstarve.py / R5-01): six protected saves
// (six "Start a blank study" clicks) followed by one ordinary autosave. On
// the pre-fix tree this fails -- six protected ids fill every ring slot,
// there is nothing left to evict, and the plain save's id, though returned,
// is not in the ring and is never seen by listSaved/loadMostRecentRecoverable
// again once anything else is saved. Run this BEFORE the persist.js change
// to confirm the failure, then after to confirm the fix.
test('reviewer scenario: after 6 protected saves, a plain autosave survives and is loadable', () => {
  const storage = makeFakeStorage();
  for (let i = 0; i < 6; i += 1) {
    const experiment = emptyExperiment();
    experiment.meta.title = `blank-study-${i}`;
    saveExperiment(experiment, { storage, protectFromAutomaticEviction: true });
  }

  const plain = emptyExperiment();
  plain.meta.title = 'the actual edit the user just made';
  const plainId = saveExperiment(plain, { storage });

  assert.ok(plainId, 'the plain save must return an id');
  assert.ok(loadExperiment(plainId, { storage }) !== null, 'the plain save must be loadable');
  assert.ok(listSaved({ storage }).includes(plainId), 'the plain save must appear in listSaved');
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

// Studies are gaining a real identity: schema.js's emptyExperiment() mints
// meta.id/createdAt/updatedAt, and appController.js stamps meta.updatedAt
// fresh on every SAVE (a write concern -- see appController.js's
// withSaveStamp). This module's job in that split is the READ side, and it
// must have no clock and no opinion about identity at all: serializing and
// then reading a backup back through this file must never mint a new id or
// claim a new save time. If it did, restoring an old backup would silently
// rewrite its identity and pretend it was just saved -- exactly what a
// project backup must never do to the file it is reading.
test('meta.id/createdAt/updatedAt survive serialize -> deserialize -> parseAndMigrate unchanged', () => {
  const experiment = emptyExperiment();
  const { id, createdAt, updatedAt } = experiment.meta;

  const text = serializeExperiment(experiment);

  const roundTripped = deserializeExperiment(text);
  assert.equal(roundTripped.meta.id, id);
  assert.equal(roundTripped.meta.createdAt, createdAt);
  assert.equal(roundTripped.meta.updatedAt, updatedAt);

  const { experiment: migrated } = parseAndMigrateExperiment(text);
  assert.equal(migrated.meta.id, id);
  assert.equal(migrated.meta.createdAt, createdAt);
  assert.equal(migrated.meta.updatedAt, updatedAt);
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

test('clearAll reports failure when a key it enumerated could not actually be removed', () => {
  // The enumeration succeeds and removeItem is what throws -- the one shape a
  // "collect first, delete second" sweep cannot notice on its own. removeKey
  // deliberately suppresses the throw (a quota/security error must not crash
  // the app), so without a returned result clearAll would report ok:true over
  // data that is still sitting there, and main.js would then tell the user
  // "Cleared all locally stored data." That is precisely the class of lie
  // this result object exists to prevent.
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage });
  markChanged({ storage });
  const stillThere = storage.length;
  assert.ok(stillThere > 0, 'sanity: there is something to fail to remove');

  storage.removeItem = () => {
    throw new Error('removeItem blocked');
  };
  const quotaErrors = [];
  const result = clearAll({ storage, onQuotaExceeded: (err) => quotaErrors.push(err) });

  assert.equal(result.ok, false, 'a suppressed removeItem failure must not report success');
  assert.deepEqual(result.removed, [], 'nothing was actually removed');
  assert.ok(result.error instanceof Error);
  assert.equal(storage.length, stillThere, 'the data really is still there');
  assert.ok(quotaErrors.length > 0, 'the underlying error is still surfaced to the callback');
});

test('clearAll reports partial failure honestly, removing what it can', () => {
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage });
  markChanged({ storage });
  const owned = [];
  for (let i = 0; i < storage.length; i += 1) owned.push(storage.key(i));
  assert.ok(owned.length > 1, 'sanity: need at least two owned keys to split the outcome');

  const doomedButStuck = owned[0];
  const realRemove = storage.removeItem.bind(storage);
  storage.removeItem = (key) => {
    if (key === doomedButStuck) throw new Error('removeItem blocked');
    realRemove(key);
  };
  const result = clearAll({ storage });

  assert.equal(result.ok, false);
  assert.ok(!result.removed.includes(doomedButStuck), 'a key that survived is not listed as removed');
  assert.ok(result.removed.length > 0, 'the keys that could go, went -- a partial clear still completes');
  assert.equal(storage.getItem(doomedButStuck) !== null, true, 'the stuck key is genuinely still stored');
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

// --- AUD-01: defaultBackend() and clearAll() must never let a hostile or
// privacy-mode storage backend escape as an uncaught throw ------------------

test('defaultBackend survives a globalThis.localStorage whose property access itself throws', () => {
  // Privacy-mode browsers can make the *property access itself* throw (not
  // merely return a value that later throws on use). defaultBackend() is a
  // default parameter of every exported function here, so this has to be
  // caught before any of those functions' own bodies ever run.
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const originalDescriptor = hadOwnProperty
    ? Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    : undefined;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });

  try {
    assert.doesNotThrow(() => listSaved());
    assert.deepEqual(listSaved(), []);
    assert.doesNotThrow(() => markChanged());
    assert.doesNotThrow(() => clearAll());
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }

  // Confirm the environment was actually restored to its pre-test shape --
  // other tests in this file rely on globalThis.localStorage being absent.
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

test('loadMostRecentRecoverable degrades to its documented no-recovery fallback against a hostile storage', () => {
  const storage = makeHostileStorage();
  const result = loadMostRecentRecoverable({ storage });
  assert.deepEqual(result, { experiment: null, skippedCount: 0, totalSaved: 0 });
});

test('listSaved degrades to an empty list against a hostile storage', () => {
  const storage = makeHostileStorage();
  assert.deepEqual(listSaved({ storage }), []);
});

test('markChanged does not throw against a hostile storage', () => {
  const storage = makeHostileStorage();
  assert.doesNotThrow(() => markChanged({ storage }));
});

test('clearAll returns a success result naming exactly the STORAGE_PREFIX keys it removed', () => {
  const storage = makeFakeStorage();
  saveExperiment(emptyExperiment(), { storage });
  saveExperiment(emptyExperiment(), { storage });
  markChanged({ storage });
  storage.setItem('someOtherApp.session', 'keep me');

  const result = clearAll({ storage });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.ok(Array.isArray(result.removed));
  assert.ok(result.removed.length > 0);
  assert.ok(result.removed.every((key) => key.startsWith(STORAGE_PREFIX)));
  // The foreign key is not among the removed keys and is still readable.
  assert.ok(!result.removed.includes('someOtherApp.session'));
  assert.equal(storage.getItem('someOtherApp.session'), 'keep me');
  assert.deepEqual(listSaved({ storage }), []);
});

test('clearAll on a hostile (throwing) backend returns a failure result rather than throwing', () => {
  const storage = makeHostileStorage();
  let result;
  assert.doesNotThrow(() => {
    result = clearAll({ storage });
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.removed, []);
  assert.ok(result.error instanceof Error);
});
