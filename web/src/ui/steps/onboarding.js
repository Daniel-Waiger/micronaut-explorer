// One-time example disclosure. Main owns every lifecycle decision; this
// module only records dismissal and reports which of the two first-run choices
// the visitor chose. Existing stage/experience preferences are deliberately
// left untouched so older verbosity choices remain readable.

import { saveOnboarding } from '../../core/onboarding.js';
import { createIcon } from '../icons.js';

const EXAMPLE_CHOICES = [
  {
    id: 'blank',
    icon: 'study',
    title: 'Plan my study',
    body: 'Start with your own Study map. The completed oregano example remains available to explore.',
  },
  {
    id: 'explore',
    icon: 'home',
    title: 'Explore a completed example',
    body: 'Open the oregano example to see a completed plan. Changes stay in the example until you make a copy.',
  },
];

const RETURNING_CHOICES = [
  {
    id: 'walkthrough',
    icon: 'study',
    title: 'Take a guided walkthrough',
    body: 'See the recommended order for shaping a study, then continue from the step that needs attention.',
  },
  {
    id: 'continue',
    icon: 'home',
    title: 'Continue planning',
    body: 'Close this guide and keep working in the current study. Nothing in your plan will change.',
  },
];

function onboardingChoiceCard(parent, choice, onChoose) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-card onboarding-choice';
  button.dataset.onboardingChoice = choice.id;
  button.addEventListener('click', () => onChoose(choice.id));

  const icon = document.createElement('span');
  icon.className = 'home-card-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(createIcon(choice.icon, 'home-card-glyph'));

  const title = document.createElement('span');
  title.className = 'home-card-title';
  title.textContent = choice.title;

  const body = document.createElement('span');
  body.className = 'home-card-body';
  body.textContent = choice.body;

  button.append(icon, title, body);
  parent.appendChild(button);
}

/**
 * Show the first-entry chooser or a safe returning-user guide. The latter is
 * intentionally available from Utilities for every study origin: reopening
 * onboarding must never silently fail just because the visitor has already
 * started a real project.
 */
export function showOnboardingGate({
  isExample = true,
  onWalkThrough,
  onExplore,
  onStartBlank,
  onDone,
} = {}) {
  let closed = false;

  const backdrop = document.createElement('div');
  backdrop.className = 'onboarding-choice-backdrop';
  backdrop.dataset.onboardingBackdrop = '';

  const dialog = document.createElement('section');
  dialog.className = 'onboarding-choice-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'onboarding-choice-title');
  dialog.setAttribute('aria-describedby', 'onboarding-choice-disclosure');

  const heading = document.createElement('h2');
  heading.id = 'onboarding-choice-title';
  heading.className = 'step-heading';
  heading.textContent = isExample ? 'Choose how to begin' : 'Find your bearings';

  const disclosure = document.createElement('p');
  disclosure.id = 'onboarding-choice-disclosure';
  disclosure.className = 'onboarding-choice-disclosure';
  disclosure.textContent = isExample
    ? 'You are looking at a completed example: Oregano wound-healing · 4 measurements. It is not your study.'
    : 'This is your current study. Use the walkthrough for a guided route through the planner, or continue exactly where you left off.';

  const choices = document.createElement('div');
  choices.className = 'onboarding-choice-list';

  function teardown() {
    window.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    dialog.remove();
  }

  function complete(choice) {
    if (closed) return;
    closed = true;
    saveOnboarding({ completed: true });
    teardown();

    if (choice === 'blank' && typeof onStartBlank === 'function') onStartBlank();
    else if (choice === 'explore' && typeof onExplore === 'function') onExplore();
    else if (choice === 'walkthrough' && typeof onWalkThrough === 'function') onWalkThrough();

    if (typeof onDone === 'function') onDone(choice);
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    complete(isExample ? 'explore' : 'continue');
  }

  (isExample ? EXAMPLE_CHOICES : RETURNING_CHOICES)
    .forEach((choice) => onboardingChoiceCard(choices, choice, complete));
  backdrop.addEventListener('click', () => complete(isExample ? 'explore' : 'continue'));
  window.addEventListener('keydown', onKeydown);

  dialog.append(heading, disclosure, choices);
  document.body.append(backdrop, dialog);

  const firstChoice = choices.querySelector('button');
  if (firstChoice && typeof firstChoice.focus === 'function') firstChoice.focus();

  return {
    close() { complete(isExample ? 'explore' : 'continue'); },
  };
}
