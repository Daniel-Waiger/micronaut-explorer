import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordOllamaRequest, DEFAULT_LIMIT } from '../src/llm/rateLimit.js';
import { rateLimitLabel } from '../src/ui/rateLimitLabel.js';

function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

test('rateLimitLabel reports remaining count and atLimit:false under the limit', () => {
  installFakeLocalStorage();
  const label = rateLimitLabel(DEFAULT_LIMIT);
  assert.equal(label.atLimit, false);
  assert.match(label.text, new RegExp(`${DEFAULT_LIMIT} of ${DEFAULT_LIMIT} requests left`));
});

test('rateLimitLabel reports atLimit:true with a cooldown message once the limit is hit', () => {
  installFakeLocalStorage();
  const now = Date.now();
  for (let i = 0; i < DEFAULT_LIMIT; i++) recordOllamaRequest(now);
  // rateLimitLabel uses Date.now() internally, so entries must be recorded
  // near real "now" or pruneToWindow discards them as stale.
  const label = rateLimitLabel(DEFAULT_LIMIT);
  assert.equal(label.atLimit, true);
  assert.match(label.text, /limit reached/i);
});
