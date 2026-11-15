#!/usr/bin/env python3
"""art_b_render.py - real-browser contact sheets of GLBs for the ART-B intake (dev-only; _tools/ never ships).

A headless Chrome page (three r172 + GLTFLoader + MeshoptDecoder, all read from the game's own VENDORED copies under
assets/vendor/three/, so this also proves that the vendored meshopt decoder works) loads each item, assigns the palette
texture when the GLB carries none, and draws one tile per item into a single canvas: a 3/4 view, a ground grid, a
1.8 m orange stand-in "person" for scale, and optional red wire boxes for the baked colliders.

Used by art_b_city.py (decode + look gate) and by _harness/new/artb_decode.py.

  render_sheet(items, out_png, cols=6, tile=256, ...) -> list[dict]   per item: ok, tris, meshes, bbox, error
  item = {id, glb, palette(None|path), scale, label, colliders([[x0,y0,z0,x1,y1,z1],...] metres at that scale),
          flipY(False)}

The page never touches the network: every URL is answered by a Playwright route that serves ONLY the files listed in
`items` + the vendored three tree (read-only).
"""
from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
VENDOR = GAME / "assets" / "vendor" / "three"
ORIGIN = "http://lcart.test"

PAGE = """<!doctype html><meta charset=utf-8><title>art_b_render</title>
<script type="importmap">{"imports":{"three":"/vendor/build/three.module.js","three/addons/":"/vendor/examples/jsm/"}}</script>
<body style="margin:0;background:#202830"><canvas id=c></canvas>
<script type=module>
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
window.__ready = false;
window.__run = async (cfg) => {
  const {items, cols, tile, bg, ground} = cfg;
  const rows = Math.ceil(items.length / cols);
  const cv = document.getElementById('c');
  cv.width = cols * tile; cv.height = rows * tile;
  const gl = new THREE.WebGLRenderer({canvas: cv, antialias: true, preserveDrawingBuffer: true});
  gl.setPixelRatio(1); gl.setSize(cv.width, cv.height, false);
  gl.setScissorTest(true);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const texCache = new Map();
  const texLoader = new THREE.TextureLoader();
  const getTex = async (url, flipY) => {
    const k = url + '|' + flipY;
    if (!texCache.has(k)) {
      const t = await texLoader.loadAsync(url);
      t.flipY = flipY; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      texCache.set(k, t);
    }
    return texCache.get(k);
  };
  const out = [];
  gl.setClearColor(new THREE.Color(bg), 1);
  gl.setScissor(0, 0, cv.width, cv.height); gl.setViewport(0, 0, cv.width, cv.height); gl.clear();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = {id: it.id, ok: false};
    out.push(r);
    try {
      const gltf = await loader.loadAsync(it.glb);
      const root = gltf.scene;
      let tris = 0, meshes = 0, hasMap = false;
      const tex = it.palette ? await getTex(it.palette, false) : null;
      root.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) hasMap = true; }
        if (tex && !hasMap) {
          o.material = new THREE.MeshLambertMaterial({map: tex, side: THREE.DoubleSide});
        } else if (!hasMap) {
          o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => { const n = new THREE.MeshLambertMaterial({color: m.color, side: THREE.DoubleSide}); return n; });
          if (o.material.length === 1) o.material = o.material[0];
        }
        o.userData.extType = Object.keys(g.attributes).map((k) => k + ':' + g.attributes[k].array.constructor.name + (g.attributes[k].normalized ? 'n' : '')).join(',');
      });
      r.attrs = (() => { let s = ''; root.traverse((o) => { if (o.isMesh && !s) s = o.userData.extType; }); return s; })();
      const sc = it.scale || 1;
      root.scale.multiplyScalar(sc);
      if (it.yaw) root.rotation.y = it.yaw;
      const scene = new THREE.Scene();
      scene.add(root);
      root.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(root);
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      r.ok = tris > 0; r.tris = tris; r.meshes = meshes; r.bbox = [bb.min.toArray(), bb.max.toArray()]; r.size = sz.toArray();
      scene.add(new THREE.HemisphereLight(0xdde8ff, 0x6b6050, 1.6));
      const dl = new THREE.DirectionalLight(0xfff2dd, 2.6); dl.position.set(-4, 8, 6); scene.add(dl);
      // stand-in person: 1.8 m
      const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.3, 4, 8), new THREE.MeshLambertMaterial({color: 0xff8a1f}));
      person.position.set(bb.max.x + 0.8, 0.9, bb.max.z + 0.2);
      scene.add(person);
      // ground grid, 1 m cells
      const span = Math.max(sz.x, sz.z, 8) * 1.6;
      const grid = new THREE.GridHelper(Math.ceil(span / 2) * 2, Math.ceil(span / 2) * 2, 0x6a7a8a, 0x44505c);
      grid.position.set(c.x, 0.0, c.z); scene.add(grid);
      if (it.colliders) {
        for (const b of it.colliders) {
          const w = b[3] - b[0], h = b[4] - b[1], d = b[5] - b[2];
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({color: 0xff2040}));
          e.position.set(b[0] + w / 2, b[1] + h / 2, b[2] + d / 2); scene.add(e);
        }
      }
      const rad = Math.max(0.5 * Math.hypot(sz.x, sz.y, sz.z), 1.2);
      const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
      const dir = new THREE.Vector3(Math.sin(it.az ?? 0.7) * Math.cos(0.5), Math.sin(0.5), Math.cos(it.az ?? 0.7) * Math.cos(0.5));
      cam.position.copy(c).addScaledVector(dir, rad / Math.tan(THREE.MathUtils.degToRad(14)) * 0.95 + rad * 0.3);
      cam.lookAt(c); cam.updateMatrixWorld(true);
      const x = (i % cols) * tile, y = Math.floor(i / cols) * tile;
      gl.setViewport(x, cv.height - y - tile, tile, tile);
      gl.setScissor(x, cv.height - y - tile, tile, tile);
      gl.render(scene, cam);
      scene.remove(root);
    } catch (e) {
      r.error = String(e && e.message || e).slice(0, 300);
    }
  }
  return {results: out, png: cv.toDataURL('image/png')};
};
window.__ready = true;
</script>
"""


def render_sheet(items: list[dict], out_png: str | Path, cols: int = 6, tile: int = 256, label: bool = True,
                 bg: int = 0x2a3440, boot_timeout_s: float = 90.0) -> list[dict]:
    from playwright.sync_api import sync_playwright

    files: dict[str, Path] = {}

    def reg(p: str | Path) -> str:
        p = Path(p).resolve()
        key = "/f/%d/%s" % (len(files), p.name)
        files[key] = p
        return key

    cfg_items = []
    for it in items:
        d = {"id": it["id"], "glb": reg(it["glb"]), "scale": it.get("scale", 1.0), "colliders": it.get("colliders"),
             "az": it.get("az"), "yaw": it.get("yaw")}
        if it.get("palette"):
            d["palette"] = reg(it["palette"])
        cfg_items.append(d)

    def handler(route):
        from urllib.parse import urlparse, unquote
        path = unquote(urlparse(route.request.url).path)
        if path == "/" or path == "/index.html":
            return route.fulfill(status=200, body=PAGE, headers={"Content-Type": "text/html; charset=utf-8"})
        if path.startswith("/vendor/"):
            rel = path[len("/vendor/"):]
            f = (VENDOR / rel).resolve()
            if str(f).startswith(str(VENDOR.resolve())) and f.is_file():
                ct = "text/javascript; charset=utf-8" if f.suffix == ".js" else "application/octet-stream"
                return route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": ct})
            return route.fulfill(status=404, body="nf")
        f = files.get(path)
        if f and f.is_file():
            ct = {".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary"}.get(f.suffix.lower(), "application/octet-stream")
            return route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": ct})
        return route.fulfill(status=404, body="nf")

    flags = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"]
    res: list[dict] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=flags)
        try:
            ctx = br.new_context(viewport={"width": 800, "height": 600})
            ctx.route(ORIGIN + "/**", handler)
            page = ctx.new_page()
            errs: list[str] = []
            page.on("pageerror", lambda e: errs.append(str(e)[:300]))
            page.on("console", lambda m: errs.append(m.text[:300]) if m.type == "error" else None)
            page.goto(ORIGIN + "/", wait_until="load")
            page.wait_for_function("window.__ready === true", timeout=int(boot_timeout_s * 1000))
            out = page.evaluate("(cfg) => window.__run(cfg)", {"items": cfg_items, "cols": cols, "tile": tile, "bg": bg, "ground": True})
            res = out["results"]
            png = base64.b64decode(out["png"].split(",", 1)[1])
            im = Image.open(io.BytesIO(png)).convert("RGB")
            if label:
                d = ImageDraw.Draw(im)
                for i, it in enumerate(items):
                    x, y = (i % cols) * tile, (i // cols) * tile
                    d.text((x + 4, y + 3), str(it.get("label", it["id"])), fill=(255, 235, 90))
                    r = res[i] if i < len(res) else {}
                    sub = ("ERR " + r.get("error", "?")[:40]) if not r.get("ok") else "%d tris  %.1fx%.1fx%.1f m" % (r["tris"], *r["size"])
                    d.text((x + 4, y + tile - 12), sub, fill=(200, 220, 255))
            Path(out_png).parent.mkdir(parents=True, exist_ok=True)
            im.save(out_png)
            if errs:
                for r in res:
                    r.setdefault("page_errors", errs[:5])
        finally:
            br.close()
    return res


if __name__ == "__main__":
    items = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    r = render_sheet(items, sys.argv[2])
    print(json.dumps(r, indent=1)[:2000])
