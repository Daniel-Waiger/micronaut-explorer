// Hash-based routing: #/step-id addresses the current step. Survives a page
// reload by reading location.hash on init (falling back to the first step),
// and lets a step declare itself not yet reachable via a guard hook.

// Samples & design, Acquisition and Data plan used to be routes of their own.
// They are sections of the measurement page now, so a link, bookmark, or saved
// hash pointing at the old ids must land somewhere sensible rather than
// silently falling back to the first step -- which would drop someone on the
// Study map with no explanation of why their link "didn't work".
const ROUTE_ALIASES = Object.freeze({
  design: 'measurement',
  panel: 'measurement',
  naming: 'measurement',
  microscopy: 'measurement',
});

export function createRouter(steps) {
  const ids = steps.map((s) => s.id);

  function resolveId(raw) {
    if (ids.includes(raw)) return raw;
    const alias = ROUTE_ALIASES[raw];
    return alias && ids.includes(alias) ? alias : null;
  }
  const listeners = new Set();
  let current = null;

  function idFromHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    return resolveId(raw);
  }

  function isReachable(id) {
    const step = steps.find((s) => s.id === id);
    if (!step || typeof step.guard !== 'function') return true;
    return step.guard() !== false;
  }

  function notify() {
    for (const fn of listeners) fn(current);
  }

  function navigate(requestedId) {
    // Accepts an alias so existing call sites (and the guided walkthrough's
    // step ids) keep working without each one learning the new route map.
    const id = resolveId(requestedId);
    if (!id || !isReachable(id)) return false;
    current = id;
    const hash = '#/' + id;
    if (location.hash !== hash) {
      location.hash = hash;
    }
    notify();
    return true;
  }

  function currentId() {
    return current;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.addEventListener('hashchange', () => {
    const id = idFromHash();
    if (id && isReachable(id)) {
      current = id;
      // An aliased hash (#/design) resolves to its new route and renders it,
      // but leaving the old id in the address bar would misreport where the
      // user is -- and a copied link would keep propagating the retired id.
      const canonical = '#/' + id;
      if (location.hash !== canonical) {
        location.hash = canonical;
        return; // The rewrite re-enters this handler; let that pass notify.
      }
      notify();
    } else if (current) {
      // A bogus or currently-unreachable hash must not leave the URL
      // desynced from what's actually displayed -- correct it back to the
      // last known-good step.
      navigate(current);
    }
  });

  const fromHash = idFromHash();
  const initialId = fromHash && isReachable(fromHash) ? fromHash : ids[0];
  if (initialId) {
    navigate(initialId);
  }

  return { navigate, current: currentId, onChange, steps };
}
