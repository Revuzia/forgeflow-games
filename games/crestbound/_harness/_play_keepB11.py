"""KEEP playtest pass B, run 11 — THE GALLERY, OLD FEN and the RIME gates.

The grand stair is a wall (run 2), so get up with ?cp= / the dev teleport and
then WALK everything: the gallery loop, the long hall, the library nook, talk
to Old Fen, walk into all three rime paintings, and the balcony long jump to
the garden loft.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB11") as P:
    P.click_title(); P.wait(1500)

    # arrive at the gallery checkpoint and WALK from there
    P.tp(0, 6.5, -11.0); P.wait(800)
    P.say("arrived on the gallery:", json.dumps(P.state()))
    P.shot("gallery_arrival")
    for name, (tx, tz) in [("north", (0, -18)), ("west", (-14, -11)), ("east", (14, -11)), ("south", (0, -4))]:
        P.face(tx, tz); P.wait(500)
        P.shot("gallery_look_" + name)

    # --- walk the gallery loop ---
    P.say("--- walking the gallery loop ---")
    for tag, (x, z) in [("west leg", (-14.5, -11.0)), ("south-west corner", (-14.5, -2.0)),
                        ("south leg", (0.0, -2.0)), ("south-east corner", (14.5, -2.0)),
                        ("east leg", (14.5, -11.0)), ("back to the head of the stair", (0.0, -8.0))]:
        r = P.walk_to(x, z, tol=1.6, max_ms=12000, tag=tag)
        P.shot("loop_" + tag.replace(" ", "_"))
        st = P.state()
        if abs(st["pos"][1] - 6.3) > 0.6:
            P.say("  ** left the gallery deck: y=%.2f at %s" % (st["pos"][1], st["pos"]))

    # --- can you walk DOWN the middle flight from the gallery? ---
    P.say("--- the middle flight, from the gallery going down ---")
    P.tp(0.0, 6.5, -3.6); P.wait(600)
    P.face(0, -9.0)
    s = P.hold(["W"], 4200, sample_ms=420, tag="down the middle flight")
    P.say("  ys:", [round(x["pos"][1], 2) for x in s])
    P.say("  ended:", json.dumps(P.state()))
    P.shot("middle_flight_down")

    # --- the long hall and the rime gates ---
    P.say("--- north up the long hall to the RIME gates ---")
    P.tp(0, 6.5, -14.0); P.wait(600)
    r = P.walk_to(0, -19.0, tol=2.0, max_ms=12000, tag="into the long hall")
    P.shot("long_hall")
    for course, gp in [("rime-1", [-12, 8.8, -20]), ("rime-2", [-12, 8.8, -28]), ("rime-3", [0, 8.8, -34.6])]:
        r = P.walk_to(gp[0] + (2.5 if gp[0] < 0 else 0), gp[2] + (0 if gp[0] < 0 else 2.5),
                      tol=1.6, max_ms=12000, tag=course + " approach")
        P.face(gp[0], gp[2]); P.wait(400)
        P.shot(course + "_from_the_hall")
        r = P.walk_to(gp[0], gp[2], tol=1.1, max_ms=5000, tag=course + " walk in")
        P.wait(700)
        toast = P.js("""() => [...document.querySelectorAll('.cb-toast, .cb-toast *, .cb-prompt, .cb-prompt *')]
            .filter(e => e.offsetParent !== null && e.children.length === 0)
            .map(e => (e.textContent||'').trim()).filter(Boolean)""")
        st = P.state()
        P.say("  %s: pos=%s y=%.2f card=%s toast=%s" % (course, st["pos"], st["pos"][1], st["cardOpen"], json.dumps(toast)))
        P.shot(course + "_walkin")

    # --- OLD FEN ---
    P.say("--- the library nook and OLD FEN at [17, 6.35, -21] ---")
    P.tp(12.0, 6.5, -16.0); P.wait(700)
    r = P.walk_to(17.0, -21.0, tol=1.8, max_ms=14000, tag="to Old Fen")
    P.shot("fen_approach")
    st = P.state()
    P.say("  standing by Fen:", json.dumps(st))
    prompt = P.js("""() => [...document.querySelectorAll('.cb-prompt, .cb-prompt *')]
        .filter(e => e.offsetParent !== null && e.children.length === 0)
        .map(e => (e.textContent||'').trim()).filter(Boolean)""")
    P.say("  interact prompt here:", json.dumps(prompt))
    for i in range(4):
        P.tap("E", 130); P.wait(1100)
        lines = P.js("""() => [...document.querySelectorAll('.cb-dialog, .cb-dialog *, .cb-fen, .cb-fen *')]
            .filter(e => e.offsetParent !== null && e.children.length === 0)
            .map(e => (e.textContent||'').trim()).filter(Boolean)""")
        P.say("   press E #%d -> %s" % (i + 1, json.dumps(lines)))
        P.shot("fen_talk_%d" % (i + 1))

    # --- the balcony long jump to the garden loft ---
    P.say("--- the balcony -> garden loft long jump (6.0 m) ---")
    P.tp(0, 6.5, 19.0); P.wait(700)
    P.say("  on the balcony:", json.dumps(P.state()))
    P.shot("balcony")
    P.face(0, 26.0)
    P.down("W"); P.wait(900)
    P.down("C"); P.wait(60); P.tap("SPACE", 200); P.up("C")
    P.wait(1500); P.up("W"); P.wait(800)
    st = P.state()
    P.say("  after the long jump: %s state=%s" % (st["pos"], st["pstate"]))
    P.shot("balcony_longjump")
    P.dump("keepB11")
