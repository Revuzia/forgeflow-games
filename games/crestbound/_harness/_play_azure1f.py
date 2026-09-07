"""PLAYTEST — AZURE-1, segment F: is there ANY walkable way from the terrace /
tide switch down into the inner court? Then the Warden, and the three routes to
the sanctum crest (A ceremonial stair, B colonnade drums, C cistern shaft).
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_azlib import boot as azboot, drive as azdrive

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
    for i in range(int(secs * 4)):
        P.wait(250)
        P.face(x, z)
        if every and i % every == 0:
            P.shot("%s_%02d" % (tag or "drive", i))
    for k in keys:
        P.up(k)
    P.wait(200)
    e = P.state()
    P.say("  drive->(%s,%s) %-18s end %s %s g=%s water=%s camdist=%s" %
          (x, z, tag, e["pos"], e["pstate"], e["grounded"], e["inWater"], e["camDist"]))
    return e


def camread(P):
    return P.js("""() => { const G=CRESTBOUND.game, C=G.cam;
      const cp = C.cam.position, hp = G.player.pos;
      const d = Math.hypot(cp.x-hp.x, cp.y-(hp.y+0.8), cp.z-hp.z);
      return { dist:+C.dist.toFixed(2), mode:C.mode, real:+d.toFixed(2),
               yaw:+C.yaw.toFixed(2), pitch:+C.pitch.toFixed(2),
               camPos:[+cp.x.toFixed(1),+cp.y.toFixed(1),+cp.z.toFixed(1)] }; }""")


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1f") as P:
        azboot(P, 'azure-1')

        # ============================== terrace -> court, every lane
        P.say("=== IS THERE A WALK FROM THE TERRACE (5.00) DOWN TO THE INNER COURT (1.60)? ===")
        lanes = [(-12, "west of the sluice"), (-6, "on the west gate"), (0, "the middle"),
                 (6, "on the east gate"), (12, "east of the sluice")]
        reached = []
        for x, label in lanes:
            P.tp(x, 5.6, -33.0)
            P.wait(900)
            s0 = P.state()
            e = drive(P, x, -44, 12, tag="01_lane%+d" % x, every=8)
            ok = e["pos"][2] < -40 and e["pos"][1] < 2.6
            P.say("   lane x=%+d (%s): start %s end %s  -> %s" %
                  (x, label, s0["pos"], e["pos"], "REACHED THE COURT" if ok else "BLOCKED"))
            reached.append((x, label, ok, e["pos"]))
            P.shot("02_lane%+d_end" % x)
        good = [r for r in reached if r[2]]
        if not good:
            D(what="THERE IS NO WALKABLE WAY FROM THE TERRACE / TIDE SWITCH DOWN INTO THE INNER COURT — every lane is walled off",
              where="azure-1, walking north from the tide-switch terrace (z -33, y 5.6) toward the inner court flat at (0, 1.60, -46). Tried five lanes across the sluice channel: x -12, -6, 0, +6, +12",
              did="teleported to each lane on the terrace and held W due north for 12 s, re-aiming every 250 ms",
              happened="every lane stopped short: " + "; ".join("x%+d -> %s" % (r[0], r[3]) for r in reached),
              should="the course header says 'the ground beside them falls from 4.76 at z -34 to 1.60 at z -40 at 28 deg, which is a walk' — the inner court, cp5, the water wheels, the vanish grates and the Warden all live behind this",
              png="_shots/play_azure1f/02_lane+0_end.png")
        else:
            W("The inner court is reachable on foot from the terrace via lane(s) " +
              ", ".join("x=%+d (%s)" % (r[0], r[1]) for r in good) + ".")

        # ============================== the Warden
        P.say("\n=== THE WARDEN OF THE DRAINED COURT ===")
        P.tp(0, 2.2, -42)
        P.wait(1200)
        P.shot("03_court_arrive")
        w = P.js("""() => { const cs=(CRESTBOUND.game.course.critters||[]);
            for (const c of cs) if (c.def && c.def.kind==='warden')
              return {p:c.def.p, arena:c.def.arena, hp:c.hp, alive:c.alive!==false,
                      pos: c.root? [+c.root.position.x.toFixed(1),+c.root.position.y.toFixed(1),+c.root.position.z.toFixed(1)] :
                           (c.mesh? [+c.mesh.position.x.toFixed(1),+c.mesh.position.y.toFixed(1),+c.mesh.position.z.toFixed(1)]:null),
                      keys: Object.keys(c).slice(0,24)};
            return null; }""")
        P.say("  warden:", json.dumps(w))
        deaths0 = P.js("() => CRESTBOUND.game.deaths")
        e = drive(P, 0, -48, 10, tag="04_warden", every=5)
        deaths1 = P.js("() => CRESTBOUND.game.deaths")
        P.say("  walked into the ring: %s ; deaths %d -> %d" % (e["pos"], deaths0, deaths1))
        P.shot("05_warden_ring")
        w2 = P.js("""() => { const cs=(CRESTBOUND.game.course.critters||[]);
            for (const c of cs) if (c.def && c.def.kind==='warden')
              return {hp:c.hp, state:c.state, pos: c.root? [+c.root.position.x.toFixed(1),+c.root.position.y.toFixed(1),+c.root.position.z.toFixed(1)]:null};
            return null; }""")
        P.say("  warden after 10 s in its ring:", json.dumps(w2))
        if w2 and w2.get("pos") and abs(w2["pos"][0]) < 0.2 and abs(w2["pos"][2]) < 0.2:
            P.say("  (warden root still at origin — it may not have spawned into the world)")

        # ============================== ROUTE A — the ceremonial stair
        P.say("\n=== ROUTE A — the ceremonial stair, terrace 5.00 -> pier 9.50 -> roof 14.21 ===")
        P.tp(12.0, 5.6, -18.0)
        P.wait(1000)
        P.shot("06_routeA_start")
        e = drive(P, 12, -30, 14, tag="07_routeA", every=8)
        P.say("  route A flight 1+2:", e["pos"], e["pstate"])
        P.shot("08_routeA_end")
        if e["pos"][1] < 9.0:
            D(what="ROUTE A, the ceremonial stair to the sanctum roof, does not climb on a held forward",
              where="azure-1 temple, the east ceremonial flight from the terrace at (12, 5.6, -18) toward the pier landing at 9.50 and the second flight to 14.30",
              did="aimed north up the flight and held W for 14 s",
              happened="ended at %s in state %s" % (e["pos"], e["pstate"]),
              should="two 15/16-tread flights of 0.30 m rise should walk up to the roof deck at 14.21; ROUTE A is the course's 'always works' line",
              png="_shots/play_azure1f/08_routeA_end.png")
        else:
            W("ROUTE A (the east ceremonial stair) climbs to %s on a held W." % (e["pos"],))

        # ============================== the sanctum crest
        P.say("\n=== THE SANCTUM CREST at (0, 16.45, -24), dais 15.11, roof 14.21 ===")
        P.tp(0, 14.6, -20.0)
        P.wait(1000)
        P.shot("09_roof")
        crest0 = P.js("() => CRESTBOUND.game.save.crestTotal()")
        e = drive(P, 0, -24, 8, tag="10_crest", every=4)
        P.say("  walked at the dais:", e["pos"], e["pstate"])
        P.tap("SPACE", 130); P.wait(1400)
        e2 = P.state()
        P.say("  after a jump at the dais:", e2["pos"], e2["pstate"], "gstate", e2["gstate"])
        P.shot("11_crest_try")
        P.wait(2500)
        crest1 = P.js("() => CRESTBOUND.game.save.crestTotal()")
        gst = P.state()
        P.say("  crestTotal %d -> %d ; game state %s" % (crest0, crest1, gst["gstate"]))
        P.shot("12_crest_after")
        if crest1 <= crest0 and gst["gstate"] not in ("clear", "cinematic"):
            D(what="The open crest on the sanctum dais does not collect when you walk and jump onto it",
              where="azure-1 sanctum, the 'open' crest at (0, 16.45, -24); roof deck 14.21, dais top 15.11",
              did="stood on the roof at (0, 14.6, -20), walked to the dais and jumped at the crest",
              happened="crest total stayed %d and the game state stayed '%s'; player ended at %s" % (crest1, gst["gstate"], e2["pos"]),
              should="touching the crest should fire the pedestal celebration and clear the course",
              png="_shots/play_azure1f/12_crest_after.png")
        else:
            W("The sanctum open crest collects and fires the clear (crests %d -> %d, state %s)." % (crest0, crest1, gst["gstate"]))

        flush(rep)
        P.dump("azure1f")


main()
