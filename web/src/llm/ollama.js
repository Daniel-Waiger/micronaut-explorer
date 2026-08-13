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

export function createOllamaProvider({
  endpoint,
  model,
  keepAlive = -1,
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
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user || '' },
          ],
        };
        if (schema) {
          body.format = schema;
        }

        const response = await doFetch(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
