import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, emptyExperiment, migrate } from '../src/core/schema.js';

test('emptyExperiment returns an object with all v3 top-level Study keys', () => {
  const exp = emptyExperiment();
  const expectedKeys = [
    'schemaVersion',
    'meta',
    'researchQuestion',
    'narrative',
    'armVocabulary',
    'assays',
    'activeAssayId',
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

test('emptyExperiment does NOT keep a vestigial copy of the per-assay roots at the top level', () => {
  // The inverse of the presence check above -- a surviving root here would
  // be a second home for the same fact, and setPath auto-vivifies a
  // missing root on write with no error, so a leftover root would silently
  // absorb writes nothing reads. The presence-only check above would not
  // have caught this.
  const exp = emptyExperiment();
  for (const key of ['specimen', 'design', 'panel', 'acquisition', 'controls']) {
    assert.ok(!(key in exp), `unexpected vestigial top-level key: ${key}`);
  }
  assert.ok(!('fields' in exp.naming), 'naming.fields must live on the assay, not the study');
});

test('emptyExperiment stamps the current schema version', () => {
  const exp = emptyExperiment();
  assert.equal(exp.schemaVersion, SCHEMA_VERSION);
});

test('emptyExperiment always has at least one assay, with activeAssayId pointing at it', () => {
  const exp = emptyExperiment();
  assert.equal(exp.assays.length, 1);
  assert.equal(exp.assays[0].id, exp.activeAssayId);
});

test("emptyExperiment's assay has groups/factors/two replicate axes/idScheme/conditions", () => {
  const exp = emptyExperiment();
  const design = exp.assays[0].design;
  assert.deepEqual(design.groups, { levels: [] });
  assert.deepEqual(design.factors, []);
  assert.equal(design.biologicalReplicates, null);
  assert.equal(design.technicalReplicates, null);
  assert.equal(design.idScheme, '');
  assert.deepEqual(design.conditions, []);
});

test('emptyExperiment naming carries a default template and empty plannedNames; fields live on the assay', () => {
  const exp = emptyExperiment();
  assert.equal(
    exp.naming.template,
    // Stage 1 (shared by every file WITHIN ONE ASSAY): date/modality/exptype/
    // markers/magnification. Stage 2 (what distinguishes THIS file): group/
    // sample/biorep/techrep. {notes} stays last as free annotation.
    '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}'
  );
  assert.deepEqual(exp.naming.plannedNames, []);
  assert.deepEqual(exp.assays[0].naming.fields, {});
});

test('emptyExperiment provenance has slots/unanswered/skipped', () => {
  const exp = emptyExperiment();
  assert.deepEqual(exp.provenance.slots, {});
  assert.deepEqual(exp.provenance.unanswered, []);
  assert.deepEqual(exp.provenance.skipped, []);
});

test('emptyExperiment calls are independent objects (no shared references), including per-assay data', () => {
  const a = emptyExperiment();
  const b = emptyExperiment();
  a.assays[0].naming.fields.foo = 'bar';
  assert.deepEqual(b.assays[0].naming.fields, {});
});

test('emptyExperiment calls mint DIFFERENT assay ids', () => {
  // Real usage: two independently created studies' first assays must not
  // collide if their data is ever combined. The migration path below uses
  // a DETERMINISTIC id instead, deliberately -- see migrateV2toV3.
  const a = emptyExperiment();
  const b = emptyExperiment();
  assert.notEqual(a.activeAssayId, b.activeAssayId);
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

// --- v1 -> v2 -> v3 fixtures -----------------------------------------------
// Without a real migration at each step, EVERY older autosave hard-fails on
// load the moment SCHEMA_VERSION moves -- migrate() throws "No migration
// path" for any version it doesn't recognize, so this is load-bearing, not
// a nicety.

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

function v2Experiment(overrides = {}) {
  return {
    schemaVersion: 2,
    meta: { id: null, createdAt: null, updatedAt: null, title: '' },
    narrative: { text: '', history: [] },
    specimen: { organism: '', sampleType: '', preparation: '', notes: '' },
    design: {
      groups: { levels: [] },
      factors: [],
      biologicalReplicates: null,
      technicalReplicates: null,
      idScheme: '',
      conditions: [],
    },
    panel: { targets: [], channels: [] },
    acquisition: { instrument: '', objective: '', magnification: '', modality: '', settings: {} },
    controls: { positive: [], negative: [], notes: '' },
    naming: { template: 'irrelevant-to-this-test', fields: {}, plannedNames: [] },
    provenance: { slots: {}, unanswered: [], skipped: [] },
    derived: {},
    interview: { turns: [], currentStep: null },
    conformance: { checks: [], status: 'unknown' },
    ...overrides,
  };
}

test('migrate chains v1 all the way to the current version (v3) in one call', () => {
  const migrated = migrate(v1Experiment());
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.assays.length, 1);
  // Proves v1->v2's own semantics (replicates -> biologicalReplicates)
  // survived being immediately hoisted by v2->v3, not just that SOME
  // migration ran.
  assert.equal(migrated.assays[0].design.biologicalReplicates, 3);
  assert.deepEqual(migrated.assays[0].design.factors, [{ name: 'genotype', levels: ['WT', 'KO'] }]);
});

test('migrate upgrades a v1 experiment to v2 semantics: replicates -> biologicalReplicates', () => {
  const migrated = migrate(v1Experiment());
  const design = migrated.assays[0].design;
  assert.equal(design.biologicalReplicates, 3);
  assert.equal(design.technicalReplicates, null);
  // The v1 replicates key must not survive alongside the new one.
  assert.ok(!('replicates' in design));
});

test('migrate v1->v2 leaves factors untouched rather than guessing which one was the arm axis', () => {
  const migrated = migrate(v1Experiment());
  const design = migrated.assays[0].design;
  assert.deepEqual(design.factors, [{ name: 'genotype', levels: ['WT', 'KO'] }]);
  assert.deepEqual(design.groups, { levels: [] });
});

test('migrate v1->v3 preserves study-level fields (meta, narrative) untouched', () => {
  const v1 = v1Experiment();
  v1.meta.title = 'my experiment';
  v1.narrative.text = 'a paragraph';
  const migrated = migrate(v1);
  assert.equal(migrated.meta.title, 'my experiment');
  assert.equal(migrated.narrative.text, 'a paragraph');
});

test('migrate v1->v2 handles a null replicates count (never set)', () => {
  const migrated = migrate(v1Experiment({ replicates: null }));
  assert.equal(migrated.assays[0].design.biologicalReplicates, null);
});

// --- v2 -> v3: the hoist ----------------------------------------------------

test('migrate v2->v3 hoists the whole per-assay slice into assays[0] verbatim', () => {
  const v2 = v2Experiment({
    specimen: { organism: 'mouse', sampleType: '', preparation: '', notes: '' },
    design: { groups: { levels: ['CT', 'OPP'] }, factors: [], biologicalReplicates: 3, technicalReplicates: null, idScheme: '', conditions: [] },
    acquisition: { instrument: '', objective: '', magnification: 'X40', modality: 'confocal', settings: {} },
    naming: { template: 'irrelevant', fields: { date: '2026-01-01', sample: 'E01' }, plannedNames: [] },
  });
  const migrated = migrate(v2);
  const assay = migrated.assays[0];
  assert.equal(assay.specimen.organism, 'mouse');
  assert.deepEqual(assay.design.groups, { levels: ['CT', 'OPP'] });
  assert.equal(assay.acquisition.modality, 'confocal');
  assert.deepEqual(assay.naming.fields, { date: '2026-01-01', sample: 'E01' });
});

test('migrate v2->v3 does NOT promote design.groups to armVocabulary', () => {
  // The vocabulary is a seeding template for FUTURE assays; copying the v2
  // user's actual arms upward would assert every future assay shares them.
  const v2 = v2Experiment({ design: { groups: { levels: ['CT', 'OPP'] }, factors: [], biologicalReplicates: null, technicalReplicates: null, idScheme: '', conditions: [] } });
  const migrated = migrate(v2);
  assert.deepEqual(migrated.armVocabulary, { levels: [] });
});

test('migrate v2->v3 leaves NO vestigial root copy of the hoisted slices', () => {
  const migrated = migrate(v2Experiment());
  for (const key of ['specimen', 'design', 'panel', 'acquisition', 'controls']) {
    assert.ok(!(key in migrated), `unexpected vestigial top-level key after migration: ${key}`);
  }
  assert.ok(!('fields' in migrated.naming));
});

test('migrate v2->v3 rescopes provenance slot keys under assay:<id>., so interview.js can still find them', () => {
  const v2 = v2Experiment({
    provenance: {
      slots: {
        'acquisition.modality': { tag: 'user', detail: null },
        'naming.fields.sample': { tag: 'freetext', detail: null },
        'narrative.text': { tag: 'user', detail: null }, // study-level -- must NOT be rescoped
      },
      unanswered: ['organism'],
      skipped: ['instrument'],
    },
  });
  const migrated = migrate(v2);
  const id = migrated.activeAssayId;
  assert.deepEqual(migrated.provenance.slots[`assay:${id}.acquisition.modality`], { tag: 'user', detail: null });
  assert.deepEqual(migrated.provenance.slots[`assay:${id}.naming.fields.sample`], { tag: 'freetext', detail: null });
  assert.deepEqual(migrated.provenance.slots['narrative.text'], { tag: 'user', detail: null });
  assert.deepEqual(migrated.provenance.unanswered, ['organism']);
  assert.deepEqual(migrated.provenance.skipped, ['instrument']);
});

test('migrate v2->v3 uses a DETERMINISTIC assay id (a migration must be reproducible)', () => {
  const a = migrate(v2Experiment());
  const b = migrate(v2Experiment());
  assert.equal(a.assays[0].id, b.assays[0].id);
  assert.equal(a.activeAssayId, a.assays[0].id);
});

test('migrate v2->v3 labels the migrated assay from meta.title, falling back to "Assay 1"', () => {
  const withTitle = migrate(v2Experiment({ meta: { id: null, createdAt: null, updatedAt: null, title: 'Wound healing study' } }));
  assert.equal(withTitle.assays[0].label, 'Wound healing study');

  const withoutTitle = migrate(v2Experiment());
  assert.equal(withoutTitle.assays[0].label, 'Assay 1');
});

test('migrate v2->v3 is TOTAL: malformed/missing sub-objects degrade rather than throw', () => {
  const bare = { schemaVersion: 2 };
  assert.doesNotThrow(() => migrate(bare));
  const migrated = migrate(bare);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.assays.length, 1);
});
