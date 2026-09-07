"""KEEP playtest pass B, run 1 — title, gate survey, lobby, first painting.

A player's first two minutes: look at the title, press W (does the hero move
before the game started?), press NEW GAME, look around the lobby, read the
mosaic, walk into the VERDANT-1 painting.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    st = P.state()
    P.say("boot state:", json.dumps(st))
    P.shot("title")

    # --- P0 regression: does W move the hero while the title is up? ---
    before = P.pos()
    P.down("W"); P.wait(1400); P.up("W"); P.wait(300)
    after = P.pos()
    moved = ((after[0] - before[0]) ** 2 + (after[2] - before[2]) ** 2) ** 0.5
    P.say("TITLE INPUT LEAK: held W 1.4 s at state=%s -> moved %.2f m %s -> %s" % (
        st["gstate"], moved, before, after))
    P.shot("title_after_W")

    # --- press NEW GAME like a player ---
    lbl = P.click_title()
    P.wait(1500)
    st = P.state()
    P.say("clicked title button %r -> state %s course %s pos %s" % (lbl, st["gstate"], st["course"], st["pos"]))
    P.shot("after_newgame")

    # --- what does the hub actually contain? ---
    gates = P.gates()
    P.say("GATES (%d):" % len(gates))
    for g in gates:
        P.say("   %-10s req=%s kind=%-8s unlocked=%s sealed=%s pos=%s yaw=%s" % (
            g["course"], g["req"], g["kind"], g["unlocked"], g["sealed"], g["pos"], g["yaw"]))

    npcs = P.js("""() => { const C = CRESTBOUND.game.course;
        return { npcs: (C.def.npcs||[]).map(n => ({kind:n.kind, p:n.p})),
                 cps: (C.def.checkpoints||[]).map(c => ({id:c.id, p:c.p})),
                 secrets: (C.def.secrets||[]).map(s => ({id:s.id, p:s.p||s.at||null})),
                 objCount: (C.def.objects||[]).length,
                 kinds: [...new Set((C.def.objects||[]).map(o => o.kind))] }; }""")
    P.say("NPCS/CPS:", json.dumps(npcs))

    # --- walk the lobby: face the west aisle paintings ---
    P.say("--- lobby: walk west toward the verdant paintings ---")
    v1 = next(g for g in gates if g["course"] == "verdant-1")
    P.shot("lobby_spawn")
    r = P.walk_to(v1["pos"][0], v1["pos"][2], tol=1.6, max_ms=12000, tag="verdant-1 painting")
    P.shot("at_verdant1_painting")
    st = P.state()
    P.say("after walking into the painting: state=%s course=%s card=%s pos=%s" % (
        st["gstate"], st["course"], st["cardOpen"], st["pos"]))

    if st["cardOpen"] or st["gstate"] == "card":
        P.shot("course_card")
        # a player would press the ENTER button on the card
        btn = P.js("""() => { const b = [...document.querySelectorAll('.cb-card button, .cb-card .cb-btn')]
              .filter(x => x.offsetParent !== null).map(x => (x.textContent||'').trim()); return b; }""")
        P.say("card buttons:", btn)
        P.js("""() => { const b = [...document.querySelectorAll('.cb-card button, .cb-card .cb-btn')]
              .filter(x => x.offsetParent !== null)
              .find(x => /ENTER|PLAY|GO/i.test(x.textContent||'')); if (b) b.click(); return !!b; }""")
        P.wait(4000)
        st = P.state()
        P.say("after ENTER: state=%s course=%s pos=%s" % (st["gstate"], st["course"], st["pos"]))
        P.shot("entered_course")

    P.say("console:", json.dumps(P.console[:20]))
    P.dump("keepB1")
