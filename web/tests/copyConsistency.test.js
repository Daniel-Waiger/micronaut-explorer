// Guards against COPY DRIFT between the app's own strings and web/manual/'s
// documentation of them -- plain text/regex inspection of files on disk, no
// DOM, no dependency, following web/tests/manual.test.js's conventions (see
// that file's header comment for the wider pattern this one extends).
//
// Every defect this test exists to catch shipped BECAUSE nothing ever
// asserted these strings agree with each other:
//   - engine/measurementStatus.js's exported labels drifted from what
//     web/manual/measurements.html documented.
//   - ui/steps/overview.js's provenance sentence was quoted VERBATIM by
//     web/manual/review-exports.html -- the two only ever changed together
//     by luck, not by anything that checked.
//   - web/manual/big-ideas.html called the knowledge pack "human-authored"
//     while engine/spectra.js defaults every entry's reviewStatus to
//     'claude-drafted'.
//   - web/manual/measurements.html once documented "Ready to acquire" as
//     "every check the planner owns is satisfied", when the code computed
//     it from a single map state -- it now means only the plan axis (open
//     decisions resolved), never every export/design check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MEASUREMENT_STATUS_SCOPES,
  MEASUREMENT_STATUS_STATUSES,
  MEASUREMENT_STATUS_LABELS,
} from '../src/engine/measurementStatus.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..');
const manualDir = path.join(webDir, 'manual');
const srcDir = path.join(webDir, 'src');

const measurementsHtml = readFileSync(path.join(manualDir, 'measurements.html'), 'utf-8');
const overviewJsText = readFileSync(path.join(srcDir, 'ui', 'steps', 'overview.js'), 'utf-8');
const reviewExportsHtml = readFileSync(path.join(manualDir, 'review-exports.html'), 'utf-8');
const spectraJsText = readFileSync(path.join(srcDir, 'engine', 'spectra.js'), 'utf-8');

function manualHtmlFiles() {
  return readdirSync(manualDir).filter((name) => name.endsWith('.html'));
}

// --- 1. Status labels agree -------------------------------------------------
//
// Import the real module rather than hardcoding a second list here -- a
// hardcoded copy would be the very duplication this test exists to prevent.

test('every MEASUREMENT_STATUS_LABELS string is documented in web/manual/measurements.html', () => {
  for (const scope of MEASUREMENT_STATUS_SCOPES) {
    for (const status of MEASUREMENT_STATUS_STATUSES[scope]) {
      const label = MEASUREMENT_STATUS_LABELS[scope][status];
      assert.ok(
        measurementsHtml.includes(label),
        `measurementStatus.js's ${scope}:${status} label "${label}" does not appear anywhere in ` +
          'web/manual/measurements.html'
      );
    }
  }
});

// --- 2. The provenance sentence agrees ---------------------------------------
//
// review-exports.html quotes overview.js's explainer verbatim -- extract both
// with a focused regex (the same technique manual.test.js uses to pull
// CHAPTERS out of manual.js) rather than importing overview.js, which is a UI
// step module with DOM-touching render() internals this test has no need to
// load.

function extractOverviewProvenanceSentence(source) {
  const match = source.match(/explainer\.textContent\s*=\s*\n?\s*'([^']+)';/);
  assert.ok(
    match,
    "overview.js has no `explainer.textContent = '...';` provenance sentence in the expected shape"
  );
  return match[1];
}

function extractReviewExportsQuotedSentence(source) {
  const match = source.match(/explainer puts it plainly:\s*"([^"]+)"/);
  assert.ok(
    match,
    'review-exports.html has no \'explainer puts it plainly: "..."\' quote in the expected shape'
  );
  return match[1];
}

test("overview.js's provenance sentence matches the one quoted in web/manual/review-exports.html", () => {
  const appSentence = extractOverviewProvenanceSentence(overviewJsText);
  const manualQuote = extractReviewExportsQuotedSentence(reviewExportsHtml);
  assert.equal(
    manualQuote,
    appSentence,
    'web/manual/review-exports.html quotes a provenance sentence that no longer matches ' +
      'ui/steps/overview.js -- they drifted apart'
  );
});

// --- 3. No page claims human authorship of the knowledge pack ---------------

function extractDefaultReviewStatus(source) {
  const match = source.match(/const\s+DEFAULT_REVIEW_STATUS\s*=\s*'([^']+)';/);
  assert.ok(
    match,
    "spectra.js has no `const DEFAULT_REVIEW_STATUS = '...';` declaration in the expected shape"
  );
  return match[1];
}

// Assert the code-side default explicitly, so this test tells the truth (by
// failing loudly, not by silently no-op'ing) if that default ever changes.
test("spectra.js's DEFAULT_REVIEW_STATUS is currently 'claude-drafted'", () => {
  assert.equal(extractDefaultReviewStatus(spectraJsText), 'claude-drafted');
});

test('no web/manual/ page asserts the knowledge pack / rules / lookup tables are human-authored', () => {
  const defaultReviewStatus = extractDefaultReviewStatus(spectraJsText);
  assert.equal(
    defaultReviewStatus,
    'claude-drafted',
    "engine/spectra.js no longer defaults reviewStatus to 'claude-drafted' -- re-check whether the " +
      'manual\'s "not uniformly human-authored" wording is still accurate before relaxing this guard'
  );
  // Matches an ASSERTION of human authorship ("is human-authored" / "are
  // human-authored" / "is entirely/uniformly human-authored"), not a
  // NEGATION of one ("isn't uniformly human-authored"): \bis\b requires a
  // non-word boundary on both sides, and "isn't" has no such boundary
  // between the "s" and the "n" that follows it, so it never matches here.
  const assertsHumanAuthored = /\b(?:is|are)\s+(?:entirely\s+|uniformly\s+)?human-authored\b/i;
  for (const name of manualHtmlFiles()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    assert.doesNotMatch(
      html,
      assertsHumanAuthored,
      `${name} claims the knowledge pack is human-authored, but engine/spectra.js defaults ` +
        `reviewStatus to '${defaultReviewStatus}'`
    );
  }
});

// --- 4. "Ready to acquire" is not overclaimed --------------------------------
//
// "Ready to acquire" is the label of measurementStatus's plan:ready state
// ONLY -- it means this measurement's own open decisions are resolved, never
// that every check the planner owns (design, naming, spectral, conformance...)
// has passed. Search a bounded window around each occurrence rather than the
// whole file, so a coincidental "every check ..." elsewhere on an unrelated
// topic (e.g. a workflow-badge table entry about a different vocabulary
// entirely) can't produce a false positive.

test('"Ready to acquire" is never documented as "every check" being satisfied', () => {
  const overclaim = /every\s+(?:planner\s+)?check\b/i;
  const windowRadius = 300;
  for (const name of manualHtmlFiles()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    let idx = -1;
    while ((idx = html.indexOf('Ready to acquire', idx + 1)) !== -1) {
      const windowText = html.slice(Math.max(0, idx - windowRadius), idx + windowRadius);
      assert.doesNotMatch(
        windowText,
        overclaim,
        `${name} documents "Ready to acquire" near an "every check ..." overclaim -- it must mean only ` +
          'the plan axis (this measurement\'s own open decisions resolved), not every planner check'
      );
    }
  }
});
