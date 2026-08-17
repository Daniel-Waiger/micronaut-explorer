// The name-builder-style interview: renders a set of questions as a grid of
// labeled boxes, each with a short label, an appropriate input, a hover
// hint (the question's "why"), and a small ✓ button at the right end to
// confirm. Built for microscopy-novice users (zen-planner Phase 1 feedback):
// no full-sentence prompts, no visible subtitle, no Answer/Skip buttons --
// leaving a box empty IS skipping it, and the ✓ replaces "Answer".
//
// Shared by the Microscopy step (ui/steps/panel.js) and the Schedule section
// of the Naming step (ui/steps/naming.js), the same
// one-implementation-not-two discipline the rest of this app follows. The
// caller supplies `questions` (engine/interview.js's phaseQuestions output,
// already annotated with currentValue/confirmed) and an `onCommit(question,
// rawValue)` that does the store write -- this module is DOM-only and knows
// nothing about the store, scopeWrite, or provenance.

import { buildQuestionControl } from './questionControl.js';

/**
 * Render `questions` into `container` as a field grid.
 *
 * `onCommit(question, rawValue)` is invoked when the user clicks a box's ✓,
 * with the box's current value -- the caller writes it (STRONG) and is
 * expected to re-render so `confirmed` flips. An empty box is a no-op: an
 * unfilled field is a skipped question, never a committed blank.
 */
export function renderFieldInterview(container, { questions, onCommit } = {}) {
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

  for (const question of list) {
    const cell = document.createElement('div');
    cell.className = 'field-row';

    const labelText = document.createElement('span');
    labelText.className = 'field-label';
    labelText.textContent = question.label || question.prompt || question.id;
    cell.appendChild(labelText);

    const commitRow = document.createElement('div');
    commitRow.className = 'field-commit-row';

    const control = buildQuestionControl(question, question.currentValue, {
      className: 'field-input',
      placeholder: question.placeholder,
    });
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
    commitBtn.textContent = '✓';
    commitBtn.title = question.confirmed ? 'Confirmed — click to update' : 'Confirm this answer';
    commitBtn.setAttribute('aria-label', commitBtn.title);
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
    grid.appendChild(cell);
  }
}
