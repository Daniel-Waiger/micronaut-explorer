// The name-builder-style interview: renders a set of questions as a grid of
// labeled boxes, each with a short label, an appropriate input, a visible
// provenance-derived confirmation state, and a labelled confirmation button.
// Built for microscopy-novice users (zen-planner Phase 1 feedback): no
// full-sentence prompts or Answer/Skip buttons -- leaving a box empty IS
// skipping it, while the explicit button is the only action that writes.
//
// Shared by the Microscopy step (ui/steps/panel.js) and the Schedule section
// of the Naming step (ui/steps/naming.js), the same
// one-implementation-not-two discipline the rest of this app follows. The
// caller supplies `questions` (engine/interview.js's phaseQuestions output,
// already annotated with currentValue/confirmed) and an `onCommit(question,
// rawValue)` that does the store write -- this module is DOM-only and knows
// nothing about the store, scopeWrite, or provenance.

import { buildQuestionControl } from './questionControl.js';

// Novice-only "Not sure? Help me choose" expanders (zen-planner
// experience-verbosity slice), keyed by the question's `field` path -- NOT
// its `id`, since `field` is the stable cross-file join key (see
// engine/interview.js's questions.json contract and lesson 50 in
// docs/cma-lessons.md: writing/reading two different key spaces for the
// "same" thing is exactly the silent-disconnect shape). Exactly three
// fields get one, chosen because they are the highest-leverage/least
// self-explanatory boxes on this step for a first-time user.
//
// modality's text is compressed from web/kb/advisor.json's existing rule
// bodies (sted-photostability, sted-pixel-nyquist, confocal-pinhole,
// confocal-sequential-scanning, widefield-thick-sample-blur,
// widefield-live-cell-strength, lightsheet-data-volume,
// em-markers-are-contrast-agents, raman-label-free-tradeoff) -- no new
// domain facts, just a compact contrast of what's already there.
// smallestFeatureNm's Nyquist-sampling sentence is compressed from
// advisor.json's `smallest-feature-pixel-size` rule; the nanometer
// reference figures below it are a plain factual explainer NOT sourced
// from the KB (advisor.json has no rule with concrete magnitude figures).
// instrument has NO advisor.json coverage at all (grepped, zero rules key
// on acquisition.instrument) -- its text is a plain factual explainer,
// also NOT KB-sourced.
const FIELD_CHOOSER_HELP = {
  'acquisition.modality':
    'Confocal is the default choice for most fixed or live samples -- a good balance of speed and optical sectioning. ' +
    'STED trades speed and dye photostability for much higher (tens-of-nanometer) resolution, worth it only if you ' +
    'truly need sub-diffraction detail. Widefield has no optical sectioning but is gentler on dim, photosensitive, or ' +
    "fast live samples; light-sheet suits large or long-timelapse specimens. SEM/TEM (structural, contrast-agent " +
    "based) and Raman (label-free, chemical) answer questions a fluorescence microscope can't.",
  'acquisition.smallestFeatureNm':
    // NOT sourced from advisor.json beyond the first sentence -- see the
    // module comment above.
    'This is the smallest structure you actually need to see clearly, in nanometers -- set it BEFORE choosing a pixel ' +
    'size, since a good pixel size is roughly 2-3x finer than this number (Nyquist sampling), not the other way ' +
    'around. For reference, whole cells run roughly 10,000-20,000 nm, organelles like mitochondria roughly ' +
    '500-1,000 nm, and individual protein clusters can be under 100 nm -- that last scale usually needs a ' +
    'super-resolution technique like STED to resolve at all.',
  'acquisition.instrument':
    // Entirely NOT sourced from advisor.json -- no existing rule keys on
    // acquisition.instrument (verified by grep).
    "This is the specific microscope model or setup (e.g. \"Leica SP8\", \"Zeiss LSM 900\", \"JEOL SEM\"), not the " +
    'general modality above. Naming it precisely lets this app (and anyone reading your notes later) look up its ' +
    "exact objectives, lasers, and detectors instead of guessing. If you don't know the exact model, check the " +
    "instrument's nameplate or ask your facility manager -- it's fine to leave this blank and fill it in later.",
};

function appendChooserHelp(cell, question) {
  const helpText = FIELD_CHOOSER_HELP[question.field];
  if (!helpText) return;
  // Same native <details>/<summary> "reveal" idiom as advice.js and
  // describe.js's "Get AI help" section -- one progressive-disclosure
  // mechanism, not a bespoke toggle.
  const details = document.createElement('details');
  details.className = 'reveal field-chooser-help';
  const summary = document.createElement('summary');
  summary.className = 'reveal-summary';
  summary.textContent = 'Not sure? Help me choose';
  details.appendChild(summary);
  const body = document.createElement('p');
  body.className = 'proposals-empty';
  body.textContent = helpText;
  details.appendChild(body);
  cell.appendChild(details);
}

/**
 * Render `questions` into `container` as a field grid.
 *
 * `onCommit(question, rawValue)` is invoked when the user clicks a box's ✓,
 * with the box's current value -- the caller writes it (STRONG) and is
 * expected to re-render so `confirmed` flips. An empty box is a no-op: an
 * unfilled field is a skipped question, never a committed blank.
 *
 * `experience` ('novice' | 'occasional' | 'frequent' | null | undefined,
 * zen-planner experience-verbosity slice) is threaded straight from the
 * step's own render(ctx) call, same as advice.js's defaultExpanded --
 * ONLY 'novice' renders the small "Not sure? Help me choose" expander
 * beneath the handful of fields in FIELD_CHOOSER_HELP above; every other
 * value (including the pre-onboarding null default) renders exactly as
 * before this slice.
 */
export function renderFieldInterview(container, { questions, onCommit, experience } = {}) {
  container.textContent = '';
  const list = Array.isArray(questions) ? questions : [];

  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'proposals-empty';
    empty.textContent = 'Nothing to fill in here right now.';
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'naming-grid';
  container.appendChild(grid);

  for (const [index, question] of list.entries()) {
    const cell = document.createElement('div');
    cell.className = 'field-row';

    const questionLabel = question.label || question.prompt || question.id || `Question ${index + 1}`;
    const labelText = document.createElement('label');
    labelText.className = 'field-label';
    labelText.textContent = questionLabel;
    cell.appendChild(labelText);

    // This is deliberately derived from phaseQuestions' supplied provenance
    // flags rather than inferred from the current input text: a filled weak
    // suggestion still needs review, while a user-confirmed answer is safe
    // to revisit and reconfirm.
    const state = document.createElement('span');
    state.className = 'field-confirmation-state';
    if (question.confirmed) {
      state.classList.add('field-confirmation-confirmed');
      state.textContent = 'Confirmed';
    } else if (question.suggestedTag) {
      state.classList.add('field-confirmation-suggested');
      state.textContent = 'Suggested — review required';
    } else {
      state.classList.add('field-confirmation-unconfirmed');
      state.textContent = 'Unconfirmed';
    }
    cell.appendChild(state);

    const commitRow = document.createElement('div');
    commitRow.className = 'field-commit-row';

    const control = buildQuestionControl(question, question.currentValue, {
      className: 'field-input',
      placeholder: question.placeholder,
    });
    const primaryInput = control.element.matches && control.element.matches('input, select')
      ? control.element
      : control.element.querySelector && control.element.querySelector('input, select');
    if (primaryInput) {
      primaryInput.id = `field-interview-${question.id || question.field || index}`.replace(/[^A-Za-z0-9_-]/g, '-');
      labelText.htmlFor = primaryInput.id;
    }
    // The hover hint (the question's "why") lives on the input itself, as
    // the box's native tooltip -- replacing the old always-visible subtitle.
    // A composite control (duration's h+min, or a choice's select+Other
    // wrapper) is a <div>/<span>, so title it AND its first input child so
    // the tooltip shows whether the pointer is over the frame or the field.
    if (question.why) {
      control.element.title = question.why;
      const firstInput = control.element.querySelector && control.element.querySelector('input, select');
      if (firstInput) firstInput.title = question.why;
    }
    commitRow.appendChild(control.element);

    const commitBtn = document.createElement('button');
    commitBtn.type = 'button';
    commitBtn.className = 'field-commit' + (question.confirmed ? ' field-commit-confirmed' : '');
    const commitLabel = question.confirmed
      ? `Update and reconfirm ${questionLabel}`
      : question.suggestedTag
        ? `Confirm suggested ${questionLabel}`
        : `Confirm ${questionLabel}`;
    // Visible action wording makes a previously-confirmed value's behaviour
    // clear; the full label gives every repeated button a unique accessible
    // name for screen-reader and keyboard users.
    commitBtn.textContent = question.confirmed ? 'Update & reconfirm' : 'Confirm';
    commitBtn.title = commitLabel;
    commitBtn.setAttribute('aria-label', commitLabel);
    commitBtn.addEventListener('click', () => {
      const raw = control.getValue();
      // Empty = skipped, never a committed blank. Number 0 (a real 0-minute
      // duration) is also treated as "nothing to schedule", matching
      // engine/render/ics.js, which omits a <= 0 stage.
      if (raw === '' || raw === undefined || raw === null) return;
      if (typeof onCommit === 'function') onCommit(question, raw);
    });
    commitRow.appendChild(commitBtn);

    cell.appendChild(commitRow);
    if (experience === 'novice') appendChooserHelp(cell, question);
    grid.appendChild(cell);
  }
}
