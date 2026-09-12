// R5-12: no skip link existed anywhere in the app -- a keyboard user Tabbed
// through 18 header/nav/utility controls before reaching the first
// in-content control on every route (docs/plans/app-review-2026-09-11.md
// R5-12). Verified at the SOURCE level: the DOM stub does not model tab
// order or focus, and headless Chromium cannot hold focus either (lesson
// 56). What IS checkable: the link is the first element inside <body>, it
// targets the id ui/shell.js gives its <main>, and app.css hides the link
// offscreen until it is focused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(here, '../index.html'), 'utf8');
const shellJs = readFileSync(path.join(here, '../src/ui/shell.js'), 'utf8');
const appCss = readFileSync(path.join(here, '../styles/app.css'), 'utf8');

test('the skip link is the first element inside <body>, before #app', () => {
  const bodyOpen = indexHtml.indexOf('<body>');
  const skipLinkIndex = indexHtml.indexOf('<a href="#main-content" class="skip-link">Skip to content</a>');
  const appDivIndex = indexHtml.indexOf('<div id="app">');
  assert.ok(bodyOpen !== -1, 'expected a <body> tag');
  assert.ok(skipLinkIndex !== -1, 'expected the skip link markup');
  assert.ok(appDivIndex !== -1, 'expected #app');
  assert.ok(skipLinkIndex > bodyOpen, 'the skip link is inside <body>');
  assert.ok(skipLinkIndex < appDivIndex, 'the skip link comes before #app, i.e. before the rest of the chrome');

  // Nothing else RENDERED precedes it inside <body> -- it really is the
  // first focusable element, not merely somewhere near the top. HTML
  // comments are stripped first: they document why the link exists but are
  // not nodes, let alone focusable ones.
  const bodyPrefix = indexHtml
    .slice(bodyOpen + '<body>'.length, skipLinkIndex)
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  assert.equal(bodyPrefix, '', 'nothing precedes the skip link inside <body>');
});

test('the skip link targets the id shell.js puts on its <main>', () => {
  assert.match(indexHtml, /href="#main-content"/, 'the skip link points at #main-content');
  assert.match(shellJs, /main\.id = 'main-content'/, 'shell.js assigns the target id to its <main>');
  assert.match(shellJs, /main\.tabIndex = -1/, 'a <main> needs tabindex=-1 to be focusable via the link');
});

test('the skip link is visually hidden until it receives keyboard focus', () => {
  assert.match(appCss, /\.skip-link\s*\{[^}]*top:\s*-999px/, 'offscreen by default');
  assert.match(appCss, /\.skip-link:focus\s*\{[^}]*top:\s*8px/, 'revealed on focus');
});
