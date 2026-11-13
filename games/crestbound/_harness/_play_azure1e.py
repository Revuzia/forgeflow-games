"""PLAYTEST — AZURE-1, segment E: THE GREAT STAIR, tried the way a player tries
it (from the surface, with strokes and surface hops), then the terrace beams,
the urns, the tide switch pound, the sluice gates, the inner court, the water
wheels, the vanish grates and the Warden.
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")


def load():
    return json.load(open(REPORT, encoding="utf-8"))


def flush(rep):
    json.dump(rep, open(REPORT, "w", encoding="utf-8"), indent=1)


def boot(P):
    for i in range(120):
        if P.js("() => typeof globalThis.CRESTBOUND === 'object' && !!CRESTBOUND.game"):
            break
        P.wait(500)
    for i in range(120):
        if P.js("() => CRESTBOUND.game.state !== 'loading'"):
            break
        P.wait(500)
    P.click_title(); P.wait(1200); P.unlock_all()
    P.js("() => CRESTBOUND.game.__dev.goto('azure-1')")
    for _ in range(80):
        P.wait(500)
        s = P.state()
        if s["course"] == "azure-1" and s["gstate"] == "playing":
            break
    P.wait(2000)


def drive(P, x, z, secs, keys=("W",), tag="", every=0):
    P.face(x, z)
    for k in keys:
        P.down(k)
    n = int(secs * 4)
    for i in range(n):
        P.wait(250)
        P.face(x, z)
        if every and i % every == 0:
            P.shot("%s_%02d" % (tag or "drive", i))
    for k in keys:
        P.up(k)
    P.wait(200)
    e = P.state()
    P.say("  drive->(%s,%s) %-22s end %s %s g=%s water=%s" % (x, z, tag, e["pos"], e["pstate"], e["grounded"], e["inWater"]))
    return e


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1e") as P:
        boot(P)

        # ======================================================= GREAT STAIR
        P.say("=== THE GREAT STAIR, attempt 1: swim at it from the SURFACE ===")
        P.tp(0, 0.2, 2.0)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        P.wait(1200)
        s0 = P.state()
        P.say("  start:", s0["pos"], s0["pstate"], "inWater", s0["inWater"])
        P.shot("01_stair_surface_start")
        e = drive(P, 0, -12, 12, tag="02_stairA", every=8)
        P.shot("03_stairA_end")

        got_out = e["pos"][1] > 1.0 and not e["inWater"]
        if not got_out:
            P.say("  attempt 2: W + repeated Space (stroke / surface hop) at the treads")
            P.face(0, -12)
            P.down("W")
            for i in range(24):
                P.tap("SPACE", 110)
                P.wait(300)
                P.face(0, -12)
                if i % 6 == 0:
                    P.shot("04_stairB_%02d" % i)
            P.up("W")
            e = P.state()
            P.say("  after 24 strokes/hops:", e["pos"], e["pstate"], "grounded", e["grounded"], "inWater", e["inWater"])
            P.shot("05_stairB_end")
            got_out = e["pos"][1] > 1.0 and not e["inWater"]

        if not got_out:
            D(what="THE GREAT STAIR CANNOT BE CLIMBED OUT OF THE WATER — the course's set piece and the only way up the temple's south face is a wall to a swimmer",
              where="azure-1, the 35-tread great stair (centre (0, -5.31, -4.25), treads 0.312 rise / 0.368 run, top 5.61). Approached from the water at (0, 0.2, 2.0), which is where the required route arrives after the forecourt dive",
              did="held W due north at the stair for 12 s, then held W and tapped Space (stroke / surface hop) 24 more times",
              happened="the player stays in the water at %s (state %s, grounded %s) — he never gets a foot on a tread" % (e["pos"], e["pstate"], e["grounded"]),
              should="the lowest treads are authored under the sea ('the sea pouring off the lowest six steps'); swimming into them should let the player climb out and walk up to the terrace",
              png="_shots/play_azure1e/05_stairB_end.png")
        else:
            W("The great stair can be climbed out of the water and walked to the terrace (ended %s)." % (e["pos"],))

        # attempt 3: start ON the dry treads and walk up
        P.say("\n=== THE GREAT STAIR, attempt 3: start on a DRY tread and walk up ===")
        P.tp(0, 1.2, -3.0)
        P.wait(900)
        s0 = P.state()
        P.say("  placed at", s0["pos"], s0["pstate"], "grounded", s0["grounded"], "inWater", s0["inWater"])
        P.shot("06_stairC_start")
        e = drive(P, 0, -14, 14, tag="07_stairC", every=10)
        P.shot("08_stairC_end")
        if e["pos"][1] < 5.0:
            D(what="Even starting on a dry tread, holding forward does not walk the great stair to the top",
              where="azure-1 great stair, placed on a tread at (0, 1.2, -3.0)",
              did="aimed north up the flight and held W for 14 s",
              happened="ended at %s in state %s" % (e["pos"], e["pstate"]),
              should="0.312 m risers are well inside the 0.45 m stepUp; a held forward should walk the flight",
              png="_shots/play_azure1e/08_stairC_end.png")
        else:
            W("From a dry tread the great stair walks up on a held W to %s." % (e["pos"],))

        # ======================================================= TERRACE
        P.say("\n=== BEAT 5 — THE TERRACE (cp3) + THE BEAMS ===")
        P.tp(0, 5.4, -16)
        P.wait(1000)
        st = P.state()
        P.say("  terrace:", st["pos"], st["pstate"], "cp", P.js("() => CRESTBOUND.game.cpIndex"))
        P.shot("09_terrace")
        # read the sign / pedestal from here
        P.say("  walking the terrace east-west to feel the beams")
        deaths0 = P.js("() => CRESTBOUND.game.deaths")
        drive(P, 10, -18, 6, tag="10_terr_e", every=6)
        drive(P, -10, -18, 8, tag="11_terr_w", every=6)
        deaths1 = P.js("() => CRESTBOUND.game.deaths")
        P.say("  deaths crossing the terrace beams: %d -> %d" % (deaths0, deaths1))
        P.shot("12_terrace_beams")

        # beam telegraph: watch one beam cycle and see if the warn reads
        bs = P.js("""() => { const out=[]; const hs=(CRESTBOUND.game.course.hazards||[]);
            for (const h of hs) if (h.def && h.def.kind==='beam' && h.def.a[1] > 4)
               out.push({a:h.def.a, on:!!h.on, warn:!!h.warn, keys:Object.keys(h).slice(0,20)});
            return out; }""")
        P.say("  terrace beams:", json.dumps(bs)[:500])

        # urns
        P.say("\n=== THE URNS (breakable barrels on the terrace) ===")
        P.tp(-7.6, 5.4, -14.6)
        P.wait(800)
        P.shot("13_urn_before")
        coins0 = P.js("() => CRESTBOUND.game._collectibles ? CRESTBOUND.game._collectibles.counts.coins : -1")
        # walk into it, then pound it
        drive(P, -7.6, -15.4, 2.5, tag="14_urn_walk")
        P.say("  pound it: jump then C in the air")
        P.tap("SPACE", 120); P.wait(260); P.down("C"); P.wait(1400); P.up("C")
        P.wait(900)
        coins1 = P.js("() => CRESTBOUND.game._collectibles ? CRESTBOUND.game._collectibles.counts.coins : -1")
        P.say("  coins %d -> %d" % (coins0, coins1))
        P.shot("15_urn_after")
        if coins1 <= coins0:
            D(what="Pounding a terrace urn does not break it or drop its coins",
              where="azure-1 temple terrace, the 'breakable' barrel at (-7.6, 5.55, -15.4) with drop:'coins'",
              did="stood next to it, jumped and pressed C in the air to ground-pound it",
              happened="coin count stayed at %d" % coins1,
              should="a breakable with drop:'coins' should shatter on a pound and give its coins",
              png="_shots/play_azure1e/15_urn_after.png")
        else:
            W("Pounding a terrace urn breaks it and drops coins (%d -> %d)." % (coins0, coins1))

        # ======================================================= TIDE SWITCH
        P.say("\n=== BEAT 6 — THE TIDE SWITCH: pound the pedestal at (-4.5, 5.65, -33.4) ===")
        P.tp(-4.5, 6.6, -33.4)
        P.wait(900)
        P.shot("16_tideswitch_before")
        fired0 = P.js("() => { const c = CRESTBOUND.game.course; return c && c.triggers ? Object.keys(c.triggers) : (c && c._triggers ? Object.keys(c._triggers) : null); }")
        P.say("  triggers before:", fired0)
        P.say("  reading the sign from the player's spot:")
        P.say("   ", P.js("""() => { const G=CRESTBOUND.game; const c=G.cam&&G.cam.cam; return c? [ +c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)] : null; }"""))
        # land on it and pound
        for attempt in range(3):
            P.tap("SPACE", 130); P.wait(260)
            P.down("C"); P.wait(1600); P.up("C")
            P.wait(800)
            fired = P.js("() => { const c = CRESTBOUND.game.course; return c && c.triggers ? Object.keys(c.triggers) : (c && c._triggers ? Object.keys(c._triggers) : null); }")
            P.say("  after pound %d: triggers %s ; pos %s" % (attempt + 1, fired, P.pos()))
            P.shot("17_pound_%d" % attempt)
        st = P.state()
        P.say("  tide switch end:", st["pos"], st["pstate"])
        P.shot("18_tideswitch_after")

        # ======================================================= SLUICE
        P.say("\n=== THE SLUICE GATES (3 oscillating movers at z -37) ===")
        movers = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='mover')
            .map(h=>({p:h.def.p, y: h.colliders&&h.colliders[0]&&h.colliders[0].center? +h.colliders[0].center.y.toFixed(2):null}))""")
        P.say("  movers:", json.dumps(movers))
        P.tp(0, 5.4, -34)
        P.wait(900)
        P.shot("19_sluice")
        e = drive(P, 0, -40, 10, tag="20_sluice", every=6)
        P.say("  walked from the terrace toward the court:", e["pos"], e["pstate"], "g", e["grounded"])
        P.shot("21_sluice_end")

        # ======================================================= COURT
        P.say("\n=== BEAT 7 — THE INNER COURT (cp5), wheels, vanish grates, Warden ===")
        P.tp(0, 2.2, -40)
        P.wait(1000)
        st = P.state()
        P.say("  court:", st["pos"], st["pstate"], "cp", P.js("() => CRESTBOUND.game.cpIndex"))
        P.shot("22_court")

        P.say("  the water wheels: rotors at (-9, 4.4, -44) and (9, 4.4, -44)")
        P.tp(-9.0, 6.5, -44.0)
        P.wait(1200)
        ys = []
        for i in range(24):
            P.wait(300)
            s = P.state()
            ys.append((round(s["pos"][1], 2), s["pstate"], s["grounded"]))
            if i % 8 == 0:
                P.shot("23_wheel_%02d" % i)
        P.say("  dropped onto the west wheel:", ys[:12])
        st = P.state()
        P.say("  wheel end:", st["pos"], st["pstate"], "grounded", st["grounded"])
        P.shot("24_wheel_end")

        P.say("\n  the vanish grates at (3,1.85,-42) (6,1.85,-45) (4,1.85,-48)")
        P.tp(3.0, 2.6, -42.0)
        P.wait(800)
        vs = []
        for i in range(28):
            P.wait(300)
            s = P.state()
            vs.append((round(s["pos"][1], 2), s["grounded"], s["pstate"]))
            if i % 9 == 0:
                P.shot("25_vanish_%02d" % i)
        P.say("  standing on vanish grate 1:", vs)
        P.shot("26_vanish_end")

        flush(rep)
        P.dump("azure1e")


main()
