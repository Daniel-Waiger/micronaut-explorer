// Tests for core/assay.js -- the ONE module allowed to know assays exist.
// assayView must produce a synthetic flat experiment indistinguishable
// (to a v2-shaped consumer) from a real v2 Experiment; scopeWrite must
// never let a write land in the wrong assay or a phantom root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSAY_SCALAR_FIELDS,
  ASSAY_SCOPED_ROOTS,
  assayById,
  assayIndexById,
  assayView,
  emptyAssay,
  firstAssayId,
  groupSeedLevels,
  isAssayScopedPath,
  removeAssay,
  scopeWrite,
  seedAssayGroups,
} from '../src/core/assay.js';

function studyWith(overrides = {}) {
  return {
    schemaVersion: 6,
    meta: { id: null, createdAt: null, updatedAt: null, title: '' },
    researchQuestion: '',
    narrative: { text: '', history: [] },
    assays: [emptyAssay('a1'), emptyAssay('a2')],
    activeAssayId: 'a1',
    naming: { template: '{date}{ext}', plannedNames: [] },
    provenance: { slots: {}, unanswered: [], skipped: [] },
    derived: {},
    interview: { turns: [], currentStep: null },
    conformance: { checks: [], status: 'unknown' },
    ...overrides,
  };
}

// --- emptyAssay / lookups ----------------------------------------------

test('emptyAssay carries the given id and mirrors the v2 per-assay slice shape', () => {
  const a = emptyAssay('x1');
  assert.equal(a.id, 'x1');
  assert.deepEqual(a.specimen, { organism: '', sampleType: '', preparation: '', notes: '' });
  assert.deepEqual(a.design.groups, { levels: [] });
  assert.equal(a.design.biologicalReplicates, null);
  assert.deepEqual(a.naming, { fields: {} });
  assert.deepEqual(a.panel.spillover, { acknowledged: [] });
});

test('assayIndexById finds the right index, or -1 for an unknown/missing id', () => {
  const study = studyWith();
  assert.equal(assayIndexById(study, 'a1'), 0);
  assert.equal(assayIndexById(study, 'a2'), 1);
  assert.equal(assayIndexById(study, 'nope'), -1);
  assert.equal(assayIndexById({}, 'a1'), -1);
  assert.equal(assayIndexById(undefined, 'a1'), -1);
});

test('assayById returns the assay object, or undefined for an unknown id', () => {
  const study = studyWith();
  assert.equal(assayById(study, 'a2').id, 'a2');
  assert.equal(assayById(study, 'nope'), undefined);
});

test('firstAssayId returns the first assay id, or undefined for a malformed experiment', () => {
  assert.equal(firstAssayId(studyWith()), 'a1');
  assert.equal(firstAssayId({ assays: [] }), undefined);
  assert.equal(firstAssayId({}), undefined);
  assert.equal(firstAssayId(undefined), undefined);
});

// --- assayView: the flat view engine modules consume --------------------

test('assayView hoists the active assay scoped roots to the top level', () => {
  const study = studyWith();
  study.assays[0].specimen.organism = 'mouse';
  study.assays[0].acquisition.modality = 'STED';
  study.assays[0].design.groups.levels = ['CT', 'OPP'];

  const view = assayView(study, 'a1');
  assert.equal(view.specimen.organism, 'mouse');
  assert.equal(view.acquisition.modality, 'STED');
  assert.deepEqual(view.design.groups.levels, ['CT', 'OPP']);
});

test('assayView selects the RIGHT assay when there is more than one', () => {
  const study = studyWith();
  study.assays[0].acquisition.modality = 'STED';
  study.assays[1].acquisition.modality = 'confocal';

  assert.equal(assayView(study, 'a1').acquisition.modality, 'STED');
  assert.equal(assayView(study, 'a2').acquisition.modality, 'confocal');
});

test('assayView merges study-level naming.template with the active assay naming.fields', () => {
  const study = studyWith();
  study.naming.template = '{date}_{modality}{ext}';
  study.assays[0].naming.fields = { date: '2026-01-01', modality: 'STED' };

  const view = assayView(study, 'a1');
  assert.equal(view.naming.template, '{date}_{modality}{ext}');
  assert.deepEqual(view.naming.fields, { date: '2026-01-01', modality: 'STED' });
});

test('assayView passes study-level keys through untouched', () => {
  const study = studyWith({ researchQuestion: 'Does OPP reduce bacterial load?' });
  study.narrative.text = 'a paragraph';
  const view = assayView(study, 'a1');
  assert.equal(view.researchQuestion, 'Does OPP reduce bacterial load?');
  assert.equal(view.narrative.text, 'a paragraph');
});

test('assayView on an unknown assayId degrades to an empty assay shape rather than throwing', () => {
  const study = studyWith();
  assert.doesNotThrow(() => assayView(study, 'ghost'));
  const view = assayView(study, 'ghost');
  assert.deepEqual(view.specimen, emptyAssay('ghost').specimen);
});

test('assayView never mutates the experiment it reads', () => {
  const study = studyWith();
  const before = JSON.stringify(study);
  assayView(study, 'a1');
  assert.equal(JSON.stringify(study), before);
});

// --- provenance projection ------------------------------------------------

test('a scoped provenance slot for the ACTIVE assay is exposed under its bare v2 path', () => {
  const study = studyWith();
  study.provenance.slots['assay:a1.acquisition.modality'] = { tag: 'user', detail: null };
  const view = assayView(study, 'a1');
  assert.deepEqual(view.provenance.slots['acquisition.modality'], { tag: 'user', detail: null });
});

test('a scoped provenance slot belonging to ANOTHER assay is invisible from this view', () => {
  const study = studyWith();
  study.provenance.slots['assay:a2.acquisition.modality'] = { tag: 'user', detail: null };
  const view = assayView(study, 'a1');
  assert.equal(view.provenance.slots['acquisition.modality'], undefined);
});

test('a study-level provenance slot (no assay: prefix) passes through to every view', () => {
  const study = studyWith();
  study.provenance.slots['narrative.text'] = { tag: 'user', detail: null };
  assert.deepEqual(assayView(study, 'a1').provenance.slots['narrative.text'], { tag: 'user', detail: null });
  assert.deepEqual(assayView(study, 'a2').provenance.slots['narrative.text'], { tag: 'user', detail: null });
});

test('unanswered/skipped pass through provenance projection unchanged', () => {
  const study = studyWith();
  study.provenance.unanswered = ['modality'];
  study.provenance.skipped = ['organism'];
  const view = assayView(study, 'a1');
  assert.deepEqual(view.provenance.unanswered, ['modality']);
  assert.deepEqual(view.provenance.skipped, ['organism']);
});

// --- scopeWrite -----------------------------------------------------------

test('scopeWrite addresses a scoped root at the active assay\'s real array index', () => {
  const study = studyWith(); // a1 at index 0, a2 at index 1
  assert.deepEqual(scopeWrite(study, 'acquisition.modality', 'a2'), {
    path: 'assays[1].acquisition.modality',
    slotKey: 'assay:a2.acquisition.modality',
  });
});

test('scopeWrite treats every ASSAY_SCOPED_ROOTS root as scoped', () => {
  const study = studyWith();
  for (const root of ASSAY_SCOPED_ROOTS) {
    const { path } = scopeWrite(study, `${root}.someField`, 'a1');
    assert.ok(path.startsWith('assays[0].'), `expected ${root} to be scoped, got '${path}'`);
  }
});

test('scopeWrite treats naming.fields.* as scoped but naming.template as study-level', () => {
  const study = studyWith();
  assert.equal(scopeWrite(study, 'naming.fields.modality', 'a1').path, 'assays[0].naming.fields.modality');
  assert.equal(scopeWrite(study, 'naming.template', 'a1').path, 'naming.template');
});

test('scopeWrite also scopes the BARE naming.fields container, not just a leaf field beneath it', () => {
  // Regression: isNamingFieldPath originally required a trailing '.', so
  // 'naming.fields' itself (as opposed to 'naming.fields.sample') fell
  // through as study-level and would have auto-vivified a phantom
  // naming.fields object at the study root on write -- no caller hits this
  // path today (both UI steps always write a specific leaf field), but a
  // future bulk write ('clear all naming fields') would have hit it silently.
  const study = studyWith();
  assert.deepEqual(scopeWrite(study, 'naming.fields', 'a1'), {
    path: 'assays[0].naming.fields',
    slotKey: 'assay:a1.naming.fields',
  });
});

test('scopeWrite passes a study-level path through with path === slotKey', () => {
  const study = studyWith();
  assert.deepEqual(scopeWrite(study, 'narrative.text', 'a1'), {
    path: 'narrative.text',
    slotKey: 'narrative.text',
  });
});

test('scopeWrite throws for an unknown assayId -- a caller-contract violation, not input to degrade from', () => {
  const study = studyWith();
  assert.throws(() => scopeWrite(study, 'acquisition.modality', 'ghost'), /no assay with id 'ghost'/);
});

test('scopeWrite never mutates the experiment it addresses', () => {
  const study = studyWith();
  const before = JSON.stringify(study);
  scopeWrite(study, 'acquisition.modality', 'a1');
  assert.equal(JSON.stringify(study), before);
});

// --- ASSAY_SCALAR_FIELDS: bare assay-level fields, not under a root object -

test('isAssayScopedPath recognizes label/readout/readoutText -- bare assay scalars, not container roots', () => {
  for (const field of ASSAY_SCALAR_FIELDS) {
    assert.equal(isAssayScopedPath(field), true, `expected '${field}' to be scoped`);
  }
});

test('scopeWrite scopes a bare assay scalar field (label) to the real array index, like a container root', () => {
  const study = studyWith(); // a1 at index 0, a2 at index 1
  assert.deepEqual(scopeWrite(study, 'label', 'a2'), {
    path: 'assays[1].label',
    slotKey: 'assay:a2.label',
  });
});

test('an unrelated bare study-level field (researchQuestion) is NOT swept up by the scalar-fields set', () => {
  const study = studyWith();
  assert.deepEqual(scopeWrite(study, 'researchQuestion', 'a1'), {
    path: 'researchQuestion',
    slotKey: 'researchQuestion',
  });
});

// --- seedAssayGroups ---------------------------------------------------

test('seedAssayGroups copies the given levels into a fresh assay, tagged kb-default', () => {
  const { assay, provenanceSlotKey, provenanceEntry } = seedAssayGroups(['CT', 'NAM25MM'], 'newid');
  assert.equal(assay.id, 'newid');
  assert.deepEqual(assay.design.groups.levels, ['CT', 'NAM25MM']);
  assert.equal(provenanceSlotKey, 'assay:newid.design.groups');
  assert.deepEqual(provenanceEntry, { tag: 'kb-default', detail: null });
});

test('seedAssayGroups degrades to empty groups for missing/malformed levels, never throws', () => {
  assert.deepEqual(seedAssayGroups(undefined, 'x').assay.design.groups.levels, []);
  assert.deepEqual(seedAssayGroups(null, 'x').assay.design.groups.levels, []);
  assert.deepEqual(seedAssayGroups('not-an-array', 'x').assay.design.groups.levels, []);
});

test('seedAssayGroups copies the levels array -- mutating the seeded assay must not reach back into the source', () => {
  const levels = ['CT'];
  const { assay } = seedAssayGroups(levels, 'x');
  assay.design.groups.levels.push('NEW');
  assert.deepEqual(levels, ['CT']);
});

test('seedAssayGroups otherwise mirrors emptyAssay -- specimen/panel/etc. untouched', () => {
  const { assay } = seedAssayGroups([], 'x');
  const blank = emptyAssay('x');
  assert.deepEqual(assay.specimen, blank.specimen);
  assert.deepEqual(assay.panel, blank.panel);
  assert.deepEqual(assay.naming, blank.naming);
});

// --- groupSeedLevels ---------------------------------------------------

test('groupSeedLevels prefers the active assay\'s own groups', () => {
  const active = { ...emptyAssay('a1'), design: { ...emptyAssay('a1').design, groups: { levels: ['ACTIVE'] } } };
  const other = { ...emptyAssay('a2'), design: { ...emptyAssay('a2').design, groups: { levels: ['OTHER'] } } };
  const study = studyWith({ assays: [active, other], activeAssayId: 'a1' });
  assert.deepEqual(groupSeedLevels(study), ['ACTIVE']);
});

// B4/V6-NEW-02: this used to fall back to the first OTHER assay in the study
// with groups when the active one had none. That fallback is gone --
// ui/steps/study.js's "Copy groups to measurements that have none" button is
// titled and tooltipped as copying the ACTIVE measurement's groups, so a
// silent fallback to a different, unnamed measurement's groups was a real
// (if confusing) surprise, not a feature. groupSeedLevels now reads ONLY the
// active assay; study.js disables the button instead when it has none.
test('groupSeedLevels does NOT fall back to another assay when the active one has no groups', () => {
  const active = emptyAssay('a1');
  const other = { ...emptyAssay('a2'), design: { ...emptyAssay('a2').design, groups: { levels: ['OTHER'] } } };
  const study = studyWith({ assays: [active, other], activeAssayId: 'a1' });
  assert.deepEqual(groupSeedLevels(study), []);
});

test('groupSeedLevels returns [] when no assay in the study has groups yet', () => {
  const study = studyWith({ assays: [emptyAssay('a1'), emptyAssay('a2')], activeAssayId: 'a1' });
  assert.deepEqual(groupSeedLevels(study), []);
});

// --- removeAssay ------------------------------------------------------------

test('removeAssay refuses to remove the LAST assay, returning null', () => {
  const study = studyWith({ assays: [emptyAssay('only')], activeAssayId: 'only' });
  assert.equal(removeAssay(study, 'only'), null);
});

test('removeAssay refuses an unknown id, returning null', () => {
  assert.equal(removeAssay(studyWith(), 'ghost'), null);
});

test('removeAssay drops the assay and leaves activeAssayId alone when a DIFFERENT assay was active', () => {
  const study = studyWith(); // a1 (index 0), a2 (index 1); active a1
  const result = removeAssay(study, 'a2');
  assert.deepEqual(
    result.assays.map((a) => a.id),
    ['a1']
  );
  assert.equal(result.activeAssayId, 'a1');
});

test('removeAssay reassigns activeAssayId to the PRECEDING assay when the active one is removed', () => {
  const study = studyWith({
    assays: [emptyAssay('a1'), emptyAssay('a2'), emptyAssay('a3')],
    activeAssayId: 'a2',
  });
  const result = removeAssay(study, 'a2');
  assert.deepEqual(
    result.assays.map((a) => a.id),
    ['a1', 'a3']
  );
  assert.equal(result.activeAssayId, 'a1');
});

test('removeAssay reassigns activeAssayId to the new first assay when the active FIRST assay is removed', () => {
  const study = studyWith(); // a1 (index 0) active, a2 (index 1)
  const result = removeAssay(study, 'a1');
  assert.deepEqual(
    result.assays.map((a) => a.id),
    ['a2']
  );
  assert.equal(result.activeAssayId, 'a2');
});

test('removeAssay prunes every provenance slot scoped to the removed assay, leaving other slots untouched', () => {
  const study = studyWith();
  study.provenance.slots = {
    'assay:a1.acquisition.modality': { tag: 'user', detail: null },
    'assay:a1.design.groups': { tag: 'kb-default', detail: null },
    'assay:a2.acquisition.modality': { tag: 'user', detail: null },
    'narrative.text': { tag: 'user', detail: null },
  };
  const result = removeAssay(study, 'a1');
  assert.deepEqual(result.provenance.slots, {
    'assay:a2.acquisition.modality': { tag: 'user', detail: null },
    'narrative.text': { tag: 'user', detail: null },
  });
});

test('removeAssay never mutates the experiment it reads', () => {
  const study = studyWith();
  const before = JSON.stringify(study);
  removeAssay(study, 'a2');
  assert.equal(JSON.stringify(study), before);
});
