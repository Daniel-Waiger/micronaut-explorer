// Tests for llm/rateLimit.js -- a soft, client-side rolling-hour counter for
// remote (Ollama) calls. Not the authoritative limit (the server contract
// enforces that); this only has to track a window and prune correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMIT,
  ollamaCooldownSeconds,
  ollamaRequestsRemaining,
  recordOllamaRequest,
} from '../src/llm/rateLimit.js';

// localStorage isn't a Node global; a minimal in-memory stand-in is enough
// since rateLimit.js only calls getItem/setItem.
function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

test('with no prior requests, remaining equals the limit and cooldown is 0', () => {
  installFakeLocalStorage();
  assert.equal(ollamaRequestsRemaining(DEFAULT_LIMIT), DEFAULT_LIMIT);
  assert.equal(ollamaCooldownSeconds(DEFAULT_LIMIT), 0);
});

test('each recorded request decrements remaining by one, down to zero, never below', () => {
  installFakeLocalStorage();
  const now = 1_000_000;
  for (let i = 0; i < DEFAULT_LIMIT; i++) recordOllamaRequest(now);
  assert.equal(ollamaRequestsRemaining(DEFAULT_LIMIT, now), 0);
  recordOllamaRequest(now); // one more, over the limit
  assert.equal(ollamaRequestsRemaining(DEFAULT_LIMIT, now), 0);
});

test('cooldown counts down to when the oldest in-window request ages out', () => {
  installFakeLocalStorage();
  const start = 1_000_000;
  for (let i = 0; i < DEFAULT_LIMIT; i++) recordOllamaRequest(start + i * 1000);
  const now = start + DEFAULT_LIMIT * 1000;
  const cooldown = ollamaCooldownSeconds(DEFAULT_LIMIT, now);
  // The oldest entry ages out at start + 3600_000ms; cooldown is time from `now` to that.
  const expected = Math.ceil((start + 3600 * 1000 - now) / 1000);
  assert.equal(cooldown, expected);
  assert.ok(cooldown > 0 && cooldown <= 3600);
});

test('requests older than the one-hour window are pruned and no longer count', () => {
  installFakeLocalStorage();
  const longAgo = 0;
  for (let i = 0; i < DEFAULT_LIMIT; i++) recordOllamaRequest(longAgo);
  const muchLater = longAgo + 2 * 3600 * 1000; // 2 hours later, well outside the window
  assert.equal(ollamaRequestsRemaining(DEFAULT_LIMIT, muchLater), DEFAULT_LIMIT);
  assert.equal(ollamaCooldownSeconds(DEFAULT_LIMIT, muchLater), 0);
});

test('a corrupt/missing localStorage entry degrades to an empty log rather than throwing', () => {
  installFakeLocalStorage();
  localStorage.setItem('micronaut.llm.requestLog', 'not json');
  assert.equal(ollamaRequestsRemaining(DEFAULT_LIMIT), DEFAULT_LIMIT);
});
