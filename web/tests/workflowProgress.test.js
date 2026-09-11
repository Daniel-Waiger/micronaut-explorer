import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { checkConformance } from '../src/engine/conformance.js';
import { decisionTriage } from '../src/engine/decisionTriage.js';
import { buildExperimentMap } from '../src/engine/experimentMap.js';
import { measurementStatus } from '../src/engine/measurementStatus.js';
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
  // An explicit observational study never has group levels by design, so the
  // Measurements step must not be capped at in-progress waiting for an axis
  // this study deliberately does not have.
  assert.equal(primaryStep(completed, 'study').state, 'complete');
  assert.deepEqual(completed, progress(observational), 'Study-map progress must remain deterministic for the same completed data');
});

test('an observational study with no assay content is still in-progress, and a groups study with no levels never completes', () => {
  const bareObservational = orient(emptyExperiment(), 'observational');
  bareObservational.assays[0].label = '';
  bareObservational.assays[0].readout = '';
  bareObservational.assays[0].readoutText = '';
  assert.equal(primaryStep(progress(bareObservational), 'study').state, 'in-progress');

  const groupsNoLevels = orient(emptyExperiment(), 'groups');
  groupsNoLevels.assays[0].design.groups.levels = [];
  assert.notEqual(primaryStep(progress(groupsNoLevels), 'study').state, 'complete');

  const notDecidedNoLevels = orient(emptyExperiment(), 'not-decided');
  notDecidedNoLevels.assays[0].design.groups.levels = [];
  assert.notEqual(primaryStep(progress(notDecidedNoLevels), 'study').state, 'complete');
});

test('Measurements progress keeps its existing study-wide content and cross-assay conformance behavior', () => {
  const study = emptyExperiment();
  study.researchQuestion = 'Does the coating reduce bacterial load?';
  assert.equal(primaryStep(progress(study), 'study').state, 'in-progress');

  study.assays[0].design.groups.levels = ['CTL', 'OPP'];
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

test('a fully oriented, conformance-ready OBSERVATIONAL study reaches 5/5, with no group levels anywhere', () => {
  const study = readyDefaultStudy();
  study.studyContext = { ...study.studyContext, comparisonMode: 'observational' };
  for (const assay of study.assays) {
    // An observational study never has group levels; assays whose only
    // design content was the seeded group axis need a different design fact
    // (here biological replicates) so this test isolates the comparisonMode
    // gate rather than accidentally re-requiring groups through design.
    assay.design.groups.levels = [];
    if (!Array.isArray(assay.design.factors) || assay.design.factors.length === 0) {
      assay.design.biologicalReplicates = 3;
    }
    // readoutText and naming.fields.sample are seeded 'kb-default' (a weak
    // tag), which phaseProgress does not count as confirmed; tag them 'user'
    // so this fixture can reach every step, the same way the single-assay
    // 'confirmed phase fields' test above does.
    study.provenance.slots[`assay:${assay.id}.readoutText`] = { tag: 'user', detail: null };
    study.provenance.slots[`assay:${assay.id}.naming.fields.sample`] = { tag: 'user', detail: null };
  }

  const result = progress(study);
  assert.equal(result.map.comparison.mode, 'observational');
  assert.equal(primaryStep(result, 'study').state, 'complete');
  assert.equal(primaryStep(result, 'overview').state, 'complete');
  assert.equal(result.summary.complete, 5);
  assert.equal(result.summary.state, 'complete');
});

test('workflow progress is deterministic and total for malformed input', () => {
  assert.doesNotThrow(() => deriveWorkflowProgress(null, null, null));
  assert.deepEqual(
    deriveWorkflowProgress(null, null, null),
    deriveWorkflowProgress(null, null, null)
  );
});

test('deriveWorkflowProgress({}, { readiness: "ready", assays: [] }) does not throw', () => {
  assert.doesNotThrow(() => deriveWorkflowProgress({}, { readiness: 'ready', assays: [] }));
});

// AUD-07: each per-assay `status` is wired straight from a single
// decisionTriage(map, conformance) pass plus this assay's own
// map.measurements entry -- these tests assert that WIRING, not a
// reimplementation of measurementStatus's own rules (AUD-06 owns those).
test("assays[i].status equals measurementStatus recomputed from decisionTriage(result.map, conformance) and this assay's own map measurement", () => {
  const study = createDefaultStudy();
  study.assays[0].design.groups.levels = ['CTL', 'OPP'];
  const conformance = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const result = deriveWorkflowProgress(study, conformance, QUESTIONS);

  assert.ok(result.assays.length > 0, 'sanity: fixture has assays to check');
  const triage = decisionTriage(result.map, conformance);
  const measurementsById = new Map(result.map.measurements.map((measurement) => [measurement.id, measurement]));
  for (const assay of result.assays) {
    const expected = measurementStatus(measurementsById.get(assay.id), { decisions: triage, conformance });
    assert.deepEqual(assay.status, expected);
  }
});

test('an assay whose id has no entry in map.measurements still gets measurementStatus\'s total fallback record', () => {
  const study = createDefaultStudy();
  // A blank id is exactly the case experimentMap.js's validAssays (:57-66)
  // filters out of map.measurements entirely, while workflowProgress's own
  // `assays` array (built straight from exp.assays) still carries it -- the
  // real-world way an assay id can be absent from the map.
  study.assays[0].id = '';
  const conformance = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const result = deriveWorkflowProgress(study, conformance, QUESTIONS);

  assert.equal(
    result.map.measurements.some((measurement) => measurement.id === ''),
    false,
    'sanity: the map really has no entry for the blank id'
  );
  const triage = decisionTriage(result.map, conformance);
  assert.deepEqual(result.assays[0].status, measurementStatus(undefined, { decisions: triage, conformance }));
});

test('regression-pin: adding assays[i].status leaves assays[i].state and summary unchanged', () => {
  const study = createDefaultStudy();
  const [valid, invalid] = study.assays;
  valid.design.groups.levels = ['CTL', 'OPP'];
  invalid.design.groups.levels = ['CTL', 'CTL'];

  const result = progress(study);
  assert.deepEqual(
    result.assays.map((assay) => assay.state),
    ['needs-attention', 'needs-attention', 'needs-attention', 'needs-attention']
  );
  assert.deepEqual(result.summary, { complete: 2, total: 5, state: 'needs-attention' });
  for (const assay of result.assays) {
    assert.equal(typeof assay.state, 'string', 'state stays the pre-existing string vocabulary');
    assert.equal(typeof assay.status, 'object', 'status is the new, additive record');
  }
});
