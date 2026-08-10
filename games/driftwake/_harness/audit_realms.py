#!/usr/bin/env python
"""Realm-system verification audit (commits 0c7513c0..6610ced8).

Claims under test:
 1. Realm palette: lower-half (terrain) B/R ratio ordering cold ~0.965 >
    sand ~0.431 > ash ~0.088 (cold blue, sand warm, ash dark red).
 2. Fog/tone: uFog uniform differs per realm AND is visible (horizon band
    pixel stats differ between realms).
 3. Weather costs +1 draw call (perfStats.drawCalls with showWeather on/off).
 4. enterRealm applies together: encounters.realm switches, pack table
    switches, cold enemies despawn on switch, weather + enemy bodies switch.
 5. Micro-relief bearing baseline: heightAt gradient grid (64x64 @ 2 m) in
    cold vs sand + top-down fineNormals structure tensor (qa_aniso method).

    python _harness/audit_realms.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
from qa_aniso import measure as aniso_measure

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]

URL = "http://localhost:8799/games/driftwake/index.html?v=auditrealms"

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

STATE = """() => {
  const SF = globalThis.SNOWFLOW, K = SF.sky, S = SF.S;
  const f = K.uniforms.uFog.value;
  const en = SF.combat.enemies, enc = SF.combat.encounters;
  const vis = en.vis || null;
  const aliveUnits = [];
  for (let i = 0; i < 96 && aliveUnits.length < 12; i++) {
    if (en.alive && en.alive[i]) {
      const u = en.units[en.unitOf[i]];
      aliveUnits.push({ key: u.key, realm: u.realm });
    }
  }
  return {
    skyRealm: K.realmName,
    uFog: [+f.x.toFixed(6), +f.y.toFixed(6), +f.z.toFixed(3), +f.w.toFixed(3)],
    S: { fogDensity: S.fogDensity, fogHeightFalloff: S.fogHeightFalloff,
         fogStart: S.fogStart, aerialStrength: S.aerialStrength,
         exposure: S.exposure, contrast: S.contrast,
         bloomStrength: S.bloomStrength, showWeather: S.showWeather },
    weatherRealm: SF.weather.realmName,
    boostShared: !!(SF.weather.fogBoost === K.fogBoost),
    encountersRealm: enc.realm, packName: enc.packName,
    aliveCount: en.aliveCount, aliveUnits,
    visRealm: vis ? vis.realm : null,
    visTypes: vis && vis._types ? Array.from(vis._types.keys()) : null,
    draws: SF.perfStats.drawCalls, tris: SF.perfStats.triangles,
  };
}"""

DRAWS = """() => globalThis.SNOWFLOW.perfStats.drawCalls"""

PACK_PROBE = """() => {
  const SF = globalThis.SNOWFLOW, e = SF.combat.encounters;
  e.playerLevel = 10;
  let queued = 0, name = null;
  for (let t = 0; t < 6 && queued === 0; t++) {
    const before = e._qCount;
    e._tryRoamSpawn();
    queued = e._qCount - before;
    name = e.packName;
  }
  e._qCount = 0; e._qNext = 0; e._packActive = false; e.packName = null;
  return { queued, packName: name, realm: e.realm };
}"""

SPAWN_COLD = """() => {
  const SF = globalThis.SNOWFLOW, en = SF.combat.enemies, ch = SF.character;
  const a = en.spawn('rimeImp', ch.position.x + 30, ch.position.z + 30, 3);
  const b = en.spawn('glacierBrute', ch.position.x + 34, ch.position.z + 30, 3);
  return { ids: [a, b], aliveCount: en.aliveCount };
}"""

CLEAR_ENEMIES = """() => {
  const en = globalThis.SNOWFLOW.combat.enemies;
  const n = en.aliveCount;
  let err = null;
  try { en.clear(); } catch (e) { err = String(e); }
  if (en.aliveCount > 0) {
    for (let i = 0; i < en.alive.length; i++) {
      if (!en.alive[i]) continue;
      try { en.despawn(en.id[i]); } catch (e) {
        en.alive[i] = 0;
        try { en.registry.remove(en.id[i]); } catch (e2) {}
        try { if (en.vis) en.vis.free(i); } catch (e3) {}
      }
    }
  }
  return { cleared: n, now: en.aliveCount, clearError: err };
}"""

HEIGHT_GRID = """(o) => {
  const T = globalThis.SNOWFLOW.terrain;
  const n = o.n, s = o.step, cx = o.cx, cz = o.cz;
  const out = new Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      out[j * n + i] = T.heightAt(cx + (i - n / 2) * s, cz + (j - n / 2) * s);
  return out;
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

FLATTEN = """() => {
  const S = globalThis.SNOWFLOW.S;
  S.debugView = 'fineNormals';
  S.tonemap = 'none'; S.exposure = 1.0; S.contrast = 1.0;
  S.bloom = false; S.grain = false; S.sharpen = false;
  S.dof = false; S.ssr = false; S.showLightShafts = false; S.taa = false;
  return { wind: S.windDirection, view: S.debugView };
}"""


def lower_half_stats(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
    h = a.shape[0]
    lo = a[h // 2:, :, :]
    r, g, b = lo[:, :, 0].mean(), lo[:, :, 1].mean(), lo[:, :, 2].mean()
    return {"rgb": [round(float(r), 4), round(float(g), 4), round(float(b), 4)],
            "br": round(float(b / r) if r > 1e-6 else 0.0, 4),
            "luma": round(float(0.2126 * r + 0.7152 * g + 0.0722 * b), 4)}


def horizon_stats(path, lo=0.42, hi=0.50):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
    h = a.shape[0]
    band = a[int(h * lo):int(h * hi), :, :]
    r, g, b = band[:, :, 0].mean(), band[:, :, 1].mean(), band[:, :, 2].mean()
    return {"rgb": [round(float(r), 4), round(float(g), 4), round(float(b), 4)],
            "br": round(float(b / r) if r > 1e-6 else 0.0, 4),
            "luma": round(float(0.2126 * r + 0.7152 * g + 0.0722 * b), 4)}


def grid_bearing(arr, n=64):
    """Structure tensor of high-passed height grid. Returns dominant ridge
    bearing (deg, world XZ, CCW from +X, folded [0,180)) and coherence."""
    g = np.asarray(arr, dtype=np.float64).reshape(n, n)
    k = 9
    p = k // 2
    b = np.pad(g, p, mode="edge")
    c = np.vstack([np.zeros((1, b.shape[1])), np.cumsum(b, axis=0)])
    b = (c[k:, :] - c[:-k, :]) / k
    c = np.hstack([np.zeros((b.shape[0], 1)), np.cumsum(b, axis=1)])
    blur = (c[:, k:] - c[:, :-k]) / k
    hi = g - blur
    gz, gx = np.gradient(hi)  # rows are +Z steps, cols are +X steps
    jxx, jzz, jxz = (gx * gx).sum(), (gz * gz).sum(), (gx * gz).sum()
    tr = jxx + jzz
    coh = float(np.hypot(jxx - jzz, 2 * jxz) / tr) if tr > 0 else 0.0
    grad = 0.5 * np.degrees(np.arctan2(2.0 * jxz, jxx - jzz))
    ridge = float((grad + 90.0) % 180.0)
    return {"ridge_deg": round(ridge, 1), "coherence": round(coh, 4),
            "relief_rms": round(float(np.sqrt((hi ** 2).mean())), 5)}


def main():
    errors = []
    results = {}
    os.makedirs("_shots", exist_ok=True)
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
        print("pinned camera " + json.dumps([round(v, 2) for v in pose["cp"]]))

        def settle_realm(realm):
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
            pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
            time.sleep(4.0)
            frames(90)

        def pinned_shot(path):
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(4)
            pg.evaluate(RESTORE, pose)
            frames(4)
            pg.evaluate(RESTORE, pose)
            frames(2)
            pg.screenshot(path=path)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")

        def weather_test():
            frames(3)
            on = [pg.evaluate(DRAWS)]
            for _ in range(3):
                frames(2)
                on.append(pg.evaluate(DRAWS))
            pg.evaluate("() => globalThis.SNOWFLOW.set('showWeather', false)")
            frames(6)
            off = [pg.evaluate(DRAWS)]
            for _ in range(3):
                frames(2)
                off.append(pg.evaluate(DRAWS))
            pg.evaluate("() => globalThis.SNOWFLOW.set('showWeather', true)")
            frames(4)
            return {"drawsOn": on, "drawsOff": off,
                    "delta": max(on) - max(off)}

        # ---------------- COLD ----------------
        time.sleep(1.0)
        pinned_shot("_shots/audit_realm_cold.png")
        st = pg.evaluate(STATE)
        st["weather"] = weather_test()
        st["packProbe"] = pg.evaluate(PACK_PROBE)
        gridc = pg.evaluate(HEIGHT_GRID, {"n": 64, "step": 2,
                                          "cx": pose["chp"][0], "cz": pose["chp"][2]})
        st["heightGrid"] = grid_bearing(gridc)
        results["cold"] = st
        print("\n=== COLD ===\n" + json.dumps(
            {k: v for k, v in st.items() if k != "aliveUnits"}, indent=1))

        # spawn two cold enemies for the despawn-on-switch test
        sp = pg.evaluate(SPAWN_COLD)
        print("spawned cold enemies: " + json.dumps(sp))
        results["coldSpawn"] = sp

        # ---------------- SAND ----------------
        settle_realm("sand")
        st = pg.evaluate(STATE)
        # despawn check BEFORE clearing
        results["sandArrival"] = {
            "aliveCount": st["aliveCount"], "aliveUnits": st["aliveUnits"],
            "encountersRealm": st["encountersRealm"], "visRealm": st["visRealm"],
            "visTypes": st["visTypes"]}
        print("\n=== SAND arrival (despawn check) ===\n"
              + json.dumps(results["sandArrival"], indent=1))
        cl = pg.evaluate(CLEAR_ENEMIES)
        print("manual clear: " + json.dumps(cl))
        results["sandClear"] = cl
        st["packProbe"] = pg.evaluate(PACK_PROBE)
        st["weather"] = weather_test()
        grids = pg.evaluate(HEIGHT_GRID, {"n": 64, "step": 2,
                                          "cx": pose["chp"][0], "cz": pose["chp"][2]})
        st["heightGrid"] = grid_bearing(grids)
        gc = np.asarray(gridc)
        gs = np.asarray(grids)
        st["heightGridMaxDiffVsCold"] = round(float(np.abs(gc - gs).max()), 6)
        pinned_shot("_shots/audit_realm_sand.png")
        results["sand"] = {k: v for k, v in st.items() if k != "aliveUnits"}
        print("\n=== SAND ===\n" + json.dumps(results["sand"], indent=1))

        # ---------------- ASH ----------------
        settle_realm("ash")
        st = pg.evaluate(STATE)
        st["packProbe"] = pg.evaluate(PACK_PROBE)
        st["weather"] = weather_test()
        pinned_shot("_shots/audit_realm_ash.png")
        results["ash"] = {k: v for k, v in st.items() if k != "aliveUnits"}
        print("\n=== ASH ===\n" + json.dumps(results["ash"], indent=1))

        # ---------------- pixels ----------------
        for r in ("cold", "sand", "ash"):
            path = f"_shots/audit_realm_{r}.png"
            results[r]["lowerHalf"] = lower_half_stats(path)
            results[r]["horizon"] = horizon_stats(path)

        # ---------------- top-down fineNormals bearing ----------------
        td = {}
        tdpose = dict(pose)
        tdpose["h"], tdpose["off"] = 45.0, 34.0
        for realm in ("cold", "sand"):
            settle_realm(realm)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(3)
            fl = pg.evaluate(FLATTEN)
            pg.evaluate(TOPDOWN, tdpose)
            frames(4)
            pg.evaluate(TOPDOWN, tdpose)
            frames(3)
            path = f"_shots/audit_td_{realm}.png"
            pg.screenshot(path=path)
            rows = {}
            for hp in (15, 25):
                m = aniso_measure(path, 240, 60, 800, 600, hp=hp)
                rows[f"hp{hp}"] = {"ridge_deg": round(m["ridge_deg"], 1),
                                   "coherence": round(m["coherence"], 4),
                                   "energy": round(m["energy"], 5)}
            td[realm] = {"wind": fl["wind"], "measure": rows, "shot": path}
            print(f"\n=== TOPDOWN {realm} === " + json.dumps(td[realm]))
        results["topdownBearing"] = td

        print(f"\nerrors {len(errors)}")
        for e in errors[:10]:
            print("  ", e)
        results["errors"] = errors[:20]
        br.close()

    with open("_shots/audit_realms.json", "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=1)
    print("\nfull results -> _shots/audit_realms.json")

    print("\n--- PALETTE TABLE (lower half = terrain) ---")
    for r in ("cold", "sand", "ash"):
        s = results[r]
        print(f"{r:<5} rgb={s['lowerHalf']['rgb']} B/R={s['lowerHalf']['br']:.4f} "
              f"luma={s['lowerHalf']['luma']:.4f} | horizon rgb={s['horizon']['rgb']} "
              f"B/R={s['horizon']['br']:.4f} luma={s['horizon']['luma']:.4f}")
    print("\n--- FOG/TONE ---")
    for r in ("cold", "sand", "ash"):
        s = results[r]
        print(f"{r:<5} uFog={s['uFog']} exposure={s['S']['exposure']} "
              f"contrast={s['S']['contrast']} bloom={s['S']['bloomStrength']}")
    print("\n--- WEATHER DRAWS ---")
    for r in ("cold", "sand", "ash"):
        w = results[r]["weather"]
        print(f"{r:<5} on={w['drawsOn']} off={w['drawsOff']} delta={w['delta']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
