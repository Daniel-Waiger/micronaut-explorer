// Condition matrix: factors x levels x replicates -> concrete condition rows
// -> sample IDs. Pure module: no DOM, no store, no globals.
//
// ROW ORDER IS A CONTRACT. Downstream filename generation depends on the
// exact sequence produced by expandConditions: factors vary in their
// declared order (the FIRST factor is the slowest-varying / outermost
// axis), levels vary in their declared order within a factor, and replicate
// is the fastest-varying axis (innermost). Reordering this for "nicer"
// iteration silently reshuffles every sample ID and filename downstream.

import { sanitizeToken } from './naming.js';

// Refuse to materialize a cartesian product larger than this. A fat-fingered
// design (an extra factor, a huge replicate count) must fail fast with a
// visible issue rather than hang the browser building millions of rows.
const MAX_CONDITION_ROWS = 1000;

// Sample IDs are sanitized with the same safe-char policy naming.js's own
// filename tokens use by default. Exported so tests can build the identical
// sanitizeToken config rather than re-deriving/copying this string.
export const SAMPLE_ID_SAFE_CHAR_PATTERN = '[^A-Za-z0-9_-]+';

const TEMPLATE_TOKEN_RE = /\{([^{}]+)\}/g;

function factorsOf(design) {
  return design && Array.isArray(design.factors) ? design.factors : [];
}

function levelsOf(factor) {
  return factor && Array.isArray(factor.levels) ? factor.levels : [];
}

/**
 * Resolve design.replicates to the effective count used for expansion.
 * null/undefined (unset) and any non-positive-integer value default to 1 --
 * conditionIssues is the one that flags an explicit invalid value; this
 * function's job is only to guarantee expansion never silently degenerates
 * to a negative/zero loop bound.
 */
function effectiveReplicates(design) {
  const raw = design && design.replicates;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  return 1;
}

/** Total row count a design would expand to, without building any rows. */
function plannedRowCount(design) {
  const factors = factorsOf(design);
  let total = effectiveReplicates(design);
  for (const factor of factors) {
    total *= levelsOf(factor).length;
  }
  return total;
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
 * Expand a design into the full cartesian product of every factor's levels,
 * repeated for each replicate. See the module header for the row-order
 * contract.
 *
 * Guardrails (never throws):
 *  - zero factors -> exactly one row (a single unconditioned sample).
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

  const factors = factorsOf(design);
  const replicates = effectiveReplicates(design);

  let combos = [{}];
  for (const factor of factors) {
    const name = factor && factor.name;
    const levels = levelsOf(factor);
    const next = [];
    for (const combo of combos) {
      for (const level of levels) {
        next.push({ ...combo, [name]: level });
      }
    }
    combos = next;
  }

  const rows = [];
  for (const combo of combos) {
    for (let replicate = 1; replicate <= replicates; replicate += 1) {
      rows.push({ id: rows.length, factorLevels: combo, replicate });
    }
  }
  return rows;
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
export function conditionIssues(design) {
  const issues = [];
  const factors = factorsOf(design);

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
    // 'replicate' is the built-in key buildSampleId merges into a row's
    // token map for the replicate NUMBER -- a factor of the same name would
    // silently shadow it (or be shadowed by it), producing two distinct
    // conditions with the identical rendered token and therefore identical
    // sample IDs/filenames, with no other signal that anything went wrong.
    if (name === 'replicate') {
      issues.push(
        makeConditionIssue('factors', "Factor cannot be named 'replicate' -- that name is reserved for the replicate number.")
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
      const isUsable =
        (typeof level === 'string' && level.length > 0) ||
        (typeof level === 'number' && Number.isFinite(level));
      if (!isUsable) {
        issues.push(
          makeConditionIssue(
            'factors',
            `Factor '${name}' has an invalid level at position ${index} (must be a non-empty value).`
          )
        );
      }
    });
  }

  const rawReplicates = design && design.replicates;
  if (rawReplicates !== null && rawReplicates !== undefined) {
    const isValid =
      typeof rawReplicates === 'number' && Number.isInteger(rawReplicates) && rawReplicates >= 1;
    if (!isValid) {
      issues.push(
        makeConditionIssue(
          'replicates',
          `Replicates must be a positive integer; got ${JSON.stringify(rawReplicates)}.`
        )
      );
    }
  }

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
    const knownTokens = new Set(['replicate', ...factors.map((factor) => factor && factor.name)]);
    for (const token of templateTokens(idScheme)) {
      if (!knownTokens.has(token)) {
        issues.push(makeConditionIssue('idScheme', `Unknown token '{${token}}' in id scheme.`));
      }
    }
  }

  return issues;
}

/**
 * Render a condition row through an id scheme template (the same `{token}`
 * syntax as engine/naming.js's filename template) and sanitize it with
 * naming.js's sanitizeToken -- REUSED, not reimplemented, so sample IDs and
 * filename tokens can never silently diverge.
 *
 * An unknown token is a genuine authoring error in the scheme; it throws
 * rather than silently rendering an empty segment. conditionIssues is the
 * place a caller should check BEFORE calling this, so the problem is visible
 * as a design issue rather than only surfacing as a thrown error.
 */
export function buildSampleId(row, scheme) {
  const fields = { ...(row && row.factorLevels), replicate: row && row.replicate };
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
