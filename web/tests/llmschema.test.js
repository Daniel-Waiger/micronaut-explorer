// Tests for engine/llmschema.js -- the constrained-decoding schema builder
// that makes an LLM's proposal vocabulary a token-level guarantee, not a
// prompt instruction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuestions } from '../src/engine/interview.js';
import { buildProposalSchema } from '../src/engine/llmschema.js';

const RAW_QUESTIONS = [
  { id: 'q-modality', field: 'acquisition.modality', type: 'choice', prompt: 'Modality?', options: ['Confocal', 'STED'] },
  { id: 'q-notes', field: 'naming.fields.notes', type: 'text', prompt: 'Notes?' },
  { id: 'q-n', field: 'design.biologicalReplicates', type: 'number', prompt: 'How many replicates?' },
];

function schemaFor(id, schema) {
  return schema.properties.proposals.items.anyOf.find(
    (variant) => variant.properties.path.const === RAW_QUESTIONS.find((q) => q.id === id).field
  );
}

test('a choice question enum is exactly its own options array', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  const modality = schemaFor('q-modality', schema);
  assert.deepEqual(modality.properties.value, { type: 'string', enum: ['Confocal', 'STED'] });
});

test('a text question has no enum -- free text stays free text', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  const notes = schemaFor('q-notes', schema);
  assert.deepEqual(notes.properties.value, { type: 'string' });
  assert.ok(!('enum' in notes.properties.value));
});

test('a number question is typed number, not enumerated', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  const n = schemaFor('q-n', schema);
  assert.deepEqual(n.properties.value, { type: 'number' });
});

test('path and tag are fixed to the question\'s own field -- a proposal cannot redirect to a different slot', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  const modality = schemaFor('q-modality', schema);
  assert.deepEqual(modality.properties.path, { const: 'acquisition.modality' });
  assert.deepEqual(modality.properties.tag, { const: 'llm_freetext' });
  assert.deepEqual(modality.required, ['path', 'value', 'tag']);
  assert.equal(modality.additionalProperties, false);
});

test('an empty question bank forbids any proposal item -- nothing to ask about, nothing should be emitted', () => {
  const schema = buildProposalSchema([]);
  assert.equal(schema.properties.proposals.items, false);
});

test('non-array input is treated as no questions, never throws', () => {
  assert.doesNotThrow(() => buildProposalSchema(undefined));
  assert.doesNotThrow(() => buildProposalSchema(null));
  const schema = buildProposalSchema('nope');
  assert.equal(schema.properties.proposals.items, false);
});
