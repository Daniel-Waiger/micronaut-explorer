import { getPath, setPath } from './paths.js';
import { canOverwrite, tagSlot } from './provenance.js';

// The Experiment store: a single mutable root object plus subscriber
// notification. Reads/writes address the object with the same dot/bracket
// path syntax as core/paths.js; setPath (the store method, not the paths.js
// helper of the same name -- see the aliasing below) is additionally gated
// by tiered provenance so a weaker-sourced write can never clobber a
// stronger one.

export function createStore(initialExperiment) {
  let state = initialExperiment;
  const subscribers = new Set();
  let notifyScheduled = false;

  function scheduleNotify() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      for (const fn of subscribers) fn(state);
    });
  }

  function get() {
    return state;
  }

  function getAtPath(path) {
    return getPath(state, path);
  }

  function patch(partialOrFn) {
    const partial = typeof partialOrFn === 'function' ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...partial };
    scheduleNotify();
    return state;
  }

  /**
   * Write `value` at `path`, tagged with the given provenance `tag`.
   * Refuses (returns false, leaves state unchanged) when the slot at `path`
   * already carries a STRONG tag and `tag` is not itself STRONG. Returns
   * true and notifies subscribers on a successful write.
   */
  function setValueAtPath(path, value, tag) {
    const existingTag = state.provenance?.slots?.[path]?.tag ?? null;
    if (!canOverwrite(existingTag, tag)) {
      return false;
    }
    setPath(state, path, value);
    tagSlot(state, path, tag);
    scheduleNotify();
    return true;
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    get,
    getPath: getAtPath,
    patch,
    setPath: setValueAtPath,
    subscribe,
  };
}
