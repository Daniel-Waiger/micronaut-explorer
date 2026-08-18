// Local Ollama server detection: a lightweight probe distinct from
// ollama.js's complete() call path. Hits GET /api/tags (no body, no study
// data ever leaves the machine) to answer "is a local Ollama server up, and
// what models does it have loaded" so a caller can pre-populate a model
// picker before the user commits to a provider.
//
// TOTAL discipline matches ollama.js: this function NEVER throws or rejects
// for network reasons -- every failure mode (missing config, network error,
// non-ok response, timeout/abort, malformed JSON) degrades to
// { available: false, models: [] } so a caller can await it unconditionally.
//
// `fetchImpl` is injectable so this module is testable with a stub instead
// of a running server (see web/tests/detect.test.js).

const DETECT_DEFAULT_TIMEOUT_MS = 2000;

export async function detectOllama({ endpoint, fetchImpl, timeoutMs = DETECT_DEFAULT_TIMEOUT_MS } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : undefined);

  if (!endpoint || !doFetch) {
    return { available: false, models: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      return { available: false, models: [] };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { available: false, models: [] };
    }

    const rawModels = data && Array.isArray(data.models) ? data.models : [];
    const names = rawModels
      .map((m) => (m && typeof m.name === 'string' ? m.name : null))
      .filter((name) => Boolean(name));
    const uniqueSorted = Array.from(new Set(names)).sort();

    return { available: true, models: uniqueSorted };
  } catch {
    // Network error, abort/timeout, or any other rejection from doFetch.
    return { available: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}
