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
import { buildGuidanceMessages } from '../engine/render/llmprompt.js';
import { loadLlmConfig, saveLlmConfig } from '../llm/config.js';
import { copyToClipboard } from './clipboard.js';

function buildProvider(config) {
  if (config.enabled && config.endpoint && config.model) {
    return createOllamaProvider({ endpoint: config.endpoint, model: config.model });
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
 */
export function createGuidancePanel(getContext) {
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

  section.appendChild(settingsRow);

  function syncSettingsVisibility() {
    endpointInput.hidden = !enabledCheckbox.checked;
    modelInput.hidden = !enabledCheckbox.checked;
  }

  const config = loadLlmConfig();
  enabledCheckbox.checked = config.enabled;
  endpointInput.value = config.endpoint;
  modelInput.value = config.model;
  syncSettingsVisibility();

  function persistSettings() {
    saveLlmConfig({ enabled: enabledCheckbox.checked, endpoint: endpointInput.value, model: modelInput.value });
    syncSettingsVisibility();
  }
  enabledCheckbox.addEventListener('change', persistSettings);
  endpointInput.addEventListener('change', persistSettings);
  modelInput.addEventListener('change', persistSettings);

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
    const context = getContext() || {};
    const { system, user: contextBlock } = buildGuidanceMessages(context.doc, context.questions);
    const question = questionInput.value.trim();
    const user = question ? `${contextBlock}\n\n--- USER'S QUESTION ---\n${question}` : contextBlock;

    askButton.disabled = true;
    askButton.textContent = 'Asking...';
    try {
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
      askButton.disabled = false;
      askButton.textContent = 'Ask';
    }
  }

  askButton.addEventListener('click', ask);
  copyButton.addEventListener('click', () => copyToClipboard(pasteBox.value));

  return { element: section, update() {} };
}
