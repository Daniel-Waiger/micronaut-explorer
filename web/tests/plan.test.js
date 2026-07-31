// Tests for engine/plan.js -- the ONE place a design + naming fields become
// the concrete list of filenames, shared by the Design step and the Name
// builder so the two can never drift apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveNamingFields, planFilenames } from '../src/engine/plan.js';
import { emptyExperiment } from '../src/core/schema.js';

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

function experimentWith({ design = {}, fields = {}, acquisition = {} } = {}) {
  const exp = emptyExperiment();
  exp.design = { ...exp.design, ...design };
  exp.naming.fields = fields;
  exp.acquisition = { ...exp.acquisition, ...acquisition };
  return exp;
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
