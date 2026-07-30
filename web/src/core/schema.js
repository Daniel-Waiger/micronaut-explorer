// Experiment data model: shape, defaults, and version migration.

export const SCHEMA_VERSION = 2;

// Two-stage name.
//
// Stage 1 -- the BASE, identical for every file in the experiment:
//   {date}_{modality}_{exptype}_{markers}_{magnification}
// Stage 2 -- what distinguishes THIS file:
//   {group}_{sample}_{biorep}_{techrep}
// {notes} stays last as trailing free annotation.
//
// Ordering is the sort order a file browser will show forever: date, then
// modality/exptype/panel (so one experiment's files cluster), then group, then
// sample, then replicate. {biorep}/{techrep}/{notes} are OPTIONAL -- an
// experiment with no technical replicates (common for SEM/TEM/Raman) omits the
// token entirely rather than padding the name with a placeholder.
//
// {group} is the ARM axis (CT | NAM25MM | NAM50MM) and is a SINGLE token: arms
// are mutually exclusive, so they must never be crossed with each other. It is
// separate from {sample}, the specimen identifier.
const DEFAULT_NAMING_TEMPLATE =
  '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}';

export function emptyExperiment() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: null,
      createdAt: null,
      updatedAt: null,
      title: '',
    },
    narrative: {
      text: '',
      history: [],
    },
    specimen: {
      organism: '',
      sampleType: '',
      preparation: '',
      notes: '',
    },
    design: {
      // The ARM axis: mutually exclusive levels (CT | NAM25MM | NAM50MM).
      // Singular and separate from `factors` on purpose -- expressing arms as
      // two factors is what produced the nonsense 'CT-NAM50MM' (a sample that
      // was somehow both the control AND the 50 mM arm). Arms cross with real
      // factors, but never with themselves.
      groups: { levels: [] },
      // Genuinely CROSSING axes (genotype, timepoint). Cartesian product.
      factors: [],
      // Two independent replicate axes, each nullable: not every experiment
      // has both, and SEM/TEM/Raman often have neither.
      biologicalReplicates: null,
      technicalReplicates: null,
      idScheme: '',
      conditions: [],
    },
    panel: {
      targets: [],
      channels: [],
    },
    acquisition: {
      instrument: '',
      objective: '',
      magnification: '',
      modality: '',
      settings: {},
    },
    controls: {
      positive: [],
      negative: [],
      notes: '',
    },
    naming: {
      template: DEFAULT_NAMING_TEMPLATE,
      fields: {},
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

const MIGRATIONS = {
  1: migrateV1toV2,
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
