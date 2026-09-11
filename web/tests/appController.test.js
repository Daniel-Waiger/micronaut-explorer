// Tests for core/appController.js -- the lifecycle coordinator extracted out
// of main.js's init(). main.js calls init() at module scope, so nothing that
// used to live inside it could ever be imported by a test (see
// persist.test.js's loadMostRecentRecoverable comment and kbpack.test.js's
// header for the same trade made earlier for smaller pieces of init()).
// These tests exercise the three behaviour fixes this extraction exists to
// land, plus the shape every later AUD task depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAppController,
  resolveInitialExperiment,
  withOrigin,
  projectFilename,
  isExampleOrigin,
} from '../src/core/appController.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import {
  clearAll as realClearAll,
  deleteExperiment as realDeleteExperiment,
  listSaved as realListSaved,
  loadExperiment as realLoadExperiment,
  loadMostRecentRecoverable as realLoadMostRecentRecoverable,
  loadRecoverableSlot as realLoadRecoverableSlot,
  markChanged as realMarkChanged,
  markExported as realMarkExported,
  saveExperiment as realSaveExperiment,
} from '../src/core/persist.js';

function withTitle(experiment, title) {
  return { ...experiment, meta: { ...experiment.meta, title } };
}

/** A hand-rolled fake clock: startAutosave/flushAutosave only ever call
 * timers.setTimeout/clearTimeout, never read Date.now() themselves, so a
 * simple remaining-ms countdown advanced manually is enough to make the
 * 500ms debounce deterministic under `node --test`. */
function makeManualTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { remaining: delay, callback });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      const due = [];
      for (const [id, timer] of pending) {
        timer.remaining -= ms;
        if (timer.remaining <= 0) due.push(id);
      }
      due.sort((a, b) => a - b);
      for (const id of due) {
        const timer = pending.get(id);
        if (!timer) continue; // cleared by an earlier callback in this same batch
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

function makeRecordingLogger() {
  const errors = [];
  const warns = [];
  return {
    errors,
    warns,
    error: (...args) => errors.push(args),
    warn: (...args) => warns.push(args),
  };
}

function makeRecordingShell() {
  const toasts = [];
  const saveStates = [];
  const recoveryEntriesPushes = [];
  return {
    toasts,
    saveStates,
    recoveryEntriesPushes,
    showToast: (message) => toasts.push(message),
    setSaveState: (state) => saveStates.push(state),
    setRecoveryEntries: (entries) => recoveryEntriesPushes.push(entries),
    setWorkflowProgress: () => {},
  };
}

function makeFakeGuided(overrides = {}) {
  const base = { version: 1, status: 'not-started', currentStepId: 'step-a', completedStepIds: [], completedAt: null };
  return {
    load: () => ({ ...base }),
    start: (workflow, opts) => ({ ...(opts.state || base), status: 'active' }),
    resume: (workflow, opts) => ({ ...(opts.state || base), status: 'active' }),
    pause: (workflow, opts) => ({ ...(opts.state || base), status: 'paused' }),
    advance: (workflow, opts) => ({ ...(opts.state || base) }),
    restart: () => ({ ...base }),
    ...overrides,
  };
}

/** A recording persist bundle with sane no-op defaults; pass `overrides` for
 * the one or two methods a given test cares about. saveExperiment records a
 * deep-cloned snapshot of every experiment it was called with (deep-cloned
 * so a later store.replace() can never retroactively change what was
 * "recorded" as having been saved). */
function makeFakePersist(overrides = {}) {
  const calls = { saveExperiment: [], clearAll: 0, markChanged: 0, deleteExperiment: [] };
  let nextSlotId = 1;
  return {
    calls,
    saveExperiment: (experiment, opts) => {
      calls.saveExperiment.push(JSON.parse(JSON.stringify(experiment)));
      if (overrides.saveExperiment) return overrides.saveExperiment(experiment, opts);
      const id = `slot-${nextSlotId}`;
      nextSlotId += 1;
      return id;
    },
    clearAll: (opts) => {
      calls.clearAll += 1;
      return overrides.clearAll ? overrides.clearAll(opts) : { ok: true, removed: [], error: null };
    },
    deleteExperiment: (id, opts) => {
      calls.deleteExperiment.push(id);
      return overrides.deleteExperiment ? overrides.deleteExperiment(id, opts) : undefined;
    },
    exportToFile: overrides.exportToFile || (() => {}),
    importFromFile: overrides.importFromFile || (() => Promise.resolve({ experiment: null, issues: [] })),
    listSaved: overrides.listSaved || (() => []),
    loadExperiment: overrides.loadExperiment || (() => null),
    loadMostRecentRecoverable:
      overrides.loadMostRecentRecoverable || (() => ({ experiment: null, skippedCount: 0, totalSaved: 0 })),
    loadRecoverableSlot: overrides.loadRecoverableSlot || (() => ({ id: null, experiment: null, error: null })),
    markChanged: (opts) => {
      calls.markChanged += 1;
      if (overrides.markChanged) overrides.markChanged(opts);
    },
    markExported: overrides.markExported || (() => {}),
  };
}

function makeController(overrides = {}) {
  const store = overrides.store || createStore(emptyExperiment());
  const persist = overrides.persist || makeFakePersist();
  const guided = overrides.guided || makeFakeGuided();
  const timers = overrides.timers || makeManualTimers();
  const logger = overrides.logger || makeRecordingLogger();
  const controller = createAppController({
    store,
    persist,
    guided,
    primaryWorkflow: overrides.primaryWorkflow || [],
    createExampleStudy: overrides.createExampleStudy || (() => withTitle(emptyExperiment(), 'example')),
    createEmptyStudy: overrides.createEmptyStudy || emptyExperiment,
    isPersisted: overrides.isPersisted || false,
    // Defaults to the REAL tab, matching createAppController's own default --
    // the safe reading absent other information is "this is somebody's real
    // study". A test that wants the practice tab has to say so, which is what
    // makes the refusal below impossible to pass by accident.
    isSandbox: overrides.isSandbox || false,
    timers,
    now: overrides.now || (() => 'FIXED_TIMESTAMP'),
    logger,
  });
  return { controller, store, persist, guided, timers, logger };
}

function tick() {
  return Promise.resolve();
}

// --- Autosave debounce ------------------------------------------------

test('autosave debounce: five edits inside 500ms produce exactly one save, and nothing fires at 499ms', async () => {
  const { controller, store, persist, timers } = makeController();
  controller.startAutosave();

  for (let i = 0; i < 5; i += 1) {
    store.patch({ meta: { ...store.get().meta, title: `edit-${i}` } });
    await tick();
    timers.advance(80); // always well inside the window; each edit resets the timer to a fresh 500ms
  }
  assert.equal(persist.calls.saveExperiment.length, 0, 'no save yet while edits keep resetting the debounce');

  // 80ms already elapsed since the 5th (last) edit above.
  timers.advance(419); // total since last edit: 499ms
  assert.equal(persist.calls.saveExperiment.length, 0, 'must not fire at 499ms');

  timers.advance(1); // total since last edit: 500ms
  assert.equal(persist.calls.saveExperiment.length, 1, 'exactly one save for the whole burst');
  assert.equal(persist.calls.saveExperiment[0].meta.title, 'edit-4');
});

// --- Fix 1: startBlankStudy must not lose the just-typed edit ---------

test('startBlankStudy flushes the pending autosave with the EDITED study before replace (fails pre-fix)', async () => {
  const store = createStore(withTitle(emptyExperiment(), 'original'));
  const { controller, persist, timers } = makeController({ store });
  controller.startAutosave();

  store.patch({ meta: { ...store.get().meta, title: 'edited' } });
  await tick();
  timers.advance(200); // well before the 500ms autosave would otherwise fire

  const result = controller.actions.onNewBlank();

  assert.equal(result, true);
  assert.ok(persist.calls.saveExperiment.length >= 1, 'flushAutosave/protected snapshot must have saved something');
  // Every save recorded during startBlankStudy must be the EDITED study --
  // none of them may be the blank study that store.replace() installs next.
  for (const saved of persist.calls.saveExperiment) {
    assert.equal(saved.meta.title, 'edited');
  }
  // The live store is now the blank study; the edit was preserved in Restore
  // (the recorded saves above), not in the live workspace.
  assert.equal(store.get().meta.title, '');
});

test('startBlankStudy aborts and leaves the store unchanged when the protected snapshot fails', () => {
  const store = createStore(withTitle(emptyExperiment(), 'mine'));
  const persist = makeFakePersist({ saveExperiment: () => null });
  const { controller } = makeController({ store, persist });

  const result = controller.actions.onNewBlank();

  assert.equal(result, false);
  assert.equal(store.get().meta.title, 'mine');
  assert.equal(controller.getSaveState().status, 'failed');
});

// --- Fix 2: clearAllStoredData must not lie ----------------------------

test('clearAllStoredData shows the success toast only when clear AND the re-save both succeed', () => {
  const persist = makeFakePersist();
  const shell = makeRecordingShell();
  const { controller } = makeController({ persist });
  controller.attachShell(shell);

  const result = controller.actions.onClearAllStorage();

  assert.equal(result, true);
  assert.equal(controller.getSaveState().status, 'saved');
  assert.ok(shell.toasts.some((m) => m.includes('Cleared all locally stored data')));
});

test('clearAll returning a failure result produces a failure toast, never the success one (fails pre-fix)', () => {
  const persist = makeFakePersist({
    clearAll: () => ({ ok: false, removed: [], error: new Error('storage backend unavailable') }),
  });
  const shell = makeRecordingShell();
  const { controller } = makeController({ persist });
  controller.attachShell(shell);

  const result = controller.actions.onClearAllStorage();

  assert.equal(result, false);
  assert.equal(controller.getSaveState().status, 'failed');
  assert.ok(controller.getSaveState().error, 'the failure must remain visible, not be erased');
  assert.ok(!shell.toasts.some((m) => m.includes('Cleared all locally stored data')), 'no success toast');
  assert.ok(shell.toasts.some((m) => m.includes('Could not clear stored data')), 'a failure toast must fire');
});

test('clearAllStoredData reports failure (not success) when clear succeeds but the re-save fails', () => {
  const persist = makeFakePersist({ saveExperiment: () => null });
  const shell = makeRecordingShell();
  const { controller } = makeController({ persist });
  controller.attachShell(shell);

  const result = controller.actions.onClearAllStorage();

  assert.equal(result, false);
  assert.equal(controller.getSaveState().status, 'failed');
  assert.ok(!shell.toasts.some((m) => m.includes('Cleared all locally stored data')));
  assert.ok(shell.toasts.some((m) => m.includes('could not be re-saved')));
});

test('a storage whose length getter throws does not escape clearAllStoredData', () => {
  // Exercises the REAL persist.js clearAll (not a fake) against a storage
  // that throws on the `length` getter clearAll enumerates keys with --
  // proving the actual degrade path, not a model of it.
  const hostileStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    get length() {
      throw new Error('hostile length');
    },
    key: () => null,
  };
  const realPersistOverHostileStorage = {
    clearAll: (opts) => realClearAll({ ...opts, storage: hostileStorage }),
    deleteExperiment: (id, opts) => realDeleteExperiment(id, { ...opts, storage: hostileStorage }),
    exportToFile: () => {},
    importFromFile: () => Promise.reject(new Error('not exercised in this test')),
    listSaved: (opts) => realListSaved({ ...opts, storage: hostileStorage }),
    loadExperiment: (id, opts) => realLoadExperiment(id, { ...opts, storage: hostileStorage }),
    loadMostRecentRecoverable: (opts) => realLoadMostRecentRecoverable({ ...opts, storage: hostileStorage }),
    loadRecoverableSlot: (id, opts) => realLoadRecoverableSlot(id, { ...opts, storage: hostileStorage }),
    markChanged: (opts) => realMarkChanged({ ...opts, storage: hostileStorage }),
    markExported: (opts) => realMarkExported({ ...opts, storage: hostileStorage }),
    saveExperiment: (experiment, opts) => realSaveExperiment(experiment, { ...opts, storage: hostileStorage }),
  };
  const shell = makeRecordingShell();
  const { controller } = makeController({ persist: realPersistOverHostileStorage });
  controller.attachShell(shell);

  let result;
  assert.doesNotThrow(() => {
    result = controller.actions.onClearAllStorage();
  });
  assert.equal(result, false);
  assert.equal(controller.getSaveState().status, 'failed');
});

// --- Fix 3: the example/template origin gate ---------------------------

test('isExampleOrigin accepts both "example" and "template", and rejects everything else', () => {
  assert.equal(isExampleOrigin('example'), true);
  assert.equal(isExampleOrigin('template'), true);
  assert.equal(isExampleOrigin('blank'), false);
  assert.equal(isExampleOrigin('imported'), false);
  assert.equal(isExampleOrigin(undefined), false);
});

test('adoptExampleTemplate now actually fires for a store tagged "template" (dead pre-fix)', () => {
  const store = createStore(withOrigin(emptyExperiment(), 'template'));
  const { controller } = makeController({ store });

  const adopted = controller.actions.onAdoptExample();

  assert.equal(adopted, true);
  assert.equal(store.get().meta.origin, 'template');
});

test('adoptExampleTemplate still refuses a store that never came from the example', () => {
  const store = createStore(withOrigin(emptyExperiment(), 'blank'));
  const { controller } = makeController({ store });

  assert.equal(controller.actions.onAdoptExample(), false);
});

// --- openExampleStudy's protected snapshot ------------------------------

test('openExampleStudy aborts and leaves store.get() unchanged when the protective save returns null', () => {
  // isSandbox: true because this behaviour now only exists inside the practice
  // tab -- in the real tab the refusal below fires first and the protective
  // save is never even attempted. Without this the test would still pass for
  // the WRONG reason (nothing replaced, because nothing ran).
  const original = withTitle(emptyExperiment(), 'my current work');
  const store = createStore(original);
  const persist = makeFakePersist({ saveExperiment: () => null });
  const shell = makeRecordingShell();
  const { controller } = makeController({ store, persist, isSandbox: true });
  controller.attachShell(shell);

  const result = controller.actions.onOpenExample();

  assert.equal(result, false);
  assert.equal(store.get(), original, 'the store must not have been replaced');
  assert.equal(controller.getSaveState().status, 'failed');
});

test('openExampleStudy refuses outside the practice tab, under either action name', () => {
  // The guarantee the whole feature rests on: in a real tab there is no way
  // to reach the study-replacing path at all. Asserting via the PUBLIC action
  // names (not the internal function) is deliberate -- those are what a
  // future button, a mis-merge, or a console call would reach for, and the
  // guard exists precisely because a call-site check cannot cover them.
  for (const actionName of ['onOpenExample', 'onReset']) {
    const original = withTitle(emptyExperiment(), 'my real study');
    const store = createStore(original);
    const persist = makeFakePersist();
    const { controller, logger } = makeController({ store, persist });

    assert.equal(controller.actions[actionName](), false, `${actionName} must refuse`);
    assert.equal(store.get(), original, `${actionName} must not replace the study`);
    // Not even the protective snapshot runs: refusing early means the real
    // tab's ring is not written to at all, so a stray call cannot churn it.
    assert.equal(persist.calls.saveExperiment.length, 0, `${actionName} must not write`);
    assert.equal(logger.errors.length, 1, `${actionName} must say why it refused`);
  }
});

test('openExampleStudy flushes a pending autosave before replacing the study', async () => {
  // The bug startBlankStudy documents at length, which openExampleStudy had
  // too and nothing had yet triggered: a pending 500ms debounce holds a
  // closure that fires AFTER store.replace(), reads store.get() fresh, and
  // persists the EXAMPLE over the slot that should hold the practice edit
  // made just before reset. Flushing first is what makes the saved snapshot
  // the edit rather than the example.
  const store = createStore(withTitle(emptyExperiment(), 'practice edit'));
  const persist = makeFakePersist();
  const timers = makeManualTimers();
  const { controller } = makeController({ store, persist, timers, isSandbox: true });
  controller.startAutosave();

  store.patch({ researchQuestion: 'edited in the sandbox' });
  await tick();
  assert.equal(persist.calls.saveExperiment.length, 0, 'the debounce should still be holding the save');

  controller.actions.onReset();

  // The flushed save ran against the edit, not the example that replaced it.
  assert.equal(persist.calls.saveExperiment[0].researchQuestion, 'edited in the sandbox');

  // And the timer really was cancelled rather than left to fire late: advancing
  // well past the debounce window must not produce another save of the example
  // on top of it. (The protective snapshot is the only other save expected.)
  const savesAfterReset = persist.calls.saveExperiment.length;
  timers.advance(5000);
  assert.equal(persist.calls.saveExperiment.length, savesAfterReset,
    'a cancelled timer must not fire afterwards');
});

// --- Guided-progress storage failure announcement -----------------------

test('a guided storage failure before attachShell neither throws nor toasts; after attachShell it toasts exactly once', () => {
  const brokenState = { version: 1, status: 'not-started', currentStepId: 'step-a', completedStepIds: [], completedAt: null };
  const failingTransition = (workflow, { onError, state }) => {
    onError(new Error('disk full'));
    return state || brokenState;
  };
  const guided = makeFakeGuided({
    load: (workflow, { onError }) => {
      onError(new Error('disk full'));
      return brokenState;
    },
    start: failingTransition,
    resume: failingTransition,
    pause: failingTransition,
  });

  let controller;
  assert.doesNotThrow(() => {
    ({ controller } = makeController({ guided }));
  });

  const shell = makeRecordingShell();
  controller.attachShell(shell);
  assert.equal(shell.toasts.length, 0, 'attaching the shell by itself must not toast');

  // Every subsequent transition also fails (same injected `guided`); the
  // announcement must still only fire once.
  controller.guidedTransitions.start();
  assert.equal(shell.toasts.length, 1);

  controller.guidedTransitions.resume();
  controller.guidedTransitions.pause();
  assert.equal(shell.toasts.length, 1, 'the failure is announced once, not on every transition');
});

// --- resolveInitialExperiment --------------------------------------------

test('resolveInitialExperiment: every slot unreadable reports isPersisted:false with skippedCount === totalSaved', () => {
  const unreadableIds = [];
  const persist = {
    loadMostRecentRecoverable: ({ onUnreadable }) => {
      onUnreadable('slot-a', new Error('corrupt json'));
      onUnreadable('slot-b', new Error('corrupt json'));
      return { experiment: null, skippedCount: 2, totalSaved: 2 };
    },
  };

  // emptyExperiment() mints a fresh random assay id every call, so the
  // fallback factory must be reference-stable for this assertion -- the
  // point under test is "which object came back", not "are two independently
  // minted empty studies deep-equal".
  const fallback = emptyExperiment();
  const result = resolveInitialExperiment(persist, () => fallback, {
    onUnreadable: (id) => unreadableIds.push(id),
  });

  assert.equal(result.isPersisted, false);
  assert.equal(result.skippedCount, result.totalSaved);
  assert.equal(result.totalSaved, 2);
  assert.deepEqual(unreadableIds, ['slot-a', 'slot-b']);
  assert.equal(result.experiment, fallback);
});

test('resolveInitialExperiment: a recovered experiment is passed through unchanged and marked persisted', () => {
  const recovered = withTitle(emptyExperiment(), 'recovered study');
  const persist = { loadMostRecentRecoverable: () => ({ experiment: recovered, skippedCount: 1, totalSaved: 2 }) };

  const result = resolveInitialExperiment(persist, () => emptyExperiment(), {});

  assert.equal(result.experiment, recovered);
  assert.equal(result.isPersisted, true);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.totalSaved, 2);
});

// --- pure helpers ---------------------------------------------------------

test('withOrigin replaces only meta.origin and leaves the rest of the experiment untouched', () => {
  const experiment = withTitle(emptyExperiment(), 'a study');
  const tagged = withOrigin(experiment, 'imported');
  assert.equal(tagged.meta.origin, 'imported');
  assert.equal(tagged.meta.title, 'a study');
  assert.notEqual(tagged, experiment, 'must not mutate the input');
});

test('projectFilename sanitizes the title into a safe filename and falls back when blank', () => {
  assert.equal(projectFilename(withTitle(emptyExperiment(), 'My Cool Study!')), 'My-Cool-Study.micronaut.json');
  assert.equal(projectFilename(emptyExperiment()), 'micronaut-study.micronaut.json');
});

// --- The contract AUD-09..AUD-15 depend on -------------------------------

test('actions exposes exactly the callback names renderShell/renderActiveStep relied on pre-extraction', () => {
  const { controller } = makeController();
  const expectedKeys = [
    'onReset',
    'onNewBlank',
    'onAdoptExample',
    'onOpenExample',
    'onExportProject',
    'onImportProject',
    'onRestoreRecovery',
    'onDeleteRecovery',
    'onClearAllStorage',
  ];
  assert.deepEqual(Object.keys(controller.actions).sort(), [...expectedKeys].sort());
  for (const key of expectedKeys) {
    assert.equal(typeof controller.actions[key], 'function', `${key} must be a function`);
  }
  // onReset and onOpenExample are the same underlying action (both were
  // `openExampleStudy` pre-extraction) -- preserved so both call sites keep
  // behaving identically.
  assert.equal(controller.actions.onReset, controller.actions.onOpenExample);
});

test('createAppController returns exactly the documented lifecycle surface', () => {
  const { controller } = makeController();
  const expectedKeys = [
    'attachShell',
    'actions',
    'guidedTransitions',
    'getGuidedState',
    'getSaveState',
    'recoveryEntries',
    'startAutosave',
    'flushAutosave',
  ];
  for (const key of expectedKeys) {
    assert.ok(key in controller, `missing ${key}`);
  }
  for (const name of ['start', 'resume', 'pause', 'advance', 'restart']) {
    assert.equal(typeof controller.guidedTransitions[name], 'function', `guidedTransitions.${name}`);
  }
});
