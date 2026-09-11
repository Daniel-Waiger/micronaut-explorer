// Shared hand-rolled DOM stub for node:test suites that render web/src/ui/**
// with no browser and no jsdom (zero-install invariant): replaces the near-
// duplicate FakeClassList/FakeElement/FakeDocument stubs spectralViewUi.test.js
// and fluorophorePicker.test.js each hand-rolled, and adds window shims
// (confirm/alert/manual setTimeout/matchMedia/requestAnimationFrame/clipboard)
// neither had. NOT a *.test.js file, so `node --test web/tests/*.test.js`
// never collects it as a suite (see fixtures.js's identical note).
// Deliberately unimplemented: layout, bubbling/capture, getComputedStyle,
// canvas, focus order -- that's jsdom's job.

class FakeClassList {
  constructor(element) { this.element = element; }
  values() { return new Set((this.element.className || '').split(/\s+/).filter(Boolean)); }
  write(values) { this.element.className = [...values].join(' '); }
  add(...names) { const v = this.values(); for (const n of names) v.add(n); this.write(v); }
  remove(...names) { const v = this.values(); for (const n of names) v.delete(n); this.write(v); }
  contains(name) { return this.values().has(name); }
  toggle(name, force) {
    const v = this.values();
    const enabled = force === undefined ? !v.has(name) : Boolean(force);
    if (enabled) v.add(name);
    else v.delete(name);
    this.write(v);
    return enabled;
  }
}

// Exactly the selector shapes web/src/ui/** uses: '.class', '#id', 'tag' and
// 'tag.class' -- no descendant combinators, attribute selectors or lists.
function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  const dot = selector.indexOf('.');
  if (dot === -1) return element.localName === selector;
  const tag = selector.slice(0, dot);
  return (!tag || element.localName === tag) && element.classList.contains(selector.slice(dot + 1));
}

class FakeElement {
  constructor(name, ownerDocument) {
    this.localName = name;
    this.ownerDocument = ownerDocument || null;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.id = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.files = null;
    this.type = '';
    this.open = false;
    this.title = '';
    this._text = '';
  }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'class') this.className = text;
    else if (name === 'id') this.id = text;
  }
  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'id') return this.id || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  // The real ParentNode.append() accepts strings as well as nodes and turns
  // each string into a Text node; only appendChild() is node-only. Delegating
  // strings straight to appendChild would try to set .parentNode on a string
  // primitive, which THROWS under a module's strict mode -- so a renderer
  // doing the ordinary `el.append('label: ', value)` would fail here for a
  // reason that has nothing to do with the code under test.
  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
    }
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(newNode, referenceNode) {
    newNode.parentNode = this;
    const index = referenceNode == null ? -1 : this.children.indexOf(referenceNode);
    if (index === -1) this.children.push(newNode);
    else this.children.splice(index, 0, newNode);
    return newNode;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this._text = '';
    for (const child of this.children) child.parentNode = null;
    this.children = [...nodes];
    for (const node of this.children) node.parentNode = this;
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  // .click() dispatches 'click' -- enough to reach an addEventListener('click', ...) wire-up.
  dispatch(type, properties = {}) {
    const event = {
      type,
      clientX: 0,
      clientY: 0,
      key: '',
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  click() { return this.dispatch('click'); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 316 }; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const results = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (matchesSelector(child, selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
  }
  createElement(name) { return new FakeElement(name, this); }
  createElementNS(_namespace, name) { return new FakeElement(name, this); }
  createTextNode(text) {
    const node = new FakeElement('#text', this);
    node.textContent = text;
    return node;
  }
  getElementById(id) {
    const visit = (element) => {
      for (const child of element.children) {
        if (child.id === id) return child;
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.documentElement);
  }
}

// Manual (queue + advance(ms)) timers -- real ones would make debounce/toast
// code either flaky or force the test to actually sleep.
function createWindowStub(document) {
  let nextTimerId = 0;
  let clockMs = 0;
  const timers = new Map();
  const window = {
    document,
    confirm: () => true,
    alert: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(callback) { callback(); return ++nextTimerId; },
    setTimeout(callback, delay = 0) {
      const id = ++nextTimerId;
      timers.set(id, { callback, dueAt: clockMs + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    navigator: {
      clipboard: {
        written: [],
        async writeText(text) { window.navigator.clipboard.written.push(text); },
      },
    },
    // Not a real API -- fires every timer whose dueAt has passed (earliest first).
    advance(ms) {
      clockMs += ms;
      const due = [...timers.entries()].filter(([, t]) => t.dueAt <= clockMs).sort((a, b) => a[1].dueAt - b[1].dueAt);
      for (const [id, timer] of due) { timers.delete(id); timer.callback(); }
    },
  };
  return window;
}

// Node 21+ defines a getter-only `globalThis.navigator`, so a plain assignment
// throws; go through defineProperty and save the exact prior descriptor.
function setGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, writable: true, enumerable: true, configurable: true });
  return descriptor;
}
function restoreGlobal(name, descriptor) {
  if (descriptor === undefined) delete globalThis[name];
  else Object.defineProperty(globalThis, name, descriptor);
}

// Fresh, isolated stub: install() points globalThis.document/window/navigator
// at it (saving whatever was there); restore() (call from a `finally`) undoes it.
export function createDomStub() {
  const document = new FakeDocument();
  const window = createWindowStub(document);
  document.defaultView = window;
  let saved = null;
  function install() {
    saved = {
      document: setGlobal('document', document),
      window: setGlobal('window', window),
      navigator: setGlobal('navigator', window.navigator),
    };
    return { document, window };
  }
  function restore() {
    if (!saved) return;
    restoreGlobal('document', saved.document);
    restoreGlobal('window', saved.window);
    restoreGlobal('navigator', saved.navigator);
    saved = null;
  }

  return { document, window, install, restore };
}
