"""tools/browser_cdp.py, exercised with no browser and no network.

Two things this file is deliberately narrow about:

1. find_chrome()'s search order. AUD-19's conftest.py fixtures call
   find_chrome() to decide whether to SKIP the e2e suite (no Chrome on this
   machine) or run it -- so its candidate order has to be provable without
   depending on what happens to be installed here. Every filesystem check is
   monkeypatched; nothing in this file asserts a real path exists.
2. The hand-rolled WebSocket frame encoder/decoder (RFC 6455) round-trips,
   including a payload that crosses the 126-byte extended-length boundary --
   that boundary (1-byte length switching to a 2-byte extended length) is
   exactly where hand-rolled framing usually breaks. A connected
   socket.socketpair() stands in for the real Chrome<->script connection so
   this needs no live process, following this repo's stdlib-only rule.
"""

from __future__ import annotations

import importlib.util
import os
import socket
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BROWSER_CDP_PATH = ROOT / "tools" / "browser_cdp.py"

_spec = importlib.util.spec_from_file_location("browser_cdp", BROWSER_CDP_PATH)
browser_cdp = importlib.util.module_from_spec(_spec)
sys.modules["browser_cdp"] = browser_cdp
_spec.loader.exec_module(browser_cdp)

find_chrome = browser_cdp.find_chrome
WebSocketClient = browser_cdp.WebSocketClient


# ---------------------------------------------------------------------------
# find_chrome() candidate ordering
# ---------------------------------------------------------------------------
def _make_executable(path: Path) -> str:
    path.write_bytes(b"")
    os.chmod(path, 0o755)  # no-op on Windows; required for os.access(X_OK) on POSIX
    return str(path)


def test_find_chrome_prefers_chrome_bin_over_a_resolvable_path_binary(monkeypatch, tmp_path) -> None:
    chrome_bin = _make_executable(tmp_path / "chrome-bin-fake")
    path_binary = _make_executable(tmp_path / "path-provided-fake")
    monkeypatch.setenv("CHROME_BIN", chrome_bin)
    # Even though a PATH lookup would ALSO resolve to a valid executable,
    # CHROME_BIN must still win -- it is tried first.
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: path_binary)
    assert find_chrome() == chrome_bin


def test_find_chrome_falls_through_when_chrome_bin_does_not_resolve(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("CHROME_BIN", str(tmp_path / "does-not-exist"))
    path_binary = _make_executable(tmp_path / "chromium-fake")
    which_calls = []

    def fake_which(name: str):
        which_calls.append(name)
        return path_binary if name == "chromium" else None

    monkeypatch.setattr(browser_cdp.shutil, "which", fake_which)
    assert find_chrome() == path_binary
    # Earlier PATH names (google-chrome, google-chrome-stable) must have been
    # tried and rejected before "chromium" resolved -- proves the fallthrough
    # walks the list in order rather than stopping/short-circuiting on the
    # first name.
    assert which_calls[:2] == ["google-chrome", "google-chrome-stable"]


@pytest.mark.skipif(sys.platform.startswith("win"), reason="POSIX execute-bit semantics only")
def test_find_chrome_falls_through_when_chrome_bin_exists_but_is_not_executable(monkeypatch, tmp_path) -> None:
    non_exec = tmp_path / "chrome-bin-not-executable"
    non_exec.write_bytes(b"")
    os.chmod(non_exec, 0o644)
    monkeypatch.setenv("CHROME_BIN", str(non_exec))
    path_binary = _make_executable(tmp_path / "google-chrome-fake")
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: path_binary if name == "google-chrome" else None)
    assert find_chrome() == path_binary


def test_find_chrome_returns_none_when_nothing_resolves(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("CHROME_BIN", raising=False)
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: None)
    # Force the platform-neutral branch so a real Chrome install under
    # /Applications or %ProgramFiles% on the machine running this test can't
    # accidentally make it pass.
    monkeypatch.setattr(browser_cdp.sys, "platform", "linux")
    monkeypatch.setattr(browser_cdp, "DEFAULT_CHROME", str(tmp_path / "no-chrome-here"))
    assert find_chrome() is None


def test_find_chrome_checks_windows_install_paths_in_order(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("CHROME_BIN", raising=False)
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: None)
    monkeypatch.setattr(browser_cdp.sys, "platform", "win32")
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "pf"))
    monkeypatch.setenv("ProgramFiles(x86)", str(tmp_path / "pf86"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "lad"))
    monkeypatch.setattr(browser_cdp, "DEFAULT_CHROME", str(tmp_path / "fallback-unused"))

    # Only the %LOCALAPPDATA% candidate (checked last of the three Windows
    # paths) actually exists -- proves find_chrome tries ProgramFiles and
    # ProgramFiles(x86) FIRST and does not stop at the first Windows
    # candidate that happens to be a dict entry rather than a real file.
    local_app_data_chrome = tmp_path / "lad" / "Google" / "Chrome" / "Application" / "chrome.exe"
    local_app_data_chrome.parent.mkdir(parents=True)
    local_app_data_chrome.write_bytes(b"")
    os.chmod(local_app_data_chrome, 0o755)

    assert find_chrome() == str(local_app_data_chrome)


def test_find_chrome_checks_macos_install_path(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("CHROME_BIN", raising=False)
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: None)
    monkeypatch.setattr(browser_cdp.sys, "platform", "darwin")
    monkeypatch.setattr(browser_cdp, "DEFAULT_CHROME", str(tmp_path / "fallback-unused"))

    mac_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    real_isfile = browser_cdp.os.path.isfile
    real_access = browser_cdp.os.access
    # Stand in for the one path we can't actually create in a test sandbox
    # (no write access to /Applications); every other path still goes
    # through the real filesystem checks, so this only fakes the one thing
    # that must be faked.
    monkeypatch.setattr(browser_cdp.os.path, "isfile", lambda p: True if p == mac_path else real_isfile(p))
    monkeypatch.setattr(browser_cdp.os, "access", lambda p, mode: True if p == mac_path else real_access(p, mode))

    assert find_chrome() == mac_path


def test_find_chrome_falls_back_to_default_chrome_last(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("CHROME_BIN", raising=False)
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: None)
    monkeypatch.setattr(browser_cdp.sys, "platform", "linux")
    fallback = _make_executable(tmp_path / "playwright-cache-chrome")
    monkeypatch.setattr(browser_cdp, "DEFAULT_CHROME", fallback)
    assert find_chrome() == fallback


def test_resolve_chrome_binary_raises_systemexit_when_nothing_resolves(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("CHROME_BIN", raising=False)
    monkeypatch.setattr(browser_cdp.shutil, "which", lambda name: None)
    monkeypatch.setattr(browser_cdp.sys, "platform", "linux")
    monkeypatch.setattr(browser_cdp, "DEFAULT_CHROME", str(tmp_path / "no-chrome-here"))
    with pytest.raises(SystemExit):
        browser_cdp.resolve_chrome_binary()


# ---------------------------------------------------------------------------
# WebSocket frame encoder / decoder round-trip (RFC 6455)
#
# A connected socket.socketpair() plays both ends of the connection so this
# needs no real network I/O or Chrome process -- one end is wrapped in
# WebSocketClient (bypassing its __init__, which performs the HTTP Upgrade
# handshake we are not testing here), the other is driven directly to send
# and receive raw frame bytes.
# ---------------------------------------------------------------------------
def _socketpair() -> tuple[socket.socket, socket.socket]:
    a, b = socket.socketpair()
    # A short timeout turns "wrote more than the OS socket buffer holds
    # before anyone read it" into a fast, legible failure instead of a
    # hung test process.
    a.settimeout(5)
    b.settimeout(5)
    return a, b


def _client_with_raw_socket(sock: socket.socket):
    client = WebSocketClient.__new__(WebSocketClient)
    client.sock = sock
    client._leftover = b""
    return client


def _read_raw_client_frame(sock: socket.socket) -> tuple[int, bytes]:
    """Parse one frame written by WebSocketClient.send_text -- a real client
    frame, which RFC 6455 requires to be masked."""
    first2 = sock.recv(2)
    b0, b1 = first2[0], first2[1]
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length = b1 & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    assert masked, "RFC 6455 requires client->server frames to be masked"
    mask_key = sock.recv(4)
    data = b""
    while len(data) < length:
        data += sock.recv(length - len(data))
    payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
    return opcode, payload


def _write_raw_server_frame(sock: socket.socket, payload: bytes, opcode: int = 0x1, fin: bool = True) -> None:
    """Write one frame in the direction WebSocketClient.recv_message reads --
    a real server frame, which RFC 6455 requires to be UNMASKED."""
    header = bytearray()
    header.append((0x80 if fin else 0x00) | opcode)
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < (1 << 16):
        header.append(126)
        header += struct.pack("!H", length)
    else:
        header.append(127)
        header += struct.pack("!Q", length)
    sock.sendall(bytes(header) + payload)


@pytest.mark.parametrize(
    "size",
    [0, 1, 125, 126, 127, 500, 65535, 65536, 70000],
    ids=["empty", "one-byte", "125-max-short", "126-boundary", "127-just-over", "500", "16bit-max", "16bit-over", "70k"],
)
def test_send_text_encodes_a_frame_the_peer_can_decode(size: int) -> None:
    a, b = _socketpair()
    try:
        client = _client_with_raw_socket(a)
        text = "x" * size
        client.send_text(text)
        opcode, payload = _read_raw_client_frame(b)
        assert opcode == 0x1  # text frame
        assert payload.decode("utf-8") == text
    finally:
        a.close()
        b.close()


@pytest.mark.parametrize(
    "size",
    [0, 1, 125, 126, 127, 500, 65535, 65536],
    ids=["empty", "one-byte", "125-max-short", "126-boundary", "127-just-over", "500", "16bit-max", "16bit-over"],
)
def test_recv_message_decodes_a_frame_the_peer_sent(size: int) -> None:
    a, b = _socketpair()
    try:
        client = _client_with_raw_socket(a)
        text = "y" * size
        _write_raw_server_frame(b, text.encode("utf-8"))
        assert client.recv_message() == text
    finally:
        a.close()
        b.close()


def test_recv_message_reassembles_a_fragmented_message(monkeypatch) -> None:
    a, b = _socketpair()
    try:
        client = _client_with_raw_socket(a)
        # A message that arrives in three fragments (fin=False, fin=False,
        # fin=True) must be concatenated in order, mirroring how a real CDP
        # payload larger than Chrome's own frame size would arrive.
        _write_raw_server_frame(b, b"one-", opcode=0x1, fin=False)
        _write_raw_server_frame(b, b"two-", opcode=0x0, fin=False)  # continuation
        _write_raw_server_frame(b, b"three", opcode=0x0, fin=True)  # continuation
        assert client.recv_message() == "one-two-three"
    finally:
        a.close()
        b.close()


def test_recv_message_answers_a_ping_with_a_masked_pong_and_skips_it_as_content() -> None:
    a, b = _socketpair()
    try:
        client = _client_with_raw_socket(a)
        _write_raw_server_frame(b, b"ping-payload", opcode=0x9)  # ping
        _write_raw_server_frame(b, b"hello", opcode=0x1)  # the real message
        # The ping must not surface as message content...
        assert client.recv_message() == "hello"
        # ...but the client must still have answered it, per RFC 6455.
        opcode, payload = _read_raw_client_frame(b)
        assert opcode == 0xA  # pong
        assert payload == b"ping-payload"
    finally:
        a.close()
        b.close()
