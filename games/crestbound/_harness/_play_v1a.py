"""VERDANT-1 BAILEY MEADOW — leg A: enter through the painting, the meadow,
the bridge, and the human jump chain (P4/P5)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant1")

    print("\n=== ENTER verdant-1 THROUGH THE PAINTING (as a player) ===")
    info = pl.ev("""()=>{ const G=CRESTBOUND.game, g=(G._gates||[]).find(x=>x.course==='verdant-1');
        if(!g) return null;
        G.player.__test.teleport({x:g.exitPos.x,y:g.exitPos.y+0.12,z:g.exitPos.z});
        G.player.__test.setVel({x:0,y:0,z:0});
        const yaw=Math.atan2(-(g.pos.x-g.exitPos.x),-(g.pos.z-g.exitPos.z));
        G.player.__test.setFacing(yaw); if(G.cam){G.cam.yaw=yaw;G.cam._rcHoldT=0;}
        return {unlocked:g.unlocked, sealed:g.sealed}; }""")
    print("   gate:", json.dumps(info))
    pl.wait(600); pl.shot("keep_facing_verdant1_painting")
    pl.down("w")
    for _ in range(40):
        pl.wait(120)
        if pl.ev("()=>CRESTBOUND.game.state==='card'"): break
    pl.up("w"); pl.wait(900)
    print("   after walk-in:", json.dumps(pl.st()))
    pl.shot("course_card")
    pl.ev("""()=>{ const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null)
            .find(x=>/ENTER|BEGIN|GO|PLAY/i.test(x.textContent||''));
        if(b){ if(b.__activate) b.__activate(); else b.click(); return (b.textContent||'').trim(); }
        return null; }""")
    for _ in range(60):
        pl.wait(300)
        if pl.ev("()=>CRESTBOUND.game.state==='playing'"): break
    pl.wait(2500)
    pl.ev("""() => { const R=CRESTBOUND.game.__rec; if(R&&R.hook){ CRESTBOUND.engine.offFrame(R.hook); } CRESTBOUND.game.__rec=null; return 1; }""")
    pl.ev(RECORDER)
    print("   IN COURSE:", json.dumps(pl.st()))
    pl.shot("spawn_bailey_meadow")

    print("\n=== A: run north out of spawn toward the bridge, 6 s of held W ===")
    trail = []
    pl.rec_reset(); pl.down("w")
    for i in range(30):
        pl.wait(200)
        s = pl.st(); trail.append((round(s["z"], 2), round(s["y"], 2), s["st"], s["sp"]))
    pl.up("w"); pl.wait(400)
    print("   z-trail:", trail)
    print("   end:", json.dumps(pl.st()))
    pl.shot("held_W_6s_from_spawn")
    r = pl.rec()
    print("   events:", [(e["t"], e["e"], e.get("d")) for e in r["events"]][:20])

    print("\n=== B: the JUMP CHAIN at a human rhythm (P4/P5) ===")
    for gap in (500, 560, 620, 680, 760, 850):
        pl.tp(0, 2.6, 41, 0)
        r = pl.human_jump_chain(3, run_ms=1100, gap_ms=gap)
        jumps = [e for e in r["events"] if e["e"] == "jump"]
        print("   gap %4d ms -> maxJumpCount %d  jumpEvents %s  apex %.2f m  states %s" %
              (gap, r["maxJump"], [e.get("d") for e in jumps], r["maxY"] - 2.0,
               [x["s"] for x in r["states"]][:14]))
    pl.shot("jump_chain")

    print("\n=== C: apex per press count, from a run-up, gap 660 ms ===")
    for n in (1, 2, 3):
        pl.tp(0, 2.6, 41, 0)
        r = pl.human_jump_chain(n, run_ms=1200, gap_ms=660)
        print("   %d presses -> jumpCount %d, apex %.2f m above the meadow" % (n, r["maxJump"], r["maxY"] - 2.0))

    print("\n=== D: standing-start chain (no run-up) — what a curious player does first ===")
    pl.tp(0, 2.6, 41, 0)
    pl.rec_reset()
    for i in range(3):
        pl.tap("Space", 110); pl.wait(550)
    pl.wait(800)
    r = pl.rec()
    print("   standing 3 taps -> maxJumpCount %d apex %.2f  jumps %s" %
          (r["maxJump"], r["maxY"] - 2.0, [e.get("d") for e in r["events"] if e["e"] == "jump"]))

    print("\nERRORS:", errs[:8])
    br.close()
