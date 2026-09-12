"""Serve a static directory on the port given by the PORT env var.

`python -m http.server <port>` takes its port as a positional CLI argument,
not an env var, which is what a dev-server harness that assigns ports
dynamically (autoPort) needs. This is a thin wrapper: same
SimpleHTTPRequestHandler behaviour as `python -m http.server`, just reading
PORT (default 8000) instead of requiring a hardcoded argument.

Usage: python tools/serve_dir.py <directory>
"""

from __future__ import annotations

import http.server
import json
import os
import sys
from functools import partial
from pathlib import Path


def _write_kb_dev_js(kb_dir: Path, out_path: Path) -> None:
    """Aggregate every `web/kb/*.json` by filename stem, the same shape and
    aggregation rule tools/build_single_file.py's `_load_kb` uses for the
    built artifact's embedded KB, and write it as a script assigning
    `globalThis.__MICRONAUT_KB__` -- the exact global main.js's loadAppKb()
    reads (see web/src/main.js, web/src/core/kb.js).
    """
    kb: dict = {}
    for f in sorted(kb_dir.glob("*.json")):
        key = f.stem
        kb[key] = json.loads(f.read_text(encoding="utf-8"))
    kb_json = json.dumps(kb, sort_keys=True, separators=(",", ":"))
    out_path.write_text(
        f"globalThis.__MICRONAUT_KB__ = {kb_json};\n", encoding="utf-8"
    )


def _regenerate_stale_kb_dev_js(directory: str) -> None:
    """When serving `web/` unbuilt, `web/kb.dev.js` (the dev-mode aggregate
    of every web/kb/*.json) is git-ignored generated output -- nothing else
    regenerates it, so a `web/kb/*.json` edit with no rebuild left the
    unbuilt page silently serving a stale KB (verified: a real session
    shipped `web/kb/spectra.json` with kb.dev.js never rebuilt, so every
    dev-mode Color panel row read 'spectrum not yet available' while the
    BUILT dist/index.html, which embeds the KB fresh at build time, was
    fine). This function regenerates it itself (stdlib-only, no separate
    export script) whenever it's missing or stale. Only fires for a
    directory literally named `web` -- `dist` has no `kb/` subdirectory to
    regenerate from and embeds its KB at build time instead.
    """
    web_dir = Path(directory).resolve()
    if web_dir.name != "web":
        return
    kb_dir = web_dir / "kb"
    kb_dev_js = web_dir / "kb.dev.js"
    if not kb_dir.is_dir():
        return
    newest_source = max((f.stat().st_mtime for f in kb_dir.glob("*.json")), default=0)
    if kb_dev_js.exists() and kb_dev_js.stat().st_mtime >= newest_source:
        return
    _write_kb_dev_js(kb_dir=kb_dir, out_path=kb_dev_js)
    print(f"[serve_dir] {kb_dev_js} was stale relative to {kb_dir}/*.json -- regenerated it.")


class _NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that tells the browser never to cache.

    SimpleHTTPRequestHandler sends Last-Modified and no Cache-Control, so a
    browser is free to reuse a previously-fetched ES module. For an unbundled
    dev page whose whole point is "edit a file, reload, see the change" that
    is actively harmful: a stale module in the graph produces errors that
    describe the OLD code (verified twice during the alpha-readiness pass --
    an "export not found" for a symbol that plainly existed on disk, sending
    the reader hunting a bug that was not there). The built artifact is a
    single self-contained file served by Pages, so nothing about production
    caching is affected by this.
    """

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        # Neither web/release-notes/images/ nor web/manual/images/ exists on
        # disk -- like tools/build_single_file.py does for dist/, both the
        # release-notes page's and the manual's screenshots are assembled
        # from docs/images/ instead of duplicated. The build step performs
        # that assembly for dist/, but this dev server has no build step, so
        # it maps each request path directly instead. Only fires when serving
        # a directory literally named `web` (mirroring
        # _regenerate_stale_kb_dev_js's guard) -- `dist` already has real
        # files on disk at these paths, and other directories have neither
        # page to serve at all.
        if Path(self.directory).resolve().name == "web":
            parsed = path.split("?", 1)[0].split("#", 1)[0]
            for prefix in ("/release-notes/images/", "/manual/images/"):
                if parsed.startswith(prefix):
                    name = parsed[len(prefix):]
                    if name and "/" not in name:
                        docs_image = Path(self.directory).resolve().parent / "docs" / "images" / name
                        if docs_image.is_file():
                            return str(docs_image)
                    break
        return super().translate_path(path)


def main() -> None:
    directory = sys.argv[1] if len(sys.argv) > 1 else "."
    _regenerate_stale_kb_dev_js(directory)
    port = int(os.environ.get("PORT", "8000"))
    # ThreadingHTTPServer, not a plain socketserver.TCPServer -- SimpleHTTP-
    # RequestHandler serves HTTP/1.1 with keep-alive, so a single-threaded
    # server blocks accepting any NEW connection for as long as the browser
    # holds one open, which a real browser tab does by default. This is
    # exactly what python -m http.server itself uses internally since
    # Python 3.7, for the same reason.
    handler = partial(_NoCacheHandler, directory=directory)
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
