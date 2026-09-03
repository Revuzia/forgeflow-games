#!/usr/bin/env python
"""CRESTBOUND camera check — proves the third-person camera contract (CONTRACT §12)
at the layer the player sees, in a real Chrome, through REAL input events.

Checks (each prints PASS/FAIL; exit 1 on any FAIL):

  wall        hero against a wall, camera behind it pointing INTO the wall ->
              the lens stays on the near side of the face and its HORIZONTAL
              reach is <= the wall distance (whisker raycast pull-in, no
              clipping), while the framing distance is still >= TUNE.cam.minDist
              and the hero is not faded out to buy it
  shaft       hero inside a 3.30 m kick shaft (verdant-1 ROUTE B's geometry) with
              the camera pointing at the wall he is pressed against, jumping ->
              EVERY frame: camera distance >= TUNE.cam.minDist, the hero never
              inside the near plane, the hero never faded out, the lens never
              inside a shaft wall. This is the row that fails when the collision
              pull-in answers a shaft by burying the lens in the hero: measured
              before the shaft tier existed (_harness/_r3_shaftcam.py on the real
              course), camera-to-head min 0.246 m, cam.dist floored at 0.120,
              73/200 ladder frames closer than minDist and 20 inside the near
              plane -- with occlusion reading 0 %, because a lens inside the hero
              is not "occluded" by anything.
  framing     hero runs a 12 m line -> hero centre stays inside the central 40 %
              of the frame (|ndc| <= 0.4) the whole way (focus lag, hero leads)
  longjump    a long jump via real KeyboardEvents (crouch + jump at speed) with the
              camera 0.5 rad off the run line -> yaw changes <= 0.02 rad during it
              (auto-yaw FROZEN on committed moves)
  dive        the same, for the dive key: yaw changes <= 0.02 rad across
              dive + belly slide + slideRecover
  occlusion   hero runs under a 0.8 m overhang the camera must duck below ->
              the longest CONTINUOUS stretch with world geometry between the
              lens and the hero's chest is <= 0.3 s (CONTRACT gate wording)
  recenter    yaw 1.2 rad off the hero's facing, press the recenter key ->
              yaw converges (< 0.02 rad) within TUNE.cam.recenterTime + 0.1 s
  peek        hold the peek key -> camera.fov == TUNE.cam.peekFov (+/- 0.1)

    python camcheck.py                      # headed Chrome (rAF runs for real)
    python camcheck.py --headless           # real Chrome headless on the GPU
    python camcheck.py --course verdant-1   # __dev.goto(course) first

Pattern: bootcheck.py (same FLAGS, wait for globalThis.CRESTBOUND). The test slab,
wall and occlusion roof are synthetic Colliders added to the live course broadphase
far above the course (feelcheck's proven y=400 slab), then removed. A hidden/occluded browser
pane pauses rAF and makes a healthy game look broken — headed is the default.
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
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html?dev=1"

FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader",
]

CHECK_NAMES = ["wall", "shaft", "framing", "longjump", "dive", "occlusion", "recenter", "peek"]


def launch_headless(p):
    """Headless, but on the REAL GPU (same rule as feelcheck.py / loopcheck.py).

    Every row in this gate is a REAL-TIME measurement sampled once per
    requestAnimationFrame: the framing run needs 12 m of travel, the freeze runs
    need a run-up past `longJump.minSpeed`, and the fov/recenter easings need
    tens of frames to converge. Under the bundled Chromium + SwiftShader this
    page presents ~0.4 frames/second, so a 5 s window yields TWO frames, the
    hero has had 1/20 s of simulation, and the gate reports the software
    rasterizer instead of the camera. Real Chrome headless drives ANGLE/D3D11 on
    this box. SwiftShader stays as the fallback for a machine with no usable GPU,
    and says so.
    """
    try:
        return p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    except Exception as e:
        print("headless: no hardware Chrome (%s) -> SwiftShader; the timing rows "
              "will measure the software rasterizer, not the game" % str(e)[:120],
              file=sys.stderr)
        return p.chromium.launch(headless=True, args=HEADLESS_FLAGS)

# Generic title-screen leaver: any visible button whose text says PLAY / START /
# NEW / CONTINUE / BEGIN, else Enter. Loops until game.state leaves title/loading.
CLICK_JS = r"""() => {
  // CONTINUE first: NEW GAME opens an ERASE-confirm page when a save exists,
  // and the confirm's own buttons are what would then have to be answered
  // (same ordering camshots.py already uses -- this file's order was a bug).
  const words = ['CONTINUE', 'KEEP MY PROGRESS', 'NEW GAME', 'NEW RUN', 'PLAY', 'START', 'BEGIN', 'ENTER'];
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

# One self-contained in-page routine. Everything the player would do is driven by
# real KeyboardEvents; only placement uses the __test surface (contract §11/§12).
MEASURE_JS = r"""
async () => {
  const A = globalThis.CRESTBOUND;
  if (!A || !A.game) return {error:'no CRESTBOUND.game'};
  const G = A.game, THREE = A.THREE;
  if (!THREE) return {error:'CRESTBOUND.THREE missing'};
  const cam = G.cam || G.camera;
  if (!cam || !cam.__test) return {error:'game.cam (FollowCamera) with __test missing'};
  const tcam = A.engine && A.engine.camera;
  if (!tcam) return {error:'engine.camera missing'};

  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const wait = async (ms) => { const t0 = performance.now();
                               while (performance.now() - t0 < ms) await frame(); };
  const target = () => document.querySelector('canvas') || document;
  const key = (type, code) => {
    const k = code === 'Space' ? ' ' : (code.startsWith('Key') ? code.slice(3).toLowerCase() : code);
    target().dispatchEvent(new KeyboardEvent(type, {code, key: k, bubbles:true, cancelable:true}));
  };
  const down = c => key('keydown', c), up = c => key('keyup', c);
  const ALL = ['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','KeyC','KeyF','KeyZ','KeyG','KeyQ','KeyE'];
  const allUp = () => ALL.forEach(up);
  const wrap = a => { let x = (a + Math.PI) % (Math.PI * 2); if (x < 0) x += Math.PI * 2; return x - Math.PI; };
  const dAng = (a, b) => wrap(b - a);
  const spd = () => Math.hypot(P.vel.x, P.vel.z);
  const cs = () => cam.__test.state();

  const out = {checks:{}, notes:{}};
  const pass = (n, ok, detail) => { out.checks[n] = {ok: !!ok, detail}; };

  // ---- tuning ---------------------------------------------------------------
  let TUNE;
  try { TUNE = (await import(new URL('runtime/core/tuning.js', location.href).href)).TUNE; }
  catch (e) { return {error:'could not import tuning.js: ' + e}; }
  const C = TUNE.cam;
  out.notes.tune = C;

  // ---- game state ----------------------------------------------------------
  if (G.state !== 'playing' && G.state !== 'keep')
    return Object.assign({error:'unexpected game state: ' + G.state}, out);
  if (G.input && G.input.suspended) return Object.assign({error:'input.suspended is true (menu open?)'}, out);

  // ---- synthetic slab + wall far above the course ----------------------------
  let Collider;
  try { Collider = (await import(new URL('runtime/world/collider.js', location.href).href)).Collider; }
  catch (e) { return Object.assign({error:'could not import collider.js: ' + e}, out); }
  const bps = [];
  const bpCourse = G.course && G.course.broadphase;
  const bpCam = cam.world && (cam.world.broadphase || (cam.world.course && cam.world.course.broadphase));
  if (bpCourse) bps.push(bpCourse);
  if (bpCam && bps.indexOf(bpCam) < 0) bps.push(bpCam);
  if (!bps.length) return Object.assign({error:'no broadphase on game.course / cam.world'}, out);
  if (typeof bps[0].raycast !== 'function') out.notes.noRaycast = true;

  const TEST = {x: 0, y: 400, z: 600};
  const HX = 60, HY = 1, HZ = 14;
  const WALL_X = 6.0, WALL_HALF = 0.5;
  const WALL_FACE = WALL_X - WALL_HALF;                  // the face the hero stands against (x = 5.5)
  // Occlusion rig: a slab roof over its own z-lane (10 m off the main lane, so the
  // wall / framing / jump runs never touch it). Underside sits 2.2 m over the floor:
  // the hero (1.5 m) walks under freely, but the camera's un-collided pose at
  // pitch 0.22 would be ~3.03 m up — i.e. ABOVE the roof, hero occluded — unless the
  // whisker raycast ducks it under. That is exactly what this measures.
  const OCC_Z = TEST.z - 10, OCC_X = -17, OCC_HX = 5, OCC_HZ = 4;
  const OCC_UNDER = TEST.y + 2.2, OCC_HY = 0.4;
  const slab = new Collider({center: new THREE.Vector3(TEST.x, TEST.y - HY, TEST.z),
                             half: new THREE.Vector3(HX, HY, HZ), surface:'stone', userData:'camcheck-slab'});
  const wall = new Collider({center: new THREE.Vector3(WALL_X, TEST.y + 3, TEST.z),
                             half: new THREE.Vector3(WALL_HALF, 4, 10), surface:'stone', userData:'camcheck-wall'});
  const roof = new Collider({center: new THREE.Vector3(OCC_X, OCC_UNDER + OCC_HY, OCC_Z),
                             half: new THREE.Vector3(OCC_HX, OCC_HY, OCC_HZ), surface:'stone', userData:'camcheck-roof'});
  // KICK SHAFT: verdant-1 ROUTE B's own dimensions (course def line 701 -- "the
  // west tower is hollow, 3.30 m clear and 7.60 m tall"), four walls, open to
  // the sky, standing on the slab well clear of the other rigs.
  const SH_X = -45, SH_Z = TEST.z, SH_HALF = 1.65, SH_T = 0.5, SH_H = 4.0;
  const SH_CY = TEST.y + SH_H;
  const shWalls = [
    new Collider({center: new THREE.Vector3(SH_X + SH_HALF + SH_T, SH_CY, SH_Z),
                  half: new THREE.Vector3(SH_T, SH_H, SH_HALF + SH_T * 2), surface:'stone', userData:'camcheck-shaft+x'}),
    new Collider({center: new THREE.Vector3(SH_X - SH_HALF - SH_T, SH_CY, SH_Z),
                  half: new THREE.Vector3(SH_T, SH_H, SH_HALF + SH_T * 2), surface:'stone', userData:'camcheck-shaft-x'}),
    new Collider({center: new THREE.Vector3(SH_X, SH_CY, SH_Z + SH_HALF + SH_T),
                  half: new THREE.Vector3(SH_HALF + SH_T * 2, SH_H, SH_T), surface:'stone', userData:'camcheck-shaft+z'}),
    new Collider({center: new THREE.Vector3(SH_X, SH_CY, SH_Z - SH_HALF - SH_T),
                  half: new THREE.Vector3(SH_HALF + SH_T * 2, SH_H, SH_T), surface:'stone', userData:'camcheck-shaft-z'}),
  ];
  const RIG = [slab, wall, roof].concat(shWalls);
  for (const c of RIG) { if (typeof c.update === 'function') c.update(); }
  for (const bp of bps) for (const c of RIG) { bp.add(c); if (typeof bp.refresh === 'function') bp.refresh(c); }
  // visible stand-ins so a screenshot shows what was measured
  const meshes = [];
  if (A.engine && A.engine.scene) {
    const mk = (cx, cy, cz, hx, hy, hz, col) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx*2, hy*2, hz*2), new THREE.MeshStandardMaterial({color: col}));
      m.position.set(cx, cy, cz); A.engine.scene.add(m); meshes.push(m); return m; };
    mk(TEST.x, TEST.y - HY, TEST.z, HX, HY, HZ, 0x2e3a4a);
    mk(WALL_X, TEST.y + 3, TEST.z, WALL_HALF, 4, 10, 0x7a4a3a);
    mk(OCC_X, OCC_UNDER + OCC_HY, OCC_Z, OCC_HX, OCC_HY, OCC_HZ, 0x3a5a4a);
    for (const c of shWalls) mk(c.center.x, c.center.y, c.center.z, c.half.x, c.half.y, c.half.z, 0x4a4a5a);
  }
  const cleanup = () => {
    allUp();
    for (const bp of bps) for (const c of RIG) { try { bp.remove(c); } catch (e) {} }
    for (const m of meshes) { try { A.engine.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } catch (e) {} }
  };

  const origin = P.pos ? [P.pos.x, P.pos.y, P.pos.z] : null;
  const _v = new THREE.Vector3();
  // yaw 0 faces -Z; yaw = -PI/2 faces +X; yaw = +PI/2 faces -X (headingFromYaw)
  const FACE_PLUS_X = -Math.PI / 2, FACE_MINUS_X = Math.PI / 2;
  const place = async (x, y, z, yaw) => {
    syncP();
    allUp();
    P.__test.teleport(_v.set(x, y, z));
    if (P.__test.setVel) P.__test.setVel(_v.set(0, 0, 0));
    if (P.__test.setFacing) P.__test.setFacing(yaw);
    if (typeof cam.snapToPlayer === 'function') cam.snapToPlayer();
    cam.__test.setYaw(yaw);
    cam.__test.setPitch(C.defaultPitch);
    await wait(700);
    if (P.dead) throw new Error('hero died on the test slab (killY/bounds?) at ' + JSON.stringify([x,y,z]));
  };

  try {
    // ================= 1. WALL: camera never clips ==========================
    {
      const hx = WALL_FACE - (TUNE.radius || 0.38) - 0.05;        // pressed against the face
      await place(hx, TEST.y, TEST.z, FACE_MINUS_X);              // hero faces -X, wall behind at +X
      cam.__test.setYaw(FACE_MINUS_X);                            // camera behind the hero -> into the wall
      cam.__test.setPitch(0.15);
      await wait(1000);
      const s = cs();
      const camX = s.pos[0];
      const wallDist = WALL_FACE - s.focus[0];
      // CONTRACT §12: "pull in to hit - collideRadius", and never through it.
      // WHAT THIS ROW ASSERTS, and what it used to. The old test was
      // `dist <= wallDist`, which reads as "the lens did not go past the wall"
      // only while the camera is HORIZONTAL: `dist` is the full 3-D radius, and
      // what may not cross the face is its HORIZONTAL component. The two are the
      // same number for a level camera and different ones the moment the solver
      // answers this geometry by tilting (camera.js PITCH_STEPS), which is what
      // it now does here -- the lens rides up over the hero at 2.55 m instead of
      // jamming into his back at 0.43 m, with its horizontal offset still inside
      // the wall. So the no-clipping claim is stated directly (the lens stays on
      // the near side of the face, and its horizontal reach is at most the wall
      // distance), and the row is STRENGTHENED with the two things the old
      // behaviour could not deliver at this station: the framing distance is at
      // least `minDist`, and the hero is not faded out to buy it.
      const NEAR_FLOOR = 0.05;                                   // engine DEFAULT_NEAR
      const horiz = Math.hypot(s.pos[0] - s.focus[0], s.pos[2] - s.focus[2]);
      const ok = camX <= WALL_FACE - 0.05 && horiz <= wallDist + 1e-3 &&
                 s.dist >= NEAR_FLOOR && s.dist >= C.minDist - 1e-3 && (s.heroFade || 0) < 1e-3;
      pass('wall', ok, {camX: +camX.toFixed(3), wallFace: WALL_FACE, dist: +s.dist.toFixed(3),
                        horizReach: +horiz.toFixed(3), wallDist: +wallDist.toFixed(3),
                        nearFloor: NEAR_FLOOR, minDist: C.minDist, heroFade: +(s.heroFade || 0).toFixed(3),
                        pitchSlide: +s.pitchSlide.toFixed(3),
                        distColl: +s.distColl.toFixed(3), raycast: !out.notes.noRaycast});
    }

    // ================= 1b. SHAFT: a chimney is not a wall ===================
    // The wall row above is the terminal case where NO pose frames the hero and
    // the contract asks for a tight pull-in. A shaft is not that case: it is
    // blocked at every YAW but wide open along its own axis, so there is always
    // a legal pose and the solver has to find it (camera.js PITCH_STEPS). The
    // hero stands pressed against one wall with the camera pointing at that same
    // wall -- the configuration measured on verdant-1's ROUTE B -- and then
    // jumps, because the ladder that produced the defect is a moving hero.
    {
      const shz = SH_Z + SH_HALF - (TUNE.radius || 0.38) - 0.05;   // back 0.43 m off the +Z wall
      await place(SH_X, TEST.y, shz, 0);                           // yaw 0 faces -Z: camera at +Z, into the wall
      cam.__test.setYaw(0);
      cam.__test.setPitch(C.defaultPitch);
      await wait(700);
      const NEAR_FLOOR = 0.05;
      let minDist = Infinity, minHead = Infinity, maxFade = 0, nearFrames = 0, inWall = 0, frames = 0;
      let occRun = 0, occWorst = 0, tPrev = performance.now();
      down('Space'); await frame(); await frame(); up('Space');
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) {
        await frame();
        syncP();
        const s = cs();
        const rp = P.renderPos || P.pos;
        const hx = rp.x, hy = rp.y + (TUNE.height || 1.5) * 0.8, hz = rp.z;
        const hd = Math.hypot(s.pos[0] - hx, s.pos[1] - hy, s.pos[2] - hz);
        minDist = Math.min(minDist, s.dist);
        minHead = Math.min(minHead, hd);
        maxFade = Math.max(maxFade, s.heroFade || 0);
        if (hd < tcam.near + 0.35) nearFrames++;
        // the lens must stay inside the shaft's clear interior, never in a wall
        if (Math.abs(s.pos[0] - SH_X) > SH_HALF + 1e-3 || Math.abs(s.pos[2] - SH_Z) > SH_HALF + 1e-3) {
          if (s.pos[1] < TEST.y + SH_H * 2) inWall++;
        }
        // continuous occlusion, in seconds, same rule as the occlusion row
        const now = performance.now(), dtS = (now - tPrev) / 1000; tPrev = now;
        let blocked = false;
        if (bps[0] && typeof bps[0].raycast === 'function' && hd > 0.5) {
          _v.set(hx - s.pos[0], hy - s.pos[1], hz - s.pos[2]).normalize();
          const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
          blocked = !!bps[0].raycast({x: s.pos[0], y: s.pos[1], z: s.pos[2]}, _v, hd - 0.45, hit);
        }
        occRun = blocked ? occRun + dtS : 0;
        occWorst = Math.max(occWorst, occRun);
        frames++;
      }
      allUp();
      const ok = frames > 40 && minDist >= C.minDist - 1e-3 && nearFrames === 0 &&
                 inWall === 0 && maxFade < 1e-3 && occWorst <= 0.3;
      pass('shaft', ok, {frames, minDist: +minDist.toFixed(3), minDistBudget: C.minDist,
                         minHeadDist: +minHead.toFixed(3), nearFrames, lensInWallFrames: inWall,
                         maxHeroFade: +maxFade.toFixed(3), worstOcclusion_s: +occWorst.toFixed(3),
                         shaftClear_m: +(SH_HALF * 2).toFixed(2), pitchSlide: +cs().pitchSlide.toFixed(3)});
      await wait(400);
    }

    // ================= 2. FRAMING: hero stays in the central 40 % ==========
    {
      await place(-30, TEST.y, TEST.z, FACE_PLUS_X);
      await wait(400);
      const x0 = P.pos.x;
      let maxX = 0, maxY = 0, travelled = 0, frames = 0, t0 = performance.now();
      down('KeyW');
      while (travelled < 12 && performance.now() - t0 < 5000) {
        await frame();
        syncP();
        const rp = P.renderPos || P.pos;
        _v.set(rp.x, rp.y + (TUNE.height || 1.5) * 0.5, rp.z).project(tcam);
        maxX = Math.max(maxX, Math.abs(_v.x)); maxY = Math.max(maxY, Math.abs(_v.y));
        travelled = P.pos.x - x0; frames++;
      }
      up('KeyW');
      const ok = travelled >= 12 && maxX <= 0.4 && maxY <= 0.4;
      pass('framing', ok, {travelled: +travelled.toFixed(2), maxNdcX: +maxX.toFixed(3), maxNdcY: +maxY.toFixed(3),
                           frames, limit: 0.4, peakSpeed: +spd().toFixed(2)});
      await wait(500);
    }

    // ============ 3+4. COMMITTED MOVES: auto-yaw FROZEN =====================
    // Shared driver. Run up to speed, then shove the camera 0.5 rad off the run
    // line: with auto-yaw live that error would be erased in ~0.4 s at
    // TUNE.cam.autoYaw (1.3 rad/s), so ANY drift here proves the freeze is gone.
    // Fire the move, then watch cam.yaw across the whole committed window. The
    // 0.02 rad budget is ~1.1 deg -- visually zero. A one-frame gap between a
    // move's sub-states (dive -> slide) does not end the window: the window ends
    // 0.15 s after the LAST frame whose state was one of `states`.
    const freezeRun = async (name, needSpeed, fire, release, states, minDur) => {
      await place(-30, TEST.y, TEST.z, FACE_PLUS_X);
      await wait(300);
      down('KeyW');
      let t0 = performance.now();
      while (spd() < needSpeed && performance.now() - t0 < 1500) await frame();
      const speedAtMove = spd();
      cam.__test.setYaw(FACE_PLUS_X + 0.5);
      await fire();
      const seen = [];
      t0 = performance.now();
      while (states.indexOf(P.state) < 0 && performance.now() - t0 < 600) {
        await frame(); syncP();
        if (seen[seen.length - 1] !== P.state) seen.push(P.state);
      }
      await release();
      let ok = false, maxDelta = null, dur = 0;
      if (states.indexOf(P.state) >= 0) {
        const y0 = cam.yaw; maxDelta = 0;
        const tj = performance.now();
        let lastIn = tj;
        while (performance.now() - lastIn < 150 && performance.now() - tj < 2500) {
          await frame(); syncP();
          if (states.indexOf(P.state) >= 0) {
            lastIn = performance.now();
            maxDelta = Math.max(maxDelta, Math.abs(dAng(y0, cam.yaw)));
            if (seen[seen.length - 1] !== P.state) seen.push(P.state);
          }
        }
        dur = (lastIn - tj) / 1000;
        ok = maxDelta <= 0.02 && dur >= minDur;
      }
      up('KeyW'); allUp();
      pass(name, ok, {triggered: maxDelta !== null, maxYawDelta: maxDelta === null ? null : +maxDelta.toFixed(4),
                      committed_s: +dur.toFixed(3), minCommitted_s: minDur, yawBudget: 0.02,
                      speedAtMove: +speedAtMove.toFixed(2), statesSeen: seen, finalState: P.state});
      await wait(900);
    };

    // ---- 3. long jump: crouch + jump at FULL RUN speed ---------------------
    // The run-up target is the point of this row, and it used to be wrong.
    // `python _harness/_ljprobe.py` (this session, real KeyboardEvents, a
    // per-frame dump of input + controller): ONE frame of ControlLeft moves the
    // hero from `run` at 8.05 m/s to `crouchwalk` at 5.38 m/s -- a 2.67 m/s
    // cost, and crouch MUST precede jump by a frame for `_crouchHeld` to be
    // latched. With the old target of `minSpeed + 1.0` (6.5 m/s) the hero was
    // therefore at ~3.8 m/s when Space landed, under TUNE.longJump.minSpeed
    // (5.50), so `_tryJump` took the plain-jump branch: the row reported
    // {"triggered": false, "statesSeen": ["jump1","fall"]} on every run and
    // asserted NOTHING about the yaw freeze it exists to prove. The cost is
    // paid in wall-clock time, so the margin has to cover a slow frame too:
    // running up to full speed first is what a player does before a long jump,
    // and it leaves ~2.8 m/s of headroom over minSpeed.
    // (Pressing both keys in the SAME frame was tried and is not the answer --
    // the crouch press latch survives into the next 1/240 substep, where the
    // hero is already airborne, and `_doPound` cancels the long jump: measured
    // statesSeen ["poundHang","poundLand","crouchwalk"].)
    await freezeRun(
      'longjump', Math.max(TUNE.speedRun - 0.5, TUNE.longJump.minSpeed + 3.0),
      async () => { down('ControlLeft'); await frame(); down('Space'); },
      async () => { await frame(); up('Space'); up('ControlLeft'); },
      ['longjump'], 0.15);

    // ---- 4. dive: dive key at speed, held through the belly slide ----------
    await freezeRun(
      'dive', TUNE.dive.minSpeed + 1.0,
      async () => { down('KeyF'); },
      async () => { await frame(); up('KeyF'); },
      ['dive', 'slide', 'slideRecover'], 0.12);

    // ============ 5. OCCLUSION: the hero stays visible under an overhang ====
    // The roof's underside is 2.2 m over the floor. The camera's UN-collided pose
    // at pitch 0.22 sits ~3.03 m up -- i.e. ABOVE the roof, hero hidden -- so the
    // only way to pass is for the whisker raycast to duck the lens underneath.
    // Every frame we cast from the REAL lens to the hero's chest through the same
    // broadphase the game uses. CONTRACT budget: 0.3 s CONTINUOUS occlusion.
    {
      await place(-32, TEST.y, OCC_Z, FACE_PLUS_X);
      await wait(600);
      const bpRay = bps.filter((b) => typeof b.raycast === 'function')[0] || null;
      const oray = {t: 0, normal: new THREE.Vector3(), collider: null};
      const camPos = new THREE.Vector3(), chest = new THREE.Vector3(), dirv = new THREE.Vector3();
      let worst = 0, run = 0, occFrames = 0, frames = 0;
      let minD = 1e9, maxFade = 0;
      const x0 = P.pos.x;
      let last = performance.now();
      const t0 = last;
      down('KeyW');
      while (P.pos.x < -6 && performance.now() - t0 < 9000) {
        await frame(); syncP();
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        frames++;
        const rp = P.renderPos || P.pos;
        chest.set(rp.x, rp.y + (TUNE.height || 1.5) * 0.5, rp.z);
        camPos.copy(tcam.position);
        dirv.copy(chest).sub(camPos);
        const len = dirv.length();
        let occluded = false;
        if (bpRay && len > 0.6) {
          dirv.multiplyScalar(1 / len);
          occluded = !!bpRay.raycast(camPos, dirv, len - 0.35, oray);
        }
        if (occluded) { run += dt; occFrames++; if (run > worst) worst = run; }
        else run = 0;
        const s = cs();
        if (s.dist < minD) minD = s.dist;
        if (s.heroFade > maxFade) maxFade = s.heroFade;
      }
      up('KeyW');
      const travelled = P.pos.x - x0;
      const ok = travelled >= 20 && worst <= 0.3;
      pass('occlusion', ok, {worstRun_s: +worst.toFixed(3), limit_s: 0.3, occludedFrames: occFrames,
                             frames, travelled: +travelled.toFixed(2), minDist: +minD.toFixed(2),
                             roofUnderside: OCC_UNDER, floorY: TEST.y, maxHeroFade: +maxFade.toFixed(2),
                             rayed: !!bpRay});
      await wait(500);
    }

    // ================= 6. RECENTER: converge in recenterTime + 0.1 =========
    {
      await place(-10, TEST.y, TEST.z, FACE_PLUS_X);
      await wait(400);
      const F = P.facing;
      cam.__test.setYaw(F + 1.2);
      await frame(); await frame();
      const yawBefore = cam.yaw;
      const moveBefore = cam.yawForMovement;
      down('KeyZ'); await frame(); up('KeyZ');
      const t0 = performance.now();
      const moveAfterFirst = cam.yawForMovement;
      let converged = -1;
      while (performance.now() - t0 < 1500) {
        await frame();
        if (Math.abs(dAng(cam.yaw, P.facing)) < 0.02) { converged = (performance.now() - t0) / 1000; break; }
      }
      const limit = C.recenterTime + 0.1;
      const holdOk = Math.abs(dAng(moveAfterFirst, moveBefore)) < 0.02;   // movement yaw held on the first frame
      const ok = converged >= 0 && converged <= limit;
      pass('recenter', ok, {converged_s: converged < 0 ? null : +converged.toFixed(3), limit_s: +limit.toFixed(3),
                            yawBefore: +yawBefore.toFixed(3), facing: +F.toFixed(3), yawAfter: +cam.yaw.toFixed(3),
                            movementYawHeldFirstFrame: holdOk});
      await wait(400);
    }

    // ================= 7. PEEK: fov == peekFov ==============================
    {
      await place(-10, TEST.y, TEST.z, FACE_PLUS_X);
      down('KeyG');
      await wait(700);
      const s = cs();
      const fovErr = Math.abs(s.fov - C.peekFov);
      const camFovErr = Math.abs(tcam.fov - C.peekFov);
      const ok = fovErr <= 0.1 && camFovErr <= 0.1 && s.mode === 'peek';
      pass('peek', ok, {fov: +s.fov.toFixed(3), cameraFov: +tcam.fov.toFixed(3), peekFov: C.peekFov,
                        mode: s.mode, heroFade: s.heroFade});
      up('KeyG');
      await wait(500);
      const s2 = cs();
      out.notes.afterPeek = {mode: s2.mode, fov: +s2.fov.toFixed(2), dist: +s2.dist.toFixed(2)};
    }
  } catch (e) {
    out.error = String(e && e.stack || e);
  } finally {
    cleanup();
    try { if (origin) { P.__test.teleport(_v.set(origin[0], origin[1], origin[2]));
                        if (P.__test.setVel) P.__test.setVel(_v.set(0,0,0));
                        if (typeof cam.snapToPlayer === 'function') cam.snapToPlayer(); } } catch (e) {}
  }
  return out;
}
"""


def leave_title(pg, timeout=150):
    """Click PLAY (or press Enter) until game.state leaves title/loading.

    150 s, not 40: under Chrome contention this box has been observed to take
    over a minute to boot the course, and the 40 s budget was reporting
    'never left the title screen (state=keep)' -- i.e. it had ARRIVED, one poll
    after the deadline. camshots.py already waits 150 s for the same event.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("keep", "playing"):
            return True
        if st not in (None, "title", "loading", "card", "cinematic", False):
            # paused / dead / clear: nudge with Escape / Enter and keep trying
            pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--course", default=None, help="__dev.goto(<courseId>) before measuring")
    ap.add_argument("--wait", type=float, default=60.0)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "camcheck.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "camcheck.png"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    errors = []
    res = {}

    with sync_playwright() as p:
        if args.headless:
            br = launch_headless(p)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));"
        )
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            return 2

        # 1. wait for the global
        ready, deadline = False, time.time() + args.wait
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ready:
            print("CAM CHECK: globalThis.CRESTBOUND never appeared", file=sys.stderr)
            br.close()
            return 2

        # 2. leave the title
        if not leave_title(pg):
            print("CAM CHECK: never left the title screen (state=%s)"
                  % pg.evaluate(STATE_JS), file=sys.stderr)
            br.close()
            return 2

        # 3. optional course
        if args.course:
            try:
                pg.evaluate("async (id) => { const d = CRESTBOUND.game.__dev; if (!d) throw new Error('__dev missing (?dev=1)'); await d.goto(id); }",
                            args.course)
            except Exception as e:
                print("CAM CHECK: __dev.goto(%s) failed: %s" % (args.course, e), file=sys.stderr)
                br.close()
                return 2
            leave_title(pg, timeout=20)

        # 4. wait for player + camera test surfaces
        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                if pg.evaluate(READY_JS):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1200)

        # 5. measure
        try:
            res = pg.evaluate(MEASURE_JS)
        except Exception as e:
            res = {"error": str(e)}
        try:
            pg.screenshot(path=os.path.abspath(args.out))
        except Exception as e:
            errors.append("screenshot failed: %s" % e)
        try:
            jserr = pg.evaluate("window.__err || []")
        except Exception:
            jserr = []
        br.close()

    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"result": res, "pageErrors": errors, "windowErrors": jserr}, f, indent=2)
        except Exception:
            pass

    print("=" * 72)
    print("URL   : %s" % args.url)
    checks = res.get("checks", {}) if isinstance(res, dict) else {}
    fails = 0
    for name in CHECK_NAMES:
        c = checks.get(name)
        if not c:
            print("  %-9s FAIL  (no measurement)" % name)
            fails += 1
            continue
        ok = bool(c.get("ok"))
        fails += 0 if ok else 1
        print("  %-9s %s  %s" % (name, "PASS" if ok else "FAIL", json.dumps(c.get("detail"), sort_keys=True)))
    if res.get("error"):
        print("-" * 72)
        print("ROUTINE ERROR: %s" % str(res["error"])[:1200])
        fails += 1
    if res.get("notes"):
        n = dict(res["notes"])
        n.pop("tune", None)
        if n:
            print("notes: %s" % json.dumps(n, sort_keys=True))
    if errors or jserr:
        print("-" * 72)
        for e in errors[:10]:
            print("  !! %s" % str(e)[:300])
        for e in jserr[:10]:
            print("  !!! %s" % str(e)[:300])
    print("=" * 72)
    print("VERDICT: %s (%d failing)" % ("CAMERA OK" if fails == 0 else "CAMERA FAILS", fails))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
