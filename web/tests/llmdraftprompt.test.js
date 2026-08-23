// Tests for engine/render/llmdraftprompt.js -- the copy-out prompt for the
// chat-LLM round trip. The round-trip tests at the bottom are the ones that
// actually matter: they prove the prompt this module renders and the
// validator in engine/llmproposals.js agree with each other, not just that
// each looks right in isolation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuestions } from '../src/engine/interview.js';
import { parseLlmAsks, parseLlmProposals } from '../src/engine/llmproposals.js';
import { extractJsonReply } from '../src/engine/llmreply.js';
import { renderProposalRequestPrompt, renderQuestionLines } from '../src/engine/render/llmdraftprompt.js';
import { realKb } from './fixtures.js';

function realQuestions() {
  return loadQuestions(realKb().questions).questions;
}

test('the prompt states the output contract', () => {
  const prompt = renderProposalRequestPrompt(realQuestions(), 'a description');
  assert.match(prompt, /"proposals"/);
  assert.match(prompt, /"evidence"/);
  assert.match(prompt, /"tag":\s*"llm_freetext"/);
  assert.match(prompt, /ONE JSON object and nothing else/);
  assert.match(prompt, /discarded without being read/);
});

test('the prompt requires a verbatim narrative quote and prefers omission to guessing', () => {
  const prompt = renderProposalRequestPrompt(realQuestions(), 'a description');
  assert.match(prompt, /MUST include a non-empty "evidence" quote copied verbatim/);
  assert.match(prompt, /character-for-character substring of DESCRIPTION/);
  assert.match(prompt, /Never make a proposal without that exact narrative quote/);
  assert.match(prompt, /An omission is\n  correct and expected; guessing is not/);
  assert.match(prompt, /Unsupported prose remains saved narrative,\n  not structured data/);
  assert.match(prompt, /"asks" is optional/);
  assert.match(prompt, /Omit it or use "asks": \[\] if nothing applies/);
});

test('every question field appears verbatim in the rendered lines', () => {
  const questions = realQuestions();
  const lines = renderQuestionLines(questions);
  for (const q of questions) {
    assert.ok(lines.includes(`- ${q.field}:`), `missing field: ${q.field}`);
  }
});

test('acquisition.modality renders all 7 options, quoted and pipe-separated', () => {
  const questions = realQuestions();
  const lines = renderQuestionLines(questions);
  const modality = questions.find((q) => q.field === 'acquisition.modality');
  assert.ok(modality, 'fixture must have acquisition.modality');
  for (const opt of modality.options) {
    assert.ok(lines.includes(`"${opt}"`), `missing quoted option: ${opt}`);
  }
  assert.ok(lines.includes('"confocal" | "widefield"') || /".*" \| ".*"/.test(lines));
});

test('readoutText renders all 4 options, including the slash-and-spaces and hyphen cases', () => {
  const questions = realQuestions();
  const lines = renderQuestionLines(questions);
  const readout = questions.find((q) => q.field === 'readoutText');
  assert.ok(readout, 'fixture must have readoutText');
  assert.ok(lines.includes('"Scratch / migration"'), 'slash+spaces option must be quoted exactly');
  for (const opt of readout.options) {
    assert.ok(lines.includes(`"${opt}"`), `missing quoted option: ${opt}`);
  }
});

test('"light-sheet" (hyphenated modality option) renders exactly, not split or mangled', () => {
  const lines = renderQuestionLines(realQuestions());
  assert.ok(lines.includes('"light-sheet"'));
});

test('number-typed questions are marked (number); text/choice questions are not', () => {
  const questions = realQuestions();
  const lines = renderQuestionLines(questions);
  const linesByField = new Map(lines.split('\n').filter((l) => l.startsWith('- ')).map((l) => [l.split(':')[0].slice(2), l]));

  const numberField = questions.find((q) => q.type === 'number').field;
  assert.match(linesByField.get(numberField), /\(number\)/);

  const textField = questions.find((q) => q.type === 'text').field;
  assert.doesNotMatch(linesByField.get(textField), /\(number\)/);
});

test('the prompt never mentions an "Other" escape hatch -- model values are never allowed off-vocabulary', () => {
  const prompt = renderProposalRequestPrompt(realQuestions(), 'a description');
  assert.doesNotMatch(prompt, /\bOther\b/);
});

test('the narrative is embedded byte-for-byte, including whitespace, backticks, and braces', () => {
  const tricky = '  Uses a ```fenced``` block and { curly braces } in the description.  \n';
  const prompt = renderProposalRequestPrompt(realQuestions(), tricky);
  assert.ok(prompt.includes(tricky));
});

test('rendering is deterministic', () => {
  const questions = realQuestions();
  const a = renderProposalRequestPrompt(questions, 'same description');
  const b = renderProposalRequestPrompt(questions, 'same description');
  assert.equal(a, b);
});

test('TOTAL: undefined/null/malformed inputs never throw and still carry the contract', () => {
  for (const [q, narrative] of [
    [undefined, undefined],
    [null, 5],
    ['nope', {}],
    [[], null],
  ]) {
    assert.doesNotThrow(() => renderProposalRequestPrompt(q, narrative));
    const prompt = renderProposalRequestPrompt(q, narrative);
    assert.match(prompt, /"proposals"/);
  }
});

test('ROUND TRIP: a literal evidence-backed reply follows the prompt and current parser contract', () => {
  const questions = realQuestions();
  const modality = questions.find((q) => q.field === 'acquisition.modality');
  const readout = questions.find((q) => q.field === 'readoutText');
  const narrative = 'We will use confocal imaging to measure scratch closure with DAPI and Alexa 488 in three biological replicates.';

  const reply = {
    proposals: [
      { path: modality.field, value: modality.options[0], evidence: 'confocal imaging', tag: 'llm_freetext' },
      { path: readout.field, value: 'Scratch / migration', evidence: 'scratch closure', tag: 'llm_freetext' },
      { path: 'naming.fields.notes', value: 'a free-text note', evidence: 'DAPI and Alexa 488', tag: 'llm_freetext' },
      { path: 'design.biologicalReplicates', value: 3, evidence: 'three biological replicates', tag: 'llm_freetext' },
    ],
    asks: [{ topic: 'smallest feature to resolve', why: 'not stated in the description' }],
  };

  for (const proposal of reply.proposals) {
    assert.ok(narrative.includes(proposal.evidence), `evidence must be a literal narrative quote: ${proposal.path}`);
  }

  const pasted = `Here's the answer:\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`\nHope that helps!`;
  const { json, issues: replyIssues } = extractJsonReply(pasted, { requireKey: 'proposals' });
  assert.equal(replyIssues.length, 0);

  const { proposals, issues } = parseLlmProposals(json, questions, { narrative });
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(proposals.length, 4);

  const { asks, issues: askIssues } = parseLlmAsks(json);
  assert.equal(askIssues.length, 0, JSON.stringify(askIssues));
  assert.deepEqual(asks, reply.asks);
});

test('ROUND TRIP (negative): wrong-case value against a CHOICES field is dropped, proving exact-copy matters', () => {
  const questions = realQuestions();
  const modality = questions.find((q) => q.field === 'acquisition.modality');
  const wrongCase = modality.options[0].toUpperCase();
  assert.notEqual(wrongCase, modality.options[0], 'fixture option must not already be all-caps');

  const narrative = 'Confocal imaging is planned.';
  const reply = { proposals: [{ path: modality.field, value: wrongCase, evidence: 'Confocal imaging', tag: 'llm_freetext' }] };
  const { proposals, issues } = parseLlmProposals(reply, questions, { narrative });
  assert.equal(proposals.length, 0);
  assert.match(issues[0].message, /not one of this question's options/);
});
