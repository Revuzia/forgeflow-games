"""PLAYTEST — THE KEEP, run 14: the wall-kick tower done properly, the balcony
long jump, the keep coins, E-to-enter a painting, and the CAMERA INDOORS (P10)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 700
    P.click_title(); P.wait(3000)

    P.say("=== 1. E TO ENTER AN UNLOCKED PAINTING (the prompt offers 'E') ===")
    g = [x for x in P.gates() if x["course"] == "verdant-1"][0]
    P.tp(g["exit"][0], g["exit"][1] + 0.3, g["exit"][2]); P.wait(1000)
    P.face(g["pos"][0], g["pos"][2]); P.wait(400)
    P.say("   prompt:", P.js("() => { const e=document.querySelector('.cb-prompt'); return e? e.innerText.replace(/\\n/g,' | '):null; }"))
    P.tap("E", 150); P.wait(1800)
    st = P.state()
    P.say("   after pressing E:", st["gstate"], "card", st["cardOpen"])
    P.shot("E_on_painting")
    if st["cardOpen"]:
        P.pg.keyboard.press("Escape"); P.wait(1500)

    P.say("=== 2. THE WALL-KICK TOWER, carefully (shaft 3.00 m wide, ledges 3.40/6.60/9.80, roof 12.60) ===")
    P.tp(-17.0, 0.4, 35.0); P.wait(1400)
    P.say("   in the shaft at", P.pos(), "surface", P.state()["surface"])
    P.shot("tower_in_the_shaft")
    # run at the north wall, jump, then kick alternately
    for trial in range(3):
        P.tp(-17.0, 0.4, 35.6); P.wait(900)
        P.face(-17.0, 30.0)             # face north wall (z 33.2)
        P.down("W"); P.wait(420)
        P.tap("SPACE", 200); P.wait(300)   # jump toward the wall
        best = 0
        for k in range(5):
            P.face(-17.0, 40.0 if k % 2 == 0 else 30.0)   # flip to face the other wall
            P.tap("SPACE", 170)
            P.wait(300)
            st = P.state()
            best = max(best, st["pos"][1])
            if k == 0:
                P.say("     trial %d kick states: %s y %.2f" % (trial + 1, st["pstate"], st["pos"][1]))
        P.up("W"); P.wait(900)
        P.say("   trial %d: highest y %.2f, ended %s %s" % (trial + 1, best, P.pos(), P.state()["pstate"]))
        P.shot("tower_kick_trial%d" % (trial + 1))

    P.say("=== 3. THE BALCONY -> GARDEN LOFT LONG JUMP (6.0 m, the Keep's one authored jump) ===")
    bl = P.js("""() => { const objs = CRESTBOUND.game.course.def.objects||[];
      return objs.filter(o => o.kind==='platform' && o.p && Math.abs(o.p[1]-6.0)<1.2 && o.p[2] > 12 && o.p[2] < 30)
        .map(o=>({p:o.p, s:o.s, mat:o.mat, stripe:!!o.stripe})); }""")
    for b in bl:
        P.say("   deck:", b)
    P.tp(0.0, 6.60, 14.0); P.wait(1200)
    P.say("   on the balcony at", P.pos(), P.state()["pstate"])
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.05; }")
    P.face(0, 40); P.wait(400)
    P.shot("balcony_looking_at_the_loft")
    P.say("   -- run and long jump (crouch+jump at speed) --")
    P.down("W"); P.wait(1000)
    P.down("C"); P.wait(70); P.tap("SPACE", 240); P.wait(70); P.up("C")
    P.wait(1500); P.up("W"); P.wait(1200)
    st = P.state()
    P.say("   landed:", st["pos"], st["pstate"], "grounded", st["grounded"])
    P.shot("balcony_after_longjump")

    P.say("=== 4. THE KEEP COINS ===")
    P.say("   keepCoins in the def:", P.js("() => (CRESTBOUND.game.course.def.keepCoins||[]).length"))
    P.say("   coin counter now:", P.js("() => { const e=document.querySelector('.cb-roll-g'); return e?e.innerText:null; }"))

    P.say("=== 5. P10 — THE CAMERA INDOORS ===")
    stations = [("library nook", 16.0, 6.40, -21.0), ("the arcade under the landing", 0.0, 0.05, -11.5),
                ("undercroft, the north wall", 0.0, -7.95, -9.5), ("the west aisle", -18.0, 0.05, -1.0),
                ("the long hall", 0.0, 6.40, -30.0), ("the stairwell shaft", -13.5, -4.0, 7.5)]
    for (name, x, y, z) in stations:
        P.tp(x, y, z); P.wait(1200)
        worst = None
        for yaw in range(0, 360, 45):
            P.js("(d) => { CRESTBOUND.game.cam.yaw = d * Math.PI / 180; }", yaw)
            P.wait(320)
            st = P.state()
            occl = P.js("""() => { const G = CRESTBOUND.game, c = G.cam;
                const hero = G.player.renderPos ? G.player.renderPos : G.player.pos;
                const CA = CRESTBOUND.engine.camera;
                const d = CA.position.distanceTo(hero);
                return { dist: +c.dist.toFixed(2), toHero: +d.toFixed(2), near: +CA.near.toFixed(2),
                         inside: d < CA.near + 0.15 }; }""")
            if worst is None or occl["dist"] < worst["dist"]:
                worst = dict(occl, yaw=yaw)
        P.say("   %-30s worst camera: %s  (minDist should be >= 1.60)" % (name, worst))
        P.js("(d) => { CRESTBOUND.game.cam.yaw = d * Math.PI / 180; }", worst["yaw"])
        P.wait(500)
        P.shot("cam_" + name.replace(" ", "_").replace(",", ""))

    P.dump("keep14")
