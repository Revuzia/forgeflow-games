"""BLIZZARD PEAK - BEAT 4/5/6: north flank, ice-shelf stair, the mill lift,
the terrace, the gnasher, the crusher cave and the wall-kick chimney (ROUTE A's
only way to the shrine stair). Reactive wall-kick loop."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run


def smart_kicks(g, floor, wallA, wallB, label, target_y, tries=14):
    """Hold W INTO one wall; the instant the hero is sliding/falling next to it,
    tap jump. Flip walls only after a kick actually fires."""
    g.tp(floor[0], floor[1], floor[2]); g.wait(900)
    st = g.show(label + " floor")
    y0 = (st.get("p") or [0, 0, 0])[1]
    kicks0 = g.js("() => CRESTBOUND.game.player.stats.wallKicks")
    cur = 0
    walls = [wallA, wallB]
    g.face(*walls[cur]); g.down("W")
    g.tap("SPACE", 100); g.wait(260)
    best = y0
    for k in range(tries):
        g.face(*walls[cur])
        s = g.snap()
        ps = s.get("ps"); y = (s.get("p") or [0, 0, 0])[1]
        best = max(best, y)
        if ps in ("wallslide", "fall", "jump1", "jump2", "jump3", "bonk"):
            g.tap("SPACE", 90)
            g.wait(170)
            s2 = g.snap()
            y2 = (s2.get("p") or [0, 0, 0])[1]
            best = max(best, y2)
            g.say("   %s try %2d: %s y=%.2f --SPACE--> %s y=%.2f" % (label, k, ps, y, s2.get("ps"), y2))
            if s2.get("ps") == "wallkick":
                cur = 1 - cur
        else:
            g.say("   %s try %2d: %s y=%.2f (no press)" % (label, k, ps, y))
            g.wait(150)
        if best >= target_y:
            g.say("   %s REACHED target y %.2f" % (label, target_y))
            break
    g.up("W"); g.wait(1400)
    kicks1 = g.js("() => CRESTBOUND.game.player.stats.wallKicks")
    g.say("   %s RESULT: wallKicks %s -> %s, best y %.2f (floor %.2f, gain %.2f, target %.2f)"
          % (label, kicks0, kicks1, best, y0, best - y0, target_y))
    g.show(label + " end")
    return best


def body(g):
    g.start("rime-3", cp=3)                       # cp-bridge, north flank west end
    g.show("cp-bridge (north flank)")
    g.shot("cp_bridge")

    g.say("== BEAT 4: walk the north flank east, over the ice slabs and rotors ==")
    g.walk(-14.0, -34.0, tol=1.8, max_ms=16000, tag="flank 1")
    g.show("flank 1"); g.shot("flank1")
    g.walk(-2.0, -38.0, tol=1.8, max_ms=16000, tag="flank 2 (ice slab + rotor)")
    g.show("flank 2 - on the ice?"); g.shot("flank2")
    g.say("   ICE: stand still on the slab and see if I slide")
    g.tp(-8.0, 8.8, -36.0); g.wait(800)
    a = g.show("ice t=0")
    for i in range(4):
        g.wait(1500); g.show("ice t=%.1f" % (1.5 * (i + 1)))
    b = g.snap()
    if a.get("p") and b.get("p"):
        g.say("   ice drift standing still over 6 s: %.2f m" %
              math.hypot(b["p"][0] - a["p"][0], b["p"][2] - a["p"][2]))
    g.shot("ice_slab")
    g.say("   ROTOR at (-3.0, 9.60, -37.4): stand in its sweep and see what it does")
    g.tp(-3.0, 9.9, -37.4); g.wait(600)
    d0 = g.snap().get("deaths")
    for i in range(8):
        g.wait(900); s = g.snap()
        if s.get("deaths", 0) > d0:
            g.say("   *** the rotor KILLED me standing in it"); break
    g.show("after rotor"); g.shot("rotor")

    g.say("== BEAT 5 ROUTE A: the ice-shelf stair, 4 shelves 14.60 -> 19.00 ==")
    g.tp(26.2, 13.9, -14.0); g.wait(800)
    g.show("below IS1"); g.shot("iceshelf_bottom")
    for (tx, tz, name) in [(26.2, -12.0, "IS1 15.20"), (26.4, -8.4, "IS2 16.80"),
                           (26.2, -3.6, "IS3 18.40"), (25.0, -1.6, "IS4 19.60 = terrace lip")]:
        g.face(tx, tz)
        g.down("W"); g.wait(420); g.tap("SPACE", 110); g.wait(1100); g.up("W"); g.wait(600)
        s = g.show("hop to " + name)
    g.shot("iceshelf_top")

    g.say("== BEAT 5 ROUTE B: the mill lift. Where is the east mill's gondola now? ==")
    g.say(json.dumps(g.js(r"""() => { const c=CRESTBOUND.game.course; const hz=(c&&(c.hazards||c._hazards))||[];
      const out=[]; for (const h of hz) { const k=h.kind||h.type; if(k!=='mill') continue;
        out.push({k, p:h.pos?[+h.pos.x.toFixed(1),+h.pos.y.toFixed(1),+h.pos.z.toFixed(1)]:null,
          decks:(h.decks||h.gondolas||[]).map(d=>d.pos?[+d.pos.x.toFixed(1),+d.pos.y.toFixed(1),+d.pos.z.toFixed(1)]:null)}); }
      return out.length?out:{hzKeys: c?Object.keys(c).slice(0,30):null}; }""")))

    g.say("== the terrace, the pedestal, and the GNASHER at the cave mouth ==")
    g.tp(16.5, 19.9, 6.5); g.wait(800)
    g.show("cp-terrace"); g.look(23.0, -2.0); g.wait(400); g.shot("terrace")
    g.walk(20.0, 2.0, tol=1.5, max_ms=10000, tag="across the terrace")
    g.say("   walk into the gnasher's disc (post 21,-2, chain 5.5)")
    d0 = g.snap().get("deaths")
    r = g.walk(22.0, -2.0, tol=1.5, max_ms=12000, tag="into the gnasher")
    g.show("gnasher contact"); g.shot("gnasher")
    g.say("   deaths %s -> %s" % (d0, g.snap().get("deaths")))

    g.say("== BEAT 6: the crusher cave, walking the coin line 23.5 -> 16.5 at z -2 ==")
    g.tp(24.5, 19.9, -2.0); g.wait(800)
    g.show("cave mouth"); g.shot("cave_mouth")
    d0 = g.snap().get("deaths")
    r = g.walk(16.5, -2.0, tol=1.5, max_ms=20000, tag="through the crushers and beams")
    g.show("through the cave"); g.shot("cave_through")
    g.say("   deaths %s -> %s" % (d0, g.snap().get("deaths")))

    g.say("== BEAT 6: THE WALL-KICK CHIMNEY - ROUTE A's ONLY way to the shrine stair ==")
    smart_kicks(g, (15.0, 19.9, -2.0), (15.0, -3.9), (15.0, -0.1), "cave-chimney", 27.70, tries=16)
    g.shot("cave_chimney")


run("east", body)
