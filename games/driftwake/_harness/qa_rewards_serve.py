# -*- coding: utf-8 -*-
"""qa_rewards_serve.py -- an in-process static server for the lane-R probes.

Why not `python -m http.server`: its listen backlog is 5 and, on a machine
whose CPU is saturated, Chrome's parallel ES-module fetches overflow it; the
refused connection (net::ERR_CONNECTION_REFUSED) drops one module and the boot
hangs at INITIALISING with no page error. Measured 2026-09-30 on port 8924.
This server is threaded, has a 256-deep backlog, serves .js as JavaScript
regardless of the Windows registry, and lives in the probe's own process so
it can never outlive the run.

    from qa_rewards_serve import serve
    stop = serve(root, 8924)   # ... then stop()
"""
import contextlib
import functools
import http.server
import socket
import threading


class _Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
    address_family = socket.AF_INET6

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        return super().server_bind()


class _Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{
        ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
        ".wasm": "application/wasm", ".glb": "model/gltf-binary",
    })

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(root, port):
    """Start serving `root` on `port`; returns a zero-arg stop function."""
    handler = functools.partial(_Handler, directory=str(root))
    srv = _Server(("::", port), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()

    def stop():
        srv.shutdown()
        srv.server_close()
    return stop
