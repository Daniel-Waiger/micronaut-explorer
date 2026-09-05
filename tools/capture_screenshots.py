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
import http.client
import json
import os
import random
import selectors
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DEFAULT_OUT_DIR = REPO_ROOT / "docs" / "images"
DEFAULT_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

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
#   scroll_to   optional element id to scroll into view before capture
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
        scroll_to="measurement-section-acquisition",
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
]

OPEN_EXAMPLE_JS = """
(() => {
  const btn = Array.from(document.querySelectorAll('button.home-skip-link'))
    .find((b) => b.textContent.includes('Open the example study'));
  if (btn) btn.click();
  return Boolean(btn);
})()
"""


# ---------------------------------------------------------------------------
# Minimal CDP WebSocket client (RFC 6455), stdlib-only.
# ---------------------------------------------------------------------------
class WebSocketClient:
    def __init__(self, url: str, timeout: float = 30.0):
        proto, rest = url.split("://", 1)
        assert proto == "ws", f"only ws:// supported, got {url!r}"
        host_port, _, path = rest.partition("/")
        path = "/" + path
        if ":" in host_port:
            host, port_s = host_port.split(":", 1)
            port = int(port_s)
        else:
            host, port = host_port, 80
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self.sock.sendall(req.encode())
        # Read the HTTP handshake response, up to the blank line.
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WebSocket handshake closed early")
            buf += chunk
        head, _, rest = buf.partition(b"\r\n\r\n")
        status_line = head.split(b"\r\n", 1)[0]
        if b"101" not in status_line:
            raise ConnectionError(f"WebSocket handshake failed: {status_line!r}")
        self._leftover = rest  # any frame bytes that arrived with the handshake

    def _recv_exact(self, n: int) -> bytes:
        chunks = [self._leftover]
        have = len(self._leftover)
        self._leftover = b""
        while have < n:
            chunk = self.sock.recv(max(65536, n - have))
            if not chunk:
                raise ConnectionError("WebSocket connection closed")
            chunks.append(chunk)
            have += len(chunk)
        data = b"".join(chunks)
        if have > n:
            self._leftover = data[n:]
            data = data[:n]
        return data

    def send_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        length = len(payload)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        header = bytearray()
        header.append(0x80 | 0x1)  # FIN + text opcode
        if length < 126:
            header.append(0x80 | length)
        elif length < (1 << 16):
            header.append(0x80 | 126)
            header += struct.pack("!H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack("!Q", length)
        header += mask
        self.sock.sendall(bytes(header) + masked)

    def recv_message(self) -> str:
        """Read one complete (possibly fragmented) text message."""
        parts = []
        while True:
            first2 = self._recv_exact(2)
            b0, b1 = first2[0], first2[1]
            fin = bool(b0 & 0x80)
            opcode = b0 & 0x0F
            masked = bool(b1 & 0x80)
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._recv_exact(8))[0]
            mask_key = self._recv_exact(4) if masked else b""
            data = self._recv_exact(length)
            if masked:
                data = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
            if opcode == 0x9:  # ping -> pong
                self._send_pong(data)
                continue
            if opcode in (0x1, 0x2, 0x0):
                parts.append(data)
            if fin:
                break
        return b"".join(parts).decode("utf-8")

    def _send_pong(self, data: bytes) -> None:
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        header = bytearray([0x80 | 0xA, 0x80 | len(data)])
        header += mask
        self.sock.sendall(bytes(header) + masked)

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class CDPSession:
    """One page target's CDP connection, with a blocking call() over the
    hand-rolled WebSocket client above -- enough of the protocol for
    navigation, JS evaluation, and screenshotting; nothing else."""

    def __init__(self, ws_url: str):
        self.ws = WebSocketClient(ws_url)
        self._next_id = 1
        self._pending_events = []

    def call(self, method: str, params: dict | None = None, timeout: float = 20.0) -> dict:
        msg_id = self._next_id
        self._next_id += 1
        self.ws.send_text(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = self.ws.recv_message()
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(f"CDP {method} failed: {msg['error']}")
                return msg.get("result", {})
            # Not our response -- an event fired concurrently; stash it in
            # case a caller wants to poll for it, then keep waiting for ours.
            self._pending_events.append(msg)
        raise TimeoutError(f"CDP {method} timed out after {timeout}s")

    def evaluate(self, expression: str, await_promise: bool = False):
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": await_promise},
        )
        exc = result.get("exceptionDetails")
        if exc:
            raise RuntimeError(f"Runtime.evaluate threw: {exc}")
        return result.get("result", {}).get("value")

    def close(self) -> None:
        self.ws.close()


def wait_for_http(url: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if resp.status == 200:
                    return
        except Exception as err:  # noqa: BLE001 - retry until the deadline
            last_err = err
        time.sleep(0.2)
    raise RuntimeError(f"Server never answered {url}: {last_err}")


def wait_for_cdp(port: int, timeout: float = 20.0) -> str:
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1.5)
            conn.request("GET", "/json/version")
            resp = conn.getresponse()
            body = json.loads(resp.read())
            conn.close()
            return body["webSocketDebuggerUrl"]
        except Exception as err:  # noqa: BLE001
            last_err = err
            time.sleep(0.2)
    raise RuntimeError(f"Chromium DevTools endpoint never came up on port {port}: {last_err}")


def new_page_target(devtools_port: int) -> str:
    conn = http.client.HTTPConnection("127.0.0.1", devtools_port, timeout=5)
    conn.request("PUT", "/json/new?about:blank")
    resp = conn.getresponse()
    body = json.loads(resp.read())
    conn.close()
    return body["webSocketDebuggerUrl"]


def resolve_chrome_binary() -> str:
    candidate = os.environ.get("CHROME_BIN", DEFAULT_CHROME)
    if not os.path.isfile(candidate) or not os.access(candidate, os.X_OK):
        raise SystemExit(
            "Could not find an executable Chromium binary.\n"
            f"  Tried: {candidate}\n"
            "Set the CHROME_BIN environment variable to a headless-capable Chromium/Chrome "
            "executable (e.g. CHROME_BIN=/path/to/chrome python3 tools/capture_screenshots.py)."
        )
    return candidate


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

    def free_port() -> int:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

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
                session.evaluate(
                    f"document.getElementById('{screen['scroll_to']}')?.scrollIntoView({{block:'start'}})"
                )
                time.sleep(0.3)
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
