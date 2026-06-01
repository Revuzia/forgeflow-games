#!/usr/bin/env python3
"""ForgeFlow Games — local NO-CACHE static server.

Plain `python -m http.server` lets the browser cache ES modules aggressively, so
edits to runtime/*.js (chess, tide-breakers, etc.) don't show up on reload — you
have to hard-refresh (Ctrl+F5) every single time. This server sends `no-store`
on every response, so a normal reload always pulls the latest file. Just edit and
refresh.

Usage:  python serve_nocache.py [port]   (default 8788)
Threaded so two browser tabs (PvP local testing) work at once.
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # Defeat ALL caching so reload always serves the latest edit.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def guess_type(self, path):
        p = path.lower()
        if p.endswith(".js") or p.endswith(".mjs"):
            return "text/javascript"   # ES modules must be served as JS
        if p.endswith(".glb"):
            return "model/gltf-binary"
        if p.endswith(".gltf"):
            return "model/gltf+json"
        if p.endswith(".wasm"):
            return "application/wasm"
        if p.endswith(".json"):
            return "application/json"
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        # Quiet: only log errors, not every 200.
        try:
            code = int(args[1])
        except (IndexError, ValueError):
            code = 0
        if code >= 400:
            super().log_message(fmt, *args)


class ThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True  # avoid "address already in use" on quick restart
    daemon_threads = True


if __name__ == "__main__":
    with ThreadingServer(("", PORT), NoCacheHandler) as httpd:
        print(f"ForgeFlow NO-CACHE server -> http://localhost:{PORT}")
        print(f"Serving: {ROOT}")
        print("Edits now show on a NORMAL reload (no Ctrl+F5 needed). Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
