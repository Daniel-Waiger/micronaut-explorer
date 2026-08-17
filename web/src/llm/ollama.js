// The Ollama provider: calls a local Ollama server's /api/chat directly,
// requesting constrained decoding via the `format` field whenever a schema
// is supplied (engine/llmschema.js builds those schemas). LAN-only by
// design (see docs/plans/ -- local-llm-guidance): this module never guesses
// an endpoint or reaches beyond what the caller configures.
//
// isAvailable() does NOT make a network call: matching this repo's TOTAL
// discipline for anything network-facing, "available" here means
// "configured" (an endpoint and a model were given), not "reachable" --
// reachability is complete()'s problem alone, surfaced as a rejected
// promise the caller already has to handle (e.g. by falling back to the
// manual-paste provider).
//
// `fetchImpl` is injectable so this module is testable with a stub instead
// of a running server.

const DEFAULT_TIMEOUT_MS = 30000;

// Ollama loads a model at its own native context length (131072 for
// llama3.1:8b) unless told otherwise, which burns VRAM on KV cache far
// beyond what a single study's worth of text ever needs and forces a
// partial CPU/GPU split on cards that would otherwise fit the model
// entirely. 8192 is generous for this app's prompts (a full study plus the
// question bank) while staying small enough to keep even an 8B model
// fully GPU-resident on a 16GB card.
const DEFAULT_NUM_CTX = 8192;

// The most recently used {endpoint, model}, shared across every provider
// instance in this page load (guidance.js and describe.js each mint their
// own via createOllamaProvider). Module-level rather than per-instance so
// the single pagehide listener below can unload whichever model was
// actually warm, regardless of which call site last used it.
let lastUsed = null;

function unloadLastUsed() {
  if (!lastUsed || typeof fetch !== 'function') return;
  const { endpoint, model } = lastUsed;
  // `keepalive: true`, not navigator.sendBeacon: verified directly against a
  // real Ollama server that sendBeacon's actual POST fails with
  // net::ERR_FAILED after a successful CORS preflight (Ollama's CORS
  // middleware and beacon's transport apparently do not get along), while a
  // keepalive fetch carrying the identical body succeeds and does unload the
  // model. keepalive fetch is also allowed to keep running past the page
  // already unloading, same guarantee sendBeacon exists for.
  fetch(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    keepalive: true,
  }).catch(() => {});
}

// Registered once per page load -- this module is an ES module singleton,
// so top-level code here runs exactly once regardless of how many
// createOllamaProvider() calls follow. The point is to dump the model on
// tab close rather than leave it resident until Ollama's own keep-alive
// timeout.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', unloadLastUsed);
}

export function createOllamaProvider({
  endpoint,
  model,
  token,
  keepAlive = -1,
  numCtx = DEFAULT_NUM_CTX,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : undefined);

  return {
    id: 'ollama',
    label: model ? `Local model (${model})` : 'Local model',
    isAvailable: () => Boolean(endpoint) && Boolean(model),

    async complete({ system, user, schema, signal } = {}) {
      if (!endpoint || !model) {
        throw new Error('Ollama provider is not configured (missing endpoint or model).');
      }
      if (!doFetch) {
        throw new Error('No fetch implementation available for the Ollama provider.');
      }
      // Recorded before the request settles: worst case an unload beacon
      // fires for a model that never actually finished loading, which is a
      // harmless no-op, and this is the only point every call path shares.
      lastUsed = { endpoint, model };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // Propagate an external abort (e.g. the user navigating away mid-call)
      // into the same controller that also enforces the timeout, so either
      // reason aborts the same in-flight request rather than needing two
      // independent cancellation paths.
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const body = {
          model,
          stream: false,
          keep_alive: keepAlive,
          options: { num_ctx: numCtx },
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user || '' },
          ],
        };
        if (schema) {
          body.format = schema;
        }

        const headers = { 'Content-Type': 'application/json' };
        // Optional: unset for a bare LAN Ollama box, set when pointed at a
        // gated gateway (the "unit server" preset) that requires a bearer
        // token in front of it -- see the server contract in
        // docs/plans/zen-planner-server-contract.md.
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await doFetch(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const text = data && data.message && typeof data.message.content === 'string' ? data.message.content : '';

        let json = null;
        if (schema && text) {
          try {
            json = JSON.parse(text);
          } catch {
            // A schema was requested but the reply didn't parse as JSON.
            // Surfaced as json: null rather than thrown: a caller that only
            // wanted `text` (the guidance feature) is unaffected, and a
            // caller that needed `json` (the proposal feature) can treat a
            // miss as "nothing usable came back" rather than crash the UI.
            json = null;
          }
        }

        return { text, json };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
