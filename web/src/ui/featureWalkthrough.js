// A concise, feature-level tour that deliberately complements (rather than
// replaces) the richer step explanation panel. Each stop owns a meaningful
// workspace area; repeated rows and individual fields remain part of that
// area's explanation so a real study does not turn into an endless tour.

const stop = (routeId, selector, title, body, revealSelector = null) => Object.freeze({ routeId, selector, title, body, revealSelector });

export const FEATURE_TOUR = Object.freeze([
  // Deliberately short. The previous tour had 33 stops across ten routes and
  // started itself; a tour long enough to need its own endurance is a sign the
  // interface is not explaining itself. These name the few places whose
  // purpose is not obvious from looking at them.
  stop(null, '.shell-nav', 'Navigation', 'Three workspaces: the shape of your study, its measurements, and a review of both. There is no required order.'),
  stop('home', '.study-map-editor', 'Study map', 'The shape of the study: question, system, comparison structure, and what counts as one independent unit. Everything else follows from these.'),
  stop('study', '.measurement-registry-controls', 'Finding a measurement', 'Search and filter the list. Each measurement is one observation or analysis used to answer the study question.'),
  stop('study', '.measurement-registry-row', 'One row per measurement', 'Its status says whether it is a draft, waiting on a decision, or ready to acquire. Open it to plan it.'),
  stop('measurement', '.measurement-anchor-rail', 'One measurement, one page', 'Samples & design, acquisition, and the data plan are sections of this page, because each one decides the next.'),
  stop('overview', '.overview-export-menu', 'Exports', 'Everything the plan can produce: a study document, a file manifest, bench cards, and a prompt for your own LLM.'),
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
  let inertedNodes = [];

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
      // The shell's own sticky footer (the per-step Back/Continue bar) lives at
      // the bottom of the viewport and is never part of `currentTarget`, so the
      // math below had no reason to leave it any room. Against a target taller
      // than the viewport minus the dialog -- routine on a phone, and common on
      // desktop for a multi-question card like the Study map -- every fallback
      // clamped the dialog flush against the target's bottom edge, exactly
      // where that footer sits. The result read as one broken modal with the
      // tour's own Back/Next/Close stacked directly against the app's own
      // Back/Continue, indistinguishable at a glance. Reserving this space
      // keeps the two apart in every layout, not just the one this was caught
      // in.
      const footerClearance = 96;
      const usableHeight = Math.max(dialogHeight + 32, height - footerClearance);
      let dialogLeft = right + gap;
      let dialogTop = Math.max(16, Math.min(rect.top, usableHeight - dialogHeight - 16));
      if (dialogLeft + dialogWidth > width - 16) dialogLeft = left - gap - dialogWidth;
      if (dialogLeft < 16) {
        dialogLeft = Math.max(16, Math.min(left, width - dialogWidth - 16));
        dialogTop = bottom + gap;
        if (dialogTop + dialogHeight > usableHeight - 16) dialogTop = Math.max(16, top - gap - dialogHeight);
        // Neither above nor below the target left room within the cleared
        // area -- the target itself is taller than the viewport can spare.
        // Docking to the top of the viewport, clear of the target's own
        // upper edge where relevant, beats clamping into the footer zone a
        // second time.
        if (dialogTop + dialogHeight > usableHeight - 16) dialogTop = 16;
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

  // The highlighted target sits in a cutout the shades deliberately don't
  // cover, so clicks and keystrokes still reach it -- and everything else on
  // the page remains focusable by Tab even while dimmed. Marking every other
  // top-level node inert removes it from hit-testing, tab order, and the
  // accessibility tree in one step, so a person cannot accidentally type into
  // or click a field mid-tour; the tour dialog itself is left untouched.
  function setInert() {
    inertedNodes = [...doc.body.children].filter((node) => node !== backdrop && node !== dialog);
    for (const node of inertedNodes) node.inert = true;
  }

  function clearInert() {
    for (const node of inertedNodes) node.inert = false;
    inertedNodes = [];
  }

  function start(trigger) {
    if (items.length === 0) return;
    const ElementConstructor = doc.defaultView?.HTMLElement;
    launcher = ElementConstructor && trigger instanceof ElementConstructor ? trigger : doc.activeElement;
    active = true;
    doc.body.classList.add('feature-tour-active');
    doc.body.append(backdrop, dialog);
    setInert();
    show(0);
  }

  function stop() {
    if (!active) return;
    active = false;
    if (raf !== null && win?.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    raf = null;
    removeTarget();
    restoreDisclosure();
    clearInert();
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
