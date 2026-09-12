import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  STUDY_COMPARISON_MODES,
  emptyExperiment,
  migrate,
} from '../src/core/schema.js';
import { validateImportedExperiment } from '../src/core/importValidate.js';

const EMPTY_STUDY_CONTEXT = {
  system: '',
  experimentalUnit: '',
  comparisonMode: 'not-decided',
};

test('emptyExperiment returns an object with all v6 top-level Study keys', () => {
  const exp = emptyExperiment();
  const expectedKeys = [
    'schemaVersion',
    'meta',
    'researchQuestion',
    'studyContext',
    'narrative',
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

test('emptyExperiment supplies the v5 study-context defaults and comparison vocabulary', () => {
  assert.deepEqual(emptyExperiment().studyContext, EMPTY_STUDY_CONTEXT);
  assert.deepEqual(
    [...STUDY_COMPARISON_MODES],
    ['not-decided', 'groups', 'observational']
  );
});

test('emptyExperiment does NOT keep a vestigial copy of the per-assay roots at the top level', () => {
  // The inverse of the presence check above -- a surviving root here would
  // be a second home for the same fact, and setPath auto-vivifies a
  // missing root on write with no error, so a leftover root would silently
  // absorb writes nothing reads. The presence-only check above would not
  // have caught this.
  const exp = emptyExperiment();
  for (const key of ['specimen', 'design', 'panel', 'acquisition', 'controls', 'groupVocabulary']) {
    assert.ok(!(key in exp), `unexpected vestigial top-level key: ${key}`);
  }
  assert.ok(!('fields' in exp.naming), 'naming.fields must live on the assay, not the study');
});

test('emptyExperiment stamps the current schema version', () => {
  const exp = emptyExperiment();
  assert.equal(exp.schemaVersion, SCHEMA_VERSION);
});

test('emptyExperiment marks a genuinely new study as blank', () => {
  assert.equal(emptyExperiment().meta.origin, 'blank');
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

test('emptyExperiment mints a non-empty string meta.id and ISO-string createdAt/updatedAt', () => {
  const exp = emptyExperiment();
  assert.equal(typeof exp.meta.id, 'string');
  assert.ok(exp.meta.id.length > 0);
  assert.equal(typeof exp.meta.createdAt, 'string');
  assert.equal(typeof exp.meta.updatedAt, 'string');
  assert.ok(!Number.isNaN(new Date(exp.meta.createdAt).getTime()), 'createdAt must parse to a valid Date');
  assert.ok(!Number.isNaN(new Date(exp.meta.updatedAt).getTime()), 'updatedAt must parse to a valid Date');
});

test('emptyExperiment calls mint DIFFERENT meta.ids', () => {
  const a = emptyExperiment();
  const b = emptyExperiment();
  assert.notEqual(a.meta.id, b.meta.id);
});

test('migrate backfills a missing meta.id on a legacy document, returning a NEW root, and leaves createdAt null', () => {
  // A null id is exactly the legacy-save shape (see the v1/v2 fixtures
  // below, and emptyExperiment() before this change) -- migrate() must
  // mint a real one, but must NOT invent a creation date it cannot justify.
  const legacy = emptyExperiment();
  legacy.meta.id = null;
  legacy.meta.createdAt = null;

  const migrated = migrate(legacy);
  assert.notEqual(migrated, legacy);
  assert.equal(typeof migrated.meta.id, 'string');
  assert.ok(migrated.meta.id.length > 0);
  assert.equal(migrated.meta.createdAt, null);
  assert.equal(legacy.meta.id, null, 'migration must not mutate the saved object');
});

test('migrate backfills meta.id idempotently: a second pass is a true no-op, same reference and same id', () => {
  // The important case: a re-minting backfill would hand the same document
  // a DIFFERENT id every time it happens to be loaded, which defeats the
  // entire purpose of an id meant to key a workspace index or survive an
  // export/import round trip. Once backfilled, the id must be stable.
  const legacy = emptyExperiment();
  legacy.meta.id = null;

  const onceBackfilled = migrate(legacy);
  const twiceBackfilled = migrate(onceBackfilled);
  assert.equal(twiceBackfilled, onceBackfilled);
  assert.equal(twiceBackfilled.meta.id, onceBackfilled.meta.id);
});

test('migrate no-ops at the current schema version', () => {
  const exp = emptyExperiment();
  const migrated = migrate(exp);
  assert.equal(migrated, exp);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
});

test('migrate preserves identity for every valid v5 comparison mode', () => {
  for (const comparisonMode of STUDY_COMPARISON_MODES) {
    const exp = emptyExperiment();
    exp.studyContext = {
      system: 'soil cores',
      experimentalUnit: 'one independently sampled core',
      comparisonMode,
    };
    assert.equal(migrate(exp), exp, comparisonMode);
  }
});

test('migrate normalizes missing or malformed current-version study context without losing other data', () => {
  const malformed = emptyExperiment();
  malformed.studyContext = {
    system: 42,
    experimentalUnit: { text: 'leaf' },
    comparisonMode: 'treatment-vs-control',
    retainedFutureContext: 'keep me',
  };
  malformed.customTopLevelData = { preserved: true };

  const migratedMalformed = migrate(malformed);
  assert.notEqual(migratedMalformed, malformed);
  assert.deepEqual(migratedMalformed.studyContext, {
    ...EMPTY_STUDY_CONTEXT,
    retainedFutureContext: 'keep me',
  });
  assert.equal(migratedMalformed.assays, malformed.assays);
  assert.equal(migratedMalformed.naming, malformed.naming);
  assert.equal(migratedMalformed.provenance, malformed.provenance);
  assert.equal(migratedMalformed.customTopLevelData, malformed.customTopLevelData);

  const missing = emptyExperiment();
  delete missing.studyContext;
  const migratedMissing = migrate(missing);
  assert.deepEqual(migratedMissing.studyContext, EMPTY_STUDY_CONTEXT);
  assert.equal(migratedMissing.assays, missing.assays);
});

test('migrate treats a legacy meta object with no origin as user work', () => {
  const legacy = emptyExperiment();
  delete legacy.meta.origin;

  const migrated = migrate(legacy);
  assert.notEqual(migrated, legacy);
  assert.equal(migrated.meta.origin, 'user');
  assert.equal(legacy.meta.origin, undefined, 'migration must not mutate the saved object');
});

test('migrate keeps each supported origin unchanged', () => {
  for (const origin of ['blank', 'example', 'imported', 'draft', 'template', 'user']) {
    const experiment = emptyExperiment();
    experiment.meta.origin = origin;
    assert.equal(migrate(experiment), experiment, origin);
  }
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

// --- v1 -> v2 -> v3 -> v4 -> v5 fixtures -----------------------------------
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

test('migrate chains v1 all the way to the current version in one call', () => {
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

test('migrate v1->v2 leaves factors untouched rather than guessing which one was the group axis', () => {
  const migrated = migrate(v1Experiment());
  const design = migrated.assays[0].design;
  assert.deepEqual(design.factors, [{ name: 'genotype', levels: ['WT', 'KO'] }]);
  assert.deepEqual(design.groups, { levels: [] });
});

test('migrate v1->v5 preserves study-level fields (meta, narrative) untouched', () => {
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

test('migrate v2 through current does not synthesize a study-level vocabulary from design.groups', () => {
  // There is no study-level vocabulary field at all any more (v6): groups
  // are a per-assay fact only. A v2 study's own groups must survive the
  // hoist into assays[0] unchanged, with no groupVocabulary key appearing
  // anywhere in the result.
  const v2 = v2Experiment({ design: { groups: { levels: ['CT', 'OPP'] }, factors: [], biologicalReplicates: null, technicalReplicates: null, idScheme: '', conditions: [] } });
  const migrated = migrate(v2);
  assert.ok(!('groupVocabulary' in migrated));
  assert.deepEqual(migrated.assays[0].design.groups, { levels: ['CT', 'OPP'] });
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

test('migrate v3 with a legacy armVocabulary reaches current with its levels seeded onto the (single, ungrouped) assay', () => {
  // v3->v4 renamed armVocabulary to groupVocabulary; v5->v6 later retires
  // that field entirely by seeding it onto whichever assay has no groups of
  // its own yet -- see migrateV5toV6. A study migrating all the way from v3
  // must land in that same final state, not an intermediate v4 shape.
  const current = emptyExperiment();
  const v3 = { ...current, schemaVersion: 3 };
  v3.armVocabulary = { levels: ['CTL', 'OPP'] };
  v3.provenance = {
    ...v3.provenance,
    slots: {
      ...v3.provenance.slots,
      armVocabulary: { tag: 'user', detail: 'legacy study' },
    },
  };

  const migrated = migrate(v3);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.ok(!('groupVocabulary' in migrated));
  assert.ok(!('armVocabulary' in migrated));
  assert.ok(!('armVocabulary' in migrated.provenance.slots));
  assert.ok(!('groupVocabulary' in migrated.provenance.slots));
  assert.deepEqual(migrated.assays[0].design.groups, { levels: ['CTL', 'OPP'] });
  assert.deepEqual(migrated.provenance.slots[`assay:${migrated.assays[0].id}.design.groups`], {
    tag: 'kb-default',
    detail: null,
  });
  assert.deepEqual(v3.armVocabulary, { levels: ['CTL', 'OPP'] }, 'migration must not mutate v3 input');
});

test('migrate v3 with a malformed legacy vocabulary reaches current with nothing seeded and no stray key', () => {
  const current = emptyExperiment();
  const v3 = { ...current, schemaVersion: 3, armVocabulary: { levels: null } };
  const migrated = migrate(v3);
  assert.ok(!('groupVocabulary' in migrated));
  assert.deepEqual(migrated.assays[0].design.groups, { levels: [] });
});

function v4Experiment() {
  const current = emptyExperiment();
  const { studyContext: _studyContext, ...v4 } = current;
  return {
    ...v4,
    schemaVersion: 4,
    researchQuestion: 'Does compost change soil respiration?',
    narrative: { text: 'Legacy prose must not become structured context.', history: [] },
    groupVocabulary: { levels: ['unamended', 'compost'] },
    assays: [{
      ...v4.assays[0],
      specimen: { ...v4.assays[0].specimen, organism: 'soil' },
      design: { ...v4.assays[0].design, groups: { levels: ['unamended', 'compost'] } },
    }],
    naming: { template: '{date}_{sample}', plannedNames: ['2026-01-01_core-A'] },
    provenance: { slots: { 'narrative.text': { tag: 'user', detail: null } }, unanswered: [], skipped: [] },
  };
}

test('migrate generated v1-v4 fixtures reaches current with empty context and preserves legacy slices', () => {
  const v1 = v1Experiment({ biologicalReplicates: undefined });
  const v2 = v2Experiment();
  const v3Current = emptyExperiment();
  const { studyContext: _v3Context, ...v3 } = v3Current;
  v3.schemaVersion = 3;
  v3.armVocabulary = { levels: ['legacy', 'current'] };
  const v4 = v4Experiment();

  for (const fixture of [v1, v2, v3, v4]) {
    const migrated = migrate(fixture);
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(migrated.studyContext, EMPTY_STUDY_CONTEXT);
    assert.ok(!('groupVocabulary' in migrated), `v${fixture.schemaVersion} carries no groupVocabulary key`);
    assert.ok(Array.isArray(migrated.assays), `v${fixture.schemaVersion} assay slice is preserved`);
    assert.ok(migrated.naming && typeof migrated.naming === 'object', `v${fixture.schemaVersion} naming slice is preserved`);
    assert.ok(migrated.provenance && typeof migrated.provenance === 'object', `v${fixture.schemaVersion} provenance slice is preserved`);
  }

  // v4's assay already carries its own groups (['unamended', 'compost']), so
  // v5->v6 has nothing to seed there -- the only change beyond the v5
  // context is that the now-redundant study-level groupVocabulary is gone.
  const before = JSON.parse(JSON.stringify(v4));
  const migratedV4 = migrate(v4);
  const { schemaVersion: _version, studyContext: _context, groupVocabulary: _migratedVocab, ...v4Payload } = migratedV4;
  const { schemaVersion: _legacyVersion, groupVocabulary: _legacyVocab, ...expectedPayload } = before;
  assert.deepEqual(v4Payload, expectedPayload, 'v4 data changes only by the additive v5 context and the dropped legacy vocabulary');
  assert.ok(!('groupVocabulary' in migratedV4));
  assert.deepEqual(migratedV4.assays, before.assays);
  assert.deepEqual(migratedV4.naming, before.naming);
  assert.deepEqual(migratedV4.provenance, before.provenance);
});

// --- v5 -> v6: retire groupVocabulary ---------------------------------------

test('migrate v5->v6 seeds an assay with empty, unconfirmed groups from the legacy vocabulary', () => {
  const v5 = { ...emptyExperiment(), schemaVersion: 5, groupVocabulary: { levels: ['CTL', 'OPP'] } };
  const migrated = migrate(v5);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.ok(!('groupVocabulary' in migrated));
  assert.deepEqual(migrated.assays[0].design.groups, { levels: ['CTL', 'OPP'] });
  assert.deepEqual(migrated.provenance.slots[`assay:${migrated.assays[0].id}.design.groups`], {
    tag: 'kb-default',
    detail: null,
  });
});

test('migrate v5->v6 leaves an assay that already has its own groups untouched', () => {
  const base = emptyExperiment();
  const assay = { ...base.assays[0], design: { ...base.assays[0].design, groups: { levels: ['ALREADY-SET'] } } };
  const v5 = { ...base, schemaVersion: 5, groupVocabulary: { levels: ['CTL', 'OPP'] }, assays: [assay] };
  const migrated = migrate(v5);
  assert.deepEqual(migrated.assays[0].design.groups, { levels: ['ALREADY-SET'] });
});

test('migrate v5->v6 never overwrites an assay whose empty groups are already a deliberate, STRONG-tagged user edit -- and heals the legacy STRONG-empty slot so it is no longer locked', () => {
  const base = emptyExperiment();
  const id = base.assays[0].id;
  const v5 = {
    ...base,
    schemaVersion: 5,
    groupVocabulary: { levels: ['CTL', 'OPP'] },
    provenance: {
      ...base.provenance,
      slots: { ...base.provenance.slots, [`assay:${id}.design.groups`]: { tag: 'user', detail: null } },
    },
  };
  const migrated = migrate(v5);
  // migrateV5toV6 itself still refuses to seed from groupVocabulary while
  // the slot reads STRONG (canOverwrite mirrors setValueAtPath's own rule):
  // the empty levels are left exactly as the user's STRONG edit recorded
  // them, not silently replaced by the legacy vocabulary.
  assert.deepEqual(migrated.assays[0].design.groups, { levels: [] });
  // But schema.js's load-boundary normalizeEmptySlotProvenance (B4 /
  // V6-NEW-03 / lesson 37) heals that STRONG-tagged EMPTY slot to 'default'
  // (WEAK) in the same pass: a deliberately-cleared axis is never truly
  // STRONG under isEmptyValue's rule, so a save made before that rule
  // existed must not stay locked out of every future WEAK "copy groups"
  // refill forever, with no user action able to clear it.
  assert.deepEqual(migrated.provenance.slots[`assay:${id}.design.groups`], { tag: 'default', detail: null });
});

test('migrate v5->v6 drops groupVocabulary and its provenance slot entirely when there is nothing to seed', () => {
  const base = emptyExperiment();
  const v5 = {
    ...base,
    schemaVersion: 5,
    groupVocabulary: { levels: [] },
    provenance: {
      ...base.provenance,
      slots: { ...base.provenance.slots, groupVocabulary: { tag: 'kb-default', detail: null } },
    },
  };
  const migrated = migrate(v5);
  assert.ok(!('groupVocabulary' in migrated));
  assert.ok(!('groupVocabulary' in migrated.provenance.slots));
});

// --- panel.spillover: additive default, no schemaVersion bump (V3-N1) ----

test('a v6 export without panel.spillover imports with acknowledged: [] (no schemaVersion bump needed)', () => {
  const base = emptyExperiment();
  const legacyAssay = { ...base.assays[0], panel: { targets: [], channels: [] } }; // pre-A2 shape: no spillover key at all
  const legacyExport = { ...base, schemaVersion: SCHEMA_VERSION, assays: [legacyAssay] };

  // migrate() is a no-op here since the file already claims the current
  // version (the `while (version < SCHEMA_VERSION)` loop never runs) --
  // validateImportedExperiment is what actually merges in the new default,
  // via sanitizeAssay's `{...base[key], ...raw[key]}` spread per container.
  const migrated = migrate(legacyExport);
  const { experiment, issues } = validateImportedExperiment(migrated);

  assert.deepEqual(
    experiment.assays[0].panel.spillover,
    { acknowledged: [] },
    'a legacy assay with no panel.spillover key at all must import with the additive default'
  );
  assert.ok(!issues.some((i) => i.severity === 'fatal'));
});

test('a v6 SAVE (not import) without panel.spillover gets acknowledged: [] at the migrate() boundary', () => {
  const base = emptyExperiment();
  const legacy = { ...base, assays: [{ ...base.assays[0], panel: { targets: [], channels: [] } }] };
  const out = migrate(legacy);
  assert.deepEqual(out.assays[0].panel.spillover, { acknowledged: [] });
  assert.equal(out.assays[0].panel.channels, legacy.assays[0].panel.channels, 'other panel fields untouched');
  assert.strictEqual(migrate(base), base, 'identity preserved when nothing needs filling');
});

test('migrate() skips an unknown provenance tag on a design.groups slot instead of throwing (Copilot review, PR #20)', () => {
  const base = emptyExperiment();
  const key = `assay:${base.assays[0].id}.design.groups`;
  const withBadTag = { ...base, provenance: { ...(base.provenance || {}), slots: { ...((base.provenance || {}).slots || {}), [key]: { tag: 'totally-made-up-tag' } } } };
  let out;
  assert.doesNotThrow(() => { out = migrate(withBadTag); });
  assert.equal(out.provenance.slots[key].tag, 'totally-made-up-tag', 'left for the validator to drop');
});
