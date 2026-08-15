// The copy-out prompt for the chat-LLM round trip (Phase 1): a user with no
// local model copies this into ChatGPT/Claude/whatever, pastes the reply
// back, and engine/llmproposals.js validates it exactly as it validates a
// real Ollama reply. That symmetry is the entire point -- see
// engine/llmreply.js's header for why a chat reply needs tolerant parsing on
// the way in, and llmproposals.js:14 for why the vocabulary re-check exists
// regardless of source.
//
// Ollama's path gets its output structure enforced by the JSON Schema
// engine/llmschema.js builds (constrained decoding: an out-of-vocabulary
// token literally cannot be sampled). A chat UI has no such mechanism, so
// this module's job is to make the SAME contract legible to a model that can
// only be told, not constrained -- explicit format, a worked example, and a
// stated consequence for going outside the vocabulary (silently discarded),
// because chat models follow consequences far more reliably than bare
// instructions.
//
// Deliberately does NOT stringify buildProposalSchema(questions) into the
// prompt: that schema is an `anyOf` of one variant per question, already
// large, and would roughly double an already lengthy prompt while buying
// nothing without constrained decoding on the receiving end. A worked
// example carries the format better than a schema a chat model cannot
// enforce against itself.
//
// Leaf module: imports nothing. `questions` is engine/interview.js's
// loadQuestions(...).questions (or any array shaped the same way).

// Moved out of ui/steps/describe.js (was DRAFT_SYSTEM_PROMPT) so the local
// (Ollama) and chat-LLM paths state the SAME never-invent rules from one
// place rather than two copies that can drift. The chat path appends its own
// answer-format block (below) instead of DRAFT_SYSTEM_PROMPT's original
// last line ("Return JSON matching the supplied schema") -- there is no
// schema on this path, only this prompt.
export const PROPOSAL_SYSTEM_PROMPT = [
  'You are filling in a microscopy experiment plan from the researcher’s own description.',
  '',
  'Rules:',
  '- Answer ONLY the questions supplied, using ONLY the options offered for each.',
  '- Omit any question the description does not actually answer. An omission is',
  '  correct and expected; a guess is not. Do not infer a value to be helpful.',
  '- Never invent a marker, filter, control, instrument setting, or option that is',
  '  not in the list you were given.',
  '- Separately from the questions: name anything a careful researcher would still',
  '  need to decide or measure before running this, that is not one of the supplied',
  '  questions and that you cannot answer from the description. Use the "asks" list',
  '  for this -- never guess a value to fill a gap. In particular, always check:',
  '  the actual research question this experiment is meant to answer, whether the',
  '  smallest feature that matters has been named (this sets how finely to sample',
  '  the image), whether the planned controls fit the readout, and whether any two',
  '  planned fluorophores/channels risk spectral overlap.',
].join('\n');

/**
 * One human-readable line per question, in bank order. Shared by BOTH the
 * Ollama call sites (ui/steps/describe.js) and this module's chat-LLM prompt,
 * so the local and chat paths can never describe a question differently.
 *
 * Options are quoted and separated with ' | ', not comma-joined:
 * engine/llmproposals.js:63 compares with `String(a) === String(b)`, no trim,
 * no case fold, and an option like "Scratch / migration" already contains a
 * comma-adjacent slash and spaces -- a bare comma-join leaves it ambiguous
 * where one option ends and the next begins. Quoting removes the ambiguity
 * instead of trusting a model to infer it.
 *
 * Number-typed questions get a trailing "(number)" marker: engine/
 * llmproposals.js's coerceValue accepts "3" but drops "three".
 *
 * Never mentions "Other" or any escape hatch: engine/llmproposals.js:51-56
 * deliberately ignores `allowOther` for model-sourced values (constrained
 * questions stay closed to a model even when a human could pick Other), so
 * advertising an escape hatch here would only invite values that get
 * silently discarded on the way back in.
 */
export function renderQuestionLines(questions) {
  const list = Array.isArray(questions) ? questions : [];
  return list
    .map((q) => {
      const hasOptions = Array.isArray(q.options) && q.options.length > 0;
      const numberHint = q.type === 'number' ? '  (number)' : '';
      const header = `- ${q.field}: ${q.prompt}${numberHint}`;
      if (!hasOptions) return header;
      const choices = q.options.map((opt) => `"${opt}"`).join(' | ');
      return `${header}\n    CHOICES (copy one exactly): ${choices}`;
    })
    .join('\n');
}

const ANSWER_FORMAT_BLOCK = [
  '--- HOW TO REPLY ---',
  'Reply with ONE JSON object and nothing else. No explanation before it, none after.',
  'A ```json code fence around it is fine.',
  '',
  '{',
  '  "proposals": [',
  '    { "path": "<a path copied from the QUESTIONS list below>",',
  '      "value": "<your answer>",',
  '      "tag": "llm_freetext" }',
  '  ],',
  '  "asks": [',
  '    { "topic": "<what still needs deciding or measuring>",',
  '      "why": "<one sentence -- why it matters>" }',
  '  ]',
  '}',
  '',
  '- "path" MUST be copied character-for-character from the QUESTIONS list.',
  '  Any other path is discarded without being read.',
  '- "value" is a plain string -- or a plain number for a question marked (number).',
  '  Never an object, never an array, never null.',
  '- "tag" is always the literal string "llm_freetext".',
  '- For a question with a CHOICES list, "value" MUST be one of those strings copied',
  '  character-for-character, including capitalisation, spaces and punctuation.',
  '  Anything else is discarded without being read.',
  '- One "proposals" entry per question you can actually answer from the description.',
  '  Omit every other question. "proposals": [] is a valid and correct reply.',
  '- "asks" is for the things named in the rules above (research question, smallest',
  '  feature, controls, spectral overlap) plus anything else you genuinely cannot',
  '  answer from the description. It never writes an answer -- it only tells the',
  '  researcher what to go decide. "asks": [] is valid if nothing applies.',
  '- Add no other keys anywhere.',
  '',
  'EXAMPLE OF A WELL-FORMED REPLY (the values are illustrative -- do not copy them):',
  '{"proposals":[{"path":"acquisition.modality","value":"confocal","tag":"llm_freetext"},',
  '{"path":"naming.fields.markers","value":"DAPI, Alexa 488","tag":"llm_freetext"}],',
  '"asks":[{"topic":"smallest feature that must be resolved","why":"sets the pixel size',
  'needed -- not stated in the description"}]}',
].join('\n');

/**
 * Build the full copy-out prompt: system rules, the answer-format contract,
 * the question list, and the researcher's own description.
 *
 * TOTAL: never throws. Missing/malformed `questions` renders as "(no
 * questions)"; a missing/empty `narrative` renders as "(no description
 * given)" -- both honest placeholders rather than a broken prompt.
 * Deterministic: identical inputs produce byte-identical output.
 */
export function renderProposalRequestPrompt(questions, narrative) {
  const questionLines = renderQuestionLines(questions);
  const description = typeof narrative === 'string' && narrative.trim() ? narrative : '';

  return [
    PROPOSAL_SYSTEM_PROMPT,
    '',
    ANSWER_FORMAT_BLOCK,
    '',
    '--- QUESTIONS ---',
    questionLines || '(no questions)',
    '',
    '--- DESCRIPTION ---',
    description || '(no description given)',
  ].join('\n');
}
