// The advice panel: renders the modality-guidance notes engine/advisor.js
// selects, on any step that mounts one. Shared, not a step -- hence living
// in ui/ rather than ui/steps/.
//
// Deliberately its OWN visual vocabulary, not a reuse of `.issues-list`.
// Not for tone -- for shape: the {field, message, severity} issue record
// flattens to one line and has no room for a title AND a "why", which is
// the entire point of this feature. See docs/plans -- Advisor slice 1,
// Decision 3.
//
// The panel contains ZERO focusable elements. This is load-bearing, not
// cosmetic: it is what makes calling update() on every keystroke safe (no
// focus theft, no cursor jump in whatever field the user is typing in), and
// it is why there is no Dismiss button in this slice -- adding one later
// means revisiting the re-render seam, not just adding a button.
//
// No memoization anywhere in update(): store.patch() rebinds the experiment
// root (core/store.js), so any cached reference to a previous experiment is
// a live bug waiting to fire the moment a caller uses store.patch({}) as a
// notify-only no-op (describe.js does exactly that twice). With a single-
// digit rule count, evaluatePredicate's depth-capped tree walk is free;
// recomputing from scratch on every call is correct, not merely acceptable.

import { selectAdvice } from '../engine/advisor.js';
import { describePredicate } from '../engine/predicate.js';

const ADVICE_KIND_LABELS = { pitfall: 'Pitfall', tip: 'Tip' };

// Mirrors shell.js's THEME_KEY pattern: a localStorage flag, read through a
// try/catch so a disabled/unavailable localStorage degrades to "off" rather
// than throwing. Unconditionally showing WHY a note fired would put
// developer-facing predicate text (`acquisition.modality is one of [...]`)
// in front of a scientist, and it would become a second, driftable
// rendering of "why this applies" next to the rule's own prose `body` --
// exactly the two-renderings-of-one-fact shape this project has already
// been bitten by once. Behind a flag, it costs nothing and helps nobody but
// the person authoring rules.
const ADVISOR_DEBUG_KEY = 'micronaut.advisorDebug';

function advisorDebugEnabled() {
  try {
    return localStorage.getItem(ADVISOR_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

function appendAdviceNote(list, note) {
  const item = document.createElement('div');
  item.className = `advice-note advice-${note.kind}`;

  const kind = document.createElement('div');
  kind.className = 'advice-kind';
  kind.textContent = ADVICE_KIND_LABELS[note.kind] || note.kind;
  item.appendChild(kind);

  const title = document.createElement('div');
  title.className = 'advice-title';
  title.textContent = note.title;
  item.appendChild(title);

  const body = document.createElement('div');
  body.className = 'advice-body';
  body.textContent = note.body;
  item.appendChild(body);

  if (advisorDebugEnabled()) {
    const reason = document.createElement('div');
    reason.className = 'advice-reason';
    reason.textContent = `shown because: ${describePredicate(note.when)}`;
    item.appendChild(reason);
  }

  list.appendChild(item);
}

/**
 * Build an advice panel scoped to one `surface` ('describe' | 'design' |
 * 'naming'). `advisor` is the loaded rule array from engine/kbpack.js's
 * shapeAppKb -- the SAME array for every panel on every step, since the
 * rules themselves are surface-agnostic content; only the surface filter
 * applied at select time differs per panel.
 *
 * Returns { element, update(experiment) }. Mount `element` once, at render
 * time, in the step's own DOM tree (main.textContent = '' wipes the whole
 * step on every navigation, so there is nothing to persist across renders --
 * a fresh panel is created and mounted every time the step itself renders).
 * Call `update(experiment)` explicitly, with the SAME experiment object the
 * step's own output is rendering from, at every point that experiment
 * could have changed -- there is no store subscription here (see the
 * module-header comment on caching).
 */
export function createAdvicePanel(advisor, surface) {
  const section = document.createElement('div');
  section.className = 'advice-section';
  section.hidden = true; // no advice yet -- see update() below

  const heading = document.createElement('div');
  heading.className = 'advice-heading';
  heading.textContent = 'Guidance';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'advice-list';
  section.appendChild(list);

  function update(experiment) {
    const notes = selectAdvice(advisor, experiment, surface);
    // Hidden rather than merely empty when there is nothing to show -- an
    // empty "Guidance" heading sitting above nothing is dead chrome, and
    // scarcity is what keeps this feature from becoming a cookie banner.
    section.hidden = notes.length === 0;
    list.textContent = '';
    for (const note of notes) {
      appendAdviceNote(list, note);
    }
  }

  return { element: section, update };
}
