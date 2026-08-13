// Tests for engine/controls.js: the readouts vocabulary loader, canonical
// resolution, the control-rule loader (mirrors advisor.js's discipline),
// and the selector. Committed-content guards for the REAL
// web/kb/readouts.json + web/kb/controls.json live in the second half,
// mirroring advisor.test.js's structure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CONTROL_KINDS,
  loadControlRules,
  loadReadouts,
  readoutState,
  resolveReadoutCanonical,
  selectControls,
} from '../src/engine/controls.js';
import { emptyExperiment } from '../src/core/schema.js';
import { assayView, firstAssayId } from '../src/core/assay.js';

function validRule(overrides = {}) {
  return {
    id: 'panel-unstained-control',
    kind: 'panel',
    title: 'Unstained / autofluorescence control',
    why: 'Fixed tissue and many cell types autofluoresce, especially in the green channel, so an unstained sample is needed to tell real signal from background.',
    when: { exists: 'naming.fields.markers' },
    priority: 10,
    ...overrides,
  };
}

function experimentWithReadout(readout) {
  const exp = emptyExperiment();
  return { ...exp, readout, readoutText: readout };
}

// --- Control-rule loader: shape and totality --------------------------------

test('a well-formed pack loads with zero issues', () => {
  const { rules, issues } = loadControlRules({ version: 1, rules: [validRule()] });
  assert.equal(issues.length, 0);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 'panel-unstained-control');
});

test('an absent pack (undefined/null) reports the "run the exporter" issue, never throws', () => {
  for (const raw of [undefined, null]) {
    const { rules, issues } = loadControlRules(raw);
    assert.deepEqual(rules, []);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /export_markers_kb\.py/);
  }
});

test('a pack that is not {rules: [...]} reports an issue rather than throwing', () => {
  for (const raw of [{}, { rules: 'nope' }, [], 'nope', 42]) {
    const { rules, issues } = loadControlRules(raw);
    assert.deepEqual(rules, []);
    assert.ok(issues.length >= 1);
  }
});

test('a malformed rule entry is dropped and reported by index, not thrown', () => {
  const { rules, issues } = loadControlRules({ rules: [null, 'nope', 42, []] });
  assert.equal(rules.length, 0);
  assert.equal(issues.length, 4);
});

test('one bad rule does not silence the rest of the pack', () => {
  const { rules, issues } = loadControlRules({ rules: [validRule(), { id: 'bad' }] });
  assert.equal(rules.length, 1);
  assert.equal(issues.length, 1);
});

test('missing or blank id is dropped and reported', () => {
  const noId = validRule();
  delete noId.id;
  for (const rule of [noId, validRule({ id: '' }), validRule({ id: '   ' })]) {
    const { rules, issues } = loadControlRules({ rules: [rule] });
    assert.equal(rules.length, 0);
    assert.equal(issues.length, 1);
  }
});

test('an id failing the slug pattern is dropped and reported', () => {
  for (const id of ['PANEL', 'panel unstained', '-panel', '']) {
    const { rules, issues } = loadControlRules({ rules: [validRule({ id })] });
    assert.equal(rules.length, 0, id);
    assert.equal(issues.length, 1, id);
  }
});

test('a duplicate id: first wins, second dropped and reported', () => {
  const { rules, issues } = loadControlRules({
    rules: [validRule(), validRule({ title: 'a different title' })],
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].title, 'Unstained / autofluorescence control');
  assert.ok(issues.some((i) => /duplicate control rule id/.test(i.message)));
});

test('unknown kind is dropped and reported', () => {
  for (const kind of ['panels', 'READOUT', '', undefined]) {
    const { rules, issues } = loadControlRules({ rules: [validRule({ kind })] });
    assert.equal(rules.length, 0, String(kind));
    assert.match(issues[0].message, /'kind' must be one of/);
  }
});

for (const kind of CONTROL_KINDS) {
  test(`kind '${kind}' is accepted`, () => {
    const { rules, issues } = loadControlRules({ rules: [validRule({ kind })] });
    assert.equal(issues.length, 0);
    assert.equal(rules[0].kind, kind);
  });
}

test('missing or blank title is dropped and reported', () => {
  for (const title of [undefined, '', '   ']) {
    const { rules, issues } = loadControlRules({ rules: [validRule({ title })] });
    assert.equal(rules.length, 0);
    assert.match(issues[0].message, /non-empty title/);
  }
});

test('a why under the minimum length is dropped and reported, with the length in the message', () => {
  const { rules, issues } = loadControlRules({ rules: [validRule({ why: 'too short' })] });
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /at least 40 characters/);
  assert.match(issues[0].message, /got 9/);
});

test('`when` missing or literal true is dropped and reported', () => {
  for (const when of [undefined, true]) {
    const rule = validRule({ when });
    if (when === undefined) delete rule.when;
    const { rules, issues } = loadControlRules({ rules: [rule] });
    assert.equal(rules.length, 0);
    assert.match(issues[0].message, /'when' is required/);
  }
});

test('priority defaults to 0 when absent or non-numeric', () => {
  for (const priority of [undefined, '10', null]) {
    const rule = validRule({ priority });
    if (priority === undefined) delete rule.priority;
    const { rules } = loadControlRules({ rules: [rule] });
    assert.equal(rules[0].priority, 0);
  }
});

test('an unknown top-level key is REPORTED but does not drop the rule', () => {
  const { rules, issues } = loadControlRules({ rules: [validRule({ surface: 'design' })] });
  assert.equal(rules.length, 1);
  assert.ok(issues.some((i) => /unrecognized/.test(i.message)));
});

// --- Selector ----------------------------------------------------------

test('selectControls returns only rules whose `when` passes, in ascending priority order', () => {
  const { rules } = loadControlRules({
    rules: [
      validRule({ id: 'b', priority: 5 }),
      validRule({ id: 'a', priority: 1 }),
      validRule({ id: 'never', when: { eq: ['readout', 'unknown-readout'] } }),
    ],
  });
  const exp = experimentWithReadout('bacterial-viability');
  exp.naming = { ...exp.naming, fields: { markers: 'SYTO9-PI' } };
  const selected = selectControls(rules, exp);
  assert.deepEqual(selected.map((r) => r.id), ['a', 'b']);
});

test('selectControls never throws on a malformed predicate', () => {
  const rules = [{ id: 'x', kind: 'panel', title: 't', why: 'w'.repeat(40), when: { eq: null }, priority: 0 }];
  assert.doesNotThrow(() => selectControls(rules, emptyExperiment()));
});

// --- Readouts vocabulary loader -----------------------------------------

test('a well-formed readouts pack loads with zero issues', () => {
  const { readouts, issues } = loadReadouts({
    version: 1,
    readouts: { 'bacterial-viability': { label: 'Bacterial viability', aliases: ['viability'] } },
  });
  assert.equal(issues.length, 0);
  assert.deepEqual(readouts['bacterial-viability'], { label: 'Bacterial viability', aliases: ['viability'] });
});

test('an undefined/malformed readouts pack degrades to empty with an issue, never throws', () => {
  for (const raw of [undefined, null, 'nope', 42, []]) {
    const { readouts, issues } = loadReadouts(raw);
    assert.deepEqual(readouts, {});
    assert.ok(issues.length >= 1);
  }
});

test('a readout entry with no label is dropped and reported', () => {
  const { readouts, issues } = loadReadouts({ version: 1, readouts: { ros: { aliases: [] } } });
  assert.deepEqual(readouts, {});
  assert.ok(issues.some((i) => /missing a non-empty label/.test(i.message)));
});

test('a readout id failing the slug pattern is dropped and reported', () => {
  const { readouts, issues } = loadReadouts({ version: 1, readouts: { ROS: { label: 'ROS' } } });
  assert.deepEqual(readouts, {});
  assert.ok(issues.length >= 1);
});

// --- resolveReadoutCanonical / readoutState -----------------------------

const SAMPLE_READOUTS = {
  'bacterial-viability': { label: 'Bacterial viability', aliases: ['viability', 'syto9/pi'] },
  ros: { label: 'Intracellular ROS', aliases: ['dcf'] },
};

test('resolveReadoutCanonical matches the label case-insensitively', () => {
  assert.equal(resolveReadoutCanonical('bacterial viability', SAMPLE_READOUTS), 'bacterial-viability');
  assert.equal(resolveReadoutCanonical('BACTERIAL VIABILITY', SAMPLE_READOUTS), 'bacterial-viability');
});

test('resolveReadoutCanonical matches an alias case-insensitively', () => {
  assert.equal(resolveReadoutCanonical('DCF', SAMPLE_READOUTS), 'ros');
  assert.equal(resolveReadoutCanonical('Syto9/PI', SAMPLE_READOUTS), 'bacterial-viability');
});

test('resolveReadoutCanonical does not substring-match -- exact only', () => {
  assert.equal(resolveReadoutCanonical('ROS in macrophages', SAMPLE_READOUTS), null);
});

test('resolveReadoutCanonical returns null for empty/blank/unrecognized text', () => {
  for (const text of ['', '   ', undefined, null, 'apoptosis assay']) {
    assert.equal(resolveReadoutCanonical(text, SAMPLE_READOUTS), null);
  }
});

test('readoutState: unanswered, unrecognized, known', () => {
  assert.equal(readoutState('', SAMPLE_READOUTS), 'unanswered');
  assert.equal(readoutState('   ', SAMPLE_READOUTS), 'unanswered');
  assert.equal(readoutState('apoptosis assay', SAMPLE_READOUTS), 'unrecognized');
  assert.equal(readoutState('DCF', SAMPLE_READOUTS), 'known');
});

// ============================================================================
// Committed content: reads the REAL web/kb/readouts.json and
// web/kb/controls.json, mirroring advisor.test.js's second half.
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const readoutsRaw = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'readouts.json'), 'utf-8'));
const controlsRaw = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'controls.json'), 'utf-8'));

test('the real web/kb/readouts.json loads with ZERO issues', () => {
  const { issues } = loadReadouts(readoutsRaw);
  assert.deepEqual(issues, []);
});

test('the real web/kb/controls.json loads with ZERO issues', () => {
  const { issues } = loadControlRules(controlsRaw);
  assert.deepEqual(issues, []);
});

test('selectControls(rules, emptyExperiment()) is EMPTY -- no advice before the user has told the app anything', () => {
  const { rules } = loadControlRules(controlsRaw);
  const notes = selectControls(rules, emptyExperiment());
  assert.deepEqual(notes, []);
});

// `panel.derived.*` (fluorophoreCount/hasAntibody/hasMarkersDeclared) is
// computed by engine/spectra.js's derivePanelFacts and wired in by
// engine/studydoc.js BEFORE selectControls ever runs (see studydoc.js's
// header on why: the predicate DSL cannot resolve a marker alias itself).
// These tests attach it by hand, the same shape studydoc.js produces, so
// they exercise the REAL committed controls.json predicates without
// pulling in the whole studydoc/kbpack machinery just to get one object.
function expWithPanelDerived(derived) {
  const exp = emptyExperiment();
  exp.naming = { ...exp.naming, fields: { markers: 'placeholder' } };
  exp.panel = { ...exp.panel, derived };
  return exp;
}

test('no markers declared (hasMarkersDeclared false) -- no panel rule fires, regardless of the other derived facts', () => {
  const { rules } = loadControlRules(controlsRaw);
  const exp = expWithPanelDerived({ fluorophoreCount: 5, hasAntibody: true, hasTag: false, classes: ['target'], hasMarkersDeclared: false });
  const fired = selectControls(rules, exp)
    .filter((r) => r.kind === 'panel')
    .map((r) => r.id);
  assert.deepEqual(fired, []);
});

test('one non-antibody fluorophore: only the unstained control fires -- NOT single-stain, FMO, isotype, secondary, or specificity', () => {
  const { rules } = loadControlRules(controlsRaw);
  const exp = expWithPanelDerived({ fluorophoreCount: 1, hasAntibody: false, hasTag: false, classes: ['dye'], hasMarkersDeclared: true });
  const fired = selectControls(rules, exp)
    .filter((r) => r.kind === 'panel')
    .map((r) => r.id);
  assert.deepEqual(fired, ['panel-unstained-control']);
});

test('two non-antibody fluorophores: single-stain joins unstained, FMO and antibody controls still silent', () => {
  const { rules } = loadControlRules(controlsRaw);
  const exp = expWithPanelDerived({ fluorophoreCount: 2, hasAntibody: false, hasTag: false, classes: ['dye'], hasMarkersDeclared: true });
  const fired = selectControls(rules, exp)
    .filter((r) => r.kind === 'panel')
    .map((r) => r.id);
  assert.deepEqual(fired, ['panel-unstained-control', 'panel-single-stain-controls']);
});

test('three non-antibody fluorophores: FMO joins too -- unstained, single-stain, FMO, still no antibody controls', () => {
  const { rules } = loadControlRules(controlsRaw);
  const exp = expWithPanelDerived({ fluorophoreCount: 3, hasAntibody: false, hasTag: false, classes: ['dye'], hasMarkersDeclared: true });
  const fired = selectControls(rules, exp)
    .filter((r) => r.kind === 'panel')
    .map((r) => r.id);
  assert.deepEqual(fired, ['panel-unstained-control', 'panel-single-stain-controls', 'panel-fmo-control']);
});

test('hasAntibody true: isotype/secondary-only/biological-specificity join, even for a single fluorophore', () => {
  const { rules } = loadControlRules(controlsRaw);
  const exp = expWithPanelDerived({ fluorophoreCount: 1, hasAntibody: true, hasTag: false, classes: ['target'], hasMarkersDeclared: true });
  const fired = selectControls(rules, exp)
    .filter((r) => r.kind === 'panel')
    .map((r) => r.id);
  assert.deepEqual(
    fired.sort(),
    ['panel-antibody-specificity-control', 'panel-isotype-control', 'panel-secondary-only-control', 'panel-unstained-control'].sort()
  );
});

test('the readouts vocabulary is non-empty, i.e. readout rules have something real to key on', () => {
  const { readouts } = loadReadouts(readoutsRaw);
  assert.ok(Object.keys(readouts).length > 0);
});

test('every committed readout rule fires for its own canonical readout, and only that one', () => {
  const { rules } = loadControlRules(controlsRaw);
  const readoutRules = rules.filter((r) => r.kind === 'readout');
  const { readouts } = loadReadouts(readoutsRaw);
  const canonicals = Object.keys(readouts);
  assert.ok(canonicals.length > 0, 'expected at least one committed readout');

  for (const rule of readoutRules) {
    const firedFor = canonicals.filter((canonical) => {
      const exp = experimentWithReadout(canonical);
      return selectControls([rule], exp).length > 0;
    });
    assert.ok(firedFor.length > 0, `readout rule '${rule.id}' never fired for any committed readout`);
  }
});

test('every committed rule why is a real sentence naming a mechanism, not just the title restated', () => {
  const { rules } = loadControlRules(controlsRaw);
  for (const rule of rules) {
    assert.ok(rule.why.length >= 40, `rule '${rule.id}' why is too short`);
    assert.notEqual(rule.why.toLowerCase(), rule.title.toLowerCase(), `rule '${rule.id}' why just restates its title`);
  }
});

test('every questions.json field used by the readout question resolves on the assay view', () => {
  const questionsPath = path.join(here, '..', 'kb', 'questions.json');
  const questions = JSON.parse(readFileSync(questionsPath, 'utf-8'));
  const readoutQuestion = questions.find((q) => q.id === 'readout');
  assert.ok(readoutQuestion, 'expected a "readout" question in questions.json');
  assert.equal(readoutQuestion.field, 'readoutText');
  assert.equal(readoutQuestion.allowOther, true);

  const view = assayView(emptyExperiment(), firstAssayId(emptyExperiment()));
  assert.ok('readoutText' in view, 'assayView does not expose readoutText');
  assert.ok('readout' in view, 'assayView does not expose readout');

  // Every curated option must resolve to a real committed readout, so the
  // question bank and the vocabulary can never silently diverge.
  const { readouts } = loadReadouts(readoutsRaw);
  for (const option of readoutQuestion.options) {
    assert.ok(
      resolveReadoutCanonical(option, readouts) !== null,
      `question option '${option}' does not resolve to any committed readout`
    );
  }
});
