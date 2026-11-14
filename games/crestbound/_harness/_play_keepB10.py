"""KEEP playtest pass B, run 10 — every gate's real geometry (P9) and the
wall-kick tower shaft, entered properly this time.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB10") as P:
    P.click_title(); P.wait(1500)

    # ---------- every gate: mesh bbox, trigger volume, floor under it ----------
    g = P.js("""() => { const G = CRESTBOUND.game, C = G.course, T = CRESTBOUND.THREE, out = [];
        for (const gate of (G._gates||[])) {
          let bb = null;
          if (gate.mesh) { const b = new T.Box3().setFromObject(gate.mesh);
            bb = [+b.min.x.toFixed(2),+b.min.y.toFixed(2),+b.min.z.toFixed(2),
                  +b.max.x.toFixed(2),+b.max.y.toFixed(2),+b.max.z.toFixed(2)]; }
          let vol = null;
          if (gate.volume) { const v = gate.volume;
            vol = {cy:+v.center.y.toFixed(2), half:+v.half.y.toFixed(2),
                   bot:+(v.center.y-v.half.y).toFixed(2), top:+(v.center.y+v.half.y).toFixed(2)}; }
          // is there floor under the gate?
          const hit = {t:0, normal:new T.Vector3(), collider:null};
          const org = new T.Vector3(gate.pos.x, gate.pos.y, gate.pos.z);
          const fwd = new T.Vector3(-Math.sin(gate.yaw||0), 0, -Math.cos(gate.yaw||0)).multiplyScalar(-1.4);
          const probe = org.clone().add(fwd); probe.y += 6;
          const down = new T.Vector3(0,-1,0);
          const okFloor = C.broadphase.raycast(probe, down, 40, hit);
          out.push({course: gate.course, kind: gate.kind, req: gate.requires && gate.requires.crests,
                    pos:[+gate.pos.x.toFixed(2),+gate.pos.y.toFixed(2),+gate.pos.z.toFixed(2)],
                    meshBB: bb, trigger: vol,
                    floorY: okFloor ? +(probe.y - hit.t).toFixed(2) : null,
                    standAt: [+probe.x.toFixed(2), +probe.z.toFixed(2)]}); }
        return out; }""")
    P.say("EVERY GATE — mesh box, walk-in trigger, and the floor 1.4 m in front of it:")
    for x in g:
        bb = x["meshBB"]
        sill = bb[1] if bb else None
        P.say("  %-10s %-8s req=%-4s pos=%s sill=%s head=%s trigger=%s floorInFront=%s" % (
            x["course"], x["kind"], x["req"], x["pos"], sill, bb[4] if bb else None,
            json.dumps(x["trigger"]), x["floorY"]))
        if sill is not None and x["floorY"] is not None and sill - x["floorY"] > 0.6:
            P.say("     ** the glass/frame starts %.2f m above the floor a player stands on" % (sill - x["floorY"]))

    # ---------- the tower shaft, entered from inside ----------
    P.say("--- the wall-kick tower: shaft interior is x -18.5..-15.5, z 33.2..38.8 ---")
    P.tp(-17.0, 0.3, 37.0); P.wait(700)
    P.say("  in the shaft:", json.dumps(P.state()))
    P.shot("shaft_floor")
    best = P.pos()[1]
    for i in range(8):
        P.face(-17.0, 33.6)          # face the north wall
        P.down("W"); P.wait(240); P.tap("SPACE", 190); P.wait(280)
        P.face(-17.0, 40.0)          # flip to the south wall
        P.tap("SPACE", 190); P.wait(300)
        P.up("W")
        st = P.state()
        best = max(best, st["pos"][1])
        P.say("   kick pair %d -> y=%.2f %s %s" % (i, st["pos"][1], st["pstate"], st["pos"]))
        if i % 2 == 0:
            P.shot("shaft_kick%d" % i)
        P.wait(350)
    P.say("  BEST y in the shaft: %.2f (ledges 3.23 / 6.43 / 9.63, roof 12.43)" % best)
    P.shot("shaft_end")

    # try the east-west axis instead (the shaft is 3.0 m across x, 5.65 m across z)
    P.tp(-17.0, 0.3, 36.0); P.wait(600)
    best2 = P.pos()[1]
    for i in range(8):
        P.face(-15.8, 36.0)
        P.down("W"); P.wait(240); P.tap("SPACE", 190); P.wait(280)
        P.face(-18.2, 36.0)
        P.tap("SPACE", 190); P.wait(300)
        P.up("W")
        st = P.state()
        best2 = max(best2, st["pos"][1])
        P.say("   x-axis kick pair %d -> y=%.2f %s %s" % (i, st["pos"][1], st["pstate"], st["pos"]))
        P.wait(350)
    P.say("  BEST y kicking across the 3.0 m x-axis: %.2f" % best2)
    P.shot("shaft_x_end")
    P.dump("keepB10")
