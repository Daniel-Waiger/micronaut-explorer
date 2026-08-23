// Tests for core/onboarding.js -- persisted onboarding stage/experience/
// completed flag, degrading to defaults when localStorage is
// unavailable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_STAGES,
  ONBOARDING_LEVELS,
  loadOnboarding,
  resetOnboarding,
  saveOnboarding,
} from '../src/core/onboarding.js';

// localStorage isn't a Node global; a minimal in-memory stand-in is enough
// since onboarding.js only calls getItem/setItem.
function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function installThrowingLocalStorage() {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('getItem blocked');
    },
    setItem: () => {
      throw new Error('setItem blocked');
    },
    removeItem: () => {
      throw new Error('removeItem blocked');
    },
  };
}

test('defaults when nothing stored', () => {
  installFakeLocalStorage();
  assert.deepEqual(loadOnboarding(), { stage: null, experience: null, completed: false });
});

test('round-trip save/load of stage', () => {
  installFakeLocalStorage();
  for (const stage of ONBOARDING_STAGES) {
    saveOnboarding({ stage });
    assert.equal(loadOnboarding().stage, stage);
  }
});

test('round-trip save/load of experience', () => {
  installFakeLocalStorage();
  for (const experience of ONBOARDING_LEVELS) {
    saveOnboarding({ experience });
    assert.equal(loadOnboarding().experience, experience);
  }
});

test('round-trip save/load of completed', () => {
  installFakeLocalStorage();
  saveOnboarding({ completed: true });
  assert.equal(loadOnboarding().completed, true);
  saveOnboarding({ completed: false });
  assert.equal(loadOnboarding().completed, false);
});

test('reset makes a completed onboarding session eligible to show again without losing choices', () => {
  installFakeLocalStorage();
  saveOnboarding({ stage: 'designing', experience: 'frequent', completed: true });
  resetOnboarding();
  assert.deepEqual(loadOnboarding(), { stage: 'designing', experience: 'frequent', completed: false });
});

test('invalid stored strings read back as null, not leaked through', () => {
  installFakeLocalStorage();
  localStorage.setItem('micronaut.onboarding.stage', 'bogus');
  localStorage.setItem('micronaut.onboarding.experience', 'bogus');
  const loaded = loadOnboarding();
  assert.equal(loaded.stage, null);
  assert.equal(loaded.experience, null);
});

test('save ignores invalid enum values (does not persist them)', () => {
  installFakeLocalStorage();
  saveOnboarding({ stage: 'idea', experience: 'novice' });
  saveOnboarding({ stage: 'not-a-stage', experience: 'not-a-level' });
  const loaded = loadOnboarding();
  assert.equal(loaded.stage, 'idea');
  assert.equal(loaded.experience, 'novice');
});

test('save ignores wrong-typed fields', () => {
  installFakeLocalStorage();
  saveOnboarding({ stage: 42, experience: null, completed: 'yes' });
  assert.deepEqual(loadOnboarding(), { stage: null, experience: null, completed: false });
});

test('degrades to defaults when localStorage throws on read/write', () => {
  installThrowingLocalStorage();
  assert.doesNotThrow(() =>
    saveOnboarding({ stage: 'idea', experience: 'frequent', completed: true })
  );
  let loaded;
  assert.doesNotThrow(() => {
    loaded = loadOnboarding();
  });
  assert.deepEqual(loaded, { stage: null, experience: null, completed: false });
  assert.doesNotThrow(() => resetOnboarding());
});

test('every normal completion and dismissal state persists completed', () => {
  installFakeLocalStorage();
  for (const completion of [
    { completed: true },
    { stage: 'idea', experience: 'novice', completed: true },
    { stage: 'designing', experience: 'occasional', completed: true },
    { stage: 'acquiring', experience: 'frequent', completed: true },
  ]) {
    saveOnboarding(completion);
    assert.equal(loadOnboarding().completed, true);
    resetOnboarding();
    assert.equal(loadOnboarding().completed, false);
  }
});
