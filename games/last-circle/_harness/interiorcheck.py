#!/usr/bin/env python
"""interiorcheck - are the enterable houses real furnished interiors a player can use? (Last Circle Wave 8, plan section 4 "interiorcheck"; stage A, lane H3.)

    python _harness/interiorcheck.py --disk --source fixture                 # the gate's own reference house: every row must PASS
    python _harness/interiorcheck.py --disk --source fixture --plant furniture-in-door   # planted faults: each must FAIL (exit 1)
    python _harness/interiorcheck.py --disk --source fixture --plant window-solid
    python _harness/interiorcheck.py --disk --source fixture --plant no-ceiling
    python _harness/interiorcheck.py --disk --source housegen                # H1's housegen.js output (Node + the houses stood on a real map in a real page)
    python _harness/interiorcheck.py --disk --source match --maps ashgrid    # a real match map: the map's house records (stage B), else the room survey
    python _harness/interiorcheck.py --rev 6191b380 --source match            # the MUST-FAIL proof: the live build's houses are empty boxes on terrain floors

Sources. `fixture` = probe_interior_fixture.js (a two-storey furnished house built to the rules; the selftest and the contract housegen is read
by). `housegen` = runtime/3d/royale/housegen.js through probe_interior_housegen.js (the adapter from housegen's output to the shape below).
For both, the NODE half (probe_interior_node.js) stands the houses on a flat synthetic map and walks them with player.js's tick (stepActor),
and the BROWSER half boots the game (a PRACTICE match), stands the same houses on a level dry spot of the real map (the game's lighting,
camera, mover and bullets; the house's colliders join W.map.queryColliders in this page only) and judges them again with the rendered rows.
`match` = a real map, browser only: houses from the map's records (W.map.houses / interiors / housegen.houses, once stage B wires housegen
in) or, without records, navcheck's room survey of the colliders (roofed floor lattices) - the empty box rooms of today's build.

Rows (each judged over every sampled house; counts are exact; a row that measured nothing is could-not-judge, never a pass):
  house-records       (match) the map exposes housegen house records (stage B wiring). Without them the survey still judges the rooms
  floor               every interior lattice point (0.5 m; 1 m on surveyed rooms) stands on a COLLIDER floor above the terrain, and the
                      drawn surface under it (a ray down; furniture looked through) is an up-facing non-terrain, non-grass face within 6 cm of it
  ceiling             every interior point sees a drawn, down-facing structure face straight up (and a collider over it)
  furniture-view      every room shows >= 3 furniture pieces from its best entrance (door: eye 0.6 m inside at 1.62 m, looking in; stair top:
                      looking at the room centre; an 88 x 57 deg view, a piece counts when one of 10 sample points is unoccluded by drawn walls)
  furniture-pixels    (browser, injected houses) the same, rendered: from the player's third-person view at each entrance, each piece hidden in
                      turn changes >= 60 pixels of the same frame; every room >= 3 pieces in view from its best entrance
  kit-agree           0 cells (0.1 m, robust to 2.5 cm) where the drawn walls and the colliders disagree, on elevation bitmaps of every room side;
                      banded sill / header / jamb / wall (glass and furniture excluded; stair cells skipped)
  doors               every door (an opening touching the floor) >= 2.0 m clear width (0.1 .. 1.8 m) AND >= 2.0 m headroom, by the colliders
  windows-shootable   a body-height segment through every window opening passes the game's segment test AND the drawn walls
  walls-solid         every body-height cell (0.9 .. 1.8 m) drawn solid is collider solid (no shoot-through)
  reach               every room: street -> room AND room -> street, planned on a layered 0.25 m grid and WALKED by the real mover
  loot-reach          every loot point in the house: the mover gets within loot.js's 1.5 m walk-over radius, and back out
  furniture-clear     no furniture collider or drawn furniture inside a door's clear zone (width x 0.9 m each side x 1.8 m; the records' doors when the
                      house has them, else the bitmaps') or a stair + 1 m landings
  grass-indoors       (match source) a top-down render of every room floor with the map's ground clutter drawn vs hidden changes 0 pixels; INFO for the
                      injected sources (masking grass under a house is stage B's maps.js work)
  light               every interior view (entrances, room centre x 4 headings, rendered by the game) mean luma >= 25 / 255 and <= 30 % of
                      pixels darker than 16 / 255 (an outdoor view of the same house is printed beside it; the bar was set on the first
                      measurements, before registration - see LUMA_ABS)
  camwall             Wave 4's camera pull-in inside every sampled house: the lens never inside or behind a wall box; W.noCamWall must violate
  errors              0 page errors / console errors / failed requests
  information         per-house draw calls / triangles (the house object, and the frame from inside), the bitmaps' near-edge cells, timing

`--simulate-records` (match source): stands housegen houses on the map and exposes them as W.map.houses, so stage B's records path runs before
stage B exists (the same rows, house-records PASS). Stage B contract: W.map.houses (or .interiors / .housegen.houses) = housegen house objects,
their colliders inside W.map.colliders, the furniture meshes under an object named "furniture" (or userData.lcPart "furniture").

Plants (`--plant`, fixture and housegen sources; only the designated rows count, the others print as information):
  furniture-in-door   a 1.4 m crate inside the front door              -> furniture-clear FAILS
  window-solid        a box collider filling one ground-floor window   -> windows-shootable and kit-agree FAIL
  no-ceiling          the top storey's roof and ceiling not drawn      -> ceiling FAILS
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "interiorcheck"
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "probe_interior.js")
FIX = os.path.join(HERE, "probe_interior_fixture.js")
PAGE = os.path.join(HERE, "probe_interior_page.js")
HGA = os.path.join(HERE, "probe_interior_housegen.js")
NODE_PROBE = os.path.join(HERE, "probe_interior_node.js")
PLANT_ROWS = {"furniture-in-door": {"furniture-clear"}, "window-solid": {"windows-shootable", "kit-agree"}, "no-ceiling": {"ceiling"},
              # Wave 8 stage B (lane I4): the controls of the two definition corrections (VERSION 2 of probe_interior.js)
              "empty-room": {"furniture-view", "furniture-pixels"},      # one room holds no furniture: only a neighbour's pieces can be seen from its door
              "crate-steps": {"reach", "loot-reach"}}                   # (fixture) the front door reachable only over furniture tops
FURN_MIN = 3
DOOR_MIN = 2.0
LUMA_ABS = 25.0              # every interior view: mean luma >= 25 / 255 ("not black") and <= 30 % of its pixels under 16 / 255. Set on the first measurements,
DARK_MAX = 0.30              # 2026-10-19, before registration: live box interiors 35.5-63, housegen interiors 64-108, outdoor 53-199 (Deepwood is the dark map:
                             # its outdoor views read 53-63, a floor tied to the outdoor view swung with how much sky the outdoor frame held - dropped)
PX_MIN = 60


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


class Rows:
    def __init__(self, v, plant):
        self.v, self.plant = v, plant

    def check(self, name, ok, detail):
        if self.plant and name.split(" [")[0] not in PLANT_ROWS.get(self.plant, set()):
            self.v.info(name + " (not counted under --plant)", ("would PASS: " if ok else "would FAIL: " if ok is False else "could not judge: ") + str(detail))
            return
        if ok is None:
            self.v.cnj(name, detail)
        else:
            self.v.check(name, ok, detail)


# ─────────────────────────────── aggregation over judged houses ───────────────────────────────
def aggregate(houses):
    """houses: list of (label, static, reach, extra) -> per-row (ok, detail)."""
    A = {}
    pts = sum(h["floor"]["points"] for _, h, _, _ in houses)
    bad = sum(h["floor"]["bad"] for _, h, _, _ in houses)
    ex = [dict(e, house=l) for l, h, _, _ in houses for e in h["floor"]["examples"]][:5]
    kinds = {}
    for _, h, _, _ in houses:
        for k in ("onTerrain", "noDrawn", "drawnTerrain", "drawnSoft", "drawnOff"):
            kinds[k] = kinds.get(k, 0) + h["floor"][k]
    A["floor"] = (None if not pts else bad == 0, "%d of %d interior points are a real floor (bad by kind %s) %s" % (pts - bad, pts, kinds, ex))
    cp = sum(h["ceiling"]["points"] for _, h, _, _ in houses)
    cs = sum(h["ceiling"]["seen"] for _, h, _, _ in houses)
    cn = sum(h["ceiling"]["noCollider"] for _, h, _, _ in houses)
    cex = [dict(e, house=l) for l, h, _, _ in houses for e in h["ceiling"]["examples"]][:4]
    A["ceiling"] = (None if not cp else (cs == cp and cn == 0), "a drawn ceiling over %d of %d interior points (%d without a collider above) %s" % (cs, cp, cn, cex))
    rooms = [(l, r) for l, h, _, _ in houses for r in h["view"]]
    poor = [(l, r) for l, r in rooms if r["bestInView"] < FURN_MIN]
    kinds = {}
    for l, r in rooms:
        k = kinds.setdefault(r.get("kind") or "?", [0, 0, 0])
        k[0] += 1
        if r["bestInView"] >= FURN_MIN:
            k[1] += 1
        if r["furnitureInRoom"] < FURN_MIN:
            k[2] += 1
    borrowed = [(l, r) for l, r in poor if r.get("bestInViewAll", 0) >= FURN_MIN]
    A["furniture-view"] = (None if not rooms else not poor, "%d of %d rooms show >= %d of their OWN furniture pieces from their best entrance (%d of the short rooms hold fewer than %d pieces at all; %d would pass on a neighbour room's pieces seen through the doorway - the stage-A definition); by room kind [rooms, ok, < %d pieces in the room] %s; furniture per house %s; worst %s" % (
        len(rooms) - len(poor), len(rooms), FURN_MIN, sum(1 for _, r in poor if r["furnitureInRoom"] < FURN_MIN), FURN_MIN, len(borrowed), FURN_MIN, kinds, [h["furniture"] for _, h, _, _ in houses][:12],
        [{"house": l, "room": r["room"], "kind": r.get("kind"), "floor": r["floor"], "entrances": r["entrances"], "inView": r["bestInView"], "inViewWithNeighbours": r.get("bestInViewAll"), "inRoom": r["furnitureInRoom"]} for l, r in poor[:6]]))
    dis = {}
    for _, h, _, _ in houses:
        for k, n in h["openings"]["dis"].items():
            dis[k] = dis.get(k, 0) + n
    dex = [dict(e, house=l) for l, h, _, _ in houses for e in h["openings"]["disExamples"]][:5]
    tot = sum(dis.get(k, 0) for k in ("sill", "header", "jamb", "inOpening", "hole", "other"))
    A["kit-agree"] = (None if not houses else tot == 0, "%d disagreeing cells (sill %d, header %d, jamb %d, in-opening %d, hole %d, other %d; drawn-solid/collider-open %d, drawn-open/collider-solid %d) on %d room sides %s" % (
        tot, dis.get("sill", 0), dis.get("header", 0), dis.get("jamb", 0), dis.get("inOpening", 0), dis.get("hole", 0), dis.get("other", 0), dis.get("phantomOpen", 0), dis.get("invisibleWall", 0),
        sum(h["openings"]["sides"] for _, h, _, _ in houses), dex))
    doors = [(l, d) for l, h, _, _ in houses for d in h["openings"]["doors"]]
    narrow = [(l, d) for l, d in doors if d["width"] < DOOR_MIN - 1e-6 or d["headroom"] < DOOR_MIN - 1e-6]
    ws = sorted(d["width"] for _, d in doors)
    hs = sorted(d["headroom"] for _, d in doors)
    A["doors"] = (None if not doors else not narrow, "%d of %d doors >= %.1f m wide AND >= %.1f m headroom (width min %s median %s, headroom min %s; exterior %d) %s" % (
        len(doors) - len(narrow), len(doors), DOOR_MIN, DOOR_MIN, ws[0] if ws else "-", ws[len(ws) // 2] if ws else "-", hs[0] if hs else "-",
        sum(1 for _, d in doors if d["exterior"]), [dict(d, house=l) for l, d in narrow[:5]]))
    wn = sum(h["openings"]["winShots"]["n"] for _, h, _, _ in houses)
    wp = sum(h["openings"]["winShots"]["pass"] for _, h, _, _ in houses)
    wex = [dict(e, house=l) for l, h, _, _ in houses for e in h["openings"]["winShots"]["examples"]][:5]
    A["windows-shootable"] = (None if not wn else wp == wn, "%d of %d windows pass a body-height shot (colliders AND drawn walls) %s" % (wp, wn, wex))
    sn = sum(h["openings"]["wallShots"]["n"] for _, h, _, _ in houses)
    sb = sum(h["openings"]["wallShots"]["blocked"] for _, h, _, _ in houses)
    sex = [dict(e, house=l) for l, h, _, _ in houses for e in h["openings"]["wallShots"]["examples"]][:5]
    A["walls-solid"] = (None if not sn else sb == sn, "%d of %d body-height drawn-solid wall cells stop a shot (collider) %s" % (sb, sn, sex))
    rr = [(l, r) for l, _, rc, _ in houses if rc and not rc.get("error") for r in rc["rooms"]]
    rerr = [l for l, _, rc, _ in houses if rc and rc.get("error")]
    rok = [(l, r) for l, r in rr if r["inOk"] and r["outOk"]]
    rplan = [(l, r) for l, r in rr if r["planned"]]
    rbad = [(l, r) for l, r in rr if not (r["inOk"] and r["outOk"])]
    def why(r):
        return {k: r[k] for k in ("room", "floor", "y", "planned", "inOk", "outOk", "why", "inFail", "outFail") if k in r}
    A["reach"] = (None if (not rr or rerr) else len(rok) == len(rr), "%d of %d rooms walked street -> room -> street by the real mover (%d planned; upper floors %d of %d)%s %s" % (
        len(rok), len(rr), len(rplan), sum(1 for _, r in rok if r["floor"] > 0), sum(1 for _, r in rr if r["floor"] > 0),
        (" walker errors in %s" % rerr) if rerr else "", [dict(why(r), house=l) for l, r in rbad[:4]]))
    lr = [(l, r) for l, _, rc, _ in houses if rc and not rc.get("error") for r in rc["loot"]]
    lok = [(l, r) for l, r in lr if r["inOk"] and r["outOk"]]
    A["loot-reach"] = (None if (not lr or rerr) else len(lok) == len(lr), "%d of %d loot points reached (walk-over radius) and left by the real mover %s" % (
        len(lok), len(lr), [dict({k: r[k] for k in ("at", "planned", "inOk", "outOk", "why") if k in r}, house=l) for l, r in lr if not (r["inOk"] and r["outOk"])][:4]))
    bl = [dict(b, house=l) for l, h, _, _ in houses for b in h["clear"]["blocked"]]
    nd = sum(h["clear"]["doors"] for _, h, _, _ in houses)
    ns = sum(h["clear"]["stairs"] for _, h, _, _ in houses)
    A["furniture-clear"] = (None if not (nd + ns) else not bl, "%d of %d doors and stairs clear of furniture (%d doors, %d stairs) %s" % (nd + ns - len(bl), nd + ns, nd, ns, bl[:5]))
    return A


def node_half(args, v):
    """probe_interior_node.js -> list of (label, static, reach, extra)"""
    out = os.path.join(tempfile.gettempdir(), "lcint_node_%d.json" % os.getpid())
    root = os.path.dirname(HERE)
    tmp = None
    if getattr(args, "rev", None):
        tmp = tempfile.mkdtemp(prefix="lcint_rev_")
        g = C.git_blobs(args.rev)
        # the runtime + assets the Node half reads, as committed at --rev; the harness files are the working copy's
        lst = subprocess.run(["git", "-C", C.REPO, "ls-tree", "-r", "--name-only", args.rev, "games/last-circle/runtime", "games/last-circle/assets/vendor"],
                             capture_output=True, text=True).stdout.split()
        for p in lst:
            rel = p[len("games/last-circle/"):]
            data = g.read(rel)
            if data is None:
                continue
            dst = os.path.join(tmp, rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(data)
        root = tmp
    cmd = ["node", NODE_PROBE, "--root", root, "--source", args.source, "--out", out, "--seeds", args.seeds]
    if args.plant:
        cmd += ["--plant", args.plant]
    if args.max_houses:
        cmd += ["--max-houses", str(args.max_houses)]
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    v.data["nodeSeconds"] = round(time.time() - t0, 1)
    if r.returncode != 0 or not os.path.exists(out):
        v.cnj("node half", "probe_interior_node.js rc=%s: %s" % (r.returncode, (r.stderr or r.stdout)[-900:]))
        return None
    d = json.load(open(out, encoding="utf-8"))
    os.remove(out)
    errs = [s for s in d["seeds"] if s.get("error")]
    if errs:
        v.cnj("node half", "source %s: %s" % (args.source, errs[0]["error"][:600]))
        return None
    hs = []
    for s in d["seeds"]:
        for h in s["houses"]:
            hs.append(("node:s%s:%s" % (s["seed"], h["id"]), h, h.get("reach"), {"cost": h.get("cost")}))
    v.data["node"] = {"houses": len(hs), "ms": d.get("ms"), "cost": [h[3]["cost"] for h in hs][:40]}
    return hs


def browser_half(args, v, shots_dir):
    """One Chrome per map: PRACTICE match, the page probe; returns (houses list, page extras)"""
    maps = args.maps.split(",") if args.source == "match" else [args.maps.split(",")[0]]
    out, extras = [], {"maps": {}, "light": [], "camwall": [], "pixels": [], "cost": [], "errors": []}
    for map_id in maps:
        with C.Session(args, name=GATE) as s:
            s.boot()
            lr = s.start_match(mode="practice", seed=args.seed, map_id=map_id, guard=True)
            s.freeze_loop()
            s.js("() => { const p = window.__LC__.W.player; return !!p; }")
            s.js(read(LIB)); s.js(read(FIX))
            if os.path.exists(HGA):
                s.js(read(HGA))
            s.js(read(PAGE))
            src = "housegen" if args.simulate_records else args.source
            setup = s.js("(o) => window.__LCINT_PAGE__.setup(o)", {"source": src, "plant": args.plant, "seed": args.seed, "exposeRecords": bool(args.simulate_records)})
            if setup and setup.get("error"):
                v.cnj("browser setup [%s]" % map_id, setup["error"])
                continue
            hl = s.js("(o) => window.__LCINT_PAGE__.houses(o)", {"max": args.houses, "seed": args.seed})
            extras["maps"][map_id] = {"setup": setup, "houses": hl, "load": lr}
            print("  [%s] setup %s; houses: records=%s n=%s (surveyed %s)" % (map_id, setup, hl.get("records"), hl.get("n"), hl.get("surveyed")), flush=True)
            for i in range(hl.get("n") or 0):
                t0 = time.time()
                st = s.js("(i) => window.__LCINT_PAGE__.judge(i)", i)
                rc = s.js("(i) => window.__LCINT_PAGE__.reach(i)", i) if not args.no_walk else None
                cw = s.js("(i) => window.__LCINT_PAGE__.camwall(i, { perRoom: 2 })", i) if i < args.camwall_houses else None
                vw = s.js("([i, n]) => window.__LCINT_PAGE__.views(i, { shots: n })", [i, args.shots if i < args.shot_houses else 0])
                label = "%s:%s" % (map_id, st["id"])
                for sh in vw.pop("shots", []):
                    p = os.path.join(shots_dir, "%s_%s.png" % (map_id, sh["name"]))
                    with open(p, "wb") as f:
                        f.write(base64.b64decode(sh["url"].split(",", 1)[1]))
                    extras.setdefault("shotFiles", []).append(p)
                out.append((label, st, rc, {"views": vw, "camwall": cw}))
                print("  [%s] house %d/%d %s: %d rooms, %d furniture, floor bad %d/%d, %.0f s" % (map_id, i + 1, hl["n"], st["id"], st["rooms"], st["furniture"], st["floor"]["bad"], st["floor"]["points"], time.time() - t0), flush=True)
            d = s.diagnostics()
            extras["errors"].append({"map": map_id, "problems": C.diag_problems(d, rig=False), "pageErrors": d["pageErrors"][:4], "consoleErrors": d["consoleErrors"][:4], "failed": d["failedRequests"][:4]})
    return out, extras


def house_summary(label, h, rc, x=None):
    o = {"house": label, "rooms": h["rooms"], "storeys": h["floors"], "furniture": h["furniture"], "loot": h["loot"], "stairs": h["stairs"],
         "floorBad": "%d/%d" % (h["floor"]["bad"], h["floor"]["points"]), "ceiling": "%d/%d" % (h["ceiling"]["seen"], h["ceiling"]["points"]),
         "kitDisagree": h["openings"]["dis"], "doors": [(d["width"], d["headroom"], d["exterior"]) for d in h["openings"]["doors"]],
         "windows": "%d/%d" % (h["openings"]["winShots"]["pass"], h["openings"]["winShots"]["n"]),
         "view": [(r["room"], r.get("kind"), r["floor"], r["bestInView"], r["furnitureInRoom"]) for r in h["view"]], "clear": h["clear"]["blocked"],
         "reach": [(r["room"], r["inOk"], r["outOk"], r.get("why")) for r in (rc or {}).get("rooms", [])],
         "lootReach": "%d/%d" % (sum(1 for r in (rc or {}).get("loot", []) if r["inOk"] and r["outOk"]), len((rc or {}).get("loot", [])))}
    if x:
        vw = x.get("views") or {}
        o["light"] = {"interiorMin": min([e["luma"]["mean"] for e in vw.get("entrances", []) + vw.get("centres", [])] or [None]), "outdoor": (vw.get("outdoor") or {}).get("luma")}
        o["grass"] = [(g["room"], g["px"]) for g in vw.get("grass", []) if g["px"]]
        o["camwall"] = None if not x.get("camwall") else {"on": x["camwall"]["on"]["violations"], "off": x["camwall"]["off"]["violations"], "spots": x["camwall"]["on"]["spots"]}
        o["cost"] = {"object": vw.get("houseObject"), "insideCalls": max([e["calls"] for e in vw.get("entrances", []) + vw.get("centres", [])] or [0])}
    return o


def main(v, args):
    rows = Rows(v, args.plant)
    shots_dir = args.shots_dir or os.path.join(HERE, "_shots", "interiorcheck_%s" % time.strftime("%Y%m%d_%H%M%S"))
    if not args.node_only:
        os.makedirs(shots_dir, exist_ok=True)
    v.data.update({"source": args.source, "plant": args.plant, "maps": args.maps, "seed": args.seed, "shotsDir": shots_dir})
    hg = os.path.join(os.path.dirname(HERE), "runtime", "3d", "royale", "housegen.js")
    if os.path.exists(hg):
        import hashlib
        with open(hg, "rb") as f:
            v.data["housegenSha1"] = hashlib.sha1(f.read()).hexdigest()[:12]
        v.data["housegenMtime"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(hg)))
    if args.plant and args.source == "match":
        raise C.HarnessError("--plant applies to --source fixture / housegen (a planted fault is planted into the house the gate builds)")
    node_h = None
    if args.source in ("fixture", "housegen") and not args.browser_only:
        node_h = node_half(args, v)
        if node_h is not None:
            v.data["nodeHouses"] = [house_summary(l, h, rc) for l, h, rc, _ in node_h][:80]
            A = aggregate(node_h)
            for k, (ok, det) in A.items():
                rows.check(k + " [node]", ok, det)
            if args.plant and args.plant in PLANT_ROWS:
                pass
    if args.node_only:
        return
    br, ex = browser_half(args, v, shots_dir)
    v.data["browser"] = {k: ex[k] for k in ("maps", "errors")}
    v.data["browserHouses"] = [house_summary(l, h, rc, x) for l, h, rc, x in br]
    if args.source == "match":
        recs = [m["houses"].get("records") for m in ex["maps"].values()]
        rows.check("house-records", bool(recs) and all(recs), "the map exposes housegen house records on %d of %d maps (%s); without them the rooms come from the collider survey" % (
            sum(1 for r in recs if r), len(recs), {k: m["houses"].get("recordsField") for k, m in ex["maps"].items()}))
    if not br:
        rows.check("browser houses", None, "no house judged in the page (%s)" % {k: m["houses"].get("n") for k, m in ex["maps"].items()})
    else:
        A = aggregate(br)
        for k, (ok, det) in A.items():
            rows.check(k, ok, det)
        # rendered rows
        px = [(l, e) for l, _, _, x in br for e in x["views"]["entrances"] if e.get("furniturePx") is not None]
        if px:
            best = {}
            for l, e in px:
                key = (l, e["room"])
                best[key] = max(best.get(key, 0), e["furniturePx"]["inView"])
            poor = [(k, n) for k, n in best.items() if n < FURN_MIN]
            rows.check("furniture-pixels", not poor, "%d of %d rooms show >= %d pieces (>= %d changed pixels each) in the rendered third-person view from their best entrance; worst %s; sample %s" % (
                len(best) - len(poor), len(best), FURN_MIN, PX_MIN, poor[:5], [(l, e["room"], e["from"], e["furniturePx"]) for l, e in px[:4]]))
        else:
            v.info("furniture-pixels", "no injected furniture objects to hide (match source: the furniture is batched into the map's meshes); the geometric furniture-view row judges it")
        gr = [(l, g) for l, _, _, x in br for g in x["views"].get("grass", [])]
        gbad = [(l, g) for l, g in gr if g["px"] > 0]
        gdet = "%d of %d rooms show no ground grass on their floor (top-down render, clutter drawn vs hidden; >0 changed pixels = grass inside) %s" % (
            len(gr) - len(gbad), len(gr), [(l, g["room"], g["px"]) for l, g in gbad[:6]])
        if args.source == "match" and not args.simulate_records:
            rows.check("grass-indoors", None if not gr else not gbad, gdet)
        else:
            v.info("grass-indoors", "(not judged: masking grass under a house is stage B's maps.js work; the injected houses stand on the map's grass) " + gdet)
        lv, dark = [], []
        for l, _, _, x in br:
            od = (x["views"].get("outdoor") or {}).get("luma", {}).get("mean")
            floor = LUMA_ABS
            for e in x["views"]["entrances"] + x["views"]["centres"]:
                lv.append((l, e))
                if e["luma"]["mean"] < floor or e["luma"]["dark"] > DARK_MAX:
                    dark.append((l, dict(e, floorUsed=round(floor, 1), outdoor=od)))
        outs = [x["views"].get("outdoor") for _, _, _, x in br if x["views"].get("outdoor")]
        means = sorted(e["luma"]["mean"] for _, e in lv)
        rows.check("light", None if not lv else not dark, "%d of %d interior views readable (mean luma >= %.0f / 255, dark share <= %.0f %%): interior mean min %s / median %s; outdoor %s; darkest %s" % (
            len(lv) - len(dark), len(lv), LUMA_ABS, DARK_MAX * 100, means[0] if means else "-", means[len(means) // 2] if means else "-",
            [o["luma"]["mean"] for o in outs][:8], [(l, e["room"], e.get("from") or e.get("yaw"), e["luma"], e["floorUsed"]) for l, e in sorted(dark, key=lambda q: q[1]["luma"]["mean"])[:4]]))
        cws = [(l, x["camwall"]) for l, _, _, x in br if x.get("camwall")]
        if cws:
            von = sum(c["on"]["violations"] for _, c in cws)
            voff = sum(c["off"]["violations"] for _, c in cws)
            spots = sum(c["on"]["spots"] for _, c in cws)
            ok = None if (not spots or voff == 0) else von == 0
            rows.check("camwall", ok, "%d violations with the pull-in ON over %d spots x 12 configs x 4 frames in %d houses (pulled frames %d); control W.noCamWall: %d violations%s %s" % (
                von, spots, len(cws), sum(c["on"]["pulled"] for _, c in cws), voff, "" if voff else " (the control saw nothing: the probe measured nothing -> could-not-judge)",
                [e for _, c in cws for e in c["on"]["examples"]][:3]))
        else:
            rows.check("camwall", None, "no house swept")
        cost = [{"house": l, "rooms": h["rooms"], "storeys": h["floors"], "object": x["views"].get("houseObject"),
                 "insideCalls": max([e["calls"] for e in x["views"]["entrances"] + x["views"]["centres"]] or [0]),
                 "insideTris": max([e["tris"] for e in x["views"]["entrances"] + x["views"]["centres"]] or [0])} for l, h, _, x in br]
        v.info("cost", cost[:12])
    errs = ex["errors"]
    probs = [e for e in errs if e["problems"]]
    rows.check("errors", not probs, "0 page / console errors and failed requests on every map" if not probs else probs)


def cli():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--source", default="match", choices=["match", "fixture", "housegen"])
    ap.add_argument("--plant", default=None, choices=sorted(PLANT_ROWS))
    ap.add_argument("--maps", default="ashgrid,isla_viva,deepwood", help="match: the maps judged (fixture / housegen: the first one hosts the injected houses)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--seeds", default="1,7,1234", help="housegen seeds for the Node half")
    ap.add_argument("--houses", type=int, default=10, help="houses sampled per map in the page (match source)")
    ap.add_argument("--max-houses", type=int, default=12, help="Node half: housegen houses per seed (default 12: every storey count, theme and plan; up to 60)")
    ap.add_argument("--camwall-houses", type=int, default=4)
    ap.add_argument("--shot-houses", type=int, default=3)
    ap.add_argument("--shots", type=int, default=6, help="screenshots per shot house")
    ap.add_argument("--shots-dir", default=None)
    ap.add_argument("--no-walk", action="store_true")
    ap.add_argument("--simulate-records", action="store_true", help="match source: stand housegen houses on the map and expose them as W.map.houses (stage B's records path, before stage B)")
    ap.add_argument("--node-only", action="store_true")
    ap.add_argument("--browser-only", action="store_true")
    args = ap.parse_args()
    if args.rev:
        args.disk = True
    return C.run_gate(GATE, lambda v: main(v, args), args)


if __name__ == "__main__":
    sys.exit(cli())
