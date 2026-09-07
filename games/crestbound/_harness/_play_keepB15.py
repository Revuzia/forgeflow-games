"""KEEP playtest pass B, run 15 — unlock everything and check that each gate
takes you to the course it advertises.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

GATES = [
    ("verdant-2", [-20, 2.5, -1], [-17.0, -1.0]),
    ("ember-2",   [-4.5, -5.5, -11], [-4.5, -9.0]),
    ("rime-2",    [-12, 8.8, -28], [-9.5, -28.0]),
    ("azure-1",   [26, 2.4, 30], [22.5, 30.0]),
]

with Play("keepB15") as P:
    P.click_title(); P.wait(1500)
    before = P.gates()
    P.say("before unlockAll:", json.dumps([(g["course"], g["unlocked"], g["sealed"]) for g in before]))
    try:
        after = P.unlock_all()
        P.say("after unlockAll:", json.dumps([(g["course"], g["unlocked"], g["sealed"]) for g in after]))
    except Exception as e:
        P.say("unlockAll failed:", repr(e)[:200])
        dev = P.js("() => Object.keys(CRESTBOUND.game.__dev || {})")
        P.say("  __dev keys:", json.dumps(dev))
        P.js("() => { for (let i=0;i<60;i++) CRESTBOUND.game.__dev.give('open'); }")
        P.wait(600)
        P.say("  crestTotal now:", P.js("() => CRESTBOUND.game.save.crestTotal()"))
        after = P.gates()
        P.say("gates now:", json.dumps([(g["course"], g["unlocked"], g["sealed"]) for g in after]))

    for course, gp, stand in GATES:
        P.say("--- %s ---" % course)
        P.tp(stand[0], gp[1] - 2.5 + 0.2 if course.startswith("ember") else (gp[1] - 2.5 + 0.2), stand[1])
        P.wait(700)
        st = P.state()
        P.say("  standing at %s (y %.2f)" % (st["pos"], st["pos"][1]))
        r = P.walk_to(gp[0], gp[2], tol=1.2, max_ms=9000, tag=course + " walk in")
        P.wait(900)
        st = P.state()
        P.say("  after walking in: state=%s card=%s" % (st["gstate"], st["cardOpen"]))
        P.shot(course + "_card")
        name = P.js("""() => { const c = document.querySelector('.cb-card.on');
            return c ? c.innerText.replace(/\\s+/g,' ').slice(0,140) : null; }""")
        P.say("  card says:", json.dumps(name))
        if st["cardOpen"] or st["gstate"] == "card":
            P.js("""() => { const b = [...document.querySelectorAll('.cb-card button, .cb-card .cb-btn')]
                  .filter(x => x.offsetParent !== null)
                  .find(x => /ENTER|PLAY|GO/i.test(x.textContent||'')); if (b) b.click(); }""")
            P.wait(5000)
            st = P.state()
            P.say("  ENTER -> state=%s course=%s pos=%s" % (st["gstate"], st["course"], st["pos"]))
            P.shot(course + "_loaded")
            ok = st["course"] == course
            P.say("  %s: %s" % (course, "LOADS THE RIGHT COURSE" if ok else "WRONG COURSE (%s)" % st["course"]))
            # back to the keep
            P.js("() => CRESTBOUND.game.returnToKeep()")
            P.wait(6000)
            P.say("  back in the keep:", json.dumps(P.state()))
        else:
            P.say("  ** no card raised at %s" % course)
    P.dump("keepB15")
