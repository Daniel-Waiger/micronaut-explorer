import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEASUREMENT_STATUS_SCOPES,
  MEASUREMENT_STATUS_STATUSES,
  MEASUREMENT_STATUS_LABELS,
  MEASUREMENT_STATUS_TONES,
  MEASUREMENT_STATUS_FILTERS,
  measurementStatus,
  measurementStatusLabel,
} from '../src/engine/measurementStatus.js';

const MEASUREMENT = { id: 'm1', label: 'Bacterial viability', state: 'answered' };

function mapDecision(measurementId, tier) {
  return {
    groups: [{ tier, items: [{ id: 'reps', measurementId, source: 'map', label: 'Decide replicates' }] }],
  };
}

test('three scopes, each with its own status list and labels', () => {
  assert.deepEqual(MEASUREMENT_STATUS_SCOPES, ['definition', 'plan', 'conformance']);
  assert.deepEqual(MEASUREMENT_STATUS_STATUSES.definition, ['draft', 'provisional', 'defined']);
  assert.deepEqual(MEASUREMENT_STATUS_STATUSES.plan, ['open', 'needs-decision', 'ready']);
  assert.deepEqual(MEASUREMENT_STATUS_STATUSES.conformance, ['not-checked', 'blocked', 'needs-review', 'passes']);
  assert.equal(measurementStatusLabel('definition', 'draft'), 'Draft');
  assert.equal(measurementStatusLabel('definition', 'provisional'), 'Provisionally defined');
  assert.equal(measurementStatusLabel('definition', 'defined'), 'Defined');
  assert.equal(measurementStatusLabel('plan', 'open'), 'Plan open');
  assert.equal(measurementStatusLabel('plan', 'needs-decision'), 'Needs a decision');
  assert.equal(measurementStatusLabel('plan', 'ready'), 'Ready to acquire');
  assert.equal(measurementStatusLabel('conformance', 'not-checked'), 'Not checked');
  assert.equal(measurementStatusLabel('conformance', 'blocked'), 'Blocked');
  assert.equal(measurementStatusLabel('conformance', 'needs-review'), 'Needs review');
  assert.equal(measurementStatusLabel('conformance', 'passes'), 'Checks pass');
});

test('"Ready to acquire" labels plan:ready and nothing else', () => {
  for (const scope of MEASUREMENT_STATUS_SCOPES) {
    for (const status of MEASUREMENT_STATUS_STATUSES[scope]) {
      const label = measurementStatusLabel(scope, status);
      if (scope === 'plan' && status === 'ready') {
        assert.equal(label, 'Ready to acquire');
      } else {
        assert.notEqual(label, 'Ready to acquire');
      }
    }
  }
});

test('MEASUREMENT_STATUS_FILTERS is the flat scope:status list for the registry select, with no hand-authored duplicate', () => {
  const expected = MEASUREMENT_STATUS_SCOPES.flatMap((scope) =>
    MEASUREMENT_STATUS_STATUSES[scope].map((status) => `${scope}:${status}`)
  );
  assert.deepEqual(MEASUREMENT_STATUS_FILTERS.map((entry) => entry.value), expected);
  assert.deepEqual(
    MEASUREMENT_STATUS_FILTERS.find((entry) => entry.value === 'plan:needs-decision'),
    { value: 'plan:needs-decision', label: 'Plan: Needs a decision' }
  );
  for (const entry of MEASUREMENT_STATUS_FILTERS) {
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.length > 0);
  }
});

test('every tone is one of the four documented values', () => {
  const allowed = new Set(['ok', 'attention', 'progress', 'neutral']);
  for (const scope of MEASUREMENT_STATUS_SCOPES) {
    for (const status of MEASUREMENT_STATUS_STATUSES[scope]) {
      assert.ok(allowed.has(MEASUREMENT_STATUS_TONES[scope][status]), `${scope}:${status}`);
    }
  }
});

test('definition is decided solely by measurement.state', () => {
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'answered' }).definition, 'defined');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'provisional' }).definition, 'provisional');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'missing' }).definition, 'draft');
  // The dead `needs-attention` value experimentMap.measurementState never
  // emits still degrades sanely rather than being special-cased.
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'needs-attention' }).definition, 'draft');
});

test('plan is open until definition is defined, regardless of triage', () => {
  const decisions = mapDecision('m1', 'measurement-design');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'missing' }, { decisions }).plan, 'open');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'provisional' }, { decisions }).plan, 'open');
});

test('an open decision owning this measurement demotes the plan, not the whole status', () => {
  const decisions = mapDecision('m1', 'measurement-design');
  const status = measurementStatus(MEASUREMENT, { decisions });
  assert.equal(status.plan, 'needs-decision');
  assert.equal(status.definition, 'defined');
  // Another measurement's decision is not this one's problem.
  assert.equal(measurementStatus({ ...MEASUREMENT, id: 'm2' }, { decisions }).plan, 'ready');
});

test('a decision that can truthfully wait (tier "later") does not demote the plan', () => {
  const decisions = { groups: [{ tier: 'later', items: [{ id: 'date', measurementId: 'm1', source: 'map', label: 'Acquisition date' }] }] };
  assert.equal(measurementStatus(MEASUREMENT, { decisions }).plan, 'ready');
});

test('LOAD-BEARING: a triage item carrying assayId and no measurementId does not touch the plan axis', () => {
  const decisions = {
    groups: [
      {
        tier: 'measurement-design',
        items: [{ id: 'conformance:m1:0:0', assayId: 'm1', source: 'conformance', label: 'Review measurement planner check' }],
      },
    ],
  };
  assert.equal(measurementStatus(MEASUREMENT, { decisions }).plan, 'ready');
});

test('a non-"map" source is ignored even if it happens to carry a matching measurementId', () => {
  const decisions = {
    groups: [{ tier: 'measurement-design', items: [{ id: 'x', measurementId: 'm1', source: 'conformance' }] }],
  };
  assert.equal(measurementStatus(MEASUREMENT, { decisions }).plan, 'ready');
});

test('conformance reads assays[i].readiness verbatim, not issue severity', () => {
  assert.equal(measurementStatus(MEASUREMENT, { conformance: { assays: [{ id: 'm1', readiness: 'blocked' }] } }).conformance, 'blocked');
  assert.equal(measurementStatus(MEASUREMENT, { conformance: { assays: [{ id: 'm1', readiness: 'needs-review' }] } }).conformance, 'needs-review');
  assert.equal(measurementStatus(MEASUREMENT, { conformance: { assays: [{ id: 'm1', readiness: 'ready' }] } }).conformance, 'passes');
  // No report for this id at all -> not-checked, not a guess.
  assert.equal(measurementStatus(MEASUREMENT, { conformance: { assays: [] } }).conformance, 'not-checked');
  assert.equal(measurementStatus(MEASUREMENT).conformance, 'not-checked');
});

test('the three axes are independent: a blocked conformance still reports a defined, ready measurement', () => {
  const status = measurementStatus(MEASUREMENT, { conformance: { assays: [{ id: 'm1', readiness: 'blocked' }] } });
  assert.equal(status.definition, 'defined');
  assert.equal(status.plan, 'ready');
  assert.equal(status.conformance, 'blocked');
});

test('headline is the first scope not at its top status, in order definition -> plan -> conformance', () => {
  // definition gap beats a plan or conformance gap.
  const draftWithGaps = measurementStatus(
    { ...MEASUREMENT, state: 'missing' },
    { conformance: { assays: [{ id: 'm1', readiness: 'blocked' }] } }
  );
  assert.deepEqual(draftWithGaps.headline, { scope: 'definition', status: 'draft' });

  // definition satisfied, plan gap beats a conformance gap.
  const planGap = measurementStatus(MEASUREMENT, {
    decisions: mapDecision('m1', 'measurement-design'),
    conformance: { assays: [{ id: 'm1', readiness: 'blocked' }] },
  });
  assert.deepEqual(planGap.headline, { scope: 'plan', status: 'needs-decision' });

  // definition and plan satisfied, only conformance has a gap.
  const conformanceGap = measurementStatus(MEASUREMENT, {
    conformance: { assays: [{ id: 'm1', readiness: 'needs-review' }] },
  });
  assert.deepEqual(conformanceGap.headline, { scope: 'conformance', status: 'needs-review' });

  // All three at their top status -> headline is conformance:passes.
  const allGood = measurementStatus(MEASUREMENT, { conformance: { assays: [{ id: 'm1', readiness: 'ready' }] } });
  assert.deepEqual(allGood.headline, { scope: 'conformance', status: 'passes' });
  assert.equal(allGood.tone, 'ok');
});

test('the record is frozen', () => {
  const status = measurementStatus(MEASUREMENT);
  assert.ok(Object.isFrozen(status));
  assert.throws(() => {
    status.definition = 'draft';
  });
});

test('malformed input degrades to the all-lowest record, headline definition:draft, without throwing', () => {
  for (const bad of [null, undefined, 'nope', 42, [], {}]) {
    assert.doesNotThrow(() => measurementStatus(bad));
    const status = measurementStatus(bad);
    assert.equal(status.definition, 'draft');
    assert.equal(status.plan, 'open');
    assert.equal(status.conformance, 'not-checked');
    assert.deepEqual(status.headline, { scope: 'definition', status: 'draft' });
    assert.equal(status.tone, 'neutral');
  }
  assert.doesNotThrow(() => measurementStatus(MEASUREMENT, { decisions: 'nope', conformance: 7 }));
  assert.doesNotThrow(() => measurementStatus(MEASUREMENT, { decisions: { groups: [null, {}] } }));
  assert.doesNotThrow(() => measurementStatus(MEASUREMENT, { decisions: { groups: [{ tier: 'measurement-design', items: [null, {}, 5] }] } }));
  assert.equal(measurementStatusLabel('definition', 'not-a-status'), 'Draft');
  assert.equal(measurementStatusLabel('not-a-scope', 'draft'), 'Draft');
  assert.equal(measurementStatusLabel('plan', 'not-a-status'), 'Draft');
});
