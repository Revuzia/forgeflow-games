#!/usr/bin/env python
"""CRESTBOUND camera FEEL probe — a scripted ~25 s play session per course,
driven with REAL KeyboardEvents, sampling the camera every frame and grabbing a
screenshot every 0.5 s.

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
  * during every airborne arc, whether the landing surface is inside the frustum
                                                   (jump readability)

Route: each course is a list of SEGMENTS. A segment teleports Nim to an authored
station (checkpoint / spawn — the only reliable way to reach a specific interior
headlessly), snaps the camera, waits for the pose to settle, and then drives real
keys for several seconds. Samples taken during the settle window are flagged
`settling` and excluded from every pop / framing statistic, because the snap
itself is a legitimate discontinuity.

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
# The in-page driver. Installed once; started per course; polls its own samples.
# ---------------------------------------------------------------------------
DRIVER_JS = r"""
(route) => {
  const A = globalThis.CRESTBOUND;
  if (!A || !A.game) return {error: 'no CRESTBOUND.game'};
  const G = A.game, THREE = A.THREE;
  const cam = G.cam || G.camera;
  const tcam = A.engine && A.engine.camera;
  if (!cam || !cam.__test) return {error: 'game.cam.__test missing'};
  if (!tcam) return {error: 'engine.camera missing'};

  const S = globalThis.__CAMSHOTS = {samples: [], done: false, error: null, seg: '', mark: 0};

  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const target = () => document.querySelector('canvas') || document;
  const key = (type, code) => {
    const k = code === 'Space' ? ' ' : (code.startsWith('Key') ? code.slice(3).toLowerCase() : code);
    target().dispatchEvent(new KeyboardEvent(type, {code, key: k, bubbles: true, cancelable: true}));
  };
  const down = c => key('keydown', c), up = c => key('keyup', c);
  const ALL = ['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','KeyC','KeyF','KeyZ','KeyG','KeyQ','KeyE','KeyV','KeyR'];
  const allUp = () => ALL.forEach(up);

  const bp = (G.course && G.course.broadphase) ||
             (cam.world && (cam.world.broadphase || (cam.world.course && cam.world.course.broadphase))) || null;
  const canRay = !!(bp && typeof bp.raycast === 'function');
  const canQuery = !!(bp && typeof bp.query === 'function');

  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
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

  let lastT = performance.now(), lastDist = cam.dist, settleUntil = 0, segName = '';
  /* The 3x3 wall-fill grid is 9 broadphase raycasts and the lens-in-solid test is
     a broadphase query; marching the Keep's heightfield ten times per frame cost
     more than the game itself (measured: 6 fps with them on every frame, vs the
     game's real headless rate). They answer slow-moving questions, so they run on
     a 6-frame stride and the last value is carried — 10 Hz is far finer than any
     "the lens is buried in a wall" event lasts. */
  const PROBE_STRIDE = 6;
  let frameNo = 0, lastInSolid = null, lastWallFrac = null, probeNow = false;

  const sample = () => {
    syncP();
    probeNow = (frameNo++ % PROBE_STRIDE) === 0;
    const now = performance.now();
    const dt = (now - lastT) / 1000; lastT = now;
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

    const s = {
      t: +(now / 1000).toFixed(4), dt: +dt.toFixed(4), seg: segName,
      settling: now < settleUntil,
      dist: +cs.dist.toFixed(4), dDist: +(cs.dist - lastDist).toFixed(4),
      yaw: +cs.yaw.toFixed(4), pitch: +cs.pitch.toFixed(4), mode: cs.mode,
      fov: +cs.fov.toFixed(3),
      heroNdcX: +_v.x.toFixed(4), heroNdcY: +_v.y.toFixed(4),
      state: P.state, grounded: !!(P.grounded || P.onGround),
      speed: +Math.hypot(P.vel.x, P.vel.z).toFixed(3),
      vy: +P.vel.y.toFixed(3),
      heroFade: +(cs.heroFade || 0).toFixed(3),
      autoRate: +(cs.autoRate || 0).toFixed(3), autoFrozen: !!cs.autoFrozen,
      camY: +cs.pos[1].toFixed(3), focusY: +cs.focus[1].toFixed(3),
      heroY: +rp.y.toFixed(3),
      occluded: occ, inSolid: lastInSolid, wallFrac: lastWallFrac,
      probed: probeNow,
    };
    if (probeNow) {
      lastInSolid = lensInSolid(cs.pos[0], cs.pos[1], cs.pos[2]);
      lastWallFrac = wallFrac();
      s.inSolid = lastInSolid; s.wallFrac = lastWallFrac;
    }
    lastDist = cs.dist;
    S.samples.push(s);
    S.mark = S.samples.length;
  };

  const runFor = async (secs) => {
    const t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) { await frame(); sample(); }
  };

  const place = async (x, y, z, yaw) => {
    syncP(); allUp();
    P.__test.teleport(_v.set(x, y, z));
    if (P.__test.setVel) P.__test.setVel(_v.set(0, 0, 0));
    if (P.__test.setFacing) P.__test.setFacing(yaw);
    if (typeof cam.snapToPlayer === 'function') cam.snapToPlayer();
    cam.__test.setYaw(yaw);
    settleUntil = performance.now() + 800;
    lastDist = cam.dist;
    await runFor(0.85);
  };

  (async () => {
    try {
      for (const seg of route) {
        segName = S.seg = seg.name;
        if (seg.at) await place(seg.at[0], seg.at[1], seg.at[2], seg.at[3]);
        for (const act of (seg.acts || [])) {
          const kind = act[0];
          if (kind === 'wait') { allUp(); await runFor(act[1]); continue; }
          if (kind === 'hold') {
            const codes = String(act[1]).split('+');
            codes.forEach(down);
            await runFor(act[2]);
            codes.forEach(up);
            continue;
          }
          if (kind === 'tap') {
            const n = act[2] | 0, gap = act[3] || 0.15;
            for (let i = 0; i < n; i++) {
              down(act[1]); await runFor(0.05); up(act[1]); await runFor(gap);
            }
            continue;
          }
          if (kind === 'combo') {
            const codes = act[1];
            down(codes[0]); await runFor(0.05); down(codes[1]);
            await runFor(act[2]);
            codes.forEach(up);
            continue;
          }
        }
        allUp();
        await runFor(0.4);
      }
    } catch (e) {
      S.error = String(e && e.stack || e);
    } finally {
      allUp();
      S.done = true;
    }
  })();

  return {ok: true, canRay, canQuery, segs: route.length};
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
    import math
    live = [s for s in samples if not s["settling"] and s["dt"] <= 0.06]
    if not live:
        return {"error": "no live samples"}

    def seg_of(name):
        return [s for s in live if s["seg"] == name]

    # POP analysis, made framerate-independent — which matters, because this box
    # runs the probe at whatever fps it can spare (see `medianDt_ms`).
    #   * a PULL-IN is applied whole in one frame by design
    #     (`_updateDistance`: "pull in: instant"), so its magnitude is the same
    #     at 8 fps as at 60 and is directly comparable to the 1.5 m budget;
    #   * a PUSH-OUT is rate-limited (COLLIDE_OUT_MAX_RATE 12 m/s) and eased
    #     (lambda 5), so its per-FRAME size scales with dt and is meaningless
    #     here — it is judged as a RATE instead.
    pulls = sorted(
        ({"seg": s["seg"], "t": s["t"], "dDist": s["dDist"], "dist": s["dist"],
          "state": s["state"], "mode": s["mode"], "dt": s["dt"]}
         for s in live if s["dDist"] < -1.5),
        key=lambda r: r["dDist"])
    pushRates = [abs(s["dDist"]) / s["dt"] for s in live if s["dDist"] > 0 and s["dt"] > 0]
    pops = pulls

    ndc_out = [s for s in live if abs(s["heroNdcX"]) > 0.4 or abs(s["heroNdcY"]) > 0.4]
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
                       "maxYawDelta": 0.0, "frames": 0, "dur": 0.0}
            cur["maxYawDelta"] = max(cur["maxYawDelta"], abs(wrap_pi(s["yaw"] - cur["y0"])))
            cur["frames"] += 1
            cur["dur"] += s["dt"]
        else:
            if cur:
                committed.append(cur)
                cur = None
    if cur:
        committed.append(cur)
    for c in committed:
        c["maxYawDelta"] = round(c["maxYawDelta"], 4)
        c["dur"] = round(c["dur"], 3)
        c.pop("y0", None)

    # airborne arcs: was the hero readable, and where did the frame sit
    arcs, arc = [], None
    for s in live:
        if not s["grounded"] and s["state"] not in ("swim", "swimIdle", "climb", "dead"):
            if arc is None:
                arc = {"seg": s["seg"], "state": s["state"], "dur": 0.0, "n": 0,
                       "maxNdcY": 0.0, "maxNdcX": 0.0, "minPitch": 9, "maxPitch": -9,
                       "occFrames": 0}
            arc["dur"] += s["dt"]
            arc["n"] += 1
            arc["maxNdcY"] = max(arc["maxNdcY"], abs(s["heroNdcY"]))
            arc["maxNdcX"] = max(arc["maxNdcX"], abs(s["heroNdcX"]))
            arc["minPitch"] = min(arc["minPitch"], s["pitch"])
            arc["maxPitch"] = max(arc["maxPitch"], s["pitch"])
            if s["occluded"]:
                arc["occFrames"] += 1
        else:
            if arc and arc["dur"] >= 0.25:
                arcs.append(arc)
            arc = None
    if arc and arc["dur"] >= 0.25:
        arcs.append(arc)
    for a in arcs:
        for k in ("dur", "maxNdcY", "maxNdcX", "minPitch", "maxPitch"):
            a[k] = round(a[k], 3)

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
        ss = seg_of(name)
        per_seg[name] = {
            "frames": len(ss),
            "indoor": name in indoor_segs,
            "dist": stat([s["dist"] for s in ss]),
            "pitch": stat([s["pitch"] for s in ss]),
            "ndcX": stat([abs(s["heroNdcX"]) for s in ss]),
            "ndcY": stat([abs(s["heroNdcY"]) for s in ss]),
            "pullIns>1.5m": sum(1 for s in ss if s["dDist"] < -1.5),
            "pullIns>0.6m": sum(1 for s in ss if s["dDist"] < -0.6),
            "inSolidFrames": sum(1 for s in ss if s["inSolid"] is True),
            "wallFillFrames": sum(1 for s in ss if s["wallFrac"] is not None and s["wallFrac"] >= 0.78),
            "maxSpeed": round(max((s["speed"] for s in ss), default=0), 2),
        }

    return {
        "frames": len(live), "framesRaw": len(samples),
        "medianDt_ms": round(1000 * sorted(s["dt"] for s in live)[len(live) // 2], 2),
        "pullIns>1.5m": len(pulls), "worstPullIns": pulls[:12],
        "pullIns>0.6m": sum(1 for s in live if s["dDist"] < -0.6),
        "pushOutRate_m_per_s": {"max": round(max(pushRates), 2) if pushRates else None,
                                "cap": 12.0,
                                "overCap": sum(1 for r in pushRates if r > 12.5)},
        "pops>1.5m": len(pops),
        "distStat": stat([s["dist"] for s in live]),
        "ndcXStat": stat([abs(s["heroNdcX"]) for s in live]),
        "ndcYStat": stat([abs(s["heroNdcY"]) for s in live]),
        "framesOutsideCentral40pct": len(ndc_out),
        "worstNdc": sorted(({"seg": s["seg"], "x": s["heroNdcX"], "y": s["heroNdcY"],
                             "state": s["state"], "dist": s["dist"]} for s in ndc_out),
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
    """One pass of a course route.

    `grab_shots=False` is the MEASUREMENT pass: a headless screenshot of a WebGL
    canvas costs ~150 ms of compositor time and starves requestAnimationFrame
    (measured: 4.8 fps with shots on, vs the game's real headless ~45), which
    would turn every timing number into an artefact of the probe. So the route is
    driven twice — once clean for the numbers, once with the camera roll for the
    pictures — and only the clean pass feeds `analyse`.
    """
    os.makedirs(SHOTS, exist_ok=True)
    route = ROUTES[course]

    if course != "keep":
        page.evaluate("(id) => CRESTBOUND.game.__dev.goto(id)", course)
        t0 = time.time()
        while time.time() - t0 < 30:
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

    shots, n = [], 0
    t0 = time.time()
    poll_ms = int(shot_every * 1000) if grab_shots else 1000
    while time.time() - t0 < 180:
        st = page.evaluate("({done: __CAMSHOTS.done, err: __CAMSHOTS.error, "
                           "n: __CAMSHOTS.samples.length, seg: __CAMSHOTS.seg})")
        if grab_shots and st["n"] > 0:
            path = os.path.join(SHOTS, "%s_%03d.png" % (course, n))
            try:
                page.screenshot(path=path, timeout=60000)
                shots.append({"file": os.path.basename(path), "seg": st["seg"],
                              "sampleIdx": st["n"] - 1})
            except Exception as e:
                shots.append({"file": None, "seg": st["seg"], "error": str(e)[:90]})
            n += 1
        if st["done"]:
            if st["err"]:
                print("  driver error: %s" % st["err"], file=sys.stderr)
            break
        page.wait_for_timeout(poll_ms)

    samples = page.evaluate("__CAMSHOTS.samples")
    rep = analyse(samples)
    rep["course"] = course
    rep["shots"] = shots
    rep["shotPass"] = grab_shots
    rep["driverError"] = page.evaluate("__CAMSHOTS.error")
    if verbose:
        print("  %-10s frames=%d shots=%d pullIns>1.5m=%d ndcMax=(%.2f,%.2f) "
              "inSolid=%d wallFill=%d worstOcc=%.2fs"
              % (course, rep["frames"], len(shots), rep["pullIns>1.5m"],
                 rep["ndcXStat"]["max"], rep["ndcYStat"]["max"],
                 rep["lensInsideSolidFrames"], rep["wallFillFrames"],
                 rep["worstOcclusionRun_s"]))
    return rep, samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--course", default=None, help="keep | verdant-1 (default: both)")
    ap.add_argument("--shot-every", type=float, default=0.5)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--samples", action="store_true", help="write the raw per-frame stream too")
    ap.add_argument("--no-shots", action="store_true", help="measurement pass only")
    args = ap.parse_args()

    courses = [args.course] if args.course else ["keep", "verdant-1"]
    for c in courses:
        if c not in ROUTES:
            print("unknown course %r (have %s)" % (c, ", ".join(ROUTES)), file=sys.stderr)
            return 2

    os.makedirs(SHOTS, exist_ok=True)
    out = {"url": args.url, "viewport": [args.width, args.height],
           "headless": not args.headed, "courses": {}}

    with sync_playwright() as p:
        # Chrome launch and the page itself both fail under contention on this box
        # (HARNESS_NOTES: run browser gates ONE at a time; measured 22..60 live
        # chrome.exe while other lanes ran). Back off rather than report a
        # launch failure as a camera finding.
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

        # 1. the global appears (boot.js) --------------------------------------
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

        # 2. leave the title ---------------------------------------------------
        t0 = time.time()
        while time.time() - t0 < 150:
            st = page.evaluate(STATE_JS)
            if st in ("keep", "playing"):
                break
            page.evaluate(CLICK_JS)
            page.wait_for_timeout(600)
        if page.evaluate(STATE_JS) not in ("keep", "playing"):
            raise RuntimeError("never left the title (state=%s)" % page.evaluate(STATE_JS))

        # 3. player + camera test surfaces exist -------------------------------
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
            print("  [%s] measurement pass (no screenshots)" % c)
            rep, samples = run_course(page, c, args.shot_every, grab_shots=False)
            if not args.no_shots:
                print("  [%s] screenshot pass" % c)
                rep2, _ = run_course(page, c, args.shot_every, grab_shots=True, verbose=False)
                rep["shots"] = rep2["shots"]
                rep["shotPassFrames"] = rep2["frames"]
            out["courses"][c] = rep
            if args.samples:
                with open(os.path.join(SHOTS, "%s_samples.json" % c), "w", encoding="utf-8") as f:
                    json.dump(samples, f)
        out["consoleErrors"] = errs
        browser.close()

    dest = os.path.join(SHOTS, "camshots.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("wrote %s" % dest)
    if errs:
        print("console/page errors: %d" % len(errs), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
