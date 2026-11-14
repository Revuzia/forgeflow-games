"""PLAYTEST — VERDANT-3 WINDMILL HEIGHTS.  Stage 1: spawn, meadow, quay, the logs, the river."""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

STAGE = sys.argv[1] if len(sys.argv) > 1 else "1"

with Play("windmill") as pl:
    pl.say("=== BOOT ===")
    st = pl.state(); pl.say("boot state:", json.dumps(st))
    pl.shot("00_title")
    got = pl.click_title(); pl.say("clicked title button:", got)
    pl.say("t=%.1f after click" % time.time())
    pl.wait(2500)
    pl.say("after title:", json.dumps(pl.state()))
    pl.say("unlockAll ->", json.dumps(pl.unlock_all())[:400])
    pl.wait(400)
    pl.js("() => { CRESTBOUND.game.__dev.goto('verdant-3'); return 1; }")
    for _ in range(80):
        pl.wait(500)
        s = pl.state()
        if s["course"] == "verdant-3" and s["gstate"] == "playing":
            break
    pl.wait(1500)
    st = pl.state(); pl.say("IN COURSE:", json.dumps(st))
    pl.shot("01_spawn")

    # instrument: record every player event + death
    pl.js("""()=>{ const G=CRESTBOUND.game, P=G.player; G.__ev=[]; G.__deaths=[];
      const kinds=['jump','land','death','collect','checkpoint','splash','surface','bounce',
                   'longjump','backflip','sideflip','bonk','wallkick','dive','pound','poundLand',
                   'climbStart','climbEnd','cannonEnter','ringPass','slide'];
      for (const k of kinds) P.events.on(k, (a,b,c)=>G.__ev.push({e:k,a:(a&&a.id)||String(a===undefined?'':a).slice(0,24),
        p:[+P.pos.x.toFixed(1),+P.pos.y.toFixed(1),+P.pos.z.toFixed(1)]}));
      P.events.on('death',(c)=>G.__deaths.push({c:String(c),p:[+P.pos.x.toFixed(1),+P.pos.y.toFixed(1),+P.pos.z.toFixed(1)]}));
      return 1; }""")
    def ev(clear=True):
        r = pl.js("()=>{const e=CRESTBOUND.game.__ev.slice(); return e;}")
        if clear: pl.js("()=>{CRESTBOUND.game.__ev.length=0;}")
        return [x["e"] + (":" + x["a"] if x["a"] else "") for x in r]
    def snap():
        return pl.js("()=>{const s=CRESTBOUND.game.__dev.state(); return {coins:s.coins,sigils:s.sigils,crests:s.crests,cp:s.cpIndex,raceMs:s.raceMs,deaths:s.deaths,power:s.power};}")
    pl.evf = ev; pl.snapf = snap

    pl.say("snapshot:", json.dumps(snap()))

    # ---------------------------------------------------------------- BEAT 1
    pl.say("")
    pl.say("=== BEAT 1  RIVERMEAD — walk the meadow, the coin trail, the pedestal, the bumbler ===")
    p0 = pl.pos(); pl.say("standing at", p0)
    # look around first (a player orbits)
    pl.hold(["Q"], 900, tag="orbit left"); pl.shot("02_look_around")
    pl.hold(["E"], 1800, tag="orbit right"); pl.shot("03_look_right")
    pl.tap("Z"); pl.wait(400)

    r = pl.walk_to(-6, 51, tol=1.6, max_ms=12000, tag="meadow pedestal (coins crest spawn)")
    pl.shot("04_meadow_pedestal")
    pl.say("  events:", ev(), "snap", json.dumps(snap()))

    r = pl.walk_to(-12, 50, tol=2.0, max_ms=9000, tag="paddock coin ring")
    pl.shot("05_paddock_ring")
    pl.say("  events:", ev(), "snap", json.dumps(snap()))

    # the bumbler patrols on(-8,48)->(6,45)->(2,52)
    b = pl.js("""()=>{const C=CRESTBOUND.game.course; const out=[];
        for (const c of (C.critters||[])) { const d=c.def||{};
          const m=c.mesh||c.root; if(!m) continue;
          out.push({k:d.kind, p:[+m.position.x.toFixed(1),+m.position.y.toFixed(1),+m.position.z.toFixed(1)]}); }
        return out; }""")
    pl.say("  critters live:", json.dumps(b))
    bum = [c for c in b if c["k"] == "bumbler"]
    if bum:
        bp = bum[0]["p"]
        pl.say("  walking INTO the nearest bumbler at", bp)
        pl.walk_to(bp[0], bp[2], tol=0.9, max_ms=8000, tag="bumbler contact")
        pl.wait(400); pl.shot("06_bumbler_contact")
        pl.say("  after contact:", json.dumps(pl.state()), "events", ev(), "deaths", pl.js("()=>CRESTBOUND.game.__deaths"))
        # stand still next to it for 4 s: can it hurt a stationary player?
        pl.say("  standing STILL beside it for 5 s...")
        before = pl.js("()=>CRESTBOUND.game.__dev.state().deaths")
        tr = []
        for i in range(10):
            pl.wait(500); q = pl.state(); tr.append((q["pos"], q["pstate"]))
        after = pl.js("()=>CRESTBOUND.game.__dev.state().deaths")
        pl.say("  still-stand trail:", tr[-4:], "deaths", before, "->", after)
        pl.shot("07_bumbler_still")

    # try to squish it
    if bum:
        bp = bum[0]["p"]
        pl.say("  trying to squish the bumbler (jump on it)")
        pl.face(bp[0], bp[2]); pl.down("W"); pl.wait(600); pl.tap("SPACE", 120); pl.wait(900); pl.up("W"); pl.wait(600)
        pl.say("  ->", json.dumps(pl.state()), "events", ev(), "snap", json.dumps(snap()))
        pl.shot("08_bumbler_squish_try")

    # ---------------------------------------------------------------- BEAT 2
    pl.say("")
    pl.say("=== BEAT 2  THE QUAY AND THE LOG CROSSING ===")
    r = pl.walk_to(0, 42, tol=1.5, max_ms=14000, tag="cp-riverbank")
    pl.say("  snap", json.dumps(snap()), "events", ev())
    pl.shot("09_cp_riverbank")
    r = pl.walk_to(0, 38.5, tol=1.4, max_ms=9000, tag="quay north edge")
    pl.shot("10_quay_edge")
    pl.say("  at the quay:", json.dumps(pl.state()))

    # look down at the logs
    logs = pl.js("""()=>{const C=CRESTBOUND.game.course; const out=[];
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='sinker') continue;
          for (const c of (h.colliders||[])) out.push({p:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)],
            h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)]}); }
        return out; }""")
    pl.say("  sinker logs:", json.dumps(logs))

    pl.say("  JUMPING the quay->log gap with a real held jump...")
    pl.face(0, 34); pl.down("W"); pl.wait(700)
    pl.down("SPACE"); pl.wait(260); pl.up("SPACE")
    tr = []
    for i in range(10):
        pl.wait(180); q = pl.state(); tr.append((q["pos"], q["pstate"], q["grounded"]))
    pl.up("W"); pl.wait(700)
    pl.say("  jump trail:", tr)
    pl.say("  landed:", json.dumps(pl.state()), "events", ev())
    pl.shot("11_first_log")

    pl.say("  STANDING on the log — does it sink? 6 s sample")
    tr = []
    for i in range(12):
        pl.wait(500); q = pl.state(); tr.append((q["pos"], q["pstate"], q["grounded"], q["inWater"]))
    pl.say("  sink trail:", tr)
    pl.shot("12_log_sinking")
    pl.say("  events", ev(), "deaths", pl.js("()=>CRESTBOUND.game.__deaths"))

    pl.dump("windmill_s1")
    pl.say("CONSOLE:", json.dumps(pl.console[:20]))
