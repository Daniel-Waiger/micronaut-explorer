// Advisor rules: modality-specific (and later, panel/design-specific)
// guidance stored as DATA in web/kb/advisor.json and evaluated by the
// EXISTING predicate DSL (engine/predicate.js). This is the "why", not just
// the "what" -- see docs/plans/planner-web-mvp-usecases.md section 2: code
// may know the SHAPE of a rule; only data may know its CONTENT.
//
// Pure module: no DOM, no store, no globals. Imports only evaluatePredicate.
//
// Mirrors engine/interview.js's loadQuestions discipline deliberately: an
// explicit whitelist object, never a spread of the raw entry, so a new rule
// property is silently DROPPED here until it is added to this list by name.
// That is what makes an author's typo loud rather than a rule that loads
// clean and never does anything -- this project has shipped the opposite
// (a spread that silently dropped a new property) once already.

import { evaluatePredicate } from './predicate.js';

// Surfaces that have a live advice renderer TODAY. Deliberately NOT
// pre-authorizing a future surface (e.g. a panel/spillover page): a rule
// naming an unknown surface is dropped with an issue, not silently inert.
// Adding a surface later is one entry here plus one UI wire-up, in the same
// commit.
export const ADVICE_SURFACES = ['describe', 'design', 'naming'];

export const ADVICE_KINDS = ['pitfall', 'tip'];

const ADVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MIN_ADVICE_BODY_LENGTH = 40;

// The complete set of keys a rule entry may carry. Checked against
// Object.keys(entry) so an unrecognized key (a typo like 'surface' for
// 'surfaces', or a leftover 'text' from copy-pasting a question-bank entry)
// is reported rather than silently ignored -- see the module-header comment.
const KNOWN_ADVISOR_RULE_KEYS = new Set(['id', 'surfaces', 'kind', 'title', 'body', 'when', 'priority']);

function advisorIssue(field, message) {
  return { field, message, severity: 'error' };
}

/**
 * Validate and normalize one raw rule entry. Returns `null` (with issues
 * pushed) if the rule cannot be shipped; otherwise the normalized rule.
 *
 * Unknown top-level keys are reported but do NOT drop the rule -- the direct
 * countermeasure to the silent-drop failure mode above: an author who
 * mistypes `surface` instead of `surfaces` gets told, rather than shipping a
 * rule with no surfaces that is quietly the SAME as skipping the whole thing.
 */
function normalizeAdvisorRule(entry, index, issues, seenIds) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(advisorIssue(`[${index}]`, 'advisor rule is not an object'));
    return null;
  }

  // Reported here, before any field validation, so an unrecognized key is
  // flagged even on a rule that otherwise fails validation for an unrelated
  // reason -- an author fixing one problem should see all of them, not
  // discover the typo only after the first error is resolved.
  for (const key of Object.keys(entry)) {
    if (!KNOWN_ADVISOR_RULE_KEYS.has(key)) {
      issues.push(advisorIssue(`[${index}]`, `advisor rule has an unrecognized property '${key}' -- it will be ignored`));
    }
  }

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) {
    issues.push(advisorIssue(`[${index}]`, 'advisor rule is missing a non-empty id'));
    return null;
  }
  if (!ADVICE_ID_PATTERN.test(id)) {
    issues.push(advisorIssue(id, `advisor rule id '${id}' must match ${ADVICE_ID_PATTERN}`));
    return null;
  }
  if (seenIds.has(id)) {
    issues.push(advisorIssue(id, `duplicate advisor rule id '${id}'`));
    return null;
  }

  if (!ADVICE_KINDS.includes(entry.kind)) {
    issues.push(advisorIssue(id, `advisor rule 'kind' must be one of ${ADVICE_KINDS.join(', ')}, got '${String(entry.kind)}'`));
    return null;
  }

  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (!title) {
    issues.push(advisorIssue(id, 'advisor rule is missing a non-empty title'));
    return null;
  }

  const body = typeof entry.body === 'string' ? entry.body.trim() : '';
  if (body.length < MIN_ADVICE_BODY_LENGTH) {
    issues.push(
      advisorIssue(
        id,
        `advisor rule 'body' must be at least ${MIN_ADVICE_BODY_LENGTH} characters (the "why", not just the "what") -- got ${body.length}`
      )
    );
    return null;
  }

  if (!Array.isArray(entry.surfaces) || entry.surfaces.length === 0) {
    issues.push(advisorIssue(id, "advisor rule 'surfaces' must be a non-empty array"));
    return null;
  }
  const unknownSurface = entry.surfaces.find((s) => !ADVICE_SURFACES.includes(s));
  if (unknownSurface !== undefined) {
    // Drop the WHOLE rule, not just the bad entry -- dropping only the bad
    // surface would leave the rule alive but silently narrower than the
    // author intended, which is a harder bug to notice than an absent rule.
    issues.push(
      advisorIssue(id, `advisor rule references unknown surface '${String(unknownSurface)}' (known: ${ADVICE_SURFACES.join(', ')})`)
    );
    return null;
  }

  // `when` is REQUIRED and must not be the literal `true`.
  // evaluatePredicate(undefined, ...) returns true -- the DSL's own "no
  // condition given" default -- so an omitted `when` would silently produce
  // permanent, unconditional advice on every matching surface. A rule that
  // genuinely wants to fire everywhere still has to say so honestly with an
  // always-true predicate shape the author chose, not by omission.
  if (entry.when === undefined || entry.when === true) {
    issues.push(advisorIssue(id, "advisor rule 'when' is required and must not be the literal true"));
    return null;
  }

  seenIds.add(id);
  return {
    id,
    surfaces: entry.surfaces.slice(),
    kind: entry.kind,
    title,
    body,
    when: entry.when,
    priority: typeof entry.priority === 'number' ? entry.priority : 0,
  };
}

/**
 * Validate and normalize a raw advisor pack into {rules, issues}.
 * TOTAL: never throws. A malformed rule is dropped and reported rather than
 * aborting the whole pack -- one bad rule must not silence every rule.
 *
 * `raw` is the parsed contents of web/kb/advisor.json: `{version, rules}`.
 * An absent pack (raw is undefined/null) is reported as its own issue rather
 * than degrading silently to an empty rule set -- a developer who edits
 * advisor.json and forgets to re-run tools/export_markers_kb.py sees a toast
 * naming the fix, not a blank panel with no clue why.
 */
export function loadAdvisorRules(raw) {
  const issues = [];

  if (raw === undefined || raw === null) {
    issues.push(advisorIssue('advisor', 'advisor pack is missing -- run tools/export_markers_kb.py'));
    return { rules: [], issues };
  }
  if (typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.rules)) {
    issues.push(advisorIssue('advisor', "advisor pack must be an object with a 'rules' array"));
    return { rules: [], issues };
  }

  const seenIds = new Set();
  const rules = [];
  raw.rules.forEach((entry, index) => {
    const rule = normalizeAdvisorRule(entry, index, issues, seenIds);
    if (rule) rules.push(rule);
  });

  return { rules, issues };
}

/**
 * The advice notes relevant to `surface` for the CURRENT `experiment`, in
 * ascending priority order (ties keep declaration order -- Array.prototype
 * .sort is stable).
 *
 * `surface === null` means "every surface" -- the hook a future aggregate
 * view (a nav badge, a summary page) would use; nothing in this slice calls
 * it that way yet.
 *
 * TOTAL like evaluatePredicate itself: a rule whose `when` somehow throws
 * (it cannot, by evaluatePredicate's own contract, but this function does
 * not trust that transitively) is treated as non-matching, never as a crash
 * that blanks the whole panel.
 */
export function selectAdvice(rules, experiment, surface) {
  const matching = rules.filter((rule) => {
    if (surface !== null && !rule.surfaces.includes(surface)) return false;
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

// Maps a predicate PATH to the plain-English field name summarizeTrigger
// uses. Deliberately small and curated -- covers only paths advisor rules
// actually reference today. An unmapped path makes summarizeTrigger return
// null (see below) rather than leaking a raw dotted path like
// 'acquisition.modality' into user-facing text.
const TRIGGER_FIELD_LABELS = { 'acquisition.modality': 'modality' };

/**
 * A short, plain-English explanation of why a note fired -- "modality is
 * STED", "modality is SEM or TEM" -- for display ALONGSIDE every note, not
 * behind the debug flag describePredicate (engine/predicate.js) sits behind.
 *
 * Deliberately derived MECHANICALLY from the predicate rather than
 * hand-authored per rule: a hand-written trigger string is a second,
 * independent rendering of the same fact `when` already encodes, and this
 * codebase has already shipped that exact defect shape twice (a display
 * column disagreeing with an embedded filename token, a value written under
 * one store path and read under another -- docs/cma-lessons.md lessons 49
 * and 50). Deriving from `rule.when` itself means this text CANNOT disagree
 * with the actual trigger condition the engine evaluates, by construction.
 *
 * TOTAL: only the two simplest predicate shapes this pack currently uses
 * (`eq`, `in`, both on a single string path) are summarized. Anything else
 * -- composite `all`/`any`/`not`, `matches`, `gt`/`lt`, `exists`/`empty`, or
 * a path not in TRIGGER_FIELD_LABELS -- returns null. The caller omits the
 * clause entirely in that case rather than showing something misleading or
 * falling back to raw predicate syntax.
 */
export function summarizeTrigger(predicate) {
  if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) return null;
  const keys = Object.keys(predicate);
  if (keys.length !== 1) return null;
  const [op] = keys;
  const arg = predicate[op];
  if ((op !== 'eq' && op !== 'in') || !Array.isArray(arg) || arg.length !== 2) return null;

  const [path, value] = arg;
  if (typeof path !== 'string') return null;
  const label = TRIGGER_FIELD_LABELS[path];
  if (!label) return null;

  if (op === 'eq') {
    if (typeof value !== 'string') return null;
    return `${label} is ${value}`;
  }
  // op === 'in'
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === 'string')) return null;
  if (value.length === 1) return `${label} is ${value[0]}`;
  return `${label} is ${value.slice(0, -1).join(', ')} or ${value[value.length - 1]}`;
}
