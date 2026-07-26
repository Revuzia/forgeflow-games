"""Static file server + screenshot sink for Colosseum development.

Serves forgeflow-games/ over HTTP AND accepts POST /__shot/<name> carrying a
data-URL PNG/JPEG body, which it decodes to games/colosseum/tools/shots/<name>.

Why this exists: the Browser-pane screenshot path cannot capture WebGL when the
pane is not compositing (and the FFG convention is that 3D games are verified by
evaluating hooks, not by screenshots). But a Colosseum has to be *looked at* to
be judged, so the page renders into an offscreen target, reads the pixels back
itself, and posts them here. That is a real observation of what the GPU drew,
not a proxy for it.

run: python games/colosseum/tools/shotserver.py [port]
"""
import base64
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SHOTS = os.path.join(ROOT, "games", "colosseum", "tools", "shots")
os.makedirs(SHOTS, exist_ok=True)

SAFE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def end_headers(self):
        # Never cache during development — a stale module is a whole afternoon.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self._cors()
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/__shot/"):
            self.send_error(404)
            return
        name = self.path[len("/__shot/"):]
        if not SAFE.match(name):
            self.send_error(400, "bad name")
            return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8", "replace")
        if "," in body:
            body = body.split(",", 1)[1]
        try:
            raw = base64.b64decode(body)
        except Exception as e:
            self.send_error(400, f"bad base64: {e}")
            return
        out = os.path.join(SHOTS, name)
        with open(out, "wb") as f:
            f.write(raw)
        msg = f"{out} ({len(raw)} bytes)".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)
        print("[shot]", out, len(raw), "bytes", flush=True)

    def log_message(self, fmt, *args):
        # Quiet: only POSTs and errors are interesting here.
        if "POST" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    print(f"serving {ROOT} on http://127.0.0.1:{port}  (shots -> {SHOTS})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
