import { emptyExperiment, migrate } from './core/schema.js';
import { createStore } from './core/store.js';
import { createRouter } from './core/router.js';
import { renderShell } from './ui/shell.js';
import { listSaved, loadExperiment, saveExperiment } from './core/persist.js';
import { namingStep } from './ui/steps/naming.js';

const AUTOSAVE_DEBOUNCE_MS = 500;

function loadInitialExperiment() {
  const saved = listSaved();
  if (saved.length > 0) {
    const raw = loadExperiment(saved[0]);
    if (raw) {
      try {
        // Runs the C0-1 schema-version guard on the actual load path, not
        // just in its own unit tests -- otherwise a future schema bump
        // would be silently misread as the current version instead of
        // raising the clear error migrate() exists to give.
        return migrate(raw);
      } catch (err) {
        console.error('Discarding an unreadable autosave, starting fresh:', err);
      }
    }
  }
  return emptyExperiment();
}

// Bootstrap, not top-level await -- the single-file inliner forbids
// top-level await since the released artifact is one classic (non-module,
// non-async) IIFE.
function init() {
  const initialExperiment = loadInitialExperiment();
  const store = createStore(initialExperiment);

  const steps = [namingStep];
  const router = createRouter(steps);

  const root = document.getElementById('app');
  const { main, showToast } = renderShell(root, store, router);

  function renderActiveStep(id) {
    const step = steps.find((s) => s.id === id) || steps[0];
    step.render(main, store);
  }

  router.onChange(renderActiveStep);
  renderActiveStep(router.current());

  // Debounced: saving on every keystroke would fill the 5-slot ring buffer
  // with near-duplicate snapshots of the last few characters typed, rather
  // than the last 5 genuinely distinct states the ring buffer exists to
  // preserve as history.
  let saveTimer = null;
  store.subscribe(() => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveExperiment(store.get(), {
        onQuotaExceeded: () => {
          showToast('Storage is full -- changes are not being saved automatically. Export to a file.');
        },
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  });
}

init();
