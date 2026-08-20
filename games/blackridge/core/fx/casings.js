// core/fx/casings.js [A7] — instanced shell ejection. One InstancedMesh of
// 96 brass casings (architecture §3.14), per-weapon shell dimensions, arc
// right-back with tumble, floor bounce, then REST with 10–20 s persistence
// (VT §5 — permanence is D6 hard-cap insurance). CPU physics only while a
// casing is flying; resting shells cost nothing until expiry. Internal to
// fx.js.
//
// Floor height comes from the shooter's feet at eject time (exact on decks
// and stairs where colliders.groundY — terrain-only by contract — is not);
// fx.js resolves it per shot and passes it in.

import * as THREE from "three";

const N = 96;
const G = -20;        // matches the sim's gravity — shells feel world-real
const REST = 0.32;    // bounce restitution
const SHELL = {
  warden: { w: 0.011, l: 0.038 },
  vesper: { w: 0.009, l: 0.028 },
  corvus: { w: 0.013, l: 0.052 },
  pike: { w: 0.009, l: 0.024 },
};

// NEAR-LENS CULL (iter05 recapture). A casing is 11 x 38 mm and ejects 0.32 m
// in FRONT of the eye, so for its first ~0.2 s it sits inside the zone where
// the world camera's ~62 deg vFOV magnifies it past any chance of reading as
// brass: gl-side, 0.038 m at d = 0.38 m spans 0.10 rad = ~100 px of a 1080-px
// frame. MEASURED in the live iter05 S3 pose — fx.casings instance 2 at
// [-43.66, 1.64, 49.17], scale (0.011, 0.011, 0.038), d = 0.38 m from the
// camera at [-44, 1.62, 49], projecting to screen (1681, 532). That is the
// "floating yellow slab prop with nothing under it" in iter05 S3 and S1; it is
// NOT a props.js/layout.js placement bug (that diagnosis was handed off and is
// disproved by the instance transform above). Below this distance the box
// reads as a gold bar hanging in the sky, so it is not drawn; past it the
// tumble still sells the ejection.
// iter06 (D6): 0.75 m was too conservative to leave a usable window. The shell
// ejects 0.34 m from the eye and clears 0.75 m only after ~0.35 s, by which
// point its arc has carried it past the frame edge — measured across the whole
// iter90 C1 filmstrip, not one shell was on screen in any of the eleven panels
// while the counters reported 7-9 in flight throughout. At 0.52 m a 38 mm case
// subtends ~66 px, which is a shell casing tumbling past the lens rather than
// the "gold bar hanging in the sky" the cull was introduced to kill at 0.38 m.
// Held at 0.70 m (a 38 mm case = ~49 px) after 0.52 m put a 63-px shell against
// the open sky in S3 and reproduced that exact tell.
const NEAR_HIDE = 0.70;
const NEAR_HIDE_SQ = NEAR_HIDE * NEAR_HIDE;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function makeCasings(env) {
  // Unit CYLINDER on the Z axis (per-instance scale carries w, w, l).
  // Was a BoxGeometry: at the 40-70 px a near-lens shell actually occupies, a
  // 6-quad box shows exactly one flat unshaded face to the camera and reads as
  // a yellow slab — the "floating yellow prop" tell from iter05, which the
  // near-lens cull only hid rather than fixed. Eight sides give a specular
  // gradient across the case wall, which is the whole of what makes brass read
  // as brass. 16 triangles against 12; one instanced draw either way.
  const geo = new THREE.CylinderGeometry(0.5, 0.46, 1, 8, 1);
  geo.rotateX(Math.PI / 2); // long axis -> Z, matching the (w, w, l) scale
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb9903f, // brass
    metalness: 0.85,
    roughness: 0.34,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.name = "fx.casings";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, _m);
  env.root.add(mesh);

  // state: mode 0 = dead, 1 = flying, 2 = resting
  const mode = new Uint8Array(N);
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const eul = new Float32Array(N * 3);
  const angVel = new Float32Array(N * 3);
  const dims = new Float32Array(N * 2); // w, l
  const born = new Float32Array(N);
  const ttl = new Float32Array(N);
  const floor = new Float32Array(N);
  const bounces = new Uint8Array(N);
  let cursor = 0;
  let flying = 0;
  let ejected = 0;
  const rnd = env.rng;

  function writeMatrix(i) {
    const i3 = i * 3;
    _e.set(eul[i3], eul[i3 + 1], eul[i3 + 2]);
    _q.setFromEuler(_e);
    _p.set(pos[i3], pos[i3 + 1], pos[i3 + 2]);
    // Inside the near-lens zone the shell cannot read as a shell — see
    // NEAR_HIDE. Zero-scale rather than move it: the physics keeps running, so
    // the same casing appears the moment it clears the zone. Flying casings are
    // re-written every frame, so this re-evaluates itself; a RESTING shell lies
    // on the floor ~1.6 m below the eye and can never be inside the zone.
    const cam = env.cam;
    if (cam && _p.distanceToSquared(cam.position) < NEAR_HIDE_SQ) {
      _s.set(0, 0, 0);
    } else {
      _s.set(dims[i * 2], dims[i * 2], dims[i * 2 + 1]);
    }
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  function kill(i) {
    if (mode[i] === 1) flying--;
    mode[i] = 0;
    _m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    // origin/dir = shot event arrays; floorY resolved by fx.js
    eject(origin, dir, weaponId, floorY) {
      const i = cursor;
      cursor = (cursor + 1) % N;
      if (mode[i] === 1) flying--;
      mode[i] = 1;
      flying++;
      const sh = SHELL[weaponId] || SHELL.warden;
      const i3 = i * 3;
      // right of the fire direction (dir × up), for port position + arc
      let rx = -dir[2], rz = dir[0];
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      // PORT POSITION, MEASURED-DRIVEN (iter06). The shot origin is the EYE, so
      // a shell seeded 0.32 m down-range starts 0.35 m from the lens with a
      // forward component of only 0.32 m. Its lateral kick then outruns that
      // forward component before it clears the near-lens cull: the ratio
      // lateral/forward passes tan(46.7 deg) — the frustum's half-width — at
      // ~0.18 s while the distance passes the cull at ~0.2 s, so the shell is
      // hidden right up until the moment it is off the right edge. MEASURED:
      // over 70 ticks of sustained fire in the live S3 pose, ZERO player shells
      // projected inside the frame on any tick. Seeding at 0.42 m gives the
      // forward term enough head start for the arc to cross the lower-right
      // quadrant instead of exiting behind the cull.
      pos[i3] = origin[0] + dir[0] * 0.42 + rx * 0.14;
      pos[i3 + 1] = origin[1] + dir[1] * 0.42 - 0.10;
      pos[i3 + 2] = origin[2] + dir[2] * 0.42 + rz * 0.14;
      // EJECTION ARC (iter05, lane D). Measured in the live S1 frame: the
      // player's three airborne casings projected to screen x = 1687 / 2701 /
      // 3017 against a 1920-wide frame — every one of them had already left the
      // right edge. At 0.3 m from the eye the visible half-width is only 0.28 m,
      // so a 1.5–2.5 m/s lateral kick clears frame in ~0.08 s and no hip-fire
      // frame can ever contain brass. Softer sideways, higher and slightly
      // longer rearward: the shell tumbles up-and-right through the frame for
      // roughly a quarter second, which is the shot COD sells.
      // iter06: less rise, marginally more lateral. The old 1.7-2.6 m/s of lift
      // threw the shell above the frame's top edge inside 0.2 s — brass leaves
      // a hip-fire composition upward, not sideways — while the lateral kick
      // was the component that got it out of the near-lens cull. Flattening the
      // arc keeps it tumbling through the lower-right quadrant for ~0.4 s.
      // Right-and-slightly-FORWARD, not right-and-back. Brass inherits the
      // shooter's forward motion in life and the sim does not model that, so a
      // rearward bias put every shell behind the lens within a quarter second.
      // The vertical kick is also flattened (was 1.7–2.6 m/s): against the
      // sim's -20 m/s^2 that threw the shell above the frame's top edge before
      // it was ever drawn.
      vel[i3] = rx * (1.05 + rnd() * 0.7) + dir[0] * (0.45 + rnd() * 0.35);
      vel[i3 + 1] = 1.35 + rnd() * 0.7;
      vel[i3 + 2] = rz * (1.05 + rnd() * 0.7) + dir[2] * (0.45 + rnd() * 0.35);
      eul[i3] = rnd() * Math.PI * 2;
      eul[i3 + 1] = rnd() * Math.PI * 2;
      eul[i3 + 2] = rnd() * Math.PI * 2;
      angVel[i3] = (rnd() * 2 - 1) * 14;
      angVel[i3 + 1] = (rnd() * 2 - 1) * 14;
      angVel[i3 + 2] = (rnd() * 2 - 1) * 14;
      dims[i * 2] = sh.w;
      dims[i * 2 + 1] = sh.l;
      born[i] = env.now();
      ttl[i] = 10 + rnd() * 10; // 10–20 s persistence (VT §5)
      floor[i] = floorY;
      bounces[i] = 0;
      writeMatrix(i);
      mesh.instanceMatrix.needsUpdate = true;
      ejected++;
    },

    update(dt) {
      const now = env.now();
      let touched = false;
      for (let i = 0; i < N; i++) {
        const m = mode[i];
        if (m === 0) continue;
        if (now - born[i] > ttl[i]) { kill(i); touched = true; continue; }
        if (m !== 1) continue; // resting: expiry check only
        const i3 = i * 3;
        vel[i3 + 1] += G * dt;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        eul[i3] += angVel[i3] * dt;
        eul[i3 + 1] += angVel[i3 + 1] * dt;
        eul[i3 + 2] += angVel[i3 + 2] * dt;
        const half = dims[i * 2] * 0.5;
        if (vel[i3 + 1] < 0 && pos[i3 + 1] - half < floor[i]) {
          pos[i3 + 1] = floor[i] + half;
          vel[i3 + 1] = -vel[i3 + 1] * REST;
          vel[i3] *= 0.55; vel[i3 + 2] *= 0.55;
          angVel[i3] *= 0.45; angVel[i3 + 1] *= 0.45; angVel[i3 + 2] *= 0.45;
          bounces[i]++;
          const sp = Math.abs(vel[i3]) + Math.abs(vel[i3 + 1]) + Math.abs(vel[i3 + 2]);
          if (bounces[i] >= 2 && sp < 0.6) {
            // settle: lie flat (long axis horizontal), keep the yaw it had
            mode[i] = 2;
            flying--;
            eul[i3] = 0; eul[i3 + 2] = 0;
            pos[i3 + 1] = floor[i] + half;
          }
        }
        writeMatrix(i);
        touched = true;
      }
      if (touched) mesh.instanceMatrix.needsUpdate = true;
    },

    clear() {
      for (let i = 0; i < N; i++) if (mode[i]) kill(i);
      flying = 0;
    },
    prewarmables() { return [mesh]; },
    stats: () => ({ flying, ejected }),
  };
}
