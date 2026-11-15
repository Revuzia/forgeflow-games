"""Windmill-Heights playtest helpers: a WALK that does not fight the controller.

_playlib.walk_to() re-aims with player.__test.setFacing() every 220 ms. That snaps
the hero's facing under a held stick, which the controller reads as a reversal and
answers with a pivot — measured: 2.0 m of travel in a 12 s hold, against 5 m/s when
the same key is held with the camera aimed once. So this module steers the CAMERA
only (which is what a player's mouse does) and lets the hero turn himself.
"""
import json, math, time


def install(pl):
    pl.aim = lambda x, z: pl.js(
        """([tx,tz]) => { const G = CRESTBOUND.game, P = G.player;
             const yaw = Math.atan2(-(tx - P.pos.x), -(tz - P.pos.z));
             if (G.cam) { G.cam.yaw = yaw; G.cam._rcHoldT = 0; }
             return +yaw.toFixed(3); }""", [x, z])

    def go(x, z, tol=1.4, max_ms=12000, keys=("W",), tag="", reaim_ms=700, stop_on=None):
        """Hold the movement keys and steer the CAMERA at an XZ target. Real keys."""
        pl.aim(x, z)
        pl.down(*keys)
        t0 = time.time()
        prev = pl.pos()
        stuck = 0
        trail = [prev]
        last = None
        while (time.time() - t0) * 1000 < max_ms:
            pl.wait(reaim_ms)
            st = pl.state()
            last = st
            p = st["pos"]
            trail.append(p)
            d = math.hypot(p[0] - x, p[2] - z)
            if d <= tol:
                break
            if stop_on and stop_on(st):
                break
            moved = math.hypot(p[0] - prev[0], p[2] - prev[2])
            stuck = stuck + 1 if moved < 0.25 else 0
            prev = p
            if stuck >= 4:
                break
            pl.aim(x, z)
        pl.up(*keys)
        pl.wait(200)
        st = pl.state()
        p = st["pos"]
        d = math.hypot(p[0] - x, p[2] - z)
        pl.say("  go %s%s -> %s %s d=%.2f %s%s" % (
            [x, z], (" [" + tag + "]") if tag else "", p, st["pstate"], d,
            "ARRIVED" if d <= tol else "DID NOT ARRIVE", "  STUCK" if stuck >= 4 else ""))
        return {"end": p, "dist": round(d, 2), "arrived": d <= tol, "stuck": stuck >= 4,
                "state": st, "trail": trail}
    pl.go = go

    def watch(n, ms, tag):
        tr = []
        for _ in range(n):
            pl.wait(ms)
            q = pl.state()
            tr.append([q["pos"], q["pstate"], q["grounded"], q["surface"], q["inWater"]])
        pl.say("  %s: %s" % (tag, json.dumps(tr)))
        return tr
    pl.watch = watch

    pl.hook = lambda: pl.js(
        """()=>{ const G=CRESTBOUND.game, P=G.player; G.__ev=[]; G.__deaths=[];
          for (const k of ['jump','land','death','collect','checkpoint','splash','surface','bounce',
                           'longjump','backflip','sideflip','bonk','wallkick','dive','pound','poundLand',
                           'climbStart','climbEnd','cannonEnter','ringPass','slide'])
            P.events.on(k,(a)=>G.__ev.push(k+((a&&a.id)?':'+a.id:((a!==undefined&&typeof a!=='object')?':'+String(a).slice(0,14):''))));
          P.events.on('death',(c)=>G.__deaths.push({c:String(c),
            p:[+P.pos.x.toFixed(1),+P.pos.y.toFixed(1),+P.pos.z.toFixed(1)]}));
          return 1; }""")

    pl.ev = lambda: pl.js("()=>{const e=CRESTBOUND.game.__ev.slice(); CRESTBOUND.game.__ev.length=0; return e;}")
    pl.deaths = lambda: pl.js("()=>{const d=CRESTBOUND.game.__deaths.slice(); CRESTBOUND.game.__deaths.length=0; return d;}")
    pl.snap = lambda: pl.js(
        "()=>{const s=CRESTBOUND.game.__dev.state(); return {coins:s.coins,sigils:s.sigils,"
        "crests:s.crests,cp:s.cpIndex,deaths:s.deaths,raceMs:s.raceMs,power:s.power};}")

    def enter(course):
        # The box can be loaded (the owner's own Chrome holds the GPU): wait for the
        # module graph to actually run before touching CRESTBOUND at all.
        for i in range(240):
            if pl.js("()=>!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pl.wait(1000)
            if i and i % 30 == 0:
                pl.say("  ...still waiting for boot (%d s)" % i)
        else:
            raise RuntimeError("page never booted CRESTBOUND.game")
        pl.click_title(); pl.wait(2500)
        for _ in range(60):
            if pl.js("()=>!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.__dev)"):
                break
            pl.wait(500)
        pl.unlock_all(); pl.wait(300)
        pl.js("(c) => { CRESTBOUND.game.__dev.goto(c); return 1; }", course)
        for _ in range(80):
            pl.wait(500)
            s = pl.state()
            if s["course"] == course and s["gstate"] == "playing":
                break
        pl.wait(1500)
        pl.hook()
        pl.say("IN COURSE:", json.dumps(pl.state()))
        return pl.state()
    pl.enter = enter

    def jump(hold_ms=250, run_ms=500, keys=("W",), after_ms=1400, sample_ms=170, n=9, release_at=None):
        """A real run-and-jump. release_at = ms after take-off to let go of the stick."""
        if run_ms:
            pl.down(*keys); pl.wait(run_ms)
        pl.down("SPACE"); pl.wait(hold_ms); pl.up("SPACE")
        tr = []
        t = 0
        for i in range(n):
            pl.wait(sample_ms); t += sample_ms
            if release_at is not None and t >= release_at:
                pl.up(*keys)
                release_at = None
            q = pl.state(); tr.append([q["pos"], q["pstate"], q["grounded"]])
        pl.up(*keys)
        pl.wait(after_ms)
        return tr
    pl.jump = jump
