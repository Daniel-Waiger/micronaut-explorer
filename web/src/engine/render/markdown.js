// Renders a study document (engine/studydoc.js) to a Markdown string,
// embedding the mermaid diagram (render/mermaid.js) as a fenced code block.
// This is the deterministic, no-LLM textual walkthrough: idea -> pilot ->
// validate controls -> fix acquisition settings -> advanced modality, per
// assay, built entirely from the SAME model the in-app HTML view renders --
// see studydoc.js's header for why that matters.
//
// Every sentence in the output either restates a parameter the user entered
// (modality, readout, design axes) or an authored KB string (a control's
// `why`, a stage's `body`/`note`) -- nothing here is generated text.
//
// Pure module: no DOM. Takes the studydoc model plus the mermaid renderer.

import { renderMermaid } from './mermaid.js';

function heading(level, text) {
  return `${'#'.repeat(level)} ${text}`;
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function readoutSection(readout) {
  if (readout.state === 'known') return `**Readout:** ${readout.label}`;
  if (readout.state === 'unrecognized') {
    return `**Readout:** "${readout.text}" -- not a readout this app recognizes yet; controls for it are yours to specify.`;
  }
  return '**Readout:** not answered yet.';
}

function designSection(design) {
  const lines = [];
  lines.push(`**Design:** ${design.conditionCount} planned condition row(s).`);
  if (design.arms.length > 0) lines.push(`- Arm (mutually exclusive): ${design.arms.join(', ')}`);
  for (const factor of design.factors) {
    lines.push(`- Crossing factor "${factor.name}": ${factor.levels.join(', ')}`);
  }
  if (design.biologicalReplicates) lines.push(`- Biological replicates: ${design.biologicalReplicates}`);
  if (design.technicalReplicates) lines.push(`- Technical replicates: ${design.technicalReplicates}`);
  if (design.issues.length > 0) {
    lines.push('- **Design issues:**');
    for (const issue of design.issues) lines.push(`  - (${issue.severity}) ${issue.field}: ${issue.message}`);
  }
  return lines.join('\n');
}

/**
 * Controls section: the three(-plus-one)-state rendering is mandatory
 * (Decision 5, docs/plans/planner-web-assay-tier.md) -- an empty list must
 * never render as silence, since silence reads as "this assay needs no
 * controls," the most dangerous false negative a controls advisor can
 * produce. `controls.readoutMessage` is the SINGLE resolved string for
 * whichever state applies (studydoc.js's readoutMessageFor) -- read here
 * verbatim rather than re-derived, so this can never disagree with
 * ui/steps/overview.js's rendering of the identical fact (an adversarial
 * pass on an earlier version of this commit found exactly that divergence).
 */
function controlsSection(controls) {
  const lines = ['**Controls:**'];
  if (controls.panel.length > 0) {
    lines.push('- Panel-derived:');
    for (const c of controls.panel) lines.push(`  - **${c.title}** -- ${c.why}`);
  }
  lines.push('- Readout-specific:');
  if (controls.readout.length > 0) {
    for (const c of controls.readout) lines.push(`  - **${c.title}** -- ${c.why}`);
  } else {
    lines.push(`  - ${controls.readoutMessage}`);
  }
  return lines.join('\n');
}

/** The fixed 5-stage backbone, rendered ONCE for the whole study -- see studydoc.js's stageNotes comment for why. */
function ladderSection(ladder) {
  const lines = [];
  for (const stage of ladder) {
    lines.push(heading(3, stage.title));
    lines.push(stage.body);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Per-assay STUDY-SPECIFIC notes only -- omitted entirely when an assay has none, per studydoc.js's stageNotes. */
function stageNotesSection(stageNotes) {
  if (stageNotes.length === 0) return null;
  const lines = ['**Notes for this assay:**'];
  for (const stage of stageNotes) {
    lines.push(`- ${stage.stageTitle}:`);
    for (const note of stage.notes) lines.push(`  - ${note}`);
  }
  return lines.join('\n');
}

function filenamesSection(filenames) {
  if (filenames.length === 0) return '_No planned filenames yet -- fill in the naming fields on the Naming step._';
  return '```\n' + filenames.map((f) => f.filename || `(${f.error})`).join('\n') + '\n```';
}

/** Render `doc` (buildStudyDocument's output) to a Markdown string. TOTAL: never throws on a well-formed doc. */
export function renderMarkdown(doc) {
  const sections = [];

  sections.push(heading(1, doc.study.title || 'Study overview'));
  sections.push(`_${doc.generatedFrom}_`);
  if (doc.study.researchQuestion) {
    sections.push(heading(2, 'Research question'));
    sections.push(doc.study.researchQuestion);
  }
  if (doc.study.armVocabulary.length > 0) {
    sections.push(`**Study-wide arm vocabulary:** ${doc.study.armVocabulary.join(', ')}`);
  }

  sections.push(heading(2, 'Study diagram'));
  sections.push('```mermaid\n' + renderMermaid(doc) + '\n```');

  if (doc.crossAssayIssues.length > 0) {
    sections.push(heading(2, 'Cross-assay issues'));
    sections.push(bulletList(doc.crossAssayIssues.map((i) => `(${i.severity}) ${i.field}: ${i.message}`)));
  }

  // Rendered ONCE for the whole study, not per assay -- see studydoc.js's
  // stageNotes comment. Assay-specific extras follow inside each assay's
  // own section below.
  sections.push(heading(2, 'How to run this project'));
  sections.push(ladderSection(doc.ladder));

  for (const assay of doc.assays) {
    sections.push(heading(2, `Assay ${assay.index}: ${assay.label}`));
    sections.push(readoutSection(assay.readout));
    sections.push(`**Modality:** ${assay.modality || 'not answered yet'}`);
    const specimenBits = [assay.specimen.organism, assay.specimen.sampleType, assay.specimen.preparation].filter(Boolean);
    if (specimenBits.length > 0) sections.push(`**Specimen:** ${specimenBits.join(', ')}`);

    sections.push(designSection(assay.design));
    sections.push(controlsSection(assay.controls));

    const notes = stageNotesSection(assay.stageNotes);
    if (notes) sections.push(notes);

    sections.push(heading(3, 'Planned filenames'));
    sections.push(filenamesSection(assay.filenames));
  }

  return sections.join('\n\n') + '\n';
}
