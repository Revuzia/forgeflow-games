#!/usr/bin/env python
"""HIT PARADE harness - shared launch + observation helpers (lane SHELL; adapted from dyefield/_harness/common.py,
which follows blocktooth/_harness).

Every browser gate goes through `Session`:

  * Playwright chromium, channel="chrome", HEADED by default with the real d3d11 ANGLE backend and native-occlusion
    detection OFF (a hidden / occluded window pauses requestAnimationFrame, which makes a healthy game look frozen).
    `--headless` keeps the same flags.
  * collects console errors / warnings, page errors, window errors + unhandled rejections (init script), failed
    requests (HTTP >= 400 and network failures) and shader / GL diagnostics;
  * an init script keeps a harness-owned rAF frame counter (`window.__H_FRAMES__`) independent of the game's own
    counters, and a focus / visibility timeline (`window.__H_EV__`);
  * `pads=True` installs SYNTHETIC GAMEPADS: navigator.getGamepads() returns `window.__PADS__` (standard mapping, 17
    buttons, 4 axes) and `Session.pad(i, buttons=..., axes=...)` edits them - a real Gamepad API read path, no
    game-side hooks (dyefield menus.py used the same trick);
  * `wait_phase()` polls `__HP__.state().phase` (CONTRACT §12 / §18.6: boot, loading, title, menu, ready, bout,
    paused, results, error);
  * `save_report()` POSTs JSON to the dev server's `/__report/<name>` and falls back to writing
    `_harness/_reports/<name>.json` locally;
  * `ensure_server()` starts `npx vite --port 5320 --strictPort` with HP_FROZEN=1 (no HMR, no file watching: other
    lanes edit concurrently; NOTE a frozen server also never sees YOUR edits - restart it after changing source)
    when the dev server is not up, and kills the whole process tree afterwards.

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
PORT = 5320
DEFAULT_BASE = "http://localhost:%d/" % PORT

# Chrome: real d3d11 ANGLE, occlusion detection off, no background throttling.
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

# CONTRACT §4.4 input word bits (mirrors runtime/src/input.ts BIT)
BIT = {"UP": 1, "DOWN": 2, "LEFT": 4, "RIGHT": 8, "L": 16, "M": 32, "H": 64, "S": 128, "ASSIST": 256,
       "THROW": 512, "PARRY": 1024, "IMPACT": 2048, "TAUNT": 4096,
       # CHANGED(integrator) 3D (CONTRACT §35.2 / §35.16 item 1): the STEP bits
       "STEP_IN": 8192, "STEP_OUT": 16384}
# default P1 / P2 keyboard bindings (runtime/src/input.ts DEFAULT_KEYS) as Playwright key names
P1_KEYS = {"up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD", "l": "KeyJ", "m": "KeyK", "h": "KeyL",
           "s": "KeyI", "assist": "KeyU", "throw": "KeyH", "parry": "KeyO", "impact": "KeyP", "taunt": "KeyY",
           "pause": "Escape", "stepin": "KeyQ", "stepout": "KeyE"}
P2_KEYS = {"up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight", "l": "Numpad1",
           "m": "Numpad2", "h": "Numpad3", "s": "Numpad5", "assist": "Numpad4", "throw": "Numpad0", "parry": "Numpad6",
           "impact": "NumpadAdd", "taunt": "NumpadMultiply", "stepin": "Numpad7", "stepout": "Numpad9"}
# Standard-mapping pad button indices
PAD = {"A": 0, "B": 1, "X": 2, "Y": 3, "LB": 4, "RB": 5, "LT": 6, "RT": 7, "SELECT": 8, "START": 9, "L3": 10, "R3": 11,
       "UP": 12, "DOWN": 13, "LEFT": 14, "RIGHT": 15, "HOME": 16}


def is_shader_error(kind, text):
    """A shader/GL diagnostic is an ERROR when the console reported it as an error, or its log carries a compile /
    link error. A program info log that holds only compiler warnings (ANGLE/HLSL "warning X4008") is a warning."""
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
  window.__H_EV__ = []; const t0 = performance.now();
  window.__H_T0_EPOCH__ = performance.timeOrigin + t0;
  const now = () => (performance.now() - t0) / 1000;
  const ev = (m) => { if (window.__H_EV__.length < 400) window.__H_EV__.push(now().toFixed(2) + 's ' + m); };
  addEventListener('blur', () => ev('window blur'));
  addEventListener('focus', () => ev('window focus'));
  document.addEventListener('visibilitychange', () => ev('visibility ' + document.visibilityState));
})();
"""

# synthetic standard-mapping gamepads: navigator.getGamepads() -> window.__PADS__ (edited by Session.pad())
PADS_INIT_JS = r"""
(() => {
  if (window.__H_PADS_INIT__) return; window.__H_PADS_INIT__ = true;
  window.__PADS__ = [];
  window.__H_PAD__ = (i, id, buttons, axes, connected) => {
    const P = window.__PADS__;
    while (P.length <= i) P.push(null);
    let g = P[i];
    if (!g) {
      g = { index: i, id: id || ('HP harness pad ' + i + ' (STANDARD GAMEPAD)'), mapping: 'standard', connected: true, timestamp: 0,
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0],
            vibrationActuator: null, hapticActuators: [] };
      P[i] = g;
    }
    if (buttons) for (const k of Object.keys(buttons)) { const b = g.buttons[+k]; const v = +buttons[k]; b.value = v; b.pressed = v > 0.5; b.touched = v > 0; }
    if (axes) for (let a = 0; a < axes.length && a < 4; a++) if (axes[a] !== null && axes[a] !== undefined) g.axes[a] = +axes[a];
    if (connected === false) P[i] = null;
    g.timestamp = performance.now();
    return { index: g.index, pressed: g.buttons.map((b, k) => b.pressed ? k : -1).filter((k) => k >= 0), axes: g.axes.slice() };
  };
  const get = () => window.__PADS__.slice();
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: get }); } catch (e) {}
  try { Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: get }); } catch (e) {}
})();
"""


class HarnessError(RuntimeError):
    pass


# ─────────────────────────────── small utils ───────────────────────────────
def fmt(v, nd=2):
    if v is None:
        return "-"
    if isinstance(v, float):
        if not math.isfinite(v):
            return str(v)
        return ("%%.%df" % nd) % v
    return str(v)


def build_url(base, path="", **params):
    """base + optional relative path + query (True -> 1, None / False dropped)."""
    q = {k: v for k, v in params.items() if v is not None and v is not False}
    for k, v in list(q.items()):
        if v is True:
            q[k] = 1
    b = base if base.endswith("/") or "?" in base or base.endswith(".html") else base + "/"
    if path:
        b = urllib.parse.urljoin(b, path)
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


def is_local(base):
    return (urllib.parse.urlparse(base).hostname or "").lower() in ("localhost", "127.0.0.1", "::1")


# ─────────────────────────────── other automated Chromes ───────────────────────────────
_PS_SCAN = (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "
    "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { [pscustomobject]@{ "
    "pid=$_.ProcessId; ppid=$_.ParentProcessId; "
    "created=$(if ($_.CreationDate) { $_.CreationDate.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }); "
    "cmd=[string]$_.CommandLine } }) | ConvertTo-Json -Compress -Depth 2"
)


def _arg_value(cmd, name):
    i = cmd.find(name + "=")
    if i < 0:
        return None
    rest = cmd[i + len(name) + 1:]
    if rest.startswith('"'):
        j = rest.find('"', 1)
        return rest[1:j] if j > 0 else rest[1:]
    return rest.split(" ", 1)[0]


def automated_chromes(exclude=()):
    """Other automated Chrome BROWSER processes alive right now: chrome.exe with --remote-debugging-pipe or
    --enable-automation and no --type=. Returns (list, error_or_None)."""
    if os.name != "nt":
        try:
            out = subprocess.run(["ps", "-eo", "pid=,ppid=,args="], capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=20).stdout
        except Exception as e:
            return [], "process scan failed: %s" % e
        rows = []
        for ln in out.splitlines():
            parts = ln.strip().split(None, 2)
            if len(parts) == 3 and "chrome" in parts[2].split(" ", 1)[0].lower():
                rows.append({"pid": int(parts[0]), "ppid": int(parts[1]), "created": "", "cmd": parts[2]})
    else:
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_SCAN],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
            txt = (r.stdout or "").strip()
            rows = json.loads(txt) if txt else []
            if isinstance(rows, dict):
                rows = [rows]
        except Exception as e:
            return [], "process scan failed: %s" % str(e).splitlines()[0][:200]
    found = []
    for p in rows:
        cmd = p.get("cmd") or ""
        if "--type=" in cmd:
            continue
        if "--remote-debugging-pipe" not in cmd and "--enable-automation" not in cmd:
            continue
        if p.get("pid") in exclude:
            continue
        found.append({"pid": p.get("pid"), "ppid": p.get("ppid"), "created": p.get("created") or "",
                      "headless": "--headless" in cmd, "profile": _arg_value(cmd, "--user-data-dir") or ""})
    return found, None


def describe_chromes(found, err=None):
    if err:
        return "UNKNOWN (%s)" % err
    if not found:
        return "none"
    return "; ".join("pid %s %s started %s" % (c["pid"], "HEADLESS" if c["headless"] else "HEADED", c["created"] or "?")
                     for c in found)


def preflight_chromes(label="pre-flight"):
    """Print one line listing the other automated Chromes (before this harness launches its own)."""
    found, err = automated_chromes()
    print("%-13s: other automated Chrome processes: %s" % (label, describe_chromes(found, err)))
    return found, err


def cpu_load():
    """Windows: the processor load % right now (None elsewhere / on failure). A saturated machine slows rAF."""
    if os.name != "nt":
        return None
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                            "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        return float((r.stdout or "").strip())
    except Exception:
        return None


# ─────────────────────────────── dev server ───────────────────────────────
def ensure_server(base, allow_start=True, log_dir=REPORTS, wait_s=90, env_extra=None):
    """Return None when the dev server already answers; otherwise start vite (localhost only, HP_FROZEN=1, plus
    `env_extra`) and return a handle for stop_server(). Raises HarnessError when unreachable."""
    if url_reachable(base):
        return None
    u = urllib.parse.urlparse(base)
    if not allow_start:
        raise HarnessError("dev server not reachable at %s (start `HP_FROZEN=1 npx vite --port %d --strictPort` in %s, or drop --no-serve)"
                           % (base, u.port or PORT, ROOT))
    if u.hostname not in ("localhost", "127.0.0.1"):
        raise HarnessError("dev server not reachable at %s and it is not localhost - not auto-starting" % base)
    port = u.port or 80
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "devserver_%d.log" % port)
    logf = open(log_path, "w", encoding="utf-8", errors="replace")
    cmd = "npx vite --port %d --strictPort" % port
    env = dict(os.environ, HP_FROZEN="1", PYTHONIOENCODING="utf-8", FORCE_COLOR="0", NO_COLOR="1")
    if env_extra:
        env.update({k: str(v) for k, v in env_extra.items()})
    kw = {}
    if os.name == "nt":
        kw["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
    else:
        kw["start_new_session"] = True
    extra = (" " + " ".join("%s=%s" % kv for kv in (env_extra or {}).items())) if env_extra else ""
    print("dev server not up at %s - starting `%s` with HP_FROZEN=1%s (log %s)" % (base, cmd, extra, log_path))
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
    """Kill the dev server's whole process tree (npx -> node vite)."""
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
    """POST to <base>/__report/<name> (the vite plugin writes _harness/_reports/<name>.json); verify the file landed,
    else write it locally. Returns the path written."""
    payload = json.dumps(_clean(data), indent=2, default=str).encode("utf-8")
    target = os.path.join(REPORTS, name + ".json")
    before = os.path.getmtime(target) if os.path.exists(target) else None
    if is_local(base):
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
    ap.add_argument("--chrome-arg", action="append", default=[], metavar="SWITCH",
                    help="extra Chrome switch for experiments (repeatable), e.g. --chrome-arg=--disable-gpu-vsync")
    return ap


# ─────────────────────────────── browser session ───────────────────────────────
class Session:
    """One Chrome + one page with every diagnostic collector attached."""

    def __init__(self, args, name="harness", pads=False, server_env=None):
        self.args = args
        self.name = name
        self.pads = pads
        self.server_env = server_env
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
        self._server = ensure_server(self.args.base, not getattr(self.args, "no_serve", False), env_extra=self.server_env) \
            if is_local(self.args.base) else None
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        headless = bool(getattr(self.args, "headless", False))
        extra = [a for a in (getattr(self.args, "chrome_arg", None) or []) if a]
        self.browser = self._pw.chromium.launch(channel="chrome", headless=headless, args=FLAGS + extra)
        self.context = self.browser.new_context(
            viewport={"width": self.args.width, "height": self.args.height}, device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.set_default_timeout(30_000)
        self.page.add_init_script(INIT_JS)
        if self.pads:
            self.page.add_init_script(PADS_INIT_JS)
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
            if "Failed to load resource" in text:
                if url and "favicon" in url:
                    return
                if url:
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

    def wait_hp(self, timeout_s=60):
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.safe_js("() => !!(window.__HP__ && typeof window.__HP__.state === 'function')", default=False):
                return True
            time.sleep(0.25)
        return False

    def state(self):
        return self.safe_js("() => { try { return window.__HP__ ? window.__HP__.state() : null; }"
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

    def hp(self, path, *a):
        """Call __HP__.<path>(...a) (dotted path, e.g. 'dev.step'; awaits promises). Returns (ok, value_or_error)."""
        try:
            v = self.page.evaluate(
                "async ([p, a]) => { let o = window.__HP__; const parts = p.split('.'); const m = parts.pop();"
                " for (const k of parts) o = o && o[k]; if (!o || typeof o[m] !== 'function') throw new Error('__HP__.' + p + ' unavailable');"
                " const r = await o[m](...a); return r === undefined ? null : r; }", [path, list(a)])
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

    def timeline(self):
        return self.safe_js("() => window.__H_EV__ || []", default=[]) or []

    # synthetic gamepads (pads=True)
    def pad(self, index, buttons=None, axes=None, connected=True, pad_id=None):
        """Edit synthetic pad `index`: buttons = {button_index: value 0..1}, axes = [x, y, rx, ry] (None keeps)."""
        return self.js("([i, id, b, a, c]) => window.__H_PAD__(i, id, b, a, c)",
                       [index, pad_id, {str(k): v for k, v in (buttons or {}).items()}, axes, connected])

    # real keyboard input (page.keyboard: trusted key events through the game's Input)
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
        """Window screenshot (canvas + DOM HUD) via a raw CDP Page.captureScreenshot (dyefield: page.screenshot()
        re-applies device-metrics emulation around every capture), resampled to the CSS viewport size."""
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
        print("shader compiler WARNINGS (%d, not gating):" % len(sw))
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


# ─────────────────────────────── HIT PARADE readers (CONTRACT §12) ───────────────────────────────
def match_info(sess):
    """__HP__.match(): readMatch() + frame / checksum extras, or None outside a bout."""
    return sess.safe_js("() => { try { return window.__HP__ && __HP__.match ? __HP__.match() : null; }"
                        " catch (e) { return { __error: String(e && e.stack || e) }; } }")


def fighters_info(sess):
    """__HP__.fighters(): [FighterSnap, FighterSnap] or None."""
    return sess.safe_js("() => { try { return __HP__.fighters(); } catch (e) { return null; } }")


def events_tail(sess, n=200):
    return sess.safe_js("(n) => { try { return __HP__.events(n); } catch (e) { return []; } }", n, default=[]) or []


def input_info(sess):
    return sess.safe_js("() => { try { return __HP__.input(); } catch (e) { return null; } }")


def wait_match_phase(sess, phases, timeout_s=30.0, poll=0.1):
    """Poll __HP__.match().phase until it is one of `phases` -> (ok, last_phase)."""
    if isinstance(phases, str):
        phases = (phases,)
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        m = match_info(sess) or {}
        last = m.get("phase")
        if last in phases:
            return True, last
        if sess.phase() == "error":
            return False, "error"
        time.sleep(poll)
    return False, last


def wait_warm(sess, notes, where, min_fps=24.0, budget_s=30.0):
    """Timed real input needs a warm page: the loop runs at most 5 ticks per rendered frame, so below ~12 fps a timed
    hold moves the sim slower than real time. Wait for the game's own fps and SAY so in `notes` when it took > 1 s."""
    t0 = time.time()
    f = None
    while time.time() - t0 < budget_s:
        f = (sess.state() or {}).get("fps")
        if isinstance(f, (int, float)) and f >= min_fps:
            break
        time.sleep(0.5)
    waited = time.time() - t0
    if waited > 1.0:
        notes.append("%s: waited %.1f s for the page to warm to %.0f fps (now %s)" % (where, waited, min_fps, f))
    return f
