#!/usr/bin/env python
"""
Post-chain GPU profile — one resolution, coarse scopes, repeated and cooled.

`gpuprofile.py` surveys the whole frame at two resolutions and takes minutes.
This is the instrument for iterating on ONE subsystem: 1280x720 only, coarse
mode only, N repetitions round-robin with a cool-down, and a table that puts the
nine post passes first.

Why per-pass rather than whole-frame: this machine's whole-frame number drifts by
tens of percent across a session (documented in gpuprofile.py), so a 0.9 ms
change on a 93 ms frame is invisible there. A per-pass TIME_ELAPSED scope
measures only its own draw, and a row that DISAPPEARS is unambiguous.

Reported number is the best (cheapest) repetition, whole-vector — contention only
ever adds cost, and a table assembled from different moments does not have to add
up. `--label` tags the run so two runs can be diffed with `--diff`.

    python postprofile.py --label before
    python postprofile.py --label after --diff before
"""
import argparse, json, os, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "postruns")
DEFAULT_URL = "http://localhost:8799/games/driftwake/index.html"

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# The pose perfprobe.py and gpuprofile.py both use, so the numbers are comparable.
POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay','#crosshair'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
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


def one_window(pg, seconds, w, h, cool_s):
    """One cooled measurement window; returns (frame_ms, {pass: ms})."""
    pg.set_viewport_size({"width": 160, "height": 90})
    pg.wait_for_timeout(int(cool_s * 1000))
    pg.set_viewport_size({"width": w, "height": h})
    pg.evaluate("() => { SNOWFLOW.S.debugProfile = true; SNOWFLOW.S.debugProfileDeep = false; }")
    pg.wait_for_timeout(2000)
    pg.evaluate("() => SNOWFLOW.perfProfileReset()")
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
    prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
    passes = {p["name"]: p["ms"] for p in prof["passes"] if p["n"] > 0}
    passes["__dropped"] = prof["dropped"] + prof.get("bogus", 0)
    return med(ft), passes


def collect(url, reps, seconds, w, h, cool_s):
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": w, "height": h})
        pg.add_init_script(SAMPLER)
        pg.goto(url, wait_until="load", timeout=90_000)
        ok = False
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                ok = True; break
            pg.wait_for_timeout(500)
        if not ok:
            br.close(); raise SystemExit("target never became ready")
        errs = pg.evaluate("() => (window.__err||[])")
        pg.evaluate(POSE)
        pg.wait_for_timeout(2500)
        out = []
        for i in range(reps):
            ft, passes = one_window(pg, seconds, w, h, cool_s)
            print(f"  rep{i+1}: frame {ft:7.2f} ms   "
                  f"sum {sum(v for k,v in passes.items() if k != '__dropped' and not k.startswith('FRAME')):6.2f} ms")
            out.append({"frame": ft, "passes": passes})
        canvas = pg.evaluate("() => { const c = SNOWFLOW.renderer.domElement; return c.width+'x'+c.height; }")
        pg.evaluate("() => { SNOWFLOW.S.debugProfile = false; }")
        br.close()
    return out, canvas, errs


def summarise(reps):
    def s(r):
        return sum(v for k, v in r["passes"].items()
                   if k != "__dropped" and not k.startswith("FRAME"))
    best = min(reps, key=s)
    names = set()
    for r in reps: names |= set(r["passes"].keys())
    names.discard("__dropped")
    rows = {}
    for n in names:
        vals = [r["passes"].get(n, 0.0) for r in reps]
        rows[n] = {"ms": round(best["passes"].get(n, 0.0), 3),
                   "lo": round(min(vals), 3), "hi": round(max(vals), 3)}
    return {"frame_ms": round(best["frame"], 2),
            "sum_ms": round(s(best), 3),
            "frames_min": round(min(r["frame"] for r in reps), 2),
            "rows": rows}


def show(tag, res):
    parts = {k: v for k, v in res["rows"].items() if not k.startswith("FRAME")}
    wide = next((v for k, v in res["rows"].items() if k.startswith("FRAME")), None)
    print(f"\n{'='*74}\n{tag}   frame {res['frame_ms']} ms   "
          f"sum of passes {res['sum_ms']} ms" +
          (f"   FRAME(one query) {wide['ms']} ms" if wide else "") + f"\n{'='*74}")
    post = [(k, v) for k, v in parts.items() if k.startswith("post ")]
    rest = [(k, v) for k, v in parts.items() if not k.startswith("post ")]
    for title, group in (("post chain", post), ("everything else", rest)):
        sub = sum(v["ms"] for _, v in group)
        print(f"  -- {title}: {sub:.3f} ms ({100*sub/max(res['sum_ms'],1e-9):.1f}% of sum)")
        for k, v in sorted(group, key=lambda x: -x[1]["ms"]):
            print(f"     {k:34} {v['ms']:7.3f} ms   [{v['lo']:.2f}..{v['hi']:.2f}]")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--label", default="run")
    ap.add_argument("--diff", default="", help="label of an earlier run to diff against")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--cool", type=float, default=4.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    os.makedirs(RUNS, exist_ok=True)
    reps, canvas, errs = collect(args.url, args.reps, args.seconds,
                                 args.width, args.height, args.cool)
    res = summarise(reps)
    res["canvas"] = canvas
    path = os.path.join(RUNS, args.label + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    show(f"{args.label}  (canvas {canvas})", res)
    if errs:
        print("  PAGE ERRORS: " + "; ".join(errs))

    if args.diff:
        prev = json.load(open(os.path.join(RUNS, args.diff + ".json"), encoding="utf-8"))
        print(f"\n{'='*74}\nDIFF  {args.diff} -> {args.label}\n{'='*74}")
        keys = sorted(set(prev["rows"]) | set(res["rows"]))
        for k in keys:
            if k.startswith("FRAME"): continue
            a = prev["rows"].get(k, {"ms": 0.0})["ms"]
            b = res["rows"].get(k, {"ms": 0.0})["ms"]
            flag = "  GONE" if k in prev["rows"] and k not in res["rows"] else \
                   ("  NEW" if k not in prev["rows"] else "")
            if abs(b - a) >= 0.02 or flag:
                print(f"  {k:34} {a:7.3f} -> {b:7.3f}   {b-a:+7.3f} ms{flag}")
        print(f"  {'SUM OF PASSES':34} {prev['sum_ms']:7.3f} -> {res['sum_ms']:7.3f}"
              f"   {res['sum_ms']-prev['sum_ms']:+7.3f} ms")
        print(f"  {'frame (rAF median, noisy)':34} {prev['frame_ms']:7.2f} -> "
              f"{res['frame_ms']:7.2f}   {res['frame_ms']-prev['frame_ms']:+7.2f} ms")
    print("\nwrote " + path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
