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
  // Snap to a REAL station: interpolating between checkpoints parked the
  // camera mid-air over hazards (foundry per=3 station 1 landed t=3.5 —
  // inside THE CRUCIBLE's crusher path; every such "shot" was a death card).
  const t = Math.round(n <= 1 ? 0 : (i / (n - 1)) * (pts.length - 1));
  const a = pts[t];
  const x = a.x, y = a.y, z = a.z;
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
  // A station on a conveyor (foundry cp1) carries the player off the edge
  // during the settle - the player dies, respawns at an EARLIER checkpoint,
  // and the "station" shot silently re-frames from the wrong place (round-2
  // battery: foundry-1_1 shot cp0 twice while reporting x=159.3). Re-pin and
  // give the frame a short second settle.
  const dx = P.pos.x - x, dy = P.pos.y - (y + 0.6), dz = P.pos.z - z;
  if (Math.hypot(dx, dy, dz) > 2.0) {
    P.__test.teleport(new T.Vector3(x, y + 0.6, z));
    P.__test.setVel(new T.Vector3(0, 0, 0));
    if (P.yaw !== undefined) P.yaw = -Math.PI / 2;
    if (P.pitch !== undefined) P.pitch = -0.06;
    for (let k = 0; k < 10; k++) await frame();
  }
  return {x:+x.toFixed(1), y:+y.toFixed(1), z:+z.toFixed(1), station:i,
          px:+P.pos.x.toFixed(1), py:+P.pos.y.toFixed(1), pz:+P.pos.z.toFixed(1)};
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


def main() -> int:
    # Restored 2026-08-31: the harness-forensics commit rewrote click_play and
    # accidentally deleted this whole function — shots.py crashed at import
    # time with NameError. Body re-adapted from the last working revision.
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="")
    ap.add_argument("--per", type=int, default=4)
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--ui", action="store_true")
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)
    if args.stages:
        stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    else:
        d = os.path.join(HERE, "..", "runtime", "data", "stages")
        stages = sorted(f[:-3] for f in os.listdir(d) if f.endswith(".js")) if os.path.isdir(d) else []

    taken = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})

        if args.ui:
            pg.goto(f"{BASE}?quality={args.quality}", wait_until="load", timeout=60_000)
            wait_ready(pg, needStage=False)
            pg.wait_for_timeout(2500)
            out = os.path.join(SHOTS, "ui_title.png")
            pg.screenshot(path=out)
            taken.append(out)
            click_play(pg)
            pg.wait_for_timeout(3000)
            out = os.path.join(SHOTS, "ui_hud.png")
            pg.screenshot(path=out)
            taken.append(out)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(900)
            out = os.path.join(SHOTS, "ui_pause.png")
            pg.screenshot(path=out)
            taken.append(out)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(500)
            pg.keyboard.press("Tab")
            pg.wait_for_timeout(1100)
            out = os.path.join(SHOTS, "ui_select.png")
            pg.screenshot(path=out)
            taken.append(out)
            br.close()
            print(json.dumps(taken, indent=2))
            return 0

        for sid in stages:
            url = f"{BASE}?dev=1&quality={args.quality}&stage={sid}"
            try:
                pg.goto(url, wait_until="load", timeout=60_000)
            except Exception as e:
                print(f"{sid}: nav failed {e}")
                continue
            if not wait_ready(pg):
                print(f"{sid}: never loaded")
                continue
            click_play(pg)
            pg.wait_for_timeout(1500)
            # ?stage= only preloads; PLAY lands in the HUB. Drive the dev hook and
            # verify the id, or every "stage" shot is a photo of the hub.
            if sid != "hub":
                try:
                    pg.evaluate("(s)=>ASCENDANT.game.__dev.goto(s)", sid)
                except Exception as e:
                    print(f"{sid}: goto failed {e}")
                    continue
                arrived = False
                deadline = time.time() + 60
                while time.time() < deadline:
                    try:
                        if pg.evaluate("(s)=>!!(ASCENDANT.game.stage && ASCENDANT.game.stage.def && ASCENDANT.game.stage.def.id===s)", sid):
                            arrived = True
                            break
                    except Exception:
                        pass
                    pg.wait_for_timeout(400)
                if not arrived:
                    print(f"{sid}: stage id never became {sid}")
                    continue
            pg.wait_for_timeout(2200)
            for i in range(args.per):
                # Losing pointer lock between stages auto-pauses the game; a
                # paused frame is a shot of the pause menu, not the world
                # (round-2 battery: all three temple-1 "station" shots were the
                # ASCENSION pause card). Unpause before posing.
                for _ in range(6):
                    try:
                        if pg.evaluate("ASCENDANT.game.state") != "paused":
                            break
                        pg.keyboard.press("Escape")
                    except Exception:
                        break
                    pg.wait_for_timeout(350)
                try:
                    info = pg.evaluate(POSE_JS, [i, args.per])
                except Exception as e:
                    print(f"{sid}[{i}]: pose failed {e}")
                    continue
                if isinstance(info, dict) and info.get("error"):
                    print(f"{sid}[{i}]: {info['error']}")
                    continue
                out = os.path.join(SHOTS, f"{sid}_{i}.png")
                try:
                    pg.screenshot(path=out)
                    taken.append(out)
                    print(f"{sid}[{i}] -> {out}  {info}")
                except Exception as e:
                    print(f"{sid}[{i}]: screenshot failed {e}")
        br.close()

    print(f"\n{len(taken)} shots in {os.path.abspath(SHOTS)}")
    return 0 if taken else 1


if __name__ == "__main__":
    raise SystemExit(main())
