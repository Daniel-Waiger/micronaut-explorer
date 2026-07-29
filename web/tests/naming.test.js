// Verbatim-intent port of tests/test_naming.py. Every assertion there has a
// counterpart here; buildFilename is not exported by naming.js so it is
// composed locally exactly as the Python original composes it:
// build_filename = render_name(finalize_fields(...)).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizeFields,
  isReservedWindowsStem,
  normalizeFields,
  renderName,
  repairReservedStem,
  sanitizeToken,
} from '../src/engine/naming.js';

function defaultConfig() {
  return {
    template: '{date}_{exptype}_{sample}_{magnification}_{markers}_{notes}{ext}',
    defaults: {
      date: '1970-01-01',
      exptype: 'UNKNOWN',
      sample: 'UNKNOWN',
      magnification: 'UNKNOWN',
      markers: 'UNKNOWN',
      notes: 'UNSPECIFIED',
    },
    uppercaseFields: ['exptype', 'sample', 'magnification', 'markers'],
    safeCharPattern: '[^A-Za-z0-9_-]+',
  };
}

function buildFilename(sourceName, extracted, config) {
  return renderName(finalizeFields(sourceName, extracted, config), config);
}

test('sanitizeToken removes unsafe chars', () => {
  const config = defaultConfig();
  assert.equal(sanitizeToken(' GFP + DAPI ', config), 'GFP__DAPI');
  assert.equal(sanitizeToken('***', config), 'UNSPECIFIED');
});

test('normalizeFields applies uppercase policy', () => {
  const config = defaultConfig();
  const fields = {
    exptype: 'ct',
    sample: 'e1',
    notes: 'Trial-1b',
    date: '2026-07-22',
  };
  const normalized = normalizeFields(fields, config);
  assert.equal(normalized.exptype, 'CT');
  assert.equal(normalized.sample, 'E1');
  // "notes" is not in uppercaseFields, so mixed case survives.
  assert.equal(normalized.notes, 'Trial-1b');
  assert.equal(normalized.date, '2026-07-22');
});

test('buildFilename uses defaults and extension', () => {
  const config = defaultConfig();
  const extracted = { date: '2026-07-22', sample: 'E03' };

  const result = buildFilename('image_a.tif', extracted, config);
  assert.ok(result.startsWith('2026-07-22_UNKNOWN_E03_'));
  assert.ok(result.endsWith('.tif'));
});

test('finalizeFields merges defaults once', () => {
  const config = defaultConfig();
  const extracted = { sample: 'e03' };

  const fields = finalizeFields('image_a.tif', extracted, config);

  // Extracted value wins; everything else falls back to config.defaults.
  assert.equal(fields.sample, 'E03');
  assert.equal(fields.exptype, config.defaults.exptype);
  assert.equal(fields.magnification, config.defaults.magnification);
  assert.equal(fields.markers, config.defaults.markers);
  assert.equal(fields.notes, config.defaults.notes);
  assert.equal(fields.date, config.defaults.date);
});

test('finalizeFields sets extension lowercase and unsanitized', () => {
  const config = defaultConfig();

  const fields = finalizeFields('image_a.TIF', {}, config);
  assert.equal(fields.ext, '.tif');

  // Missing suffix falls back to the default ".tif".
  const fieldsNoSuffix = finalizeFields('image_a', {}, config);
  assert.equal(fieldsNoSuffix.ext, '.tif');
});

test('finalizeFields preserves .ome.tif compound extension', () => {
  const config = defaultConfig();

  const fields = finalizeFields('foo.ome.tif', {}, config);
  assert.equal(fields.ext, '.ome.tif');
  assert.ok(buildFilename('foo.ome.tif', {}, config).endsWith('.ome.tif'));
});

test('finalizeFields preserves .ome.tiff compound extension', () => {
  const config = defaultConfig();

  const fields = finalizeFields('foo.ome.tiff', {}, config);
  assert.equal(fields.ext, '.ome.tiff');
  assert.ok(buildFilename('foo.ome.tiff', {}, config).endsWith('.ome.tiff'));
});

test('finalizeFields leaves non-OME extensions unchanged', () => {
  const config = defaultConfig();

  assert.ok(buildFilename('bar.tif', {}, config).endsWith('.tif'));
  assert.ok(buildFilename('baz.czi', {}, config).endsWith('.czi'));
});

test('finalizeFields applies uppercase policy to the correct fields', () => {
  const config = defaultConfig();
  const extracted = {
    exptype: 'ct',
    sample: 'e1',
    notes: 'Trial-1b',
    date: '2026-07-22',
  };

  const fields = finalizeFields('image.czi', extracted, config);

  assert.equal(fields.exptype, 'CT');
  assert.equal(fields.sample, 'E1');
  // "notes" is not in uppercaseFields, so mixed case survives.
  assert.equal(fields.notes, 'Trial-1b');
  // "date" is not in uppercaseFields, so it must stay unchanged.
  assert.equal(fields.date, '2026-07-22');
  // ext must never be uppercased or sanitized.
  assert.equal(fields.ext, '.czi');
});

test('renderName collapses duplicate separators', () => {
  const config = defaultConfig();
  const fields = {
    date: '2026-07-22',
    exptype: 'CT',
    sample: 'E03',
    magnification: 'X90',
    markers: '',
    notes: 'UNSPECIFIED',
    ext: '.tif',
  };

  assert.equal(renderName(fields, config), '2026-07-22_CT_E03_X90_UNSPECIFIED.tif');
});

test('renderName strips separator before extension', () => {
  const config = defaultConfig();
  const fields = {
    date: '2026-07-22',
    exptype: 'CT',
    sample: 'E03',
    magnification: 'X90',
    markers: 'ARL',
    notes: '',
    ext: '.tif',
  };

  assert.equal(renderName(fields, config), '2026-07-22_CT_E03_X90_ARL.tif');
});

test('isReservedWindowsStem matches device names case-insensitively', () => {
  for (const stem of ['CON', 'con', 'Con', 'PRN', 'AUX', 'NUL', 'COM1', 'com1', 'LPT9']) {
    assert.ok(isReservedWindowsStem(stem), stem);
  }
  for (const stem of ['CONSOLE', 'ICON', 'COM10', 'COMPANY', 'LPT', 'sample01']) {
    assert.ok(!isReservedWindowsStem(stem), stem);
  }
});

test('repairReservedStem leaves safe stems unchanged', () => {
  assert.equal(repairReservedStem('2026-07-22_CT_E03'), '2026-07-22_CT_E03');
});

test('repairReservedStem repairs reserved names', () => {
  const repaired = repairReservedStem('CON');
  assert.notEqual(repaired, 'CON');
  assert.ok(!isReservedWindowsStem(repaired));

  const repairedLower = repairReservedStem('com1');
  assert.ok(!isReservedWindowsStem(repairedLower));
});

test('renderName repairs a template that collapses to a reserved stem', () => {
  // A minimal template whose only content is a reserved device name -- this
  // stands in for a lab whose "sample" field is literally e.g. "CON".
  const config = { ...defaultConfig(), template: '{sample}{ext}' };
  const fields = { sample: 'CON', ext: '.tif' };

  const result = renderName(fields, config);

  assert.notEqual(result, 'CON.tif');
  assert.ok(!isReservedWindowsStem(result.replace(/\.tif$/, '')));
});

test('renderName repairs com1 case-insensitively', () => {
  const config = { ...defaultConfig(), template: '{sample}{ext}' };
  const fields = { sample: 'com1', ext: '.tif' };

  const result = renderName(fields, config);

  assert.notEqual(result.toUpperCase(), 'COM1.TIF');
  assert.ok(!isReservedWindowsStem(result.replace(/\.tif$/i, '')));
});

test('renderName does not repair non-reserved stems', () => {
  const config = { ...defaultConfig(), template: '{sample}{ext}' };
  const fields = { sample: 'CONSOLE', ext: '.tif' };

  assert.equal(renderName(fields, config), 'CONSOLE.tif');
});
