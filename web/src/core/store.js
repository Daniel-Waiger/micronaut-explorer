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
   * Replace the entire experiment root.
   *
   * This is intentionally distinct from patch(): project-file imports and
   * recovery restores are authoritative snapshots, so merging them would
   * retain top-level data that is absent from the recovered study. Keeping
   * replacement here also means the normal subscriber/render path observes
   * exactly the state that the next autosave will persist.
   */
  function replace(nextExperiment) {
    state = nextExperiment;
    scheduleNotify();
    return state;
  }

  /**
   * Write `value` at `path`, tagged with the given provenance `tag`.
   * Refuses (returns false, leaves state unchanged) when the slot at
   * `slotKey` already carries a STRONG tag and `tag` is not itself STRONG.
   * Returns true and notifies subscribers on a successful write.
   *
   * `slotKey` (default: `path`) is the provenance identity, kept separate
   * from `path` (the object write address) for the assay tier (schema v3):
   * a per-assay write's real address is index-based (`assays[2].acquisition
   * .modality`, from core/assay.js's scopeWrite), but an array index is not
   * a stable identity -- deleting assay 0 would silently repoint every
   * surviving slot at a different assay's value. `slotKey` stays id-based
   * (`assay:<id>.acquisition.modality`) so provenance tracks WHICH assay,
   * not WHERE in the array it currently sits. Callers outside the assay
   * tier never pass this and get the pre-v3 behaviour unchanged.
   *
   * An empty value (the user clearing a field) is a deliberate exception:
   * it always succeeds, regardless of the existing tag, and is tagged
   * 'default' (WEAK) rather than whatever `tag` the caller passed. Without
   * this, clearing a field that once held a STRONG ('user') value would tag
   * the resulting emptiness STRONG too -- manufacturing false provenance
   * (the record would claim the user deliberately set the field to blank)
   * and permanently locking the slot, since canOverwrite would then refuse
   * every future WEAK/PROVISIONAL write (a KB default, an LLM suggestion)
   * forever. There is no user action that could ever clear a lock like
   * that, which is exactly the deadlock repo lesson 37 warns against.
   */
  function setValueAtPath(path, value, tag, { slotKey = path } = {}) {
    const isClearing = value === '' || value === null || value === undefined;
    const effectiveTag = isClearing ? 'default' : tag;
    if (!isClearing) {
      const existingTag = state.provenance?.slots?.[slotKey]?.tag ?? null;
      if (!canOverwrite(existingTag, effectiveTag)) {
        return false;
      }
    }
    setPath(state, path, value);
    tagSlot(state, slotKey, effectiveTag);
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
    replace,
    setPath: setValueAtPath,
    subscribe,
  };
}
