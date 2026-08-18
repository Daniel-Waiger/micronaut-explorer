// Persisted onboarding state: which walkthrough stage the user is on, their
// self-reported microscopy experience level, whether onboarding has ever
// been completed, and whether the user has explicitly opted out of seeing
// the gate again. Same idiom as llm/config.js's loadLlmConfig/saveLlmConfig
// -- localStorage read/written through a try/catch so a disabled/unavailable
// localStorage degrades to defaults (unset) rather than throwing.
//
// `completed` and `dontShowAgain` are deliberately SEPARATE flags, not one
// flag doing both jobs: the gate is meant to pop on every page load (main.js)
// so a returning user can re-route or change their experience level, and
// only an EXPLICIT "don't show this again" click (ui/steps/onboarding.js)
// should suppress that -- finishing the two-screen flow normally does not.
// `completed` on its own no longer gates anything; it is kept as a plain
// "has this browser ever been through the flow at least once" fact.
//
// Core module: pure logic only, no DOM, no engine/ui imports, no network.

const STAGE_KEY = 'micronaut.onboarding.stage';
const EXPERIENCE_KEY = 'micronaut.onboarding.experience';
const COMPLETED_KEY = 'micronaut.onboarding.completed';
const DONT_SHOW_AGAIN_KEY = 'micronaut.onboarding.dontShowAgain';

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
    dontShowAgain: onboardingReadLS(DONT_SHOW_AGAIN_KEY, '0') === '1',
  };
}

export function saveOnboarding({ stage, experience, completed, dontShowAgain } = {}) {
  if (typeof stage === 'string' && ONBOARDING_STAGES.includes(stage)) {
    onboardingWriteLS(STAGE_KEY, stage);
  }
  if (typeof experience === 'string' && ONBOARDING_LEVELS.includes(experience)) {
    onboardingWriteLS(EXPERIENCE_KEY, experience);
  }
  if (typeof completed === 'boolean') {
    onboardingWriteLS(COMPLETED_KEY, completed ? '1' : '0');
  }
  if (typeof dontShowAgain === 'boolean') {
    onboardingWriteLS(DONT_SHOW_AGAIN_KEY, dontShowAgain ? '1' : '0');
  }
}
