import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentMap } from '../src/engine/experimentMap.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { emptyExperiment } from '../src/core/schema.js';

function orient(study, values = {}) {
  study.researchQuestion = values.question ?? 'How does water availability affect root architecture?';
  study.studyContext = {
    system: values.system ?? 'tomato seedlings in soil',
    experimentalUnit: values.experimentalUnit ?? 'one independently grown seedling',
    comparisonMode: values.comparisonMode ?? 'groups',
  };
  return study;
}

function defineMeasurement(assay, values = {}) {
  assay.label = values.label ?? 'Root architecture';
  assay.readout = values.readout ?? 'root-architecture';
  assay.readoutText = values.readoutText ?? 'Root architecture';
  assay.specimen = {
    ...assay.specimen,
    organism: values.organism ?? 'tomato seedlings',
    sampleType: values.sampleType ?? '',
  };
  assay.design = {
    ...assay.design,
    groups: { levels: values.assayGroups ?? ['well-watered', 'drought'] },
    biologicalReplicates: Object.hasOwn(values, 'biologicalReplicates') ? values.biologicalReplicates : 4,
    technicalReplicates: Object.hasOwn(values, 'technicalReplicates') ? values.technicalReplicates : 1,
  };
  assay.acquisition = { ...assay.acquisition, modality: values.modality ?? 'root imaging' };
  return assay;
}

function decisionIds(map) {
  return map.decisions.map((item) => item.id);
}

const ROUTE_IDS = new Set(['home', 'describe', 'study', 'design', 'panel', 'naming', 'overview', 'guide']);

function assertRealRoutes(map) {
  assert.ok(map.decisions.every((item) => ROUTE_IDS.has(item.routeId)));
}

test('empty v5 study produces the fixed first-run decision order and no mutation', () => {
  const study = emptyExperiment();
  const before = structuredClone(study);
  const map = buildExperimentMap(study);

  assert.deepEqual(map.question, { value: '', state: 'missing' });
  assert.deepEqual(map.system, { value: '', state: 'missing' });
  assert.deepEqual(map.comparison, { mode: 'not-decided', groups: [], state: 'missing' });
  assert.deepEqual(map.experimentalUnit, { value: '', state: 'missing' });
  assert.equal(map.measurements.length, 1);
  assert.equal(map.measurements[0].state, 'missing');
  assert.deepEqual(map.orientation, { answered: 0, total: 5, state: 'missing' });
  assert.deepEqual(decisionIds(map), [
    'research-question',
    'system',
    'comparison-mode',
    `measurement-definition:${study.assays[0].id}`,
    'experimental-unit',
    `biological-replicates:${study.assays[0].id}`,
    `modality:${study.assays[0].id}`,
  ]);
  assert.equal(map.nextDecision.id, 'research-question');
  assert.ok(map.decisions.every((item) => item.source === undefined));
  assertRealRoutes(map);
  assert.deepEqual(study, before);
});

test('the seeded oregano example projects a fully oriented measurement map', () => {
  const study = createDefaultStudy();
  const map = buildExperimentMap(study);

  assert.equal(map.orientation.state, 'answered');
  assert.deepEqual(map.orientation, { answered: 5, total: 5, state: 'answered' });
  assert.equal(map.comparison.state, 'answered');
  assert.deepEqual(map.measurements.map((measurement) => measurement.label), [
    'Bacterial viability',
    'Macrophage cytoskeleton',
    'Intracellular ROS',
    'Scratch / migration',
  ]);
  assert.ok(map.measurements.every((measurement) => measurement.state === 'answered'));
  assert.ok(map.measurements.every((measurement) => measurement.specimenSummary));
  assertRealRoutes(map);
});

test('groups require a per-measurement group definition, while observational does not', () => {
  const study = orient(emptyExperiment());
  defineMeasurement(study.assays[0], { assayGroups: [] });

  let map = buildExperimentMap(study);
  assert.deepEqual(decisionIds(map), [`measurement-groups:${study.assays[0].id}`]);

  study.studyContext.comparisonMode = 'observational';
  map = buildExperimentMap(study);
  assert.equal(map.comparison.state, 'answered');
  assert.deepEqual(decisionIds(map), []);
  assertRealRoutes(map);
});

test('skipped and provisional orientation values remain visible decisions rather than blocking navigation', () => {
  const study = orient(emptyExperiment());
  defineMeasurement(study.assays[0]);
  study.studyContext.system = '';
  study.studyContext.experimentalUnit = '';
  study.provenance.skipped = ['system', 'experimental-unit'];
  study.provenance.slots.researchQuestion = { tag: 'llm', detail: 'drafted from prose' };

  const map = buildExperimentMap(study);
  assert.equal(map.question.state, 'provisional');
  assert.equal(map.system.state, 'provisional');
  assert.equal(map.experimentalUnit.state, 'provisional');
  assert.equal(map.orientation.state, 'provisional');
  assert.deepEqual(decisionIds(map).slice(0, 3), ['research-question', 'system', 'experimental-unit']);
  assert.equal(map.nextDecision.routeId, 'home');
  assertRealRoutes(map);
});

test('a provisional comparison mode stays provisional even when group labels exist', () => {
  const study = orient(emptyExperiment());
  defineMeasurement(study.assays[0]);
  study.provenance.slots['studyContext.comparisonMode'] = { tag: 'llm_freetext', detail: 'drafted' };

  const map = buildExperimentMap(study);
  assert.equal(map.comparison.state, 'provisional');
  assert.equal(map.nextDecision.id, 'comparison-mode');
  assertRealRoutes(map);
});

test('multiple measurements preserve their distinct readiness and use stable ids, not array indices', () => {
  const study = orient(emptyExperiment());
  defineMeasurement(study.assays[0], { label: 'Soil respiration', organism: '', sampleType: 'soil cores' });
  const incomplete = structuredClone(study.assays[0]);
  incomplete.id = 'surface-42';
  defineMeasurement(incomplete, {
    label: 'Surface roughness',
    readout: '',
    readoutText: '',
    organism: '',
    sampleType: 'coated metal coupons',
    biologicalReplicates: null,
    modality: '',
  });
  study.assays.push(incomplete);
  study.activeAssayId = incomplete.id;

  const map = buildExperimentMap(study);
  assert.equal(map.measurements[0].state, 'answered');
  assert.equal(map.measurements[1].state, 'missing');
  assert.equal(map.measurements[0].specimenSummary, 'soil cores');
  assert.equal(map.measurements[1].specimenSummary, 'coated metal coupons');
  assert.deepEqual(decisionIds(map), [
    'measurement-definition:surface-42',
    'biological-replicates:surface-42',
    'modality:surface-42',
  ]);
  assert.ok(map.decisions.every((item) => item.measurementId !== '1'));
  assert.deepEqual(
    map.decisions.filter((item) => item.measurementId).map((item) => item.measurementId),
    ['surface-42', 'surface-42', 'surface-42']
  );
  assertRealRoutes(map);
});

test('missing biological replicates and modality follow design then acquisition after orientation', () => {
  const study = orient(emptyExperiment());
  defineMeasurement(study.assays[0], { biologicalReplicates: null, modality: '' });
  const map = buildExperimentMap(study);

  assert.deepEqual(decisionIds(map), [
    `biological-replicates:${study.assays[0].id}`,
    `modality:${study.assays[0].id}`,
  ]);
  assert.deepEqual(map.decisions.map((item) => item.routeId), ['design', 'panel']);
  assertRealRoutes(map);
});

test('conformance issues are appended in fixed tier order and stale measurement reports are ignored', () => {
  const study = orient(emptyExperiment());
  defineMeasurement(study.assays[0]);
  const map = buildExperimentMap(study, {
    conformance: {
      assays: [
        {
          id: 'deleted-assay',
          issues: [{ section: 'panel', field: 'channels', message: 'A stale report must not route to a deleted measurement.' }],
        },
        {
          id: study.assays[0].id,
          issues: [
            { section: 'incomplete', field: 'date', message: 'Date is still a placeholder.' },
            { section: 'design', field: 'biologicalReplicates', message: 'Replicates need review.' },
            { section: 'path', field: 'target', message: 'Target path is invalid.' },
          ],
        },
      ],
      crossAssayIssues: [{ section: 'naming', field: 'sample', message: 'Study names collide.' }],
    },
  });

  assert.deepEqual(map.decisions.map((item) => [item.tier, item.routeId, item.measurementId ?? null]), [
    ['measurement-design', 'design', study.assays[0].id],
    ['before-acquisition', 'naming', study.assays[0].id],
    ['later', 'naming', study.assays[0].id],
    ['later', 'naming', null],
  ]);
  assert.ok(map.decisions.every((item) => item.source === 'conformance'));
  assert.ok(!map.decisions.some((item) => item.measurementId === 'deleted-assay'));
  assert.ok(!map.decisions.some((item) => item.id.includes('conformance:study:0:0')), 'a stale report cannot turn into a routeable study-level decision');
  assertRealRoutes(map);
});

test('TOTAL: malformed study and optional inputs never throw, are deterministic, and do not mutate input', () => {
  const malformed = {
    studyContext: { system: 7, comparisonMode: 'not-a-mode' },
    groupVocabulary: { levels: [' ', 42] },
    assays: [{ id: 'dup', label: 4 }, { id: 'dup', label: 'duplicate' }, null],
    activeAssayId: 'missing',
    provenance: { slots: null, skipped: 'not-an-array' },
  };
  const before = structuredClone(malformed);
  assert.doesNotThrow(() => buildExperimentMap(malformed, { conformance: { assays: 'bad' }, workflow: null }));
  assert.deepEqual(buildExperimentMap(malformed), buildExperimentMap(malformed));
  assert.deepEqual(malformed, before);
  const map = buildExperimentMap(malformed);
  assert.equal(map.measurements.length, 1);
  assert.ok(map.decisions.every((item) => item.measurementId !== 'missing'));
  assertRealRoutes(map);
});
