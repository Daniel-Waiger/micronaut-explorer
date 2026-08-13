// Tests for engine/panelAssembly.js -- the structured panel/channel model
// (Wave 2A, alpha-pilot-readiness), built over the long-reserved
// panel.channels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTIBODY_CONJUGATION_MODES,
  CONJUGATION_MODES,
  channelSpectralField,
  emptyChannel,
  normalizeChannels,
  seedChannelsFromMarkers,
} from '../src/engine/panelAssembly.js';

test('emptyChannel has every field, defaulting to a non-antibody direct probe', () => {
  const channel = emptyChannel('c1');
  assert.deepEqual(channel, { id: 'c1', target: '', fluorophore: '', conjugation: 'direct-probe', conjugateDye: '' });
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
