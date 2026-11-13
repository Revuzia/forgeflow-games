#!/usr/bin/env python
"""roofland - what does a bot do after a glide ends on a ROOF?  (Wave-7 completion round, lane D5; the row for lane D4's roof exit)

    python _harness/roofland.py --disk                          # ashgrid (Savanna), seeds 21-28, 120 s of match time each (~4 min)
    python _harness/roofland.py --disk --seeds 21,22 --seconds 90
    python _harness/roofland.py --rev dd414cb2                  # the must-fail proof: the Wave-7 live build (bots stand 7-10 s on a downtown roof)

The Wave-7 build ends a lot of bot glides on roofs, wall tops and ledges (31 touchdowns on something over 2.5 m in 6 Savanna matches; 7 of them on real roofs 9-13 m up). A roof is
no part of the nav grid's walkable graph and the old window planner has no way down from it: the bot used to STAND - both wall slides walled, moveToward holds still, the goal is
parked after 3 s, the next goal tried, until one happened to lie the open way (seed 26, bot s25 on a 9.4 m wall top: 7.5 s still, 10.5 s on the roof). A player in the same spot
walks off the edge (the game has no fall damage). This gate measures that behaviour in the real thing: NATURAL touchdowns of the match's own 49 bots - not forced placements (a forced
test puts the bot on an open slab centre and the pre-fix bots walk off it in 2 s; the defect lives in the pocketed spots a real glide lands on, which only a real match visits).

What is measured (per Savanna seed, one standard bot match; every bot tracked from its touchdown, all in the page through W._tickHook at the sim's own 30 Hz tick):
  * a ROOF touchdown = the bot stands on the ground (not gliding) with its feet at least ROOF_AGL (3.5 m) above the terrain under it (cars and container stacks are lower)
  * LEFT = its feet have dropped at least 2.5 m below the touchdown height (it came down: a ledge, an edge, the tower's own stairs); GROUND = its feet are within 1.5 m of the terrain
  * STILL = the TOTAL time it stood on the roof (moved less than 1 cm per tick, on the ground) before it left, in a state that is not ENGAGE (a firefight from a roof is a legitimate stand) or HEAL;
    the longest single burst is printed next to it

Rows (counts are exact; milliseconds are information):
  roof-landings     at least MIN_ROOFS roof touchdowns were observed over the seeds (a probe that saw no roof is could-not-judge, never a pass)
  roof-exit         every roof touchdown that lived (was not shot) LEFT the roof within EXIT_S (8 s) of time NOT spent in ENGAGE / HEAL (a firefight from a roof is a legitimate stand: the same exemption roof-standstill has); a landing still up there when its watch ends is judged by its dwell minus that time. exactly 0 violations
  roof-standstill   no roof touchdown stood still for more than STILL_S (4 s IN TOTAL) before it left. One freeze is the bots' own planning cycle (requestPath every 2.5 s, a loot goal parked after
                    3 s: a single burst reads 3.0-3.35 s); the defect is the SECOND one - the goal is parked, the next goal tried, the bot holds still again, and again. exactly 0 violations
  errors            0 page errors, 0 failed requests
  INFO: every roof touchdown (seed, bot, height over the ground, state at touchdown, seconds to leave, seconds to the ground, longest stand, total stand), the non-roof touchdown count,
        shot-on-the-roof count

Where the bars come from: EXIT_S (8 s) is the design scale above (one path request 2.5 s + the walk to the nearest edge of a roof + the fall), set BEFORE this gate saw the fixed build. The first draft
judged the LONGEST BURST of standing against 3 s; the Wave-7 live build (dd414cb2) read 3.05-3.33 s on five landings by that measure (one ordinary freeze = a failure, and the bar sat 0.05 s from a normal bot),
while the defect lane D4 described ("stood still 7.5 s": the loot goal is parked after 3 s, the next goal tried, the bot freezes again) is a TOTAL: 7.55 s (seed 26, bot s25 - the same bot D4 traced) and 8.97 s
(seed 27, bot s3). The row now judges the total against 4 s (one freeze plus a tick of slack); that is a correction of what the row measures, not a lower bar, and dd414cb2 still fails it (2 landings over 4 s: 8.97 and
7.55) and also fails roof-exit (5 of 40 over 8 s, up to 13.35 s). Measured by lane D4 on seeds 21-26 on the old world: roof dwell 4.6 / 7.2 / 8.6 / 9.5 / 10.5 / 12.5 s.

Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "roofland"
ROOF_AGL = 3.5          # m: feet over the terrain = a roof / deck / wall top (bots.js DECK_AGL; a car or a container stack is lower)
LEFT_DROP = 2.5         # m: the feet have dropped this far below the touchdown height = it left the roof
GROUND_AGL = 1.5        # m: within this of the terrain = down
EXIT_S = 8.0            # a roof touchdown that lived leaves the roof within this many seconds
STILL_S = 4.0           # ... and never stands still longer than this IN TOTAL (not counting ENGAGE / HEAL) before it leaves (one ordinary freeze is a 3.0-3.35 s burst; see the docstring)
MIN_ROOFS = 5           # over the default seeds the Wave-7 build reads 9-10 and the tree 5+ (a Savanna match lands 1-2 bots on real roofs); fewer = the probe saw too little to judge
DEFAULT_SEEDS = "21,22,23,24,25,26,27,28"
STILL_SKIP_STATES = ("ENGAGE", "HEAL")

WATCH_JS = r"""async (o) => {
  const C = window.__LC__, W = C.W; W.paused = true; const M = W.map;
  const brains = C.brains();
  const rec = new Map(); const out = [];
  let nonRoof = 0;
  const prev = W._tickHook;
  const close = (r, why) => { if (r.closed) return; r.closed = true; r.why = why;
    out.push({ id: r.id, agl0: +r.agl0.toFixed(1), x: +r.x0.toFixed(1), z: +r.z0.toFixed(1), t0: +r.t0.toFixed(1), state0: r.state0,
      left: r.left, ground: r.ground, stillMax: +r.stillMax.toFixed(2), stillTot: +r.stillTot.toFixed(2), skipTot: +r.skipTot.toFixed(2), obs: +(W.t - r.t0).toFixed(1), killed: why === 'killed', ended: why }); };
  W._tickHook = (W2) => {
    if (prev) prev(W2);
    for (const b of brains) {
      const a = b.actor, id = a.id;
      let r = rec.get(id);
      if (!r) { r = { id, air: false, landed: false, closed: false }; rec.set(id, r); }
      if (r.closed) continue;
      if (!r.landed) {
        if (!a.alive) { r.closed = true; continue; }
        if (!a.onGround || a.gliding) { r.air = true; continue; }
        if (!r.air) continue;                       // never seen in the air: a bot that did not drop (not a touchdown)
        r.landed = true;
        const agl = a.pos.y - M.heightAt(a.pos.x, a.pos.z);
        if (agl < o.roofAgl) { nonRoof++; r.closed = true; continue; }
        r.t0 = W.t; r.agl0 = agl; r.x0 = a.pos.x; r.y0 = a.pos.y; r.z0 = a.pos.z; r.state0 = b.state;
        r.lx = a.pos.x; r.lz = a.pos.z; r.still = 0; r.stillMax = 0; r.stillTot = 0; r.skipTot = 0; r.left = null; r.ground = null; r.lastT = W.t;
        continue;
      }
      // on / off the roof
      if (!a.alive) { close(r, 'killed'); continue; }
      const dt = Math.max(0, W.t - r.lastT); r.lastT = W.t;
      const mv = Math.hypot(a.pos.x - r.lx, a.pos.z - r.lz); r.lx = a.pos.x; r.lz = a.pos.z;
      const agl = a.pos.y - M.heightAt(a.pos.x, a.pos.z);
      if (r.left == null) {
        if (o.skip.includes(b.state)) r.skipTot += dt;               // time spent in a firefight / healing on the roof: a legitimate stand, not a stall
        if (a.pos.y < r.y0 - o.leftDrop) r.left = +(W.t - r.t0).toFixed(2);
        else if (a.onGround && mv < 0.01 && !o.skip.includes(b.state)) { r.still += dt; r.stillTot += dt; if (r.still > r.stillMax) r.stillMax = r.still; }
        else if (mv >= 0.01) r.still = 0;
      }
      if (r.ground == null && agl < o.groundAgl) r.ground = +(W.t - r.t0).toFixed(2);
      if (r.left != null && r.ground != null) close(r, 'down');
      else if (W.t - r.t0 > o.watch) close(r, 'watch-over');
    }
  };
  let n = 0;
  for (let el = 0; el < o.seconds; el += 1) { C.fastForward(1, 1 / 60); n++; if (W.match && W.match.over) break; }
  W._tickHook = prev;
  for (const r of rec.values()) if (r.landed && !r.closed) close(r, 'run-over');
  return { roofs: out, nonRoof, simT: +W.t.toFixed(1), seconds: n, brains: brains.length };
}"""


def main_fn(v, args):
    seeds = [int(x) for x in args.seeds.split(",") if x.strip()]
    v.data.update({"map": args.map, "seeds": seeds, "seconds": args.seconds, "watch": args.watch,
                   "bars": {"roofAgl": ROOF_AGL, "exitS": EXIT_S, "stillS": STILL_S, "minRoofs": MIN_ROOFS}})
    print("%s: map %s | seeds %s | %.0f s of match time each | watch %.0f s per landing" % (GATE, args.map, ",".join(str(x) for x in seeds), args.seconds, args.watch), flush=True)
    rows, errs, nonroof = [], [], 0
    t_all = time.time()
    with C.Session(args, "roofland", viewport={"width": 960, "height": 600}) as s:
        s.boot()
        s.freeze_loop()
        for sd in seeds:
            t0 = time.time()
            st = s.start_match(mode="standard", seed=sd, map_id=args.map, enter=True)
            s.freeze_loop()
            r = s.js(WATCH_JS, {"seconds": args.seconds, "watch": args.watch, "roofAgl": ROOF_AGL, "leftDrop": LEFT_DROP, "groundAgl": GROUND_AGL, "skip": list(STILL_SKIP_STATES)})
            nonroof += r["nonRoof"]
            print("  seed %d: %d bots, sim t %.0f s: %d roof touchdowns (%d lower ones ignored) [%.0f s wall, load %s s]" % (
                sd, r["brains"], r["simT"], len(r["roofs"]), r["nonRoof"], time.time() - t0, st.get("load_s")), flush=True)
            for e in r["roofs"]:
                e["seed"] = sd
                rows.append(e)
                print("      %s agl %.1f m @ (%.0f, %.0f) t %.0f %-7s left %s ground %s stillMax %.1f stillTot %.1f %s" % (
                    e["id"], e["agl0"], e["x"], e["z"], e["t0"], e["state0"], e["left"], e["ground"], e["stillMax"], e["stillTot"], e["ended"]), flush=True)
        errs = [e[1][:160] for e in s.page_errors][:4]
        nfail = len(s.failed)
    v.data["roofs"] = rows
    live = [e for e in rows if not e["killed"]]
    killed = [e for e in rows if e["killed"]]
    v.check("roof-landings", len(rows) >= MIN_ROOFS or None,
            "%d roof touchdowns (feet >= %.1f m over the terrain) in %d matches of %s (%d lower ones ignored); %d shot on the roof; floor %d" % (
                len(rows), ROOF_AGL, len(seeds), args.map, nonroof, len(killed), MIN_ROOFS), ">= %d" % MIN_ROOFS)
    # a landing that was still being watched when the run ended is judged only if it had been watched for EXIT_S (a bot that touches down at second 119 of 120 has had no time to leave)
    judged = [e for e in live if e["left"] is not None or e["obs"] >= EXIT_S]
    # the time on the roof that counts is the time NOT spent in ENGAGE / HEAL (the same exemption roof-standstill has): a bot that fights from a roof for 14 s and then drops off has not stalled
    # (Wave-7 completion round: seed 28, bot s40, 16 s on a 12.6 m roof, ENGAGE for 14 s). A landing that never left is judged by its dwell minus that time.
    eff = lambda e: (e["left"] if e["left"] is not None else e["obs"]) - e.get("skipTot", 0.0)
    slow = [e for e in judged if eff(e) > EXIT_S]
    still = [e for e in live if e["stillTot"] > STILL_S]
    v.check("roof-exit", not slow,
            "%d of %d roof touchdowns did not leave the roof within %.0f s%s" % (
                len(slow), len(judged), EXIT_S, (": (seed, bot, height, seconds to leave) %s" % [(e["seed"], e["id"], e["agl0"], e["left"]) for e in slow][:8]) if slow else ""),
            "exactly 0 (leave = feet %.1f m below the touchdown height)" % LEFT_DROP)
    v.check("roof-standstill", not still,
            "%d of %d roof touchdowns stood still for more than %.0f s in total before leaving (not counting %s)%s" % (
                len(still), len(live), STILL_S, "/".join(STILL_SKIP_STATES), (": (seed, bot, height, total stand s, longest burst s) %s" % [(e["seed"], e["id"], e["agl0"], e["stillTot"], e["stillMax"]) for e in still][:8]) if still else ""),
            "exactly 0")
    lefts = sorted(e["left"] for e in live if e["left"] is not None)
    v.info("roof dwell (information)", "seconds to leave the roof, sorted: %s; total stand, the six largest: %s; longest single burst, the six largest: %s; total standing time %.1f s over %d landings" % (
        lefts, sorted((e["stillTot"] for e in live), reverse=True)[:6], sorted((e["stillMax"] for e in live), reverse=True)[:6], sum(e["stillTot"] for e in live), len(live)))
    v.check("errors", not errs and not nfail, "page errors %s, failed requests %d" % (errs, nfail), "0 / 0")
    print("%s: %.0f s wall" % (GATE, time.time() - t_all), flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seeds", default=DEFAULT_SEEDS)
    ap.add_argument("--seconds", type=float, default=120.0, help="match seconds simulated per seed (touchdowns happen by ~60 s)")
    ap.add_argument("--watch", type=float, default=40.0, help="seconds a landing is followed before it is closed as 'not left'")
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
