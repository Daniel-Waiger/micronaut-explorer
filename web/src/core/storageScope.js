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

// Bare (pre-scope) key literals for every "app-owned but outside
// persist.js's STORAGE_PREFIX sweep" key family, named here ONCE so
// clearAll's ownedScopedKeys() below and the modules that actually read and
// write these keys can never drift apart (lesson 40: a constant that must
// mirror another producer's output has to come from ONE place, not be
// retyped in a second file). guidedProgress.js, onboarding.js, shell.js and
// advice.js all import their key(s) from here rather than building the
// literal themselves.
//
// V2-NEW-03: these four families sit outside persist.js's STORAGE_PREFIX
// ('micronaut.v1.'/'micronaut.demo.v1.') by design -- guided-walkthrough
// progress, onboarding answers and nav/debug preferences are not ring slots
// -- but "Clear all stored data" is documented (and, for guided progress,
// user-observably expected) to remove them too. ownedScopedKeys() is the
// list persist.js's clearAll sweeps IN ADDITION TO its prefix match.
// Exported individually as `export const` (never a trailing bare
// `export { ... }` statement) -- tools/build_single_file.py strips
// `export const/function/class/default` declarations line-by-line when it
// concatenates these ES modules into dist's single script, but a separate
// `export { A, B };` statement survives that stripping and leaks a top-level
// `export` keyword into the served, non-module artifact (a
// SyntaxError/blank-page failure in a browser that isn't running this as a
// module). tests/test_e2e_flows.py's
// test_served_artifact_has_no_static_import_or_export_statements guards this.
export const GUIDED_PROGRESS_KEY_BASE = 'micronaut.guidedProgress.v1';
export const ONBOARDING_STAGE_KEY_BASE = 'micronaut.onboarding.stage';
export const ONBOARDING_EXPERIENCE_KEY_BASE = 'micronaut.onboarding.experience';
export const ONBOARDING_COMPLETED_KEY_BASE = 'micronaut.onboarding.completed';
const NAV_COLLAPSED_KEY_BASE = 'micronaut.navCollapsed';
const ADVISOR_DEBUG_KEY_BASE = 'micronaut.advisorDebug';

/** Scoped for THIS tab -- shell.js's own per-tab layout preference. */
export const NAV_COLLAPSED_KEY = nsKey(NAV_COLLAPSED_KEY_BASE);

/** Scoped for THIS tab -- advice.js's own per-tab developer toggle. */
export const ADVISOR_DEBUG_KEY = nsKey(ADVISOR_DEBUG_KEY_BASE);

const OWNED_KEY_BASES = [
  GUIDED_PROGRESS_KEY_BASE,
  ONBOARDING_STAGE_KEY_BASE,
  ONBOARDING_EXPERIENCE_KEY_BASE,
  ONBOARDING_COMPLETED_KEY_BASE,
  NAV_COLLAPSED_KEY_BASE,
  ADVISOR_DEBUG_KEY_BASE,
];

/**
 * The scoped forms of every key family this app owns OUTSIDE persist.js's
 * STORAGE_PREFIX sweep, for the given scope (not necessarily the CURRENT
 * tab's scope -- persist.js's clearAll takes an explicit scope so a caller
 * can target either scope deliberately). Built with makeNsKey(scope) rather
 * than the module-level nsKey so it stays correct for a non-default scope.
 */
export function ownedScopedKeys(scope) {
  const scopedNsKey = makeNsKey(scope);
  return OWNED_KEY_BASES.map(scopedNsKey);
}
