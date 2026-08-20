// core/fx/muzzle.js [A7] — muzzle flashes: additive sprite cluster + leased
// point-light pulse. combat_spec §4.2 (binding): pool of 3 flash lights,
// granted to the player + 2 nearest ON-SCREEN shooters; intensity 0→18→0
// over 55 ms, range 9 m, color 0xffc27a; everyone else sprite-only.
// §2.8 first-shot signature: sprite scale ×1.2, light intensity ×1.25 —
// multipliers read from weapon_data.js FIRST_SHOT (A4's shared export;
// local fallback only guards a stub regression).
//
// Lights come ONLY from the A6 lease API (lights.lease/dynamicFree) — this
// file never constructs a THREE.Light (hard rule). While A6's pool is still
// the zero-light stub, dynamicFree() is 0 and every flash is sprite-only,
// by design. 12 sprite slots (architecture §3.14); a flash uses 2 (star +
// side flare). Internal to fx.js.

import * as THREE from "three";
import * as WD from "../weapons/weapon_data.js";

const FIRST = WD.FIRST_SHOT ||
  { gapS: 0.5, flashScaleMult: 1.2, flashIntensityMult: 1.25, fullTracer: true };

const N = 12;               // sprite slots (frozen pool size)
const LIGHT = { color: 0xffc27a, peak: 18, durS: 0.055, radius: 9 }; // §4.2
const MAX_MUZZLE_LEASES = 3; // 3-light grant rule (4th pool light = explosions)
const BOT_LIGHT_MAX_DIST = 60;
const FLASH_SIZE = { warden: 0.52, vesper: 0.42, corvus: 0.66, pike: 0.36 };

function starTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const spike = (angle, len, w) => {
    g.save();
    g.translate(64, 64);
    g.rotate(angle);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, "rgba(255,244,220,0.95)");
    gr.addColorStop(0.35, "rgba(255,205,130,0.55)");
    gr.addColorStop(1, "rgba(255,170,80,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -w);
    g.lineTo(len, 0);
    g.lineTo(0, w);
    g.closePath();
    g.fill();
    g.restore();
  };
  // 4-point star + short diagonals (the "star + side flare" cluster read)
  spike(0, 62, 7); spike(Math.PI, 62, 7);
  spike(Math.PI / 2, 44, 6); spike(-Math.PI / 2, 44, 6);
  spike(Math.PI / 4, 26, 3.5); spike(-Math.PI / 4, 26, 3.5);
  spike((3 * Math.PI) / 4, 26, 3.5); spike((-3 * Math.PI) / 4, 26, 3.5);
  const core = g.createRadialGradient(64, 64, 1, 64, 64, 18);
  core.addColorStop(0, "rgba(255,255,250,1)");
  core.addColorStop(0.5, "rgba(255,225,170,0.7)");
  core.addColorStop(1, "rgba(255,190,110,0)");
  g.fillStyle = core;
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
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
const _vmMuzzle = new THREE.Vector3();
const _ZAXIS = new THREE.Vector3(0, 0, 1);

export function makeMuzzle(env) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const mat = new THREE.MeshBasicMaterial({
    map: starTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.renderOrder = 25;
  mesh.name = "fx.muzzle";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  _c.setRGB(1, 1, 1);
  for (let i = 0; i < N; i++) { mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c); }
  env.root.add(mesh);

  // sprite state
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const roll = new Float32Array(N);
  const birth = new Float32Array(N);
  const life = new Float32Array(N);
  const bright = new Float32Array(N); // HDR multiplier (blooms in post)
  const alive = new Uint8Array(N);
  let cursor = 0;
  let activeSprites = 0;
  let flashCount = 0;

  // light leases: [{slot, x,y,z, t0, peak}] — fixed-size, preallocated
  const leases = [
    { slot: null, x: 0, y: 0, z: 0, t0: 0, peak: 0, isPlayer: false },
    { slot: null, x: 0, y: 0, z: 0, t0: 0, peak: 0, isPlayer: false },
    { slot: null, x: 0, y: 0, z: 0, t0: 0, peak: 0, isPlayer: false },
  ];
  let leaseCount = 0;
  const rnd = env.rng;
  const _lp = [0, 0, 0]; // scratch pos for slot.set(pos, color, intensity, distance)

  function releaseLease(L) {
    if (!L.slot) return;
    _lp[0] = L.x; _lp[1] = L.y; _lp[2] = L.z;
    try { L.slot.set(_lp, LIGHT.color, 0, LIGHT.radius); } catch (e) { /* slot API tolerant */ }
    try { L.slot.release(); } catch (e) { /* stub slots may lack release */ }
    L.slot = null;
    leaseCount--;
  }

  function grantLight(x, y, z, isPlayer, firstShot) {
    const api = env.lights();
    if (!api || !api.dynamicFree || api.dynamicFree() <= 0) return;
    let L = null;
    for (let i = 0; i < leases.length; i++) {
      if (!leases[i].slot) { L = leases[i]; break; }
    }
    if (!L) {
      if (!isPlayer) return; // pool saturated, bots go sprite-only
      // player priority: steal the oldest bot lease (grant rule — the player
      // is always one of the 3)
      let oldest = null;
      for (let i = 0; i < leases.length; i++) {
        if (leases[i].isPlayer) continue;
        if (!oldest || leases[i].t0 < oldest.t0) oldest = leases[i];
      }
      if (!oldest) return; // all three are the player's own rapid fire
      releaseLease(oldest);
      L = oldest;
    }
    if (leaseCount >= MAX_MUZZLE_LEASES) return;
    const slot = api.lease && api.lease("point");
    if (!slot) return;
    L.slot = slot;
    L.x = x; L.y = y; L.z = z;
    L.t0 = env.now();
    L.peak = LIGHT.peak * (firstShot ? (FIRST.flashIntensityMult || 1.25) : 1);
    L.isPlayer = isPlayer;
    leaseCount++;
  }

  function spawnSprite(x, y, z, sz, brightMult) {
    const i = cursor;
    cursor = (cursor + 1) % N;
    if (!alive[i]) { alive[i] = 1; activeSprites++; }
    const i3 = i * 3;
    pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
    size[i] = sz;
    roll[i] = rnd() * Math.PI * 2;
    birth[i] = env.now();
    life[i] = 0.042 + rnd() * 0.016; // 42–58 ms (VT: 40–60; spec pulse 55)
    bright[i] = brightMult;
  }

  function deactivate(i) {
    if (!alive[i]) return;
    alive[i] = 0;
    activeSprites--;
    _m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, _m);
  }

  function onScreenAndNear(x, y, z) {
    const cam = env.cam;
    _to.set(x, y, z).sub(cam.position);
    const dist = _to.length();
    if (dist > BOT_LIGHT_MAX_DIST) return false;
    cam.getWorldDirection(_fwd);
    return _to.divideScalar(Math.max(1e-6, dist)).dot(_fwd) > 0.15;
  }

  // Player muzzle: prefer the real viewmodel socket (A4's vm.muzzleWorld);
  // validated against the shot origin so the wave-1 stub's zero-vector
  // answer (and any garbage) falls back to the eye-offset heuristic.
  function resolveMuzzle(d, out) {
    const o = d.origin, dir = d.dir;
    if (d.shooter === "P") {
      const F = typeof window !== "undefined" ? window.__FPS__ : null;
      const vm = F && F.vm;
      if (vm && typeof vm.muzzleWorld === "function") {
        try {
          const v = vm.muzzleWorld(_vmMuzzle.set(0, 0, 0));
          if (v && isFinite(v.x)) {
            const dx = v.x - o[0], dy = v.y - o[1], dz = v.z - o[2];
            if (dx * dx + dy * dy + dz * dz < 9) { out[0] = v.x; out[1] = v.y; out[2] = v.z; return; }
          }
        } catch (e) { /* heuristic below */ }
      }
      // barrel-tip heuristic in view space: ahead, a touch right and down
      const rx = -dir[2], rz = dir[0]; // right = dir × up (y terms drop)
      const rl = Math.hypot(rx, rz) || 1;
      out[0] = o[0] + dir[0] * 0.5 + (rx / rl) * 0.1;
      out[1] = o[1] + dir[1] * 0.5 - 0.07;
      out[2] = o[2] + dir[2] * 0.5 + (rz / rl) * 0.1;
      return;
    }
    out[0] = o[0] + dir[0] * 0.6;
    out[1] = o[1] + dir[1] * 0.6;
    out[2] = o[2] + dir[2] * 0.6;
  }

  const _mz = [0, 0, 0];

  return {
    // d = the fire-time shot event (never impactOnly/pen — fx.js gates that)
    spawn(d) {
      resolveMuzzle(d, _mz);
      const first = !!d.firstShot;
      const base = (FLASH_SIZE[d.weaponId] || 0.5) * (first ? (FIRST.flashScaleMult || 1.2) : 1);
      const isPlayer = d.shooter === "P";
      // star + smaller side flare = the 2-sprite cluster (VT §5)
      spawnSprite(_mz[0], _mz[1], _mz[2], base * (0.9 + rnd() * 0.3), first ? 1.5 : 1.15);
      spawnSprite(_mz[0], _mz[1], _mz[2], base * 0.55, 0.9);
      flashCount++;
      if (isPlayer || onScreenAndNear(_mz[0], _mz[1], _mz[2])) {
        grantLight(_mz[0], _mz[1], _mz[2], isPlayer, first);
      }
    },

    update() {
      const now = env.now();
      // sprites: camera-billboarded, pop-in scale, HDR color fade
      if (activeSprites > 0) {
        const camQ = env.cam.quaternion;
        for (let i = 0; i < N; i++) {
          if (!alive[i]) continue;
          const u = (now - birth[i]) / life[i];
          if (u >= 1) { deactivate(i); continue; }
          const i3 = i * 3;
          _qr.setFromAxisAngle(_ZAXIS, roll[i]);
          _q.copy(camQ).multiply(_qr);
          const s = size[i] * (0.85 + 0.45 * u);
          _p.set(pos[i3], pos[i3 + 1], pos[i3 + 2]);
          _s.set(s, s, 1);
          _m.compose(_p, _q, _s);
          mesh.setMatrixAt(i, _m);
          const b = bright[i] * (1 - 0.55 * u) * 2.0; // HDR: flash blooms
          _c.setRGB(b, b * 0.92, b * 0.8);
          mesh.setColorAt(i, _c);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      // light pulses: 0 → peak → 0 over 55 ms (sin envelope), then release
      for (let i = 0; i < leases.length; i++) {
        const L = leases[i];
        if (!L.slot) continue;
        const u = (now - L.t0) / LIGHT.durS;
        if (u >= 1) { releaseLease(L); continue; }
        const inten = L.peak * Math.sin(Math.PI * u);
        _lp[0] = L.x; _lp[1] = L.y; _lp[2] = L.z;
        try { L.slot.set(_lp, LIGHT.color, inten, LIGHT.radius); }
        catch (e) { releaseLease(L); }
      }
    },

    clear() {
      for (let i = 0; i < N; i++) deactivate(i);
      mesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < leases.length; i++) releaseLease(leases[i]);
    },
    prewarmables() { return [mesh]; },
    stats: () => ({ activeSprites, leaseCount, flashCount }),
  };
}
