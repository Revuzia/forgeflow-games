#!/usr/bin/env python
"""CRESTBOUND camera FEEL probe — a scripted ~25 s play session per course,
driven with REAL KeyboardEvents, sampling the camera every frame and grabbing a
screenshot every 0.5 s of game time.

camcheck.py proves the seven contract assertions. This proves nothing by itself:
it produces the EVIDENCE a human (or a critic lane) needs to answer "does it feel
like a AAA third-person camera over a real play session" —

  * frame-to-frame camera distance deltas          (collision POP)
  * hero NDC position every frame                  (follow / lead / framing)
  * yaw delta during committed moves               (auto-yaw discipline)
  * pitch indoors vs outdoors                      (lens comfort)
  * lens-inside-solid-geometry test                (camera in a wall)
  * fraction of a 3x3 view-ray grid hitting geometry within 2 m
                                                   (wall face filling the frame)
  * lens -> hero chest occlusion, per frame        (hero hidden)
  * during every airborne arc, whether the surface under the hero is inside the
    frustum                                        (jump readability)

HAND-STEPPED (round 2). The round-1 driver ran off requestAnimationFrame and
timed with performance.now(). HARNESS_NOTES records why that is not evidence:
engine.js clamps dt, so on a loaded box one rendered frame advances a large slice
of game time, key press/release pairs meant to span several frames collapse into
one, and committed moves never fire. Measured on the r1 driver, this box: median
dt 48-55 ms (≈20 fps), 24 of 315 and 84 of 403 samples survived the dt filter,
and NOT ONE longjump/dive/pound fired in either course even though the routes
command them. So this driver calls `engine.stop()` and advances the game by hand
— `engine._frameCbs` then `game.update(1/60)`, which itself calls
`engine.render()` — exactly like feelshots.py. Every sample is 16.667 ms of game
time whatever the wall clock does, so pop magnitudes, arc lengths and move
timings are comparable to a 60 fps play session and to each other.

    python camshots.py                  # both courses, headless (default)
    python camshots.py --headed
    python camshots.py --course keep

Writes  _shots/cam/<course>_<nnn>.png  and  _shots/cam/camshots.json.
Exit code is 0 unless the probe itself failed — this script does not gate.
"""
import argparse
import json
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
SHOTS = os.path.join(ROOT, "_shots", "cam")
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
DT = 1.0 / 60.0

FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

CLICK_JS = r"""() => {
  // CONTINUE first: NEW GAME opens an ERASE-confirm page when a save exists,
  // and the confirm's own buttons are what would then have to be answered.
  const words = ['CONTINUE', 'KEEP MY PROGRESS', 'NEW GAME', 'NEW RUN', 'PLAY', 'START', 'BEGIN'];
  const btns = Array.from(document.querySelectorAll('button, [role=button], .btn'));
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
  t.dispatchEvent(new KeyboardEvent('keydown', {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  t.dispatchEvent(new KeyboardEvent('keyup',   {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"
READY_JS = ("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.player"
            " && CRESTBOUND.game.player.__test && (CRESTBOUND.game.cam || CRESTBOUND.game.camera))")

# ---------------------------------------------------------------------------
# ROUTES. Each segment: {name, at:[x,y,z,yaw]|null, indoor:bool, acts:[...]}
#   act = ['hold', 'KeyW', seconds]        keys held for the whole span
#         ['tap', 'Space', n, gap]         n taps, `gap` s apart
#         ['combo', ['ControlLeft','Space'], seconds]
#         ['wait', seconds]
# `at` teleports + snaps the camera (settle window excluded from stats).
# ---------------------------------------------------------------------------
ROUTES = {
    "keep": [
        # THE LOBBY HALL — Nim spawns on the mosaic facing the aisle of paintings.
        {"name": "lobby-aisle", "at": [0.0, 0.05, -1.0, 1.5707963], "indoor": True,
         "acts": [["hold", "KeyW", 2.4], ["hold", "KeyW+KeyQ", 1.0],
                  ["hold", "KeyS", 1.2], ["hold", "KeyE", 0.8]]},
        # THE GALLERY — upper wing, tighter, painting gates on both walls.
        {"name": "gallery", "at": [0.0, 6.35, -11.0, 0.0], "indoor": True,
         "acts": [["hold", "KeyW", 2.0], ["tap", "Space", 2, 0.16],
                  ["hold", "KeyW+KeyE", 1.2], ["hold", "KeyD", 0.8]]},
        # THE UNDERCROFT — the low-ceiling basement: the worst case for pitch.
        {"name": "undercroft", "at": [-14.0, -7.95, 4.0, 0.0], "indoor": True,
         "acts": [["hold", "KeyW", 2.2], ["hold", "KeyW+KeyQ", 1.2],
                  ["hold", "KeyA", 0.8]]},
        # THE COURTYARD — open ground outside the walls: run, long jump, recenter.
        {"name": "courtyard", "at": [0.0, 0.05, 16.4, 3.1415927], "indoor": False,
         "acts": [["hold", "KeyW", 2.2], ["combo", ["ControlLeft", "Space"], 0.20],
                  ["hold", "KeyW", 1.6], ["tap", "KeyZ", 1, 0.1], ["hold", "KeyW", 1.0]]},
        # THE TOWER ROOF — high and exposed; the camera has nothing to hide behind.
        {"name": "tower-roof", "at": [-19.7, 12.65, 33.0, -1.5707963], "indoor": False,
         "acts": [["hold", "KeyW", 1.6], ["tap", "Space", 3, 0.16], ["hold", "KeyW", 1.4]]},
    ],
    "verdant-1": [
        # BAILEY MEADOW spawn — open hills, full run into the triple chain.
        {"name": "meadow-open", "at": [0, 2.0, 44, 0.0], "indoor": False,
         "acts": [["hold", "KeyW", 2.4], ["tap", "Space", 3, 0.17],
                  ["hold", "KeyW", 1.2], ["hold", "KeyW+KeyF", 0.6], ["wait", 0.8]]},
        # cp-brook — the hole and the climb; long jump over open ground.
        {"name": "brook", "at": [0, 4.4, 9, 0.0], "indoor": False,
         "acts": [["hold", "KeyW", 1.8], ["combo", ["ControlLeft", "Space"], 0.20],
                  ["hold", "KeyW", 1.4], ["hold", "KeyW+KeyQ", 1.0]]},
        # cp-gate — INSIDE the fort gateway: the tightest interior in the course.
        {"name": "fort-gate", "at": [0, 9.0, -14, 0.0], "indoor": True,
         "acts": [["hold", "KeyW", 2.4], ["hold", "KeyW+KeyE", 1.2],
                  ["hold", "KeyS", 1.2], ["tap", "KeyZ", 1, 0.1]]},
        # cp-rampart — the narrow wall walk; drop off the inside edge.
        {"name": "rampart", "at": [10.0, 14.45, -26.0, 3.1415927], "indoor": False,
         "acts": [["hold", "KeyW", 2.0], ["tap", "Space", 1, 0.1], ["hold", "KeyW", 1.6]]},
        # cp-mill — the windmill hill, plus a peek.
        {"name": "mill", "at": [28, 9.6, 8, -0.9], "indoor": False,
         "acts": [["hold", "KeyW", 1.8], ["hold", "KeyG", 1.0], ["hold", "KeyW", 1.4]]},
    ],
}

# ---------------------------------------------------------------------------
# The in-page driver. Installed per course; python pumps `__CAM.step(n)`.
# ---------------------------------------------------------------------------
DRIVER_JS = r"""
(route) => {
  const A = globalThis.CRESTBOUND;
  if (!A || !A.game) return {error: 'no CRESTBOUND.game'};
  const G = A.game, THREE = A.THREE, E = A.engine;
  const cam = G.cam || G.camera;
  const tcam = E && E.camera;
  if (!cam || !cam.__test) return {error: 'game.cam.__test missing'};
  if (!tcam) return {error: 'engine.camera missing'};

  /* HAND-STEP: own the clock. See the module docstring. */
  if (E.running) E.stop();
  const DT = 1 / 60;
  const F = s => Math.max(1, Math.round(s * 60));

  const S = globalThis.__CAM = {
    samples: [], done: false, error: null, seg: '', i: 0, total: 0,
  };

  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const target = () => document.querySelector('canvas') || document;
  const key = (type, code) => {
    const k = code === 'Space' ? ' ' : (code.startsWith('Key') ? code.slice(3).toLowerCase() : code);
    target().dispatchEvent(new KeyboardEvent(type, {code, key: k, bubbles: true, cancelable: true}));
  };
  const down = c => key('keydown', c), up = c => key('keyup', c);
  const ALL = ['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','KeyC','KeyF','KeyZ','KeyG','KeyQ','KeyE','KeyV','KeyR'];
  const allUp = () => ALL.forEach(up);

  /* ---- flatten the route into per-op frame counts ---------------------- */
  const ops = [];
  for (const seg of route) {
    if (seg.at) {
      ops.push({place: seg.at, seg: seg.name});
      ops.push({keys: [], n: F(0.85), seg: seg.name, settle: true});
    }
    for (const act of (seg.acts || [])) {
      const k = act[0];
      if (k === 'wait') ops.push({keys: [], n: F(act[1]), seg: seg.name});
      else if (k === 'hold') ops.push({keys: String(act[1]).split('+'), n: F(act[2]), seg: seg.name});
      else if (k === 'tap') {
        const n = act[2] | 0, gap = act[3] || 0.15;
        for (let i = 0; i < n; i++) {
          ops.push({keys: [act[1]], n: F(0.05), seg: seg.name});
          ops.push({keys: [], n: F(gap), seg: seg.name});
        }
      } else if (k === 'combo') {
        const c = act[1];
        ops.push({keys: [c[0]], n: F(0.05), seg: seg.name});
        ops.push({keys: c.slice(), n: F(act[2]), seg: seg.name});
      }
    }
    ops.push({keys: [], n: F(0.4), seg: seg.name});
  }
  S.total = ops.reduce((a, o) => a + (o.n || 0), 0);

  const bp = (G.course && G.course.broadphase) ||
             (cam.world && (cam.world.broadphase || (cam.world.course && cam.world.course.broadphase))) || null;
  const canRay = !!(bp && typeof bp.raycast === 'function');
  const canQuery = !!(bp && typeof bp.query === 'function');

  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  const _g = new THREE.Vector3(), _dn = new THREE.Vector3(0, -1, 0);
  const _hit = {t: 0, normal: new THREE.Vector3(), collider: null};
  const _box = new THREE.Box3();
  const qOut = [];

  /* 3x3 NDC grid of view rays: what fraction of the frame is a surface within 2 m. */
  const GRID = [];
  for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) GRID.push([gx * 0.6, gy * 0.6]);

  const lensInSolid = (px, py, pz) => {
    if (!canQuery) return null;
    _box.min.set(px - 0.02, py - 0.02, pz - 0.02);
    _box.max.set(px + 0.02, py + 0.02, pz + 0.02);
    qOut.length = 0;
    let list;
    try { list = bp.query(_box, qOut) || qOut; } catch (e) { return null; }
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.active === false || c.solid === false) continue;
      if (typeof c.containsPoint !== 'function') continue;
      _v.set(px, py, pz);
      if (c.containsPoint(_v)) return true;
    }
    return false;
  };

  const wallFrac = () => {
    if (!canRay) return null;
    let hits = 0;
    for (let i = 0; i < GRID.length; i++) {
      _v.set(GRID[i][0], GRID[i][1], 0.5).unproject(tcam).sub(tcam.position);
      const L = _v.length();
      if (L < 1e-6) continue;
      _d.copy(_v).multiplyScalar(1 / L);
      try { if (bp.raycast(tcam.position, _d, 2.0, _hit)) hits++; } catch (e) { return null; }
    }
    return hits / GRID.length;
  };

  /* JUMP READABILITY: the surface directly under the hero, and whether it is in
     frame. During an arc this is the ground the player is about to meet. */
  const groundVisible = (rp) => {
    if (!canRay) return null;
    try {
      _g.set(rp.x, rp.y + 0.25, rp.z);
      if (!bp.raycast(_g, _dn, 45, _hit)) return null;
      _g.y -= _hit.t;
      _v.copy(_g).project(tcam);
      return (_v.z < 1 && Math.abs(_v.x) <= 0.95 && Math.abs(_v.y) <= 0.95) ? 1 : 0;
    } catch (e) { return null; }
  };

  let lastDist = cam.dist, settle = false, segName = '', lastMode = cam.mode;
  const PROBE_STRIDE = 3;
  let frameNo = 0, lastInSolid = null, lastWallFrac = null;

  const sample = () => {
    syncP();
    const probeNow = (frameNo++ % PROBE_STRIDE) === 0;
    const cs = cam.__test.state();
    const rp = P.renderPos || P.pos;
    const chestY = rp.y + (P.height || 1.5) * 0.55;
    _c.set(rp.x, chestY, rp.z);
    _v.copy(_c).project(tcam);

    let occ = null;
    if (canRay) {
      _d.copy(_c).sub(tcam.position);
      const L = _d.length();
      if (L > 0.15) {
        _d.multiplyScalar(1 / L);
        try { occ = bp.raycast(tcam.position, _d, L - 0.12, _hit); } catch (e) { occ = null; }
      } else occ = false;
    }

    const grounded = !!(P.grounded || P.onGround);
    const modeChanged = cs.mode !== lastMode;
    lastMode = cs.mode;

    const nx = _v.x, ny = _v.y;
    const s = {
      i: S.i, t: +(S.i * DT).toFixed(4), dt: DT, seg: segName,
      settling: settle,
      dist: +cs.dist.toFixed(4), dDist: +(cs.dist - lastDist).toFixed(4),
      yaw: +cs.yaw.toFixed(4), pitch: +cs.pitch.toFixed(4), mode: cs.mode,
      modeChanged: modeChanged,
      fov: +cs.fov.toFixed(3),
      heroNdcX: Number.isFinite(nx) ? +nx.toFixed(4) : null,
      heroNdcY: Number.isFinite(ny) ? +ny.toFixed(4) : null,
      state: P.state, grounded: grounded,
      speed: +Math.hypot(P.vel.x, P.vel.z).toFixed(3),
      vy: +P.vel.y.toFixed(3),
      heroFade: +(cs.heroFade || 0).toFixed(3),
      autoRate: +(cs.autoRate || 0).toFixed(3), autoFrozen: !!cs.autoFrozen,
      limitCeil: !!cs.limitCeil, limitFrame: !!cs.limitFrame,
      dropBelow: +(cs.dropBelow || 0).toFixed(3),
      fallLookK: +(cs.fallLookK || 0).toFixed(3),
      lookAimK: +(cs.lookAimK || 0).toFixed(3),
      yawSlide: +(cs.yawSlide || 0).toFixed(4), focusDrop: +(cs.focusDrop || 0).toFixed(3),
      pitchAdapt: +(cs.pitchAdapt || 0).toFixed(4), distBase: +(cs.distBase || 0).toFixed(3),
      camY: +cs.pos[1].toFixed(3), focusY: +cs.focus[1].toFixed(3),
      heroY: +rp.y.toFixed(3),
      occluded: occ, inSolid: lastInSolid, wallFrac: lastWallFrac,
      groundVis: grounded ? null : groundVisible(rp),
      probed: probeNow,
    };
    if (probeNow) {
      lastInSolid = lensInSolid(cs.pos[0], cs.pos[1], cs.pos[2]);
      lastWallFrac = wallFrac();
      s.inSolid = lastInSolid; s.wallFrac = lastWallFrac;
    }
    lastDist = cs.dist;
    S.samples.push(s);
  };

  /* ---- one hand-stepped frame ------------------------------------------ */
  const held = new Set();
  const setKeys = (codes) => {
    const want = new Set(codes);
    for (const c of Array.from(held)) if (!want.has(c)) { up(c); held.delete(c); }
    for (const c of want) if (!held.has(c)) { down(c); held.add(c); }
  };

  const advance = () => {
    /* engine.start()'s tick, minus rAF: presentation clock, frame callbacks,
       then the game loop (which itself calls engine.render). */
    E.dt = DT; E.rawDt = DT; E.rawMs = DT * 1000;
    E.elapsed += DT; E.frame++;
    const cbs = E._frameCbs || [];
    for (let i = 0; i < cbs.length; i++) {
      try { cbs[i](DT, E.elapsed); } catch (e) { /* engine logs its own */ }
    }
    G.update(DT);
    S.i++;
  };

  let opIdx = 0, opLeft = ops.length ? ops[0].n : 0;

  S.step = (n) => {
    for (let k = 0; k < n && opIdx < ops.length; k++) {
      let op = ops[opIdx];
      while (op && (op.place || !(opLeft > 0))) {
        if (op.place) {
          syncP(); allUp(); held.clear();
          segName = S.seg = op.seg;
          P.__test.teleport(_v.set(op.place[0], op.place[1], op.place[2]));
          if (P.__test.setVel) P.__test.setVel(_v.set(0, 0, 0));
          if (P.__test.setFacing) P.__test.setFacing(op.place[3]);
          if (typeof cam.snapToPlayer === 'function') cam.snapToPlayer();
          cam.__test.setYaw(op.place[3]);
          lastDist = cam.dist; lastMode = cam.mode;
        }
        opIdx++;
        if (opIdx >= ops.length) { op = null; break; }
        op = ops[opIdx];
        opLeft = op.n || 0;
      }
      if (!op) break;
      segName = S.seg = op.seg;
      settle = !!op.settle;
      setKeys(op.keys || []);
      try { advance(); } catch (e) { S.error = String(e && e.stack || e); }
      sample();
      opLeft--;
    }
    if (opIdx >= ops.length) { allUp(); held.clear(); S.done = true; }
    return {i: S.i, total: S.total, done: S.done, seg: S.seg, err: S.error};
  };

  S.finish = () => {
    allUp(); held.clear();
    if (!E.running) E.start((dt) => G.update(dt));
    return true;
  };

  return {ok: true, canRay, canQuery, segs: route.length, frames: S.total};
}
"""


def wrap_pi(a):
    import math
    x = (a + math.pi) % (2 * math.pi)
    if x < 0:
        x += 2 * math.pi
    return x - math.pi


def analyse(samples):
    """Reduce the per-frame stream to the numbers the camera lane argues from."""
    live = [s for s in samples if not s["settling"]]
    if not live:
        return {"error": "no live samples"}

    # THIRD-PERSON framing statistics are only defined while the camera IS third
    # person. 'peek' is first person from the head by contract (hero hidden,
    # heroFade 1) so the chest projects behind the near plane — NDC there is not
    # a framing failure, it is the mode working. Same for the single frame that
    # ENTERS or LEAVES a mode: the distance jump is a mode change, not a
    # collision pull-in.
    tp = [s for s in live if s["mode"] in ("follow", "free")
          and s["heroNdcX"] is not None and s["heroNdcY"] is not None]
    popable = [s for s in live if not s["modeChanged"] and s["mode"] in ("follow", "free")]

    pulls = sorted(
        ({"seg": s["seg"], "t": s["t"], "dDist": s["dDist"], "dist": s["dist"],
          "state": s["state"], "mode": s["mode"]}
         for s in popable if s["dDist"] < -1.5),
        key=lambda r: r["dDist"])
    pushRates = [abs(s["dDist"]) / s["dt"] for s in popable if s["dDist"] > 0 and s["dt"] > 0]

    ndc_out = [s for s in tp if abs(s["heroNdcX"]) > 0.4 or abs(s["heroNdcY"]) > 0.4]
    in_solid = [s for s in live if s["inSolid"] is True]
    wall_fill = [s for s in live if s["wallFrac"] is not None and s["wallFrac"] >= 0.78]

    # longest continuous occlusion run (seconds)
    worst_occ, run, worst_seg = 0.0, 0.0, ""
    for s in live:
        if s["occluded"] and s["heroFade"] < 0.9:
            run += s["dt"]
            if run > worst_occ:
                worst_occ, worst_seg = run, s["seg"]
        else:
            run = 0.0

    # auto-yaw discipline during committed moves
    FREEZE = {"longjump", "dive", "slide", "slideRecover", "wallkick", "wallslide",
              "poundHang", "poundFall", "poundLand", "sideflip", "backflip", "cannon"}
    committed, cur = [], None
    for s in live:
        if s["state"] in FREEZE:
            if cur is None or cur["state"] != s["state"]:
                if cur:
                    committed.append(cur)
                cur = {"state": s["state"], "seg": s["seg"], "y0": s["yaw"],
                       "maxYawDelta": 0.0, "frames": 0, "dur": 0.0, "frozen": 0}
            cur["maxYawDelta"] = max(cur["maxYawDelta"], abs(wrap_pi(s["yaw"] - cur["y0"])))
            cur["frames"] += 1
            cur["dur"] += s["dt"]
            cur["frozen"] += 1 if s["autoFrozen"] else 0
        else:
            if cur:
                committed.append(cur)
                cur = None
    if cur:
        committed.append(cur)
    for c in committed:
        c["maxYawDelta"] = round(c["maxYawDelta"], 4)
        c["dur"] = round(c["dur"], 3)
        c["frozenPct"] = round(100.0 * c["frozen"] / max(1, c["frames"]))
        c.pop("y0", None)
        c.pop("frozen", None)

    # airborne arcs: was the hero readable, and was the landing surface in frame
    arcs, arc = [], None
    for s in live:
        if not s["grounded"] and s["state"] not in ("swim", "swimIdle", "climb", "dead"):
            if arc is None:
                arc = {"seg": s["seg"], "state": s["state"], "dur": 0.0, "n": 0,
                       "maxNdcY": 0.0, "maxNdcX": 0.0, "minPitch": 9, "maxPitch": -9,
                       "occFrames": 0, "groundVis": 0, "groundKnown": 0}
            arc["dur"] += s["dt"]
            arc["n"] += 1
            if s["heroNdcY"] is not None:
                arc["maxNdcY"] = max(arc["maxNdcY"], abs(s["heroNdcY"]))
                arc["maxNdcX"] = max(arc["maxNdcX"], abs(s["heroNdcX"]))
            arc["minPitch"] = min(arc["minPitch"], s["pitch"])
            arc["maxPitch"] = max(arc["maxPitch"], s["pitch"])
            if s["occluded"]:
                arc["occFrames"] += 1
            if s["groundVis"] is not None:
                arc["groundKnown"] += 1
                arc["groundVis"] += s["groundVis"]
        else:
            if arc and arc["dur"] >= 0.25:
                arcs.append(arc)
            arc = None
    if arc and arc["dur"] >= 0.25:
        arcs.append(arc)
    for a in arcs:
        for k in ("dur", "maxNdcY", "maxNdcX", "minPitch", "maxPitch"):
            a[k] = round(a[k], 3)
        a["landingInFramePct"] = (round(100.0 * a["groundVis"] / a["groundKnown"])
                                  if a["groundKnown"] else None)

    def stat(vals):
        if not vals:
            return None
        v = sorted(vals)
        return {"min": round(v[0], 3), "med": round(v[len(v) // 2], 3),
                "max": round(v[-1], 3), "n": len(v)}

    indoor_segs = set()
    for course_route in ROUTES.values():
        for seg in course_route:
            if seg.get("indoor"):
                indoor_segs.add(seg["name"])

    per_seg = {}
    for name in sorted({s["seg"] for s in live}):
        ss = [s for s in live if s["seg"] == name]
        st = [s for s in tp if s["seg"] == name]
        sp = [s for s in popable if s["seg"] == name]
        per_seg[name] = {
            "frames": len(ss),
            "indoor": name in indoor_segs,
            "dist": stat([s["dist"] for s in ss]),
            "pitch": stat([s["pitch"] for s in ss]),
            "ndcX": stat([abs(s["heroNdcX"]) for s in st]),
            "ndcY": stat([abs(s["heroNdcY"]) for s in st]),
            "pullIns>1.5m": sum(1 for s in sp if s["dDist"] < -1.5),
            "pullIns>0.6m": sum(1 for s in sp if s["dDist"] < -0.6),
            "inSolidFrames": sum(1 for s in ss if s["inSolid"] is True),
            "wallFillFrames": sum(1 for s in ss if s["wallFrac"] is not None and s["wallFrac"] >= 0.78),
            "maxSpeed": round(max((s["speed"] for s in ss), default=0), 2),
            "states": sorted({s["state"] for s in ss}),
        }

    ndc_stat_x = stat([abs(s["heroNdcX"]) for s in tp])
    ndc_stat_y = stat([abs(s["heroNdcY"]) for s in tp])
    return {
        "frames": len(live), "framesRaw": len(samples),
        "thirdPersonFrames": len(tp),
        "gameSeconds": round(len(live) * (live[0]["dt"]), 2),
        "pullIns>1.5m": len(pulls), "worstPullIns": pulls[:12],
        "pullIns>0.6m": sum(1 for s in popable if s["dDist"] < -0.6),
        "pushOutRate_m_per_s": {"max": round(max(pushRates), 2) if pushRates else None,
                                "cap": 12.0,
                                "overCap": sum(1 for r in pushRates if r > 12.5)},
        "distStat": stat([s["dist"] for s in live]),
        "ndcXStat": ndc_stat_x,
        "ndcYStat": ndc_stat_y,
        "framesOutsideCentral40pct": len(ndc_out),
        "pctOutsideCentral40": round(100.0 * len(ndc_out) / max(1, len(tp)), 2),
        "worstNdc": sorted(({"seg": s["seg"], "x": s["heroNdcX"], "y": s["heroNdcY"],
                             "state": s["state"], "dist": s["dist"], "vy": s["vy"]}
                            for s in ndc_out),
                           key=lambda r: -max(abs(r["x"]), abs(r["y"])))[:10],
        "lensInsideSolidFrames": len(in_solid),
        "lensInsideSolidSegs": sorted({s["seg"] for s in in_solid}),
        "wallFillFrames": len(wall_fill),
        "wallFillSegs": sorted({s["seg"] for s in wall_fill}),
        "worstOcclusionRun_s": round(worst_occ, 3), "worstOcclusionSeg": worst_seg,
        "committedMoves": committed,
        "airborneArcs": arcs,
        "perSegment": per_seg,
        "statesSeen": sorted({s["state"] for s in live}),
        "modesSeen": sorted({s["mode"] for s in live}),
    }


def run_course(page, course, shot_every, grab_shots, verbose=True):
    """One hand-stepped pass of a course route.

    Because the clock is ours, screenshots cost wall time only — they cannot
    starve the simulation — so ONE pass produces both the numbers and the roll.
    """
    os.makedirs(SHOTS, exist_ok=True)
    route = ROUTES[course]

    if course != "keep":
        page.evaluate("(id) => CRESTBOUND.game.__dev.goto(id)", course)
        t0 = time.time()
        st = None
        while time.time() - t0 < 60:
            st = page.evaluate(STATE_JS)
            cid = page.evaluate("CRESTBOUND.game.courseId")
            if st == "playing" and cid == course:
                break
            page.wait_for_timeout(200)
        else:
            raise RuntimeError("goto(%s) never reached 'playing' (state=%s)" % (course, st))
        page.wait_for_timeout(1200)

    started = page.evaluate(DRIVER_JS, route)
    if started.get("error"):
        raise RuntimeError("driver: " + started["error"])

    chunk = max(1, int(round(shot_every * 60)))
    shots, n = [], 0
    t0 = time.time()
    while time.time() - t0 < 900:
        st = page.evaluate("(n) => __CAM.step(n)", chunk)
        if grab_shots:
            path = os.path.join(SHOTS, "%s_%03d.png" % (course, n))
            try:
                page.screenshot(path=path, timeout=60000)
                shots.append({"file": os.path.basename(path), "seg": st["seg"],
                              "frame": st["i"], "t": round(st["i"] / 60.0, 2)})
            except Exception as e:
                shots.append({"file": None, "seg": st["seg"], "error": str(e)[:90]})
            n += 1
        if st["done"]:
            break

    samples = page.evaluate("__CAM.samples")
    err = page.evaluate("__CAM.error")
    page.evaluate("__CAM.finish()")
    rep = analyse(samples)
    rep["course"] = course
    rep["shots"] = shots
    rep["driverError"] = err
    if verbose:
        print("  %-10s frames=%d (%.1f s game) shots=%d pullIns>1.5m=%d "
              "ndcMax=(%.2f,%.2f) inSolid=%d wallFill=%d worstOcc=%.2fs"
              % (course, rep["frames"], rep["gameSeconds"], len(shots),
                 rep["pullIns>1.5m"], rep["ndcXStat"]["max"], rep["ndcYStat"]["max"],
                 rep["lensInsideSolidFrames"], rep["wallFillFrames"],
                 rep["worstOcclusionRun_s"]))
    return rep, samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--headed", action="store_true")
    # accepted and ignored: headless IS the default. The lane runbook spells the
    # command `camshots.py --headless`, and argparse must not fail that command.
    ap.add_argument("--headless", action="store_true", help="explicit no-op (default)")
    ap.add_argument("--course", default=None, help="keep | verdant-1 (default: both)")
    ap.add_argument("--shot-every", type=float, default=0.5)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--samples", action="store_true", help="write the raw per-frame stream too")
    ap.add_argument("--no-shots", action="store_true", help="measurement pass only")
    ap.add_argument("--out", default="camshots.json")
    args = ap.parse_args()

    courses = [args.course] if args.course else ["keep", "verdant-1"]
    for c in courses:
        if c not in ROUTES:
            print("unknown course %r (have %s)" % (c, ", ".join(ROUTES)), file=sys.stderr)
            return 2

    os.makedirs(SHOTS, exist_ok=True)
    out = {"url": args.url, "viewport": [args.width, args.height],
           "headless": not args.headed, "handStepped": True, "dt": DT, "courses": {}}

    with sync_playwright() as p:
        browser, last = None, None
        for attempt in range(6):
            try:
                browser = p.chromium.launch(channel="chrome", headless=not args.headed, args=FLAGS)
                break
            except Exception as e:
                last = e
                print("  launch attempt %d failed (%s) - backing off" % (attempt + 1, str(e)[:90]),
                      file=sys.stderr)
                time.sleep(10 * (attempt + 1))
        if browser is None:
            raise RuntimeError("chrome would not launch after 6 tries: %s" % last)
        page = browser.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        page.on("console", lambda m: errs.append("console.%s %s" % (m.type, m.text))
                if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("pageerror %s" % e))
        nav = None
        for attempt in range(5):
            try:
                page.goto(args.url, wait_until="load", timeout=180000)
                nav = True
                break
            except Exception as e:
                nav = e
                print("  goto attempt %d failed (%s) - retrying" % (attempt + 1, str(e)[:80]),
                      file=sys.stderr)
                time.sleep(15)
        if nav is not True:
            raise RuntimeError("navigation never completed: %s" % nav)

        t0 = time.time()
        while time.time() - t0 < 120:
            try:
                if page.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(400)
        if not page.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
            raise RuntimeError("globalThis.CRESTBOUND never appeared")

        t0 = time.time()
        while time.time() - t0 < 150:
            st = page.evaluate(STATE_JS)
            if st in ("keep", "playing"):
                break
            page.evaluate(CLICK_JS)
            page.wait_for_timeout(600)
        if page.evaluate(STATE_JS) not in ("keep", "playing"):
            raise RuntimeError("never left the title (state=%s)" % page.evaluate(STATE_JS))

        t0 = time.time()
        while time.time() - t0 < 120:
            try:
                if page.evaluate(READY_JS):
                    break
            except Exception:
                pass
            page.wait_for_timeout(400)
        if not page.evaluate(READY_JS):
            raise RuntimeError("player/__test never appeared")
        page.wait_for_timeout(1500)
        print("state after boot: %s" % page.evaluate(STATE_JS))

        for c in courses:
            rep, samples = run_course(page, c, args.shot_every,
                                      grab_shots=not args.no_shots)
            out["courses"][c] = rep
            if args.samples:
                with open(os.path.join(SHOTS, "%s_samples.json" % c), "w", encoding="utf-8") as f:
                    json.dump(samples, f)
        out["consoleErrors"] = errs
        browser.close()

    dest = os.path.join(SHOTS, args.out)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("wrote %s" % dest)
    if errs:
        print("console/page errors: %d" % len(errs), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
