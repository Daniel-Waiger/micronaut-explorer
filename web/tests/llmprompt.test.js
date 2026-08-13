// Tests for engine/render/llmprompt.js -- the "export for your own LLM"
// prompt + JSON builder (Wave 2D, alpha-pilot-readiness).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderLlmPrompt } from '../src/engine/render/llmprompt.js';
import { renderJson } from '../src/engine/render/json.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { NAMING_CONFIG, BASE_TEMPLATE, realKb } from './fixtures.js';

test('contains the ground rules that keep the model from inventing domain facts', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const prompt = renderLlmPrompt(doc);
  assert.match(prompt, /Do not invent a marker/);
  assert.match(prompt, /say that it is missing/);
  assert.match(prompt, /not yet reviewed by a microscopy specialist/i);
  assert.match(prompt, /planning aid, not a validated instrument model/);
});

test('embeds the study JSON byte-identically to the raw-data export -- one serialization, not two', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const prompt = renderLlmPrompt(doc);
  assert.ok(prompt.includes(renderJson(doc)));
});

test('includes suggested questions the user can just send as-is', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const prompt = renderLlmPrompt(doc);
  assert.match(prompt, /QUESTIONS TO CONSIDER/);
  assert.match(prompt, /missing from my controls/);
});

test('TOTAL: never throws on a malformed/missing document, and says so honestly rather than pasting a broken block', () => {
  for (const bad of [undefined, null, {}, 'nope']) {
    assert.doesNotThrow(() => renderLlmPrompt(bad), String(bad));
  }
  assert.ok(renderLlmPrompt(undefined).includes('null'));
});

test('deterministic: same document in, byte-identical prompt out', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(renderLlmPrompt(doc), renderLlmPrompt(doc));
});
