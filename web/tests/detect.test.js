// Tests for web/src/llm/detect.js -- Ollama server/model detection via
// GET /api/tags. Stubbed fetch throughout; no real server is contacted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOllama } from '../src/llm/detect.js';

test('detectOllama returns available:true with a sorted, unique model-name list on success', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      models: [{ name: 'qwen2.5:14b' }, { name: 'llama3.1:8b' }, { name: 'llama3.1:8b' }],
    }),
  });
  const result = await detectOllama({ endpoint: 'http://localhost:11434', fetchImpl });
  assert.deepEqual(result, { available: true, models: ['llama3.1:8b', 'qwen2.5:14b'] });
});

test('detectOllama returns available:false when the server responds non-ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ models: [] }) });
  const result = await detectOllama({ endpoint: 'http://localhost:11434', fetchImpl });
  assert.deepEqual(result, { available: false, models: [] });
});

test('detectOllama returns available:false when fetch rejects/throws', async () => {
  const fetchImpl = async () => {
    throw new Error('network error');
  };
  const result = await detectOllama({ endpoint: 'http://localhost:11434', fetchImpl });
  assert.deepEqual(result, { available: false, models: [] });
});

test('detectOllama returns available:false on a malformed JSON body', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });
  const result = await detectOllama({ endpoint: 'http://localhost:11434', fetchImpl });
  assert.deepEqual(result, { available: false, models: [] });
});

test('detectOllama returns available:true, models:[] when the models array is empty or missing', async () => {
  const emptyArrayFetch = async () => ({ ok: true, status: 200, json: async () => ({ models: [] }) });
  const missingKeyFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

  const resultEmpty = await detectOllama({ endpoint: 'http://localhost:11434', fetchImpl: emptyArrayFetch });
  assert.deepEqual(resultEmpty, { available: true, models: [] });

  const resultMissing = await detectOllama({ endpoint: 'http://localhost:11434', fetchImpl: missingKeyFetch });
  assert.deepEqual(resultMissing, { available: true, models: [] });
});

test('detectOllama normalizes trailing slashes on the endpoint before hitting /api/tags', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ models: [] }) };
  };
  await detectOllama({ endpoint: 'http://localhost:11434///', fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:11434/api/tags');
  assert.equal(calls[0].init.method, 'GET');
});

test('detectOllama returns available:false when the endpoint is missing, without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ models: [] }) };
  };
  const result = await detectOllama({ endpoint: '', fetchImpl });
  assert.deepEqual(result, { available: false, models: [] });
  assert.equal(called, false);
});
