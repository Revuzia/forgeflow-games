"""PLAYTEST — THE KEEP, run 9: down to the UNDERCROFT — the spiral stair, the
secret grate you ground-pound, the four ember paintings and the iron door."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

PROMPT = """() => { const e = document.querySelector('.cb-prompt'); if (!e) return null;
    return { cls: e.className, text: (e.innerText||'').replace(/\\n/g,' | ').trim(),
      opacity: getComputedStyle(e).opacity }; }"""

with Play("keep") as P:
    P.n = 200
    P.click_title(); P.wait(3000)

    P.say("=== 1. FIND THE WAY DOWN ON FOOT FROM THE SPAWN ===")
    P.tp(0, 0.05, -1.0); P.wait(500)
    r = P.walk_to(-13.5, 4.0, tol=1.5, max_ms=10000, tag="toward the spiral stairwell")
    P.shot("spiral_approach")
    P.say("  the stairwell mouth is at (-13.5, 7.5), r 0.90 .. 3.60")
    P.face(-13.5, 7.5)
    s = P.hold(["W"], 4500, sample_ms=250, tag="walk into the stairwell")
    P.say("   y trace:", [round(x["pos"][1], 2) for x in s])
    P.say("   ended", P.pos(), P.state()["pstate"])
    P.shot("spiral_descending")
    P.say("   -- keep going down --")
    for i in range(4):
        P.face(-13.5 + 3.0 * (1 if i % 2 else -1), 7.5 + (3.0 if i % 2 else -3.0))
        P.hold(["W"], 2500, sample_ms=300)
        P.say("     y", P.pos()[1], P.pos())
        P.shot("spiral_step%d" % i)
        if P.pos()[1] < -7.0:
            break
    P.say("   reached", P.pos())

    P.say("=== 2. THE UNDERCROFT ===")
    if P.pos()[1] > -7.0:
        P.say("   !! did not get down the spiral on foot; teleporting to the undercroft checkpoint")
        P.tp(-14.0, -7.95, 3.2); P.wait(700)
    P.say("   standing at", P.pos())
    P.shot("undercroft_arrival")
    for (x, z, tag) in [(-14.0, -8.0, "NW corner"), (0.0, -9.0, "north wall, the ember paintings"),
                        (14.0, -8.0, "NE corner"), (14.0, 9.0, "SE corner"),
                        (-14.0, 9.0, "SW corner")]:
        P.walk_to(x, z, tol=1.8, max_ms=10000, tag=tag)
        P.shot("under_" + tag.split(",")[0].replace(" ", "_"))
        P.say("     y", P.pos()[1])

    P.say("=== 3. THE FOUR EMBER PAINTINGS (5 / 8 / 12 / 15 crests — all sealed) ===")
    for g in [x for x in P.gates() if x["course"].startswith("ember")]:
        P.walk_to(g["exit"][0], g["exit"][2], tol=1.1, max_ms=10000, tag="to " + g["course"])
        P.face(g["pos"][0], g["pos"][2]); P.wait(400)
        P.shot("ember_%s_stand" % g["course"])
        P.down("W"); P.wait(2000); P.up("W"); P.wait(900)
        P.say("   %s: pos %s  prompt %s" % (g["course"], P.pos(), P.js(PROMPT)))
        P.shot("ember_%s_push" % g["course"])

    P.say("=== 4. THE IRON DOOR (10 crests) AND THE WYRM STAIR ===")
    d = P.js("""() => { const o = (CRESTBOUND.game.course.def.objects||[])
        .filter(o => o.kind === 'gatedoor' && !o.course);
        return o.map(x => ({id:x.id, label:x.label, p:x.p, yaw:x.yaw, req:x.requires, plate:x.plate})); }""")
    for x in d:
        P.say("   seal:", x)
    if d:
        P.walk_to(d[0]["p"][0], d[0]["p"][2] + 2.0, tol=1.5, max_ms=10000, tag="to the iron door")
        P.face(d[0]["p"][0], d[0]["p"][2]); P.wait(400)
        P.shot("irondoor_stand")
        P.down("W"); P.wait(2200); P.up("W"); P.wait(800)
        P.say("   pushed into the iron door:", P.pos(), P.js(PROMPT))
        P.shot("irondoor_push")

    P.say("=== 5. THE SECRET GRATE (-13.5, 1.0) — ground-pound it from the lobby ===")
    P.tp(-13.5, 0.05, 1.0); P.wait(700)
    P.say("   standing on the grate at", P.pos())
    P.shot("grate_standing_on_it")
    P.tap("SPACE", 260); P.wait(320)
    P.down("C"); P.wait(1600); P.up("C"); P.wait(1200)
    P.say("   after jump + ground pound:", P.pos(), P.state()["pstate"])
    P.shot("grate_after_pound")
    if P.pos()[1] > -3.0:
        P.say("   -- second try, a taller drop --")
        P.tp(-13.5, 3.0, 1.0); P.wait(500)
        P.down("C"); P.wait(2200); P.up("C"); P.wait(1200)
        P.say("   after a pound from 3 m:", P.pos(), P.state()["pstate"])
        P.shot("grate_after_pound2")

    P.dump("keep9")
