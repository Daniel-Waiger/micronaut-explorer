// Adopted from the reviewer's R6 repro (scratchpad/review/findings/r6/
// crossSectionStale.test.js) for task A4, with the two edits the task graph
// calls for: (1) `stub.window.advance(150)` after each store-writing
// dispatch, so measurement.js's coalesced trailing setTimeout actually fires
// before the post-write assertion; (2) a REAL `getWorkflowProgress` thunk
// (deriveWorkflowProgress + checkConformance over the real kb, exactly like
// main.js's own) in place of the original's literal `{ assays: [] }`
// stand-in, which could never have driven a real badge change.
//
// R6-01 / R6-02 repro: on the composed Measurement page (ui/steps/measurement.js
// renders design + panel + naming into ONE page), each embedded sub-step only
// re-renders ITSELF after a write. Nothing subscribes to the store on that page
// (main.js only re-renders on activeAssayId change or a NEW `assays` array
// reference, and store.setPath mutates in place), so:
//   R6-01  typing markers in the Data plan section leaves the Acquisition
//          section's colour panel / spillover flags / spectral view showing the
//          PREVIOUS markers -- on screen at the same time, three sections apart.
//   R6-02  editing groups in Samples & design leaves the Data plan section's
//          read-only "Group" row and the planned-filename table stale, even
//          though naming.js's own comment claims that row "can never disagree
//          with the {group} token actually embedded in the filenames".
//
// A4 gives measurement.js the coalescing onSectionChanged/refresh mechanism,
// but the ACTUAL notify calls are A2a (design.js) / A2b (naming.js) / A2c
// (panel.js) -- none of which have landed yet. So even with the two edits
// above, these three cases are expected to still FAIL after A4 alone: no
// section calls onSectionChanged yet, so the 150ms timer this suite advances
// past never gets scheduled. See A4's report for which of these pass now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomStub } from './domStub.js';
import { realKb, NAMING_CONFIG, BASE_TEMPLATE } from './fixtures.js';
import { createMeasurementStep } from '../src/ui/steps/measurement.js';
import { createPanelStep } from '../src/ui/steps/panel.js';
import { createNamingStep } from '../src/ui/steps/naming.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import { checkConformance } from '../src/engine/conformance.js';
import { deriveWorkflowProgress } from '../src/engine/workflowProgress.js';

// Edit 2 of 2: a real thunk, not a literal { assays: [] } stand-in -- see
// the file header above.
function progressFor(experiment, kb) {
  const conformance = checkConformance(experiment, kb, NAMING_CONFIG, BASE_TEMPLATE);
  return deriveWorkflowProgress(experiment, conformance, kb.questions);
}

function seeded({ emptyGroups = false } = {}) {
  const experiment = emptyExperiment();
  const assay = experiment.assays[0];
  assay.label = 'M1';
  // Same shape as measurementRefresh.test.js's seed: a readout, a modality
  // and a comparison mode are what let the design scope's status move when
  // groups appear (probed: without them every state reads Draft/Plan
  // open/Blocked and no badge can ever change).
  assay.readoutText = 'viability';
  assay.acquisition = { ...(assay.acquisition || {}), modality: 'confocal' };
  experiment.studyContext = { ...(experiment.studyContext || {}), comparisonMode: 'groups' };
  assay.design = {
    groups: { levels: emptyGroups ? [] : ['CT'] },
    factors: [],
    biologicalReplicates: 3,
    technicalReplicates: 2,
    idScheme: '',
    conditions: [],
  };
  assay.naming = {
    fields: { modality: 'CONFOCAL', exptype: 'CT', markers: '', magnification: 'X40', sample: 'S1' },
  };
  return experiment;
}

function mount(seedOptions = {}) {
  const stub = createDomStub();
  stub.install();
  const kb = realKb();
  const step = createMeasurementStep({
    panelStep: createPanelStep(kb),
    namingStep: createNamingStep(kb),
  });
  const store = createStore(seeded(seedOptions));
  const main = document.createElement('div');
  step.render(main, store, {
    advisor: kb.advisor,
    router: null,
    workflowProgress: progressFor(store.get(), kb),
    getWorkflowProgress: () => progressFor(store.get(), kb),
  });
  return { stub, store, main };
}

function section(main, id) {
  return main.querySelectorAll('.measurement-section').find((s) => s.dataset.measurementSection === id);
}

// The markers text box lives in the Data plan (naming) section. Find it by the
// placeholder naming.js gives it.
function markersInput(main) {
  return section(main, 'naming')
    .querySelectorAll('input')
    .find((i) => (i.placeholder || '').toLowerCase().includes('gfp'));
}

test('R6-01: markers typed on Data plan do not refresh the Acquisition colour panel on the same page', () => {
  const { stub, store, main } = mount();
  try {
    const acq = section(main, 'panel');
    assert.match(acq.textContent, /No markers entered yet/, 'precondition: panel starts empty');

    const input = markersInput(main);
    assert.ok(input, 'found the markers field in the Data plan section');
    input.value = 'GFP, mCherry';
    input.dispatch('input');
    stub.window.advance(150); // edit 1 of 2: let the coalesced refresh fire

    // The store really was written -- this is not a wiring failure.
    assert.equal(store.get().assays[0].naming.fields.markers, 'GFP, mCherry');

    // ...but the Acquisition section three sections up still says there are none.
    const acqNow = section(main, 'panel');
    assert.doesNotMatch(
      acqNow.textContent,
      /No markers entered yet/,
      'BUG: Acquisition still shows "No markers entered yet" after markers were entered on the same page'
    );
  } finally {
    stub.restore();
  }
});

test('R6-02: groups edited in Samples & design do not refresh the Data plan Group row / filename table', () => {
  const { stub, store, main } = mount();
  try {
    const plan = section(main, 'naming');
    const groupRowBefore = plan.querySelectorAll('.field-readonly-value').map((e) => e.textContent);
    assert.ok(groupRowBefore.some((t) => t.includes('CT')), `precondition: Group row shows CT, got ${JSON.stringify(groupRowBefore)}`);

    // Rename the one group in Samples & design (design.js's group name box).
    const design = section(main, 'design');
    const groupInput = design.querySelectorAll('input.factor-levels')[0];
    assert.ok(groupInput, 'found the group name input');
    groupInput.value = 'TREATED';
    groupInput.dispatch('input');
    stub.window.advance(150); // edit 1 of 2: let the coalesced refresh fire
    assert.deepEqual(store.get().assays[0].design.groups.levels, ['TREATED'], 'store was written');

    const groupRowAfter = section(main, 'naming')
      .querySelectorAll('.field-readonly-value')
      .map((e) => e.textContent);
    assert.ok(
      groupRowAfter.some((t) => t.includes('TREATED')),
      `BUG: Data plan's Group row still reads ${JSON.stringify(groupRowAfter)} after the group was renamed to TREATED on the same page`
    );
  } finally {
    stub.restore();
  }
});

// R6-08: the Measurement page's three status badges are a render-time snapshot
// of options.workflowProgress (measurement.js:124-134). No in-page action
// updates them, because nothing on the page re-renders the header. A user can
// complete every field the status is derived from and the badges still read
// the state the page was opened in -- lesson 37's "what user action clears
// this flag?" answered with "leaving the page and coming back".
test('R6-08: the measurement header status badges follow in-page work (empty groups -> add one)', () => {
  // Reseeded per red-team A4: with the original seed the derived status was
  // identical before and after its edits, so no badge could ever change. A
  // measurement with a readout, a modality, replicates and NO groups reads
  // "Needs a decision" on the plan scope; adding a group through the real
  // Add-group control flips it -- the freeze R6-08 documented was that this
  // never happened without leaving the page.
  const { stub, store, main } = mount({ emptyGroups: true });
  try {
    const badgesBefore = main.querySelectorAll('.measurement-status-badge').map((b) => b.textContent);
    assert.equal(badgesBefore.length, 3, `three badges render: ${JSON.stringify(badgesBefore)}`);

    const design = section(main, 'design');
    const addGroupBtn = design.querySelectorAll('button.add-factor-button').find((b) => b.textContent === 'Add group');
    assert.ok(addGroupBtn, 'found the real Add group button');
    addGroupBtn.dispatch('click');
    const levelInput = section(main, 'design').querySelectorAll('input.factor-levels')[0];
    levelInput.value = 'CTRL';
    levelInput.dispatch('input');
    assert.deepEqual(store.get().assays[0].design.groups.levels, ['CTRL'], 'store was really written');
    stub.window.advance(150);

    const badgesAfter = main.querySelectorAll('.measurement-status-badge').map((b) => b.textContent);
    assert.notDeepEqual(
      badgesAfter,
      badgesBefore,
      `BUG: header badges are frozen at ${JSON.stringify(badgesBefore)} no matter what the user does on this page`
    );
  } finally {
    stub.restore();
  }
});
