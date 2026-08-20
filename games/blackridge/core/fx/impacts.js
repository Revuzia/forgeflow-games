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

  // combat_spec §4.2 table, row by row.
  const TABLE = {
    concrete(p, n, dir) {
      // IMPACT LEGIBILITY AT COMBAT RANGE (iter06, D6). The authored row —
      // 6 chips at 28-40 mm and one 0.28 m dust puff — is physically right and
      // optically invisible: gl_PointSize = aSize * uProj / d puts a 34 mm chip
      // at the 17-20 m contact ranges of S1/S3/C1 at UNDER TWO PIXELS. Three
      // critics reported no impact anywhere in the battery while the counters
      // said 74 impacts and 74 decals in a single C1 take, which is exactly
      // what "spawned but sub-pixel" looks like from outside.
      // What survives 20 m of night air and the post chain is a HOT ADDITIVE
      // core, so concrete now gets one: a 0.30 m spark-pool flash decaying to
      // 0.10 m over 130 ms (>= one rendered frame at this build's pacing —
      // see muzzle.js's LIGHT header for why 60 ms rows never render at all),
      // plus 5 ricochet sparks. Chips and dust unchanged in character.
      // ---- iter07, D6 permanence: THE MARK, NOT THE HOLE -----------------
      // The iter06 row spawned a 0.17-0.24 m decal whose opaque core covered
      // the inner quarter of the cell, i.e. a ~2 px speck at the 18-20 m the
      // battery frames contact at. A rifle round does not leave a 3 mm hole in
      // concrete — it spalls a 50-90 mm crater and throws a dust scuff several
      // times wider than that. The quad now carries the whole event, so it is
      // authored at 0.36-0.54 m with the black core still ~0.09 m inside it:
      // the same hole, drawn with the damage around it. See the decals.js
      // header for why the art is bi-tonal.
      burstAt(pools.spark, p, n, 1, 0.15, 0.35, 0.05, 0.13, 0.03, 0.30, 0.10,
        3.4, 2.2, 1.05, 0, 1.0, 0, 0, 0);
      burstAt(pools.spark, p, n, 5, 2.2, 5.0, 1.3, 0.28, 0.12, 0.017, 0.028,
        2.6, 1.5, 0.6, 0.25, 1.0, -9, 0.4, 0.5);
      // chips: 28-50 mm was one pixel of dust-pool point at 20 m. Concrete
      // spall throws fragments up to fingernail size — 55-105 mm reads as
      // debris in flight instead of as sensor noise.
      burstAt(pools.dust, p, n, 6, 1.6, 3.4, 1.1, 0.42, 0.16, 0.055, 0.105,
        0.60, 0.58, 0.55, 0.25, 0.95, -9, 0.35, 0.4);
      // THE SPALL PUFF is the loudest single read a strike has at range: a
      // pale cloud that blooms wide and hangs. 0.11 -> 0.46 m at alpha 0.36
      // was a 20 px ghost; 0.16 -> 0.95 m at 0.52 is the dust cloud a bullet
      // actually raises off masonry, and it survives the AgX shoulder.
      burstAt(pools.dust, p, n, 2, 0.5, 1.0, 0.22, 0.85, 0.25, 0.16, 0.95,
        0.62, 0.60, 0.56, 0.1, 0.52, -0.35, 0, 1.5);
      decals.spawn(p, n, rnd() < 0.5 ? 0 : 3, 0.36 + rnd() * 0.18, dir);
      // SATELLITE CHIP MARKS. One round on masonry does not leave one tidy
      // dot — the crater is ringed by smaller scars where the spall came off.
      // Two half-size marks scattered 80-260 mm out turn each hit into a
      // cluster, which is what makes a wall read as SHOT UP rather than
      // spotted: 11 rounds of pre-roll now deposit ~33 marks across the same
      // 1.7 m spread circle instead of 11. Costs nothing — the ring buffer is
      // 256 deep and this is still one instanced draw.
      satellites(p, n, dir, 2, 0.08, 0.18, 0.42, 0.62);
      // The wide dust wash the holes sit in — see decals.js cell 4. Laid on
      // ~45% of strikes rather than all of them: these overlap multiplicatively
      // and a scuff on every round of a burst stacks into one flat pale patch
      // instead of an uneven dusting.
      if (rnd() < 0.45) decals.spawn(p, n, 4, 0.85 + rnd() * 0.35, dir);
    },
    metal(p, n, dir) {
      // 5 bright spark streaks 0.3 s + a ring flash; bare-metal gouge decal.
      // The ring flash was authored at 60 ms — shorter than one rendered
      // frame's sim advance on this build, i.e. never drawn. 130 ms.
      // The decal was a DARK scorch dot 0.11-0.17 m: on a night vehicle that
      // is dark-on-dark at 2 px. Atlas cell 2 is a bright torn-steel gouge —
      // bare metal is the brightest thing on an unlit vehicle — at 0.22-0.34 m.
      burstAt(pools.spark, p, n, 5, 2.6, 6.0, 1.4, 0.24, 0.12, 0.014, 0.024,
        2.3, 1.7, 0.85, 0.2, 1.0, -9, 0.45, 0.5);
      burstAt(pools.spark, p, n, 1, 0.2, 0.4, 0.05, 0.13, 0.03, 0.20, 0.06,
        3.0, 2.4, 1.5, 0, 1.0, 0, 0, 0);
      burstAt(pools.dust, p, n, 1, 0.4, 0.8, 0.18, 0.7, 0.2, 0.12, 0.60,
        0.55, 0.53, 0.50, 0.1, 0.34, -0.3, 0, 1.5);
      decals.spawn(p, n, 2, 0.28 + rnd() * 0.14, dir);
      satellites(p, n, dir, 1, 0.07, 0.16, 0.30, 0.44, 2);
      if (rnd() < 0.45) decals.spawn(p, n, 4, 0.55 + rnd() * 0.25, dir);
    },
    wood(p, n, dir) {
      // 7 splinters 0.45 s; hole decal
      burstAt(pools.dust, p, n, 7, 1.8, 4.0, 1.0, 0.38, 0.14, 0.035, 0.06,
        0.42, 0.30, 0.18, 0.3, 0.9, -9, 0.2, 0.6);
      decals.spawn(p, n, rnd() < 0.5 ? 0 : 3, 0.20 + rnd() * 0.10, dir);
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
    spawn(pos, normal, surface, dir) {
      const fn = TABLE[surface] || TABLE.concrete;
      fn(pos, normal || UP, dir);
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
