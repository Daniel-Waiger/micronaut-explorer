// R6-04 / R6-05 repro: the SAME read-then-replace-across-the-debounce-window
// data-loss shape that core/appController.js's startBlankStudy() documents at
// length ("the timer fired AFTER the replace, read store.get() fresh, and
// persisted the new study into the ring instead of the edit the user had just
// made") is present, unguarded, in TWO other store.replace() call sites in the
// same module:
//   R6-04  restoreRecoverySlot()  (Settings -> Restore a previous version)
//   R6-05  importProjectBackup()  (Settings -> Import project backup)
// Neither calls flushAutosave(), and neither takes a protected snapshot of the
// study it is about to discard. startBlankStudy and openExampleStudy both do
// both. Lesson 44: fixing the reported case is not the same as fixing the class.
//
// Structure and fakes mirror web/tests/appController.test.js's own
// "startBlankStudy flushes the pending autosave with the EDITED study before
// replace (fails pre-fix)" test, so the contrast is like-for-like.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '/home/user/micronaut-explorer/web/src/core/appController.js';
import { createStore } from '/home/user/micronaut-explorer/web/src/core/store.js';
import { emptyExperiment } from '/home/user/micronaut-explorer/web/src/core/schema.js';

function withTitle(experiment, title) {
  return { ...experiment, meta: { ...experiment.meta, title } };
}

function makeManualTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay) { const id = nextId++; pending.set(id, { remaining: delay, callback }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      const due = [];
      for (const [id, t] of pending) { t.remaining -= ms; if (t.remaining <= 0) due.push(id); }
      due.sort((a, b) => a - b);
      for (const id of due) { const t = pending.get(id); if (!t) continue; pending.delete(id); t.callback(); }
    },
  };
}

function makeFakePersist(overrides = {}) {
  const calls = { saveExperiment: [] };
  let next = 1;
  return {
    calls,
    saveExperiment: (experiment) => { calls.saveExperiment.push(JSON.parse(JSON.stringify(experiment))); return `slot-${next++}`; },
    clearAll: () => ({ ok: true, removed: [], error: null }),
    deleteExperiment: () => {},
    exportToFile: () => {},
    importFromFile: overrides.importFromFile || (() => Promise.resolve({ experiment: null, issues: [] })),
    listSaved: () => [],
    loadExperiment: () => null,
    loadMostRecentRecoverable: () => ({ experiment: null, skippedCount: 0, totalSaved: 0 }),
    loadRecoverableSlot: overrides.loadRecoverableSlot || (() => ({ id: null, experiment: null, error: null })),
    markChanged: () => {},
    markExported: () => {},
  };
}

function makeFakeGuided() {
  const base = { version: 1, status: 'not-started', currentStepId: null, completedStepIds: [], completedAt: null };
  return { load: () => ({ ...base }), start: () => ({ ...base }), resume: () => ({ ...base }),
    pause: () => ({ ...base }), advance: () => ({ ...base }), restart: () => ({ ...base }) };
}

function build(store, persist, timers) {
  return createAppController({
    store, persist, guided: makeFakeGuided(), primaryWorkflow: [],
    createExampleStudy: () => withTitle(emptyExperiment(), 'example'),
    createEmptyStudy: emptyExperiment,
    isPersisted: false, isSandbox: false, timers,
    now: () => 'FIXED', logger: { error: () => {}, warn: () => {} },
  });
}

const tick = () => Promise.resolve();

test('R6-04: restoreRecoverySlot loses the in-flight edit -- no flushAutosave, no protected snapshot', async () => {
  const store = createStore(withTitle(emptyExperiment(), 'original'));
  const persist = makeFakePersist({
    loadRecoverableSlot: () => ({ id: 'slot-old', experiment: withTitle(emptyExperiment(), 'OLD-VERSION'), error: null }),
  });
  const timers = makeManualTimers();
  const controller = build(store, persist, timers);
  controller.startAutosave();

  // The user types. The 500ms debounce is still pending.
  store.patch({ meta: { ...store.get().meta, title: 'edited' } });
  await tick();
  timers.advance(200);
  assert.equal(persist.calls.saveExperiment.length, 0, 'precondition: nothing saved yet, the debounce is still pending');

  // They click Restore on an older version.
  assert.equal(controller.actions.onRestoreRecovery('slot-old'), true);
  await tick();
  // The pending timer now fires -- AFTER the replace.
  timers.advance(500);

  const titles = persist.calls.saveExperiment.map((e) => e.meta.title);
  assert.ok(
    titles.includes('edited'),
    `BUG: the edit was never persisted anywhere. Saves recorded: ${JSON.stringify(titles)} -- ` +
      'the pending autosave fired after store.replace() and wrote the RESTORED study instead. ' +
      'startBlankStudy guards this exact shape with flushAutosave(); restoreRecoverySlot does not.'
  );
});

test('R6-05: importProjectBackup loses the in-flight edit the same way', async () => {
  const store = createStore(withTitle(emptyExperiment(), 'original'));
  const persist = makeFakePersist({
    importFromFile: () => Promise.resolve({ experiment: withTitle(emptyExperiment(), 'IMPORTED'), issues: [] }),
  });
  const timers = makeManualTimers();
  const controller = build(store, persist, timers);
  controller.startAutosave();

  store.patch({ meta: { ...store.get().meta, title: 'edited' } });
  await tick();
  timers.advance(200);
  assert.equal(persist.calls.saveExperiment.length, 0, 'precondition: debounce still pending');

  await controller.actions.onImportProject({ name: 'backup.micronaut.json' });
  await tick();
  timers.advance(500);

  const titles = persist.calls.saveExperiment.map((e) => e.meta.title);
  assert.ok(
    titles.includes('edited'),
    `BUG: the pre-import edit was never persisted. Saves recorded: ${JSON.stringify(titles)}`
  );
});

test('R6-04b: control -- startBlankStudy, on the identical sequence, DOES preserve the edit', async () => {
  const store = createStore(withTitle(emptyExperiment(), 'original'));
  const persist = makeFakePersist();
  const timers = makeManualTimers();
  const controller = build(store, persist, timers);
  controller.startAutosave();
  store.patch({ meta: { ...store.get().meta, title: 'edited' } });
  await tick();
  timers.advance(200);
  assert.equal(controller.actions.onNewBlank(), true);
  const titles = persist.calls.saveExperiment.map((e) => e.meta.title);
  assert.ok(titles.includes('edited'), `control failed: ${JSON.stringify(titles)}`);
});
