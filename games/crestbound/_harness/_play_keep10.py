"""PLAYTEST — THE KEEP, run 10: THE GATE AUDIT. Every one of the 13 gates, plus
the two seals: stand on its own exit stand, look at it, read it, walk in.
Answers P9 (is it on a wall / floating / unreachable / does the sign read?)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

PROMPT = """() => { const e = document.querySelector('.cb-prompt'); if (!e) return null;
    return { cls: e.className, text: (e.innerText||'').replace(/\\n/g,' | ').trim(),
      opacity: getComputedStyle(e).opacity }; }"""

with Play("keep") as P:
    P.n = 300
    P.click_title(); P.wait(3000)

    P.say("=== FLOOR UNDER EVERY GATE'S EXIT STAND (is there ground to stand on?) ===")
    rows = []
    for g in P.gates():
        ex = g["exit"]
        # drop in 2 m above the stand and see where the player settles
        P.tp(ex[0], ex[1] + 2.0, ex[2]); P.wait(1400)
        settled = P.pos()
        fell = settled[1] < ex[1] - 0.6
        P.face(g["pos"][0], g["pos"][2]); P.wait(500)
        pr0 = P.js(PROMPT)
        shot_stand = P.shot("gate_%s_stand" % g["course"])
        # walk straight in
        P.down("W"); P.wait(2400); P.up("W"); P.wait(1400)
        st = P.state()
        pr1 = P.js(PROMPT)
        shot_in = P.shot("gate_%s_walkin" % g["course"])
        row = {"course": g["course"], "kind": g["kind"], "gatePos": g["pos"], "exit": ex,
               "settledAt": settled, "fellOffTheStand": fell,
               "promptStanding": pr0, "promptAfterWalkIn": pr1,
               "cardOpened": st["cardOpen"], "gstate": st["gstate"],
               "endPos": st["pos"], "shots": [os.path.basename(shot_stand), os.path.basename(shot_in)]}
        rows.append(row)
        P.say(" %-10s %-8s wall@%s stand@%s settled@%s%s" % (
            g["course"], g["kind"], g["pos"], ex, settled, "  << FELL OFF" if fell else ""))
        P.say("            standing prompt: %s" % (pr0,))
        P.say("            after walk-in   : card %s state %s prompt %s" % (st["cardOpen"], st["gstate"], pr1))
        if st["cardOpen"] or st["gstate"] != "keep":
            P.pg.keyboard.press("Escape"); P.wait(1600)
            if P.state()["gstate"] != "keep":
                P.js("() => CRESTBOUND.game.returnToKeep && CRESTBOUND.game.returnToKeep()")
                P.wait(3000)

    P.say("=== SUMMARY ===")
    for r in rows:
        P.say(json.dumps(r))

    P.say("=== THE SPIRAL STAIR — treads, or a hole? ===")
    steps = P.js("""() => { const THREE = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase;
        const aabb = new THREE.Box3(new THREE.Vector3(-17.5,-9,3.5), new THREE.Vector3(-9.5,1,11.5));
        const res = []; bp.query(aabb, res);
        return res.map(c => ({ min:[+c.aabb.min.x.toFixed(2),+c.aabb.min.y.toFixed(2),+c.aabb.min.z.toFixed(2)],
            max:[+c.aabb.max.x.toFixed(2),+c.aabb.max.y.toFixed(2),+c.aabb.max.z.toFixed(2)] }))
          .sort((a,b)=>b.max[1]-a.max[1]).slice(0,30); }""")
    P.say("   colliders in the stairwell shaft, top-down (%d):" % len(steps))
    for s in steps:
        P.say("     top y %6.2f   x %6.2f..%6.2f  z %6.2f..%6.2f" % (s["max"][1], s["min"][0], s["max"][0], s["min"][2], s["max"][2]))

    P.dump("keep10")
