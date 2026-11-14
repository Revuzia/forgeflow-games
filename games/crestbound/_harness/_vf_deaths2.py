# -*- coding: utf-8 -*-
"""VERIFY pass - the four rows the first battery could not decide, re-driven with
the artefact removed (a crest taken mid-battery opens the clear card, and a probe
that never reaches the pad says nothing about the pad).

Writes _harness/_playreports/_vf_deaths2.json
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _lf_lib import Lane

OUT = os.path.join(HERE, "_playreports", "_vf_deaths2.json")
R = {}


def rec(key, verdict, evidence, **kw):
    R[key] = dict(verdict=verdict, evidence=evidence, **kw)
    print("[%-14s] %-18s %s" % (key, verdict, evidence), flush=True)
    json.dump(R, open(OUT, "w"), indent=1)


def resume(p):
    for _ in range(10):
        gs = p.js("()=>CRESTBOUND.game.state")
        if gs in ("playing", "keep"):
            return gs
        p.js("()=>{const g=CRESTBOUND.game; try{ if(g.__dev.clearChoice) g.__dev.clearChoice('stay'); }catch(e){} "
             "try{ if(g.menu && g.menu.isOpen) g.menu.close(); }catch(e){} }")
        p.wait(450)
    return p.js("()=>CRESTBOUND.game.state")


def go(p, cid):
    for _ in range(3):
        resume(p)
        p.goto_course(cid)
        resume(p)
        if p.js("()=>{const g=CRESTBOUND.game;return (g.course&&g.course.def)?g.course.def.id:null;}") == cid:
            return True
        p.wait(1000)
    return False


def tp(p, x, y, z):
    p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", [x, y, z])


with Lane("vf_deaths2") as p:
    p.click_title(); p.wait(900)

    # ---------------------------------------- verdant-2#21 the ROUTE C jump pad
    if go(p, "verdant-2"):
        best = None
        for y0 in (7.4, 6.9, 8.4):
            resume(p)
            tp(p, -8.0, y0, 24.5)
            p.wait(1500)
            a = p.snap()
            peak, tr = a["y"], []
            for _ in range(26):
                p.wait(200)
                s = p.snap(); peak = max(peak, s["y"]); tr.append([s["x"], s["y"], s["z"], s["st"]])
                if s["deaths"] > a["deaths"]:
                    break
                if s["gr"] and len(tr) > 6:
                    break
            e = p.snap()
            launched = peak > a["y"] + 2.0
            r = {"placedAt": [a["x"], a["y"], a["z"]], "peak": round(peak, 2), "gain": round(peak - a["y"], 2),
                 "end": [e["x"], e["y"], e["z"]], "state": e["st"],
                 "wallslide": any(t[3] == "wallslide" for t in tr),
                 "bonk": any(t[3] == "bonk" for t in tr),
                 "deaths": e["deaths"] - a["deaths"], "launched": launched, "trace": tr[:8]}
            print("     pad try y0=%s -> %s" % (y0, json.dumps({k: r[k] for k in ('peak', 'gain', 'end', 'state', 'wallslide', 'launched')})), flush=True)
            best = r
            if launched:
                break
        if not best or not best["launched"]:
            rec("verdant-2#21", "COULD NOT TEST",
                "the hero never left the pad (no launch measured): %s" % json.dumps(best))
        else:
            rec("verdant-2#21", "STILL REPRODUCES" if (best["wallslide"] or best["deaths"]) else "FIXED",
                "the pad launched %.2f m: end %s state=%s wallslide=%s bonk=%s deaths=+%d"
                % (best["gain"], best["end"], best["state"], best["wallslide"], best["bonk"], best["deaths"]),
                detail=best)

    # ---------------------------------------- verdant-3#01 the granary cellar freeze
    if go(p, "verdant-3"):
        resume(p)
        tp(p, -8.0, 18.9, -16.0)
        p.wait(1300)
        p.tap("Space", 110); p.wait(280); p.tap("C", 140); p.wait(2400)
        after_pound = p.snap()
        gs = p.js("()=>CRESTBOUND.game.state")
        resumed = resume(p)
        p.wait(700)
        a = p.snap()
        p.face(-2.0, -16.0)
        p.down("W"); p.wait(2400); p.up("W"); p.wait(700)
        b = p.snap()
        moved = round(((b["x"] - a["x"]) ** 2 + (b["z"] - a["z"]) ** 2) ** 0.5, 2)
        rec("verdant-3#01", "FIXED" if moved > 1.0 else "STILL REPRODUCES",
            "pound -> crests %s, game state %s (resumed to %s); then W for 2.4 s: %s -> %s moved %.2f m state=%s"
            % (after_pound["crests"], gs, resumed, [a["x"], a["y"], a["z"]], [b["x"], b["y"], b["z"]], moved, b["st"]))

    # ---------------------------------------- azure-3#21 the gauntlet deck steps
    if go(p, "azure-3"):
        rows = []
        for name, aP, bP in [["start->mid", [-27.0, 50.0, -62.0], [-25.0, 53.0, -62.0]],
                             ["mid->east", [-25.0, 53.0, -62.0], [-21.0, 56.0, -62.0]]]:
            resume(p)
            # place ON the launch deck, verified
            gv = p.goto_verify([aP[0] - 0.8, aP[1] + 0.4, aP[2]], settle_ms=900, tol=1.8)
            s0 = p.snap()
            if not gv.get("ok") or abs(s0["y"] - aP[1]) > 1.2:
                rows.append({"gap": name, "placed": False, "at": [s0["x"], s0["y"], s0["z"]], "why": gv.get("reason")})
                print("     step %s NOT PLACED at %s (%s)" % (name, [s0["x"], s0["y"], s0["z"]], gv.get("reason")), flush=True)
                continue
            # a long straight run-up along the deck, then a TRIPLE
            p.face(aP[0] - 12.0, aP[2])
            p.down("W"); p.wait(1400); p.up("W"); p.wait(400)
            p.face(bP[0] + 6.0, bP[2])
            p.down("W"); p.wait(1500)
            sp = p.snap()["sp"]
            p.tap("Space", 110); p.wait(320)
            p.tap("Space", 110); p.wait(320)
            p.tap("Space", 110)
            best = -99.0
            for _ in range(18):
                p.wait(170); s = p.snap(); best = max(best, s["y"])
                if s["gr"] and s["y"] >= bP[1] - 0.6:
                    break
            p.up("W"); p.wait(900)
            e = p.snap()
            rows.append({"gap": name, "placed": True, "runSpeed": sp, "apex": round(best - aP[1], 2),
                         "need": round(bP[1] - aP[1], 2), "end": [e["x"], e["y"], e["z"]],
                         "grounded": e["gr"], "landed": bool(e["gr"] and e["y"] >= bP[1] - 0.6)})
            print("     step %s -> %s" % (name, json.dumps(rows[-1])), flush=True)
        decided = [r for r in rows if r.get("placed")]
        if not decided:
            rec("azure-3#21", "COULD NOT TEST", "the driver could not stand on either launch deck: %s" % json.dumps(rows))
        else:
            rec("azure-3#21", "FIXED" if all(r["landed"] for r in decided) else "STILL REPRODUCES",
                "triple jump with a 12 m straight run-up: " + json.dumps(decided), detail=rows)

    # ---------------------------------------- ember-1#26 is the crucible a sealed box?
    if go(p, "ember-1"):
        resume(p)
        tp(p, -4.0, 6.40, -40.49)
        p.wait(1500)
        a = p.snap()
        outs = []
        for yaw_target in [(-4.0, -32.0), (-4.0, -49.0), (5.0, -40.49), (-13.0, -40.49)]:
            resume(p)
            tp(p, -4.0, 6.40, -40.49)
            p.wait(900)
            p.face(yaw_target[0], yaw_target[1])
            p.down("W"); p.wait(700)
            p.tap("Space", 110); p.wait(260); p.tap("Space", 110); p.wait(260); p.tap("Space", 110)
            peak = a["y"]
            for _ in range(14):
                p.wait(200); s = p.snap(); peak = max(peak, s["y"])
            p.up("W"); p.wait(800)
            e = p.snap()
            outs.append({"toward": yaw_target, "peak": round(peak, 2), "end": [e["x"], e["y"], e["z"]],
                         "escaped": bool(e["y"] > 8.5 or abs(e["x"] + 4.0) > 6.0 or abs(e["z"] + 40.49) > 7.0)})
        rec("ember-1#26.exit", "FIXED" if any(o["escaped"] for o in outs) else "STILL REPRODUCES",
            "triple jump out of the crucible in four directions (rim 21.60): " + json.dumps(outs))

    p.say("WROTE", OUT)
    p.dump("vf_deaths2")
