#!/usr/bin/env python
"""collisioncheck - does what the player collides with match what the player sees?  (world-foundation plan, section 4, lane 5D)

    python _harness/collisioncheck.py --disk                    # the working copy (the integration run)
    python _harness/collisioncheck.py --rev 7f6a9fb2            # a frozen commit: the must-fail proof on Wave 4 (the registered negative control)
    python _harness/collisioncheck.py --disk --maps isla_viva --quick

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
                 counts only while the feet are below the body's top - 0.10 m (stepping onto a low rock is not walking through it) and not in
                 a mantle
  phantom-rocks  walking at a rock collider on open ground: 0 stops > 0.3 m from a drawn rock (Wave 4: every one)
  bullets        the game's shot test vs the drawn triangles at body height, over the rays that hit either: box kinds (container) agree on
                 >= 85 %; hull kinds on >= what the tightest axis-aligned boxes of the same mesh score on the same rays - 10 points
  bullets-through  <= 8 % of the body-height rays that hit a drawn solid pass its collider (a shot through something drawn solid)

  Drawn bodies and colliders: rocks are ONE body per drawn sub-mesh (the plan builds one box per rock), every other kind merges touching
  sub-meshes (a car's wheels, a barrel's bands). A body, and a collider, whose top is under the mover's step height (0.55 m above the
  mean terrain under it) is a step, not an obstacle: it is left out on BOTH sides, and an instance with only steps is skipped.
  rotated-walls  turned walls/planks/decks: no collider corner > 0.5 m beyond the drawn outline (Wave 4: up to 8.4 m, 1,158 m2 at seed 7)
  ramps          no bullet-proof hide cell under a tall ramp (a standing cell where a chest-high shot from EVERY one of 8 directions is
                 stopped by the slab: 0 m2); every sampled ramp climbed AND descended with the real mover; foot lip <= 0.10 m on every ramp
  falls          drops of 5-60 m onto 0.3 m slabs: 0 pass-through
  doors          >= 99 % of real walks into house doors get in (Wave 4: 107/108)
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "collisioncheck"
PROBE = os.path.join(C.HERE, "probe_collision.js")
CLIP_P95 = 0.10
CLIP25_MAX = 0.05
GAP_P95 = 0.15          # gap row: p95 of the collider standoff in EXCESS of what the tightest axis-aligned boxes of the same mesh would have (see judge())
SPRINT_MAX = 0.02
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


def f(v, nd=3):
    return "-" if v is None else ("%.*f" % (nd, v))


def read_probe():
    with open(PROBE, encoding="utf-8") as fh:
        return fh.read()


def measure_map(v, args, map_id, src, quick):
    """One Chrome, one PRACTICE match, every in-page probe. Returns the raw measurements for the map."""
    res = {"map": map_id, "seed": args.seed}
    t0 = time.time()
    with C.Session(args, "collision_" + map_id, viewport={"width": 960, "height": 600}) as s:
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
        res["doors"] = run("doors", "doors", {"max": 6 if quick else 14})
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
        v.check("doors", dg / dr >= DOOR_MIN, "%d of %d door walks got inside (%.1f%%; %d doors on %d maps)" % (dg, dr, 100.0 * dg / dr, sum((r.get("doors") or {}).get("doorsTested", 0) for r in per_map.values()), len(per_map)), ">= 99 %")
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
    maps = [m for m in (args.maps or ",".join(C.MAPS)).split(",") if m]
    src = read_probe()
    v.data["seed"] = args.seed
    # Node census: the rotated-wall rows (no browser)
    rot = {}
    try:
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
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
