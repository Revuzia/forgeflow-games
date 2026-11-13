"""PLAYTEST — THE KEEP, run 5: exhaust the athletic ways onto the landing, then
(having proved the stair is dead) TELEPORT up and PLAY the gallery, the library
nook, Old Fen, the three rime paintings and the balcony long-jump."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 80
    P.click_title(); P.wait(2500)

    P.say("=== 1. EVERY MOVE A PLAYER HAS, AT THE 2.70 m STAIR FACE (x -13, z -4.20) ===")

    def attempt(name, fn, start=(-13.0, 0.05, 0.0)):
        P.tp(*start); P.wait(450)
        P.face(-13, -30)
        fn()
        P.wait(900)
        p = P.pos()
        P.say("   %-28s -> %s  y %.2f  %s" % (name, p, p[1], "ON THE LANDING" if p[1] > 2.4 else "still on the floor"))
        P.shot("try_" + name.replace(" ", "_"))
        return p

    def run_jump():
        P.down("W"); P.wait(1100); P.tap("SPACE", 300); P.wait(900); P.up("W")

    def run_double():
        P.down("W"); P.wait(1100); P.tap("SPACE", 260); P.wait(560)
        P.tap("SPACE", 260); P.wait(900); P.up("W")

    def run_triple():
        P.down("W"); P.wait(1100)
        P.tap("SPACE", 240); P.wait(540)
        P.tap("SPACE", 240); P.wait(560)
        P.tap("SPACE", 240); P.wait(1100); P.up("W")

    def longjump():
        P.down("W"); P.wait(1100); P.down("C"); P.wait(70); P.tap("SPACE", 220)
        P.wait(900); P.up("C"); P.up("W")

    def backflip():
        P.down("C"); P.wait(150); P.tap("SPACE", 240); P.wait(1000); P.up("C")

    def wallkick():
        P.down("W"); P.wait(900); P.tap("SPACE", 240); P.wait(360)
        P.tap("SPACE", 200); P.wait(900); P.up("W")

    attempt("run+single jump", run_jump)
    attempt("run+double jump", run_double)
    attempt("run+triple jump", run_triple)
    attempt("long jump", longjump)
    attempt("backflip at the wall", backflip, start=(-13.0, 0.05, -3.9))
    attempt("wall kick off the face", wallkick)

    P.say("=== 2. THE GALLERY — reached the only way left, a dev teleport, then WALKED ===")
    P.tp(0.0, 6.40, -11.0); P.wait(700)
    P.say("  landed at", P.pos(), P.state()["pstate"])
    P.shot("gallery_arrival")
    P.face(0, -30); P.wait(300)
    P.shot("gallery_looking_north")
    P.face(0, 30); P.wait(300)
    P.shot("gallery_looking_south_over_the_void")

    P.say("  walking the gallery loop")
    for (x, z, tag) in [(-14.0, -11.0, "west leg"), (-14.0, 6.0, "west leg south"),
                        (0.0, 11.0, "south leg"), (14.0, 6.0, "east leg"),
                        (14.0, -11.0, "east leg north"), (0.0, -12.0, "north, toward the long hall")]:
        r = P.walk_to(x, z, tol=1.6, max_ms=9000, tag=tag)
        P.shot("gallery_%s" % tag.replace(" ", "_"))
        P.say("    y", P.pos()[1])

    P.dump("keep5")
