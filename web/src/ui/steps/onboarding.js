// One-time example disclosure. Main owns every lifecycle decision; this
// module only records dismissal and reports which of the three equal doors
// the visitor chose. Existing stage/experience preferences are deliberately
// left untouched so older verbosity choices remain readable.

import { saveOnboarding } from '../../core/onboarding.js';
import { createIcon } from '../icons.js';

const EXAMPLE_CHOICES = [
  {
    id: 'walkthrough',
    icon: 'walkthrough',
    title: 'Walk through example',
    body: 'Follow the oregano study through the seven workflow steps with a contextual guide.',
  },
  {
    id: 'explore',
    icon: 'home',
    title: 'Explore myself',
    body: 'Keep the example open and use the workspace normally, without guided navigation.',
  },
  {
    id: 'blank',
    icon: 'study',
    title: 'Start blank',
    body: 'Replace the example with a new empty study. The example remains available from Utilities.',
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
 * Show the example-only first-entry chooser.
 *
 * The caller is responsible for proving the current study is the shipped
 * example before invoking this view. Every exit marks onboarding complete;
 * backdrop and Escape deliberately select Explore rather than Start blank.
 */
export function showOnboardingGate({
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
  heading.textContent = 'Choose how to begin';

  const disclosure = document.createElement('p');
  disclosure.id = 'onboarding-choice-disclosure';
  disclosure.className = 'onboarding-choice-disclosure';
  disclosure.textContent = 'You are looking at an example study: Oregano wound-healing · 4 assays. Nothing here is your data yet.';

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

    if (choice === 'walkthrough' && typeof onWalkThrough === 'function') onWalkThrough();
    else if (choice === 'blank' && typeof onStartBlank === 'function') onStartBlank();
    else if (typeof onExplore === 'function') onExplore();

    if (typeof onDone === 'function') onDone(choice);
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    complete('explore');
  }

  EXAMPLE_CHOICES.forEach((choice) => onboardingChoiceCard(choices, choice, complete));
  backdrop.addEventListener('click', () => complete('explore'));
  window.addEventListener('keydown', onKeydown);

  dialog.append(heading, disclosure, choices);
  document.body.append(backdrop, dialog);

  const firstChoice = choices.querySelector('button');
  if (firstChoice && typeof firstChoice.focus === 'function') firstChoice.focus();

  return {
    close() { complete('explore'); },
  };
}
