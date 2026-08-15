// Build a BRAND-NEW study from a set of proposals (engine/llmproposals.js),
// rather than applying them into whatever study the user currently has open.
//
// WHY A FRESH INSTANCE: an in-progress study is full of values the user
// actually chose, and a model drafting a whole study touches nearly every
// field. canOverwrite would correctly refuse most of those writes, producing
// a half-applied mess that is neither the user's study nor the model's
// draft. Starting from emptyExperiment() means there is nothing to protect,
// so the draft applies cleanly and the user's own study is never in the
// blast radius at all.
//
// THE `imported` TRAP, avoided deliberately: it would be easy to serialize a
// draft and hand it to whatever import path exists. That must NOT happen --
// 'imported' is a STRONG tag (core/provenance.js), so routing a model draft
// through it would launder every model guess into "as trustworthy as
// something the user typed", erasing the distinction the rest of this
// codebase works hard to keep (see engine/conformance.js's split of
// "answered but invalid" from "not answered yet", and engine/spectra.js's
// five-state resolution). Every slot in a draft stays PROVISIONAL and
// carries needsReview, so the UI can render it as "confirm this" and a
// later real user edit always wins.
//
// Writes go through core/store.js like every other write in the app -- the
// single writer, with its provenance gate -- rather than assembling a raw
// object here. A draft is built the same way a user builds a study, just
// faster.

import { createStore } from './store.js';
import { emptyExperiment } from './schema.js';
import { firstAssayId, scopeWrite } from './assay.js';
import { markNeedsReview } from './provenance.js';

/**
 * Apply `proposals` to a fresh experiment and return it, together with the
 * paths that were actually written.
 *
 * `proposals` is engine/llmproposals.js's output shape ({path, value, tag}
 * plus display fields) -- or anything else carrying those three, which is
 * what makes this testable with hand-written fixtures and no model.
 *
 * TOTAL: never throws. A proposal addressing a path scopeWrite cannot
 * resolve is skipped and reported rather than aborting the draft -- a
 * partial draft the user can review beats no draft and a stack trace.
 *
 * Returns { experiment, applied, skipped }.
 */
export function buildDraftExperiment(proposals) {
  const store = createStore(emptyExperiment());
  const assayId = firstAssayId(store.get());
  const applied = [];
  const skipped = [];

  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    if (!proposal || typeof proposal.path !== 'string') {
      skipped.push({ path: String(proposal && proposal.path), reason: 'malformed proposal' });
      continue;
    }
    try {
      const { path, slotKey } = scopeWrite(store.get(), proposal.path, assayId);
      const ok = store.setPath(path, proposal.value, proposal.tag, { slotKey });
      if (!ok) {
        // Cannot happen on a fresh experiment (every slot starts untagged,
        // so canOverwrite always allows the first write) -- reported rather
        // than asserted, because a silent no-op here would look exactly like
        // a model that failed to propose the field at all.
        skipped.push({ path: proposal.path, reason: 'write refused by the provenance gate' });
        continue;
      }
      // The tag alone says where the value came from; needsReview is what
      // the UI reads to badge it as unconfirmed. Both, for every drafted
      // slot -- a draft is entirely unreviewed by definition.
      markNeedsReview(store.get(), slotKey);
      applied.push(proposal.path);
    } catch (err) {
      skipped.push({ path: proposal.path, reason: err.message });
    }
  }

  return { experiment: store.get(), applied, skipped };
}
