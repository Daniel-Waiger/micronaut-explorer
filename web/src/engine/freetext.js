// Deterministic free-text ingest: scan a pasted paragraph for markers,
// replicate counts, magnification, and an ISO date -- with the LLM off.
// See docs/plans/planner-web-p1-task-graph.json, task C1-4.
//
// Every proposal is tagged 'freetext' (WEAK). This module NEVER writes to
// the store -- C0-2's canOverwrite then structurally guarantees a re-parse
// can never clobber a value the user actually typed.
//
// Leaf module: import nothing (the KB `index` is passed in, from C1-1's
// indexKb, rather than read from a global here).

const REPLICATE_PATTERNS = [
  { re: /\bn\s*=\s*(\d+)\b/i, value: (m) => Number(m[1]) },
  { re: /\b(\d+)\s*replicates?\b/i, value: (m) => Number(m[1]) },
  { re: /\btriplicate\b/i, value: () => 3 },
  { re: /\bduplicate\b/i, value: () => 2 },
];

// Keyword-anchored first (most specific -- "Magnification: 63" is safe even
// next to unrelated numbers), then unit-anchored on a trailing x ("63x",
// "63 X" -- mirrors field_map.py's _MAGNIFICATION_UNIT, which anchors on the
// unit rather than "the first digit run anywhere" for exactly this reason),
// then unit-anchored on a leading x ("x63", "X 63" -- mirrors
// metadata.py's _extract_magnification allow_bare_x form). Trying all three
// is what makes '63x'/'63X'/'x63' normalize identically, per this task's
// spec.
const MAGNIFICATION_KEYWORD_RE = /(?:MAGNIFICATION|OBJECTIVE|ZOOM)[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)/i;
const MAGNIFICATION_TRAILING_X_RE = /\b(\d{1,3}(?:\.\d+)?)\s?[xX]\b/;
const MAGNIFICATION_LEADING_X_RE = /\b[xX]\s?(\d{1,3}(?:\.\d+)?)\b/;

// The trailing-x form ("63x") is a deliberate EXTENSION beyond metadata.py's
// own prose path, which never enables the bare-x forms outside a filename
// stem (allow_bare_x=False by default) -- its own comment explains why:
// "dimension strings like '512 x 512' would be misread as a magnification".
// Allowing '63x' in free-flowing prose (this task's own spec) reopens
// exactly that hole, so a trailing-x match immediately followed by ANOTHER
// number ("512 x 512", "100x100") is rejected as a dimension pair rather
// than a magnification. A genuine magnification mention is never
// immediately followed by a second number.
function isDimensionPair(text, matchEndIndex) {
  return /^\s*\d/.test(text.slice(matchEndIndex));
}

// Mirror check for the leading-x form: in "512 x 512", rejecting the
// trailing-x half ("512 x") as a dimension pair still leaves the SECOND
// half ("x 512") matchable by the leading-x pattern on its own -- so that
// match must equally be rejected when it is immediately preceded by another
// number.
function isPrecededByNumber(text, matchStartIndex) {
  return /\d\s*$/.test(text.slice(0, matchStartIndex));
}

// ISO form only (YYYY-MM-DD). Deliberately does NOT attempt ambiguous
// formats like '03/04/2026', whose meaning (day-first vs month-first)
// differs by locale -- guessing wrong would silently mislabel data, which
// is worse than not proposing a date at all.
const ISO_DATE_RE = /\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;

function freeTextProposal(path, value, match, extra) {
  return {
    path,
    value,
    tag: 'freetext',
    evidence: match[0],
    index: match.index,
    confidence: 0.7,
    ...extra,
  };
}

function proposeReplicates(text) {
  for (const { re, value } of REPLICATE_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      // 'n=3' / 'triplicate' / 'X replicates' in a methods paragraph mean
      // BIOLOGICAL replicates by convention -- schema v2 split the old
      // single design.replicates into biologicalReplicates/technicalReplicates
      // (this path is the schema's real field; writing to the old
      // 'design.replicates' would silently propose into a slot that no
      // longer exists anywhere the store or the UI reads from).
      return freeTextProposal('design.biologicalReplicates', value(match), match);
    }
  }
  return null;
}

function proposeMagnification(text) {
  const keywordMatch = MAGNIFICATION_KEYWORD_RE.exec(text);
  if (keywordMatch) {
    const number = Number.parseFloat(keywordMatch[1]);
    if (Number.isFinite(number) && number > 0) {
      return freeTextProposal('naming.fields.magnification', `X${Math.trunc(number)}`, keywordMatch);
    }
  }

  const trailingMatch = MAGNIFICATION_TRAILING_X_RE.exec(text);
  if (trailingMatch && !isDimensionPair(text, trailingMatch.index + trailingMatch[0].length)) {
    const number = Number.parseFloat(trailingMatch[1]);
    if (Number.isFinite(number) && number > 0) {
      return freeTextProposal('naming.fields.magnification', `X${Math.trunc(number)}`, trailingMatch);
    }
  }

  const leadingMatch = MAGNIFICATION_LEADING_X_RE.exec(text);
  if (leadingMatch && !isPrecededByNumber(text, leadingMatch.index)) {
    const number = Number.parseFloat(leadingMatch[1]);
    if (Number.isFinite(number) && number > 0) {
      return freeTextProposal('naming.fields.magnification', `X${Math.trunc(number)}`, leadingMatch);
    }
  }

  return null;
}

function proposeDate(text) {
  const match = ISO_DATE_RE.exec(text);
  if (!match) return null;
  return freeTextProposal('naming.fields.date', match[0], match);
}

/**
 * Longest-match-wins, non-overlapping alias scan over `text`, using ONLY
 * `freeTextAliasToCanonical` -- never `aliasToCanonical` -- because C1-1's
 * exporter has already stripped every alias in `ambiguousInFreeText`
 * ("snap", "halo", "clip", "venus", "citrine", "emerald", "cerulean",
 * "tomato": real marker spellings that are ALSO common English words) out
 * of `freeTextAliases`. Scanning the wrong map here would defeat the entire
 * point of that exclusion list.
 *
 * Faithful port of metadata.py::_extract_markers's overlap resolution:
 * every whole-word occurrence of every alias is found (finditer, not
 * search -- B2/B3's fix, since one-match-per-alias silently drops a real
 * second occurrence of the SAME alias later in the text), candidates are
 * sorted by (start, -length) so a longer alias is considered first at a
 * shared start position, and a candidate is kept only if its span does not
 * overlap an already-accepted span. This is what makes 'ATTO 647-N' resolve
 * to ATTO647N rather than ATTO647 plus a dangling N.
 */
function scanMarkers(text, freeTextAliasToCanonical) {
  const candidates = [];
  for (const [alias, canonical] of freeTextAliasToCanonical.entries()) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      candidates.push({ start: match.index, end: match.index + match[0].length, canonical, evidence: match[0] });
      // A zero-length alias can't happen (aliases are non-empty strings),
      // so no lastIndex nudge is needed to avoid an infinite loop here.
    }
  }

  candidates.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - b.start - (a.end - a.start)));

  const accepted = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some((a) => candidate.start < a.end && candidate.end > a.start);
    if (!overlaps) accepted.push(candidate);
  }

  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function proposeMarkers(text, index) {
  const freeTextAliasToCanonical = index && index.freeTextAliasToCanonical instanceof Map
    ? index.freeTextAliasToCanonical
    : new Map();
  const accepted = scanMarkers(text, freeTextAliasToCanonical);
  if (accepted.length === 0) return null;

  const seen = new Set();
  const canonicalsInOrder = [];
  const matches = [];
  for (const hit of accepted) {
    matches.push({ canonical: hit.canonical, evidence: hit.evidence, index: hit.start });
    if (!seen.has(hit.canonical)) {
      seen.add(hit.canonical);
      canonicalsInOrder.push(hit.canonical);
    }
  }

  const first = accepted[0];
  return {
    path: 'naming.fields.markers',
    value: canonicalsInOrder.join('-'),
    tag: 'freetext',
    evidence: first.evidence,
    index: first.start,
    confidence: 0.7,
    matches,
  };
}

/**
 * Parse `text` and return { proposals, unmatched }. `index` is C1-1's
 * indexKb(...) output. TOTAL with respect to malformed input: an
 * empty/non-string text or a missing/malformed index simply yields no
 * proposals, never a throw.
 *
 * NEVER writes to any store -- returns proposals only.
 */
export function parseFreeText(text, index) {
  const safeText = typeof text === 'string' ? text : '';
  const proposals = [];
  const unmatched = [];

  const markers = proposeMarkers(safeText, index);
  if (markers) proposals.push(markers);
  else unmatched.push('markers');

  const replicates = proposeReplicates(safeText);
  if (replicates) proposals.push(replicates);
  else unmatched.push('replicates');

  const magnification = proposeMagnification(safeText);
  if (magnification) proposals.push(magnification);
  else unmatched.push('magnification');

  const date = proposeDate(safeText);
  if (date) proposals.push(date);
  else unmatched.push('date');

  proposals.sort((a, b) => a.index - b.index);
  return { proposals, unmatched };
}
