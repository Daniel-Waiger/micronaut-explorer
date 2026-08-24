// A concise, feature-level tour that deliberately complements (rather than
// replaces) the richer step explanation panel. Each stop owns a meaningful
// workspace area; repeated rows and individual fields remain part of that
// area's explanation so a real study does not turn into an endless tour.

const stop = (routeId, selector, title, body, revealSelector = null) => Object.freeze({ routeId, selector, title, body, revealSelector });

export const FEATURE_TOUR = Object.freeze([
  stop(null, '.shell-brand', 'Home', 'This mark always returns you to the Study map, the app’s starting point.'),
  stop(null, '.shell-new-study', 'New study', 'Start a blank plan here. Your earlier browser-local versions remain recoverable.'),
  stop(null, '.shell-nav', 'Planner navigation', 'Move between the core planning workspaces here. Their order follows the normal study-design flow.'),
  stop(null, '.nav-utilities', 'Feedback and settings', 'Feedback collects a shareable report when you choose an action. Settings keeps backup and reset tools out of the planning flow.'),
  stop(null, '.nav-theme-toggle', 'Theme', 'This compact toggle switches the appearance for the next click. It keeps its border visible against either navigation background.'),

  stop('home', '.experiment-compass', 'Study map', 'This is the live picture of what is known and what deserves attention next. Its next-decision action can take you directly to the owning workspace.'),
  stop('home', '.home-grid', 'Starting paths', 'Use these cards to begin with a blank study or explore an example. The example is read-only until you make a copy.'),

  stop('describe', '.project-description-card', 'Research brief', 'Describe the question, material or system, and purpose in one place. The rest of the planner uses this as shared context.'),
  stop('describe', '.project-review-button', 'Review the brief', 'This checks your prose against the project context and surfaces structured suggestions. It does not silently rewrite your description.'),
  stop('describe', '.project-details', 'Confirmed details', 'Use these details to inspect the facts derived from the brief. You can correct them at their owning input when needed.'),

  stop('study', '.field-row', 'Study question', 'Set the study-level question before splitting work into measurements. This keeps shared intent separate from per-measurement details.'),
  stop('study', '.study-group-token-field', 'Comparison vocabulary', 'Add reusable group or condition labels once here. Measurements can then use the same comparison language consistently.'),
  stop('study', '.study-assay-row', 'Measurements', 'Each measurement has its own design, acquisition, and data-plan details. Open its workspace from the row when you are ready to specify it.'),

  stop('design', '.question-answer', 'Experimental unit', 'Confirm what counts as one independently assigned or sampled unit. Replicates and conditions build on that definition.'),
  stop('design', '.factors-list', 'Groups and factors', 'Define the alternatives and crossed variables that form your planned conditions. Add or edit them here without changing the study-wide question.'),
  stop('design', '.conditions-table', 'Planned conditions', 'This preview expands groups, factors, and replicate counts into the rows you intend to acquire. Correct the source controls above rather than editing generated rows.'),

  stop('panel', '[data-tour-section="acquisition"]', 'Acquisition', 'Confirm the imaging setup and measurement-specific acquisition facts here. These answers feed the downstream data plan.', '[data-tour-section="acquisition"]'),
  stop('panel', '[data-tour-section="fluorophores"]', 'Fluorophores and spillover', 'Check the fluorophores declared for this measurement and any qualitative spillover flags. This temporary opening closes again as the tour moves on.', '[data-tour-section="fluorophores"]'),
  stop('panel', '.spectral-view-host', 'Spectral view', 'This compares the known fluorophore curves and detection bands for the current measurement. Curves are schematic, so use it as planning guidance rather than a measured spectrum.', '[data-tour-section="spectral"]'),
  stop('panel', '[data-tour-section="assembly"] .panel-list', 'Panel assembly', 'Add channels and name their targets, fluorophores, and detection filters here. The structured panel drives more precise controls and the spectral view.', '[data-tour-section="assembly"]'),

  stop('naming', '.naming-grid', 'Naming fields', 'Enter the pieces that make every acquired file traceable to its condition. Previews use clear placeholders for details that are assigned later.'),
  stop('naming', '.planned-box', 'Filename preview', 'Review the generated filenames before acquisition. The source fields above remain the place to make corrections.'),
  stop('naming', '.duration-control', 'Schedule estimates', 'Enter only the task times you know. The planner scales them to the planned sample count for the optional downloadable schedule.'),

  stop('overview', '.study-map', 'Study map summary', 'Review the current study structure and readiness in one place. Use linked issues to return to the feature that owns a decision.'),
  stop('overview', '.overview-export-menu', 'Exports', 'Choose the artifact you need for handoff, planning, or backup. Final-facing exports remain guarded by the planner checks.'),
  stop('overview', '.overview-secondary-actions', 'Additional handoff tools', 'These actions support sharing, printing, and model-assisted review without changing the study itself.'),

  stop('guide', '.guide-search-row', 'Guide search', 'Search the reference material by the words you need. It filters the guide without altering your study.'),
  stop('guide', '.guide-section', 'Reference sections', 'These sections explain the planning concepts behind the workspaces. They are optional reference material, not required steps.'),

  stop('feedback', '.describe-textarea', 'Feedback', 'Describe what you tried and where the app stopped helping. This text stays local until you choose a sharing action.'),
  stop('feedback', '.reveal', 'Technical context', 'Open this to see the context included with a feedback package. Browser details and the study are included only when you export or share.'),
  stop('feedback', '.overview-secondary-actions', 'Share choices', 'Copy, download, email, or create an issue with the report using these actions. Choose the channel that works for you; none sends automatically.'),

  stop('settings', '.overview-secondary-actions', 'Project backups', 'Download or import a project backup here, or begin a new blank study. Existing browser-local versions remain available through recovery.'),
]);

export function featureTourRouteIds() {
  return [...new Set(FEATURE_TOUR.map((item) => item.routeId).filter(Boolean))];
}

function safeStops(stops) {
  return (Array.isArray(stops) ? stops : [])
    .filter((item) => item && typeof item.selector === 'string' && item.selector)
    .map((item) => ({
      routeId: typeof item.routeId === 'string' && item.routeId ? item.routeId : null,
      selector: item.selector,
      title: typeof item.title === 'string' && item.title ? item.title : 'Feature',
      body: typeof item.body === 'string' && item.body ? item.body : 'This feature supports the current plan.',
      revealSelector: typeof item.revealSelector === 'string' && item.revealSelector ? item.revealSelector : null,
    }));
}

function visibleTarget(doc, selector) {
  const nodes = [...doc.querySelectorAll(selector)];
  return nodes.find((node) => {
    const rect = node.getBoundingClientRect();
    const style = doc.defaultView?.getComputedStyle?.(node);
    return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
  }) || null;
}

function tourNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tourButton(doc, className, text, onClick) {
  const node = tourNode(doc, 'button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * The focus tour owns only temporary DOM. Routes and persistent state remain
 * in main/router; this controller neither writes a study field nor replaces
 * existing step-level walkthrough UI.
 */
export function createFeatureWalkthroughController({ router, stops = FEATURE_TOUR, document: injectedDocument } = {}) {
  const doc = injectedDocument || globalThis.document;
  if (!doc?.body) throw new Error('createFeatureWalkthroughController requires a document body.');

  const win = doc.defaultView;
  const items = safeStops(stops);
  let index = -1;
  let active = false;
  let currentTarget = null;
  let currentDisclosure = null;
  let disclosureOpenedByTour = false;
  let launcher = null;
  let shell = null;
  let raf = null;

  const backdrop = tourNode(doc, 'div', 'feature-tour-backdrop');
  backdrop.setAttribute('aria-hidden', 'true');
  const shades = ['top', 'right', 'bottom', 'left'].map((side) => tourNode(doc, 'div', `feature-tour-shade feature-tour-shade-${side}`));
  backdrop.append(...shades);
  const dialog = tourNode(doc, 'section', 'feature-tour-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-live', 'polite');
  const position = tourNode(doc, 'p', 'feature-tour-position');
  const title = tourNode(doc, 'h2', 'feature-tour-title');
  const body = tourNode(doc, 'p', 'feature-tour-body');
  const actions = tourNode(doc, 'div', 'feature-tour-actions');
  const back = tourButton(doc, 'feature-tour-back', 'Back', () => show(index - 1));
  const next = tourButton(doc, 'feature-tour-next', 'Next', () => show(index + 1));
  const close = tourButton(doc, 'feature-tour-close', 'Close', () => stop());
  actions.append(back, next, close);
  dialog.append(position, title, body, actions);

  function removeTarget() {
    currentTarget?.classList.remove('feature-tour-target');
    currentTarget = null;
  }

  function restoreDisclosure() {
    if (currentDisclosure && disclosureOpenedByTour && currentDisclosure.isConnected) currentDisclosure.open = false;
    currentDisclosure = null;
    disclosureOpenedByTour = false;
  }

  function revealDisclosure(item) {
    const disclosure = item.revealSelector ? doc.querySelector(item.revealSelector) : null;
    if (disclosure === currentDisclosure) return;
    restoreDisclosure();
    if (!disclosure || String(disclosure.tagName).toLowerCase() !== 'details') return;
    currentDisclosure = disclosure;
    if (!disclosure.open) {
      disclosure.open = true;
      disclosureOpenedByTour = true;
    }
  }

  function schedulePosition() {
    if (!active || !currentTarget) return;
    if (raf !== null && win?.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    const positionNow = () => {
      raf = null;
      if (!active || !currentTarget?.isConnected) return;
      const rect = currentTarget.getBoundingClientRect();
      const width = win?.innerWidth || doc.documentElement.clientWidth || 1024;
      const height = win?.innerHeight || doc.documentElement.clientHeight || 768;
      const pad = 8;
      const left = Math.max(0, rect.left - pad);
      const right = Math.min(width, rect.right + pad);
      const top = Math.max(0, rect.top - pad);
      const bottom = Math.min(height, rect.bottom + pad);
      shades[0].style.cssText = `left:0;top:0;width:100%;height:${top}px;`;
      shades[1].style.cssText = `left:${right}px;top:${top}px;width:${Math.max(0, width - right)}px;height:${Math.max(0, bottom - top)}px;`;
      shades[2].style.cssText = `left:0;top:${bottom}px;width:100%;height:${Math.max(0, height - bottom)}px;`;
      shades[3].style.cssText = `left:0;top:${top}px;width:${left}px;height:${Math.max(0, bottom - top)}px;`;

      const gap = 16;
      const dialogWidth = Math.min(360, Math.max(260, width - 32));
      const dialogHeight = dialog.offsetHeight || 180;
      let dialogLeft = right + gap;
      let dialogTop = Math.max(16, Math.min(rect.top, height - dialogHeight - 16));
      if (dialogLeft + dialogWidth > width - 16) dialogLeft = left - gap - dialogWidth;
      if (dialogLeft < 16) {
        dialogLeft = Math.max(16, Math.min(left, width - dialogWidth - 16));
        dialogTop = bottom + gap;
        if (dialogTop + dialogHeight > height - 16) dialogTop = Math.max(16, top - gap - dialogHeight);
      }
      dialog.style.width = `${dialogWidth}px`;
      dialog.style.left = `${dialogLeft}px`;
      dialog.style.top = `${dialogTop}px`;
    };
    if (win?.requestAnimationFrame) raf = win.requestAnimationFrame(positionNow);
    else positionNow();
  }

  function render(item) {
    revealDisclosure(item);
    const target = visibleTarget(doc, item.selector);
    if (!target) {
      restoreDisclosure();
      return false;
    }
    removeTarget();
    currentTarget = target;
    currentTarget.classList.add('feature-tour-target');
    const reducedMotion = Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    target.scrollIntoView?.({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    position.textContent = `Feature ${index + 1} of ${items.length}`;
    title.textContent = item.title;
    body.textContent = item.body;
    back.disabled = index <= 0;
    next.textContent = index >= items.length - 1 ? 'Finish' : 'Next';
    schedulePosition();
    next.focus();
    return true;
  }

  function afterRoute(callback) {
    if (win?.requestAnimationFrame) {
      win.requestAnimationFrame(() => win.requestAnimationFrame(callback));
      return;
    }
    callback();
  }

  function show(requestedIndex) {
    if (!active) return;
    let nextIndex = requestedIndex;
    const direction = requestedIndex < index ? -1 : 1;
    while (nextIndex >= 0 && nextIndex < items.length) {
      const item = items[nextIndex];
      index = nextIndex;
      const currentRoute = typeof router?.current === 'function' ? router.current() : null;
      if (item.routeId && item.routeId !== currentRoute) {
        router?.navigate?.(item.routeId);
        afterRoute(() => show(index));
        return;
      }
      if (render(item)) return;
      nextIndex += direction;
    }
    stop();
  }

  function start(trigger) {
    if (items.length === 0) return;
    const ElementConstructor = doc.defaultView?.HTMLElement;
    launcher = ElementConstructor && trigger instanceof ElementConstructor ? trigger : doc.activeElement;
    active = true;
    doc.body.classList.add('feature-tour-active');
    doc.body.append(backdrop, dialog);
    show(0);
  }

  function stop() {
    if (!active) return;
    active = false;
    if (raf !== null && win?.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    raf = null;
    removeTarget();
    restoreDisclosure();
    backdrop.remove();
    dialog.remove();
    doc.body.classList.remove('feature-tour-active');
    launcher?.focus?.();
    launcher = null;
  }

  function onKeydown(event) {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); stop(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
  }

  const unsubscribeRoute = router?.onChange?.(() => { if (active) afterRoute(() => show(index)); });
  win?.addEventListener('keydown', onKeydown);
  win?.addEventListener('resize', schedulePosition);
  win?.addEventListener('scroll', schedulePosition, true);

  return {
    start,
    stop,
    isOpen: () => active,
    destroy() {
      stop();
      if (typeof unsubscribeRoute === 'function') unsubscribeRoute();
      win?.removeEventListener('keydown', onKeydown);
      win?.removeEventListener('resize', schedulePosition);
      win?.removeEventListener('scroll', schedulePosition, true);
    },
  };
}
