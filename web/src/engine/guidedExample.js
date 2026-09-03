// Contextual content for the optional guided example. This is deliberately a
// projection over the document and conformance producers, not another set of
// study rules: every dynamic fact comes from those two canonical models.

import { buildStudyDocument } from './studydoc.js';
import { checkConformance } from './conformance.js';

const EMPTY_ASSAY = Object.freeze({
  id: '',
  label: '',
  readout: Object.freeze({ text: '', state: 'unanswered', canonical: null, label: null }),
  modality: '',
  panelRows: Object.freeze([]),
  specimen: Object.freeze({ organism: '', sampleType: '', preparation: '' }),
  design: Object.freeze({
    groups: Object.freeze([]),
    factors: Object.freeze([]),
    biologicalReplicates: null,
    technicalReplicates: null,
    conditionCount: 0,
    issues: Object.freeze([]),
  }),
  controls: Object.freeze({ panel: Object.freeze([]), readout: Object.freeze([]), readoutMessage: '' }),
  namingFields: Object.freeze({}),
  filenames: Object.freeze([]),
});

const EMPTY_DOCUMENT = Object.freeze({
  study: Object.freeze({ title: '', researchQuestion: '', groupVocabulary: Object.freeze([]) }),
  assays: Object.freeze([]),
});

const EMPTY_CONFORMANCE = Object.freeze({
  readiness: 'needs-review',
  counts: Object.freeze({ blocked: 0, needsReview: 0, total: 0 }),
  issueCount: 0,
  assays: Object.freeze([]),
  crossAssayIssues: Object.freeze([]),
});

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function list(values, fallback) {
  const present = (Array.isArray(values) ? values : []).filter((value) => text(value));
  return present.length > 0 ? present.join(', ') : fallback;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function normalizeWorkflow(primaryWorkflow) {
  if (!Array.isArray(primaryWorkflow)) return [];
  return primaryWorkflow
    .filter((step) => step && typeof step.id === 'string' && step.id.trim())
    .map((step) => ({ id: step.id, label: text(step.label, step.id) }));
}

function safeDocument(experiment, kb, config, baseTemplate) {
  try {
    return buildStudyDocument(experiment, kb, config, baseTemplate) || EMPTY_DOCUMENT;
  } catch {
    return EMPTY_DOCUMENT;
  }
}

function safeConformance(experiment, kb, config, baseTemplate) {
  try {
    return checkConformance(experiment, kb, config, baseTemplate) || EMPTY_CONFORMANCE;
  } catch {
    return EMPTY_CONFORMANCE;
  }
}

function currentAssay(document, experiment) {
  const assays = Array.isArray(document.assays) ? document.assays : [];
  const activeId = experiment && typeof experiment === 'object' ? experiment.activeAssayId : '';
  return assays.find((assay) => assay && assay.id === activeId) || assays[0] || EMPTY_ASSAY;
}

function factorSummary(factors) {
  const readable = (Array.isArray(factors) ? factors : [])
    .filter((factor) => factor && text(factor.name))
    .map((factor) => `${text(factor.name)} (${list(factor.levels, 'no levels yet')})`);
  return readable.length > 0 ? readable.join('; ') : 'no additional factors';
}

function templateFor(stepId, facts) {
  const assayLabel = text(facts.assay.label, 'the active measurement');
  switch (stepId) {
    case 'home':
      return {
        outcome: 'Understand the study’s shape before planning its details.',
        what: 'Study map establishes the research question, system or material, comparison structure, measurements, and experimental unit.',
        why: 'A study contains measurements; each measurement then has its own Samples & design, Acquisition, and Data plan.',
        when: 'Use it when opening the app, returning from another route, or restarting the walkthrough.',
        how: 'Review the study at a glance, then move to the workspace that owns your next question.',
        tryThis: 'Notice the study title and how many measurements are currently included.',
        exampleSummary: `${plural(facts.assayCount, 'measurement')} are currently included${facts.study.title ? ` in “${facts.study.title}”` : ''}.`,
      };
    case 'describe':
      return {
        outcome: 'Make the shared purpose and active measurement details explicit.',
        what: 'Research brief holds the study narrative and records what the active measurement will observe and its specimen or system.',
        why: 'A clear readout and specimen let later guidance stay tied to the active measurement.',
        when: 'Use it when defining a measurement or when its readout or specimen changes.',
        how: 'Describe the shared question, then choose the readout and record specimen details for the active measurement.',
        tryThis: 'Compare the active measurement’s readout and specimen with the measurement you intend to plan.',
        exampleSummary: `${assayLabel} currently measures ${text(facts.assay.readout.label, text(facts.assay.readout.text, 'an unanswered readout'))} in ${text(facts.assay.specimen.organism, 'an unspecified specimen')}.`,
      };
    case 'study':
      return {
        outcome: 'Keep the study’s measurements and comparison labels coherent.',
        what: 'Measurements lists the observations or analyses in the study and offers reusable comparison labels when helpful.',
        why: 'Reusable labels keep applicable measurement plans and filenames aligned without overwriting a custom design.',
        when: 'Use it when adding or naming measurements, or when the study’s comparison structure changes.',
        how: 'State the research question, then name each measurement and add comparison labels only when they apply.',
        tryThis: 'Read the question, then check that the comparison labels match your planned comparison or observational study.',
        exampleSummary: `${text(facts.study.researchQuestion, 'No research question is recorded yet.')} Comparison labels: ${list(facts.study.groupVocabulary, 'none yet')}.`,
      };
    // One case, because Samples & design, Acquisition and Data plan are one
    // page now (ui/steps/measurement.js). Splitting the walkthrough across
    // three stops for what a researcher sees as one screen would reintroduce
    // exactly the step-sequence framing the restructure removed.
    case 'measurement':
      return {
        outcome: 'Turn one measurement into a reviewable plan: its samples, its acquisition, and the files it will produce.',
        what: 'A measurement page holds Samples & design (groups, factors, replicates), Acquisition (modality, panel, controls), and Data plan (the filenames those choices generate).',
        why: 'These three decide each other. The condition matrix feeds the filenames; the panel decides which controls you need. Seeing them apart hides that.',
        when: 'Use it after the measurement exists and before you collect any data.',
        how: 'Work down the page. Set groups and factors, choose the modality and panel, then read the generated filenames rather than composing them by hand.',
        tryThis: 'Change one group label and watch the planned filenames below it change with it.',
        exampleSummary: `${assayLabel}: ${plural(facts.assay.design.conditionCount, 'generated condition')} from groups ${list(facts.assay.design.groups, 'none yet')}; ${text(facts.assay.modality, 'an unspecified modality')} with ${plural(facts.assay.panelRows.length, 'resolved panel row')} and ${plural(facts.controlCount, 'suggested control')}; ${
          facts.assay.filenames[0] && facts.assay.filenames[0].filename
            ? `planning “${facts.assay.filenames[0].filename}”`
            : 'no planned filename yet'
        }.`,
      };
    case 'overview':
      return {
        outcome: 'Review the whole study’s current readiness before handoff or acquisition.',
        what: 'Review brings the study map, document, and conformance result together in one review surface.',
        why: 'A single readiness result makes outstanding issues visible without silently redefining them.',
        when: 'Use it before exporting, sharing, or treating the plan as ready to run.',
        how: 'Read the readiness result, then follow each issue back to the step that owns its source field. Use the project-backup button in this focused walkthrough panel when you want a durable copy of the whole study.',
        tryThis: 'Review the readiness state, decide which listed issue should be resolved first, then download a project backup if you want to keep this version.',
        exampleSummary: `This study is ${text(facts.conformance.readiness, 'not assessed')} with ${plural(facts.conformance.issueCount, 'reported issue')}.`,
      };
    default:
      return {
        outcome: 'Understand the current workflow step.',
        what: 'This step contributes one part of the study plan.',
        why: 'Keeping each concern in its owning step makes the plan easier to review.',
        when: 'Use it whenever this part of the plan needs attention.',
        how: 'Review the current values, make the needed change, and continue through the workflow.',
        tryThis: 'Compare the current values with the plan you intend to run.',
        exampleSummary: 'This step is ready to explain the current study values.',
      };
  }
}

/**
 * Build fresh contextual content for a caller-supplied primary workflow.
 *
 * `primaryWorkflow` is injected so this module never becomes a second owner
 * of workflow order. `kb`, `namingConfig`, and `baseTemplate` are also
 * injected to keep this pure engine module independent of UI bootstrapping.
 */
export function buildGuidedExampleContent(experiment, options = {}) {
  const primaryWorkflow = normalizeWorkflow(options.primaryWorkflow);
  const config = options.namingConfig || options.config;
  const document = safeDocument(experiment, options.kb, config, options.baseTemplate);
  const conformance = safeConformance(experiment, options.kb, config, options.baseTemplate);
  const assay = currentAssay(document, experiment);
  const exampleLabel = experiment && experiment.meta && experiment.meta.origin === 'example'
    ? 'In this example'
    : 'In this study now';
  const facts = {
    study: document.study || EMPTY_DOCUMENT.study,
    assay,
    assayCount: Array.isArray(document.assays) ? document.assays.length : 0,
    controlCount: (Array.isArray(assay.controls && assay.controls.panel) ? assay.controls.panel.length : 0) +
      (Array.isArray(assay.controls && assay.controls.readout) ? assay.controls.readout.length : 0),
    conformance,
  };

  const steps = primaryWorkflow.map((workflowStep, index) => {
    const copy = templateFor(workflowStep.id, facts);
    const next = primaryWorkflow[index + 1] || null;
    return {
      stepId: workflowStep.id,
      title: workflowStep.label,
      ...copy,
      exampleLabel,
      nextStepId: next ? next.id : null,
      nextTitle: next ? next.label : null,
      // These producer values are exposed for renderers/tests that need
      // structured facts rather than a prose summary. They are not inferred
      // or revalidated here.
      facts: {
        study: facts.study,
        activeAssay: assay,
        assayCount: facts.assayCount,
        controlCount: facts.controlCount,
        conformance,
      },
    };
  });

  return {
    primaryWorkflow,
    studyDocument: document,
    conformance,
    activeAssay: assay,
    steps,
  };
}

/** Return one fresh step context without asking a UI consumer to own lookup. */
export function getGuidedExampleStep(experiment, stepId, options = {}) {
  return buildGuidedExampleContent(experiment, options).steps.find((step) => step.stepId === stepId) || null;
}
