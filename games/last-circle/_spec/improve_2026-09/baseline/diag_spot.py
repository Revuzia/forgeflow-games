import sys, json, os
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox", "--disable-features=CalculateNativeWinOcclusion"]
js = open(os.path.join(HERE, "diag_spot.js"), encoding="utf-8").read()
seed, mapId = int(sys.argv[1]), sys.argv[2]
spots = json.loads(sys.argv[3])
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 960, "height": 600})
    pg.goto("http://127.0.0.1:8790/games/last-circle/index.html", wait_until="load", timeout=120000)
    for _ in range(300):
        if pg.evaluate("!!(window.__LC__ && window.__LC__.W)"): break
        pg.wait_for_timeout(400)
    res = pg.evaluate(js, [seed, mapId, spots])
    for r in res:
        print(json.dumps({k: v for k, v in r.items() if k not in ("cols", "grid")}))
        for c in r["cols"]: print("     col", c)
        print("     grid (# = cellBlocked, @ = spot, 1.5 m cells):")
        for g in r["grid"]: print("       ", g)
    br.close()
