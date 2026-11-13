"""Drive probe_match.js against the running scoped server (127.0.0.1:8790).
Usage: python probe_match.py --runs 1:isla_viva:0,1:isla_viva:0 --seconds 1000 --out res.json [--headed]
Each run = seed:mapId:patchSeed. Writes the raw results JSON; analysis is analyse.py.
"""
import sys, json, argparse, time, os
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
         "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", required=True)
    ap.add_argument("--seconds", type=float, default=1000)
    ap.add_argument("--step", type=float, default=1 / 30)
    ap.add_argument("--out", required=True)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--stormoff", action="store_true")
    a = ap.parse_args()
    js = open(os.path.join(HERE, "probe_match.js"), encoding="utf-8").read()
    runs = []
    for r in a.runs.split(","):
        s, m, p = r.split(":")
        runs.append((int(s), m or None, int(p)))
    results = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=not a.headed, args=FLAGS)
        pg = br.new_page(viewport={"width": 960, "height": 600})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto(URL, wait_until="load", timeout=120000)
        for _ in range(300):
            if pg.evaluate("!!(window.__LC__ && window.__LC__.W)"):
                break
            pg.wait_for_timeout(400)
        else:
            print("BOOT FAIL: __LC__ never appeared", errs[:3]); sys.exit(2)
        for (seed, mapId, patch) in runs:
            t0 = time.time()
            res = pg.evaluate(js, [seed, mapId, a.seconds, a.step, patch, 0 if a.stormoff else 1])
            res["patch"] = patch
            res["wallTotal"] = round(time.time() - t0, 1)
            results.append(res)
            print(f"seed {seed} map {res['map']} patch {patch} phase {res['phaseAfterStart']}->{res['phaseAfterLobby']}->{res['phaseEnd']}: simT {res['simT']} over {res['over']} "
                  f"alive {res['matchAlive']} wall {res['wallTotal']} s (sim loop {res['wallS']} s) "
                  f"hashes {[h['h'] for h in res['hashes']]}", flush=True)
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump({"results": results, "errors": errs}, f)
        br.close()
    if errs:
        print("page errors:", errs[:5])

main()
