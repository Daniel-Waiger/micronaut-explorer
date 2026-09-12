// A5 / review finding R6-07: design.biologicalReplicates and
// design.technicalReplicates had TWO editors on the composed Measurement page
// (design.js's number rows and the Acquisition interview boxes fed by
// questions.json) that did not agree. Replicates are design axes, so the
// design rows are the single editor and no question may write a design.*
// path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const questions = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'questions.json'), 'utf8'));

test('no interview question writes a design.* path (replicates have one editor: Samples & design)', () => {
  const designWriters = questions.filter((q) => String(q.field || '').startsWith('design.'));
  assert.deepEqual(designWriters.map((q) => q.id), []);
  assert.ok(!questions.some((q) => q.id === 'biologicalReplicates' || q.id === 'technicalReplicates'));
});
