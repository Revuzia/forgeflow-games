"""PLAYTEST — AZURE-1, segment M: the tide switch ('tide-drawn'), the terrace
urns, and the race rings — the three things segment E could not settle because
a terrace beam kept killing the hero.
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_azlib import boot as azboot, drive

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")


def load():
    return json.load(open(REPORT, encoding="utf-8"))


def flush(rep):
    json.dump(rep, open(REPORT, "w", encoding="utf-8"), indent=1)


def trig(P):
    return P.js("() => { const c = CRESTBOUND.game.course; return c && c._triggered ? [...c._triggered] : null; }")


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1m") as P:
        azboot(P, "azure-1")

        # ------------------------------------------------ 1 the tide switch
        P.say("=== THE TIDE SWITCH — pound the crate at (-4.5, 5.65, -33.4) ===")
        P.say("  triggers at start:", json.dumps(trig(P)))
        movers0 = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='mover'&&h.def.p[2]<-36)
            .map(h=>({p:h.def.p, y:h.colliders&&h.colliders[0]?+h.colliders[0].center.y.toFixed(2):null}))""")
        P.say("  sluice movers before:", json.dumps(movers0))
        # land ON the crate: it is 5.00 -> 6.30 tall
        P.tp(-4.5, 7.6, -33.4)
        P.wait(1600)
        s = P.state()
        P.say("  dropped onto the crate ->", s["pos"], s["pstate"], "grounded", s["grounded"])
        P.shot("01_on_crate")
        for i in range(5):
            P.tap("SPACE", 130); P.wait(300)
            P.down("C"); P.wait(1300); P.up("C")
            P.wait(900)
            t = trig(P)
            b = P.js("""() => { for (const h of (CRESTBOUND.game.course.hazards||[]))
                if (h.def && h.def.kind==='breakable' && h.def.trigger==='tide-drawn') return {broken:!!h.broken};
                return null; }""")
            P.say("   pound %d: pos %s triggers %s crate %s" % (i, P.pos(), json.dumps(t), json.dumps(b)))
            P.shot("02_pound_%d" % i)
            if t and "tide-drawn" in t:
                break
        t = trig(P)
        P.shot("03_tide_after")
        if not t or "tide-drawn" not in t:
            D(what="The tide switch never fires — pounding the pedestal on the north terrace does not raise 'tide-drawn', so the sluice never answers",
              where="azure-1 north terrace, the 'breakable' tide pedestal at (-4.5, 5.65, -33.4) with trigger 'tide-drawn'; the sign above it reads 'POUND THE PEDESTAL - THE SLUICE ANSWERS'",
              did="dropped onto the crate from 2 m above it and ground-pounded five times (jump, then C in the air)",
              happened="course._triggered stayed %s and the crate's broken flag stayed false" % json.dumps(t),
              should="the pound should break the pedestal and fire 'tide-drawn' — it is the beat the whole BEAT 6 sign and cp4 are built around",
              png="_shots/play_azure1m/03_tide_after.png")
        else:
            W("Pounding the tide pedestal fires 'tide-drawn' and the sluice beat resolves.")

        # ------------------------------------------------ 2 the urns
        P.say("\n=== THE TERRACE URNS — pound one without walking through the beam ===")
        P.js("() => CRESTBOUND.game.__dev.freezeHazards(true)")
        P.wait(500)
        c0 = P.js("() => { const c=CRESTBOUND.game._collectibles; return c? c.counts.coins : -1; }")
        P.tp(-7.6, 7.4, -15.4)
        P.wait(1500)
        s = P.state()
        P.say("  above the urn:", s["pos"], s["pstate"], "deaths", P.js("() => CRESTBOUND.game.deaths"))
        P.shot("04_urn_above")
        for i in range(4):
            P.tap("SPACE", 130); P.wait(280)
            P.down("C"); P.wait(1200); P.up("C")
            P.wait(800)
            c1 = P.js("() => { const c=CRESTBOUND.game._collectibles; return c? c.counts.coins : -1; }")
            brk = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='breakable'&&h.def.drop==='coins'&&h.def.p[2]>-20)
                .map(h=>({p:h.def.p, broken:!!h.broken}))""")
            P.say("   pound %d: coins %d -> %d ; urns %s ; pos %s" % (i, c0, c1, json.dumps(brk), P.pos()))
            if c1 > c0:
                break
        P.shot("05_urn_after")
        c1 = P.js("() => { const c=CRESTBOUND.game._collectibles; return c? c.counts.coins : -1; }")
        brk = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='breakable'&&h.def.drop==='coins'&&h.def.p[2]>-20)
            .map(h=>({p:h.def.p, broken:!!h.broken}))""")
        if not any(b["broken"] for b in (brk or [])):
            D(what="The terrace urns cannot be broken by a ground pound",
              where="azure-1 temple terrace, the 'breakable' barrels at (-7.6 / 7.6, 5.55, -15.4) and (-9.0, 5.55, -29.0), all drop:'coins'",
              did="froze the hazards so the terrace beam could not kill me, dropped onto the west urn from 2 m up and pounded four times",
              happened="none of the urns report broken=true and the coin count stayed at %d; %s" % (c1, json.dumps(brk)),
              should="a breakable with drop:'coins' should shatter on a pound and give its coins",
              png="_shots/play_azure1m/05_urn_after.png")
        else:
            W("The terrace urns break to a ground pound and drop their coins (%d -> %d)." % (c0, c1))
        P.js("() => CRESTBOUND.game.__dev.freezeHazards(false)")

        # ------------------------------------------------ 3 the race rings
        P.say("\n=== THE TIDE GAUNTLET — the race rings from the shoal ===")
        rings = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='rings')
            .map(h=>({id:h.def.id, n:(h.def.pts||[]).length, r:h.def.r, limit:h.def.limitMs}))""")
        P.say("  rings:", json.dumps(rings))
        P.tp(0, 1.4, 12)
        P.wait(1500)
        P.shot("06_race_start")
        snap0 = P.js("() => { const s = CRESTBOUND.game.__dev.state(); return {race: s.raceMs, ring: s.ring||null}; }")
        P.say("  snapshot at the race start pad:", json.dumps(snap0))
        e = drive(P, 0, 6, 6, tag="07_race", every=3)
        snap1 = P.js("() => { const s = CRESTBOUND.game.__dev.state(); return {race: s.raceMs, ring: s.ring||null}; }")
        P.say("  after leaving the start pad:", json.dumps(snap1), e["pos"])
        P.shot("08_race_after")
        if snap1.get("race") in (None, 0) and snap0.get("race") in (None, 0):
            P.say("  (no race clock started — HUD raceMs is %s)" % json.dumps(snap1.get("race")))

        flush(rep)
        P.dump("azure1m")


main()
