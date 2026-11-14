# -*- coding: utf-8 -*-
"""VERIFY pass, part 2 - the locks the blind ladder driver could not decide.

Every battery RESUMES the game first (a probe that lands on a crest opens the
clear card and every measurement after it reads a celebrating game) and VERIFIES
the course actually loaded before it measures anything.

Writes _harness/_playreports/_vf_locks2.json
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _lf_lib import Lane

OUT = os.path.join(HERE, "_playreports", "_vf_locks2.json")
R = {}


def rec(key, verdict, evidence, **kw):
    R[key] = dict(verdict=verdict, evidence=evidence, **kw)
    print("[%s] %s :: %s" % (key, verdict, evidence), flush=True)
    json.dump(R, open(OUT, "w"), indent=1)


def resume(p):
    gs = p.js("()=>CRESTBOUND.game.state")
    if gs in ("playing", "keep"):
        return gs
    for _ in range(8):
        p.js("()=>{const g=CRESTBOUND.game; try{ if(g.__dev.clearChoice) g.__dev.clearChoice('stay'); }catch(e){} "
             "try{ if(g.menu && g.menu.isOpen) g.menu.close(); }catch(e){} }")
        p.wait(400)
        gs = p.js("()=>CRESTBOUND.game.state")
        if gs in ("playing", "keep"):
            break
    return gs


def here(p):
    return p.js("()=>{const g=CRESTBOUND.game; return (g.course&&g.course.def)?g.course.def.id:null;}")


def go(p, cid):
    for _ in range(3):
        resume(p)
        p.goto_course(cid)
        resume(p)
        if here(p) == cid:
            return True
        p.wait(1200)
    return here(p) == cid


def tp(p, x, y, z):
    p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", [x, y, z])


with Lane("vf_locks2") as p:
    p.click_title(); p.wait(900)

    # ---------------------------------------------- azure-1 tide-switch pedestal
    ok = go(p, "azure-1")
    tide = {}
    if ok:
        # stand square in front of it and pound from close range
        for approach in ([-4.5, 6.9, -31.6], [-2.9, 6.9, -33.4], [-4.5, 6.9, -35.2]):
            resume(p)
            tp(p, approach[0], approach[1], approach[2])
            p.wait(1100)
            p.face(-4.5, -33.4)
            p.down("W"); p.wait(600); p.up("W"); p.wait(300)
            a = p.snap()
            p.tap("Space", 110); p.wait(300); p.tap("C", 140); p.wait(1800)
            b = [k for k in p.lf("breakables") if abs(k["p"][0] + 4.5) < 1.0 and abs(k["p"][2] + 33.4) < 1.0]
            tide = {"approach": approach, "stoodAt": [a["x"], a["y"], a["z"]],
                    "broken": bool(b and b[0]["broken"]), "triggers": p.lf("triggered")}
            print("   tide try", tide, flush=True)
            if tide["broken"]:
                break
    rec("azure-1#00.tide", "FIXED" if tide.get("broken") else "STILL REPRODUCES",
        "tide-switch pedestal (-4.5, 5.65, -33.4): %s" % json.dumps(tide))

    # ---------------------------------------------- azure-1#02 the great stair
    resume(p)
    tp(p, 0.0, -0.6, 12.0)
    p.wait(1900)
    a = p.snap()
    p.face(0.0, -14.0); p.down("W")
    tr, cause, top = [], None, a["y"]
    for _ in range(20):
        p.wait(500)
        s = p.snap()
        tr.append([s["x"], s["y"], s["z"], s["st"]])
        top = max(top, s["y"])
        if s["st"] == "dead" or s["deaths"] > a["deaths"]:
            cause = p.js("()=>{const P=CRESTBOUND.game.player; return P.deathCause||null;}")
            break
        if s["y"] > 4.9 and s["gr"] and s["z"] < -9.0:
            break
    p.up("W"); p.wait(600)
    b = p.snap()
    climbed = top > 4.9
    survived = (b["deaths"] == a["deaths"])
    rec("azure-1#02", "FIXED" if (climbed and survived) else "STILL REPRODUCES",
        "swim at (0,-0.6,12) then hold W north: highest y %.2f (terrace top 5.00/5.61), end %s state=%s grounded=%s deaths +%d cause=%s"
        % (top, [b["x"], b["y"], b["z"]], b["st"], b["gr"], b["deaths"] - a["deaths"], cause),
        detail={"trace": tr, "climbed": climbed, "cause": cause})
    p.shot("a1_stair2")

    # ---------------------------------------------- azure-2#12 getting INTO the shaft
    ok = go(p, "azure-2")
    entry = {}
    if ok:
        for start in ([1.0, 33.2, -6.6], [2.6, 33.2, -6.6], [6.6, 33.2, -2.6]):
            resume(p)
            tp(p, start[0], start[1], start[2])
            p.wait(1300)
            a = p.snap()
            p.face(6.6, -6.6) if abs(start[2] + 6.6) < 0.1 else p.face(6.6, -6.6)
            p.down("W")
            tr = []
            for _ in range(14):
                p.wait(350)
                s = p.snap(); tr.append([s["x"], s["y"], s["z"], s["st"]])
                if abs(s["x"] - 6.6) < 1.2 and abs(s["z"] + 6.6) < 1.2:
                    break
            p.up("W"); p.wait(500)
            e = p.snap()
            entry = {"from": start, "start": [a["x"], a["y"], a["z"]], "end": [e["x"], e["y"], e["z"]],
                     "state": e["st"], "inside": bool(abs(e["x"] - 6.6) < 1.6 and abs(e["z"] + 6.6) < 1.6),
                     "trace": tr[-4:]}
            print("   a2 entry try", json.dumps(entry), flush=True)
            if entry["inside"]:
                break
    rec("azure-2#12.entry", "FIXED" if entry.get("inside") else "STILL REPRODUCES",
        "walk into the winding shaft at (6.60, -6.60): %s" % json.dumps(entry))

    # ---------------------------------------------- azure-3#21 the gauntlet steps
    ok = go(p, "azure-3")
    gres = []
    if ok:
        # the three deck steps, each driven with a long straight run-up and a TRIPLE
        steps = [["start->mid", [-27.0, 50.0, -62.0], [-25.0, 53.0, -62.0]],
                 ["mid->east", [-25.0, 53.0, -62.0], [-21.0, 56.0, -62.0]]]
        for name, aP, bP in steps:
            resume(p)
            tp(p, aP[0] - 8.0, aP[1] + 0.5, aP[2])
            p.wait(1200)
            s0 = p.snap()
            if abs(s0["y"] - aP[1]) > 2.5:
                gres.append({"gap": name, "placed": False, "at": [s0["x"], s0["y"], s0["z"]]})
                continue
            p.face(bP[0], bP[2])
            p.down("W"); p.wait(1000)
            # triple: three jumps, each within the chain window
            p.tap("Space", 110); p.wait(330)
            p.tap("Space", 110); p.wait(330)
            p.tap("Space", 110)
            best = -99.0
            for _ in range(16):
                p.wait(180); s = p.snap(); best = max(best, s["y"])
                if s["gr"] and s["y"] >= bP[1] - 0.6:
                    break
            p.up("W"); p.wait(900)
            e = p.snap()
            gres.append({"gap": name, "placed": True, "apex": round(best - aP[1], 2), "need": round(bP[1] - aP[1], 2),
                         "end": [e["x"], e["y"], e["z"]], "grounded": e["gr"],
                         "landed": bool(e["gr"] and e["y"] >= bP[1] - 0.6)})
            print("   a3 step", json.dumps(gres[-1]), flush=True)
    okall = bool(gres) and all(g.get("landed") for g in gres)
    rec("azure-3#21", "FIXED" if okall else "STILL REPRODUCES",
        "triple jump with an 8 m straight run-up at each deck step: " + json.dumps(gres), detail=gres)

    # ---------------------------------------------- rime-2#15 the west ice face
    ok = go(p, "rime-2")
    ice = {}
    if ok:
        resume(p)
        tp(p, -25.4, 3.50, 23.4)
        p.wait(1200)
        s0 = p.snap()
        if abs(s0["y"] - 3.30) < 2.0:
            p.face(-27.6, 19.0)
            p.down("W"); p.wait(650)
            p.tap("Space", 110); p.wait(300)
            p.tap("Space", 110)
            best = -99.0
            for _ in range(16):
                p.wait(180); s = p.snap(); best = max(best, s["y"])
                if s["gr"] and s["y"] >= 5.3:
                    break
            p.up("W"); p.wait(900)
            e = p.snap()
            ice = {"placedAt": [s0["x"], s0["y"], s0["z"]], "apex": round(best - 3.30, 2), "need": 2.40,
                   "end": [e["x"], e["y"], e["z"]], "grounded": e["gr"],
                   "landed": bool(e["gr"] and e["y"] >= 5.3 and abs(e["x"] + 27.6) < 2.6 and abs(e["z"] - 19.0) < 3.0)}
        else:
            ice = {"placed": False, "at": [s0["x"], s0["y"], s0["z"]]}
    rec("rime-2#15", "FIXED" if ice.get("landed") else "STILL REPRODUCES",
        "double jump serac 1 (-26.4, 3.30, 21.6) -> serac 2 (-27.6, 5.70, 19.0): %s" % json.dumps(ice))

    p.say("WROTE", OUT)
    p.dump("vf_locks2")
