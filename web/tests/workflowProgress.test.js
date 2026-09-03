import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { checkConformance } from '../src/engine/conformance.js';
import { buildExperimentMap } from '../src/engine/experimentMap.js';
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

function primaryStep(result, id) {
  return result.primary.find((step) => step.id === id);
}

function orient(study, comparisonMode = 'groups') {
  study.researchQuestion = 'How does water availability affect root architecture?';
  study.studyContext = {
    system: 'tomato seedlings in soil',
    experimentalUnit: 'one independently grown seedling',
    comparisonMode,
  };
  study.groupVocabulary.levels = comparisonMode === 'groups' ? ['well-watered', 'drought'] : [];
  study.assays[0].label = 'Root architecture';
  study.assays[0].readout = 'root-architecture';
  study.assays[0].readoutText = 'Root architecture';
  study.assays[0].design.groups.levels = comparisonMode === 'groups' ? ['well-watered', 'drought'] : [];
  return study;
}

function readyDefaultStudy() {
  const study = createDefaultStudy();
  for (const [index, assay] of study.assays.entries()) {
    assay.naming = {
      fields: {
        ...assay.naming.fields,
        date: '2026-08-23',
        sample: `ORA${String(index + 1).padStart(2, '0')}`,
        ...(assay.label === 'Scratch / migration' ? { magnification: 'X10' } : {}),
      },
    };
  }
  return study;
}

test('defines the five labelled routes separately from the excluded Guide route', () => {
  assert.deepEqual(PRIMARY_WORKFLOW.map(({ id, label }) => ({ id, label })), [
    { id: 'home', label: 'Study map' },
    { id: 'describe', label: 'Research brief' },
    { id: 'study', label: 'Measurements' },
    { id: 'measurement', label: 'Measurement' },
    { id: 'overview', label: 'Review' },
  ]);
  assert.deepEqual(OPTIONAL_WORKFLOW.map((step) => step.id), ['guide']);
  assert.equal(deriveWorkflowProgress({}, { readiness: 'ready', assays: [] }).summary.total, 5);
});

// design/microscopy/naming are sections of one page now, but they remain
// individually addressable per assay: the guided walkthrough and the per-assay
// tree still speak about them by name, and `measurement` is their aggregate.
test('the measurement route aggregates its three sections without losing them', () => {
  const result = progress(emptyExperiment());
  const assay = result.assays[0];
  for (const section of ['design', 'microscopy', 'naming']) {
    assert.ok(assay.steps[section], `${section} remains addressable`);
  }
  // The aggregate is exactly its parts' aggregate -- needs-attention wins,
  // then in-progress, and complete only when all three are.
  const sections = [assay.steps.design.state, assay.steps.microscopy.state, assay.steps.naming.state];
  const expected = sections.includes('needs-attention')
    ? 'needs-attention'
    : sections.every((state) => state === 'complete')
      ? 'complete'
      : sections.includes('in-progress') ? 'in-progress' : 'not-started';
  assert.equal(assay.steps.measurement.state, expected);
  assert.equal(primaryStep(result, 'measurement').state, expected);
});

test('an empty Study map is not started, while its incomplete readiness is routed through conformance', () => {
  const result = progress(emptyExperiment());
  const assay = result.assays[0];
  assert.equal(primaryStep(result, 'home').state, 'not-started');
  assert.equal(result.primary.find((step) => step.id === 'study').state, 'not-started');
  assert.equal(assay.steps.project.state, 'not-started');
  assert.equal(assay.steps.design.state, 'not-started');
  assert.equal(assay.steps.microscopy.state, 'not-started');
  assert.equal(assay.steps.overview.state, 'needs-attention');
  assert.equal(result.primary.find((step) => step.id === 'overview').readiness, 'needs-review');
});

test('Study-map progress follows orientation transitions, including observational studies', () => {
  const study = emptyExperiment();
  assert.equal(primaryStep(progress(study), 'home').state, 'not-started');

  study.researchQuestion = 'Does the coating reduce bacterial load?';
  assert.equal(primaryStep(progress(study), 'home').state, 'in-progress');

  const observational = orient(emptyExperiment(), 'observational');
  const completed = progress(observational);
  assert.equal(completed.map.comparison.mode, 'observational');
  assert.equal(completed.map.comparison.state, 'answered');
  assert.equal(primaryStep(completed, 'home').state, 'complete');
  assert.deepEqual(completed, progress(observational), 'Study-map progress must remain deterministic for the same completed data');
});

test('Measurements progress keeps its existing study-wide content and cross-assay conformance behavior', () => {
  const study = emptyExperiment();
  study.researchQuestion = 'Does the coating reduce bacterial load?';
  assert.equal(primaryStep(progress(study), 'study').state, 'in-progress');

  study.groupVocabulary.levels = ['CTL', 'OPP'];
  study.assays[0].label = 'Bacterial viability';
  assert.equal(primaryStep(progress(study), 'study').state, 'complete');
});

test('Measurements consumes cross-assay conformance issues as needs-attention without recreating that validator', () => {
  const study = createDefaultStudy();
  study.assays[1].acquisition.modality = study.assays[0].acquisition.modality;
  study.assays[1].naming.fields = { ...study.assays[0].naming.fields };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.ok(report.crossAssayIssues.length > 0, 'sanity: conformance must produce the study-wide issue');
  assert.equal(primaryStep(deriveWorkflowProgress(study, report, QUESTIONS), 'study').state, 'needs-attention');
});

test('progress carries the single map snapshot by value without recomputing its next decision', () => {
  const study = orient(emptyExperiment());
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const result = deriveWorkflowProgress(study, report, QUESTIONS);

  assert.deepEqual(result.map, buildExperimentMap(study, { conformance: report }));
  assert.equal(result.map.nextDecision, result.map.decisions[0]);
  assert.equal(result.map.nextDecision.id, `biological-replicates:${study.assays[0].id}`);
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
  assert.equal(result.summary.total, 5);
});

test('multi-measurement progress retains distinct assay states and surfaces an invalid design as needs-attention', () => {
  const study = createDefaultStudy();
  const [valid, invalid] = study.assays;
  valid.design.groups.levels = ['CTL', 'OPP'];
  invalid.design.groups.levels = ['CTL', 'CTL'];

  const result = progress(study);
  assert.equal(result.assays.length, 4);
  assert.equal(result.map.measurements.length, 4);
  assert.equal(result.assays[0].steps.design.state, 'complete');
  assert.equal(result.assays[1].steps.design.state, 'needs-attention');
  // One bad design surfaces on the composed Measurement route, since that is
  // the route that now owns Samples & design.
  assert.equal(result.primary.find((step) => step.id === 'measurement').state, 'needs-attention');
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

test('a fully oriented, conformance-ready study reports both Study-map and Review completion', () => {
  const study = readyDefaultStudy();
  const result = progress(study);

  assert.equal(result.map.orientation.state, 'answered');
  assert.match(result.map.nextDecision.id, /^biological-replicates:/);
  assert.equal(primaryStep(result, 'home').state, 'complete');
  assert.equal(primaryStep(result, 'overview').state, 'complete');
  assert.equal(primaryStep(result, 'overview').readiness, 'ready');
});

test('workflow progress is deterministic and total for malformed input', () => {
  assert.doesNotThrow(() => deriveWorkflowProgress(null, null, null));
  assert.deepEqual(
    deriveWorkflowProgress(null, null, null),
    deriveWorkflowProgress(null, null, null)
  );
});
