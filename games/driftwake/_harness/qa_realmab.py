#!/usr/bin/env python
"""Pixel-ALIGNED three-realm A/B: same camera, same pose, frozen clock.

`realmswitch.py` screenshots each realm after 120 live frames, during which the
character keeps surfing -- so the three frames are from three different camera
positions and any pixel comparison between them is meaningless. That is fine for
"does the swap work" and useless for "is this the same world retinted", which is
the actual question the realm work has to answer.

This pins the pose: it records the camera transform and the character position
once, sets `S.freezeTime` (main.js:1061 -- dt becomes exactly 0, so the frame is
pixel-stable rather than slowly drifting), and restores the transform after every
swap before the shutter. What is left between the three PNGs is the realm and
nothing else, which makes a cross-correlation of their high-passed micro-relief
an actual measurement:

    corr ~ 1  the two realms carry literally the same surface, retinted
    corr ~ 0  the micro-relief was genuinely re-authored per realm

    python _harness/qa_realmab.py
"""
import json
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.enterRealm || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

CAPTURE = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  return { cp: c.position.toArray(), cq: c.quaternion.toArray(),
           chp: ch.position.toArray() };
}"""

RESTORE = """(P) => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  ch.position.fromArray(P.chp);
  c.position.fromArray(P.cp);
  c.quaternion.fromArray(P.cq);
  c.updateMatrixWorld(true);
  return { cp: c.position.toArray().map(v => +v.toFixed(3)) };
}"""

# Chrome-hide, so the HUD and the FFG shell buttons do not land in the crop and
# get measured as terrain.
CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay',
                     '#boot','.ffg-controls','#xp','#floaters','#enemybars']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""


def main():
    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto("http://localhost:8788/games/driftwake/index.html?v=rab",
                wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=200_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=90_000)

        frames(60)
        pg.evaluate(CHROME)
        pose = pg.evaluate(CAPTURE)
        print("pinned pose  camera=" + json.dumps([round(v, 3) for v in pose["cp"]])
              + "  character=" + json.dumps([round(v, 3) for v in pose["chp"]]))

        for realm in ("cold", "sand", "ash"):
            if realm != "cold":
                pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(150)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(4)
            got = pg.evaluate(RESTORE, pose)
            frames(4)
            pg.evaluate(RESTORE, pose)
            frames(2)
            pg.screenshot(path=f"_shots/qa_ab_{realm}.png")
            st = pg.evaluate("""() => {const SF=globalThis.SNOWFLOW,p=SF.perfStats||{};
                return {draws:p.drawCalls, tris:p.triangles,
                        cam:SF.rig.camera.position.toArray().map(v=>+v.toFixed(3)),
                        sunAz:SF.S.sunAzimuth, sunEl:SF.S.sunElevation,
                        fogD:SF.S.fogDensity, expo:SF.S.exposure,
                        wind:SF.S.windDirection, mtn:SF.S.showMountains};}""")
            print(f"{realm:<5} shot _shots/qa_ab_{realm}.png  cam={st['cam']}  "
                  f"draws={st['draws']} tris={st['tris']}  "
                  f"sunAz={st['sunAz']} sunEl={st['sunEl']} fogD={st['fogD']} "
                  f"expo={st['expo']} wind={st['wind']} mtn={st['mtn']}")
        print(f"errors {len(errors)}")
        for e in errors[:8]:
            print("  ", e)
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
