// App shell: header, an always-visible assay switcher, left step nav, main
// content mount, theme toggle, and a toast/status area. Vanilla DOM only --
// every node is built with createElement/textContent, never innerHTML with
// dynamic or user data.

import { removeAssay, seedAssayFromVocabulary } from '../core/assay.js';
import { shortId } from '../core/ids.js';
import { MAX_STUDY_ROWS } from '../engine/plan.js';
import { buildFeedbackReport } from '../core/feedbackReport.js';
import { copyToClipboard } from './clipboard.js';
import { createIcon } from './icons.js';

const THEME_KEY = 'micronaut.theme';
const NAV_COLLAPSED_KEY = 'micronaut.navCollapsed';

function loadNavCollapsed() {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveNavCollapsed(collapsed) {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Convenience only, same posture as theme persistence below.
  }
}

// Alpha-pilot feedback destinations (Wave 1 of alpha-pilot-readiness).
// Both are placeholders -- Daniel fills them in once the form/alias exist;
// until then the links simply don't render (a broken link is worse than no
// link). The "Copy feedback report" button below works either way, since it
// only builds text -- it doesn't depend on either destination existing.
//
// FEEDBACK_FORM_URL: a Google Form (or similar) -- no account needed from a
// tester, lands in a Sheet.
// FEEDBACK_EMAIL: a non-personal address (a DuckDuckGo Email Protection
// alias, or a dedicated project inbox) -- NOT a GitHub noreply address,
// which silently discards mail sent to it.
const FEEDBACK_FORM_URL = '';
const FEEDBACK_EMAIL = '';
const FEEDBACK_ISSUES_URL = 'https://github.com/Daniel-Waiger/micronaut-planner/issues/new';
// See the "GitHub issue" button below for why this exists.
const GITHUB_ISSUE_BODY_LIMIT = 6000;

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

export function renderShell(root, store, router, { onReset, onNewBlank, kbIssueCount } = {}) {
  root.textContent = '';

  const header = document.createElement('header');
  header.className = 'shell-header';

  const brand = document.createElement('div');
  brand.className = 'shell-brand';
  brand.appendChild(createIcon('microscope', 'brand-mark'));
  const brandCopy = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'shell-title';
  title.textContent = 'Micronaut Planner';
  const subtitle = document.createElement('div');
  subtitle.className = 'shell-subtitle';
  subtitle.textContent = 'Experiment design workspace';
  brandCopy.append(title, subtitle);
  brand.appendChild(brandCopy);
  header.appendChild(brand);

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
  // way to start a genuinely new experiment -- hence explicit controls.
  // TWO distinct actions, because a first-time user lands on the seeded
  // oregano EXAMPLE study and needs an unambiguous way to plan their own:
  //   "New study"        -> a genuinely blank experiment they fill in
  //   "Reset to example" -> reload the oregano example (undo their edits)
  // Both are confirmed: they are destructive and unrecoverable.
  if (onNewBlank) {
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'theme-toggle reset-button primary-action';
    newBtn.textContent = 'New study';
    newBtn.title = 'Start a blank study of your own (clears the current one)';
    newBtn.addEventListener('click', () => {
      const ok = window.confirm(
        'Start a new, blank study of your own?\n\nThis clears the current experiment (including the example study) and starts from an empty slate. It cannot be undone.'
      );
      if (ok) onNewBlank();
    });
    headerActions.appendChild(newBtn);
  }

  if (onReset) {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'theme-toggle reset-button';
    resetBtn.textContent = 'Reset to example';
    // "the example study," not "an empty one" -- core/defaultStudy.js seeds
    // a fresh session with the oregano study's real research question and
    // 4 assays (weakly tagged, freely overwritable). "New study" above is
    // the blank-slate path; this one restores the example.
    resetBtn.title = 'Discard this experiment and reload the example (oregano) study';
    resetBtn.addEventListener('click', () => {
      const ok = window.confirm(
        'Discard the current experiment and reload the example (oregano) study?\n\nThis clears every answer, factor, and naming field. It cannot be undone.'
      );
      if (ok) onReset();
    });
    headerActions.appendChild(resetBtn);
  }

  // Feedback (Wave 1, alpha-pilot-readiness): the button always works --
  // it only builds and copies text, no destination required. The two links
  // are conditional on Daniel having filled in the corresponding constant
  // above; a link to nowhere is worse than no link.
  const feedbackBtn = document.createElement('button');
  feedbackBtn.type = 'button';
  feedbackBtn.className = 'theme-toggle';
  feedbackBtn.textContent = 'Copy feedback report';
  feedbackBtn.title =
    'Copies the current step, browser, knowledge-pack status, and your full study as text -- paste it into the feedback form or email.';
  feedbackBtn.addEventListener('click', async () => {
    const report = buildFeedbackReport({
      currentStepId: router.current(),
      kbIssueCount,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      experiment: store.get(),
    });
    const ok = await copyToClipboard(report);
    showToast(ok ? 'Copied a feedback report -- paste it into the form or an email.' : 'Could not copy automatically -- select and copy the report text yourself.');
  });
  headerActions.appendChild(feedbackBtn);

  if (FEEDBACK_FORM_URL) {
    const formLink = document.createElement('a');
    formLink.className = 'theme-toggle';
    formLink.href = FEEDBACK_FORM_URL;
    formLink.target = '_blank';
    formLink.rel = 'noopener noreferrer';
    formLink.textContent = 'Report an issue';
    headerActions.appendChild(formLink);
  }

  if (FEEDBACK_EMAIL) {
    const mailLink = document.createElement('a');
    mailLink.className = 'theme-toggle';
    mailLink.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Micronaut Planner feedback')}`;
    mailLink.textContent = 'Email feedback';
    headerActions.appendChild(mailLink);
  }

  // GitHub issue (zen-planner Phase 5's "easy feedback loop"): a BUTTON, not
  // a plain link -- it builds the SAME report buildFeedbackReport produces
  // for "Copy feedback report" above, one implementation, and opens GitHub's
  // own issue-creation URL with title/body query params prefilled. GitHub
  // Issues is already wired up and needs no new external service (unlike
  // FEEDBACK_FORM_URL/FEEDBACK_EMAIL above, which are still unset
  // placeholders) -- this is the "one click" feedback path that works today.
  const issuesBtn = document.createElement('button');
  issuesBtn.type = 'button';
  issuesBtn.className = 'theme-toggle';
  issuesBtn.textContent = 'GitHub issue';
  issuesBtn.title =
    'Opens a prefilled GitHub issue with the same report "Copy feedback report" copies -- review and edit before submitting; nothing is sent automatically.';
  issuesBtn.addEventListener('click', () => {
    const report = buildFeedbackReport({
      currentStepId: router.current(),
      kbIssueCount,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      experiment: store.get(),
    });
    // GitHub does not publish an exact URL-length limit, but browsers and
    // proxies commonly cap a URL well under 8KB -- a large study's JSON
    // dump can exceed that easily. Truncate with an honest note rather than
    // silently produce a URL that fails to open or arrives cut off with no
    // explanation.
    const body =
      report.length > GITHUB_ISSUE_BODY_LIMIT
        ? `${report.slice(0, GITHUB_ISSUE_BODY_LIMIT)}\n\n...(truncated -- use "Copy feedback report" for the full study JSON, then paste it here)`
        : report;
    const url = `${FEEDBACK_ISSUES_URL}?title=${encodeURIComponent('Feedback: ')}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener');
  });
  headerActions.appendChild(issuesBtn);

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

  const switcherLabel = document.createElement('span');
  switcherLabel.className = 'assay-switcher-label';
  switcherLabel.textContent = 'Active assay';
  switcherBar.appendChild(switcherLabel);

  function renderSwitcher(experiment) {
    switcherBar.replaceChildren(switcherLabel);
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
        deleteBtn.appendChild(createIcon('close', 'button-icon'));
        deleteBtn.title = `Delete ${assay.label || `Assay ${index + 1}`}`;
        deleteBtn.setAttribute('aria-label', `Delete ${assay.label || `Assay ${index + 1}`}`);
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

  // Starts from the last persisted choice so a reload doesn't flash
  // expanded-then-collapse (or vice versa) for a returning user -- same
  // load-before-first-paint posture as the theme toggle above.
  let navCollapsed = loadNavCollapsed();
  if (navCollapsed) body.classList.add('shell-nav-collapsed');

  const nav = document.createElement('nav');
  nav.className = 'shell-nav';
  nav.setAttribute('aria-label', 'Steps');

  // .shell-nav itself stays a plain, full-height grid item (its background/
  // border span the whole page, top to bottom, matching every other column
  // on the page) -- only THIS inner wrapper sticks to the viewport top as
  // the page scrolls, so the buttons stay reachable without the nav
  // shrinking down to just their height (which read as "very small" against
  // the rest of the left column going blank below it).
  const navSticky = document.createElement('div');
  navSticky.className = 'nav-sticky';
  nav.appendChild(navSticky);

  // A toggle button, not the whole nav's textContent rebuilt on every
  // collapse -- renderNav (below) only ever touches navSteps, so the toggle
  // survives every step-navigation re-render untouched.
  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'nav-toggle';
  function updateNavToggle() {
    navToggle.textContent = navCollapsed ? '»' : '«';
    const label = navCollapsed ? 'Expand step navigation' : 'Collapse step navigation';
    navToggle.title = label;
    navToggle.setAttribute('aria-label', label);
    navToggle.setAttribute('aria-expanded', String(!navCollapsed));
  }
  navToggle.addEventListener('click', () => {
    navCollapsed = !navCollapsed;
    saveNavCollapsed(navCollapsed);
    body.classList.toggle('shell-nav-collapsed', navCollapsed);
    updateNavToggle();
  });
  updateNavToggle();
  navSticky.appendChild(navToggle);

  const navSteps = document.createElement('div');
  navSteps.className = 'nav-steps';
  navSticky.appendChild(navSteps);

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
    navSteps.textContent = '';
    for (const step of router.steps) {
      const label = step.title || step.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-step' + (step.id === activeId ? ' active' : '');
      btn.title = label;
      // Stable hook for ui/walkthrough.js (zen-planner Phase 5) to find and
      // spotlight this button -- text-matching a nav label is fragile (it
      // breaks the moment a step is retitled, which has already happened
      // twice in this app's history), a dedicated data attribute is not.
      btn.dataset.stepId = step.id;
      // Always the real step name, independent of collapsed state -- the
      // icon span below is aria-hidden, so this is the button's ONLY
      // accessible name when collapsed hides the visible label text.
      btn.setAttribute('aria-label', label);

      btn.appendChild(createIcon(step.id === 'panel' ? 'microscope' : step.id, 'nav-step-icon'));

      const labelSpan = document.createElement('span');
      labelSpan.className = 'nav-step-label';
      labelSpan.textContent = label;
      btn.appendChild(labelSpan);

      btn.addEventListener('click', () => router.navigate(step.id));
      navSteps.appendChild(btn);
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
