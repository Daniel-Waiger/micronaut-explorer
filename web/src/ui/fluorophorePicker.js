// Native, accessible fluorophore picker for the structured Color-panel editor.
// The library remains authoritative for known dyes; free text is deliberately
// available only behind one explicit "not in library" choice.

const fluorophorePickerCustomValue = '__micronaut_custom_fluorophore__';

function fluorophorePickerHasValue(options, value) {
  return options.some((option) => option.value === value);
}

export function fluorophorePickerCreate({
  options = [],
  currentValue = '',
  libraryValue = '',
  isTagLigand = false,
  onChange,
} = {}) {
  const catalog = Array.isArray(options) ? options : [];
  const savedValue = typeof currentValue === 'string' ? currentValue : '';
  const matchedLibraryValue =
    typeof libraryValue === 'string' && fluorophorePickerHasValue(catalog, libraryValue)
      ? libraryValue
      : '';

  const wrapper = document.createElement('div');
  wrapper.className = 'panel-fluorophore-picker';
  wrapper.setAttribute('role', 'group');

  const label = document.createElement('span');
  label.className = 'panel-fluorophore-label';
  label.textContent = isTagLigand ? 'Ligand dye library' : 'Fluorophore library';
  wrapper.appendChild(label);
  wrapper.setAttribute('aria-label', label.textContent);

  const select = document.createElement('select');
  select.className = 'panel-row-text panel-fluorophore-select';
  select.setAttribute('aria-label', label.textContent);

  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Select a known fluorophore…';
  select.appendChild(prompt);

  const knownGroup = document.createElement('optgroup');
  knownGroup.label = `Known fluorophores (${catalog.length})`;
  for (const entry of catalog) {
    if (!entry || typeof entry.value !== 'string' || typeof entry.label !== 'string') continue;
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    knownGroup.appendChild(option);
  }
  select.appendChild(knownGroup);

  const customOption = document.createElement('option');
  customOption.value = fluorophorePickerCustomValue;
  customOption.textContent = isTagLigand
    ? 'Not in library — add new ligand dye…'
    : 'Not in library — add new fluorophore…';
  select.appendChild(customOption);

  const customInput = document.createElement('input');
  customInput.className = 'panel-row-text panel-fluorophore-custom';
  customInput.type = 'text';
  customInput.placeholder = isTagLigand ? 'New ligand dye name' : 'New fluorophore name';
  customInput.setAttribute('aria-label', customInput.placeholder);

  const startsCustom = !matchedLibraryValue && savedValue.trim().length > 0;
  select.value = startsCustom ? fluorophorePickerCustomValue : matchedLibraryValue;
  customInput.value = startsCustom ? savedValue : '';
  customInput.hidden = !startsCustom;

  // `isStructural` (second callback arg) tells the caller whether this
  // change resolved to a REAL library fluorophore -- safe, and necessary,
  // for a caller that derives other fields (a color/filter default) from
  // the fluorophore to fully re-render. `false` for anything that doesn't:
  // switching TO custom-entry mode (nothing recognized yet) and every
  // keystroke while typing the custom name both leave this component's OWN
  // customInput on screen expecting to keep focus -- a caller-triggered
  // structural re-render there would tear down and recreate that very
  // input out from under the `customInput.focus()` call below (or the
  // user's next keystroke), moving focus to <body> mid-edit. Defaults true
  // so a caller that ignores the flag (only reads `value`) keeps its
  // previous always-fine-to-rerender behavior for the common case this was
  // always safe for: a plain library pick.
  function fluorophorePickerEmit(value, isStructural = true) {
    if (typeof onChange === 'function') onChange(value, isStructural);
  }

  select.addEventListener('change', () => {
    if (select.value === fluorophorePickerCustomValue) {
      customInput.hidden = false;
      customInput.value = '';
      fluorophorePickerEmit('', false);
      customInput.focus();
      return;
    }
    customInput.hidden = true;
    customInput.value = '';
    fluorophorePickerEmit(select.value);
  });

  customInput.addEventListener('input', () => fluorophorePickerEmit(customInput.value, false));

  wrapper.appendChild(select);
  wrapper.appendChild(customInput);
  return wrapper;
}
