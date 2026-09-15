"""Measure how well the NPC bots actually play.

Runs headless matches through __LC__.fastForward (deterministic, no rAF) and
samples every bot twice a second. Reports the three complaints as NUMBERS so a
fix can be shown to move them:

  STUCK   alive, in a moving state, and displaced < 0.4 m over 3 s
  DRY     holding a gun with 0 in the mag AND 0 matching reserve — it cannot
          shoot no matter how well it aims
  FIRING  share of samples with the fire input held
"""
import sys, json, argparse
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
URL="http://localhost:8788/games/last-circle/index.html"

RUN = r"""
async ([seed, mapId, seconds, stepS]) => {
  const C = window.__LC__, W = C.W;
  await C.startMatch({ mapId, mode: "solo", seed });
  // let the match settle (actors spawned, loot placed)
  C.fastForward(2, stepS);

  const samples = [];
  const SLICE = 0.5;
  for (let t = 0; t < seconds; t += SLICE) {
    C.fastForward(SLICE, stepS);
    if (W.match && W.match.over) break;
    const row = [];
    for (const a of W.actors) {
      if (!a || !a.alive) continue;
      if (W.player && a === W.player) continue;
      let reserve = 0;
      try { for (const k in a.inventory.ammo) reserve += a.inventory.ammo[k] | 0; } catch (e) {}
      const mag = (a.weapon && a.weapon.magAmmo != null) ? a.weapon.magAmmo : 0;
      row.push({ id: a.id, x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2),
                 mag, reserve, fire: !!(a.input && a.input.fire),
                 wid: a.weapon ? a.weapon.id : null });
    }
    samples.push({ t: +(W.t).toFixed(2), n: row.length, row });
  }
  return { samples, alive: W.match ? W.match.aliveCount() : null,
           over: !!(W.match && W.match.over), t: W.t };
}
"""

def analyse(res):
    samples = res["samples"]
    # per-bot position history for the stuck window (3 s = 6 slices)
    hist, stuck, dry, firing, total = {}, 0, 0, 0, 0
    perbot_dry = {}
    for i, s in enumerate(samples):
        for r in s["row"]:
            total += 1
            h = hist.setdefault(r["id"], [])
            h.append((r["x"], r["z"]))
            if len(h) > 6: h.pop(0)
            if len(h) == 6:
                dx = max(p[0] for p in h) - min(p[0] for p in h)
                dz = max(p[1] for p in h) - min(p[1] for p in h)
                if (dx*dx + dz*dz) ** 0.5 < 0.4: stuck += 1
            if r["mag"] == 0 and r["reserve"] == 0:
                dry += 1; perbot_dry[r["id"]] = perbot_dry.get(r["id"], 0) + 1
            if r["fire"]: firing += 1
    return {"botSamples": total,
            "stuckPct": round(100*stuck/max(1,total), 1),
            "dryPct": round(100*dry/max(1,total), 1),
            "firingPct": round(100*firing/max(1,total), 1),
            "botsEverDry": len(perbot_dry),
            "aliveAtEnd": res["alive"], "simSeconds": round(res["t"],1)}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--map", default="")
    ap.add_argument("--seconds", type=int, default=150)
    a = ap.parse_args()
    seeds = [int(x) for x in a.seeds.split(",") if x.strip()]
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width":1000,"height":640})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:140]))
        pg.goto(URL, wait_until="load", timeout=120000)
        for _ in range(250):
            if pg.evaluate("!!(window.__LC__ && window.__LC__.W)"): break
            pg.wait_for_timeout(400)
        agg=[]
        for s in seeds:
            res = pg.evaluate(RUN, [s, a.map or None, a.seconds, 1/30])
            m = analyse(res); m["seed"]=s; agg.append(m)
            print(f"  seed {s:>3}  bots-sampled {m['botSamples']:>6}  "
                  f"STUCK {m['stuckPct']:>5}%   DRY {m['dryPct']:>5}%   "
                  f"FIRING {m['firingPct']:>5}%   everDry {m['botsEverDry']:>3}  "
                  f"alive@end {m['aliveAtEnd']}")
        n=len(agg)
        print("\n  MEAN      STUCK %.1f%%   DRY %.1f%%   FIRING %.1f%%" % (
            sum(x["stuckPct"] for x in agg)/n, sum(x["dryPct"] for x in agg)/n,
            sum(x["firingPct"] for x in agg)/n))
        br.close()
    if errs: print("  page errors:", errs[:3])

main()
