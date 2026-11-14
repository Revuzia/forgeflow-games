# -*- coding: utf-8 -*-
"""
qa_server.py -- a static file server for the probes that survives a loaded box.

`python -m http.server` inherits socketserver's listen backlog of 5. The game's
boot requests its ~133-module graph in parallel; on a CPU-starved machine the
single accept loop falls behind, Windows RSTs every connection past the
backlog, and Chrome reports net::ERR_CONNECTION_REFUSED on module loads -- the
module graph never completes and the page sits at "initialising" forever
(observed 2026-09-30 by qa_worldact.py). Same handler, same directory
semantics, backlog 256, threaded, no-store caching so a re-run never serves a
stale module.

    python _harness/qa_server.py 8923            # serves the repo root
"""
import http.server
import os
import sys
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quiet
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
    allow_reuse_address = False


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8923
    root = Path(__file__).resolve().parents[3]
    os.chdir(str(root))
    with Server(("", port), Handler) as srv:
        srv.serve_forever()


if __name__ == "__main__":
    main()
