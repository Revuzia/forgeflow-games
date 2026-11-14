# -*- coding: utf-8 -*-
"""qa_tpose_live4.py -- does the boss-kit body carry TWO clips named "death"
(distinct attack variant) or one (slot 7 aliases the core death action)?"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8804
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

JS = """
async (cfg) => {
  const SF = globalThis.SNOWFLOW;
  const E = SF.combat.enemies, v = E.vis, enc = SF.combat.encounters;
  const c = SF.character;
  const reg = SF.combat.registry;
  enc._nextSpawnAt = 1e9; enc._clearAll(); E.clear();
  const id = E.spawn(cfg.key, c.position.x + 3, c.position.z, cfg.level);
  if (id < 0) return { err: "spawn -1" };
  let slot = -1;
  for (let i = 0; i < E.alive.length; i++)
    if (E.alive[i] && E.id[i] === id) { slot = i; break; }
  const t0 = reg.time;
  while (!v._slotInst[slot]) {
    await new Promise(r => requestAnimationFrame(r));
    if (reg.time - t0 > 25) return { err: "inst never bound" };
  }
  const inst = v._slotInst[slot];
  const clips = inst.type.clips.map(cl =>
    ({ name: cl.name, dur: +cl.duration.toFixed(3),
       tracks: cl.tracks.length }));
  const out = {
    key: cfg.key,
    allClips: clips,
    deathClips: clips.filter(cl => cl.name === "death"),
    act4_is_act7: inst.acts[4] === inst.acts[7],
    act4clip_is_act7clip: inst.acts[4] && inst.acts[7]
        ? inst.acts[4].getClip() === inst.acts[7].getClip() : null
  };
  E.clear(); enc._clearAll();
  return out;
}
"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2000)
            pg.evaluate("(r) => SNOWFLOW.enterRealm(r)", "sand")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            r = pg.evaluate(JS, {"key": "50_v2_sand_dune_warden", "level": 8})
            print(json.dumps(r, indent=1), flush=True)
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
