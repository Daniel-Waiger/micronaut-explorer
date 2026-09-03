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

import { designStep } from './design.js';
import { assayView } from '../../core/assay.js';
import { buildExperimentMap } from '../../engine/experimentMap.js';
import { measurementStatus, measurementStatusLabel } from '../../engine/measurementStatus.js';

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

function appendStatusBadge(parent, status) {
  const badge = document.createElement('span');
  // State is carried by the text itself, not only by the colour the dataset
  // attribute selects -- the same rule the rest of the app follows.
  badge.className = 'measurement-status-badge';
  badge.dataset.status = status;
  badge.textContent = measurementStatusLabel(status);
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

      const map = buildExperimentMap(experiment);
      const mapped = (Array.isArray(map.measurements) ? map.measurements : [])
        .find((measurement) => measurement && measurement.id === assay.id);
      appendStatusBadge(header, measurementStatus(mapped));

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

      // Each step owns its section outright. Options pass through untouched so
      // advisor, experience level and routing behave exactly as they did when
      // these were separate routes.
      const embeddedOptions = { ...options, embedded: true };
      for (const step of [designStep, panelStep, namingStep]) {
        const section = document.createElement('section');
        section.className = 'measurement-section';
        section.dataset.measurementSection = step.id;
        body.appendChild(section);
        step.render(section, store, embeddedOptions);
      }
    },
  };
}
