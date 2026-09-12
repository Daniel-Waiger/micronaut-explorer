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
//
// A2c / cross-section refresh (docs/cma-lessons.md lessons 46/49/50; see
// ui/steps/measurement.js's own header comment for the full mechanism):
// render() returns `{ id: 'panel', refresh: paintDerived }`. paint() itself
// (paintShell() + paintDerived()) still runs on the two things that
// legitimately rebuild the interview grid and the channel-row list -- the
// initial render, and this step's OWN field-interview commits -- exactly
// like before this task. A SIBLING section's write instead calls only
// paintDerived(): it recomputes the resolved fluorophores (now via
// engine/spectra.js's resolveMeasurementFluorophores, R4-01/V3-N1, which
// prefers Panel assembly's structured channels and only falls back to the
// free-text markers field when there are no channels), repaints the
// Fluorophores/Spectral/assembly-controls surfaces and the advice panel, and
// syncs the field-interview boxes' VALUES (never structure) under the same
// pristine rule design.js/naming.js use -- never renderFieldInterview or
// renderChannelsList, which would wipe an unconfirmed box or a mid-edit
// channel row respectively.
import { assayView, scopeWrite } from '../../core/assay.js';
import { kbMarker } from '../../core/kb.js';
import { shortId } from '../../core/ids.js';
import {
  flagPanelOverlaps,
  MAX_PLAUSIBLE_PEAK_NM,
  MIN_PLAUSIBLE_PEAK_NM,
  resolveMarkerToken,
  resolveMeasurementFluorophores,
  SPILLOVER_ACK_REASON_LABELS,
} from '../../engine/spectra.js';
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
  FILTER_BANDWIDTH_BOUNDS_NM,
  fluorophoreEntryId,
  normalizeChannels,
  normalizeSpilloverAcks,
  panelFluorophoreOptions,
  panelFluorophoreWriteValue,
  pruneSpilloverAcks,
  reorderPanelChannels,
  seedChannelsFromMarkers,
  shiftPanelChannel,
  sortPanelChannelsByEmission,
  spilloverPairKey,
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

// R4-06: the badge text used to echo the raw reviewStatus string
// ('claude-drafted') verbatim -- this is the one place it becomes the two
// short labels the rest of the UI's prose already uses.
const REVIEW_STATUS_LABELS = {
  'source-cited': 'cited source',
  'claude-drafted': 'unreviewed',
};

const SPILLOVER_ACK_REASON_OPTIONS = [
  ['sequential-acquisition', 'Sequential acquisition (dyes not imaged together)'],
  ['filter-separated', 'Filter-separated on the microscope'],
  ['other', 'Other'],
];

function stateSentence(entry) {
  switch (entry.state) {
    case 'unrecognized':
      return `"${entry.token}" isn't a marker this app recognizes yet -- check the spelling.`;
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
  // R3-04: whatever this fluorophore's spectra.json record carries as a
  // free-text `note` (e.g. a caveat about DCFDA/H2DCFDA aliasing) surfaces as
  // the row's own tooltip -- otherwise A1's resolver threading `note` all the
  // way through has nowhere in the UI to land.
  if (entry.note) row.title = entry.note;

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
    badge.title =
      entry.reviewStatus === 'source-cited'
        ? 'Spectral value matches a cited vendor/publication source -- not yet reviewed by a microscopy specialist.'
        : 'Spectral value drafted by Claude from common published references -- not yet reviewed by a microscopy specialist.';
    badge.textContent = REVIEW_STATUS_LABELS[entry.reviewStatus] || entry.reviewStatus;
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

function formatAckDate(iso) {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString();
}

// A generic "is this dataset property set on ANY descendant" walk -- used
// both to find a focus-restore target (data-focus-key) and the assembly
// controls' Add-channel button, without depending on CSS attribute
// selectors (web/tests/domStub.js's querySelector only understands
// '.class'/'#id'/'tag'/'tag.class', not '[data-foo=...]', and has no
// `.closest`) so this walks real DOM and the test stub identically.
function findByFocusKey(root, key) {
  if (!root || !root.children) return null;
  for (const child of root.children) {
    if (child.dataset && child.dataset.focusKey === key) return child;
    const found = findByFocusKey(child, key);
    if (found) return found;
  }
  return null;
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
    render(main, store, { advisor, experience, embedded = false, onSectionChanged } = {}) {
      // Commit 1 of the assay tier idiom (naming.js/design.js/describe.js
      // all cache this identically): the active assay never changes for the
      // lifetime of one render/paint -- shared by the interview AND the
      // markers-driven panel content, so declared once out here.
      const assayId = store.get().activeAssayId;

      function notifyChanged() {
        if (typeof onSectionChanged === 'function') onSectionChanged('panel');
      }

      // Shell-owned elements/state -- created once per paint() (initial
      // render, or this step's own interview commit; see the module header
      // comment).
      let acquisitionSection;
      let fluorophoresSection;
      let fluorophoresDerivedHost;
      let spectralSection;
      let spectralHost;
      let spectralViewState;
      let assemblySection;
      let channelsList;
      let summary;
      let controlsRow;
      let guidanceSection;
      let advicePanel;
      let interviewContainer;
      let draggedChannelId = null;
      let lastPaintedFieldValues = {};

      // Derived state -- recomputed by paintDerived() on every paint AND
      // every sibling-triggered refresh; read by refreshSpectralView(),
      // renderAssemblyControls() and the fluorophores-section repaint.
      let view = null;
      let source = 'markers';
      let panelState = 'unanswered';
      let entries = [];

      function currentChannels() {
        const currentPanel = assayView(store.get(), assayId).panel;
        return normalizeChannels(currentPanel && currentPanel.channels);
      }

      // V3-N1/A2: drop any acknowledgement whose two dyes are no longer BOTH
      // present among the panel's currently resolved fluorophores. Called
      // after every write that can change WHICH dyes are paired -- a
      // structured-channel edit, or the free-text markers field's own
      // commit below -- tagged 'user_edited' because this is the app
      // correcting now-stale state, not a fresh user decision (recording or
      // withdrawing an acknowledgement, which are tagged 'user').
      function prunePanelSpilloverAcks() {
        const nextView = assayView(store.get(), assayId);
        const { entries: nextEntries } = resolveMeasurementFluorophores(nextView, kb);
        const acks = normalizeSpilloverAcks(
          nextView.panel && nextView.panel.spillover && nextView.panel.spillover.acknowledged
        );
        const pruned = pruneSpilloverAcks(acks, nextEntries);
        if (pruned.length !== acks.length) {
          const { path, slotKey } = scopeWrite(store.get(), 'panel.spillover.acknowledged', assayId);
          store.setPath(path, pruned, 'user_edited', { slotKey });
        }
      }

      function writeChannels(channels) {
        const { path, slotKey } = scopeWrite(store.get(), 'panel.channels', assayId);
        store.setPath(path, channels, 'user', { slotKey });
        prunePanelSpilloverAcks();
        notifyChanged();
      }

      function writeChannelsData(channels) {
        writeChannels(channels);
        summary.textContent = summaryText(channels);
        // A custom fluorophore name typed into a row changes which dyes are
        // in the panel: the flags and acknowledgement controls must follow,
        // not only the plot (Copilot review on PR #20).
        paintDerived();
      }

      // R6-01/A2c item 4: restore focus across a structural channel-row
      // rebuild. `focusKey` is captured from document.activeElement BEFORE
      // the rebuild; move buttons carry `${channel.id}:${delta}`, remove
      // buttons carry `remove:${channel.id}`, and the assembly's own
      // "+ Add channel" button carries the stable key 'add-channel'.
      function restoreChannelFocus(focusKey, priorChannels) {
        if (!focusKey) return;
        if (focusKey.startsWith('remove:')) {
          const removedId = focusKey.slice('remove:'.length);
          const priorIndex = priorChannels.findIndex((c) => c.id === removedId);
          const remaining = currentChannels();
          const targetIndex = Math.min(priorIndex, remaining.length - 1);
          const target = targetIndex >= 0 ? remaining[targetIndex] : null;
          const nextRemove = target ? findByFocusKey(channelsList, `remove:${target.id}`) : null;
          if (nextRemove) {
            nextRemove.focus();
            return;
          }
        } else {
          const exact = findByFocusKey(channelsList, focusKey);
          if (exact && !exact.disabled) {
            exact.focus();
            return;
          }
          // The move button in the SAME direction is gone or disabled (e.g.
          // the channel is now at the end and "down" is disabled) -- the
          // sibling button (the other direction, same channel) is the next
          // best keyboard-reachable control on the same row.
          const [channelId, delta] = focusKey.split(':');
          const opposite = findByFocusKey(channelsList, `${channelId}:${-Number(delta)}`);
          if (opposite && !opposite.disabled) {
            opposite.focus();
            return;
          }
        }
        const addBtn = findByFocusKey(controlsRow, 'add-channel');
        if (addBtn) addBtn.focus();
      }

      function writeChannelsStructure(channels) {
        const active = document.activeElement;
        const focusKey = active && active.dataset ? active.dataset.focusKey : null;
        const priorChannels = currentChannels();
        writeChannels(channels);
        renderChannelsList();
        refreshSpectralView();
        restoreChannelFocus(focusKey, priorChannels);
      }

      function resolvedChannelEntry(channel) {
        const token = channelSpectralField(channel).trim();
        const resolved = token
          ? resolveMarkerToken(token, kb.index, kb.markersKb, kb.spectra)
          : { token: 'Unnamed channel', canonical: null, state: 'unrecognized' };
        const effectiveFilter = effectiveChannelFilterPair(
          channel,
          resolved.state === 'known' ? resolved.emissionPeakNm : null,
          kb.overlapRules
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
                const defaultFilter =
                  entry.state === 'known' ? defaultChannelFilterPair(entry.emissionPeakNm, kb.overlapRules) : null;
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

        // R2-12: one name-resolution fallback chain, used by every aria
        // label/tooltip on this row -- named field, else free-text target,
        // else the generic placeholder. Previously each caller repeated its
        // own (shorter) version of this chain.
        const channelName = channelSpectralField(channel).trim() || channel.target || 'unnamed channel';

        const dragHandle = document.createElement('button');
        dragHandle.type = 'button';
        dragHandle.className = 'panel-channel-drag';
        dragHandle.draggable = true;
        dragHandle.textContent = '↕';
        dragHandle.title = 'Drag to reorder this channel';
        dragHandle.setAttribute('aria-label', `Drag ${channelName} to reorder`);
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
        conjugationSelect.setAttribute('aria-label', `Conjugation for ${channelName}`);
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
          moveButton.setAttribute('aria-label', `${title}: ${channelName}`);
          moveButton.dataset.focusKey = `${channel.id}:${delta}`;
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
        removeBtn.setAttribute('aria-label', `Remove channel ${channelName}`);
        removeBtn.dataset.focusKey = `remove:${channel.id}`;
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
            ? defaultChannelFilterPair(channelResolved.emissionPeakNm, kb.overlapRules)
            : null;
        const displayedCenterNm = hasSavedFilterPair ? channel.filterCenterNm : computedFilterDefault ? computedFilterDefault.filterCenterNm : null;
        const displayedBandwidthNm = hasSavedFilterPair
          ? channel.filterBandwidthNm
          : computedFilterDefault
            ? computedFilterDefault.filterBandwidthNm
            : null;

        // R3-04/V3-N5: filter/plausible-peak bounds are A1's exported engine
        // constants now, not literals re-typed here.
        const centerInput = filterInput(
          'Filter center (nm)',
          'e.g. 525',
          displayedCenterNm,
          MIN_PLAUSIBLE_PEAK_NM,
          MAX_PLAUSIBLE_PEAK_NM
        );
        const bandwidthInput = filterInput(
          'Bandwidth (nm)',
          'e.g. 50',
          displayedBandwidthNm,
          FILTER_BANDWIDTH_BOUNDS_NM.minExclusiveNm,
          FILTER_BANDWIDTH_BOUNDS_NM.maxNm
        );
        const filterHint = document.createElement('span');
        filterHint.className = 'panel-filter-hint';
        filterHint.textContent = computedFilterDefault
          ? 'Suggested from this fluorophore’s emission peak -- edit to match the microscope’s actual detection filter values.'
          : 'Optional; both values are required. Use the microscope’s actual detection filter values.';
        filterRow.appendChild(filterHint);

        function writeFilterPair() {
          const center = centerInput.value.trim() === '' ? null : Number(centerInput.value);
          const bandwidth = bandwidthInput.value.trim() === '' ? null : Number(bandwidthInput.value);
          const centerValid =
            Number.isFinite(center) && center >= MIN_PLAUSIBLE_PEAK_NM && center <= MAX_PLAUSIBLE_PEAK_NM;
          const bandwidthValid =
            Number.isFinite(bandwidth) &&
            bandwidth > FILTER_BANDWIDTH_BOUNDS_NM.minExclusiveNm &&
            bandwidth <= FILTER_BANDWIDTH_BOUNDS_NM.maxNm;
          const valid = centerValid && bandwidthValid;
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

      // Split out of the old renderChannelsList (A2c item 1): building the
      // add/sort/seed buttons never destroys a channel row's inputs (there
      // is nothing to destroy -- these are stateless buttons), so it is safe
      // for BOTH a structural rebuild (renderChannelsList, below) and a pure
      // derived refresh (paintDerived) to call this every time, picking up
      // the latest channel count/panelState without ever touching
      // channelsList's rows.
      function renderAssemblyControls() {
        const channels = currentChannels();
        controlsRow.textContent = '';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'copy-button';
        addBtn.textContent = '+ Add channel';
        addBtn.dataset.focusKey = 'add-channel';
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
        // never silently overwrite in-progress structured edits. Whenever
        // channels is empty, `source` is always 'markers' (see
        // resolveMeasurementFluorophores), so `entries` here are the
        // free-text-resolved ones.
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

      function renderChannelsList() {
        channelsList.textContent = '';
        const channels = currentChannels();
        channels.forEach((channel, index) => appendChannelRow(channel, index));
        summary.textContent = summaryText(channels);
        renderAssemblyControls();
      }

      // --- Acknowledgement UI (A2c item 3 / V3-N1) ----------------------
      function currentSpilloverAcks() {
        const v = assayView(store.get(), assayId);
        return normalizeSpilloverAcks(v.panel && v.panel.spillover && v.panel.spillover.acknowledged);
      }

      function writeSpilloverAcks(nextAcks, tag) {
        const { path, slotKey } = scopeWrite(store.get(), 'panel.spillover.acknowledged', assayId);
        store.setPath(path, normalizeSpilloverAcks(nextAcks), tag, { slotKey });
        // An acknowledgement changes the conformance result, so the composed
        // page's header badges must re-derive (A4 hook).
        if (typeof onSectionChanged === 'function') onSectionChanged('panel');
      }

      function appendFlagAckControls(li, flag) {
        const [aId, bId] = flag.pairKey.split('|');
        // Two channels resolved to the exact SAME fluorophore entry: a real
        // conflict (a duplicate dye), never something a "these are separated
        // some other way" acknowledgement can excuse -- no ack control here.
        const isSelfPair = aId === bId;

        if (flag.severity === 'error' && !isSelfPair) {
          const details = document.createElement('details');
          details.className = 'spillover-ack';
          const detailsSummary = document.createElement('summary');
          detailsSummary.textContent = 'Acknowledge this pair';
          details.appendChild(detailsSummary);

          const reasonSelect = document.createElement('select');
          reasonSelect.className = 'spillover-ack-reason';
          reasonSelect.setAttribute('aria-label', 'Reason this pair is acceptable');
          for (const [value, label] of SPILLOVER_ACK_REASON_OPTIONS) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            reasonSelect.appendChild(option);
          }
          details.appendChild(reasonSelect);

          const recordBtn = document.createElement('button');
          recordBtn.type = 'button';
          recordBtn.className = 'copy-button';
          recordBtn.textContent = 'Record acknowledgement';
          recordBtn.addEventListener('click', () => {
            const acks = currentSpilloverAcks();
            writeSpilloverAcks(
              [...acks, { pair: [aId, bId], reason: reasonSelect.value, at: new Date().toISOString() }],
              'user'
            );
            paintDerived();
          });
          details.appendChild(recordBtn);
          li.appendChild(details);
        } else if (flag.acknowledged) {
          const acks = currentSpilloverAcks();
          const ack = acks.find((a) => spilloverPairKey(a.pair[0], a.pair[1]) === flag.pairKey);
          const status = document.createElement('span');
          status.className = 'spillover-ack-status';
          const reasonText = ack ? SPILLOVER_ACK_REASON_LABELS[ack.reason] || ack.reason : '';
          const dateText = ack ? formatAckDate(ack.at) : '';
          status.textContent = `Acknowledged — ${reasonText} (${dateText}) · `;

          const withdrawBtn = document.createElement('button');
          withdrawBtn.type = 'button';
          withdrawBtn.className = 'copy-button spillover-ack-withdraw';
          withdrawBtn.textContent = 'Withdraw';
          withdrawBtn.addEventListener('click', () => {
            const remaining = currentSpilloverAcks().filter(
              (a) => spilloverPairKey(a.pair[0], a.pair[1]) !== flag.pairKey
            );
            writeSpilloverAcks(remaining, 'user');
            paintDerived();
          });
          status.appendChild(withdrawBtn);
          li.appendChild(status);
        }
      }

      // --- Fluorophores section (derived) -------------------------------
      function renderFluorophoresDerived() {
        fluorophoresDerivedHost.textContent = '';

        // The banner has to describe THIS panel's fluorophores, not the pack
        // as a whole: part of spectra.json is matched against cited vendor
        // sources, so a blanket "drafted by Claude" claim is wrong for a
        // panel that happens to be entirely source-cited.
        const knownEntries = entries.filter((entry) => entry.state === 'known');
        const draftedCount = knownEntries.filter((entry) => entry.reviewStatus === 'claude-drafted').length;
        if (knownEntries.length > 0) {
          const banner = document.createElement('div');
          banner.className = 'panel-review-banner';
          if (draftedCount === 0) {
            banner.textContent =
              'Spectral values below match cited vendor or publication sources, but have not been reviewed by a microscopy specialist -- confirm exact peak numbers against your own filter sets.';
          } else if (draftedCount === knownEntries.length) {
            banner.textContent =
              'Spectral values below are drafted by Claude from common published references and have not yet been reviewed by a microscopy specialist -- treat exact peak numbers as approximate until reviewed.';
          } else {
            banner.textContent =
              'Spectral values below are a mix of cited vendor or publication sources and values drafted by Claude from common published references (see each fluorophore’s badge). None has been reviewed by a microscopy specialist -- treat exact peak numbers as approximate.';
          }
          fluorophoresDerivedHost.appendChild(banner);
        }

        // R4-01: the 'unanswered'/'no-markers-declared' panel-level states
        // only mean anything for the free-text markers path -- when
        // `source` is 'channels', Panel assembly is the fluorophore source
        // and these two sentences would be talking about the wrong field.
        if (panelState === 'unanswered' && source === 'markers') {
          const empty = document.createElement('p');
          empty.className = 'panel-empty';
          empty.textContent =
            'No markers entered yet -- fill in the markers field on the Data plan step, or add a channel in Panel assembly below, to see a color panel here.';
          fluorophoresDerivedHost.appendChild(empty);
        } else if (panelState === 'no-markers-declared' && source === 'markers') {
          // A DECLARATION ("NONE", "N/A", "unstained", ...), not a typo -- see
          // spectra.js's NO_MARKERS_SENTINELS. Its own sentence, distinct from
          // 'unanswered' (nothing typed yet): the field was answered, and the
          // answer was "there are no fluorophores in this assay."
          const declared = document.createElement('p');
          declared.className = 'panel-empty';
          declared.textContent = 'This measurement declares no markers/fluorophores -- nothing for a color panel to check here.';
          fluorophoresDerivedHost.appendChild(declared);
        } else {
          const list = document.createElement('div');
          list.className = 'panel-list';
          for (const entry of entries) {
            appendRow(list, entry);
          }
          fluorophoresDerivedHost.appendChild(list);

          const acknowledged = currentSpilloverAcks();
          const flags = flagPanelOverlaps(entries, kb.overlapRules, { acknowledged });

          const flagsHeading = document.createElement('div');
          flagsHeading.className = 'proposals-heading';
          flagsHeading.textContent = 'Spillover flags';
          fluorophoresDerivedHost.appendChild(flagsHeading);

          if (flags.length > 0) {
            const issuesList = document.createElement('ul');
            issuesList.className = 'issues-list';
            for (const flag of flags) {
              const li = document.createElement('li');
              li.className = 'issue issue-' + flag.severity;
              const text = document.createElement('span');
              text.textContent = flag.message;
              li.appendChild(text);
              appendFlagAckControls(li, flag);
              issuesList.appendChild(li);
            }
            fluorophoresDerivedHost.appendChild(issuesList);
          } else {
            const knownCount = entries.filter((e) => e.state === 'known').length;
            const noFlags = document.createElement('p');
            noFlags.className = 'panel-empty';
            const sourceSuffix = source === 'channels' ? ' (from Panel assembly)' : ' (from the Markers field)';
            noFlags.textContent =
              knownCount > 0
                ? `No spectral-proximity conflicts among ${knownCount} recognized fluorophore(s)${sourceSuffix}.`
                : 'No recognized fluorophores with spectral data yet -- see the states above.';
            fluorophoresDerivedHost.appendChild(noFlags);
          }
        }
      }

      // --- Interview pristine-rule sync (A2c item 1) --------------------
      function fieldInterviewInputId(question) {
        return `field-interview-${question.id || question.field || ''}`.replace(/[^A-Za-z0-9_-]/g, '-');
      }

      // Not `document.getElementById` -- IDs must be unique document-wide,
      // but this page's tests mount more than one panel step instance in
      // the same fake document, so this searches only within this step's
      // own interviewContainer.
      function findById(root, id) {
        if (!root || !root.children) return null;
        for (const child of root.children) {
          if (child.id === id) return child;
          const found = findById(child, id);
          if (found) return found;
        }
        return null;
      }

      function captureInterviewBaseline() {
        lastPaintedFieldValues = {};
        const list = phaseQuestions(questionBank, assayView(store.get(), assayId), 'microscopy');
        for (const question of list) {
          const input = findById(interviewContainer, fieldInterviewInputId(question));
          if (input) lastPaintedFieldValues[question.field || question.id] = input.value;
        }
      }

      // Mirrors design.js/naming.js's own pristine rule (docs/cma-lessons.md
      // lesson 46): a box mid-edit (focused) or already holding an
      // uncommitted local edit is never clobbered by a sibling's refresh.
      // NEVER calls renderFieldInterview -- that would wipe an unconfirmed
      // box entirely, not just resync a value.
      function syncInterviewInputs() {
        const list = phaseQuestions(questionBank, assayView(store.get(), assayId), 'microscopy');
        for (const question of list) {
          const key = question.field || question.id;
          const input = findById(interviewContainer, fieldInterviewInputId(question));
          if (!input) continue;
          if (document.activeElement === input) continue;
          if (input.value !== lastPaintedFieldValues[key]) continue;
          const nextValue =
            question.currentValue === undefined || question.currentValue === null ? '' : String(question.currentValue);
          input.value = nextValue;
          lastPaintedFieldValues[key] = nextValue;
        }
      }

      function paintShell() {
        main.textContent = '';

        appendStepHeading(main, {
          title: 'Acquisition',
          scopeText: `Planning how data will be acquired for: ${activeMeasurementLabel(store.get(), assayId)}.`,
          embedded,
          id: 'measurement-section-acquisition',
        });

        acquisitionSection = createMicroscopySection('Acquisition', true, 'acquisition');
        fluorophoresSection = createMicroscopySection('Fluorophores and spillover', false, 'fluorophores');
        spectralSection = createMicroscopySection('Spectral view', false, 'spectral');
        assemblySection = createMicroscopySection('Panel assembly', false, 'assembly');
        guidanceSection = createMicroscopySection('Guidance');
        main.appendChild(acquisitionSection);
        main.appendChild(fluorophoresSection);
        main.appendChild(spectralSection);
        main.appendChild(assemblySection);
        main.appendChild(guidanceSection);

        // Name-builder-style boxes (zen-planner Phase 1 feedback): fill a box
        // and use its explicit confirmation action; leave it empty to skip.
        // The "why" is a hover hint on the box, not a subtitle. onCommit
        // writes STRONG, re-paints the state label plus the panel below, and
        // (A2c) tells the measurement page a sibling section may need to
        // refresh.
        interviewContainer = document.createElement('div');
        acquisitionSection.appendChild(interviewContainer);
        renderFieldInterview(interviewContainer, {
          questions: phaseQuestions(questionBank, assayView(store.get(), assayId), 'microscopy'),
          experience,
          onCommit: (question, raw) => {
            const { path, slotKey } = scopeWrite(store.get(), question.field, assayId);
            const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
            const tag = existingTag ? editTagFor(existingTag) : question.tag || 'user';
            store.setPath(path, coerceAnswer(question, raw), tag, { slotKey });
            // The markers field is one of the two producers
            // resolveMeasurementFluorophores reads (the other is Panel
            // assembly's channels below) -- committing a new value here can
            // change WHICH pairs are even under consideration, so any
            // acknowledgement recorded against the old pairing must be
            // re-checked exactly like a structured-channel edit does.
            if (question.field === 'naming.fields.markers') prunePanelSpilloverAcks();
            paint();
            notifyChanged();
          },
        });
        captureInterviewBaseline();

        const explainer = document.createElement('p');
        explainer.className = 'proposals-empty supporting-description';
        explainer.textContent =
          'A qualitative check for spectral spillover across this measurement’s fluorophores -- excitation/emission peak proximity only, not a spectral-overlap integral.';
        fluorophoresSection.appendChild(explainer);

        fluorophoresDerivedHost = document.createElement('div');
        fluorophoresDerivedHost.className = 'panel-fluorophores-derived';
        fluorophoresSection.appendChild(fluorophoresDerivedHost);

        // Curves are intentionally rendered from the same resolved entries as
        // the state rows above. Structured channels take over once present so
        // their user-entered filters can be overlaid; until then the free-text
        // markers remain the one quick-path source.
        spectralHost = document.createElement('section');
        spectralHost.className = 'spectral-view-host';
        spectralViewState = spectralViewCreateState();
        spectralSection.appendChild(spectralHost);

        // --- Structured panel assembly (Wave 2A) ------------------------
        const assemblyExplainer = document.createElement('p');
        assemblyExplainer.className = 'panel-empty';
        assemblyExplainer.textContent =
          'Optional: name each channel’s target or feature and how its fluorophore is attached. More precise than the ' +
          'markers field above -- in particular, it is what tells the Review step’s controls whether an antibody is ' +
          'actually involved, so it can recommend an isotype control only when one is warranted. Enter a detection ' +
          'filter as center/bandwidth nm to overlay it above. Drag channel handles or use the arrow buttons to reorder; ' +
          'ordering changes the saved channel list, never a fluorophore’s physical wavelength.';
        assemblySection.appendChild(assemblyExplainer);

        channelsList = document.createElement('div');
        channelsList.className = 'panel-list';
        summary = document.createElement('p');
        summary.className = 'panel-empty';
        controlsRow = document.createElement('div');
        controlsRow.className = 'overview-actions';

        assemblySection.appendChild(channelsList);
        assemblySection.appendChild(summary);
        assemblySection.appendChild(controlsRow);
        // Built before paintDerived() has run once this cycle, so
        // renderAssemblyControls() (called from inside renderChannelsList)
        // sees the still-stale `panelState`/`entries` from the PREVIOUS
        // paint -- harmless: paintDerived() runs immediately after and calls
        // renderAssemblyControls() again with the freshly recomputed values,
        // all synchronously within this same paint() call, before anything
        // is visible.
        renderChannelsList();

        // Collapse only on an EXPLICIT 'frequent' self-report -- an absent/
        // unset experience (today's entire existing userbase; the onboarding
        // gate never fires for a session with prior autosaves) or 'novice'/
        // 'occasional' all keep this panel open, matching createAdvicePanel's
        // own default and every other step's advice panel. See advice.js's
        // createAdvicePanel docstring for why the default itself is `true`.
        advicePanel = createAdvicePanel(advisor || [], 'panel', { defaultExpanded: experience !== 'frequent' });
        guidanceSection.appendChild(advicePanel.element);
      }

      function paintDerived() {
        view = assayView(store.get(), assayId);
        ({ source, panelState, entries } = resolveMeasurementFluorophores(view, kb));

        renderFluorophoresDerived();
        refreshSpectralView();
        renderAssemblyControls();
        advicePanel.update(view);
        syncInterviewInputs();
      }

      function paint() {
        paintShell();
        paintDerived();
      }

      paint();

      return { id: 'panel', refresh: paintDerived };
    },
  };
}
