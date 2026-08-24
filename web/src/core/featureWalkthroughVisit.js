// Browser-local eligibility for the feature tour. A session marker is the
// deliberate refresh guard: sessionStorage survives reloads in one tab but
// disappears when that tab is closed. localStorage retains only the last
// time the app was left, never the study or any feedback content.

export const FEATURE_TOUR_AWAY_MS = 24 * 60 * 60 * 1000;

const LAST_ACTIVE_KEY = 'micronaut.featureTour.lastActiveAt';
const SESSION_KEY = 'micronaut.featureTour.activeSession';

function read(storage, key) {
  try { return storage?.getItem(key); } catch { return null; }
}

function write(storage, key, value) {
  try { storage?.setItem(key, String(value)); } catch { /* convenience only */ }
}

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

/**
 * Returns a small lifecycle controller. It never starts UI itself; main.js
 * owns overlay priority and calls `shouldStartNow()` only when no other
 * modal workflow is active.
 */
export function createFeatureWalkthroughVisit({
  localStorage: persistentStorage = globalThis.localStorage,
  sessionStorage: tabStorage = globalThis.sessionStorage,
  now = () => Date.now(),
  awayMs = FEATURE_TOUR_AWAY_MS,
} = {}) {
  const continuingSession = read(tabStorage, SESSION_KEY) === '1';
  write(tabStorage, SESSION_KEY, '1');
  let hiddenAt = null;
  let initialDecisionPending = true;

  function isAwayLongEnough(timestamp) {
    const lastActive = validTimestamp(timestamp);
    return !lastActive || now() - lastActive >= awayMs;
  }

  function shouldStartNow() {
    if (!initialDecisionPending) return false;
    initialDecisionPending = false;
    return !continuingSession && isAwayLongEnough(read(persistentStorage, LAST_ACTIVE_KEY));
  }

  function markHidden() {
    hiddenAt = now();
    write(persistentStorage, LAST_ACTIVE_KEY, hiddenAt);
  }

  function shouldStartOnReturn() {
    if (hiddenAt === null) return false;
    const wasAwayLongEnough = now() - hiddenAt >= awayMs;
    hiddenAt = null;
    return wasAwayLongEnough;
  }

  function markLeaving() {
    write(persistentStorage, LAST_ACTIVE_KEY, now());
  }

  return { shouldStartNow, markHidden, shouldStartOnReturn, markLeaving };
}
