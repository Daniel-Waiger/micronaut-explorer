// The Overview step: the shareable study diagram + the deterministic,
// no-LLM textual walkthrough (engine/studydoc.js -- one document model,
// three renderers: this HTML tree, the Markdown export, and the mermaid
// diagram embedded inside it). Last in main.js's steps array -- everything
// it shows is a READ over the other steps' data, never a place new facts
// are entered.
//
// The study map at the top is a self-drawn inline SVG (buildDiagramSvg
// below, over engine/render/svgDiagram.js's pure layout) -- no diagramming
// library, since the app is one self-contained file with zero npm deps and
// a strict no-external-asset rule (bundling mermaid would also blow the
// build's 2 MB size gate). The Markdown export additionally embeds a
// ```mermaid block, the exact-branching form GitHub/Notion/the Artifact
// viewer render natively; the in-app SVG is the at-a-glance visual. Both are
// renderers over the one studydoc model, so they cannot disagree.
//
// No advice panel here, matching study.js's own reasoning: every advisor
// rule keys on a per-assay fact already shown on Describe/Design/Naming;
// this step summarizes, it does not re-surface guidance a second time.

import { buildStudyDocument } from '../../engine/studydoc.js';
import { renderMarkdown } from '../../engine/render/markdown.js';
import { renderCsv } from '../../engine/render/csv.js';
import { renderJson } from '../../engine/render/json.js';
import { renderBenchCard } from '../../engine/render/benchcard.js';
import { checkConformance } from '../../engine/conformance.js';
import { buildExperimentMap } from '../../engine/experimentMap.js';
import { decisionTriage } from '../../engine/decisionTriage.js';
import { renderLlmPrompt } from '../../engine/render/llmprompt.js';
import { copyToClipboard } from '../clipboard.js';
import { buildDiagramLayout } from '../../engine/render/svgDiagram.js';
import { downloadTextFile } from '../../core/persist.js';
import { assayById } from '../../core/assay.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Paint the diagram layout (engine/render/svgDiagram.js) into a real SVG
 * element via createElementNS + textContent -- never innerHTML with the
 * user's own study title / labels (shell.js's standing rule). The returned
 * <svg> is self-contained (its own xmlns + viewBox), so serializing it for
 * the download button below yields a valid standalone .svg file.
 */
function buildDiagramSvg(layout) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', String(layout.width));
  svg.setAttribute('height', String(layout.height));
  svg.setAttribute('class', 'study-map-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Study map: the study branching to each measurement and its readout, modality, design, controls, and planned filenames.');

  // One arrowhead marker, referenced by every edge.
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', 'study-map-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS(SVG_NS, 'path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('class', 'study-map-arrowhead');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Edges first, so nodes paint on top of the lines.
  for (const edge of layout.edges) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(edge.x1));
    line.setAttribute('y1', String(edge.y1));
    line.setAttribute('x2', String(edge.x2));
    line.setAttribute('y2', String(edge.y2));
    line.setAttribute('class', 'study-map-edge');
    line.setAttribute('marker-end', 'url(#study-map-arrow)');
    svg.appendChild(line);
  }

  for (const node of layout.nodes) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `study-map-node study-map-node-${node.type}`);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(node.x));
    rect.setAttribute('y', String(node.y));
    rect.setAttribute('width', String(node.w));
    rect.setAttribute('height', String(node.h));
    rect.setAttribute('rx', '8');
    rect.setAttribute('class', 'study-map-box');
    g.appendChild(rect);

    const caption = document.createElementNS(SVG_NS, 'text');
    caption.setAttribute('x', String(node.x + node.w / 2));
    caption.setAttribute('y', String(node.y + 18));
    caption.setAttribute('text-anchor', 'middle');
    caption.setAttribute('class', 'study-map-caption');
    caption.textContent = node.caption;
    g.appendChild(caption);

    const value = document.createElementNS(SVG_NS, 'text');
    value.setAttribute('x', String(node.x + node.w / 2));
    value.setAttribute('y', String(node.y + 36));
    value.setAttribute('text-anchor', 'middle');
    value.setAttribute('class', 'study-map-value');
    value.textContent = node.value;
    g.appendChild(value);

    svg.appendChild(g);
  }

  return svg;
}

function readoutLine(readout) {
  if (readout.state === 'known') return `Readout: ${readout.label}`;
  if (readout.state === 'unrecognized') return `Readout: "${readout.text}" (not recognized yet)`;
  return 'Readout: not answered yet';
}

function designLine(design) {
  const parts = [];
  if (design.groups.length > 0) parts.push(`groups: ${design.groups.join(', ')}`);
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

const REVIEW_DECISION_GROUP_HEADINGS = Object.freeze({
  'study-shape': 'Study-shape decisions',
  'measurement-design': 'Measurement-design decisions',
  'before-acquisition': 'Before acquisition',
  later: 'Can be assigned later',
});

// The fixed execution ladder comes from a specialist-authored KB whose
// historic prose says "assay".  Review is a presentation surface, so adapt
// that one visible term here without rewriting the KB, document shape, or
// persisted `assays` contract.
function reviewLadderText(value) {
  return typeof value === 'string' ? value.replace(/\bassay\b/gi, 'measurement') : '';
}

function reviewMeasurementLabel(label, index) {
  const text = typeof label === 'string' ? label.trim() : '';
  const generated = text.match(/^assay\s+(\d+)$/i);
  if (generated) return `Measurement ${generated[1]}`;
  return text || `Measurement ${index}`;
}

function reviewMapValue(value, fallback = 'Not decided') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function reviewComparisonSummary(comparison) {
  if (comparison?.mode === 'observational') return 'Observational study';
  if (comparison?.mode === 'groups') {
    const groups = Array.isArray(comparison.groups) ? comparison.groups.filter(Boolean) : [];
    return groups.length > 0 ? `Groups: ${groups.join(', ')}` : 'Groups not decided';
  }
  return 'Not decided';
}

function reviewDecisionMeasurementId(decision) {
  const candidate = decision?.measurementId ?? decision?.assayId;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

// The review is a map consumer, not a second map editor or priority engine.
// This intentionally displays values from buildExperimentMap() verbatim and
// makes no state writes while rendering the shared study shape.
function renderReviewExperimentMapSummary(parent, map) {
  const section = document.createElement('section');
  section.className = 'study-map';
  const heading = document.createElement('h2');
  heading.className = 'overview-node-title';
  heading.textContent = 'Study map';
  section.appendChild(heading);

  appendLabeledNode(section, 'overview-node', `Research question: ${reviewMapValue(map.question?.value)}`);
  appendLabeledNode(section, 'overview-node', `System or material: ${reviewMapValue(map.system?.value)}`);
  appendLabeledNode(section, 'overview-node', `Comparison: ${reviewComparisonSummary(map.comparison)}`);
  appendLabeledNode(section, 'overview-node', `Experimental unit: ${reviewMapValue(map.experimentalUnit?.value)}`);

  const measurements = Array.isArray(map.measurements) ? map.measurements : [];
  const list = document.createElement('ul');
  list.className = 'overview-controls-list';
  for (const [index, measurement] of measurements.entries()) {
    const item = document.createElement('li');
    const label = reviewMeasurementLabel(measurement?.label, index + 1);
    const readout = reviewMapValue(measurement?.readout, 'Not decided');
    item.textContent = `${label}: ${readout}`;
    list.appendChild(item);
  }
  if (measurements.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'panel-empty';
    empty.textContent = 'No measurements are defined yet.';
    section.appendChild(empty);
  } else {
    section.appendChild(list);
  }
  parent.appendChild(section);
}

function reviewDecisionText(item) {
  if (item?.source === 'map') {
    const label = reviewMapValue(item.label, 'Review this decision');
    const reason = reviewMapValue(item.reason, 'Needs review.');
    return `${label} — ${reason}`;
  }
  return issueText(item);
}

function renderReviewDecisionGroups(parent, triage, navigateDecision) {
  const section = document.createElement('section');
  section.className = 'conformance';
  const heading = document.createElement('h2');
  heading.className = 'overview-node-title';
  heading.textContent = 'Decisions';
  section.appendChild(heading);

  for (const group of triage.groups) {
    const groupHeading = document.createElement('h3');
    groupHeading.className = 'overview-node-title';
    groupHeading.textContent = REVIEW_DECISION_GROUP_HEADINGS[group.tier];
    section.appendChild(groupHeading);

    if (group.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'panel-empty';
      empty.textContent = 'No decisions in this group.';
      section.appendChild(empty);
      continue;
    }

    const list = document.createElement('ul');
    list.className = 'issues-list';
    for (const item of group.items) {
      const li = document.createElement('li');
      li.className = 'issue issue-' + (item.severity || 'warning');
      const text = reviewDecisionText(item);
      if (item.routeId && typeof navigateDecision === 'function') {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'conformance-issue-link';
        link.textContent = text;
        link.title = `Go to the workspace that owns this decision.`;
        link.addEventListener('click', () => navigateDecision(item));
        li.appendChild(link);
      } else {
        li.textContent = text;
      }
      list.appendChild(li);
    }
    section.appendChild(list);
  }
  parent.appendChild(section);
}

const FIELD_LABELS = {
  date: 'Acquisition date',
  modality: 'Imaging modality',
  exptype: 'Experiment type',
  markers: 'Markers',
  magnification: 'Magnification',
  sample: 'Sample ID',
  group: 'Experimental group',
  biorep: 'Biological replicate',
  techrep: 'Technical replicate',
  biologicalReplicates: 'Biological replicates',
  technicalReplicates: 'Technical replicates',
};

function readableField(field) {
  const key = String(field || '').split('.').pop();
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (!key) return 'Study';
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
}

function issueText(issue) {
  return `${readableField(issue.field)} — ${issue.message || 'Needs review.'}`;
}

function reportIssues(report) {
  const assayIssues = (report.assays || []).flatMap((assay, index) =>
    (assay.issues || []).map((issue) => ({ ...issue, assayLabel: reviewMeasurementLabel(assay.label, index + 1) }))
  );
  const crossAssay = (report.crossAssayIssues || []).map((issue) => ({ ...issue, assayLabel: 'Across measurements' }));
  return [...assayIssues, ...crossAssay];
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
  heading.textContent = 'How to run this study';
  box.appendChild(heading);

  const ol = document.createElement('ol');
  ol.className = 'overview-ladder-list';
  for (const stage of ladder) {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'overview-ladder-title';
    title.textContent = reviewLadderText(stage.title);
    li.appendChild(title);

    const body = document.createElement('p');
    body.className = 'overview-ladder-body';
    body.textContent = reviewLadderText(stage.body);
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
  heading.textContent = 'Notes for this measurement';
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

function renderAssayNode(parent, assay, onDownloadBenchCard) {
  const box = document.createElement('details');
  box.className = 'overview-assay';
  const label = reviewMeasurementLabel(assay.label, assay.index);

  const summary = document.createElement('summary');
  summary.className = 'overview-assay-summary';
  summary.textContent = `Measurement ${assay.index}: ${label} · ${assay.filenames.length} planned filename${assay.filenames.length === 1 ? '' : 's'}`;
  box.appendChild(summary);

  const headerRow = document.createElement('div');
  headerRow.className = 'overview-assay-header';

  const heading = document.createElement('div');
  heading.className = 'overview-assay-title';
  heading.textContent = `Measurement ${assay.index}: ${label}`;
  headerRow.appendChild(heading);

  // Per-assay, not a single study-wide button -- a bench card is a
  // SINGLE-ASSAY document by design (render/benchcard.js's own header), and
  // a multi-assay study has no one obvious "current" assay to default to
  // here the way the Color panel step can (this is a pure read over every
  // assay, not scoped to whichever one is active in the switcher).
  const benchCardBtn = document.createElement('button');
  benchCardBtn.type = 'button';
  benchCardBtn.className = 'copy-button overview-assay-benchcard-btn';
  benchCardBtn.textContent = 'Download bench card (.md)';
  benchCardBtn.addEventListener('click', () => onDownloadBenchCard(assay));
  headerRow.appendChild(benchCardBtn);

  box.appendChild(headerRow);

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
    empty.textContent = 'No names to show -- see the issues in Samples & design.';
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
    title: 'Review',
    render(main, store, { showToast, router } = {}) {
      main.textContent = '';

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Review';
      main.appendChild(heading);

      const explainer = document.createElement('p');
      explainer.className = 'proposals-empty supporting-description';
      explainer.textContent =
        'A deterministic review of this study, built entirely from what you’ve entered on the other steps -- nothing here is LLM-generated.';
      main.appendChild(explainer);

      const doc = buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
      const conformance = checkConformance(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
      const experimentMap = buildExperimentMap(store.get(), { conformance });
      const triage = decisionTriage(experimentMap, conformance);

      function navigateDecision(decision) {
        if (!decision || !decision.routeId || !router || typeof router.navigate !== 'function') return false;
        const measurementId = reviewDecisionMeasurementId(decision);
        if (measurementId) {
          // Decisions contain stable measurement ids, never array indices. A
          // deleted measurement makes an older Review projection inert.
          if (!assayById(store.get(), measurementId)) return false;
          store.patch({ activeAssayId: measurementId });
        }
        return router.navigate(decision.routeId);
      }

      // Every final artifact checks the current store at click time. This
      // avoids exporting stale closure data after a user has changed a field
      // and makes the report's single readiness value the only gate.
      function permitFinalExport() {
        const freshReport = checkConformance(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
        const issues = reportIssues(freshReport);
        if (freshReport.readiness === 'blocked') {
          if (showToast) showToast(`Export blocked: ${freshReport.counts.blocked} blocking issue(s) need correction first.`);
          return false;
        }
        if (freshReport.readiness === 'needs-review') {
          const examples = issues.slice(0, 4).map((issue) => `• ${issue.assayLabel}: ${issueText(issue)}`);
          const remainder = issues.length > examples.length ? `\n• …and ${issues.length - examples.length} more item(s).` : '';
          const message = `This study still needs review:\n${examples.join('\n')}${remainder}\n\nExport this final artifact anyway?`;
          const canConfirm = typeof window !== 'undefined' && typeof window.confirm === 'function';
          if (!canConfirm || !window.confirm(message)) {
            if (showToast) showToast('Export cancelled. Review the listed items before sharing a final artifact.');
            return false;
          }
        }
        return true;
      }

      const exportMenu = document.createElement('details');
      exportMenu.className = 'overview-export-menu';
      const exportSummary = document.createElement('summary');
      exportSummary.className = 'overview-export-summary';
      exportSummary.textContent = 'Export study';
      exportMenu.appendChild(exportSummary);
      const exportActions = document.createElement('div');
      exportActions.className = 'overview-export-actions';
      exportMenu.appendChild(exportActions);

      function addDownloadButton({ label, fallbackName, ext, mime, render, toastMessage }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy-button overview-export-action';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          if (!permitFinalExport()) return;
          const freshDoc = buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
          const filename = `${(freshDoc.study.title || fallbackName).replace(/[^A-Za-z0-9_-]+/g, '-')}.${ext}`;
          downloadTextFile(render(freshDoc), filename, mime);
          if (showToast) showToast(toastMessage);
        });
        exportActions.appendChild(btn);
      }

      addDownloadButton({
        label: 'Markdown (.md)', fallbackName: 'study-overview', ext: 'md', mime: 'text/markdown', render: renderMarkdown,
        toastMessage: 'Downloaded the study overview as Markdown.',
      });
      addDownloadButton({
        label: 'Study map (.svg)', fallbackName: 'study-map', ext: 'svg', mime: 'image/svg+xml',
        render: (freshDoc) => {
          const svg = buildDiagramSvg(buildDiagramLayout(freshDoc));
          const serialized = new XMLSerializer().serializeToString(svg);
          return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
        },
        toastMessage: 'Downloaded the study map as SVG.',
      });
      addDownloadButton({
        label: 'File manifest (.csv)', fallbackName: 'study-manifest', ext: 'csv', mime: 'text/csv', render: renderCsv,
        toastMessage: 'Downloaded the file manifest as CSV.',
      });
      addDownloadButton({
        label: 'Study data (.json)', fallbackName: 'study-overview', ext: 'json', mime: 'application/json', render: renderJson,
        toastMessage: 'Downloaded the study overview as JSON.',
      });
      const secondaryActions = document.createElement('div');
      secondaryActions.className = 'overview-secondary-actions';
      const copyLlmBtn = document.createElement('button');
      copyLlmBtn.type = 'button';
      copyLlmBtn.className = 'copy-button';
      copyLlmBtn.textContent = 'Copy prompt for your own LLM';
      copyLlmBtn.title =
        'Copies an instruction preamble + this study as JSON + suggested questions. Paste it into your own LLM -- nothing is sent from this app.';
      copyLlmBtn.addEventListener('click', async () => {
        const freshDoc = buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
        // Recomputed rather than reusing the render-time triage: the study may
        // have changed since this page rendered, and a prompt naming decisions
        // the researcher has since made is worse than one naming none.
        const freshConformance = checkConformance(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
        const freshTriage = decisionTriage(
          buildExperimentMap(store.get(), { conformance: freshConformance }),
          freshConformance
        );
        const ok = await copyToClipboard(renderLlmPrompt(freshDoc, freshTriage));
        if (showToast) showToast(ok
          ? 'Copied the prompt -- paste it into your own LLM. Nothing was sent from this app.'
          : 'Could not copy automatically -- use Export study → Study data (.json) instead.');
      });
      secondaryActions.appendChild(copyLlmBtn);
      const printBtn = document.createElement('button');
      printBtn.type = 'button';
      printBtn.className = 'copy-button';
      printBtn.textContent = 'Print / Save as PDF';
      printBtn.addEventListener('click', () => {
        if (!permitFinalExport()) return;
        window.print();
      });
      secondaryActions.appendChild(printBtn);

      // The orientation map and the consequence groups are intentionally
      // first: map ordering and tier assignment come from their pure owners,
      // not from this Review surface.
      renderReviewExperimentMapSummary(main, experimentMap);
      renderReviewDecisionGroups(main, triage, navigateDecision);

      // The study diagram: retained alongside the textual Study-map summary.
      // horizontal scroll container keeps a wide (many-assay) map from forcing
      // the whole page to scroll sideways.
      const mapSection = document.createElement('section');
      mapSection.className = 'study-map';
      const mapHeading = document.createElement('h2');
      mapHeading.className = 'overview-node-title';
      mapHeading.textContent = 'Study diagram';
      mapSection.appendChild(mapHeading);
      const mapScroll = document.createElement('div');
      mapScroll.className = 'study-map-scroll';
      mapScroll.appendChild(buildDiagramSvg(buildDiagramLayout(doc)));
      mapSection.appendChild(mapScroll);
      main.appendChild(mapSection);

      if (doc.study.researchQuestion) {
        appendLabeledNode(main, 'overview-node overview-research-question', doc.study.researchQuestion);
      }

      // The conformance gate: ONE "is this study ready?" verdict, composed
      // from checks the individual steps already run (engine/conformance.js).
      // Placed above the per-assay tree so the answer is the first thing
      // read, not something to reconstruct by scrolling every assay.
      const conformanceSection = document.createElement('section');
      conformanceSection.className = `conformance conformance-${conformance.readiness}`;

      const conformanceHeading = document.createElement('h2');
      conformanceHeading.className = 'overview-node-title';
      conformanceHeading.textContent = 'Planner checks';
      conformanceSection.appendChild(conformanceHeading);

      const verdict = document.createElement('div');
      verdict.className = `conformance-verdict conformance-${conformance.readiness}`;
      verdict.textContent = conformance.readiness === 'ready'
        ? 'All planner checks complete'
        : conformance.readiness === 'blocked'
          ? `Blocked: ${conformance.counts.blocked} issue(s) need correction before final export.`
          : `Needs review: ${conformance.counts.needsReview} incomplete or provisional item(s) remain.`;
      conformanceSection.appendChild(verdict);

      const disclaimer = document.createElement('p');
      disclaimer.className = 'panel-empty';
      disclaimer.textContent = 'Planner checks do not validate scientific validity, statistical power, ethics approval, biosafety, or instrument suitability.';
      conformanceSection.appendChild(disclaimer);

      const allConformanceIssues = reportIssues(conformance);
      if (allConformanceIssues.length === 0) {
        const clean = document.createElement('p');
        clean.className = 'panel-empty';
        clean.textContent = 'No issues found at all -- every check this app runs came back clean.';
        conformanceSection.appendChild(clean);
      }
      main.appendChild(conformanceSection);
      main.append(exportMenu, secondaryActions);

      // Rendered ONCE for the whole study -- see engine/studydoc.js's
      // stageNotes comment for why this moved out of the per-assay loop.
      renderLadderNode(main, doc.ladder);

      const tree = document.createElement('div');
      tree.className = 'overview-tree';
      for (const assay of doc.assays) {
        renderAssayNode(tree, assay, (assayForCard) => {
          if (!permitFinalExport()) return;
          // Rebuild the document after the gate, so a card cannot silently
          // download a stale assay snapshot after an intervening edit.
          const freshDoc = buildStudyDocument(store.get(), kb, NAMING_CONFIG, BASE_TEMPLATE);
          const freshAssay = freshDoc.assays.find((candidate) => candidate.id === assayForCard.id) || assayForCard;
          const filename = `${(freshAssay.label || 'bench-card').replace(/[^A-Za-z0-9_-]+/g, '-')}-bench-card.md`;
          downloadTextFile(renderBenchCard(freshAssay), filename, 'text/markdown');
          if (showToast) showToast(`Downloaded the bench card for "${freshAssay.label}".`);
        });
      }
      main.appendChild(tree);
    },
  };
}
