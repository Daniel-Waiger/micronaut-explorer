// Builds a JSON Schema for constrained decoding (Ollama's `format` field,
// or any OpenAI-compatible `response_format: json_schema`) from an
// already-loaded question bank (engine/interview.js's loadQuestions
// output). This is the mechanism that makes "the model can only choose from
// vocabulary the app supplies" true at the token level, not by prompt
// instruction alone: a choice/multi question's `value` schema is an `enum`
// built from that question's own `options` array, so the sampler cannot
// produce anything outside it.
//
// Leaf module: import nothing. Takes `questions` -- loadQuestions'
// normalized output array, never a raw question bank -- so a malformed
// entry has already been dropped and reported there, not silently
// re-validated (or mis-validated) here.

/**
 * The schema for one question's answer value.
 * - choice/multi WITH a non-empty options array -> {type:'string', enum}.
 * - number -> {type:'number'}.
 * - text, or a choice/multi with no options (loadQuestions rejects that
 *   combination, but this module does not trust that upstream guarantee) ->
 *   plain {type:'string'}, deliberately with NO enum -- an unconstrained
 *   free-text answer is still allowed to be free text; only vocabulary the
 *   app actually curated gets locked down.
 */
function valueSchemaFor(question) {
  const hasOptions =
    (question.type === 'choice' || question.type === 'multi') &&
    Array.isArray(question.options) &&
    question.options.length > 0;
  if (hasOptions) {
    return { type: 'string', enum: question.options.slice() };
  }
  if (question.type === 'number') {
    return { type: 'number' };
  }
  return { type: 'string' };
}

/**
 * One write-descriptor schema for `question`, mirroring the exact shape
 * engine/interview.js's recordAnswer returns: {path, value, tag}. `path`
 * and `tag` are fixed with `const` to the question's OWN field/tag rather
 * than left open -- the model is offered a slot to fill, not a free choice
 * of which slot to write or what provenance to claim for it.
 */
function descriptorSchemaFor(question) {
  return {
    type: 'object',
    properties: {
      path: { const: question.field },
      value: valueSchemaFor(question),
      tag: { const: 'llm_freetext' },
      // The model must cite a literal, bounded span of the narrative for
      // every proposal. PWR-03 verifies that the returned text is actually
      // present in the exact narrative snapshot before it becomes a review
      // candidate.
      evidence: { type: 'string', minLength: 1, maxLength: 500 },
    },
    required: ['path', 'value', 'tag', 'evidence'],
    additionalProperties: false,
  };
}

/**
 * `questions` is loadQuestions(...).questions (or any array shaped the same
 * way). Returns a JSON Schema for `{ proposals: [descriptor, ...], asks? }`,
 * one descriptor variant per question via `anyOf` -- so a proposal that
 * claims to answer question A can only carry question A's own options, never
 * question B's. Proposals are the only decision-critical required top-level
 * key: asks are advisory and never write a field.
 *
 * An empty `questions` array yields a schema whose `proposals` can only be
 * an empty array (`items: false`, meaning "no item shape is valid") --
 * there is nothing this study could be asked about, so nothing should be
 * emitted, rather than leaving the shape unconstrained.
 */
export function buildProposalSchema(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const variants = list.map(descriptorSchemaFor);
  return {
    type: 'object',
    properties: {
      proposals: {
        type: 'array',
        items: variants.length > 0 ? { anyOf: variants } : false,
        maxItems: variants.length,
      },
      asks: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', minLength: 1, maxLength: 300 },
            why: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['topic'],
          additionalProperties: false,
        },
      },
    },
    required: ['proposals'],
    additionalProperties: false,
  };
}
