#!/usr/bin/env python
"""worldlive - the live world a player walks, shoots and falls through: chests, every ramp, ranger towers, ramp sides, a fine fall scan and
the crosshair.  (Last Circle world-foundation plan, Wave 5; promoted by lane F1 from the Wave-5 lanes' scratch probes.)

    python _harness/worldlive.py --disk                      # the working copy (the integration run)
    python _harness/worldlive.py --rev 7f6a9fb2              # a frozen commit: the must-fail proof on Wave 4 (the registered negative control)
    python _harness/worldlive.py --disk --maps ashgrid --only ramps,towers
    python _harness/worldlive.py --disk --plant ramp-sides-open        # negative controls (each must exit 1)
    python _harness/worldlive.py --disk --plant ramp-solid
    python _harness/worldlive.py --disk --only rampsfine --maps ashgrid   # the five-seed fine ramp scan alone

One Chrome per map, one PRACTICE match (seed 7, the player + five range actors: nobody to kill the subject), probe_world.js:

  chests         every chest (the game's W.debugChests(), loot.js as shipped) rests within 0.10 m of the surface it is authored on
                 (terrain, a floor slab, a ramp, a container top); promoted from lane 5A's chestgap_all.py          (Wave 4: 0.20 m up)
  ramps-walk     EVERY ramp of the map is walked up from the ground and back down with the real mover (4 run-ups for up, 2 for down);
                 promoted from lane 5A's ramptest2.py                                                              (Wave 4: deepwood 8/14 up)
  ranger-towers  every ranger tower, foot -> deck by the ramps that serve it (a switchback when two do)             (Wave 4: 0/6)
  ramp-sides     walking into a ramp's side from outside never puts the capsule inside the plank (C-RAMP); promoted from lane 5C's
                 live5c.js. Wave 4 passed this (its sides were not walkable-through here), so the registered control is a PLANT:
                 `--plant ramp-sides-open` serves player.js with `K.rampBlocks` never blocking. Wave 8 (lane K3): the side is walked at 50, 30
                 and 70 % of the run (the mid-run walk alone found 6 clear approaches on the stage-B tree: could-not-judge, control disarmed)
  ramps-walk-fine  (L4-gates 2026-10-13, promoted from lane L2's stairs_all.py) the FINE ramp scan on EVERY ramp of 5 seeds x 3 maps (seeds 1, 7, 1234,
                 31337, 2026: the placement census seeds; one Chrome per map and a fresh PRACTICE match per seed): the real mover WALKS and SPRINTS up
                 (any of 4 run-ups climbs) and down from EVERY start phase (0.5, 0.9, 1.6 m from the top edge); a descent that was lifted (mantled onto
                 the floor above) is not clean. Seed 7 alone passed ramps-walk while seeds 1234 / 31337 had isla_viva and ashgrid ramps nobody could
                 climb or leave on the Wave-5 release
  falls-fine     a drop every 0.2 m from 5 to 60 m onto thin open slabs (>= 800 drops per map, 3 slabs): 0 pass-through; promoted from
                 lane 5C's live5c.js (collisioncheck's falls row samples 9 heights x 8 sub-tick phases)           (Wave 4: ~100 through)
  aim            the REAL fire() path at a near thin wall: the impact lands within 0.15 m of where the crosshair ray meets the wall
                 (>= 10 shots measured over the maps); promoted from lane 5C's live5c.js                          (Wave 4: up to 0.53 m, ADS 0.9 m)
                 Wave 8 (lane K3, furnished rooms): "the same wall" is a thin >= 2 m wall piece in the plane (a stair box / shelf flush with the wall
                 is no wall: a stance with one within 0.8 m is skipped); a box the camera ray or the muzzle -> reticle line meets before the wall
                 is the expected surface; a bullet stopped on another collider is judged by its distance from the muzzle -> reticle line (never
                 within 0.3 m of the muzzle). The 0.15 m bar is unchanged (stage-B tree: isla 5/12 over -> 0/12, the shelf shots 0.04 m off the line)
  errors         0 page / console / request / shader errors
(5C's all-direction hide area is collisioncheck's ramps-hide: the same definition, not duplicated.)

Exit 0 pass / 1 fail / 2 could-not-judge (a map would not load in time, a section measured too little). A row that measured nothing is
could-not-judge, never a pass.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "worldlive"
PROBE = os.path.join(C.HERE, "probe_world.js")
CHEST_OFF_MAX = 0.10
AIM_ERR_MAX = 0.15
AIM_MIN_SHOTS = 10
SIDES_MIN = 20
FALL_MIN_DROPS = 800
SECTIONS = ["chests", "ramps", "towers", "sides", "falls", "aim", "rampsfine"]
RAMP_SEEDS = [1, 7, 1234, 31337, 2026]       # the placement census seeds: the five-seed fine ramp scan (ramps-walk-fine)
# --plant -> (rows that must FAIL, sections to run). ramp-sides-open: player.js with K.rampBlocks never blocking (sides walk-through);
# ramp-solid: player.js where EVERY ramp blocks (no ramp can be walked onto), so the ramp walks fail everywhere
PLANTS = {"ramp-sides-open": ({"ramp-sides"}, {"sides"}), "ramp-solid": ({"ramps-walk-fine", "ranger-towers"}, {"rampsfine", "towers"})}
PLANT_REPLACE = {"ramp-sides-open": "continue;   /* PLANT ramp-sides-open: a ramp never blocks */",
                 "ramp-solid": "/* PLANT ramp-solid: every ramp blocks, none can be walked onto */"}


def f(v, nd=3):
    return "-" if v is None else ("%.*f" % (nd, v))


def install_plant(s, args, plant):
    """Serve a patched player.js (in memory) for the planted fault; needs --disk or --rev."""
    rel = "runtime/3d/royale/player.js"
    if args.rev:
        b = s.disk.git.read(rel)
    else:
        with open(os.path.join(C.ROOT, rel.replace("/", os.sep)), "rb") as fh:
            b = fh.read()
    if b is None:
        raise C.EnvFailure("plant: %s is not in the served tree" % rel)
    src = b.decode("utf-8")
    # blockedIn's C-RAMP test, in each spelling the mover has had: Wave 5 (boxed arguments) and Wave 7b S1 (blockedF hands the
    # same numbers to K.rampBlocksA in the RBA array; player.js ~1562). Exactly ONE of them must be present exactly once.
    anchors = ["if (!K.rampBlocks(c, x, z, yd, h, r, STEP_UP)) continue;", "if (!K.rampBlocksA(c, RBA)) continue;"]
    hits = [(a, src.count(a)) for a in anchors if src.count(a)]
    if len(hits) != 1 or hits[0][1] != 1:
        raise C.EnvFailure("plant %s: blockedIn ramp anchor not found exactly once in %s (%s; the plant needs the Wave-5+ mover)"
                           % (plant, rel, ", ".join("%r x%d" % (a, src.count(a)) for a in anchors)))
    anchor = hits[0][0]
    body = src.replace(anchor, PLANT_REPLACE[plant]).encode("utf-8")
    s.disk.overrides.append((lambda url: urllib.parse.urlparse(url).path.endswith("/" + rel),
                             lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    return "player.js served with ramp blocking disabled" if plant == "ramp-sides-open" else "player.js served with every ramp blocking"


def measure_map(args, map_id, src, only):
    res = {"map": map_id, "seed": args.seed}
    t0 = time.time()
    with C.Session(args, "worldlive_" + map_id, viewport={"width": 960, "height": 600}) as s:
        if args.plant:                    # BEFORE boot: player.js is a static import of the page, loaded at boot
            if not (args.disk or args.rev):
                raise C.EnvFailure("--plant needs --disk or --rev (it patches the served files)")
            res["plant"] = install_plant(s, args, args.plant)
            print("  [%s] plant %s: %s" % (map_id, args.plant, res["plant"]), flush=True)
        s.boot()
        s.freeze_loop()
        st = s.start_match(mode="practice", seed=args.seed, map_id=map_id)
        s.freeze_loop()
        res["load"] = st
        print("  [%s] loaded in %s s (%s)" % (map_id, st.get("load_s"), st.get("phaseAfterEnter")), flush=True)
        def install_probe():
            keys = s.js("() => { window.__LCWORLD__ = (" + src + ")(); return Object.keys(window.__LCWORLD__); }")
            if "ramps" not in keys:
                raise C.HarnessError("probe_world.js did not install: %s" % keys)
            s.js("() => window.__LC__.stepFrames(14, 1/60, false)")
        install_probe()

        def run(name, call, opt=None):
            if name not in only:
                return None
            t1 = time.time()
            r = s.js("(o) => window.__LCWORLD__.%s(o)" % call, opt or {})
            print("  [%s] %s %.0f s" % (map_id, name, time.time() - t1), flush=True)
            return r

        res["chests"] = run("chests", "chests")
        res["ramps"] = run("ramps", "ramps", {"max": 6 if args.quick else 1000})
        res["towers"] = run("towers", "towers")
        res["sides"] = run("sides", "sides")
        res["falls"] = run("falls", "fallsFine", {"slabs": 1 if args.quick else 3})
        res["aim"] = run("aim", "aim", {"shots": 12})
        if "rampsfine" in only:
            # the five-seed fine scan: this match first (it is loaded), then a fresh PRACTICE match per other seed in the same Chrome. LAST: it replaces the match.
            res["rampSeeds"] = {}
            for sd in [args.seed] + [x for x in RAMP_SEEDS if x != args.seed]:
                t1 = time.time()
                if sd != args.seed:
                    st2 = s.start_match(mode="practice", seed=sd, map_id=map_id)
                    s.freeze_loop()
                    install_probe()
                r = s.js("(o) => window.__LCWORLD__.rampsFine(o)", {"max": 6 if (args.quick or args.plant) else 1000})
                r["wallS"] = round(time.time() - t1, 1)
                res["rampSeeds"][str(sd)] = r
                print("  [%s] fine ramp scan seed %s: %d ramps, %d walks (%d up, %d down), %d failed walks on %d ramps (%.0f s)" % (map_id, sd, r["n"], r["walks"], r["upWalks"], r["downWalks"], r["failCount"], r["failedRamps"], time.time() - t1), flush=True)
        d = s.diagnostics()
        res["diag"] = {k: (x[:6] if isinstance(x, list) else x) for k, x in d.items()}
        res["problems"] = C.diag_problems(d, rig=False)
    res["wall_s"] = round(time.time() - t0, 1)
    return res


def judge(v, per_map, args, plant_rows):
    def chk(name, ok, detail, expect=None):
        if plant_rows is not None:
            if name in plant_rows:
                return v.check(name, ok, detail, expect)
            v.info(name + " (not counted in plant mode)", detail)
            return ok
        return v.check(name, ok, detail, expect)

    only = set(args.only.split(","))
    maps = list(per_map)

    if "chests" in only:
        rows = {m: r["chests"] for m, r in per_map.items() if r.get("chests")}
        n = sum(c["n"] for c in rows.values())
        if n < 20:
            chk("chests", None, "only %d chests read (W.debugChests)" % n)
        else:
            off = sum(c["off"] for c in rows.values())
            detail = "%d chests: %s" % (n, "; ".join("%s p50 %s min %s max %s, %d over %.2f m" % (m, f(c["gapP50"]), f(c["gapMin"]), f(c["gapMax"]), c["off"], CHEST_OFF_MAX) for m, c in rows.items()))
            if off:
                detail += " | e.g. " + json.dumps([c["offExamples"][:2] for c in rows.values() if c["off"]])[:300]
            chk("chests", off == 0, detail, "0 chests more than 0.10 m off their surface")

    if "ramps" in only:
        rows = {m: r["ramps"] for m, r in per_map.items() if r.get("ramps")}
        n = sum(r["n"] for r in rows.values())
        if n == 0:
            chk("ramps-walk", None, "no ramp on the maps")
        else:
            up, dn = sum(r["upOk"] for r in rows.values()), sum(r["downOk"] for r in rows.values())
            nu, sk = sum(r["upN"] for r in rows.values()), sum(r["skippedUp"] for r in rows.values())
            detail = "%d ramps: up %d/%d (%d skipped: foot in the sea / not on standable ground), down %d/%d (%s)" % (n, up, nu, sk, dn, n, "; ".join("%s up %d/%d down %d/%d" % (m, r["upOk"], r["upN"], r["downOk"], r["n"]) for m, r in rows.items()))
            fl = [dict(m=m, **x) for m, r in rows.items() for x in r["upFailed"][:3] + r["downFailed"][:3]]
            if fl:
                detail += " | failed: " + json.dumps([{k: x[k] for k in ("m", "mode", "dir", "minY", "maxY", "at", "startY", "best", "bestLow", "stuck")} for x in fl[:6]])[:700]
            chk("ramps-walk", up == nu and dn == n and nu > 0, detail, "every ramp climbed and descended")

    if "rampsfine" in only:
        rs = [(m, sd, r) for m, rm in per_map.items() for sd, r in sorted((rm.get("rampSeeds") or {}).items(), key=lambda kv: int(kv[0])) if r]
        seeds_by_map = {m: len(rm.get("rampSeeds") or {}) for m, rm in per_map.items()}
        n = sum(r["n"] for _, _, r in rs)
        walks = sum(r["walks"] for _, _, r in rs)
        if n == 0 or (any(k < len(RAMP_SEEDS) for k in seeds_by_map.values()) and not (args.quick or args.plant)):
            chk("ramps-walk-fine", None, "only %s seeds were scanned per map (need %d) / %d ramps" % (seeds_by_map, len(RAMP_SEEDS), n))
        else:
            failed = sum(r["failCount"] for _, _, r in rs)
            fr = sum(r["failedRamps"] for _, _, r in rs)
            skipped = sum(r["skippedUp"] for _, _, r in rs)
            per = "; ".join("%s: %s" % (m, ", ".join("s%s %d/%d ramps clean" % (sd, r["n"] - r["failedRamps"], r["n"]) for mm, sd, r in rs if mm == m)) for m in per_map)
            detail = "%d ramps over %d (map, seed) builds, %d walks (walk and sprint; up from any of 4 run-ups, down from every start phase; %d ramps not climbed from the ground: foot in the sea / on no standable ground): %d failed walks on %d ramps | %s" % (n, len(rs), walks, skipped, failed, fr, per)
            fl = [{"m": m, "seed": sd, **{k: x.get(k) for k in ("mode", "sprint", "off", "dir", "at", "minY", "maxY", "best", "bestLow", "lifted", "mant", "stuck")}} for m, sd, r in rs for x in r["fails"][:3]]
            if fl:
                detail += " | e.g. " + json.dumps(fl[:6])[:900]
            chk("ramps-walk-fine", failed == 0 and walks > 0, detail, "0 failed walks: every ramp of 5 seeds x 3 maps, walk and sprint, up and down from every phase")

    if "towers" in only:
        rows = {m: r["towers"] for m, r in per_map.items() if r.get("towers")}
        n = sum(r["n"] for r in rows.values())
        if n == 0:
            chk("ranger-towers", None, "no ranger tower deck found")
        else:
            ok = sum(r["ok"] for r in rows.values())
            detail = "%d/%d towers reached from the foot (%s)" % (ok, n, "; ".join("%s %d/%d" % (m, r["ok"], r["n"]) for m, r in rows.items()))
            if ok != n:
                detail += " | failed: " + json.dumps([x for r in rows.values() for x in r["failed"]][:3])[:600]
            chk("ranger-towers", ok == n, detail, "all")

    if "sides" in only:
        rows = {m: r["sides"] for m, r in per_map.items() if r.get("sides")}
        n = sum(r["tested"] for r in rows.values())
        into = sum(r["intoSolid"] for r in rows.values())
        if n < SIDES_MIN:
            chk("ramp-sides", None, "only %d side walks measured (need >= %d)" % (n, SIDES_MIN))
        else:
            detail = "%d clear-approach walks into a ramp's side (%d more skipped: a wall in the way), %d ended with the capsule inside the plank (%s)" % (n, sum(r.get("blockedApproach", 0) for r in rows.values()), into, "; ".join("%s %d/%d" % (m, r["intoSolid"], r["tested"]) for m, r in rows.items()))
            if into:
                detail += " | e.g. " + json.dumps([x for r in rows.values() for x in r["examples"]][:2])[:300]
            chk("ramp-sides", into == 0, detail, "0 walks inside the plank")

    if "falls" in only:
        rows = {m: r["falls"] for m, r in per_map.items() if r.get("falls")}
        low = [m for m, r in rows.items() if r["drops"] < (FALL_MIN_DROPS if not args.quick else 1)]
        if not rows or low:
            chk("falls-fine", None, "too few drops: %s" % ({m: r["drops"] for m, r in rows.items()}))
        else:
            thr = sum(r["through"] for r in rows.values())
            detail = "%d drops (every 0.2 m, 5-60 m): %d passed through a thin slab (%s); first pass at %s m" % (sum(r["drops"] for r in rows.values()), thr, "; ".join("%s %d/%d" % (m, r["through"], r["drops"]) for m, r in rows.items()), min([r["firstPassDrop"] for r in rows.values() if r["firstPassDrop"] is not None] or [None]))
            chk("falls-fine", thr == 0, detail, "0 pass-through")

    if "aim" in only:
        rows = {m: r["aim"] for m, r in per_map.items() if r.get("aim")}
        meas = sum(r["measured"] for r in rows.values())
        if meas < AIM_MIN_SHOTS:
            chk("aim", None, "only %d shots measured (need >= %d): %s" % (meas, AIM_MIN_SHOTS, {m: r["shots"] for m, r in rows.items()}))
        else:
            bad = sum(r["over015"] for r in rows.values())
            detail = "%d shots measured: %s" % (meas, "; ".join("%s %d shots (%d judged on a box between muzzle / camera and the wall), err max %s p50 %s, %d over %.2f m" % (m, r["measured"], r.get("onBlocker", 0), f(r["errMax"]), f(r["errP50"]), r["over015"], AIM_ERR_MAX) for m, r in rows.items() if r["measured"]))
            chk("aim", bad == 0, detail, "every impact within 0.15 m of the crosshair ray")

    probs = {m: r.get("problems") for m, r in per_map.items() if r.get("problems")}
    v.check("errors", not probs, "0 page / console / request / shader errors" if not probs else json.dumps(probs)[:500], "0") if plant_rows is None else v.info("errors (plant mode)", json.dumps(probs)[:300])


def main_fn(v, args):
    maps = [m for m in (args.maps or ",".join(C.MAPS)).split(",") if m]
    only = set(x for x in args.only.split(",") if x)
    bad = only - set(SECTIONS)
    if bad:
        raise C.HarnessError("unknown --only %s (known: %s)" % (",".join(sorted(bad)), ",".join(SECTIONS)))
    plant_rows = None
    if args.plant:
        if args.plant not in PLANTS:
            raise C.HarnessError("unknown --plant %r (known: %s)" % (args.plant, ", ".join(sorted(PLANTS))))
        plant_rows, plant_only = PLANTS[args.plant]
        only = set(plant_only) if args.only == ",".join(SECTIONS) else only
        print("%s: PLANT MODE %s - only %s count; exit 1 = the planted fault was detected" % (GATE, args.plant, sorted(plant_rows)), flush=True)
    args.only = ",".join(sorted(only))
    with open(PROBE, encoding="utf-8") as fh:
        src = fh.read()
    v.data["seed"] = args.seed
    v.data["plant"] = args.plant
    per_map = {}
    for m in maps:
        try:
            print("%s: measuring %s (seed %d)" % (GATE, m, args.seed), flush=True)
            per_map[m] = measure_map(args, m, src, only)
        except C.EnvFailure as e:
            v.cnj("%s: environment" % m, str(e))
        except Exception as e:
            msg = str(e)
            if "startMatch" in msg and ("still loading" in msg or "did not settle" in msg):
                v.cnj("%s: map load" % m, msg[:300])
            elif "Page.evaluate:" in msg and "/runtime/" in msg:
                v.check("%s: game threw inside a probe" % m, False, " | ".join(msg.splitlines()[:6])[:700])
            else:
                v.cnj("%s: harness exception" % m, msg.splitlines()[0][:300] if msg else type(e).__name__)
                import traceback
                print(traceback.format_exc()[-1800:], flush=True)
    v.data["maps"] = per_map
    if per_map:
        judge(v, per_map, args, plant_rows)
    else:
        v.cnj("measured", "no map could be measured")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=None, help="comma list (default: all three)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", default=",".join(SECTIONS), help="comma list of sections: " + ",".join(SECTIONS))
    ap.add_argument("--quick", action="store_true", help="6 ramps, 1 slab per map (development)")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANTS)))
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
