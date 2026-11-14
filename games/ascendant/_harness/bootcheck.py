#!/usr/bin/env python
"""ASCENDANT boot check — the tight feedback loop.

Loads the page once in a real (headed) Chrome so requestAnimationFrame actually
runs, reports every console message, page error, shader compile/link failure and
unhandled rejection, says how far the boot sequence got, dumps the live engine
state, and saves one screenshot.

    python bootcheck.py
    python bootcheck.py --wait 60 --out ../_shots/boot.png --menu

A hidden/occluded browser pane pauses rAF, which makes a perfectly healthy game
look broken — that is why this launches a visible window (see
reference_ffg_preview_verification).
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
DEFAULT_URL = "http://localhost:8788/games/ascendant/index.html?dev=1"

FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

SHADER_MARKERS = (
    "THREE.WebGLProgram", "THREE.WebGLShader", "ERROR:", "gl.getShaderInfoLog",
    "Program Info Log", "VALIDATE_STATUS",
)

STATE_JS = """() => {
  const A = globalThis.ASCENDANT;
  const boot = document.getElementById('boot');
  const nogpu = document.getElementById('nogpu');
  if (!A) return {hasGlobal:false, bootGone: !boot || boot.classList.contains('gone'),
                  nogpu: !!(nogpu && getComputedStyle(nogpu).display !== 'none')};
  const e = A.engine, g = A.game;
  return {
    hasGlobal: true,
    members: Object.keys(A),
    bootGone: !boot || boot.classList.contains('gone'),
    nogpu: !!(nogpu && getComputedStyle(nogpu).display !== 'none'),
    state: g && g.state,
    stageId: g && g.stage && g.stage.def && g.stage.def.id,
    hazards: g && g.stage && g.stage.hazards ? g.stage.hazards.length : null,
    colliders: g && g.stage && g.stage.broadphase && g.stage.broadphase.count
               ? g.stage.broadphase.count : null,
    kills: g && g.stage && g.stage.killVolumes ? g.stage.killVolumes.length : null,
    checkpoints: g && g.stage && g.stage.checkpoints ? g.stage.checkpoints.length : null,
    playerPos: g && g.player ? [ +g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2),
                                 +g.player.pos.z.toFixed(2) ] : null,
    grounded: g && g.player ? !!g.player.grounded : null,
    fps: e && e.stats ? Math.round(e.stats.fps) : null,
    drawCalls: e && e.stats ? e.stats.drawCalls : null,
    tris: e && e.stats ? e.stats.tris : null,
    sceneChildren: e && e.scene ? e.scene.children.length : null,
    canvas: (() => { const c = document.querySelector('canvas');
                     return c ? [c.width, c.height] : null; })(),
  };
}"""



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
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--wait", type=float, default=60.0)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "bootcheck.png"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--menu", action="store_true",
                    help="click PLAY and settle into gameplay before sampling")
    ap.add_argument("--settle", type=float, default=3.0)
    args = ap.parse_args()

    msgs, errors = [], []
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("console", lambda m: msgs.append((m.type, m.text)))
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));"
        )
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            return 2

        ready, deadline = False, time.time() + args.wait
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.engine)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)

        if args.menu and ready:
            # The title PLAY click is also the audio gesture. Find it generically.
            for sel in ["#ui button.asc-btn:visible:has-text('NEW RUN')", "#ui button.asc-btn:visible:has-text('CONTINUE')", "#ui button.asc-btn:visible:has-text('PLAY')", "#ui button.asc-btn.is-primary:visible", "button.asc-btn:visible"]:
                try:
                    el = pg.query_selector(sel)
                    if el:
                        el.click()
                        break
                except Exception:
                    pass
            pg.wait_for_timeout(1200)

        pg.wait_for_timeout(int(args.settle * 1000))

        try:
            state = pg.evaluate(STATE_JS)
        except Exception as e:
            state = {"evalError": str(e)}
        try:
            jserr = pg.evaluate("window.__err || []")
        except Exception:
            jserr = []

        try:
            pg.screenshot(path=os.path.abspath(args.out))
            shot_ok = True
        except Exception as e:
            shot_ok = False
            errors.append("screenshot failed: %s" % e)

        br.close()

    shader = [t for (k, t) in msgs
              if any(m in t for m in SHADER_MARKERS) and k in ("error", "warning")]
    cerr = [t for (k, t) in msgs if k == "error"]

    print("=" * 72)
    print("URL        : %s" % args.url)
    print("global     : %s" % ("YES" if state.get("hasGlobal") else "NO"))
    print("boot gone  : %s" % state.get("bootGone"))
    print("nogpu shown: %s" % state.get("nogpu"))
    print("screenshot : %s -> %s" % (shot_ok, os.path.abspath(args.out)))
    print("-" * 72)
    print(json.dumps(state, indent=2)[:4000])
    print("-" * 72)
    print("console errors (%d):" % len(cerr))
    for t in cerr[:40]:
        print("  ! %s" % t[:400])
    print("page errors (%d):" % len(errors))
    for t in errors[:40]:
        print("  !! %s" % t[:400])
    print("window errors (%d):" % len(jserr))
    for t in jserr[:40]:
        print("  !!! %s" % str(t)[:400])
    print("shader diagnostics (%d):" % len(shader))
    for t in shader[:12]:
        print("  ~ %s" % t[:600])
    print("=" * 72)

    clean = (state.get("hasGlobal") and not errors and not jserr
             and not cerr and not state.get("nogpu"))
    print("VERDICT: %s" % ("BOOTS CLEAN" if clean else "NOT CLEAN"))
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
