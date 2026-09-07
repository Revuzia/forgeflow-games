"""Can a PLAYER walk from the Keep spawn into the first world, with no teleport?

gatecheck.py places the hero at each gate's own stand-out spot and walks him in.
That proves the GATE. It does not prove the ROUTE, and the owner's report was
"I can't seem to even play the first world" -- which is the route plus the gate.

This probe clicks NEW GAME, then holds W with the camera aimed at the verdant-1
painting, re-aiming every 120 ms the way a player steers with the mouse, and
reports whether the course card comes up and how far he got if it did not.

    python _harness/spawnwalk.py [--headless]
"""
import argparse
import json
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8788/games/crestbound/index.html?quality=low&autoscale=0"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

AIM = r"""(course) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g || !G.cam) return null;
  // Steer at the gate's stand-out spot until we are close, then at the picture.
  const p = G.player.pos;
  const dOut = Math.hypot(g.exitPos.x - p.x, g.exitPos.z - p.z);
  const tx = dOut > 1.2 ? g.exitPos.x : g.pos.x;
  const tz = dOut > 1.2 ? g.exitPos.z : g.pos.z;
  const dx = tx - p.x, dz = tz - p.z;
  if (dx * dx + dz * dz < 1e-4) return null;
  const yaw = Math.atan2(-dx, -dz);
  const slide = (typeof G.cam._yawSlide === 'number') ? G.cam._yawSlide : 0;
  G.cam.yaw = yaw - slide;
  G.cam._rcHoldT = 0;
  return +yaw.toFixed(3);
}"""

PROBE = r"""(course) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  const p = G.player.pos;
  return {
    state: G.state,
    cardOpen: !!document.querySelector('.cb-card.on'),
    pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
    toGate: g ? +Math.hypot(g.pos.x - p.x, g.pos.z - p.z).toFixed(2) : null,
    grounded: !!G.player.grounded,
    speed: +(G.player.speed || 0).toFixed(2),
  };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--budget", type=float, default=18.0, help="seconds of walking")
    args = ap.parse_args()

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=args.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(BASE, wait_until="load", timeout=90000)
        for _ in range(160):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"):
                break
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1400)
        pg.evaluate(r"""() => {
          const b = Array.from(document.querySelectorAll('button'))
            .filter(x => x.offsetParent !== null)
            .find(x => /NEW GAME|NEW|CONTINUE|PLAY|START/i.test(x.textContent || ''));
          if (b) { if (typeof b.__activate === 'function') b.__activate(); else b.click(); }
        }""")
        pg.wait_for_timeout(2600)
        start = pg.evaluate(PROBE, args.course)
        print("start:", json.dumps(start))

        pg.keyboard.down("w")
        t0 = time.time()
        best = start["toGate"]
        out = start
        stuck_at = None
        stuck_t = 0.0
        # A player who walks into the side of something does not stand there
        # pressing forward: he slides along it. Hold a strafe key for 0.7 s,
        # alternating sides, whenever forward progress stops. Without this the
        # probe reports "blocked" for any route with a corner in it -- which the
        # Keep's route to the first painting has (the grand stair's east flank,
        # treads x -15..-11 at z -8.3..-4.4, stands square across the straight
        # line from the spawn to the verdant-1 painting).
        strafes = ["a", "d", "a", "a", "d", "d"]
        nstrafe = 0
        detours = []
        while time.time() - t0 < args.budget:
            pg.wait_for_timeout(120)
            pg.evaluate(AIM, args.course)
            out = pg.evaluate(PROBE, args.course)
            if out["toGate"] is not None and out["toGate"] < best - 0.05:
                best = out["toGate"]
                stuck_at = None
                stuck_t = 0.0
            else:
                if stuck_at is None:
                    stuck_at = out["pos"]
                stuck_t += 0.12
                if stuck_t >= 0.9 and nstrafe < len(strafes):
                    key = strafes[nstrafe]
                    nstrafe += 1
                    detours.append([key, out["pos"], round(out["toGate"], 2)])
                    pg.keyboard.down(key)
                    pg.wait_for_timeout(700)
                    pg.keyboard.up(key)
                    stuck_t = 0.0
                    stuck_at = None
            if out["state"] == "card" or out["cardOpen"]:
                break
        pg.keyboard.up("w")
        if detours:
            print("detours (a player sliding along what he bumped):")
            for d in detours:
                print("   strafe %s at %s, %.2f m from the painting" % (d[0], d[1], d[2]))
        pg.wait_for_timeout(300)
        out = pg.evaluate(PROBE, args.course)
        entered = out["state"] == "card" or out["cardOpen"]
        print("end:  ", json.dumps(out))
        print("walked %s -> %s m from the painting in %.1f s" % (start["toGate"], best, time.time() - t0))
        if not entered and stuck_at:
            print("stalled at %s for %.1f s" % (stuck_at, stuck_t))
        print("SPAWN WALK: %s" % ("ENTERED THE COURSE CARD" if entered else "NEVER REACHED THE GATE"))
        br.close()
    return 0 if entered else 1


if __name__ == "__main__":
    sys.exit(main())
