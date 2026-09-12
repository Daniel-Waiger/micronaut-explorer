// Guard: a test adopted from a scratch directory once imported app modules by
// the absolute path of the machine it was written on. It passed there and
// failed on every other machine, CI included. Every import in web/tests and
// web/src must be relative.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no JS file under web/ imports by an absolute filesystem path', () => {
  const offenders = [];
  for (const file of [...walk(here), ...walk(path.join(here, '..', 'src'))]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bfrom\s+['"](\/[^'"]+)['"]|\bimport\(\s*['"](\/[^'"]+)['"]/g)) {
      offenders.push(`${path.relative(path.join(here, '..'), file)}: ${match[1] || match[2]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
