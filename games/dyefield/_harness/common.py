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
  // timeline: why did a lock drop? (another app's window taking OS activation is the usual cause)
  window.__H_EV__ = []; const t0 = performance.now();
  window.__H_T0_EPOCH__ = performance.timeOrigin + t0;   // page t=0 as epoch ms (maps page times to the OS log)
  const now = () => (performance.now() - t0) / 1000;
  const ev = (m) => window.__H_EV__.push(now().toFixed(2) + 's ' + m);
  // pointer-lock observations (did a real click capture the mouse? why did a lock drop?)
  // Every lock LOSS is recorded with the focus evidence at that moment: document.hasFocus(), the
  // visibility, the last window blur / focus times, and (filled in later) a blur that arrives just
  // after it — Chrome does not promise which of blur / pointerlockchange it dispatches first when
  // another window takes OS activation.
  const L = window.__H_LOCK__ = { changes: 0, errors: 0, locked: false, lastOn: null, lastBlur: null, lastFocus: null, losses: [] };
  document.addEventListener('pointerlockchange', () => {
    L.changes++; L.locked = !!document.pointerLockElement;
    const t = now();
    if (L.locked) { L.lastOn = t; return; }
    L.losses.push({ t, hasFocus: document.hasFocus(), visibility: document.visibilityState,
                    lastOn: L.lastOn, lastBlur: L.lastBlur, lastFocus: L.lastFocus, blurAfter: null });
  });
  document.addEventListener('pointerlockerror', () => { L.errors++; });
  addEventListener('blur', () => {
    const t = now(); L.lastBlur = t; ev('window blur');
    const last = L.losses[L.losses.length - 1];
    if (last && last.blurAfter === null && t - last.t <= 0.6) last.blurAfter = t;
  });
  addEventListener('focus', () => { L.lastFocus = now(); ev('window focus'); });
  document.addEventListener('pointerlockchange', () => ev('pointerlock ' + (document.pointerLockElement ? 'ON' : 'OFF')
    + (document.pointerLockElement ? '' : ' (hasFocus ' + document.hasFocus() + ')')));
  document.addEventListener('pointerlockerror', () => ev('pointerlockerror'));
  document.addEventListener('visibilitychange', () => ev('visibility ' + document.visibilityState));
})();
"""


def lock_loss_cause(loss, os_foreign=None):
    """Classify one recorded pointer-lock loss (see INIT_JS). Returns (kind, why):
    kind 'focus' = environmental focus theft: the page had lost focus (document.hasFocus() false or the
    page hidden at the loss, or a window blur between the lock and the loss, or a blur arriving within
    0.6 s after it) OR the OS foreground switched to another window around the loss (`os_foreign`:
    ForegroundWatch.foreign_switches over [loss − 1.0 s, loss + 0.8 s]; needed because Playwright
    emulates page focus, so under automation the page itself never sees hasFocus() false or a blur);
    kind 'game' = the lock dropped while the page and its window still had focus."""
    if not isinstance(loss, dict):
        return "game", "no loss record"
    t = loss.get("t") or 0.0
    if os_foreign:
        e = os_foreign[0]
        return "focus", "the OS foreground went to %s (pid %s%s)" % (
            e.get("exe") or "another process", e.get("pid"), (", '%s'" % e["title"][:60]) if e.get("title") else "")
    if loss.get("hasFocus") is False:
        return "focus", "document.hasFocus() was false at the loss"
    if loss.get("visibility") == "hidden":
        return "focus", "the page was hidden at the loss"
    lb, lf, lo = loss.get("lastBlur"), loss.get("lastFocus"), loss.get("lastOn")
    if isinstance(lb, (int, float)) and lb <= t and (lo is None or lb >= lo) and not (isinstance(lf, (int, float)) and lb < lf <= t):
        return "focus", "a window blur at t=%.2fs came before the loss" % lb
    ba = loss.get("blurAfter")
    if isinstance(ba, (int, float)):
        return "focus", "a window blur followed %.2f s after the loss" % (ba - t)
    return "game", "the page still had focus (hasFocus true, no blur around the loss)"


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
    """Other automated Chrome BROWSER processes alive right now (the orchestrator's rule): chrome.exe
    whose command line carries --remote-debugging-pipe or --enable-automation and no --type= (so
    renderer / GPU / utility children are not counted twice). Returns (list, error_or_None); each item
    is {pid, ppid, created, headless, profile}. A headed one of these steals OS focus when it opens a
    window (pointer lock drops, the game pauses) and shares the GPU (perf numbers are contaminated)."""
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


def own_browser_pids():
    """PIDs of the Chrome browser process(es) THIS Python process launched through Playwright
    (python → playwright driver node.exe → chrome.exe without --type=). Windows only."""
    if os.name != "nt":
        return set()
    cmd = ("$me=%d; $d=@(Get-CimInstance Win32_Process -Filter \"ParentProcessId=$me\" | ForEach-Object { $_.ProcessId }); "
           "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $d -contains $_.ParentProcessId "
           "-and ([string]$_.CommandLine) -notmatch '--type=' } | ForEach-Object { $_.ProcessId }) -join ','") % os.getpid()
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=60)
        return {int(x) for x in (r.stdout or "").strip().split(",") if x.strip().isdigit()}
    except Exception:
        return set()


class ForegroundWatch:
    """OS-level focus evidence (Windows): a thread polls GetForegroundWindow() every 25 ms and logs
    every change as {ms (epoch), pid, exe, title}. Playwright emulates page focus, so under automation
    a page never sees document.hasFocus() false or a blur when another window takes activation — the
    OS foreground log is what tells focus theft apart from a game bug."""

    def __init__(self, own_pids, period=0.025):
        import threading
        self.own = set(own_pids)
        self.period = period
        self.log = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="fgwatch", daemon=True)
        self._exe_cache = {}

    def start(self):
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        try:
            self._thread.join(timeout=1.0)
        except Exception:
            pass

    def _exe(self, pid):
        if pid in self._exe_cache:
            return self._exe_cache[pid]
        name = None
        try:
            import ctypes
            from ctypes import wintypes
            k = ctypes.windll.kernel32
            h = k.OpenProcess(0x1000, False, pid)            # PROCESS_QUERY_LIMITED_INFORMATION
            if h:
                buf = ctypes.create_unicode_buffer(1024)
                n = wintypes.DWORD(1024)
                if k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
                    name = os.path.basename(buf.value)
                k.CloseHandle(h)
        except Exception:
            name = None
        self._exe_cache[pid] = name
        return name

    def _run(self):
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        last = None
        while not self._stop.is_set():
            try:
                hwnd = u.GetForegroundWindow()
                pid = wintypes.DWORD(0)
                u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                key = (hwnd, pid.value)
                if key != last:
                    last = key
                    title = ""
                    if hwnd:
                        buf = ctypes.create_unicode_buffer(256)
                        u.GetWindowTextW(hwnd, buf, 256)
                        title = buf.value
                    self.log.append({"ms": time.time() * 1000.0, "pid": pid.value, "exe": self._exe(pid.value),
                                     "title": title, "own": pid.value in self.own})
            except Exception:
                pass
            self._stop.wait(self.period)

    def foreign_switches(self, a_ms, b_ms):
        """Foreground SWITCHES to a window that is not ours during (a_ms, b_ms]. A static foreign
        foreground is not evidence: measured here, Chrome grants (and keeps) pointer lock to this
        window while another app's window stays the OS foreground — what drops the lock is the
        activation change itself."""
        return [e for e in self.log if a_ms < e["ms"] <= b_ms and not e["own"]]


def describe_chromes(found, err=None):
    if err:
        return "UNKNOWN (%s)" % err
    if not found:
        return "none"
    return "; ".join("pid %s %s started %s profile %s" % (
        c["pid"], "HEADLESS" if c["headless"] else "HEADED", c["created"] or "?",
        os.path.basename(c["profile"]) if c["profile"] else "?") for c in found)


def preflight_chromes(label="pre-flight"):
    """Print one line listing the other automated Chromes (before this harness launches its own)."""
    found, err = automated_chromes()
    print("%-13s: other automated Chrome processes: %s" % (label, describe_chromes(found, err)))
    return found, err


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
    ap.add_argument("--chrome-arg", action="append", default=[], metavar="SWITCH",
                    help="extra Chrome switch for experiments (repeatable), e.g. --chrome-arg=--force_high_performance_gpu")
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
        extra = [a for a in (getattr(self.args, "chrome_arg", None) or []) if a]
        self.browser = self._pw.chromium.launch(channel="chrome", headless=headless, args=FLAGS + extra)
        self.fg = None
        if not headless and os.name == "nt":
            own = own_browser_pids()
            if own:
                self.fg = ForegroundWatch(own).start()
        self.context = self.browser.new_context(
            viewport={"width": self.args.width, "height": self.args.height}, device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.set_default_timeout(30_000)
        self.page.add_init_script(INIT_JS)
        self.page.on("console", self._on_console)
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.page.on("requestfailed", self._on_reqfail)
        self.page.on("response", self._on_response)
        # NB Playwright emulates page focus: document.hasFocus() stays true and no blur fires when another
        # window takes OS activation (measured: minimizing this window dropped the lock with hasFocus true
        # and no blur, and Emulation.setFocusEmulationEnabled(false) from a second CDP session did not
        # change that). The OS evidence comes from self.fg (ForegroundWatch, headed runs on Windows).

    def close(self):
        try:
            self.release_all()
        except Exception:
            pass
        if getattr(self, "fg", None):
            self.fg.stop()
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

    def lock_losses(self):
        return (self.lock_info() or {}).get("losses") or []

    def lock_guard(self, where, notes, problems):
        """Strict about the game, tolerant of the environment. Looks at the pointer-lock losses recorded
        since the last call (INIT_JS) and classifies each with lock_loss_cause():

          * focus theft (the page had lost focus) → re-acquire the lock with ONE real click on RESUME
            and print 'NOTE: focus stolen by another window at t=..s; re-locked with a real click';
          * a loss while the page still had focus → a PROBLEM (a game bug); the one real click still
            re-locks so the remaining checks can run, but the verdict is NOT CLEAN.

        Returns 'ok' (no new loss) · 'relocked' (focus theft, recovered) · 'game' (a game-caused loss
        was recorded) · 'failed' (the one click did not re-lock)."""
        losses = self.lock_losses()
        seen = getattr(self, "_losses_seen", 0)
        new = losses[seen:]
        self._losses_seen = len(losses)
        ph = self.phase()
        if not new:
            if ph == "paused":
                problems.append("%s: the game is paused but no pointer-lock loss was recorded" % where)
                return "game"
            return "ok"
        # evidence that follows the loss (a blur ≤ 0.6 s after it, an OS foreground switch ≤ 0.8 s after
        # it) needs time to land
        time.sleep(0.9)
        new = self.lock_losses()[seen:] or new
        self._losses_seen = seen + len(new)
        kinds = []
        t0 = self.safe_js("() => window.__H_T0_EPOCH__", default=None)
        for loss in new:
            foreign = None
            if getattr(self, "fg", None) and isinstance(t0, (int, float)):
                at = t0 + (loss.get("t") or 0.0) * 1000.0
                foreign = self.fg.foreign_switches(at - 1000.0, at + 800.0)
            kind, why = lock_loss_cause(loss, foreign)
            kinds.append((kind, loss, why))
            if kind == "game":
                problems.append("%s: pointer lock lost at t=%.2fs while the page still had focus (%s) — "
                                "a game bug, not focus theft" % (where, loss.get("t") or 0.0, why))
        if self.phase() != "play":
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
            ok, ph2 = self.wait_phase("play", 4.0)
            if not ok:
                problems.append("%s: pointer lock lost at t=%s and ONE real click on RESUME did not re-lock (phase %r)" % (
                    where, ", ".join("%.2fs" % (l.get("t") or 0.0) for _, l, _ in kinds), ph2))
                return "failed"
            self._losses_seen = len(self.lock_losses())
            time.sleep(0.4)
        for kind, loss, why in kinds:
            if kind == "focus":
                msg = "focus stolen by another window at t=%.2fs; re-locked with a real click" % (loss.get("t") or 0.0)
                print("NOTE: " + msg)
                notes.append("%s: %s (%s)" % (where, msg, why))
        return "game" if any(k == "game" for k, _, _ in kinds) else "relocked"

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
