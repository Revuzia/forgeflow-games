#!/usr/bin/env python
"""CRESTBOUND camera ORBIT SWEEP — deterministic, framerate-independent.

camshots.py drives a real play session, so on a contended box (30..48 chrome.exe
from parallel lanes, measured this session) the hero does not travel far enough
in a wall-clock route and the interesting geometry is never reached. This probe
removes the clock: at every AUTHORED station (spawn + every checkpoint) it parks
Nim, then sweeps the orbit yaw through N headings, stepping `cam.update(1/60)`
by hand a fixed number of times per heading. Nothing depends on rAF, so the
numbers are identical at 60 fps and at 3 fps.

Per station x heading it records:
  dist       - the collided camera distance the camera settles on
  heroFade   - what hero.js is told to do (1.0 = hero FULLY INVISIBLE)
  ndc        - where the hero's chest lands in the frame (|x|,|y| > 1 = off-screen)
  inSolid    - is the lens itself inside a solid collider
  wallFrac   - fraction of a 3x3 view-ray grid hitting a surface within 2 m
  occluded   - is the lens->chest segment blocked by geometry

Exit code is always 0 - this reports, it does not gate.

    python camsweep.py                 # keep + verdant-1, headless
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "_shots", "cam")
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

CLICK_JS = r"""() => {
  const words = ['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN'];
  const btns = Array.from(document.querySelectorAll('button,[role=button],.btn'));
  for (const w of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(w) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return w;
  }
  return null;
}"""
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

SWEEP_JS = r"""
(opts) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const cam = G.cam || G.camera, tcam = A.engine.camera, P = G.player;
  if (!cam || !cam.__test) return {error: 'cam.__test missing'};
  const course = G.course;
  const bp = (course && course.broadphase) || null;
  const canRay = !!(bp && typeof bp.raycast === 'function');
  const canQ   = !!(bp && typeof bp.query === 'function');

  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
  const _hit = {t:0, normal:new THREE.Vector3(), collider:null};
  const _box = new THREE.Box3(); const qOut = [];
  const GRID = [];
  for (let gy=-1; gy<=1; gy++) for (let gx=-1; gx<=1; gx++) GRID.push([gx*0.6, gy*0.6]);

  const inSolid = (x,y,z) => {
    if (!canQ) return null;
    _box.min.set(x-0.02,y-0.02,z-0.02); _box.max.set(x+0.02,y+0.02,z+0.02);
    qOut.length = 0; let list;
    try { list = bp.query(_box, qOut) || qOut; } catch(e) { return null; }
    for (let i=0;i<list.length;i++){ const c=list[i];
      if(!c||c.active===false||c.solid===false) continue;
      if(typeof c.containsPoint!=='function') continue;
      _v.set(x,y,z); if(c.containsPoint(_v)) return true; }
    return false;
  };
  const wallFrac = () => {
    if (!canRay) return null;
    let h=0;
    for (let i=0;i<GRID.length;i++){
      _v.set(GRID[i][0],GRID[i][1],0.5).unproject(tcam).sub(tcam.position);
      const L=_v.length(); if(L<1e-6) continue;
      _d.copy(_v).multiplyScalar(1/L);
      try { if (bp.raycast(tcam.position,_d,2.0,_hit)) h++; } catch(e) { return null; }
    }
    return h/GRID.length;
  };

  const def = course && course.def;
  const stations = [];
  if (def && def.spawn) stations.push({id:'spawn', p:def.spawn.p, yaw:def.spawn.yaw||0});
  const cps = (def && def.checkpoints) || [];
  for (let i=0;i<cps.length;i++) stations.push({id: cps[i].id || ('cp'+i), p: cps[i].p, yaw: cps[i].yaw||0});

  const N = opts.headings|0, STEPS = opts.steps|0, DT = 1/60;
  const rows = [];
  for (const st of stations) {
    for (let k=0;k<N;k++) {
      const yaw = -Math.PI + (2*Math.PI) * k / N;
      P.__test.teleport(_v.set(st.p[0], st.p[1] + 0.05, st.p[2]));
      if (P.__test.setVel) P.__test.setVel(_v.set(0,0,0));
      if (P.__test.setFacing) P.__test.setFacing(yaw);
      if (typeof cam.snapToPlayer === 'function') cam.snapToPlayer();
      cam.__test.setYaw(yaw); cam.__test.setPitch(0.22);
      for (let s=0;s<STEPS;s++) cam.update(DT);
      const cs = cam.__test.state();
      tcam.position.set(cs.pos[0],cs.pos[1],cs.pos[2]);
      tcam.up.set(0,1,0); tcam.lookAt(cs.look[0],cs.look[1],cs.look[2]);
      tcam.updateMatrixWorld(true);
      const rp = P.renderPos || P.pos;
      _c.set(rp.x, rp.y + (P.height||1.5)*0.55, rp.z);
      _v.copy(_c).project(tcam);
      let occ = null;
      if (canRay) {
        _d.copy(_c).sub(tcam.position); const L=_d.length();
        if (L>0.15){ _d.multiplyScalar(1/L);
          try { occ = bp.raycast(tcam.position,_d,L-0.12,_hit); } catch(e){ occ=null; } }
        else occ = false;
      }
      rows.push({station: st.id, yaw:+yaw.toFixed(3),
                 dist:+cs.dist.toFixed(3), fade:+(cs.heroFade||0).toFixed(3),
                 ndcX:+_v.x.toFixed(3), ndcY:+_v.y.toFixed(3),
                 inSolid: inSolid(cs.pos[0],cs.pos[1],cs.pos[2]),
                 wallFrac: wallFrac(), occluded: occ});
    }
  }
  return {ok:true, rows, stations: stations.length, headings:N, canRay, canQ};
}
"""


def summarise(course, rows):
    n = len(rows)
    hidden = [r for r in rows if r["fade"] >= 0.999]
    partial = [r for r in rows if 0.5 <= r["fade"] < 0.999]
    offscr = [r for r in rows if abs(r["ndcX"]) > 1 or abs(r["ndcY"]) > 1]
    solid = [r for r in rows if r["inSolid"] is True]
    wall = [r for r in rows if r["wallFrac"] is not None and r["wallFrac"] >= 0.78]
    occ = [r for r in rows if r["occluded"] is True and r["fade"] < 0.9]
    per = {}
    for r in rows:
        d = per.setdefault(r["station"], {"n": 0, "hidden": 0, "partial": 0, "offscr": 0,
                                          "solid": 0, "wall": 0, "occ": 0, "minDist": 99.0})
        d["n"] += 1
        d["minDist"] = min(d["minDist"], r["dist"])
        if r["fade"] >= 0.999:
            d["hidden"] += 1
        elif r["fade"] >= 0.5:
            d["partial"] += 1
        if abs(r["ndcX"]) > 1 or abs(r["ndcY"]) > 1:
            d["offscr"] += 1
        if r["inSolid"] is True:
            d["solid"] += 1
        if r["wallFrac"] is not None and r["wallFrac"] >= 0.78:
            d["wall"] += 1
        if r["occluded"] is True and r["fade"] < 0.9:
            d["occ"] += 1
    for d in per.values():
        d["minDist"] = round(d["minDist"], 3)
    return {"course": course, "samples": n,
            "heroFullyHidden": len(hidden),
            "heroFullyHiddenPct": round(100.0 * len(hidden) / max(1, n), 1),
            "heroPartlyFaded": len(partial),
            "heroOffScreen": len(offscr), "lensInSolid": len(solid),
            "wallFillsFrame": len(wall), "heroOccluded": len(occ),
            "minDist": round(min(r["dist"] for r in rows), 3),
            "perStation": per,
            "worst": sorted(rows, key=lambda r: r["dist"])[:10]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--course", default=None)
    ap.add_argument("--headings", type=int, default=24)
    ap.add_argument("--steps", type=int, default=45)
    args = ap.parse_args()
    courses = [args.course] if args.course else ["keep", "verdant-1"]
    os.makedirs(OUT, exist_ok=True)
    out = {"headings": args.headings, "steps": args.steps, "courses": {}}
    with sync_playwright() as p:
        br = None
        for a in range(6):
            try:
                br = p.chromium.launch(channel="chrome", headless=not args.headed, args=FLAGS)
                break
            except Exception as e:
                print("  launch %d failed (%s)" % (a + 1, str(e)[:80]), file=sys.stderr)
                time.sleep(10 * (a + 1))
        if br is None:
            raise RuntimeError("chrome would not launch")
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        for a in range(5):
            try:
                pg.goto(args.url, wait_until="load", timeout=180000)
                break
            except Exception:
                print("  goto %d failed" % (a + 1), file=sys.stderr)
                time.sleep(15)
        t0 = time.time()
        while time.time() - t0 < 180:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
        t0 = time.time()
        while time.time() - t0 < 180:
            if pg.evaluate(STATE_JS) in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(700)
        t0 = time.time()
        while time.time() - t0 < 180:
            try:
                if pg.evaluate("!!(CRESTBOUND.game.player && CRESTBOUND.game.player.__test"
                               " && (CRESTBOUND.game.cam||CRESTBOUND.game.camera))"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        for c in courses:
            if c != "keep":
                pg.evaluate("(id) => CRESTBOUND.game.__dev.goto(id)", c)
                t0 = time.time()
                while time.time() - t0 < 90:
                    if (pg.evaluate(STATE_JS) == "playing"
                            and pg.evaluate("CRESTBOUND.game.courseId") == c):
                        break
                    pg.wait_for_timeout(300)
                pg.wait_for_timeout(1500)
            res = pg.evaluate(SWEEP_JS, {"headings": args.headings, "steps": args.steps})
            if res.get("error"):
                raise RuntimeError(res["error"])
            s = summarise(c, res["rows"])
            out["courses"][c] = {"summary": s, "rows": res["rows"]}
            print("  %-10s stations=%d headings=%d  heroFullyHidden=%d/%d (%.1f%%)  "
                  "offScreen=%d  lensInSolid=%d  wallFills=%d  minDist=%.2f"
                  % (c, res["stations"], res["headings"], s["heroFullyHidden"], s["samples"],
                     s["heroFullyHiddenPct"], s["heroOffScreen"], s["lensInSolid"],
                     s["wallFillsFrame"], s["minDist"]))
        out["consoleErrors"] = errs
        br.close()
    dest = os.path.join(OUT, "camsweep.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("wrote %s" % dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
