// One measurement, one page.
//
// Samples & design, Acquisition and Data plan used to be three separate routes.
// A researcher planning one measurement had to visit three screens and hold the
// connection between them in their head, and the navigation implied an order
// that the app did not actually require. They are now three sections of this
// page.
//
// This module composes rather than reimplements. designStep, panelStep and
// namingStep already expose an identical `render(container, store, options)`
// contract and each clears its own container first, so handing each one its own
// <section> is enough -- not a line of their internal logic moved. They render
// `embedded` here (see ui/stepHeading.js), which demotes their <h1> to an <h2>
// and drops the per-step "Planning X for: {measurement}" line, because this
// page states the measurement once in its own header.
//
// The steps stay independently renderable, which is what keeps this a
// composition: any of them can still be mounted alone.
//
// The header (including its status badges) and the three embedded sections
// stay in sync through one small hook, NOT a store.subscribe (see
// docs/cma-lessons.md lessons 46/49/50 -- a plain subscription re-renders
// everything on every keystroke, which is exactly the "rebuild the DOM every
// time" failure mode those lessons warn against, and it would fire for the
// writer too, undoing whatever focus/caret care that section's own writer
// took).
//
// Each embedded step's render() returns `{ id, refresh() }` (a step that
// hasn't been updated to do so yet -- i.e. returns undefined -- is simply
// treated as having no refresh; the page still works, it just stays stale
// for that one section until it is updated). This page hands each section
// `onSectionChanged(sourceId)` via embeddedOptions; a section calls it,
// naming itself, right after it writes to the store. Multiple calls in
// quick succession (e.g. several keystrokes) coalesce behind a single
// trailing `window.setTimeout(..., 150)` (bounded by a 600 ms max wait so a
// continuous typist still sees siblings repaint). When that timer fires,
// this page calls `refresh()` on every section's handle EXCEPT the most
// recent writer (it already repainted itself synchronously; an earlier
// writer inside the same window is refreshed, because the later write may
// have changed what it shows) and then `refreshHeader()`. A notify raised
// while a refresh runs is dropped, so a misbehaving refresh cannot loop.
// `refreshHeader()` keeps the existing statusGroup element and rebuilds only
// its children from `options.getWorkflowProgress?.() ?? options.workflowProgress`
// (main.js's post-write thunk; the plain snapshot is stale by design, kept
// only as a fallback for a caller that has none).
//
// Refresh paths never write the store -- see measurementRefresh.test.js's
// source-grep test -- so there is no path back into onSectionChanged from a
// refresh, and the mechanism cannot loop.

import { designStep } from './design.js';
import { assayView } from '../../core/assay.js';
import {
  measurementStatus,
  measurementStatusLabel,
  MEASUREMENT_STATUS_SCOPES,
  MEASUREMENT_STATUS_TONES,
} from '../../engine/measurementStatus.js';

const MEASUREMENT_SECTIONS = Object.freeze([
  Object.freeze({ id: 'measurement-section-design', label: 'Samples & design' }),
  Object.freeze({ id: 'measurement-section-acquisition', label: 'Acquisition' }),
  Object.freeze({ id: 'measurement-section-dataplan', label: 'Data plan' }),
]);

function activeMeasurement(experiment) {
  const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
  const index = assays.findIndex((assay) => assay && assay.id === experiment.activeAssayId);
  const assay = index === -1 ? null : assays[index];
  return {
    assay,
    label: assay?.label || (index === -1 ? 'this measurement' : `Measurement ${index + 1}`),
  };
}

function appendStatusBadge(parent, scope, status) {
  const badge = document.createElement('span');
  // State is carried by the text itself, not only by the colour the dataset
  // attribute selects -- the same rule the rest of the app follows.
  badge.className = 'measurement-status-badge';
  badge.dataset.scope = scope;
  badge.dataset.status = status;
  badge.dataset.tone = (MEASUREMENT_STATUS_TONES[scope] && MEASUREMENT_STATUS_TONES[scope][status]) || 'neutral';
  badge.textContent = measurementStatusLabel(scope, status);
  parent.appendChild(badge);
  return badge;
}

function appendAnchorRail(parent) {
  const nav = document.createElement('nav');
  nav.className = 'measurement-anchor-rail';
  nav.setAttribute('aria-label', 'Sections of this measurement');
  const list = document.createElement('ul');
  list.className = 'measurement-anchor-list';
  for (const section of MEASUREMENT_SECTIONS) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'measurement-anchor-link';
    // A same-document fragment, so it works with no JS and keeps the browser's
    // own focus and history behaviour rather than reimplementing scrolling.
    link.href = `#${section.id}`;
    link.textContent = section.label;
    item.appendChild(link);
    list.appendChild(item);
  }
  nav.appendChild(list);
  parent.appendChild(nav);
  return nav;
}

function appendEmptyState(main, router) {
  const empty = document.createElement('p');
  empty.className = 'proposals-empty supporting-description';
  empty.textContent = 'No measurement is selected. Choose one from Measurements, or add your first.';
  main.appendChild(empty);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'copy-button';
  action.textContent = 'Go to Measurements';
  action.addEventListener('click', () => {
    if (router) router.navigate('study');
  });
  main.appendChild(action);
}

export function createMeasurementStep({ panelStep, namingStep }) {
  return {
    id: 'measurement',
    title: 'Measurement',
    render(main, store, options = {}) {
      main.textContent = '';
      const { router } = options;
      const experiment = store.get();
      const { assay, label } = activeMeasurement(experiment);

      const header = document.createElement('header');
      header.className = 'measurement-header';
      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = label;
      header.appendChild(heading);
      main.appendChild(header);

      if (!assay) {
        appendEmptyState(main, router);
        return;
      }

      const statusGroup = document.createElement('div');
      statusGroup.className = 'measurement-status-group';
      header.appendChild(statusGroup);

      // Rebuilds ONLY statusGroup's children -- the element itself (and its
      // place in `header`) never changes -- from whichever workflow-progress
      // source options offers: the thunk if the caller supplies one (so this
      // reads the state AFTER whatever just changed it), else the one-shot
      // snapshot every render already had, so the page keeps rendering
      // correctly before every caller passes the thunk.
      function refreshHeader() {
        const progress = options.getWorkflowProgress?.() ?? options.workflowProgress;
        const progressAssays = Array.isArray(progress?.assays) ? progress.assays : [];
        const status = progressAssays.find((entry) => entry && entry.id === assay.id)?.status
          || measurementStatus(null);
        statusGroup.textContent = '';
        for (const scope of MEASUREMENT_STATUS_SCOPES) {
          appendStatusBadge(statusGroup, scope, status[scope]);
        }
      }
      refreshHeader();

      const view = assayView(experiment, assay.id);
      const readout = typeof view.readoutText === 'string' && view.readoutText.trim()
        ? view.readoutText.trim()
        : typeof view.readout === 'string' ? view.readout.trim() : '';
      if (readout) {
        const summary = document.createElement('p');
        summary.className = 'measurement-header-readout';
        summary.textContent = readout;
        header.appendChild(summary);
      }

      appendAnchorRail(main);

      const body = document.createElement('div');
      body.className = 'measurement-body';
      main.appendChild(body);

      // Cross-section refresh state for this one render of the page. A
      // second render() call (a route change and back) builds an entirely
      // new closure over a new `header`/`handles`/etc, so a timer left
      // pending from a PRIOR render is harmless: isPageLive() below checks
      // against the `header` captured in ITS OWN closure, which stops being
      // one of `main`'s current children the moment this page is torn down
      // (main.textContent = '' on the next render, see designStep/panelStep/
      // namingStep and this function's own top line) -- so a stale timer
      // firing late finds isPageLive() false and does nothing.
      const handles = {};
      let timerId = null;
      let refreshing = false;

      // `main.children` is a live HTMLCollection in a real browser (no
      // `.includes`) but a plain Array in the test domStub; Array.prototype
      // .includes works on both since it only needs `.length` and indices.
      function isPageLive() {
        return Array.prototype.includes.call(main.children, header);
      }

      // Red-team A4: exclude only the MOST RECENT writer, never the union of
      // everything that wrote inside the window -- two sections edited within
      // 150 ms of each other would otherwise both be skipped and the earlier
      // one (which repainted itself BEFORE the later write) would stay stale.
      // A notify raised while a refresh is running is dropped, not queued:
      // refresh() bodies are derived-only and never write the store, so a
      // notify from inside one is a bug, and honouring it would ping-pong
      // every 150 ms forever. A max wait bounds a continuous typist so the
      // siblings repaint at least every MAX_WAIT_MS.
      const DEBOUNCE_MS = 150;
      const MAX_WAIT_MS = 600;
      let lastSource = null;
      let firstPendingAt = null;

      function runRefresh() {
        timerId = null;
        if (!isPageLive()) return;
        const source = lastSource;
        lastSource = null;
        firstPendingAt = null;
        refreshing = true;
        try {
          for (const [id, handle] of Object.entries(handles)) {
            if (id === source) continue;
            if (!handle || typeof handle.refresh !== 'function') continue;
            try {
              handle.refresh();
            } catch (err) {
              // One section's failure must not re-freeze the others or the
              // header badges (red-team A4).
              console.error(`measurement: refresh of section "${id}" failed`, err);
            }
          }
          try {
            refreshHeader();
          } catch (err) {
            console.error('measurement: header refresh failed', err);
          }
        } finally {
          refreshing = false;
        }
      }

      function onSectionChanged(sourceId) {
        if (refreshing) return;
        lastSource = sourceId;
        const now = Date.now();
        if (firstPendingAt === null) firstPendingAt = now;
        if (timerId !== null) window.clearTimeout(timerId);
        const waited = now - firstPendingAt;
        const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
        timerId = window.setTimeout(runRefresh, delay);
      }

      // Each step owns its section outright. Options pass through untouched so
      // advisor, experience level and routing behave exactly as they did when
      // these were separate routes; onSectionChanged is new and additive.
      const embeddedOptions = { ...options, embedded: true, onSectionChanged };
      for (const step of [designStep, panelStep, namingStep]) {
        const section = document.createElement('section');
        section.className = 'measurement-section';
        section.dataset.measurementSection = step.id;
        body.appendChild(section);
        handles[step.id] = step.render(section, store, embeddedOptions);
      }
    },
  };
}
