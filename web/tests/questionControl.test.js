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

import { createDomStub } from './domStub.js';
import { buildQuestionControl } from '../src/ui/questionControl.js';

function cueOf(control) {
  return control.element.querySelectorAll('.field-unsaved-cue')[0];
}

test('a prefilled duration does not show the Unsaved cue on first paint, and zero/negative totals read as unanswered (Copilot review, PR #20)', () => {
  const stub = createDomStub();
  stub.install();
  try {
    const control = buildQuestionControl({ id: 'etaAcquisitionMinutes', control: 'duration', label: 'Acquisition' }, 90);
    assert.equal(cueOf(control).hidden, true, 'prefilled 90 min is not "unsaved"');
    assert.equal(control.getValue(), 90);
    const [hours, minutes] = control.element.querySelectorAll('input');
    minutes.value = '45'; minutes.dispatch('input');
    assert.equal(cueOf(control).hidden, false, 'an edit shows the cue');
    hours.value = '0'; minutes.value = '0'; minutes.dispatch('input');
    assert.equal(control.getValue(), '', 'zero total is unanswered');
    hours.value = ''; minutes.value = ''; minutes.dispatch('input');
    assert.equal(cueOf(control).hidden, true, 'all-empty composite is not "unsaved"');
  } finally { stub.restore(); }
});

test('a prefilled choice with allowOther does not show the Unsaved cue on first paint (Copilot review, PR #20)', () => {
  const stub = createDomStub();
  stub.install();
  try {
    const q = { id: 'modality', control: 'choice', label: 'Modality', options: ['confocal', 'widefield'], allowOther: true };
    const normal = buildQuestionControl(q, 'confocal');
    assert.equal(cueOf(normal).hidden, true);
    const custom = buildQuestionControl(q, 'lattice light-sheet');
    assert.equal(cueOf(custom).hidden, true);
    assert.equal(custom.getValue(), 'lattice light-sheet');
  } finally { stub.restore(); }
});
