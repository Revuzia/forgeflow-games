#!/usr/bin/env python
"""
Frame-time probe — port vs the WebGPU reference, on the same GPU.

Answers the only question that matters before optimising: is the port slow
because of how it was built, or because this machine cannot run the demo at
all? The reference is the control. Both are driven through the shared
`SNOWFLOW` surface at an identical camera pose.

    python perfprobe.py
    python perfprobe.py --seconds 12 --scale 0.75
"""
import argparse, json, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

TARGETS = [
    ("port-cdn", "https://forgeflow-games-cdn.isimcha85.workers.dev/snowflow/index.html"),
    ("port-local", "http://localhost:8799/games/driftwake/index.html"),
    ("reference", "https://snowflow-lilac.vercel.app/"),
]

# rAF sampler. Records raw inter-frame deltas; the page's own loop is what we
# are measuring, so we must not add work inside it beyond a push.
SAMPLER = """
window.__ft = [];
(function () {
  let prev = performance.now();
  function tick(t) {
    const now = performance.now();
    window.__ft.push(now - prev);
    prev = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
"""


def pct(xs, p):
    if not xs: return 0.0
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]


def probe(pg, seconds, label, scale=None, preset=None):
    pg.evaluate("""(cfg) => {
        const SF = globalThis.SNOWFLOW;
        SF.character.position.x = 0; SF.character.position.z = 0;
        SF.character.position.y = SF.terrain.heightAt(0, 0);
        SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
        SF.rig.distance = SF.rig.distanceTarget = 6.2;
        if (cfg.scale != null) SF.S.resolutionScale = cfg.scale;
        if (cfg.preset != null) SF.S.preset = cfg.preset;
        for (const s of ['#boot','#hint','#overlay','#crosshair'])
            document.querySelectorAll(s).forEach(e => e.style.display='none');
    }""", {"scale": scale, "preset": preset})
    pg.wait_for_timeout(2500)              # let it settle at the new config
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = pg.evaluate("window.__ft")
    ft = [f for f in ft if 0.5 < f < 500][8:]   # drop warm-up + absurdities
    if not ft:
        print(f"  {label:26} no frames"); return None
    med = statistics.median(ft)
    stats = pg.evaluate("""() => { const s = globalThis.SNOWFLOW && SNOWFLOW.perfStats;
        return s ? {gpuMs: s.gpuMs, draws: s.drawCalls, tris: s.triangles} : {}; }""")
    row = {"label": label, "n": len(ft), "median_ms": round(med, 2),
           "fps": round(1000 / med, 1), "p95_ms": round(pct(ft, 0.95), 2),
           "low1_ms": round(pct(ft, 0.99), 2),
           "gpuMs": round(stats.get("gpuMs") or 0, 2),
           "draws": stats.get("draws"), "tris": stats.get("tris")}
    print(f"  {label:26} {row['fps']:6.1f} fps   median {row['median_ms']:6.2f} ms   "
          f"p95 {row['p95_ms']:6.2f}   1%low {row['low1_ms']:6.2f}   "
          f"gpu {row['gpuMs']:5.2f}   draws {row['draws']}")
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--only", default="", help="substring filter on target name")
    args = ap.parse_args()

    out = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        for name, url in TARGETS:
            if args.only and args.only not in name:
                continue
            pg = br.new_page(viewport={"width": args.width, "height": args.height})
            pg.add_init_script(SAMPLER)
            try:
                pg.goto(url, wait_until="load", timeout=90_000)
            except Exception as e:
                print(f"{name}: navigation failed: {e}"); pg.close(); continue
            ok = False
            for _ in range(160):
                if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                    ok = True; break
                pg.wait_for_timeout(500)
            if not ok:
                print(f"{name}: never became ready"); pg.close(); continue
            print(f"\n{name}  ({url})")
            r = probe(pg, args.seconds, "default (ultra, scale 1.0)")
            if r: out.append({**r, "target": name})
            # Only sweep the knobs on the port — the point is what WE can change.
            if name.startswith("port"):
                for lbl, sc, pr in (("scale 0.75", 0.75, None),
                                    ("scale 0.5", 0.5, None),
                                    ("preset balanced", None, "balanced")):
                    r = probe(pg, args.seconds, lbl, scale=sc, preset=pr)
                    if r: out.append({**r, "target": name})
            pg.close()
        br.close()

    print("\n" + json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
