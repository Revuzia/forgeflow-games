"""art-wire lane — drive each modelled critter through its behaviour and read frames.

For every beat it records the creature's STATE and the clip the mixer is
actually playing, so "the model animates" is a measurement rather than a claim.

    python _aw_behaviour.py            # gnasher, bumbler, skitter on verdant-1, Fen in the Keep
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play  # noqa: E402

SAMPLE = r"""(kind) => {
  const G = CRESTBOUND.game, P = G.player;
  const cs = (G.course.critters || []).filter(c => c.kind === kind);
  return cs.map(c => ({
    st: c.state, clip: c._clipState,
    play: c._clipAction ? c._clipAction.getClip().name : null,
    t: c._clipAction ? +c._clipAction.time.toFixed(3) : null,
    w: c._clipAction ? +c._clipAction.getEffectiveWeight().toFixed(2) : null,
    proc: !!c._procOn, far: !!c._far, alive: c.alive,
    p: [+c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.pos.z.toFixed(2)],
    hp: c.hp === undefined ? null : c.hp,
    d: +Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z).toFixed(1),
  }));
}"""


def goto(p, c):
    p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", c)
    for _ in range(90):
        p.wait(250)
        if p.js("()=>(CRESTBOUND.game.state==='playing'&&CRESTBOUND.game.courseId===%s)" % json.dumps(c)):
            break
    p.wait(1500)
    for _ in range(80):
        if p.js("() => (CRESTBOUND.game.course.critters||[]).every(c => !!c.model)"):
            break
        p.wait(250)


def watch(p, kind, ms, tag, ix=0):
    """Sample one kind for `ms`, shooting a frame the first time a clip appears."""
    seen = {}
    t0 = time.time()
    while (time.time() - t0) * 1000 < ms:
        rows = p.js(SAMPLE, kind)
        if rows and ix < len(rows):
            r = rows[ix]
            key = (r["st"], r["play"], r["proc"])
            if key not in seen:
                seen[key] = round(time.time() - t0, 2)
                p.shot("%s_%s_%s" % (tag, r["st"], (r["play"] or "proc")))
        p.wait(70)
    return {str(k): v for k, v in seen.items()}


def main():
    out = {}
    with Play("aw_beh") as p:
        p.click_title()
        p.wait(1200)
        p.unlock_all()
        p.wait(400)

        # ---------------- Fen (the Keep) ----------------------------------
        fen = p.js("() => (CRESTBOUND.game.course.critters||[]).filter(c=>c.kind==='fen')"
                   ".map(c => [c.pos.x, c.pos.y, c.pos.z])")
        p.say("fen at %s" % fen)
        if fen:
            f = fen[0]
            p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);}", [f[0] + 3.0, f[1] + 0.4, f[2] + 3.0])
            p.wait(900)
            p.walk_to(f[0] + 0.7, f[2] + 0.7, tol=0.9, max_ms=9000, stop_on_card=False, tag="to Old Fen")
            p.wait(500)
            p.face(f[0], f[2])
            p.shot("fen_before")
            import threading
            box = {}

            def tapper():
                for _ in range(4):
                    p_tap = p.tap
                    p_tap("E", 130)
                    p.wait(400)
            for _ in range(2):
                p.tap("E", 130)
                box["fen_during"] = watch(p, "fen", 1400, "fen_talk")
            p.say("fenNear %s gateNear %s" % (p.js("() => CRESTBOUND.game._fenNear"),
                                              p.js("() => CRESTBOUND.game._gateNear")))
            p.say("fen talkT/lineIx: %s" % p.js("() => (CRESTBOUND.game.course.critters||[])"
                  ".filter(c=>c.kind==='fen').map(c=>[+c.talkT.toFixed(2), c.lineIx, c.near])"))
            out["fen"] = dict(box.get("fen_during", {}))
            out["fen"].update(watch(p, "fen", 1600, "fen"))
            p.say("fen clips: %s" % json.dumps(out["fen"]))

        # ---------------- verdant-1 ---------------------------------------
        goto(p, "verdant-1")
        pos = p.js("() => { const o = {}; for (const c of CRESTBOUND.game.course.critters||[]) "
                   "(o[c.kind] = o[c.kind]||[]).push([+c.pos.x.toFixed(2),+c.pos.y.toFixed(2),+c.pos.z.toFixed(2)]); return o; }")
        p.say("critters: %s" % json.dumps(pos))

        # GNASHER — walk into its radius from outside, watch telegraph -> lunge
        gy = p.js("() => (CRESTBOUND.game.course.critters||[]).filter(c=>c.kind==='gnasher')"
                  ".map(c => [c.pos.x, c.groundY, c.pos.z, c.chainLen])")[0]
        p.say("gnasher groundY %s chain %s" % (gy[1], gy[3]))
        # Find a spot the hero actually STANDS on: try it, settle, read the height.
        import math as _m
        spot = None
        for r in (3.6, 4.4, 5.2):
            for k in range(16):
                th = k * _m.pi / 8
                x, z = gy[0] + _m.cos(th) * r, gy[2] + _m.sin(th) * r
                if (x + 8.0) ** 2 + (z + 7.0) ** 2 < 3.0 ** 2:
                    continue                      # inside the post-safe ring
                p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);"
                     "CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}", [x, gy[1] + 0.6, z])
                p.wait(420)
                q = p.pos()
                if abs(q[1] - gy[1]) < 0.6:
                    spot = [q[0], q[1], q[2]]
                    break
            if spot:
                break
        p.say("gnasher standing spot: %s (floor %.2f)" % (spot, gy[1]))
        p.wait(500)
        if spot:
            p.walk_to(gy[0] + (spot[0] - gy[0]) * 0.72, gy[2] + (spot[2] - gy[2]) * 0.72,
                      tol=0.9, max_ms=6000, stop_on_card=False, tag="toward the gnasher")
        p.say("hero now %s" % p.pos())
        out["gnasher"] = watch(p, "gnasher", 11000, "gnasher")
        p.say("gnasher clips: %s" % json.dumps(out["gnasher"]))

        # BUMBLER — drop on one and pound it
        res = {}
        for attempt in range(4):
            b = p.js("() => { const c = (CRESTBOUND.game.course.critters||[])"
                     ".filter(x=>x.kind==='bumbler')[2]; return [c.pos.x, c.pos.y, c.pos.z, c.state]; }")
            if b[3] != 'walk':
                break
            p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);"
                 "CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}", [b[0], b[1] + 3.2, b[2]])
            p.wait(120)
            p.shot("bumbler_above%d" % attempt)
            p.down("C")            # a real ground pound onto the patroller
            r = watch(p, "bumbler", 2600, "bumbler", ix=2)
            p.up("C")
            res.update(r)
            if any("squish" in k for k in res):
                break
        res.update(watch(p, "bumbler", 2600, "bumbler", ix=2))
        out["bumbler"] = res
        p.say("bumbler clips: %s" % json.dumps(res))

        # SKITTER — stand under one until it swoops
        s = pos["skitter"][1]
        p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);}", [s[0], s[1] - 2.6, s[2]])
        p.wait(600)
        out["skitter"] = watch(p, "skitter", 12000, "skitter", ix=1)
        p.say("skitter clips: %s" % json.dumps(out["skitter"]))

        print("CONSOLE:", json.dumps([c for c in p.console][:10]))
        print("SHOTS:", p.shotdir)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
