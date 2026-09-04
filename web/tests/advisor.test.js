// Tests for engine/advisor.js: the loader (mirrors interview.js's
// loadQuestions discipline) and the selector. Committed-content guards for
// the REAL web/kb/advisor.json live in the second half of this file, once
// content exists (see docs/plans -- Advisor slice 1 sequencing step 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ADVICE_KINDS,
  ADVICE_SURFACES,
  loadAdvisorRules,
  selectAdvice,
  summarizeTrigger,
} from '../src/engine/advisor.js';
import { describePredicate } from '../src/engine/predicate.js';
import { compileFullMatch } from '../src/engine/validation.js';
import { emptyExperiment } from '../src/core/schema.js';
import { assayView, firstAssayId } from '../src/core/assay.js';
import { getPath } from '../src/core/paths.js';
import { NAMING_CONFIG } from '../src/engine/namingConfig.js';

function validRule(overrides = {}) {
  return {
    id: 'sted-photobleaching',
    surfaces: ['design', 'naming'],
    kind: 'pitfall',
    concept: 'photobleaching',
    title: 'STED bleaches far faster than confocal',
    body: 'The depletion beam deposits far more energy per pixel than excitation alone, so photostability outweighs brightness when picking a dye.',
    when: { matches: ['acquisition.modality', '[Ss][Tt][Ee][Dd]'] },
    priority: 10,
    ...overrides,
  };
}

function experimentWithModality(modality) {
  const exp = emptyExperiment();
  exp.acquisition = { ...exp.acquisition, modality };
  return exp;
}

// --- Loader: shape and totality -------------------------------------------

test('a well-formed pack loads with zero issues', () => {
  const { rules, issues } = loadAdvisorRules({ version: 1, rules: [validRule()] });
  assert.equal(issues.length, 0);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 'sted-photobleaching');
});

test('an absent pack (undefined/null) reports the "pack is missing" issue, never throws', () => {
  for (const raw of [undefined, null]) {
    const { rules, issues } = loadAdvisorRules(raw);
    assert.deepEqual(rules, []);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /advisor pack is missing/);
  }
});

test('a pack that is not {rules: [...]} reports an issue rather than throwing', () => {
  for (const raw of [{}, { rules: 'nope' }, [], 'nope', 42]) {
    const { rules, issues } = loadAdvisorRules(raw);
    assert.deepEqual(rules, []);
    assert.ok(issues.length >= 1);
  }
});

test('a malformed rule entry is dropped and reported by index, not thrown', () => {
  const { rules, issues } = loadAdvisorRules({ rules: [null, 'nope', 42, []] });
  assert.equal(rules.length, 0);
  assert.equal(issues.length, 4);
  for (const issue of issues) assert.match(issue.field, /^\[\d+\]$/);
});

test('one bad rule does not silence the rest of the pack', () => {
  const { rules, issues } = loadAdvisorRules({ rules: [validRule(), { id: 'bad' }] });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 'sted-photobleaching');
  assert.equal(issues.length, 1);
});

// --- Loader: field-by-field validation -------------------------------------

test('missing or blank id is dropped and reported by index', () => {
  const noId = validRule();
  delete noId.id;
  for (const rule of [noId, validRule({ id: '' }), validRule({ id: '   ' })]) {
    const { rules, issues } = loadAdvisorRules({ rules: [rule] });
    assert.equal(rules.length, 0);
    assert.equal(issues.length, 1);
    assert.match(issues[0].field, /^\[0\]$/);
  }
});

test('an id failing the slug pattern is dropped and reported', () => {
  for (const id of ['STED', 'sted photobleaching', '-sted', 'sted_photobleaching', '']) {
    const { rules, issues } = loadAdvisorRules({ rules: [validRule({ id })] });
    assert.equal(rules.length, 0, id);
    assert.equal(issues.length, 1, id);
  }
});

test('a duplicate id: first wins, second dropped and reported', () => {
  const { rules, issues } = loadAdvisorRules({
    rules: [validRule(), validRule({ title: 'a different title' })],
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].title, 'STED bleaches far faster than confocal');
  assert.ok(issues.some((i) => /duplicate advisor rule id/.test(i.message)));
});

test('`when: true` is dropped and reported', () => {
  const { rules, issues } = loadAdvisorRules({ rules: [validRule({ when: true })] });
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /'when' is required/);
});

test('a missing `when` (key absent entirely) is dropped and reported', () => {
  const rule = validRule();
  delete rule.when;
  const { rules, issues } = loadAdvisorRules({ rules: [rule] });
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /'when' is required/);
});

test('a `when` of `false` is legal (a rule that is data-complete but deliberately never fires yet)', () => {
  const { rules, issues } = loadAdvisorRules({ rules: [validRule({ when: false })] });
  assert.equal(issues.length, 0);
  assert.equal(rules.length, 1);
});

test('unknown kind is dropped and reported; no default is applied', () => {
  for (const kind of ['warning', 'PITFALL', '', undefined]) {
    const { rules, issues } = loadAdvisorRules({ rules: [validRule({ kind })] });
    assert.equal(rules.length, 0, String(kind));
    assert.match(issues[0].message, /'kind' must be one of/);
  }
});

for (const kind of ADVICE_KINDS) {
  test(`kind '${kind}' is accepted`, () => {
    const { rules, issues } = loadAdvisorRules({ rules: [validRule({ kind })] });
    assert.equal(issues.length, 0);
    assert.equal(rules[0].kind, kind);
  });
}

test('missing or blank concept is dropped and reported', () => {
  // The concept is the note's REASON ('spectral spillover'), as distinct
  // from its trigger condition ('modality is confocal'). It is required
  // precisely because it cannot be derived from `when` -- a rule without one
  // can only explain when it applies, never why it exists.
  const noConcept = validRule();
  delete noConcept.concept;
  for (const rule of [noConcept, validRule({ concept: '' }), validRule({ concept: '   ' })]) {
    const { rules, issues } = loadAdvisorRules({ rules: [rule] });
    assert.equal(rules.length, 0);
    assert.match(issues[0].message, /non-empty concept/);
  }
});

test('a concept is trimmed, like every other authored string field', () => {
  const { rules } = loadAdvisorRules({ rules: [validRule({ concept: '  spectral spillover  ' })] });
  assert.equal(rules[0].concept, 'spectral spillover');
});

test('missing or blank title is dropped and reported', () => {
  for (const title of [undefined, '', '   ']) {
    const { rules, issues } = loadAdvisorRules({ rules: [validRule({ title })] });
    assert.equal(rules.length, 0);
    assert.match(issues[0].message, /non-empty title/);
  }
});

test('a body under the minimum length is dropped and reported, with the length in the message', () => {
  const { rules, issues } = loadAdvisorRules({ rules: [validRule({ body: 'too short' })] });
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /at least 40 characters/);
  assert.match(issues[0].message, /got 9/);
});

test('missing, non-array, or empty surfaces is dropped and reported', () => {
  for (const surfaces of [undefined, 'design', [], null]) {
    const { rules, issues } = loadAdvisorRules({ rules: [validRule({ surfaces })] });
    assert.equal(rules.length, 0, String(surfaces));
    assert.match(issues[0].message, /'surfaces' must be a non-empty array/);
  }
});

test('a rule naming an unknown surface is dropped WHOLESALE, not narrowed to the known surfaces', () => {
  const { rules, issues } = loadAdvisorRules({
    rules: [validRule({ surfaces: ['design', 'summary'] })],
  });
  assert.equal(rules.length, 0);
  assert.match(issues[0].message, /unknown surface 'summary'/);
});

for (const surface of ADVICE_SURFACES) {
  test(`surface '${surface}' is accepted`, () => {
    const { issues } = loadAdvisorRules({ rules: [validRule({ surfaces: [surface] })] });
    assert.equal(issues.length, 0);
  });
}

test('priority defaults to 0 when absent or non-numeric', () => {
  for (const priority of [undefined, '10', null]) {
    const rule = validRule({ priority });
    if (priority === undefined) delete rule.priority;
    const { rules } = loadAdvisorRules({ rules: [rule] });
    assert.equal(rules[0].priority, 0);
  }
});

test('an unknown top-level key is REPORTED but does not drop the rule', () => {
  const { rules, issues } = loadAdvisorRules({
    rules: [validRule({ surface: 'design' })], // typo: singular, not the real 'surfaces'
  });
  assert.equal(rules.length, 1, 'the rule ships despite the typo\'d extra key');
  assert.ok(issues.some((i) => /unrecognized/.test(i.message) || /unknown/i.test(i.message)));
});

// --- Loader: the whitelist-not-spread discipline itself --------------------

test('the normalized rule shape is EXACTLY the whitelist, regardless of what extra keys the raw entry carried', () => {
  const { rules } = loadAdvisorRules({
    rules: [validRule({ extraneous: 'nope', another: 123 })],
  });
  assert.deepEqual(
    Object.keys(rules[0]).sort(),
    ['body', 'concept', 'id', 'kind', 'priority', 'surfaces', 'title', 'when'].sort()
  );
});

// --- Selector ---------------------------------------------------------------

test('selectAdvice returns only rules whose `when` passes for the given experiment', () => {
  const { rules } = loadAdvisorRules({
    rules: [validRule(), validRule({ id: 'confocal-pinhole', when: { matches: ['acquisition.modality', 'confocal'] } })],
  });
  const notes = selectAdvice(rules, experimentWithModality('STED'), 'design');
  assert.deepEqual(notes.map((n) => n.id), ['sted-photobleaching']);
});

test('selectAdvice filters by surface; a two-surface rule appears on both', () => {
  const { rules } = loadAdvisorRules({ rules: [validRule({ surfaces: ['design', 'naming'] })] });
  const exp = experimentWithModality('STED');
  assert.equal(selectAdvice(rules, exp, 'design').length, 1);
  assert.equal(selectAdvice(rules, exp, 'naming').length, 1);
  assert.equal(selectAdvice(rules, exp, 'describe').length, 0);
});

test('selectAdvice(rules, experiment, null) returns every passing rule regardless of surface', () => {
  const { rules } = loadAdvisorRules({
    rules: [
      validRule({ id: 'a', surfaces: ['design'] }),
      validRule({ id: 'b', surfaces: ['naming'] }),
    ],
  });
  const notes = selectAdvice(rules, experimentWithModality('STED'), null);
  assert.deepEqual(notes.map((n) => n.id).sort(), ['a', 'b']);
});

test('selectAdvice orders by ascending priority, ties in declaration order', () => {
  const { rules } = loadAdvisorRules({
    rules: [
      validRule({ id: 'second', priority: 5 }),
      validRule({ id: 'first-a', priority: 1 }),
      validRule({ id: 'first-b', priority: 1 }),
    ],
  });
  const notes = selectAdvice(rules, experimentWithModality('STED'), 'design');
  assert.deepEqual(notes.map((n) => n.id), ['first-a', 'first-b', 'second']);
});

test('a hand-crafted malformed predicate that somehow bypassed the loader still cannot throw', () => {
  const rules = [{ id: 'x', surfaces: ['design'], kind: 'tip', title: 't', body: 'b'.repeat(40), when: { eq: null, ne: null }, priority: 0 }];
  assert.doesNotThrow(() => selectAdvice(rules, emptyExperiment(), 'design'));
});

test('selectAdvice mutates neither the rules array nor the experiment', () => {
  const { rules } = loadAdvisorRules({ rules: [validRule()] });
  const exp = experimentWithModality('STED');
  const rulesBefore = JSON.stringify(rules);
  const expBefore = JSON.stringify(exp);
  selectAdvice(rules, exp, 'design');
  assert.equal(JSON.stringify(rules), rulesBefore);
  assert.equal(JSON.stringify(exp), expBefore);
});

// --- summarizeTrigger: the plain-English "why did this fire" clause -------
// Deliberately derived FROM the predicate, not hand-authored, so it cannot
// disagree with the real trigger condition -- these tests pin the mapping,
// not a duplicate content author's opinion of it.

test('summarizeTrigger on a single-value `in` predicate', () => {
  assert.equal(
    summarizeTrigger({ in: ['acquisition.modality', ['STED']] }),
    'modality is STED'
  );
});

test('summarizeTrigger on a two-value `in` predicate joins with "or"', () => {
  assert.equal(
    summarizeTrigger({ in: ['acquisition.modality', ['SEM', 'TEM']] }),
    'modality is SEM or TEM'
  );
});

test('summarizeTrigger on a three-plus-value `in` predicate uses a comma list before the final "or"', () => {
  assert.equal(
    summarizeTrigger({ in: ['acquisition.modality', ['STED', 'SEM', 'TEM']] }),
    'modality is STED, SEM or TEM'
  );
});

test('summarizeTrigger on an `eq` predicate', () => {
  assert.equal(summarizeTrigger({ eq: ['acquisition.modality', 'STED'] }), 'modality is STED');
});

test('summarizeTrigger returns null for a path not in the curated label map', () => {
  // Confirms it never leaks a raw dotted path into the sentence -- an
  // unmapped path is an OMITTED clause, not 'naming.fields.sample is E02'.
  assert.equal(summarizeTrigger({ eq: ['naming.fields.sample', 'E02'] }), null);
});

test('summarizeTrigger on an `exists` predicate over a labeled path', () => {
  assert.equal(
    summarizeTrigger({ exists: 'acquisition.smallestFeatureNm' }),
    'the smallest feature to resolve is set'
  );
});

test('summarizeTrigger returns null for `exists` on a path not in the curated label map', () => {
  assert.equal(summarizeTrigger({ exists: 'naming.fields.sample' }), null);
});

test('summarizeTrigger returns null for every predicate shape it does not summarize', () => {
  const unsummarizable = [
    { matches: ['acquisition.modality', 'STED'] },
    { gt: ['design.biologicalReplicates', 1] },
    { lt: ['design.biologicalReplicates', 1] },
    { exists: 123 }, // non-string arg
    { empty: 'acquisition.modality' },
    { ne: ['acquisition.modality', 'STED'] },
    { all: [{ eq: ['acquisition.modality', 'STED'] }] },
    { any: [{ eq: ['acquisition.modality', 'STED'] }] },
    { not: { eq: ['acquisition.modality', 'STED'] } },
    true,
    false,
    undefined,
    null,
    'not an object',
    42,
    [],
    { eq: ['acquisition.modality', 'STED'], ne: ['a', 'b'] }, // two keys -- malformed
    { eq: ['acquisition.modality'] }, // wrong arity
    { eq: [123, 'STED'] }, // non-string path
    { in: ['acquisition.modality', []] }, // empty value list
    { in: ['acquisition.modality', [1, 2]] }, // non-string values
    { eq: ['acquisition.modality', 42] }, // non-string value
  ];
  for (const pred of unsummarizable) {
    assert.equal(summarizeTrigger(pred), null, JSON.stringify(pred));
  }
});

test('summarizeTrigger never throws on any input, malformed or not', () => {
  for (const pred of [Symbol('x'), () => {}, new Date(), { in: null }, { eq: undefined }]) {
    assert.doesNotThrow(() => summarizeTrigger(pred));
  }
});

// ============================================================================
// Committed content: reads the REAL web/kb/advisor.json, mirroring how
// interview.test.js reads the real web/kb/questions.json. These guard the
// content itself, not just the loader/selector mechanics above -- the
// failure modes here are the ones described in the plan as "a rule that
// loads clean and never fires, or fires for everyone."
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const advisorPath = path.join(here, '..', 'kb', 'advisor.json');
const realAdvisorRaw = JSON.parse(readFileSync(advisorPath, 'utf-8'));

const questionsPath = path.join(here, '..', 'kb', 'questions.json');
const realQuestionsRaw = JSON.parse(readFileSync(questionsPath, 'utf-8'));

// Mirrors ui/steps/naming.js's NAMING_CONFIG.template exactly. Duplicated as
// a local literal rather than imported, for the same reason plan.test.js
// duplicates NAMING_CONFIG: naming.js is a UI module that touches
// `document`, and this test file must stay importable without a DOM.
// Sourced from engine/namingConfig.js (the app's own naming-template
// constants) rather than a hand-copied duplicate literal, so this test can
// never drift from what the app actually renders -- see that module's header.
const REAL_NAMING_TEMPLATE = NAMING_CONFIG.template;

/** Every path (leaf AND container, so `exists`/`empty` on a mid-level path is legal too) reachable inside `obj`, dot/bracket-joined like core/paths.js expects. */
function collectPaths(obj, prefix, out) {
  if (prefix) out.add(prefix);
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) return; // emptyExperiment()'s arrays are empty -- no index paths to offer
  for (const [key, value] of Object.entries(obj)) {
    collectPaths(value, prefix ? `${prefix}.${key}` : key, out);
  }
}

function legalAdvisorPaths() {
  const paths = new Set();
  // assayView(), not the raw study object -- advisor.json is written in the
  // flat v2-shaped vocabulary assayView() exists to keep alive. Walking the
  // raw emptyExperiment() would silently drop acquisition/design/panel/
  // controls behind the now-nested `assays` array (collectPaths stops at
  // any array), which would make this "legal" set legal for the wrong
  // reason -- every rule uses acquisition.modality, which would still slip
  // through via the question-field blind-add below regardless of whether
  // the schema-derived half of this set actually found it.
  collectPaths(assayView(emptyExperiment(), firstAssayId(emptyExperiment())), '', paths);
  paths.delete('');
  for (const q of realQuestionsRaw) {
    if (typeof q.field === 'string') paths.add(q.field);
  }
  // naming.fields.<token> for every token in the real template -- fixes the
  // gap a naive emptyExperiment()-only check would have: naming.fields
  // starts as {}, so naming.fields.date (a path rules constantly need) is
  // otherwise absent from the legal set entirely.
  for (const match of REAL_NAMING_TEMPLATE.matchAll(/\{([^{}]+)\}/g)) {
    paths.add(`naming.fields.${match[1]}`);
  }
  return paths;
}

/** Every [path, ...] / bare-string-path leaf inside a predicate tree, walked without re-implementing evaluatePredicate's own semantics. */
function collectPredicatePaths(node, out) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const keys = Object.keys(node);
  if (keys.length !== 1) return;
  const [op] = keys;
  const arg = node[op];
  if (op === 'exists' || op === 'empty') {
    if (typeof arg === 'string') out.add(arg);
    return;
  }
  if (['eq', 'ne', 'in', 'gt', 'lt', 'matches'].includes(op) && Array.isArray(arg) && typeof arg[0] === 'string') {
    out.add(arg[0]);
    return;
  }
  if (op === 'not') {
    collectPredicatePaths(arg, out);
    return;
  }
  if ((op === 'all' || op === 'any') && Array.isArray(arg)) {
    for (const child of arg) collectPredicatePaths(child, out);
  }
}

// --- Tripwires for the assay-tier refactor (schema v3) ---------------------
// Written and passing BEFORE any schema change, per the plan: these must
// break LOUDLY the moment a KB path stops resolving, rather than the app
// just going quiet. Two failure modes a refactor could introduce silently:
//   (a) a question-bank field pointing at a path nothing owns any more
//       (getPath returns undefined, so the question just never re-fills);
//   (b) a KB path using an array wildcard, which core/paths.js's getPath
//       does not support (only listPaths fans out) -- evaluatePredicate then
//       returns false FOREVER with no error anywhere. Verified directly:
//       evaluatePredicate({in: ['assays[*].acquisition.modality', [...]]})
//       is false regardless of the experiment.
// If the assay tier ever needs a path like 'assays[*].something', these two
// tests are the ones that must be examined and deliberately updated -- not
// silently broken.

test('every questions.json field resolves to a REAL path on the assay view (or a naming.fields.<token>)', () => {
  // Validated against assayView(), not the raw study object -- questions.json
  // is written in the flat v2-shaped vocabulary (acquisition.modality,
  // naming.fields.sample) that assayView() exists to keep alive for every KB
  // consumer. The raw emptyExperiment() is now a nested per-assay study and
  // was never the right thing to validate a KB path against.
  const view = assayView(emptyExperiment(), firstAssayId(emptyExperiment()));
  const realPaths = new Set();
  collectPaths(view, '', realPaths);
  for (const match of REAL_NAMING_TEMPLATE.matchAll(/\{([^{}]+)\}/g)) {
    realPaths.add(`naming.fields.${match[1]}`);
  }
  for (const q of realQuestionsRaw) {
    assert.ok(typeof q.field === 'string' && q.field, `question '${q.id}' has no field`);
    assert.ok(realPaths.has(q.field), `question '${q.id}' writes to a dead path '${q.field}'`);
  }
});

test('no path anywhere in the real KB (questions.json or advisor.json) uses an array wildcard or an assays[ index', () => {
  const suspect = (p) => typeof p === 'string' && (p.includes('[*]') || p.includes('assays['));

  for (const q of realQuestionsRaw) {
    assert.ok(!suspect(q.field), `question '${q.id}' field '${q.field}' uses a wildcard/assays[ path`);
    if (q.askWhen) {
      const used = new Set();
      collectPredicatePaths(q.askWhen, used);
      for (const p of used) {
        assert.ok(!suspect(p), `question '${q.id}' askWhen references '${p}', a wildcard/assays[ path`);
      }
    }
  }

  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    const used = new Set();
    collectPredicatePaths(rule.when, used);
    for (const p of used) {
      assert.ok(!suspect(p), `rule '${rule.id}' references '${p}', a wildcard/assays[ path`);
    }
  }
});

test('the real web/kb/advisor.json loads with ZERO issues', () => {
  const { issues } = loadAdvisorRules(realAdvisorRaw);
  assert.deepEqual(issues, []);
});

test('selectAdvice(rules, emptyExperiment(), surface) is EMPTY for every surface', () => {
  // One assertion catching the missing-`when`, empty-on-typo'd-path, and
  // not/ne "fires for everyone who hasn't answered yet" traps simultaneously
  // -- a brand-new experiment has answered nothing, so real advice should
  // never appear before the user has told the app anything.
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const surface of ADVICE_SURFACES) {
    const notes = selectAdvice(rules, emptyExperiment(), surface);
    assert.deepEqual(
      notes.map((n) => n.id),
      [],
      `expected no advice on '${surface}' for an empty experiment`
    );
  }
});

test('every committed rule fires on at least one experiment (the never-fires guard)', () => {
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  // Every committed rule today is either modality-gated or gated on
  // acquisition.smallestFeatureNm being set (the Nyquist tip) -- a future
  // rule keyed on some OTHER field will need a fixture added here too.
  const modalityCandidates = [...(realQuestionsRaw.find((q) => q.id === 'modality')?.options || []), 'sted', 'confocal'];
  const experimentCandidates = [
    ...modalityCandidates.map((modality) => {
      const exp = emptyExperiment();
      exp.acquisition = { ...exp.acquisition, modality };
      return exp;
    }),
    (() => {
      const exp = emptyExperiment();
      exp.acquisition = { ...exp.acquisition, smallestFeatureNm: 250 };
      return exp;
    })(),
  ];
  for (const rule of rules) {
    const fired = experimentCandidates.some((exp) => selectAdvice([rule], exp, null).length > 0);
    assert.ok(fired, `rule '${rule.id}' never fired for any candidate experiment -- describePredicate: ${describePredicate(rule.when)}`);
  }
});

test('every `matches` regex source in the real pack compiles under compileFullMatch', () => {
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    const matchesNodes = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
      const [op] = Object.keys(node);
      if (op === 'matches') matchesNodes.push(node[op]);
      else if (op === 'not') walk(node[op]);
      else if (op === 'all' || op === 'any') node[op].forEach(walk);
    })(rule.when);
    for (const [, source] of matchesNodes) {
      assert.doesNotThrow(() => compileFullMatch(source), `rule '${rule.id}' has an invalid regex source: ${source}`);
    }
  }
});

test('every path referenced anywhere in every real rule is a LEGAL path', () => {
  const legal = legalAdvisorPaths();
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    const used = new Set();
    collectPredicatePaths(rule.when, used);
    for (const p of used) {
      assert.ok(
        legal.has(p),
        `rule '${rule.id}' references unknown path '${p}' -- describePredicate: ${describePredicate(rule.when)}`
      );
    }
  }
});

test('no committed rule references naming.fields.modality (must read acquisition.modality instead)', () => {
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    const used = new Set();
    collectPredicatePaths(rule.when, used);
    assert.ok(
      !used.has('naming.fields.modality'),
      `rule '${rule.id}' reads naming.fields.modality -- the naming table reads acquisition.modality via effectiveNamingFields, so this rule and the table it sits beside could disagree (lesson 50)`
    );
  }
});

// Deliberate exceptions to the exists-guard rule below, each with its own
// reason -- never a schema-level escape hatch, one allowlist entry per rule.
const NOT_NE_EXISTS_GUARD_ALLOWLIST = new Set([
  // (none yet -- every committed rule uses `in`, which is false rather than
  // true on an absent path, so no rule currently needs this exception.)
]);

test('no rule uses `not`/`ne` on a path without an `exists` guard for that same path', () => {
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    if (NOT_NE_EXISTS_GUARD_ALLOWLIST.has(rule.id)) continue;
    const guarded = new Set();
    const risky = new Set();
    (function walk(node) {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
      const [op] = Object.keys(node);
      const arg = node[op];
      if (op === 'exists' && typeof arg === 'string') guarded.add(arg);
      if (op === 'ne' && Array.isArray(arg)) risky.add(arg[0]);
      if (op === 'not') {
        const inner = arg;
        if (inner && typeof inner === 'object' && Object.keys(inner)[0] === 'gt') risky.add(inner.gt[0]);
        if (inner && typeof inner === 'object' && Object.keys(inner)[0] === 'lt') risky.add(inner.lt[0]);
        walk(inner);
      }
      if (op === 'all' || op === 'any') arg.forEach(walk);
    })(rule.when);
    for (const p of risky) {
      assert.ok(guarded.has(p), `rule '${rule.id}' uses not/ne on '${p}' without an exists guard for it`);
    }
  }
});

test('every rule touching narrative.text is exercised by a MULTI-LINE fixture', () => {
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  const narrativeRules = rules.filter((rule) => {
    const used = new Set();
    collectPredicatePaths(rule.when, used);
    return used.has('narrative.text');
  });
  // Assertion is a no-op (vacuously true) if no committed rule touches
  // narrative.text yet -- this pins the requirement for when one is added,
  // per lesson A4: `matches` has no dotAll flag, so `.` never spans the
  // newlines a real pasted paragraph will contain; only `[\s\S]` does.
  for (const rule of narrativeRules) {
    const exp = emptyExperiment();
    exp.narrative = { ...exp.narrative, text: 'Line one of the paragraph.\nLine two, after a real newline.' };
    assert.ok(selectAdvice([rule], exp, null).length > 0, `rule '${rule.id}' did not fire on a multi-line narrative`);
  }
});

test('every modality-gated rule targets at least one EXACT spelling from the real modality options', () => {
  const modalityOptions = realQuestionsRaw.find((q) => q.id === 'modality')?.options || [];
  assert.ok(modalityOptions.length > 0, 'expected to find the modality question in the real question bank');
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    const used = new Set();
    collectPredicatePaths(rule.when, used);
    if (!used.has('acquisition.modality')) continue;
    const matchesAnOption = modalityOptions.some((option) => {
      const exp = emptyExperiment();
      exp.acquisition = { ...exp.acquisition, modality: option };
      return selectAdvice([rule], exp, null).length > 0;
    });
    assert.ok(matchesAnOption, `rule '${rule.id}' is modality-gated but matches none of ${JSON.stringify(modalityOptions)}`);
  }
});

test('every committed rule names a concept, and never just restates its trigger', () => {
  // The user-facing point of `concept`: a note must say WHY it exists
  // (spectral spillover) and not merely echo WHEN it applies (modality is
  // confocal). A concept that is just the modality name would be the exact
  // conflation this field was added to fix.
  const modalityOptions = (realQuestionsRaw.find((q) => q.id === 'modality')?.options || []).map((o) =>
    o.toLowerCase()
  );
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    assert.ok(rule.concept && rule.concept.length > 2, `rule '${rule.id}' has no usable concept`);
    assert.ok(
      !modalityOptions.includes(rule.concept.toLowerCase()),
      `rule '${rule.id}' uses the modality '${rule.concept}' as its concept -- that is its trigger, not its reason`
    );
  }
});

test('committed concepts are reused across rules where the phenomenon genuinely is the same', () => {
  // Not a style rule -- a correctness signal. Two rules about undersampling
  // (STED and confocal) SHOULD share the concept string, because a reader
  // scanning for "have I thought about sampling?" is looking for one idea,
  // not two spellings of it. This asserts the vocabulary stays a small
  // controlled set rather than 16 bespoke phrases.
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  const concepts = rules.map((r) => r.concept);
  const distinct = new Set(concepts);
  assert.ok(
    distinct.size < concepts.length,
    `expected at least one concept shared between rules, got ${distinct.size} distinct across ${concepts.length} rules`
  );
});

test('every committed rule produces a non-null summarizeTrigger clause', () => {
  // All 16 rules currently use the simple {in: ['acquisition.modality', [...]]}
  // shape, which summarizeTrigger recognizes -- pins that today's content
  // actually gets the "Shown because ..." clause, not a silently omitted one.
  // A future rule using a composite/unrecognized shape is EXPECTED to make
  // this fail loudly rather than ship with no visible trigger explanation --
  // when that happens, either broaden summarizeTrigger or accept the gap
  // consciously by narrowing this assertion, not by deleting it.
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const rule of rules) {
    assert.ok(summarizeTrigger(rule.when) !== null, `rule '${rule.id}' has no summarizable trigger`);
  }
});

test('no rule per surface exceeds the scarcity cap (12) -- the tripwire for revisiting dismiss/mute', () => {
  const { rules } = loadAdvisorRules(realAdvisorRaw);
  for (const surface of ADVICE_SURFACES) {
    const count = rules.filter((r) => r.surfaces.includes(surface)).length;
    assert.ok(count <= 12, `surface '${surface}' has ${count} rules, over the 12-rule scarcity cap`);
  }
});
