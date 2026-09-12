// Consequence-based decision grouping for Review. This is deliberately a
// consumer of experimentMap and conformance rather than another readiness
// engine: its tiers answer when a decision matters, while conformance remains
// the sole owner of issue severity and export permission.

export const DECISION_TIERS = Object.freeze([
  'study-shape',
  'measurement-design',
  'before-acquisition',
  'later',
]);

const TIER_SET = new Set(DECISION_TIERS);

// Canonical conformance identities, never display text, determine tiers. The
// field sets deliberately include all fields emitted by the current producers
// plus the stable identities the map will expose for study context.
const STUDY_SHAPE_FIELDS = new Set([
  'researchQuestion',
  'research-question',
  'system',
  'studyContext.system',
  'comparisonMode',
  'comparison-mode',
  'assays',
  'readout',
  'readoutText',
  'experimentalUnit',
  'studyContext.experimentalUnit',
]);
const MEASUREMENT_DESIGN_FIELDS = new Set([
  'groups',
  'factors',
  'biologicalReplicates',
  'technicalReplicates',
  'idScheme',
  'controls',
]);
const BEFORE_ACQUISITION_FIELDS = new Set([
  'modality',
  'magnification',
  'markers',
  'panel',
  'target_path',
  'exptype',
]);
const LATER_FIELDS = new Set(['date', 'sample', 'instrument', 'instrumentLabel', 'timing', 'notes']);

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function tierForField(field, fallback = 'later') {
  if (STUDY_SHAPE_FIELDS.has(field)) return 'study-shape';
  if (MEASUREMENT_DESIGN_FIELDS.has(field)) return 'measurement-design';
  if (BEFORE_ACQUISITION_FIELDS.has(field)) return 'before-acquisition';
  if (LATER_FIELDS.has(field)) return 'later';
  return fallback;
}

function tierForMapDecision(decision) {
  if (TIER_SET.has(decision.tier)) return decision.tier;
  return tierForField(decision.id, tierForField(decision.field));
}

function routeForIssue(issue, tier) {
  // Keep a producer-supplied route intact. Existing conformance records have
  // no route, so the canonical section provides a stable default for Review.
  if (hasText(issue.routeId)) return issue.routeId;
  if (hasText(issue.route)) return issue.route;
  if (issue.section === 'design' || issue.section === 'controls') return 'design';
  if (issue.section === 'panel') return 'panel';
  if (issue.section === 'naming' || issue.section === 'incomplete' || issue.section === 'path') return 'naming';
  if (issue.section === 'cross-assay') return issue.field === 'exptype' ? 'naming' : 'study';
  return tier === 'study-shape' ? 'home' : null;
}

function assayIdForIssue(issue, fallback) {
  const safeIssue = asObject(issue);
  return Object.prototype.hasOwnProperty.call(safeIssue, 'assayId') ? safeIssue.assayId : fallback;
}

/**
 * Assign a display tier to one existing conformance issue without changing
 * the issue's severity, field, section, or producer-supplied destination.
 */
export function classifyConformanceIssue(rawIssue) {
  const issue = asObject(rawIssue);
  let tier;

  // Section is part of the producer's canonical identity. Design and panel
  // issues stay in their owning consequence class even if a future field name
  // overlaps another section's vocabulary.
  if (issue.section === 'design' || issue.section === 'controls') {
    tier = 'measurement-design';
  } else if (issue.section === 'panel' || issue.section === 'path') {
    tier = 'before-acquisition';
  } else {
    tier = tierForField(issue.field);
  }

  const routeId = routeForIssue(issue, tier);
  return {
    ...issue,
    tier,
    routeId,
  };
}

// Duplicate conformance items (same measurement, same check, same message)
// must never reach Review as two rows -- lesson 37 (a gate its own review
// cannot satisfy reads as broken) applies just as much to a decision that
// silently doubles as it does to one that silently vanishes. Key on the
// issue's own identity (assayId + section + field + message), NOT list
// position, since map order + per-assay + cross-assay concatenation is the
// one place two independently-correct producers could ever coincide. A
// cross-assay issue's `assayId` is explicit `null` (conformance.js); fold it
// into the same bucket as `undefined` so both read as "study-level", not as
// two different unscoped groups.
function conformanceDedupeKey(item) {
  const assayKey = item.assayId === null || item.assayId === undefined ? 'null' : item.assayId;
  return `${assayKey}|${item.section}|${item.field}|${item.message}`;
}

function conformanceItems(conformance) {
  const report = asObject(conformance);
  const items = [];
  const seen = new Set();
  const assays = Array.isArray(report.assays) ? report.assays : [];

  function pushDeduped(item) {
    const key = conformanceDedupeKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }

  for (const assay of assays) {
    const assayReport = asObject(assay);
    const issues = Array.isArray(assayReport.issues) ? assayReport.issues : [];
    for (const issue of issues) {
      // Spreading copies the issue, retaining its exact severity and section;
      // it never annotates the conformance object in place.
      pushDeduped({
        ...classifyConformanceIssue(issue),
        source: 'conformance',
        assayId: assayIdForIssue(issue, assayReport.id),
      });
    }
  }

  const crossAssayIssues = Array.isArray(report.crossAssayIssues) ? report.crossAssayIssues : [];
  for (const issue of crossAssayIssues) {
    pushDeduped({
      ...classifyConformanceIssue(issue),
      source: 'conformance',
      assayId: assayIdForIssue(issue, null),
    });
  }
  return items;
}

function mapItems(experimentMap) {
  const map = asObject(experimentMap);
  const decisions = Array.isArray(map.decisions) ? map.decisions : [];
  return decisions
    // experimentMap retains conformance decisions so it can choose the
    // authoritative nextDecision. Review instead consumes raw conformance:
    // it carries severity, section, and the report's real assay identity.
    .filter((decision) => decision && typeof decision === 'object' && decision.source !== 'conformance')
    .map((decision) => ({
      ...decision,
      tier: tierForMapDecision(decision),
      source: 'map',
    }));
}

/**
 * Combine the map's ordinary decisions with conformance exceptions in a
 * fixed, deterministic display order. Input order is preserved within each
 * tier: map order first, followed by per-assay conformance order and then
 * cross-assay order. No input is mutated.
 */
export function decisionTriage(experimentMap, conformance) {
  const buckets = new Map(DECISION_TIERS.map((tier) => [tier, []]));
  for (const item of [...mapItems(experimentMap), ...conformanceItems(conformance)]) {
    // Malformed map records cannot create a fifth UI group; the only safe
    // fallback is the least urgent fixed tier.
    const tier = TIER_SET.has(item.tier) ? item.tier : 'later';
    buckets.get(tier).push(item);
  }

  const groups = DECISION_TIERS.map((tier) => {
    const items = buckets.get(tier);
    return { tier, count: items.length, items };
  });
  const counts = Object.fromEntries(groups.map((group) => [group.tier, group.count]));
  counts.total = groups.reduce((total, group) => total + group.count, 0);

  return { groups, counts };
}
