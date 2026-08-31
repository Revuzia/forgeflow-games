#!/usr/bin/env python
"""ASCENDANT screenshot battery — the evidence the visual critic judges.

Walks the player to a set of stations along each stage (spawn, each checkpoint,
the set-piece midpoint, the finish approach) and captures a gameplay-framed shot
at each, plus the title screen, the hub and the pause/clear UI. Headed Chrome so
rAF actually runs and the scene is fully lit before the shutter.

    python shots.py                          # every stage, 4 shots each
    python shots.py --stages neon-1,temple-3 --per 6
    python shots.py --ui                     # title / menu / HUD / clear card only
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
SHOTS = os.path.join(HERE, "..", "_shots")
BASE = "http://localhost:8788/games/ascendant/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]

# Place the camera at a station and aim it down the course, then settle.
POSE_JS = r"""
async ([i, n]) => {
  const A = globalThis.ASCENDANT;
  if (!A || !A.game || !A.game.stage) return {error:'no stage'};
  const G = A.game, S = G.stage, P = G.player;
  // ASCENDANT does not publish THREE; borrow the Vector3 ctor off a live vector.
  const T = A.THREE || { Vector3: (P && P.pos ? P.pos.constructor : null) };
  if (!T.Vector3) return {error:'no Vector3'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const pts = [];
  const sp = S.spawnFor ? S.spawnFor(0) : null;
  if (sp && sp.pos) pts.push(sp.pos);
  (S.checkpoints||[]).forEach(c => { const p = c.position || c.pos || (c.mesh && c.mesh.position); if (p) pts.push(p); });
  const fp = S.finish && (S.finish.position || S.finish.pos || (S.finish.mesh && S.finish.mesh.position));
  if (fp) pts.push(fp);
  if (!pts.length) return {error:'no stations'};
  const t = n <= 1 ? 0 : (i / (n - 1)) * (pts.length - 1);
  const i0 = Math.floor(t), i1 = Math.min(pts.length - 1, i0 + 1), f = t - i0;
  const a = pts[i0], b = pts[i1];
  const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
  // stand ON the station itself (2.5 m back was off the platform at several
  // checkpoints - the neon-1 station-1 'shot' was a photo of the player
  // falling into the void at -46 m/s)
  P.__test.teleport(new T.Vector3(x, y + 0.6, z));
  P.__test.setVel(new T.Vector3(0, 0, 0));
  // controller forward = (-sin(yaw), 0, -cos(yaw)): yaw 0 faces -Z, so the old
  // battery shot the course SIDEWAYS. Face +X (down-course): yaw = -PI/2.
  if (P.yaw !== undefined) P.yaw = -Math.PI / 2;
  if (P.pitch !== undefined) P.pitch = -0.06;
  for (let k = 0; k < 40; k++) await frame();     // let lighting/LOD/particles settle
  return {x:+x.toFixed(1), y:+y.toFixed(1), z:+z.toFixed(1), station:i};
}
"""


def wait_ready(pg, needStage=True, timeout=70):
    deadline = time.time() + timeout
    expr = ("!!(globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.stage)"
            if needStage else "!!(globalThis.ASCENDANT && ASCENDANT.game)")
    while time.time() < deadline:
        try:
            if pg.evaluate(expr):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


CLICK_JS = r"""() => {
  const btns = Array.from(document.querySelectorAll('button.asc-btn'));
  for (const want of ['NEW RUN', 'PLAY', 'CONTINUE']) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (b.__activate) b.__activate(); else b.click();
      return want;
    }
  }
  return null;
}"""


def click_play(pg, timeout=25):
    """Click the title's PLAY/NEW RUN and WAIT until the state actually leaves
    'title'. The title lays out asynchronously (webfont + stage numbering), so a
    single click at a fixed delay can fire before the button exists and the game
    silently stays on the title - where input.suspended gates jump but not
    movement, which made feelcheck report a passing game as 8 failures."""
    import time as _t
    deadline = _t.time() + timeout
    while _t.time() < deadline:
        try:
            st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st and st != "title":
            return True
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


if __name__ == "__main__":
    raise SystemExit(main())
