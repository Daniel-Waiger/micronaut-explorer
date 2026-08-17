// Interactive walkthrough (zen-planner Phase 5): a short spotlight-style
// coach-mark tour over the REAL app nav, not a slideshow describing it. Each
// tour step navigates the router to a real page and highlights that page's
// nav button with a short tooltip, so a first-time user sees the actual app
// working. ui/steps/home.js's "Take the walkthrough" card and ui/steps/
// guide.js's own "Start the tour" button both call startWalkthrough() --
// see main.js's boot sequence for the auto-start-on-first-visit framework
// this content plugs into (zen-planner Phase 1).
//
// Deliberately NOT a generic "attach to any element" tour engine: this app
// has exactly one thing worth touring (the step nav), so a general-purpose
// targeting/positioning framework would solve a problem this app does not
// have. Generalize only if a second tour ever appears.
//
// Content is intentionally terse (one sentence per step) -- this is a
// tooltip, not ui/steps/guide.js's own longer-form prose; the two are
// different media for the same facts, not a duplicate to keep in sync by
// hand (see design.js's parseLevels export for this codebase's general
// stance on NOT duplicating logic, which does not extend to two
// deliberately different-length renderings of the same plain fact).
export const TOUR_STEPS = [
  {
    stepId: 'home',
    title: 'Home',
    body: 'Start here. Three doors in: a guided description, a worked template, or this tour.',
  },
  {
    stepId: 'describe',
    title: 'Project',
    body: 'The question first -- what you are measuring, on what organism, and why -- before any microscope decision.',
  },
  {
    stepId: 'study',
    title: 'Study',
    body: 'The study-wide view: your research question, the groups shared across assays, and the list of assays.',
  },
  {
    stepId: 'design',
    title: 'Design',
    body: 'Per assay: your control and treatment groups, any crossing factors, and replicate counts.',
  },
  {
    stepId: 'panel',
    title: 'Microscopy',
    body: 'Acquisition details -- instrument, modality, markers -- plus a spectral-spillover check across your fluorophores.',
  },
  {
    stepId: 'naming',
    title: 'Naming',
    body: 'The filename convention assembled from your design, plus a downloadable bench schedule further down the page.',
  },
  {
    stepId: 'overview',
    title: 'Overview',
    body: 'A read-only summary: the study map, a conformance check, recommended controls, and every planned filename.',
  },
  {
    stepId: 'guide',
    title: 'Guide',
    body: 'Come back here any time -- a searchable reference for every step and concept in the app.',
  },
];

/**
 * Start the tour. `router` drives real navigation between steps;
 * `onFinish()` (optional) fires once, when the tour ends by any path (Skip,
 * Finish, Escape, or clicking the backdrop) -- ui/steps/home.js uses it to
 * mark the walkthrough seen so it does not auto-start again.
 *
 * Returns nothing: the tour manages its own DOM (appended to `document.body`,
 * removed on finish) and its own teardown. Calling this a second time before
 * the first tour finishes is not supported -- both callers (Home's card,
 * Guide's button) are single, deliberate user clicks, never programmatic.
 */
export function startWalkthrough({ router, onFinish } = {}) {
  let index = 0;

  const backdrop = document.createElement('div');
  backdrop.className = 'walkthrough-backdrop';

  const tooltip = document.createElement('div');
  tooltip.className = 'walkthrough-tooltip';
  tooltip.setAttribute('role', 'dialog');
  tooltip.setAttribute('aria-label', 'Walkthrough');

  const stepLabel = document.createElement('div');
  stepLabel.className = 'walkthrough-step-label';
  const titleEl = document.createElement('div');
  titleEl.className = 'walkthrough-title';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'walkthrough-body';

  const actions = document.createElement('div');
  actions.className = 'walkthrough-actions';

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'walkthrough-skip';
  skipBtn.textContent = 'Skip';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'walkthrough-back';
  backBtn.textContent = 'Back';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'walkthrough-next';

  actions.appendChild(skipBtn);
  actions.appendChild(backBtn);
  actions.appendChild(nextBtn);

  tooltip.appendChild(stepLabel);
  tooltip.appendChild(titleEl);
  tooltip.appendChild(bodyEl);
  tooltip.appendChild(actions);

  let highlighted = null;

  function clearHighlight() {
    if (highlighted) {
      highlighted.classList.remove('walkthrough-highlight');
      highlighted = null;
    }
  }

  /**
   * Position `tooltip` beside `target`'s bounding rect, preferring the
   * right side (where the nav-step buttons have the most open room) and
   * falling back below when the tooltip would run off the right edge of a
   * narrow viewport (e.g. the collapsed icon-only rail on a small window).
   */
  function positionTooltip(target) {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 300; // matches app.css's .walkthrough-tooltip width
    const margin = 12;
    const fitsRight = rect.right + margin + tooltipWidth <= window.innerWidth;
    if (fitsRight) {
      tooltip.style.left = `${rect.right + margin}px`;
      tooltip.style.top = `${Math.max(margin, rect.top)}px`;
    } else {
      tooltip.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - tooltipWidth - margin))}px`;
      tooltip.style.top = `${rect.bottom + margin}px`;
    }
  }

  function renderStep() {
    const step = TOUR_STEPS[index];
    if (!step) return finish();

    if (router) router.navigate(step.stepId);
    clearHighlight();

    const target = document.querySelector(`[data-step-id="${step.stepId}"]`);
    if (target) {
      target.classList.add('walkthrough-highlight');
      highlighted = target;
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest' });
      }
      tooltip.style.transform = '';
      positionTooltip(target);
    } else {
      // TOTAL: a missing nav button (a step removed from the array without
      // updating TOUR_STEPS, or a render race) must not strand the tour --
      // center the tooltip instead of throwing or freezing on a blank
      // highlight.
      tooltip.style.left = '50%';
      tooltip.style.top = '80px';
      tooltip.style.transform = 'translateX(-50%)';
    }

    stepLabel.textContent = `Step ${index + 1} of ${TOUR_STEPS.length}`;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    backBtn.hidden = index === 0;
    nextBtn.textContent = index === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
  }

  function finish() {
    clearHighlight();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    tooltip.remove();
    if (typeof onFinish === 'function') onFinish();
  }

  function onResize() {
    const step = TOUR_STEPS[index];
    const target = step && document.querySelector(`[data-step-id="${step.stepId}"]`);
    if (target) positionTooltip(target);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') finish();
  }

  nextBtn.addEventListener('click', () => {
    index += 1;
    renderStep();
  });
  backBtn.addEventListener('click', () => {
    index = Math.max(0, index - 1);
    renderStep();
  });
  skipBtn.addEventListener('click', finish);
  backdrop.addEventListener('click', finish);

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);
  document.body.appendChild(tooltip);
  renderStep();
}
