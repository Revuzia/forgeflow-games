#!/usr/bin/env python
"""
Paired A/B probe for the fixed-cost passes (cascades + deformation sim).

`gpuprofile.py` maps the whole frame; this is the tight loop for one change.
It reports the per-pass table at ONE resolution and, crucially, prints each
pass NORMALISED against a control pass that the change under test does not
touch. On this machine the absolute milliseconds drift by tens of percent
across a session (27 Chrome processes, sustained-load degradation), so a
before/after comparison of raw ms is worthless on its own; a ratio against a
pass that did not change is not.

    python abprobe.py --tag before
    python abprobe.py --tag after --control "shadow cascades"
    python abprobe.py --tag after-walk --walk

`--walk` holds KeyW down through a real dispatched KeyboardEvent, because the
deformation sim's cost profile is completely different when brushes are
actually being written.
"""
import argparse, json, os, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8799/games/driftwake/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# The identical pose perfprobe.py and gpuprofile.py use.
POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""

WALK_ON = """() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW', bubbles: true}));
}"""
WALK_OFF = """() => {
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW', bubbles: true}));
}"""

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


def med(xs):
    return statistics.median(xs) if xs else 0.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--tag", default="run")
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--cool", type=float, default=4.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--walk", action="store_true",
                    help="hold KeyW so the deformation sim gets real brushes")
    ap.add_argument("--control", default="shadow cascade 0",
                    help="pass name used as the drift normaliser")
    ap.add_argument("--out", default=os.path.join(HERE, "abprobe.json"))
    args = ap.parse_args()

    reps = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.add_init_script(SAMPLER)
        pg.goto(args.url, wait_until="load", timeout=90_000)
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                break
            pg.wait_for_timeout(500)
        else:
            print("never became ready", file=sys.stderr); br.close(); return 1

        pg.evaluate(POSE)
        pg.evaluate("() => { SNOWFLOW.S.debugProfile = true; }")
        pg.wait_for_timeout(2500)

        for i in range(args.reps):
            # Thermal reset between windows, exactly as gpuprofile.py does.
            if args.walk: pg.evaluate(WALK_OFF)
            pg.set_viewport_size({"width": 160, "height": 90})
            pg.wait_for_timeout(int(args.cool * 1000))
            pg.set_viewport_size({"width": args.width, "height": args.height})
            if args.walk: pg.evaluate(WALK_ON)
            pg.wait_for_timeout(2000)
            pg.evaluate("() => SNOWFLOW.perfProfileReset()")
            pg.evaluate("window.__ft = [];")
            pg.wait_for_timeout(int(args.seconds * 1000))
            raw = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
            prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
            passes = {p["name"]: p["ms"] for p in prof["passes"] if p["n"] > 0}
            reps.append({"frame": med(raw), "n": len(raw), "passes": passes,
                         "dropped": prof["dropped"] + prof.get("bogus", 0)})
            print(f"  [rep{i+1}] frame {med(raw):7.2f} ms  frames {len(raw)}")
        if args.walk: pg.evaluate(WALK_OFF)
        pg.evaluate("() => { SNOWFLOW.S.debugProfile = false; }")
        br.close()

    # Best (cheapest) repetition: contention only ever adds cost, so the cheapest
    # window is the best estimate of the free-GPU cost. Whole vector from one rep
    # so the table adds up against its own FRAME row.
    def rep_sum(r):
        return sum(v for k, v in r["passes"].items() if not k.startswith("FRAME"))
    best = min(reps, key=rep_sum)
    parts = {k: v for k, v in best["passes"].items() if not k.startswith("FRAME")}
    total = sum(parts.values())
    # A prefix that matches several passes sums them — "shadow cascade" is a far
    # steadier normaliser than any single 2048² pass on its own.
    ctrl = best["passes"].get(args.control)
    if ctrl is None:
        ctrl = sum(v for k, v in parts.items() if k.startswith(args.control))

    print(f"\n{'='*74}\n{args.tag}  ({args.width}x{args.height}"
          f"{', walking' if args.walk else ', idle'})  best of {len(reps)} reps"
          f"\n{'='*74}")
    print(f"  frame median  {med([r['frame'] for r in reps]):7.2f} ms   "
          f"(spread {min(r['frame'] for r in reps):.1f}.."
          f"{max(r['frame'] for r in reps):.1f})")
    print(f"  sum of passes {total:7.2f} ms   control '{args.control}' = {ctrl:.3f} ms\n")
    for n, m in sorted(parts.items(), key=lambda x: -x[1]):
        vals = [r["passes"].get(n, 0.0) for r in reps]
        print(f"    {n:28} {m:7.3f} ms   x{m/max(ctrl,1e-9):6.3f} ctrl"
              f"   [{min(vals):.2f}..{max(vals):.2f}]")

    row = {"tag": args.tag, "walk": args.walk,
           "frame_median_ms": round(med([r["frame"] for r in reps]), 3),
           "sum_of_passes_ms": round(total, 3),
           "control": args.control, "control_ms": round(ctrl, 4),
           "passes": {n: round(m, 4) for n, m in sorted(parts.items(), key=lambda x: -x[1])},
           "passes_over_control": {n: round(m / max(ctrl, 1e-9), 4)
                                   for n, m in parts.items()}}
    all_rows = []
    if os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f: all_rows = json.load(f)
        except Exception: all_rows = []
    all_rows.append(row)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(all_rows, f, indent=2)
    print(f"\nappended to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
