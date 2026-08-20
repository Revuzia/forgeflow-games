// core/fx/tracers.js [A7] — cosmetic tracer streaks. Pool of 24 instanced
// quads (architecture §3.14). combat_spec §3.1: cosmetic speed cap 300 m/s
// (the damage ray already resolved — last-circle's proven trick), warm
// 0xffd9a0. Constants come from weapon_data.js TRACER_MODEL — the shared
// declaration (A4's export); local fallback only guards a stub regression.
// Cylindrically billboarded toward the camera each frame. Internal to fx.js.

import * as THREE from "three";
import * as WD from "../weapons/weapon_data.js";

const TRACER = WD.TRACER_MODEL || { cosmeticCapMps: 300, color: 0xffd9a0 };
const N = 24;
const LEN = 3.2;    // max streak length (m)
const WIDTH = 0.035; // streak width (m)
const HDR = 2.2;    // color multiplier — the streak blooms, the frame doesn't

function streakTexture() {
  const cv = document.createElement("canvas");
  cv.width = 64; cv.height = 8;
  const g = cv.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0.0, "rgba(255,255,255,0)");
  gr.addColorStop(0.55, "rgba(255,235,205,0.45)");
  gr.addColorStop(0.88, "rgba(255,245,225,0.95)");
  gr.addColorStop(1.0, "rgba(255,255,255,1)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 8);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _dirV = new THREE.Vector3();

export function makeTracers(env) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const mat = new THREE.MeshBasicMaterial({
    map: streakTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  mat.color.setHex(TRACER.color).multiplyScalar(HDR);

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.renderOrder = 23;
  mesh.name = "fx.tracers";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, _m);
  mesh.instanceMatrix.needsUpdate = true;
  env.root.add(mesh);

  // state
  const head = new Float32Array(N * 3);
  const dir = new Float32Array(N * 3);
  const traveled = new Float32Array(N);
  const total = new Float32Array(N);
  const alive = new Uint8Array(N);
  let cursor = 0;
  let activeCount = 0;
  let spawnedCount = 0;

  function deactivate(i) {
    if (!alive[i]) return;
    alive[i] = 0;
    activeCount--;
    _m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, _m);
  }

  return {
    // origin/direction are the shot event's [3] arrays; dist = metres to the
    // resolved hit (or a far cap on a terminal miss).
    spawn(origin, direction, dist) {
      const i = cursor;
      cursor = (cursor + 1) % N;
      if (!alive[i]) { alive[i] = 1; activeCount++; }
      const i3 = i * 3;
      // start slightly downrange so the quad never sits inside the camera
      head[i3] = origin[0] + direction[0] * 0.9;
      head[i3 + 1] = origin[1] + direction[1] * 0.9;
      head[i3 + 2] = origin[2] + direction[2] * 0.9;
      dir[i3] = direction[0]; dir[i3 + 1] = direction[1]; dir[i3 + 2] = direction[2];
      traveled[i] = 0;
      total[i] = Math.max(0.5, dist - 0.9);
      spawnedCount++;
    },

    update(dt) {
      if (activeCount === 0) return;
      const cam = env.cam;
      const step = TRACER.cosmeticCapMps * dt;
      for (let i = 0; i < N; i++) {
        if (!alive[i]) continue;
        const i3 = i * 3;
        traveled[i] += step;
        if (traveled[i] >= total[i]) { deactivate(i); continue; }
        head[i3] += dir[i3] * step;
        head[i3 + 1] += dir[i3 + 1] * step;
        head[i3 + 2] += dir[i3 + 2] * step;
        const len = Math.min(LEN, traveled[i]);
        _dirV.set(dir[i3], dir[i3 + 1], dir[i3 + 2]);
        _mid.set(
          head[i3] - _dirV.x * len * 0.5,
          head[i3 + 1] - _dirV.y * len * 0.5,
          head[i3 + 2] - _dirV.z * len * 0.5);
        // cylindrical billboard: quad long axis = dir, normal faces camera
        _toCam.copy(cam.position).sub(_mid);
        const d = _toCam.dot(_dirV);
        _z.copy(_toCam).addScaledVector(_dirV, -d);
        if (_z.lengthSq() < 1e-6) _z.set(0, 1, 0);
        _z.normalize();
        _y.crossVectors(_z, _dirV).normalize();
        _x.copy(_dirV).multiplyScalar(len);
        _y.multiplyScalar(WIDTH);
        _m.makeBasis(_x, _y, _z);
        _m.setPosition(_mid);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    clear() {
      for (let i = 0; i < N; i++) deactivate(i);
      mesh.instanceMatrix.needsUpdate = true;
    },
    prewarmables() { return [mesh]; },
    active: () => activeCount,
    spawned: () => spawnedCount,
  };
}
