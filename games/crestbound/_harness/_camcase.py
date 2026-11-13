#!/usr/bin/env python
"""Screenshot ONE camera case: park Nim at an authored station, force an orbit
yaw, step cam.update by hand (fps-independent) and grab the frame.

    python _camcase.py --course verdant-1 --station cp-rampart --yaw 2.88 --out rampart_hidden.png
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "_shots", "cam")
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
CLICK_JS = r"""() => {
  const words = ['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN'];
  const btns = Array.from(document.querySelectorAll('button,[role=button],.btn'));
  for (const w of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(w) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return w; }
  return null; }"""
STATE = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CASE_JS = r"""
(o) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const cam = G.cam || G.camera, P = G.player, def = G.course && G.course.def;
  const list = [];
  if (def && def.spawn) list.push({id:'spawn', p:def.spawn.p});
  for (const c of ((def && def.checkpoints) || [])) list.push({id:c.id, p:c.p});
  const st = list.filter(s => s.id === o.station)[0];
  if (!st) return {error: 'no station ' + o.station + ' (have ' + list.map(s=>s.id).join(',') + ')'};
  const v = new THREE.Vector3();
  P.__test.teleport(v.set(st.p[0], st.p[1] + 0.05, st.p[2]));
  if (P.__test.setVel) P.__test.setVel(v.set(0,0,0));
  if (P.__test.setFacing) P.__test.setFacing(o.yaw);
  if (cam.snapToPlayer) cam.snapToPlayer();
  cam.__test.setYaw(o.yaw); cam.__test.setPitch(0.22);
  for (let i=0;i<o.steps;i++) cam.update(1/60);
  const cs = cam.__test.state();
  return {ok:true, station: st.id, p: st.p, dist: cs.dist, fade: cs.heroFade,
          mode: cs.mode, pitch: cs.pitch, yaw: cs.yaw, heroFadeOnPlayer: P.heroFade};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--station", default="cp-rampart")
    ap.add_argument("--yaw", type=float, default=2.88)
    ap.add_argument("--steps", type=int, default=45)
    ap.add_argument("--out", default="camcase.png")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        br = None
        for i in range(6):
            try:
                br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
                break
            except Exception:
                time.sleep(10 * (i + 1))
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        for i in range(5):
            try:
                pg.goto(URL, wait_until="load", timeout=180000)
                break
            except Exception:
                time.sleep(15)
        t0 = time.time()
        while time.time() - t0 < 180:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
        t0 = time.time()
        while time.time() - t0 < 180:
            if pg.evaluate(STATE) in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(700)
        t0 = time.time()
        while time.time() - t0 < 180:
            try:
                if pg.evaluate("!!(CRESTBOUND.game.player && CRESTBOUND.game.player.__test)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        if a.course != "keep":
            pg.evaluate("(id) => CRESTBOUND.game.__dev.goto(id)", a.course)
            t0 = time.time()
            while time.time() - t0 < 90:
                if (pg.evaluate(STATE) == "playing"
                        and pg.evaluate("CRESTBOUND.game.courseId") == a.course):
                    break
                pg.wait_for_timeout(300)
            pg.wait_for_timeout(1500)
        res = pg.evaluate(CASE_JS, {"station": a.station, "yaw": a.yaw, "steps": a.steps})
        print(json.dumps(res))
        # let the renderer draw the pose we just composed
        pg.wait_for_timeout(120)
        pg.evaluate(CASE_JS, {"station": a.station, "yaw": a.yaw, "steps": 2})
        pg.wait_for_timeout(120)
        path = os.path.join(OUT, a.out)
        pg.screenshot(path=path, timeout=90000)
        print("wrote %s" % path)
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
