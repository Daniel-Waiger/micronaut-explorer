// Hash-based routing: #/step-id addresses the current step. Survives a page
// reload by reading location.hash on init (falling back to the first step),
// and lets a step declare itself not yet reachable via a guard hook.

export function createRouter(steps) {
  const ids = steps.map((s) => s.id);
  const listeners = new Set();
  let current = null;

  function idFromHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    return ids.includes(raw) ? raw : null;
  }

  function isReachable(id) {
    const step = steps.find((s) => s.id === id);
    if (!step || typeof step.guard !== 'function') return true;
    return step.guard() !== false;
  }

  function notify() {
    for (const fn of listeners) fn(current);
  }

  function navigate(id) {
    if (!ids.includes(id) || !isReachable(id)) return false;
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
