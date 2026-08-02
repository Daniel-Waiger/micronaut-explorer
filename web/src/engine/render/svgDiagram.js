// Lays out a study document (engine/studydoc.js) as a diagram MODEL --
// positioned nodes and edges -- for the in-app "study map". This is the
// fourth renderer over the one studydoc model (HTML tree, Markdown, mermaid
// text, and now this), same "one model, thin renderers" discipline as the
// others (see engine/studydoc.js's header): it cannot disagree with them
// because it reads the identical facts.
//
// WHY A MODEL, NOT AN SVG STRING: the mermaid renderer emits text because a
// downstream viewer draws it; this one is drawn by us, in the browser, with
// zero libraries (the app is one self-contained file, no npm deps, and
// bundling mermaid would blow the build's 2 MB size gate). Returning a pure
// {nodes, edges} layout keeps ALL geometry testable here and lets the UI
// layer (ui/steps/overview.js) build real SVG DOM with createElementNS +
// textContent -- never innerHTML with user data, matching shell.js's rule.
//
// SHAPE: it linearizes the mermaid graph into one readable top-down column
// per assay (Study -> each Assay -> Readout -> Modality -> Design ->
// Controls -> Filenames). The mermaid export remains the exact branching
// form; this is the at-a-glance visual, sized to what the user entered.
//
// Pure module: no DOM. Takes the studydoc model, nothing else.

// Geometry. All coordinates are computed here so the UI is a dumb painter.
const PAD = 24;
const NODE_W = 188;
const NODE_H = 48;
const COL_GAP = 22;
const ROW_GAP = 28;
const STUDY_GAP = 44; // extra room between the study row and the assay row for the fan-out edges
const STUDY_MAX_W = 300;

// The five per-assay attribute rows, in top-down order under the assay node.
const ATTR_ROWS = ['readout', 'modality', 'design', 'controls', 'files'];

function clip(text, max) {
  const s = text === null || text === undefined ? '' : String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function summarizeDesign(design) {
  const d = design || {};
  const parts = [];
  if (Array.isArray(d.arms) && d.arms.length > 0) parts.push(`${d.arms.length} arm(s)`);
  for (const factor of Array.isArray(d.factors) ? d.factors : []) {
    parts.push(`${(factor && factor.name) || 'factor'} ×${(factor && factor.levels ? factor.levels.length : 0)}`);
  }
  if (d.biologicalReplicates) parts.push(`${d.biologicalReplicates} bio`);
  if (d.technicalReplicates) parts.push(`${d.technicalReplicates} tech`);
  return parts.length > 0 ? parts.join(', ') : 'no axes set yet';
}

function readoutValue(readout) {
  const r = readout || {};
  if (r.state === 'known') return r.label || 'known';
  if (r.state === 'unrecognized') return `${r.text || '?'} (unrecognized)`;
  return 'not answered yet';
}

/** Caption + value for one attribute row of an assay. */
function attrNodeContent(kind, assay) {
  switch (kind) {
    case 'readout':
      return { caption: 'Readout', value: clip(readoutValue(assay.readout), 22) };
    case 'modality':
      return { caption: 'Modality', value: clip(assay.modality || 'not answered yet', 22) };
    case 'design':
      return { caption: 'Design', value: clip(summarizeDesign(assay.design), 22) };
    case 'controls': {
      const controls = assay.controls || {};
      const n = (Array.isArray(controls.panel) ? controls.panel.length : 0) + (Array.isArray(controls.readout) ? controls.readout.length : 0);
      return { caption: 'Controls', value: `${n} control(s)` };
    }
    case 'files':
      return { caption: 'Filenames', value: `${Array.isArray(assay.filenames) ? assay.filenames.length : 0} planned` };
    default:
      return { caption: '', value: '' };
  }
}

function colX(index) {
  return PAD + index * (NODE_W + COL_GAP);
}

function rowY(assayRowY, rowIndex) {
  return assayRowY + rowIndex * (NODE_H + ROW_GAP);
}

/**
 * Build the diagram layout model for `doc` (buildStudyDocument's output).
 * TOTAL: a document with zero assays yields just the study node -- an empty
 * study is a valid, if sparse, map, never a throw (matching the mermaid
 * renderer's own totality).
 *
 * Returns { width, height, nodes, edges }:
 *   node  = { id, type, x, y, w, h, caption, value }
 *   edge  = { from, to, x1, y1, x2, y2 }
 */
export function buildDiagramLayout(doc) {
  const study = (doc && doc.study) || {};
  const assays = doc && Array.isArray(doc.assays) ? doc.assays : [];
  const cols = assays.length;

  const contentWidth = cols > 0 ? cols * NODE_W + (cols - 1) * COL_GAP : Math.round(NODE_W * 1.4);
  const width = contentWidth + PAD * 2;

  const studyY = PAD;
  const studyW = Math.min(contentWidth, STUDY_MAX_W);
  const studyX = PAD + (contentWidth - studyW) / 2;
  const assayRowY = studyY + NODE_H + STUDY_GAP;

  const nodes = [];
  const edges = [];

  const studyTitle = study.title || study.researchQuestion || 'Study';
  nodes.push({
    id: 'study',
    type: 'study',
    x: studyX,
    y: studyY,
    w: studyW,
    h: NODE_H,
    caption: 'Study',
    value: clip(studyTitle, 46),
  });

  const studyCx = studyX + studyW / 2;
  const studyBottom = studyY + NODE_H;

  assays.forEach((assay, i) => {
    const x = colX(i);
    const cx = x + NODE_W / 2;
    const assayId = `assay-${i}`;

    nodes.push({
      id: assayId,
      type: 'assay',
      x,
      y: rowY(assayRowY, 0),
      w: NODE_W,
      h: NODE_H,
      caption: `Assay ${assay.index != null ? assay.index : i + 1}`,
      value: clip(assay.label || `Assay ${i + 1}`, 22),
    });

    // Study fans out to each assay.
    edges.push({
      from: 'study',
      to: assayId,
      x1: studyCx,
      y1: studyBottom,
      x2: cx,
      y2: rowY(assayRowY, 0),
    });

    // The per-assay attribute chain, one node per row, each linked to the one above.
    let prevId = assayId;
    let prevRow = 0;
    ATTR_ROWS.forEach((kind, r) => {
      const rowIndex = r + 1;
      const { caption, value } = attrNodeContent(kind, assay);
      const nodeId = `${assayId}-${kind}`;
      nodes.push({
        id: nodeId,
        type: kind,
        x,
        y: rowY(assayRowY, rowIndex),
        w: NODE_W,
        h: NODE_H,
        caption,
        value,
      });
      edges.push({
        from: prevId,
        to: nodeId,
        x1: cx,
        y1: rowY(assayRowY, prevRow) + NODE_H,
        x2: cx,
        y2: rowY(assayRowY, rowIndex),
      });
      prevId = nodeId;
      prevRow = rowIndex;
    });
  });

  const height =
    cols > 0 ? rowY(assayRowY, ATTR_ROWS.length) + NODE_H + PAD : studyY + NODE_H + PAD;

  return { width, height, nodes, edges };
}
