// Tests for ui/steps/overview.js's Review screen -- C2 (R4-04, R4-07, R6-03,
// R4-14, R4-09). Drives the real render() over a real store/kb, the same
// pattern namingStep.test.js/studyStep.test.js use, so this exercises the
// actual DOM tree and click handlers rather than a re-description of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomStub } from './domStub.js';
import { createOverviewStep } from '../src/ui/steps/overview.js';
import { createStore } from '../src/core/store.js';
import { emptyExperiment } from '../src/core/schema.js';
import { emptyAssay } from '../src/core/assay.js';
import { NAMING_CONFIG, BASE_TEMPLATE, realKb } from './fixtures.js';

function twoMeasurementStudyWithBlockedPanel() {
  const plain = emptyAssay('measurement-1');
  const spillover = {
    ...emptyAssay('measurement-2'),
    panel: {
      ...emptyAssay('measurement-2').panel,
      channels: [
        { id: 'c1', fluorophore: 'ALEXA488', conjugation: 'direct-probe' },
        { id: 'c2', fluorophore: 'FITC', conjugation: 'direct-probe' },
      ],
    },
  };
  return { ...emptyExperiment(), assays: [plain, spillover] };
}

// Both the Decisions section and the Export checks section share the base
// '.conformance' class -- distinguish them by their own <h2> heading text
// rather than by DOM order, which is an implementation detail.
function findSectionByHeading(main, headingText) {
  return [...main.querySelectorAll('.conformance')].find((section) => {
    const heading = section.querySelector('h2');
    return heading && heading.textContent === headingText;
  });
}

function mount(experiment, { showToast = () => {}, navigated = [] } = {}) {
  const dom = createDomStub();
  dom.install();
  const store = createStore(experiment);
  const main = dom.document.createElement('div');
  const step = createOverviewStep(realKb());
  const router = { navigate: (routeId) => { navigated.push(routeId); return true; } };
  step.render(main, store, { showToast, router });
  return { dom, main, store };
}

test('a blocked two-measurement study names the measurement and both dyes in Export checks, with a working "Blocks export" link', () => {
  const experiment = twoMeasurementStudyWithBlockedPanel();
  const navigated = [];
  const { dom, main } = mount(experiment, { navigated });
  try {
    const exportChecks = findSectionByHeading(main, 'Export checks');
    assert.ok(exportChecks, 'expected an Export checks section');
    const blocksLabels = [...exportChecks.querySelectorAll('.issue-blocks-label')];
    assert.ok(blocksLabels.length > 0, 'expected a visible "Blocks export" label');
    assert.ok(blocksLabels.some((el) => el.textContent === 'Blocks export'));

    const links = [...exportChecks.querySelectorAll('.conformance-issue-link')];
    const spilloverLink = links.find((l) => /ALEXA488/.test(l.textContent) && /FITC/.test(l.textContent));
    assert.ok(spilloverLink, `expected a link naming both dyes; saw: ${links.map((l) => l.textContent).join(' | ')}`);
    // The measurement's own display name, not "Assay 2".
    assert.match(spilloverLink.textContent, /Measurement 2/);
    assert.doesNotMatch(spilloverLink.textContent, /\bAssay\b/);

    spilloverLink.click();
    assert.equal(navigated.length, 1, 'expected the link to navigate');
  } finally {
    dom.restore();
  }
});

test('the Decisions list names that measurement exactly once for the spillover flag (no duplicate rows)', () => {
  const experiment = twoMeasurementStudyWithBlockedPanel();
  const { dom, main } = mount(experiment);
  try {
    const decisions = findSectionByHeading(main, 'Decisions');
    assert.ok(decisions, 'expected a Decisions section');
    // domStub's querySelectorAll only understands single simple selectors
    // (no descendant combinators) -- select the list containers, then their
    // <li> children directly.
    // Two genuinely distinct panel flags name both dyes here (an emission
    // co-registration error and a separate excitation warning) -- the
    // dedupe under test is about the SAME flag appearing twice, so narrow to
    // the emission (blocking) one specifically.
    const decisionsItems = [...decisions.querySelectorAll('.issues-list')]
      .flatMap((list) => list.children)
      .map((li) => li.textContent)
      .filter((text) => /ALEXA488/.test(text) && /FITC/.test(text) && /emission/.test(text));
    assert.equal(decisionsItems.length, 1, `expected exactly one spillover decision row; saw: ${JSON.stringify(decisionsItems)}`);
    assert.match(decisionsItems[0], /Measurement 2/);
  } finally {
    dom.restore();
  }
});

test('the export toast names the dyes, not just a bare count', () => {
  const experiment = twoMeasurementStudyWithBlockedPanel();
  const toasts = [];
  const { dom, main } = mount(experiment, { showToast: (msg) => toasts.push(msg) });
  try {
    const exportBtn = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Markdown (.md)');
    assert.ok(exportBtn);
    exportBtn.click();
    assert.ok(toasts.length > 0, 'expected a toast');
    const last = toasts[toasts.length - 1];
    assert.match(last, /ALEXA488/);
    assert.match(last, /FITC/);
    assert.match(last, /Measurement 2/);
  } finally {
    dom.restore();
  }
});

function captureDownloadedFilename(document, act) {
  let filename = null;
  const originalAppend = document.body.appendChild.bind(document.body);
  document.body.appendChild = (node) => {
    if (node.localName === 'a' && typeof node.download === 'string') filename = node.download;
    return originalAppend(node);
  };
  try {
    act();
  } finally {
    document.body.appendChild = originalAppend;
  }
  return filename;
}

test('a study title of only spaces exports a sensibly named file, not "-.md"', () => {
  const experiment = { ...emptyExperiment(), meta: { ...emptyExperiment().meta, title: '   ' }, assays: [emptyAssay('a1')] };
  const { dom, main } = mount(experiment);
  try {
    const exportBtn = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Markdown (.md)');
    const filename = captureDownloadedFilename(dom.document, () => exportBtn.click());
    assert.ok(filename, 'expected a download to fire');
    assert.notEqual(filename, '-.md');
    assert.ok(!/^-*\.md$/.test(filename), `filename must not sanitize to bare dashes: ${filename}`);
  } finally {
    dom.restore();
  }
});

test('a study title in a non-Latin script also exports a sensibly named file', () => {
  const experiment = { ...emptyExperiment(), meta: { ...emptyExperiment().meta, title: '研究' }, assays: [emptyAssay('a1')] };
  const { dom, main } = mount(experiment);
  try {
    const exportBtn = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Markdown (.md)');
    const filename = captureDownloadedFilename(dom.document, () => exportBtn.click());
    assert.ok(filename);
    assert.notEqual(filename, '-.md');
    assert.ok(!/^-*\.md$/.test(filename), `filename must not sanitize to bare dashes: ${filename}`);
  } finally {
    dom.restore();
  }
});

test('the diagram has no "Assay" label text anywhere', () => {
  const experiment = twoMeasurementStudyWithBlockedPanel();
  const { dom, main } = mount(experiment);
  try {
    const svg = main.querySelector('.study-map-svg');
    assert.ok(svg);
    const captions = [...svg.querySelectorAll('.study-map-caption')].map((n) => n.textContent);
    const values = [...svg.querySelectorAll('.study-map-value')].map((n) => n.textContent);
    for (const text of [...captions, ...values]) {
      assert.doesNotMatch(text, /\bAssay\b/, `diagram text must say Measurement, not Assay: "${text}"`);
    }
  } finally {
    dom.restore();
  }
});

test('the LLM-prompt copy fallback reveals the prompt text itself when clipboard copy fails', async () => {
  const experiment = twoMeasurementStudyWithBlockedPanel();
  const { dom, main } = mount(experiment);
  try {
    // Force the copy-to-clipboard path to fail (domStub's default clipboard
    // shim always succeeds), and there is no execCommand fallback in this
    // stub either, so the whole copyToClipboard() call resolves false.
    dom.window.navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    const copyBtn = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Copy prompt for your own LLM');
    assert.ok(copyBtn);
    copyBtn.click();
    // Let the async handler's promise chain settle via a real macrotask tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const textarea = main.querySelector('.overview-llm-prompt-textarea');
    assert.ok(textarea, 'expected a fallback textarea to exist');
    const fallbackBox = main.querySelector('.overview-llm-prompt-fallback');
    assert.equal(fallbackBox.hidden, false, 'expected the fallback to be revealed');
    assert.ok(textarea.value.length > 0, 'expected the prompt text itself, not a pointer to another export');
    assert.doesNotMatch(textarea.value, /^Study report data$/);
  } finally {
    dom.restore();
  }
});
