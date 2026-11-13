#!/usr/bin/env python
"""D3 SPECULAR-RESPONSE probe (lane: material truth, iter09).

The D3 question is not "is the texture good", it is "does the SHADING
respond to the material parameters at all". So the instrument is a
roughness SWEEP and a specular ABLATION measured on named hero regions of
a real capture, not an opinion about a texture.

    python a3spec.py --shot S8 --regions wallL,wallR,gun --probes rough,env,spec

Each probe applies a live mutation, captures, and reports per-region
mean luma / std / high-pass std against the same-page baseline. Every
probe is applied and reverted inside ONE page load, so the numbers are
contention-independent in the same sense levers.py's ratios are.

Captures land in _shots/inbox and are deleted by the caller.
"""
import argparse, json, os, re, sys, time
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

# Hero regions, read off the iter08 battery PNGs at 1920x1080.
REGIONS = {
    "S8": {
        "wallL": (560, 300, 980, 900),     # the big pale left concrete face
        "wallR": (1035, 275, 1245, 700),   # the right concrete face
        "gun":   (1150, 650, 1520, 950),   # viewmodel receiver/handguard
        "sky":   (300, 20, 900, 90),
    },
    "S4": {
        "wall":   (1290, 90, 1900, 660),   # credited droplet/crack wall
        "cobble": (120, 700, 820, 1040),   # credited wet cobble
        "bin":    (1040, 650, 1200, 930),
    },
    "S1": {"gun": (900, 520, 1700, 1060), "wall": (100, 200, 700, 800)},
    "S2": {"gun": (700, 300, 1300, 1000), "wall": (60, 120, 600, 700)},
}

# ---- probes: name -> (apply_js, revert_js) ------------------------------
APPLY = """(a) => {
  const F = globalThis.__FPS__, S = F.scene;
  const saved = [];
  globalThis.__A3__ = saved;
  const mats = new Set();
  S.traverse(o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && m.isMeshStandardMaterial) mats.add(m);
  });
  const vmScene = (F.vm && (F.vm.scene || F.vm.root)) || null;
  const vmMats = new Set();
  if (vmScene) vmScene.traverse(o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && m.isMeshStandardMaterial) vmMats.add(m);
  });
  const all = a.scope === 'vm' ? vmMats : (a.scope === 'world' ? mats : new Set([...mats, ...vmMats]));
  const p = a.probe;

  if (p === 'rough') {
    for (const m of all) { saved.push([m, 'roughness', m.roughness]); m.roughness = a.value; }
    return all.size;
  }
  if (p === 'envI') {
    for (const m of all) { saved.push([m, 'envMapIntensity', m.envMapIntensity]); m.envMapIntensity = (m.envMapIntensity || 1) * a.value; }
    return all.size;
  }
  if (p === 'sceneEnvI') {
    saved.push([S, 'environmentIntensity', S.environmentIntensity]);
    S.environmentIntensity = a.value;
    return 1;
  }
  if (p === 'env') {   // kill IBL entirely
    saved.push([S, 'environment', S.environment]);
    S.environment = null;
    return 1;
  }
  if (p === 'metal') {
    for (const m of all) { saved.push([m, 'metalness', m.metalness]); m.metalness = a.value; }
    return all.size;
  }
  if (p === 'sheen' || p === 'wetLevel' || p === 'grunge' || p === 'coat' || p === 'coatRough' || p === 'bump') {
    const key = p === 'sheen' ? 'uSheen' : (p === 'wetLevel' ? 'uWetLevel'
              : p === 'coat' ? 'uCoat' : p === 'coatRough' ? 'uCoatRough'
              : p === 'bump' ? 'uBump' : 'uGrungeAmp');
    let n = 0;
    for (const m of all) {
      const u = m.userData && m.userData.a3uniforms;
      if (u && u[key]) { saved.push([u[key], 'value', u[key].value]); u[key].value = a.value; n++; }
    }
    return n;
  }
  if (p === 'moon' || p === 'hemi') {
    let n = 0;
    S.traverse(o => {
      if (!o.isLight) return;
      const hit = (p === 'moon' && o.isDirectionalLight) || (p === 'hemi' && o.isHemisphereLight);
      if (hit) { saved.push([o, 'intensity', o.intensity]); o.intensity = o.intensity * a.value; n++; }
    });
    return n;
  }
  if (p === 'none') return 0;
  throw new Error('unknown probe ' + p);
}"""

REVERT = """() => {
  for (const [o, k, v] of (globalThis.__A3__ || [])) o[k] = v;
  globalThis.__A3__ = [];
  return true;
}"""


def capture(page, name, w, h, dpr):
    page.evaluate("(a) => __FPS__.__test.capture(a.name, a.w, a.h, {dpr: a.dpr})",
                  {"name": name, "w": w, "h": h, "dpr": dpr})
    p = os.path.join(INBOX, name)
    dl = time.time() + 25
    while time.time() < dl:
        if os.path.exists(p) and os.path.getsize(p) > 1024:
            time.sleep(0.10)
            return p
        time.sleep(0.12)
    raise RuntimeError("capture never landed: " + name)


def stats(path, regions):
    from PIL import Image
    import numpy as np
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    lum = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    out = {}
    for name, (x0, y0, x1, y1) in regions.items():
        c = lum[y0:y1, x0:x1]
        # high-pass: subtract a 9x9 box blur (detail energy, not level)
        k = 9
        pad = np.pad(c, k // 2, mode="edge")
        cs = np.cumsum(np.cumsum(pad, 0), 1)
        cs = np.pad(cs, ((1, 0), (1, 0)))
        H, W = c.shape
        box = (cs[k:k + H, k:k + W] - cs[0:H, k:k + W]
               - cs[k:k + H, 0:W] + cs[0:H, 0:W]) / (k * k)
        hp = c - box
        out[name] = {
            "mean": round(float(c.mean()), 3),
            "std": round(float(c.std()), 3),
            "hp": round(float(hp.std()), 3),
            "p99": round(float(np.percentile(c, 99)), 1),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot", default="S8")
    ap.add_argument("--regions", default="")
    ap.add_argument("--probes", required=True,
                    help="comma list of probe:value:scope, e.g. rough:0.10:world,env::world")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--dpr", type=float, default=1.0)
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    ensure_server()

    regions = REGIONS.get(a.shot, {})
    if a.regions:
        want = set(a.regions.split(","))
        regions = {k: v for k, v in regions.items() if k in want}
    if not regions:
        regions = {"full": (0, 0, a.width, a.height)}

    shots_src = re.sub(r"^export\s+", "",
                       open(os.path.join(HERE, "shots.js"), encoding="utf-8").read(),
                       flags=re.M)
    probes = []
    for tok in a.probes.split(","):
        if not tok:
            continue
        parts = (tok.split(":") + ["", ""])[:3]
        probes.append((parts[0], float(parts[1]) if parts[1] else 0.0,
                       parts[2] or "world"))

    result = {"shot": a.shot, "regions": {k: list(v) for k, v in regions.items()},
              "probes": []}
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
        pg.evaluate("""() => {
          try { __FPS__.__test.freeze(true); } catch (e) {}
          const w = __FPS__.weather || (__FPS__.ctx && __FPS__.ctx.weather);
          if (w && typeof w.freeze === 'function') w.freeze(true);
          __FPS__.__test.hud(false);
          const sels = (typeof HUD_SELECTORS !== 'undefined') ? HUD_SELECTORS : [];
          for (const s of sels) document.querySelectorAll(s).forEach(e => { e.style.display = 'none'; });
        }""")
        for _ in range(40):
            pg.wait_for_timeout(20)

        base = capture(pg, f"a3_{a.shot}_base.png", a.width, a.height, a.dpr)
        bs = stats(base, regions)
        result["base"] = bs
        print("BASE", json.dumps(bs))

        for i, (p, v, scope) in enumerate(probes):
            n = pg.evaluate(APPLY, {"probe": p, "value": v, "scope": scope})
            for _ in range(25):
                pg.wait_for_timeout(20)
            f = capture(pg, f"a3_{a.shot}_{i}_{p}.png", a.width, a.height, a.dpr)
            st = stats(f, regions)
            pg.evaluate(REVERT)
            for _ in range(10):
                pg.wait_for_timeout(20)
            row = {"probe": p, "value": v, "scope": scope, "n": n, "stats": st,
                   "delta": {k: {"mean": round(st[k]["mean"] - bs[k]["mean"], 3),
                                 "std": round(st[k]["std"] - bs[k]["std"], 3),
                                 "hp": round(st[k]["hp"] - bs[k]["hp"], 3)}
                             for k in st}}
            result["probes"].append(row)
            print(f"{p}={v} [{scope}] n={n} ", json.dumps(row["delta"]))
            if not a.keep:
                try:
                    os.remove(f)
                except Exception:
                    pass

        # re-capture the baseline LAST — proves the reverts were clean and
        # that nothing drifted across the run.
        b2 = capture(pg, f"a3_{a.shot}_base2.png", a.width, a.height, a.dpr)
        result["base2"] = stats(b2, regions)
        print("BASE2", json.dumps(result["base2"]))
        result["pageErrors"] = errs
        br.close()
    if not a.keep:
        for f in (base, b2):
            try:
                os.remove(f)
            except Exception:
                pass
    print("JSON " + json.dumps(result))


if __name__ == "__main__":
    main()
