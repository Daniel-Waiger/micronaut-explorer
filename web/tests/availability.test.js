// The environment availability gate is intentionally synchronous and does no
// network probing. It only hides calls that cannot work from file:// or an
// explicitly offline runtime.

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { localEndpointCallsAvailable } from '../src/llm/availability.js';

const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function setRuntime({ protocol, onLine }) {
  Object.defineProperty(globalThis, 'location', {
    value: { protocol },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine },
    configurable: true,
  });
}

afterEach(() => {
  restoreGlobal('location', originalLocation);
  restoreGlobal('navigator', originalNavigator);
  restoreGlobal('fetch', originalFetch);
});

test('allows endpoint calls on an online HTTPS origin without probing the network', () => {
  setRuntime({ protocol: 'https:', onLine: true });
  let fetchCalls = 0;
  Object.defineProperty(globalThis, 'fetch', {
    value: () => {
      fetchCalls += 1;
      throw new Error('availability must not fetch');
    },
    configurable: true,
  });

  assert.equal(localEndpointCallsAvailable(), true);
  assert.equal(fetchCalls, 0);
});

test('allows endpoint calls on an online HTTP origin', () => {
  setRuntime({ protocol: 'http:', onLine: true });

  assert.equal(localEndpointCallsAvailable(), true);
});

test('rejects a file origin even when navigator reports online', () => {
  setRuntime({ protocol: 'file:', onLine: true });

  assert.equal(localEndpointCallsAvailable(), false);
});

test('rejects an explicitly offline runtime', () => {
  setRuntime({ protocol: 'https:', onLine: false });

  assert.equal(localEndpointCallsAvailable(), false);
});

test('is total when browser globals are absent', () => {
  delete globalThis.location;
  delete globalThis.navigator;

  assert.doesNotThrow(() => localEndpointCallsAvailable());
  assert.equal(localEndpointCallsAvailable(), true);
});

test('accepts an injected non-DOM runtime', () => {
  assert.equal(localEndpointCallsAvailable({ location: { protocol: 'file:' } }), false);
  assert.equal(localEndpointCallsAvailable({ navigator: { onLine: false } }), false);
  assert.equal(localEndpointCallsAvailable({ location: { protocol: 'https:' }, navigator: { onLine: true } }), true);
});

test('never throws when runtime properties cannot be read', () => {
  const unreadableRuntime = {};
  Object.defineProperty(unreadableRuntime, 'location', {
    get() {
      throw new Error('location is unavailable');
    },
  });
  Object.defineProperty(unreadableRuntime, 'navigator', {
    get() {
      throw new Error('navigator is unavailable');
    },
  });

  assert.doesNotThrow(() => localEndpointCallsAvailable(unreadableRuntime));
});
