import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConformanceIssue, decisionTriage, DECISION_TIERS } from '../src/engine/decisionTriage.js';

const CANONICAL_ISSUES = [
  ['design', 'groups', 'measurement-design'],
  ['design', 'factors', 'measurement-design'],
  ['design', 'biologicalReplicates', 'measurement-design'],
  ['design', 'technicalReplicates', 'measurement-design'],
  ['design', 'idScheme', 'measurement-design'],
  ['controls', 'controls', 'measurement-design'],
  ['naming', 'exptype', 'before-acquisition'],
  ['naming', 'markers', 'before-acquisition'],
  ['naming', 'magnification', 'before-acquisition'],
  ['naming', 'sample', 'later'],
  ['naming', 'notes', 'later'],
  ['incomplete', 'date', 'later'],
  ['incomplete', 'sample', 'later'],
  ['incomplete', 'modality', 'before-acquisition'],
  ['incomplete', 'exptype', 'before-acquisition'],
  ['incomplete', 'markers', 'before-acquisition'],
  ['incomplete', 'magnification', 'before-acquisition'],
  ['path', 'target_path', 'before-acquisition'],
  ['panel', 'panel', 'before-acquisition'],
  ['cross-assay', 'assays', 'study-shape'],
  ['cross-assay', 'exptype', 'before-acquisition'],
];

test('classifies every current conformance section and field class by canonical identity', () => {
  for (const [section, field, expectedTier] of CANONICAL_ISSUES) {
    const classified = classifyConformanceIssue({ section, field, message: 'same words for every row', severity: 'warning' });
    assert.equal(classified.tier, expectedTier, `${section}.${field}`);
  }

  // The message deliberately suggests a different tier. Classification must
  // stay attached to the stable producer identity, not visible wording.
  assert.equal(
    classifyConformanceIssue({ section: 'naming', field: 'sample', message: 'Panel conflict before acquisition', severity: 'error' }).tier,
    'later'
  );
});

test('combines study-context map decisions with conformance issues in fixed tier and source order', () => {
  const map = {
    decisions: [
      { id: 'research-question', field: 'researchQuestion', label: 'Research question', routeId: 'home' },
      { id: 'studyContext.system', field: 'studyContext.system', label: 'System', routeId: 'home' },
      { id: 'comparison-mode', field: 'comparisonMode', label: 'Comparison', routeId: 'home' },
      { id: 'studyContext.experimentalUnit', field: 'studyContext.experimentalUnit', label: 'Independent unit', routeId: 'home' },
      { id: 'biologicalReplicates', field: 'biologicalReplicates', label: 'Replicates', routeId: 'design', measurementId: 'assay-a' },
      { id: 'acquisition.modality', field: 'modality', label: 'Method', routeId: 'panel', measurementId: 'assay-a' },
      { id: 'naming.fields.date', field: 'date', label: 'Date', routeId: 'naming', measurementId: 'assay-a' },
    ],
  };
  const conformance = {
    assays: [{
      id: 'assay-a',
      issues: [
        { section: 'design', field: 'groups', message: 'groups', severity: 'error' },
        { section: 'panel', field: 'panel', message: 'panel', severity: 'warning' },
        { section: 'incomplete', field: 'sample', message: 'sample', severity: 'warning' },
      ],
    }],
    crossAssayIssues: [{ section: 'cross-assay', field: 'assays', message: 'assays', severity: 'error' }],
  };

  const result = decisionTriage(map, conformance);
  assert.deepEqual(result.groups.map((group) => group.tier), DECISION_TIERS);
  assert.deepEqual(result.counts, {
    'study-shape': 5,
    'measurement-design': 2,
    'before-acquisition': 2,
    later: 2,
    total: 11,
  });
  assert.deepEqual(
    result.groups.map((group) => group.items.map((item) => `${item.source}:${item.field || item.id}`)),
    [
      ['map:researchQuestion', 'map:studyContext.system', 'map:comparisonMode', 'map:studyContext.experimentalUnit', 'conformance:assays'],
      ['map:biologicalReplicates', 'conformance:groups'],
      ['map:modality', 'conformance:panel'],
      ['map:date', 'conformance:sample'],
    ]
  );
});

test('keeps blocking severity and producer-supplied route even when the ordinary timing tier is later', () => {
  const invalidDate = { section: 'naming', field: 'date', message: 'invalid', severity: 'error', routeId: 'custom-naming-route', assayId: 'producer-assay-id' };
  const invalidPath = { section: 'path', field: 'target_path', message: 'invalid path', severity: 'fatal', route: 'custom-path-route' };
  const result = decisionTriage({}, { assays: [{ id: 'assay-a', issues: [invalidDate, invalidPath] }] });
  const later = result.groups.find((group) => group.tier === 'later').items[0];
  const beforeAcquisition = result.groups.find((group) => group.tier === 'before-acquisition').items[0];

  assert.equal(later.tier, 'later');
  assert.equal(later.severity, 'error');
  assert.equal(later.routeId, 'custom-naming-route');
  assert.equal(later.assayId, 'producer-assay-id');
  assert.equal(beforeAcquisition.tier, 'before-acquisition');
  assert.equal(beforeAcquisition.severity, 'fatal');
  assert.equal(beforeAcquisition.route, 'custom-path-route');
  assert.equal(beforeAcquisition.routeId, 'custom-path-route');
});

test('uses the raw conformance issue once instead of its source-marked map copy', () => {
  const map = {
    decisions: [{
      id: 'conformance:assay-a:naming:sample',
      source: 'conformance',
      tier: 'later',
      field: 'sample',
      message: 'map copy has deliberately different wording',
      severity: 'warning',
      routeId: 'map-route',
      measurementId: 'map-assay-id',
    }],
  };
  const conformance = {
    assays: [{
      id: 'assay-a',
      issues: [{
        section: 'naming',
        field: 'sample',
        message: 'raw conformance issue is the Review entry',
        severity: 'error',
        routeId: 'raw-route',
        assayId: 'raw-assay-id',
      }],
    }],
  };

  const items = decisionTriage(map, conformance).groups.flatMap((group) => group.items);
  assert.equal(items.length, 1, 'source-marked map copy is excluded without message-string deduplication');
  assert.deepEqual(items[0], {
    source: 'conformance',
    section: 'naming',
    field: 'sample',
    message: 'raw conformance issue is the Review entry',
    severity: 'error',
    routeId: 'raw-route',
    assayId: 'raw-assay-id',
    tier: 'later',
  });
});

test('is total, deterministic, and does not mutate map or conformance inputs', () => {
  const map = { decisions: [{ id: 'research-question', field: 'researchQuestion', routeId: 'home' }] };
  const conformance = { assays: [{ id: 'assay-a', issues: [{ section: 'incomplete', field: 'date', severity: 'warning' }] }] };
  const before = structuredClone({ map, conformance });

  const first = decisionTriage(map, conformance);
  const second = decisionTriage(map, conformance);
  assert.deepEqual(first, second);
  assert.deepEqual({ map, conformance }, before);
  assert.deepEqual(decisionTriage(null, { assays: 'not-an-array' }).counts, {
    'study-shape': 0,
    'measurement-design': 0,
    'before-acquisition': 0,
    later: 0,
    total: 0,
  });
});
