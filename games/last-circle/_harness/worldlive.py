#!/usr/bin/env python
"""worldlive - the live world a player walks, shoots and falls through: chests, every ramp, ranger towers, ramp sides, a fine fall scan and
the crosshair.  (Last Circle world-foundation plan, Wave 5; promoted by lane F1 from the Wave-5 lanes' scratch probes.)

    python _harness/worldlive.py --disk                      # the working copy (the integration run)
    python _harness/worldlive.py --rev 7f6a9fb2              # a frozen commit: the must-fail proof on Wave 4 (the registered negative control)
    python _harness/worldlive.py --disk --maps ashgrid --only ramps,towers
    python _harness/worldlive.py --disk --plant ramp-sides-open        # negative control (must exit 1)

One Chrome per map, one PRACTICE match (seed 7, the player + five range actors: nobody to kill the subject), probe_world.js:

  chests         every chest (the game's W.debugChests(), loot.js as shipped) rests within 0.10 m of the surface it is authored on
                 (terrain, a floor slab, a ramp, a container top); promoted from lane 5A's chestgap_all.py          (Wave 4: 0.20 m up)
  ramps-walk     EVERY ramp of the map is walked up from the ground and back down with the real mover (4 run-ups for up, 2 for down);
                 promoted from lane 5A's ramptest2.py                                                              (Wave 4: deepwood 8/14 up)
  ranger-towers  every ranger tower, foot -> deck by the ramps that serve it (a switchback when two do)             (Wave 4: 0/6)
  ramp-sides     walking into a ramp's side from outside never puts the capsule inside the plank (C-RAMP); promoted from lane 5C's
                 live5c.js. Wave 4 passed this (its sides were not walkable-through here), so the registered control is a PLANT:
                 `--plant ramp-sides-open` serves player.js with `K.rampBlocks` never blocking
  falls-fine     a drop every 0.2 m from 5 to 60 m onto thin open slabs (>= 800 drops per map, 3 slabs): 0 pass-through; promoted from
                 lane 5C's live5c.js (collisioncheck's falls row samples 9 heights x 8 sub-tick phases)           (Wave 4: ~100 through)
  aim            the REAL fire() path at a near thin wall: the impact lands within 0.15 m of where the crosshair ray meets the wall
                 (>= 10 shots measured over the maps); promoted from lane 5C's live5c.js                          (Wave 4: up to 0.53 m, ADS 0.9 m)
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
SECTIONS = ["chests", "ramps", "towers", "sides", "falls", "aim"]
PLANTS = {"ramp-sides-open": {"ramp-sides"}}


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
    anchor = "if (!K.rampBlocks(c, x, z, yd, h, r, STEP_UP)) continue;"
    if src.count(anchor) != 1:
        raise C.EnvFailure("plant %s: anchor %r found %d times in %s (the plant needs the Wave-5 mover)" % (plant, anchor, src.count(anchor), rel))
    body = src.replace(anchor, "continue;   /* PLANT ramp-sides-open: a ramp never blocks */").encode("utf-8")
    s.disk.overrides.append((lambda url: urllib.parse.urlparse(url).path.endswith("/" + rel),
                             lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    return "player.js served with ramp blocking disabled"


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
        keys = s.js("() => { window.__LCWORLD__ = (" + src + ")(); return Object.keys(window.__LCWORLD__); }")
        if "ramps" not in keys:
            raise C.HarnessError("probe_world.js did not install: %s" % keys)
        s.js("() => window.__LC__.stepFrames(14, 1/60, false)")

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
            detail = "%d shots measured: %s" % (meas, "; ".join("%s %d shots, err max %s p50 %s, %d over %.2f m" % (m, r["measured"], f(r["errMax"]), f(r["errP50"]), r["over015"], AIM_ERR_MAX) for m, r in rows.items() if r["measured"]))
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
        plant_rows = PLANTS[args.plant]
        only = {"sides"} if args.only == ",".join(SECTIONS) else only
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
