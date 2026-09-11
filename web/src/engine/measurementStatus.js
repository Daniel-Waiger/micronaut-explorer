// A measurement's status, honestly split into the three questions that used
// to be crammed into one word.
//
// Three engines already describe how finished a measurement is, each
// answering a different question: experimentMap (is it even DEFINED),
// decisionTriage (does its PLAN still have an open decision), and conformance
// (do its export CHECKS pass). This module does not replace any of them --
// it reads their existing outputs and reports each answer on its own scoped
// axis, rather than collapsing all three into a single ready/not-ready word.
//
//   definition   draft | provisional | defined       <- measurement.state alone
//   plan         open | needs-decision | ready        <- triage items this measurement owns
//   conformance  not-checked | blocked | needs-review | passes  <- conformance.assays[i].readiness, verbatim
//
// `plan` cannot be judged before the measurement is `defined`: it reads
// `open` until then, regardless of triage. Once defined, it is
// `needs-decision` while some triage item this measurement owns is still
// open, else `ready`. "Ready to acquire" is the label of plan:ready and of
// nothing else -- it describes the plan's completeness, never the science,
// and never the export gate (that is conformance's job, and conformance
// already owns issue severity; this module reads its verdict verbatim and
// never re-derives it).
//
// `headline` is the first of the three axes (in the fixed order
// definition -> plan -> conformance) that is not already at its best status;
// if all three are, the headline is conformance:passes. `tone` is the
// headline's tone, one of ok | attention | progress | neutral, for a
// consumer that wants a single colour without reimplementing this ordering.
//
// Pure and TOTAL: malformed input degrades to the all-lowest record
// (headline definition:draft), never throws.

export const MEASUREMENT_STATUS_SCOPES = Object.freeze(['definition', 'plan', 'conformance']);

export const MEASUREMENT_STATUS_STATUSES = Object.freeze({
  definition: Object.freeze(['draft', 'provisional', 'defined']),
  plan: Object.freeze(['open', 'needs-decision', 'ready']),
  conformance: Object.freeze(['not-checked', 'blocked', 'needs-review', 'passes']),
});

const MEASUREMENT_STATUS_TOP = Object.freeze({ definition: 'defined', plan: 'ready', conformance: 'passes' });

const MEASUREMENT_STATUS_SCOPE_TITLES = Object.freeze({
  definition: 'Definition',
  plan: 'Plan',
  conformance: 'Conformance',
});

export const MEASUREMENT_STATUS_LABELS = Object.freeze({
  definition: Object.freeze({
    draft: 'Draft',
    provisional: 'Provisionally defined',
    defined: 'Defined',
  }),
  plan: Object.freeze({
    open: 'Plan open',
    'needs-decision': 'Needs a decision',
    ready: 'Ready to acquire',
  }),
  conformance: Object.freeze({
    'not-checked': 'Not checked',
    blocked: 'Blocked',
    'needs-review': 'Needs review',
    passes: 'Checks pass',
  }),
});

export const MEASUREMENT_STATUS_TONES = Object.freeze({
  definition: Object.freeze({ draft: 'neutral', provisional: 'progress', defined: 'ok' }),
  plan: Object.freeze({ open: 'neutral', 'needs-decision': 'attention', ready: 'ok' }),
  conformance: Object.freeze({
    'not-checked': 'neutral',
    blocked: 'attention',
    'needs-review': 'progress',
    passes: 'ok',
  }),
});

// Only triage items that OWN this measurement in the planner's own sense
// count against the plan axis: `source === 'map'` items whose tier is
// measurement-design or before-acquisition, keyed by `measurementId`.
// `source === 'conformance'` items (engine/decisionTriage.js conformanceItems)
// key themselves by `assayId`, not `measurementId`, and belong solely to the
// conformance axis -- matching `assayId` here as a fallback would re-import
// conformance issues into the plan scope and rebuild the double-reporting
// this split exists to end. `later` stays ignored, as it always has.
const MEASUREMENT_STATUS_PLAN_TIERS = new Set(['measurement-design', 'before-acquisition']);

export const MEASUREMENT_STATUS_FILTERS = Object.freeze(
  MEASUREMENT_STATUS_SCOPES.flatMap((scope) =>
    MEASUREMENT_STATUS_STATUSES[scope].map((status) =>
      Object.freeze({
        value: `${scope}:${status}`,
        label: `${MEASUREMENT_STATUS_SCOPE_TITLES[scope]}: ${MEASUREMENT_STATUS_LABELS[scope][status]}`,
      })
    )
  )
);

function measurementStatusRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function measurementStatusText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function measurementStatusDefinition(state) {
  if (state === 'answered') return 'defined';
  if (state === 'provisional') return 'provisional';
  // `missing` and anything else (including the dead `needs-attention` value
  // experimentMap.measurementState never actually emits) fold into `draft`.
  return 'draft';
}

function measurementStatusPlanNeedsDecision(id, decisions) {
  const groups = measurementStatusRecord(decisions).groups;
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    const safeGroup = measurementStatusRecord(group);
    if (!MEASUREMENT_STATUS_PLAN_TIERS.has(measurementStatusText(safeGroup.tier))) continue;
    const items = safeGroup.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const safeItem = measurementStatusRecord(item);
      if (safeItem.source !== 'map') continue;
      if (measurementStatusText(safeItem.measurementId) === id) return true;
    }
  }
  return false;
}

function measurementStatusPlan(id, definition, decisions) {
  // The plan cannot be judged before the measurement exists.
  if (definition !== 'defined') return 'open';
  if (id && measurementStatusPlanNeedsDecision(id, decisions)) return 'needs-decision';
  return 'ready';
}

function measurementStatusConformance(id, conformance) {
  if (!id) return 'not-checked';
  const assays = measurementStatusRecord(conformance).assays;
  if (!Array.isArray(assays)) return 'not-checked';
  const report = assays.find((entry) => measurementStatusText(measurementStatusRecord(entry).id) === id);
  if (!report) return 'not-checked';
  // Read `readiness` verbatim -- conformance is the sole authority on issue
  // severity; this module never re-derives it.
  const readiness = measurementStatusRecord(report).readiness;
  if (readiness === 'blocked') return 'blocked';
  if (readiness === 'needs-review') return 'needs-review';
  if (readiness === 'ready') return 'passes';
  return 'not-checked';
}

function measurementStatusHeadline(record) {
  for (const scope of MEASUREMENT_STATUS_SCOPES) {
    if (record[scope] !== MEASUREMENT_STATUS_TOP[scope]) return { scope, status: record[scope] };
  }
  return { scope: 'conformance', status: 'passes' };
}

function measurementStatusToneFor(scope, status) {
  const scoped = MEASUREMENT_STATUS_TONES[scope];
  return (scoped && scoped[status]) || 'neutral';
}

/**
 * `measurement` is one entry from buildExperimentMap(...).measurements.
 * `decisions` is an optional decisionTriage(...) result; a `source: 'map'`
 * item in a measurement-design or before-acquisition group, owning this
 * measurement's id, demotes the plan axis to `needs-decision`.
 * `conformance` is an optional checkConformance(...) report; this
 * measurement's `conformance.assays[i].readiness` (if present) becomes the
 * conformance axis verbatim.
 *
 * Returns a frozen `{ definition, plan, conformance, headline: { scope,
 * status }, tone }` record. Total: never throws on malformed input.
 */
export function measurementStatus(measurement, { decisions, conformance } = {}) {
  const safe = measurementStatusRecord(measurement);
  const id = measurementStatusText(safe.id);

  const definition = measurementStatusDefinition(safe.state);
  const plan = measurementStatusPlan(id, definition, decisions);
  const conformanceStatus = measurementStatusConformance(id, conformance);

  const record = { definition, plan, conformance: conformanceStatus };
  const headline = Object.freeze(measurementStatusHeadline(record));
  const tone = measurementStatusToneFor(headline.scope, headline.status);

  return Object.freeze({ ...record, headline, tone });
}

export function measurementStatusLabel(scope, status) {
  const scoped = MEASUREMENT_STATUS_LABELS[scope];
  const label = scoped && scoped[status];
  return label || MEASUREMENT_STATUS_LABELS.definition.draft;
}
