#!/usr/bin/env python
"""Discriminate the multi-second composer.render stalls seen after __LC__.fastForward in lc_liveprobe.py.

Hypotheses:
  H1 "block": ANY multi-second main-thread block (GPU idles, then the first frame pays) -> stall after a plain
      busy-wait that changes nothing in the sim, too.
  H2 "content": what fastForward changes (actors moved/died, loot dropped, storm moved) makes the next render slow
      -> stall after fastForward only, not after an equal-length busy-wait.
Arms (interleaved, N each): BUSY (JS busy-wait of the same wall time as the last fastForward), FF (fastForward 10 s),
FREE (python sleeps; frames keep flowing = no block). Reported per arm: render-submit ms of the first 3 frames after.
Same launch profile as lc_liveprobe.py dgpu-uncapped.
"""
import json
import statistics
import sys
import time
from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import lc_liveprobe as P  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
MAP = sys.argv[2] if len(sys.argv) > 2 else "ashgrid"
flags = list(P.FLAGS) + ["--force_high_performance_gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"]

HOOK = r"""() => {
  const k = window.__LC__.W.kernel;
  if (k.__st) return 'already';
  const S = k.__st = { rec: [], cur: null };
  const comp = k.composer, cr = comp.render.bind(comp);
  comp.render = function (d) { const t = performance.now(); const x = cr(d); S.rec.push(+(performance.now() - t).toFixed(1)); if (S.rec.length > 400) S.rec.shift(); return x; };
  return 'ok';
}"""


# What is in the scene, per W._groups entry: visible drawables (a proxy for draw calls before culling) and the
# distinct textures they reference. Taken at landing and at match end to see what accumulates over a match.
CENSUS = r"""() => {
  const W = window.__LC__.W, out = {}, texAll = new Set();
  const roots = Object.assign({}, W._groups);
  for (const c of W.scene.children) if (!Object.values(W._groups).includes(c)) roots['(scene) ' + (c.name || c.type)] = c;
  for (const [name, g] of Object.entries(roots)) {
    let meshes = 0, inst = 0, sprites = 0, points = 0, lines = 0, skinned = 0, instCount = 0; const tex = new Set();
    g.traverseVisible((o) => {
      if (o.isInstancedMesh) { inst++; instCount += o.count; }
      else if (o.isSkinnedMesh) skinned++;
      else if (o.isMesh) meshes++;
      else if (o.isSprite) sprites++;
      else if (o.isPoints) points++;
      else if (o.isLine) lines++;
      const m = o.material; if (!m) return;
      for (const mm of (Array.isArray(m) ? m : [m])) for (const k in mm) { const v = mm[k]; if (v && v.isTexture) { tex.add(v.uuid); texAll.add(v.uuid); } }
    });
    out[name] = { meshes, skinned, inst, instCount, sprites, points, lines, textures: tex.size };
  }
  const info = W.kernel.renderer.info;
  return { groups: out, texturesReferenced: texAll.size, rendererTextures: info.memory.textures, rendererGeometries: info.memory.geometries,
           programs: info.programs.length, t: W.t, alive: W.match ? W.match.aliveCount() : null, lootItems: W.loot && W.loot.items ? W.loot.items.length : null };
}"""


def main():
    out = {"map": MAP, "N": N, "arms": {"BUSY": [], "FF": [], "FREE": []}}
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True, args=flags)
        pg = b.new_page(viewport={"width": 1600, "height": 900})
        pg.goto(P.URL, wait_until="commit", timeout=120000)
        t0 = time.time()
        while time.time() - t0 < 150:
            if pg.evaluate("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel && window.__LC__.W.kernel.composer)"):
                break
            time.sleep(0.2)
        pg.evaluate("async (m) => { await window.__LC__.startMatch({ mode: 'standard', mapId: m, seed: 777 }); }", MAP)
        time.sleep(0.3)
        pg.keyboard.press("Enter")
        time.sleep(1.0)
        for _ in range(40):
            if pg.evaluate("() => { const C = window.__LC__, p = C.W.player; if (p && !p.gliding && C.W.phase === 'match') return true; C.fastForward(3, 1/30); return false; }"):
                break
        print(pg.evaluate(HOOK), flush=True)
        out["census_landed"] = pg.evaluate(CENSUS)
        print("census_landed", json.dumps(out["census_landed"]), flush=True)
        time.sleep(3.0)
        last_ff_ms = 800
        for i in range(N):
            for arm in ("FREE", "BUSY", "FF"):
                pg.evaluate("() => { window.__LC__.W.kernel.__st.rec = []; }")
                if arm == "FREE":
                    time.sleep(last_ff_ms / 1000.0)
                    blk = 0
                elif arm == "BUSY":
                    blk = pg.evaluate("(ms) => { const t = performance.now(); while (performance.now() - t < ms) {} return Math.round(performance.now() - t); }", last_ff_ms)
                else:
                    blk = pg.evaluate("() => { const t = performance.now(); const C = window.__LC__; if (!(C.W.match && C.W.match.over)) C.fastForward(10, 1/30); return Math.round(performance.now() - t); }")
                    last_ff_ms = max(300, blk)
                time.sleep(2.0)
                rec = pg.evaluate("() => window.__LC__.W.kernel.__st.rec.slice()")
                # for FREE the "first frames" are simply the first frames recorded in the window
                out["arms"][arm].append({"block_ms": blk, "first3": rec[:3], "n": len(rec),
                                         "max": max(rec) if rec else None, "median": statistics.median(rec) if rec else None})
                print(arm, i, blk, rec[:3], "n=%d max=%s" % (len(rec), max(rec) if rec else None), flush=True)
        # run the match to (near) the end and take the census again, with a render in between so the view catches up
        for _ in range(120):
            s = pg.evaluate("() => { const C = window.__LC__; if (C.W.match && C.W.match.over) return 'over'; C.fastForward(10, 1/30); return C.W.match.aliveCount(); }")
            time.sleep(0.3)
            if s == "over" or (isinstance(s, int) and s <= 2):
                break
        time.sleep(3.0)
        out["census_end"] = pg.evaluate(CENSUS)
        print("census_end", json.dumps(out["census_end"]), flush=True)
        b.close()
    summ = {}
    for arm, xs in out["arms"].items():
        f1 = [x["first3"][0] for x in xs if x["first3"]]
        mx = [x["max"] for x in xs if x["max"] is not None]
        summ[arm] = {"first_frame_median": statistics.median(f1) if f1 else None, "first_frame_max": max(f1) if f1 else None,
                     "window_max_median": statistics.median(mx) if mx else None,
                     "frames_per_2s_median": statistics.median([x["n"] for x in xs]) if xs else None,
                     "block_ms_median": statistics.median([x["block_ms"] for x in xs]) if xs else None}
    out["summary"] = summ
    print(json.dumps(summ, indent=1))
    with open(P.os.path.join(P.REPORTS, "stalltest_%s_%s.json" % (MAP, time.strftime("%Y%m%d_%H%M%S"))), "w") as fh:
        json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
