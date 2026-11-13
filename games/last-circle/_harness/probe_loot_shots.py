#!/usr/bin/env python
"""probe_loot_shots - before / after screenshots of loot that the settle rule moves (Wave 7, lane 7C).

    python _harness/probe_loot_shots.py --disk --map ashgrid --seed 2 --targets 439.781,12.724,463.451;11.212,13.494,-9.76 --tag A [--old-loot 60b854d0]

A real standard match (startMatch -> lobby -> a REAL Enter), the player landed and protected; for each target (x,y,z of an item or chest as the OLD
loot.js placed it, from probe_loot.mjs --loot <old> --list) the real player is stood 4.5 m away facing it (the game's own third-person camera) and the
WebGL canvas is saved as <shots>/<tag>_<n>.png. Run once with --old-loot <rev> (loot.js of that revision on the same maps) and once without: the same
camera, the same seed, the item where each loot.js puts it. Also prints, per target, what the page's loot module holds nearest to the target
(id, kind, position, ring y, beam top): the numbers behind the picture.
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

PLACE_JS = r"""([tx, ty, tz, dist, dirx, dirz, pitch]) => {
  const C = window.__LC__, W = C.W, p = W.player, M = W.map;
  const L = Math.hypot(dirx, dirz) || 1;
  const px = tx + dirx / L * dist, pz = tz + dirz / L * dist;
  // stand on the same level as the target: the highest box top / ground at or under (ty + 0.6) at the stand point
  let gy = M.heightAt(px, pz);
  for (const c of M.queryColliders(px, pz, 0.5, [])) { if (c.dead || c.kind !== 'box') continue; if (px < c.minX || px > c.maxX || pz < c.minZ || pz > c.maxZ) continue; if (c.maxY <= ty + 0.6 && c.maxY > gy) gy = c.maxY; }
  p.alive = true; p.hp = 100; p.shield = 100;
  p.pos.set(px, gy + 0.02, pz); p.vel.set(0, 0, 0);
  if (p.obj) p.obj.position.copy(p.pos); if (p._pp) p._pp.copy(p.pos);
  p.onGround = false; p.gliding = false; p.swimming = false; p.mantleT = null; p.emoting = null; p.healing = null;
  const yaw = Math.atan2(-(tx - px), -(tz - pz));
  p.input.yaw = yaw; p.yaw = yaw; p.input.pitch = pitch;
  return { px, pz, gy };
}"""
NEAREST_JS = r"""([tx, ty, tz]) => {
  const W = window.__LC__.W, fx = W.debugLootFx ? W.debugLootFx() : null;
  const cand = [];
  for (const it of W.debugItems()) cand.push({ t: 'item', id: it.id, kind: it.data.kind, x: it.pos.x, y: it.pos.y, z: it.pos.z, d: Math.hypot(it.pos.x - tx, it.pos.z - tz) + Math.abs(it.pos.y - ty) * 0.2 });
  for (const c of W.debugChests()) cand.push({ t: 'chest', id: c.id, x: c.pos.x, y: c.pos.y, z: c.pos.z, d: Math.hypot(c.pos.x - tx, c.pos.z - tz) + Math.abs(c.pos.y - ty) * 0.2 });
  cand.sort((a, b) => a.d - b.d);
  const o = cand[0];
  if (!o) return null;
  const info = window.__LC__.W.debugLootFx ? window.__LC__.W.debugLootFx(o.id) : null;
  const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  return { id: o.id, type: o.t, kind: o.kind || null, x: r3(o.x), y: r3(o.y), z: r3(o.z), ringY: info && info.obj && info.obj.ring ? r3(info.obj.ring.y) : null,
           beamTop: info && info.obj && info.obj.beam ? r3(info.obj.beam.top) : null, ceil: info && info.obj ? info.obj.ceil : null };
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=2)
    ap.add_argument("--targets", required=True, help="x,y,z;x,y,z;... (item / chest positions as the old loot.js placed them)")
    ap.add_argument("--tag", default="A")
    ap.add_argument("--dist", type=float, default=4.5)
    ap.add_argument("--pitch", type=float, default=-0.30)
    ap.add_argument("--from", dest="from_dir", default="0,1", help="direction FROM the target to the camera stand point, x,z (default 0,1)")
    ap.add_argument("--old-loot", default=None, metavar="GITREV")
    ap.add_argument("--shots", default=None)
    args = ap.parse_args()
    shots = args.shots or os.path.join(C.SHOTS, "loot7c")
    targets = [tuple(float(q) for q in t.split(",")) for t in args.targets.split(";") if t.strip()]
    fdx, fdz = [float(q) for q in args.from_dir.split(",")]

    def body(v):
        with C.Session(args, name="probe_loot_shots") as s:
            if args.old_loot:
                blob = C.git_blobs(args.old_loot).read("runtime/3d/royale/loot.js")
                s.context.route(lambda url: urllib.parse.urlparse(url).path.endswith("/royale/loot.js"),
                                lambda r: r.fulfill(status=200, body=blob, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store"}))
                v.note("loot.js from %s" % args.old_loot)
            s.boot()
            s.start_match(mode="standard", seed=args.seed, map_id=args.map, guard=True)
            s.land(protect=True)
            s.freeze_loop()
            s.install_pump()
            for i, (tx, ty, tz) in enumerate(targets):
                pl = s.js(PLACE_JS, [tx, ty, tz, args.dist, fdx, fdz, args.pitch])
                s.step_frames(8, 1.0 / 60, False)
                s.js(PLACE_JS, [tx, ty, tz, args.dist, fdx, fdz, args.pitch])      # re-aim after the sim settled the player
                s.step_frames(3, 1.0 / 60, True)
                near = s.js(NEAREST_JS, [tx, ty, tz])
                path = os.path.join(shots, "%s_%d.png" % (args.tag, i))
                s.canvas_png(path)
                print("  target %d (%.2f %.2f %.2f): stand %s -> %s" % (i, tx, ty, tz, pl, path))
                print("    loot module nearest: %s" % near)
                v.info("target %d" % i, {"stand": pl, "nearest": near, "png": path})
            d = s.diagnostics()
            v.check("0 page errors / console errors / failed requests", not C.diag_problems(d, rig=False), C.diag_problems(d, rig=False))

    return C.run_gate("probe_loot_shots", body, args)


if __name__ == "__main__":
    sys.exit(main())
