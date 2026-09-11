#!/usr/bin/env python3
"""Capture reference screenshots of the Micronaut Planner web app.

Stdlib only (no third-party imports, no npm/playwright): this project's dev
tooling is Python-stdlib-only by design (see CLAUDE.md), so this script
starts tools/serve_dir.py itself, drives a real Chromium binary in headless
mode purely through the Chrome DevTools Protocol (CDP) over a hand-rolled
WebSocket client (there is no `websockets`/`websocket-client` package
available), and writes PNGs into docs/images/.

Chromium's location is environment-specific. This script reads it from the
CHROME_BIN environment variable, falling back to the path Playwright's own
browser cache uses on this machine
(/opt/pw-browsers/chromium-1194/chrome-linux/chrome). If neither resolves to
an existing executable, it exits with a clear error rather than a cryptic
subprocess failure.

Usage:
    python3 tools/capture_screenshots.py [--out-dir docs/images] [--only home,study]

Add a new screen by adding one entry to the SCREENS table below -- nothing
else in this file needs to change.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# The CDP driver (WebSocket client, CDPSession, port/readiness helpers) lives
# in browser_cdp.py so tests/ can reuse the exact same stdlib-only primitives
# instead of a second hand-rolled implementation -- see that module's header.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser_cdp import (  # noqa: E402
    CDPSession,
    free_port,
    new_page_target,
    resolve_chrome_binary,
    wait_for_cdp,
    wait_for_http,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DEFAULT_OUT_DIR = REPO_ROOT / "docs" / "images"

# ---------------------------------------------------------------------------
# The screen list. One row per screenshot -- add a screen by adding a row.
#
#   name        output file stem -> docs/images/<name>.png
#   hash        the router hash to navigate to (e.g. "study" -> #/study)
#   viewport    (width, height) CSS pixels
#   theme       "light" or "dark" -- drives the real nav-theme-toggle button,
#               not just a CSS override, so it exercises the app's own switch
#   actions     extra JS snippets run (via Runtime.evaluate) after the route
#               has rendered and before the screenshot is taken -- used to
#               reveal state that requires a click (e.g. "Seed from markers
#               field" to populate the structured fluorophore-channel table)
#   scroll_to   optional CSS selector to scroll into view before capture.
#               The app's header and measurement switcher are sticky at the
#               top of the viewport, so scrolling an element to y=0 would
#               park it *behind* them; SCROLL_INTO_VIEW_JS measures that
#               pinned chrome and backs off by its height, which is why this
#               is a selector rather than a bare id (some targets, like the
#               Review screen's Controls block, have a class but no id).
#   caption     suggested one-line caption for docs/images/README.md
# ---------------------------------------------------------------------------
SEED_FROM_MARKERS_JS = """
(() => {
  const btn = Array.from(document.querySelectorAll('button.copy-button'))
    .find((b) => b.textContent.trim() === 'Seed from markers field');
  if (btn) btn.click();
  return Boolean(btn);
})()
"""

# scrollIntoView aligns the target to y=0, but .shell-header and the
# measurement switcher are sticky at the top and would then sit on top of it
# -- the captured shot loses exactly the section heading it was aimed at. So
# measure whatever is actually pinned to the top right now (rather than
# hard-coding a header height that silently rots when the chrome changes) and
# scroll back by it.
SCROLL_INTO_VIEW_JS = """
((selector) => {
  const target = document.querySelector(selector);
  if (!target) return false;
  const scroller = document.scrollingElement || document.documentElement;
  // Measure the pinned chrome before moving: it is sticky, so its height is
  // the same at any scroll offset, and reading it first keeps this one
  // deterministic measure-then-set rather than a scroll-then-correct dance
  // (which drifts when opening a <details> reflows the page underneath it).
  let pinnedBottom = 0;
  for (const node of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(node).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    const rect = node.getBoundingClientRect();
    // Real chrome, not a full-height overlay.
    if (rect.height <= 0 || rect.height > window.innerHeight / 2) continue;
    // The chrome is a STACK of sticky bars (header, study summary, the
    // measurement switcher), each pinned at its own `top:` offset below the
    // one above it -- so only the first has top ~0. Testing for top ~0 would
    // measure just that one and park the target behind all the rest, which is
    // the bug this comment exists to prevent a re-introduction of. Take the
    // lowest edge of anything pinned in the upper third instead.
    if (rect.top < -4 || rect.top > window.innerHeight / 3) continue;
    if (rect.bottom > pinnedBottom) pinnedBottom = rect.bottom;
  }
  const desiredTop = pinnedBottom + 12;
  const pageY = target.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, pageY - desiredTop);
  // Opening a <details> above the target reflows the page, so the position
  // measured a moment ago can already be stale. Re-measure and correct until
  // the target actually sits just below the chrome (a couple of passes is
  // always enough; the bound just stops a pathological loop).
  for (let i = 0; i < 5; i += 1) {
    const drift = target.getBoundingClientRect().top - desiredTop;
    if (Math.abs(drift) <= 2) break;
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, before + drift);
    if (scroller.scrollTop === before) break;  // already at a scroll limit
  }
  return true;
})(%s)
"""

SCREENS = [
    dict(
        name="01-study-map",
        hash="home",
        viewport=(1440, 900),
        theme="light",
        actions=[],
        scroll_to=None,
        caption="Study map -- the shipped example study's shape at a glance.",
    ),
    dict(
        name="02-research-brief",
        hash="describe",
        viewport=(1440, 900),
        theme="light",
        # The example study seeds structured fields (specimen, markers,
        # magnification, ...) but not this free-text narrative box, which is
        # a separate, genuinely-empty-by-default field for the app's own
        # deterministic free-text parser. Typing a sentence that only
        # restates facts already in the seeded "Bacterial viability" assay
        # (its real organism, marker, and magnification values -- see
        # web/src/core/defaultStudy.js's ASSAY_SEEDS) and clicking "Review
        # description" demonstrates that parser without inventing any new
        # scientific claim.
        actions=[
            """
            (() => {
              const ta = document.getElementById('project-description');
              if (!ta) return false;
              ta.value = 'Bacterial viability assay imaging Bacteria (P. aeruginosa, S. aureus) '
                + 'stained with SYTO9-PROPIDIUM IODIDE at X40 magnification, confocal modality.';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              const btn = document.querySelector('button.project-review-button');
              if (btn) btn.click();
              return true;
            })()
            """
        ],
        scroll_to=None,
        caption="Research brief -- the study narrative, plus the deterministic free-text parser suggesting structured fields from a description.",
    ),
    dict(
        name="03-measurements-registry",
        hash="study",
        viewport=(1440, 900),
        theme="light",
        actions=[],
        scroll_to=None,
        caption="Measurements registry -- every measurement in the example study, searchable and filterable.",
    ),
    dict(
        name="04-measurement-acquisition",
        hash="measurement",
        viewport=(1440, 2500),
        theme="light",
        actions=[
            # Fluorophores/spillover, Spectral view and Panel assembly are
            # <details> accordions, closed by default (panel.js's
            # createMicroscopySection) -- open them before seeding channels
            # so the structured fluorophore table and spectral plot are
            # actually visible rather than collapsed off-screen.
            """
            (() => {
              document.querySelectorAll('details.microscopy-section').forEach((d) => { d.open = true; });
              return true;
            })()
            """,
            SEED_FROM_MARKERS_JS,
        ],
        scroll_to="#measurement-section-acquisition",
        caption="Measurement -- Acquisition panel with fluorophore channels seeded from the markers field, and the spectral overlap view.",
    ),
    dict(
        name="05-overview-review",
        hash="overview",
        viewport=(1440, 1400),
        theme="light",
        actions=[],
        scroll_to=None,
        caption="Review -- the whole study's readiness, its diagram, and its exports in one screen.",
    ),
    dict(
        name="06-guide",
        hash="guide",
        viewport=(1440, 900),
        theme="light",
        actions=[],
        scroll_to=None,
        caption="Guide -- searchable in-app reference for every term and step.",
    ),
    dict(
        name="07-overview-dark",
        hash="overview",
        viewport=(1440, 1400),
        theme="dark",
        actions=[],
        scroll_to=None,
        caption="Review screen in dark theme.",
    ),
    # 08-10 back the user manual's chapters that had no screenshot of their
    # own (web/manual/conditions-controls.html, validation-naming.html and
    # saving-privacy.html). Nothing here is manual-specific -- they are just
    # the three app screens those chapters describe.
    dict(
        name="08-measurement-design",
        hash="measurement",
        viewport=(1440, 1800),
        theme="light",
        actions=[],
        scroll_to="#measurement-section-design",
        caption="Measurement -- Samples & design: the comparison groups, the conditions derived from them, and the controls the planner suggests with its reason for each.",
    ),
    dict(
        name="09-measurement-dataplan",
        hash="measurement",
        viewport=(1440, 1800),
        theme="light",
        actions=[],
        scroll_to="#measurement-section-dataplan",
        caption="Measurement -- Data plan: the filename convention, its generated preview names, and the planner checks that guard them.",
    ),
    dict(
        name="10-settings-storage",
        hash="settings",
        viewport=(1440, 900),
        theme="light",
        actions=[],
        scroll_to=None,
        caption="Settings -- project backup download/import and the storage controls that manage locally saved versions.",
    ),
    dict(
        # The controls the planner suggests are rendered on Review, not in the
        # measurement's own design section (overview.js's renderControlsNode),
        # so the manual's Conditions/Groups/Controls chapter needs this second
        # shot to show the controls half of its own subject.
        name="11-overview-controls",
        hash="overview",
        viewport=(1440, 1100),
        theme="light",
        actions=[
            # Each measurement's Review entry is a <details class="overview-assay">
            # collapsed by default, and the Controls block lives inside one --
            # without this it is display:none and there is nothing to scroll to.
            """
            (() => {
              document.querySelectorAll('details.overview-assay').forEach((d) => { d.open = true; });
              return true;
            })()
            """
        ],
        scroll_to=".overview-controls",
        caption="Review -- the controls the planner suggests for a measurement, split into panel-derived and readout-specific, each with the reason it is suggested.",
    ),
]

OPEN_EXAMPLE_JS = """
(() => {
  const btn = Array.from(document.querySelectorAll('button.home-skip-link'))
    .find((b) => b.textContent.includes('Open the example study'));
  if (btn) btn.click();
  return Boolean(btn);
})()
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture reference screenshots of the Micronaut Planner into docs/images/.",
    )
    parser.add_argument(
        "--out-dir", default=str(DEFAULT_OUT_DIR), help="Directory to write PNGs into (default: docs/images)"
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Comma-separated screen name(s) to capture (default: all screens in the SCREENS table)",
    )
    parser.add_argument("--port", type=int, default=0, help="Static-file server port (default: pick a free port)")
    parser.add_argument(
        "--devtools-port", type=int, default=0, help="Chromium DevTools port (default: pick a free port)"
    )
    parser.add_argument("--keep-open", action="store_true", help="Leave the server/browser running on exit (debug)")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(s.strip() for s in args.only.split(",")) if args.only else None
    screens = [s for s in SCREENS if only is None or s["name"] in only]
    if not screens:
        print("Nothing to capture (--only matched no screen names).", file=sys.stderr)
        return 1

    chrome_bin = resolve_chrome_binary()

    http_port = args.port or free_port()
    devtools_port = args.devtools_port or free_port()

    env = dict(os.environ)
    env["PORT"] = str(http_port)
    server_proc = subprocess.Popen(
        [sys.executable, str(REPO_ROOT / "tools" / "serve_dir.py"), str(WEB_DIR)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    user_data_dir = out_dir.parent / ".chrome-capture-profile"
    import shutil

    if user_data_dir.exists():
        shutil.rmtree(user_data_dir, ignore_errors=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    chrome_proc = None
    session = None
    try:
        base_url = f"http://127.0.0.1:{http_port}"
        wait_for_http(base_url + "/index.html")

        chrome_proc = subprocess.Popen(
            [
                chrome_bin,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--hide-scrollbars",
                "--disable-extensions",
                "--disable-background-networking",
                f"--remote-debugging-port={devtools_port}",
                "--remote-debugging-address=127.0.0.1",
                f"--user-data-dir={user_data_dir}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_cdp(devtools_port)
        ws_url = new_page_target(devtools_port)
        session = CDPSession(ws_url)
        session.call("Page.enable")
        session.call("Runtime.enable")
        session.call("DOM.enable")

        def goto(hash_: str, wait_ms: int = 600):
            session.call("Page.navigate", {"url": f"{base_url}/index.html#/{hash_}"})
            # Poll for the app root to have rendered something rather than a
            # fixed sleep alone -- first paint after a full navigation can be
            # slower than an in-page hash change.
            deadline = time.time() + 10
            while time.time() < deadline:
                ready = session.evaluate(
                    "document.getElementById('app') && document.getElementById('app').children.length > 0"
                )
                if ready:
                    break
                time.sleep(0.1)
            time.sleep(wait_ms / 1000)

        def hash_nav(hash_: str, wait_ms: int = 500):
            session.evaluate(f"location.hash = '#/{hash_}'")
            time.sleep(wait_ms / 1000)

        # Initial load: land on Study map, then explicitly ask for the
        # shipped example study via its own "Open the example study" link
        # (ui/steps/home.js) rather than hand-rolling a localStorage payload
        # -- this exercises the app's real load path and guarantees the
        # content is the app's own example data, not fabricated captions.
        goto("home", wait_ms=800)
        opened = session.evaluate(OPEN_EXAMPLE_JS)
        if not opened:
            raise RuntimeError("Could not find the 'Open the example study' button on Study map.")
        # Let the confirmation toast ("Opened the example study...") finish
        # its own ~3s auto-dismiss before any screenshot, rather than
        # capturing it mid-fade over real content.
        time.sleep(3.5)

        current_theme = "light"

        def set_theme(theme: str):
            nonlocal current_theme
            if theme == current_theme:
                return
            session.evaluate(
                "document.querySelector('button.nav-theme-toggle') "
                "&& document.querySelector('button.nav-theme-toggle').click()"
            )
            time.sleep(0.2)
            actual = session.evaluate("document.documentElement.getAttribute('data-theme')")
            if actual != theme:
                # One more toggle covers the 'system' starting point resolving
                # to the theme we didn't want on the first click.
                session.evaluate(
                    "document.querySelector('button.nav-theme-toggle') "
                    "&& document.querySelector('button.nav-theme-toggle').click()"
                )
                time.sleep(0.2)
            current_theme = theme

        results = []
        for screen in screens:
            width, height = screen["viewport"]
            session.call(
                "Emulation.setDeviceMetricsOverride",
                {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False},
            )
            hash_nav(screen["hash"], wait_ms=500)
            # This is a single-page app: switching routes is an in-page hash
            # change, not a real navigation, so the previous screen's scroll
            # position (e.g. scrolled deep into Acquisition) otherwise
            # carries over verbatim into the next screen's screenshot.
            session.evaluate("window.scrollTo(0, 0)")
            set_theme(screen["theme"])
            for action_js in screen["actions"]:
                session.evaluate(action_js)
                time.sleep(0.3)
            if screen["scroll_to"]:
                scroll_js = SCROLL_INTO_VIEW_JS % json.dumps(screen["scroll_to"])
                # Run it, let the page settle, then run it again: expanding a
                # section pushes content around for a beat after the scroll, so
                # a single pass lands the target and then drifts out of frame.
                # The scroll is idempotent, so the second pass is a no-op when
                # nothing moved and a correction when it did.
                for _ in range(2):
                    scrolled = session.evaluate(scroll_js)
                    if not scrolled:
                        raise RuntimeError(
                            f"{screen['name']}: scroll_to selector {screen['scroll_to']!r} matched nothing"
                        )
                    time.sleep(0.4)
            # Let any chart/canvas redraw settle after scroll/theme/DOM churn.
            time.sleep(0.3)
            # Deliberately NOT passing captureBeyondViewport+clip: that pair
            # captures in absolute page coordinates from (0,0) regardless of
            # current scroll position, which silently ignored every
            # scroll_to below. A plain capture (no clip) shoots exactly the
            # current viewport at the current scroll offset instead.
            shot = session.call("Page.captureScreenshot", {"format": "png"})
            png_bytes = base64.b64decode(shot["data"])
            out_path = out_dir / f"{screen['name']}.png"
            out_path.write_bytes(png_bytes)
            results.append((screen["name"], out_path, len(png_bytes)))
            print(f"wrote {out_path} ({len(png_bytes)} bytes)")

        return 0
    finally:
        if not args.keep_open:
            if session is not None:
                try:
                    session.close()
                except Exception:  # noqa: BLE001
                    pass
            if chrome_proc is not None:
                chrome_proc.terminate()
                try:
                    chrome_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    chrome_proc.kill()
            server_proc.terminate()
            try:
                server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server_proc.kill()
            shutil.rmtree(user_data_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
