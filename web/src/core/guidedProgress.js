// Versioned presentation-only progress for the contextual example guide.
//
// The caller injects the canonical primary workflow on every operation. This
// module deliberately owns no step ids, labels, experiment data, or router
// aliases; changing engine/workflowProgress.js therefore cannot leave a stale
// second registry here. Storage is a convenience and every read/write is
// total so a blocked preference store cannot prevent the app from booting.

export const GUIDED_PROGRESS_VERSION = 1;
export const GUIDED_PROGRESS_KEY = `micronaut.guidedProgress.v${GUIDED_PROGRESS_VERSION}`;

const STATUSES = new Set(['not-started', 'active', 'paused', 'completed']);
const RECORD_KEYS = ['version', 'status', 'currentStepId', 'completedStepIds', 'completedAt'];

function workflowIds(primaryWorkflow) {
  const seen = new Set();
  const ids = [];
  for (const step of Array.isArray(primaryWorkflow) ? primaryWorkflow : []) {
    const id = step && typeof step.id === 'string' ? step.id : null;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function guidedProgressBackend() {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function validIso(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function defaultState(ids) {
  return {
    version: GUIDED_PROGRESS_VERSION,
    status: 'not-started',
    currentStepId: ids[0] || null,
    completedStepIds: [],
    completedAt: null,
  };
}

/** Normalize untrusted saved/input state against the caller's real workflow. */
export function normalizeGuidedProgress(value, primaryWorkflow) {
  const ids = workflowIds(primaryWorkflow);
  const fallback = defaultState(ids);
  if (!value || typeof value !== 'object' || value.version !== GUIDED_PROGRESS_VERSION) {
    return fallback;
  }

  const completedInput = Array.isArray(value.completedStepIds) ? value.completedStepIds : [];
  const completedSet = new Set(completedInput.filter((id) => ids.includes(id)));
  // Canonical workflow order makes the stored list deterministic and removes
  // duplicates without trusting the order of hand-edited/corrupt JSON.
  const completedStepIds = ids.filter((id) => completedSet.has(id));
  let status = STATUSES.has(value.status) ? value.status : 'not-started';
  let currentStepId = ids.includes(value.currentStepId) ? value.currentStepId : null;
  let completedAt = validIso(value.completedAt) ? value.completedAt : null;

  if (ids.length === 0) return fallback;
  if (status === 'not-started') return fallback;

  if (status === 'completed') {
    // A workflow may gain a step between releases. A formerly completed
    // record becomes paused at the first new step rather than falsely
    // claiming the expanded workflow is complete.
    if (completedStepIds.length === ids.length && completedAt) {
      return {
        version: GUIDED_PROGRESS_VERSION,
        status,
        currentStepId: ids[ids.length - 1],
        completedStepIds,
        completedAt,
      };
    }
    status = 'paused';
    completedAt = null;
  }

  if (!currentStepId || completedSet.has(currentStepId)) {
    currentStepId = ids.find((id) => !completedSet.has(id)) || ids[ids.length - 1];
  }
  return {
    version: GUIDED_PROGRESS_VERSION,
    status,
    currentStepId,
    completedStepIds,
    completedAt,
  };
}

export function loadGuidedProgress(primaryWorkflow, { storage = guidedProgressBackend(), onError } = {}) {
  if (!storage) return normalizeGuidedProgress(null, primaryWorkflow);
  try {
    const raw = storage.getItem(GUIDED_PROGRESS_KEY);
    return normalizeGuidedProgress(raw === null ? null : JSON.parse(raw), primaryWorkflow);
  } catch (error) {
    if (onError) onError(error);
    return normalizeGuidedProgress(null, primaryWorkflow);
  }
}

/** Persist only the whitelisted presentation record; returns normalized state. */
export function saveGuidedProgress(value, primaryWorkflow, { storage = guidedProgressBackend(), onError } = {}) {
  const state = normalizeGuidedProgress(value, primaryWorkflow);
  if (!storage) return state;
  try {
    const record = Object.fromEntries(RECORD_KEYS.map((key) => [key, state[key]]));
    storage.setItem(GUIDED_PROGRESS_KEY, JSON.stringify(record));
  } catch (error) {
    if (onError) onError(error);
  }
  return state;
}

function currentState(primaryWorkflow, options) {
  return options && options.state
    ? normalizeGuidedProgress(options.state, primaryWorkflow)
    : loadGuidedProgress(primaryWorkflow, options);
}

function persist(state, primaryWorkflow, options) {
  return saveGuidedProgress(state, primaryWorkflow, options);
}

export function startGuidedProgress(primaryWorkflow, options = {}) {
  const state = currentState(primaryWorkflow, options);
  if (!state.currentStepId || state.status === 'completed') return state;
  return persist({ ...state, status: 'active', completedAt: null }, primaryWorkflow, options);
}

export function resumeGuidedProgress(primaryWorkflow, options = {}) {
  return startGuidedProgress(primaryWorkflow, options);
}

export function pauseGuidedProgress(primaryWorkflow, options = {}) {
  const state = currentState(primaryWorkflow, options);
  if (state.status !== 'active') return state;
  return persist({ ...state, status: 'paused' }, primaryWorkflow, options);
}

function timestamp(options) {
  const supplied = options && options.now;
  const value = typeof supplied === 'function' ? supplied() : supplied;
  return validIso(value) ? value : new Date().toISOString();
}

export function completeGuidedProgress(primaryWorkflow, options = {}) {
  const ids = workflowIds(primaryWorkflow);
  const state = currentState(primaryWorkflow, options);
  if (ids.length === 0) return state;
  return persist({
    ...state,
    status: 'completed',
    currentStepId: ids[ids.length - 1],
    completedStepIds: ids,
    completedAt: timestamp(options),
  }, primaryWorkflow, options);
}

export function advanceGuidedProgress(primaryWorkflow, options = {}) {
  const ids = workflowIds(primaryWorkflow);
  const state = currentState(primaryWorkflow, options);
  if (state.status !== 'active' || !state.currentStepId) return state;
  // A rendered panel may deliver the same click twice. Supplying fromStepId
  // makes that stale second event a no-op instead of skipping a feature.
  if (options.fromStepId && options.fromStepId !== state.currentStepId) return state;

  const index = ids.indexOf(state.currentStepId);
  const completed = new Set(state.completedStepIds);
  completed.add(state.currentStepId);
  if (index < 0 || index === ids.length - 1) {
    return completeGuidedProgress(primaryWorkflow, { ...options, state: { ...state, completedStepIds: [...completed] } });
  }
  return persist({
    ...state,
    currentStepId: ids[index + 1],
    completedStepIds: ids.filter((id) => completed.has(id)),
  }, primaryWorkflow, options);
}

export function restartGuidedProgress(primaryWorkflow, options = {}) {
  const ids = workflowIds(primaryWorkflow);
  if (ids.length === 0) return persist(defaultState(ids), primaryWorkflow, options);
  return persist({ ...defaultState(ids), status: 'active' }, primaryWorkflow, options);
}
