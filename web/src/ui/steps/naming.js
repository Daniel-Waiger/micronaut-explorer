import { finalizeFields } from '../../engine/naming.js';
import { DEFAULT_PROFILE, validateFields, validateTargetPath } from '../../engine/validation.js';
import { editTagFor } from '../../core/provenance.js';
import { formatReplicateToken } from '../../engine/conditions.js';
import { effectiveNamingFields, planFilenames } from '../../engine/plan.js';
import { createAdvicePanel } from '../advice.js';
import { assayById, assayView, scopeWrite } from '../../core/assay.js';
import { copyToClipboard } from '../clipboard.js';
import { loadQuestions, phaseQuestions } from '../../engine/interview.js';
import { coerceAnswer } from '../questionControl.js';
import { renderFieldInterview } from '../fieldInterview.js';
import { buildIcsSchedule, renderIcs } from '../../engine/render/ics.js';
import { downloadTextFile } from '../../core/persist.js';

// Interim defaults until the P1 knowledge pack supplies a real profile and
// per-lab naming config -- mirrors microscopy_naming_assistant's
// default_config()/default_profile() so behaviour matches Classic today.
//
// Stage 1 (the base name, shared by every file in the experiment) is the
// leading {date}_{modality}_{exptype}_{markers}_{magnification}. Stage 2 is
// what distinguishes THIS file: {group}_{sample}_{biorep}_{techrep}. {notes}
// stays trailing. Kept byte-identical to schema.js's DEFAULT_NAMING_TEMPLATE
// -- see BASE_TEMPLATE below for the split point the Design step uses.
//
// {group}/{biorep}/{techrep}/{notes} are OPTIONAL: an experiment with no
// groups, or no technical replicates (common for SEM/TEM/Raman), omits that
// token entirely rather than padding the name with a placeholder -- see
// engine/naming.js's optionalFields handling.
export const NAMING_CONFIG = {
  template:
    '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}',
  defaults: {
    date: '1970-01-01',
    modality: 'UNKNOWN',
    exptype: 'UNKNOWN',
    markers: 'UNKNOWN',
    magnification: 'UNKNOWN',
    sample: 'UNKNOWN',
  },
  optionalFields: ['group', 'biorep', 'techrep', 'notes'],
  uppercaseFields: ['modality', 'exptype', 'sample', 'magnification', 'markers', 'group'],
  safeCharPattern: '[^A-Za-z0-9_-]+',
};

// Stage 1 on its own: NAMING_CONFIG.template up to (not including) the
// {group} slot, and without {ext}. The Design step renders this ONCE above
// the condition table -- it is the stem every file in the experiment shares
// -- so each row only has to show the part that actually distinguishes it.
// Rendering it through renderName with this template yields no extension
// (fields.ext won't match the tail), which is what we want for a stem.
export const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';

// DEFAULT_PROFILE itself now lives in engine/validation.js -- see its own
// comment there for why (one profile shared with engine/conformance.js,
// not a second local copy that could quietly diverge).

// Prefixes formatReplicateToken uses for the two number-typed replicate
// fields -- kept alongside FIELD_DEFS so currentRawFields() can look one up
// by key rather than hardcoding a branch per field.
const REPLICATE_PREFIXES = { biorep: 'B', techrep: 'T' };

// `hint` is a plain-language explanation for people who aren't sure what a
// field is asking for -- wired to the input's `title` attribute below, so it
// shows as the browser's native hover tooltip on top of (not instead of) the
// `placeholder` example text. Written for a biologist who has never touched
// this tool before, not for someone who already knows the naming jargon --
// no "token", "schema", "canonical". If a field's meaning depends on
// modality (e.g. markers meaning a contrast agent for SEM/TEM), say so in
// plain terms rather than assuming fluorescence imaging.
const FIELD_DEFS = [
  {
    key: 'date',
    label: 'Date',
    placeholder: 'YYYY-MM-DD',
    hint: 'The date you acquired these images. Keeps your files sorted in the order you took them.',
  },
  {
    key: 'modality',
    label: 'Modality',
    placeholder: 'e.g. CONFOCAL',
    hint: 'The type of microscope or imaging method you used -- for example confocal, widefield, or STED.',
  },
  {
    key: 'exptype',
    label: 'Experiment type',
    placeholder: 'e.g. CT',
    hint: 'A short label for what kind of experiment this is, so related files end up grouped together (for example "CT" for a control).',
  },
  {
    key: 'markers',
    label: 'Markers',
    placeholder: 'e.g. GFP-DAPI',
    hint: 'The stains, dyes, or fluorescent proteins you imaged, like DAPI or GFP. For SEM/TEM with no fluorescence, use this for your contrast agent instead (like uranyl acetate).',
  },
  {
    key: 'magnification',
    label: 'Magnification',
    placeholder: 'e.g. X90',
    hint: 'The zoom level or objective you used, like 40x or 100x.',
  },
  {
    key: 'group',
    label: 'Group',
    placeholder: 'e.g. CTL, OPP -- set per-row by the Design step, or type one here',
    hint: 'Which experimental group this file belongs to, such as your control group or a treatment group. Usually filled in for you from the Design page.',
  },
  {
    key: 'sample',
    label: 'Sample',
    placeholder: 'e.g. ABC01',
    hint: 'A unique ID for this specimen or animal, so two files from the same experiment never get mixed up.',
  },
  {
    key: 'biorep',
    label: 'Biological replicate #',
    placeholder: 'optional',
    type: 'number',
    hint: "Which biological replicate this is -- a repeat done with a different animal, dish, or sample. Leave blank if this doesn't apply to your experiment.",
  },
  {
    key: 'techrep',
    label: 'Technical replicate #',
    placeholder: 'optional',
    type: 'number',
    hint: "Which technical replicate this is -- a repeat measurement of the SAME sample. Leave blank if this doesn't apply.",
  },
  {
    key: 'notes',
    label: 'Notes',
    placeholder: 'optional',
    hint: 'Anything else worth remembering about this file. Totally optional.',
  },
];

// Factory, matching createDescribeStep/createPanelStep's convention
// (zen-planner Phase 1): Naming needs kb.questions for the Schedule
// section's timing interview (phase 'timing') below. main.js is the one
// call site; every other importer of this module (design.js, describe.js)
// only ever wanted the module-level NAMING_CONFIG/BASE_TEMPLATE constants
// above, which are unaffected by this change.
export function createNamingStep(kb) {
  const { questions: questionBank, issues: questionIssues } = loadQuestions(kb.questions);
  if (questionIssues.length > 0) {
    console.error('Question bank issues:', questionIssues);
  }
  return {
  id: 'naming',
  title: 'Naming',
  render(main, store, { advisor, experience } = {}) {
    main.textContent = '';

    // Commit 1 of the assay tier (schema v3): every experiment has exactly
    // one assay and no switcher exists yet, so the active assay never
    // changes for the lifetime of one render -- caching its id once here is
    // safe, matching this file's existing snapshot-per-render idiom.
    const assayId = store.get().activeAssayId;

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Name builder';
    main.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'naming-grid';
    main.appendChild(grid);

    const inputs = {};
    // Pre-fill through effectiveNamingFields, not raw naming.fields, so a
    // value the user already gave elsewhere (modality, collected by the
    // interview as acquisition.modality) shows up in the box it feeds rather
    // than leaving the box blank while the filename below quietly uses it.
    // assayView() hoists the active assay's slices flat, exactly the shape
    // effectiveNamingFields (an engine function that must never learn
    // assays exist) already expects.
    const prefill = effectiveNamingFields(assayView(store.get(), assayId));
    for (const field of FIELD_DEFS) {
      const row = document.createElement('label');
      row.className = 'field-row';

      const labelText = document.createElement('span');
      labelText.className = 'field-label';
      labelText.textContent = field.label;
      row.appendChild(labelText);

      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.className = 'field-input';
      input.placeholder = field.placeholder;
      // Native browser tooltip, on top of (not instead of) the placeholder
      // example above -- shows on hover regardless of whether the field is
      // filled in yet.
      if (field.hint) input.title = field.hint;
      input.value = prefill[field.key] ?? '';
      input.addEventListener('input', () => {
        // scopeWrite translates the flat v2-shaped path into this assay's
        // real (index-addressed) object path plus its stable (id-addressed)
        // provenance slotKey -- see core/assay.js's module header on why
        // the two must differ for a per-assay field.
        const { path, slotKey } = scopeWrite(store.get(), `naming.fields.${field.key}`, assayId);
        // 'user_edited' when correcting an existing WEAK/PROVISIONAL value
        // (e.g. one filled in from an accepted free-text proposal), plain
        // 'user' for a first-ever entry or one already STRONG -- see
        // core/provenance.js editTagFor.
        const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
        store.setPath(path, input.value, editTagFor(existingTag), { slotKey });
        update();
      });
      inputs[field.key] = input;
      row.appendChild(input);
      grid.appendChild(row);
    }

    // The planned-names table. With a design this is every file the
    // experiment will produce; with no design at all it is exactly one row --
    // the single name the boxes above build. Same widget either way, so the
    // step works as a standalone one-off name tool OR as the end of the full
    // workflow, with nothing to switch between.
    const plannedBox = document.createElement('div');
    plannedBox.className = 'planned-box';

    const plannedHead = document.createElement('div');
    plannedHead.className = 'planned-head';

    const plannedLabel = document.createElement('div');
    plannedLabel.className = 'planned-label';
    plannedHead.appendChild(plannedLabel);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-button';
    copyBtn.textContent = 'Copy all';
    copyBtn.addEventListener('click', async () => {
      // One name per line: the shape that pastes straight into a lab
      // notebook, a spreadsheet column, or a shell loop.
      const ok = await copyToClipboard(currentFilenames().join('\n'));
      const original = copyBtn.textContent;
      copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
      window.setTimeout(() => {
        copyBtn.textContent = original;
      }, 1500);
    });
    plannedHead.appendChild(copyBtn);
    plannedBox.appendChild(plannedHead);

    const plannedList = document.createElement('div');
    plannedList.className = 'planned-list';
    plannedBox.appendChild(plannedList);
    main.appendChild(plannedBox);

    // --- Schedule (zen-planner Phase 1's timing interview + .ics export) --
    // A short interview (phase 'timing') asking the user's own ETA per
    // bench/microscope task, then a one-click .ics download built from
    // those answers -- the file:// / offline path; a future Google
    // Calendar sync (deferred) would build from the identical
    // buildIcsSchedule() events. Lives here (Naming/Outputs), not on
    // Overview: Overview's own header documents it as a pure READ over
    // every other step's data, never a place new facts are entered.
    const scheduleHeading = document.createElement('div');
    scheduleHeading.className = 'design-subheading';
    scheduleHeading.textContent = 'Schedule';
    main.appendChild(scheduleHeading);

    const scheduleHint = document.createElement('p');
    scheduleHint.className = 'proposals-empty';
    scheduleHint.textContent =
      'Roughly how long each bench/microscope task takes for you -- used to build a downloadable schedule, scaled to the planned sample count above. Enter hours and minutes; leave blank to skip.';
    main.appendChild(scheduleHint);

    // Same name-builder field grid as the Microscopy step (ui/fieldInterview.js):
    // a box per task with an hours+minutes duration control and an explicit
    // confirmation action. Re-renders itself on commit; the .ics button below always
    // reads fresh from the store, so it needs no coupling to this grid.
    const timingContainer = document.createElement('div');
    main.appendChild(timingContainer);

    function renderTimingGrid() {
      renderFieldInterview(timingContainer, {
        questions: phaseQuestions(questionBank, assayView(store.get(), assayId), 'timing'),
        experience,
        onCommit: (question, raw) => {
          const { path, slotKey } = scopeWrite(store.get(), question.field, assayId);
          const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
          const tag = existingTag ? editTagFor(existingTag) : question.tag || 'user';
          store.setPath(path, coerceAnswer(question, raw), tag, { slotKey });
          renderTimingGrid();
        },
      });
    }

    const downloadScheduleBtn = document.createElement('button');
    downloadScheduleBtn.type = 'button';
    downloadScheduleBtn.className = 'add-factor-button';
    downloadScheduleBtn.textContent = 'Download schedule (.ics)';
    downloadScheduleBtn.title =
      'Downloads a bench schedule built from your timing answers above -- imports into Google Calendar, Outlook, or Apple Calendar with no login.';
    downloadScheduleBtn.addEventListener('click', () => {
      const view = currentExperimentView();
      const sampleCount = planFilenames(view, NAMING_CONFIG).length;
      const activeAssay = assayById(store.get(), assayId);
      const events = buildIcsSchedule({
        assayLabel: (activeAssay && activeAssay.label) || 'This assay',
        timing: view.timing,
        sampleCount,
        // Tomorrow at 09:00 local -- a schedule dated "right now" would put
        // its first block in the past for whichever calendar app renders
        // it the moment the file is opened.
        startDate: (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(9, 0, 0, 0);
          return d;
        })(),
      });
      if (events.length === 0) {
        if (typeof window !== 'undefined' && window.alert) {
          window.alert('Answer at least one timing question above first -- there is nothing to schedule yet.');
        }
        return;
      }
      downloadTextFile(renderIcs(events), 'micronaut-schedule.ics', 'text/calendar');
    });
    main.appendChild(downloadScheduleBtn);

    // advisor may be undefined (a caller that hasn't wired it, or a KB that
    // failed to load) -- createAdvicePanel([], ...) is a completely inert
    // panel (selectAdvice on an empty rule array is always empty), not a
    // missing-argument crash.
    const advicePanel = createAdvicePanel(advisor || [], 'naming');
    main.appendChild(advicePanel.element);

    const issuesList = document.createElement('ul');
    issuesList.className = 'issues-list';
    main.appendChild(issuesList);

    let lastPlanned = [];

    function currentFilenames() {
      return lastPlanned.filter((entry) => entry.filename).map((entry) => entry.filename);
    }

    function currentRawFields() {
      // Only include a field once the user has actually typed something --
      // finalizeFields merges {...config.defaults, ...raw}, so an included
      // blank string would OVERRIDE a sensible default (e.g. exptype's
      // 'UNKNOWN') with 'UNSPECIFIED' instead of leaving the default in
      // place until the field is genuinely filled in. For an OPTIONAL field
      // (group/biorep/techrep/notes) an omitted key is what makes the token
      // disappear from the name entirely -- see engine/naming.js.
      const raw = {};
      for (const field of FIELD_DEFS) {
        const value = inputs[field.key].value;
        if (!value) continue;
        const prefix = REPLICATE_PREFIXES[field.key];
        // biorep/techrep are stored as the raw typed NUMBER (so the number
        // input can redisplay it), formatted to 'B01'/'T03' only here, at the
        // boundary right before finalizeFields -- the single formatting
        // authority is formatReplicateToken, reused by the planner's per-row
        // rendering so the two paths can never format replicates differently.
        raw[field.key] = prefix ? formatReplicateToken(prefix, Number(value)) : value;
      }
      return raw;
    }

    // The single snapshot every consumer of "the current naming state" reads
    // from -- planFilenames below AND the advice panel. Reading the store
    // directly would lag by one keystroke on the very first character of a
    // field (setPath runs before update(), but a field the user has just
    // cleared must read as cleared already), and more importantly this is
    // what lets the table react to typing even when nothing has been
    // persisted yet. Extracted to one function specifically so the table and
    // the advice panel cannot evaluate two DIFFERENT experiments and quietly
    // disagree -- see docs/plans -- Advisor slice 1, Decision 4.
    function currentExperimentView() {
      const view = assayView(store.get(), assayId);
      return {
        ...view,
        naming: { ...(view.naming || {}), fields: currentRawFields() },
      };
    }

    function update() {
      const view = currentExperimentView();
      lastPlanned = planFilenames(view, NAMING_CONFIG);
      advicePanel.update(view);

      const count = lastPlanned.length;
      plannedLabel.textContent =
        count === 1 ? 'Planned filename' : `Planned filenames (${count} files)`;
      copyBtn.textContent = count === 1 ? 'Copy filename' : 'Copy all';
      copyBtn.disabled = currentFilenames().length === 0;

      plannedList.textContent = '';
      if (count === 0) {
        const empty = document.createElement('p');
        empty.className = 'planned-empty';
        empty.textContent = 'No names to show -- see the issues in the Design step.';
        plannedList.appendChild(empty);
      }
      for (const entry of lastPlanned) {
        const line = document.createElement('code');
        line.className = 'planned-name';
        line.textContent = entry.filename || `(${entry.error})`;
        plannedList.appendChild(line);
      }

      // Field-level validation runs against the fields as typed. The
      // path-length check runs per PLANNED NAME, deduped: with a design, the
      // longest row is the one that actually risks exceeding MAX_PATH, and N
      // equally-long rows should not produce N copies of one warning.
      const finalized = finalizeFields('experiment.tif', currentRawFields(), NAMING_CONFIG);
      const issues = validateFields(finalized, DEFAULT_PROFILE);
      const pathMessages = new Set();
      for (const name of currentFilenames()) {
        for (const issue of validateTargetPath(name)) pathMessages.add(issue.message);
      }

      issuesList.textContent = '';
      for (const issue of issues) {
        const li = document.createElement('li');
        li.className = 'issue issue-' + issue.severity;
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }
      for (const message of pathMessages) {
        const li = document.createElement('li');
        li.className = 'issue issue-warning';
        li.textContent = `target_path: ${message}`;
        issuesList.appendChild(li);
      }
    }

    update();
    renderTimingGrid();
  },
  };
}
