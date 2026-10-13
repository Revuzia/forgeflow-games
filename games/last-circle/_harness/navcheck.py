#!/usr/bin/env python
"""navcheck - do the bots get through doors, up stairs, and stop grinding walls?  (world-foundation plan, section 4, lane 5D)

    python _harness/navcheck.py --disk                       # the working copy (the integration run)
    python _harness/navcheck.py --rev 7f6a9fb2               # a frozen commit (the must-fail proof on Wave 4)
    python _harness/navcheck.py --disk --maps ashgrid --only rooms
    python _harness/navcheck.py --disk --only rooms --plant nav-l3          # negative controls (each must exit 1)
    python _harness/navcheck.py --disk --only ticks --plant raw-strafe
    python _harness/navcheck.py --disk --only ticks --plant heal-yaw

One Chrome per map (isla_viva, ashgrid, deepwood; the map load is 5-200 s on this shared box and a load that times out is
could-not-judge). Per map, two matches:
  1. a whole storm-on STANDARD match through fastForward (probe_ticks.js): the all-state tick metric. On every fixed tick, for every
     bot that wants to move: did it move? labelled by state@location (location = out | in_ground | in_upper), with the run lengths of
     blocked ticks (>= 0.5 s is a grind a player SEES) and the direction of every healing tick relative to the known threat.
  2. a throwaway match for the door-reachability walk (probe_rooms.js): every ROOM on the map is found from the colliders, then the
     REAL bot controller + physics walks street -> room and room -> street (30 s each way); the game's own planner (bots.js
     debugNav) is asked for the same trips; and long street -> street trips.

Rows (thresholds from the plan, section 4; baselines re-measured on 7f6a9fb2 in lane 5D's REPORT.md):
  ground-rooms        ground-floor rooms: walk in >= 96 % and walk out >= 96 %   (plan 98 %, Wave 4: 53/53 in, 52/53 out on 53 rooms;
                      on the 256 rooms this gate walks the Wave-4 build is 254/256 in, 249/256 out = 97.3 %: the row holds that baseline)
  upper-rooms         upper floors (>= 40 rooms across the 3 maps): walk in >= 85 % and out >= 85 %  (Wave 4: 6/19 in, 9/19 out)
  top-floor-paths     the planner finds a path from open ground to the 4th storey of a tower >= 95 % (NAV_L 3 runs out of layers)
  long-trips          street -> street trips of 120-180 m >= 95 %                                    (Wave 4: 30/30)
  engage-indoor       ENGAGE ticks indoors: blocked (runs >= 6 ticks) <= 1.5 %                                           (raw strafe into walls fails it)
  heal-indoor         HEAL ticks indoors: blocked (runs >= 6 ticks) <= 1.5 %
  visible-grind       blocked runs >= 0.5 s <= 1.5 % of indoor movement ticks                         (Wave 4: 5.26 %)
  outdoor-blocked     outdoor blocked share has not regressed vs the Wave-4 baseline (0.72 % on 6 matches; limit 1.5 x)
  heal-direction      heal ticks moving TOWARD a known threat <= 5 %                                  (Wave 4: 34 %; the dead a.yaw write)
A row with too few samples is could-not-judge (exit 2), never a pass. Not implemented: "phantom ramp walls <= 2 %" (the plan makes it
conditional on lane 5B shipping a marched wallAhead probe; the research version re-implements Wave 4's wallAhead formula and so
cannot judge a changed bots.js).

Negative controls (--plant; the served files are patched IN MEMORY by a page route, no file is edited; needs --disk or --rev):
  nav-l3      bots.js served with `const NAV_L = 3;`         -> top-floor-paths / upper-rooms must fail
  raw-strafe  every ENGAGE bot's input overwritten, after the brains and before the mover (a hook added to ffg_royale3d.js's simTick),
              with the Wave-4 raw fight input: an unconditional strafe plus a straight advance / retreat along the line to the
              target, no look at the walls                   -> engage-indoor must fail
  heal-yaw    every healing bot's input yaw frozen at its heal-start value and mz = -1 (the Wave-4 dead `a.yaw` write: the retreat
              follows the OLD input yaw)                    -> heal-direction must fail
In plant mode only the designated rows count: exit 1 = the planted fault was detected, exit 0 = the gate is blind to it.

Exit 0 pass / 1 fail / 2 could-not-judge.
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

GATE = "navcheck"
ROOMS_JS = os.path.join(C.HERE, "probe_rooms.js")
TICKS_JS = os.path.join(C.HERE, "probe_ticks.js")
# (tick-match seed, walk-match seeds) per map: seeds the research lane used on that map
SEEDS = {"isla_viva": (7, [7, 1]), "ashgrid": (5, [11, 5]), "deepwood": (13, [13, 23])}

GROUND_MIN = 0.96
GROUND_PLAN = 0.98
UPPER_MIN = 0.85
UPPER_ROOMS_MIN = 40
TOP_PATH_MIN = 0.95
TOP_PATH_N_MIN = 10
LONG_MIN = 0.95
LONG_N_MIN = 8
BLOCKED_MAX = 0.015   # was 0.03 on the per-tick count; the count is now blocked ticks inside runs of >= 6 ticks (blockedRunSL), so the bar is halved: final 0.53 %, raw-strafe 10.4 %, Wave 4 20.5 %
GRIND_MAX = 0.015
HEAL_TOWARD_MAX = 0.05
# outdoor blocked share (blocked ticks / movement-intent ticks outdoors): the Wave-4 baseline is measured by this gate on 7f6a9fb2
# (REPORT.md); the row is "no regression" so the limit is 1.5 x that baseline (floor 0.5 %)
OUTDOOR_BASE = 0.0072
OUTDOOR_MAX = max(0.005, OUTDOOR_BASE * 1.5)
MIN_ENGAGE_INTENT = 300
MIN_HEAL_INTENT = 150
MIN_HEAL_THREAT = 300
MIN_INDOOR_INTENT = 3000

PLANT_ROWS = {"nav-l3": {"top-floor-paths", "upper-rooms"}, "raw-strafe": {"engage-indoor"}, "heal-yaw": {"heal-direction"},
              "nav-l6": {"top-floor-paths"}}   # nav-l6 = a POSITIVE control for calibration (Wave-4 bots.js with 6 layers): its row must PASS
PLANT_ONLY = {"nav-l3": "rooms", "raw-strafe": "ticks", "heal-yaw": "ticks", "nav-l6": "rooms"}

# the hook the raw-strafe / heal-yaw plants ride on: simTick calls it between the brains and the mover
HOOK_ANCHOR = "botsMod.update(W, h);"
HOOK_TEXT = "botsMod.update(W, h); if (window.__LC_PLANT__) window.__LC_PLANT__(W, h);"
PLANT_INIT = r"""
(() => {
  window.__LC_PLANT_MODE__ = %s;
  const stale = new Map();
  let pm = null, pb = [];
  window.__LC_PLANT__ = (W, h) => {
    const mode = window.__LC_PLANT_MODE__; if (!mode) return;
    if (pm !== W.match || !pb.length) { pm = W.match; pb = (window.__LC__ && window.__LC__.brains) ? window.__LC__.brains() : []; stale.clear(); }
    for (const b of pb) {
      const a = b.actor; if (!a.alive || a.gliding) continue;
      const inp = a.input;
      if (mode === 'raw-strafe' && b.state === 'ENGAGE') {
        // the Wave-4 fight input: an unconditional strafe plus a raw advance / retreat along the line to the target (yaw faces it),
        // with no look at the walls
        const sd = (b.bb && b.bb.strafeDir) || (a.id %% 2 ? 1 : -1), tp = b.bb && b.bb.targetPos;
        let mz = 0;
        if (tp) { const d = Math.hypot(tp.x - a.pos.x, tp.z - a.pos.z); mz = d > 37 ? 1 : d < 12.5 ? -0.7 : 0; }
        inp.mx = sd; inp.mz = mz; inp.jump = false;
      } else if (mode === 'heal-yaw' && b.state === 'HEAL' && a.healing) {
        if (!stale.has(a.id)) stale.set(a.id, inp.yaw);
        inp.yaw = stale.get(a.id); inp.mz = -1; inp.mx = 0;
      } else if (stale.has(a.id) && !(b.state === 'HEAL' && a.healing)) stale.delete(a.id);
    }
  };
})();
"""


def f(v, nd=2):
    return "-" if v is None else ("%.*f" % (nd, v))


def split_lib(path_rooms):
    src = open(path_rooms, encoding="utf-8").read()
    a = src.index("// @@NAVLIB-BEGIN")
    b = src.index("// @@NAVLIB-END")
    lib = src[src.index("\n", a) + 1:b]
    body = src[src.index("async (", b):]
    return lib, body


def wrap_rooms(lib, body):
    return "(arg) => { " + lib + "\n return (" + body + ")(arg); }"


def wrap_ticks():
    src = open(TICKS_JS, encoding="utf-8").read()
    return "(arg) => { return (" + src[src.index("async ("):] + ")(arg); }"


def install_plant(s, args, plant):
    """Serve a patched bots.js / ffg_royale3d.js (in memory) for the planted fault."""
    def orig(rel):
        if args.rev:
            b = s.disk.git.read(rel)
        else:
            with open(os.path.join(C.ROOT, rel.replace("/", os.sep)), "rb") as fh:
                b = fh.read()
        if b is None:
            raise C.EnvFailure("plant: %s is not in the served tree" % rel)
        return b.decode("utf-8")

    def serve(rel, text):
        body = text.encode("utf-8")
        s.disk.overrides.append((lambda url, rel=rel: urllib.parse.urlparse(url).path.endswith("/" + rel),
                                 lambda route, body=body: route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))

    if plant in ("nav-l3", "nav-l6"):
        rel = "runtime/3d/royale/bots.js"
        src = orig(rel)
        layers = plant[-1]
        new, n = re.subn(r"const NAV_L = \d+;", "const NAV_L = %s;" % layers, src, count=1)
        if n != 1:
            raise C.EnvFailure("plant %s: `const NAV_L = <n>;` not found in %s" % (plant, rel))
        serve(rel, new)
        return "bots.js served with const NAV_L = %s (was %s)" % (layers, re.search(r"const NAV_L = (\d+);", src).group(1))
    rel = "runtime/3d/ffg_royale3d.js"
    src = orig(rel)
    if src.count(HOOK_ANCHOR) != 1:
        raise C.EnvFailure("plant %s: anchor %r found %d times in %s" % (plant, HOOK_ANCHOR, src.count(HOOK_ANCHOR), rel))
    serve(rel, src.replace(HOOK_ANCHOR, HOOK_TEXT))
    s.context.add_init_script(PLANT_INIT % json.dumps(plant))
    return "ffg_royale3d.js served with a post-brains hook; mode %s" % plant


def measure_map(v, args, map_id, lib, rooms_body, ticks_src):
    res = {"map": map_id}
    t0 = time.time()
    tick_seed, walk_seeds = SEEDS[map_id]
    if args.tick_seed:
        tick_seed = args.tick_seed
    if args.walk_seeds:
        walk_seeds = [int(x) for x in args.walk_seeds.split(",")]
    walk_seeds = walk_seeds[:args.walk_matches]
    only = args.only
    with C.Session(args, "nav_" + map_id, viewport={"width": 960, "height": 600}) as s:
        if args.plant:
            if not (args.disk or args.rev):
                raise C.EnvFailure("--plant needs --disk or --rev (it patches the served files)")
            res["plant"] = install_plant(s, args, args.plant)
            print("  [%s] plant %s: %s" % (map_id, args.plant, res["plant"]), flush=True)
        s.boot()
        s.freeze_loop()
        if only in (None, "ticks"):
            res["ticks"] = []
            for k in range(args.tick_matches):
                seed = tick_seed + k
                st = s.start_match("standard", seed, map_id, enter=True)
                s.freeze_loop()
                print("  [%s] tick match seed %d loaded in %s s" % (map_id, seed, st.get("load_s")), flush=True)
                t1 = time.time()
                r = s.page.evaluate(ticks_src, {"seconds": 1000})
                print("  [%s] ticks seed %d: %s s wall, sim %s s, indoor intent %s, blocked %s" % (
                    map_id, seed, round(time.time() - t1), r["summary"]["simT"], sum(r["intent"].get(k2, 0) for k2 in ("in_ground", "in_upper")),
                    sum(r["blocked"].get(k2, 0) for k2 in ("in_ground", "in_upper"))), flush=True)
                res["ticks"].append(r)
        if only in (None, "rooms"):
            res["rooms"] = []
            for seed in walk_seeds:
                st = s.start_match("quick", seed, map_id, enter=True)
                s.freeze_loop()
                print("  [%s] walk match seed %d loaded in %s s" % (map_id, seed, st.get("load_s")), flush=True)
                t1 = time.time()
                opt = {"walk": True, "maxUpper": args.max_upper, "maxGround": args.max_ground, "budgetS": 30, "longTrips": args.long_trips, "seedSalt": 0}
                r = s.page.evaluate(wrap_rooms(lib, rooms_body), opt)
                w = r.get("walk", {})
                print("  [%s] rooms seed %d: %s s wall; rooms %s; ground in/out %s/%s upper in/out %s/%s top %s/%s long %s/%s" % (
                    map_id, seed, round(time.time() - t1), r.get("roomsByLevel"), json.dumps(w.get("groundIn")), json.dumps(w.get("groundOut")),
                    json.dumps(w.get("upperIn")), json.dumps(w.get("upperOut")), json.dumps(w.get("topIn")), json.dumps(w.get("topOut")),
                    (w.get("long") or {}).get("ok"), (w.get("long") or {}).get("n")), flush=True)
                res["rooms"].append(r)
        d = s.diagnostics()
        res["problems"] = C.diag_problems(d, rig=False)
        res["diag"] = {k: (x[:6] if isinstance(x, list) else x) for k, x in d.items()}
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

    def cnj(name, why):
        if plant_rows is not None and name not in plant_rows:
            v.info(name + " (not counted in plant mode)", why)
            return None
        return v.cnj(name, why)

    maps = list(per_map)
    for m, r in per_map.items():
        if r.get("problems"):
            v.check("%s: errors" % m, False, json.dumps(r["problems"])[:400]) if plant_rows is None else v.info("%s: errors (plant mode)" % m, json.dumps(r["problems"])[:300])

    # ---------------- rooms
    walks = [(m, x) for m in maps for x in (per_map[m].get("rooms") or [])]
    if walks:
        def tot(level, way):
            n = ok = 0
            for _, x in walks:
                e = (x.get("walk") or {}).get(level + way) or {}
                n += e.get("n", 0); ok += e.get("ok", 0)
            return n, ok
        gin, gout = tot("ground", "In"), tot("ground", "Out")
        uin, uout = tot("upper", "In"), tot("upper", "Out")
        tin, tout = tot("top", "In"), tot("top", "Out")
        if gin[0] and gout[0]:
            okg = gin[1] / gin[0] >= GROUND_MIN and gout[1] / gout[0] >= GROUND_MIN
            chk("ground-rooms", okg, "ground floors: in %d/%d (%.1f%%), out %d/%d (%.1f%%); plan target %d%%, this gate holds the Wave-4 baseline (99.2%% in / 97.3%% out on 256 rooms) minus 1.3 points" % (
                gin[1], gin[0], 100.0 * gin[1] / gin[0], gout[1], gout[0], 100.0 * gout[1] / gout[0], 100 * GROUND_PLAN), ">= 96 % each way (no regression; plan 98 %)")
        else:
            cnj("ground-rooms", "no ground-floor room was walked")
        if uin[0] >= UPPER_ROOMS_MIN:
            oku = uin[1] / uin[0] >= UPPER_MIN and uout[1] / uout[0] >= UPPER_MIN
            fails = []
            for m, x in walks:
                for fl in ((x.get("walk") or {}).get("fails") or [])[:3]:
                    fails.append("%s s%s %s" % (m, x.get("seed"), json.dumps({k: fl["room"].get(k) for k in ("agl", "poi", "planIn", "planExit")}) + " in:%s out:%s" % (fl["in"]["ok"], fl["out"]["ok"])))
            chk("upper-rooms", oku, "upper floors (%d rooms): in %d/%d (%.1f%%), out %d/%d (%.1f%%)%s" % (
                uin[0], uin[1], uin[0], 100.0 * uin[1] / uin[0], uout[1], uout[0], 100.0 * uout[1] / max(1, uout[0]), (" ; e.g. " + " | ".join(fails[:4])) if not oku else ""), ">= 85 % each way, >= 40 rooms")
        else:
            cnj("upper-rooms", "only %d upper rooms were walked across %d maps (need >= %d): rerun with --walk-matches 2 or a larger --max-upper" % (uin[0], len(maps), UPPER_ROOMS_MIN))
        v.info("top floors walked", "in %d/%d, out %d/%d" % (tin[1], tin[0], tout[1], tout[0]))
        # planner: top floors
        tried = ok = 0
        for _, x in walks:
            t = ((x.get("plan") or {}).get("byLevel") or {}).get("top") or {}
            tried += t.get("inTried", 0); ok += t.get("inOk", 0)
        if tried >= TOP_PATH_N_MIN:
            chk("top-floor-paths", ok / tried >= TOP_PATH_MIN, "planner path from open ground to the 4th storey: %d/%d (%.1f%%)" % (ok, tried, 100.0 * ok / tried), ">= 95 %")
        else:
            cnj("top-floor-paths", "only %d top-floor planner queries (need >= %d)" % (tried, TOP_PATH_N_MIN))
        ln = lo = 0
        for _, x in walks:
            lg = (x.get("walk") or {}).get("long") or {}
            ln += lg.get("n", 0); lo += lg.get("ok", 0)
        if ln >= LONG_N_MIN:
            chk("long-trips", lo / ln >= LONG_MIN, "street -> street trips of 120-180 m: %d/%d" % (lo, ln), ">= 95 %")
        else:
            cnj("long-trips", "only %d long trips were walked (need >= %d)" % (ln, LONG_N_MIN))
        for m, x in walks:
            pl = x.get("plan") or {}
            v.info("planner %s seed %s" % (m, x.get("seed")), "rooms %s; exit ok %s/%s; inbound %s/%s; pockets %s; doors %s (headroom<1.85: %s, width<0.95: %s)" % (
                json.dumps(x.get("roomsByLevel")), pl.get("exitOk"), pl.get("rooms"), pl.get("inOk"), pl.get("inTried"), x.get("pockets"),
                (x.get("doors") or {}).get("n"), (x.get("doors") or {}).get("headroomLow"), (x.get("doors") or {}).get("widthLow")))

    # ---------------- ticks
    tk = [(m, t) for m in maps for t in (per_map[m].get("ticks") or [])]
    if tk:
        IN = ("in_ground", "in_upper")

        def sl(key, st):
            return sum(t[key].get(st + "@" + k, 0) for _, t in tk for k in IN)
        intent_in = sum(t["intent"].get(k, 0) for _, t in tk for k in IN)
        blocked_in = sum(t["blocked"].get(k, 0) for _, t in tk for k in IN)
        grind_in = sum(t["runTicksGE30"].get(k, 0) for _, t in tk for k in IN)
        intent_out = sum(t["intent"].get("out", 0) for _, t in tk)
        blocked_out = sum(t["blocked"].get("out", 0) for _, t in tk)
        ei, eb = sl("intentSL", "ENGAGE"), sl("blockedRunSL", "ENGAGE")
        hi, hb = sl("intentSL", "HEAL"), sl("blockedRunSL", "HEAL")
        if ei >= MIN_ENGAGE_INTENT:
            chk("engage-indoor", eb / ei <= BLOCKED_MAX, "ENGAGE ticks indoors: %d of %d blocked (%.2f%%)" % (eb, ei, 100.0 * eb / ei), "<= 1.5 %")
        else:
            cnj("engage-indoor", "only %d indoor ENGAGE movement ticks (need >= %d): add --tick-matches" % (ei, MIN_ENGAGE_INTENT))
        if hi >= MIN_HEAL_INTENT:
            chk("heal-indoor", hb / hi <= BLOCKED_MAX, "HEAL ticks indoors: %d of %d blocked (%.2f%%)" % (hb, hi, 100.0 * hb / hi), "<= 1.5 %")
        else:
            cnj("heal-indoor", "only %d indoor HEAL movement ticks (need >= %d): add --tick-matches" % (hi, MIN_HEAL_INTENT))
        if intent_in >= MIN_INDOOR_INTENT:
            chk("visible-grind", grind_in / intent_in <= GRIND_MAX, "blocked runs >= 0.5 s: %d of %d indoor movement ticks (%.2f%%); all indoor blocked %.2f%%" % (grind_in, intent_in, 100.0 * grind_in / intent_in, 100.0 * blocked_in / intent_in), "<= 1.5 %")
        else:
            cnj("visible-grind", "only %d indoor movement ticks (need >= %d)" % (intent_in, MIN_INDOOR_INTENT))
        if intent_out >= 20000:
            chk("outdoor-blocked", blocked_out / intent_out <= OUTDOOR_MAX, "outdoor blocked %d of %d movement ticks (%.2f%%; Wave-4 baseline %.2f%%, limit %.2f%%)" % (blocked_out, intent_out, 100.0 * blocked_out / intent_out, 100 * OUTDOOR_BASE, 100 * OUTDOOR_MAX), "<= 1.5 x the Wave-4 baseline")
        else:
            cnj("outdoor-blocked", "only %d outdoor movement ticks" % intent_out)
        wt = sum(t["heal"]["withThreat"] for _, t in tk)
        tw = sum(t["heal"]["toward"] for _, t in tk)
        aw = sum(t["heal"]["away"] for _, t in tk)
        if wt >= MIN_HEAL_THREAT:
            chk("heal-direction", tw / wt <= HEAL_TOWARD_MAX, "heal ticks with a known threat: toward %d, away %d, sideways %d, still %d of %d (toward %.1f%%)" % (
                tw, aw, sum(t["heal"]["side"] for _, t in tk), sum(t["heal"]["still"] for _, t in tk), wt, 100.0 * tw / wt), "toward <= 5 %")
        else:
            cnj("heal-direction", "only %d heal ticks with a known threat (need >= %d): add --tick-matches" % (wt, MIN_HEAL_THREAT))
        # information: per state@location table
        keys = {}
        for _, t in tk:
            for k, n in t["intentSL"].items():
                a = keys.setdefault(k, [0, 0, 0]); a[0] += n; a[1] += t["blockedSL"].get(k, 0); a[2] += t["runTicksGE30SL"].get(k, 0)
        rows = sorted(keys.items(), key=lambda kv: -kv[1][0])[:18]
        v.info("state@location (intent / blocked % / grind-run %)", " ; ".join("%s %d / %.1f%% / %.1f%%" % (k, a[0], 100.0 * a[1] / max(1, a[0]), 100.0 * a[2] / max(1, a[0])) for k, a in rows))
        v.info("blocked causes", json.dumps({k: sum(t["cause"].get(k, 0) for _, t in tk) for k in sorted({k for _, t in tk for k in t["cause"]})}))
        v.info("jumps by state@location (fight hops under a roof)", json.dumps({k: sum(t["jumpsSL"].get(k, 0) for _, t in tk) for k in sorted({k for _, t in tk for k in t["jumpsSL"]}) if "@in_" in k}))
        for m, t in tk:
            v.info("tick match %s seed %s" % (m, t["summary"]["seed"]), json.dumps(t["summary"]))


def main_fn(v, args):
    maps = [m for m in (args.maps or ",".join(C.MAPS)).split(",") if m]
    lib, rooms_body = split_lib(ROOMS_JS)
    ticks_src = wrap_ticks()
    plant_rows = None
    if args.plant:
        if args.plant not in PLANT_ROWS:
            raise C.HarnessError("unknown --plant %r (known: %s)" % (args.plant, ", ".join(sorted(PLANT_ROWS))))
        plant_rows = PLANT_ROWS[args.plant]
        if not args.only:
            args.only = PLANT_ONLY[args.plant]
        print("%s: PLANT MODE %s - only %s count; exit 1 = the planted fault was detected" % (GATE, args.plant, sorted(plant_rows)), flush=True)
    per_map = {}
    for m in maps:
        try:
            print("%s: measuring %s" % (GATE, m), flush=True)
            per_map[m] = measure_map(v, args, m, lib, rooms_body, ticks_src)
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
    v.data["plant"] = args.plant
    if per_map:
        judge(v, per_map, args, plant_rows)
    else:
        v.cnj("measured", "no map could be measured")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=None, help="comma list (default: all three)")
    ap.add_argument("--only", choices=["ticks", "rooms"], default=None, help="run one half only")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--tick-seed", type=int, default=None, help="override the standard-match seed of the tick metric (all maps)")
    ap.add_argument("--tick-matches", type=int, default=2, help="standard matches per map for the tick metric (seed, seed+1, ...)")
    ap.add_argument("--walk-seeds", default=None, help="comma list of walk-match seeds (all maps)")
    ap.add_argument("--walk-matches", type=int, default=2, help="walk matches per map (the first N seeds of the map's list)")
    ap.add_argument("--max-upper", type=int, default=40, help="upper-floor rooms walked per match")
    ap.add_argument("--max-ground", type=int, default=60, help="ground-floor rooms walked per match")
    ap.add_argument("--long-trips", type=int, default=4, help="long street trips per walk match")
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
