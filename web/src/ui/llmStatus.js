// Shared "cold start" messaging for every local-LLM call site (guidance.js's
// Ask, describe.js's Draft and Suggest buttons) -- one copy of the plain-
// language explanation and the ticking elapsed-time label, rather than three
// near-identical copies that drift apart.
//
// Why this exists: Ollama loads a model into memory on its first request
// after being idle (or after this app's own tab-close unload -- see
// llm/ollama.js's pagehide handler), and that load can take anywhere from a
// few seconds to roughly a minute depending on the model's size and the
// machine's GPU. Without this, a cold load reads as a frozen "Asking..."
// button with no explanation.

export const COLD_START_HINT =
  "Heads up: if your local model hasn't answered anything recently, it has to load into " +
  'memory first -- that first response can take anywhere from a few seconds to around a ' +
  'minute, depending on the model’s size and your GPU. It then stays warm for as long ' +
  'as this tab stays open.';

/**
 * Starts overwriting `button.textContent` once a second with "`verb`… Ns" so
 * a slow cold-start load reads as "still working" rather than frozen.
 * Returns a stop() function -- callers MUST call it in their `finally` block
 * (same lifetime as the button's disabled flag) or the timer leaks.
 */
export function startElapsedLabel(button, verb) {
  let seconds = 0;
  button.textContent = `${verb}… 0s`;
  const timer = setInterval(() => {
    seconds += 1;
    button.textContent = `${verb}… ${seconds}s`;
  }, 1000);
  return () => clearInterval(timer);
}
