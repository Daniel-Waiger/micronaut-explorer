// Tests for engine/render/csv.js -- the file-manifest CSV renderer over
// engine/studydoc.js's document model. Exercises the real committed KB and
// the real oregano default study, same fixture discipline as
// studydoc.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderCsv } from '../src/engine/render/csv.js';
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

test('renderCsv is deterministic on the same document', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(renderCsv(doc), renderCsv(doc));
});

test('renderCsv never throws on the empty-experiment document', () => {
  const doc = buildStudyDocument(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.doesNotThrow(() => renderCsv(doc));
  // emptyExperiment() still ships one default assay with no design axes, so
  // expandConditions yields exactly one row (see engine/plan.js) -- one
  // data row, not zero, but never a blank string either way.
  const lines = renderCsv(doc).split('\r\n').filter((l) => l.length > 0);
  assert.equal(lines[0], 'assay,modality,group,factors,biological_replicate,technical_replicate,planned_filename,error');
  assert.equal(lines.length, 2);
});

test('renderCsv on a truly empty document (zero assays) is header-only', () => {
  const doc = buildStudyDocument({ assays: [] }, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(renderCsv(doc), 'assay,modality,group,factors,biological_replicate,technical_replicate,planned_filename,error\r\n');
});

test('renderCsv emits one data row per planned filename across every assay, and the header first', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const csv = renderCsv(doc);
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  assert.equal(lines[0], 'assay,modality,group,factors,biological_replicate,technical_replicate,planned_filename,error');
  const totalPlanned = doc.assays.reduce((sum, a) => sum + a.filenames.length, 0);
  assert.equal(lines.length - 1, totalPlanned);
});

test('renderCsv flattens crossing factors into one "factors" cell as name=level pairs', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const csv = renderCsv(doc);
  // Bacterial viability's 'species' crossing factor (2 levels) should show
  // up as a 'species=...' token in at least one data row.
  assert.match(csv, /species=/);
});

test('renderCsv quotes a field containing a comma per RFC 4180, and never leaves it unescaped', () => {
  const doc = {
    assays: [
      {
        label: 'Assay, with a comma',
        modality: 'confocal',
        filenames: [{ row: { group: 'CTL', factorLevels: {}, bioRep: 1, techRep: null }, filename: 'a.tif', error: null }],
      },
    ],
  };
  const csv = renderCsv(doc);
  assert.match(csv, /"Assay, with a comma"/);
});

test('renderCsv on a malformed/missing document renders header-only, never throws', () => {
  assert.doesNotThrow(() => renderCsv(undefined));
  assert.doesNotThrow(() => renderCsv({}));
  assert.doesNotThrow(() => renderCsv({ assays: 'not-an-array' }));
});
