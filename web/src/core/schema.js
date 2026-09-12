// Experiment data model: shape, defaults, and version migration.
//
// v3 introduced the ASSAY TIER; v4 completes the user-facing terminology
// migration from the legacy treatment-axis wording to "groups" in the study vocabulary;
// v5 adds the study-level orientation context; v6 retires that study-level
// vocabulary entirely -- groups are now typed exactly once, per measurement,
// on that measurement's own design (see core/assay.js's module header).
// A study (still called Experiment, for
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
import { shortId, uuid } from './ids.js';
import { canOverwrite } from './provenance.js';

export const SCHEMA_VERSION = 6;

// `origin` is intentionally descriptive rather than a permission or
// provenance mechanism. It answers the UI's ownership question ("is this
// still the shipped example?") without inferring that answer from mutable
// study text. Unknown/missing values from saves made before this field existed
// are normalized to `user`, the conservative choice: old work must never be
// presented as an example just because it resembles one.
export const STUDY_ORIGINS = new Set(['blank', 'example', 'imported', 'draft', 'template', 'user']);

// These values describe the study's comparison structure. They deliberately
// do not duplicate group labels or any other assay-level design field:
// `observational` makes an empty group axis intentional rather than an
// omitted comparison decision.
export const STUDY_COMPARISON_MODES = new Set(['not-decided', 'groups', 'observational']);

const EMPTY_STUDY_CONTEXT = Object.freeze({
  system: '',
  experimentalUnit: '',
  comparisonMode: 'not-decided',
});

function emptyStudyContext() {
  return { ...EMPTY_STUDY_CONTEXT };
}

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
// {group} is the mutually exclusive group axis (CTL | OPP) and is a SINGLE
// token: groups on this axis must never be crossed with each other. It is
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
  // meta.id uses uuid(), NOT shortId(): shortId's collision space is "large
  // but non-zero" (see importValidate.js's sanitizeAssay docstring, which
  // already refuses to invent a fallback id for exactly that reason), and
  // this id is a document identity that must survive an export/import round
  // trip and later key a workspace index -- a collision here silently
  // merges two unrelated studies' history, not just two assays in one
  // in-memory session. uuid() falls back to a Math.random()-seeded v4 shape
  // under file:// (see ids.js), which is still fine for this purpose.
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: uuid(),
      // ISO 8601 strings, never Date objects: persist.js round-trips the
      // whole document through JSON.stringify/parse and tests assert a
      // strict deepEqual across that round trip, which compares
      // prototypes -- a Date survives the stringify but comes back as a
      // string, so storing a Date here would make a freshly created study
      // fail that comparison the very first time it was saved and reloaded.
      createdAt: now,
      updatedAt: now,
      title: '',
      origin: 'blank',
    },
    // What the whole study is trying to answer. Study-level: every assay
    // exists in service of one question, unlike the per-assay design.
    researchQuestion: '',
    // Orientation facts about the whole study. These stay separate from the
    // research question, per-assay specimen, and comparison labels so their
    // ownership remains explicit.
    studyContext: emptyStudyContext(),
    narrative: {
      text: '',
      history: [],
    },
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
 * v1 -> v2: the design gained a separate group axis and split its single
 * replicate count into biological + technical.
 *
 * `design.replicates` becomes `biologicalReplicates` -- that is what it always
 * meant (the v1 UI labelled it "Biological replicates"). `factors` is left
 * ALONE and `groups.levels` starts empty: a v1 user who expressed their groups
 * as a factor may well have meant it as a crossing factor, and silently
 * promoting factors[0] to the group axis would reshape their design without
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
 * design.groups is NOT promoted to the study vocabulary. The vocabulary is a
 * seeding template for FUTURE assays; the v2 user's groups are a fact about
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

/**
 * v3 -> v4: replace the study-level `armVocabulary` field with the canonical
 * `groupVocabulary` name. The per-assay design was already `design.groups`,
 * so this is a terminology-only relocation and cannot change condition
 * expansion. Move the matching provenance slot with it so a migrated value
 * remains reviewable under the exact path the v4 UI writes.
 */
function migrateV3toV4(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const { armVocabulary, ...rest } = src;
  const suppliedVocabulary =
    src.groupVocabulary && typeof src.groupVocabulary === 'object'
      ? src.groupVocabulary
      : armVocabulary;
  const vocabularyLevels =
    suppliedVocabulary && Array.isArray(suppliedVocabulary.levels)
      ? suppliedVocabulary.levels.slice()
      : [];
  const provenance = src.provenance && typeof src.provenance === 'object' ? src.provenance : {};
  const sourceSlots = provenance.slots && typeof provenance.slots === 'object' ? provenance.slots : {};
  const { armVocabulary: legacySlot, ...slotsWithoutLegacyName } = sourceSlots;
  const slots = {
    ...slotsWithoutLegacyName,
    ...(slotsWithoutLegacyName.groupVocabulary === undefined && legacySlot !== undefined
      ? { groupVocabulary: legacySlot }
      : {}),
  };

  return {
    ...rest,
    schemaVersion: 4,
    groupVocabulary: { levels: vocabularyLevels },
    provenance: { ...provenance, slots },
  };
}

/**
 * v4 -> v5: add the explicit study-orientation context. This migration is
 * intentionally additive: legacy saves did not distinguish an unanswered
 * question from an answer embedded in prose, so it must never infer context
 * from narrative text, groups, assay specimen, or example strings.
 */
function migrateV4toV5(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  return {
    ...src,
    schemaVersion: 5,
    studyContext: emptyStudyContext(),
  };
}

/**
 * v5 -> v6: retire the study-level `groupVocabulary` field. Groups are now
 * typed exactly once, per measurement, on that measurement's own Samples &
 * design -- see core/assay.js's module header and ui/steps/design.js. The
 * vocabulary was only ever a SEEDING template for brand-new assays (never a
 * live axis any code read at plan/render time -- see engine/plan.js), so
 * dropping it changes no filename and no planned condition row.
 *
 * Any assay that never got seeded from it (an empty design.groups.levels
 * with no STRONG user edit on record) is seeded now, so a study whose
 * vocabulary WAS its only record of the intended groups does not silently
 * lose them. canOverwrite mirrors the exact refuse-if-STRONG rule
 * core/store.js's setValueAtPath already applies to a live 'kb-default'
 * write -- see provenance.js -- so this migration can never clobber a real
 * user edit, including a deliberately-cleared (STRONG-tagged, empty) axis.
 */
function migrateV5toV6(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const { groupVocabulary, ...rest } = src;
  const vocabLevels =
    groupVocabulary && Array.isArray(groupVocabulary.levels) ? groupVocabulary.levels : [];

  const provenance = src.provenance && typeof src.provenance === 'object' ? src.provenance : {};
  const { groupVocabulary: droppedSlot, ...slots } = provenance.slots && typeof provenance.slots === 'object' ? provenance.slots : {};

  const assays = Array.isArray(src.assays) ? src.assays : [];
  const nextAssays =
    vocabLevels.length === 0
      ? assays
      : assays.map((assay) => {
          const design = assay && typeof assay === 'object' && assay.design && typeof assay.design === 'object' ? assay.design : {};
          const levels = design.groups && Array.isArray(design.groups.levels) ? design.groups.levels : [];
          if (levels.length > 0) return assay;
          const slotKey = `assay:${assay && assay.id}.design.groups`;
          const existingTag = slots[slotKey] && slots[slotKey].tag;
          if (!canOverwrite(existingTag, 'kb-default')) return assay;
          slots[slotKey] = { tag: 'kb-default', detail: null };
          return { ...assay, design: { ...design, groups: { levels: [...vocabLevels] } } };
        });

  return {
    ...rest,
    schemaVersion: 6,
    assays: nextAssays,
    provenance: { ...provenance, slots },
  };
}

const MIGRATIONS = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
};

// v5 saves can have been written by an interrupted or older client. Normalize
// the new additive object at the same boundary that normalizes meta.origin,
// preserving any unrelated current-version data (including future additive
// studyContext keys) instead of replacing the whole saved object.
function normalizeStudyContext(current) {
  const supplied =
    current && current.studyContext && typeof current.studyContext === 'object' && !Array.isArray(current.studyContext)
      ? current.studyContext
      : null;
  const normalized = {
    ...(supplied || {}),
    system: supplied && typeof supplied.system === 'string' ? supplied.system : '',
    experimentalUnit: supplied && typeof supplied.experimentalUnit === 'string' ? supplied.experimentalUnit : '',
    comparisonMode:
      supplied && STUDY_COMPARISON_MODES.has(supplied.comparisonMode)
        ? supplied.comparisonMode
        : EMPTY_STUDY_CONTEXT.comparisonMode,
  };

  const isValid =
    supplied &&
    supplied.system === normalized.system &&
    supplied.experimentalUnit === normalized.experimentalUnit &&
    supplied.comparisonMode === normalized.comparisonMode;
  return isValid ? current : { ...current, studyContext: normalized };
}

// Saved studies from before meta.id existed carry `id: null` (or never had
// the key at all -- emptyExperiment() from before this change always wrote
// `null` explicitly, but a hand-edited or hostile file need not have). Mint
// one at the load boundary rather than in a migration step so that MOVING
// through schema versions and MERELY RE-LOADING an already-current save are
// treated the same way: both are "this document reached the app without a
// real id" and both get exactly one, ever -- and, critically, exactly once:
// re-running migrate() on the already-backfilled result must find a real
// string id already there and stop, or a document's identity would change
// on every load, which defeats the entire point of an id that is supposed
// to key a workspace index or survive an export/import round trip.
//
// This normalizer only ever touches meta.id -- createdAt is deliberately
// left alone. An id is an arbitrary label with no truth value: minting one
// the first time a legacy document is opened costs nothing and is
// indistinguishable from having minted it at creation, because nothing
// about the document's history depended on what the label says. A creation
// date is not a label, it is a CLAIM about the past: stamping "now" onto a
// study a user actually wrote months ago would assert something false about
// it, in the same register importValidate.js already refuses to invent an
// assay id it cannot justify (see sanitizeAssay's docstring) -- some fields
// degrade to a reasonable default and some fields must stay honestly
// unknown. updatedAt likewise needs no backfill here: every save now stamps
// it (see appController.js's withSaveStamp -- persist.js has no clock and
// deliberately knows nothing about document shape), so a document reaching
// this boundary without one is
// either brand new (already stamped by emptyExperiment()) or about to be
// stamped by the very save that reads it back in.
//
// Follows the same idiom as normalizeStudyContext: preserve the original
// reference when the field is already valid, so an already-current,
// already-identified save keeps the no-op identity contract intact.
function normalizeStudyIdentity(current) {
  const meta = current && current.meta && typeof current.meta === 'object' ? current.meta : {};
  if (typeof meta.id === 'string' && meta.id) return current;
  return { ...current, meta: { ...meta, id: uuid() } };
}

// panel.spillover (acknowledged spectral-overlap pairs) was added without a
// schemaVersion bump, so a v6 save written before it existed reaches this
// boundary with `panel: {targets, channels}` and no spillover key at all
// (red-team A2-P2: migrate() is a no-op at v6, and only the IMPORT path
// merged the default). Default it here so every persisted study crosses one
// boundary into the same shape; identity is preserved when nothing needs
// filling.
function normalizePanelSpillover(experiment) {
  if (!experiment || !Array.isArray(experiment.assays)) return experiment;
  let changed = false;
  const assays = experiment.assays.map((assay) => {
    if (!assay || typeof assay !== 'object' || !assay.panel || typeof assay.panel !== 'object') return assay;
    const spillover = assay.panel.spillover;
    if (spillover && typeof spillover === 'object' && Array.isArray(spillover.acknowledged)) return assay;
    changed = true;
    return { ...assay, panel: { ...assay.panel, spillover: { acknowledged: [] } } };
  });
  return changed ? { ...experiment, assays } : experiment;
}

export function migrate(obj) {
  let current = obj;
  let version = obj && typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Experiment schema version ${version} is newer than this app supports (current: ${SCHEMA_VERSION}). ` +
        'Please update the app before opening this file.'
    );
  }

  // Apply migrations in sequence, so a v1 file still loads once v4 exists
  // rather than needing a bespoke v1->v4 step for every future version.
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

  // Saved studies from before the additive meta.origin and studyContext fields
  // are otherwise valid data, so version migration alone cannot normalize
  // them. Do it at the boundary every persisted experiment crosses instead.
  // Each normalizer preserves the original object when its own data is valid,
  // retaining the no-op identity contract for already-valid current saves.
  //
  // normalizeStudyIdentity runs BEFORE the meta.origin block below: that
  // block early-returns as soon as origin is already one of STUDY_ORIGINS,
  // and a legacy save with a valid origin but no id is exactly the common
  // case (every pre-this-change emptyExperiment() wrote `origin: 'blank'`
  // immediately). Running identity normalization after that return would
  // silently skip the backfill for precisely the documents that need it.
  current = normalizeStudyContext(current);
  current = normalizeStudyIdentity(current);
  current = normalizePanelSpillover(current);
  const meta = current && current.meta && typeof current.meta === 'object' ? current.meta : {};
  if (STUDY_ORIGINS.has(meta.origin)) return current;
  return { ...current, meta: { ...meta, origin: 'user' } };
}
