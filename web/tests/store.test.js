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
  experiment.assays[0].naming.fields.sample = 'E02';
  const store = createStore(experiment);
  assert.equal(store.getPath('assays[0].naming.fields.sample'), 'E02');
  assert.equal(store.getPath('assays[0].naming.fields.missing'), undefined);
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

test('replace swaps the whole root, removes obsolete top-level data, and notifies subscribers', async () => {
  const initial = emptyExperiment();
  initial.obsoleteImportedRoot = { shouldNotSurvive: true };
  const replacement = emptyExperiment();
  replacement.meta.title = 'Restored study';
  const store = createStore(initial);
  const seen = [];
  store.subscribe((state) => seen.push(state));

  const returned = store.replace(replacement);

  assert.equal(returned, replacement);
  assert.equal(store.get(), replacement);
  assert.equal(store.get().obsoleteImportedRoot, undefined);
  assert.equal(seen.length, 0, 'notifications stay batched like patch/setPath');
  await flushMicrotasks();
  assert.deepEqual(seen, [replacement]);
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

test('clearing a field (empty value) always succeeds even over a STRONG slot', () => {
  // Regression: writing an empty value used to keep the caller's tag
  // ('user'), permanently locking the slot against any future WEAK/
  // PROVISIONAL write (a KB default, an LLM suggestion) since canOverwrite
  // refuses non-STRONG writes over a STRONG slot forever after.
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.sample', 'E02', 'user');

  const ok = store.setPath('naming.fields.sample', '', 'user');

  assert.equal(ok, true);
  assert.equal(store.getPath('naming.fields.sample'), '');
});

test('clearing a field tags the slot default (WEAK), not the caller-supplied tag', () => {
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.sample', 'E02', 'user');
  store.setPath('naming.fields.sample', '', 'user');

  const slot = store.get().provenance.slots['naming.fields.sample'];
  assert.equal(slot.tag, 'default');
});

test('B4/V6-NEW-03: writing an empty ARRAY is a clear too, not a STRONG write', () => {
  const store = createStore(emptyExperiment());
  store.setPath('assays[0].design.factors', [{ name: 'genotype', levels: ['WT'] }], 'user');

  const ok = store.setPath('assays[0].design.factors', [], 'user');

  assert.equal(ok, true);
  assert.deepEqual(store.getPath('assays[0].design.factors'), []);
  assert.equal(
    store.get().provenance.slots['assays[0].design.factors'].tag,
    'default',
    'an empty array clears to WEAK, same as an empty string'
  );
});

test('B4/V6-NEW-03: writing an object whose only value is an empty array (e.g. {levels: []}) is also a clear', () => {
  // design.js's writeGroups always writes the WHOLE {levels:[...]} object,
  // never a bare array -- removing the last group row writes {levels: []}.
  // Before this fix, that object was not recognized as "empty" (only '' /
  // null / undefined / a bare empty array were), so it was tagged STRONG and
  // permanently refused every later WEAK "copy groups from another
  // measurement" write (lesson 37's deadlock; see V6-NEW-03).
  const store = createStore(emptyExperiment());
  store.setPath('assays[0].design.groups', { levels: ['CTL'] }, 'user');

  const ok = store.setPath('assays[0].design.groups', { levels: [] }, 'user');

  assert.equal(ok, true);
  assert.deepEqual(store.getPath('assays[0].design.groups'), { levels: [] });
  assert.equal(store.get().provenance.slots['assays[0].design.groups'].tag, 'default');

  const refill = store.setPath('assays[0].design.groups', { levels: ['TREATED'] }, 'kb-default');
  assert.equal(refill, true, 'a later WEAK write can now fill the cleared slot');
});

test('a cleared (WEAK-tagged) slot can be freely refilled by any source afterward', () => {
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.sample', 'E02', 'user');
  store.setPath('naming.fields.sample', '', 'user'); // user clears the field

  // Without the fix, this would be refused: the empty write above would
  // have kept a STRONG 'user' tag, and canOverwrite('user', 'kb-default')
  // is false.
  const ok = store.setPath('naming.fields.sample', 'E03', 'kb-default');

  assert.equal(ok, true);
  assert.equal(store.getPath('naming.fields.sample'), 'E03');
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

// --- slotKey: provenance identity separate from the object write address --
// Added for schema v3's assay tier (core/assay.js). A per-assay write's real
// object address is index-based (assays[2].acquisition.modality), but an
// array index is not a stable identity -- deleting assay 0 would silently
// repoint every surviving slot at a different assay's provenance. slotKey
// lets a caller track provenance by a stable id instead of by array index.

test('setPath without a slotKey option behaves exactly as before (slotKey defaults to path)', () => {
  const store = createStore(emptyExperiment());
  store.setPath('naming.fields.sample', 'E02', 'user');
  assert.equal(store.get().provenance.slots['naming.fields.sample'].tag, 'user');
});

test('setPath writes the VALUE at path but tags provenance at slotKey, when they differ', () => {
  const store = createStore(emptyExperiment());
  const ok = store.setPath('assays[0].acquisition.modality', 'STED', 'user', {
    slotKey: 'assay:a1.acquisition.modality',
  });
  assert.equal(ok, true);
  assert.equal(store.getPath('assays[0].acquisition.modality'), 'STED');
  // Nothing under the literal path itself gets a provenance entry.
  assert.equal(store.get().provenance.slots['assays[0].acquisition.modality'], undefined);
  assert.equal(store.get().provenance.slots['assay:a1.acquisition.modality'].tag, 'user');
});

test('a STRONG write at slotKey refuses a later WEAK write at the SAME slotKey, even if the object path differs', () => {
  // The scenario slotKey exists for: assay 0 gets deleted and a later assay
  // is renumbered into index 0, but the id-based slotKey still correctly
  // refers to the ORIGINAL assay's provenance.
  const store = createStore(emptyExperiment());
  store.setPath('assays[0].acquisition.modality', 'STED', 'user', { slotKey: 'assay:a1.acquisition.modality' });

  const ok = store.setPath('assays[0].acquisition.modality', 'confocal', 'freetext', {
    slotKey: 'assay:a1.acquisition.modality',
  });

  assert.equal(ok, false);
  assert.equal(store.getPath('assays[0].acquisition.modality'), 'STED');
});

test('two different slotKeys are independent even when nothing else distinguishes the writes', () => {
  const store = createStore(emptyExperiment());
  store.setPath('assays[0].acquisition.modality', 'STED', 'user', { slotKey: 'assay:a1.acquisition.modality' });

  // A different assay's slot, addressed at the SAME object path (a1 was
  // deleted, a2 renumbered into index 0) -- must be a fresh, unwritten slot.
  const ok = store.setPath('assays[0].acquisition.modality', 'confocal', 'user', {
    slotKey: 'assay:a2.acquisition.modality',
  });
  assert.equal(ok, true);
  assert.equal(store.get().provenance.slots['assay:a1.acquisition.modality'].tag, 'user');
  assert.equal(store.get().provenance.slots['assay:a2.acquisition.modality'].tag, 'user');
});

test('clearing a value still tags default (WEAK) at slotKey, not at path', () => {
  const store = createStore(emptyExperiment());
  store.setPath('assays[0].acquisition.modality', 'STED', 'user', { slotKey: 'assay:a1.acquisition.modality' });
  store.setPath('assays[0].acquisition.modality', '', 'user', { slotKey: 'assay:a1.acquisition.modality' });
  assert.equal(store.get().provenance.slots['assay:a1.acquisition.modality'].tag, 'default');
});

test('an EMPTY payload from a WEAK writer never overwrites a STRONG value (red-team B4 round 2)', async () => {
  const { createStore } = await import('../src/core/store.js');
  const s = createStore({ design: { groups: { levels: ['WT', 'KO'] } }, provenance: { slots: {} } });
  assert.equal(s.setPath('design.groups', { levels: ['WT', 'KO'] }, 'user'), true);
  assert.equal(s.setPath('design.groups', { levels: [''] }, 'kb-default'), false, 'weak empty write refused');
  assert.deepEqual(s.get().design.groups.levels, ['WT', 'KO']);
  assert.equal(s.setPath('design.groups', { levels: [''] }, 'user'), true, 'the user may still clear their own field');
  assert.equal(s.get().provenance.slots['design.groups'].tag, 'default');
});
