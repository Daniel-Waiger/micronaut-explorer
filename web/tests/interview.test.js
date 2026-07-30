import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  interviewProgress,
  isSkipped,
  loadQuestions,
  nextQuestions,
  recordAnswer,
  skipQuestion,
  answeredQuestions,
  unskipQuestion,
} from '../src/engine/interview.js';
import { emptyExperiment } from '../src/core/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const questionsPath = path.join(here, '..', 'kb', 'questions.json');
const realQuestionsRaw = JSON.parse(readFileSync(questionsPath, 'utf-8'));

function withSlot(experiment, field, tag, value) {
  const next = JSON.parse(JSON.stringify(experiment));
  next.provenance.slots[field] = { tag, detail: null };
  // Mirror store.js's own dotted-path writer semantics well enough for a
  // test fixture: only simple 'a.b.c' paths are used here.
  const segments = field.split('.');
  let cursor = next;
  for (let i = 0; i < segments.length - 1; i++) {
    cursor = cursor[segments[i]];
  }
  cursor[segments[segments.length - 1]] = value;
  return next;
}

function sampleQuestions() {
  return loadQuestions([
    { id: 'q1', field: 'naming.fields.sample', type: 'text', priority: 1, tag: 'user' },
    { id: 'q2', field: 'naming.fields.exptype', type: 'text', priority: 2, tag: 'user' },
    {
      id: 'q3',
      field: 'naming.fields.notes',
      type: 'text',
      priority: 3,
      tag: 'user',
      askWhen: { eq: ['naming.fields.sample', 'E02'] },
    },
  ]).questions;
}

test('loadQuestions accepts a well-formed bank with zero issues', () => {
  const questions = sampleQuestions();
  assert.equal(questions.length, 3);
});

test('loadQuestions reports (not throws) a duplicate id', () => {
  const { questions, issues } = loadQuestions([
    { id: 'dup', field: 'a', type: 'text', priority: 1 },
    { id: 'dup', field: 'b', type: 'text', priority: 2 },
  ]);
  assert.equal(questions.length, 1);
  assert.ok(issues.some((i) => /duplicate question id/.test(i.message)));
});

test('loadQuestions reports (not throws) a choice question missing options', () => {
  const { questions, issues } = loadQuestions([
    { id: 'bad-choice', field: 'a', type: 'choice', priority: 1 },
  ]);
  assert.equal(questions.length, 0);
  assert.ok(issues.some((i) => i.field === 'bad-choice' && /options/.test(i.message)));
});

// loadQuestions builds an explicit whitelist object rather than spreading the
// raw entry -- a real bug this pins: allowOther was added to the question
// SHAPE but not to that whitelist, so it was silently dropped and the UI's
// `question.allowOther` check never saw it despite the source data being
// correct.
test('loadQuestions preserves allowOther:true on a choice question', () => {
  const { questions } = loadQuestions([
    { id: 'modality', field: 'acquisition.modality', type: 'choice', options: ['a', 'b'], allowOther: true, priority: 1 },
  ]);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].allowOther, true);
});

test('loadQuestions defaults allowOther to false when absent, and coerces a truthy-but-non-boolean value', () => {
  const { questions } = loadQuestions([
    { id: 'q-absent', field: 'a', type: 'text', priority: 1 },
    { id: 'q-truthy', field: 'b', type: 'text', priority: 2, allowOther: 'yes' },
  ]);
  assert.equal(questions.find((q) => q.id === 'q-absent').allowOther, false);
  // 'yes' is truthy but not === true -- must not leak a non-boolean through.
  assert.equal(questions.find((q) => q.id === 'q-truthy').allowOther, false);
});

test('a question whose askWhen predicate is false is NOT returned', () => {
  const questions = sampleQuestions();
  const experiment = emptyExperiment(); // sample is '', so q3's eq-'E02' askWhen is false
  const askable = nextQuestions(questions, experiment, 10);
  assert.ok(!askable.some((q) => q.id === 'q3'));
});

test('a question whose askWhen predicate becomes true IS returned', () => {
  const questions = sampleQuestions();
  const experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'user', 'E02');
  const askable = nextQuestions(questions, experiment, 10);
  assert.ok(askable.some((q) => q.id === 'q3'));
});

test('a question whose slot holds a STRONG (user) tag is NOT re-asked', () => {
  const questions = sampleQuestions();
  const experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'user', 'E02');
  const askable = nextQuestions(questions, experiment, 10);
  assert.ok(!askable.some((q) => q.id === 'q1'));
});

test('a question whose slot holds only a freetext (WEAK) tag IS still asked, with a suggestedDefault', () => {
  const questions = sampleQuestions();
  const experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'freetext', 'E02');
  const askable = nextQuestions(questions, experiment, 10);
  const q1 = askable.find((q) => q.id === 'q1');
  assert.ok(q1, 'freetext-tagged slot must still be askable');
  assert.equal(q1.suggestedDefault, 'E02');
});

test('skipping a question removes it from nextQuestions and lands in provenance.skipped', () => {
  const questions = sampleQuestions();
  let experiment = emptyExperiment();
  assert.ok(nextQuestions(questions, experiment, 10).some((q) => q.id === 'q1'));

  experiment = skipQuestion(experiment, 'q1');
  assert.ok(isSkipped(experiment, 'q1'));
  assert.deepEqual(experiment.provenance.skipped, ['q1']);
  assert.ok(!nextQuestions(questions, experiment, 10).some((q) => q.id === 'q1'));
});

test('nextQuestions respects priority order', () => {
  const { questions } = loadQuestions([
    { id: 'low', field: 'a', type: 'text', priority: 100 },
    { id: 'high', field: 'b', type: 'text', priority: 1 },
    { id: 'mid', field: 'c', type: 'text', priority: 50 },
  ]);
  const ids = nextQuestions(questions, emptyExperiment(), 10).map((q) => q.id);
  assert.deepEqual(ids, ['high', 'mid', 'low']);
});

test('nextQuestions respects limit', () => {
  const { questions } = loadQuestions([
    { id: 'a', field: 'a', type: 'text', priority: 1 },
    { id: 'b', field: 'b', type: 'text', priority: 2 },
    { id: 'c', field: 'c', type: 'text', priority: 3 },
  ]);
  assert.equal(nextQuestions(questions, emptyExperiment(), 2).length, 2);
});

test('recordAnswer performs ZERO mutation on the experiment', () => {
  const question = { id: 'q1', field: 'naming.fields.sample', tag: 'user' };
  const experiment = emptyExperiment();
  const before = JSON.stringify(experiment);

  const descriptor = recordAnswer(experiment, question, 'E02');

  assert.equal(JSON.stringify(experiment), before, 'recordAnswer must not mutate its experiment argument');
  assert.deepEqual(descriptor, { path: 'naming.fields.sample', value: 'E02', tag: 'user' });
});

test('recordAnswer defaults to the user tag when a question carries none', () => {
  const descriptor = recordAnswer(emptyExperiment(), { field: 'x' }, 'v');
  assert.equal(descriptor.tag, 'user');
});

test('the committed web/kb/questions.json loads with ZERO issues', () => {
  const { questions, issues } = loadQuestions(realQuestionsRaw);
  assert.deepEqual(issues, []);
  assert.ok(questions.length > 0);
});

test('the committed modality question offers Other and covers non-optical modalities', () => {
  const { questions } = loadQuestions(realQuestionsRaw);
  const modality = questions.find((q) => q.id === 'modality');
  assert.ok(modality, 'expected a modality question in the committed bank');
  assert.equal(modality.allowOther, true);
  // Not every modality is optical -- SEM/TEM/Raman are what make biological/
  // technical replicates independently optional in the first place.
  for (const expected of ['SEM', 'TEM', 'Raman']) {
    assert.ok(
      modality.options.includes(expected),
      `expected '${expected}' among modality options, got ${JSON.stringify(modality.options)}`
    );
  }
});

test('the committed bank asks biologicalReplicates and technicalReplicates as separate, independent questions', () => {
  const { questions } = loadQuestions(realQuestionsRaw);
  const bio = questions.find((q) => q.field === 'design.biologicalReplicates');
  const tech = questions.find((q) => q.field === 'design.technicalReplicates');
  assert.ok(bio, 'expected a question targeting design.biologicalReplicates');
  assert.ok(tech, 'expected a question targeting design.technicalReplicates');
  assert.notEqual(bio.id, tech.id);
});

test('an empty Experiment: nextQuestions(limit=8) returns at most 8, covering the naming-critical fields', () => {
  const { questions, issues } = loadQuestions(realQuestionsRaw);
  assert.deepEqual(issues, []);

  const askable = nextQuestions(questions, emptyExperiment(), 8);
  assert.ok(askable.length <= 8);

  const fields = askable.map((q) => q.field);
  for (const namingField of [
    'naming.fields.date',
    'naming.fields.exptype',
    'naming.fields.sample',
    'naming.fields.magnification',
    'naming.fields.markers',
  ]) {
    assert.ok(fields.includes(namingField), `expected ${namingField} within the first 8 questions`);
  }
});

test('interviewProgress counts answered, skipped, askable and total', () => {
  const questions = sampleQuestions();
  let experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'user', 'E02');
  experiment = skipQuestion(experiment, 'q2');

  const progress = interviewProgress(questions, experiment);
  assert.equal(progress.total, 3);
  assert.equal(progress.answered, 1); // q1
  assert.equal(progress.skipped, 1); // q2
});

// --- Reviewing and revising answers ------------------------------------
// nextQuestions deliberately drops a question once its slot goes STRONG, so
// these pin the complement: what the user has already dealt with, and the
// ability to put it back into play.

test('answeredQuestions is empty on a fresh experiment', () => {
  assert.deepEqual(answeredQuestions(sampleQuestions(), emptyExperiment()), []);
});

test('answeredQuestions returns an answered question with its current value', () => {
  const questions = sampleQuestions();
  const experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'user', 'E02');

  const reviewable = answeredQuestions(questions, experiment);
  const q1 = reviewable.find((q) => q.id === 'q1');
  assert.ok(q1, `expected q1 in ${JSON.stringify(reviewable.map((q) => q.id))}`);
  assert.equal(q1.status, 'answered');
  assert.equal(q1.currentValue, 'E02');

  // ...and it is exactly the one nextQuestions now refuses to ask again.
  assert.ok(!nextQuestions(questions, experiment, 10).some((q) => q.id === 'q1'));
});

test('answeredQuestions reports a skipped question as skipped, with no value', () => {
  const questions = sampleQuestions();
  const experiment = emptyExperiment();
  skipQuestion(experiment, 'q2');

  const q2 = answeredQuestions(questions, experiment).find((q) => q.id === 'q2');
  assert.ok(q2);
  assert.equal(q2.status, 'skipped');
  assert.equal(q2.currentValue, undefined);
});

test('a WEAK freetext slot is NOT treated as answered -- it is still askable', () => {
  // The freetext tier fills slots weakly on purpose so the interview can ask
  // the user to confirm them; counting those as "answered" would hide exactly
  // the values that most need review.
  const questions = sampleQuestions();
  const experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'freetext', 'E02');

  assert.ok(!answeredQuestions(questions, experiment).some((q) => q.id === 'q1'));
  assert.ok(nextQuestions(questions, experiment, 10).some((q) => q.id === 'q1'));
});

test('unskipQuestion puts a skipped question back into the ask list', () => {
  const questions = sampleQuestions();
  const experiment = emptyExperiment();

  skipQuestion(experiment, 'q2');
  assert.ok(isSkipped(experiment, 'q2'));
  assert.ok(!nextQuestions(questions, experiment, 10).some((q) => q.id === 'q2'));

  unskipQuestion(experiment, 'q2');
  assert.ok(!isSkipped(experiment, 'q2'));
  assert.ok(nextQuestions(questions, experiment, 10).some((q) => q.id === 'q2'));
  assert.ok(!answeredQuestions(questions, experiment).some((q) => q.id === 'q2'));
});

test('unskipQuestion is a no-op for a question that was never skipped', () => {
  const experiment = emptyExperiment();
  unskipQuestion(experiment, 'q9');
  assert.deepEqual(experiment.provenance.skipped, []);
});

test('dropping an answered slot returns the question to the ask list', () => {
  // What the "Ask me again" control does: clearing the STRONG tag is what
  // makes nextQuestions willing to offer the question a second time.
  const questions = sampleQuestions();
  const experiment = withSlot(emptyExperiment(), 'naming.fields.sample', 'user', 'E02');
  assert.ok(!nextQuestions(questions, experiment, 10).some((q) => q.id === 'q1'));

  delete experiment.provenance.slots['naming.fields.sample'];
  assert.ok(nextQuestions(questions, experiment, 10).some((q) => q.id === 'q1'));
  assert.ok(!answeredQuestions(questions, experiment).some((q) => q.id === 'q1'));
});
