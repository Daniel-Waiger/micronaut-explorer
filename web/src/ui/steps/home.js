// The Home step (zen-planner Phase 1's reframe): the app's landing page and
// the discoverability point for "start here." It reads only the explicit
// study-origin marker to distinguish the shipped oregano example from the
// user's own work; all lifecycle writes remain callbacks owned by main.js.
//
import { createIcon } from '../icons.js';

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

export const homeStep = {
  id: 'home',
  title: 'Home',
  render(main, store, {
    router,
    onAdoptExample,
    onNewBlank,
    guidedStatus,
    getGuidedStatus,
    onStartGuided,
    onResumeGuided,
    onRestartGuided,
    onExplainGuided,
  } = {}) {
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

    // This check deliberately reads the explicit origin marker rather than
    // recognising words from the study text. Older saves with no marker are
    // conservative user work, never a possibly-mislabelled shipped example.
    const isExample = store.get().meta?.origin === 'example';
    const ownership = document.createElement('section');
    ownership.className = isExample ? 'home-study-ownership home-example-ownership' : 'home-study-ownership';
    const ownershipTitle = document.createElement('h2');
    ownershipTitle.className = 'home-study-ownership-title';
    ownershipTitle.textContent = isExample ? 'Example study · Oregano wound-healing' : 'Your study';
    ownership.appendChild(ownershipTitle);

    const ownershipBody = document.createElement('p');
    ownershipBody.className = 'home-study-ownership-body';
    ownershipBody.textContent = isExample
      ? 'This is a worked example with four assays. Use it as a template to keep and adapt its structure, or start from an empty study.'
      : 'This is your workspace. Continue planning, adjust its assays, or use the utilities to back it up and recover earlier versions.';
    ownership.appendChild(ownershipBody);

    if (isExample) {
      const actions = document.createElement('div');
      actions.className = 'home-study-ownership-actions';

      const adoptButton = document.createElement('button');
      adoptButton.type = 'button';
      adoptButton.className = 'copy-button';
      adoptButton.textContent = 'Use as template';
      adoptButton.title = 'Keep all four example assays and make this study your own.';
      adoptButton.addEventListener('click', () => {
        const adopted = typeof onAdoptExample === 'function' && onAdoptExample();
        if (adopted && router) router.navigate('study');
      });
      actions.appendChild(adoptButton);

      const blankButton = document.createElement('button');
      blankButton.type = 'button';
      blankButton.className = 'copy-button';
      blankButton.textContent = 'Start blank study';
      blankButton.title = 'Start with one empty assay instead of the oregano example.';
      blankButton.addEventListener('click', () => {
        if (typeof onNewBlank === 'function') onNewBlank();
      });
      actions.appendChild(blankButton);
      ownership.appendChild(actions);
    }
    main.appendChild(ownership);

    const grid = document.createElement('div');
    grid.className = 'home-grid';
    main.appendChild(grid);

    const guideStatus = homeGuidedStatus(guidedStatus, getGuidedStatus);
    const guidedEntry = isExample && guideStatus === 'paused'
      ? {
          title: 'Resume example walkthrough',
          body: 'Continue from the feature where you paused; the example study stays unchanged.',
          onClick: onResumeGuided,
        }
      : isExample && guideStatus === 'completed'
        ? {
            title: 'Restart walkthrough',
            body: 'Start the optional seven-step example walkthrough again from Home.',
            onClick: onRestartGuided,
          }
        : isExample
          ? {
              title: 'Walk through example',
              body: 'Explore the worked example with an optional explanation beside each of the seven workflow steps.',
              onClick: onStartGuided,
            }
          : {
              title: 'Explain the workflow',
              body: 'Open a contextual explanation of this workflow without changing your study or guided progress.',
              onClick: onExplainGuided,
            };
    card(grid, {
      icon: 'walkthrough',
      ...guidedEntry,
      onClick: () => {
        if (typeof guidedEntry.onClick === 'function') guidedEntry.onClick('home');
      },
    });

    card(grid, {
      icon: 'describe',
      title: 'Start from a description',
      body: 'Paste or type a paragraph about your experiment -- the app pulls out what it can and asks about the rest.',
      onClick: () => {
        if (router) router.navigate('describe');
      },
    });

    card(grid, {
      icon: 'template',
      title: isExample ? 'Explore the example' : 'Study design',
      body: isExample
        ? 'Open the oregano study to inspect its four assays and see how its design is organised.'
        : 'Open your study to define its assays, groups, and experimental conditions.',
      onClick: () => {
        if (router) router.navigate('study');
      },
    });

    const guideRow = document.createElement('p');
    guideRow.className = 'home-skip-row';
    const guideLink = document.createElement('button');
    guideLink.type = 'button';
    guideLink.className = 'home-skip-link';
    guideLink.textContent = 'Looking for a specific term or step? See the Guide.';
    guideLink.addEventListener('click', () => {
      if (router) router.navigate('guide');
    });
    guideRow.appendChild(guideLink);
    main.appendChild(guideRow);
  },
};
