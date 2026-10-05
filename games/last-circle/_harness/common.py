#!/usr/bin/env python
"""Last Circle harness - shared launch, serve, observe and verdict helpers (lane L1).

Adapted from games/dyefield/_harness/common.py (INIT_JS, the ERR_ABORTED rule of _on_reqfail, the shader
error/warning split, diag_problems) for a game with no build step: runtime/ is served as-is.

Every browser gate goes through `Session`:

  * Chrome (Playwright channel "chrome"), HEADLESS by default. Pointer lock works in headless Chrome
    (verified 2026-09-30: a real click on a canvas -> document.pointerLockElement set, movementX = 200 for
    a 200 px move), so no gate needs a window that steals the user's focus. `--headed` is there for eyes.
  * `--base` (default http://127.0.0.1:8790/games/last-circle/index.html) is the scoped static server.
    `--disk` serves the game directory READ-ONLY from the working copy through context.route: the page
    keeps the same URL (so the sitelock and every relative import are unchanged) but no request reaches the
    :8790 server, which refuses connections under load (harness-gates E1). Nothing outside
    games/last-circle is ever served, and the repo root (which holds .env) never is.
  * collectors: console errors / warnings, page errors, window errors + unhandled rejections (init
    script), failed requests (HTTP >= 400 and network failures; ERR_ABORTED is skipped as in DYEFIELD, a
    GLB fetch aborted by a navigation is not a defect), shader / GL diagnostics, `[rig]` warnings (the
    three.js PropertyBinding "No target node found" line is ALLOW-LISTED and counted separately until lane
    L5 drops the finger tracks), a harness-owned rAF counter, a pointer-lock timeline and every
    AudioBufferSourceNode.start(when, offset, duration) with the event being dispatched at that moment.
  * `step_frames()` pumps the kernel directly (tweens -> mixers -> updaters -> render), so view gates never
    wait on requestAnimationFrame, which is starved on this shared box (harness-gates E2). When the game
    exposes `__LC__.stepFrames(n, dt, render)` (contract C9, lane L4) that is used instead.
  * `start_match()` is the lobby helper: startMatch() resolves when the lobby is shown, then a REAL Enter
    key press skips it so W.phase really reaches "drop" / "match" (bots S5: the old probes ran with the
    storm off because the lobby never ended).

Verdicts: every gate prints one table and exits 0 = pass, 1 = fail, 2 = could not judge. A check that
cannot be judged because of the ENVIRONMENT (server refused, rAF starved on a check that needs rAF, GPU
lost, a browser that never starts) is recorded as could-not-judge, never as a pass and never as a game
failure. A real failure beats could-not-judge (exit 1).

stdout/stderr are forced to UTF-8 (Windows consoles default to cp1252).
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import mimetypes
import os
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                  # games/last-circle
GAMES = os.path.dirname(ROOT)
REPO = os.path.dirname(GAMES)                                 # forgeflow-games
REPORTS = os.path.join(HERE, "_reports")
SHOTS = os.path.join(HERE, "_shots")
GAME_PATH = "/games/last-circle/"
DEFAULT_BASE = "http://127.0.0.1:8790" + GAME_PATH + "index.html"
MAPS = ["isla_viva", "ashgrid", "deepwood"]                   # hud.js BATTLE_MAPS

# Real d3d11 ANGLE, occlusion off, no background throttling (dyefield FLAGS) + precise heap numbers.
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-precise-memory-info",
]
GPU_PROFILES = {
    "d3d11": [],
    # live-measure: on this box the ONLY config in which rAF runs (vsync'd presentation goes through the
    # Intel iGPU that dwm + the DisplayLink host hold at ~95%)
    "dgpu": ["--force_high_performance_gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
    # mobile lane: the iGPU is saturated by other lanes; SwiftShader keeps touch checks CPU-bound
    "swiftshader": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
}

SHADER_MARKERS = (
    "THREE.WebGLProgram", "THREE.WebGLShader", "Shader Error", "Program Info Log",
    "VALIDATE_STATUS", "getShaderInfoLog", "GL_INVALID", "WebGL: INVALID", "ERROR: 0:",
    "[.WebGL-",
)
CONSOLE_IGNORE = ("favicon.ico",)
# GPU-PROCESS failures (the box's GPU / SwiftShader, not the game): a WebGL context that the browser could not create at
# all. Reported as `envErrors` (could-not-judge evidence), never as game console errors. 22:04 mobile run, iPad emulation
# on SwiftShader: "Could not create a WebGL context ... ErrorMessage = BindToCurrentSequence failed".
ENV_CONSOLE = ("BindToCurrentSequence failed", "Error creating WebGL context with your selected attributes",
               "A WebGL context could not be created", "GPU process isn't usable", "GPU process exited")
# three.js logs one line per clip track whose bone is missing. harness-gates E3/E10: ~186 per match, all
# Mixamo finger bones (Middle/Ring/Pinky 1-3) that the Last Circle rigs do not have. Allow-listed (counted,
# printed, not gating) until lane L5 drops trackless tracks at load (PLAN L5 h). Remove this once L5 lands.
ALLOW_WARN = ("THREE.PropertyBinding: No target node found for track",)
RIG_MARK = "[rig]"


def is_shader_error(kind, text):
    """dyefield rule: a shader/GL diagnostic is an ERROR when the console reported it as an error or its log
    carries a compile/link error; a program info log holding only compiler warnings is a warning."""
    if kind == "error":
        return True
    t = text
    if "Shader Error" in t or "ERROR: 0:" in t or "VALIDATE_STATUS false" in t or "GL_INVALID" in t or "WebGL: INVALID" in t:
        return True
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    body = [ln for ln in lines if "warning X" not in ln and not ln.startswith("THREE.WebGLProgram: Program Info Log")]
    return any("error" in ln.lower() for ln in body)


# ─────────────────────────────── init script (every document) ───────────────────────────────
INIT_JS = r"""
(() => {
  if (window.__H_INIT__) return; window.__H_INIT__ = true;
  window.__H_ERR__ = [];
  addEventListener('error', (e) => { try {
    if (e && e.target && e.target !== window && (e.target.src || e.target.href)) return;   // resource errors: collected as failed requests
    window.__H_ERR__.push(String((e && (e.message || (e.error && e.error.stack))) || e) + (e && e.filename ? ' @' + e.filename + ':' + e.lineno : ''));
  } catch (_) {} }, true);
  addEventListener('unhandledrejection', (e) => {
    try { const r = e && e.reason; window.__H_ERR__.push('unhandledrejection: ' + (r && (r.stack || r.message) || String(r))); } catch (_) {}
  });
  // harness-owned rAF counter (independent of the game's loop)
  window.__H_FRAMES__ = 0;
  const tick = () => { window.__H_FRAMES__++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // timeline + pointer-lock observations
  window.__H_EV__ = []; const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const ev = (m) => { if (window.__H_EV__.length < 400) window.__H_EV__.push(now().toFixed(2) + 's ' + m); };
  const L = window.__H_LOCK__ = { changes: 0, errors: 0, locked: false, lastOn: null, losses: [], requests: 0 };
  document.addEventListener('pointerlockchange', () => {
    L.changes++; L.locked = !!document.pointerLockElement;
    if (L.locked) { L.lastOn = now(); ev('pointerlock ON'); return; }
    // alive/phase: a death screen releases the cursor BY DESIGN (hud releaseCursor), so gates judge lock losses while alive
    let alive = null, phase = null;
    try { const W = window.__LC__ && window.__LC__.W; if (W) { phase = W.phase || null; alive = W.player ? !!W.player.alive : null; } } catch (_) {}
    L.losses.push({ t: now(), hasFocus: document.hasFocus(), visibility: document.visibilityState, alive, phase });
    ev('pointerlock OFF');
  });
  document.addEventListener('pointerlockerror', () => { L.errors++; ev('pointerlockerror'); });
  try {
    const rpl = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function () { L.requests++; window.__H_LOCKREQ__ = L.requests; return rpl.apply(this, arguments); };
    window.__H_LOCKREQ__ = 0;
  } catch (_) {}
  addEventListener('blur', () => ev('window blur'));
  addEventListener('focus', () => ev('window focus'));
  document.addEventListener('visibilitychange', () => ev('visibility ' + document.visibilityState));
  // every AudioBufferSourceNode.start(when, offset, duration) and the game event being dispatched then
  // (window.__H_TAG__ is set by the W.events.emit wrapper installed after __LC__ exists)
  window.__H_AUD__ = [];
  try {
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, off, dur) {
      try { if (window.__H_AUD__.length < 5000) window.__H_AUD__.push({ buf: this.buffer, off: off || 0, dur: dur, tag: window.__H_TAG__ || null,
              tagArgs: window.__H_TAGARGS__ || null, t: performance.now() }); } catch (_) {}
      return S.apply(this, arguments);
    };
  } catch (_) {}
})();
"""

# Installed after __LC__ exists: W.events.emit wrapper (tags audio starts with the dispatching event and
# keeps a small event log) + a W.events.emit counter per event name.
EVENTS_JS = r"""() => {
  const W = window.__LC__ && window.__LC__.W;
  if (!W || !W.events) return 'no W.events';
  if (W.events.__h) return 'already';
  const emit = W.events.emit;
  const C = window.__H_EVC__ = {};
  window.__H_EVLOG__ = [];
  W.events.emit = function (name) {
    C[name] = (C[name] || 0) + 1;
    const prev = window.__H_TAG__, prevA = window.__H_TAGARGS__;
    window.__H_TAG__ = name;
    try {
      const a1 = arguments[1];
      window.__H_TAGARGS__ = { own: !!(a1 && W.player && a1 === W.player), a2: typeof arguments[2] === 'string' ? arguments[2] : null };
    } catch (_) { window.__H_TAGARGS__ = null; }
    if (window.__H_EVLOG__.length < 3000) window.__H_EVLOG__.push([name, +(W.t || 0).toFixed(3), window.__H_TAGARGS__ && window.__H_TAGARGS__.own]);
    try { return emit.apply(this, arguments); } finally { window.__H_TAG__ = prev; window.__H_TAGARGS__ = prevA; }
  };
  W.events.__h = true;
  return 'ok';
}"""

# The harness frame pump: the body of Kernel3D.start()'s loop (ffg_kernel_3d.js start()) without
# requestAnimationFrame. Prefers the game's own __LC__.stepFrames (contract C9) when it exists.
PUMP_JS = r"""() => {
  if (window.__H_PUMP__) return 'already';
  const C = window.__LC__, W = C.W, k = W.kernel, r = k.renderer;
  const P = window.__H_PUMP__ = { frames: 0, rendered: 0, native: typeof C.stepFrames === 'function' };
  P.frame = (dt, doRender) => {
    if (typeof k._stepTweens === 'function') k._stepTweens(dt);
    if (k.world) {
      k.world.step(1 / 60, dt, 3);
      for (let i = k._phys.length - 1; i >= 0; i--) {
        const q = k._phys[i];
        if (q.mesh) { q.mesh.position.copy(q.body.position); q.mesh.quaternion.copy(q.body.quaternion); }
      }
    }
    try { k.clock.elapsedTime += dt; } catch (_) {}
    for (let i = 0; i < k._mixers.length; i++) {
      const m = k._mixers[i];
      if (m._ffgSkip === true) continue;                    // contract C4 (lane L3) - harmless before it lands
      m.update(dt);
    }
    for (const u of k._updaters) u(dt, k.clock.elapsedTime);
    if (doRender) {
      if (P.onBeforeRender) P.onBeforeRender();
      if (k.composer) k.composer.render(dt); else r.render(k.scene, k.camera);
      P.rendered++;
      if (P.onAfterRender) P.onAfterRender();
    }
    P.frames++;
  };
  P.step = (n, dt, render) => {
    // render: true = every frame, false = none, number N = every Nth frame (and always the last one)
    if (P.native && !P.onBeforeRender && !P.onAfterRender && (render === true || render === false)) {
      C.stepFrames(n, dt, render); P.frames += n; if (render) P.rendered += n; return { native: true, n };
    }
    for (let i = 0; i < n; i++) {
      const doR = render === true ? true : (render === false || !render) ? false : ((i + 1) % render === 0 || i === n - 1);
      P.frame(dt, doR);
    }
    return { native: false, n };
  };
  return 'ok';
}"""


class HarnessError(RuntimeError):
    pass


class EnvFailure(RuntimeError):
    """The environment, not the game, prevented a judgement (exit 2)."""


class GameError(RuntimeError):
    """Game code threw while the harness drove it (exit 1)."""


# ─────────────────────────────── small utils ───────────────────────────────
def fmt(v, nd=2):
    if v is None:
        return "-"
    if isinstance(v, float):
        if not math.isfinite(v):
            return str(v)
        return ("%%.%df" % nd) % v
    return str(v)


def stamp():
    return time.strftime("%Y%m%d_%H%M%S")


def build_url(base, **params):
    q = {k: v for k, v in params.items() if v is not None and v is not False}
    for k, v in list(q.items()):
        if v is True:
            q[k] = 1
    if not q:
        return base
    return base + ("&" if "?" in base else "?") + urllib.parse.urlencode(q)


def url_reachable(url, timeout=5.0):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "lc-harness"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception:
        return False


def _clean(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)):
        return [_clean(v) for v in o]
    return o


def save_report(name, data, out=None):
    """Write _harness/_reports/<name>_<stamp>.json and _harness/_reports/<name>.json (latest)."""
    os.makedirs(REPORTS, exist_ok=True)
    payload = json.dumps(_clean(data), indent=1, default=str)
    paths = [out] if out else [os.path.join(REPORTS, "%s_%s.json" % (name, stamp())), os.path.join(REPORTS, name + ".json")]
    for p in paths:
        os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(payload)
    return paths[0]


# ─────────────────────────────── other automated Chromes (box contention evidence) ───────────────────────────────
_PS_SCAN = (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "
    "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { "
    "([string]$_.CommandLine) -notmatch '--type=' -and ([string]$_.CommandLine) -match '--remote-debugging-pipe|--enable-automation' "
    "} | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; headless=([string]$_.CommandLine -match '--headless') } }) "
    "| ConvertTo-Json -Compress -Depth 2"
)


def automated_chromes():
    """Automated Chrome BROWSER processes alive now (dyefield's contamination rule). Returns (count, error)."""
    if os.name != "nt":
        return None, "not windows"
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_SCAN],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
        t = (r.stdout or "").strip()
        rows = json.loads(t) if t else []
        if isinstance(rows, dict):
            rows = [rows]
        return len(rows), None
    except Exception as e:
        return None, str(e).splitlines()[0][:200]


# ─────────────────────────────── verdict ───────────────────────────────
class Verdict:
    """One gate's checks. ok: True pass, False fail, None could-not-judge; kind 'info' never gates."""

    def __init__(self, gate, args=None):
        self.gate = gate
        self.args = args
        self.rows = []
        self.notes = []
        self.data = {}
        self.t0 = time.time()
        self.started = time.strftime("%Y-%m-%d %H:%M:%S")

    def check(self, name, ok, detail="", expect=None):
        self.rows.append({"name": name, "ok": ok, "kind": "gate", "detail": detail, "expect": expect})
        tag = {True: "PASS", False: "FAIL", None: "CNJ "}[ok if ok in (True, False) else None]
        print("  %-4s %s :: %s" % (tag, name, _short(detail)), flush=True)
        return ok

    def cnj(self, name, why):
        return self.check(name, None, why)

    def info(self, name, detail=""):
        self.rows.append({"name": name, "ok": None, "kind": "info", "detail": detail})
        print("  INFO %s :: %s" % (name, _short(detail)), flush=True)

    def note(self, msg):
        self.notes.append(msg)
        print("  NOTE %s" % msg, flush=True)

    def code(self):
        g = [r for r in self.rows if r["kind"] == "gate"]
        if any(r["ok"] is False for r in g):
            return 1
        if not g or any(r["ok"] is None for r in g):
            return 2
        return 0

    def finish(self, extra=None, report_name=None, out=None):
        code = self.code()
        label = {0: "PASS", 1: "FAIL", 2: "COULD-NOT-JUDGE"}[code]
        g = [r for r in self.rows if r["kind"] == "gate"]
        print("")
        print("=" * 100)
        print("%s verdict table (%s, %.0f s)" % (self.gate, self.started, time.time() - self.t0))
        for r in g:
            tag = {True: "PASS", False: "FAIL"}.get(r["ok"], "CNJ ")
            print("  %-4s  %s" % (tag, r["name"]))
        fails = [r["name"] for r in g if r["ok"] is False]
        cnjs = [r["name"] for r in g if r["ok"] is None]
        print("VERDICT %s: %s  (%d pass, %d fail, %d could-not-judge)%s" % (
            self.gate, label, sum(1 for r in g if r["ok"] is True), len(fails), len(cnjs),
            ("  first fail: " + fails[0]) if fails else (("  cnj: " + cnjs[0]) if cnjs else "")))
        rep = {"gate": self.gate, "verdict": label, "exit": code, "started": self.started,
               "wall_s": round(time.time() - self.t0, 1), "argv": sys.argv[1:], "checks": self.rows, "notes": self.notes}
        rep.update(self.data)
        if extra:
            rep.update(extra)
        try:
            p = save_report(report_name or self.gate, rep, out)
            print("REPORT %s" % p)
        except Exception as e:
            print("report write failed: %s" % e)
        return code


def _short(d, n=420):
    try:
        s = d if isinstance(d, str) else json.dumps(_clean(d), default=str)
    except Exception:
        s = str(d)
    return s if len(s) <= n else s[:n] + "..."


def run_gate(gate, main_fn, args):
    """Run main_fn(verdict) with environment failures mapped to exit 2 and harness bugs to exit 2 + trace."""
    v = Verdict(gate, args)
    if getattr(args, "rev", None):
        args.disk = True
        v.data["servedFrom"] = "git %s (%s)" % (args.rev, git_blobs(args.rev).sha)
    else:
        v.data["servedFrom"] = "working copy via page routing" if getattr(args, "disk", False) else args.base
    print("%s: serving %s" % (gate, v.data["servedFrom"]), flush=True)
    n, err = automated_chromes()
    v.data["otherAutomatedChromes"] = n if err is None else ("unknown: " + err)
    print("%s: other automated Chromes on the box: %s" % (gate, v.data["otherAutomatedChromes"]), flush=True)
    try:
        main_fn(v)
    except EnvFailure as e:
        v.cnj("environment", str(e))
    except KeyboardInterrupt:
        v.cnj("interrupted", "KeyboardInterrupt")
    except GameError as e:
        v.check("game threw inside a harness step", False, str(e)[:900])
    except Exception as e:
        tb = traceback.format_exc()
        msg = str(e).splitlines()[0][:400] if str(e) else type(e).__name__
        # a JS error thrown by GAME code while the harness drove it (evaluate) is a game failure, not the environment
        if "Page.evaluate:" in str(e) and "/runtime/" in str(e):
            v.check("game threw inside a harness step", False, " | ".join(str(e).splitlines()[:6])[:900])
            v.data["traceback"] = tb[-3000:]
            return v.finish(report_name=getattr(args, "report", None) or gate, out=getattr(args, "out", None))
        # Playwright timeouts / target crashes on this shared box are environment until shown otherwise
        env = any(s in tb for s in ("Target page, context or browser has been closed", "Browser closed", "ERR_CONNECTION_REFUSED",
                                    "Connection closed while reading from the driver"))
        v.cnj("harness exception" + (" (environment)" if env else ""), msg)
        v.data["traceback"] = tb[-4000:]
        print(tb[-2500:])
    return v.finish(report_name=getattr(args, "report", None) or gate, out=getattr(args, "out", None))


# ─────────────────────────────── CLI ───────────────────────────────
def add_common_args(ap: argparse.ArgumentParser):
    ap.add_argument("--base", default=DEFAULT_BASE, help="game index URL (default %(default)s)")
    ap.add_argument("--disk", action="store_true",
                    help="serve games/last-circle READ-ONLY from the working copy via page routing (no server needed)")
    ap.add_argument("--rev", default=None, metavar="GITREV",
                    help="serve games/last-circle as committed at GITREV (implies --disk): a frozen build while lanes edit the tree")
    ap.add_argument("--headed", action="store_true", help="headed Chrome (default headless; pointer lock works headless)")
    ap.add_argument("--gpu", default="d3d11", choices=sorted(GPU_PROFILES), help="Chrome GPU profile (default %(default)s)")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--chrome-arg", action="append", default=[], metavar="SWITCH", help="extra Chrome switch (repeatable)")
    ap.add_argument("--report", default=None, help="report name under _harness/_reports/")
    ap.add_argument("--out", default=None, help="write the JSON report to this exact path instead")
    ap.add_argument("--boot-timeout", type=float, default=300.0, help="seconds to wait for __LC__ (the box is shared)")
    ap.add_argument("--load-timeout", type=float, default=1500.0,
                    help="seconds to wait for a match load (measured 106-600+ s with 9-12 other Chromes on this box)")
    return ap


# ─────────────────────────────── disk server (page routing) ───────────────────────────────
CTYPES = {".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
          ".html": "text/html; charset=utf-8", ".css": "text/css", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
          ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".wasm": "application/wasm",
          ".txt": "text/plain", ".bin": "application/octet-stream", ".ico": "image/x-icon", ".woff2": "font/woff2"}


def disk_file_for(url_path):
    """Map /games/last-circle/<rel> to a file under ROOT, or None (outside the game dir / missing)."""
    if not url_path.startswith(GAME_PATH):
        return None
    rel = urllib.parse.unquote(url_path[len(GAME_PATH):]) or "index.html"
    full = os.path.realpath(os.path.join(ROOT, rel.replace("/", os.sep)))
    root = os.path.realpath(ROOT)
    if full != root and not full.startswith(root + os.sep):
        return None
    if os.path.isdir(full):
        full = os.path.join(full, "index.html")
    return full if os.path.isfile(full) else None


class GitBlobs:
    """Read games/last-circle/<rel> as committed at a git revision (one `git cat-file --batch` process).
    `--rev <commit>` serves a FROZEN build while other lanes edit the working copy - the stable "before" column."""

    def __init__(self, rev):
        self.rev = rev
        self.cache = {}
        self.proc = subprocess.Popen(["git", "-C", REPO, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)
        sha = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", rev], capture_output=True, text=True).stdout.strip()
        if not sha:
            raise HarnessError("unknown git revision %r" % rev)
        self.sha = sha

    def read(self, rel):
        if rel in self.cache:
            return self.cache[rel]
        spec = "%s:games/last-circle/%s\n" % (self.rev, rel)
        self.proc.stdin.write(spec.encode("utf-8"))
        self.proc.stdin.flush()
        header = self.proc.stdout.readline().decode("utf-8", "replace").strip()
        parts = header.split()
        if len(parts) < 3 or parts[1] != "blob":
            self.cache[rel] = None
            return None
        size = int(parts[2])
        data = b""
        while len(data) < size:
            chunk = self.proc.stdout.read(size - len(data))
            if not chunk:
                break
            data += chunk
        self.proc.stdout.read(1)                 # trailing newline
        self.cache[rel] = data
        return data


_GIT = {}


def git_blobs(rev):
    if rev not in _GIT:
        _GIT[rev] = GitBlobs(rev)
    return _GIT[rev]


class DiskServer:
    """context.route handler serving the game dir for a set of origins (read-only; working copy or a git revision)."""

    def __init__(self, origins, rev=None):
        self.origins = [o.rstrip("/") for o in origins]
        self.served = 0
        self.missing = []
        self.overrides = []          # (predicate(url) -> bool, handler(route) -> None) checked first
        self.git = git_blobs(rev) if rev else None

    def matches(self, url):
        return any(url.startswith(o + "/") or url == o for o in self.origins)

    def handle(self, route):
        url = route.request.url
        for pred, fn in self.overrides:
            try:
                if pred(url):
                    return fn(route)
            except Exception:
                pass
        u = urllib.parse.urlparse(url)
        if self.git is not None:
            rel = urllib.parse.unquote(u.path[len(GAME_PATH):]) if u.path.startswith(GAME_PATH) else None
            if rel is not None and (rel == "" or rel.endswith("/")):
                rel += "index.html"
            body = self.git.read(rel) if rel and ".." not in rel.split("/") else None
            if body is None:
                self.missing.append(u.path)
                return route.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"})
            path = rel
        else:
            path = disk_file_for(u.path)
            if path is None:
                self.missing.append(u.path)
                return route.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"})
            try:
                with open(path, "rb") as f:
                    body = f.read()
            except Exception as e:
                return route.fulfill(status=500, body="read failed: %s" % e)
        ext = os.path.splitext(path)[1].lower()
        ct = CTYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.served += 1
        route.fulfill(status=200, body=body, headers={"Content-Type": ct, "Cache-Control": "no-store",
                                                        "Access-Control-Allow-Origin": "*"})


# ─────────────────────────────── browser session ───────────────────────────────
class Session:
    """One Chrome + one context + one page with every collector attached."""

    def __init__(self, args, name="harness", viewport=None, context_kw=None, launch_args=None, init_scripts=None,
                 extra_origins=None, pw=None):
        self.args = args
        self.name = name
        self.viewport = viewport or {"width": getattr(args, "width", 1280), "height": getattr(args, "height", 720)}
        self.context_kw = context_kw or {}
        self.launch_args = launch_args or []
        self.init_scripts = init_scripts or []
        self.extra_origins = extra_origins or []
        self.console = []          # (type, text)
        self.page_errors = []
        self.failed = []
        self.refused = []
        self.held = set()
        self._pw_owned = pw is None
        self._pw = pw
        self.browser = self.context = self.page = None
        self.disk = None
        self._cdp = None
        self._stage = "boot"

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    @property
    def base(self):
        return self.args.base

    def origin(self):
        u = urllib.parse.urlparse(self.args.base)
        return "%s://%s" % (u.scheme, u.netloc)

    def start(self):
        if getattr(self.args, "rev", None):
            self.args.disk = True
        disk = bool(getattr(self.args, "disk", False))
        if not disk and not url_reachable(self.args.base):
            raise EnvFailure("server not reachable / refused at %s (use --disk to serve the working copy)" % self.args.base)
        from playwright.sync_api import sync_playwright
        if self._pw is None:
            self._pw = sync_playwright().start()
        headless = not bool(getattr(self.args, "headed", False))
        flags = list(FLAGS)
        prof = GPU_PROFILES.get(getattr(self.args, "gpu", "d3d11") or "d3d11", [])
        if any(a.startswith("--use-angle") for a in prof):
            flags = [a for a in flags if not a.startswith("--use-angle")]
        flags += prof + list(self.launch_args) + [a for a in (getattr(self.args, "chrome_arg", None) or []) if a]
        try:
            self.browser = self._pw.chromium.launch(channel="chrome", headless=headless, args=flags)
        except Exception as e:
            raise EnvFailure("Chrome did not launch: %s" % str(e).splitlines()[0][:200])
        kw = dict(viewport=self.viewport, device_scale_factor=1)
        kw.update(self.context_kw)
        self.context = self.browser.new_context(**kw)
        self.context.add_init_script(INIT_JS)
        for s in self.init_scripts:
            self.context.add_init_script(s)
        if disk:
            self.disk = DiskServer([self.origin()] + list(self.extra_origins), getattr(self.args, "rev", None))
            self.context.route(lambda url: self.disk.matches(url), self.disk.handle)
        self.page = self.context.new_page()
        self.page.set_default_timeout(120_000)
        self.wire(self.page)

    def wire(self, page):
        page.on("console", self._on_console)
        page.on("pageerror", lambda e: self.page_errors.append((self._stage, str(e)[:1500])))
        page.on("requestfailed", self._on_reqfail)
        page.on("response", self._on_response)

    def close(self):
        try:
            self.release_all()
        except Exception:
            pass
        for obj, meth in ((self.browser, "close"),):
            try:
                if obj:
                    getattr(obj, meth)()
            except Exception:
                pass
        if self._pw_owned and self._pw:
            try:
                self._pw.stop()
            except Exception:
                pass
        self.browser = self.page = self.context = None
        self._pw = None if self._pw_owned else self._pw

    # collectors
    def stage(self, s):
        self._stage = s

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
            self.console.append((m.type, text, self._stage))
        except Exception:
            pass

    def _on_reqfail(self, r):
        try:
            if "favicon" in r.url:
                return
            f = r.failure
            if callable(f):
                f = f()
            f = str(f)
            if "ERR_ABORTED" in f:
                return
            if "ERR_CONNECTION_REFUSED" in f or "ERR_CONNECTION_RESET" in f:
                self.refused.append("%s (%s)" % (r.url, f))
            self.failed.append("FAILED %s (%s) [%s]" % (r.url, f, self._stage))
        except Exception:
            pass

    def _on_response(self, r):
        try:
            if r.status >= 400 and "favicon" not in r.url:
                self.failed.append("HTTP %d %s [%s]" % (r.status, r.url, self._stage))
        except Exception:
            pass

    # navigation / evaluation
    def goto(self, url=None, timeout_s=120, wait_until="commit"):
        url = url or self.args.base
        try:
            self.page.goto(url, wait_until=wait_until, timeout=int(timeout_s * 1000))
        except Exception as e:
            if "ERR_CONNECTION_REFUSED" in str(e):
                raise EnvFailure("navigation refused: %s" % url)
            raise

    def js(self, expr, arg=None):
        if arg is None:
            return self.page.evaluate(expr)
        return self.page.evaluate(expr, arg)

    def safe_js(self, expr, arg=None, default=None):
        try:
            return self.js(expr, arg)
        except Exception:
            return default

    def sleep(self, s):
        """Wait WITHOUT blocking Playwright's dispatcher (route handlers of --disk keep being served)."""
        if self.page is not None:
            self.page.wait_for_timeout(max(1, int(s * 1000)))
        else:
            time.sleep(s)

    def wait_js(self, cond, timeout_s, poll=0.2, arg=None):
        """Poll a JS predicate (interval polling, never rAF polling). Returns seconds waited or None."""
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            try:
                if (self.js(cond, arg) if arg is not None else self.js(cond)):
                    return round(time.time() - t0, 2)
            except Exception:
                pass
            self.sleep(poll)
        return None

    def wait_lc(self, timeout_s=None):
        """Wait for window.__LC__ with a kernel; raise EnvFailure when the server refused, else return None
        (the caller decides whether 'never booted' is a game failure)."""
        timeout_s = timeout_s or getattr(self.args, "boot_timeout", 300)
        t = self.wait_js("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)", timeout_s, 0.25)
        if t is None and self.refused:
            raise EnvFailure("the server refused %d request(s), first: %s" % (len(self.refused), self.refused[0]))
        if t is not None:
            self.js(EVENTS_JS)
        return t

    def boot(self, url=None, timeout_s=None):
        self.stage("boot")
        self.goto(url)
        t = self.wait_lc(timeout_s)
        if t is None:
            raise HarnessError("__LC__ never appeared within %s s; body: %r" % (
                timeout_s or getattr(self.args, "boot_timeout", 300),
                (self.safe_js("() => (document.body.innerText || '').slice(0, 300)") or "")))
        self.stage("menu")
        return t

    # frames
    def frames(self):
        return self.safe_js("() => window.__H_FRAMES__", default=None)

    def frames_advancing(self, budget_s=3.0, need=2):
        a = self.frames()
        b = a
        deadline = time.time() + budget_s
        while time.time() < deadline:
            self.sleep(0.25)
            b = self.frames()
            if isinstance(a, int) and isinstance(b, int) and b - a >= need:
                return True, a, b
        return False, a, b

    def install_pump(self):
        return self.js(PUMP_JS)

    def freeze_loop(self):
        """Stop the kernel's own rAF loop so only harness-stepped frames advance the game."""
        return self.js("() => { const k = window.__LC__.W.kernel; const was = !!k._running; k.stop(); return was; }")

    def thaw_loop(self):
        return self.js("() => { const k = window.__LC__.W.kernel; k.start(); return !!k._running; }")

    def step_frames(self, n, dt=1.0 / 60, render=False, chunk=60):
        """Step n kernel frames synchronously (never waits on rAF). render: True / False / every-N."""
        self.install_pump()
        done = 0
        while done < n:
            k = min(chunk, n - done)
            self.js("([n, dt, r]) => window.__H_PUMP__.step(n, dt, r)", [k, dt, render])
            done += k

    # match helpers
    def state(self):
        return self.safe_js("() => { try { return window.__LC__.state(); } catch (e) { return { error: String(e) }; } }")

    def phase(self):
        return self.safe_js("() => window.__LC__ && window.__LC__.W ? window.__LC__.W.phase : null")

    def start_match(self, mode="standard", seed=7, map_id=None, enter=True, timeout_s=None):
        """__LC__.startMatch(...) (resolves when the lobby is shown), then a REAL Enter key press skips the
        lobby (hud.js finishLobby) so W.phase reaches 'drop' (standard/quick) or 'match' (practice)."""
        self.stage("load")
        timeout_s = timeout_s or getattr(self.args, "load_timeout", 1500)
        opts = {"mode": mode, "seed": seed}
        if map_id:
            opts["mapId"] = map_id
        t0 = time.time()
        self.js("(o) => { window.__H_SM__ = { done: false }; window.__LC__.startMatch(o).then(() => { window.__H_SM__.done = true; },"
                " (e) => { window.__H_SM__.done = true; window.__H_SM__.err = String(e && (e.stack || e)); }); return true; }", opts)
        ok = self.wait_js("() => window.__H_SM__ && window.__H_SM__.done", timeout_s, 0.25)
        if ok is None:
            if self.safe_js("() => !!window.__LC__.W._starting"):
                raise EnvFailure("startMatch still loading after %d s (box contention; raise --load-timeout)" % timeout_s)
            raise HarnessError("startMatch did not settle within %d s (phase %s)" % (timeout_s, self.phase()))
        err = self.safe_js("() => window.__H_SM__.err || null")
        if err:
            raise HarnessError("startMatch rejected: %s" % err[:400])
        res = {"load_s": round(time.time() - t0, 1), "phaseAfterLoad": self.phase()}
        if enter:
            self.stage("lobby")
            self.sleep(0.3)
            want = "() => ['drop', 'match'].includes(window.__LC__.W.phase)"
            for attempt in range(3):
                self.page.keyboard.press("Enter")
                t = self.wait_js(want, 5, 0.1)
                if t is not None:
                    res["enter_s"] = t
                    res["enterPresses"] = attempt + 1
                    break
            res["phaseAfterEnter"] = self.phase()
            if res["phaseAfterEnter"] not in ("drop", "match"):
                raise HarnessError("a real Enter did not leave the lobby (phase %s)" % res["phaseAfterEnter"])
        self.stage(self.phase() or "match")
        return res

    def land(self, max_s=120, step=1.0 / 30, protect=False):
        """SETUP ONLY (sim, no view): fastForward until the local player stands on the ground. protect=True tops the
        player's hp/shield up after EVERY sim step (one fastForward(h, h) per step) so a bot cannot kill the test subject
        during the skip (the 21:38 mobile run lost 2 of 4 devices to 'the player died while landing'; Wave-1 gate run 1 lost
        bootcheck's lock/walk rows to a death in the air at t 27.76). Only a single step dealing > 200 damage can still kill."""
        return self.js("""([maxS, h, prot]) => { const C = window.__LC__, W = C.W, p = W.player;
            const top = () => { if (prot && p && p.alive) { p.hp = Math.max(p.hp, 100); p.shield = Math.max(p.shield || 0, 100); } };
            let t = 0, n = 0; top();
            const slice = prot ? h : 0.5;
            while (t < maxS && p && p.alive && (p.gliding || !p.onGround || W.phase === 'drop')) { C.fastForward(slice, h); t += slice; n++; top(); }
            return { t: +W.t.toFixed(2), phase: W.phase, onGround: !!(p && p.onGround), gliding: !!(p && p.gliding), alive: !!(p && p.alive),
                     protected: !!prot, slices: n }; }""",
                       [max_s, step, bool(protect)])

    def guard_player(self, on=True):
        """SETUP ONLY: a harness-owned kernel updater that tops the local player's hp/shield up to 100/100 on every frame
        (the kernel's own loop, common.step_frames and __LC__.stepFrames all run kernel._updaters), so a bot cannot kill the
        test subject while a gate measures something else (walking, aiming, the HUD). on=False removes it."""
        return self.js("""(on) => { const W = window.__LC__ && window.__LC__.W, k = W && W.kernel;
            if (!k || !Array.isArray(k._updaters)) return 'no kernel._updaters';
            const i = window.__H_GUARD__ ? k._updaters.indexOf(window.__H_GUARD__) : -1;
            if (!on) { if (i >= 0) k._updaters.splice(i, 1); window.__H_GUARD__ = null; return 'off'; }
            if (i >= 0) return 'already';
            window.__H_GUARD__ = () => { const p = W.player; if (p && p.alive) { if (p.hp < 100) p.hp = 100; if ((p.shield || 0) < 100) p.shield = 100; } };
            k._updaters.push(window.__H_GUARD__); return 'on'; }""", bool(on))

    # input
    def press(self, key, hold_s=0.06):
        self.page.keyboard.down(key)
        self.sleep(hold_s)
        self.page.keyboard.up(key)

    def hold(self, keys):
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

    def cdp(self):
        if self._cdp is None:
            self._cdp = self.context.new_cdp_session(self.page)
        return self._cdp

    def screenshot(self, path, timeout_s=60):
        """Raw CDP Page.captureScreenshot (Playwright's page.screenshot re-applies device metrics; dyefield)."""
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        try:
            r = self.cdp().send("Page.captureScreenshot", {"format": "png", "fromSurface": True})
            with open(path, "wb") as f:
                f.write(base64.b64decode(r["data"]))
            return True
        except Exception as e_cdp:
            try:
                self.page.screenshot(path=path, timeout=int(timeout_s * 1000))
                return True
            except Exception as e:
                self.page_errors.append(("screenshot", "screenshot failed: %s (cdp: %s)" % (str(e).splitlines()[0], str(e_cdp).splitlines()[0])))
                return False

    def canvas_png(self, path, js_render=None):
        """Render (optionally via js_render, a JS function body run first) and save the WebGL canvas as PNG
        through toDataURL in the SAME task (works with a starved compositor)."""
        expr = "() => { %s; return window.__LC__.W.kernel.renderer.domElement.toDataURL('image/png'); }" % (js_render or "")
        url = self.js(expr)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(url.split(",", 1)[1]))
        return path

    # diagnostics
    def window_errors(self):
        return self.safe_js("() => window.__H_ERR__ || []", default=[]) or []

    def diagnostics(self):
        cerr_all = [t for (k, t, s) in self.console if k == "error" and not any(i in t for i in CONSOLE_IGNORE)]
        env = [t for t in cerr_all if any(m in t for m in ENV_CONSOLE)]
        cerr = [t for t in cerr_all if not any(m in t for m in ENV_CONSOLE)]
        shader_all = [(k, t) for (k, t, s) in self.console if k in ("error", "warning") and any(m in t for m in SHADER_MARKERS)]
        shader = [t for (k, t) in shader_all if is_shader_error(k, t)]
        shader_warn = [t for (k, t) in shader_all if not is_shader_error(k, t)]
        warns = [t for (k, t, s) in self.console if k == "warning" and not any(m in t for m in SHADER_MARKERS)]
        rig = [t for t in warns + [t for (k, t, s) in self.console if k in ("log", "info", "error")] if RIG_MARK in t]
        allow = [t for t in warns if any(a in t for a in ALLOW_WARN)]
        other_warn = [t for t in warns if RIG_MARK not in t and not any(a in t for a in ALLOW_WARN)]
        return {
            "consoleErrors": [t for t in cerr if not any(m in t for m in SHADER_MARKERS)],
            "shader": shader,
            "shaderWarnings": shader_warn,
            "rigWarnings": rig,
            "allowListedWarnings": len(allow),
            "allowListedSample": sorted(set(allow))[:6],
            "warnings": other_warn,
            "pageErrors": [e for (s, e) in self.page_errors if s != "screenshot"],
            "windowErrors": self.window_errors() if self.page else [],
            "failedRequests": list(self.failed),
            "refused": list(self.refused),
            "envErrors": env,
        }


def print_diagnostics(d, limit=12):
    for key, label in (("consoleErrors", "console errors"), ("pageErrors", "page errors"), ("windowErrors", "window errors"),
                       ("shader", "shader/GL errors"), ("failedRequests", "failed requests"), ("rigWarnings", "[rig] warnings")):
        items = d.get(key) or []
        print("  %s (%d):" % (label, len(items)))
        for t in items[:limit]:
            print("    - %s" % str(t)[:400])
    if d.get("allowListedWarnings"):
        print("  allow-listed PropertyBinding warnings: %d (not gating until L5 lands)" % d["allowListedWarnings"])
    if d.get("envErrors"):
        print("  GPU-process (environment) errors, not counted as game errors: %d - %s" % (len(d["envErrors"]), d["envErrors"][0][:200]))


def diag_problems(d, rig=True):
    out = []
    for key, label in (("consoleErrors", "console error"), ("pageErrors", "page error"),
                       ("windowErrors", "window error / unhandled rejection"), ("shader", "shader/GL error"),
                       ("failedRequests", "failed request")) + ((("rigWarnings", "[rig] warning"),) if rig else ()):
        n = len(d.get(key) or [])
        if n:
            out.append("%d %s(s)" % (n, label))
    return out


# ─────────────────────────────── math helpers ───────────────────────────────
def angle_delta(a, b):
    d = (b - a) % (2 * math.pi)
    if d > math.pi:
        d -= 2 * math.pi
    return d


def pct(s, p):
    s = sorted(x for x in s if isinstance(x, (int, float)))
    if not s:
        return None
    k = (len(s) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)
