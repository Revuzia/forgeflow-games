#!/usr/bin/env python
"""
LANE B — ADS BLEND CONTINUITY PROBE.

The iter10 occlusion fix adds two things that vary with the ADS blend: the vm
camera's FOV (a tangent-space zoom share) and the ADS standoff on the weapon's
Z. Either could introduce a POP at the start or end of the transition, which
would read as exactly the kind of "not smooth" the owner complained about.

This samples vmCamera.fov and the weapon mount's Z every animation frame
across a REAL right-click press and release, and reports the largest
frame-to-frame step in each channel. A smooth blend shows a single-humped
step profile; a pop shows one step far larger than its neighbours.
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server
from occlusion import FLAGS, DEFAULT_URL


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weapon", default="warden")
    ap.add_argument("--url", default=DEFAULT_URL)
    args = ap.parse_args()

    ensure_server()
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1600, "height": 900})
        pg.goto(args.url, wait_until="load", timeout=60_000)
        pg.wait_for_function(
            "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim && __FPS__.vm)",
            timeout=120_000)
        pg.evaluate("__FPS__.__test.startMission()")
        pg.wait_for_timeout(1500)
        pg.evaluate("__FPS__.__test.god(true); __FPS__.__test.noTarget(true)")
        pg.evaluate("(id)=>__FPS__.__test.give(id)", args.weapon)
        pg.wait_for_function("(id)=>__FPS__.vm.currentId===id", arg=args.weapon,
                             timeout=20_000)
        pg.wait_for_timeout(1200)

        # sample every rAF: vm fov + the weapon mount's camera-space Z
        pg.evaluate("""() => {
          window.__SAMP__ = [];
          const F = window.__FPS__;
          const mount = F.camera.getObjectByName('__vm_mount__');
          const tick = () => {
            window.__SAMP__.push([
              performance.now(),
              F.vm.camera.fov,
              mount ? mount.position.z : null,
              F.sim.state.player.weapon.adsT || 0,
            ]);
            if (window.__SAMP__.length < 400) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }""")
        # REAL right-click: press, hold through the blend, release, hold again
        pg.evaluate("""() => document.getElementById('view').dispatchEvent(
            new MouseEvent('mousedown', {button: 2, buttons: 2, bubbles: true}))""")
        pg.wait_for_timeout(900)
        pg.evaluate("""() => window.dispatchEvent(
            new MouseEvent('mouseup', {button: 2, buttons: 0, bubbles: true}))""")
        pg.wait_for_timeout(1400)
        samp = pg.evaluate("window.__SAMP__")
        br.close()

    fovs = [s[1] for s in samp]
    zs = [s[2] for s in samp if s[2] is not None]
    ads = [s[3] for s in samp]
    dfov = [abs(fovs[i] - fovs[i - 1]) for i in range(1, len(fovs))]
    dz = [abs(zs[i] - zs[i - 1]) for i in range(1, len(zs))]
    moving = [i for i, a in enumerate(ads) if 0.001 < a < 0.999]
    print(f"weapon        {args.weapon}")
    print(f"samples       {len(samp)}  adsT range {min(ads):.3f}..{max(ads):.3f}"
          f"  frames mid-blend {len(moving)}")
    print(f"vm fov        {min(fovs):.3f} .. {max(fovs):.3f} deg")
    print(f"  max step    {max(dfov):.4f} deg/frame   "
          f"2nd {sorted(dfov)[-2]:.4f}   ratio {max(dfov)/max(1e-9, sorted(dfov)[-2]):.2f}")
    print(f"mount z       {min(zs):.4f} .. {max(zs):.4f} m")
    print(f"  max step    {max(dz)*1000:.3f} mm/frame   "
          f"2nd {sorted(dz)[-2]*1000:.3f}   ratio {max(dz)/max(1e-12, sorted(dz)[-2]):.2f}")
    print("\nA pop shows as max/2nd >> 1. Smooth easing keeps it near 1.")
    with open(os.path.join(HERE, "..", "_shots",
                           f"adsblend_{args.weapon}.json"), "w") as f:
        json.dump(samp, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
