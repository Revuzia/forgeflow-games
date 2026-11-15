"""PLAYTEST — THE KEEP, run 2: can a player actually REACH the verdant-1 painting,
and can a player actually CLIMB the grand staircase (owner P6)?"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play


def path(P, pts, tol=1.1, tag=""):
    out = []
    for i, (x, z) in enumerate(pts):
        r = P.walk_to(x, z, tol=tol, max_ms=8000, tag="%s leg%d" % (tag, i + 1))
        out.append(r)
        if r["stuck"]:
            P.say("   >> STOPPED on leg %d of %s at %s" % (i + 1, tag, r["end"]))
            break
    return out


with Play("keep") as P:
    P.n = 20
    P.click_title(); P.wait(2500)
    P.say("state:", P.state()["gstate"])

    # ---------------------------------------------------------------- P6 rerun
    P.say("=== 1. STRAIGHT AT THE ONLY OPEN PAINTING (what a new player does) ===")
    P.tp(0, 0.05, -1.0)
    P.face(-20, -6)
    s = P.hold(["W"], 4500, tag="hold W from the spawn straight at verdant-1")
    P.say("   states seen:", [x["pstate"] for x in s])
    P.shot("p6_blocked_by_stair")
    end = P.pos()
    P.say("   ended at", end, " (verdant-1 hangs at x -20, z -6)")

    # ------------------------------------------------------------- the detour
    P.say("=== 2. THE DETOUR: round the south end of the west stair ===")
    P.tp(0, 0.05, -1.0)
    legs = path(P, [(-10, -1.0), (-17.5, -1.0), (-18.1, -6.0)], tag="detour")
    P.shot("p6_detour_at_painting")
    P.say("   now facing the picture and walking in")
    P.face(-20, -6); P.wait(300)
    P.shot("v1_picture_from_the_aisle")
    P.down("W")
    for _ in range(24):
        P.wait(200)
        if P.state()["cardOpen"] or P.state()["gstate"] != "keep":
            break
    P.up("W"); P.wait(1200)
    st = P.state()
    P.say("   ->", st["gstate"], "cardOpen", st["cardOpen"], "course", st["course"], "pos", st["pos"])
    P.shot("v1_course_card")
    card = P.js("""() => { const e = document.querySelector('.cb-card'); return e ? e.innerText.slice(0,400) : null; }""")
    P.say("   CARD TEXT:", repr(card))
    # back out of the card
    P.pg.keyboard.press("Escape"); P.wait(1200)
    P.say("   after ESC:", P.state()["gstate"])
    P.shot("v1_card_cancelled")

    # ------------------------------------------------- P6: THE GRAND STAIRCASE
    P.say("=== 3. THE GRAND STAIRCASE (P6) ===")
    P.say("  keep.js: two flank flights x=-13 and x=+13, footprint x +-2, z -8.34..-4.20,")
    P.say("  climbing NORTH to the landing y 2.70; then ONE 9 m flight up the middle")
    P.say("  from z -8.34 to z -2.82 reaching the gallery at y 6.30.")
    for (sx, name) in [(-13.0, "WEST flight"), (13.0, "EAST flight")]:
        P.say(" -- %s: stand at the foot (%.0f, -3.4) and hold W north --" % (name, sx))
        P.tp(sx, 0.05, -3.4)
        P.wait(400)
        P.face(sx, -20.0)      # north
        P.shot("stair_foot_%s" % name.split()[0].lower())
        s = P.hold(["W"], 5000, sample_ms=250, tag="climb %s" % name)
        ys = [x["pos"][1] for x in s]
        P.say("    y over the climb:", ys)
        P.say("    ended", P.pos(), "state", P.state()["pstate"])
        P.shot("stair_top_%s" % name.split()[0].lower())

    P.say(" -- the MIDDLE flight from the landing to the gallery --")
    P.tp(0.0, 2.75, -8.0)
    P.wait(500)
    P.say("    landed on the landing at", P.pos())
    P.face(0.0, 6.0)           # south, the way the upper flight climbs
    P.shot("stair_landing_facing_upper")
    s = P.hold(["W"], 6000, sample_ms=250, tag="climb the middle flight")
    P.say("    y:", [x["pos"][1] for x in s])
    P.say("    ended", P.pos(), P.state()["pstate"])
    P.shot("stair_gallery_arrival")

    P.say(" -- and the WHOLE THING on foot from the mosaic, no teleports --")
    P.tp(0, 0.05, -1.0); P.wait(400)
    legs = path(P, [(-13.0, -3.6), (-13.0, -8.0), (0.0, -8.0), (0.0, -3.0)], tag="full stair route")
    P.say("    final:", P.pos())
    P.shot("stair_full_route_end")

    P.dump("keep2")
    P.say("CONSOLE:", P.console[:10])
