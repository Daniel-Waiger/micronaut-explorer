// Tests for the condition matrix engine: factors x levels x replicates ->
// condition rows -> sample IDs. Row order is a CONTRACT (see the module
// header in conditions.js), so the primary test pins the exact sequence
// with a full deepEqual against a literal expected array.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_ID_SAFE_CHAR_PATTERN,
  buildSampleId,
  conditionIssues,
  expandConditions,
} from '../src/engine/conditions.js';
import { sanitizeToken } from '../src/engine/naming.js';

test('expandConditions pins the exact row sequence for 2 factors x 2 replicates', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT', 'KO'] },
      { name: 'treatment', levels: ['veh', 'drug', 'combo'] },
    ],
    replicates: 2,
  };

  // Factors vary in declared order (genotype outermost, treatment next),
  // levels vary in declared order, and replicate is the fastest-varying
  // axis -- 2 x 3 x 2 = 12 rows in exactly this sequence.
  const expected = [
    { id: 0, factorLevels: { genotype: 'WT', treatment: 'veh' }, replicate: 1 },
    { id: 1, factorLevels: { genotype: 'WT', treatment: 'veh' }, replicate: 2 },
    { id: 2, factorLevels: { genotype: 'WT', treatment: 'drug' }, replicate: 1 },
    { id: 3, factorLevels: { genotype: 'WT', treatment: 'drug' }, replicate: 2 },
    { id: 4, factorLevels: { genotype: 'WT', treatment: 'combo' }, replicate: 1 },
    { id: 5, factorLevels: { genotype: 'WT', treatment: 'combo' }, replicate: 2 },
    { id: 6, factorLevels: { genotype: 'KO', treatment: 'veh' }, replicate: 1 },
    { id: 7, factorLevels: { genotype: 'KO', treatment: 'veh' }, replicate: 2 },
    { id: 8, factorLevels: { genotype: 'KO', treatment: 'drug' }, replicate: 1 },
    { id: 9, factorLevels: { genotype: 'KO', treatment: 'drug' }, replicate: 2 },
    { id: 10, factorLevels: { genotype: 'KO', treatment: 'combo' }, replicate: 1 },
    { id: 11, factorLevels: { genotype: 'KO', treatment: 'combo' }, replicate: 2 },
  ];

  assert.deepEqual(expandConditions(design), expected);
});

test('zero factors is legal and yields exactly one unconditioned row', () => {
  const design = { factors: [], replicates: null };
  assert.deepEqual(expandConditions(design), [{ id: 0, factorLevels: {}, replicate: 1 }]);
  assert.deepEqual(conditionIssues(design), []);
});

test('a factor with zero levels yields zero rows AND an issue', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT', 'KO'] },
      { name: 'treatment', levels: [] },
    ],
    replicates: 1,
  };

  assert.deepEqual(expandConditions(design), []);

  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'factors' && i.severity === 'error' && i.message.includes('treatment')
    ),
    `expected an issue naming 'treatment', got ${JSON.stringify(issues)}`
  );
});

test('replicates defaults to 1 when null', () => {
  const design = { factors: [{ name: 'genotype', levels: ['WT', 'KO'] }], replicates: null };
  const rows = expandConditions(design);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.replicate === 1));
  // null is a legal "unset" state, not an authoring error.
  assert.deepEqual(conditionIssues(design), []);
});

test('replicates defaults to 1 when absent entirely', () => {
  const design = { factors: [{ name: 'genotype', levels: ['WT'] }] };
  const rows = expandConditions(design);
  assert.deepEqual(rows, [{ id: 0, factorLevels: { genotype: 'WT' }, replicate: 1 }]);
});

test('an explicit replicates < 1 raises an issue', () => {
  const design = { factors: [{ name: 'genotype', levels: ['WT'] }], replicates: 0 };
  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.field === 'replicates' && i.severity === 'error'),
    `expected a replicates issue, got ${JSON.stringify(issues)}`
  );
});

test('a negative or non-integer replicates value also raises an issue', () => {
  for (const bad of [-1, 1.5, 'three']) {
    const issues = conditionIssues({ factors: [{ name: 'g', levels: ['WT'] }], replicates: bad });
    assert.ok(
      issues.some((i) => i.field === 'replicates'),
      `expected a replicates issue for ${JSON.stringify(bad)}`
    );
  }
});

test('duplicate factor names raise an issue', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT'] },
      { name: 'genotype', levels: ['KO'] },
    ],
    replicates: 1,
  };

  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'factors' && /duplicate/i.test(i.message) && i.message.includes('genotype')
    ),
    `expected a duplicate-factor issue, got ${JSON.stringify(issues)}`
  );
});

test('the >1000-row cap returns an issue and expandConditions does not attempt the expansion', () => {
  const design = {
    factors: [
      { name: 'a', levels: Array.from({ length: 50 }, (_, i) => `a${i}`) },
      { name: 'b', levels: Array.from({ length: 50 }, (_, i) => `b${i}`) },
    ],
    replicates: 1,
  };
  // 50 * 50 * 1 = 2500 rows, well over the 1000-row cap.

  const start = Date.now();
  const rows = expandConditions(design);
  const elapsedMs = Date.now() - start;

  assert.equal(rows.length, 0);
  // A real 2500-row expansion is trivially fast too, so this is a soft proof
  // -- the hard proof is the row count above -- but a generous bound still
  // catches a naive implementation that forgot to short-circuit before a
  // MUCH larger design (this one is already 2.5x the cap).
  assert.ok(elapsedMs < 200, `expected a fast short-circuit, took ${elapsedMs}ms`);

  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.severity === 'error' && i.message.includes('2500')),
    `expected a cap issue mentioning the planned row count, got ${JSON.stringify(issues)}`
  );
});

test('conditionIssues flags an unknown token in the id scheme', () => {
  const design = {
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    replicates: 1,
    idScheme: '{genotype}_{batch}',
  };

  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'idScheme' && i.severity === 'error' && i.message.includes('batch')
    ),
    `expected an unknown-token issue naming 'batch', got ${JSON.stringify(issues)}`
  );
});

test('conditionIssues does not flag replicate or known factor names as unknown tokens', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT', 'KO'] },
      { name: 'treatment', levels: ['veh', 'drug'] },
    ],
    replicates: 2,
    idScheme: '{genotype}{treatment}R{replicate}',
  };
  assert.deepEqual(conditionIssues(design), []);
});

test('buildSampleId throws rather than silently rendering an empty segment for an unknown token', () => {
  const row = { factorLevels: { genotype: 'WT' }, replicate: 1 };
  assert.throws(() => buildSampleId(row, '{genotype}_{batch}'));
});

test("buildSampleId's sanitization matches a direct sanitizeToken call for a level with a space and a slash", () => {
  const row = { factorLevels: { genotype: 'high dose / repeat value' }, replicate: 1 };
  const scheme = '{genotype}';

  // Compare against a LIVE call to naming.js's sanitizeToken (the actual
  // producer), not a hardcoded expected string -- a single-token scheme
  // means the substituted text fed to sanitizeToken is exactly the level
  // value itself, with no risk of the test re-deriving the substitution.
  const expected = sanitizeToken(row.factorLevels.genotype, {
    safeCharPattern: SAMPLE_ID_SAFE_CHAR_PATTERN,
  });

  assert.equal(buildSampleId(row, scheme), expected);
  // Sanity: sanitizeToken really did transform the value (proves this test
  // exercises sanitization, not a no-op).
  assert.notEqual(expected, row.factorLevels.genotype);
});

test('buildSampleId renders a multi-token scheme and sanitizes the whole result', () => {
  const row = { factorLevels: { genotype: 'WT', treatment: 'drug' }, replicate: 3 };
  const scheme = '{genotype}{treatment}R{replicate}';

  const expected = sanitizeToken('WTdrugR3', { safeCharPattern: SAMPLE_ID_SAFE_CHAR_PATTERN });
  assert.equal(buildSampleId(row, scheme), expected);
});

test('a factor named "replicate" is flagged (D5): it collides with the built-in replicate token', () => {
  const design = {
    factors: [{ name: 'replicate', levels: ['A', 'B'] }],
    replicates: 1,
    idScheme: '{replicate}',
  };

  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.field === 'factors' && /reserved/i.test(i.message)),
    `expected a reserved-name issue, got ${JSON.stringify(issues)}`
  );

  // Prove the collision is real, not just theoretical: two distinct
  // conditions render the IDENTICAL sample id because the factor's own
  // level is shadowed by the row's actual replicate number.
  const rows = expandConditions(design);
  const ids = rows.map((row) => buildSampleId(row, design.idScheme));
  assert.equal(new Set(ids).size, 1, `expected a collision, got distinct ids ${JSON.stringify(ids)}`);
});

test('a factor with an undefined/null level is flagged (D3), not just an empty-levels-array', () => {
  const design = {
    factors: [{ name: 'genotype', levels: [undefined, 'KO'] }],
    replicates: 1,
    idScheme: '{genotype}',
  };
  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'factors' && i.message.includes('genotype') && i.message.includes('invalid level')
    ),
    `expected an invalid-level issue, got ${JSON.stringify(issues)}`
  );
});

test('buildSampleId rejects a scheme token matching an inherited Object.prototype member (D4)', () => {
  const row = { factorLevels: { genotype: 'WT' }, replicate: 1 };
  // 'toString'/'constructor'/'valueOf' are not own properties of the fields
  // object buildSampleId builds, but `token in fields` would find them on
  // the prototype chain anyway -- hasOwnProperty must be what gates this.
  for (const badToken of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    assert.throws(
      () => buildSampleId(row, `{${badToken}}`),
      /Unknown token/,
      `expected {${badToken}} to be rejected as unknown, not resolved via the prototype chain`
    );
  }
});

test('conditionIssues returns no issues for a well-formed design', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT', 'KO'] },
      { name: 'treatment', levels: ['veh', 'drug'] },
    ],
    replicates: 3,
    idScheme: '{genotype}{treatment}R{replicate}',
  };
  assert.deepEqual(conditionIssues(design), []);
});
