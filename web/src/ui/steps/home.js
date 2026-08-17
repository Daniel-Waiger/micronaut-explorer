// The Home step (zen-planner Phase 1's reframe): the app's landing page and
// the discoverability point for "start here." Pure static content plus
// navigation -- no store reads beyond what a card's own destination step
// will read for itself, matching guide.js's posture of never disagreeing
// with app state by depending on it.
//
// The walkthrough is the DEFAULT entry experience for a first-time visitor
// -- main.js auto-navigates a brand-new session to the Guide step once,
// before this step is ever seen, and marks it seen so a reload does not
// repeat the redirect (see main.js's WALKTHROUGH_SEEN_KEY). This step is
// what a user who has already been through it, or who chose "Skip the
// walkthrough" below, actually lands on. The "Take the walkthrough" card
// below launches the real interactive tour (ui/walkthrough.js, zen-planner
// Phase 5) -- the auto-redirect only ever lands on the Guide page itself,
// which now also offers to start the same tour with its own button.
//
// Exported so main.js can call it directly (loadWalkthroughSeen/
// saveWalkthroughSeen): the one-shot first-visit redirect decision has to be
// made before the router's first render, which is main.js's job, not this
// step's own render() -- see that module's boot sequence.

import { startWalkthrough } from '../walkthrough.js';

const WALKTHROUGH_SEEN_KEY = 'micronaut.walkthroughSeen';

export function loadWalkthroughSeen() {
  try {
    return localStorage.getItem(WALKTHROUGH_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveWalkthroughSeen() {
  try {
    localStorage.setItem(WALKTHROUGH_SEEN_KEY, '1');
  } catch {
    // Persistence here is a convenience, matching every other localStorage
    // write in this app (shell.js's THEME_KEY, etc.) -- a failed write only
    // means the choice won't survive a reload, not worth surfacing.
  }
}

// One big clickable tile: a title, a short line of what it does, and the
// step it navigates to. "Thumbnail" here means a large, low-text target,
// not a rendered image -- an emoji glyph (matching shell.js's NAV_STEP_ICONS
// idiom) stands in for a picture without this zero-dependency app needing an
// image asset pipeline.
function card(parent, { icon, title, body, onClick }) {
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

export const homeStep = {
  id: 'home',
  title: 'Home',
  render(main, store, { router } = {}) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Plan a microscopy experiment';
    main.appendChild(heading);

    const subheading = document.createElement('p');
    subheading.className = 'proposals-empty';
    subheading.textContent =
      'Start with the experiment, not the file name. Micronaut walks you from the research question through the study design and the microscopy details -- the naming convention falls out at the end, as one finished artifact.';
    main.appendChild(subheading);

    const grid = document.createElement('div');
    grid.className = 'home-grid';
    main.appendChild(grid);

    card(grid, {
      icon: '🧭',
      title: 'Take the walkthrough',
      body: 'A guided tour of the app -- what each step is for and how they fit together.',
      onClick: () => {
        saveWalkthroughSeen();
        startWalkthrough({ router });
      },
    });

    card(grid, {
      icon: '📝',
      title: 'Start from a description',
      body: 'Paste or type a paragraph about your experiment -- the app pulls out what it can and asks about the rest.',
      onClick: () => {
        if (router) router.navigate('describe');
      },
    });

    card(grid, {
      icon: '📋',
      title: 'Start from a template',
      body: 'This study already holds a fully worked example (an oregano wound-healing study) -- copy its pattern, or use "New study" in the header for a blank one.',
      onClick: () => {
        if (router) router.navigate('study');
      },
    });

    const skipRow = document.createElement('p');
    skipRow.className = 'home-skip-row';
    const skipLink = document.createElement('button');
    skipLink.type = 'button';
    skipLink.className = 'home-skip-link';
    skipLink.textContent = "Don't show the walkthrough automatically again";
    skipLink.hidden = loadWalkthroughSeen();
    skipLink.addEventListener('click', () => {
      saveWalkthroughSeen();
      skipLink.hidden = true;
    });
    skipRow.appendChild(skipLink);
    main.appendChild(skipRow);
  },
};
