// D1: shell.js's toast queue, ticking save label, and the shell.destroy()
// teardown. Renders the REAL renderShell (not just source-text greps) the
// same way the adopted repro this task closes out
// (<scratch>/findings/r6/toastCollision.test.js, R6-06) does, patching the
// handful of window/document capabilities web/tests/domStub.js does not
// provide (setInterval/clearInterval, addEventListener/removeEventListener,
// document.documentElement.removeAttribute) locally in this file rather than
// growing the shared stub -- domStub.js is not one of this task's files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDomStub } from './domStub.js';
import { renderShell } from '../src/ui/shell.js';
import { createStore } from '../src/core/store.js';
import { createRouter } from '../src/core/router.js';
import { emptyExperiment } from '../src/core/schema.js';

const shellSrc = readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');

// A tiny manual clock for setInterval/setTimeout, layered onto domStub's
// window: domStub's own advance() already drives its manual setTimeout queue
// but has no setInterval concept (ticks recur, timeouts don't) and no
// addEventListener at the window level (feedbackHandoff.js is the only
// existing consumer of that, via its own local harness -- see its test file's
// header comment for the same reasoning applied here).
function patchStubForShell(stub) {
  let nextId = 1;
  const intervals = new Map();
  const listeners = new Map();
  stub.window.setInterval = (callback, delay) => {
    const id = nextId++;
    intervals.set(id, { callback, delay });
    return id;
  };
  stub.window.clearInterval = (id) => { intervals.delete(id); };
  stub.window.addEventListener = (type, handler) => {
    const list = listeners.get(type) || [];
    list.push(handler);
    listeners.set(type, list);
  };
  stub.window.removeEventListener = (type, handler) => {
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter((h) => h !== handler));
  };
  stub.window.dispatchPagehide = () => { for (const handler of listeners.get('pagehide') || []) handler(); };
  // Fires every registered interval's callback once, as if `ms` had elapsed
  // (this suite never needs sub-tick precision across multiple intervals).
  stub.window.tickIntervals = () => { for (const { callback } of intervals.values()) callback(); };
  stub.window.intervalCount = () => intervals.size;
  stub.document.addEventListener = () => {};
  stub.document.removeEventListener = () => {};
  stub.document.documentElement.removeAttribute = function removeAttribute(name) {
    this.attributes.delete(name);
  };
}

function mountShell(options = {}) {
  const stub = createDomStub();
  const { document } = stub.install();
  patchStubForShell(stub);
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.location = { hash: '', search: '' };
  const store = createStore(emptyExperiment());
  const steps = [
    { id: 'home', title: 'Home', render() {} },
    { id: 'study', title: 'Measurements', render() {} },
  ];
  const router = createRouter(steps);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const shell = renderShell(root, store, router, {
    saveState: { status: 'saved', savedAt: null, error: null },
    recoveryEntries: [],
    workflowProgress: { primary: [], assays: [], summary: {} },
    ...options,
  });
  return {
    shell,
    root,
    stub,
    cleanup() {
      shell.destroy();
      stub.restore();
      delete globalThis.localStorage;
      delete globalThis.location;
    },
  };
}

// R6-06/R5-04, adapted from <scratch>/findings/r6/toastCollision.test.js:
// that repro's own assertion (both messages readable in root.textContent
// with NO advance() between the two synchronous calls) matches showToast's
// OLD single-slot behaviour, where the second write is instantaneous and
// simply replaces the first -- so pre-fix it needs no delay to observe
// either message. This task's actual fix is a QUEUE (each message gets its
// own full visible duration; scope text: "each message is shown for its
// duration"), which cannot make two messages readable in the SAME
// synchronous snapshot by construction. The invariant that matters --
// "destroyed" vs merely "queued" -- is instead proven by asserting the FIRST
// message is still on screen immediately after the second call arrives (it
// is untouched, not overwritten), then advancing past its 3s duration to
// observe the second. Declared deviation (lesson 35): the adopted test's
// literal double-assertion-with-no-advance is FALSIFIED as incompatible with
// a queue by construction; this is the delivered contract for this fix.
test('R6-06/R5-04: two toasts fired in the same synchronous tick are both eventually seen, never destroyed', () => {
  const { shell, root, stub, cleanup } = mountShell({ kbIssueCount: 3 });
  try {
    shell.showToast('Knowledge pack loaded with 3 issue(s) -- some markers or guidance may be unavailable.');
    shell.showToast('Recovered your work -- skipped 2 unreadable autosave(s) and used an older one instead.');

    // Still showing the FIRST message right after the second call arrives --
    // pre-fix this is already false (the second write clobbers instantly).
    assert.match(root.textContent, /Knowledge pack loaded with 3 issue/, 'the first toast must not be destroyed by the second');
    assert.doesNotMatch(root.textContent, /Recovered your work/, 'the second toast must be queued, not shown early');

    stub.window.advance(3000); // the first toast's full duration elapses
    assert.doesNotMatch(root.textContent, /Knowledge pack loaded/, 'the first toast fades on schedule');
    assert.match(root.textContent, /Recovered your work/, 'the queued second toast is now shown');
  } finally {
    cleanup();
  }
});

test('a fourth toast queued while three are already waiting drops the OLDEST queued message (max 3)', () => {
  const { shell, root, stub, cleanup } = mountShell();
  try {
    shell.showToast('m1');
    shell.showToast('m2');
    shell.showToast('m3');
    shell.showToast('m4');
    shell.showToast('m5');
    // m1 shows immediately; m2/m3/m4/m5 queue behind it, but the cap on the
    // QUEUE (not counting whatever is currently visible) is 3 -- once a 4th
    // message queues behind m1, the oldest queued one (m2) is dropped.
    assert.match(root.textContent, /m1/);
    stub.window.advance(3000);
    assert.match(root.textContent, /m3/, 'm3 should be next, m2 having been dropped');
    stub.window.advance(3000);
    assert.match(root.textContent, /m4/);
    stub.window.advance(3000);
    assert.match(root.textContent, /m5/);
  } finally {
    cleanup();
  }
});

test('R4-15: the live region text is cleared (not just hidden) after a toast fades', () => {
  const { shell, root, stub, cleanup } = mountShell();
  try {
    shell.showToast('Downloaded micronaut-schedule.ics -- import it into your calendar app.');
    assert.match(root.textContent, /Downloaded micronaut-schedule/);
    stub.window.advance(3000);
    assert.doesNotMatch(root.textContent, /Downloaded micronaut-schedule/, 'stale toast text must not linger in the DOM after it fades');
  } finally {
    cleanup();
  }
});

// V6-NEW-04: the save label and Restore rows used to freeze at whatever they
// said at the last explicit write, with no timer anywhere re-rendering them.
test('V6-NEW-04: the save-state ticker re-renders the save indicator every 30s while status is "saved", and tears down on pagehide/destroy', () => {
  const { shell, stub, cleanup } = mountShell();
  try {
    assert.equal(stub.window.intervalCount(), 1, 'renderShell must register exactly one ticking interval');
    // Re-rendering under a frozen saveState is idempotent and observable only
    // via source (grep below) plus the interval actually existing and firing
    // without throwing.
    assert.doesNotThrow(() => stub.window.tickIntervals());
    stub.window.dispatchPagehide();
    assert.equal(stub.window.intervalCount(), 0, 'pagehide must clear the interval');
  } finally {
    cleanup(); // destroy() on an already-cleared interval must be a safe no-op
  }
});

test('shell.destroy() clears the ticking interval even without a pagehide event', () => {
  const { shell, stub } = mountShell();
  assert.equal(stub.window.intervalCount(), 1);
  shell.destroy();
  assert.equal(stub.window.intervalCount(), 0);
  stub.restore();
  delete globalThis.localStorage;
  delete globalThis.location;
});

// Source-level assertions per this task's verification text: the mechanism
// (a real 30s interval, real pagehide teardown) exists in the shipped code,
// not just in a test harness standing in for it.
test('source: renderSaveState is ticked on a real 30000ms interval, torn down on pagehide', () => {
  assert.match(shellSrc, /window\.setInterval\(tickSaveState,\s*30000\)/);
  assert.match(shellSrc, /window\.addEventListener\('pagehide', handlePagehide\)/);
  assert.match(shellSrc, /destroy\(\)\s*\{/);
});

// V5-NEW-03: two restore rows with identical titles and identical rendered
// times must still carry different accessible names, via their position in
// the ring (`version i of n`).
test('V5-NEW-03: two identically-titled, identically-timed restore rows get different aria-labels', () => {
  const now = () => 1_700_000_000_000;
  const sameIso = new Date(now() - 5000).toISOString(); // both "5s ago"
  const entries = [
    { id: 'a', title: 'Untitled study', savedAt: sameIso },
    { id: 'b', title: 'Untitled study', savedAt: sameIso },
  ];
  const { shell, root, cleanup } = mountShell({
    recoveryEntries: entries,
    onRestoreRecovery: () => {},
  });
  try {
    const buttons = root.querySelectorAll('.shell-restore-action');
    assert.equal(buttons.length, 2);
    const labels = buttons.map((b) => b.getAttribute('aria-label'));
    assert.notEqual(labels[0], labels[1], 'identical title+time rows must still have distinct accessible names');
    assert.match(labels[0], /version 1 of 2/);
    assert.match(labels[1], /version 2 of 2/);
  } finally {
    cleanup();
  }
});
