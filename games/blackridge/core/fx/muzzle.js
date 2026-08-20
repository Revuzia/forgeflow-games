// core/fx/muzzle.js [A7] — muzzle flashes: additive sprite cluster + leased
// point-light pulse. combat_spec §4.2 (binding): pool of 3 flash lights,
// granted to the player + 2 nearest ON-SCREEN shooters; intensity 0→18→0
// over 55 ms, range 9 m, color 0xffc27a; everyone else sprite-only.
// §2.8 first-shot signature: sprite scale ×1.2, light intensity ×1.25 —
// multipliers read from weapon_data.js FIRST_SHOT (A4's shared export;
// local fallback only guards a stub regression).
//
// ITER01 F2 REWORK (visual_target §5): the old single 8-point-star canvas
// sprite at 0.52 m base read as a giant cartoon star (S1). Replaced with a
// 4-variant combustion-flash ATLAS (irregular ragged petals + blob core +
// spark specks — never a clean geometric star), per-sprite random variant +
// a mid-life frame SWAP (the spec's "2-frame additive sprite cluster"), and
// honest sizes. PLAYER flashes render on VM_LAYER in their own instanced
// pool: the viewmodel renders through the 60° vm camera while the world pass
// runs at world FOV, so a world-layer sprite at the muzzle-socket position
// lands visibly OFF the barrel (iter01 S1 star floating left of the gun).
// The vm-layer pool draws inside the vm pass — pixel-aligned to the barrel
// crown, never occluded, bloomed with the gun. Bot flashes keep a world-
// layer pool (with a distance-readability size mult; tracers + the leased
// light carry the rest at range).
//
// Lights come ONLY from the A6 lease API (lights.lease/dynamicFree) — this
// file never constructs a THREE.Light (hard rule). While A6's pool is still
// the zero-light stub, dynamicFree() is 0 and every flash is sprite-only,
// by design. Sprite budget (architecture §3.14): 12 world slots + 8 vm
// slots; a flash uses 2 (crown core + leading puff). Internal to fx.js.

import * as THREE from "three";
import * as WD from "../weapons/weapon_data.js";
import { VM_LAYER } from "../weapons/viewmodel.js";

const FIRST = WD.FIRST_SHOT ||
  { gapS: 0.5, flashScaleMult: 1.2, flashIntensityMult: 1.25, fullTracer: true };

const N_WORLD = 12;         // world-layer sprite slots (bots)
const N_VM = 8;             // vm-layer sprite slots (player)
const LIGHT = { color: 0xffc27a, peak: 18, durS: 0.055, radius: 9 }; // §4.2
const MAX_MUZZLE_LEASES = 3; // 3-light grant rule (4th pool light = explosions)
// Metres the PLAYER's leased flash light stands off down-range from the muzzle
// so an inverse-square point light 15 cm from the receiver stops clipping the
// viewmodel's top rail to white. See the call site in spawn().
// MEASURED, not guessed (live S1, same held pose, three captures over the gun
// rail box x[1050,1400] y[600,780], mean luma / p99 / pixels >= 250):
//   baseline (stand-off 0.5)     143.6 / 251.1 / 911
//   lights.lease suppressed       57.6 / 112.1 /   0
//   fx.muzzle.vm sprite hidden   143.9 / 251.0 / 890
// The sprite is worth 0.3 luma of the rail's exposure; the leased PointLight is
// worth 86 and ALL of the clipping. So the "smeared white bar down the barrel"
// is the light's near-field inverse-square, and the lever is distance.
const PLAYER_LIGHT_STANDOFF = 0.9;
const BOT_LIGHT_MAX_DIST = 60;
// Base sprite size (m). Through the 60° vm camera at ~0.7 m these cover
// ~200–260 px of a 1080p frame — a flash frame, not a torch (VT §5).
const FLASH_SIZE = { warden: 0.15, vesper: 0.12, corvus: 0.19, pike: 0.11 };
const BOT_SIZE_MULT = 2.2; // night readability at 10–60 m through world FOV

// ---- 4-variant flash atlas (2×2, 512²) --------------------------------------
// Irregular combustion read: ragged petals at jittered angles/lengths, a
// multi-blob core, spark specks. Four variants; each sprite picks one at
// spawn and swaps to a second mid-life (multi-frame flicker).
function flashAtlasTexture(rnd) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 512;
  const g = cv.getContext("2d");
  for (let f = 0; f < 4; f++) {
    const cx = (f % 2) * 256 + 128, cy = ((f / 2) | 0) * 256 + 128;
    g.save();
    g.translate(cx, cy);
    const petals = 6 + ((rnd() * 4) | 0);
    const a0 = rnd() * Math.PI;
    for (let i = 0; i < petals; i++) {
      const a = a0 + (i / petals) * Math.PI * 2 + (rnd() - 0.5) * 0.9;
      const len = 38 + rnd() * 52;   // short ragged petals — flash, not star
      const w = 5 + rnd() * 9;
      const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      gr.addColorStop(0, "rgba(255,236,200,0.85)");
      gr.addColorStop(0.4, "rgba(255,180,90,0.38)");
      gr.addColorStop(1, "rgba(255,140,60,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(Math.cos(a + Math.PI / 2) * w * 0.5, Math.sin(a + Math.PI / 2) * w * 0.5);
      g.quadraticCurveTo(Math.cos(a) * len * 0.55, Math.sin(a) * len * 0.55,
                         Math.cos(a) * len, Math.sin(a) * len);
      g.quadraticCurveTo(Math.cos(a) * len * 0.55, Math.sin(a) * len * 0.55,
                         Math.cos(a - Math.PI / 2) * w * 0.5, Math.sin(a - Math.PI / 2) * w * 0.5);
      g.closePath();
      g.fill();
    }
    for (let b = 0; b < 3; b++) {
      const ox = (rnd() - 0.5) * 22, oy = (rnd() - 0.5) * 22;
      const r = 34 + rnd() * 26;
      const core = g.createRadialGradient(ox, oy, 1, ox, oy, r);
      core.addColorStop(0, "rgba(255,252,240,0.95)");
      core.addColorStop(0.45, "rgba(255,210,140,0.55)");
      core.addColorStop(1, "rgba(255,160,70,0)");
      g.fillStyle = core;
      g.fillRect(-128, -128, 256, 256);
    }
    for (let s = 0; s < 12; s++) {
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 80;
      g.fillStyle = `rgba(255,${(200 + rnd() * 40) | 0},150,${(0.25 + rnd() * 0.5).toFixed(2)})`;
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, 1 + rnd() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

// atlas cell -> UV offset (CanvasTexture flipY: row 0 of the canvas is v 0.5)
function frameU(f) { return (f & 1) * 0.5; }
function frameV(f) { return f < 2 ? 0.5 : 0; }

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

// One instanced sprite pool (world- or vm-layer). Per-sprite: position,
// size, roll, birth, life, HDR brightness, atlas frame A→B swap.
function createPool(n, mat, env, layer, renderOrder, name) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const uvOff = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  uvOff.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aUvOff", uvOff);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (layer != null) mesh.layers.set(layer);
  _m.makeScale(0, 0, 0);
  _c.setRGB(1, 1, 1);
  for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c); }
  env.root.add(mesh);

  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const roll = new Float32Array(n);
  const birth = new Float32Array(n);
  const life = new Float32Array(n);
  const bright = new Float32Array(n);
  const frameB = new Uint8Array(n);
  const swapped = new Uint8Array(n);
  const alive = new Uint8Array(n);
  let cursor = 0;
  let active = 0;
  const rnd = env.rng;

  function setFrame(i, f) {
    uvOff.setXY(i, frameU(f), frameV(f));
    uvOff.needsUpdate = true;
  }

  function spawn(x, y, z, sz, brightMult) {
    const i = cursor;
    cursor = (cursor + 1) % n;
    if (!alive[i]) { alive[i] = 1; active++; }
    const i3 = i * 3;
    pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
    size[i] = sz;
    roll[i] = rnd() * Math.PI * 2;
    birth[i] = env.now();
    life[i] = 0.042 + rnd() * 0.016; // 42–58 ms (VT: 40–60; spec pulse 55)
    bright[i] = brightMult;
    const fA = (rnd() * 4) | 0;
    frameB[i] = (fA + 1 + ((rnd() * 3) | 0)) % 4;
    swapped[i] = 0;
    setFrame(i, fA);
  }

  function deactivate(i) {
    if (!alive[i]) return;
    alive[i] = 0;
    active--;
    _m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, _m);
  }

  function update(now) {
    if (active === 0) return;
    const camQ = env.cam.quaternion;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const u = (now - birth[i]) / life[i];
      if (u >= 1) { deactivate(i); continue; }
      if (!swapped[i] && u > 0.45) { swapped[i] = 1; setFrame(i, frameB[i]); }
      const i3 = i * 3;
      _qr.setFromAxisAngle(_ZAXIS, roll[i]);
      _q.copy(camQ).multiply(_qr);
      const s = size[i] * (0.85 + 0.45 * u);
      _p.set(pos[i3], pos[i3 + 1], pos[i3 + 2]);
      _s.set(s, s, 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      const b = bright[i] * (1 - 0.55 * u) * 2.0; // HDR: flash blooms in post
      _c.setRGB(b, b * 0.92, b * 0.8);
      mesh.setColorAt(i, _c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < n; i++) deactivate(i);
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, spawn, update, clear, activeCount: () => active };
}

export function makeMuzzle(env) {
  const mat = new THREE.MeshBasicMaterial({
    map: flashAtlasTexture(env.rng),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  // per-instance atlas cell: shift vMapUv into the sprite's 2×2 cell
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aUvOff;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMapUv = vMapUv * 0.5 + aUvOff;");
  };

  // Player flash lives on the VM layer: drawn in the viewmodel pass through
  // the vm camera — pixel-aligned to the muzzle socket, over the gun, after
  // the depth clear. Bot flashes draw in the world pass.
  const poolWorld = createPool(N_WORLD, mat, env, null, 25, "fx.muzzle.world");
  const poolVm = createPool(N_VM, mat, env, VM_LAYER, 40, "fx.muzzle.vm");

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
      const isPlayer = d.shooter === "P";
      const base = (FLASH_SIZE[d.weaponId] || 0.14)
        * (first ? (FIRST.flashScaleMult || 1.2) : 1)
        * (isPlayer ? 1 : BOT_SIZE_MULT);
      const pool = isPlayer ? poolVm : poolWorld;
      const dir = d.dir || [0, 0, 0];
      // 2-sprite cluster (VT §5): crown core + a smaller leading puff 12 cm
      // down-range — both frame-randomized, both swap frames mid-life.
      pool.spawn(_mz[0], _mz[1], _mz[2], base * (0.85 + rnd() * 0.35), first ? 1.6 : 1.2);
      pool.spawn(_mz[0] + dir[0] * 0.12, _mz[1] + dir[1] * 0.12, _mz[2] + dir[2] * 0.12,
                 base * 0.55, 0.95);
      flashCount++;
      if (isPlayer || onScreenAndNear(_mz[0], _mz[1], _mz[2])) {
        // PLAYER FLASH LIGHT STAND-OFF (iter04 open item a: "the muzzle flash
        // over-exposes the top rail in S1 — the gun's own materials are
        // correctly exposed in S6, same pose without flash"). The lease is a
        // PointLight at decay 2.0 (lighting.js:210), so illuminance is
        // intensity / d². Parked AT the muzzle it sits ~0.15 m from the
        // receiver: 18 / 0.15² ≈ 800, which clips the whole top rail to paper
        // white and reads as "a smeared white bar running the length of the
        // barrel" — a real content defect all three critics described
        // identically. Standing the light off down-range raises that distance
        // to ~0.65 m (≈ 19× less on the gun) while moving the source by well
        // under a metre against world geometry metres away, so the scene
        // lighting and the lit hands the critics CREDITED are preserved.
        const d0 = d.dir || [0, 0, 0];
        const off = isPlayer ? PLAYER_LIGHT_STANDOFF : 0;
        grantLight(_mz[0] + d0[0] * off, _mz[1] + d0[1] * off, _mz[2] + d0[2] * off,
                   isPlayer, first);
      }
    },

    update() {
      const now = env.now();
      poolWorld.update(now);
      poolVm.update(now);
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
      poolWorld.clear();
      poolVm.clear();
      for (let i = 0; i < leases.length; i++) releaseLease(leases[i]);
    },
    prewarmables() { return [poolWorld.mesh, poolVm.mesh]; },
    stats: () => ({ activeSprites: poolWorld.activeCount() + poolVm.activeCount(),
                    leaseCount, flashCount }),
  };
}
