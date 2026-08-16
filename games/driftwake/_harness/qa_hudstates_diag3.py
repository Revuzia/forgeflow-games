#!/usr/bin/env python
"""Read the three inputs to the enemybars `show` gate directly, with and
without ?autoplay, so the qa_hudstates A/B/C failure is attributed to a named
condition instead of a guess. Read-only."""
import sys, time, json
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

GATE = """(() => {
    const SF = SNOWFLOW, eb = SF.enemyBars;
    const shell = globalThis.FFG ? globalThis.FFG.shell : null;
    return {
        hasFFG: !!globalThis.FFG,
        shellPhase: shell ? shell.phase : '(no shell)',
        shellUp: !!(shell && shell.phase !== 'playing'),
        inputLocked: SF.input.locked,
        overlayVisible: !!(eb.overlay && eb.overlay.visible),
        ebShow: eb._show,
        containerCls: eb.el ? eb.el.className : null,
    };
})()"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_function("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=120000)
    pg.wait_for_timeout(2500)
    print("as-loaded         ", json.dumps(pg.evaluate(GATE)))
    pg.evaluate("SNOWFLOW.input.locked = true")
    pg.wait_for_timeout(500)
    print("after locked=true ", json.dumps(pg.evaluate(GATE)))
    # what qa_menu does to actually begin a run
    pg.mouse.click(640, 360)
    pg.wait_for_timeout(1500)
    print("after click       ", json.dumps(pg.evaluate(GATE)))
    pg.evaluate("SNOWFLOW.input.locked = true")
    pg.wait_for_timeout(800)
    print("click+locked      ", json.dumps(pg.evaluate(GATE)))
    br.close()
