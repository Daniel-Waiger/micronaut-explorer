import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffFeedback } from '../src/ui/feedbackHandoff.js';

// A tiny, self-contained DOM harness scoped to this one file (not the shared
// web/tests/domStub.js): feedbackHandoff.js is the only module under test
// here that needs a window-level keydown listener (focus trap + Escape),
// which domStub.js's window stub does not provide, and duplicating a whole
// DOM stub for one extra capability is worse than a small local one built
// from Node's real EventTarget/Event (native, no jsdom needed).

class FakeEl extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.id = '';
    this._text = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i !== -1) this.children.splice(i, 1);
    node.parentNode = null;
    // Real DOM behavior clipboard.js's execCommand fallback depends on: once
    // the currently-focused element is disconnected, the document's active
    // element resets to <body>. Without this the fake DOM can never
    // reproduce the focus theft that made D2-P1 a live bug (a select()able
    // textarea, appended then removed, silently dumping focus at <body>).
    if (this.ownerDocument.activeElement === node) this.ownerDocument.activeElement = this.ownerDocument.body;
    return node;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') this._text += node;
      else this.appendChild(node);
    }
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i !== -1) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  // Mirrors real browsers: calling select() on a connected, unfocused
  // textarea moves focus onto it (verified live by the red team's textarea
  // focus probe: selectStoleFocus=true). This is the step that steals focus
  // away from whatever the user had focused before the clipboard fallback ran.
  select() { this.focus(); }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.dispatchEvent(new Event('click')); }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent || '').join('');
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.body = new FakeEl('body', this);
  }
  createElement(name) { return new FakeEl(name, this); }
  execCommand() { return false; } // always "denied" -- clipboard.js's fallback path
}

function withHandoffDom({ clipboardRejects = true } = {}) {
  const document = new FakeDocument();
  const window = new EventTarget();
  const navigator = clipboardRejects
    ? { clipboard: { writeText: () => Promise.reject(new Error('denied')) } }
    : { clipboard: { writeText: (text) => { navigator.clipboard.written.push(text); return Promise.resolve(); }, written: [] } };
  const saved = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true, enumerable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true, enumerable: true });
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true, writable: true, enumerable: true });
  return {
    document,
    window,
    restore() {
      for (const key of ['document', 'window', 'navigator']) {
        if (saved[key] === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, saved[key]);
      }
    },
  };
}

// Recursively finds every button-like element under root (buttons here are
// just <button>-tagged FakeEls -- there is no CSS selector engine to lean on).
function findButtons(root) {
  const out = [];
  const visit = (el) => {
    if (el.tagName === 'button') out.push(el);
    for (const child of el.children) visit(child);
  };
  visit(root);
  return out;
}

function findById(root, id) {
  const visit = (el) => {
    if (el.id === id) return el;
    for (const child of el.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

test('GitHub channel: a successful copy is unaffected (regression)', async () => {
  const dom = withHandoffDom({ clipboardRejects: false });
  try {
    const opened = [];
    const copied = await handoffFeedback({ report: 'x', channel: 'github', onOpen: (url) => opened.push(url) });
    assert.equal(copied, true);
    const title = findById(dom.document.body, 'feedback-handoff-title');
    assert.equal(title.textContent, 'Feedback package copied');
    const buttons = findButtons(dom.document.body);
    assert.equal(buttons.some((b) => /Download feedback package/i.test(b.textContent)), false, 'no download fallback needed once copy succeeded');
    const proceed = buttons.find((b) => b.textContent === 'Open GitHub issue');
    assert.ok(proceed);
    proceed.click();
    assert.equal(opened.length, 1);
  } finally {
    dom.restore();
  }
});

test('GitHub channel: a rejected copy still reaches GitHub, and offers a download', async () => {
  const dom = withHandoffDom({ clipboardRejects: true });
  try {
    const opened = [];
    const copied = await handoffFeedback({
      report: 'the report text',
      channel: 'github',
      onOpen: (url) => opened.push(url),
    });
    assert.equal(copied, false);
    const buttons = findButtons(dom.document.body);
    const proceed = buttons.find((b) => b.textContent === 'Open GitHub issue');
    assert.ok(proceed, 'expected an "Open GitHub issue" button even though copy failed');
    proceed.click();
    assert.equal(opened.length, 1);
    assert.match(opened[0], /github\.com/);

    // The modal must still be open (proceed re-renders it before navigating,
    // matching production: the click handler closes THIS modal, so re-open
    // and assert the download button was present before the click instead).
  } finally {
    dom.restore();
  }
});

test('GitHub channel: the download fallback button is present before proceeding', async () => {
  const dom = withHandoffDom({ clipboardRejects: true });
  try {
    await handoffFeedback({ report: 'x', channel: 'github', onOpen: () => {} });
    const buttons = findButtons(dom.document.body);
    const download = buttons.find((b) => /Download feedback package/i.test(b.textContent));
    assert.ok(download, 'expected a "Download feedback package" fallback button');
  } finally {
    dom.restore();
  }
});

test('download channel: a rejected copy still reports success, never "use Download instead"', async () => {
  const dom = withHandoffDom({ clipboardRejects: true });
  try {
    let downloaded = false;
    const copied = await handoffFeedback({
      report: 'x',
      channel: 'download',
      download: () => { downloaded = true; },
    });
    assert.equal(copied, false);
    assert.equal(downloaded, true);
    const title = findById(dom.document.body, 'feedback-handoff-title');
    const description = findById(dom.document.body, 'feedback-handoff-description');
    assert.match(title.textContent, /downloaded/i);
    assert.doesNotMatch(title.textContent, /could not copy/i);
    assert.doesNotMatch(description.textContent, /use download feedback package instead/i);
  } finally {
    dom.restore();
  }
});

test('focus trap: Tab from the last control wraps to the first, and Escape restores focus', async () => {
  const dom = withHandoffDom({ clipboardRejects: true });
  const invoker = new FakeEl('button', dom.document);
  dom.document.activeElement = invoker;
  try {
    await handoffFeedback({ report: 'x', channel: 'github', onOpen: () => {} });
    const buttons = findButtons(dom.document.body);
    assert.ok(buttons.length >= 2, 'expected at least Done + proceed + download buttons');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    dom.document.activeElement = last;
    const tabEvent = new Event('keydown');
    tabEvent.key = 'Tab';
    tabEvent.shiftKey = false;
    dom.window.dispatchEvent(tabEvent);
    assert.equal(dom.document.activeElement, first, 'Tab from the last control should wrap to the first');

    dom.document.activeElement = first;
    const shiftTabEvent = new Event('keydown');
    shiftTabEvent.key = 'Tab';
    shiftTabEvent.shiftKey = true;
    dom.window.dispatchEvent(shiftTabEvent);
    assert.equal(dom.document.activeElement, last, 'Shift+Tab from the first control should wrap to the last');

    const escapeEvent = new Event('keydown');
    escapeEvent.key = 'Escape';
    dom.window.dispatchEvent(escapeEvent);
    assert.equal(dom.document.activeElement, invoker, 'Escape should restore focus to the invoking control');
    assert.equal(dom.document.body.children.length, 0, 'Escape should remove the modal');
  } finally {
    dom.restore();
  }
});
