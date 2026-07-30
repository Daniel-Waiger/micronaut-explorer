// Tests for engine/predicate.js -- the total, eval-free boolean language
// used to decide when a question (C1-3) or, later, a control rule (P2) is
// askable/applicable. Per docs/plans/planner-web-p1-task-graph.json task
// C1-2, these tests must PROVE totality BY EXECUTION (doesNotThrow plus the
// right boolean), not by code inspection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePredicate, describePredicate } from '../src/engine/predicate.js';
import { getPath } from '../src/core/paths.js';

function exp(overrides = {}) {
  return {
    naming: { fields: { sample: 'E02', magnification: 'X63' } },
    panel: { channels: [{ marker: 'DAPI' }, { marker: 'GFP' }] },
    design: { factors: [], replicates: 3 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy-path operator semantics
// ---------------------------------------------------------------------------

test('eq matches an equal value and rejects an unequal one', () => {
  const e = exp();
  assert.equal(evaluatePredicate({ eq: ['naming.fields.sample', 'E02'] }, e), true);
  assert.equal(evaluatePredicate({ eq: ['naming.fields.sample', 'E99'] }, e), false);
});

test('ne is the negation of eq', () => {
  const e = exp();
  assert.equal(evaluatePredicate({ ne: ['naming.fields.sample', 'E02'] }, e), false);
  assert.equal(evaluatePredicate({ ne: ['naming.fields.sample', 'E99'] }, e), true);
});

test('in checks list membership', () => {
  const e = exp();
  assert.equal(evaluatePredicate({ in: ['naming.fields.magnification', ['X40', 'X63']] }, e), true);
  assert.equal(evaluatePredicate({ in: ['naming.fields.magnification', ['X40', 'X20']] }, e), false);
});

test('gt and lt compare numerically', () => {
  const e = exp();
  assert.equal(evaluatePredicate({ gt: ['design.replicates', 2] }, e), true);
  assert.equal(evaluatePredicate({ gt: ['design.replicates', 3] }, e), false);
  assert.equal(evaluatePredicate({ lt: ['design.replicates', 4] }, e), true);
  assert.equal(evaluatePredicate({ lt: ['design.replicates', 3] }, e), false);
});

test('exists is true for a filled field and false for empty/absent ones', () => {
  const e = exp({ naming: { fields: { sample: 'E02', notes: '' } } });
  assert.equal(evaluatePredicate({ exists: 'naming.fields.sample' }, e), true);
  assert.equal(evaluatePredicate({ exists: 'naming.fields.notes' }, e), false); // empty string
  assert.equal(evaluatePredicate({ exists: 'naming.fields.nope' }, e), false); // absent
  assert.equal(evaluatePredicate({ exists: 'panel.channels' }, e), true);
  assert.equal(evaluatePredicate({ exists: 'design.factors' }, e), false); // empty array
});

test('empty is the complement of exists', () => {
  const e = exp({ naming: { fields: { sample: 'E02', notes: '' } } });
  assert.equal(evaluatePredicate({ empty: 'naming.fields.notes' }, e), true);
  assert.equal(evaluatePredicate({ empty: 'naming.fields.sample' }, e), false);
  assert.equal(evaluatePredicate({ empty: 'naming.fields.nope' }, e), true);
});

test('all/any/not compose leaves', () => {
  const e = exp();
  assert.equal(
    evaluatePredicate({ all: [{ exists: 'naming.fields.sample' }, { gt: ['design.replicates', 1] }] }, e),
    true
  );
  assert.equal(
    evaluatePredicate({ all: [{ exists: 'naming.fields.sample' }, { gt: ['design.replicates', 99] }] }, e),
    false
  );
  assert.equal(evaluatePredicate({ any: [{ eq: ['naming.fields.sample', 'nope'] }, { gt: ['design.replicates', 1] }] }, e), true);
  assert.equal(evaluatePredicate({ any: [{ eq: ['naming.fields.sample', 'nope'] }, { gt: ['design.replicates', 99] }] }, e), false);
  assert.equal(evaluatePredicate({ not: { eq: ['naming.fields.sample', 'nope'] } }, e), true);
  assert.equal(evaluatePredicate({ not: { eq: ['naming.fields.sample', 'E02'] } }, e), false);
});

test('all([]) is vacuously true, any([]) is vacuously false', () => {
  const e = exp();
  assert.equal(evaluatePredicate({ all: [] }, e), true);
  assert.equal(evaluatePredicate({ any: [] }, e), false);
});

// ---------------------------------------------------------------------------
// Totality: undefined -> true, null -> false
// ---------------------------------------------------------------------------

test('an undefined predicate (no condition) evaluates to true', () => {
  assert.doesNotThrow(() => evaluatePredicate(undefined, exp()));
  assert.equal(evaluatePredicate(undefined, exp()), true);
});

test('a null predicate evaluates to false, not true', () => {
  assert.doesNotThrow(() => evaluatePredicate(null, exp()));
  assert.equal(evaluatePredicate(null, exp()), false);
});

test('literal true/false predicates evaluate to themselves', () => {
  assert.equal(evaluatePredicate(true, exp()), true);
  assert.equal(evaluatePredicate(false, exp()), false);
});

// ---------------------------------------------------------------------------
// Totality: every category of malformed/adversarial input -> false, never throws
// ---------------------------------------------------------------------------

test('an unknown operator evaluates to false without throwing', () => {
  const e = exp();
  assert.doesNotThrow(() => evaluatePredicate({ frobnicate: ['naming.fields.sample', 'E02'] }, e));
  assert.equal(evaluatePredicate({ frobnicate: ['naming.fields.sample', 'E02'] }, e), false);
});

test('a missing path evaluates to false without throwing, across operators', () => {
  const e = exp();
  const missing = 'naming.fields.does.not.exist.at.all';
  assert.doesNotThrow(() => evaluatePredicate({ eq: [missing, 'x'] }, e));
  assert.equal(evaluatePredicate({ eq: [missing, 'x'] }, e), false);
  assert.doesNotThrow(() => evaluatePredicate({ gt: [missing, 1] }, e));
  assert.equal(evaluatePredicate({ gt: [missing, 1] }, e), false);
  assert.doesNotThrow(() => evaluatePredicate({ in: [missing, ['x']] }, e));
  assert.equal(evaluatePredicate({ in: [missing, ['x']] }, e), false);
  assert.doesNotThrow(() => evaluatePredicate({ exists: missing }, e));
  assert.equal(evaluatePredicate({ exists: missing }, e), false);
});

test('a malformed node (wrong arity / non-array where an array is required) evaluates to false', () => {
  const e = exp();
  const cases = [
    { eq: ['naming.fields.sample'] }, // wrong arity: missing value
    { eq: ['naming.fields.sample', 'a', 'b'] }, // wrong arity: too many
    { in: ['naming.fields.sample', 'not-an-array'] }, // non-array where array required
    { matches: ['naming.fields.sample'] }, // wrong arity
    { exists: ['naming.fields.sample'] }, // exists wants a bare string path, not an array
    { all: 'not-an-array' }, // non-array argument to all
    { any: { not: 'an-array-either' } }, // non-array argument to any
    {}, // zero operator keys
    { eq: ['a', 1], ne: ['b', 2] }, // more than one operator key
    ['eq', 'naming.fields.sample'], // node itself is an array, not an object
    42, // node is neither object/boolean/undefined/null
    'oops', // node is a bare string
  ];
  for (const node of cases) {
    assert.doesNotThrow(() => evaluatePredicate(node, e), `should not throw for ${JSON.stringify(node)}`);
    assert.equal(evaluatePredicate(node, e), false, `should be false for ${JSON.stringify(node)}`);
  }
});

test('an invalid regex source in matches evaluates to false without throwing', () => {
  const e = exp();
  // Unbalanced parenthesis: compileFullMatch wraps this as '^(?:()$', which
  // is not a syntactically valid regular expression.
  assert.doesNotThrow(() => evaluatePredicate({ matches: ['naming.fields.sample', '('] }, e));
  assert.equal(evaluatePredicate({ matches: ['naming.fields.sample', '('] }, e), false);
});

test('a dangerous path segment (getPath throws) evaluates to false, not propagated, across operators', () => {
  // core/paths.js getPath THROWS on __proto__/constructor/prototype segments
  // to block prototype pollution. This proves predicate.js's own guard --
  // not a mock -- converts that real throw into `false` for every operator,
  // per this task's explicit instruction.
  const e = exp();
  assert.doesNotThrow(() => evaluatePredicate({ exists: '__proto__.polluted' }, e));
  assert.equal(evaluatePredicate({ exists: '__proto__.polluted' }, e), false);

  assert.doesNotThrow(() => evaluatePredicate({ empty: '__proto__.polluted' }, e));
  assert.equal(evaluatePredicate({ empty: '__proto__.polluted' }, e), false);

  assert.doesNotThrow(() => evaluatePredicate({ eq: ['constructor.prototype.polluted', 'x'] }, e));
  assert.equal(evaluatePredicate({ eq: ['constructor.prototype.polluted', 'x'] }, e), false);

  assert.doesNotThrow(() => evaluatePredicate({ matches: ['__proto__.polluted', '.*'] }, e));
  assert.equal(evaluatePredicate({ matches: ['__proto__.polluted', '.*'] }, e), false);

  // Prove the hazard is LIVE (lesson 20) using the real, unwrapped getPath
  // directly -- not a stand-in -- confirming predicate.js's guard is
  // actually neutralizing a throw that genuinely occurs, not one that was
  // never going to happen.
  assert.throws(() => getPath(e, '__proto__.polluted'), /unsafe path segment/);
  assert.throws(() => getPath(e, 'constructor.prototype.polluted'), /unsafe path segment/);
  assert.equal({}.polluted, undefined, 'the shared Object.prototype must remain unpolluted');
});

// ---------------------------------------------------------------------------
// The C0-4 anchoring landmine, re-proven in its new home
// ---------------------------------------------------------------------------

test('matches anchors the WHOLE string via compileFullMatch, not a substring search', () => {
  const e = exp({ naming: { fields: { sample: 'bad note' } } });
  const pred = { matches: ['naming.fields.sample', '[A-Za-z0-9_-]+'] };

  assert.doesNotThrow(() => evaluatePredicate(pred, e));
  assert.equal(evaluatePredicate(pred, e), false);

  // Prove this is a REAL landmine: a naive unanchored RegExp.test() on the
  // same pattern/input gives the WRONG answer (true), which is exactly the
  // bug C0-4 fixed in validation.js and which this task must not reintroduce
  // in a second home.
  assert.equal(new RegExp('[A-Za-z0-9_-]+').test('bad note'), true);
});

test('matches accepts a value that fully satisfies the anchored pattern', () => {
  const e = exp({ naming: { fields: { sample: 'E02' } } });
  const pred = { matches: ['naming.fields.sample', '[A-Za-z0-9_-]+'] };
  assert.equal(evaluatePredicate(pred, e), true);
});

// ---------------------------------------------------------------------------
// Depth cap: a runaway/cyclic-looking predicate must not blow the stack
// ---------------------------------------------------------------------------

function buildNotChain(depth, innermost) {
  let node = innermost;
  for (let i = 0; i < depth; i++) {
    node = { not: node };
  }
  return node;
}

test('a 40-deep not-chain is capped and returns false rather than a RangeError', () => {
  const e = exp();
  const deep = buildNotChain(40, { eq: ['naming.fields.sample', 'E02'] });
  assert.doesNotThrow(() => evaluatePredicate(deep, e));
  assert.equal(evaluatePredicate(deep, e), false);
});

test('depth cap forces false regardless of not-parity above the cutoff', () => {
  // 33 wraps and 34 wraps straddle the cap from opposite parities; both must
  // still come back false, proving the cap overrides local negation rather
  // than merely tripping at one lucky parity.
  const e = exp();
  const odd = buildNotChain(33, { eq: ['naming.fields.sample', 'E02'] });
  const even = buildNotChain(34, { eq: ['naming.fields.sample', 'E02'] });
  assert.doesNotThrow(() => evaluatePredicate(odd, e));
  assert.doesNotThrow(() => evaluatePredicate(even, e));
  assert.equal(evaluatePredicate(odd, e), false);
  assert.equal(evaluatePredicate(even, e), false);
});

test('a chain within the depth cap still evaluates normally (not merely swallowed)', () => {
  const e = exp();
  // 4 nots around a true leaf: not(not(not(not(true-leaf)))) === true-leaf's value.
  const shallow = buildNotChain(4, { eq: ['naming.fields.sample', 'E02'] });
  assert.equal(evaluatePredicate(shallow, e), true);
  const shallowOdd = buildNotChain(3, { eq: ['naming.fields.sample', 'E02'] });
  assert.equal(evaluatePredicate(shallowOdd, e), false);
});

// ---------------------------------------------------------------------------
// describePredicate: a non-empty, human-readable string for every operator
// ---------------------------------------------------------------------------

test('describePredicate returns a non-empty string for every operator in the grammar', () => {
  const nodes = [
    { eq: ['naming.fields.sample', 'E02'] },
    { ne: ['naming.fields.sample', 'E02'] },
    { in: ['naming.fields.magnification', ['X40', 'X63']] },
    { gt: ['design.replicates', 1] },
    { lt: ['design.replicates', 5] },
    { exists: 'naming.fields.sample' },
    { empty: 'naming.fields.notes' },
    { matches: ['naming.fields.sample', '[A-Za-z0-9_-]+'] },
    { all: [{ exists: 'naming.fields.sample' }] },
    { any: [{ exists: 'naming.fields.sample' }] },
    { not: { exists: 'naming.fields.sample' } },
    true,
    false,
    undefined,
  ];
  for (const node of nodes) {
    const text = describePredicate(node);
    assert.equal(typeof text, 'string', `description for ${JSON.stringify(node)}`);
    assert.ok(text.length > 0, `description for ${JSON.stringify(node)} must be non-empty`);
  }
});

test('describePredicate never throws even on malformed input', () => {
  const malformed = [null, 42, 'oops', ['array', 'node'], { unknownOp: 'x' }, { all: 'not-an-array' }];
  for (const node of malformed) {
    assert.doesNotThrow(() => describePredicate(node));
    assert.ok(describePredicate(node).length > 0);
  }
  const deep = buildNotChain(40, { exists: 'naming.fields.sample' });
  assert.doesNotThrow(() => describePredicate(deep));
  assert.ok(describePredicate(deep).length > 0);
});
