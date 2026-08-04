#!/usr/bin/env python
"""
Is a skipped post pass BIT-IDENTICAL to a dispatched one?

`post/postChain.js` skips a pass entirely on frames where it would write exactly
what it read. That claim is only worth anything if it is checked against pixels
rather than against reasoning, and checked at the pixel level rather than through
summary statistics — a statistic can agree while an edge moves.

The check has to happen inside ONE page load and at ONE frozen frame, because two
runs of identical code do not reproduce each other exactly (the Halton phase at
the shutter depends on the frame count). Under `S.freezeTime` the temporal
resolve reaches a fixed point — the history it reads is never rewritten and its
input never changes — so consecutive shutters at a frozen pose ARE reproducible,
and that is what makes an A/B possible at all. Scenario `control` measures that
assumption instead of assuming it.

`PostChain.render(forceAll)` dispatches every pass and binds every consumer to
its real target, i.e. exactly the graph as it was before the bypasses existed, so
patching it in from here is a faithful "before".

    python probe_bypass_identity.py
    python probe_bypass_identity.py --scenario ssr-matte
"""
import argparse, io, os, re, sys
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "_shots", "bypass")
DEFAULT_URL = "http://localhost:8799/games/snowflow/index.html"

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

CHROME = """() => { for (const s of ['#boot','#hint','#overlay','.overlay','#perf'])
    document.querySelectorAll(s).forEach(e => e.style.display='none'); }"""

# Dispatch every pass and bind every consumer to its real target — the graph as
# it was before the bypasses. Restored by RESTORE.
FORCE_ALL = """() => {
    const p = SNOWFLOW.post;
    if (!p.__origRender) p.__origRender = p.render.bind(p);
    p.render = () => p.__origRender(true);
}"""
RESTORE = """() => {
    const p = SNOWFLOW.post;
    if (p.__origRender) { p.render = p.__origRender; delete p.__origRender; }
}"""

# name -> (setup JS, what it proves)
SCENARIOS = {
    "ssr-matte": (
        """() => { const SF = SNOWFLOW;
            SF.deform.iceEverBrushed = false;      // nothing has glazed the ground
            SF.S.ssr = true; SF.S.dof = true; SF.S.bloom = true;
            SF.S.showLightShafts = true; SF.S.sharpen = true;
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.17; }""",
        "the reflection pass is skipped on a matte frame (THE DEFAULT FRAME)"),
    # The two shots the brief names, plus the far range, at their real camera
    # poses and in the matte state they are actually captured in. `ssr-iced`
    # comes LAST because it glazes the ground and the latch never clears.
    "14-sky-sun-pose": (
        """() => { const SF = SNOWFLOW; SF.deform.iceEverBrushed = false;
            SF.rig.yaw = 2.06; SF.rig.pitch = -0.40;
            SF.rig.distance = SF.rig.distanceTarget = 6.2; }""",
        "14-sky-sun's pose, matte — the most bloom- and shaft-dependent frame"),
    "12-far-range-pose": (
        """() => { const SF = SNOWFLOW; SF.deform.iceEverBrushed = false;
            SF.rig.yaw = 2.9; SF.rig.pitch = -0.10;
            SF.rig.distance = SF.rig.distanceTarget = 9.5; }""",
        "12-far-range's pose, matte"),
    "13-char-closeup-pose": (
        """() => { const SF = SNOWFLOW; SF.deform.iceEverBrushed = false;
            SF.rig.yaw = 0.9; SF.rig.pitch = 0.12;
            SF.rig.distance = SF.rig.distanceTarget = 2.6; }""",
        "13-char-closeup's pose, matte"),
    "dof-off": (
        """() => { const SF = SNOWFLOW; SF.S.dof = false;
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.17; }""",
        "the depth-of-field pass is skipped when it is off (the `balanced` preset)"),
    "bloom-off": (
        """() => { const SF = SNOWFLOW; SF.S.bloom = false;
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.17; }""",
        "the three bloom passes are skipped when the composite will not read them"),
    "sun-behind": (
        """() => { const SF = SNOWFLOW; SF.S.showLightShafts = true;
            SF.rig.yaw = 2.4 + Math.PI; SF.rig.pitch = 0.17; }""",
        "the shafts pass is skipped with the sun behind the camera"),
    "sun-front": (
        """() => { const SF = SNOWFLOW; SF.S.showLightShafts = true;
            SF.rig.yaw = 2.06; SF.rig.pitch = -0.40; }""",
        "the shafts pass still runs with the sun in frame (14-sky-sun's pose)"),
    "control": (
        """() => { const SF = SNOWFLOW; SF.deform.iceEverBrushed = false;
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.17; }""",
        "two shutters of the SAME path reproduce each other (validates the method)"),
    # LAST: glazes the ground, and the ice latch is monotone.
    "ssr-iced": (
        """() => { const SF = SNOWFLOW;
            SF.S.ssr = true;
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.26;
            SF.spells.cast(4); }""",
        "the reflection pass is NOT skipped once Crystallise has glazed the ground"),
}

# Every post toggle back to its authored default before each scenario, or the
# scenarios compound and "saved N draws" stops describing the one under test.
PLACE = """() => { const SF = SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const k of ['taa','ssr','dof','bloom','grain','sharpen','showLightShafts'])
        SF.S[k] = true;
    SF.S.freezeTime = false; }"""


def shot(pg) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(pg.screenshot())).convert("RGB"),
                      dtype=np.int16)


def diff(a, b):
    d = np.abs(a - b)
    return int(d.max()), int((d > 0).sum()), float(d.mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--scenario", default="", help="run just one")
    ap.add_argument("--settle", type=float, default=3.5)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    names = [args.scenario] if args.scenario else list(SCENARIOS)
    bad = 0
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(args.url, wait_until="load", timeout=90_000)
        ready = False
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.post && SNOWFLOW.deform"
                           " && SNOWFLOW.spells && SNOWFLOW.terrain)"):
                ready = True; break
            pg.wait_for_timeout(500)
        if not ready:
            br.close(); print("target never became ready", file=sys.stderr); return 1
        pg.evaluate(CHROME)
        pg.wait_for_timeout(2000)

        for name in names:
            setup, claim = SCENARIOS[name]
            pg.evaluate(RESTORE)
            pg.evaluate("() => { SNOWFLOW.S.freezeTime = false; }")
            pg.evaluate(PLACE)
            pg.evaluate(setup)
            pg.wait_for_timeout(int(args.settle * 1000))
            pg.evaluate(CHROME)
            # Freeze: the resolve reaches a fixed point, so shutters repeat.
            pg.evaluate("() => { SNOWFLOW.S.freezeTime = true; }")
            pg.wait_for_timeout(800)

            a = shot(pg)                     # bypassed (the shipping path)
            drawsA = pg.evaluate("() => SNOWFLOW.perfStats.drawCalls")
            pg.wait_for_timeout(400)
            a2 = shot(pg)                    # same path again — the noise floor
            pg.evaluate(FORCE_ALL)
            pg.wait_for_timeout(800)
            b = shot(pg)                     # every pass dispatched (the "before")
            drawsB = pg.evaluate("() => SNOWFLOW.perfStats.drawCalls")
            pg.evaluate(RESTORE)
            pg.wait_for_timeout(400)

            mx_n, px_n, mean_n = diff(a, a2)
            mx, px, mean = diff(a, b)
            ok = mx <= mx_n
            bad += 0 if ok else 1
            print(f"\n{name}: {claim}")
            # The control that makes "IDENTICAL" mean anything: if the two states
            # issued the same number of draws, nothing was bypassed and the
            # comparison is vacuous.
            print(f"   draws  bypassed {drawsA}   dispatched {drawsB}   "
                  f"saved {drawsB - drawsA} draw(s)"
                  + ("" if drawsB != drawsA else "   <- NOTHING BYPASSED HERE"))
            print(f"   noise floor (same path twice) max|d| {mx_n}  px {px_n}  mean {mean_n:.6f}")
            print(f"   bypassed vs dispatched     max|d| {mx}  px {px}  mean {mean:.6f}"
                  f"   -> {'IDENTICAL' if mx == 0 else ('within noise' if ok else 'DIFFERS')}")
            if mx > mx_n:
                Image.fromarray(a.astype(np.uint8)).save(
                    os.path.join(OUT, name + "_bypassed.png"))
                Image.fromarray(b.astype(np.uint8)).save(
                    os.path.join(OUT, name + "_dispatched.png"))
        pg.evaluate("() => { SNOWFLOW.S.freezeTime = false; }")
        br.close()

    print(f"\nRESULT: {'OK' if bad == 0 else str(bad) + ' SCENARIO(S) DIFFER'}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
