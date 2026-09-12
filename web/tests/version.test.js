// Guards APP_VERSION (core/version.js, shown on the Settings page) against
// drifting from release-notes/CHANGELOG.md (shown on the published release
// notes page), and both of those against release-notes/index.html's own two
// hand-maintained version surfaces -- the RELEASE.version constant its
// script sets the hero eyebrow/lede-adjacent copy and Highlights subtitle
// from, and the footer's static fallback literal (shown whenever
// fetch(./CHANGELOG.md) can't run, e.g. under file://). Four places one
// release number appears; a bumped constant with a forgotten changelog
// entry, or an index.html edited on only one of its two surfaces, fails
// loudly here instead of shipping a page that disagrees with itself or with
// Settings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_VERSION } from '../src/core/version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const changelogPath = path.join(here, '..', 'release-notes', 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf-8');
const releaseNotesHtmlPath = path.join(here, '..', 'release-notes', 'index.html');
const releaseNotesHtml = readFileSync(releaseNotesHtmlPath, 'utf-8');

test('APP_VERSION matches the newest released version in release-notes/CHANGELOG.md', () => {
  const match = changelog.match(/^##\s+\[(?!Unreleased\])([^\]]+)\]/m);
  assert.ok(match, 'release-notes/CHANGELOG.md has no versioned "## [x.y.z]" heading');
  assert.equal(APP_VERSION, match[1]);
});

test('release-notes/index.html RELEASE.version constant matches APP_VERSION', () => {
  const match = releaseNotesHtml.match(/var\s+RELEASE\s*=\s*\{\s*version:\s*'([^']+)'/);
  assert.ok(match, 'release-notes/index.html has no `var RELEASE = { version: \'...\' }` constant');
  assert.equal(APP_VERSION, match[1]);
});

test('release-notes/index.html footer-version static fallback matches APP_VERSION', () => {
  const match = releaseNotesHtml.match(/id="footer-version">v([^<]+)</);
  assert.ok(match, 'release-notes/index.html has no `id="footer-version"` span');
  assert.equal(APP_VERSION, match[1]);
});
