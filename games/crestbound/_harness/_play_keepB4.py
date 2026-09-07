"""KEEP playtest pass B, run 4 — THE UNDERCROFT.

Down the grate (pound), does Nim ever LAND? Then the four ember paintings, the
spiral stair back up to the lobby, the iron door, the wyrm stair.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB") as P:
    P.click_title(); P.wait(1200)

    # ---------- pound through the grate and try to LAND ----------
    P.tp(-13.5, 0.2, 2.6); P.wait(400)
    P.walk_to(-13.5, 1.0, tol=0.9, max_ms=5000, tag="grate")
    P.tap("SPACE", 260); P.wait(340); P.down("C"); P.wait(1500); P.up("C")
    for i in range(6):
        P.wait(700)
        st = P.state()
        P.say("  t+%.1fs pos=%s vel=%s state=%s grounded=%s" % (
            0.7 * (i + 1), st["pos"], st["vel"], st["pstate"], st["grounded"]))
    P.shot("undercroft_after_pound")
    st = P.state()
    if not st["grounded"]:
        P.say("  ** still not grounded — try to walk and jump from here")
        P.hold(["W"], 1200, tag="walk while 'fall'")
        P.say("  after W:", json.dumps(P.state()))
        P.tap("SPACE", 200); P.wait(900)
        P.say("  after SPACE:", json.dumps(P.state()))
        P.shot("undercroft_stuck_fall")

    # ---------- walk the undercroft floor ----------
    P.say("--- walking the undercroft floor to the four EMBER paintings ---")
    P.tp(-13.5, -7.8, 3.2); P.wait(600)
    P.say("  on the undercroft checkpoint:", json.dumps(P.state()))
    P.shot("undercroft_cp")
    for course, gp in [("ember-1", [-12, -5.5, -11]), ("ember-2", [-4.5, -5.5, -11]),
                       ("ember-3", [4.5, -5.5, -11]), ("ember-4", [12, -5.5, -11])]:
        r = P.walk_to(gp[0], gp[2] + 2.0, tol=1.4, max_ms=12000, tag=course + " approach")
        P.face(gp[0], gp[2])
        P.wait(500)
        P.shot("undercroft_" + course)
        r2 = P.walk_to(gp[0], gp[2], tol=1.0, max_ms=4000, tag=course + " walk in")
        P.wait(700)
        st = P.state()
        toast = P.js("""() => [...document.querySelectorAll('.cb-toast, .cb-toast *, .cb-prompt, .cb-prompt *')]
            .filter(e => e.offsetParent !== null && e.children.length === 0)
            .map(e => (e.textContent||'').trim()).filter(Boolean)""")
        P.say("  %s at %s: y=%.2f state=%s toast=%s" % (course, st["pos"], st["pos"][1], st["gstate"], json.dumps(toast)))
        P.shot("undercroft_" + course + "_walkin")

    # ---------- the spiral stair back up ----------
    P.say("--- the spiral stair from the undercroft back to the lobby ---")
    P.tp(-13.5, -7.8, 6.0); P.wait(500)
    P.shot("spiral_foot")
    y0 = P.pos()[1]
    for step in range(10):
        st = P.state()
        # walk toward the well centre, orbiting: just hold W with the camera re-aimed up the well
        P.face(-11.5, 6.6)
        P.hold(["W"], 900, sample_ms=450)
        st = P.state()
        P.say("  spiral step %d -> %s %s" % (step, st["pos"], st["pstate"]))
        if st["pos"][1] > -0.4:
            break
    P.shot("spiral_after")
    P.say("  spiral stair: y %.2f -> %.2f (lobby floor is 0.00)" % (y0, P.pos()[1]))

    # ---------- the iron door ----------
    doors = P.js("""() => (CRESTBOUND.game.course.def.objects||[])
        .filter(o => o.kind === 'gatedoor')
        .map(o => ({p:o.p, yaw:o.yaw!=null?o.yaw:(o.rot?o.rot[1]:null), w:o.w, h:o.h, req:o.requires, course:o.course}))""")
    P.say("gatedoors in the keep:", json.dumps(doors))
    P.dump("keepB4")
