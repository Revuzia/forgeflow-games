"""PLAYTEST — AZURE-1, segment D: the shoal + geyser jumppad, the sinking coral
pads, the 5.60 m dive into the drowned forecourt, the beams, the chained eel,
and THE GREAT STAIR up to the terrace (cp3).
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


def setyaw(P, yaw):
    P.js("(y) => { const G=CRESTBOUND.game; G.player.__test.setFacing(y); G.cam.yaw=y; G.cam._rcHoldT=0; }", yaw)


def yaw_to(P, x, z):
    return P.face(x, z)


def drive(P, x, z, secs, key="W", tag="", shots=0):
    """Hold a key aimed at an XZ target for `secs` of WALL time, re-aiming."""
    P.face(x, z)
    P.down(key)
    n = int(secs * 4)
    out = []
    for i in range(n):
        P.wait(250)
        P.face(x, z)
        s = P.state()
        out.append(s)
        if shots and i % shots == 0:
            P.shot("%s_%02d" % (tag or "drive", i))
    P.up(key)
    P.wait(200)
    e = P.state()
    P.say("  drive->(%s,%s) %s : end %s %s inWater=%s" % (x, z, tag, e["pos"], e["pstate"], e["inWater"]))
    return out


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1d") as P:
        boot(P)

        # ---------------------------------------------------- the shoal
        P.say("=== THE SHOAL (cp2) ===")
        P.tp(0, 1.4, 14)
        P.wait(900)
        drive(P, 0, 12, 3, tag="to cp2")
        st = P.state()
        cp = P.js("() => ({cp: CRESTBOUND.game.cpIndex})")
        P.say("  on the shoal:", st["pos"], st["pstate"], "cp", cp)
        P.shot("01_shoal")
        if cp["cp"] < 1:
            D(what="Standing on the shoal never fires checkpoint 2",
              where="azure-1 shoal, walked onto (0, 0.60, 12) where checkpoint 'cp-shoal' is authored",
              did="teleported to (0,1.4,14) and walked south-to-north onto the checkpoint",
              happened="game.cpIndex stayed %d" % cp["cp"],
              should="the checkpoint pad should fire and the HUD checkpoint pip should advance",
              png="_shots/play_azure1d/01_shoal.png")
        else:
            W("The shoal checkpoint (cp2) fires when you walk onto it.")

        # ---------------------------------------------------- the geyser
        P.say("\n=== THE GEYSER JUMPPAD at (3.5, 0.74, 13), power 7 ===")
        P.tp(3.5, 1.6, 13)
        P.wait(900)
        y0 = P.pos()[1]
        peak = y0
        for i in range(24):
            P.wait(200)
            s = P.state()
            peak = max(peak, s["pos"][1])
        P.say("  standing on the pad: y %.2f -> peak %.2f (rise %.2f m)" % (y0, peak, peak - y0))
        P.shot("02_geyser")
        if peak - y0 < 1.0:
            D(what="The shoal geyser jump pad does not launch you — standing on it does nothing",
              where="azure-1 shoal, the 'jumppad' at (3.5, 0.74, 13) with power 7.0",
              did="teleported onto the pad and stood on it for 5 s without touching a key",
              happened="peak height %.2f m, a rise of only %.2f m" % (peak, peak - y0),
              should="power 7.0 should throw the player about 7 m up; the course calls it 'the only launcher'",
              png="_shots/play_azure1d/02_geyser.png")
        else:
            W("The shoal geyser jumppad launches the player %.2f m." % (peak - y0))

        # ---------------------------------------------------- sinker pads
        P.say("\n=== THE SINKING CORAL PADS (4 sinkers, delay 1.2 s, depth 4) ===")
        P.tp(-4.5, 1.2, 28.0)
        P.wait(1200)
        ys = []
        for i in range(30):
            P.wait(300)
            s = P.state()
            ys.append(round(s["pos"][1], 2))
            if i in (0, 8, 16, 28):
                P.shot("03_sinker_%02d" % i)
        P.say("  standing on sinker 1, y over 9 s:", ys)
        st = P.state()
        P.say("  end:", st["pos"], st["pstate"], "inWater", st["inWater"])
        if max(ys) - min(ys) < 0.5:
            D(what="The sinking coral pads never sink — standing on one for 9 s does not move it",
              where="azure-1 lagoon, the 'sinker' pad at (-4.5, 0.10, 28.0) (delay 1.2 s, speed 0.9, depth 4)",
              did="teleported onto the pad and stood still for 9 s",
              happened="the player's y only varied by %.2f m (%s)" % (max(ys) - min(ys), ys[:6]),
              should="the pad should sink under the player's weight after 1.2 s and drop him into the water",
              png="_shots/play_azure1d/03_sinker_00.png")
        else:
            W("The sinking coral pads sink under the player (%.2f m of travel over 9 s)." % (max(ys) - min(ys)))

        # ---------------------------------------------------- the dive
        P.say("\n=== BEAT 3 — THE 5.60 m DIVE INTO THE DROWNED FORECOURT ===")
        P.tp(0, 1.4, 10)
        P.wait(900)
        P.shot("04_before_dive")
        # swim north off the shoal into the deep water then sink
        drive(P, 0, 3, 5, tag="swim into the forecourt")
        P.say("  now hold C to sink to the forecourt floor (-5.60)")
        deep = []
        P.down("C")
        for i in range(40):
            P.wait(300)
            s = P.state()
            deep.append((round(s["pos"][0], 1), round(s["pos"][1], 2), round(s["pos"][2], 1), s["pstate"]))
            if s["pos"][1] < -4.9:
                break
        P.up("C")
        st = P.state()
        P.say("  bottom:", st["pos"], st["pstate"], "submerged", st["submerged"])
        for d0 in deep[::5]:
            P.say("    ", d0)
        P.shot("05_forecourt_floor")

        # can I see / read the beams from down here, and do they kill?
        beams = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h => h.def && h.def.kind==='beam')
            .map(h => ({a:h.def.a, b:h.def.b, on: !!h.on, kills: (h.kills||[]).length}))""")
        P.say("  beams:", json.dumps(beams))

        # walk into a beam deliberately and see whether it kills fairly
        P.say("  swimming into the z=+6 beam line on purpose")
        d0 = P.state()["pstate"]
        deaths0 = P.js("() => CRESTBOUND.game.deaths")
        P.tp(0, -4.2, 8.0)
        P.wait(600)
        drive(P, 0, 5.0, 6, tag="into the beam")
        deaths1 = P.js("() => CRESTBOUND.game.deaths")
        st = P.state()
        P.say("  deaths %d -> %d ; state %s %s" % (deaths0, deaths1, st["gstate"], st["pstate"]))
        P.shot("06_beam")

        # ---------------------------------------------------- the eel
        P.say("\n=== THE CHAINED EEL (gnasher) at post (-6, -5.60, -2) ===")
        crit = P.js("""() => (CRESTBOUND.game.course.critters||[]).map(c => ({
            kind: c.def && c.def.kind, p: c.def && c.def.p,
            pos: c.mesh ? [+c.mesh.position.x.toFixed(1), +c.mesh.position.y.toFixed(1), +c.mesh.position.z.toFixed(1)] : null }))""")
        P.say("  critters:", json.dumps(crit))
        # stand still just outside its radius and see if it can reach
        P.tp(-6.0, -4.6, 3.5)
        P.wait(800)
        deaths0 = P.js("() => CRESTBOUND.game.deaths")
        P.shot("07_eel_watch")
        for i in range(20):
            P.wait(400)
        deaths1 = P.js("() => CRESTBOUND.game.deaths")
        st = P.state()
        P.say("  stood still 8 s at 5.5 m from the eel post: deaths %d -> %d, state %s" % (deaths0, deaths1, st["gstate"]))
        P.shot("08_eel_after")
        if deaths1 > deaths0:
            D(what="The chained eel kills a player who is standing still well outside its post, with no telegraph you can act on",
              where="azure-1 drowned forecourt, floating at (-6.0, -4.6, 3.5), 5.5 m from the gnasher post at (-6, -5.60, -2)",
              did="floated still for 8 s without moving or pressing anything",
              happened="died %d time(s)" % (deaths1 - deaths0),
              should="a chained critter should only reach inside its chain length, and should telegraph before it lunges",
              png="_shots/play_azure1d/08_eel_after.png")
        else:
            W("The chained eel does not reach a player floating 5.5 m from its post.")

        # ---------------------------------------------------- the great stair
        P.say("\n=== BEAT 4 — THE GREAT STAIR: 35 treads out of the sea ===")
        P.tp(0, -4.5, -1.0)
        P.wait(900)
        P.shot("09_stair_foot")
        P.say("  swimming/walking north up the stair, holding W for 25 s")
        P.face(0, -14)
        P.down("W")
        track = []
        for i in range(100):
            P.wait(250)
            P.face(0, -14)
            s = P.state()
            track.append((round(s["pos"][0], 1), round(s["pos"][1], 2), round(s["pos"][2], 1), s["pstate"]))
            if i % 16 == 0:
                P.shot("10_stair_%02d" % i)
            if s["pos"][1] > 5.4 and s["pos"][2] < -10:
                break
        P.up("W")
        st = P.state()
        P.say("  stair end:", st["pos"], st["pstate"], "grounded", st["grounded"])
        for t in track[::8]:
            P.say("    ", t)
        P.shot("11_stair_top")
        if st["pos"][1] < 5.0:
            D(what="Holding forward at the foot of the great stair does not climb it — the set-piece staircase is not walkable",
              where="azure-1, the 35-tread great stair, entered at the drowned forecourt floor (0, -4.5, -1.0)",
              did="aimed the camera up the stair (due north) and held W for %d samples" % len(track),
              happened="finished at %s in state %s — never reached the terrace at 5.00" % (st["pos"], st["pstate"]),
              should="35 treads of 0.312 m rise / 0.368 m run is a walk-up; holding forward should climb it to the terrace",
              png="_shots/play_azure1d/11_stair_top.png")
        else:
            W("The great stair climbs on a held W from the forecourt to the terrace (%s)." % (st["pos"],))

        flush(rep)
        P.dump("azure1d")


main()
