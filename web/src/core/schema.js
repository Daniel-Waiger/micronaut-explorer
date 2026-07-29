// Experiment data model: shape, defaults, and version migration.

export const SCHEMA_VERSION = 1;

const DEFAULT_NAMING_TEMPLATE = '{date}_{exptype}_{sample}_{magnification}_{markers}_{notes}{ext}';

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
      factors: [],
      replicates: null,
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

export function migrate(obj) {
  const version = obj && typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
  if (version === SCHEMA_VERSION) {
    return obj;
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Experiment schema version ${version} is newer than this app supports (current: ${SCHEMA_VERSION}). ` +
        'Please update the app before opening this file.'
    );
  }
  throw new Error(
    `No migration path defined from schema version ${version} to ${SCHEMA_VERSION}.`
  );
}
