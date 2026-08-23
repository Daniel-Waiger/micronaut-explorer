// Environment-only gate for local endpoint calls. This deliberately says
// nothing about whether an Ollama endpoint is configured or reachable; callers
// must use detection/request results for that. It also performs no I/O.

function safelyRead(value, property) {
  try {
    return value == null ? undefined : value[property];
  } catch {
    return undefined;
  }
}

/**
 * Whether this runtime can attempt a local model endpoint call.
 *
 * `runtime` is injectable for non-DOM callers and tests. Missing globals are
 * intentionally permissive: only a file origin or an explicit offline signal
 * proves that an endpoint call cannot work.
 */
export function localEndpointCallsAvailable(runtime = globalThis) {
  try {
    const location = safelyRead(runtime, 'location');
    const navigator = safelyRead(runtime, 'navigator');
    const protocol = safelyRead(location, 'protocol');
    const onLine = safelyRead(navigator, 'onLine');

    return protocol !== 'file:' && onLine !== false;
  } catch {
    // This is an availability hint, so an exotic/unreadable runtime degrades
    // safely instead of preventing the surrounding UI from rendering.
    return false;
  }
}
