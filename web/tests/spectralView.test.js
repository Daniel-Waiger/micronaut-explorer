import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECTRAL_VIEW_DEFAULT_FWHM_NM,
  SPECTRAL_VIEW_MAX_NM,
  SPECTRAL_VIEW_MIN_NM,
  buildSpectralViewModel,
  spectralViewIntensityAt,
} from '../src/engine/spectralView.js';

function known(token, emissionPeakNm, extra = {}) {
  return {
    token,
    canonical: token.toUpperCase(),
    state: 'known',
    excitationPeakNm: emissionPeakNm - 20,
    emissionPeakNm,
    reviewStatus: 'claude-drafted',
    ...extra,
  };
}

test('Gaussian schematic is normalized at peak and half-height at either FWHM edge', () => {
  assert.equal(spectralViewIntensityAt(600, 600, 50), 1);
  assert.ok(Math.abs(spectralViewIntensityAt(575, 600, 50) - 0.5) < 1e-12);
  assert.ok(Math.abs(spectralViewIntensityAt(625, 600, 50) - 0.5) < 1e-12);
});

test('invalid Gaussian arguments degrade to zero and never throw', () => {
  for (const args of [
    [NaN, 500, 50],
    [500, Infinity, 50],
    [500, 500, 0],
    [500, 500, -1],
    ['500', 500, 50],
  ]) {
    assert.doesNotThrow(() => spectralViewIntensityAt(...args));
    assert.equal(spectralViewIntensityAt(...args), 0);
  }
});

test('view model uses the data-driven FWHM and orders curves left-to-right without mutating input', () => {
  const entries = [known('Far', 700), known('Near', 500), known('Tie B', 600), known('Tie A', 600)];
  const snapshot = structuredClone(entries);
  const model = buildSpectralViewModel(entries, { schematicEmissionFwhmNm: 72 });
  assert.equal(model.fwhmNm, 72);
  assert.deepEqual(model.curves.map((c) => c.token), ['Near', 'Tie A', 'Tie B', 'Far']);
  assert.deepEqual(entries, snapshot);
  assert.equal(model.curves[0].points[0].wavelengthNm, SPECTRAL_VIEW_MIN_NM);
  assert.equal(model.curves[0].points.at(-1).wavelengthNm, SPECTRAL_VIEW_MAX_NM);
});

test('missing or malformed FWHM uses the explicit safe schematic default', () => {
  for (const rules of [undefined, {}, { schematicEmissionFwhmNm: -1 }, { schematicEmissionFwhmNm: Infinity }]) {
    assert.equal(buildSpectralViewModel([known('A', 500)], rules).fwhmNm, SPECTRAL_VIEW_DEFAULT_FWHM_NM);
  }
});

test('a curve with its own emissionFwhmNm uses that width, not the pack-wide schematic one -- curves can differ in shape', () => {
  const entries = [known('Narrow', 500, { emissionFwhmNm: 25 }), known('Wide', 600, { emissionFwhmNm: 80 })];
  const model = buildSpectralViewModel(entries, { schematicEmissionFwhmNm: 50 });
  assert.equal(model.fwhmNm, 50, 'the model-level fallback is unaffected');
  const narrow = model.curves.find((c) => c.token === 'Narrow');
  const wide = model.curves.find((c) => c.token === 'Wide');
  assert.equal(narrow.fwhmNm, 25);
  assert.equal(wide.fwhmNm, 80);
  assert.notEqual(narrow.fwhmNm, wide.fwhmNm);
  // The actual sampled curve is narrower/wider to match: half-height sits at
  // ±fwhmNm/2 from the peak (same identity spectralViewIntensityAt asserts).
  assert.ok(Math.abs(spectralViewIntensityAt(500 + 12.5, 500, narrow.fwhmNm) - 0.5) < 1e-9);
  assert.ok(Math.abs(spectralViewIntensityAt(600 + 40, 600, wide.fwhmNm) - 0.5) < 1e-9);
});

test('a curve with no/malformed emissionFwhmNm falls back to the pack-wide schematic width', () => {
  for (const extra of [{}, { emissionFwhmNm: null }, { emissionFwhmNm: -1 }, { emissionFwhmNm: 'wide' }]) {
    const model = buildSpectralViewModel([known('A', 500, extra)], { schematicEmissionFwhmNm: 63 });
    assert.equal(model.curves[0].fwhmNm, 63);
  }
});

test("a curve and its filter carry the entry's own color through -- valid hex kept, malformed/missing dropped to null", () => {
  const withColor = known('A', 500, { color: '#3366ff', filterCenterNm: 500, filterBandwidthNm: 30 });
  const model = buildSpectralViewModel([withColor], {});
  assert.equal(model.curves[0].color, '#3366ff');
  assert.equal(model.filters[0].color, '#3366ff');

  for (const badColor of [undefined, null, '', 'blue', '#zzzzzz', '#fff', 123]) {
    const entry = known('B', 500, { color: badColor, filterCenterNm: 500, filterBandwidthNm: 30 });
    const badModel = buildSpectralViewModel([entry], {});
    assert.equal(badModel.curves[0].color, null, JSON.stringify(badColor));
    assert.equal(badModel.filters[0].color, null, JSON.stringify(badColor));
  }
});

test('only known entries get curves; complete valid filters get clipped renderer bands', () => {
  const entries = [
    known('Known', 520, { channelId: 'a', filterCenterNm: 525, filterBandwidthNm: 50 }),
    { token: 'Family', state: 'ambiguous-family', channelId: 'b', filterCenterNm: 320, filterBandwidthNm: 80 },
    { token: 'Gap', state: 'spectrum-unavailable', channelId: 'c', filterCenterNm: 650, filterBandwidthNm: null },
    known('Near edge', 895, { channelId: 'd', filterCenterNm: 890, filterBandwidthNm: 40 }),
  ];
  const model = buildSpectralViewModel(entries, { schematicEmissionFwhmNm: 50 });
  assert.deepEqual(model.curves.map((c) => c.token), ['Known', 'Near edge']);
  assert.equal(model.filters.length, 3);
  assert.deepEqual(model.filters[0], {
    channelId: 'b',
    token: 'Family',
    centerNm: 320,
    bandwidthNm: 80,
    startNm: 300,
    endNm: 360,
    clipped: true,
    color: null,
  });
  assert.equal(model.filters.at(-1).endNm, 900);
  assert.equal(model.filters.at(-1).clipped, true);
});

test('partial, invalid, and out-of-range filters are omitted rather than invented', () => {
  const entries = [
    known('Partial', 500, { filterCenterNm: 525, filterBandwidthNm: null }),
    known('Negative', 550, { filterCenterNm: 550, filterBandwidthNm: -10 }),
    known('Wide', 600, { filterCenterNm: 600, filterBandwidthNm: 301 }),
    known('Outside', 650, { filterCenterNm: 999, filterBandwidthNm: 20 }),
  ];
  assert.deepEqual(buildSpectralViewModel(entries, {}).filters, []);
});

test('empty and malformed entry collections are total empty models', () => {
  for (const entries of [undefined, null, {}, 'nope', []]) {
    const model = buildSpectralViewModel(entries, {});
    assert.deepEqual(model.curves, []);
    assert.deepEqual(model.filters, []);
  }
});

test('known entries with malformed token identities stay total and sortable', () => {
  const entries = [
    { state: 'known', emissionPeakNm: 520, token: {}, canonical: [] },
    { state: 'known', emissionPeakNm: 510, token: null, canonical: { unexpected: true } },
  ];
  assert.doesNotThrow(() => buildSpectralViewModel(entries, {}));
  assert.deepEqual(buildSpectralViewModel(entries, {}).curves.map((curve) => curve.token), [
    'Unnamed',
    'Unnamed',
  ]);
});
