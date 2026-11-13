#!/usr/bin/env python
"""civ lane capture tool (scratch). Headed Chrome, real d3d11 GPU.

  python civshot.py URL STEP [STEP ...]

STEP forms:
  wait:S                 sleep S seconds (frames keep running)
  screen:NAME            wait until __BT__.state().screen == NAME (max 30 s)
  dismiss                __BT__.dismiss()
  key:CODE:S             hold a key (e.g. KeyW) for S seconds
  keys:C1+C2:S           hold several keys together
  eval:JS                evaluate a JS expression, print the result
  shot:PATH              page screenshot (full viewport) -> PATH
  clip:PATH:x,y,w,h      clipped screenshot -> PATH (scaled 2x device px is NOT used)
  perf:LABEL             print perf() + civilian renderBreakdown group + state draws/tris
"""
import json, sys, time
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling",
         "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
         "--autoplay-policy=no-user-gesture-required"]

PERF_JS = """() => {
  const B = window.__BT__; const s = B.state(); const p = B.perf();
  const rb = B.renderBreakdown ? B.renderBreakdown(400) : null;
  let civ = null, civMeshes = [];
  if (rb) {
    civ = rb.groups.filter(g => g.name.startsWith('civilians'));
    civMeshes = rb.meshes.filter(m => m.path.startsWith('civilians')).map(m => m.path.replace(/#\\d+/g,'') + ' tris=' + m.tris + ' inst=' + m.instances);
  }
  let civDbg = null;
  try { civDbg = B.debugCore.scene.getObjectByName('civilians').userData.civ; } catch (e) {}
  return { civDbg, screen: s.screen, rank: s.rank, H: s.height, fps: p.fps, p50: p.p50, p99: p.p99, draws: s.draws, tris: s.tris,
           totalDraws: rb && rb.totalDraws, totalTris: rb && rb.totalTris, civ, civMeshes, renderScale: s.renderScale };
}"""

url = sys.argv[1]
steps = sys.argv[2:]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    import os
    pg = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=float(os.environ.get("DSF", "1")))
    pg.on("console", lambda m: (errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None))
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    pg.goto(url, wait_until="load", timeout=60000)
    for st in steps:
        kind, _, rest = st.partition(":")
        if kind == "wait":
            time.sleep(float(rest))
        elif kind == "screen":
            t0 = time.time()
            while time.time() - t0 < 30:
                try:
                    if pg.evaluate("() => window.__BT__ && window.__BT__.state().screen") == rest: break
                except Exception: pass
                time.sleep(0.25)
            print("screen:", pg.evaluate("() => window.__BT__ && window.__BT__.state().screen"))
        elif kind == "toplay":
            for _ in range(20):
                sc = pg.evaluate("() => window.__BT__.state().screen")
                if sc == "play": break
                try: pg.evaluate("() => window.__BT__.dismiss()")
                except Exception: pass
                time.sleep(0.6)
            print("toplay:", pg.evaluate("() => window.__BT__.state().screen"))
        elif kind == "dismiss":
            print("dismiss:", pg.evaluate("() => window.__BT__.dismiss()"))
        elif kind in ("key", "keys"):
            codes, _, dur = rest.rpartition(":")
            cl = codes.split("+")
            for c in cl: pg.keyboard.down(c)
            time.sleep(float(dur))
            for c in cl: pg.keyboard.up(c)
        elif kind == "eval":
            try: print("eval:", json.dumps(pg.evaluate(rest))[:2000])
            except Exception as e: print("eval error:", e); errors.append(f"eval: {e}")
        elif kind == "shot":
            pg.screenshot(path=rest); print("saved", rest)
        elif kind == "clip":
            path, _, box = rest.rpartition(":")
            x, y, w, h = [float(v) for v in box.split(",")]
            pg.screenshot(path=path, clip={"x": x, "y": y, "width": w, "height": h})
            try:
                from PIL import Image
                im = Image.open(path); up = float(os.environ.get("UP", "2"))
                im.resize((int(im.width * up), int(im.height * up)), Image.NEAREST if up >= 3 else Image.LANCZOS).save(path)
            except Exception as e: print("resize failed", e)
            print("saved", path)
        elif kind == "perf":
            try: print("perf", rest, json.dumps(pg.evaluate(PERF_JS), indent=None))
            except Exception as e: print("perf error:", e)
        else:
            print("unknown step", st)
    b.close()
for e in errors[:40]: print(e)
print("errors:", len(errors))
