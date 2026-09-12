import { conditionIssues, formatReplicateToken } from '../../engine/conditions.js';
import { finalizeFields, renderName } from '../../engine/naming.js';
import { validateTargetPath } from '../../engine/validation.js';
import { effectiveNamingFields, planFilenames } from '../../engine/plan.js';
import { createAdvicePanel } from '../advice.js';
import { assayView, scopeWrite } from '../../core/assay.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from '../../engine/namingConfig.js';
import { appendStepHeading } from '../stepHeading.js';

// Exported so ui/steps/study.js's group-vocabulary input parses its
// comma-separated levels list with the identical rule this step's own group
// input uses -- one implementation, not a second copy that could quietly
// diverge on trimming/empty-filtering behavior.
export function parseLevels(text) {
  return String(text)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Stage 1: the stem every file in this experiment shares. Rendered once, above
 * the condition table, so the reader can see what is common before scanning
 * what differs.
 *
 * Uses effectiveNamingFields (not raw naming.fields) so the base name shows
 * the modality the interview collected as acquisition.modality, matching what
 * the per-row filenames below actually embed.
 */
function baseNameFor(store, assayId) {
  const finalized = finalizeFields(
    'experiment.tif',
    effectiveNamingFields(assayView(store.get(), assayId)),
    NAMING_CONFIG
  );
  return renderName(finalized, { ...NAMING_CONFIG, template: BASE_TEMPLATE });
}

export const designStep = {
  id: 'design',
  title: 'Samples & design',
  render(main, store, { advisor, router, embedded = false, onSectionChanged } = {}) {
    main.textContent = '';

    // measurement.js's cross-section refresh hook (A4/A2a; see
    // docs/cma-lessons.md 46/49/50): called once, synchronously, right after
    // EVERY write below actually lands in the store, naming this section so
    // the coalescing timer never re-fires refresh() on the section that just
    // wrote (it already repainted itself). `onSectionChanged` is undefined
    // for a standalone render (design.js mounted outside the Measurement
    // page) -- guarded at every call site, never assumed present.
    function notifyChanged() {
      onSectionChanged?.('design');
    }

    // Commit 1 of the assay tier (schema v3): every experiment has exactly
    // one assay and no switcher exists yet, so the active assay never
    // changes for the lifetime of one render -- caching its id once here is
    // safe, matching naming.js's identical snapshot-per-render idiom.
    const assayId = store.get().activeAssayId;

    // This scope label is deliberately derived from the active assay captured
    // for this render, just like every scoped write below. The experimental
    // unit itself remains study-level: this step displays it but never offers
    // a second editor or infers a replicate count from its wording.
    const assays = Array.isArray(store.get().assays) ? store.get().assays : [];
    const activeAssayIndex = assays.findIndex((assay) => assay && assay.id === assayId);
    const activeAssay = activeAssayIndex === -1 ? null : assays[activeAssayIndex];
    const activeMeasurementLabel = activeAssay?.label ||
      (activeAssayIndex === -1 ? 'Active measurement' : `Measurement ${activeAssayIndex + 1}`);
    appendStepHeading(main, {
      title: 'Samples & design',
      scopeText: `Planning samples and design for: ${activeMeasurementLabel}.`,
      embedded,
      id: 'measurement-section-design',
    });

    const unitRow = document.createElement('div');
    // Same label/value/owner-link shape as Measurements' research-question row.
    // Plain .field-row is a column flex built for label-over-input, which made
    // this secondary "Edit on Study map" action stretch to the full page width
    // and read as the page's primary button.
    unitRow.className = 'field-row study-readonly-row';
    const unitLabel = document.createElement('span');
    unitLabel.className = 'field-label';
    unitLabel.textContent = 'Experimental unit (study-wide)';
    unitRow.appendChild(unitLabel);
    const unitValue = document.createElement('span');
    unitValue.className = 'base-name-value field-readonly-value';
    const experimentalUnit = store.get().studyContext?.experimentalUnit;
    unitValue.textContent =
      typeof experimentalUnit === 'string' && experimentalUnit.trim() ? experimentalUnit.trim() : 'Not decided';
    unitRow.appendChild(unitValue);
    const editUnitButton = document.createElement('button');
    editUnitButton.type = 'button';
    editUnitButton.className = 'question-answer';
    editUnitButton.textContent = 'Edit on Study map';
    editUnitButton.title = 'Edit the study-wide experimental unit on the Study map.';
    editUnitButton.addEventListener('click', () => {
      if (router) router.navigate('home');
    });
    unitRow.appendChild(editUnitButton);
    main.appendChild(unitRow);

    const hierarchyHelp = document.createElement('p');
    hierarchyHelp.className = 'proposals-empty supporting-description';
    hierarchyHelp.textContent =
      'An experimental unit is what is independently assigned or sampled for the whole study. A biological (independent) replicate is another such unit; a technical replicate is a repeated measurement of the same unit. Groups are mutually exclusive alternatives, while factors can cross groups or one another to form combinations.';
    main.appendChild(hierarchyHelp);

    function currentDesign() {
      return (
        assayView(store.get(), assayId).design || {
          groups: { levels: [] },
          factors: [],
          biologicalReplicates: null,
          technicalReplicates: null,
          idScheme: '',
          conditions: [],
        }
      );
    }

    // Every write below goes through scopeWrite: the real object address is
    // this assay's index-addressed slot (assays[n].design....), but
    // provenance tracks the stable, id-addressed slotKey -- see
    // core/assay.js's module header on why an array index is not a safe
    // provenance identity.

    // Two write paths, deliberately: editing a factor's name/levels text
    // must NOT rebuild factorsList's DOM (that would destroy the very input
    // the user is mid-keystroke in, losing focus and cursor position on
    // every character). Only a structural change -- add/remove a factor --
    // needs the list rebuilt.
    function writeFactorsData(factors) {
      const { path, slotKey } = scopeWrite(store.get(), 'design.factors', assayId);
      store.setPath(path, factors, 'user', { slotKey });
      renderConditions();
      notifyChanged();
    }

    function writeFactorsStructure(factors) {
      const { path, slotKey } = scopeWrite(store.get(), 'design.factors', assayId);
      store.setPath(path, factors, 'user', { slotKey });
      renderFactors();
      renderConditions();
      notifyChanged();
    }

    // Every level here is one GROUP; a sample belongs to exactly one -- kept
    // as a single {levels} write (same shape parseLevels/writeGroups always
    // produced) so nothing downstream (conditions.js, plan.js, the group-
    // vocabulary "Apply to all assays" writer in study.js) has to change,
    // even though the UI below now edits it one named row at a time instead
    // of one comma-separated string.
    function writeGroups(levels) {
      const { path, slotKey } = scopeWrite(store.get(), 'design.groups', assayId);
      store.setPath(path, { levels }, 'user', { slotKey });
      renderConditions();
      notifyChanged();
    }

    // Two write paths, same reasoning as writeFactorsData/writeFactorsStructure
    // below: typing in a group's own text box must not rebuild groupsList
    // (that would drop focus/cursor position on every keystroke); only a
    // structural change -- add/remove a row -- needs the list rebuilt.
    function writeGroupsData(levels) {
      writeGroups(levels);
    }

    function writeGroupsStructure(levels) {
      writeGroups(levels);
      renderGroups();
    }

    // The pristine rule (docs/cma-lessons.md 46): refresh() only overwrites a
    // scalar input's displayed value when it is neither focused nor holding
    // an unconfirmed edit -- i.e. its current value still equals whatever
    // this section itself last painted into it. Tracked per field so a
    // naming/panel-driven refresh never clobbers a value the user is mid-
    // typing in THIS section while some other section's write fires the
    // coalesced timer.
    const lastPainted = { organism: '', bioRep: '', techRep: '', idScheme: '' };

    const organismRow = document.createElement('label');
    organismRow.className = 'field-row';
    const organismLabel = document.createElement('span');
    organismLabel.className = 'field-label';
    organismLabel.textContent = 'Organism / cell line';
    organismRow.appendChild(organismLabel);
    const organismInput = document.createElement('input');
    organismInput.type = 'text';
    organismInput.className = 'field-input';
    organismInput.placeholder = 'e.g. Origanum vulgare, RAW 264.7 macrophages';
    organismInput.title =
      'What organism or cell line this assay uses -- groups it with others on the same model system when you search later.';
    organismInput.addEventListener('input', () => {
      const { path, slotKey } = scopeWrite(store.get(), 'specimen.organism', assayId);
      const existingTag = store.get().provenance?.slots?.[slotKey]?.tag ?? null;
      store.setPath(path, organismInput.value, existingTag ? 'user_edited' : 'user', { slotKey });
      lastPainted.organism = organismInput.value;
      notifyChanged();
    });
    organismRow.appendChild(organismInput);
    main.appendChild(organismRow);

    const groupsHeading = document.createElement('div');
    groupsHeading.className = 'design-subheading';
    groupsHeading.textContent = 'Groups';
    main.appendChild(groupsHeading);

    const groupsHint = document.createElement('p');
    groupsHint.className = 'proposals-empty supporting-description';
    groupsHint.textContent =
      'Your experimental groups, such as a control group and one or more treatment groups. Every sample belongs to exactly ONE group.';
    main.appendChild(groupsHint);

    const groupsList = document.createElement('div');
    groupsList.className = 'factors-list';
    main.appendChild(groupsList);

    const addGroupBtn = document.createElement('button');
    addGroupBtn.type = 'button';
    addGroupBtn.className = 'add-factor-button';
    addGroupBtn.textContent = 'Add group';
    addGroupBtn.addEventListener('click', () => {
      const levels = currentDesign().groups?.levels || [];
      writeGroupsStructure([...levels, '']);
    });
    main.appendChild(addGroupBtn);

    const factorsHeading = document.createElement('div');
    factorsHeading.className = 'design-subheading';
    factorsHeading.textContent = 'Factors';
    main.appendChild(factorsHeading);

    const factorsList = document.createElement('div');
    factorsList.className = 'factors-list';
    main.appendChild(factorsList);

    const addFactorBtn = document.createElement('button');
    addFactorBtn.type = 'button';
    addFactorBtn.className = 'add-factor-button';
    addFactorBtn.textContent = 'Add factor';
    addFactorBtn.addEventListener('click', () => {
      const design = currentDesign();
      writeFactorsStructure([...(design.factors || []), { name: '', levels: [] }]);
    });
    main.appendChild(addFactorBtn);

    // Two INDEPENDENT axes, each optional -- not every sample has both kinds
    // of replicate, and some (SEM/TEM/Raman) commonly have neither. Blank on
    // either input means that axis is omitted, not "default to 1".
    function makeReplicatesRow(label, storePath, hint, lastPaintedKey) {
      const row = document.createElement('label');
      row.className = 'field-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'field-label';
      labelEl.textContent = label;
      row.appendChild(labelEl);
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'field-input';
      input.min = '1';
      input.placeholder = 'blank = not used';
      input.title = hint;
      input.addEventListener('input', () => {
        const raw = input.value;
        const { path, slotKey } = scopeWrite(store.get(), storePath, assayId);
        store.setPath(path, raw === '' ? null : Number(raw), 'user', { slotKey });
        renderConditions();
        lastPainted[lastPaintedKey] = input.value;
        notifyChanged();
      });
      row.appendChild(input);
      main.appendChild(row);
      return input;
    }

    const bioRepInput = makeReplicatesRow(
      'Biological / independent replicates',
      'design.biologicalReplicates',
      "How many independently assigned or sampled units you have. Leave blank if this doesn't apply to your experiment.",
      'bioRep'
    );
    const techRepInput = makeReplicatesRow(
      'Technical replicates',
      'design.technicalReplicates',
      "How many technical replicates you have -- repeat measurements of the SAME sample. Leave blank if this doesn't apply.",
      'techRep'
    );

    const idSchemeRow = document.createElement('label');
    idSchemeRow.className = 'field-row';
    const idSchemeLabel = document.createElement('span');
    idSchemeLabel.className = 'field-label';
    idSchemeLabel.textContent = 'Group naming override (optional)';
    idSchemeRow.appendChild(idSchemeLabel);
    const idSchemeInput = document.createElement('input');
    idSchemeInput.type = 'text';
    idSchemeInput.className = 'field-input';
    // The old placeholder ('{genotype}R{replicate}') actively TAUGHT the
    // merge: adjacent tokens with no separator between them. Leave this blank
    // and the group plus each factor gets its own segment automatically --
    // replicates are NOT part of this label; they render through their own
    // {biorep}/{techrep} slots regardless of this override.
    idSchemeInput.placeholder = 'Blank = one segment per group/factor (e.g. CTL-OPP). Tokens: {group} {biorep} {techrep} + factor names';
    idSchemeInput.title = 'Advanced, optional: customize how your group name gets built into the filename. Most people can leave this blank.';
    idSchemeRow.appendChild(idSchemeInput);
    main.appendChild(idSchemeRow);

    // advisor may be undefined (a caller that hasn't wired it, or a KB that
    // failed to load) -- createAdvicePanel([], ...) is completely inert, not
    // a missing-argument crash.
    const advicePanel = createAdvicePanel(advisor || [], 'design');
    main.appendChild(advicePanel.element);

    const issuesList = document.createElement('ul');
    issuesList.className = 'issues-list';
    main.appendChild(issuesList);

    const conditionsHeading = document.createElement('div');
    conditionsHeading.className = 'design-subheading';
    conditionsHeading.textContent = 'Condition rows';
    main.appendChild(conditionsHeading);

    // Stage 1, shown once: the stem every file below shares. Without this the
    // reader has to diff two long filenames character by character to work out
    // which part identifies the experiment and which part identifies the group.
    const baseNameBox = document.createElement('div');
    baseNameBox.className = 'base-name-box';
    const baseNameLabel = document.createElement('span');
    baseNameLabel.className = 'base-name-label';
    baseNameLabel.textContent = 'Every file starts with';
    const baseNameValue = document.createElement('code');
    baseNameValue.className = 'base-name-value';
    baseNameBox.appendChild(baseNameLabel);
    baseNameBox.appendChild(baseNameValue);
    main.appendChild(baseNameBox);

    const conditionsTable = document.createElement('div');
    conditionsTable.className = 'conditions-table';
    main.appendChild(conditionsTable);

    function renderGroups() {
      const levels = currentDesign().groups?.levels || [];
      groupsList.textContent = '';

      levels.forEach((level, index) => {
        const row = document.createElement('div');
        row.className = 'factor-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'field-input factor-levels';
        // Same text-box idiom as the Name builder's fields (naming.js's
        // FIELD_DEFS) -- the style testers specifically liked. First row
        // reads as "Control group" (the common case), every later row as a
        // treatment group, so the placeholder teaches the convention without
        // forcing the user to type the word "control" themselves.
        nameInput.placeholder = index === 0 ? 'e.g. Control group' : `e.g. Treatment group ${index}`;
        nameInput.title =
          'Every sample belongs to exactly ONE group -- give each one a short, distinct name.';
        nameInput.value = level;
        nameInput.addEventListener('input', () => {
          // Read the CURRENT store state, not this render's snapshot -- same
          // stale-closure hazard writeFactorsData's own comment documents
          // (an edit on a sibling row uses writeGroupsData, which does not
          // rebuild groupsList).
          const latest = currentDesign().groups?.levels || [];
          const next = latest.map((l, i) => (i === index ? nameInput.value : l));
          writeGroupsData(next);
        });
        row.appendChild(nameInput);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-factor-button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          const latest = currentDesign().groups?.levels || [];
          writeGroupsStructure(latest.filter((_, i) => i !== index));
        });
        row.appendChild(removeBtn);

        groupsList.appendChild(row);
      });

      if (levels.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'proposals-empty';
        empty.textContent = 'No groups yet -- add at least a control group to start.';
        groupsList.appendChild(empty);
      }
    }

    function renderFactors() {
      const design = currentDesign();
      const factors = design.factors || [];
      factorsList.textContent = '';

      factors.forEach((factor, index) => {
        const row = document.createElement('div');
        row.className = 'factor-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'field-input factor-name';
        nameInput.placeholder = 'Factor name (e.g. genotype)';
        nameInput.title =
          'Something in your experiment that varies on its own, separate from your groups above -- for example genotype or timepoint.';
        nameInput.value = factor.name || '';
        nameInput.addEventListener('input', () => {
          // Read the CURRENT store state, not the `factors` snapshot this
          // closure was created with -- writeFactorsData deliberately does
          // NOT rebuild factorsList (to keep focus while typing), so that
          // snapshot goes stale the moment the OTHER input on this same row
          // fires first. Mapping over a stale array would silently clobber
          // whichever field was edited first with its pre-edit value.
          const latest = currentDesign().factors || [];
          const next = latest.map((f, i) => (i === index ? { ...f, name: nameInput.value } : f));
          writeFactorsData(next);
        });
        row.appendChild(nameInput);

        const levelsInput = document.createElement('input');
        levelsInput.type = 'text';
        levelsInput.className = 'field-input factor-levels';
        levelsInput.placeholder = 'Levels, comma-separated (e.g. WT, KO)';
        levelsInput.title =
          'The different values this factor can take, separated by commas -- for example WT, KO for a genotype factor.';
        levelsInput.value = (factor.levels || []).join(', ');
        levelsInput.addEventListener('input', () => {
          const latest = currentDesign().factors || [];
          const next = latest.map((f, i) =>
            i === index ? { ...f, levels: parseLevels(levelsInput.value) } : f
          );
          writeFactorsData(next);
        });
        row.appendChild(levelsInput);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-factor-button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          // Same reason as the name/levels handlers above: read the CURRENT
          // store state, not the `factors` snapshot from this renderFactors()
          // call. Any name/levels edit made on ANOTHER row since this row was
          // drawn used writeFactorsData (no rebuild), so this closure's
          // `factors` array is stale and filtering it would silently discard
          // those edits when written back.
          const latest = currentDesign().factors || [];
          writeFactorsStructure(latest.filter((_, i) => i !== index));
        });
        row.appendChild(removeBtn);

        factorsList.appendChild(row);
      });
    }

    // An explicit-but-invalid replicate count (<=0, non-integer) is NOT the
    // same as an omitted one (null/undefined, meaning "this axis doesn't
    // apply") -- see engine/conditions.js effectiveReplicateCount, which
    // silently falls back to 1 for the invalid case so the row EXPANSION
    // never throws. That fallback is right for the engine (it must degrade,
    // not crash) but wrong for THIS preview: showing 'bio=B01' rows for a
    // biologicalReplicates of -5 tells the researcher their invalid entry
    // was accepted (V4-N4). So this UI-only guard renders the validation
    // error conditionIssues already produces and skips the preview build
    // entirely, rather than showing rows built from a silently-substituted 1.
    function isValidReplicateValue(raw) {
      return raw === null || raw === undefined || (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1);
    }

    function renderConditions() {
      const design = currentDesign();
      let issues = conditionIssues(design);

      // R4-12: an 'Add group' row with no name yet is a normal, in-progress
      // state, not an authoring mistake -- conditionIssues() (rightly) still
      // flags each blank level as "invalid" (buildSampleId would otherwise
      // choke on it) AND, because two blank labels collide, also flags them
      // as producing an "identical name segment" -- but that second warning
      // is only ever true BECAUSE the rows are still blank, so it is noise
      // until the researcher actually names the groups. Reworded/suppressed
      // here (display-only) rather than in engine/conditions.js: the engine's
      // job is to report every real fact, and "more than one row is still
      // blank" is exactly the fact this UI already shows via the invalid-
      // level prompt below.
      const groupLevels = design.groups?.levels || [];
      const emptyGroupCount = groupLevels.filter((level) => level === '').length;
      issues = issues
        .filter((issue) => !(
          emptyGroupCount >= 2 &&
          issue.field === 'factors' &&
          issue.message.startsWith('Multiple condition rows produce the identical name segment')
        ))
        .map((issue) => (
          issue.field === 'groups' && /^Group has an invalid level at position \d+/.test(issue.message)
            ? { ...issue, message: 'Give this group a name to include it in the design.' }
            : issue
        ));

      // renderConditions() is the verified funnel EVERY write path in this
      // step actually calls -- factor edits, group/replicate edits, the id
      // scheme input, and mount via renderAll() (which itself calls this).
      // renderAll() is called exactly once, at mount, so hooking the advice
      // panel there instead would render it once and silently never update
      // again. Reading store.get() fresh on every call (never a cached
      // snapshot) matters because store.patch() rebinds the experiment
      // root. assayView() hoists this assay's slices flat -- advisor rules
      // read acquisition.modality etc. and must never learn assays exist.
      advicePanel.update(assayView(store.get(), assayId));

      issuesList.textContent = '';
      for (const issue of issues) {
        const li = document.createElement('li');
        li.className = 'issue issue-' + issue.severity;
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }

      baseNameValue.textContent = baseNameFor(store, assayId);

      conditionsTable.textContent = '';

      // V4-N4: an explicit invalid replicate count means the whole preview is
      // built on a value the researcher must fix first -- render nothing but
      // the issues above rather than rows that silently substituted 1.
      if (!isValidReplicateValue(design.biologicalReplicates) || !isValidReplicateValue(design.technicalReplicates)) {
        const invalid = document.createElement('p');
        invalid.className = 'conditions-empty';
        invalid.textContent = 'No rows to show -- fix the replicate count issue above.';
        conditionsTable.appendChild(invalid);
        return;
      }

      // The SAME planner the Name builder renders its table from, so the two
      // steps cannot drift: one implementation, two views of it.
      const planned = planFilenames(assayView(store.get(), assayId), NAMING_CONFIG);
      if (planned.length === 0) {
        // With zero factors AND zero group levels this design still expands to
        // exactly one unconditioned row (see conditions.js), so an empty
        // TABLE here always means a real issue is already listed above (a
        // factor/group with zero usable levels, or the row cap) -- there is no
        // separate "you haven't added anything yet" case to explain.
        const empty = document.createElement('p');
        empty.className = 'conditions-empty';
        empty.textContent = 'No rows to show -- see the issues above.';
        conditionsTable.appendChild(empty);
        return;
      }

      const pathMessages = new Set();
      // Sanitization-loss issues (V4-N1): the only place a group/factor
      // level reaches naming.js is planFilenames (per row), so this is also
      // the only place they can be shown -- deduped by field+message the
      // same way pathMessages is, so N identical rows do not repeat one
      // warning N times.
      const sanitizationIssuesByKey = new Map();
      for (const entry of planned) {
        const row = entry.row;
        const rowEl = document.createElement('div');
        rowEl.className = 'condition-row';

        const summary = document.createElement('span');
        summary.className = 'condition-summary';
        const parts = [];
        if (row.group !== null && row.group !== undefined) parts.push(`group=${row.group}`);
        parts.push(...Object.entries(row.factorLevels).map(([k, v]) => `${k}=${v}`));
        const bioToken = formatReplicateToken('B', row.bioRep);
        const techToken = formatReplicateToken('T', row.techRep);
        if (bioToken) parts.push(`bio=${bioToken}`);
        if (techToken) parts.push(`tech=${techToken}`);
        summary.textContent = parts.join(', ') || '(unconditioned)';
        rowEl.appendChild(summary);

        const sampleIdEl = document.createElement('code');
        sampleIdEl.className = 'condition-sample-id';
        sampleIdEl.textContent = entry.groupLabel;
        const filenameEl = document.createElement('code');
        filenameEl.className = 'condition-filename';
        // planFilenames never throws for a bad id scheme -- it returns the
        // message per row -- so one malformed scheme cannot blank the table.
        filenameEl.textContent = entry.filename || `(${entry.error})`;
        if (entry.filename) {
          // The Design step is where MANY names are generated at once, so it
          // is where a long base name actually bites. validateTargetPath is
          // reused unchanged, never reimplemented.
          for (const issue of validateTargetPath(entry.filename)) {
            pathMessages.add(issue.message);
          }
        }
        for (const issue of entry.issues || []) {
          sanitizationIssuesByKey.set(`${issue.field}|${issue.message}`, issue);
        }
        rowEl.appendChild(sampleIdEl);
        rowEl.appendChild(filenameEl);

        conditionsTable.appendChild(rowEl);
      }

      // Rendered as its own trailing group rather than interleaved with the
      // design issues above: a path-length warning is about the FILENAME
      // (and where it will land on disk), not the design's own structure, and
      // deduping identical messages keeps N identically-long rows from
      // producing N copies of the same warning.
      for (const message of pathMessages) {
        const li = document.createElement('li');
        li.className = 'issue issue-warning';
        li.textContent = `target_path: ${message}`;
        issuesList.appendChild(li);
      }
      // Same element/class as the design issues above (`conditionIssues`)
      // and the target_path warnings just above -- one issue-rendering
      // convention, not a second one invented for this case.
      for (const issue of sanitizationIssuesByKey.values()) {
        const li = document.createElement('li');
        li.className = 'issue issue-' + issue.severity;
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }
    }

    function renderAll() {
      const design = currentDesign();
      organismInput.value = assayView(store.get(), assayId).specimen?.organism || '';
      bioRepInput.value = design.biologicalReplicates ?? '';
      techRepInput.value = design.technicalReplicates ?? '';
      idSchemeInput.value = design.idScheme || '';
      lastPainted.organism = organismInput.value;
      lastPainted.bioRep = bioRepInput.value;
      lastPainted.techRep = techRepInput.value;
      lastPainted.idScheme = idSchemeInput.value;
      renderGroups();
      renderFactors();
      renderConditions();
    }

    idSchemeInput.addEventListener('input', () => {
      const { path, slotKey } = scopeWrite(store.get(), 'design.idScheme', assayId);
      store.setPath(path, idSchemeInput.value, 'user', { slotKey });
      renderConditions();
      lastPainted.idScheme = idSchemeInput.value;
      notifyChanged();
    });

    // The cross-section refresh contract (A4/A2a): NEVER rebuild the
    // group/factor list DOM here -- that would destroy focus/caret on
    // whichever row a sibling section's write happens to coalesce with (see
    // docs/cma-lessons.md 46, the exact stale-closure-vs-focus collision this
    // task exists to avoid). Only the derived, read-only surfaces
    // (organism/replicate/idScheme boxes under the pristine rule, plus the
    // base name + condition-row table) are safe to recompute here.
    function syncScalarInputs() {
      const view = assayView(store.get(), assayId);
      const design = currentDesign();

      function syncOne(input, key, nextValue) {
        if (document.activeElement === input) return; // user is mid-edit here; never clobber
        if (input.value !== lastPainted[key]) return; // an un-committed local edit is sitting in the box
        input.value = nextValue;
        lastPainted[key] = nextValue;
      }

      syncOne(organismInput, 'organism', view.specimen?.organism || '');
      syncOne(bioRepInput, 'bioRep', design.biologicalReplicates ?? '');
      syncOne(techRepInput, 'techRep', design.technicalReplicates ?? '');
      syncOne(idSchemeInput, 'idScheme', design.idScheme || '');
    }

    function refresh() {
      syncScalarInputs();
      renderConditions();
    }

    renderAll();

    return { id: 'design', refresh };
  },
};
