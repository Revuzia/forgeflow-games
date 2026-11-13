#!/usr/bin/env python3
"""art_b_interior_ingame.py - the Wave 8 interior kit drawn IN ENGINE (lane H2; dev-only, _tools/ never ships).

Boots the real game to the menu in one headless Chrome (the harness's --disk session: the game directory is served read-only through page routing), stops the
kernel loop, imports runtime/3d/royale/citykit.js exactly as maps.js will (createCityKit({ THREE, kernel, assetBase })), PLACES every interior type of the
manifest through kit.place() (GLBs through W.kernel.loadGLTF: the game's GLTFLoader + meshopt decoder; materials, palettes and colliders from citykit), and draws
each one with the GAME'S renderer from a 3/4 camera, colliders as red wireframes. The tiles are composed into one contact sheet; a 3rd-person shot of every
piece in rows is saved too. Every page / console error and failed request of the session is printed; exit 1 on any, or on a type that failed to load.

citykit.js only knows the types of manifest.json, so in stage A this runs against a STAGE-B MIRROR (art_b_city.py --interior-into-main + the regenerated
COLLIDER_BOXES; see the lane report), passed as --root. After stage B it runs against the game directory itself.

  python _tools/art_b_interior_ingame.py --root <game dir> --out DIR [--ids furniture/bedSingle,...]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

PAGE_JS = r"""async (cfg) => {
  const L = window.__LCKIT__; await L.load();
  const C = window.__LC__, W = C.W, THREE = W.THREE, R = W.kernel.renderer;
  const CK = await import(new URL("runtime/3d/royale/citykit.js", W.assetBase).href);
  const MAN = await (await fetch(new URL("assets/props/city/manifest.json", W.assetBase).href, { cache: "no-cache" })).json();
  const s = L.scene();
  const kit = CK.createCityKit({ THREE, kernel: W.kernel, assetBase: W.assetBase });
  const list = [], cells = [];
  let x = 0;
  for (const id of cfg.ids) {
    const b = MAN.types[id].bbox_m, w = Math.max(b.x, b.z, 1.0) + 3.0;
    const cx = x + w / 2, mn = MAN.types[id].bbox_min_m, mx = MAN.types[id].bbox_max_m;
    list.push({ type: id, x: cx, y: 0, z: 0, rot: 0, district: "sheet" });
    cells.push({ id, x: cx, size: [b.x, b.y, b.z], mn, mx, colliders: MAN.types[id].colliders });
    x += w;
  }
  const res = await kit.place(list, { parent: s.scene, lod: "detail", theme: "city" });
  const wire = new THREE.Group(); wire.name = "sheet-wire"; s.scene.add(wire);
  for (const c of res.colliders) {
    const g = new THREE.BoxGeometry(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xff2040 }));
    e.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2); wire.add(e);
  }
  const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.3, 4, 8), new THREE.MeshStandardMaterial({ color: 0xff8a1f }));
  s.scene.add(person);
  window.__H2__ = { kit, cells, person, wire, width: x };
  return { failed: res.failed, skipped: res.skipped, colliders: res.colliders.length, meshes: res.meshes.length, width: x, stats: kit.stats().totals };
}"""

VIEW_JS = r"""(i) => {
  const L = window.__LCKIT__, H = window.__H2__, c = H.cells[i];
  const h = Math.max(c.size[1], 0.4), r = Math.max(0.5 * Math.hypot(c.size[0], c.size[1], c.size[2]), 0.8);
  H.person.position.set(c.x + c.mx[0] + 0.6, 0.9, c.mn[2] - 0.4); H.person.visible = true;
  const d = r / Math.tan(15 * Math.PI / 180) * 0.95 + r * 0.4, cx = c.x + (c.mn[0] + c.mx[0]) / 2, cz = (c.mn[2] + c.mx[2]) / 2;   // bbox centre (wall pieces keep a corner origin)
  L.render({ pos: [cx + d * 0.55, h * 0.5 + d * 0.48, cz + d * 0.70], look: [cx, h * 0.45, cz], fov: 30, far: 400 });
  return c.id;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="the game directory to boot (a stage-B mirror in stage A)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ids", default=None, help="comma list of type ids (default: every row of manifest_interior.json's catalogue marked new)")
    ap.add_argument("--tile", type=int, default=300)
    a = ap.parse_args()
    root = Path(a.root).resolve()
    sys.path.insert(0, str(root / "_harness"))
    import common as C                                      # noqa: E402  (the root's own harness: C.ROOT = root)
    import citykit_probe as CP                              # noqa: E402
    if Path(C.ROOT).resolve() != root:
        print("harness root mismatch", C.ROOT, root)
        return 2
    city = root / "assets" / "props" / "city"
    cat = json.loads((city / "manifest_interior.json").read_text(encoding="utf-8"))["catalogue"]
    man = json.loads((city / "manifest.json").read_text(encoding="utf-8"))
    ids = a.ids.split(",") if a.ids else [k for k, v in cat.items() if v.get("new")]
    missing = [i for i in ids if i not in man["types"]]
    if missing:
        print("not in this root's manifest.json (stage A: pass a stage-B mirror):", missing[:5])
        return 2
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    gp = C.add_common_args(argparse.ArgumentParser())
    gargs = gp.parse_args(["--disk", "--width", "1280", "--height", "720"])
    s = CP.session(gargs, name="h2_interior")
    tiles = []
    try:
        s.boot()
        CP.install(s, None)
        info = s.js(PAGE_JS, {"ids": ids})
        print("placed:", json.dumps(info)[:400])
        for i, tid in enumerate(ids):
            p = out / "tiles" / (tid.replace("/", "__") + ".png")
            s.canvas_png(str(p), "(%s)(%d)" % (VIEW_JS, i))
            tiles.append((tid, p))
        row = out / "interior_ingame_row.png"
        s.canvas_png(str(row), "window.__H2__.person.visible = false; window.__LCKIT__.render({ pos: [%f, 9, 26], look: [%f, 0.6, -2], fov: 50, far: 900 })" % (min(info["width"], 70) / 2, min(info["width"], 70) / 2))
        diag = s.diagnostics()
    finally:
        s.close()
    probs = C.diag_problems(diag, rig=False)
    tw = a.tile
    cols = 8
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * tw), (32, 40, 48))
    d = ImageDraw.Draw(sheet)
    T = man["types"]
    for k, (tid, p) in enumerate(tiles):
        im = Image.open(p).convert("RGB")
        w, h = im.size
        side = min(w, h)
        im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side)).resize((tw, tw), Image.LANCZOS)
        x, y = (k % cols) * tw, (k // cols) * tw
        sheet.paste(im, (x, y))
        t = T[tid]
        d.text((x + 4, y + 3), tid.split("/", 1)[1], fill=(255, 235, 90))
        d.text((x + 4, y + tw - 13), "%d tris %.2fx%.2fx%.2f m %s %d" % (t["tris"], t["bbox_m"]["x"], t["bbox_m"]["y"], t["bbox_m"]["z"], t["collider_mode"], len(t["colliders"])), fill=(220, 230, 255))
    sheet.save(out / "interior_ingame_sheet.png")
    rep = {"placed": info, "tiles": len(tiles), "problems": probs, "diag": diag}
    (out / "interior_ingame.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    print("tiles %d, failed types %s, problems %s" % (len(tiles), info.get("failed"), probs or "none (0 page / console / shader errors, 0 failed requests)"))
    return 1 if (probs or info.get("failed")) else 0


if __name__ == "__main__":
    sys.exit(main())
