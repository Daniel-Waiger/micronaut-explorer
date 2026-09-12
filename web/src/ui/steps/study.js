// The Measurements REGISTRY: a searchable, filterable list of the study's
// measurements, and the way into any one of them.
//
// This is a registry -> detail pattern rather than a step in a sequence. A row
// carries what you would scan for -- name, readout, modality, comparison
// groups, replicates, status -- and opens the measurement's own page
// (ui/steps/measurement.js), where its design, acquisition and data plan all
// live together.
//
// The research question is NOT editable here any more. It was previously
// writable from this step AND from the Study map, so one fact had two owners
// and could diverge depending on which screen you happened to be on. The Study
// map owns it; this page displays it and links back. That is the same
// read-only-plus-"Edit on Study map" pattern Samples & design already uses for
// the experimental unit.
//
// Groups are typed once, per measurement, on that measurement's own Samples
// & design page -- this page only shows them (the registry's Groups column)
// and offers a "copy to measurements that have none" shortcut, a property of
// the measurement COLLECTION rather than any one measurement. The
// cross-assay collision check stays here for the same reason.
//
// No advice panel: every advisor rule keys on a per-assay fact
// (acquisition.modality, etc.); study shape is not a guidance surface the KB
// models today.

import { assayView, groupSeedLevels, removeAssay, scopeWrite, seedAssayGroups } from '../../core/assay.js';
import { effectiveNamingFields, MAX_STUDY_ROWS, studyNameIssues } from '../../engine/plan.js';
import { finalizeFields, renderName } from '../../engine/naming.js';
import { shortId } from '../../core/ids.js';
import {
  MEASUREMENT_STATUS_FILTERS,
  MEASUREMENT_STATUS_SCOPES,
  MEASUREMENT_STATUS_TONES,
  measurementStatus,
  measurementStatusLabel,
} from '../../engine/measurementStatus.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from '../../engine/namingConfig.js';

// One row matches a query when any of the things a person would actually
// search by contains it. Deliberately not fuzzy: a surprising near-match in a
// list of your own measurements is worse than no match.
function measurementMatchesQuery(assay, mapped, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    assay?.label,
    mapped?.readout,
    mapped?.modality,
    mapped?.specimenSummary,
    ...(Array.isArray(mapped?.groups) ? mapped.groups : []),
  ]
    .filter((value) => typeof value === 'string' && value)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function registrySelect(parent, { label, options, onChange }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'measurement-registry-filter';
  const text = document.createElement('span');
  text.className = 'measurement-registry-filter-label';
  text.textContent = label;
  wrapper.appendChild(text);
  const select = document.createElement('select');
  select.className = 'field-input measurement-registry-select';
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrapper.appendChild(select);
  parent.appendChild(wrapper);
  return select;
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

// measurementSystemSummary / measurementPlanningState / progressStateLabel
// lived here to describe a measurement's state in prose on the old list. That
// prose collapsed three separate questions -- is it DEFINED, does its PLAN
// still need a decision, do its export CHECKS pass -- into one word, which is
// exactly what engine/measurementStatus.js now refuses to do: it reports
// definition/plan/conformance as three scoped axes plus a `headline` (the
// first axis not already at its best status) and that headline's `tone`. The
// registry renders the headline as the row's main badge and the OTHER two
// axes as muted chips in the same status cell (no new grid column -- see
// app.css:4996's 7-column template), so the detail a reader used to lose is
// visible again without a second, competing vocabulary.

export const studyStep = {
  id: 'study',
  title: 'Measurements',
  render(main, store, { showToast, router, workflowProgress, getWorkflowProgress } = {}) {
    main.textContent = '';

    // The render-time snapshot renderAssayList() reads for ordinary view
    // changes (search/filter, delete) -- deliberately NOT recomputed per
    // keystroke. store.setPath (the copy-groups path below) mutates `assays`
    // IN PLACE, so main.js:497-501's `assays !== lastAssays` re-render guard
    // never fires for it and this snapshot would go stale; that one path
    // reassigns `currentProgress` via `getWorkflowProgress()` before
    // re-rendering. See main.js's own comment on `getWorkflowProgress` for
    // the producer side of this.
    let currentProgress = workflowProgress && typeof workflowProgress === 'object' ? workflowProgress : {};

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Measurements';
    main.appendChild(heading);

    // --- Research question (read-only; the Study map owns it) --------------
    const rqRow = document.createElement('div');
    rqRow.className = 'field-row study-readonly-row';
    const rqLabel = document.createElement('span');
    rqLabel.className = 'field-label';
    rqLabel.textContent = 'Research question';
    rqRow.appendChild(rqLabel);
    const rqValue = document.createElement('span');
    rqValue.className = 'field-readonly-value';
    const rqText = typeof store.get().researchQuestion === 'string' ? store.get().researchQuestion.trim() : '';
    rqValue.textContent = rqText || 'Not decided yet.';
    rqRow.appendChild(rqValue);
    const rqEdit = document.createElement('button');
    rqEdit.type = 'button';
    rqEdit.className = 'question-answer';
    rqEdit.textContent = 'Edit on Study map';
    rqEdit.addEventListener('click', () => {
      if (router) router.navigate('home');
    });
    rqRow.appendChild(rqEdit);
    main.appendChild(rqRow);

    // --- Groups -------------------------------------------------------------
    // Groups are typed exactly once, per measurement, on that measurement's
    // own Samples & design (ui/steps/design.js). This page only ever shows
    // them (the registry's Groups column below) and offers a one-click way to
    // reuse an existing measurement's groups on the others.
    const groupsHeading = document.createElement('div');
    groupsHeading.className = 'design-subheading';
    groupsHeading.textContent = 'Groups';
    main.appendChild(groupsHeading);

    const groupsHelp = document.createElement('p');
    groupsHelp.className = 'proposals-empty supporting-description';
    groupsHelp.textContent =
      'Each measurement defines its own groups on its Samples & design page. Observational studies may have none.';
    main.appendChild(groupsHelp);

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'add-factor-button';
    applyBtn.textContent = 'Copy groups to measurements that have none';
    // groupSeedLevels (core/assay.js) reads ONLY the active measurement's own
    // groups (V6-NEW-02: it used to fall back to the first OTHER measurement
    // with groups, which could silently copy a measurement this tooltip
    // never named). Disabling the button when the active measurement itself
    // has no groups keeps the button's action exactly what its tooltip
    // promises.
    //
    // Recomputed by updateApplyBtnState(), called from renderAssayList()
    // rather than once here at initial render: the active measurement can
    // change without a full re-render of this button (Delete reassigns
    // activeAssayId via core/assay.js's removeAssay when the active,
    // groupless measurement is the one removed), and leaving disabled/title
    // stale would show "add some groups first" for a measurement that now
    // has groups, or vice versa.
    function updateApplyBtnState() {
      const seedLevels = groupSeedLevels(store.get()).filter((level) => String(level ?? '').trim());
      applyBtn.disabled = seedLevels.length === 0;
      applyBtn.title = applyBtn.disabled
        ? 'The active measurement has no groups of its own yet -- add some on its Samples & design page first.'
        : "Copies the active measurement's groups into every OTHER measurement that has not defined its own -- a measurement with its own groups already on record (however they got there) is left alone.";
    }
    updateApplyBtnState();
    applyBtn.addEventListener('click', () => {
      const experiment = store.get();
      // Blank rows (a just-clicked "Add group") are not groups to copy.
      const levels = groupSeedLevels(experiment).filter((level) => String(level ?? '').trim());
      const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
      const activeAssayId = experiment.activeAssayId;
      if (levels.length === 0) {
        if (showToast) showToast('The active measurement has no groups defined yet -- add some on Samples & design first.');
        return;
      }
      let applied = 0;
      let skipped = 0;
      for (const assay of assays) {
        // R6-09: the SOURCE measurement (the active one groupSeedLevels reads
        // from) must never be counted -- it already holds these exact
        // levels, so writing them back and possibly refusing (STRONG over
        // STRONG at a DIFFERENT tag) is not a "skip", it is a no-op the user
        // never asked for and the toast must not report.
        if (assay.id === activeAssayId) continue;
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
      // store.setPath above mutates `assays` IN PLACE (core/store.js), so
      // main.js:497-501's `assays !== lastAssays` re-render subscriber does
      // NOT fire for this path and `currentProgress` would otherwise still
      // hold the pre-copy snapshot. Re-derive it explicitly before
      // re-rendering -- this is the one path that needs to, per this
      // function's closure notes above.
      if (getWorkflowProgress) currentProgress = getWorkflowProgress();
      renderAssayList();
    });
    main.appendChild(applyBtn);

    // --- The registry -----------------------------------------------------
    const listHeading = document.createElement('div');
    listHeading.className = 'design-subheading';
    listHeading.textContent = 'Measurements';
    main.appendChild(listHeading);

    // Filter state is deliberately render-local and unsaved: it describes how
    // someone is looking at the list right now, not anything about the study.
    let query = '';
    let statusFilter = 'all';
    let modalityFilter = 'all';

    const controls = document.createElement('div');
    controls.className = 'measurement-registry-controls';
    main.appendChild(controls);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'field-input measurement-registry-search';
    search.placeholder = 'Search by name, readout, modality, specimen, or group…';
    search.setAttribute('aria-label', 'Search measurements');
    search.addEventListener('input', () => {
      query = search.value;
      renderAssayList();
    });
    controls.appendChild(search);

    const statusSelect = registrySelect(controls, {
      label: 'Status',
      // Fed straight from MEASUREMENT_STATUS_FILTERS (engine/measurementStatus.js)
      // -- there is no second, hand-authored status vocabulary for this
      // select to drift out of sync with.
      options: [{ value: 'all', label: 'All statuses' }, ...MEASUREMENT_STATUS_FILTERS],
      onChange: (value) => {
        // Each option's value is `scope:status` (e.g. 'plan:needs-decision');
        // matched against that same scope on the row's status record below.
        statusFilter = value;
        renderAssayList();
      },
    });

    const modalitySelect = registrySelect(controls, {
      label: 'Modality',
      options: [{ value: 'all', label: 'All modalities' }],
      onChange: (value) => {
        modalityFilter = value;
        renderAssayList();
      },
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'copy-button measurement-registry-add';
    addBtn.textContent = '+ New measurement';
    addBtn.addEventListener('click', () => {
      const current = store.get();
      const assays = Array.isArray(current.assays) ? current.assays : [];
      if (assays.length >= MAX_STUDY_ROWS) {
        if (showToast) showToast(`This study has reached the ${MAX_STUDY_ROWS}-measurement cap.`);
        return;
      }
      // Same seeding path the shell's switcher uses, so a measurement created
      // here is identical to one created there -- one way to make one.
      const id = shortId();
      const { assay, provenanceSlotKey, provenanceEntry } = seedAssayGroups(groupSeedLevels(current), id);
      store.patch((state) => ({
        assays: [...state.assays, assay],
        activeAssayId: id,
        provenance: { ...state.provenance, slots: { ...state.provenance.slots, [provenanceSlotKey]: provenanceEntry } },
      }));
      if (router) router.navigate('measurement');
    });
    controls.appendChild(addBtn);

    const assayList = document.createElement('div');
    assayList.className = 'measurement-registry';
    assayList.setAttribute('role', 'list');
    main.appendChild(assayList);

    const emptyRow = document.createElement('p');
    emptyRow.className = 'proposals-empty supporting-description';
    main.appendChild(emptyRow);

    function openMeasurement(assayId) {
      store.patch({ activeAssayId: assayId });
      if (router) router.navigate('measurement');
    }

    function renderModalityOptions(assays) {
      const modalities = [...new Set(
        assays
          .map((assay) => (assay.acquisition && typeof assay.acquisition.modality === 'string' ? assay.acquisition.modality.trim() : ''))
          .filter(Boolean)
      )].sort();
      const previous = modalityFilter;
      modalitySelect.textContent = '';
      for (const option of [{ value: 'all', label: 'All modalities' }, ...modalities.map((m) => ({ value: m, label: m }))]) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        modalitySelect.appendChild(node);
      }
      // A filter whose modality no longer exists would hide every row with no
      // visible cause, so it falls back to "all" rather than silently sticking.
      modalityFilter = modalities.includes(previous) ? previous : 'all';
      modalitySelect.value = modalityFilter;
    }

    function appendCell(row, className, text, title) {
      const cell = document.createElement('div');
      cell.className = `measurement-registry-cell ${className}`;
      cell.textContent = text;
      if (title) cell.title = title;
      row.appendChild(cell);
      return cell;
    }

    function renderAssayList() {
      assayList.textContent = '';
      const experiment = store.get();
      const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
      renderModalityOptions(assays);
      addBtn.disabled = assays.length >= MAX_STUDY_ROWS;
      updateApplyBtnState();

      // Read off `currentProgress` (the render-time snapshot, refreshed only
      // on the copy-groups path -- see the closure notes above `let
      // currentProgress` and inside applyBtn's click handler) rather than
      // rebuilding a second, conformance-free map here.
      const measurements = Array.isArray(currentProgress.map && currentProgress.map.measurements)
        ? currentProgress.map.measurements
        : [];
      const mappedById = new Map(measurements.map((measurement) => [measurement.id, measurement]));
      const progressAssays = Array.isArray(currentProgress.assays) ? currentProgress.assays : [];
      const statusById = new Map(progressAssays.map((entry) => [entry.id, entry.status]));

      let shown = 0;
      assays.forEach((assay, index) => {
        const mapped = mappedById.get(assay.id) || null;
        // `measurementStatus(null)` is the module's own all-lowest fallback
        // (definition:draft headline) for the case -- never expected in
        // practice -- where this assay is absent from the progress snapshot.
        const status = statusById.get(assay.id) || measurementStatus(null);
        if (statusFilter !== 'all') {
          const [scope, wantStatus] = statusFilter.split(':');
          if (status[scope] !== wantStatus) return;
        }
        if (modalityFilter !== 'all') {
          const modality = assay.acquisition && typeof assay.acquisition.modality === 'string' ? assay.acquisition.modality.trim() : '';
          if (modality !== modalityFilter) return;
        }
        if (!measurementMatchesQuery(assay, mapped, query)) return;
        shown += 1;

        const row = document.createElement('div');
        row.className = 'measurement-registry-row';
        row.setAttribute('role', 'listitem');
        if (assay.id === experiment.activeAssayId) row.dataset.active = 'true';

        const nameCell = document.createElement('div');
        nameCell.className = 'measurement-registry-cell measurement-registry-name';
        // The whole name is the control that opens the measurement -- a real
        // button, so it is keyboard reachable and announces itself, rather
        // than a click handler bolted onto the row.
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'measurement-registry-open';
        open.textContent = assay.label || `Measurement ${index + 1}`;
        open.setAttribute('aria-label', `Open ${assay.label || `Measurement ${index + 1}`}`);
        open.addEventListener('click', () => openMeasurement(assay.id));
        nameCell.appendChild(open);
        const readout = measurementReadout(assay);
        const readoutLine = document.createElement('p');
        readoutLine.className = 'measurement-registry-readout';
        readoutLine.textContent = readout;
        nameCell.appendChild(readoutLine);
        row.appendChild(nameCell);

        // One status cell, one status record: the headline badge plus the
        // other two axes as muted chips -- no new grid column (app.css:4996's
        // 7-column template stays untouched). Every label AND every data
        // attribute below reads off this same `status` record, so a badge's
        // text and its data-* attributes cannot disagree with each other.
        const statusCell = document.createElement('div');
        statusCell.className = 'measurement-registry-cell measurement-registry-status';
        const badgeGroup = document.createElement('div');
        badgeGroup.className = 'measurement-status-badges';
        statusCell.appendChild(badgeGroup);

        const headlineBadge = document.createElement('span');
        headlineBadge.className = 'measurement-status-badge';
        headlineBadge.dataset.scope = status.headline.scope;
        headlineBadge.dataset.status = status.headline.status;
        headlineBadge.dataset.tone = status.tone;
        headlineBadge.textContent = measurementStatusLabel(status.headline.scope, status.headline.status);
        badgeGroup.appendChild(headlineBadge);

        for (const scope of MEASUREMENT_STATUS_SCOPES) {
          if (scope === status.headline.scope) continue;
          const scopedStatus = status[scope];
          const chip = document.createElement('span');
          chip.className = 'measurement-status-chip';
          chip.dataset.scope = scope;
          chip.dataset.status = scopedStatus;
          chip.dataset.tone = (MEASUREMENT_STATUS_TONES[scope] && MEASUREMENT_STATUS_TONES[scope][scopedStatus]) || 'neutral';
          chip.textContent = measurementStatusLabel(scope, scopedStatus);
          badgeGroup.appendChild(chip);
        }
        row.appendChild(statusCell);

        appendCell(row, 'measurement-registry-modality', mapped?.modality || '—');

        const groups = Array.isArray(mapped?.groups) ? mapped.groups : [];
        appendCell(row, 'measurement-registry-groups', groups.length ? groups.join(' vs ') : '—', groups.join(', '));

        const bio = mapped?.biologicalReplicates;
        const tech = mapped?.technicalReplicates;
        const replicates = [
          Number.isFinite(bio) ? `${bio} biological` : null,
          Number.isFinite(tech) ? `${tech} technical` : null,
        ].filter(Boolean).join(', ');
        appendCell(row, 'measurement-registry-replicates', replicates || '—');

        appendCell(row, 'measurement-registry-basename', studyAssayBaseName(store, assay.id));

        const actions = document.createElement('div');
        actions.className = 'measurement-registry-cell study-assay-actions';
        row.appendChild(actions);

        if (assays.length > 1) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'remove-factor-button';
          removeBtn.textContent = 'Delete';
          removeBtn.setAttribute('aria-label', `Delete ${assay.label || `Measurement ${index + 1}`}`);
          removeBtn.addEventListener('click', () => {
            const deletedLabel = assay.label || `Measurement ${index + 1}`;
            const ok = window.confirm(
              `Delete "${deletedLabel}" and all its design, panel, and naming data?\n\nEarlier autosaves in Restore may still contain it for a while; the study as it is now will not.`
            );
            if (!ok) return;
            const result = removeAssay(store.get(), assay.id);
            if (result) {
              store.patch(result);
              renderAssayList();
              renderIssues();
              if (showToast) showToast(`Deleted "${deletedLabel}" and its design, panel, and naming data.`);
            }
          });
          actions.appendChild(removeBtn);
        }

        assayList.appendChild(row);
      });

      // Distinguish "this study has no measurements" from "your filters hide
      // them all" -- the fix is different, so the message must be too.
      const filtering = Boolean(query.trim()) || statusFilter !== 'all' || modalityFilter !== 'all';
      emptyRow.hidden = shown > 0;
      emptyRow.textContent = assays.length === 0
        ? 'No measurements yet. Add the first one to start planning.'
        : filtering
          ? 'No measurement matches these filters.'
          : '';
    }

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

    renderAssayList();
    renderIssues();
  },
};
