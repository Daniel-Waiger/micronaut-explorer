// Tests for engine/render/ics.js -- the timing-interview -> .ics schedule
// export.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcsSchedule, renderIcs } from '../src/engine/render/ics.js';

const START = new Date(2026, 5, 15, 9, 0, 0); // 2026-06-15 09:00 local, floating

test('buildIcsSchedule omits a stage whose ETA was never answered', () => {
  const events = buildIcsSchedule({
    assayLabel: 'Bacterial viability',
    timing: { etaFixationMinutes: 30, etaMountingMinutes: null, etaAcquisitionMinutes: null, etaAnalysisMinutes: null },
    sampleCount: 4,
    startDate: START,
  });
  assert.equal(events.length, 1);
  assert.match(events[0].summary, /Fixation & staining/);
});

test('buildIcsSchedule multiplies per-sample stages by sampleCount into ONE block', () => {
  const events = buildIcsSchedule({
    assayLabel: 'Bacterial viability',
    timing: { etaFixationMinutes: null, etaMountingMinutes: 10, etaAcquisitionMinutes: 15, etaAnalysisMinutes: null },
    sampleCount: 4,
    startDate: START,
  });
  assert.equal(events.length, 2);
  const mounting = events.find((e) => e.summary.includes('Mounting'));
  const acquisition = events.find((e) => e.summary.includes('acquisition'));
  assert.equal(mounting.minutes, 40); // 10 * 4
  assert.equal(acquisition.minutes, 60); // 15 * 4
  assert.match(mounting.summary, /4 samples/);
});

test('buildIcsSchedule chains stages back to back, in fixed order, with no gaps or overlaps', () => {
  const events = buildIcsSchedule({
    assayLabel: 'X',
    timing: { etaFixationMinutes: 30, etaMountingMinutes: 10, etaAcquisitionMinutes: 20, etaAnalysisMinutes: 60 },
    sampleCount: 1,
    startDate: START,
  });
  assert.equal(events.length, 4);
  assert.equal(events[0].start.getTime(), START.getTime());
  for (let i = 1; i < events.length; i++) {
    const prevEnd = events[i - 1].start.getTime() + events[i - 1].minutes * 60000;
    assert.equal(events[i].start.getTime(), prevEnd, `event ${i} must start exactly when event ${i - 1} ends`);
  }
  assert.match(events[0].summary, /Fixation/);
  assert.match(events[1].summary, /Mounting/);
  assert.match(events[2].summary, /acquisition/);
  assert.match(events[3].summary, /analysis/);
});

test('buildIcsSchedule clamps sampleCount to at least 1 -- a broken/empty design still gets one worked block', () => {
  const zero = buildIcsSchedule({
    assayLabel: 'X',
    timing: { etaFixationMinutes: null, etaMountingMinutes: 10, etaAcquisitionMinutes: null, etaAnalysisMinutes: null },
    sampleCount: 0,
    startDate: START,
  });
  assert.equal(zero[0].minutes, 10);

  const negative = buildIcsSchedule({
    assayLabel: 'X',
    timing: { etaFixationMinutes: null, etaMountingMinutes: 10, etaAcquisitionMinutes: null, etaAnalysisMinutes: null },
    sampleCount: -5,
    startDate: START,
  });
  assert.equal(negative[0].minutes, 10);
});

test('buildIcsSchedule with every ETA unanswered yields zero events, never throws', () => {
  const events = buildIcsSchedule({
    assayLabel: 'X',
    timing: {},
    sampleCount: 3,
    startDate: START,
  });
  assert.deepEqual(events, []);
});

test('renderIcs wraps zero events in a still-valid, empty calendar', () => {
  const ics = renderIcs([], { now: START });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});

test('renderIcs produces one VEVENT per event, with DTSTART/DTEND/SUMMARY', () => {
  const events = buildIcsSchedule({
    assayLabel: 'Bacterial viability',
    timing: { etaFixationMinutes: 30, etaMountingMinutes: null, etaAcquisitionMinutes: null, etaAnalysisMinutes: null },
    sampleCount: 1,
    startDate: START,
  });
  const ics = renderIcs(events, { now: START });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.includes('DTSTART:20260615T090000'));
  assert.ok(ics.includes('DTEND:20260615T093000')); // 30 minutes later
  assert.ok(ics.includes('SUMMARY:Bacterial viability: Fixation & staining'));
});

test('renderIcs escapes a comma/semicolon in the assay label so it cannot corrupt the property', () => {
  const events = buildIcsSchedule({
    assayLabel: 'Assay, with; special chars',
    timing: { etaFixationMinutes: 15, etaMountingMinutes: null, etaAcquisitionMinutes: null, etaAnalysisMinutes: null },
    sampleCount: 1,
    startDate: START,
  });
  const ics = renderIcs(events, { now: START });
  assert.ok(ics.includes('Assay\\, with\\; special chars'));
});

test('renderIcs uses CRLF line endings (RFC 5545)', () => {
  const ics = renderIcs([], { now: START });
  assert.ok(ics.includes('\r\n'));
  assert.ok(!ics.replace(/\r\n/g, '').includes('\n'));
});

// --- acquisitionRunCount: mounting scales with physical samples, --------
// acquisition scales with acquisition runs (which include technical
// replicates) -- these must NOT be the same number once the two diverge.

test('acquisitionRunCount scales acquisition but NOT mounting -- the technical-replicate asymmetry', () => {
  // sampleCount is the physical-sample count (e.g. physicalSampleCount(design)
  // for 4 samples); acquisitionRunCount folds in 3 technical replicates per
  // sample, so it is 3x sampleCount, exactly as planFilenames(...).length
  // would be for this design.
  const events = buildIcsSchedule({
    assayLabel: 'Bacterial viability',
    timing: { etaFixationMinutes: null, etaMountingMinutes: 10, etaAcquisitionMinutes: 15, etaAnalysisMinutes: null },
    sampleCount: 4,
    acquisitionRunCount: 12, // 4 samples x 3 technical replicates
    startDate: START,
  });
  assert.equal(events.length, 2);
  const mounting = events.find((e) => e.summary.includes('Mounting'));
  const acquisition = events.find((e) => e.summary.includes('acquisition'));
  // Mounting is NOT tripled: it is still 10 min/sample x 4 physical samples.
  assert.equal(mounting.minutes, 40);
  // Acquisition IS tripled: 15 min/run x 12 acquisition runs.
  assert.equal(acquisition.minutes, 180);
  assert.match(mounting.summary, /4 samples/);
  assert.match(acquisition.summary, /12 runs/);
});

test('omitting acquisitionRunCount reproduces the pre-AUD-02 output exactly (protects every existing caller)', () => {
  const withoutRunCount = buildIcsSchedule({
    assayLabel: 'Bacterial viability',
    timing: { etaFixationMinutes: 30, etaMountingMinutes: 10, etaAcquisitionMinutes: 15, etaAnalysisMinutes: 60 },
    sampleCount: 4,
    startDate: START,
  });
  const withExplicitEqualRunCount = buildIcsSchedule({
    assayLabel: 'Bacterial viability',
    timing: { etaFixationMinutes: 30, etaMountingMinutes: 10, etaAcquisitionMinutes: 15, etaAnalysisMinutes: 60 },
    sampleCount: 4,
    acquisitionRunCount: 4,
    startDate: START,
  });
  assert.deepEqual(withoutRunCount, withExplicitEqualRunCount);

  const acquisition = withoutRunCount.find((e) => e.summary.includes('acquisition'));
  assert.equal(acquisition.minutes, 60); // 15 * 4, unchanged from before this task
});

test('acquisitionRunCount is clamped to at least 1, same as sampleCount', () => {
  const events = buildIcsSchedule({
    assayLabel: 'X',
    timing: { etaFixationMinutes: null, etaMountingMinutes: null, etaAcquisitionMinutes: 15, etaAnalysisMinutes: null },
    sampleCount: 4,
    acquisitionRunCount: 0,
    startDate: START,
  });
  assert.equal(events[0].minutes, 15); // 15 * 1, not 15 * 4 and not NaN/0
});
