// core/fx/impacts.js [A7] — shared CPU particle pools (dust + spark Points)
// and the per-surface impact table. combat_spec §4.2 is the binding table;
// the surface KEYS are frozen and shared with audio (architecture §3.14):
// concrete / metal / dirt / wood / glass / flesh. Internal to fx.js.
//
// Pool design (doctrine §3 + perf budget §8):
//  - TWO THREE.Points pools, preallocated at boot, always in the scene, always
//    drawn (dead particles have size 0 / alpha 0 — degenerate, ~free):
//      dust  (640, NormalBlending)  — puffs, chips, clods, splinters, smoke,
//                                     flesh puffs, debris
//      spark (384, AdditiveBlending) — metal sparks, glass glints, embers,
//                                     transformer arcs, fireball cores (HDR
//                                     colors > 1 so the post bloom picks them)
//  - Both share ONE shader (one program) — blending is render state, not a
//    permutation key. Textures are procedural canvas (asset plan Part 4).
//  - Zero allocations after construction: struct-of-arrays state, swap-remove
//    active list, module-scope scratch.
//  - Cosmetic randomness from env.rng (the fx mulberry32 stream) — never a
//    sim input (doctrine §4).

import * as THREE from "three";

// Frozen keys + tolerated aliases (unknown surfaces read as concrete).
export const SURFACE_ALIAS = {
  concrete: "concrete", brick: "concrete", asphalt: "concrete",
  stone: "concrete", plaster: "concrete", sandbag: "concrete",
  metal: "metal", metal_thin: "metal", steel: "metal",
  dirt: "dirt", grass: "dirt", mud: "dirt", sand: "dirt", water: "dirt",
  wood: "wood",
  glass: "glass",
  flesh: "flesh",
};

// ---------------------------------------------------------------- textures
function softCircleTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

// ---------------------------------------------------------------- shader
// One shader for both pools: per-particle world size (perspective-correct
// gl_PointSize via uProj = drawingBufferHeight / (2 tan(vfov/2)), fed each
// frame by fx.update), per-particle color + alpha.
const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uProj;
varying float vA;
varying vec3 vC;
void main() {
  vC = aColor;
  vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(0.1, -mv.z);
  gl_PointSize = min(256.0, aSize * uProj / d);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vA;
varying vec3 vC;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC, a);
}`;

// ---------------------------------------------------------------- pool
function makePool(env, N, blending, renderOrder, tex) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const color = new Float32Array(N * 3);
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const sizeAttr = new THREE.BufferAttribute(size, 1);
  const alphaAttr = new THREE.BufferAttribute(alpha, 1);
  const colorAttr = new THREE.BufferAttribute(color, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("aSize", sizeAttr);
  geo.setAttribute("aAlpha", alphaAttr);
  geo.setAttribute("aColor", colorAttr);
  // never let three cull or recompute bounds on a scattered pool
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uProj: { value: 900 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  points.name = blending === THREE.AdditiveBlending ? "fx.spark" : "fx.dust";
  env.root.add(points);

  // struct-of-arrays particle state
  const vel = new Float32Array(N * 3);
  const birth = new Float32Array(N);
  const life = new Float32Array(N);
  const s0 = new Float32Array(N);
  const s1 = new Float32Array(N);
  const a0 = new Float32Array(N);
  const grav = new Float32Array(N);
  const rest = new Float32Array(N); // restitution; 0 = no floor bounce
  const floorY = new Float32Array(N);
  const damp = new Float32Array(N);
  const aliveF = new Uint8Array(N);
  const list = new Int32Array(N);
  let activeCount = 0;
  let cursor = 0;
  let dirty = false;

  function kill(i) {
    aliveF[i] = 0;
    size[i] = 0;
    alpha[i] = 0;
  }

  function spawn(x, y, z, vx, vy, vz, lifeS, sz0, sz1, r, g, b, alpha0, gravity, restit, floor, damping) {
    const i = cursor;
    cursor = (cursor + 1) % N;
    if (!aliveF[i]) {
      list[activeCount++] = i;
      aliveF[i] = 1;
    }
    const i3 = i * 3;
    pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    birth[i] = env.now();
    life[i] = lifeS;
    s0[i] = sz0; s1[i] = sz1;
    a0[i] = alpha0;
    grav[i] = gravity;
    rest[i] = restit;
    floorY[i] = floor;
    damp[i] = damping;
    size[i] = sz0;
    alpha[i] = alpha0;
    color[i3] = r; color[i3 + 1] = g; color[i3 + 2] = b;
    colorAttr.needsUpdate = true;
    dirty = true;
    return i;
  }

  function update(dt) {
    if (activeCount === 0) {
      if (dirty) {
        posAttr.needsUpdate = sizeAttr.needsUpdate = alphaAttr.needsUpdate = true;
        dirty = false;
      }
      return;
    }
    const now = env.now();
    for (let k = 0; k < activeCount; k++) {
      const i = list[k];
      const u = (now - birth[i]) / life[i];
      if (u >= 1) {
        kill(i);
        list[k] = list[--activeCount];
        k--;
        continue;
      }
      const i3 = i * 3;
      vel[i3 + 1] += grav[i] * dt;
      const dm = Math.max(0, 1 - damp[i] * dt);
      vel[i3] *= dm; vel[i3 + 1] *= dm; vel[i3 + 2] *= dm;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (rest[i] > 0 && vel[i3 + 1] < 0 && pos[i3 + 1] < floorY[i] + 0.02) {
        pos[i3 + 1] = floorY[i] + 0.02;
        vel[i3 + 1] = -vel[i3 + 1] * rest[i];
        vel[i3] *= 0.6; vel[i3 + 2] *= 0.6;
      }
      size[i] = s0[i] + (s1[i] - s0[i]) * u;
      alpha[i] = a0[i] * (1 - u);
    }
    posAttr.needsUpdate = sizeAttr.needsUpdate = alphaAttr.needsUpdate = true;
    dirty = false;
  }

  function clear() {
    for (let k = 0; k < activeCount; k++) kill(list[k]);
    activeCount = 0;
    sizeAttr.needsUpdate = alphaAttr.needsUpdate = true;
  }

  return {
    points, mat, spawn, update, clear,
    active: () => activeCount,
  };
}

// ---------------------------------------------------------------- pools API
export function makeParticlePools(env) {
  const tex = softCircleTexture();
  const dust = makePool(env, 640, THREE.NormalBlending, 20, tex);
  const spark = makePool(env, 384, THREE.AdditiveBlending, 22, tex);
  return {
    dust,
    spark,
    update(dt) { dust.update(dt); spark.update(dt); },
    setProj(f) {
      dust.mat.uniforms.uProj.value = f;
      spark.mat.uniforms.uProj.value = f;
    },
    clear() { dust.clear(); spark.clear(); },
    prewarmables() { return [dust.points, spark.points]; },
    active() { return dust.active() + spark.active(); },
  };
}

// ---------------------------------------------------------------- impacts
// spawnN helpers: velocity = surface normal * speed + isotropic jitter.
export function makeImpacts(env, pools, decals) {
  const rnd = env.rng;

  function floorBelow(x, y, z) {
    const g = env.groundY(x, z);
    return Math.min(g, y); // wall impacts drop debris to the ground below
  }

  function burstAt(pool, p, n, count, spMin, spMax, jit, lifeS, lifeJit, sz0, sz1,
    r, g, b, cJit, alpha0, gravity, restit, damping) {
    const floor = floorBelow(p[0], p[1], p[2]);
    for (let i = 0; i < count; i++) {
      const s = spMin + (spMax - spMin) * rnd();
      const cv = 1 - cJit * rnd();
      pool.spawn(
        p[0] + (rnd() - 0.5) * 0.03,
        p[1] + (rnd() - 0.5) * 0.03,
        p[2] + (rnd() - 0.5) * 0.03,
        n[0] * s + (rnd() * 2 - 1) * jit,
        n[1] * s + (rnd() * 2 - 1) * jit + jit * 0.4,
        n[2] * s + (rnd() * 2 - 1) * jit,
        lifeS + lifeJit * rnd(),
        sz0, sz1,
        r * cv, g * cv, b * cv,
        alpha0, gravity, restit, floor, damping);
    }
  }

  // combat_spec §4.2 table, row by row.
  const TABLE = {
    concrete(p, n) {
      // 6 gray chips + 1 dust puff 0.25 m, 0.5 s; bullet-hole decal
      burstAt(pools.dust, p, n, 6, 1.6, 3.4, 1.1, 0.42, 0.16, 0.028, 0.04,
        0.56, 0.55, 0.52, 0.25, 0.9, -9, 0.35, 0.4);
      burstAt(pools.dust, p, n, 1, 0.6, 0.9, 0.15, 0.5, 0.1, 0.1, 0.28,
        0.5, 0.48, 0.44, 0.1, 0.34, -0.4, 0, 1.6);
      decals.spawn(p, n, 0, 0.12 + rnd() * 0.05);
    },
    metal(p, n) {
      // 5 bright spark streaks 0.3 s + a 60 ms ring flash; scorch-dot decal
      burstAt(pools.spark, p, n, 5, 2.6, 6.0, 1.4, 0.24, 0.12, 0.014, 0.024,
        2.3, 1.7, 0.85, 0.2, 1.0, -9, 0.45, 0.5);
      burstAt(pools.spark, p, n, 1, 0.2, 0.4, 0.05, 0.06, 0.02, 0.09, 0.05,
        3.0, 2.4, 1.5, 0, 1.0, 0, 0, 0);
      decals.spawn(p, n, 1, 0.08 + rnd() * 0.05);
    },
    wood(p, n) {
      // 7 splinters 0.45 s; hole decal
      burstAt(pools.dust, p, n, 7, 1.8, 4.0, 1.0, 0.38, 0.14, 0.02, 0.035,
        0.42, 0.30, 0.18, 0.3, 0.9, -9, 0.2, 0.6);
      decals.spawn(p, n, 0, 0.1 + rnd() * 0.04);
    },
    dirt(p, n) {
      // 1 puff 0.35 m + 4 clods, 0.6 s; no decal
      burstAt(pools.dust, p, n, 1, 0.5, 0.8, 0.1, 0.6, 0.1, 0.14, 0.4,
        0.36, 0.29, 0.2, 0.1, 0.42, -0.3, 0, 1.4);
      burstAt(pools.dust, p, n, 4, 1.6, 3.4, 0.9, 0.5, 0.2, 0.03, 0.05,
        0.3, 0.24, 0.16, 0.25, 0.9, -9, 0.25, 0.4);
    },
    glass(p, n) {
      // 12 glinting shards (pane swap is level's job); no decal
      burstAt(pools.spark, p, n, 12, 1.6, 4.6, 1.5, 0.4, 0.18, 0.011, 0.02,
        1.4, 1.8, 2.0, 0.25, 0.9, -9, 0.3, 0.4);
    },
    flesh(p, n) {
      // 8 dark-red 0.06 m puffs, 0.35 s, gravity -4; no decal (portal rating)
      burstAt(pools.dust, p, n, 8, 0.9, 1.8, 0.7, 0.3, 0.1, 0.045, 0.09,
        0.28, 0.045, 0.045, 0.25, 0.72, -4, 0, 1.2);
    },
  };

  // Loose puffs for non-shot events (hurt/death/land/grenade-bounce).
  const UP = [0, 1, 0];
  const PUFFS = {
    flesh(p) { TABLE.flesh(p, UP); },
    death(p) {
      burstAt(pools.dust, p, UP, 6, 0.7, 1.4, 0.8, 0.35, 0.12, 0.05, 0.1,
        0.26, 0.04, 0.04, 0.25, 0.65, -4, 0, 1.2);
    },
    dust(p) {
      burstAt(pools.dust, p, UP, 5, 0.5, 1.1, 0.9, 0.5, 0.15, 0.09, 0.24,
        0.45, 0.42, 0.38, 0.15, 0.3, -0.5, 0, 1.5);
    },
    dustSmall(p) {
      burstAt(pools.dust, p, UP, 3, 0.4, 0.8, 0.5, 0.4, 0.1, 0.06, 0.14,
        0.45, 0.42, 0.38, 0.15, 0.28, -0.5, 0, 1.5);
    },
  };

  return {
    spawn(pos, normal, surface) {
      const fn = TABLE[surface] || TABLE.concrete;
      fn(pos, normal || UP);
    },
    puff(pos, kind) {
      const fn = PUFFS[kind];
      if (fn) fn(pos);
    },
    burstAt, // explosions.js composes debris/smoke/embers through this
    update() { /* particle motion lives in pools.update */ },
    prewarmables() { return []; }, // pools own the materials
  };
}
