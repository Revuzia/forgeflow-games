"""PLAYTEST — AZURE-1, segment H: the loose ends.
  1 what actually kills you at the sanctum crest
  2 the coral wall WITH the metal hat on
  3 standing on a tide stone properly
  4 ROUTE C wall kicks done the way a player does them (hold into the wall + jump)
  5 the great stair, three times, from the water
  6 a camera trace through the temple interior (P10)
  7 sigils / coins actually collecting
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
      const cp=(C.camera||{}).position||{x:0,y:0,z:0}, hp=G.player.pos;
      return { dist:+C.dist.toFixed(2), real:+Math.hypot(cp.x-hp.x, cp.y-hp.y-0.8, cp.z-hp.z).toFixed(2),
               pitch:+C.pitch.toFixed(2), mode:C.mode }; }""")


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1h") as P:
        azboot(P, "azure-1")
        P.js("() => { CRESTBOUND.game._deathLog = []; const o = CRESTBOUND.game.onDeath.bind(CRESTBOUND.game); CRESTBOUND.game.onDeath = function(c){ CRESTBOUND.game._deathLog.push({cause:c, pos:[+this.player.pos.x.toFixed(2),+this.player.pos.y.toFixed(2),+this.player.pos.z.toFixed(2)], t:this.timeMs}); return o(c); }; }")

        # ---------------------------------------------------- 1 crest death
        P.say("=== 1. WHAT KILLS YOU AT THE SANCTUM CREST ===")
        P.tp(0, 14.6, -21.5)
        P.wait(1200)
        P.js("() => CRESTBOUND.game._deathLog = []")
        P.face(0, -26)
        P.down("W")
        trail = []
        for i in range(30):
            P.wait(250)
            P.face(0, -26)
            s = P.state()
            trail.append((round(s["pos"][0], 2), round(s["pos"][1], 2), round(s["pos"][2], 2), s["pstate"]))
            if i % 8 == 0:
                P.shot("01_crest_%02d" % i)
            if s["pstate"] == "dead" or s["gstate"] == "dead":
                break
        P.up("W")
        dl = P.js("() => CRESTBOUND.game._deathLog")
        P.say("  trail:", trail[::3])
        P.say("  DEATH LOG:", json.dumps(dl))
        P.shot("02_crest_death")
        # try jumping ON TOP of the pedestal instead
        P.say("  now try landing ON the pedestal from above")
        P.tp(0, 18.5, -24)
        P.wait(1500)
        s = P.state()
        c0 = P.js("() => CRESTBOUND.game.save.crestTotal()")
        P.wait(2500)
        c1 = P.js("() => CRESTBOUND.game.save.crestTotal()")
        s2 = P.state()
        P.say("  dropped onto the crest from above: %s -> %s crests %d -> %d state %s" % (s["pos"], s2["pos"], c0, c1, s2["gstate"]))
        P.say("  deaths:", json.dumps(P.js("() => CRESTBOUND.game._deathLog")))
        P.shot("03_crest_drop")

        # ---------------------------------------------------- 2 coral + hat
        P.say("\n=== 2. THE CORAL WALL WITH THE METAL HAT ON ===")
        P.js("() => CRESTBOUND.game.__dev.power('metal', 60)")
        P.wait(600)
        pw = P.js("() => { const s = CRESTBOUND.game.__dev.state(); return s.power||null; }")
        P.say("  power:", json.dumps(pw))
        P.tp(-32, -5.8, -8.8)
        P.wait(1200)
        P.shot("04_coral_hat_before")
        st = P.state()
        P.say("  at the coral wall:", st["pos"], st["pstate"], "grounded", st["grounded"], "inWater", st["inWater"])
        for i in range(5):
            P.tap("SPACE", 130); P.wait(280)
            P.down("C"); P.wait(1300); P.up("C")
            P.wait(700)
            b = P.js("""() => { for (const h of (CRESTBOUND.game.course.hazards||[]))
                if (h.def && h.def.kind==='breakable' && h.def.trigger==='coral-broken') return !!h.broken;
                return null; }""")
            P.say("   pound %d -> broken=%s  pos %s" % (i, b, P.pos()))
            if b:
                break
        P.shot("05_coral_hat_after")
        broke = P.js("""() => { for (const h of (CRESTBOUND.game.course.hazards||[]))
            if (h.def && h.def.kind==='breakable' && h.def.trigger==='coral-broken') return !!h.broken;
            return null; }""")
        if not broke:
            D(what="Even with the metal hat on, the tidewell coral wall will not break to a ground pound — the secret crest is unobtainable",
              where="azure-1 tidewell floor, the coral 'breakable' at (-32, -5.25, -10.2), trigger 'coral-broken', drop 'crest'; player floating at (-32, -5.8, -8.8), power 'metal' forced on for 60 s",
              did="jumped and pressed C to pound, five times in a row, right in front of the wall",
              happened="the breakable's broken flag stayed false every time",
              should="the sign beside it reads 'TOO HEAVY TO FLOAT - HEAVY ENOUGH TO POUND'; the metal hat is the whole point of that beat",
              png="_shots/play_azure1h/05_coral_hat_after.png")
        else:
            W("With the metal hat on, pounding the tidewell coral wall breaks it open.")

        # ---------------------------------------------------- 3 tide stone
        P.say("\n=== 3. STANDING ON A TIDE STONE ===")
        P.js("() => CRESTBOUND.game.__dev.setClock(0)")
        P.tp(-21, 2.2, -20)
        P.wait(400)
        ys = []
        for i in range(40):
            P.wait(250)
            s = P.state()
            ys.append((round(s["pos"][1], 2), s["grounded"], s["pstate"]))
            if i % 10 == 0:
                P.shot("06_stone_%02d" % i)
        P.say("  y/grounded on tide stone 1:", ys)
        stood = any(g and abs(y - 0.60) < 0.35 for y, g, _ in ys)
        P.shot("07_stone_end")
        if not stood:
            D(what="The tide stones cannot be stood on — you drop straight through the first one into the sea and can never get back on",
              where="azure-1, the four 'vanish' tide stones at z -20 (x -21, -25.2, -29.4, -33.6), tops at 0.60, over 3 m of water. Course clock reset to 0 so tile 1 (phase 0) should be solid",
              did="dropped onto tile 1 from 1.6 m above it and stayed there for 10 s, sampling grounded state",
              happened="never grounded near 0.60 m; the trace is %s" % (ys[:8],),
              should="tile 1 is on a 3.2 s ON / 2.4 s OFF cycle at phase 0 — landing at clock 0 should be a solid tile, and sigil 5 sits on the last one",
              png="_shots/play_azure1h/07_stone_end.png")
        else:
            W("The tide stones hold the player during their ON phase and drop him during OFF.")

        # ---------------------------------------------------- 4 ROUTE C kicks
        P.say("\n=== 4. ROUTE C — wall kicks the way a player does them ===")
        P.tp(0, 5.4, -34.0)
        P.wait(1200)
        P.shot("08_shaft_in")
        P.say("  cam in the shaft:", json.dumps(cam(P)))
        best = 5.0
        for lap in range(6):
            # push into the west wall, jump, then jump again on contact
            P.face(-6, -34.0)
            P.down("W")
            P.tap("SPACE", 130)
            P.wait(320)
            P.tap("SPACE", 130)
            P.wait(320)
            P.face(6, -34.0)
            P.tap("SPACE", 130)
            P.wait(320)
            P.tap("SPACE", 130)
            P.wait(400)
            P.up("W")
            s = P.state()
            best = max(best, s["pos"][1])
            P.say("   lap %d: %s %s camdist %s" % (lap, s["pos"], s["pstate"], s["camDist"]))
            P.shot("09_kick_%d" % lap)
        P.say("  highest y reached in the cistern shaft: %.2f (exit ledge is 14.60)" % best)
        P.shot("10_shaft_end")
        if best < 8.0:
            D(what="ROUTE C's cistern shaft cannot be wall-kicked: pushing into a wall and jumping never gets more than %.1f m up a 9.60 m shaft" % (best - 5.0),
              where="azure-1, the cistern shaft behind the temple's north face, floor 5.00, exit ledge 14.60, 3.20 m clear (sign inside reads 'ROUTE C - KICK ONE WALL, THEN THE OTHER')",
              did="stood on the shaft floor and ran six laps of: hold into the west wall + jump + jump, then hold into the east wall + jump + jump",
              happened="the highest the hero ever reached was y %.2f, i.e. %.2f m off the floor; sigil 6 and the roof exit are 9.60 m up" % (best, best - 5.0),
              should="one jump (apex 1.91) plus four wall kicks at 2.00 m each is the authored solution; the wall kick has to fire off the shaft walls",
              png="_shots/play_azure1h/10_shaft_end.png")
        else:
            W("The cistern shaft wall-kicks: the hero got to y %.2f." % best)

        # ---------------------------------------------------- 5 great stair x3
        P.say("\n=== 5. THE GREAT STAIR FROM THE WATER, THREE TIMES ===")
        outs = []
        for k, z0 in enumerate((2.0, 0.5, -1.0)):
            P.tp(0, 0.0, z0)
            P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
            P.wait(1200)
            e = drive(P, 0, -12, 12, tag="11_stair%d" % k, every=10)
            outs.append((z0, e["pos"], e["pstate"]))
            P.say("   from z %.1f -> %s %s" % (z0, e["pos"], e["pstate"]))
            P.shot("12_stair%d_end" % k)
        ok = sum(1 for _, p, _ in outs if p[1] > 4.5)
        P.say("  %d of 3 attempts climbed out of the sea onto the terrace" % ok)
        if ok < 3:
            D(what="The great stair only lets you out of the sea some of the time — %d of 3 identical attempts wedged the swimmer under the treads instead" % (3 - ok),
              where="azure-1 great stair, swimming in from the drowned forecourt at z +2.0 / +0.5 / -1.0 on the centre line",
              did="zeroed velocity in the water, aimed up the flight and held W for 12 s, three times",
              happened="results: " + "; ".join("z%+0.1f -> %s (%s)" % (z, p, st) for z, p, st in outs),
              should="every approach along the stair's centre line should let the player climb out; a swimmer floats about 0.6 m above the submerged treads and gets no purchase",
              png="_shots/play_azure1h/12_stair0_end.png")
        else:
            W("The great stair climbs out of the sea reliably (3 of 3 approaches).")

        # ---------------------------------------------------- 6 sigil / coin
        P.say("\n=== 6. DO SIGILS AND COINS COLLECT? ===")
        c0 = P.js("() => { const c = CRESTBOUND.game._collectibles; return c ? {coins:c.counts.coins, sigils:c.counts.sigils} : null; }")
        P.tp(-6.0, 0.4, 20)      # sigil 2, the sunken wreck (hull top -1.61, sigil at -0.26)
        P.wait(1500)
        P.down("C"); P.wait(1500); P.up("C")
        P.wait(1500)
        c1 = P.js("() => { const c = CRESTBOUND.game._collectibles; return c ? {coins:c.counts.coins, sigils:c.counts.sigils} : null; }")
        P.say("  at sigil 2 (the wreck): %s -> %s" % (json.dumps(c0), json.dumps(c1)))
        P.shot("13_sigil2")
        P.tp(-32.0, -5.0, -6.0)  # sigil 4, tidewell floor
        P.wait(1500)
        drive(P, -32, -6, 3, tag="14_sigil4")
        c2 = P.js("() => { const c = CRESTBOUND.game._collectibles; return c ? {coins:c.counts.coins, sigils:c.counts.sigils} : null; }")
        P.say("  at sigil 4 (tidewell floor): -> %s" % json.dumps(c2))
        P.shot("15_sigil4")
        if c2 and c0 and c2["sigils"] > c0["sigils"]:
            W("Sigils collect on contact under water (%d -> %d)." % (c0["sigils"], c2["sigils"]))
        else:
            D(what="Swimming onto an underwater sigil does not collect it",
              where="azure-1: sigil 2 on the sunken wreck at (-6.0, -0.26, 20) and sigil 4 on the tidewell floor at (-32.0, -5.05, -6.0)",
              did="teleported next to each one, sank onto it and swam through it",
              happened="sigil count stayed %s" % (c2 and c2["sigils"]),
              should="a sigil collects on capsule overlap; four of this course's eight sigils are underwater",
              png="_shots/play_azure1h/15_sigil4.png")

        flush(rep)
        P.dump("azure1h")


main()
