// AUD-14: ui/steps/naming.js's "Download schedule (.ics)" button used to pass
// planFilenames(view, NAMING_CONFIG).length -- the planned FILE/acquisition-run
// count (one row per group x factor x biological replicate x TECHNICAL
// replicate) -- as buildIcsSchedule's `sampleCount`, so a bench-schedule's
// MOUNTING minutes (a physical-slide operation, once per physical specimen)
// were inflated by the whole technical-replicate factor. AUD-02 already
// covers buildIcsSchedule's arithmetic (web/tests/ics.test.js); every case
// there passes `sampleCount` as a literal, so the wiring in naming.js -- the
// exact place the conflation lived -- has never been exercised until now.
// This suite drives the real click handler end to end (real design ->
// engine/conditions.js's physicalSampleCount -> engine/plan.js's
// planFilenames -> engine/render/ics.js's buildIcsSchedule -> a real Blob)
// rather than stubbing any of those functions, so it fails on a hardcoded
// literal or an off-by-one the same way a wrong wire would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomStub } from './domStub.js';
import { createNamingStep } from '../src/ui/steps/naming.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import { physicalSampleCount } from '../src/engine/conditions.js';
import { planFilenames } from '../src/engine/plan.js';
import { NAMING_CONFIG } from '../src/engine/namingConfig.js';

// 2 group levels x 1 (no factors) x 1 biological replicate x 3 technical
// replicates = 6 planned FILES (planFilenames length), but only 2 PHYSICAL
// samples (physicalSampleCount) -- groups x biological replicates, technical
// axis excluded. The two numbers must genuinely differ for this test to be
// able to catch a hardcoded literal or an off-by-one.
// naming.fields is filled in with every default-bearing field
// (NAMING_CONFIG.defaults: modality/exptype/markers/magnification/sample) so
// render()'s "generated placeholder" legend has nothing to list -- that
// legend renders through FakeElement.append(aPlainString) (domStub.js), which
// (unlike a real DOM) only accepts nodes, not strings. Leaving any of those
// fields blank is an unrelated domStub gap this task does not own; filling
// them keeps the test on the naming.js wiring this task DOES own.
function experimentWithTechnicalReplicates() {
  const experiment = emptyExperiment();
  const assay = experiment.assays[0];
  assay.label = 'Bench assay';
  assay.design = {
    groups: { levels: ['CT', 'NAM'] },
    factors: [],
    biologicalReplicates: 1,
    technicalReplicates: 3,
    idScheme: '',
    conditions: [],
  };
  assay.timing = {
    etaFixationMinutes: null,
    etaMountingMinutes: 12,
    etaAcquisitionMinutes: 8,
    etaAnalysisMinutes: null,
  };
  assay.naming = {
    fields: { modality: 'CONFOCAL', exptype: 'CT', markers: 'GFP', magnification: 'X40', sample: 'S1' },
  };
  return experiment;
}

// A factor present but not yet given any levels -- expandConditions (and so
// planFilenames) yields exactly zero rows for this (see
// web/tests/conditions.test.js's "a factor with zero levels yields zero rows
// AND an issue"), a realistic mid-edit state rather than a contrived one.
// Timing is left at emptyAssay's default (every ETA null/unanswered), so
// buildIcsSchedule has nothing to schedule regardless of either sample count.
function experimentWithZeroPlannedFilenames() {
  const experiment = emptyExperiment();
  const assay = experiment.assays[0];
  assay.label = 'Bench assay';
  assay.design = {
    groups: { levels: [] },
    factors: [{ name: 'stage', levels: [] }],
    biologicalReplicates: null,
    technicalReplicates: null,
    idScheme: '',
    conditions: [],
  };
  assay.naming = {
    fields: { modality: 'CONFOCAL', exptype: 'CT', markers: 'GFP', magnification: 'X40', sample: 'S1' },
  };
  return experiment;
}

function findDownloadButton(main) {
  return [...main.querySelectorAll('button')].find(
    (button) => button.textContent === 'Download schedule (.ics)'
  );
}

test('the .ics schedule scales mounting by physical samples and acquisition by planned files -- NOT the same count', async () => {
  const dom = createDomStub();
  dom.install();
  try {
    const experiment = experimentWithTechnicalReplicates();
    const assay = experiment.assays[0];

    // Ground truth, computed the same way naming.js's click handler now
    // must: physicalSampleCount ignores the technical axis, planFilenames
    // includes it. Asserted up front so this test fails loudly (rather than
    // vacuously agreeing with whatever the handler happens to compute) if
    // the fixture itself stops producing two different numbers.
    const expectedSampleCount = physicalSampleCount(assay.design);
    const view = { ...assay, naming: { fields: {} } };
    const expectedAcquisitionRunCount = planFilenames(view, NAMING_CONFIG).length;
    assert.equal(expectedSampleCount, 2);
    assert.equal(expectedAcquisitionRunCount, 6);
    assert.notEqual(expectedSampleCount, expectedAcquisitionRunCount);

    const store = createStore(experiment);
    const main = dom.document.createElement('div');
    const step = createNamingStep({ questions: [] });
    step.render(main, store, { advisor: [], experience: 'expert', embedded: false, showToast: () => {} });

    const button = findDownloadButton(main);
    assert.ok(button, 'expected to find the Download schedule (.ics) button');

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return originalCreateObjectURL(blob);
    };
    try {
      button.click();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }

    assert.ok(capturedBlob, 'expected the schedule click to build and download a Blob');
    const icsText = await capturedBlob.text();

    // Mounting is a physical-slide operation: scaled by physicalSampleCount
    // (2), not the file count (6).
    assert.match(icsText, /SUMMARY:Bench assay: Mounting \(2 samples\)/);
    // icsEscapeText backslash-escapes the literal comma in the DESCRIPTION
    // text (RFC 5545 3.3.11), hence `Mounting\,` below.
    assert.match(icsText, /DESCRIPTION:Mounting\\, 12 min\/sample × 2 sample\(s\)\./);
    assert.doesNotMatch(icsText, /Mounting \(6 sample/);

    // Acquisition re-measures the same mounted sample per technical
    // replicate: scaled by the planned FILE count (6), not the physical
    // sample count (2).
    assert.match(icsText, /SUMMARY:Bench assay: Microscope acquisition \(6 runs\)/);
    assert.match(icsText, /DESCRIPTION:Acquisition\\, 8 min\/run × 6 run\(s\)\./);
    assert.doesNotMatch(icsText, /Microscope acquisition \(2 run/);
  } finally {
    dom.restore();
  }
});

test('zero planned filenames takes the no-events branch and never downloads', () => {
  const dom = createDomStub();
  dom.install();
  try {
    const experiment = experimentWithZeroPlannedFilenames();
    const assay = experiment.assays[0];
    const view = { ...assay, naming: { fields: {} } };
    assert.equal(planFilenames(view, NAMING_CONFIG).length, 0);

    const store = createStore(experiment);
    const main = dom.document.createElement('div');
    const step = createNamingStep({ questions: [] });

    let alerted = false;
    dom.window.alert = () => {
      alerted = true;
    };

    step.render(main, store, { advisor: [], experience: 'expert', embedded: false, showToast: () => {} });

    const button = findDownloadButton(main);
    assert.ok(button, 'expected to find the Download schedule (.ics) button');

    let downloadCalled = false;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      downloadCalled = true;
      return originalCreateObjectURL(blob);
    };
    try {
      button.click();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }

    assert.equal(downloadCalled, false, 'expected no download when there is nothing to schedule');
    assert.equal(alerted, true, 'expected the no-events guard to alert instead of downloading');
  } finally {
    dom.restore();
  }
});
