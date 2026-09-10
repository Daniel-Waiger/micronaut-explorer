import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');

test('the Utilities control that owns Restore is present and not globally hidden', () => {
  assert.match(shell, /utilityToggle\.textContent\s*=\s*['"]Utilities['"]/);
  assert.match(shell, /restoreTitle\.textContent\s*=\s*['"]Restore previous version['"]/);
  assert.doesNotMatch(css, /\.shell-utilities\s*\{\s*display:\s*none\s*;\s*\}/);
  assert.match(css, /\.shell-utility-toggle\s*\{[\s\S]*?display:\s*inline-flex\s*;/);
});
