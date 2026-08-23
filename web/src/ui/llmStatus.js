// Shared "cold start" messaging for Project review's local-model request --
// one copy of the plain-language explanation and ticking elapsed-time label.
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
 * Starts overwriting the supplied element's `textContent` once a second with "`verb`… Ns" so
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

/**
 * Shows honest, time-based narration while a local model request is in
 * flight. The progress bar remains indeterminate because Ollama does not
 * expose a meaningful completion percentage for a generation request.
 */
export function startModelProgress(elapsedHost, activityHost, modelLabel) {
  const label = modelLabel || 'the local model';
  const startedAt = Date.now();

  function render() {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    elapsedHost.textContent = `Local model running… ${seconds}s`;
    if (seconds < 2) activityHost.textContent = `Sending the description to ${label}…`;
    else if (seconds < 10) activityHost.textContent = `Waiting for ${label} to interpret the description…`;
    else if (seconds < 30) activityHost.textContent = `Still waiting for ${label} to return evidence-backed suggestions…`;
    else activityHost.textContent = `${label} is still working. A first response can take about a minute while the model loads…`;
  }

  render();
  const timer = setInterval(render, 1000);
  return () => clearInterval(timer);
}
