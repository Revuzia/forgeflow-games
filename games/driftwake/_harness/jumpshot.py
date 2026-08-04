#!/usr/bin/env python
"""
JUMP capture — drives a real jump and photographs the arc and the trail it leaves.

Sprints the character to lay a trail, presses SPACE the way the page's own
listeners expect (a real `KeyboardEvent`, exactly as `_harness/shots.js` `key()`
does), and screenshots four moments:

    01-mid-rise    rising, roughly half way up
    02-apex        the frame vertical velocity crosses zero
    03-mid-fall    falling, close to the deck
    04-trail-gap   two seconds after landing, camera turned back on the trail

WHY THE PHASE DETECTION LIVES IN THE PAGE. The whole flight is 0.50 s of wall
clock (`2*JUMP_VEL/GRAVITY`), and a Playwright `evaluate` round trip costs
50-160 ms, so polling the arc over the wire samples it perhaps three times and
misses the apex outright — measured, first run of this script. Instead a rAF
hook watches every frame from inside the page and sets `S.freezeTime` the
instant the requested phase arrives, holding it until the screenshot is taken.
`freezeTime` makes `dt` exactly 0, which the controller's landing test is
written to survive (it requires `vertVel <= 0` as well as `airHeight <= 0`,
so a frozen take-off frame cannot fire a spurious landing).

It also instruments `contact.field.brush`, so "nothing marked the snow while
airborne" is a COUNT rather than an impression: any brush written on a frame
where `character.airborne` is true is recorded with its coordinates.

    python jumpshot.py
"""
import argparse, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8799/games/driftwake/index.html"
OUT = os.path.join(HERE, "..", "_shots", "jump")

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

HEADING = 2.4  # the battery's walking heading, so the ground matches other shots

HIDE = """() => {
  for (const sel of ['#boot', '#hint', '#overlay', '.overlay', '#perf']) {
    document.querySelectorAll(sel).forEach(e => { e.style.display = 'none'; });
  }
}"""

INSTRUMENT = """() => {
  const SF = globalThis.SNOWFLOW;
  const S = SF.S;
  const field = SF.contact.field;
  const fig = SF.figure.figure || SF.figure;

  const J = window.__jump = {
    airborneBrushes: [], groundBrushes: 0, touchdownAirborne: 0,
    trace: [], want: null, got: null, frames: 0, landings: [],
  };

  // Count every brush written while the character is off the ground. A stale
  // plant stamping mid-flight shows up here even if the picture looks fine.
  const orig = field.brush.bind(field);
  field.brush = function (x, z, ...rest) {
    if (SF.character.airborne) J.airborneBrushes.push([+x.toFixed(3), +z.toFixed(3)]);
    else J.groundBrushes++;
    return orig(x, z, ...rest);
  };

  // One sample per RENDERED FRAME, so the arc is measured at the simulation's
  // own resolution rather than at the test harness's.
  function tick() {
    const c = SF.character;
    J.frames++;
    if (c.airborne || c.landed) {
      J.trace.push({ h: +c.airHeight.toFixed(4), vy: +c.vertVel.toFixed(3),
                     t: +c.airTime.toFixed(4), st: c.stepping,
                     td: !!(fig.touchdown[0] || fig.touchdown[1]) });
      // The other half of the gate, checked independently of the brush count.
      if (c.airborne && (fig.touchdown[0] || fig.touchdown[1])) J.touchdownAirborne++;
      if (c.landed) {
        J.landings.push(+c.landImpact.toFixed(3));
        J.landAt = [+c.position.x.toFixed(3), +c.position.z.toFixed(3)];
        // The gap in the trail is not a matter of opinion: no writer ran between
        // these two points, so this is its length in metres.
        if (J.takeoffAt) {
          J.gapMetres = +Math.hypot(c.position.x - J.takeoffAt[0],
                                    c.position.z - J.takeoffAt[1]).toFixed(3);
        }
      }
      if (c.airborne && !J.takeoffAt) {
        J.takeoffAt = [+c.position.x.toFixed(3), +c.position.z.toFixed(3)];
      }
    }
    // Freeze on the requested phase, and only once per request.
    if (J.want && !S.freezeTime) {
      const w = J.want;
      const hit =
        w === 'rise' ? (c.airborne && c.vertVel > 0 && c.airHeight > 0.30) :
        w === 'apex' ? (c.airborne && c.vertVel <= 0) :
        w === 'fall' ? (c.airborne && c.vertVel < 0 && c.airHeight < 0.26) : false;
      if (hit) { S.freezeTime = true; J.got = w; J.want = null;
                 J.gotState = { h: c.airHeight, vy: c.vertVel, t: c.airTime,
                                st: c.stepping }; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}"""


def key(pg, code, down):
    pg.evaluate(
        "([c,d]) => window.dispatchEvent(new KeyboardEvent(d?'keydown':'keyup',"
        "{code:c, bubbles:true}))", [code, down])


def catch(pg, phase, out, name, timeout=15.0):
    """Ask the page to freeze on `phase`, screenshot it, then release."""
    pg.evaluate("(w) => { window.__jump.want = w; window.__jump.got = null; }", phase)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate("() => window.__jump.got"):
            break
        pg.wait_for_timeout(30)
    else:
        return None
    pg.wait_for_timeout(900)          # let TAA converge on the held frame
    pg.evaluate(HIDE)
    pg.screenshot(path=os.path.join(out, name))
    st = pg.evaluate("() => window.__jump.gotState")
    pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
    return st


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--wait", type=float, default=120.0)
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    net404 = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("response", lambda r: net404.append(r.url) if r.status == 404 else None)
        pg.goto(args.url, wait_until="load", timeout=60_000)

        deadline = time.time() + args.wait
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig"
                           " && document.getElementById('boot').classList.contains('gone'))"):
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        pg.evaluate(HIDE)

        pg.evaluate("""(hd) => {
            const SF = globalThis.SNOWFLOW;
            SF.character.position.x = 0; SF.character.position.z = 0;
            SF.character.position.y = SF.terrain.heightAt(0, 0);
            SF.character.velocity.set(0, 0, 0);
            // Positive pitch looks DOWN (`fwd.y = -sin(pitch)`, core/camera.js),
            // so this frames the ground under the figure — without it the arc is
            // a silhouette against empty sky with no height reference.
            SF.rig.yaw = hd; SF.rig.pitch = 0.30;
            SF.rig.distance = 7.0; SF.rig.distanceTarget = 7.0;
        }""", HEADING)
        pg.wait_for_timeout(1200)
        pg.evaluate(INSTRUMENT)

        # STRAFE, not walk. Movement is camera-relative, so holding D sprints the
        # character across the frame and the jump is seen in PROFILE — which is
        # the only angle an arc reads from — with the camera left untouched
        # throughout. Turning the camera mid-flight instead would need the spring
        # arm to swing during a 0.5 s window it cannot settle in.
        key(pg, "ShiftLeft", True)
        key(pg, "KeyD", True)
        pg.wait_for_timeout(3500)

        # ------------------------------------------------------------- jump
        key(pg, "Space", True)
        rise = catch(pg, "rise", out, "01-mid-rise.png")
        apex = catch(pg, "apex", out, "02-apex.png")
        key(pg, "Space", False)
        fall = catch(pg, "fall", out, "03-mid-fall.png")

        # --------------------------------------- run out, then look at the trail
        # Two more seconds of running lays trail on the FAR side of the gap, so
        # the shot shows print / gap / print rather than a trail that merely ends.
        # Short: the deformation field is a scrolling toroidal window and the
        # marks relax over time, so a long run-out pushes the gap out of the
        # retained area entirely. Just enough to lay print / GAP / print.
        pg.wait_for_timeout(1100)
        key(pg, "KeyD", False)
        key(pg, "ShiftLeft", False)
        pg.wait_for_timeout(1800)

        # As near top-down as the rig allows (PITCH_MAX is 1.05). The sun is low,
        # so at a shallower pitch the figure's own shadow lies along the track and
        # reads as part of it — measured on the first attempt at this shot.
        pg.evaluate("""(hd) => {
            const SF = globalThis.SNOWFLOW;
            SF.rig.yaw = hd;
            SF.rig.pitch = 1.05;
            SF.rig.distance = 9.0; SF.rig.distanceTarget = 9.0;
        }""", HEADING)
        pg.wait_for_timeout(3500)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "04-trail-gap.png"))

        J = pg.evaluate("() => window.__jump")
        br.close()

    tr = J["trace"]
    air = [s for s in tr if s["h"] > 0]
    print(f"frames traced      {J['frames']}   airborne samples {len(air)}")
    if air:
        print(f"apex height        {max(s['h'] for s in air):.3f} m")
        print(f"hang time          {max(s['t'] for s in air):.3f} s")
        print(f"stepping in air    {sorted(set(s['st'] for s in air))}  <- must be [False]")
        print(f"touchdown in air   {sorted(set(s['td'] for s in air))}  <- must be [False]")
    for nm, st in (("01-mid-rise", rise), ("02-apex", apex), ("03-mid-fall", fall)):
        if st:
            print(f"{nm:<14}     h={st['h']:.3f} vy={st['vy']:+.2f} "
                  f"airTime={st['t']:.3f} stepping={st['st']}")
        else:
            print(f"{nm:<14}     MISSED")
    print(f"landings           {J['landings']}  (landImpact 0..1)")
    print(f"take-off at        {J.get('takeoffAt')}")
    print(f"landed at          {J.get('landAt')}")
    print(f"TRAIL GAP          {J.get('gapMetres')} m  <- no writer ran between those points")
    print(f"brushes grounded   {J['groundBrushes']}")
    print(f"brushes AIRBORNE   {len(J['airborneBrushes'])}   <- must be 0")
    print(f"touchdown AIRBORNE {J['touchdownAirborne']}   <- must be 0")
    print(f"404s               {sorted(set(net404))}")

    ok = (len(J["airborneBrushes"]) == 0 and J["touchdownAirborne"] == 0
          and rise and apex and fall and len(J["landings"]) >= 1)
    print("RESULT:", "OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
