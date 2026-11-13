#!/usr/bin/env python
"""
What the post-chain bypasses actually save — measured as an A/B, not as a diff
between two sessions.

`postprofile.py --diff` compares two runs, and on this machine two runs are not
comparable: the whole-frame cost drifts by tens of percent across a session
(gpuprofile.py documents a 640x360 control reading 23.4 ms early and 82.9 ms two
hours later). `PostChain.render(forceAll)` dispatches every pass and binds every
consumer to its real target — the graph exactly as it was before the bypasses —
so both states exist in ONE page load and can be interleaved round-robin. The
drift then lands on both equally and the difference is the change.

The scene is posed matte (nothing has glazed the ground), which is the default
frame and the one the comparison battery is judged on.

    python probe_bypass_cost.py --reps 4
"""
import argparse, json, os, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8799/games/driftwake/index.html"

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SAMPLER = """
window.__ft = [];
(function () { let prev = performance.now();
  function tick() { const n = performance.now(); window.__ft.push(n - prev);
    prev = n; requestAnimationFrame(tick); } requestAnimationFrame(tick); })();
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

SET_MODE = """(dispatched) => {
    const p = SNOWFLOW.post;
    if (!p.__origRender) p.__origRender = p.render.bind(p);
    p.render = dispatched ? (() => p.__origRender(true)) : p.__origRender;
    // Matte: nothing has glazed the ground, so the reflection pass is a copy.
    SNOWFLOW.deform.iceEverBrushed = false;
    SNOWFLOW.S.debugProfile = true; SNOWFLOW.S.debugProfileDeep = false;
}"""

MODES = [("bypassed", False), ("dispatched", True)]


def med(xs):
    return statistics.median(xs) if xs else 0.0


def window(pg, seconds, w, h, cool_s, dispatched):
    pg.set_viewport_size({"width": 160, "height": 90})
    pg.wait_for_timeout(int(cool_s * 1000))
    pg.set_viewport_size({"width": w, "height": h})
    pg.evaluate(SET_MODE, dispatched)
    pg.wait_for_timeout(1800)
    pg.evaluate("() => SNOWFLOW.perfProfileReset()")
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
    prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
    rows = {p["name"]: p["ms"] for p in prof["passes"] if p["n"] > 0}
    draws = pg.evaluate("() => SNOWFLOW.perfStats.drawCalls")
    return med(ft), rows, draws


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--cool", type=float, default=3.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    got = {n: [] for n, _ in MODES}
    draws = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.add_init_script(SAMPLER)
        pg.goto(args.url, wait_until="load", timeout=90_000)
        ready = False
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.post && SNOWFLOW.deform"
                           " && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                ready = True; break
            pg.wait_for_timeout(500)
        if not ready:
            br.close(); print("target never became ready", file=sys.stderr); return 1
        pg.evaluate(POSE)
        pg.wait_for_timeout(2500)
        for i in range(args.reps):
            for name, disp in MODES:                 # round-robin
                ft, rows, dr = window(pg, args.seconds, args.width, args.height,
                                      args.cool, disp)
                got[name].append(rows)
                draws[name] = dr
                post = sum(v for k, v in rows.items() if k.startswith("post "))
                print(f"  rep{i+1} {name:11} frame {ft:7.2f}   post-chain {post:6.3f} ms"
                      f"   draws {dr}")
        pg.evaluate("() => { SNOWFLOW.S.debugProfile = false; }")
        br.close()

    def postsum(r):
        return sum(v for k, v in r.items() if k.startswith("post "))
    best = {n: min(got[n], key=postsum) for n, _ in MODES}
    names = sorted({k for r in best.values() for k in r if k.startswith("post ")},
                   key=lambda k: -best["dispatched"].get(k, 0))

    print(f"\n{'='*78}\nPOST CHAIN — best of {args.reps} interleaved reps, "
          f"{args.width}x{args.height}, matte frame\n{'='*78}")
    print(f"  {'pass':26}{'dispatched':>13}{'bypassed':>13}{'delta':>13}")
    for k in names:
        a = best["dispatched"].get(k, 0.0)
        b = best["bypassed"].get(k, 0.0)
        print(f"  {k:26}{a:13.3f}{b:13.3f}{b-a:+13.3f}"
              + ("   NOT DISPATCHED" if b == 0.0 and a > 0 else ""))
    a = postsum(best["dispatched"]); b = postsum(best["bypassed"])
    print(f"  {'TOTAL post chain':26}{a:13.3f}{b:13.3f}{b-a:+13.3f}")
    print(f"  {'draw calls / frame':26}{draws['dispatched']:13d}{draws['bypassed']:13d}"
          f"{draws['bypassed']-draws['dispatched']:+13d}")
    with open(os.path.join(HERE, "bypass_cost.json"), "w", encoding="utf-8") as f:
        json.dump({"dispatched": best["dispatched"], "bypassed": best["bypassed"],
                   "delta_ms": round(b - a, 3)}, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
