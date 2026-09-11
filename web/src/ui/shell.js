// Global UI shell. Project persistence and readiness are supplied by main.js;
// this module only renders those contracts and routes user actions back out.

import { groupSeedLevels, removeAssay, seedAssayGroups } from '../core/assay.js';
import { shortId } from '../core/ids.js';
import { MAX_STUDY_ROWS } from '../engine/plan.js';
import { buildFeedbackReport } from '../core/feedbackReport.js';
import { handoffFeedback } from './feedbackHandoff.js';
import { createIcon } from './icons.js';
import { measurementStatus, measurementStatusLabel } from '../engine/measurementStatus.js';
import { IS_SANDBOX, nsKey } from '../core/storageScope.js';
import { openInNewTab, SANDBOX_URL } from './newTab.js';

// Maps a measurement status record's `tone` onto the switcher pill's existing
// badge classes (app.css:2947-2954), so the pill and the Measurements
// registry -- both readers of workflowProgress.assays[i].status -- share one
// vocabulary instead of the pill speaking the retired route-state words.
const MEASUREMENT_TONE_CLASS = Object.freeze({
  ok: 'is-complete',
  attention: 'is-needs-attention',
  progress: 'is-in-progress',
  neutral: 'is-not-started',
});

// UNSCOPED on purpose (core/storageScope.js's nsKey is deliberately NOT
// applied here): the practice tab (?demo=1) should look like the user's own
// app, and a remembered light/dark choice carries no study data, so there is
// nothing about it worth isolating per tab. storageScope.js's own SHARED_KEYS
// already treats this exact key as shared, so nsKey(THEME_KEY) would resolve
// to the same unscoped key anyway -- left unscoped explicitly here so that
// fact doesn't have to be re-derived by reading storageScope.js.
const THEME_KEY = 'micronaut.theme';
// SCOPED, unlike THEME_KEY above: nav-collapsed is ordinary per-tab layout
// state, not a preference worth sharing on purpose, so it gets the default
// treatment -- namespaced so collapsing the rail in one tab can never
// silently flip it in the other.
const NAV_COLLAPSED_KEY = nsKey('micronaut.navCollapsed');

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
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

// `steps` is router.steps (every route, including the utility/guide ones);
// 'guide' is the one non-utility route excluded from the primary workflow
// (see engine/workflowProgress.js's PRIMARY_WORKFLOW/OPTIONAL_WORKFLOW
// split). A route inside that primary set gets its ordinal position; any
// other route (Settings, Feedback, Guide) names itself via its own `title`
// instead of every one of them claiming to be "Guide (optional)".
export function footerPositionLabel(steps, activeId) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const primary = safeSteps.filter((step) => step && step.id !== 'guide' && !step.utility);
  const index = primary.findIndex((step) => step.id === activeId);
  if (index !== -1) return `Step ${index + 1} of ${primary.length}`;
  const active = safeSteps.find((step) => step && step.id === activeId);
  return (active && typeof active.title === 'string' && active.title) || 'Guide (optional)';
}

// Research brief (`describe`) writes a study-wide narrative whose
// suggestions merely TARGET the active measurement, so it earns its own
// non-editing-of-that-measurement phrasing; Review (`overview`) is read-only
// and must never claim to be "editing" anything. Every other route
// (including `measurement`, which really is being edited) keeps the original
// "Now editing" phrasing. Always resolves to a complete phrase -- never a
// bare "Now editing: " -- because both branches that need a measurement name
// fall back to a literal default instead of an empty label.
export function compassScopeLine(routeId, measurementLabel) {
  const label = typeof measurementLabel === 'string' && measurementLabel.trim() ? measurementLabel.trim() : 'Not selected';
  if (routeId === 'describe') return `Suggestions target: ${label}`;
  if (routeId === 'measurement') return `Now editing: Measurement: ${label}`;
  if (routeId === 'overview') return 'Reviewing: Whole study';
  return 'Now editing: Whole study';
}

export function renderShell(root, store, router, options = {}) {
  const {
    onReset, onNewBlank, onAdoptExample, onExportProject, onImportProject,
    onRestoreRecovery, onDeleteRecovery, kbIssueCount,
    // Injected (defaulting to the real IS_SANDBOX) so both the practice-tab
    // and real-tab branches of the banner below are exercisable against the
    // DOM stub without a real `location.search` to resolve against.
    isSandbox = IS_SANDBOX,
  } = options;
  // Missing lifecycle state must degrade conservatively. Only main can know
  // that a recovery slot was actually loaded or a save completed.
  let saveState = options.saveState || { status: 'unsaved' };
  let recoveryEntries = Array.isArray(options.recoveryEntries) ? options.recoveryEntries : [];
  let workflowProgress = options.workflowProgress || { primary: [], assays: [], summary: {} };
  let themeNavButton = null;
  let featureWalkthroughHandler = null;
  root.textContent = '';

  // Persistent, non-dismissable strip: the practice tab (?demo=1) must never
  // be mistaken for the real one, so unlike every other notice in this file
  // there is no close/dismiss control here at all. Built only when isSandbox
  // is true, so the real tab's DOM carries no trace of it -- not just
  // hidden, absent. Sits above the (sticky) header rather than joining its
  // sticky stack: the ResizeObserver-published --shell-*-height custom
  // properties a few hundred lines down assume exactly header + workflow
  // strip + switcher, and this banner is practice-tab-only chrome that has
  // no reason to earn a place in that shared calculation.
  let sandboxBanner = null;
  if (isSandbox) {
    sandboxBanner = document.createElement('div');
    sandboxBanner.className = 'sandbox-banner';
    sandboxBanner.setAttribute('role', 'note');
    const bannerText = document.createElement('span');
    bannerText.className = 'sandbox-banner-text';
    bannerText.textContent = 'Practice tab — example data, saved separately from your own study. Nothing you do here changes your work.';
    sandboxBanner.appendChild(bannerText);

    const bannerActions = document.createElement('div');
    bannerActions.className = 'sandbox-banner-actions';

    const whyButton = document.createElement('button');
    whyButton.type = 'button';
    whyButton.className = 'sandbox-banner-action';
    whyButton.textContent = 'Why a separate tab?';
    whyButton.addEventListener('click', () => {
      // The real explanation, not a euphemism: this app holds exactly one
      // study at a time, and a browser tab can only hold one page's worth of
      // that state too -- so a second tab against its own storage is the
      // only way to let you take the example apart with no risk to the
      // study open in the other tab. No custom modal system exists in this
      // file (see feedbackHandoff.js for the one place that owns one, which
      // this is not part of), so this reuses the same window.alert this
      // codebase already relies on elsewhere (ui/steps/naming.js) for a
      // single-acknowledgement message.
      window.alert(
        'Micronaut keeps one study open at a time, and a browser tab can only hold one study\'s worth of that on screen -- so the only way to let you take the example apart with no risk is to give it its own tab.\n\n' +
        'Close this tab whenever you are done: your study in the other tab is still open exactly as you left it. Anything you change here, in this practice tab, is kept too, so you can come back to it.'
      );
    });
    bannerActions.appendChild(whyButton);

    if (onReset) {
      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'sandbox-banner-action';
      resetButton.textContent = 'Reset to the example';
      resetButton.addEventListener('click', () => {
        if (window.confirm('Reset this practice tab back to the shipped example? Your current practice activity will be preserved in Restore.')) {
          onReset();
        }
      });
      bannerActions.appendChild(resetButton);
    }
    sandboxBanner.appendChild(bannerActions);
  }

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
  // New study and Walkthrough live in the nav rail's control panel
  // (navUtilities, alongside Settings/Feedback) rather than the header --
  // they are appended there in renderNav so they survive its re-render.
  let newStudy = null;
  if (onNewBlank) {
    newStudy = document.createElement('button');
    newStudy.type = 'button';
    newStudy.className = 'nav-step nav-action nav-new-study';
    newStudy.appendChild(createIcon('add', 'nav-step-icon'));
    const newStudyLabel = document.createElement('span');
    newStudyLabel.className = 'nav-step-label';
    newStudyLabel.textContent = 'New study';
    newStudy.appendChild(newStudyLabel);
    newStudy.title = 'Start a blank study. Previous versions remain available in Restore.';
    newStudy.addEventListener('click', () => {
      if (window.confirm('Start a blank study? Your current work remains available in Restore.')) onNewBlank();
    });
  }

  const featureWalkthrough = document.createElement('button');
  featureWalkthrough.type = 'button';
  featureWalkthrough.className = 'nav-step nav-action nav-walkthrough';
  featureWalkthrough.appendChild(createIcon('walkthrough', 'nav-step-icon'));
  const featureWalkthroughLabel = document.createElement('span');
  featureWalkthroughLabel.className = 'nav-step-label';
  featureWalkthroughLabel.textContent = 'Walkthrough';
  featureWalkthrough.appendChild(featureWalkthroughLabel);
  featureWalkthrough.title = 'Take a focused tour of the app’s feature areas.';
  featureWalkthrough.setAttribute('aria-label', 'Start feature walkthrough');
  featureWalkthrough.disabled = true;
  featureWalkthrough.addEventListener('click', () => featureWalkthroughHandler?.(featureWalkthrough));

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

  // This used to read "Reset to example study" and REPLACE the study on
  // screen after a window.confirm -- onReset (core/appController.js's
  // openExampleStudy) now refuses to run at all outside the practice tab, so
  // that control would be a dead button here even with the confirm kept.
  // Opening the practice tab (its own storage, ?demo=1) is the real
  // replacement, and it displaces nothing on screen, so there is nothing
  // left to confirm.
  // Hidden inside the practice tab itself, where it would offer to open the
  // tab you are already standing in. The banner's "Reset to the example"
  // above is the equivalent control there.
  if (!isSandbox) {
    utilityMenu.appendChild(action('Open example in a practice tab', () => {
      openInNewTab(SANDBOX_URL);
    }));
  }
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
      const entryTitle = entry.title || 'Untitled study';
      const row = document.createElement('div');
      row.className = 'shell-restore-row';
      const restore = action(`${index === 0 ? 'Latest: ' : ''}${entryTitle}`, () => {
        if (window.confirm('Restore this saved version? Your current work remains available in Restore.')) {
          onRestoreRecovery(entry.id);
        }
      }, 'shell-restore-action');
      restore.title = 'Restore this saved version';
      row.appendChild(restore);
      if (onDeleteRecovery) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'shell-restore-delete';
        remove.setAttribute('role', 'menuitem');
        remove.setAttribute('aria-label', `Permanently delete the saved version "${entryTitle}"`);
        remove.title = 'Permanently delete this saved version';
        remove.appendChild(createIcon('close', 'button-icon'));
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          if (window.confirm(`Permanently delete the saved version "${entryTitle}"? This cannot be undone.`)) {
            closeMenu();
            onDeleteRecovery(entry.id);
          }
        });
        row.appendChild(remove);
      }
      restoreList.appendChild(row);
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
    const saved = savePreference(THEME_KEY, theme);
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
    return saved;
  }
  ['dark', 'light', 'system'].forEach((mode) => {
    const label = mode === 'system' ? 'System' : `${mode[0].toUpperCase()}${mode.slice(1)} mode`;
    const modeAction = action(label, () => {
      theme = mode;
      if (!applyTheme()) showToast('Could not save that preference — it will reset when you reload.');
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
  workflowStrip.append(workflowSummary, compassDetails, compassScope, compassNext);

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
  // workflowProgress's default at options.workflowProgress (:52) carries no
  // assays/statuses at all, so a lookup miss falls back to
  // measurementStatus(null)'s all-lowest record rather than leaving the pill
  // undefined on first paint.
  function measurementStatusFor(id) {
    const entry = Array.isArray(workflowProgress.assays)
      ? workflowProgress.assays.find((assay) => assay?.id === id)
      : null;
    return entry?.status || measurementStatus(null);
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
    if (comparison.mode === 'groups' && groups.length > 0) return groups.join(' vs ');
    return '';
  }
  // Research brief accepts measurement-scoped SUGGESTIONS while writing a
  // study-wide narrative, and the measurement page is entirely one
  // measurement; everything else (including the read-only Review) has no
  // single measurement in scope. Only those two routes need the active
  // measurement's own label.
  function compassMeasurementLabel(experiment, map) {
    const measurements = Array.isArray(map?.measurements) ? map.measurements : [];
    const active = measurements.find((measurement) => measurement?.id === experiment.activeAssayId);
    return compassText(active?.label, 'Not selected');
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
    const questionText = compassText(map.question?.value, '');
    const systemText = compassText(map.system?.value, '');
    const scopeLine = compassScopeLine(activeId, compassMeasurementLabel(experiment, map));

    workflowSummary.textContent = compassDisplayText(titleText);
    workflowSummary.title = titleText;
    workflowSummary.setAttribute('aria-label', titleText);
    compassScope.textContent = compassDisplayText(scopeLine);
    compassScope.title = scopeLine;
    compassScope.setAttribute('aria-label', scopeLine);

    compassDetails.textContent = '';
    const comparisonText = comparisonSummary(map);
    [
      questionText && `Question: ${questionText}`,
      systemText && `System: ${systemText}`,
      comparisonText && `Comparison: ${comparisonText}`,
      measurements.length !== 1 && `${measurements.length} measurement${measurements.length === 1 ? '' : 's'}`,
    ].filter(Boolean).forEach((text) => {
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
      const status = measurementStatusFor(assay.id);
      const toneClass = MEASUREMENT_TONE_CLASS[status.tone] || MEASUREMENT_TONE_CLASS.neutral;
      badge.className = `assay-progress-badge ${toneClass}`;
      badge.textContent = measurementStatusLabel(status.headline.scope, status.headline.status);
      pill.append(select, badge);
      if (assays.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'assay-pill-delete';
        remove.appendChild(createIcon('close', 'button-icon'));
        remove.setAttribute('aria-label', `Delete measurement ${assay.label || `Measurement ${index + 1}`}`);
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          const deletedLabel = assay.label || `Measurement ${index + 1}`;
          if (!window.confirm(`Delete measurement "${deletedLabel}"?`)) return;
          const next = removeAssay(store.get(), assay.id);
          if (next) {
            store.patch(next);
            showToast(`Deleted "${deletedLabel}" and its design, panel, and naming data.`);
          }
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
  navToggle.addEventListener('click', () => {
    navCollapsed = !navCollapsed;
    const saved = savePreference(NAV_COLLAPSED_KEY, navCollapsed ? '1' : '0');
    body.classList.toggle('shell-nav-collapsed', navCollapsed);
    renderNavToggle();
    if (!saved) showToast('Could not save that preference — it will reset when you reload.');
  });
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
    if (!applyTheme()) showToast('Could not save that preference — it will reset when you reload.');
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
  root.append(...(sandboxBanner ? [sandboxBanner] : []), header, workflowStrip, switcher, body, footer, status);

  // Publishes the footer's real, current height so .shell-status and
  // .shell-main (app.css) can clear it exactly instead of duplicating a
  // guessed magic number in three places. A hidden/zero-height footer
  // naturally publishes 0px, which is the correct clearance for that case.
  // Guarded for environments without ResizeObserver (e.g. the Node test
  // runner that imports this module without a browser) -- the CSS fallback
  // value covers those.
  if (typeof ResizeObserver === 'function') {
    const publishFooterHeight = () => {
      document.documentElement.style.setProperty(
        '--workflow-footer-height',
        `${Math.ceil(footer.getBoundingClientRect().height)}px`
      );
    };
    new ResizeObserver(publishFooterHeight).observe(footer);
    publishFooterHeight();
  }

  // Publishes the header, study compass and measurement switcher's own
  // heights (each becomes sticky in app.css, stacked in this order) plus
  // their combined total, so .nav-sticky can size itself to exactly the
  // remaining viewport instead of assuming a fixed 210px and either
  // overshooting (control panel dangles past the fold) or undershooting
  // (rail clipped). Individual heights -- not just the total -- are needed
  // because each bar's own `top` offset in a sticky stack is the sum of the
  // bars above it, and any bar's rendered height can change independently
  // (a long brand/study title wraps, a badge appears). Any bar reporting 0
  // (e.g. hidden by a future change) is naturally the correct contribution.
  // Same guard/pattern as publishFooterHeight above.
  if (typeof ResizeObserver === 'function') {
    const chromeBars = [
      ['--shell-header-height', header],
      ['--shell-workflow-strip-height', workflowStrip],
      ['--shell-switcher-height', switcher],
    ];
    const publishChromeHeight = () => {
      let total = 0;
      chromeBars.forEach(([varName, el]) => {
        const h = el.getBoundingClientRect().height;
        total += h;
        document.documentElement.style.setProperty(varName, `${Math.ceil(h)}px`);
      });
      document.documentElement.style.setProperty('--shell-chrome-height', `${Math.ceil(total)}px`);
    };
    const chromeObserver = new ResizeObserver(publishChromeHeight);
    chromeBars.forEach(([, el]) => chromeObserver.observe(el));
    publishChromeHeight();
  }

  function renderWorkflowStrip() {
    renderCompass();
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
    const utilityButtons = new Map();
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
      // Set unconditionally -- not just when `current` (a workflow-progress
      // state) exists -- because utility steps like Settings and Feedback
      // have no workflow state at all, and the icon-only rail at <=900px
      // width is otherwise their only label. When `current` does exist, the
      // expanded badge remains the visible status authority; the title just
      // mirrors it for the collapsed/narrow states.
      button.title = accessibleLabel;
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
      if (step.utility) utilityButtons.set(step.id, button); else navSteps.appendChild(button);
    });
    if (newStudy) navUtilities.appendChild(newStudy);
    navUtilities.appendChild(featureWalkthrough);
    // Settings sits above Feedback in the control panel; any other utility
    // step keeps the order router.steps already defines.
    const orderedUtilityIds = ['settings', 'feedback', ...[...utilityButtons.keys()].filter((id) => id !== 'settings' && id !== 'feedback')];
    orderedUtilityIds.forEach((id) => {
      const button = utilityButtons.get(id);
      if (button) navUtilities.appendChild(button);
    });
    const manualLink = document.createElement('a');
    manualLink.className = 'nav-step';
    manualLink.dataset.stepId = 'manual';
    manualLink.href = 'manual/';
    manualLink.target = '_blank';
    manualLink.rel = 'noopener noreferrer';
    manualLink.setAttribute('aria-label', 'User manual (opens in a new tab)');
    manualLink.title = 'User manual (opens in a new tab)';
    manualLink.appendChild(createIcon('manual', 'nav-step-icon'));
    const manualLabel = document.createElement('span');
    manualLabel.className = 'nav-step-label';
    manualLabel.textContent = 'User manual';
    manualLink.appendChild(manualLabel);
    navUtilities.appendChild(manualLink);
    const releaseNotesLink = document.createElement('a');
    releaseNotesLink.className = 'nav-step';
    releaseNotesLink.dataset.stepId = 'release-notes';
    releaseNotesLink.href = 'release-notes/';
    releaseNotesLink.target = '_blank';
    releaseNotesLink.rel = 'noopener noreferrer';
    releaseNotesLink.setAttribute('aria-label', 'Release notes (opens in a new tab)');
    releaseNotesLink.title = 'Release notes (opens in a new tab)';
    releaseNotesLink.appendChild(createIcon('template', 'nav-step-icon'));
    const releaseNotesLabel = document.createElement('span');
    releaseNotesLabel.className = 'nav-step-label';
    releaseNotesLabel.textContent = 'Release notes';
    releaseNotesLink.appendChild(releaseNotesLabel);
    navUtilities.appendChild(releaseNotesLink);
    navUtilities.appendChild(themeNavButton);
  }
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
    position.textContent = footerPositionLabel(router.steps, activeId);
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
  router.onChange((id) => { renderCompass(id); renderNav(id); renderFooter(id); });
  store.subscribe((state) => { renderCompass(router.current()); renderSwitcher(state); });
  renderSwitcher(store.get());
  renderWorkflowStrip();
  renderNav(router.current());
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
      renderWorkflowStrip(); renderSwitcher(store.get()); renderNav(router.current()); renderFooter(router.current());
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
