// Tests for core/assay.js -- the ONE module allowed to know assays exist.
// assayView must produce a synthetic flat experiment indistinguishable
// (to a v2-shaped consumer) from a real v2 Experiment; scopeWrite must
// never let a write land in the wrong assay or a phantom root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSAY_SCOPED_ROOTS,
  assayById,
  assayIndexById,
  assayView,
  emptyAssay,
  firstAssayId,
  scopeWrite,
} from '../src/core/assay.js';

function studyWith(overrides = {}) {
  return {
    schemaVersion: 3,
    meta: { id: null, createdAt: null, updatedAt: null, title: '' },
    researchQuestion: '',
    narrative: { text: '', history: [] },
    armVocabulary: { levels: [] },
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
