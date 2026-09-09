#!/usr/bin/env python3
"""Capture images of the two Micronaut Planner outputs that are never a
screen in the app: the bench card (downloaded as a .md file) and the LLM
prompt (written straight to the clipboard by "Copy prompt for your own
LLM"). Neither has an honest app screenshot -- so this renders the REAL
generated text (via tools/render_artifacts.mjs, which calls the app's own
engine modules -- nothing here is hand-typed or paraphrased) into a plain
local HTML page that says outright what it is, and photographs that.

Reuses tools/capture_screenshots.py's Chromium launch and CDP client, but
NOT its goto()/base_url plumbing -- these two pages are local files, not
routes in the served app, so they are opened by a plain file:// navigation.

Usage:
    node tools/render_artifacts.mjs <tmp-dir>          # produce the source text
    python3 tools/capture_artifact_images.py [--out-dir docs/images/post]
"""

from __future__ import annotations

import argparse
import html
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture_screenshots as cs  # noqa: E402

REPO_ROOT = cs.REPO_ROOT
DEFAULT_OUT_DIR = REPO_ROOT / "docs" / "images" / "post"

PAGE_CSS = """
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f5f2; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .banner {
    font-family: -apple-system, Segoe UI, sans-serif;
    background: #2b2118; color: #f3ead9; padding: 18px 28px;
    font-size: 15px; line-height: 1.5;
  }
  .banner b { color: #ffd699; }
  pre {
    margin: 0; padding: 28px; font-size: 14px; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word; color: #26231d;
  }
  .cut { color: #8a8477; font-style: italic; }
</style>
"""


def _page(title: str, banner_html: str, body_text: str, cut_note: str | None = None) -> str:
    body_html = html.escape(body_text)
    tail = f'\n<div class="cut">{html.escape(cut_note)}</div>' if cut_note else ""
    return (
        f"<title>{html.escape(title)}</title>{PAGE_CSS}"
        f'<div class="banner">{banner_html}</div>'
        f"<pre>{body_html}{tail}</pre>"
    )


def build_pages(artifacts_dir: Path, pages_dir: Path) -> None:
    pages_dir.mkdir(parents=True, exist_ok=True)

    bench_text = (artifacts_dir / "benchcard.md").read_text(encoding="utf-8")
    # Read the assay label back out of the card's own header ("# Measurement
    # bench card -- <label>") rather than hardcoding it a second time here --
    # a hardcoded copy is exactly what went stale the last time
    # render_artifacts.mjs's assay choice changed.
    first_line = bench_text.split("\n", 1)[0]
    bench_assay_label = first_line.split(" -- ", 1)[-1].strip() if " -- " in first_line else "the example study"
    (pages_dir / "benchcard.html").write_text(
        _page(
            "Bench card",
            "This is the <b>.md file</b> the “Download bench card” button saves — "
            f"not a screen inside the app. Generated for the example study's {html.escape(bench_assay_label)} "
            "measurement by the app's own render/benchcard.js.",
            bench_text,
        ),
        encoding="utf-8",
    )

    prompt_text = (artifacts_dir / "llmprompt.txt").read_text(encoding="utf-8")
    lines = prompt_text.split("\n")
    json_start = next(i for i, l in enumerate(lines) if l.startswith("--- STUDY PLAN"))
    decisions_start = next(i for i, l in enumerate(lines) if l.startswith("--- DECISIONS"))
    # Show the instruction preamble in full, a few lines of the JSON so its
    # shape is visible, then skip straight to the two sections a reader
    # actually wants to see -- the open decisions and the suggested
    # questions -- rather than the full ~21KB of structured data.
    head = "\n".join(lines[:json_start] + lines[json_start : json_start + 6])
    tail = "\n".join(lines[decisions_start:])
    cut_lines = decisions_start - (json_start + 6)
    curated = f"{head}\n...\n\n{tail}"
    (pages_dir / "llmprompt.html").write_text(
        _page(
            "LLM prompt",
            "This is the text the “Copy prompt for your own LLM” button puts on the "
            "<b>clipboard</b> — not a screen inside the app, and nothing here is sent "
            "anywhere by Micronaut. Generated for the example study by the app's own "
            "render/llmprompt.js.",
            curated,
            cut_note=f"[...{cut_lines} lines of the study's full JSON omitted for this image...]",
        ),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--keep-open", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    work_dir = REPO_ROOT / "docs" / "images" / ".artifact-render-tmp"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True)
    artifacts_dir = work_dir / "artifacts"
    pages_dir = work_dir / "pages"

    node_result = subprocess.run(
        [shutil.which("node") or "node", str(REPO_ROOT / "tools" / "render_artifacts.mjs"), str(artifacts_dir)],
        cwd=str(REPO_ROOT / "web"),
        capture_output=True,
        text=True,
    )
    print(node_result.stdout, end="")
    if node_result.returncode != 0:
        print(node_result.stderr, file=sys.stderr)
        return node_result.returncode

    build_pages(artifacts_dir, pages_dir)

    chrome_bin = cs.resolve_chrome_binary()

    def free_port() -> int:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    devtools_port = free_port()
    user_data_dir = work_dir / ".chrome-profile"
    user_data_dir.mkdir(parents=True, exist_ok=True)

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
    session = None
    try:
        cs.wait_for_cdp(devtools_port)
        session = cs.CDPSession(cs.new_page_target(devtools_port))
        session.call("Page.enable")
        session.call("Runtime.enable")

        shots = [
            ("post-11-benchcard", pages_dir / "benchcard.html", 1100, 850),
            ("post-12-llm-prompt", pages_dir / "llmprompt.html", 1100, 1130),
        ]
        for name, page_path, width, height in shots:
            session.call("Page.navigate", {"url": f"file://{page_path}"})
            deadline = time.time() + 10
            while time.time() < deadline:
                ready = session.evaluate("document.querySelector('pre') !== null")
                if ready:
                    break
                time.sleep(0.1)
            session.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
            time.sleep(0.2)
            shot = session.call("Page.captureScreenshot", {"format": "png"})
            import base64

            out_path = out_dir / f"{name}.png"
            out_path.write_bytes(base64.b64decode(shot["data"]))
            print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")

        return 0
    finally:
        if not args.keep_open:
            if session is not None:
                try:
                    session.close()
                except Exception:  # noqa: BLE001
                    pass
            chrome_proc.terminate()
            try:
                chrome_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome_proc.kill()
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
