#!/usr/bin/env python
"""TAB target-cycle battery: nearest -> next -> ... -> DROP -> nearest."""
import sys, time
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

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

    # Clear the field, then plant three enemies at known distances.
    pg.evaluate("""(() => {
        SNOWFLOW.S.combatEnemies = false;
        const r = SNOWFLOW.combat.registry;
        for (let i = r.count - 1; i >= 0; i--) if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    })()""")
    pg.wait_for_timeout(1200)
    ids = pg.evaluate("""(() => {
        const c = SNOWFLOW.character, e = SNOWFLOW.combat.enemies;
        const mk = (d) => e.spawn('rimeImp', c.position.x + d, c.position.z, 1);
        return [mk(8), mk(16), mk(24)];   // near, mid, far
    })()""")
    pg.wait_for_timeout(800)
    # Dummies sit ~12-18 m out and are targetable too; measure the true order.
    order = pg.evaluate("""(() => {
        const r = SNOWFLOW.combat.registry, c = SNOWFLOW.character, out = [];
        for (let i = 0; i < r.count; i++) {
            const k = r.kind[i];
            if (k !== 'enemy' && k !== 'boss' && k !== 'dummy') continue;
            const d = Math.hypot(r.x[i] - c.position.x, r.z[i] - c.position.z);
            if (d <= 40 && r.hp[i] > 0) out.push({id: r.idOf[i], d: +d.toFixed(1), name: r.name[i]});
        }
        out.sort((a, b) => a.d - b.d);
        return out;
    })()""")
    print("targetable, nearest first:", order)
    n = len(order)

    seq = []
    for _ in range(n + 2):                      # full cycle + drop + restart
        pg.keyboard.press("Tab")
        pg.wait_for_timeout(260)
        seq.append(pg.evaluate("SNOWFLOW.combat.targeting.targetId"))
    print("TAB sequence:", seq)

    expect = [o["id"] for o in order] + [-1, order[0]["id"]]
    ok_cycle = seq == expect
    print(("PASS " if ok_cycle else "FAIL ") + "cycle nearest->...->drop->restart | expected", expect)

    # target frame visible on the selected body
    pg.keyboard.press("Tab"); pg.wait_for_timeout(400)
    ui = pg.evaluate("""(() => ({
        tgt: SNOWFLOW.combat.targeting.targetId,
        framed: document.querySelectorAll('#enemybars .eb.tgt').length,
        named: [...document.querySelectorAll('#enemybars .eb.tgt .eb-name')].map(e => e.textContent),
    }))()""")
    ok_ui = ui["framed"] == 1 if ui["tgt"] >= 0 else ui["framed"] == 0
    print(("PASS " if ok_ui else "FAIL ") + "target frame on exactly the selected bar ->", ui)

    # drop-off when the target dies
    tid = pg.evaluate("SNOWFLOW.combat.targeting.targetId")
    if tid >= 0:
        pg.evaluate(f"SNOWFLOW.combat.registry.damage({tid}, 99999, {{}})")
        pg.wait_for_timeout(900)
        after = pg.evaluate("SNOWFLOW.combat.targeting.targetId")
        print(("PASS " if after != tid else "FAIL ") + f"target drops when it dies ({tid} -> {after})")

    # drop-off when the target leaves range
    pg.keyboard.press("Tab"); pg.wait_for_timeout(300)
    tid = pg.evaluate("SNOWFLOW.combat.targeting.targetId")
    if tid >= 0:
        pg.evaluate("(() => { const c = SNOWFLOW.character; c.position.x += 90; })()")
        pg.wait_for_timeout(900)
        after = pg.evaluate("SNOWFLOW.combat.targeting.targetId")
        print(("PASS " if after == -1 else "FAIL ") + f"target drops beyond 40 m ({tid} -> {after})")
    br.close()
