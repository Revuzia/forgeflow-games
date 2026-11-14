#!/usr/bin/env python
"""SOURCELESS-LIGHT ablation probe (lane: sourceless light, iter08).

Prices, in real pixels on a real capture, how much each additive/decal
mesh LIGHTENS a scenario frame. A defect of this class is exactly "a thing
that brightens the ground with no fixture above it", so the instrument has
to be a brightening delta, not an opinion.

    python ablate.py --shot S4 --names light_pools_plaza,neon_wall_pools,...

For each name: hide it, capture, diff against the baseline capture, and
report positive (brightening) pixel count + mean positive delta + the
bounding box of the region it lit. `sprites` is a pseudo-name meaning
"every THREE.Sprite in the scene".

Writes nothing to _shots/iterNN — captures land in _shots/inbox and are
deleted by the caller.
"""
import argparse, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server, SHOTS_ROOT  # noqa: E402

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
INBOX = os.path.join(SHOTS_ROOT, "inbox")

HIDE = """(a) => {
  const F = globalThis.__FPS__;
  const hidden = [];
  if (a.name === '__none__') { globalThis.__ABL__ = []; return 0; }
  // pseudo-name: the planar mirror pass itself (perf lane's profiler seam)
  if (a.name === 'reflect') {
    const R = globalThis.__BR_REFLECT_API__;
    if (R && typeof R.setEnabled === 'function') { R.setEnabled(false); globalThis.__ABL_R__ = R; return 1; }
    return 0;
  }
  // pseudo-name: hide EVERY mesh/sprite except the ground meshes — splits
  // "is this the ground's own shading" from "is something drawn over it".
  if (a.name === 'onlyground') {
    F.scene.traverse(o => {
      if ((o.isMesh || o.isSprite || o.isPoints) && o.visible && o.name !== 'ground') {
        o.visible = false; hidden.push(o);
      }
    });
    globalThis.__ABL__ = hidden; return hidden.length;
  }
  // pseudo-name: moon + hemi + every spot to zero, together
  if (a.name === 'alllights') {
    const saved = [];
    F.scene.traverse(o => { if (o.isLight && o.intensity > 0) { saved.push([o, o.intensity]); o.intensity = 0; } });
    globalThis.__ABL_L__ = saved; return saved.length;
  }
  // pseudo-name: the image-based lighting (scene.environment PMREM)
  if (a.name === 'env') {
    globalThis.__ABL_E__ = F.scene.environment;
    F.scene.environment = null;
    return 1;
  }
  // pseudo-names: the LIGHTS themselves (intensity 0, restored after)
  if (a.name === 'moon' || a.name === 'hemi' || a.name === 'spots' || a.name === 'allspots') {
    const saved = [];
    F.scene.traverse(o => {
      if (!o.isLight) return;
      const want = (a.name === 'moon' && o.isDirectionalLight)
                || (a.name === 'hemi' && o.isHemisphereLight)
                || ((a.name === 'spots' || a.name === 'allspots') && o.isSpotLight);
      if (want && o.intensity > 0) { saved.push([o, o.intensity]); o.intensity = 0; }
    });
    globalThis.__ABL_L__ = saved; return saved.length;
  }
  if (/^spot:/.test(a.name)) {
    const id = a.name.slice(5); const saved = [];
    F.scene.traverse(o => {
      if (o.isSpotLight && String(o.name || '').indexOf(id) >= 0 && o.intensity > 0) {
        saved.push([o, o.intensity]); o.intensity = 0;
      }
    });
    globalThis.__ABL_L__ = saved; return saved.length;
  }
  // pseudo-name: every god-ray cone at once
  if (a.name === 'cones') {
    F.scene.traverse(o => { if (/^godray_cone/.test(o.name || '') && o.visible) { o.visible = false; hidden.push(o); } });
    globalThis.__ABL__ = hidden; return hidden.length;
  }
  F.scene.traverse(o => {
    const hit = (a.name === 'sprites') ? o.isSprite : (o.name === a.name);
    if (hit && o.visible) { o.visible = false; hidden.push(o); }
  });
  globalThis.__ABL__ = hidden;
  return hidden.length;
}"""

RESTORE = """() => { for (const o of (globalThis.__ABL__ || [])) o.visible = true;
                     globalThis.__ABL__ = [];
                     if (globalThis.__ABL_E__ !== undefined && globalThis.__ABL_E__ !== null) {
                       globalThis.__FPS__.scene.environment = globalThis.__ABL_E__;
                       globalThis.__ABL_E__ = null;
                     }
                     for (const [o, v] of (globalThis.__ABL_L__ || [])) o.intensity = v;
                     globalThis.__ABL_L__ = [];
                     if (globalThis.__ABL_R__) { globalThis.__ABL_R__.setEnabled(true); globalThis.__ABL_R__ = null; }
                     return true; }"""


def capture(page, name, w, h, dpr):
    page.evaluate("(a) => __FPS__.__test.capture(a.name, a.w, a.h, {dpr: a.dpr})",
                  {"name": name, "w": w, "h": h, "dpr": dpr})
    p = os.path.join(INBOX, name)
    dl = time.time() + 20
    while time.time() < dl:
        if os.path.exists(p) and os.path.getsize(p) > 1024:
            return p
        time.sleep(0.15)
    raise RuntimeError("capture never landed: " + name)


def diff(base, other, thr=2.0, box=8):
    """Positive (brightening) delta of `base` minus `other`, low-passed.

    Rain streaks are 1-2 px wide and move between captures; a sourceless
    light pool is tens of px across and static. Box-downsampling by `box`
    before differencing suppresses the rain (measured noise floor 10.0% of
    pixels at +3.54 mean at box=1) so the pool signal is readable.
    """
    from PIL import Image
    import numpy as np
    def load(p):
        im = Image.open(p).convert("RGB")
        if box > 1:
            im = im.resize((im.width // box, im.height // box), Image.BOX)
        return np.asarray(im, dtype=np.float32).mean(axis=2)
    a, b = load(base), load(other)
    d = a - b
    pos = d > thr
    n = int(pos.sum())
    if n == 0:
        return {"px": 0, "mean": 0.0, "max": 0.0, "bbox": None,
                "pct": 0.0}
    ys, xs = np.nonzero(pos)
    return {"px": n, "pct": round(100.0 * n / d.size, 3),
            "mean": round(float(d[pos].mean()), 2),
            "max": round(float(d.max()), 2),
            "bbox": [int(xs.min())*8, int(ys.min())*8, int(xs.max())*8, int(ys.max())*8]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot", default="S4")
    ap.add_argument("--names", required=True)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--dpr", type=float, default=1.5)
    ap.add_argument("--pose", default="", help="x,y,z,yaw,pitch — park the eye here after setScenario")
    a = ap.parse_args()
    ensure_server()
    names = [n for n in a.names.split(",") if n]
    import re as _re
    shots_src = _re.sub(r"^export\s+", "",
                        open(os.path.join(HERE, "shots.js"), encoding="utf-8").read(),
                        flags=_re.M)
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": a.width, "height": a.height})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=90000)
        pg.add_script_tag(content=shots_src)
        pg.evaluate("window.__BR_SEEDS__ = SCENARIOS")
        pg.wait_for_function(
            "() => !!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim "
            "&& __FPS__.__test && typeof __FPS__.__test.capture === 'function')",
            timeout=120000)
        for _ in range(30):
            pg.wait_for_timeout(20)
        pg.evaluate("(n) => __FPS__.__test.setScenario(n, SCENARIOS[n])", a.shot)
        # Freeze the sim clock AND stop the weather/rain animation, or the
        # frame-to-frame delta from moving rain streaks (measured ~11% of
        # pixels at +4.6 mean) buries every real signal.
        pg.evaluate("""() => {
          try { __FPS__.__test.freeze(true); } catch (e) {}
          const w = __FPS__.weather || (__FPS__.ctx && __FPS__.ctx.weather);
          if (w && typeof w.freeze === 'function') w.freeze(true);
        }""")
        if a.pose:
            x, y, z, yaw, pitch = [float(v) for v in a.pose.split(",")]
            _r = pg.evaluate("""(p) => {
              // The pose is applied to the CAMERA by scenarios.applyCamera()
              // and then the world is held with pauseCtl, so moving the sim
              // player does nothing. Drive the camera itself.
              const T = __FPS__.__test;
              if (typeof T.unpinAll === 'function') T.unpinAll();
              T.placePlayer(p.x, p.y, p.z, p.yaw, p.pitch);
              const cam = __FPS__.camera;
              cam.position.set(p.x, p.y + 1.62, p.z);
              cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
              cam.updateMatrixWorld(true);
              const vm = __FPS__.vm && __FPS__.vm.camera;
              if (vm) { vm.rotation.copy(cam.rotation); vm.updateMatrixWorld(true); }
              return [cam.position.x, cam.position.y, cam.position.z];
            }""", {"x": x, "y": y, "z": z, "yaw": yaw, "pitch": pitch})
            print("POSE cam ->", _r)
        pg.evaluate("""() => {
          __FPS__.__test.hud(false);
          const sels = (typeof HUD_SELECTORS !== 'undefined') ? HUD_SELECTORS : [];
          for (const s of sels)
            document.querySelectorAll(s).forEach(e => { e.style.display = 'none'; });
        }""")
        for _ in range(40):
            pg.wait_for_timeout(20)
        base = capture(pg, f"abl_{a.shot}_base.png", a.width, a.height, a.dpr)
        print(f"BASE {a.shot} -> {base}")
        rows = []
        for nm in names:
            cnt = pg.evaluate(HIDE, {"name": nm})
            pg.wait_for_timeout(120)
            p = capture(pg, f"abl_{a.shot}_{nm}.png", a.width, a.height, a.dpr)
            pg.evaluate(RESTORE)
            pg.wait_for_timeout(60)
            d = diff(base, p)
            d["name"] = nm
            d["meshes"] = cnt
            rows.append(d)
            print(f"{nm:24s} meshes={cnt:3d}  litpx={d['px']:8d} ({d['pct']:6.3f}%) "
                  f"mean=+{d['mean']:6.2f} max=+{d['max']:6.2f} bbox={d['bbox']}")
        if errs:
            print("PAGE ERRORS:", errs)
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
