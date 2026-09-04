// The staged progression ladder (idea -> pilot -> validate controls -> fix
// acquisition settings -> advanced modality): a genuinely new knowledge type
// that appears in NO planning document anywhere -- unlike the advisor and
// controls tiers, which are the remaining pieces of an already-scoped plan
// (docs/plans/planner-web-assay-tier.md), this is new scope from the user's
// own request for a deterministic "how to run this project" walkthrough.
//
// Same discipline as engine/advisor.js and engine/controls.js: rules are
// DATA in web/kb/stages.json, evaluated by the existing predicate engine --
// code knows a rule's SHAPE (it has a `stage` and a `when`); only data knows
// its CONTENT (e.g. "STED is bleach-prone, pilot on confocal first"). A
// STED study is told to pilot on confocal/widefield BY RULE, not by fixed
// prose that can't see what the user actually entered.
//
// Two kinds of content here, unlike advisor/controls' single flat rule
// list: a fixed BACKBONE of five stages (every study sees the same ladder,
// in the same order -- the ladder itself is not conditional, only which
// EXTRA notes attach to each rung), and a rule list that adds study-specific
// notes onto individual stages.
//
// Pure module: no DOM, no store. Imports only evaluatePredicate.

import { evaluatePredicate } from './predicate.js';

const STAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MIN_STAGE_BODY_LENGTH = 40;
const MIN_NOTE_LENGTH = 40;

const KNOWN_STAGE_KEYS = new Set(['id', 'order', 'title', 'body']);
const KNOWN_STAGE_RULE_KEYS = new Set(['id', 'stage', 'when', 'note', 'priority']);

function stageIssue(field, message) {
  return { field, message, severity: 'error' };
}

/** Mirrors advisor.js's normalizeAdvisorRule field-by-field, for one stage entry. */
function normalizeStage(entry, index, issues, seenIds) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(stageIssue(`stages[${index}]`, 'stage entry is not an object'));
    return null;
  }
  for (const key of Object.keys(entry)) {
    if (!KNOWN_STAGE_KEYS.has(key)) {
      issues.push(stageIssue(`stages[${index}]`, `stage entry has an unrecognized property '${key}' -- it will be ignored`));
    }
  }

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) {
    issues.push(stageIssue(`stages[${index}]`, 'stage entry is missing a non-empty id'));
    return null;
  }
  if (!STAGE_ID_PATTERN.test(id)) {
    issues.push(stageIssue(id, `stage id '${id}' must match ${STAGE_ID_PATTERN}`));
    return null;
  }
  if (seenIds.has(id)) {
    issues.push(stageIssue(id, `duplicate stage id '${id}'`));
    return null;
  }

  const order = typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : null;
  if (order === null) {
    issues.push(stageIssue(id, "stage 'order' must be a finite number"));
    return null;
  }

  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (!title) {
    issues.push(stageIssue(id, 'stage entry is missing a non-empty title'));
    return null;
  }

  const body = typeof entry.body === 'string' ? entry.body.trim() : '';
  if (body.length < MIN_STAGE_BODY_LENGTH) {
    issues.push(stageIssue(id, `stage 'body' must be at least ${MIN_STAGE_BODY_LENGTH} characters -- got ${body.length}`));
    return null;
  }

  seenIds.add(id);
  return { id, order, title, body };
}

/** Mirrors normalizeStage; `knownStageIds` is the set of stage ids already loaded from the SAME pack. */
function normalizeStageRule(entry, index, issues, seenIds, knownStageIds) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(stageIssue(`rules[${index}]`, 'stage rule is not an object'));
    return null;
  }
  for (const key of Object.keys(entry)) {
    if (!KNOWN_STAGE_RULE_KEYS.has(key)) {
      issues.push(stageIssue(`rules[${index}]`, `stage rule has an unrecognized property '${key}' -- it will be ignored`));
    }
  }

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) {
    issues.push(stageIssue(`rules[${index}]`, 'stage rule is missing a non-empty id'));
    return null;
  }
  if (!STAGE_ID_PATTERN.test(id)) {
    issues.push(stageIssue(id, `stage rule id '${id}' must match ${STAGE_ID_PATTERN}`));
    return null;
  }
  if (seenIds.has(id)) {
    issues.push(stageIssue(id, `duplicate stage rule id '${id}'`));
    return null;
  }

  const stage = typeof entry.stage === 'string' ? entry.stage.trim() : '';
  if (!stage || !knownStageIds.has(stage)) {
    issues.push(stageIssue(id, `stage rule references unknown stage '${stage}' (known: ${[...knownStageIds].join(', ')})`));
    return null;
  }

  // Same reasoning as advisor.js/controls.js: `when` is required and must
  // not be the literal `true`, since evaluatePredicate(undefined, ...) is
  // true and would silently make a note appear for every study.
  if (entry.when === undefined || entry.when === true) {
    issues.push(stageIssue(id, "stage rule 'when' is required and must not be the literal true"));
    return null;
  }

  const note = typeof entry.note === 'string' ? entry.note.trim() : '';
  if (note.length < MIN_NOTE_LENGTH) {
    issues.push(stageIssue(id, `stage rule 'note' must be at least ${MIN_NOTE_LENGTH} characters -- got ${note.length}`));
    return null;
  }

  seenIds.add(id);
  return {
    id,
    stage,
    when: entry.when,
    note,
    priority: typeof entry.priority === 'number' ? entry.priority : 0,
  };
}

/**
 * Validate and normalize a raw stages pack into {stages, rules, issues}.
 * `stages` is sorted by `order` ascending. TOTAL: never throws.
 */
export function loadStages(raw) {
  const issues = [];

  if (raw === undefined || raw === null) {
    issues.push(
      stageIssue(
        'stages',
        'stages pack is missing -- web/kb/stages.json was not found in the build. ' +
          'For dev, serve web/ via tools/serve_dir.py (it generates web/kb.dev.js).',
      ),
    );
    return { stages: [], rules: [], issues };
  }
  if (typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.stages) || !Array.isArray(raw.rules)) {
    issues.push(stageIssue('stages', "stages pack must be an object with 'stages' and 'rules' arrays"));
    return { stages: [], rules: [], issues };
  }

  const seenStageIds = new Set();
  const stages = [];
  raw.stages.forEach((entry, index) => {
    const stage = normalizeStage(entry, index, issues, seenStageIds);
    if (stage) stages.push(stage);
  });
  stages.sort((a, b) => a.order - b.order);

  const knownStageIds = new Set(stages.map((s) => s.id));
  const seenRuleIds = new Set();
  const rules = [];
  raw.rules.forEach((entry, index) => {
    const rule = normalizeStageRule(entry, index, issues, seenRuleIds, knownStageIds);
    if (rule) rules.push(rule);
  });

  return { stages, rules, issues };
}

/**
 * The stage rules relevant to the CURRENT `experiment`, in ascending
 * priority order, ties in declaration order. TOTAL like evaluatePredicate.
 * Kept separate from buildLadder below so a caller (or a test) can inspect
 * which notes fired without needing a full stage backbone in hand.
 */
export function selectStageNotes(rules, experiment) {
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

/**
 * Build the full ladder for `experiment`: every stage, in order, with its
 * fixed `body` plus the study-specific `notes` (selectStageNotes, scoped to
 * that one stage) that fired for it. Every stage is always present, even
 * with zero notes -- the ladder's backbone is not conditional, only its
 * per-stage extras are.
 */
export function buildLadder(stages, rules, experiment) {
  const fired = selectStageNotes(rules, experiment);
  return stages.map((stage) => ({
    ...stage,
    notes: fired.filter((rule) => rule.stage === stage.id).map((rule) => rule.note),
  }));
}
