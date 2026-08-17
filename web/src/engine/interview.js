// Interview engine: question bank loading, next-question selection, and
// answer recording. See docs/plans/planner-web-p1-task-graph.json, task
// C1-3.
//
// This module NEVER writes to the store: recordAnswer returns a
// {path, value, tag} write DESCRIPTOR rather than performing the write, so
// core/store.js stays the single writer and its provenance gate (C0-2)
// stays the single gatekeeper for what may overwrite what.

import { evaluatePredicate } from './predicate.js';
import { getPath } from '../core/paths.js';
import { isProvisional } from '../core/provenance.js';

const KNOWN_QUESTION_TYPES = new Set(['text', 'choice', 'number', 'multi']);
const DEFAULT_ANSWER_TAG = 'user';
const STRONG_TAGS = new Set(['user', 'user_edited', 'imported']);

function interviewIssue(field, message) {
  return { field, message, severity: 'error' };
}

/**
 * Validate and normalize a raw question-bank array into {questions, issues}.
 * TOTAL: never throws. A malformed entry is dropped and reported by id (or
 * by index, if it has no usable id) rather than aborting the whole load.
 */
export function loadQuestions(raw) {
  const issues = [];
  if (!Array.isArray(raw)) {
    return { questions: [], issues: [interviewIssue('questions', 'question bank is not an array')] };
  }

  const seenIds = new Set();
  const questions = [];

  raw.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(interviewIssue(`[${index}]`, 'question entry is not an object'));
      return;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) {
      issues.push(interviewIssue(`[${index}]`, 'question is missing a non-empty id'));
      return;
    }
    if (seenIds.has(id)) {
      issues.push(interviewIssue(id, `duplicate question id '${id}'`));
      return;
    }
    const field = typeof entry.field === 'string' ? entry.field.trim() : '';
    if (!field) {
      issues.push(interviewIssue(id, 'question is missing a non-empty field'));
      return;
    }
    if (!KNOWN_QUESTION_TYPES.has(entry.type)) {
      issues.push(interviewIssue(id, `unknown question type '${String(entry.type)}'`));
      return;
    }
    if ((entry.type === 'choice' || entry.type === 'multi') && (!Array.isArray(entry.options) || entry.options.length === 0)) {
      issues.push(interviewIssue(id, `question type '${entry.type}' requires a non-empty 'options' array`));
      return;
    }

    seenIds.add(id);
    questions.push({
      id,
      prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
      why: typeof entry.why === 'string' ? entry.why : '',
      field,
      type: entry.type,
      options: Array.isArray(entry.options) ? entry.options.slice() : undefined,
      // Whether an 'Other...' free-text fallback is offered alongside the
      // curated options -- meaningless for non-choice types, so coerced to a
      // real boolean rather than passed through, the same normalize-not-copy
      // treatment every other field here gets. loadQuestions builds an
      // explicit whitelist object rather than spreading `entry`, so a new
      // question-bank property (this one included, when it was first added)
      // is silently DROPPED here unless it is added to this list by name --
      // that is deliberate (unknown properties should not leak into the
      // engine unexamined), but it means every new property needs this line.
      allowOther: entry.allowOther === true,
      askWhen: entry.askWhen,
      priority: typeof entry.priority === 'number' ? entry.priority : 0,
      tag: typeof entry.tag === 'string' && entry.tag ? entry.tag : DEFAULT_ANSWER_TAG,
      // A short noun-phrase label for the name-builder-style field grid
      // (zen-planner Phase 1, ui/fieldInterview.js) -- distinct from
      // `prompt`, which is the full question sentence the card-style
      // interview shows. Falls back to `prompt` when a question has no
      // dedicated label, so an un-migrated question still renders something.
      label: typeof entry.label === 'string' && entry.label ? entry.label : (typeof entry.prompt === 'string' ? entry.prompt : id),
      // Example text for the box (name-builder idiom), and an optional
      // widget override: 'date' -> a native date picker, 'duration' -> an
      // hours+minutes pair stored as total minutes. Absent = derive the
      // widget from `type` (text/number/choice).
      placeholder: typeof entry.placeholder === 'string' ? entry.placeholder : '',
      control: typeof entry.control === 'string' && entry.control ? entry.control : null,
      // Which surface asks this question (zen-planner Phase 1's project-
      // first reframe): 'project' (Project step -- what/who/why, before any
      // microscope is chosen), 'microscopy' (Microscopy step -- modality,
      // instrument, acquisition), or 'timing' (bench/scope ETA interview
      // feeding the .ics export). A question with no phase (or an unknown
      // one) is UNSCOPED -- nextQuestions' phase filter treats "no filter
      // requested" as "ask everything" so older callers keep working
      // unchanged, but an explicit phase filter only ever matches an EXACT
      // phase string, never an unscoped question -- an unscoped question
      // would otherwise leak into every phase-scoped surface at once.
      phase: typeof entry.phase === 'string' && entry.phase ? entry.phase : null,
    });
  });

  return { questions, issues };
}

function slotTag(experiment, path) {
  const slot = experiment && experiment.provenance && experiment.provenance.slots;
  return slot ? slot[path]?.tag ?? null : null;
}

export function isSkipped(experiment, questionId) {
  const skipped = experiment && experiment.provenance && experiment.provenance.skipped;
  return Array.isArray(skipped) && skipped.includes(questionId);
}

/** Record `questionId` as skipped. Mutates `experiment.provenance.skipped` in place. */
export function skipQuestion(experiment, questionId) {
  if (!experiment.provenance) {
    experiment.provenance = { slots: {}, unanswered: [], skipped: [] };
  }
  if (!Array.isArray(experiment.provenance.skipped)) {
    experiment.provenance.skipped = [];
  }
  if (!experiment.provenance.skipped.includes(questionId)) {
    experiment.provenance.skipped.push(questionId);
  }
  return experiment;
}

/**
 * The askable questions, in ascending priority order, capped at `limit`.
 *
 * A question is askable when: its askWhen predicate passes (evaluatePredicate
 * is total, so a malformed predicate simply excludes the question rather
 * than throwing); it has not been skipped; and its target slot is not
 * already filled by a STRONG source (user/user_edited/imported).
 *
 * A slot filled only by a WEAK 'freetext' tag IS still askable -- but the
 * returned question carries that existing value as `suggestedDefault`, so
 * the UI can render it as "confirm this" rather than a blank field. This is
 * the entire reason the free-text tier (C1-4) and this interview compose:
 * the parser fills WEAK slots, the interview then asks about exactly those,
 * pre-filled.
 *
 * A PROVISIONAL slot ('llm'/'llm_freetext', core/provenance.js) gets the
 * SAME treatment, for the same reason: a model-drafted study (core/draft.js)
 * would otherwise be invisible here -- every drafted field would re-ask as
 * an empty question, discarding the draft in the one view meant to review
 * it. Only these two tiers pre-fill; 'kb-default' and 'derived' are app-
 * supplied scaffolding the user never proposed, and surfacing them as
 * "confirm this" would ask the user to ratify the app's own defaults.
 *
 * `options.phase`, when given, restricts the result to questions tagged with
 * that EXACT phase (loadQuestions above) -- an unscoped question (no phase
 * in the bank) never matches a phase filter, so the Project and Microscopy
 * surfaces each see only what was deliberately assigned to them. Omitting
 * `options` (or `options.phase`) asks across every phase, unchanged from
 * before phases existed -- every pre-existing caller stays correct with no
 * edit.
 */
export function nextQuestions(questions, experiment, limit, options = {}) {
  const cap = typeof limit === 'number' && limit >= 0 ? limit : Infinity;
  const phaseFilter = typeof options.phase === 'string' ? options.phase : null;
  const askable = [];
  const sorted = questions
    .filter((q) => !phaseFilter || q.phase === phaseFilter)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  for (const question of sorted) {
    if (askable.length >= cap) break;
    if (isSkipped(experiment, question.id)) continue;
    if (!evaluatePredicate(question.askWhen, experiment)) continue;

    const tag = slotTag(experiment, question.field);
    if (STRONG_TAGS.has(tag)) continue;

    if (tag === 'freetext' || (tag && isProvisional(tag))) {
      const currentValue = getPath(experiment, question.field);
      if (currentValue !== undefined) {
        askable.push({ ...question, suggestedDefault: currentValue, suggestedTag: tag });
        continue;
      }
    }
    askable.push(question);
  }

  return askable;
}

/**
 * Every question in `phase` whose askWhen currently passes, ANSWERED OR NOT,
 * each annotated with `currentValue` and a `confirmed` flag -- the model the
 * name-builder-style field grid (ui/fieldInterview.js, zen-planner Phase 1)
 * renders from. This is deliberately NOT nextQuestions: that one HIDES a
 * question the moment its slot goes STRONG (correct for a "next question"
 * queue, wrong for a show-everything grid where an answered field stays
 * visible with its value and a checked ✓). askWhen is still honored
 * (evaluatePredicate is total), so a gated question stays hidden until its
 * condition holds.
 *
 * `confirmed` is true when the slot carries a STRONG tag -- i.e. the user
 * has committed this value (the grid shows a filled checkmark). A WEAK
 * 'freetext' or PROVISIONAL 'llm' prefill is surfaced as `currentValue` (so
 * the box shows the suggestion) with `confirmed: false` (so the checkmark
 * still invites confirmation), the same two-tier treatment nextQuestions'
 * suggestedDefault/suggestedTag gives the card interview.
 */
export function phaseQuestions(questions, experiment, phase) {
  const out = [];
  for (const question of questions) {
    if (phase && question.phase !== phase) continue;
    if (!evaluatePredicate(question.askWhen, experiment)) continue;
    const tag = slotTag(experiment, question.field);
    out.push({
      ...question,
      currentValue: getPath(experiment, question.field),
      confirmed: STRONG_TAGS.has(tag),
      suggestedTag: tag === 'freetext' || (tag && isProvisional(tag)) ? tag : null,
    });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** Un-skip `questionId`, making it askable again. Mutates in place. */
export function unskipQuestion(experiment, questionId) {
  const provenance = experiment && experiment.provenance;
  if (provenance && Array.isArray(provenance.skipped)) {
    provenance.skipped = provenance.skipped.filter((id) => id !== questionId);
  }
  return experiment;
}

/**
 * The exact complement of nextQuestions: every question the user has already
 * DEALT WITH -- answered (its slot now carries a STRONG tag) or explicitly
 * skipped -- carrying the value currently stored for it.
 *
 * This exists because nextQuestions deliberately drops a question the moment
 * its slot goes STRONG, which is correct for "what should I ask next" and
 * wrong as a whole UI: without this, answering a question makes it vanish with
 * no way to see what you said, let alone change it. An interview the user
 * cannot revise is a data-entry trap, not an interview.
 *
 * Returned in the question bank's own order (not priority order) so the review
 * list stays stable as answers change -- a list that reshuffles under the
 * user's cursor while they are editing it is unusable.
 *
 * `options.phase` filters the same way nextQuestions' does -- see its own
 * docstring for the exact-match/unscoped-never-matches rule.
 */
export function answeredQuestions(questions, experiment, options = {}) {
  const phaseFilter = typeof options.phase === 'string' ? options.phase : null;
  const reviewable = [];
  for (const question of questions) {
    if (phaseFilter && question.phase !== phaseFilter) continue;
    const skipped = isSkipped(experiment, question.id);
    const tag = slotTag(experiment, question.field);
    const answered = STRONG_TAGS.has(tag);
    if (!skipped && !answered) continue;

    reviewable.push({
      ...question,
      currentValue: answered ? getPath(experiment, question.field) : undefined,
      status: skipped ? 'skipped' : 'answered',
      tag,
    });
  }
  return reviewable;
}

/**
 * Return the write descriptor for answering `question` with `value`. Does
 * NOT touch `experiment` in any way -- the store is the only writer, so it
 * alone decides (via provenance) whether this write is actually applied.
 */
export function recordAnswer(experiment, question, value) {
  return { path: question.field, value, tag: question.tag || DEFAULT_ANSWER_TAG };
}

export function interviewProgress(questions, experiment) {
  let answered = 0;
  let skipped = 0;
  for (const question of questions) {
    if (isSkipped(experiment, question.id)) {
      skipped += 1;
      continue;
    }
    if (STRONG_TAGS.has(slotTag(experiment, question.field))) {
      answered += 1;
    }
  }
  const askable = nextQuestions(questions, experiment, questions.length).length;
  return { answered, askable, skipped, total: questions.length };
}
