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

import { selectAdvice, summarizeTrigger } from '../engine/advisor.js';
import { describePredicate } from '../engine/predicate.js';

const ADVICE_KIND_LABELS = { pitfall: 'Pitfall', tip: 'Tip' };

// A note answers TWO different questions, and they must not be conflated:
//
//   WHY does this note exist?  -> its `concept` ("spectral spillover",
//     "photobleaching"). Authored content; no predicate encodes it. This is
//     the note's actual reason and the thing a reader needs to recognize.
//   WHEN does it apply?  -> summarizeTrigger(note.when) ("modality is
//     STED"). Derived mechanically from the predicate so it cannot drift.
//     Useful, but strictly secondary -- it only tells you the note is
//     conditional on something you entered rather than shown to everyone.
//
// An earlier version rendered only the second and labelled it "Shown
// because ...", which reads as a reason and is not one: "modality is STED"
// says nothing about why STED warrants the warning.
//
// The RAW predicate text (describePredicate, engine/predicate.js) is a
// THIRD, debug-only tier behind this flag -- mirrors shell.js's THEME_KEY
// pattern, read through a try/catch so a disabled/unavailable localStorage
// degrades to "off" rather than throwing. Unconditionally showing raw
// predicate syntax (`acquisition.modality is one of [...]`) would put
// developer-facing text in front of a scientist for no benefit beyond what
// the two tiers above already give; it stays reserved for whoever is
// authoring or debugging a rule.
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

  // Kind ("Pitfall"/"Tip") and concept ("spectral spillover") on one line.
  // The CONCEPT is the note's actual reason for existing and is what makes a
  // list of notes scannable -- you can see at a glance that one is about
  // spillover and another about photobleaching, without reading either body.
  const kind = document.createElement('div');
  kind.className = 'advice-kind';
  const kindLabel = document.createElement('span');
  kindLabel.textContent = ADVICE_KIND_LABELS[note.kind] || note.kind;
  kind.appendChild(kindLabel);
  const concept = document.createElement('span');
  concept.className = 'advice-concept';
  concept.textContent = note.concept;
  kind.appendChild(concept);
  item.appendChild(kind);

  const title = document.createElement('div');
  title.className = 'advice-title';
  title.textContent = note.title;
  item.appendChild(title);

  const body = document.createElement('div');
  body.className = 'advice-body';
  body.textContent = note.body;
  item.appendChild(body);

  // "Applies when ...", NOT "Shown because ..." -- this is the note's
  // APPLICABILITY condition, not its reason. The reason is the concept
  // rendered above. Labelling a trigger condition as a reason is precisely
  // the mistake an earlier version of this file made.
  const trigger = summarizeTrigger(note.when);
  if (trigger) {
    const triggerEl = document.createElement('div');
    triggerEl.className = 'advice-trigger';
    triggerEl.textContent = `Applies when ${trigger}.`;
    item.appendChild(triggerEl);
  }

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
 * `defaultExpanded` (default TRUE, zen-planner experience-verbosity slice):
 * this panel previously had NO collapse mechanism of its own -- a plain
 * <div>, always fully visible whenever it had notes (only `.hidden` toggled
 * the whole section on/off, never an open/closed state for existing notes).
 * Rather than invent a bespoke toggle, it now reuses the SAME native
 * <details>/<summary> "reveal" idiom already shared by describe.js's/
 * panel.js's "Get AI help"/"Your answers" sections (see app.css's `.reveal`
 * comment) -- one progressive-disclosure mechanism app-wide, not two.
 * `defaultExpanded` sets the details element's initial `open` state.
 *
 * Defaults to TRUE deliberately, not false: this is guidance content
 * (pitfalls/tips, sometimes safety-relevant -- spectral spillover,
 * photobleaching), and every caller that does not yet thread an experience
 * level through (describe.js, design.js, naming.js -- only panel.js does,
 * see below) must keep today's always-visible behavior unchanged, since
 * `experience` reads `null` for the app's entire existing userbase (the
 * onboarding gate only ever fires on a session with zero prior autosaves --
 * see core/onboarding.js / main.js). A caller opts INTO collapsing, it is
 * never the silent default -- panel.js is the one caller that does, and
 * only for an explicit 'frequent' self-report, not for 'novice' or an
 * absent/unset experience level.
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
export function createAdvicePanel(advisor, surface, { defaultExpanded = true } = {}) {
  const section = document.createElement('details');
  section.className = 'advice-section reveal';
  section.open = defaultExpanded;
  section.hidden = true; // no advice yet -- see update() below

  const heading = document.createElement('summary');
  heading.className = 'advice-heading reveal-summary';
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
