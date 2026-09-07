"""Decisive race-pad check: read the LIVE pad positions out of collectibles.js,
stand on the start pad, and see whether 'raceStart' fires."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="race")
    for course in ("verdant-1", "verdant-2", "verdant-3"):
        pl.goto(course); pl.wait(1400)
        pads = pl.ev("""()=>{ const C=CRESTBOUND.game._collectibles; if(!C) return 'no collectibles';
            const out=[];
            for (const c of (C.crests||C._crests||[])) {
              if(!c || !c.race) continue;
              const r=c.race;
              const gp=(m)=>m&&m.position?[+m.position.x.toFixed(2),+m.position.y.toFixed(2),+m.position.z.toFixed(2)]:null;
              out.push({id:c.def&&c.def.id, start:gp(r.start), finish:gp(r.finish),
                        startVis:!!(r.start&&r.start.visible), radius:r.radius, keys:Object.keys(r).slice(0,14)});
            }
            return out; }""")
        print("\n%s race pads: %s" % (course, json.dumps(pads)))
        ev = pl.ev("""()=>{ const C=CRESTBOUND.game._collectibles; if(!C||!C.events) return 'no events';
            const G=CRESTBOUND.game; G.__race=[];
            for (const n of ['raceStart','raceFinish','raceFail'])
              C.events.on(n,(d,ms)=>G.__race.push({e:n,id:d&&d.id,ms}));
            return 'hooked'; }""")
        print("   hook:", ev)
        if not isinstance(pads, list): continue
        for pad in pads:
            if not pad.get("start"): continue
            sx, sy, sz = pad["start"]
            # walk onto the pad from 3 m south
            pl.tp(sx, sy + 0.9, sz + 3.0, 0.0); pl.wait(500)
            pl.rec_reset(); pl.walk("w", 900); pl.wait(900)
            got = pl.ev("()=>CRESTBOUND.game.__race")
            s = pl.st()
            print("   crest '%s' start pad %s -> stood at [%.1f %.1f %.1f]  raceEvents %s  raceMs %s" %
                  (pad["id"], pad["start"], s["x"], s["y"], s["z"], json.dumps(got),
                   pl.ev("()=>CRESTBOUND.game.__dev.state().raceMs")))
            # and straight on top of it
            pl.tp(sx, sy + 0.5, sz, 0.0); pl.wait(1200)
            got = pl.ev("()=>CRESTBOUND.game.__race")
            print("      standing dead centre -> raceEvents %s  raceMs %s" %
                  (json.dumps(got), pl.ev("()=>CRESTBOUND.game.__dev.state().raceMs")))
            pl.shot("%s_%s_startpad" % (course, pad["id"]))
    print("\nERRORS:", errs[:8])
    br.close()
