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

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function makeCasings(env) {
  // unit box, per-instance scale carries the shell dimensions
  const geo = new THREE.BoxGeometry(1, 1, 1);
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
    _s.set(dims[i * 2], dims[i * 2], dims[i * 2 + 1]);
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
      pos[i3] = origin[0] + dir[0] * 0.32 + rx * 0.12;
      pos[i3 + 1] = origin[1] + dir[1] * 0.32 - 0.06;
      pos[i3 + 2] = origin[2] + dir[2] * 0.32 + rz * 0.12;
      vel[i3] = rx * (1.5 + rnd() * 1.0) - dir[0] * (0.3 + rnd() * 0.4);
      vel[i3 + 1] = 1.3 + rnd() * 0.9;
      vel[i3 + 2] = rz * (1.5 + rnd() * 1.0) - dir[2] * (0.3 + rnd() * 0.4);
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
