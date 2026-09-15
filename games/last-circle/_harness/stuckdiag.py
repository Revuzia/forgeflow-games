"""Genuine stuck = HAS a destination and is not closing on it.

Standing still is not stuck: a camper, a bot channelling a 2 s chest and a bot
healing are all motionless on purpose. So this tracks distance-to-destination
per bot and flags only the ones whose distance fails to fall.
"""
import sys, collections
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
RUN = r"""
async ([seed, seconds, stepS]) => {
  const C = window.__LC__, W = C.W;
  await C.startMatch({ mode: "solo", seed });
  C.fastForward(2, stepS);
  const out = [];
  for (let t = 0; t < seconds; t += 0.5) {
    C.fastForward(0.5, stepS);
    if (W.match && W.match.over) break;
    const row = [];
    for (const b of (C.brains ? C.brains() : [])) {
      const a = b.actor; if (!a || !a.alive) continue;
      const mt = b.bb && b.bb.moveTo;
      row.push({ id: a.id, st: b.state,
                 d: mt ? +Math.hypot(mt.x - a.pos.x, mt.z - a.pos.z).toFixed(2) : null,
                 x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2),
                 y: +a.pos.y.toFixed(2) });
    }
    out.push({ t: +W.t.toFixed(2), row });
  }
  return out;
}
"""
def main():
    seeds=[int(x) for x in (sys.argv[1] if len(sys.argv)>1 else "1,2").split(",")]
    secs=int(sys.argv[2]) if len(sys.argv)>2 else 150
    with sync_playwright() as p:
        br=p.chromium.launch(channel="chrome",headless=False,args=FLAGS)
        pg=br.new_page(viewport={"width":1000,"height":640})
        pg.goto("http://localhost:8788/games/last-circle/index.html",wait_until="load",timeout=120000)
        for _ in range(250):
            if pg.evaluate("!!(window.__LC__ && window.__LC__.W)"): break
            pg.wait_for_timeout(400)
        for sd in seeds:
            samples=pg.evaluate(RUN,[sd,secs,1/30])
            hist=collections.defaultdict(list)   # id -> [(d,x,z,state)]
            stuck_samples=0; total_with_goal=0
            by_state=collections.Counter(); spots=[]
            for s in samples:
                for r in s["row"]:
                    if r["d"] is None: continue
                    total_with_goal+=1
                    h=hist[r["id"]]; h.append((r["d"],r["x"],r["z"],r["st"]))
                    if len(h)>8: h.pop(0)
                    if len(h)==8:
                        # 4 s: destination distance not falling AND barely moved
                        dd = h[0][0]-h[-1][0]
                        moved = max(abs(h[0][1]-h[-1][1]), abs(h[0][2]-h[-1][2]))
                        if dd < 0.5 and moved < 1.0 and h[-1][0] > 3.0:
                            stuck_samples+=1; by_state[r["st"]]+=1
                            if len(spots)<6: spots.append((round(r['x']),round(r['z']),r['st'],r['d']))
            pct = 100*stuck_samples/max(1,total_with_goal)
            print(f"\nseed {sd}: samples with a destination {total_with_goal}")
            print(f"   GENUINELY STUCK (goal not closing for 4 s): {stuck_samples}  = {pct:.1f}%")
            print(f"   by state: {dict(by_state.most_common(6))}")
            print(f"   example spots (x,z,state,distToGoal): {spots}")
        br.close()
main()
