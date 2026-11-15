#!/usr/bin/env python
"""LANE C gate — the four numbers that decide whether the ground glitch is gone.

Everything is read out of the RUNNING game.

  coplanarProbes    down-raycast grid over the whole map (1 m, offset off the
                    vertex lattice); counts spots carrying two OPAQUE
                    depth-writing surfaces within 1 mm. Any non-zero == the
                    z-fighting that reads as crawling black patches.
  indoorSheetM2     area of the additive wet-specular sheet that has aWet > 0
                    while standing inside a roofed interior rect. Any non-zero
                    == a hard-edged bright slab painted on a room's floor.
  floorBlackPct     % of the interior-floor band of the gallery frame at
                    luma < 12 (the "black patches" the owner photographed).
  redPct/peakRed    % of the lower half of the neon-plaza frame that is
                    red-dominant, and the brightest red pixel in it.

    python lanec_gate.py --tag before
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server  # noqa: E402

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"
W, H = 1280, 720

# roofed rects, from layout.js ROADS (kind concrete_interior / tile_interior)
INTERIORS = [[15.5, -34, 24.5, 14], [-39, -19, -26, 5]]

POSES = [
    ("galdoor", 20.0, 1.65, -16.0, 0, -18),
    ("galseam", 20.0, 1.65, -20.0, 270, -18),
    ("neonwedge", 5.0, 1.65, 8.0, 240, -30),
]

COPLANAR = """(a) => {
  const F = globalThis.__FPS__, THREE = globalThis.__THREE_NS__;
  const rc = new THREE.Raycaster();
  rc.camera = F.camera; rc.far = 60; rc.layers.set(0);
  const down = new THREE.Vector3(0, -1, 0), org = new THREE.Vector3();
  const bb = new THREE.Box3(), cand = [];
  F.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    try { bb.setFromObject(o); } catch (e) { return; }
    if (bb.max.y - bb.min.y > 1.2) return;
    if (bb.max.x - bb.min.x < 2 || bb.max.z - bb.min.z < 2) return;
    if (bb.min.y > 3) return;
    cand.push(o);
  });
  let n = 0, probes = 0;
  const where = [];
  for (let x = a.x0; x <= 58; x += 1) {
    for (let z = a.z0; z <= 54; z += 1) {
      org.set(x, 12, z); rc.set(org, down);
      const solid = [];
      for (const h of rc.intersectObjects(cand, false)) {
        let m = h.object.material; if (Array.isArray(m)) m = m[0];
        if (!m || m.transparent || m.depthWrite === false) continue;
        solid.push(h);
      }
      probes++;
      for (let i = 0; i < solid.length - 1; i++) {
        if (Math.abs(solid[i].distance - solid[i + 1].distance) <= 0.001) {
          n++;
          if (where.length < 6) where.push([+x.toFixed(2), +z.toFixed(2),
                                            solid[i].object.name, solid[i + 1].object.name]);
          break;
        }
      }
    }
  }
  return { probes, coplanar: n, sample: where };
}"""

# Sum the triangle area of the wet-specular sheet that is (a) inside a roofed
# rect and (b) still carrying wetness. Geometry, not pixels — exact.
INDOOR_SHEET = """(rects) => {
  const F = globalThis.__FPS__;
  let mesh = null;
  F.scene.traverse(o => { if (o.name === 'wet_specular') mesh = o; });
  if (!mesh) return { error: 'wet_specular missing' };
  const g = mesh.geometry;
  const pos = g.getAttribute('position'), wet = g.getAttribute('aWet');
  const idx = g.index;
  const nTri = idx ? idx.count / 3 : pos.count / 3;
  const inside = (x, z) => rects.some(r => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]);
  let area = 0, tris = 0, maxWet = 0;
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const w = Math.max(wet.getX(i0), wet.getX(i1), wet.getX(i2));
    if (w <= 1e-4) continue;
    const ax = pos.getX(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cz = pos.getZ(i2);
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    if (!inside(mx, mz)) continue;
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * 0.5;
    tris++;
    maxWet = Math.max(maxWet, w);
  }
  return { indoorWetTris: tris, indoorWetM2: +area.toFixed(2), maxWet: +maxWet.toFixed(3),
           sheetTris: nTri };
}"""


def frame_metrics(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    # floor band: bottom 45%, left 55% (keeps the first-person weapon out of it)
    fb_n = fb_black = 0
    for y in range(int(h * 0.55), h, 2):
        for x in range(0, int(w * 0.55), 2):
            r, g, b = px[x, y]
            fb_n += 1
            if 0.2126 * r + 0.7152 * g + 0.0722 * b < 12:
                fb_black += 1
    red_n = red = 0
    peak = 0
    for y in range(h // 2, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            red_n += 1
            if r > 30 and r > g * 1.55 + 8 and r > b * 1.55 + 8:
                red += 1
                peak = max(peak, r)
    return {"floorBlackPct": round(100.0 * fb_black / max(1, fb_n), 3),
            "redPct": round(100.0 * red / max(1, red_n), 3), "peakRed": peak}


def flip_pct(a_path, b_path):
    a = Image.open(a_path).convert("RGB").load()
    b_im = Image.open(b_path).convert("RGB")
    w, h = b_im.size
    b = b_im.load()
    n = flip = 0
    for y in range(int(h * 0.55), h, 2):
        for x in range(0, int(w * 0.55), 2):
            n += 1
            ar, ag, ab = a[x, y]
            br_, bg, bb = b[x, y]
            la = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab
            lb = 0.2126 * br_ + 0.7152 * bg + 0.0722 * bb
            if abs(la - lb) > 18:
                flip += 1
    return round(100.0 * flip / max(1, n), 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run")
    args = ap.parse_args()
    ensure_server()
    out = {"tag": args.tag}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": W, "height": H})
        gl = []
        pg.on("console", lambda m: gl.append(m.text) if "Feedback loop" in m.text else None)
        pg.goto(URL, wait_until="load", timeout=60_000)
        t0 = time.time()
        while time.time() - t0 < 120 and not pg.evaluate(READY):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(2000)
        pg.evaluate("() => __FPS__.__test.startMission({seed: 7})")
        pg.wait_for_timeout(1500)
        pg.evaluate("() => { __FPS__.__test.god(true); __FPS__.__test.hud(false); }")
        pg.add_script_tag(type="module", content=(
            'import * as THREE from "three"; globalThis.__THREE_NS__ = THREE;'))
        pg.wait_for_function("() => !!globalThis.__THREE_NS__", timeout=30000)

        out["coplanar"] = pg.evaluate(COPLANAR, {"x0": -57.6297, "z0": -57.3713})
        out["indoorSheet"] = pg.evaluate(INDOOR_SHEET, INTERIORS)
        shots = os.path.abspath(os.path.join(HERE, "..", "_shots", "lanec_gate"))
        os.makedirs(shots, exist_ok=True)
        out["frames"] = {}
        # Freeze the sim: with rain and animation running, two captures differ
        # by ~3% of the floor band no matter what the depth buffer does, which
        # would bury the z-fight flip in noise.
        pg.evaluate("() => __FPS__.__test.freeze(true)")
        for name, x, y, z, yaw, pitch in POSES:
            pg.evaluate("""(a) => __FPS__.__test.placePlayer(a.x, a.y, a.z,
                             a.yaw * Math.PI / 180, a.pitch * Math.PI / 180)""",
                        {"x": x, "y": y, "z": z, "yaw": yaw, "pitch": pitch})
            pg.wait_for_timeout(250)
            pg.evaluate("(n) => __FPS__.__test.capture(n, %d, %d, {hudLayer:false})" % (W, H),
                        f"lanec_gate/{name}_{args.tag}.png")
            m = frame_metrics(os.path.join(shots, f"{name}_{args.tag}.png"))
            # Z-FIGHT FLIP: nudge the eye 1 mm and re-capture. Real geometry
            # moves sub-pixel; a depth tie flips whole regions to the other
            # surface. Fraction of floor-band pixels that change by > 18 luma
            # IS the crawling-black-patch artefact, measured.
            pg.evaluate("""(a) => __FPS__.__test.placePlayer(a.x, a.y, a.z,
                             a.yaw * Math.PI / 180, a.pitch * Math.PI / 180)""",
                        {"x": x + 0.001, "y": y, "z": z + 0.001, "yaw": yaw, "pitch": pitch})
            pg.wait_for_timeout(250)
            pg.evaluate("(n) => __FPS__.__test.capture(n, %d, %d, {hudLayer:false})" % (W, H),
                        f"lanec_gate/{name}_{args.tag}_nudge.png")
            m["zflipPct"] = flip_pct(os.path.join(shots, f"{name}_{args.tag}.png"),
                                     os.path.join(shots, f"{name}_{args.tag}_nudge.png"))
            out["frames"][name] = m
        out["feedbackLoopWarnings"] = len(gl)
        br.close()
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
