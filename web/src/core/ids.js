// Identifier helpers: short ids and UUIDs safe for file:// contexts
// (some browsers restrict crypto.randomUUID() to secure contexts only).

export function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback RFC-4122-ish v4 UUID using Math.random (not cryptographically
  // strong, but sufficient for local, non-secure file:// contexts).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
