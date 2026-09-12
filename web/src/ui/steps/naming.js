import { finalizeFields } from '../../engine/naming.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from '../../engine/namingConfig.js';
import { DEFAULT_PROFILE, validateFields, validateTargetPath } from '../../engine/validation.js';
import { editTagFor } from '../../core/provenance.js';
import { formatReplicateToken, physicalSampleCount } from '../../engine/conditions.js';
import { effectiveNamingFields, planFilenames } from '../../engine/plan.js';
import { createAdvicePanel } from '../advice.js';
import { assayById, assayView, scopeWrite } from '../../core/assay.js';
import { copyToClipboard } from '../clipboard.js';
import { loadQuestions, phaseQuestions } from '../../engine/interview.js';
import { coerceAnswer, localDateInputValue } from '../questionControl.js';
import { renderFieldInterview } from '../fieldInterview.js';
import { buildIcsSchedule, renderIcs } from '../../engine/render/ics.js';
import { downloadTextFile } from '../../core/persist.js';
import { appendStepHeading } from '../stepHeading.js';

// NAMING_CONFIG and BASE_TEMPLATE themselves now live in
// engine/namingConfig.js (imported above) -- see its own comment for why
// (engine-layer modules like conformance.js/studydoc.js/plan.js need them
// too, and this module touches `document` so they can't stay defined here).

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
    type: 'date',
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
  title: 'Data plan',
  render(main, store, { advisor, experience, embedded = false, showToast, onSectionChanged } = {}) {
    main.textContent = '';

    // Commit 1 of the assay tier (schema v3): every experiment has exactly
    // one assay and no switcher exists yet, so the active assay never
    // changes for the lifetime of one render -- caching its id once here is
    // safe, matching this file's existing snapshot-per-render idiom.
    const assayId = store.get().activeAssayId;

    const activeAssay = assayById(store.get(), assayId);
    const activeAssayLabel = activeAssay?.label || 'this measurement';
    appendStepHeading(main, {
      title: 'Data plan',
      scopeText: `Planning files and work for: ${activeAssayLabel}.`,
      embedded,
      id: 'measurement-section-dataplan',
    });

    const filenameGuidance = document.createElement('p');
    filenameGuidance.className = 'proposals-empty supporting-description';
    filenameGuidance.textContent =
      'Enter the details needed for a final filename here. Date, sample ID, and instrument label may be assigned later on acquisition day; until then previews use clearly labelled placeholders. Final exports remain guarded by planner checks.';
    main.appendChild(filenameGuidance);

    const grid = document.createElement('div');
    grid.className = 'naming-grid';
    main.appendChild(grid);

    const inputs = {};
    // The value THIS section last painted into each input, keyed by
    // FIELD_DEFS' key -- the pristine rule's other half (see
    // syncInputsFromStore below): an input is safe to overwrite from the
    // store only when it is not focused AND its current value still equals
    // what was last painted into it, i.e. the person has not typed anything
    // since. Populated here at initial paint and kept current by both the
    // initial loop and syncInputsFromStore.
    const lastPainted = {};
    // R4-20: the DATE field stays a native <input type=date> (the platform
    // picker researchers already know), but that picker RENDERS in the
    // browser's locale order (e.g. '03/14/2026') while every other surface
    // in this app -- the filename preview, suggestions, the Acquisition
    // date -- shows ISO. input.value on a native date input is always the
    // ISO 'YYYY-MM-DD' string regardless of how it is drawn (that is the
    // one part of this control the HTML spec pins down), so this helper
    // text needs no separate formatting logic -- it just surfaces the value
    // the filename already uses, updated on every keystroke/pick and every
    // programmatic repaint (syncInputsFromStore below).
    let refreshDateHelp = () => {};
    // Pre-fill through effectiveNamingFields, not raw naming.fields, so a
    // value the user already gave elsewhere (modality, collected by the
    // interview as acquisition.modality) shows up in the box it feeds rather
    // than leaving the box blank while the filename below quietly uses it.
    // assayView() hoists the active assay's slices flat, exactly the shape
    // effectiveNamingFields (an engine function that must never learn
    // assays exist) already expects.
    const prefill = effectiveNamingFields(assayView(store.get(), assayId));

    // Group is READ-ONLY here. It used to be a text box a person could type
    // into directly, duplicating the same question Samples & design already
    // asks -- see docs/plans, this task's plan file. Now it just shows what
    // that page decided, updated by update() below from the same planned
    // rows the filename preview uses, so this line can never disagree with
    // the {group} token actually embedded in the filenames.
    const groupRow = document.createElement('div');
    groupRow.className = 'field-row';
    const groupLabelText = document.createElement('span');
    groupLabelText.className = 'field-label';
    groupLabelText.textContent = 'Group';
    groupRow.appendChild(groupLabelText);
    const groupValue = document.createElement('span');
    groupValue.className = 'field-readonly-value';
    groupValue.title = 'Set on Samples & design for this measurement -- not editable here.';
    groupRow.appendChild(groupValue);

    for (const field of FIELD_DEFS) {
      if (field.key === 'sample') grid.appendChild(groupRow);
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
      // A new naming plan starts with today's local calendar day, but a
      // stored/acquired date always wins when reopening existing work.
      input.value = field.key === 'date' && !prefill[field.key]
        ? localDateInputValue()
        : prefill[field.key] ?? '';
      lastPainted[field.key] = input.value;
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
        // This input is the one the person is actively typing in, so its own
        // value already reflects what was just typed -- lastPainted tracks
        // that too, or a later sibling refresh's pristine check would see
        // this box's value having "drifted" from what it last painted (it
        // never repainted itself, the person typed into it) and refuse to
        // touch it forever, which happens to be harmless here (this field
        // keeps its own typed value either way) but is the wrong reason.
        lastPainted[field.key] = input.value;
        update();
        onSectionChanged?.('naming');
      });
      inputs[field.key] = input;
      row.appendChild(input);
      if (field.key === 'date') {
        const dateHelp = document.createElement('span');
        dateHelp.className = 'field-help-inline naming-date-iso';
        row.appendChild(dateHelp);
        refreshDateHelp = () => {
          dateHelp.textContent = input.value ? `Used in filenames as ${input.value}` : '';
        };
        refreshDateHelp();
        input.addEventListener('input', refreshDateHelp);
      }
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
      const names = currentFilenames();
      const ok = await copyToClipboard(names.join('\n'));
      const original = copyBtn.textContent;
      copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
      window.setTimeout(() => {
        copyBtn.textContent = original;
      }, 1500);
      if (showToast) {
        showToast(ok
          ? `Copied ${names.length} file name${names.length === 1 ? '' : 's'} to the clipboard.`
          : 'Could not copy the file names — select them in the list and copy manually.');
      }
    });
    plannedHead.appendChild(copyBtn);
    plannedBox.appendChild(plannedHead);

    const plannedList = document.createElement('div');
    plannedList.className = 'planned-list';
    plannedBox.appendChild(plannedList);

    const placeholderStatus = document.createElement('div');
    placeholderStatus.className = 'planned-empty';
    plannedBox.appendChild(placeholderStatus);
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
    scheduleHint.className = 'proposals-empty supporting-description';
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
      // planFilenames(...).length is the planned FILE/acquisition-run count
      // (one row per group x factor x biological replicate x TECHNICAL
      // replicate); physicalSampleCount(view.design) is the physical-specimen
      // count (technical axis excluded). Mounting a slide is a physical-
      // sample operation, so it must scale by the latter, not the former --
      // see engine/conditions.js's physicalSampleCount doc comment.
      const acquisitionRunCount = planFilenames(view, NAMING_CONFIG).length;
      const sampleCount = physicalSampleCount(view.design);
      const activeAssay = assayById(store.get(), assayId);
      const events = buildIcsSchedule({
        assayLabel: (activeAssay && activeAssay.label) || 'This assay',
        timing: view.timing,
        sampleCount,
        acquisitionRunCount,
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
      if (showToast) showToast('Downloaded micronaut-schedule.ics — import it into your calendar app.');
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
      // group has no input box any more (Samples & design is the one place it
      // is typed), but a value already saved to naming.fields.group -- from
      // before this change, or a deliberate one-off with no design at all --
      // must still reach the filename. planFilenames overrides this with the
      // design's own group label whenever the design actually has groups, so
      // this is only ever the value that survives for a design with none.
      const storedGroup = assayView(store.get(), assayId).naming?.fields?.group;
      if (storedGroup) raw.group = storedGroup;
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
      const rawFields = currentRawFields();
      lastPlanned = planFilenames(view, NAMING_CONFIG);
      advicePanel.update(view);

      // Distinct group labels actually embedded in the planned filenames --
      // reading lastPlanned rather than the design directly means this can
      // never show a group the filenames themselves disagree with.
      const groupLabels = [...new Set(lastPlanned.map((entry) => entry.groupLabel).filter(Boolean))];
      groupValue.textContent = groupLabels.length > 0 ? groupLabels.join(', ') : 'None';

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

      // Defaults remain in the preview filename exactly as the naming engine
      // produces them. This legend makes it clear that they were generated
      // for preview rather than supplied by the researcher.
      const generatedPlaceholders = FIELD_DEFS.filter(
        (field) => Object.prototype.hasOwnProperty.call(NAMING_CONFIG.defaults, field.key) && !rawFields[field.key]
      );
      placeholderStatus.textContent = '';
      if (generatedPlaceholders.length === 0) {
        placeholderStatus.textContent = 'Every required filename value in this preview was supplied.';
      } else {
        const intro = document.createElement('p');
        intro.textContent = 'Generated preview placeholders — not supplied values:';
        placeholderStatus.appendChild(intro);
        const list = document.createElement('ul');
        for (const field of generatedPlaceholders) {
          const item = document.createElement('li');
          const value = document.createElement('mark');
          value.textContent = NAMING_CONFIG.defaults[field.key];
          item.appendChild(value);
          item.append(` is a generated placeholder for ${field.label}.`);
          list.appendChild(item);
        }
        placeholderStatus.appendChild(list);
      }

      // Field-level validation runs against the fields as typed. The
      // path-length check runs per PLANNED NAME, deduped: with a design, the
      // longest row is the one that actually risks exceeding MAX_PATH, and N
      // equally-long rows should not produce N copies of one warning.
      const finalized = finalizeFields('experiment.tif', rawFields, NAMING_CONFIG);
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

    // Cross-section refresh (docs/cma-lessons.md 46/49/50): repaints this
    // section's inputs from the CURRENT store state without ever rebuilding
    // them, so a sibling section's write (e.g. confirming Modality on the
    // Acquisition panel) shows up here without the keystroke-destroying
    // full re-render lesson 46 warns against, and reads the store FRESH each
    // time it runs rather than closing over a stale snapshot -- lesson 46's
    // exact failure mode ("read current store state fresh inside the
    // handler, not the render-time closure").
    //
    // The pristine rule: an input is only repainted when it is BOTH (a) not
    // the element the person is currently focused in, and (b) still holding
    // exactly the value this section itself last painted into it -- i.e.
    // nothing has changed it since, whether that's a person mid-edit or a
    // value this function already painted moments ago. Both conditions
    // together are what let a naming box mid-edit survive a sibling's
    // refresh (measurementRefresh.test.js) while an untouched box still
    // picks up a fresh value from elsewhere.
    //
    // `date` is the one exception: an empty store value never overwrites the
    // box, matching the initial-paint rule above (today's local date is a UI
    // convenience, never something to stamp back in from an empty store).
    function syncInputsFromStore() {
      const fresh = effectiveNamingFields(assayView(store.get(), assayId));
      for (const field of FIELD_DEFS) {
        const input = inputs[field.key];
        if (!input) continue;
        if (field.key === 'date' && !fresh.date) continue;
        const nextValue = fresh[field.key] ?? '';
        const pristine = document.activeElement !== input && input.value === lastPainted[field.key];
        if (!pristine) continue;
        if (input.value !== nextValue) input.value = nextValue;
        lastPainted[field.key] = nextValue;
      }
      refreshDateHelp();
    }

    update();
    renderTimingGrid();

    return {
      id: 'naming',
      refresh() {
        syncInputsFromStore();
        update();
      },
    };
  },
  };
}
