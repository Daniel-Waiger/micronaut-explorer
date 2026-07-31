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
