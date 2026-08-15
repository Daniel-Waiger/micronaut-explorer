// Tests for engine/llmreply.js -- pulling a JSON object out of whatever a
// chat LLM actually pasted back. Adversarial by design: this is the one
// module in the chat-LLM round trip that parses genuinely untrusted,
// unstructured input, so it gets the deepest test list in the feature.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonReply } from '../src/engine/llmreply.js';

const GOOD = { proposals: [{ path: 'acquisition.modality', value: 'confocal', tag: 'llm_freetext' }] };

test('bare JSON parses directly', () => {
  const { json, issues, repairs } = extractJsonReply(JSON.stringify(GOOD), { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
  assert.equal(issues.length, 0);
  assert.equal(repairs.length, 0);
});

test('pretty-printed JSON with leading/trailing whitespace and a BOM parses', () => {
  const text = `﻿  \n${JSON.stringify(GOOD, null, 2)}\n  `;
  const { json, issues } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
  assert.equal(issues.length, 0);
});

test('```json fenced block with prose before AND after extracts cleanly', () => {
  const text = `Sure! Here's the JSON:\n\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\n\nLet me know if you'd like changes!`;
  const { json, issues } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
  assert.equal(issues.length, 0);
});

test('bare ``` fence with no language tag extracts cleanly', () => {
  const text = `\`\`\`\n${JSON.stringify(GOOD)}\n\`\`\``;
  const { json } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
});

test('two fenced blocks -- picks the one that actually has requireKey', () => {
  const text = [
    'First, some unrelated snippet:',
    '```json',
    '{"note": "not what you want"}',
    '```',
    'And the actual answer:',
    '```json',
    JSON.stringify(GOOD),
    '```',
  ].join('\n');
  const { json } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
});

test('a stray {} earlier in prose is skipped in favor of the real object', () => {
  const text = `Something like {} might work, but here's the full answer: ${JSON.stringify(GOOD)}`;
  const { json } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
});

test('a "}" inside a string value does not truncate the object', () => {
  const withBraceInString = { proposals: [{ path: 'naming.fields.notes', value: 'n=3 }} weird', tag: 'llm_freetext' }] };
  const { json, issues } = extractJsonReply(JSON.stringify(withBraceInString), { requireKey: 'proposals' });
  assert.deepEqual(json, withBraceInString);
  assert.equal(issues.length, 0);
});

test('an escaped quote inside a string value is handled correctly', () => {
  const withEscapedQuote = { proposals: [{ path: 'naming.fields.notes', value: 'the \\" marker', tag: 'llm_freetext' }] };
  const { json } = extractJsonReply(JSON.stringify(withEscapedQuote), { requireKey: 'proposals' });
  assert.deepEqual(json, withEscapedQuote);
});

test('a bare array is wrapped as {[requireKey]: value} and the repair is reported', () => {
  const arr = GOOD.proposals;
  const { json, repairs, issues } = extractJsonReply(JSON.stringify(arr), { requireKey: 'proposals' });
  assert.deepEqual(json, { proposals: arr });
  assert.equal(issues.length, 0);
  assert.ok(repairs.some((r) => /wrapped a bare list/.test(r)));
});

test('curly quotes are repaired only as a last resort, and the repair is reported', () => {
  const curlyText = `{“proposals”:[{“path”:“naming.fields.notes”,“value”:“ok”,“tag”:“llm_freetext”}]}`;
  const { json, repairs, issues } = extractJsonReply(curlyText, { requireKey: 'proposals' });
  assert.deepEqual(json, { proposals: [{ path: 'naming.fields.notes', value: 'ok', tag: 'llm_freetext' }] });
  assert.equal(issues.length, 0);
  assert.ok(repairs.some((r) => /curly quotes/.test(r)));
});

test('curly quotes INSIDE an already-valid string value are left untouched -- no repair fires', () => {
  const withCurlyInValue = {
    proposals: [{ path: 'naming.fields.notes', value: 'the “special” marker', tag: 'llm_freetext' }],
  };
  const { json, repairs } = extractJsonReply(JSON.stringify(withCurlyInValue), { requireKey: 'proposals' });
  assert.deepEqual(json, withCurlyInValue);
  assert.equal(repairs.length, 0, 'strict parse already succeeded -- no repair pass should have run');
});

test('a trailing comma before } or ] is repaired and reported', () => {
  const text = '{"proposals":[{"path":"naming.fields.notes","value":"ok","tag":"llm_freetext",},],}';
  const { json, repairs, issues } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, { proposals: [{ path: 'naming.fields.notes', value: 'ok', tag: 'llm_freetext' }] });
  assert.equal(issues.length, 0);
  assert.ok(repairs.some((r) => /trailing comma/.test(r)));
});

test('unquoted keys are NOT accepted -- no relaxed parser, must fail with a clear issue', () => {
  const text = '{proposals:[{path:"naming.fields.notes",value:"ok",tag:"llm_freetext"}]}';
  const { json, issues } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.equal(json, null);
  assert.ok(issues.length > 0);
});

test('TOTAL: empty, whitespace, null, undefined, a number, an array, or a bare string never throw and yield null', () => {
  for (const bad of ['', '   \n\t  ', null, undefined, 42, [], '"just a string"']) {
    assert.doesNotThrow(() => extractJsonReply(bad, { requireKey: 'proposals' }), String(bad));
    const { json, issues } = extractJsonReply(bad, { requireKey: 'proposals' });
    assert.equal(json, null, String(bad));
    assert.ok(issues.length > 0, String(bad));
  }
});

test('a bare array is NOT accepted when no requireKey was given -- only objects count', () => {
  const { json, issues } = extractJsonReply('[1,2,3]');
  assert.equal(json, null);
  assert.ok(issues.length > 0);
});

test('200KB of prose with the real object at the very end is still found', () => {
  const padding = 'This is filler prose about the experiment. '.repeat(4500); // ~200KB
  const text = `${padding}\n\nFinal answer: ${JSON.stringify(GOOD)}`;
  const { json, issues } = extractJsonReply(text, { requireKey: 'proposals' });
  assert.deepEqual(json, GOOD);
  assert.equal(issues.length, 0);
});

test('an oversized paste (over the size cap) is refused rather than scanned', () => {
  const huge = 'x'.repeat(1000001);
  const { json, issues } = extractJsonReply(huge, { requireKey: 'proposals' });
  assert.equal(json, null);
  assert.match(issues[0].message, /too large/);
});

test('a paste with far more than the candidate-start cap worth of braces gives up rather than hanging', () => {
  const manyBraces = '{ '.repeat(500) + JSON.stringify(GOOD);
  assert.doesNotThrow(() => extractJsonReply(manyBraces, { requireKey: 'proposals' }));
});

test('without requireKey, the first parseable object wins', () => {
  const { json } = extractJsonReply('some prose {"a":1} more prose {"b":2}');
  assert.deepEqual(json, { a: 1 });
});
