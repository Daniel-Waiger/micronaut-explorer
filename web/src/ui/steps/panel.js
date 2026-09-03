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
import { flagPanelOverlaps, resolveMarkerToken, resolvePanel } from '../../engine/spectra.js';
import { wavelengthToColor } from '../../engine/color.js';
import { loadQuestions, phaseQuestions } from '../../engine/interview.js';
import { editTagFor } from '../../core/provenance.js';
import { coerceAnswer } from '../questionControl.js';
import { renderFieldInterview } from '../fieldInterview.js';
import {
  ANTIBODY_CONJUGATION_MODES,
  CONJUGATION_LABELS,
  CONJUGATION_MODES,
  channelSpectralField,
  defaultChannelFilterPair,
  effectiveChannelFilterPair,
  effectiveChannelColor,
  emptyChannel,
  normalizeChannels,
  panelFluorophoreOptions,
  panelFluorophoreWriteValue,
  reorderPanelChannels,
  seedChannelsFromMarkers,
  shiftPanelChannel,
  sortPanelChannelsByEmission,
} from '../../engine/panelAssembly.js';
import { createAdvicePanel } from '../advice.js';
import { fluorophorePickerCreate } from '../fluorophorePicker.js';
import { renderSpectralView, spectralViewCreateState } from '../spectralView.js';
import { appendStepHeading } from '../stepHeading.js';

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
      return `"${entry.token}" isn't a marker this app recognizes yet -- check the spelling on the Data plan step.`;
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
    // Informational only here -- read-only, derived straight from the
    // emission peak (engine/color.js). The editable, overridable color lives
    // on the structured channel below, where there is somewhere to persist
    // an override; this free-text row has no per-token storage of its own.
    const swatch = document.createElement('span');
    swatch.className = 'panel-color-swatch';
    swatch.style.backgroundColor = wavelengthToColor(entry.emissionPeakNm) || 'transparent';
    swatch.title = `Color from ${entry.emissionPeakNm} nm emission peak`;
    row.appendChild(swatch);

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
  const filterCount = channels.filter(
    (c) => typeof c.filterCenterNm === 'number' && typeof c.filterBandwidthNm === 'number'
  ).length;
  return (
    `${channels.length} channel(s), ${filled} with a fluorophore named -- ` +
    (antibodyCount > 0
      ? `${antibodyCount} use an antibody (isotype/secondary-antibody controls will be recommended on Review).`
      : 'none use an antibody.') +
    ` ${filterCount} detection filter(s) entered.`
  );
}

// Native disclosures keep the dense microscopy workflow scan-friendly while
// preserving its complete, keyboard-operable content. All state lives in the
// existing store/render paths below; these elements only group that content.
function createMicroscopySection(title, initiallyOpen = false, tourSection = '') {
  const details = document.createElement('details');
  details.className = 'microscopy-section';
  details.open = initiallyOpen;
  if (tourSection) details.dataset.tourSection = tourSection;
  const summary = document.createElement('summary');
  summary.className = 'microscopy-section-summary';
  summary.textContent = title;
  details.appendChild(summary);
  return details;
}

function activeMeasurementLabel(experiment, assayId) {
  const assays = experiment && Array.isArray(experiment.assays) ? experiment.assays : [];
  const index = assays.findIndex((assay) => assay && assay.id === assayId);
  const assay = index === -1 ? null : assays[index];
  return assay?.label || (index === -1 ? 'Active measurement' : `Measurement ${index + 1}`);
}

// Same question-bank load as ui/steps/describe.js's module-level constant --
// one parse of web/kb/questions.json, shared by both step factories via the
// same `kb` object main.js already passes each of them. See loadQuestions'
// own docstring for the TOTAL/never-throws contract.
export function createPanelStep(kb) {
  const { questions: questionBank, issues: questionIssues } = loadQuestions(kb.questions);
  if (questionIssues.length > 0) {
    console.error('Question bank issues:', questionIssues);
  }
  const fluorophoreOptions = panelFluorophoreOptions(kb.spectra);
  return {
    id: 'panel',
    // Retitled 'Acquisition': this is where
    // acquisition specifics -- modality, instrument, magnification, markers
    // -- get decided, after Project and before Outputs. The id stays
    // 'panel' (URL hash, every render() call site) -- label only.
    title: 'Acquisition',
    render(main, store, { advisor, experience, embedded = false } = {}) {
      // Commit 1 of the assay tier idiom (naming.js/design.js/describe.js
      // all cache this identically): the active assay never changes for the
      // lifetime of one render/paint -- shared by the interview AND the
      // markers-driven panel content, so declared once out here.
      const assayId = store.get().activeAssayId;

      // paint() is the whole step body, re-callable: committing a field-grid
      // answer (notably `markers`) must refresh the color panel below it,
      // and the simplest correct way is to re-render the whole step from the
      // store rather than surgically poke the markers list + spectral view.
      // Field commits are occasional (once per box), so the cost is fine;
      // the structured-channel editor keeps its own granular re-render for
      // per-keystroke channel edits, which never call paint().
      function paint() {
        main.textContent = '';

        appendStepHeading(main, {
          title: 'Acquisition',
          scopeText: `Planning how data will be acquired for: ${activeMeasurementLabel(store.get(), assayId)}.`,
          embedded,
          id: 'measurement-section-acquisition',
        });

        const acquisitionSection = createMicroscopySection('Acquisition', true, 'acquisition');
        const fluorophoresSection = createMicroscopySection('Fluorophores and spillover', false, 'fluorophores');
        const spectralSection = createMicroscopySection('Spectral view', false, 'spectral');
        const assemblySection = createMicroscopySection('Panel assembly', false, 'assembly');
        const guidanceSection = createMicroscopySection('Guidance');
        main.appendChild(acquisitionSection);
        main.appendChild(fluorophoresSection);
        main.appendChild(spectralSection);
        main.appendChild(assemblySection);
        main.appendChild(guidanceSection);

        // Name-builder-style boxes (zen-planner Phase 1 feedback): fill a box
        // and use its explicit confirmation action; leave it empty to skip.
        // The "why" is a hover hint on the box, not a subtitle. onCommit
        // writes STRONG and re-paints the state label plus the panel below.
        const interviewContainer = document.createElement('div');
        acquisitionSection.appendChild(interviewContainer);
        renderFieldInterview(interviewContainer, {
          questions: phaseQuestions(questionBank, assayView(store.get(), assayId), 'microscopy'),
          experience,
          onCommit: (question, raw) => {
            const { path, slotKey } = scopeWrite(store.get(), question.field, assayId);
            const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
            const tag = existingTag ? editTagFor(existingTag) : question.tag || 'user';
            store.setPath(path, coerceAnswer(question, raw), tag, { slotKey });
            paint();
          },
        });

      const explainer = document.createElement('p');
      explainer.className = 'proposals-empty supporting-description';
      explainer.textContent =
        'A qualitative check for spectral spillover across this measurement’s fluorophores -- excitation/emission peak proximity only, not a spectral-overlap integral.';
      fluorophoresSection.appendChild(explainer);

      const banner = document.createElement('div');
      banner.className = 'panel-review-banner';
      banner.textContent =
        'Spectral values below are drafted by Claude from common published references and have not yet been reviewed by a microscopy specialist -- treat exact peak numbers as approximate until reviewed.';
      fluorophoresSection.appendChild(banner);

      // assayId is already cached above (shared with the interview section).
      const view = assayView(store.get(), assayId);
      const markersText = (view.naming && view.naming.fields && view.naming.fields.markers) || '';

      const { panelState, entries } = resolvePanel(markersText, kb.index, kb.markersKb, kb.spectra);

      if (panelState === 'unanswered') {
        const empty = document.createElement('p');
        empty.className = 'panel-empty';
        empty.textContent = 'No markers entered yet -- fill in the markers field on the Data plan step to see a color panel here.';
        fluorophoresSection.appendChild(empty);
      } else if (panelState === 'no-markers-declared') {
        // A DECLARATION ("NONE", "N/A", "unstained", ...), not a typo -- see
        // spectra.js's NO_MARKERS_SENTINELS. Its own sentence, distinct from
        // 'unanswered' (nothing typed yet): the field was answered, and the
        // answer was "there are no fluorophores in this assay."
        const declared = document.createElement('p');
        declared.className = 'panel-empty';
        declared.textContent = 'This measurement declares no markers/fluorophores -- nothing for a color panel to check here.';
        fluorophoresSection.appendChild(declared);
      } else {
        const list = document.createElement('div');
        list.className = 'panel-list';
        for (const entry of entries) {
          appendRow(list, entry);
        }
        fluorophoresSection.appendChild(list);

        const flags = flagPanelOverlaps(entries, kb.overlapRules);

        const flagsHeading = document.createElement('div');
        flagsHeading.className = 'proposals-heading';
        flagsHeading.textContent = 'Spillover flags';
        fluorophoresSection.appendChild(flagsHeading);

        if (flags.length > 0) {
          const issuesList = document.createElement('ul');
          issuesList.className = 'issues-list';
          for (const flag of flags) {
            const li = document.createElement('li');
            li.className = 'issue issue-' + flag.severity;
            li.textContent = flag.message;
            issuesList.appendChild(li);
          }
          fluorophoresSection.appendChild(issuesList);
        } else {
          const knownCount = entries.filter((e) => e.state === 'known').length;
          const noFlags = document.createElement('p');
          noFlags.className = 'panel-empty';
          noFlags.textContent =
            knownCount > 0
              ? `No spectral-proximity conflicts among ${knownCount} recognized fluorophore(s).`
              : 'No recognized fluorophores with spectral data yet -- see the states above.';
          fluorophoresSection.appendChild(noFlags);
        }
      }

      // Curves are intentionally rendered from the same resolved entries as
      // the state rows above. Structured channels take over once present so
      // their user-entered filters can be overlaid; until then the free-text
      // markers remain the one quick-path source.
      const spectralHost = document.createElement('section');
      spectralHost.className = 'spectral-view-host';
      const spectralViewState = spectralViewCreateState();
      spectralSection.appendChild(spectralHost);

      // --- Structured panel assembly (Wave 2A) --------------------------
      const assemblyExplainer = document.createElement('p');
      assemblyExplainer.className = 'panel-empty';
      assemblyExplainer.textContent =
        'Optional: name each channel’s target or feature and how its fluorophore is attached. More precise than the ' +
        'markers field above -- in particular, it is what tells the Review step’s controls whether an antibody is ' +
        'actually involved, so it can recommend an isotype control only when one is warranted. Enter a detection ' +
        'filter as center/bandwidth nm to overlay it above. Drag channel handles or use the arrow buttons to reorder; ' +
        'ordering changes the saved channel list, never a fluorophore’s physical wavelength.';
      assemblySection.appendChild(assemblyExplainer);

      const channelsList = document.createElement('div');
      channelsList.className = 'panel-list';
      const summary = document.createElement('p');
      summary.className = 'panel-empty';
      const controlsRow = document.createElement('div');
      controlsRow.className = 'overview-actions';
      let draggedChannelId = null;

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
        refreshSpectralView();
      }

      function writeChannelsStructure(channels) {
        writeChannels(channels);
        renderChannelsList();
        refreshSpectralView();
      }

      function resolvedChannelEntry(channel) {
        const token = channelSpectralField(channel).trim();
        const resolved = token
          ? resolveMarkerToken(token, kb.index, kb.markersKb, kb.spectra)
          : { token: 'Unnamed channel', canonical: null, state: 'unrecognized' };
        const effectiveFilter = effectiveChannelFilterPair(
          channel,
          resolved.state === 'known' ? resolved.emissionPeakNm : null
        );
        // Same effective-color computation as the channel row's own swatch
        // (appendColorControls) -- the spectral view and the row it came
        // from can never show a channel in two different colors.
        const computedColor = resolved.state === 'known' ? wavelengthToColor(resolved.emissionPeakNm) : null;
        return {
          ...resolved,
          channelId: channel.id,
          filterCenterNm: effectiveFilter ? effectiveFilter.filterCenterNm : null,
          filterBandwidthNm: effectiveFilter ? effectiveFilter.filterBandwidthNm : null,
          color: effectiveChannelColor(channel, computedColor),
        };
      }

      function refreshSpectralView() {
        const channels = currentChannels();
        // The free-text path has no channel to override color on -- the
        // wavelength-derived default (same as its row's read-only swatch)
        // is the only color available, same posture as appendRow's swatch.
        const plotEntries =
          channels.length > 0
            ? channels.map(resolvedChannelEntry)
            : entries.map((entry) => {
                // A known fluorophore gets its filter band overlaid by
                // DEFAULT, from its own emission peak -- the same suggestion
                // defaultChannelFilterPair already computes for a structured
                // channel row (see the "Filters, upfront by default" comment
                // above). Before this, the free-text-only path (no channels
                // built yet) never showed a filter band at all: a user had to
                // open Panel assembly, add a channel, and let its filter
                // inputs populate before any band appeared here -- exactly
                // the "interact with the numbers to pop the filters"
                // complaint this fixes. Read-only, like the color swatch
                // beside it: there is no structured channel to persist an
                // override onto from this free-text row.
                const defaultFilter =
                  entry.state === 'known' ? defaultChannelFilterPair(entry.emissionPeakNm) : null;
                return {
                  ...entry,
                  color: entry.state === 'known' ? wavelengthToColor(entry.emissionPeakNm) : null,
                  filterCenterNm: defaultFilter ? defaultFilter.filterCenterNm : null,
                  filterBandwidthNm: defaultFilter ? defaultFilter.filterBandwidthNm : null,
                };
              });
        renderSpectralView(spectralHost, plotEntries, kb.overlapRules, spectralViewState);
      }

      function channelField(input, className) {
        input.className = className;
        return input;
      }

      function appendChannelRow(channel, index) {
        const channelCard = document.createElement('div');
        channelCard.className = 'panel-channel-card';
        channelCard.dataset.channelId = channel.id;
        channelCard.addEventListener('dragover', (event) => {
          event.preventDefault();
          channelCard.classList.add('panel-channel-drop-target');
        });
        channelCard.addEventListener('dragleave', () => channelCard.classList.remove('panel-channel-drop-target'));
        channelCard.addEventListener('drop', (event) => {
          event.preventDefault();
          channelCard.classList.remove('panel-channel-drop-target');
          const transferred = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
          const sourceId = transferred || draggedChannelId;
          draggedChannelId = null;
          writeChannelsStructure(reorderPanelChannels(currentChannels(), sourceId, channel.id));
        });

        const row = document.createElement('div');
        row.className = 'panel-row panel-channel-main';

        const dragHandle = document.createElement('button');
        dragHandle.type = 'button';
        dragHandle.className = 'panel-channel-drag';
        dragHandle.draggable = true;
        dragHandle.textContent = '↕';
        dragHandle.title = 'Drag to reorder this channel';
        dragHandle.setAttribute('aria-label', `Drag ${channelSpectralField(channel).trim() || 'unnamed channel'} to reorder`);
        dragHandle.addEventListener('dragstart', (event) => {
          draggedChannelId = channel.id;
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', channel.id);
          }
        });
        dragHandle.addEventListener('dragend', () => {
          draggedChannelId = null;
          for (const card of channelsList.querySelectorAll('.panel-channel-drop-target')) {
            card.classList.remove('panel-channel-drop-target');
          }
        });
        row.appendChild(dragHandle);

        // Color, per fluorophore (color-panel patch): a swatch computed from
        // the channel's own resolved emission peak (engine/color.js), with a
        // native color picker to override it and a reset link back to auto.
        // Resolved the SAME way the free-text list above does (spectra.js's
        // resolveMarkerToken) so this channel's default can never disagree
        // with what the Color panel's qualitative check already knows about
        // this fluorophore name.
        const channelSpectralValue = channelSpectralField(channel).trim();
        const channelResolved = channelSpectralValue
          ? resolveMarkerToken(channelSpectralValue, kb.index, kb.markersKb, kb.spectra)
          : null;
        const computedColor =
          channelResolved && channelResolved.state === 'known' ? wavelengthToColor(channelResolved.emissionPeakNm) : null;
        const effectiveColor = effectiveChannelColor(channel, computedColor);
        const isColorOverride = Boolean(channel.color);

        // A fixed-height wrapper, not loose siblings directly in `row`: the
        // row bottom-aligns its children (see .panel-channel-main's CSS
        // comment) so these small controls line up against the FLUOROPHORE
        // PICKER's select baseline, not against the row's own padded height
        // -- centering them on their own private box is what actually lines
        // their visual center up with the plain inputs' center.
        const colorControls = document.createElement('span');
        colorControls.className = 'panel-color-controls';
        row.appendChild(colorControls);

        const colorSwatch = document.createElement('span');
        colorSwatch.className = 'panel-color-swatch';
        colorSwatch.style.backgroundColor = effectiveColor || 'transparent';
        colorControls.appendChild(colorSwatch);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'panel-color-input';
        colorInput.value = effectiveColor || '#808080';
        colorInput.title = isColorOverride
          ? 'Your chosen color'
          : effectiveColor
            ? 'Default color, from this fluorophore’s emission peak -- pick one to override'
            : 'Pick a channel color';
        colorInput.addEventListener('input', () => {
          const next = currentChannels();
          next[index] = { ...next[index], color: colorInput.value };
          writeChannelsData(next);
          colorSwatch.style.backgroundColor = colorInput.value;
        });
        colorInput.addEventListener('change', () => {
          writeChannelsStructure(currentChannels()); // structural: reveals/hides the reset control
        });
        colorControls.appendChild(colorInput);

        if (isColorOverride) {
          const colorResetBtn = document.createElement('button');
          colorResetBtn.type = 'button';
          colorResetBtn.className = 'panel-color-reset';
          colorResetBtn.textContent = 'auto';
          colorResetBtn.title = 'Reset to the color computed from this fluorophore’s emission peak';
          colorResetBtn.addEventListener('click', () => {
            const next = currentChannels();
            next[index] = { ...next[index], color: '' };
            writeChannelsStructure(next);
          });
          colorControls.appendChild(colorResetBtn);
        }

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

        const isTagLigand = channel.conjugation === 'tag-ligand';
        const savedSpectralValue = channelSpectralField(channel);
        const resolvedSpectralValue = savedSpectralValue.trim()
          ? resolveMarkerToken(savedSpectralValue, kb.index, kb.markersKb, kb.spectra)
          : null;
        const libraryValue =
          resolvedSpectralValue && resolvedSpectralValue.state === 'known'
            ? resolvedSpectralValue.variantKey || resolvedSpectralValue.canonical || ''
            : '';
        const dyePicker = fluorophorePickerCreate({
          options: fluorophoreOptions,
          currentValue: savedSpectralValue,
          libraryValue,
          isTagLigand,
          onChange(value, isStructural) {
            // Structural (a discrete library pick, not a custom-name
            // keystroke): the color swatch and the filter defaults below
            // both derive from the fluorophore field, so they need a real
            // re-render to pick up the new selection -- writeChannelsData
            // alone left them showing whatever the row resolved to before
            // this pick (often nothing, for a brand-new channel).
            const next = panelFluorophoreWriteValue(currentChannels(), channel.id, value, {
              resetFilter: isStructural,
            });
            if (isStructural) writeChannelsStructure(next);
            else writeChannelsData(next);
          },
        });
        row.appendChild(dyePicker);

        const moveControls = document.createElement('span');
        moveControls.className = 'panel-channel-moves';
        for (const [label, delta, title] of [
          ['↑', -1, 'Move channel up'],
          ['↓', 1, 'Move channel down'],
        ]) {
          const moveButton = document.createElement('button');
          moveButton.type = 'button';
          moveButton.className = 'assay-pill-delete panel-channel-move';
          moveButton.textContent = label;
          moveButton.title = title;
          moveButton.setAttribute('aria-label', `${title}: ${channelSpectralField(channel).trim() || 'unnamed channel'}`);
          moveButton.disabled = index + delta < 0 || index + delta >= currentChannels().length;
          moveButton.addEventListener('click', () => {
            writeChannelsStructure(shiftPanelChannel(currentChannels(), channel.id, delta));
          });
          moveControls.appendChild(moveButton);
        }
        row.appendChild(moveControls);

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

        const filterRow = document.createElement('div');
        filterRow.className = 'panel-filter-row';

        function filterInput(labelText, placeholder, value, min, max) {
          const label = document.createElement('label');
          label.className = 'panel-filter-field';
          const labelSpan = document.createElement('span');
          labelSpan.textContent = labelText;
          label.appendChild(labelSpan);
          const input = document.createElement('input');
          input.type = 'number';
          input.min = String(min);
          input.max = String(max);
          input.step = '1';
          input.inputMode = 'numeric';
          input.placeholder = placeholder;
          input.value = typeof value === 'number' ? String(value) : '';
          label.appendChild(input);
          filterRow.appendChild(label);
          return input;
        }

        // Filters, upfront by default (color-panel patch): a channel whose
        // fluorophore resolves shows a pre-filled suggestion the moment it
        // resolves (engine/panelAssembly.js's defaultChannelFilterPair) --
        // never an empty pair of boxes waiting on the user to look up their
        // own numbers first. Nothing is written to the store until the user
        // actually edits a field (see writeFilterPair below); a channel with
        // an explicit, already-saved pair always shows exactly that, never
        // the computed default.
        const hasSavedFilterPair = typeof channel.filterCenterNm === 'number' && typeof channel.filterBandwidthNm === 'number';
        const computedFilterDefault =
          !hasSavedFilterPair && channelResolved && channelResolved.state === 'known'
            ? defaultChannelFilterPair(channelResolved.emissionPeakNm)
            : null;
        const displayedCenterNm = hasSavedFilterPair ? channel.filterCenterNm : computedFilterDefault ? computedFilterDefault.filterCenterNm : null;
        const displayedBandwidthNm = hasSavedFilterPair
          ? channel.filterBandwidthNm
          : computedFilterDefault
            ? computedFilterDefault.filterBandwidthNm
            : null;

        const centerInput = filterInput('Filter center (nm)', 'e.g. 525', displayedCenterNm, 300, 900);
        const bandwidthInput = filterInput('Bandwidth (nm)', 'e.g. 50', displayedBandwidthNm, 1, 300);
        const filterHint = document.createElement('span');
        filterHint.className = 'panel-filter-hint';
        filterHint.textContent = computedFilterDefault
          ? 'Suggested from this fluorophore’s emission peak -- edit to match the microscope’s actual detection filter values.'
          : 'Optional; both values are required. Use the microscope’s actual detection filter values.';
        filterRow.appendChild(filterHint);

        function writeFilterPair() {
          const center = centerInput.value.trim() === '' ? null : Number(centerInput.value);
          const bandwidth = bandwidthInput.value.trim() === '' ? null : Number(bandwidthInput.value);
          const valid =
            Number.isFinite(center) &&
            center >= 300 &&
            center <= 900 &&
            Number.isFinite(bandwidth) &&
            bandwidth > 0 &&
            bandwidth <= 300;
          const next = currentChannels();
          next[index] = {
            ...next[index],
            filterCenterNm: valid ? center : null,
            filterBandwidthNm: valid ? bandwidth : null,
          };
          writeChannelsData(next);
        }
        centerInput.addEventListener('input', writeFilterPair);
        bandwidthInput.addEventListener('input', writeFilterPair);

        channelCard.appendChild(row);
        channelCard.appendChild(filterRow);
        channelsList.appendChild(channelCard);
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

        if (channels.length > 1) {
          const sortBtn = document.createElement('button');
          sortBtn.type = 'button';
          sortBtn.className = 'copy-button';
          sortBtn.textContent = 'Order by emission wavelength';
          sortBtn.title = 'Known fluorophores left-to-right by emission peak; unresolved channels stay in their current relative order at the end.';
          sortBtn.addEventListener('click', () => {
            const sorted = sortPanelChannelsByEmission(currentChannels(), (candidate) => {
              const resolved = resolvedChannelEntry(candidate);
              return resolved.state === 'known' ? resolved.emissionPeakNm : null;
            });
            writeChannelsStructure(sorted);
          });
          controlsRow.appendChild(sortBtn);
        }

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

      assemblySection.appendChild(channelsList);
      assemblySection.appendChild(summary);
      assemblySection.appendChild(controlsRow);
      renderChannelsList();
      refreshSpectralView();

      // Collapse only on an EXPLICIT 'frequent' self-report -- an absent/
      // unset experience (today's entire existing userbase; the onboarding
      // gate never fires for a session with prior autosaves) or 'novice'/
      // 'occasional' all keep this panel open, matching createAdvicePanel's
      // own default and every other step's advice panel. See advice.js's
      // createAdvicePanel docstring for why the default itself is `true`.
      const advicePanel = createAdvicePanel(advisor || [], 'panel', { defaultExpanded: experience !== 'frequent' });
      guidanceSection.appendChild(advicePanel.element);
      advicePanel.update(view);
      }

      paint();
    },
  };
}
