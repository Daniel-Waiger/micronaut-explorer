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
  assert.deepEqual(modality.required, ['path', 'value', 'tag', 'evidence']);
  assert.equal(modality.additionalProperties, false);
});

test('every proposal requires a non-empty, bounded narrative evidence quote', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  const modality = schemaFor('q-modality', schema);

  assert.deepEqual(modality.properties.evidence, {
    type: 'string',
    minLength: 1,
    maxLength: 500,
  });
});

test('optional asks are bounded advisory records with a required topic and optional why', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  const asks = schema.properties.asks;

  assert.ok('asks' in schema.properties);
  assert.deepEqual(schema.required, ['proposals']);
  assert.equal(asks.type, 'array');
  assert.equal(asks.maxItems, 12);
  assert.deepEqual(asks.items.required, ['topic']);
  assert.deepEqual(asks.items.properties.topic, {
    type: 'string',
    minLength: 1,
    maxLength: 300,
  });
  assert.deepEqual(asks.items.properties.why, {
    type: 'string',
    minLength: 1,
    maxLength: 300,
  });
  assert.equal(asks.items.additionalProperties, false);
  assert.equal(schema.additionalProperties, false);
});

test('proposal items are bounded to the available question variants', () => {
  const { questions } = loadQuestions(RAW_QUESTIONS);
  const schema = buildProposalSchema(questions);
  assert.equal(schema.properties.proposals.maxItems, questions.length);
});

test('an empty question bank forbids proposal items but still permits bounded advisory asks', () => {
  const schema = buildProposalSchema([]);
  assert.equal(schema.properties.proposals.items, false);
  assert.equal(schema.properties.proposals.maxItems, 0);
  assert.equal(schema.properties.asks.maxItems, 12);
  assert.deepEqual(schema.required, ['proposals']);
});

test('non-array input is treated as no questions, never throws', () => {
  assert.doesNotThrow(() => buildProposalSchema(undefined));
  assert.doesNotThrow(() => buildProposalSchema(null));
  const schema = buildProposalSchema('nope');
  assert.equal(schema.properties.proposals.items, false);
  assert.equal(schema.properties.proposals.maxItems, 0);
});
