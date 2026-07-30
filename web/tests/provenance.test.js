import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAG_TIERS,
  canOverwrite,
  editTagFor,
  isProvisional,
  promoteOnUserEdit,
  tagSlot,
  tierOf,
} from '../src/core/provenance.js';
import { emptyExperiment } from '../src/core/schema.js';

test('tierOf classifies every tag into STRONG/WEAK/PROVISIONAL', () => {
  for (const tag of ['user', 'user_edited', 'imported']) {
    assert.equal(tierOf(tag), 'STRONG');
  }
  for (const tag of ['freetext', 'kb-default', 'derived', 'default']) {
    assert.equal(tierOf(tag), 'WEAK');
  }
  for (const tag of ['llm', 'llm_freetext']) {
    assert.equal(tierOf(tag), 'PROVISIONAL');
  }
});

test('tierOf throws on an unknown tag', () => {
  assert.throws(() => tierOf('bogus'), /unknown provenance tag/);
});

test('isProvisional is true only for PROVISIONAL tags', () => {
  assert.ok(isProvisional('llm'));
  assert.ok(isProvisional('llm_freetext'));
  assert.ok(!isProvisional('user'));
  assert.ok(!isProvisional('freetext'));
});

test('canOverwrite allows any write into an untagged slot', () => {
  assert.equal(canOverwrite(null, 'freetext'), true);
  assert.equal(canOverwrite(undefined, 'llm'), true);
});

test('canOverwrite refuses a non-STRONG write over a STRONG slot', () => {
  assert.equal(canOverwrite('user', 'freetext'), false);
  assert.equal(canOverwrite('user', 'llm'), false);
  assert.equal(canOverwrite('imported', 'derived'), false);
});

test('canOverwrite allows a STRONG write over a STRONG slot', () => {
  assert.equal(canOverwrite('user', 'user_edited'), true);
  assert.equal(canOverwrite('user_edited', 'imported'), true);
});

test('canOverwrite allows any write over a WEAK or PROVISIONAL slot', () => {
  assert.equal(canOverwrite('freetext', 'llm'), true);
  assert.equal(canOverwrite('llm', 'user'), true);
  assert.equal(canOverwrite('derived', 'kb-default'), true);
});

test('TAG_TIERS exposes exactly the documented tag vocabulary', () => {
  assert.deepEqual(new Set(Object.keys(TAG_TIERS)), new Set([
    'user', 'user_edited', 'imported',
    'freetext', 'kb-default', 'derived', 'default',
    'llm', 'llm_freetext',
  ]));
});

test('tagSlot writes a fresh {tag, detail} slot', () => {
  const experiment = emptyExperiment();
  tagSlot(experiment, 'naming.fields.sample', 'user', 'typed by hand');
  assert.deepEqual(experiment.provenance.slots['naming.fields.sample'], {
    tag: 'user',
    detail: 'typed by hand',
  });
});

test('tagSlot replaces (not merges) an existing slot, dropping stale flags', () => {
  const experiment = emptyExperiment();
  experiment.provenance.slots['naming.fields.sample'] = {
    tag: 'llm',
    detail: null,
    needsReview: true,
  };
  tagSlot(experiment, 'naming.fields.sample', 'freetext');
  const slot = experiment.provenance.slots['naming.fields.sample'];
  assert.equal(slot.tag, 'freetext');
  assert.ok(!('needsReview' in slot));
});

test('promoteOnUserEdit retags to user_edited and clears needsReview', () => {
  // Repo lesson E8: without this retag, a provenance gate keyed on a weaker
  // source tag can never clear once the user has actually fixed the value.
  const experiment = emptyExperiment();
  experiment.provenance.slots['naming.fields.date'] = {
    tag: 'llm',
    detail: 'guessed from filename',
    needsReview: true,
  };
  promoteOnUserEdit(experiment, 'naming.fields.date');
  const slot = experiment.provenance.slots['naming.fields.date'];
  assert.equal(slot.tag, 'user_edited');
  assert.equal(slot.needsReview, false);
});

test('promoteOnUserEdit on a slot with no prior entry still creates one', () => {
  const experiment = emptyExperiment();
  promoteOnUserEdit(experiment, 'naming.fields.notes');
  const slot = experiment.provenance.slots['naming.fields.notes'];
  assert.equal(slot.tag, 'user_edited');
  assert.equal(slot.needsReview, false);
});

test('editTagFor: a first-ever entry (no existing tag) writes plain "user"', () => {
  assert.equal(editTagFor(null), 'user');
  assert.equal(editTagFor(undefined), 'user');
});

test('editTagFor: correcting a WEAK or PROVISIONAL value writes "user_edited"', () => {
  for (const weak of ['freetext', 'kb-default', 'derived', 'default', 'llm', 'llm_freetext']) {
    assert.equal(editTagFor(weak), 'user_edited', `for existing tag: ${weak}`);
  }
});

test('editTagFor: a slot already STRONG stays plain "user" (no need to re-promote)', () => {
  for (const strong of ['user', 'user_edited', 'imported']) {
    assert.equal(editTagFor(strong), 'user', `for existing tag: ${strong}`);
  }
});
