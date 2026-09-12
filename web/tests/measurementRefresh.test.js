// ui/steps/measurement.js's cross-section refresh hook (A4): each embedded
// section's render() returns `{ id, refresh() }`; a section calls the
// `onSectionChanged(sourceId)` this page hands it (via embeddedOptions)
// after it writes to the store; this page coalesces source ids behind one
// trailing window.setTimeout(150) and, when it fires, calls refresh() on
// every OTHER section's handle plus refreshHeader() (which re-reads
// options.getWorkflowProgress?.() ?? options.workflowProgress and rebuilds
// only the existing statusGroup element's children).
//
// design.js/panel.js/naming.js do not call onSectionChanged yet (that is
// A2a/A2b/A2c) and currently return undefined from render() rather than a
// handle -- this suite proves the mechanism itself (coalescing, the
// re-entrancy guard, the real getWorkflowProgress-driven header refresh,
// tolerance of "no refresh" handles, and harmlessness after the page is torn
// down) works today, and drives the REAL design 'Add group' control plus a
// manually-triggered hook (standing in for A2a's own call) so test (c) is
// meaningful before that task lands rather than only after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createDomStub } from './domStub.js';
import { realKb, NAMING_CONFIG, BASE_TEMPLATE } from './fixtures.js';
import { createMeasurementStep } from '../src/ui/steps/measurement.js';
import { createPanelStep } from '../src/ui/steps/panel.js';
import { createNamingStep } from '../src/ui/steps/naming.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import { checkConformance } from '../src/engine/conformance.js';
import { deriveWorkflowProgress } from '../src/engine/workflowProgress.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const measurementSource = readFileSync(
  path.join(here, '../src/ui/steps/measurement.js'),
  'utf-8'
);

// Same real-engine derivation main.js's own getWorkflowProgress thunk uses
// (web/src/main.js:~305) -- without this the header-badge assertions below
// could never pass (a literal {assays: []} stand-in never differs).
function progressFor(experiment, kb) {
  const conformance = checkConformance(experiment, kb, NAMING_CONFIG, BASE_TEMPLATE);
  return deriveWorkflowProgress(experiment, conformance, kb.questions);
}

// Wraps a real step so the test can capture the `onSectionChanged` function
// measurement.js hands into embeddedOptions -- every embedded step receives
// the identical function reference, so capturing it here (via the injectable
// panelStep) gets the same hook design.js's own Add-group click would call
// once A2a lands, letting this suite exercise the real mechanism today.
function captureOnSectionChanged(step) {
  const captured = { fn: null };
  const wrapped = {
    id: step.id,
    title: step.title,
    render(section, store, options) {
      captured.fn = options.onSectionChanged;
      return step.render(section, store, options);
    },
  };
  return { wrapped, captured };
}

function seeded() {
  const experiment = emptyExperiment();
  const assay = experiment.assays[0];
  assay.label = 'M1';
  assay.readoutText = 'viability';
  assay.acquisition = { ...(assay.acquisition || {}), modality: 'confocal' };
  assay.design = {
    groups: { levels: [] },
    factors: [],
    biologicalReplicates: 3,
    technicalReplicates: 2,
    idScheme: '',
    conditions: [],
  };
  experiment.studyContext = { ...(experiment.studyContext || {}), comparisonMode: 'groups' };
  return experiment;
}

function mount(kb, { panelStep, namingStep } = {}) {
  const stub = createDomStub();
  stub.install();
  const store = createStore(seeded());
  const step = createMeasurementStep({
    panelStep: panelStep || createPanelStep(kb),
    namingStep: namingStep || createNamingStep(kb),
  });
  const main = document.createElement('div');
  step.render(main, store, {
    workflowProgress: progressFor(store.get(), kb),
    getWorkflowProgress: () => progressFor(store.get(), kb),
  });
  return { stub, store, main };
}

function section(main, id) {
  return main.querySelectorAll('.measurement-section').find((s) => s.dataset.measurementSection === id);
}

function badgeTexts(main) {
  return main.querySelectorAll('.measurement-status-badge').map((b) => b.textContent);
}

test('loop-freedom: measurement.js\'s refresh/onSectionChanged code never writes the store', () => {
  // The whole refresh mechanism (onSectionChanged, its setTimeout callback,
  // and refreshHeader) must never call store.setPath/patch/replace -- if it
  // did, a refresh could itself trigger another onSectionChanged and loop.
  // This greps the ENTIRE file (not just those functions) because none of
  // measurement.js writes the store today; the assertion is deliberately the
  // strongest true statement, not a narrower one that would still pass if a
  // write were added elsewhere in the file by mistake.
  assert.doesNotMatch(
    measurementSource,
    /store\.(setPath|patch|replace)\s*\(/,
    'measurement.js must never call store.setPath/patch/replace -- refresh paths only read'
  );
});

test('a section with no refresh (render() still returns undefined, pre-A2a/b/c) does not break the page', () => {
  const kb = realKb();
  const { stub, main } = mount(kb);
  try {
    const before = badgeTexts(main);
    assert.equal(before.length, 3, `three status badges render: ${JSON.stringify(before)}`);

    // Nothing calls onSectionChanged yet in real design/panel/naming code, so
    // simulate an arbitrary section reporting a change and confirm firing the
    // hook (coalesced timer included) is harmless when every handle is
    // undefined -- refreshHeader still runs, the page does not throw.
    const wrap = captureOnSectionChanged(createPanelStep(kb));
    const mounted = mount(kb, { panelStep: wrap.wrapped });
    assert.doesNotThrow(() => {
      wrap.captured.fn('panel');
      mounted.stub.window.advance(150);
    });
    const after = badgeTexts(mounted.main);
    assert.equal(after.length, 3, `still three status badges after a no-op refresh: ${JSON.stringify(after)}`);
    mounted.stub.restore();
  } finally {
    stub.restore();
  }
});

test('(c) real getWorkflowProgress thunk: adding a group changes the header badges after the coalesced refresh', () => {
  const kb = realKb();
  const wrap = captureOnSectionChanged(createPanelStep(kb));
  const { stub, store, main } = mount(kb, { panelStep: wrap.wrapped });
  try {
    const before = badgeTexts(main);

    // Drive the REAL design 'Add group' button, then type into the new
    // level input -- exactly the interaction a user performs, through
    // design.js's own real handlers, not a store.setPath from the test.
    const design = section(main, 'design');
    const addGroupBtn = design.querySelectorAll('button.add-factor-button').find((b) => b.textContent === 'Add group');
    assert.ok(addGroupBtn, 'found the real Add group button');
    addGroupBtn.dispatch('click');

    const levelInput = section(main, 'design').querySelectorAll('input.factor-levels')[0];
    assert.ok(levelInput, 'found the new group level input');
    levelInput.value = 'CT';
    levelInput.dispatch('input');
    assert.deepEqual(store.get().assays[0].design.groups.levels, ['CT'], 'store was really written');

    // design.js does not call onSectionChanged yet (A2a) -- call the captured
    // hook directly, standing in for that not-yet-landed call, so this test
    // exercises the coalescing timer and refreshHeader() rather than only
    // asserting the store write.
    assert.equal(typeof wrap.captured.fn, 'function', 'measurement.js handed onSectionChanged into embeddedOptions');
    wrap.captured.fn('design');
    stub.window.advance(150);

    const after = badgeTexts(main);
    assert.notDeepEqual(
      after,
      before,
      `header badges should reflect the real, re-derived workflow progress after the group was added -- before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`
    );
  } finally {
    stub.restore();
  }
});

// --- A2b: naming.js's own onSectionChanged call + pristine-rule refresh ---
// docs/plans/app-review-remediation-task-graph.json task A2b;
// docs/plans/app-review-2026-09-11.md R6-01/R4-03 (naming half).
//
// panel.js does not call onSectionChanged yet (that is A2c, a sibling task in
// the same batch) -- exactly like the (c) test above stands in for A2a with a
// manually-invoked captured hook, these two stand in for A2c the same way,
// driving the REAL field-interview commit (a real store write through
// panel.js's own onCommit) and then calling the captured hook to simulate
// panel.js reporting the change, so the mechanism under test here is
// naming.js's refresh()/syncInputsFromStore, not panel.js's own wiring.

// Finds the <select> (or plain input) for a field-interview question cell by
// its visible label text, inside `container`. domStub's matchesSelector only
// understands one bare tag/class/id at a time (see domStub.js's own comment
// on matchesSelector) -- no comma-separated selector lists -- so this tries
// 'select' first and falls back to 'input', rather than 'select, input'.
function questionControlByLabel(container, labelText) {
  const row = container.querySelectorAll('.field-row').find((cell) => {
    const label = cell.querySelector('.field-label');
    return label && label.textContent === labelText;
  });
  if (!row) return null;
  return row.querySelector('select') || row.querySelector('input');
}

function commitButtonByLabel(container, labelText) {
  const row = container.querySelectorAll('.field-row').find((cell) => {
    const label = cell.querySelector('.field-label');
    return label && label.textContent === labelText;
  });
  return row && row.querySelector('button.field-commit');
}

test('(A2b) confirming Modality in the Acquisition interview updates naming\'s Modality box after the coalesced refresh, with no navigation', () => {
  const kb = realKb();
  const wrap = captureOnSectionChanged(createPanelStep(kb));
  const { stub, store, main } = mount(kb, { panelStep: wrap.wrapped });
  try {
    const naming = section(main, 'naming');
    const namingModalityInput = naming.querySelectorAll('.field-row').find((row) => {
      const label = row.querySelector('.field-label');
      return label && label.textContent === 'Modality';
    }).querySelector('input.field-input');
    // seeded() sets acquisition.modality = 'confocal', bridged in through
    // effectiveNamingFields since naming.fields.modality is unset -- the same
    // read-time bridge lesson 50 documents.
    assert.equal(namingModalityInput.value, 'confocal');

    const panel = section(main, 'panel');
    const select = questionControlByLabel(panel, 'Modality');
    assert.ok(select, 'found the real Modality question control');
    select.value = 'STED';
    select.dispatch('change');
    const commitBtn = commitButtonByLabel(panel, 'Modality');
    assert.ok(commitBtn, 'found the real Modality confirm button');
    commitBtn.dispatch('click');
    assert.equal(store.get().assays[0].acquisition.modality, 'STED', 'the real onCommit handler wrote the store');

    // Standing in for A2c's not-yet-landed onSectionChanged('panel') call.
    assert.equal(typeof wrap.captured.fn, 'function');
    wrap.captured.fn('panel');
    stub.window.advance(150);

    assert.equal(namingModalityInput.value, 'STED', 'naming\'s Modality box picked up the sibling-written value with no navigation');
  } finally {
    stub.restore();
  }
});

test('(A2b) a naming box being actively edited is NOT overwritten by a sibling refresh', () => {
  const kb = realKb();
  const wrap = captureOnSectionChanged(createPanelStep(kb));
  const { stub, store, main } = mount(kb, { panelStep: wrap.wrapped });
  try {
    const naming = section(main, 'naming');
    const namingModalityInput = naming.querySelectorAll('.field-row').find((row) => {
      const label = row.querySelector('.field-label');
      return label && label.textContent === 'Modality';
    }).querySelector('input.field-input');

    // The user is mid-edit: focused, with unsaved typed text that has not
    // been committed anywhere.
    namingModalityInput.focus();
    namingModalityInput.value = 'still typing this';

    const panel = section(main, 'panel');
    const select = questionControlByLabel(panel, 'Modality');
    select.value = 'STED';
    select.dispatch('change');
    commitButtonByLabel(panel, 'Modality').dispatch('click');
    assert.equal(store.get().assays[0].acquisition.modality, 'STED');

    wrap.captured.fn('panel');
    stub.window.advance(150);

    assert.equal(
      namingModalityInput.value,
      'still typing this',
      'a focused, mid-edit box must survive a sibling refresh untouched (docs/cma-lessons.md lesson 46)'
    );
  } finally {
    stub.restore();
  }
});

test('a stale timer firing after the page is torn down (route change) is harmless', () => {
  const kb = realKb();
  const wrap = captureOnSectionChanged(createPanelStep(kb));
  const { stub, store, main } = mount(kb, { panelStep: wrap.wrapped });
  try {
    const staleHook = wrap.captured.fn;
    staleHook('panel'); // schedules the first render's timer

    // Simulate a route change: the same `main` container is reused and
    // cleared, exactly as main.js's renderActiveStep does for every step
    // render, including a second mount of THIS page.
    main.textContent = '';
    const otherPage = document.createElement('p');
    otherPage.textContent = 'a different route entirely';
    main.appendChild(otherPage);

    assert.doesNotThrow(() => stub.window.advance(150));
    // The stale render's header/statusGroup are gone; nothing it tries to
    // touch should reappear or throw. The only content left is what the
    // "new route" appended.
    assert.equal(main.querySelectorAll('.measurement-status-badge').length, 0);
    assert.equal(main.children.length, 1);
    assert.equal(main.children[0], otherPage);
  } finally {
    stub.restore();
  }
});

// --- A2a: design.js's own onSectionChanged call + derived-only refresh ---
// docs/plans/app-review-remediation-task-graph.json task A2a;
// docs/plans/app-review-2026-09-11.md R6-02/R4-03 (design half), V4-N4, R4-12.
//
// naming.js already calls the real onSectionChanged (task A2b, landed
// alongside this one) so these tests use the REAL naming step -- exactly the
// producer->consumer pair these assertions are naming: naming.js writes ->
// design.js's refresh (syncScalarInputs + renderConditions) picks it up.

function markersInputIn(main) {
  return section(main, 'naming')
    .querySelectorAll('input')
    .find((i) => (i.placeholder || '').toLowerCase().includes('gfp'));
}

function baseNameTextIn(main) {
  // design.js gives both the (read-only) experimental-unit value and the
  // Stage-1 base name box the shared `.base-name-value` class; the base name
  // is the one rendered as a <code> element.
  return section(main, 'design').querySelector('code.base-name-value').textContent;
}

test('(A2a) typing markers on the Data plan updates the design base name/condition filenames after the coalesced refresh', () => {
  const kb = realKb();
  const { stub, main } = mount(kb);
  try {
    const before = baseNameTextIn(main);
    const markers = markersInputIn(main);
    assert.ok(markers, 'found the naming markers box');
    markers.value = 'GFP-DAPI';
    markers.dispatch('input');
    stub.window.advance(150);

    const after = baseNameTextIn(main);
    assert.notEqual(after, before, `design's base name should pick up the new markers -- before ${before}, after ${after}`);
    assert.match(after, /GFP-DAPI/);
  } finally {
    stub.restore();
  }
});

test('(A2a) a design group input being actively edited (with caret position) survives a naming-driven refresh, same element instance', () => {
  const kb = realKb();
  const { stub, store, main } = mount(kb);
  try {
    const design = section(main, 'design');
    design.querySelector('button.add-factor-button').dispatch('click'); // 'Add group'
    const groupInput = design.querySelectorAll('input.factor-levels')[0];
    assert.ok(groupInput, 'found the new group level input');
    groupInput.value = 'TRE';
    groupInput.dispatch('input');
    assert.deepEqual(store.get().assays[0].design.groups.levels, ['TRE']);

    groupInput.focus();
    groupInput.value = 'TREATED-mid-ed';
    groupInput.selectionStart = 4;
    groupInput.selectionEnd = 4;

    const markers = markersInputIn(main);
    markers.value = 'GFP';
    markers.dispatch('input');
    stub.window.advance(150);

    const groupInputAfter = section(main, 'design').querySelectorAll('input.factor-levels')[0];
    assert.equal(groupInputAfter, groupInput, 'same element instance -- design refresh must never rebuild groupsList');
    assert.equal(groupInputAfter.value, 'TREATED-mid-ed', 'the uncommitted edit must survive a sibling refresh untouched');
    assert.equal(groupInputAfter.selectionStart, 4, 'caret position must survive too');
  } finally {
    stub.restore();
  }
});

test("(A2a) an explicit invalid replicate count (-5) shows no 'bio=B01'-style preview rows", () => {
  const kb = realKb();
  const { stub, store, main } = mount(kb);
  try {
    const design = section(main, 'design');
    const bioRepInput = design.querySelectorAll('.field-row').find((row) => {
      const label = row.querySelector('.field-label');
      return label && label.textContent === 'Biological / independent replicates';
    }).querySelector('input');
    bioRepInput.value = '-5';
    bioRepInput.dispatch('input');
    assert.equal(store.get().assays[0].design.biologicalReplicates, -5, 'the invalid value was really written');

    const conditionsText = design.querySelector('.conditions-table').textContent;
    assert.doesNotMatch(conditionsText, /bio=B01/, 'no preview row should be built from the silently-substituted fallback of 1');
    const issuesText = design.querySelector('.issues-list').textContent;
    assert.match(issuesText, /positive integer/, 'the validation issue is still shown');
  } finally {
    stub.restore();
  }
});

test("(A2a/R4-12) two empty 'Add group' rows produce no 'identical name segment' error, but still prompt for a name", () => {
  const kb = realKb();
  const { stub, main } = mount(kb);
  try {
    const design = section(main, 'design');
    const addGroupBtn = design.querySelector('button.add-factor-button');
    addGroupBtn.dispatch('click');
    addGroupBtn.dispatch('click');

    const issuesText = design.querySelector('.issues-list').textContent;
    assert.doesNotMatch(issuesText, /identical name segment/, 'two still-blank group rows must not read as a real filename collision');
    assert.match(issuesText, /name/i, 'a prompt to name the group is still shown');
  } finally {
    stub.restore();
  }
});
