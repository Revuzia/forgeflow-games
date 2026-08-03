#!/usr/bin/env python
"""
Frame time at every preset rung, measured through the PUBLIC setter.

`perfprobe.py` writes `SF.S.resolutionScale` directly and sweeps a single
preset. This drives the rungs the way the overlay does — `SNOWFLOW.applyPreset`
— and reads the drawing-buffer size back afterwards, because the whole reason
this script exists is that a preset that reports success and resizes nothing is
the exact failure that was shipped once already.

    python presetprobe.py --seconds 10
"""
import argparse, json, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SAMPLER = """
window.__ft = [];
(function () {
  let prev = performance.now();
  function tick() {
    const now = performance.now();
    window.__ft.push(now - prev);
    prev = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
"""

POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]


def probe(pg, seconds, preset):
    applied = pg.evaluate("""(name) => {
        const SF = globalThis.SNOWFLOW;
        if (typeof SF.applyPreset !== 'function') return {err: 'applyPreset MISSING'};
        SF.applyPreset(name);
        return {err: null};
    }""", preset)
    if applied.get("err"):
        print(f"  {preset:14} {applied['err']}"); return None
    pg.evaluate(POSE)
    pg.wait_for_timeout(3000)              # settle: RT rebuilds + TAA history
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
    if not ft:
        print(f"  {preset:14} no frames"); return None
    med = statistics.median(ft)
    info = pg.evaluate("""() => {
        const SF = globalThis.SNOWFLOW, r = SF.renderer, s = SF.perfStats;
        return {
            preset: SF.S.preset, scale: SF.S.resolutionScale,
            deform: SF.S.deformResolution,
            bufW: r.domElement.width, bufH: r.domElement.height,
            pr: r.getPixelRatio(),
            gpuMs: s ? s.gpuMs : 0, draws: s ? s.drawCalls : 0, tris: s ? s.triangles : 0,
            ssr: SF.S.ssr, dof: SF.S.dof, bloom: SF.S.bloom,
            mountains: SF.S.showMountains, shafts: SF.S.showLightShafts,
        };
    }""")
    row = {"preset": preset, "n": len(ft), "median_ms": round(med, 2),
           "fps": round(1000 / med, 1), "p95_ms": round(pct(ft, 0.95), 2),
           "gpuMs": round(info.get("gpuMs") or 0, 2),
           "draws": info.get("draws"), "tris": info.get("tris"),
           "S.preset": info.get("preset"), "S.resolutionScale": info.get("scale"),
           "drawingBuffer": f"{info.get('bufW')}x{info.get('bufH')}",
           "deformResolution": info.get("deform"),
           "ssr": info.get("ssr"), "dof": info.get("dof"), "bloom": info.get("bloom"),
           "showMountains": info.get("mountains"), "shafts": info.get("shafts")}
    print(f"  {preset:12} {row['fps']:6.1f} fps  median {row['median_ms']:7.2f} ms  "
          f"p95 {row['p95_ms']:7.2f}  gpu {row['gpuMs']:6.2f}  draws {row['draws']:3}  "
          f"buf {row['drawingBuffer']:>10}  scale {row['S.resolutionScale']}  "
          f"deform {row['deformResolution']}")
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--url", default="http://localhost:8799/games/snowflow/index.html")
    ap.add_argument("--presets", default="ultra,high,balanced,performance,ultra")
    args = ap.parse_args()

    out = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.add_init_script(SAMPLER)
        pg.goto(args.url, wait_until="load", timeout=90_000)
        for _ in range(160):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                break
            pg.wait_for_timeout(500)
        surface = pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            return {members: Object.keys(SF).sort(),
                    hasSet: typeof SF.set === 'function',
                    hasApplyPreset: typeof SF.applyPreset === 'function',
                    presets: SF.PRESETS ? Object.keys(SF.PRESETS) : null};
        }""")
        print(f"{args.url}\n  set={surface['hasSet']}  applyPreset={surface['hasApplyPreset']}  "
              f"PRESETS={surface['presets']}\n")
        for name in args.presets.split(","):
            r = probe(pg, args.seconds, name.strip())
            if r: out.append(r)
        pg.close(); br.close()

    print("\n" + json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
