import { conditionIssues, formatReplicateToken } from '../../engine/conditions.js';
import { finalizeFields, renderName } from '../../engine/naming.js';
import { validateTargetPath } from '../../engine/validation.js';
import { effectiveNamingFields, planFilenames } from '../../engine/plan.js';
import { createAdvicePanel } from '../advice.js';
import { assayView, scopeWrite } from '../../core/assay.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';

// Exported so ui/steps/study.js's arm-vocabulary input parses its
// comma-separated levels list with the identical rule this step's own arm
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
  title: 'Design',
  render(main, store, { advisor } = {}) {
    main.textContent = '';

    // Commit 1 of the assay tier (schema v3): every experiment has exactly
    // one assay and no switcher exists yet, so the active assay never
    // changes for the lifetime of one render -- caching its id once here is
    // safe, matching naming.js's identical snapshot-per-render idiom.
    const assayId = store.get().activeAssayId;

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Experimental design';
    main.appendChild(heading);

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
    }

    function writeFactorsStructure(factors) {
      const { path, slotKey } = scopeWrite(store.get(), 'design.factors', assayId);
      store.setPath(path, factors, 'user', { slotKey });
      renderFactors();
      renderConditions();
    }

    // The arm axis is ONE input (a comma-separated levels list, same
    // convention as a factor's levels), not a repeated row -- there is
    // nothing structural to add/remove, so unlike factors there is only ever
    // one write path and no stale-closure risk from a sibling control.
    function writeGroups(levels) {
      const { path, slotKey } = scopeWrite(store.get(), 'design.groups', assayId);
      store.setPath(path, { levels }, 'user', { slotKey });
      renderConditions();
    }

    const groupsHeading = document.createElement('div');
    groupsHeading.className = 'design-subheading';
    groupsHeading.textContent = 'Groups (arms)';
    main.appendChild(groupsHeading);

    const groupsRow = document.createElement('label');
    groupsRow.className = 'field-row';
    const groupsLabel = document.createElement('span');
    groupsLabel.className = 'field-label';
    groupsLabel.textContent = 'Mutually exclusive arms, comma-separated';
    groupsRow.appendChild(groupsLabel);
    const groupsInput = document.createElement('input');
    groupsInput.type = 'text';
    groupsInput.className = 'field-input';
    // Deliberately NOT "e.g. CT, NAM25MM, treatment": that phrasing is what
    // caused 'CT' and 'NAM50MM' to be entered as two SEPARATE factors and
    // crossed against each other in the first place. Every level here is one
    // ARM; a sample belongs to exactly one.
    groupsInput.placeholder = 'e.g. CTL, OPP -- a sample is exactly ONE of these';
    // Native browser tooltip, on top of the placeholder example above.
    groupsInput.title =
      'Your experimental groups, such as control vs. treated. Every sample belongs to exactly one -- list them separated by commas.';
    groupsInput.addEventListener('input', () => {
      writeGroups(parseLevels(groupsInput.value));
    });
    groupsRow.appendChild(groupsInput);
    main.appendChild(groupsRow);

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
    function makeReplicatesRow(label, storePath, hint) {
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
      });
      row.appendChild(input);
      main.appendChild(row);
      return input;
    }

    const bioRepInput = makeReplicatesRow(
      'Biological replicates',
      'design.biologicalReplicates',
      "How many biological replicates you have -- different animals, dishes, or samples. Leave blank if this doesn't apply to your experiment."
    );
    const techRepInput = makeReplicatesRow(
      'Technical replicates',
      'design.technicalReplicates',
      "How many technical replicates you have -- repeat measurements of the SAME sample. Leave blank if this doesn't apply."
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
    // and the arm plus each factor gets its own segment automatically --
    // replicates are NOT part of this label; they render through their own
    // {biorep}/{techrep} slots regardless of this override.
    idSchemeInput.placeholder = 'Blank = one segment per arm/factor (e.g. CTL-OPP). Tokens: {group} {biorep} {techrep} + factor names';
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

    function renderConditions() {
      const design = currentDesign();
      const issues = conditionIssues(design);

      // renderConditions() is the verified funnel EVERY write path in this
      // step actually calls -- factor edits, arm/replicate edits, the id
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
      // The SAME planner the Name builder renders its table from, so the two
      // steps cannot drift: one implementation, two views of it.
      const planned = planFilenames(assayView(store.get(), assayId), NAMING_CONFIG);
      if (planned.length === 0) {
        // With zero factors AND zero arm levels this design still expands to
        // exactly one unconditioned row (see conditions.js), so an empty
        // TABLE here always means a real issue is already listed above (a
        // factor/arm with zero usable levels, or the row cap) -- there is no
        // separate "you haven't added anything yet" case to explain.
        const empty = document.createElement('p');
        empty.className = 'conditions-empty';
        empty.textContent = 'No rows to show -- see the issues above.';
        conditionsTable.appendChild(empty);
        return;
      }

      const pathMessages = new Set();
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
    }

    function renderAll() {
      const design = currentDesign();
      groupsInput.value = (design.groups && design.groups.levels ? design.groups.levels : []).join(', ');
      bioRepInput.value = design.biologicalReplicates ?? '';
      techRepInput.value = design.technicalReplicates ?? '';
      idSchemeInput.value = design.idScheme || '';
      renderFactors();
      renderConditions();
    }

    idSchemeInput.addEventListener('input', () => {
      const { path, slotKey } = scopeWrite(store.get(), 'design.idScheme', assayId);
      store.setPath(path, idSchemeInput.value, 'user', { slotKey });
      renderConditions();
    });

    renderAll();
  },
};
