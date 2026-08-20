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
    flash: [3.0, 2.1, 1.15], flashScaleR: 1.25,
    light: 0xffb066, peak: 60, lightR: 20,
    ring: [2.4, 1.6, 0.9],
    smoke: 7, smokeC: [0.13, 0.125, 0.12],
    debris: 12, embers: 8, emberC: [2.5, 1.2, 0.4],
    fireballs: 3,
  },
  drum: {
    flash: [3.2, 1.7, 0.7], flashScaleR: 1.45,
    light: 0xff8a3d, peak: 70, lightR: 26,
    ring: [2.6, 1.3, 0.6],
    smoke: 11, smokeC: [0.09, 0.085, 0.08],
    debris: 14, embers: 16, emberC: [2.6, 1.1, 0.3],
    fireballs: 5,
  },
  transformer: {
    flash: [2.0, 2.8, 3.2], flashScaleR: 1.1,
    light: 0x7fe8ff, peak: 50, lightR: 18,
    ring: [0.9, 2.2, 2.4],
    smoke: 3, smokeC: [0.16, 0.17, 0.18],
    debris: 6, embers: 24, emberC: [1.6, 2.3, 3.0],
    fireballs: 0,
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

export function makeExplosions(env, pools, decals) {
  const flash = makeBillboardPool(env, FLASH_N, flashTexture(), 24, "fx.explFlash");
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
    spawn(pos, radius, source) {
      const v = VARIANTS[source] || VARIANTS.grenade;
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
            0.22, 0.08, 0.5, 1.1, 2.4, 1.1, 0.35, 0.2, 0.9, 1.5, 0, 1.0);
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
      releaseLight();
    },
    prewarmables() { return [flash.mesh, ring.mesh]; },
    stats: () => ({ count, lightHeld: !!L.slot }),
  };
}
