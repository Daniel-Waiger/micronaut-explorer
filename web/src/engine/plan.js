// The planned-filename list: the ONE place a design + naming fields become
// the concrete set of filenames. Pure module: no DOM, no store.
//
// Why this exists as its own module rather than living in either UI step:
// the Design step and the Name builder both have to answer "what will these
// files be called", and two independent implementations of that question is
// exactly the defect class this repo has already shipped once (a display
// column and an embedded filename token disagreeing about the SAME value --
// see docs/cma-lessons.md lesson 49). Both steps import from here.
//
// `config` is passed IN rather than imported so this module stays in the
// engine layer: engine must never import from ui/.

import {
  buildGroupLabel,
  buildSampleId,
  expandConditions,
  formatReplicateToken,
} from './conditions.js';
import { finalizeFields, normalizeFields, renderName } from './naming.js';
import { assayView } from '../core/assay.js';

// The extension every planned name inherits. The planner names files that do
// not exist yet (this app plans, it does not rename -- Micronaut Classic owns
// renaming), so there is no source file to take a suffix from; '.tif' is the
// default finalizeFields would land on anyway for a name with no extension.
const PLAN_SOURCE_NAME = 'experiment.tif';

/**
 * The naming fields to actually render with, after filling gaps from the
 * rest of the experiment.
 *
 * The interview collects modality as `acquisition.modality`, but the filename
 * template's {modality} token reads `naming.fields.modality` -- different
 * paths, so answering the modality question would otherwise leave the
 * filename showing 'UNKNOWN' for something the user has already stated.
 *
 * This is a READ-time fallback, never a write: an explicit naming field
 * always wins, and nothing is copied into the store, so the provenance gate
 * (core/provenance.js) is neither consulted nor bypassed. A user who
 * deliberately types a different modality into the Name builder keeps it.
 */
export function effectiveNamingFields(experiment) {
  const naming = (experiment && experiment.naming) || {};
  const fields = { ...(naming.fields || {}) };
  const acquisition = (experiment && experiment.acquisition) || {};
  if (!fields.modality && acquisition.modality) {
    fields.modality = acquisition.modality;
  }
  return fields;
}

/**
 * Expand an experiment into its full ordered list of planned filenames.
 *
 * Returns one entry per condition row:
 *   { row, groupLabel, filename }            on success
 *   { row, groupLabel: '', filename: null, error }  if the id scheme is broken
 *
 * A design axis OVERRIDES the corresponding manually-typed naming field, but
 * only where the design actually has an opinion. That asymmetry is the whole
 * point: with a design, the arm/replicate columns come from the design and
 * vary per row; with NO design (zero arms, zero factors, no replicates),
 * expandConditions still yields exactly one row and every token falls through
 * to whatever the Name builder's own boxes hold. So the same function serves
 * both the full workflow and the standalone one-off name, with no separate
 * code path to keep in sync.
 */
export function planFilenames(experiment, config) {
  const design = (experiment && experiment.design) || {};
  const namingFields = effectiveNamingFields(experiment);

  return expandConditions(design).map((row) => {
    let groupLabel;
    try {
      groupLabel = design.idScheme
        ? buildSampleId(row, design.idScheme)
        : buildGroupLabel(row, design);
    } catch (err) {
      // A malformed id scheme is already reported by conditionIssues; surface
      // it per-row too rather than throwing, so one bad scheme cannot blank
      // the entire table.
      return { row, groupLabel: '', filename: null, error: err.message };
    }

    const raw = { ...namingFields };
    if (groupLabel) raw.group = groupLabel;
    if (row.bioRep !== null && row.bioRep !== undefined) {
      raw.biorep = formatReplicateToken('B', row.bioRep);
    }
    if (row.techRep !== null && row.techRep !== undefined) {
      raw.techrep = formatReplicateToken('T', row.techRep);
    }

    const finalized = finalizeFields(PLAN_SOURCE_NAME, raw, config);
    return {
      row,
      // Displayed through the SAME casing authority the filename goes
      // through, so a row's group column can never disagree with the token
      // embedded in its own filename (lesson 49).
      groupLabel: groupLabel ? normalizeFields({ group: groupLabel }, config).group : '',
      filename: renderName(finalized, config),
    };
  });
}

// A fat-fingered "Add assay" click cannot hang the browser building an
// unbounded switcher/list -- mirrors conditions.js's MAX_CONDITION_ROWS
// discipline. Not a realistic ceiling; a real study has single-digit to
// low-tens of assays.
export const MAX_STUDY_ROWS = 50;

/**
 * Detect filename collisions ACROSS assays: two assays whose base name
 * (date/modality/exptype/markers/magnification) renders identically would
 * silently overwrite each other's files on disk, even though conditionIssues
 * (which only ever sees ONE assay, via assayView) structurally cannot catch
 * this -- see docs/plans/planner-web-assay-tier.md, Decision 4.
 *
 * Takes the RAW experiment (not an assayView), since cross-assay comparison
 * is the one thing that view deliberately cannot do -- and `baseTemplate`
 * as a parameter for the same reason `config` already is (see this file's
 * header): BASE_TEMPLATE lives in ui/steps/naming.js, and engine/ must never
 * import from ui/.
 *
 * This also organically covers "exptype is required once assays.length > 1"
 * (also Decision 4) without a separate rule: two assays that both leave
 * exptype blank both render the SAME 'UNKNOWN' base name and collide exactly
 * like two assays that typed the same value would.
 *
 * Never throws; a malformed experiment degrades to "as many issues as can be
 * determined," matching conditions.js's conditionIssues discipline.
 */
export function studyNameIssues(experiment, config, baseTemplate) {
  const assays = experiment && Array.isArray(experiment.assays) ? experiment.assays : [];
  const issues = [];

  if (assays.length > MAX_STUDY_ROWS) {
    issues.push({
      field: 'assays',
      message: `Study has ${assays.length} assays, exceeding the cap of ${MAX_STUDY_ROWS}.`,
      severity: 'error',
    });
  }

  // A collision needs at least two assays to compare; with zero or one,
  // there is nothing to collide WITH.
  if (assays.length <= 1) return issues;

  const baseConfig = { ...config, template: baseTemplate };
  const byBaseName = new Map(); // base name -> [assay labels]
  assays.forEach((assay, index) => {
    const view = assayView(experiment, assay.id);
    const finalized = finalizeFields(PLAN_SOURCE_NAME, effectiveNamingFields(view), config);
    const base = renderName(finalized, baseConfig);
    // Same fallback every other assay-list surface uses (ui/shell.js's
    // switcher, ui/steps/study.js's list): a raw shortId would be
    // technically correct but unreadable in an issue message meant for a
    // person, not a debugger.
    const label = (assay && assay.label) || `Assay ${index + 1}`;
    if (!byBaseName.has(base)) byBaseName.set(base, []);
    byBaseName.get(base).push(label);
  });

  for (const [base, labels] of byBaseName) {
    if (labels.length > 1) {
      issues.push({
        field: 'exptype',
        message: `Assays ${labels.join(', ')} all produce the identical base name '${base}' -- give them different experiment types, or every file in one will overwrite the other.`,
        severity: 'error',
      });
    }
  }

  return issues;
}
