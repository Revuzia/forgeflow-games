#!/usr/bin/env python
"""Per-realm FOG and TONE, measured — REALM_CONTRACT §1c and §1f.

Two claims need evidence that a screenshot alone cannot give:

  1. the fog INVERSION lands. Sand's dust settles (falloff 0.070, a 14.3 m scale
     height, so it pools below the crests) and Ash's smoke rises (0.026, 38.5 m,
     so it fills the column) against Cold's 0.045. Reading `S` proves the write;
     reading the `uFog` UNIFORM proves nothing overwrote it afterwards, which is
     exactly what `weather.js`'s old per-frame `driveFog` rewrite used to do.
  2. the tone grade is the realm's, not Cold's everywhere — and that the panel
     did not go dead in the process. The base/offset pair is read back straight
     out of `settings.js` and the offset is exercised: a slider is dragged in
     Cold, the realm is swapped, and the drag has to survive as a RATIO of the
     new realm's base rather than as Cold's absolute number.

Pose is PINNED (the qa_realmab.py method: record the transform, `S.freezeTime`,
restore before every shutter) or the three frames come from three different
camera positions and the pixel numbers underneath mean nothing.

    python _harness/fogtone.py
"""
import json
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

URL = "http://localhost:8788/games/driftwake/index.html?v=fogtone"

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
  return true;
}"""

CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay',
                     '#boot','.ffg-controls','#xp','#floaters','#enemybars']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""

# The settings module by URL: main.js imports the same specifier, so this is the
# same module instance and the same base/offset store, not a second copy.
STATE = """async () => {
  const SF = globalThis.SNOWFLOW, K = SF.sky, S = SF.S, p = SF.perfStats || {};
  const st = await import('/games/driftwake/src/core/settings.js');
  const g = st.realmGradeState();
  const f = K.uniforms.uFog.value;
  const w = SF.weather;
  return {
    skyRealm: K.realmName,
    uFog: [+f.x.toFixed(6), +f.y.toFixed(6), +f.z.toFixed(3), +f.w.toFixed(3)],
    S: { fogDensity: S.fogDensity, fogHeightFalloff: S.fogHeightFalloff,
         fogStart: S.fogStart, aerialStrength: S.aerialStrength,
         exposure: S.exposure, contrast: S.contrast,
         bloomStrength: S.bloomStrength, bloom: S.bloom, preset: S.preset },
    base: g.base, offset: g.offset,
    skyBoost: [K.fogBoost.density, K.fogBoost.falloff],
    boostShared: !!(w && w.fogBoost === K.fogBoost),
    beamExtinction: K._beamExtinction,
    sunScale: +K.sunScale.toFixed(4),
    gradeActive: K._gradeActive,
    sunOnScreen: !!(SF.post && SF.post._sunOnScreen),
    draws: p.drawCalls, tris: p.triangles,
  };
}"""

# Bands as fractions of frame height. The horizon sits near 0.47 at the boot
# pose, so 0.30-0.40 is dome, 0.48-0.56 is the ground the fog has eaten most of,
# and 0.80-0.95 is the ground it has barely touched. Fog is a DEPTH effect, so
# far-vs-near is the axis it has to show up on.
BANDS = {"sky": (0.30, 0.40), "farfield": (0.48, 0.56), "foreground": (0.80, 0.95)}


def measure(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
    h = a.shape[0]
    out = {}
    for name, (lo, hi) in BANDS.items():
        band = a[int(h * lo):int(h * hi), :, :]
        r, g, b = band[:, :, 0].mean(), band[:, :, 1].mean(), band[:, :, 2].mean()
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        out[name] = {"luma": round(float(luma), 4),
                     "br": round(float(b / r) if r > 1e-6 else 0.0, 4),
                     "rgb": [round(float(r), 4), round(float(g), 4), round(float(b), 4)]}
    # Far-vs-near contrast IS the fog reading: heavy fog lifts the far field
    # toward the dome and flattens the difference between the two bands.
    out["farNearDelta"] = round(out["foreground"]["luma"] - out["farfield"]["luma"], 4)
    return out


def main():
    errors = []
    results = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(URL, wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=240_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=120_000)

        frames(60)
        pg.evaluate(CHROME)
        pose = pg.evaluate(CAPTURE)
        print("pinned camera " + json.dumps([round(v, 3) for v in pose["cp"]]))

        for realm in ("cold", "sand", "ash"):
            if realm != "cold":
                pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(150)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(4)
            pg.evaluate(RESTORE, pose)
            frames(4)
            pg.evaluate(RESTORE, pose)
            frames(2)
            shot = f"_shots/fogtone_{realm}.png"
            pg.screenshot(path=shot)
            st = pg.evaluate(STATE)
            st["pixels"] = measure(shot)
            st["shot"] = shot
            results[realm] = st
            print(f"\n=== {realm.upper()} ===")
            print(json.dumps(st, indent=1))

        # ---- COLD MUST COME BACK UNCHANGED ----------------------------------
        # The realm machinery is only safe if a round trip is the identity. Cold
        # is shot before any swap has happened (nothing has called
        # applyRealmGrade at that point) and again after cold->sand->ash->cold,
        # at the same pinned pose with the clock frozen; the two frames are
        # differenced. This is the same |dLuma| metric the wave-6 QA pass used,
        # where 0.00051 was the control (a realm re-entered without changing).
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        pg.evaluate("() => globalThis.SNOWFLOW.enterRealm('cold')")
        frames(150)
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
        frames(4)
        pg.evaluate(RESTORE, pose)
        frames(4)
        pg.evaluate(RESTORE, pose)
        frames(2)
        pg.screenshot(path="_shots/fogtone_cold_return.png")
        ret = pg.evaluate(STATE)
        ret["pixels"] = measure("_shots/fogtone_cold_return.png")
        results["cold_return"] = ret
        a = np.asarray(Image.open("_shots/fogtone_cold.png").convert("RGB"),
                       dtype=np.float64) / 255.0
        b = np.asarray(Image.open("_shots/fogtone_cold_return.png").convert("RGB"),
                       dtype=np.float64) / 255.0
        w = np.array([0.2126, 0.7152, 0.0722])
        d = np.abs((a * w).sum(2) - (b * w).sum(2))
        print("\n=== COLD ROUND TRIP (cold -> sand -> ash -> cold) ===")
        print(f" max |dLuma| {d.max():.5f}   mean |dLuma| {d.mean():.5f}")
        print(" S back to  " + json.dumps(ret["S"]))
        print(" uFog back to " + json.dumps(ret["uFog"]))
        results["coldRoundTrip"] = {"maxDLuma": round(float(d.max()), 5),
                                    "meanDLuma": round(float(d.mean()), 5)}

        # ---- the panel is still a live control ------------------------------
        # Drag exposure +20% in cold, swap to sand, and the drag must survive as
        # a RATIO of sand's base -- not as cold's absolute number, and not lost.
        pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
        drag = pg.evaluate("""async () => {
          const st = await import('/games/driftwake/src/core/settings.js');
          const S = globalThis.SNOWFLOW.S;
          const before = S.exposure;
          st.set('exposure', +(before * 1.2).toFixed(6));
          return { base: st.realmGradeState().base.exposure,
                   offset: +st.realmGradeState().offset.exposure.toFixed(4),
                   dragged: S.exposure };
        }""")
        pg.evaluate("() => globalThis.SNOWFLOW.enterRealm('sand')")
        frames(120)
        after = pg.evaluate("""async () => {
          const st = await import('/games/driftwake/src/core/settings.js');
          const g = st.realmGradeState();
          return { exposure: globalThis.SNOWFLOW.S.exposure,
                   base: g.base.exposure, offset: +g.offset.exposure.toFixed(4),
                   fogDensity: globalThis.SNOWFLOW.S.fogDensity,
                   fogOffset: +g.offset.fogDensity.toFixed(4) };
        }""")
        print("\n=== SLIDER OFFSET SURVIVES A SWAP ===")
        print(" dragged in cold:", json.dumps(drag))
        print(" then in sand   :", json.dumps(after))
        print(f" expected sand exposure = base {after['base']} x offset "
              f"{after['offset']} = {round(after['base'] * after['offset'], 6)}")
        results["sliderOffset"] = {"dragged": drag, "afterSwap": after}

        print(f"\nerrors {len(errors)}")
        for e in errors[:8]:
            print("  ", e)
        br.close()

    with open("_shots/fogtone.json", "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=1)
    print("\nfull results -> _shots/fogtone.json")

    print("\n--- TABLE ---")
    print(f"{'realm':<6}{'uFog.x':>10}{'uFog.y':>10}{'expo':>8}{'contr':>7}"
          f"{'bloom':>7}{'far luma':>10}{'far B/R':>9}{'fg luma':>9}{'fg B/R':>8}")
    for r in ("cold", "sand", "ash"):
        s = results[r]
        px = s["pixels"]
        print(f"{r:<6}{s['uFog'][0]:>10.5f}{s['uFog'][1]:>10.5f}"
              f"{s['S']['exposure']:>8.3f}{s['S']['contrast']:>7.2f}"
              f"{s['S']['bloomStrength']:>7.2f}"
              f"{px['farfield']['luma']:>10.4f}{px['farfield']['br']:>9.4f}"
              f"{px['foreground']['luma']:>9.4f}{px['foreground']['br']:>8.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
