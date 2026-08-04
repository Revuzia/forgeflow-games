#!/usr/bin/env python
"""
Isolate the far-range raymarch inside the skybox draw.

`gpuprofile.py --deep` reports the whole `draw sky` scope. The reference calls
out its far-range raymarch at ~1.2 ms of a 3.22 ms budget, so the question is
how much of this port's sky draw is the ridge raymarch and how much is the base
atmosphere lookup. `S.showMountains` gates exactly that (`sky.render` sets
`uRidgeAmp = S.showMountains ? S.mountainHeight : 0`), so toggling it A/B/A/B
inside one window separates them without touching a shader.

Interleaved, not sequential: this machine's GPU cost drifts by tens of percent
over a session, so on/off measured minutes apart would attribute the drift to
the toggle.

    python gpuprofile_sky.py
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

POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    SF.S.debugProfile = true; SF.S.debugProfileDeep = true;
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""


def sky_ms(pg, mountains, seconds):
    pg.evaluate("(m) => { SNOWFLOW.S.showMountains = m; }", mountains)
    pg.wait_for_timeout(1500)
    pg.evaluate("() => SNOWFLOW.perfProfileReset()")
    pg.wait_for_timeout(int(seconds * 1000))
    prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
    row = next((p for p in prof["passes"] if p["name"] == "draw sky"), None)
    ter = next((p for p in prof["passes"] if p["name"] == "draw terrain"), None)
    return (row["ms"] if row else 0.0), (ter["ms"] if ter else 0.0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    on, off, ter_on, ter_off = [], [], [], []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.goto(args.url, wait_until="load", timeout=90_000)
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                break
            pg.wait_for_timeout(500)
        pg.evaluate(POSE)
        pg.wait_for_timeout(2500)

        for i in range(args.reps):
            for flag, sky_acc, ter_acc in ((True, on, ter_on), (False, off, ter_off)):
                s, t = sky_ms(pg, flag, args.seconds)
                sky_acc.append(s); ter_acc.append(t)
                print(f"  rep{i+1} showMountains={str(flag):5}  "
                      f"draw sky {s:6.3f} ms   draw terrain {t:6.3f} ms")
        pg.evaluate("() => { SNOWFLOW.S.showMountains = true; "
                    "SNOWFLOW.S.debugProfile = false; SNOWFLOW.S.debugProfileDeep = false; }")
        br.close()

    # Minimum, not median: contention only ever adds.
    res = {
        "canvas": f"{args.width}x{args.height}",
        "sky_with_far_range_ms": round(min(on), 3),
        "sky_base_only_ms": round(min(off), 3),
        "far_range_raymarch_ms": round(min(on) - min(off), 3),
        "terrain_control_ms": [round(min(ter_on), 3), round(min(ter_off), 3)],
        "samples": {"on": [round(x, 3) for x in on], "off": [round(x, 3) for x in off]},
    }
    print("\n" + json.dumps(res, indent=2))
    with open(os.path.join(HERE, "gpuprofile_sky.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
