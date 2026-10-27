#!/usr/bin/env python
"""shotsheet - a CAMERA-PINNED screenshot sheet per map (Wave 7b stage B, lane S3; promoted from the stage-A lanes' scratch shots.py / shots_tp.py).

    python _harness/shotsheet.py --disk                                   # 3 maps x seed 7, the default views, one sheet per map
    python _harness/shotsheet.py --disk --maps isla_viva --seeds 1,31337,4242
    python _harness/shotsheet.py --rev 6191b380 --maps deepwood --label live   # the live build (layout views fall back to the POI)
    python _harness/shotsheet.py --disk --views drop,street --cam "gate=-40,30,500,-60,0,350,62"
    python _harness/shotsheet.py --disk --maps deepwood --seeds 4242 --plant far-player   # negative control: must FAIL district-visible

What it is for: LOOKING at the towns as a player would (the plan's rule: every wave looks at its screenshots), with the same cameras on every run so a
before / after pair lines up. Views (each a fixed camera computed from the map / layout of the match):
  drop      330 m up over the drop town, looking down at it (the jump view)
  street    eye height (1.62 m) on the longest street of the street town (POI fallback on a build without a layout)
  centre    17 m up, 46 m out from the street town's centre
  compound  11 m up over the compound nearest the drop town
  endgame   8 m up on the rim of storm circle 6 (the same rule as perf_district), looking at its centre
  minimap   the map's minimap canvas
  per map extras: Isla Viva crater (the crater-rim village from 40 m up) + docks; Deepwood mill + bridge (oblique, 12 m up); Savanna none
WHY PINNED: maps.js installCityCull hides every town district more than 1100 m from W.camera (re-evaluated every 0.5 s), and player.js updateCamera puts the camera back
behind the PLAYER on every stepped frame. The stage-A scratch tool set the camera once and stepped frames, so a view more than 1100 m from where the player landed showed
EMPTY LOTS (lamps, cars, lot ground, no buildings: Deepwood seed 4242 Lakeside, the Wave-7b check). Here, for every view: the camera and W._camFocus are pinned to the view
while the frames are stepped (perf_district's VIEWSPEC-3 pin), the player is teleported to the ground under the camera (so nothing that follows the player - loot cull, near
ring, sounds - sits elsewhere), and the player's own model is hidden in the draw (it stood in front of the camera in the stage-A teleported shots).

Rows (exit 0 pass / 1 fail / 2 could-not-judge):
  views-rendered    every requested view produced a non-blank frame (pixel stddev >= 3 on a 64 x 36 thumbnail; a black / single-colour canvas is a failure to draw)
  district-visible  at every draw, 0 town-district meshes within 1100 m of the DRAW camera are hidden (the cull saw this view, not the player's landing spot).
                    --plant far-player (no pin, no teleport, the player parked in the map corner farthest from the views) MUST fail this row
  errors            0 page errors and 0 failed requests
Information: calls / triangles / programs per view, the camera of each view, the sheet path. The JPG sheet (one row per seed, one column per view) and the PNGs go to
_harness/_shots/shotsheet_<label>_<stamp>/. LOOK at the sheet: the rows only prove the pictures show what the game would show there.
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "shotsheet"
CULL_R = 1100.0                    # maps.js installCityCull: m.visible = d < 1100 (from W.camera.position, bounding sphere surface)
BLANK_STD = 3.0
DEF_DROP = {"ashgrid": "downtown", "isla_viva": "coco_village", "deepwood": "logging"}
DEF_STREET = {"ashgrid": "outpost", "isla_viva": "coco_village", "deepwood": "lakeside"}
BASE_VIEWS = ["drop", "street", "centre", "compound", "endgame"]
EXTRA_VIEWS = {"isla_viva": ["crater", "docks"], "deepwood": ["mill", "bridge"], "ashgrid": []}
PLANTS = {"far-player": {"district-visible"}}

# one call = one view: compute the camera, PIN camera + focus to it, teleport the player under it (unless the plant says otherwise)
SPEC_JS = r"""([kind, opt]) => { const W = window.__LC__.W, M = W.map;
  const H = (x, z) => M.heightAt(x, z);
  const poi = (id) => M.pois.find((p) => p.id === id);
  const lay = M.city && M.city.layout;
  const town = (id) => lay ? ((lay.towns || []).find((t) => t.id === id) || (lay.compounds || []).find((t) => t.id === id)) : null;
  const centreOf = (id) => { const T = town(id); if (T && T.centre) return { x: T.centre[0], z: T.centre[1] }; const p = poi(id); return p ? { x: p.x, z: p.z } : { x: 0, z: 0 }; };
  const up = (x, z, d) => H(x, z) + d;
  let spec = null;
  if (kind === 'drop') { const p = poi(opt.dropAt); spec = [p.x - 170, 330, p.z + 260, p.x, 0, p.z, 60]; }
  else if (kind === 'street') {
    const T = town(opt.streetAt), p = poi(opt.streetAt);
    let x0 = p.x - p.r * 0.55, z = p.z + 1, x1 = x0 + 60, z1 = z;
    if (T && T.roads && T.roads.streets && T.roads.streets.length) {
      const s = T.roads.streets.slice().sort((a, b) => b.len - a.len)[0];
      if (s.axis === 'x') { x0 = s.x0 + 12; z = s.z0 + 2.2; x1 = x0 + 60; z1 = z; } else { x0 = s.x0 + 2.2; z = s.z0 + 12; x1 = x0; z1 = z + 60; }
    }
    spec = [x0, up(x0, z, 1.62), z, x1, up(x1, z1, 1.8), z1, 70];
  }
  else if (kind === 'centre') { const c = centreOf(opt.streetAt); spec = [c.x - 46, up(c.x - 46, c.z + 44, 17), c.z + 44, c.x, up(c.x, c.z, 2), c.z, 62]; }
  else if (kind === 'compound') {
    const list = lay ? (lay.compounds || []) : [];
    const p0 = poi(opt.dropAt); let best = null, bd = 1e9;
    for (const Q of list) { const c = Q.centre || [Q.poi.x, Q.poi.z]; const d = Math.hypot(c[0] - p0.x, c[1] - p0.z); if (d < bd) { bd = d; best = Q; } }
    const c = best && best.centre ? { x: best.centre[0], z: best.centre[1] } : { x: p0.x + 50, z: p0.z + 50 };
    spec = [c.x - 34, up(c.x - 34, c.z + 30, 11), c.z + 30, c.x, up(c.x, c.z, 1.5), c.z, 62];
  }
  else if (kind === 'endgame') {
    // P2-F (parity P2+P3): the game's own storm plan = its seed, its PACE (C-MODE W.match.pace) and OD-1's land predicate (storm.js W.stormLandAt; the same
    // rule when a build has none: terrain > waterY + 0.5 m). A Storm without landAt builds other circles than the match's on the OD-1 build
    const S = new W.SIM.Storm({ seed: W.seed, mode: (W.match && W.match.pace) || W.mode || 'standard', half: M.half, landAt: (W.stormLandAt || ((g, wy) => g ? (x, z) => g(x, z) > wy + 0.5 : undefined)(M.groundAt || M.heightAt, typeof M.waterY === 'number' ? M.waterY : 0)) }); const c = S.circles[S.circles.length - 3];
    const px = c.x - 55, pz = c.z + 50; let py = H(px, pz) + 8;
    for (let i = 0; i < 8; i++) { let inside = false;
      for (const q of M.queryColliders(px, pz, 0.5, [])) if (px > q.minX && px < q.maxX && pz > q.minZ && pz < q.maxZ && py > q.minY && py < q.maxY) { inside = true; break; }
      if (!inside) break; py += 4; }
    spec = [px, py, pz, c.x, H(c.x, c.z) + 1.5, c.z, 70]; }
  else if (kind === 'crater') { const p = poi('volcano_rim'); if (p) spec = [p.x - 70, up(p.x - 70, p.z + 96, 40), p.z + 96, p.x, up(p.x, p.z, -8), p.z, 66]; }
  else if (kind === 'docks') { const p = poi('lagoon_docks'); if (p) spec = [p.x - 36, 14, p.z + 54, p.x, 1, p.z, 62]; }
  else if (kind === 'mill') { const p = poi('mill'); if (p) spec = [p.x - 64, up(p.x - 64, p.z + 70, 20), p.z + 70, p.x, up(p.x, p.z, 0), p.z, 64]; }
  else if (kind === 'bridge') {
    const T = lay && (lay.towns || []).find((t) => t.id === 'mill'); const B = T && T.mill && T.mill.deckBuilt;
    if (B) { const r = B.rect, ns = B.axis === 0, cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
      const sx = ns ? cx - 26 : cx, sz = ns ? cz : cz + 26; spec = [sx, up(sx, sz, 12), sz, cx, B.top, cz, 62]; } }
  else if (kind.startsWith('cam:')) { spec = kind.slice(4).split(',').map(Number); }
  if (!spec) return null;
  const cam = W.camera, p = W.player;
  if (opt.plant === 'far-player') {
    // the stage-A defect, made certain: nothing pinned, the player parked in the map corner farthest from this view (the camera returns behind the player on every stepped frame)
    if (p) { const hx = M.half * 0.9, fx = spec[0] > 0 ? -hx : hx, fz = spec[2] > 0 ? -hx : hx; p.pos.set(fx, H(fx, fz) + 0.2, fz); if (p.vel) p.vel.set(0, 0, 0); p.gliding = false; p.chute = null; p.onGround = true; }
    if (cam) cam.position.set(spec[0], spec[1], spec[2]);
    return spec;
  }
  if (cam) { cam.position.set(spec[0], spec[1], spec[2]); for (const m of ['set', 'copy', 'lerp', 'add', 'sub']) cam.position[m] = function () { return this; }; }
  const pin = Object.create(p || {}); pin.pos = { x: spec[0], y: spec[1], z: spec[2] };
  Object.defineProperty(W, '_camFocus', { configurable: true, get: () => pin, set: () => {} });
  if (p) { p.pos.set(spec[0], H(spec[0], spec[2]) + 0.2, spec[2]); if (p.vel) p.vel.set(0, 0, 0); p.gliding = false; p.chute = null; p.onGround = true; }
  window.__SS_PIN__ = true;
  return spec; }"""

UNPIN_JS = r"""() => { const W = window.__LC__.W, cam = W.camera; if (!window.__SS_PIN__) return 0;
  if (cam) for (const m of ['set', 'copy', 'lerp', 'add', 'sub']) delete cam.position[m];
  delete W._camFocus; W._camFocus = W.player; window.__SS_PIN__ = false; return 1; }"""

# draw at the view: count the district meshes near the DRAW camera that the cull left hidden, hide the player's own model, render through the composer
VIEW_JS = r"""([spec, cullR]) => { const W = window.__LC__.W, k = W.kernel, cam = k.camera, r = k.renderer, sc = k.scene;
  const [px, py, pz, tx, ty, tz, fov] = spec;
  let near = 0, nearHidden = 0, total = 0; const hid = [];
  sc.traverse((o) => { if (!o.isMesh || !o.userData || !o.userData.district) return; total++;
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const bs = g.boundingSphere;
    const d = Math.hypot(bs.center.x - px, bs.center.y - py, bs.center.z - pz) - bs.radius;
    if (d < cullR - 1) { near++; if (!o.visible) { nearHidden++; if (hid.length < 4) hid.push([o.userData.district, Math.round(d)]); } } });
  const saved = []; const p = W.player;
  if (p) for (const key of ['obj', 'chute', 'nameTag', 'weaponMesh']) { const o = p[key]; if (o && typeof o.visible === 'boolean') { saved.push([o, o.visible]); o.visible = false; } }
  const of = cam.fov; cam.fov = fov; cam.updateProjectionMatrix();
  if (r.shadowMap && r.shadowMap.enabled) r.shadowMap.needsUpdate = true; r.info.reset();
  cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(true);
  if (k.composer) k.composer.render(1 / 60); else r.render(sc, cam);
  const out = { calls: r.info.render.calls, tris: r.info.render.triangles, programs: r.info.programs ? r.info.programs.length : -1,
    districts: total, near, nearHidden, hidden: hid, png: r.domElement.toDataURL('image/png') };
  for (const [o, v] of saved) o.visible = v;
  cam.fov = of; cam.updateProjectionMatrix(); return out; }"""

MINI_JS = r"""() => { const W = window.__LC__.W; const cv = W.map && W.map.minimap; return cv && cv.toDataURL ? cv.toDataURL('image/png') : null; }"""


def png_std(png_bytes):
    from PIL import Image, ImageStat
    im = Image.open(io.BytesIO(png_bytes)).convert("L").resize((64, 36))
    return ImageStat.Stat(im).stddev[0]


def make_sheet(paths_grid, labels_grid, out, tw=480, th=270):
    from PIL import Image, ImageDraw
    # wrap each seed's views into rows of 4 (a 1 x 8 strip is 3840 px wide and unreadable when viewed)
    pg, lg = [], []
    for prow, lrow in zip(paths_grid, labels_grid):
        for i in range(0, len(prow), 4):
            pg.append(prow[i:i + 4]); lg.append(lrow[i:i + 4])
    paths_grid, labels_grid = pg, lg
    rows = len(paths_grid)
    cols = max(len(r) for r in paths_grid) if rows else 0
    sheet = Image.new("RGB", (max(1, tw * cols), max(1, (th + 16) * rows)), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for ri, (prow, lrow) in enumerate(zip(paths_grid, labels_grid)):
        for ci, (p, lab) in enumerate(zip(prow, lrow)):
            if p and os.path.exists(p):
                im = Image.open(p).convert("RGB")
                im.thumbnail((tw, th))
                sheet.paste(im, (ci * tw + (tw - im.width) // 2, ri * (th + 16) + 16))
            dr.text((ci * tw + 4, ri * (th + 16) + 2), lab, fill=(255, 230, 0))
    sheet.save(out, quality=88)
    return out


def shoot(v, args, map_id, seed, views, outdir):
    res = {"map": map_id, "seed": seed, "views": {}}
    with C.Session(args, name="shotsheet_%s" % map_id, viewport={"width": args.width, "height": args.height}) as s:
        s.boot()
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        t0 = time.time()
        res["load"] = s.start_match(mode="standard", seed=seed, map_id=map_id)
        res["land"] = s.land(max_s=90, protect=True)
        s.guard_player(True)
        s.freeze_loop()
        print("  [%s s%d] loaded + landed in %.0f s (onGround %s)" % (map_id, seed, time.time() - t0, res["land"].get("onGround")), flush=True)
        opt = {"dropAt": DEF_DROP[map_id], "streetAt": DEF_STREET[map_id], "plant": args.plant}
        jobs = [(x, x) for x in views if x != "minimap"]
        for c in args.cam:
            nm, vals = c.split("=", 1)
            jobs.append((nm, "cam:" + vals))
        for name, kind in jobs:
            spec = s.js(SPEC_JS, [kind, opt])
            if not spec:
                res["views"][name] = {"missing": True}
                print("  %-9s (no such view on this build)" % name, flush=True)
                continue
            s.step_frames(args.step, dt=1.0 / 20, render=False)     # >= 0.5 s of sim: the city cull and the terrain LOD re-evaluate for the pinned camera
            s.js(UNPIN_JS)
            r = s.js(VIEW_JS, [spec, CULL_R])
            b = base64.b64decode(r.pop("png").split(",", 1)[1])
            path = os.path.join(outdir, "%s_s%d_%s.png" % (map_id, seed, name))
            with open(path, "wb") as fh:
                fh.write(b)
            r["std"] = round(png_std(b), 2)
            r["path"] = path
            r["camera"] = [round(x, 1) for x in spec]
            res["views"][name] = r
            print("  %-9s calls %4d tris %9d programs %s | districts %d, within %d m %d, hidden there %d %s | std %.1f -> %s" % (
                name, r["calls"], r["tris"], r["programs"], r["districts"], CULL_R, r["near"], r["nearHidden"], r["hidden"] or "", r["std"], os.path.basename(path)), flush=True)
        if "minimap" in views:
            png = s.js(MINI_JS)
            if png:
                b = base64.b64decode(png.split(",", 1)[1])
                path = os.path.join(outdir, "%s_s%d_minimap.png" % (map_id, seed))
                with open(path, "wb") as fh:
                    fh.write(b)
                res["views"]["minimap"] = {"path": path, "std": round(png_std(b), 2)}
            else:
                res["views"]["minimap"] = {"missing": True}
        res["pageErrors"] = [e[1][:200] for e in s.page_errors][:4]
        res["failedRequests"] = [str(x)[:200] for x in s.failed[:4]]
        res["nFailed"] = len(s.failed)
    return res


class PlantView:
    """--plant: only the planted fault's rows count (exit 1 = the fault was seen); the others are printed as information."""

    def __init__(self, v, rows):
        self._v, self._rows = v, rows

    def check(self, name, ok, detail="", expect=None):
        if name in self._rows:
            return self._v.check(name, ok, detail, expect)
        self._v.info(name + " (not counted in plant mode)", detail)
        return ok

    def cnj(self, name, why):
        return self.check(name, None, why)

    def __getattr__(self, k):
        return getattr(self._v, k)


def main_fn(v, args):
    if args.plant:
        if args.plant not in PLANTS:
            raise C.HarnessError("unknown --plant %r (known: %s)" % (args.plant, ", ".join(sorted(PLANTS))))
        v = PlantView(v, PLANTS[args.plant])
    maps = [m for m in args.maps.split(",") if m]
    seeds = [int(x) for x in args.seeds.split(",") if x]
    outdir = os.path.join(C.SHOTS, "shotsheet_%s_%s" % (args.label, C.stamp()))
    os.makedirs(outdir, exist_ok=True)
    v.data["dir"] = outdir
    v.data["plant"] = args.plant
    allres = []
    for m in maps:
        views = [x for x in (args.views.split(",") if args.views else BASE_VIEWS + EXTRA_VIEWS.get(m, []) + ["minimap"]) if x]
        grid, labels = [], []
        for seed in seeds:
            try:
                r = shoot(v, args, m, seed, views, outdir)
            except C.EnvFailure as e:
                v.cnj("%s s%d: environment" % (m, seed), str(e)[:300])
                continue
            except Exception as e:
                msg = str(e)
                v.cnj("%s s%d: harness exception" % (m, seed), (msg.splitlines()[0] if msg else type(e).__name__)[:300])
                continue
            allres.append(r)
            names = list(r["views"].keys())
            grid.append([r["views"][n].get("path") for n in names])
            labels.append(["%s s%d %s%s" % (m, seed, n, "" if "calls" not in r["views"][n] else " (%d calls)" % r["views"][n]["calls"]) for n in names])
        if grid:
            sheet = make_sheet(grid, labels, os.path.join(outdir, "sheet_%s.jpg" % m))
            v.info("sheet %s" % m, sheet)
    v.data["runs"] = allres
    if not allres:
        v.cnj("measured", "no map x seed could be shot")
        return
    rendered = [(r["map"], r["seed"], n, x) for r in allres for n, x in r["views"].items()]
    bad = ["%s s%d %s: %s" % (m, sd, n, "no such view" if x.get("missing") else "blank (std %.1f)" % x["std"]) for m, sd, n, x in rendered if x.get("missing") or x.get("std", 0) < BLANK_STD]
    v.check("views-rendered", not bad, ("%d views rendered, none blank (std >= %.0f)" % (len(rendered), BLANK_STD)) if not bad else " | ".join(bad)[:600], "every view, non-blank")
    drawn = [(m, sd, n, x) for m, sd, n, x in rendered if "near" in x]
    near = sum(x["near"] for *_, x in drawn)
    hid = [(m, sd, n, x) for m, sd, n, x in drawn if x["nearHidden"]]
    if near:
        v.check("district-visible", not hid, ("0 of %d town-district meshes within %d m of the draw camera hidden, over %d views" % (near, CULL_R, len(drawn))) if not hid else
                " | ".join("%s s%d %s: %d of %d hidden %s" % (m, sd, n, x["nearHidden"], x["near"], x["hidden"]) for m, sd, n, x in hid)[:600], "0 hidden within 1100 m")
    else:
        v.cnj("district-visible", "no town-district mesh within %d m of any view (a build without towns?)" % CULL_R)
    errs = ["%s s%d: %s %s" % (r["map"], r["seed"], r["pageErrors"], r["failedRequests"]) for r in allres if r["pageErrors"] or r["nFailed"]]
    v.check("errors", not errs, "0 page errors, 0 failed requests over %d matches" % len(allres) if not errs else " | ".join(errs)[:600], "0")
    v.info("per view", " ;; ".join("%s s%d %s calls %s tris %s" % (m, sd, n, x.get("calls", "-"), x.get("tris", "-")) for m, sd, n, x in drawn))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=",".join(C.MAPS))
    ap.add_argument("--seeds", default="7")
    ap.add_argument("--views", default=None, help="comma list (default: drop,street,centre,compound,endgame + the map's extras + minimap)")
    ap.add_argument("--cam", action="append", default=[], help="name=px,py,pz,tx,ty,tz,fov (an extra pinned camera)")
    ap.add_argument("--step", type=int, default=26, help="frames stepped at 1/20 s per view before the draw (>= 10: the city cull re-evaluates every 0.5 s)")
    ap.add_argument("--label", default="tree")
    ap.add_argument("--plant", default=None, help="negative control: far-player (no pin, the player parked far away: district-visible MUST fail)")
    args = ap.parse_args()
    if args.step < 10:
        ap.error("--step must be >= 10 (the city cull runs every 0.5 s of sim)")
    if args.plant:
        print("%s: PLANT MODE %s - district-visible must FAIL" % (GATE, args.plant), flush=True)
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
