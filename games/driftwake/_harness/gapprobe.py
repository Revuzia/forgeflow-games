#!/usr/bin/env python
"""
The port-vs-reference gap, at ultra, with the measurement order cancelled.

`perfprobe.py` walks its targets in a fixed order, so anything that drifts over
a run — thermals, the browser's own caches, whatever else is on the machine —
lands entirely on the target measured last. That is fine for "how fast is this"
and not fine for "how much of the gap did we close", which is a RATIO between
targets and is exactly what an order effect corrupts.

So: three arms, measured forward and then backward inside one browser, and the
two passes reported separately as well as averaged. The third arm is the
DEPLOYED CDN build, which is the pre-optimisation code — an in-session "before"
that does not depend on the absolute numbers in an older brief being
reproducible on a machine whose background load has since changed.

    python gapprobe.py --seconds 10
"""
import argparse, json, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

ARMS = {
    "before (CDN, pre-opt)": "https://forgeflow-games-cdn.isimcha85.workers.dev/snowflow/index.html",
    "after  (local, opt)":   "http://localhost:8799/games/driftwake/index.html",
    "reference (WebGPU)":    "https://snowflow-lilac.vercel.app/",
}

SAMPLER = """
window.__ft = [];
(function () {
  let prev = performance.now();
  function tick() { const n = performance.now(); window.__ft.push(n - prev); prev = n;
                    requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})();
"""

POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay','#crosshair'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""


def measure(br, url, seconds, w, h):
    pg = br.new_page(viewport={"width": w, "height": h})
    pg.add_init_script(SAMPLER)
    try:
        pg.goto(url, wait_until="load", timeout=90_000)
    except Exception as e:
        print(f"    navigation failed: {e}"); pg.close(); return None
    for _ in range(160):
        if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
            break
        pg.wait_for_timeout(500)
    else:
        print("    never became ready"); pg.close(); return None
    pg.evaluate(POSE)
    pg.wait_for_timeout(2500)
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
    st = pg.evaluate("""() => { const s = globalThis.SNOWFLOW.perfStats;
        return s ? {gpuMs: s.gpuMs, draws: s.drawCalls} : {}; }""")
    pg.close()
    if not ft: return None
    med = statistics.median(ft)
    return {"median_ms": round(med, 2), "fps": round(1000 / med, 1),
            "gpuMs": round(st.get("gpuMs") or 0, 2), "draws": st.get("draws"),
            "n": len(ft)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    names = list(ARMS)
    passes = {"forward": names, "backward": names[::-1]}
    results = {n: [] for n in names}

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        for pname, order in passes.items():
            print(f"\n--- pass: {pname} ---")
            for n in order:
                r = measure(br, ARMS[n], args.seconds, args.width, args.height)
                if r:
                    results[n].append(r)
                    print(f"  {n:24} {r['fps']:6.1f} fps  median {r['median_ms']:7.2f} ms  "
                          f"gpu {r['gpuMs']:6.2f}  draws {r['draws']}")
        br.close()

    print("\n--- mean of the two passes ---")
    agg = {}
    for n in names:
        if not results[n]: continue
        agg[n] = {k: round(statistics.mean(r[k] for r in results[n]), 2)
                  for k in ("median_ms", "gpuMs")}
        agg[n]["fps"] = round(1000 / agg[n]["median_ms"], 1)
        print(f"  {n:24} {agg[n]['fps']:6.1f} fps  median {agg[n]['median_ms']:7.2f} ms  "
              f"gpu {agg[n]['gpuMs']:6.2f}")

    ref = agg.get("reference (WebGPU)")
    if ref:
        print("\n--- gap to the reference (positive = port is slower) ---")
        for n in ("before (CDN, pre-opt)", "after  (local, opt)"):
            if n not in agg: continue
            for k in ("median_ms", "gpuMs"):
                print(f"  {n:24} {k:10} {100*(agg[n][k]/ref[k]-1):+7.1f}%")
        b, a = agg.get("before (CDN, pre-opt)"), agg.get("after  (local, opt)")
        if b and a:
            for k in ("median_ms", "gpuMs"):
                gb, ga = b[k] / ref[k] - 1, a[k] / ref[k] - 1
                closed = 100 * (gb - ga) / gb if gb else float("nan")
                print(f"  gap closed on {k:10} {closed:+7.1f}%  ({100*gb:+.1f}% -> {100*ga:+.1f}%)")

    print("\n" + json.dumps({"per_pass": results, "mean": agg}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
