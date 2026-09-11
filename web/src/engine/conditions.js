// Condition matrix: groups x factors x replicates -> concrete condition rows
// -> group labels. Pure module: no DOM, no store, no globals.
//
// TWO KINDS OF AXIS, and the difference is the whole point of this module:
//
//   design.groups.levels -- the GROUP axis. Mutually exclusive alternatives
//     (CT | NAM25MM | NAM50MM). A sample is exactly ONE of these. Singular by
//     construction, so it can never be crossed with itself.
//   design.factors[]     -- genuinely CROSSING axes (genotype, timepoint).
//     A sample really is both WT *and* 24h, so these do form a product.
//
// Groups DO cross with factors (WT/KO x CT/drug is a legitimate 2x2); they just
// never cross with each other. Expressing groups as two factors is what produced
// the nonsense 'CT-NAM50MM' -- a file that was somehow both the control and the
// 50 mM group. Keeping the group axis singular makes that unrepresentable rather
// than merely discouraged.
//
// ROW ORDER IS A CONTRACT. Downstream filename generation depends on the exact
// sequence produced by expandConditions: group outermost (slowest-varying), then
// factors in declared order, then biological replicate, then technical
// replicate innermost (fastest-varying). Reordering this for "nicer" iteration
// silently reshuffles every filename downstream.

import { sanitizeToken } from './naming.js';

// Each replicate axis renders as a prefixed, zero-padded token (B01, T03).
// The prefix is what keeps the name parseable once tokens become optional:
// without it, '..._NAM50MM_E02_03' gives no way to tell which axis '03' is.
const REPLICATE_PAD = 2;
const MAX_PADDED_REPLICATE = 99; // 2 digits; see conditionIssues

// Refuse to materialize a cartesian product larger than this. A fat-fingered
// design (an extra factor, a huge replicate count) must fail fast with a
// visible issue rather than hang the browser building millions of rows.
const MAX_CONDITION_ROWS = 1000;

// Group segments are sanitized with the same safe-char policy naming.js's own
// filename tokens use by default. Exported so tests can build the identical
// sanitizeToken config rather than re-deriving/copying this string.
//
// Despite the name (kept for backward compatibility -- tests and design.js
// already reference it), this is used for the {group} template token and the
// "Group naming override" scheme, NOT for naming.fields.sample, which is a
// plain user-typed specimen id with its own validation (see naming.js's
// DEFAULT_PROFILE.samplePattern).
export const SAMPLE_ID_SAFE_CHAR_PATTERN = '[^A-Za-z0-9_-]+';

const TEMPLATE_TOKEN_RE = /\{([^{}]+)\}/g;

function factorsOf(design) {
  return design && Array.isArray(design.factors) ? design.factors : [];
}

function levelsOf(factor) {
  return factor && Array.isArray(factor.levels) ? factor.levels : [];
}

function groupLevelsOf(design) {
  const groups = design && design.groups;
  return groups && Array.isArray(groups.levels) ? groups.levels : [];
}

/**
 * Resolve a raw replicate count (design.biologicalReplicates /
 * .technicalReplicates) to the count used for expansion.
 *
 * Unlike the old single `replicates` field, an explicit null/undefined here
 * means the axis is OMITTED, not "default to 1" -- not every experiment has
 * technical replicates, and some (SEM/TEM/Raman) may have neither axis at
 * all. Returns null for "omit this axis" and a positive integer count
 * otherwise; conditionIssues separately flags an explicit invalid value
 * (0, negative, non-integer) rather than silently coercing it.
 */
function effectiveReplicateCount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  return 1; // an explicit-but-invalid value still expands (as 1 row); flagged separately
}

/**
 * Total row count a design would expand to, without building any rows.
 *
 * `{ includeTechnicalReplicates }` (default true) controls whether the
 * technical-replicate axis is folded into the total. A technical replicate is
 * a repeat MEASUREMENT of the same physical sample (web/kb/questions.json's
 * timing/technicalReplicates question), not a second physical specimen -- so
 * counting it multiplies FILES/acquisition runs, not physical samples. See
 * physicalSampleCount below for the samples-only total.
 */
function plannedRowCount(design, { includeTechnicalReplicates = true } = {}) {
  const factors = factorsOf(design);
  const groupLevels = groupLevelsOf(design);
  let total = Math.max(groupLevels.length, 1); // 0 group levels -> a design with no groups defined yet
  for (const factor of factors) {
    total *= levelsOf(factor).length;
  }
  total *= effectiveReplicateCount(design && design.biologicalReplicates) ?? 1;
  if (includeTechnicalReplicates) {
    total *= effectiveReplicateCount(design && design.technicalReplicates) ?? 1;
  }
  return total;
}

/**
 * Total PHYSICAL SAMPLE count a design implies: groups x factors x
 * biological replicates, deliberately EXCLUDING the technical-replicate axis.
 * A technical replicate is a repeat measurement of the same physical sample,
 * not a second one -- so this is the count a bench operation that touches
 * the physical specimen (e.g. mounting a slide) should scale by, as opposed
 * to `planFilenames(...).length` / plannedRowCount's full row count, which
 * also counts repeat acquisitions of that same sample.
 *
 * Total on malformed/absent design input, like its sibling plannedRowCount:
 * never throws, degrades via the same factorsOf/groupLevelsOf/
 * effectiveReplicateCount guards.
 */
export function physicalSampleCount(design) {
  return plannedRowCount(design, { includeTechnicalReplicates: false });
}

/** Extract the `{token}` names referenced by a template string, in order. */
function templateTokens(template) {
  const tokens = [];
  String(template).replace(TEMPLATE_TOKEN_RE, (match, token) => {
    tokens.push(token);
    return match;
  });
  return tokens;
}

/**
 * Expand a design into concrete condition rows. See the module header for
 * the two-kinds-of-axis distinction and the row-order contract.
 *
 * Guardrails (never throws):
 *  - no group levels defined -> the group axis is simply omitted (group: null),
 *    same as zero factors -> one unconditioned sample.
 *  - zero factors -> the group axis (if any) still expands on its own.
 *  - any factor with zero levels -> the product is mathematically zero, so
 *    this returns [] (conditionIssues separately reports why).
 *  - a design whose planned size exceeds MAX_CONDITION_ROWS returns []
 *    WITHOUT attempting the expansion (conditionIssues reports the cap).
 */
export function expandConditions(design) {
  const total = plannedRowCount(design);
  if (total === 0 || total > MAX_CONDITION_ROWS) {
    return [];
  }

  const groupLevels = groupLevelsOf(design);
  const factors = factorsOf(design);
  const bioCount = effectiveReplicateCount(design && design.biologicalReplicates);
  const techCount = effectiveReplicateCount(design && design.technicalReplicates);

  // Group is OUTERMOST and, critically, its own single axis -- never crossed
  // with itself the way two `factors` entries would be. An empty group axis
  // (no groups in use) is one pass with group: null, mirroring "zero factors"
  // below.
  let combos = (groupLevels.length > 0 ? groupLevels : [null]).map((group) => ({
    group,
    factorLevels: {},
  }));

  for (const factor of factors) {
    const name = factor && factor.name;
    const levels = levelsOf(factor);
    const next = [];
    for (const combo of combos) {
      for (const level of levels) {
        next.push({ ...combo, factorLevels: { ...combo.factorLevels, [name]: level } });
      }
    }
    combos = next;
  }

  const rows = [];
  for (const combo of combos) {
    // bioCount/techCount null -> that axis is omitted: one pass with rep null,
    // not a loop of 1..1, so the row never carries a fabricated '1'.
    const bioValues = bioCount === null ? [null] : range(1, bioCount);
    const techValues = techCount === null ? [null] : range(1, techCount);
    for (const bioRep of bioValues) {
      for (const techRep of techValues) {
        rows.push({
          id: rows.length,
          group: combo.group,
          factorLevels: combo.factorLevels,
          bioRep,
          techRep,
        });
      }
    }
  }
  return rows;
}

function range(start, end) {
  const out = [];
  for (let i = start; i <= end; i += 1) out.push(i);
  return out;
}

function makeConditionIssue(field, message, severity = 'error') {
  return { field, message, severity };
}

/**
 * Validate a design and report every problem as a {field, message, severity}
 * issue -- the same shape engine/validation.js validationIssue uses, so the
 * UI can render design problems and naming problems through one list.
 *
 * This never throws; a malformed design (missing arrays, non-object
 * factors, etc.) degrades to "as many issues as can be determined", not a
 * crash.
 */
// Token names reserved by the engine itself (the group axis and the two
// replicate axes). A factor sharing one of these names would silently shadow
// (or be shadowed by) the reserved value when a custom id scheme or the
// uniqueness check renders it -- see buildSampleId's fields map below.
const RESERVED_TOKEN_NAMES = new Set(['group', 'biorep', 'techrep']);

function isUsableLevel(level) {
  return (
    (typeof level === 'string' && level.length > 0) ||
    (typeof level === 'number' && Number.isFinite(level))
  );
}

/** Validate one replicate axis (biological or technical). Never throws. */
function replicateIssues(field, rawValue) {
  if (rawValue === null || rawValue === undefined) return []; // omitted axis: legal
  const issues = [];
  const isValid = typeof rawValue === 'number' && Number.isInteger(rawValue) && rawValue >= 1;
  if (!isValid) {
    issues.push(
      makeConditionIssue(field, `Must be a positive integer; got ${JSON.stringify(rawValue)}.`)
    );
  } else if (rawValue > MAX_PADDED_REPLICATE) {
    issues.push(
      makeConditionIssue(
        field,
        `${rawValue} exceeds the ${MAX_PADDED_REPLICATE}-replicate cap for a ${REPLICATE_PAD}-digit token.`
      )
    );
  }
  return issues;
}

export function conditionIssues(design) {
  const issues = [];
  const factors = factorsOf(design);
  const groupLevels = groupLevelsOf(design);

  const seenNames = new Set();
  const flaggedDuplicates = new Set();
  for (const factor of factors) {
    const name = factor && factor.name;
    if (seenNames.has(name)) {
      if (!flaggedDuplicates.has(name)) {
        issues.push(makeConditionIssue('factors', `Duplicate factor name '${name}'.`));
        flaggedDuplicates.add(name);
      }
    } else {
      seenNames.add(name);
    }
    if (RESERVED_TOKEN_NAMES.has(name)) {
      issues.push(
        makeConditionIssue(
          'factors',
          `Factor cannot be named '${name}' -- that name is reserved by the engine.`
        )
      );
    }
  }

  for (const factor of factors) {
    const name = factor && factor.name;
    const levels = levelsOf(factor);
    if (levels.length === 0) {
      issues.push(makeConditionIssue('factors', `Factor '${name}' has zero levels.`));
      continue;
    }
    // A level that isn't a genuine non-empty value can't be substituted into
    // an id-scheme token: buildSampleId would throw "Unknown token" for it
    // (see its `fields[token] === undefined` check), which is a misleading
    // message for "the token IS known, its value just isn't usable" -- and
    // conditionIssues is supposed to be the thing that catches this BEFORE
    // buildSampleId ever runs, not just for genuinely unknown tokens.
    levels.forEach((level, index) => {
      if (!isUsableLevel(level)) {
        issues.push(
          makeConditionIssue(
            'factors',
            `Factor '${name}' has an invalid level at position ${index} (must be a non-empty value).`
          )
        );
      }
    });
  }

  // Group levels get the same non-empty-value check factor levels do, but NOT
  // the zero-levels check: an empty groups.levels means "this design has no
  // groups", which is legal (mirrors zero factors), not an authoring mistake.
  groupLevels.forEach((level, index) => {
    if (!isUsableLevel(level)) {
      issues.push(
        makeConditionIssue('groups', `Group has an invalid level at position ${index} (must be a non-empty value).`)
      );
    }
  });

  issues.push(...replicateIssues('biologicalReplicates', design && design.biologicalReplicates));
  issues.push(...replicateIssues('technicalReplicates', design && design.technicalReplicates));

  const total = plannedRowCount(design);
  if (total > MAX_CONDITION_ROWS) {
    issues.push(
      makeConditionIssue(
        'factors',
        `Design expands to ${total} rows, exceeding the cap of ${MAX_CONDITION_ROWS}.`
      )
    );
  }

  const idScheme = design && design.idScheme;
  if (idScheme) {
    // A reserved token is "known" for scheme validation ONLY when its axis is
    // actually in use on this design -- mirroring how a factor name is only
    // known if it exists in design.factors. Without this gate, a scheme
    // referencing {biorep} on a design with no technical replicates would
    // pass static validation here and then throw "Unknown token" at render
    // time on every single row, which is a confusing way to fail.
    const knownTokens = new Set(factors.map((factor) => factor && factor.name));
    if (groupLevels.length > 0) knownTokens.add('group');
    if (design && design.biologicalReplicates !== null && design.biologicalReplicates !== undefined) {
      knownTokens.add('biorep');
    }
    if (design && design.technicalReplicates !== null && design.technicalReplicates !== undefined) {
      knownTokens.add('techrep');
    }
    for (const token of templateTokens(idScheme)) {
      if (!knownTokens.has(token)) {
        issues.push(makeConditionIssue('idScheme', `Unknown token '{${token}}' in id scheme.`));
      }
    }
  }

  // Filename-uniqueness gate: nothing in this engine checked this before.
  // Within one design, the base name (date/modality/exptype/markers/
  // magnification) and SAMPLE are constant across every row -- ONLY the group
  // label + replicate tokens vary -- so checking that triple for collisions
  // is sufficient to guarantee every row's filename is distinct.
  if (total > 0 && total <= MAX_CONDITION_ROWS) {
    const seenKeys = new Map();
    const flaggedKeys = new Set();
    for (const row of expandConditions(design)) {
      let label;
      try {
        label = idScheme ? buildSampleId(row, idScheme) : buildGroupLabel(row, design);
      } catch {
        continue; // a bad scheme is already reported above; do not double-report here
      }
      const key = [
        label,
        formatReplicateToken('B', row.bioRep),
        formatReplicateToken('T', row.techRep),
      ].join('|');
      if (seenKeys.has(key) && !flaggedKeys.has(key)) {
        issues.push(
          makeConditionIssue(
            'factors',
            `Multiple condition rows produce the identical name segment '${key.replace(/\|/g, '')}' -- they would overwrite each other.`
          )
        );
        flaggedKeys.add(key);
      }
      seenKeys.set(key, row.id);
    }
  }

  return issues;
}

// Separator BETWEEN group segments. Deliberately '-', not '_': '_' already
// separates TEMPLATE FIELDS in a filename, so joining group segments with it
// too would erase the boundary between "where the fields end" and "where the
// group description begins". '-' is the existing within-a-field convention
// (markers already render as DAPI-GFP-PHALLOIDIN) and is in the safe-char set.
export const GROUP_SEGMENT_SEPARATOR = '-';

/**
 * Render one replicate axis as its prefixed, zero-padded token (B01, T03), or
 * '' if the axis is omitted (value null/undefined). The prefix is what keeps
 * the name parseable now that BOTH replicate axes are optional and share the
 * same {biorep}/{techrep} template slots -- without it, a bare '03' gives no
 * way to tell which axis it belongs to once the other is omitted.
 */
export function formatReplicateToken(prefix, value) {
  if (value === null || value === undefined) return '';
  return `${prefix}${String(value).padStart(REPLICATE_PAD, '0')}`;
}

/**
 * Split a condition row into its ordered GROUP SEGMENTS: the row's primary GROUP
 * level (if this design uses one), followed by one segment per CROSSING
 * factor in the design's declared order.
 *
 * This is stage 2 of the two-stage name. Stage 1 (the base name) says what the
 * whole experiment is and is identical for every file; these segments say
 * which group x factor combination this particular file belongs to.
 *
 * Each segment is sanitized INDIVIDUALLY and returned as its own array
 * element. That is the whole point: joining unsanitized "CT" and "NAM 50mM"
 * with no separator produced 'CTNAM50MM', where the boundary between the
 * control group and the treatment group is simply gone. Segments cannot merge,
 * because the separator is applied by the joiner AFTER each part has been
 * sanitized on its own -- and because the group is a SINGLE value (design.groups
 * is singular, not a second factors[] entry), there is exactly one primary group
 * segment per row, never two group segments crossed against each other.
 *
 * Replicate numbers are NOT included here -- they render through their own
 * {biorep}/{techrep} template tokens (see formatReplicateToken), not as part
 * of the group label.
 */
export function buildGroupSegments(row, design) {
  const sanitizeConfig = { safeCharPattern: SAMPLE_ID_SAFE_CHAR_PATTERN };
  const levels = (row && row.factorLevels) || {};
  const segments = [];

  // Whitespace INSIDE a level is removed, not turned into '_' as sanitizeToken
  // would do on its own ('NAM 50mM' -> 'NAM50mM', not 'NAM_50mM'). That keeps
  // the filename grammar unambiguous: '_' separates template fields, '-'
  // separates group segments, and neither ever appears inside a segment by
  // accident. A stray '_' mid-segment makes it impossible to see, by eye,
  // where the group description starts and ends.
  const segmentize = (value) => sanitizeToken(String(value).replace(/\s+/g, ''), sanitizeConfig);

  if (row && row.group !== null && row.group !== undefined) {
    segments.push(segmentize(row.group));
  }

  // Iterate the DESIGN's factor order, not Object.keys(levels): key order
  // happens to match today (expandConditions inserts in factor order) but the
  // declared order is the actual contract, and a row rebuilt from persisted
  // JSON has no guarantee of preserving it.
  for (const factor of factorsOf(design)) {
    const name = factor && factor.name;
    if (!Object.prototype.hasOwnProperty.call(levels, name)) continue;
    segments.push(segmentize(levels[name]));
  }

  return segments;
}

/**
 * Join a row's group segments into the single label that occupies the
 * filename's {group} slot. Never concatenates two segments without a
 * separator.
 */
export function buildGroupLabel(row, design) {
  return buildGroupSegments(row, design).join(GROUP_SEGMENT_SEPARATOR);
}

/**
 * Render a condition row through a custom "group naming override" template
 * (the same `{token}` syntax as engine/naming.js's filename template) and
 * sanitize it with naming.js's sanitizeToken -- REUSED, not reimplemented, so
 * this can never silently diverge from how filename tokens are built.
 *
 * Available tokens: every crossing factor by name, plus the reserved 'group',
 * 'biorep', 'techrep' -- but ONLY when that axis actually has a value on this
 * row (an omitted axis has no token to substitute, so referencing it throws
 * the same "Unknown token" a genuinely misspelled name would).
 *
 * An unknown token is a genuine authoring error in the scheme; it throws
 * rather than silently rendering an empty segment. conditionIssues is the
 * place a caller should check BEFORE calling this, so the problem is visible
 * as a design issue rather than only surfacing as a thrown error.
 */
export function buildSampleId(row, scheme) {
  const fields = { ...(row && row.factorLevels) };
  if (row) {
    if (row.group !== null && row.group !== undefined) fields.group = row.group;
    if (row.bioRep !== null && row.bioRep !== undefined) fields.biorep = row.bioRep;
    if (row.techRep !== null && row.techRep !== undefined) fields.techrep = row.techRep;
  }
  const rendered = String(scheme).replace(TEMPLATE_TOKEN_RE, (match, token) => {
    // hasOwnProperty, not `token in fields`: the `in` operator also matches
    // inherited Object.prototype members ('toString', 'constructor',
    // 'valueOf', ...), so a scheme like '{toString}' would silently render
    // that function's own source instead of being rejected as an unknown
    // token -- the same prototype-chain class of bug as paths.js's
    // __proto__ hole, recurring one module over.
    if (!Object.prototype.hasOwnProperty.call(fields, token) || fields[token] === undefined) {
      throw new Error(`Unknown token '{${token}}' in id scheme '${scheme}'.`);
    }
    return String(fields[token]);
  });
  return sanitizeToken(rendered, { safeCharPattern: SAMPLE_ID_SAFE_CHAR_PATTERN });
}
