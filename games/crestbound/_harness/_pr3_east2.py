"""BLIZZARD PEAK east shoulder, pass 2: the 6 deaths on loading cp-bridge, the
buried ice slabs, the REAL approach to the ice-shelf stair, the mill gondola,
the gnasher's reach over the terrace coin ring, and the crusher cave interior."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

GND = r"""([pts]) => { const G=CRESTBOUND.game, P=G.player; const out=[];
  const keep=[P.pos.x,P.pos.y,P.pos.z];
  for (const [x,z] of pts) {
    P.__test.teleport({x:x, y:60, z:z});
    out.push([x,z]);
  }
  P.__test.teleport({x:keep[0],y:keep[1],z:keep[2]});
  return out; }"""

MILL = r"""() => { const e=CRESTBOUND.game.engine, out=[]; e.scene.updateMatrixWorld(true);
  e.scene.traverse(o=>{ const n=(o.name||''); if(!/mill|gondola|deck|sail|arm/i.test(n)) return;
    const m=o.matrixWorld.elements;
    out.push({n:n.slice(0,30), t:o.type, p:[+m[12].toFixed(2),+m[13].toFixed(2),+m[14].toFixed(2)]}); });
  return out.slice(0,40); }"""


def body(g):
    g.say("== (1) does loading cp-bridge really rack up deaths before any input? ==")
    g.start("rime-3", cp=3)
    s = g.show("cp-bridge at load")
    g.say("   deaths at load = %s (fresh browser, no input given)" % s.get("deaths"))
    g.shot("cpbridge_load")
    g.say("   watch it for 6 s with hands off")
    for i in range(4):
        g.wait(1500); g.show("idle %d" % i)

    g.say("== (2) are the BEAT 4 ice slabs buried in the snow? ==")
    for (x, z, top, label) in [(-8.0, -36.0, 8.40, "west slab top 8.40"),
                               (8.0, -34.0, 9.10, "east slab top 9.10")]:
        g.tp(x, top + 6.0, z); g.wait(1500)
        s = g.snap()
        y = (s.get("p") or [0, 0, 0])[1]
        g.say("   %s: dropped onto y=%.2f surface=%s (slab top %.2f) -> %s"
              % (label, y, s.get("surf"), top, "BURIED" if y > top + 0.2 else "standing on the slab"))
    g.shot("ice_slabs")

    g.say("== (3) the REAL approach to the ice-shelf stair, walking the trodden path ==")
    g.tp(18.0, 12.0, -28.0); g.wait(1200)
    g.show("north flank, path end (18,-28)")
    g.walk(20.0, -24.0, tol=1.6, max_ms=12000, tag="path to (20,-24)")
    g.walk(25.0, -16.0, tol=1.8, max_ms=16000, tag="path to (25,-16)")
    g.walk(26.0, -12.0, tol=1.6, max_ms=14000, tag="path to (26,-12) = foot of the stair")
    s = g.show("foot of the ice-shelf stair"); g.shot("stair_foot")
    g.say("   now hop the four shelves 15.20 / 16.80 / 18.40 / 19.60")
    for (tx, tz, name) in [(26.2, -12.0, "IS1"), (26.4, -8.4, "IS2"), (26.2, -3.6, "IS3"), (25.0, -1.6, "IS4/terrace")]:
        g.face(tx, tz)
        g.down("W"); g.wait(380); g.tap("SPACE", 110); g.wait(1200); g.up("W"); g.wait(700)
        g.show("hop -> " + name)
    g.shot("stair_top")

    g.say("== (4) the east mill's gondola: where is it, can I ride it? ==")
    g.say(json.dumps(g.js(MILL))[:1400])

    g.say("== (5) the gnasher vs the terrace coin ring (ring centre 19,2 r 4.2; post 21,-2 chain 5.5) ==")
    g.tp(16.5, 19.9, 6.5); g.wait(900)
    d0 = g.snap().get("deaths")
    g.say("   walk the coin ring: 8 coins on a 4.2 m circle around (19,2)")
    for ang in (0, 90, 180, 270):
        rx = 19.0 + 4.2 * math.cos(math.radians(ang))
        rz = 2.0 + 4.2 * math.sin(math.radians(ang))
        r = g.walk(rx, rz, tol=1.2, max_ms=9000, tag="ring %d deg (%.1f m from the post)"
                   % (ang, math.hypot(rx - 21.0, rz + 2.0)))
        if r.get("died"):
            g.say("   *** GNASHED on the coin ring at %d deg" % ang)
            g.shot("gnashed_ring_%d" % ang)
            break
    g.say("   deaths %s -> %s, coins %s" % (d0, g.snap().get("deaths"), g.snap().get("coins")))
    g.shot("terrace_ring")

    g.say("== (6) inside the crusher cave: enter from the EAST mouth, past the gnasher ==")
    g.tp(24.8, 19.9, -2.0); g.wait(1000)
    g.show("east cave mouth"); g.shot("cave_east_mouth")
    d0 = g.snap().get("deaths")
    for tgt in [(22.0, -2.0), (19.5, -2.0), (17.0, -2.0), (15.2, -2.0)]:
        r = g.walk(tgt[0], tgt[1], tol=1.2, max_ms=10000, tag="cave -> %s" % (tgt,))
        s = g.show("cave step")
        if r.get("died"):
            g.say("   *** died in the cave at %s" % (r.get("end"),))
            g.shot("cave_death")
            break
    g.shot("cave_inside")
    g.say("   deaths %s -> %s" % (d0, g.snap().get("deaths")))


run("east2", body)
