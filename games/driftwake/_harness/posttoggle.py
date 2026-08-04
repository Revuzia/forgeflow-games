#!/usr/bin/env python
"""
What each post pass costs when it is doing NOTHING.

Every pass in the chain stays attached and early-outs on an `enabled` uniform
(postChain.js docblock, "Why every pass stays attached"), so turning one off in
the overlay does not remove it — it turns it into a full-screen copy. That makes
the overlay toggles a measuring instrument: `cost(on) - cost(off)` is the pass's
SHADING cost, and `cost(off)` is its BANDWIDTH floor — the read, the write and
the fixed-function work that no shader change can remove and only a structural
change (skipping the dispatch, or merging it into its neighbour) can.

Modes are interleaved inside ONE page load, so the session drift that makes
absolute milliseconds unreliable on this machine lands on every mode equally.

    python posttoggle.py --reps 3
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

POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""

# name -> settings patch, applied over the boot defaults each time.
MODES = [
    ("default",     {}),
    ("ssr off",     {"ssr": False}),
    ("dof off",     {"dof": False}),
    ("sharpen off", {"sharpen": False}),
    ("bloom off",   {"bloom": False}),
    ("shafts off",  {"showLightShafts": False}),
    ("taa off",     {"taa": False}),
]

APPLY = """(patch) => {
    const S = SNOWFLOW.S;
    // Restore the keys any mode touches, then apply this mode's.
    for (const k of ['ssr','dof','sharpen','bloom','showLightShafts','taa'])
        S[k] = true;
    for (const k in patch) S[k] = patch[k];
    S.debugProfile = true; S.debugProfileDeep = false;
}"""


def med(xs):
    return statistics.median(xs) if xs else 0.0


def window(pg, seconds, w, h, cool_s, patch):
    pg.set_viewport_size({"width": 160, "height": 90})
    pg.wait_for_timeout(int(cool_s * 1000))
    pg.set_viewport_size({"width": w, "height": h})
    pg.evaluate(APPLY, patch)
    pg.wait_for_timeout(1800)
    pg.evaluate("() => SNOWFLOW.perfProfileReset()")
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 500][8:]
    prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
    rows = {p["name"]: p["ms"] for p in prof["passes"] if p["n"] > 0}
    return med(ft), rows


SAMPLER = """
window.__ft = [];
(function () { let prev = performance.now();
  function tick() { const n = performance.now(); window.__ft.push(n - prev);
    prev = n; requestAnimationFrame(tick); } requestAnimationFrame(tick); })();
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--cool", type=float, default=3.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    got = {name: [] for name, _ in MODES}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.add_init_script(SAMPLER)
        pg.goto(args.url, wait_until="load", timeout=90_000)
        ready = False
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig"
                           " && SNOWFLOW.character)"):
                ready = True; break
            pg.wait_for_timeout(500)
        if not ready:
            br.close(); raise SystemExit("target never became ready")
        pg.evaluate(POSE)
        pg.wait_for_timeout(2500)
        for i in range(args.reps):
            for name, patch in MODES:               # round-robin, not blocked
                ft, rows = window(pg, args.seconds, args.width, args.height,
                                  args.cool, patch)
                got[name].append(rows)
                post = sum(v for k, v in rows.items() if k.startswith("post "))
                print(f"  rep{i+1} {name:12} frame {ft:7.2f}  post-chain {post:6.3f} ms")
        pg.evaluate("() => { SNOWFLOW.S.debugProfile = false; }")
        br.close()

    # Best (cheapest) repetition per mode, whole-vector.
    best = {}
    for name, reps in got.items():
        best[name] = min(reps, key=lambda r: sum(
            v for k, v in r.items() if k.startswith("post ")))

    names = sorted({k for r in best.values() for k in r if k.startswith("post ")})
    base = best["default"]
    print(f"\n{'='*92}\nPOST CHAIN, best of {args.reps} interleaved reps (ms)\n{'='*92}")
    hdr = f"  {'pass':26}" + "".join(f"{n:>13}" for n, _ in MODES)
    print(hdr)
    for k in sorted(names, key=lambda x: -base.get(x, 0)):
        line = f"  {k:26}"
        for n, _ in MODES:
            line += f"{best[n].get(k, 0.0):13.3f}"
        print(line)
    line = f"  {'TOTAL post chain':26}"
    for n, _ in MODES:
        line += f"{sum(v for kk, v in best[n].items() if kk.startswith('post ')):13.3f}"
    print(line)

    print(f"\n{'='*92}\nPER-PASS SPLIT — bandwidth floor vs shading\n{'='*92}")
    pairs = [("post ssr (full)", "ssr off"), ("post dof (full)", "dof off"),
             ("post sharpen (full)", "sharpen off"), ("post taa (full)", "taa off"),
             ("post shafts (1/4)", "shafts off")]
    for row, mode in pairs:
        on = base.get(row, 0.0)
        off = best[mode].get(row, 0.0)
        print(f"  {row:26} on {on:6.3f}   doing-nothing {off:6.3f}   "
              f"shading {on-off:+6.3f}   <- {off:.3f} ms is only removable structurally")
    with open(os.path.join(HERE, "posttoggle.json"), "w", encoding="utf-8") as f:
        json.dump({n: best[n] for n, _ in MODES}, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
