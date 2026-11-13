#!/usr/bin/env python
"""probe_loot_live - loot.js in a REAL match (Wave 7, lane 7C): a pickup does not reach through a floor, and a normal pickup still works.

    python _harness/probe_loot_live.py --disk                              # Savanna seed 7, working copy
    python _harness/probe_loot_live.py --disk --old-loot 60b854d0          # control: loot.js of the live build -> pickups THROUGH the slab happen (the run FAILS)
    python _harness/probe_loot_live.py --disk --map isla_viva --seed 3

What it drives: a real standard match (startMatch -> lobby -> a REAL Enter), the player landed and protected. In page, the probe lists the floor
items a player could take through a slab: ammo / heals the player would accept, lying within 1.2 m (horizontally) of a ramp-reached slab whose top
is 2.2-4.0 m over them (the roof of a ground-floor room, the second floor of a tower). For each (up to --n) it stands the REAL player on that slab
(teleport; the sim then steps with the game's own stepActor + loot.update, 0.5 s) and asks: was the item taken?  The control is the same item
with the player on the item's own floor: it must be taken (a pickup that no longer works would pass the first row for the wrong reason).

  through-slab: the player on the slab takes 0 of the items under it         (live loot.js: |dy| < 4 -> takes them)
  same-floor:   the player on the item's floor takes >= 90 % of the same items
  eligibility:  >= 3 exposed items were found (else CNJ: nothing to judge on this seed)
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

EXPOSED_JS = r"""(maxN) => {
  const C = window.__LC__, W = C.W, M = W.map, p = W.player;
  const cols = [];
  const ramps = M.colliders.filter((c) => c.kind === 'ramp' && !c.dead);
  const reached = (c) => ramps.some((rp) => Math.abs(rp.maxY - c.maxY) < 0.5 && rp.maxX > c.minX - 1.3 && rp.minX < c.maxX + 1.3 && rp.maxZ > c.minZ - 1.3 && rp.minZ < c.maxZ + 1.3);
  const out = [];
  const items = W.debugItems().filter((it) => it.data.kind === 'ammo' || it.data.kind === 'consumable');
  items.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const it of items) {
    if (!W.wouldAcceptItem(p, it.data)) continue;
    const { x, y, z } = it.pos;
    for (const c of M.queryColliders(x, z, 3, cols)) {
      if (c.dead || c.kind !== 'box' || c.maxX - c.minX < 3 || c.maxZ - c.minZ < 3) continue;
      const top = c.maxY - y;
      if (top < 2.3 || top >= 3.95) continue;
      if (!reached(c)) continue;
      // where the player can stand on it: inset 0.6 m; the item must still be within 1.2 m of that spot (the walkover reach is 1.5 m)
      const px = Math.min(c.maxX - 0.6, Math.max(c.minX + 0.6, x)), pz = Math.min(c.maxZ - 0.6, Math.max(c.minZ + 0.6, z));
      if (Math.hypot(px - x, pz - z) > 1.2) continue;
      // a player standing there must not also stand beside ANOTHER item on the slab's own level (that pickup would be legitimate)
      out.push({ id: it.id, x, y, z, kind: it.data.kind, slabTop: c.maxY, px, pz });
      break;
    }
  }
  // spread them out: one per 6 m cell
  const seen = new Set(), pick = [];
  for (const o of out) { const k = Math.floor(o.x / 6) + ':' + Math.floor(o.z / 6); if (seen.has(k)) continue; seen.add(k); pick.push(o); if (pick.length >= maxN) break; }
  return { found: out.length, pick };
}"""

TRY_JS = r"""([o, mode]) => {
  const C = window.__LC__, W = C.W, p = W.player;
  const has = () => W.debugItems().some((i) => i.id === o.id);
  // stand on the slab (through-slab) or on the item's own floor (same-floor)
  const sx = mode === 'slab' ? o.px : o.x + 0.4, sz = mode === 'slab' ? o.pz : o.z, sy = mode === 'slab' ? o.slabTop : o.y - 0.5;
  p.alive = true; p.hp = 100; p.shield = 100;
  p.pos.set(sx, sy + 0.02, sz); p.vel.set(0, 0, 0);
  if (p.obj) p.obj.position.copy(p.pos); if (p._pp) p._pp.copy(p.pos);
  p.onGround = false; p.gliding = false; p.swimming = false; p.mantleT = null; p.emoting = null; p.healing = null;
  const inp = p.input; inp.mx = 0; inp.mz = 0; inp.jump = false; inp.sprint = false; inp.ads = false; inp.crouch = false; inp.fire = false;
  const before = has();
  for (let i = 0; i < 15; i++) C.fastForward(1 / 30, 1 / 30);
  return { id: o.id, before, after: has(), y: +p.pos.y.toFixed(2), wantY: +sy.toFixed(2), onGround: !!p.onGround };
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--n", type=int, default=8, help="how many exposed items to try (one per 6 m cell)")
    ap.add_argument("--old-loot", default=None, metavar="GITREV", help="serve runtime/3d/royale/loot.js as committed at GITREV (the control: it must FAIL)")
    args = ap.parse_args()

    def body(v):
        s = C.Session(args, name="probe_loot_live")
        with s:
            if args.old_loot:
                import urllib.parse
                blob = C.git_blobs(args.old_loot).read("runtime/3d/royale/loot.js")
                if blob is None:
                    raise C.HarnessError("loot.js not in %s" % args.old_loot)
                s.context.route(lambda url: urllib.parse.urlparse(url).path.endswith("/royale/loot.js"),
                                lambda r: r.fulfill(status=200, body=blob, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store"}))
                v.note("loot.js served from %s (the control)" % args.old_loot)
            s.boot()
            s.start_match(mode="standard", seed=args.seed, map_id=args.map, guard=True)
            s.land(protect=True)
            ex = s.js(EXPOSED_JS, args.n)
            v.data["exposed"] = ex
            v.note("%d exposed ammo/heal items on %s seed %d, trying %d" % (ex["found"], args.map, args.seed, len(ex["pick"])))
            if len(ex["pick"]) < 3:
                v.cnj("eligibility: >= 3 items under a ramp-reached slab", "only %d found on %s seed %d" % (len(ex["pick"]), args.map, args.seed))
                return
            slab, same = [], []
            for o in ex["pick"]:
                slab.append(s.js(TRY_JS, [o, "slab"]))
            # the same-floor control needs the items back: a second pass only on those still there, the rest were taken (reported)
            for o in ex["pick"]:
                r = s.js(TRY_JS, [o, "floor"])
                same.append(r)
            took_slab = [r for r in slab if r["before"] and not r["after"]]
            stood = [r for r in slab if abs(r["y"] - r["wantY"]) < 0.6]
            v.check("through-slab: a player standing on the slab takes 0 of the items under it", not took_slab,
                    {"tried": len(slab), "taken": [r["id"] for r in took_slab], "playerStayedOnSlab": len(stood)})
            v.check("through-slab: the player really stood on the slab (not dropped through to the floor below)", len(stood) >= max(1, len(slab) - 1),
                    [(r["id"], r["y"], r["wantY"]) for r in slab])
            elig = [r for r in same if r["before"]]
            took_same = [r for r in elig if not r["after"]]
            v.check("same-floor: a player on the item's own floor takes >= 90 % of the same items (a normal pickup still works)",
                    len(elig) >= 2 and len(took_same) >= 0.9 * len(elig),
                    {"eligible": len(elig), "taken": len(took_same), "left": [r["id"] for r in elig if r["after"]]})
            d = s.diagnostics()
            v.check("0 page errors / console errors / failed requests", not C.diag_problems(d, rig=False), C.diag_problems(d, rig=False))

    return C.run_gate("probe_loot_live", body, args)


if __name__ == "__main__":
    sys.exit(main())
