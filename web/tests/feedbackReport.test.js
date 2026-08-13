// Tests for core/feedbackReport.js -- the "Copy feedback report" button's
// text builder (Wave 1 of alpha-pilot-readiness).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackReport } from '../src/core/feedbackReport.js';

const FIXED_NOW = new Date('2026-08-12T12:00:00.000Z');

test('includes the step, KB issue count, browser, and a JSON-serialized study', () => {
  const report = buildFeedbackReport({
    currentStepId: 'panel',
    kbIssueCount: 0,
    userAgent: 'TestBrowser/1.0',
    experiment: { schemaVersion: 3, assays: [] },
    now: FIXED_NOW,
  });
  assert.match(report, /Generated: 2026-08-12T12:00:00\.000Z/);
  assert.match(report, /Step: panel/);
  assert.match(report, /Knowledge-pack issues: 0/);
  assert.match(report, /Browser: TestBrowser\/1\.0/);
  assert.match(report, /"schemaVersion": 3/);
});

test('missing fields degrade to labeled placeholders, never the literal "undefined"', () => {
  const report = buildFeedbackReport({ now: FIXED_NOW });
  assert.match(report, /Step: \(unknown\)/);
  assert.match(report, /Knowledge-pack issues: \(unknown\)/);
  assert.match(report, /Browser: \(unknown\)/);
  assert.ok(!report.includes('undefined'));
});

test('never throws on a malformed experiment, and defaults `now` when omitted', () => {
  assert.doesNotThrow(() => buildFeedbackReport({ experiment: undefined }));
  assert.doesNotThrow(() => buildFeedbackReport());
  const report = buildFeedbackReport({});
  assert.match(report, /^Generated: \d{4}-\d{2}-\d{2}T/m);
});
