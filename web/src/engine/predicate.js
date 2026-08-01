// Predicate DSL: a small, TOTAL, eval-free boolean language evaluated
// against the Experiment via core/paths.js getPath. This is the data format
// that lets the question bank (C1-3) and, later, control rules (P2) be DATA
// rather than code -- see docs/plans/planner-web-p1-task-graph.json, task
// C1-2.
//
// Grammar (JSON only -- no eval(), no new Function()):
//   leaf:    {eq: [path, value]} | {ne: [path, value]} | {in: [path, [v1,v2]]}
//          | {gt: [path, n]} | {lt: [path, n]} | {exists: path} | {empty: path}
//          | {matches: [path, regexSource]}
//   branch:  {all: [pred, ...]} | {any: [pred, ...]} | {not: pred}
//   literal: true | false
//   no condition: undefined
//
// TOTALITY IS THE CENTRAL REQUIREMENT. This module evaluates author-written
// JSON data (question askWhen clauses, later control rules), so it must
// NEVER throw. Every malformed shape -- unknown operator, missing/dangerous
// path, wrong arity, non-array where an array is required, a null predicate,
// a bad regex source, runaway nesting -- degrades to `false`. Only an
// `undefined` predicate (no condition given) is `true`.

import { getPath } from '../core/paths.js';
import { compileFullMatch } from './validation.js';

// Recursion is capped so a cyclic or absurdly deep authored predicate can
// never blow the JS stack. 32 mirrors the task spec's explicit cap.
const MAX_PREDICATE_DEPTH = 32;

// Thrown ONLY internally when the depth cap is exceeded, and caught ONLY in
// evaluatePredicate's top-level try/catch -- never leaks past this module.
//
// Why a throw instead of a plain local `return false`: evalNode's callers
// (evalNotBranch/evalAllBranch/evalAnyBranch) NEGATE or combine their
// child's result. If the cap were enforced by returning a plain `false` at
// the cutoff node, that `false` would then be negated by however many `not`
// wrappers sit between the cutoff and the top of the tree -- an odd/even
// parity accident could flip the overall answer to `true`, exactly the
// runaway-input case this guard exists to make safe. Throwing unwinds
// straight past all of that intervening not/all/any logic so hitting the
// cap ANYWHERE always forces the WHOLE evaluation to `false`, unconditionally.
class PredicateDepthCapError extends Error {}

// Sentinel distinguishing "getPath threw" (dangerous/malformed path
// segment, e.g. '__proto__.x') from "getPath legitimately resolved to
// undefined" (path just doesn't exist in this Experiment). The two must be
// handled differently: a legitimately-absent value still flows through each
// operator's normal semantics (so `empty` on a genuinely missing field is
// still `true`), but a THROWN/dangerous path must force the leaf to `false`
// no matter which operator asked for it -- per this task's explicit
// instruction to treat getPath's throw as `false`, not propagate it.
const PREDICATE_PATH_ERROR = Symbol('predicate-path-error');

function resolvePredicatePath(experiment, path) {
  if (typeof path !== 'string' || path.length === 0) return PREDICATE_PATH_ERROR;
  try {
    return getPath(experiment, path);
  } catch {
    return PREDICATE_PATH_ERROR;
  }
}

/** [path, value] shape shared by eq/ne/gt/lt/in/matches. Malformed -> null. */
function extractPathArgPair(arg) {
  if (!Array.isArray(arg) || arg.length !== 2) return null;
  if (typeof arg[0] !== 'string' || arg[0].length === 0) return null;
  return arg;
}

/** exists() semantics per the task spec: present and not an empty string/array. */
function predicateHasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.length === 0) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/** Deep-ish equality for JSON-shaped values; total (never throws). */
function predicateValuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => predicateValuesEqual(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => predicateValuesEqual(a[key], b[key]));
  }
  return false;
}

/** Coerce to a finite number for gt/lt, or null if that is not possible. */
function predicateToNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function evalEqLeaf(arg, experiment) {
  const pair = extractPathArgPair(arg);
  if (!pair) return false;
  const resolved = resolvePredicatePath(experiment, pair[0]);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  return predicateValuesEqual(resolved, pair[1]);
}

function evalNeLeaf(arg, experiment) {
  const pair = extractPathArgPair(arg);
  if (!pair) return false;
  const resolved = resolvePredicatePath(experiment, pair[0]);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  return !predicateValuesEqual(resolved, pair[1]);
}

function evalInLeaf(arg, experiment) {
  if (!Array.isArray(arg) || arg.length !== 2) return false;
  const [path, list] = arg;
  if (typeof path !== 'string' || path.length === 0 || !Array.isArray(list)) return false;
  const resolved = resolvePredicatePath(experiment, path);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  return list.some((item) => predicateValuesEqual(resolved, item));
}

function evalGtLeaf(arg, experiment) {
  const pair = extractPathArgPair(arg);
  if (!pair) return false;
  const resolved = resolvePredicatePath(experiment, pair[0]);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  const a = predicateToNumber(resolved);
  const b = predicateToNumber(pair[1]);
  if (a === null || b === null) return false;
  return a > b;
}

function evalLtLeaf(arg, experiment) {
  const pair = extractPathArgPair(arg);
  if (!pair) return false;
  const resolved = resolvePredicatePath(experiment, pair[0]);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  const a = predicateToNumber(resolved);
  const b = predicateToNumber(pair[1]);
  if (a === null || b === null) return false;
  return a < b;
}

function evalExistsLeaf(arg, experiment) {
  if (typeof arg !== 'string' || arg.length === 0) return false;
  const resolved = resolvePredicatePath(experiment, arg);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  return predicateHasValue(resolved);
}

function evalEmptyLeaf(arg, experiment) {
  if (typeof arg !== 'string' || arg.length === 0) return false;
  const resolved = resolvePredicatePath(experiment, arg);
  if (resolved === PREDICATE_PATH_ERROR) return false;
  return !predicateHasValue(resolved);
}

function evalMatchesLeaf(arg, experiment) {
  if (!Array.isArray(arg) || arg.length !== 2) return false;
  const [path, source] = arg;
  if (typeof path !== 'string' || path.length === 0 || typeof source !== 'string') return false;
  const resolved = resolvePredicatePath(experiment, path);
  if (resolved === PREDICATE_PATH_ERROR) return false;

  // MUST anchor the whole string via engine/validation.js compileFullMatch,
  // never a hand-rolled `new RegExp(source)` -- an unanchored pattern would
  // silently ACCEPT a substring match (the C0-4 landmine: '[A-Za-z0-9_-]+'
  // matching inside 'bad note'). A malformed regex SOURCE must not throw.
  let anchored;
  try {
    anchored = compileFullMatch(source);
  } catch {
    return false;
  }

  let text;
  try {
    text = resolved === undefined || resolved === null ? '' : String(resolved);
  } catch {
    return false;
  }

  try {
    return anchored.test(text);
  } catch {
    return false;
  }
}

function evalAllBranch(arg, experiment, depth) {
  if (!Array.isArray(arg)) return false;
  for (const child of arg) {
    if (!evalPredicateNode(child, experiment, depth + 1)) return false;
  }
  return true;
}

function evalAnyBranch(arg, experiment, depth) {
  if (!Array.isArray(arg)) return false;
  for (const child of arg) {
    if (evalPredicateNode(child, experiment, depth + 1)) return true;
  }
  return false;
}

function evalNotBranch(arg, experiment, depth) {
  return !evalPredicateNode(arg, experiment, depth + 1);
}

function evalPredicateNode(node, experiment, depth) {
  // Enforced first and unconditionally: see PredicateDepthCapError above for
  // why this must be a throw rather than a local `false`.
  if (depth > MAX_PREDICATE_DEPTH) throw new PredicateDepthCapError();

  if (node === undefined) return true; // no condition -> always askable
  if (typeof node === 'boolean') return node; // literal true/false

  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false; // malformed

  const keys = Object.keys(node);
  if (keys.length !== 1) return false; // malformed: 0 or >1 operator keys
  const op = keys[0];
  const arg = node[op];

  switch (op) {
    case 'eq':
      return evalEqLeaf(arg, experiment);
    case 'ne':
      return evalNeLeaf(arg, experiment);
    case 'in':
      return evalInLeaf(arg, experiment);
    case 'gt':
      return evalGtLeaf(arg, experiment);
    case 'lt':
      return evalLtLeaf(arg, experiment);
    case 'exists':
      return evalExistsLeaf(arg, experiment);
    case 'empty':
      return evalEmptyLeaf(arg, experiment);
    case 'matches':
      return evalMatchesLeaf(arg, experiment);
    case 'all':
      return evalAllBranch(arg, experiment, depth);
    case 'any':
      return evalAnyBranch(arg, experiment, depth);
    case 'not':
      return evalNotBranch(arg, experiment, depth);
    default:
      return false; // unknown operator
  }
}

/**
 * Evaluate `pred` against `experiment`. NEVER throws: any malformed node,
 * unknown operator, dangerous/missing path, bad regex source, or runaway
 * nesting yields `false`; `undefined` (no condition) yields `true`.
 */
export function evaluatePredicate(pred, experiment) {
  try {
    return evalPredicateNode(pred, experiment, 0);
  } catch {
    // Catches PredicateDepthCapError, and acts as a defense-in-depth net for
    // anything else unforeseen -- this function must never throw.
    return false;
  }
}

function describePredicatePath(path) {
  return typeof path === 'string' && path.length > 0 ? path : 'value';
}

function describePredicateValue(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function describeComparisonLeaf(arg, opWord) {
  if (!Array.isArray(arg) || arg.length !== 2) return 'an invalid condition';
  return `${describePredicatePath(arg[0])} ${opWord} ${describePredicateValue(arg[1])}`;
}

function describeInLeaf(arg) {
  if (!Array.isArray(arg) || arg.length !== 2 || !Array.isArray(arg[1])) return 'an invalid condition';
  const options = arg[1].map((v) => describePredicateValue(v)).join(', ');
  return `${describePredicatePath(arg[0])} is one of [${options}]`;
}

function describeMatchesLeaf(arg) {
  if (!Array.isArray(arg) || arg.length !== 2) return 'an invalid condition';
  return `${describePredicatePath(arg[0])} matches /${arg[1]}/`;
}

function describeBranchGroup(arg, joiner, depth) {
  if (!Array.isArray(arg)) return 'an invalid condition';
  if (arg.length === 0) return `${joiner} of (nothing)`;
  const parts = arg.map((child) => describePredicateNode(child, depth + 1));
  return `${joiner} of (${parts.join('; ')})`;
}

function describePredicateNode(node, depth) {
  if (depth > MAX_PREDICATE_DEPTH) return 'a condition nested too deeply to describe';
  if (node === undefined) return 'always (no condition)';
  if (typeof node === 'boolean') return node ? 'always true' : 'always false';
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return 'an invalid condition';

  const keys = Object.keys(node);
  if (keys.length !== 1) return 'an invalid condition';
  const op = keys[0];
  const arg = node[op];

  switch (op) {
    case 'eq':
      return describeComparisonLeaf(arg, 'is');
    case 'ne':
      return describeComparisonLeaf(arg, 'is not');
    case 'in':
      return describeInLeaf(arg);
    case 'gt':
      return describeComparisonLeaf(arg, 'is greater than');
    case 'lt':
      return describeComparisonLeaf(arg, 'is less than');
    case 'exists':
      return `${describePredicatePath(arg)} is filled in`;
    case 'empty':
      return `${describePredicatePath(arg)} is empty`;
    case 'matches':
      return describeMatchesLeaf(arg);
    case 'all':
      return describeBranchGroup(arg, 'all', depth);
    case 'any':
      return describeBranchGroup(arg, 'any', depth);
    case 'not':
      return `not (${describePredicateNode(arg, depth + 1)})`;
    default:
      return `an unrecognized condition ('${String(op)}')`;
  }
}

/**
 * A short, human-readable rendering of `pred` for the UI's "why is this
 * question being asked" explanation. Total like evaluatePredicate: never
 * throws, always returns a non-empty string.
 */
export function describePredicate(pred) {
  try {
    const text = describePredicateNode(pred, 0);
    return text && text.length > 0 ? text : 'a condition';
  } catch {
    return 'a condition';
  }
}
