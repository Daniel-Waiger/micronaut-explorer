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
import { describeWalkthroughLength } from '../src/engine/workflowProgress.js';
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
  // Captures the injected opener rather than letting it fall through to the
  // real openInNewTab, which would try to touch document.body in a stub.
  const opened = [];
  const main = document.createElement('div');
  guideStep.render(main, store, {
    onStartGuided: () => calls.start++,
    onResumeGuided: () => calls.resume++,
    onRestartGuided: () => calls.restart++,
    onExplainGuided: () => calls.explain++,
    onOpenExampleTab: (url) => opened.push(url),
    ...overrides,
  });
  const button = main.querySelector('.guide-tour-button');
  const practiceTabButton = main.querySelector('.guide-practice-tab-button');
  return { main, button, practiceTabButton, opened, calls };
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

    // paused -> Resume, on an EXAMPLE study. The origin matters now: the
    // non-example case is covered by its own test below, because offering
    // Resume there would reopen a tour of the example over the user's own
    // study.
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

    // completed -> Restart, again on an example study. This block used to
    // pass fakeStore('imported') and assert Restart "regardless of origin" --
    // that was the bug: an imported study would be offered a restart of a
    // walkthrough written for the example.
    {
      const { button, calls } = renderGuide(document, fakeStore('example'), {
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

test('guide step: no status offers the walkthrough on a non-example study, and the practice tab is offered instead', () => {
  withGuidePage((document) => {
    // The gate used to apply only to 'not-started', so a non-example study
    // with a surviving progress record still got Resume/Restart -- a tour OF
    // THE EXAMPLE, reopened over the user's own work. Upgrading users can be
    // in exactly that state: the real tab's progress is stored under the same
    // unprefixed key it always was, so a walkthrough paused before the
    // practice tab existed survives into a tab the example is no longer in.
    for (const origin of ['blank', 'imported', 'user', 'draft']) {
      for (const status of ['not-started', 'paused', 'completed', 'active']) {
        const { button, practiceTabButton, opened, calls } = renderGuide(
          document,
          fakeStore(origin),
          { guidedStatus: { status } }
        );
        const where = `${origin}/${status}`;
        assert.equal(button.textContent, 'Explain the workflow', `${where} must not offer the walkthrough`);
        assert.equal(calls.start + calls.resume + calls.restart, 0, `${where} must not run a walkthrough`);

        // The escape hatch: without it the walkthrough would simply become
        // unreachable from Guide rather than redirected. Copilot flagged that
        // this button had no assertion anywhere -- the browser tests all
        // start from ?demo=1, so they never reach this branch.
        assert.ok(practiceTabButton, `${where} should offer the practice tab`);
        assert.equal(practiceTabButton.textContent, 'Try it in a practice tab');
        practiceTabButton.click();
        assert.deepEqual(opened, ['?demo=1'], `${where} should open the practice tab`);
      }
    }
  });
});

test('guide step: an example study is NOT offered the practice-tab escape hatch', () => {
  // The counterpart to the test above: on the example itself the walkthrough
  // runs here, so a second button pointing at another practice tab would be
  // noise. This is what keeps the gate from being trivially satisfied by
  // always rendering the hatch.
  withGuidePage((document) => {
    for (const status of ['not-started', 'paused', 'completed']) {
      const { practiceTabButton } = renderGuide(document, fakeStore('template'), {
        guidedStatus: { status },
      });
      assert.equal(practiceTabButton, null, `${status} on the example needs no practice-tab button`);
    }
  });
});

test('guide step: the title attribute matches the branch', () => {
  withGuidePage((document) => {
    // Asserts describeWalkthroughLength()'s CURRENT value rather than a
    // literal word, so this test can never lock in a stale step count again
    // (V2-NEW-05): it was the 'seven-step' regex here that defended the
    // wrong string through the five-step restructure.
    const walkthroughLength = describeWalkthroughLength();
    const start = renderGuide(document, fakeStore('example'), { guidedStatus: { status: 'not-started' } }).button;
    assert.match(start.title, new RegExp(`open the optional ${walkthroughLength} example walkthrough`, 'i'));

    const resume = renderGuide(document, fakeStore('template'), { guidedStatus: { status: 'paused' } }).button;
    assert.match(resume.title, new RegExp(`resume the optional ${walkthroughLength} example walkthrough`, 'i'));

    const restart = renderGuide(document, fakeStore('template'), { guidedStatus: { status: 'completed' } }).button;
    assert.match(restart.title, new RegExp(`restart the optional ${walkthroughLength} example walkthrough`, 'i'));

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

test('guide step source: no surviving "seven" anywhere (R2-01/R5-03, lesson 41)', () => {
  // The grep IS the acceptance test here: a semantically-correct rewrite that
  // still contains the literal stale word must fail this, not just the
  // regex-match tests above.
  const path = fileURLToPath(new URL('../src/ui/steps/guide.js', import.meta.url));
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /seven/i);
});

test('guide step: "The steps" reference lists exactly the five nav steps, not the per-measurement sections', () => {
  withGuidePage((document) => {
    const { main } = renderGuide(document, fakeStore('example'), { guidedStatus: { status: 'not-started' } });
    // domStub's querySelectorAll has no descendant-combinator support, so
    // query within "The steps" section specifically -- there is a second,
    // unrelated <dl> further down ("Key ideas") whose terms must not leak in.
    const stepsSection = [...main.querySelectorAll('.guide-section')].find(
      (section) => section.querySelector('h2')?.textContent === 'The steps'
    );
    const terms = [...stepsSection.querySelectorAll('dt')].map((dt) => dt.textContent);
    assert.deepEqual(terms, ['Study map', 'Research brief', 'Measurements', 'The open measurement', 'Review']);

    // Samples & design / Acquisition / Data plan must be described as
    // sections INSIDE a measurement (R2-03/R5-10), not as their own nav
    // steps -- so they must not appear as their own <dt> terms.
    for (const stale of ['Samples & design', 'Acquisition', 'Data plan']) {
      assert.ok(!terms.includes(stale), `${stale} must not be its own nav-step term`);
    }
    const openMeasurementDesc = [...stepsSection.querySelectorAll('dd')][3].textContent;
    assert.match(openMeasurementDesc, /Samples & design/);
    assert.match(openMeasurementDesc, /Acquisition/);
    assert.match(openMeasurementDesc, /Data plan/);
  });
});

test('guide step: manual link is a file, not a directory (R5-07)', () => {
  withGuidePage((document) => {
    const { main } = renderGuide(document, fakeStore('example'), { guidedStatus: { status: 'not-started' } });
    const link = [...main.querySelectorAll('a')].find((a) => /full user manual/i.test(a.textContent));
    assert.equal(link.href, 'manual/index.html');
  });
});
