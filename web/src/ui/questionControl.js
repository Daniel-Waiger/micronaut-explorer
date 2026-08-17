// Shared question-control builder: the DOM control for one interview
// question (choice/allowOther/number/text), used identically by every
// phase-scoped interview surface -- ui/steps/describe.js (phase 'project'),
// ui/steps/panel.js (phase 'microscopy'), and ui/steps/naming.js (phase
// 'timing').
//
// A leaf module (zen-planner Phase 1), not a describe.js export: describe.js
// itself imports naming.js's NAMING_CONFIG/BASE_TEMPLATE, so once naming.js
// also needed this control builder, importing it FROM describe.js would
// have closed an import cycle (naming.js -> describe.js -> naming.js) --
// tools/build_single_file.py's inliner refuses to build a cycle. A module
// both step files import FROM, importing nothing itself, has no such cycle.

// Sentinel <option> value meaning "the user picked Other" -- internal only,
// never written to the store (getValue() below always resolves it to the
// free-text box's actual content, or '' if that box is still empty).
const OTHER_OPTION_VALUE = '__other__';

/**
 * Build the control for a question, pre-filled with `initialValue`. Returns
 * `{element, getValue()}` rather than a bare element: a choice question with
 * `allowOther` composes a <select> + a free-text fallback, and a 'duration'
 * question composes two number inputs -- neither can be expressed through a
 * plain element's native `.value`.
 *
 * Shared by every phase's interview surface so none can drift apart -- an
 * editable answer must offer exactly the same choices (and the same Other
 * escape hatch) the original question did, or editing silently becomes a
 * different question.
 *
 * `options.className` (default 'question-control') is the class stamped on
 * the primary control element(s) -- the card interview passes nothing and
 * gets 'question-control'; the field grid (ui/fieldInterview.js) passes
 * 'field-input' so a box looks like a name-builder field. `options.placeholder`
 * (falling back to `question.placeholder`) fills text/number/date inputs.
 */
export function buildQuestionControl(question, initialValue, options = {}) {
  const inputClass = options.className || 'question-control';
  const placeholder = options.placeholder || question.placeholder || '';

  // 'duration' (zen-planner Phase 1): hours + minutes, STORED as total
  // minutes -- the schedule engine (engine/render/ics.js) keeps working in
  // minutes, while the user reads/enters real time units instead of an
  // arbitrary "number of minutes" the calendar questions used to demand.
  if (question.control === 'duration') {
    const total = typeof initialValue === 'number' && Number.isFinite(initialValue) ? initialValue : NaN;
    const wrapper = document.createElement('div');
    wrapper.className = 'duration-control';

    function durationPart(unitLabel, value, max) {
      const part = document.createElement('span');
      part.className = 'duration-part';
      const input = document.createElement('input');
      input.type = 'number';
      input.className = `${inputClass} duration-input`;
      input.min = '0';
      if (typeof max === 'number') input.max = String(max);
      input.placeholder = '0';
      input.inputMode = 'numeric';
      if (Number.isFinite(value)) input.value = String(value);
      const unit = document.createElement('span');
      unit.className = 'duration-unit';
      unit.textContent = unitLabel;
      part.appendChild(input);
      part.appendChild(unit);
      return { part, input };
    }

    const hours = durationPart('h', Number.isFinite(total) ? Math.floor(total / 60) : NaN);
    const minutes = durationPart('min', Number.isFinite(total) ? total % 60 : NaN, 59);
    wrapper.appendChild(hours.part);
    wrapper.appendChild(minutes.part);

    return {
      element: wrapper,
      // Empty in BOTH boxes -> '' (an unanswered duration, so the commit
      // path's `if (!raw) return` treats it as "not filled in yet"); any
      // value in either box -> total minutes as a number.
      getValue: () => {
        const hv = hours.input.value.trim();
        const mv = minutes.input.value.trim();
        if (hv === '' && mv === '') return '';
        return (Number(hv) || 0) * 60 + (Number(mv) || 0);
      },
    };
  }

  // 'date' (zen-planner Phase 1): a native date picker instead of a bare
  // text box. Value is 'YYYY-MM-DD', the exact string naming.fields.date
  // already stores, so nothing downstream changes.
  if (question.control === 'date') {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = inputClass;
    if (initialValue !== undefined && initialValue !== null) input.value = initialValue;
    return { element: input, getValue: () => input.value };
  }

  if (question.type === 'choice' || question.type === 'multi') {
    const select = document.createElement('select');
    select.className = inputClass;
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '-- choose --';
    select.appendChild(blank);
    for (const option of question.options || []) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      select.appendChild(opt);
    }

    if (!question.allowOther) {
      if (initialValue !== undefined && initialValue !== null) select.value = initialValue;
      return { element: select, getValue: () => select.value };
    }

    // allowOther: a generic escape hatch for ANY choice question, not
    // special-cased to modality. Picking "Other..." reveals a free-text box;
    // getValue() always resolves through it, never the sentinel itself, so a
    // saved answer is the user's own text, indistinguishable from having
    // typed it into a plain text question.
    const otherOpt = document.createElement('option');
    otherOpt.value = OTHER_OPTION_VALUE;
    otherOpt.textContent = 'Other...';
    select.appendChild(otherOpt);

    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.className = `${inputClass} question-other-input`;
    otherInput.placeholder = 'Type it in';
    otherInput.hidden = true;

    function syncOtherVisibility() {
      otherInput.hidden = select.value !== OTHER_OPTION_VALUE;
    }
    select.addEventListener('change', syncOtherVisibility);

    // A previously-saved value that is NOT one of the curated options means
    // the user already typed a custom answer -- reopen as Other with that
    // text prefilled, rather than silently failing to preselect anything
    // (a bare <select>.value = 'unknown option' just leaves it blank).
    if (initialValue !== undefined && initialValue !== null) {
      if ((question.options || []).includes(initialValue)) {
        select.value = initialValue;
      } else {
        select.value = OTHER_OPTION_VALUE;
        otherInput.value = initialValue;
      }
    }
    syncOtherVisibility();

    const wrapper = document.createElement('div');
    wrapper.className = 'question-control-group';
    wrapper.appendChild(select);
    wrapper.appendChild(otherInput);

    return {
      element: wrapper,
      getValue: () => (select.value === OTHER_OPTION_VALUE ? otherInput.value : select.value),
    };
  }

  const input = document.createElement('input');
  input.type = question.type === 'number' ? 'number' : 'text';
  input.className = inputClass;
  if (placeholder) input.placeholder = placeholder;
  if (initialValue !== undefined && initialValue !== null) {
    input.value = initialValue;
  }
  return { element: input, getValue: () => input.value };
}

/** Coerce a control's raw string back to the question's declared type. */
export function coerceAnswer(question, raw) {
  return question.type === 'number' ? Number(raw) : raw;
}
