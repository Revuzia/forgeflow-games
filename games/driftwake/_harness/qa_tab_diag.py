#!/usr/bin/env python
"""Diagnostic for qa_tab's two FAILs: record the LIVE distance order at every
TAB press, plus which pool bars wear the `.tgt` class. Read-only — no game
code is touched, this only observes what qa_tab already exercises."""
import sys, time, json
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

ORDER_JS = """(() => {
    const r = SNOWFLOW.combat.registry, c = SNOWFLOW.character, out = [];
    for (let i = 0; i < r.count; i++) {
        const k = r.kind[i];
        if (k !== 'enemy' && k !== 'boss') continue;
        const d = Math.hypot(r.x[i] - c.position.x, r.z[i] - c.position.z);
        out.push({id: r.idOf[i], d: +d.toFixed(2), hp: r.hp[i]});
    }
    out.sort((a, b) => a.d - b.d);
    return {order: out,
            tgt: SNOWFLOW.combat.targeting.targetId,
            framed: [...document.querySelectorAll('#enemybars .eb.tgt .eb-name')].map(e => e.textContent),
            nFramed: document.querySelectorAll('#enemybars .eb.tgt').length};
})()"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL, wait_until="load", timeout=60000)
    end = time.time() + 120
    while time.time() < end:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.combat && SNOWFLOW.combat.targeting)"): break
        except Exception: pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(3000)
    pg.mouse.click(640, 360)

    pg.evaluate("""(() => {
        SNOWFLOW.S.combatEnemies = false;
        const r = SNOWFLOW.combat.registry;
        for (let i = r.count - 1; i >= 0; i--) if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    })()""")
    pg.wait_for_timeout(1200)
    ids = pg.evaluate("""(() => {
        const c = SNOWFLOW.character, e = SNOWFLOW.combat.enemies;
        const mk = (d) => e.spawn('rimeImp', c.position.x + d, c.position.z, 1);
        return [mk(8), mk(16), mk(24)];
    })()""")
    print("spawned ids:", ids)
    pg.wait_for_timeout(800)
    print("t0 ", json.dumps(pg.evaluate(ORDER_JS)))

    for k in range(6):
        pg.keyboard.press("Tab")
        pg.wait_for_timeout(260)
        print(f"press{k+1}", json.dumps(pg.evaluate(ORDER_JS)))
    br.close()
