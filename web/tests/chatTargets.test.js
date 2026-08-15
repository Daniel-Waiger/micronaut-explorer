// Tests for llm/chatTargets.js -- prefilled link-outs to a hosted chat LLM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_TARGETS, buildChatUrl, MAX_PREFILL_URL_CHARS } from '../src/llm/chatTargets.js';

test('every target origin is https', () => {
  for (const target of CHAT_TARGETS) {
    assert.match(target.origin, /^https:\/\//, target.id);
  }
});

test('a short prompt under budget is prefilled, and decodes back to the original', () => {
  const target = CHAT_TARGETS[0];
  const prompt = 'a short prompt';
  const { url, prefilled } = buildChatUrl(target, prompt);
  assert.equal(prefilled, true);
  const decoded = decodeURIComponent(new URL(url).searchParams.get(target.param));
  assert.equal(decoded, prompt);
});

test('a prompt whose ENCODED length exceeds the budget is not prefilled, even if the raw text is short', () => {
  const target = CHAT_TARGETS[0];
  // Every character encodes to %XX (3x inflation) so this is short raw but long encoded.
  const inflating = '\n'.repeat(Math.ceil(MAX_PREFILL_URL_CHARS / 2));
  const { url, prefilled } = buildChatUrl(target, inflating, MAX_PREFILL_URL_CHARS);
  assert.equal(prefilled, false);
  assert.equal(url, target.origin);
});

test('over budget returns the bare origin, never a truncated prompt', () => {
  const target = CHAT_TARGETS[0];
  const huge = 'x'.repeat(MAX_PREFILL_URL_CHARS * 2);
  const { url, prefilled } = buildChatUrl(target, huge);
  assert.equal(prefilled, false);
  assert.equal(url, target.origin);
  assert.ok(!url.includes('x'.repeat(10)), 'must not contain a truncated slice of the prompt');
});

test('length accounting is on the full encoded URL, not just the prompt', () => {
  const target = { id: 'x', origin: 'https://example.com/chat', param: 'q' };
  // Raw prompt alone is under maxChars, but origin + param + encoding pushes it over.
  const prompt = 'y'.repeat(30);
  const maxChars = target.origin.length + 5; // deliberately too tight to fit origin+param+prompt
  const { prefilled } = buildChatUrl(target, prompt, maxChars);
  assert.equal(prefilled, false);
});

test('TOTAL: undefined/null target or prompt never throws', () => {
  for (const [target, prompt] of [
    [undefined, undefined],
    [null, null],
    [{}, 'hello'],
    [CHAT_TARGETS[0], undefined],
    [CHAT_TARGETS[0], null],
    [CHAT_TARGETS[0], 42],
  ]) {
    assert.doesNotThrow(() => buildChatUrl(target, prompt), JSON.stringify({ target, prompt }));
  }
});

test('an empty prompt yields prefilled:false rather than an empty ?q= param', () => {
  const { url, prefilled } = buildChatUrl(CHAT_TARGETS[0], '');
  assert.equal(prefilled, false);
  assert.equal(url, CHAT_TARGETS[0].origin);
});
