# -*- coding: utf-8 -*-
"""
review_presentation_8856.py -- READ-ONLY presentation review probe (port 8856).

Drives the real build: title shell, settings overlay, HUD at 1280x720 and
1920x1080, every spell in all three realms (unlocks pre-granted), enemy
damage feedback (floaters + bars), telegraph windups, boss bar, audio state.
Screenshots land in the session scratchpad. Changes NOTHING in the repo.
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

SETUP_JS = """() => {
  const SF = SNOWFLOW;
  window.__gw = (sec) => new Promise((res) => {
    const reg = SF.combat.registry, t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res(true)
      : requestAnimationFrame(tick);
    tick();
  });
  window.__cast = async (key, waitSec) => {
    SF.character.mana = SF.character.manaMax;
    SF.spells.cast(key);
    await window.__gw(waitSec);
    return { realm: SF.spells.realm, mana: Math.round(SF.character.mana) };
  };
  SF.input.locked = true;              // force play-HUD visible for shots
  [1, 3, 4, 5].forEach((id) => SF.progression.unlocked.add(id));
  return {
    phase: globalThis.FFG && FFG.shell ? FFG.shell.phase : null,
    unlocked: Array.from(SF.progression.unlocked),
    locked: SF.input.locked,
  };
}"""


def shot(pg, name):
    pg.screenshot(path=str(SHOTS / f"{name}.png"))
    print("shot:", name)


def gw(pg, sec):
    pg.evaluate(f"() => window.__gw({sec})")


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
            # ---- Phase 0: title shell (no autoplay) ---------------------
            pg0 = br.new_page(viewport={"width": 1280, "height": 720})
            pg0.goto(BASE, wait_until="domcontentloaded")
            pg0.wait_for_timeout(9000)
            shot(pg0, "00_title_720")
            pg0.close()

            # ---- Phase 1: in game, 1280x720 -----------------------------
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(BASE + "?autoplay", wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print("setup:", json.dumps(pg.evaluate(SETUP_JS)))
            pg.wait_for_timeout(400)
            shot(pg, "01_hud_base_720")

            # Settings overlay (F1 works unlocked).
            pg.keyboard.press("F1")
            pg.wait_for_timeout(600)
            shot(pg, "02_settings_720")
            pg.keyboard.press("F1")
            pg.wait_for_timeout(400)
            pg.evaluate("() => { SNOWFLOW.input.locked = true; }")

            # ---- Phase 2: every spell in COLD ---------------------------
            for key, nm, strike, flight in [
                    (6, "bolt", 0.35, 0.5), (7, "arc", 0.7, 0.5),
                    (1, "wave", 0.7, 0.6), (3, "bloom", 0.7, 0.7),
                    (4, "spikes", 0.7, 0.7), (5, "vortex", 0.7, 1.0)]:
                r = pg.evaluate(f"() => window.__cast({key}, {strike})")
                shot(pg, f"10_cold_{nm}_strike")
                gw(pg, flight)
                shot(pg, f"11_cold_{nm}_flight")
                print(f"cast {nm}:", json.dumps(r))
                gw(pg, 1.2)

            # ---- Phase 3: enemies, floaters, bars, telegraphs -----------
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry, c = SF.character;
              const px = c.position.x, pz = c.position.z;
              const ids = [];
              ids.push(E.spawn('rimeImp', px + 2, pz - 8, 10));
              ids.push(E.spawn('rimeImp', px - 2, pz - 9, 10));
              ids.push(E.spawn('glacierBrute', px, pz - 11, 10));
              await window.__gw(0.1);   // registry slot lands next frame
              for (const id of ids) if (id >= 0) reg.damage(id, 30, {});
              return { ids, alive: E.aliveCount !== undefined
                       ? E.aliveCount : null };
            }""")
            print("spawn cold:", json.dumps(out))
            gw(pg, 0.25)
            shot(pg, "20_cold_floaters_bars")
            gw(pg, 2.0)
            shot(pg, "21_cold_telegraph_a")
            gw(pg, 2.5)
            shot(pg, "22_cold_telegraph_b")

            # Boss bar: shrinebreaker (tier BOSS -> kind 'boss').
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry, c = SF.character;
              const id = E.spawn('shrinebreaker', c.position.x,
                                 c.position.z - 14, 12);
              await window.__gw(0.1);
              if (id >= 0) reg.damage(id, 120, {});
              const s = id >= 0 ? reg.slot(id) : -1;
              return { id, slot: s, kind: s >= 0 ? reg.kind[s] : null,
                       name: s >= 0 ? reg.name[s] : null };
            }""")
            print("spawn boss:", json.dumps(out))
            gw(pg, 0.4)
            shot(pg, "23_cold_bossbar")
            pg.evaluate("() => { SNOWFLOW.combat.enemies.clear(); }")

            # ---- Phase 4: SAND realm ------------------------------------
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
              return { realm: SNOWFLOW.spells.realm,
                       types: v && v.stats ? v.stats.types : null };
            }""")
            print("sand:", json.dumps(out))
            gw(pg, 1.0)
            shot(pg, "30_sand_base")
            for key, nm, strike in [(6, "bolt", 0.4), (1, "wave", 0.8),
                                    (3, "bloom", 0.9), (5, "vortex", 1.2)]:
                pg.evaluate(f"() => window.__cast({key}, {strike})")
                shot(pg, f"31_sand_{nm}")
                gw(pg, 1.2)
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry, c = SF.character;
              const ids = [E.spawn('duneImp', c.position.x + 2,
                                   c.position.z - 8, 10),
                           E.spawn('duneImp', c.position.x - 2,
                                   c.position.z - 9, 10)];
              await window.__gw(0.1);
              for (const id of ids) if (id >= 0) reg.damage(id, 25, {});
              return ids;
            }""")
            print("spawn sand:", json.dumps(out))
            gw(pg, 0.25)
            shot(pg, "32_sand_floaters")
            gw(pg, 3.0)
            shot(pg, "33_sand_telegraph")
            pg.evaluate("() => { SNOWFLOW.combat.enemies.clear(); }")

            # ---- Phase 5: ASH realm -------------------------------------
            out = pg.evaluate("""async () => {
              await SNOWFLOW.enterRealm('ash');
              SNOWFLOW.input.locked = true;
              const v = SNOWFLOW.combat.enemies.vis;
              if (v && v.stream) v.stream();
              const t0 = performance.now();
              while ((!v || !v.stats || v.stats.types < 8) &&
                     performance.now() - t0 < 60000) {
                await new Promise(r => setTimeout(r, 500));
              }
              return { realm: SNOWFLOW.spells.realm,
                       types: v && v.stats ? v.stats.types : null };
            }""")
            print("ash:", json.dumps(out))
            gw(pg, 1.0)
            shot(pg, "40_ash_base")
            for key, nm, strike in [(6, "bolt", 0.4), (1, "wave", 0.8),
                                    (4, "spikes", 0.9), (5, "vortex", 1.2)]:
                pg.evaluate(f"() => window.__cast({key}, {strike})")
                shot(pg, f"41_ash_{nm}")
                gw(pg, 1.2)
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry, c = SF.character;
              const ids = [E.spawn('cinderImp', c.position.x + 2,
                                   c.position.z - 8, 10),
                           E.spawn('cinderImp', c.position.x - 2,
                                   c.position.z - 9, 10)];
              await window.__gw(0.1);
              for (const id of ids) if (id >= 0) reg.damage(id, 25, {});
              return ids;
            }""")
            print("spawn ash:", json.dumps(out))
            gw(pg, 0.25)
            shot(pg, "42_ash_floaters")
            gw(pg, 3.0)
            shot(pg, "43_ash_telegraph")

            # ---- Phase 6: audio state -----------------------------------
            audio = pg.evaluate("""() => {
              const F = globalThis.FFG || {};
              const SF = SNOWFLOW;
              return {
                musicStatus: F.musicStatus ? F.musicStatus() : null,
                sfxPresent: !!SF.sfx,
                sfxKeys: SF.sfx ? Object.keys(SF.sfx).slice(0, 30) : null,
                musicVolume: F.shell ? F.shell.musicVolume : null,
                sfxVolume: F.sfxVolume !== undefined ? F.sfxVolume : null,
              };
            }""")
            print("audio:", json.dumps(audio))

            # ---- Phase 7: 1920x1080 pass --------------------------------
            pg.set_viewport_size({"width": 1920, "height": 1080})
            pg.evaluate("() => { SNOWFLOW.input.locked = true; }")
            gw(pg, 0.5)
            shot(pg, "50_hud_base_1080")
            pg.evaluate("() => window.__cast(1, 0.7)")
            shot(pg, "51_spell_1080")
            out = pg.evaluate("""async () => {
              const SF = SNOWFLOW, E = SF.combat.enemies,
                    reg = SF.combat.registry, c = SF.character;
              const id = E.spawn('cinderImp', c.position.x,
                                 c.position.z - 9, 10);
              await window.__gw(0.1);
              if (id >= 0) reg.damage(id, 25, {});
              return id;
            }""")
            gw(pg, 0.25)
            shot(pg, "52_floaters_1080")

            br.close()
    finally:
        srv.terminate()
    print("DONE. shots ->", SHOTS)


if __name__ == "__main__":
    main()
