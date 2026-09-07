"""PLAYTEST — AZURE-1, segment G: the sanctum crest done carefully, the Warden,
the tidewell + metal hat + coral secret, the tide stones, ROUTE B drums and
ROUTE C cistern shaft, and a deliberate look at the water rim (P8) and the
camera inside the temple (P10).
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


def cam(P):
    return P.js("""() => { const G=CRESTBOUND.game, C=G.cam;
      const cp=(C.camera||C.cam||{}).position || {x:0,y:0,z:0}, hp=G.player.pos;
      return { dist:+C.dist.toFixed(2), real:+Math.hypot(cp.x-hp.x, cp.y-hp.y-0.8, cp.z-hp.z).toFixed(2),
               mode:C.mode, camPos:[+cp.x.toFixed(1),+cp.y.toFixed(1),+cp.z.toFixed(1)] }; }""")


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1g") as P:
        azboot(P, "azure-1")

        # ============================ 1. THE SANCTUM CREST, carefully
        P.say("=== THE SANCTUM CREST (0, 16.45, -24) — approach it slowly ===")
        P.tp(0, 14.6, -21.5)
        P.wait(1200)
        d0 = P.js("() => CRESTBOUND.game.deaths")
        c0 = P.js("() => CRESTBOUND.game.save.crestTotal()")
        P.shot("01_crest_approach")
        P.say("  cam:", json.dumps(cam(P)))
        # inch forward 1 m at a time and jump at the pedestal
        for i in range(6):
            drive(P, 0, -24, 0.75, tag="02_inch%d" % i)
            P.tap("SPACE", 130)
            P.wait(900)
            s = P.state()
            P.say("   step %d: %s %s deaths=%s crests=%s" % (
                i, s["pos"], s["pstate"], P.js("() => CRESTBOUND.game.deaths"),
                P.js("() => CRESTBOUND.game.save.crestTotal()")))
            P.shot("03_crest_step%d" % i)
            if P.js("() => CRESTBOUND.game.save.crestTotal()") > c0:
                break
        d1 = P.js("() => CRESTBOUND.game.deaths")
        c1 = P.js("() => CRESTBOUND.game.save.crestTotal()")
        gs = P.state()
        P.say("  RESULT deaths %d -> %d, crests %d -> %d, state %s pos %s" % (d0, d1, c0, c1, gs["gstate"], gs["pos"]))
        P.shot("04_crest_result")
        if c1 <= c0:
            D(what="The sanctum crest cannot be collected by walking or jumping at it — the hero BONKS off its pedestal, and pushing on kills him",
              where="azure-1 sanctum roof: the 'open' crest at (0, 16.45, -24) on the dais pedestal (dais top 15.11, roof deck 14.21). Approached from (0, 14.6, -21.5)",
              did="walked north at the pedestal in 0.75 s steps, jumping at it after each step, six times",
              happened="crest total stayed %d; the hero's state goes to 'bonk' against the pedestal and he died %d time(s) doing it, respawning at cp5 in the inner court" % (c1, d1 - d0),
              should="the course's headline crest should be collectable — touch it, or at worst jump onto the dais and touch it",
              png="_shots/play_azure1g/04_crest_result.png")
        else:
            W("The sanctum open crest collects (crests %d -> %d)." % (c0, c1))

        # ============================ 2. THE WARDEN
        P.say("\n=== THE WARDEN — does it ever wake up? ===")
        P.tp(0, 2.0, -44)
        P.wait(1200)
        P.shot("05_warden_approach")
        st = []
        P.face(0, -48)
        P.down("W")
        for i in range(40):
            P.wait(300)
            P.face(0, -48)
            w = P.js("""() => { for (const c of (CRESTBOUND.game.course.critters||[]))
                if (c.def && c.def.kind==='warden') return {s:c.state, hp:c.hp, alive:c.alive,
                  p: c.pos? [+c.pos.x.toFixed(1),+c.pos.y.toFixed(1),+c.pos.z.toFixed(1)]:null};
                return null; }""")
            st.append((P.pos(), w))
            if i % 10 == 0:
                P.shot("06_warden_%02d" % i)
        P.up("W")
        P.say("  warden trace:")
        for s in st[::6]:
            P.say("    ", s)
        wf = st[-1][1]
        P.shot("07_warden_end")
        if wf and wf.get("s") == "dormant":
            D(what="The Warden never wakes — you can stand in the middle of its arena for 12 s and it stays 'dormant', so the boss crest is unobtainable",
              where="azure-1 inner court, the warden authored at (0, 1.6, -48) with arena {c:[0,-48], r:7}; walked in from (0, 2.0, -44)",
              did="walked due north into the centre of the arena and stayed there for 12 s, sampling the critter's state every 300 ms",
              happened="critter.state stayed '%s' with hp %s for the whole approach; nothing attacked, nothing telegraphed" % (wf.get("s"), wf.get("hp")),
              should="a 3-hit mini-boss should aggro when the player enters its ring, telegraph a stomp/charge, and be poundable so the 'boss' crest can spawn",
              png="_shots/play_azure1g/07_warden_end.png")
        else:
            W("The Warden wakes when the player enters its ring (state %s)." % (wf and wf.get("s")))

        # ============================ 3. THE METAL HAT + THE TIDEWELL
        P.say("\n=== THE METAL HAT on the east reef pad (26, 1.85, 22) ===")
        P.tp(26, 3.0, 24)
        P.wait(1200)
        P.shot("08_hat_approach")
        pw0 = P.js("() => { const s = CRESTBOUND.game.__dev.state(); return s.power || null; }")
        drive(P, 26, 22, 4, tag="09_hat")
        P.wait(800)
        pw1 = P.js("() => { const s = CRESTBOUND.game.__dev.state(); return s.power || null; }")
        P.say("  power before %s after %s" % (json.dumps(pw0), json.dumps(pw1)))
        P.shot("10_hat_after")
        if not pw1:
            D(what="The metal hat on the east reef pad does not pick up when you walk onto it",
              where="azure-1 east reef pad, the 'metal' power at (26, 1.85, 22), duration 20 s",
              did="landed on the pad at (26, 3.0, 24) and walked south onto the hat for 4 s",
              happened="game.__dev.state().power stayed %s" % json.dumps(pw1),
              should="walking into a power should equip it and start its 20 s timer; the tidewell's coral wall and the secret crest depend on it",
              png="_shots/play_azure1g/10_hat_after.png")
        else:
            W("The metal hat picks up on contact and shows in the HUD power slot (%s)." % json.dumps(pw1))

        P.say("\n=== THE TIDEWELL — swim/walk to the bottom at -6.40, sigil 4 and the coral wall ===")
        P.tp(-32, -1.0, -4.0)
        P.wait(1200)
        P.shot("11_well_top")
        P.say("  cam at the well mouth:", json.dumps(cam(P)))
        P.down("C")
        ys = []
        for i in range(30):
            P.wait(300)
            s = P.state()
            ys.append((round(s["pos"][1], 2), s["pstate"], s["submerged"]))
            if i % 10 == 0:
                P.shot("12_well_%02d" % i)
            if s["pos"][1] < -5.9:
                break
        P.up("C")
        s = P.state()
        P.say("  sank to", s["pos"], s["pstate"], "; trace", ys[::4])
        P.shot("13_well_bottom")
        reached_floor = s["pos"][1] < -5.5
        if not reached_floor:
            D(what="You cannot sink to the floor of the tidewell — crouch bottoms out %.2f m above it" % (abs(-6.40 - s["pos"][1])),
              where="azure-1 the tidewell, a bowl in the lagoon floor at (-32, -6.40, -6); entered at (-32, -1.0, -4.0) and held crouch",
              did="held C for up to 9 s to sink",
              happened="stopped at y %.2f (state %s)" % (s["pos"][1], s["pstate"]),
              should="sigil 4, five coins and the coral wall all sit on the -6.40 floor; a swimmer must be able to get down there",
              png="_shots/play_azure1g/13_well_bottom.png")
        else:
            W("A swimmer can sink to the tidewell floor at %.2f m." % s["pos"][1])

        # the coral wall — pound it
        P.say("\n  the coral wall at (-32, -5.25, -10.2): pound it")
        P.tp(-32, -5.6, -8.6)
        P.wait(900)
        P.shot("14_coral_before")
        for i in range(4):
            P.tap("SPACE", 120); P.wait(240)
            P.down("C"); P.wait(1200); P.up("C")
            P.wait(700)
        P.shot("15_coral_after")
        broke = P.js("""() => { for (const h of (CRESTBOUND.game.course.hazards||[]))
            if (h.def && h.def.kind==='breakable' && h.def.trigger==='coral-broken') return {broken:!!h.broken};
            return null; }""")
        P.say("  coral wall:", json.dumps(broke))
        if broke and not broke.get("broken"):
            D(what="The tidewell coral wall does not break to a ground pound, so the secret crest chamber never opens",
              where="azure-1 tidewell floor, the 'breakable' coral at (-32, -5.25, -10.2) with trigger 'coral-broken' and drop 'crest'",
              did="floated at (-32, -5.6, -8.6) right in front of it and jumped+pounded four times",
              happened="the breakable's broken flag is still false",
              should="the sign there says 'TOO HEAVY TO FLOAT - HEAVY ENOUGH TO POUND'; with the metal hat on, a pound should shatter it. (Tested without the hat because the hat could not be picked up.)",
              png="_shots/play_azure1g/15_coral_after.png")
        else:
            W("The tidewell coral wall breaks to a pound (%s)." % json.dumps(broke))

        # ============================ 4. THE TIDE STONES
        P.say("\n=== THE TIDE STONES — four vanish tiles at z -20, x -21/-25.2/-29.4/-33.6 ===")
        P.tp(-21, 1.4, -20)
        P.wait(1200)
        P.shot("16_stones")
        ys = []
        for i in range(26):
            P.wait(300)
            s = P.state()
            ys.append((round(s["pos"][1], 2), s["grounded"], s["pstate"], s["inWater"]))
            if i % 8 == 0:
                P.shot("17_stone_%02d" % i)
        P.say("  standing on tide stone 1:", ys)
        P.shot("18_stones_end")

        # ============================ 5. ROUTE C — the cistern shaft
        P.say("\n=== ROUTE C — the cistern shaft: 3.20 m clear, 9.60 m tall, 4 wall kicks ===")
        P.tp(0, 5.4, -31.0)
        P.wait(1000)
        P.shot("19_cistern_door")
        P.say("  cam at the cistern door:", json.dumps(cam(P)))
        e = drive(P, 0, -33.5, 4, tag="20_cistern")
        P.say("  inside?", e["pos"], e["pstate"])
        P.shot("21_cistern_in")
        # try the kick chain: jump, then jump again at a wall
        for i in range(8):
            P.tap("SPACE", 130)
            P.wait(420)
            s = P.state()
            P.say("   kick %d: %s %s" % (i, s["pos"], s["pstate"]))
            if i % 3 == 0:
                P.shot("22_kick_%d" % i)
        P.shot("23_cistern_end")

        flush(rep)
        P.dump("azure1g")


main()
