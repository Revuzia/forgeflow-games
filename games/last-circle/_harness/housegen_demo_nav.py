#!/usr/bin/env python
"""housegen_demo_nav - can a BOT plan inside housegen's houses? (Last Circle Wave 8 stage A2, lane H4.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/housegen_demo_nav.py --disk                       # 300 houses (every use towngen hands over, every theme, 1-3 walkable storeys, towers asked up to 6)
    python _harness/housegen_demo_nav.py --disk --houses 600
    python _harness/housegen_demo_nav.py --disk --plant doors-blocked # the control (must exit 1): a 3 m crate in every street doorway

housegen (runtime/3d/royale/housegen.js) exposes, per room, its WALKABLE area (rooms[].walk: the 0.25 m samples where its own capsule walk stood, merged into
rectangles), a room node inside it (rooms[].anchor) and the door / stair links (nav.links: from / to points each side of a doorway, a stair's approach and exit).
A furnished room is rarely convex (a straight line between two of its doors can cross a bed: lane check_a measured 85 % of rooms walkable in straight lines), so
stage B's bots must plan INSIDE rooms on the collider grid. This gate proves that works with the game's own planner and mover, in the configuration stage B uses:
the houses stand on a flat synthetic map (only their colliders: housegen.collidersOf), runtime/sim/navgrid.js bakes each with bakeTown (the way stage B composes
towns), findPath plans street -> room anchor and room anchor -> street, and the REAL mover (player.js tick through mover_env.mjs) follows the plan.

  nav-rooms           rooms reached IN (ending inside the room's walkable rectangles, on its floor) AND OUT (back on the street) >= 99 %    (the lane bar)
  nav-upper-rooms     the same for rooms above the ground floor >= 99 %
  nav-walks-agree     the real mover arrives on >= 99.5 % of the walks the grid planned (navtown's AGREE_MIN: the grid must not plan what the mover cannot walk)
  nav-anchors         every room node lies inside its own walkable rectangles
  nav-coverage        >= 300 houses, every use (house shop hall shed barn midrise tower + the theme mix), tall shells with closed storeys among them
The control --plant doors-blocked plants a 3 m crate in every street doorway: no plan gets in (nav-rooms FAILS: 0 %).
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

GATE = "housegen_demo_nav"
ROOMS_MIN = 0.99
AGREE_MIN = 0.995
HOUSES_MIN = 300
PLANT_ROWS = {"doors-blocked": {"nav-rooms"}}

PROBE = r"""// navproof.mjs - housegen's per-room walkable areas + door / stair links as a planner sees them: the game's NavGrid (runtime/sim/navgrid.js, bakeTown over the
// house's colliders) plans street -> room anchor and room anchor -> street, the REAL mover (player.js tick, mover_env.mjs) follows the plan.
//   node navproof.mjs <gameRoot> <nHouses> <out.json>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const ROOT = path.resolve(process.argv[2]), N = Number(process.argv[3] || 300), OUT = process.argv[4], PLANT = process.argv[5] || "";
const H_ = (p) => pathToFileURL(path.join(ROOT, p)).href;
const { makeEnv } = await import(H_("_harness/world_env.mjs"));
const { loadPlayer, makeGameW, makeMover, follow } = await import(H_("_harness/mover_env.mjs"));
const HG = await import(H_("runtime/3d/royale/housegen.js"));
const req = createRequire(import.meta.url);
const NGm = req(path.join(ROOT, "runtime", "sim", "navgrid.js"));
const E = await makeEnv({ root: ROOT });
const NG = NGm && NGm.bakeTown ? NGm : globalThis.FFG.sim.NavGrid;
const warn = console.warn, log = console.log;
console.warn = () => {}; console.log = () => {};
const { buildMap } = await E.importMaps();
const Pmod = await loadPlayer(ROOT);
const M = await buildMap(E.makeW(7), "ashgrid");
const Y0 = (M.waterY || 0) + 30;
let houseCols = [];
M.ground = null; M.heightAt = () => Y0; M.queryColliders = (x, z, r, out) => { const o = out || []; o.length = 0; for (const c of houseCols) if (c.maxX >= x - r && c.minX <= x + r && c.maxZ >= z - r && c.minZ <= z + r) o.push(c); return o; };
if (M.supportAt) M.supportAt = undefined;
M.portals = [];
const GW = await makeGameW(E, Pmod, M, 7);
const mover = makeMover(GW, E.THREE);
console.warn = warn; console.log = log;

// 300 houses: every use towngen hands over, every theme, 1-3 walkable storeys (towers asked up to 6), towngen's sizes, all turns, rect / L plans
let s = 0x9e3779b9 >>> 0;
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const USES = [["house", [[7.5, 7.5], [10, 7.5], [10, 10], [12.5, 10]], [1, 2, 3]], ["shop", [[10, 10], [12.5, 10], [12.5, 12.5]], [1, 2]], ["hall", [[15, 10], [17.5, 12.5], [20, 12.5]], [1]],
  ["shed", [[5, 5], [7.5, 5], [7.5, 7.5]], [1]], ["barn", [[17.5, 12.5], [20, 12.5]], [1]], ["midrise", [[12.5, 12.5], [15, 15]], [2, 3, 5]], ["tower", [[15, 15], [17.5, 17.5]], [3, 6]], [null, [[7.5, 10], [10, 12.5], [12.5, 15]], [1, 2, 3]]];
const rows = [], fails = [];
let rooms = 0, reachIn = 0, reachOut = 0, both = 0, planIn = 0, upper = 0, upperBoth = 0, planned = 0, walked = 0, anchorOut = 0;
const t0 = Date.now();
for (let h = 0; h < N; h++) {
  const [use, dims, sts] = USES[h % USES.length], dm = dims[Math.floor(rnd() * dims.length)], theme = ["city", "resort", "lodge"][Math.floor(h / USES.length) % 3];
  const P = { id: "nv" + h, cx: 0, cz: 0, y: Y0, w: dm[0], d: dm[1], turn: Math.floor(rnd() * 4), theme, storeys: sts[Math.floor(rnd() * sts.length)], seed: Math.floor(rnd() * 4294967296), plan: rnd() < 0.25 ? "L" : "auto" };
  if (use) P.use = use;
  const H = HG.generate(P);
  houseCols = HG.collidersOf(H);
  const fd0 = H.doors.find((d) => d.kind === "front");
  // the control: a 3 m crate planted in every street doorway (front, back, side): no plan may get in, no walk may arrive
  if (PLANT === "doors-blocked") for (const d of H.doors) if (d.kind !== "interior") houseCols.push({ kind: "box", minX: d.x - 1.6, maxX: d.x + 1.6, minY: Y0, maxY: Y0 + 3, minZ: d.z - 1.6, maxZ: d.z + 1.6, dir: -1, prop: null, idx: -1, hp: 0, dead: false, _qs: 0 });
  void fd0;
  const pad = 8, rect = { minX: H.aabb.min[0] - pad, maxX: H.aabb.max[0] + pad, minZ: H.aabb.min[2] - pad, maxZ: H.aabb.max[2] + pad };
  const town = NG.bakeTown(houseCols, () => Y0, [rect], { waterY: -1000 });
  const W = town.world;
  const fd = H.doors.find((d) => d.kind === "front");
  const st = { x: fd.out[0] + fd.nx * 2.5, y: Y0, z: fd.out[1] + fd.nz * 2.5 };
  const inWalk = (rm, x, z) => rm.walk.some((q) => x > q[0] - 0.3 && x < q[2] + 0.3 && z > q[1] - 0.3 && z < q[3] + 0.3);
  const row = { id: H.id, use: H.use, theme, storeys: H.storeys, shell: H.shell, rooms: H.rooms.length, in: 0, out: 0 };
  for (const rm of H.rooms) {
    rooms++; if (rm.floor > 0) upper++;
    const goal = { x: rm.anchor[0], y: rm.anchor[1], z: rm.anchor[2] };
    if (!inWalk(rm, goal.x, goal.z)) anchorOut++;
    let okIn = false, okOut = false, why = null;
    for (const [from, to, dir] of [[st, goal, "in"], [goal, st, "out"]]) {
      const p = NG.findPath(W, from.x, from.y, from.z, to.x, to.y, to.z);
      const okPlan = p && p.length && Math.hypot(p[p.length - 1].x - to.x, p[p.length - 1].z - to.z) < 1.0 && Math.abs(p[p.length - 1].y - to.y) < 0.6;
      if (!okPlan) { why = why || dir + ": no plan (" + (W.lastFail || "partial") + ")"; continue; }
      if (dir === "in") planIn++;
      planned++;
      const f = follow(Pmod, mover, GW, from, p);
      if (f.ok) walked++;
      const a = mover.a;
      const there = dir === "in" ? (inWalk(rm, a.pos.x, a.pos.z) && Math.abs(a.pos.y - rm.y) < 0.6) : (Math.hypot(a.pos.x - st.x, a.pos.z - st.z) < 1.0 && Math.abs(a.pos.y - Y0) < 0.6);
      if (f.ok && there) { if (dir === "in") okIn = true; else okOut = true; }
      else why = why || dir + ": mover " + (f.ok ? "ended outside the room's walkable area at " + [a.pos.x, a.pos.y, a.pos.z].map((v) => v.toFixed(2)) : f.why + " at " + (f.at || []).map((v) => v.toFixed(2)));
    }
    if (okIn) { reachIn++; row.in++; }
    if (okOut) { reachOut++; row.out++; }
    if (okIn && okOut) { both++; if (rm.floor > 0) upperBoth++; }
    else if (fails.length < 25) fails.push({ house: H.id, use: H.use, room: rm.id, kind: rm.kind, floor: rm.floor, why });
  }
  rows.push(row);
}
const res = { plant: PLANT || null, houses: N, rooms, upperRooms: upper, reachedIn: reachIn, reachedOut: reachOut, both, upperBoth, plannedIn: planIn, planned, walked, anchorOut, pctBoth: +(100 * both / rooms).toFixed(2), secs: (Date.now() - t0) / 1000,
  byUse: rows.reduce((a, r) => { const k = r.use + (r.shell ? "+shell" : ""); a[k] = a[k] || { houses: 0, rooms: 0, both: 0 }; a[k].houses++; a[k].rooms += r.rooms; return a; }, {}), fails };
for (const r of rows) { const k = r.use + (r.shell ? "+shell" : ""); res.byUse[k].both += Math.min(r.in, r.out); }
const txt = JSON.stringify(res, null, 1);
if (OUT) fs.writeFileSync(OUT, txt);
process.stdout.write(txt + "\n");
process.exit(0);
"""


def main_fn(v, args):
    root = os.path.dirname(HERE)
    tmp = tempfile.mkdtemp(prefix="lc_hgnav_")
    try:
        probe = os.path.join(tmp, "probe_housegen_nav.mjs")
        with open(probe, "w", encoding="utf-8") as f:
            f.write(PROBE)
        out = os.path.join(tmp, "result.json")
        cmd = ["node", probe, root, str(args.houses), out] + ([args.plant] if args.plant else [])
        print("%s: %s" % (GATE, " ".join(cmd[1:])), flush=True)
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=args.timeout)
        if p.returncode != 0 or not os.path.exists(out):
            v.cnj("probe", "node exited %s: %s" % (p.returncode, (p.stderr or p.stdout)[-900:]))
            return
        with open(out, encoding="utf-8") as f:
            d = json.load(f)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    v.data["nav"] = d
    counted = lambda name: not args.plant or name in PLANT_ROWS.get(args.plant, set())
    def row(name, ok, detail):
        if counted(name):
            v.check(name, ok, detail)
        else:
            v.info(name, ("would PASS: " if ok else "would FAIL: ") + detail)
    rooms, both, up, upb = d["rooms"], d["both"], d["upperRooms"], d["upperBoth"]
    row("nav-rooms", rooms > 0 and both >= ROOMS_MIN * rooms,
        "%d of %d rooms (%.2f %%) reached in AND out by the real mover on NavGrid paths (in %d, out %d; planned in %d); bar >= %d %%; first fails %s" % (
            both, rooms, 100.0 * both / max(1, rooms), d["reachedIn"], d["reachedOut"], d["plannedIn"], ROOMS_MIN * 100, d["fails"][:4]))
    row("nav-upper-rooms", up > 0 and upb >= ROOMS_MIN * up, "%d of %d rooms above the ground floor (%.2f %%)" % (upb, up, 100.0 * upb / max(1, up)))
    row("nav-walks-agree", d["planned"] > 0 and d["walked"] >= AGREE_MIN * d["planned"], "the mover arrived on %d of %d planned walks (%.2f %%)" % (
        d["walked"], d["planned"], 100.0 * d["walked"] / max(1, d["planned"])))
    row("nav-anchors", d["anchorOut"] == 0, "%d room nodes outside their own walkable rectangles" % d["anchorOut"])
    uses = d["byUse"]
    want = {"house", "shop", "hall", "shed", "barn", "midrise", "tower"}
    have = {k.split("+")[0] for k in uses}
    row("nav-coverage", d["houses"] >= HOUSES_MIN and want <= have and any(k.endswith("+shell") for k in uses),
        "%d houses; by use %s" % (d["houses"], json.dumps(uses)))
    v.info("timing", "%.1f s for %d houses (%d rooms, %d walks)" % (d["secs"], d["houses"], rooms, d["planned"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.set_defaults(disk=True)
    ap.add_argument("--houses", type=int, default=300)
    ap.add_argument("--plant", default=None, choices=sorted(PLANT_ROWS))
    ap.add_argument("--timeout", type=float, default=1200.0)
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
