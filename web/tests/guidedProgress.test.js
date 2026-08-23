import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIMARY_WORKFLOW } from '../src/engine/workflowProgress.js';
import {
  GUIDED_PROGRESS_KEY,
  GUIDED_PROGRESS_VERSION,
  advanceGuidedProgress,
  completeGuidedProgress,
  loadGuidedProgress,
  pauseGuidedProgress,
  restartGuidedProgress,
  resumeGuidedProgress,
  startGuidedProgress,
} from '../src/core/guidedProgress.js';

const IDS = PRIMARY_WORKFLOW.map((step) => step.id);
const FINISHED_AT = '2026-08-23T12:34:56.000Z';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('first start uses the first injected primary step and stores presentation state only', () => {
  const storage = fakeStorage();
  const state = startGuidedProgress(PRIMARY_WORKFLOW, { storage });
  assert.equal(state.status, 'active');
  assert.equal(state.currentStepId, IDS[0]);
  const saved = JSON.parse(storage.getItem(GUIDED_PROGRESS_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['completedAt', 'completedStepIds', 'currentStepId', 'status', 'version']);
  assert.equal(saved.version, GUIDED_PROGRESS_VERSION);
  assert.ok(!JSON.stringify(saved).includes('assays'));
});

test('sequential advance follows injected workflow order and completes each prior step once', () => {
  const storage = fakeStorage();
  startGuidedProgress(PRIMARY_WORKFLOW, { storage });
  const second = advanceGuidedProgress(PRIMARY_WORKFLOW, { storage, fromStepId: IDS[0] });
  const third = advanceGuidedProgress(PRIMARY_WORKFLOW, { storage, fromStepId: IDS[1] });
  assert.equal(second.currentStepId, IDS[1]);
  assert.equal(third.currentStepId, IDS[2]);
  assert.deepEqual(third.completedStepIds, IDS.slice(0, 2));
});

test('a duplicate stale advance cannot skip a step or duplicate completion', () => {
  const storage = fakeStorage();
  startGuidedProgress(PRIMARY_WORKFLOW, { storage });
  const advanced = advanceGuidedProgress(PRIMARY_WORKFLOW, { storage, fromStepId: IDS[0] });
  const duplicate = advanceGuidedProgress(PRIMARY_WORKFLOW, { storage, fromStepId: IDS[0] });
  assert.deepEqual(duplicate, advanced);
  assert.deepEqual(duplicate.completedStepIds, [IDS[0]]);
});

test('pause survives reload and resume preserves the exact cursor', () => {
  const storage = fakeStorage();
  startGuidedProgress(PRIMARY_WORKFLOW, { storage });
  advanceGuidedProgress(PRIMARY_WORKFLOW, { storage, fromStepId: IDS[0] });
  const paused = pauseGuidedProgress(PRIMARY_WORKFLOW, { storage });
  assert.equal(paused.status, 'paused');
  assert.equal(loadGuidedProgress(PRIMARY_WORKFLOW, { storage }).currentStepId, IDS[1]);
  const resumed = resumeGuidedProgress(PRIMARY_WORKFLOW, { storage });
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.currentStepId, IDS[1]);
});

test('completion stores the injected workflow once with an ISO timestamp', () => {
  const storage = fakeStorage();
  const completed = completeGuidedProgress(PRIMARY_WORKFLOW, { storage, now: FINISHED_AT });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentStepId, IDS.at(-1));
  assert.deepEqual(completed.completedStepIds, IDS);
  assert.equal(completed.completedAt, FINISHED_AT);
});

test('restart explicitly clears completion and returns to the first injected step', () => {
  const storage = fakeStorage();
  completeGuidedProgress(PRIMARY_WORKFLOW, { storage, now: FINISHED_AT });
  const restarted = restartGuidedProgress(PRIMARY_WORKFLOW, { storage });
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.currentStepId, IDS[0]);
  assert.deepEqual(restarted.completedStepIds, []);
  assert.equal(restarted.completedAt, null);
});

test('removed and unknown saved step ids are filtered against the injected workflow', () => {
  const storage = fakeStorage();
  storage.setItem(GUIDED_PROGRESS_KEY, JSON.stringify({
    version: GUIDED_PROGRESS_VERSION,
    status: 'paused',
    currentStepId: 'removed-step',
    completedStepIds: [IDS[0], 'removed-step', IDS[0]],
    completedAt: null,
  }));
  const loaded = loadGuidedProgress(PRIMARY_WORKFLOW, { storage });
  assert.equal(loaded.currentStepId, IDS[1]);
  assert.deepEqual(loaded.completedStepIds, [IDS[0]]);
});

test('corrupt JSON degrades to not-started at the first injected step', () => {
  const storage = fakeStorage();
  storage.setItem(GUIDED_PROGRESS_KEY, '{nope');
  assert.deepEqual(loadGuidedProgress(PRIMARY_WORKFLOW, { storage }), {
    version: GUIDED_PROGRESS_VERSION,
    status: 'not-started',
    currentStepId: IDS[0],
    completedStepIds: [],
    completedAt: null,
  });
});

test('throwing storage is total for reads and transitions and reports errors', () => {
  const errors = [];
  const storage = {
    getItem() { throw new Error('read blocked'); },
    setItem() { throw new Error('write blocked'); },
  };
  assert.doesNotThrow(() => loadGuidedProgress(PRIMARY_WORKFLOW, { storage, onError: (error) => errors.push(error.message) }));
  const state = startGuidedProgress(PRIMARY_WORKFLOW, {
    storage,
    state: loadGuidedProgress(PRIMARY_WORKFLOW, { storage }),
    onError: (error) => errors.push(error.message),
  });
  assert.equal(state.status, 'active');
  assert.deepEqual(errors, ['read blocked', 'write blocked']);
});
