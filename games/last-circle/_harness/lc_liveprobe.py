#!/usr/bin/env python
"""Last Circle live-measure probe - the empirical baseline every later fix is proven against.

    python lc_liveprobe.py                       # headless Chrome, 3 maps x 3 interleaved repeats
    python lc_liveprobe.py --reps 1 --maps ashgrid --label quick
    python lc_liveprobe.py --uncapped            # --disable-gpu-vsync --disable-frame-rate-limit (headroom)
    python lc_liveprobe.py --headed              # one headed Chrome (steals focus; avoid while others work)

READ-ONLY against the game: it loads http://127.0.0.1:8790/games/last-circle/index.html (a scoped static
server that must already be running), drives window.__LC__, and writes JSON to ./_reports/ next to this file.
It never touches the repo.

Per run (fresh browser context = cold HTTP cache; the order of maps is rotated per repeat so GPU contention
from other sessions spreads over every map instead of landing on one):
  1. BOOT cold: paint timing (first-paint / FCP), __FFG3D__ + __LC__ arrival (precise, via a property
     setter), #lc-splash removal, resource count/bytes. Then one reload in the same context = BOOT warm.
  2. MENU  window: real rAF frames over the cinematic menu world (default 5 s).
  3. LOAD: __LC__.startMatch({mode:'standard', mapId, seed}) -> resolves when the lobby is shown; then a
     REAL Enter keypress skips the lobby (hud.js finishLobby) -> phase 'drop'.
  4. DROP  window: real rAF frames during the glide (default 10 s).
  5. fastForward (sim only, no render) until the local player has landed (phase 'match').
  6. GROUND window: real rAF frames, player standing where it landed, bots live (default 20 s).
  7. ENDGAME: alternate fastForward(8 s) with ~1.5 s of REAL frames until the match is over, so every
     death/elimination/kill-feed/storm event is followed by real view frames (view errors only show up in
     a running match). Then the post-match panel, then a REAL click on PLAY AGAIN (match-over-match
     teardown path) and a short AGAIN window on the second match.

Every window records: every rAF delta (p50/p95/p99/max, share >20 ms / >33 ms), and per rendered frame the
WHOLE-frame renderer counters (info.autoReset is switched off and reset once per kernel loop, because the
kernel renders through EffectComposer and the default autoReset only shows the last pass), split into
shadow-map calls / scene RenderPass calls / total; triangles; CPU ms of the kernel loop split update
(tweens+mixers+updaters) vs render submission; and every 250 ms: programs, geometries, textures, JS heap,
pixel ratio, drawing-buffer size, phase, alive count.
Console errors / warnings, page errors, window errors, unhandled rejections and failed requests are tagged
with the stage they happened in and quoted verbatim (first few unique per stage).
Perf numbers are INFORMATION, never a gate: the box is shared, so the report also records how many other
automated Chromes were alive and the OS GPU 3D-engine share per process during each window.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from playwright.sync_api import sync_playwright  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "_reports")
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
# _harness/perfcheck.py sets URL (its --base) and ROUTER = (predicate, handler) for --disk / --rev serving (common.DiskServer)
ROUTER = None
_CUR = {"page": None}


def _sleep(seconds):
    """time.sleep that keeps Playwright's dispatcher pumping (route handlers of --disk serving keep answering)."""
    end = time.time() + seconds
    while True:
        left = end - time.time()
        if left <= 0:
            return
        pg = _CUR["page"]
        if pg is None:
            time.sleep(min(left, 0.1))
            continue
        try:
            pg.wait_for_timeout(max(1, int(min(left, 0.25) * 1000)))
        except Exception:
            time.sleep(min(left, 0.1))


MAPS = ["isla_viva", "ashgrid", "deepwood"]           # runtime/3d/royale/hud.js:124 BATTLE_MAPS

# Same launch flags as dyefield/_harness/common.py FLAGS (real d3d11 ANGLE, no throttling).
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

INIT_JS = r"""
(() => {
  if (window.__LM__) return;
  const now = () => performance.now();
  const M = window.__LM__ = { err: [], marks: {}, on: false, dts: [], last: -1, frames: 0 };
  addEventListener('error', (e) => { try { M.err.push({ t: now(), msg: String((e && (e.message || (e.error && e.error.stack))) || e) + (e && e.filename ? ' @' + e.filename + ':' + e.lineno : '') }); } catch (_) {} });
  addEventListener('unhandledrejection', (e) => { try { const r = e && e.reason; M.err.push({ t: now(), msg: 'unhandledrejection: ' + ((r && (r.stack || r.message)) || String(r)) }); } catch (_) {} });
  // precise arrival of the two boot globals (ffg_kernel_3d.js boot3d end / ffg_royale3d.js controller)
  for (const key of ['__FFG3D__', '__LC__']) {
    let v;
    Object.defineProperty(window, key, { configurable: true, enumerable: true,
      get() { return v; }, set(x) { v = x; if (!(key in M.marks)) M.marks[key] = now(); } });
  }
  const mo = new MutationObserver(() => {
    const sp = document.getElementById('lc-splash');
    if (sp && !M.marks.splashSeen) M.marks.splashSeen = now();
    if (!sp && M.marks.splashSeen && !M.marks.splashGone) M.marks.splashGone = now();
    if (!M.marks.canvas && document.querySelector('#game-container canvas')) M.marks.canvas = now();
  });
  mo.observe(document, { childList: true, subtree: true });
  try {
    M.lt = { n: 0, ms: 0, max: 0, over250: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { M.lt.n++; M.lt.ms += e.duration; if (e.duration > M.lt.max) M.lt.max = Math.round(e.duration); if (e.duration > 250) M.lt.over250++; } })
      .observe({ type: 'longtask', buffered: true });
  } catch (_) {}
  // harness-owned rAF sampler (independent of the game's loop)
  const f = (ts) => {
    M.frames++;
    if (M.on) { if (M.last >= 0) M.dts.push(ts - M.last); M.last = ts; } else M.last = -1;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
})();
"""

# Installed once per page load after __LC__ exists. Wraps kernel methods on the INSTANCE only.
INSTRUMENT_JS = r"""() => {
  const k = window.__LC__ && window.__LC__.W && window.__LC__.W.kernel;
  if (!k) return 'no kernel';
  if (k.__lm) return 'already';
  const r = k.renderer, info = r.info;
  const S = k.__lm = { on: false, f: [], snaps: [], cur: null };
  info.autoReset = false;
  info.reset();
  const finish = () => {
    const c = S.cur; if (!c) return;
    S.cur = null;
    if (!S.on) return;
    const W = window.__LC__.W;
    // the record finished right after WIN_START belongs to the frame that ran BEFORE the window opened:
    // keep it apart (preFrame) so it can be inspected without polluting the window
    const tgt = S.pre ? (S.pre = false, S.preFrame = []) : S.f;
    tgt.push([
      c.t1 != null ? +(c.t1 - c.t0).toFixed(3) : null,        // 0 update ms (tweens + mixers + updaters)
      c.t2 != null ? +(c.t2 - c.t1).toFixed(3) : null,        // 1 render submission ms (composer.render)
      info.render.calls, c.scene, c.shadow, info.render.triangles,   // 2..5
      c.shadowTris,                                            // 6 shadow-pass triangles
      info.programs ? info.programs.length : -1,               // 7 programs alive at frame end
      info.memory.textures, info.memory.geometries,            // 8, 9
      +(W.t || 0).toFixed(2), W.match ? W.match.aliveCount() : -1,   // 10 match t, 11 alive
      +(c.t0).toFixed(1),                                      // 12 frame start (page ms)
    ]);
  };
  const st = k._stepTweens;
  k._stepTweens = function (dt) {
    finish();
    // lazily wrap the composer (created by enableBloom on the menu) and its first RenderPass
    const comp = k.composer;
    if (comp && !comp.__lm) {
      comp.__lm = true;
      const cr = comp.render.bind(comp);
      comp.render = function (d) { if (S.cur) S.cur.t1 = performance.now(); const x = cr(d); if (S.cur) S.cur.t2 = performance.now(); return x; };
      const rp = comp.passes && comp.passes[0];
      if (rp && rp.render) {
        const rpr = rp.render.bind(rp);
        rp.render = function () { const b = info.render.calls; const x = rpr.apply(null, arguments); if (S.cur) S.cur.scene += info.render.calls - b; return x; };
      }
    }
    info.reset();
    S.cur = { t0: performance.now(), t1: null, t2: null, scene: 0, shadow: 0, shadowTris: 0 };
    return st.call(this, dt);
  };
  const sm = r.shadowMap, smr = sm.render.bind(sm);
  sm.render = function () {
    const b = info.render.calls, bt = info.render.triangles;
    const x = smr.apply(null, arguments);
    if (S.cur) { S.cur.shadow += info.render.calls - b; S.cur.shadowTris += info.render.triangles - bt; }
    return x;
  };
  // match-load timeline: fire-and-poll (the probe starts startMatch without awaiting it)
  window.__LM_LOAD__ = function (opts) {
    const W = window.__LC__.W, t0 = performance.now(), tl = [], prevMap = W.map;
    let last = '';
    const snap = (tag) => {
      const s = { t: Math.round(performance.now() - t0), tag, phase: W.phase, mapNew: W.map !== prevMap && !!W.map,
        actors: W.actors.length, mixers: k._mixers ? k._mixers.length : -1,
        programs: info.programs ? info.programs.length : -1, textures: info.memory.textures, geometries: info.memory.geometries };
      const key = [s.phase, s.mapNew, s.actors, s.mixers, s.programs, s.textures].join('|');
      if (key !== last || tag) { tl.push(s); last = key; }
    };
    const iv = setInterval(() => snap(''), 25);
    const R = window.__LM_LOADRES__ = { done: false, tl };
    snap('start');
    window.__LC__.startMatch(opts).then(() => { clearInterval(iv); snap('resolved'); R.ms = Math.round(performance.now() - t0); R.done = true; },
                                        (e) => { clearInterval(iv); R.err = String(e && (e.stack || e)); R.done = true; });
    return true;
  };
  // 250 ms snapshots
  setInterval(() => {
    if (!S.on) return;
    try {
      const W = window.__LC__.W, p = W.player, cv = r.domElement;
      S.snaps.push({
        programs: info.programs ? info.programs.length : null,
        geometries: info.memory.geometries, textures: info.memory.textures,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        dpr: r.getPixelRatio(), buf: [cv.width, cv.height],
        phase: W.phase, alive: W.match ? W.match.aliveCount() : null,
        pAlive: p ? !!p.alive : null, pGlide: p ? !!p.gliding : null, pY: p ? +p.pos.y.toFixed(1) : null,
        mixers: k._mixers ? k._mixers.length : null, sceneChildren: W.scene.children.length,
      });
    } catch (e) { S.snaps.push({ error: String(e) }); }
  }, 250);
  return 'ok';
}"""

GL_PROBE_JS = r"""() => {
  const out = {};
  try {
    const r = window.__LC__.W.kernel.renderer, gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    out.webgl2 = !!r.capabilities.isWebGL2;
    out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    out.dpr = window.devicePixelRatio; out.pixelRatio = r.getPixelRatio();
    out.graphics = window.__LC__.W.settings.graphics;
    out.shadow = r.shadowMap.enabled; out.bloom = !!(window.__LC__.W.kernel.bloom && window.__LC__.W.kernel.bloom.enabled);
  } catch (e) { out.error = String(e); }
  return out;
}"""

BOOT_JS = r"""() => {
  const M = window.__LM__ || { marks: {} };
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = {}; for (const p of performance.getEntriesByType('paint')) paint[p.name] = +p.startTime.toFixed(1);
  const res = performance.getEntriesByType('resource');
  let bytes = 0, enc = 0; for (const x of res) { bytes += x.transferSize || 0; enc += x.encodedBodySize || 0; }
  const glb = res.filter((x) => /\.(glb|gltf)(\?|$)/.test(x.name));
  const slow = res.slice().sort((a, b) => b.responseEnd - a.responseEnd).slice(0, 6)
    .map((x) => [x.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 90), +x.startTime.toFixed(0), +x.responseEnd.toFixed(0), x.encodedBodySize || 0]);
  const cdn = res.filter((x) => /jsdelivr/.test(x.name));
  const cdnEnd = cdn.length ? Math.max(...cdn.map((x) => x.responseEnd)) : null;
  const local = res.filter((x) => !/jsdelivr|googleapis|gstatic/.test(x.name));
  const localEnd = local.length ? Math.max(...local.map((x) => x.responseEnd)) : null;
  return { lastResponses: slow, cdnCount: cdn.length, cdnLastEnd: cdnEnd != null ? +cdnEnd.toFixed(0) : null,
           localLastEnd: localEnd != null ? +localEnd.toFixed(0) : null,
           longtasks: (window.__LM__ && window.__LM__.lt) ? Object.assign({}, window.__LM__.lt, { ms: Math.round(window.__LM__.lt.ms) }) : null, marks: M.marks, paint, dcl: nav.domContentLoadedEventEnd != null ? +nav.domContentLoadedEventEnd.toFixed(1) : null,
           load: nav.loadEventEnd != null ? +nav.loadEventEnd.toFixed(1) : null,
           resources: res.length, transferMB: +(bytes / 1048576).toFixed(2), encodedMB: +(enc / 1048576).toFixed(2),
           glbCount: glb.length, glbMB: +(glb.reduce((a, x) => a + (x.encodedBodySize || 0), 0) / 1048576).toFixed(2) };
}"""

WIN_START_JS = r"""() => {
  const M = window.__LM__, S = window.__LC__.W.kernel.__lm;
  M.dts = []; M.last = -1; M.on = true;
  S.f = []; S.snaps = []; S.on = true; S.pre = true; S.preFrame = null;
  return performance.now();
}"""

WIN_STOP_JS = r"""() => {
  const M = window.__LM__, S = window.__LC__.W.kernel.__lm;
  M.on = false; S.on = false;
  return { dts: M.dts.slice(), f: S.f.slice(), snaps: S.snaps.slice(), t: performance.now(), preFrame: S.preFrame ? S.preFrame[0] : null };
}"""

# Box control: a blank page doing one WebGL2 clear per rAF (same browser, same flags, measured right before the
# game loads). Its p99/max is the stall floor the BOX imposes at that moment; the game's numbers are read against it.
CONTROL_HTML = """<!doctype html><html><body style="margin:0"><canvas id=c width=1600 height=900></canvas><script>
const gl = document.getElementById('c').getContext('webgl2');
window.F = { on: false, dts: [], last: -1 };
function f(ts){ const F = window.F; if (F.on) { if (F.last >= 0) F.dts.push(ts - F.last); F.last = ts; }
  gl.clearColor(Math.random(), 0.2, 0.3, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(f); }
requestAnimationFrame(f);
</script></body></html>"""

STATE_JS = r"""() => { try { return window.__LC__.state(); } catch (e) { return { error: String(e) }; } }"""
SKIP_STAMP_JS = r"""() => { const W = window.__LC__.W; const S = window.__LP_SKIP__ = { key: null, phase: null, accessor: false };
  if (!window.__LP_SKIP_L__) { window.__LP_SKIP_L__ = true;
    addEventListener('keydown', (e) => { const s = window.__LP_SKIP__; if (s && e.key === 'Enter' && s.key == null) s.key = performance.now(); }, true); }
  const d = Object.getOwnPropertyDescriptor(W, 'phase');
  if (d && d.configurable !== false && !d.get && !d.set) { let v = W.phase;
    Object.defineProperty(W, 'phase', { configurable: true, enumerable: true, get: () => v,
      set: (x) => { v = x; if ((x === 'drop' || x === 'match') && S.phase == null) S.phase = performance.now(); } });
    S.accessor = true; }
  return S; }"""
SKIP_READ_JS = r"""() => { const W = window.__LC__.W, S = window.__LP_SKIP__ || {};
  if (S.accessor) { const v = W.phase; delete W.phase; W.phase = v; S.accessor = false; }
  return { keyMs: S.key == null ? null : Math.round(S.key), phaseMs: S.phase == null ? null : Math.round(S.phase),
           s: S.key != null && S.phase != null ? +((S.phase - S.key) / 1000).toFixed(3) : null }; }"""

_GPU_PS = r"""
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$acc = @{}; $n = 0; $cpu = 0
$samples = Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage','\Processor(_Total)\%% Processor Time' -SampleInterval 1 -MaxSamples %d -ErrorAction SilentlyContinue
foreach ($s in $samples) {
  $n++
  foreach ($c in $s.CounterSamples) {
    if ($c.Path -match 'processor\(_total\)') { $cpu += $c.CookedValue; continue }
    if ($c.InstanceName -match '^pid_(\d+)_luid_') { $k = $Matches[1]; $acc[$k] = ($acc[$k] + $c.CookedValue) }
  }
}
$out = @()
foreach ($k in $acc.Keys) {
  $procId = [int]$k
  $pr = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $name = if ($pr) { $pr.ProcessName } else { 'pid' + $procId }
  $out += [pscustomobject]@{ pid = $procId; name = $name; pct = [math]::Round($acc[$k] / [math]::Max(1, $n), 1) }
}
@{ samples = $n; cpu = [math]::Round($cpu / [math]::Max(1, $n), 1); procs = @($out | Sort-Object pct -Descending) } | ConvertTo-Json -Compress -Depth 3
"""

_PS_SCAN = (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "
    "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { "
    "([string]$_.CommandLine) -notmatch '--type=' -and ([string]$_.CommandLine) -match '--remote-debugging-pipe|--enable-automation' "
    "} | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; headless=([string]$_.CommandLine -match '--headless') } }) "
    "| ConvertTo-Json -Compress -Depth 2"
)


def automated_chromes():
    if os.name != "nt":
        return None
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_SCAN],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        t = (r.stdout or "").strip()
        rows = json.loads(t) if t else []
        if isinstance(rows, dict):
            rows = [rows]
        return rows
    except Exception as e:
        return [{"error": str(e)[:200]}]


class GpuShare:
    ENABLED = True

    def __init__(self, seconds):
        self.proc = None
        if os.name != "nt" or not GpuShare.ENABLED:
            return
        try:
            self.proc = subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                                          _GPU_PS % max(1, int(round(seconds)))],
                                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                         encoding="utf-8", errors="replace")
        except Exception:
            self.proc = None

    def result(self):
        if not self.proc:
            return None
        try:
            out, _ = self.proc.communicate(timeout=40)
            d = json.loads((out or "").strip() or "{}")
        except Exception as e:
            try:
                self.proc.kill()
            except Exception:
                pass
            return {"error": str(e)[:200]}
        procs = d.get("procs") or []
        if isinstance(procs, dict):
            procs = [procs]
        chrome = sum(p.get("pct") or 0 for p in procs if (p.get("name") or "").lower() == "chrome")
        other = [p for p in procs if (p.get("name") or "").lower() != "chrome"]
        return {"samples": d.get("samples"), "cpu_total_pct": d.get("cpu"), "chrome_all": round(chrome, 1),
                "others": round(sum(p.get("pct") or 0 for p in other), 1),
                "top_others": [(p.get("name"), p.get("pct")) for p in other[:4]]}


def pct(s, p):
    if not s:
        return None
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def med(vals):
    v = [x for x in vals if isinstance(x, (int, float))]
    return statistics.median(v) if v else None


def summarize(raw):
    dts = [d for d in raw.get("dts") or [] if isinstance(d, (int, float)) and d > 0]
    s = sorted(dts)
    tot = sum(dts)
    f = raw.get("f") or []
    snaps = [x for x in raw.get("snaps") or [] if isinstance(x, dict) and "error" not in x]
    col = lambda i: [r[i] for r in f if isinstance(r[i], (int, float))]  # noqa: E731
    upd, rnd, calls, scene, shadow, tris = col(0), col(1), col(2), col(3), col(4), col(5)
    cpu = [a + b for a, b in ((r[0], r[1]) for r in f) if isinstance(a, (int, float)) and isinstance(b, (int, float))]
    last = snaps[-1] if snaps else {}
    first = snaps[0] if snaps else {}
    # stall attribution: the worst frames by CPU frame ms, with what changed in the renderer that frame
    worst = []
    for i, r in enumerate(f):
        if len(r) < 13 or not (isinstance(r[0], (int, float)) and isinstance(r[1], (int, float))):
            continue
        p = f[i - 1] if i > 0 and len(f[i - 1]) >= 13 else None
        worst.append({"cpu": round(r[0] + r[1], 1), "upd": r[0], "rnd": r[1], "calls": r[2],
                      "dProg": (r[7] - p[7]) if p else None, "dTex": (r[8] - p[8]) if p else None,
                      "dGeo": (r[9] - p[9]) if p else None, "matchT": r[10], "alive": r[11],
                      "dAlive": (r[11] - p[11]) if p else None})
    worst.sort(key=lambda x: -x["cpu"])
    grow = lambda j: sum(1 for i in range(1, len(f)) if len(f[i]) >= 13 and len(f[i - 1]) >= 13 and f[i][j] > f[i - 1][j])  # noqa: E731
    stris = [r[6] for r in f if len(r) > 6 and isinstance(r[6], (int, float))]
    return {
        "worst": worst[:8],
        "framesWithNewPrograms": grow(7), "framesWithNewTextures": grow(8), "framesWithNewGeometries": grow(9),
        "cpu_over50ms": sum(1 for x in worst if x["cpu"] > 50), "cpu_over100ms": sum(1 for x in worst if x["cpu"] > 100),
        "shadowTris_med": med(stris),
        "frames": len(dts), "seconds": round(tot / 1000.0, 2),
        "avgFps": round(1000.0 * len(dts) / tot, 1) if tot else None,
        "p50": pct(s, 50), "p95": pct(s, 95), "p99": pct(s, 99), "max": s[-1] if s else None,
        "over20": round(sum(1 for d in dts if d > 20) / len(dts), 4) if dts else None,
        "over33": round(sum(1 for d in dts if d > 33.4) / len(dts), 4) if dts else None,
        "cpuUpd_p50": pct(sorted(upd), 50), "cpuUpd_p99": pct(sorted(upd), 99),
        "cpuRender_p50": pct(sorted(rnd), 50), "cpuRender_p99": pct(sorted(rnd), 99),
        "cpuFrame_p50": pct(sorted(cpu), 50), "cpuFrame_p95": pct(sorted(cpu), 95), "cpuFrame_p99": pct(sorted(cpu), 99),
        "cpuFrame_max": max(cpu) if cpu else None,
        "calls_med": med(calls), "calls_max": max(calls) if calls else None,
        "scene_med": med(scene), "shadow_med": med(shadow),
        "tris_med": med(tris), "tris_max": max(tris) if tris else None,
        "programs": last.get("programs"), "programs_start": first.get("programs"),
        "geometries": last.get("geometries"), "textures": last.get("textures"),
        "heapMB_start": first.get("heapMB"), "heapMB_end": last.get("heapMB"),
        "heapMB_max": max((x.get("heapMB") or 0) for x in snaps) if snaps else None,
        "dpr": last.get("dpr"), "buf": last.get("buf"), "mixers": last.get("mixers"),
        "phase_start": first.get("phase"), "phase_end": last.get("phase"),
        "alive_start": first.get("alive"), "alive_end": last.get("alive"),
        "pAlive_end": last.get("pAlive"), "pGlide_end": last.get("pGlide"),
        "sceneChildren": last.get("sceneChildren"),
    }


class Run:
    @property
    def stage(self):
        return self._stage

    @stage.setter
    def stage(self, v):
        self._stage = v
        print("      %s  stage -> %s" % (time.strftime("%H:%M:%S"), v), flush=True)

    def __init__(self, browser, args, map_id, seed, rep, do_again):
        self.browser, self.args, self.map_id, self.seed, self.rep, self.do_again = browser, args, map_id, seed, rep, do_again
        self.stage = "boot_cold"
        self.console = []      # (stage, type, text)
        self.pageerrors = []
        self.reqfail = []
        self.out = {"map": map_id, "seed": seed, "rep": rep, "windows": {}, "notes": []}

    # ---- listeners
    def _on_console(self, m):
        t = m.type
        if t in ("error", "warning"):
            try:
                loc = m.location or {}
                where = (" @%s:%s" % (loc.get("url", ""), loc.get("lineNumber", ""))) if loc.get("url") else ""
            except Exception:
                where = ""
            self.console.append((self.stage, t, (m.text or "")[:600] + where))

    def _on_pageerror(self, e):
        self.pageerrors.append((self.stage, str(e)[:800]))

    def _on_reqfail(self, r):
        try:
            self.reqfail.append((self.stage, "FAILED " + r.url[:200] + " " + str(r.failure)))
        except Exception:
            pass

    def _on_response(self, r):
        try:
            if r.status >= 400:
                self.reqfail.append((self.stage, "HTTP %d %s" % (r.status, r.url[:200])))
        except Exception:
            pass

    def _wire(self, pg):
        pg.on("console", self._on_console)
        pg.on("pageerror", self._on_pageerror)
        pg.on("requestfailed", self._on_reqfail)
        pg.on("response", self._on_response)

    def js(self, code, arg=None):
        return self.page.evaluate(code, arg) if arg is not None else self.page.evaluate(code)

    def wait_js(self, cond, timeout_s, poll=0.1):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            try:
                if self.page.evaluate(cond):
                    return time.time() - t0
            except Exception:
                pass
            _sleep(poll)
        return None

    def window(self, name, seconds):
        gs = GpuShare(seconds)
        self.js(WIN_START_JS)
        _sleep(seconds)
        raw = self.js(WIN_STOP_JS)
        w = summarize(raw)
        w["preFrame"] = raw.get("preFrame")
        w["gpu"] = gs.result()
        self.out["windows"][name] = w
        return w

    def boot(self, label):
        t_wall = time.time()
        if label != "cold":
            # page.reload hung 120 s at 'commit' in the smoke run (busy renderer); a fresh page in the SAME
            # context shares the HTTP cache (= warm) and never waits on unloading the old one first
            old = self.page
            self.page = self.ctx.new_page()
            _CUR["page"] = self.page
            self._wire(self.page)
            try:
                old.close(run_before_unload=False)
            except Exception:
                pass
        self.page.goto(URL, wait_until="commit", timeout=120000)
        ok = self.wait_js("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)", 150, 0.05)
        if ok is None:
            self.out["notes"].append("BOOT %s: __LC__ never appeared within 150 s" % label)
            return False
        # splash removal lands a double-rAF later
        self.wait_js("() => !!(window.__LM__ && window.__LM__.marks.splashGone)", 5, 0.05)
        b = self.js(BOOT_JS)
        b["wall_s"] = round(time.time() - t_wall, 2)
        self.out["boot_" + label] = b
        return True

    def execute(self):
        a = self.args
        ctx = self.ctx = self.browser.new_context(viewport={"width": a.width, "height": a.height}, device_scale_factor=1)
        ctx.add_init_script(INIT_JS)
        if ROUTER is not None:
            ctx.route(ROUTER[0], ROUTER[1])
        self.page = ctx.new_page()
        _CUR["page"] = self.page
        self._wire(self.page)
        try:
            self.out["automated_chromes_at_start"] = automated_chromes()
            # ---- box control (see CONTROL_HTML)
            try:
                self.page.set_content(CONTROL_HTML)
                _sleep(1.0)
                self.page.evaluate("() => { window.F.on = true; }")
                _sleep(self.args.control)
                d = self.page.evaluate("() => { window.F.on = false; return window.F.dts; }")
                ds = sorted(x for x in d if x > 0)
                self.out["control"] = {"frames": len(ds), "p50": pct(ds, 50), "p95": pct(ds, 95), "p99": pct(ds, 99),
                                       "max": ds[-1] if ds else None,
                                       "over33": round(sum(1 for x in ds if x > 33.4) / len(ds), 4) if ds else None}
            except Exception as e:
                self.out["control"] = {"error": str(e).splitlines()[0][:200]}
            if not self.boot("cold"):
                return self.finish(ctx)
            self.stage = "boot_warm"
            if not self.boot("warm"):
                return self.finish(ctx)
            self.stage = "menu"
            self.out["instrument"] = self.js(INSTRUMENT_JS)
            self.out["gl"] = self.js(GL_PROBE_JS)
            _sleep(1.0)
            self.window("menu", a.menu)

            # ---- load
            self.stage = "load"
            t0 = time.time()
            self.js("(o) => window.__LM_LOAD__({ mode: 'standard', mapId: o.mapId, seed: o.seed })",
                    {"mapId": self.map_id, "seed": self.seed})
            self.wait_js("() => window.__LM_LOADRES__ && window.__LM_LOADRES__.done", 600, 0.1)
            r = self.js("() => { const R = window.__LM_LOADRES__; return { ms: R.ms, err: R.err || null, tl: R.tl, phase: window.__LC__.W.phase, map: window.__LC__.W.mapId }; }")
            r["wall_s"] = round(time.time() - t0, 2)
            self.out["load"] = r
            # the lobby DOM is up; a real Enter skips the 0.7 s fill + 3 x 0.9 s countdown (hud.js finishLobby)
            _sleep(0.4)
            self.js(SKIP_STAMP_JS)
            tk = time.time()
            self.page.keyboard.press("Enter")
            dt = self.wait_js("() => window.__LC__.W.phase === 'drop' || window.__LC__.W.phase === 'match'", 15, 0.02)
            self.out["lobby_skip_s"] = None if dt is None else round(time.time() - tk, 3)
            # in-page: Enter keydown -> W.phase drop/match (the honest number; lobby_skip_s above includes the harness's
            # keyboard.press round trip, 0.03-30 s on this box - L4A Wave 2)
            sk = self.js(SKIP_READ_JS)
            self.out["lobby_skip_page_s"] = sk.get("s")
            self.out["lobby_skip_page"] = sk
            if dt is None:
                self.out["notes"].append("Enter did not leave the lobby within 15 s; phase=%s" % self.js(STATE_JS).get("phase"))
                self.wait_js("() => window.__LC__.W.phase === 'drop' || window.__LC__.W.phase === 'match'", 10, 0.1)
            self.stage = "drop"
            self.out["windows"]["_drop_state_start"] = self.js(STATE_JS)
            self.window("drop", a.drop)

            # ---- land (sim only)
            self.stage = "land_ff"
            t0 = time.time()
            st = None
            for _ in range(40):
                st = self.js("""() => { const C = window.__LC__, p = C.W.player;
                    if (p && !p.gliding && p.onGround && C.W.phase === 'match') return { landed: true, s: C.state() };
                    const s = C.fastForward(3, 1 / 30); return { landed: false, s }; }""")
                if st.get("landed"):
                    break
                _sleep(0.05)
            self.out["land_ff"] = {"wall_s": round(time.time() - t0, 2), "state": st}
            _sleep(1.0)       # let the view catch up (camera, streaming) before sampling
            self.stage = "ground"
            self.window("ground", a.ground)

            # ---- endgame: alternate sim fast-forward and REAL frames until the match ends
            self.stage = "endgame"
            t0 = time.time()
            trace = []
            gs = GpuShare(5)
            gs.result()
            self.js(WIN_START_JS)
            over = False
            for i in range(a.max_slices):
                # the fastForward blocks the main thread; drop the rAF delta that spans it (M.last = -1) so the
                # endgame window's frame times are REAL frames only (CPU-frame numbers are per-frame already)
                s = self.js("() => { const C = window.__LC__; if (C.W.match && C.W.match.over) return Object.assign({ over: true }, C.state()); const t = performance.now(); const s = C.fastForward(%g, 1 / 30); s.ffMs = +(performance.now() - t).toFixed(0); s.over = !!(C.W.match && C.W.match.over); window.__LM__.last = -1; return s; }" % a.slice)
                trace.append({"t": round(s.get("t") or 0, 1), "alive": s.get("alive"), "phase": s.get("phase"),
                              "hp": (s.get("player") or {}).get("hp"), "ffMs": s.get("ffMs")})
                _sleep(a.real)
                if s.get("over"):
                    over = True
                    break
            raw = self.js(WIN_STOP_JS)
            w = summarize(raw)
            self.out["windows"]["endgame_realframes"] = w
            self.out["endgame"] = {"wall_s": round(time.time() - t0, 2), "over": over, "slices": len(trace),
                                   "trace_head": trace[:3], "trace_tail": trace[-4:],
                                   "state": self.js(STATE_JS)}
            # post-match panel (2.6 s beat), then PLAY AGAIN by a real click
            self.stage = "postmatch"
            vis = None
            if over:
                vis = self.wait_js("() => [...document.querySelectorAll('button')].some((b) => /PLAY AGAIN/.test(b.textContent) && b.offsetParent)", 20, 0.1)
            else:
                self.out["notes"].append("endgame: match not over after %d slices (sim t=%s, alive=%s) - post-match / PLAY AGAIN skipped" % (
                    len(trace), trace[-1]["t"] if trace else None, trace[-1]["alive"] if trace else None))
            self.out["postmatch_panel_s"] = vis
            if vis is not None and self.do_again:
                self.stage = "again_load"
                t0 = time.time()
                # what is actually under the button's centre (a real player's click lands there)
                self.out["again_hit"] = self.js("""() => {
                    const b = [...document.querySelectorAll('button')].find((x) => /PLAY AGAIN/.test(x.textContent) && x.offsetParent);
                    if (!b) return 'no button';
                    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                    const e = document.elementFromPoint(cx, cy);
                    const d = (n) => n ? (n.tagName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className : '') + ' "' + (n.textContent || '').slice(0, 30) + '"') : 'null';
                    return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight,
                             top: d(e), isButtonOrChild: !!(e && (e === b || b.contains(e))),
                             anims: document.getAnimations ? document.getAnimations().filter((a) => a.effect && a.effect.target && (a.effect.target === b || a.effect.target.contains && a.effect.target.contains(b))).map((a) => a.animationName || a.constructor.name) : null };
                }""")
                try:
                    self.page.get_by_role("button", name="PLAY AGAIN").first.click(timeout=15000)
                    self.out["again_click"] = "real click ok"
                except Exception as ce:
                    self.out["again_click"] = "REAL CLICK FAILED: " + str(ce)[:1500]
                    try:
                        shot = os.path.join(REPORTS, "again_click_fail_%s_r%s_%s.png" % (self.map_id, self.rep, time.strftime("%H%M%S")))
                        self.page.screenshot(path=shot)
                        self.out["again_click_shot"] = shot
                    except Exception:
                        pass
                    # fall back to a DOM click so the match-over-match measurement still happens (flagged)
                    self.js("() => { const b = [...document.querySelectorAll('button')].find((x) => /PLAY AGAIN/.test(x.textContent) && x.offsetParent); if (b) b.click(); }")
                ok = self.wait_js("() => !!document.querySelector('body') && window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", 90, 0.05)
                self.out["again_load_s"] = None if ok is None else round(time.time() - t0, 2)
                self.out["again_map"] = self.js("() => window.__LC__.W.mapId")
                _sleep(0.3)
                self.page.keyboard.press("Enter")
                self.wait_js("() => window.__LC__.W.phase === 'drop' || window.__LC__.W.phase === 'match'", 15, 0.05)
                self.stage = "again_drop"
                self.window("again_drop", a.again)
            elif vis is None and over:
                self.out["notes"].append("post-match PLAY AGAIN button never became visible within 20 s of match over")
        except Exception as e:
            self.out["notes"].append("PROBE EXCEPTION at stage %s: %s" % (self.stage, str(e)[:1500]))
        return self.finish(ctx)

    def finish(self, ctx):
        try:
            self.out["window_errors"] = self.js("() => (window.__LM__ ? window.__LM__.err : [])")
        except Exception:
            self.out["window_errors"] = "unreadable"
        try:
            ctx.close()
        except Exception:
            pass
        by = {}
        for stage, typ, text in self.console:
            d = by.setdefault(stage, {"error": 0, "warning": 0, "samples": []})
            d[typ] += 1
            if text not in d["samples"] and len(d["samples"]) < 6:
                d["samples"].append("[%s] %s" % (typ, text))
        self.out["console"] = by
        self.out["pageerrors"] = self.pageerrors[:20]
        self.out["pageerror_count"] = len(self.pageerrors)
        self.out["reqfail"] = self.reqfail[:20]
        return self.out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--maps", default=",".join(MAPS))
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--menu", type=float, default=5.0)
    ap.add_argument("--control", type=float, default=4.0, help="seconds of the blank-WebGL box control per run")
    ap.add_argument("--drop", type=float, default=10.0)
    ap.add_argument("--ground", type=float, default=20.0)
    ap.add_argument("--again", type=float, default=5.0)
    ap.add_argument("--slice", type=float, default=10.0, help="endgame fastForward seconds per slice")
    ap.add_argument("--real", type=float, default=1.0, help="endgame real seconds between slices")
    ap.add_argument("--max-slices", type=int, default=140)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--profile", default="dgpu-uncapped", choices=["dgpu-uncapped", "default", "default-uncapped"],
                    help="dgpu-uncapped (DEFAULT): --force_high_performance_gpu --disable-gpu-vsync --disable-frame-rate-limit. "
                         "On this box (2026-09-30) it is the ONLY config in which rAF runs: vsync'd presentation goes through "
                         "the Intel iGPU that dwm + the DisplayLink host (WUDFHost) hold at ~95%% of its 3D engine, and a "
                         "trivial WebGL-clear control page got 4-6 frames in 5 s there (scratch/rafcontrol.py). "
                         "default = dyefield FLAGS only (Intel iGPU, vsync).")
    ap.add_argument("--uncapped", action="store_true", help="(legacy) same as --profile default-uncapped")
    ap.add_argument("--no-again", action="store_true")
    ap.add_argument("--no-gpushare", action="store_true", help="do not sample Windows GPU/CPU counters during windows")
    ap.add_argument("--label", default="baseline")
    a = ap.parse_args(argv)
    maps = [m for m in a.maps.split(",") if m]
    GpuShare.ENABLED = not a.no_gpushare
    os.makedirs(REPORTS, exist_ok=True)
    if a.uncapped:
        a.profile = "default-uncapped"
    flags = list(FLAGS)
    if a.profile == "dgpu-uncapped":
        flags += ["--force_high_performance_gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"]
    elif a.profile == "default-uncapped":
        flags += ["--disable-gpu-vsync", "--disable-frame-rate-limit"]
    results = []
    stamp = time.strftime("%Y%m%d_%H%M%S")
    path = os.path.join(REPORTS, "lc_liveprobe_%s_%s.json" % (a.label, stamp))
    with sync_playwright() as pw:
        for rep in range(a.reps):
            order = maps[rep % len(maps):] + maps[:rep % len(maps)]     # rotate: interleaved repeats
            for m in order:
                browser = pw.chromium.launch(channel="chrome", headless=not a.headed, args=flags)
                try:
                    t0 = time.time()
                    print("[run] rep %d map %s ..." % (rep + 1, m), flush=True)
                    res = Run(browser, a, m, a.seed + rep, rep + 1, not a.no_again).execute()
                    res["run_wall_s"] = round(time.time() - t0, 1)
                    res["browser_version"] = browser.version
                    results.append(res)
                    g = res.get("windows", {}).get("ground", {})
                    print("      done in %.0f s; ground p50 %s p99 %s calls %s; pageerrors %s; notes %s" % (
                        res["run_wall_s"], g.get("p50"), g.get("p99"), g.get("calls_med"), res.get("pageerror_count"),
                        res.get("notes")), flush=True)
                finally:
                    browser.close()
                with open(path, "w", encoding="utf-8") as fh:        # rewrite after every run: partial survives
                    json.dump({"args": vars(a), "url": URL, "results": results}, fh, indent=1)
    print("REPORT", path)
    return path


if __name__ == "__main__":
    main()
