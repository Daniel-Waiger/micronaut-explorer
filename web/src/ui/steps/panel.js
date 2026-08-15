// The Color panel step: a qualitative spectral-spillover advisor over the
// active assay's markers field, PLUS (Wave 2A, alpha-pilot-readiness) the
// structured panel assembly editor over the long-reserved panel.channels.
//
// TWO panels, deliberately not merged into one: the free-text markers field
// (naming.fields.markers) stays the quick path and the seed -- one line is
// enough to get a filename and a first spillover read, reusing
// engine/validation.js's splitMarkers rather than a second tokenizer. The
// structured channel editor below it is the altitude fix for what free text
// cannot express: WHICH conjugation mode a channel uses, specifically
// whether an antibody is involved -- see engine/panelAssembly.js's header
// and engine/studydoc.js, which prefers a filled-in panel.channels over the
// free-text derivation once at least one channel exists.
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

import { assayView, scopeWrite } from '../../core/assay.js';
import { kbMarker } from '../../core/kb.js';
import { shortId } from '../../core/ids.js';
import { flagPanelOverlaps, resolvePanel } from '../../engine/spectra.js';
import {
  ANTIBODY_CONJUGATION_MODES,
  CONJUGATION_LABELS,
  CONJUGATION_MODES,
  channelSpectralField,
  emptyChannel,
  normalizeChannels,
  seedChannelsFromMarkers,
} from '../../engine/panelAssembly.js';
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

function summaryText(channels) {
  if (channels.length === 0) return 'No channels yet.';
  const antibodyCount = channels.filter((c) => ANTIBODY_CONJUGATION_MODES.has(c.conjugation)).length;
  const filled = channels.filter((c) => channelSpectralField(c).trim()).length;
  return (
    `${channels.length} channel(s), ${filled} with a fluorophore named -- ` +
    (antibodyCount > 0
      ? `${antibodyCount} use an antibody (isotype/secondary-antibody controls will be recommended on Overview).`
      : 'none use an antibody.')
  );
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

      // --- Structured panel assembly (Wave 2A) --------------------------
      const assemblyHeading = document.createElement('div');
      assemblyHeading.className = 'proposals-heading';
      assemblyHeading.textContent = 'Panel assembly (structured)';
      main.appendChild(assemblyHeading);

      const assemblyExplainer = document.createElement('p');
      assemblyExplainer.className = 'panel-empty';
      assemblyExplainer.textContent =
        'Optional: name each channel’s biological target and how its fluorophore is attached. More precise than the ' +
        'markers field above -- in particular, it is what tells the Overview step’s controls whether an antibody is ' +
        'actually involved, so it can recommend an isotype control only when one is warranted.';
      main.appendChild(assemblyExplainer);

      const channelsList = document.createElement('div');
      channelsList.className = 'panel-list';
      const summary = document.createElement('p');
      summary.className = 'panel-empty';
      const controlsRow = document.createElement('div');
      controlsRow.className = 'overview-actions';

      function currentChannels() {
        const currentPanel = assayView(store.get(), assayId).panel;
        return normalizeChannels(currentPanel && currentPanel.channels);
      }

      function writeChannels(channels) {
        const { path, slotKey } = scopeWrite(store.get(), 'panel.channels', assayId);
        store.setPath(path, channels, 'user', { slotKey });
      }

      function writeChannelsData(channels) {
        writeChannels(channels);
        summary.textContent = summaryText(channels);
      }

      function writeChannelsStructure(channels) {
        writeChannels(channels);
        renderChannelsList();
      }

      function channelField(input, className) {
        input.className = className;
        return input;
      }

      function appendChannelRow(channel, index) {
        const row = document.createElement('div');
        row.className = 'panel-row';

        const targetInput = channelField(document.createElement('input'), 'panel-row-text');
        targetInput.type = 'text';
        targetInput.placeholder = 'Target (e.g. F-actin, Sox2)';
        targetInput.value = channel.target;
        targetInput.addEventListener('input', () => {
          const next = currentChannels();
          next[index] = { ...next[index], target: targetInput.value };
          writeChannelsData(next);
        });
        row.appendChild(targetInput);

        const conjugationSelect = document.createElement('select');
        conjugationSelect.className = 'panel-row-text';
        for (const mode of CONJUGATION_MODES) {
          const option = document.createElement('option');
          option.value = mode;
          option.textContent = CONJUGATION_LABELS[mode] || mode;
          if (mode === channel.conjugation) option.selected = true;
          conjugationSelect.appendChild(option);
        }
        conjugationSelect.addEventListener('change', () => {
          const next = currentChannels();
          next[index] = { ...next[index], conjugation: conjugationSelect.value };
          writeChannelsStructure(next); // structural: the dye/conjugate-dye input below depends on the mode
        });
        row.appendChild(conjugationSelect);

        const dyeInput = channelField(document.createElement('input'), 'panel-row-text');
        dyeInput.type = 'text';
        const isTagLigand = channel.conjugation === 'tag-ligand';
        dyeInput.placeholder = isTagLigand ? 'Ligand dye (e.g. JF549)' : 'Fluorophore (e.g. Alexa Fluor 488)';
        dyeInput.value = isTagLigand ? channel.conjugateDye : channel.fluorophore;
        dyeInput.addEventListener('input', () => {
          const next = currentChannels();
          next[index] = isTagLigand
            ? { ...next[index], conjugateDye: dyeInput.value }
            : { ...next[index], fluorophore: dyeInput.value };
          writeChannelsData(next);
        });
        row.appendChild(dyeInput);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'assay-pill-delete';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove this channel';
        removeBtn.addEventListener('click', () => {
          const next = currentChannels().filter((c) => c.id !== channel.id);
          writeChannelsStructure(next);
        });
        row.appendChild(removeBtn);

        channelsList.appendChild(row);
      }

      function renderChannelsList() {
        channelsList.textContent = '';
        const channels = currentChannels();
        channels.forEach((channel, index) => appendChannelRow(channel, index));
        summary.textContent = summaryText(channels);

        controlsRow.textContent = '';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'copy-button';
        addBtn.textContent = '+ Add channel';
        addBtn.addEventListener('click', () => {
          writeChannelsStructure([...currentChannels(), emptyChannel(shortId())]);
        });
        controlsRow.appendChild(addBtn);

        // Seeding is a ONE-TIME bootstrap (engine/panelAssembly.js's own
        // header): only offered while channels is still empty, so it can
        // never silently overwrite in-progress structured edits.
        if (channels.length === 0 && panelState === 'has-entries') {
          const seedBtn = document.createElement('button');
          seedBtn.type = 'button';
          seedBtn.className = 'copy-button';
          seedBtn.textContent = 'Seed from markers field';
          seedBtn.title = 'Create one channel per marker in the free-text field above, with a best-guess conjugation to correct.';
          seedBtn.addEventListener('click', () => {
            const seeded = seedChannelsFromMarkers({ entries }, kb.markersKb, kbMarker, shortId);
            writeChannelsStructure(seeded);
          });
          controlsRow.appendChild(seedBtn);
        }
      }

      main.appendChild(channelsList);
      main.appendChild(summary);
      main.appendChild(controlsRow);
      renderChannelsList();

      const advicePanel = createAdvicePanel(advisor || [], 'panel');
      main.appendChild(advicePanel.element);
      advicePanel.update(view);
    },
  };
}
