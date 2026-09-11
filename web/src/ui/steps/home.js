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
import { isExampleOrigin } from '../../core/appController.js';
import { openInNewTab, SANDBOX_URL } from '../newTab.js';
import { createIcon } from '../icons.js';
import { createStudyMap } from '../studyMap.js';

// One big clickable tile: a title, a short line of what it does, and the
// step it navigates to. Its icon comes from the same thin-stroke SVG system
// as the shell so the entry point describes the scientific workflow.
// `featured` (app.css's .home-card-featured) is the one visual escape hatch
// from "every tile looks the same" -- used ONLY for the example-study entry
// below, which used to be a tiny text link a new visitor could miss entirely.
function card(parent, { icon, title, body, onClick, featured = false }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = featured ? 'home-card home-card-featured' : 'home-card';
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

// Guided statuses are exactly these four (core/guidedProgress.js); anything
// else -- a missing projection, a stale shape, or a malformed value such as
// `{ status: 42 }` -- is NOT the same thing as a real 'not-started' study and
// must not be read as one (that would silently offer to START a walkthrough
// whose progress this page cannot actually account for). Such input resolves
// to `null` here so the caller degrades to the non-mutating Explain action
// instead of guessing.
const HOME_GUIDED_STATUSES = new Set(['not-started', 'active', 'paused', 'completed']);

function homeGuidedStatus(guidedStatus, getGuidedStatus) {
  const status = typeof getGuidedStatus === 'function' ? getGuidedStatus() : guidedStatus;
  const value = status && typeof status.status === 'string' ? status.status : null;
  return HOME_GUIDED_STATUSES.has(value) ? value : null;
}

// The Study map card's primary action, keyed off the guided-walkthrough
// status. 'active' intentionally reuses onResumeGuided: the controller's
// resume() and start() are both the same openWalkthrough() (see
// ui/walkthrough.js), which for an 'active' status invokes no transition at
// all and simply reopens the panel where the reader left it -- the exact
// behaviour main.js already relies on to auto-reopen an active walkthrough
// on load. secondaryExplain marks every branch where "Explain Study map"
// must additionally be offered so it is never lost as a reachable action.
function homeGuidedEntryForStatus(status, options) {
  // Checked BEFORE the status ladder, deliberately.
  //
  // The walkthrough only ever runs on the example study (ui/steps/guide.js's
  // Start gate checks the same isExampleOrigin), and the example can now only
  // be opened in the practice tab (?demo=1) -- openExampleStudy
  // (core/appController.js) refuses to run outside it.
  //
  // An earlier shape of this change gated only 'not-started', which left the
  // other statuses still offering Continue/Resume/Restart on a study that
  // never came from the example: a tour OF THE EXAMPLE, reopened over
  // somebody's own work. Upgrading users really can be in that state, because
  // the real scope's progress key is the unprefixed one it has always been, so
  // a walkthrough they left paused before this change survives into a tab the
  // example is no longer in. One check here covers every status at once.
  //
  // `isExample` is threaded in as a plain option (computed once by the caller
  // from store.get().meta?.origin) rather than this function reaching for the
  // store or core/appController.js itself, so it stays the pure, directly
  // testable mapping it has always been.
  if (!options.isExample) {
    return {
      title: 'Try the guided walkthrough',
      body: 'The walkthrough only runs on the finished example study -- open it in a separate practice tab to try it risk-free.',
      onClick: () => {
        const open = typeof options.onOpenExampleTab === 'function' ? options.onOpenExampleTab : openInNewTab;
        open(SANDBOX_URL);
      },
      secondaryExplain: true,
    };
  }
  if (status === 'not-started') {
    return {
      title: 'Start example walkthrough',
      body: 'Launch the guided walkthrough of a finished example study.',
      onClick: options.onStartGuided,
      secondaryExplain: true,
    };
  }
  if (status === 'active') {
    return {
      title: 'Continue walkthrough',
      body: 'Reopen the walkthrough panel where you left it.',
      onClick: options.onResumeGuided,
      secondaryExplain: true,
    };
  }
  if (status === 'paused') {
    return {
      title: 'Resume walkthrough',
      body: 'Continue the optional walkthrough from where you paused.',
      onClick: options.onResumeGuided,
      secondaryExplain: true,
    };
  }
  if (status === 'completed') {
    return {
      title: 'Restart walkthrough',
      body: 'Start the optional walkthrough again from Study map.',
      onClick: options.onRestartGuided,
      secondaryExplain: true,
    };
  }
  // status === null: no recognized guided status (missing or malformed).
  // Explain is the only entry that never mutates guided progress, so it is
  // the only safe default when this page cannot tell what state the
  // walkthrough is actually in.
  return {
    title: 'Explain Study map',
    body: 'Open contextual guidance without changing your study or guided progress.',
    onClick: options.onExplainGuided,
    secondaryExplain: false,
  };
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

// Exported so tests can drive every guided-status branch directly against
// the shared DOM stub, without needing a full store/router/experiment map to
// render the rest of the Study map page.
export function appendGuidedEntry(main, options) {
  const status = homeGuidedStatus(options.guidedStatus, options.getGuidedStatus);
  const entry = homeGuidedEntryForStatus(status, options);
  const grid = document.createElement('div');
  grid.className = 'home-grid';
  card(grid, {
    icon: 'walkthrough',
    title: entry.title,
    body: entry.body,
    onClick: () => {
      if (typeof entry.onClick === 'function') entry.onClick('home');
    },
  });
  main.appendChild(grid);

  // Explain Study map never mutates guided progress, so it stays reachable
  // as a secondary action in every state that already has its own primary
  // action above it (the 'null'/degraded case skips this row because
  // Explain IS the primary action there already -- see
  // homeGuidedEntryForStatus).
  if (entry.secondaryExplain && typeof options.onExplainGuided === 'function') {
    appendLinkRow(main, 'Just want an explanation? Explain Study map.', () => {
      options.onExplainGuided('home');
    });
  }
}

// Also exported for the same direct-test reason as appendGuidedEntry: the
// "no dead button" contract (row absent without a working opener) is
// cheapest to prove against this function alone.
//
// This USED to be a plain text link (appendLinkRow) sitting quietly below
// the walkthrough card -- new users found it, if at all, by accident. It is
// now a featured card in the same .home-grid family as the walkthrough
// entry, because the example is one of the two things a first-time visitor
// on this page most needs to find.
//
// The click no longer calls back into main.js to swap the in-memory study:
// opening the example now means opening ui/newTab.js's SANDBOX_URL
// (?demo=1) in a SEPARATE TAB against its own storage (core/storageScope.js)
// -- the real tab on screen is never navigated away, so there is nothing
// here left to preserve/protect/confirm. `onOpenExampleTab` is accepted as a
// plain callback (not an options object) for exactly the same reason
// `onOpenExample` used to be: homeStep.render supplies the real opener with
// its default already applied (openInNewTab), while a test can pass its own
// spy here directly, following ui/feedbackHandoff.js:111's onOpen precedent.
export function appendExampleLink(main, onOpenExampleTab) {
  if (typeof onOpenExampleTab !== 'function') return null;
  const grid = document.createElement('div');
  grid.className = 'home-grid';
  const button = card(grid, {
    icon: 'template',
    title: 'Explore a completed example',
    body: 'Opens a finished oregano study in a separate practice tab, saved separately from your work. Nothing you do there changes this study.',
    onClick: () => onOpenExampleTab(SANDBOX_URL),
    featured: true,
  });
  main.appendChild(grid);
  return button;
}

export const homeStep = {
  id: 'home',
  title: 'Study map',
  render(main, store, options = {}) {
    // onOpenExampleTab defaults here (not inside appendExampleLink/
    // appendGuidedEntry) so both stay simple "callback missing => render
    // nothing" functions, while every real render of this page still gets a
    // working opener with no wiring required from main.js.
    const { router, onOpenExampleTab = openInNewTab } = options;
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
    // ABOVE the study map, deliberately. This entry was a text link at the
    // very bottom of this page and new visitors simply never found it; moving
    // it into a card was only half the fix, because the map's own question
    // card is tall enough to push anything below it off the first screen
    // entirely -- a card nobody scrolls to is no more findable than the link
    // was. It sits directly under "Plan my study" so the two read as the pair
    // of choices they actually are: plan your own, or go look at a finished
    // one. Everything that follows the map stays after the map.
    appendExampleLink(main, onOpenExampleTab);

    // This controller owns map input, persistence calls, and deterministic
    // next-decision routing. Home only chooses when the map is revealed.
    main.appendChild(createStudyMap({ store, router }).element);
    // isExample is derived here, once, from the live store -- not inside
    // homeGuidedEntryForStatus -- so that function stays a pure, directly
    // testable mapping from (status, options) to an entry (see its own
    // comment on the 'not-started' branch).
    appendGuidedEntry(main, {
      ...options,
      onOpenExampleTab,
      isExample: isExampleOrigin(store.get().meta?.origin),
    });

    appendLinkRow(main, 'Looking for a specific term or step? See the Guide.', () => {
      if (router) router.navigate('guide');
    });
  },
};
