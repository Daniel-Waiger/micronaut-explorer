// R4-19: nothing anywhere in the workflow ever set meta.title, so every
// Restore-list row and every export read the hard 'Untitled study' fallback
// (appController.recoveryEntries and appController.projectFilename both
// already prefer meta.title -- they just never had anything to read). This
// suite drives the real "Study title" field ui/studyMap.js now renders,
// through the store, into recoveryEntries -- proving the write side and the
// pre-existing read side actually agree, not just that each independently
// looks right in isolation (docs/cma-lessons.md lesson 50).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomStub } from './domStub.js';
import { createStudyMap } from '../src/ui/studyMap.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import { createAppController } from '../src/core/appController.js';

function findTitleInput(main) {
  return main.querySelector('#study-map-title');
}

test('typing a Study title writes meta.title through the store, tagged "user"', () => {
  const dom = createDomStub();
  dom.install();
  try {
    const store = createStore(emptyExperiment());
    const map = createStudyMap({ store, router: { navigate: () => {} } });
    // Answer every orientation question so the map renders its SUMMARY
    // (where the title field also appears), not the intake flow -- proving
    // the field survives into both render modes would be nice but is not
    // required by the finding; the summary is the steady-state most users
    // spend their time in.
    store.patch({
      researchQuestion: 'q',
      studyContext: { system: 's', comparisonMode: 'observational', experimentalUnit: 'u' },
    });
    map.refresh();

    const titleInput = findTitleInput(map.element);
    assert.ok(titleInput, 'expected a Study title field to render');
    assert.equal(store.get().meta.title, '', 'a brand-new study has no title yet');

    titleInput.value = 'Tomato drought study';
    titleInput.dispatch('input');

    assert.equal(store.get().meta.title, 'Tomato drought study');
    const slotKey = 'meta.title';
    assert.equal(store.get().provenance?.slots?.[slotKey]?.tag, 'user', 'first entry is tagged plain user');

    // Editing it again after it is already 'user' (STRONG) stays 'user' --
    // editTagFor only promotes to 'user_edited' when correcting a WEAK/
    // PROVISIONAL value, same rule every other map field already follows.
    titleInput.value = 'Tomato drought study, revised';
    titleInput.dispatch('input');
    assert.equal(store.get().meta.title, 'Tomato drought study, revised');
    assert.equal(store.get().provenance?.slots?.[slotKey]?.tag, 'user');
  } finally {
    dom.restore();
  }
});

test('a title typed on the Study map appears in the Restore list (appController.recoveryEntries)', () => {
  const dom = createDomStub();
  dom.install();
  try {
    const store = createStore(emptyExperiment());
    const map = createStudyMap({ store, router: { navigate: () => {} } });
    map.refresh();
    const titleInput = findTitleInput(map.element);
    titleInput.value = 'Root architecture under drought';
    titleInput.dispatch('input');

    // A minimal persist bundle whose one saved slot mirrors the live store,
    // exactly as a real autosave would -- this is the seam that proves the
    // WRITE (studyMap.js) and the READ (appController.recoveryEntries)
    // genuinely share one path, not two independently-correct halves that
    // happen to agree on a name (lesson 50).
    const persist = {
      saveExperiment: () => 'slot-1',
      clearAll: () => ({ ok: true, removed: [], error: null }),
      deleteExperiment: () => {},
      exportToFile: () => {},
      importFromFile: () => Promise.resolve({ experiment: null, issues: [] }),
      listSaved: () => ['slot-1'],
      loadExperiment: () => store.get(),
      loadMostRecentRecoverable: () => ({ experiment: null, skippedCount: 0, totalSaved: 0 }),
      loadRecoverableSlot: () => ({ id: null, experiment: null, error: null }),
      markChanged: () => {},
      markExported: () => {},
    };
    const controller = createAppController({
      store,
      persist,
      guided: {
        load: () => ({ version: 1, status: 'not-started', currentStepId: null, completedStepIds: [], completedAt: null }),
        start: (w, o) => o.state,
        resume: (w, o) => o.state,
        pause: (w, o) => o.state,
        advance: (w, o) => o.state,
        restart: () => ({ version: 1, status: 'not-started', currentStepId: null, completedStepIds: [], completedAt: null }),
      },
      primaryWorkflow: [],
      createExampleStudy: emptyExperiment,
      createEmptyStudy: emptyExperiment,
      isPersisted: false,
      isSandbox: false,
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
      now: () => 'FIXED_TIMESTAMP',
      logger: { error: () => {}, warn: () => {} },
    });

    const entries = controller.recoveryEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Root architecture under drought');
  } finally {
    dom.restore();
  }
});
