// LLM-sourced proposal ingest: turn a model's schema-constrained JSON reply
// (engine/llmschema.js built the schema) into the SAME proposal shape
// engine/freetext.js already produces, so ui/steps/describe.js's existing
// review list renders both without knowing which tier a proposal came from.
//
// Every proposal is tagged 'llm_freetext' (PROVISIONAL, core/provenance.js).
// This module NEVER writes to the store -- canOverwrite then structurally
// guarantees a model proposal can never clobber a value the user actually
// typed, exactly as freetext.js's WEAK 'freetext' tier already relies on.
//
// BELT AND BRACES, deliberately: constrained decoding should already make
// an out-of-vocabulary value impossible, but every value is re-checked
// against the question's own `options` here anyway. Three reasons that is
// not redundant: a provider may not honor `format` (the manual-paste
// adapter definitely does not -- a human pastes that reply back by hand),
// a schema can be mis-built, and a future provider may be added that
// silently ignores the constraint. The vocabulary check belongs where the
// data enters the app, not where we hope it was enforced.
//
// Leaf module: import nothing (the question list is passed in, from
// interview.js's loadQuestions, rather than read from a global here) --
// same discipline as freetext.js's `index` parameter.

const PROPOSAL_TAG = 'llm_freetext';

function proposalIssue(field, message) {
  return { field, message, severity: 'error' };
}

/**
 * Index the question bank by the field path each question writes to. The
 * model's descriptors address a `path`, not a question id (that is what
 * llmschema.js pins with `const`), so this is the lookup that reconnects a
 * returned descriptor to the question whose vocabulary it must satisfy.
 */
function byField(questions) {
  const map = new Map();
  for (const question of Array.isArray(questions) ? questions : []) {
    if (question && typeof question.field === 'string') {
      map.set(question.field, question);
    }
  }
  return map;
}

/**
 * True if `value` is acceptable for `question`. A choice/multi question with
 * a non-empty options array is the ONLY case that constrains the value --
 * matching valueSchemaFor in engine/llmschema.js exactly, so what the schema
 * asks for and what this accepts can never disagree.
 *
 * `allowOther` deliberately does NOT relax this. A human picking "Other..."
 * is asserting a fact about their own experiment; a model emitting a value
 * outside the curated list is doing the one thing this whole tier exists to
 * prevent. The escape hatch is the user's, not the model's.
 */
function valueIsInVocabulary(question, value) {
  const constrained =
    (question.type === 'choice' || question.type === 'multi') &&
    Array.isArray(question.options) &&
    question.options.length > 0;
  if (!constrained) return true;
  return question.options.some((option) => String(option) === String(value));
}

function coerceValue(question, value) {
  if (question.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

/**
 * Parse a model reply into { proposals, issues }.
 *
 * `reply` is the parsed JSON object a provider returned (llm/ollama.js's
 * `json`), expected to be `{ proposals: [{path, value, tag}, ...] }`.
 * `questions` is engine/interview.js's loadQuestions(...).questions.
 *
 * TOTAL: never throws. A malformed reply, a descriptor addressing an unknown
 * path, or a value outside the question's vocabulary is DROPPED and reported
 * in `issues` -- never silently kept, and never fatal to the other
 * proposals in the same reply. Same posture as loadQuestions: one bad entry
 * costs you that entry, not the whole batch.
 *
 * Returns proposals in the question bank's own order rather than the
 * model's, so the review list's ordering is a property of the app (stable,
 * reproducible) rather than of whatever order a model happened to emit.
 */
export function parseLlmProposals(reply, questions) {
  const issues = [];
  const questionByField = byField(questions);

  const rawList = reply && typeof reply === 'object' && Array.isArray(reply.proposals) ? reply.proposals : null;
  if (!rawList) {
    return {
      proposals: [],
      issues: [proposalIssue('proposals', 'model reply had no `proposals` array')],
    };
  }

  const accepted = new Map();
  rawList.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(proposalIssue(`[${index}]`, 'proposal entry is not an object'));
      return;
    }
    const path = typeof entry.path === 'string' ? entry.path.trim() : '';
    if (!path) {
      issues.push(proposalIssue(`[${index}]`, 'proposal is missing a non-empty path'));
      return;
    }
    const question = questionByField.get(path);
    if (!question) {
      issues.push(proposalIssue(path, `no question writes to '${path}' -- proposal dropped`));
      return;
    }
    if (entry.value === undefined || entry.value === null || entry.value === '') {
      issues.push(proposalIssue(path, 'proposal has no value'));
      return;
    }
    if (!valueIsInVocabulary(question, entry.value)) {
      issues.push(
        proposalIssue(path, `'${String(entry.value)}' is not one of this question's options -- proposal dropped`)
      );
      return;
    }
    const value = coerceValue(question, entry.value);
    if (value === null) {
      issues.push(proposalIssue(path, `'${String(entry.value)}' is not a number -- proposal dropped`));
      return;
    }
    // A model that emits the same path twice is answering one question two
    // ways. Keeping the first and reporting the rest is the only choice that
    // does not silently pick a winner.
    if (accepted.has(path)) {
      issues.push(proposalIssue(path, 'duplicate proposal for this path -- kept the first'));
      return;
    }

    accepted.set(path, {
      path,
      value,
      // Always this module's own tag, never `entry.tag` -- a reply is data,
      // not an authority on its own trust level. Echoing a model-supplied
      // tag would let a malformed (or adversarial) reply claim 'user' and
      // walk straight past canOverwrite's provenance gate.
      tag: PROPOSAL_TAG,
      questionId: question.id,
      prompt: question.prompt,
      // Shaped like freetext.js's proposals so describe.js's row renderer
      // needs no branch: `evidence` is what justified this value. The model
      // reasoned over the user's own paragraph, so the honest evidence
      // string is the question it answered, not a text span it never cited.
      evidence: question.prompt,
      confidence: 0.5,
    });
  });

  // Question-bank order, not model order (see the docstring).
  const proposals = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    const hit = question && accepted.get(question.field);
    if (hit) proposals.push(hit);
  }

  return { proposals, issues };
}
