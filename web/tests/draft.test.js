// Tests for core/draft.js -- building a fresh study from model proposals
// without ever touching the user's own study, and without laundering the
// draft's provenance into a STRONG tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftExperiment } from '../src/core/draft.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import { canOverwrite, isProvisional } from '../src/core/provenance.js';
import { firstAssayId, scopeWrite } from '../src/core/assay.js';
import { loadQuestions, nextQuestions } from '../src/engine/interview.js';
import { assayView } from '../src/core/assay.js';

const PROPOSALS = [
  { path: 'acquisition.modality', value: 'STED', tag: 'llm_freetext' },
  { path: 'naming.fields.notes', value: 'pilot', tag: 'llm_freetext' },
  { path: 'design.biologicalReplicates', value: 3, tag: 'llm_freetext' },
];

function slotOf(experiment, flatPath) {
  const { slotKey } = scopeWrite(experiment, flatPath, firstAssayId(experiment));
  return experiment.provenance.slots[slotKey];
}

test('every drafted value lands, tagged PROVISIONAL and flagged needsReview', () => {
  const { experiment, applied, skipped } = buildDraftExperiment(PROPOSALS);
  assert.equal(skipped.length, 0);
  assert.equal(applied.length, 3);

  for (const proposal of PROPOSALS) {
    const slot = slotOf(experiment, proposal.path);
    assert.equal(slot.tag, 'llm_freetext', proposal.path);
    assert.equal(isProvisional(slot.tag), true, proposal.path);
    assert.equal(slot.needsReview, true, proposal.path);
  }
});

test('the draft is never tagged `imported` -- a model guess must not be laundered into STRONG trust', () => {
  const { experiment } = buildDraftExperiment(PROPOSALS);
  for (const slot of Object.values(experiment.provenance.slots)) {
    assert.notEqual(slot.tag, 'imported');
    assert.notEqual(slot.tag, 'user');
    assert.notEqual(slot.tag, 'user_edited');
  }
});

test("a drafted slot can still be overwritten by the user, but never overwrites the user's own value", () => {
  const { experiment } = buildDraftExperiment(PROPOSALS);
  const draftedTag = slotOf(experiment, 'acquisition.modality').tag;
  assert.equal(canOverwrite(draftedTag, 'user'), true);
  assert.equal(canOverwrite('user', draftedTag), false);
});

test('drafting builds a genuinely separate experiment -- the caller\'s study is untouched', () => {
  const mine = createStore(emptyExperiment());
  const assayId = firstAssayId(mine.get());
  const { path, slotKey } = scopeWrite(mine.get(), 'acquisition.modality', assayId);
  mine.setPath(path, 'Confocal', 'user', { slotKey });

  const { experiment: draft } = buildDraftExperiment(PROPOSALS);

  assert.notEqual(draft, mine.get());
  assert.equal(mine.getPath(path), 'Confocal');
  assert.equal(mine.get().provenance.slots[slotKey].tag, 'user');
  assert.equal(mine.get().provenance.slots[slotKey].needsReview, undefined);
});

test('a drafted study re-asks its questions PRE-FILLED, rather than discarding the draft', () => {
  const { questions } = loadQuestions([
    { id: 'q-modality', field: 'acquisition.modality', type: 'choice', prompt: 'Modality?', options: ['Confocal', 'STED'] },
  ]);
  const { experiment } = buildDraftExperiment([
    { path: 'acquisition.modality', value: 'STED', tag: 'llm_freetext' },
  ]);
  const askable = nextQuestions(questions, assayView(experiment, firstAssayId(experiment)), 10);
  assert.equal(askable.length, 1);
  assert.equal(askable[0].suggestedDefault, 'STED');
  assert.equal(askable[0].suggestedTag, 'llm_freetext');
});

test('TOTAL: malformed proposals are skipped and reported, never fatal to the rest of the draft', () => {
  const { experiment, applied, skipped } = buildDraftExperiment([
    null,
    { value: 'no path', tag: 'llm_freetext' },
    { path: 'naming.fields.notes', value: 'kept', tag: 'llm_freetext' },
  ]);
  assert.deepEqual(applied, ['naming.fields.notes']);
  assert.equal(skipped.length, 2);
  assert.equal(slotOf(experiment, 'naming.fields.notes').value, undefined); // slot record has no `value` field
  assert.equal(slotOf(experiment, 'naming.fields.notes').tag, 'llm_freetext');
});

test('TOTAL: a non-array proposal list yields an empty but valid draft', () => {
  for (const bad of [undefined, null, 'nope', {}]) {
    assert.doesNotThrow(() => buildDraftExperiment(bad), String(bad));
    const { experiment, applied } = buildDraftExperiment(bad);
    assert.equal(applied.length, 0);
    assert.ok(Array.isArray(experiment.assays) && experiment.assays.length >= 1);
  }
});
