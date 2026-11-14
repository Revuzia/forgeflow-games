"""VERDANT closing checks: the chaff cannon, the lily-pad sink profile,
and a sloppy-human jump chain (jittered rhythm, the way a person actually presses)."""
import sys, os, json, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2
random.seed(7)

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant_final")

    print("\n=== verdant-3 THE CHAFF CANNON — stand IN the trigger and press E ===")
    pl.goto("verdant-3"); pl.wait(1200)
    pl.tp(14.0, 23.4, -40.0, N); pl.wait(900)
    print("   inside the trigger volume:", json.dumps(pl.st()))
    pl.shot("cannon_inside_trigger")
    pl.rec_reset(); pl.tap("e", 140); pl.wait(2500)
    s = pl.st(); r = pl.rec()
    print("   pressed E -> [%.1f %.1f %.1f] %s events %s" % (s["x"], s["y"], s["z"], s["st"], [e["e"] for e in r["events"]][:8]))
    pl.shot("cannon_pressed_E")
    pl.rec_reset(); pl.tap("f", 140); pl.wait(1200)
    print("   pressed F -> %s events %s" % (pl.st()["st"], [e["e"] for e in pl.rec()["events"]][:6]))
    # walk in from the open side
    pl.tp(11.0, 23.8, -42.5, N); pl.wait(400); pl.rec_reset()
    pl.walk("w", 1600); pl.wait(1500)
    s = pl.st(); print("   walked in from the west -> [%.1f %.1f %.1f] %s events %s" %
                      (s["x"], s["y"], s["z"], s["st"], [e["e"] for e in pl.rec()["events"]][:6]))
    pl.shot("cannon_walk_in")

    print("\n=== verdant-1 THE LILY PAD — how fast does it drop? (sample every 80 ms) ===")
    pl.goto("verdant-1"); pl.wait(1500)
    pl.tp(-32.0, 2.1, -8.0, W); pl.wait(300)
    ys = []
    for i in range(40):
        pl.wait(80)
        ys.append(pl.ev("()=>[+CRESTBOUND.game.course.clock.toFixed(2), +CRESTBOUND.game.player.pos.y.toFixed(2), CRESTBOUND.game.player.state]"))
    print("   ", json.dumps(ys))
    pl.shot("lilypad_profile")

    print("\n=== A SLOPPY HUMAN CHAIN: 3 presses with jittered gaps (what a person really does) ===")
    ok = 0
    for trial in range(8):
        pl.tp(0, 2.6, 34, S); pl.wait(300); pl.rec_reset()
        pl.down("w"); pl.wait(1100)
        for i in range(3):
            pl.tap("Space", random.randint(70, 150))
            if i < 2: pl.wait(random.randint(470, 640))
        pl.wait(900); pl.release_all(); pl.wait(300)
        r = pl.rec()
        js = [e.get("d") for e in r["events"] if e["e"] == "jump"]
        got3 = r["maxJump"] >= 3
        ok += 1 if got3 else 0
        print("   trial %d -> jumpCount %d  %s  apex %.2f" % (trial + 1, r["maxJump"], js, r["maxY"] - 2.0))
    print("   reached the triple in %d of 8 sloppy attempts" % ok)

    print("\n=== A SLOPPY HUMAN DOUBLE: 2 presses only ===")
    ok2 = 0
    for trial in range(6):
        pl.tp(0, 2.6, 34, S); pl.wait(300); pl.rec_reset()
        pl.down("w"); pl.wait(1100)
        pl.tap("Space", random.randint(70, 150)); pl.wait(random.randint(450, 700)); pl.tap("Space", random.randint(70, 150))
        pl.wait(900); pl.release_all(); pl.wait(300)
        r = pl.rec()
        got = r["maxJump"] >= 2
        ok2 += 1 if got else 0
        print("   trial %d -> jumpCount %d apex %.2f" % (trial + 1, r["maxJump"], r["maxY"] - 2.0))
    print("   reached the double in %d of 6 sloppy attempts" % ok2)

    print("\nERRORS:", errs[:8])
    br.close()
