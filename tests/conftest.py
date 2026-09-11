"""Session fixtures for the browser end-to-end suite (tests/test_e2e_flows.py).

Builds the single-file artifact into pytest's own tmp_path_factory directory
-- NEVER the shared dist/ tests/test_single_file_build.py already had to stop
racing (see that file's ROOT/"dist" fix, landed alongside this file) -- serves
it with tools/serve_dir.py on a free port, and drives one headless Chrome
process for the whole session over tools/browser_cdp.py's stdlib-only CDP
driver (AUD-18). Every test gets its own CDP target (browser tab) with the
app's storage cleared first, since a fresh tab in the SAME profile still
shares localStorage with whatever an earlier test in this session wrote to
the same origin.

SKIPS (never fails) the whole suite when find_chrome() finds nothing: CI's
ubuntu-latest runners ship Chrome, but a Windows dev box may not, and this
project is deliberately zero-install beyond `pip install pytest` -- there is
no playwright/puppeteer browser-download step to fall back on.
"""

from __future__ import annotations

import http.client
import importlib.util
import json as jsonlib
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "tools"

# Reuse the exact same stdlib-only CDP driver AUD-18 extracted out of
# tools/capture_screenshots.py, rather than a second hand-rolled client.
_cdp_spec = importlib.util.spec_from_file_location("browser_cdp", TOOLS_DIR / "browser_cdp.py")
browser_cdp = importlib.util.module_from_spec(_cdp_spec)
sys.modules["browser_cdp"] = browser_cdp
_cdp_spec.loader.exec_module(browser_cdp)

CDPSession = browser_cdp.CDPSession
Page = browser_cdp.Page
find_chrome = browser_cdp.find_chrome
free_port = browser_cdp.free_port
wait_for_cdp = browser_cdp.wait_for_cdp
wait_for_http = browser_cdp.wait_for_http

# tools/build_single_file.py's build(web_dir, out_dir) -- loaded via
# importlib the same way tests/test_single_file_build.py:13-17 already does,
# rather than a second copy of that loading dance.
_build_spec = importlib.util.spec_from_file_location(
    "build_single_file", TOOLS_DIR / "build_single_file.py"
)
build_single_file = importlib.util.module_from_spec(_build_spec)
sys.modules["build_single_file"] = build_single_file
_build_spec.loader.exec_module(build_single_file)


# Real Chrome flags this project already proved out in
# tools/capture_screenshots.py's own headless launch -- reused verbatim
# rather than a second, independently-tuned flag list.
CHROME_FLAGS = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--disable-extensions",
    "--disable-background-networking",
]


@pytest.fixture(scope="session")
def chrome_binary():
    """The Chrome/Chromium binary to drive: SKIP locally, FAIL under CI.

    find_chrome() (tools/browser_cdp.py) returns None -- never raises --
    specifically so this fixture can skip rather than fail on a contributor's
    machine with no Chrome installed. That is the right default: a missing
    browser should not block someone running the unit suites.

    Under CI it is the wrong default. An all-skipped pytest run still exits 0,
    so a runner image that stopped shipping Chrome would turn the one job
    whose entire purpose is driving a browser into a permanently green job
    that drives nothing -- and branch protection cannot tell that apart from a
    real pass. So when CI is set, a missing browser is a hard failure.
    """
    binary = find_chrome()
    if binary is None:
        message = (
            "No Chrome/Chromium binary found (checked CHROME_BIN, PATH, and "
            "per-OS install locations)."
        )
        if os.environ.get("CI", "").lower() in {"1", "true", "yes"}:
            pytest.fail(
                f"{message} Refusing to silently skip the browser e2e suite "
                "under CI -- a green run here must mean the flows actually ran.",
                pytrace=False,
            )
        pytest.skip(f"{message} -- skipping the browser e2e suite.")
    return binary


@pytest.fixture(scope="session")
def built_dist(tmp_path_factory):
    """Build the single-file artifact into a SESSION-scoped pytest tmp dir --
    never the shared dist/. Concurrent test runs on this Drive-synced volume
    have thrown PermissionError racing on dist/ twice already this session
    (see tests/test_single_file_build.py's own tmp_path convention, which
    this fixture and that file's two straggler tests now both follow)."""
    out_dir = tmp_path_factory.mktemp("e2e-dist")
    build_single_file.build(ROOT / "web", out_dir)
    return out_dir


@pytest.fixture(scope="session")
def base_url(chrome_binary, built_dist):  # noqa: ARG001 - chrome_binary orders the skip first
    """Serve the built artifact via tools/serve_dir.py: a positional
    directory argument plus a PORT env var -- there is no --dir/--port flag
    (some older plan docs claim otherwise; they are wrong)."""
    port = free_port()
    env = dict(os.environ)
    env["PORT"] = str(port)
    proc = subprocess.Popen(
        [sys.executable, str(TOOLS_DIR / "serve_dir.py"), str(built_dist)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        wait_for_http(url + "/index.html")
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture(scope="session")
def devtools_port(chrome_binary, tmp_path_factory):
    """One headless Chrome process for the whole test session, launched
    against a fresh --user-data-dir (never a real machine profile)."""
    port = free_port()
    user_data_dir = tmp_path_factory.mktemp("chrome-profile")
    proc = subprocess.Popen(
        [
            chrome_binary,
            *CHROME_FLAGS,
            f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1",
            f"--user-data-dir={user_data_dir}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_cdp(port)
        yield port
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture
def index_url(base_url):
    return base_url + "/index.html"


def _open_tab(devtools_port):
    """Like browser_cdp.new_page_target, but also keeps the target's own id
    so the fixture below can truly CLOSE the tab afterwards (see _close_tab).
    Duplicated here rather than widening new_page_target's return value,
    since tools/browser_cdp.py is shared, already-landed (AUD-18) code this
    task does not touch."""
    conn = http.client.HTTPConnection("127.0.0.1", devtools_port, timeout=5)
    conn.request("PUT", "/json/new?about:blank")
    resp = conn.getresponse()
    body = jsonlib.loads(resp.read())
    conn.close()
    return body["id"], body["webSocketDebuggerUrl"]


def _close_tab(devtools_port, target_id):
    """Actually terminate a tab's own JS execution via Chrome's HTTP
    devtools endpoint (GET /json/close/<id>), not merely disconnect our
    WebSocket. This matters: an app action a test took (e.g. opening the
    example) can leave a pending debounced autosave `setTimeout` running in
    that tab's page, and only closing our CDPSession leaves that timer alive
    in the background -- it still fires later and writes into this shared
    Chrome profile's localStorage, potentially AFTER a later test's own
    conftest-level clear_storage() has already run, silently reintroducing
    stale data into what that test expects to be a freshly-cleared origin.
    Real, reproduced flakiness this fixed: test_edit_then_start_blank_study
    intermittently found the Study map showing the recovered EXAMPLE study
    (fully answered, no research-question intake field to type into) instead
    of a fresh blank one, only when run as part of the full suite -- never in
    isolation -- which is the signature of exactly this kind of cross-test,
    timing-dependent leftover-tab write."""
    try:
        conn = http.client.HTTPConnection("127.0.0.1", devtools_port, timeout=5)
        conn.request("GET", f"/json/close/{target_id}")
        conn.getresponse().read()
        conn.close()
    except OSError:
        pass  # best-effort cleanup; a failure here must not fail the test


@pytest.fixture
def page(devtools_port, base_url):
    """One fresh CDP target (a new browser tab) per test, with this origin's
    storage cleared before the test body's own first navigation, and the tab
    itself actually closed afterwards (see _close_tab).

    A new tab in the same Chrome profile still shares localStorage with
    every earlier test that hit this origin, so clearing here (rather than
    only once per session) is what makes "fresh page + cleared storage" true
    per test rather than per session. The clear must happen while ON the
    app's origin -- storage is origin-scoped -- so this briefly visits the
    app, clears, then parks on about:blank; the test body's first goto() to
    index_url is therefore the first real navigation IT controls, which
    matters for the test that installs an addScriptToEvaluateOnNewDocument
    hook before its own navigation.
    """
    target_id, ws_url = _open_tab(devtools_port)
    session = CDPSession(ws_url)
    p = Page(session, base_url)
    p.goto(base_url + "/index.html")
    p.clear_storage()
    p.goto("about:blank", wait_for_app=False)
    yield p
    p.close()
    _close_tab(devtools_port, target_id)
