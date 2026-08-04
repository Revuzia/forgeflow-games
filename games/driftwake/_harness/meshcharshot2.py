#!/usr/bin/env python
"""
Mesh-character verification, pass 2 — the shots pass 1 could not frame.

  · carve left/right CLOSE: predicate armed BEFORE the steer key goes down (the
    pass-1 left carve froze after the lean transient had settled), and the
    camera is re-aimed while the frame is frozen.
  · ollie close-up.
  · spell 3 seen from the SIDE, so the spell-lit flank faces the camera.
  · the S.meshCharacter toggle through set() only (pass 1 wrote S first, which
    made set() a no-op and tested nothing).

    python meshcharshot2.py
"""
import os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "http://localhost:8799/games/driftwake/index.html"
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
  const M = window.__mc = { want: null, got: null };
  M.state = () => {
    const c = SF.character, mc = SF.meshChar;
    return {
      st: mc._state, speed: +c.speed.toFixed(2), surf: +c.surf.toFixed(3),
      lean: +c.lean.toFixed(3), airborne: c.airborne, h: +c.airHeight.toFixed(3),
      facing: +c.facing.toFixed(3),
      meshVisible: mc.mesh.visible, figureVisible: SF.figure.bodyMesh.visible,
    };
  };
  function tick() {
    const c = SF.character, mc = SF.meshChar;
    if (M.want && !S.freezeTime) {
      const w = M.want;
      const hit =
        w === 'carveL' ? (c.surf > 0.9 && !c.airborne && c.lean < -0.20) :
        w === 'carveR' ? (c.surf > 0.9 && !c.airborne && c.lean > 0.20) :
        w === 'ollie'  ? (c.airborne && c.surf > 0.9 && c.airHeight > 0.45) : false;
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


def wait_got(pg, timeout=18.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate("() => window.__mc.got"):
            return True
        pg.wait_for_timeout(30)
    return False


def frozen_frame(pg, out, name, yaw_off, pitch, dist):
    """Re-aim the rig around the FROZEN character, settle, shoot."""
    pg.evaluate("""([yo, p, d]) => {
        const SF = globalThis.SNOWFLOW;
        SF.rig.yaw = SF.character.facing + yo;
        SF.rig.pitch = p;
        SF.rig.distance = d; SF.rig.distanceTarget = d;
    }""", [yaw_off, pitch, dist])
    pg.wait_for_timeout(900)
    pg.evaluate(HIDE)
    pg.screenshot(path=os.path.join(out, name))
    st = pg.evaluate("() => window.__mc.gotState || window.__mc.state()")
    print(f"  {name:<24} st={STATES[st['st']]} speed={st['speed']} surf={st['surf']}"
          f" lean={st['lean']} h={st['h']}")
    return st


def main() -> int:
    out = os.path.abspath(OUT)
    os.makedirs(out, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.goto(URL, wait_until="load", timeout=60_000)
        deadline = time.time() + 120
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.meshChar && SNOWFLOW.meshChar.mesh"
                           " && document.getElementById('boot').classList.contains('gone'))"):
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        pg.evaluate(HIDE)
        pg.evaluate(INSTRUMENT)

        # ---- surf: pin the button, build speed ------------------------------
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = -30; SF.character.position.z = -30;
            SF.character.position.y = SF.terrain.heightAt(-30, -30);
            SF.character.velocity.set(0, 0, 0);
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.22;
            SF.rig.distance = 6; SF.rig.distanceTarget = 6;
            Object.defineProperty(SF.input, 'surf', {
                get: () => true, set: () => {}, configurable: true,
            });
        }""")
        pg.wait_for_timeout(2800)

        # ---- carve left: predicate armed BEFORE the key ---------------------
        print("carve close-ups:")
        pg.evaluate("() => { window.__mc.want = 'carveL'; window.__mc.got = null; }")
        key(pg, "KeyA", True)
        ok = wait_got(pg)
        if ok:
            frozen_frame(pg, out, "17-carve-left-close.png", 0.0, 0.22, 4.5)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        else:
            print("  17-carve-left-close.png MISSED")
        key(pg, "KeyA", False)
        pg.wait_for_timeout(800)

        # ---- carve right ----------------------------------------------------
        pg.evaluate("() => { window.__mc.want = 'carveR'; window.__mc.got = null; }")
        key(pg, "KeyD", True)
        ok = wait_got(pg)
        if ok:
            frozen_frame(pg, out, "18-carve-right-close.png", 0.0, 0.22, 4.5)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        else:
            print("  18-carve-right-close.png MISSED")
        key(pg, "KeyD", False)
        pg.wait_for_timeout(600)

        # ---- ollie close-up -------------------------------------------------
        pg.evaluate("() => { window.__mc.want = 'ollie'; window.__mc.got = null; }")
        key(pg, "Space", True)
        ok = wait_got(pg, timeout=8.0)
        if ok:
            frozen_frame(pg, out, "19-ollie-close.png", 0.9, 0.15, 5.0)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        else:
            print("  19-ollie-close.png MISSED")
        key(pg, "Space", False)
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            Object.defineProperty(SF.input, 'surf', {
                value: false, writable: true, configurable: true,
            });
        }""")
        pg.wait_for_timeout(1500)

        # ---- spell 3, camera swung to the side after the cast ---------------
        print("spell from the side:")
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = 40; SF.character.position.z = 40;
            SF.character.position.y = SF.terrain.heightAt(40, 40);
            SF.character.velocity.set(0, 0, 0);
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.20;
            SF.rig.distance = 5; SF.rig.distanceTarget = 5;
        }""")
        pg.wait_for_timeout(1600)
        pg.evaluate("() => { globalThis.SNOWFLOW.spells.cast(3); }")
        pg.wait_for_timeout(350)
        # Swing the camera 100 degrees while the eruption stands, then freeze.
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.rig.yaw = 2.4 + 1.75; SF.rig.pitch = 0.14;
            SF.rig.distance = 4.5; SF.rig.distanceTarget = 4.5;
        }""")
        pg.wait_for_timeout(500)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        pg.wait_for_timeout(900)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "20-spell-side.png"))
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        print("  20-spell-side.png")
        pg.wait_for_timeout(2500)

        # ---- the toggle, through set() only ---------------------------------
        print("toggle via set():")
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.rig.yaw = 2.4 + 3.14159; SF.rig.pitch = 0.22;
            SF.rig.distance = 4.2; SF.rig.distanceTarget = 4.2;
        }""")
        pg.wait_for_timeout(1400)
        pg.evaluate("() => { globalThis.SNOWFLOW.set('meshCharacter', false); }")
        pg.wait_for_timeout(500)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        pg.wait_for_timeout(900)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "21-toggle-figure.png"))
        stA = pg.evaluate("() => window.__mc.state()")
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        pg.evaluate("() => { globalThis.SNOWFLOW.set('meshCharacter', true); }")
        pg.wait_for_timeout(500)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        pg.wait_for_timeout(900)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "22-toggle-mesh.png"))
        stB = pg.evaluate("() => window.__mc.state()")
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        okT = (not stA["meshVisible"] and stA["figureVisible"]
               and stB["meshVisible"] and not stB["figureVisible"])
        print(f"  figure-on: mesh={stA['meshVisible']} fig={stA['figureVisible']}"
              f" | mesh-on: mesh={stB['meshVisible']} fig={stB['figureVisible']}"
              f"  -> {'OK' if okT else 'FAIL'}")

        br.close()

    if errors:
        print(f"\n--- ERRORS ({len(errors)}) ---")
        for e in errors[:20]:
            print("  " + e[:400])
    print("RESULT:", "OK" if not errors else "ERRORS")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
