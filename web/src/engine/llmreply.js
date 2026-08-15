// Pulls a JSON object out of whatever a chat LLM actually pasted back.
//
// The Ollama path gets clean JSON because `format` constrains decoding at the
// token level (engine/llmschema.js -> llm/ollama.js). A human pasting a reply
// from ChatGPT/Claude/Gemini has no such guarantee: real replies arrive
// wrapped in ```json fences, prefixed with "Sure! Here's the JSON:", followed
// by "Let me know if you'd like me to adjust anything!", and occasionally
// with curly quotes courtesy of an intermediate rich-text paste. This module
// is the one place that mess is dealt with, so engine/llmproposals.js can go
// on receiving an already-parsed object and stay exactly as strict as it is.
//
// DELIBERATELY NOT A RELAXED JSON PARSER. `{proposals:[...]}` (unquoted keys)
// fails here with a reported issue rather than being accepted. A permissive
// hand-rolled parser is both an attack surface and a silent-corruption risk on
// untrusted input, and the copy-out prompt (engine/render/llmdraftprompt.js)
// exists precisely to stop that case arising. The repairs below are narrow,
// last-resort, gated on the repaired text actually parsing, and every one of
// them is REPORTED rather than applied silently.
//
// Leaf module: imports nothing.

// A paste this big is not a model reply, and step "balanced scan" below is
// O(n * starts) -- the cap is what keeps a pathological paste from hanging
// the tab rather than a guess about how much anyone would legitimately paste.
const MAX_PASTE_CHARS = 1000000;

// How many `{`/`[` positions the balanced scan will try before giving up.
// Prose containing many braces is the case this bounds.
const MAX_CANDIDATE_STARTS = 200;

// Matches engine/llmproposals.js's issue shape exactly, so a caller can render
// issues from both modules through one code path. The codebase only uses
// 'error' and 'fatal'; a repair is NOT an error and goes in `repairs` instead.
function replyIssue(field, message) {
  return { field, message, severity: 'error' };
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

// Edges only, never the interior: a BOM or stray zero-width character from a
// rich-text paste breaks JSON.parse at position 0, but the same characters
// inside a string value are legitimate content we must not touch.
function trimReplyEdges(text) {
  return text.replace(/^[﻿​‌‍\s]+/, '').replace(/[﻿​‌‍\s]+$/, '');
}

// Bodies of ``` fences, with or without a language tag. Tried before the
// free-text scan because prose routinely contains stray braces and a fence is
// a much stronger signal of "the model meant this part as code".
function fencedReplyBodies(text) {
  const bodies = [];
  const fence = /```[^\n`]*\n([\s\S]*?)```/g;
  let match = fence.exec(text);
  while (match !== null) {
    bodies.push(match[1]);
    match = fence.exec(text);
  }
  return bodies;
}

/**
 * The slice from `startIndex` to its matching close, or null if unbalanced.
 *
 * String-literal and escape aware, which is the entire point: a naive
 * "find the last }" truncates `{"value":"n=3 }} weird"}` at the wrong place,
 * and a naive depth counter that ignores \" mis-tracks `{"value":"the \" mark"}`.
 * Only the delimiter that opened the slice is counted, so a `]` inside an
 * object cannot close it.
 */
function scanBalancedSlice(text, startIndex) {
  const open = text[startIndex];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

// Every balanced {...} / [...] slice in the text, outermost-first by position.
// `truncated` reports that the start cap was hit, so the caller can say "gave
// up looking" instead of silently reporting "no JSON found".
function balancedReplyCandidates(text) {
  const slices = [];
  let starts = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    starts += 1;
    if (starts > MAX_CANDIDATE_STARTS) return { slices, truncated: true };
    const slice = scanBalancedSlice(text, i);
    if (slice !== null) {
      slices.push(slice);
      // Skip past this slice: its interior braces are part of a candidate we
      // already captured, and re-scanning them is what would make this
      // quadratic on deeply nested input.
      i += slice.length - 1;
    }
  }
  return { slices, truncated: false };
}

// Curly DOUBLE quotes only. Curly SINGLE quotes are deliberately left alone:
// an apostrophe inside a string value ("doesn't") is perfectly valid JSON, so
// "fixing" it would corrupt content to solve a problem that does not exist.
function repairCurlyQuotes(text) {
  return text.replace(/[“”]/g, '"');
}

// A comma directly before } or ] -- the single most common hand-edit and
// small-model mistake. String-aware, so a comma inside "a, b" survives.
function repairTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString && ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '}' || text[j] === ']') continue; // drop the comma
    }
    out += ch;
  }
  return out;
}

/**
 * Pick the best parsed candidate.
 *
 * Order is deliberate. An object carrying `requireKey` beats everything --
 * that is the reply we asked for. A bare array beats a keyless object next,
 * because "the model returned just the array" is a common and recoverable
 * mistake while a stray `{}` in prose is noise that would otherwise win by
 * position alone.
 */
function chooseReplyCandidate(values, requireKey) {
  if (requireKey) {
    const keyed = values.find((v) => isJsonObject(v) && Object.prototype.hasOwnProperty.call(v, requireKey));
    if (keyed) return { value: keyed, wrapped: false };

    const array = values.find((v) => Array.isArray(v));
    if (array) return { value: { [requireKey]: array }, wrapped: true };
  }
  const object = values.find(isJsonObject);
  if (object) return { value: object, wrapped: false };
  return null;
}

// All parseable candidates from one body of text, in priority order:
// the whole thing, then fenced blocks, then balanced slices.
function collectReplyCandidates(text) {
  const values = [];
  const whole = tryParseJson(text);
  if (whole.ok) values.push(whole.value);

  for (const body of fencedReplyBodies(text)) {
    const parsed = tryParseJson(trimReplyEdges(body));
    if (parsed.ok) values.push(parsed.value);
  }

  const { slices, truncated } = balancedReplyCandidates(text);
  for (const slice of slices) {
    const parsed = tryParseJson(slice);
    if (parsed.ok) values.push(parsed.value);
  }
  return { values, truncated };
}

/**
 * Extract a JSON object from a pasted model reply.
 *
 * `requireKey` (e.g. 'proposals') is a PREFERENCE, not a filter: a reply that
 * parses but lacks the key is still returned, so the caller can report
 * "that JSON has no proposals" rather than the much less useful "no JSON
 * found". Callers must therefore still validate the shape -- which
 * engine/llmproposals.js does anyway.
 *
 * Returns {json, issues, repairs}:
 * - json: a plain object, or null when nothing usable was found.
 * - issues: [{field, message, severity}] -- llmproposals.js's shape.
 * - repairs: plain strings describing anything this module changed to make
 *   the paste parse. Never silent: if we touched it, we say so.
 *
 * TOTAL: never throws, for any input including non-strings.
 */
export function extractJsonReply(text, { requireKey = null } = {}) {
  const issues = [];
  const repairs = [];

  if (typeof text !== 'string') {
    return { json: null, issues: [replyIssue('reply', 'nothing was pasted')], repairs };
  }
  if (text.length > MAX_PASTE_CHARS) {
    return {
      json: null,
      issues: [replyIssue('reply', `that paste is too large to scan (over ${MAX_PASTE_CHARS} characters)`)],
      repairs,
    };
  }

  const cleaned = trimReplyEdges(text);
  if (!cleaned) {
    return { json: null, issues: [replyIssue('reply', 'nothing was pasted')], repairs };
  }

  const first = collectReplyCandidates(cleaned);
  const picked = chooseReplyCandidate(first.values, requireKey);
  if (picked) {
    if (picked.wrapped) repairs.push(`wrapped a bare list as {"${requireKey}": [...]}`);
    return { json: picked.value, issues, repairs };
  }

  // Last resort only -- reached exclusively when every strict attempt above
  // failed, so a repair can never corrupt a reply that was already valid.
  // Each pass is kept only if it actually yields something usable.
  const passes = [
    { label: 'converted curly quotes to straight quotes', apply: repairCurlyQuotes },
    { label: 'removed a trailing comma', apply: repairTrailingCommas },
  ];
  let repaired = cleaned;
  for (const pass of passes) {
    const next = pass.apply(repaired);
    if (next === repaired) continue;
    const attempt = collectReplyCandidates(next);
    const choice = chooseReplyCandidate(attempt.values, requireKey);
    repaired = next;
    if (choice) {
      repairs.push(pass.label);
      if (choice.wrapped) repairs.push(`wrapped a bare list as {"${requireKey}": [...]}`);
      return { json: choice.value, issues, repairs };
    }
  }

  issues.push(
    replyIssue(
      'reply',
      first.truncated
        ? 'gave up looking for JSON in that paste -- too many candidate blocks'
        : "couldn't find a JSON object in that paste"
    )
  );
  return { json: null, issues, repairs };
}
