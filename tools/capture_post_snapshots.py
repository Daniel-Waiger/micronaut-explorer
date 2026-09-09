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
