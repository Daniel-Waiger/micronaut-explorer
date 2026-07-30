import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, emptyExperiment, migrate } from '../src/core/schema.js';

test('emptyExperiment returns an object with all top-level Experiment keys', () => {
  const exp = emptyExperiment();
  const expectedKeys = [
    'schemaVersion',
    'meta',
    'narrative',
    'specimen',
    'design',
    'panel',
    'acquisition',
    'controls',
    'naming',
    'provenance',
    'derived',
    'interview',
    'conformance',
  ];
  for (const key of expectedKeys) {
    assert.ok(key in exp, `missing top-level key: ${key}`);
  }
});

test('emptyExperiment stamps the current schema version', () => {
  const exp = emptyExperiment();
  assert.equal(exp.schemaVersion, SCHEMA_VERSION);
});

test('emptyExperiment design has groups/factors/two replicate axes/idScheme/conditions', () => {
  const exp = emptyExperiment();
  assert.deepEqual(exp.design.groups, { levels: [] });
  assert.deepEqual(exp.design.factors, []);
  assert.equal(exp.design.biologicalReplicates, null);
  assert.equal(exp.design.technicalReplicates, null);
  assert.equal(exp.design.idScheme, '');
  assert.deepEqual(exp.design.conditions, []);
});

test('emptyExperiment naming carries a default template, empty fields, empty plannedNames', () => {
  const exp = emptyExperiment();
  assert.equal(
    exp.naming.template,
    // Stage 1 (shared by every file): date/modality/exptype/markers/
    // magnification. Stage 2 (what distinguishes THIS file): group/sample/
    // biorep/techrep. {notes} stays last as free annotation.
    '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}'
  );
  assert.deepEqual(exp.naming.fields, {});
  assert.deepEqual(exp.naming.plannedNames, []);
});

test('emptyExperiment provenance has slots/unanswered/skipped', () => {
  const exp = emptyExperiment();
  assert.deepEqual(exp.provenance.slots, {});
  assert.deepEqual(exp.provenance.unanswered, []);
  assert.deepEqual(exp.provenance.skipped, []);
});

test('emptyExperiment calls are independent objects (no shared references)', () => {
  const a = emptyExperiment();
  const b = emptyExperiment();
  a.naming.fields.foo = 'bar';
  assert.deepEqual(b.naming.fields, {});
});

test('migrate no-ops at the current schema version', () => {
  const exp = emptyExperiment();
  const migrated = migrate(exp);
  assert.equal(migrated, exp);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
});

test('migrate throws a clear error on a future schema version', () => {
  const future = emptyExperiment();
  future.schemaVersion = SCHEMA_VERSION + 1;
  assert.throws(() => migrate(future), /newer than this app supports/);
});

test('migrate throws when no migration path exists from an older version', () => {
  const stale = emptyExperiment();
  stale.schemaVersion = 0;
  assert.throws(() => migrate(stale), /No migration path/);
});

// --- v1 -> v2: groups split out, replicates split in two ------------------
// Without a real migration here, EVERY v1 autosave hard-fails on load the
// moment SCHEMA_VERSION moves -- migrate() throws "No migration path" for
// any version it doesn't recognize, so this is load-bearing, not a nicety.

function v1Experiment(designOverrides = {}) {
  return {
    schemaVersion: 1,
    meta: { id: null, createdAt: null, updatedAt: null, title: '' },
    narrative: { text: '', history: [] },
    specimen: { organism: '', sampleType: '', preparation: '', notes: '' },
    design: {
      factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
      replicates: 3,
      idScheme: '',
      conditions: [],
      ...designOverrides,
    },
    panel: { targets: [], channels: [] },
    acquisition: { instrument: '', objective: '', magnification: '', modality: '', settings: {} },
    controls: { positive: [], negative: [], notes: '' },
    naming: { template: 'irrelevant-to-this-test', fields: {}, plannedNames: [] },
    provenance: { slots: {}, unanswered: [], skipped: [] },
    derived: {},
    interview: { turns: [], currentStep: null },
    conformance: { checks: [], status: 'unknown' },
  };
}

test('migrate upgrades a v1 experiment to v2: replicates -> biologicalReplicates', () => {
  const migrated = migrate(v1Experiment());
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.design.biologicalReplicates, 3);
  assert.equal(migrated.design.technicalReplicates, null);
  // The v1 replicates key must not survive alongside the new one.
  assert.ok(!('replicates' in migrated.design));
});

test('migrate v1->v2 leaves factors untouched rather than guessing which one was the arm axis', () => {
  const migrated = migrate(v1Experiment());
  assert.deepEqual(migrated.design.factors, [{ name: 'genotype', levels: ['WT', 'KO'] }]);
  assert.deepEqual(migrated.design.groups, { levels: [] });
});

test('migrate v1->v2 preserves non-design fields untouched', () => {
  const v1 = v1Experiment();
  v1.meta.title = 'my experiment';
  v1.narrative.text = 'a paragraph';
  const migrated = migrate(v1);
  assert.equal(migrated.meta.title, 'my experiment');
  assert.equal(migrated.narrative.text, 'a paragraph');
});

test('migrate v1->v2 handles a null replicates count (never set)', () => {
  const migrated = migrate(v1Experiment({ replicates: null }));
  assert.equal(migrated.design.biologicalReplicates, null);
});
