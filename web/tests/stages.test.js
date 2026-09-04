// Tests for engine/stages.js: the staged-progression-ladder loader (mirrors
// advisor.js/controls.js's discipline) and buildLadder. Committed-content
// guards for the REAL web/kb/stages.json live in the second half.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildLadder, loadStages, selectStageNotes } from '../src/engine/stages.js';
import { emptyExperiment } from '../src/core/schema.js';

function validPack(overrides = {}) {
  return {
    version: 1,
    stages: [
      { id: 'idea', order: 10, title: 'Idea & feasibility', body: 'x'.repeat(41) },
      { id: 'pilot', order: 20, title: 'Pilot', body: 'y'.repeat(41) },
    ],
    rules: [
      { id: 'pilot-sted', stage: 'pilot', when: { eq: ['acquisition.modality', 'STED'] }, note: 'z'.repeat(41), priority: 0 },
    ],
    ...overrides,
  };
}

// --- Loader: shape and totality ---------------------------------------

test('a well-formed pack loads with zero issues, stages sorted by order', () => {
  const { stages, rules, issues } = loadStages(
    validPack({
      stages: [
        { id: 'b', order: 20, title: 'B', body: 'x'.repeat(41) },
        { id: 'a', order: 10, title: 'A', body: 'x'.repeat(41) },
      ],
      rules: [],
    })
  );
  assert.equal(issues.length, 0);
  assert.deepEqual(stages.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(rules, []);
});

test('an absent pack (undefined/null) reports the "pack is missing" issue, never throws', () => {
  for (const raw of [undefined, null]) {
    const { stages, rules, issues } = loadStages(raw);
    assert.deepEqual(stages, []);
    assert.deepEqual(rules, []);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /stages pack is missing/);
  }
});

test('a pack missing stages/rules arrays reports an issue rather than throwing', () => {
  for (const raw of [{}, { stages: [] }, { rules: [] }, { stages: 'nope', rules: [] }, 'nope', 42]) {
    const { stages, rules, issues } = loadStages(raw);
    assert.deepEqual(stages, []);
    assert.deepEqual(rules, []);
    assert.ok(issues.length >= 1);
  }
});

test('a malformed stage entry is dropped and reported', () => {
  const { stages, issues } = loadStages(validPack({ stages: [null, 42], rules: [] }));
  assert.equal(stages.length, 0);
  assert.equal(issues.length, 2);
});

test('a stage missing a numeric order is dropped and reported', () => {
  const { stages, issues } = loadStages(
    validPack({ stages: [{ id: 'idea', title: 'Idea', body: 'x'.repeat(41) }], rules: [] })
  );
  assert.equal(stages.length, 0);
  assert.match(issues[0].message, /'order' must be a finite number/);
});

test('a stage body under the minimum length is dropped and reported', () => {
  const { stages, issues } = loadStages(
    validPack({ stages: [{ id: 'idea', order: 10, title: 'Idea', body: 'short' }], rules: [] })
  );
  assert.equal(stages.length, 0);
  assert.match(issues[0].message, /at least 40 characters/);
});

test('a duplicate stage id: first wins, second dropped and reported', () => {
  const { stages, issues } = loadStages(
    validPack({
      stages: [
        { id: 'idea', order: 10, title: 'First', body: 'x'.repeat(41) },
        { id: 'idea', order: 20, title: 'Second', body: 'x'.repeat(41) },
      ],
      rules: [],
    })
  );
  assert.equal(stages.length, 1);
  assert.equal(stages[0].title, 'First');
  assert.ok(issues.some((i) => /duplicate stage id/.test(i.message)));
});

test('a rule referencing an unknown stage is dropped and reported', () => {
  const { rules, issues } = loadStages(
    validPack({
      stages: [{ id: 'idea', order: 10, title: 'Idea', body: 'x'.repeat(41) }],
      rules: [{ id: 'r', stage: 'nonexistent', when: { exists: 'researchQuestion' }, note: 'x'.repeat(41), priority: 0 }],
    })
  );
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /references unknown stage/);
});

test('a rule referencing a stage from the SAME pack is accepted', () => {
  const { rules, issues } = loadStages(validPack());
  assert.equal(issues.length, 0);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].stage, 'pilot');
});

test('`when` missing or literal true is dropped and reported', () => {
  for (const when of [undefined, true]) {
    const rule = { id: 'r', stage: 'pilot', note: 'x'.repeat(41), priority: 0, when };
    if (when === undefined) delete rule.when;
    const { rules, issues } = loadStages(validPack({ rules: [rule] }));
    assert.equal(rules.length, 0);
    assert.match(issues[0].message, /'when' is required/);
  }
});

test('a note under the minimum length is dropped and reported', () => {
  const { rules, issues } = loadStages(
    validPack({ rules: [{ id: 'r', stage: 'pilot', when: { exists: 'researchQuestion' }, note: 'short', priority: 0 }] })
  );
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /at least 40 characters/);
});

test('a duplicate rule id: first wins, second dropped and reported', () => {
  const { rules, issues } = loadStages(
    validPack({
      rules: [
        { id: 'r', stage: 'pilot', when: { exists: 'researchQuestion' }, note: 'x'.repeat(41), priority: 0 },
        { id: 'r', stage: 'pilot', when: { exists: 'narrative.text' }, note: 'y'.repeat(41), priority: 0 },
      ],
    })
  );
  assert.equal(rules.length, 1);
  assert.ok(issues.some((i) => /duplicate stage rule id/.test(i.message)));
});

// --- selectStageNotes / buildLadder -------------------------------------

test('selectStageNotes returns only rules whose `when` passes, in priority order', () => {
  const { rules } = loadStages(
    validPack({
      rules: [
        { id: 'b', stage: 'pilot', when: { eq: ['acquisition.modality', 'STED'] }, note: 'x'.repeat(41), priority: 5 },
        { id: 'a', stage: 'pilot', when: { eq: ['acquisition.modality', 'STED'] }, note: 'y'.repeat(41), priority: 1 },
        { id: 'never', stage: 'pilot', when: { eq: ['acquisition.modality', 'SEM'] }, note: 'z'.repeat(41), priority: 0 },
      ],
    })
  );
  const exp = emptyExperiment();
  exp.acquisition = { ...exp.acquisition, modality: 'STED' };
  assert.deepEqual(selectStageNotes(rules, exp).map((r) => r.id), ['a', 'b']);
});

test('buildLadder returns EVERY stage in order, each with only its own matching notes', () => {
  const { stages, rules } = loadStages(
    validPack({
      stages: [
        { id: 'idea', order: 10, title: 'Idea', body: 'x'.repeat(41) },
        { id: 'pilot', order: 20, title: 'Pilot', body: 'y'.repeat(41) },
      ],
      rules: [{ id: 'pilot-sted', stage: 'pilot', when: { eq: ['acquisition.modality', 'STED'] }, note: 'z'.repeat(41), priority: 0 }],
    })
  );
  const exp = emptyExperiment();
  exp.acquisition = { ...exp.acquisition, modality: 'STED' };
  const ladder = buildLadder(stages, rules, exp);
  assert.deepEqual(ladder.map((s) => s.id), ['idea', 'pilot']);
  assert.deepEqual(ladder[0].notes, []);
  assert.equal(ladder[1].notes.length, 1);
  assert.equal(ladder[1].notes[0], 'z'.repeat(41));
});

test('buildLadder on emptyExperiment() returns every stage with zero notes -- no guidance before the user has entered anything', () => {
  const { stages, rules } = loadStages(validPack());
  const ladder = buildLadder(stages, rules, emptyExperiment());
  assert.equal(ladder.length, stages.length);
  for (const stage of ladder) assert.deepEqual(stage.notes, []);
});

// ============================================================================
// Committed content: reads the REAL web/kb/stages.json.
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const stagesRaw = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'stages.json'), 'utf-8'));

test('the real web/kb/stages.json loads with ZERO issues', () => {
  const { issues } = loadStages(stagesRaw);
  assert.deepEqual(issues, []);
});

test('the real stage backbone has exactly 5 stages in the documented order', () => {
  const { stages } = loadStages(stagesRaw);
  assert.deepEqual(
    stages.map((s) => s.id),
    ['idea', 'pilot', 'validate-controls', 'acquisition-settings', 'advanced-modality']
  );
});

test('buildLadder(realStages, realRules, emptyExperiment()) has every stage present with zero notes', () => {
  const { stages, rules } = loadStages(stagesRaw);
  const ladder = buildLadder(stages, rules, emptyExperiment());
  assert.equal(ladder.length, 5);
  for (const stage of ladder) assert.deepEqual(stage.notes, []);
});

test('every committed stage rule fires on at least one experiment (the never-fires guard)', () => {
  const { rules } = loadStages(stagesRaw);
  const modalityCandidates = ['STED', 'light-sheet', 'SEM', 'TEM', 'confocal', 'widefield'];
  const readoutCandidates = ['bacterial-viability', 'ros', 'scratch-migration', 'macrophage-cytoskeleton'];
  for (const rule of rules) {
    const fired =
      modalityCandidates.some((modality) => {
        const exp = emptyExperiment();
        exp.acquisition = { ...exp.acquisition, modality };
        return selectStageNotes([rule], exp).length > 0;
      }) ||
      readoutCandidates.some((readout) => {
        const exp = { ...emptyExperiment(), readout, readoutText: readout };
        return selectStageNotes([rule], exp).length > 0;
      });
    assert.ok(fired, `stage rule '${rule.id}' never fired for any candidate modality or readout`);
  }
});
