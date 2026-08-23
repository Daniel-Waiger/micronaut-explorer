// Tests for engine/conformance.js -- the whole-study "does this hold
// together" gate (Wave 2C, alpha-pilot-readiness). A COMPOSITION of checks
// the app already runs per-step, so these tests focus on the composition
// itself (pass/fail rule, section tagging, totality), not on re-testing
// conditionIssues/validateFields, which have their own suites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConformance } from '../src/engine/conformance.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { emptyExperiment } from '../src/core/schema.js';
import { NAMING_CONFIG, BASE_TEMPLATE, realKb } from './fixtures.js';

test('the real oregano default study needs review instead of falsely claiming export readiness', () => {
  const report = checkConformance(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.pass, true, JSON.stringify(report.assays.flatMap((a) => a.issues), null, 2));
  assert.equal(report.readiness, 'needs-review');
  assert.equal(report.counts.blocked, 0);
  assert.ok(report.counts.needsReview > 0);
  assert.equal(report.assays.length, 4);
});

test('every issue carries a section naming which check produced it', () => {
  const study = createDefaultStudy();
  // Two groups with the same level produce identical name segments -- a real
  // conditionIssues error, not a placeholder.
  study.assays[0].design = { ...study.assays[0].design, groups: { levels: ['CTL', 'CTL'] } };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const allIssues = report.assays.flatMap((a) => a.issues);
  assert.ok(allIssues.length > 0);
  assert.ok(allIssues.every((i) => typeof i.section === 'string' && i.section.length > 0));
  assert.ok(allIssues.some((i) => i.section === 'design'));
});

test('an error-severity issue anywhere fails the gate; the report still lists every assay', () => {
  const study = createDefaultStudy();
  study.assays[0].design = { ...study.assays[0].design, groups: { levels: ['CTL', 'CTL'] } };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.pass, false);
  assert.equal(report.readiness, 'blocked');
  assert.ok(report.counts.blocked > 0);
  assert.equal(report.assays.length, 4);
});

test('an ANSWERED-but-invalid field is an error that fails the gate', () => {
  const study = createDefaultStudy();
  study.assays[0].naming = { fields: { ...study.assays[0].naming.fields, sample: 'bad sample!' } };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.pass, false);
  const namingErrors = report.assays.flatMap((a) => a.issues).filter((i) => i.section === 'naming');
  // Plain-language message (engine/validation.js), not the internal profile
  // key name -- check the field it's about and that it names a valid
  // example, not the old 'sample_pattern' jargon a user wouldn't parse.
  assert.ok(namingErrors.some((i) => i.severity === 'error' && i.field === 'sample' && /ABC01/.test(i.message)));
});

test('the default study reports its visible date/sample placeholders for every assay', () => {
  // finalizeFields intentionally leaves previewable filenames in place with
  // 1970-01-01 and UNKNOWN defaults. Both must remain visible, but neither
  // may silently count as an answered required field.
  const report = checkConformance(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.pass, true);
  assert.equal(report.readiness, 'needs-review');
  const incomplete = report.assays.flatMap((a) => a.issues).filter((i) => i.section === 'incomplete');
  assert.ok(incomplete.every((i) => i.severity === 'warning'));
  for (const assay of report.assays) {
    const fields = assay.issues.filter((i) => i.section === 'incomplete').map((i) => i.field);
    assert.ok(fields.includes('date'), `${assay.label} must report its 1970-01-01 date placeholder`);
    assert.ok(fields.includes('sample'), `${assay.label} must report its UNKNOWN sample placeholder`);
  }
  assert.ok(incomplete.some((i) => /not answered yet/.test(i.message)));
});

test('issueCount counts every issue across assays plus cross-assay issues', () => {
  const report = checkConformance(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const manual = report.assays.reduce((sum, a) => sum + a.issues.length, 0) + report.crossAssayIssues.length;
  assert.equal(report.issueCount, manual);
  assert.equal(report.counts.total, manual);
});

test('TOTAL: a malformed/empty experiment yields a ready zero-assay report, never a throw', () => {
  for (const bad of [undefined, null, {}, { assays: 'not-an-array' }, 'nope']) {
    assert.doesNotThrow(() => checkConformance(bad, realKb(), NAMING_CONFIG, BASE_TEMPLATE), String(bad));
    const report = checkConformance(bad, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
    assert.deepEqual(report.assays, []);
    assert.equal(report.pass, true);
    assert.equal(report.readiness, 'ready');
    assert.deepEqual(report.counts, { blocked: 0, needsReview: 0, total: 0 });
  }
});

test('emptyExperiment() is needs-review rather than blocked', () => {
  const report = checkConformance(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.assays.length, 1);
  assert.equal(report.pass, true);
  assert.equal(report.readiness, 'needs-review');
});

test('filling valid date/sample values and scratch magnification clears default-study readiness warnings', () => {
  const study = createDefaultStudy();
  for (const [index, assay] of study.assays.entries()) {
    assay.naming = {
      fields: {
        ...assay.naming.fields,
        date: '2026-08-23',
        sample: `ORA${String(index + 1).padStart(2, '0')}`,
        ...(assay.label === 'Scratch / migration' ? { magnification: 'X10' } : {}),
      },
    };
  }

  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.readiness, 'ready', JSON.stringify(report, null, 2));
  assert.deepEqual(report.counts, { blocked: 0, needsReview: 0, total: 0 });
  assert.equal(report.pass, true, 'pass remains the compatibility alias for not-blocked');
  assert.ok(
    !report.assays.flatMap((assay) => assay.issues).some((issue) => issue.field === 'date' || issue.field === 'sample'),
    'genuinely valid date/sample values must not be classified as placeholders'
  );
});

test('deterministic: same study in, deep-equal report out', () => {
  const study = createDefaultStudy();
  const kb = realKb();
  assert.deepEqual(
    checkConformance(study, kb, NAMING_CONFIG, BASE_TEMPLATE),
    checkConformance(study, kb, NAMING_CONFIG, BASE_TEMPLATE)
  );
});
