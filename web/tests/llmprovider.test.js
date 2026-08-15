// Tests for web/src/llm/* -- the provider seam (provider.js), the
// manual-paste adapter, and the Ollama adapter (stubbed fetch, no server
// required).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProvider } from '../src/llm/provider.js';
import { createManualPasteProvider } from '../src/llm/manualPaste.js';
import { createOllamaProvider } from '../src/llm/ollama.js';

test('isProvider recognizes a well-shaped provider and rejects a malformed one', () => {
  const good = createManualPasteProvider();
  assert.equal(isProvider(good), true);
  assert.equal(isProvider(null), false);
  assert.equal(isProvider({}), false);
  assert.equal(isProvider({ id: 'x', label: 'x' }), false); // missing complete/isAvailable
});

test('manual-paste provider is always available and composes system+user into text, json null', async () => {
  const provider = createManualPasteProvider();
  assert.equal(provider.isAvailable(), true);
  const result = await provider.complete({ system: 'RULES', user: 'PAYLOAD' });
  assert.equal(result.json, null);
  assert.match(result.text, /RULES/);
  assert.match(result.text, /PAYLOAD/);
});

test('manual-paste provider uses a custom composeMessage when supplied', async () => {
  const provider = createManualPasteProvider({ composeMessage: ({ system, user }) => `${system}::${user}` });
  const result = await provider.complete({ system: 'A', user: 'B' });
  assert.equal(result.text, 'A::B');
});

test('ollama provider isAvailable requires both endpoint and model, without any network call', () => {
  assert.equal(createOllamaProvider({}).isAvailable(), false);
  assert.equal(createOllamaProvider({ endpoint: 'http://x:11434' }).isAvailable(), false);
  assert.equal(createOllamaProvider({ endpoint: 'http://x:11434', model: 'qwen2.5:14b' }).isAvailable(), true);
});

test('ollama provider posts to /api/chat with keep_alive and the format schema, parses structured json', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ message: { content: '{"proposals":[]}' } }),
    };
  };
  const schema = { type: 'object' };
  const provider = createOllamaProvider({
    endpoint: 'http://server:11434/',
    model: 'qwen2.5:14b',
    keepAlive: -1,
    fetchImpl,
  });

  const result = await provider.complete({ system: 'SYS', user: 'USR', schema });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server:11434/api/chat'); // trailing slash on endpoint stripped
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'qwen2.5:14b');
  assert.equal(body.keep_alive, -1);
  assert.deepEqual(body.format, schema);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'USR' },
  ]);
  assert.deepEqual(result.json, { proposals: [] });
  assert.equal(result.text, '{"proposals":[]}');
});

test('ollama provider returns json:null (not a throw) when a schema was requested but the reply is not parseable', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ message: { content: 'not json' } }),
  });
  const provider = createOllamaProvider({ endpoint: 'http://s:11434', model: 'm', fetchImpl });
  const result = await provider.complete({ user: 'x', schema: { type: 'object' } });
  assert.equal(result.json, null);
  assert.equal(result.text, 'not json');
});

test('ollama provider rejects when the server responds non-ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
  const provider = createOllamaProvider({ endpoint: 'http://s:11434', model: 'm', fetchImpl });
  await assert.rejects(() => provider.complete({ user: 'x' }), /500/);
});

test('ollama provider rejects immediately when not configured, without touching fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
  };
  const provider = createOllamaProvider({ endpoint: '', model: 'm', fetchImpl });
  await assert.rejects(() => provider.complete({ user: 'x' }), /not configured/);
  assert.equal(called, false);
});
