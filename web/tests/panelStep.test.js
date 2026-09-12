// A2c / review findings R4-01, V3-N1, R4-06, R4-10, V4-N3, R2-12, V4-N2.
// Written by the orchestrator after the executor's session was cut off; the
// executor's panel.js landed, its tests did not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomStub } from './domStub.js';
import { realKb } from './fixtures.js';
import { createPanelStep } from '../src/ui/steps/panel.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';

function seeded() {
  const experiment = emptyExperiment();
  const assay = experiment.assays[0];
  assay.label = 'Membrane integrity';
  assay.naming = { fields: { modality: 'CONFOCAL', exptype: 'MEMB', markers: 'PI', magnification: 'X40', sample: 'XYZ02' } };
  assay.panel = {
    targets: [],
    channels: [
      { id: 'c1', target: 'Live cells', fluorophore: 'Alexa Fluor 488', conjugation: 'direct-probe' },
      { id: 'c2', target: 'Membrane', fluorophore: 'FITC', conjugation: 'direct-probe' },
    ],
    spillover: { acknowledged: [] },
  };
  return experiment;
}

function mount() {
  const stub = createDomStub();
  stub.install();
  const kb = realKb();
  const store = createStore(seeded());
  const main = document.createElement('div');
  createPanelStep(kb).render(main, store, { advisor: kb.advisor, embedded: true, onSectionChanged: () => {} });
  return { stub, store, main };
}
const text = (el) => (el ? el.textContent : '');
const all = (main, sel) => main.querySelectorAll(sel);
const findButton = (main, re) => all(main, 'button').find((b) => re.test(b.textContent || '') || re.test(b.getAttribute('aria-label') || ''));

test('(a) the spillover block reads Panel assembly channels: ALEXA488 + FITC is flagged even with a different markers field (R4-01)', () => {
  const { stub, main } = mount();
  try {
    const body = text(main);
    assert.match(body, /emission peaks 1 nm apart/);
    assert.doesNotMatch(body, /No spectral-proximity/);
    assert.doesNotMatch(body, /No markers entered yet/);
  } finally { stub.restore(); }
});

test('(b) recording an acknowledgement through the real control downgrades the flag and writes sorted entry ids; swapping a dye drops it (V3-N1, A3)', () => {
  const { stub, store, main } = mount();
  try {
    const details = all(main, 'details').find((d) => /Acknowledge this pair/.test(text(d)));
    assert.ok(details, 'an acknowledgement control renders for the error flag');
    const select = details.querySelectorAll('select')[0];
    if (select) { select.value = 'sequential-acquisition'; select.dispatch('change'); }
    findButton(details, /Record acknowledgement/).click();
    const acks = store.get().assays[0].panel.spillover.acknowledged;
    assert.equal(acks.length, 1);
    assert.deepEqual(acks[0].pair, ['ALEXA488', 'FITC']);
    assert.match(text(main), /acknowledged/i);
    assert.ok(findButton(main, /Withdraw/), 'an acknowledged flag offers Withdraw');
    // Swap channel 2's dye: the pair no longer exists, the ack must go.
    const picker = all(main, 'select').find((sel) => sel.getAttribute('aria-label') === 'Fluorophore library' && sel.value === 'FITC');
    assert.ok(picker, 'found the FITC channel picker');
    picker.value = 'ALEXA647';
    picker.dispatch('change');
    assert.deepEqual(store.get().assays[0].panel.spillover.acknowledged, [], 'ack pruned when the dye changed');
  } finally { stub.restore(); }
});

test('(c) moving a channel with the arrow button keeps keyboard focus inside the channel list (R4-06)', () => {
  const { stub, main } = mount();
  try {
    const down = all(main, 'button').find((b) => b.dataset && b.dataset.focusKey === 'c1:1');
    assert.ok(down, 'found the move-down button by its focus key');
    down.focus();
    down.click();
    const active = document.activeElement;
    assert.ok(active && active.dataset && active.dataset.focusKey, `focus stayed on a channel control, got ${active && active.tagName}`);
  } finally { stub.restore(); }
});

test('(d) conjugation select and remove button carry accessible names that include the fluorophore (R4-10, V4-N3); badge label is humanized (R2-12)', () => {
  const { stub, main } = mount();
  try {
    const conj = all(main, 'select').map((s) => s.getAttribute('aria-label')).filter(Boolean);
    assert.ok(conj.some((a) => /Conjugation for Alexa Fluor 488/.test(a)), JSON.stringify(conj));
    const removes = all(main, 'button').map((b) => b.getAttribute('aria-label')).filter(Boolean);
    assert.ok(removes.some((a) => /Remove channel FITC/.test(a)), JSON.stringify(removes));
    assert.match(text(main), /cited source/);
    assert.doesNotMatch(text(main), /source-cited/);
  } finally { stub.restore(); }
});

test('(e) Enter in the markers interview box commits the value (V4-N2)', () => {
  const { stub, store, main } = mount();
  try {
    const input = all(main, 'input').find((i) => i.id === 'field-interview-markers' || (i.placeholder || '') === 'e.g. DAPI-GFP');
    assert.ok(input, 'markers interview box present');
    input.focus();
    input.value = 'GFP';
    input.dispatch('input');
    input.dispatch('keydown', { key: 'Enter' });
    assert.equal(store.get().assays[0].naming.fields.markers, 'GFP');
  } finally { stub.restore(); }
});
