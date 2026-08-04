#!/usr/bin/env python
"""Walk-identity noise floor, for reading the deformDepth / deformBerm rows.

Those two keys cannot be measured from a standing pose — they scale a trench
that has to be cut first — so their captures walk 6 m and look back down the
trail. The walk reintroduces exactly the animation-phase variance the rest of
the sweep removes: the gait, the cloth and the snow-contact stamps all land on a
different phase each run, even though the distance-terminated walk puts the
character at the same world position.

So the deform rows' pixel spans cannot be read against the standing noise floor.
This captures the SAME value three times per target and reports the spread —
that is the number those rows have to clear.

    python probe_walk_noise.py
"""
import io, itertools, sys, time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

TARGETS = {
    "port": "http://localhost:8799/games/driftwake/index.html",
    "ref": "https://snowflow-lilac.vercel.app/",
}
REPEATS = 3
VALUE = 1.0   # deformDepth's own default

BOOT = r"""
(() => {
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone'));
  };
  window.__sfChrome = () => {
    for (const s of ['#boot','#hint','#overlay','.overlay','#perf'])
      document.querySelectorAll(s).forEach(e => { e.style.display='none'; });
  };
})();
"""

POSE = """() => { const SF=globalThis.SNOWFLOW,p=SF.character.position;
 p.x=0;p.z=0;p.y=SF.terrain.heightAt(0,0);
 SF.character.velocity.x=SF.character.velocity.y=SF.character.velocity.z=0;
 SF.rig.yaw=2.4;SF.rig.pitch=0.30;SF.rig.distance=SF.rig.distanceTarget=6.2; }"""


def shoot(pg, url):
    pg.goto(url, wait_until="load", timeout=120_000)
    end = time.time() + 180
    while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    pg.evaluate("(v) => { const S = globalThis.SNOWFLOW.S;"
                " S.grainStrength = 0; S.taa = false; S.deformDepth = v; }", VALUE)
    pg.evaluate(POSE)
    # The same distance-terminated walk sweep.py runs.
    pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown',"
                " {code:'KeyW', bubbles:true}))")
    end = time.time() + 30
    while time.time() < end:
        if pg.evaluate("() => { const p = globalThis.SNOWFLOW.character.position;"
                       " return Math.hypot(p.x, p.z) >= 6.0; }"):
            break
        pg.wait_for_timeout(25)
    pg.evaluate("""() => {
      window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW', bubbles:true}));
      const SF = globalThis.SNOWFLOW;
      SF.rig.yaw += Math.PI; SF.rig.pitch = 0.46;
      SF.rig.distance = SF.rig.distanceTarget = 5.4;
    }""")
    pg.wait_for_timeout(4000)
    pg.evaluate("window.__sfChrome()")
    return np.asarray(Image.open(io.BytesIO(pg.screenshot())).convert("RGB"),
                      np.float32) / 255


def main():
    for name, url in TARGETS.items():
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=[
                "--enable-unsafe-webgpu", "--ignore-gpu-blocklist",
                "--use-angle=d3d11", "--disable-gpu-sandbox"])
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.add_init_script(BOOT)
            frames = [shoot(pg, url) for _ in range(REPEATS)]
            br.close()
        ds = [(float(np.abs(a - b).mean()),
               float((np.abs(a - b).max(2) > 2 / 255).mean() * 100))
              for a, b in itertools.combinations(frames, 2)]
        print(f"  {name}: walk-identity spread over {REPEATS} runs at deformDepth={VALUE}")
        for i, (m, s) in enumerate(ds):
            print(f"      pair {i}: mean|d|={m:.6f}  changed_px={s:.3f}%")
        print(f"    => floor: mean|d|={max(d[0] for d in ds):.6f}  "
              f"changed_px={max(d[1] for d in ds):.3f}%\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
