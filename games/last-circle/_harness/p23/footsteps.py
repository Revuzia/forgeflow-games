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
  inland [isla_viva]     ground >= waterY + 6 m, open: 'grass'
  beside [every map]     0.15-0.6 m outside a standing box collider (a wall, a rock, a car), on the ground: the same surface as the open point
                         3 m further out (a wall beside you is not the floor under you)
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
    if (M.id === 'isla_viva' && wy > -100 && h >= wy + 6) add('inland', s === 'grass', s);
  }
  // beside a standing box collider: 0.35 m off a face vs 3 m further out
  let k = 0;
  for (const c of M.colliders) { if (c.dead || c.kind !== 'box' || k > 600) continue; const g = M.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
    if (c.minY > g + 0.3 || c.maxY < g + 0.8 || c.maxY > g + 12) continue; k++;
    const cx = (c.minX + c.maxX) / 2, z0 = c.maxZ + 0.35, z1 = c.maxZ + 3.35; const h0 = M.heightAt(cx, z0), h1 = M.heightAt(cx, z1);
    if (h0 < wy + 0.3 || Math.abs(h1 - h0) > 0.4) continue;
    if (M.queryColliders(cx, z0, 0.25, []).some((o) => !o.dead && cx > o.minX && cx < o.maxX && z0 > o.minZ && z0 < o.maxZ)) continue;   // the point itself is on something
    if (!open(cx, z1, 1.0)) continue;
    const a = M.surfaceAt(cx, z0, h0), b = M.surfaceAt(cx, z1, h1); add('beside', a === b, a + '|' + b); }
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
                for z, e in sorted(r["zones"].items()):
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
