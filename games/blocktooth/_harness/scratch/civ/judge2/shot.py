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

AUDIT_JS = """() => {
  const root = window.__BT__.debugCore.scene.getObjectByName('civilians');
  const pts = []; const m = new root.matrixWorld.constructor(); const e = m.elements;
  root.traverse(o => {
    if (!o.isInstancedMesh || /ink|puff/i.test(o.name)) return;
    if (!o.visible) return;
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); const s = Math.hypot(e[0], e[1], e[2]); if (s < 1e-4) continue; pts.push([e[12], e[13], e[14], s, o.name]); }
  });
  let minR = 1e9, n40 = 0, n55 = 0, worst = null; const byName = {};
  for (const p of pts) byName[p[4]] = (byName[p[4]] || 0) + 1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j]; const d = Math.hypot(a[0]-b[0], a[2]-b[2]); const s = Math.max(a[3], b[3]); const r = d / s;
    if (r < minR) { minR = r; worst = [a, b]; }
    if (r < 0.40) n40++; if (r < 0.55) n55++;
  }
  let dbg = null; try { dbg = root.userData.civ; } catch (e) {}
  return { n: pts.length, byName, minRatio: +minR.toFixed(3), pairsUnder040: n40, pairsUnder055: n55, worst: worst && worst.map(p => p.map(v => typeof v === 'number' ? +v.toFixed(2) : v)), dbg };
}"""
PROPS_JS = """async () => {
  const { PROP_INFO } = await import('/src/city/citygen.ts');
  const w = window.__BT__.world; const city = w.city;
  const root = window.__BT__.debugCore.scene.getObjectByName('civilians');
  const m = new root.matrixWorld.constructor(); const e = m.elements; const pts = [];
  root.traverse(o => { if (!o.isInstancedMesh || /ink|puff/i.test(o.name) || !o.visible) return;
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); const s = Math.hypot(e[0], e[1], e[2]); if (s < 1e-4) continue; pts.push([e[12], e[14], s]); } });
  let inside = 0, insideTraffic = 0; const kinds = {}; const ex = [];
  for (const [x, z, s] of pts) {
    for (const p of city.props) {
      if (!p.alive) continue; const inf = PROP_INFO[p.kind]; if (!inf) continue;
      const tree = p.kind === 'tree'; const hw = (tree ? 0.3 : inf.wid * 0.5) - 0.1, hl = (tree ? 0.3 : inf.len * 0.5) - 0.1;
      const dx = x - p.x, dz = z - p.z; if (dx*dx + dz*dz > (hw + hl) ** 2) continue;
      const sn = Math.sin(p.heading), cs = Math.cos(p.heading);
      const u = dx * cs - dz * sn, wv = dx * sn + dz * cs;
      if (Math.abs(u) < hw && Math.abs(wv) < hl) { inside++; if (p.lane >= 0) insideTraffic++; kinds[p.kind] = (kinds[p.kind]||0)+1; if (ex.length < 6) ex.push([p.kind, p.lane, +x.toFixed(1), +z.toFixed(1), +p.x.toFixed(1), +p.z.toFixed(1)]); break; }
    }
  }
  return { civs: pts.length, insideProp: inside, insideTraffic, kinds, ex };
}"""
BLD_JS = """() => {
  const city = window.__BT__.world.city;
  const root = window.__BT__.debugCore.scene.getObjectByName('civilians');
  const m = new root.matrixWorld.constructor(); const e = m.elements; const pts = [];
  root.traverse(o => { if (!o.isInstancedMesh || /ink|puff/i.test(o.name) || !o.visible) return;
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); const s = Math.hypot(e[0], e[1], e[2]); if (s < 1e-4) continue; pts.push([e[12], e[14], s]); } });
  let inside = 0, near = 0; const arch = {}; const ex = [];
  for (const [x, z, s] of pts) for (const b of city.buildings) {
    if (b.collapsed) continue;
    const ax = Math.abs(x - b.x) - b.w / 2, az = Math.abs(z - b.z) - b.d / 2;
    if (ax < -0.05 && az < -0.05) { inside++; arch[b.arch] = (arch[b.arch]||0)+1; if (ex.length<5) ex.push([b.arch, b.shape, +x.toFixed(1), +z.toFixed(1)]); break; }
    if (ax < 0.3 * s && az < 0.3 * s) { near++; break; }
  }
  return { civs: pts.length, insideBuilding: inside, withinBodyOfFacade: near, arch, ex };
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
        elif kind == "audit":
            try: print("audit", rest, json.dumps(pg.evaluate(AUDIT_JS)))
            except Exception as e: print("audit error:", e)
        elif kind == "props":
            try: print("props", rest, json.dumps(pg.evaluate(PROPS_JS)))
            except Exception as e: print("props error:", e)
        elif kind == "bld":
            try: print("bld", rest, json.dumps(pg.evaluate(BLD_JS)))
            except Exception as e: print("bld error:", e)
        elif kind == "perf":
            try: print("perf", rest, json.dumps(pg.evaluate(PERF_JS), indent=None))
            except Exception as e: print("perf error:", e)
        else:
            print("unknown step", st)
    b.close()
for e in errors[:40]: print(e)
print("errors:", len(errors))
