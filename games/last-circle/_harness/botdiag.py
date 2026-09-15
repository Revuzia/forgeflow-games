"""What is a DRY bot actually doing, and does it ever recover?

The baseline said bots spend ~11% of their lives with no usable ammo. The state
machine already scores LOOT 78 and chests 82 when dry, so the question is not
"do they decide to go for ammo" but "do they ever get any".

Per dry EPISODE: how long it lasts, whether it ends in a resupply or in death,
and which states the bot cycled through while dry.
"""
import sys, json, collections
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
  const SLICE = 0.5;
  for (let t = 0; t < seconds; t += SLICE) {
    C.fastForward(SLICE, stepS);
    if (W.match && W.match.over) break;
    const brains = C.brains ? C.brains() : [];
    const row = [];
    for (const b of brains) {
      const a = b.actor;
      if (!a || !a.alive) continue;
      let reserve = 0;
      try { for (const k in a.inventory.ammo) reserve += a.inventory.ammo[k] | 0; } catch (e) {}
      const mag = (a.weapon && a.weapon.magAmmo != null) ? a.weapon.magAmmo : 0;
      let usable = 0;
      try {
        for (const s of a.inventory.slots) if (s && s.kind === "weapon") {
          const d = (window.__LC__.W.K ? null : null);
          usable += (s.mag || 0);
        }
      } catch (e) {}
      row.push({ id: a.id, st: b.state, mag, reserve, slotMags: usable,
                 x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1),
                 hasTarget: !!(b.bb && b.bb.target), moveTo: !!(b.bb && b.bb.moveTo) });
    }
    out.push({ t: +W.t.toFixed(2), row });
  }
  return { samples: out, chestsOpened: (W.debugChests ? W.debugChests().filter(c=>c.opened).length : null),
           chestsTotal: (W.debugChests ? W.debugChests().length : null),
           alive: W.match ? W.match.aliveCount() : null };
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
            res=pg.evaluate(RUN,[sd,secs,1/30])
            eps=collections.defaultdict(list); cur={}
            states_while_dry=collections.Counter()
            seen_last={}
            for s in res["samples"]:
                present=set()
                for r in s["row"]:
                    present.add(r["id"])
                    dry = r["mag"]==0 and r["reserve"]==0
                    if dry:
                        states_while_dry[r["st"]]+=1
                        cur.setdefault(r["id"], s["t"])
                    elif r["id"] in cur:
                        eps[r["id"]].append((s["t"]-cur.pop(r["id"]), "recovered"))
                    seen_last[r["id"]]=s["t"]
                for bid in list(cur):
                    if bid not in present:                      # died while dry
                        eps[bid].append((seen_last.get(bid,s["t"])-cur.pop(bid), "died"))
            allep=[e for v in eps.values() for e in v]
            rec=[d for d,k in allep if k=="recovered"]; died=[d for d,k in allep if k=="died"]
            print(f"\nseed {sd}: dry episodes {len(allep)}   recovered {len(rec)}   DIED WHILE DRY {len(died)}")
            if rec: print(f"   recovery time: median {sorted(rec)[len(rec)//2]:.1f}s  max {max(rec):.1f}s")
            if died: print(f"   time spent dry before dying: median {sorted(died)[len(died)//2]:.1f}s  max {max(died):.1f}s")
            print(f"   chests opened {res['chestsOpened']} / {res['chestsTotal']}   alive@end {res['alive']}")
            print("   states while dry:", dict(states_while_dry.most_common(6)))
        br.close()
main()
