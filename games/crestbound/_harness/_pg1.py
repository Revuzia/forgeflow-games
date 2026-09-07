"""GNASHER FORT phase 1 — the south shore, signs, bumbler, causeway sinkers, moat."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_gnasher import enter, rec_on, rec, evsum

try:
  with Play("gnasher") as pl:
    enter(pl)
    rec_on(pl)
    pl.shot("spawn")

    # --- what is on screen from the spawn: read the signs from where a player stands
    pl.say("== SIGN READABILITY ==")
    print("texts:", json.dumps(pl.js("""() => (CRESTBOUND.game.course.def.objects||[])
      .filter(o => o.kind === 'text').map(o => ({t:o.text, p:o.p, size:o.size}))""")))

    # --- the bumbler patrolling the spawn: stand STILL and see if it hurts me
    pl.say("== BUMBLER AT SPAWN: stand still 12 s ==")
    h0 = pl.js("() => CRESTBOUND.game.player.hp !== undefined ? CRESTBOUND.game.player.hp : null")
    for i in range(8):
        pl.wait(1500)
        st = pl.state()
        crit = pl.js("""() => { const P=CRESTBOUND.game.player, L=CRESTBOUND.game.course.critters;
            const arr = (L && (L.list||L.all||L.critters)) || [];
            return arr.map(c => ({k:c.kind||c.type, d:+Math.hypot((c.pos||c.p||{x:1e9}).x-P.pos.x,((c.pos||c.p||{z:1e9}).z)-P.pos.z).toFixed(2)}))
                      .filter(o => o.d < 12).sort((a,b)=>a.d-b.d); }""")
        pl.say("  t=%d pos=%s state=%s near=%s" % (i, st["pos"], st["pstate"], json.dumps(crit)))
    pl.shot("bumbler_standstill")
    pl.say("events:", json.dumps(evsum(rec(pl))))

    # --- walk the mown path north to the shore
    pl.say("== WALK spawn -> shore quay (0,49) ==")
    r = pl.walk_to(0, 49, tol=1.5, max_ms=12000, tag="south quay")
    pl.shot("south_quay")
    pl.say("events:", json.dumps(evsum(rec(pl))))

    # --- the metal hat on the shore
    pl.say("== METAL HAT at (4.6,1.60,46.8) — walk to it ==")
    r = pl.walk_to(4.6, 46.8, tol=1.4, max_ms=12000, tag="metal hat")
    pl.shot("metal_hat")
    st = pl.state()
    pw = pl.js("() => { const P = CRESTBOUND.game.player; return {power: P.power, powerT: P.powerT}; }")
    pl.say("  after hat:", json.dumps(pw), json.dumps(evsum(rec(pl))))

    pl.dump("gnasher_p1")
    print("CONSOLE:", json.dumps(pl.console[:25]))
    print("DONE_P1")
except Exception:
    traceback.print_exc(); print("DONE_P1")
