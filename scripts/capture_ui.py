"""Capture per-field / per-section UI snapshots of the Micronaut Streamlit app.

Each PNG is cropped to a single widget or section so it can be embedded in the
user manual next to the corresponding instruction. Uses Playwright's element
screenshots (auto-cropped to one widget) with a bounding-box clip fallback for
composite sections.

Run with the project venv python while the app is live on :8510:
    <venv-python> scripts/capture_ui.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_URL = "http://localhost:8510"
REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "docs" / "images"

DEMO_DIR = Path(
    r"C:\Users\dwaig\AppData\Local\Temp\claude"
    r"\G--My-Drive-FACSI-Image-Analysis-github-desktop-repos-microscopy-naming-assistant"
    r"\ef192aa0-cc50-4e36-930a-224b2a722860\scratchpad\demo"
)
DEMO_IMAGES = str(DEMO_DIR / "images")
DEMO_CONFIG = str(DEMO_DIR / "naming_scheme.json")

results: list[tuple[str, str, int]] = []  # (filename, status, size_bytes)


def _record(path: Path, status: str) -> None:
    size = path.stat().st_size if path.exists() else 0
    results.append((path.name, status, size))
    print(f"[{status:7}] {path.name} ({size} bytes)")


def shot_widget(scope, testid: str, has_text: str, filename: str) -> bool:
    """Screenshot a single Streamlit widget matched by testid + label text."""
    out = OUT_DIR / filename
    try:
        loc = scope.locator(f'div[data-testid="{testid}"]').filter(has_text=has_text).first
        loc.scroll_into_view_if_needed(timeout=8000)
        loc.screenshot(path=str(out), timeout=8000)
        if out.exists() and out.stat().st_size > 2048:
            _record(out, "ok")
            return True
        # fallback: bounding box clip with padding
        return _shot_clip_from_locator(scope.page if hasattr(scope, "page") else page, loc, out)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! widget {filename} failed: {exc}")
        _record(out, "FAIL")
        return False


VIEWPORT_H = 1000


def _main_column(pg):
    """Viewport-relative bounding box of the main content column."""
    for sel in (
        'div[data-testid="stMainBlockContainer"]',
        'section[data-testid="stMain"] div.block-container',
        'section[data-testid="stMain"]',
    ):
        loc = pg.locator(sel).first
        if loc.count():
            box = loc.bounding_box()
            if box:
                return box
    return None


def _scroll_top(loc):
    """Scroll `loc` to the top of the (inner Streamlit) scroll container."""
    loc.evaluate("el => el.scrollIntoView({block: 'start', inline: 'nearest'})")


def _shot_clip_from_locator(pg, loc, out: Path, pad: int = 8, full_width: bool = False) -> bool:
    """Clip a single element within the viewport (no full_page — Streamlit reflows)."""
    try:
        _scroll_top(loc)
        pg.wait_for_timeout(400)
        box = loc.bounding_box()
        if not box:
            _record(out, "FAIL")
            return False
        x = max(box["x"] - pad, 0)
        width = box["width"] + 2 * pad
        if full_width:
            col = _main_column(pg)
            if col:
                x = max(col["x"] - pad, 0)
                width = col["width"] + 2 * pad
        y = max(box["y"] - pad, 0)
        height = min(box["y"] + box["height"] + pad, VIEWPORT_H) - y
        pg.screenshot(path=str(out), clip={"x": x, "y": y, "width": width, "height": height})
        _record(out, "ok" if out.stat().st_size > 2048 else "small")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! clip {out.name} failed: {exc}")
        _record(out, "FAIL")
        return False


def shot_section(pg, top_loc, bottom_loc, filename: str, pad: int = 12) -> bool:
    """Clip a full-column-width rectangle from top_loc's top to bottom_loc's bottom.

    Scrolls the top anchor to the top of the viewport, then measures both
    anchors viewport-relative and clips WITHOUT full_page (a full-page shot
    resizes the viewport, which makes the responsive Streamlit layout reflow
    and invalidates the coordinates). Sections shorter than the viewport are
    captured whole; anything taller is clamped to the viewport bottom.
    """
    out = OUT_DIR / filename
    try:
        _scroll_top(top_loc)
        pg.wait_for_timeout(500)
        tb = top_loc.bounding_box()
        bb = bottom_loc.bounding_box()
        if not tb or not bb:
            _record(out, "FAIL")
            return False
        col = _main_column(pg)
        x = max((col["x"] if col else min(tb["x"], bb["x"])) - pad, 0)
        if col:
            span = col["width"]
        else:
            span = max(tb["x"] + tb["width"], bb["x"] + bb["width"]) - min(tb["x"], bb["x"])
        width = span + 2 * pad
        y = max(tb["y"] - pad, 0)
        bottom = min(bb["y"] + bb["height"] + pad, VIEWPORT_H)
        pg.screenshot(path=str(out), clip={"x": x, "y": y, "width": width, "height": bottom - y})
        _record(out, "ok" if out.stat().st_size > 2048 else "small")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! section {filename} failed: {exc}")
        _record(out, "FAIL")
        return False


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    global page
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
        page = ctx.new_page()
        page.goto(APP_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)

        sidebar = page.locator('section[data-testid="stSidebar"]')

        # ---- Sidebar fields ----
        shot_widget(sidebar, "stTextInput", "Config path", "field-config-path.png")
        shot_widget(sidebar, "stTextInput", "Ollama endpoint", "field-ollama-endpoint.png")
        shot_widget(sidebar, "stNumberInput", "LLM timeout", "field-llm-timeout.png")
        shot_widget(sidebar, "stCheckbox", "Use Ollama suggestions", "field-use-ollama.png")
        shot_widget(sidebar, "stSelectbox", "LLM model", "field-llm-model.png")
        shot_widget(sidebar, "stTextInput", "Profile path", "field-profile-path.png")
        shot_widget(sidebar, "stCheckbox", "Strict validation", "field-strict-validation.png")
        shot_widget(sidebar, "stSelectbox", "Conflict strategy", "field-conflict-strategy.png")
        shot_widget(sidebar, "stTextInput", "Glob pattern", "field-glob-pattern.png")

        # ---- Main-area sections ----
        # Folder mode: from the subheader down to the Preview button.
        folder_head = page.get_by_text("Folder Mode (Preview + Apply)", exact=True).first
        preview_btn = page.get_by_role("button", name="Preview Renames").first
        shot_section(page, folder_head, preview_btn, "section-folder-mode.png")

        # Drag-and-drop uploader
        dd = (
            page.locator('div[data-testid="stFileUploader"]').filter(has_text="Drag-and-drop").first
        )
        if dd.count() == 0:
            dd = page.locator('div[data-testid="stFileUploader"]').first
        _shot_clip_from_locator(
            page, dd, OUT_DIR / "section-drag-drop.png", pad=10, full_width=True
        )

        # Rollback Manager: heading down through Run Rollback button
        rb_head = page.get_by_text("Rollback Manager", exact=True).first
        run_rollback = page.get_by_role("button", name="Run Rollback").first
        shot_section(page, rb_head, run_rollback, "section-rollback.png")

        # Profile wizard: expand then capture the form
        try:
            page.get_by_text("Create a validation profile").first.click()
            page.wait_for_timeout(800)
            wiz_head = page.get_by_text("Create a validation profile").first
            create_btn = page.get_by_role("button", name="Create profile").first
            shot_section(page, wiz_head, create_btn, "section-profile-wizard.png")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! profile wizard failed: {exc}")

        # ---- Preview-dependent: tag table + planned renames ----
        try:
            cfg = (
                page.locator('div[data-testid="stTextInput"]')
                .filter(has_text="Config path")
                .locator("input")
                .first
            )
            cfg.fill(DEMO_CONFIG)
            cfg.press("Enter")
            page.wait_for_timeout(1500)

            folder = (
                page.locator('div[data-testid="stTextInput"]')
                .filter(has_text="Input folder path")
                .locator("input")
                .first
            )
            folder.fill(DEMO_IMAGES)
            folder.press("Enter")
            page.wait_for_timeout(1000)

            page.get_by_role("button", name="Preview Renames").first.click()
            # Wait for the Tag Files heading to appear after the spinner clears.
            page.get_by_text("Tag Files", exact=True).first.wait_for(timeout=60000)
            page.wait_for_timeout(1500)

            tag_head = page.get_by_text("Tag Files", exact=True).first
            table = page.locator(
                'div[data-testid="stDataFrameResizable"], ' 'div[data-testid="stDataEditor"]'
            ).first
            if table.count() == 0:
                table = page.locator('div[data-testid="stDataEditor"]').first
            shot_section(page, tag_head, table, "section-tag-table.png")

            planned_head = page.get_by_text("Planned Renames", exact=True).first
            planned_head.scroll_into_view_if_needed(timeout=8000)
            planned_df = page.locator(
                'div[data-testid="stDataFrame"], ' 'div[data-testid="stDataFrameResizable"]'
            ).last
            shot_section(page, planned_head, planned_df, "section-planned-renames.png")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! preview / tag-table / planned-renames (best-effort) failed: {exc}")

        browser.close()

    print("\n=== SUMMARY ===")
    ok = [r for r in results if r[1] in ("ok", "small")]
    fail = [r for r in results if r[1] == "FAIL"]
    for name, status, size in results:
        print(f"  {status:7} {name:34} {size}")
    print(f"\n{len(ok)} captured, {len(fail)} failed, saved to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
