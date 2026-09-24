#!/usr/bin/env python
"""BLOCKTOOTH harness — shared launch + observation helpers (harness lane).

Every browser gate (bootcheck / playtest / perfcheck / shots) goes through `Session`:

  * Playwright chromium, channel="chrome", HEADED by default with the real d3d11 ANGLE
    backend and native-occlusion detection OFF. A hidden / occluded window pauses
    requestAnimationFrame, which makes a perfectly healthy game look frozen
    (reference_ffg_preview_verification). `--headless` keeps the SAME d3d11 flags: on this
    box headless Chrome also gets the real Intel GPU (orchestrator-verified).
  * collects console errors / warnings, page errors, window errors + unhandled rejections
    (init script), failed requests (HTTP >= 400 and network failures), and shader / GL
    diagnostics;
  * an init script keeps a harness-owned rAF frame counter + frame-time recorder
    (`window.__H_FRAMES__`, `__H_FT__`) and an event collector over `__BT__.events(n)`
    (`window.__H_EV__.counts`) — independent of the game's own counters;
  * `wait_screen()` polls `__BT__.state().screen`;
  * `save_report()` POSTs JSON to the dev server's `/__report/<name>` (CONTRACT §14) and falls
    back to writing `_harness/_reports/<name>.json` locally;
  * `ensure_server()` starts `npx vite --port <p> --strictPort` when the dev server is not up
    (localhost only; `--no-serve` disables) and kills the whole process tree afterwards.

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
DEFAULT_BASE = "http://localhost:5178/"

TITANS = ["molo", "voltkite", "hearthback", "briarwick"]
BIOMES = ["grideast", "whitestacks", "lockwater"]
TITAN_NAMES = {"molo": "MOLO", "voltkite": "VOLT-KITE", "hearthback": "HEARTHBACK", "briarwick": "BRIARWICK"}
BIOME_NAMES = {"grideast": "GRID-EAST", "whitestacks": "WHITE STACKS", "lockwater": "LOCKWATER"}
BIOME_BOSS = {"grideast": "caisson4", "whitestacks": "irongully", "lockwater": "caisson4"}
ENEMY_KINDS = ["android", "squad", "drone", "buggy", "apc", "tank", "walker", "elite"]
ROMAN = ["I", "II", "III", "IV", "V"]

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

# Screens of the app state machine (CONTRACT §14): boot → title → select → loading → slate →
# play ⇄ draft / pause → end.
LIVE_SCREENS = ("play",)

INIT_JS = r"""
(() => {
  if (window.__H_INIT__) return; window.__H_INIT__ = true;
  window.__H_ERR__ = [];
  addEventListener('error', (e) => { try { window.__H_ERR__.push(String((e && (e.message || (e.error && e.error.stack))) || e)); } catch (_) {} });
  addEventListener('unhandledrejection', (e) => {
    try { const r = e && e.reason; window.__H_ERR__.push('unhandledrejection: ' + (r && (r.stack || r.message) || String(r))); } catch (_) {}
  });
  // harness-owned frame counter + frame-time recorder (independent of the game's counters)
  window.__H_FRAMES__ = 0; window.__H_FT__ = []; window.__H_FT_ON__ = false;
  let last = 0;
  const tick = (ts) => {
    window.__H_FRAMES__++;
    if (last && window.__H_FT_ON__) { const a = window.__H_FT__; a.push(ts - last); if (a.length > 40000) a.splice(0, 10000); }
    last = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // read-only world handle: __BT__.world may be an object or a getter function
  window.__H_W__ = () => {
    const B = window.__BT__; if (!B) return null;
    let w = null;
    try { w = B.world; if (typeof w === 'function') w = w.call(B); } catch (_) { w = null; }
    return w || null;
  };
  // event collector over __BT__.events(n): counts every event type seen, de-duplicating the
  // overlap between consecutive snapshots of the ring (events carry no ids).
  const EV = window.__H_EV__ = { counts: {}, total: 0, last: [], recent: [], polls: 0, err: null };
  const poll = () => {
    if (window.__H_EV_OFF__) return;          // perfcheck: never perturb the frames being measured
    const B = window.__BT__;
    if (!B || typeof B.events !== 'function') return;
    let arr;
    try { arr = B.events(512) || []; } catch (e) { EV.err = String(e); return; }
    EV.polls++;
    const S = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) { try { S[i] = JSON.stringify(arr[i]); } catch (_) { S[i] = String(arr[i] && arr[i].type); } }
    const old = EV.last;
    let k = 0;
    if (old.length && S.length) {
      for (let j = 0; j < old.length; j++) {
        if (old[j] !== S[0]) continue;
        const n = old.length - j;
        if (n > S.length) continue;
        let ok = true;
        for (let q = 1; q < n; q++) if (old[j + q] !== S[q]) { ok = false; break; }
        if (ok) { k = n; break; }
      }
    }
    for (let i = k; i < arr.length; i++) {
      const t = arr[i] && arr[i].type;
      EV.counts[t] = (EV.counts[t] || 0) + 1; EV.total++;
      EV.recent.push(S[i]); if (EV.recent.length > 200) EV.recent.shift();
    }
    EV.last = S;
  };
  setInterval(poll, 100);
})();
"""

# Which titan/biome card is focused on the select screen? Generic over the ui lane's DOM:
# (1) elements flagged selected/active/focused whose text names exactly ONE candidate;
# (2) fallback — the candidate whose exact name appears in more visible leaf elements than
#     the others (the lore column repeats the focused name next to its card).
FOCUS_JS = r"""
(names) => {
  const up = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.05;
  };
  const N = names.map(up);
  const sels = ['[aria-selected="true"]', '[aria-current="true"]', '[aria-current="step"]', '[aria-pressed="true"]',
    '[data-selected="true"]', '[data-focused="true"]', '[data-active="true"]', '.selected', '.is-selected',
    '.active', '.is-active', '.focused', '.is-focused', '.current', '.is-current', ':focus',
    '[class*="selected"]', '[class*="active"]', '[class*="focus"]', '[class*="current"]'];
  for (const sel of sels) {
    let els; try { els = document.querySelectorAll(sel); } catch (_) { continue; }
    let best = null, bestLen = Infinity;
    for (const el of els) {
      if (!vis(el)) continue;
      const t = up(el.textContent);
      const hit = N.filter((n) => t.includes(n));
      if (hit.length !== 1) continue;
      if (t.length < bestLen) { bestLen = t.length; best = hit[0]; }
    }
    if (best) return { name: best, how: sel };
  }
  const counts = N.map(() => 0);
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    if (!vis(el)) continue;
    const t = up(el.textContent);
    const i = N.indexOf(t);
    if (i >= 0) counts[i]++;
  }
  const mx = Math.max(...counts);
  if (mx >= 2 && counts.filter((c) => c === mx).length === 1) return { name: N[counts.indexOf(mx)], how: 'repeat-count' };
  const anyVisible = counts.some((c) => c > 0) || N.some((n) => up(document.body.innerText).includes(n));
  return { name: null, how: 'none', visible: anyVisible };
}
"""


class HarnessError(RuntimeError):
    pass


# ─────────────────────────────── small utils ───────────────────────────────
def percentile(vals, p):
    """Nearest-rank percentile (p in 0..100). Empty → None."""
    xs = sorted(v for v in vals if isinstance(v, (int, float)) and math.isfinite(v))
    if not xs:
        return None
    k = max(0, min(len(xs) - 1, int(math.ceil(p / 100.0 * len(xs))) - 1))
    return xs[k]


def fmt(v, nd=1):
    if v is None:
        return "—"
    if isinstance(v, float):
        if not math.isfinite(v):
            return str(v)
        return ("%%.%df" % nd) % v
    return str(v)


def owned_total(owned):
    """state().owned may be a count, an id list, or an id → stacks record."""
    if owned is None:
        return 0
    if isinstance(owned, bool):
        return int(owned)
    if isinstance(owned, (int, float)):
        return int(owned)
    if isinstance(owned, dict):
        tot = 0
        for v in owned.values():
            tot += int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 1
        return tot
    if isinstance(owned, (list, tuple)):
        return len(owned)
    return 0


def build_url(base, **params):
    q = {k: v for k, v in params.items() if v is not None and v is not False}
    for k, v in list(q.items()):
        if v is True:
            q[k] = 1
    b = base if base.endswith("/") or "?" in base or base.endswith(".html") else base + "/"
    if not q:
        return b
    return b + ("&" if "?" in b else "?") + urllib.parse.urlencode(q)


def world_to_keys(dx, dz, thresh=0.38):
    """World XZ direction → the WASD set whose screenToWorld() output points that way.
    screenToWorld: mx = c·ix − s·iy, mz = −s·ix − c·iy (c = s = √½, yaw 45°); the matrix is its
    own inverse, so ix = c·dx − s·dz, iy = −s·dx − c·dz."""
    m = math.hypot(dx, dz)
    if m < 1e-9:
        return set()
    dx, dz = dx / m, dz / m
    c = s = math.sqrt(0.5)
    ix = c * dx - s * dz
    iy = -s * dx - c * dz
    keys = set()
    if ix > thresh:
        keys.add("KeyD")
    elif ix < -thresh:
        keys.add("KeyA")
    if iy > thresh:
        keys.add("KeyW")
    elif iy < -thresh:
        keys.add("KeyS")
    return keys


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
    """Return None when the dev server already answers; otherwise start vite (localhost only)
    and return a handle for stop_server(). Raises HarnessError when it cannot be reached."""
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
    kw = {}
    if os.name == "nt":
        kw["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
    else:
        kw["start_new_session"] = True
    print("dev server not up at %s — starting `%s` (log %s)" % (base, cmd, log_path))
    proc = subprocess.Popen(cmd, cwd=ROOT, shell=True, stdout=logf, stderr=subprocess.STDOUT, **kw)
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
def _json_default(o):
    try:
        return str(o)
    except Exception:
        return None


def _clean(o):
    """JSON-safe copy: non-finite floats → None."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def save_report(name, data, base=DEFAULT_BASE, report_dir=None):
    """POST to <base>/__report/<name> (the vite plugin writes _harness/_reports/<name>.json);
    verify the file landed, else write it locally. Returns the path written."""
    payload = json.dumps(_clean(data), indent=2, default=_json_default).encode("utf-8")
    if report_dir is None or os.path.abspath(report_dir) == os.path.abspath(REPORTS):
        target = os.path.join(REPORTS, name + ".json")
        before = os.path.getmtime(target) if os.path.exists(target) else None
        try:
            u = urllib.parse.urlparse(base)
            url = "%s://%s/__report/%s" % (u.scheme or "http", u.netloc, urllib.parse.quote(name))
            req = urllib.request.Request(url, data=payload, method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as r:
                ok = 200 <= r.status < 300
            if ok:
                for _ in range(10):
                    if os.path.exists(target) and os.path.getmtime(target) != before:
                        return target
                    time.sleep(0.1)
        except Exception:
            pass
        report_dir = REPORTS
    os.makedirs(report_dir, exist_ok=True)
    path = os.path.join(report_dir, name + ".json")
    with open(path, "wb") as f:
        f.write(payload)
    return path


# ─────────────────────────────── CLI ───────────────────────────────
def add_common_args(ap: argparse.ArgumentParser):
    ap.add_argument("--base", default=DEFAULT_BASE, help="dev server root URL (default %(default)s)")
    ap.add_argument("--headless", action="store_true",
                    help="headless Chrome with the same d3d11 flags (real GPU on this box)")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--quality", type=int, choices=(0, 1, 2), default=None, help="?quality= override")
    ap.add_argument("--no-serve", action="store_true", help="never auto-start the dev server")
    ap.add_argument("--report-dir", default=None,
                    help="write the JSON report here instead of POST /__report (default _harness/_reports)")
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

    # context manager
    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def start(self):
        self._server = ensure_server(self.args.base, not getattr(self.args, "no_serve", False),
                                     getattr(self.args, "report_dir", None) or REPORTS)
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
            # "Failed to load resource: … 404" carries its URL only in the location — keep it, and
            # drop the browser's automatic favicon probe (not a defect of the game)
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
            # aborted range/media requests on navigation are not defects
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

    def wait_bt(self, timeout_s=60):
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.safe_js("() => !!(window.__BT__ && typeof window.__BT__.state === 'function')", default=False):
                return True
            time.sleep(0.25)
        return False

    def state(self):
        return self.safe_js("() => { try { return window.__BT__ ? window.__BT__.state() : null; }"
                            " catch (e) { return { __error: String(e && e.stack || e) }; } }")

    def screen(self):
        s = self.state()
        return s.get("screen") if isinstance(s, dict) else None

    def wait_screen(self, screens, timeout_s=60, poll=0.2):
        if isinstance(screens, str):
            screens = (screens,)
        deadline = time.time() + timeout_s
        last = None
        while time.time() < deadline:
            last = self.screen()
            if last in screens:
                return True, last
            time.sleep(poll)
        return False, last

    def has_world(self):
        return bool(self.safe_js("() => !!(window.__H_W__ && window.__H_W__())", default=False))

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

    def event_counts(self):
        return self.safe_js("() => (window.__H_EV__ && window.__H_EV__.counts) || {}", default={}) or {}

    def event_polls(self):
        return self.safe_js("() => (window.__H_EV__ && window.__H_EV__.polls) || 0", default=0) or 0

    def perf(self):
        return self.safe_js("() => { try { return window.__BT__ && window.__BT__.perf ? window.__BT__.perf() : null; }"
                            " catch (e) { return { __error: String(e) }; } }")

    def events_off(self):
        """Stop the harness event collector (it JSON-stringifies up to 512 events every 100 ms —
        fine for playtests, but it would add its own spikes to a frame-time measurement)."""
        self.safe_js("() => { window.__H_EV_OFF__ = true; }")

    def ft_start(self):
        self.safe_js("() => { window.__H_FT__ = []; window.__H_FT_ON__ = true; }")

    def ft_stop(self):
        return self.safe_js("() => { window.__H_FT_ON__ = false; return window.__H_FT__.slice(); }", default=[]) or []

    def cheat(self, name, *a):
        """Call __BT__.cheat.<name>(...a). Returns (ok, value_or_error)."""
        try:
            v = self.page.evaluate(
                "async ([n, a]) => { const c = window.__BT__ && window.__BT__.cheat;"
                " if (!c || typeof c[n] !== 'function') throw new Error('__BT__.cheat.' + n + ' unavailable (is ?dev=1 set?)');"
                " const r = await c[n](...a); return r === undefined ? null : r; }", [name, list(a)])
            return True, v
        except Exception as e:
            return False, str(e).splitlines()[0][:300]

    def bt_call(self, method, *a):
        try:
            v = self.page.evaluate(
                "async ([m, a]) => { const B = window.__BT__; if (!B || typeof B[m] !== 'function')"
                " throw new Error('__BT__.' + m + ' unavailable'); const r = await B[m](...a);"
                " return r === undefined ? null : r; }", [method, list(a)])
            return True, v
        except Exception as e:
            return False, str(e).splitlines()[0][:300]

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
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        try:
            self.page.screenshot(path=path, timeout=int(timeout_s * 1000))
            return True
        except Exception as e:
            self.page_errors.append("screenshot failed: %s" % str(e).splitlines()[0])
            return False

    # diagnostics
    def diagnostics(self):
        cerr = [t for (k, t) in self.console if k == "error" and not any(i in t for i in CONSOLE_IGNORE)]
        shader = [t for (k, t) in self.console if k in ("error", "warning") and any(m in t for m in SHADER_MARKERS)]
        warns = [t for (k, t) in self.console if k == "warning"]
        return {
            "consoleErrors": cerr,
            "shader": shader,
            "warnings": warns,
            "pageErrors": [e for e in self.page_errors if not e.startswith("screenshot failed")],
            "screenshotErrors": [e for e in self.page_errors if e.startswith("screenshot failed")],
            "windowErrors": self.window_errors() if self.page else [],
            "failedRequests": list(self.failed),
        }


def print_diagnostics(d, limit=30):
    for key, label, mark in (("consoleErrors", "console errors", "!"), ("pageErrors", "page errors", "!!"),
                             ("windowErrors", "window errors", "!!!"), ("shader", "shader/GL diagnostics", "~"),
                             ("failedRequests", "failed requests", "x")):
        items = d.get(key) or []
        print("%s (%d):" % (label, len(items)))
        for t in items[:limit]:
            print("  %s %s" % (mark, str(t)[:500]))
    w = d.get("warnings") or []
    if w:
        print("warnings (%d, not gating):" % len(w))
        for t in w[:8]:
            print("  - %s" % str(t)[:240])


def diag_problems(d):
    """Gate-relevant diagnostic failures (a list of human strings; empty = clean)."""
    out = []
    for key, label in (("consoleErrors", "console error"), ("pageErrors", "page error"),
                       ("windowErrors", "window error / unhandled rejection"), ("shader", "shader/GL diagnostic"),
                       ("failedRequests", "failed request")):
        n = len(d.get(key) or [])
        if n:
            out.append("%d %s(s)" % (n, label))
    return out


# ─────────────────────────────── menus (real keys) ───────────────────────────────
def detect_focus(sess, names):
    r = sess.safe_js(FOCUS_JS, list(names), default=None)
    if isinstance(r, dict):
        return r.get("name"), r
    return None, {"how": "eval-failed"}


def navigate_cards(sess, ids, names_map, want, log=print, max_steps=12):
    """Arrow-key navigate a card row/grid until `want` is focused. Returns (ok, how)."""
    names = [names_map[i].upper() for i in ids]
    want_name = names_map[want].upper()
    ti = ids.index(want)
    cur, info = detect_focus(sess, names)
    if cur is None:
        # blind: assume the first card is focused (select screens open on card 0 or on ?titan=)
        log("    focus not detectable (%s) — blind navigation from card 0" % info.get("how"))
        for _ in range(ti):
            sess.press("ArrowRight")
            time.sleep(0.2)
        return True, "blind"
    steps = 0
    stuck = 0
    while cur != want_name and steps < max_steps:
        ci = names.index(cur) if cur in names else 0
        key = "ArrowRight" if ti > ci else "ArrowLeft"
        if stuck == 1:
            key = "ArrowDown" if ti > ci else "ArrowUp"
        elif stuck >= 2:
            key = "ArrowUp" if ti > ci else "ArrowDown"
        sess.press(key)
        time.sleep(0.22)
        steps += 1
        nxt, _ = detect_focus(sess, names)
        if nxt == cur:
            stuck += 1
        else:
            stuck = 0
        cur = nxt if nxt else cur
        log("    %s → focus %s" % (key, cur))
    return cur == want_name, "detected (%d key presses)" % steps


def menus_to_slate(sess, titan, biome, log=print, snap=None, timeout_s=90):
    """From the TITLE screen, drive the real menus with keys to the open slate.
    `snap(name)` is called at each step (title, select_titan, select_biome).
    Returns (ok, detail dict)."""
    detail = {"steps": []}
    ok, scr = sess.wait_screen(("title", "select"), 60)
    detail["firstScreen"] = scr
    if not ok:
        detail["error"] = "never reached the title screen (screen=%r)" % (scr,)
        return False, detail
    if scr == "title":
        time.sleep(0.8)
        if snap:
            snap("title")
        deadline = time.time() + 15
        while time.time() < deadline and sess.screen() == "title":
            sess.press("Enter")
            time.sleep(0.9)
        if sess.screen() != "select":
            detail["error"] = "Enter on the title did not open the select screen (screen=%r)" % (sess.screen(),)
            return False, detail
    detail["steps"].append("title→select")
    time.sleep(1.2)                                    # portraits + card layout settle
    if snap:
        snap("select_titan")
    ok_t, how_t = navigate_cards(sess, TITANS, TITAN_NAMES, titan, log)
    detail["titanNav"] = how_t
    if not ok_t:
        detail["error"] = "could not focus the %s card with arrow keys" % TITAN_NAMES[titan]
        return False, detail
    sess.press("Enter")
    time.sleep(0.8)
    bnames = [BIOME_NAMES[b] for b in BIOMES]
    cur, info = detect_focus(sess, bnames)
    if cur is None and not info.get("visible") and sess.screen() == "select":
        log("    biome cards not visible after Enter — pressing Enter once more (confirm bar)")
        sess.press("Enter")
        time.sleep(0.8)
    detail["steps"].append("titan confirmed")
    if snap:
        snap("select_biome")
    ok_b, how_b = navigate_cards(sess, BIOMES, BIOME_NAMES, biome, log)
    detail["biomeNav"] = how_b
    if not ok_b:
        detail["error"] = "could not focus the %s card with arrow keys" % BIOME_NAMES[biome]
        return False, detail
    sess.press("Enter")
    detail["steps"].append("biome confirmed (DROP IN)")
    ok, scr = sess.wait_screen(("slate", "play"), timeout_s)
    detail["afterDrop"] = scr
    if not ok:
        detail["error"] = "never reached the slate after DROP IN (screen=%r)" % (scr,)
        return False, detail
    s = sess.state() or {}
    detail["titan"] = s.get("titan")
    detail["biome"] = s.get("biome")
    if s.get("titan") != titan or s.get("biome") != biome:
        detail["error"] = "menus landed on %s/%s, wanted %s/%s" % (s.get("titan"), s.get("biome"), titan, biome)
        return False, detail
    return True, detail


def xp_to_next(level):
    """Mirror of config.ts xpToNext(level) = round(8 + 6·level^1.35)."""
    return int(round(8 + 6 * math.pow(max(1, int(level or 1)), 1.35)))


def set_rank(sess, idx, log=print, settle_s=0.0):
    """cheat.rank() to Size index `idx` (0..4). The contract names `cheat.rank(r)` without saying
    whether r is the RankIndex (0..4) or the roman numeral (1..5): call it with the index, read
    state().rank back, and retry with idx+1 if the app read it 1-based. Returns (ok, rank_seen)."""
    ok, v = sess.cheat("rank", idx)
    if not ok:
        return False, v
    time.sleep(0.25)
    r = (sess.state() or {}).get("rank")
    if r == idx - 1 and idx < 5:
        log("    cheat.rank(%d) landed on rank index %s — the app reads it 1-based; retrying rank(%d)" % (idx, r, idx + 1))
        sess.cheat("rank", idx + 1)
        time.sleep(0.25)
        r = (sess.state() or {}).get("rank")
    if settle_s > 0:
        time.sleep(settle_s)
    return r == idx, r


def ensure_play(sess, timeout_s=15, log=None):
    """Clear whatever overlay owns the game (draft → key 1, pause → Esc, slate → Enter) until
    `play`. Real key presses only. Returns (ok, screen)."""
    deadline = time.time() + timeout_s
    scr = None
    while time.time() < deadline:
        scr = sess.screen()
        if scr == "play":
            return True, scr
        if scr in ("draft", "pause", "slate"):
            # core/input.ts marks keys held across a game⇄ui flip DEAD until released: let go of the
            # movement keys now so the caller's next hold() is a fresh, live press
            sess.release_all()
        if scr == "draft":
            if log:
                log("    draft open — pressing 1")
            sess.press("Digit1")
            time.sleep(0.7)
        elif scr == "pause":
            sess.press("Escape")
            time.sleep(0.6)
        elif scr == "slate":
            sess.press("Enter")
            time.sleep(0.8)
        else:
            time.sleep(0.3)
    scr = sess.screen()
    return scr == "play", scr


def dismiss_slate(sess, timeout_s=20, key="Enter"):
    """Press a real key until the slate gives way to play. Returns (ok, screen)."""
    deadline = time.time() + timeout_s
    scr = sess.screen()
    while time.time() < deadline:
        scr = sess.screen()
        if scr == "play":
            return True, scr
        if scr == "slate":
            sess.press(key)
        time.sleep(0.8)
    scr = sess.screen()
    return scr == "play", scr


def compact_state(s):
    """The fields worth printing from __BT__.state()."""
    if not isinstance(s, dict):
        return s
    keep = ("screen", "titan", "biome", "seed", "t", "tick", "rank", "height", "level", "xp", "hp", "maxHp",
            "mass", "x", "z", "heading", "enemies", "pickups", "floorsEaten", "buildingsLeveled", "propsEaten",
            "kills", "crushed", "drafts", "owned", "boss", "run", "fps", "draws", "tris", "programs")
    out = {}
    for k in keep:
        if k in s:
            v = s[k]
            if isinstance(v, float) and math.isfinite(v):
                v = round(v, 3)
            if k == "owned" and isinstance(v, (dict, list)) and len(v) > 12:
                v = "%d ids / %d stacks" % (len(v), owned_total(v))
            out[k] = v
    if "__error" in s:
        out["__error"] = s["__error"]
    return out
