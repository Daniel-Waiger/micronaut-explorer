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
  const assayLabel = text(facts.assay.label, 'the active assay');
  switch (stepId) {
    case 'home':
      return {
        outcome: 'Orient yourself before editing the study.',
        what: 'Home is the stable starting point for the study and its example actions.',
        why: 'It makes the current study state visible before you decide whether to explore or edit.',
        when: 'Use it when opening the app, returning from another route, or restarting the walkthrough.',
        how: 'Review the study at a glance, then move to the workflow step that answers your next question.',
        tryThis: 'Notice the study title and how many assays are currently available.',
        exampleSummary: `${plural(facts.assayCount, 'assay')} are currently included${facts.study.title ? ` in “${facts.study.title}”` : ''}.`,
      };
    case 'describe':
      return {
        outcome: 'Make the purpose and material of the active assay explicit.',
        what: 'Project captures what this assay measures and the specimen it uses.',
        why: 'A clear readout and specimen let later guidance stay tied to the actual assay.',
        when: 'Use it when defining an assay or when its biological target changes.',
        how: 'Choose the readout, then record the specimen details for the active assay.',
        tryThis: 'Compare the active assay’s readout and specimen with the assay you intend to run.',
        exampleSummary: `${assayLabel} currently measures ${text(facts.assay.readout.label, text(facts.assay.readout.text, 'an unanswered readout'))} in ${text(facts.assay.specimen.organism, 'an unspecified specimen')}.`,
      };
    case 'study':
      return {
        outcome: 'Keep the shared research question and group vocabulary coherent across assays.',
        what: 'Study holds the whole-study question and the shared treatment-group vocabulary.',
        why: 'Shared terms prevent assay plans and filenames from drifting apart.',
        when: 'Use it before adding assays or when the overarching experiment changes.',
        how: 'State the research question, then set the group terms every applicable assay should use.',
        tryThis: 'Read the question, then check that the shared group terms match your planned comparison.',
        exampleSummary: `${text(facts.study.researchQuestion, 'No research question is recorded yet.')} Shared groups: ${list(facts.study.groupVocabulary, 'none yet')}.`,
      };
    case 'design':
      return {
        outcome: 'Turn the active assay into an explicit, reviewable condition plan.',
        what: 'Design defines groups, crossed factors, replicate counts, and the resulting conditions.',
        why: 'The condition matrix is the source for downstream filename planning and review.',
        when: 'Use it after defining the assay and before collecting data.',
        how: 'Set groups and factors, then review the generated conditions rather than calculating them by hand.',
        tryThis: 'Inspect the generated condition count and make sure every intended comparison is represented.',
        exampleSummary: `${assayLabel} has ${plural(facts.assay.design.conditionCount, 'generated condition')}: groups ${list(facts.assay.design.groups, 'none yet')}; factors ${factorSummary(facts.assay.design.factors)}.`,
      };
    case 'microscopy':
      return {
        outcome: 'Connect acquisition choices with the assay’s panel and controls.',
        what: 'Microscopy records the acquisition modality and exposes the resolved panel and relevant controls.',
        why: 'Acquisition settings and controls need to be assessed together for an interpretable result.',
        when: 'Use it while planning imaging or when a marker, channel, or modality changes.',
        how: 'Choose the modality, review the resolved panel rows, and consider the controls the study projection provides.',
        tryThis: 'Check whether the displayed panel and control guidance fit the acquisition you will perform.',
        exampleSummary: `${assayLabel} uses ${text(facts.assay.modality, 'an unspecified modality')} with ${plural(facts.assay.panelRows.length, 'resolved panel row')} and ${plural(facts.controlCount, 'suggested control')}.`,
      };
    case 'naming':
      return {
        outcome: 'Produce consistent, traceable filenames from the current plan.',
        what: 'Naming combines the active assay’s effective naming fields with its generated condition rows.',
        why: 'Generated filenames make each acquired file traceable to its condition without manual reconstruction.',
        when: 'Use it once design and acquisition details are sufficiently specified to plan files.',
        how: 'Review the generated plan and correct source fields on their owning steps when a filename needs attention.',
        tryThis: 'Open a planned filename and confirm that its tokens describe a real acquisition condition.',
        exampleSummary: facts.assay.filenames[0] && facts.assay.filenames[0].filename
          ? `${assayLabel} currently plans “${facts.assay.filenames[0].filename}”.`
          : `${assayLabel} has no planned filename available yet.`,
      };
    case 'overview':
      return {
        outcome: 'Review the whole study’s current readiness before handoff or acquisition.',
        what: 'Overview brings the study document and conformance result together in one review surface.',
        why: 'A single readiness result makes outstanding issues visible without silently redefining them.',
        when: 'Use it before exporting, sharing, or treating the plan as ready to run.',
        how: 'Read the readiness result, then follow each issue back to the step that owns its source field.',
        tryThis: 'Review the readiness state and decide which listed issue should be resolved first.',
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
