"""PLAYTEST — THE KEEP, run 1: the title, the lobby hall, the three verdant
paintings and the grand staircase (the owner's P6 "I cant reach the main stairs").
Everything here is driven with real KeyboardEvents; nothing is teleported except
where it says TELEPORT, and every teleport is followed by walking."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    # ------------------------------------------------------------------ title
    P.say("=== TITLE ===")
    st = P.state()
    P.say(" boot state:", st["gstate"], "pos", st["pos"])
    P.shot("title")
    # P0 regression: does W leak through the title screen?
    before = P.pos()
    P.hold(["W"], 1400, tag="W on the TITLE screen")
    after = P.pos()
    drift = ((after[0] - before[0]) ** 2 + (after[2] - before[2]) ** 2) ** 0.5
    P.say(" title input leak: hero moved %.2f m while the title was up" % drift)
    P.shot("title_after_W")

    # what does the title actually offer?
    P.say(" title buttons:", P.js("""() => [...document.querySelectorAll('button')]
        .filter(b=>b.offsetParent!==null).map(b=>(b.textContent||'').trim().slice(0,40))"""))

    clicked = P.click_title()
    P.wait(2500)
    st = P.state()
    P.say(" clicked", repr(clicked), "-> state", st["gstate"], "pos", st["pos"])
    P.shot("lobby_spawn")

    # ------------------------------------------------------- what a gate says
    P.say("=== GATES, as the save has them for a NEW player ===")
    for g in P.gates():
        P.say("  ", g)

    # ------------------------------------------------------------ look around
    P.say("=== LOOKING AROUND THE LOBBY FROM THE SPAWN MOSAIC ===")
    for i, tag in enumerate(["orbitQ", "orbitQ2", "orbitE", "orbitE2"]):
        P.hold(["Q" if i < 2 else "E"], 700)
        P.shot("lobby_" + tag)
    P.tap("Z", 200); P.wait(700)
    P.shot("lobby_recentered")

    # --------------------------------------------- walk to the verdant-1 gate
    P.say("=== VERDANT-1 PAINTING (0 crests — the first thing a new player must do) ===")
    g = [x for x in P.gates() if x["course"] == "verdant-1"][0]
    P.say(" gate:", g)
    r = P.walk_to(g["exit"][0], g["exit"][2], tol=1.0, tag="stand in front of verdant-1")
    P.shot("v1_standing_off")
    P.say(" reading the painting from where a player stands:")
    # walk THROUGH it
    P.face(g["pos"][0], g["pos"][2])
    P.wait(200)
    P.shot("v1_facing_painting")
    r2 = P.walk_to(g["pos"][0], g["pos"][2], tol=0.5, max_ms=6000, tag="walk INTO the painting")
    P.wait(900)
    st = P.state()
    P.say(" after walking in:", st["gstate"], "card", st["cardOpen"], "course", st["course"])
    P.shot("v1_after_walkin")

    P.dump("keep1")
    P.say("CONSOLE:", P.console[:12])
