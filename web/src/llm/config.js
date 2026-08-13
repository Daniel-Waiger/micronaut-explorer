// Persisted LLM settings: whether the local-model provider is enabled, and
// its endpoint/model. Same idiom as ui/shell.js's THEME_KEY and
// ui/advice.js's ADVISOR_DEBUG_KEY -- localStorage, read through a
// try/catch so a disabled/unavailable localStorage degrades to "off"
// (manual-paste, the always-available provider) rather than throwing.
//
// OFF by default: a fresh install never calls out anywhere until the user
// explicitly opts in and points it at their own server.

const ENABLED_KEY = 'micronaut.llm.enabled';
const ENDPOINT_KEY = 'micronaut.llm.endpoint';
const MODEL_KEY = 'micronaut.llm.model';

export const DEFAULT_ENDPOINT = 'http://localhost:11434';
export const DEFAULT_MODEL = 'llama3.1:8b';

function readLS(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence here is a convenience, matching THEME_KEY's own comment:
    // a failed write only means the setting won't survive a reload.
  }
}

export function loadLlmConfig() {
  return {
    enabled: readLS(ENABLED_KEY, '0') === '1',
    endpoint: readLS(ENDPOINT_KEY, DEFAULT_ENDPOINT),
    model: readLS(MODEL_KEY, DEFAULT_MODEL),
  };
}

export function saveLlmConfig({ enabled, endpoint, model }) {
  if (typeof enabled === 'boolean') writeLS(ENABLED_KEY, enabled ? '1' : '0');
  if (typeof endpoint === 'string') writeLS(ENDPOINT_KEY, endpoint);
  if (typeof model === 'string') writeLS(MODEL_KEY, model);
}
