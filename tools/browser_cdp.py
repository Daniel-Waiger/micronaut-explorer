"""Stdlib-only Chrome DevTools Protocol (CDP) driver.

This project is Python-stdlib-only by design (see CLAUDE.md): no npm, no
node_modules, no playwright/puppeteer, no third-party pip packages. That
makes browser automation for this repo's tests a genuine constraint, not a
preference -- there is no `websockets`/`websocket-client` package available
either, so the WebSocket client below is hand-rolled against RFC 6455.

This module was factored out of tools/capture_screenshots.py, which proved
the approach works (it drives real headless Chrome purely over CDP to take
reference screenshots). Pulling the driver out from under that one script
lets tests/ reuse the exact same battle-tested primitives -- see
tests/conftest.py and tests/test_e2e_flows.py -- instead of maintaining a
second hand-rolled CDP client that could silently drift from this one.

`WebSocketClient` / `CDPSession` / `wait_for_http` / `wait_for_cdp` /
`new_page_target` / `free_port` are the low-level primitives capture_
screenshots.py already used, moved essentially verbatim. `Page` and
`find_chrome` are new: `Page` wraps a `CDPSession` with the small set of
verbs an end-to-end test actually needs (navigate, click, read text, poll,
manage storage, collect console errors); `find_chrome` generalizes what was
capture_screenshots.py's single-path `resolve_chrome_binary` into a search
that works across CI (Linux), and macOS/Windows dev machines, returning
None rather than exiting so a test suite can SKIP instead of failing on a
machine with no Chrome installed.
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import shutil
import socket
import struct
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Historical fallback: the path Playwright's own browser cache uses on the
# machine this script was first written against. Kept as the last resort so
# existing CI configs that rely on it (rather than setting CHROME_BIN) keep
# working unchanged.
DEFAULT_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

# App-specific readiness probe: index.html's <div id="app"> is empty until
# main.js's first render call appends into it, so "the document exists" is
# not the same signal as "the app has booted" -- and that gap is exactly
# what a white-screen boot crash needs a test to catch.
APP_READY_JS = "document.getElementById('app') && document.getElementById('app').children.length > 0"


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

    def drain_events(self, *methods: str) -> list[dict]:
        """Force any event frames Chrome has already queued to be read off
        the socket, then pop and return the ones matching `methods`.

        `call()` only reads a frame when it is blocked waiting on its own
        reply, stashing anything else in `_pending_events` along the way --
        there is no background reader thread. A cheap round-trip forces a
        read: WebSocket frames on one connection are FIFO, so any event
        Chrome already queued arrives before this call's own response.
        """
        self.call("Runtime.evaluate", {"expression": "1", "returnByValue": True})
        matched = [evt for evt in self._pending_events if evt.get("method") in methods]
        self._pending_events = [evt for evt in self._pending_events if evt.get("method") not in methods]
        return matched

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


def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def find_chrome() -> str | None:
    """Search for a headless-capable Chrome/Chromium binary, in order of
    specificity: an explicit override, well-known PATH names, per-OS install
    locations, then this project's historical hardcoded fallback. Returns
    None -- never raises -- so a caller (e.g. a test suite's fixtures) can
    SKIP on a machine with no Chrome rather than fail.
    """
    candidates: list[str] = []

    chrome_bin = os.environ.get("CHROME_BIN")
    if chrome_bin:
        candidates.append(chrome_bin)

    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            candidates.append(found)

    if sys.platform == "darwin":
        candidates.append("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    elif sys.platform.startswith("win"):
        for env_var in ("ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(env_var)
            if base:
                candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(os.path.join(local_app_data, "Google", "Chrome", "Application", "chrome.exe"))

    candidates.append(DEFAULT_CHROME)

    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def resolve_chrome_binary() -> str:
    """capture_screenshots.py's original contract: resolve or exit loudly
    with a message pointing at CHROME_BIN. Kept byte-identical on the
    failure path -- only find_chrome()'s search got wider, not this exit."""
    found = find_chrome()
    if found is not None:
        return found
    candidate = os.environ.get("CHROME_BIN", DEFAULT_CHROME)
    raise SystemExit(
        "Could not find an executable Chromium binary.\n"
        f"  Tried: {candidate}\n"
        "Set the CHROME_BIN environment variable to a headless-capable Chromium/Chrome "
        "executable (e.g. CHROME_BIN=/path/to/chrome python3 tools/capture_screenshots.py)."
    )


def _format_console_call(params: dict) -> str:
    args = params.get("args", [])
    parts = [str(a.get("value", a.get("description", a.get("type", "")))) for a in args]
    return "console.error: " + (" ".join(parts) if parts else "(no args)")


def _format_exception(params: dict) -> str:
    details = params.get("exceptionDetails", {})
    text = details.get("text")
    description = details.get("exception", {}).get("description")
    return "uncaught exception: " + (description or text or "(no detail)")


def _format_log_entry(params: dict) -> str:
    entry = params.get("entry", {})
    source = entry.get("source", "log")
    return f"{source} error: " + entry.get("text", "(no text)")


class Page:
    """A small verb set over a CDPSession, aimed at what an end-to-end test
    actually does: navigate, read/click DOM, poll for a condition, manage
    storage, and check whether the page logged anything to the console.

    Deliberately thin -- this is not a general browser-automation library,
    it is the surface tests/test_e2e_flows.py needs against this one app.
    """

    def __init__(self, session: CDPSession, base_url: str):
        self.session = session
        self.base_url = base_url.rstrip("/")
        self._console_errors: list[str] = []
        session.call("Page.enable")
        session.call("Runtime.enable")
        session.call("DOM.enable")
        session.call("Log.enable")

    # -- navigation -----------------------------------------------------
    def goto(self, url: str, wait_for_app: bool = True) -> None:
        self.session.call("Page.navigate", {"url": url})
        if wait_for_app:
            self.wait_for(APP_READY_JS)

    def hash_nav(self, route: str) -> None:
        # An in-page hash change, not a real navigation -- this is a
        # single-page app, so a full Page.navigate for every route would
        # exercise a different code path (the initial-load bootstrap) than
        # what real in-app navigation exercises.
        self.eval_js(f"location.hash = '#/{route}'")
        self.wait_for(APP_READY_JS)

    def reload(self, wait_for_app: bool = True) -> None:
        self.session.call("Page.reload", {})
        if wait_for_app:
            self.wait_for(APP_READY_JS)

    # -- JS / DOM ---------------------------------------------------------
    def eval_js(self, expr: str, await_promise: bool = False):
        return self.session.evaluate(expr, await_promise=await_promise)

    def click(self, selector: str) -> bool:
        clicked = self.eval_js(
            "(() => { const el = document.querySelector(%s); if (el) el.click(); return Boolean(el); })()"
            % json.dumps(selector)
        )
        return bool(clicked)

    def click_text(self, selector: str, needle: str) -> bool:
        # Generalizes capture_screenshots.py's OPEN_EXAMPLE_JS / SEED_FROM_
        # MARKERS_JS pattern: find the first element matching `selector`
        # whose text contains `needle`, click it, report whether one existed.
        clicked = self.eval_js(
            "(() => {"
            "  const btn = Array.from(document.querySelectorAll(%s))"
            "    .find((el) => el.textContent.includes(%s));"
            "  if (btn) btn.click();"
            "  return Boolean(btn);"
            "})()" % (json.dumps(selector), json.dumps(needle))
        )
        return bool(clicked)

    def text(self, selector: str) -> str | None:
        return self.eval_js(
            "(() => { const el = document.querySelector(%s); return el ? el.textContent.trim() : null; })()"
            % json.dumps(selector)
        )

    def texts(self, selector: str) -> list[str]:
        return self.eval_js(
            "Array.from(document.querySelectorAll(%s)).map((el) => el.textContent.trim())" % json.dumps(selector)
        )

    def exists(self, selector: str) -> bool:
        return bool(self.eval_js("Boolean(document.querySelector(%s))" % json.dumps(selector)))

    def wait_for(self, js_expr: str, timeout: float = 10.0, poll: float = 0.1) -> bool:
        """Poll `js_expr` until it is truthy. Raises TimeoutError rather than
        returning False -- a caller that forgets to check a boolean result
        is exactly how a broken page keeps getting silently interacted with
        (see cma-lessons.md lesson 20: a passing happy path proves nothing
        about an invariant a test never actually checked)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.eval_js(js_expr):
                return True
            time.sleep(poll)
        raise TimeoutError(f"condition never became true within {timeout}s: {js_expr}")

    # -- storage ----------------------------------------------------------
    def set_local_storage(self, key: str, value: str) -> None:
        self.eval_js("localStorage.setItem(%s, %s)" % (json.dumps(key), json.dumps(value)))

    def get_local_storage(self, key: str) -> str | None:
        return self.eval_js("localStorage.getItem(%s)" % json.dumps(key))

    def clear_storage(self) -> None:
        self.eval_js("localStorage.clear(); sessionStorage.clear();")

    # -- console errors -----------------------------------------------------
    def console_errors(self) -> list[str]:
        """Return every console error / uncaught exception / Log-domain
        error seen on this page so far (accumulated across calls -- this is
        meant to be asserted == [] once at the end of a test, not diffed
        call to call). This is the one genuinely new capability this module
        adds over capture_screenshots.py: a white-screen boot crash throws
        before anything the rest of this class inspects would show it."""
        events = self.session.drain_events(
            "Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"
        )
        for evt in events:
            method = evt.get("method")
            params = evt.get("params", {})
            if method == "Runtime.consoleAPICalled" and params.get("type") == "error":
                self._console_errors.append(_format_console_call(params))
            elif method == "Runtime.exceptionThrown":
                self._console_errors.append(_format_exception(params))
            elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
                self._console_errors.append(_format_log_entry(params))
        return list(self._console_errors)

    def close(self) -> None:
        self.session.close()
