"""PLAYTEST — THE KEEP, run 12: the FOUNTAIN, properly (P8) — can you swim, can
you get out, where does the surface sit vs the rim — and the DUPLICATE-OBJECT
audit (P6 'extra objects')."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 500
    P.click_title(); P.wait(3000)

    P.say("=== 1. DUPLICATE OBJECTS (P6 'extra objects') ===")
    P.say("  def.objects that are ALSO a top-level field:", P.js("""() => {
        const d = CRESTBOUND.game.course.def, objs = d.objects||[], hits = [];
        if (d.terrain && objs.indexOf(d.terrain) >= 0) hits.push('terrain is in def.terrain AND def.objects');
        for (const w of (d.waters||[])) if (objs.indexOf(w) >= 0) hits.push('a water is in def.waters AND def.objects');
        return hits; }"""))
    P.say("  live water volumes:", P.js("""() => (CRESTBOUND.game.course.volumes||[])
        .filter(v=>v.kind==='water').length"""))
    P.say("  live terrain heightfields:", P.js("() => (CRESTBOUND.game.course.broadphase.heightfields||[]).length"))
    P.say("  meshes whose world position is shared by another mesh of the same tri count:",
          P.js("""() => { const seen = new Map(), dupes = [];
            CRESTBOUND.game.course.group.traverse(o => { if (!o.isMesh || !o.geometry) return;
              const w = new CRESTBOUND.THREE.Vector3(); o.getWorldPosition(w);
              const n = o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position||{count:0}).count;
              const k = [o.name||o.type, w.x.toFixed(2), w.y.toFixed(2), w.z.toFixed(2), n].join('|');
              if (seen.has(k)) dupes.push(k); else seen.set(k, 1); });
            return dupes.slice(0, 24); }"""))
    P.say("  Old Fen meshes:", P.js("""() => { let n = 0; CRESTBOUND.game.course.group.traverse(o => {
        if (o.name === 'fen_body') n++; }); return n; }"""))

    P.say("=== 2. THE FOUNTAIN — geometry a player can see ===")
    P.say("   lawn y just outside the rim:", P.js("""() => { const h = CRESTBOUND.game.course.broadphase.heightfields[0];
        return h ? [+h.heightAt(0, 23).toFixed(2), +h.heightAt(0, 24.5).toFixed(2), +h.heightAt(6, 30).toFixed(2)] : null; }"""))
    P.say("   rim top 1.10   water surface 0.95   pool floor -1.30")

    P.tp(0.0, 1.4, 24.3); P.wait(900)
    P.say("   standing ON the rim at", P.pos(), "surface", P.state()["surface"])
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = -0.28; c.dist = 5.0; }")
    P.wait(500)
    P.face(0, 40)
    P.shot("fountain_rim_looking_in")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.05; c.dist = 9.0; }")
    P.tp(0.0, 0.4, 21.0); P.wait(800)
    P.face(0, 40); P.wait(400)
    P.shot("fountain_from_outside_side_on")

    P.say("=== 3. SWIM. drop in and drive each direction for 2 s, sampling every 200 ms ===")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.15; c.dist = 6.8; }")
    P.tp(0.0, 2.5, 30.0); P.wait(1600)
    st = P.state()
    P.say("   dropped in:", st["pos"], "inWater", st["inWater"], "submerged", st["submerged"], "state", st["pstate"])
    P.shot("swim_dropped_in")
    for (tx, tz, name) in [(0, 40, "south"), (0, 20, "north"), (10, 30, "east"), (-10, 30, "west")]:
        P.face(tx, tz); P.wait(300)
        p0 = P.pos()
        s = P.hold(["W"], 2000, sample_ms=200)
        p1 = P.pos()
        d = ((p1[0] - p0[0]) ** 2 + (p1[2] - p0[2]) ** 2) ** 0.5
        P.say("   swim %-6s 2.0 s: %s -> %s   moved %.2f m   states %s"
              % (name, p0, p1, d, sorted(set(x["pstate"] for x in s))))
        P.shot("swim_%s" % name)

    P.say("=== 4. CAN YOU GET OUT? (the design says a surface hop clears the 1.10 rim) ===")
    P.tp(0.0, 1.0, 33.0); P.wait(1400)
    P.face(0, 45)
    P.say("   at the south lip, y", P.pos()[1], "inWater", P.state()["inWater"])
    for i in range(8):
        P.down("W")
        P.tap("SPACE", 220)
        P.wait(700)
        st = P.state()
        P.say("     hop %d -> %s inWater %s state %s" % (i + 1, st["pos"], st["inWater"], st["pstate"]))
        if not st["inWater"] and st["pos"][1] > 0.9:
            break
    P.up("W"); P.wait(900)
    st = P.state()
    P.say("   OUT?" , "YES" if not st["inWater"] else "NO — still in the water", st["pos"])
    P.shot("swim_exit_attempt")

    P.say("   -- and with crouch(sink)+jump, and with a run at the wall --")
    P.tp(0.0, 0.5, 33.4); P.wait(1200)
    P.face(0, 45)
    P.down("W"); P.wait(2500)
    for _ in range(5):
        P.tap("SPACE", 200); P.wait(420)
    P.up("W"); P.wait(1200)
    st = P.state()
    P.say("   after a swim-and-hammer-jump at the south wall:", st["pos"], "inWater", st["inWater"])
    P.shot("swim_exit_attempt2")

    P.dump("keep12")
