#!/usr/bin/env python
"""CRESTBOUND boot check — the tight feedback loop.

Loads the page once in a REAL (headed) Chrome so requestAnimationFrame actually
runs, reports every console message, page error, shader compile/link failure and
unhandled rejection, says how far the boot sequence got, dumps the live engine
state (CONTRACT §28 state names, course counts, player pose, renderer stats) and
saves one screenshot.

    python bootcheck.py                          # headed, boots into THE KEEP
    python bootcheck.py --course verdant-1       # ?dev=1&course=verdant-1
    python bootcheck.py --headless               # swiftshader (CI boxes)
    python bootcheck.py --title-only             # stop at the title screen
    python bootcheck.py --wait 90 --out ../_shots/boot.png

WHY HEADED BY DEFAULT: a hidden or occluded browser pane pauses rAF, which makes
a perfectly healthy game look broken (reference_ffg_preview_verification). The
`--headless` mode exists for machines with no display; it forces ANGLE's
SwiftShader software rasteriser so WebGL2 still initialises, and it is slow —
treat its fps as meaningless (perfcheck.py makes the same distinction).

VERDICT is "BOOTS CLEAN" only when ALL of these hold:
  * globalThis.CRESTBOUND exists (boot.js published the handle),
  * the #boot splash was dismissed and the #nogpu card is not showing,
  * zero console errors, zero page errors, zero window errors,
  * zero shader compile/link diagnostics,
  * the game reached a live state ('keep' or 'playing'), unless --title-only,
  * at least one frame was rendered after the state settled.

Exit codes: 0 clean · 1 not clean · 2 the page never got far enough to judge.
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
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html"

# Headed Chrome: real d3d11 ANGLE, occlusion detection off (a backgrounded tab
# stops rAF and every measurement in every harness becomes fiction).
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]
# Headless: chromium's bundled build with the software rasteriser. `--use-gl=angle`
# plus `--use-angle=swiftshader` is the only combination that reliably yields a
# WebGL2 context in headless Chromium.
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader",
]

SHADER_MARKERS = (
    "THREE.WebGLProgram", "THREE.WebGLShader", "ERROR:", "gl.getShaderInfoLog",
    "Program Info Log", "VALIDATE_STATUS", "shader", "GLSL",
)

# Console noise that is not a defect: three.js prints its version banner as a
# log (never an error), and Chrome reports the audio-autoplay gesture policy as
# a warning. Only `error` messages are ever counted, so this list is a belt for
# libraries that mis-classify their own info messages.
CONSOLE_IGNORE = (
    "Download the React DevTools",
    "[crestbound] ?mode=",
)

STATE_JS = r"""() => {
  const A = globalThis.CRESTBOUND;
  const boot = document.getElementById('boot');
  const nogpu = document.getElementById('nogpu');
  const bootGone = !boot || boot.classList.contains('gone');
  const nogpuShown = !!(nogpu && getComputedStyle(nogpu).display !== 'none');
  if (!A) return {hasGlobal: false, bootGone, nogpu: nogpuShown};

  const e = A.engine, g = A.game;
  const c = g && g.course;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const len = (v) => (v && typeof v.length === 'number' ? v.length : null);
  const round2 = (v) => (typeof v === 'number' && isFinite(v) ? +v.toFixed(2) : null);

  // Collectible counts come from the live Collectibles instance (CONTRACT §22)
  // when the course built one, else from the def — the def number is what the
  // reach gate reads, so a mismatch between the two is itself a finding.
  const col = c && c.collectibles;
  const def = (c && c.def) || (g && g.def) || null;
  const defCoins = def && Array.isArray(def.coins) ? def.coins.length : null;

  return {
    hasGlobal: true,
    version: A.version || null,
    members: Object.keys(A),
    bootGone, nogpu: nogpuShown,

    /* --- game (CONTRACT §28 state names) --- */
    state: g ? g.state : null,
    courseId: g ? g.courseId : null,
    realmId: g ? g.realmId : null,
    courseName: def ? def.name : null,
    theme: g ? g.themeId : null,
    frames: g ? num(g.frames) : null,
    deaths: g ? num(g.deaths) : null,
    cpIndex: g ? num(g.cpIndex) : null,
    devHook: !!(g && g.__dev),

    /* --- course population --- */
    hazards: c ? len(c.hazards) : null,
    critters: c ? len(c.critters) : null,
    colliders: c && c.broadphase ? num(c.broadphase.count) : null,
    heightfields: c && c.broadphase ? len(c.broadphase.heightfields) : null,
    kills: c ? len(c.killVolumes) : null,
    volumes: c ? len(c.volumes) : null,
    checkpoints: c ? len(c.checkpoints) : null,
    crests: col && col.counts ? num(col.counts.crestsTotal) : (def && def.crests ? def.crests.length : null),
    sigils: col && col.counts ? num(col.counts.sigilsTotal) : (def && def.sigils ? def.sigils.length : null),
    coins: col && col.counts ? num(col.counts.coinsTotal) : defCoins,
    coinsDefEntries: defCoins,
    waters: c ? len(c.waters) : null,
    gates: c ? len(c.gates) : null,
    clock: c ? round2(c.clock) : null,
    bounds: c && c.bounds && c.bounds.min && c.bounds.max
      ? [round2(c.bounds.min.x), round2(c.bounds.min.y), round2(c.bounds.min.z),
         round2(c.bounds.max.x), round2(c.bounds.max.y), round2(c.bounds.max.z)] : null,

    /* --- player --- */
    playerPos: g && g.player && g.player.pos
      ? [round2(g.player.pos.x), round2(g.player.pos.y), round2(g.player.pos.z)] : null,
    playerState: g && g.player ? g.player.state : null,
    playerAnim: g && g.player ? g.player.anim : null,
    grounded: g && g.player ? !!g.player.grounded : null,
    dead: g && g.player ? !!g.player.dead : null,
    speed: g && g.player && g.player.vel
      ? round2(Math.hypot(g.player.vel.x, g.player.vel.z)) : null,
    hero: !!(g && g.hero && g.hero.root),
    cam: g && g.cam ? {mode: g.cam.mode, dist: round2(g.cam.dist),
                       yaw: round2(g.cam.yaw), pitch: round2(g.cam.pitch)} : null,

    /* --- renderer --- */
    fps: e && e.stats ? Math.round(e.stats.fps || 0) : null,
    drawCalls: e && e.stats ? num(e.stats.drawCalls) : null,
    tris: e && e.stats ? num(e.stats.tris) : null,
    frameMs: e && e.stats ? round2(e.stats.frameMs) : null,
    p99Ms: e && e.stats ? round2(e.stats.p99Ms) : null,
    programs: e && e.renderer && e.renderer.info && e.renderer.info.programs
      ? e.renderer.info.programs.length : null,
    geometries: e && e.renderer ? e.renderer.info.memory.geometries : null,
    textures: e && e.renderer ? e.renderer.info.memory.textures : null,
    sceneChildren: e && e.scene ? e.scene.children.length : null,
    dpr: e && e.renderer ? +e.renderer.getPixelRatio().toFixed(2) : null,
    canvas: (() => { const cv = document.querySelector('canvas');
                     return cv ? [cv.width, cv.height] : null; })(),
  };
}"""

# Generic title-screen leaver: any visible button whose text names a start verb
# (the UI kit stamps `cb-btn` + `__activate()`; the fallbacks cover a restyle),
# else Enter. The title lays out asynchronously, so this is called in a loop —
# a single click at a fixed delay races the layout and silently does nothing,
# which is how a game that boots fine gets reported as broken.
CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup']) {
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  }
  return null;
}"""

LIVE_STATES = ("keep", "playing")


def leave_title(pg, timeout=45):
    """Click PLAY (or press Enter) until game.state is a LIVE state.

    'any state other than title' is NOT proof: boot passes through 'loading'
    BEFORE the title exists, so a click that raced the boot would look like a
    success and every later measurement would be of the title screen."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = pg.evaluate("globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state")
        except Exception:
            last = None
        if last in LIVE_STATES:
            return True, last
        if last == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False, last


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND boot check")
    ap.add_argument("--url", default=DEFAULT_URL,
                    help="page URL WITHOUT query (?dev=1 and ?course= are appended)")
    ap.add_argument("--course", default=None,
                    help="boot straight into a course: ?dev=1&course=<id>")
    ap.add_argument("--wait", type=float, default=60.0, help="seconds to wait for the global")
    ap.add_argument("--settle", type=float, default=3.0, help="seconds of gameplay before sampling")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "bootcheck.png"))
    ap.add_argument("--json", default=os.path.join(HERE, "bootcheck.json"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--headless", action="store_true",
                    help="chromium headless + swiftshader (fps is meaningless here)")
    ap.add_argument("--title-only", action="store_true",
                    help="do not click through the title; judge the title screen")
    args = ap.parse_args()

    url = args.url
    if "?" not in url:
        url += "?dev=1"
    if args.course:
        url += "&course=%s" % args.course

    msgs, errors = [], []
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    state, jserr, shot_ok = {}, [], False
    left_title, live_state = False, None

    with sync_playwright() as p:
        if args.headless:
            # HARNESS_NOTES (measured on this box): headless *Chrome* with the
            # d3d11 flags gets the real Intel UHD GPU; only the bundled Chromium
            # needs SwiftShader, which is a CPU rasteriser -- an order of
            # magnitude slower and a different tone response. Try the GPU first
            # and keep SwiftShader as the documented fallback (perfcheck.py has
            # done this since the perf pass; the other gates had not caught up).
            try:
                br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            except Exception as _e:
                print("headless: no hardware Chrome (%s) -> SwiftShader" % str(_e)[:120],
                      file=sys.stderr)
                br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("console", lambda m: msgs.append((m.type, m.text)))
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));"
        )
        try:
            pg.goto(url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        ready, deadline = False, time.time() + args.wait
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.engine && CRESTBOUND.game)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)

        if ready and not args.title_only:
            left_title, live_state = leave_title(pg)

        pg.wait_for_timeout(int(max(0.0, args.settle) * 1000))

        # A frame counter that does not move means rAF is not running: every
        # number sampled below would then describe a frozen game.
        #
        # The window has to outlast ONE frame of the slowest renderer in play.
        # Headless is swiftshader: the full post chain (AO + bloom mips + SMAA)
        # at 720p costs ~2.5 s PER FRAME there, so a fixed 600 ms window reported
        # a perfectly healthy loop as STALLED. Poll instead of sleeping a fixed
        # span: the check still fails a truly dead rAF, it just no longer fails a
        # slow one. Headed (real ANGLE d3d11) keeps a tight budget.
        frame_budget = 20.0 if args.headless else 2.0
        frames_a = frames_b = None
        try:
            frames_a = pg.evaluate("CRESTBOUND.game.frames")
            frames_b = frames_a
            fdead = time.time() + frame_budget
            while time.time() < fdead:
                pg.wait_for_timeout(250)
                frames_b = pg.evaluate("CRESTBOUND.game.frames")
                if isinstance(frames_b, int) and isinstance(frames_a, int) and frames_b > frames_a:
                    break
        except Exception:
            pass

        try:
            state = pg.evaluate(STATE_JS)
        except Exception as e:
            state = {"evalError": str(e)}
        try:
            jserr = pg.evaluate("window.__err || []")
        except Exception:
            jserr = []
        try:
            # swiftshader needs a whole frame (~2.5 s) before the compositor has
            # anything to capture; the 30 s default expires mid-frame.
            pg.screenshot(path=os.path.abspath(args.out),
                          timeout=120_000 if args.headless else 30_000)
            shot_ok = True
        except Exception as e:
            errors.append("screenshot failed: %s" % e)
        br.close()

    advancing = (isinstance(frames_a, int) and isinstance(frames_b, int)
                 and frames_b > frames_a)

    cerr = [t for (k, t) in msgs
            if k == "error" and not any(ig in t for ig in CONSOLE_IGNORE)]
    shader = [t for (k, t) in msgs
              if k in ("error", "warning") and any(m in t for m in SHADER_MARKERS)]

    print("=" * 78)
    print("URL         : %s" % url)
    print("mode        : %s" % ("HEADLESS (hardware Chrome, SwiftShader fallback)"
                                if args.headless else "headed Chrome"))
    print("global      : %s" % ("YES" if state.get("hasGlobal") else "NO"))
    print("boot gone   : %s" % state.get("bootGone"))
    print("nogpu shown : %s" % state.get("nogpu"))
    print("left title  : %s (state %s)" % (left_title, live_state) if not args.title_only
          else "left title  : skipped (--title-only)")
    print("frames      : %s -> %s  (%s)"
          % (frames_a, frames_b, "advancing" if advancing else "STALLED"))
    print("screenshot  : %s -> %s" % (shot_ok, os.path.abspath(args.out)))
    print("-" * 78)
    print(json.dumps(state, indent=2)[:5000])
    print("-" * 78)
    print("console errors (%d):" % len(cerr))
    for t in cerr[:40]:
        print("  ! %s" % t[:400])
    print("page errors (%d):" % len(errors))
    for t in errors[:40]:
        print("  !! %s" % str(t)[:400])
    print("window errors (%d):" % len(jserr))
    for t in jserr[:40]:
        print("  !!! %s" % str(t)[:400])
    print("shader diagnostics (%d):" % len(shader))
    for t in shader[:12]:
        print("  ~ %s" % t[:600])
    print("=" * 78)

    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"url": url, "headless": args.headless, "state": state,
                           "consoleErrors": cerr, "pageErrors": errors,
                           "windowErrors": jserr, "shader": shader,
                           "framesAdvancing": advancing}, f, indent=2)
        except Exception:
            pass

    if not state.get("hasGlobal"):
        print("VERDICT: NOT CLEAN — globalThis.CRESTBOUND never appeared")
        print("RESULT: FAIL")
        return 2

    problems = []
    if not state.get("bootGone"):
        problems.append("the #boot splash never went away")
    if state.get("nogpu"):
        problems.append("the WebGL2 unavailable card is showing")
    if cerr:
        problems.append("%d console error(s)" % len(cerr))
    if errors:
        problems.append("%d page error(s)" % len(errors))
    if jserr:
        problems.append("%d window error(s)" % len(jserr))
    if shader:
        problems.append("%d shader diagnostic(s)" % len(shader))
    if not advancing:
        problems.append("the frame counter did not advance (rAF stalled)")
    if not args.title_only:
        if not left_title:
            problems.append("never reached a live state (stuck at %r)" % (live_state,))
        elif state.get("state") not in LIVE_STATES:
            problems.append("state fell back to %r after settling" % (state.get("state"),))
        if args.course and state.get("courseId") != args.course:
            problems.append("courseId is %r, expected %r" % (state.get("courseId"), args.course))

    clean = not problems
    print("VERDICT: %s" % ("BOOTS CLEAN" if clean else "NOT CLEAN"))
    for p_ in problems:
        print("   X %s" % p_)
    print("RESULT: %s" % ("OK" if clean else "FAIL"))
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
