"""BLIZZARD PEAK gorge, pass 2. (a) what killed me standing still at the gorge
lip, (b) can a player reach the FROZEN FALL secret at all, (c) do the crevasse
chimney wall kicks fire when you actually press into the wall."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

DEATH = r"""() => { const G = CRESTBOUND.game;
  return { deaths: G.deaths, cause: G.player ? G.player.deathCause : null,
           timeline: G.lastDeathTimeline ? JSON.parse(JSON.stringify(G.lastDeathTimeline)).slice(-8) : null }; }"""

CRITTERS = r"""() => { const G = CRESTBOUND.game, C = G._critters; if (!C) return 'no _critters';
  const keys = Object.keys(C);
  let L = C.list || C.items || C._list || C.all || null;
  if (!L) { for (const k of keys) { if (Array.isArray(C[k]) && C[k].length && C[k][0] && C[k][0].pos) { L = C[k]; break; } } }
  if (!L) return {keys};
  return L.map(c => ({ k: c.kind || c.type || c.constructor.name,
    p: c.pos ? [+c.pos.x.toFixed(1), +c.pos.y.toFixed(1), +c.pos.z.toFixed(1)] : null,
    st: c.state || null, alive: c.alive === undefined ? null : c.alive })); }"""


def body(g):
    g.start("rime-3", cp=2)

    g.say("== (a) STAND STILL at the gorge lip (-31.9, 7.2, -15.1) and see what kills me ==")
    g.tp(-31.87, 7.30, -15.14); g.wait(600)
    d0 = g.snap().get("deaths")
    for i in range(16):
        g.wait(500)
        s = g.snap()
        if s.get("deaths", 0) > d0:
            g.say("   *** DIED after %.1f s of standing still. %s" % (i * 0.5, json.dumps(g.js(DEATH))))
            g.shot("death_standing_still")
            break
        if i in (2, 6):
            g.say("   critters now:", json.dumps(g.js(CRITTERS))[:600])
            g.shot("standing_still_%d" % i)
    else:
        g.say("   survived 8 s standing still this time (last run died at ~2.5 s) - INTERMITTENT")

    g.say("== (b) can I reach the FROZEN FALL secret from the gorge floor? ==")
    g.tp(-27.6, -0.6, -19.0); g.wait(700)
    g.show("on the gorge ice shelf")
    for tag, tx, tz in [("north edge", -27.0, -17.6), ("the sheet", -26.7, -16.5)]:
        g.walk(tx, tz, tol=1.0, max_ms=8000, tag=tag)
    g.say("   now try JUMPING at the wall toward the sheet")
    for k in range(4):
        g.face(-26.7, -16.5)
        g.down("W"); g.wait(350); g.tap("SPACE", 110); g.wait(900); g.up("W"); g.wait(600)
        s = g.show("jump-at-wall %d" % k)
    g.shot("frozenfall_blocked")
    g.say("   where is the breakable sheet, and is anything solid between me and it?")
    g.say(json.dumps(g.js(r"""async () => {
      const THREE = await import('three');
      const G = CRESTBOUND.game, e = G.engine; e.scene.updateMatrixWorld(true);
      const from = new THREE.Vector3(G.player.pos.x, G.player.pos.y + 0.9, G.player.pos.z);
      const to = new THREE.Vector3(-26.7, 1.6, -16.5);
      const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
      const rc = new THREE.Raycaster(from, dir, 0.05, len + 0.5);
      const hits = rc.intersectObject(e.scene, true).filter(h => h.object.visible && !/sky|shadowBlob|nim\./i.test(h.object.name||''));
      return { from:[+from.x.toFixed(2),+from.y.toFixed(2),+from.z.toFixed(2)], len:+len.toFixed(2),
        blockers: hits.slice(0,6).map(h => ({n:(h.object.name||h.object.type).slice(0,30), d:+h.distance.toFixed(2),
          p:[+h.point.x.toFixed(1),+h.point.y.toFixed(1),+h.point.z.toFixed(1)]})) };
    }""")))

    g.say("== (c) THE CREVASSE CHIMNEY: press INTO the wall while airborne, then jump ==")
    g.tp(-19.5, 3.8, -15.0); g.wait(800)
    g.show("chimney floor")
    walls = [(-21.2, -15.0), (-17.8, -15.0)]
    g.face(*walls[0])
    g.down("W")
    g.tap("SPACE", 110)                       # jump 1
    g.wait(450)
    best = 0
    for k in range(6):
        wx, wz = walls[k % 2]
        g.face(wx, wz)
        g.wait(220)
        s = g.snap()
        g.tap("SPACE", 100)                   # wall kick attempt
        g.wait(260)
        s2 = g.snap()
        y = (s2.get("p") or [0, 0, 0])[1]
        best = max(best, y)
        g.say("   kick %d: before ps=%s y=%.2f -> after ps=%s y=%.2f" %
              (k, s.get("ps"), (s.get("p") or [0, 0, 0])[1], s2.get("ps"), y))
    g.up("W"); g.wait(1500)
    s = g.show("chimney end")
    g.say("   highest y reached in the chimney: %.2f  (floor 3.60, exit ledge 13.00)" % best)
    g.say("   wall kick counter:", g.js("() => CRESTBOUND.game.player.stats.wallKicks"))
    g.shot("chimney_kicks")


run("gorge2", body)
