"""KEEP playtest pass B, run 3 — the lobby in detail.

* can a player reach the landing/gallery by ANY move from the lobby floor?
* the sealed verdant-2 / verdant-3 paintings: do they explain themselves?
* the secret grate: does a ground pound open it?
* the stray props the owner complained about (P6 'extra objects').
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB") as P:
    P.click_title(); P.wait(1200)

    # ---------- 1. can a player get up the stair wall at all? ----------
    P.say("--- trying to reach the 2.70 m landing from the lobby floor ---")
    P.tp(-13.0, 0.2, -3.4); P.wait(400)
    P.js("() => { const G = CRESTBOUND.game; G.cam.yaw = 0; G.player.__test.setFacing(0); }")
    # run-up + single jump into the face
    P.down("W"); P.wait(500); P.tap("SPACE", 220); P.wait(900); P.up("W"); P.wait(600)
    st = P.state(); P.say("run+jump into the stair face ->", st["pos"], st["pstate"])
    P.shot("stairwall_runjump")
    # triple jump chain against the face
    P.tp(-13.0, 0.2, -1.5); P.wait(300)
    P.down("W")
    for i in range(3):
        P.tap("SPACE", 200); P.wait(430)
    P.up("W"); P.wait(1200)
    st = P.state(); P.say("triple-jump chain at the face ->", st["pos"], st["pstate"])
    P.shot("stairwall_triple")
    # wall kick off the face
    P.tp(-13.0, 0.2, -2.6); P.wait(300)
    P.down("W"); P.wait(400); P.tap("SPACE", 200); P.wait(330); P.tap("SPACE", 200)
    P.wait(900); P.up("W"); P.wait(900)
    st = P.state(); P.say("wall kick off the stair face ->", st["pos"], st["pstate"])
    P.shot("stairwall_wallkick")
    best = st["pos"][1]
    P.say("highest y reached against the stair face: %.2f (landing top is 2.70)" % best)

    # ---------- 2. sealed paintings ----------
    for course, gp in [("verdant-2", [-20, 2.5, -1]), ("verdant-3", [-20, 2.5, 4])]:
        P.say("--- sealed gate %s ---" % course)
        P.tp(gp[0] + 3.0, 0.2, gp[2]); P.wait(400)
        r = P.walk_to(gp[0], gp[2], tol=1.5, max_ms=6000, tag=course)
        P.wait(700)
        st = P.state()
        toast = P.js("""() => [...document.querySelectorAll('.cb-toast, .cb-toast *, .cb-prompt, .cb-prompt *')]
            .filter(e => e.offsetParent !== null && e.children.length === 0)
            .map(e => (e.textContent||'').trim()).filter(Boolean)""")
        P.say("  %s: state=%s card=%s toast=%s" % (course, st["gstate"], st["cardOpen"], json.dumps(toast)))
        P.shot("sealed_" + course)
        # what does the sign next to it say?
        sign = P.js("""(c) => { const objs = CRESTBOUND.game.course.def.objects || [];
            return objs.filter(o => o.kind === 'text' && o.p && Math.abs(o.p[0] - (-20)) < 6)
                       .map(o => ({txt:o.text, p:o.p, size:o.size||null})); }""", course)
        P.say("  text objects near the west aisle:", json.dumps(sign)[:600])

    # ---------- 3. the secret grate ----------
    P.say("--- the secret grate at [-13.5, 0, 1] (ground pound it) ---")
    P.tp(-13.5, 0.2, 4.0); P.wait(400)
    P.walk_to(-13.5, 1.0, tol=0.9, max_ms=5000, tag="grate")
    P.shot("grate_standing_on_it")
    P.say("  standing on the grate:", json.dumps(P.state()))
    # jump, then pound
    P.tap("SPACE", 260); P.wait(340); P.down("C"); P.wait(1400); P.up("C"); P.wait(1200)
    st = P.state()
    P.say("  after jump+pound on the grate ->", st["pos"], st["pstate"], "surface", st["surface"])
    P.shot("grate_after_pound")
    P.wait(1500)
    st = P.state()
    P.say("  1.5 s later ->", st["pos"], st["pstate"])
    P.shot("grate_after_pound2")

    # ---------- 4. stray props: list everything standing in the open lobby ----------
    strays = P.js("""() => { const objs = CRESTBOUND.game.course.def.objects || [];
        return objs.filter(o => o.p && o.p[1] > -1 && o.p[1] < 4 && Math.abs(o.p[0]) < 19 &&
                                o.p[2] > -9 && o.p[2] < 12 &&
                                !['light','text','terrain','water'].includes(o.kind))
            .map(o => ({kind:o.kind, of:o.of||o.style||o.mat||null, p:o.p, s:o.s||null}))
            .slice(0, 70); }""")
    P.say("props standing in the open lobby (%d):" % len(strays))
    for s in strays:
        P.say("   ", json.dumps(s))

    P.dump("keepB3")
