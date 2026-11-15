# -*- coding: utf-8 -*-
"""VERIFY pass - re-drive the 23 DEATH defects (the `death`-signature rows that
were STILL REPRODUCES in _replay_verdicts.json) on the current tree.

Each row is measured by the thing its own tester complained about: a hands-off
30 s stand at the station for the "it killed me standing there" claims, a real
input battery for the rest.  Writes _harness/_playreports/_vf_deaths.json
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _lf_lib import Lane

OUT = os.path.join(HERE, "_playreports", "_vf_deaths.json")
R = {}


def rec(key, verdict, evidence, **kw):
    R[key] = dict(verdict=verdict, evidence=evidence, **kw)
    print("[%-12s] %-18s %s" % (key, verdict, evidence), flush=True)
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


def go(p, cid):
    for _ in range(3):
        resume(p)
        p.goto_course(cid)
        resume(p)
        if p.js("()=>{const g=CRESTBOUND.game;return (g.course&&g.course.def)?g.course.def.id:null;}") == cid:
            return True
        p.wait(1000)
    return False


def stands(p, rows, seconds=30):
    """rows = [(label, x, y, z)] -> [(label, result)] using the hand-stepped stand."""
    out = []
    for (lab, x, y, z) in rows:
        resume(p)
        r = p.lf("stand", x, y, z, seconds)
        out.append({"at": lab, "diedAt": r["diedAt"], "cause": r["cause"], "drift": r["drift"],
                    "state": r["state"], "end": r["end"], "err": r["err"]})
        print("     %-46s %s" % (lab, "OK %ss 0 deaths drift %.2f %s" % (seconds, r["drift"], r["state"])
                                 if r["diedAt"] < 0 else "DIED +%ss (%s)" % (r["diedAt"], r["cause"])), flush=True)
    return out


def clean(rows):
    return all(r["diedAt"] < 0 and not r["err"] for r in rows)


def tp(p, x, y, z):
    p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", [x, y, z])


with Lane("vf_deaths") as p:
    p.click_title(); p.wait(900)

    # ================================================================ azure-1
    if go(p, "azure-1"):
        # azure-1#01 the inner-court warden: does it wake and fight?
        resume(p)
        tp(p, 0.0, 2.0, -48.0)
        p.wait(1200)
        seen = set()
        for _ in range(26):
            p.wait(220)
            w = p.lf("wardens")
            for k in w:
                seen.add(k["state"])
        w = p.lf("wardens")
        wk = [k for k in w if abs((k["arenaC"] or [0, 0, 0])[2] + 48) < 3]
        woke = bool(seen - {"dormant"})
        rec("azure-1#01", "FIXED" if woke else "STILL REPRODUCES",
            "5.7 s standing in the ring at (0, ~1.6, -48): states seen %s; wardens now %s"
            % (sorted(seen), json.dumps(wk)))
        s = stands(p, [("inner-court warden ring edge", 0.0, 1.80, -41.5)])
        rec("azure-1#01.stand", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))

    # ================================================================ azure-2
    if go(p, "azure-2"):
        s = stands(p, [("well secret crest pedestal (moved 4.5 m south)", 0.0, -10.60, -9.5),
                       ("the pedestal's ORIGINAL x,z under the counterweight", 0.0, -10.60, -5.0)])
        rec("azure-2#03", "FIXED" if s[0]["diedAt"] < 0 else "STILL REPRODUCES", json.dumps(s))
        s = stands(p, [("escapement hammer SE", 6.0, 28.00, 6.0),
                       ("escapement hammer SW", -6.0, 28.00, 6.0),
                       ("escapement hammer N", 0.0, 28.00, -6.0),
                       ("gallery-3 walk UNDER the SE hammer", 6.0, 25.10, 6.0),
                       ("gallery-3 south walk", 0.0, 25.10, 6.0)])
        rec("azure-2#10", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))

    # ================================================================ azure-3
    if go(p, "azure-3"):
        # #30 - the killY console line, read at boot
        con = [c for c in p.console if "killY" in c]
        rec("azure-3#30", "STILL REPRODUCES" if con else "FIXED",
            ("console still logs: %s" % con[:2]) if con else "no killY line in the console for this boot")
        s = stands(p, [("gnasher cloud shelf, 1.3 m from the post", -34.0, 26.30, -3.3),
                       ("gnasher cloud shelf, at the post", -34.0, 26.30, -2.0),
                       ("sigil 2 inside the 6 m disc", -34.0, 27.80, -6.0)])
        rec("azure-3#13", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))
        s = stands(p, [("road rotor lane west x 17.4", 17.4, 53.00, -62.0),
                       ("road rotor lane east x 24.6", 24.6, 53.00, -62.0),
                       ("the file's old 'always clear' x 18", 18.0, 53.00, -62.0),
                       ("the file's old 'always clear' x 24", 24.0, 53.00, -62.0)])
        rec("azure-3#22", "FIXED" if clean(s[:2]) else "STILL REPRODUCES", json.dumps(s))
        s = stands(p, [("sigil 7 between the prism hammers", 12.5, 53.00, -62.0)])
        rec("azure-3#24", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))

    # ================================================================ ember-1
    if go(p, "ember-1"):
        s = stands(p, [("THE POUR, level-3 walk west lane", -6.03, 15.20, -30.40),
                       ("THE POUR, x -8.0", -8.0, 15.20, -30.40),
                       ("THE POUR, x -10.0", -10.0, 15.20, -30.40)])
        rec("ember-1#18", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))
        # #23 the bumbler contact: stand in its lane and look for knockback
        resume(p)
        tp(p, -4.79, 15.20, -30.40)
        p.wait(1400)
        a = p.snap()
        tr = []
        for _ in range(24):
            p.wait(250)
            b = p.snap()
            tr.append([b["x"], b["z"], b["st"], b["sp"]])
        b = p.snap()
        moved = round(((b["x"] - a["x"]) ** 2 + (b["z"] - a["z"]) ** 2) ** 0.5, 2)
        stunned = any(t[2] in ("bonk", "hardLand", "skid") for t in tr)
        rec("ember-1#23", "FIXED" if (moved > 1.0 or stunned) else "STILL REPRODUCES",
            "6 s in the west-lane bumbler's path: moved %.2f m, states %s, deaths +%d"
            % (moved, sorted(set(t[2] for t in tr)), b["deaths"] - a["deaths"]))
        # #04 / #26 the camera stations
        camrows = []
        for lab, xyz in [("cp-junction (flame vent basin)", [0.0, 3.20, -7.50]),
                         ("inside the crucible vessel", [-4.0, 6.40, -40.49])]:
            resume(p)
            tp(p, xyz[0], xyz[1], xyz[2])
            p.wait(1600)
            c = p.js("""()=>{const G=CRESTBOUND.game,C=G.cam,P=G.player,TH=CRESTBOUND.THREE;
              const cam=C.camera||C.cam; const o=new TH.Vector3(); o.copy(cam.position);
              const h=new TH.Vector3(P.pos.x,P.pos.y+1.2,P.pos.z);
              const d=h.clone().sub(o); const L=d.length(); d.normalize();
              const hit={t:0,normal:new TH.Vector3(),collider:null};
              const blocked=G.course.broadphase.raycast(o,d,L-0.35,hit);
              return {dist:+C.dist.toFixed(2), minDist:1.6, occluded:!!blocked,
                      camY:+cam.position.y.toFixed(2), heroY:+P.pos.y.toFixed(2), st:P.state};}""")
            c["at"] = lab
            camrows.append(c)
            print("     cam %-40s %s" % (lab, json.dumps(c)), flush=True)
        rec("ember-1#04", "FIXED" if (camrows[0]["dist"] >= 1.6 and not camrows[0]["occluded"]) else "STILL REPRODUCES",
            json.dumps(camrows[0]))
        rec("ember-1#26", "FIXED" if (camrows[1]["dist"] >= 1.6 and not camrows[1]["occluded"]) else "STILL REPRODUCES",
            json.dumps(camrows[1]))
        # #29 the flame catwalk, three timed runs from the quay
        runs = []
        for t0 in (1.5, 2.6, 3.4):
            resume(p)
            p.js("(t)=>{try{CRESTBOUND.game.__dev.setClock(t);}catch(e){}}", t0)
            tp(p, 0.0, 3.40, 12.5)
            p.wait(1100)
            a = p.snap()
            p.face(0.0, -9.5)
            p.down("W")
            end = None
            for _ in range(20):
                p.wait(300)
                s = p.snap()
                if s["deaths"] > a["deaths"]:
                    end = ["DIED", s["z"], p.js("()=>CRESTBOUND.game.player.deathCause||null")]
                    break
                if s["z"] < -8.5:
                    end = ["CROSSED", s["z"], None]
                    break
            p.up("W"); p.wait(500)
            runs.append({"clock": t0, "result": end or ["NEITHER", p.snap()["z"], None]})
            print("     catwalk t=%s -> %s" % (t0, runs[-1]["result"]), flush=True)
        crossed = sum(1 for r in runs if r["result"][0] == "CROSSED")
        rec("ember-1#29", "FIXED" if crossed >= 3 else "STILL REPRODUCES",
            "%d of 3 timed runs crossed the flame catwalk: %s" % (crossed, json.dumps(runs)))

    # ================================================================ ember-2
    if go(p, "ember-2"):
        s = stands(p, [("piston hall lane x -7", -7.0, 6.20, 28.0),
                       ("piston hall lane x 0", 0.0, 6.20, 28.0),
                       ("piston hall lane x +7", 7.0, 6.20, 28.0)])
        # the complaint is the ABSENCE of danger: no death here means it still reproduces
        rec("ember-2#07", "STILL REPRODUCES" if clean(s) else "FIXED",
            "the tester's complaint is that nothing in the hall can touch a walker; "
            "30 s hands-off in each lane: %s" % json.dumps(s))

    # ================================================================ ember-4
    if go(p, "ember-4"):
        # #04 run west off the heightfield
        resume(p)
        tp(p, -62.0, 1.60, 64.0)
        p.wait(1300)
        a = p.snap()
        p.face(-90.0, 64.0)
        p.down("W")
        outcome = None
        for _ in range(24):
            p.wait(300)
            s = p.snap()
            if s["deaths"] > a["deaths"]:
                outcome = ["DIED", [s["x"], s["y"], s["z"]], p.js("()=>CRESTBOUND.game.player.deathCause||null")]
                break
            if s["gr"] and s["sp"] < 0.4 and s["x"] < -68:
                outcome = ["STOPPED", [s["x"], s["y"], s["z"]], s["st"]]
                break
        p.up("W"); p.wait(500)
        e = p.snap()
        outcome = outcome or ["RAN", [e["x"], e["y"], e["z"]], e["st"]]
        rec("ember-4#04", "FIXED" if outcome[0] != "DIED" else "STILL REPRODUCES",
            "held W west out of the dunes from x -62: %s" % json.dumps(outcome))
        s = stands(p, [("tomb glyph 1", 0.0, 4.80, -52.2),
                       ("tomb glyph 2", 0.0, 4.80, -56.0)], seconds=6)
        rec("ember-4#08", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))

    # ================================================================ rime-1
    if go(p, "rime-1"):
        s = stands(p, [("barn yard centre", -21.0, 5.20, 4.0),
                       ("barn door, 4 m from the post", -19.0, 5.20, 12.6)])
        rec("rime-1#11", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))

    # ================================================================ rime-3
    if go(p, "rime-3"):
        s = stands(p, [("terrace coin ring, nearest coin", 19.0, 19.80, 2.0),
                       ("terrace 3.0 m from the gnasher post", 24.0, 19.80, -2.0),
                       ("crusher-cave mouth", 20.0, 19.80, -1.5)])
        rec("rime-3#16", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))

    # ================================================================ verdant-2
    if go(p, "verdant-2"):
        s = stands(p, [("west gnasher post (the pound spot)", -7.0, 5.85, 26.5)])
        rec("verdant-2#12", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))
        # #21 the ROUTE C jump pad
        resume(p)
        tp(p, -8.0, 7.2, 22.0)
        p.wait(1200)
        a = p.snap()
        p.face(-8.0, 24.5)
        p.down("W")
        peak, tr = a["y"], []
        for _ in range(22):
            p.wait(220)
            s = p.snap(); peak = max(peak, s["y"]); tr.append([s["x"], s["y"], s["z"], s["st"]])
            if s["gr"] and s["y"] > a["y"] + 3.0:
                break
            if s["deaths"] > a["deaths"]:
                break
        p.up("W"); p.wait(900)
        e = p.snap()
        wallslid = any(t[3] == "wallslide" for t in tr)
        rec("verdant-2#21", "STILL REPRODUCES" if wallslid else "FIXED",
            "walked onto the ROUTE C pad: peak y %.2f, end %s state=%s, wallslide seen=%s, deaths +%d"
            % (peak, [e["x"], e["y"], e["z"]], e["st"], wallslid, e["deaths"] - a["deaths"]),
            detail=tr[-6:])

    # ================================================================ verdant-3
    if go(p, "verdant-3"):
        s = stands(p, [("threshing deck under the gnasher terrace", -8.8, 12.70, -8.2),
                       ("deck B jump-pad landing line", -8.7, 12.70, -8.7)])
        rec("verdant-3#16", "FIXED" if clean(s) else "STILL REPRODUCES", json.dumps(s))
        # #01 the granary cellar freeze after pounding the mezzanine
        resume(p)
        tp(p, -8.0, 18.9, -16.0)
        p.wait(1200)
        p.tap("Space", 110); p.wait(280); p.tap("C", 140); p.wait(2200)
        a = p.snap()
        p.face(-4.0, -16.0)
        p.down("W"); p.wait(2200); p.up("W"); p.wait(600)
        b = p.snap()
        moved = round(((b["x"] - a["x"]) ** 2 + (b["z"] - a["z"]) ** 2) ** 0.5, 2)
        rec("verdant-3#01", "FIXED" if moved > 1.0 else "STILL REPRODUCES",
            "pounded the mezzanine breakable then held W for 2.2 s: %s -> %s moved %.2f m state=%s crests=%s"
            % ([a["x"], a["y"], a["z"]], [b["x"], b["y"], b["z"]], moved, b["st"], b["crests"]))

    p.say("WROTE", OUT)
    p.dump("vf_deaths")
