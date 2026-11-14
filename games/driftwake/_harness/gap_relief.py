# -*- coding: utf-8 -*-
"""gap_relief.py -- sand relief bearing gap probe (port 8801).

Measures, for COLD and SAND, the dominant micro-relief ridge bearing and the
mean gradient energy of a top-down fineNormals debug view, using the same
structure-tensor method as _harness/audit_realms.py (qa_aniso.measure on a
centred 800x600 crop, hp 15 and 25).

PASS (hp=15): |sand bearing - cold bearing| folded mod 180 lies in [60, 120]
deg AND sand energy in [0.7, 1.4] x cold energy.

    python _harness/gap_relief.py
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from playwright.sync_api import sync_playwright  # noqa: E402
from qa_aniso import measure as aniso_measure    # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
PORT = 8801
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay&v=gaprelief{int(time.time())}"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.combat || !SF.enterRealm || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

CAPTURE = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  return { cp: c.position.toArray(), cq: c.quaternion.toArray(),
           chp: ch.position.toArray() };
}"""

CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay',
                     '#boot','.ffg-controls','#xp','#floaters','#enemybars']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""

FLATTEN = """() => {
  const S = globalThis.SNOWFLOW.S;
  S.debugView = 'fineNormals';
  S.tonemap = 'none'; S.exposure = 1.0; S.contrast = 1.0;
  S.bloom = false; S.grain = false; S.sharpen = false;
  S.dof = false; S.ssr = false; S.showLightShafts = false; S.taa = false;
  return { wind: S.windDirection, view: S.debugView };
}"""

TOPDOWN = """(P) => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  if (!SF.rig.__frozen) { SF.rig.__frozen = true; SF.rig.update = function () {}; }
  ch.position.fromArray(P.chp);
  if (SF.figure && SF.figure.setVisible) SF.figure.setVisible(false);
  if (SF.meshChar && SF.meshChar.setVisible) SF.meshChar.setVisible(false);
  const tx = P.chp[0] + P.off, tz = P.chp[2] + P.off;
  c.position.set(tx, P.chp[1] + P.h, tz);
  c.up.set(0, 0, -1);
  c.lookAt(tx, P.chp[1], tz + 1e-4);
  c.updateMatrixWorld(true);
  const vh = 2 * P.h * Math.tan(c.fov * Math.PI / 360);
  return { mPerPx: +(vh / 720).toFixed(4) };
}"""

CROP = (240, 60, 800, 600)


def main():
    errors = []
    os.makedirs(os.path.join(HERE, "..", "_shots"), exist_ok=True)
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                              cwd=str(ROOT),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = {}
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
                  if m.type == "error" else None)
            pg.add_init_script(
                "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
            pg.goto(URL, wait_until="load", timeout=90_000)
            pg.bring_to_front()
            pg.wait_for_function(READY, timeout=240_000)

            def frames(n):
                s = pg.evaluate("() => window.__f")
                try:
                    pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                         timeout=90_000)
                except Exception:
                    pg.bring_to_front()
                    pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                         timeout=90_000)

            time.sleep(3.0)
            frames(60)
            pg.evaluate(CHROME)
            pose = pg.evaluate(CAPTURE)
            td = dict(pose)
            td["h"], td["off"] = 45.0, 34.0
            print("pinned char " + json.dumps([round(v, 2) for v in pose["chp"]]))

            def settle_realm(realm):
                pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                time.sleep(4.0)
                frames(90)

            for realm in ("cold", "sand"):
                settle_realm(realm)
                pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
                frames(3)
                fl = pg.evaluate(FLATTEN)
                pg.evaluate(TOPDOWN, td)
                frames(4)
                mp = pg.evaluate(TOPDOWN, td)
                frames(3)
                path = os.path.join(HERE, "..", "_shots", f"gap_relief_{realm}.png")
                pg.screenshot(path=path)
                rows = {}
                for hp in (15, 25):
                    m = aniso_measure(path, *CROP, hp=hp)
                    rows[f"hp{hp}"] = {"ridge_deg": round(m["ridge_deg"], 1),
                                       "coherence": round(m["coherence"], 4),
                                       "energy": round(m["energy"], 5)}
                results[realm] = {"wind": fl["wind"], "mPerPx": mp["mPerPx"],
                                  "measure": rows, "shot": path}
                print(f"=== {realm.upper()} === " + json.dumps(
                    {"wind": fl["wind"], "mPerPx": mp["mPerPx"], "measure": rows}))
            br.close()
    finally:
        server.terminate()

    c15 = results["cold"]["measure"]["hp15"]
    s15 = results["sand"]["measure"]["hp15"]
    db = abs(s15["ridge_deg"] - c15["ridge_deg"]) % 180.0
    db = min(db, 180.0 - db)
    ratio = s15["energy"] / c15["energy"] if c15["energy"] > 0 else 0.0
    print(f"\nBEARING cold={c15['ridge_deg']:.1f} sand={s15['ridge_deg']:.1f} "
          f"delta(mod180,folded)={db:.1f} deg  (PASS band [60,120])")
    print(f"ENERGY  cold={c15['energy']:.5f} sand={s15['energy']:.5f} "
          f"ratio={ratio:.3f}  (PASS band [0.7,1.4])")
    c25 = results["cold"]["measure"]["hp25"]
    s25 = results["sand"]["measure"]["hp25"]
    db25 = abs(s25["ridge_deg"] - c25["ridge_deg"]) % 180.0
    db25 = min(db25, 180.0 - db25)
    r25 = s25["energy"] / c25["energy"] if c25["energy"] > 0 else 0.0
    print(f"hp25    cold={c25['ridge_deg']:.1f}/{c25['energy']:.5f} "
          f"sand={s25['ridge_deg']:.1f}/{s25['energy']:.5f} "
          f"delta={db25:.1f} ratio={r25:.3f}")
    ok = (60.0 <= db <= 120.0) and (0.7 <= ratio <= 1.4)
    print(f"errors {len(errors)}")
    for e in errors[:8]:
        print("  ", e)
    print("RESULT: " + ("PASS" if ok else "FAIL"))
    with open(os.path.join(HERE, "..", "_shots", "gap_relief.json"), "w",
              encoding="utf-8") as fh:
        json.dump(results, fh, indent=1)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
