// V6-NEW-01: the DECISIVE half of R6-04/R6-05 -- no timing required.
// restoreRecoverySlot()/importProjectBackup() displace the open study without
// taking the PROTECTED snapshot that startBlankStudy()/openExampleStudy() take.
// persist.js's ring is 5 slots and every autosave allocates a NEW slot
// (persist.js:116 `const id = uuid()`), so five ordinary debounced autosaves
// after a restore evict every unprotected slot that held the displaced study.
// shell.js:378 promised "Your current work remains available in Restore."
//
// This uses the REAL core/persist.js against an injected Map-backed storage
// (persist.js takes `storage` on every entry point) and the REAL
// core/appController.js -- no fake persistence anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as persistMod from '../src/core/persist.js';
import { createAppController } from '../src/core/appController.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
  };
}

function bundle(storage) {
  const w = (fn) => (...args) => {
    const last = args[args.length - 1];
    const opts = last && typeof last === 'object' && !Array.isArray(last) && args.length > 1 ? { ...last, storage } : { storage };
    return fn(...args.slice(0, Math.max(args.length - (args.length > 1 ? 1 : 0), fn.length - 1)), opts);
  };
  return {
    clearAll: (o = {}) => persistMod.clearAll({ ...o, storage }),
    deleteExperiment: (id, o = {}) => persistMod.deleteExperiment(id, { ...o, storage }),
    exportToFile: () => {},
    importFromFile: () => Promise.resolve({ experiment: null, issues: [] }),
    listSaved: (o = {}) => persistMod.listSaved({ ...o, storage }),
    loadExperiment: (id, o = {}) => persistMod.loadExperiment(id, { ...o, storage }),
    loadMostRecentRecoverable: (f, o = {}) => persistMod.loadMostRecentRecoverable(f, { ...o, storage }),
    loadRecoverableSlot: (id, o = {}) => persistMod.loadRecoverableSlot(id, { ...o, storage }),
    markChanged: (o = {}) => persistMod.markChanged({ ...o, storage }),
    markExported: (o = {}) => persistMod.markExported({ ...o, storage }),
    saveExperiment: (e, o = {}) => persistMod.saveExperiment(e, { ...o, storage }),
    _w: w,
  };
}

function titled(t) { const e = emptyExperiment(); return { ...e, meta: { ...e.meta, title: t } }; }

function manualTimers() {
  let next = 1; const pending = new Map();
  return {
    setTimeout(cb, d) { const id = next++; pending.set(id, { d, cb }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      for (const [id, t] of [...pending]) { t.d -= ms; if (t.d <= 0) { pending.delete(id); t.cb(); } }
    },
  };
}

async function scenario(displace) {
  const storage = memStorage();
  const persist = bundle(storage);
  // An OLD version already sits in the ring (this is what the user restores).
  const oldSlot = persist.saveExperiment(titled('OLD-VERSION'));
  const store = createStore(titled('MY REAL WORK'));
  const timers = manualTimers();
  const controller = createAppController({
    store, persist, guided: {
      load: () => ({ status: 'not-started' }), start: () => ({}), resume: () => ({}),
      pause: () => ({}), advance: () => ({}), restart: () => ({}),
    },
    primaryWorkflow: [], createExampleStudy: () => titled('example'), createEmptyStudy: emptyExperiment,
    timers, now: () => 'FIXED', logger: { error: () => {}, warn: () => {} },
  });
  controller.startAutosave();
  // The user works for a while: the real study IS autosaved into the ring.
  store.patch({ meta: { ...store.get().meta, title: 'MY REAL WORK (edited)' } });
  await Promise.resolve();
  timers.advance(600);
  const before = persist.listSaved().map((id) => persist.loadExperiment(id)?.meta?.title);
  assert.ok(before.includes('MY REAL WORK (edited)'), `precondition: the open study is in the ring: ${JSON.stringify(before)}`);

  await displace(controller, oldSlot);
  await Promise.resolve();

  // Five ordinary edits in the restored/imported study -- seconds of typing.
  for (let i = 0; i < 5; i += 1) {
    store.patch({ meta: { ...store.get().meta, title: `after-${i}` } });
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
    timers.advance(600);
  }
  return persist.listSaved().map((id) => persist.loadExperiment(id)?.meta?.title);
}

test('V6-NEW-01: after restoreRecoverySlot, the displaced study is evicted from Restore within 5 autosaves', async () => {
  const titles = await scenario((controller, oldSlot) => {
    assert.equal(controller.actions.onRestoreRecovery(oldSlot), true);
  });
  assert.ok(
    titles.includes('MY REAL WORK (edited)'),
    `BUG: shell.js:378 promised "Your current work remains available in Restore", but the ring now holds ${JSON.stringify(titles)}. ` +
    'restoreRecoverySlot takes no protectFromAutomaticEviction snapshot.'
  );
});

test('V6-NEW-01b: after importProjectBackup, same eviction', async () => {
  const storage = memStorage();
  const persist = bundle(storage);
  persist.importFromFile = () => Promise.resolve({ experiment: titled('IMPORTED'), issues: [] });
  const store = createStore(titled('MY REAL WORK'));
  const timers = manualTimers();
  const controller = createAppController({
    store, persist, guided: { load: () => ({}), start: () => ({}), resume: () => ({}), pause: () => ({}), advance: () => ({}), restart: () => ({}) },
    primaryWorkflow: [], createExampleStudy: () => titled('example'), createEmptyStudy: emptyExperiment,
    timers, now: () => 'FIXED', logger: { error: () => {}, warn: () => {} },
  });
  controller.startAutosave();
  store.patch({ meta: { ...store.get().meta, title: 'MY REAL WORK (edited)' } });
  await Promise.resolve();
  timers.advance(600);
  assert.ok(persist.listSaved().map((id) => persist.loadExperiment(id)?.meta?.title).includes('MY REAL WORK (edited)'), 'precondition: open study is in the ring');
  await controller.actions.onImportProject({ name: 'b.json' });
  for (let i = 0; i < 5; i += 1) { store.patch({ meta: { ...store.get().meta, title: `after-${i}` } }); await Promise.resolve(); timers.advance(600); }
  const titles = persist.listSaved().map((id) => persist.loadExperiment(id)?.meta?.title);
  assert.ok(titles.includes('MY REAL WORK (edited)'), `BUG: pre-import study evicted. Ring: ${JSON.stringify(titles)}`);
});

test('V6-NEW-01c: CONTROL -- startBlankStudy keeps the displaced study forever (protected slot)', async () => {
  const titles = await scenario((controller) => { assert.equal(controller.actions.onNewBlank(), true); });
  assert.ok(titles.includes('MY REAL WORK (edited)'), `control failed (harness artefact suspected): ${JSON.stringify(titles)}`);
});
