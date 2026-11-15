// core/fx/explosions.js [A7] — grenade / fuel-drum / transformer explosion
// fx (R6, BUILD_PLAN §A7): flash + ring + smoke + debris — "not confetti
// cubes" (VT D6). Consumes the shared particle pools (impacts.js) for
// smoke/debris/embers, the decal pool for the scorch mark, and AT MOST the
// one explosion light of the R3 dynamic pool (3 muzzle grants + 1
// explosion) via the A6 lease API — never a constructed THREE.Light.
// Variants:
//   grenade     — warm flash, gray smoke, dark debris, few embers
//   drum        — bigger/orange, fireball cores, heavy smoke, many embers
//   transformer — cyan-white arc burst, spark shower, little smoke (the
//                 beat-3 blackout set-piece read; LD §3.2 fx pool row)
// Internal to fx.js.

import * as THREE from "three";

const FLASH_N = 4;
const RING_N = 4;
const LIGHT_DUR_S = 0.28;

const VARIANTS = {
  grenade: {
    // flashScaleR 1.25 -> 0.70 (lane_env): the old 7 m additive disc WAS the
    // explosion; the volume puffs carry the body now, the flash is the pop.
    flash: [3.0, 2.1, 1.15], flashScaleR: 0.70,
    light: 0xffb066, peak: 60, lightR: 20,
    ring: [2.4, 1.6, 0.9],
    smoke: 7, smokeC: [0.13, 0.125, 0.12],
    debris: 12, embers: 16, emberC: [2.5, 1.2, 0.4],
    fireballs: 3,
    puffFire: 5, puffSmoke: 6, fireLife: 0.42, arc: 0,
  },
  drum: {
    flash: [3.2, 1.7, 0.7], flashScaleR: 0.85,
    light: 0xff8a3d, peak: 70, lightR: 26,
    ring: [2.6, 1.3, 0.6],
    smoke: 11, smokeC: [0.09, 0.085, 0.08],
    debris: 14, embers: 24, emberC: [2.6, 1.1, 0.3],
    fireballs: 5,
    puffFire: 7, puffSmoke: 8, fireLife: 0.75, arc: 0, puffShade: 0.7,
  },
  // kill-streak call-ins (mortar / airstrike / orbital): bigger, longer, with a
  // rising smoke column — they used to fall back to the frag-grenade look
  streak: {
    flash: [3.4, 2.0, 0.9], flashScaleR: 0.80,
    light: 0xff9a4a, peak: 95, lightR: 34,
    ring: [2.8, 1.7, 0.9],
    smoke: 14, smokeC: [0.11, 0.105, 0.10],
    debris: 24, embers: 30, emberC: [2.6, 1.2, 0.35],
    fireballs: 9, fbLife: 0.55, fbSize: 1.9,
    column: 10,
    puffFire: 9, puffSmoke: 12, fireLife: 0.7, arc: 0,
  },
  // [polish v149] TRIPMINE: a shaped charge, not a frag — a tight pop, a low
  // forward FAN of fire/smoke along the mine's facing and a hot pellet spray
  // inside its 60° kill cone (same pools; `dir` = the mine's facing, yaw).
  claymore: {
    flash: [3.0, 2.3, 1.4], flashScaleR: 0.42,
    light: 0xffc07a, peak: 48, lightR: 16,
    ring: [1.6, 1.1, 0.6],
    smoke: 4, smokeC: [0.14, 0.135, 0.13],
    debris: 6, embers: 6, emberC: [2.6, 1.4, 0.5],
    fireballs: 1,
    puffFire: 5, puffSmoke: 5, fireLife: 0.30, arc: 0,
    directional: { spray: 26, fanDeg: 30, spMin: 9, spMax: 17 },
  },
  transformer: {
    flash: [2.0, 2.8, 3.2], flashScaleR: 0.85,
    light: 0x7fe8ff, peak: 50, lightR: 18,
    ring: [0.9, 2.2, 2.4],
    smoke: 3, smokeC: [0.16, 0.17, 0.18],
    debris: 6, embers: 24, emberC: [1.6, 2.3, 3.0],
    fireballs: 0,
    puffFire: 3, puffSmoke: 2, fireLife: 0.28, arc: 1,
  },
};

function flashTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  gr.addColorStop(0.0, "rgba(255,255,252,1)");
  gr.addColorStop(0.25, "rgba(255,236,200,0.85)");
  gr.addColorStop(0.55, "rgba(255,205,140,0.4)");
  gr.addColorStop(1.0, "rgba(255,180,110,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function ringTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 30, 64, 64, 63);
  gr.addColorStop(0.0, "rgba(255,255,255,0)");
  gr.addColorStop(0.55, "rgba(255,255,255,0.0)");
  gr.addColorStop(0.75, "rgba(255,240,220,0.7)");
  gr.addColorStop(0.9, "rgba(255,235,210,0.25)");
  gr.addColorStop(1.0, "rgba(255,230,200,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _X = new THREE.Vector3(1, 0, 0);
const _ZAXIS = new THREE.Vector3(0, 0, 1);
const _UP = [0, 1, 0];
const _dirScratch = [0, 0, 1];

function makeBillboardPool(env, n, tex, renderOrder, name) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  _c.setRGB(0, 0, 0);
  for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c); }
  env.root.add(mesh);
  return { mesh, mat };
}

// ======================================================= VOLUME PUFFS (lane_env)
// The before capture (_shots/lane_env/before_boom_a.png) read as ONE flat
// additive disc 7 m across — a bright hemisphere with no form — followed by a
// couple of grey sprite dots (before_boom_b). What a blast actually is on
// screen: a turbulent fireball whose hot core cools through orange to soot,
// rolling up into a dark smoke mass that is lit from inside for its first
// half-second and then by the street. That is done here as a pool of
// camera-facing puffs with a fragment program that:
//   * erodes a sphere impostor with two scrolling taps of a small tileable
//     noise texture (silhouette is torn, not round; the field MORPHS because
//     the two taps scroll differently),
//   * shades the sphere normal against "up" (sky/moon) and against the fire
//     glow inside the cloud, so smoke has a lit top and a dark belly,
//   * runs a temperature ramp (white-yellow -> orange -> deep red -> soot) off
//     the puff's age and its local density, authored ABOVE 1.0 so the core
//     blooms and AgX rolls it off,
//   * PREMULTIPLIED output (ONE, ONE_MINUS_SRC_ALPHA): fire EMITS, smoke
//     OCCLUDES, in one draw.
// Everything after spawn is GPU-side: age, growth, rise and drift are derived
// in the vertex shader from (uNow - birth), so the CPU only writes a puff's
// attributes ONCE, at spawn. One draw call for the whole pool; fragments only
// exist while a blast is on screen. No light, no new pass.
const PUFF_N = 64;

function puffNoiseTexture() {
  // 64x64 tileable 4-octave value fBm in R and an independent one in G.
  const S = 64;
  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  function field(base, oct) {
    const lats = [];
    for (let o = 0; o < oct; o++) {
      const per = base << o, a = new Float32Array(per * per);
      for (let i = 0; i < a.length; i++) a[i] = rnd();
      lats.push(a);
    }
    const out = new Float32Array(S * S);
    let lo = 1e9, hi = -1e9;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0, amp = 1, nrm = 0;
      for (let o = 0; o < oct; o++) {
        const per = base << o, lat = lats[o];
        const fx0 = (x / S) * per, fy0 = (y / S) * per;
        const xi = Math.floor(fx0), yi = Math.floor(fy0);
        let fx = fx0 - xi, fy = fy0 - yi;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const x0 = xi % per, y0 = yi % per, x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
        const a = lat[y0 * per + x0], b = lat[y0 * per + x1], c = lat[y1 * per + x0], d = lat[y1 * per + x1];
        v += ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) * amp;
        nrm += amp; amp *= 0.5;
      }
      v /= nrm; out[y * S + x] = v;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / Math.max(1e-6, hi - lo);
    return out;
  }
  const R = field(4, 4), G = field(5, 4);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = R[i] * 255; data[i * 4 + 1] = G[i] * 255; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function makePuffs(env) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 3), 3);
  // aA: birth, life, size0, size1
  const aA = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 4), 4);
  // aB: velocity xyz (m/s, decays), fireLife (s of hot phase; 0 = pure smoke)
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 4), 4);
  // aC: seed, smoke shade, fire tint mix (0 warm..1 cyan arc), opacity
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 4), 4);
  // aG: ground height under the puff — the fragment fades toward it, which is
  // the cheap stand-in for soft particles (no depth texture exists to read):
  // without it a puff meets the street in a hard straight line.
  const aG = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N), 1);
  for (const a of [aPos, aA, aB, aC, aG]) a.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < PUFF_N; i++) aA.array[i * 4] = -1e6; // all dead
  geo.setAttribute("aPos", aPos);
  geo.setAttribute("aA", aA);
  geo.setAttribute("aB", aB);
  geo.setAttribute("aC", aC);
  geo.setAttribute("aG", aG);
  geo.instanceCount = PUFF_N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    fog: false,
    uniforms: { uNow: { value: 0 }, uNoise: { value: puffNoiseTexture() } },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec4 aA; attribute vec4 aB; attribute vec4 aC;
      attribute float aG;
      uniform float uNow;
      varying vec2 vUv; varying float vAge; varying float vLife; varying float vFire;
      varying vec4 vC; varying vec3 vUpV; varying float vAboveG;
      void main() {
        float age = uNow - aA.x;
        float life = aA.y;
        vAge = age; vLife = life; vFire = aB.w; vC = aC; vUv = uv;
        if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float u = age / life;
        // growth: fast initial expansion, slow billow afterwards
        float grow = 1.0 - exp(-age * 5.0);
        float size = mix(aA.z, aA.w, grow * 0.55 + u * 0.45);
        // motion: initial velocity damps out, buoyancy keeps lifting smoke
        vec3 disp = aB.xyz * (1.0 - exp(-age * 2.2)) / 2.2 + vec3(0.0, 0.55, 0.0) * age * age * 0.25
                  + vec3(-0.35, 0.0, 0.10) * age; // the storm's wind
        vec3 c = aPos + disp;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        // slow roll per puff so stacked puffs do not share one noise frame
        float rot = aC.x * 6.2831 + age * (aC.x - 0.5) * 0.6;
        vec2 q = (position.xy) * size;
        q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * q;
        mv.xy += q;
        vAboveG = (inverse(viewMatrix) * mv).y - aG;
        vUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        // un-rotate "up" into the puff's own frame for the lighting term
        vUpV.xy = mat2(cos(-rot), -sin(-rot), sin(-rot), cos(-rot)) * vUpV.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform float uNow;
      varying vec2 vUv; varying float vAge; varying float vLife; varying float vFire;
      varying vec4 vC; varying vec3 vUpV; varying float vAboveG;
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float u = clamp(vAge / vLife, 0.0, 1.0);
        vec2 s = vec2(vC.x * 7.13, vC.x * 3.71);
        float n1 = texture2D(uNoise, vUv * 0.55 + s + vec2(0.0, -vAge * 0.10)).r;
        float n2 = texture2D(uNoise, vUv * 1.15 + s.yx - vec2(vAge * 0.07, vAge * 0.05)).g;
        float n = n1 * 0.62 + n2 * 0.38;
        // eroded sphere: the noise pushes the silhouette in and out
        float edge = sqrt(r2) + (n - 0.5) * 0.85;
        float dens = smoothstep(1.0, 0.45, edge);
        if (dens < 0.004) discard;
        vec3 N = vec3(q, sqrt(max(0.0, 1.0 - r2)));
        N = normalize(N + vec3((n1 - 0.5) * 0.9, (n2 - 0.5) * 0.9, 0.0));
        float up = clamp(dot(N, vUpV) * 0.5 + 0.5, 0.0, 1.0);

        // ---- fire: temperature falls with age and toward the puff's rim
        float hot = vFire > 0.0 ? clamp(1.0 - vAge / vFire, 0.0, 1.0) : 0.0;
        float core = smoothstep(0.95, 0.15, edge) * (0.45 + 1.0 * n);
        float T = clamp(hot * hot * core * 1.30, 0.0, 1.0);
        vec3 warmRamp = mix(vec3(0.90, 0.16, 0.03), vec3(3.2, 1.25, 0.32), smoothstep(0.10, 0.55, T));
        warmRamp = mix(warmRamp, vec3(7.0, 5.2, 3.0), smoothstep(0.62, 1.0, T));
        vec3 arcRamp = mix(vec3(0.3, 0.9, 1.6), vec3(4.0, 6.0, 7.5), smoothstep(0.4, 1.0, T));
        vec3 fire = mix(warmRamp, arcRamp, vC.z) * T * 2.4;

        // ---- smoke: soot lit from above (sky + street), from inside by the
        // embers while the fire is still alive
        vec3 soot = vec3(0.020, 0.019, 0.018) * vC.y;
        vec3 sky = vec3(0.030, 0.034, 0.044) * vC.y;
        vec3 smoke = mix(soot, sky, up * up);
        float glow = hot * (1.0 - T) * (0.6 + 0.4 * (1.0 - up));
        smoke += mix(vec3(1.0, 0.36, 0.09), vec3(0.4, 0.8, 1.2), vC.z) * glow * 0.35;

        float fadeIn = smoothstep(0.0, 0.06, vAge);
        float fadeOut = 1.0 - smoothstep(0.55, 1.0, u);
        float ground = smoothstep(0.0, 0.9, vAboveG);
        // density carries the noise too, so a bank has thin and thick parts
        // instead of one even grey
        float a = dens * (0.55 + 0.75 * n) * vC.w * fadeIn * fadeOut * ground;
        dens *= ground;
        // hot gas emits more than it blocks
        float aSmoke = a * (1.0 - 0.75 * T);
        gl_FragColor = vec4(smoke * aSmoke + fire * dens * fadeIn, aSmoke);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 22;
  mesh.name = "fx.explPuffs";
  env.root.add(mesh);

  let cursor = 0;
  let dirty = false;
  return {
    mesh,
    // x,y,z; vx,vy,vz; life; size0,size1; fireLife; shade; arc; opacity
    spawn(x, y, z, vx, vy, vz, life, s0, s1, fireLife, shade, arc, opacity, seed, delay = 0) {
      const i = cursor; cursor = (cursor + 1) % PUFF_N;
      aPos.array[i * 3] = x; aPos.array[i * 3 + 1] = y; aPos.array[i * 3 + 2] = z;
      aA.array[i * 4] = env.now() + delay; aA.array[i * 4 + 1] = life;
      aA.array[i * 4 + 2] = s0; aA.array[i * 4 + 3] = s1;
      aB.array[i * 4] = vx; aB.array[i * 4 + 1] = vy; aB.array[i * 4 + 2] = vz; aB.array[i * 4 + 3] = fireLife;
      aC.array[i * 4] = seed; aC.array[i * 4 + 1] = shade; aC.array[i * 4 + 2] = arc; aC.array[i * 4 + 3] = opacity;
      aG.array[i] = env.groundY(x, z);
      dirty = true;
    },
    update() {
      mat.uniforms.uNow.value = env.now();
      if (dirty) {
        aPos.needsUpdate = true; aA.needsUpdate = true; aB.needsUpdate = true; aC.needsUpdate = true;
        aG.needsUpdate = true;
        dirty = false;
      }
    },
    clear() {
      for (let i = 0; i < PUFF_N; i++) aA.array[i * 4] = -1e6;
      aA.needsUpdate = true;
    },
  };
}

export function makeExplosions(env, pools, decals) {
  const flash = makeBillboardPool(env, FLASH_N, flashTexture(), 24, "fx.explFlash");
  const puffs = makePuffs(env);
  const ring = makeBillboardPool(env, RING_N, ringTexture(), 21, "fx.explRing");
  const rnd = env.rng;

  // flash state
  const fPos = new Float32Array(FLASH_N * 3);
  const fBirth = new Float32Array(FLASH_N);
  const fSize = new Float32Array(FLASH_N);
  const fCol = new Float32Array(FLASH_N * 3);
  const fRoll = new Float32Array(FLASH_N);
  const fAlive = new Uint8Array(FLASH_N);
  let fCursor = 0;
  const FLASH_LIFE = 0.12;

  // ring state (ground shockwave)
  const rPos = new Float32Array(RING_N * 3);
  const rBirth = new Float32Array(RING_N);
  const rSize = new Float32Array(RING_N); // final radius (m)
  const rCol = new Float32Array(RING_N * 3);
  const rAlive = new Uint8Array(RING_N);
  let rCursor = 0;
  const RING_LIFE = 0.45;

  // the ONE explosion light (R3: 4th dynamic pool slot)
  const L = { slot: null, x: 0, y: 0, z: 0, t0: 0, peak: 0, color: 0xffb066, radius: 20 };
  const _lp = [0, 0, 0];
  let count = 0;

  function releaseLight() {
    if (!L.slot) return;
    _lp[0] = L.x; _lp[1] = L.y; _lp[2] = L.z;
    try { L.slot.set(_lp, L.color, 0, L.radius); } catch (e) { /* tolerant */ }
    try { L.slot.release(); } catch (e) { /* tolerant */ }
    L.slot = null;
  }

  function grantLight(x, y, z, v) {
    if (L.slot) releaseLight(); // a newer blast owns the one slot
    const api = env.lights();
    if (!api || !api.dynamicFree || api.dynamicFree() <= 0) return;
    const slot = api.lease && api.lease("point");
    if (!slot) return;
    L.slot = slot;
    L.x = x; L.y = y; L.z = z;
    L.t0 = env.now();
    L.peak = v.peak;
    L.color = v.light;
    L.radius = v.lightR;
  }

  return {
    // pos:[3], radius (m, sim's damage radius), source per R13
    spawn(pos, radius, source, yaw) {
      const v = VARIANTS[source] || VARIANTS.grenade;
      // directional variants (tripmine): forward = [-sin yaw, -cos yaw] (sim convention)
      const D = v.directional && typeof yaw === "number" ? v.directional : null;
      const fwx = D ? -Math.sin(yaw) : 0, fwz = D ? -Math.cos(yaw) : 0;
      const x = pos[0], y = pos[1], z = pos[2];
      const gy = env.groundY(x, z);
      const nearGround = y - gy < 2.0;
      count++;

      // flash sprite
      {
        const i = fCursor; fCursor = (fCursor + 1) % FLASH_N;
        fAlive[i] = 1;
        const i3 = i * 3;
        fPos[i3] = x; fPos[i3 + 1] = y + 0.4; fPos[i3 + 2] = z;
        fBirth[i] = env.now();
        fSize[i] = radius * v.flashScaleR;
        fCol[i3] = v.flash[0]; fCol[i3 + 1] = v.flash[1]; fCol[i3 + 2] = v.flash[2];
        fRoll[i] = rnd() * Math.PI * 2;
      }

      // ground shockwave ring
      if (nearGround) {
        const i = rCursor; rCursor = (rCursor + 1) % RING_N;
        rAlive[i] = 1;
        const i3 = i * 3;
        rPos[i3] = x; rPos[i3 + 1] = gy + 0.06; rPos[i3 + 2] = z;
        rBirth[i] = env.now();
        rSize[i] = radius * 1.7;
        rCol[i3] = v.ring[0]; rCol[i3 + 1] = v.ring[1]; rCol[i3 + 2] = v.ring[2];
      }

      // light pulse (the one explosion slot; sprite-only if pool is dry)
      grantLight(x, y + 0.5, z, v);

      // ---- VOLUME (lane_env): fireball puffs that cool into smoke, then a
      // slower smoke mass that rolls up and drifts downwind (see makePuffs)
      {
        const base = nearGround ? gy : y;
        const R = Math.max(2.5, radius);
        for (let i = 0; i < (v.puffFire || 0); i++) {
          // directional: the fan spreads ±fanDeg about the facing and runs further
          const a = D ? Math.atan2(fwz, fwx) + (rnd() * 2 - 1) * D.fanDeg * Math.PI / 180 : rnd() * Math.PI * 2;
          const out = D ? 3.5 + rnd() * 4.0 : 1.2 + rnd() * 2.8;
          const s0 = R * (0.22 + rnd() * 0.10);
          puffs.spawn(
            x + Math.cos(a) * R * 0.08, base + s0 * 0.55 + rnd() * 0.5, z + Math.sin(a) * R * 0.08,
            Math.cos(a) * out, 1.4 + rnd() * 2.2, Math.sin(a) * out,
            2.4 + rnd() * 1.0, s0, R * (0.62 + rnd() * 0.22),
            v.fireLife * (0.75 + rnd() * 0.5), v.puffShade || 1.0, v.arc || 0, 0.80, rnd(), rnd() * 0.04);
        }
        for (let i = 0; i < (v.puffSmoke || 0); i++) {
          const a = D ? Math.atan2(fwz, fwx) + (rnd() * 2 - 1) * D.fanDeg * Math.PI / 180 : rnd() * Math.PI * 2;
          const rr = D ? R * (0.15 + rnd() * 0.45) : rnd() * R * 0.35;
          const s0 = R * (0.30 + rnd() * 0.12);
          puffs.spawn(
            x + Math.cos(a) * rr, base + s0 * 0.5 + 0.3 + rnd() * 1.0, z + Math.sin(a) * rr,
            Math.cos(a) * 0.9, 0.7 + rnd() * 1.0, Math.sin(a) * 0.9,
            4.5 + rnd() * 2.5, s0, R * (0.95 + rnd() * 0.35),
            v.arc ? 0 : 0.22, (v.puffShade || 1.0) * (0.8 + rnd() * 0.4), v.arc || 0, 0.62, rnd(), 0.05 + rnd() * 0.18);
        }
      }

      // smoke: slow dark risers that hang and drift (D6 "smoke hangs")
      pools && pools.dust && (() => {
        for (let i = 0; i < v.smoke; i++) {
          const a = rnd() * Math.PI * 2;
          const rr = rnd() * radius * 0.35;
          pools.dust.spawn(
            x + Math.cos(a) * rr, y + 0.3 + rnd() * 0.6, z + Math.sin(a) * rr,
            (rnd() - 0.5) * 0.8, 0.9 + rnd() * 0.9, (rnd() - 0.5) * 0.8,
            2.2 + rnd() * 1.4, 0.5, 2.3,
            v.smokeC[0], v.smokeC[1], v.smokeC[2],
            0.42, -0.05, 0, gy, 0.55);
        }
      })();

      // smoke COLUMN (streak): fast risers that stack into a pillar over the strike
      if (v.column && pools && pools.dust) {
        for (let i = 0; i < v.column; i++) {
          const a = rnd() * Math.PI * 2;
          const rr = rnd() * radius * 0.18;
          pools.dust.spawn(
            x + Math.cos(a) * rr, y + 0.5 + rnd() * 1.2, z + Math.sin(a) * rr,
            (rnd() - 0.5) * 0.6, 2.6 + rnd() * 2.4, (rnd() - 0.5) * 0.6,
            3.6 + rnd() * 1.8, 1.2, 4.2,
            v.smokeC[0] * 0.9, v.smokeC[1] * 0.9, v.smokeC[2] * 0.9,
            0.5, -0.12, 0, gy, 0.7);
        }
      }

      // debris: dark chunks, ballistic, bounce
      if (env.impacts) {
        env.impacts.burstAt(pools.dust, pos, _UP, v.debris, 3.5, 8.5, 2.5,
          1.0, 0.5, 0.04, 0.07, 0.15, 0.14, 0.13, 0.3, 0.95, -12, 0.3, 0.3);
        // embers / arc sparks (HDR — they glow in the rain)
        env.impacts.burstAt(pools.spark, pos, _UP, v.embers, 2.5, 7.0, 2.2,
          0.55, 0.3, 0.016, 0.028, v.emberC[0], v.emberC[1], v.emberC[2],
          0.25, 1.0, -7, 0.4, 0.4);
        // short-lived fireball cores (grenade/drum only)
        if (v.fireballs > 0) {
          env.impacts.burstAt(pools.spark, pos, _UP, v.fireballs, 0.6, 1.6, 0.6,
            v.fbLife || 0.22, 0.08, 0.5, v.fbSize || 1.1, 2.4, 1.1, 0.35, 0.2, 0.9, 1.5, 0, 1.0);
        }
        // directional pellet spray: fast hot streaks fanned along the facing,
        // slightly lofted, low gravity — reads as the 60° kill cone
        if (D) {
          const n = 5;
          for (let k = 0; k < n; k++) {
            const a = Math.atan2(fwz, fwx) + ((k + 0.5) / n * 2 - 1) * D.fanDeg * Math.PI / 180;
            _dirScratch[0] = Math.cos(a); _dirScratch[1] = 0.08; _dirScratch[2] = Math.sin(a);
            env.impacts.burstAt(pools.spark, pos, _dirScratch, Math.ceil(D.spray / n), D.spMin, D.spMax, 1.1,
              0.22, 0.08, 0.012, 0.022, 3.0, 1.9, 0.8, 0.2, 1.0, -3, 0.2, 0.2);
          }
          _dirScratch[0] = fwx; _dirScratch[1] = 0.25; _dirScratch[2] = fwz;
          env.impacts.burstAt(pools.dust, pos, _dirScratch, 6, 4.0, 8.0, 1.6,
            0.9, 0.3, 0.04, 0.07, 0.15, 0.14, 0.13, 0.3, 0.95, -12, 0.3, 0.3);
        }
      }

      // scorch decal on the ground under the blast
      if (nearGround && decals) {
        _lp[0] = x; _lp[1] = gy; _lp[2] = z; // reuse scratch as pos
        decals.spawn(_lp, _UP, 1, radius * (0.42 + rnd() * 0.12));
      }
    },

    update() {
      const now = env.now();
      puffs.update();
      // flashes: camera-billboard, fast expand, color → black
      let touched = false;
      const camQ = env.cam.quaternion;
      for (let i = 0; i < FLASH_N; i++) {
        if (!fAlive[i]) continue;
        const u = (now - fBirth[i]) / FLASH_LIFE;
        const i3 = i * 3;
        if (u >= 1) {
          fAlive[i] = 0;
          _m.makeScale(0, 0, 0);
          flash.mesh.setMatrixAt(i, _m);
          touched = true;
          continue;
        }
        _qr.setFromAxisAngle(_ZAXIS, fRoll[i]);
        _q.copy(camQ).multiply(_qr);
        const s = fSize[i] * (0.55 + 0.65 * u);
        _p.set(fPos[i3], fPos[i3 + 1], fPos[i3 + 2]);
        _s.set(s, s, 1);
        _m.compose(_p, _q, _s);
        flash.mesh.setMatrixAt(i, _m);
        const k = 1 - u * u;
        _c.setRGB(fCol[i3] * k, fCol[i3 + 1] * k, fCol[i3 + 2] * k);
        flash.mesh.setColorAt(i, _c);
        touched = true;
      }
      if (touched) {
        flash.mesh.instanceMatrix.needsUpdate = true;
        if (flash.mesh.instanceColor) flash.mesh.instanceColor.needsUpdate = true;
      }

      // rings: flat on the ground, expand + fade
      touched = false;
      for (let i = 0; i < RING_N; i++) {
        if (!rAlive[i]) continue;
        const u = (now - rBirth[i]) / RING_LIFE;
        const i3 = i * 3;
        if (u >= 1) {
          rAlive[i] = 0;
          _m.makeScale(0, 0, 0);
          ring.mesh.setMatrixAt(i, _m);
          touched = true;
          continue;
        }
        _q.setFromAxisAngle(_X, -Math.PI / 2);
        const s = Math.max(0.2, rSize[i] * u);
        _p.set(rPos[i3], rPos[i3 + 1], rPos[i3 + 2]);
        _s.set(s, s, 1);
        _m.compose(_p, _q, _s);
        ring.mesh.setMatrixAt(i, _m);
        const k = 1 - u;
        _c.setRGB(rCol[i3] * k, rCol[i3 + 1] * k, rCol[i3 + 2] * k);
        ring.mesh.setColorAt(i, _c);
        touched = true;
      }
      if (touched) {
        ring.mesh.instanceMatrix.needsUpdate = true;
        if (ring.mesh.instanceColor) ring.mesh.instanceColor.needsUpdate = true;
      }

      // light pulse
      if (L.slot) {
        const u = (now - L.t0) / LIGHT_DUR_S;
        if (u >= 1) releaseLight();
        else {
          _lp[0] = L.x; _lp[1] = L.y; _lp[2] = L.z;
          const inten = L.peak * Math.sin(Math.PI * Math.min(1, u));
          try { L.slot.set(_lp, L.color, inten, L.radius); }
          catch (e) { releaseLight(); }
        }
      }
    },

    clear() {
      for (let i = 0; i < FLASH_N; i++) {
        fAlive[i] = 0;
        _m.makeScale(0, 0, 0);
        flash.mesh.setMatrixAt(i, _m);
      }
      for (let i = 0; i < RING_N; i++) {
        rAlive[i] = 0;
        _m.makeScale(0, 0, 0);
        ring.mesh.setMatrixAt(i, _m);
      }
      flash.mesh.instanceMatrix.needsUpdate = true;
      ring.mesh.instanceMatrix.needsUpdate = true;
      puffs.clear();
      releaseLight();
    },
    prewarmables() { return [flash.mesh, ring.mesh, puffs.mesh]; },
    stats: () => ({ count, lightHeld: !!L.slot }),
  };
}
