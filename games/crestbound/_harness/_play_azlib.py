"""Boot helpers for the azure-1 playtest lane. Resilient against the flaky
first load (the shipped page occasionally never defines CRESTBOUND on the first
navigation while other lanes' gates hammer the box) — reload and try again, and
say so out loud rather than dying on a ReferenceError.
"""
import json


def _typeof(P):
    return P.js("() => typeof globalThis.CRESTBOUND")


def boot(P, course=None, tries=4):
    for attempt in range(tries):
        ok = False
        for i in range(80):
            if _typeof(P) == "object" and P.js("() => !!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                ok = True
                break
            P.wait(500)
        if ok:
            break
        P.say("  [boot] CRESTBOUND never appeared (attempt %d) — reloading. console: %s"
              % (attempt + 1, json.dumps(P.console[-6:])))
        P.pg.reload(wait_until="load", timeout=90000)
        P.wait(2000)
    else:
        raise RuntimeError("page never booted after %d attempts" % tries)

    for i in range(120):
        if P.js("() => CRESTBOUND.game.state !== 'loading'"):
            break
        P.wait(500)
    P.click_title()
    P.wait(1400)
    P.unlock_all()
    if course:
        P.js("(c) => CRESTBOUND.game.__dev.goto(c)", course)
        for _ in range(90):
            P.wait(500)
            s = P.state()
            if s["course"] == course and s["gstate"] == "playing":
                break
        P.wait(2000)
    return P.state()


def drive(P, x, z, secs, keys=("W",), tag="", every=0):
    P.face(x, z)
    for k in keys:
        P.down(k)
    for i in range(int(secs * 4)):
        P.wait(250)
        P.face(x, z)
        if every and i % every == 0:
            P.shot("%s_%02d" % (tag or "drive", i))
    for k in keys:
        P.up(k)
    P.wait(200)
    e = P.state()
    P.say("  drive->(%s,%s) %-18s end %s %s g=%s water=%s camdist=%s" %
          (x, z, tag, e["pos"], e["pstate"], e["grounded"], e["inWater"], e["camDist"]))
    return e
