"""KEEP playtest pass B, run 6 — CAN A PLAYER CLIMB THE SPIRAL STAIR?

Tread-by-tread: aim at the next tread's centre, walk in short bursts, check y.
Up to 8 bursts per tread before calling it stuck.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

# tread centres measured in run 5 (top y, x, z), the corkscrew only
TREADS = [(-15.58, -7.67, 6.64), (-15.09, -7.33, 5.91), (-14.36, -7.00, 5.42),
          (-13.50, -6.67, 5.25), (-12.64, -6.33, 5.42), (-11.91, -6.00, 5.91),
          (-11.42, -5.67, 6.64), (-11.25, -5.33, 7.50), (-11.42, -5.00, 8.36),
          (-11.91, -4.67, 9.09), (-12.64, -4.33, 9.58), (-13.50, -4.00, 9.75),
          (-14.36, -3.67, 9.58), (-15.09, -3.33, 9.09), (-15.58, -3.00, 8.36),
          (-15.75, -2.67, 7.50), (-15.58, -2.33, 6.64), (-15.09, -2.00, 5.91),
          (-14.36, -1.67, 5.42), (-13.50, -1.33, 5.25), (-12.64, -1.00, 5.42),
          (-11.91, -0.67, 5.91), (-11.42, -0.33, 6.64)]

with Play("keepB6") as P:
    P.click_title(); P.wait(1200)
    P.tp(-16.4, -7.8, 6.64); P.wait(600)
    P.shot("00_at_the_bottom_step")
    P.say("start:", json.dumps(P.state()))

    stuck_at = None
    for i, (tx, ty, tz) in enumerate(TREADS):
        got = False
        for burst in range(8):
            P.face(tx, tz)
            P.down("W"); P.wait(200); P.up("W"); P.wait(140)
            st = P.state()
            if st["pos"][1] >= ty - 0.08:
                got = True
                break
        st = P.state()
        P.say("  tread %2d (top %.2f at %.2f,%.2f): %s  y=%.2f  %s  %s" % (
            i, ty, tx, tz, "ON" if got else "STUCK", st["pos"][1], st["pstate"], st["pos"]))
        if i % 4 == 0 or not got:
            P.shot("%02d_tread%02d_%s" % (i + 1, i, "on" if got else "STUCK"))
        if not got:
            stuck_at = i
            break

    st = P.state()
    P.say("SPIRAL CLIMB: ended at y %.2f (lobby floor 0.00) %s" % (
        st["pos"][1], "STUCK at tread %d" % stuck_at if stuck_at is not None else "TOP REACHED"))
    P.shot("99_end")

    # if we made the top, walk off into the lobby
    if stuck_at is None:
        r = P.walk_to(-13.5, 13.0, tol=1.5, max_ms=6000, tag="off the stair into the lobby")
        P.say("  off the top:", json.dumps(P.state()))
        P.shot("98_off_the_top")
    P.dump("keepB6")
