#!/usr/bin/env python
"""ASCENDANT perf check — draw calls, triangles and real frame cost per stage.

Loads each stage, walks the player along the checkpoint spline so the whole level
streams through the camera, and samples renderer.info + a gl.finish()-bracketed
render timing (absolute ms are inflated by the browser's rAF throttle, but the
RELATIVE split between stages and between quality presets is valid — see
feedback_forgeflow_games_fps).

    python perfcheck.py
    python perfcheck.py --stages neon-1,foundry-2 --quality high
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/ascendant/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

BUDGET = {"drawCalls": 220, "tris": 350_000, "minFps": 55}

SAMPLE_JS = r"""
async (samples) => {
  const A = globalThis.ASCENDANT;
  if (!A || !A.game || !A.game.stage) return {error:'no stage'};
  const G = A.game, S = G.stage, P = G.player, R = A.engine.renderer;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const pts = [];
  const sp = S.spawnFor ? S.spawnFor(0) : null;
  if (sp) pts.push(sp.pos.clone ? sp.pos.clone() : sp.pos);
  (S.checkpoints||[]).forEach(c => pts.push(c.position || c.pos || (c.mesh && c.mesh.position)));
  if (S.finish) pts.push(S.finish.position || S.finish.pos || (S.finish.mesh && S.finish.mesh.position));
  const clean = pts.filter(Boolean);
  const out = {drawCalls:0, tris:0, frames:0, worstDraw:0, worstTris:0,
               fps:[], stationsSampled:0, points: clean.length};
  const stations = Math.max(1, Math.min(samples, clean.length * 3));
  for (let i = 0; i < stations; i++) {
    const t = i / Math.max(1, stations - 1) * (clean.length - 1);
    const i0 = Math.floor(t), i1 = Math.min(clean.length - 1, i0 + 1), f = t - i0;
    const a = clean[i0], b = clean[i1];
    if (!a || !b) continue;
    const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
    if (P && P.__test) { P.__test.teleport(new A.THREE.Vector3(x, y + 1.0, z)); P.__test.setVel(new A.THREE.Vector3(0,0,0)); }
    for (let k = 0; k < 8; k++) await frame();          // let culling + LOD settle
    let dc = 0, tr = 0, fps = 0, n = 0;
    for (let k = 0; k < 10; k++) {
      await frame();
      dc = Math.max(dc, R.info.render.calls); tr = Math.max(tr, R.info.render.triangles);
      if (A.engine.stats && A.engine.stats.fps) { fps += A.engine.stats.fps; n++; }
    }
    out.drawCalls += dc; out.tris += tr; out.frames++;
    out.worstDraw = Math.max(out.worstDraw, dc); out.worstTris = Math.max(out.worstTris, tr);
    if (n) out.fps.push(Math.round(fps / n));
    out.stationsSampled++;
  }
  out.avgDraw = Math.round(out.drawCalls / Math.max(1, out.frames));
  out.avgTris = Math.round(out.tris / Math.max(1, out.frames));
  out.minFps = out.fps.length ? Math.min(...out.fps) : null;
  out.avgFps = out.fps.length ? Math.round(out.fps.reduce((a,b)=>a+b,0)/out.fps.length) : null;
  out.hazards = (S.hazards||[]).length;
  out.programs = R.info.programs ? R.info.programs.length : null;
  out.geometries = R.info.memory.geometries; out.textures = R.info.memory.textures;
  return out;
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--samples", type=int, default=12)
    ap.add_argument("--json", default=os.path.join(HERE, "perfcheck.json"))
    args = ap.parse_args()

    if args.stages:
        stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    else:
        d = os.path.join(HERE, "..", "runtime", "data", "stages")
        stages = sorted(f[:-3] for f in os.listdir(d) if f.endswith(".js")) if os.path.isdir(d) else []

    results = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        for sid in stages:
            url = f"{BASE}?dev=1&quality={args.quality}&stage={sid}"
            try:
                pg.goto(url, wait_until="load", timeout=60_000)
            except Exception as e:
                results[sid] = {"error": f"nav: {e}"}
                continue
            deadline = time.time() + 60
            ok = False
            while time.time() < deadline:
                try:
                    if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.stage)"):
                        ok = True
                        break
                except Exception:
                    pass
                pg.wait_for_timeout(400)
            if not ok:
                results[sid] = {"error": "stage never loaded"}
                continue
            for sel in ["#ui button.asc-btn:visible:has-text('NEW RUN')", "#ui button.asc-btn:visible:has-text('CONTINUE')", "#ui button.asc-btn:visible:has-text('PLAY')", "#ui button.asc-btn.is-primary:visible", "button.asc-btn:visible"]:
                try:
                    el = pg.query_selector(sel)
                    if el:
                        el.click()
                        break
                except Exception:
                    pass
            pg.wait_for_timeout(1500)
            try:
                results[sid] = pg.evaluate(SAMPLE_JS, args.samples)
            except Exception as e:
                results[sid] = {"error": str(e)}
        br.close()

    print(json.dumps(results, indent=2)[:6000])
    print("\nstage         draws(avg/max)   tris(avg/max)      fps(min/avg)  hz  verdict")
    print("-" * 82)
    fails = 0
    for sid, r in results.items():
        if "error" in r:
            print(f"{sid:<13} ERROR: {r['error'][:60]}")
            fails += 1
            continue
        bad = (r.get("worstDraw", 0) > BUDGET["drawCalls"]
               or r.get("worstTris", 0) > BUDGET["tris"]
               or (r.get("minFps") is not None and r["minFps"] < BUDGET["minFps"]))
        fails += 1 if bad else 0
        print(f"{sid:<13} {r.get('avgDraw'):>5}/{r.get('worstDraw'):<8} "
              f"{r.get('avgTris'):>8}/{r.get('worstTris'):<9} "
              f"{str(r.get('minFps')):>4}/{str(r.get('avgFps')):<6} {r.get('hazards'):>3}  "
              f"{'OVER BUDGET' if bad else 'ok'}")
    print("-" * 82)
    print(f"budget: <= {BUDGET['drawCalls']} draws, <= {BUDGET['tris']} tris, >= {BUDGET['minFps']} fps")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
