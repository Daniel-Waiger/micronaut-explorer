// Guards web/release-notes/index.html's changelog renderer (render()/
// inline()/safeHref()/esc()/foldContinuationLines()) against the exact bug
// class in V2-NEW-01/R2-04 (soft-wrapped CHANGELOG.md lines rendering as
// orphaned <p>s outside the list) and R2-05/R5-06 (repo-relative links
// 404ing wherever this page is actually deployed).
//
// Per lesson 40 ("test the producer, not a copy") this test does NOT retype
// the renderer's logic: it extracts the exact function-definition text from
// index.html's own <script> block and evaluates it with `new Function(...)`,
// then calls the real render() against the real web/release-notes/
// CHANGELOG.md. The functions were deliberately kept inline in index.html
// (not moved to a separate web/release-notes/render.js loaded via
// <script src>) because this page's script is a CLASSIC (non-module) script
// on purpose: under file://, ES module scripts are blocked outright by the
// browser before they run at all, whereas today's classic script still runs
// and only its fetch('./CHANGELOG.md') call rejects (caught, with a
// friendly fallback -- see the .catch() block a few lines below the
// extracted region). Splitting the renderer into an ES module would trade
// that working file:// degradation for a page that never executes there,
// which nothing in this task asked for. Extract-and-eval gets the same
// "run the producer's real bytes" guarantee without that regression.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(here, '..', 'release-notes', 'index.html');
const changelogPath = path.join(here, '..', 'release-notes', 'CHANGELOG.md');

// Extracts { render, inline, safeHref, esc, foldContinuationLines } by
// literally slicing the function-definition text out of index.html's
// <script> block (from the `var CL_GH = ...` line through the closing brace
// of render()) and evaluating it -- the exact bytes the page ships, not a
// hand-copied re-implementation.
function loadRenderer(htmlPath) {
  const html = readFileSync(htmlPath, 'utf-8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, `${htmlPath} has no inline <script> block`);
  const scriptText = scriptMatch[1];

  const startMarker = "var CL_GH = ";
  const startIdx = scriptText.indexOf(startMarker);
  assert.ok(startIdx >= 0, `could not find "${startMarker}" in ${htmlPath}'s script`);

  const endMarker = "var body = document.getElementById";
  const endIdx = scriptText.indexOf(endMarker);
  assert.ok(endIdx >= 0, `could not find "${endMarker}" in ${htmlPath}'s script`);
  assert.ok(endIdx > startIdx, 'end marker precedes start marker');

  const funcsText = scriptText.slice(startIdx, endIdx);
  // Sanity: the slice must actually contain the functions we're about to
  // call, so a marker drifting out from under this test fails loudly
  // instead of silently exercising nothing.
  for (const name of ['function esc(', 'function safeHref(', 'function inline(', 'function render(']) {
    assert.ok(funcsText.includes(name), `extracted script text is missing ${name} -- markers may have drifted`);
  }

  const factory = new Function(
    funcsText + '\nreturn { esc: esc, safeHref: safeHref, inline: inline, render: render, foldContinuationLines: typeof foldContinuationLines !== "undefined" ? foldContinuationLines : undefined };'
  );
  return factory();
}

test('renderer produces one <li> per CHANGELOG.md bullet line (no orphaned continuation <p>s)', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = readFileSync(changelogPath, 'utf-8');
  const bulletCount = md.split('\n').filter((l) => /^[-*]\s+/.test(l.replace(/\r$/, ''))).length;
  assert.ok(bulletCount > 0, 'CHANGELOG.md fixture has no bullet lines to compare against');

  const html = render(md);
  const liCount = (html.match(/<li>/g) || []).length;
  assert.equal(liCount, bulletCount, `expected ${bulletCount} <li> (one per CHANGELOG.md bullet), got ${liCount}`);
});

test('renderer emits no <p> whose text starts with a lowercase continuation fragment', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = readFileSync(changelogPath, 'utf-8');
  const html = render(md);
  const paragraphs = [...html.matchAll(/<p>(.*?)<\/p>/gs)].map((m) => m[1]);
  const offenders = paragraphs.filter((p) => /^[a-z]/.test(p.replace(/^<[^>]+>/, '')));
  assert.deepEqual(offenders, [], `<p> tags starting lowercase (orphaned continuation lines): ${JSON.stringify(offenders)}`);
});

test('renderer drops the intro boilerplate cleanly (no "retroactively" fragment survives)', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = readFileSync(changelogPath, 'utf-8');
  const html = render(md);
  assert.ok(!html.includes('retroactively'), 'the intro paragraph containing "retroactively" should be filtered out whole, not partially rendered');
});

test('every href in the rendered output is absolute https or an in-page anchor', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = readFileSync(changelogPath, 'utf-8');
  const html = render(md);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 0, 'no <a href> found in rendered output -- CHANGELOG.md fixture may have lost its links');
  for (const href of hrefs) {
    assert.ok(/^https:\/\//.test(href) || /^#/.test(href), `href is neither absolute https nor an in-page anchor: ${href}`);
  }
});

test("CHANGELOG.md's three ../../ links resolve to github.com/.../blob/main/<path>", () => {
  const { safeHref } = loadRenderer(indexHtmlPath);
  assert.equal(safeHref('../../ROADMAP.md'), 'https://github.com/Daniel-Waiger/micronaut-explorer/blob/main/ROADMAP.md');
  assert.equal(safeHref('../../TASKS.md'), 'https://github.com/Daniel-Waiger/micronaut-explorer/blob/main/TASKS.md');
  assert.equal(
    safeHref('../../docs/plans/status-scopes.md'),
    'https://github.com/Daniel-Waiger/micronaut-explorer/blob/main/docs/plans/status-scopes.md'
  );
});

test('safeHref still passes through absolute https/mailto/#-anchor links unchanged, and neuters unsafe schemes', () => {
  const { safeHref } = loadRenderer(indexHtmlPath);
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeHref('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(safeHref('#changelog'), '#changelog');
  assert.equal(safeHref('javascript:alert(1)'), '#');
});

test('a soft-wrapped bullet continuation folds onto its <li> instead of becoming its own <p>', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = [
    '# Changelog',
    '',
    '## [1.0.0] - 2026-01-01',
    '',
    '### Added',
    '- A bullet that wraps across',
    '  two raw lines with no blank',
    '  line between them.',
    '- A second, unrelated bullet.',
    '',
  ].join('\n');
  const html = render(md);
  const liCount = (html.match(/<li>/g) || []).length;
  const pCount = (html.match(/<p>/g) || []).length;
  assert.equal(liCount, 2, `expected 2 <li>, got ${liCount}: ${html}`);
  assert.equal(pCount, 0, `expected 0 orphaned <p>, got ${pCount}: ${html}`);
  assert.match(html, /wraps across two raw lines with no blank line between them\./);
});

test('a soft-wrapped intro paragraph (no preceding bullet) folds into one filtered logical line', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = [
    '# Changelog',
    '',
    'All notable changes are documented here.',
    'This project uses Semantic Versioning. Reconstructed',
    'retroactically across two lines.',
    '',
    '## [1.0.0] - 2026-01-01',
    '',
    '### Added',
    '- Real entry.',
  ].join('\n');
  const html = render(md);
  assert.ok(!html.includes('retroactically'), 'the multi-line intro should be dropped as one whole logical line, not partially rendered');
  assert.equal((html.match(/<li>/g) || []).length, 1);
});

test('a blank line still separates two consecutive plain paragraphs (no over-folding)', () => {
  const { render } = loadRenderer(indexHtmlPath);
  const md = [
    '## [1.0.0] - 2026-01-01',
    '',
    '### Removed',
    'First standalone paragraph.',
    '',
    'Second standalone paragraph.',
  ].join('\n');
  const html = render(md);
  const paragraphs = [...html.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(paragraphs, ['First standalone paragraph.', 'Second standalone paragraph.']);
});

test('REPRO (must fail on the pre-change tree): the real CHANGELOG.md renders with zero lowercase-starting <p> and the correct <li> count', () => {
  // This is the same pair of assertions as the two tests above, run
  // together against the real fixture -- named REPRO because it is the one
  // this task's report proves failed before the edit and passes after.
  const { render } = loadRenderer(indexHtmlPath);
  const md = readFileSync(changelogPath, 'utf-8');
  const bulletCount = md.split('\n').filter((l) => /^[-*]\s+/.test(l.replace(/\r$/, ''))).length;
  const html = render(md);
  const liCount = (html.match(/<li>/g) || []).length;
  const paragraphs = [...html.matchAll(/<p>(.*?)<\/p>/gs)].map((m) => m[1]);
  const lowercaseOffenders = paragraphs.filter((p) => /^[a-z]/.test(p.replace(/^<[^>]+>/, '')));
  assert.equal(liCount, bulletCount);
  assert.deepEqual(lowercaseOffenders, []);
});
