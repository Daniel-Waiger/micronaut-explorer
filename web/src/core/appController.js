// The lifecycle coordinator extracted out of main.js's init(). main.js calls
// init() at module scope (see main.js's own comment on that), so nothing
// inside it could ever be imported by a test -- exactly the situation
// core/persist.js's loadMostRecentRecoverable and engine/kbpack.js's
// shapeAppKb were already extracted to fix. This module is the same move
// applied to the rest of init(): every closure that touches `store` and
// `persist` (the recovery ring, project import/export, the guided-progress
// transitions, and the debounced autosave subscriber) now lives here, built
// from injected collaborators instead of module-level imports, so a test can
// supply fakes for all of them.
//
// Shell rendering, the walkthrough controllers, explainGuided and
// renderActiveStep all stay in main.js -- they are view/routing concerns,
// not persistence ones, and moving them would not make anything more
// testable.
//
// `timers` (`{ setTimeout, clearTimeout }`) makes the 500ms autosave debounce
// deterministic under a fake clock; `now` makes `savedAt` deterministic;
// `logger` (default `console`) lets a test assert a warning fired without
// polluting console output.

/**
 * A study's origin describes how it entered the workspace; it is not
 * provenance. Keep this immutable so imports/restores replace the entire
 * snapshot rather than leaking metadata from the study that was open before.
 */
export function withOrigin(experiment, origin) {
  return { ...experiment, meta: { ...(experiment.meta || {}), origin } };
}

export function projectFilename(experiment) {
  const title = String(experiment?.meta?.title || 'micronaut-study')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${title || 'micronaut-study'}.micronaut.json`;
}

/**
 * The one shared test for "did this study arrive from the shipped example":
 * an opened example is tagged `'template'` ("started from the example") the
 * moment it lands in the store (see openExampleStudy below), and nothing in
 * the current app ever writes the older `'example'` tag into a live store --
 * that value only ever arrives via an autosave written by a build that
 * predates the `template` rename. Checking for `'example'` alone (as
 * adoptExampleTemplate, ui/steps/guide.js and ui/walkthrough.js's "Use as
 * template" all independently used to) is therefore a gate that can never
 * open in the current app. Export this as the ONE place that rule lives --
 * AUD-13 wires the same predicate into guide.js and walkthrough.js rather
 * than growing a second copy of it.
 */
export function isExampleOrigin(origin) {
  return origin === 'example' || origin === 'template';
}

/**
 * The thin wrapper around persist.loadMostRecentRecoverable that supplies the
 * empty-study fallback -- persist.js deliberately doesn't know what a fresh
 * study looks like, so `experiment: null` means "start fresh" here. Only
 * fires when NO usable autosave exists at all (true first run, or every ring
 * slot was corrupted); an existing in-progress study is never touched.
 *
 * `persist` is the injected bundle (see createAppController), not a direct
 * import, so this stays importable and testable without a real
 * localStorage-backed module.
 */
export function resolveInitialExperiment(persist, createEmptyStudy, { onUnreadable } = {}) {
  const { experiment, skippedCount, totalSaved } = persist.loadMostRecentRecoverable({ onUnreadable });
  return {
    experiment: experiment || createEmptyStudy(),
    skippedCount,
    totalSaved,
    // `totalSaved` can be non-zero when every slot was unreadable. Only an
    // experiment actually recovered from the ring justifies a saved claim.
    isPersisted: Boolean(experiment),
  };
}

/**
 * @param {object} deps
 * @param {object} deps.store - a core/store.js createStore() instance.
 * @param {object} deps.persist - bundle of core/persist.js's exports this
 *   controller needs: clearAll, deleteExperiment, exportToFile, importFromFile,
 *   listSaved, loadExperiment, loadMostRecentRecoverable, loadRecoverableSlot,
 *   markChanged, markExported, saveExperiment.
 * @param {object} deps.guided - bundle of core/guidedProgress.js's transition
 *   functions: load, start, resume, pause, advance, restart.
 * @param {Array} deps.primaryWorkflow - engine/workflowProgress.js's PRIMARY_WORKFLOW.
 * @param {() => object} deps.createExampleStudy - core/defaultStudy.js's createDefaultStudy.
 * @param {() => object} deps.createEmptyStudy - core/schema.js's emptyExperiment.
 * @param {boolean} [deps.isPersisted] - from resolveInitialExperiment's result;
 *   seeds the initial save-state status.
 * @param {boolean} [deps.isSandbox=false] - core/storageScope.js's IS_SANDBOX,
 *   true only in the `?demo=1` practice tab. Injected rather than imported
 *   (like every other collaborator here -- see the header comment) so a test
 *   can construct a controller in either mode without a real `location`.
 *   Defaults to false -- the safe reading when nobody says otherwise is "this
 *   is somebody's real study" -- and main.js is the one caller that passes the
 *   real value. openExampleStudy's guard (below) is gated on this.
 * @param {{ setTimeout: Function, clearTimeout: Function }} [deps.timers]
 * @param {() => string} [deps.now] - returns the ISO timestamp used for `savedAt`.
 * @param {{ error: Function, warn: Function }} [deps.logger]
 * @param {number} [deps.autosaveDebounceMs]
 */
export function createAppController({
  store,
  persist,
  guided,
  primaryWorkflow,
  createExampleStudy,
  createEmptyStudy,
  isPersisted = false,
  isSandbox = false,
  timers = {
    setTimeout: (...args) => window.setTimeout(...args),
    clearTimeout: (...args) => window.clearTimeout(...args),
  },
  now = () => new Date().toISOString(),
  logger = console,
  autosaveDebounceMs = 500,
} = {}) {
  // Two-phase, same as main.js's pre-extraction pattern: every callback
  // below may be constructed and handed to renderShell before the shell
  // itself exists (renderShell needs the callbacks to build its buttons).
  // `attachShell` is the explicit second phase -- every use of `shell` below
  // is a guarded optional call for exactly that reason, not a defensive
  // afterthought.
  let shell = null;

  function attachShell(nextShell) {
    shell = nextShell;
  }

  /**
   * Stamp `meta.updatedAt` (from the injected `now`, so this is exactly as
   * fake-clock-testable as `saveState.savedAt` already is) on a COPY of
   * `experiment`, for handing to persist.saveExperiment -- never on the
   * object living in the store.
   *
   * Why here and not in persist.js: persist.js's saveExperiment docstring
   * says plainly that module has no clock anywhere and is deliberately
   * ignorant of document shape (slot ids are "not keyed by
   * experiment.meta.id") -- it cannot stamp a field it never looks at.
   * appController already owns `now`, so this is the one place both the
   * save and the stamp happen together.
   *
   * CRITICAL, and the one thing that must never regress: this returns a
   * NEW object rather than mutating `experiment` in place. Writing the
   * timestamp back into the LIVE study (e.g. via store.patch/replace)
   * would run it through the same notification path startAutosave's
   * subscriber listens on to schedule the next debounced save -- so a
   * mutating version of this helper would have every save notify
   * subscribers, which schedules another autosave, which stamps and
   * notifies again: an unbounded loop. Returning a copy means the
   * timestamp only ever reaches persist (and, through it, the Restore
   * list, which reads the persisted slot's raw meta.updatedAt directly);
   * the in-memory study just picks up its own updatedAt the next time it
   * is loaded fresh from storage, same as every other field persist.js
   * round-trips.
   */
  function withSaveStamp(experiment) {
    return { ...experiment, meta: { ...(experiment.meta || {}), updatedAt: now() } };
  }

  function notifyToast(message) {
    if (shell && typeof shell.showToast === 'function') shell.showToast(message);
  }

  function notifyRecoveryEntries() {
    if (shell && typeof shell.setRecoveryEntries === 'function') shell.setRecoveryEntries(recoveryEntries());
  }

  let saveState = { status: isPersisted ? 'saved' : 'unsaved', savedAt: null, error: null };

  function getSaveState() {
    return saveState;
  }

  function setSaveState(next) {
    saveState = { ...saveState, ...next };
    if (shell && typeof shell.setSaveState === 'function') shell.setSaveState(saveState);
  }

  function reportStorageFailure() {
    setSaveState({
      status: 'failed',
      error: 'Storage is full or unavailable. Export a project backup, then free space from Settings → Clear all stored data (or delete an old saved version from Restore).',
    });
  }

  function reportPersistentLifecycleFailure(message) {
    // The shell's save indicator is the one persistent lifecycle-status
    // surface. A toast alone vanishes after three seconds, leaving an import
    // or recovery failure indistinguishable from a successful no-op.
    setSaveState({ status: 'failed', error: message });
    notifyToast(message);
  }

  function recoveryEntries() {
    // The shell receives display-only data, never a persistence backend. It
    // therefore cannot accidentally load, mutate, or clear localStorage on
    // its own; selected restores always come back through the callbacks
    // below.
    return persist.listSaved().map((id) => {
      const raw = persist.loadExperiment(id);
      const title = typeof raw?.meta?.title === 'string' && raw.meta.title.trim()
        ? raw.meta.title.trim()
        : 'Untitled study';
      // Read raw, un-migrated meta.updatedAt directly (this function never
      // calls migrate()) rather than fabricating one: every slot saved
      // before this change genuinely has no updatedAt, and reporting `null`
      // honestly for those is the point, not an edge case to paper over. A
      // hand-edited or corrupt slot whose updatedAt survived as some other
      // type (a number, an object) is normalized to `null` the same way,
      // since it is not a value anything downstream should render as a date.
      const savedAt = typeof raw?.meta?.updatedAt === 'string' ? raw.meta.updatedAt : null;
      return { id, title, savedAt };
    });
  }

  function exportProjectBackup() {
    // Stamped like any other write. Without this the downloaded file carries
    // whatever updatedAt the in-memory study happens to hold -- which, for a
    // study created and edited in this session and never reloaded, is still
    // the creation time from emptyExperiment(). Someone importing that file
    // an hour later would get a document claiming it had not been touched
    // since it was made, and a workspace list sorting by recency would put it
    // in the wrong place. The export IS the moment this copy was written, so
    // that is what it should say.
    persist.exportToFile(withSaveStamp(store.get()), projectFilename(store.get()));
    persist.markExported({ onQuotaExceeded: reportStorageFailure });
    notifyToast('Project backup downloaded.');
  }

  async function importProjectBackup(file) {
    if (!file) return;
    try {
      const { experiment: imported, issues } = await persist.importFromFile(file);
      store.replace(withOrigin(imported, 'imported'));
      // replace() schedules the ordinary autosave subscriber. Clear any
      // earlier lifecycle failure immediately; that subscriber will keep the
      // status at saving, then replace it with saved or a storage failure.
      setSaveState({ status: 'saving', error: null });
      // core/importValidate.js sanitizes rather than rejects most shape
      // problems (a malformed provenance slot, an assay reset to defaults)
      // so the rest of a real backup is never thrown away over one bad
      // corner -- but a sanitized field is exactly the kind of change a
      // project owner needs to notice, not one that should vanish into the
      // console alone.
      if (Array.isArray(issues) && issues.length > 0) {
        issues.forEach((issue) => logger.warn('Project import:', issue.message));
        notifyToast(
          `Project imported, but ${issues.length} part(s) of the file were invalid and reset to defaults. See the browser console for details.`
        );
      } else {
        notifyToast('Project imported. It is now the study being autosaved.');
      }
    } catch (err) {
      reportPersistentLifecycleFailure(
        `Could not import that project: ${err && err.message ? err.message : 'invalid file'}`
      );
    }
  }

  function restoreRecoverySlot(id) {
    const { experiment, error } = persist.loadRecoverableSlot(id, {
      onUnreadable: (slotId, err) => logger.error(`Could not restore autosave ${slotId}:`, err),
    });
    if (!experiment) {
      reportPersistentLifecycleFailure(
        `Could not restore that version: ${error ? error.message : 'it is unavailable'}`
      );
      return false;
    }
    store.replace(experiment);
    setSaveState({ status: 'saving', error: null });
    notifyToast('Restored the selected previous version.');
    return true;
  }

  // Storage is a CONVENIENCE, never the record of truth (see persist.js's
  // header), but until now the only in-app escape from a full or corrupt
  // ring was closing the tab and clearing browsing data by hand -- these two
  // give quota-exhausted or otherwise stuck users a real exit that never
  // requires leaving the app. Neither touches the study currently open in
  // memory: deleting a saved slot only removes ONE ring entry; clearing
  // storage wipes every ring slot and the change counter, but the live
  // in-memory study survives and the very next autosave attempt (forced
  // immediately below, so the save indicator does not keep reporting the
  // just-cleared failure) writes it into the now-empty ring.
  function deleteRecoverySlot(id) {
    persist.deleteExperiment(id, { onQuotaExceeded: reportStorageFailure });
    notifyRecoveryEntries();
    notifyToast('Deleted that saved version.');
  }

  /**
   * clearAll (AUD-01) returns { ok, removed, error } instead of silently
   * doing its best -- a caller that cannot tell "actually cleared" from
   * "silently did nothing" has no honest way to report success. This must
   * show the success toast ONLY when both the clear AND the follow-up
   * re-save of the currently open study succeeded; anything else reports
   * the failure instead of erasing it, which is what this replaced (the
   * old version fired the success toast unconditionally, and downgraded a
   * failed re-save to `{ status: 'unsaved', error: null }` -- silently
   * discarding the very error it should have surfaced).
   */
  function clearAllStoredData() {
    const clearResult = persist.clearAll({ onQuotaExceeded: reportStorageFailure });
    if (!clearResult.ok) {
      reportPersistentLifecycleFailure(
        `Could not clear stored data: ${clearResult.error && clearResult.error.message ? clearResult.error.message : 'storage is unavailable'}.`
      );
      return false;
    }
    const savedId = persist.saveExperiment(withSaveStamp(store.get()), { onQuotaExceeded: reportStorageFailure });
    notifyRecoveryEntries();
    if (!savedId) {
      reportPersistentLifecycleFailure(
        'Cleared stored data, but your open study could not be re-saved -- download a project backup so it is not lost if you reload.'
      );
      return false;
    }
    setSaveState({ status: 'saved', savedAt: now(), error: null });
    notifyToast('Cleared all locally stored data. Your open study is unaffected, and saving has resumed.');
    return true;
  }

  // Opening the example is an explicit request, so it arrives as ordinary
  // editable work tagged `template` ("started from the example") rather than
  // `example` ("the shipped seed, not yours"). Nothing has to be adopted,
  // copied, or disowned before the visitor may type in it. `origin: 'example'`
  // still exists in the schema so older autosaves keep loading unchanged.
  function openExampleStudy() {
    // HARD REFUSAL, first statement, unconditional. This function replaces
    // the entire in-memory study -- the one truly destructive operation in
    // this whole module -- so the guard belongs INSIDE it, not at its call
    // sites. A call-site check only makes TODAY's callers safe (main.js no
    // longer wires a real-tab control to this); it says nothing about a
    // future button, a mis-merge that re-points a real-tab entry point back
    // at openExampleStudy, or someone invoking
    // controller.actions.onOpenExample()/onReset() from the console. Putting
    // the check here instead makes the study-replacing path itself
    // unreachable outside the practice tab, no matter how it gets invoked --
    // the only thing a call-site check can never guarantee.
    if (!isSandbox) {
      logger.error(
        'openExampleStudy: refused outside the practice tab (?demo=1). This call would replace the real study in place; it is a no-op here on purpose.'
      );
      return false;
    }

    // A pending debounced autosave timer holds a closure over store.get()
    // that fires 500ms after the *last* edit, whenever that lands relative to
    // this call. Without flushing it first, store.replace() below runs while
    // that timer is still pending, and it then fires AFTER the replace, reads
    // store.get() fresh (now the example), and persists the example over the
    // ring slot that should hold the practice edit the user made just before
    // clicking reset -- the exact bug documented on startBlankStudy above,
    // reproduced here because this function has the identical shape
    // (read-then-replace across a debounce window). startBlankStudy already
    // calls flushAutosave() for this reason; this was the same latent bug,
    // just not yet triggered because nothing had exercised this path with a
    // pending timer.
    flushAutosave();

    // Preserve the exact current state synchronously, before replace() can
    // expose example data to the autosave subscriber. This snapshot is
    // protected from normal ring eviction: since this function is now only
    // reachable from the sandbox tab, "the current state" here is always the
    // sandbox's own prior practice activity, never the user's real study --
    // but the protection is the same one openExampleStudy always used, so
    // browsing or editing the example still can never delete whatever
    // practice work came before it. If durable preservation is unavailable,
    // do not switch workspaces at all.
    const protectedId = persist.saveExperiment(withSaveStamp(store.get()), {
      onQuotaExceeded: reportStorageFailure,
      protectFromAutomaticEviction: true,
    });
    if (!protectedId) {
      reportPersistentLifecycleFailure(
        'Could not preserve your current practice state, so the example was not reopened. Download a project backup or free storage, then try again.'
      );
      return false;
    }
    const example = createExampleStudy();
    store.replace(withOrigin(example, 'template'));
    notifyRecoveryEntries();
    // Pre-sandbox this toast said "Your study was preserved in Restore" --
    // accurate when this function could be called from the real tab and
    // really did displace someone's own study. Now that the guard above makes
    // that unreachable, the only thing this ever does is reset the PRACTICE
    // tab back to the shipped example, so the copy has to talk about practice
    // activity, not "your study" (there is no other study here to preserve).
    notifyToast('Reset to the example study. Your previous practice activity was preserved in Restore.');
    return true;
  }

  /**
   * Fixes the data-loss bug this task exists to close: `store.replace()`
   * used to run while a pending 500ms autosave timer still held a closure
   * over the ring-buffer write, so the timer fired AFTER the replace, read
   * store.get() fresh, and persisted the new BLANK study into the ring
   * instead of the edit the user had just made -- while
   * ui/steps/settings.js's confirm dialog promises "Your current work
   * remains available in Restore." Two changes close the window:
   *   1. flushAutosave() cancels that pending timer and runs its save
   *      synchronously, against the CURRENT (still edited) study, before
   *      anything else happens.
   *   2. The same protected-snapshot pattern openExampleStudy already uses
   *      guarantees that edited study a slot immune to ring eviction, and
   *      aborts the whole operation (never replaces the live study) if that
   *      snapshot can't be taken.
   */
  function startBlankStudy() {
    flushAutosave();
    const protectedId = persist.saveExperiment(withSaveStamp(store.get()), {
      onQuotaExceeded: reportStorageFailure,
      protectFromAutomaticEviction: true,
    });
    if (!protectedId) {
      reportPersistentLifecycleFailure(
        'Could not preserve your current study, so a blank study was not started. Download a project backup or free storage, then try again.'
      );
      return false;
    }
    store.replace(createEmptyStudy());
    notifyRecoveryEntries();
    notifyToast('Started a blank study. Your previous versions remain available in Restore.');
    return true;
  }

  function adoptExampleTemplate() {
    if (!isExampleOrigin(store.get().meta?.origin)) return false;
    store.patch((state) => ({ meta: { ...state.meta, origin: 'template' } }));
    return true;
  }

  let guidedStorageFailureAnnounced = false;
  function reportGuidedStorageFailure(error) {
    logger.error('Could not persist guided walkthrough progress:', error);
    // Guarded rather than calling shell.showToast unconditionally: this can
    // fire before `attachShell` has ever run (the initial guided.load call
    // below runs at construction time, ahead of renderShell), and
    // repeatedly on every step transition once storage is broken --
    // announce the failure once, the first time a toast surface is
    // actually available.
    if (guidedStorageFailureAnnounced || !shell || typeof shell.showToast !== 'function') return;
    guidedStorageFailureAnnounced = true;
    shell.showToast('Walkthrough progress could not be saved — it will restart if you reload.');
  }

  let guidedProgressState = guided.load(primaryWorkflow, { onError: reportGuidedStorageFailure });

  function getGuidedState() {
    return guidedProgressState;
  }

  function applyGuidedTransition(transition, options = {}) {
    guidedProgressState = transition(primaryWorkflow, {
      ...options,
      state: guidedProgressState,
      onError: reportGuidedStorageFailure,
    });
    return guidedProgressState;
  }

  const guidedTransitions = {
    start: () => applyGuidedTransition(guided.start),
    resume: () => applyGuidedTransition(guided.resume),
    pause: () => applyGuidedTransition(guided.pause),
    advance: (stepId) => applyGuidedTransition(guided.advance, { fromStepId: stepId }),
    restart: () => applyGuidedTransition(guided.restart),
  };

  // Debounced: saving on every keystroke would fill the 5-slot ring buffer
  // with near-duplicate snapshots of the last few characters typed, rather
  // than the last 5 genuinely distinct states the ring buffer exists to
  // preserve as history.
  let saveTimer = null;

  function performAutosave() {
    const savedId = persist.saveExperiment(withSaveStamp(store.get()), { onQuotaExceeded: reportStorageFailure });
    if (savedId) {
      setSaveState({ status: 'saved', savedAt: now(), error: null });
      notifyRecoveryEntries();
    } else {
      reportStorageFailure();
    }
  }

  /**
   * Cancel a pending debounced autosave and run it immediately, against
   * whatever store.get() currently holds. A no-op when nothing is pending.
   * This is what makes startBlankStudy (above) safe: called before
   * store.replace(), it guarantees the edit sitting in the timer's closure
   * is the one that gets persisted, not whatever replaces it next.
   */
  function flushAutosave() {
    if (saveTimer === null) return;
    timers.clearTimeout(saveTimer);
    saveTimer = null;
    performAutosave();
  }

  function startAutosave() {
    return store.subscribe(() => {
      setSaveState({ status: 'saving', error: null });
      // Run after the state transition: if this bookkeeping write fails, its
      // visible failed state must not be overwritten immediately by "saving".
      persist.markChanged({ onQuotaExceeded: reportStorageFailure });
      if (saveTimer !== null) timers.clearTimeout(saveTimer);
      saveTimer = timers.setTimeout(() => {
        saveTimer = null;
        performAutosave();
      }, autosaveDebounceMs);
    });
  }

  // These lifecycle actions replace the in-memory root and deliberately
  // leave the five prior recovery slots intact. That makes a mistaken reset
  // recoverable instead of making a "start over" action a data-loss trap.
  // Spread this same object into both renderShell's options and every
  // step's render() options (main.js) -- shared names, single source.
  //
  // onReset and onOpenExample are still both aliases of the same
  // openExampleStudy, kept as two names because existing callers use both --
  // but in the real tab they are now unreachable-by-design rather than merely
  // unused: the UI no longer wires either to a real-tab control, and even if
  // it did (or a console call invoked one directly), openExampleStudy's own
  // isSandbox guard refuses outside the practice tab regardless of which
  // name was used to reach it.
  const actions = {
    onReset: openExampleStudy,
    onNewBlank: startBlankStudy,
    onAdoptExample: adoptExampleTemplate,
    onOpenExample: openExampleStudy,
    onExportProject: exportProjectBackup,
    onImportProject: importProjectBackup,
    onRestoreRecovery: restoreRecoverySlot,
    onDeleteRecovery: deleteRecoverySlot,
    onClearAllStorage: clearAllStoredData,
  };

  return {
    attachShell,
    actions,
    guidedTransitions,
    getGuidedState,
    getSaveState,
    recoveryEntries,
    startAutosave,
    flushAutosave,
  };
}
