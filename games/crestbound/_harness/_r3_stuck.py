"""R3 feel lane: is there a state the player can enter and never leave?

Forces each of the CONTRACT Âsection 11 states in turn on open meadow ground, then steps
3 s with NO input and 3 s with the stick fully forward, and reports the state the
hero settles in. A state that never resolves to a normal locomotion state (idle /
run / walk / fall / land / swim*) with either input is a soft-lock.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE, MEADOW

# The 22 states feelshots already drove for real (and watched resolve) are not
# re-forced here; this is the REMAINDER - the ones no move in the battery enters,
# which is exactly where a soft-lock would survive unnoticed. 'run' and
# 'poundHang' ride along as controls.
STATES = ['run', 'poundHang', 'crouch', 'hardLand', 'slopeSlide', 'swimIdle', 'swim',
          'swimDive', 'climb', 'climbKick', 'cannon', 'fly', 'dead']
OK = {'idle','run','fall','land','crouch','crouchwalk','swim','swimIdle','skid','bonk'}

TRY_JS = r"""
(cfg) => {
  const F = window.__FEEL, G = CRESTBOUND.game, p = G.player;
  F.begin({});
  F.place(cfg.p[0], cfg.p[1], cfg.p[2], cfg.yaw);
  F.step(20);
  F.begin({});
  let forced = null, err = null;
  try { p.__test.force(cfg.state); forced = p.state; }
  catch (e) { err = String(e && e.message || e); }
  F.step(150);                              // 2.5 s, hands off the pad
  const idle3 = {st: p.state, g: p.grounded ? 1 : 0, y: +p.pos.y.toFixed(2),
                 sp: +Math.hypot(p.vel.x, p.vel.z).toFixed(2), dead: !!p.dead};
  F.setStick(0, -1, 1);                     // 3 s, stick fully forward
  F.step(150);
  const push3 = {st: p.state, g: p.grounded ? 1 : 0, y: +p.pos.y.toFixed(2),
                 sp: +Math.hypot(p.vel.x, p.vel.z).toFixed(2), dead: !!p.dead};
  F.clearStick();
  return {forced: forced, err: err, idle3: idle3, push3: push3,
          seen: F.samples.map(s => s.st).filter((v, i, a) => v !== a[i-1]).slice(0, 10),
          update_err: F.err.slice(0, 2)};
}
"""

def main():
    out, bad = {}, []
    with sync_playwright() as p:
        br = launch(p, headless=True)
        pg = br.new_page(viewport={"width": 900, "height": 520})
        pg.goto(DEFAULT_URL, wait_until="load", timeout=90_000)
        t = time.time() + 120
        while time.time() < t:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(400)
        leave_title(pg)
        pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
        leave_title(pg, 60); pg.wait_for_timeout(1500)
        assert pg.evaluate(DRIVER_JS) == "ok"
        print("%-13s %-11s %-24s %-24s %s" % ("forced", "took", "after 2.5 s idle", "after 2.5 s fwd", "verdict"))
        print("-" * 104)
        for st in STATES:
            r = pg.evaluate(TRY_JS, dict(MEADOW, state=st))
            out[st] = r
            i3, p3 = r["idle3"], r["push3"]
            stuck = (i3["st"] not in OK and p3["st"] not in OK) and not (st == 'dead' and i3['dead'])
            if r["err"]: verdict = "force rejected"
            elif stuck: verdict = "*** STUCK ***"; bad.append((st, i3["st"], p3["st"]))
            else: verdict = "ok"
            print("%-13s %-11s %-24s %-24s %s" % (
                st, r["forced"] or "-",
                "%s g%d sp%.2f%s" % (i3["st"], i3["g"], i3["sp"], " DEAD" if i3["dead"] else ""),
                "%s g%d sp%.2f%s" % (p3["st"], p3["g"], p3["sp"], " DEAD" if p3["dead"] else ""),
                verdict))
            if r["update_err"]: print("      update threw: %s" % r["update_err"])
        br.close()
    with open(os.path.join(HERE, "_r3_stuck.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nSTUCK STATES: %s" % (bad if bad else "none"))

main()
