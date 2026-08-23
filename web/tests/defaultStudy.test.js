// Tests for core/defaultStudy.js -- the real oregano-study seed a brand-new
// session opens with. Every populated field must be WEAK ('kb-default')
// tagged, never STRONG, so a real user edit always wins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { studyNameIssues } from '../src/engine/plan.js';
import { readoutState } from '../src/engine/controls.js';

// Mirrors web/kb/readouts.json's table shape ({ canonical: { label, aliases } }),
// enough for readoutState to resolve the seeded readoutText values to 'known'.
const READOUTS_TABLE = {
  'bacterial-viability': { label: 'Bacterial viability', aliases: [] },
  'macrophage-cytoskeleton': { label: 'Macrophage cytoskeleton', aliases: [] },
  ros: { label: 'Intracellular ROS', aliases: [] },
  'scratch-migration': { label: 'Scratch / migration', aliases: [] },
};

const NAMING_CONFIG = {
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
const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';

test('createDefaultStudy returns a v4 study with 4 assays', () => {
  const study = createDefaultStudy();
  assert.equal(study.schemaVersion, 4);
  assert.equal(study.assays.length, 4);
  assert.equal(study.meta.origin, 'example');
});

test('the research question and group vocabulary are the real oregano-study values', () => {
  const study = createDefaultStudy();
  assert.match(study.researchQuestion, /RF-PECVD/);
  assert.match(study.researchQuestion, /oregano/);
  assert.deepEqual(study.groupVocabulary.levels, ['CTL', 'OPP']);
});

test('activeAssayId resolves to a real entry in assays (the first one)', () => {
  const study = createDefaultStudy();
  assert.equal(study.activeAssayId, study.assays[0].id);
});

test('the 4 assays carry the expected labels, in order', () => {
  const study = createDefaultStudy();
  assert.deepEqual(
    study.assays.map((a) => a.label),
    ['Bacterial viability', 'Macrophage cytoskeleton', 'Intracellular ROS', 'Scratch / migration']
  );
});

test('every assay gets the CTL/OPP group axis', () => {
  const study = createDefaultStudy();
  for (const assay of study.assays) {
    assert.deepEqual(assay.design.groups.levels, ['CTL', 'OPP']);
  }
});

test('only the assays with a real paper sub-group get a crossing factor', () => {
  const [viability, cytoskeleton, ros, scratch] = createDefaultStudy().assays;
  assert.deepEqual(viability.design.factors, [
    { name: 'species', levels: ['PAERUGINOSA', 'SAUREUS'] },
  ]);
  assert.deepEqual(ros.design.factors, [{ name: 'stimulation', levels: ['UNSTIM', 'LPS'] }]);
  assert.deepEqual(cytoskeleton.design.factors, []);
  assert.deepEqual(scratch.design.factors, []);
});

test('each assay carries its real markers and exptype', () => {
  const [viability, cytoskeleton, ros, scratch] = createDefaultStudy().assays;
  assert.equal(viability.naming.fields.markers, 'SYTO9-PROPIDIUM IODIDE');
  assert.equal(viability.naming.fields.exptype, 'VIABILITY');
  assert.equal(cytoskeleton.naming.fields.markers, 'PHALLOIDIN-DAPI');
  assert.equal(cytoskeleton.naming.fields.exptype, 'CYTOSKELETON');
  assert.equal(ros.naming.fields.markers, 'DCF-DAPI');
  assert.equal(ros.naming.fields.exptype, 'ROS');
  assert.equal(scratch.naming.fields.markers, 'NONE');
  assert.equal(scratch.naming.fields.exptype, 'SCRATCH');
});

test('the 4 exptype values are pairwise distinct, so the seed never trips studyNameIssues out of the box', () => {
  const study = createDefaultStudy();
  const exptypes = study.assays.map((a) => a.naming.fields.exptype);
  assert.equal(new Set(exptypes).size, exptypes.length);
  assert.deepEqual(studyNameIssues(study, NAMING_CONFIG, BASE_TEMPLATE), []);
});

test('every populated field is tagged kb-default (WEAK), never a STRONG tag', () => {
  const study = createDefaultStudy();
  const slots = study.provenance.slots;
  assert.ok(Object.keys(slots).length > 0);
  for (const [key, slot] of Object.entries(slots)) {
    assert.equal(slot.tag, 'kb-default', `slot '${key}' expected to be tagged kb-default`);
  }
});

test('every seeded assay field has a matching provenance slot at assay:<id>.<path>', () => {
  const study = createDefaultStudy();
  for (const assay of study.assays) {
    assert.equal(study.provenance.slots[`assay:${assay.id}.design.groups`].tag, 'kb-default');
    assert.equal(study.provenance.slots[`assay:${assay.id}.acquisition.modality`].tag, 'kb-default');
    assert.equal(study.provenance.slots[`assay:${assay.id}.naming.fields.markers`].tag, 'kb-default');
    assert.equal(study.provenance.slots[`assay:${assay.id}.naming.fields.exptype`].tag, 'kb-default');
  }
});

test('researchQuestion and groupVocabulary have their own study-level provenance slots', () => {
  const study = createDefaultStudy();
  assert.equal(study.provenance.slots.researchQuestion.tag, 'kb-default');
  assert.equal(study.provenance.slots.groupVocabulary.tag, 'kb-default');
});

test('two calls to createDefaultStudy produce independent assay ids and object identity', () => {
  const a = createDefaultStudy();
  const b = createDefaultStudy();
  assert.notEqual(a.assays[0].id, b.assays[0].id);
  assert.notEqual(a, b);
  assert.notEqual(a.assays, b.assays);
});

test('every assay is seeded with a recognized readout, so the example study is not "not answered yet"', () => {
  const study = createDefaultStudy();
  const expected = {
    'Bacterial viability': 'bacterial-viability',
    'Macrophage cytoskeleton': 'macrophage-cytoskeleton',
    'Intracellular ROS': 'ros',
    'Scratch / migration': 'scratch-migration',
  };
  for (const assay of study.assays) {
    assert.equal(assay.readout, expected[assay.label], `${assay.label} canonical readout`);
    assert.equal(
      readoutState(assay.readoutText, READOUTS_TABLE),
      'known',
      `${assay.label} readoutText resolves to a known readout`
    );
    assert.equal(study.provenance.slots[`assay:${assay.id}.readout`].tag, 'kb-default');
  }
});
