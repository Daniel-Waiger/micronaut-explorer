// Controls tier (assay-tier commit 3): panel-derived and readout-specific
// control guidance, stored as DATA in web/kb/readouts.json + web/kb/controls.json
// and evaluated by the EXISTING predicate DSL (engine/predicate.js) -- the
// third independent use of that engine (question askWhen, advisor, this),
// each one that needs no engine change is evidence the "rules are data"
// resolution from docs/plans/planner-web-mvp-usecases.md section 2 holds.
//
// Two loaders live here because they are tightly coupled: a control rule's
// `when: {eq: ['readout', ...]}` can only be evaluated once readoutText has
// been resolved to a canonical id via the readouts vocabulary, and nothing
// else in the app needs that vocabulary.
//
// Pure module: no DOM, no store. Imports only evaluatePredicate.
//
// Mirrors engine/advisor.js's loader discipline deliberately: an explicit
// whitelist object, never a spread of the raw entry, so a new rule property
// is silently DROPPED here until it is added to this list by name -- see
// advisor.js's own header for why (this project has shipped the opposite
// failure once already).

import { evaluatePredicate } from './predicate.js';

export const CONTROL_KINDS = ['panel', 'readout'];

const CONTROL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MIN_WHY_LENGTH = 40;

// Pack-level provenance (R3-13), mirroring advisor.js's own default -- see
// that module's comment for why an absent field defaults to 'claude-drafted'
// rather than reading as reviewed.
const DEFAULT_CONTROLS_REVIEW_STATUS = 'claude-drafted';

const KNOWN_CONTROL_RULE_KEYS = new Set(['id', 'kind', 'title', 'why', 'when', 'priority']);

function controlIssue(field, message) {
  return { field, message, severity: 'error' };
}

/**
 * Validate and normalize one raw control-rule entry. Returns `null` (with
 * issues pushed) if the rule cannot be shipped; otherwise the normalized
 * rule. Mirrors advisor.js's normalizeAdvisorRule field-by-field.
 */
function normalizeControlRule(entry, index, issues, seenIds) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(controlIssue(`[${index}]`, 'control rule is not an object'));
    return null;
  }

  for (const key of Object.keys(entry)) {
    if (!KNOWN_CONTROL_RULE_KEYS.has(key)) {
      issues.push(controlIssue(`[${index}]`, `control rule has an unrecognized property '${key}' -- it will be ignored`));
    }
  }

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) {
    issues.push(controlIssue(`[${index}]`, 'control rule is missing a non-empty id'));
    return null;
  }
  if (!CONTROL_ID_PATTERN.test(id)) {
    issues.push(controlIssue(id, `control rule id '${id}' must match ${CONTROL_ID_PATTERN}`));
    return null;
  }
  if (seenIds.has(id)) {
    issues.push(controlIssue(id, `duplicate control rule id '${id}'`));
    return null;
  }

  if (!CONTROL_KINDS.includes(entry.kind)) {
    issues.push(controlIssue(id, `control rule 'kind' must be one of ${CONTROL_KINDS.join(', ')}, got '${String(entry.kind)}'`));
    return null;
  }

  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (!title) {
    issues.push(controlIssue(id, 'control rule is missing a non-empty title'));
    return null;
  }

  // The rationale, required and at least a real sentence -- per the standing
  // rule-of-thumb (planner-web-mvp-usecases.md section 2): "a control the
  // user does not understand is a control they will delete."
  const why = typeof entry.why === 'string' ? entry.why.trim() : '';
  if (why.length < MIN_WHY_LENGTH) {
    issues.push(
      controlIssue(id, `control rule 'why' must be at least ${MIN_WHY_LENGTH} characters (the rationale, not just the name) -- got ${why.length}`)
    );
    return null;
  }

  // `when` is REQUIRED and must not be the literal `true`, for the same
  // reason as advisor.js: evaluatePredicate(undefined, ...) is true, so an
  // omitted `when` would silently make a control fire for every assay.
  if (entry.when === undefined || entry.when === true) {
    issues.push(controlIssue(id, "control rule 'when' is required and must not be the literal true"));
    return null;
  }

  seenIds.add(id);
  return {
    id,
    kind: entry.kind,
    title,
    why,
    when: entry.when,
    priority: typeof entry.priority === 'number' ? entry.priority : 0,
  };
}

/**
 * Validate and normalize a raw controls pack into {rules, issues}. TOTAL:
 * never throws. A malformed rule is dropped and reported rather than
 * aborting the whole pack.
 */
export function loadControlRules(raw) {
  const issues = [];

  if (raw === undefined || raw === null) {
    issues.push(
      controlIssue(
        'controls',
        'controls pack is missing -- web/kb/controls.json was not found in the build. ' +
          'For dev, serve web/ via tools/serve_dir.py (it generates web/kb.dev.js).',
      ),
    );
    return { rules: [], reviewStatus: DEFAULT_CONTROLS_REVIEW_STATUS, note: undefined, issues };
  }
  if (typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.rules)) {
    issues.push(controlIssue('controls', "controls pack must be an object with a 'rules' array"));
    return { rules: [], reviewStatus: DEFAULT_CONTROLS_REVIEW_STATUS, note: undefined, issues };
  }

  const seenIds = new Set();
  const rules = [];
  raw.rules.forEach((entry, index) => {
    const rule = normalizeControlRule(entry, index, issues, seenIds);
    if (rule) rules.push(rule);
  });

  // Pack-level provenance (R3-13), carried through rather than dropped --
  // see advisor.js's loadAdvisorRules for the identical discipline.
  const reviewStatus =
    typeof raw.reviewStatus === 'string' && raw.reviewStatus.trim() ? raw.reviewStatus.trim() : DEFAULT_CONTROLS_REVIEW_STATUS;
  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined;

  return { rules, reviewStatus, note, issues };
}

/**
 * The control rules relevant to the CURRENT `experiment` (an assayView, like
 * every other engine consumer), in ascending priority order, ties in
 * declaration order. TOTAL like evaluatePredicate itself.
 */
export function selectControls(rules, experiment) {
  const matching = rules.filter((rule) => {
    try {
      return evaluatePredicate(rule.when, experiment);
    } catch {
      return false;
    }
  });
  return matching
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index)
    .map(({ rule }) => rule);
}

// --- Readout vocabulary ------------------------------------------------
//
// A controlled vocabulary, not free text: engine/validation.js's
// compileFullMatch has no case-insensitive flag, so a `matches`-based
// control rule would fire on one person's spelling of "viability" and
// nobody else's. Structurally mirrors core/kb.js's markers.json
// canonical+aliases pattern, without the isFamily/variants complexity
// markers need and readouts don't.

const READOUT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate and normalize a raw readouts pack into {readouts, issues}.
 * TOTAL: never throws. `readouts` is always a usable (possibly empty)
 * { canonicalId: {label, aliases} } object.
 */
export function loadReadouts(raw) {
  const issues = [];
  const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const source = isPlainObject ? raw : {};

  if (!isPlainObject) {
    issues.push(controlIssue('readouts', 'readouts pack is missing or is not an object'));
  } else if (source.version !== 1) {
    issues.push(controlIssue('readouts', `readouts pack version is ${JSON.stringify(source.version ?? null)}, expected 1`));
  }

  const rawReadouts =
    source.readouts !== null && source.readouts !== undefined && typeof source.readouts === 'object' && !Array.isArray(source.readouts)
      ? source.readouts
      : {};

  const readouts = {};
  for (const [canonical, entry] of Object.entries(rawReadouts)) {
    if (!READOUT_ID_PATTERN.test(canonical)) {
      issues.push(controlIssue('readouts', `readout id '${canonical}' must match ${READOUT_ID_PATTERN}`));
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(controlIssue('readouts', `readout '${canonical}' entry is not an object`));
      continue;
    }
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) {
      issues.push(controlIssue('readouts', `readout '${canonical}' is missing a non-empty label`));
      continue;
    }
    readouts[canonical] = {
      label,
      aliases: Array.isArray(entry.aliases) ? entry.aliases.filter((a) => typeof a === 'string') : [],
    };
  }

  return { readouts, issues };
}

/**
 * Resolve free text (what the user picked or typed for the readout
 * question) to a canonical readout id, or `null` if it matches nothing.
 * Case-insensitive EXACT match against each readout's label or aliases --
 * deliberately not fuzzy/substring, so "ROS in macrophages" does not
 * silently resolve to "ros" and fire rules the user never confirmed.
 *
 * Plain string comparison, not a `matches` regex -- this is a curated pick
 * from a `<select>` (or its literal Other free-text), not prose scanning,
 * so the case-insensitivity gap in compileFullMatch (the reason readout
 * needed a controlled vocabulary at all) never applies here.
 */
export function resolveReadoutCanonical(text, readouts) {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  const needle = text.trim().toLowerCase();
  const table = readouts && typeof readouts === 'object' ? readouts : {};
  for (const [canonical, entry] of Object.entries(table)) {
    if (entry.label.toLowerCase() === needle) return canonical;
    if (entry.aliases.some((alias) => alias.toLowerCase() === needle)) return canonical;
  }
  return null;
}

/**
 * The three-state readout resolution for the controls panel (Decision 5,
 * docs/plans/planner-web-assay-tier.md): an empty controls list must NEVER
 * render as "I don't know" -- silence reads as "this assay needs no
 * controls," the most dangerous false negative a controls advisor can
 * produce. Returns one of:
 *   'unanswered'   -- readoutText is empty; nothing to resolve yet.
 *   'unrecognized' -- readoutText is filled in but matches no known readout
 *                     (typically a free-text "Other" answer).
 *   'known'        -- resolved to a canonical readout id.
 */
export function readoutState(readoutText, readouts) {
  if (typeof readoutText !== 'string' || readoutText.trim().length === 0) return 'unanswered';
  return resolveReadoutCanonical(readoutText, readouts) === null ? 'unrecognized' : 'known';
}
