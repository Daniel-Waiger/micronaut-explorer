import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_URL, openInNewTab } from '../src/ui/newTab.js';
import { createDomStub } from './domStub.js';

// openInNewTab is what keeps the practice tab from being able to reach back
// into the tab holding the user's real study. Its two guarantees -- the
// synthesised anchor (so popup blockers do not eat the navigation) and
// rel="noopener" (so `window.opener` is null in the new tab) -- are both
// attributes on an element that exists for one tick, so this is the only
// place they can be asserted without a real browser.

function withDom(run) {
  const dom = createDomStub();
  const { document } = dom.install();
  try {
    return run(document, dom);
  } finally {
    dom.restore();
  }
}

test('the sandbox URL is relative so it works from file://, a subpath, or localhost', () => {
  assert.equal(SANDBOX_URL, '?demo=1');
  assert.equal(SANDBOX_URL.startsWith('/'), false, 'a root-relative URL would break file://');
  assert.equal(/^[a-z]+:/i.test(SANDBOX_URL), false, 'an absolute URL would break every host but one');
});

test('it opens a new tab via a real anchor carrying noopener', () => {
  withDom((document) => {
    const appended = [];
    const originalAppend = document.body.appendChild.bind(document.body);
    document.body.appendChild = (node) => {
      appended.push(node);
      return originalAppend(node);
    };

    let clicked = 0;
    const originalCreate = document.createElement.bind(document);
    document.createElement = (name) => {
      const el = originalCreate(name);
      const realClick = el.click.bind(el);
      el.click = () => { clicked += 1; return realClick(); };
      return el;
    };

    assert.equal(openInNewTab(SANDBOX_URL, { doc: document }), true);

    assert.equal(appended.length, 1, 'exactly one anchor should have been used');
    const anchor = appended[0];
    assert.equal(anchor.localName, 'a', 'must be a real anchor, not window.open');
    assert.equal(anchor.href, SANDBOX_URL);
    assert.equal(anchor.target, '_blank');
    // noopener is the security control here, not hygiene: ?demo=1 is
    // same-origin, so without it the practice tab gets a live handle back into
    // a tab holding real work.
    assert.equal(anchor.rel, 'noopener noreferrer');
    assert.equal(clicked, 1, 'the anchor must actually be activated');
  });
});

test('it leaves no anchor behind in the document', () => {
  withDom((document) => {
    openInNewTab(SANDBOX_URL, { doc: document });
    assert.equal(document.body.querySelectorAll('a').length, 0);
  });
});

test('it degrades to false rather than throwing when there is no document', () => {
  // This runs at module scope in the built single-file IIFE and must never be
  // able to white-screen the app just because it was called somewhere odd.
  assert.equal(openInNewTab(SANDBOX_URL, { doc: null }), false);
  assert.equal(openInNewTab(SANDBOX_URL, { doc: {} }), false);
});
