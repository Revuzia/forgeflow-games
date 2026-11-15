"""Can a PLAYER walk from the Keep spawn into the first world, with no teleport?

gatecheck.py places the hero at each gate's own stand-out spot and walks him in.
That proves the GATE. It does not prove the ROUTE, and the owner's report was
"I can't seem to even play the first world" -- which is the route plus the gate.

This probe clicks NEW GAME, then holds W with the camera aimed at the verdant-1
painting, re-aiming every 120 ms the way a player steers with the mouse, and
reports whether the course card comes up and how far he got if it did not.

    python _harness/spawnwalk.py [--headless] [--course <id>]

`--course` walks to ANY gate from the authored spawn, W only, no teleport. The
three VERDANT paintings are in line of sight of the spawn; every other gate is
behind a stair, so ROUTES below carries the waypoints a player would steer
through (the flank flight, the landing, the upper flight, the spiral, the
courtyard doors). Between waypoints the steering is exactly the same: the
camera is aimed at the next point and W is held. azure-3 (the tower roof) is
reached by wall kicks, not by walking, and is not in this table.
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

# Waypoints from the Keep's authored spawn (0, 0.05, 3.0) to each gate's own
# stand-out spot. Every point is on a walking floor; the flights are climbed
# by holding W into them (TUNE.stepUp 0.45 against 0.30 / 0.333 risers).
# A waypoint is (x, z) or (x, z, yTop): the third value is the tread height it
# stands on — a walker already BELOW it (he took the treads faster than the
# list) skips it instead of climbing back round the spiral for it.
_SPIRAL = [(-9.6, 6.9)] + [
    (round(-13.5 + 2.25 * __import__("math").cos(__import__("math").radians(-22.5 * i)), 2),
     round(7.5 + 2.25 * __import__("math").sin(__import__("math").radians(-22.5 * i)), 2),
     round(-i / 3.0, 2))
    for i in range(1, 24, 2)] + [(-9.5, 7.6, -7.9), (-8.0, -3.0)]
_GRAND = [(-13.0, 2.0), (-13.0, -4.0), (-13.0, -9.5), (0.0, -10.5), (0.0, -1.4), (8.5, -1.4), (8.5, -11.5), (0.0, -12.5)]
_YARD = [(0.0, 12.0), (0.0, 19.4)]
ROUTES = {
    'ember-1': _SPIRAL, 'ember-2': _SPIRAL, 'ember-3': _SPIRAL, 'ember-4': _SPIRAL,
    'rime-1': _GRAND + [(0.0, -19.0)], 'rime-2': _GRAND + [(0.0, -19.0), (-6.0, -27.0)],
    'rime-3': _GRAND + [(0.0, -19.0), (0.0, -30.0)],
    # the courtyard trees at (13.5, 19.4) and (7.8, 25.6) grab a walker who brushes
    # the trunk; both legs stay > 3.5 m from them
    'azure-1': _YARD + [(6.0, 21.0), (14.0, 25.0), (21.0, 30.0)],
    'azure-2': _YARD + [(-6.0, 21.0), (-14.0, 22.0), (-20.0, 22.0)],
}

AIM = r"""([course, wp]) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g || !G.cam) return null;
  // Steer at the next waypoint if one is given, else at the gate's stand-out
  // spot until we are close, then at the picture.
  const p = G.player.pos;
  const dOut = Math.hypot(g.exitPos.x - p.x, g.exitPos.z - p.z);
  let tx = dOut > 1.2 ? g.exitPos.x : g.pos.x;
  let tz = dOut > 1.2 ? g.exitPos.z : g.pos.z;
  if (wp) { tx = wp[0]; tz = wp[1]; }
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
    // a SEALED gate never raises the card: it answers with a toast naming the
    // course ('<LABEL> IS SEALED') and an ambient prompt carrying its crest
    // price ('N CRESTS TO OPEN'), and that is the gate doing its job. The
    // toasts are `.ch-toast` and the prompt is `#cb-prompt.show` — the same
    // two selectors gatecheck.py reads (this probe used `.cb-toast`, which
    // matches nothing, so every sealed gate read as 'never reached' even with
    // the hero pressed against its plate — measured 2026-09-07 on 11 gates).
    toast: [...document.querySelectorAll('.ch-toast')]
      .map(e => (e.textContent || '').trim().replace(/\s+/g, ' ')).join(' | '),
    prompt: (() => { const el = document.getElementById('cb-prompt');
      return (el && el.classList.contains('show')) ? (el.textContent || '').trim().replace(/\s+/g, ' ') : ''; })(),
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
    ap.add_argument("--budget", type=float, default=0.0, help="seconds of walking (default 18, or 60 on a routed gate)")
    args = ap.parse_args()
    if not args.budget:
        args.budget = 60.0 if args.course in ROUTES else 18.0

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

        route = list(ROUTES.get(args.course, []))
        if route:
            print("route: %d waypoints" % len(route))
        wp = route.pop(0) if route else None
        wp_t = 0.0
        pg.keyboard.down("w")
        t0 = time.time()
        best = start["toGate"]
        out = start
        stuck_at = None
        stuck_t = 0.0
        sealed_toast = ""
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
            pg.evaluate(AIM, [args.course, wp])
            out = pg.evaluate(PROBE, args.course)
            if wp is not None:
                # a waypoint counts as passed within 1.3 m (or when the walk has
                # gone by it); progress is measured to the WAYPOINT while one is up
                dwp = ((out["pos"][0] - wp[0]) ** 2 + (out["pos"][2] - wp[1]) ** 2) ** 0.5
                wp_t += 0.12
                below = len(wp) > 2 and out["pos"][1] < wp[2] - 0.45
                if dwp < 1.3 or below or wp_t > 9.0:
                    if wp_t > 9.0:
                        print("   waypoint %s not reached in 9 s (at %s, %.2f m off) - going on" % (wp, out["pos"], dwp))
                    wp = route.pop(0) if route else None
                    wp_t = 0.0
                    best = out["toGate"]
                    stuck_at = None
                    stuck_t = 0.0
                    continue
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
            # the OPEN gate's ambient prompt also carries 'CRESTS 0 / 7', so only
            # the refusal toast ('<LABEL> IS SEALED') or the sealed prompt's
            # 'TO OPEN' counts
            if out["toGate"] is not None and out["toGate"] < 1.2 and ("SEALED" in out["toast"] or "TO OPEN" in out["prompt"]):
                sealed_toast = out["toast"] or out["prompt"]
                break
        pg.keyboard.up("w")
        if detours:
            print("detours (a player sliding along what he bumped):")
            for d in detours:
                print("   strafe %s at %s, %.2f m from the painting" % (d[0], d[1], d[2]))
        pg.wait_for_timeout(300)
        out = pg.evaluate(PROBE, args.course)
        entered = out["state"] == "card" or out["cardOpen"] or bool(sealed_toast)
        if sealed_toast:
            print("sealed gate answered: %s" % sealed_toast)
        print("end:  ", json.dumps(out))
        print("walked %s -> %s m from the painting in %.1f s" % (start["toGate"], best, time.time() - t0))
        if not entered and stuck_at:
            print("stalled at %s for %.1f s" % (stuck_at, stuck_t))
        if not entered and wp is not None:
            print("never finished the route: next waypoint was %s" % (wp,))
        print("SPAWN WALK: %s" % (("SEALED GATE REACHED, TOAST NAMES IT" if sealed_toast else "ENTERED THE COURSE CARD") if entered else "NEVER REACHED THE GATE"))
        br.close()
    return 0 if entered else 1


if __name__ == "__main__":
    sys.exit(main())
