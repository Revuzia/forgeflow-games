#!/usr/bin/env python
"""
Three ways to move the resolution lever; all three must move the buffer.

A settings store has more than one entry point and they are not interchangeable:
the overlay calls `set()`, a harness or an embedder writes `S.x = v` because that
is the obvious thing to write, and a preset button calls `applyPreset()`. If any
one of those does not reach the resize, the lever is dead for whoever happened to
pick that spelling — which is exactly how `S.resolutionScale = 0.5` shipped
looking like it worked.

Each case asserts on `renderer.domElement.width`, never on the settings value:
the whole failure being guarded against is a store that agrees with the write and
a buffer that ignores it.

    python pathcheck.py
"""
import json, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]
URL = "http://localhost:8799/games/snowflow/index.html"

CASES = r"""() => {
  const SF = globalThis.SNOWFLOW;
  const W = () => SF.renderer.domElement.width;
  const out = [];
  const rec = (name, want, extra) => out.push(Object.assign(
      { case: name, want, got: W(), pass: W() === want }, extra || {}));

  SF.applyPreset('ultra');
  rec('baseline applyPreset(ultra)', 1280);

  // 1. The raw property write — the spelling every external tool reaches for.
  SF.S.resolutionScale = 0.5;
  rec('raw  S.resolutionScale = 0.5', 640, { readback: SF.S.resolutionScale });

  SF.S.resolutionScale = 1.0;
  rec('raw  S.resolutionScale = 1.0', 1280);

  // 2. The explicit setter — what the overlay's widgets call.
  SF.set('resolutionScale', 0.75);
  rec('set("resolutionScale", 0.75)', 960);

  // 3. The preset path, including a key that is NOT resolution: `performance`
  //    also drops the deformation field, and a preset that moved the buffer but
  //    not the sim would be half-applied.
  SF.applyPreset('performance');
  rec('applyPreset(performance)', 640, {
      deform: SF.S.deformResolution, mountains: SF.S.showMountains,
      ssr: SF.S.ssr, dof: SF.S.dof, preset: SF.S.preset });

  // 4. Round trip. Presets are documented as total, not differential: stepping
  //    down and back up must restore every key any preset touches, or the label
  //    and the state diverge and the shot battery stops being reproducible.
  SF.applyPreset('ultra');
  rec('round trip -> ultra', 1280, {
      deform: SF.S.deformResolution, mountains: SF.S.showMountains,
      ssr: SF.S.ssr, dof: SF.S.dof, bloom: SF.S.bloom, sharpen: SF.S.sharpen,
      shafts: SF.S.showLightShafts, streaks: SF.S.windStreaks,
      scale: SF.S.resolutionScale, preset: SF.S.preset });

  // 5. Writing the preset NAME is a command, not a label. Anything that treats
  //    it as a label leaves `S.preset` describing settings that are not in force.
  SF.S.preset = 'balanced';
  rec('raw  S.preset = "balanced"', 1088,
      { deform: SF.S.deformResolution, scale: SF.S.resolutionScale });

  // 6. The DOM path — the actual overlay slider, dispatched as a real input
  //    event, because a widget wired to nothing looks identical in a screenshot.
  SF.applyPreset('ultra');
  const rows = document.querySelectorAll('#overlay .row');
  let slider = null;
  for (const r of rows) {
    if (r.textContent.trim().startsWith('Resolution')) {
      slider = r.querySelector('input[type=range]');
    }
  }
  if (slider) {
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    rec('overlay slider -> 0.5', 640);
  } else {
    out.push({ case: 'overlay slider -> 0.5', want: 640, got: null,
               pass: false, note: 'slider not found' });
  }

  // 7. Every preset in the store has a button. A rung with no button reads as
  //    unimplemented from the UI.
  const btns = [...document.querySelectorAll('#overlay .presets button')]
      .map(b => b.textContent);
  const names = Object.keys(SF.PRESETS);
  out.push({ case: 'preset buttons match PRESETS', want: names.join(','),
             got: names.filter(n => btns.includes(n)).join(','),
             pass: names.every(n => btns.includes(n)) });

  SF.applyPreset('ultra');
  return out;
}"""


def main() -> int:
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=90_000)
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.post)"): break
            pg.wait_for_timeout(500)
        rows = pg.evaluate(CASES)
        pg.close(); br.close()

    bad = 0
    for r in rows:
        extra = {k: v for k, v in r.items()
                 if k not in ("case", "want", "got", "pass")}
        print(f"  [{'PASS' if r['pass'] else 'FAIL'}] {r['case']:34} "
              f"want {r['want']}  got {r['got']}"
              + (f"   {json.dumps(extra)}" if extra else ""))
        bad += 0 if r["pass"] else 1
    print(f"\nRESULT: {'OK' if bad == 0 else str(bad) + ' FAILED'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
