import sys, json, os, time
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
         "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
js = open(os.path.join(HERE, "probe_paths.js"), encoding="utf-8").read()
maps = sys.argv[1].split(",") if len(sys.argv) > 1 else ["isla_viva", "ashgrid", "deepwood"]
live = float(sys.argv[2]) if len(sys.argv) > 2 else 300
out = []
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 960, "height": 600})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL, wait_until="load", timeout=120000)
    for _ in range(300):
        if pg.evaluate("!!(window.__LC__ && window.__LC__.W)"): break
        pg.wait_for_timeout(400)
    for i, m in enumerate(maps):
        t0 = time.time()
        r = pg.evaluate(js, [11 + i, m, live, 1 / 30])
        r["wall"] = round(time.time() - t0, 1)
        out.append(r)
        print(m, "wall", r["wall"], "expWall", r["expWall"], flush=True)
        for D, row in r["exp"].items():
            print(f"  D={D:>4} n={row['n']:>2} MID useful {row['midUseful']:>2} firstClear {row['midFirstClear']:>2} ends {row['midEnds']:>2} ({row['midMs']} ms) | START useful {row['startUseful']:>2} firstClear {row['startFirstClear']:>2} ends {row['startEnds']:>2} ({row['startMs']} ms)")
        print("  live", r["live"]); print("  census", r["census"], flush=True)
        json.dump({"results": out, "errors": errs}, open(os.path.join(HERE, "paths.json"), "w"))
    br.close()
if errs: print("errors", errs[:4])
