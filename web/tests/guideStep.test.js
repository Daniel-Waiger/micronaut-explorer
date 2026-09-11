// Tests for ui/steps/guide.js's walkthrough-start gate (AUD-13). The bug this
// closes: the gate checked `meta.origin === 'example'`, but main.js's
// openExampleStudy retags the opened example 'template' the moment it lands
// in the store, and nothing in the current app ever writes the older
// 'example' tag into a live store -- so the gate could never open. The fix
// swaps in core/appController.js's shared isExampleOrigin(origin), which
// accepts both values.
//
// Also asserts the stale Guide copy this task corrects: the GitHub-issue
// action does not carry the feedback report in the link (see
// ui/feedbackHandoff.js), and the restorable project backup lives on
// Settings, not Review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { guideStep } from '../src/ui/steps/guide.js';
import { createDomStub } from './domStub.js';

// domStub.js's FakeElement.append(...nodes) mirrors real DOM Node.append()
// except for one corner it does not implement: real append() auto-converts a
// raw string argument into a Text node, while the stub's appendChild assumes
// every argument is already node-like and throws on a primitive string.
function withGuidePage(run) {
  const { document, install, restore } = createDomStub();
  install();
  try {
    return run(document);
  } finally {
    restore();
  }
}

function fakeStore(origin) {
  return { get: () => ({ meta: { origin } }) };
}

function renderGuide(document, store, overrides = {}) {
  const calls = { start: 0, resume: 0, restart: 0, explain: 0 };
  const main = document.createElement('div');
  guideStep.render(main, store, {
    onStartGuided: () => calls.start++,
    onResumeGuided: () => calls.resume++,
    onRestartGuided: () => calls.restart++,
    onExplainGuided: () => calls.explain++,
    ...overrides,
  });
  const button = main.querySelector('.guide-tour-button');
  return { main, button, calls };
}

test('guide step: walkthrough Start/Resume/Restart/Explain gating', () => {
  withGuidePage((document) => {
    // origin 'example' + not-started -> Start.
    {
      const { button, calls } = renderGuide(document, fakeStore('example'), {
        guidedStatus: { status: 'not-started' },
      });
      assert.equal(button.textContent, 'Start example walkthrough');
      button.click();
      assert.equal(calls.start, 1);
      assert.equal(calls.resume, 0);
      assert.equal(calls.restart, 0);
      assert.equal(calls.explain, 0);
    }

    // origin 'template' + not-started -> Start TOO. This is the fix: before
    // AUD-13, this exact case fell through to "Explain the workflow" because
    // the gate literally compared against 'example' only, while
    // openExampleStudy (main.js) retags the opened example 'template' the
    // moment it lands in the store -- so this is the origin the live app
    // actually produces.
    {
      const { button, calls } = renderGuide(document, fakeStore('template'), {
        guidedStatus: { status: 'not-started' },
      });
      assert.equal(button.textContent, 'Start example walkthrough');
      button.click();
      assert.equal(calls.start, 1);
      assert.equal(calls.explain, 0, 'pre-fix behavior (wrongly falling to Explain) must not recur');
    }

    // paused -> Resume, regardless of origin (mirrors home.js's precedent).
    {
      const { button, calls } = renderGuide(document, fakeStore('template'), {
        guidedStatus: { status: 'paused' },
      });
      assert.equal(button.textContent, 'Resume example walkthrough');
      button.click();
      assert.equal(calls.resume, 1);
      assert.equal(calls.start, 0);
      assert.equal(calls.restart, 0);
    }

    // completed -> Restart, regardless of origin.
    {
      const { button, calls } = renderGuide(document, fakeStore('imported'), {
        guidedStatus: { status: 'completed' },
      });
      assert.equal(button.textContent, 'Restart example walkthrough');
      button.click();
      assert.equal(calls.restart, 1);
      assert.equal(calls.start, 0);
      assert.equal(calls.resume, 0);
    }

    // A non-example origin at not-started still falls to Explain -- Start
    // must stay gated to an example/template study, not open unconditionally.
    {
      const { button, calls } = renderGuide(document, fakeStore('blank'), {
        guidedStatus: { status: 'not-started' },
      });
      assert.equal(button.textContent, 'Explain the workflow');
      button.click();
      assert.equal(calls.explain, 1);
      assert.equal(calls.start, 0);
    }

    // getGuidedStatus() takes precedence over a stale guidedStatus prop.
    {
      const { button, calls } = renderGuide(document, fakeStore('example'), {
        guidedStatus: { status: 'not-started' },
        getGuidedStatus: () => ({ status: 'paused' }),
      });
      assert.equal(button.textContent, 'Resume example walkthrough');
      button.click();
      assert.equal(calls.resume, 1);
      assert.equal(calls.start, 0);
    }

    // Malformed/missing guided status degrades to 'not-started' without throwing.
    {
      const { button } = renderGuide(document, fakeStore('example'), { guidedStatus: null });
      assert.equal(button.textContent, 'Start example walkthrough');
    }
  });
});

test('guide step: the title attribute matches the branch', () => {
  withGuidePage((document) => {
    const start = renderGuide(document, fakeStore('example'), { guidedStatus: { status: 'not-started' } }).button;
    assert.match(start.title, /open the optional seven-step example walkthrough/i);

    const resume = renderGuide(document, fakeStore('template'), { guidedStatus: { status: 'paused' } }).button;
    assert.match(resume.title, /resume the optional seven-step example walkthrough/i);

    const restart = renderGuide(document, fakeStore('template'), { guidedStatus: { status: 'completed' } }).button;
    assert.match(restart.title, /restart the optional seven-step example walkthrough/i);

    const explain = renderGuide(document, fakeStore('blank'), { guidedStatus: { status: 'not-started' } }).button;
    assert.match(explain.title, /open a contextual explanation/i);

    // Every branch's title differs from every other -- the tooltip always
    // names the actual action the click performs, never a generic fallback.
    const titles = new Set([start.title, resume.title, restart.title, explain.title]);
    assert.equal(titles.size, 4);
  });
});

test('guide step: corrected GitHub-issue and backup-location copy', () => {
  withGuidePage((document) => {
    const { main } = renderGuide(document, fakeStore('example'), { guidedStatus: { status: 'not-started' } });
    const text = main.textContent;

    // The GitHub link (ui/feedbackHandoff.js:22-24) prefills only
    // labels=feedback -- there is no body parameter, and its own modal
    // (feedbackHandoff.js:57-62) correctly says the link "contains no
    // feedback, browser details, or study data" -- so the Guide must not
    // claim the report rides along in the link.
    assert.doesNotMatch(text, /same report already in the body/i);
    assert.doesNotMatch(text, /opens a prefilled issue with the same report/i);
    assert.match(text, /carries no feedback, browser details, or study data/i);

    // The importable backup lives on Settings ("Project backup
    // (.micronaut.json, importable)"); Review's downloads are derived
    // reports, not restorable state.
    assert.doesNotMatch(text, /Download buttons on the Review step/i);
    assert.match(text, /Settings step/);
    assert.match(text, /Project backup \(\.micronaut\.json, importable\)/);
  });
});

test('guide step source: no surviving claim that the GitHub link carries the report body', () => {
  const path = fileURLToPath(new URL('../src/ui/steps/guide.js', import.meta.url));
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /same report already in the body/i);
  assert.doesNotMatch(source, /prefilled issue with the same report/i);
});
