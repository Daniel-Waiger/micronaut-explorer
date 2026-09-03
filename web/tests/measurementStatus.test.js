import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASUREMENT_STATUSES, measurementStatus, measurementStatusLabel } from '../src/engine/measurementStatus.js';

const MEASUREMENT = { id: 'm1', label: 'Bacterial viability', state: 'answered' };

test('the vocabulary is exactly three words, and each has a label', () => {
  assert.deepEqual(MEASUREMENT_STATUSES, ['draft', 'needs-decision', 'ready']);
  assert.deepEqual(
    MEASUREMENT_STATUSES.map(measurementStatusLabel),
    ['Draft', 'Needs a decision', 'Ready to acquire']
  );
});

test('map state alone decides between draft and ready', () => {
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'answered' }), 'ready');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'missing' }), 'draft');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'provisional' }), 'draft');
  assert.equal(measurementStatus({ ...MEASUREMENT, state: 'needs-attention' }), 'needs-decision');
});

test('an open decision owning this measurement overrides a ready map state', () => {
  const decisions = {
    groups: [
      { tier: 'measurement-design', items: [{ id: 'reps', measurementId: 'm1', label: 'Decide replicates' }] },
    ],
  };
  assert.equal(measurementStatus(MEASUREMENT, { decisions }), 'needs-decision');
  // Another measurement's decision is not this one's problem.
  assert.equal(measurementStatus({ ...MEASUREMENT, id: 'm2' }, { decisions }), 'ready');
});

// A date or an instrument label that may truthfully be assigned on acquisition
// day must not tell someone their measurement is unfinished.
test('a decision that can truthfully wait does not demote a ready measurement', () => {
  const decisions = {
    groups: [{ tier: 'later', items: [{ id: 'date', measurementId: 'm1', label: 'Acquisition date' }] }],
  };
  assert.equal(measurementStatus(MEASUREMENT, { decisions }), 'ready');
});

test('a blocking conformance issue reads as needs-decision, matching conformance severities', () => {
  for (const severity of ['error', 'fatal']) {
    const conformance = { assays: [{ id: 'm1', issues: [{ severity }] }] };
    assert.equal(measurementStatus(MEASUREMENT, { conformance }), 'needs-decision');
  }
  // A warning is not blocking, in this module or in conformance.
  const warned = { assays: [{ id: 'm1', issues: [{ severity: 'warning' }] }] };
  assert.equal(measurementStatus(MEASUREMENT, { conformance: warned }), 'ready');
});

test('malformed input degrades to draft rather than throwing', () => {
  for (const bad of [null, undefined, 'nope', 42, [], {}]) {
    assert.doesNotThrow(() => measurementStatus(bad));
    assert.equal(measurementStatus(bad), 'draft');
  }
  assert.doesNotThrow(() => measurementStatus(MEASUREMENT, { decisions: 'nope', conformance: 7 }));
  assert.doesNotThrow(() => measurementStatus(MEASUREMENT, { decisions: { groups: [null, {}] } }));
  assert.equal(measurementStatusLabel('not-a-status'), 'Draft');
});
