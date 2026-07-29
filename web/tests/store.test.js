import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';

function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

test('get returns the current experiment', () => {
  const experiment = emptyExperiment();
  const store = createStore(experiment);
  assert.equal(store.get(), experiment);
});

test('getPath delegates to core/paths getPath against current state', () => {
  const experiment = emptyExperiment();
  experiment.naming.fields.sample = 'E02';
  const store = createStore(experiment);
  assert.equal(store.getPath('naming.fields.sample'), 'E02');
  assert.equal(store.getPath('naming.fields.missing'), undefined);
});

test('patch merges a partial object into state', () => {
  const store = createStore(emptyExperiment());
  store.patch({ schemaVersion: 1, meta: { id: 'x', createdAt: null, updatedAt: null, title: 'T' } });
  assert.equal(store.get().meta.title, 'T');
});

test('patch accepts an updater function receiving current state', () => {
  const store = createStore(emptyExperiment());
  store.patch((state) => ({ meta: { ...state.meta, title: 'Updated' } }));
  assert.equal(store.get().meta.title, 'Updated');
});

test('setPath writes the value and tags the slot on first write', () => {
  const store = createStore(emptyExperiment());
  const ok = store.setPath('naming.fields.sample', 'E02', 'user');
  assert.equal(ok, true);
  assert.equal(store.getPath('naming.fields.sample'), 'E02');
  assert.equal(store.get().provenance.slots['naming.fields.sample'].tag, 'user');
});

test('setPath REFUSES a freetext write over an existing user slot, value unchanged', () => {
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.sample', 'E02', 'user');

  const ok = store.setPath('naming.fields.sample', 'E99', 'freetext');

  assert.equal(ok, false);
  assert.equal(store.getPath('naming.fields.sample'), 'E02');
  assert.equal(store.get().provenance.slots['naming.fields.sample'].tag, 'user');
});

test('setPath with user_edited SUCCEEDS over an llm slot and clears needsReview', () => {
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.date', '2026-01-01', 'llm');
  store.get().provenance.slots['naming.fields.date'].needsReview = true;

  const ok = store.setPath('naming.fields.date', '2026-07-29', 'user_edited');

  assert.equal(ok, true);
  assert.equal(store.getPath('naming.fields.date'), '2026-07-29');
  const slot = store.get().provenance.slots['naming.fields.date'];
  assert.equal(slot.tag, 'user_edited');
  assert.ok(!slot.needsReview);
});

test('subscribe returns an unsubscribe function', () => {
  const store = createStore(emptyExperiment());
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  unsubscribe();
  store.patch({ schemaVersion: 1 });
  return flushMicrotasks().then(() => {
    assert.equal(calls, 0);
  });
});

test('three synchronous setPath calls notify subscribers exactly ONCE', async () => {
  const store = createStore(emptyExperiment());
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });

  store.setPath('naming.fields.sample', 'E01', 'user');
  store.setPath('naming.fields.magnification', 'X90', 'user');
  store.setPath('naming.fields.markers', 'GFP', 'user');

  assert.equal(calls, 0, 'must not notify synchronously');
  await flushMicrotasks();
  assert.equal(calls, 1, 'three synchronous writes must batch into one notification');
});

test('a refused setPath does not schedule a notification by itself', async () => {
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.sample', 'E01', 'user');
  await flushMicrotasks();

  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });
  const ok = store.setPath('naming.fields.sample', 'E99', 'freetext');
  await flushMicrotasks();

  assert.equal(ok, false);
  assert.equal(calls, 0);
});
