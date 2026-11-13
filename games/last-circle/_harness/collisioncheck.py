#!/usr/bin/env python
"""collisioncheck - does what the player collides with match what the player sees?  (world-foundation plan, section 4, lane 5D)

    python _harness/collisioncheck.py --disk                    # the working copy (the integration run)
    python _harness/collisioncheck.py --rev 7f6a9fb2            # a frozen commit: the must-fail proof on Wave 4 (the registered negative control)
    python _harness/collisioncheck.py --disk --maps isla_viva --quick
    python _harness/collisioncheck.py --disk --plant container-narrow    # negative controls (each must exit 1)
    python _harness/collisioncheck.py --disk --plant rocks-small

One Chrome per map (map load 58-197 s on this shared box; a load that times out is could-not-judge, never a pass). In a PRACTICE
match (the player is the only actor) it drives the game's REAL movement (stepActor through C.fastForward) and the game's REAL
segment test (SIM.segmentColliders) against the DRAWN geometry (the instanced GLB triangles), seed 7, via probe_collision.js; the
rotated-wall rows come from the Node census (placement_census.mjs: every box maps.js draws vs the colliders that stand for it).

  clip           per prop kind, per map: the body capsule clips <= 0.10 m into the drawn mesh at p95, and > 25 cm in < 5 % of instances
                 (Wave 4: 80-92 % for palm, birch, car, container, barrel). SOFT foliage (a sub-mesh whose material is named green / leaf /
                 foliage / needle: a pine's skirt of needles reaches the ground) is walk-through and shoot-through in every shipped battle
                 royale, so it is left out of the drawn body; a trunk collider is judged against the trunk
  gap            per kind: the widest standoff between collider and drawn mesh in EXCESS of what the tightest axis-aligned box of each drawn
                 body would have, p95 <= 0.15 m (the C-COLL contract keeps boxes; a box cannot hug a round or leaning body)
  sprints        real sprints into props from 8 angles: the body ends > 10 cm inside the drawn mesh in <= 2 % of runs (Wave 4: 52 %); a point
                 counts only while the body's top is at least the mover's step height (0.55 m, player.js STEP_UP) above the feet - a body under
                 that is a step, never an obstacle (stepping onto a low rock is not walking through it; Wave 7 lane 7H: this replaces the
                 older 'feet below top - 0.10 m', which only covered standing ON a body) - and not in a mantle
  container-lean (L4-gates 2026-10-13) containers, level (< 1.5 deg off vertical) and leaned (>= 1.5 deg: maps.js lays a container on a slope at
                 up to 8 deg while its collider stays level) apart: clip p95 <= 0.10 m and > 25 cm in < 5 % in each group on every map. The all-kind
                 clip row has the same limits; this row names the leaned minority so it cannot hide in an all-instance p95 (Wave 5 release: ashgrid
                 containers p95 0.15 m, 6 of 64 container sprints end inside). PER MAP since Wave 7b stage B (lane S3): a map in --lean-optional-maps
                 (default isla_viva,deepwood: no prop containers there, the yard is Savanna's) may measure none (information); any other map of the run
                 measuring < 5 containers makes the row could-not-judge ("container-lean required maps"). An all-optional run (Isla Viva alone) prints
                 the row as not applicable instead of could-not-judge, so Isla Viva can join collisioncheck_seeds
  sprints-rocks  (L4-gates 2026-10-13) real sprints into ROCKS end > 10 cm inside the drawn mesh in <= 1 % of runs (192 runs: at most 1). The 2 % bar of
                 the sprints row is over all kinds, so it hid the rocks. A point the convex hull flags counts only when the DRAWN triangles confirm it (a rock is
                 not convex: standing on a low shoulder of a cluster, or crossing an open angle of its hull, read 0.4-0.8 m "inside" with no drawn solid under the
                 capsule; see probe_collision.js drawnOverlap): the capsule's centre column under a surface more than 0.10 m above the feet, or a wall higher than
                 the step height inside the capsule's rim. Wave-5 release: 2 of 192 (isla_viva rock 11, 2 angles, 1.19 m deep: a 0.40 m part beside a 1.07 m rock
                 is a staircase the mover accepts, then the capsule walks off the step box and sinks into the tall box); the hull-only count was 16.
                 Wave 7 lane 7H (2026-10-14): the working copy read 2 of 192 (ashgrid rock 193, seed 7) and 5 of 320 over five Savanna seeds (60b854d0: 1 of 320
                 at seed 31337), every one the SAME false positive and none a rock that was not stopped by its box: an instance whose rock proper reads 0.53-0.55 m
                 over the mean terrain under its outline (a wall by its box) fell into the pebbleOnly fallback, which kept its 0.11-0.15 m pebbles as "the drawn
                 body"; the capsule held off the box face stood on a pebble and the centre-column rule (> 0.10 m) read the pebble's 0.102-0.130 m as a solid in the
                 way. Now a body counts only where its top is >= 0.55 m above the feet (see sprints) and a flagged body is confirmed by its own triangles. The
                 deepest confirmed overlap on the working copy is 0.02 m (0.51 m before); 3fce7529 still reads 2 of 192 (isla_viva rock 11, 1.19 m deep), 7f6a9fb2
                 104 of 192, and --plant rocks-small 23 of 64. A run-up whose 4.5 m start stands inside a wall box of the same cluster (a wide cluster: parts 7-8 m
                 apart; 4 of the 13,432 sprints of an exhaustive sweep, none in the sampled runs) starts further back instead and runs longer: a start in a wall
                 measures nothing about the fit (walls() and doors() guard their starts the same way). The sample is unchanged: no sampled run-up is backed off
                 on the working copy
  phantom-rocks  walking at a rock collider on open ground: 0 stops > 0.3 m from a drawn rock (Wave 4: every one)
  bullets        the game's shot test vs the drawn triangles at body height, over the rays that hit either: box kinds (container) agree on
                 >= 85 %; hull kinds on >= what the tightest axis-aligned boxes of the same mesh score on the same rays - 10 points
  bullets-through  <= 8 % of the body-height rays that hit a drawn solid pass its collider (a shot through something drawn solid)

  Drawn bodies and colliders: rocks are ONE body per drawn sub-mesh (the plan builds one box per rock), every other kind merges touching
  sub-meshes (a car's wheels, a barrel's bands). A body, and a collider, whose top is under the mover's step height (0.55 m above the
  mean terrain under it) is a step, not an obstacle: it is left out on BOTH sides, and an instance with only steps is skipped.
  rotated-walls  turned walls/planks/decks: no collider corner > 0.5 m beyond the drawn outline (Wave 4: up to 8.4 m, 1,158 m2 at seed 7)
  ramps          no bullet-proof hide cell under a tall ramp (a standing cell where a chest-high shot from EVERY one of 8 directions is
                 stopped by the slab: 0 m2); every sampled ramp climbed AND descended with the real mover; foot lip <= 0.10 m on every ramp.
                 Wave 8 (lane K3): housegen's pitched-roof planks (house.roofRamps) are roofs, not stairs (eave ~3.6 m over the street): not in the lip /
                 climb / descend samples (information line); house stairs are judged like every ramp; ramps-hide keeps every ramp
  falls          drops of 5-60 m onto 0.3 m slabs: 0 pass-through
  doors          >= 99 % of real walks into house doors get in (Wave 4: 107/108). Wave 8 (lane K3): a furnished housegen house is walked through its OWN
                 street-door records (house.doors, outward side from the record), not the lintel survey (which reads interior doorways and porch beams /
                 window headers inside furnished houses as doors: 72.6-81.1 % on the stage-B tree); the survey still covers every other building. A run-up
                 whose 3.5 m start stands behind another building (a narrow alley) starts where the approach is clear (>= 1.5 m); a door with no clear
                 approach at any angle is a FAILED walk. Control --plant door-shift (every record moved 2 m along its wall) must FAIL
  thin-walls     0 sprints cross a thin wall from either side at 90/60/30/10 deg (Wave 4: 0/288)
  errors         0 page errors / console errors / failed requests / shader errors

Exit 0 pass / 1 fail / 2 could-not-judge (a map would not load in time, Chrome did not start, a probe measured nothing).
A row that measured nothing is could-not-judge, never a pass.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "collisioncheck"
PROBE = os.path.join(C.HERE, "probe_collision.js")
CLIP_P95 = 0.10
CLIP25_MAX = 0.05
GAP_P95 = 0.15          # gap row: p95 of the collider standoff in EXCESS of what the tightest axis-aligned boxes of the same mesh would have (see judge())
SPRINT_MAX = 0.02
ROCK_SPRINT_MAX = 0.01   # sprints-rocks: rocks only, half the all-kind bar (192 runs -> at most 1)
ROCK_SPRINT_MIN_RUNS = 60
LEAN_MIN_DEG = 1.5       # probe_collision.js props(): a drawn instance leaning >= this is "leaned"
PHANTOM_MAX = 0
# bullets: the game's shot test vs the drawn triangles at body height. The plan's C-COLL contract keeps every collider an axis-aligned box, and
# a box cannot match a round trunk, a rock or a car hull (the corners are solid to the shot test, the mesh is not). So:
#   * BOX-shaped kinds (a box fits them exactly) keep the strict plan bar: agreement >= 85 %.
#   * HULL-shaped kinds are held to what a box can reach: the agreement the TIGHTEST axis-aligned box of each drawn body scores on the same
#     rays (probe: idealAgreement) minus BULLET_MARGIN; see README "Thresholds changed". It still fails the Wave-4 build, where a rock's
#     shot test hit a 6 m box 33 m from the rock (agreement 0 %).
#   * the part of the disagreement a box CAN always avoid - a shot that goes through a drawn solid - is gated for every kind (THROUGH_MAX).
BULLET_MIN = 0.85
BOX_KINDS = {"container"}
BULLET_MARGIN = 0.10               # hull kinds: agreement >= (what the tightest axis-aligned boxes of the same mesh score on the same rays) - 10 points
THROUGH_MAX = 0.08                 # shots through a drawn solid: worst measured on the Wave-5 build = pine 5.6 %, birch 7.4 %; a covering box scores 0 %
ROT_GAP = 0.5
LIP_MAX = 0.10
DOOR_MIN = 0.99
MIN_KIND_N = 5
# negative controls (--plant): the rows that must FAIL, and the prop kind whose baked collider table is edited in memory (served through a page route;
# no file is touched). container-narrow: container boxes 0.30 m narrower than the drawn body on each side (what a leaned container does to a level box);
# rocks-small: every rock box shrunk to 35 % of its outline, so the capsule walks into the drawn rock.
# door-shift (Wave 8, lane K3): in the page, every housegen street-door record is moved 2.0 m along its wall before the walk (nothing served, no file touched): the walk aims at
# solid wall and the doors row must FAIL - the control that the corrected door set (housegen's own records) is walked, not trusted
PLANTS = {"container-narrow": {"container-lean"}, "rocks-small": {"sprints-rocks"}, "door-shift": {"doors"}}
PLANT_KIND = {"container-narrow": "container", "rocks-small": "rocks"}
PLANT_SKIP = "doors,walls,ramps,falls"       # a plant run needs props + live only
PLANT_SKIPS = {"door-shift": "props,live,walls,ramps,falls"}   # ... except door-shift: doors only
PLANT_MAPS_BY = {"door-shift": "deepwood"}   # door-shift: a map with housegen houses and few kit shells (stage-B verify: 451 street doors on seed 7)
PLANT_MAPS = "ashgrid"                       # containers and rocks are both plentiful there
LEAN_OPTIONAL = "isla_viva,deepwood"         # container-lean: maps that place NO prop containers (the container yard is Savanna's; Wave 7b stage B, lane S3). A map listed here with no container is
                                             # information; any other map of the run must measure >= MIN_KIND_N containers or the row is could-not-judge. "none" = every map required


def lean_optional(args):
    raw = getattr(args, "lean_optional_maps", None)
    raw = LEAN_OPTIONAL if raw is None else raw
    return set() if raw.strip().lower() in ("", "none") else set(x for x in raw.split(",") if x)


def f(v, nd=3):
    return "-" if v is None else ("%.*f" % (nd, v))


def read_probe():
    with open(PROBE, encoding="utf-8") as fh:
        return fh.read()


class PlantView:
    """Verdict wrapper for --plant: only the designated rows count (exit 1 = the planted fault was seen); every other row is printed as information."""

    def __init__(self, v, rows):
        self._v, self._rows = v, rows

    def check(self, name, ok, detail="", expect=None):
        if name in self._rows:
            return self._v.check(name, ok, detail, expect)
        self._v.info(name + " (not counted in plant mode)", detail)
        return ok

    def cnj(self, name, why):
        return self.check(name, None, why)

    def __getattr__(self, k):
        return getattr(self._v, k)


def shrink_part(p, kind_plant):
    """Edit one baked collider part in place for the planted fault (table metres at it.s = 1)."""
    if kind_plant == "container-narrow":
        if p.get("t") == "rect":
            p["h"] = [p["h"][0], max(0.2, p["h"][1] - 0.30)]     # the width only: h[0] (the length) also spaces the stacks in maps.js, which the plant must not move
    elif kind_plant == "rocks-small":
        def pull(poly):
            cx = sum(q[0] for q in poly) / len(poly)
            cz = sum(q[1] for q in poly) / len(poly)
            return [[cx + (q[0] - cx) * 0.35, cz + (q[1] - cz) * 0.35] for q in poly]
        if p.get("t") == "hull":
            p["hull"] = pull(p["hull"])
            for e in p.get("byScale") or []:
                e["hull"] = pull(e["hull"])
        elif p.get("t") == "round":
            p["r"] = p["r"] * 0.35
        elif p.get("t") == "rect":
            p["h"] = [h * 0.35 for h in p["h"]]


def install_plant(s, args, plant):
    """Serve assets/props/prop_colliders.json with the planted kind's parts edited (in memory, by a page route); needs --disk or --rev."""
    rel = "assets/props/prop_colliders.json"
    if args.rev:
        b = s.disk.git.read(rel)
    else:
        with open(os.path.join(C.ROOT, rel.replace("/", os.sep)), "rb") as fh:
            b = fh.read()
    if b is None:
        raise C.EnvFailure("plant: %s is not in the served tree" % rel)
    table = json.loads(b.decode("utf-8"))
    kind = PLANT_KIND[plant]
    k = (table.get("kinds") or {}).get(kind)
    if not k or not k.get("parts"):
        raise C.EnvFailure("plant %s: the baked table has no %s parts" % (plant, kind))
    before = json.dumps(k["parts"])
    for part in k["parts"]:
        shrink_part(part, plant)
    if json.dumps(k["parts"]) == before:
        raise C.EnvFailure("plant %s: the %s parts were not changed (unknown part shape)" % (plant, kind))
    body = json.dumps(table).encode("utf-8")
    s.disk.overrides.append((lambda url: urllib.parse.urlparse(url).path.endswith("/" + rel),
                             lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    return "prop_colliders.json served with the %s parts edited (%s)" % (kind, plant)


def measure_map(v, args, map_id, src, quick):
    """One Chrome, one PRACTICE match, every in-page probe. Returns the raw measurements for the map."""
    res = {"map": map_id, "seed": args.seed}
    t0 = time.time()
    with C.Session(args, "collision_" + map_id, viewport={"width": 960, "height": 600}) as s:
        if args.plant and args.plant in PLANT_KIND:   # BEFORE boot: the page fetches the table during startMatch, through the route
            if not (args.disk or args.rev):
                raise C.EnvFailure("--plant needs --disk or --rev (it patches the served table)")
            res["plant"] = install_plant(s, args, args.plant)
            print("  [%s] plant %s: %s" % (map_id, args.plant, res["plant"]), flush=True)
        s.boot()
        s.freeze_loop()
        st = s.start_match(mode="practice", seed=args.seed, map_id=map_id)
        s.freeze_loop()
        res["load"] = st
        print("  [%s] loaded in %s s (%s)" % (map_id, st.get("load_s"), st.get("phaseAfterEnter")), flush=True)
        keys = s.js("() => { window.__LCCOL__ = (" + src + ")(); return Object.keys(window.__LCCOL__); }")
        if "props" not in keys:
            raise C.HarnessError("probe_collision.js did not install: %s" % keys)
        s.js("() => window.__LC__.stepFrames(14, 1/60, false)")
        skip = set((args.skip or "").split(","))

        def run(name, call, opt=None):
            if name in skip:
                return None
            t1 = time.time()
            r = s.js("(o) => window.__LCCOL__.%s(o)" % call, opt or {})
            print("  [%s] %s %.0f s" % (map_id, name, time.time() - t1), flush=True)
            return r

        res["props"] = run("props", "props")
        res["live"] = run("live", "live", {"perKind": 4 if quick else 8})
        res["doors"] = run("doors", "doors", {"max": 6 if quick else 14, "plant": args.plant})
        res["walls"] = run("walls", "walls", {"max": 8 if quick else 16})
        res["ramps"] = run("ramps", "ramps", {"max": 6 if quick else 14})
        res["falls"] = run("falls", "falls", {"slabs": 3 if quick else 6})
        d = s.diagnostics()
        res["diag"] = {k: (x[:6] if isinstance(x, list) else x) for k, x in d.items()}
        res["problems"] = C.diag_problems(d, rig=False)
    res["wall_s"] = round(time.time() - t0, 1)
    return res


def judge(v, per_map, rot, args):
    maps = [m for m in per_map]
    # ---- measured at all?
    for m, r in per_map.items():
        if not (r.get("props") or {}).get("kinds"):
            v.cnj("%s: props measured" % m, "no prop kind with colliders was measured (notes: %s)" % ((r.get("props") or {}).get("notes")))

    notes = sorted({n for r in per_map.values() for n in ((r.get("props") or {}).get("notes") or [])})
    if notes:
        v.info("drawn-body notes", " | ".join(notes))

    # ---- clip / gap per (map, kind)
    # clip stays absolute: the body capsule must not sink into what is drawn. gap is judged against what the C-COLL contract can reach: a box
    # cannot hug a round or leaning body, so the standoff is compared with the standoff of the TIGHTEST axis-aligned box of each drawn body
    # (gapIdeal); the row is the excess over it. A collider that is just the tight box (a barrel, a trunk) scores ~0; a 6 m box standing
    # 33 m from its rock scores 33 m.
    bad_clip, bad_gap, rows, seen = [], [], [], 0
    for m in maps:
        for k, p in ((per_map[m].get("props") or {}).get("kinds") or {}).items():
            if p["measured"] < MIN_KIND_N:
                continue
            seen += 1
            c = p["clip"]
            ge = p.get("gapExcess") or {}
            rows.append("%s:%s clip p95 %s over25 %s%% | gap p95 %s ideal-box %s excess %s (n %d, %s colliders / %s drawn bodies per instance, %s pebbles skipped%s)" % (
                m, k, f(c["p95"], 2), f(100 * (c["over25"] or 0), 0), f(p["gapMax"]["p95"], 2), f((p.get("gapIdeal") or {}).get("p95"), 2), f(ge.get("p95"), 2), p["measured"],
                f(p["collidersPerInstance"], 1), f(p.get("bodiesPerInstance"), 1), p.get("pebblesDropped", 0), (", %d step-height colliders skipped" % p["stepCollidersSkipped"] if p.get("stepCollidersSkipped") else "") + ((", %d pebble-only" % p["pebbleOnly"]) if p.get("pebbleOnly") else "")))
            if (c["p95"] or 0) > CLIP_P95 or (c["over25"] or 0) >= CLIP25_MAX:
                bad_clip.append("%s:%s clip p95 %s m, %s%% > 25 cm" % (m, k, f(c["p95"], 2), f(100 * (c["over25"] or 0), 0)))
            if (ge.get("p95") or 0) > GAP_P95:
                bad_gap.append("%s:%s gap excess p95 %s m (standoff p95 %s vs %s for the tightest boxes; max excess %s)" % (m, k, f(ge.get("p95"), 2), f(p["gapMax"]["p95"], 2), f((p.get("gapIdeal") or {}).get("p95"), 2), f(ge.get("max"), 2)))
    if seen:
        v.check("clip", not bad_clip, "body clip into the drawn mesh <= %.2f m at p95, <5%% over 25 cm, all %d (map,kind) pairs" % (CLIP_P95, seen) if not bad_clip else " | ".join(bad_clip), "p95 <= 0.10 m, > 25 cm in < 5 %")
        v.check("gap", not bad_gap, "collider standoff beyond the tightest axis-aligned box <= %.2f m at p95, all %d (map,kind) pairs" % (GAP_P95, seen) if not bad_gap else " | ".join(bad_gap), "excess p95 <= 0.15 m")
        v.info("per kind clip / gap", " ;; ".join(rows))

    # ---- container-lean: the container clip, level and leaned instances apart (the all-kind clip row has the same limits)
    # Wave 7b stage B (lane S3): the requirement is PER MAP. A map in --lean-optional-maps (default LEAN_OPTIONAL: Isla Viva and Deepwood, which place no prop
    # containers - the container yard is Savanna's) may have none: it is printed as information. Every other map in the run MUST measure >= MIN_KIND_N
    # containers with a lean split, or the row is could-not-judge naming it (until 2026-10-19 the row passed when ANY map of the run had containers, and a
    # run of Isla Viva alone was could-not-judge on every seed, which kept Isla Viva out of collisioncheck_seeds)
    optional = lean_optional(args)
    lean_rows, lean_bad, lean_seen, lean_n, lean_missing, lean_absent_ok = [], [], 0, 0, [], []
    for m in maps:
        k = ((per_map[m].get("props") or {}).get("kinds") or {}).get("container")
        if not k or k["measured"] < MIN_KIND_N or not k.get("lean"):
            got = 0 if not k else k["measured"]
            (lean_absent_ok if m in optional else lean_missing).append("%s (%d containers measured)" % (m, got))
            continue
        lean_seen += 1
        for tag in ("level", "leaned"):
            g = k["lean"].get(tag) or {}
            if not g.get("n"):
                continue
            lean_n += g["n"] if tag == "leaned" else 0
            lean_rows.append("%s:%s n %d clip p95 %s max %s over25 %s%%%s" % (m, tag, g["n"], f(g["p95"], 2), f(g["max"], 2), f(100 * (g["over25"] or 0), 0),
                             (" max tilt %s deg" % f(g["maxTilt"], 1)) if tag == "leaned" else ""))
            if (g["p95"] or 0) > CLIP_P95 or (g["over25"] or 0) >= CLIP25_MAX:
                lean_bad.append("%s %s containers (n %d%s): clip p95 %s m, max %s m, %s%% > 25 cm; worst %s" % (m, tag, g["n"], (", up to %s deg off vertical" % f(g["maxTilt"], 1)) if tag == "leaned" else "",
                                 f(g["p95"], 2), f(g["max"], 2), f(100 * (g["over25"] or 0), 0), json.dumps(g.get("worst"))[:160]))
    if lean_absent_ok:
        v.info("container-lean optional maps", "no container measured, allowed on %s (--lean-optional-maps %s)" % (", ".join(lean_absent_ok), ",".join(sorted(optional)) or "none"))
    if lean_seen:
        v.check("container-lean", not lean_bad, ("container clip into the drawn body <= %.2f m at p95, < 5%% over 25 cm, level and leaned apart, %d maps; %d containers lean >= %.1f deg" % (CLIP_P95, lean_seen, lean_n, LEAN_MIN_DEG)) if not lean_bad else " | ".join(lean_bad),
                "p95 <= 0.10 m, > 25 cm in < 5 %, level and leaned")
        v.info("container clip by lean", " ;; ".join(lean_rows))
    if lean_missing:
        v.cnj("container-lean required maps", "a map that must place containers measured fewer than %d: %s (optional maps: %s)" % (MIN_KIND_N, ", ".join(lean_missing), ",".join(sorted(optional)) or "none"))
    elif not lean_seen:
        if lean_absent_ok:
            v.info("container-lean", "not applicable: every map of this run is optional and places no container (%s)" % ", ".join(lean_absent_ok))
        else:
            v.cnj("container-lean", "no container with a lean split was measured (>= %d containers on a map needed)" % MIN_KIND_N)

    # ---- sprints / phantom / bullets
    runs = inside = 0
    kinds = {}
    for m in maps:
        for k, w in ((per_map[m].get("live") or {}).get("walk") or {}).items():
            runs += w["runs"]; inside += w["inside10"]
            a = kinds.setdefault(k, [0, 0]); a[0] += w["runs"]; a[1] += w["inside10"]
    if runs:
        v.check("sprints", inside / runs <= SPRINT_MAX, "%d of %d sprints (%.1f%%) ended > 10 cm inside the drawn mesh (limit %d%%); by kind %s" % (inside, runs, 100.0 * inside / runs, 100 * SPRINT_MAX, ", ".join("%s %d/%d" % (k, a[1], a[0]) for k, a in sorted(kinds.items()))), "<= 2 %")
    else:
        v.cnj("sprints", "no sprint was run")
    # ---- sprints-rocks: rocks alone (the all-kind row above is 2 % over every kind; rocks were 16 of 192 there while the other kinds read 0)
    rr = ri = 0
    rock_by = []
    for m in maps:
        w = ((per_map[m].get("live") or {}).get("walk") or {}).get("rocks")
        if w:
            rr += w["runs"]; ri += w["inside10"]
            rock_by.append("%s %d/%d (deepest %s m)" % (m, w["inside10"], w["runs"], f(w.get("deepest"), 2)))
    if rr >= ROCK_SPRINT_MIN_RUNS:
        hull_only = sum((((per_map[m].get("live") or {}).get("walk") or {}).get("rocks") or {}).get("hullOnlyPoints", 0) for m in maps)
        backed = sum((((per_map[m].get("live") or {}).get("walk") or {}).get("rocks") or {}).get("startsBackedOff", 0) for m in maps)
        v.check("sprints-rocks", ri / rr <= ROCK_SPRINT_MAX, "%d of %d rock sprints (%.2f%%) ended > 10 cm inside the drawn rock (limit %d%%): %s; %d hull-flagged trace points were not confirmed by the drawn triangles (standing on a shoulder / over an open angle of the hull)%s" % (
            ri, rr, 100.0 * ri / rr, round(100 * ROCK_SPRINT_MAX), ", ".join(rock_by), hull_only,
            ("; %d run-ups started inside a wall box of the same cluster and were started further back" % backed) if backed else ""), "<= 1 %")
    else:
        v.cnj("sprints-rocks", "only %d rock sprints were run (need >= %d)" % (rr, ROCK_SPRINT_MIN_RUNS))
    pr = po = 0
    pother = []
    for m in maps:
        for k, w in ((per_map[m].get("live") or {}).get("phantom") or {}).items():
            if k == "rocks":
                pr += w["runs"]; po += w["over30"]
            elif w["over30"]:
                pother.append("%s:%s %d/%d" % (m, k, w["over30"], w["runs"]))
    if pr:
        v.check("phantom-rocks", po <= PHANTOM_MAX, "%d of %d walks at a rock collider stopped > 0.3 m from any drawn rock" % (po, pr), "0")
    else:
        v.cnj("phantom-rocks", "no isolated rock was walked at (no rocks measured)")
    if pother:
        v.info("phantom stops on other kinds (> 0.3 m from the drawn mesh)", ", ".join(pother))
    bad, bad_through, tot, rows = [], [], 0, []
    for m in maps:
        for k, b in ((per_map[m].get("live") or {}).get("bullets") or {}).items():
            if b["bodyAgreement"] is None:
                continue
            tot += 1
            ideal = b.get("idealAgreement")
            if k in BOX_KINDS or ideal is None:
                need = BULLET_MIN
            else:
                need = max(0.0, min(BULLET_MIN, ideal - BULLET_MARGIN))
            rows.append("%s:%s agreement %s%% (need %d%%: %s) through %s%%" % (m, k, f(100 * b["bodyAgreement"], 0), round(100 * need),
                        "box kind" if k in BOX_KINDS else "tightest boxes score %s%% - %d points" % (f(100 * (ideal or 0), 0), round(100 * BULLET_MARGIN)), f(100 * (b.get("bodyThroughShare") or 0), 1)))
            if b["bodyAgreement"] < need:
                bad.append("%s:%s %s%% < %d%% (both %d, drawn-only %d, collider-only %d)" % (m, k, f(100 * b["bodyAgreement"], 0), round(100 * need), b["bodyBoth"], b["bodyVisualOnly"], b["bodyColliderOnly"]))
            if (b.get("bodyThroughShare") or 0) > THROUGH_MAX:
                bad_through.append("%s:%s %s%% of the rays that hit the drawn mesh pass its collider (drawn-only %d of %d)" % (m, k, f(100 * b["bodyThroughShare"], 1), b["bodyVisualOnly"], b["bodyBoth"] + b["bodyVisualOnly"]))
    if tot:
        v.check("bullets", not bad, ("game shot test agrees with the drawn mesh at body height on all %d (map,kind) pairs (box kinds >= %d%%, hull kinds at their measured bar)" % (tot, round(100 * BULLET_MIN))) if not bad else " | ".join(bad), "box kinds >= 85 %, hull kinds >= measured bar")
        v.check("bullets-through", not bad_through, ("no more than %d%% of the body-height rays that hit a drawn solid pass through it (all %d pairs)" % (round(100 * THROUGH_MAX), tot)) if not bad_through else " | ".join(bad_through), "<= %d %%" % round(100 * THROUGH_MAX))
        v.info("bullets per kind", " ;; ".join(rows))
    else:
        v.cnj("bullets", "no bullet tally")

    # ---- rotated walls (Node)
    if rot:
        bad = ["%s gap max %s m p95 %s (%d turned boxes, %s m2 beyond the drawn area; worst %s)" % (m, f(r["gapMax"], 2), f(r["gapP95"], 2), r["owned"], f(r["excessM2"], 0), json.dumps(r["bySite"])[:160]) for m, r in rot.items() if (r["gapMax"] or 0) > ROT_GAP]
        v.check("rotated-walls", not bad and all(r["owned"] for r in rot.values()), ("no collider corner > %.1f m beyond a drawn turned box (%s)" % (ROT_GAP, ", ".join("%s %d boxes" % (m, r["owned"]) for m, r in rot.items()))) if not bad else " | ".join(bad), "gap <= 0.5 m")
        v.info("rotated-walls m2", ", ".join("%s %s m2" % (m, f(r["excessM2"], 0)) for m, r in rot.items()))
    else:
        v.cnj("rotated-walls", "the Node census produced no rotated-wall data")

    # ---- ramps
    hide = sum((r.get("ramps") or {}).get("hide", {}).get("hideM2", 0) for r in per_map.values())
    nstand = sum((r.get("ramps") or {}).get("hide", {}).get("standable", 0) for r in per_map.values())
    ncell = sum((r.get("ramps") or {}).get("hide", {}).get("cellsUnderSlab", 0) for r in per_map.values())
    nr = sum((r.get("ramps") or {}).get("n", 0) for r in per_map.values())
    if nr:
        some = sum((r.get("ramps") or {}).get("hide", {}).get("anySideM2", 0) for r in per_map.values())
        v.check("ramps-hide", hide == 0 and nstand > 0, "bullet-proof hide area under ramps %.2f m2: standing cells where a chest-high shot from EVERY one of 8 directions is stopped by the slab (%d cells with standing room under a slab, %d standable; %.2f m2 are shielded from at least one side, which is not a hiding place)" % (hide, ncell, nstand, some), "0 m2")
        cl = [(m, (r.get("ramps") or {}).get("climb") or {}) for m, r in per_map.items()]
        ds = [(m, (r.get("ramps") or {}).get("descend") or {}) for m, r in per_map.items()]
        cr, cu = sum(c.get("runs", 0) for _, c in cl), sum(c.get("reachedTop", 0) for _, c in cl)
        dr, du = sum(d.get("runs", 0) for _, d in ds), sum(d.get("reachedFoot", 0) for _, d in ds)
        v.check("ramps-climb", cr > 0 and cu == cr, "%d of %d sampled ramps climbed to the top from the ground%s" % (cu, cr, ("; failed " + json.dumps([c.get("failed") for _, c in cl if c.get("failed")])[:300]) if cu != cr else ""), "all")
        v.check("ramps-descend", dr > 0 and du == dr, "%d of %d sampled ramps walked down to the foot%s" % (du, dr, ("; failed " + json.dumps([d.get("failed") for _, d in ds if d.get("failed")])[:300]) if du != dr else ""), "all")
        lips = [(m, (r.get("ramps") or {}).get("lip") or {}) for m, r in per_map.items()]
        worst = max([(l.get("max") or 0) for _, l in lips] or [0])
        roofp = {m: (r.get("ramps") or {}).get("roofPlanks") for m, r in per_map.items() if (r.get("ramps") or {}).get("roofPlanks")}
        if roofp:
            v.info("ramps: house roof planks (house.roofRamps; roofs, not stairs - not in the lip / climb / descend samples, kept in ramps-hide)", ", ".join("%s %d" % (m, n) for m, n in roofp.items()))
        v.check("ramps-lip", worst <= LIP_MAX + 1e-9, "foot lip max %s m over %d ramps (%s)" % (f(worst, 2), sum(l.get("n", 0) for _, l in lips), ", ".join("%s: %d over 0.10, %d over 0.55" % (m, l.get("over10", 0), l.get("over055", 0)) for m, l in lips)), "<= 0.10 m")
    else:
        v.cnj("ramps", "no ramp colliders measured")

    # ---- falls / doors / thin walls
    fr = sum((r.get("falls") or {}).get("runs", 0) for r in per_map.values())
    fp = sum((r.get("falls") or {}).get("passed", 0) for r in per_map.values())
    if fr:
        byd = {}
        for r in per_map.values():
            for e in (r.get("falls") or {}).get("byDrop", []):
                a = byd.setdefault(e["drop"], [0, 0]); a[0] += e["runs"]; a[1] += e["passed"]
        v.check("falls", fp == 0, "%d of %d drops onto 0.3 m slabs passed through (by drop m: %s)" % (fp, fr, ", ".join("%s: %d/%d" % (d, a[1], a[0]) for d, a in sorted(byd.items()))), "0 pass-through")
    else:
        v.cnj("falls", "no free 0.3 m slab found to drop onto")
    dr = sum((r.get("doors") or {}).get("runs", 0) for r in per_map.values())
    dg = sum((r.get("doors") or {}).get("gotIn", 0) for r in per_map.values())
    if dr:
        fails = [x for r in per_map.values() for x in ((r.get("doors") or {}).get("failed") or [])]
        v.check("doors", dg / dr >= DOOR_MIN, "%d of %d door walks got inside (%.1f%%; %d doors on %d maps; %s)%s" % (dg, dr, 100.0 * dg / dr, sum((r.get("doors") or {}).get("doorsTested", 0) for r in per_map.values()), len(per_map),
                ", ".join("%s: %d housegen street-door walks + %d lintel-survey walks, %d doors with no approach" % (m, ((r.get("doors") or {}).get("bySrc") or {}).get("housegen", 0), ((r.get("doors") or {}).get("bySrc") or {}).get("lintel", 0), (r.get("doors") or {}).get("noApproach", 0)) for m, r in per_map.items()),
                ("; failed " + json.dumps(fails)[:400]) if fails else ""), ">= 99 %")
        v.info("doors survey", " | ".join("%s: %s housegen street doors, lintel survey %s (%s outside housegen houses), %s run-ups pulled in to a clear approach%s" % (m, (r.get("doors") or {}).get("housegenDoors"), (r.get("doors") or {}).get("surveyed"), (r.get("doors") or {}).get("lintelUsed"), (r.get("doors") or {}).get("pulledIn"),
                ", PLANT shifted %s" % (r.get("doors") or {}).get("housegenShifted") if (r.get("doors") or {}).get("housegenShifted") else "") for m, r in per_map.items()))
    else:
        v.cnj("doors", "no usable ground-level house door was found")
    wr = sum((r.get("walls") or {}).get("runs", 0) for r in per_map.values())
    wc = sum((r.get("walls") or {}).get("crossed", 0) for r in per_map.values())
    if wr:
        v.check("thin-walls", wc == 0, "%d of %d sprints into thin walls crossed (%d walls)" % (wc, wr, sum((r.get("walls") or {}).get("walls", 0) for r in per_map.values())), "0 crossings")
    else:
        v.cnj("thin-walls", "no thin ground-level wall found")

    # ---- errors
    probs = {m: r.get("problems") for m, r in per_map.items() if r.get("problems")}
    v.check("errors", not probs, "0 page / console / request / shader errors" if not probs else json.dumps(probs)[:500], "0")


def main_fn(v, args):
    plant_rows = None
    if args.plant:
        if args.plant not in PLANTS:
            raise C.HarnessError("unknown --plant %r (known: %s)" % (args.plant, ", ".join(sorted(PLANTS))))
        plant_rows = PLANTS[args.plant]
        args.maps = args.maps or PLANT_MAPS_BY.get(args.plant, PLANT_MAPS)
        args.skip = args.skip or PLANT_SKIPS.get(args.plant, PLANT_SKIP)
        print("%s: PLANT MODE %s - only %s count; exit 1 = the planted fault was detected (maps %s, skipping %s)" % (GATE, args.plant, sorted(plant_rows), args.maps, args.skip), flush=True)
        v = PlantView(v, plant_rows)
    maps = [m for m in (args.maps or ",".join(C.MAPS)).split(",") if m]
    src = read_probe()
    v.data["seed"] = args.seed
    v.data["plant"] = args.plant
    # Node census: the rotated-wall rows (no browser)
    rot = {}
    try:
        if args.plant:
            raise C.EnvFailure("skipped in plant mode")
        root, label = C.ROOT, "working copy"
        if args.rev:
            root, sha = PC.rev_root(args.rev)
            label = "git %s" % sha
        vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
        doc = PC.run_census(root, vendor, maps, str(args.seed), [], 900)
        rot = {m: s["rotWalls"] for m, s in doc["summary"].items()}
        v.data["rotWalls"] = rot
        print("%s: rotated walls from the Node census (%s): %s" % (GATE, label, {m: (r["owned"], r["gapMax"]) for m, r in rot.items()}), flush=True)
    except C.EnvFailure as e:
        if args.plant:
            v.info("rotated-walls census", str(e))
        else:
            v.cnj("rotated-walls census", str(e))
    per_map = {}
    for m in maps:
        try:
            print("%s: measuring %s (seed %d)" % (GATE, m, args.seed), flush=True)
            per_map[m] = measure_map(v, args, m, src, args.quick)
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
        judge(v, per_map, rot, args)
    else:
        v.cnj("measured", "no map could be measured")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=None, help="comma list (default: all three)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--quick", action="store_true", help="fewer instances / runs per section (development)")
    ap.add_argument("--skip", default="", help="comma list of sections to skip: props,live,doors,walls,ramps,falls")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANTS)))
    ap.add_argument("--lean-optional-maps", default=None, help="container-lean: maps allowed to place no container (default %s; 'none' = every map of the run must measure containers)" % LEAN_OPTIONAL)
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
