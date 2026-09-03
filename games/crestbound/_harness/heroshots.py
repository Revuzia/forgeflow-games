#!/usr/bin/env python
"""CRESTBOUND hero portrait battery — the evidence the HERO critic judges.

The spawn screenshots are useless for judging Nim: spawn sits inside
checkpoint[0]'s beam, which swallows him. This harness therefore TELEPORTS the
hero away from every checkpoint (default +12 m along +X from spawn, then
gravity-settles), takes manual control of the camera, and photographs him.

What it produces, in `_shots/hero/`:

  <state>_p10.png / _p50.png / _p90.png   every CONTRACT §11 controller state,
                                          at 10 / 50 / 90 % through that state's
                                          nominal duration, close-up (2.6 m,
                                          front-three-quarter, slightly above)
  turntable_a0..a7.png                    8-angle idle turntable
  runcycle_f0..f5.png                     6 frames over ONE 1.90 m stride
  silhouette_20m.png                      the 20 m read
  _contact_states.png / _contact_misc.png labelled contact sheets

HOW THE POSE IS REAL, not a mock: the pose writers in hero.js are pure
functions of (anim, animT, vel, grounded, speed, wallN, …). This harness
replaces `player.update` with a hook that writes exactly those fields and
advances animT with REAL wall-clock dt, then lets the game's own ordered
update run `hero.update(dt, player)`. Springs, flip integrators, the scarf
verlet and the blink clock therefore integrate over the same timeline they
would in play. At the capture phase the hook freezes and `hero.update` is
skipped for the shutter frames, so nothing over-settles past the pose.

    python heroshots.py                       # headless (parallel-lane safe)
    python heroshots.py --headed
    python heroshots.py --course verdant-1 --only jump3,dive
"""
import argparse
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "_shots", "hero")
BASE = "http://localhost:8788/games/crestbound/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
# HARNESS_NOTES: plain headless reaches the real Intel UHD over d3d11 here.
HEADLESS_FLAGS = list(FLAGS)

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

# ---------------------------------------------------------------------------
# Take manual control. Installed once per page.
# ---------------------------------------------------------------------------
SEIZE_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, G = A && A.game, THREE = A && A.THREE;
  if (!G || !G.player || !G.hero || !THREE) return {error: 'no game/player/hero/THREE'};

  const H = window.__HH = {
    on: false, frozen: false, t: 0,
    anim: 'idle', grounded: true,
    vx: 0, vy: 0, vz: 0, speed: 0, lean: 0, dead: false,
    facing: 0, x: 0, y: 0, z: 0,
    wallNx: 0, wallNz: 0, inWater: false, submerged: false,
    gravity: 0,                 // m/s^2 applied to vy while held (0 = hold vy)
    pin: true,                  // keep the root pinned at (x,y,z)?
    drift: false,               // integrate pos from vel (run cycle)
  };

  H.sub = 10;                   // sim substeps per RENDERED frame
  H.subDt = 1 / 60;             // seconds per substep (shortened for brief states)
  H.stopAt = 1e9;               // freeze the instant the hold clock reaches this

  const P = G.player;
  // The controller is replaced by a field writer. It is driven from the hero
  // wrapper below at a FIXED 1/60 s, so every spring, flip integrator, scarf
  // verlet and blink clock integrates over the same timeline a 60 fps play
  // session produces — regardless of how slow this headless box renders.
  const writeFields = P.update = function (dt) {
    if (!H.on) return;
    const d = Math.min(Math.max(dt || 0, 0), 1 / 15);
    if (!H.frozen) {
      H.t += d;
      if (H.gravity) H.vy -= H.gravity * d;
      if (H.drift) { H.x += H.vx * d; H.y += H.vy * d; H.z += H.vz * d; }
    }
    if (H.pin || H.drift) {
      this.pos.set(H.x, H.y, H.z);
      this.prevPos.copy(this.pos);
      this.renderPos.copy(this.pos);
    }
    this.vel.set(H.vx, H.vy, H.vz);
    this.facing = H.facing;
    this.grounded = H.grounded;
    this.onGround = H.grounded;
    this.state = H.anim;
    this.anim = H.anim;
    this.stateT = H.t;
    this.animT = H.t;
    this.speed = H.speed;
    this.speedNorm = Math.min(1, H.speed / 9);
    this.leanX = H.lean;
    this.dead = H.dead;
    this.heroFade = 0;
    this.inWater = H.inWater ? (this.inWater || {}) : null;
    this.submerged = H.submerged;
    this.crouching = (H.anim === 'crouch' || H.anim === 'crouchwalk');
    this.sliding = (H.anim === 'slide' || H.anim === 'slopeSlide');
    if (H.wallNx || H.wallNz) {
      if (!this.wallN || typeof this.wallN.set !== 'function') this.wallN = new THREE.Vector3();
      this.wallN.set(H.wallNx, 0, H.wallNz);
    } else { this.wallN = null; }
  };

  // Camera + world logic that would fight us.
  if (G.cam) G.cam.update = function () {};
  G._checkDeath = function () {};
  G._checkCheckpointVolumes = function () {};
  G._pollMood = function () {};
  G.freezeHazards = true;

  // Skip hero.update on frozen (shutter) frames so springs do not over-settle
  // past the pose that the phase actually reached; otherwise run H.sub fixed
  // 1/60 s steps per rendered frame.
  const heroUpdate = Object.getPrototypeOf(G.hero).update;
  P.update = function () {};                  // driven from here instead
  G.hero.update = function (dt, p) {
    if (!H.on) return heroUpdate.call(this, dt, p);
    if (H.frozen) return;
    const n = Math.max(1, H.sub | 0);
    const sd = Math.max(1 / 600, H.subDt || 1 / 60);
    for (let k = 0; k < n; k++) {
      writeFields.call(p, sd);
      heroUpdate.call(this, sd, p);
      // epsilon: `steps` equal float parts can sum a hair under `target`,
      // and one extra 1/60 s substep is 0.15 m of run distance.
      if (H.t >= H.stopAt - 1e-9) { H.frozen = true; break; }
    }
  };

  // The HUD is chrome, not the subject.
  for (const sel of ['#hud', '.cb-hud', '#ui', '.cb-ui', '#overlay']) {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  }
  return {ok: true};
}
"""

# Find a clean patch of ground: spawn + offset, dropped onto the surface, and
# checked against every checkpoint so no beam is in the frame.
FINDSPOT_JS = r"""
(o) => {
  const A = globalThis.CRESTBOUND, G = A.game, C = G.course, THREE = A.THREE;
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  const s = (sp && sp.pos) ? sp.pos : (G.player.pos);
  const cps = (C.checkpoints || []).map(c => (c && c.pos) ? c.pos : c).filter(c => c && typeof c.x === 'number');
  const bp = C.broadphase;
  const cast = (x, z, fromY) => {
    if (!bp || typeof bp.raycast !== 'function') return null;
    const hit = {t:0, normal:new THREE.Vector3(), point:new THREE.Vector3(), collider:null, heightfield:null};
    const ok = bp.raycast(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0,-1,0), 60, hit);
    return ok ? hit.point.y : null;
  };
  const cands = [];
  for (const ang of [0, 45, 90, 135, 180, 225, 270, 315]) {
    for (const r of [o.r, o.r * 1.5, o.r * 0.6]) {
      const x = s.x + Math.cos(ang * Math.PI / 180) * r;
      const z = s.z + Math.sin(ang * Math.PI / 180) * r;
      const gy = cast(x, z, s.y + 8);
      if (gy === null) continue;
      let near = 1e9;
      for (const c of cps) near = Math.min(near, Math.hypot(c.x - x, c.z - z));
      if (near < o.clear) continue;
      const score = near - Math.abs(gy - s.y) * 0.5;
      cands.push({x, y: gy, z, near: +near.toFixed(1), score: +score.toFixed(2)});
    }
  }
  cands.sort((a, b) => b.score - a.score);
  if (!cands.length) {
    const x = s.x + o.r, z = s.z;
    const gy = cast(x, z, s.y + 8);
    cands.push({x, y: gy === null ? s.y : gy, z, near: -1, score: 0, fallback: true});
  }
  return {cands: cands.slice(0, 8), spot: cands[0],
          spawn: {x:+s.x.toFixed(2), y:+s.y.toFixed(2), z:+s.z.toFixed(2)},
          checkpoints: cps.length};
}
"""

# One capture: configure the hold, advance real frames to the phase, freeze,
# place the camera, settle the shutter.
POSE_JS = r"""
async (o) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const H = window.__HH;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  if (!H) return {error: 'not seized'};

  H.on = true; H.frozen = false;
  H.x = o.spot.x; H.y = o.spot.y + (o.lift || 0); H.z = o.spot.z;
  H.facing = o.facing || 0;
  H.pin = !o.drift; H.drift = !!o.drift;
  H.wallNx = o.wallNx || 0; H.wallNz = o.wallNz || 0;
  H.inWater = !!o.inWater; H.submerged = !!o.submerged;
  H.dead = o.anim === 'dead';
  H.lean = o.lean || 0;

  // settle into a NEUTRAL anim first, so switching to the target anim is a real
  // state EDGE (that is what fires squash/stretch in hero._updateSquash).
  H.subDt = 1 / 60; H.sub = 12; H.stopAt = 1e9;
  H.anim = o.from || 'fall';
  H.grounded = !!o.fromGrounded;
  H.vx = 0; H.vy = o.fromGrounded ? 0 : -1; H.vz = 0; H.speed = 0; H.gravity = 0;
  H.t = 0;
  for (let k = 0; k < 5; k++) await frame();        // ~1.0 s of settle

  // now the real state.
  // The hold is divided into an EXACT integer number of equal substeps, so the
  // clock lands on `target` instead of overshooting by up to one substep. That
  // overshoot is 1/60 s = 0.15 m of ground distance at a 9 m/s run, and it
  // accumulates across shots: the six run-cycle frames came back at phases
  // 1.44 / 0.62 / 0.78 / 1.94 / 4.09 / 0.95 rad instead of six even steps of
  // 1.047 rad, which made an even stride look like a static shuffle.
  const target = Math.max(1 / 600, o.hold || 0);
  const steps = Math.max(8, Math.ceil(target * 60));
  H.subDt = target / steps;
  H.sub = Math.max(4, Math.min(60, Math.ceil(steps / 14)));
  H.stopAt = target;
  H.anim = o.anim;
  H.grounded = !!o.grounded;
  H.vx = o.vx || 0; H.vy = o.vy || 0; H.vz = o.vz || 0;
  H.speed = Math.hypot(H.vx, H.vz);
  H.gravity = o.gravity || 0;
  H.t = 0;
  H.frozen = false;
  // `_dist` is cumulative for the whole course, so the run-cycle phase a shot
  // reaches depends on every shot before it. Zeroing it at the state edge makes
  // the phase a pure function of (hold x speed) and the strip reproducible.
  if (o.distReset) { G.hero._dist = 0; G.hero._phase = 0; }

  const deadline = performance.now() + 20000;
  let guard = 0;
  while (!H.frozen && performance.now() < deadline && guard < 400) { await frame(); guard++; }
  H.frozen = true;

  // ---- camera -----------------------------------------------------------
  const cam = G.engine.camera;
  const f = {x: -Math.sin(H.facing), z: -Math.cos(H.facing)};
  const rt = {x: -f.z, z: f.x};
  const az = (o.az === undefined ? 35 : o.az) * Math.PI / 180;   // 0 = dead front
  const d = o.dist === undefined ? 2.6 : o.dist;
  const aim = {x: H.x, y: H.y + (o.aimY === undefined ? 0.82 : o.aimY), z: H.z};
  const el = (o.el === undefined ? 12 : o.el) * Math.PI / 180;
  const horiz = Math.cos(el) * d;
  // +f is the direction Nim FACES, so the camera sits along +f to see his face.
  cam.position.set(
    aim.x + f.x * horiz * Math.cos(az) + rt.x * horiz * Math.sin(az),
    aim.y + Math.sin(el) * d,
    aim.z + f.z * horiz * Math.cos(az) + rt.z * horiz * Math.sin(az),
  );
  cam.lookAt(aim.x, aim.y, aim.z);
  cam.updateMatrixWorld(true);

  for (let k = 0; k < 3; k++) await frame();
  const hero = G.hero;
  const bn = (n) => { const b = hero.bones[n]; return b ? [+b.rotation.x.toFixed(3), +b.rotation.y.toFixed(3), +b.rotation.z.toFixed(3)] : null; };
  const rig = {
    phase: +hero._phase.toFixed(3), dist: +hero._dist.toFixed(2),
    speed: +hero._speed.toFixed(2), speedN: +hero._speedN.toFixed(2),
    squash: +hero._squash.toFixed(3), ikW: +hero._ikW.toFixed(3),
    flip: [+hero._flipPitch.toFixed(2), +hero._flipRoll.toFixed(2), +hero._flipYaw.toFixed(2)],
    upperLegR: bn('upperLegR'), upperLegL: bn('upperLegL'),
    upperArmR: bn('upperArmR'), upperArmL: bn('upperArmL'),
    chest: bn('chest'), head: bn('head'),
    scarfTip: [+hero._scarfP[21].toFixed(2), +hero._scarfP[22].toFixed(2), +hero._scarfP[23].toFixed(2)],
    scarfRoot: [+hero._scarfP[0].toFixed(2), +hero._scarfP[1].toFixed(2), +hero._scarfP[2].toFixed(2)],
  };
  return {ok: true, t: +H.t.toFixed(3), anim: G.player.anim, rig,
          heroVisible: !!(hero && hero.rig && hero.rig.visible),
          blobVisible: !!(hero && hero.shadowBlob && hero.shadowBlob.mesh
                          ? hero.shadowBlob.mesh.visible : null),
          camPos: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)]};
}
"""

G = 34.0   # TUNE.gravRise — used only to animate vy through a held air state

# name -> capture context. `dur` is the state's nominal life in seconds.
STATES = [
    # name          dur    grounded vx      vy     grav   extra
    ("idle",        5.0,  dict(grounded=1, vx=0, vz=0, vy=0)),
    ("run",         0.63, dict(grounded=1, vx=9.0, vy=0)),
    ("skid",        0.30, dict(grounded=1, vx=5.5, vy=0)),
    ("pivot",       0.12, dict(grounded=1, vx=6.5, vy=0, lean=0.8)),
    # bonk: pressed against a wall the hero cannot pass. vx ~ 0 because the wall
    # has already taken the speed; the wall normal points back at the hero.
    ("bonk",        0.50, dict(grounded=1, vx=0.4, vy=0, wallNx=-1.0, from_="run")),
    ("crouch",      0.60, dict(grounded=1, vx=0, vy=0)),
    ("crouchwalk",  1.10, dict(grounded=1, vx=2.2, vy=0)),
    ("jump1",       0.68, dict(grounded=0, vx=6.0, vy=11.4, gravity=G, from_="run")),
    ("jump2",       0.78, dict(grounded=0, vx=7.5, vy=13.3, gravity=G, from_="land")),
    ("jump3",       0.92, dict(grounded=0, vx=8.5, vy=15.6, gravity=G, from_="land")),
    ("longjump",    0.90, dict(grounded=0, vx=17.0, vy=8.5, gravity=G, from_="crouch")),
    ("backflip",    0.87, dict(grounded=0, vx=-4.0, vy=14.8, gravity=G, from_="crouch")),
    ("sideflip",    0.84, dict(grounded=0, vx=5.0, vy=14.3, gravity=G, from_="crouch")),
    ("fall",        1.10, dict(grounded=0, vx=3.0, vy=-4.0, gravity=46.0)),
    ("dive",        0.75, dict(grounded=0, vx=13.5, vy=4.5, gravity=G, from_="run")),
    ("slide",       0.70, dict(grounded=1, vx=9.0, vy=0, from_="dive")),
    ("slideRecover", 0.25, dict(grounded=1, vx=1.0, vy=0, from_="slide")),
    ("wallslide",   0.80, dict(grounded=0, vx=0, vy=-4.0, wallNx=-1.0, from_="fall")),
    ("wallkick",    0.70, dict(grounded=0, vx=-7.5, vy=12.0, gravity=G,
                               wallNx=-1.0, from_="wallslide")),
    ("poundHang",   0.20, dict(grounded=0, vx=0, vy=0, from_="fall")),
    ("poundFall",   0.40, dict(grounded=0, vx=0, vy=-40.0, from_="poundHang")),
    ("poundLand",   0.20, dict(grounded=1, vx=0, vy=0, from_="poundFall")),
    ("land",        0.16, dict(grounded=1, vx=4.0, vy=0, from_="fall")),
    ("hardLand",    0.30, dict(grounded=1, vx=1.0, vy=0, from_="fall")),
    ("slopeSlide",  0.90, dict(grounded=1, vx=11.0, vy=-3.0)),
    ("swimIdle",    2.20, dict(grounded=0, vx=0, vy=0, inWater=1)),
    ("swim",        1.10, dict(grounded=0, vx=4.5, vy=0, inWater=1)),
    ("swimDive",    1.00, dict(grounded=0, vx=3.0, vy=-6.0, inWater=1, submerged=1)),
    ("climb",       1.40, dict(grounded=0, vx=0, vy=2.6)),
    ("climbKick",   0.55, dict(grounded=0, vx=-7.0, vy=11.0, gravity=G, from_="climb")),
    ("cannon",      1.00, dict(grounded=0, vx=0, vy=0)),
    ("fly",         2.00, dict(grounded=0, vx=6.0, vy=1.0)),
    ("dead",        1.40, dict(grounded=1, vx=0, vy=0, from_="fall")),
]

PHASES = (("p10", 0.10), ("p50", 0.50), ("p90", 0.90))

# `from` anims that are on the ground (so the neutral settle is grounded too).
GROUNDED_FROM = {"land", "crouch", "slide", "idle", "run", "poundLand", "slideRecover", "bonk"}


def leave_title(pg, timeout=60):
    dl = time.time() + timeout
    while time.time() < dl:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("keep", "playing"):
            return True
        if st == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def contact_sheet(paths, out, title, cols=6, cell=(320, 180)):
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return None
    if not paths:
        return None
    rows = (len(paths) + cols - 1) // cols
    lab = 16
    W, Hh = cell[0] * cols, (cell[1] + lab) * rows + 26
    sheet = Image.new("RGB", (W, Hh), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    d.text((8, 7), title, fill=(240, 240, 240))
    for i, (name, p) in enumerate(paths):
        if not os.path.isfile(p):
            continue
        try:
            im = Image.open(p).convert("RGB")
        except Exception:
            continue
        im.thumbnail(cell)
        x = (i % cols) * cell[0]
        y = (i // cols) * (cell[1] + lab) + 26
        sheet.paste(im, (x + (cell[0] - im.width) // 2, y))
        d.text((x + 4, y + cell[1] + 2), name, fill=(200, 210, 220))
    sheet.save(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--width", type=int, default=900)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--only", default=None, help="comma list of state names")
    ap.add_argument("--radius", type=float, default=12.0)
    ap.add_argument("--clear", type=float, default=7.0, help="min metres from any checkpoint")
    ap.add_argument("--skip-extras", action="store_true")
    ap.add_argument("--extras-only", action="store_true",
                    help="skip the per-state battery, shoot only turntable / run "
                         "cycle / silhouette / shadow / face")
    args = ap.parse_args()

    only = set(s.strip() for s in args.only.split(",")) if args.only else None
    os.makedirs(OUT, exist_ok=True)
    url = "%s?dev=1&course=%s" % (BASE, args.course)
    report = {"course": args.course, "shots": [], "errors": []}

    with sync_playwright() as p:
        if args.headed:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=True, args=HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:300]))
        pg.on("console", lambda m: errs.append("console:" + m.text[:250]) if m.type == "error" else None)
        pg.goto(url, wait_until="load", timeout=60_000)

        dl = time.time() + 60
        while time.time() < dl:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.hero)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not leave_title(pg):
            print("FAILED to reach a live state")
            br.close()
            return 2
        pg.wait_for_timeout(2500)

        spot = pg.evaluate(FINDSPOT_JS, {"r": args.radius, "clear": args.clear})
        print("spawn      : %s" % spot.get("spawn"))
        print("checkpoints: %s" % spot.get("checkpoints"))
        print("shot spot  : %s" % spot.get("spot"))
        report["spot"] = spot
        s = spot["spot"]

        seized = pg.evaluate(SEIZE_JS)
        print("seize      : %s" % seized)
        if seized.get("error"):
            br.close()
            return 2

        # Pick the BRIGHTEST legal spot. A portrait shot in a rock's shadow
        # cannot answer "do the materials read as cloth vs rubber vs metal",
        # so the choice is measured off real pixels, not guessed.
        try:
            from PIL import Image
            probe_dir = os.path.join(OUT, "_probe")
            os.makedirs(probe_dir, exist_ok=True)
            best, bestv = None, -1.0
            for i, c in enumerate(spot.get("cands", [])[:6]):
                o = {"anim": "idle", "hold": 0.30, "grounded": 1, "vx": 0, "vy": 0,
                     "vz": 0, "from": "land", "fromGrounded": 1, "lift": 0.0,
                     "facing": 0.0, "az": 35, "dist": 2.6, "el": 12, "aimY": 0.82,
                     "spot": c}
                pg.evaluate(POSE_JS, o)
                pp = os.path.join(probe_dir, "cand%d.png" % i)
                pg.screenshot(path=pp, timeout=120_000,
                              clip={"x": args.width * 0.28, "y": args.height * 0.25,
                                    "width": args.width * 0.44, "height": args.height * 0.5})
                im = Image.open(pp).convert("L")
                v = sum(im.getdata()) / float(im.width * im.height)
                print("  cand%d %s  luma %.1f" % (i, [round(c["x"], 1), round(c["y"], 1), round(c["z"], 1)], v))
                if v > bestv:
                    bestv, best = v, c
            if best:
                s = best
                report["chosen"] = {"spot": best, "luma": round(bestv, 1)}
                print("chosen spot: %s  luma %.1f" % (best, bestv))
        except Exception as e:
            print("brightness probe skipped: %s" % e)

        def shot(name, opts):
            o = dict(opts)
            o["spot"] = s
            t0 = time.time()
            r = pg.evaluate(POSE_JS, o)
            path = os.path.join(OUT, name + ".png")
            pg.screenshot(path=path, timeout=120_000)
            report["shots"].append({"name": name, "r": r})
            print("  %-26s t=%-6s vis=%s  %.1fs" % (name, r.get("t"), r.get("heroVisible"), time.time() - t0))
            sys.stdout.flush()
            return path

        state_paths = []
        for (nm, dur, ctx) in STATES:
            if args.extras_only or (only and nm not in only):
                continue
            for (ph, frac) in PHASES:
                o = {
                    "anim": nm, "hold": dur * frac,
                    "grounded": ctx.get("grounded", 1),
                    "vx": ctx.get("vx", 0), "vy": ctx.get("vy", 0), "vz": ctx.get("vz", 0),
                    "gravity": ctx.get("gravity", 0),
                    "wallNx": ctx.get("wallNx", 0), "wallNz": ctx.get("wallNz", 0),
                    "inWater": ctx.get("inWater", 0), "submerged": ctx.get("submerged", 0),
                    "lean": ctx.get("lean", 0),
                    "drift": ctx.get("drift", 0),
                    "from": ctx.get("from_", "fall"),
                    "fromGrounded": 1 if ctx.get("from_", "fall") in GROUNDED_FROM else 0,
                    "lift": 0.0 if ctx.get("grounded", 1) else 2.2,
                    "facing": 0.0, "az": 35,
                    "dist": 2.6 if ctx.get("grounded", 1) else 4.2,
                    "el": 12,
                    "aimY": 0.82 if ctx.get("grounded", 1) else 0.35,
                }
                state_paths.append((nm + " " + ph, shot("%s_%s" % (nm, ph), o)))

        if not args.skip_extras and (args.extras_only or not only):
            misc = []
            for i in range(8):
                o = {"anim": "idle", "hold": 1.2 + i * 0.05, "grounded": 1,
                     "vx": 0, "vy": 0, "vz": 0, "from": "land", "fromGrounded": 1,
                     "lift": 0.0, "facing": 0.0,
                     "az": i * 45.0, "dist": 2.6, "el": 10, "aimY": 0.80}
                misc.append(("turn %d deg" % (i * 45), shot("turntable_a%d" % i, o)))

            # one 1.90 m stride at 9 m/s = 0.2111 s; 6 evenly spaced frames.
            # `distReset` zeroes the hero's cumulative ground distance at the
            # state edge, so frame i sits at exactly phase i/6 of one stride.
            stride_t = 1.90 / 9.0
            for i in range(6):
                o = {"anim": "run", "hold": 1.40 + stride_t * (i / 6.0), "grounded": 1,
                     "vx": 9.0, "vy": 0, "vz": 0, "from": "land", "fromGrounded": 1,
                     "lift": 0.0, "facing": 0.0, "az": 78, "dist": 3.0, "el": 8,
                     "aimY": 0.80, "distReset": 1}
                misc.append(("run f%d" % i, shot("runcycle_f%d" % i, o)))

            o = {"anim": "run", "hold": 1.0, "grounded": 1, "vx": 9.0, "vy": 0, "vz": 0,
                 "from": "land", "fromGrounded": 1, "lift": 0.0, "facing": 0.0,
                 "az": 40, "dist": 20.0, "el": 6, "aimY": 0.85}
            misc.append(("20 m", shot("silhouette_20m", o)))

            o = {"anim": "idle", "hold": 1.2, "grounded": 1, "vx": 0, "vy": 0, "vz": 0,
                 "from": "land", "fromGrounded": 1, "lift": 0.0, "facing": 0.0,
                 "az": 40, "dist": 20.0, "el": 6, "aimY": 0.85}
            misc.append(("20 m idle", shot("silhouette_20m_idle", o)))

            # shadow evidence: low angle, so the cast shadow is in frame
            o = {"anim": "idle", "hold": 1.2, "grounded": 1, "vx": 0, "vy": 0, "vz": 0,
                 "from": "land", "fromGrounded": 1, "lift": 0.0, "facing": 0.0,
                 "az": 55, "dist": 4.2, "el": 4, "aimY": 0.55}
            misc.append(("shadow", shot("shadow_lowangle", o)))

            # face close-up
            o = {"anim": "idle", "hold": 2.0, "grounded": 1, "vx": 0, "vy": 0, "vz": 0,
                 "from": "land", "fromGrounded": 1, "lift": 0.0, "facing": 0.0,
                 "az": 18, "dist": 1.15, "el": 6, "aimY": 1.22}
            misc.append(("face", shot("face_closeup", o)))
            o["hold"] = 6.4      # past IDLE_LOOK_AFTER=4 s
            misc.append(("face look", shot("face_lookaround", o)))

            contact_sheet(misc, os.path.join(OUT, "_contact_misc.png"), "NIM — turntable / run cycle / reads")

        if state_paths:
            contact_sheet(state_paths, os.path.join(OUT, "_contact_states.png"),
                          "NIM — every controller state at 10/50/90 %", cols=9)
        report["errors"] = errs[:40]
        br.close()

    with open(os.path.join(HERE, "heroshots.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("errors: %d" % len(report["errors"]))
    for e in report["errors"][:10]:
        print("  ! %s" % e)
    print("wrote %d shots to %s" % (len(report["shots"]), OUT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
