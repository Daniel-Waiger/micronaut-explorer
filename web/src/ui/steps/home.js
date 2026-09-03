// The Study map step: the app's landing page and the first workspace.
//
// A first run now starts BLANK (see main.js's loadInitialExperiment), so this
// page no longer has to open by asking a visitor whether the study in front of
// them is theirs. The shipped oregano example is reachable from one link here
// and from Settings, and opening it hands over an ordinary editable study --
// there is no read-only exploration mode, no ownership banner, and no separate
// "make a copy" step to complete before the visitor may type. Those existed
// only because the example used to be seeded as the visitor's own workspace.
//
// All lifecycle writes remain callbacks owned by main.js.
import { createIcon } from '../icons.js';
import { createStudyMap } from '../studyMap.js';

// One big clickable tile: a title, a short line of what it does, and the
// step it navigates to. Its icon comes from the same thin-stroke SVG system
// as the shell so the entry point describes the scientific workflow.
function card(parent, { icon, title, body, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-card';
  button.addEventListener('click', onClick);

  const iconSpan = document.createElement('span');
  iconSpan.className = 'home-card-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.appendChild(createIcon(icon, 'home-card-glyph'));
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

function homeGuidedStatus(guidedStatus, getGuidedStatus) {
  const status = typeof getGuidedStatus === 'function' ? getGuidedStatus() : guidedStatus;
  return status && typeof status.status === 'string' ? status.status : 'not-started';
}

function appendLinkRow(main, label, onClick) {
  const row = document.createElement('p');
  row.className = 'home-skip-row';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'home-skip-link';
  link.textContent = label;
  link.addEventListener('click', onClick);
  row.appendChild(link);
  main.appendChild(row);
  return link;
}

function appendOwnership(main, { title, body }) {
  const ownership = document.createElement('section');
  ownership.className = 'home-study-ownership';
  const heading = document.createElement('h2');
  heading.className = 'home-study-ownership-title';
  heading.textContent = title;
  const copy = document.createElement('p');
  copy.className = 'home-study-ownership-body';
  copy.textContent = body;
  ownership.append(heading, copy);
  main.appendChild(ownership);
  return ownership;
}

function appendGuidedEntry(main, options) {
  const status = homeGuidedStatus(options.guidedStatus, options.getGuidedStatus);
  const entry = status === 'paused'
    ? { title: 'Resume walkthrough', body: 'Continue the optional walkthrough from where you paused.', onClick: options.onResumeGuided }
    : status === 'completed'
      ? { title: 'Restart walkthrough', body: 'Start the optional walkthrough again from Study map.', onClick: options.onRestartGuided }
      : { title: 'Explain Study map', body: 'Open contextual guidance without changing your study or guided progress.', onClick: options.onExplainGuided };
  const grid = document.createElement('div');
  grid.className = 'home-grid';
  card(grid, {
    icon: 'walkthrough',
    ...entry,
    onClick: () => {
      if (typeof entry.onClick === 'function') entry.onClick('home');
    },
  });
  main.appendChild(grid);
}

export const homeStep = {
  id: 'home',
  title: 'Study map',
  render(main, store, options = {}) {
    const { router, onOpenExample } = options;
    main.textContent = '';
    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Study map';
    main.appendChild(heading);
    const subheading = document.createElement('p');
    subheading.className = 'proposals-empty supporting-description';
    subheading.textContent = 'Start with the shape of your study, then move directly to the workspace that owns each decision.';
    main.appendChild(subheading);

    appendOwnership(main, {
      title: 'Plan my study',
      body: 'This is your workspace. Your map answers are saved here as you plan.',
    });
    // This controller owns map input, persistence calls, and deterministic
    // next-decision routing. Home only chooses when the map is revealed.
    main.appendChild(createStudyMap({ store, router }).element);
    appendGuidedEntry(main, options);

    if (typeof onOpenExample === 'function') {
      appendLinkRow(
        main,
        'Want to see a finished plan? Open the example study.',
        () => onOpenExample()
      );
    }
    appendLinkRow(main, 'Looking for a specific term or step? See the Guide.', () => {
      if (router) router.navigate('guide');
    });
  },
};
