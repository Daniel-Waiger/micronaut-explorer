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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { shapeAppKb } from '../src/engine/kbpack.js';

// Duplicated as a local literal rather than imported from ui/steps/
// naming.js, like advisor.test.js's REAL_NAMING_TEMPLATE -- that module
// touches `document` and must stay importable without a DOM.
export const NAMING_CONFIG = {
  template: '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}',
  defaults: {
    date: '1970-01-01',
    modality: 'UNKNOWN',
    exptype: 'UNKNOWN',
    markers: 'UNKNOWN',
    magnification: 'UNKNOWN',
    sample: 'UNKNOWN',
  },
  optionalFields: ['group', 'biorep', 'techrep', 'notes'],
  uppercaseFields: ['modality', 'exptype', 'sample', 'magnification', 'markers', 'group'],
  safeCharPattern: '[^A-Za-z0-9_-]+',
};
export const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';

const here = path.dirname(fileURLToPath(import.meta.url));

export function readKbJson(stem) {
  return JSON.parse(readFileSync(path.join(here, '..', 'kb', `${stem}.json`), 'utf-8'));
}

/** shapeAppKb() over every REAL web/kb/*.json file -- the exact KB the app
 * itself boots into, not a synthetic stand-in. */
export function realKb() {
  return shapeAppKb({
    markers: readKbJson('markers'),
    questions: readKbJson('questions'),
    advisor: readKbJson('advisor'),
    readouts: readKbJson('readouts'),
    controls: readKbJson('controls'),
    stages: readKbJson('stages'),
    spectra: readKbJson('spectra'),
  });
}
