// The Guidance panel (local-llm-guidance, capability A): an opt-in "ask
// about this step" feature. OFF by default (llm/config.js) and, even when
// on, this panel NEVER writes to the store -- it sends the current step's
// questions plus the study drafted so far to whichever provider is
// configured (llm/provider.js) and renders the reply as plain text. There
// is no Accept/Apply button here; that is the entire difference between
// this panel and describe.js's Proposals list, which DOES write (through
// core/store.js, gated by provenance). Guidance is read-only by
// construction, matching how PREAMBLE/GUIDANCE_PREAMBLE keep the model from
// inventing domain facts on the copy-paste side.
//
// Two providers, same call site: with the local-model checkbox off (or the
// Ollama server unreachable), this degrades to the manual-paste provider --
// build the prompt text, let the user copy it to whatever LLM they already
// have open -- rather than erroring or doing nothing.
//
// Vanilla DOM only, no innerHTML with dynamic content -- same discipline as
// the rest of ui/ (shell.js's standing rule).

import { createManualPasteProvider } from '../llm/manualPaste.js';
import { createOllamaProvider } from '../llm/ollama.js';
import { detectOllama } from '../llm/detect.js';
import { buildGuidanceMessages } from '../engine/render/llmprompt.js';
import { loadLlmConfig, saveLlmConfig } from '../llm/config.js';
import { copyToClipboard } from './clipboard.js';
import { COLD_START_HINT, startElapsedLabel } from './llmStatus.js';
import { recordOllamaRequest } from '../llm/rateLimit.js';
import { rateLimitLabel } from './rateLimitLabel.js';

// file:// has no notion of an authorized CORS origin, and offline has no
// network at all -- either way a remote endpoint can never actually be
// reached, so the remote path is hidden and manual-paste (which needs
// nothing but the page itself) is the only option shown.
export function remoteInferenceAvailable() {
  const isFileOrigin = typeof location !== 'undefined' && location.protocol === 'file:';
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return !isFileOrigin && !isOffline;
}

function buildProvider(config) {
  if (remoteInferenceAvailable() && config.enabled && config.endpoint && config.model) {
    return createOllamaProvider({ endpoint: config.endpoint, model: config.model, token: config.token });
  }
  return createManualPasteProvider();
}

/**
 * `getContext()` is called fresh at ASK time, not captured once at mount --
 * the study and the current step's askable questions change under a panel
 * that stays mounted, and a stale snapshot would silently answer about an
 * experiment that no longer exists. Must return `{doc, questions}`: `doc`
 * is engine/studydoc.js's buildStudyDocument output, `questions` is
 * whatever question list (loadQuestions/nextQuestions/answeredQuestions
 * output) the current step wants explained.
 *
 * Returns {element, update()}. update() is a no-op today (there is no
 * per-render state besides the persisted settings, which are re-read on
 * every Ask) -- kept only so a step can mount this panel with the same
 * `{element, update}` shape as ui/advice.js's createAdvicePanel.
 *
 * `onConfigChange`, if given, is called after every settings edit (the
 * enabled checkbox, the endpoint, the model). describe.js uses this to fix a
 * real bug: its Draft/Suggest buttons used to read loadLlmConfig().enabled
 * once at render() time, so ticking this panel's checkbox did not reveal
 * them until the step re-rendered. This is NOT a full re-render hook --
 * describe.js's callback only updates button visibility, deliberately,
 * because a full re-render would lose the narrative textarea's caret
 * mid-typing.
 */
export function createGuidancePanel(getContext, { onConfigChange } = {}) {
  const section = document.createElement('div');
  section.className = 'guidance-section';

  const heading = document.createElement('div');
  heading.className = 'guidance-heading';
  heading.textContent = 'Ask about this step';
  section.appendChild(heading);

  const hint = document.createElement('p');
  hint.className = 'guidance-hint';
  hint.textContent =
    'The model only sees this study’s data and the current questions -- it cannot invent a marker, control, or setting that is not already here.';
  section.appendChild(hint);

  const settingsRow = document.createElement('div');
  settingsRow.className = 'guidance-settings';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'guidance-enabled-label';
  const enabledCheckbox = document.createElement('input');
  enabledCheckbox.type = 'checkbox';
  enabledLabel.appendChild(enabledCheckbox);
  enabledLabel.appendChild(document.createTextNode(' Use my local model (Ollama) instead of copy-paste'));
  settingsRow.appendChild(enabledLabel);

  const endpointInput = document.createElement('input');
  endpointInput.type = 'text';
  endpointInput.className = 'guidance-endpoint';
  endpointInput.placeholder = 'http://localhost:11434';
  settingsRow.appendChild(endpointInput);

  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.className = 'guidance-model';
  modelInput.placeholder = 'model name, e.g. llama3.1:8b';
  settingsRow.appendChild(modelInput);

  // Populated from detectOllama() when a local server answers at the
  // currently-configured endpoint; hidden (and modelInput shown instead)
  // whenever detection finds nothing -- no server, available:false, or a
  // remote/non-default endpoint the probe can't reach. This keeps the panel
  // usable via free text no matter what detection does, per this task's
  // degrade-gracefully requirement.
  const modelSelect = document.createElement('select');
  modelSelect.className = 'guidance-model guidance-model-select';
  modelSelect.hidden = true;
  settingsRow.appendChild(modelSelect);

  const modelDetectedHint = document.createElement('span');
  modelDetectedHint.className = 'guidance-model-detected-hint';
  modelDetectedHint.textContent = ' (detected)';
  modelDetectedHint.hidden = true;
  settingsRow.appendChild(modelDetectedHint);

  // Only needed for a gated gateway (the "unit server" case) sitting in
  // front of Ollama; a bare LAN Ollama box takes no token. Blank means "send
  // no Authorization header at all" (llm/ollama.js), not "send an empty
  // Bearer".
  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.className = 'guidance-token';
  tokenInput.placeholder = 'access token (unit server only, leave blank for a bare LAN Ollama)';
  tokenInput.autocomplete = 'off';
  settingsRow.appendChild(tokenInput);

  section.appendChild(settingsRow);

  // Shown instead of the settings row on file:// or while offline, where a
  // remote endpoint can never actually be reached (see
  // remoteInferenceAvailable() above).
  const remoteUnavailableNotice = document.createElement('p');
  remoteUnavailableNotice.className = 'guidance-hint guidance-remote-unavailable';
  remoteUnavailableNotice.textContent =
    'Running from a downloaded file or offline: only copy-paste is available here.';
  remoteUnavailableNotice.hidden = true;
  section.appendChild(remoteUnavailableNotice);

  // Set once, shown/hidden with the rest of the local-model settings: this
  // is the one place the endpoint/model config lives, so it's also the one
  // place a user checking the box will see the cold-start expectation
  // before clicking Ask (or, from describe.js, Draft/Suggest -- those reuse
  // this same persisted config rather than owning their own settings UI).
  const coldStartHint = document.createElement('p');
  coldStartHint.className = 'guidance-hint guidance-cold-start-hint';
  coldStartHint.textContent = COLD_START_HINT;
  section.appendChild(coldStartHint);

  // Soft client-side counter (llm/rateLimit.js) -- the server enforces the
  // real limit, this just tells the user where they stand before they hit
  // it. Shown/hidden alongside the rest of the enabled-and-reachable state.
  const rateLimitHint = document.createElement('p');
  rateLimitHint.className = 'guidance-hint guidance-rate-limit-hint';
  section.appendChild(rateLimitHint);

  // True once detectOllama() has found a reachable server WITH at least one
  // model at the currently-configured endpoint; false any time detection is
  // pending, failed, or found nothing (available:false, or a remote/
  // non-default endpoint the probe can't reach) -- the text input is always
  // the fallback, never a dead end.
  let modelDetected = false;

  function currentModelValue() {
    return modelDetected ? modelSelect.value : modelInput.value;
  }

  function syncSettingsVisibility() {
    const remoteOk = remoteInferenceAvailable();
    settingsRow.hidden = !remoteOk;
    remoteUnavailableNotice.hidden = remoteOk;
    endpointInput.hidden = !enabledCheckbox.checked;
    modelInput.hidden = !enabledCheckbox.checked || modelDetected;
    modelSelect.hidden = !enabledCheckbox.checked || !modelDetected;
    modelDetectedHint.hidden = !enabledCheckbox.checked || !modelDetected;
    tokenInput.hidden = !enabledCheckbox.checked;
    coldStartHint.hidden = !remoteOk || !enabledCheckbox.checked;
    rateLimitHint.hidden = !remoteOk || !enabledCheckbox.checked;
    if (!rateLimitHint.hidden) rateLimitHint.textContent = rateLimitLabel().text;
  }

  const config = loadLlmConfig();
  enabledCheckbox.checked = config.enabled;
  endpointInput.value = config.endpoint;
  modelInput.value = config.model;
  tokenInput.value = config.token;
  syncSettingsVisibility();

  function persistSettings() {
    saveLlmConfig({
      enabled: enabledCheckbox.checked,
      endpoint: endpointInput.value,
      model: currentModelValue(),
      token: tokenInput.value,
    });
    syncSettingsVisibility();
    if (typeof onConfigChange === 'function') onConfigChange();
  }
  enabledCheckbox.addEventListener('change', persistSettings);
  endpointInput.addEventListener('change', persistSettings);
  modelInput.addEventListener('change', persistSettings);
  modelSelect.addEventListener('change', persistSettings);
  tokenInput.addEventListener('change', persistSettings);

  // Probe the currently-configured endpoint for a local Ollama server and,
  // if one answers with at least one model, swap the free-text model input
  // for a <select> listing them (pre-selecting the configured model when
  // it's in the list). Runs on mount and again whenever the endpoint field
  // changes (its own 'change' listener above already persists the new
  // endpoint first). detectOllama() is TOTAL -- it never throws or hangs
  // past its own timeout -- so this can never block the panel; on any
  // non-detection outcome the text input is left exactly as it was.
  let detectionToken = 0;
  async function runDetection() {
    const endpointAtStart = endpointInput.value;
    const myToken = ++detectionToken;
    const result = await detectOllama({ endpoint: endpointAtStart });
    // Drop a stale response: either a newer detection superseded this one,
    // or the endpoint field has since changed again.
    if (myToken !== detectionToken || endpointInput.value !== endpointAtStart) return;

    if (result.available && result.models.length > 0) {
      const wanted = currentModelValue();
      modelSelect.textContent = '';
      for (const name of result.models) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        modelSelect.appendChild(option);
      }
      modelSelect.value = result.models.includes(wanted) ? wanted : result.models[0];
      modelDetected = true;
    } else {
      modelDetected = false;
    }
    persistSettings();
  }
  endpointInput.addEventListener('change', () => {
    runDetection();
  });
  // Fire-and-forget on mount: intentionally not awaited so the panel is
  // interactive immediately via the text input while detection runs.
  runDetection();

  const questionInput = document.createElement('input');
  questionInput.type = 'text';
  questionInput.className = 'guidance-question';
  questionInput.placeholder = 'What is this step asking? What do these options mean?';
  section.appendChild(questionInput);

  const askButton = document.createElement('button');
  askButton.type = 'button';
  askButton.className = 'guidance-ask';
  askButton.textContent = 'Ask';
  section.appendChild(askButton);

  const replyBox = document.createElement('div');
  replyBox.className = 'guidance-reply';
  replyBox.hidden = true;
  section.appendChild(replyBox);

  // The manual-paste path: no model answered anything, so what's shown is
  // the exact text to copy, plus a way to copy it -- never rendered as if
  // it were already a reply.
  const pasteLabel = document.createElement('div');
  pasteLabel.className = 'guidance-paste-label';
  pasteLabel.textContent = 'Copy this into your own LLM:';
  pasteLabel.hidden = true;
  section.appendChild(pasteLabel);

  const pasteBox = document.createElement('textarea');
  pasteBox.className = 'guidance-paste-box';
  pasteBox.readOnly = true;
  pasteBox.hidden = true;
  section.appendChild(pasteBox);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'guidance-copy';
  copyButton.textContent = 'Copy';
  copyButton.hidden = true;
  section.appendChild(copyButton);

  function showReply(text) {
    pasteLabel.hidden = true;
    pasteBox.hidden = true;
    copyButton.hidden = true;
    replyBox.textContent = text;
    replyBox.hidden = false;
  }

  function showPaste(text) {
    replyBox.hidden = true;
    pasteBox.value = text;
    pasteLabel.hidden = false;
    pasteBox.hidden = false;
    copyButton.hidden = false;
  }

  async function ask() {
    const cfg = loadLlmConfig();
    const provider = buildProvider(cfg);
    // The soft counter only governs actual Ollama calls -- manual-paste
    // never leaves the browser, so it's exempt (matches recordOllamaRequest
    // only ever being called on the 'ollama' branch below).
    if (provider.id === 'ollama' && rateLimitLabel().atLimit) {
      showReply(rateLimitLabel().text);
      return;
    }
    const context = getContext() || {};
    const { system, user: contextBlock } = buildGuidanceMessages(context.doc, context.questions);
    const question = questionInput.value.trim();
    const user = question ? `${contextBlock}\n\n--- USER'S QUESTION ---\n${question}` : contextBlock;

    askButton.disabled = true;
    // Only Ollama has a real wait worth explaining -- manual-paste composes
    // text locally and resolves instantly, so ticking a label for it would
    // just flash "Asking… 0s" for a moment.
    const stopTicking = provider.id === 'ollama' ? startElapsedLabel(askButton, 'Asking') : null;
    if (!stopTicking) askButton.textContent = 'Asking...';
    try {
      if (provider.id === 'ollama') recordOllamaRequest();
      const result = await provider.complete({ system, user });
      if (provider.id === 'manual-paste') {
        showPaste(result.text);
      } else {
        showReply(result.text || '(no reply)');
      }
    } catch (err) {
      // Degrade rather than fail: if the configured Ollama server is
      // unreachable, fall back to the always-available manual-paste
      // provider so the feature still delivers something rather than a
      // dead end -- see docs/plans (local-llm-guidance) verification.
      showReply(`Couldn't reach the local model (${err.message}). Falling back to copy-paste below.`);
      const fallback = createManualPasteProvider();
      const fb = await fallback.complete({ system, user });
      showPaste(fb.text);
    } finally {
      if (stopTicking) stopTicking();
      askButton.disabled = false;
      askButton.textContent = 'Ask';
      syncSettingsVisibility();
    }
  }

  askButton.addEventListener('click', ask);
  copyButton.addEventListener('click', () => copyToClipboard(pasteBox.value));

  return { element: section, update() {} };
}
