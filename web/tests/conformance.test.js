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

test('the real oregano default study PASSES conformance -- the shipped example must not fail its own gate', () => {
  const report = checkConformance(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.pass, true, JSON.stringify(report.assays.flatMap((a) => a.issues), null, 2));
  assert.equal(report.assays.length, 4);
});

test('every issue carries a section naming which check produced it', () => {
  const study = createDefaultStudy();
  // Two arms with the same level produce identical name segments -- a real
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
  assert.ok(namingErrors.some((i) => i.severity === 'error' && i.field === 'sample' && /E01/.test(i.message)));
});

test('an UNANSWERED field is reported as incomplete (a warning), not as an invalid value -- and does not fail the gate', () => {
  // The default study never answers `sample`, so finalizeFields fills the
  // config placeholder 'UNKNOWN'. That is "not filled in yet", not "you
  // typed something wrong" -- it must be surfaced, but must not fail.
  const report = checkConformance(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.pass, true);
  const incomplete = report.assays.flatMap((a) => a.issues).filter((i) => i.section === 'incomplete');
  assert.ok(incomplete.length > 0, 'the unanswered sample field should still be REPORTED, never silently dropped');
  assert.ok(incomplete.every((i) => i.severity === 'warning'));
  assert.ok(incomplete.some((i) => /not answered yet/.test(i.message)));
});

test('issueCount counts every issue across assays plus cross-assay issues', () => {
  const report = checkConformance(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const manual = report.assays.reduce((sum, a) => sum + a.issues.length, 0) + report.crossAssayIssues.length;
  assert.equal(report.issueCount, manual);
});

test('TOTAL: a malformed/empty experiment yields a passing zero-assay report, never a throw', () => {
  for (const bad of [undefined, null, {}, { assays: 'not-an-array' }, 'nope']) {
    assert.doesNotThrow(() => checkConformance(bad, realKb(), NAMING_CONFIG, BASE_TEMPLATE), String(bad));
    const report = checkConformance(bad, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
    assert.deepEqual(report.assays, []);
    assert.equal(report.pass, true);
  }
});

test('emptyExperiment() (one blank assay) does not fail conformance -- a blank slate is not a broken study', () => {
  const report = checkConformance(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(report.assays.length, 1);
  assert.equal(report.pass, true);
});

test('deterministic: same study in, deep-equal report out', () => {
  const study = createDefaultStudy();
  const kb = realKb();
  assert.deepEqual(
    checkConformance(study, kb, NAMING_CONFIG, BASE_TEMPLATE),
    checkConformance(study, kb, NAMING_CONFIG, BASE_TEMPLATE)
  );
});
