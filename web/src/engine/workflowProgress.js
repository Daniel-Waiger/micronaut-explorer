// Pure workflow-progress projection. This module owns the small, stable
// vocabulary of progress states used by the shell; it does not own routing or
// decide whether a warning is safe. Conformance is the single source of
// readiness/placeholder severity and is passed in as an already-computed
// report.

import { assayView } from '../core/assay.js';
import { conditionIssues } from './conditions.js';
import { phaseQuestions } from './interview.js';

export const PRIMARY_WORKFLOW = Object.freeze([
  Object.freeze({ id: 'home', label: 'Home' }),
  Object.freeze({ id: 'describe', label: 'Project' }),
  Object.freeze({ id: 'study', label: 'Study' }),
  Object.freeze({ id: 'design', label: 'Design' }),
  Object.freeze({ id: 'microscopy', label: 'Microscopy' }),
  Object.freeze({ id: 'naming', label: 'Naming' }),
  Object.freeze({ id: 'overview', label: 'Overview' }),
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

function studyProgress(experiment, conformance, assays) {
  const groupLevels =
    experiment && experiment.groupVocabulary && Array.isArray(experiment.groupVocabulary.levels)
      ? experiment.groupVocabulary.levels
      : [];
  const hasResearchQuestion = hasValue(experiment && experiment.researchQuestion);
  const hasGroupVocabulary = groupLevels.some(hasValue);
  const allAssaysHaveContent = assays.length > 0 && assays.every(hasAssayContent);
  const crossAssayIssues = Array.isArray(conformance && conformance.crossAssayIssues)
    ? conformance.crossAssayIssues
    : [];

  // Cross-assay validation belongs to conformance (and the Study screen),
  // so consume its existing output rather than rerunning studyNameIssues or
  // trying to reinterpret severities here.
  if (crossAssayIssues.length > 0) return 'needs-attention';
  if (hasResearchQuestion && hasGroupVocabulary && allAssaysHaveContent) return 'complete';
  if (hasResearchQuestion || hasGroupVocabulary || assays.some(hasAssayContent)) return 'in-progress';
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
 * `{ primary, optional, assays, summary }`. `primary` follows the ordered
 * seven-stage workflow; `optional` is Guide and must not contribute to the
 * summary. Per-assay `overview` consumes conformance's `readiness` verbatim,
 * and the study Overview mirrors the whole-study readiness verbatim.
 */
export function deriveWorkflowProgress(experiment, conformance, questions = []) {
  const exp = experiment && typeof experiment === 'object' ? experiment : {};
  const assays = Array.isArray(exp.assays) ? exp.assays : [];
  const perAssay = assays.map((assay, index) => {
    const view = assayView(exp, assay && assay.id);
    const report = reportForAssay(conformance, assay && assay.id);
    const project = phaseProgress(questions, view, 'project');
    const microscopy = phaseProgress(questions, view, 'microscopy');
    const design = designProgress(view.design);
    const naming = namingProgress(view, report);
    const overview = { state: readinessState(report && report.readiness), readiness: report && report.readiness };

    return {
      id: assay && assay.id,
      label: (assay && assay.label) || `Assay ${index + 1}`,
      readiness: report && report.readiness,
      steps: { project, design, microscopy, naming, overview },
      state: aggregate([project.state, design.state, microscopy.state, naming.state, overview.state]),
    };
  });

  const byStep = (step) => perAssay.map((assay) => assay.steps[step].state);
  const primary = [
    { ...PRIMARY_WORKFLOW[0], state: 'complete' },
    { ...PRIMARY_WORKFLOW[1], state: aggregate(byStep('project')) },
    { ...PRIMARY_WORKFLOW[2], state: studyProgress(exp, conformance, assays) },
    { ...PRIMARY_WORKFLOW[3], state: aggregate(byStep('design')) },
    { ...PRIMARY_WORKFLOW[4], state: aggregate(byStep('microscopy')) },
    { ...PRIMARY_WORKFLOW[5], state: aggregate(byStep('naming')) },
    { ...PRIMARY_WORKFLOW[6], state: readinessState(conformance && conformance.readiness), readiness: conformance && conformance.readiness },
  ];
  const complete = primary.filter((step) => step.state === 'complete').length;

  return {
    primary,
    optional: OPTIONAL_WORKFLOW.map((step) => ({ ...step })),
    assays: perAssay,
    summary: { complete, total: primary.length, state: aggregate(primary.map((step) => step.state)) },
  };
}
