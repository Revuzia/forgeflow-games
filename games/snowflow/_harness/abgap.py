#!/usr/bin/env python
"""
Before-vs-after at ultra, paired and alternated.

The optimisations that fire at DEFAULT settings are worth single-digit
milliseconds each, and this machine's run-to-run spread on a ten-second median
is itself several milliseconds — so an unpaired "measure A, then measure B"
cannot resolve them. This alternates A,B,A,B,... so any drift over the run is
shared between the arms, and reports the per-rep pairs so the reader can see the
spread rather than take a mean on trust.

"before" is the DEPLOYED CDN build, verified pre-optimisation (it has no
`applyPreset` and no `performance` preset). "after" is the working tree.

    python abgap.py --reps 4 --seconds 8
"""
import argparse, json, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

ARMS = [
    ("before", "https://forgeflow-games-cdn.isimcha85.workers.dev/snowflow/index.html"),
    ("after",  "http://localhost:8799/games/snowflow/index.html"),
]

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
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""


def measure(br, url, seconds, w, h):
    pg = br.new_page(viewport={"width": w, "height": h})
    pg.add_init_script(SAMPLER)
    pg.goto(url, wait_until="load", timeout=90_000)
    for _ in range(160):
        if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
            break
        pg.wait_for_timeout(500)
    pg.evaluate(POSE)
    pg.wait_for_timeout(2500)
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
    draws = pg.evaluate("() => { const s = globalThis.SNOWFLOW.perfStats; return s ? s.drawCalls : 0; }")
    pg.close()
    return (statistics.median(ft) if ft else None), draws


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--aa", action="store_true",
                    help="A/A control: point BOTH arms at the local build. Whatever "
                         "separation this reports is the harness's own noise, and no "
                         "A/B difference smaller than it can be claimed.")
    args = ap.parse_args()

    global ARMS
    if args.aa:
        ARMS = [("before", ARMS[1][1]), ("after", ARMS[1][1])]

    got = {"before": [], "after": []}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        for i in range(args.reps):
            # Alternate the WITHIN-pair order too, so neither arm is always warm.
            pair = ARMS if i % 2 == 0 else ARMS[::-1]
            line = [f"rep {i+1}:"]
            for name, url in pair:
                med, draws = measure(br, url, args.seconds, args.width, args.height)
                if med is None:
                    line.append(f"{name}=FAILED"); continue
                got[name].append(med)
                line.append(f"{name} {med:7.2f} ms ({1000/med:4.1f} fps, {draws} draws)")
            print("   ".join(line))
        br.close()

    print()
    for n in ("before", "after"):
        xs = got[n]
        if not xs: continue
        print(f"  {n:7} n={len(xs)}  median-of-medians {statistics.median(xs):7.2f} ms  "
              f"mean {statistics.mean(xs):7.2f}  "
              f"stdev {statistics.stdev(xs) if len(xs) > 1 else 0:5.2f}  "
              f"[{min(xs):.2f}, {max(xs):.2f}]")
    if got["before"] and got["after"]:
        b, a = statistics.mean(got["before"]), statistics.mean(got["after"])
        # Paired deltas: rep i's before against rep i's after.
        pairs = list(zip(got["before"], got["after"]))
        d = [x - y for x, y in pairs]
        print(f"\n  per-rep paired delta (before - after), ms: "
              f"{[round(v, 2) for v in d]}")
        print(f"  mean paired delta {statistics.mean(d):+.2f} ms"
              + (f"  stdev {statistics.stdev(d):.2f}" if len(d) > 1 else ""))
        print(f"  after is {100*(1 - a/b):+.1f}% of before's frame time "
              f"({b:.2f} -> {a:.2f} ms)")
    print("\n" + json.dumps(got, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
