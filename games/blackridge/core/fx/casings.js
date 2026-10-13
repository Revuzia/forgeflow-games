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
//
// PRESENTATION PASS (weapon-FX lane) — THE SHOTGUN SHELL. The B-12 Breaker is a
// pump gun, so its hull is NOT thrown out by the shot: it leaves when the slide
// is racked back, ≈0.36 s AFTER the blast (PUMP_EJECT_S — keep it equal to
// sfx.js's PUMP_BACK_S, which times the rack's slide-back clack to the same
// instant). The nine pellets of a volley are nine eject() calls with the same
// origin, so the volley LEADER published by muzzle.js on env.shot is the only
// one that queues a shell; the rest return. A second dedupe (same weapon, same
// origin, ≤ 50 ms) catches a call that arrives with no muzzle.spawn in front.
//
// A shell is TWO meshes of one pool slot: a red plastic HULL (70 mm minus the
// base × 18.5 mm) and a short brass BASE that reuses the brass casings'
// material. Both are plain MeshStandardMaterial instances with NO instance
// colour and no maps, so they hash to the SAME shader program as fx.casings —
// the shell costs zero new programs. Both meshes are in prewarmables().

import * as THREE from "three";

const N = 96;
const G = -20;        // matches the sim's gravity — shells feel world-real
const REST = 0.32;    // bounce restitution
const SHELL = {
  warden: { w: 0.011, l: 0.038 },
  vesper: { w: 0.009, l: 0.028 },
  corvus: { w: 0.013, l: 0.052 },
  pike: { w: 0.009, l: 0.024 },
  // 12-gauge hull: 18.5 mm × 70 mm overall, 12.5 mm brass base. `shell` = two-
  // part red/brass pump-gun shell, ejected on the rack (PUMP_EJECT_S).
  breaker: { w: 0.0185, l: 0.070, shell: true, baseL: 0.0125 },
};

// Seconds after the blast at which the pump slide is fully back and the hull
// leaves the port. Mirrors sfx.js PUMP_BACK_S.
const PUMP_EJECT_S = 0.36;
const N_SHELL = 16;      // pool slots for shotgun hulls (each = 1 hull + 1 base)
const N_PENDING = 8;     // queued pump-time ejections
const SHELL_NEAR_FULL = 1.05;  // m — a shell is full size from here out…
const SHELL_NEAR_ZERO = 0.55;  // …and scales in from nothing at this distance
const SAME_VOLLEY_S = 0.05;

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
// ---- iter09: 0.70 m IS STILL INSIDE THE ZONE, AND IT SHIPPED TWICE --------
// At 0.78 m — eight centimetres past this cull — a 38 mm case subtends
// 0.038/0.78 x (1080 / 2 tan(31 deg)) = 45 px long by 13 px wide, a vertical
// pale-yellow pill (iter08/S3.png, iter08/C1_11.png). An eight-sided cylinder
// has no detail to give at 45 px; it can only read as a prop. 1.50 m caps it at
// 25 x 7 px, which is a shell casing. The cost is the first ~0.13 s more of the
// tumble, and it is the right trade: the permanence read D6 is scored on is
// the brass ON THE GROUND, never the one frame where a case is closest to the
// lens.
// (The two-tone red/brass shotgun shell has a silhouette that survives closer
// in, so it uses the soft SHELL_NEAR_* scale-in above instead of this binary
// cull.)
const NEAR_HIDE = 1.50;
const NEAR_HIDE_SQ = NEAR_HIDE * NEAR_HIDE;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rt = new THREE.Vector3();
const _vmEject = new THREE.Vector3();

// One physics body pool (brass casings and shotgun shells share the integrator).
function makeBodies(n) {
  return {
    n,
    mode: new Uint8Array(n),       // 0 = dead, 1 = flying, 2 = resting
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    eul: new Float32Array(n * 3),
    angVel: new Float32Array(n * 3),
    dims: new Float32Array(n * 2), // w, l
    born: new Float32Array(n),
    ttl: new Float32Array(n),
    floor: new Float32Array(n),
    bounces: new Uint8Array(n),
    cursor: 0,
    flying: 0,
  };
}

// Integrate one flying body; returns true if it just settled.
function stepBody(B, i, dt, restitution) {
  const i3 = i * 3;
  const { vel, pos, eul, angVel } = B;
  vel[i3 + 1] += G * dt;
  pos[i3] += vel[i3] * dt;
  pos[i3 + 1] += vel[i3 + 1] * dt;
  pos[i3 + 2] += vel[i3 + 2] * dt;
  eul[i3] += angVel[i3] * dt;
  eul[i3 + 1] += angVel[i3 + 1] * dt;
  eul[i3 + 2] += angVel[i3 + 2] * dt;
  const half = B.dims[i * 2] * 0.5;
  if (vel[i3 + 1] < 0 && pos[i3 + 1] - half < B.floor[i]) {
    pos[i3 + 1] = B.floor[i] + half;
    vel[i3 + 1] = -vel[i3 + 1] * restitution;
    vel[i3] *= 0.55; vel[i3 + 2] *= 0.55;
    angVel[i3] *= 0.45; angVel[i3 + 1] *= 0.45; angVel[i3 + 2] *= 0.45;
    B.bounces[i]++;
    const sp = Math.abs(vel[i3]) + Math.abs(vel[i3 + 1]) + Math.abs(vel[i3 + 2]);
    if (B.bounces[i] >= 2 && sp < 0.6) {
      // settle: lie flat (long axis horizontal), keep the yaw it had
      B.mode[i] = 2;
      B.flying--;
      eul[i3] = 0; eul[i3 + 2] = 0;
      pos[i3 + 1] = B.floor[i] + half;
      return true;
    }
  }
  return false;
}

export function makeCasings(env) {
  // Unit CYLINDER on the Z axis (per-instance scale carries w, w, l).
  // Was a BoxGeometry: at the 40-70 px a near-lens shell actually occupies, a
  // 6-quad box shows exactly one flat unshaded face to the camera and reads as
  // a yellow slab — the "floating yellow prop" tell from iter05, which the
  // near-lens cull only hid rather than fixed. Eight sides give a specular
  // gradient across the case wall, which is the whole of what makes brass read
  // as brass. 16 triangles against 12; one instanced draw either way.
  // ---- iter09 (placeholder-eradication lane) ----------------------------
  // The 8-sided straight cylinder still reads as a PILL (iter07 "a ~40 cm
  // yellow pill", iter08 "a smooth flat-shaded pale-yellow capsule"). A
  // cartridge case is defined by its SILHOUETTE: an extractor rim standing
  // proud of the head, a groove behind it, a body that tapers, a shoulder, and
  // an open mouth. Lathed from that profile the object cannot read as a capsule
  // from any angle, and the rim and shoulder give the eight facets two hard
  // specular breaks instead of one smooth gradient. 112 triangles per instance,
  // 7,680 across the pool, ONE instanced draw, no program, no texture.
  const CASE = [                 // [radius, height] — height -0.5 = case head
    [0.00, -0.50],               // closed head, centre
    [0.54, -0.48],               // extractor rim, proud of the body
    [0.44, -0.40],               // extractor groove
    [0.50, -0.32],               // body, above the groove
    [0.50, 0.18],                // straight wall
    [0.41, 0.36],                // shoulder
    [0.37, 0.50],                // case mouth, outer
    [0.31, 0.47],                // case mouth, inner lip (open, not a dome)
  ];
  const geo = new THREE.LatheGeometry(
    CASE.map(([r, z]) => new THREE.Vector2(r, z)), 8);
  // LatheGeometry spins around +Y; the pool's per-instance scale is (w, w, l)
  // on (x, y, z), so the long axis has to be Z.
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  // BRASS THAT CATCHES LIGHT (iter07/iter09, D6). metalness 0.45 restores a
  // diffuse response to the sodium lamps the fight happens under and keeps a
  // real specular gradient across the eight case-wall facets; a brighter alloy
  // and a tight specular lobe let the sodium spill and the muzzle flashes catch
  // it. NOT emissive — brass is lit by the scene or it is not lit at all
  // (doctrine §3), and an emissive shell is the exact tell this file has spent
  // three iterations removing.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf2cd7d, // brass, a stop brighter
    metalness: 0.45,
    roughness: 0.22,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.name = "fx.casings";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, _m);
  env.root.add(mesh);

  // ---- shotgun shell: red plastic HULL + brass BASE (two meshes, one slot) ----
  const HULL = [                 // [radius, height]; -0.5 = the open (base) end
    [0.00, -0.50],
    [0.50, -0.50],
    [0.50, 0.40],                // straight plastic wall
    [0.47, 0.45],                // crimp shoulder
    [0.38, 0.49],
    [0.00, 0.50],                // closed star-crimp top
  ];
  const BASE = [
    [0.00, -0.50],               // flat primer end
    [0.55, -0.50],
    [0.55, -0.30],               // rim
    [0.48, -0.24],               // groove
    [0.50, -0.14],
    [0.50, 0.50],                // brass wall up into the hull
    [0.00, 0.50],
  ];
  const hullGeo = new THREE.LatheGeometry(HULL.map(([r, z]) => new THREE.Vector2(r, z)), 12);
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const baseGeo = new THREE.LatheGeometry(BASE.map(([r, z]) => new THREE.Vector2(r, z)), 12);
  baseGeo.rotateX(Math.PI / 2);
  baseGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  // gloss plastic: dark enough to read as a LIT red under sodium lamps, not an
  // emissive one (the same doctrine as the brass above)
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xb8281d, metalness: 0.0, roughness: 0.38 });
  const hullMesh = new THREE.InstancedMesh(hullGeo, hullMat, N_SHELL);
  const baseMesh = new THREE.InstancedMesh(baseGeo, mat, N_SHELL); // brass: shared material
  for (const [mm, nm] of [[hullMesh, "fx.shells.hull"], [baseMesh, "fx.shells.base"]]) {
    mm.frustumCulled = false;
    mm.name = nm;
    mm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < N_SHELL; i++) mm.setMatrixAt(i, _m);
    env.root.add(mm);
  }

  const B = makeBodies(N);          // brass casings
  const SB = makeBodies(N_SHELL);   // shotgun shells
  const rnd = env.rng;
  let ejected = 0;
  let shellsEjected = 0;

  // queued pump-time ejections
  const pend = {
    at: new Float32Array(N_PENDING), live: new Uint8Array(N_PENDING),
    o: new Float32Array(N_PENDING * 3), d: new Float32Array(N_PENDING * 3),
    floor: new Float32Array(N_PENDING), player: new Uint8Array(N_PENDING),
    cursor: 0, count: 0,
  };
  // fallback volley dedupe for an eject() that arrives without a muzzle.spawn
  const last = { t: -9, ox: 0, oy: 0, oz: 0, w: null };

  function writeMatrix(i) {
    const i3 = i * 3;
    _e.set(B.eul[i3], B.eul[i3 + 1], B.eul[i3 + 2]);
    _q.setFromEuler(_e);
    _p.set(B.pos[i3], B.pos[i3 + 1], B.pos[i3 + 2]);
    // Inside the near-lens zone the shell cannot read as a shell — see
    // NEAR_HIDE. Zero-scale rather than move it: the physics keeps running, so
    // the same casing appears the moment it clears the zone. Flying casings are
    // re-written every frame, so this re-evaluates itself; a RESTING shell lies
    // on the floor ~1.6 m below the eye and can never be inside the zone.
    const cam = env.cam;
    if (cam && _p.distanceToSquared(cam.position) < NEAR_HIDE_SQ) {
      _s.set(0, 0, 0);
    } else {
      _s.set(B.dims[i * 2], B.dims[i * 2], B.dims[i * 2 + 1]);
    }
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  const SHELL_L = SHELL.breaker.l, SHELL_BL = SHELL.breaker.baseL;
  const HULL_L = SHELL_L - SHELL_BL;
  const HULL_OFF = -SHELL_L / 2 + SHELL_BL + HULL_L / 2;   // hull centre along +Z
  const BASE_OFF = -SHELL_L / 2 + SHELL_BL / 2;            // base centre along +Z
  function writeShell(i) {
    const i3 = i * 3;
    _e.set(SB.eul[i3], SB.eul[i3 + 1], SB.eul[i3 + 2]);
    _q.setFromEuler(_e);
    _ax.set(0, 0, 1).applyQuaternion(_q);
    const w = SB.dims[i * 2];
    // soft scale-in through the near-lens band: a two-tone 70 mm shell keeps a
    // readable silhouette far closer than a 38 mm brass case (see NEAR_*)
    let k = 1;
    const cam = env.cam;
    if (cam) {
      const d = Math.sqrt(_v3.set(SB.pos[i3], SB.pos[i3 + 1], SB.pos[i3 + 2])
        .distanceToSquared(cam.position));
      k = (d - SHELL_NEAR_ZERO) / (SHELL_NEAR_FULL - SHELL_NEAR_ZERO);
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      k = k * k * (3 - 2 * k);
    }
    _p.set(SB.pos[i3] + _ax.x * HULL_OFF, SB.pos[i3 + 1] + _ax.y * HULL_OFF,
           SB.pos[i3 + 2] + _ax.z * HULL_OFF);
    _s.set(w * k, w * k, HULL_L * k);
    _m.compose(_p, _q, _s);
    hullMesh.setMatrixAt(i, _m);
    _p.set(SB.pos[i3] + _ax.x * BASE_OFF, SB.pos[i3 + 1] + _ax.y * BASE_OFF,
           SB.pos[i3 + 2] + _ax.z * BASE_OFF);
    _s.set(w * k, w * k, SHELL_BL * k);
    _m.compose(_p, _q, _s);
    baseMesh.setMatrixAt(i, _m);
  }

  function kill(i) {
    if (B.mode[i] === 1) B.flying--;
    B.mode[i] = 0;
    _m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }
  function killShell(i) {
    if (SB.mode[i] === 1) SB.flying--;
    SB.mode[i] = 0;
    _m.makeScale(0, 0, 0);
    hullMesh.setMatrixAt(i, _m);
    baseMesh.setMatrixAt(i, _m);
    hullMesh.instanceMatrix.needsUpdate = true;
    baseMesh.instanceMatrix.needsUpdate = true;
  }

  // Launch a shotgun shell from the port. Player: the viewmodel's eject socket
  // when it exists and agrees with the camera, else a camera-relative port
  // (right, low, forward); bots: their eye origin + shot direction.
  function launchShell(ox, oy, oz, dx, dy, dz, floorY, isPlayer) {
    const cam = env.cam;
    let px, py, pz, fx = dx, fy = dy, fz = dz;
    if (isPlayer && cam) {
      cam.getWorldDirection(_fwd);
      fx = _fwd.x; fy = _fwd.y; fz = _fwd.z;
    }
    let rx = -fz, rz = fx;                 // right of the heading (dir × up)
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    let got = false;
    if (isPlayer && cam) {
      const F = typeof window !== "undefined" ? window.__FPS__ : null;
      const vm = F && F.vm;
      if (vm && typeof vm.ejectWorld === "function") {
        try {
          const v = vm.ejectWorld(_vmEject.set(0, 0, 0));
          if (v && isFinite(v.x) && v.distanceToSquared(cam.position) < 1.4) {
            px = v.x; py = v.y; pz = v.z; got = true;
          }
        } catch (e) { /* camera-relative port below */ }
      }
      if (!got) {
        px = cam.position.x + fx * 0.46 + rx * 0.17;
        py = cam.position.y + fy * 0.46 - 0.15;
        pz = cam.position.z + fz * 0.46 + rz * 0.17;
      }
    } else {
      px = ox + fx * 0.42 + rx * 0.16;
      py = oy + fy * 0.42 - 0.16;
      pz = oz + fz * 0.42 + rz * 0.16;
    }
    const i = SB.cursor;
    SB.cursor = (SB.cursor + 1) % N_SHELL;
    if (SB.mode[i] === 1) SB.flying--;
    SB.mode[i] = 1;
    SB.flying++;
    const i3 = i * 3;
    SB.pos[i3] = px; SB.pos[i3 + 1] = py; SB.pos[i3 + 2] = pz;
    // SLOWER AND MORE UPWARD than rifle brass: a pump gun flips the hull up out
    // of the port, it does not fire it out. Right 1.3–2.3, forward 1.4–2.4 (so
    // it crosses the lower-right of frame instead of dropping behind the lens),
    // up 2.3–3.3 m/s.
    const lat = 1.3 + rnd() * 1.0, fwdv = 1.4 + rnd() * 1.0;
    SB.vel[i3] = rx * lat + fx * fwdv;
    SB.vel[i3 + 1] = 2.3 + rnd() * 1.0;
    SB.vel[i3 + 2] = rz * lat + fz * fwdv;
    SB.eul[i3] = rnd() * Math.PI * 2;
    SB.eul[i3 + 1] = rnd() * Math.PI * 2;
    SB.eul[i3 + 2] = rnd() * Math.PI * 2;
    SB.angVel[i3] = (rnd() * 2 - 1) * 11;
    SB.angVel[i3 + 1] = (rnd() * 2 - 1) * 11;
    SB.angVel[i3 + 2] = (rnd() * 2 - 1) * 11;
    SB.dims[i * 2] = SHELL.breaker.w;
    SB.dims[i * 2 + 1] = SHELL_L;
    SB.born[i] = env.now();
    SB.ttl[i] = 12 + rnd() * 10;
    SB.floor[i] = floorY;
    SB.bounces[i] = 0;
    writeShell(i);
    hullMesh.instanceMatrix.needsUpdate = true;
    baseMesh.instanceMatrix.needsUpdate = true;
    shellsEjected++;
  }

  return {
    // origin/dir = shot event arrays; floorY resolved by fx.js
    eject(origin, dir, weaponId, floorY) {
      const sh = SHELL[weaponId] || SHELL.warden;
      const now = env.now();
      // ---- multi-pellet volley: ONE shell per trigger pull ------------------
      const S = env.shot;
      const matched = !!(S && S.n > 0 && S.weaponId === weaponId &&
        S.ox === origin[0] && S.oy === origin[1] && S.oz === origin[2]);
      if (sh.shell) {
        if (matched) {
          if (!S.leader) return;
        } else if (last.w === weaponId && now - last.t <= SAME_VOLLEY_S && now >= last.t &&
                   last.ox === origin[0] && last.oy === origin[1] && last.oz === origin[2]) {
          return; // no volley published: fall back to our own window
        }
        last.t = now; last.w = weaponId;
        last.ox = origin[0]; last.oy = origin[1]; last.oz = origin[2];
        // queue the rack-time ejection
        const q = pend.cursor;
        pend.cursor = (pend.cursor + 1) % N_PENDING;
        if (!pend.live[q]) pend.count++;
        pend.live[q] = 1;
        pend.at[q] = now + PUMP_EJECT_S;
        pend.o[q * 3] = origin[0]; pend.o[q * 3 + 1] = origin[1]; pend.o[q * 3 + 2] = origin[2];
        pend.d[q * 3] = dir[0]; pend.d[q * 3 + 1] = dir[1]; pend.d[q * 3 + 2] = dir[2];
        pend.floor[q] = floorY;
        const cam = env.cam;
        pend.player[q] = matched
          ? (S.shooter === "P" ? 1 : 0)
          : (cam && Math.hypot(origin[0] - cam.position.x, origin[1] - cam.position.y,
                               origin[2] - cam.position.z) < 0.5 ? 1 : 0);
        return;
      }
      const i = B.cursor;
      B.cursor = (B.cursor + 1) % N;
      if (B.mode[i] === 1) B.flying--;
      B.mode[i] = 1;
      B.flying++;
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
      B.pos[i3] = origin[0] + dir[0] * 0.42 + rx * 0.14;
      B.pos[i3 + 1] = origin[1] + dir[1] * 0.42 - 0.10;
      B.pos[i3 + 2] = origin[2] + dir[2] * 0.42 + rz * 0.14;
      // ---- EJECTION ARC (iter05–iter07, lane D) -----------------------------
      // Forward-dominant with a real lateral kick puts the settled brass
      // ~3.5 m down-range and ~1.6 m right: inside the lower-right of frame, on
      // the lamp-lit cobbles. MEASURED history: iter05 every player shell left
      // the right edge inside 0.08 s (1.5–2.5 m/s lateral is too hard against a
      // 0.28 m half-width at 0.3 m); iter06 the lift (1.7–2.6 m/s) threw it out
      // of the top of frame; iter07 every settled case was 100% below the
      // bottom edge (ground first enters frame at 1.62/tan(31 deg) = 2.7 m), so
      // the arc was re-cut to 4.4–6.6 m/s total, forward-dominant, which clears
      // the near-lens cull in ~0.06 s and lands on ground the frame contains.
      B.vel[i3] = rx * (2.4 + rnd() * 1.2) + dir[0] * (3.8 + rnd() * 1.5);
      B.vel[i3 + 1] = 1.35 + rnd() * 0.7;
      B.vel[i3 + 2] = rz * (2.4 + rnd() * 1.2) + dir[2] * (3.8 + rnd() * 1.5);
      B.eul[i3] = rnd() * Math.PI * 2;
      B.eul[i3 + 1] = rnd() * Math.PI * 2;
      B.eul[i3 + 2] = rnd() * Math.PI * 2;
      B.angVel[i3] = (rnd() * 2 - 1) * 14;
      B.angVel[i3 + 1] = (rnd() * 2 - 1) * 14;
      B.angVel[i3 + 2] = (rnd() * 2 - 1) * 14;
      B.dims[i * 2] = sh.w;
      B.dims[i * 2 + 1] = sh.l;
      B.born[i] = now;
      B.ttl[i] = 10 + rnd() * 10; // 10–20 s persistence (VT §5)
      B.floor[i] = floorY;
      B.bounces[i] = 0;
      writeMatrix(i);
      mesh.instanceMatrix.needsUpdate = true;
      ejected++;
    },

    update(dt) {
      const now = env.now();
      // ---- queued pump-time shells ---------------------------------------
      if (pend.count > 0) {
        for (let q = 0; q < N_PENDING; q++) {
          if (!pend.live[q] || now < pend.at[q]) continue;
          pend.live[q] = 0; pend.count--;
          launchShell(pend.o[q * 3], pend.o[q * 3 + 1], pend.o[q * 3 + 2],
                      pend.d[q * 3], pend.d[q * 3 + 1], pend.d[q * 3 + 2],
                      pend.floor[q], pend.player[q] === 1);
        }
      }
      let touched = false;
      for (let i = 0; i < N; i++) {
        const m = B.mode[i];
        if (m === 0) continue;
        if (now - B.born[i] > B.ttl[i]) { kill(i); touched = true; continue; }
        if (m !== 1) continue; // resting: expiry check only
        stepBody(B, i, dt, REST);
        writeMatrix(i);
        touched = true;
      }
      if (touched) mesh.instanceMatrix.needsUpdate = true;
      let shTouched = false;
      for (let i = 0; i < N_SHELL; i++) {
        const m = SB.mode[i];
        if (m === 0) continue;
        if (now - SB.born[i] > SB.ttl[i]) { killShell(i); shTouched = true; continue; }
        if (m !== 1) continue;
        stepBody(SB, i, dt, 0.28);
        writeShell(i);
        shTouched = true;
      }
      if (shTouched) {
        hullMesh.instanceMatrix.needsUpdate = true;
        baseMesh.instanceMatrix.needsUpdate = true;
      }
    },

    clear() {
      for (let i = 0; i < N; i++) if (B.mode[i]) kill(i);
      B.flying = 0;
      for (let i = 0; i < N_SHELL; i++) if (SB.mode[i]) killShell(i);
      SB.flying = 0;
      pend.live.fill(0); pend.count = 0;
      last.t = -9; last.w = null;
    },
    prewarmables() { return [mesh, hullMesh, baseMesh]; },
    stats: () => ({ flying: B.flying + SB.flying, ejected: ejected + shellsEjected,
                    shells: shellsEjected, shellsFlying: SB.flying, shellsQueued: pend.count,
                    pumpEjectS: PUMP_EJECT_S }),
  };
}
