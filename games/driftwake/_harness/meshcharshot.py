#!/usr/bin/env python
"""
Mesh-character verification battery — drives every animation state of the GLB
rider and photographs each one, plus the toggle back to the procedural figure,
footprints, and a spell-light shot.

Follows jumpshot.py's pattern: the phase detection lives in a rAF hook inside
the page (a Playwright evaluate round trip is 50-160 ms, longer than half the
states last), which freezes `S.freezeTime` the instant the requested predicate
holds and reports the mesh character's state machine at that instant.

    python meshcharshot.py
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8799/games/driftwake/index.html"
OUT = os.path.join(HERE, "..", "_shots", "meshchar")

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

HEADING = 2.4
STATES = ["idle", "walk", "run", "jump", "fall", "land", "roll", "surf"]

HIDE = """() => {
  for (const sel of ['#boot', '#hint', '#overlay', '#crosshair', '.overlay', '#perf']) {
    document.querySelectorAll(sel).forEach(e => { e.style.display = 'none'; });
  }
}"""

INSTRUMENT = """() => {
  const SF = globalThis.SNOWFLOW;
  const S = SF.S;
  const M = window.__mc = { want: null, got: null, footfalls: 0, frames: 0 };

  M.state = () => {
    const c = SF.character, mc = SF.meshChar;
    return {
      st: mc._state, stT: +mc._stateT.toFixed(3),
      w: Array.from(mc._weights, v => +v.toFixed(3)),
      speed: +c.speed.toFixed(3), surf: +c.surf.toFixed(3),
      lean: +c.lean.toFixed(3), airborne: c.airborne,
      vy: +c.vertVel.toFixed(2), h: +c.airHeight.toFixed(3),
      impact: +c.landImpact.toFixed(3), facing: +c.facing.toFixed(3),
      rotY: +mc.root.rotation.y.toFixed(3), rotZ: +mc.root.rotation.z.toFixed(3),
      meshVisible: mc.mesh.visible, figureVisible: SF.figure.bodyMesh.visible,
    };
  };

  function tick() {
    const c = SF.character, mc = SF.meshChar;
    M.frames++;
    if (c.footfall) M.footfalls++;
    if (M.want && !S.freezeTime) {
      const w = M.want;
      const hit =
        w === 'walk'  ? (!c.airborne && c.surf < 0.1 && c.speed > 1.5 && c.speed < 4.0 && mc._state === 1) :
        w === 'run'   ? (!c.airborne && c.surf < 0.1 && c.speed >= 4.6 && mc._state === 2) :
        w === 'rise'  ? (c.airborne && c.vertVel > 0 && c.airHeight > 0.22 && mc._state === 3) :
        w === 'fall'  ? (c.airborne && c.vertVel < 0 && c.airHeight < 0.30 && c.airHeight > 0.05 && mc._state === 4) :
        w === 'land'  ? (mc._state === 5 && mc._stateT < 0.28) :
        w === 'roll'  ? (mc._state === 6 && mc._stateT > 0.15 && mc._stateT < 0.9) :
        w === 'carve' ? (c.surf > 0.9 && !c.airborne && Math.abs(c.lean) > 0.22) :
        w === 'ollie' ? (c.airborne && c.surf > 0.9 && c.airHeight > 0.35) : false;
      if (hit) { S.freezeTime = true; M.got = w; M.want = null; M.gotState = M.state(); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}"""


def key(pg, code, down):
    pg.evaluate(
        "([c,d]) => window.dispatchEvent(new KeyboardEvent(d?'keydown':'keyup',"
        "{code:c, bubbles:true}))", [code, down])


def catch(pg, phase, out, name, timeout=15.0, settle=900):
    pg.evaluate("(w) => { window.__mc.want = w; window.__mc.got = null; }", phase)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate("() => window.__mc.got"):
            break
        pg.wait_for_timeout(30)
    else:
        print(f"  {name:<22} MISSED ({phase})")
        pg.evaluate("(w) => { window.__mc.want = null; }", None)
        return None
    pg.wait_for_timeout(settle)  # TAA convergence on the held frame
    pg.evaluate(HIDE)
    pg.screenshot(path=os.path.join(out, name))
    st = pg.evaluate("() => window.__mc.gotState")
    pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
    print(f"  {name:<22} st={STATES[st['st']]} w={st['w']} speed={st['speed']}"
          f" surf={st['surf']} lean={st['lean']} vy={st['vy']} h={st['h']}")
    return st


def still(pg, out, name, settle=1000):
    """Freeze, settle, shoot, release — for states that hold on their own."""
    pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
    pg.wait_for_timeout(settle)
    pg.evaluate(HIDE)
    pg.screenshot(path=os.path.join(out, name))
    st = pg.evaluate("() => window.__mc.state()")
    pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
    print(f"  {name:<22} st={STATES[st['st']]} w={st['w']} facing={st['facing']}"
          f" rotY={st['rotY']} meshVis={st['meshVisible']} figVis={st['figureVisible']}")
    return st


def place(pg, x, z, yaw, pitch, dist):
    pg.evaluate("""([x, z, yaw, pitch, dist]) => {
        const SF = globalThis.SNOWFLOW;
        SF.character.position.x = x; SF.character.position.z = z;
        SF.character.position.y = SF.terrain.heightAt(x, z);
        SF.character.velocity.set(0, 0, 0);
        SF.rig.yaw = yaw; SF.rig.pitch = pitch;
        SF.rig.distance = dist; SF.rig.distanceTarget = dist;
    }""", [x, z, yaw, pitch, dist])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--wait", type=float, default=120.0)
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    errors, net404 = [], []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("response", lambda r: net404.append(r.url) if r.status == 404 else None)
        pg.goto(args.url, wait_until="load", timeout=60_000)

        deadline = time.time() + args.wait
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.meshChar && SNOWFLOW.meshChar.mesh"
                           " && document.getElementById('boot').classList.contains('gone'))"):
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        pg.evaluate(HIDE)
        pg.evaluate(INSTRUMENT)

        # ---- 1. idle, front and back --------------------------------------
        print("idle:")
        place(pg, 0, 0, HEADING, 0.24, 4.2)
        pg.wait_for_timeout(1600)
        still(pg, out, "01-idle-back.png")
        # Walk the camera round the front: face the character.
        place(pg, 0, 0, HEADING + 3.14159, 0.24, 4.2)
        pg.wait_for_timeout(1600)
        still(pg, out, "02-idle-front.png")

        # ---- 2. walk, seen in profile (strafe D = travel along camera right)
        print("walk:")
        place(pg, 0, 0, HEADING, 0.22, 6.0)
        pg.wait_for_timeout(1200)
        key(pg, "KeyD", True)
        pg.wait_for_timeout(1400)
        catch(pg, "walk", out, "03-walk-profile.png")
        key(pg, "KeyD", False)

        # ---- 3. walk away from camera (facing check, second angle) ---------
        key(pg, "KeyW", True)
        pg.wait_for_timeout(1400)
        catch(pg, "walk", out, "04-walk-away.png")
        key(pg, "KeyW", False)
        pg.wait_for_timeout(600)

        # ---- 4. run in profile ---------------------------------------------
        print("run:")
        place(pg, 0, 0, HEADING, 0.22, 6.5)
        pg.wait_for_timeout(900)
        key(pg, "ShiftLeft", True)
        key(pg, "KeyD", True)
        pg.wait_for_timeout(1800)
        catch(pg, "run", out, "05-run-profile.png")

        # ---- 5. jump: rise, fall, then the hard-landing roll ---------------
        print("jump/fall/roll (full jump lands at ~0.71 impact -> roll):")
        key(pg, "Space", True)
        catch(pg, "rise", out, "06-jump-rise.png")
        catch(pg, "fall", out, "07-fall.png")
        key(pg, "Space", False)
        catch(pg, "roll", out, "08-roll.png")
        key(pg, "KeyD", False)
        key(pg, "ShiftLeft", False)
        pg.wait_for_timeout(700)

        # ---- 6. soft landing: tap space, cut the rise -> land state --------
        print("soft landing (cut jump -> land):")
        place(pg, 4, 4, HEADING, 0.22, 5.5)
        pg.wait_for_timeout(1100)
        key(pg, "KeyD", True)
        pg.wait_for_timeout(900)
        key(pg, "Space", True)
        pg.wait_for_timeout(60)
        key(pg, "Space", False)
        catch(pg, "land", out, "09-land.png", timeout=8.0)
        key(pg, "KeyD", False)
        pg.wait_for_timeout(600)

        # ---- 7. surf: carve left, carve right, ollie ------------------------
        print("surf (procedural pose layer):")
        place(pg, -10, -10, HEADING, 0.20, 7.0)
        pg.wait_for_timeout(1100)
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            Object.defineProperty(SF.input, 'surf', {
                get: () => true, set: () => {}, configurable: true,
            });
        }""")
        pg.wait_for_timeout(2600)   # build speed on the board
        key(pg, "KeyA", True)       # sustained left carve
        pg.wait_for_timeout(1300)
        stL = catch(pg, "carve", out, "10-carve-left.png")
        key(pg, "KeyA", False)
        pg.wait_for_timeout(900)
        key(pg, "KeyD", True)       # right carve
        pg.wait_for_timeout(1300)
        stR = catch(pg, "carve", out, "11-carve-right.png")
        key(pg, "KeyD", False)
        pg.wait_for_timeout(500)
        key(pg, "Space", True)      # surf ollie — must stay in the surf pose
        catch(pg, "ollie", out, "12-ollie.png", timeout=8.0)
        key(pg, "Space", False)
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            Object.defineProperty(SF.input, 'surf', {
                value: false, writable: true, configurable: true,
            });
        }""")
        pg.wait_for_timeout(1200)
        if stL and stR:
            print(f"  lean L={stL['lean']} R={stR['lean']}  <- must have opposite signs")

        # ---- 8. spell light reaching the character --------------------------
        print("spell 3 nearby:")
        place(pg, 20, 20, HEADING, 0.30, 5.5)
        pg.wait_for_timeout(1600)
        pg.evaluate("() => { globalThis.SNOWFLOW.spells.cast(3); }")
        pg.wait_for_timeout(650)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        pg.wait_for_timeout(900)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "13-spell-light.png"))
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        print("  13-spell-light.png")
        pg.wait_for_timeout(2500)   # let the spell finish

        # ---- 9. the toggle: back to the procedural figure -------------------
        print("toggle S.meshCharacter:")
        place(pg, 24, 24, HEADING + 3.14159, 0.24, 4.2)
        pg.wait_for_timeout(1400)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.meshCharacter = false;"
                    " globalThis.SNOWFLOW.set('meshCharacter', false); }")
        pg.wait_for_timeout(400)
        st = still(pg, out, "14-toggle-figure.png")
        pg.evaluate("() => { globalThis.SNOWFLOW.set('meshCharacter', true); }")
        pg.wait_for_timeout(400)
        st2 = still(pg, out, "15-toggle-mesh.png")
        toggle_ok = (st and not st["meshVisible"] and st["figureVisible"]
                     and st2 and st2["meshVisible"] and not st2["figureVisible"])
        print(f"  toggle round-trip: {'OK' if toggle_ok else 'FAIL'}")

        # ---- 10. footprints under the mesh character ------------------------
        print("footprints:")
        place(pg, 30, 30, HEADING, 0.20, 6.0)
        pg.wait_for_timeout(900)
        ff0 = pg.evaluate("() => window.__mc.footfalls")
        key(pg, "KeyD", True)
        pg.wait_for_timeout(2600)
        key(pg, "KeyD", False)
        pg.wait_for_timeout(1200)
        ff1 = pg.evaluate("() => window.__mc.footfalls")
        pg.evaluate("(hd) => { const SF = globalThis.SNOWFLOW;"
                    " SF.rig.yaw = hd; SF.rig.pitch = 1.05;"
                    " SF.rig.distance = 9.0; SF.rig.distanceTarget = 9.0; }", HEADING)
        pg.wait_for_timeout(3200)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "16-footprints.png"))
        print(f"  footfall edges while walking: {ff1 - ff0}  <- must be > 0")

        # ---- 11. audio still keys off the controller ------------------------
        # A real (trusted) key press unlocks the context; synthetic ones cannot.
        pg.keyboard.press("KeyW")
        pg.wait_for_timeout(800)
        audio = pg.evaluate("""() => {
            const A = globalThis.SNOWFLOW.audio;
            return A && A.ctx ? { state: A.ctx.state, built: true } : { built: false };
        }""")
        print(f"audio after trusted gesture: {audio}")

        final = pg.evaluate("() => window.__mc.state()")
        br.close()

    print(f"\nframes traced {pg and final and '...'}")
    if errors:
        print(f"\n--- CONSOLE/PAGE ERRORS ({len(errors)}) ---")
        for e in errors[:20]:
            print("  " + e[:500])
    n404 = sorted(set(net404))
    if n404:
        print(f"404s: {n404}")
    print("RESULT:", "OK" if not errors else "ERRORS")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
