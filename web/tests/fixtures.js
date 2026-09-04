// Shared test fixtures for anything that needs the REAL committed KB
// (web/kb/*.json) plus the naming config, over the real oregano default
// study or a hand-built one. Extracted from csv.test.js/json.test.js/
// studydoc.test.js, which had each hand-copied their own `realKb()` +
// `NAMING_CONFIG` + `BASE_TEMPLATE` -- three near-identical fixtures that
// had already drifted (none of the three loaded `kb/spectra.json`, so all
// three ran against a KB the app itself never has, silently missing
// whatever a spectra-derived studydoc field would need). One fixture module
// means adding a new KB sub-pack is a one-line change here, not a
// three-file hunt for every copy that needs the same edit.
//
// Not a *.test.js file itself -- `node --test web/tests/*.test.js` only
// picks up files matching that glob, so this module is never run as a
// suite of its own.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { shapeAppKb } from '../src/engine/kbpack.js';

// Re-exported from engine/namingConfig.js rather than duplicated as a local
// literal. NAMING_CONFIG/BASE_TEMPLATE used to live only in ui/steps/
// naming.js (a module that touches `document`), which is why this file
// used to hand-copy them -- nothing asserted the copy stayed byte-identical
// with the original. They now live in engine/namingConfig.js, an engine-layer
// leaf module with no DOM/window access, so this file (and the app) can
// import the one real definition instead of keeping a second copy in sync
// by hand.
export { NAMING_CONFIG, BASE_TEMPLATE } from '../src/engine/namingConfig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kbDir = path.join(here, '..', 'kb');

export function readKbJson(stem) {
  return JSON.parse(readFileSync(path.join(kbDir, `${stem}.json`), 'utf-8'));
}

/** shapeAppKb() over every REAL web/kb/*.json file -- the exact KB the app
 * itself boots into, not a synthetic stand-in. Globs web/kb/*.json the same
 * way tools/build_single_file.py's _load_kb() does, rather than hardcoding
 * the current set of KB stems, so a newly added pack is automatically
 * covered here too instead of silently missing from every test that uses
 * this fixture until someone remembers to add it by hand. */
export function realKb() {
  const stems = readdirSync(kbDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
  const kb = {};
  for (const stem of stems) {
    kb[stem] = readKbJson(stem);
  }
  return shapeAppKb(kb);
}
