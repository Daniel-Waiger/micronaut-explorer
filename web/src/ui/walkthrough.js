// Persistent, non-modal contextual walkthrough renderer. The shell owns the
// host; main owns persistence and lifecycle. This module only renders an
// injected current projection and asks injected transitions to make changes.

function safeWorkflow(primaryWorkflow) {
  return (Array.isArray(primaryWorkflow) ? primaryWorkflow : [])
    .filter((step) => step && typeof step.id === 'string' && step.id)
    .map((step) => ({ id: step.id, label: typeof step.label === 'string' && step.label ? step.label : step.id }));
}

function fallbackProgress(primaryWorkflow) {
  return {
    status: 'not-started',
    currentStepId: primaryWorkflow[0]?.id || null,
    completedStepIds: [],
    completedAt: null,
  };
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, className, text, onClick) {
  const node = element(doc, 'button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function completeStep(step, fallbackId) {
  const value = step && typeof step === 'object' ? step : {};
  return {
    stepId: typeof value.stepId === 'string' && value.stepId ? value.stepId : fallbackId,
    title: typeof value.title === 'string' && value.title ? value.title : fallbackId,
    outcome: typeof value.outcome === 'string' && value.outcome ? value.outcome : 'Review the current workflow step.',
    what: typeof value.what === 'string' && value.what ? value.what : 'This step contributes to the current study plan.',
    why: typeof value.why === 'string' && value.why ? value.why : 'Each step keeps one part of the plan reviewable.',
    when: typeof value.when === 'string' && value.when ? value.when : 'Use this step whenever this part of the plan needs attention.',
    how: typeof value.how === 'string' && value.how ? value.how : 'Review the current values and continue when they fit the plan.',
    exampleLabel: typeof value.exampleLabel === 'string' && value.exampleLabel ? value.exampleLabel : 'In this study now',
    exampleSummary: typeof value.exampleSummary === 'string' && value.exampleSummary ? value.exampleSummary : 'Current study values are unavailable.',
    tryThis: typeof value.tryThis === 'string' && value.tryThis ? value.tryThis : 'Compare the current values with the plan you intend to run.',
    nextStepId: typeof value.nextStepId === 'string' ? value.nextStepId : null,
    nextTitle: typeof value.nextTitle === 'string' ? value.nextTitle : null,
  };
}

/**
 * Create the one persistent guided-panel controller.
 *
 * Required injections:
 * - `host`: the shell's one `<aside>` host.
 * - `primaryWorkflow`: canonical ordered primary workflow metadata.
 * - `router`: the real app router.
 * - `getContent()`: returns fresh `buildGuidedExampleContent()` output.
 * - `getProgress()` and `transitions`: persistence/state ownership supplied
 *   by main. Transition methods may return the new state; otherwise this
 *   controller re-reads `getProgress()`.
 * - `routeForStep()` / `stepForRoute()`: the shell/main routing authority;
 *   the controller deliberately has no microscopy-route alias of its own.
 *
 * `subscribe(listener)` is optional and is normally `store.subscribe`; it
 * refreshes values such as an active assay without changing guide progress.
 * `onVisibilityChange(visible)` is an optional shell presentation hook; it
 * fires only when this controller actually opens or closes the aside.
 */
export function createWalkthroughController({
  host,
  primaryWorkflow,
  router,
  getContent,
  getProgress,
  transitions = {},
  routeForStep,
  stepForRoute,
  subscribe,
  onAdoptExample,
  onNewBlank,
  onKeepExploringExample,
  onVisibilityChange,
} = {}) {
  if (!host || !host.ownerDocument) {
    throw new Error('createWalkthroughController requires the shell walkthrough host.');
  }

  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const workflow = safeWorkflow(primaryWorkflow);
  const ids = new Set(workflow.map((step) => step.id));
  let visible = false;
  let mode = 'walkthrough';
  let viewStepId = null;
  let lastProgress = fallbackProgress(workflow);
  let destroyed = false;
  let completionActionTaken = false;

  function readProgress() {
    try {
      const value = typeof getProgress === 'function' ? getProgress() : null;
      lastProgress = value && typeof value === 'object' ? value : fallbackProgress(workflow);
    } catch {
      lastProgress = fallbackProgress(workflow);
    }
    return lastProgress;
  }

  function currentStepId() {
    const progress = readProgress();
    return ids.has(progress.currentStepId) ? progress.currentStepId : workflow[0]?.id || null;
  }

  function routeFor(id) {
    return typeof routeForStep === 'function' ? routeForStep(id) : id;
  }

  function workflowIdForRoute(routeId) {
    const candidate = typeof stepForRoute === 'function' ? stepForRoute(routeId) : routeId;
    return ids.has(candidate) ? candidate : null;
  }

  function currentRouteStepId() {
    try {
      return workflowIdForRoute(router && typeof router.current === 'function' ? router.current() : null);
    } catch {
      return null;
    }
  }

  function contentFor(stepId) {
    let content;
    try {
      content = typeof getContent === 'function' ? getContent() : null;
    } catch {
      content = null;
    }
    const steps = Array.isArray(content) ? content : content && Array.isArray(content.steps) ? content.steps : [];
    return completeStep(steps.find((step) => step && step.stepId === stepId), stepId || workflow[0]?.id || 'step');
  }

  function navigate(stepId) {
    if (!stepId || !router || typeof router.navigate !== 'function') return false;
    return router.navigate(routeFor(stepId));
  }

  function invokeTransition(name, ...args) {
    const transition = transitions && transitions[name];
    if (typeof transition !== 'function') return readProgress();
    try {
      const result = transition(...args);
      lastProgress = result && typeof result === 'object' ? result : readProgress();
    } catch {
      lastProgress = readProgress();
    }
    return lastProgress;
  }

  function setVisible(nextVisible) {
    const next = Boolean(nextVisible);
    if (visible === next) return;
    visible = next;
    host.hidden = !next;
    if (typeof onVisibilityChange === 'function') {
      try { onVisibilityChange(next); } catch { /* shell presentation must not break the guide */ }
    }
  }

  function hide() {
    setVisible(false);
    host.replaceChildren();
  }

  // Opening the guide must have an immediately perceivable effect. On a
  // compact layout the aside is deliberately placed after the workspace, so
  // simply rendering it can look as though the launch button did nothing.
  // Move the reader to the new panel and give its heading a logical keyboard
  // focus target; wide layouts keep the panel beside the workspace and do
  // not need a page scroll.
  function revealPanel() {
    const heading = host.querySelector('.guided-walkthrough-title');
    if (!heading) return;
    heading.tabIndex = -1;
    const compactLayout = Boolean(win && typeof win.matchMedia === 'function' && win.matchMedia('(max-width: 1200px)').matches);
    if (compactLayout) {
      const reducedMotion = Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const top = Math.max(0, win.scrollY + host.getBoundingClientRect().top - 16);
      if (typeof win.scrollTo === 'function') {
        win.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
      } else if (typeof host.scrollIntoView === 'function') {
        host.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    }
    // Allow focus to bring the heading into view as a final safeguard. Some
    // embedded browsers defer smooth scrolling while the hash route settles.
    if (typeof heading.focus === 'function') heading.focus();
  }

  function revealPanelAfterRoute() {
    // Hash navigation notifies the router after the current call stack. Two
    // animation frames let that render settle before measuring/scrolling the
    // panel; otherwise a taller destination workspace can push the guide
    // below the position we just scrolled to.
    if (win && typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => win.requestAnimationFrame(revealPanel));
      return;
    }
    revealPanel();
  }

  function close() {
    if (mode === 'walkthrough' && readProgress().status === 'active') invokeTransition('pause');
    hide();
  }

  function renderCompletion() {
    const card = element(doc, 'section', 'guided-walkthrough-panel guided-walkthrough-complete');
    card.setAttribute('aria-label', 'Example walkthrough complete');
    const heading = element(doc, 'h2', 'guided-walkthrough-title', 'Example walkthrough complete');
    const summary = element(doc, 'p', 'guided-walkthrough-outcome', `You have reviewed ${workflow.length} workflow steps.`);
    const outcomes = element(doc, 'details', 'guided-walkthrough-details');
    outcomes.appendChild(element(doc, 'summary', '', 'What you reviewed'));
    const list = element(doc, 'ul', 'guided-walkthrough-outcomes');
    workflow.forEach((workflowStep) => list.appendChild(element(doc, 'li', '', `${workflowStep.label}: ${contentFor(workflowStep.id).outcome}`)));
    outcomes.appendChild(list);
    const actions = element(doc, 'div', 'guided-walkthrough-actions');

    function completionAction(callback) {
      if (completionActionTaken) return;
      completionActionTaken = true;
      if (typeof callback === 'function') callback();
      hide();
    }

    actions.append(
      button(doc, 'guided-walkthrough-adopt', 'Use as template', () => completionAction(onAdoptExample)),
      button(doc, 'guided-walkthrough-blank', 'Start my own', () => completionAction(onNewBlank)),
      button(doc, 'guided-walkthrough-keep', 'Keep exploring example', () => completionAction(onKeepExploringExample || (() => {})))
    );
    card.append(heading, summary, outcomes, actions);
    host.replaceChildren(card);
  }

  function renderStep() {
    const progress = readProgress();
    if (mode === 'walkthrough' && progress.status === 'completed') {
      renderCompletion();
      return;
    }
    const requestedId = mode === 'explanation' ? (viewStepId || currentRouteStepId()) : (viewStepId || currentStepId());
    const stepId = ids.has(requestedId) ? requestedId : workflow[0]?.id || null;
    const index = workflow.findIndex((step) => step.id === stepId);
    const context = contentFor(stepId);
    const card = element(doc, 'section', 'guided-walkthrough-panel');
    card.setAttribute('aria-label', mode === 'explanation' ? `Explanation: ${context.title}` : 'Example walkthrough');

    const top = element(doc, 'div', 'guided-walkthrough-topline');
    top.appendChild(element(doc, 'p', 'guided-walkthrough-position', mode === 'explanation'
      ? `Explain this step · ${context.title}`
      : `Example walkthrough · Step ${Math.max(index + 1, 1)} of ${workflow.length}`));
    top.appendChild(button(doc, 'guided-walkthrough-close', 'Close', close));

    const heading = element(doc, 'h2', 'guided-walkthrough-title', context.title);
    const outcome = element(doc, 'p', 'guided-walkthrough-outcome', context.outcome);
    const example = element(doc, 'section', 'guided-walkthrough-example');
    example.append(element(doc, 'h3', 'guided-walkthrough-example-label', context.exampleLabel), element(doc, 'p', 'guided-walkthrough-example-summary', context.exampleSummary));
    const what = element(doc, 'section', 'guided-walkthrough-what');
    what.append(element(doc, 'h3', '', 'What'), element(doc, 'p', '', context.what));
    const rationale = element(doc, 'details', 'guided-walkthrough-details');
    rationale.append(element(doc, 'summary', '', 'Why does this matter?'), element(doc, 'p', '', context.why));
    const timing = element(doc, 'details', 'guided-walkthrough-details');
    timing.append(element(doc, 'summary', '', 'When and how'), element(doc, 'p', '', context.when), element(doc, 'p', '', context.how));
    const tryThis = element(doc, 'section', 'guided-walkthrough-try');
    tryThis.append(element(doc, 'h3', '', 'Try this'), element(doc, 'p', '', context.tryThis));
    const actions = element(doc, 'div', 'guided-walkthrough-actions');

    if (mode === 'walkthrough') {
      const previous = index > 0 ? workflow[index - 1] : null;
      const cursor = currentStepId();
      const isViewingCursor = stepId === cursor;
      const back = button(doc, 'guided-walkthrough-back', 'Back', () => {
        if (!previous) return;
        viewStepId = previous.id;
        navigate(viewStepId);
        refresh();
      });
      back.disabled = !previous;
      const pause = button(doc, 'guided-walkthrough-pause', 'Pause', close);
      const nextLabel = isViewingCursor
        ? (context.nextTitle ? `Next feature: ${context.nextTitle}` : 'Finish walkthrough')
        : `Continue walkthrough: ${workflow.find((step) => step.id === cursor)?.label || 'current step'}`;
      const next = button(doc, 'guided-walkthrough-next', nextLabel, () => {
        if (!isViewingCursor) {
          viewStepId = cursor;
          navigate(cursor);
          refresh();
          return;
        }
        const after = invokeTransition('advance', stepId);
        if (after.status === 'completed') {
          refresh();
          return;
        }
        viewStepId = ids.has(after.currentStepId) ? after.currentStepId : currentStepId();
        navigate(viewStepId);
        refresh();
      });
      actions.append(back, pause, next);
    }

    card.append(top, heading, outcome, example, what, rationale, timing, tryThis, actions);
    host.replaceChildren(card);
  }

  function refresh({ fromRoute = false } = {}) {
    if (destroyed || !visible) return;
    if (fromRoute) {
      const routed = currentRouteStepId();
      if (routed) viewStepId = routed;
    }
    renderStep();
  }

  function openWalkthrough({ restart = false } = {}) {
    completionActionTaken = false;
    mode = 'walkthrough';
    const before = readProgress();
    if (restart) invokeTransition('restart');
    else if (before.status === 'paused') invokeTransition('resume');
    else if (before.status === 'not-started') invokeTransition('start');
    setVisible(true);
    viewStepId = currentStepId();
    navigate(viewStepId);
    refresh();
    revealPanelAfterRoute();
  }

  function openExplanation(stepId = currentRouteStepId()) {
    mode = 'explanation';
    setVisible(true);
    viewStepId = ids.has(stepId) ? stepId : currentStepId();
    refresh();
    revealPanelAfterRoute();
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && visible) {
      event.preventDefault();
      close();
    }
  }

  const unsubscribeRoute = router && typeof router.onChange === 'function' ? router.onChange(() => refresh({ fromRoute: true })) : null;
  const unsubscribeStore = typeof subscribe === 'function' ? subscribe(refresh) : null;
  if (win) win.addEventListener('keydown', onKeydown);
  hide();

  return {
    openWalkthrough,
    start: openWalkthrough,
    resume: openWalkthrough,
    restart() { openWalkthrough({ restart: true }); },
    openExplanation,
    explain: openExplanation,
    close,
    refresh,
    isOpen() { return visible; },
    mode() { return visible ? mode : null; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof unsubscribeRoute === 'function') unsubscribeRoute();
      if (typeof unsubscribeStore === 'function') unsubscribeStore();
      if (win) win.removeEventListener('keydown', onKeydown);
      hide();
    },
  };
}

// Transitional export for callers updated in later guided-example tasks. It
// never creates a second host or a modal surface; main should create and
// retain the controller above after the shell renders.
export function startWalkthrough(options = {}) {
  const host = options.host || (typeof document !== 'undefined' && document.querySelector('[data-guided-walkthrough-host]'));
  if (!host) return null;
  const controller = createWalkthroughController({ ...options, host });
  controller.start();
  return controller;
}
