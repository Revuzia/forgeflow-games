#!/usr/bin/env python
"""
Mesh-character verification, pass 3 — retakes after the pose tune.

  · carve left/right + ollie close-ups with the softened crouch numbers
  · spell light: cast 3, read the live spell-light position off the material
    uniforms, teleport the rider beside it, freeze — deterministic, no camera
    race against the eruption's lifetime.

    python meshcharshot3.py
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
    return { st: mc._state, speed: +c.speed.toFixed(2), surf: +c.surf.toFixed(3),
             lean: +c.lean.toFixed(3), h: +c.airHeight.toFixed(3) };
  };
  function tick() {
    const c = SF.character;
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
    print(f"  {name:<26} st={STATES[st['st']]} speed={st['speed']}"
          f" surf={st['surf']} lean={st['lean']} h={st['h']}")
    pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")


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

        # ---- carve retakes with the tuned pose ------------------------------
        print("carve retakes (tuned pose):")
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = -60; SF.character.position.z = 20;
            SF.character.position.y = SF.terrain.heightAt(-60, 20);
            SF.character.velocity.set(0, 0, 0);
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.24;
            SF.rig.distance = 6; SF.rig.distanceTarget = 6;
            Object.defineProperty(SF.input, 'surf', {
                get: () => true, set: () => {}, configurable: true,
            });
        }""")
        pg.wait_for_timeout(2600)
        pg.evaluate("() => { window.__mc.want = 'carveL'; window.__mc.got = null; }")
        key(pg, "KeyA", True)
        if wait_got(pg):
            frozen_frame(pg, out, "25-carve-left-tuned.png", 0.75, 0.32, 4.4)
        key(pg, "KeyA", False)
        pg.wait_for_timeout(800)
        pg.evaluate("() => { window.__mc.want = 'carveR'; window.__mc.got = null; }")
        key(pg, "KeyD", True)
        if wait_got(pg):
            frozen_frame(pg, out, "26-carve-right-tuned.png", -0.75, 0.32, 4.4)
        key(pg, "KeyD", False)
        pg.wait_for_timeout(600)
        pg.evaluate("() => { window.__mc.want = 'ollie'; window.__mc.got = null; }")
        key(pg, "Space", True)
        if wait_got(pg, timeout=8.0):
            frozen_frame(pg, out, "27-ollie-tuned.png", 0.9, 0.18, 4.8)
        key(pg, "Space", False)
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            Object.defineProperty(SF.input, 'surf', {
                value: false, writable: true, configurable: true,
            });
        }""")
        pg.wait_for_timeout(1500)

        # ---- spell light, deterministically ---------------------------------
        print("spell light:")
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = -20; SF.character.position.z = 60;
            SF.character.position.y = SF.terrain.heightAt(-20, 60);
            SF.character.velocity.set(0, 0, 0);
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.18;
            SF.rig.distance = 5; SF.rig.distanceTarget = 5;
        }""")
        pg.wait_for_timeout(1600)
        pg.evaluate("() => { globalThis.SNOWFLOW.spells.cast(3); }")
        pg.wait_for_timeout(420)
        light = pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            const u = SF.terrain.material.uniforms;
            const n = u.spellLightCount ? u.spellLightCount.value : 0;
            if (n < 1) return null;
            const p = u.spellLightPos.value;  // flat (x,y,z,radius) per slot
            // Stand the rider 2 m to the light's side, camera square across.
            const c = SF.character;
            c.position.x = p[0] + 2.0; c.position.z = p[2];
            c.position.y = SF.terrain.heightAt(c.position.x, c.position.z);
            SF.rig.yaw = -Math.PI / 2;  // look along -x: light left, rider right
            SF.rig.pitch = 0.12;
            SF.rig.distance = 4.5; SF.rig.distanceTarget = 4.5;
            return { x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2),
                     count: n };
        }""")
        pg.wait_for_timeout(450)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        pg.wait_for_timeout(900)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "28-spell-light.png"))
        cnt = pg.evaluate("() => globalThis.SNOWFLOW.terrain.material.uniforms"
                          ".spellLightCount.value")
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        print(f"  28-spell-light.png       light={light} frozenCount={cnt}")

        br.close()

    if errors:
        print(f"--- ERRORS ({len(errors)}) ---")
        for e in errors[:10]:
            print("  " + e[:300])
    print("RESULT:", "OK" if not errors else "ERRORS")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
