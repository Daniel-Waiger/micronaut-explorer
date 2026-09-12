// Tiered provenance: every written value carries a tag classifying how
// trustworthy its source is, and canOverwrite enforces that a stronger tag
// can never be silently clobbered by a weaker one.
//
// Leaf module: import nothing.

export const TAG_TIERS = {
  user: 'STRONG',
  user_edited: 'STRONG',
  imported: 'STRONG',
  freetext: 'WEAK',
  'kb-default': 'WEAK',
  derived: 'WEAK',
  default: 'WEAK',
  llm: 'PROVISIONAL',
  llm_freetext: 'PROVISIONAL',
};

export function tierOf(tag) {
  const tier = TAG_TIERS[tag];
  if (!tier) {
    throw new Error(`unknown provenance tag: ${tag}`);
  }
  return tier;
}

export function isProvisional(tag) {
  return tierOf(tag) === 'PROVISIONAL';
}

/**
 * True if `value` carries no information -- a deliberate clear, not a real
 * value. Defined here (rather than duplicated in core/store.js and
 * core/schema.js) so the write-time rule (setValueAtPath) and the load-time
 * heal (schema.js's normalizeEmptySlotProvenance) can never drift apart: a
 * value schema.js decides is "empty enough to demote" must be exactly the
 * same set of values store.js decides is "empty enough to write as WEAK",
 * or a legacy save could be healed by one rule and immediately re-locked by
 * the other.
 *
 * The boundary, spelled out (this is deliberately domain-naive -- it knows
 * nothing about "levels" or "groups", only whether a value carries no
 * information):
 *   - '' / null / undefined -> empty.
 *   - an array is empty iff EVERY element is itself empty (recursively):
 *     [] and [null] and [''] and [{}] are all empty; ['a'] and [0] and
 *     [false] are not. This is what makes {levels: ['']} -- ONE "Add group"
 *     click, or blanking the last row's text, on an otherwise-empty groups
 *     list (see ui/steps/design.js) -- count as a clear exactly like
 *     {levels: []} does: a lone blank row carries the same "nothing typed
 *     here yet" information as no row at all, and treating it as STRONG
 *     would reopen the exact permanent lock (lesson 37 / V6-NEW-03) this
 *     rule exists to prevent, one keystroke over.
 *   - a PLAIN object ({} or Object.create(null), never a Date or any other
 *     class instance) is empty iff every own value is itself empty:
 *     {} and {levels: []} and {a: {b: []}} are empty. The prototype check
 *     is load-bearing: without it, `new Date()` -- which has no OWN
 *     enumerable properties, so Object.values(...).every(...) is vacuously
 *     true -- would be silently treated as "the user cleared this field",
 *     which is never a real scenario a value like that could arise from.
 *   - 0, false, NaN, and any other non-empty-string primitive are real
 *     values, never empty -- a measurement recorded as 0 is data, not a
 *     blank.
 */
export function isEmptyValue(value) {
  if (value === '' || value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every(isEmptyValue);
  }
  return false;
}

/**
 * The tag a UI hand-edit through a text field should write: 'user_edited'
 * when the slot already held a WEAK/PROVISIONAL value (the user is
 * correcting a machine-sourced guess -- a free-text proposal, a KB default,
 * an LLM suggestion), 'user' for a first-ever entry or a slot already
 * STRONG. Both tiers are equally STRONG for canOverwrite's purposes; this
 * is purely the historical distinction the provenance record keeps, and is
 * what C1-6's own verification text (and repo lesson E8) require: a value
 * the user corrected must be distinguishable from one they typed fresh.
 */
export function editTagFor(existingTag) {
  if (existingTag == null) return 'user';
  return tierOf(existingTag) === 'STRONG' ? 'user' : 'user_edited';
}

/**
 * True if a value tagged `newTag` may overwrite a slot currently tagged
 * `existingTag`. A STRONG-tagged slot can never be overwritten by anything
 * that isn't itself STRONG -- e.g. a `freetext` (WEAK) write must never
 * clobber a `user` (STRONG) value. A slot with no existing tag yet (first
 * write) is always overwritable.
 */
export function canOverwrite(existingTag, newTag) {
  if (existingTag == null) {
    return true;
  }
  if (tierOf(existingTag) === 'STRONG' && tierOf(newTag) !== 'STRONG') {
    return false;
  }
  return true;
}

/**
 * Write (replace) the provenance slot at `path`. Replacing the slot outright
 * -- rather than merging into whatever was there -- means a fresh tag write
 * never silently carries forward a stale flag (e.g. needsReview) from the
 * value it is superseding.
 */
export function tagSlot(experiment, path, tag, detail = null) {
  experiment.provenance.slots[path] = { tag, detail };
  return experiment;
}

/**
 * Retag the slot at `path` as `user_edited` and clear `needsReview`.
 *
 * Load-bearing: repo lesson E8 proves that without a retag on user edit, a
 * provenance gate keyed on a weaker source tag can never clear, because
 * editing the value in place leaves the ORIGINAL (weaker) tag in place
 * forever. Any UI that lets a user edit a value must call this.
 */
export function promoteOnUserEdit(experiment, path) {
  const existing = experiment.provenance.slots[path];
  experiment.provenance.slots[path] = {
    ...(existing ?? {}),
    tag: 'user_edited',
    needsReview: false,
  };
  return experiment;
}
