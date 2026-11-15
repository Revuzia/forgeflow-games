"""R3 feel lane, part 2: the turn-rate-vs-speed CURVE, measured on clear ground.

Part 1 showed a 90-deg-off-FACING hold spirals into `pivot` (the facing outruns
the velocity, so the wish ends up behind it). This drives what a player actually
does: run up to a steady speed, then swing the stick to a FIXED world heading
90 deg away, and read the facing rate frame by frame while the speed holds.
Centre (-25, 10), 11.76 m of clearance in every direction (probed part 1).
"""
import json, math, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE

SPOT = dict(x=-25.0, y=2.03, z=10.0)

TURN_JS = r"""
(cfg) => {
  const F = window.__FEEL, G = CRESTBOUND.game;
  F.begin({});
  F.place(cfg.x, cfg.y + 0.2, cfg.z, 0);
  F.step(20);
  F.begin({});
  F.setStick(0, -1, cfg.mag);      // straight along -Z, reach steady speed
  F.step(cfg.accel);
  F.setStick(-1, 0, cfg.mag);      // swing 90 deg to -X and HOLD (fixed world dir)
  F.step(cfg.turn);
  return F.dump();
}
"""

def analyse(s, accel):
    t = s[accel - 1] if accel - 1 < len(s) else s[-1]
    entry_speed = t["sp"]
    rows, tot = [], 0.0
    for i in range(accel, len(s)):
        d = s[i]["f"] - s[i - 1]["f"]
        while d > math.pi: d -= 2 * math.pi
        while d < -math.pi: d += 2 * math.pi
        rate = abs(d) * 60.0
        tot += abs(d)
        rows.append((s[i]["i"], round(s[i]["sp"], 3), round(rate, 3), s[i]["st"], round(tot, 3)))
        if tot >= math.pi / 2 - 0.02:
            break
    turn_frames = len(rows)
    # radius over the completed 90 deg: chord / (2 sin(45))
    a = s[accel - 1]; b = s[accel - 1 + turn_frames]
    chord = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
    radius = chord / (2 * math.sin(math.pi / 4)) if chord > 0 else None
    peak = max(r[2] for r in rows) if rows else 0
    mean = (tot / (turn_frames / 60.0)) if turn_frames else 0
    return {"entry_speed": round(entry_speed, 3),
            "speed_at_90": round(b["sp"], 3),
            "t_90deg_s": round(turn_frames / 60.0, 4),
            "mean_turn_rate": round(mean, 3),
            "peak_turn_rate": round(peak, 3),
            "arc_radius_m": round(radius, 3) if radius else None,
            "states": sorted(set(r[3] for r in rows)),
            "frames": rows[:14]}

def main():
    out = {}
    with sync_playwright() as p:
        br = launch(p, headless=True)
        pg = br.new_page(viewport={"width": 900, "height": 520})
        pg.goto(DEFAULT_URL, wait_until="load", timeout=90_000)
        t = time.time() + 120
        while time.time() < t:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(400)
        leave_title(pg)
        pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
        leave_title(pg, 60); pg.wait_for_timeout(1500)
        assert pg.evaluate(DRIVER_JS) == "ok"
        print("%-9s %-7s %-8s %-8s %-8s %-9s %-8s %s" %
              ("mag", "entry", "at90", "t90(s)", "mean", "peak", "radius", "states"))
        print("-" * 92)
        for mag in (0.25, 0.40, 0.55, 0.70, 0.85, 1.00):
            d = pg.evaluate(TURN_JS, dict(SPOT, mag=mag, accel=45, turn=110))
            a = analyse(d["samples"], 45)
            out["mag%.2f" % mag] = a
            print("%-9.2f %-7.3f %-8.3f %-8.4f %-8.3f %-9.3f %-8s %s" %
                  (mag, a["entry_speed"], a["speed_at_90"], a["t_90deg_s"],
                   a["mean_turn_rate"], a["peak_turn_rate"], a["arc_radius_m"], ",".join(a["states"])))
        print("\nTUNE says: turnRateSlow 14 rad/s below 3 m/s, turnRateFast 4.2 rad/s at run (9 m/s)")
        print("           radius at full run should be ~ 9.0 / 4.2 = 2.14 m")
        # frame detail for the full-run case
        print("\nfull-run (mag 1.00) frame detail  [frame, speed, rad/s, state, cumulative rad]:")
        for r in out["mag1.00"]["frames"]:
            print("   ", r)
        br.close()
    with open(os.path.join(HERE, "_r3_turn2.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nwrote _harness/_r3_turn2.json")

main()
