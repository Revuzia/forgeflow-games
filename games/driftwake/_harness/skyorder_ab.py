#!/usr/bin/env python
"""
Separate the two things that made the skybox draw cheaper.

`gpuprofile_sky.py` reports one number — how much of the sky draw is the
far-range raymarch — and that number moved for two independent reasons at once:

  ORDER   the skybox mesh moved from renderOrder -1000 (first in the opaque
          queue) to 1000 (last), so every pixel the terrain, character or wake
          has already covered is killed by early-Z before the fragment shader
          runs. Fewer pixels, same shader.
  SHADER  `ridgeHeight()` replaced `ridgeField().x` on the 21-of-22 field
          evaluations that never wanted the analytic gradient. Same pixels,
          cheaper shader.

Only ORDER can be toggled at runtime (`sky.mesh.renderOrder`), so this measures
the 2x2 of {order} x {showMountains} inside ONE page load, round-robin. That
gives the ORDER effect exactly, and it re-states the raymarch cost at the OLD
order so it can be compared against a pre-change baseline taken the same way —
which is the only comparison that isolates SHADER.

Round-robin rather than block, and minimum rather than median, for the reason
`gpuprofile.py` documents at length: this machine's GPU cost drifts by tens of
percent over a session and contention only ever adds. `draw terrain` is carried
through every cell as an untouched control, so a cell measured during a spike
is visible as such instead of being read as a result.

    python skyorder_ab.py
    python skyorder_ab.py --reps 4 --seconds 5
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8799/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# The pose perfprobe.py and gpuprofile_sky.py both use, so every number in this
# family of measurements describes the same frame.
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


def cell(pg, order, mountains, seconds):
    pg.evaluate("""(c) => {
        SNOWFLOW.sky.mesh.renderOrder = c.order;
        SNOWFLOW.S.showMountains = c.mountains;
    }""", {"order": order, "mountains": mountains})
    pg.wait_for_timeout(1500)
    pg.evaluate("() => SNOWFLOW.perfProfileReset()")
    pg.wait_for_timeout(int(seconds * 1000))
    prof = pg.evaluate("() => SNOWFLOW.perfProfile()")

    def row(name):
        p = next((x for x in prof["passes"] if x["name"] == name), None)
        return p["ms"] if p else 0.0

    return row("draw sky"), row("draw terrain")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    # (label, renderOrder, showMountains)
    CELLS = [
        ("first/range",  -1000, True),
        ("first/plain",  -1000, False),
        ("last/range",    1000, True),
        ("last/plain",    1000, False),
    ]
    acc = {c[0]: {"sky": [], "ter": []} for c in CELLS}

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
            for label, order, mountains in CELLS:
                s, t = cell(pg, order, mountains, args.seconds)
                acc[label]["sky"].append(s)
                acc[label]["ter"].append(t)
                print(f"  rep{i+1} {label:12} draw sky {s:7.3f} ms   "
                      f"draw terrain {t:7.3f} ms")
        # Leave the page in the shipping configuration.
        pg.evaluate("""() => {
            SNOWFLOW.sky.mesh.renderOrder = 1000;
            SNOWFLOW.S.showMountains = true;
            SNOWFLOW.S.debugProfile = false;
            SNOWFLOW.S.debugProfileDeep = false;
        }""")
        br.close()

    m = {k: {"sky": min(v["sky"]), "ter": min(v["ter"])} for k, v in acc.items()}
    res = {
        "canvas": f"{args.width}x{args.height}",
        "sky_draw_ms": {k: round(v["sky"], 3) for k, v in m.items()},
        "terrain_control_ms": {k: round(v["ter"], 3) for k, v in m.items()},
        "raymarch_ms_sky_first": round(m["first/range"]["sky"] - m["first/plain"]["sky"], 3),
        "raymarch_ms_sky_last": round(m["last/range"]["sky"] - m["last/plain"]["sky"], 3),
        "order_saving_ms_total": round(m["first/range"]["sky"] - m["last/range"]["sky"], 3),
        "order_saving_ms_base": round(m["first/plain"]["sky"] - m["last/plain"]["sky"], 3),
        "samples": {k: {"sky": [round(x, 3) for x in v["sky"]],
                        "ter": [round(x, 3) for x in v["ter"]]}
                    for k, v in acc.items()},
    }
    print("\n" + json.dumps(res, indent=2))
    with open(os.path.join(HERE, "skyorder_ab.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
