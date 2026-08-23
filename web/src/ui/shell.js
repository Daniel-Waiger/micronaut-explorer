// Global UI shell. Project persistence and readiness are supplied by main.js;
// this module only renders those contracts and routes user actions back out.

import { removeAssay, seedAssayFromVocabulary } from '../core/assay.js';
import { shortId } from '../core/ids.js';
import { MAX_STUDY_ROWS } from '../engine/plan.js';
import { buildFeedbackReport } from '../core/feedbackReport.js';
import { copyToClipboard } from './clipboard.js';
import { createIcon } from './icons.js';

const THEME_KEY = 'micronaut.theme';
const NAV_COLLAPSED_KEY = 'micronaut.navCollapsed';
const FEEDBACK_ISSUES_URL = 'https://github.com/Daniel-Waiger/micronaut-planner/issues/new';
const GITHUB_ISSUE_BODY_LIMIT = 6000;

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* convenience only */ }
}
function routeForWorkflow(id) { return id === 'microscopy' ? 'panel' : id; }
function workflowForRoute(id) { return id === 'panel' ? 'microscopy' : id; }
function stateLabel(state) {
  return { 'not-started': 'Not started', 'in-progress': 'In progress', 'needs-attention': 'Needs review', complete: 'Complete' }[state] || 'Not started';
}
export function saveLabel(saveState) {
  if (saveState?.status === 'saving') return 'Saving locally…';
  if (saveState?.status === 'failed') return saveState.error || 'Changes are not saved locally.';
  if (saveState?.status === 'unsaved') return 'Not saved locally yet';
  if (!saveState?.savedAt) return 'Saved locally';
  const date = new Date(saveState.savedAt);
  if (Number.isNaN(date.getTime())) return 'Saved locally';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return 'Saved locally · just now';
  if (seconds < 60) return `Saved locally · ${seconds}s ago`;
  return `Saved locally · ${Math.round(seconds / 60)}m ago`;
}

export function renderShell(root, store, router, options = {}) {
  const {
    onReset, onNewBlank, onAdoptExample, onExportProject, onImportProject,
    onRestoreRecovery, onResetOnboarding, kbIssueCount,
  } = options;
  // Missing lifecycle state must degrade conservatively. Only main can know
  // that a recovery slot was actually loaded or a save completed.
  let saveState = options.saveState || { status: 'unsaved' };
  let recoveryEntries = Array.isArray(options.recoveryEntries) ? options.recoveryEntries : [];
  let workflowProgress = options.workflowProgress || { primary: [], assays: [], summary: {} };
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

  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';
  const saveIndicator = document.createElement('div');
  saveIndicator.className = 'shell-save-indicator';
  saveIndicator.setAttribute('role', 'status');
  saveIndicator.setAttribute('aria-live', 'polite');
  function renderSaveState() {
    saveIndicator.classList.toggle('is-failed', saveState?.status === 'failed');
    saveIndicator.classList.toggle('is-saving', saveState?.status === 'saving');
    saveIndicator.classList.toggle('is-unsaved', saveState?.status === 'unsaved');
    saveIndicator.textContent = saveLabel(saveState);
  }
  renderSaveState();
  headerActions.appendChild(saveIndicator);
  if (onNewBlank) {
    const newStudy = document.createElement('button');
    newStudy.type = 'button';
    newStudy.className = 'primary-action shell-new-study';
    newStudy.textContent = 'New study';
    newStudy.title = 'Start a blank study. Previous versions remain available in Restore.';
    newStudy.addEventListener('click', () => {
      if (window.confirm('Start a blank study? Your current work remains available in Restore.')) onNewBlank();
    });
    headerActions.appendChild(newStudy);
  }

  const utilities = document.createElement('div');
  utilities.className = 'shell-utilities';
  const utilityToggle = document.createElement('button');
  utilityToggle.type = 'button';
  utilityToggle.className = 'shell-utility-toggle';
  utilityToggle.textContent = 'Utilities';
  utilityToggle.setAttribute('aria-haspopup', 'menu');
  utilityToggle.setAttribute('aria-expanded', 'false');
  const utilityMenu = document.createElement('div');
  utilityMenu.className = 'shell-utility-menu';
  utilityMenu.setAttribute('role', 'menu');
  utilityMenu.hidden = true;
  function closeMenu(focus = false) {
    utilityMenu.hidden = true;
    utilityToggle.setAttribute('aria-expanded', 'false');
    if (focus) utilityToggle.focus();
  }
  function action(label, callback, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `shell-utility-action ${className}`.trim();
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.addEventListener('click', () => { closeMenu(); callback(); });
    return button;
  }
  utilityToggle.addEventListener('click', () => {
    utilityMenu.hidden = !utilityMenu.hidden;
    utilityToggle.setAttribute('aria-expanded', String(!utilityMenu.hidden));
  });
  utilityToggle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !utilityMenu.hidden) {
      event.preventDefault();
      closeMenu(true);
    }
  });
  utilityMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  });
  document.addEventListener('pointerdown', (event) => { if (!utilities.contains(event.target)) closeMenu(); });

  if (onReset) utilityMenu.appendChild(action('Reset to example study', () => {
    if (window.confirm('Replace this study with the oregano example? Current work remains available in Restore.')) onReset();
  }));
  if (onExportProject) utilityMenu.appendChild(action('Export project backup', onExportProject));
  if (onImportProject) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.className = 'shell-project-import-input';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) await onImportProject(file);
    });
    utilityMenu.append(action('Import project backup', () => input.click()), input);
  }
  const restoreGroup = document.createElement('div');
  restoreGroup.className = 'shell-restore-group';
  const restoreTitle = document.createElement('div');
  restoreTitle.className = 'shell-utility-heading';
  restoreTitle.textContent = 'Restore previous version';
  const restoreList = document.createElement('div');
  restoreList.className = 'shell-restore-list';
  restoreGroup.append(restoreTitle, restoreList);
  utilityMenu.appendChild(restoreGroup);
  function renderRecoveryEntries() {
    restoreList.textContent = '';
    if (!onRestoreRecovery || recoveryEntries.length === 0) {
      const none = document.createElement('p');
      none.className = 'shell-restore-empty';
      none.textContent = 'No saved versions yet.';
      restoreList.appendChild(none);
      return;
    }
    recoveryEntries.forEach((entry, index) => {
      const restore = action(`${index === 0 ? 'Latest: ' : ''}${entry.title || 'Untitled study'}`, () => onRestoreRecovery(entry.id), 'shell-restore-action');
      restore.title = 'Restore this saved version';
      restoreList.appendChild(restore);
    });
  }
  renderRecoveryEntries();
  if (onResetOnboarding) utilityMenu.appendChild(action('Show onboarding again', onResetOnboarding));
  utilityMenu.appendChild(action('Copy feedback report', async () => {
    const report = buildFeedbackReport({ currentStepId: router.current(), kbIssueCount, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined, experiment: store.get() });
    showToast((await copyToClipboard(report)) ? 'Copied a feedback report.' : 'Could not copy automatically.');
  }));
  utilityMenu.appendChild(action('Open GitHub issue', () => {
    const report = buildFeedbackReport({ currentStepId: router.current(), kbIssueCount, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined, experiment: store.get() });
    const body = report.length > GITHUB_ISSUE_BODY_LIMIT
      ? `${report.slice(0, GITHUB_ISSUE_BODY_LIMIT)}\n\n...(truncated — use Copy feedback report for the full study JSON)`
      : report;
    window.open(`${FEEDBACK_ISSUES_URL}?title=${encodeURIComponent('Feedback: ')}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
  }));
  let theme = readPreference(THEME_KEY) || (osPrefersLight() ? 'light' : 'dark');
  if (readPreference(THEME_KEY)) document.documentElement.setAttribute('data-theme', theme);
  const appearance = action('', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    savePreference(THEME_KEY, theme);
    renderAppearance();
  });
  function renderAppearance() { appearance.textContent = theme === 'dark' ? 'Use light appearance' : 'Use dark appearance'; }
  renderAppearance();
  utilityMenu.appendChild(appearance);
  utilities.append(utilityToggle, utilityMenu);
  headerActions.appendChild(utilities);
  header.append(brand, headerActions);

  const workflowStrip = document.createElement('section');
  workflowStrip.className = 'workflow-strip';
  workflowStrip.setAttribute('aria-label', 'Study workflow progress');
  const workflowSummary = document.createElement('span');
  workflowSummary.className = 'workflow-summary';
  const workflowBadges = document.createElement('div');
  workflowBadges.className = 'workflow-badges';
  workflowStrip.append(workflowSummary, workflowBadges);

  const mobileControls = document.createElement('section');
  mobileControls.className = 'shell-mobile-controls';
  mobileControls.setAttribute('aria-label', 'Workflow navigation');
  const assayLabel = document.createElement('label');
  assayLabel.htmlFor = 'mobile-active-assay';
  assayLabel.textContent = 'Assay';
  const assaySelect = document.createElement('select');
  assaySelect.id = 'mobile-active-assay';
  assaySelect.className = 'mobile-assay-select';
  const stepLabel = document.createElement('label');
  stepLabel.htmlFor = 'mobile-workflow-step';
  const stepSelect = document.createElement('select');
  stepSelect.id = 'mobile-workflow-step';
  stepSelect.className = 'mobile-step-select';
  mobileControls.append(assayLabel, assaySelect, stepLabel, stepSelect);

  const switcher = document.createElement('div');
  switcher.className = 'assay-switcher-bar';
  switcher.setAttribute('role', 'tablist');
  switcher.setAttribute('aria-label', 'Assays');
  const switcherLabel = document.createElement('span');
  switcherLabel.className = 'assay-switcher-label';
  switcherLabel.textContent = 'Active assay';

  function primarySteps() {
    return (Array.isArray(workflowProgress.primary) ? workflowProgress.primary : []).map((step) => ({ ...step, routeId: routeForWorkflow(step.id) }));
  }
  function workflowStep(routeId) {
    return primarySteps().find((step) => step.id === workflowForRoute(routeId));
  }
  function assayState(id) {
    return workflowProgress.assays?.find((assay) => assay?.id === id)?.state || 'not-started';
  }
  function renderSwitcher(experiment) {
    switcher.replaceChildren(switcherLabel);
    const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
    assays.forEach((assay, index) => {
      const pill = document.createElement('div');
      const active = assay.id === experiment.activeAssayId;
      pill.className = `assay-pill${active ? ' active' : ''}`;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'assay-pill-label';
      select.setAttribute('role', 'tab');
      select.setAttribute('aria-selected', String(active));
      select.textContent = assay.label || `Assay ${index + 1}`;
      select.addEventListener('click', () => { if (assay.id !== store.get().activeAssayId) store.patch({ activeAssayId: assay.id }); });
      const badge = document.createElement('span');
      badge.className = `assay-progress-badge is-${assayState(assay.id)}`;
      badge.textContent = stateLabel(assayState(assay.id));
      pill.append(select, badge);
      if (assays.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'assay-pill-delete';
        remove.appendChild(createIcon('close', 'button-icon'));
        remove.setAttribute('aria-label', `Delete ${assay.label || `Assay ${index + 1}`}`);
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          if (!window.confirm(`Delete "${assay.label || `Assay ${index + 1}`}"?`)) return;
          const next = removeAssay(store.get(), assay.id);
          if (next) store.patch(next);
        });
        pill.appendChild(remove);
      }
      switcher.appendChild(pill);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'assay-pill-add';
    add.textContent = '+ Add assay';
    add.disabled = assays.length >= MAX_STUDY_ROWS;
    add.addEventListener('click', () => {
      const current = store.get();
      const id = shortId();
      const { assay, provenanceSlotKey, provenanceEntry } = seedAssayFromVocabulary(current.groupVocabulary, id);
      store.patch((state) => ({ assays: [...state.assays, assay], activeAssayId: id, provenance: { ...state.provenance, slots: { ...state.provenance.slots, [provenanceSlotKey]: provenanceEntry } } }));
    });
    switcher.appendChild(add);
  }

  const body = document.createElement('div');
  body.className = 'shell-body';
  let navCollapsed = readPreference(NAV_COLLAPSED_KEY) === '1';
  if (navCollapsed) body.classList.add('shell-nav-collapsed');
  const nav = document.createElement('nav');
  nav.className = 'shell-nav';
  nav.setAttribute('aria-label', 'Steps');
  const sticky = document.createElement('div');
  sticky.className = 'nav-sticky';
  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'nav-toggle';
  function renderNavToggle() {
    navToggle.textContent = navCollapsed ? '»' : '«';
    navToggle.setAttribute('aria-label', navCollapsed ? 'Expand step navigation' : 'Collapse step navigation');
    navToggle.setAttribute('aria-expanded', String(!navCollapsed));
  }
  navToggle.addEventListener('click', () => { navCollapsed = !navCollapsed; savePreference(NAV_COLLAPSED_KEY, navCollapsed ? '1' : '0'); body.classList.toggle('shell-nav-collapsed', navCollapsed); renderNavToggle(); });
  renderNavToggle();
  const navSteps = document.createElement('div');
  navSteps.className = 'nav-steps';
  sticky.append(navToggle, navSteps);
  nav.appendChild(sticky);
  const main = document.createElement('main');
  main.className = 'shell-main';
  // One stable, non-modal host for both guided progress and explanation-only
  // content. Main/controller code owns what appears here; the shell only owns
  // its semantic placement and visibility.
  const guidedAsideHost = document.createElement('aside');
  guidedAsideHost.id = 'guided-context-panel';
  guidedAsideHost.className = 'guided-aside-host';
  guidedAsideHost.setAttribute('aria-label', 'Contextual workflow explanation');
  guidedAsideHost.hidden = true;
  body.append(nav, main, guidedAsideHost);

  const footer = document.createElement('footer');
  footer.className = 'workflow-footer';
  footer.setAttribute('aria-label', 'Workflow navigation');
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'workflow-back'; back.textContent = 'Back';
  const position = document.createElement('span'); position.className = 'workflow-position';
  const explain = document.createElement('button');
  explain.type = 'button';
  explain.className = 'workflow-explain';
  explain.textContent = 'Explain this step';
  explain.setAttribute('aria-controls', guidedAsideHost.id);
  const next = document.createElement('button');
  next.type = 'button'; next.className = 'workflow-continue'; next.textContent = 'Continue';
  footer.append(back, position, explain, next);
  const status = document.createElement('div');
  status.className = 'shell-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(header, workflowStrip, mobileControls, switcher, body, footer, status);

  function renderWorkflowStrip() {
    const steps = primarySteps();
    const complete = Number.isInteger(workflowProgress.summary?.complete) ? workflowProgress.summary.complete : steps.filter((step) => step.state === 'complete').length;
    workflowSummary.textContent = `Workflow: ${complete} of ${steps.length || 7} complete`;
    workflowBadges.textContent = '';
    steps.forEach((step) => {
      const badge = document.createElement('span');
      badge.className = `workflow-badge is-${step.state || 'not-started'}`;
      badge.textContent = `${step.label}: ${stateLabel(step.state)}`;
      workflowBadges.appendChild(badge);
    });
  }
  function renderNav(activeId) {
    navSteps.textContent = '';
    router.steps.forEach((step) => {
      const current = workflowStep(step.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `nav-step${step.id === activeId ? ' active' : ''}${current ? ` workflow-state-${current.state}` : ''}`;
      button.dataset.stepId = step.id;
      const label = step.title || step.id;
      const accessibleLabel = current ? `${label} — ${stateLabel(current.state)}` : label;
      button.setAttribute('aria-label', accessibleLabel);
      // Native hover text cannot be clipped by the narrow collapsed rail.
      // It also leaves the expanded badge as the visible status authority.
      if (current) button.title = accessibleLabel;
      button.appendChild(createIcon(step.id === 'panel' ? 'microscope' : step.id, 'nav-step-icon'));
      const copy = document.createElement('span'); copy.className = 'nav-step-label'; copy.textContent = label;
      button.appendChild(copy);
      if (current) {
        const badge = document.createElement('span');
        badge.className = `nav-step-badge is-${current.state}`;
        badge.textContent = stateLabel(current.state);
        button.appendChild(badge);
      }
      button.addEventListener('click', () => router.navigate(step.id));
      navSteps.appendChild(button);
    });
  }
  function renderMobileControls(activeId = router.current()) {
    const experiment = store.get();
    assaySelect.textContent = '';
    (Array.isArray(experiment.assays) ? experiment.assays : []).forEach((assay, index) => {
      const option = document.createElement('option'); option.value = assay.id; option.textContent = assay.label || `Assay ${index + 1}`; option.selected = assay.id === experiment.activeAssayId; assaySelect.appendChild(option);
    });
    const steps = primarySteps();
    stepSelect.textContent = '';
    steps.forEach((step, index) => {
      const option = document.createElement('option'); option.value = step.routeId; option.textContent = `Step ${index + 1} of ${steps.length}: ${step.label}`; option.selected = step.routeId === activeId; stepSelect.appendChild(option);
    });
    const current = steps.findIndex((step) => step.routeId === activeId);
    stepLabel.textContent = `Step ${Math.max(1, current + 1)} of ${steps.length || 7}`;
  }
  assaySelect.addEventListener('change', () => { if (assaySelect.value && assaySelect.value !== store.get().activeAssayId) store.patch({ activeAssayId: assaySelect.value }); });
  stepSelect.addEventListener('change', () => router.navigate(stepSelect.value));
  let explainStepHandler = null;
  function renderFooter(activeId = router.current()) {
    const steps = primarySteps();
    const index = steps.findIndex((step) => step.routeId === activeId);
    const currentStep = workflowStep(activeId);
    position.textContent = index === -1 ? 'Guide (optional)' : `Step ${index + 1} of ${steps.length}`;
    back.disabled = index <= 0;
    next.disabled = index === -1 || index >= steps.length - 1;
    explain.disabled = !currentStep || typeof explainStepHandler !== 'function';
    back.onclick = () => { if (index > 0) router.navigate(steps[index - 1].routeId); };
    next.onclick = () => { if (index !== -1 && index < steps.length - 1) router.navigate(steps[index + 1].routeId); };
    // currentStep.id is the canonical workflow id: workflowStep() applies
    // the existing panel -> microscopy alias in one shared place.
    explain.onclick = () => {
      if (currentStep && typeof explainStepHandler === 'function') explainStepHandler(currentStep.id);
    };
  }
  router.onChange((id) => { renderNav(id); renderMobileControls(id); renderFooter(id); });
  store.subscribe((state) => { renderSwitcher(state); renderMobileControls(router.current()); });
  renderSwitcher(store.get());
  renderWorkflowStrip();
  renderNav(router.current());
  renderMobileControls(router.current());
  renderFooter(router.current());

  let toastTimer = null;
  function showToast(message) {
    status.textContent = message;
    status.classList.add('visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => status.classList.remove('visible'), 3000);
  }
  return {
    main,
    showToast,
    setSaveState(nextState) { saveState = nextState || saveState; renderSaveState(); },
    setRecoveryEntries(entries) { recoveryEntries = Array.isArray(entries) ? entries : []; renderRecoveryEntries(); },
    setWorkflowProgress(progress) {
      workflowProgress = progress || { primary: [], assays: [], summary: {} };
      renderWorkflowStrip(); renderSwitcher(store.get()); renderNav(router.current()); renderMobileControls(router.current()); renderFooter(router.current());
    },
    guidedAsideHost,
    setExplainStepHandler(handler) {
      explainStepHandler = typeof handler === 'function' ? handler : null;
      renderFooter(router.current());
    },
    setGuidedAsideVisible(visible) {
      const isVisible = Boolean(visible);
      guidedAsideHost.hidden = !isVisible;
      body.classList.toggle('has-guided-aside', isVisible);
    },
  };
}

function osPrefersLight() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}
