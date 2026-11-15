#!/usr/bin/env python
"""Drive a settings-overlay SLIDER, not `SNOWFLOW.S`, and see what moves.

The sweep writes `SNOWFLOW.S.<key>` directly, which is the only surface both
targets share. But a direct write bypasses `settings.set()`, and therefore every
`onChange` subscriber. A key whose work is done in a subscriber looks dead to
the sweep and alive to a human dragging the slider — and the two builds do not
subscribe to the same keys.

Both overlays build the identical widget from `SCHEMA` (`ui/overlay.js`: a
`.row` holding a `<label>` and an `<input type=range>` whose `oninput` calls
`set(it.k, n)`), so setting the input's value and dispatching `input` is exactly
what a drag does — on either build.

    python probe_ui_slider.py "Dune height" 0.4 1.8
"""
import io, sys, time
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

BOOT = r"""
(() => {
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone'));
  };
  window.__sfChrome = () => {
    for (const s of ['#boot','#hint','#overlay','#crosshair','.overlay','#perf'])
      document.querySelectorAll(s).forEach(e => { e.style.display='none'; });
  };
})();
"""

POSE = """() => { const SF=globalThis.SNOWFLOW,p=SF.character.position;
 p.x=0;p.z=0;p.y=SF.terrain.heightAt(0,0);
 SF.character.velocity.x=SF.character.velocity.y=SF.character.velocity.z=0;
 SF.rig.yaw=2.4;SF.rig.pitch=0.17;SF.rig.distance=SF.rig.distanceTarget=6.2; }"""

# Find the range input whose row label matches, set it, and fire the event the
# widget listens for. Returns the settings key's value afterwards, so a silent
# no-op is visible rather than being reported as a null result.
DRAG = """([label, value]) => {
  const rows = Array.from(document.querySelectorAll('.row'));
  const row = rows.find(r => {
    const l = r.querySelector('label');
    return l && l.textContent.trim() === label;
  });
  if (!row) return {ok: false, why: 'no row labelled ' + label};
  const inp = row.querySelector('input[type=range]');
  if (!inp) return {ok: false, why: 'row has no range input'};
  inp.value = String(value);
  inp.dispatchEvent(new Event('input', {bubbles: true}));
  return {ok: true, readback: row.querySelector('.val')?.textContent};
}"""


def shoot(pg, url, label, value):
    pg.goto(url, wait_until="load", timeout=120_000)
    end = time.time() + 150
    while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    # Same static control the sweep uses.
    pg.evaluate("() => { const S = globalThis.SNOWFLOW.S; S.grainStrength = 0; S.taa = false; }")
    r = pg.evaluate(DRAG, [label, value])
    pg.evaluate(POSE)
    pg.wait_for_timeout(5000)
    pg.evaluate("window.__sfChrome()")
    a = np.asarray(Image.open(io.BytesIO(pg.screenshot())).convert("RGB"), np.float32) / 255
    return r, a


def main():
    label = sys.argv[1]
    values = [float(v) for v in sys.argv[2:]]
    for name, url in TARGETS.items():
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=[
                "--enable-unsafe-webgpu", "--ignore-gpu-blocklist",
                "--use-angle=d3d11", "--disable-gpu-sandbox"])
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.add_init_script(BOOT)
            frames = []
            for v in values:
                r, a = shoot(pg, url, label, v)
                frames.append(a)
                print(f"  {name} {label}={v}: widget {r}  frame mean={a.mean():.5f}")
            br.close()
        d = np.abs(frames[0] - frames[-1])
        print(f"  => {name}: '{label}' {values[0]} -> {values[-1]}  "
              f"mean|d|={d.mean():.6f}  changed_px={(d.max(2) > 2 / 255).mean() * 100:.3f}%\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
