"""Real-play probe: squash on land / stretch on jump, and the blink clock.
No seize hook - the REAL controller runs, driven by real key events."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import heroshots as H

JS = r"""
async () => {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine, hero = G.hero, P = G.player;
  E.stop && E.stop();
  const key = (code, down) => {
    const t = document.querySelector('canvas') || window;
    t.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',
      {code, key:code, bubbles:true, cancelable:true}));
    window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',
      {code, key:code, bubbles:true, cancelable:true}));
  };
  const trace = [];
  const step = (n, label) => { for (let i=0;i<n;i++){ G.update(1/120);
      trace.push({f:trace.length, s:P.state, sq:+hero._squash.toFixed(4),
                  sqT:+hero._squashTgt.toFixed(4), bl:+hero._blink.toFixed(4),
                  blT:+hero._blinkT.toFixed(3), y:+P.pos.y.toFixed(3), l:label}); } };
  step(60,'settle');
  key('Space', true); step(6,'jumpdown'); key('Space', false);
  step(300,'air+land');
  // stand still long enough for a blink and an idle look-around
  const blinks = [];
  let prev = hero._blink;
  for (let i=0;i<1400;i++){ G.update(1/120);
     if (hero._blink > prev + 1e-6) blinks.push(+(i/120).toFixed(2));
     prev = hero._blink; }
  const sq = trace.map(t=>t.sq);
  return {minSq: Math.min(...sq), maxSq: Math.max(...sq),
          states: [...new Set(trace.map(t=>t.s))],
          blinksIn11_7s: blinks, blinkCount: blinks.length,
          sample: trace.filter((t,i)=>i%6===0).slice(0,90)};
}
"""

def main():
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=H.HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": 700, "height": 700})
        pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&course=verdant-1",
                wait_until="load", timeout=60000)
        dl = time.time() + 60
        while time.time() < dl:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.hero)"): break
            pg.wait_for_timeout(300)
        H.leave_title(pg); pg.wait_for_timeout(2500)
        r = pg.evaluate(JS)
        br.close()
    json.dump(r, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_r3sq.json"),"w"), indent=1)
    print("squash range: %.3f .. %.3f   (contract: land 0.85, jump 1.12)" % (r["minSq"], r["maxSq"]))
    print("states seen :", r["states"])
    print("blinks in 11.7 s:", r["blinkCount"], r["blinksIn11_7s"][:12])
    print("--- trace (every 6th of the jump) ---")
    for t in r["sample"]:
        if t["l"] != "settle":
            print("  f%-4d %-10s sq=%.3f sqT=%.3f y=%.3f" % (t["f"], t["s"], t["sq"], t["sqT"], t["y"]))
main()
