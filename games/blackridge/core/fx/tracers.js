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
// iter05 (lane D): measured in the live S1 frame — 4 tracers alive at the
// shutter, projected to screen at 11.5 m and 39.3 m depth. At the old 0.035 m
// width that is 3.1 px and 0.9 px across, i.e. a sub-pixel thread over a neon
// wall, which is why three critics independently reported "no tracers are
// visible in any shot despite S1 being a firing frame" while the counters said
// tracersSpawned 9. The pool was never the problem; the streak was too thin to
// survive resampling. 6.5 m / 0.075 m puts a warden streak at ~7 px across and
// ~580 px long at 11 m — legible without becoming a laser bolt.
// iter06 (D6 lane): the pool is NOT the problem and was not the problem in
// iter05 either — measured live across C1's whole 60-tick fire window,
// tracersActive never dropped below 2 and tracersSpawned reached 40. Three
// critics still reported no tracer in any frame. So this is purely a
// legibility budget: 0.075 m at the 17-20 m contact range of these poses is
// ~4 px of warm streak over a neon-lit wet street that is already carrying
// bloom. Widened to 0.105 m (~5.5 px at 17 m, ~9 px at 11 m), lengthened to
// 9 m, and lifted 2.2 -> 3.1 HDR so the streak survives the post chain's
// tonemap instead of being averaged into the background.
const LEN = 9.0;     // max streak length (m)
const WIDTH = 0.105; // streak width (m) at and beyond NEAR_REF
const HDR = 3.1;    // color multiplier — the streak blooms, the frame doesn't

// ---------------------------------------------------------------------------
// iter09 (placeholder lane): THIS MODULE EMITTED THE WAVE'S #1 ARTEFACT.
// The iter08 C1_05 "flat untextured tan quad interpenetrating the player's own
// weapon" — named in 3 of 3 blind verdicts, unattributed by every lane — is a
// tracer. PROVEN, not inferred: placing one instance of this pool on a line
// passing ~0.6 m from the S1 camera reproduces the artefact exactly (flat
// (188,166,138), 2 px edge transition, ~170 px across, crossing the viewmodel).
// Two independent defects combined to make a light streak read as a solid slab:
//
//  (1) NO CROSS-WIDTH FALLOFF. The old 64x8 texture was a gradient along the
//      LENGTH axis only, so every column was a constant alpha from edge to
//      edge — a hard-edged rectangle by construction, at any size.
//  (2) NO ANGULAR BOUND. A 0.105 m quad is ~6 px at the 17 m contact range it
//      was tuned for, but an ENEMY tracer aimed at the player passes within a
//      metre of the eye, where the same 0.105 m subtends ~170 px. The colour
//      is then additive 0xffd9a0 x 3.1 = linear (3.10, 2.15, 1.09), which
//      lands deep on the AgX shoulder and flattens to a single desaturated
//      tan for every pixel it covers — hence "untextured", not "bright".
//
// Both are fixed at the generator: a teardrop alpha profile with a soft cross
// section, and a width that holds a CONSTANT ~12 px apparent size closer than
// NEAR_REF instead of exploding. The iter05/06 legibility work is preserved
// untouched — at >= NEAR_REF the width is still exactly 0.105 m.
const NEAR_REF = 8.0;         // m — inside this, hold apparent width constant
const NEAR_REF_INV = 1 / NEAR_REF;

function streakTexture() {
  // 128 x 32 teardrop: alpha = lengthRamp(u) * softCrossSection(v, u).
  // Thin at the tail, full at the head, and soft-edged everywhere — so the
  // quad can never present a hard rectangular boundary however large it gets.
  const W = 128, H = 32;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const img = g.createImageData(W, H);
  const px = img.data;
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W;
    // length ramp: invisible at the tail, hot at the head (unchanged intent)
    const ramp = Math.pow(u, 2.2) * 0.92 + 0.08 * u;
    // teardrop: the streak narrows toward the tail
    const halfW = 0.14 + 0.86 * Math.pow(u, 0.55);
    // round the head off so the leading edge is a cap, not a chopped rectangle
    const cap = u > 0.955 ? Math.sqrt(Math.max(0, 1 - ((u - 0.955) / 0.045) ** 2)) : 1;
    for (let y = 0; y < H; y++) {
      const v = ((y + 0.5) / H) * 2 - 1;            // -1..1 across the width
      const t = Math.min(1, Math.abs(v) / halfW);
      const cross = Math.exp(-3.2 * t * t) * (1 - t * t * t);
      const a = Math.max(0, Math.min(1, ramp * cross * cap));
      const i = (y * W + x) * 4;
      // warm core, whiter at the very centre — a streak, not a painted bar
      const core = 1 - Math.min(1, Math.abs(v) / (halfW * 0.42));
      px[i] = 255;
      px[i + 1] = 232 + Math.round(23 * core);
      px[i + 2] = 200 + Math.round(55 * core);
      px[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
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
// Used by the iter09 angular bound in update(). Added by the D6/D10 lane:
// the bound shipped referencing these two without declaring them, which threw
// `ReferenceError: _tail is not defined` out of fx.update() on the first
// tracer frame and took the whole page down. Declaration only — no logic here.
const _tail = new THREE.Vector3();
const _near = new THREE.Vector3();

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
        // ANGULAR BOUND (iter09). Distance from the eye to the CLOSEST point of
        // the streak segment, not to its midpoint: a 9 m streak whose middle is
        // 5 m away can still have an end 0.3 m from the lens, and it is the end
        // that fills the frame. Inside NEAR_REF the metric width falls off
        // linearly with that distance, which holds the on-screen width constant
        // (~12 px at 1080p) instead of letting it grow without limit. Beyond
        // NEAR_REF this is exactly 1.0, so the iter05/06 legibility tuning at
        // the 11-20 m contact ranges is bit-identical to before.
        _tail.copy(_mid).addScaledVector(_dirV, -len * 0.5);
        _near.copy(cam.position).sub(_tail);
        let tproj = _near.dot(_dirV);
        if (tproj < 0) tproj = 0; else if (tproj > len) tproj = len;
        _near.copy(_tail).addScaledVector(_dirV, tproj).sub(cam.position);
        const dNear = Math.sqrt(_near.lengthSq()) || 1e-3;
        _y.multiplyScalar(WIDTH * Math.min(1, dNear * NEAR_REF_INV));
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
