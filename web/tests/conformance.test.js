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
import { emptyAssay } from '../src/core/assay.js';
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

// --- V4-N1 (retry): a non-Latin group/factor level is the one place
// naming.js only ever sees a group/factor label -- planFilenames -- so this
// pins that checkConformance (which Review is built on) actually surfaces
// it, closing the producer->consumer gap the first E1 attempt missed
// (the value reached finalizeFields only inside planFilenames, whose
// result was discarded before Review's own finalizeFields(effectiveNaming
// Fields(view)) call, which never contains design.groups.levels at all).
test('a non-Latin group level reaches the conformance report through planFilenames, not just study-level naming fields', () => {
  const study = createDefaultStudy();
  study.assays[0].design = { ...study.assays[0].design, groups: { levels: ['对照组'] } };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const allIssues = report.assays.flatMap((a) => a.issues);
  const hit = allIssues.find((i) => i.field === 'group' && i.severity === 'error');
  assert.ok(hit, JSON.stringify(allIssues, null, 2));
  assert.ok(hit.message.includes('对照组'), hit.message);
  assert.match(hit.message, /Latin/);
  // Attributed like every other conformance issue (lesson: R4-04/R4-07).
  assert.equal(hit.assayId, study.assays[0].id);
  assert.ok(typeof hit.stepId === 'string' || hit.stepId === null);
});

test('ordinary ASCII markers/instrument text produces no sanitization-loss issue in the conformance report', () => {
  const study = createDefaultStudy();
  study.assays[0].naming = { ...study.assays[0].naming, fields: { ...study.assays[0].naming?.fields, markers: 'GFP,DAPI' } };
  study.assays[0].acquisition = { ...study.assays[0].acquisition, modality: 'Zeiss LSM 880 (Airyscan)' };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const allIssues = report.assays.flatMap((a) => a.issues);
  assert.ok(!allIssues.some((i) => /lost the character/.test(i.message || '')), JSON.stringify(allIssues, null, 2));
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

// --- panel spillover: resolver parity, acknowledgements, issue attribution --
// (R4-01, V3-N1, R4-04, R4-07 foundations)

function panelIssuesFor(report, assayId) {
  const assay = report.assays.find((a) => a.id === assayId);
  return assay.issues.filter((i) => i.section === 'panel');
}

test('R4-01: a channels-only measurement and a markers-only measurement with the same 1nm-apart pair are BOTH readiness blocked, each with one panel issue naming both dyes', () => {
  const channelsAssay = {
    ...emptyAssay('channels-only'),
    panel: {
      ...emptyAssay('channels-only').panel,
      channels: [
        { id: 'c1', fluorophore: 'ALEXA488', conjugation: 'direct-probe' },
        { id: 'c2', fluorophore: 'FITC', conjugation: 'direct-probe' },
      ],
    },
  };
  const markersAssay = {
    ...emptyAssay('markers-only'),
    naming: { fields: { markers: 'ALEXA488-FITC' } },
  };
  const study = { ...emptyExperiment(), assays: [channelsAssay, markersAssay] };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);

  assert.equal(report.readiness, 'blocked');
  for (const assayId of ['channels-only', 'markers-only']) {
    const assay = report.assays.find((a) => a.id === assayId);
    assert.equal(assay.readiness, 'blocked', assayId);
    const panelIssues = panelIssuesFor(report, assayId);
    const errorIssues = panelIssues.filter((i) => i.severity === 'error');
    assert.equal(errorIssues.length, 1, assayId);
    assert.match(errorIssues[0].message, /ALEXA488/, assayId);
    assert.match(errorIssues[0].message, /FITC/, assayId);
  }
  // The two resolution routes agree byte-for-byte on the blocking message.
  assert.equal(
    panelIssuesFor(report, 'channels-only').find((i) => i.severity === 'error').message,
    panelIssuesFor(report, 'markers-only').find((i) => i.severity === 'error').message
  );
});

test('V3-N1: acknowledging the pair (reverse order on purpose) downgrades the flag to warning/needs-review; an un-acked control assay in the same study stays blocked', () => {
  const acked = {
    ...emptyAssay('acked'),
    panel: {
      ...emptyAssay('acked').panel,
      channels: [
        { id: 'c1', fluorophore: 'ALEXA488', conjugation: 'direct-probe' },
        { id: 'c2', fluorophore: 'FITC', conjugation: 'direct-probe' },
      ],
      spillover: { acknowledged: [{ pair: ['FITC', 'ALEXA488'], reason: 'filter-separated', at: '2026-01-01T00:00:00.000Z' }] },
    },
  };
  const unacked = {
    ...emptyAssay('unacked'),
    panel: {
      ...emptyAssay('unacked').panel,
      channels: [
        { id: 'c1', fluorophore: 'ALEXA488', conjugation: 'direct-probe' },
        { id: 'c2', fluorophore: 'FITC', conjugation: 'direct-probe' },
      ],
    },
  };
  const study = { ...emptyExperiment(), assays: [acked, unacked] };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);

  const ackedReport = report.assays.find((a) => a.id === 'acked');
  assert.equal(ackedReport.readiness, 'needs-review');
  const ackedPanelIssues = panelIssuesFor(report, 'acked');
  assert.ok(ackedPanelIssues.every((i) => i.severity !== 'error'), JSON.stringify(ackedPanelIssues));
  assert.ok(ackedPanelIssues.some((i) => /acknowledged/.test(i.message)));

  const unackedReport = report.assays.find((a) => a.id === 'unacked');
  assert.equal(unackedReport.readiness, 'blocked', 'non-vacuous: the un-acked control assay is unaffected');
  assert.ok(panelIssuesFor(report, 'unacked').some((i) => i.severity === 'error'));

  assert.equal(report.readiness, 'blocked', 'the study is still blocked overall by the unacked assay');
});

test('R4-04/R4-07: every issue in a two-measurement study carries assayId, assayLabel and a stepId (routeId)', () => {
  const first = { ...emptyAssay('m1'), label: 'Measurement one' };
  const second = {
    ...emptyAssay('m2'),
    label: 'Measurement two',
    design: { ...emptyAssay('m2').design, groups: { levels: ['CTL', 'CTL'] } },
  };
  const study = { ...emptyExperiment(), assays: [first, second] };
  const report = checkConformance(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);

  const allIssues = report.assays.flatMap((a) => a.issues);
  assert.ok(allIssues.length > 0);
  for (const issue of allIssues) {
    assert.equal(typeof issue.assayId, 'string', JSON.stringify(issue));
    assert.ok(issue.assayId.length > 0);
    assert.equal(typeof issue.assayLabel, 'string', JSON.stringify(issue));
    assert.ok(issue.assayLabel.length > 0);
    assert.equal(typeof issue.stepId, 'string', JSON.stringify(issue));
    assert.ok(issue.stepId.length > 0);
    assert.equal(issue.stepId, issue.routeId, 'stepId is the same identity decisionTriage calls routeId');
  }
  // Attribution actually distinguishes the two measurements, not a shared default.
  const m1Ids = new Set(allIssues.filter((i) => i.assayId === 'm1').map((i) => i.assayLabel));
  const m2Ids = new Set(allIssues.filter((i) => i.assayId === 'm2').map((i) => i.assayLabel));
  assert.ok(m1Ids.has('Measurement one'));
  assert.ok(m2Ids.has('Measurement two'));
});
