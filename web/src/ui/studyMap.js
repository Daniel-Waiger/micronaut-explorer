// Reusable, DOM-only Study map.  It owns the page-level orientation
// interaction, but deliberately does not own persistence, routing rules, or
// decision ordering: those stay with the injected store/router and the pure
// experiment-map projection respectively.

import { assayById, groupSeedLevels, scopeWrite, seedAssayGroups } from '../core/assay.js';
import { shortId } from '../core/ids.js';
import { editTagFor } from '../core/provenance.js';
import { buildExperimentMap } from '../engine/experimentMap.js';

const ORIENTATION_QUESTIONS = Object.freeze([
  Object.freeze({ id: 'research-question', skipIds: ['research-question', 'researchQuestion'] }),
  Object.freeze({ id: 'system', skipIds: ['system', 'studyContext.system'] }),
  Object.freeze({ id: 'comparison-mode', skipIds: ['comparison-mode', 'studyContext.comparisonMode'] }),
  Object.freeze({ id: 'measurement', skipIds: [] }),
  Object.freeze({ id: 'experimental-unit', skipIds: ['experimental-unit', 'studyContext.experimentalUnit'] }),
]);

const COMPARISON_MODE_PROMPT = 'Will you compare groups or conditions, or is this an observational study?';

function studyMapText(value) {
  return typeof value === 'string' ? value : '';
}

function input(doc, { id, label, value, placeholder, help, multiline = false, onInput }) {
  const row = doc.createElement('div');
  row.className = 'field-row study-map-field';
  const labelEl = doc.createElement('label');
  labelEl.className = 'field-label';
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  row.appendChild(labelEl);
  const control = doc.createElement(multiline ? 'textarea' : 'input');
  control.id = id;
  control.className = 'field-input';
  if (!multiline) control.type = 'text';
  control.value = value;
  control.placeholder = placeholder;
  if (help) {
    const helpId = `${id}-help`;
    control.setAttribute('aria-describedby', helpId);
    const helpEl = doc.createElement('p');
    helpEl.id = helpId;
    helpEl.className = 'proposals-empty';
    helpEl.textContent = help;
    row.append(control, helpEl);
  } else {
    row.appendChild(control);
  }
  if (typeof onInput === 'function') control.addEventListener('input', () => onInput(control.value));
  return { row, control };
}

function studyMapButton(doc, className, label, onClick) {
  const control = doc.createElement('button');
  control.type = 'button';
  control.className = className;
  control.textContent = label;
  control.addEventListener('click', onClick);
  return control;
}

function knownMeasurementIds(experiment) {
  const assays = Array.isArray(experiment && experiment.assays) ? experiment.assays : [];
  return new Set(assays.map((assay) => assay && assay.id).filter((id) => typeof id === 'string' && id));
}

function nextUnusedId(experiment) {
  const known = knownMeasurementIds(experiment);
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const id = shortId();
    if (!known.has(id)) return id;
  }
  return null;
}

/**
 * Create a Study-map controller. `getMap` is optional for consumers that
 * already have a shared workflow snapshot; otherwise the canonical pure map
 * is built from the current study.  The controller does not subscribe on its
 * own, so typing into an editable summary cannot rebuild an input and lose
 * its caret. Its owner calls `refresh()` whenever an external store change
 * needs to be reflected.
 */
export function createStudyMap({ store, router, getMap, document: suppliedDocument } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.setPath !== 'function' || typeof store.patch !== 'function') {
    throw new Error('createStudyMap requires a store with get(), setPath(), and patch().');
  }
  const doc = suppliedDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('createStudyMap requires a DOM document.');
  }

  const element = doc.createElement('section');
  element.className = 'study-map-editor';
  element.setAttribute('aria-label', 'Study map');
  let intakeStep = null;
  let destroyed = false;

  function mapForCurrentStudy() {
    const study = store.get();
    if (typeof getMap === 'function') {
      const supplied = getMap(study);
      if (supplied && typeof supplied === 'object') return supplied;
    }
    return buildExperimentMap(study);
  }

  function tagFor(slotKey) {
    return editTagFor(store.get().provenance?.slots?.[slotKey]?.tag ?? null);
  }

  function write(path, value, slotKey = path) {
    return store.setPath(path, value, tagFor(slotKey), { slotKey });
  }

  function markSkipped(ids) {
    const candidates = ids.filter(Boolean);
    if (candidates.length === 0) return;
    store.patch((state) => {
      const provenance = state.provenance && typeof state.provenance === 'object' ? state.provenance : {};
      const previous = Array.isArray(provenance.skipped) ? provenance.skipped : [];
      const skipped = [...previous];
      for (const id of candidates) {
        if (!skipped.includes(id)) skipped.push(id);
      }
      return { provenance: { ...provenance, skipped } };
    });
  }

  function measurementForIntake(map) {
    const target = Array.isArray(map.measurements)
      ? map.measurements.find((measurement) => measurement && measurement.state !== 'answered')
      : null;
    return target && assayById(store.get(), target.id) ? target : null;
  }

  function skipIdsFor(step, map) {
    if (step.id !== 'measurement') return step.skipIds;
    const measurement = measurementForIntake(map);
    return measurement ? [`measurement-definition:${measurement.id}`, `assay:${measurement.id}.label`] : [];
  }

  function firstUnansweredStep(map) {
    const states = [
      map.question?.state,
      map.system?.state,
      map.comparison?.state,
      Array.isArray(map.measurements) && map.measurements.some((measurement) => measurement.state === 'answered')
        ? 'answered'
        : Array.isArray(map.measurements) && map.measurements.some((measurement) => measurement.state === 'provisional')
          ? 'provisional'
          : 'missing',
      map.experimentalUnit?.state,
    ];
    const index = states.findIndex((state) => state === 'missing');
    return index === -1 ? null : index;
  }

  function navigateDecision(decision) {
    if (!decision || !decision.routeId || !router || typeof router.navigate !== 'function') return false;
    if (decision.measurementId) {
      // Never derive an array index from a decision. A deleted measurement
      // makes an old projection harmless: neither patch nor navigation runs.
      if (!assayById(store.get(), decision.measurementId)) {
        refresh();
        return false;
      }
      store.patch({ activeAssayId: decision.measurementId });
    }
    return router.navigate(decision.routeId);
  }

  function appendQuestionHeader(host, index) {
    const progress = doc.createElement('p');
    progress.className = 'study-map-progress';
    progress.textContent = `Study map · Question ${index + 1} of ${ORIENTATION_QUESTIONS.length}`;
    host.appendChild(progress);
  }

  function appendComparisonControls(host, map, { labelledBy } = {}) {
    const fieldset = doc.createElement('fieldset');
    fieldset.className = 'study-map-comparison';
    if (labelledBy) {
      fieldset.setAttribute('aria-labelledby', labelledBy);
    } else {
      const legend = doc.createElement('legend');
      legend.textContent = COMPARISON_MODE_PROMPT;
      fieldset.appendChild(legend);
    }
    const help = doc.createElement('p');
    help.className = 'proposals-empty';
    help.textContent = 'Examples: irrigated and dry plants; amended and unamended soil; coated and uncoated food films; or a descriptive survey of surface roughness.';
    fieldset.appendChild(help);
    const currentMode = map.comparison?.mode || 'not-decided';
    for (const choice of [
      ['groups', 'Compare groups or conditions'],
      ['observational', 'Observational study'],
    ]) {
      const label = doc.createElement('label');
      label.className = 'question-answer';
      const radio = doc.createElement('input');
      radio.type = 'radio';
      radio.name = 'study-map-comparison-mode';
      radio.value = choice[0];
      radio.checked = currentMode === choice[0];
      radio.addEventListener('change', () => {
        write('studyContext.comparisonMode', choice[0]);
        groupsSummary.hidden = choice[0] !== 'groups';
      });
      label.append(radio, doc.createTextNode(` ${choice[1]}`));
      fieldset.appendChild(label);
    }
    // Read-only: groups themselves are typed exactly once, per measurement,
    // on Samples & design -- see ui/steps/design.js. This line is a summary
    // of what those measurements already say, not a second place to type
    // them (that duplicate editor is what this change removes).
    const groupsSummary = doc.createElement('p');
    groupsSummary.className = 'study-map-groups-summary proposals-empty';
    const groupLevels = Array.isArray(map.comparison?.groups) ? map.comparison.groups : [];
    groupsSummary.textContent =
      groupLevels.length > 0
        ? `Groups in use: ${groupLevels.join(', ')}`
        : "You'll name the groups on each measurement, under Samples & design.";
    groupsSummary.hidden = currentMode !== 'groups';
    fieldset.appendChild(groupsSummary);
    host.appendChild(fieldset);
  }

  function appendIntake(host, map, index) {
    const question = ORIENTATION_QUESTIONS[index];
    const heading = doc.createElement('h2');
    heading.className = 'design-subheading';
    const content = doc.createElement('div');
    content.className = 'study-map-intake';
    appendQuestionHeader(content, index);

    if (question.id === 'research-question') {
      heading.textContent = 'What are you trying to find out?';
      content.appendChild(heading);
      const field = input(doc, {
        id: 'study-map-research-question',
        label: 'Research question',
        value: studyMapText(map.question?.value),
        multiline: true,
        placeholder: 'e.g. Does drought change tomato root growth?',
        help: 'Examples: Does compost change soil respiration? Does a coating improve a food package barrier? Does polishing change a surface texture seen by microscopy?',
        onInput: (value) => write('researchQuestion', value),
      });
      content.appendChild(field.row);
    } else if (question.id === 'system') {
      heading.textContent = 'What organism, material, sample, surface, or system are you studying?';
      content.appendChild(heading);
      const field = input(doc, {
        id: 'study-map-system',
        label: 'System or material',
        value: studyMapText(map.system?.value),
        placeholder: 'e.g. tomato seedlings in soil',
        help: 'Examples: tomato seedlings, independently collected soil cores, a cheese-packaging film, or polished glass coupons imaged for surface texture.',
        onInput: (value) => write('studyContext.system', value),
      });
      content.appendChild(field.row);
    } else if (question.id === 'comparison-mode') {
      heading.id = 'study-map-comparison-heading';
      heading.textContent = COMPARISON_MODE_PROMPT;
      content.appendChild(heading);
      appendComparisonControls(content, map, { labelledBy: heading.id });
    } else if (question.id === 'measurement') {
      heading.textContent = 'What will you measure or observe?';
      content.appendChild(heading);
      const measurement = measurementForIntake(map);
      const assay = measurement && assayById(store.get(), measurement.id);
      if (assay) {
        const label = input(doc, {
          id: 'study-map-measurement-name',
          label: 'Measurement name',
          value: studyMapText(assay.label),
          placeholder: 'e.g. Root architecture',
          help: 'Use a short name that will make sense in the map and measurement workspace.',
          onInput: (value) => {
            const address = scopeWrite(store.get(), 'label', assay.id);
            write(address.path, value, address.slotKey);
          },
        });
        const readout = input(doc, {
          id: 'study-map-measurement-observation',
          label: 'What will you measure or observe?',
          value: studyMapText(assay.readoutText) || studyMapText(assay.readout),
          placeholder: 'e.g. root length and branching',
          help: 'Examples: plant root architecture; CO₂ flux from soil; oxygen permeability of a packaging film; roughness measured from microscope images.',
          onInput: (value) => {
            const address = scopeWrite(store.get(), 'readoutText', assay.id);
            write(address.path, value, address.slotKey);
          },
        });
        content.append(label.row, readout.row);
      } else {
        const notice = doc.createElement('p');
        notice.className = 'proposals-empty';
        notice.textContent = 'No writable measurement is available. You can continue to the Measurements workspace from the map summary.';
        content.appendChild(notice);
      }
    } else {
      heading.textContent = 'What counts as one independent experimental unit?';
      content.appendChild(heading);
      const field = input(doc, {
        id: 'study-map-experimental-unit',
        label: 'Independent experimental unit',
        value: studyMapText(map.experimentalUnit?.value),
        placeholder: 'e.g. one independently grown plant',
        help: 'Examples: one plant grown in its own pot; one independently collected soil core; one separately fabricated film; or one separately prepared microscopy coupon.',
        onInput: (value) => write('studyContext.experimentalUnit', value),
      });
      content.appendChild(field.row);
    }

    const status = doc.createElement('p');
    status.className = 'study-map-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Your answers are saved in this study as you type.';
    content.appendChild(status);

    const actions = doc.createElement('div');
    actions.className = 'study-map-actions';
    const back = studyMapButton(doc, 'workflow-back', 'Back', () => {
      if (index > 0) {
        intakeStep = index - 1;
        refresh();
      }
    });
    back.disabled = index === 0;
    const later = studyMapButton(doc, 'question-answer', 'Decide later', () => {
      markSkipped(skipIdsFor(question, map));
      intakeStep = index + 1;
      refresh();
    });
    const continueButton = studyMapButton(doc, 'workflow-continue', 'Continue', () => {
      intakeStep = index + 1;
      refresh();
    });
    actions.append(back, later, continueButton);
    content.appendChild(actions);
    host.appendChild(content);
  }

  function appendSummaryField(host, config) {
    const field = input(doc, config);
    host.appendChild(field.row);
    return field;
  }

  function appendSummary(host, map) {
    const heading = doc.createElement('h2');
    heading.className = 'design-subheading';
    heading.textContent = 'Study map';
    const intro = doc.createElement('p');
    intro.className = 'proposals-empty';
    intro.textContent = `${map.orientation?.answered || 0} of ${map.orientation?.total || 5} orientation decisions are answered. Edit any value here; detailed planning remains directly available in every workspace.`;
    host.append(heading, intro);

    const facts = doc.createElement('div');
    facts.className = 'study-map-summary';
    appendSummaryField(facts, {
      id: 'study-map-summary-question',
      label: 'Research question',
      value: studyMapText(map.question?.value),
      placeholder: 'What are you trying to find out?',
      onInput: (value) => write('researchQuestion', value),
    });
    appendSummaryField(facts, {
      id: 'study-map-summary-system',
      label: 'System or material',
      value: studyMapText(map.system?.value),
      placeholder: 'Organism, material, sample, surface, or system',
      onInput: (value) => write('studyContext.system', value),
    });
    appendComparisonControls(facts, map);
    appendSummaryField(facts, {
      id: 'study-map-summary-unit',
      label: 'Independent experimental unit',
      value: studyMapText(map.experimentalUnit?.value),
      placeholder: 'What is independently assigned or sampled?',
      onInput: (value) => write('studyContext.experimentalUnit', value),
    });
    host.appendChild(facts);

    const measurementHeading = doc.createElement('h3');
    measurementHeading.className = 'design-subheading';
    measurementHeading.textContent = 'Measurements';
    host.appendChild(measurementHeading);
    const measurements = doc.createElement('div');
    measurements.className = 'study-map-measurements';
    const assays = Array.isArray(store.get().assays) ? store.get().assays : [];
    assays.forEach((assay, index) => {
      if (!assayById(store.get(), assay.id)) return;
      const card = doc.createElement('section');
      card.className = 'study-map-measurement';
      const title = doc.createElement('h4');
      title.textContent = `Measurement ${index + 1}`;
      card.appendChild(title);
      const labelAddress = scopeWrite(store.get(), 'label', assay.id);
      const label = input(doc, {
        id: `study-map-measurement-${assay.id}-name`,
        label: 'Measurement name',
        value: studyMapText(assay.label),
        placeholder: 'Short measurement name',
        onInput: (value) => write(labelAddress.path, value, labelAddress.slotKey),
      });
      const readoutAddress = scopeWrite(store.get(), 'readoutText', assay.id);
      const readout = input(doc, {
        id: `study-map-measurement-${assay.id}-readout`,
        label: 'What will be measured or observed?',
        value: studyMapText(assay.readoutText) || studyMapText(assay.readout),
        placeholder: 'Intended observation',
        onInput: (value) => write(readoutAddress.path, value, readoutAddress.slotKey),
      });
      card.append(label.row, readout.row);
      measurements.appendChild(card);
    });
    host.appendChild(measurements);

    const add = doc.createElement('section');
    add.className = 'study-map-add-measurement';
    const addHeading = doc.createElement('h4');
    addHeading.textContent = 'Add another measurement';
    const addName = input(doc, {
      id: 'study-map-add-measurement-name',
      label: 'Measurement name',
      value: '',
      placeholder: 'e.g. Surface roughness',
    });
    const addReadout = input(doc, {
      id: 'study-map-add-measurement-readout',
      label: 'What will be measured or observed?',
      value: '',
      placeholder: 'e.g. roughness from microscope images',
    });
    const addStatus = doc.createElement('p');
    addStatus.className = 'study-map-status';
    addStatus.setAttribute('aria-live', 'polite');
    const addButton = studyMapButton(doc, 'add-factor-button', 'Add measurement', () => {
      const label = addName.control.value.trim();
      const readout = addReadout.control.value.trim();
      if (!label || !readout) {
        addStatus.textContent = 'Enter both a measurement name and what it will observe.';
        return;
      }
      const current = store.get();
      const id = nextUnusedId(current);
      if (!id) {
        addStatus.textContent = 'Could not create a unique measurement identifier. Please try again.';
        return;
      }
      const seeded = seedAssayGroups(groupSeedLevels(current), id);
      const provenance = current.provenance && typeof current.provenance === 'object' ? current.provenance : {};
      const slots = provenance.slots && typeof provenance.slots === 'object' ? provenance.slots : {};
      // One patch keeps the new assay and its weak group seed inseparable;
      // the two facts the user supplied are recorded as STRONG user edits in
      // that same atomic transition.
      seeded.assay.label = label;
      seeded.assay.readoutText = readout;
      store.patch({
        assays: [...(Array.isArray(current.assays) ? current.assays : []), seeded.assay],
        provenance: {
          ...provenance,
          slots: {
            ...slots,
            [seeded.provenanceSlotKey]: seeded.provenanceEntry,
            [`assay:${id}.label`]: { tag: 'user', detail: null },
            [`assay:${id}.readoutText`]: { tag: 'user', detail: null },
          },
        },
      });
      refresh();
    });
    add.append(addHeading, addName.row, addReadout.row, addButton, addStatus);
    host.appendChild(add);

    if (map.nextDecision) {
      const next = doc.createElement('section');
      next.className = 'study-map-next-decision';
      const nextHeading = doc.createElement('h3');
      nextHeading.textContent = 'Next decision';
      const reason = doc.createElement('p');
      reason.textContent = map.nextDecision.reason || map.nextDecision.label;
      const nextButton = studyMapButton(doc, 'workflow-continue', map.nextDecision.label, () => navigateDecision(map.nextDecision));
      next.append(nextHeading, reason, nextButton);
      host.appendChild(next);
    }
  }

  function refresh() {
    if (destroyed) return;
    const map = mapForCurrentStudy();
    const inferred = firstUnansweredStep(map);
    if (intakeStep === null) intakeStep = inferred;
    if (intakeStep !== null && intakeStep >= ORIENTATION_QUESTIONS.length) intakeStep = null;
    element.replaceChildren();
    if (intakeStep === null) appendSummary(element, map);
    else appendIntake(element, map, intakeStep);
  }

  refresh();
  return {
    element,
    refresh,
    destroy() {
      destroyed = true;
      element.replaceChildren();
    },
  };
}
