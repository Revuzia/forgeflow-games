# -*- coding: utf-8 -*-
"""
qa_bootstate_8875.py -- disambiguate bootcheck's `bootGone=False`.

bootcheck.py reports `bootGone` as `#boot` carrying the class `gone`. But
loading.done() REMOVES `#boot` from the DOM six seconds after adding the class
(core/loading.js:54-57), and a removed element makes `getElementById('boot')`
null -- which bootcheck scores exactly the same as "never faded". This samples
the element's presence over time so the two cases separate.

    python qa_bootstate_8875.py
"""
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

URL = "http://localhost:8875/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SAMPLE = """() => {
    const b = document.getElementById('boot');
    return {
        exists: !!b,
        gone: !!(b && b.classList.contains('gone')),
        phase: (document.getElementById('boot-phase') || {}).textContent || '',
        snowflow: !!globalThis.SNOWFLOW,
        motesInPool: globalThis.SNOWFLOW ? !!SNOWFLOW.motes : null,
    };
}"""


def main():
    from playwright.sync_api import sync_playwright
    import json
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=60_000)
        pg.wait_for_function("() => !!globalThis.SNOWFLOW", timeout=120_000)
        for ms in (0, 500, 1000, 2000, 3000, 5000, 8000):
            if ms:
                pg.wait_for_timeout(ms - prev)
            prev = ms
            print(f"t+{ms:>5} ms  {json.dumps(pg.evaluate(SAMPLE))}")
        print("pageerrors:", errs)
        br.close()


if __name__ == "__main__":
    prev = 0
    main()
