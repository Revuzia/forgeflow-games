#!/usr/bin/env python
"""Enemy ARRIVAL at max zoom-out (Size I, molo/grideast seed 1): 8 walkers via cheat.spawn, frames 2/8/18 rAFs later via __BT__.shot (_shots/popz_*.png) — pop-in + fx enemySpawn dust/ring.  python _harness/scratch/final/spawnpop.py --out <dir>"""
import sys, os, time, argparse, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "view")))
from common import Session, add_common_args, build_url, ensure_play
from viewcheck import level_to
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--out"); a = ap.parse_args()
with Session(a, "popz") as s:
    s.goto(build_url(a.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=1))
    s.wait_bt(60); s.wait_screen(["play", "slate", "draft"], 90); ensure_play(s, 20)
    s.cheat("god", True)
    t_end = time.time() + 30
    while time.time() < t_end:
        st = s.state()
        if st['screen'] == 'draft': s.press('Digit1')
        elif st['drafts']['pending'] <= 0 and st['screen'] == 'play': break
        time.sleep(0.4)
    s.page.mouse.move(640, 360)
    for _ in range(12): s.page.mouse.wheel(0, 120); time.sleep(0.05)
    time.sleep(2.5)
    s.cheat("killAll"); s.cheat("noSpawns", True)
    r = s.js("""async () => { const raf = () => new Promise(r => requestAnimationFrame(r)); const out = [];
      __BT__.cheat.spawn('walker', 8);
      for (const n of [2, 6, 10]) { for (let i = 0; i < n; i++) await raf(); out.push(await __BT__.shot('popz_' + n)); }
      return out; }""")
    print(r)
