import { emptyExperiment } from './core/schema.js';
import { createStore } from './core/store.js';
import { createRouter } from './core/router.js';
import { renderShell } from './ui/shell.js';
import { listSaved, loadExperiment, saveExperiment } from './core/persist.js';
import { namingStep } from './ui/steps/naming.js';

function loadInitialExperiment() {
  const saved = listSaved();
  if (saved.length > 0) {
    const experiment = loadExperiment(saved[0]);
    if (experiment) return experiment;
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
  const { main } = renderShell(root, store, router);

  function renderActiveStep(id) {
    const step = steps.find((s) => s.id === id) || steps[0];
    step.render(main, store);
  }

  router.onChange(renderActiveStep);
  renderActiveStep(router.current());

  store.subscribe(() => {
    saveExperiment(store.get());
  });
}

init();
