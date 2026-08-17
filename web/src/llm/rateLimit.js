// Client-side soft rate-limit UX for remote (Ollama/unit-server) calls: a
// persisted rolling window of request timestamps so the UI can show "N left
// this hour" / a cooldown before the user hits a wall, rather than after.
//
// This is UX only, not enforcement -- the plan's server contract
// (docs/plans/zen-planner-server-contract.md) makes the gateway the
// authoritative limit. A user can clear localStorage and keep going; that's
// fine, because the server still rejects them. This module exists so a
// well-behaved client doesn't surprise the user with a silent 429.
//
// Manual-paste calls are never recorded here -- they never leave the
// browser, so they don't count against any server-side limit either.

const LOG_KEY = 'micronaut.llm.requestLog';
export const DEFAULT_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

function readLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'number') : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort persistence, same as llm/config.js -- a failed write just
    // means the counter resets next load.
  }
}

function pruneToWindow(entries, now) {
  return entries.filter((t) => now - t < WINDOW_MS);
}

/** Records one remote request happening now. Call only for an actual Ollama call, never manual-paste. */
export function recordOllamaRequest(now = Date.now()) {
  const entries = pruneToWindow(readLog(), now);
  entries.push(now);
  writeLog(entries);
}

/** How many remote requests are still allowed in the current rolling hour. */
export function ollamaRequestsRemaining(limit = DEFAULT_LIMIT, now = Date.now()) {
  const entries = pruneToWindow(readLog(), now);
  return Math.max(0, limit - entries.length);
}

/** Seconds until the oldest request in the current window ages out (0 if under the limit already). */
export function ollamaCooldownSeconds(limit = DEFAULT_LIMIT, now = Date.now()) {
  const entries = pruneToWindow(readLog(), now).sort((a, b) => a - b);
  if (entries.length < limit) return 0;
  const oldest = entries[entries.length - limit];
  return Math.max(0, Math.ceil((oldest + WINDOW_MS - now) / 1000));
}
