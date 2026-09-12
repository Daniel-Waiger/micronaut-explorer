// Whole-study conformance gate. This module composes existing validation
// engines; it contains no DOM or UI imports.

import { assayView } from '../core/assay.js';
import { conditionIssues } from './conditions.js';
import { effectiveNamingFields, planFilenames, studyNameIssues } from './plan.js';
import { finalizeFields } from './naming.js';
import { DEFAULT_PROFILE, validateFields, validateTargetPath } from './validation.js';
import { flagPanelOverlaps, resolveMeasurementFluorophores } from './spectra.js';
import { normalizeSpilloverAcks } from './panelAssembly.js';
import { assayLabel } from './studydoc.js';
import { classifyConformanceIssue } from './decisionTriage.js';

function tagged(issues, section) {
  return issues.map((issue) => ({ ...issue, section }));
}

const BLOCKING_SEVERITIES = new Set(['error', 'fatal']);

/** True if `sev` is a severity that blocks export/readiness (`summarizeReadiness`'s own rule, exported so other modules never hand-roll the set). */
export function isBlockingSeverity(sev) {
  return BLOCKING_SEVERITIES.has(sev);
}

/**
 * Derive canonical readiness exactly once from existing issue severities.
 * Consumers must use this result rather than reinterpreting warning or
 * placeholder text themselves.
 */
function summarizeReadiness(issues) {
  let blocked = 0;
  let needsReview = 0;
  for (const issue of issues) {
    if (BLOCKING_SEVERITIES.has(issue && issue.severity)) blocked += 1;
    else needsReview += 1;
  }
  return {
    readiness: blocked > 0 ? 'blocked' : needsReview > 0 ? 'needs-review' : 'ready',
    counts: { blocked, needsReview, total: issues.length },
  };
}

/**
 * Identify required fields whose rendered value is still the naming
 * configuration's own default placeholder.
 */
function defaultPlaceholderIssues(finalized, config) {
  const defaults = (config && config.defaults) || {};
  const optionalFields = new Set((config && config.optionalFields) || []);
  const incomplete = [];

  // `finalizeFields` deliberately fills these values so the Name builder can
  // always show a useful preview. That is presentation, not evidence that a
  // required naming fact was supplied: a date sentinel passes date-format
  // validation and UNKNOWN is intentionally exempt from sample validation.
  // Report defaults here, at the readiness consumer, without changing the
  // preview-producing path.
  for (const [field, placeholder] of Object.entries(defaults)) {
    if (optionalFields.has(field)) continue;
    if (finalized[field] === undefined || String(finalized[field]) !== String(placeholder)) continue;
    incomplete.push({
      field,
      severity: 'warning',
      message: `${field} is not answered yet (still the placeholder '${finalized[field]}').`,
    });
  }
  return incomplete;
}

function splitNamingIssues(issues, incomplete) {
  const incompleteFields = new Set(incomplete.map((issue) => issue.field));
  const errors = [];
  for (const issue of issues) {
    // A default placeholder may trip a format validator (for example
    // UNKNOWN magnification). Its actionable state is incomplete, not an
    // invalid user answer, and defaultPlaceholderIssues already reported it.
    if (!incompleteFields.has(issue.field)) errors.push(issue);
  }
  return errors;
}

/**
 * Return `{readiness, counts, pass, issueCount, assays, crossAssayIssues}`.
 * `readiness` is authoritative: `ready` has no issues, `needs-review` has
 * warnings/incomplete values, and `blocked` has an error/fatal. `pass` is the
 * temporary compatibility alias for "not blocked".
 *
 * TOTAL: malformed input yields a zero-assay report rather than throwing.
 */
export function checkConformance(experiment, kb, config, baseTemplate) {
  const exp = experiment && typeof experiment === 'object' ? experiment : {};
  const assays = Array.isArray(exp.assays) ? exp.assays : [];
  const markerIndex = kb && kb.index;
  const markersKb = kb && kb.markersKb;
  const spectra = kb && kb.spectra;
  const overlapRules = kb && kb.overlapRules;

  const assayReports = assays.map((assay, index) => {
    const view = assayView(exp, assay.id);
    const design = view.design || {};
    const issues = [];

    issues.push(...tagged(conditionIssues(design), 'design'));
    const finalized = finalizeFields('experiment.tif', effectiveNamingFields(view), config);
    const incomplete = defaultPlaceholderIssues(finalized, config);
    const namingErrors = splitNamingIssues(validateFields(finalized, DEFAULT_PROFILE), incomplete);
    issues.push(...tagged(namingErrors, 'naming'));
    issues.push(...tagged(incomplete, 'incomplete'));

    const pathMessages = new Map();
    // V4-N1: planFilenames is the one place a group/factor level reaches
    // naming.js, so it is also the one place a sanitization-loss issue for
    // one (e.g. a non-Latin group level rendering invisibly as
    // 'UNSPECIFIED') can be computed -- fold its per-row `issues` in here,
    // deduped like the path-length warnings just above, so Review sees the
    // exact same message Design shows.
    const sanitizationMessages = new Map();
    for (const entry of planFilenames(view, config)) {
      if (!entry.filename) continue;
      for (const issue of validateTargetPath(entry.filename)) {
        pathMessages.set(issue.message, issue);
      }
      for (const issue of entry.issues || []) {
        sanitizationMessages.set(`${issue.field}|${issue.message}`, issue);
      }
    }
    issues.push(...tagged([...pathMessages.values()], 'path'));
    issues.push(...tagged([...sanitizationMessages.values()], 'naming'));

    // ONE resolver for both sources (R4-01): resolveMeasurementFluorophores
    // prefers Panel assembly's structured channels and falls back to the
    // free-text markers field only when there are no channels, so this gate
    // can no longer disagree with the Review screen (which drives the same
    // resolver) about which fluorophores this measurement uses.
    const { entries: overlapEntries } = resolveMeasurementFluorophores(view, {
      index: markerIndex,
      markersKb,
      spectra,
    });
    // Acknowledgements are keyed on the resolved entries' CANONICAL ids
    // (panelAssembly.js's spilloverPairKey / normalizeSpilloverAcks), matching
    // flagPanelOverlaps' own pairKey -- V3-N1: this is what makes the gate
    // clearable (a per-pair acknowledgement downgrades error to warning)
    // without making it silently disappear.
    const acknowledged = normalizeSpilloverAcks(view.panel && view.panel.spillover && view.panel.spillover.acknowledged);
    const flags = flagPanelOverlaps(overlapEntries, overlapRules, { acknowledged });
    issues.push(
      ...tagged(
        flags.map((flag) => ({
          field: flag.field,
          message: flag.message,
          severity: flag.severity,
          pairKey: flag.pairKey,
          ...(flag.acknowledged ? { acknowledged: true } : {}),
        })),
        'panel'
      )
    );

    const label = assayLabel(assay, index);
    // Attribute every issue back to its owning measurement (R4-04/R4-07) and
    // give it the same route/step identity Review's decisionTriage.js already
    // computes for its own consumption -- one classifier, shared, rather than
    // a second UI-side copy of routeForIssue's section->route mapping.
    const attributed = issues.map((issue) => {
      const classified = classifyConformanceIssue(issue);
      return {
        ...classified,
        assayId: assay.id,
        assayLabel: label,
        stepId: classified.routeId,
      };
    });

    return {
      id: assay.id,
      label,
      issues: attributed,
      ...summarizeReadiness(attributed),
    };
  });

  // Cross-assay issues (study-level naming clashes) belong to no single
  // measurement -- assayId/assayLabel are explicit `null` rather than absent,
  // so a consumer can tell "not measurement-scoped" from "attribution
  // forgotten". They still get a stepId/routeId from the same shared
  // classifier so Review can route them like any other issue.
  const crossAssayIssues = tagged(studyNameIssues(exp, config, baseTemplate), 'cross-assay').map((issue) => {
    const classified = classifyConformanceIssue(issue);
    return { ...classified, assayId: null, assayLabel: null, stepId: classified.routeId };
  });
  const allIssues = [...assayReports.flatMap((assay) => assay.issues), ...crossAssayIssues];
  const summary = summarizeReadiness(allIssues);
  return {
    ...summary,
    pass: summary.readiness !== 'blocked',
    issueCount: allIssues.length,
    assays: assayReports,
    crossAssayIssues,
  };
}
