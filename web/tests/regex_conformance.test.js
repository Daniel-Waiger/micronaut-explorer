import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileFullMatch } from '../src/engine/validation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', '..', 'tests', 'fixtures', 'regex_conformance.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8'));

test('compileFullMatch agrees with the shared regex_conformance fixture', () => {
  for (const { pattern, input, expected } of fixtures) {
    const actual = compileFullMatch(pattern).test(input);
    assert.equal(actual, expected, `pattern=${pattern} input=${JSON.stringify(input)}`);
  }
});

test('landmine cases prove the portability gap is real', () => {
  // The fixture must contain at least one case where a naive unanchored
  // RegExp.test() would give the WRONG answer and compileFullMatch the
  // correct one -- proving the fixture actually exercises the JS/Python
  // anchoring landmine rather than only trivial already-anchored patterns.
  const landmines = fixtures.filter((f) => f.landmine);
  assert.ok(landmines.length > 0, 'fixture must contain at least one landmine case');
  for (const { pattern, input, expected } of landmines) {
    const naive = new RegExp(pattern).test(input);
    const correct = compileFullMatch(pattern).test(input);
    assert.equal(correct, expected);
    assert.notEqual(naive, expected, 'landmine case must trip up a naive unanchored RegExp.test()');
  }
});
