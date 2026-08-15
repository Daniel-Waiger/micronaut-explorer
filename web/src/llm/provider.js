// The LLM provider seam: a common interface so the app can swap between
// "the user pastes into their own model" (manualPaste.js) and "the app
// calls a local Ollama server directly" (ollama.js) without either caller
// or the two adapters knowing about each other. This is the seam
// engine/render/llmprompt.js's header always said stayed deferred until
// after the alpha pilot -- this is that seam, opened.
//
// A provider is: { id, label, isAvailable(), complete({system, user,
// schema, signal}) }. complete() returns a Promise resolving to
// {text, json}: `text` is always the model's raw reply (or, for the
// manual-paste provider, the prompt text itself -- see manualPaste.js);
// `json` is populated only when `schema` was supplied AND the reply parsed
// against it, so a caller that asked for structured proposals can tell
// "the model said nothing usable" (json: null) apart from "the model said
// something, just not machine-readable" -- the caller decides what to do
// with either, this layer only reports which one happened.
//
// This module (web/src/llm/) does network I/O, which engine/ may never do
// (see conformance.js's header). It still knows nothing about localStorage
// or the DOM -- that belongs to ui/, one layer further out.

/** True if `candidate` structurally satisfies the Provider interface. */
export function isProvider(candidate) {
  return (
    candidate != null &&
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.isAvailable === 'function' &&
    typeof candidate.complete === 'function'
  );
}
