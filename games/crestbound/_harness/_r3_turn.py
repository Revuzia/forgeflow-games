"""R3 feel lane: find clear ground, then measure GROUND TURN RADIUS at run vs walk.

CONTRACT §11 ANALOG: "turn rate scales with speed (slow = snappy, fast = wide arc)".
No gate measures it. feelshots' `turnarc` bonked into the meadow dressing, so this
first PROBES for a clear disc, then drives a sustained circle (stick held 90 deg
off the live facing every frame) and reports the traced radius.
"""
import json, math, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, CLICK_JS, STATE_JS, launch, leave_title, DEFAULT_URL, HERE

PROBE_JS = r"""
(r) => {
  /* Sweep candidate centres; for each, ray the broadphase outward in 16
     directions at hero chest height and report the smallest clearance. */
  const G = CRESTBOUND.game, C = G.course, T = CRESTBOUND.THREE;
  const bp = C.broadphase;
  const o = new T.Vector3(), dir = new T.Vector3(), hit = {t:0, normal:new T.Vector3(), collider:null};
  const best = [];
  for (let cx = -30; cx <= 30; cx += 5) {
    for (let cz = 10; cz <= 60; cz += 5) {
      let gy = -1e9;
      for (const h of bp.heightfields) { const y = h.heightAt(cx, cz); if (Number.isFinite(y) && y > gy) gy = y; }
      if (gy < -1e8) continue;
      o.set(cx, gy + 0.75, cz);
      let min = 1e9;
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8;
        dir.set(Math.cos(a), 0, Math.sin(a));
        const ok = bp.raycast(o, dir, r, hit);
        const d = ok ? hit.t : r;
        if (d < min) min = d;
      }
      /* also require the ground to be flat-ish across the disc */
      let flat = true;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, rr = Math.min(min, r) * 0.8;
        const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
        let y2 = -1e9;
        for (const h of bp.heightfields) { const y = h.heightAt(px, pz); if (Number.isFinite(y) && y > y2) y2 = y; }
        if (y2 < -1e8 || Math.abs(y2 - gy) > 0.6) { flat = false; break; }
      }
      if (flat) best.push({x: cx, z: cz, y: +gy.toFixed(2), clear: +min.toFixed(2)});
    }
  }
  best.sort((a, b) => b.clear - a.clear);
  return best.slice(0, 8);
}
"""

# Hold the stick 90 deg off the LIVE facing, forever: the hero traces the tightest
# circle its turn rate allows at the speed the stick magnitude asks for.
CIRCLE_JS = r"""
(cfg) => {
  const F = window.__FEEL, G = CRESTBOUND.game;
  F.begin({});
  F.place(cfg.x, cfg.y + 0.2, cfg.z, 0);
  F.step(20);
  F.begin({});
  const mag = cfg.mag, sgn = cfg.sgn || 1;
  /* Re-aim every frame: WORLD direction = facing rotated by +90 deg. */
  const orig = F.step;
  for (let i = 0; i < cfg.frames; i++) {
    const f = G.player.facing;
    const a = f + sgn * Math.PI / 2;
    F.setStick(-Math.sin(a), -Math.cos(a), mag);
    orig.call(F, 1);
  }
  return F.dump();
}
"""

def circle_stats(samples, skip):
    """Radius of the traced circle from the settled tail + the achieved turn rate."""
    s = samples[skip:]
    if len(s) < 20: return None
    xs = [k["x"] for k in s]; zs = [k["z"] for k in s]
    # algebraic circle fit (Kasa)
    n = len(xs); sx = sum(xs); sz = sum(zs)
    mx, mz = sx / n, sz / n
    u = [x - mx for x in xs]; v = [z - mz for z in zs]
    suu = sum(a*a for a in u); svv = sum(b*b for b in v); suv = sum(a*b for a, b in zip(u, v))
    suuu = sum(a**3 for a in u); svvv = sum(b**3 for b in v)
    suvv = sum(a*b*b for a, b in zip(u, v)); svuu = sum(b*a*a for a, b in zip(u, v))
    det = 2 * (suu * svv - suv * suv)
    if abs(det) < 1e-9: return None
    uc = (svv * (suuu + suvv) - suv * (svvv + svuu)) / det
    vc = (suu * (svvv + svuu) - suv * (suuu + suvv)) / det
    R = math.sqrt(uc*uc + vc*vc + (suu + svv) / n)
    # turn rate from the facing series (unwrapped)
    fs = [k["f"] for k in s]
    tot = 0.0
    for i in range(1, len(fs)):
        d = fs[i] - fs[i-1]
        while d > math.pi: d -= 2*math.pi
        while d < -math.pi: d += 2*math.pi
        tot += d
    rate = abs(tot) / ((len(fs) - 1) / 60.0)
    sp = sum(k["sp"] for k in s) / len(s)
    return {"radius_m": round(R, 3), "turn_rate_rad_s": round(rate, 3),
            "mean_speed": round(sp, 3), "implied_radius": round(sp / rate, 3) if rate > 1e-6 else None,
            "states": sorted(set(k["st"] for k in s))}

def main():
    out = {}
    with sync_playwright() as p:
        br = launch(p, headless=True)
        pg = br.new_page(viewport={"width": 900, "height": 520})
        pg.goto(DEFAULT_URL, wait_until="load", timeout=90_000)
        t = time.time() + 120
        while time.time() < t:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(400)
        leave_title(pg)
        pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
        leave_title(pg, 60); pg.wait_for_timeout(1500)
        assert pg.evaluate(DRIVER_JS) == "ok"

        spots = pg.evaluate(PROBE_JS, 14.0)
        out["clear_spots"] = spots
        print("clear spots (x, z, groundY, min clearance over 16 rays, 14 m cap):")
        for s in spots: print("   ", s)
        spot = spots[0]
        print("\nusing centre (%.1f, %.1f) ground %.2f  clearance %.2f m" % (spot["x"], spot["z"], spot["y"], spot["clear"]))

        for label, mag in (("run_mag1.0", 1.0), ("walk_mag0.40", 0.40), ("mid_mag0.70", 0.70)):
            d = pg.evaluate(CIRCLE_JS, {"x": spot["x"], "y": spot["y"], "z": spot["z"],
                                        "mag": mag, "sgn": 1, "frames": 150})
            st = circle_stats(d["samples"], 60)
            out[label] = {"stats": st, "err": d["err"][:3],
                          "samples": d["samples"][::3]}
            print("\n%-14s %s" % (label, st))
        br.close()
    with open(os.path.join(HERE, "_r3_turn.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nwrote _harness/_r3_turn.json")

main()
