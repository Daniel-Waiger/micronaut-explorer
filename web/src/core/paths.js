// Dot/bracket JSON-path utilities for the Experiment data model.
// Path syntax: 'a.b[0].c' addresses object keys and array indices.
// listPaths() additionally supports a '[*]' fan-out segment that expands to
// one concrete path per element of the array found at that position.

const TOKEN_RE = /[^.[\]]+|\[\d+\]|\[\*\]/g;

// A key token matching one of these would let setPath climb out of the
// target object onto Object.prototype itself (e.g. setPath({}, '__proto__.x',
// 1) or setPath({}, 'constructor.prototype.x', 1)) -- since every plain
// object shares one prototype, that one write corrupts every object in the
// running app, not just the object passed in. Reject these unconditionally;
// no legitimate Experiment field is named any of them.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function tokenize(path) {
  const tokens = [];
  const matches = path.match(TOKEN_RE) || [];
  for (const raw of matches) {
    if (raw === '[*]') {
      tokens.push({ kind: 'wildcard' });
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      tokens.push({ kind: 'index', value: Number(raw.slice(1, -1)) });
    } else {
      if (DANGEROUS_KEYS.has(raw)) {
        throw new Error(`unsafe path segment '${raw}' in '${path}'`);
      }
      tokens.push({ kind: 'key', value: raw });
    }
  }
  return tokens;
}

export function getPath(obj, path) {
  const tokens = tokenize(path);
  let current = obj;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    if (token.kind === 'key') {
      current = current[token.value];
    } else if (token.kind === 'index') {
      current = current[token.value];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setPath(obj, path, value) {
  const tokens = tokenize(path);
  if (tokens.length === 0) return obj;
  let current = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    const key = token.value;
    if (current[key] === undefined || current[key] === null) {
      current[key] = next.kind === 'index' ? [] : {};
    }
    current = current[key];
  }
  const last = tokens[tokens.length - 1];
  current[last.value] = value;
  return obj;
}

export function listPaths(obj, path) {
  const tokens = tokenize(path);

  function expand(current, prefix, remaining) {
    if (remaining.length === 0) {
      return [prefix];
    }
    const [token, ...rest] = remaining;
    if (token.kind === 'key') {
      const nextPrefix = prefix === '' ? token.value : `${prefix}.${token.value}`;
      const nextValue = current === undefined || current === null ? undefined : current[token.value];
      return expand(nextValue, nextPrefix, rest);
    }
    if (token.kind === 'index') {
      const nextPrefix = `${prefix}[${token.value}]`;
      const nextValue = current === undefined || current === null ? undefined : current[token.value];
      return expand(nextValue, nextPrefix, rest);
    }
    // wildcard
    if (!Array.isArray(current)) return [];
    const results = [];
    for (let i = 0; i < current.length; i++) {
      const nextPrefix = `${prefix}[${i}]`;
      results.push(...expand(current[i], nextPrefix, rest));
    }
    return results;
  }

  return expand(obj, '', tokens);
}
