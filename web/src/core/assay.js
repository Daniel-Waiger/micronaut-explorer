// The assay tier (schema v3): a study holds many assays, each an almost-
// complete v2 Experiment slice (specimen/design/panel/acquisition/controls/
// naming.fields). This module is the ONLY place that knows assays exist.
//
// Every engine module (predicate.js, conditions.js, plan.js, interview.js,
// validation.js, naming.js) and every KB file (advisor.json, questions.json)
// stays written against the FLAT v2 shape forever. assayView() builds a
// synthetic flat experiment from the active assay so those consumers never
// have to change; scopeWrite() translates a flat-shaped write into the real
// nested location. If a change to this design ever needs a file under
// web/src/engine/ to learn the word "assay", the abstraction has failed.
//
// Why not compose reads from a shared study-level axis (e.g. arms) into
// each assay? Tried and rejected -- see docs/plans (Advisor... the assay
// tier plan), Decision 1. A composed axis can never be MISSING from an
// assay, which makes "flag an assay with no groups" uncomputable. Per-assay
// data, seeded from a study-level VOCABULARY at creation time as a real,
// weak-tagged write, keeps that check possible while still making the
// common case (every assay uses the same arms) a one-click "apply to all".
//
// Pure module: no DOM, no store, no imports at all -- a true leaf.

// The v2 roots that move under each assay. `naming.fields` moves too but is
// handled separately below (naming.template/plannedNames stay study-level,
// so it isn't a whole top-level root).
export const ASSAY_SCOPED_ROOTS = new Set(['specimen', 'design', 'panel', 'acquisition', 'controls']);

// Scalar fields that live DIRECTLY on the assay object rather than inside one
// of the container roots above -- 'label' (commit 2's rename), 'readout'/
// 'readoutText' (reserved on emptyAssay below for commit 3, not yet wired
// into assayView). Without this set, scopeWrite('label', assayId) falls
// through isAssayScopedPath as study-level and writes into a PHANTOM
// experiment.label at the study root -- setPath auto-vivifies a missing root
// on write with no error, exactly the hazard this module's header warns
// about, just for a path shape commit 1 never had to write to. Solved for all
// three scalar fields now so commit 3 does not have to revisit this
// predicate a second time.
export const ASSAY_SCALAR_FIELDS = new Set(['label', 'readout', 'readoutText']);

// Matches the bare container ('naming.fields' itself, e.g. a future bulk
// write) AND any leaf beneath it ('naming.fields.sample'). Missing the bare
// case used to mean scopeWrite(exp, 'naming.fields', id) fell through as
// study-level and landed in a phantom naming.fields object at the study
// root -- exactly the auto-vivify-on-write hazard this module exists to
// prevent, just for the one scoped path that isn't a whole top-level root.
function isNamingFieldPath(path) {
  return typeof path === 'string' && (path === 'naming.fields' || path.startsWith('naming.fields.'));
}

/**
 * True if `path` addresses something that lives on an assay rather than the
 * study. Exported so every caller that needs this predicate -- scopeWrite
 * below, and schema.js's migration-time provenance rescoping -- shares the
 * ONE implementation. Two copies of this exact check once nearly happened
 * (see git history); a KB path's scoping and a migrated slot's scoping
 * disagreeing would be the same two-renderings-of-one-fact defect this
 * project has already shipped twice (lessons 49, 50).
 */
export function isAssayScopedPath(path) {
  const root = typeof path === 'string' ? path.split(/[.[]/)[0] : '';
  return ASSAY_SCOPED_ROOTS.has(root) || ASSAY_SCALAR_FIELDS.has(root) || isNamingFieldPath(path);
}

/** A brand-new assay, empty except for its stable id. Mirrors the v2 slice of emptyExperiment() exactly -- see schema.js. */
export function emptyAssay(id) {
  return {
    id,
    label: '',
    // readout/readoutText and the controls tier that reads them are
    // deliberately NOT wired into assayView below -- commit 1 (this module)
    // ships before web/kb/readouts.json exists. The fields are real schema,
    // just not yet consumed anywhere.
    readout: '',
    readoutText: '',
    specimen: { organism: '', sampleType: '', preparation: '', notes: '' },
    design: {
      groups: { levels: [] },
      factors: [],
      biologicalReplicates: null,
      technicalReplicates: null,
      idScheme: '',
      conditions: [],
    },
    panel: { targets: [], channels: [] },
    acquisition: {
      instrument: '',
      objective: '',
      magnification: '',
      modality: '',
      smallestFeatureNm: null,
      settings: {},
    },
    controls: { positive: [], negative: [], notes: '' },
    naming: { fields: {} },
  };
}

/**
 * The ARRAY INDEX of the assay with this id, or -1. The one place index
 * lookup happens -- every other function in this module and every caller
 * elsewhere should go through this or assayById, never `experiment.assays[n]`
 * with a hand-computed n. A stale/wrong index silently writes into or reads
 * from the wrong assay's data with no error (verified: setPath on an
 * out-of-range array index pads the array with null holes that survive a
 * JSON round-trip).
 */
export function assayIndexById(experiment, assayId) {
  const assays = experiment && Array.isArray(experiment.assays) ? experiment.assays : [];
  return assays.findIndex((a) => a && a.id === assayId);
}

export function assayById(experiment, assayId) {
  const index = assayIndexById(experiment, assayId);
  return index === -1 ? undefined : experiment.assays[index];
}

/** The first assay's id, or undefined for a malformed/empty experiment. Every real experiment has assays.length >= 1 by construction (schema.js), so this is only ever undefined for bad input. */
export function firstAssayId(experiment) {
  const assays = experiment && Array.isArray(experiment.assays) ? experiment.assays : [];
  return assays.length > 0 ? assays[0].id : undefined;
}

/**
 * Project a v3 provenance record down to the slots ONE assay can see, with
 * assay-scoped keys stripped back to their bare v2-shaped form.
 *
 * A v3 slot key is either `assay:<id>.<path>` (written by a scoped field --
 * see scopeWrite) or a bare study-level path (narrative.text, and so on).
 * For the requested assay, a scoped key becomes the bare path
 * interview.js/describe.js already know how to look up; a DIFFERENT assay's
 * scoped key is dropped entirely, not merely left prefixed -- if it were
 * left in under its full key, a study-level bare-path collision could never
 * happen, but neither could interview.js ever find it (it looks up by the
 * bare field path), so keeping it would be dead weight, not a hazard. Still:
 * drop it explicitly rather than relying on that, since "unreachable" and
 * "provably safe" are not the same claim.
 */
function projectProvenance(provenance, assayId) {
  const src = provenance && typeof provenance === 'object' ? provenance : {};
  const slots = src.slots && typeof src.slots === 'object' ? src.slots : {};
  const prefix = `assay:${assayId}.`;
  const next = {};
  for (const [key, slot] of Object.entries(slots)) {
    if (key.startsWith('assay:')) {
      if (key.startsWith(prefix)) next[key.slice(prefix.length)] = slot;
      // else: another assay's slot -- not visible from this view.
    } else {
      next[key] = slot; // study-level, e.g. narrative.text
    }
  }
  return {
    slots: next,
    unanswered: Array.isArray(src.unanswered) ? src.unanswered : [],
    skipped: Array.isArray(src.skipped) ? src.skipped : [],
  };
}

/**
 * Build a SYNTHETIC FLAT experiment: `assayId`'s scoped slices hoisted to
 * the top level, exactly where every v2-shaped consumer already looks --
 * engine/predicate.js, engine/conditions.js, engine/plan.js,
 * engine/interview.js, engine/validation.js, and every web/kb/*.json path.
 *
 * Fields are enumerated explicitly, not spread, matching this codebase's
 * standing discipline (loadQuestions/loadAdvisorRules build whitelists
 * rather than spreading a raw object) -- a future v3 key added to
 * emptyExperiment() without a matching line here is a visible gap in this
 * function, not a silent leak through a spread.
 *
 * `readout`/`readoutText` are wired in as of commit 3 (web/kb/readouts.json,
 * engine/controls.js) -- commit 1's header comment said these were
 * deliberately NOT included yet; they are now, verbatim from the assay, no
 * KB logic here (this module stays a leaf; canonicalization happens in
 * ui/steps/describe.js at answer time, where the readouts KB is available).
 *
 * TOTAL: a malformed experiment or an unknown assayId degrades to an empty
 * assay's shape rather than throwing -- reads must never crash the app.
 * Writing to an unknown assay is a different story; see scopeWrite.
 */
export function assayView(experiment, assayId) {
  const exp = experiment && typeof experiment === 'object' ? experiment : {};
  const assay = assayById(exp, assayId) || emptyAssay(assayId);
  const studyNaming = exp.naming && typeof exp.naming === 'object' ? exp.naming : {};
  const assayNaming = assay.naming && typeof assay.naming === 'object' ? assay.naming : {};

  return {
    schemaVersion: exp.schemaVersion,
    meta: exp.meta,
    researchQuestion: exp.researchQuestion,
    narrative: exp.narrative,
    readout: assay.readout,
    readoutText: assay.readoutText,
    specimen: assay.specimen,
    design: assay.design,
    panel: assay.panel,
    acquisition: assay.acquisition,
    controls: assay.controls,
    naming: { ...studyNaming, fields: assayNaming.fields || {} },
    provenance: projectProvenance(exp.provenance, assayId),
    derived: exp.derived,
    interview: exp.interview,
    conformance: exp.conformance,
  };
}

/**
 * The real write address for a v2-shaped `path`, given which assay is
 * active: `{ path, slotKey }`. `path` is what core/paths.js's setPath
 * actually mutates (index-addressed, since that is all setPath can
 * address); `slotKey` is what provenance keys on (id-addressed, since an
 * array index is not a stable identity across assay deletion/reordering --
 * see the module header on why a composed/index-keyed alternative was
 * rejected).
 *
 * A study-level path (narrative.text, researchQuestion, ...) passes through
 * unchanged in both fields -- most of the experiment does not move.
 *
 * Throws on an unknown assayId. This is a caller-contract violation, not
 * malformed input to degrade gracefully from: every real call site reads
 * assayId from experiment.activeAssayId, which is always a real assay by
 * construction. Writing to a computed index that turns out stale is exactly
 * fact 3's silent-hole bug; failing loudly here is what prevents it.
 */
export function scopeWrite(experiment, path, assayId) {
  if (!isAssayScopedPath(path)) {
    return { path, slotKey: path };
  }
  const index = assayIndexById(experiment, assayId);
  if (index === -1) {
    throw new Error(`scopeWrite: no assay with id '${assayId}' in this experiment`);
  }
  return {
    path: `assays[${index}].${path}`,
    slotKey: `assay:${assayId}.${path}`,
  };
}

/**
 * Build a fresh assay whose arm axis is seeded from the study's vocabulary,
 * tagged 'kb-default' (WEAK) -- see the module header, Decision 1: a
 * composed/shared axis was rejected because it can never be MISSING; a
 * per-assay axis SEEDED from a vocabulary keeps "flag an assay with no
 * groups" computable while still making the common case (every assay uses
 * the same arms) a one-write copy. WEAK is what lets a later real user edit
 * to this assay's arms always win over the seed, never the reverse.
 *
 * Pure: returns the assay plus the ONE provenance entry the caller must
 * also record (this module never touches a store -- see the header). The
 * caller is expected to compose both into one atomic write (e.g. a single
 * store.patch), since a new assay half-written -- present in `assays` but
 * missing its provenance slot -- would let a user edit right after creation
 * be silently misjudged as overwriting nothing when it is actually
 * overwriting an untagged seed.
 */
export function seedAssayFromVocabulary(armVocabulary, id) {
  const assay = emptyAssay(id);
  const levels =
    armVocabulary && Array.isArray(armVocabulary.levels) ? [...armVocabulary.levels] : [];
  assay.design = { ...assay.design, groups: { levels } };
  return {
    assay,
    provenanceSlotKey: `assay:${id}.design.groups`,
    provenanceEntry: { tag: 'kb-default', detail: null },
  };
}

/**
 * Compute the {assays, activeAssayId, provenance} a study would have AFTER
 * removing `assayId`, or null if this is the last assay (refuse rather than
 * produce a zero-assay study -- schema.js's emptyExperiment documents
 * `assays.length >= 1` as an invariant every consumer may assume) or the id
 * is not found.
 *
 * Reassigns activeAssayId ONLY when the removed assay was the active one --
 * to the assay immediately before it in the array, or the new first assay if
 * the removed one was both active and first. Prunes every provenance slot
 * scoped to the removed assay (`assay:<assayId>.*`): left in place, they
 * would sit in provenance.slots forever, orphaned, visible only to someone
 * reading raw JSON -- the same "drop it explicitly, don't rely on
 * unreachable-implies-safe" discipline projectProvenance already documents
 * above for a different case.
 *
 * Pure: never mutates `experiment`; the caller writes the result via
 * store.patch, same as seedAssayFromVocabulary above.
 */
export function removeAssay(experiment, assayId) {
  const assays = experiment && Array.isArray(experiment.assays) ? experiment.assays : [];
  if (assays.length <= 1) return null;
  const index = assayIndexById(experiment, assayId);
  if (index === -1) return null;

  const nextAssays = assays.filter((a) => a.id !== assayId);
  const nextActiveId =
    experiment.activeAssayId === assayId
      ? nextAssays[Math.max(0, index - 1)].id
      : experiment.activeAssayId;

  const prefix = `assay:${assayId}.`;
  const slots =
    experiment.provenance && typeof experiment.provenance.slots === 'object'
      ? experiment.provenance.slots
      : {};
  const nextSlots = {};
  for (const [key, slot] of Object.entries(slots)) {
    if (!key.startsWith(prefix)) nextSlots[key] = slot;
  }

  return {
    assays: nextAssays,
    activeAssayId: nextActiveId,
    provenance: { ...experiment.provenance, slots: nextSlots },
  };
}
