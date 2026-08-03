#!/usr/bin/env python
"""
Per-pass GPU profile — where the frame actually goes.

`perfprobe.py` answers "how slow"; this answers "slow where". It drives the
port's own `S.debugProfile` instrumentation (EXT_disjoint_timer_query_webgl2,
one TIME_ELAPSED scope per pass, harvested asynchronously — see
`src/core/perf.js`) and reports the per-pass cost in milliseconds.

Three things this does that a single-shot measurement does not, all of them
forced by what the first run showed — this machine's frame cost drifts by tens
of percent over a session:

  · REPETITIONS, INTERLEAVED. Each mode is measured R times, round-robin, and
    the reported number is the median across repetitions. Running mode A to
    completion and then mode B attributes the drift between them to the mode.
  · A PROFILER-OFF CONTROL in every repetition, so the instrumentation overhead
    is measured next to the thing it might be distorting rather than assumed.
  · THE FRAME-WIDE SCOPE. On alternate frames the port measures one query across
    the whole frame instead of the per-pass ones (`gpuBeginWide`). The row named
    `FRAME (one query)` is therefore directly comparable to the sum of the other
    rows, and the difference between them is the work no pass owns.

Two resolutions, because that is what separates the fill-bound passes from the
fixed-cost ones: a 2048² shadow cascade costs the same at 640x360 as it does at
1280x720, and a full-resolution post pass does not.

    python gpuprofile.py
    python gpuprofile.py --reps 4 --seconds 8
"""
import argparse, json, os, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8799/games/snowflow/index.html"

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# The identical pose perfprobe.py uses, so these numbers sit next to the
# 97-108 ms / 32.95 ms baselines it produced.
POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""

# Records raw inter-frame deltas and the port's own GPU number alongside them,
# so the two always describe the SAME window. Identical in every mode, so it
# cannot bias one against another.
SAMPLER = """
window.__ft = []; window.__gpu = [];
(function () {
  let prev = performance.now();
  function tick() {
    const now = performance.now();
    window.__ft.push(now - prev);
    prev = now;
    const S = globalThis.SNOWFLOW;
    if (S && S.perfStats && S.perfStats.gpuMs > 0) window.__gpu.push(S.perfStats.gpuMs);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
"""

SET_MODE = """(m) => {
    const S = SNOWFLOW.S;
    S.debugProfile = m !== 'off';
    S.debugProfileDeep = m === 'deep';
}"""


def med(xs):
    return statistics.median(xs) if xs else 0.0


def cool(pg, seconds):
    """
    Drop the GPU load to nothing for a moment.

    Not a nicety. Under continuous load this machine degrades badly: an
    identical 640x360 frame measured 23.4 ms early in a session and 62.8 ms
    after two minutes of 1280x720 profiling. Shrinking the viewport to 160x90
    cuts the per-frame fill by 64x without reloading the page, so every window
    starts from a comparable thermal state instead of from whatever the previous
    window left behind.
    """
    pg.set_viewport_size({"width": 160, "height": 90})
    pg.wait_for_timeout(int(seconds * 1000))


def window(pg, seconds):
    """Medians over one window, plus the sample count that validates them."""
    pg.evaluate("window.__ft = []; window.__gpu = [];")
    pg.wait_for_timeout(int(seconds * 1000))
    raw = pg.evaluate("window.__ft")
    ft = [f for f in raw if 0.5 < f < 500][8:]
    gpu = pg.evaluate("window.__gpu")[8:]
    return med(ft), med(gpu), len(ft)


def measure(pg, mode, seconds, w, h, cool_s):
    """One window in one mode, from a cooled start."""
    cool(pg, cool_s)
    pg.set_viewport_size({"width": w, "height": h})
    pg.evaluate(SET_MODE, mode)
    pg.wait_for_timeout(2000)          # resize -> applySize; let scopes be seen
    if mode != "off":
        pg.evaluate("() => SNOWFLOW.perfProfileReset()")
    ft, gpu, n = window(pg, seconds)
    passes = None
    if mode != "off":
        prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
        passes = {p["name"]: p["ms"] for p in prof["passes"] if p["n"] > 0}
        passes["__dropped"] = prof["dropped"] + prof.get("bogus", 0)
    cpu = pg.evaluate("() => Object.assign({}, SNOWFLOW.perfSystems)")
    return ft, gpu, n, passes, cpu


def report(tag, reps, out):
    """Median across repetitions, ranked by cost."""
    print(f"\n{'='*72}\n{tag}\n{'='*72}")
    for mode in ("off", "coarse", "deep"):
        ok = [r for r in reps if r[mode]["n"] >= 20]
        fts = [r[mode]["frame"] for r in ok]
        gps = [r[mode]["gpu"] for r in ok]
        print(f"  {mode:6}  frame median {med(fts):7.2f} ms   "
              f"gpu {med(gps):7.2f} ms   ({len(ok)}/{len(reps)} valid reps, "
              f"frame spread {min(fts or [0]):.1f}..{max(fts or [0]):.1f})")
    cpu = reps[-1]["coarse"]["cpu"]
    if cpu:
        print("  cpu marks (ms): " + "  ".join(
            f"{k}={v:.2f}" for k, v in sorted(cpu.items(), key=lambda x: -x[1])))

    for mode in ("coarse", "deep"):
        names = set()
        for r in reps: names |= set(r[mode]["passes"].keys())
        names.discard("__dropped")

        # BEST REP, not per-pass minimum and not the median.
        #
        # The confound on this machine is contention (27 Chrome processes, the
        # user's own browser among them) plus sustained-load degradation. Both
        # only ever ADD cost, so the cheapest repetition is the best estimate of
        # what the frame costs when the GPU is actually free — a median is
        # biased upward by whatever else was running.
        #
        # The whole vector comes from one repetition rather than taking each
        # pass's minimum independently, because a table assembled from different
        # moments does not have to add up, and this one has to: it is checked
        # against the `FRAME (one query)` row measured in the same window.
        def rep_sum(r):
            return sum(v for k, v in r[mode]["passes"].items()
                       if k != "__dropped" and not k.startswith("FRAME"))
        best = min(reps, key=rep_sum)

        rows = []
        for n in names:
            vals = [r[mode]["passes"].get(n, 0.0) for r in reps]
            rows.append((n, best[mode]["passes"].get(n, 0.0), min(vals), max(vals)))
        wide = next((r for r in rows if r[0].startswith("FRAME")), None)
        parts = [r for r in rows if not r[0].startswith("FRAME")]
        total = sum(r[1] for r in parts)
        print(f"\n  -- {mode} (best of {len(reps)} reps) --"
              f"   sum of passes {total:6.2f} ms" +
              (f"   FRAME (one query) {wide[1]:6.2f} ms"
               f"   unattributed {wide[1]-total:+.2f} ms" if wide else ""))
        for n, m, lo, hi in sorted(parts, key=lambda x: -x[1]):
            print(f"    {n:26} {m:7.3f} ms  {100*m/max(total,1e-9):5.1f}%"
                  f"   [{lo:.2f}..{hi:.2f}]")
        out[tag + "/" + mode] = {
            "sum_of_passes_ms": round(total, 3),
            "frame_one_query_ms": round(wide[1], 3) if wide else None,
            "passes": {n: round(m, 3) for n, m, _, _ in
                       sorted(parts, key=lambda x: -x[1])},
        }
    dropped = max(r[m]["passes"].get("__dropped", 0)
                  for r in reps for m in ("coarse", "deep"))
    if dropped:
        print(f"  WARNING: {dropped} scopes dropped — query pool saturated")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--seconds", type=float, default=7.0)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--cool", type=float, default=5.0,
                    help="seconds at 160x90 before each window (thermal reset)")
    ap.add_argument("--out", default=os.path.join(HERE, "gpuprofile.json"))
    args = ap.parse_args()

    out = {}
    # ONE page, both resolutions, interleaved. Measured the other way — 1280
    # to completion, then 640 — this machine's sustained-load drift lands
    # entirely on the second resolution: a 640x360 control read 23.4 ms early in
    # a session and 53.1 ms two minutes later, on an identical frame. Round-robin
    # spreads that drift across both instead of attributing it to the change.
    RES = (("1280x720", 1280, 720), ("640x360", 640, 360))
    per_res = {label: [] for label, _, _ in RES}
    canvases = {}

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(SAMPLER)
        pg.goto(args.url, wait_until="load", timeout=90_000)
        ok = False
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                ok = True; break
            pg.wait_for_timeout(500)
        if not ok:
            print("never became ready", file=sys.stderr); br.close(); return 1
        pg.evaluate(POSE)
        pg.wait_for_timeout(2500)

        for i in range(args.reps):
            for label, w, h in RES:
                rep = {}
                for mode in ("off", "coarse", "deep"):
                    ft, gpu, n, passes, cpu = measure(
                        pg, mode, args.seconds, w, h, args.cool)
                    rep[mode] = {"frame": ft, "gpu": gpu, "n": n,
                                 "passes": passes or {}, "cpu": cpu}
                    print(f"  [{label} rep{i+1} {mode:6}] frame {ft:7.2f}"
                          f"  gpu {gpu:7.2f}  frames {n}")
                canvases[label] = pg.evaluate(
                    "() => { const c = SNOWFLOW.renderer.domElement; "
                    "return c.width + 'x' + c.height; }")
                per_res[label].append(rep)
        pg.evaluate(SET_MODE, "off")
        br.close()

    for label, _, _ in RES:
        report(f"{label} (canvas {canvases.get(label, '?')})", per_res[label], out)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\nwrote " + args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
