#!/usr/bin/env python
"""
SURF OLLIE capture — drives a real ollie (RMB held + SPACE) and measures it
against the walk jump, photographing the arc and the groove gap it leaves.

Adapted from `jumpshot.py`, and for the same reason its header gives: the phase
detection lives IN THE PAGE (a rAF hook sets `S.freezeTime` the instant the
requested phase arrives) because a Playwright `evaluate` round trip costs
50-160 ms and the whole flight is under a second — wall-clock sampling misses
the apex outright.

Three phases:

    A  walk jump, trace only              -> baseline apex / hang / speed
    B  surf to speed, ollie, RMB HELD     -> 01-mid-rise / 02-apex / 03-landing
       through the landing, keep carving  -> 04-trail-gap (groove gaps, resumes)
    C  ollie, RMB RELEASED at apex        -> surf blend must decay to a run

Instrumented invariants, all counts not impressions:
    brushes written while airborne        must be 0
    figure touchdowns while airborne      must be 0
    wake spine strength while airborne    must be 0 (tracker follows, writer gated)

    python olliecheck.py
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
OUT = os.path.join(HERE, "..", "_shots", "ollie")

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
  const wake = SF.wake;

  const J = window.__ollie = {
    airborneBrushes: [], groundBrushes: 0, touchdownAirborne: 0,
    wakeStrengthAirborne: 0,
    trace: [], want: null, got: null, frames: 0, landings: [],
    takeoffAt: null, landAt: null, takeoffSpeed: null, landSpeed: null,
    landSurf: null, sawAir: false,
  };

  const orig = field.brush.bind(field);
  field.brush = function (x, z, ...rest) {
    if (SF.character.airborne) J.airborneBrushes.push([+x.toFixed(3), +z.toFixed(3)]);
    else J.groundBrushes++;
    return orig(x, z, ...rest);
  };

  window.__ollieReset = () => {
    J.trace = []; J.landings = []; J.airborneBrushes = [];
    J.takeoffAt = null; J.landAt = null; J.takeoffSpeed = null;
    J.landSpeed = null; J.landSurf = null; J.sawAir = false;
    J.want = null; J.got = null;
  };

  function tick() {
    const c = SF.character;
    J.frames++;
    const sp = Math.hypot(c.velocity.x, c.velocity.z);
    if (c.airborne || c.landed) {
      J.trace.push({ h: +c.airHeight.toFixed(4), vy: +c.vertVel.toFixed(3),
                     t: +c.airTime.toFixed(4), sp: +sp.toFixed(3),
                     surf: +c.surf.toFixed(3), st: c.stepping });
      if (c.airborne && (fig.touchdown[0] || fig.touchdown[1])) J.touchdownAirborne++;
      // The wake tracker must FOLLOW while its writer is gated: the live head
      // sample's strength while airborne must be exactly 0.
      if (c.airborne && wake && wake._strength && wake._strength[wake._head] > 0) {
        J.wakeStrengthAirborne++;
      }
      if (c.airborne && !J.takeoffAt) {
        J.sawAir = true;
        J.takeoffAt = [+c.position.x.toFixed(3), +c.position.z.toFixed(3)];
        J.takeoffSpeed = +sp.toFixed(3);
      }
      if (c.landed) {
        J.landings.push(+c.landImpact.toFixed(3));
        J.landAt = [+c.position.x.toFixed(3), +c.position.z.toFixed(3)];
        J.landSpeed = +sp.toFixed(3);
        J.landSurf = +c.surf.toFixed(3);
        if (J.takeoffAt) {
          J.gapMetres = +Math.hypot(c.position.x - J.takeoffAt[0],
                                    c.position.z - J.takeoffAt[1]).toFixed(3);
        }
      }
    }
    if (J.want && !S.freezeTime) {
      const w = J.want;
      const hit =
        w === 'rise' ? (c.airborne && c.vertVel > 0 && c.airHeight > 0.45) :
        w === 'apex' ? (c.airborne && c.vertVel <= 0) :
        w === 'land' ? (J.sawAir && !c.airborne) : false;
      if (hit) { S.freezeTime = true; J.got = w; J.want = null;
                 J.gotState = { h: c.airHeight, vy: c.vertVel, t: c.airTime,
                                sp: +sp.toFixed(3), surf: +c.surf.toFixed(3) }; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}"""


def key(pg, code, down):
    pg.evaluate(
        "([c,d]) => window.dispatchEvent(new KeyboardEvent(d?'keydown':'keyup',"
        "{code:c, bubbles:true}))", [code, down])


def surf(pg, held):
    # Level-triggered plain data property, the documented harness path
    # (core/input.js rule 1: the battery pins `input.surf` directly).
    pg.evaluate("(v) => { globalThis.SNOWFLOW.input.surf = v; }", held)


def catch(pg, phase, out=None, name=None, timeout=15.0):
    pg.evaluate("(w) => { window.__ollie.want = w; window.__ollie.got = null; }", phase)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate("() => window.__ollie.got"):
            break
        pg.wait_for_timeout(30)
    else:
        return None
    if out and name:
        pg.wait_for_timeout(900)          # let TAA converge on the held frame
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, name))
    st = pg.evaluate("() => window.__ollie.gotState")
    pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
    return st


def wait_grounded(pg, timeout=8.0):
    """The sim dilates under load (h clamps at 1/30), so wall-clock waits can
    end mid-flight — poll the flag instead of trusting a sleep."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not pg.evaluate("() => globalThis.SNOWFLOW.character.airborne"):
            return True
        pg.wait_for_timeout(60)
    return False


def carve_to_speed(pg, target=12.0, timeout=15.0):
    """Hold the carve until it is actually AT SPEED, not for a fixed wall time."""
    t0 = time.time()
    sp = 0.0
    while time.time() - t0 < timeout:
        sp = pg.evaluate("() => +Math.hypot(SNOWFLOW.character.velocity.x,"
                         " SNOWFLOW.character.velocity.z).toFixed(3)")
        if sp >= target:
            break
        pg.wait_for_timeout(150)
    return sp


def reset_pose(pg, x=0, z=0):
    pg.evaluate("""([hd, x, z]) => {
        const SF = globalThis.SNOWFLOW;
        SF.character.position.x = x; SF.character.position.z = z;
        SF.character.position.y = SF.terrain.heightAt(x, z);
        SF.character.velocity.set(0, 0, 0);
        SF.rig.yaw = hd; SF.rig.pitch = 0.30;
        SF.rig.distance = 7.0; SF.rig.distanceTarget = 7.0;
    }""", [HEADING, x, z])


def summarize(J, label):
    tr = J["trace"]
    air = [s for s in tr if s["h"] > 0]
    apex = max((s["h"] for s in air), default=0)
    hang = max((s["t"] for s in air), default=0)
    print(f"--- {label} ---")
    print(f"apex height        {apex:.3f} m")
    print(f"hang time          {hang:.3f} s")
    print(f"take-off speed     {J.get('takeoffSpeed')} m/s   landing speed {J.get('landSpeed')} m/s")
    print(f"surf at landing    {J.get('landSurf')}")
    print(f"landImpact         {J['landings']}")
    print(f"gap take-off->land {J.get('gapMetres')} m")
    if air:
        print(f"surf held in air   min {min(s['surf'] for s in air):.3f}"
              f"  max {max(s['surf'] for s in air):.3f}")
        print(f"stepping in air    {sorted(set(s['st'] for s in air))}  <- must be [False]")
    return apex, hang


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--wait", type=float, default=120.0)
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(args.url, wait_until="load", timeout=60_000)

        deadline = time.time() + args.wait
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig"
                           " && document.getElementById('boot').classList.contains('gone'))"):
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        pg.evaluate(HIDE)

        reset_pose(pg)
        pg.wait_for_timeout(1200)
        pg.evaluate(INSTRUMENT)

        # ================================================== A: walk-jump baseline
        key(pg, "ShiftLeft", True)
        key(pg, "KeyD", True)
        pg.wait_for_timeout(3000)
        # Freeze-catch the apex exactly as phase B does, so SPACE is provably
        # still held through the whole rise — a wall-clock release under sim
        # dilation lets the jump-cut clip the apex and corrupt the baseline.
        key(pg, "Space", True)
        catch(pg, "apex")
        key(pg, "Space", False)
        catch(pg, "land")
        pg.wait_for_timeout(300)
        key(pg, "KeyD", False)
        key(pg, "ShiftLeft", False)
        walk = pg.evaluate("() => window.__ollie")
        pg.evaluate("() => window.__ollieReset()")

        # ================================================== B: the ollie, RMB held
        reset_pose(pg)
        pg.wait_for_timeout(800)
        surf(pg, True)
        key(pg, "KeyW", True)
        pre_speed = carve_to_speed(pg, 12.0)

        key(pg, "Space", True)
        rise = catch(pg, "rise", out, "01-mid-rise.png")
        apex = catch(pg, "apex", out, "02-apex.png")
        key(pg, "Space", False)
        land = catch(pg, "land", out, "03-landing.png")

        # Keep carving THROUGH the landing — this is the "continues the effect"
        # half of the owner's ask.
        pg.wait_for_timeout(700)
        post = pg.evaluate("""() => ({
            surf: +SNOWFLOW.character.surf.toFixed(3),
            speed: +Math.hypot(SNOWFLOW.character.velocity.x,
                               SNOWFLOW.character.velocity.z).toFixed(3),
            airborne: SNOWFLOW.character.airborne })""")
        surf(pg, False)
        key(pg, "KeyW", False)
        ollie = pg.evaluate("() => window.__ollie")

        # Trail shot: stop, then look BACK down the run — groove, the 8-9 m
        # airborne gap, groove again. Short run-out on purpose: the deformation
        # field is a scrolling toroidal window and a long one pushes the gap
        # out of the retained area (jumpshot.py's note).
        pg.wait_for_timeout(1500)
        pg.evaluate("""(hd) => {
            const SF = globalThis.SNOWFLOW;
            SF.rig.yaw = hd + Math.PI; SF.rig.pitch = 0.55;
            SF.rig.distance = 12.0; SF.rig.distanceTarget = 12.0;
        }""", HEADING)
        pg.wait_for_timeout(3000)
        pg.evaluate(HIDE)
        pg.screenshot(path=os.path.join(out, "04-trail-gap.png"))
        pg.evaluate("() => window.__ollieReset()")

        # ============================================ C: RMB released at the apex
        reset_pose(pg)
        pg.wait_for_timeout(800)
        surf(pg, True)
        key(pg, "KeyW", True)
        carve_to_speed(pg, 12.0)
        key(pg, "Space", True)
        catch(pg, "apex")                 # freeze at apex, no screenshot
        surf(pg, False)                   # release RMB mid-air
        key(pg, "Space", False)
        catch(pg, "land")
        key(pg, "KeyW", False)
        # The blend decays at 3.4/s of SIM time; poll for it rather than
        # trusting one wall-clock sample under dilation.
        t0 = time.time()
        rel_surf = 1.0
        while time.time() - t0 < 5.0:
            rel_surf = pg.evaluate("() => +SNOWFLOW.character.surf.toFixed(3)")
            if rel_surf < 0.25:
                break
            pg.wait_for_timeout(100)
        rel_secs = round(time.time() - t0, 2)
        released = pg.evaluate("""() => ({
            surf: +SNOWFLOW.character.surf.toFixed(3),
            stepping: SNOWFLOW.character.stepping,
            trace: window.__ollie })""")
        released["decaySecs"] = rel_secs

        br.close()

    print("=" * 64)
    wapex, whang = summarize(walk, "WALK JUMP (baseline)")
    oapex, ohang = summarize(ollie, "SURF OLLIE (RMB held)")
    print("--- ratios ---")
    if wapex > 0:
        print(f"apex ollie/walk    {oapex / wapex:.2f}x   hang {ohang / whang:.2f}x")
    print(f"speed carve pre-jump {pre_speed} m/s")
    print(f"post-landing (+0.7s) surf={post['surf']} speed={post['speed']} airborne={post['airborne']}")
    rl = released["trace"]
    print("--- RMB released at apex ---")
    print(f"surf after landing      {released['surf']}"
          f"  (decayed below 0.25 in {released['decaySecs']}s wall)"
          f"  stepping={released['stepping']}")
    print(f"landImpact              {rl['landings']}")
    print("--- invariants ---")
    ab = len(walk["airborneBrushes"]) + len(ollie["airborneBrushes"]) + len(rl["airborneBrushes"])
    ta = walk["touchdownAirborne"] + ollie["touchdownAirborne"]
    ws = ollie["wakeStrengthAirborne"]
    print(f"brushes AIRBORNE        {ab}   <- must be 0")
    print(f"touchdown AIRBORNE      {ta}   <- must be 0")
    print(f"wake strength AIRBORNE  {ws}   <- must be 0")

    ok = (ab == 0 and ta == 0 and ws == 0
          and rise and apex and land
          and oapex > wapex * 1.5
          and post["surf"] > 0.9 and not post["airborne"]
          and released["surf"] < 0.25)
    print("RESULT:", "OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
