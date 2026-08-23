// Tests for engine/llmproposals.js -- converting a model's reply into
// review-ready proposals, and refusing everything outside the app's own
// vocabulary even when constrained decoding should already have prevented it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuestions } from '../src/engine/interview.js';
import { parseLlmProposals, parseLlmAsks } from '../src/engine/llmproposals.js';

const RAW_QUESTIONS = [
  { id: 'q-modality', field: 'acquisition.modality', type: 'choice', prompt: 'Modality?', options: ['Confocal', 'STED'] },
  { id: 'q-notes', field: 'naming.fields.notes', type: 'text', prompt: 'Notes?' },
  { id: 'q-n', field: 'design.biologicalReplicates', type: 'number', prompt: 'Replicates?' },
  { id: 'q-other', field: 'specimen.organism', type: 'choice', prompt: 'Organism?', options: ['Mouse'], allowOther: true },
];

function questions() {
  return loadQuestions(RAW_QUESTIONS).questions;
}

test('a valid reply becomes proposals tagged llm_freetext (PROVISIONAL), carrying the question they answer', () => {
  const reply = { proposals: [{ path: 'acquisition.modality', value: 'STED', evidence: 'STED imaging', tag: 'llm_freetext' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions(), { narrative: 'STED imaging of a tissue section.' });
  assert.equal(issues.length, 0);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].path, 'acquisition.modality');
  assert.equal(proposals[0].value, 'STED');
  assert.equal(proposals[0].tag, 'llm_freetext');
  assert.equal(proposals[0].questionId, 'q-modality');
  assert.equal(proposals[0].evidence, 'STED imaging');
  assert.notEqual(proposals[0].evidence, 'Modality?', 'the parser must never substitute question text as evidence');
});

test('the same plausible value is rejected without a literal narrative quote and accepted with one', () => {
  const reply = { proposals: [{ path: 'acquisition.modality', value: 'STED', evidence: 'high-resolution imaging' }] };
  const narrative = 'STED imaging of a tissue section.';

  const rejected = parseLlmProposals(reply, questions(), { narrative });
  assert.equal(rejected.proposals.length, 0);
  assert.match(rejected.issues[0].message, /not a verbatim narrative quote/);

  reply.proposals[0].evidence = 'STED imaging';
  const accepted = parseLlmProposals(reply, questions(), { narrative });
  assert.equal(accepted.issues.length, 0);
  assert.equal(accepted.proposals.length, 1);
  assert.equal(accepted.proposals[0].evidence, 'STED imaging');
});

test('evidence must be non-empty, bounded, and character-for-character -- including multiline quoted text', () => {
  const narrative = 'Protocol note:\n"Use STED"\nfor the high-resolution image.';
  const base = { path: 'acquisition.modality', value: 'STED' };

  for (const [evidence, expectedIssue] of [
    [undefined, /missing a non-empty evidence quote/],
    ['', /missing a non-empty evidence quote/],
    ['x'.repeat(501), /evidence exceeds 500 characters/],
  ]) {
    const { proposals, issues } = parseLlmProposals({ proposals: [{ ...base, evidence }] }, questions(), { narrative });
    assert.equal(proposals.length, 0);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, expectedIssue);
  }

  const { proposals, issues } = parseLlmProposals(
    { proposals: [{ ...base, evidence: '\n"Use STED"\n' }] },
    questions(),
    { narrative }
  );
  assert.equal(issues.length, 0);
  assert.equal(proposals[0].evidence, '\n"Use STED"\n');
});

test('a value outside the question options is DROPPED and reported, even though the schema should have prevented it', () => {
  const reply = { proposals: [{ path: 'acquisition.modality', value: 'Cryo-EM', evidence: 'Confocal imaging' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions(), { narrative: 'Confocal imaging is planned.' });
  assert.equal(proposals.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /not one of this question's options/);
});

test('allowOther does not relax the vocabulary check -- the escape hatch is the user\'s, not the model\'s', () => {
  const reply = { proposals: [{ path: 'specimen.organism', value: 'Zebrafish' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions());
  assert.equal(proposals.length, 0);
  assert.match(issues[0].message, /not one of this question's options/);
});

test('a path no question writes to is dropped and reported', () => {
  const reply = { proposals: [{ path: 'meta.title', value: 'sneaky' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions());
  assert.equal(proposals.length, 0);
  assert.match(issues[0].message, /no question writes to/);
});

test('a model-supplied tag is never echoed -- a reply cannot claim STRONG provenance for itself', () => {
  const reply = { proposals: [{ path: 'naming.fields.notes', value: 'ok', evidence: 'ok', tag: 'user' }] };
  const { proposals } = parseLlmProposals(reply, questions(), { narrative: 'ok' });
  assert.equal(proposals[0].tag, 'llm_freetext');
});

test('free-text questions accept any value -- only curated vocabulary is locked down', () => {
  const reply = { proposals: [{ path: 'naming.fields.notes', value: 'anything at all' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions());
  assert.equal(issues.length, 0);
  assert.equal(proposals[0].value, 'anything at all');
});

test('number questions coerce, and a non-numeric value is dropped rather than written as NaN', () => {
  const ok = parseLlmProposals({ proposals: [{ path: 'design.biologicalReplicates', value: '3' }] }, questions());
  assert.equal(ok.proposals[0].value, 3);

  const bad = parseLlmProposals({ proposals: [{ path: 'design.biologicalReplicates', value: 'three' }] }, questions());
  assert.equal(bad.proposals.length, 0);
  assert.match(bad.issues[0].message, /not a number/);
});

test('one bad proposal costs only itself -- the rest of the batch survives', () => {
  const reply = {
    proposals: [
      { path: 'acquisition.modality', value: 'STED', evidence: 'invented quote' }, // dropped
      { path: 'naming.fields.notes', value: 'kept', evidence: 'literal note' },
    ],
  };
  const { proposals, issues } = parseLlmProposals(reply, questions(), { narrative: 'A literal note is in this narrative.' });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].value, 'kept');
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /not a verbatim narrative quote/);
});

test('a duplicated path keeps the first and reports the rest -- never silently picks a winner', () => {
  const reply = {
    proposals: [
      { path: 'acquisition.modality', value: 'STED', evidence: 'STED' },
      { path: 'acquisition.modality', value: 'Confocal', evidence: 'Confocal' },
    ],
  };
  const { proposals, issues } = parseLlmProposals(reply, questions(), { narrative: 'Confocal and STED are both mentioned.' });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].value, 'STED');
  assert.match(issues[0].message, /duplicate proposal/);
});

test('proposals come back in question-bank order, not the order the model emitted them', () => {
  const reply = {
    proposals: [
      { path: 'design.biologicalReplicates', value: 3 },
      { path: 'acquisition.modality', value: 'STED' },
      { path: 'naming.fields.notes', value: 'x' },
    ],
  };
  const { proposals } = parseLlmProposals(reply, questions());
  assert.deepEqual(
    proposals.map((p) => p.path),
    ['acquisition.modality', 'naming.fields.notes', 'design.biologicalReplicates']
  );
});

test('TOTAL: malformed replies never throw and are reported honestly', () => {
  for (const bad of [undefined, null, {}, 'nope', { proposals: 'not-an-array' }, []]) {
    assert.doesNotThrow(() => parseLlmProposals(bad, questions()), String(bad));
    const { proposals, issues } = parseLlmProposals(bad, questions());
    assert.equal(proposals.length, 0);
    assert.ok(issues.length > 0);
  }
});

test('TOTAL: a malformed question bank yields no proposals rather than throwing', () => {
  const reply = { proposals: [{ path: 'acquisition.modality', value: 'STED' }] };
  for (const bad of [undefined, null, 'nope']) {
    assert.doesNotThrow(() => parseLlmProposals(reply, bad), String(bad));
    assert.equal(parseLlmProposals(reply, bad).proposals.length, 0);
  }
});

test('a non-object entry inside proposals is dropped and reported by index', () => {
  const reply = { proposals: [null, 'nope', { path: 'naming.fields.notes', value: 'kept' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions());
  assert.equal(proposals.length, 1);
  assert.equal(issues.length, 2);
  assert.match(issues[0].field, /\[0\]/);
});

// Pasting makes this input genuinely untrusted for the first time -- an
// Ollama reply is schema-constrained before it ever gets here, but a chat-LLM
// paste (engine/llmreply.js) has no such guarantee. These two assert the
// actual security boundary: a pasted reply cannot claim a write path or a
// provenance tier it was never granted.
test('a pasted reply claiming "tag":"user" still lands tagged llm_freetext -- provenance cannot be laundered through a paste', () => {
  const reply = { proposals: [{ path: 'naming.fields.notes', value: 'ok', evidence: 'ok', tag: 'user' }] };
  const { proposals } = parseLlmProposals(reply, questions(), { narrative: 'ok' });
  assert.equal(proposals[0].tag, 'llm_freetext');
});

test('__proto__ and constructor.prototype paths are dropped like any other unknown path, not specially trusted', () => {
  const reply = {
    proposals: [
      { path: '__proto__.polluted', value: 'x', evidence: 'x' },
      { path: 'constructor.prototype.x', value: 'y', evidence: 'y' },
    ],
  };
  const { proposals, issues } = parseLlmProposals(reply, questions(), { narrative: 'x y' });
  assert.equal(proposals.length, 0);
  assert.equal(issues.length, 2);
  assert.match(issues[0].message, /no question writes to/);
  assert.match(issues[1].message, /no question writes to/);
});

test('parseLlmAsks: a well-formed asks list is returned as-is, trimmed', () => {
  const reply = { asks: [{ topic: '  smallest feature to resolve  ', why: 'sets pixel size' }] };
  const { asks, issues } = parseLlmAsks(reply);
  assert.equal(issues.length, 0);
  assert.deepEqual(asks, [{ topic: 'smallest feature to resolve', why: 'sets pixel size' }]);
});

test('parseLlmAsks: a missing "asks" key is fine -- not every reply needs one', () => {
  const { asks, issues } = parseLlmAsks({ proposals: [] });
  assert.deepEqual(asks, []);
  assert.equal(issues.length, 0);
});

test('parseLlmAsks: "asks" present but not an array is reported', () => {
  const { asks, issues } = parseLlmAsks({ asks: 'not an array' });
  assert.deepEqual(asks, []);
  assert.equal(issues.length, 1);
});

test('parseLlmAsks: an entry missing "topic" is dropped and reported; "why" is optional', () => {
  const reply = { asks: [{ why: 'no topic here' }, { topic: 'valid, no why' }] };
  const { asks, issues } = parseLlmAsks(reply);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].topic, 'valid, no why');
  assert.equal(asks[0].why, '');
  assert.equal(issues.length, 1);
});

test('parseLlmAsks: long text is clamped, and an oversized list is capped with one reported issue', () => {
  const longText = 'x'.repeat(1000);
  const many = Array.from({ length: 50 }, (_, i) => ({ topic: `topic ${i}`, why: longText }));
  const { asks, issues } = parseLlmAsks({ asks: many });
  assert.ok(asks.length <= 12);
  assert.ok(asks[0].why.length < longText.length);
  assert.equal(issues.filter((i) => i.field === 'asks').length, 1, 'the cap should be reported once, not per excess entry');
});

test('parseLlmAsks TOTAL: malformed replies never throw', () => {
  for (const bad of [undefined, null, {}, 'nope', [], { asks: [null, 'nope', 42] }]) {
    assert.doesNotThrow(() => parseLlmAsks(bad), String(bad));
  }
});
