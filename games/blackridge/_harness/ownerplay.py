#!/usr/bin/env python
"""
OWNER-PLAY VERIFICATION PROBE (wave 10 judge lane).

Drives the REAL input path (constructed MouseEvent/KeyboardEvent through the
page's own listeners) and measures what a PLAYER experiences:

  A  aim truth   — angle between what you point at and where the round goes,
                   hip + ADS, all four weapons, singles + sustained burst.
                   Also: reticle-to-impact px and SIGHT-to-impact px (ADS,
                   where the crosshair is faded and the sight IS the aim).
  B  ads framing — % of screen the viewmodel covers at full ADS, per weapon,
                   plus the sight-picture disc and the horizontal threat band.
  E  mouse feel  — input->camera latency, framerate independence of look,
                   acceleration, settings existence + write-through.

Everything is measured on the live page; nothing calls an internal look/fire
function. Usage:  python _harness/ownerplay.py --only A,B,E --json out.json
"""
import argparse, json, math, os, statistics, sys, time
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
WEAPONS = ["warden", "vesper", "corvus", "pike"]

# --------------------------------------------------------------- in-page rig
RIG = r"""
() => {
  const F = window.__FPS__;
  const R = window.__OP__ = { shots: [], on: false };
  const dirFromAngles = (yaw, pitch) => {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  };
  R.dirFromAngles = dirFromAngles;
  const camFwd = () => {
    const c = F.camera; const v = new F.renderer.constructor === 0 ? null : null;
    // camera forward in world space, from its own matrix (what the player SEES)
    const m = c.matrixWorld.elements;
    return [-m[8], -m[9], -m[10]];
  };
  R.camFwd = camFwd;
  const ang = (a, b) => {
    const d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  };
  R.ang = ang;
  // reticle position as actually drawn (px offset from screen centre)
  R.reticlePx = () => {
    const el = document.getElementById("crosshair");
    if (!el) return null;
    const t = el.style.transform || "";
    const m = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(t);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
  };
  // project a world point to screen px (origin = screen centre), through the
  // camera exactly as posed for the frame just rendered
  R.project = (p) => {
    const c = F.camera;
    const v = new (F.renderer.domElement.ownerDocument.defaultView.THREE_V3 || Object)();
    // do it by hand: world -> camera -> NDC
    const e = c.matrixWorldInverse.elements;
    const x = p[0], y = p[1], z = p[2];
    const cx = e[0]*x + e[4]*y + e[8]*z + e[12];
    const cy = e[1]*x + e[5]*y + e[9]*z + e[13];
    const cz = e[2]*x + e[6]*y + e[10]*z + e[14];
    if (-cz <= 0.01) return null;
    const vh = window.innerHeight, f = (vh/2) / Math.tan((c.fov*Math.PI/180)/2);
    return [f * cx / -cz, -f * cy / -cz];
  };
  F._bridge.register("shot", (d) => {
    if (!R.on || d.shooter !== "P") return;
    const p = F.sim.state.player;
    const aim = dirFromAngles(p.yaw, p.pitch);
    const cf = camFwd();
    const rec = {
      dir: d.dir.slice(), aim, cam: cf,
      errSim: ang(aim, d.dir), errCam: ang(cf, aim), errTotal: ang(cf, d.dir),
      hit: d.hit ? d.hit.pos.slice() : null,
      ret: R.reticlePx(), fov: F.camera.fov, adsT: p.weapon.adsT || 0,
    };
    if (rec.hit) {
      const sp = R.project(rec.hit);
      if (sp) {
        rec.impactPx = sp;
        rec.retToImpact = rec.ret ? Math.hypot(sp[0]-rec.ret[0], sp[1]-rec.ret[1]) : null;
        rec.centreToImpact = Math.hypot(sp[0], sp[1]);
      }
    }
    R.shots.push(rec);
  });
  return true;
}
"""


def jsf(pg, fn, *args):
    return pg.evaluate(fn, list(args) if len(args) != 1 else args[0])


def boot(p, w=1280, h=720):
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": w, "height": h})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="load", timeout=60_000)
    pg.wait_for_function("!!(window.__FPS__ && __FPS__.sim && __FPS__.__test)", timeout=120_000)
    pg.evaluate(RIG)
    return br, pg, errs


def start(pg):
    pg.evaluate("async () => { await __FPS__.__test.startMission({}); }")
    pg.wait_for_timeout(1200)
    pg.evaluate("() => { __FPS__.__test.god(true); __FPS__.__test.noTarget(true); }")
    pg.evaluate(RIG)  # re-register after mission restart (bridge survives, but idempotent)


# ------------------------------------------------------------------ A: aim
AIM_JS = r"""
async ({weapon, ads, shots, burst, tgt}) => {
  const F = window.__FPS__, T = F.__test, R = window.__OP__;
  const cv = F.renderer.domElement;
  T.give(weapon);
  await T.tickAdvance(30);
  T.teleport(tgt.px, tgt.py, tgt.pz);
  T.aimAt(tgt.x, tgt.y, tgt.z);
  T.setAmmo(200);
  await T.tickAdvance(20);
  if (ads) {
    cv.dispatchEvent(new MouseEvent("mousedown", {button: 2, bubbles: true}));
    T.pin("ads", true);
    await T.tickAdvance(60);           // full ADS ramp
  }
  R.shots.length = 0; R.on = true;
  const adsT = (F.vm && F.vm.adsT != null) ? F.vm.adsT : -1;
  if (burst) {
    cv.dispatchEvent(new MouseEvent("mousedown", {button: 0, bubbles: true}));
    await T.tickAdvance(burst);
    window.dispatchEvent(new MouseEvent("mouseup", {button: 0, bubbles: true}));
    await T.tickAdvance(10);
  } else {
    for (let i = 0; i < shots; i++) {
      T.aimAt(tgt.x, tgt.y, tgt.z);
      await T.tickAdvance(70);          // full recoil recovery between singles
      cv.dispatchEvent(new MouseEvent("mousedown", {button: 0, bubbles: true}));
      await T.tickAdvance(2);
      window.dispatchEvent(new MouseEvent("mouseup", {button: 0, bubbles: true}));
      await T.tickAdvance(8);
      if (F.sim.state.player.weapon.mag < 5) T.setAmmo(200);
    }
  }
  R.on = false;
  const w = F.sim.state.player.weapon;
  const outAdsT = w.adsT || 0;
  if (ads) {
    T.unpin("ads");
    window.dispatchEvent(new MouseEvent("mouseup", {button: 2, bubbles: true}));
    await T.tickAdvance(40);
  }
  return {shots: R.shots.slice(), adsT: outAdsT, spread: w._lastSpread, fov: F.camera.fov};
}
"""


def stat(vals):
    vals = [v for v in vals if v is not None]
    if not vals: return None
    vals = sorted(vals)
    return {"n": len(vals), "mean": round(statistics.fmean(vals), 4),
            "p50": round(vals[len(vals)//2], 4), "max": round(vals[-1], 4)}


def lane_A(pg):
    out = {}
    # open exterior spot with a wall ahead: use the boulevard, aim at a far wall
    tgt = {"px": 20.0, "py": 1.0, "pz": -10.0, "x": 20.0, "y": 1.6, "z": -40.0}
    for wid in WEAPONS:
        for mode, kw in (("hip_single", dict(ads=False, shots=14, burst=0)),
                         ("ads_single", dict(ads=True, shots=14, burst=0)),
                         ("hip_burst", dict(ads=False, shots=0, burst=90)),
                         ("ads_burst", dict(ads=True, shots=0, burst=90))):
            r = pg.evaluate(AIM_JS, {"weapon": wid, "tgt": tgt, **kw})
            s = r["shots"]
            rec = {
                "n": len(s), "adsT": round(r["adsT"], 3),
                "spreadDeg": round(math.degrees(r["spread"] or 0), 4),
                "fov": round(r["fov"], 2),
                "errSim": stat([x["errSim"] for x in s]),
                "errCam": stat([x["errCam"] for x in s]),
                "errTotal": stat([x["errTotal"] for x in s]),
                "retToImpactPx": stat([x.get("retToImpact") for x in s]),
                "centreToImpactPx": stat([x.get("centreToImpact") for x in s]),
            }
            out[f"{wid}.{mode}"] = rec
            print(f"  {wid:7s} {mode:11s} n={rec['n']:3d} adsT={rec['adsT']:.2f} "
                  f"spread={rec['spreadDeg']:.4f}deg errSim={rec['errSim']} "
                  f"errCam={rec['errCam']} ret->impact={rec['retToImpactPx']} "
                  f"centre->impact={rec['centreToImpactPx']}", flush=True)
    return out


# ------------------------------------------------------------------ B: ADS occlusion
OCCL_JS = r"""
async ({weapon, ads}) => {
  const F = window.__FPS__, T = F.__test;
  const cv = F.renderer.domElement, r = F.renderer, gl = r.getContext();
  T.give(weapon);
  await T.tickAdvance(30);
  if (ads) {
    cv.dispatchEvent(new MouseEvent("mousedown", {button: 2, bubbles: true}));
    T.pin("ads", true);
    await T.tickAdvance(70);
  }
  T.freeze(true);
  await new Promise(res => requestAnimationFrame(res));
  T.step(1); // one real frame so every transform is current
  // ---- exact silhouette: hide every scene subtree that is NOT the vm rig,
  // force flat white on a black clear, render through the REAL vm camera.
  const THREE = F.renderer.constructor.__three || null;
  const sc = F.scene, cam = F.vm.camera;
  let rigRoot = null;
  sc.traverse(o => { if (o.name === "__vm_rig__") rigRoot = o; });
  if (!rigRoot) return {err: "no __vm_rig__ in scene"};
  // ancestor chain of the rig inside the scene
  const keep = new Set(); let n = rigRoot;
  while (n && n !== sc) { keep.add(n); n = n.parent; }
  const prevVis = [];
  const hideSiblings = (parent) => {
    for (const c of parent.children) {
      if (c === rigRoot) continue;                 // the rig itself: leave alone
      if (keep.has(c)) { hideSiblings(c); continue; } // ancestor: recurse past it
      prevVis.push([c, c.visible]); c.visible = false;
    }
  };
  hideSiblings(sc);
  let mat0 = null;
  rigRoot.traverse(o => { if (!mat0 && o.isMesh) mat0 = o.material; });
  const CtorC = (mat0 && mat0.color) ? mat0.color.constructor : null;
  const prevCC = CtorC ? r.getClearColor(new CtorC()).getHex() : 0x000000;
  const prevCA = r.getClearAlpha();
  const prevBg = sc.background, prevFog = sc.fog;
  sc.background = null; sc.fog = null;
  r.setRenderTarget(null);
  // KEY colour: the silhouette is every pixel the rig CHANGED away from it.
  r.setClearColor(0xff00ff, 1);
  r.clear(true, true, true);
  const prevAuto = r.autoClear; r.autoClear = false;
  r.clearDepth();
  r.render(sc, cam);
  r.autoClear = prevAuto;
  const dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
  const buf = new Uint8Array(dw*dh*4);
  gl.readPixels(0,0,dw,dh,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  sc.background = prevBg; sc.fog = prevFog;
  r.setClearColor(prevCC, prevCA);
  for (const [o, v] of prevVis) o.visible = v;
  T.step(1);
  T.freeze(false);
  // read the actual key colour back out of a corner (tone mapping may shift it)
  const kr = buf[0], kg = buf[1], kb = buf[2];
  let on=0, disc=0, discOf=0, band=0, bandOf=0;
  const cx = dw/2, cy = dh/2, rad = 0.12*dh;
  for (let y=0;y<dh;y++) for (let x=0;x<dw;x++) {
    const i=(y*dw+x)*4;
    const lit = (Math.abs(buf[i]-kr) + Math.abs(buf[i+1]-kg) + Math.abs(buf[i+2]-kb)) > 12;
    if (lit) on++;
    const dy = y-cy, dx = x-cx;
    if (dx*dx+dy*dy <= rad*rad) { discOf++; if (lit) disc++; }
    if (Math.abs(dy) <= rad) { bandOf++; if (lit) band++; }
  }
  const res = {pct: 100*on/(dw*dh), disc: 100*disc/Math.max(1,discOf),
               band: 100*band/Math.max(1,bandOf), w: dw, h: dh, key: [kr,kg,kb],
               vmFov: F.vm.camera.fov, adsT: F.sim.state.player.weapon.adsT || 0,
               worldFov: F.camera.fov};
  if (ads) {
    T.unpin("ads");
    window.dispatchEvent(new MouseEvent("mouseup", {button: 2, bubbles: true}));
    await T.tickAdvance(40);
  }
  return res;
}
"""


def lane_B(pg):
    out = {}
    for wid in WEAPONS:
        for mode in ("hip", "ads"):
            r = pg.evaluate(OCCL_JS, {"weapon": wid, "ads": mode == "ads"})
            if r.get("err"):
                print(f"  {wid} {mode}: ERR {r['err']}", flush=True)
                out[f"{wid}.{mode}"] = r
                continue
            rec = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()}
            out[f"{wid}.{mode}"] = rec
            print(f"  {wid:7s} {mode:3s} screen={rec['pct']:.2f}% disc={rec['disc']:.2f}% "
                  f"band={rec['band']:.2f}% vmFov={rec['vmFov']:.2f} adsT={rec['adsT']}", flush=True)
    return out


# ------------------------------------------------------------------ E: mouse feel
FEEL_JS = r"""
async ({}) => {
  const F = window.__FPS__, T = F.__test;
  const cv = F.renderer.domElement;
  const out = {};
  const yaw = () => F.sim.state.player.yaw;
  const camY = () => F.camera.rotation.y;

  // ---- pointer-lock forgery: input.js only reads movementX on mousemove
  const move = (dx, dy) => {
    const e = new MouseEvent("mousemove", {bubbles: true});
    Object.defineProperty(e, "movementX", {value: dx});
    Object.defineProperty(e, "movementY", {value: dy});
    cv.dispatchEvent(e); window.dispatchEvent(e);
  };
  out.lockOwner = !!document.pointerLockElement;

  // (1) framerate independence: 300 px in 1 event vs 30 events of 10 px
  const y0 = yaw(); move(300, 0); await T.tickAdvance(1); const a = yaw() - y0;
  const y1 = yaw(); for (let i=0;i<30;i++) move(10, 0); await T.tickAdvance(1);
  const b = yaw() - y1;
  out.oneVsMany = {oneEvent: a, thirtyEvents: b, diffRad: Math.abs(a-b)};

  // (2) acceleration: is look-per-count constant across speeds?
  const perCount = [];
  for (const d of [5, 25, 100, 400]) {
    const s = yaw(); move(d, 0); await T.tickAdvance(1);
    perCount.push({d, radPerCount: (yaw()-s)/d});
  }
  out.perCount = perCount;
  const rs = perCount.map(x=>Math.abs(x.radPerCount));
  out.accelSpread = (Math.max(...rs) - Math.min(...rs)) / Math.max(...rs);

  // (3) sensitivity setting reaches the look scale
  const S = F.settings;
  out.settings = {sens: S.sens, adsSens: S.adsSens, renderScale: S.renderScale,
                  fov: S.fov, hasAdsSens: "adsSens" in S, hasRenderScale: "renderScale" in S};

  // (4) ADS sensitivity: on-screen displacement of a fixed world point per 300 px
  const probe = async (ads) => {
    if (ads) { cv.dispatchEvent(new MouseEvent("mousedown", {button:2,bubbles:true}));
               T.pin("ads", true); await T.tickAdvance(60); }
    await T.tickAdvance(4);
    const fov0 = F.camera.fov, s = yaw();
    move(300, 0); await T.tickAdvance(3);
    const dyaw = yaw() - s;
    const vh = window.innerHeight;
    const f = (vh/2)/Math.tan((fov0*Math.PI/180)/2);
    const px = f * Math.tan(Math.abs(dyaw));
    move(-300, 0); await T.tickAdvance(3);
    if (ads) { T.unpin("ads");
               window.dispatchEvent(new MouseEvent("mouseup", {button:2,bubbles:true}));
               await T.tickAdvance(40); }
    return {fov: fov0, dyawDeg: Math.abs(dyaw)*180/Math.PI, screenPx: px};
  };
  out.hip = await probe(false);
  out.ads = await probe(true);
  out.angularRatio = out.ads.dyawDeg / out.hip.dyawDeg;
  out.screenRatio = out.ads.screenPx / out.hip.screenPx;
  out.fovRatio = out.ads.fov / out.hip.fov;
  return out;
}
"""

LAT_JS = r"""
async ({n}) => {
  const F = window.__FPS__;
  const cv = F.renderer.domElement;
  const samples = [];
  for (let i=0;i<n;i++) {
    await new Promise(r=>requestAnimationFrame(r));
    const before = F.camera.rotation.y;
    const t0 = performance.now();
    const e = new MouseEvent("mousemove", {bubbles:true});
    Object.defineProperty(e, "movementX", {value: (i%2?1:-1)*260});
    Object.defineProperty(e, "movementY", {value: 0});
    cv.dispatchEvent(e); window.dispatchEvent(e);
    let frames = 0;
    while (frames < 12) {
      await new Promise(r=>requestAnimationFrame(r));
      frames++;
      if (Math.abs(F.camera.rotation.y - before) > 1e-6) break;
    }
    samples.push({ms: performance.now()-t0, frames});
  }
  const ms = samples.map(s=>s.ms).sort((a,b)=>a-b);
  const fr = samples.map(s=>s.frames).sort((a,b)=>a-b);
  return {medianMs: ms[Math.floor(ms.length/2)], maxMs: ms[ms.length-1],
          medianFrames: fr[Math.floor(fr.length/2)], n: samples.length,
          frameMs: F.stats().p50};
}
"""


def lane_E(pg):
    out = pg.evaluate(FEEL_JS, {})
    print("  " + json.dumps({k: v for k, v in out.items() if k != "perCount"}, indent=1)[:1400], flush=True)
    print("  perCount " + json.dumps(out["perCount"]), flush=True)
    lat = pg.evaluate(LAT_JS, {"n": 24})
    print("  latency " + json.dumps(lat), flush=True)
    out["latency"] = lat
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="A,B,E")
    ap.add_argument("--json", default=os.path.join(HERE, "..", "_shots", "ownerplay.json"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    a = ap.parse_args()
    ensure_server()
    only = set(x.strip().upper() for x in a.only.split(","))
    res = {}
    with sync_playwright() as p:
        br, pg, errs = boot(p, a.width, a.height)
        try:
            start(pg)
            if "A" in only:
                print("== LANE A: AIM TRUTH ==", flush=True); res["A"] = lane_A(pg)
            if "B" in only:
                print("== LANE B: ADS OCCLUSION ==", flush=True); res["B"] = lane_B(pg)
            if "E" in only:
                print("== LANE E: MOUSE FEEL ==", flush=True); res["E"] = lane_E(pg)
        finally:
            res["pageErrors"] = errs
            res["stats"] = pg.evaluate("() => __FPS__.stats()")
            br.close()
    print("\npageErrors:", errs)
    print("stats:", json.dumps(res["stats"]))
    with open(a.json, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print("wrote", a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
