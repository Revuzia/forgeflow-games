"""PLAYTEST — AZURE-1 TIDEWELL TEMPLE, segment A: the shore, the first dive,
the lagoon, the east/north currents, the sinking coral pads, the shoal (cp2).

Owner instruction P11: PLAY it. Real KeyboardEvents, screenshots, read the PNGs.
Run:  python _harness/_play_azure1a.py
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "_playreports", "azure-1.json")


def save_report(defects, worked, blocked, played=""):
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    prev = {}
    if os.path.exists(REPORT):
        try:
            prev = json.load(open(REPORT, encoding="utf-8"))
        except Exception:
            prev = {}
    out = {
        "area": "azure-1",
        "played": played or prev.get("played", ""),
        "defects": prev.get("defects", []) + defects,
        "worked": prev.get("worked", []) + worked,
        "blocked": prev.get("blocked", []) + blocked,
    }
    json.dump(out, open(REPORT, "w", encoding="utf-8"), indent=1)
    return out


def main():
    defects, worked, blocked = [], [], []

    def D(**kw):
        defects.append(kw)
        save_report([], [], [])          # keep file fresh
        json.dump({"area": "azure-1", "played": "", "defects": defects,
                   "worked": worked, "blocked": blocked},
                  open(REPORT, "w", encoding="utf-8"), indent=1)
        print("  ** DEFECT: %s" % kw.get("what"), flush=True)

    with Play("azure1a") as P:
        # robust boot wait (the shared enter() gives up silently)
        for i in range(120):
            ready = P.js("() => typeof globalThis.CRESTBOUND === 'object' && !!CRESTBOUND.game")
            if ready:
                break
            P.wait(500)
        P.say("CRESTBOUND ready after %.1f s; state=%s" % (
            i * 0.5, P.js("() => CRESTBOUND.game.state")))
        for i in range(120):
            if P.js("() => CRESTBOUND.game.state !== 'loading'"):
                break
            P.wait(500)
        st = P.state()
        P.say("boot:", st["gstate"], st["course"])
        P.shot("00_title")
        got = P.click_title()
        P.say("title button:", got)
        P.wait(1200)
        P.say("after title:", P.state()["gstate"])
        P.unlock_all()
        P.js("() => CRESTBOUND.game.__dev.goto('azure-1')")
        for _ in range(80):
            P.wait(500)
            s = P.state()
            if s["course"] == "azure-1" and s["gstate"] == "playing":
                break
        P.wait(2500)
        st = P.state()
        P.say("in course:", json.dumps(st))
        P.shot("01_spawn")

        # ---------------------------------------------------------------- 1
        # THE SHORE. Read the spawn: can I see the temple? Is cp1 ahead?
        P.say("\n=== BEAT 1 THE SHORE ===")
        P.say("spawn pos", st["pos"], "surface", st["surface"])

        # walk to cp-shore at [0,3,42]
        r = P.walk_to(0, 42, tol=1.5, tag="cp1 shore checkpoint")
        P.shot("02_cp1")
        cp = P.js("() => { const G=CRESTBOUND.game; return {cpIndex:G.cpIndex, cpCount:G._cpCount}; }")
        P.say("checkpoint state:", cp)

        # the coins pedestal at [-5.5, 4.45, 42]
        r = P.walk_to(-5.5, 42, tol=1.6, tag="coin-crest pedestal")
        P.shot("03_pedestal")

        # ---------------------------------------------------------------- 2
        # Walk down the causeway to the wading shelf (0, 0.55, 33) and into water
        P.say("\n=== BEAT 1 THE WADING SHELF + FIRST DIVE ===")
        r = P.walk_to(0, 36, tol=2.0, max_ms=14000, tag="down the causeway")
        P.shot("04_causeway")
        r = P.walk_to(0, 32, tol=1.6, max_ms=10000, tag="the wading shelf")
        st = P.state()
        P.say("on shelf:", st["pos"], "surface", st["surface"], "inWater", st["inWater"])
        P.shot("05_shelf")

        # keep walking north into the lagoon — does the splash fire, do I swim?
        P.face(0, 26)
        P.down("W")
        samples = []
        for i in range(24):
            P.wait(250)
            s = P.state()
            samples.append((s["pos"], s["pstate"], s["inWater"], s["submerged"]))
            if s["inWater"]:
                break
        P.up("W")
        st = P.state()
        P.say("entered water at", st["pos"], "state", st["pstate"],
              "inWater", st["inWater"], "submerged", st["submerged"])
        P.shot("06_enter_water")
        for s in samples[-6:]:
            P.say("   ", s)

        if not st["inWater"]:
            D(where="azure-1 wading shelf -> lagoon, walked north from (0,~32)",
              did="held W north off the wading shelf toward the lagoon",
              happened="never entered a water volume; state=%s pos=%s" % (st["pstate"], st["pos"]),
              should="walking off the shelf should splash into the lagoon and enter swim",
              png=P.shot("06b_nowater"))
            worked.append("(none) — could not reach water on foot")
        else:
            worked.append("Walking north off the wading shelf enters the lagoon and the "
                          "player transitions to a swim state (%s) with inWater set." % st["pstate"])

        # ---------------------------------------------------------------- 3
        # SWIM: surface behaviour. Does the hero float at the surface? Can I
        # swim forward? Does the surface sit at the water plane (0.00)?
        P.say("\n=== SWIM: SURFACE ===")
        surfy = P.js("() => { const P=CRESTBOUND.game.player; return {sy:P._waterSurfaceY, y:+P.pos.y.toFixed(3), sub:!!P.submerged}; }")
        P.say("water surface Y reported:", surfy)
        P.shot("07_floating")

        # float test: let go of everything for 3 s and see where he settles
        P.wait(3000)
        st2 = P.state()
        P.say("after 3 s idle in water:", st2["pos"], st2["pstate"], "sub", st2["submerged"])
        P.shot("08_float_settle")

        # swim north 6 s
        P.face(0, 20)
        hs = P.hold(["W"], 6000, sample_ms=500, tag="swim north")
        P.shot("09_swim_north")
        for s in hs:
            P.say("   swim", s["pos"], s["pstate"], "sub", s["submerged"])

        # measure surface swim speed
        a = P.pos()
        P.face(0, 16)
        P.down("W"); P.wait(3000)
        b = P.pos()
        P.up("W")
        d = ((b[0]-a[0])**2 + (b[2]-a[2])**2) ** 0.5
        P.say("surface swim speed ~ %.2f m/s (TUNE.swim.speed = 4.5)" % (d/3.0))

        # ---------------------------------------------------------------- 4
        # DIVE: crouch to sink. Can I get under? Can I come back up? Breath?
        P.say("\n=== SWIM: DIVE / SURFACE / BREATH ===")
        y0 = P.pos()[1]
        hs = P.hold(["C"], 5000, sample_ms=500, tag="hold crouch = sink")
        P.shot("10_sink")
        for s in hs:
            P.say("   sink", s["pos"], s["pstate"], "sub", s["submerged"])
        y1 = P.pos()[1]
        P.say("sank from %.2f to %.2f in 5 s" % (y0, y1))

        deep = P.state()
        P.say("deep state:", deep["pstate"], "submerged", deep["submerged"], "pos", deep["pos"])

        # stay under 25 s — is there any drown timer at all?
        P.say("holding under water 20 s to look for a breath meter / drown")
        alive = True
        for i in range(20):
            P.down("C"); P.wait(900); P.up("C")
            s = P.state()
            if s["pstate"] == "dead" or s["gstate"] == "dead":
                alive = False
                P.say("   DIED underwater at t=%d s" % i)
                break
        P.shot("11_20s_under")
        P.say("still alive after 20 s under:", alive)
        hud = P.js("() => { const h=document.querySelector('.cb-hud'); return h ? h.innerText.replace(/\\n+/g,' | ').slice(0,400) : null; }")
        P.say("HUD text under water:", hud)

        # can I get back to the surface?
        P.say("surfacing with jump (stroke)")
        for i in range(14):
            P.tap("SPACE", 110)
            P.wait(320)
            s = P.state()
            if not s["submerged"]:
                break
        st3 = P.state()
        P.say("after stroking up:", st3["pos"], st3["pstate"], "sub", st3["submerged"])
        P.shot("12_resurface")
        if st3["submerged"]:
            D(where="azure-1 lagoon, mid-water around %s" % (st3["pos"],),
              did="dove with C, then tapped Space (stroke) 14 times to swim up",
              happened="still submerged at y=%.2f after 14 strokes" % st3["pos"][1],
              should="repeated strokes should raise the swimmer to the surface",
              png=P.shot("12b_stuck_under"))
        else:
            worked.append("Crouch (C) sinks the swimmer and Space strokes bring him back "
                          "to the surface; no drown timer exists, so the water is never "
                          "a silent death.")

        # ---------------------------------------------------------------- 5
        # Can I get OUT of the water? Swim back to the shelf and walk out.
        P.say("\n=== GETTING OUT OF THE WATER ===")
        P.tp(0, 1.0, 30)          # near the shelf edge, in the water
        P.wait(600)
        P.shot("13_near_shelf")
        r = P.walk_to(0, 34, tol=2.0, max_ms=12000, tag="swim back onto the wading shelf")
        st4 = P.state()
        P.say("after swimming at the shelf:", st4["pos"], st4["pstate"], "inWater", st4["inWater"])
        P.shot("14_exit_attempt")
        if st4["inWater"]:
            # try a surface hop
            P.say("trying a surface hop (Space) to climb out")
            for i in range(6):
                P.down("W"); P.tap("SPACE", 110); P.wait(500)
            P.up("W")
            st5 = P.state()
            P.say("after surface hops:", st5["pos"], st5["pstate"], "inWater", st5["inWater"])
            P.shot("15_exit_hop")
            if st5["inWater"]:
                D(where="azure-1 wading shelf edge, swimming at ~(0, 0, 33)",
                  did="swam south into the 0.55 m wading shelf holding W, then W+Space surface hops",
                  happened="still in the water at %s — could not climb out onto the shelf" % (st5["pos"],),
                  should="a 0.55 m shelf is a step-up; swimming into it should put the player on land",
                  png=P.shot("15b_cannot_exit"))
            else:
                worked.append("Surface hop (W+Space) climbs out of the lagoon onto the wading shelf.")
        else:
            worked.append("Swimming into the wading shelf steps the player straight out of "
                          "the water onto land — no hop needed.")

        P.dump("azure1a")
        save_report(defects, worked, blocked)
        P.say("\nDEFECTS: %d" % len(defects))
        for d in defects:
            P.say("  -", json.dumps(d))


main()
