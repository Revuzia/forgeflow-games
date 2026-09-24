#!/usr/bin/env python
"""civ lane CPU profile (scratch): Size N crowd, CDP sampling profiler, top self-time functions.
  python cpuprof.py RANK [SECONDS]"""
import sys, time, json, collections
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling",
         "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]
rank = int(sys.argv[1]); secs = float(sys.argv[2]) if len(sys.argv) > 2 else 3
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.goto("http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=grideast&seed=7", wait_until="load")
    for _ in range(80):
        if pg.evaluate("() => window.__BT__ && window.__BT__.state().screen") == "slate": break
        time.sleep(0.25)
    time.sleep(1.5)
    pg.evaluate("() => window.__BT__.dismiss()")
    time.sleep(2)
    pg.evaluate("() => { window.__BT__.cheat.noSpawns(true); window.__BT__.cheat.god(true); }")
    if rank: pg.evaluate(f"() => window.__BT__.cheat.rank({rank})")
    for _ in range(20):
        if pg.evaluate("() => window.__BT__.state().screen") == "play": break
        try: pg.evaluate("() => window.__BT__.dismiss()")
        except Exception: pass
        time.sleep(0.6)
    time.sleep(3)
    pg.keyboard.down("KeyW")
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("Profiler.enable"); cdp.send("Profiler.setSamplingInterval", {"interval": 200}); cdp.send("Profiler.start")
    time.sleep(secs)
    prof = cdp.send("Profiler.stop")["profile"]
    pg.keyboard.up("KeyW")
    print("dbg", pg.evaluate("() => window.__BT__.debugCore.scene.getObjectByName('civilians').userData.civ"))
    b.close()
nodes = {n["id"]: n for n in prof["nodes"]}
dt = collections.Counter()
samples, deltas = prof["samples"], prof["timeDeltas"]
for sid, d in zip(samples, deltas): dt[sid] += d
self_by = collections.Counter()
for nid, us in dt.items():
    cf = nodes[nid]["callFrame"]
    url = cf.get("url", "").split("/")[-1].split("?")[0]
    self_by[f'{cf["functionName"] or "(anon)"} @{url}:{cf.get("lineNumber", 0) + 1}'] += us
total = sum(self_by.values())
print("total ms", round(total / 1000, 1))
for k, v in self_by.most_common(28): print(f"{v/1000:8.1f} ms  {100*v/total:5.1f}%  {k}")
civ = sum(v for k, v in self_by.items() if "civilians.ts" in k)
lines = collections.Counter()
for n in prof["nodes"]:
    cf = n["callFrame"]
    if "civilians.ts" in cf.get("url", ""):
        for pt in n.get("positionTicks", []): lines[(cf["functionName"], pt["line"])] += pt["ticks"]
for (fn, ln), t in lines.most_common(25): print("  line", ln, fn, t)
print("civilians.ts self total ms", round(civ / 1000, 1), f"({100*civ/total:.1f}%) over {secs}s")
