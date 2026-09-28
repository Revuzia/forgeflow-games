#!/usr/bin/env python
"""DYEFIELD interleaved A/B GPU-cost bench (PERF lane).

    python _harness/abperf.py                                   # legacy vs new (+ flat), 3 maps, 3 reps × 8 s
    python _harness/abperf.py --heavy                           # the court ahead painted wall to wall
    python _harness/abperf.py --maps lockwell --reps 4 --secs 8
    python _harness/abperf.py --variant legacy=shaders=legacy --variant new --variant plain=plain
    python _harness/abperf.py --variant new --variant nodye=prof=nodye --variant flat=flat
    python _harness/abperf.py --shots                           # + _shots/perf_<map>_{legacy,new}.png

Why interleaved in short frame blocks: this box's Intel iGPU is shared (dwm holds 20–65 % of its 3D engine, other
automated Chromes, CPU-heavy jobs that pull the iGPU clock down), so absolute frame times drift by 2–3×
within minutes. One page is loaded per map and the variants take turns in blocks of 8 rendered frames
(A×8 B×8 C×8 A×8 …, the first 3 frames of a block unrecorded: no carry-over of the previous variant's
GPU work or program switch) at the SAME frozen camera pose with the SAME deterministic dye splats; a burst of foreign
GPU work lands on neighbouring frames of every variant alike. Each renderer.render() — the sun's shadow
pass plus the main pass — is timed with EXT_disjoint_timer_query_webgl2 (GPU time, not wall time).

Per map: load /?map=<m>&dev=1&quality=high&seed=7&matchSeconds=900 in one headless Chrome (d3d11, the
harness flags of common.py), __DF__.start(), teleport the runner to the map's bench pose (near spawn
A, looking up the court), paint the pose's splats (both crews), freeze the sim (__DF__.freeze: the view
keeps rendering, nothing moves), compile + warm every variant, then --reps recording windows of
--secs × <variants> seconds (so each variant gets ~--secs seconds of frames per rep).

A variant is NAME[=ops], ops '&'-separated:
    shaders=legacy|new   the surfaces.ts shader path (the legacy path exists for this bench only)
    prof=a,b             surfaces.ts profiling knobs (nodye, nosurf, nopost, nobump, nocoat, nolg) — dev
                         diagnostics, never set by the game
                         (both: the variant draws CLONES of the patched map materials pinned with
                         userData.dfShaders / dfProf, so a per-frame switch is a material swap)
    flat                 every map mesh → one unlit constant shader: the map still rasterises and occludes
                         the sea / sky, so (variant − flat) = the map's surface SHADING cost
    plain                every map material → a plain MeshStandardMaterial (same roughness/metal/AO)
    nomap                map root hidden (the FACT's reference; on open maps the sea then fills the view)
    nolights noshadow zsort matsort
    l6                   light all six pool lights (the new path lights the 4 nearest; the default
                         'legacy' variant = shaders=legacy&matsort&l6, the whole pre-PERF path)
    (nolights / noshadow / l6 change the light count: every lit material then looks its program up
    again on each switch — cached programs, but CPU time; use sparingly)

Metric: per rep, each variant's GPU ms per frame = the 25th percentile of its frames (foreign GPU work
only ever ADDS time, so the lower quartile is the robust estimate of its own cost; the median is
printed beside it); the table shows the median over reps and the ratio to the first variant, and —
with a 'flat' variant — the map surface shading cost (variant − flat) and its ratio.
Report JSON: _harness/_reports/abperf_<label>.json.  Exit 0 measured · 2 setup/run failed.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (_GPU_PS, SHOTS, Session, add_common_args, automated_chromes, build_url, describe_chromes,  # noqa: E402
                    diag_problems, ensure_server, own_browser_pids, save_report, stop_server, wait_match_phase)

DEG = 3.141592653589793 / 180.0

# bench pose per map: runner feet (x, y, z), yaw (deg), camera pitch (deg), and splats (x, y, z, radius,
# team) painted before the freeze so the dye layer is on screen. 'close' = a second, dye-close shot pose.
POSES = {
    "pier18": {"at": (0.0, 1.2, -30.0), "yaw": 0.0, "pitch": -8.0, "close": (0.0, 1.2, -27.0, -24.0),
               "splats": [(-2.5, 0.2, -24.0, 2.2, 1), (2.0, 0.2, -21.0, 2.4, 2), (-1.0, 0.2, -17.0, 2.6, 1),
                          (3.5, 0.2, -14.0, 2.2, 2), (-4.0, 0.2, -11.0, 2.4, 1), (1.0, 0.2, -8.0, 2.6, 2)]},
    "lockwell": {"at": (0.0, 1.0, -22.0), "yaw": 0.0, "pitch": -8.0, "close": (0.0, 1.0, -20.0, -24.0),
                 "splats": [(-2.5, 0.0, -17.0, 2.2, 1), (2.0, 0.0, -14.0, 2.4, 2), (-1.0, 0.0, -10.0, 2.6, 1),
                            (3.5, 0.0, -7.0, 2.2, 2), (-4.0, 0.0, -4.0, 2.4, 1), (1.0, 0.0, -1.0, 2.6, 2)]},
    # Cinder: a channel runs across the court ahead of spawn A (no paint on the water), so the dye sits
    # on the near shore and on the far bank
    "cinder": {"at": (0.0, 1.2, -38.0), "yaw": 0.0, "pitch": -8.0, "close": (0.0, 1.2, -37.0, -26.0),
               "splats": [(-4.0, 0.5, -35.0, 2.4, 1), (3.0, 0.5, -35.0, 2.4, 2), (-8.0, -0.5, -32.0, 2.4, 1),
                          (0.0, -0.5, -32.0, 2.2, 2), (7.0, -0.5, -32.0, 2.4, 1), (-4.0, 0.5, -6.0, 2.6, 2),
                          (4.0, 0.5, -6.0, 2.6, 1)]},
}

# the complete pre-PERF rendering path: legacy shaders, three's material-first opaque sort, all six
# practicals lit (Lockwell). 'new' = what the game now ships.
LEGACY = "legacy=shaders=legacy&matsort&l6"

FLAGS = ("flat", "plain", "nomap", "nolights", "noshadow", "zsort", "matsort", "l6")

# ── in-page machinery ──────────────────────────────────────────────────────────────────────────────
AB_SETUP_JS = r"""(variants) => {
  const D = __DF__.dev, P = D.parts, R = D.renderer, gl = R.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (window.__AB__) return { ext: !!ext, reused: true };
  const meshes = [];
  P.map.root.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) meshes.push(o); });
  const orig = new Map(meshes.map((m) => [m, m.material]));
  const mats = [...new Set(orig.values())];
  const SM = P.water.mesh.material.constructor;
  const flat = new SM({
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'void main() { gl_FragColor = vec4( 0.6, 0.6, 0.6, 1.0 ); }' });
  const plainOf = new Map();
  const plain = (m) => { let p = plainOf.get(m); if (!p) {
      p = new m.constructor({ color: 0xcccccc, roughness: m.roughness, metalness: m.metalness });
      p.aoMap = m.aoMap; p.aoMapIntensity = m.aoMapIntensity; p.side = m.side; p.alphaTest = m.alphaTest; plainOf.set(m, p); }
    return p; };
  // per-variant material sets: a variant that pins a shader path / profiling knobs gets CLONES of the
  // patched map materials with userData.dfShaders / dfProf (surfaces.ts reads them per material), so a
  // frame's variant switch is a material-reference swap — never a per-frame program lookup
  const setOf = (v) => {
    const sh = v.shaders || 'new', pf = v.prof || '';
    if (sh === 'new' && !pf) return null;
    const map = new Map();
    for (const m of mats) {
      if (!m.userData || m.userData.dfSurface === undefined || typeof m.customProgramCacheKey !== 'function') continue;
      const c = m.clone();
      c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
      c.userData = Object.assign({}, m.userData, { dfShaders: sh, dfProf: pf });
      map.set(m, c);
    }
    return map;
  };
  const sets = variants.map(setOf);
  const zsort = (a, b) => (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (a.z - b.z) || (a.id - b.id);
  const baseSort = R.dfOpaqueSort || null;
  // variants run in short BLOCKS of `block` frames (A×8 B×8 C×8 …); the first `skip` frames of a block
  // are not recorded, so a frame never carries the previous variant's GPU tail or a program switch
  const A = window.__AB__ = { variants, cur: -1, frame: 0, fixed: -1, rec: false, gpu: variants.map(() => []), pending: [], disjoint: 0, ext: !!ext,
    block: 8, skip: 3 };
  A.apply = (k) => {
    if (k === A.cur) return;
    A.cur = k;
    const v = variants[k], set = sets[k];
    P.map.root.visible = !v.nomap;
    P.map.lights.forEach((l, i) => { l.visible = !v.nolights && (i < 4 || !!v.l6); });
    P.sky.sun.castShadow = !v.noshadow;
    R.setOpaqueSort(v.zsort ? zsort : v.matsort ? null : baseSort);
    for (const m of meshes) {
      const o = orig.get(m);
      m.material = v.flat ? flat : v.plain ? plain(o) : (set && set.get(o)) || o;
    }
  };
  const render0 = R.render;
  R.render = function (sc, cam) {
    const pos = A.frame % A.block;
    const k = A.fixed >= 0 ? A.fixed : (Math.floor(A.frame / A.block) % variants.length);
    A.frame++;
    A.apply(k);
    if (!(A.rec && ext) || (A.fixed < 0 && pos < A.skip)) return render0.call(this, sc, cam);
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    try { render0.call(this, sc, cam); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); A.pending.push([q, k]); }
  };
  A.poll = () => {
    while (A.pending.length) {
      const [q, k] = A.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const dj = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (dj) A.disjoint++; else A.gpu[k].push(ns / 1e6);
      gl.deleteQuery(q); A.pending.shift();
    }
  };
  return { ext: !!ext, meshes: meshes.length, materials: mats.length };
}"""

# compile a variant's programs with it applied, wait for the links, render a few frames with it
AB_WARM_JS = r"""async (k) => {
  const D = __DF__.dev, A = window.__AB__;
  A.fixed = k; A.apply(k);
  await D.renderer.compileAsync(D.scene, D.camera);
  await new Promise((r) => { let n = 0; const f = () => (++n >= 15 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  A.fixed = -1;
  return true;
}"""

AB_RECORD_JS = r"""async (secs) => {
  const A = window.__AB__;
  A.gpu = A.variants.map(() => []); A.disjoint = 0; A.fixed = -1; A.rec = true;
  const t0 = performance.now(); let frames = 0;
  await new Promise((done) => {
    const f = () => { frames++; A.poll(); if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else done(); };
    requestAnimationFrame(f);
  });
  A.rec = false;
  const tEnd = performance.now();
  while (A.pending.length && performance.now() - tEnd < 1500) { await new Promise((r) => setTimeout(r, 20)); A.poll(); }
  return { gpu: A.gpu, disjoint: A.disjoint, frames, secs: (performance.now() - t0) / 1000 };
}"""

AB_FIX_JS = "(k) => { const A = window.__AB__; A.fixed = k; if (k >= 0) A.apply(k); return true; }"


def pct(vals, p):
    s = sorted(vals)
    if not s:
        return None
    k = (len(s) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


# ── foreign GPU load (Windows): wait for a quiet GPU before each rep, and log what else drew during it ──
BACKGROUND = {"dwm", "WUDFHost", "System", "csrss", "Idle"}


def own_gpu_pids():
    """the GPU process(es) of the Chrome this script launched"""
    br = own_browser_pids()
    if not br:
        return set()
    cmd = ("@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { @(%s) -contains $_.ParentProcessId "
           "-and ([string]$_.CommandLine) -match '--type=gpu-process' } | ForEach-Object { $_.ProcessId }) -join ','") % ",".join(str(b) for b in br)
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=60)
        return {int(x) for x in (r.stdout or "").strip().split(",") if x.strip().isdigit()}
    except Exception:
        return set()


def gpu_sampler(seconds):
    """start a background sample of the 3D-engine share per process (None off Windows)"""
    if os.name != "nt":
        return None
    try:
        return subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", _GPU_PS % max(1, int(round(seconds)))],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
    except Exception:
        return None


def foreign_share(proc, own):
    """(foreign %, [(name, pid, %)…]) of a finished gpu_sampler: every process but ours and the compositor"""
    if proc is None:
        return None, []
    try:
        out, _ = proc.communicate(timeout=60)
        data = json.loads((out or "").strip() or "{}")
    except Exception:
        return None, []
    procs = data.get("procs") or []
    if isinstance(procs, dict):
        procs = [procs]
    f = [(p.get("name"), p.get("pid"), p.get("pct") or 0) for p in procs
         if p.get("pid") not in own and p.get("name") not in BACKGROUND and (p.get("pct") or 0) > 0.5]
    return round(sum(x[2] for x in f), 1), f[:4]


def wait_quiet(own, max_wait, limit):
    """poll 2 s samples until the foreign 3D share is under `limit` % (or max_wait passes)"""
    t0 = time.time()
    while True:
        share, top = foreign_share(gpu_sampler(2), own)
        if share is None or share < limit or time.time() - t0 >= max_wait:
            return share, top, time.time() - t0


def parse_variants(specs):
    out = []
    for sp in specs:
        name, _, rest = sp.partition("=")
        v = {"name": name}
        for part in [p for p in rest.split("&") if p]:
            k, eq, val = part.partition("=")
            if not eq:
                if k not in FLAGS:
                    raise SystemExit("unknown flag %r (have %s)" % (k, ", ".join(FLAGS)))
                v[k] = True
            elif k in ("shaders", "prof"):
                v[k] = val
            else:
                raise SystemExit("unknown op %r" % part)
        out.append(v)
    return out


def pose_at(s, x, y, z, yaw_deg, pitch_deg, settle=0.8):
    """unfreeze, teleport + point the camera, let one settle pass run, freeze again"""
    s.df("freeze", False)
    yaw = yaw_deg * DEG
    s.df("teleport", x, y, z, yaw)
    s.js("(y) => { __DF__.dev.parts.cam.reset(y); }", yaw)
    time.sleep(settle)
    s.df("freeze", True)
    s.js("(p) => { __DF__.dev.parts.cam.pitch = p; }", pitch_deg * DEG)


def heavy_splats(pose):
    """a mid-match floor: the court ahead painted wall to wall — SUNCREW left, GULF right, a seam down
    the middle and a few enemy pockets (the dye's painted path everywhere in view)"""
    x0, y0, z0 = pose["at"]
    out = []
    for iz in range(8):
        z = z0 + 3.0 + iz * 3.0
        for ix, x in enumerate((-9.0, -6.0, -3.0, 0.0, 3.0, 6.0, 9.0)):
            team = 1 if x < 0 else 2 if x > 0 else (1 + iz % 2)
            if (ix + iz) % 5 == 0:
                team = 3 - team
            out.append((x, pose["splats"][0][1], z, 2.4, team))
    return out


def load_map(s, a, mp):
    pose = POSES[mp]
    url = build_url(a.base, map=mp, dev=1, quality="high", seed=7, matchSeconds=900)
    s.goto(url)
    if not s.wait_df(90):
        raise RuntimeError("__DF__ never appeared (%s)" % url)
    ok, ph = s.wait_phase("ready", 180)
    if not ok:
        raise RuntimeError("never reached 'ready' (%s): %s" % (ph, str((s.state() or {}).get("error"))[:400]))
    s.df("start")
    s.wait_phase("play", 10)
    wait_match_phase(s, ("countdown", "live"), 20)
    painted = 0
    for (sx, sy, sz, r, team) in (heavy_splats(pose) if a.heavy else pose["splats"]):
        ok, n = s.df("splat", sx, sy, sz, r, team)
        painted += n if ok and isinstance(n, (int, float)) else 0
    x, y, z = pose["at"]
    pose_at(s, x, y, z, pose["yaw"], pose["pitch"])
    return {"url": url, "painted": painted}


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD frame-interleaved A/B GPU-cost bench")
    add_common_args(ap)
    ap.add_argument("--maps", default="pier18,lockwell,cinder")
    ap.add_argument("--variant", action="append", default=[], metavar="NAME[=ops]",
                    help="default: legacy=shaders=legacy, new, flat=flat")
    ap.add_argument("--reps", type=int, default=3, help="recording windows per map")
    ap.add_argument("--secs", type=float, default=8.0, help="seconds of frames per variant per window")
    ap.add_argument("--settle", type=float, default=3.0, help="seconds after the load before warming")
    ap.add_argument("--shots", action="store_true",
                    help="save _shots/perf_<map>_<variant>.png (bench pose) and perf_<map>_close_<variant>.png "
                         "for the first two variants (legacy / new)")
    ap.add_argument("--heavy", action="store_true", help="paint the court ahead wall to wall (the dye's painted path everywhere)")
    ap.add_argument("--quiet", type=float, default=120.0,
                    help="before each rep, wait up to this many seconds for other processes' 3D-engine share to drop under "
                         "--quiet-limit %% (dwm / the driver host excluded); 0 = never wait")
    ap.add_argument("--quiet-limit", type=float, default=6.0)
    ap.add_argument("--label", default="", help="report name suffix")
    a = ap.parse_args()
    if a.width == 1280 and a.height == 720:
        a.width, a.height = 1600, 900
    a.headless = True
    # a GPU reset must not get the origin's WebGL blocked for the rest of the bench
    a.chrome_arg = list(a.chrome_arg) + ["--disable-domain-blocking-for-3d-apis"]
    variants = parse_variants(a.variant or [LEGACY, "new", "flat=flat"])
    names = [v["name"] for v in variants]
    maps = [m for m in a.maps.split(",") if m]
    for m in maps:
        if m not in POSES:
            print("unknown map %s (have %s)" % (m, ", ".join(POSES)))
            return 2
    found, err = automated_chromes()
    print("other automated Chromes: %s — absolute numbers are contaminated; the frame-interleaved RATIOS are the result"
          % describe_chromes(found, err))

    rep = {"size": [a.width, a.height], "reps": a.reps, "secs": a.secs, "heavy": a.heavy, "variants": variants, "maps": {}, "diagnostics": {}}
    # one dev server for the whole bench; one FRESH browser per map (a navigation after heavy GPU use
    # lost the WebGL context twice on this box)
    server = ensure_server(a.base, not a.no_serve)
    try:
        for mp in maps:
            s = Session(a, "abperf")
            try:
                s.start()
                t0 = time.time()
                ld = load_map(s, a, mp)
                setup = s.js(AB_SETUP_JS, variants)
                if not setup.get("ext"):
                    raise RuntimeError("EXT_disjoint_timer_query_webgl2 unavailable — no GPU timing")
                time.sleep(a.settle)
                for k in range(len(variants)):
                    s.js(AB_WARM_JS, k)
                print("  %-9s loaded + warmed in %.0f s · painted %s texels · %s" % (mp, time.time() - t0, ld["painted"], setup))
                own = own_gpu_pids()
                windows = []
                for i in range(a.reps):
                    waited = None
                    if a.quiet > 0:
                        share0, top0, waited = wait_quiet(own, a.quiet, a.quiet_limit)
                    samp = gpu_sampler(a.secs * len(variants))
                    w = s.js(AB_RECORD_JS, a.secs * len(variants)) or {}
                    fshare, ftop = foreign_share(samp, own)
                    row = {}
                    for k, name in enumerate(names):
                        g = [d for d in (w.get("gpu") or [[]] * len(names))[k] if d > 0]
                        row[name] = {"n": len(g), "p25": pct(g, 25), "p50": pct(g, 50), "p90": pct(g, 90)}
                    windows.append({"rows": row, "disjoint": w.get("disjoint"), "frames": w.get("frames"), "secs": w.get("secs"),
                                    "foreignGpu": fshare, "foreignTop": ftop, "waitedQuiet": waited})
                    print("  %-9s rep %d: %s  (foreign GPU %s%%%s%s)" % (mp, i + 1, "  ".join(
                        "%s %.2f/%.2f (n%d)" % (n, row[n]["p25"] or 0, row[n]["p50"] or 0, row[n]["n"]) for n in names), fshare,
                        (" " + ", ".join("%s %s%%" % (t[0], t[2]) for t in ftop)) if ftop else "",
                        (" · waited %.0f s for quiet" % waited) if waited and waited > 2.5 else ""))
                    sys.stdout.flush()
                rep["maps"][mp] = {"load": ld, "setup": setup, "windows": windows}
                if a.shots:
                    pose = POSES[mp]
                    for tag, where in (("", None), ("close_", pose.get("close"))):
                        if where:
                            pose_at(s, where[0], where[1], where[2], pose["yaw"], where[3])
                        for k, name in enumerate(names[:2]):
                            s.js(AB_FIX_JS, k)
                            time.sleep(1.2)
                            path = os.path.join(SHOTS, "perf_%s_%s%s.png" % (mp, tag, name))
                            s.screenshot(path)
                            print("  shot %s" % path)
                    s.js(AB_FIX_JS, -1)
            except Exception as e:
                print("RUN FAILED on %s: %s" % (mp, str(e).splitlines()[0][:400]))
                rep.setdefault("fatal", {})[mp] = str(e)[:2000]
            finally:
                rep["diagnostics"][mp] = s.diagnostics() if s.page else {}
                s.close()
    finally:
        stop_server(server)

    # ── summary
    print("=" * 100)
    base = names[0]
    summary = {}
    for mp, data in rep["maps"].items():
        med = {}
        for n in names:
            p25 = [w["rows"][n]["p25"] for w in data["windows"] if w["rows"][n]["p25"]]
            p50 = [w["rows"][n]["p50"] for w in data["windows"] if w["rows"][n]["p50"]]
            if p25:
                med[n] = {"ms": statistics.median(p25), "runs": p25, "p50": statistics.median(p50)}
        summary[mp] = {"variants": med}
        print("%s   GPU ms per frame (shadow + main pass): per-rep p25 of the variant's frames, median over %d reps"
              % (mp, len(data["windows"])))
        for n, m in med.items():
            ratio = med[base]["ms"] / m["ms"] if base in med and m["ms"] else None
            print("   %-10s %7.2f ms  (reps: %s; p50 %.2f)   %s/%s = %s" % (
                n, m["ms"], " ".join("%.2f" % x for x in m["runs"]), m["p50"], base, n, ("%.2fx" % ratio) if ratio else "—"))
        if "flat" in med:
            fl = med["flat"]["ms"]
            cost = {n: med[n]["ms"] - fl for n in med if n != "flat"}
            summary[mp]["surfaceCost"] = cost
            line = "   map surface shading cost (variant − flat): " + "  ".join("%s %.2f ms" % (n, c) for n, c in cost.items())
            if base in cost:
                line += "   ratios: " + "  ".join("%s/%s %.2fx" % (base, n, cost[base] / c) for n, c in cost.items() if n != base and c > 0)
            print(line)
    rep["summary"] = summary
    for mp, d in rep["diagnostics"].items():
        for p in diag_problems(d):
            print("   X %s: %s" % (mp, p))
    print("report: %s" % save_report("abperf" + ("_" + a.label if a.label else ""), rep, a.base))
    return 2 if rep.get("fatal") else 0


if __name__ == "__main__":
    raise SystemExit(main())
