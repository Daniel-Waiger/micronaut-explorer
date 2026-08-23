import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { checkConformance } from '../src/engine/conformance.js';
import { deriveWorkflowProgress, OPTIONAL_WORKFLOW, PRIMARY_WORKFLOW } from '../src/engine/workflowProgress.js';
import { BASE_TEMPLATE, NAMING_CONFIG, realKb } from './fixtures.js';

const QUESTIONS = [
  { id: 'readout', field: 'readoutText', phase: 'project', priority: 1 },
  { id: 'sample', field: 'naming.fields.sample', phase: 'microscopy', priority: 2 },
];

function progress(experiment) {
  return deriveWorkflowProgress(
    experiment,
    checkConformance(experiment, realKb(), NAMING_CONFIG, BASE_TEMPLATE),
    QUESTIONS
  );
}

test('defines the seven ordered primary stages separately from optional Guide', () => {
  assert.deepEqual(PRIMARY_WORKFLOW.map((step) => step.id), [
    'home', 'describe', 'study', 'design', 'microscopy', 'naming', 'overview',
  ]);
  assert.deepEqual(OPTIONAL_WORKFLOW.map((step) => step.id), ['guide']);
  assert.equal(deriveWorkflowProgress({}, { readiness: 'ready', assays: [] }).summary.total, 7);
});

test('a blank study is not started, while its incomplete readiness is routed through conformance', () => {
  const result = progress(emptyExperiment());
  const assay = result.assays[0];
  assert.equal(result.primary.find((step) => step.id === 'study').state, 'not-started');
  assert.equal(assay.steps.project.state, 'not-started');
  assert.equal(assay.steps.design.state, 'not-started');
  assert.equal(assay.steps.microscopy.state, 'not-started');
  assert.equal(assay.steps.overview.state, 'needs-attention');
  assert.equal(result.primary.find((step) => step.id === 'overview').readiness, 'needs-review');
});

test('Study becomes in-progress for partial study shape, then complete once it has a question, groups, and assay content', () => {
  const study = emptyExperiment();
  study.researchQuestion = 'Does the coating reduce bacterial load?';
  assert.equal(progress(study).primary.find((step) => step.id === 'study').state, 'in-progress');

  study.groupVocabulary.levels = ['CTL', 'OPP'];
  study.assays[0].label = 'Bacterial viability';
  const completed = progress(study);
  assert.equal(completed.primary.find((step) => step.id === 'study').state, 'complete');
  assert.deepEqual(completed, progress(study), 'Study progress must remain deterministic for the same completed data');
});

test('Study consumes cross-assay conformance issues as needs-attention without recreating that validator', () => {
  const study = createDefaultStudy();
  study.assays[1].acquisition.modality = study.assays[0].acquisition.modality;
  study.assays[1].naming.fields = { ...study.assays[0].naming.fields };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.ok(report.crossAssayIssues.length > 0, 'sanity: conformance must produce the study-wide issue');
  assert.equal(deriveWorkflowProgress(study, report, QUESTIONS).primary.find((step) => step.id === 'study').state, 'needs-attention');
});

test('confirmed phase fields and a valid design advance each assay without making Guide required', () => {
  const study = emptyExperiment();
  const assay = study.assays[0];
  assay.readoutText = 'Viability';
  assay.naming.fields.sample = 'ABC01';
  assay.design.groups.levels = ['CTL', 'OPP'];
  study.provenance.slots[`assay:${assay.id}.readoutText`] = { tag: 'user', detail: null };
  study.provenance.slots[`assay:${assay.id}.naming.fields.sample`] = { tag: 'user', detail: null };

  const result = progress(study);
  assert.equal(result.assays[0].steps.project.state, 'complete');
  assert.equal(result.assays[0].steps.microscopy.state, 'complete');
  assert.equal(result.assays[0].steps.design.state, 'complete');
  assert.equal(result.optional[0].id, 'guide');
  assert.equal(result.summary.total, 7);
});

test('progress distinguishes two assay states and surfaces an invalid design as needs-attention', () => {
  const study = createDefaultStudy();
  const [valid, invalid] = study.assays;
  valid.design.groups.levels = ['CTL', 'OPP'];
  invalid.design.groups.levels = ['CTL', 'CTL'];

  const result = progress(study);
  assert.equal(result.assays.length, 4);
  assert.equal(result.assays[0].steps.design.state, 'complete');
  assert.equal(result.assays[1].steps.design.state, 'needs-attention');
  assert.equal(result.primary.find((step) => step.id === 'design').state, 'needs-attention');
});

test('overview state consumes report readiness rather than reclassifying issue details', () => {
  const study = emptyExperiment();
  const report = {
    readiness: 'blocked',
    assays: [{ id: study.assays[0].id, readiness: 'blocked', issues: [] }],
  };
  const result = deriveWorkflowProgress(study, report, QUESTIONS);
  assert.equal(result.assays[0].steps.overview.state, 'needs-attention');
  assert.equal(result.primary.find((step) => step.id === 'overview').state, 'needs-attention');
  assert.equal(result.primary.find((step) => step.id === 'overview').readiness, 'blocked');
});

test('workflow progress is deterministic and total for malformed input', () => {
  assert.doesNotThrow(() => deriveWorkflowProgress(null, null, null));
  assert.deepEqual(
    deriveWorkflowProgress(null, null, null),
    deriveWorkflowProgress(null, null, null)
  );
});
