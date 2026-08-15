import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSpectralView, spectralViewCreateState } from '../src/ui/spectralView.js';

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return new Set((this.element.className || '').split(/\s+/).filter(Boolean));
  }

  write(values) {
    this.element.className = [...values].join(' ');
  }

  add(...names) {
    const values = this.values();
    for (const name of names) values.add(name);
    this.write(values);
  }

  remove(...names) {
    const values = this.values();
    for (const name of names) values.delete(name);
    this.write(values);
  }

  contains(name) {
    return this.values().has(name);
  }

  toggle(name, force) {
    const values = this.values();
    const enabled = force === undefined ? !values.has(name) : Boolean(force);
    if (enabled) values.add(name);
    else values.delete(name);
    this.write(values);
    return enabled;
  }
}

class FakeElement {
  constructor(name) {
    this.localName = name;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this._text = '';
  }

  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'class') this.className = text;
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this._text = '';
    this.children = [...children];
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      clientX: 0,
      clientY: 0,
      key: '',
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...properties,
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 720, height: 316 };
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const visit = (element) => {
      for (const child of element.children) {
        if (className ? child.classList.contains(className) : child.localName === selector) {
          results.push(child);
        }
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
  }

  createElement(name) {
    return new FakeElement(name);
  }

  createElementNS(_namespace, name) {
    return new FakeElement(name);
  }
}

function spectralEntry() {
  return {
    channelId: 'channel-syto9',
    token: 'SYTO9',
    canonical: 'SYTO9',
    state: 'known',
    excitationPeakNm: 485,
    emissionPeakNm: 500,
    reviewStatus: 'claude-drafted',
    filterCenterNm: 525,
    filterBandwidthNm: 50,
  };
}

test('interactive spectrum identifies, emphasizes, and independently toggles curves and filters', () => {
  const originalDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;
  try {
    const container = fakeDocument.createElement('div');
    const state = spectralViewCreateState();
    renderSpectralView(container, [spectralEntry()], { schematicEmissionFwhmNm: 50 }, state);

    const curve = container.querySelector('.spectral-view-curve-group');
    const filter = container.querySelector('.spectral-view-filter-group');
    const buttons = container.querySelectorAll('.spectral-view-legend-button');
    const details = container.querySelector('.spectral-view-details');
    const tooltip = container.querySelector('.spectral-view-tooltip');
    assert.equal(buttons.length, 2);
    assert.match(container.textContent, /525\/50 nm/);
    assert.match(curve.getAttribute('aria-label'), /SYTO9.*500 nm.*Enter or Space/);
    assert.match(filter.getAttribute('aria-label'), /SYTO9 filter.*525\/50 nm/);

    curve.dispatch('pointerenter', { clientX: 180, clientY: 90 });
    assert.equal(curve.classList.contains('spectral-view-active'), true);
    assert.equal(filter.classList.contains('spectral-view-muted'), true);
    assert.equal(tooltip.hidden, false);
    assert.match(details.textContent, /^SYTO9Emission peak 500 nm/);

    filter.dispatch('pointerenter', { clientX: 260, clientY: 120 });
    assert.equal(curve.classList.contains('spectral-view-active'), false);
    assert.equal(filter.classList.contains('spectral-view-active'), true);
    assert.match(details.textContent, /^SYTO9 filter525\/50 nm/);
    filter.dispatch('pointerleave');
    assert.equal(curve.classList.contains('spectral-view-active'), false);
    assert.equal(filter.classList.contains('spectral-view-active'), false);
    assert.equal(curve.classList.contains('spectral-view-muted'), false);
    assert.match(details.textContent, /^Explore the spectrum/);

    curve.dispatch('click');
    assert.equal(curve.getAttribute('aria-pressed'), 'false');
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
    assert.equal(state.hiddenCurves.size, 1);
    assert.equal(state.hiddenFilters.size, 0);

    const keyEvent = filter.dispatch('keydown', { key: ' ' });
    assert.equal(keyEvent.defaultPrevented, true);
    assert.equal(filter.getAttribute('aria-pressed'), 'false');
    assert.equal(state.hiddenFilters.size, 1);
    assert.equal(state.hiddenCurves.size, 1);

    buttons[0].dispatch('click');
    assert.equal(state.hiddenCurves.size, 0);
    assert.equal(state.hiddenFilters.size, 1);
    assert.equal(curve.getAttribute('aria-pressed'), 'true');

    renderSpectralView(container, [spectralEntry()], { schematicEmissionFwhmNm: 50 }, state);
    assert.equal(container.querySelector('.spectral-view-curve-group').getAttribute('aria-pressed'), 'true');
    assert.equal(container.querySelector('.spectral-view-filter-group').getAttribute('aria-pressed'), 'false');
    assert.equal(container.querySelectorAll('.spectral-view-legend-button')[1].textContent.endsWith('Off'), true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("a curve/filter with its own color renders in THAT color, overriding the rotating series palette but keeping its dash pattern", () => {
  const originalDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;
  try {
    const container = fakeDocument.createElement('div');
    const state = spectralViewCreateState();
    const entry = { ...spectralEntry(), color: '#3366ff' };
    renderSpectralView(container, [entry], { schematicEmissionFwhmNm: 50 }, state);

    const curveGroup = container.querySelector('.spectral-view-curve-group');
    const filterGroup = container.querySelector('.spectral-view-filter-group');
    const legendSamples = container.querySelectorAll('.spectral-view-legend-sample, .spectral-view-filter-sample');

    for (const el of [curveGroup, filterGroup, ...legendSamples]) {
      assert.equal(el.style.color, '#3366ff');
      assert.equal(el.style.fill, '#3366ff');
      assert.equal(el.style.stroke, '#3366ff');
    }
    // The series class (dash pattern) is still applied -- color overrides
    // via inline style, it doesn't replace the class.
    assert.match(curveGroup.className, /spectral-view-series-0/);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('an entry with no/malformed color leaves the rotating series palette untouched (no inline style)', () => {
  const originalDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;
  try {
    const container = fakeDocument.createElement('div');
    const state = spectralViewCreateState();
    renderSpectralView(container, [{ ...spectralEntry(), color: 'not-a-hex-color' }], { schematicEmissionFwhmNm: 50 }, state);

    const curveGroup = container.querySelector('.spectral-view-curve-group');
    assert.equal(curveGroup.style.color, undefined);
    assert.equal(curveGroup.style.fill, undefined);
    assert.equal(curveGroup.style.stroke, undefined);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('Enter toggles a focused series and malformed interaction state degrades safely', () => {
  const originalDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;
  try {
    const container = fakeDocument.createElement('div');
    assert.doesNotThrow(() => renderSpectralView(container, [spectralEntry()], {}, {}));
    const curve = container.querySelector('.spectral-view-curve-group');
    const event = curve.dispatch('keydown', { key: 'Enter' });
    assert.equal(event.defaultPrevented, true);
    assert.equal(curve.getAttribute('aria-pressed'), 'true');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('co-centered filter values use distinct collision-aware label lanes', () => {
  const originalDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;
  try {
    const container = fakeDocument.createElement('div');
    const entries = [40, 50, 60].map((bandwidth, index) => ({
      ...spectralEntry(),
      channelId: `channel-${index}`,
      token: `Dye ${index + 1}`,
      canonical: `DYE_${index + 1}`,
      filterBandwidthNm: bandwidth,
    }));
    renderSpectralView(container, entries, { schematicEmissionFwhmNm: 50 });
    const labels = container.querySelectorAll('.spectral-view-filter-label');
    assert.equal(labels.length, 3);
    assert.deepEqual(new Set(labels.map((label) => label.getAttribute('y'))).size, 3);
    assert.deepEqual(labels.map((label) => label.textContent).sort(), [
      '525/40 nm',
      '525/50 nm',
      '525/60 nm',
    ]);
  } finally {
    globalThis.document = originalDocument;
  }
});
