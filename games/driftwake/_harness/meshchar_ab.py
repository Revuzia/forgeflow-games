#!/usr/bin/env python
"""
A/B: freeze one carve frame, photograph the SAME frame with the mesh rider and
with the procedural figure. Answers "is the rider buried, or is the trench just
that deep?" with one variable changed.

    python meshchar_ab.py
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

HIDE = """() => {
  for (const sel of ['#boot', '#hint', '#overlay', '#crosshair', '.overlay', '#perf']) {
    document.querySelectorAll(sel).forEach(e => { e.style.display = 'none'; });
  }
}"""


def key(pg, code, down):
    pg.evaluate(
        "([c,d]) => window.dispatchEvent(new KeyboardEvent(d?'keydown':'keyup',"
        "{code:c, bubbles:true}))", [code, down])


def main() -> int:
    out = os.path.abspath(OUT)
    os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=60_000)
        deadline = time.time() + 120
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.meshChar && SNOWFLOW.meshChar.mesh"
                           " && document.getElementById('boot').classList.contains('gone'))"):
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        pg.evaluate(HIDE)

        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = -60; SF.character.position.z = 20;
            SF.character.position.y = SF.terrain.heightAt(-60, 20);
            SF.character.velocity.set(0, 0, 0);
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.30;
            SF.rig.distance = 5.5; SF.rig.distanceTarget = 5.5;
            Object.defineProperty(SF.input, 'surf', {
                get: () => true, set: () => {}, configurable: true,
            });
        }""")
        pg.wait_for_timeout(2400)
        key(pg, "KeyD", True)
        pg.wait_for_timeout(1000)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        key(pg, "KeyD", False)
        # Re-aim: slightly above and to the side of the frozen carve.
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.rig.yaw = SF.character.facing + 0.7;
            SF.rig.pitch = 0.34;
            SF.rig.distance = 4.2; SF.rig.distanceTarget = 4.2;
        }""")
        pg.wait_for_timeout(900)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "23-ab-mesh.png"))
        pg.evaluate("() => { globalThis.SNOWFLOW.set('meshCharacter', false); }")
        pg.wait_for_timeout(700)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "24-ab-figure.png"))
        pg.evaluate("() => { globalThis.SNOWFLOW.set('meshCharacter', true); }")
        st = pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            const c = SF.character;
            return { speed: +c.speed.toFixed(2), surf: +c.surf.toFixed(2),
                     lean: +c.lean.toFixed(3),
                     y: +c.position.y.toFixed(3),
                     ground: +SF.terrain.heightAt(c.position.x, c.position.z).toFixed(3) };
        }""")
        print("frame:", st)
        br.close()
    print("saved 23-ab-mesh.png / 24-ab-figure.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
