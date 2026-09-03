// Pure study-orientation projection. This is the one authority for the
// Study-map's next-decision ordering; UI consumers receive its values and
// never infer orientation from prose or array positions themselves.

import { classifyConformanceIssue } from './decisionTriage.js';

export const MAP_STATES = Object.freeze([
  'missing',
  'provisional',
  'answered',
  'needs-attention',
]);

const EXPERIMENT_MAP_DECISION_TIERS = Object.freeze([
  'study-shape',
  'measurement-design',
  'before-acquisition',
  'later',
]);
// Preserve the module's public vocabulary while keeping the flattened build's
// shared function scope free of decisionTriage's top-level declaration.
export { EXPERIMENT_MAP_DECISION_TIERS as DECISION_TIERS };

const PROVISIONAL_TAGS = new Set(['llm', 'llm_freetext']);
const TIER_ORDER = new Map(EXPERIMENT_MAP_DECISION_TIERS.map((tier, index) => [tier, index]));

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function experimentMapText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function experimentMapHasValue(value) {
  if (Array.isArray(value)) return value.some(experimentMapHasValue);
  return value !== null && value !== undefined && (typeof value !== 'string' || experimentMapText(value) !== '');
}

function levels(value) {
  return Array.isArray(value) ? value.map(experimentMapText).filter(Boolean) : [];
}

function slotFor(slots, paths) {
  for (const path of paths) {
    const slot = object(slots[path]);
    if (Object.keys(slot).length > 0) return slot;
  }
  return {};
}

function experimentMapIsSkipped(skipped, ids) {
  return Array.isArray(skipped) && ids.some((id) => skipped.includes(id));
}

function stateFor(value, slots, paths, skipped, skippedIds) {
  const slot = slotFor(slots, paths);
  if (experimentMapHasValue(value)) {
    return slot.needsReview || PROVISIONAL_TAGS.has(slot.tag) ? 'provisional' : 'answered';
  }
  return experimentMapIsSkipped(skipped, skippedIds) ? 'provisional' : 'missing';
}

function validAssays(experiment) {
  const seen = new Set();
  const source = Array.isArray(experiment.assays) ? experiment.assays : [];
  return source.filter((assay) => {
    const id = assay && typeof assay.id === 'string' ? assay.id.trim() : '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function measurementLabel(assay, index) {
  return experimentMapText(assay.label) || `Measurement ${index + 1}`;
}

function specimenSummary(assay) {
  const specimen = object(assay.specimen);
  return [...new Set([experimentMapText(specimen.organism), experimentMapText(specimen.sampleType)].filter(Boolean))].join(' · ');
}

function recognizedReadout(assay) {
  // `readout` is the canonical id stored by the curated readout picker. A
  // nonblank `readoutText` is intentionally also valid: a user may describe
  // an Other measurement without the app pretending it knows its vocabulary.
  return /^[a-z0-9][a-z0-9-]*$/.test(experimentMapText(assay.readout)) || Boolean(experimentMapText(assay.readoutText));
}

function measurementState(assay, slots, skipped, index) {
  const id = assay.id;
  const labelState = stateFor(
    experimentMapText(assay.label),
    slots,
    [`assay:${id}.label`],
    skipped,
    [`measurement-definition:${id}`, `assay:${id}.label`]
  );
  const readoutValue = experimentMapText(assay.readoutText) || experimentMapText(assay.readout);
  const readoutState = stateFor(
    readoutValue,
    slots,
    [`assay:${id}.readout`, `assay:${id}.readoutText`],
    skipped,
    [`measurement-definition:${id}`, `assay:${id}.readout`, `assay:${id}.readoutText`]
  );
  const defined = Boolean(experimentMapText(assay.label)) && recognizedReadout(assay);
  if (defined && labelState === 'answered' && readoutState === 'answered') return 'answered';
  if (labelState === 'provisional' || readoutState === 'provisional') return 'provisional';
  return 'missing';
}

// The groups "in use" for the whole study: the deduped union across every
// measurement's own design.groups.levels. There is no study-level group
// list any more -- each measurement is the one place its groups are typed
// (ui/steps/design.js) -- so this projection is the closest thing to one,
// built fresh from the measurements rather than a separately-maintained field
// that could disagree with them.
function unionGroupLevels(assays) {
  const seen = new Set();
  const union = [];
  for (const assay of assays) {
    for (const level of levels(object(object(assay.design).groups).levels)) {
      const key = level.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      union.push(level);
    }
  }
  return union;
}

function orderedMeasurements(experiment, assays) {
  const activeId = typeof experiment.activeAssayId === 'string' ? experiment.activeAssayId : '';
  const activeIndex = assays.findIndex((assay) => assay.id === activeId);
  if (activeIndex <= 0) return assays;
  return [assays[activeIndex], ...assays.slice(0, activeIndex), ...assays.slice(activeIndex + 1)];
}

function decision(id, tier, label, reason, routeId, state, measurementId) {
  const result = { id, tier, label, reason, routeId, state };
  if (measurementId) result.measurementId = measurementId;
  return result;
}

function conformanceDecision(id, tier, label, reason, routeId, measurementId) {
  return { ...decision(id, tier, label, reason, routeId, 'needs-attention', measurementId), source: 'conformance' };
}

function conformanceDecisions(input, knownIds) {
  const report = object(input);
  const entries = [];
  const assayReports = Array.isArray(report.assays) ? report.assays : [];
  assayReports.forEach((assayReport, assayIndex) => {
    const reportObject = object(assayReport);
    const measurementId = typeof reportObject.id === 'string' ? reportObject.id : null;
    // A report can outlive a deletion. It has no current measurement owner,
    // so it must not turn into a generic route that could edit the active
    // measurement; discard it until a fresh conformance projection replaces
    // the stale record.
    if (!measurementId || !knownIds.has(measurementId)) return;
    const issues = Array.isArray(reportObject.issues) ? reportObject.issues : [];
    issues.forEach((issue, issueIndex) => {
      const item = object(issue);
      const classified = classifyConformanceIssue(item);
      const tier = classified.tier;
      const message = experimentMapText(item.message) || 'Review this planner check.';
      entries.push({
        order: entries.length,
        tier,
        value: conformanceDecision(
          `conformance:${measurementId || 'study'}:${assayIndex}:${issueIndex}`,
          tier,
          measurementId ? 'Review measurement planner check' : 'Review planner check',
          message,
          classified.routeId,
          measurementId
        ),
      });
    });
  });

  const crossAssayIssues = Array.isArray(report.crossAssayIssues) ? report.crossAssayIssues : [];
  crossAssayIssues.forEach((issue, index) => {
    const item = object(issue);
    const classified = classifyConformanceIssue(item);
    const tier = classified.tier;
    entries.push({
      order: entries.length,
      tier,
      value: conformanceDecision(
        `conformance:study:cross:${index}`,
        tier,
        'Review study planner check',
        experimentMapText(item.message) || 'Review this planner check.',
        classified.routeId
      ),
    });
  });

  return entries
    .sort((left, right) => TIER_ORDER.get(left.tier) - TIER_ORDER.get(right.tier) || left.order - right.order)
    .map((entry) => entry.value);
}

/**
 * Project a study into the UI-neutral Study map. `inputs` is optional so the
 * projection is useful before KB/conformance has loaded; pass
 * `{ conformance, workflow }` when those existing snapshots are available.
 * Neither input is changed, and workflow is deliberately not used to decide
 * orientation: its progress states are a consumer of this map, not a second
 * priority authority.
 */
export function buildExperimentMap(experiment, inputs = {}) {
  const exp = object(experiment);
  const options = object(inputs);
  const context = object(exp.studyContext);
  const provenance = object(exp.provenance);
  const slots = object(provenance.slots);
  const skipped = Array.isArray(provenance.skipped) ? provenance.skipped : [];
  const assays = validAssays(exp);
  const knownIds = new Set(assays.map((assay) => assay.id));

  const questionValue = experimentMapText(exp.researchQuestion);
  const systemValue = experimentMapText(context.system);
  const unitValue = experimentMapText(context.experimentalUnit);
  const mode = ['not-decided', 'groups', 'observational'].includes(context.comparisonMode)
    ? context.comparisonMode
    : 'not-decided';
  const groups = unionGroupLevels(assays);

  const question = {
    value: questionValue,
    state: stateFor(questionValue, slots, ['researchQuestion'], skipped, ['research-question', 'researchQuestion']),
  };
  const system = {
    value: systemValue,
    state: stateFor(systemValue, slots, ['studyContext.system'], skipped, ['system', 'studyContext.system']),
  };
  const modeState = stateFor(
    mode === 'not-decided' ? '' : mode,
    slots,
    ['studyContext.comparisonMode'],
    skipped,
    ['comparison-mode', 'studyContext.comparisonMode']
  );
  // Whether the study has said groups vs. observational is the study-shape
  // decision (modeState above); whether any given measurement HAS its groups
  // is a per-measurement decision (the measurement-groups:<id> loop below).
  // There is no separate study-wide "has groups" state any more -- see
  // unionGroupLevels's comment.
  const comparison = { mode, groups, state: modeState };
  const experimentalUnit = {
    value: unitValue,
    state: stateFor(
      unitValue,
      slots,
      ['studyContext.experimentalUnit'],
      skipped,
      ['experimental-unit', 'studyContext.experimentalUnit']
    ),
  };

  const measurements = assays.map((assay, index) => {
    const design = object(assay.design);
    const acquisition = object(assay.acquisition);
    const assayGroups = levels(object(design.groups).levels);
    const state = measurementState(assay, slots, skipped, index);
    return {
      id: assay.id,
      label: measurementLabel(assay, index),
      readout: experimentMapText(assay.readoutText) || experimentMapText(assay.readout),
      specimenSummary: specimenSummary(assay),
      biologicalReplicates: design.biologicalReplicates ?? null,
      technicalReplicates: design.technicalReplicates ?? null,
      modality: experimentMapText(acquisition.modality),
      groups: assayGroups,
      state,
    };
  });

  const byId = new Map(measurements.map((measurement) => [measurement.id, measurement]));
  const decisions = [];
  if (question.state !== 'answered') {
    decisions.push(decision('research-question', 'study-shape', 'Describe the research question', 'The study map needs the question this work will answer.', 'home', question.state));
  }
  if (system.state !== 'answered') {
    decisions.push(decision('system', 'study-shape', 'Describe the system or material', 'Name the organism, material, sample, surface, or system being studied.', 'home', system.state));
  }
  if (modeState !== 'answered') {
    decisions.push(decision('comparison-mode', 'study-shape', 'Choose a comparison structure', 'Say whether this study compares groups or is observational.', 'home', modeState));
  }
  // A groups study whose measurements have no groups yet is already covered
  // per-measurement below (measurement-groups:<id>) -- no separate study-wide
  // "add comparison groups" decision.
  const undefinedMeasurements = measurements.filter((measurement) => measurement.state !== 'answered');
  if (measurements.length === 0) {
    decisions.push(decision('measurement-definition', 'study-shape', 'Define a measurement', 'Add a named measurement and what it will observe.', 'study', 'missing'));
  } else {
    for (const measurement of undefinedMeasurements) {
      decisions.push(decision(`measurement-definition:${measurement.id}`, 'study-shape', `Define ${measurement.label}`, 'A measurement needs both a name and a readout or intended observation.', 'study', measurement.state, measurement.id));
    }
  }
  if (experimentalUnit.state !== 'answered') {
    decisions.push(decision('experimental-unit', 'study-shape', 'Define the independent experimental unit', 'State what is independently assigned or sampled.', 'home', experimentalUnit.state));
  }

  for (const assay of orderedMeasurements(exp, assays)) {
    const measurement = byId.get(assay.id);
    const design = object(assay.design);
    const assayGroups = levels(object(design.groups).levels);
    const groupState =
      mode === 'groups'
        ? stateFor(assayGroups, slots, [`assay:${assay.id}.design.groups`], skipped, [`measurement-groups:${assay.id}`, `assay:${assay.id}.design.groups`])
        : 'answered';
    if (groupState !== 'answered') {
      decisions.push(decision(`measurement-groups:${assay.id}`, 'measurement-design', `Define groups or factors for ${measurement.label}`, 'This measurement needs its own design definition.', 'design', groupState, assay.id));
    }

    const biologicalReplicates = design.biologicalReplicates;
    const replicateState = stateFor(
      biologicalReplicates,
      slots,
      [`assay:${assay.id}.design.biologicalReplicates`],
      skipped,
      [`biological-replicates:${assay.id}`, `assay:${assay.id}.design.biologicalReplicates`]
    );
    if (replicateState !== 'answered') {
      decisions.push(decision(`biological-replicates:${assay.id}`, 'measurement-design', `Decide biological replicates for ${measurement.label}`, 'State the number of independent or biological replicates.', 'design', replicateState, assay.id));
    }

    const modality = experimentMapText(object(assay.acquisition).modality);
    const modalityState = stateFor(
      modality,
      slots,
      [`assay:${assay.id}.acquisition.modality`],
      skipped,
      [`modality:${assay.id}`, `assay:${assay.id}.acquisition.modality`]
    );
    if (modalityState !== 'answered') {
      decisions.push(decision(`modality:${assay.id}`, 'before-acquisition', `Choose an acquisition method for ${measurement.label}`, 'Describe how this measurement will be acquired.', 'panel', modalityState, assay.id));
    }
  }

  decisions.push(...conformanceDecisions(options.conformance, knownIds));

  const orientationStates = [question.state, system.state, comparison.state, experimentalUnit.state];
  const measurementOrientationState = measurements.some((measurement) => measurement.state === 'answered')
    ? 'answered'
    : measurements.some((measurement) => measurement.state === 'provisional')
      ? 'provisional'
      : 'missing';
  orientationStates.splice(3, 0, measurementOrientationState);
  const answered = orientationStates.filter((state) => state === 'answered').length;
  const orientation = {
    answered,
    total: 5,
    state: orientationStates.includes('needs-attention')
      ? 'needs-attention'
      : answered === 5
        ? 'answered'
        : orientationStates.includes('provisional')
          ? 'provisional'
          : 'missing',
  };

  return {
    question,
    system,
    comparison,
    experimentalUnit,
    measurements,
    decisions,
    nextDecision: decisions[0] || null,
    orientation,
  };
}
