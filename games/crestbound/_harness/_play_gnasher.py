"""GNASHER FORT (verdant-2) PLAYTEST — phase driver.

Usage: python _play_gnasher.py <phase>
Each phase boots fresh, plays one beat, screenshots, prints JSON-ish log.
"""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

PHASE = sys.argv[1] if len(sys.argv) > 1 else "1"
N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2


def enter(pl, course="verdant-2", cp=None):
    """Title -> NEW GAME -> unlock -> goto course."""
    for i in range(200):
        try:
            if pl.js("() => !!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.player)"):
                break
        except Exception:
            pass
        pl.wait(500)
    else:
        raise RuntimeError("CRESTBOUND never booted")
    pl.wait(1200)
    st = pl.state()
    pl.say("boot state:", st["gstate"])
    b = pl.click_title()
    pl.say("title button:", b)
    pl.wait(2500)
    pl.say("after title:", pl.state()["gstate"])
    pl.unlock_all()
    pl.js("(c) => CRESTBOUND.game.__dev.goto(c)", course)
    for _ in range(80):
        pl.wait(400)
        s = pl.state()
        if s["course"] == course and s["gstate"] in ("playing", "card", "cinematic"):
            break
    pl.wait(2500)
    # skip any intro card
    for _ in range(12):
        s = pl.state()
        if s["gstate"] == "playing":
            break
        pl.tap("SPACE"); pl.wait(600)
    pl.wait(800)
    pl.say("entered:", json.dumps(pl.state()))
    return pl.state()


def probe(pl):
    """Everything a player can see/touch near them right now."""
    return pl.js("""() => { const G=CRESTBOUND.game, C=G.course, P=G.player;
      const near = (arr, f, r=14) => (arr||[]).map(f).filter(o => o && Math.hypot(o.p[0]-P.pos.x, o.p[2]-P.pos.z) < r);
      return {
        clock: C && +C.clock.toFixed(2),
        coins: G._collectibles ? G._collectibles.coins : null,
        crests: G.save ? G.save.crestTotal() : null,
        deaths: G.deaths, cp: G.cpIndex,
        hud: (document.querySelector('.cb-hud')||{}).textContent,
      }; }""")


REC = """() => { const G=CRESTBOUND.game, P=G.player, C=G.course;
  if (G.__rec) return 'already';
  G.__rec = [];
  const push = (n) => (...a) => { try { G.__rec.push({e:n, t:+(C?C.clock:0).toFixed(2),
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      a:a.slice(0,2).map(x => (x&&x.id)||(x&&x.def&&x.def.id)||(typeof x==='object'?(x&&x.kind)||'obj':x)) }); } catch(e){} };
  for (const n of ['death','land','jump','wallkick','longjump','backflip','sideflip','dive','pound','poundLand',
                   'bonk','bounce','splash','surface','climbStart','climbEnd','checkpoint','collect','slide','cannonEnter'])
    P.events.on(n, push(n));
  if (C && C.collectibles && C.collectibles.events) for (const n of ['coin','sigil','crest','crestLocked','crestSpawn','coins100','sigilsDone','raceStart','raceFail','raceFinish'])
    C.collectibles.events.on(n, push(n));
  if (C && C.events) for (const n of ['wardenDown','power','trigger','freed','hurt','squish','bounced','hit','down','say','pound'])
    C.events.on(n, push(n));
  if (C && C.critters) for (const cr of (C.critters.list||C.critters.all||[])) { if (cr && cr.events) for (const n of ['freed','pound','hurt','squish','bounced','hit','down','trigger'])
    cr.events.on(n, push('critter:'+n)); }
  return 'ok'; }"""


def rec_on(pl):
    return pl.js(REC)


def rec(pl, clear=True):
    out = pl.js("() => { const r = CRESTBOUND.game.__rec || []; return r; }")
    if clear:
        pl.js("() => { if (CRESTBOUND.game.__rec) CRESTBOUND.game.__rec.length = 0; }")
    return out


def evsum(evs):
    from collections import Counter
    c = Counter(e["e"] for e in evs)
    return dict(c)


DIRECT = ("http://localhost:8788/games/crestbound/index.html"
          "?dev=1&quality=low&autoscale=0&course=verdant-2")


def enter_direct(pl, course="verdant-2"):
    """?dev=1&course= boots straight into the course (boot.js URL PARAMETERS)."""
    for i in range(240):
        try:
            if pl.js("() => !!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.player && CRESTBOUND.game.course)"):
                break
        except Exception:
            pass
        pl.wait(500)
    else:
        raise RuntimeError("CRESTBOUND never booted")
    pl.wait(2000)
    for _ in range(12):
        s = pl.state()
        if s["gstate"] == "playing":
            break
        pl.tap("SPACE"); pl.wait(600)
    pl.wait(600)
    pl.js("() => CRESTBOUND.game.__dev.unlockAll()")
    pl.say("entered(direct):", json.dumps(pl.state()))
    return pl.state()
