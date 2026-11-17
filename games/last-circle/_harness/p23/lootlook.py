#!/usr/bin/env python
"""lootlook - Wave 10 round 3 lane R3B "ground-loot models" (gate lootlook). The combat audit's loot census (ashgrid seed 5, a standard
match: 943 pickups, 496 drawn as a primitive box / cylinder), turned into a bar row.

    python _harness/p23/lootlook.py --disk                       # the census + the grenade silhouettes + the look sheet
    python _harness/p23/lootlook.py --disk --plant box-ammo      # ammo drawn with the W9 box again           - MUST FAIL loot-shapes
    python _harness/p23/lootlook.py --disk --plant same-grenade  # the smoke drawn with the frag's model       - MUST FAIL loot-shapes

Rows (PLAN.md "Lane R3B" acceptance bar loot-shapes; the audit value in brackets):
  loot-shapes  every ground pickup of a standard match (ashgrid seed 5) is drawn by a model pool whose geometry is neither a box /
               cylinder primitive (BufferGeometry type BoxGeometry / CylinderGeometry) nor under 100 triangles: 0 primitive pickups
               [496 of 943]; AND the frag and smoke models' silhouettes differ: IoU of the filled side (X-Y) and front (Z-Y) projections at
               a common scale <= 0.7 on both views [the same teal cylinder: IoU 1]
plus: a view of each loot kind on its ring renders (< 30 % near-black pixels); the 7 loot kinds each drawn by ONE pool (<= 7 new batches), triangles per loot model 200-700; 0 new programs after the warm-up
(census through rendered frames); 0 page / console errors, 0 failed requests, 0 shader errors.
The look sheet (every loot kind on its rarity ring from 3 m, what the player sees) goes to --shots.
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402
import p23lib as L  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

RP = "runtime/3d/royale/"
PLANTS = {
    "box-ammo": [(RP + "loot.js", [('const k = d.kind === "ammo" ? "ammo:" + d.id : "c:" + d.id;', 'const k = d.kind === "ammo" ? "none" : "c:" + d.id;')])],
    "same-grenade": [(RP + "loot.js", [('"c:smoke": "smoke" };', '"c:smoke": "frag" };')])],
}
LOOT_KEYS = ["ammo:light", "ammo:medium", "ammo:heavy", "ammo:shells", "ammo:grenades", "c:frag", "c:smoke"]

CENSUS_JS = r"""() => { const W = window.__LC__.W; const its = W.debugItems(); const out = { n: its.length, prim: 0, pending: 0, byKind: {}, pools: {}, primEx: [] };
  for (const it of its) { const d = it.data; const k = d.kind === 'weapon' ? 'w:' + d.id : d.kind + ':' + d.id; const P = it.vp;
    const row = out.byKind[k] || (out.byKind[k] = { n: 0, prim: 0, pool: null, tris: 0, types: [] }); row.n++;
    if (!P || !P.parts) { out.pending++; row.pending = (row.pending || 0) + 1; continue; }
    let tris = 0; const types = []; for (const m of P.parts) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; types.push(g.type); }
    row.pool = P.key; row.tris = tris; row.types = types; out.pools[P.key] = { tris, types, parts: P.parts.length };
    const prim = types.some((t) => t === 'BoxGeometry' || t === 'CylinderGeometry') || tris < 100;
    if (prim) { out.prim++; row.prim++; if (out.primEx.length < 5) out.primEx.push([it.id, k, P.key, types, tris]); } }
  return out; }"""
# the frag / smoke models as drawn: their pools' baked geometry (positions + index) for the silhouettes
GEO_JS = r"""(keys) => { const W = window.__LC__.W; const its = W.debugItems(); const out = {};
  for (const it of its) { const P = it.vp; if (!P || !P.parts || out[P.key] || keys.indexOf(P.key) < 0) continue;
    const pos = [], idx = []; let off = 0;
    for (const m of P.parts) { const g = m.geometry, pa = g.attributes.position; for (let i = 0; i < pa.count; i++) pos.push(+pa.getX(i).toFixed(4), +pa.getY(i).toFixed(4), +pa.getZ(i).toFixed(4));
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < pa.count; i++) idx.push(i + off); off += pa.count; }
    out[P.key] = { pos, idx }; }
  return out; }"""
# what the player sees: a camera 3 m from one pickup of the kind (on its ring), rendered through the composer
# what the player sees: the player moved to 4 m of the OUTDOOR pickup of the kind nearest it (the model cull is around the player), a camera
# 2.3 m from it looking down at it on its rarity ring, rendered through the composer
GOTO_JS = r"""(key) => { const W = window.__LC__.W, p = W.player; const M = W.map, tmp = [];
  // an open spot: no collider (wall, prop, tree) within 5 m of the pickup, on the terrain
  const open = (x) => { if (!M.queryColliders) return true; const cs = M.queryColliders(x.pos.x, x.pos.z, 5, tmp); return !cs || cs.length === 0; };
  const its = W.debugItems().filter((x) => x.vp && x.vp.key === key && !x.house && !x.pile && Math.abs(x.pos.y - M.heightAt(x.pos.x, x.pos.z)) < 0.8 && open(x));
  if (!its.length) return null; its.sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z));
  const it = its[0]; const d = +Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z).toFixed(1);
  const x = it.pos.x + 4, z = it.pos.z; p.pos.set(x, M.heightAt(x, z) + 0.05, z); p.vel.set(0, 0, 0); p.obj.position.copy(p.pos); if (p._pp) p._pp.copy(p.pos);
  return { id: it.id, at: [it.pos.x, it.pos.y, it.pos.z], d }; }"""
SHOT_JS = r"""(id) => { const W = window.__LC__.W, k = W.kernel, cam = k.camera, r = k.renderer; const it = W.debugItems().find((x) => x.id === id);
  if (!it) return null; const p = it.pos; const op = cam.position.clone(), oq = cam.quaternion.clone(); const ov = W.player.obj.visible; W.player.obj.visible = false;
  cam.position.set(p.x - 1.6, p.y + 1.5, p.z + 1.6); cam.lookAt(p.x, p.y + 0.3, p.z); cam.updateMatrixWorld(true);
  if (k.composer) k.composer.render(1 / 60); else r.render(k.scene, cam); const png = r.domElement.toDataURL('image/png');
  W.player.obj.visible = ov; cam.position.copy(op); cam.quaternion.copy(oq); cam.updateMatrixWorld(true); return { png, at: [p.x, p.y, p.z], id: it.id }; }"""


def mask(pos, idx, ax, lo, span, n=160):
    """filled projection of a triangle mesh on the axes ax=(h, v), on a common grid (lo, span)"""
    P = np.asarray(pos, np.float32).reshape(-1, 3)
    im = Image.new("L", (n, n), 0)
    dr = ImageDraw.Draw(im)
    q = (P[:, ax] - lo[None, :]) / span * (n - 1)
    T = np.asarray(idx, np.int64).reshape(-1, 3)
    for t in T:
        dr.polygon([(float(q[i, 0]), float(n - 1 - q[i, 1])) for i in t], fill=255)
    return np.asarray(im) > 0


def iou(a, b):
    i = (a & b).sum()
    u = (a | b).sum()
    return float(i) / float(u) if u else 1.0


def silhouettes(G):
    if "c:frag" not in G or "c:smoke" not in G:
        return None
    A, B = G["c:frag"], G["c:smoke"]
    PA, PB = np.asarray(A["pos"]).reshape(-1, 3), np.asarray(B["pos"]).reshape(-1, 3)
    # each model centred on its own bounding box (as both float on the same ring), one common scale
    PA = PA - (PA.min(0) + PA.max(0)) / 2
    PB = PB - (PB.min(0) + PB.max(0)) / 2
    out = {}
    for name, ax in (("side", [0, 1]), ("front", [2, 1])):
        ax = np.array(ax)
        lo = np.minimum(PA[:, ax].min(0), PB[:, ax].min(0))
        span = float((np.maximum(PA[:, ax].max(0), PB[:, ax].max(0)) - lo).max()) or 1.0
        ma = mask(PA.ravel(), A["idx"], ax, lo, span)
        mb = mask(PB.ravel(), B["idx"], ax, lo, span)
        out[name] = round(iou(ma, mb), 3)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--shots", default=None)
    args = L.parse(ap)
    tag = args.plant or ("rev-" + args.rev if getattr(args, "rev", None) else "disk")
    shots = args.shots or os.path.join(C.SHOTS, "lootlook_" + tag)
    os.makedirs(shots, exist_ok=True)

    def body(v):
        R = v.data["rows"] = {}
        with C.Session(args, "lootlook") as s:
            if args.plant:
                for rel, edits in PLANTS[args.plant]:
                    L.serve_patched(s, rel, edits)
            s.boot()
            L.dismiss_cards(s)
            R["start"] = s.start_match("standard", args.seed, args.map, enter=True, guard=True)
            R["land"] = s.land(120, protect=True)
            s.freeze_loop()
            s.install_pump()
            s.guard_player(True)
            s.step_frames(30, 1 / 60, render=True)
            p0 = L.programs(s)
            R["census"] = cen = s.js(CENSUS_JS)
            G = s.js(GEO_JS, ["c:frag", "c:smoke"])
            R["silhouetteIoU"] = sil = silhouettes(G)
            R["shots"] = {}
            for key in LOOT_KEYS:
                g_ = s.js(GOTO_JS, key)
                if not g_:
                    continue
                s.step_frames(20, 1 / 60, render=True)
                r_ = s.js(SHOT_JS, g_["id"])
                if r_:
                    raw = base64.b64decode(r_["png"].split(",", 1)[1])
                    with open(os.path.join(shots, key.replace(":", "_") + ".png"), "wb") as f:
                        f.write(raw)
                    im = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).astype(np.float32)
                    R["shots"][key] = {"at": r_["at"], "d": g_.get("d"), "mean": round(float(im.mean()), 1), "black": round(float((im.sum(2) < 12).mean()), 3)}
            s.step_frames(30, 1 / 60, render=True)
            p1 = L.programs(s)
            sh = R["shots"]
            v.check("look: a view of every loot kind on its ring renders (< 30 % near-black pixels: a NaN-lit model blacks out the post chain)",
                    len(sh) == len(LOOT_KEYS) and all(x["black"] < 0.3 for x in sh.values()), sh)
            v.check("programs: none linked by the census and the look renders (after the match warm-up)", p0 is not None and p1 is not None and p1 <= p0, [p0, p1], "no increase")
            L.errors_row(v, s)
            d = s.diagnostics()
            v.check("0 shader errors", not d["shader"], d["shader"][:4])
        pools = cen.get("pools", {})
        lp = {k: pools.get(k) for k in LOOT_KEYS}
        ok_sil = sil is not None and all(x <= 0.7 for x in sil.values())
        v.check("loot-shapes: 0 primitive box / cylinder pickups in the census; frag and smoke silhouettes IoU <= 0.7 (side and front)",
                cen.get("n", 0) >= 500 and cen.get("prim") == 0 and cen.get("pending") == 0 and ok_sil,
                {"pickups": cen.get("n"), "primitive": cen.get("prim"), "pending": cen.get("pending"), "examples": cen.get("primEx"), "silhouetteIoU": sil},
                "0 primitive; IoU <= 0.7")
        okp = all(x is not None and x["parts"] == 1 and 200 <= x["tris"] <= 700 for x in lp.values())
        v.check("loot models: each of the 7 kinds one pool of one part (one batch), 200-700 triangles", okp, lp)
        v.info("census by kind", cen.get("byKind"))
    return C.run_gate("lootlook", body, args)


if __name__ == "__main__":
    sys.exit(main())
