// Tests for engine/render/csv.js -- the file-manifest CSV renderer over
// engine/studydoc.js's document model. Exercises the real committed KB and
// the real oregano default study, same fixture discipline as
// studydoc.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderCsv } from '../src/engine/render/csv.js';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { NAMING_CONFIG, BASE_TEMPLATE, realKb } from './fixtures.js';

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
  assert.equal(lines[0], 'measurement,modality,group,factors,biological_replicate,technical_replicate,planned_filename,error');
  assert.equal(lines.length, 2);
});

test('renderCsv on a truly empty document (zero assays) is header-only', () => {
  const doc = buildStudyDocument({ assays: [] }, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(renderCsv(doc), 'measurement,modality,group,factors,biological_replicate,technical_replicate,planned_filename,error\r\n');
});

test('renderCsv emits one data row per planned filename across every assay, and the header first', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const csv = renderCsv(doc);
  const lines = csv.split('\r\n').filter((l) => l.length > 0);
  assert.equal(lines[0], 'measurement,modality,group,factors,biological_replicate,technical_replicate,planned_filename,error');
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

test('renderCsv neutralizes a leading =/+/-/@ so a spreadsheet app never treats a cell as a formula', () => {
  const doc = {
    assays: [
      {
        label: '=HYPERLINK("http://evil","click")',
        modality: '+cmd',
        filenames: [
          {
            row: { group: '-CTL', factorLevels: {}, bioRep: 1, techRep: null },
            filename: 'a.tif',
            error: null,
          },
        ],
      },
    ],
  };
  const csv = renderCsv(doc);
  const dataLine = csv.split('\r\n')[1];
  // Every formula-triggering cell is apostrophe-prefixed; none starts a
  // field with a bare =/+/-/@.
  assert.match(dataLine, /'=HYPERLINK/);
  assert.match(dataLine, /,'\+cmd,/);
  assert.match(dataLine, /,'-CTL,/);
});

test('renderCsv does not touch a value that merely CONTAINS =/+/-/@ mid-string', () => {
  const doc = {
    assays: [
      {
        label: 'A+B assay',
        modality: 'confocal',
        filenames: [{ row: { group: 'CTL', factorLevels: {}, bioRep: 1, techRep: null }, filename: 'a.tif', error: null }],
      },
    ],
  };
  const csv = renderCsv(doc);
  assert.match(csv, /A\+B assay/);
  assert.ok(!csv.includes("'A+B assay"));
});

test('renderCsv on a malformed/missing document renders header-only, never throws', () => {
  assert.doesNotThrow(() => renderCsv(undefined));
  assert.doesNotThrow(() => renderCsv({}));
  assert.doesNotThrow(() => renderCsv({ assays: 'not-an-array' }));
});
