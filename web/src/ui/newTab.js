// Open a URL in a new browser tab by synthesising a click on a real <a>,
// rather than calling window.open.
//
// Two reasons, both about the practice tab (core/storageScope.js):
//
//   - A genuine anchor activation reads to the browser as a user navigation,
//     so a popup blocker does not eat it the way it can eat window.open.
//
//   - rel="noopener" survives. That matters here beyond the usual advice:
//     `?demo=1` is SAME-ORIGIN, so without it the practice tab would receive a
//     live `window.opener` handle back into a tab holding the user's real work.
//
// There is deliberately NO blocked-popup fallback. With noopener, window.open()
// returns null unconditionally, so the usual `if (!w) { ... }` detection cannot
// tell "blocked" from "fine" -- which is exactly why this picks a path blockers
// do not intercept instead of trying to detect one they do.
//
// `doc` is injectable for the same reason ui/feedbackHandoff.js injects its
// opener: so a test can assert the URL and the rel/target attributes against
// the shared DOM stub, with no real browser involved.

export function openInNewTab(url, { doc = typeof document !== 'undefined' ? document : null } = {}) {
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) return false;
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

/**
 * The URL of the practice tab, relative to whatever path the app is being
 * served from. Relative on purpose: the same string has to work under
 * file:// (one downloaded index.html), on a project subpath, and on localhost.
 */
export const SANDBOX_URL = '?demo=1';
