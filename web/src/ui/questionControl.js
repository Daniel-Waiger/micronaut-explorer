// Shared question-control builder: the DOM control for one interview
// question (choice/allowOther/number/text), used identically by every
// phase-scoped interview surface -- ui/steps/describe.js (phase 'project'),
// ui/steps/panel.js (phase 'microscopy'), and ui/steps/naming.js (phase
// 'timing').
//
// A leaf module (zen-planner Phase 1), not a describe.js export: both
// describe.js and naming.js need this control builder, so importing it FROM
// either step file would have closed an import cycle between them --
// tools/build_single_file.py's inliner refuses to build a cycle. A module
// both step files import FROM, importing nothing itself, has no such cycle.
// (NAMING_CONFIG/BASE_TEMPLATE, once the reason naming.js and describe.js
// imported from each other, now live in their own leaf, engine/namingConfig.js.)

// Sentinel <option> value meaning "the user picked Other" -- internal only,
// never written to the store (getValue() below always resolves it to the
// free-text box's actual content, or '' if that box is still empty).
const OTHER_OPTION_VALUE = '__other__';

/**
 * Return a local-calendar value suitable for a native <input type="date">.
 * Date#toISOString() uses UTC and can therefore select yesterday or tomorrow
 * for researchers near a timezone boundary; the picker must start on the
 * calendar day the person actually sees locally.
 */
export function localDateInputValue(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A2c/V4-N2: Enter in a field-interview box commits it, exactly like
// clicking the box's own "Confirm"/"Update & reconfirm" button. This module
// builds the raw input(s) but never the commit button -- that lives one
// level up, in ui/fieldInterview.js, one button per question -- so rather
// than hand fieldInterview.js a new callback (which every phase's interview
// surface would then have to thread through unchanged), Enter walks the DOM
// upward from the control looking for the nearest '.field-commit' button and
// clicks it. That button already knows what "commit" means for this
// question (reads getValue(), no-ops on empty, calls the real onCommit) --
// clicking it is the SAME action a mouse click already takes, not a second
// implementation of it. A control used somewhere with no such ancestor
// (there is none today; every caller is a field-interview surface) simply
// finds nothing and no-ops.
function findDescendantByClass(root, className) {
  if (!root || !root.children) return null;
  for (const child of root.children) {
    if (child.classList && typeof child.classList.contains === 'function' && child.classList.contains(className)) {
      return child;
    }
    const found = findDescendantByClass(child, className);
    if (found) return found;
  }
  return null;
}

function triggerFieldCommit(el) {
  let node = el.parentNode;
  let depth = 0;
  // A handful of ancestor levels only -- the commit button is always a
  // near sibling (ui/fieldInterview.js's one '.field-row' per question),
  // never a page-wide search that could click an unrelated field's button.
  while (node && depth < 6) {
    const button = findDescendantByClass(node, 'field-commit');
    if (button && typeof button.click === 'function') {
      button.click();
      return true;
    }
    node = node.parentNode;
    depth += 1;
  }
  return false;
}

function attachEnterCommit(el) {
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    triggerFieldCommit(el);
  });
}

// A2c/V4-N2: "Unsaved -- press Enter or Confirm" -- a small status span next
// to the control, visible only while the box holds a non-empty value that
// differs from the value last painted into it (i.e. not yet committed by
// either Enter or the Confirm button). Wraps the control's own element(s) in
// a plain div; ui/fieldInterview.js already falls back to
// `control.element.querySelector('input, select')` whenever `.matches` says
// the returned element is not itself an input/select (true for the
// choice+allowOther composite below, and now true for every control), so no
// caller needs to change to find the real input inside the wrapper.
function withUnsavedCue(element, initialValue, watchInputs) {
  const wrapper = document.createElement('div');
  wrapper.className = 'question-control-wrapper';
  wrapper.appendChild(element);

  const cue = document.createElement('span');
  cue.className = 'field-unsaved-cue';
  cue.textContent = 'Unsaved — press Enter or Confirm';
  cue.hidden = true;
  wrapper.appendChild(cue);

  // The baseline is the watched inputs' OWN joined representation, captured
  // after they were pre-filled -- a scalar `initialValue` (90 minutes) never
  // equals the joined '1\u000030' the inputs hold, so a prefilled control
  // would read as Unsaved on first paint (Copilot review on PR #20).
  const signature = () =>
    watchInputs.map((input) => (input && input.value !== undefined ? String(input.value) : ''));
  const baseline = signature().join('\u0000');

  function sync() {
    const parts = signature();
    const allEmpty = parts.every((part) => part.trim() === '');
    cue.hidden = allEmpty || parts.join('\u0000') === baseline;
  }

  for (const input of watchInputs) {
    if (!input || typeof input.addEventListener !== 'function') continue;
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
  }
  sync();

  return wrapper;
}

/**
 * Build the control for a question, pre-filled with `initialValue`. Returns
 * `{element, getValue()}` rather than a bare element: a choice question with
 * `allowOther` composes a <select> + a free-text fallback, and a 'duration'
 * question composes two number inputs -- neither can be expressed through a
 * plain element's native `.value`. Every control's returned `element` is now
 * a small wrapper div (see withUnsavedCue above) around the actual
 * control(s) plus the "Unsaved" cue span -- callers that need the real
 * input/select still find it the same way they already do (see the comment
 * on withUnsavedCue).
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

    function durationPart(unitLabel, value, max, ariaUnit) {
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
      // V4-N2 (schedule spinbutton aria): the unit ("h"/"min") is a visible
      // sibling <span>, not a <label for=...> -- a screen reader announcing
      // this spinbutton on its own would otherwise say nothing but a bare
      // number. question.label ties it back to which duration this is (a
      // form can have more than one duration question).
      input.setAttribute('aria-label', question.label ? `${question.label} (${ariaUnit})` : ariaUnit);
      const unit = document.createElement('span');
      unit.className = 'duration-unit';
      unit.textContent = unitLabel;
      part.appendChild(input);
      part.appendChild(unit);
      return { part, input };
    }

    const hours = durationPart('h', Number.isFinite(total) ? Math.floor(total / 60) : NaN, undefined, 'hours');
    const minutes = durationPart('min', Number.isFinite(total) ? total % 60 : NaN, 59, 'minutes');
    wrapper.appendChild(hours.part);
    wrapper.appendChild(minutes.part);
    attachEnterCommit(hours.input);
    attachEnterCommit(minutes.input);

    return {
      element: withUnsavedCue(wrapper, undefined, [hours.input, minutes.input]),
      // Empty in BOTH boxes -> '' (an unanswered duration, so the commit
      // path's `if (!raw) return` treats it as "not filled in yet"); any
      // value in either box -> total minutes as a number.
      getValue: () => {
        const hv = hours.input.value.trim();
        const mv = minutes.input.value.trim();
        if (hv === '' && mv === '') return '';
        const totalMinutes = (Number(hv) || 0) * 60 + (Number(mv) || 0);
        // Zero and negative totals are "not answered", never a schedulable
        // duration; the commit gate treats '' as empty.
        return totalMinutes > 0 ? totalMinutes : '';
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
    // New studies start on today's local calendar day, but a stored date is
    // always authoritative -- revisiting an existing study must never replace
    // the date the researcher already selected.
    input.value = initialValue === undefined || initialValue === null || initialValue === ''
      ? localDateInputValue()
      : initialValue;
    attachEnterCommit(input);
    return { element: withUnsavedCue(input, input.value, [input]), getValue: () => input.value };
  }

  if (question.type === 'choice' || question.type === 'multi') {
    const select = document.createElement('select');
    select.className = inputClass;
    // R4-13: disabled so it can never be RE-selected once a real option is
    // picked (it is a placeholder, not a valid answer) -- but still the
    // option that ends up selected whenever no real value has been chosen
    // yet, so an untouched field reads as "nothing chosen", not as any
    // particular answer.
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose…';
    blank.disabled = true;
    select.appendChild(blank);
    for (const option of question.options || []) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      select.appendChild(opt);
    }

    if (!question.allowOther) {
      if (initialValue !== undefined && initialValue !== null) select.value = initialValue;
      attachEnterCommit(select);
      return { element: withUnsavedCue(select, select.value, [select]), getValue: () => select.value };
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
    // R4-13: an empty string is NOT such a value -- it means "unanswered",
    // the same as undefined/null -- so it must fall through to the blank
    // placeholder above rather than into the 'unknown option' branch, which
    // used to preselect 'Other...' (value !== '' is falsy but IS one of the
    // two sentinels this check exists to exclude) with an empty free-text
    // box beside it, making an untouched field look like a deliberate
    // 'Other' answer.
    if (initialValue !== undefined && initialValue !== null && initialValue !== '') {
      if ((question.options || []).includes(initialValue)) {
        select.value = initialValue;
      } else {
        select.value = OTHER_OPTION_VALUE;
        otherInput.value = initialValue;
      }
    }
    syncOtherVisibility();

    const compositeWrapper = document.createElement('div');
    compositeWrapper.className = 'question-control-group';
    compositeWrapper.appendChild(select);
    compositeWrapper.appendChild(otherInput);
    attachEnterCommit(select);
    attachEnterCommit(otherInput);

    const getValue = () => (select.value === OTHER_OPTION_VALUE ? otherInput.value : select.value);
    return {
      element: withUnsavedCue(compositeWrapper, undefined, [select, otherInput]),
      getValue,
    };
  }

  const input = document.createElement('input');
  input.type = question.type === 'number' ? 'number' : 'text';
  input.className = inputClass;
  if (placeholder) input.placeholder = placeholder;
  if (initialValue !== undefined && initialValue !== null) {
    input.value = initialValue;
  }
  attachEnterCommit(input);
  return { element: withUnsavedCue(input, input.value, [input]), getValue: () => input.value };
}

/** Coerce a control's raw string back to the question's declared type. */
export function coerceAnswer(question, raw) {
  return question.type === 'number' ? Number(raw) : raw;
}
