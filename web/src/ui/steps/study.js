// The Study step: the one study-level surface, sitting above every assay.
// First in main.js's steps array -- the landing page, and the
// discoverability surface for "this app can model more than one assay,"
// per docs/plans/planner-web-assay-tier.md's commit-2 sequencing.
//
// Rename, arm-vocabulary authoring, and the cross-assay collision check all
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
import { parseLevels } from './design.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';

/**
 * "N of M assays use LEVEL, LEVEL" -- how many assays' current arm axis
 * matches the study's vocabulary verbatim. Order-sensitive (JSON.stringify
 * on the array): a vocabulary and an assay that list the same arms in a
 * different order are NOT considered converged, since order is part of what
 * "matches the template" means here, not incidental.
 *
 * Returns null when the vocabulary is empty -- there is nothing for an
 * assay's arms to converge TO yet, so there is nothing useful to report.
 */
function armDivergenceSummary(experiment) {
  const vocabLevels =
    experiment.armVocabulary && Array.isArray(experiment.armVocabulary.levels)
      ? experiment.armVocabulary.levels
      : [];
  if (vocabLevels.length === 0) return null;

  const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
  const vocabKey = JSON.stringify(vocabLevels);
  const matching = assays.filter((assay) => {
    const levels = assay.design && assay.design.groups && assay.design.groups.levels;
    return JSON.stringify(Array.isArray(levels) ? levels : []) === vocabKey;
  }).length;

  const total = assays.length;
  return `${matching} of ${total} assay${total === 1 ? '' : 's'} use ${vocabLevels.join(', ')}`;
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

export const studyStep = {
  id: 'study',
  title: 'Study',
  render(main, store, { showToast, router } = {}) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Study';
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
    rqInput.title = 'What the whole study is trying to answer -- every assay below exists in service of this one question.';
    rqInput.value = store.get().researchQuestion || '';
    rqInput.addEventListener('input', () => {
      // Study-level, unscoped -- same one-liner pattern describe.js already
      // uses for narrative.text. Nothing else ever writes this field, so a
      // plain 'user' tag is harmless.
      store.setPath('researchQuestion', rqInput.value, 'user');
    });
    rqRow.appendChild(rqInput);
    main.appendChild(rqRow);

    // --- Group vocabulary -------------------------------------------------
    const vocabHeading = document.createElement('div');
    vocabHeading.className = 'design-subheading';
    vocabHeading.textContent = 'Group vocabulary';
    main.appendChild(vocabHeading);

    const vocabRow = document.createElement('label');
    vocabRow.className = 'field-row';
    const vocabLabel = document.createElement('span');
    vocabLabel.className = 'field-label';
    vocabLabel.textContent = 'Default groups for new assays, comma-separated';
    vocabRow.appendChild(vocabLabel);
    const vocabInput = document.createElement('input');
    vocabInput.type = 'text';
    vocabInput.className = 'field-input';
    vocabInput.placeholder = 'e.g. CTL, OPP';
    vocabInput.title =
      'A TEMPLATE, not a shared axis -- each assay gets its own copy when created, and can diverge from it freely. Used to seed new assays and by "Apply to all assays" below.';
    vocabInput.value = (store.get().armVocabulary && store.get().armVocabulary.levels || []).join(', ');
    vocabInput.addEventListener('input', () => {
      // Study-level, unscoped -- like researchQuestion above, nothing else
      // ever writes this field, so scopeWrite would only pass it through
      // unchanged; a direct setPath says that plainly instead of routing
      // through a no-op.
      store.setPath('armVocabulary', { levels: parseLevels(vocabInput.value) }, 'user');
      renderDivergence();
    });
    vocabRow.appendChild(vocabInput);
    main.appendChild(vocabRow);

    const divergenceLine = document.createElement('p');
    divergenceLine.className = 'study-divergence';
    main.appendChild(divergenceLine);

    function renderDivergence() {
      const summary = armDivergenceSummary(store.get());
      divergenceLine.textContent = summary || '';
      divergenceLine.hidden = !summary;
    }

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'add-factor-button';
    applyBtn.textContent = 'Apply to all assays';
    applyBtn.title =
      "Fills in this vocabulary's groups for every assay that hasn't customized its own -- an assay whose groups you already edited by hand is left alone.";
    applyBtn.addEventListener('click', () => {
      const experiment = store.get();
      const levels = (experiment.armVocabulary && experiment.armVocabulary.levels) || [];
      const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
      let applied = 0;
      let skipped = 0;
      for (const assay of assays) {
        const { path, slotKey } = scopeWrite(store.get(), 'design.groups', assay.id);
        // setPath refuses (returns false) when this assay's groups already
        // carry a STRONG ('user'/'user_edited') tag -- so this is naturally
        // "fill in the assays that haven't customized their arms yet," never
        // a blind overwrite. See core/store.js's setValueAtPath docstring.
        const ok = store.setPath(path, { levels: [...levels] }, 'kb-default', { slotKey });
        if (ok) applied += 1;
        else skipped += 1;
      }
      if (showToast) {
        showToast(
          skipped > 0
            ? `Applied to ${applied} assay(s); skipped ${skipped} that already have custom groups.`
            : `Applied to ${applied} assay(s).`
        );
      }
      renderAssayList();
      renderDivergence();
    });
    main.appendChild(applyBtn);

    // --- Per-assay list ---------------------------------------------------
    const listHeading = document.createElement('div');
    listHeading.className = 'design-subheading';
    listHeading.textContent = 'Assays';
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
        labelInput.placeholder = `Assay ${index + 1}`;
        labelInput.title = 'A short name for this assay, e.g. "Bacterial viability" -- shown in the switcher above.';
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
        gotoBtn.textContent = 'Go to Design';
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
              `Delete "${assay.label || `Assay ${index + 1}`}" and all its design, panel, and naming data?\n\nThis cannot be undone.`
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
        ? `This study has reached the ${MAX_STUDY_ROWS}-assay cap.`
        : 'Use "+ Add assay" in the bar above to add another assay to this study.';
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
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }
    }

    renderDivergence();
    renderAssayList();
    renderIssues();
  },
};
