# -*- coding: utf-8 -*-
"""
review_presentation2_8856.py -- follow-up presentation shots (port 8856).

1. Title menu after full load (no autoplay, 30 s wait).
2. Damage floaters: enemy spawned dead-ahead of the CAMERA, damage ticks in
   a rAF loop so a number is always mid-rise when the shot lands.
3. Telegraph windup: brute in view, screenshots each second for 6 s.
4. Boss bar: sand realm, duneWarden (TIER.BOSS -> kind 'boss').
READ-ONLY probe; changes nothing in the repo.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8856
BASE = f"http://localhost:{PORT}/games/driftwake/index.html"
SHOTS = Path(r"C:\Users\TestRun\AppData\Local\Temp\claude"
             r"\C--Users-TestRun-Claude-Claw"
             r"\9e9ff830-6ecf-420d-ba55-625913a5412e\scratchpad\shots")
SHOTS.mkdir(parents=True, exist_ok=True)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]


def shot(pg, name):
    pg.screenshot(path=str(SHOTS / f"{name}.png"))
    print("shot:", name)


def gw(pg, sec):
    pg.evaluate(f"() => window.__gw({sec})")


SETUP_JS = """() => {
  const SF = SNOWFLOW;
  window.__gw = (sec) => new Promise((res) => {
    const reg = SF.combat.registry, t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res(true)
      : requestAnimationFrame(tick);
    tick();
  });
  // World point 12 m ahead of the CAMERA on the ground.
  window.__ahead = (m) => {
    const cam = SF.rig.camera;
    const d = new (SF.character.position.constructor)();
    cam.getWorldDirection(d);
    const x = SF.character.position.x + d.x * m;
    const z = SF.character.position.z + d.z * m;
    return { x, z };
  };
  SF.input.locked = true;
  return { realm: SF.spells.realm };
}"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            # ---- 1. Title menu, fully loaded ----------------------------
            pg0 = br.new_page(viewport={"width": 1280, "height": 720})
            pg0.goto(BASE, wait_until="domcontentloaded")
            pg0.wait_for_timeout(30000)
            shot(pg0, "60_title_loaded_720")
            pg0.close()

            # ---- 2. In game ---------------------------------------------
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(BASE + "?autoplay", wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print("setup:", json.dumps(pg.evaluate(SETUP_JS)))

            # Floaters: imp dead-ahead, damage tick every 0.35 s for 6 s.
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry;
              const realm = SF.spells.realm;
              const fodder = { cold: 'rimeImp', sand: 'duneImp',
                               ash: 'cinderImp' }[realm];
              const p = window.__ahead(10);
              const id = E.spawn(fodder, p.x, p.z, 10);
              await window.__gw(0.15);
              window.__dmgOn = true;
              const loop = async () => {
                while (window.__dmgOn) {
                  if (reg.slot(id) >= 0) reg.damage(id, 7, {});
                  await window.__gw(0.35);
                }
              };
              loop();
              return { realm, fodder, id, slot: reg.slot(id) };
            }""")
            print("floater rig:", json.dumps(out))
            gw(pg, 0.5)
            shot(pg, "61_floaters_live_a")
            gw(pg, 0.7)
            shot(pg, "62_floaters_live_b")
            pg.evaluate("() => { window.__dmgOn = false; }")
            gw(pg, 1.0)
            shot(pg, "63_enemybar_linger")
            pg.evaluate("() => { SNOWFLOW.combat.enemies.clear(); }")

            # Telegraph: brute ahead, woken, shot every second.
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry;
              const realm = SF.spells.realm;
              const brute = { cold: 'glacierBrute', sand: 'duneBrute',
                              ash: 'ashBrute' }[realm] || 'glacierBrute';
              const p = window.__ahead(7);
              let id = E.spawn(brute, p.x, p.z, 10);
              if (id < 0) id = E.spawn('glacierBrute', p.x, p.z, 10);
              await window.__gw(0.15);
              if (reg.slot(id) >= 0) reg.damage(id, 1, {});
              return { realm, brute, id, slot: reg.slot(id) };
            }""")
            print("telegraph rig:", json.dumps(out))
            for k in range(6):
                gw(pg, 1.0)
                shot(pg, f"64_telegraph_{k}")
            pg.evaluate("() => { SNOWFLOW.combat.enemies.clear(); }")

            # ---- 3. Boss bar in sand ------------------------------------
            out = pg.evaluate("""async () => {
              await SNOWFLOW.enterRealm('sand');
              SNOWFLOW.input.locked = true;
              const v = SNOWFLOW.combat.enemies.vis;
              if (v && v.stream) v.stream();
              const t0 = performance.now();
              while ((!v || !v.stats || v.stats.types < 8) &&
                     performance.now() - t0 < 60000) {
                await new Promise(r => setTimeout(r, 500));
              }
              const E = SNOWFLOW.combat.enemies,
                    reg = SNOWFLOW.combat.registry;
              const p = window.__ahead(14);
              const id = E.spawn('duneWarden', p.x, p.z, 12);
              await window.__gw(0.15);
              const s = id >= 0 ? reg.slot(id) : -1;
              if (id >= 0) reg.damage(id, 150, {});
              return { id, slot: s, kind: s >= 0 ? reg.kind[s] : null,
                       name: s >= 0 ? reg.name[s] : null };
            }""")
            print("boss rig:", json.dumps(out))
            gw(pg, 0.4)
            shot(pg, "65_bossbar_sand")
            gw(pg, 3.0)
            shot(pg, "66_bossbar_sand_late")

            br.close()
    finally:
        srv.terminate()
    print("DONE")


if __name__ == "__main__":
    main()
