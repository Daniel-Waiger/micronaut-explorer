// Tests for engine/kbpack.js's shapeAppKb -- the pure function that used to
// be unreachable inline code inside main.js's loadAppKb (main.js calls
// init() at module scope, so nothing there could ever be imported by a
// test). This file is the direct countermeasure to the class of bug this
// project has already shipped once: a new knowledge-pack key (here,
// 'advisor') silently going nowhere because nothing wired it up by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeAppKb } from '../src/engine/kbpack.js';

function validAdvisorRule() {
  return {
    id: 'sted-photobleaching',
    surfaces: ['design'],
    kind: 'pitfall',
    concept: 'photobleaching',
    title: 'STED bleaches far faster than confocal',
    body: 'The depletion beam deposits far more energy per pixel than excitation alone, so photostability outweighs brightness.',
    when: { matches: ['acquisition.modality', '[Ss][Tt][Ee][Dd]'] },
    priority: 0,
  };
}

// --- The bug this module exists to prevent ---------------------------------

test('a raw.advisor pack reaches the returned advisor rules -- the exact wiring the allowOther bug lacked', () => {
  const { advisor, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    questions: [],
    advisor: { version: 1, rules: [validAdvisorRule()] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
  });
  assert.equal(issues.length, 0);
  assert.equal(advisor.length, 1);
  assert.equal(advisor[0].id, 'sted-photobleaching');
});

test('raw.questions passes through UNTOUCHED (createDescribeStep still owns loadQuestions itself)', () => {
  const rawQuestions = [{ id: 'q', field: 'a', type: 'text', priority: 1 }];
  const { questions } = shapeAppKb({ questions: rawQuestions });
  assert.deepEqual(questions, rawQuestions);
});

test('raw.readouts and raw.controls reach the returned readouts/controlRules -- the same wiring gap advisor once had', () => {
  const { readouts, controlRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    advisor: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
    readouts: { version: 1, readouts: { ros: { label: 'Intracellular ROS', aliases: ['dcf'] } } },
    controls: {
      version: 1,
      rules: [
        {
          id: 'ros-positive-control',
          kind: 'readout',
          title: 'H2O2-treated positive control',
          why: 'A hydrogen-peroxide-treated sample gives DCF a known, strong oxidative signal before trusting a subtler one.',
          when: { eq: ['readout', 'ros'] },
          priority: 0,
        },
      ],
    },
  });
  assert.equal(issues.length, 0);
  assert.deepEqual(readouts.ros, { label: 'Intracellular ROS', aliases: ['dcf'] });
  assert.equal(controlRules.length, 1);
  assert.equal(controlRules[0].id, 'ros-positive-control');
});

test('missing raw.readouts/raw.controls degrade to empty shapes plus issues, never silence or a throw', () => {
  const { readouts, controlRules, issues } = shapeAppKb({});
  assert.deepEqual(readouts, {});
  assert.deepEqual(controlRules, []);
  assert.ok(issues.some((i) => /readouts pack is missing/.test(i.message)));
  assert.ok(issues.some((i) => /controls pack is missing/.test(i.message) || /export_markers_kb\.py/.test(i.message)));
});

test('raw.stages reaches the returned stages/stageRules -- the same wiring gap advisor once had', () => {
  const { stages, stageRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    advisor: { version: 1, rules: [] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: {
      version: 1,
      stages: [{ id: 'idea', order: 10, title: 'Idea', body: 'x'.repeat(40) }],
      rules: [{ id: 'note-1', stage: 'idea', when: { exists: 'researchQuestion' }, note: 'y'.repeat(40), priority: 0 }],
    },
  });
  assert.equal(issues.length, 0);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].id, 'idea');
  assert.equal(stageRules.length, 1);
  assert.equal(stageRules[0].id, 'note-1');
});

test('missing raw.stages degrades to empty shapes plus an issue, never silence or a throw', () => {
  const { stages, stageRules, issues } = shapeAppKb({});
  assert.deepEqual(stages, []);
  assert.deepEqual(stageRules, []);
  assert.ok(issues.some((i) => /stages pack is missing/.test(i.message)));
});

// --- Totality: every combination of absent/malformed input degrades cleanly

test('a raw object with every sub-pack present yields zero issues', () => {
  const { index, questions, advisor, readouts, controlRules, stages, stageRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    questions: [],
    advisor: { version: 1, rules: [] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
  });
  assert.deepEqual(questions, []);
  assert.deepEqual(advisor, []);
  assert.deepEqual(readouts, {});
  assert.deepEqual(controlRules, []);
  assert.deepEqual(stages, []);
  assert.deepEqual(stageRules, []);
  assert.deepEqual(issues, []);
  assert.ok(index); // indexKb's own shape, exercised by kb.test.js
});

test('a genuinely empty raw object ({}) reports BOTH sub-packs missing, not silence', () => {
  const { questions, advisor, issues } = shapeAppKb({});
  assert.deepEqual(questions, []);
  assert.deepEqual(advisor, []);
  assert.ok(issues.some((i) => /knowledge pack is missing/.test(i.message)));
  assert.ok(issues.some((i) => /export_markers_kb\.py/.test(i.message)));
});

test('undefined/null/non-object raw never throws and degrades to the same empty shape', () => {
  for (const raw of [undefined, null, 'nope', 42, []]) {
    const { questions, advisor, issues } = shapeAppKb(raw);
    assert.deepEqual(questions, []);
    assert.deepEqual(advisor, []);
    // Missing markers pack is a real ('fatal') issue in loadKb; that is
    // pre-existing behaviour this module must not change.
    assert.ok(issues.length >= 1, String(raw));
  }
});

test('a missing raw.advisor key reports the advisor "run the exporter" issue, not silence', () => {
  const { advisor, issues } = shapeAppKb({ markers: { version: 1, markers: {}, ambiguousInFreeText: [] } });
  assert.deepEqual(advisor, []);
  assert.ok(issues.some((i) => /export_markers_kb\.py/.test(i.message)));
});

// --- issues merges both sub-packs into one list for a single caller count --

test('issues merges marker-pack AND advisor-pack issues into one array', () => {
  const { issues } = shapeAppKb({
    markers: { version: 99 }, // wrong version -> fatal marker issue
    advisor: { rules: [{ id: 'bad kind bad' }] }, // -> at least one advisor issue
  });
  assert.ok(issues.some((i) => /knowledge pack version/.test(i.message)), 'expected the marker issue');
  assert.ok(issues.some((i) => i.field !== undefined), 'expected at least one advisor-shaped issue with a field');
});

test('shapeAppKb never mutates the raw object it is given', () => {
  const raw = { markers: { version: 1, markers: {}, ambiguousInFreeText: [] }, questions: [], advisor: { rules: [] } };
  const before = JSON.stringify(raw);
  shapeAppKb(raw);
  assert.equal(JSON.stringify(raw), before);
});
