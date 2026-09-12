// Persisted onboarding state: which walkthrough stage the user is on, their
// self-reported microscopy experience level, and whether onboarding has
// been completed. Same localStorage-read/written-through-a-try/catch idiom
// the removed llm/config.js's loadLlmConfig/saveLlmConfig once used, so a
// disabled/unavailable localStorage degrades to defaults (unset) rather
// than throwing.
//
// `completed` is the gate contract: a normal completion or dismissal means
// the visitor should not be interrupted again on later loads. The utility
// menu can intentionally reopen the gate through resetOnboarding().
//
// Core module: pure logic only, no DOM, no engine/ui imports, no network.

import {
  nsKey,
  ONBOARDING_STAGE_KEY_BASE,
  ONBOARDING_EXPERIENCE_KEY_BASE,
  ONBOARDING_COMPLETED_KEY_BASE,
} from './storageScope.js';

// Namespaced so the practice tab's walkthrough answers (stage/experience) and
// its completed-gate flag never leak into the user's own tab: without this, a
// visitor poking at the example would either permanently dismiss their own
// onboarding gate or overwrite their real stage/experience choices.
//
// The bare key literals live in storageScope.js so persist.js's clearAll can
// sweep them without importing this module (lesson 40).
const STAGE_KEY = nsKey(ONBOARDING_STAGE_KEY_BASE);
const EXPERIENCE_KEY = nsKey(ONBOARDING_EXPERIENCE_KEY_BASE);
const COMPLETED_KEY = nsKey(ONBOARDING_COMPLETED_KEY_BASE);

export const ONBOARDING_STAGES = ['idea', 'designing', 'acquiring'];
export const ONBOARDING_LEVELS = ['novice', 'occasional', 'frequent'];

function onboardingReadLS(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function onboardingWriteLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence here is a convenience; a failed write only means the
    // setting won't survive a reload.
  }
}

export function loadOnboarding() {
  const storedStage = onboardingReadLS(STAGE_KEY, null);
  const storedExperience = onboardingReadLS(EXPERIENCE_KEY, null);
  return {
    stage: ONBOARDING_STAGES.includes(storedStage) ? storedStage : null,
    experience: ONBOARDING_LEVELS.includes(storedExperience) ? storedExperience : null,
    completed: onboardingReadLS(COMPLETED_KEY, '0') === '1',
  };
}

export function saveOnboarding({ stage, experience, completed } = {}) {
  if (typeof stage === 'string' && ONBOARDING_STAGES.includes(stage)) {
    onboardingWriteLS(STAGE_KEY, stage);
  }
  if (typeof experience === 'string' && ONBOARDING_LEVELS.includes(experience)) {
    onboardingWriteLS(EXPERIENCE_KEY, experience);
  }
  if (typeof completed === 'boolean') {
    onboardingWriteLS(COMPLETED_KEY, completed ? '1' : '0');
  }
}

/**
 * Intentionally make the gate eligible to appear again while preserving the
 * visitor's prior stage and experience choices. This is used only by the
 * explicit "Show onboarding again" utility action.
 */
export function resetOnboarding() {
  onboardingWriteLS(COMPLETED_KEY, '0');
}
