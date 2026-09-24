#!/usr/bin/env python
"""DYEFIELD harness — shared launch + observation helpers (APP lane; pattern: blocktooth/_harness).

Every browser gate goes through `Session`:

  * Playwright chromium, channel="chrome", HEADED by default with the real d3d11 ANGLE backend and
    native-occlusion detection OFF. A hidden / occluded window pauses requestAnimationFrame, which
    makes a healthy game look frozen. `--headless` keeps the same d3d11 flags.
  * collects console errors / warnings, page errors, window errors + unhandled rejections (init
    script), failed requests (HTTP >= 400 and network failures) and shader / GL diagnostics;
  * an init script keeps a harness-owned rAF frame counter (`window.__H_FRAMES__`) independent of
    the game's own counters;
  * `wait_phase()` polls `__DF__.state().phase` (CONTRACT §6);
  * `save_report()` POSTs JSON to the dev server's `/__report/<name>` and falls back to writing
    `_harness/_reports/<name>.json` locally;
  * `ensure_server()` starts `npx vite --port 5186 --strictPort` with DF_FROZEN=1 (no HMR, no file
    watching: other lanes edit concurrently) when the dev server is not up, and kills the whole
    process tree afterwards.

stdout/stderr are forced to UTF-8 (Windows consoles default to cp1252).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "_shots")
REPORTS = os.path.join(HERE, "_reports")
PORT = 5186
DEFAULT_BASE = "http://localhost:%d/" % PORT

# Headed Chrome: real d3d11 ANGLE, occlusion detection off, no background throttling.
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
]

SHADER_MARKERS = (
    "THREE.WebGLProgram", "THREE.WebGLShader", "Shader Error", "Program Info Log",
    "VALIDATE_STATUS", "getShaderInfoLog", "GL_INVALID", "WebGL: INVALID", "ERROR: 0:",
    "[.WebGL-",
)
# Console `error`s that are not defects of the game.
CONSOLE_IGNORE = ("favicon.ico",)


def is_shader_error(kind, text):
    """A shader/GL diagnostic is an ERROR (gating, CONTRACT §7 G4 "0 shader errors") when the console
    reported it as an error, or its log carries a compile/link error. A program info log that holds
    only compiler warnings (e.g. ANGLE/HLSL "warning X4008") is a warning: reported, not gating."""
    if kind == "error":
        return True
    t = text
    if "Shader Error" in t or "ERROR: 0:" in t or "VALIDATE_STATUS false" in t or "GL_INVALID" in t or "WebGL: INVALID" in t:
        return True
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    body = [ln for ln in lines if "warning X" not in ln and not ln.startswith("THREE.WebGLProgram: Program Info Log")]
    return any("error" in ln.lower() for ln in body)

INIT_JS = r"""
(() => {
  if (window.__H_INIT__) return; window.__H_INIT__ = true;
  window.__H_ERR__ = [];
  addEventListener('error', (e) => { try { window.__H_ERR__.push(String((e && (e.message || (e.error && e.error.stack))) || e)); } catch (_) {} });
  addEventListener('unhandledrejection', (e) => {
    try { const r = e && e.reason; window.__H_ERR__.push('unhandledrejection: ' + (r && (r.stack || r.message) || String(r))); } catch (_) {}
  });
  window.__H_FRAMES__ = 0;
  const tick = () => { window.__H_FRAMES__++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // pointer-lock observations (did a real click capture the mouse?)
  window.__H_LOCK__ = { changes: 0, errors: 0, locked: false };
  document.addEventListener('pointerlockchange', () => { window.__H_LOCK__.changes++; window.__H_LOCK__.locked = !!document.pointerLockElement; });
  document.addEventListener('pointerlockerror', () => { window.__H_LOCK__.errors++; });
  // timeline: why did a lock drop? (another app's window taking OS activation is the usual cause)
  window.__H_EV__ = []; const t0 = performance.now();
  const ev = (m) => window.__H_EV__.push(((performance.now() - t0) / 1000).toFixed(2) + 's ' + m);
  document.addEventListener('pointerlockchange', () => ev('pointerlock ' + (document.pointerLockElement ? 'ON' : 'OFF')));
  document.addEventListener('pointerlockerror', () => ev('pointerlockerror'));
  addEventListener('blur', () => ev('window blur')); addEventListener('focus', () => ev('window focus'));
  document.addEventListener('visibilitychange', () => ev('visibility ' + document.visibilityState));
})();
"""


class HarnessError(RuntimeError):
    pass


# ─────────────────────────────── small utils ───────────────────────────────
def fmt(v, nd=2):
    if v is None:
        return "—"
    if isinstance(v, float):
        if not math.isfinite(v):
            return str(v)
        return ("%%.%df" % nd) % v
    return str(v)


def build_url(base, **params):
    q = {k: v for k, v in params.items() if v is not None and v is not False}
    for k, v in list(q.items()):
        if v is True:
            q[k] = 1
    b = base if base.endswith("/") or "?" in base or base.endswith(".html") else base + "/"
    if not q:
        return b
    return b + ("&" if "?" in b else "?") + urllib.parse.urlencode(q)


def url_reachable(url, timeout=2.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception:
        return False


# ─────────────────────────────── dev server ───────────────────────────────
def ensure_server(base, allow_start=True, log_dir=REPORTS, wait_s=90):
    """Return None when the dev server already answers; otherwise start vite (localhost only, with
    DF_FROZEN=1) and return a handle for stop_server(). Raises HarnessError when unreachable."""
    if url_reachable(base):
        return None
    u = urllib.parse.urlparse(base)
    if not allow_start:
        raise HarnessError("dev server not reachable at %s (start `npx vite` in %s, or drop --no-serve)" % (base, ROOT))
    if u.hostname not in ("localhost", "127.0.0.1"):
        raise HarnessError("dev server not reachable at %s and it is not localhost — not auto-starting" % base)
    port = u.port or 80
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "devserver_%d.log" % port)
    logf = open(log_path, "w", encoding="utf-8", errors="replace")
    cmd = "npx vite --port %d --strictPort" % port
    env = dict(os.environ, DF_FROZEN="1", PYTHONIOENCODING="utf-8", FORCE_COLOR="0")
    kw = {}
    if os.name == "nt":
        kw["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
    else:
        kw["start_new_session"] = True
    print("dev server not up at %s — starting `%s` with DF_FROZEN=1 (log %s)" % (base, cmd, log_path))
    proc = subprocess.Popen(cmd, cwd=ROOT, shell=True, stdout=logf, stderr=subprocess.STDOUT, env=env, **kw)
    deadline = time.time() + wait_s
    while time.time() < deadline:
        if proc.poll() is not None:
            logf.close()
            tail = ""
            try:
                with open(log_path, encoding="utf-8", errors="replace") as f:
                    tail = f.read()[-1500:]
            except Exception:
                pass
            raise HarnessError("dev server exited with code %s:\n%s" % (proc.returncode, tail))
        if url_reachable(base):
            return {"proc": proc, "log": logf, "path": log_path}
        time.sleep(0.5)
    stop_server({"proc": proc, "log": logf, "path": log_path})
    raise HarnessError("dev server did not answer at %s within %d s (log %s)" % (base, wait_s, log_path))


def stop_server(handle):
    """Kill the dev server's whole process tree (npx → node vite)."""
    if not handle:
        return
    proc = handle.get("proc")
    if proc and proc.poll() is None:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
            else:
                import signal
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
        try:
            proc.wait(timeout=10)
        except Exception:
            pass
    try:
        handle.get("log").close()
    except Exception:
        pass


# ─────────────────────────────── reports ───────────────────────────────
def _clean(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def save_report(name, data, base=DEFAULT_BASE):
    """POST to <base>/__report/<name> (the vite plugin writes _harness/_reports/<name>.json); verify
    the file landed, else write it locally. Returns the path written."""
    payload = json.dumps(_clean(data), indent=2, default=str).encode("utf-8")
    target = os.path.join(REPORTS, name + ".json")
    before = os.path.getmtime(target) if os.path.exists(target) else None
    try:
        u = urllib.parse.urlparse(base)
        url = "%s://%s/__report/%s" % (u.scheme or "http", u.netloc, urllib.parse.quote(name))
        req = urllib.request.Request(url, data=payload, method="POST", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            ok = 200 <= r.status < 300
        if ok:
            for _ in range(10):
                if os.path.exists(target) and os.path.getmtime(target) != before:
                    return target
                time.sleep(0.1)
    except Exception:
        pass
    os.makedirs(REPORTS, exist_ok=True)
    with open(target, "wb") as f:
        f.write(payload)
    return target


# ─────────────────────────────── CLI ───────────────────────────────
def add_common_args(ap: argparse.ArgumentParser):
    ap.add_argument("--base", default=DEFAULT_BASE, help="dev server root URL (default %(default)s)")
    ap.add_argument("--headless", action="store_true", help="headless Chrome with the same d3d11 flags")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--no-serve", action="store_true", help="never auto-start the dev server")
    return ap


# ─────────────────────────────── browser session ───────────────────────────────
class Session:
    """One Chrome + one page with every diagnostic collector attached."""

    def __init__(self, args, name="harness"):
        self.args = args
        self.name = name
        self.console = []          # (type, text)
        self.page_errors = []
        self.failed = []
        self.held = set()
        self._pw = None
        self.browser = None
        self.context = None
        self.page = None
        self._server = None
        self._cdp = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def start(self):
        self._server = ensure_server(self.args.base, not getattr(self.args, "no_serve", False))
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        headless = bool(getattr(self.args, "headless", False))
        self.browser = self._pw.chromium.launch(channel="chrome", headless=headless, args=FLAGS)
        self.context = self.browser.new_context(
            viewport={"width": self.args.width, "height": self.args.height}, device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.set_default_timeout(30_000)
        self.page.add_init_script(INIT_JS)
        self.page.on("console", self._on_console)
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.page.on("requestfailed", self._on_reqfail)
        self.page.on("response", self._on_response)

    def close(self):
        try:
            self.release_all()
        except Exception:
            pass
        for obj, meth in ((self.browser, "close"), (self._pw, "stop")):
            try:
                if obj:
                    getattr(obj, meth)()
            except Exception:
                pass
        self.browser = self._pw = self.page = None
        self._cdp = None
        stop_server(self._server)
        self._server = None

    # collectors
    def _on_console(self, m):
        try:
            text = m.text
            try:
                loc = m.location or {}
                url = loc.get("url") if isinstance(loc, dict) else None
            except Exception:
                url = None
            if url and "Failed to load resource" in text:
                if "favicon" in url:
                    return
                text = "%s [%s]" % (text, url)
            self.console.append((m.type, text))
        except Exception:
            pass

    def _on_reqfail(self, r):
        try:
            if "favicon" in r.url:
                return
            f = r.failure
            if callable(f):
                f = f()
            if f and "ERR_ABORTED" in str(f):
                return
            self.failed.append("FAILED %s (%s)" % (r.url, f))
        except Exception:
            pass

    def _on_response(self, r):
        try:
            if r.status >= 400 and "favicon" not in r.url:
                self.failed.append("HTTP %d %s" % (r.status, r.url))
        except Exception:
            pass

    # navigation / state
    def goto(self, url, timeout_s=60):
        self.page.goto(url, wait_until="load", timeout=int(timeout_s * 1000))

    def js(self, expr, arg=None):
        if arg is None:
            return self.page.evaluate(expr)
        return self.page.evaluate(expr, arg)

    def safe_js(self, expr, arg=None, default=None):
        try:
            return self.js(expr, arg)
        except Exception:
            return default

    def wait_df(self, timeout_s=60):
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.safe_js("() => !!(window.__DF__ && typeof window.__DF__.state === 'function')", default=False):
                return True
            time.sleep(0.25)
        return False

    def state(self):
        return self.safe_js("() => { try { return window.__DF__ ? window.__DF__.state() : null; }"
                            " catch (e) { return { __error: String(e && e.stack || e) }; } }")

    def phase(self):
        s = self.state()
        return s.get("phase") if isinstance(s, dict) else None

    def wait_phase(self, phases, timeout_s=60, poll=0.2):
        if isinstance(phases, str):
            phases = (phases,)
        deadline = time.time() + timeout_s
        last = None
        while time.time() < deadline:
            last = self.phase()
            if last in phases:
                return True, last
            if last == "error":
                return False, last
            time.sleep(poll)
        return False, last

    def df(self, method, *a):
        """Call __DF__.<method>(...a) (awaits promises). Returns (ok, value_or_error)."""
        try:
            v = self.page.evaluate(
                "async ([m, a]) => { const D = window.__DF__; if (!D || typeof D[m] !== 'function')"
                " throw new Error('__DF__.' + m + ' unavailable'); const r = await D[m](...a);"
                " return r === undefined ? null : r; }", [method, list(a)])
            return True, v
        except Exception as e:
            return False, str(e).splitlines()[0][:300]

    def frames(self):
        return self.safe_js("() => window.__H_FRAMES__", default=None)

    def frames_advancing(self, budget_s=3.0):
        a = self.frames()
        b = a
        deadline = time.time() + budget_s
        while time.time() < deadline:
            time.sleep(0.25)
            b = self.frames()
            if isinstance(a, int) and isinstance(b, int) and b > a:
                return True, a, b
        return False, a, b

    def window_errors(self):
        return self.safe_js("() => window.__H_ERR__ || []", default=[]) or []

    def lock_info(self):
        return self.safe_js("() => window.__H_LOCK__ || null", default=None)

    def timeline(self):
        return self.safe_js("() => window.__H_EV__ || []", default=[]) or []

    def resume_if_paused(self, notes, where):
        """The game pauses when pointer lock is lost (by design: e.g. another app's new window took
        OS activation). Recover like a player — raise the window, REALLY click RESUME — and record
        it in `notes`. Returns True when in play."""
        ph = self.phase()
        if ph == "play":
            return True
        for attempt in range(2):
            try:
                self.page.bring_to_front()
            except Exception:
                pass
            box = None
            try:
                box = self.page.locator(".df-pause .df-btn").first.bounding_box(timeout=2000)
            except Exception:
                box = None
            x, y = ((box["x"] + box["width"] / 2, box["y"] + box["height"] / 2) if box
                    else (self.args.width / 2, self.args.height / 2))
            self.page.mouse.move(x, y)
            self.page.mouse.click(x, y)
            ok, _ = self.wait_phase("play", 4.0)
            if ok:
                notes.append("%s: phase was %r (pointer lock lost) → real click on RESUME re-locked (try %d)" % (where, ph, attempt + 1))
                time.sleep(0.4)
                return True
            time.sleep(0.8)
        notes.append("%s: phase %r and a real RESUME click could not re-lock the pointer" % (where, ph))
        return False

    # real keyboard input (page.keyboard — trusted key events through the game's Input)
    def press(self, key, hold_ms=60):
        self.page.keyboard.down(key)
        time.sleep(hold_ms / 1000.0)
        self.page.keyboard.up(key)

    def hold(self, keys):
        """Make exactly `keys` held (down new ones, release the rest)."""
        keys = set(keys)
        for k in sorted(self.held - keys):
            self.page.keyboard.up(k)
        for k in sorted(keys - self.held):
            self.page.keyboard.down(k)
        self.held = keys

    def release_all(self):
        if self.page is None:
            return
        for k in sorted(self.held):
            try:
                self.page.keyboard.up(k)
            except Exception:
                pass
        self.held = set()

    def screenshot(self, path, timeout_s=30):
        """Window screenshot (canvas + DOM HUD) via a raw CDP Page.captureScreenshot.

        Playwright's page.screenshot() re-applies its device-metrics emulation around every
        capture; on a desktop scaled ≠ 100 % that is a viewport resize, and headed Chrome then
        intermittently drops pointer lock → the game pauses by design ("Mouse released."). Measured
        by the integrator: F1/backquote A/B with a capture after each press lost the lock 1×/16
        with page.screenshot, 0×/24 with no capture and 0×/24 with the raw CDP capture. The raw
        capture comes back at the display scale, so it is resampled to the CSS viewport size."""
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        try:
            import base64
            if getattr(self, "_cdp", None) is None:
                self._cdp = self.context.new_cdp_session(self.page)
            r = self._cdp.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})
            data = base64.b64decode(r["data"])
            want = (int(self.args.width), int(self.args.height))
            try:
                import io
                from PIL import Image
                im = Image.open(io.BytesIO(data))
                if im.size != want:
                    im = im.convert("RGB").resize(want, Image.LANCZOS)
                im.save(path)
            except ImportError:
                with open(path, "wb") as f:
                    f.write(data)
            return True
        except Exception as e_cdp:
            try:
                self.page.screenshot(path=path, timeout=int(timeout_s * 1000))
                return True
            except Exception as e:
                self.page_errors.append("screenshot failed: %s (cdp: %s)" % (str(e).splitlines()[0], str(e_cdp).splitlines()[0]))
                return False

    # diagnostics
    def diagnostics(self):
        cerr = [t for (k, t) in self.console if k == "error" and not any(i in t for i in CONSOLE_IGNORE)]
        shader_all = [(k, t) for (k, t) in self.console if k in ("error", "warning") and any(m in t for m in SHADER_MARKERS)]
        shader = [t for (k, t) in shader_all if is_shader_error(k, t)]
        shader_warn = [t for (k, t) in shader_all if not is_shader_error(k, t)]
        warns = [t for (k, t) in self.console if k == "warning" and not any(m in t for m in SHADER_MARKERS)]
        return {
            "consoleErrors": cerr,
            "shader": shader,
            "shaderWarnings": shader_warn,
            "warnings": warns,
            "pageErrors": [e for e in self.page_errors if not e.startswith("screenshot failed")],
            "screenshotErrors": [e for e in self.page_errors if e.startswith("screenshot failed")],
            "windowErrors": self.window_errors() if self.page else [],
            "failedRequests": list(self.failed),
        }


def print_diagnostics(d, limit=30):
    for key, label, mark in (("consoleErrors", "console errors", "!"), ("pageErrors", "page errors", "!!"),
                             ("windowErrors", "window errors", "!!!"), ("shader", "shader/GL errors", "~"),
                             ("failedRequests", "failed requests", "x")):
        items = d.get(key) or []
        print("%s (%d):" % (label, len(items)))
        for t in items[:limit]:
            print("  %s %s" % (mark, str(t)[:600]))
    sw = d.get("shaderWarnings") or []
    if sw:
        print("shader compiler WARNINGS (%d, not gating — reported for the material owner):" % len(sw))
        for t in sw[:8]:
            print("  ~ %s" % " | ".join(ln.strip() for ln in str(t).splitlines() if ln.strip())[:300])
    w = d.get("warnings") or []
    if w:
        print("warnings (%d, not gating):" % len(w))
        for t in w[:12]:
            print("  - %s" % str(t)[:300])


def diag_problems(d):
    """Gate-relevant diagnostic failures (a list of human strings; empty = clean)."""
    out = []
    for key, label in (("consoleErrors", "console error"), ("pageErrors", "page error"),
                       ("windowErrors", "window error / unhandled rejection"), ("shader", "shader/GL error"),
                       ("failedRequests", "failed request")):
        n = len(d.get(key) or [])
        if n:
            out.append("%d %s(s)" % (n, label))
    return out
