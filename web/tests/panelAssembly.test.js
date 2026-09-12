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
  normalizeSpilloverAcks,
  panelFluorophoreOptions,
  panelFluorophoreWriteValue,
  pruneSpilloverAcks,
  spilloverPairKey,
  fluorophoreEntryId,
  FILTER_BANDWIDTH_BOUNDS_NM,
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
  assert.match(options.find((option) => option.value === 'syto9').label, /Ex 485 \/ Em 498 nm/);
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

// R3-17: the suggested filter bandwidth has ONE documented home --
// spectra.json's overlapRules.filterBandDefaultNm -- and this module must
// read it rather than carry its own silently-agreeing copy. Proven against
// the REAL loader/pack, not a hand-typed 30, per lesson 40 (a plan-literal
// constant that must mirror a real producer's output has to be generated by
// running the producer).
test('defaultChannelFilterPair/effectiveChannelFilterPair read overlapRules.filterBandDefaultNm from the REAL spectra.json, and honor a caller override', async () => {
  const { loadSpectraKb } = await import('../src/engine/spectra.js');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const realSpectraRaw = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'spectra.json'), 'utf-8'));
  const { overlapRules, issues } = loadSpectraKb(realSpectraRaw);
  assert.deepEqual(issues, []);

  assert.equal(overlapRules.filterBandDefaultNm, 30);
  assert.deepEqual(defaultChannelFilterPair(519, overlapRules), { filterCenterNm: 519, filterBandwidthNm: 30 });
  // Falls back to the same 30 when no overlapRules is supplied at all --
  // covers a caller (against every production path) that hands in nothing.
  assert.deepEqual(defaultChannelFilterPair(519), { filterCenterNm: 519, filterBandwidthNm: 30 });

  // A pack that documents a different default is what this module actually
  // follows -- proves it reads the value, not a private literal that merely
  // happens to equal 30 today.
  const overridden = { ...overlapRules, filterBandDefaultNm: 40 };
  assert.deepEqual(defaultChannelFilterPair(519, overridden), { filterCenterNm: 519, filterBandwidthNm: 40 });
  assert.deepEqual(effectiveChannelFilterPair({ filterCenterNm: null, filterBandwidthNm: null }, 519, overridden), {
    filterCenterNm: 519,
    filterBandwidthNm: 40,
  });
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

// --- normalizeSpilloverAcks / pruneSpilloverAcks (V3-N1) -----------------

test('normalizeSpilloverAcks drops malformed entries and sorts pairs', () => {
  const acks = normalizeSpilloverAcks([
    { pair: ['FITC', 'ALEXA488'], reason: 'sequential-acquisition', notes: 'ran sequentially', at: '2024-01-01T00:00:00.000Z' },
    { pair: ['A'], reason: 'other' }, // wrong pair length
    { pair: ['A', ''], reason: 'other' }, // empty pair member
    { pair: ['A', 'B'], reason: 'not-a-real-reason' }, // unrecognized reason
    { pair: ['A', 'B'] }, // missing reason
    { pair: [1, 2], reason: 'other' }, // non-string pair members
    { pair: ['A', 'B'], reason: 42 }, // non-string reason
    null,
    'not an object',
  ]);

  assert.deepEqual(acks, [
    {
      pair: ['ALEXA488', 'FITC'],
      reason: 'sequential-acquisition',
      notes: 'ran sequentially',
      at: '2024-01-01T00:00:00.000Z',
    },
  ]);
  assert.deepEqual(normalizeSpilloverAcks(null), []);
  assert.deepEqual(normalizeSpilloverAcks(undefined), []);
  assert.deepEqual(normalizeSpilloverAcks('nope'), []);
  assert.deepEqual(normalizeSpilloverAcks({}), []);
});

test('normalizeSpilloverAcks defaults a missing/invalid `at` to now and omits notes when absent/invalid', () => {
  const before = Date.now();
  const [ack] = normalizeSpilloverAcks([{ pair: ['X', 'Y'], reason: 'filter-separated' }]);
  const after = Date.now();

  assert.ok(!('notes' in ack), 'notes must be omitted, not set to undefined/null');
  assert.ok(typeof ack.at === 'string' && ack.at.length > 0);
  const parsed = Date.parse(ack.at);
  assert.ok(parsed >= before && parsed <= after, 'at must default to "now" when absent');

  const [withBadNotes] = normalizeSpilloverAcks([{ pair: ['X', 'Y'], reason: 'other', notes: 42 }]);
  assert.ok(!('notes' in withBadNotes));

  const [withBadAt] = normalizeSpilloverAcks([{ pair: ['X', 'Y'], reason: 'other', at: 12345 }]);
  assert.ok(typeof withBadAt.at === 'string' && withBadAt.at.length > 0);
});

test('pruneSpilloverAcks keeps an ack whose pair is present in either order and drops it when one dye is replaced', () => {
  const entries = [
    { canonical: 'ALEXA488' },
    { canonical: 'FITC' },
    { canonical: 'MITOTRACKER', variantKey: 'mitotracker green' },
  ];
  const acks = [
    { pair: ['ALEXA488', 'FITC'], reason: 'other', at: 'a' },
    { pair: ['FITC', 'ALEXA488'], reason: 'other', at: 'b' }, // reverse order -- both still present
    { pair: ['ALEXA488', 'MITOTRACKER'], reason: 'other', at: 'c' }, // bare canonical of a VARIANT entry -- not its id, absent
    { pair: ['ALEXA488', 'MITOTRACKER::mitotracker green'], reason: 'other', at: 'd' }, // the entry id, same as flagPanelOverlaps' pairKey
  ];

  const pruned = pruneSpilloverAcks(acks, entries);
  assert.deepEqual(pruned.map((a) => a.at), ['a', 'b', 'd']);

  // Replacing one dye in the panel (FITC -> ALEXA647) drops the ack that named it.
  const replaced = [{ canonical: 'ALEXA488' }, { canonical: 'ALEXA647' }];
  assert.deepEqual(pruneSpilloverAcks(acks, replaced), []);

  assert.deepEqual(pruneSpilloverAcks(null, entries), []);
  assert.deepEqual(pruneSpilloverAcks(acks, null), []);
  assert.deepEqual(pruneSpilloverAcks(undefined, undefined), []);
});

test('spillover acks are keyed on VARIANT-AWARE entry ids shared with flagPanelOverlaps, so swapping a family member drops the ack', () => {
  const green = { canonical: 'MITOTRACKER', variantKey: 'mitotracker green', status: 'known' };
  const deepRed = { canonical: 'MITOTRACKER', variantKey: 'mitotracker deep red', status: 'known' };
  const syto9 = { canonical: 'SYTO', variantKey: 'syto9', status: 'known' };
  const syto60 = { canonical: 'SYTO', variantKey: 'syto60', status: 'known' };
  assert.equal(fluorophoreEntryId(green), 'MITOTRACKER::mitotracker green');
  assert.equal(fluorophoreEntryId({ canonical: 'FITC' }), 'FITC');
  const acks = normalizeSpilloverAcks([{ pair: [fluorophoreEntryId(syto9), fluorophoreEntryId(green)], reason: 'sequential-acquisition', at: '2026-09-12T00:00:00.000Z' }]);
  assert.equal(acks.length, 1);
  assert.equal(spilloverPairKey(acks[0].pair[0], acks[0].pair[1]), 'MITOTRACKER::mitotracker green|SYTO::syto9');
  assert.equal(pruneSpilloverAcks(acks, [green, syto9]).length, 1, 'the acked pair is still present');
  assert.equal(pruneSpilloverAcks(acks, [deepRed, syto60]).length, 0, 'a different pair of the SAME families must NOT inherit the ack (red-team A3-P1)');
  assert.deepEqual(normalizeSpilloverAcks([{ pair: ['X::v1', 'X::v1'], reason: 'other' }]), [], 'self-pairs are dropped');
  assert.equal(normalizeSpilloverAcks([{ pair: [' A ', 'B'], reason: 'other' }, { pair: ['B', 'A'], reason: 'other' }]).length, 1, 'trimmed + deduped');
  const [badAt] = normalizeSpilloverAcks([{ pair: ['A', 'B'], reason: 'other', at: 'not-a-date-at-all' }]);
  assert.ok(Number.isFinite(Date.parse(badAt.at)), 'an unparseable at is replaced, not kept');
});

test('FILTER_BANDWIDTH_BOUNDS_NM mirrors normalizePanelFilterPair exactly (exclusive lower bound)', () => {
  const at = (bandwidth) => normalizeChannels([{ id: 'c1', target: 't', filterCenterNm: 500, filterBandwidthNm: bandwidth }])[0].filterBandwidthNm;
  assert.equal(FILTER_BANDWIDTH_BOUNDS_NM.minExclusiveNm, 0);
  assert.equal(FILTER_BANDWIDTH_BOUNDS_NM.maxNm, 300);
  assert.equal(at(0.5), 0.5, 'a sub-1 nm width is stored, matching the producer');
  assert.equal(at(0), null);
  assert.equal(at(300), 300);
  assert.equal(at(300.5), null);
  assert.ok(Object.isFrozen(FILTER_BANDWIDTH_BOUNDS_NM));
});
