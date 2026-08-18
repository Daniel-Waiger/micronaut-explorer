// First-run onboarding gate (zen-planner Phase B2): a two-screen chooser
// shown once, before a genuinely new session settles on a landing page --
// "where are you in your project?" then a lighter "how familiar are you
// with this?" -- so the app can route a brand-new visitor straight to the
// step that matches their situation instead of dropping everyone on the
// same Guide page regardless of context.
//
// Implementation shape: a document.body overlay (same idiom as
// ../walkthrough.js's backdrop + centered dialog), NOT a router step. A
// router step would need an entry in main.js's `steps` array, and shell.js
// renders one permanent nav icon per entry in that array with no
// guard-based hiding -- so a step would leave a stray "onboarding" button in
// the nav forever after the gate is dismissed once. An overlay needs no
// change to shell.js/app.css: it is appended straight to document.body,
// reuses existing CSS classes (walkthrough-backdrop for the dim background;
// home-card/-icon/-title/-body for the choice buttons; step-heading/
// proposals-empty for text; home-skip-row/-link for the Skip control) via
// class names alone, plus a handful of inline positioning styles for the
// centered dialog box itself (app.css has no "centered modal" class to
// reuse, and this task's file allowlist does not include app.css).
//
// No innerHTML anywhere -- createElement/textContent only, matching the
// hard rule already followed by walkthrough.js and every other ui/ module.

import { startWalkthrough } from '../walkthrough.js';
import { saveOnboarding, ONBOARDING_LEVELS } from '../../core/onboarding.js';

// The fourth choice is deliberately NOT one of core/onboarding.js's
// ONBOARDING_STAGES ('idea'/'designing'/'acquiring') -- it is a routing
// shortcut to the Naming step for someone who is past study design
// entirely, not a fourth project stage. saveOnboarding() only persists a
// `stage` string that is in ONBOARDING_STAGES, so this choice's `stage`
// stays null and is simply never written; see completeWith() below.
const STAGE_CHOICES = [
  {
    stage: 'idea',
    icon: '\u{1F4A1}',
    title: 'Just an idea',
    body: 'Not sure where to start yet -- take an interactive tour of the app.',
  },
  {
    stage: 'designing',
    icon: '\u{1F9EA}',
    title: 'Designing my study',
    body: 'I know roughly what I am testing and need to work out the design.',
  },
  {
    stage: 'acquiring',
    icon: '\u{1F52C}',
    title: 'Ready to acquire images',
    body: 'The study design is set -- I need to plan the microscopy acquisition.',
  },
  {
    stage: null,
    routeId: 'naming',
    icon: '\u{1F5C2}\u{FE0F}',
    title: 'I already have images',
    body:
      'I need to name existing files. Note: this app does not read or extract metadata from image files -- it only helps you build a consistent naming convention by hand.',
  },
];

const EXPERIENCE_LABELS = {
  novice: {
    title: 'Novice',
    body: "I'm new to microscopy, or new to planning an experiment like this.",
  },
  occasional: {
    title: 'Occasional',
    body: "I've done this before, but not often.",
  },
  frequent: {
    title: 'Frequent',
    body: 'I do this regularly and know my way around.',
  },
};

function choiceCard(parent, { icon, title, body, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-card';
  button.addEventListener('click', onClick);

  const iconSpan = document.createElement('span');
  iconSpan.className = 'home-card-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = icon;
  button.appendChild(iconSpan);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'home-card-title';
  titleSpan.textContent = title;
  button.appendChild(titleSpan);

  const bodySpan = document.createElement('span');
  bodySpan.className = 'home-card-body';
  bodySpan.textContent = body;
  button.appendChild(bodySpan);

  parent.appendChild(button);
  return button;
}

/**
 * Show the first-run onboarding gate. `router` drives navigation to the
 * step matching whatever the user picks (or launches the interactive
 * walkthrough for the "idea" choice); `onDone()` (optional) fires once the
 * gate is dismissed by any path (a completed choice, or Skip) -- main.js
 * does not currently need it (it drives the destination step itself via
 * `router`), but is accepted for symmetry with ../walkthrough.js's
 * `onFinish` and so a future caller can hook completion without editing
 * this module's internals.
 *
 * Renders nothing into the router-managed `main` element: the overlay is
 * appended to document.body and manages its own teardown, same as
 * startWalkthrough().
 */
export function showOnboardingGate({ router, onDone } = {}) {
  let chosen = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'walkthrough-backdrop';

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Get started');
  dialog.style.position = 'fixed';
  dialog.style.left = '50%';
  dialog.style.top = '50%';
  dialog.style.transform = 'translate(-50%, -50%)';
  dialog.style.zIndex = '202';
  dialog.style.width = 'min(560px, calc(100vw - 32px))';
  dialog.style.maxHeight = 'calc(100vh - 64px)';
  dialog.style.overflowY = 'auto';
  dialog.style.background = 'var(--panel)';
  dialog.style.border = '1px solid var(--line)';
  dialog.style.borderRadius = '12px';
  dialog.style.padding = '24px';
  dialog.style.boxShadow = '0 8px 28px rgb(0 0 0 / 35%)';

  function teardown() {
    window.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    dialog.remove();
  }

  function skip() {
    saveOnboarding({ completed: true });
    teardown();
    if (typeof onDone === 'function') onDone();
  }

  // The ONLY path that sets dontShowAgain -- completing the flow normally
  // (completeWith below) or the plain Skip above both leave it false, so the
  // gate pops again on the next page load. See core/onboarding.js's module
  // header for why this is a separate flag from `completed`.
  function dontShowAgain() {
    saveOnboarding({ completed: true, dontShowAgain: true });
    teardown();
    if (typeof onDone === 'function') onDone();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') skip();
  }

  function completeWith(experience) {
    const payload = { experience, completed: true };
    if (chosen && chosen.stage) payload.stage = chosen.stage;
    saveOnboarding(payload);
    teardown();
    const destination =
      chosen && chosen.stage === 'designing'
        ? 'describe'
        : chosen && chosen.stage === 'acquiring'
          ? 'panel'
          : chosen && chosen.routeId;
    if (router && destination) router.navigate(destination);
    if (typeof onDone === 'function') onDone();
  }

  function renderExperienceScreen() {
    dialog.textContent = '';

    const heading = document.createElement('h2');
    heading.className = 'step-heading';
    heading.textContent = 'How familiar are you with this?';
    dialog.appendChild(heading);

    const subheading = document.createElement('p');
    subheading.className = 'proposals-empty';
    subheading.textContent = 'This only shapes how much explanation the app shows -- you can change it later.';
    dialog.appendChild(subheading);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '12px';
    list.style.margin = '20px 0';
    dialog.appendChild(list);

    for (const level of ONBOARDING_LEVELS) {
      const label = EXPERIENCE_LABELS[level] || { title: level, body: '' };
      choiceCard(list, {
        icon: '',
        title: label.title,
        body: label.body,
        onClick: () => completeWith(level),
      });
    }

    const actions = document.createElement('div');
    actions.className = 'walkthrough-actions';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'walkthrough-back';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', renderStageScreen);
    actions.appendChild(backBtn);
    dialog.appendChild(actions);
  }

  function renderStageScreen() {
    chosen = null;
    dialog.textContent = '';

    const heading = document.createElement('h2');
    heading.className = 'step-heading';
    heading.textContent = 'Where are you in your project?';
    dialog.appendChild(heading);

    const subheading = document.createElement('p');
    subheading.className = 'proposals-empty';
    subheading.textContent = "Pick whichever is closest -- this decides where Micronaut starts you off.";
    dialog.appendChild(subheading);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '12px';
    list.style.margin = '20px 0';
    dialog.appendChild(list);

    for (const choice of STAGE_CHOICES) {
      choiceCard(list, {
        icon: choice.icon,
        title: choice.title,
        body: choice.body,
        onClick: () => {
          if (choice.stage === 'idea') {
            saveOnboarding({ stage: 'idea', experience: 'novice', completed: true });
            teardown();
            startWalkthrough({
              router,
              onFinish: () => {
                if (typeof onDone === 'function') onDone();
              },
            });
            return;
          }
          chosen = choice;
          renderExperienceScreen();
        },
      });
    }

    const skipRow = document.createElement('p');
    skipRow.className = 'home-skip-row';
    const skipLink = document.createElement('button');
    skipLink.type = 'button';
    skipLink.className = 'home-skip-link';
    skipLink.textContent = 'Skip for now';
    skipLink.title = 'Dismiss for this visit -- this dialog will pop again the next time you open the app.';
    skipLink.addEventListener('click', skip);
    skipRow.appendChild(skipLink);
    dialog.appendChild(skipRow);

    // Separate row/control from Skip above -- Skip is a per-visit dismissal
    // (pops again next load), this is the one path that persists
    // dontShowAgain:true and stops the gate from popping at all. Distinct
    // wording so the two are never mistaken for each other.
    const dontShowRow = document.createElement('p');
    dontShowRow.className = 'home-skip-row';
    const dontShowLink = document.createElement('button');
    dontShowLink.type = 'button';
    dontShowLink.className = 'home-skip-link';
    dontShowLink.textContent = "Don't show this again";
    dontShowLink.title = 'Stop this dialog from popping up on future visits.';
    dontShowLink.addEventListener('click', dontShowAgain);
    dontShowRow.appendChild(dontShowLink);
    dialog.appendChild(dontShowRow);
  }

  backdrop.addEventListener('click', skip);
  window.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);
  document.body.appendChild(dialog);
  renderStageScreen();
}
