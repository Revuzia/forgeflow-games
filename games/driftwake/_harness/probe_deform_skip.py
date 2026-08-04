#!/usr/bin/env python
"""
Correctness probe for the deformation sim's identity-step skip.

Two things have to be true and neither is safe to assume:

  1. IT FIRES WHEN IT SHOULD. A standing character writes no brushes, does not
     move the window centre, and banks relaxation at 2.5 Hz — so the pass is a
     bit-identical copy on almost every frame and should not dispatch.
  2. IT DOES NOT FIRE WHEN IT MUST NOT. A walking character moves the centre and
     writes brushes every frame; if the skip ever fired there the trail would
     stop being written and the bug would look like "footprints are missing".

It also reads the deformation buffer back on both sides of a walk and reports
the depression depth under the player, which is what proves the trail is still
being carved and still decaying — the skip must not change either.

    python probe_deform_skip.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

POSE = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay','#crosshair'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
}"""

# `SNOWFLOW.deform` — exposed in main.js alongside the other subsystems.
COUNTERS = """() => {
    const d = globalThis.SNOWFLOW.deform;
    return d ? {run: d.stepsRun, skipped: d.stepsSkipped} : null;
}"""

# Read the deformation target back, through Three's own readRenderTargetPixels so
# the framebuffer plumbing is not this script's problem. The target is RGBA16F, so
# the destination has to be a Uint16Array and the halves are decoded here.
#
# A 7x7 MAXIMUM, not a single texel: the boot print is ~11 cm wide against 3.9 cm
# texels and the character's exact stopping position is not repeatable, so one
# texel lands off the print about as often as on it.
READBACK = """(p) => {
    const SF = globalThis.SNOWFLOW, d = SF.deform;
    const rt = d._pp.read;
    const res = d.res, size = d.size;
    // The addressing is toroidal and NOT centred: `lib/deform` maps a world
    // position to `fract(worldXZ / size)`. Reproducing it any other way lands
    // somewhere else in the field and reads a texel the player never touched.
    const f = (v) => v - Math.floor(v);
    const i = Math.max(3, Math.min(res - 4, Math.floor(f(p.x / size) * res)));
    const j = Math.max(3, Math.min(res - 4, Math.floor(f(p.z / size) * res)));
    const buf = new Uint16Array(7 * 7 * 4);
    SF.renderer.readRenderTargetPixels(rt, i - 3, j - 3, 7, 7, buf);
    const half = (h) => {
        const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
        if (e === 0) return s * m * 5.9604644775390625e-8;
        if (e === 31) return m ? NaN : s * Infinity;
        return s * Math.pow(2, e - 15) * (1 + m / 1024);
    };
    const out = [0, 0, 0, 0];
    for (let k = 0; k < 49; k++)
        for (let ch = 0; ch < 4; ch++)
            out[ch] = Math.max(out[ch], half(buf[k * 4 + ch]));
    return {dep: out[0], berm: out[1], comp: out[2], ice: out[3]};
}"""


def main() -> int:
    out = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 960, "height": 540})
        pg.goto(URL, wait_until="load", timeout=90_000)
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                break
            pg.wait_for_timeout(500)
        pg.evaluate(POSE)
        pg.wait_for_timeout(2000)

        if pg.evaluate("() => !(globalThis.SNOWFLOW && SNOWFLOW.deform)"):
            print("FAIL: globalThis.SNOWFLOW.deform is not exposed — cannot probe.",
                  file=sys.stderr)
            br.close(); return 1

        # ---- 1. idle -------------------------------------------------------
        a = pg.evaluate(COUNTERS)
        pg.wait_for_timeout(4000)
        b = pg.evaluate(COUNTERS)
        out["idle"] = {"run": b["run"] - a["run"], "skipped": b["skipped"] - a["skipped"]}

        # ---- 2. walking ----------------------------------------------------
        pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW'}))")
        pg.wait_for_timeout(500)
        a = pg.evaluate(COUNTERS)
        pg.wait_for_timeout(4000)
        b = pg.evaluate(COUNTERS)
        out["walking"] = {"run": b["run"] - a["run"], "skipped": b["skipped"] - a["skipped"]}
        out["trail_while_walking"] = pg.evaluate(
            READBACK, pg.evaluate("() => ({x: SNOWFLOW.character.position.x, "
                                  "z: SNOWFLOW.character.position.z})"))
        pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW'}))")

        # ---- 3. the trail must still decay after the player stops ----------
        here = pg.evaluate("() => ({x: SNOWFLOW.character.position.x, "
                           "z: SNOWFLOW.character.position.z})")
        pg.wait_for_timeout(1500)
        first = pg.evaluate(READBACK, here)
        a = pg.evaluate(COUNTERS)
        pg.wait_for_timeout(20000)
        b = pg.evaluate(COUNTERS)
        later = pg.evaluate(READBACK, here)
        out["decay_20s"] = {"before": first, "after": later,
                            "run": b["run"] - a["run"],
                            "skipped": b["skipped"] - a["skipped"]}
        br.close()

    # The R channel's shipped time constant is 400 s at refillRate 1
    # (`shaders/deformSim.glsl.js`), so 20 s of standing still must take the
    # depression to exp(-20/400) = 0.9512 of where it was — a little further,
    # because diffusion and slump are pulling on it too. This is the number the
    # skip would break if it ever swallowed a relaxation step.
    d = out["decay_20s"]
    ratio = d["after"]["dep"] / max(d["before"]["dep"], 1e-9)
    out["decay_20s"]["dep_ratio"] = round(ratio, 4)
    out["decay_20s"]["dep_ratio_expected_max"] = 0.9512

    print(json.dumps(out, indent=2))
    checks = {
        "skip dominates while idle":
            out["idle"]["skipped"] > out["idle"]["run"],
        "relaxation still fires while idle":
            out["idle"]["run"] > 0,
        "never skips while walking":
            out["walking"]["run"] > 0 and out["walking"]["skipped"] == 0,
        "trail is carved while walking":
            out["trail_while_walking"]["dep"] > 0.05,
        "trail still decays after stopping":
            0.5 < ratio <= 0.9512,
    }
    for k, v in checks.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    ok = all(checks.values())
    print("\nRESULT: " + ("OK" if ok else "UNEXPECTED — read the numbers above"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
