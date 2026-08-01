// The study overview document model: ONE structured model that the HTML
// (in-app), Markdown (export), and mermaid (diagram) renderers all consume,
// built from the same functions every other step already uses --
// assayView, expandConditions/conditionIssues, planFilenames/
// studyNameIssues, selectControls, buildLadder. No engine change was
// needed to build this; that is the same "no engine changes" gate commit
// 1 of the assay tier held, evidence it still holds for a fourth consumer.
//
// WHY ONE MODEL, THREE RENDERERS: three independently-written renderings of
// the same facts is precisely the defect shape this codebase has shipped
// three times already (docs/cma-lessons.md lessons 49/50 -- a display
// column disagreeing with an embedded filename token, a value written under
// one path and read under another). Building the model once and handing it
// to thin renderers means the printed handout and the exported Markdown
// CANNOT disagree, by construction, not by discipline.
//
// DETERMINISM: calling this twice on the same experiment/kb/config yields
// byte-identical output (see web/tests/studydoc.test.js) -- everything here
// is pure computation over already-entered parameters and authored KB
// content. No module reachable from here touches an LLM, a clock, or
// Math.random.
//
// Pure module: no DOM. Imports only other pure engine/core modules.

import { assayView } from '../core/assay.js';
import { conditionIssues, expandConditions } from './conditions.js';
import { effectiveNamingFields, planFilenames, studyNameIssues } from './plan.js';
import { readoutState, selectControls } from './controls.js';
import { buildLadder } from './stages.js';

function assayLabel(assay, index) {
  return (assay && typeof assay.label === 'string' && assay.label.trim()) || `Assay ${index + 1}`;
}

/**
 * Build the full study document. `kb` is the shaped knowledge pack
 * (engine/kbpack.js's shapeAppKb output: readouts, controlRules, stages,
 * stageRules). `config` is the naming config (ui/steps/naming.js's
 * NAMING_CONFIG) and `baseTemplate` its BASE_TEMPLATE -- both passed in
 * rather than imported, same reason engine/plan.js's studyNameIssues
 * already takes them: engine/ must never import from ui/.
 *
 * TOTAL: a malformed experiment degrades to a document with zero assays,
 * never a throw -- this is a read-only report, and a broken report must
 * not be the thing that crashes the app.
 */
export function buildStudyDocument(experiment, kb, config, baseTemplate) {
  const exp = experiment && typeof experiment === 'object' ? experiment : {};
  const assays = Array.isArray(exp.assays) ? exp.assays : [];
  const readouts = (kb && kb.readouts) || {};
  const controlRules = (kb && kb.controlRules) || [];
  const stages = (kb && kb.stages) || [];
  const stageRules = (kb && kb.stageRules) || [];

  const assayDocs = assays.map((assay, index) => {
    const view = assayView(exp, assay.id);
    const design = view.design || {};
    const conditions = expandConditions(design);
    const designIssues = conditionIssues(design);
    const filenamePlan = planFilenames(view, config);

    const rState = readoutState(view.readoutText, readouts);
    const canonical = rState === 'known' ? view.readout : null;
    const readoutLabel = canonical && readouts[canonical] ? readouts[canonical].label : null;

    const firedControls = selectControls(controlRules, view);
    const controls = {
      state: rState,
      readoutText: view.readoutText || '',
      panel: firedControls.filter((r) => r.kind === 'panel').map((r) => ({ id: r.id, title: r.title, why: r.why })),
      readout: firedControls.filter((r) => r.kind === 'readout').map((r) => ({ id: r.id, title: r.title, why: r.why })),
    };

    const ladder = buildLadder(stages, stageRules, view).map((stage) => ({
      id: stage.id,
      title: stage.title,
      body: stage.body,
      notes: stage.notes,
    }));

    return {
      id: assay.id,
      index: index + 1,
      label: assayLabel(assay, index),
      readout: { text: view.readoutText || '', state: rState, canonical, label: readoutLabel },
      modality: (view.acquisition && view.acquisition.modality) || '',
      specimen: {
        organism: (view.specimen && view.specimen.organism) || '',
        sampleType: (view.specimen && view.specimen.sampleType) || '',
        preparation: (view.specimen && view.specimen.preparation) || '',
      },
      design: {
        arms: (design.groups && Array.isArray(design.groups.levels) ? design.groups.levels : []).slice(),
        factors: (Array.isArray(design.factors) ? design.factors : []).map((f) => ({
          name: (f && f.name) || '',
          levels: (f && Array.isArray(f.levels) ? f.levels : []).slice(),
        })),
        biologicalReplicates: design.biologicalReplicates ?? null,
        technicalReplicates: design.technicalReplicates ?? null,
        conditionCount: conditions.length,
        issues: designIssues,
      },
      controls,
      ladder,
      namingFields: effectiveNamingFields(view),
      filenames: filenamePlan.map((entry) => ({
        groupLabel: entry.groupLabel,
        filename: entry.filename,
        error: entry.error || null,
      })),
    };
  });

  return {
    generatedFrom: 'Deterministic report: every fact below comes from parameters you entered or from authored knowledge-pack content -- nothing on this page is LLM-generated.',
    study: {
      title: (exp.meta && exp.meta.title) || '',
      researchQuestion: exp.researchQuestion || '',
      armVocabulary: (exp.armVocabulary && Array.isArray(exp.armVocabulary.levels) ? exp.armVocabulary.levels : []).slice(),
    },
    assays: assayDocs,
    crossAssayIssues: studyNameIssues(exp, config, baseTemplate),
  };
}
