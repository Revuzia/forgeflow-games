#!/usr/bin/env python
"""endgamecheck - do the two O4 endgame areas exist, and do they work?  (Last Circle world plan, Wave 7b, lane B2; plan O4.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/endgamecheck.py --disk                              # the working copy: Isla Viva seeds 1-40 + Deepwood seeds 1-60 + 3 (bridge walks on all 63), ~4 min
    python _harness/endgamecheck.py --disk --quick                      # seeds 1-12
    python _harness/endgamecheck.py --rev 6191b380 --block-maps all     # the must-fail proof: the live build has no crater-rim village and no bridge
    python _harness/endgamecheck.py --disk --plant bridge-gap           # negative controls (each must exit 1, see PLANTS)

Plan O4: the final circle always ends within ~117 m of the map centre - on Isla Viva that is the bare 41-47 % volcano slope, on Deepwood the river - so those two maps get a FITTING endgame
area and the storm stays where it is: a RUINED CRATER-RIM VILLAGE on the volcano and a MILL-AND-BRIDGE compound across the river. Never a grid core on the volcano or across the river.
(citycheck's `endgame-cover` row measures how much COVER the final circles hold - c7 gated, the strict c8 information; these rows measure the AREAS themselves.) `probe_endgame.mjs`
builds each (map, seed) with the UNMODIFIED maps.js and measures the BUILT map (colliders, ground, pads, the towngen layout when `M.city` exists), so it judges whatever generator puts them there.

ISLA VIVA - the crater-rim village (ring = 36..130 m from the volcano axis (40, -60); the crest is r = 42, the Volcano Rim POI r = 130):
  rim-village      every seed: >= 6 enterable buildings (the pinned detector of citycheck: a roof, walls, a doorway) in the ring, standing in >= 3 of its 4 quadrants (a ring, not a lump)  [live: 1, one quadrant]
  rim-pads         INFORMATION: the pad rects (ground.padLog) in the ring by quadrant. Not a row: a village may be levelled as one yard or house by house, and a pad COUNT says nothing about whether the
                   ground under a building is level - that is placementcheck's counted pads / base-edges / doorway-clearance rows, which cover every pad of the rim
  rim-stairs       every seed: >= 1 stair / ramp inside the POI circle, every one climbing <= 45 degrees (the plan's ramp rule)                                                           [live: the observatory, 27.5 / 42.0]
  rim-grid-slope   every seed: no GRID layout (street-grid town) with a block on natural slope > 25 degrees (atan(relief / 46) of the base ground under its 46 m block), and the volcano_rim
                   layout is not a grid at all (the plan: "never a grid core on the volcano")                                                                                                  [live: no layout, vacuous]
  rim-ruins        INFORMATION: the volcano_rim layout's theme / kind and the number of ruin buildings it carries (a gate cannot see "ruined"; the screenshots can)
  rim-cover        INFORMATION: static cover pieces (>= 1.2 m, no prop, no ramp) in the ring per seed
DEEPWOOD - the mill and its bridge (the structures over the river within poi.r + 60 m of the Riverside Mill):
  bridge-present   every seed: a BRIDGE exists = a contact cluster of walkable slabs that covers >= 8 m of deep water (terrain > 1.1 m under the surface) along its axis, with dry ground within 10 m
                   past both ends                                                                                                                                                            [live: none]
  bridge-walk      the REAL mover (player.js tick, mover_env.mjs) walks it from 6-22 m before the first slab to 6-22 m past the last on FIVE lanes over the full deck width (the centre line,
                   the quarter lines and the outer lanes 0.7 m inside each deck edge), walking AND sprinting, BOTH ways (20 walks per seed): every walk on the walk seeds (default 1-60 + 1234,
                   2026, 31337: the stage-B tree has E-W bridges on 9, 15, 27, 57 and 31337); a walk fails on swimming, a stall (2.5 s without progress) or the time budget        [live: 0]
                   (Stage C, lane C3: until then 3 lanes within +-min(0.9, width/6) of the centre, walk only, on 5 seeds - 30/30 on the stage-B tree, whose E-W decks end with their outer
                   halves under / inside the banks; the full-width row reads 1216/1260 there, 44 lost on 12 seeds, 32 of them on the 5 E-W seeds: see the README Wave-7b section)
  bridge-grounded  every seed with a bridge: nothing over the river within poi.r + 60 m of the mill is carried by nothing (a piece over deep water, near the surface, is carried when its underside
                   touches the ground under it or a carried piece below reaches it within 0.15 m; the CARRIERS are the colliders AND every drawn box, because a pier leg or a dock stilt is often collide:false) - the deck rests on piers, the piers on the bed
  float-water      INFORMATION: the same scan over the whole map (the live Isla Viva shipwreck hull is a partly submerged chain of boxes at y 0.2..3.4 over a 2-5 m seabed: 33 uncarried pieces at 6191b380, reported, not gated)
Every counted row needs a bridge / a ring to measure: a build without them FAILS (that is the live build's verdict), it is never could-not-judge. Could-not-judge: the probe crashed, or fewer
than 5 walk seeds were run on a build that has a bridge.

--plant NAME (never edits a file; probe_endgame.mjs mutates the BUILT map in memory; only the designated rows count):
  steep-stair -> rim-stairs   ring-collapse -> rim-village   grid-on-slope -> rim-grid-slope   bridge-gap -> bridge-walk   float-pier -> bridge-grounded
  deck-edge -> bridge-walk (the +s side of the deck cut back between the old centre lanes and the outer lane: only full-width walking sees it)
--fixture good   the HARNESS SELF-TEST (independent of lane B1's tree): a scratch copy of the Wave-7 completion release 6191b380 with a hand-made crater-rim village (8 houses on a ring 62 m from the
                 volcano axis) and a plank bridge over the Deepwood river at x = 65 on piers that reach the bed (FIXTURE_RIM / FIXTURE_BRIDGE below; a test double, not the game). Every row MUST PASS on
                 it (the gate registers `endgamecheck_fixture`), and each --plant on the fixture MUST FAIL its row (the registered controls `endgamecheck-fixture-plant-*`): proof that the rows can
                 pass AND fail for the right reason whatever the working copy holds. The fixture's bridge fits its banks on every full-width lane on seeds 2, 5, 7, 10, 12 (walk seeds default there under --fixture).
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
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "endgamecheck"
PROBE = os.path.join(C.HERE, "probe_endgame.mjs")
RIM_BUILDINGS_MIN = 6
RIM_QUADS_MIN = 3
RIM_PADS_MIN = 6
RIM_STAIR_MAX_DEG = 45.0
RIM_STAIRS_MIN = 1
GRID_SLOPE_MAX_DEG = 25.0
WALKS_PER_SEED = 20                           # 5 lanes over the full deck width x walk / sprint x both ways (stage C, lane C3; was 3 lanes within +-0.9 m x walk x both ways = 6)
WALK_SEEDS_MIN = 5
PLANT_ROWS = {"steep-stair": {"rim-stairs"}, "ring-collapse": {"rim-village"}, "grid-on-slope": {"rim-grid-slope"}, "bridge-gap": {"bridge-walk"}, "float-pier": {"bridge-grounded"}, "deck-edge": {"bridge-walk"}}
PLANT_MAP = {"steep-stair": "isla_viva", "ring-collapse": "isla_viva", "grid-on-slope": "isla_viva", "bridge-gap": "deepwood", "float-pier": "deepwood", "deck-edge": "deepwood"}


FIXTURE_REV = "6191b380"                      # the Wave-7 completion release: the frozen base of the fixture (its maps.js carries the two anchors below)
FIXTURE_WALK_SEEDS = "2,5,7,10,12"           # seeds on which the fixture's flat 4 m plank deck meets both banks on EVERY full-width lane (stage C: 20/20 each; of 1-20, 6 and 8 lose 1-2 outer-lane walks, 1/3/4/9/11/13/14/16/19/20 more, 15 has no bridge; the 3-lane era used 2,5,6,7,8)
FIXTURE_RIM = """
    // FIXTURE (B2 harness test double, not the game): eight houses on a ring 62 m from the volcano axis
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, hx = 40 + Math.cos(a) * 62, hz = -60 + Math.sin(a) * 62;
      house(hx, hz, 7, 6, (k % 4) * Math.PI / 2, "#8f8a80", "#5a5048", "volcano_rim");
    }
"""
FIXTURE_RIM_ANCHOR = "    // Volcano Rim: an r=130 named landing zone that emitted FOUR CHESTS"
FIXTURE_BRIDGE = """
    // FIXTURE (B2 harness test double, not the game): a 4 m wide plank bridge along z at x = 65 across the river, on piers that reach the bed
    {
      const bx = 65, rzb = Math.sin(bx / 210) * 130 + 40;
      const z0 = rzb - 16, z1 = rzb + 16, yTop = Math.max(heightAt0(bx, z0), heightAt0(bx, z1)) + 0.1;
      addBox(bx, yTop - 0.15, (z0 + z1) / 2, 4, 0.3, z1 - z0, C_PLANK);
      for (const zz of [z0 + 5, rzb - 4, rzb + 4, z1 - 5]) { addStilt(bx - 1.5, zz, 0.4, yTop - 0.3, C_LOG, true); addStilt(bx + 1.5, zz, 0.4, yTop - 0.3, C_LOG, true); }
    }
"""
FIXTURE_BRIDGE_ANCHOR = "    // meadow farm → actual farmland (crop rows + barn + silo + fence)"


def build_fixture():
    """a scratch copy of FIXTURE_REV's runtime/ + assets/props with the crater-rim village and the bridge patched into maps.js; returns the directory"""
    base, _sha = PC.rev_root(FIXTURE_REV)
    dst = tempfile.mkdtemp(prefix="lc_endgame_fixture_")
    for sub in ("runtime", os.path.join("assets", "props")):
        shutil.copytree(os.path.join(base, sub), os.path.join(dst, sub))
    mp = os.path.join(dst, "runtime", "3d", "royale", "maps.js")
    with open(mp, encoding="utf-8", newline="") as fh:
        src = fh.read()
    for anchor, add in ((FIXTURE_RIM_ANCHOR, FIXTURE_RIM), (FIXTURE_BRIDGE_ANCHOR, FIXTURE_BRIDGE)):
        if src.count(anchor) != 1:
            raise C.EnvFailure("fixture: anchor %r found %d times in %s's maps.js" % (anchor[:60], src.count(anchor), FIXTURE_REV))
        src = src.replace(anchor, add + anchor)
    with open(mp, "w", encoding="utf-8", newline="") as fh:
        fh.write(src)
    return dst


def pctl(a, q):
    if not a:
        return None
    s = sorted(a)
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def f(v, nd=1):
    return "-" if v is None else ("%.*f" % (nd, v))


class Rows:
    def __init__(self, v, block_maps, plant):
        self.v, self.block, self.plant = v, set(block_maps), plant
        self.only = PLANT_ROWS.get(plant)
        self.state = {}

    def row(self, name, map_id, ok, detail, expect=None):
        key = "%s [%s]" % (name, map_id)
        self.state[key] = ok
        if self.only is not None and name not in self.only:
            self.v.info("%s (not counted in plant mode)" % key, detail)
            return ok
        if map_id in self.block:
            return self.v.check(key, ok, detail, expect)
        self.v.info("%s (%s, information)" % (key, "would PASS" if ok else ("would FAIL" if ok is False else "not measured")), detail)
        return ok


def judge_rim(v, R, recs):
    m = "isla_viva"
    n = len(recs)
    rims = [r["rim"] for r in recs]
    short = [(r["seed"], len(r["rim"]["ring"]), r["rim"]["quadsCovered"]) for r in recs if len(r["rim"]["ring"]) < RIM_BUILDINGS_MIN or r["rim"]["quadsCovered"] < RIM_QUADS_MIN]
    bl = [len(x["ring"]) for x in rims]
    ql = [x["quadsCovered"] for x in rims]
    R.row("rim-village", m, not short, "enterable buildings in the ring (36..130 m from the volcano axis; detector buildings within 8 m of each other count once): min %d, median %s, max %d over %d seeds; quadrants covered: min %d, median %s%s" % (
        min(bl), f(pctl(bl, 0.5), 0), max(bl), n, min(ql), f(pctl(ql, 0.5), 0), ("; %d seeds short (seed, buildings, quadrants): %s" % (len(short), short[:6])) if short else ""),
        ">= %d buildings in >= %d of 4 quadrants on every seed" % (RIM_BUILDINGS_MIN, RIM_QUADS_MIN))
    pl = [x["pads"] for x in rims]
    pq = [x["padQuadsCovered"] for x in rims]
    shortp = [(r["seed"], r["rim"]["pads"], r["rim"]["padQuadsCovered"]) for r in recs if r["rim"]["pads"] < RIM_PADS_MIN or r["rim"]["padQuadsCovered"] < RIM_QUADS_MIN]
    # INFORMATION, not a row: a village may be levelled as ONE yard (towngen's cluster layouts register a single plateau for their bounds) or house by house; how many pads there are says nothing about
    # whether the ground under a building is level. That is placementcheck's counted `pads` / `base-edges` / `doorway-clearance` rows, which cover every pad of every map including the rim.
    v.info("rim-pads [isla_viva] (INFORMATION)", "pad rects (ground.padLog) in the ring: min %d, median %s, max %d; quadrants covered: min %d%s; by generator (seed %d): %s" % (
        min(pl), f(pctl(pl, 0.5), 0), max(pl), min(pq), ("; %d seeds under %d pads / %d quadrants" % (len(shortp), RIM_PADS_MIN, RIM_QUADS_MIN)) if shortp else "", recs[0]["seed"], recs[0]["rim"]["padGens"]))
    # stairs = the ramp colliders inside the POI circle + the layout's own stairs of the volcano_rim town (towngen's stair records carry slopeDeg)
    lay_st = lambda r: (r["rim"]["rimTown"] or {}).get("stairs", 0)
    lay_deg = lambda r: (r["rim"]["rimTown"] or {}).get("stairsMaxDeg", 0) or 0
    nostair = [r["seed"] for r in recs if len(r["rim"]["stairs"]) + lay_st(r) < RIM_STAIRS_MIN]
    steep = [(r["seed"], s) for r in recs for s in r["rim"]["stairs"] if s["deg"] > RIM_STAIR_MAX_DEG] + [(r["seed"], {"layout stair": lay_deg(r)}) for r in recs if lay_deg(r) > RIM_STAIR_MAX_DEG]
    nst = [len(r["rim"]["stairs"]) + lay_st(r) for r in recs]
    mx = max(max((r["rim"]["stairsMaxDeg"] or 0), lay_deg(r)) for r in recs)
    R.row("rim-stairs", m, not nostair and not steep, "stairs inside the POI circle (ramp colliders + the layout's stairs): min %d per seed, steepest %s degrees over %d seeds%s%s" % (
        min(nst), f(mx), n, ("; seeds with none: %s" % nostair[:6]) if nostair else "", ("; %d over %d degrees, first: %s" % (len(steep), RIM_STAIR_MAX_DEG, steep[0])) if steep else ""),
        ">= %d stair on every seed, all <= %d degrees" % (RIM_STAIRS_MIN, RIM_STAIR_MAX_DEG))
    gridbad = [(r["seed"], g) for r in recs for g in r["rim"]["grids"] if g["maxBlockSlopeDeg"] > GRID_SLOPE_MAX_DEG]
    rimgrid = [r["seed"] for r in recs if r["rim"]["rimTown"] and r["rim"]["rimTown"]["grid"]]
    ngrid = sum(len(r["rim"]["grids"]) for r in recs)
    worst = max((g["maxBlockSlopeDeg"] for r in recs for g in r["rim"]["grids"]), default=None)
    layout_seeds = sum(1 for r in recs if r["rim"]["layout"])
    R.row("rim-grid-slope", m, not gridbad and not rimgrid, "%d grid layouts over %d seeds (%d seeds with a layout), steepest block %s degrees%s%s" % (
        ngrid, n, layout_seeds, f(worst), ("; %d blocks over %d degrees, first: %s" % (len(gridbad), GRID_SLOPE_MAX_DEG, gridbad[0])) if gridbad else "",
        ("; the volcano_rim layout is a GRID on seeds %s" % rimgrid[:6]) if rimgrid else ""), "no grid block on > %d degrees; volcano_rim is not a grid" % GRID_SLOPE_MAX_DEG)
    rt = [r["rim"]["rimTown"] for r in recs if r["rim"]["rimTown"]]
    v.info("rim-ruins [isla_viva] (INFORMATION: a gate cannot see 'ruined')", ("volcano_rim layout: kind %s, theme %s, ruin buildings min %d / median %s / max %d, enterable parcels median %s, stairs max %s degrees over %d seeds" % (
        rt[0]["kind"], rt[0]["theme"], min(t["ruin"] for t in rt), f(pctl([t["ruin"] for t in rt], 0.5), 0), max(t["ruin"] for t in rt), f(pctl([t["enterable"] for t in rt], 0.5), 0), f(max(t["stairsMaxDeg"] for t in rt)), len(rt))) if rt else "this build has no volcano_rim layout")
    cv = [x["cover"] for x in rims]
    v.info("rim-cover [isla_viva] (INFORMATION)", "static cover pieces in the ring: min %d, median %s, max %d; per quadrant (seed %d) %s; ring buildings by floors (seed %d): %s" % (
        min(cv), f(pctl(cv, 0.5), 0), max(cv), recs[0]["seed"], rims[0]["coverQuad"], recs[0]["seed"], sorted(b["floors"] for b in rims[0]["ring"])))


def judge_mill(v, R, recs, wseeds):
    m = "deepwood"
    n = len(recs)
    mills = [r["mill"] for r in recs]
    nob = [r["seed"] for r in recs if not r["mill"].get("bridges")]
    bl = [(r["mill"].get("bridge") or {}) for r in recs if r["mill"].get("bridges")]
    R.row("bridge-present", m, not nob, ("a bridge on every one of %d seeds: length median %s m (min %s), deep water covered median %s m, width median %s m, %s slabs, %s m from the mill" % (
        n, f(pctl([b["len"] for b in bl], 0.5)), f(min(b["len"] for b in bl)), f(pctl([b["wetLen"] for b in bl], 0.5)), f(pctl([b["width"] for b in bl], 0.5)), f(pctl([b["slabs"] for b in bl], 0.5), 0), f(pctl([b["distFromMill"] for b in bl], 0.5), 0)) if not nob else
        "no bridge (no walkable cluster covering >= 8 m of deep water with dry ground past both ends) on %d of %d seeds%s; structures over the river within %s m of the mill: %s" % (
            len(nob), n, (" (first %s)" % nob[:6]) if nob else "", mills[0].get("radius"), sorted({r["mill"].get("overWater", 0) for r in recs}))), "a bridge on every seed")
    walk_seeds = [r for r in recs if r["seed"] in set(wseeds)]
    walked = [r for r in walk_seeds if r["mill"].get("walks")]
    nobridge_w = [r["seed"] for r in walk_seeds if not r["mill"].get("walks")]       # a walk seed without a bridge has 0 of its WALKS_PER_SEED walks
    if len(walk_seeds) < WALK_SEEDS_MIN:
        R.row("bridge-walk", m, None, "only %d walk seeds were run (need %d)" % (len(walk_seeds), WALK_SEEDS_MIN), "every walk on >= %d walk seeds" % WALK_SEEDS_MIN)
    else:
        # the total is what the probe walked (5 lanes x walk / sprint x both ways = 20 per seed; a deck under 1.4 m wide folds its duplicate lanes away) + 20 lost walks per walk seed with no bridge
        tot = sum(r["mill"]["walks"]["n"] for r in walked) + WALKS_PER_SEED * len(nobridge_w)
        ok = sum(r["mill"]["walks"]["ok"] for r in walked)
        short = [r for r in walked if r["mill"]["walks"]["ok"] < r["mill"]["walks"]["n"]]
        ew = [r["seed"] for r in walked if r["mill"]["walks"].get("axisEW")]
        wok = sum(r["mill"]["walks"].get("walkOk", 0) for r in walked)
        sok = sum(r["mill"]["walks"].get("sprintOk", 0) for r in walked)
        lanes = walked[0]["mill"]["walks"].get("lanes") if walked else None
        per = ("seeds short: " + "; ".join("s%d%s %d/%d" % (r["seed"], " (E-W)" if r["mill"]["walks"].get("axisEW") else "", r["mill"]["walks"]["ok"], r["mill"]["walks"]["n"]) for r in short[:12])
               + (" (+%d more)" % (len(short) - 12) if len(short) > 12 else "")) if short else ("every walked seed clean" if walked else "nothing walked")
        if nobridge_w:
            per += "; no bridge on walk seeds %s" % nobridge_w[:8]
        fails = [(r["seed"], w) for r in walked for w in r["mill"]["walks"]["list"] if not w["ok"]]
        ftxt = "; first failure: seed %d %s lat %s %s %s at %s (%s m left)" % (fails[0][0], fails[0][1]["dir"], fails[0][1]["lat"], "sprint" if fails[0][1].get("sprint") else "walk",
                                                                          fails[0][1].get("why"), fails[0][1].get("at"), fails[0][1].get("left")) if fails else ""
        R.row("bridge-walk", m, ok == tot and not nobridge_w,
              "the real mover crossed the bridge on %d of %d walks (%d walk seeds, %d of them E-W bridges %s; lanes over the full deck width, seed %s: %s m; walking %d ok, sprinting %d ok, both ways): %s%s" % (
                  ok, tot, len(walk_seeds), len(ew), ew[:10], walked[0]["seed"] if walked else "-", lanes, wok, sok, per, ftxt),
              "every walk (5 lanes over the full deck width x walk / sprint x both ways) on every walk seed")
    fl = [(r["seed"], r["water"]["floatNear"]) for r in recs if r["water"] and r["water"]["floatNear"]]
    cand = [r["water"]["candidatesNear"] for r in recs if r["water"]]
    R.row("bridge-grounded", m, not fl and not nob, ("nothing carried by nothing over the river near the mill: %d near-surface structure pieces over deep water scanned per seed (median %s), 0 floating on %d seeds" % (
        sum(cand) // max(1, len(cand)), f(pctl(cand, 0.5), 0), n)) if not fl and not nob else (
        ("%d seeds have a piece over the river that nothing carries (seed, count): %s; first: %s" % (len(fl), fl[:6], next(r for r in recs if r["water"] and r["water"]["floatNear"])["water"]["floatNearList"][:2])) if fl else
        "no bridge on %d seeds, so no deck or pier to ground" % len(nob)), "0 floating pieces over the river on every seed, a bridge on every seed")
    endsteps = [b["endStep"] for b in bl if b.get("endStep")]
    if endsteps:
        v.info("bridge ends (INFORMATION)", "slab top at each end minus the ground 1 m beyond it (seed %d): %s" % ([r["seed"] for r in recs if r["mill"].get("bridges")][0], endsteps[0]))


def judge_water(v, recs, map_id):
    fl = [(r["seed"], r["water"]["floating"]) for r in recs if r["water"]]
    if not fl:
        return
    first = next((r for r in recs if r["water"] and r["water"]["floating"]), None)
    v.info("float-water [%s] (INFORMATION: map-wide)" % map_id, "pieces over deep water near the surface that nothing carries: seeds with any %d of %d, max %d%s" % (
        sum(1 for x in fl if x[1]), len(fl), max(x[1] for x in fl), ("; first: seed %d at %s" % (first["seed"], first["water"]["floatList"][:2])) if first else ""))


ap_default_walk = "1-60,1234,2026,31337"      # stage C: the 60-seed sweep (E-W bridges on 9, 15, 27, 57 of 1-60 on the stage-B tree) + the census seeds (31337: E-W)


def main_fn(v, args):
    plant = args.plant
    if plant and plant not in PLANT_ROWS:
        raise C.HarnessError("unknown --plant %r (known: %s)" % (plant, ", ".join(sorted(PLANT_ROWS))))
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    root, label = C.ROOT, "working copy"
    fixture_dir = None
    if args.fixture:
        fixture_dir = build_fixture()
        root, label = fixture_dir, "FIXTURE (%s + a hand-made rim village and a plank bridge)" % FIXTURE_REV
        if args.walk_seeds == ap_default_walk:
            args.walk_seeds = FIXTURE_WALK_SEEDS
    elif args.root:                                 # a scratch tree (the harness's own fixtures / self-tests); the served game is irrelevant here: this gate is Node only
        root, label = os.path.abspath(args.root), "scratch tree " + os.path.abspath(args.root)
    elif args.rev:
        root, sha = PC.rev_root(args.rev)
        label = "git " + sha
    maps = [m for m in (args.maps or ",".join(("isla_viva", "deepwood"))).split(",") if m]
    if plant:
        maps = [PLANT_MAP[plant]]
    block = [m for m in (",".join(("isla_viva", "deepwood")) if args.block_maps == "all" else args.block_maps).split(",") if m]
    seeds = args.seeds or ("1-12" if args.quick else "1-40")
    out = os.path.join(tempfile.gettempdir(), "lc_endgame_%d.json" % os.getpid())
    cmd = ["node", PROBE, "--root", root, "--vendor", vendor, "--maps", ",".join(maps), "--seeds", seeds, "--walk-seeds", args.walk_seeds, "--out", out]
    if plant:
        cmd += ["--plant", plant]
    print("%s: %s | maps %s | seeds %s | walk seeds %s | counted maps %s | plant %s" % (GATE, label, ",".join(maps), seeds, args.walk_seeds, ",".join(block) or "none", plant or "none"), flush=True)
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=args.timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("probe_endgame.mjs still running after %d s" % args.timeout)
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("probe_endgame.mjs exit %s: %s" % (p.returncode, " | ".join((p.stderr or p.stdout or "").strip().splitlines()[-4:])[:500]))
    with open(out, encoding="utf-8") as fh:
        doc = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    v.data["probeWallS"] = doc.get("wallS")
    v.data["records"] = [{k: val for k, val in r.items() if k != "rim"} | ({"rimSummary": {k: val for k, val in r["rim"].items() if k not in ("ring",)}} if r.get("rim") else {}) for r in doc["records"]]
    R = Rows(v, block, plant)
    v.info("probe", "%d (map, seed) builds in %.0f s (genVersion %s)" % (len(doc["records"]), time.time() - t0, sorted({r.get("genVersion") for r in doc["records"]})))
    for m in maps:
        recs = [r for r in doc["records"] if r["map"] == m]
        if not recs:
            v.cnj("probe [%s]" % m, "the probe returned no record")
            continue
        if m == "isla_viva":
            judge_rim(v, R, recs)
        elif m == "deepwood":
            judge_mill(v, R, recs, doc.get("walkSeeds") or [])
        judge_water(v, recs, m)
    v.data["rows"] = dict(R.state)
    if fixture_dir:
        shutil.rmtree(fixture_dir, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=None, help="comma list (default isla_viva,deepwood)")
    ap.add_argument("--block-maps", default="all", help="maps whose rows COUNT (default all; the others print would PASS / would FAIL)")
    ap.add_argument("--seeds", default=None, help="seed list / range for the probe (default 1-40; --quick 1-12)")
    ap.add_argument("--walk-seeds", default=ap_default_walk, help="seeds on which the Deepwood bridge is WALKED (20 walks each)")
    ap.add_argument("--quick", action="store_true", help="seeds 1-12")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--fixture", choices=["good"], default=None, help="the harness self-test: measure the scratch fixture (%s + a hand-made rim village and plank bridge); every row must PASS, every --plant must FAIL its row" % FIXTURE_REV)
    ap.add_argument("--root", default=None, help="a scratch game tree (runtime/ + assets/props) to measure instead of the working copy or --rev (fixtures, self-tests)")
    ap.add_argument("--timeout", type=int, default=3600)
    args = ap.parse_args()
    if args.plant and not args.report:
        args.report = "endgamecheck_plant_" + args.plant.replace("-", "_")
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
