// Guards web/manual/ (the standalone user-manual static mini-site) against
// the classes of drift its own pattern is prone to: a CHAPTERS entry pointing
// at a file that doesn't exist (or vice versa), a page missing the theme
// pre-paint guard (or one that reads a different localStorage key than the
// app actually uses), a mismatched cache-busting `?v=`, a dead internal link,
// or a screenshot reference with neither the file nor a pending-placeholder
// fallback. No DOM is used -- this is plain text/regex inspection of the
// files on disk, following this repo's existing node:test + fs conventions
// (see e.g. web/tests/version.test.js and web/tests/paths.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..');
const manualDir = path.join(webDir, 'manual');
const docsImagesDir = path.join(webDir, '..', 'docs', 'images');
const shellPath = path.join(webDir, 'src', 'ui', 'shell.js');

const manualJsText = readFileSync(path.join(manualDir, 'manual.js'), 'utf-8');
const shellText = readFileSync(shellPath, 'utf-8');

// manual.js is a browser IIFE (not an ES module), so it can't be imported
// directly here -- pull just the CHAPTERS array literal out of its source
// and evaluate that one expression, the same way a human would read it.
function extractChapters(source) {
  const match = source.match(/var\s+CHAPTERS\s*=\s*(\[[\s\S]*?\n\s*\]);/);
  assert.ok(match, 'manual.js has no "var CHAPTERS = [...]" declaration in the expected shape');
  // eslint-disable-next-line no-new-func -- trusted local source file, not user input.
  return Function(`"use strict"; return (${match[1]});`)();
}

const CHAPTERS = extractChapters(manualJsText);

function manualHtmlFiles() {
  return readdirSync(manualDir).filter((name) => name.endsWith('.html'));
}

test('CHAPTERS is a non-empty array of {num, file, title, blurb} entries', () => {
  assert.ok(Array.isArray(CHAPTERS));
  assert.ok(CHAPTERS.length > 0);
  for (const c of CHAPTERS) {
    assert.equal(typeof c.num, 'number');
    assert.equal(typeof c.file, 'string');
    assert.equal(typeof c.title, 'string');
    assert.equal(typeof c.blurb, 'string');
    assert.match(c.file, /^[a-z0-9-]+\.html$/);
  }
});

test('every CHAPTERS file entry exists on disk in web/manual/', () => {
  for (const c of CHAPTERS) {
    const p = path.join(manualDir, c.file);
    assert.ok(existsSync(p), `CHAPTERS references ${c.file}, but ${p} does not exist`);
  }
});

test('every chapter .html file on disk (except index.html) appears in CHAPTERS', () => {
  const chapterFileSet = new Set(CHAPTERS.map((c) => c.file));
  for (const name of manualHtmlFiles()) {
    if (name === 'index.html') continue;
    assert.ok(chapterFileSet.has(name), `${name} exists in web/manual/ but is not listed in manual.js's CHAPTERS`);
  }
});

test("shell.js's THEME_KEY literal is 'micronaut.theme'", () => {
  const match = shellText.match(/const\s+THEME_KEY\s*=\s*'([^']+)'/);
  assert.ok(match, 'web/src/ui/shell.js has no "const THEME_KEY = \'...\'" declaration');
  assert.equal(match[1], 'micronaut.theme');
});

test("shell.js's nav renders a relative 'manual/' link", () => {
  assert.match(shellText, /href\s*=\s*'manual\/'/);
});

function allManualPages() {
  // Pages that exist right now -- index.html always, plus whatever chapter
  // files have been written so far. A CHAPTERS entry whose file is still
  // missing is caught by the dedicated existence test above; this list is
  // deliberately just what's actually on disk to check every OTHER page-level
  // invariant (FOUC guard, cache-busting, data-chapter, ...).
  return manualHtmlFiles();
}

test('every manual page contains the theme pre-paint (FOUC) guard reading micronaut.theme', () => {
  for (const name of allManualPages()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    assert.match(
      html,
      /localStorage\.getItem\(['"]micronaut\.theme['"]\)/,
      `${name} is missing the FOUC-guard read of localStorage 'micronaut.theme'`
    );
    assert.match(
      html,
      /theme-fouc-guard/,
      `${name}'s FOUC guard script should be identifiable (id="theme-fouc-guard")`
    );
  }
});

// The guard only prevents a flash of the wrong theme if it runs before the
// browser has a stylesheet to paint with, so its position in <head> is the
// whole point of it -- a guard placed after the <link> still sets data-theme,
// but does it too late to matter.
test('every manual page runs the FOUC guard before the stylesheet link', () => {
  for (const name of allManualPages()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    const guardAt = html.indexOf('theme-fouc-guard');
    const cssAt = html.indexOf('rel="stylesheet"');
    assert.ok(
      guardAt < cssAt,
      `${name} links manual.css before the theme guard runs, so the first paint can use the wrong theme`
    );
  }
});

test('every chapter page has body data-chapter equal to its own filename', () => {
  for (const c of CHAPTERS) {
    const p = path.join(manualDir, c.file);
    if (!existsSync(p)) continue; // covered by the dedicated existence test
    const html = readFileSync(p, 'utf-8');
    const match = html.match(/<body[^>]*\bdata-chapter="([^"]*)"/);
    assert.ok(match, `${c.file} has no <body data-chapter="..."> attribute`);
    assert.equal(match[1], c.file, `${c.file}'s data-chapter should equal its own filename`);
  }
});

test('every page references manual.css?v=N and manual.js?v=N with one consistent N', () => {
  const versions = new Set();
  for (const name of allManualPages()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    const cssMatch = html.match(/manual\.css\?v=(\d+)/);
    const jsMatch = html.match(/manual\.js\?v=(\d+)/);
    assert.ok(cssMatch, `${name} has no manual.css?v=N link`);
    assert.ok(jsMatch, `${name} has no manual.js?v=N script`);
    assert.equal(cssMatch[1], jsMatch[1], `${name} has mismatched manual.css/manual.js versions`);
    versions.add(cssMatch[1]);
  }
  assert.equal(versions.size, 1, `all manual pages must share one ?v= value, found: ${[...versions].join(', ')}`);
});

test('every internal href="<chapter>.html#<id>" link targets a file that exists and has that id', () => {
  const hrefRe = /href="([a-z0-9-]+\.html)#([a-zA-Z0-9_-]+)"/g;
  for (const name of allManualPages()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    let match;
    while ((match = hrefRe.exec(html))) {
      const [, targetFile, id] = match;
      const targetPath = path.join(manualDir, targetFile);
      if (!existsSync(targetPath)) continue; // covered by the existence tests above
      const targetHtml = readFileSync(targetPath, 'utf-8');
      assert.match(
        targetHtml,
        new RegExp(`id="${id}"`),
        `${name} links to ${targetFile}#${id}, but ${targetFile} has no element with id="${id}"`
      );
    }
  }
});

test('every src="images/<name>" either exists in docs/images/ or has the pending-placeholder onerror handler', () => {
  const imgRe = /<figure[^>]*class="[^"]*\bshot\b[^"]*"[^>]*>[\s\S]*?<\/figure>/g;
  for (const name of allManualPages()) {
    const html = readFileSync(path.join(manualDir, name), 'utf-8');
    let figureMatch;
    while ((figureMatch = imgRe.exec(html))) {
      const figure = figureMatch[0];
      const srcMatch = figure.match(/src="images\/([^"]+)"/);
      if (!srcMatch) continue;
      const imagePath = path.join(docsImagesDir, srcMatch[1]);
      const hasImage = existsSync(imagePath);
      const hasPendingHandler = /onerror="this\.closest\('\.shot'\)\.classList\.add\('pending'\)"/.test(figure);
      assert.ok(
        hasImage || hasPendingHandler,
        `${name} references images/${srcMatch[1]}, which does not exist in docs/images/, ` +
          'and its figure has no onerror pending-placeholder handler'
      );
    }
  }
});
