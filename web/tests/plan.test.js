// Tests for engine/plan.js -- the ONE place a design + naming fields become
// the concrete list of filenames, shared by the Design step and the Name
// builder so the two can never drift apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_STUDY_ROWS,
  effectiveNamingFields,
  planFilenames,
  studyNameIssues,
} from '../src/engine/plan.js';
import { emptyExperiment } from '../src/core/schema.js';
import { assayView, emptyAssay } from '../src/core/assay.js';

// Mirrors ui/steps/naming.js's BASE_TEMPLATE, same reason planConfig() below
// mirrors NAMING_CONFIG as a local literal rather than an import.
const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';

// Mirrors ui/steps/naming.js's NAMING_CONFIG. Kept as a local literal rather
// than imported: naming.js is a UI module that touches `document`, and the
// engine layer must stay importable without a DOM.
function planConfig() {
  return {
    template:
      '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}',
    defaults: {
      date: '1970-01-01',
      modality: 'UNKNOWN',
      exptype: 'UNKNOWN',
      markers: 'UNKNOWN',
      magnification: 'UNKNOWN',
      sample: 'UNKNOWN',
    },
    optionalFields: ['group', 'biorep', 'techrep', 'notes'],
    uppercaseFields: ['modality', 'exptype', 'sample', 'magnification', 'markers', 'group'],
    safeCharPattern: '[^A-Za-z0-9_-]+',
  };
}

// planFilenames/effectiveNamingFields are pure v2-shaped functions that must
// never learn assays exist (schema v3's assay tier -- see core/assay.js).
// So this builds a real v3 study, sets the assay's own fields, and returns
// it through assayView() -- the SAME path ui/steps/naming.js and design.js
// use in the real app -- rather than grafting design/naming.fields/
// acquisition onto a study's root, which would silently exercise a shape
// the app never actually constructs.
function experimentWith({ design = {}, fields = {}, acquisition = {} } = {}) {
  const study = emptyExperiment();
  const assay = study.assays[0];
  assay.design = { ...assay.design, ...design };
  assay.naming.fields = fields;
  assay.acquisition = { ...assay.acquisition, ...acquisition };
  return assayView(study, study.activeAssayId);
}

// --- effectiveNamingFields: the interview/name-builder path bridge ---------

test('effectiveNamingFields fills modality from acquisition.modality when the naming field is empty', () => {
  // The interview writes modality to acquisition.modality, but the filename
  // template reads naming.fields.modality -- without this bridge the builder
  // renders 'UNKNOWN' for something the user already answered.
  const exp = experimentWith({ acquisition: { modality: 'confocal' } });
  assert.equal(effectiveNamingFields(exp).modality, 'confocal');
});

test('an explicit naming.fields.modality WINS over acquisition.modality', () => {
  const exp = experimentWith({
    fields: { modality: 'STED' },
    acquisition: { modality: 'confocal' },
  });
  assert.equal(effectiveNamingFields(exp).modality, 'STED');
});

test('effectiveNamingFields never mutates the experiment it reads', () => {
  const exp = experimentWith({ acquisition: { modality: 'confocal' } });
  const before = JSON.stringify(exp);
  effectiveNamingFields(exp);
  assert.equal(JSON.stringify(exp), before, 'the fallback must be read-time only, never a write');
});

test('effectiveNamingFields is total: a malformed experiment yields an object, not a throw', () => {
  assert.deepEqual(effectiveNamingFields(undefined), {});
  assert.deepEqual(effectiveNamingFields({}), {});
});

// --- The standalone / "tool box" case: no design at all -------------------

test('with NO design at all, planFilenames yields exactly one name built from the fields alone', () => {
  const exp = experimentWith({
    fields: {
      date: '2026-06-15',
      modality: 'CONFOCAL',
      exptype: 'IF',
      markers: 'DAPI-GFP',
      magnification: 'X40',
      sample: 'E02',
    },
  });
  const planned = planFilenames(exp, planConfig());
  assert.equal(planned.length, 1);
  assert.equal(planned[0].filename, '2026-06-15_CONFOCAL_IF_DAPI-GFP_X40_E02.tif');
});

test('with no design, a manually typed group/biorep/techrep is NOT wiped by the empty design', () => {
  // The whole point of the standalone case: the design has no opinion about
  // these axes, so the Name builder's own boxes must survive into the name.
  const exp = experimentWith({
    fields: { date: '2026-06-15', sample: 'E02', group: 'CT', biorep: 'B01', techrep: 'T03' },
  });
  const planned = planFilenames(exp, planConfig());
  assert.equal(planned.length, 1);
  assert.ok(planned[0].filename.includes('_CT_'), planned[0].filename);
  assert.ok(planned[0].filename.includes('_B01_'), planned[0].filename);
  assert.ok(planned[0].filename.includes('_T03'), planned[0].filename);
});

// --- The full-workflow case: a design drives the rows ---------------------

test('a design OVERRIDES the manual group and replicate boxes, one distinct name per row', () => {
  const exp = experimentWith({
    design: { groups: { levels: ['CT', 'NAM50MM'] }, biologicalReplicates: 2 },
    // A stale manual group/biorep that the design must win over -- otherwise
    // every row would render the same token and the names would collide.
    fields: { date: '2026-06-15', sample: 'E02', group: 'STALE', biorep: 'B09' },
  });
  const planned = planFilenames(exp, planConfig());
  assert.equal(planned.length, 4);

  const names = planned.map((p) => p.filename);
  assert.equal(new Set(names).size, 4, `expected 4 distinct names, got ${JSON.stringify(names)}`);
  assert.ok(!names.some((n) => n.includes('STALE')), 'the design must override the manual group');
  assert.ok(!names.some((n) => n.includes('B09')), 'the design must override the manual biorep');
  assert.deepEqual(names, [
    '2026-06-15_UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN_CT_E02_B01.tif',
    '2026-06-15_UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN_CT_E02_B02.tif',
    '2026-06-15_UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN_NAM50MM_E02_B01.tif',
    '2026-06-15_UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN_NAM50MM_E02_B02.tif',
  ]);
});

test('an omitted replicate axis leaves no token, even with a manual box set for the OTHER axis', () => {
  const exp = experimentWith({
    design: { groups: { levels: ['CT'] }, biologicalReplicates: 2, technicalReplicates: null },
    fields: { date: '2026-06-15', sample: 'E02' },
  });
  const names = planFilenames(exp, planConfig()).map((p) => p.filename);
  assert.ok(names.every((n) => !n.includes('_T')), `no technical token expected, got ${names}`);
  assert.ok(names.every((n) => n.includes('_B0')), `biological token expected, got ${names}`);
});

test('the modality bridge reaches the planned filenames, not just the field object', () => {
  const exp = experimentWith({
    fields: { date: '2026-06-15', sample: 'E02' },
    acquisition: { modality: 'confocal' },
  });
  const planned = planFilenames(exp, planConfig());
  // Uppercased by the config's uppercaseFields, like any other named field.
  assert.ok(planned[0].filename.includes('_CONFOCAL_'), planned[0].filename);
});

// --- Consistency and robustness ------------------------------------------

test("a row's groupLabel matches the token embedded in its own filename (lesson 49)", () => {
  // Deliberately lower-case arms: the display label and the embedded token
  // must not disagree about case for the identical value.
  const exp = experimentWith({
    design: { groups: { levels: ['ct', 'nam50mm'] } },
    fields: { date: '2026-06-15', sample: 'E02' },
  });
  for (const entry of planFilenames(exp, planConfig())) {
    assert.ok(
      entry.filename.includes(`_${entry.groupLabel}_`),
      `label '${entry.groupLabel}' is not the token in '${entry.filename}'`
    );
  }
});

test('a malformed id scheme degrades to a per-row error instead of throwing away the whole table', () => {
  const exp = experimentWith({
    design: { groups: { levels: ['CT', 'NAM50MM'] }, idScheme: '{nope}' },
    fields: { date: '2026-06-15', sample: 'E02' },
  });
  const planned = planFilenames(exp, planConfig());
  assert.equal(planned.length, 2, 'every row is still accounted for');
  for (const entry of planned) {
    assert.equal(entry.filename, null);
    assert.match(entry.error, /Unknown token/);
  }
});

test('a design that expands to zero rows plans zero names rather than throwing', () => {
  const exp = experimentWith({ design: { factors: [{ name: 'g', levels: [] }] } });
  assert.deepEqual(planFilenames(exp, planConfig()), []);
});

test('planFilenames does not mutate the experiment it plans from', () => {
  const exp = experimentWith({
    design: { groups: { levels: ['CT'] }, biologicalReplicates: 2 },
    fields: { date: '2026-06-15', sample: 'E02' },
  });
  const before = JSON.stringify(exp);
  planFilenames(exp, planConfig());
  assert.equal(JSON.stringify(exp), before);
});

// --- studyNameIssues: cross-assay collision detection ---------------------

/** A study with N assays, each given the naming.fields needed to compute a
 * base name. Distinct ids so scopeWrite-style provenance keys never clash;
 * distinct labels so a collision message names each offender. */
function studyWithAssays(fieldsPerAssay) {
  const study = emptyExperiment();
  study.assays = fieldsPerAssay.map((fields, i) => {
    const assay = emptyAssay(`a${i}`);
    assay.label = `Assay ${i + 1}`;
    assay.naming.fields = fields;
    return assay;
  });
  study.activeAssayId = study.assays[0].id;
  return study;
}

const IDENTICAL_FIELDS = {
  date: '2026-01-01',
  modality: 'confocal',
  exptype: 'CT',
  markers: 'DAPI',
  magnification: 'X40',
};

test('a single-assay study never collides (nothing to collide WITH)', () => {
  const study = studyWithAssays([IDENTICAL_FIELDS]);
  assert.deepEqual(studyNameIssues(study, planConfig(), BASE_TEMPLATE), []);
});

test('two assays with distinct exptype do not collide', () => {
  const study = studyWithAssays([
    IDENTICAL_FIELDS,
    { ...IDENTICAL_FIELDS, exptype: 'NAM50MM' },
  ]);
  assert.deepEqual(studyNameIssues(study, planConfig(), BASE_TEMPLATE), []);
});

test('two assays sharing an identical base name collide, naming both by label', () => {
  const study = studyWithAssays([IDENTICAL_FIELDS, { ...IDENTICAL_FIELDS }]);
  const issues = studyNameIssues(study, planConfig(), BASE_TEMPLATE);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'exptype');
  assert.match(issues[0].message, /Assay 1/);
  assert.match(issues[0].message, /Assay 2/);
});

test('two assays that BOTH leave exptype unset collide too -- required is subsumed by collision, not a separate rule', () => {
  // OMITTED, not set to '': an omitted field falls through to
  // config.defaults.exptype ('UNKNOWN'); an explicitly blank one renders as
  // sanitizeToken's own 'UNSPECIFIED' fallback instead -- either way, two
  // assays that both leave it unset produce the SAME base name and collide,
  // which is the actual point of this test.
  const { exptype, ...unset } = IDENTICAL_FIELDS;
  const study = studyWithAssays([unset, { ...unset }]);
  const issues = studyNameIssues(study, planConfig(), BASE_TEMPLATE);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /UNKNOWN/);
});

test('three assays colliding produce exactly ONE deduped issue, not one per pair', () => {
  const study = studyWithAssays([IDENTICAL_FIELDS, { ...IDENTICAL_FIELDS }, { ...IDENTICAL_FIELDS }]);
  const issues = studyNameIssues(study, planConfig(), BASE_TEMPLATE);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Assay 1/);
  assert.match(issues[0].message, /Assay 2/);
  assert.match(issues[0].message, /Assay 3/);
});

test('MAX_STUDY_ROWS cap fires as its own issue', () => {
  const fields = Array.from({ length: MAX_STUDY_ROWS + 1 }, (_, i) => ({
    ...IDENTICAL_FIELDS,
    exptype: `T${i}`,
  }));
  const study = studyWithAssays(fields);
  const issues = studyNameIssues(study, planConfig(), BASE_TEMPLATE);
  assert.ok(issues.some((issue) => issue.field === 'assays' && /exceeding the cap/.test(issue.message)));
});

test('studyNameIssues does not mutate the experiment it inspects', () => {
  const study = studyWithAssays([IDENTICAL_FIELDS, { ...IDENTICAL_FIELDS }]);
  const before = JSON.stringify(study);
  studyNameIssues(study, planConfig(), BASE_TEMPLATE);
  assert.equal(JSON.stringify(study), before);
});
