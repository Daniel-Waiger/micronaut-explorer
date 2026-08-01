// App shell: header, an always-visible assay switcher, left step nav, main
// content mount, theme toggle, and a toast/status area. Vanilla DOM only --
// every node is built with createElement/textContent, never innerHTML with
// dynamic or user data.

import { removeAssay, seedAssayFromVocabulary } from '../core/assay.js';
import { shortId } from '../core/ids.js';
import { MAX_STUDY_ROWS } from '../engine/plan.js';

const THEME_KEY = 'micronaut.theme';

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage is a convenience; a failed write here only means the
    // toggle won't persist across reloads, which isn't worth surfacing.
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function osPrefersLight() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function renderShell(root, store, router, { onReset } = {}) {
  root.textContent = '';

  const header = document.createElement('header');
  header.className = 'shell-header';

  const title = document.createElement('div');
  title.className = 'shell-title';
  title.textContent = 'Micronaut Planner';
  header.appendChild(title);

  const themeToggle = document.createElement('button');
  themeToggle.type = 'button';
  themeToggle.className = 'theme-toggle';
  // Only stamp data-theme when the user has made an EXPLICIT choice before.
  // Stamping it unconditionally (even to 'dark', matching the app's own
  // :root default) would always win over the
  // @media (prefers-color-scheme: light) rule, so a first-time visitor on a
  // light-OS machine would always see dark regardless of their system
  // preference -- the toggle is meant to override the OS default, not
  // replace it before the user has ever touched it.
  const storedTheme = loadTheme();
  if (storedTheme) {
    applyTheme(storedTheme);
  }
  let currentTheme = storedTheme || (osPrefersLight() ? 'light' : 'dark');
  themeToggle.textContent = currentTheme === 'dark' ? 'Light mode' : 'Dark mode';
  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
    saveTheme(currentTheme);
    themeToggle.textContent = currentTheme === 'dark' ? 'Light mode' : 'Dark mode';
  });
  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';

  // Everything is autosaved to localStorage, so a page refresh deliberately
  // RESTORES the previous session rather than clearing it. That is the right
  // default (nobody wants to lose a design to a stray F5) but it leaves no
  // way to start a genuinely new experiment -- hence an explicit control.
  // Confirmed, because it is destructive and unrecoverable.
  if (onReset) {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'theme-toggle reset-button';
    resetBtn.textContent = 'Start over';
    // "the default study," not "an empty one" -- core/defaultStudy.js seeds
    // a fresh session with the oregano study's real research question and
    // 4 assays (weakly tagged, freely overwritable), so a reset no longer
    // lands on a genuinely blank slate.
    resetBtn.title = 'Discard this experiment and start over with the default study';
    resetBtn.addEventListener('click', () => {
      const ok = window.confirm(
        'Discard the current experiment and start over with the default study?\n\nThis clears every answer, factor, and naming field. It cannot be undone.'
      );
      if (ok) onReset();
    });
    headerActions.appendChild(resetBtn);
  }

  headerActions.appendChild(themeToggle);
  header.appendChild(headerActions);

  // The assay switcher: ALWAYS visible, not gated on assays.length > 1 --
  // per the plan doc, it is deliberately the permanent home for "add an
  // assay," not just a control that appears once a second one already
  // exists. Lives here (not inside design.js or any step) because a
  // switcher inside a step would re-enter that step's render() from a
  // click handler whose own `main.textContent = ''` just destroyed the very
  // DOM the handler is running in -- shell.js already survives a step
  // change unscathed (see router.onChange below), so an assay switch is
  // just another nav, using a proven contract instead of a new one.
  const switcherBar = document.createElement('div');
  switcherBar.className = 'assay-switcher-bar';
  switcherBar.setAttribute('role', 'tablist');
  switcherBar.setAttribute('aria-label', 'Assays');

  function renderSwitcher(experiment) {
    switcherBar.textContent = '';
    const assays = Array.isArray(experiment.assays) ? experiment.assays : [];

    assays.forEach((assay, index) => {
      const pill = document.createElement('div');
      pill.className = 'assay-pill' + (assay.id === experiment.activeAssayId ? ' active' : '');

      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'assay-pill-label';
      switchBtn.textContent = assay.label || `Assay ${index + 1}`;
      switchBtn.setAttribute('role', 'tab');
      switchBtn.setAttribute('aria-selected', String(assay.id === experiment.activeAssayId));
      switchBtn.addEventListener('click', () => {
        if (assay.id === store.get().activeAssayId) return;
        // Navigation state, not a fact about the experiment -- store.patch,
        // not the provenance-gated store.setPath every field write uses.
        // main.js's own store.subscribe detects this exact change and
        // re-renders whichever step is currently on screen.
        store.patch({ activeAssayId: assay.id });
      });
      pill.appendChild(switchBtn);

      // Deleting the last assay would break every consumer's
      // `assays.length >= 1` assumption -- removeAssay itself refuses, but
      // hiding the control here means there is nothing to click that could
      // ever surface that refusal as a confusing no-op.
      if (assays.length > 1) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'assay-pill-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = `Delete ${assay.label || `Assay ${index + 1}`}`;
        deleteBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          const ok = window.confirm(
            `Delete "${assay.label || `Assay ${index + 1}`}" and all its design, panel, and naming data?\n\nThis cannot be undone.`
          );
          if (!ok) return;
          const result = removeAssay(store.get(), assay.id);
          if (result) store.patch(result);
        });
        pill.appendChild(deleteBtn);
      }

      switcherBar.appendChild(pill);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'assay-pill-add';
    addBtn.textContent = '+ Add assay';
    const atCap = assays.length >= MAX_STUDY_ROWS;
    addBtn.disabled = atCap;
    addBtn.title = atCap ? `A study cannot have more than ${MAX_STUDY_ROWS} assays.` : 'Add a new assay';
    addBtn.addEventListener('click', () => {
      const experimentNow = store.get();
      const id = shortId();
      const { assay, provenanceSlotKey, provenanceEntry } = seedAssayFromVocabulary(
        experimentNow.armVocabulary,
        id
      );
      // One atomic patch: the new assay, the active pointer, AND its one
      // provenance slot together -- an assay present in `assays` but
      // missing its slot would let the very first user edit to its seeded
      // arms be misjudged as overwriting nothing (see
      // seedAssayFromVocabulary's own docstring).
      store.patch((state) => ({
        assays: [...state.assays, assay],
        activeAssayId: id,
        provenance: {
          ...state.provenance,
          slots: { ...state.provenance.slots, [provenanceSlotKey]: provenanceEntry },
        },
      }));
    });
    switcherBar.appendChild(addBtn);
  }

  // Redraws on ANY store change, mirroring how the step nav below redraws on
  // any router change -- a rename or vocabulary edit made from the Study
  // step (a different module entirely) still needs the switcher's own
  // labels/pill set to stay current, with no extra plumbing between the two.
  store.subscribe((state) => renderSwitcher(state));
  renderSwitcher(store.get());

  const body = document.createElement('div');
  body.className = 'shell-body';

  const nav = document.createElement('nav');
  nav.className = 'shell-nav';
  nav.setAttribute('aria-label', 'Steps');

  const main = document.createElement('main');
  main.className = 'shell-main';

  body.appendChild(nav);
  body.appendChild(main);

  const status = document.createElement('div');
  status.className = 'shell-status';
  status.setAttribute('role', 'status');

  root.appendChild(header);
  root.appendChild(switcherBar);
  root.appendChild(body);
  root.appendChild(status);

  function renderNav(activeId) {
    nav.textContent = '';
    for (const step of router.steps) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-step' + (step.id === activeId ? ' active' : '');
      btn.textContent = step.title || step.id;
      btn.addEventListener('click', () => router.navigate(step.id));
      nav.appendChild(btn);
    }
  }

  router.onChange((activeId) => renderNav(activeId));
  renderNav(router.current());

  let toastTimer = null;
  function showToast(message) {
    status.textContent = message;
    status.classList.add('visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => status.classList.remove('visible'), 3000);
  }

  return { main, showToast };
}
