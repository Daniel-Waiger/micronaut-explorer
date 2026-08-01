// Renders a study document (engine/studydoc.js) to a mermaid flowchart
// SOURCE STRING -- Study branching to every Assay, each Assay branching to
// its readout/modality, design axis, controls, and planned-filename count.
// This is "all the branches" the user asked to visualize: every assay and
// every imaging group in one diagram, sized to what they actually entered.
//
// This module renders TEXT, not a diagram -- no mermaid library is loaded
// (the app is one self-contained file with zero deps, so mermaid cannot run
// inside it). The text is embedded in a ```mermaid fenced block by
// render/markdown.js, where GitHub/Notion/the Artifact viewer render it.
//
// GitHub's mermaid dialect is stricter than some renderers: every label is
// quoted, and quotes/newlines inside a label are escaped rather than passed
// through raw -- see mermaidLabel below.
//
// Pure module: no DOM. Takes the studydoc model, nothing else.

/** Quote and escape one label for a mermaid node/edge. Never throws. */
function mermaidLabel(text) {
  const raw = text === null || text === undefined ? '' : String(text);
  // Collapse newlines (a multi-line narrative or note would otherwise break
  // the diagram's line-oriented syntax) and escape the one character that
  // would end the quoted label early.
  const flat = raw.replace(/\s+/g, ' ').trim().replace(/"/g, "'");
  return `"${flat}"`;
}

/** A safe, unique mermaid node id -- alnum/underscore only, mermaid IDs cannot contain spaces or punctuation. */
function nodeId(...parts) {
  return parts.join('_').replace(/[^A-Za-z0-9_]/g, '_');
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function designSummary(design) {
  const parts = [];
  if (design.arms.length > 0) parts.push(`${design.arms.length} arm(s)`);
  for (const factor of design.factors) {
    parts.push(`${factor.name || 'factor'} × ${factor.levels.length}`);
  }
  if (design.biologicalReplicates) parts.push(`${design.biologicalReplicates} bio rep(s)`);
  if (design.technicalReplicates) parts.push(`${design.technicalReplicates} tech rep(s)`);
  return parts.length > 0 ? parts.join(', ') : 'no design axes set yet';
}

/**
 * Render `doc` (buildStudyDocument's output) to a mermaid flowchart source
 * string. TOTAL: a document with zero assays still renders a valid (if
 * sparse) diagram -- an empty flowchart is not an error, just an empty study.
 */
export function renderMermaid(doc) {
  const lines = ['flowchart TD'];
  const studyTitle = doc.study.title || doc.study.researchQuestion || 'Study';
  lines.push(`  STUDY[${mermaidLabel(truncate(studyTitle, 80))}]`);

  for (const assay of doc.assays) {
    const aId = nodeId('assay', assay.index);
    lines.push(`  STUDY --> ${aId}[${mermaidLabel(assay.label)}]`);

    const readoutId = nodeId(aId, 'readout');
    const readoutText =
      assay.readout.state === 'known'
        ? `Readout: ${assay.readout.label}`
        : assay.readout.state === 'unrecognized'
          ? `Readout: ${assay.readout.text} (unrecognized)`
          : 'Readout: not answered yet';
    lines.push(`  ${aId} --> ${readoutId}(${mermaidLabel(readoutText)})`);

    const modId = nodeId(aId, 'modality');
    lines.push(`  ${aId} --> ${modId}(${mermaidLabel(`Modality: ${assay.modality || 'not answered yet'}`)})`);

    const designId = nodeId(aId, 'design');
    lines.push(`  ${aId} --> ${designId}[${mermaidLabel(designSummary(assay.design))}]`);

    const controlsId = nodeId(aId, 'controls');
    const controlCount = assay.controls.panel.length + assay.controls.readout.length;
    lines.push(`  ${designId} --> ${controlsId}{${mermaidLabel(`${controlCount} control(s)`)}}`);

    const filesId = nodeId(aId, 'files');
    lines.push(`  ${controlsId} --> ${filesId}([${mermaidLabel(`${assay.filenames.length} planned filename(s)`)}])`);
  }

  return lines.join('\n');
}
