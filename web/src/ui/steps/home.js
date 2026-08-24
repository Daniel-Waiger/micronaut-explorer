// The Home step (zen-planner Phase 1's reframe): the app's landing page and
// the discoverability point for "start here." It reads only the explicit
// study-origin marker to distinguish the shipped oregano example from the
// user's own work; all lifecycle writes remain callbacks owned by main.js.
//
import { createIcon } from '../icons.js';
import { createStudyMap } from '../studyMap.js';
import { buildExperimentMap } from '../../engine/experimentMap.js';

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

function appendGuideLink(main, router) {
  const row = document.createElement('p');
  row.className = 'home-skip-row';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'home-skip-link';
  link.textContent = 'Looking for a specific term or step? See the Guide.';
  link.addEventListener('click', () => {
    if (router) router.navigate('guide');
  });
  row.appendChild(link);
  main.appendChild(row);
}

function appendOwnership(main, { title, body, example = false }) {
  const ownership = document.createElement('section');
  ownership.className = example ? 'home-study-ownership home-example-ownership' : 'home-study-ownership';
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

function appendStudyMap(main, store, router) {
  // This controller owns map input, persistence calls, and deterministic
  // next-decision routing. Home only chooses when the map is revealed.
  main.appendChild(createStudyMap({ store, router }).element);
}

function appendExampleMapSummary(main, store) {
  const map = buildExperimentMap(store.get());
  const summary = document.createElement('section');
  summary.className = 'study-map-editor';
  summary.setAttribute('aria-label', 'Example study map');
  const heading = document.createElement('h2');
  heading.className = 'design-subheading';
  heading.textContent = 'Example study map';
  const copy = document.createElement('p');
  copy.className = 'proposals-empty';
  copy.textContent = 'Read-only while you explore. Make a copy to edit this study.';
  const facts = document.createElement('ul');
  facts.className = 'overview-controls-list';
  const values = [
    ['Research question', map.question?.value],
    ['System or material', map.system?.value],
    ['Experimental unit', map.experimentalUnit?.value],
  ];
  for (const [label, value] of values) {
    const item = document.createElement('li');
    item.textContent = `${label}: ${value || 'Not decided'}`;
    facts.appendChild(item);
  }
  const measurements = document.createElement('li');
  measurements.textContent = `Measurements: ${(map.measurements || []).map((measurement) => measurement.label).join(', ') || 'Not decided'}`;
  facts.appendChild(measurements);
  summary.append(heading, copy, facts);
  main.appendChild(summary);
}

function appendGuidedEntry(main, options, isExample) {
  const status = homeGuidedStatus(options.guidedStatus, options.getGuidedStatus);
  const entry = isExample && status === 'paused'
    ? { title: 'Resume example walkthrough', body: 'Continue from where you paused; the example stays unchanged.', onClick: options.onResumeGuided }
    : isExample && status === 'completed'
      ? { title: 'Restart walkthrough', body: 'Start the optional walkthrough again from Study map.', onClick: options.onRestartGuided }
      : isExample
        ? { title: 'Walk through example', body: 'Explore the completed example with optional explanations beside each workspace.', onClick: options.onStartGuided }
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

function renderExploredExample(main, store, options) {
  const { router, onAdoptExample } = options;
  main.textContent = '';
  const title = document.createElement('h1');
  title.className = 'step-heading';
  title.textContent = 'Study map';
  main.appendChild(title);
  const ownership = appendOwnership(main, {
    title: 'Example — changes are not your study',
    body: 'You are exploring the completed oregano example. Make a copy before treating its four measurements as your own plan.',
    example: true,
  });
  const actions = document.createElement('div');
  actions.className = 'home-study-ownership-actions';
  const adopt = document.createElement('button');
  adopt.type = 'button';
  adopt.className = 'copy-button';
  adopt.textContent = 'Make a copy of this example';
  adopt.title = 'Keep all four example measurements and make this study your own.';
  adopt.addEventListener('click', () => {
    const adopted = typeof onAdoptExample === 'function' && onAdoptExample();
    if (adopted && router) router.navigate('study');
  });
  actions.appendChild(adopt);
  ownership.appendChild(actions);
  // Exploration is intentionally read-only: the copy action above is the
  // only way to turn the shipped example into editable user work.
  appendExampleMapSummary(main, store);
  appendGuidedEntry(main, options, true);
  appendGuideLink(main, router);
}

export const homeStep = {
  id: 'home',
  title: 'Study map',
  render(main, store, options = {}) {
    const { router, onNewBlank, exploreExample } = options;
    main.textContent = '';
    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Study map';
    main.appendChild(heading);
    const subheading = document.createElement('p');
    subheading.className = 'proposals-empty';
    subheading.textContent = 'Start with the shape of your study, then move directly to the workspace that owns each decision.';
    main.appendChild(subheading);

    if (store.get().meta?.origin === 'example') {
      if (exploreExample) {
        renderExploredExample(main, store, options);
        return;
      }
      // These are the only initial choices for the shipped example. Neither
      // choice adopts it: blank start is coordinator-owned and exploration is
      // a local reveal until the separate copy action is chosen.
      const choices = document.createElement('div');
      choices.className = 'home-grid';
      card(choices, {
        icon: 'study',
        title: 'Plan my study',
        body: 'Start with a blank Study map for your own work. The completed example remains available from Utilities.',
        onClick: () => {
          if (typeof onNewBlank === 'function') onNewBlank();
        },
      });
      card(choices, {
        icon: 'template',
        title: 'Explore a completed example',
        body: 'Inspect the oregano study without making it your study.',
        onClick: () => renderExploredExample(main, store, options),
      });
      main.appendChild(choices);
      return;
    }

    appendOwnership(main, {
      title: 'Plan my study',
      body: 'This is your workspace. Your map answers are saved here as you plan.',
    });
    appendStudyMap(main, store, router);
    appendGuidedEntry(main, options, false);
    appendGuideLink(main, router);
  },
};
