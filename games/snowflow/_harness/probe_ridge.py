#!/usr/bin/env python
"""Make `mountainHeight` observable, then compare the two builds on it.

At default settings the far range is there but nearly invisible: the scene's own
haze (`fogDensity` 0.0072 with a 22 m scale height) leaves a 2 km massif at 10-45
km as a few hundred faint pixels, so moving `mountainHeight` between 0 and 2400
changes ~0.4% of the frame — level with this harness's noise floor. That is a
coverage problem, not a result: it cannot distinguish "the port lost the setting"
from "the pose cannot see it".

So this clears the haze (`fogDensity = 0`), frames the horizon (12-far-range) and
sweeps the range height there. Identical treatment on both targets.

    python probe_ridge.py
"""
import io, sys, time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

TARGETS = {
    "port": "http://localhost:8799/games/snowflow/index.html",
    "ref": "https://snowflow-lilac.vercel.app/",
}
VALUES = [0, 1200, 2400]

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
 SF.rig.yaw=2.9;SF.rig.pitch=-0.10;SF.rig.distance=SF.rig.distanceTarget=9.5; }"""


def shoot(pg, url, height):
    pg.goto(url, wait_until="load", timeout=120_000)
    end = time.time() + 180
    while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    pg.evaluate("""(h) => {
      const S = globalThis.SNOWFLOW.S;
      S.grainStrength = 0; S.taa = false;   // static control, as the sweep uses
      S.fogDensity = 0;                     // clear the haze hiding the range
      S.aerialStrength = 0;
      S.mountainHeight = h;
    }""", height)
    pg.evaluate(POSE)
    pg.wait_for_timeout(5000)
    pg.evaluate("window.__sfChrome()")
    return np.asarray(Image.open(io.BytesIO(pg.screenshot())).convert("RGB"),
                      np.float32) / 255


def main():
    out = {}
    for name, url in TARGETS.items():
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=[
                "--enable-unsafe-webgpu", "--ignore-gpu-blocklist",
                "--use-angle=d3d11", "--disable-gpu-sandbox"])
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.add_init_script(BOOT)
            frames = []
            for h in VALUES:
                a = shoot(pg, url, h)
                frames.append(a)
                Image.fromarray((a * 255).astype("uint8")).save(
                    f"../_shots/sweep/ridge_{h}_{name}.png")
                print(f"  {name} mountainHeight={h}: mean={a.mean():.5f}")
                sys.stdout.flush()
            br.close()
        d = np.abs(frames[0] - frames[-1])
        out[name] = (float(d.mean()), float((d.max(2) > 2 / 255).mean() * 100))
        print(f"  => {name}: 0 -> {VALUES[-1]}  mean|d|={out[name][0]:.6f}  "
              f"changed_px={out[name][1]:.3f}%\n")
    if len(out) == 2:
        p, r = out["port"][1], out["ref"][1]
        print(f"port/ref changed-pixel ratio: {p / r:.2f}x" if r else "reference did not move")
    return 0


if __name__ == "__main__":
    sys.exit(main())
