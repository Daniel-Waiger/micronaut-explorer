import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fluorophorePickerCreate } from '../src/ui/fluorophorePicker.js';

class FluorophorePickerFakeClassList {
  constructor(element) {
    this.element = element;
  }

  contains(name) {
    return (this.element.className || '').split(/\s+/).filter(Boolean).includes(name);
  }
}

class FluorophorePickerFakeElement {
  constructor(name, ownerDocument) {
    this.localName = name;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = new FluorophorePickerFakeClassList(this);
    this.hidden = false;
    this.value = '';
    this._text = '';
  }

  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type) {
    for (const handler of this.listeners.get(type) || []) handler({ type });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const visit = (element) => {
      for (const child of element.children) {
        if (className ? child.classList.contains(className) : child.localName === selector) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

class FluorophorePickerFakeDocument {
  constructor() {
    this.activeElement = null;
  }

  createElement(name) {
    return new FluorophorePickerFakeElement(name, this);
  }
}

const fluorophorePickerOptions = [
  { value: 'ALEXA488', label: 'ALEXA488 — Ex 495 / Em 519 nm' },
  { value: 'syto9', label: 'Syto9 — Ex 485 / Em 500 nm' },
];

function withFluorophorePickerDocument(callback) {
  const originalDocument = globalThis.document;
  const fakeDocument = new FluorophorePickerFakeDocument();
  globalThis.document = fakeDocument;
  try {
    callback(fakeDocument);
  } finally {
    globalThis.document = originalDocument;
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
