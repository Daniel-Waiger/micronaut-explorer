// Global UI shell. Project persistence and readiness are supplied by main.js;
// this module only renders those contracts and routes user actions back out.

import { groupSeedLevels, removeAssay, seedAssayGroups } from '../core/assay.js';
import { shortId } from '../core/ids.js';
import { MAX_STUDY_ROWS } from '../engine/plan.js';
import { buildFeedbackReport } from '../core/feedbackReport.js';
import { handoffFeedback } from './feedbackHandoff.js';
import { createIcon } from './icons.js';

const THEME_KEY = 'micronaut.theme';
const NAV_COLLAPSED_KEY = 'micronaut.navCollapsed';

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* convenience only */ }
}
function routeForWorkflow(id) { return id === 'microscopy' ? 'panel' : id; }
function workflowForRoute(id) { return id === 'panel' ? 'microscopy' : id; }
function stateLabel(state) {
  return {
    'not-started': 'Not started',
    'in-progress': 'In progress',
    'needs-attention': 'Decision needed',
    complete: 'Ready for now',
  }[state] || 'Not started';
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
    onRestoreRecovery, kbIssueCount,
  } = options;
  // Missing lifecycle state must degrade conservatively. Only main can know
  // that a recovery slot was actually loaded or a save completed.
  let saveState = options.saveState || { status: 'unsaved' };
  let recoveryEntries = Array.isArray(options.recoveryEntries) ? options.recoveryEntries : [];
  let workflowProgress = options.workflowProgress || { primary: [], assays: [], summary: {} };
  let themeNavButton = null;
  let featureWalkthroughHandler = null;
  root.textContent = '';

  const header = document.createElement('header');
  header.className = 'shell-header';
  const brand = document.createElement('button');
  brand.type = 'button';
  brand.className = 'shell-brand';
  brand.title = 'Go to Home';
  brand.setAttribute('aria-label', 'Go to Home');
  brand.addEventListener('click', () => router.navigate('home'));
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
    newStudy.className = 'shell-new-study';
    newStudy.append(createIcon('add', 'button-icon'), document.createTextNode('New study'));
    newStudy.title = 'Start a blank study. Previous versions remain available in Restore.';
    newStudy.addEventListener('click', () => {
      if (window.confirm('Start a blank study? Your current work remains available in Restore.')) onNewBlank();
    });
    headerActions.appendChild(newStudy);
  }

  const featureWalkthrough = document.createElement('button');
  featureWalkthrough.type = 'button';
  featureWalkthrough.className = 'shell-feature-walkthrough';
  featureWalkthrough.append(createIcon('walkthrough', 'button-icon'), document.createTextNode('Walkthrough'));
  featureWalkthrough.title = 'Take a focused tour of the app’s feature areas.';
  featureWalkthrough.setAttribute('aria-label', 'Start feature walkthrough');
  featureWalkthrough.disabled = true;
  featureWalkthrough.addEventListener('click', () => featureWalkthroughHandler?.(featureWalkthrough));
  headerActions.appendChild(featureWalkthrough);

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
  function action(label, callback, className = '', role = 'menuitem') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `shell-utility-action ${className}`.trim();
    button.setAttribute('role', role);
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
      const restore = action(`${index === 0 ? 'Latest: ' : ''}${entry.title || 'Untitled study'}`, () => {
        if (window.confirm('Restore this saved version? Your current work remains available in Restore.')) {
          onRestoreRecovery(entry.id);
        }
      }, 'shell-restore-action');
      restore.title = 'Restore this saved version';
      restoreList.appendChild(restore);
    });
  }
  renderRecoveryEntries();
  utilityMenu.appendChild(action('Copy feedback report', () => {
    const report = buildFeedbackReport({ currentStepId: router.current(), kbIssueCount, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined, experiment: store.get() });
    handoffFeedback({ report, channel: 'copy' });
  }));
  utilityMenu.appendChild(action('Open GitHub issue', () => {
    const report = buildFeedbackReport({ currentStepId: router.current(), kbIssueCount, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined, experiment: store.get() });
    handoffFeedback({ report, channel: 'github' });
  }));
  // A persisted theme is an explicit preference. With System selected, do
  // not set a data-theme attribute so the stylesheet's media query can track
  // the operating system as it changes.
  const storedTheme = readPreference(THEME_KEY);
  let theme = ['dark', 'light', 'system'].includes(storedTheme) ? storedTheme : 'system';
  const themeGroup = document.createElement('div');
  themeGroup.className = 'shell-theme-group';
  const themeTitle = document.createElement('div');
  themeTitle.className = 'shell-utility-heading';
  themeTitle.textContent = 'Color mode';
  themeGroup.appendChild(themeTitle);
  const themeActions = new Map();
  function applyTheme() {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    savePreference(THEME_KEY, theme);
    themeActions.forEach((button, mode) => {
      const selected = mode === theme;
      button.setAttribute('aria-checked', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    if (themeNavButton) {
      // This is an action, not a readout: it names the appearance a click
      // will apply. System follows the current OS appearance until a user
      // makes that first explicit light/dark choice.
      const effectiveTheme = theme === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      const nextTheme = effectiveTheme === 'dark' ? 'light' : 'dark';
      const label = `${nextTheme[0].toUpperCase()}${nextTheme.slice(1)}`;
      const bulbState = nextTheme === 'light' ? 'on' : 'off';
      const bulb = createIcon(bulbState === 'on' ? 'lightbulb-on' : 'lightbulb', 'nav-theme-icon');
      const copy = document.createElement('span');
      copy.className = 'nav-theme-label';
      copy.textContent = `Theme · ${label}`;
      themeNavButton.replaceChildren(bulb, copy);
      themeNavButton.dataset.themeMode = nextTheme;
      themeNavButton.dataset.bulbState = bulbState;
      themeNavButton.setAttribute('aria-label', `Switch to ${label} theme.`);
      themeNavButton.title = `Light bulb ${bulbState}. Switch to ${label} theme.`;
    }
  }
  ['dark', 'light', 'system'].forEach((mode) => {
    const label = mode === 'system' ? 'System' : `${mode[0].toUpperCase()}${mode.slice(1)} mode`;
    const modeAction = action(label, () => {
      theme = mode;
      applyTheme();
    }, 'shell-theme-action', 'menuitemradio');
    modeAction.setAttribute('aria-checked', 'false');
    themeActions.set(mode, modeAction);
    themeGroup.appendChild(modeAction);
  });
  applyTheme();
  utilityMenu.appendChild(themeGroup);
  utilities.append(utilityToggle, utilityMenu);
  headerActions.appendChild(utilities);
  header.append(brand, headerActions);

  const workflowStrip = document.createElement('section');
  workflowStrip.className = 'workflow-strip experiment-compass';
  workflowStrip.setAttribute('aria-label', 'Study map compass');
  const workflowSummary = document.createElement('span');
  // Keep the compass title independent of the legacy workflow-summary rule,
  // which deliberately disappears at tablet widths. ORI-17 will own the
  // settled visual treatment for this new compass selector.
  workflowSummary.className = 'experiment-compass-title';
  const compassDetails = document.createElement('div');
  compassDetails.className = 'experiment-compass-details';
  const compassScope = document.createElement('span');
  compassScope.className = 'experiment-compass-scope';
  const compassNext = document.createElement('div');
  compassNext.className = 'experiment-compass-next';
  const workflowBadges = document.createElement('div');
  workflowBadges.className = 'workflow-badges';
  workflowStrip.append(workflowSummary, compassDetails, compassScope, compassNext, workflowBadges);

  const mobileControls = document.createElement('section');
  mobileControls.className = 'shell-mobile-controls';
  mobileControls.setAttribute('aria-label', 'Workflow navigation');
  const mobileCompass = document.createElement('div');
  mobileCompass.className = 'shell-mobile-compass';
  // This is deliberately kept in the existing mobile navigation surface so
  // title and scope survive the desktop compass being collapsed at narrow
  // widths. ORI-17 owns its final responsive styling.
  mobileCompass.style.gridColumn = '1 / -1';
  const mobileCompassTitle = document.createElement('span');
  mobileCompassTitle.className = 'shell-mobile-compass-title';
  const mobileCompassScope = document.createElement('span');
  mobileCompassScope.className = 'shell-mobile-compass-scope';
  mobileCompass.append(mobileCompassTitle, mobileCompassScope);
  const assayLabel = document.createElement('label');
  assayLabel.htmlFor = 'mobile-active-assay';
  assayLabel.textContent = 'Measurement';
  const assaySelect = document.createElement('select');
  assaySelect.id = 'mobile-active-assay';
  assaySelect.className = 'mobile-assay-select';
  const stepLabel = document.createElement('label');
  stepLabel.htmlFor = 'mobile-workflow-step';
  const stepSelect = document.createElement('select');
  stepSelect.id = 'mobile-workflow-step';
  stepSelect.className = 'mobile-step-select';
  mobileControls.append(mobileCompass, assayLabel, assaySelect, stepLabel, stepSelect);

  const switcher = document.createElement('div');
  switcher.className = 'assay-switcher-bar';
  switcher.setAttribute('role', 'tablist');
  switcher.setAttribute('aria-label', 'Measurements');
  const switcherLabel = document.createElement('span');
  switcherLabel.className = 'assay-switcher-label';
  switcherLabel.textContent = 'Active measurement';

  function primarySteps() {
    return (Array.isArray(workflowProgress.primary) ? workflowProgress.primary : []).map((step) => ({ ...step, routeId: routeForWorkflow(step.id) }));
  }
  function workflowStep(routeId) {
    return primarySteps().find((step) => step.id === workflowForRoute(routeId));
  }
  function assayState(id) {
    return workflowProgress.assays?.find((assay) => assay?.id === id)?.state || 'not-started';
  }
  function compassText(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }
  function compassDisplayText(value, limit = 96) {
    return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : value;
  }
  function comparisonSummary(map) {
    const comparison = map && typeof map.comparison === 'object' ? map.comparison : {};
    const groups = Array.isArray(comparison.groups)
      ? comparison.groups.filter((group) => typeof group === 'string' && group.trim()).map((group) => group.trim())
      : [];
    if (comparison.mode === 'observational') return 'Observational study';
    if (comparison.mode === 'groups') return groups.length > 0 ? groups.join(' vs ') : 'Groups not decided';
    return 'Not decided';
  }
  function measurementScope(experiment, map, routeId) {
    // Research brief accepts measurement-scoped details, and the measurement
    // page is entirely one measurement. Everything else is whole-study. The
    // shell only names the scope; each step still owns its data binding.
    if (!['describe', 'measurement'].includes(routeId)) return 'Whole study';
    const measurements = Array.isArray(map?.measurements) ? map.measurements : [];
    const active = measurements.find((measurement) => measurement?.id === experiment.activeAssayId);
    return `Measurement: ${compassText(active?.label, 'Not selected')}`;
  }
  function nextDecisionDestination(nextDecision, experiment) {
    if (!nextDecision || typeof nextDecision !== 'object' || typeof nextDecision.routeId !== 'string') return null;
    const routeId = routeForWorkflow(nextDecision.routeId);
    if (!router.steps.some((step) => step.id === routeId)) return null;
    const measurementId = typeof nextDecision.measurementId === 'string' ? nextDecision.measurementId : '';
    if (measurementId && !(Array.isArray(experiment.assays) && experiment.assays.some((assay) => assay?.id === measurementId))) return null;
    return { routeId, measurementId };
  }
  function renderCompass(activeId = router.current()) {
    const experiment = store.get();
    const map = workflowProgress.map && typeof workflowProgress.map === 'object' ? workflowProgress.map : {};
    const measurements = Array.isArray(map.measurements) ? map.measurements : [];
    const titleText = compassText(experiment.meta?.title, compassText(map.question?.value, 'Untitled study'));
    const questionText = compassText(map.question?.value, 'Not decided');
    const systemText = compassText(map.system?.value, 'Not decided');
    const countText = `${measurements.length} measurement${measurements.length === 1 ? '' : 's'}`;
    const scopeText = measurementScope(experiment, map, activeId);
    const routeLabel = workflowStep(activeId)?.label || (activeId === 'guide' ? 'Guide' : 'Workspace');

    workflowSummary.textContent = compassDisplayText(titleText);
    workflowSummary.title = titleText;
    workflowSummary.setAttribute('aria-label', titleText);
    // On the measurement page the scope already names the measurement, so
    // appending the route label repeated the word three times over
    // ("Measurement: Measurement 1 → Measurement").
    const scopeLine = scopeText === `Measurement: ${routeLabel}` || routeLabel === 'Measurement'
      ? `Now editing: ${scopeText}`
      : `Now editing: ${scopeText} → ${routeLabel}`;
    compassScope.textContent = compassDisplayText(scopeLine);
    compassScope.title = scopeLine;
    compassScope.setAttribute('aria-label', scopeLine);
    mobileCompassTitle.textContent = compassDisplayText(titleText);
    mobileCompassTitle.title = titleText;
    mobileCompassTitle.setAttribute('aria-label', titleText);
    mobileCompassScope.textContent = compassDisplayText(scopeText);
    mobileCompassScope.title = scopeText;
    mobileCompassScope.setAttribute('aria-label', scopeText);

    compassDetails.textContent = '';
    [
      `Question: ${questionText}`,
      `System: ${systemText}`,
      `Comparison: ${comparisonSummary(map)}`,
      countText,
    ].forEach((text) => {
      const detail = document.createElement('span');
      detail.className = 'experiment-compass-detail';
      detail.textContent = compassDisplayText(text);
      detail.title = text;
      detail.setAttribute('aria-label', text);
      compassDetails.appendChild(detail);
    });
    if (experiment.meta?.origin === 'example') {
      const ownership = document.createElement('span');
      ownership.className = 'experiment-compass-example';
      ownership.textContent = 'Example — changes are not your study';
      compassDetails.appendChild(ownership);
    }

    compassNext.textContent = '';
    const nextDecision = map.nextDecision && typeof map.nextDecision === 'object' ? map.nextDecision : null;
    if (!nextDecision) {
      compassNext.textContent = 'No outstanding map decision.';
      return;
    }
    const nextLabel = `Next decision: ${compassText(nextDecision.label, 'Review the study map')}`;
    const destination = nextDecisionDestination(nextDecision, experiment);
    if (!destination) {
      // A stale map must remain inert: never navigate, and especially never
      // select a deleted measurement from an old decision payload.
      compassNext.textContent = nextLabel;
      return;
    }
    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'experiment-compass-next-action';
    nextButton.textContent = nextLabel;
    nextButton.addEventListener('click', () => {
      const current = store.get();
      const currentDestination = nextDecisionDestination(nextDecision, current);
      if (!currentDestination) {
        showToast('That measurement is no longer available.');
        return;
      }
      // Validate against fresh state and select by stable id before the route
      // renders; no decision/context logic is recreated in the shell.
      if (currentDestination.measurementId && current.activeAssayId !== currentDestination.measurementId) {
        store.patch({ activeAssayId: currentDestination.measurementId });
      }
      router.navigate(currentDestination.routeId);
    });
    compassNext.appendChild(nextButton);
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
      select.textContent = assay.label || `Measurement ${index + 1}`;
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
        remove.setAttribute('aria-label', `Delete measurement ${assay.label || `Measurement ${index + 1}`}`);
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          if (!window.confirm(`Delete measurement "${assay.label || `Measurement ${index + 1}`}"?`)) return;
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
    add.textContent = '+ Add measurement';
    add.setAttribute('aria-label', 'Add measurement');
    add.disabled = assays.length >= MAX_STUDY_ROWS;
    add.addEventListener('click', () => {
      const current = store.get();
      const id = shortId();
      const { assay, provenanceSlotKey, provenanceEntry } = seedAssayGroups(groupSeedLevels(current), id);
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
  const navUtilities = document.createElement('div');
  navUtilities.className = 'nav-utilities';
  themeNavButton = document.createElement('button');
  themeNavButton.type = 'button';
  themeNavButton.className = 'nav-theme-toggle';
  themeNavButton.addEventListener('click', () => {
    const effectiveTheme = theme === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    theme = effectiveTheme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });
  applyTheme();
  sticky.append(navToggle, navSteps, navUtilities);
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
    renderCompass();
    workflowBadges.textContent = '';
    steps.forEach((step) => {
      const badge = document.createElement('span');
      badge.className = `workflow-badge is-${step.state || 'not-started'}`;
      badge.textContent = `${step.label}: ${stateLabel(step.state)}`;
      workflowBadges.appendChild(badge);
    });
  }
  // Falls back to the generic word when nothing is selected yet, so the nav
  // never renders an empty item.
  function activeMeasurementNavLabel() {
    const experiment = store.get();
    const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
    const index = assays.findIndex((assay) => assay && assay.id === experiment.activeAssayId);
    if (index === -1) return 'Measurement';
    const label = assays[index] && typeof assays[index].label === 'string' ? assays[index].label.trim() : '';
    return label || `Measurement ${index + 1}`;
  }

  function renderNav(activeId) {
    navSteps.textContent = '';
    navUtilities.textContent = '';
    router.steps.forEach((step) => {
      const current = workflowStep(step.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `nav-step${step.id === activeId ? ' active' : ''}${current ? ` workflow-state-${current.state}` : ''}`;
      button.dataset.stepId = step.id;
      // "Measurements" (the registry) and "Measurement" (the one you opened)
      // truncate to the same thing in the collapsed rail and read as a
      // duplicate when expanded. The detail route names the measurement it is
      // actually showing instead, which is both distinguishable and more
      // useful -- it says where you are, not what kind of page this is.
      const label = step.id === 'measurement' ? activeMeasurementNavLabel() : (step.title || step.id);
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
      (step.utility ? navUtilities : navSteps).appendChild(button);
    });
    navUtilities.appendChild(themeNavButton);
  }
  function renderMobileControls(activeId = router.current()) {
    const experiment = store.get();
    assaySelect.textContent = '';
    (Array.isArray(experiment.assays) ? experiment.assays : []).forEach((assay, index) => {
      const option = document.createElement('option'); option.value = assay.id; option.textContent = assay.label || `Measurement ${index + 1}`; option.selected = assay.id === experiment.activeAssayId; assaySelect.appendChild(option);
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
    const mapDecision = workflowProgress.map?.nextDecision;
    const currentExperiment = store.get();
    const mapDestination = nextDecisionDestination(mapDecision, currentExperiment);
    // A map decision owned by the visible step is useful guidance, but it is
    // not a navigation destination. Treating it as one made Continue route
    // back to the same hash (notably Samples & design) and appear inert.
    // Switching to another measurement on this same route remains a real
    // destination and must keep the map-aware behavior.
    const isCurrentDestination = (destination, experiment) =>
      destination &&
      destination.routeId === activeId &&
      (!destination.measurementId || destination.measurementId === experiment.activeAssayId);
    const continueDestination = isCurrentDestination(mapDestination, currentExperiment) ? null : mapDestination;
    position.textContent = index === -1 ? 'Guide (optional)' : `Step ${index + 1} of ${steps.length}`;
    back.disabled = index <= 0;
    next.disabled = continueDestination === null && (index === -1 || index >= steps.length - 1);
    next.textContent = continueDestination ? 'Continue to next decision' : 'Continue';
    explain.disabled = !currentStep || typeof explainStepHandler !== 'function';
    back.onclick = () => { if (index > 0) router.navigate(steps[index - 1].routeId); };
    next.onclick = () => {
      if (continueDestination) {
        const current = store.get();
        const freshDestination = nextDecisionDestination(mapDecision, current);
        if (freshDestination && !isCurrentDestination(freshDestination, current)) {
          if (freshDestination.measurementId && current.activeAssayId !== freshDestination.measurementId) {
            store.patch({ activeAssayId: freshDestination.measurementId });
          }
          router.navigate(freshDestination.routeId);
          return;
        }
      }
      // The map either already points here or changed while the user was
      // deciding. In both cases Continue retains its dependable linear path.
      if (index !== -1 && index < steps.length - 1) router.navigate(steps[index + 1].routeId);
    };
    // currentStep.id is the canonical workflow id: workflowStep() applies
    // the existing panel -> microscopy alias in one shared place.
    explain.onclick = () => {
      if (currentStep && typeof explainStepHandler === 'function') explainStepHandler(currentStep.id);
    };
  }
  router.onChange((id) => { renderCompass(id); renderNav(id); renderMobileControls(id); renderFooter(id); });
  store.subscribe((state) => { renderCompass(router.current()); renderSwitcher(state); renderMobileControls(router.current()); });
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
    setFeatureWalkthroughHandler(handler) {
      featureWalkthroughHandler = typeof handler === 'function' ? handler : null;
      featureWalkthrough.disabled = !featureWalkthroughHandler;
    },
    setGuidedAsideVisible(visible) {
      const isVisible = Boolean(visible);
      guidedAsideHost.hidden = !isVisible;
      body.classList.toggle('has-guided-aside', isVisible);
    },
  };
}
