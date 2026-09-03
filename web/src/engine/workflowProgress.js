// Pure workflow-progress projection. This module owns the small, stable
// vocabulary of progress states used by the shell; it does not own routing or
// decide whether a warning is safe. Conformance is the single source of
// readiness/placeholder severity and is passed in as an already-computed
// report.

import { assayView } from '../core/assay.js';
import { conditionIssues } from './conditions.js';
import { buildExperimentMap } from './experimentMap.js';
import { phaseQuestions } from './interview.js';

// Nouns, not steps. The nav used to list seven workspaces in a fixed order,
// which read as a seven-part exam a researcher could be failing at any moment.
// It now names three things a study HAS -- its shape, its measurements, and a
// review of both -- and the per-measurement work (samples & design,
// acquisition, data plan) lives inside whichever measurement you opened.
//
// The `microscopy`, `design` and `naming` workflow ids are retired from the
// visible workflow but remain valid route ids for hash compatibility; see
// core/router.js's ROUTE_ALIASES.
export const PRIMARY_WORKFLOW = Object.freeze([
  Object.freeze({ id: 'home', label: 'Study map' }),
  Object.freeze({ id: 'describe', label: 'Research brief' }),
  Object.freeze({ id: 'study', label: 'Measurements' }),
  Object.freeze({ id: 'measurement', label: 'Measurement' }),
  Object.freeze({ id: 'overview', label: 'Review' }),
]);

// Guide remains reachable but deliberately does not make the progress bar
// look incomplete: it is reference material, not a required workflow stage.
export const OPTIONAL_WORKFLOW = Object.freeze([
  Object.freeze({ id: 'guide', label: 'Guide' }),
]);

export const WORKFLOW_STATES = Object.freeze([
  'not-started',
  'in-progress',
  'needs-attention',
  'complete',
]);

function hasValue(value) {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');
}

function phaseProgress(questions, experiment, phase) {
  const fields = phaseQuestions(Array.isArray(questions) ? questions : [], experiment, phase);
  const answered = fields.filter((field) => field.confirmed).length;
  const hasDraftValue = fields.some((field) => hasValue(field.currentValue));

  if (fields.length === 0) {
    return { state: 'not-started', confirmed: 0, total: 0 };
  }
  if (answered === fields.length) {
    return { state: 'complete', confirmed: answered, total: fields.length };
  }
  if (answered > 0 || hasDraftValue) {
    return { state: 'in-progress', confirmed: answered, total: fields.length };
  }
  return { state: 'not-started', confirmed: 0, total: fields.length };
}

function designProgress(design) {
  const issues = conditionIssues(design || {});
  const groups = design && design.groups && Array.isArray(design.groups.levels) ? design.groups.levels : [];
  const factors = design && Array.isArray(design.factors) ? design.factors : [];
  const hasPlan =
    groups.length > 0 ||
    factors.length > 0 ||
    hasValue(design && design.biologicalReplicates) ||
    hasValue(design && design.technicalReplicates) ||
    hasValue(design && design.idScheme);

  // conditionIssues is the existing design validator. Any issue deserves a
  // visible review state; this module never recasts issue severities.
  if (issues.length > 0) return { state: 'needs-attention', issueCount: issues.length };
  return { state: hasPlan ? 'complete' : 'not-started', issueCount: 0 };
}

function readinessState(readiness) {
  if (readiness === 'ready') return 'complete';
  if (readiness === 'needs-review' || readiness === 'blocked') return 'needs-attention';
  return 'not-started';
}

function orientationProgress(map) {
  const orientation = map && typeof map.orientation === 'object' ? map.orientation : {};
  const answered = Number.isInteger(orientation.answered) ? orientation.answered : 0;
  const total = Number.isInteger(orientation.total) ? orientation.total : 0;

  if (orientation.state === 'needs-attention') return 'needs-attention';
  if (orientation.state === 'answered' || (total > 0 && answered >= total)) return 'complete';
  // A skipped/provisional map answer is still an intentional orientation
  // action. Likewise, some (but not all) answered map facts make the map
  // in-progress even though its aggregate map state remains `missing`.
  if (orientation.state === 'provisional' || answered > 0) return 'in-progress';
  return 'not-started';
}

function hasAssayContent(assay) {
  if (!assay || typeof assay !== 'object') return false;
  // An assay id is schema bookkeeping, not progress. Every newly created
  // study has one empty, identified assay, so it must not turn Study into
  // "complete" before the user has entered any actual assay information.
  return Object.entries(assay).some(([key, value]) => key !== 'id' && hasContent(value));
}

function hasContent(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some((child) => hasContent(child, seen));
  }
  return hasValue(value);
}

function anyAssayHasGroups(assays) {
  return assays.some((assay) => {
    const levels = assay && assay.design && assay.design.groups && assay.design.groups.levels;
    return Array.isArray(levels) && levels.some(hasValue);
  });
}

function studyProgress(experiment, conformance, assays) {
  const hasResearchQuestion = hasValue(experiment && experiment.researchQuestion);
  const hasGroups = anyAssayHasGroups(assays);
  const allAssaysHaveContent = assays.length > 0 && assays.every(hasAssayContent);
  const crossAssayIssues = Array.isArray(conformance && conformance.crossAssayIssues)
    ? conformance.crossAssayIssues
    : [];

  // Cross-assay validation belongs to conformance (and the Study screen),
  // so consume its existing output rather than rerunning studyNameIssues or
  // trying to reinterpret severities here.
  if (crossAssayIssues.length > 0) return 'needs-attention';
  if (hasResearchQuestion && hasGroups && allAssaysHaveContent) return 'complete';
  if (hasResearchQuestion || hasGroups || assays.some(hasAssayContent)) return 'in-progress';
  return 'not-started';
}

function namingProgress(view, report) {
  const relevantIssues = Array.isArray(report && report.issues)
    ? report.issues.filter((issue) => ['naming', 'incomplete', 'path'].includes(issue.section))
    : [];
  if (relevantIssues.length > 0) {
    // The conformance report has already classified the issue. Its presence
    // is enough to route the user here without another severity/placeholder
    // implementation in the progress layer.
    return { state: 'needs-attention', issueCount: relevantIssues.length };
  }
  const fields = view && view.naming && view.naming.fields;
  return {
    state: fields && Object.values(fields).some(hasValue) ? 'complete' : 'not-started',
    issueCount: 0,
  };
}

function aggregate(states) {
  if (states.length === 0) return 'not-started';
  if (states.every((state) => state === 'complete')) return 'complete';
  if (states.includes('needs-attention')) return 'needs-attention';
  if (states.includes('in-progress')) return 'in-progress';
  return 'not-started';
}

function reportForAssay(conformance, assayId) {
  const reports = conformance && Array.isArray(conformance.assays) ? conformance.assays : [];
  return reports.find((report) => report && report.id === assayId) || null;
}

/**
 * Derive study and assay progress from the current experiment, an existing
 * conformance report, and the already-loaded question bank.
 *
 * The return value is deterministic and intentionally UI-neutral:
 * `{ map, primary, optional, assays, summary }`. `map` is the one Study-map
 * snapshot built for this progress projection; consumers must use its
 * decisions and nextDecision rather than recreate their ordering. `primary`
 * follows the ordered five-stage workflow; `optional` is Guide and must not
 * contribute to the summary. Per-assay `overview` consumes conformance's
 * `readiness` verbatim, and the study Overview mirrors the whole-study
 * readiness verbatim.
 */
export function deriveWorkflowProgress(experiment, conformance, questions = []) {
  const exp = experiment && typeof experiment === 'object' ? experiment : {};
  const map = buildExperimentMap(exp, { conformance });
  const assays = Array.isArray(exp.assays) ? exp.assays : [];
  const perAssay = assays.map((assay, index) => {
    const view = assayView(exp, assay && assay.id);
    const report = reportForAssay(conformance, assay && assay.id);
    const project = phaseProgress(questions, view, 'project');
    const microscopy = phaseProgress(questions, view, 'microscopy');
    const design = designProgress(view.design);
    const naming = namingProgress(view, report);
    const overview = { state: readinessState(report && report.readiness), readiness: report && report.readiness };

    // `measurement` is the composed page's own state: the three per-measurement
    // workspaces are sections of one route now, so their states aggregate into
    // one. design/microscopy/naming stay individually addressable because the
    // guided walkthrough and the per-assay tree still speak about them by name.
    const measurement = { state: aggregate([design.state, microscopy.state, naming.state]) };

    return {
      id: assay && assay.id,
      label: (assay && assay.label) || `Assay ${index + 1}`,
      readiness: report && report.readiness,
      steps: { project, design, microscopy, naming, measurement, overview },
      state: aggregate([project.state, design.state, microscopy.state, naming.state, overview.state]),
    };
  });

  const byStep = (step) => perAssay.map((assay) => assay.steps[step].state);
  const primary = [
    { ...PRIMARY_WORKFLOW[0], state: orientationProgress(map) },
    { ...PRIMARY_WORKFLOW[1], state: aggregate(byStep('project')) },
    { ...PRIMARY_WORKFLOW[2], state: studyProgress(exp, conformance, assays) },
    { ...PRIMARY_WORKFLOW[3], state: aggregate(byStep('measurement')) },
    { ...PRIMARY_WORKFLOW[4], state: readinessState(conformance && conformance.readiness), readiness: conformance && conformance.readiness },
  ];
  const complete = primary.filter((step) => step.state === 'complete').length;

  return {
    map,
    primary,
    optional: OPTIONAL_WORKFLOW.map((step) => ({ ...step })),
    assays: perAssay,
    summary: { complete, total: primary.length, state: aggregate(primary.map((step) => step.state)) },
  };
}
