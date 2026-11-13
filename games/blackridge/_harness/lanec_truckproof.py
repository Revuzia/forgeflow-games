#!/usr/bin/env python
"""
LANE C truck-collision proof (owner report 2026-08: "bullets hit the space
around the truck as if it's a full rectangular prism").

Fires REAL shots (mouse events through the input path, doctrine §5) in the
LIVE campaign at cu_truck_2 (16, -46, rot 0 — customs yard) and reads the
sim's own `shot` events:

  A) GAP shot   — through the visible daylight under the cargo bed
                  (y 0.92 m: above the chassis rails, below the bed floor,
                  between axles). Must PASS the truck and hit what is
                  behind it (ground/parapet at x > 17.3).
  B) METAL shot — into the cargo box side (y 1.8 m). Must impact ON the
                  truck surface (x ~= 14.75, the cargo west face), metal.
  C) HOOD shot  — over the bonnet (z -42.8, y 2.2 m at the truck: below the
                  old 3.0 m prism top, above the 1.77 m hood). Must NOT
                  impact inside the truck footprint.

Captures A and B frames via __test.capture (real render path).
Exit 0 iff all three shots resolve as specified.
"""
import json, os, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"

TRUCK = {"cx": 16.0, "cz": -46.0, "hw": 1.25, "hl": 3.5}  # cu_truck_2, rot 0


def wait_ready(page, timeout_s=60):
    import time
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if page.evaluate(READY):
                return True
        except Exception:
            pass
        page.wait_for_timeout(400)
    return False


SHOT_JS = """async (a) => {
  const t = __FPS__.__test, sim = __FPS__.sim;
  sim.teleport("P", a.px, a.py, a.pz);
  // stance + ADS: warden ADS spread is 0 (§2.4) — the shot is a laser, so
  // where it lands is pure collider truth, not spread luck.
  if (a.crouch) t.pin("crouch", true); else t.unpin("crouch");
  t.pin("ads", true);
  t.step(45);              // settle stance + adsT -> 1
  t.aimAt(a.ax, a.ay, a.az);
  window.__laneC = [];
  if (!sim.__laneCPatched) {
    const oe = sim.emit.bind(sim);
    sim.emit = (type, d) => { if (type === "shot") window.__laneC.push(d); return oe(type, d); };
    sim.__laneCPatched = true;
  }
  window.__laneC.length = 0;
  await t.fire(6);
  t.unpin("ads"); t.unpin("crouch");
  const mine = window.__laneC.filter(e => e.shooter === "P" && !e.pen);
  return mine.map(e => ({ hit: e.hit, impactOnly: !!e.impactOnly, dir: e.dir, origin: e.origin }));
}"""


def fire(page, px, py, pz, ax, ay, az, crouch=False):
    evs = page.evaluate(SHOT_JS, {"px": px, "py": py, "pz": pz, "ax": ax, "ay": ay, "az": az,
                                  "crouch": crouch})
    # terminal record: the event carrying the resolved hit (or explicit miss)
    hits = [e["hit"] for e in evs if e["hit"] is not None]
    return evs, (hits[0] if hits else None)


def in_truck_footprint(pos):
    return (abs(pos[0] - TRUCK["cx"]) <= TRUCK["hw"] + 0.05 and
            abs(pos[2] - TRUCK["cz"]) <= TRUCK["hl"] + 0.05)


def main():
    ensure_server()
    failures = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=FLAGS)
        page = b.new_page(viewport={"width": 1280, "height": 720})
        page.goto(URL)
        if not wait_ready(page):
            print("NOT READY"); sys.exit(4)
        page.evaluate("() => __FPS__.__test.startMission({seed: 7})")
        page.wait_for_timeout(1500)
        page.evaluate("() => { __FPS__.sim.flags.noTarget = true; }")  # bots ignore us

        # A) gap shot: under the bed. Crouched (eye 1.10) at x=2, aiming at
        # the NEAR-face entry point (14.75, 0.95) — the ray crosses the truck
        # inside the open 0.84..0.99 band (above chassis rails, below the
        # cargo floor, between axles) and must land BEHIND it.
        evs, hit = fire(page, 2.0, 0, -46.3, 14.75, 0.95, -46.3, crouch=True)
        print("A gap-shot events:", json.dumps(evs))
        if hit is None:
            failures.append("A: no terminal hit recorded (expected a hit BEHIND the truck)")
        elif in_truck_footprint(hit["pos"]):
            failures.append(f"A: bullet stopped INSIDE the truck footprint at {hit['pos']} — prism collider still live")
        elif hit["pos"][0] <= TRUCK["cx"] + TRUCK["hw"]:
            failures.append(f"A: hit at {hit['pos']} is not behind the truck")
        else:
            print(f"A PASS  gap shot passed under the bed, impact behind truck at "
                  f"({hit['pos'][0]:.2f},{hit['pos'][1]:.2f},{hit['pos'][2]:.2f}) surface={hit['surface']}")
        page.evaluate("(n) => __FPS__.__test.capture(n, 1280, 720)", "laneC_gap_shot.png")

        # B) metal shot: cargo box side
        evs, hit = fire(page, 12.5, 0, -46.3, 16.0, 1.8, -46.3)
        print("B metal-shot events:", json.dumps(evs))
        if hit is None:
            failures.append("B: no hit — bullet passed through cargo metal")
        else:
            x, y = hit["pos"][0], hit["pos"][1]
            if abs(x - (TRUCK["cx"] - TRUCK["hw"])) > 0.10 or abs(y - 1.8) > 0.15:
                failures.append(f"B: impact at {hit['pos']} not on the cargo west face (x~14.75, y~1.8)")
            else:
                print(f"B PASS  metal shot impacted ON the cargo face at "
                      f"({x:.2f},{y:.2f},{hit['pos'][2]:.2f}) surface={hit['surface']}")
        page.evaluate("(n) => __FPS__.__test.capture(n, 1280, 720)", "laneC_metal_shot.png")

        # C) hood shot: over the bonnet, below the old prism top
        evs, hit = fire(page, 12.5, 0, -42.8, 16.0, 2.2, -42.8)
        print("C hood-shot events:", json.dumps(evs))
        if hit is not None and in_truck_footprint(hit["pos"]):
            failures.append(f"C: over-hood shot stopped inside the truck footprint at {hit['pos']}")
        else:
            where = "terminal miss (flew clear)" if hit is None else \
                f"impact past the truck at ({hit['pos'][0]:.2f},{hit['pos'][1]:.2f},{hit['pos'][2]:.2f})"
            print(f"C PASS  over-hood shot cleared the bonnet: {where}")

        errs = page.evaluate("window.__err || []")
        if errs:
            failures.append(f"page errors: {errs}")
        b.close()

    print("----")
    if failures:
        for f in failures:
            print("FAIL ", f)
        print("RESULT: FAIL"); sys.exit(1)
    print("RESULT: OK"); sys.exit(0)


if __name__ == "__main__":
    main()
