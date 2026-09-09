# -*- coding: utf-8 -*-
"""VERIFY pass - re-drive the TEN CONTENT LOCKS on the current tree.

Every lock is driven with REAL input (KeyboardEvents through Play.down/tap/face)
and decided on a number read back off the live page, never on a log line.
Writes _harness/_playreports/_vf_locks.json
"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _lf_lib import Lane

OUT = os.path.join(HERE, "_playreports", "_vf_locks.json")
R = {}


def rec(key, verdict, evidence, **kw):
    R[key] = dict(verdict=verdict, evidence=evidence, **kw)
    print("[%s] %s :: %s" % (key, verdict, evidence), flush=True)
    json.dump(R, open(OUT, "w"), indent=1)


def tp(p, x, y, z):
    p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", [x, y, z])


def kick_out(p, floor, yaw_a, yaw_b, target, kicks=6):
    tp(p, floor[0], floor[1] + 0.4, floor[2])
    p.wait(900)
    a = p.snap(); peak = a["y"]; trace = []
    p.face_yaw(yaw_a); p.down("W"); p.tap("Space", 90)
    for i in range(kicks):
        p.face_yaw(yaw_a if i % 2 == 0 else yaw_b)
        p.wait(260)
        s = p.snap(); trace.append((s["st"], s["y"]))
        p.tap("Space", 80); p.wait(330)
        s2 = p.snap(); trace.append((s2["st"], s2["y"])); peak = max(peak, s2["y"])
    p.up("W"); p.wait(1500)
    b = p.snap()
    return {"start": [a["x"], a["y"], a["z"]], "peak": round(peak, 2), "need": target,
            "cleared": peak >= target, "end": [b["x"], b["y"], b["z"]], "endState": b["st"],
            "grounded": b["gr"], "died": b["deaths"] > a["deaths"], "trace": trace[-6:]}


with Lane("vf_locks") as p:
    p.click_title(); p.wait(900)

    # ============================================================ L1 azure-1#00
    p.goto_course("azure-1")
    BRK = [("terrace urn W", -7.6, 5.55, -15.4), ("terrace urn E", 7.6, 5.55, -15.4),
           ("north urn", -9.0, 5.55, -29.0), ("tide pedestal", -4.5, 5.65, -33.4)]
    broke = []
    coins0 = p.lf("counts")["coins"]
    for name, x, y, z in BRK:
        tp(p, x + 2.4, y + 0.6, z)
        p.wait(1000); p.face(x, z)
        p.down("W"); p.wait(850); p.up("W"); p.wait(350)
        p.tap("Space", 110); p.wait(300); p.tap("C", 140); p.wait(1800)
        b = [k for k in p.lf("breakables") if abs(k["p"][0] - x) < 1.2 and abs(k["p"][2] - z) < 1.2]
        broke.append([name, bool(b and b[0]["broken"])])
    tp(p, -26.0, 3.0, 24.0)
    p.wait(1400); p.face(-26.0, 22.0); p.down("W"); p.wait(1200); p.up("W"); p.wait(500)
    hat = p.snap()["pw"]
    for (tx, tz) in [(-30.0, 6.0), (-32.0, -4.0), (-32.0, -9.0)]:
        p.face(tx, tz); p.down("W")
        for _ in range(10):
            p.wait(400); st = p.snap()
            if (st["x"] - tx) ** 2 + (st["z"] - tz) ** 2 < 2.6 ** 2:
                break
        p.up("W"); p.wait(200)
    c0 = p.lf("counts")
    p.face(-32.0, -10.2); p.down("W"); p.wait(1500)
    p.tap("Space", 110); p.wait(250); p.tap("C", 130); p.wait(2000); p.up("W"); p.wait(900)
    coral = [k for k in p.lf("breakables") if k["p"][0] == -32]
    c1 = p.lf("counts"); trig = p.lf("triggered")
    allbroke = all(v for _, v in broke) and bool(coral and coral[0]["broken"])
    rec("azure-1#00", "FIXED" if allbroke else "STILL REPRODUCES",
        "4 dry breakables %s; metal hat=%s; CORAL WALL broken=%s triggers=%s crests %s->%s coins %s->%s"
        % (broke, hat, coral[0]["broken"] if coral else "?", trig, c0["crests"], c1["crests"], coins0, c1["coins"]),
        detail={"broke": broke, "coral": coral, "triggered": trig, "counts": c1})

    # ============================================================ L2 azure-1#02 great stair
    tp(p, 0.0, -0.6, 12.0)
    p.wait(1800); a = p.snap()
    p.face(0.0, -14.0); p.down("W"); tr = []
    for _ in range(18):
        p.wait(600); s = p.snap(); tr.append([s["x"], s["y"], s["z"], s["st"]])
        if s["y"] > 4.8 and s["gr"]:
            break
    p.up("W"); p.wait(500); b = p.snap()
    up = b["y"] > 4.8 and b["gr"]
    rec("azure-1#02", "FIXED" if up else "STILL REPRODUCES",
        "swim at (0,-0.6,12), hold W north: end %s state=%s grounded=%s deaths=%s (terrace top 5.00)"
        % ([b["x"], b["y"], b["z"]], b["st"], b["gr"], b["deaths"] - a["deaths"]), detail={"trace": tr[-6:]})
    p.shot("a1_stair")

    # ============================================================ L3 azure-2#04 well cannon
    p.goto_course("azure-2")
    tp(p, -1.6, -10.2, -8.5)
    p.wait(1200); a = p.snap()
    p.face(-5.0, -8.5); p.down("W"); tr = []
    for _ in range(12):
        p.wait(400); s = p.snap(); tr.append([s["x"], s["y"], s["z"], s["st"]])
        if s["st"] in ("cannon", "fly"):
            break
        if s["x"] < -4.2 and s["gr"]:
            p.tap("Space", 110)
    p.up("W"); p.wait(700)
    b = p.snap()
    moved = round(abs(b["x"] - a["x"]), 2)
    aboard = b["st"] in ("cannon", "fly") or b["x"] < -4.2
    rec("azure-2#04", "FIXED" if aboard else "STILL REPRODUCES",
        "walk west from the CLIMB IN sign: %s -> %s state=%s moved %.2f m (the old stop was the barrel face at x -3.55)"
        % ([a["x"], a["y"], a["z"]], [b["x"], b["y"], b["z"]], b["st"], moved), detail={"trace": tr[-6:]})

    # ============================================================ L4 azure-2#12 winding shaft
    tp(p, 2.6, 33.2, -6.6)
    p.wait(1200)
    p.face(9.0, -6.6); p.down("W"); tr = []
    for _ in range(10):
        p.wait(400); s = p.snap(); tr.append([s["x"], s["y"], s["z"], s["st"]])
        if s["x"] > 5.4:
            break
    p.up("W"); p.wait(500); inside = p.snap()
    got_in = inside["x"] > 4.6
    lad = kick_out(p, [6.6, 33.0, -6.6], math.pi / 2, -math.pi / 2, 40.00)
    rec("azure-2#12", "FIXED" if (got_in and lad["cleared"]) else "STILL REPRODUCES",
        "eastbound walk reached x %.2f (the west wall face is x 4.15, so >4.6 is INSIDE); ladder peak %.2f of the 40.00 clock face, end %s grounded=%s"
        % (inside["x"], lad["peak"], lad["end"], lad["grounded"]), detail={"walk": tr[-4:], "ladder": lad})

    # ============================================================ L5 azure-3#21 gauntlet gaps
    p.goto_course("azure-3")
    gaps = [["start->mid", [-27.0, 50.0, -62.0], [-25.0, 53.0, -62.0]],
            ["mid->east", [-25.0, 53.0, -62.0], [5.0, 56.0, -62.0]]]
    gres = []
    for name, aP, bP in gaps:
        tp(p, aP[0] - 6.0, aP[1] + 0.4, aP[2])
        p.wait(1000)
        p.face(bP[0], bP[2]); p.down("W"); p.wait(1200)
        p.tap("Space", 120); p.wait(120); p.tap("Space", 120)
        best = -99.0
        for _ in range(14):
            p.wait(200); s = p.snap(); best = max(best, s["y"])
            if s["gr"] and s["y"] > aP[1] + 0.5:
                break
        p.up("W"); p.wait(800); e = p.snap()
        gres.append({"gap": name, "apex": round(best, 2), "need": bP[1], "end": [e["x"], e["y"], e["z"]],
                     "grounded": e["gr"], "landed": bool(e["gr"] and e["y"] >= bP[1] - 0.6)})
    ok = all(g["landed"] for g in gres)
    rec("azure-3#21", "FIXED" if ok else "STILL REPRODUCES",
        "double jump with a 6 m run-up at each deck step: " + "; ".join(
            "%s apex %.2f need %.2f landed=%s" % (g["gap"], g["apex"], g["need"], g["landed"]) for g in gres),
        detail=gres)

    # ============================================================ L6 keep#04 Old Fen
    p.goto_course("keep")
    tp(p, 17.0, 6.35, -19.2)
    p.wait(1400); p.face(17.0, -21.0); p.down("W"); p.wait(700); p.up("W"); p.wait(500)
    SCR = "()=>{const o=[];document.querySelectorAll('.cb-toast,.cb-prompt,.cb-dialogue,.cb-say,[class*=toast],[class*=dialog]').forEach(n=>{const t=(n.textContent||'').trim(); if(t&&n.offsetParent!==null) o.push(t.slice(0,160));}); return o;}"
    before = p.js(SCR)
    p.tap("E", 120); p.wait(1000); l1 = p.js(SCR)
    p.tap("E", 120); p.wait(1000); l2 = p.js(SCR)
    joined = " ".join(l1 + l2).upper()
    talks = (l1 != before) or (l2 != l1) or ("FEN" in joined)
    rec("keep#04", "FIXED" if talks else "STILL REPRODUCES",
        "E at Old Fen: before=%s afterE1=%s afterE2=%s" % (before, l1, l2),
        detail={"before": before, "e1": l1, "e2": l2})

    # ============================================================ L7 rime-1#01 bell tower
    p.goto_course("rime-1")
    tp(p, 4.6, 15.30, -46.8)
    p.wait(1200)
    p.face(-2.0, -46.8); p.down("W"); tr = []
    for _ in range(12):
        p.wait(400); s = p.snap(); tr.append([s["x"], s["y"], s["z"], s["st"]])
        if s["x"] < 0.6:
            break
    p.up("W"); p.wait(500); inside = p.snap()
    got_in = inside["x"] < 1.4
    lad = kick_out(p, [0.0, 15.10, -47.0], math.pi / 2, -math.pi / 2, 23.10)
    rec("rime-1#01", "FIXED" if (got_in and lad["cleared"]) else "STILL REPRODUCES",
        "westbound walk ended at x %.2f (the old stop was 2.38, the doorway is x 1.8); ladder peak %.2f of 23.10, end %s grounded=%s"
        % (inside["x"], lad["peak"], lad["end"], lad["grounded"]), detail={"walk": tr[-4:], "ladder": lad})

    # ============================================================ L8 rime-2#09 kick shaft
    p.goto_course("rime-2")
    tp(p, -17.6, 20.6, -18.2)
    p.wait(1100)
    p.face(-16.6, -21.0); p.down("W"); p.wait(500); p.tap("Space", 110); p.wait(1200)
    p.face(-13.0, -21.0); p.wait(1700); p.up("W"); p.wait(400)
    door = p.snap()
    c0 = p.lf("counts")
    lad = kick_out(p, [-13.0, 21.60, -21.0], math.pi, 0.0, 30.20)
    sig = None
    if lad["grounded"] and lad["end"][1] > 29.0:
        p.face(-8.8, -20.0); p.down("W"); p.wait(1400); p.up("W"); p.wait(600)
        sig = p.lf("counts")["sigils"]
    rec("rime-2#09", "FIXED" if lad["cleared"] else "STILL REPRODUCES",
        "walked in through the west doorway to %s; ladder peak %.2f of the 30.20 exit ledge, end %s grounded=%s; sigils %s->%s"
        % ([door["x"], door["y"], door["z"]], lad["peak"], lad["end"], lad["grounded"], c0["sigils"], sig),
        detail={"door": [door["x"], door["y"], door["z"]], "ladder": lad})
    p.shot("r2_shaft")

    # ============================================================ L9 rime-2#15 west ice face
    tp(p, -25.4, 3.40, 23.4)
    p.wait(1100)
    p.face(-27.6, 19.0); p.down("W"); p.wait(700)
    p.tap("Space", 120); p.wait(130); p.tap("Space", 120)
    best = -99.0
    for _ in range(14):
        p.wait(200); s = p.snap(); best = max(best, s["y"])
        if s["gr"] and s["y"] > 5.2:
            break
    p.up("W"); p.wait(900); e = p.snap()
    landed = bool(e["gr"] and e["y"] >= 5.2 and abs(e["x"] + 27.6) < 2.6 and abs(e["z"] - 19.0) < 2.6)
    rec("rime-2#15", "FIXED" if landed else "STILL REPRODUCES",
        "double jump serac1(-26.4, 3.30, 21.6) -> serac2(-27.6, 5.70, 19.0): apex %.2f (need +2.40), end %s grounded=%s landed=%s"
        % (best, [e["x"], e["y"], e["z"]], e["gr"], landed))

    # ============================================================ L10 rime-3#15 chimney
    p.goto_course("rime-3")
    lad = kick_out(p, [15.2, 20.00, -2.0], math.pi, 0.0, 27.70)
    rec("rime-3#15", "FIXED" if lad["cleared"] else "STILL REPRODUCES",
        "ladder out of the crusher cave: peak %.2f of the 27.70 exit ledge, end %s grounded=%s died=%s"
        % (lad["peak"], lad["end"], lad["grounded"], lad["died"]), detail=lad)
    p.shot("r3_chimney")

    p.say("WROTE", OUT)
    p.dump("vf_locks")
