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

// R4-13: a brand-new question with allowOther and an EMPTY stored value used
// to preselect 'Other...' (with an empty free-text box beside it), because
// '' is falsy but not undefined/null and fell into the "unknown option ->
// reopen as Other" branch. An untouched field must instead show a neutral,
// disabled placeholder and getValue() must still read as unanswered.
test('a fresh choice+allowOther question with an empty stored value shows a disabled placeholder, not Other', () => {
  const stub = createDomStub();
  stub.install();
  try {
    const q = { id: 'modality', type: 'choice', label: 'Modality', options: ['confocal', 'widefield'], allowOther: true };
    const control = buildQuestionControl(q, '');
    const select = control.element.querySelector('select');
    assert.equal(select.value, '', 'the placeholder option is selected, not __other__');
    const placeholderOption = select.children.find((opt) => opt.value === '');
    assert.equal(placeholderOption.disabled, true, 'the placeholder option cannot be reselected as a real answer');
    assert.equal(control.getValue(), '', 'an untouched field reads as unanswered');
    const otherInput = control.element.querySelector('.question-other-input');
    assert.equal(otherInput.hidden, true, 'the free-text box stays hidden for an untouched field');
  } finally { stub.restore(); }
});

// Same defect, non-allowOther path and the plain 'undefined'/'null' cases:
// the placeholder must be selected and disabled whenever there is truly no
// answer yet, regardless of which of the three "empty" spellings arrives.
test('a fresh plain choice question (no allowOther) also shows the disabled placeholder for every empty spelling', () => {
  const stub = createDomStub();
  stub.install();
  try {
    for (const initial of ['', undefined, null]) {
      const q = { id: 'system', type: 'choice', label: 'System', options: ['confocal', 'widefield'] };
      const control = buildQuestionControl(q, initial);
      const select = control.element.querySelector('select');
      assert.equal(select.value, '');
      assert.equal(control.getValue(), '');
    }
  } finally { stub.restore(); }
});
