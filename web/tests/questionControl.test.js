import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateInputValue } from '../src/ui/questionControl.js';

test('localDateInputValue formats the local calendar day for a native date picker', () => {
  assert.equal(localDateInputValue(new Date(2026, 7, 24, 9, 5)), '2026-08-24');
  assert.equal(localDateInputValue(new Date(2026, 0, 3, 23, 59)), '2026-01-03');
});

test('localDateInputValue degrades safely for an invalid date', () => {
  assert.equal(localDateInputValue(new Date('invalid')), '');
  assert.equal(localDateInputValue(null), '');
});
