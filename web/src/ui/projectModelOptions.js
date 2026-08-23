// Project's deliberately small local-model configuration surface. It owns
// configuration and endpoint detection only; it never receives study data or
// renders/executes a review. The Review component owns the copy/paste fallback.

import { localEndpointCallsAvailable } from '../llm/availability.js';
import { loadLlmConfig, saveLlmConfig } from '../llm/config.js';
import { detectOllama } from '../llm/detect.js';
import { COLD_START_HINT } from './llmStatus.js';
import { rateLimitLabel } from './rateLimitLabel.js';

function labelledInput(labelText, input) {
  const label = document.createElement('label');
  label.append(input, document.createTextNode(` ${labelText}`));
  return label;
}

/**
 * Creates Project's local-model settings disclosure.
 *
 * `getConfig()` always reads persisted settings afresh so a Review action does
 * not depend on the values present when this component was constructed.
 * `detect` and `runtime` are optional seams for isolated UI tests.
 */
export function createProjectModelOptions({ onConfigChange, detect = detectOllama, runtime } = {}) {
  const details = document.createElement('details');
  details.className = 'project-model-options reveal';

  const summary = document.createElement('summary');
  summary.className = 'reveal-summary';
  summary.textContent = 'Model options';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'project-model-options-body';
  details.appendChild(body);

  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.className = 'project-model-options-enabled';
  body.appendChild(labelledInput('Also use my local model (Ollama)', enabledInput));

  const unavailableNotice = document.createElement('p');
  unavailableNotice.className = 'project-model-options-unavailable';
  unavailableNotice.textContent =
    'Local model calls are unavailable from a downloaded file or while offline. Use copy and paste instead.';
  body.appendChild(unavailableNotice);

  const fields = document.createElement('div');
  fields.className = 'project-model-options-fields';
  body.appendChild(fields);

  const endpointInput = document.createElement('input');
  endpointInput.type = 'url';
  endpointInput.className = 'project-model-options-endpoint';
  endpointInput.placeholder = 'http://localhost:11434';
  fields.appendChild(labelledInput('Ollama endpoint', endpointInput));

  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.className = 'project-model-options-model';
  modelInput.placeholder = 'model name, e.g. llama3.1:8b';
  fields.appendChild(labelledInput('Model name', modelInput));

  const modelSelect = document.createElement('select');
  modelSelect.className = 'project-model-options-model-select';
  fields.appendChild(labelledInput('Detected model', modelSelect));

  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.className = 'project-model-options-token';
  tokenInput.autocomplete = 'off';
  tokenInput.placeholder = 'optional access token';
  fields.appendChild(labelledInput('Access token (optional)', tokenInput));

  const detectionStatus = document.createElement('p');
  detectionStatus.className = 'project-model-options-status';
  detectionStatus.setAttribute('aria-live', 'polite');
  body.appendChild(detectionStatus);

  const coldStartHint = document.createElement('p');
  coldStartHint.className = 'project-model-options-cold-start';
  coldStartHint.textContent = COLD_START_HINT;
  body.appendChild(coldStartHint);

  const rateLimitHint = document.createElement('p');
  rateLimitHint.className = 'project-model-options-rate-limit';
  body.appendChild(rateLimitHint);

  let detectedModels = [];
  let detectionGeneration = 0;

  function environmentAvailable() {
    return localEndpointCallsAvailable(runtime);
  }

  function selectedModel() {
    return detectedModels.length > 0 ? modelSelect.value : modelInput.value;
  }

  function getConfig() {
    return loadLlmConfig();
  }

  function notifyConfigChange() {
    if (typeof onConfigChange === 'function') onConfigChange(getConfig());
  }

  function persistConfig() {
    saveLlmConfig({
      enabled: enabledInput.checked,
      endpoint: endpointInput.value,
      model: selectedModel(),
      token: tokenInput.value,
    });
    notifyConfigChange();
  }

  function syncVisibility() {
    const available = environmentAvailable();
    const enabled = enabledInput.checked;
    const showFields = available && enabled;

    unavailableNotice.hidden = available;
    enabledInput.disabled = !available;
    fields.hidden = !showFields;
    endpointInput.disabled = !showFields;
    modelInput.hidden = !showFields || detectedModels.length > 0;
    modelInput.disabled = !showFields;
    modelSelect.hidden = !showFields || detectedModels.length === 0;
    modelSelect.disabled = !showFields || detectedModels.length === 0;
    tokenInput.disabled = !showFields;
    coldStartHint.hidden = !showFields;
    rateLimitHint.hidden = !showFields;
    if (showFields) rateLimitHint.textContent = rateLimitLabel().text;
  }

  function showFreeTextFallback(message) {
    detectedModels = [];
    modelSelect.textContent = '';
    detectionStatus.textContent = message;
    syncVisibility();
  }

  async function runDetection() {
    if (!environmentAvailable() || (!details.open && !enabledInput.checked)) return;

    const endpointAtStart = endpointInput.value;
    const generation = ++detectionGeneration;
    detectionStatus.textContent = 'Checking local models…';

    let result;
    try {
      result = await detect({ endpoint: endpointAtStart });
    } catch {
      result = { available: false, models: [] };
    }

    // A response belongs only to the endpoint and enabled/open state that
    // initiated it. Older, delayed probes must not replace newer choices.
    if (
      generation !== detectionGeneration ||
      endpointInput.value !== endpointAtStart ||
      !environmentAvailable() ||
      (!details.open && !enabledInput.checked)
    ) {
      return;
    }

    const models = result && Array.isArray(result.models) ? result.models : [];
    if (!result || !result.available || models.length === 0) {
      showFreeTextFallback('No local models were detected. You can enter a model name.');
      return;
    }

    const wanted = selectedModel();
    detectedModels = models;
    modelSelect.textContent = '';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    }
    modelSelect.value = models.includes(wanted) ? wanted : models[0];
    detectionStatus.textContent = 'Local models detected.';
    syncVisibility();
    persistConfig();
  }

  function invalidateDetection() {
    detectionGeneration += 1;
  }

  function onSettingInput() {
    persistConfig();
  }

  enabledInput.addEventListener('change', () => {
    invalidateDetection();
    persistConfig();
    syncVisibility();
    if (enabledInput.checked) runDetection();
  });

  endpointInput.addEventListener('input', () => {
    invalidateDetection();
    persistConfig();
    if (details.open || enabledInput.checked) runDetection();
  });
  modelInput.addEventListener('input', onSettingInput);
  modelSelect.addEventListener('change', onSettingInput);
  tokenInput.addEventListener('input', onSettingInput);

  details.addEventListener('toggle', () => {
    syncVisibility();
    if (details.open) runDetection();
  });

  const config = getConfig();
  enabledInput.checked = config.enabled;
  endpointInput.value = config.endpoint;
  modelInput.value = config.model;
  tokenInput.value = config.token;
  syncVisibility();

  // An enabled provider is already an explicit local-review opt-in, even if
  // the disclosure is collapsed. A disabled, collapsed disclosure never probes.
  if (enabledInput.checked) runDetection();

  return { element: details, getConfig, refreshDetection: runDetection };
}
