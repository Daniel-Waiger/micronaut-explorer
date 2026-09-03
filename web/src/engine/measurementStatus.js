// The ONE user-facing status vocabulary for a measurement.
//
// Four engines already describe how finished a study is, each with its own
// words and its own good reason to exist: workflowProgress (per-route
// completion), conformance (the export gate), decisionTriage (when a gap
// matters), and experimentMap (orientation state). They all stay. What changed
// is that the researcher no longer meets four vocabularies at once -- the
// registry row and the measurement header show one badge, and this module is
// the single place the mapping lives.
//
// Deliberately three words, in the register of a project tracker rather than a
// grading scheme:
//
//   draft            nothing consequential decided yet
//   needs-decision   something is open, or a validator is unhappy
//   ready            every planner check this measurement owns is satisfied
//
// "ready" is scoped honestly: it means the planner's known requirements are
// met, never that the experiment is correct, powered, or approved. The label
// says "Ready to acquire" for exactly that reason -- it describes the plan's
// completeness, not the science.
//
// Pure and TOTAL: malformed input degrades to `draft`, never throws.

export const MEASUREMENT_STATUSES = Object.freeze(['draft', 'needs-decision', 'ready']);

const BLOCKING_ISSUE_SEVERITIES = new Set(['error', 'fatal']);

const MEASUREMENT_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  'needs-decision': 'Needs a decision',
  ready: 'Ready to acquire',
});

function measurementStatusRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function measurementStatusText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * `measurement` is one entry from buildExperimentMap(...).measurements.
 * `decisions` is an optional decisionTriage(...) result; when supplied, any
 * open decision owning this measurement forces `needs-decision`.
 * `conformance` is an optional checkConformance(...) report; a blocking issue
 * against this measurement likewise forces `needs-decision`.
 */
export function measurementStatus(measurement, { decisions, conformance } = {}) {
  const safe = measurementStatusRecord(measurement);
  const id = measurementStatusText(safe.id);

  // experimentMap already decided this measurement needs attention.
  if (safe.state === 'needs-attention') return 'needs-decision';

  if (id) {
    const groups = measurementStatusRecord(decisions).groups;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        const tier = measurementStatusText(measurementStatusRecord(group).tier);
        // A value that may truthfully wait (a date, an instrument label) is not
        // a reason to tell someone their measurement is unfinished.
        if (tier === 'later') continue;
        const items = measurementStatusRecord(group).items;
        if (!Array.isArray(items)) continue;
        if (items.some((item) => measurementStatusText(measurementStatusRecord(item).measurementId) === id)) return 'needs-decision';
      }
    }

    const assayReports = measurementStatusRecord(conformance).assays;
    if (Array.isArray(assayReports)) {
      const report = assayReports.find((entry) => measurementStatusText(measurementStatusRecord(entry).id) === id);
      const issues = measurementStatusRecord(report).issues;
      // Same two severities conformance itself counts as blocking
      // (BLOCKING_SEVERITIES in engine/conformance.js). This module reads that
      // verdict; it never re-decides it, so the export gate stays the one
      // authority on whether an artifact may leave.
      if (Array.isArray(issues) && issues.some((issue) => BLOCKING_ISSUE_SEVERITIES.has(measurementStatusRecord(issue).severity))) {
        return 'needs-decision';
      }
    }
  }

  // Nothing is open. `answered` from the map means this measurement has both
  // its identity and its design settled; anything less is still a draft.
  return safe.state === 'answered' ? 'ready' : 'draft';
}

export function measurementStatusLabel(status) {
  return MEASUREMENT_STATUS_LABELS[status] || MEASUREMENT_STATUS_LABELS.draft;
}
