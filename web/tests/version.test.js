// Guards APP_VERSION (core/version.js, shown on the Settings page) against
// drifting from release-notes/CHANGELOG.md (shown on the published release
// notes page) -- two places one release number appears, so a bumped
// constant with a forgotten changelog entry (or vice versa) fails loudly
// here instead of shipping a Settings page that disagrees with the notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_VERSION } from '../src/core/version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const changelogPath = path.join(here, '..', 'release-notes', 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf-8');

test('APP_VERSION matches the newest released version in release-notes/CHANGELOG.md', () => {
  const match = changelog.match(/^##\s+\[(?!Unreleased\])([^\]]+)\]/m);
  assert.ok(match, 'release-notes/CHANGELOG.md has no versioned "## [x.y.z]" heading');
  assert.equal(APP_VERSION, match[1]);
});
