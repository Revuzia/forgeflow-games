# -*- coding: utf-8 -*-
"""
qa_soak_griddrift_8894.py -- does the WORLD LOOK come back?

The long soak's start and end screenshots differ in tone, but the camera
azimuth differs too, so a screenshot cannot settle it. This reads the actual
numbers the look is made of, cycles cold -> sand -> ash -> cold twice, and
diffs them against the cold values captured before anything moved:

  * the seven REALM_GRADE_KEYS (fog x3, aerial, exposure, contrast, bloom)
  * the sun the realm authors (azimuth / elevation) and the wind direction
  * sky's derived multipliers (sun scale, ambient, ridge, beam extinction)
    and its ground-bounce albedo
  * the whole weather parameter block (`weather._p`) -- the one applied with
    Object.assign, i.e. the one that CAN inherit a key across realms
  * shrine / landmark ground re-seat, portal token, terrain realm name

Anything non-zero in the diff is realm state that did not come home.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PORT = 8894
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]
OUT_JSON = HERE / "qa_soak_griddrift_8894.out.json"

SNAP = """() => {
    const S = SNOWFLOW, s = SNOWFLOW.S;
    const sky = S.sky, w = S.weather, t = S.terrain;
    const KEYS = ["fogDensity", "fogHeightFalloff", "fogStart", "aerialStrength",
                  "exposure", "contrast", "bloomStrength"];
    const grade = {};
    for (const k of KEYS) grade[k] = s[k];
    const wp = {};
    if (w && w._p) for (const k in w._p) {
        const v = w._p[k];
        wp[k] = Array.isArray(v) ? v.slice() : v;
    }
    return {
        realm: S.combat.encounters.realm,
        grade,
        sun: { az: s.sunAzimuth, el: s.sunElevation, wind: s.windDirection,
               intensity: s.sunIntensity, ambient: s.ambientIntensity },
        skyDerived: {
            sunScaleMul: sky._sunScaleMul, ambientMul: sky._ambientMul,
            ridgeMul: sky._ridgeMul, beamExt: sky._beamExtinction,
            groundAlbedo: sky.groundAlbedo ? sky.groundAlbedo.slice() : null,
            realmName: sky.realmName, gradeActive: sky._gradeActive,
        },
        weather: wp,
        terrainRealm: t.realmName,
        shrineY: S.shrine && S.shrine.positions
            ? S.shrine.positions.map((p) => +p.y.toFixed(3)) : null,
        landmarkRealm: S.landmarks ? S.landmarks.realm : null,
        portalToken: S.portal.stats.token,
        heapMB: performance.memory
            ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
        geo: SNOWFLOW.renderer.info.memory.geometries,
        tex: SNOWFLOW.renderer.info.memory.textures,
        types: S.combat.enemies.vis._types.size,
        insts: S.combat.enemies.vis._insts.length,
        sceneObjs: (() => { let n = 0; S.scene.traverse(() => n++); return n; })(),
    };
}"""


def diff(a, b, path=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in a:
            out += diff(a[k], b.get(k), path + "/" + k)
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [(path, a, b)]
        for i in range(len(a)):
            out += diff(a[i], b[i], path + "[%d]" % i)
        return out
    if isinstance(a, float) or isinstance(b, float):
        try:
            if abs(float(a) - float(b)) > 1e-9:
                return [(path, a, b)]
            return []
        except (TypeError, ValueError):
            pass
    if a != b:
        return [(path, a, b)]
    return []


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            warns = []
            pg.on("console", lambda m: warns.append(m.text[:300])
                  if m.type in ("warning", "error") else None)
            pg.on("pageerror", lambda e: warns.append("PAGEERROR " + str(e)[:600]))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(4000)

            base = pg.evaluate(SNAP)
            out["cold_fresh"] = base
            print("fresh cold:", json.dumps(base["grade"]), flush=True)

            seq = ["sand", "ash", "cold", "sand", "ash", "cold"]
            out["steps"] = []
            for token in seq:
                pg.evaluate("(t) => SNOWFLOW.enterRealm(t)", token)
                pg.wait_for_timeout(6000)
                s = pg.evaluate(SNAP)
                out["steps"].append(s)
                print("  -> %-5s realm=%-5s heap=%s types=%s insts=%s scene=%s"
                      % (token, s["realm"], s["heapMB"], s["types"],
                         s["insts"], s["sceneObjs"]), flush=True)

            pg.wait_for_timeout(4000)
            back = pg.evaluate(SNAP)
            out["cold_returned"] = back
            out["warns"] = warns

            d = diff(base, back)
            out["diff"] = [{"path": p, "fresh": a, "returned": b}
                           for (p, a, b) in d]
            print("\n---- DIFF fresh-cold vs returned-cold ----", flush=True)
            if not d:
                print("  (identical)", flush=True)
            for (p, a, b) in d:
                print("  %-40s %s -> %s" % (p, a, b), flush=True)
            print("\nconsole warnings/errors: %d" % len(warns), flush=True)
            for w in warns[:20]:
                print("   ", w, flush=True)
            br.close()
    finally:
        srv.terminate()
        OUT_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print("wrote", OUT_JSON, flush=True)


if __name__ == "__main__":
    main()
