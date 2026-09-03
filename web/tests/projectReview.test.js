import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectReview } from '../src/engine/projectReview.js';

const QUESTIONS = [
  { id: 'modality', field: 'acquisition.modality', label: 'Modality', prompt: 'What modality?', phase: 'project' },
  { id: 'notes', field: 'naming.fields.notes', label: 'Notes', prompt: 'Notes?', phase: 'project' },
];

function proposal(path, value, evidence) {
  return { path, value, evidence };
}

function review(overrides = {}) {
  return buildProjectReview({
    status: 'complete',
    narrativeRevision: 4,
    assayId: 'assay-a',
    currentNarrativeRevision: 4,
    currentAssayId: 'assay-a',
    questions: QUESTIONS,
    currentValues: {},
    exact: { proposals: [] },
    ...overrides,
  });
}

test('exact-only results become bound, actionable candidates with destination metadata', () => {
  const result = review({ exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'Confocal')] } });
  assert.equal(result.status, 'complete');
  assert.equal(result.actionable, true);
  assert.equal(result.groups.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, 'proposal:acquisition.modality:string%3A%22Confocal%22');
  assert.equal(candidate.destination, 'acquisition.modality');
  assert.equal(candidate.questionId, 'modality');
  assert.equal(candidate.questionLabel, 'Modality');
  assert.equal(candidate.phase, 'project');
  assert.deepEqual(candidate.sources, ['exact']);
  assert.deepEqual(candidate.evidence, ['Confocal']);
  assert.equal(candidate.narrativeRevision, 4);
  assert.equal(candidate.assayId, 'assay-a');
  assert.equal(candidate.currentState, 'new');
});

// The exact-text scan is now the ONLY candidate source. Model-sourced
// candidates (`local`, `paste`) are not merely absent by default -- they are
// no longer a recognised input, so a stray one cannot re-enter the study.
test('model-sourced candidates are not a recognised input any more', () => {
  const result = review({
    local: { proposals: [proposal('acquisition.modality', 'Confocal', 'local quote')] },
    paste: { proposals: [proposal('naming.fields.notes', 'A note', 'pasted quote')] },
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.groups.length, 0);
});

test('two exact matches for one field remain an explicit conflict, neither applied', () => {
  const agreeing = review({
    exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'exact quote'), proposal('acquisition.modality', 'Confocal', 'second quote')] },
  });
  assert.equal(agreeing.groups.length, 1);
  assert.equal(agreeing.groups[0].conflict, false);
  assert.equal(agreeing.groups[0].candidates.length, 1);
  assert.deepEqual(agreeing.candidates[0].sources, ['exact']);
  assert.deepEqual(agreeing.candidates[0].evidence, ['exact quote', 'second quote']);

  const conflicting = review({
    exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'Confocal'), proposal('acquisition.modality', 'STED', 'STED')] },
  });
  assert.equal(conflicting.groups[0].conflict, true);
  assert.deepEqual(conflicting.groups[0].candidates.map((candidate) => candidate.value), ['Confocal', 'STED']);
});

test('current structured values are compared without any write decision', () => {
  const same = review({
    currentValues: { 'acquisition.modality': 'Confocal' },
    exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'Confocal')] },
  });
  assert.equal(same.candidates[0].currentState, 'same-as-confirmed');
  assert.equal(same.candidates[0].currentValue, 'Confocal');

  const different = review({
    currentValues: { 'acquisition.modality': 'STED' },
    exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'Confocal')] },
  });
  assert.equal(different.candidates[0].currentState, 'different-from-current');
  assert.equal(different.candidates[0].currentValue, 'STED');
});

test('asks, repairs, and rejected parser output are bounded review data, never candidates', () => {
  const result = review({
    exact: {
      proposals: [],
      asks: [{ topic: 'Pixel size', why: 'smallest feature is unknown' }],
      repairs: ['removed a trailing comma'],
      issues: [{ field: 'acquisition.modality', message: 'evidence is not in the narrative', severity: 'error' }],
    },
  });
  assert.deepEqual(result.asks, [{ id: 'ask:exact:0', source: 'exact', topic: 'Pixel size', why: 'smallest feature is unknown' }]);
  assert.deepEqual(result.repairs, [{ id: 'repair:exact:0', source: 'exact', message: 'removed a trailing comma' }]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.issues[0].source, 'exact');
  assert.match(result.issues[0].message, /evidence is not in the narrative/);
});

test('stale narrative or assay bindings disable every candidate action', () => {
  const base = { exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'Confocal')] } };
  const staleNarrative = review({ ...base, currentNarrativeRevision: 5 });
  const staleAssay = review({ ...base, currentAssayId: 'assay-b' });
  for (const result of [staleNarrative, staleAssay]) {
    assert.equal(result.status, 'stale');
    assert.equal(result.actionable, false);
    assert.equal(result.nonActionableReason, 'stale');
    assert.ok(result.candidates.every((candidate) => candidate.actionable === false));
  }
});

test('session-owned dismissed IDs remove only their exact candidate and recalculate a conflict', () => {
  const source = {
    exact: { proposals: [proposal('acquisition.modality', 'Confocal', 'Confocal'), proposal('acquisition.modality', 'STED', 'STED')] },
  };
  const original = review(source);
  const dismissedId = original.candidates.find((candidate) => candidate.value === 'Confocal').id;
  const input = { ...source, dismissedCandidateIds: [dismissedId] };
  const before = structuredClone(input);
  const result = review(input);

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].conflict, false);
  assert.deepEqual(result.candidates.map((candidate) => candidate.value), ['STED']);
  assert.deepEqual(input, before);

  const stale = review({
    ...source,
    dismissedCandidateIds: [dismissedId],
    currentNarrativeRevision: 5,
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.candidates.length, 1);
  assert.equal(stale.candidates[0].actionable, false);

  const malformed = review({
    ...source,
    dismissedCandidateIds: ['x'.repeat(4001), 42],
  });
  assert.equal(malformed.candidates.length, 2);
  assert.ok(malformed.issues.some((issue) => issue.field === 'dismissedCandidateIds'));
});

// Four states went with the in-app model path: model-running, fallback,
// cancelled, and error described a request in flight, and there is no request.
// An unrecognised status must fall back to idle rather than be echoed.
test('the lifecycle is exactly idle/scanning/complete/stale', () => {
  for (const status of ['idle', 'scanning', 'complete', 'stale']) {
    assert.equal(review({ status }).status, status);
  }
  for (const retired of ['model-running', 'fallback', 'cancelled', 'error']) {
    assert.equal(review({ status: retired }).status, 'idle');
  }
  assert.equal(review({ status: 'idle' }).actionable, false);
  assert.equal(review({ status: 'scanning' }).actionable, false);
  assert.equal(review({ status: 'complete' }).actionable, true);
  const unboundIdle = buildProjectReview({ status: 'idle' });
  assert.equal(unboundIdle.status, 'idle');
  assert.equal(unboundIdle.actionable, false);
});

test('malformed and oversized inputs are rejected safely and every returned collection is capped', () => {
  const tooMany = Array.from({ length: 70 }, (_, index) => proposal('naming.fields.notes', `value ${index}`, 'evidence'));
  const tooManyAsks = Array.from({ length: 20 }, (_, index) => ({ topic: `topic ${index}` }));
  const result = review({
    questions: [...QUESTIONS, ...Array.from({ length: 101 }, (_, index) => ({ field: `x.${index}` }))],
    exact: {
      proposals: [null, { path: 'unknown.path', value: 'x', evidence: 'x' }, ...tooMany],
      asks: [...tooManyAsks, { topic: 'x'.repeat(301) }],
      repairs: [null, 'x'.repeat(301)],
    },
  });
  assert.ok(result.candidates.length <= 50);
  assert.ok(result.groups.length <= 50);
  assert.ok(result.asks.length <= 12);
  assert.ok(result.repairs.length <= 12);
  assert.ok(result.issues.length <= 12);
  assert.ok(result.issues.length > 0);
  assert.doesNotThrow(() => buildProjectReview(null));
  assert.doesNotThrow(() => buildProjectReview({ exact: { proposals: 'nope', asks: {} } }));
});

test('output is deterministic and does not mutate inputs', () => {
  const input = {
    status: 'complete',
    narrativeRevision: 1,
    assayId: 'a',
    currentNarrativeRevision: 1,
    currentAssayId: 'a',
    questions: QUESTIONS,
    currentValues: {},
    exact: {
      proposals: [proposal('acquisition.modality', 'Confocal', 'exact'), proposal('naming.fields.notes', 'note', 'note')],
      asks: [{ topic: 'control' }],
    },
  };
  const before = structuredClone(input);
  const first = buildProjectReview(input);
  const second = buildProjectReview(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});
