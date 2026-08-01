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
import os
import sys
from functools import partial


def main() -> None:
    directory = sys.argv[1] if len(sys.argv) > 1 else "."
    port = int(os.environ.get("PORT", "8000"))
    # ThreadingHTTPServer, not a plain socketserver.TCPServer -- SimpleHTTP-
    # RequestHandler serves HTTP/1.1 with keep-alive, so a single-threaded
    # server blocks accepting any NEW connection for as long as the browser
    # holds one open, which a real browser tab does by default. This is
    # exactly what python -m http.server itself uses internally since
    # Python 3.7, for the same reason.
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
