// The Measurements step: the one study-level surface, sitting above every assay.
// First in main.js's steps array -- the landing page, and the
// discoverability surface for "this app can model more than one assay,"
// per docs/plans/planner-web-assay-tier.md's commit-2 sequencing.
//
// Rename, group-vocabulary authoring, and the cross-assay collision check all
// live here rather than in the always-visible switcher (ui/shell.js), which
// only owns switch/add/delete -- this step is where a user reviews and
// corrects study SHAPE, not just navigates it.
//
// No advice panel: every advisor rule keys on a per-assay fact
// (acquisition.modality, etc.); study shape is not a guidance surface the KB
// models today.

import { assayView, removeAssay, scopeWrite } from '../../core/assay.js';
import { effectiveNamingFields, MAX_STUDY_ROWS, studyNameIssues } from '../../engine/plan.js';
import { finalizeFields, renderName } from '../../engine/naming.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';

/**
 * "N of M assays use this vocabulary" -- how many assays' current group axis
 * matches the study's vocabulary verbatim. Order-sensitive (JSON.stringify
 * on the array): a vocabulary and an assay that list the same groups in a
 * different order are NOT considered converged, since order is part of what
 * "matches the template" means here, not incidental.
 *
 * Returns null when the vocabulary is empty -- there is nothing for an
 * assay's groups to converge TO yet, so there is nothing useful to report.
 */
function groupDivergenceSummary(experiment) {
  const vocabLevels =
    experiment.groupVocabulary && Array.isArray(experiment.groupVocabulary.levels)
      ? experiment.groupVocabulary.levels
      : [];
  if (vocabLevels.length === 0) return null;

  const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
  const vocabKey = JSON.stringify(vocabLevels);
  const matching = assays.filter((assay) => {
    const levels = assay.design && assay.design.groups && assay.design.groups.levels;
    return JSON.stringify(Array.isArray(levels) ? levels : []) === vocabKey;
  }).length;

  const total = assays.length;
  return `${matching} of ${total} measurement${total === 1 ? '' : 's'} reuse these comparison labels.`;
}

function studyGroupTokens(value) {
  return String(value)
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStudyGroups(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Mirrors design.js's baseNameFor exactly, for one assay by id. Named
 * differently (studyAssayBaseName, not baseNameFor) because the
 * single-file inliner (tools/build_single_file.py) concatenates every
 * module's top-level names into ONE shared scope -- two modules each
 * declaring a private `baseNameFor` would collide the moment they're
 * flattened together, even though each is module-private in source.
 */
function studyAssayBaseName(store, assayId) {
  const finalized = finalizeFields(
    'experiment.tif',
    effectiveNamingFields(assayView(store.get(), assayId)),
    NAMING_CONFIG
  );
  return renderName(finalized, { ...NAMING_CONFIG, template: BASE_TEMPLATE });
}

function measurementReadout(assay) {
  const value = assay && (assay.readoutText || assay.readout);
  return value || 'Intended observation not yet described.';
}

function measurementSystemSummary(experiment, assay) {
  const specimen = assay && assay.specimen && typeof assay.specimen === 'object' ? assay.specimen : {};
  const system =
    experiment && experiment.studyContext && typeof experiment.studyContext.system === 'string'
      ? experiment.studyContext.system.trim()
      : '';
  const values = [system, specimen.organism, specimen.sampleType, specimen.preparation]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  const seen = new Set();
  const unique = values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.join(' · ');
}

function progressStateLabel(state) {
  const labels = {
    'not-started': 'Not started',
    'in-progress': 'In progress',
    'needs-attention': 'Decision needed',
    complete: 'Ready for now',
  };
  return labels[state] || '';
}

function measurementPlanningState(workflowProgress, assayId) {
  const assays = workflowProgress && Array.isArray(workflowProgress.assays) ? workflowProgress.assays : [];
  const progress = assays.find((assay) => assay && assay.id === assayId);
  if (!progress || !progress.steps) return '';

  const design = progressStateLabel(progress.steps.design && progress.steps.design.state);
  const acquisition = progressStateLabel(progress.steps.microscopy && progress.steps.microscopy.state);
  if (!design && !acquisition) return '';
  return `Samples & design: ${design || 'Not started'} · Acquisition: ${acquisition || 'Not started'}`;
}

export const studyStep = {
  id: 'study',
  title: 'Measurements',
  render(main, store, { showToast, router, workflowProgress } = {}) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Measurements';
    main.appendChild(heading);

    // --- Research question -------------------------------------------
    const rqRow = document.createElement('label');
    rqRow.className = 'field-row';
    const rqLabel = document.createElement('span');
    rqLabel.className = 'field-label';
    rqLabel.textContent = 'Research question';
    rqRow.appendChild(rqLabel);
    const rqInput = document.createElement('input');
    rqInput.type = 'text';
    rqInput.className = 'field-input';
    rqInput.placeholder = 'e.g. Does an oregano-plasma coating reduce bacterial load on wound dressings?';
    rqInput.title = 'What the whole study is trying to answer -- every measurement below exists in service of this one question.';
    rqInput.value = store.get().researchQuestion || '';
    rqInput.addEventListener('input', () => {
      // Study-level, unscoped -- same one-liner pattern describe.js already
      // uses for narrative.text. Nothing else ever writes this field, so a
      // plain 'user' tag is harmless.
      store.setPath('researchQuestion', rqInput.value, 'user');
    });
    rqRow.appendChild(rqInput);
    main.appendChild(rqRow);

    // --- Shared comparison labels -----------------------------------------
    const vocabHeading = document.createElement('div');
    vocabHeading.className = 'design-subheading';
    vocabHeading.textContent = 'Comparison labels';
    main.appendChild(vocabHeading);

    const vocabHelp = document.createElement('p');
    vocabHelp.className = 'proposals-empty';
    vocabHelp.textContent =
      'Reuse these labels when measurements compare groups or conditions. Observational studies may have no comparison labels.';
    main.appendChild(vocabHelp);

    const vocabRow = document.createElement('div');
    vocabRow.className = 'field-row';
    const vocabLabel = document.createElement('span');
    vocabLabel.className = 'field-label';
    vocabLabel.id = 'study-group-vocabulary-label';
    vocabLabel.textContent = 'Labels to reuse for comparisons';
    vocabRow.appendChild(vocabLabel);
    const tokenField = document.createElement('div');
    tokenField.className = 'study-group-token-field';
    tokenField.setAttribute('role', 'group');
    tokenField.setAttribute('aria-labelledby', vocabLabel.id);
    vocabRow.appendChild(tokenField);
    const tokenList = document.createElement('div');
    tokenList.className = 'study-group-token-list';
    tokenField.appendChild(tokenList);
    const vocabInput = document.createElement('input');
    vocabInput.type = 'text';
    vocabInput.className = 'study-group-token-input';
    vocabInput.placeholder = 'Type a comparison label, then press Enter';
    vocabInput.setAttribute('aria-label', 'Add a comparison label');
    vocabInput.title =
      'A reusable seed, not a shared live axis -- each measurement keeps its own copy and can diverge freely. Used to seed new measurements and by "Apply to all measurements" below.';
    tokenField.appendChild(vocabInput);

    function vocabularyLevels() {
      const levels = store.get().groupVocabulary && store.get().groupVocabulary.levels;
      return Array.isArray(levels) ? levels : [];
    }

    function saveVocabulary(levels) {
      store.setPath('groupVocabulary', { levels }, 'user');
      renderGroupTokens();
      renderDivergence();
    }

    function renderGroupTokens() {
      tokenList.textContent = '';
      vocabularyLevels().forEach((group, index) => {
        const token = document.createElement('span');
        token.className = 'study-group-token';
        const text = document.createElement('span');
        text.className = 'study-group-token-text';
        text.textContent = group;
        token.appendChild(text);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'study-group-token-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove comparison label ${group}`);
        remove.addEventListener('pointerdown', (event) => {
          // Keep pointer removal from blurring and committing the adjacent
          // input before this same control receives its click.
          event.preventDefault();
        });
        remove.addEventListener('click', () => {
          saveVocabulary(vocabularyLevels().filter((_, itemIndex) => itemIndex !== index));
          vocabInput.focus();
        });
        token.appendChild(remove);
        tokenList.appendChild(token);
      });
    }

    function commitPendingGroups(rawValue = vocabInput.value) {
      const additions = studyGroupTokens(rawValue);
      if (additions.length === 0) return false;
      saveVocabulary(uniqueStudyGroups([...vocabularyLevels(), ...additions]));
      vocabInput.value = '';
      return true;
    }

    vocabInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ',') return;
      event.preventDefault();
      commitPendingGroups();
    });
    vocabInput.addEventListener('blur', (event) => {
      // Moving from the input to a token's Remove button must not rebuild
      // the token list before that button receives its click.
      if (event.relatedTarget && tokenField.contains(event.relatedTarget)) return;
      commitPendingGroups();
    });
    vocabInput.addEventListener('paste', (event) => {
      const pasted = event.clipboardData && event.clipboardData.getData('text');
      if (!pasted || !/[,\n]/.test(pasted)) return;
      event.preventDefault();
      commitPendingGroups(`${vocabInput.value}${vocabInput.value ? ',' : ''}${pasted}`);
    });
    tokenField.addEventListener('click', (event) => {
      if (event.target === tokenField || event.target === tokenList) vocabInput.focus();
    });
    main.appendChild(vocabRow);

    const divergenceLine = document.createElement('p');
    divergenceLine.className = 'study-divergence';
    main.appendChild(divergenceLine);

    function renderDivergence() {
      const summary = groupDivergenceSummary(store.get());
      divergenceLine.textContent = summary || '';
      divergenceLine.hidden = !summary;
    }

    renderGroupTokens();

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'add-factor-button';
    applyBtn.textContent = 'Apply to all measurements';
    applyBtn.title =
      "Seeds these comparison labels into every measurement that has not customized its own groups -- a measurement whose groups you already edited by hand is left alone.";
    applyBtn.addEventListener('click', () => {
      const experiment = store.get();
      const levels = (experiment.groupVocabulary && experiment.groupVocabulary.levels) || [];
      const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
      let applied = 0;
      let skipped = 0;
      for (const assay of assays) {
        const { path, slotKey } = scopeWrite(store.get(), 'design.groups', assay.id);
        // setPath refuses (returns false) when this assay's groups already
        // carry a STRONG ('user'/'user_edited') tag -- so this is naturally
        // "fill in the assays that haven't customized their groups yet," never
        // a blind overwrite. See core/store.js's setValueAtPath docstring.
        const ok = store.setPath(path, { levels: [...levels] }, 'kb-default', { slotKey });
        if (ok) applied += 1;
        else skipped += 1;
      }
      if (showToast) {
        showToast(
          skipped > 0
            ? `Applied to ${applied} measurement(s); skipped ${skipped} that already have custom groups.`
            : `Applied to ${applied} measurement(s).`
        );
      }
      renderAssayList();
      renderDivergence();
    });
    main.appendChild(applyBtn);

    // --- Per-measurement list ---------------------------------------------
    const listHeading = document.createElement('div');
    listHeading.className = 'design-subheading';
    listHeading.textContent = 'Measurements';
    main.appendChild(listHeading);

    const assayList = document.createElement('div');
    assayList.className = 'factors-list';
    main.appendChild(assayList);

    function renderAssayList() {
      assayList.textContent = '';
      const experiment = store.get();
      const assays = Array.isArray(experiment.assays) ? experiment.assays : [];

      assays.forEach((assay, index) => {
        const row = document.createElement('div');
        row.className = 'factor-row study-assay-row';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'field-input';
        labelInput.placeholder = `Measurement ${index + 1}`;
        labelInput.title = 'A short name for this measurement, e.g. "Bacterial viability" -- shown in the switcher above.';
        labelInput.value = assay.label || '';
        labelInput.addEventListener('input', () => {
          const { path, slotKey } = scopeWrite(store.get(), 'label', assay.id);
          store.setPath(path, labelInput.value, 'user', { slotKey });
          // Only the issues list, NOT renderAssayList() -- rebuilding this
          // row's own DOM mid-keystroke would destroy the very input the
          // user is typing in, losing focus and cursor position on every
          // character (the same stale-render hazard design.js's factor
          // inputs already document). A collision message quotes each
          // assay's CURRENT label, so it must stay live too.
          renderIssues();
        });
        row.appendChild(labelInput);

        const details = document.createElement('div');
        details.className = 'study-assay-details';
        const readout = document.createElement('p');
        readout.className = 'study-assay-readout';
        readout.textContent = `Readout / intended observation: ${measurementReadout(assay)}`;
        details.appendChild(readout);
        const systemSummary = measurementSystemSummary(experiment, assay);
        if (systemSummary) {
          const system = document.createElement('p');
          system.className = 'study-assay-system';
          system.textContent = `System or specimen: ${systemSummary}`;
          details.appendChild(system);
        }
        const planningState = measurementPlanningState(workflowProgress, assay.id);
        if (planningState) {
          const progress = document.createElement('p');
          progress.className = 'study-assay-progress';
          progress.textContent = planningState;
          details.appendChild(progress);
        }
        row.appendChild(details);

        const baseNameEl = document.createElement('code');
        baseNameEl.className = 'base-name-value study-assay-basename';
        baseNameEl.textContent = studyAssayBaseName(store, assay.id);
        row.appendChild(baseNameEl);

        // Grouped and pinned to the row's end (margin-left: auto on the
        // group, not the individual buttons) -- otherwise each button's
        // horizontal position depends on how long THIS row's base name
        // happens to be, so it visibly shifts from row to row as the base
        // name varies (e.g. the scratch assay's much longer modality token).
        const actions = document.createElement('div');
        actions.className = 'study-assay-actions';
        row.appendChild(actions);

        const gotoBtn = document.createElement('button');
        gotoBtn.type = 'button';
        gotoBtn.className = 'question-answer';
        gotoBtn.textContent = 'Continue planning this measurement';
        gotoBtn.addEventListener('click', () => {
          store.patch({ activeAssayId: assay.id });
          if (router) router.navigate('design');
        });
        actions.appendChild(gotoBtn);

        if (assays.length > 1) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'remove-factor-button';
          removeBtn.textContent = 'Delete';
          removeBtn.addEventListener('click', () => {
            const ok = window.confirm(
              `Delete "${assay.label || `Measurement ${index + 1}`}" and all its design, panel, and naming data?\n\nThis cannot be undone.`
            );
            if (!ok) return;
            const result = removeAssay(store.get(), assay.id);
            if (result) {
              store.patch(result);
              renderAssayList();
              renderDivergence();
              renderIssues();
            }
          });
          actions.appendChild(removeBtn);
        }

        assayList.appendChild(row);
      });
    }

    const addAssayHint = document.createElement('p');
    addAssayHint.className = 'proposals-empty';
    const assayCount = Array.isArray(store.get().assays) ? store.get().assays.length : 0;
    addAssayHint.textContent =
      assayCount >= MAX_STUDY_ROWS
        ? `This study has reached the ${MAX_STUDY_ROWS}-measurement cap.`
        : 'Use "+ Add measurement" in the bar above to add another measurement to this study.';
    main.appendChild(addAssayHint);

    // --- Cross-assay collision check --------------------------------------
    const issuesHeading = document.createElement('div');
    issuesHeading.className = 'design-subheading';
    issuesHeading.textContent = 'Study-wide issues';
    main.appendChild(issuesHeading);

    const issuesList = document.createElement('ul');
    issuesList.className = 'issues-list';
    main.appendChild(issuesList);

    function renderIssues() {
      const issues = studyNameIssues(store.get(), NAMING_CONFIG, BASE_TEMPLATE);
      issuesList.textContent = '';
      for (const issue of issues) {
        const li = document.createElement('li');
        li.className = 'issue issue-' + issue.severity;
        // studyNameIssues remains the sole collision validator.
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }
    }

    renderDivergence();
    renderAssayList();
    renderIssues();
  },
};
