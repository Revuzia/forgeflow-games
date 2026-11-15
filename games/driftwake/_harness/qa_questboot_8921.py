# -*- coding: utf-8 -*-
"""
qa_questboot_8921.py -- lane Q boot diagnostic: is the page responsive, how far
did the boot get, and what did the console say? Prints console lines live and
polls responsiveness with a short wait_for_function (a blocked main thread
times it out instead of hanging the probe). Starts its own deep-backlog
server on :8921 (qa_questcore.SERVER_CODE).

    python _harness/qa_questboot_8921.py [seconds]
"""
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://localhost:8921/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]


def main():
    import subprocess
    from pathlib import Path
    from playwright.sync_api import sync_playwright
    from qa_questcore import SERVER_CODE, ROOT
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 90
    srv = subprocess.Popen([sys.executable, "-c", SERVER_CODE, "8921", str(ROOT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    t0 = time.time()
    try:
        run(sync_playwright, secs, t0)
    finally:
        srv.terminate()


def run(sync_playwright, secs, t0):
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("console", lambda m: print("[%5.1f] console.%s: %s" % (
            time.time() - t0, m.type, m.text[:300])))
        pg.on("pageerror", lambda e: print("[%5.1f] PAGEERROR: %s" % (time.time() - t0, e)))
        pg.goto(URL, wait_until="commit", timeout=240000)
        while time.time() - t0 < secs:
            try:
                pg.wait_for_function("() => true", timeout=4000)
                st = pg.evaluate("""() => ({
                    phase: (document.getElementById('boot-phase')||{}).textContent || '',
                    sf: !!globalThis.SNOWFLOW,
                    frozen: globalThis.SNOWFLOW ? SNOWFLOW.S.freezeTime : null,
                    regT: globalThis.SNOWFLOW ? +SNOWFLOW.combat.registry.time.toFixed(2) : null,
                    fps: globalThis.SNOWFLOW && SNOWFLOW.perfStats ? SNOWFLOW.perfStats.fps : null,
                })""")
                print("[%5.1f] responsive %s" % (time.time() - t0, st))
            except Exception as e:
                print("[%5.1f] UNRESPONSIVE (%s)" % (time.time() - t0, str(e).splitlines()[0][:120]))
            time.sleep(4)
        br.close()


if __name__ == "__main__":
    main()
