// The AI Assist shell (zen-planner "one door" consolidation): a SINGLE
// collapsible <details> that houses every LLM-related entry point a step
// might offer, instead of each one exploding across the page as its own
// section. This module owns layout/composition only -- it does not know
// what a "draft" or a "chat prompt" is.
//
// This is a SHELL component, nothing more. It:
//   (a) mounts guidance.js's "Ask about this step" panel (capability A:
//       read-only, never writes to the store; its model field now
//       self-detects a local Ollama server -- see guidance.js);
//   (b) reserves an empty `.actionsContainer` slot for Draft/Suggest-style
//       buttons;
//   (c) reserves an empty `.chatContainer` slot for the copy-prompt/
//       link-out chat-LLM section.
//
// describe.js currently owns the Draft/Suggest/chat-LLM logic directly on
// its own page. Wiring that existing logic into `.actionsContainer` /
// `.chatContainer` (moving it, not duplicating it) is a SEPARATE task (D1)
// -- describe.js is off-limits here, so this module does not and cannot
// reach into it. Until D1 lands, the two containers are simply empty.
//
// Same reveal/reveal-summary idiom describe.js already uses for its own
// "Get AI help (optional)" details (see describe.js's aiHelpDetails
// comment): closed by default, and nothing here ever forces it back closed
// once a user has opened it.

import { createGuidancePanel } from './guidance.js';

/**
 * `getGuidanceContext()` is passed straight through to createGuidancePanel
 * as its `getContext` argument -- same contract: called fresh at ASK time,
 * must return `{doc, questions}`. `onConfigChange`, if given, is forwarded
 * to createGuidancePanel's own `onConfigChange` option so a caller (D1) can
 * still react to the enabled/endpoint/model settings changing (e.g. to show
 * its Draft/Suggest buttons once local-model use is turned on) without this
 * shell needing to know why.
 *
 * Returns `{element, update(), actionsContainer, chatContainer}` --
 * `{element, update()}` matches the mount-panel shape used elsewhere in
 * ui/ (createGuidancePanel, createAdvicePanel); `actionsContainer` and
 * `chatContainer` are the two slots described above, for the caller to
 * populate and manage on its own.
 */
export function createAiAssistPanel({ getGuidanceContext, onConfigChange } = {}) {
  const details = document.createElement('details');
  details.className = 'reveal aiassist-shell';

  const summary = document.createElement('summary');
  summary.className = 'reveal-summary';
  summary.textContent = 'Get AI help (optional)';
  details.appendChild(summary);

  const guidancePanel = createGuidancePanel(getGuidanceContext || (() => ({})), { onConfigChange });
  details.appendChild(guidancePanel.element);

  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'aiassist-actions';
  details.appendChild(actionsContainer);

  const chatContainer = document.createElement('div');
  chatContainer.className = 'aiassist-chatllm';
  details.appendChild(chatContainer);

  return {
    element: details,
    actionsContainer,
    chatContainer,
    update() {
      guidancePanel.update();
    },
  };
}
