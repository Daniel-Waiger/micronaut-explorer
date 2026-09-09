#!/usr/bin/env python3
"""Capture a few *seeded* snapshots of Micronaut Planner for use as post/social
"appetizer" images -- shots that show the app doing something, rather than the
neutral reference screens in tools/capture_screenshots.py.

This is a thin driver over that script: it reuses its server bootstrap, its
stdlib-only CDP client, its example-study load path and its scroll/theme
handling, and swaps in its own SCREENS table. Nothing is duplicated except the
screen definitions themselves.

    python3 tools/capture_post_snapshots.py [--out-dir docs/images/post] [--only ...]

WHY THESE PARTICULAR FLUOROPHORES
---------------------------------
The seeded markers strings below are deliberately boring, textbook panels --
the point of an appetizer image is that a microscopist recognises what they
are looking at in under a second, which nothing niche can do. Every token was
checked two ways before being used here:

  1. It resolves to state 'known' through the app's own resolver
     (engine/spectra.js resolvePanel over web/kb/markers.json +
     web/kb/spectra.json) -- so the screenshot shows a real resolved channel,
     never an 'unrecognized' chip that would read as a typo.
  2. It is a standard multi-colour-panel dye, not a specialist reagent: DAPI
     as the nuclear counterstain, Alexa Fluor 488 / GFP in the green channel,
     Cy3 in the orange-red, Alexa Fluor 647 in the far-red. All but GFP carry
     reviewStatus 'source-cited' in spectra.json (their peaks cite a vendor or
     curator page); GFP is 'claude-drafted', which the app labels in the UI.

The FLAGGED panel is a real, common mistake rather than an invented one: a
GFP-expressing line immunostained with an Alexa Fluor 488 secondary. Their
emission peaks are 12 nm apart (507 vs 519) and excitation peaks 7 nm apart
(488 vs 495), so the planner raises one error and one warning. The CLEAN panel
is the same study with GFP swapped out for the far-red channel, and raises
nothing -- the two shots side by side are the whole feature in one glance.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import capture_screenshots as cs  # noqa: E402  (path shim must precede this)

# --- Seeded panels ---------------------------------------------------------
# Hyphen-separated because engine/validation.js's splitMarkers splits the
# markers field on [-,;|/] -- spaces inside one token are preserved, which is
# what lets "ALEXA FLUOR 488" resolve as a single alias.
FLAGGED_PANEL = "DAPI-GFP-ALEXA FLUOR 488-CY3"
CLEAN_PANEL = "DAPI-ALEXA FLUOR 488-CY3-ALEXA FLUOR 647"

# The example study's four measurements are seeded in
# web/src/core/defaultStudy.js. "Macrophage cytoskeleton" is the confocal
# immunofluorescence one, so a four-colour antibody panel belongs to it; the
# others are a bacterial live/dead assay, a ROS indicator assay and a
# label-free migration assay, where these dyes would make no sense.
TARGET_MEASUREMENT = "Macrophage cytoskeleton"

SELECT_MEASUREMENT_JS = """
((label) => {
  const btn = Array.from(document.querySelectorAll('button.assay-pill-label'))
    .find((b) => b.textContent.trim() === label);
  if (!btn) return false;
  btn.click();
  return true;
})(%s)
"""

# The measurement page shows the Markers question TWICE, both bound to the same
# store path (naming.fields.markers -- see web/kb/questions.json's "markers"
# question and ui/steps/naming.js's FIELD_DEFS):
#
#   * Acquisition renders it through ui/fieldInterview.js, as a
#     <div class="field-row"> with a <label class="field-label">.
#   * Data plan renders it through ui/steps/naming.js, as a
#     <label class="field-row"> with a <span class="field-label">.
#
# Only the Acquisition one refreshes the colour panel below it, and only when
# the answer is COMMITTED -- ui/steps/panel.js repaints the step from its
# field-commit handler, not on every keystroke. So typing alone leaves the
# spillover check painting the OLD panel while the box above it shows the new
# one: exactly the incoherent screenshot this script exists to avoid. Set the
# Acquisition control and then click its own "Confirm" button, which is what a
# person does anyway.
#
# The Data plan copy is written too, in the same pass: the Acquisition commit
# repaints its own step only, so leaving the other box showing the previous
# panel would put two different answers to one question in a single frame.
# Selecting on the shared '.field-row' class (rather than the div/label each
# renderer happens to use) covers both.
SET_MARKERS_JS = """
((value) => {
  const rows = Array.from(document.querySelectorAll('.field-row')).filter((r) => {
    const label = r.querySelector('.field-label');
    return label && label.textContent.trim() === 'Markers';
  });
  let set = 0;
  for (const row of rows) {
    const input = row.querySelector('input.field-input');
    if (!input) continue;
    input.value = value;
    // The app persists on 'input', not on 'change' -- dispatching the wrong
    // one paints the box and changes nothing downstream.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Committing is what repaints the colour panel below (and what flips the
    // field's provenance chip from Unconfirmed to Confirmed).
    const commit = row.querySelector('button.field-commit');
    if (commit) commit.click();
    set += 1;
  }
  return set;
})(%s)
"""

# The seed is worthless if it half-applies, and every failure mode here is
# silent in a screenshot: a renamed label matches no row, an uncommitted answer
# leaves the panel stale. Throwing from Runtime.evaluate aborts the capture
# with the reason, rather than writing a plausible-looking wrong PNG.
ASSERT_SEEDED_JS = """
((value) => {
  const tokens = value.split('-').map((t) => t.trim()).filter(Boolean);
  const boxes = Array.from(document.querySelectorAll('.field-row'))
    .filter((r) => {
      const label = r.querySelector('.field-label');
      return label && label.textContent.trim() === 'Markers';
    })
    .map((r) => (r.querySelector('input') || {}).value);
  if (!boxes.length) throw new Error('no Markers field found on this screen');
  if (!boxes.every((v) => v === value)) {
    throw new Error('Markers boxes disagree after seeding: ' + JSON.stringify(boxes));
  }
  // The colour panel lists one row per resolved token; if it still describes
  // the previous panel, the commit did not repaint it.
  const panel = document.body.innerText.toUpperCase();
  const missing = tokens.filter((t) => !panel.includes(t.toUpperCase()));
  if (missing.length) {
    throw new Error('spillover panel does not mention: ' + missing.join(', '));
  }
  return true;
})(%s)
"""

OPEN_SECTIONS_JS = """
(() => {
  document.querySelectorAll('details.microscopy-section').forEach((d) => { d.open = true; });
  return true;
})()
"""

# --- Research brief demo text -----------------------------------------------
# One paragraph about the SHIPPED example study (the oregano-derived plasma-
# polymer coating wound-healing study, web/src/core/defaultStudy.js), written
# so the deterministic free-text parser (engine/freetext.js parseFreeText)
# matches all four of the things it can ever extract -- verified against the
# real parser + the real marker KB before use here, not eyeballed:
#
#   markers        -- "DAPI-PHALLOIDIN" (both freeTextAliases, neither in
#                      markers.json's ambiguousInFreeText list)
#   replicates     -- "n = 3" (REPLICATE_PATTERNS)
#   magnification  -- "40x" (MAGNIFICATION_TRAILING_X_RE)
#   date           -- "2026-09-09" (ISO_DATE_RE; deliberately ISO -- the
#                      parser refuses any other date format on purpose)
#
# Deliberately does NOT use the word "magnification" itself: the keyword form
# (MAGNIFICATION_KEYWORD_RE) matches ANY digit run within 10 non-digit
# characters after that word, no unit required -- an earlier draft that read
# "...at 40x magnification, imaged on 2026-09-09" had the parser reading
# "magnification on 202" out of the DATE and proposing X202. Caught by
# running the real parser before use, not by inspection; the trailing-"x"
# form used here (MAGNIFICATION_TRAILING_X_RE) has no such adjacency hazard.
DEMO_DESCRIPTION_TEXT = (
    "We stained CTL and OPP-coated coverslips with DAPI-PHALLOIDIN to visualize nuclei "
    "and F-actin at 40x, n = 3 biological replicates per group, imaged on 2026-09-09."
)

# The demo text's own four candidate fields collide with markers/magnification
# already SEEDED on three of the four example-study measurements
# (core/defaultStudy.js's ASSAY_SEEDS) -- accepting a suggestion there would
# show "Already confirmed" from the first frame, not the accept flow this
# screen exists to demonstrate. "Scratch / migration" is the one measurement
# defaultStudy.js deliberately leaves magnification unseeded on (an Incucyte
# time-lapse setup has no single X## objective value) and seeds markers as
# the literal 'NONE' sentinel -- so all four suggestions here start genuinely
# actionable: three with no current value at all, and Markers as a real
# 'NONE' -> 'DAPI-PHALLOIDIN' replacement rather than a same-value no-op.
BRIEF_TARGET_MEASUREMENT = "Scratch / migration"

TYPE_DESCRIPTION_JS = """
((text) => {
  const ta = document.getElementById('project-description');
  if (!ta) return false;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})(%s)
"""

CLICK_REVIEW_DESCRIPTION_JS = """
(() => {
  const btn = document.querySelector('button.project-review-button');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
})()
"""

# Accepts whichever candidate group renders FIRST. That is NOT proposal
# order (parseFreeText's own index-sorted array) -- engine/projectReview.js's
# buildProjectReview groups candidates into a Map keyed by destination path,
# and the rendered order comes out alphabetised by question label (verified
# empirically: "Biological replicates" before "Date" before "Magnification"
# before "Markers", for a set of proposals whose free-text order was
# Markers/Replicates/Magnification/Date). So this accepts "Biological
# replicates" for the demo text above, not necessarily whichever field the
# text mentions first -- captions should describe it as "a suggestion",
# not name a specific field, unless a screen re-verifies which one lands.
ACCEPT_FIRST_PROPOSAL_JS = """
(() => {
  const btn = document.querySelector('button.project-review-accept');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
})()
"""

TOGGLE_NAV_JS = """
(() => {
  const btn = document.querySelector('button.nav-toggle');
  if (!btn) return false;
  btn.click();
  return true;
})()
"""

# Review renders TWO <section class="conformance"> blocks (Decisions, then
# further down Planner checks -- ui/steps/overview.js's
# renderReviewDecisionGroups and the inline conformanceSection both share
# that class), and the second one also carries a readiness-specific class
# (conformance-ready / conformance-needs-review / conformance-blocked) that
# this script has no reason to hardcode. Rather than guess which readiness
# the example study is in, tag each section by its own <h2> text -- a marker
# CSS classes here alone can't provide -- so scroll_to can target it exactly.
TAG_SECTION_BY_HEADING_JS_TEMPLATE = """
((headingText, tagClass) => {
  const heading = Array.from(document.querySelectorAll('.overview-node-title'))
    .find((h) => h.textContent.trim() === headingText);
  const section = heading && heading.closest('section');
  if (!section) return false;
  section.classList.add(tagClass);
  return true;
})(%s, %s)
"""


def _tag_by_heading_js(heading_text, tag_class):
    import json

    return TAG_SECTION_BY_HEADING_JS_TEMPLATE % (json.dumps(heading_text), json.dumps(tag_class))



def _js(template: str, arg: str) -> str:
    import json

    return template % json.dumps(arg)


def _seed(panel: str, *, seed_channels: bool) -> list:
    """The action sequence shared by every screen here.

    Order matters: setting Markers writes to the store, which re-renders the
    measurement page and resets the <details> accordions -- so the sections are
    opened AFTER the field is filled, not before, or the shot comes back
    collapsed.
    """
    actions = [
        _js(SELECT_MEASUREMENT_JS, TARGET_MEASUREMENT),
        _js(SET_MARKERS_JS, panel),
        # Committing repaints the Acquisition step, so any box that renderer
        # owns is a fresh element by now; a second pass catches one that came
        # back holding the old value.
        _js(SET_MARKERS_JS, panel),
        OPEN_SECTIONS_JS,
        _js(ASSERT_SEEDED_JS, panel),
    ]
    if seed_channels:
        actions.append(cs.SEED_FROM_MARKERS_JS)
    return actions


POST_SCREENS = [
    dict(
        name="post-01-spillover-flagged",
        hash="measurement",
        viewport=(1440, 1600),
        theme="light",
        actions=_seed(FLAGGED_PANEL, seed_channels=False),
        scroll_to="#measurement-section-acquisition",
        caption=(
            "Spillover check on a GFP line stained with an Alexa Fluor 488 secondary -- "
            "emission peaks 12 nm apart, flagged before anyone books the microscope."
        ),
    ),
    dict(
        name="post-02-spillover-clean",
        hash="measurement",
        viewport=(1440, 1600),
        theme="light",
        actions=_seed(CLEAN_PANEL, seed_channels=True),
        # Not the Acquisition anchor again: with the panel fixed, the
        # interesting half is the schematic emission curves and the per-channel
        # table below the spillover list, which the '[data-tour-section]'
        # attribute (panel.js's createMicroscopySection) addresses directly.
        scroll_to="details.microscopy-section[data-tour-section='spectral']",
        caption=(
            "The same measurement with the green channel resolved -- four separated dyes, "
            "each channel's peaks cited, nothing flagged, and their schematic emission curves."
        ),
    ),
    dict(
        name="post-03-dataplan",
        hash="measurement",
        viewport=(1440, 1600),
        theme="light",
        actions=_seed(CLEAN_PANEL, seed_channels=False),
        scroll_to="#measurement-section-dataplan",
        caption="Every file named before it exists, from the finished design.",
    ),
    # --- The planner walk-through: brief -> proposals -> decisions -> chrome
    # -> naming -> review. All start from the shipped example study (the
    # OPP wound-healing study) via OPEN_EXAMPLE_JS, same as 01-03 above.
    dict(
        name="post-04-brief-typed",
        hash="describe",
        viewport=(1440, 900),
        theme="light",
        actions=[
            _js(SELECT_MEASUREMENT_JS, BRIEF_TARGET_MEASUREMENT),
            _js(TYPE_DESCRIPTION_JS, DEMO_DESCRIPTION_TEXT),
        ],
        scroll_to=None,
        caption="A study description typed in plain language, before anything is reviewed.",
    ),
    dict(
        name="post-05-brief-proposals",
        hash="describe",
        viewport=(1440, 1500),
        theme="light",
        actions=[
            _js(SELECT_MEASUREMENT_JS, BRIEF_TARGET_MEASUREMENT),
            _js(TYPE_DESCRIPTION_JS, DEMO_DESCRIPTION_TEXT),
            CLICK_REVIEW_DESCRIPTION_JS,
        ],
        scroll_to=".project-review",
        caption=(
            "The deterministic review: four suggestions, each with the exact words it matched "
            "and an explicit Accept -- nothing is written until a person says yes."
        ),
    ),
    dict(
        name="post-06-brief-accepted",
        hash="describe",
        viewport=(1440, 1500),
        theme="light",
        actions=[
            _js(SELECT_MEASUREMENT_JS, BRIEF_TARGET_MEASUREMENT),
            _js(TYPE_DESCRIPTION_JS, DEMO_DESCRIPTION_TEXT),
            CLICK_REVIEW_DESCRIPTION_JS,
            ACCEPT_FIRST_PROPOSAL_JS,
        ],
        scroll_to=".project-review",
        caption="A suggestion accepted -- its row now shows the confirmed value instead of a pending one.",
    ),
    dict(
        name="post-07-decisions",
        hash="overview",
        viewport=(1440, 1200),
        theme="light",
        actions=[_tag_by_heading_js("Decisions", "js-target-decisions")],
        scroll_to=".js-target-decisions",
        caption="Every open decision the planner can see, grouped and linked back to the step that owns it.",
    ),
    dict(
        name="post-08-chrome",
        hash="measurement",
        viewport=(1440, 500),
        theme="light",
        actions=[],
        scroll_to=None,
        caption="The app chrome: header, workflow compass, and the measurement switcher -- always in view while planning.",
    ),
    dict(
        name="post-09-review-verdict",
        hash="overview",
        viewport=(1440, 1000),
        theme="light",
        actions=[_tag_by_heading_js("Planner checks", "js-target-planner-checks")],
        scroll_to=".js-target-planner-checks",
        caption="One pass/fail verdict composed from every check the app runs.",
    ),
    dict(
        name="post-10-review-diagram",
        hash="overview",
        viewport=(1440, 900),
        theme="light",
        actions=[],
        # NOT ".study-map" -- overview.js gives that class to TWO different
        # sections (the textual "Study map" summary from
        # renderReviewExperimentMapSummary, and the actual SVG "Study
        # diagram" further down), and a plain class selector matches
        # whichever renders first, which is the text one. ".study-map-scroll"
        # is the SVG's own horizontal-scroll wrapper and unique to it.
        scroll_to=".study-map-scroll",
        caption="The whole study as a diagram, generated from the same data as everything else.",
    ),
]


def main() -> int:
    cs.SCREENS = POST_SCREENS
    # capture_screenshots.main() reads this module-level global when it builds
    # its argparse default, so reassigning it here is enough to redirect the
    # output -- an explicit --out-dir on the command line still wins.
    cs.DEFAULT_OUT_DIR = cs.REPO_ROOT / "docs" / "images" / "post"
    return cs.main()


if __name__ == "__main__":
    raise SystemExit(main())
