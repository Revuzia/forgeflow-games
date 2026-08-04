#!/usr/bin/env python
"""
Dynamic-resolution controller — does it settle, and does it stay off?

A dynamic resolver is judged on stability, not on speed of convergence: a
controller that reaches the right scale and then keeps stepping around it is
worse than no controller at all, because the eye tracks change rather than
absolute sharpness. So the assertions here are about the SHAPE of the scale
trace over time, not about which value it lands on:

  1. OFF BY DEFAULT. `S.dynamicResolution` starts false and the scale must not
     move on its own. This is the one that protects the shot battery — a
     resolution that drifts underneath a screenshot makes it irreproducible.
  2. IT SETTLES. Against an unreachable target it must walk down and STOP, not
     hunt. Measured as: no change at all in the last third of the trace.
  3. IT DOES NOT OSCILLATE. No direction reversal after the trace has settled,
     and a bounded number of reversals overall.
  4. IT CLIMBS BACK. Against a target the machine beats easily it must return to
     1.0 and stay there — a controller that only ever ratchets down is a
     one-way quality loss.
  5. A MANUAL WRITE WINS. Setting the scale by hand while it is on must not be
     immediately overridden; the controller re-seats on the nearest rung.

    python drscheck.py
"""
import json, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]
URL = "http://localhost:8799/games/driftwake/index.html"

# Samples the scale off the DRAWING BUFFER, not off `S`: the whole point of this
# machinery is that the two can disagree.
TRACE = """
window.__drs = [];
window.__drsTimer = setInterval(() => {
  const SF = globalThis.SNOWFLOW;
  if (SF) window.__drs.push([performance.now()|0, SF.renderer.domElement.width]);
}, 100);
"""


def run(pg, setup, seconds, label):
    pg.evaluate(setup)
    pg.evaluate("window.__drs = []")
    pg.wait_for_timeout(int(seconds * 1000))
    tr = pg.evaluate("window.__drs")
    widths = [w for _, w in tr]
    # Compress to the sequence of distinct values, in order.
    steps = [widths[0]] if widths else []
    for w in widths[1:]:
        if w != steps[-1]:
            steps.append(w)
    tail = widths[len(widths) * 2 // 3:]
    settled = len(set(tail)) == 1
    reversals = 0
    for i in range(2, len(steps)):
        a, b, c = steps[i - 2], steps[i - 1], steps[i]
        if (b - a) * (c - b) < 0:
            reversals += 1
    print(f"  {label}")
    print(f"      trace  {' -> '.join(str(s) for s in steps[:14])}"
          + (" ..." if len(steps) > 14 else ""))
    print(f"      final {widths[-1] if widths else '?'}  distinct-steps {len(steps)}  "
          f"reversals {reversals}  settled-in-last-third {settled}")
    return {"label": label, "steps": steps, "final": widths[-1] if widths else None,
            "reversals": reversals, "settled": settled}


def main() -> int:
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(TRACE)
        pg.goto(URL, wait_until="load", timeout=90_000)
        for _ in range(200):
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.post)"): break
            pg.wait_for_timeout(500)
        pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = 0; SF.character.position.z = 0;
            SF.character.position.y = SF.terrain.heightAt(0, 0);
            SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
            SF.rig.distance = SF.rig.distanceTarget = 6.2;
            for (const s of ['#boot','#hint','#overlay'])
                document.querySelectorAll(s).forEach(e => e.style.display='none');
        }""")

        out = []
        out.append(run(pg, """() => {
            const SF = globalThis.SNOWFLOW;
            SF.applyPreset('ultra');
        }""", 8, "1. default (dynamicResolution off) — must not move"))

        out.append(run(pg, """() => {
            const SF = globalThis.SNOWFLOW;
            SF.applyPreset('ultra');
            SF.set('dynamicTargetFps', 60);
            SF.set('dynamicResolution', true);
        }""", 30, "2. on, target 60 fps (unreachable) — must walk down and stop"))

        out.append(run(pg, """() => {
            const SF = globalThis.SNOWFLOW;
            // 1 fps, not 4. At 4 fps the budget is 250 ms and this machine
            // renders ultra in 140-270 ms, so 0.9 scale sits ON the rise
            // threshold and holding there is the CORRECT answer — the first
            // version of this case was asserting that the controller should
            // overshoot a target it was already meeting.
            SF.set('dynamicTargetFps', 1);
        }""", 45, "3. target 1 fps (unambiguously beaten) — must climb back to 1280"))

        # The target stays where case 3 left it. Case 4 asks only whether a
        # manual write is HONOURED — whether the controller later moves off it
        # is case 2's question, and conflating the two made this assert on a
        # value the controller was correctly allowed to change.
        out.append(run(pg, """() => {
            const SF = globalThis.SNOWFLOW;
            SF.set('resolutionScale', 0.7);
        }""", 6, "4. manual write while on — must be honoured, not stomped"))

        pg.evaluate("() => SNOWFLOW.set('dynamicResolution', false)")
        pg.close(); br.close()

    checks = [
        ("off by default does not move", len(out[0]["steps"]) == 1
                                         and out[0]["final"] == 1280),
        ("unreachable target settles", out[1]["settled"]),
        ("unreachable target does not hunt", out[1]["reversals"] <= 1),
        ("easy target climbs back to full", out[2]["final"] == 1280),
        # Monotonic, not "settled in the last third": the climb is deliberately
        # slow (four comfortable windows per rung), so it reaches the top rung
        # near the end of the trace and a settled-tail test fails a controller
        # that did exactly the right thing. Monotonicity IS the anti-oscillation
        # property here — a hunting controller reverses, a slow one does not.
        ("easy target climbs monotonically",
         all(b > a for a, b in zip(out[2]["steps"], out[2]["steps"][1:]))),
        ("manual write honoured", out[3]["steps"][0] == 896
                                  or 896 in out[3]["steps"]),
    ]
    print()
    bad = 0
    for name, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        bad += 0 if ok else 1
    print(f"\nRESULT: {'OK' if bad == 0 else str(bad) + ' FAILED'}")
    print(json.dumps(out, indent=2))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
