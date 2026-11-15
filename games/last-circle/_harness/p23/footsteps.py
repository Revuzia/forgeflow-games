#!/usr/bin/env python
"""footsteps - the footstep surface census (P2-C LC-52 "surfaceAt from splat weights, not from neighbouring colliders"; plan gate "footstep census at
least 90% correct per zone"): the audit's probe3 census (F:/lc_p23/harness/src_probes/audit/probe3.py) promoted, with each zone's truth defined by
the map itself, never by surfaceAt.

    python _harness/p23/footsteps.py --disk
    python _harness/p23/footsteps.py --rev 9aa2b746             # control: the P2 base (Savanna all concrete, beaches grass, walls beside = wood) - MUST FAIL
    python _harness/p23/footsteps.py --disk --plant beside-wood # surfaceAt answers 'wood' within 0.6 m of any box collider - MUST FAIL (beside zone)
    python _harness/p23/footsteps.py --lanes maps               # validation: lane maps' work served over the base

Each map (STANDARD seed 7, the lobby only: no Enter, nothing runs) sampled on a 121 x 121 grid of dry land. Zones and their truth:
  open-grass [ashgrid]   x < -200, open ground (no collider within 3 m, not on a road / paved raster): 'grass'        (the drawn west grassland)
  open-sand [ashgrid]    x > 300, open ground: 'sand'                                                                  (the drawn east desert)
  beach [isla_viva]      dry ground <= waterY + 1.4 m, open: 'sand'
  inland [isla_viva]     ground waterY + 6 m .. 34 m, open: 'grass'       (above 34 m colorAt paints the volcano basalt: maps.js colorAt 'h > 34')
  volcano [isla_viva]    ground >= 36 m, open: 'stone'                     (the drawn basalt cone, 2 m clear of the 34 m colour edge)
  beside [every map]     0.35 m outside a face of a standing box collider (a wall, a rock, a car), on the ground: the SAME answer surfaceAt gives at
                         that very point with every collider within 1 m removed (dead for one call) - LC-52 "not from neighbouring colliders": a wall beside
                         you is not the floor under you. (The first version compared the point 3 m further out: that judged the PAINT - a yard's
                         laid dirt 3 m out vs the grass at the wall - not the collider leak; it failed 17-26 % on real paint edges. The 3 m pair
                         stays as an INFO row.)
  indoor [every map]     each Wave-8 house room (C-HOUSE records) at its floor y: 'wood' or 'concrete' (never grass / sand / snow)
Each row: >= 90 % of the zone's points correct, >= 30 points in the zone (fewer = could-not-judge).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {"beside-wood": "const sa = W.map.surfaceAt.bind(W.map); W.map.surfaceAt = function (x, z, y) { const near = W.map.queryColliders(x, z, 0.6, []).some((c) => c.kind === 'box' && !c.dead); return near ? 'wood' : sa(x, z, y); }"}
SHARE_MIN, N_MIN = 0.90, 30
EXPECT = {"ashgrid": ("open-grass", "open-sand", "beside", "indoor"), "isla_viva": ("beach", "inland", "volcano", "beside", "indoor"), "deepwood": ("beside", "indoor")}

CENSUS_JS = r"""() => { const W = window.__LC__.W, M = W.map; const N = 121, H = M.half * 0.97, wy = typeof M.waterY === 'number' ? M.waterY : -999;
  const open = (x, z, r) => !M.queryColliders(x, z, r, []).some((c) => !c.dead && c.maxY > M.heightAt(x, z) + 0.05);
  const Z = {}; const add = (k, ok, s) => { const e = Z[k] = Z[k] || { n: 0, ok: 0, got: {} }; e.n++; if (ok) e.ok++; e.got[s] = (e.got[s] || 0) + 1; };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = -H + 2 * H * i / (N - 1), z = -H + 2 * H * j / (N - 1), h = M.heightAt(x, z); if (h < wy + 0.3) continue;
    const paved = M.pavedAt ? !!M.pavedAt(x, z) : false;
    if (!open(x, z, 3) || paved) continue;
    const s = M.surfaceAt(x, z, h);
    if (M.id === 'ashgrid' && x < -200) add('open-grass', s === 'grass', s);
    if (M.id === 'ashgrid' && x > 300) add('open-sand', s === 'sand', s);
    if (M.id === 'isla_viva' && wy > -100 && h <= wy + 1.4) add('beach', s === 'sand', s);
    if (M.id === 'isla_viva' && wy > -100 && h >= wy + 6 && h <= 34) add('inland', s === 'grass', s);
    if (M.id === 'isla_viva' && h >= 36) add('volcano', s === 'stone', s);
  }
  // beside a standing box collider: 0.35 m off each face; truth = surfaceAt at the same point with every collider within 1 m dead for the call
  let k = 0;
  for (const c of M.colliders) { if (c.dead || c.kind !== 'box' || k > 1500) continue; const g = M.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
    if (c.minY > g + 0.3 || c.maxY < g + 0.8 || c.maxY > g + 12) continue; k++;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const faces = [[cx, c.maxZ + 0.35, 0, 3], [cx, c.minZ - 0.35, 0, -3], [c.maxX + 0.35, cz, 3, 0], [c.minX - 0.35, cz, -3, 0]];
    for (const [px, pz, ox, oz] of faces) {
      const h0 = M.heightAt(px, pz); if (h0 < wy + 0.3) continue;
      if (Math.abs(h0 - g) > 1.0) continue;                                                                        // on the ground beside it, not down a slope
      if (M.queryColliders(px, pz, 0.25, []).some((o) => !o.dead && px > o.minX && px < o.maxX && pz > o.minZ && pz < o.maxZ)) continue;   // the point itself is on something
      const a = M.surfaceAt(px, pz, h0);
      // the reference: EVERY collider within 1 m of the point dead for the call (a wall is several segment colliders; killing only this one
      // left its neighbours in reach and the beside-wood plant read wood|wood on 683 / 683 points - it did not bite)
      const nb = M.queryColliders(px, pz, 1.0, []).filter((o) => !o.dead); let ref;
      for (const o of nb) o.dead = true; try { ref = M.surfaceAt(px, pz, h0); } finally { for (const o of nb) o.dead = false; }
      add('beside', a === ref, a + '|' + ref);
      const h1 = M.heightAt(px + ox, pz + oz);
      if (Math.abs(h1 - h0) <= 0.4 && open(px + ox, pz + oz, 1.0)) { const b = M.surfaceAt(px + ox, pz + oz, h1); add('beside3m_info', a === b, a + '|' + b); }
    } }
  // indoor: every house room at its floor
  for (const Hs of (M.houses || [])) for (const r of (Hs.rooms || [])) { const x = r.cx != null ? r.cx : (r.x0 + r.x1) / 2, z = r.cz != null ? r.cz : (r.z0 + r.z1) / 2;
    if (x == null || z == null || r.y == null) continue; const s = M.surfaceAt(x, z, r.y + 0.05); add('indoor', s === 'wood' || s === 'concrete', s); }
  return { map: M.id, zones: Z }; }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--maps", default="ashgrid,isla_viva,deepwood")
    args = L.parse(ap)

    def body(v):
        with C.Session(args, "p23_footsteps") as s:
            s.boot()
            L.dismiss_cards(s)
            for mp in args.maps.split(","):
                L.start(s, "standard", 7, mp, guard=False, enter=False)
                if args.plant:
                    L.plant_js(s, PLANTS[args.plant])
                r = s.js(CENSUS_JS)
                v.data.setdefault("census", {})[mp] = r
                for z in EXPECT.get(mp, ()):                 # a zone the map must yield (an empty zone is never a silent pass)
                    if z not in r["zones"]:
                        v.cnj("%s [%s] (>= 90 %% correct)" % (z, mp), "no point of the zone found")
                for z, e in sorted(r["zones"].items()):
                    if z.endswith("_info"):
                        top = dict(sorted(e["got"].items(), key=lambda kv: -kv[1])[:5])
                        v.info("%s [%s] (the painted ground 3 m further out, information)" % (z[:-5], mp), {"n": e["n"], "same": round(e["ok"] / max(1, e["n"]), 3), "got": top})
                        continue
                    name = "%s [%s] (>= 90 %% correct)" % (z, mp)
                    if e["n"] < N_MIN:
                        v.cnj(name, "only %d points in the zone" % e["n"])
                        continue
                    sh = e["ok"] / e["n"]
                    top = dict(sorted(e["got"].items(), key=lambda kv: -kv[1])[:5])
                    v.check(name, sh >= SHARE_MIN, {"n": e["n"], "correct": round(sh, 3), "got": top}, ">= 0.90")
            L.errors_row(v, s)
    return C.run_gate("p23_footsteps", body, args)


if __name__ == "__main__":
    sys.exit(main())
