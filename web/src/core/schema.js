// Experiment data model: shape, defaults, and version migration.
//
// v3 introduces the ASSAY TIER: a study (still called Experiment, for
// continuity with everything already written against that name) holds one
// or more assays, each an almost-complete v2 slice
// (specimen/design/panel/acquisition/controls/naming.fields). This exists
// because one experiment could not represent a real study with more than
// one assay -- e.g. a bacterial-viability assay, a macrophage-cytoskeleton
// assay, and a scratch assay in one study, each with its own modality,
// panel, and specimen, sharing only a research question and a test
// article. See core/assay.js's module header for the read/write machinery
// (assayView/scopeWrite) that lets every engine module and every KB path
// stay written against the flat v2 shape forever.

import { emptyAssay, isAssayScopedPath } from './assay.js';
import { shortId } from './ids.js';

export const SCHEMA_VERSION = 3;

// Two-stage name.
//
// Stage 1 -- the BASE, identical for every file WITHIN ONE ASSAY:
//   {date}_{modality}_{exptype}_{markers}_{magnification}
// Stage 2 -- what distinguishes THIS file:
//   {group}_{sample}_{biorep}_{techrep}
// {notes} stays last as trailing free annotation.
//
// Ordering is the sort order a file browser will show forever: date, then
// modality/exptype/panel (so one assay's files cluster), then group, then
// sample, then replicate. {biorep}/{techrep}/{notes} are OPTIONAL -- an
// experiment with no technical replicates (common for SEM/TEM/Raman) omits the
// token entirely rather than padding the name with a placeholder.
//
// {group} is the ARM axis (CTL | OPP) and is a SINGLE token: arms
// are mutually exclusive, so they must never be crossed with each other. It is
// separate from {sample}, the specimen identifier.
//
// With more than one assay, {exptype} is what keeps two assays' filenames
// from colliding (the base name is otherwise assay-scoped, so two assays
// sharing date/modality/markers/magnification produce byte-identical sets
// without it) -- see engine/plan.js's studyNameIssues once the multi-assay
// UI lands.
const DEFAULT_NAMING_TEMPLATE =
  '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}';

export function emptyExperiment() {
  const firstId = shortId();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: null,
      createdAt: null,
      updatedAt: null,
      title: '',
    },
    // What the whole study is trying to answer. Study-level: every assay
    // exists in service of one question, unlike the per-assay design.
    researchQuestion: '',
    narrative: {
      text: '',
      history: [],
    },
    // A SEEDING TEMPLATE for new assays' design.groups, not a live axis --
    // see core/assay.js's module header on why arms live per-assay instead
    // of being composed from a shared study-level axis (a composed axis
    // could never be MISSING from an assay, which would make "flag an
    // assay with no groups" uncomputable).
    armVocabulary: { levels: [] },
    // INVARIANT: length is always >= 1. A study with zero assays is not a
    // study; every consumer (assayView, the UI) may assume at least one.
    assays: [emptyAssay(firstId)],
    activeAssayId: firstId,
    naming: {
      template: DEFAULT_NAMING_TEMPLATE,
      plannedNames: [],
    },
    provenance: {
      slots: {},
      unanswered: [],
      skipped: [],
    },
    derived: {},
    interview: {
      turns: [],
      currentStep: null,
    },
    conformance: {
      checks: [],
      status: 'unknown',
    },
  };
}

/**
 * v1 -> v2: the design gained a separate arm axis and split its single
 * replicate count into biological + technical.
 *
 * `design.replicates` becomes `biologicalReplicates` -- that is what it always
 * meant (the v1 UI labelled it "Biological replicates"). `factors` is left
 * ALONE and `groups.levels` starts empty: a v1 user who expressed their arms
 * as a factor may well have meant it as a crossing factor, and silently
 * promoting factors[0] to the arm axis would reshape their design without
 * asking. Leaving it lets them move it deliberately.
 */
function migrateV1toV2(obj) {
  const design = obj.design || {};
  const { replicates, ...restOfDesign } = design;
  return {
    ...obj,
    schemaVersion: 2,
    design: {
      groups: { levels: [] },
      factors: [],
      ...restOfDesign,
      biologicalReplicates:
        design.biologicalReplicates !== undefined
          ? design.biologicalReplicates
          : (replicates ?? null),
      technicalReplicates:
        design.technicalReplicates !== undefined ? design.technicalReplicates : null,
    },
  };
}

// Deterministic, not shortId() -- a migration must be reproducible: the
// same v2 input always produces the same v3 output, byte for byte, which
// is what lets a test assert `migrated.assays[0].id === V2_TO_V3_ASSAY_ID`
// rather than merely `typeof id === 'string'`. emptyExperiment() above
// still uses shortId() for brand-new experiments, where two independently
// created assays not colliding is the actual requirement.
const V2_TO_V3_ASSAY_ID = 'assay1';

/**
 * v2 -> v3: the experiment becomes a study with an assay tier (see the
 * module header, and core/assay.js).
 *
 * Every v2 experiment IS exactly one assay, so its whole per-assay slice
 * (specimen/design/panel/acquisition/controls/naming.fields) is hoisted
 * into assays[0] VERBATIM -- a relocation, not a reinterpretation. Nothing
 * is dropped, nothing invented.
 *
 * design.groups is NOT promoted to armVocabulary. The vocabulary is a
 * seeding template for FUTURE assays; the v2 user's arms are a fact about
 * the assay they actually ran, and copying them upward would assert that
 * every future assay shares them -- the same "reshape their design without
 * asking" mistake migrateV1toV2 already refused to make with `factors`.
 *
 * TOTAL: never throws. Every source slice is defaulted, because main.js
 * DISCARDS an experiment whose migration throws, with only a console.error
 * -- a migration bug here would silently delete a user's saved study.
 */
function migrateV2toV3(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const id = V2_TO_V3_ASSAY_ID;
  const base = emptyAssay(id);
  const v2naming = src.naming && typeof src.naming === 'object' ? src.naming : {};

  const assay = {
    ...base,
    label: (src.meta && typeof src.meta.title === 'string' && src.meta.title) || 'Assay 1',
    specimen: { ...base.specimen, ...(src.specimen || {}) },
    design: { ...base.design, ...(src.design || {}) },
    panel: { ...base.panel, ...(src.panel || {}) },
    acquisition: { ...base.acquisition, ...(src.acquisition || {}) },
    controls: { ...base.controls, ...(src.controls || {}) },
    naming: { fields: { ...(v2naming.fields || {}) } },
  };

  // Destructure the hoisted roots OUT of the rest -- a surviving root copy
  // would be a second home for the same fact, and setPath auto-vivifies a
  // missing root on write with no error, so any code still writing to the
  // OLD root would silently land in a phantom object nothing reads.
  const { specimen, design, panel, acquisition, controls, naming, ...rest } = src;

  return {
    ...rest,
    schemaVersion: 3,
    researchQuestion: typeof src.researchQuestion === 'string' ? src.researchQuestion : '',
    armVocabulary: { levels: [] },
    assays: [assay],
    activeAssayId: id,
    naming: {
      template: typeof v2naming.template === 'string' ? v2naming.template : DEFAULT_NAMING_TEMPLATE,
      plannedNames: Array.isArray(v2naming.plannedNames) ? v2naming.plannedNames : [],
    },
    provenance: rescopeProvenance(src.provenance, id),
  };
}

/**
 * Move every v2 provenance slot whose path now lives under an assay to the
 * v3-shaped 'assay:<id>.<path>' key -- exactly what core/assay.js's
 * scopeWrite would have produced had the write happened after migration.
 * Uses core/assay.js's isAssayScopedPath rather than a second copy of that
 * check, so a migrated slot's scoping can never disagree with a live
 * write's scoping -- see that function's own docstring for why a near-miss
 * on this exact duplication is what prompted exporting it.
 *
 * Skipping this is the single easiest way to break the migration
 * invisibly: interview.js looks up a slot by the LITERAL field path, so a
 * modality answer left at the old bare key would never be found again, and
 * the modality question would be re-asked on every reload, forever, with
 * no error anywhere to notice it by.
 */
function rescopeProvenance(provenance, assayId) {
  const src = provenance && typeof provenance === 'object' ? provenance : {};
  const slots = src.slots && typeof src.slots === 'object' ? src.slots : {};
  const next = {};
  for (const [slotPath, slot] of Object.entries(slots)) {
    next[isAssayScopedPath(slotPath) ? `assay:${assayId}.${slotPath}` : slotPath] = slot;
  }
  return {
    slots: next,
    unanswered: Array.isArray(src.unanswered) ? src.unanswered : [],
    skipped: Array.isArray(src.skipped) ? src.skipped : [],
  };
}

const MIGRATIONS = {
  1: migrateV1toV2,
  2: migrateV2toV3,
};

export function migrate(obj) {
  let current = obj;
  let version = obj && typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Experiment schema version ${version} is newer than this app supports (current: ${SCHEMA_VERSION}). ` +
        'Please update the app before opening this file.'
    );
  }

  // Apply migrations in sequence, so a v1 file still loads once v3 exists
  // rather than needing a bespoke v1->v3 step for every future version.
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(
        `No migration path defined from schema version ${version} to ${SCHEMA_VERSION}.`
      );
    }
    current = step(current);
    version = current.schemaVersion;
  }

  return current;
}
