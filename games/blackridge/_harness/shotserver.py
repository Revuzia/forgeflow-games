"""Static file server + screenshot sink for BLACKRIDGE development (R20, R12).

Serves forgeflow-games/ over HTTP on PORT 8841 AND accepts POST /__shot/<name>
carrying a data-URL PNG/JPEG body, which it decodes into
games/blackridge/_shots/. `<name>` may carry ONE level of subdirectory
(e.g. `iter03/S1.png`) so shotbattery.py can land captures directly in the
iteration dir; a bare name (`bootcheck-probe.png`) lands in `_shots/inbox/`.

Why this exists (colosseum lineage, adapted per BUILD_PLAN R20): the
Browser-pane screenshot path cannot capture WebGL when the pane is not
compositing (and the FFG convention is that 3D games are verified by
evaluating hooks, not by screenshots). But BLACKRIDGE has to be *looked at*
to be judged, so the page renders into an offscreen target, reads the pixels
back itself, and posts them here. That is a real observation of what the GPU
drew, not a proxy for it.

Also exported for the other harness scripts (bootcheck.py, shotbattery.py):

    from shotserver import ensure_server
    ensure_server()          # probes 8841; spawns this file detached if closed

so no harness run ever depends on a manually-started server.

run: python games/blackridge/_harness/shotserver.py [port]
"""
import base64
import http.client
import os
import re
import socket
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SHOTS_ROOT = os.path.join(ROOT, "games", "blackridge", "_shots")
INBOX = os.path.join(SHOTS_ROOT, "inbox")
os.makedirs(INBOX, exist_ok=True)

PORT = 8841  # R12: 8799 is driftwake's; 8841 collides with nothing in games/**

SAFE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def _resolve_shot_path(name: str):
    """Map a POSTed shot name to a path under _shots/, or None if unsafe.

    - bare name            -> _shots/inbox/<name>
    - one subdir allowed   -> _shots/<dir>/<name>   (e.g. iter03/S1.png)
    Every segment must match SAFE (no dots-paths, no drive letters, no depth).
    """
    parts = [p for p in name.split("/") if p != ""]
    if not parts or len(parts) > 2:
        return None
    if any(not SAFE.match(p) or p in (".", "..") for p in parts):
        return None
    if len(parts) == 1:
        return os.path.join(INBOX, parts[0])
    return os.path.join(SHOTS_ROOT, parts[0], parts[1])


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
        out = _resolve_shot_path(name)
        if out is None:
            self.send_error(400, "bad name")
            return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8", "replace")
        # Three accepted payload shapes:
        #   data-URL ("data:image/png;base64,....") — the capture() path
        #   bare base64                              — tolerated
        #   raw text (e.g. ?bench=1 POSTs bench.json) — written verbatim
        if body.startswith("data:") and "," in body:
            try:
                raw = base64.b64decode(body.split(",", 1)[1])
            except Exception as e:
                self.send_error(400, f"bad base64: {e}")
                return
        else:
            try:
                raw = base64.b64decode(body, validate=True)
            except Exception:
                raw = body.encode("utf-8")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as f:
            f.write(raw)
        msg = f"{out} ({len(raw)} bytes)".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)
        print("[shot]", out, len(raw), "bytes", flush=True)

    def log_message(self, fmt, *args):
        # Quiet: only POSTs and errors are interesting here. str() matters:
        # send_error() routes through here with an INT first arg
        # (log_error("code %d...", 400, ...)) and `"POST" in 400` raises,
        # killing the handler before the error response is written — a latent
        # bug inherited from the colosseum original, fixed here.
        if "POST" in str(args[0] if args else ""):
            super().log_message(fmt, *args)


# ---------------------------------------------------------------------------
# ensure_server() — importable by bootcheck.py / shotbattery.py / perfprobe.py
# ---------------------------------------------------------------------------

def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.6):
            return True
    except OSError:
        return False


def _is_ours(port: int) -> bool:
    """True iff the listener on `port` answers our /__shot/ OPTIONS with 204.

    A plain http.server (or an unrelated process) does not — so a foreign
    squatter on 8841 is reported instead of silently trusted.
    """
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        c.request("OPTIONS", "/__shot/probe")
        ok = c.getresponse().status == 204
        c.close()
        return ok
    except Exception:
        return False


def ensure_server(port: int = PORT, timeout: float = 15.0) -> None:
    """Probe port 8841; auto-spawn this file as a DETACHED subprocess if closed.

    Raises RuntimeError (with the reason) instead of returning a lie — callers
    treat any raise as harness-infrastructure failure, not a game failure.
    """
    if _port_open(port):
        if _is_ours(port):
            return
        raise RuntimeError(
            f"port {port} is open but is NOT shotserver.py (no /__shot/ handler) — "
            f"another process is squatting the harness port; free it first")
    log_path = os.path.join(SHOTS_ROOT, "shotserver.log")
    os.makedirs(SHOTS_ROOT, exist_ok=True)
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    kw = {}
    if os.name == "nt":
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        kw["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    with open(log_path, "ab") as log:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), str(port)],
            stdout=log, stderr=log, stdin=subprocess.DEVNULL,
            cwd=ROOT, env=env, **kw)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_open(port) and _is_ours(port):
            print(f"[shotserver] spawned detached on port {port} (log: {log_path})",
                  flush=True)
            return
        time.sleep(0.4)
    raise RuntimeError(
        f"spawned shotserver.py but port {port} never answered within {timeout:.0f}s "
        f"— see {log_path}")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    print(f"serving {ROOT} on http://127.0.0.1:{port}  (shots -> {SHOTS_ROOT})",
          flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
