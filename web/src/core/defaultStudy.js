// The real starter study a brand-new session opens with: the oregano-plasma-
// coating wound-healing study (Romo-Rico et al.) that motivated the whole
// assay tier -- see docs/plans/planner-web-assay-tier.md. Not an inference
// from a bare research question (decision 3 there explicitly rules that
// out); this is a study the user already fully specified, encoded directly.
//
// Every field this module populates is tagged 'kb-default' (WEAK) in
// provenance, at the exact assay:<id>.<path> slot key scopeWrite would
// produce for a live write -- the same convention core/assay.js's
// seedAssayFromVocabulary already established, so a real user edit to ANY
// of these fields always wins, never the reverse.
//
// Deliberately narrow: only fields that actually drive the app's core
// output (design table + filenames) are seeded --
// specimen.organism/design.groups/design.factors/acquisition.modality/
// naming.fields.{markers,exptype,magnification}. NOT seeded:
// acquisition.instrument/objective/settings (descriptive only, nothing
// downstream reads them) or naming.fields.date/sample (no real value
// exists to put there without inventing one).
//
// Pure: no DOM, no store -- same leaf discipline as core/assay.js.

import { emptyExperiment } from './schema.js';
import { seedAssayFromVocabulary } from './assay.js';
import { setPath } from './paths.js';
import { shortId } from './ids.js';

const RESEARCH_QUESTION =
  'Can RF-PECVD synthesize a stable, hydrophilic oregano-derived plasma polymer (OPP) ' +
  'coating that delivers antibacterial, antioxidant, immunomodulatory, and ' +
  'pro-regenerative benefits for wound healing without cytotoxicity or adverse ' +
  'inflammatory responses?';

// CTL (bare/uncoated) vs OPP (oregano plasma polymer coated) -- the paper's own
// two mutually exclusive groups, using the paper's exact labels.
const GROUP_VOCABULARY = { levels: ['CTL', 'OPP'] };

// One entry per assay. `fields` uses the same bare v2-shaped paths
// assayView/scopeWrite already operate on -- applied directly to the assay
// object via core/paths.js's setPath.
// Each `readout`/`readoutText` pair matches web/kb/readouts.json so the
// seeded study reads as fully answered out of the box (readoutState resolves
// `readoutText` against that vocabulary; `readout` stores the canonical id
// engine/controls.js's rules key on). Without these the example study showed
// "Readout: not answered yet" on every assay -- an incomplete-looking demo.
const ASSAY_SEEDS = [
  {
    label: 'Bacterial viability',
    fields: {
      'specimen.organism': 'Bacteria (P. aeruginosa, S. aureus)',
      readout: 'bacterial-viability',
      readoutText: 'Bacterial viability',
      'design.factors': [{ name: 'species', levels: ['PAERUGINOSA', 'SAUREUS'] }],
      'acquisition.modality': 'confocal',
      // 'PI' alone is deliberately NOT a resolvable alias anywhere in this
      // app (markers.py's own docstring: too ambiguous for even exact-match
      // lookup -- Principal Investigator, the constant, ...), so the seeded
      // study spells out the real BacLight reagent name instead of leaning
      // on an abbreviation the KB refuses to recognize.
      'naming.fields.markers': 'SYTO9-PROPIDIUM IODIDE',
      'naming.fields.exptype': 'VIABILITY',
      'naming.fields.magnification': 'X40',
    },
  },
  {
    label: 'Macrophage cytoskeleton',
    fields: {
      'specimen.organism': 'RAW 264.7 macrophages',
      readout: 'macrophage-cytoskeleton',
      readoutText: 'Macrophage cytoskeleton',
      'design.factors': [],
      'acquisition.modality': 'confocal',
      'naming.fields.markers': 'PHALLOIDIN-DAPI',
      'naming.fields.exptype': 'CYTOSKELETON',
      'naming.fields.magnification': 'X40',
    },
  },
  {
    label: 'Intracellular ROS',
    fields: {
      'specimen.organism': 'RAW 264.7 macrophages',
      readout: 'ros',
      readoutText: 'Intracellular ROS',
      'design.factors': [{ name: 'stimulation', levels: ['UNSTIM', 'LPS'] }],
      'acquisition.modality': 'confocal',
      'naming.fields.markers': 'DCF-DAPI',
      'naming.fields.exptype': 'ROS',
      'naming.fields.magnification': 'X40',
    },
  },
  {
    label: 'Scratch / migration',
    fields: {
      'specimen.organism': 'HFF-1 fibroblasts',
      readout: 'scratch-migration',
      readoutText: 'Scratch / migration',
      'design.factors': [],
      // Not a curated modality option (allowOther covers this) -- Incucyte
      // time-lapse phase contrast is a real but uncurated method; no
      // advisor guidance fires for it, which is correct, not a gap.
      'acquisition.modality': 'live-cell phase contrast',
      'naming.fields.markers': 'NONE',
      'naming.fields.exptype': 'SCRATCH',
      // No magnification seeded: the Incucyte time-lapse setup doesn't map
      // onto a single confocal-style X## objective value, and inventing one
      // would be actively wrong rather than merely incomplete.
    },
  },
];

export function createDefaultStudy() {
  const study = emptyExperiment();
  const provenanceSlots = {};

  const assays = ASSAY_SEEDS.map((seed) => {
    const id = shortId();
    const { assay, provenanceSlotKey, provenanceEntry } = seedAssayFromVocabulary(
      GROUP_VOCABULARY,
      id
    );
    provenanceSlots[provenanceSlotKey] = provenanceEntry;

    assay.label = seed.label;
    for (const [path, value] of Object.entries(seed.fields)) {
      setPath(assay, path, value);
      provenanceSlots[`assay:${id}.${path}`] = { tag: 'kb-default', detail: null };
    }

    return assay;
  });

  return {
    ...study,
    meta: { ...study.meta, origin: 'example' },
    researchQuestion: RESEARCH_QUESTION,
    groupVocabulary: { levels: [...GROUP_VOCABULARY.levels] },
    assays,
    activeAssayId: assays[0].id,
    provenance: {
      ...study.provenance,
      slots: {
        ...study.provenance.slots,
        researchQuestion: { tag: 'kb-default', detail: null },
        groupVocabulary: { tag: 'kb-default', detail: null },
        ...provenanceSlots,
      },
    },
  };
}
