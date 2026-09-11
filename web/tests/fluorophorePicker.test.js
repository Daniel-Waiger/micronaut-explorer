import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fluorophorePickerCreate } from '../src/ui/fluorophorePicker.js';
import { createDomStub } from './domStub.js';

const fluorophorePickerOptions = [
  { value: 'ALEXA488', label: 'ALEXA488 — Ex 495 / Em 519 nm' },
  { value: 'syto9', label: 'Syto9 — Ex 485 / Em 500 nm' },
];

function withFluorophorePickerDocument(callback) {
  const { document: fakeDocument, install, restore } = createDomStub();
  install();
  try {
    callback(fakeDocument);
  } finally {
    restore();
  }
}

test('known aliases reopen as their library option without rewriting the saved study', () => {
  withFluorophorePickerDocument(() => {
    const changes = [];
    const picker = fluorophorePickerCreate({
      options: fluorophorePickerOptions,
      currentValue: 'Alexa Fluor 488',
      libraryValue: 'ALEXA488',
      onChange: (value) => changes.push(value),
    });
    const select = picker.querySelector('select');
    const custom = picker.querySelector('.panel-fluorophore-custom');

    assert.equal(select.value, 'ALEXA488');
    assert.equal(custom.hidden, true);
    assert.equal(picker.getAttribute('role'), 'group');
    assert.equal(picker.getAttribute('aria-label'), 'Fluorophore library');
    assert.deepEqual(changes, []);
    assert.equal(picker.querySelectorAll('option').length, fluorophorePickerOptions.length + 2);
    assert.equal(picker.querySelector('optgroup').label, 'Known fluorophores (2)');
    assert.match(picker.textContent, /ALEXA488 — Ex 495 \/ Em 519 nm/);
  });
});

test('custom choice alone reveals free text and emits additions, clearing a prior known value first', () => {
  withFluorophorePickerDocument((fakeDocument) => {
    const changes = [];
    const picker = fluorophorePickerCreate({
      options: fluorophorePickerOptions,
      currentValue: 'ALEXA488',
      libraryValue: 'ALEXA488',
      onChange: (value) => changes.push(value),
    });
    const select = picker.querySelector('select');
    const custom = picker.querySelector('.panel-fluorophore-custom');
    const customOption = picker.querySelectorAll('option').find((option) => /Not in library/.test(option.textContent));

    select.value = customOption.value;
    select.dispatch('change');
    assert.equal(custom.hidden, false);
    assert.equal(custom.value, '');
    assert.equal(fakeDocument.activeElement, custom);
    assert.deepEqual(changes, ['']);

    custom.value = 'NovelDye 700';
    custom.dispatch('input');
    assert.deepEqual(changes, ['', 'NovelDye 700']);
  });
});

test('onChange reports isStructural=true only for a resolved library pick, false for switching to/typing a custom name', () => {
  // Custom-mode transitions and keystrokes must stay non-structural: this
  // component's own customInput.focus() call (and the user's next
  // keystroke) depend on THIS render's customInput surviving -- a caller
  // that treated them as structural and re-rendered would detach it from
  // under the cursor. Regression coverage for that exact failure mode.
  withFluorophorePickerDocument(() => {
    const changes = [];
    const picker = fluorophorePickerCreate({
      options: fluorophorePickerOptions,
      currentValue: '',
      libraryValue: '',
      onChange: (value, isStructural) => changes.push([value, isStructural]),
    });
    const select = picker.querySelector('select');
    const custom = picker.querySelector('.panel-fluorophore-custom');
    const customOption = picker.querySelectorAll('option').find((option) => /Not in library/.test(option.textContent));

    select.value = 'syto9';
    select.dispatch('change');
    assert.deepEqual(changes, [['syto9', true]]);

    select.value = customOption.value;
    select.dispatch('change');
    assert.deepEqual(changes.at(-1), ['', false]);

    custom.value = 'N';
    custom.dispatch('input');
    custom.value = 'No';
    custom.dispatch('input');
    assert.deepEqual(changes.slice(-2), [
      ['N', false],
      ['No', false],
    ]);
  });
});

test('saved custom dyes remain editable, while selecting a known dye hides free text and emits its key', () => {
  withFluorophorePickerDocument(() => {
    const changes = [];
    const picker = fluorophorePickerCreate({
      options: fluorophorePickerOptions,
      currentValue: 'NovelDye 700',
      libraryValue: '',
      isTagLigand: true,
      onChange: (value) => changes.push(value),
    });
    const select = picker.querySelector('select');
    const custom = picker.querySelector('.panel-fluorophore-custom');

    assert.match(picker.textContent, /Ligand dye library/);
    assert.equal(custom.hidden, false);
    assert.equal(custom.value, 'NovelDye 700');
    assert.equal(custom.getAttribute('aria-label'), 'New ligand dye name');
    assert.deepEqual(changes, []);

    select.value = 'syto9';
    select.dispatch('change');
    assert.equal(custom.hidden, true);
    assert.equal(custom.value, '');
    assert.deepEqual(changes, ['syto9']);

    select.value = '';
    select.dispatch('change');
    assert.deepEqual(changes, ['syto9', '']);
  });
});
