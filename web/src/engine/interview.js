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
 */
export function nextQuestions(questions, experiment, limit) {
  const cap = typeof limit === 'number' && limit >= 0 ? limit : Infinity;
  const askable = [];
  const sorted = questions.slice().sort((a, b) => a.priority - b.priority);

  for (const question of sorted) {
    if (askable.length >= cap) break;
    if (isSkipped(experiment, question.id)) continue;
    if (!evaluatePredicate(question.askWhen, experiment)) continue;

    const tag = slotTag(experiment, question.field);
    if (STRONG_TAGS.has(tag)) continue;

    if (tag === 'freetext') {
      const currentValue = getPath(experiment, question.field);
      if (currentValue !== undefined) {
        askable.push({ ...question, suggestedDefault: currentValue });
        continue;
      }
    }
    askable.push(question);
  }

  return askable;
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
 */
export function answeredQuestions(questions, experiment) {
  const reviewable = [];
  for (const question of questions) {
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
