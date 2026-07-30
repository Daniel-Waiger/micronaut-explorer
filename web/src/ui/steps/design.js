import { buildSampleId, conditionIssues, expandConditions } from '../../engine/conditions.js';
import { finalizeFields, renderName } from '../../engine/naming.js';
import { NAMING_CONFIG } from './naming.js';

function parseLevels(text) {
  return String(text)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function filenameForRow(row, design, store, sampleId) {
  const namingFields = store.getPath('naming.fields') || {};
  const raw = { ...namingFields, sample: sampleId };
  const finalized = finalizeFields('experiment.tif', raw, NAMING_CONFIG);
  return renderName(finalized, NAMING_CONFIG);
}

export const designStep = {
  id: 'design',
  title: 'Design',
  render(main, store) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Experimental design';
    main.appendChild(heading);

    function currentDesign() {
      return (
        store.getPath('design') || { factors: [], replicates: null, idScheme: '', conditions: [] }
      );
    }

    // Two write paths, deliberately: editing a factor's name/levels text
    // must NOT rebuild factorsList's DOM (that would destroy the very input
    // the user is mid-keystroke in, losing focus and cursor position on
    // every character). Only a structural change -- add/remove a factor --
    // needs the list rebuilt.
    function writeFactorsData(factors) {
      store.setPath('design.factors', factors, 'user');
      renderConditions();
    }

    function writeFactorsStructure(factors) {
      store.setPath('design.factors', factors, 'user');
      renderFactors();
      renderConditions();
    }

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

    const replicatesRow = document.createElement('label');
    replicatesRow.className = 'field-row';
    const replicatesLabel = document.createElement('span');
    replicatesLabel.className = 'field-label';
    replicatesLabel.textContent = 'Biological replicates';
    replicatesRow.appendChild(replicatesLabel);
    const replicatesInput = document.createElement('input');
    replicatesInput.type = 'number';
    replicatesInput.className = 'field-input';
    replicatesInput.min = '1';
    replicatesRow.appendChild(replicatesInput);
    main.appendChild(replicatesRow);

    const idSchemeRow = document.createElement('label');
    idSchemeRow.className = 'field-row';
    const idSchemeLabel = document.createElement('span');
    idSchemeLabel.className = 'field-label';
    idSchemeLabel.textContent = 'Sample ID scheme';
    idSchemeRow.appendChild(idSchemeLabel);
    const idSchemeInput = document.createElement('input');
    idSchemeInput.type = 'text';
    idSchemeInput.className = 'field-input';
    idSchemeInput.placeholder = 'e.g. {genotype}R{replicate}';
    idSchemeRow.appendChild(idSchemeInput);
    main.appendChild(idSchemeRow);

    const issuesList = document.createElement('ul');
    issuesList.className = 'issues-list';
    main.appendChild(issuesList);

    const conditionsHeading = document.createElement('div');
    conditionsHeading.className = 'design-subheading';
    conditionsHeading.textContent = 'Condition rows';
    main.appendChild(conditionsHeading);

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

      issuesList.textContent = '';
      for (const issue of issues) {
        const li = document.createElement('li');
        li.className = 'issue issue-' + issue.severity;
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }

      conditionsTable.textContent = '';
      const rows = expandConditions(design);
      if (rows.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'conditions-empty';
        empty.textContent = (design.factors || []).length === 0
          ? 'Add at least one factor to see condition rows.'
          : 'No rows to show -- see the issues above.';
        conditionsTable.appendChild(empty);
        return;
      }

      const hasIdSchemeIssue = issues.some((issue) => issue.field === 'idScheme');
      for (const row of rows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'condition-row';

        const summary = document.createElement('span');
        summary.className = 'condition-summary';
        const parts = Object.entries(row.factorLevels).map(([k, v]) => `${k}=${v}`);
        parts.push(`replicate=${row.replicate}`);
        summary.textContent = parts.join(', ');
        rowEl.appendChild(summary);

        const sampleIdEl = document.createElement('code');
        sampleIdEl.className = 'condition-sample-id';
        const filenameEl = document.createElement('code');
        filenameEl.className = 'condition-filename';
        if (hasIdSchemeIssue) {
          sampleIdEl.textContent = '';
          filenameEl.textContent = '(fix the id scheme above)';
        } else {
          try {
            // buildSampleId is called ONCE per row and its result reused for
            // both the sample-id column and the filename, rather than
            // calling it twice (which would double the defense-in-depth
            // try/catch and risk the two columns disagreeing on failure).
            const sampleId = buildSampleId(row, design.idScheme || '');
            sampleIdEl.textContent = sampleId;
            filenameEl.textContent = filenameForRow(row, design, store, sampleId);
          } catch (err) {
            // Defense-in-depth: conditionIssues should already have caught an
            // unknown id-scheme token, but buildSampleId's throw must never
            // reach the user as a white screen regardless.
            sampleIdEl.textContent = '';
            filenameEl.textContent = `(${err.message})`;
          }
        }
        rowEl.appendChild(sampleIdEl);
        rowEl.appendChild(filenameEl);

        conditionsTable.appendChild(rowEl);
      }
    }

    function renderAll() {
      const design = currentDesign();
      replicatesInput.value = design.replicates ?? '';
      idSchemeInput.value = design.idScheme || '';
      renderFactors();
      renderConditions();
    }

    replicatesInput.addEventListener('input', () => {
      const raw = replicatesInput.value;
      store.setPath('design.replicates', raw === '' ? null : Number(raw), 'user');
      renderConditions();
    });

    idSchemeInput.addEventListener('input', () => {
      store.setPath('design.idScheme', idSchemeInput.value, 'user');
      renderConditions();
    });

    renderAll();
  },
};
