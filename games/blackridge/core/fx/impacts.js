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
  stone: "concrete", plaster: "concrete",
  // [feel v153] fabric + water get their own rows (fx.js also retypes a
  // collider "dirt" box of kind sandbags to fabric, and vehicles to vehicle)
  sandbag: "fabric", sandbags: "fabric", fabric: "fabric", cloth: "fabric",
  vehicle: "vehicle",
  metal: "metal", metal_thin: "metal", steel: "metal",
  dirt: "dirt", grass: "dirt", mud: "dirt", sand: "dirt", water: "water",
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

// ---------------------------------------------------------------- streak pool
// [feel v153] VELOCITY-STRETCHED particles. Every spark, splinter, shard and
// droplet used to be a round soft point sprite, so a ricochet off a steel
// container read as a handful of glowing dots — the single cheapest tell in the
// impact set. A streak is a camera-facing quad drawn from the particle's head
// back along its own velocity for `stretch` seconds of travel, built in SCREEN
// space in the vertex shader (no per-particle matrices on the CPU), with a
// minimum on-screen width (uMinPx) so a 12 mm spark still reads as a thread of
// light at 40 m instead of resampling to nothing.
// Two meshes, ONE program: additive (sparks, glints) and normal-blended
// (splinters, droplets, fibres) share the exact same shader source, and
// blending is render state, not a program key. Both live in the scene from
// boot and are in prewarmables(), so the boot prewarm compiles the program.
const STREAK_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iCol;
attribute vec2 iSz;      // x = width (m), y = stretch (s of travel)
uniform float uProj;     // drawingBufferHeight / (2 tan(vfov/2))
uniform vec2 uRes;       // drawing buffer size (px)
uniform float uMinPx;
varying vec4 vCol;
varying vec2 vUv;
void main() {
  vCol = iCol;
  vUv = position.xy;
  vec4 ch = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(iPos - iVel * iSz.y, 1.0);
  // a tail behind the eye: clamp it to the head (the streak degenerates to a dot)
  if (ct.w < 0.05) ct = ch;
  float wh = max(ch.w, 0.05);
  vec2 sh = ch.xy / wh * 0.5 * uRes;
  vec2 st = ct.xy / max(ct.w, 0.05) * 0.5 * uRes;
  vec2 d = sh - st;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = max(uMinPx, 0.5 * iSz.x * uProj / wh);
  // dead slot (alpha 0): collapse off screen, costs nothing to raster
  if (iCol.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 base = mix(sh, st, position.y);
  vec2 px = base + nrm * position.x * hw + dir * (position.y < 0.5 ? hw : -hw);
  float w = mix(ch.w, max(ct.w, 0.05), position.y);
  float z = mix(ch.z / wh, ct.z / max(ct.w, 0.05), position.y);
  gl_Position = vec4(px / (0.5 * uRes) * w, z * w, w);
}`;

const STREAK_FRAG = /* glsl */ `
varying vec4 vCol;
varying vec2 vUv;
void main() {
  float x = vUv.x;
  float cross = 1.0 - x * x;
  float a = vCol.a * cross * cross * mix(1.0, 0.18, vUv.y);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

function makeStreakPool(env, N, blending, renderOrder) {
  const geo = new THREE.InstancedBufferGeometry();
  // quad: x = side (-1..1), y = 0 head / 1 tail
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const col = new Float32Array(N * 4);
  const sz = new Float32Array(N * 2);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3);
  const aVel = new THREE.InstancedBufferAttribute(vel, 3);
  const aCol = new THREE.InstancedBufferAttribute(col, 4);
  const aSz = new THREE.InstancedBufferAttribute(sz, 2);
  for (const a of [aPos, aVel, aCol, aSz]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iPos", aPos);
  geo.setAttribute("iVel", aVel);
  geo.setAttribute("iCol", aCol);
  geo.setAttribute("iSz", aSz);
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uProj: { value: 900 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uMinPx: { value: 0.75 } },
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // the quad is built in screen space, so its winding flips with the streak's
    // on-screen direction: never cull it
    side: THREE.DoubleSide,
    blending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.name = blending === THREE.AdditiveBlending ? "fx.streakAdd" : "fx.streakMix";
  env.root.add(mesh);

  const birth = new Float32Array(N);
  const life = new Float32Array(N);
  const a0 = new Float32Array(N);
  const grav = new Float32Array(N);
  const rest = new Float32Array(N);
  const floorY = new Float32Array(N);
  const damp = new Float32Array(N);
  const aliveF = new Uint8Array(N);
  const list = new Int32Array(N);
  let activeCount = 0, cursor = 0, dirty = false;

  function kill(i) { aliveF[i] = 0; col[i * 4 + 3] = 0; }

  // width (m), stretch (s): a spark at 6 m/s with 0.022 s stretch is a 13 cm streak
  function spawn(x, y, z, vx, vy, vz, lifeS, width, stretch, r, g, b, alpha0, gravity, restit, floor, damping) {
    const i = cursor;
    cursor = (cursor + 1) % N;
    if (!aliveF[i]) { list[activeCount++] = i; aliveF[i] = 1; }
    const i3 = i * 3, i4 = i * 4;
    pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    col[i4] = r; col[i4 + 1] = g; col[i4 + 2] = b; col[i4 + 3] = alpha0;
    sz[i * 2] = width; sz[i * 2 + 1] = stretch;
    birth[i] = env.now(); life[i] = lifeS; a0[i] = alpha0;
    grav[i] = gravity; rest[i] = restit; floorY[i] = floor; damp[i] = damping;
    aSz.needsUpdate = true;
    dirty = true;
  }

  function update(dt) {
    if (activeCount === 0) {
      if (dirty) { aPos.needsUpdate = aVel.needsUpdate = aCol.needsUpdate = true; dirty = false; }
      return;
    }
    const now = env.now();
    for (let k = 0; k < activeCount; k++) {
      const i = list[k];
      const u = (now - birth[i]) / life[i];
      if (u >= 1) { kill(i); list[k] = list[--activeCount]; k--; continue; }
      const i3 = i * 3;
      vel[i3 + 1] += grav[i] * dt;
      const dm = Math.max(0, 1 - damp[i] * dt);
      vel[i3] *= dm; vel[i3 + 1] *= dm; vel[i3 + 2] *= dm;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (vel[i3 + 1] < 0 && pos[i3 + 1] < floorY[i] + 0.01) {
        pos[i3 + 1] = floorY[i] + 0.01;
        if (rest[i] > 0) { vel[i3 + 1] = -vel[i3 + 1] * rest[i]; vel[i3] *= 0.55; vel[i3 + 2] *= 0.55; }
        else { vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0; }
      }
      // sparks cool fast (ease-out), everything else fades linearly
      col[i * 4 + 3] = a0[i] * (1 - u * u);
    }
    aPos.needsUpdate = aVel.needsUpdate = aCol.needsUpdate = true;
    dirty = false;
  }

  function clear() {
    for (let k = 0; k < activeCount; k++) kill(list[k]);
    activeCount = 0;
    aCol.needsUpdate = true;
  }

  return { mesh, mat, spawn, update, clear, active: () => activeCount };
}

// ---------------------------------------------------------------- pools API
export function makeParticlePools(env) {
  const tex = softCircleTexture();
  const dust = makePool(env, 640, THREE.NormalBlending, 20, tex);
  const spark = makePool(env, 384, THREE.AdditiveBlending, 22, tex);
  const streak = makeStreakPool(env, 320, THREE.AdditiveBlending, 22);
  const shard = makeStreakPool(env, 256, THREE.NormalBlending, 21);
  return {
    dust,
    spark,
    streak,
    shard,
    update(dt) { dust.update(dt); spark.update(dt); streak.update(dt); shard.update(dt); },
    setProj(f, w, h) {
      dust.mat.uniforms.uProj.value = f;
      spark.mat.uniforms.uProj.value = f;
      for (const p of [streak, shard]) {
        p.mat.uniforms.uProj.value = f;
        if (w > 0 && h > 0) p.mat.uniforms.uRes.value.set(w, h);
      }
    },
    clear() { dust.clear(); spark.clear(); streak.clear(); shard.clear(); },
    prewarmables() { return [dust.points, spark.points, streak.mesh, shard.mesh]; },
    active() { return dust.active() + spark.active() + streak.active() + shard.active(); },
    streaksActive() { return streak.active() + shard.active(); },
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

  // Scatter `count` smaller marks in the impact PLANE around p. The offset is
  // built from two vectors orthogonal to the surface normal, so a satellite
  // can never float off a wall or sink into a floor.
  const _t1 = [0, 0, 0], _t2 = [0, 0, 0], _sp = [0, 0, 0];
  function satellites(p, n, dir, count, rMin, rMax, sMin, sMax, kind) {
    // Seed the basis with the WORLD AXIS THE NORMAL LEANS ON LEAST, so the
    // Gram-Schmidt below can never be handed a vector parallel to n (which
    // would collapse t1 to zero and stack every satellite on the parent —
    // exactly what a fixed "+Z unless the normal is up" seed does on a wall
    // that faces +Z, i.e. half the walls in this level).
    const ax0 = Math.abs(n[0]), ay0 = Math.abs(n[1]), az0 = Math.abs(n[2]);
    const ax = (ax0 <= ay0 && ax0 <= az0) ? 0 : (ay0 <= az0 ? 1 : 2);
    _t1[0] = ax === 0 ? 1 : 0;
    _t1[1] = ax === 1 ? 1 : 0;
    _t1[2] = ax === 2 ? 1 : 0;
    // t1 = normalize(t1 - n * dot) ; t2 = n x t1
    const d1 = _t1[0] * n[0] + _t1[1] * n[1] + _t1[2] * n[2];
    _t1[0] -= n[0] * d1; _t1[1] -= n[1] * d1; _t1[2] -= n[2] * d1;
    const l1 = Math.hypot(_t1[0], _t1[1], _t1[2]) || 1;
    _t1[0] /= l1; _t1[1] /= l1; _t1[2] /= l1;
    _t2[0] = n[1] * _t1[2] - n[2] * _t1[1];
    _t2[1] = n[2] * _t1[0] - n[0] * _t1[2];
    _t2[2] = n[0] * _t1[1] - n[1] * _t1[0];
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rMin + (rMax - rMin) * rnd();
      const cu = Math.cos(a) * r, cv = Math.sin(a) * r;
      _sp[0] = p[0] + _t1[0] * cu + _t2[0] * cv;
      _sp[1] = p[1] + _t1[1] * cu + _t2[1] * cv;
      _sp[2] = p[2] + _t1[2] * cu + _t2[2] * cv;
      decals.spawn(_sp, n, kind != null ? kind : (rnd() < 0.5 ? 0 : 3),
        sMin + (sMax - sMin) * rnd(), dir);
    }
  }

  // ---- [feel v153] streak helpers ------------------------------------------
  // `axis` is the emission direction (normal, ricochet or the bullet's own
  // direction); `cone` is isotropic jitter in m/s on top of axis * speed.
  function streakBurst(pool, p, axis, count, spMin, spMax, cone, lifeS, lifeJit, width, stretch,
    r, g, b, cJit, alpha0, gravity, restit, damping) {
    const floor = floorBelow(p[0], p[1], p[2]);
    for (let i = 0; i < count; i++) {
      const s = spMin + (spMax - spMin) * rnd();
      const cv = 1 - cJit * rnd();
      pool.spawn(
        p[0] + axis[0] * 0.01, p[1] + axis[1] * 0.01, p[2] + axis[2] * 0.01,
        axis[0] * s + (rnd() * 2 - 1) * cone,
        axis[1] * s + (rnd() * 2 - 1) * cone,
        axis[2] * s + (rnd() * 2 - 1) * cone,
        lifeS + lifeJit * rnd(), width, stretch,
        r * cv, g * cv, b * cv, alpha0, gravity, restit, floor, damping);
    }
  }
  // Ricochet axis: the bullet's reflection off the surface, pulled toward the
  // normal so a grazing round sprays along the wall and a square hit sprays back.
  const _rf = [0, 0, 0];
  function ricochet(n, dir, wN) {
    if (!dir) { _rf[0] = n[0]; _rf[1] = n[1]; _rf[2] = n[2]; return _rf; }
    const dn = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2];
    const x = dir[0] - 2 * dn * n[0], y = dir[1] - 2 * dn * n[1], z = dir[2] - 2 * dn * n[2];
    _rf[0] = x + n[0] * wN; _rf[1] = y + n[1] * wN; _rf[2] = z + n[2] * wN;
    const l = Math.hypot(_rf[0], _rf[1], _rf[2]) || 1;
    _rf[0] /= l; _rf[1] /= l; _rf[2] /= l;
    return _rf;
  }
  const UPV = [0, 1, 0];

  // combat_spec §4.2 table, row by row. ONE mark per bullet (per pellet for a
  // shotgun), sized by the weapon, snapped onto the visible surface and clipped
  // to it by fx.js before it gets here. `k` = impact power (particle counts and
  // sizes), `sz` = decal edge in metres, `far` = distance legibility factor
  // (1 at <= 14 m, up to 2.4 at 34 m+): airborne puffs and the flash grow with
  // range so a strike still reads at 40 m, while streaks keep a minimum
  // on-screen width in the shader. Decals never scale with `far`.
  //
  // [feel v153] REWORK (impact review against a current military shooter):
  //  - sparks, splinters, shards, chips and droplets are VELOCITY STREAKS now,
  //    not round dots (makeStreakPool above);
  //  - concrete no longer throws a fistful of orange sparks on every round (a
  //    masonry hit is a grey spall cone + chips; a hot spark only sometimes);
  //    steel and vehicles own the spark showers, along the RICOCHET direction;
  //  - new rows: fabric (sandbags), vehicle (sheet metal + paint flecks),
  //    water (puddle crown splash) and a wet-street droplet crown on top of the
  //    surface's own row; flesh splits into body and HEAD.
  const TABLE = {
    concrete(p, n, dir, k, sz, far) {
      const kk = Math.sqrt(k);
      // brief hot pop — the frame a round strikes stone, not a glowing ball
      burstAt(pools.spark, p, n, 1, 0.1, 0.2, 0.03, 0.06, 0.02, 0.15 * kk * far, 0.05 * far,
        3.2, 2.5, 1.5, 0, 0.9, 0, 0, 0);
      // a hot spark only some of the time (steel owns the showers)
      if (rnd() < 0.5) {
        streakBurst(pools.streak, p, ricochet(n, dir, 0.9), Math.max(1, Math.round(2 * k)), 5, 11, 1.8,
          0.10, 0.08, 0.010, 0.032, 3.0, 1.9, 0.8, 0.2, 1.0, -9.8, 0.3, 0.5);
      }
      // chips: grey grit thrown off the face, falling and skittering
      streakBurst(pools.shard, p, n, Math.max(3, Math.round(6 * k)), 2.2, 5.5, 1.7,
        0.55, 0.25, 0.016, 0.014, 0.36, 0.35, 0.33, 0.3, 0.95, -9.8, 0.25, 0.4);
      // spall cone: fast out of the face, braking hard, swelling as it slows
      burstAt(pools.dust, p, n, 5, 1.2, 4.2, 0.7, 0.7, 0.3, 0.05 * kk * far, 0.55 * kk * far,
        0.42, 0.40, 0.38, 0.15, 0.30, -0.25, 0, 3.6);
      if (rnd() < 0.40) {
        burstAt(pools.dust, p, n, 1, 0.25, 0.55, 0.16, 1.8, 0.9, 0.22 * kk * far, 0.85 * kk * far,
          0.56, 0.55, 0.53, 0.08, 0.075, 0.10, 0, 1.9);
      }
      decals.spawn(p, n, rnd() < 0.5 ? 0 : 3, sz * (0.88 + rnd() * 0.24), dir);
    },
    metal(p, n, dir, k, sz, far) {
      const kk = Math.sqrt(k);
      burstAt(pools.spark, p, n, 1, 0.1, 0.2, 0.03, 0.06, 0.02, 0.2 * kk * far, 0.05 * far,
        3.8, 3.0, 1.9, 0, 1.0, 0, 0, 0);
      // the shower: long, hot, ricocheting, bouncing on the floor
      streakBurst(pools.streak, p, ricochet(n, dir, 0.7), Math.max(6, Math.round(12 * k)), 5, 14, 3.0,
        0.16, 0.28, 0.012, 0.042, 3.4, 2.05, 0.75, 0.25, 1.0, -9.8, 0.35, 0.7);
      // a couple of slow fat embers that hang a moment
      burstAt(pools.spark, p, n, 2, 0.6, 1.6, 0.6, 0.35, 0.15, 0.022, 0.012,
        2.8, 1.6, 0.5, 0.2, 1.0, -6, 0.3, 0.8);
      burstAt(pools.dust, p, n, 1, 0.4, 0.9, 0.20, 0.8, 0.24, 0.08 * far, 0.45 * far,
        0.57, 0.55, 0.52, 0.1, 0.30, -0.3, 0, 1.5);
      decals.spawn(p, n, 2, sz * (0.95 + rnd() * 0.2), dir);
    },
    // car / van / truck panels: thin sheet steel — fewer sparks, a paint-fleck
    // spray and a puff of road grime knocked off the panel
    vehicle(p, n, dir, k, sz, far) {
      const kk = Math.sqrt(k);
      burstAt(pools.spark, p, n, 1, 0.1, 0.2, 0.03, 0.05, 0.02, 0.16 * kk * far, 0.05 * far,
        3.6, 2.9, 1.9, 0, 1.0, 0, 0, 0);
      streakBurst(pools.streak, p, ricochet(n, dir, 0.8), Math.max(4, Math.round(7 * k)), 5, 12, 2.4,
        0.12, 0.18, 0.011, 0.036, 3.3, 2.1, 0.8, 0.25, 1.0, -9.8, 0.3, 0.7);
      streakBurst(pools.shard, p, n, Math.max(3, Math.round(5 * k)), 1.8, 4.2, 1.4,
        0.6, 0.25, 0.014, 0.010, 0.62, 0.62, 0.60, 0.35, 0.9, -9.8, 0.2, 0.6);
      burstAt(pools.dust, p, n, 2, 0.8, 1.8, 0.3, 0.6, 0.2, 0.07 * kk * far, 0.40 * kk * far,
        0.40, 0.38, 0.35, 0.1, 0.35, -0.3, 0, 2.6);
      decals.spawn(p, n, 2, sz * (0.9 + rnd() * 0.2), dir);
    },
    wood(p, n, dir, k, sz, far) {
      const kk = Math.sqrt(k);
      // splinters: pale fresh-cut wood, tumbling out and dropping
      streakBurst(pools.shard, p, n, Math.max(4, Math.round(7 * k)), 2.2, 5.8, 1.6,
        0.7, 0.3, 0.026, 0.030, 0.46, 0.33, 0.19, 0.3, 1.0, -9.8, 0.15, 0.5);
      burstAt(pools.dust, p, n, 2, 0.9, 2.2, 0.3, 0.6, 0.2, 0.07 * kk * far, 0.42 * kk * far,
        0.50, 0.40, 0.28, 0.1, 0.42, -0.3, 0, 3.0);
      decals.spawn(p, n, 6, sz * (0.9 + rnd() * 0.2), dir);
    },
    dirt(p, n, dir, k, sz, far) {
      const kk = Math.sqrt(k);
      // clods kicked up + a brown puff
      streakBurst(pools.shard, p, n, Math.max(3, Math.round(5 * k)), 2.0, 4.6, 1.2,
        0.6, 0.2, 0.022, 0.016, 0.24, 0.19, 0.13, 0.3, 1.0, -9.8, 0.1, 0.4);
      burstAt(pools.dust, p, n, 2, 0.6, 1.6, 0.3, 0.7, 0.2, 0.10 * kk * far, 0.48 * kk * far,
        0.36, 0.29, 0.2, 0.1, 0.48, -0.3, 0, 2.4);
      decals.spawn(p, n, 7, sz * (1.0 + rnd() * 0.3), dir);
    },
    // sandbags / fabric: no sparks at all — a burlap puff, sand pouring out of the
    // hole and a few fibres
    fabric(p, n, dir, k, sz, far) {
      const kk = Math.sqrt(k);
      burstAt(pools.dust, p, n, 3, 1.0, 2.6, 0.35, 0.7, 0.25, 0.08 * kk * far, 0.52 * kk * far,
        0.58, 0.50, 0.38, 0.1, 0.55, -0.4, 0, 3.0);
      // sand: a short spill out of the face, falling
      streakBurst(pools.shard, p, n, Math.max(4, Math.round(6 * k)), 0.4, 1.4, 0.35,
        0.7, 0.3, 0.012, 0.03, 0.64, 0.56, 0.42, 0.2, 0.95, -9.8, 0, 0.3);
      streakBurst(pools.shard, p, n, 3, 1.2, 2.6, 1.0, 0.6, 0.2, 0.006, 0.05,
        0.72, 0.64, 0.50, 0.2, 0.7, -2.5, 0, 2.0);
      decals.spawn(p, n, 7, sz * (0.8 + rnd() * 0.2), dir);
    },
    water(p, n, dir, k, sz, far) {
      // puddle / canal: a crown of droplets straight up + a low mist; no mark
      void dir; void sz;
      streakBurst(pools.shard, p, UPV, Math.max(9, Math.round(13 * k)), 2.0, 4.6, 0.9,
        0.6, 0.2, 0.018, 0.045, 0.74, 0.80, 0.86, 0.15, 0.75, -9.8, 0, 0.3);
      burstAt(pools.dust, p, UPV, 1, 0.3, 0.6, 0.1, 0.8, 0.2, 0.14 * far, 0.70 * far,
        0.62, 0.70, 0.76, 0.1, 0.30, -0.2, 0, 1.5);
      streakBurst(pools.streak, p, UPV, 2, 1.0, 2.4, 0.5, 0.35, 0.1, 0.008, 0.03,
        1.0, 1.3, 1.6, 0.2, 0.7, -9.8, 0, 0.3);
    },
    // a round into a WET street: a small droplet crown on top of the surface row
    wet(p) {
      streakBurst(pools.shard, p, UPV, 4, 1.2, 2.8, 0.7, 0.4, 0.15, 0.010, 0.03,
        0.70, 0.76, 0.82, 0.15, 0.6, -9.8, 0, 0.3);
    },
    glass(p, n, dir, k, sz, far) {
      // glinting slivers back toward the shooter + the pane's shards falling
      // out of BOTH faces (the round goes through), the star-crack decal
      streakBurst(pools.streak, p, n, Math.max(5, Math.round(9 * k)), 1.6, 4.8, 1.6,
        0.35, 0.2, 0.008, 0.022, 1.5, 1.8, 2.1, 0.25, 0.9, -9.8, 0.3, 0.4);
      if (dir) {
        streakBurst(pools.shard, p, dir, 4, 0.8, 2.4, 0.8, 0.7, 0.2, 0.016, 0.02,
          0.70, 0.78, 0.82, 0.15, 0.55, -9.8, 0.2, 0.3);
      }
      burstAt(pools.dust, p, n, 1, 0.3, 0.8, 0.2, 0.45, 0.1, 0.05 * far, 0.26 * far,
        0.78, 0.82, 0.84, 0.1, 0.25, -0.4, 0, 1.6);
      decals.spawn(p, n, 5, sz * (2.4 + rnd() * 0.5), dir);
    },
    flesh(p, n, dir, k, sz, far) {
      // BODY hit: a dark-red mist puff (still a hit ANSWER, not a wound) and a
      // few heavy droplets that fall. Sized for 12-20 m legibility (iter09).
      const f = far || 1;
      burstAt(pools.dust, p, n, 7, 0.7, 1.7, 0.7, 0.32, 0.12, 0.09 * f, 0.22 * f,
        0.40, 0.06, 0.05, 0.25, 0.78, -4, 0, 1.6);
      streakBurst(pools.shard, p, n, 4, 1.2, 2.6, 1.1, 0.4, 0.12, 0.016, 0.03,
        0.30, 0.03, 0.03, 0.2, 0.85, -9.8, 0, 0.5);
    },
    // HEADSHOT: distinct at a glance without gore geometry — a sharper, brighter,
    // wider mist burst that hangs a beat longer, plus a fan of fine droplets
    fleshHead(p, n, dir, k, sz, far) {
      const f = far || 1;
      burstAt(pools.dust, p, n, 10, 1.0, 2.4, 1.1, 0.45, 0.15, 0.10 * f, 0.34 * f,
        0.52, 0.08, 0.07, 0.2, 0.85, -2.5, 0, 1.8);
      streakBurst(pools.shard, p, n, 7, 1.8, 3.8, 1.6, 0.45, 0.15, 0.014, 0.035,
        0.34, 0.03, 0.03, 0.2, 0.9, -9.8, 0, 0.5);
    },
    // 2026-10-14: the exit SPRAY thrown ALONG the bullet, out the far side of the
    // target (fx.js also stamps KIND_BLOOD on whatever is behind him). [feel
    // v153] droplets are streaks; `k` > 1.2 (head) widens the fan.
    fleshExit(p, n, dir, k) {
      if (!dir) return;
      streakBurst(pools.shard, p, dir, Math.max(6, Math.round(9 * k)), 2.4, 5.6, 0.45,
        0.40, 0.12, 0.016, 0.03, 0.34, 0.03, 0.03, 0.15, 0.9, -9.8, 0, 0.6);
      burstAt(pools.dust, p, dir, 2, 0.6, 1.2, 0.5, 0.55, 0.15, 0.14, 0.30,
        0.30, 0.04, 0.04, 0.12, 0.45, -1.5, 0, 1.4);
    },
    // blood setting "off": the hit still gets an answer, in a neutral grey
    fleshMuted(p, n, dir, k, sz, far) {
      const f = far || 1;
      burstAt(pools.dust, p, n, 6, 0.7, 1.6, 0.7, 0.28, 0.1, 0.08 * f, 0.2 * f,
        0.42, 0.42, 0.40, 0.2, 0.6, -2, 0, 1.6);
    },
  };

  // Loose puffs for non-shot events (hurt/death/land/grenade-bounce).
  const UP = [0, 1, 0];
  const PUFFS = {
    flesh(p) { TABLE.flesh(p, UP); },
    death(p) {
      // iter09: scaled with the flesh row above, for the same measured reason.
      // A kill at 12-20 m had a 5-10 px near-black answer; this is 12-24 px.
      burstAt(pools.dust, p, UP, 8, 0.7, 1.5, 0.9, 0.40, 0.14, 0.12, 0.24,
        0.40, 0.065, 0.055, 0.25, 0.74, -4, 0, 1.2);
    },
    dust(p) {
      burstAt(pools.dust, p, UP, 5, 0.5, 1.1, 0.9, 0.5, 0.15, 0.09, 0.24,
        0.45, 0.42, 0.38, 0.15, 0.3, -0.5, 0, 1.5);
    },
    dustSmall(p) {
      burstAt(pools.dust, p, UP, 3, 0.4, 0.8, 0.5, 0.4, 0.1, 0.06, 0.14,
        0.45, 0.42, 0.38, 0.15, 0.28, -0.5, 0, 1.5);
    },
    // Post-burst barrel wisp (lane_env — muzzle.js BARREL HEAT): a thin,
    // faint, slow riser off a hot muzzle. Tiny and low-alpha on purpose: it
    // spawns ~1 m from the eye, where a dust point is large on screen.
    muzzleWisp(p) {
      burstAt(pools.dust, p, UP, 1, 0.04, 0.12, 0.25, 1.15, 0.45, 0.018, 0.10,
        0.52, 0.51, 0.50, 0.08, 0.075, 0.55, 0, 1.3);
    },
    // Muzzle smoke (iter06, D6 — called by muzzle.js on every fire-time shot).
    // Two soft grey puffs that grow 0.07 -> 0.22 m over 0.6-0.95 s and drift
    // gently up and down-range. Deliberately LOW alpha: this must read as
    // propellant haze hanging where the barrel was, never as a grey card. The
    // caller seeds it 1.4 m down-range for the player so the point sprite
    // cannot swell over the lens.
    muzzleSmoke(p) {
      burstAt(pools.dust, p, UP, 2, 0.15, 0.45, 0.28, 0.6, 0.35, 0.07, 0.22,
        0.47, 0.46, 0.45, 0.12, 0.15, 0.35, 0, 1.9);
    },
  };

  return {
    // `dir` = the incoming ray direction; forwarded to decals.spawn so a
    // fallback surface normal can be detected and the decal dropped rather
    // than stamped edge-on inside solid geometry (decals.js header).
    // `opts` = {power, size} from fx.js (weapon-class table). Defaults are a
    // generic 5.56-ish round.
    // `opts.wet` adds the wet-street droplet crown on top of the surface row.
    spawn(pos, normal, surface, dir, opts) {
      const fn = TABLE[surface] || TABLE.concrete;
      const k = opts && opts.power > 0 ? opts.power : 1;
      const sz = opts && opts.size > 0 ? opts.size : 0.19;
      // distance legibility: 1 inside 14 m, growing to 2.4 by ~34 m
      const c = env.cam && env.cam.position;
      const dc = c ? Math.hypot(pos[0] - c.x, pos[1] - c.y, pos[2] - c.z) : 0;
      const far = Math.min(2.4, Math.max(1, dc / 14));
      fn(pos, normal || UP, dir, k, sz, far);
      if (opts && opts.wet) TABLE.wet(pos);
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
