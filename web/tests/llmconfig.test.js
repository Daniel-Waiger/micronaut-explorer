import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, loadLlmConfig, saveLlmConfig } from '../src/llm/config.js';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, String(value)]);
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    value(key) {
      return values.has(key) ? values.get(key) : null;
    },
  };
}

function withLocalStorage(storage, run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return run();
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else delete globalThis.localStorage;
  }
}

test('fresh storage returns the unchanged enabled/endpoint/model/token defaults', () => {
  withLocalStorage(fakeStorage(), () => {
    assert.deepEqual(loadLlmConfig(), {
      enabled: false,
      endpoint: DEFAULT_ENDPOINT,
      model: DEFAULT_MODEL,
      token: '',
    });
  });
});

test('enabled, endpoint, model, and token round-trip through injected localStorage', () => {
  const storage = fakeStorage();
  withLocalStorage(storage, () => {
    saveLlmConfig({ enabled: true, endpoint: 'https://ollama.example.test', model: 'qwen3:8b', token: 'secret-token' });
    assert.deepEqual(storage.writes, [
      ['micronaut.llm.enabled', '1'],
      ['micronaut.llm.endpoint', 'https://ollama.example.test'],
      ['micronaut.llm.model', 'qwen3:8b'],
      ['micronaut.llm.token', 'secret-token'],
    ]);
    assert.deepEqual(loadLlmConfig(), {
      enabled: true,
      endpoint: 'https://ollama.example.test',
      model: 'qwen3:8b',
      token: 'secret-token',
    });
  });
});

test('unavailable localStorage is total for reads and writes', () => {
  const unavailable = {
    getItem() {
      throw new Error('storage disabled');
    },
    setItem() {
      throw new Error('storage disabled');
    },
  };
  withLocalStorage(unavailable, () => {
    assert.deepEqual(loadLlmConfig(), {
      enabled: false,
      endpoint: DEFAULT_ENDPOINT,
      model: DEFAULT_MODEL,
      token: '',
    });
    assert.doesNotThrow(() => saveLlmConfig({ enabled: true, endpoint: 'https://example.test', model: 'model', token: 'token' }));
  });
});

test('a legacy link-outs key is ignored and never removed or rewritten', () => {
  const storage = fakeStorage({
    'micronaut.llm.enabled': '1',
    'micronaut.llm.linkouts': '1',
  });
  withLocalStorage(storage, () => {
    assert.deepEqual(loadLlmConfig(), {
      enabled: true,
      endpoint: DEFAULT_ENDPOINT,
      model: DEFAULT_MODEL,
      token: '',
    });
    saveLlmConfig({ enabled: false });
    assert.equal(storage.value('micronaut.llm.linkouts'), '1');
    assert.ok(storage.writes.every(([key]) => key !== 'micronaut.llm.linkouts'));
  });
});
