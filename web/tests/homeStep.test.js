// Study map (home step) guided-entry + example-link coverage. AUD-12:
// appendGuidedEntry used to fall through to "Explain Study map" for every
// status except paused/completed, so 'not-started' -- an ordinary first
// visit -- had NO way to start the walkthrough at all, even though main.js
// already wires onStartGuided to every step. These tests drive
// appendGuidedEntry/appendExampleLink directly (both now exported) against
// the shared hand-rolled DOM stub, rather than through the full
// homeStep.render(), because render() also builds a real Study map via
// createStudyMap({ store, router }), which needs a whole store/experiment
// fixture unrelated to this bug -- see docs/cma-lessons.md lesson 4
// (one-concern tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendGuidedEntry, appendExampleLink } from '../src/ui/steps/home.js';
import { createDomStub } from './domStub.js';

function withHomeContainer(callback) {
  const { document: fakeDocument, install, restore } = createDomStub();
  install();
  try {
    callback(fakeDocument.createElement('main'));
  } finally {
    restore();
  }
}

function guidedCallbacks() {
  const calls = { start: [], resume: [], restart: [], explain: [] };
  return {
    calls,
    onStartGuided: (arg) => calls.start.push(arg),
    onResumeGuided: (arg) => calls.resume.push(arg),
    onRestartGuided: (arg) => calls.restart.push(arg),
    onExplainGuided: (arg) => calls.explain.push(arg),
  };
}

function primaryCard(main) {
  return main.querySelector('.home-card');
}

function secondaryExplainLinks(main) {
  return main.querySelectorAll('.home-skip-link').filter((link) => /Explain Study map/.test(link.textContent));
}

test('not-started offers Start example walkthrough and calls onStartGuided exactly once', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    // isExample: true -- the walkthrough is a tour OF the example, and since
    // the example now only ever opens in the practice tab, this is the only
    // situation in which Start can actually fire. The opposite branch is the
    // next test.
    appendGuidedEntry(main, { guidedStatus: { status: 'not-started' }, isExample: true, ...cb });

    const card = primaryCard(main);
    assert.match(card.textContent, /Start example walkthrough/);
    card.click();
    assert.deepEqual(cb.calls.start, ['home']);
    assert.equal(cb.calls.resume.length, 0);
    assert.equal(cb.calls.restart.length, 0);
    assert.equal(cb.calls.explain.length, 0);

    // Explain stays reachable as a secondary action alongside the new
    // Start card -- losing it would regress today's only Home behaviour.
    const explainLinks = secondaryExplainLinks(main);
    assert.equal(explainLinks.length, 1);
    explainLinks[0].click();
    assert.deepEqual(cb.calls.explain, ['home']);
  });
});

test('active offers Continue walkthrough, reopening the panel via onResumeGuided', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    appendGuidedEntry(main, { guidedStatus: { status: 'active' }, ...cb });

    const card = primaryCard(main);
    assert.match(card.textContent, /Continue walkthrough/);
    card.click();
    // ui/walkthrough.js's start() and resume() are both openWalkthrough():
    // for an 'active' status it invokes no transition and only reopens the
    // panel, so reusing onResumeGuided here is correct, not incidental.
    assert.deepEqual(cb.calls.resume, ['home']);
    assert.equal(cb.calls.start.length, 0);
    assert.equal(cb.calls.restart.length, 0);

    assert.equal(secondaryExplainLinks(main).length, 1);
  });
});

test('paused still offers Resume walkthrough via onResumeGuided (unchanged)', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    appendGuidedEntry(main, { guidedStatus: { status: 'paused' }, ...cb });

    const card = primaryCard(main);
    assert.match(card.textContent, /Resume walkthrough/);
    card.click();
    assert.deepEqual(cb.calls.resume, ['home']);
    assert.equal(secondaryExplainLinks(main).length, 1);
  });
});

test('completed still offers Restart walkthrough via onRestartGuided (unchanged)', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    appendGuidedEntry(main, { guidedStatus: { status: 'completed' }, ...cb });

    const card = primaryCard(main);
    assert.match(card.textContent, /Restart walkthrough/);
    card.click();
    assert.deepEqual(cb.calls.restart, ['home']);
    assert.equal(secondaryExplainLinks(main).length, 1);
  });
});

test('a malformed guided status degrades to the explain action instead of throwing', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    assert.doesNotThrow(() => {
      appendGuidedEntry(main, { getGuidedStatus: () => ({ status: 42 }), ...cb });
    });

    const card = primaryCard(main);
    assert.match(card.textContent, /Explain Study map/);
    card.click();
    assert.deepEqual(cb.calls.explain, ['home']);
    assert.equal(cb.calls.start.length, 0);
    assert.equal(cb.calls.resume.length, 0);
    assert.equal(cb.calls.restart.length, 0);

    // Explain is already the primary action here, so no redundant second
    // "Explain Study map" row should appear.
    assert.equal(secondaryExplainLinks(main).length, 0);
  });
});

test('a missing guided status (no guidedStatus, no getGuidedStatus) also degrades to explain', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    assert.doesNotThrow(() => {
      appendGuidedEntry(main, { ...cb });
    });
    assert.match(primaryCard(main).textContent, /Explain Study map/);
  });
});

test('getGuidedStatus() takes precedence over a stale guidedStatus prop', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    appendGuidedEntry(main, {
      guidedStatus: { status: 'completed' },
      getGuidedStatus: () => ({ status: 'active' }),
      ...cb,
    });

    // Fresh getGuidedStatus() ('active') wins over the stale prop
    // ('completed'): Continue, not Restart.
    assert.match(primaryCard(main).textContent, /Continue walkthrough/);
    primaryCard(main).click();
    assert.deepEqual(cb.calls.resume, ['home']);
    assert.equal(cb.calls.restart.length, 0);
  });
});

test('not-started on a study that did not come from the example offers the practice tab, not a Start that cannot fire', () => {
  withHomeContainer((main) => {
    const cb = guidedCallbacks();
    const opened = [];
    appendGuidedEntry(main, {
      guidedStatus: { status: 'not-started' },
      isExample: false,
      onOpenExampleTab: (url) => opened.push(url),
      ...cb,
    });

    const card = primaryCard(main);
    // The dead-button check. Before the practice tab existed this branch
    // promised "Start example walkthrough" on every study; now that the
    // example can only be opened in its own tab, guide.js's Start gate would
    // never open for this study, so promising Start here would be a button
    // that silently does nothing.
    assert.doesNotMatch(card.textContent, /Start example walkthrough/);
    assert.match(card.textContent, /practice tab/);

    card.click();
    assert.deepEqual(opened, ['?demo=1'], 'must open the practice tab');
    assert.equal(cb.calls.start.length, 0, 'must not claim to have started a walkthrough');
  });
});

test('the example card opens the practice tab rather than replacing the study', () => {
  withHomeContainer((main) => {
    const opened = [];
    const card = appendExampleLink(main, (url) => opened.push(url));

    assert.ok(card, 'expected the example card to render');
    assert.match(card.className, /home-card-featured/, 'it is the one featured card on this page');
    assert.match(card.textContent, /Explore a completed example/);

    card.click();
    // A URL, not a lifecycle callback: nothing about this click touches the
    // study open in this tab.
    assert.deepEqual(opened, ['?demo=1']);
  });
});

test('the example card is absent when no opener is supplied', () => {
  withHomeContainer((main) => {
    const result = appendExampleLink(main, undefined);
    assert.equal(result, null);
    assert.equal(main.children.length, 0, 'no dead button, and no empty grid left behind');
  });
});
