#!/usr/bin/env python
"""LANE C red-wedge hunt — find red/maroon ground pixels in the LIVE frame,
then name the object that produced them.

Walks a grid of eye poses over the playable map, captures each frame through
`__test.capture()` (render + readback in one task), scans the LOWER HALF of
each frame for red-dominant clusters, and for the biggest cluster in each
frame raycasts the shipped camera through that exact pixel to report the
object / material behind it.
"""
import json, os, sys, time
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

PICK = """(a) => {
  const F = globalThis.__FPS__, THREE = globalThis.__THREE_NS__;
  const rc = new THREE.Raycaster();
  rc.camera = F.camera;
  rc.setFromCamera({ x: (a.x / a.w) * 2 - 1, y: -(a.y / a.h) * 2 + 1 }, F.camera);
  rc.far = 300;
  const hits = rc.intersectObjects(F.scene.children, true);
  const out = [];
  for (const h of hits) {
    const o = h.object;
    if (!o.visible || !(o.isMesh || o.isSprite)) continue;
    let m = o.material;
    if (Array.isArray(m)) m = m[h.face && h.face.materialIndex != null ? h.face.materialIndex : 0];
    if (!m) continue;
    out.push({ dist: +h.distance.toFixed(2), obj: o.name || '(unnamed)',
               parent: (o.parent && o.parent.name) || '', type: o.type,
               mat: m.name || m.type, color: m.color ? '#' + m.color.getHexString() : null,
               emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
               transparent: !!m.transparent, vcol: !!m.vertexColors,
               point: [+h.point.x.toFixed(2), +h.point.y.toFixed(2), +h.point.z.toFixed(2)] });
    if (out.length >= 5) break;
  }
  return out;
}"""


def poses():
    out = []
    # gallery interior (concrete), both directions, plus the r_cut doorway
    for z in (-32, -28, -24, -20, -16, 0, 10):
        for yaw in (0, 90, 180, 270):
            out.append((f"gal_z{z}_y{yaw}", 20.0, 1.65, float(z), yaw, -18))
    # arcade interior (tile)
    for z in (-16, -10, -4, 2):
        for yaw in (0, 90, 180, 270):
            out.append((f"arc_z{z}_y{yaw}", -32.0, 1.65, float(z), yaw, -18))
    # plaza + street looking at ground
    for (x, z) in ((-5, 2), (-14, -10), (5, 8), (-6, -30), (36, -20), (0, -46)):
        for yaw in (0, 120, 240):
            out.append((f"ext_{x}_{z}_y{yaw}", float(x), 1.65, float(z), yaw, -30))
    return out


def red_clusters(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    mask = []
    for y in range(h // 2, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if r > 30 and r > g * 1.55 + 8 and r > b * 1.55 + 8:
                mask.append((x, y))
    if not mask:
        return None
    # crude single-cluster summary: bbox + centroid + count
    xs = [p[0] for p in mask]; ys = [p[1] for p in mask]
    cx = sum(xs) // len(xs); cy = sum(ys) // len(ys)
    return {"n": len(mask) * 4, "pctOfFrame": round(100.0 * len(mask) * 4 / (w * h), 3),
            "bbox": [min(xs), min(ys), max(xs), max(ys)], "centroid": [cx, cy],
            "sample": px[cx, cy] if 0 <= cx < w and 0 <= cy < h else None}


def main():
    ensure_server()
    shots = os.path.join(HERE, "..", "_shots", "lanec_red")
    os.makedirs(os.path.abspath(shots), exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": W, "height": H})
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

        hits = []
        for name, x, y, z, yaw, pitch in poses():
            pg.evaluate("""(a) => __FPS__.__test.placePlayer(a.x, a.y, a.z,
                             a.yaw * Math.PI / 180, a.pitch * Math.PI / 180)""",
                        {"x": x, "y": y, "z": z, "yaw": yaw, "pitch": pitch})
            pg.wait_for_timeout(180)
            pg.evaluate("(n) => __FPS__.__test.capture(n, %d, %d, {hudLayer:false})" % (W, H),
                        f"lanec_red/{name}.png")
            f = os.path.abspath(os.path.join(shots, f"{name}.png"))
            c = red_clusters(f)
            if c and c["pctOfFrame"] > 0.10:
                cx, cy = c["centroid"]
                pick = pg.evaluate(PICK, {"x": cx, "y": cy, "w": W, "h": H})
                c["pose"] = name
                c["pick"] = pick
                hits.append(c)
                print(json.dumps(c))
        print(f"\nposes: {len(poses())}   frames with >0.10% red: {len(hits)}")
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
