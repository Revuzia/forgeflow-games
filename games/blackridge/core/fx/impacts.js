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

  // combat_spec §4.2 table, row by row — REWORKED (owner report: "a pistol puts 3
  // holes on the wall"). The old rows stamped a 0.36-0.54 m crater PLUS three
  // 0.3-0.48 m "satellite" craters scattered up to 0.44 m away PLUS (45 %) a 1 m
  // dust wash: five marks and ~1 m of damage for ONE 9 mm round, and the
  // satellites were laid in the impact PLANE with no idea where the wall ended, so
  // near an edge they hung in the air. Now:
  //   ONE mark per bullet (per pellet for a shotgun), sized by the weapon, snapped
  //   onto the visible surface and clipped to it by fx.js before it gets here.
  //   `k`  = impact power (particle counts/sizes), `sz` = decal edge in metres.
  // The particles keep their iter06-09 legibility tuning (hot additive core,
  // chips, spall puff, lingering smoke) but scale with k, so a pistol round reads
  // as a pistol round and a marksman round as a marksman round.
  const TABLE = {
    concrete(p, n, dir, k, sz) {
      const kk = Math.sqrt(k);
      // hot core flash — what survives 20 m of night air (iter06)
      burstAt(pools.spark, p, n, 1, 0.15, 0.35, 0.05, 0.15, 0.03, 0.26 * kk, 0.08 * kk,
        4.4, 2.9, 1.35, 0, 1.0, 0, 0, 0);
      // ricochet sparks + chips
      burstAt(pools.spark, p, n, Math.max(2, Math.round(5 * k)), 2.2, 5.6, 1.4, 0.34, 0.14, 0.019, 0.032,
        3.1, 1.8, 0.72, 0.25, 1.0, -9, 0.4, 0.5);
      burstAt(pools.dust, p, n, Math.max(2, Math.round(5 * k)), 1.6, 3.4, 1.1, 0.42, 0.16, 0.055, 0.105,
        0.60, 0.58, 0.55, 0.25, 0.95, -9, 0.35, 0.4);
      // spall puff + a thin lingering haze on some strikes (survives the AgX shoulder)
      burstAt(pools.dust, p, n, 2, 0.5, 1.1, 0.24, 0.85, 0.28, 0.12 * kk, 0.70 * kk,
        0.62, 0.60, 0.56, 0.1, 0.46, -0.35, 0, 1.5);
      if (rnd() < 0.40) {
        burstAt(pools.dust, p, n, 1, 0.25, 0.55, 0.16, 1.8, 0.9, 0.22 * kk, 0.80 * kk,
          0.56, 0.55, 0.53, 0.08, 0.075, 0.10, 0, 1.9);
      }
      // THE mark: exactly one hole.
      decals.spawn(p, n, rnd() < 0.5 ? 0 : 3, sz * (0.88 + rnd() * 0.24), dir);
    },
    metal(p, n, dir, k, sz) {
      // Steel throws the longest-lived sparks of any surface (iter09) — keep them,
      // scale the count; one bare-metal gouge decal.
      burstAt(pools.spark, p, n, Math.max(3, Math.round(7 * k)), 2.6, 6.6, 1.5, 0.30, 0.14, 0.016, 0.028,
        2.8, 2.0, 1.0, 0.2, 1.0, -9, 0.45, 0.5);
      burstAt(pools.spark, p, n, 1, 0.2, 0.4, 0.05, 0.15, 0.03, 0.18 * Math.sqrt(k), 0.06,
        3.8, 3.0, 1.9, 0, 1.0, 0, 0, 0);
      burstAt(pools.dust, p, n, 1, 0.4, 0.9, 0.20, 0.8, 0.24, 0.10, 0.60,
        0.57, 0.55, 0.52, 0.1, 0.34, -0.3, 0, 1.5);
      decals.spawn(p, n, 2, sz * (0.95 + rnd() * 0.2), dir);
    },
    wood(p, n, dir, k, sz) {
      burstAt(pools.dust, p, n, Math.max(3, Math.round(6 * k)), 1.8, 4.0, 1.0, 0.38, 0.14, 0.035, 0.06,
        0.42, 0.30, 0.18, 0.3, 0.9, -9, 0.2, 0.6);
      burstAt(pools.dust, p, n, 1, 0.3, 0.7, 0.15, 0.6, 0.15, 0.08, 0.38,
        0.40, 0.32, 0.22, 0.1, 0.30, -0.3, 0, 1.4);
      decals.spawn(p, n, 6, sz * (0.9 + rnd() * 0.2), dir);
    },
    dirt(p, n, dir, k, sz) {
      burstAt(pools.dust, p, n, 1, 0.5, 0.8, 0.1, 0.6, 0.1, 0.12 * Math.sqrt(k), 0.38 * Math.sqrt(k),
        0.36, 0.29, 0.2, 0.1, 0.42, -0.3, 0, 1.4);
      burstAt(pools.dust, p, n, Math.max(2, Math.round(4 * k)), 1.6, 3.4, 0.9, 0.5, 0.2, 0.03, 0.05,
        0.3, 0.24, 0.16, 0.25, 0.9, -9, 0.25, 0.4);
      decals.spawn(p, n, 7, sz * (1.0 + rnd() * 0.3), dir);
    },
    water(p, n, dir, k, sz) {
      // canal: a quick upward splash of droplets + a low mist; no mark (water keeps none)
      void dir; void sz;
      const up = [0, 1, 0];
      burstAt(pools.dust, p, up, Math.max(4, Math.round(7 * k)), 1.6, 3.4, 0.5, 0.65, 0.22, 0.09, 0.30,
        0.74, 0.80, 0.86, 0.12, 0.75, -9, 0, 1.0);
      burstAt(pools.dust, p, up, 1, 0.3, 0.6, 0.1, 0.9, 0.2, 0.16, 0.80,
        0.62, 0.70, 0.76, 0.1, 0.34, -0.2, 0, 1.5);
      burstAt(pools.spark, p, up, 2, 1.0, 2.2, 0.4, 0.4, 0.1, 0.014, 0.024,
        1.2, 1.6, 2.0, 0.2, 0.8, -9, 0, 0.5);
    },
    glass(p, n, dir, k, sz) {
      // glinting shards + the star-crack decal (a pane keeps its wound)
      burstAt(pools.spark, p, n, Math.max(5, Math.round(9 * k)), 1.6, 4.6, 1.5, 0.4, 0.18, 0.011, 0.02,
        1.4, 1.8, 2.0, 0.25, 0.9, -9, 0.3, 0.4);
      decals.spawn(p, n, 5, sz * (2.4 + rnd() * 0.5), dir);
    },
    flesh(p, n) {
      // 8 dark-red 0.06 m puffs, 0.35 s, gravity -4; no decal (portal rating)
      // ---- iter09, D6 -----------------------------------------------------
      // THE ONE SURFACE THE C1 SCRIPT ACTUALLY HITS. The scored filmstrip is a
      // hip burst at two soldiers, so `concrete` gets the misses and `flesh`
      // gets the hits — and at the 12-20 m the contacts stand at, a 45-90 mm
      // puff at 0.28/0.045/0.045 linear is a 5-9 px near-black dot on a night
      // street: the shot that KILLS is the one event in the whole take with no
      // visible answer. 0.10 -> 0.22 m is 10-22 px, and lifting the red off
      // black (0.42/0.07/0.06) puts it above the AgX toe instead of under it.
      // Still no decal and still no gore geometry — this is a hit ANSWER, not
      // a wound. Count 8 -> 11 so a burst reads as sustained, not as one tick.
      burstAt(pools.dust, p, n, 11, 0.9, 2.0, 0.8, 0.34, 0.12, 0.10, 0.22,
        0.42, 0.07, 0.06, 0.25, 0.80, -4, 0, 1.2);
    },
    // 2026-10-14: the exit SPRAY — a short fan of droplets thrown ALONG the bullet,
    // out the far side of the target (fx.js also stamps KIND_BLOOD on whatever is
    // behind him). Small, fast, heavy (they fall), gone in ~0.4 s.
    fleshExit(p, n, dir, k) {
      if (!dir) return;
      burstAt(pools.dust, p, dir, Math.max(6, Math.round(10 * k)), 2.4, 5.2, 0.35, 0.40, 0.12, 0.035, 0.07,
        0.36, 0.035, 0.03, 0.15, 0.85, -9.5, 0, 0.6);
      burstAt(pools.dust, p, dir, 2, 0.6, 1.2, 0.5, 0.55, 0.15, 0.14, 0.30,
        0.30, 0.04, 0.04, 0.12, 0.45, -1.5, 0, 1.4);
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
    spawn(pos, normal, surface, dir, opts) {
      const fn = TABLE[surface] || TABLE.concrete;
      const k = opts && opts.power > 0 ? opts.power : 1;
      const sz = opts && opts.size > 0 ? opts.size : 0.19;
      fn(pos, normal || UP, dir, k, sz);
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
