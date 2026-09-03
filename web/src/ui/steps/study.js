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
import { buildExperimentMap } from '../../engine/experimentMap.js';
import { MEASUREMENT_STATUSES, measurementStatus, measurementStatusLabel } from '../../engine/measurementStatus.js';
import { BASE_TEMPLATE, NAMING_CONFIG } from './naming.js';

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
// lived here to describe a measurement's state in prose on the old list. The
// registry shows one status badge instead (engine/measurementStatus.js), which
// is the single vocabulary a reader now has to learn, so they are gone rather
// than kept as a second opinion.

export const studyStep = {
  id: 'study',
  title: 'Measurements',
  render(main, store, { showToast, router } = {}) {
    main.textContent = '';

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
    applyBtn.title =
      "Copies the active measurement's groups into every OTHER measurement that has not defined its own -- a measurement whose groups you already edited by hand is left alone.";
    applyBtn.addEventListener('click', () => {
      const experiment = store.get();
      const levels = groupSeedLevels(experiment);
      const assays = Array.isArray(experiment.assays) ? experiment.assays : [];
      if (levels.length === 0) {
        if (showToast) showToast('No measurement has groups defined yet -- add some on Samples & design first.');
        return;
      }
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
      options: [
        { value: 'all', label: 'All statuses' },
        ...MEASUREMENT_STATUSES.map((status) => ({ value: status, label: measurementStatusLabel(status) })),
      ],
      onChange: (value) => {
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

      const map = buildExperimentMap(experiment);
      const mappedById = new Map(
        (Array.isArray(map.measurements) ? map.measurements : []).map((measurement) => [measurement.id, measurement])
      );

      let shown = 0;
      assays.forEach((assay, index) => {
        const mapped = mappedById.get(assay.id) || null;
        const status = measurementStatus(mapped);
        if (statusFilter !== 'all' && status !== statusFilter) return;
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

        const statusCell = document.createElement('div');
        statusCell.className = 'measurement-registry-cell measurement-registry-status';
        const badge = document.createElement('span');
        badge.className = 'measurement-status-badge';
        badge.dataset.status = status;
        badge.textContent = measurementStatusLabel(status);
        statusCell.appendChild(badge);
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
            const ok = window.confirm(
              `Delete "${assay.label || `Measurement ${index + 1}`}" and all its design, panel, and naming data?\n\nThis cannot be undone.`
            );
            if (!ok) return;
            const result = removeAssay(store.get(), assay.id);
            if (result) {
              store.patch(result);
              renderAssayList();
              renderIssues();
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
