import { finalizeFields, renderName } from '../../engine/naming.js';
import { validateFields, validateTargetPath } from '../../engine/validation.js';
import { editTagFor } from '../../core/provenance.js';
import { formatReplicateToken } from '../../engine/conditions.js';

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
// arms, or no technical replicates (common for SEM/TEM/Raman), omits that
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

const DEFAULT_PROFILE = {
  allowedExperimentTypes: [],
  allowedMarkers: [],
  samplePattern: '^E\\d{2}$',
  magnificationPattern: '^X\\d{2,3}$',
  notesPattern: '^[A-Za-z0-9_-]+$',
  unknownMarkerPolicy: 'warn',
};

// Prefixes formatReplicateToken uses for the two number-typed replicate
// fields -- kept alongside FIELD_DEFS so currentRawFields() can look one up
// by key rather than hardcoding a branch per field.
const REPLICATE_PREFIXES = { biorep: 'B', techrep: 'T' };

const FIELD_DEFS = [
  { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
  { key: 'modality', label: 'Modality', placeholder: 'e.g. CONFOCAL' },
  { key: 'exptype', label: 'Experiment type', placeholder: 'e.g. CT' },
  { key: 'markers', label: 'Markers', placeholder: 'e.g. GFP-DAPI' },
  { key: 'magnification', label: 'Magnification', placeholder: 'e.g. X90' },
  {
    key: 'group',
    label: 'Group',
    placeholder: 'e.g. CT, NAM50MM -- set per-row by the Design step, or type one here',
  },
  { key: 'sample', label: 'Sample', placeholder: 'e.g. E02' },
  { key: 'biorep', label: 'Biological replicate #', placeholder: 'optional', type: 'number' },
  { key: 'techrep', label: 'Technical replicate #', placeholder: 'optional', type: 'number' },
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
      input.type = field.type || 'text';
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
        // authority is formatReplicateToken, reused by design.js's per-row
        // rendering so the two paths can never format replicates differently.
        raw[field.key] = prefix ? formatReplicateToken(prefix, Number(value)) : value;
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
