import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { checkConformance } from '../src/engine/conformance.js';
import { PRIMARY_WORKFLOW } from '../src/engine/workflowProgress.js';
import { buildGuidedExampleContent, getGuidedExampleStep } from '../src/engine/guidedExample.js';
import { BASE_TEMPLATE, NAMING_CONFIG, realKb } from './fixtures.js';

function options() {
  return {
    primaryWorkflow: PRIMARY_WORKFLOW,
    kb: realKb(),
    namingConfig: NAMING_CONFIG,
    baseTemplate: BASE_TEMPLATE,
  };
}

function byStep(content, id) {
  return content.steps.find((step) => step.stepId === id);
}

test('all five contexts use the real default-study document and conformance projections', () => {
  const study = createDefaultStudy();
  const settings = options();
  const expectedDocument = buildStudyDocument(study, settings.kb, NAMING_CONFIG, BASE_TEMPLATE);
  const expectedConformance = checkConformance(study, settings.kb, NAMING_CONFIG, BASE_TEMPLATE);
  const content = buildGuidedExampleContent(study, settings);

  assert.deepEqual(content.studyDocument, expectedDocument);
  assert.deepEqual(content.conformance, expectedConformance);
  assert.deepEqual(content.steps.map((step) => step.stepId), PRIMARY_WORKFLOW.map((step) => step.id));
  assert.deepEqual(content.steps.map((step) => step.stepId), [
    'home', 'describe', 'study', 'measurement', 'overview',
  ]);
  assert.equal(content.steps.length, 5);

  for (const [index, step] of content.steps.entries()) {
    for (const key of ['stepId', 'title', 'outcome', 'what', 'why', 'when', 'how', 'exampleLabel', 'exampleSummary', 'tryThis']) {
      assert.ok(typeof step[key] === 'string' && step[key].trim(), `${step.stepId} missing ${key}`);
    }
    assert.equal(step.exampleLabel, 'In this example');
    assert.equal(step.nextStepId, PRIMARY_WORKFLOW[index + 1]?.id || null);
    assert.equal(step.nextTitle, PRIMARY_WORKFLOW[index + 1]?.label || null);
    assert.deepEqual(step.facts.study, expectedDocument.study);
    assert.deepEqual(step.facts.activeAssay, expectedDocument.assays[0]);
    assert.deepEqual(step.facts.conformance, expectedConformance);
  }

  assert.match(byStep(content, 'describe').exampleSummary, new RegExp(expectedDocument.assays[0].readout.label));
  // One composed measurement context now carries all three sections' facts.
  const measurementSummary = byStep(content, 'measurement').exampleSummary;
  assert.match(measurementSummary, new RegExp(String(expectedDocument.assays[0].design.conditionCount)));
  assert.match(measurementSummary, new RegExp(expectedDocument.assays[0].modality));
  assert.match(measurementSummary, new RegExp(expectedDocument.assays[0].filenames[0].filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(byStep(content, 'overview').exampleSummary, new RegExp(expectedConformance.readiness));
  assert.match(byStep(content, 'study').exampleSummary, /Comparison labels: CTL, OPP/);
  assert.match(byStep(content, 'measurement').exampleSummary, /groups CTL, OPP/);
  assert.doesNotMatch(JSON.stringify(content.steps), /\barms?\b/i);
  assert.equal(byStep(content, 'home').title, 'Study map');
  assert.equal(byStep(content, 'describe').title, 'Research brief');
  assert.equal(byStep(content, 'study').title, 'Measurements');
  assert.equal(byStep(content, 'measurement').title, 'Measurement');
  assert.equal(byStep(content, 'overview').title, 'Review');
  assert.match(byStep(content, 'home').why, /study contains measurements; each measurement then has its own Samples & design, Acquisition, and Data plan/i);
});

test('active-assay contexts refresh while Home and Study remain whole-study coherent', () => {
  const study = createDefaultStudy();
  const settings = options();
  const first = buildGuidedExampleContent(study, settings);
  study.activeAssayId = study.assays[2].id;
  const switched = buildGuidedExampleContent(study, settings);

  for (const id of ['describe', 'measurement']) {
    assert.notEqual(byStep(first, id).exampleSummary, byStep(switched, id).exampleSummary, `${id} should follow active assay`);
  }
  assert.equal(byStep(first, 'home').exampleSummary, byStep(switched, 'home').exampleSummary);
  assert.equal(byStep(first, 'study').exampleSummary, byStep(switched, 'study').exampleSummary);
  assert.equal(byStep(switched, 'describe').facts.activeAssay.label, 'Intracellular ROS');
});

test('a fresh call reflects current producer values rather than cached guide text', () => {
  const study = createDefaultStudy();
  const settings = options();
  const before = buildGuidedExampleContent(study, settings);
  study.assays[0].naming.fields.exptype = 'FRESH_VALUE';
  const after = buildGuidedExampleContent(study, settings);

  assert.notEqual(byStep(before, 'measurement').exampleSummary, byStep(after, 'measurement').exampleSummary);
  assert.match(byStep(after, 'measurement').exampleSummary, /FRESH_VALUE/);
  assert.equal(getGuidedExampleStep(study, 'measurement', settings).exampleSummary, byStep(after, 'measurement').exampleSummary);
});

test('guided copy is presentation-only and never mutates the supplied study', () => {
  const study = createDefaultStudy();
  const before = JSON.stringify(study);
  buildGuidedExampleContent(study, options());
  assert.equal(JSON.stringify(study), before);
});

test('malformed input is total and uses study-now wording outside explicit example origin', () => {
  const settings = options();
  for (const malformed of [undefined, null, {}, 'not a study', 42]) {
    assert.doesNotThrow(() => buildGuidedExampleContent(malformed, settings));
    const content = buildGuidedExampleContent(malformed, settings);
    assert.equal(content.steps.length, 5);
    for (const step of content.steps) {
      assert.equal(step.exampleLabel, 'In this study now');
      assert.ok(step.exampleSummary);
    }
  }
});
