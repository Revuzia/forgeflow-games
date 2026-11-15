#!/usr/bin/env python
"""
LANE R — recoil FEEL probe. Drives the REAL input path (constructed
MouseEvent dispatched into the page listeners — aimfeel.py lineage) and
MEASURES, per weapon, in the LIVE game:

  - per-shot camera kick (deg), first-shot vs followup signature
  - total uncompensated climb over a full mag (autos) / tap string (semis)
  - recovery: start delay after last shot, rate deg/s, residual after settle
  - ADS vs hip kick ratio (spec: hip = table x 0.85)
  - semi-auto settle between shots (does the camera fully return?)
  - pulldown compensation: player pulldown must reduce the accumulator and
    recovery must NEVER over-return (pitch must not sink below where the
    player left it)
  - determinism: the camera pattern (unjittered by design) must reproduce
    exactly across two bursts
  - view-only camera punch: world-camera pitch minus input pitch during a
    burst (viewmodel.js KICK channel), peak deg

    python recoilfeel.py --label BEFORE --json ../_shots/recoilfeel_before.json
"""
import argparse, json, math, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

KIT = r"""
window.__RC__ = (() => {
  const F  = () => window.__FPS__;
  const cv = () => document.getElementById('view');
  const raf = () => new Promise(r => { let done = false;
    requestAnimationFrame(() => { if (!done) { done = true; r('raf'); } });
    setTimeout(() => { if (!done) { done = true; r('timeout'); } }, 250); });
  const rafs = async (n) => { for (let i = 0; i < n; i++) await raf(); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function move(dx, dy) {
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, cancelable: true, movementX: dx, movementY: dy }));
  }
  function down(btn) {
    cv().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: btn }));
  }
  function up(btn) {
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: btn }));
  }
  function arm() {
    const I = window.__INPUT__;
    if (!I) return false;
    I.enabled = true;
    I.pointerLocked = true;
    try { Object.defineProperty(I, 'pointerLocked',
      { get(){ return true; }, set(){}, configurable: true }); } catch (e) {}
    return true;
  }
  return { move, down, up, arm, raf, rafs, sleep, F, cv };
})();
"""

# One weapon, one phase. cfg: {id, mode:'auto'|'semi', n, ads:bool,
# pulldownPxPerFrame:0}. Returns raw per-frame samples; analysis in Python.
PHASE = r"""async (cfg) => {
  const A = __RC__, I = window.__INPUT__, F = __FPS__;
  const P = () => F.sim.state.player;
  const W = () => F.sim.state.player.weapon;
  const shots = () => F.sim.state.counters.shotsFired;
  const simT = () => F.sim.state.time;

  // settle any previous accumulator: stop firing, wait recovery out, then zero
  A.up(0); A.up(2);
  await A.rafs(10);
  const tq = simT();
  while (simT() - tq < 1.2) await A.raf();
  __FPS__.__test.give(cfg.id);
  await A.rafs(8);
  // wait out raise/switch
  const tr = simT();
  while (simT() - tr < 0.9) await A.raf();
  __FPS__.__test.setAmmo(cfg.n + 6);
  I.state.yaw = 0; I.state.pitch = 0;
  await A.rafs(6);

  if (cfg.ads) {
    A.down(2);
    for (let i = 0; i < 240 && (W().adsT || 0) < 0.999; i++) await A.raf();
  }
  await A.rafs(4);

  const rec = [];
  const s0 = shots();
  const push = () => rec.push([+simT().toFixed(5), shots() - s0,
                               I.state.pitch, I.state.yaw, F.camera.rotation.x]);
  push();
  let lastShotSimT = null;

  if (cfg.mode === 'auto') {
    A.down(0);
    for (let i = 0; i < 3000; i++) {
      await A.raf();
      if (cfg.pulldownPxPerFrame) A.move(0, cfg.pulldownPxPerFrame);
      const prev = rec[rec.length - 1][1];
      push();
      if (rec[rec.length - 1][1] > prev) lastShotSimT = simT();
      if (shots() - s0 >= cfg.n || W().mag === 0) break;
    }
    A.up(0);
  } else {
    for (let k = 0; k < cfg.n; k++) {
      A.down(0);
      await A.raf();
      A.up(0);
      const prev = rec[rec.length - 1][1]; push();
      if (rec[rec.length - 1][1] > prev) lastShotSimT = simT();
      // sample the inter-shot settle at frame rate
      const t0 = simT();
      while (simT() - t0 < (cfg.gapS || 0.35)) {
        await A.raf();
        const p = rec[rec.length - 1][1]; push();
        if (rec[rec.length - 1][1] > p) lastShotSimT = simT();
      }
    }
  }

  // recovery tail: 2.2 s of sim time after the last round
  const tEnd = simT();
  while (simT() - tEnd < 2.2) { await A.raf(); push(); }
  if (cfg.ads) A.up(2);
  await A.rafs(10);
  return { weapon: cfg.id, mode: cfg.mode, ads: !!cfg.ads,
           pulldown: cfg.pulldownPxPerFrame || 0,
           lastShotSimT, samples: rec };
}"""


def analyze(ph):
    """Turn raw frame samples into the per-weapon verdict numbers."""
    D = 180.0 / math.pi
    s = ph["samples"]
    p0 = s[0][2]
    # per-shot kicks: pitch delta across a frame where the shot count rose by 1
    kicks = []
    for i in range(1, len(s)):
        dk = s[i][1] - s[i - 1][1]
        if dk >= 1:
            kicks.append(((s[i][2] - s[i - 1][2]) * D / dk, dk, s[i][0]))
    clean = [k for k, dk, _ in kicks if dk == 1]
    first = clean[0] if clean else None
    follow = clean[1:] if len(clean) > 1 else []
    peak = max(x[2] for x in s)
    peak_t = [x[0] for x in s if x[2] == peak][0]
    total_climb = (peak - p0) * D
    final = s[-1][2]
    residual = (final - p0) * D
    # recovery: from the last shot, find when pitch starts decreasing and fit rate
    t_last = ph["lastShotSimT"] or peak_t
    tail = [x for x in s if x[0] >= t_last]
    start_dec = None
    for i in range(1, len(tail)):
        if tail[i][2] < tail[i - 1][2] - 1e-5:
            start_dec = tail[i - 1][0]
            break
    delay = (start_dec - t_last) if start_dec is not None else None
    rate = None
    if start_dec is not None:
        seg = [x for x in tail if x[0] >= start_dec and x[2] > p0 + 0.05 / D]
        if len(seg) >= 3:
            dt = seg[-1][0] - seg[0][0]
            if dt > 1e-3:
                rate = (seg[0][2] - seg[-1][2]) * D / dt
    # view-only camera punch: camera pitch minus input pitch, peak during burst
    burst = [x for x in s if ph["lastShotSimT"] and x[0] <= ph["lastShotSimT"] + 0.05]
    campunch = max((abs(x[4] - x[2]) * D) for x in burst) if burst else None
    # semi-auto inter-shot settle: pitch just before each next shot vs p0-track
    return {
        "shots": s[-1][1],
        "firstShotKickDeg": round(first, 4) if first is not None else None,
        "followupMeanKickDeg": round(sum(follow) / len(follow), 4) if follow else None,
        "followupMaxKickDeg": round(max(follow), 4) if follow else None,
        "perShotKicksDeg": [round(k, 4) for k in clean[:12]],
        "totalClimbDeg": round(total_climb, 3),
        "recoveryDelayS": round(delay, 3) if delay is not None else None,
        "recoveryRateDegPerS": round(rate, 2) if rate is not None else None,
        "residualDeg": round(residual, 4),
        "camPunchPeakDeg": round(campunch, 3) if campunch is not None else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=os.path.join(HERE, "..", "_shots", "recoilfeel.json"))
    ap.add_argument("--label", default="")
    args = ap.parse_args()
    ensure_server()

    out = {"label": args.label, "t": time.strftime("%Y-%m-%d %H:%M:%S")}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=60_000)
        pg.bring_to_front()
        t0 = time.time()
        while time.time() - t0 < 150:
            if pg.evaluate("!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim && __FPS__.__test)"):
                break
            pg.wait_for_timeout(400)
        else:
            print("NEVER BOOTED", file=sys.stderr); br.close(); return 2
        print(f"[boot] ready in {time.time()-t0:.1f}s", flush=True)
        pg.evaluate(KIT)
        pg.set_default_timeout(240_000)
        pg.evaluate("async () => { await __FPS__.__test.startMission({}); }")
        pg.wait_for_timeout(2500)
        out["armed"] = pg.evaluate("() => __RC__.arm()")
        out["version"] = pg.evaluate("() => __FPS__.version")
        pg.evaluate("() => { __FPS__.__test.god(true); __FPS__.__test.noTarget(true); }")
        out["load"] = pg.evaluate("""async () => {
            const t = []; let last = performance.now();
            for (let i = 0; i < 60; i++) {
              await __RC__.raf(); const x = performance.now(); t.push(x - last); last = x;
            }
            t.sort((a, b) => a - b);
            return { p50: +t[30].toFixed(2), fps: +(1000 / t[30]).toFixed(1) };
        }""")
        print(f"[load] {out['load']}", flush=True)

        phases = [
            # ADS full-string measurements
            {"id": "warden", "mode": "auto", "n": 30, "ads": True},
            {"id": "vesper", "mode": "auto", "n": 32, "ads": True},
            {"id": "corvus", "mode": "semi", "n": 8, "ads": True, "gapS": 0.40},
            {"id": "pike",   "mode": "semi", "n": 10, "ads": True, "gapS": 0.30},
            # hip 10-round bursts for the x0.85 check
            {"id": "warden", "mode": "auto", "n": 10, "ads": False},
            {"id": "vesper", "mode": "auto", "n": 10, "ads": False},
            # determinism: Warden ADS again — camera pattern must reproduce
            {"id": "warden", "mode": "auto", "n": 12, "ads": True},
            # pulldown compensation: heavy pulldown, recovery must not over-return
            {"id": "warden", "mode": "auto", "n": 15, "ads": True, "pulldownPxPerFrame": 6},
        ]
        out["phases"] = []
        for cfg in phases:
            s = time.time()
            try:
                raw = pg.evaluate(PHASE, cfg)
                res = {"cfg": cfg, **analyze(raw)}
                # keep raw pitch minimum for the pulldown over-return check
                if cfg.get("pulldownPxPerFrame"):
                    D = 180.0 / math.pi
                    smp = raw["samples"]
                    res["pitchStartDeg"] = round(smp[0][2] * D, 4)
                    res["pitchMinDeg"] = round(min(x[2] for x in smp) * D, 4)
                    res["pitchFinalDeg"] = round(smp[-1][2] * D, 4)
                out["phases"].append(res)
                print(f"[{cfg['id']} {'ADS' if cfg.get('ads') else 'hip'} n={cfg['n']}"
                      f"{' pulldown' if cfg.get('pulldownPxPerFrame') else ''}] "
                      f"{time.time()-s:.1f}s {json.dumps({k: v for k, v in res.items() if k not in ('cfg','perShotKicksDeg')})}",
                      flush=True)
                print(f"    perShotKicksDeg={res['perShotKicksDeg']}", flush=True)
            except Exception as e:
                out["phases"].append({"cfg": cfg, "ERROR": str(e)[:300]})
                print(f"[{cfg['id']}] FAILED after {time.time()-s:.1f}s: {e}", flush=True)
        out["pageErrors"] = errs + pg.evaluate("() => window.__BOOT_ERRORS__ || []")
        br.close()

    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"[saved] {os.path.abspath(args.json)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
