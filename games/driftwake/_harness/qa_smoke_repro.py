# -*- coding: utf-8 -*-
"""qa_smoke_repro.py -- reproduce audit_combat_smoke.py part A faithfully and
say WHY it can fail (port 8878).

Boots exactly as the smoke does (no ?autoplay, click to start, 3 s settle),
runs the same isolation and the same 48 x 250 ms WALL sample loop, and reports
BOTH the melee-token pool after isolation and the GAME time the wall window
actually bought. Then repeats the same window with the token pool forced empty,
which is the signature under test:

  isolation removes bodies through registry.remove() instead of
  enemies.despawn(), so any §4.2 melee token a removed body held is never
  released -- with an empty pool the next enemy closes to reach and never
  swings, which reads exactly like "closed, no damage".
"""
import json, subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PORT = 8878
URL = f"http://localhost:{PORT}/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

ISOLATE = """(() => {
    const SF = SNOWFLOW, r = SF.combat.registry;
    const pre = { alive: SF.combat.enemies.aliveCount,
                  melee: SF.combat.enemies._meleeFree,
                  ranged: SF.combat.enemies._rangedFree };
    SF.S.combatEnemies = false;
    for (let i = r.count - 1; i >= 0; i--)
        if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    SF.character.health = SF.character.healthMax;
    return { pre, post: { melee: SF.combat.enemies._meleeFree,
                          ranged: SF.combat.enemies._rangedFree } };
})()"""


def run_a(pg, label):
    eid = pg.evaluate("""(() => {
        const c = SNOWFLOW.character;
        return SNOWFLOW.combat.enemies.spawn('rimeImp',
            c.position.x + 4, c.position.z, 1);
    })()""")
    t0 = pg.evaluate("SNOWFLOW.combat.registry.time")
    hp0 = pg.evaluate("SNOWFLOW.character.health")
    wall0 = time.time()
    rows = []
    for _ in range(48):
        pg.wait_for_timeout(250)
        s = pg.evaluate(f"""(() => {{
            const SF = SNOWFLOW, r = SF.combat.registry, c = SF.character;
            const sl = r.slot({eid});
            const d = sl < 0 ? -1 :
                Math.hypot(r.x[sl] - c.position.x, r.z[sl] - c.position.z);
            let st = -1;
            const E = SF.combat.enemies;
            for (let k = 0; k < E.alive.length; k++)
                if (E.alive[k] && E.id[k] === {eid}) {{ st = E.state[k]; break; }}
            return {{ d: +d.toFixed(2), hp: +c.health.toFixed(1), st,
                      melee: E._meleeFree }};
        }})()""")
        rows.append(s)
        if s["hp"] < hp0 - 0.5:
            break
    t1 = pg.evaluate("SNOWFLOW.combat.registry.time")
    states = sorted(set(r["st"] for r in rows))
    print(f"  {label}: samples={len(rows)} wall={time.time()-wall0:.1f}s "
          f"game={t1-t0:.1f}s dmin={min(r['d'] for r in rows if r['d']>=0):.2f} "
          f"hp {hp0:.1f} -> {rows[-1]['hp']} states={states} "
          f"meleeFreeMin={min(r['melee'] for r in rows)}")
    pg.evaluate(f"SNOWFLOW.combat.enemies.despawn({eid})")
    return hp0 - rows[-1]["hp"]


srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                       cwd=str(ROOT), stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=60000)
        end = time.time() + 120
        while time.time() < end:
            try:
                if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.combat"
                               " && SNOWFLOW.combat.enemies)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(3000)
        pg.mouse.click(640, 360)
        iso = pg.evaluate(ISOLATE)
        print("isolation:", json.dumps(iso))
        pg.wait_for_timeout(600)
        d1 = run_a(pg, "A as the smoke runs it")

        # force the leak signature
        pg.evaluate("SNOWFLOW.combat.enemies._meleeFree = 0;"
                    "SNOWFLOW.character.health = SNOWFLOW.character.healthMax;")
        d2 = run_a(pg, "A with the melee pool forced empty")

        # and the control: pool restored
        pg.evaluate("SNOWFLOW.combat.enemies._meleeFree = 2;"
                    "SNOWFLOW.character.health = SNOWFLOW.character.healthMax;")
        d3 = run_a(pg, "A with the pool restored")
        print(f"\ndamage: asRun={d1:.1f}  emptyPool={d2:.1f}  restored={d3:.1f}")
        br.close()
finally:
    srv.terminate()
