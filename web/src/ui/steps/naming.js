import { finalizeFields, renderName } from '../../engine/naming.js';
import { validateFields, validateTargetPath } from '../../engine/validation.js';
import { editTagFor } from '../../core/provenance.js';

// Interim defaults until the P1 knowledge pack supplies a real profile and
// per-lab naming config -- mirrors microscopy_naming_assistant's
// default_config()/default_profile() so behaviour matches Classic today.
export const NAMING_CONFIG = {
  template: '{date}_{exptype}_{sample}_{magnification}_{markers}_{notes}{ext}',
  defaults: {
    date: '1970-01-01',
    exptype: 'UNKNOWN',
    sample: 'UNKNOWN',
    magnification: 'UNKNOWN',
    markers: 'UNKNOWN',
    notes: 'UNSPECIFIED',
  },
  uppercaseFields: ['exptype', 'sample', 'magnification', 'markers'],
  safeCharPattern: '[^A-Za-z0-9_-]+',
};

const DEFAULT_PROFILE = {
  allowedExperimentTypes: [],
  allowedMarkers: [],
  samplePattern: '^E\\d{2}$',
  magnificationPattern: '^X\\d{2,3}$',
  notesPattern: '^[A-Za-z0-9_-]+$',
  unknownMarkerPolicy: 'warn',
};

const FIELD_DEFS = [
  { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
  { key: 'exptype', label: 'Experiment type', placeholder: 'e.g. CT' },
  { key: 'sample', label: 'Sample', placeholder: 'e.g. E02' },
  { key: 'magnification', label: 'Magnification', placeholder: 'e.g. X90' },
  { key: 'markers', label: 'Markers', placeholder: 'e.g. GFP-DAPI' },
  { key: 'notes', label: 'Notes', placeholder: 'optional' },
];

/**
 * Copy `text` to the clipboard. navigator.clipboard can be restricted under
 * file:// or by permissions policy even when it exists, so fall back to the
 * classic hidden-textarea + execCommand('copy') trick.
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export const namingStep = {
  id: 'naming',
  title: 'Naming',
  render(main, store) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Name builder';
    main.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'naming-grid';
    main.appendChild(grid);

    const inputs = {};
    for (const field of FIELD_DEFS) {
      const row = document.createElement('label');
      row.className = 'field-row';

      const labelText = document.createElement('span');
      labelText.className = 'field-label';
      labelText.textContent = field.label;
      row.appendChild(labelText);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'field-input';
      input.placeholder = field.placeholder;
      input.value = store.getPath(`naming.fields.${field.key}`) || '';
      input.addEventListener('input', () => {
        const path = `naming.fields.${field.key}`;
        // 'user_edited' when correcting an existing WEAK/PROVISIONAL value
        // (e.g. one filled in from an accepted free-text proposal), plain
        // 'user' for a first-ever entry or one already STRONG -- see
        // core/provenance.js editTagFor.
        const existingTag = store.get().provenance?.slots?.[path]?.tag ?? null;
        store.setPath(path, input.value, editTagFor(existingTag));
        update();
      });
      inputs[field.key] = input;
      row.appendChild(input);
      grid.appendChild(row);
    }

    const previewBox = document.createElement('div');
    previewBox.className = 'preview-box';
    const previewLabel = document.createElement('div');
    previewLabel.className = 'preview-label';
    previewLabel.textContent = 'Filename preview';
    const previewName = document.createElement('code');
    previewName.className = 'preview-name';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-button';
    copyBtn.textContent = 'Copy filename';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(previewName.textContent);
      copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy filename';
      }, 1500);
    });
    previewBox.appendChild(previewLabel);
    previewBox.appendChild(previewName);
    previewBox.appendChild(copyBtn);
    main.appendChild(previewBox);

    const issuesList = document.createElement('ul');
    issuesList.className = 'issues-list';
    main.appendChild(issuesList);

    function currentRawFields() {
      // Only include a field once the user has actually typed something --
      // finalizeFields merges {...config.defaults, ...raw}, so an included
      // blank string would OVERRIDE a sensible default (e.g. exptype's
      // 'UNKNOWN') with 'UNSPECIFIED' instead of leaving the default in
      // place until the field is genuinely filled in.
      const raw = {};
      for (const field of FIELD_DEFS) {
        const value = inputs[field.key].value;
        if (value) raw[field.key] = value;
      }
      return raw;
    }

    function update() {
      const raw = currentRawFields();
      const finalized = finalizeFields('experiment.tif', raw, NAMING_CONFIG);
      const filename = renderName(finalized, NAMING_CONFIG);
      previewName.textContent = filename;

      const issues = validateFields(finalized, DEFAULT_PROFILE).concat(
        validateTargetPath(filename)
      );
      issuesList.textContent = '';
      for (const issue of issues) {
        const li = document.createElement('li');
        li.className = 'issue issue-' + issue.severity;
        li.textContent = `${issue.field}: ${issue.message}`;
        issuesList.appendChild(li);
      }
    }

    update();
  },
};
