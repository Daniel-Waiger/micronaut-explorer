import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IS_SANDBOX,
  STORAGE_SCOPE,
  makeNsKey,
  nsKey,
  resolveStorageScope,
} from '../src/core/storageScope.js';

// resolveStorageScope is the ONLY input to which set of localStorage keys a tab
// may touch, so its failure mode is not "wrong UI" but "the practice tab writes
// into the user's real study". Every case below is therefore about refusing to
// resolve a scope unless the flag is exactly right.

test('the unscoped tab is the default for anything that is not exactly demo=1', () => {
  for (const search of ['', '?', '?a=1', null, undefined]) {
    assert.equal(resolveStorageScope(search), '', `expected '' for ${JSON.stringify(search)}`);
  }
});

test('?demo=1 resolves the demo scope, in any parameter position', () => {
  assert.equal(resolveStorageScope('?demo=1'), 'demo');
  assert.equal(resolveStorageScope('?a=1&demo=1'), 'demo');
  assert.equal(resolveStorageScope('?demo=1&b=2'), 'demo');
  // URLSearchParams strips a leading '?', so a caller that hands over
  // location.search already trimmed is treated identically rather than silently
  // falling back to the real tab's keys.
  assert.equal(resolveStorageScope('demo=1'), 'demo');
});

test('a near-miss flag never resolves a scope', () => {
  // The danger is asymmetric. A missed sandbox flag opens a normal tab (mildly
  // confusing); a FALSE sandbox flag would point the real tab at demo keys and
  // hide the user's study. These all have to land on ''.
  for (const search of ['?demo=11', '?demo=0', '?demo=', '?demo', '?DEMO=1', '?demo=true']) {
    assert.equal(resolveStorageScope(search), '', `expected '' for ${search}`);
  }
});

test('a malformed query string resolves to the unscoped tab rather than throwing', () => {
  // A parse failure must never be able to stop the app booting: this value is
  // read at module scope, before anything has rendered.
  assert.equal(resolveStorageScope('?x=%'), '');
  assert.equal(resolveStorageScope({}), '');
});

test('an unscoped nsKey is the identity function', () => {
  const bare = makeNsKey('');
  for (const key of ['micronaut.v1.ring', 'micronaut.theme', 'micronaut.navCollapsed', 'other']) {
    assert.equal(bare(key), key);
  }
});

test('a scoped nsKey inserts the scope after the shared micronaut. prefix', () => {
  const demo = makeNsKey('demo');
  assert.equal(demo('micronaut.v1.ring'), 'micronaut.demo.v1.ring');
  assert.equal(demo('micronaut.v1.slot.abc'), 'micronaut.demo.v1.slot.abc');
  assert.equal(demo('micronaut.guidedProgress.v1'), 'micronaut.demo.guidedProgress.v1');
  assert.equal(demo('micronaut.onboarding.stage'), 'micronaut.demo.onboarding.stage');
  assert.equal(demo('micronaut.navCollapsed'), 'micronaut.demo.navCollapsed');
});

test('micronaut.theme is shared across scopes on purpose', () => {
  // The practice tab should look like the user's own app. A remembered
  // light/dark choice carries no study data, so isolating it would cost the
  // resemblance and buy nothing.
  assert.equal(makeNsKey('demo')('micronaut.theme'), 'micronaut.theme');
});

test('a scoped key can never be mistaken for an unscoped one, in either direction', () => {
  // This is the property persist.js's clearAll() depends on: it sweeps every
  // key matching its own STORAGE_PREFIX, so if either prefix were a prefix of
  // the other, "clear all stored data" in one tab would silently delete the
  // other tab's study.
  const real = 'micronaut.v1.';
  const demo = makeNsKey('demo')('micronaut.v1.');
  assert.equal(demo, 'micronaut.demo.v1.');
  assert.equal(`${demo}ring`.startsWith(real), false);
  assert.equal(`${real}ring`.startsWith(demo), false);
});

test('a key outside the app namespace is still scoped rather than shared by accident', () => {
  // Nothing writes such a key today. If something ever does, the safe default
  // is that it belongs to the tab that wrote it, not to every tab.
  assert.equal(makeNsKey('demo')('weird.key'), 'micronaut.demo.weird.key');
});

test('under node --test there is no location, so the app resolves to the real tab', () => {
  // The whole existing persistence suite asserts on bare `micronaut.v1.*` keys.
  // That only stays true because module-scope resolution finds no `location`
  // here -- if this ever flips, those suites start testing the wrong scope.
  assert.equal(typeof location, 'undefined');
  assert.equal(STORAGE_SCOPE, '');
  assert.equal(IS_SANDBOX, false);
  assert.equal(nsKey('micronaut.v1.ring'), 'micronaut.v1.ring');
});
