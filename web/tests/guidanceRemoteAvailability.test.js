// Tests for guidance.js's remoteInferenceAvailable(): file:// and offline
// both make a remote endpoint unreachable in practice (no CORS-authorized
// origin on file://, no network at all offline), so the remote-model path
// must report unavailable in both cases rather than let the user configure
// something that can never work.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteInferenceAvailable } from '../src/ui/guidance.js';

function withGlobals({ protocol, onLine }, fn) {
  // Node's own `navigator` (and, in some versions, `location`) are
  // getter-only own properties on globalThis -- plain assignment throws, so
  // each is swapped in via defineProperty and restored the same way.
  const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'location', { value: { protocol }, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });
    fn();
  } finally {
    if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
    else delete globalThis.location;
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
    else delete globalThis.navigator;
  }
}

test('remoteInferenceAvailable is true on a normal https origin while online', () => {
  withGlobals({ protocol: 'https:', onLine: true }, () => {
    assert.equal(remoteInferenceAvailable(), true);
  });
});

test('remoteInferenceAvailable is false on file:// even while "online"', () => {
  withGlobals({ protocol: 'file:', onLine: true }, () => {
    assert.equal(remoteInferenceAvailable(), false);
  });
});

test('remoteInferenceAvailable is false when navigator.onLine is false', () => {
  withGlobals({ protocol: 'https:', onLine: false }, () => {
    assert.equal(remoteInferenceAvailable(), false);
  });
});
