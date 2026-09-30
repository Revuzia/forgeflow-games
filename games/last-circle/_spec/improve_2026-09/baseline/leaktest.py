#!/usr/bin/env python
"""Match-over-match GPU resource growth. One page, K back-to-back matches on the SAME map and seed, started through
__LC__.startMatch exactly as PLAY AGAIN does (ffg_royale3d.js onAgain -> startMatch). Each match: lobby shown ->
Enter -> fastForward to the end with a couple of real seconds of frames in between (so the view builds what a
player would see). Records renderer.info (programs / geometries / textures), JS heap and kernel mixer count at the
same two points of every match: right after the lobby is shown, and at match end.
A leak shows up as a per-match increase at the same point; a cache shows up as a one-time step after match 1.
    python leaktest.py [K=4] [map=ashgrid]
"""
import json
import sys
import time
from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import lc_liveprobe as P  # noqa: E402

K = int(sys.argv[1]) if len(sys.argv) > 1 else 4
MAP = sys.argv[2] if len(sys.argv) > 2 else "ashgrid"
flags = list(P.FLAGS) + ["--force_high_performance_gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"]
SNAP = r"""(tag) => { const W = window.__LC__.W, i = W.kernel.renderer.info;
  return { tag, programs: i.programs.length, geometries: i.memory.geometries, textures: i.memory.textures,
           heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
           mixers: W.kernel._mixers ? W.kernel._mixers.length : null, updaters: W.kernel._updaters ? W.kernel._updaters.length : null,
           sceneObjects: (() => { let n = 0; W.scene.traverse(() => n++); return n; })(), t: +W.t.toFixed(1), phase: W.phase }; }"""


def main():
    rows = []
    errs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True, args=flags)
        pg = b.new_page(viewport={"width": 1600, "height": 900})
        pg.on("pageerror", lambda e: errs.append(str(e)[:400]))
        pg.goto(P.URL, wait_until="commit", timeout=120000)
        t0 = time.time()
        while time.time() - t0 < 150:
            if pg.evaluate("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)"):
                break
            time.sleep(0.2)
        time.sleep(1.0)
        rows.append(pg.evaluate(SNAP, "menu"))
        for m in range(K):
            tl = time.time()
            pg.evaluate("async (m) => { await window.__LC__.startMatch({ mode: 'standard', mapId: m, seed: 4242 }); }", MAP)
            r = pg.evaluate(SNAP, "m%d_lobby" % (m + 1))
            r["load_s"] = round(time.time() - tl, 1)
            rows.append(r)
            print(r, flush=True)
            time.sleep(0.3)
            pg.keyboard.press("Enter")
            time.sleep(2.0)
            for _ in range(150):
                s = pg.evaluate("() => { const C = window.__LC__; if (C.W.match && C.W.match.over) return 'over'; C.fastForward(10, 1/30); return C.W.match.aliveCount(); }")
                time.sleep(0.25)
                if s == "over":
                    break
            time.sleep(3.0)     # real frames: endMatch fires in the frame pipeline, the post-match panel after 2.6 s
            r = pg.evaluate(SNAP, "m%d_end" % (m + 1))
            rows.append(r)
            print(r, flush=True)
        b.close()
    out = {"map": MAP, "K": K, "rows": rows, "pageerrors": errs}
    with open(P.os.path.join(P.REPORTS, "leaktest_%s_%s.json" % (MAP, time.strftime("%Y%m%d_%H%M%S"))), "w") as fh:
        json.dump(out, fh, indent=1)
    print("pageerrors:", len(errs), errs[:3])


if __name__ == "__main__":
    main()
