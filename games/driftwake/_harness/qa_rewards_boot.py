# -*- coding: utf-8 -*-
"""qa_rewards_boot.py -- lane R boot diagnostic: polls the loading phase and
prints every console error / page error until SNOWFLOW runs (or times out)."""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8924
QS = sys.argv[2] if len(sys.argv) > 2 else "?autoplay&test"
URL = "http://localhost:%d/games/driftwake/index.html%s" % (PORT, QS)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]


def main():
    from playwright.sync_api import sync_playwright
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from qa_rewards_serve import serve
    stop_server = serve(ROOT, PORT)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: print("PAGEERROR", str(e)[:400], flush=True))
            pg.on("console", lambda m: print("CONSOLE", m.type, m.text[:300], flush=True)
                  if m.type in ("error", "warning") else None)
            pg.add_init_script("window.__raf = 0; (function f(){ window.__raf++; requestAnimationFrame(f); })();")
            t0 = time.time()
            pg.goto(URL, wait_until="domcontentloaded", timeout=900000)
            print("domcontentloaded %.1fs" % (time.time() - t0), flush=True)
            last = None
            limit = float(sys.argv[3]) if len(sys.argv) > 3 else 1200
            while time.time() - t0 < limit:
                st = pg.evaluate("""() => ({
                    sf: !!globalThis.SNOWFLOW,
                    frozen: globalThis.SNOWFLOW ? SNOWFLOW.S.freezeTime : null,
                    boot: ((document.getElementById('boot') || {}).innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
                    vis: document.visibilityState, raf: window.__raf
                })""")
                key = (st["sf"], st["frozen"], st["boot"])
                if key != last:
                    print("%.0fs" % (time.time() - t0), json.dumps(st), flush=True)
                    last = key
                if st["sf"] and st["frozen"] is False:
                    print("RUNNING at %.0fs raf=%d" % (time.time() - t0, st["raf"]), flush=True)
                    break
                pg.wait_for_timeout(5000)
            else:
                print("TIMEOUT", json.dumps(st), flush=True)
            br.close()
    finally:
        stop_server()


if __name__ == "__main__":
    main()
