// The Overview step: the shareable study diagram + the deterministic,
// no-LLM textual walkthrough (engine/studydoc.js -- one document model,
// three renderers: this HTML tree, the Markdown export, and the mermaid
// diagram embedded inside it). Last in main.js's steps array -- everything
// it shows is a READ over the other steps' data, never a place new facts
// are entered.
//
// The in-app tree below is plain HTML/CSS -- no diagramming library, since
// the app is one self-contained file with zero npm deps and a strict
// no-external-asset rule, so mermaid cannot render inside it. The polished,
// shareable diagram is the Markdown export's embedded ```mermaid block,
// which GitHub/Notion/the Artifact viewer render natively.
//
// No advice panel here, matching study.js's own reasoning: every advisor
// rule keys on a per-assay fact already shown on Describe/Design/Naming;
// this step summarizes, it does not re-surface guidance a second time.

import { buildStudyDocument } from '../../engine/studydoc.js';
import { renderMarkdown } from '../../engine/render/markdown.js';
import { downloadTextFile } from '../../core/persist.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';

function readoutLine(readout) {
  if (readout.state === 'known') return `Readout: ${readout.label}`;
  if (readout.state === 'unrecognized') return `Readout: "${readout.text}" (not recognized yet)`;
  return 'Readout: not answered yet';
}

function designLine(design) {
  const parts = [];
  if (design.arms.length > 0) parts.push(`arms: ${design.arms.join(', ')}`);
  for (const factor of design.factors) parts.push(`${factor.name}: ${factor.levels.join(', ')}`);
  if (design.biologicalReplicates) parts.push(`${design.biologicalReplicates} bio rep(s)`);
  if (design.technicalReplicates) parts.push(`${design.technicalReplicates} tech rep(s)`);
  const base = parts.length > 0 ? parts.join(' · ') : 'no design axes set yet';
  return `${design.conditionCount} planned row(s) — ${base}`;
}

function appendLabeledNode(parent, className, text) {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

/**
 * The controls sub-tree: THREE(-plus-one)-STATE rendering is mandatory
 * (Decision 5, docs/plans/planner-web-assay-tier.md) -- an empty controls
 * list must never look identical to "nothing to show", since silence there
 * reads as "this assay needs no controls," the most dangerous false
 * negative a controls advisor can produce. `controls.readoutMessage` is the
 * SINGLE resolved string for whichever state applies
 * (engine/studydoc.js's readoutMessageFor) -- read here verbatim, never
 * re-derived, so this can never disagree with render/markdown.js's
 * rendering of the identical fact. An adversarial pass on an earlier
 * version of this commit found exactly that divergence (a recognized
 * readout with zero matching rules read as "not recognized" in one
 * renderer and "no guidance yet" in the other) -- lesson 49/50's failure
 * shape recurring inside the commit that names those lessons as its
 * motivation. This is the structural fix, not a second discipline.
 */
function renderControlsNode(parent, controls) {
  const box = document.createElement('div');
  box.className = 'overview-controls';

  const heading = document.createElement('div');
  heading.className = 'overview-node-title';
  heading.textContent = 'Controls';
  box.appendChild(heading);

  if (controls.panel.length > 0) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'overview-controls-group-label';
    groupLabel.textContent = 'Panel-derived';
    box.appendChild(groupLabel);

    const list = document.createElement('ul');
    list.className = 'overview-controls-list';
    for (const control of controls.panel) {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = control.title;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(` — ${control.why}`));
      list.appendChild(li);
    }
    box.appendChild(list);
  }

  const readoutLabel = document.createElement('div');
  readoutLabel.className = 'overview-controls-group-label';
  readoutLabel.textContent = 'Readout-specific';
  box.appendChild(readoutLabel);

  if (controls.readout.length > 0) {
    const list = document.createElement('ul');
    list.className = 'overview-controls-list';
    for (const control of controls.readout) {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = control.title;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(` — ${control.why}`));
      list.appendChild(li);
    }
    box.appendChild(list);
  } else {
    const empty = document.createElement('p');
    empty.className = 'overview-controls-empty';
    empty.textContent = controls.readoutMessage;
    box.appendChild(empty);
  }

  parent.appendChild(box);
}

/** The fixed 5-stage backbone, rendered ONCE for the whole study -- see engine/studydoc.js's stageNotes comment for why. */
function renderLadderNode(parent, ladder) {
  const box = document.createElement('div');
  box.className = 'overview-ladder';

  const heading = document.createElement('div');
  heading.className = 'overview-node-title';
  heading.textContent = 'How to run this project';
  box.appendChild(heading);

  const ol = document.createElement('ol');
  ol.className = 'overview-ladder-list';
  for (const stage of ladder) {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'overview-ladder-title';
    title.textContent = stage.title;
    li.appendChild(title);

    const body = document.createElement('p');
    body.className = 'overview-ladder-body';
    body.textContent = stage.body;
    li.appendChild(body);

    ol.appendChild(li);
  }
  box.appendChild(ol);
  parent.appendChild(box);
}

/** Per-assay STUDY-SPECIFIC notes only -- omitted entirely when an assay has none, per engine/studydoc.js's stageNotes. */
function renderStageNotesNode(parent, stageNotes) {
  if (stageNotes.length === 0) return;
  const box = document.createElement('div');
  box.className = 'overview-ladder';

  const heading = document.createElement('div');
  heading.className = 'overview-node-title';
  heading.textContent = 'Notes for this assay';
  box.appendChild(heading);

  for (const stage of stageNotes) {
    const title = document.createElement('div');
    title.className = 'overview-ladder-title';
    title.textContent = stage.stageTitle;
    box.appendChild(title);

    const notes = document.createElement('ul');
    notes.className = 'overview-ladder-notes';
    for (const note of stage.notes) {
      const li = document.createElement('li');
      li.textContent = note;
      notes.appendChild(li);
    }
    box.appendChild(notes);
  }
  parent.appendChild(box);
}

function renderAssayNode(parent, assay) {
  const box = document.createElement('div');
  box.className = 'overview-assay';

  const heading = document.createElement('div');
  heading.className = 'overview-assay-title';
  heading.textContent = `Assay ${assay.index}: ${assay.label}`;
  box.appendChild(heading);

  appendLabeledNode(box, 'overview-node', readoutLine(assay.readout));
  appendLabeledNode(box, 'overview-node', `Modality: ${assay.modality || 'not answered yet'}`);
  const specimenBits = [assay.specimen.organism, assay.specimen.sampleType, assay.specimen.preparation].filter(Boolean);
  if (specimenBits.length > 0) {
    appendLabeledNode(box, 'overview-node', `Specimen: ${specimenBits.join(', ')}`);
  }
  appendLabeledNode(box, 'overview-node', designLine(assay.design));
  if (assay.design.issues.length > 0) {
    const issuesList = document.createElement('ul');
    issuesList.className = 'issues-list';
    for (const issue of assay.design.issues) {
      const li = document.createElement('li');
      li.className = 'issue issue-' + issue.severity;
      li.textContent = `${issue.field}: ${issue.message}`;
      issuesList.appendChild(li);
    }
    box.appendChild(issuesList);
  }

  renderControlsNode(box, assay.controls);
  renderStageNotesNode(box, assay.stageNotes);

  const filesHeading = document.createElement('div');
  filesHeading.className = 'overview-node-title';
  filesHeading.textContent = `Planned filenames (${assay.filenames.length})`;
  box.appendChild(filesHeading);
  const filesList = document.createElement('div');
  filesList.className = 'planned-list';
  if (assay.filenames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'planned-empty';
    empty.textContent = 'No names to show -- see the issues in the Design step.';
    filesList.appendChild(empty);
  }
  for (const entry of assay.filenames) {
    const line = document.createElement('code');
    line.className = 'planned-name';
    line.textContent = entry.filename || `(${entry.error})`;
    filesList.appendChild(line);
  }
  box.appendChild(filesList);

  parent.appendChild(box);
}

export function createOverviewStep(kb) {
  return {
    id: 'overview',
    title: 'Overview',
    render(main, store, { showToast } = {}) {
      main.textContent = '';

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Study overview';
      main.appendChild(heading);

      const explainer = document.createElement('p');
      explainer.className = 'proposals-empty';
      explainer.textContent =
        'A deterministic summary of this study, built entirely from what you’ve entered on the other steps -- nothing here is LLM-generated.';
      main.appendChild(explainer);

      const actions = document.createElement('div');
      actions.className = 'overview-actions';

      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'copy-button';
      downloadBtn.textContent = 'Download Markdown (.md)';
      downloadBtn.addEventListener('click', () => {
        const doc = buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
        const filename = `${(doc.study.title || 'study-overview').replace(/[^A-Za-z0-9_-]+/g, '-')}.md`;
        downloadTextFile(renderMarkdown(doc), filename, 'text/markdown');
        if (showToast) showToast('Downloaded the study overview as Markdown.');
      });
      actions.appendChild(downloadBtn);

      const printBtn = document.createElement('button');
      printBtn.type = 'button';
      printBtn.className = 'copy-button';
      printBtn.textContent = 'Print / Save as PDF';
      printBtn.addEventListener('click', () => window.print());
      actions.appendChild(printBtn);

      main.appendChild(actions);

      const doc = buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);

      if (doc.study.researchQuestion) {
        appendLabeledNode(main, 'overview-node overview-research-question', doc.study.researchQuestion);
      }

      if (doc.crossAssayIssues.length > 0) {
        const issuesList = document.createElement('ul');
        issuesList.className = 'issues-list';
        for (const issue of doc.crossAssayIssues) {
          const li = document.createElement('li');
          li.className = 'issue issue-' + issue.severity;
          li.textContent = `${issue.field}: ${issue.message}`;
          issuesList.appendChild(li);
        }
        main.appendChild(issuesList);
      }

      // Rendered ONCE for the whole study -- see engine/studydoc.js's
      // stageNotes comment for why this moved out of the per-assay loop.
      renderLadderNode(main, doc.ladder);

      const tree = document.createElement('div');
      tree.className = 'overview-tree';
      for (const assay of doc.assays) {
        renderAssayNode(tree, assay);
      }
      main.appendChild(tree);
    },
  };
}
