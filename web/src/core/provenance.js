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
