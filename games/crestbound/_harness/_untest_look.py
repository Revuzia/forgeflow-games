# -*- coding: utf-8 -*-
"""LOOK-AT pass for the frame claims among the untestable defects.

    python _untest_look.py <course> [<course> ...] | --all

A colour / legibility complaint ("the gold deck reads as pond scum", "the sign
covers the frame") cannot be answered by a state probe, and it is not answered by
a screenshot taken with the hero standing ON the thing either — the object ends up
under his feet or behind the lens. This pass does what the tester did: it stands
BACK from the station and points the camera AT it, then records

  * the frame (a PNG a human can read),
  * the resolved material of every mesh within 6 m of the station,
  * how much of that frame each near mesh takes.

Output `_replayout/look_<course>.json` + `_shots/play_look_<course>/*.png`.
"""
import json, math, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _untestlib import Probe, stations_from_text

RP = os.path.join(HERE, "_playreports")
OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

VERD = json.load(open(os.path.join(RP, "_replay_verdicts.json"), encoding="utf-8"))
IDX = {d["key"]: d for d in json.load(open(os.path.join(RP, "_defects_index.json"), encoding="utf-8"))}
try:
    HANDPOS = json.load(open(os.path.join(RP, "_untest_stations.json"), encoding="utf-8"))
except Exception:
    HANDPOS = {}

sys.path.insert(0, HERE)
import _untest_verdict as UV        # for claims()

COURSES = ["keep", "verdant-1", "verdant-2", "verdant-3", "ember-1", "ember-2", "ember-3",
           "ember-4", "rime-1", "rime-2", "rime-3", "azure-1", "azure-2", "azure-3"]


def wanted(course):
    out = []
    for v in VERD["verdicts"]:
        if v["verdict"] != "COULD NOT TEST" or v["course"] != course:
            continue
        d = IDX[v["key"]]
        if UV.claims(d) & {"visual", "text", "viewBlocked", "rigid"}:
            out.append(v["key"])
    return out


def station_for(d, p):
    hp = HANDPOS.get(d["key"])
    if hp:
        return list(hp["p"]), "handmap"
    if d.get("coords"):
        c = d["coords"][0]
        return [float(c[0]), float(c[1]), float(c[2])], "index"
    st = stations_from_text(d, 1)
    if not st:
        return None, None
    s = st[0]
    if s.get("needsGround") or s["p"][1] == 0.0:
        g = p.cbx("groundAt", s["p"][0], s["p"][2], 400)
        y = (g or {}).get("ray", {}).get("y") if (g or {}).get("ray") else (g or {}).get("hf")
        if y is not None:
            s["p"][1] = round(y + 0.15, 2)
    return s["p"], s["kind"]


def look(p, xyz, tag, back=7.0):
    """Stand `back` metres away on solid ground and aim the lens at the station."""
    shots = []
    for name, ang in (("S", 0.0), ("E", math.pi / 2), ("W", -math.pi / 2)):
        sx = xyz[0] + back * math.sin(ang)
        sz = xyz[2] + back * math.cos(ang)
        g = p.cbx("groundAt", sx, sz, xyz[1] + 30)
        sy = None
        if g and g.get("ray"):
            sy = g["ray"]["y"] + 0.15
        elif g and g.get("hf") is not None:
            sy = g["hf"] + 0.15
        if sy is None or abs(sy - xyz[1]) > 12:
            sy = xyz[1] + 1.2          # nothing to stand on: hover the lens instead
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}",
             [sx, sy, sz])
        p.wait(420)
        p.face(xyz[0], xyz[2])
        # pitch the lens at the target's height so a tall object is in frame
        p.js("""(a)=>{ const G=CRESTBOUND.game, C=G.cam; if(!C) return;
              const dy=a[1]-(G.player.pos.y+1.2), d=Math.hypot(a[0]-G.player.pos.x, a[2]-G.player.pos.z);
              C.pitch = Math.max(-0.5, Math.min(0.9, -Math.atan2(dy, Math.max(0.5,d)))); C._rcHoldT=0; }""", xyz)
        p.wait(700)
        sb = p.cbx("screenBlockers", 0.03)
        try:
            fs = p.frame_stats((0.0, 0.0, 1.0, 1.0), "%s_%s" % (tag, name))
        except Exception as e:
            fs = {"error": str(e)[:120]}
        shots.append({"from": name, "at": [round(sx, 2), round(sy, 2), round(sz, 2)],
                      "frame": fs, "blockers": (sb or {}).get("blockers", [])[:4],
                      "occluders": (sb or {}).get("occluders", [])[:3]})
    return shots


def run_course(course, keys):
    res = {"course": course, "generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "defects": {}}
    with Probe("look_" + course) as p:
        p.click_title(); p.wait(1000)
        p.unlock_all(); p.wait(300)
        p.install()
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(80):
                p.wait(250)
                if p.js("()=>CRESTBOUND.game.state==='playing' && CRESTBOUND.game.courseId===%s" % json.dumps(course)):
                    break
        p.wait(1400)
        res["loaded"] = p.js("()=>({id:CRESTBOUND.game.courseId,state:CRESTBOUND.game.state})")
        res["audit"] = p.cbx("courseAudit")
        for i, key in enumerate(keys):
            d = IDX[key]
            t0 = time.time()
            rec = {"key": key}
            try:
                xyz, kind = station_for(d, p)
                rec["station"], rec["stationKind"] = xyz, kind
                if xyz:
                    rec["mats"] = p.cbx("matsNear", xyz[0], xyz[1], xyz[2], 7)
                    rec["shots"] = look(p, xyz, key.replace("#", "_"))
            except Exception as e:
                rec["error"] = ("%s: %s" % (type(e).__name__, e))[:240]
            rec["ms"] = int((time.time() - t0) * 1000)
            res["defects"][key] = rec
            print("  [%2d/%2d] %-14s %6d ms  %s" % (i + 1, len(keys), key, rec["ms"],
                                                    rec.get("error") or rec.get("station")), flush=True)
        res["console"] = p.console[:40]
    with open(os.path.join(OUT, "look_%s.json" % course), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
    return res


if __name__ == "__main__":
    args = sys.argv[1:]
    todo = COURSES if (not args or args[0] == "--all") else args
    for c in todo:
        ks = wanted(c)
        if not ks:
            print("=== %s : no frame claims" % c, flush=True)
            continue
        print("=== %s : %d frame claims" % (c, len(ks)), flush=True)
        run_course(c, ks)
