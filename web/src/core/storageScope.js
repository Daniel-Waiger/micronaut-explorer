// Named storage scopes: which set of localStorage keys this tab is allowed to
// touch.
//
// The app keeps ONE study at a time (core/store.js holds a single mutable
// root), so "let me poke at the example without risking my own work" has no
// in-tab answer -- opening the example used to replace the study on screen.
// The answer is a second TAB: `index.html?demo=1` opens the same app against a
// separate set of keys, and the tab you came from is never navigated away, so
// your study is still sitting there exactly as you left it.
//
// Resolved from location.search rather than the hash because the hash is
// already the router's address space (core/router.js's `#/step-id`), and a
// sandbox URL has to be able to carry a route too: `?demo=1#/guide` works,
// `#demo=1#/guide` does not.
//
// This resolves a NAMED SCOPE, not a demo yes/no, deliberately. A future
// multi-workspace feature (several studies accumulated in one place) is "more
// named scopes plus an index"; resolving a name here rather than a boolean is
// the difference between adding one later and rewriting every caller. Today
// exactly two names exist: '' (your own work) and 'demo' (the practice tab).
//
// HONEST LIMIT, and it must not be overstated anywhere in the UI: localStorage
// is one bucket per origin, so this is isolation by key prefix, not a separate
// store. It is a strong convention, not a wall -- any future code that writes
// an unprefixed key leaks across scopes. (The Core Facility Tracker, which this
// pattern is ported from, could open a whole separate IndexedDB *database* and
// so could promise more. We cannot, and say so.)

const APP_PREFIX = 'micronaut.';

// Keys every scope deliberately SHARES. The practice tab should look like the
// user's own app, and a remembered light/dark choice is not state worth
// isolating -- it carries no study data and losing it costs nothing.
const SHARED_KEYS = new Set(['micronaut.theme']);

/**
 * Map a query string onto a scope name. Total: any parse failure, and any
 * value other than the one recognized flag, resolves to the unscoped ''
 * rather than throwing -- a malformed URL must never be able to stop the app
 * booting, and must never be able to resolve to a scope by accident.
 */
export function resolveStorageScope(search) {
  try {
    const params = new URLSearchParams(String(search || ''));
    return params.get('demo') === '1' ? 'demo' : '';
  } catch {
    return '';
  }
}

/**
 * Build a key-namespacing function for one scope.
 *
 * Exported as a factory because STORAGE_SCOPE below is a module constant
 * resolved at import time and cannot be flipped from a test -- makeNsKey('demo')
 * is how the scoped branch gets proven under `node --test`, where there is no
 * `location` at all and the resolved scope is therefore always ''.
 *
 * The scope name is inserted AFTER the shared `micronaut.` prefix
 * ('micronaut.v1.ring' -> 'micronaut.demo.v1.ring') so every key the app owns
 * still groups under one namespace when someone opens DevTools. It also cannot
 * collide: 'micronaut.demo.v1.ring'.startsWith('micronaut.v1.') is false, which
 * is what keeps persist.js's prefix-sweeping clearAll() from reaching across
 * scopes in either direction.
 */
export function makeNsKey(scope) {
  return function nsKeyForScope(key) {
    if (!scope || SHARED_KEYS.has(key)) return key;
    const bare = key.startsWith(APP_PREFIX) ? key.slice(APP_PREFIX.length) : key;
    return `${APP_PREFIX}${scope}.${bare}`;
  };
}

export const STORAGE_SCOPE = resolveStorageScope(
  typeof location !== 'undefined' ? location.search : ''
);

/** True in the practice tab. Sugar over the one scope name that has UI attached. */
export const IS_SANDBOX = STORAGE_SCOPE === 'demo';

/** Namespace a key for THIS tab's scope. The only nsKey app code should use. */
export const nsKey = makeNsKey(STORAGE_SCOPE);
