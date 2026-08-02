// Tests for engine/render/json.js -- the raw-data JSON renderer over
// engine/studydoc.js's document model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderJson } from '../src/engine/render/json.js';
import { shapeAppKb } from '../src/engine/kbpack.js';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';

const NAMING_CONFIG = {
  template: '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}',
  defaults: {
    date: '1970-01-01',
    modality: 'UNKNOWN',
    exptype: 'UNKNOWN',
    markers: 'UNKNOWN',
    magnification: 'UNKNOWN',
    sample: 'UNKNOWN',
  },
  optionalFields: ['group', 'biorep', 'techrep', 'notes'],
  uppercaseFields: ['modality', 'exptype', 'sample', 'magnification', 'markers', 'group'],
  safeCharPattern: '[^A-Za-z0-9_-]+',
};
const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';

const here = path.dirname(fileURLToPath(import.meta.url));
function readKbJson(stem) {
  return JSON.parse(readFileSync(path.join(here, '..', 'kb', `${stem}.json`), 'utf-8'));
}

function realKb() {
  return shapeAppKb({
    markers: readKbJson('markers'),
    questions: readKbJson('questions'),
    advisor: readKbJson('advisor'),
    readouts: readKbJson('readouts'),
    controls: readKbJson('controls'),
    stages: readKbJson('stages'),
  });
}

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
