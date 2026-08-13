// The Color panel step: a qualitative spectral-spillover advisor over the
// active assay's markers field. Pure read over naming.fields.markers (the
// ONE source of truth for "which fluorophores are in this assay" -- see
// docs/plans/planner-web-color-panel.md, Decision 1; the long-reserved,
// never-built panel.targets/panel.channels stays untouched), reusing
// engine/validation.js's splitMarkers rather than a second tokenizer.
//
// The spectral content in web/kb/spectra.json is Claude-drafted, exactly
// like web/kb/advisor.json's 16 rules -- NOT a placeholder, but not yet
// reviewed by Daniel either. The persistent review banner below is the
// in-app half of that flag (ROADMAP.md's "Parked review" bullet is the
// doc-level half); it is deliberately not dismissible, matching advice.js's
// restraint rather than becoming a one-time toast nobody remembers.
//
// Five-state, never-silent rendering throughout (Decision 5): an empty
// markers field, a fully-resolved panel with zero flagged pairs, and a
// token this app cannot resolve all get their OWN explicit sentence, never
// a blank section that could be misread as "no risk here." A sixth,
// panel-level state ('no-markers-declared', see spectra.js) gets the same
// treatment: the app's own "NONE"/"N/A" sentinel is a declaration, not a
// typo, and must not render through the same path as an unrecognized token.

import { assayView } from '../../core/assay.js';
import { flagPanelOverlaps, resolvePanel } from '../../engine/spectra.js';
import { createAdvicePanel } from '../advice.js';

const STATE_LABELS = {
  unrecognized: 'Not recognized',
  'ambiguous-family': 'Which variant?',
  'no-intrinsic-spectrum': 'No intrinsic spectrum',
  'spectrum-unavailable': 'Spectrum not yet available',
  known: 'Known',
};

function stateSentence(entry) {
  switch (entry.state) {
    case 'unrecognized':
      return `"${entry.token}" isn't a marker this app recognizes yet -- check the spelling on the Naming step.`;
    case 'ambiguous-family':
      return `"${entry.token}" names a multi-color family -- specify which variant (e.g. "${entry.token} Red") to check it for spillover.`;
    case 'no-intrinsic-spectrum':
      return `"${entry.token}" has no spectrum of its own -- spillover depends on which dye it's conjugated to, not the tag itself.`;
    case 'spectrum-unavailable':
      return `"${entry.token}" is a recognized marker, but its spectrum isn't in this app's knowledge pack yet -- an honest gap, not a silent skip.`;
    default:
      return `"${entry.token}" -- excitation ${entry.excitationPeakNm} nm / emission ${entry.emissionPeakNm} nm.`;
  }
}

function appendRow(list, entry) {
  const row = document.createElement('div');
  row.className = `panel-row panel-row-${entry.state}`;

  const stateLabel = document.createElement('span');
  stateLabel.className = 'panel-state';
  stateLabel.textContent = STATE_LABELS[entry.state] || entry.state;
  row.appendChild(stateLabel);

  const text = document.createElement('span');
  text.className = 'panel-row-text';
  text.textContent = stateSentence(entry);
  row.appendChild(text);

  if (entry.state === 'known') {
    const badge = document.createElement('span');
    badge.className = 'panel-badge';
    badge.title = 'Spectral value drafted by Claude from common published references -- not yet reviewed by a microscopy specialist.';
    badge.textContent = entry.reviewStatus === 'claude-drafted' ? 'unreviewed' : entry.reviewStatus;
    row.appendChild(badge);
  }

  list.appendChild(row);
}

export function createPanelStep(kb) {
  return {
    id: 'panel',
    title: 'Color panel',
    render(main, store, { advisor } = {}) {
      main.textContent = '';

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Color panel';
      main.appendChild(heading);

      const explainer = document.createElement('p');
      explainer.className = 'proposals-empty';
      explainer.textContent =
        'A qualitative check for spectral spillover across this assay’s fluorophores -- excitation/emission peak proximity only, not a spectral-overlap integral.';
      main.appendChild(explainer);

      const banner = document.createElement('div');
      banner.className = 'panel-review-banner';
      banner.textContent =
        'Spectral values below are drafted by Claude from common published references and have not yet been reviewed by a microscopy specialist -- treat exact peak numbers as approximate until reviewed.';
      main.appendChild(banner);

      // Commit 1 of the assay tier: caching activeAssayId once here is only
      // safe because the active assay never changes for the lifetime of one
      // render -- see naming.js's identical comment; main.js's assay-switch
      // handler forces a full re-render of whichever step is on screen.
      const assayId = store.get().activeAssayId;
      const view = assayView(store.get(), assayId);
      const markersText = (view.naming && view.naming.fields && view.naming.fields.markers) || '';

      const { panelState, entries } = resolvePanel(markersText, kb.index, kb.markersKb, kb.spectra);

      if (panelState === 'unanswered') {
        const empty = document.createElement('p');
        empty.className = 'panel-empty';
        empty.textContent = 'No markers entered yet -- fill in the markers field on the Naming step to see a color panel here.';
        main.appendChild(empty);
      } else if (panelState === 'no-markers-declared') {
        // A DECLARATION ("NONE", "N/A", "unstained", ...), not a typo -- see
        // spectra.js's NO_MARKERS_SENTINELS. Its own sentence, distinct from
        // 'unanswered' (nothing typed yet): the field was answered, and the
        // answer was "there are no fluorophores in this assay."
        const declared = document.createElement('p');
        declared.className = 'panel-empty';
        declared.textContent = 'This assay declares no markers/fluorophores -- nothing for a color panel to check here.';
        main.appendChild(declared);
      } else {
        const list = document.createElement('div');
        list.className = 'panel-list';
        for (const entry of entries) {
          appendRow(list, entry);
        }
        main.appendChild(list);

        const flags = flagPanelOverlaps(entries, kb.overlapRules);

        const flagsHeading = document.createElement('div');
        flagsHeading.className = 'proposals-heading';
        flagsHeading.textContent = 'Spillover flags';
        main.appendChild(flagsHeading);

        if (flags.length > 0) {
          const issuesList = document.createElement('ul');
          issuesList.className = 'issues-list';
          for (const flag of flags) {
            const li = document.createElement('li');
            li.className = 'issue issue-' + flag.severity;
            li.textContent = flag.message;
            issuesList.appendChild(li);
          }
          main.appendChild(issuesList);
        } else {
          const knownCount = entries.filter((e) => e.state === 'known').length;
          const noFlags = document.createElement('p');
          noFlags.className = 'panel-empty';
          noFlags.textContent =
            knownCount > 0
              ? `No spectral-proximity conflicts among ${knownCount} recognized fluorophore(s).`
              : 'No recognized fluorophores with spectral data yet -- see the states above.';
          main.appendChild(noFlags);
        }
      }

      const advicePanel = createAdvicePanel(advisor || [], 'panel');
      main.appendChild(advicePanel.element);
      advicePanel.update(view);
    },
  };
}
