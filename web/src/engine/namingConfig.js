// NAMING_CONFIG / BASE_TEMPLATE: the naming-template constants shared by
// every step and engine module that renders or validates a filename.
//
// Lives in engine/ (not ui/steps/naming.js, where these were originally
// defined) so engine-layer modules -- conformance.js, studydoc.js, plan.js --
// can import them directly instead of only ever receiving them as
// caller-supplied parameters sourced from a UI module. engine/ files must
// have no DOM/window access, and ui/steps/naming.js touches `document`, so
// anything engine-layer needed from it had to move out. This also closes
// the gap where tests/fixtures.js kept a hand-copied, byte-identical
// duplicate of both constants (nothing asserted the two stayed in sync) --
// tests now import this module directly, same as the app does.
//
// Leaf module: import nothing.

// Interim defaults until the P1 knowledge pack supplies a real profile and
// per-lab naming config -- mirrors microscopy_naming_assistant's
// default_config()/default_profile() so behaviour matches Classic today.
//
// Stage 1 (the base name, shared by every file in the experiment) is the
// leading {date}_{modality}_{exptype}_{markers}_{magnification}. Stage 2 is
// what distinguishes THIS file: {group}_{sample}_{biorep}_{techrep}. {notes}
// stays trailing. Kept byte-identical to schema.js's DEFAULT_NAMING_TEMPLATE
// -- see BASE_TEMPLATE below for the split point the Design step uses.
//
// {group}/{biorep}/{techrep}/{notes} are OPTIONAL: an experiment with no
// groups, or no technical replicates (common for SEM/TEM/Raman), omits that
// token entirely rather than padding the name with a placeholder -- see
// engine/naming.js's optionalFields handling.
export const NAMING_CONFIG = {
  template:
    '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}',
  defaults: {
    // R4-02: an unanswered date used to default to the Unix epoch
    // ('1970-01-01'), which rendered into every preview/filename/export as
    // a plausible-looking but entirely fabricated date -- indistinguishable
    // from a real acquisition date typed by a person. 'UNKNOWN' is the same
    // sentinel every other unset field here already uses (modality/exptype/
    // markers/magnification/sample below), so a missing date now reads the
    // same, honest way everywhere this config's output is shown: the
    // filename preview, the measurement registry row (ui/steps/study.js's
    // studyAssayBaseName), issue/conformance text, and every export (CSV/
    // Markdown/JSON), all of which render through finalizeFields/renderName
    // fed by this one object -- see docs/plans/app-review-2026-09-11.md R4-02.
    date: 'UNKNOWN',
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

// Stage 1 on its own: NAMING_CONFIG.template up to (not including) the
// {group} slot, and without {ext}. The Design step renders this ONCE above
// the condition table -- it is the stem every file in the experiment shares
// -- so each row only has to show the part that actually distinguishes it.
// Rendering it through renderName with this template yields no extension
// (fields.ext won't match the tail), which is what we want for a stem.
export const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';
