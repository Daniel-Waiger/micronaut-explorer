// Tests for engine/render/json.js -- the raw-data JSON renderer over
// engine/studydoc.js's document model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderJson } from '../src/engine/render/json.js';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { NAMING_CONFIG, BASE_TEMPLATE, realKb } from './fixtures.js';

test('renderJson is deterministic on the same document', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(renderJson(doc), renderJson(doc));
});

test('renderJson round-trips the document losslessly', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const parsed = JSON.parse(renderJson(doc));
  assert.deepEqual(parsed, doc);
});

test('renderJson never throws on the empty-experiment document', () => {
  const doc = buildStudyDocument(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.doesNotThrow(() => renderJson(doc));
  assert.doesNotThrow(() => JSON.parse(renderJson(doc)));
});

test('renderJson on undefined/null input never throws and produces valid JSON', () => {
  assert.doesNotThrow(() => renderJson(undefined));
  assert.doesNotThrow(() => renderJson(null));
  assert.equal(renderJson(undefined), 'null');
  assert.equal(renderJson(null), 'null');
});
