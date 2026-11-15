#!/usr/bin/env python3
"""art_b_interior.py - real-browser contact sheet + furnished-room vignettes of the Wave 8 interior kit (lane H2; dev-only, _tools/ never ships).

A headless Chrome page (three r172 + GLTFLoader + MeshoptDecoder, all read from the game's own VENDORED copies under assets/vendor/three/, i.e. the loader path the
game uses) draws every interior piece of manifest_interior.json (and, with --all, the 32 shipped furniture / wall pieces of manifest.json):
  * one tile per piece: a 3/4 view, a 1 m ground grid, a 1.8 m orange stand-in person, the manifest's collider boxes as red wireframes, and a green arrow along +Z
    (the authored FRONT every piece must face; a piece whose arrow leaves through its back is turned wrong)
  * --rooms: a few furnished rooms built from the kit (floor slabs, walls, a doorway, a window port, a flight of stairs) seen from a third-person camera, so the kit is
    judged as a player sees it, at the game's camera height.
The page never touches the network (a Playwright route serves only the listed files + the vendored three tree). Page errors are collected and printed; exit 1 on any.

  python _tools/art_b_interior.py --out DIR [--all] [--rooms] [--root GAMEDIR] [--manifest-dir DIR]
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
ORIGIN = "http://lcint.test"

PAGE = """<!doctype html><meta charset=utf-8><title>art_b_interior</title>
<script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script>
<body style="margin:0;background:#202830"><canvas id=c></canvas>
<script type=module>
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
window.__ready = false;
window.__run = async (cfg) => {
  const {tiles, cols, tw, th, bg} = cfg;
  const rows = Math.ceil(tiles.length / cols);
  const cv = document.getElementById('c');
  cv.width = cols * tw; cv.height = rows * th;
  const gl = new THREE.WebGLRenderer({canvas: cv, antialias: true, preserveDrawingBuffer: true});
  gl.setPixelRatio(1); gl.setSize(cv.width, cv.height, false); gl.setScissorTest(true);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.shadowMap.enabled = true;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const glbCache = new Map(), texCache = new Map(), texLoader = new THREE.TextureLoader();
  const getTex = async (url) => { if (!texCache.has(url)) { const t = await texLoader.loadAsync(url); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter; texCache.set(url, t); } return texCache.get(url); };
  const getGlb = async (url) => { if (!glbCache.has(url)) glbCache.set(url, await loader.loadAsync(url)); return glbCache.get(url); };
  const out = [];
  gl.setClearColor(new THREE.Color(bg), 1);
  gl.setScissor(0, 0, cv.width, cv.height); gl.setViewport(0, 0, cv.width, cv.height); gl.clear();
  for (let i = 0; i < tiles.length; i++) {
    const T = tiles[i], r = {id: T.id, ok: false, tris: 0, meshes: 0};
    out.push(r);
    try {
      const scene = new THREE.Scene();
      const all = new THREE.Group(); scene.add(all);
      for (const it of T.items) {
        const g = await getGlb(it.glb);
        const root = g.scene.clone(true);
        const tex = it.palette ? await getTex(it.palette) : null;
        root.traverse((o) => {
          if (!o.isMesh) return;
          r.meshes++;
          const geo = o.geometry; r.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const conv = (m) => new THREE.MeshLambertMaterial(tex ? {map: tex, side: THREE.DoubleSide} : {color: m.color, side: m.side});
          o.material = Array.isArray(o.material) ? mats.map(conv) : conv(o.material);
          o.castShadow = true; o.receiveShadow = true;
        });
        root.scale.multiplyScalar(it.scale);
        const holder = new THREE.Group(); holder.add(root);
        holder.rotation.y = (it.q || 0) * Math.PI / 2; holder.position.set(it.x || 0, it.y || 0, it.z || 0);
        all.add(holder);
        if (T.colliders && it.colliders) for (const b of it.colliders) {
          const w = b[3] - b[0], h = b[4] - b[1], d = b[5] - b[2];
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({color: 0xff2040}));
          e.position.set(b[0] + w / 2, b[1] + h / 2, b[2] + d / 2);
          const eh = new THREE.Group(); eh.add(e); eh.rotation.y = (it.q || 0) * Math.PI / 2; eh.position.set(it.x || 0, it.y || 0, it.z || 0); scene.add(eh);
        }
      }
      all.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(all);
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      r.ok = r.tris > 0; r.size = sz.toArray(); r.bbox = [bb.min.toArray(), bb.max.toArray()];
      scene.add(new THREE.HemisphereLight(0xdde8ff, 0x6b6050, 1.5));
      const dl = new THREE.DirectionalLight(0xfff2dd, 2.4); dl.position.set(c.x - 6, 12, c.z + 8); dl.target.position.copy(c); scene.add(dl); scene.add(dl.target);
      dl.castShadow = true; const sc = Math.max(sz.x, sz.z, 4); Object.assign(dl.shadow.camera, {left: -sc, right: sc, top: sc, bottom: -sc, near: 0.5, far: 60}); dl.shadow.mapSize.set(1024, 1024);
      if (!T.room) {
        const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.3, 4, 8), new THREE.MeshLambertMaterial({color: 0xff8a1f}));
        person.position.set(bb.max.x + 0.6, 0.9, bb.min.z - 0.3); scene.add(person);
        const span = Math.max(sz.x, sz.z, 4) * 1.8;
        const grid = new THREE.GridHelper(Math.ceil(span / 2) * 2, Math.ceil(span / 2) * 2, 0x6a7a8a, 0x44505c); grid.position.set(c.x, 0.0, c.z); scene.add(grid);
        const ar = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.03, 0), Math.max(0.6, sz.z * 0.5 + 0.5), 0x30ff60, 0.22, 0.14); scene.add(ar);
      } else {
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({color: 0x6f8a52})); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.002; ground.receiveShadow = true; scene.add(ground);
      }
      const cam = new THREE.PerspectiveCamera(T.fov || 30, tw / th, 0.05, 2000);
      if (T.cam) { cam.position.fromArray(T.cam.pos); cam.lookAt(new THREE.Vector3().fromArray(T.cam.at)); }
      else {
        const rad = Math.max(0.5 * Math.hypot(sz.x, sz.y, sz.z), 1.0);
        const dir = new THREE.Vector3(Math.sin(0.65) * Math.cos(0.5), Math.sin(0.5), Math.cos(0.65) * Math.cos(0.5));
        cam.position.copy(c).addScaledVector(dir, rad / Math.tan(THREE.MathUtils.degToRad(15)) * 0.9 + rad * 0.3); cam.lookAt(c);
      }
      cam.updateMatrixWorld(true);
      const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
      gl.setViewport(x, cv.height - y - th, tw, th); gl.setScissor(x, cv.height - y - th, tw, th);
      gl.render(scene, cam);
    } catch (e) { r.error = String(e && e.message || e).slice(0, 300); }
  }
  return {results: out, png: cv.toDataURL('image/png')};
};
window.__ready = true;
</script>
"""


def render(tiles, out_png, cols, tw, th, labels=True):
    from playwright.sync_api import sync_playwright
    vendor = GAME / "assets" / "vendor" / "three"
    files = {}

    def reg(p):
        p = Path(p).resolve()
        k = "/f/%d/%s" % (len(files), p.name)
        for kk, vv in files.items():
            if vv == p:
                return kk
        files[k] = p
        return k

    cfg = []
    for t in tiles:
        cfg.append(dict(t, items=[dict(it, glb=reg(it["glb"]), palette=reg(it["palette"]) if it.get("palette") else None) for it in t["items"]]))

    def handler(route):
        from urllib.parse import unquote, urlparse
        path = unquote(urlparse(route.request.url).path)
        if path in ("/", "/index.html"):
            return route.fulfill(status=200, body=PAGE, headers={"Content-Type": "text/html; charset=utf-8"})
        if path.startswith("/vendor/"):
            f = (vendor / path[len("/vendor/"):]).resolve()
            if str(f).startswith(str(vendor.resolve())) and f.is_file():
                return route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": "text/javascript; charset=utf-8" if f.suffix == ".js" else "application/octet-stream"})
            return route.fulfill(status=404, body="nf")
        f = files.get(path)
        if f and f.is_file():
            return route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": {".png": "image/png", ".glb": "model/gltf-binary"}.get(f.suffix.lower(), "application/octet-stream")})
        return route.fulfill(status=404, body="nf")

    errs = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"])
        try:
            ctx = br.new_context(viewport={"width": 800, "height": 600})
            ctx.route(ORIGIN + "/**", handler)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:300]))
            page.on("console", lambda m: errs.append("console.error: " + m.text[:300]) if m.type == "error" else None)
            page.goto(ORIGIN + "/", wait_until="load")
            page.wait_for_function("window.__ready === true", timeout=90000)
            res = page.evaluate("(cfg) => window.__run(cfg)", {"tiles": cfg, "cols": cols, "tw": tw, "th": th, "bg": 0x2a3440})
        finally:
            br.close()
    im = Image.open(io.BytesIO(base64.b64decode(res["png"].split(",", 1)[1]))).convert("RGB")
    if labels:
        d = ImageDraw.Draw(im)
        for i, t in enumerate(tiles):
            x, y = (i % cols) * tw, (i // cols) * th
            r = res["results"][i]
            d.text((x + 4, y + 3), t.get("label", t["id"]), fill=(255, 235, 90))
            sub = ("ERR " + r.get("error", "?")[:50]) if not r.get("ok") else ("%d tris  %.2fx%.2fx%.2f m  %s" % (r["tris"], *r["size"], t.get("sub", "")))
            d.text((x + 4, y + th - 13), sub, fill=(200, 220, 255))
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    im.save(out_png)
    return res["results"], errs


def piece_tiles(rows, city_dir):
    tiles = []
    pal_dir = city_dir
    for tid, t in rows.items():
        boxes = [c["min"] + c["max"] for c in t["colliders"]]
        pal = None
        if t.get("palette"):
            pal = city_dir / "palettes" / ("quaternius_atlas.png" if t["palette"] == "quaternius_atlas" else t["palette"] + ".png")
        tiles.append(dict(id=tid, label=tid.split("/", 1)[1], sub="%s %d box%s" % (t["collider_mode"], len(boxes), "" if len(boxes) == 1 else "es"), colliders=True,
                          items=[dict(glb=str(city_dir / t["file"]), palette=str(pal) if pal else None, scale=t["suggested_scale"], colliders=boxes)]))
    return tiles


def room_tiles(T, city_dir):
    """A few furnished rooms laid out on the 2.2 m wall grid, to judge the kit as a player (third-person camera ~ 1.6 m behind / above the shoulder)."""
    def it(tid, x, z, q=0, y=0.0):
        t = T[tid]
        return dict(glb=str(city_dir / t["file"]), scale=t["suggested_scale"], x=x, y=y, z=z, q=q, colliders=[c["min"] + c["max"] for c in t["colliders"]],
                    palette=str(city_dir / "palettes" / "quaternius_atlas.png") if t.get("palette") == "quaternius_atlas" else None)
    W = 2.2

    def shell(nx, nz, door=None, window=None):
        """floor slabs nx x nz modules from (0, 0) to (nx W, -nz W), walls on the back (z = -nz W) and left (x = 0) sides (the camera looks in from the open front / right)."""
        out = []
        for i in range(nx):
            for k in range(nz):
                out.append(it("walls/floorFull", i * W, -k * W))
        for i in range(nx):                                   # back wall, along +x at z = -nz W, facing +z
            name = "walls/wallWindowPort" if window == ("back", i) else "walls/wallDoorwayWide" if door == ("back", i) else "walls/wall"
            out.append(it(name, i * W, -nz * W + 0.11, 0, 0.11))
        for k in range(nz):                                   # left wall, along -z at x = 0, facing +x (q = 1: x' = z, z' = -x)
            name = "walls/wallWindowPort" if window == ("left", k) else "walls/wall"
            out.append(it(name, 0.0, -k * W, 1, 0.11))
        return out
    rooms = []
    # bedroom: double bed against the back wall, nightstands, wardrobe, dresser, rug, floor lamp, window in the left wall
    b = shell(2, 2, window=("left", 1))
    b += [it("furniture/rugRectangle", 2.3, -2.3, 0, 0.11), it("furniture/bedDouble", 2.2, -3.0, 0, 0.11), it("furniture/cabinetBedDrawer", 0.8, -4.0, 0, 0.11),
          it("furniture/cabinetBed", 3.6, -4.0, 0, 0.11), it("furniture/lampSquareTable", 3.6, -4.0, 0, 0.11 + T["furniture/cabinetBed"]["bbox_m"]["y"]),
          it("furniture/bookcaseClosedDoors", 0.45, -1.2, 1, 0.11), it("furniture/sideTableDrawers", 0.4, -2.6, 1, 0.11), it("furniture/lampRoundFloor", 4.0, -0.5, 0, 0.11)]
    rooms.append(dict(id="room/bedroom", label="bedroom (3rd-person view)", room=True, items=b, cam={"pos": [6.6, 2.7, 2.6], "at": [1.9, 0.9, -2.4]}, fov=52))
    # kitchen + dining: counter run on the back wall, upper cabinets, fridge, dining set
    k = shell(2, 2, window=("back", 1))
    cy = 0.11
    k += [it("furniture/kitchenCabinet", 0.6, -3.9, 0, cy), it("furniture/kitchenStoveElectric", 1.55, -3.9, 0, cy), it("furniture/kitchenCabinetDrawer", 2.5, -3.9, 0, cy),
          it("furniture/kitchenSink", 3.6, -3.9, 0, cy), it("furniture/kitchenFridge", 0.5, -2.6, 1, cy), it("furniture/kitchenCabinetUpper", 1.55, -4.1, 0, cy + 1.55),
          it("furniture/hoodModern", 1.55, -4.06, 0, cy + 1.6), it("furniture/kitchenMicrowave", 0.6, -3.9, 0, cy + 0.99),
          it("furniture/tableCross", 2.7, -1.6, 0, cy), it("furniture/chairCushion", 2.2, -0.9, 2, cy), it("furniture/chairCushion", 3.2, -0.9, 2, cy),
          it("furniture/chairModernCushion", 2.2, -2.3, 0, cy), it("furniture/chairModernCushion", 3.2, -2.3, 0, cy)]
    rooms.append(dict(id="room/kitchen", label="kitchen + dining", room=True, items=k, cam={"pos": [6.4, 2.6, 2.4], "at": [1.9, 0.9, -2.4]}, fov=52))
    # living room: corner sofa, coffee table, tv on a cabinet, bookcase, rug, plants
    l = shell(2, 2, window=("left", 0))
    l += [it("furniture/rugRound", 2.3, -2.2, 0, cy), it("furniture/loungeSofaCorner", 1.3, -3.1, 0, cy), it("furniture/tableCoffeeSquare", 2.3, -2.1, 0, cy),
          it("furniture/cabinetTelevision", 3.3, -0.6, 2, cy), it("furniture/televisionModern", 3.3, -0.6, 2, cy + 0.68), it("furniture/bookcaseOpen", 3.8, -4.0, 0, cy),
          it("furniture/books", 3.8, -4.0, 0, cy + 0.9), it("furniture/plantSmall1", 2.3, -2.1, 0, cy + 0.5), it("furniture/loungeChair", 0.7, -1.0, 1, cy), it("furniture/lampSquareFloor", 0.4, -4.0, 0, cy)]
    rooms.append(dict(id="room/living", label="living room", room=True, items=l, cam={"pos": [6.6, 2.7, 2.6], "at": [1.9, 0.8, -2.4]}, fov=52))
    # bathroom + shop + office strip
    s = shell(3, 2, door=("back", 2))
    s += [it("furniture/kitchenBar", 0.9, -1.0, 0, cy), it("furniture/kitchenBar", 1.85, -1.0, 0, cy), it("furniture/kitchenBarEnd", 2.45, -1.0, 0, cy),
          it("furniture/computerScreen", 1.85, -1.1, 2, cy + 0.92), it("furniture/shelfTall", 1.0, -3.9, 0, cy), it("furniture/shelfTall", 2.5, -3.9, 0, cy),
          it("furniture/shelfLarge", 0.3, -2.4, 1, cy), it("furniture/cardboardBoxOpen", 3.9, -3.6, 0, cy), it("furniture/cardboardBoxClosed", 4.5, -3.8, 0, cy),
          it("furniture/pallet", 4.3, -2.4, 0, cy), it("furniture/cardboardBoxClosed", 4.3, -2.4, 0, cy + 0.14), it("furniture/stoolBar", 1.4, -0.2, 0, cy)]
    rooms.append(dict(id="room/shop", label="shop: counter + cash desk, gondola shelves, storage", room=True, items=s, cam={"pos": [8.6, 2.8, 2.8], "at": [2.9, 0.8, -2.2]}, fov=55))
    bt = shell(2, 1, window=("back", 0))
    bt += [it("furniture/bathtub", 1.42, -1.55, 0, cy), it("furniture/toilet", 3.2, -1.65, 0, cy), it("furniture/bathroomSinkSquare", 3.9, -1.0, 3, cy),
           it("furniture/bathroomCabinet", 0.15, -1.4, 1, cy + 1.3), it("furniture/dryer", 0.55, -0.45, 1, cy)]
    rooms.append(dict(id="room/bathroom", label="bathroom", room=True, items=bt, cam={"pos": [5.6, 2.5, 2.0], "at": [2.0, 0.7, -1.2]}, fov=55))
    st = shell(2, 2)
    st += [it("walls/stairs", 0.25, -2.6, 0, cy), it("furniture/deskCorner", 3.2, -1.0, 2, cy), it("furniture/chairDesk", 3.1, -0.9, 2, cy), it("furniture/computerScreen", 3.6, -0.5, 2, cy + 0.85),
           it("furniture/bookcaseClosedWide", 3.4, -4.1, 0, cy), it("furniture/lampSquareCeiling", 2.6, -2.5, 0, cy + 2.837 - 0.506)]
    rooms.append(dict(id="room/office", label="office + stairs flight (11 treads, one storey)", room=True, items=st, cam={"pos": [6.8, 2.8, 2.8], "at": [2.0, 1.0, -2.4]}, fov=55))
    return rooms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--root", default=str(GAME), help="game dir whose assets/props/city is drawn (a scratch --out-root of art_b_city.py works too)")
    ap.add_argument("--all", action="store_true", help="also draw the 32 shipped furniture + wall pieces")
    ap.add_argument("--rooms", action="store_true")
    a = ap.parse_args()
    city = Path(a.root) / "assets" / "props" / "city"
    man = json.loads((city / "manifest.json").read_text(encoding="utf-8"))
    imp = city / "manifest_interior.json"
    imt = json.loads(imp.read_text(encoding="utf-8")) if imp.exists() else {"types": {}, "catalogue": {}}
    T = dict(man["types"])
    T.update(imt["types"])
    new = [k for k, v in imt.get("catalogue", {}).items() if v.get("new")]
    rows = {k: T[k] for k in new if k in T}
    if a.all:
        rows = dict({k: v for k, v in man["types"].items() if v["group"] in ("furniture", "walls")}, **rows)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bad = 0
    res, errs = render(piece_tiles(rows, city), out / "interior_kit_sheet.png", cols=8, tw=240, th=240)
    nok = sum(1 for r in res if r.get("ok"))
    print("pieces: %d drawn ok of %d, page errors %d" % (nok, len(res), len(errs)))
    for r in res:
        if not r.get("ok"):
            print("  FAIL", r["id"], r.get("error"))
    bad += (nok != len(res)) + len(errs)
    report = {"pieces": res, "page_errors": errs}
    if a.rooms:
        rr, e2 = render(room_tiles(T, city), out / "interior_rooms.png", cols=2, tw=800, th=500)
        print("rooms: %d drawn ok of %d, page errors %d" % (sum(1 for r in rr if r.get("ok")), len(rr), len(e2)))
        bad += sum(1 for r in rr if not r.get("ok")) + len(e2)
        report["rooms"] = rr
        report["room_page_errors"] = e2
    for e in errs:
        print("  ", e)
    (out / "interior_sheet.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
