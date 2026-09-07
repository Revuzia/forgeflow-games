"""GNASHER FORT phase 7 — the outer rampart walk, the breach carts, the net, the jump pad."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, dismiss_card, st2, critters
from _pgrun import run

def gsnap(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      st:P.state, gr:!!P.grounded,
      deg:+(Math.acos(Math.max(-1,Math.min(1,P.groundNormal.y)))*180/Math.PI).toFixed(1),
      sf:P.surface, d:G.deaths, clk:+G.course.clock.toFixed(1) }; }""")

def hold(pl, keys, secs, step=300, tag=""):
    pl.down(*keys); out=[]
    for i in range(int(secs*1000/step)):
        pl.wait(step); out.append(gsnap(pl))
    pl.up(*keys); pl.wait(300)
    pl.say("  %s -> %s" % (tag, json.dumps([[o["p"],o["st"],o["deg"]] for o in out])))
    return out

def body(pl):
    rec_on(pl)

    # 1 — THE NET (route B): press into it and climb
    pl.say("== 1. THE NET on the south face, foot on the bailey (6.0, 6.86, 25.6) ==")
    pl.tp(6.0, 7.0, 26.2); pl.wait(1200); pl.shot("1_net_before")
    pl.face(6.0, 22.0)
    hold(pl, ("W",), 9, tag="press into the net")
    pl.shot("1_net_after"); pl.say("  ev:", json.dumps(evsum(rec(pl))), json.dumps(gsnap(pl)))

    # 2 — THE JUMP PAD (route C)
    pl.say("== 2. THE JUMP PAD at (-8.0, ~6.6, 24.5) ==")
    pl.tp(-8.0, 7.4, 26.0); pl.wait(1000); pl.shot("2_pad_before")
    pl.face(-8.0, 24.5)
    hold(pl, ("W",), 6, tag="onto the pad")
    pl.wait(1500)
    pl.say("  after pad:", json.dumps(gsnap(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("2_pad_after")

    # 3 — THE OUTER RAMPART WALK: walk the ring, and the SW corner sigil
    pl.say("== 3. THE OUTER RAMPART WALK at 12.00 ==")
    pl.tp(0, 12.3, 21.7); pl.wait(1200); pl.shot("3_walk_south")
    r = walk(pl, -21.7, 21.7, tol=1.8, max_ms=16000, tag="south walk -> SW corner (sigil 3)")
    pl.say("  ", json.dumps(gsnap(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("3_sw_corner")
    r = walk(pl, -21.7, 0.0, tol=2.0, max_ms=16000, tag="SW corner -> west walk")
    pl.say("  ", json.dumps(gsnap(pl)))
    pl.shot("3_west_walk")
    r = walk(pl, -21.7, -14.0, tol=2.0, max_ms=16000, tag="west walk -> NW")
    pl.say("  ", json.dumps(gsnap(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("3_nw_walk")

    # 4 — THE BREACH: the hole and the three carts
    pl.say("== 4. THE BREACH at z -22.5, |x| < 7 ==")
    pl.tp(-9.5, 12.3, -22.4); pl.wait(1400); pl.shot("4_breach_west_lip")
    mv = pl.js("""() => { const C=CRESTBOUND.game.course, H=C.hazards||[];
        const out=[]; for (const h of H) { const k=h.kind||h.type;
          if (k==='mover'||k==='vanish'||k==='rotor'||k==='mill'||k==='breakable'||k==='sinker') {
            const p=h.pos||h.p||(h.group&&h.group.position)||(h.mesh&&h.mesh.position);
            out.push({k:k, p:p?[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)]:null,
                      on:h.on===undefined?null:!!h.on, broken:h.broken===undefined?null:!!h.broken}); } }
        return out; }""")
    pl.say("  movers/hazards live:", json.dumps(mv))
    # watch a cart arrive
    for i in range(10):
        pl.wait(900)
        c = pl.js("""() => { const H=CRESTBOUND.game.course.hazards||[]; const o=[];
            for (const h of H) if ((h.kind||h.type)==='mover') { const p=h.pos||(h.group&&h.group.position);
              if (p && p.z < -15 && p.z > -30) o.push([+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)]); }
            return o; }""")
        pl.say("   carts:", json.dumps(c), json.dumps(gsnap(pl)))
    pl.shot("4_carts")
    # try to board: walk east onto the cart lane
    pl.say("  -- try to board a cart from the west lip --")
    r = walk(pl, 0.0, -22.4, tol=2.0, max_ms=14000, tag="ride east", die_ok=True)
    pl.say("  ", json.dumps(gsnap(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("4_boarded")

    # 5 — sigil 4 at the west lip of the breach (-7.4, 13.40, -22.5)
    pl.say("== 5. SIGIL 4 at (-7.4, 13.40, -22.5) ==")
    pl.tp(-8.6, 12.3, -22.5); pl.wait(1000)
    pl.face(-7.4, -22.5)
    pl.down("W"); pl.wait(400); pl.tap("SPACE", 200); pl.wait(1200); pl.up("W"); pl.wait(600)
    pl.say("  ", json.dumps(gsnap(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("5_sigil4")

run("p7", body)
