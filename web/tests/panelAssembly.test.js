// Tests for engine/panelAssembly.js -- the structured panel/channel model
// (Wave 2A, alpha-pilot-readiness), built over the long-reserved
// panel.channels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTIBODY_CONJUGATION_MODES,
  CONJUGATION_MODES,
  channelSpectralField,
  defaultChannelFilterPair,
  effectiveChannelColor,
  effectiveChannelFilterPair,
  emptyChannel,
  normalizeChannels,
  panelFluorophoreOptions,
  panelFluorophoreWriteValue,
  reorderPanelChannels,
  seedChannelsFromMarkers,
  shiftPanelChannel,
  sortPanelChannelsByEmission,
} from '../src/engine/panelAssembly.js';
import { realKb } from './fixtures.js';
import { resolveMarkerToken } from '../src/engine/spectra.js';

test('panelFluorophoreOptions flattens exact family variants, labels peaks, sorts, deduplicates, and never mutates', () => {
  const fluorophores = {
    ALEXA488: { isFamily: false, excitationPeakNm: 495, emissionPeakNm: 519 },
    MITOTRACKER: {
      isFamily: true,
      variants: {
        'mitotracker deep red': { excitationPeakNm: 644, emissionPeakNm: 665 },
        'mitotracker green': { excitationPeakNm: 490, emissionPeakNm: 516 },
      },
    },
    DUPLICATE: {
      isFamily: true,
      variants: { ALEXA488: { excitationPeakNm: 1, emissionPeakNm: 2 } },
    },
    MALFORMED: { isFamily: false, excitationPeakNm: '500', emissionPeakNm: 520 },
  };
  const before = structuredClone(fluorophores);

  assert.deepEqual(panelFluorophoreOptions(fluorophores), [
    {
      value: 'ALEXA488',
      label: 'ALEXA488 — Ex 495 / Em 519 nm',
      canonical: 'ALEXA488',
      excitationPeakNm: 495,
      emissionPeakNm: 519,
      isVariant: false,
    },
    {
      value: 'mitotracker deep red',
      label: 'Mitotracker Deep Red — Ex 644 / Em 665 nm',
      canonical: 'MITOTRACKER',
      excitationPeakNm: 644,
      emissionPeakNm: 665,
      isVariant: true,
    },
    {
      value: 'mitotracker green',
      label: 'Mitotracker Green — Ex 490 / Em 516 nm',
      canonical: 'MITOTRACKER',
      excitationPeakNm: 490,
      emissionPeakNm: 516,
      isVariant: true,
    },
  ]);
  assert.deepEqual(fluorophores, before);
  assert.deepEqual(panelFluorophoreOptions(null), []);
  assert.deepEqual(panelFluorophoreOptions([]), []);
});

test('panelFluorophoreOptions exposes every spectrum-backed real-library dye and exact variant once', () => {
  const kb = realKb();
  const spectra = kb.spectra;
  const expectedCount = Object.values(spectra).reduce(
    (count, entry) => count + (entry.isFamily ? Object.keys(entry.variants).length : 1),
    0
  );
  const options = panelFluorophoreOptions(spectra);
  const values = options.map((option) => option.value);

  assert.equal(options.length, expectedCount);
  assert.equal(new Set(values.map((value) => value.toLowerCase())).size, expectedCount);
  assert.ok(values.includes('ALEXA488'));
  assert.ok(values.includes('syto9'));
  assert.ok(values.includes('mitotracker deep red'));
  assert.match(options.find((option) => option.value === 'syto9').label, /Ex 480 \/ Em 500 nm/);
  for (const option of options) {
    assert.equal(
      resolveMarkerToken(option.value, kb.index, kb.markersKb, spectra).state,
      'known',
      `${option.value} must round-trip through the spectral consumer`
    );
  }
});

test('panelFluorophoreWriteValue updates by current id and mode without losing sibling edits', () => {
  const channels = [
    { id: 'direct', conjugation: 'direct-probe', fluorophore: '', target: 'fresh target', filterCenterNm: 525 },
    { id: 'tag', conjugation: 'tag-ligand', conjugateDye: '', target: 'HaloTag', filterBandwidthNm: 50 },
  ];
  const direct = panelFluorophoreWriteValue(channels, 'direct', 'ALEXA488');
  const tag = panelFluorophoreWriteValue(direct, 'tag', 'JF549');

  assert.deepEqual(tag, [
    { id: 'direct', conjugation: 'direct-probe', fluorophore: 'ALEXA488', target: 'fresh target', filterCenterNm: 525 },
    { id: 'tag', conjugation: 'tag-ligand', conjugateDye: 'JF549', target: 'HaloTag', filterBandwidthNm: 50 },
  ]);
  assert.deepEqual(channels[0].fluorophore, '');
  assert.deepEqual(panelFluorophoreWriteValue(null, 'direct', 'x'), []);
});

test('a structural fluorophore pick clears the old filter so the new dye can supply its own default', () => {
  const channels = [
    { id: 'direct', conjugation: 'direct-probe', fluorophore: 'ALEXA488', filterCenterNm: 520, filterBandwidthNm: 30 },
    { id: 'sibling', conjugation: 'direct-probe', fluorophore: 'mCherry', filterCenterNm: 610, filterBandwidthNm: 35 },
  ];

  const changed = panelFluorophoreWriteValue(channels, 'direct', 'mCherry', { resetFilter: true });

  assert.deepEqual(changed[0], {
    id: 'direct', conjugation: 'direct-probe', fluorophore: 'mCherry', filterCenterNm: null, filterBandwidthNm: null,
  });
  assert.deepEqual(changed[1], channels[1]);
  assert.deepEqual(channels[0].filterCenterNm, 520);
});

test('emptyChannel has every field, defaulting to a non-antibody direct probe with auto color', () => {
  const channel = emptyChannel('c1');
  assert.deepEqual(channel, {
    id: 'c1',
    target: '',
    fluorophore: '',
    conjugation: 'direct-probe',
    conjugateDye: '',
    filterCenterNm: null,
    filterBandwidthNm: null,
    color: '',
  });
});

test('defaultChannelFilterPair centers a 30 nm bandwidth on the emission peak', () => {
  assert.deepEqual(defaultChannelFilterPair(525), { filterCenterNm: 525, filterBandwidthNm: 30 });
  assert.deepEqual(defaultChannelFilterPair(524.6), { filterCenterNm: 525, filterBandwidthNm: 30 });
});

test('defaultChannelFilterPair returns null when there is no emission peak -- never fabricates a center', () => {
  assert.equal(defaultChannelFilterPair(null), null);
  assert.equal(defaultChannelFilterPair(undefined), null);
  assert.equal(defaultChannelFilterPair(NaN), null);
  assert.equal(defaultChannelFilterPair('525'), null);
});

test('effectiveChannelFilterPair supplies the displayed default when no complete pair is saved, but preserves a real pair', () => {
  assert.deepEqual(effectiveChannelFilterPair({ filterCenterNm: null, filterBandwidthNm: null }, 519), {
    filterCenterNm: 519,
    filterBandwidthNm: 30,
  });
  assert.deepEqual(effectiveChannelFilterPair({ filterCenterNm: 525, filterBandwidthNm: 50 }, 519), {
    filterCenterNm: 525,
    filterBandwidthNm: 50,
  });
  assert.equal(effectiveChannelFilterPair({ filterCenterNm: 525, filterBandwidthNm: null }, null), null);
});

test('effectiveChannelColor prefers the explicit override, else the computed default, else null', () => {
  assert.equal(effectiveChannelColor({ color: '#ff0000' }, '#0000ff'), '#ff0000');
  assert.equal(effectiveChannelColor({ color: '' }, '#0000ff'), '#0000ff');
  assert.equal(effectiveChannelColor({ color: '' }, null), null);
  assert.equal(effectiveChannelColor(null, null), null);
});

test('CONJUGATION_MODES and ANTIBODY_CONJUGATION_MODES agree: every antibody mode is a real conjugation mode', () => {
  for (const mode of ANTIBODY_CONJUGATION_MODES) {
    assert.ok(CONJUGATION_MODES.includes(mode), mode);
  }
});

test('normalizeChannels drops malformed entries and defaults missing/invalid fields, never throws', () => {
  const channels = normalizeChannels([
    { id: 'a', target: 'F-actin', fluorophore: 'Phalloidin-AF488', conjugation: 'direct-probe', conjugateDye: '' },
    { id: 'b', conjugation: 'not-a-real-mode' }, // invalid conjugation -> defaults
    null, // dropped
    { target: 'no id' }, // dropped: no id
    'not an object', // dropped
  ]);
  assert.equal(channels.length, 2);
  assert.equal(channels[0].target, 'F-actin');
  assert.equal(channels[1].id, 'b');
  assert.equal(channels[1].conjugation, 'direct-probe');
});

test('normalizeChannels preserves legacy channels and accepts only complete valid filter pairs', () => {
  const channels = normalizeChannels([
    { id: 'legacy', target: 'actin' },
    { id: 'valid', filterCenterNm: 650, filterBandwidthNm: 40 },
    { id: 'partial-center', filterCenterNm: 650 },
    { id: 'partial-bandwidth', filterBandwidthNm: 40 },
    { id: 'bad-center', filterCenterNm: 299, filterBandwidthNm: 40 },
    { id: 'bad-bandwidth', filterCenterNm: 650, filterBandwidthNm: 301 },
    { id: 'not-numbers', filterCenterNm: '650', filterBandwidthNm: Number.NaN },
  ]);

  assert.deepEqual(channels.map(({ id, filterCenterNm, filterBandwidthNm }) => ({ id, filterCenterNm, filterBandwidthNm })), [
    { id: 'legacy', filterCenterNm: null, filterBandwidthNm: null },
    { id: 'valid', filterCenterNm: 650, filterBandwidthNm: 40 },
    { id: 'partial-center', filterCenterNm: null, filterBandwidthNm: null },
    { id: 'partial-bandwidth', filterCenterNm: null, filterBandwidthNm: null },
    { id: 'bad-center', filterCenterNm: null, filterBandwidthNm: null },
    { id: 'bad-bandwidth', filterCenterNm: null, filterBandwidthNm: null },
    { id: 'not-numbers', filterCenterNm: null, filterBandwidthNm: null },
  ]);
});

test('normalizeChannels preserves a valid color override and drops a non-string color back to auto', () => {
  const [withColor] = normalizeChannels([{ id: 'a', color: '#3366ff' }]);
  assert.equal(withColor.color, '#3366ff');

  const [badColor] = normalizeChannels([{ id: 'a', color: 42 }]);
  assert.equal(badColor.color, '');
});

test('normalizeChannels never throws on non-array/malformed input', () => {
  assert.deepEqual(normalizeChannels(undefined), []);
  assert.deepEqual(normalizeChannels(null), []);
  assert.deepEqual(normalizeChannels('nope'), []);
  assert.deepEqual(normalizeChannels({}), []);
});

test('channelSpectralField reads conjugateDye for tag-ligand, fluorophore otherwise', () => {
  assert.equal(
    channelSpectralField({ conjugation: 'tag-ligand', fluorophore: '', conjugateDye: 'JF549' }),
    'JF549'
  );
  assert.equal(
    channelSpectralField({ conjugation: 'direct-probe', fluorophore: 'DAPI', conjugateDye: '' }),
    'DAPI'
  );
  assert.equal(channelSpectralField(null), '');
});

test('reorderPanelChannels inserts the source before the target without mutating channels', () => {
  const channels = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const reordered = reorderPanelChannels(channels, 'd', 'b');

  assert.deepEqual(reordered.map((channel) => channel.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(channels.map((channel) => channel.id), ['a', 'b', 'c', 'd']);
  assert.notEqual(reordered, channels);
  assert.deepEqual(reorderPanelChannels(channels, 'missing', 'b'), channels);
  assert.notEqual(reorderPanelChannels(channels, 'a', 'a'), channels);
  assert.deepEqual(reorderPanelChannels(null, 'a', 'b'), []);
});

test('shiftPanelChannel moves by an in-bounds integer delta and treats bad shifts as no-op copies', () => {
  const channels = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const shifted = shiftPanelChannel(channels, 'b', 1);

  assert.deepEqual(shifted.map((channel) => channel.id), ['a', 'c', 'b']);
  assert.deepEqual(channels.map((channel) => channel.id), ['a', 'b', 'c']);
  for (const [id, delta] of [['missing', 1], ['a', -1], ['c', 1], ['b', 0], ['b', 0.5]]) {
    const result = shiftPanelChannel(channels, id, delta);
    assert.deepEqual(result, channels);
    assert.notEqual(result, channels);
  }
});

test('sortPanelChannelsByEmission is stable, puts unresolved channels last, and tolerates malformed resolvers', () => {
  const channels = [
    { id: 'unresolved-first' }, { id: 'tie-one' }, { id: 'short' }, { id: 'tie-two' }, { id: 'unresolved-last' },
  ];
  const emissions = { 'tie-one': 600, short: 500, 'tie-two': 600, 'unresolved-first': null, 'unresolved-last': undefined };
  const sorted = sortPanelChannelsByEmission(channels, (channel) => emissions[channel.id]);

  assert.deepEqual(sorted.map((channel) => channel.id), ['short', 'tie-one', 'tie-two', 'unresolved-first', 'unresolved-last']);
  assert.deepEqual(channels.map((channel) => channel.id), ['unresolved-first', 'tie-one', 'short', 'tie-two', 'unresolved-last']);
  const throwing = sortPanelChannelsByEmission(channels, (channel) => {
    if (channel.id === 'short') throw new Error('bad resolver');
    return channel.id === 'tie-one' ? 600 : undefined;
  });
  assert.deepEqual(throwing.map((channel) => channel.id), ['tie-one', 'unresolved-first', 'short', 'tie-two', 'unresolved-last']);
  const noCallback = sortPanelChannelsByEmission(channels, null);
  assert.deepEqual(noCallback, channels);
  assert.notEqual(noCallback, channels);
});

test('seedChannelsFromMarkers maps KB class to a best-guess conjugation, and excludes unrecognized tokens', () => {
  const resolvePanelResult = {
    entries: [
      { token: 'DAPI', canonical: 'DAPI', state: 'known' },
      { token: 'SOX2', canonical: 'SOX2', state: 'no-intrinsic-spectrum' },
      { token: 'HALO', canonical: 'HALO', state: 'no-intrinsic-spectrum' },
      { token: 'BOGUS', canonical: null, state: 'unrecognized' },
    ],
  };
  const markersKb = { markers: { DAPI: { class: 'dye' }, SOX2: { class: 'target' }, HALO: { class: 'tag' } } };
  const kbMarker = (kb, canonical) => kb.markers[canonical];
  let counter = 0;
  const makeId = () => `id${++counter}`;

  const channels = seedChannelsFromMarkers(resolvePanelResult, markersKb, kbMarker, makeId);
  assert.equal(channels.length, 3); // BOGUS excluded

  const dapi = channels.find((c) => c.fluorophore === 'DAPI');
  assert.equal(dapi.conjugation, 'direct-probe');

  const sox2 = channels.find((c) => c.conjugation === 'antibody-indirect');
  assert.ok(sox2, 'SOX2 (class target) should seed as antibody-indirect');

  const halo = channels.find((c) => c.conjugation === 'tag-ligand');
  assert.ok(halo, 'HALO (class tag) should seed as tag-ligand');
  assert.equal(halo.conjugateDye, 'HALO');
  assert.equal(halo.fluorophore, '');
});

test('seedChannelsFromMarkers never throws on a malformed resolvePanel result', () => {
  assert.doesNotThrow(() => seedChannelsFromMarkers(undefined, {}, () => undefined, () => 'x'));
  assert.doesNotThrow(() => seedChannelsFromMarkers({ entries: null }, {}, () => undefined, () => 'x'));
});
