// core/fx/equipment_fx.js — what the player SEES (and, through sfx.onEquip,
// HEARS) of the tactical / lethal equipment in core/sim/equipment.js.
// Pure view layer: reads sim.internal.equip + sim.state.smokes + the player's
// flash/stun status, never writes the sim. The one input it writes is the
// view-side concussion look multiplier (input.lookMult), because the sim takes
// the human's yaw straight from cmd.
//
//   canisters   pooled cans tumbling along the sim arc (flash / smoke / stun)
//   tripmines   pooled curved mines + two faint trigger-cone lasers + a status
//               LED (blinking while arming, steady armed, fast on trip)
//   smoke       ONE instanced billboard draw for every cloud (<= 240 puffs),
//               shaded per pixel from the scene's own sun + hemisphere colours
//               (a sphere normal per puff: lit tops, darker bellies), fogged,
//               sorted back-to-front each frame. No lights added, no light
//               counts changed; every material is compiled at boot through
//               prewarmables().
//   bursts      flash / stun pop: a short additive sprite + a small dust puff
//   overlays    #eq-flash whiteout (flashLevel), #eq-stun vignette + camera
//               sway (stunLevel), #eq-veil grey veil while the camera is INSIDE
//               a cloud (honest blocking from within), #eq-tac the tactical
//               count chip under the ammo block (self-contained, no hud.js)
//
// Boot wiring (runtime/boot.js, additive): createEquipmentFx(ctx, {audio, input}),
// attach(bridge) in attachAll, update(dt) in viewUpdates, prewarmables() in the
// prewarm list.

import * as THREE from "three";
import { flashLevel, stunLevel, stunTurnMult, smokeDepthAt, EQUIP } from "../sim/equipment.js";
import { EQUIPMENT_NAMES } from "../sim/classes.js";

const CAN_POOL = 12;
const MINE_POOL = 16;
const MAX_PUFFS = 300;
const CLOUD_PUFFS = 40;
const BURST_PUFFS = 7;
const FLASH_POOL = 4;

function softTex(size, stops) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2 - 1);
  for (const [o, c] of stops) r.addColorStop(o, c);
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// lumpy puff density map (R channel): a few overlapping soft blobs + grain,
// generated once with a fixed seed (no asset, deterministic look)
function puffTex() {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, S, S);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * S * 0.3;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const rr = S * (0.06 + rnd() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    const k = 0.08 + rnd() * 0.12;
    gr.addColorStop(0, `rgba(255,255,255,${k})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const SMOKE_VS = `
attribute vec3 iPos;
attribute vec4 iData;   // x size (m), y alpha, z seed, w rotation
attribute float iGround; // ground height under the puff (soft contact, no hard cut)
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamPos;
varying vec2 vUv;
varying float vAlpha;
varying float vRot;
varying float vLift;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  // a puff the camera is inside (or nearly) fades out and is then culled to
  // nothing: from INSIDE a cloud the screen-space veil (#eq-veil) carries the
  // blocking, and those near puffs would be the whole fill-rate bill
  float near = smoothstep(iData.x * 0.3, iData.x * 0.7, distance(iPos, uCamPos));
  vAlpha = iData.y * near;
  vRot = iData.w;
  if (vAlpha <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 wp = iPos + (uCamRight * position.x + uCamUp * position.y) * iData.x;
  vLift = wp.y - iGround;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SMOKE_FS = `
uniform sampler2D uTex;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec3 uAlbedo;
varying vec2 vUv;
varying float vAlpha;
varying float vRot;
varying float vLift;
#include <fog_pars_fragment>
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 >= 1.0 || vAlpha <= 0.002) discard;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * 0.5 + 0.5;
  float dens = texture2D(uTex, q).r;
  float edge = 1.0 - smoothstep(0.25, 1.0, sqrt(r2));
  float a = clamp(edge * (0.3 + 1.9 * dens), 0.0, 1.0) * vAlpha;
  a *= smoothstep(-0.05, 0.9, vLift); // the cloud settles into the ground instead of cutting on it
  // sphere normal of the puff, world space (facing the camera)
  vec3 nV = vec3(p, sqrt(max(0.0, 1.0 - r2)));
  vec3 n = normalize(uCamRight * nV.x + uCamUp * nV.y - uCamFwd * nV.z);
  float lam = dot(n, uSunDir);
  // multiple scattering flattens the terminator: half the key, wrapped
  float sun = 0.5 * max(0.0, lam) + 0.15 * clamp(lam + 0.6, 0.0, 1.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  // the same Lambert the scene's standard materials get: albedo/pi x irradiance
  vec3 col = uAlbedo * 0.3183099 * (amb + uSunCol * sun) * mix(0.8, 1.05, dens * 2.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function css() {
  return `
#eq-flash{position:fixed;inset:0;z-index:44;pointer-events:none;opacity:0;background:#fffdf6;will-change:opacity;}
#eq-veil{position:fixed;inset:0;z-index:29;pointer-events:none;opacity:0;background:#8d8f8c;will-change:opacity;}
#eq-stun{position:fixed;inset:0;z-index:29;pointer-events:none;opacity:0;will-change:opacity;
  background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 30%,rgba(18,14,10,.55) 72%,rgba(8,6,4,.92) 100%);}
#eq-tac{position:fixed;right:34px;bottom:40px;z-index:31;pointer-events:none;display:none;
  font-family:var(--a10-hud-font,'Oswald','Arial Narrow',system-ui,sans-serif);color:var(--a10-ink,#e8e8e4);
  font-size:10px;letter-spacing:.24em;opacity:.82;align-items:center;justify-content:flex-end;gap:7px;
  text-shadow:0 1px 2px rgba(0,0,0,.6);}
#eq-tac.on{display:flex;}
#eq-tac.empty{opacity:.34;}
#eq-tac .n{font-size:15px;letter-spacing:.02em;font-variant-numeric:tabular-nums;}
#eq-tac .k{font-size:9px;letter-spacing:.14em;opacity:.6;border:1px solid rgba(232,232,228,.35);padding:0 4px;}
#eq-tac .g{display:block;}
body.br-touch #eq-tac{display:none !important;}
`;
}
const TAC_ICON = {
  flash: `<svg class="g" width="10" height="13" viewBox="0 0 10 13" fill="currentColor"><rect x="2" y="0" width="6" height="1.6"/><rect x="1" y="2.2" width="8" height="10.4" rx="1"/><rect x="1" y="5.2" width="8" height="1.2" fill="#000" opacity=".45"/></svg>`,
  stun: `<svg class="g" width="10" height="13" viewBox="0 0 10 13" fill="currentColor"><rect x="2" y="0" width="6" height="1.6"/><rect x="1" y="2.2" width="8" height="10.4" rx="1"/><circle cx="5" cy="7.4" r="2" fill="#000" opacity=".45"/></svg>`,
  smoke: `<svg class="g" width="10" height="13" viewBox="0 0 10 13" fill="currentColor"><rect x="2.5" y="0" width="5" height="1.6"/><rect x="1.5" y="2.2" width="7" height="10.4" rx="2.4"/><rect x="1.5" y="9" width="7" height="1.2" fill="#000" opacity=".45"/></svg>`,
};

export function createEquipmentFx(ctx, deps) {
  const D = deps || {};
  const root = new THREE.Group();
  root.name = "equipment_fx";
  ctx.scene.add(root);
  const warm = new THREE.Group(); // one visible proxy of every material, for prewarm only
  warm.name = "equipment_fx_warm";

  // ------------------------------------------------------------- canisters
  const canG = new THREE.CylinderGeometry(0.032, 0.032, 0.12, 12);
  const capG = new THREE.CylinderGeometry(0.02, 0.026, 0.022, 10);
  const canMat = {
    flash: new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.45, metalness: 0.55 }),
    stun: new THREE.MeshStandardMaterial({ color: 0x4d5330, roughness: 0.6, metalness: 0.25 }),
    smoke: new THREE.MeshStandardMaterial({ color: 0x6b736a, roughness: 0.7, metalness: 0.15 }),
  };
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8c8c86, roughness: 0.35, metalness: 0.8 });
  const cans = [];
  for (let i = 0; i < CAN_POOL; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(canG, canMat.flash);
    const cap = new THREE.Mesh(capG, capMat); cap.position.y = 0.07;
    g.add(body, cap);
    g.visible = false; g.frustumCulled = false;
    root.add(g);
    cans.push({ g, body, spin: 0, ax: new THREE.Vector3(1, 0, 0) });
  }
  for (const k of Object.keys(canMat)) { const m = new THREE.Mesh(canG, canMat[k]); warm.add(m); }
  warm.add(new THREE.Mesh(capG, capMat));

  // ------------------------------------------------------------- tripmines
  const mineMat = new THREE.MeshStandardMaterial({ color: 0x4a5234, roughness: 0.75, metalness: 0.1 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2c26, roughness: 0.5, metalness: 0.6 });
  const halfG = new THREE.BoxGeometry(0.115, 0.13, 0.04);
  const legG = new THREE.BoxGeometry(0.008, 0.09, 0.008);
  const laserLen = EQUIP.CLAYMORE.TRIGGER_R + 0.2;
  const laserG = new THREE.BoxGeometry(0.0045, 0.0045, laserLen);
  laserG.translate(0, 0, -laserLen / 2);
  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2414, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const ledTex = softTex(64, [[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,255,255,.5)"], [1, "rgba(255,255,255,0)"]]);
  const ledMat = new THREE.SpriteMaterial({ map: ledTex, color: 0xff3020, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const halfLaser = (EQUIP.CLAYMORE.TRIGGER_HALF_DEG * 0.45) * Math.PI / 180;
  const mines = [];
  for (let i = 0; i < MINE_POOL; i++) {
    const g = new THREE.Group();
    const l = new THREE.Mesh(halfG, mineMat); l.position.set(-0.055, 0.115, 0.008); l.rotation.y = -0.22;
    const r = new THREE.Mesh(halfG, mineMat); r.position.set(0.055, 0.115, 0.008); r.rotation.y = 0.22;
    const legs = [];
    for (const x of [-0.07, 0.07]) for (const z of [-0.02, 0.03]) {
      const lg = new THREE.Mesh(legG, legMat); lg.position.set(x, 0.035, z); lg.rotation.x = z < 0 ? 0.35 : -0.35; legs.push(lg);
    }
    const lzA = new THREE.Mesh(laserG, laserMat.clone()); lzA.position.set(0, 0.13, -0.02); lzA.rotation.y = halfLaser;
    const lzB = new THREE.Mesh(laserG, lzA.material); lzB.position.set(0, 0.13, -0.02); lzB.rotation.y = -halfLaser;
    const led = new THREE.Sprite(ledMat.clone()); led.position.set(0, 0.19, 0.0); led.scale.setScalar(0.07);
    g.add(l, r, ...legs, lzA, lzB, led);
    g.visible = false;
    root.add(g);
    mines.push({ g, laser: lzA.material, led });
  }
  warm.add(new THREE.Mesh(halfG, mineMat), new THREE.Mesh(legG, legMat), new THREE.Mesh(laserG, laserMat), new THREE.Sprite(ledMat));

  // ------------------------------------------------------------ flash sprites
  const flashTex = softTex(128, [[0, "rgba(255,255,255,1)"], [0.18, "rgba(255,250,235,.85)"], [0.5, "rgba(255,240,210,.25)"], [1, "rgba(255,240,210,0)"]]);
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const flashes = [];
  for (let i = 0; i < FLASH_POOL; i++) {
    const s = new THREE.Sprite(flashMat.clone());
    s.visible = false;
    root.add(s);
    flashes.push({ s, t0: -9, dur: 0.18, size: 6 });
  }
  warm.add(new THREE.Sprite(flashMat));

  // ---------------------------------------------------------------- smoke
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.setAttribute("uv", quad.getAttribute("uv"));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage); iData.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iPos", iPos);
  geo.setAttribute("iData", iData);
  const iGround = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
  iGround.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iGround", iGround);
  geo.instanceCount = 0;
  const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTex: { value: null }, uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
    uSunCol: { value: new THREE.Color(0.9, 0.85, 0.75) }, uSky: { value: new THREE.Color(0.45, 0.5, 0.58) },
    uGround: { value: new THREE.Color(0.18, 0.17, 0.15) }, uAlbedo: { value: new THREE.Color(0.36, 0.365, 0.36) },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) }, uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamFwd: { value: new THREE.Vector3(0, 0, -1) }, uCamPos: { value: new THREE.Vector3() },
  }]);
  uni.uTex.value = puffTex();
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS,
    transparent: true, depthWrite: false, fog: true,
  });
  smokeMat.name = "equip_smoke";
  const smokeMesh = new THREE.Mesh(geo, smokeMat);
  smokeMesh.frustumCulled = false;
  smokeMesh.renderOrder = 2;
  root.add(smokeMesh);
  // prewarm proxy: one transparent puff
  const wGeo = new THREE.InstancedBufferGeometry();
  wGeo.index = quad.index;
  wGeo.setAttribute("position", quad.getAttribute("position"));
  wGeo.setAttribute("uv", quad.getAttribute("uv"));
  wGeo.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
  wGeo.setAttribute("iData", new THREE.InstancedBufferAttribute(new Float32Array([1, 0.003, 0, 0]), 4));
  wGeo.setAttribute("iGround", new THREE.InstancedBufferAttribute(new Float32Array([-5]), 1));
  wGeo.instanceCount = 1;
  warm.add(new THREE.Mesh(wGeo, smokeMat));

  // view-side cloud records: id -> {puffs:[{ox,oy,oz,size,rot,spin,drift,a}], burst}
  const clouds = new Map();
  const bursts = []; // transient dust puffs {pos, t0, life, r, seed}
  function cloudOf(s) {
    let c = clouds.get(s.id);
    if (c) return c;
    const rnd = mulberry(0x5eed ^ (s.id * 2654435761));
    const puffs = [];
    for (let i = 0; i < CLOUD_PUFFS; i++) {
      // inside a squashed sphere, weighted to the core, sitting on the ground
      const a = rnd() * Math.PI * 2, u = rnd() * 2 - 1, rr = Math.cbrt(rnd()) * 0.92;
      const sq = Math.sqrt(1 - u * u);
      puffs.push({
        ox: Math.cos(a) * sq * rr, oy: u * rr * 0.62 - 0.05, oz: Math.sin(a) * sq * rr,
        size: 3.2 + rnd() * 1.6, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.14,
        drift: rnd() * 6.28, a: 0.8 + rnd() * 0.2 - rr * 0.2,
      });
    }
    c = { puffs, seen: true };
    clouds.set(s.id, c);
    return c;
  }

  // ------------------------------------------------------------- overlays
  if (!document.getElementById("eq-style")) {
    const st = document.createElement("style");
    st.id = "eq-style"; st.textContent = css();
    document.head.appendChild(st);
  }
  const mkDiv = (id, html) => { const e = document.createElement("div"); e.id = id; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
  const flashEl = mkDiv("eq-flash");
  const veilEl = mkDiv("eq-veil");
  const stunEl = mkDiv("eq-stun");
  const tacEl = mkDiv("eq-tac");
  let tacKey = "";

  // --------------------------------------------------------------- lights
  let sunL = null, hemiL = null, ambL = null, lightScanT = -1;
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  function scanLights() {
    sunL = hemiL = ambL = null;
    ctx.scene.traverse((o) => {
      if (!o.isLight || !o.visible) return;
      if (o.isDirectionalLight && (!sunL || o.intensity > sunL.intensity)) sunL = o;
      else if (o.isHemisphereLight && !hemiL) hemiL = o;
      else if (o.isAmbientLight && !ambL) ambL = o;
    });
  }
  function syncLighting() {
    if (!sunL || !sunL.parent) scanLights();
    const U = smokeMat.uniforms;
    if (sunL) {
      _v.setFromMatrixPosition(sunL.matrixWorld);
      _v2.setFromMatrixPosition(sunL.target.matrixWorld);
      U.uSunDir.value.copy(_v).sub(_v2).normalize();
      U.uSunCol.value.copy(sunL.color).multiplyScalar(sunL.intensity);
    }
    if (hemiL) {
      U.uSky.value.copy(hemiL.color).multiplyScalar(hemiL.intensity);
      U.uGround.value.copy(hemiL.groundColor).multiplyScalar(hemiL.intensity);
    } else if (ambL) {
      U.uSky.value.copy(ambL.color).multiplyScalar(ambL.intensity);
      U.uGround.value.copy(U.uSky.value).multiplyScalar(0.5);
    }
  }

  // --------------------------------------------------------------- events
  function popFx(d) {
    if (!d || !d.pos) return;
    const s = ctx.sim && ctx.sim();
    const t = s ? s.state.time : 0;
    if (d.kind === "flash" || d.kind === "stun") {
      const f = flashes.find((x) => t - x.t0 > x.dur) || flashes[0];
      f.t0 = t; f.dur = d.kind === "flash" ? 0.2 : 0.14; f.size = d.kind === "flash" ? 7 : 3.2;
      f.s.material.color.setHex(d.kind === "flash" ? 0xffffff : 0xffb070);
      f.s.position.set(d.pos[0], d.pos[1] + 0.25, d.pos[2]);
      bursts.push({ pos: d.pos.slice(), t0: t, life: d.kind === "stun" ? 1.8 : 1.3, r: d.kind === "stun" ? 1.4 : 0.9, seed: (d.id | 0) * 7 + 1 });
      if (bursts.length > 8) bursts.shift();
    }
  }
  function onEquip(d) {
    if (!d) return;
    try { if (d.phase === "pop") popFx(d); } catch (e) { /* view must not break */ }
    try {
      const a = D.audio || (window.__FPS__ && window.__FPS__.audio);
      const sfx = a && a.sfx;
      if (sfx && sfx.onEquip) sfx.onEquip(d);
    } catch (e) { /* audio must not break the view */ }
  }

  // --------------------------------------------------------------- update
  const order = new Array(MAX_PUFFS);
  const dist = new Float32Array(MAX_PUFFS);
  const tmpP = new Float32Array(MAX_PUFFS * 3);
  const tmpD = new Float32Array(MAX_PUFFS * 4);
  const tmpG = new Float32Array(MAX_PUFFS);
  let lastSim = null;
  const camPos = new THREE.Vector3();
  const stats = { puffs: 0, clouds: 0, cans: 0, mines: 0, lastMs: 0 };

  function update(dt) {
    const t0 = performance.now();
    const s = ctx.sim ? ctx.sim() : null;
    if (!s) return;
    if (s !== lastSim) { lastSim = s; clouds.clear(); bursts.length = 0; }
    const t = s.state.time;
    const E = s.internal && s.internal.equip;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    camPos.setFromMatrixPosition(cam.matrixWorld);

    // canisters
    const cl = E ? E.cans : null;
    let nc = 0;
    for (let i = 0; i < CAN_POOL; i++) {
      const v = cans[i], c = cl && cl[i];
      if (!c) { if (v.g.visible) v.g.visible = false; continue; }
      nc++;
      v.g.visible = true;
      v.body.material = canMat[c.kind] || canMat.flash;
      v.g.position.set(c.pos[0], c.pos[1] + (c.landed ? 0.03 : 0), c.pos[2]);
      const sp = Math.hypot(c.vel[0], c.vel[1], c.vel[2]);
      if (sp > 0.3) {
        v.ax.set(c.vel[2], 0, -c.vel[0]).normalize();
        v.spin += sp * dt * 2.4;
        v.g.quaternion.setFromAxisAngle(v.ax, v.spin);
      } else if (c.landed) {
        v.g.rotation.set(Math.PI / 2, (c.id * 1.7) % 6.28, 0); // lying on its side
      }
    }

    // tripmines
    const ml = E ? E.mines : null;
    let nm = 0;
    for (let i = 0; i < MINE_POOL; i++) {
      const v = mines[i], m = ml && ml[i];
      if (!m) { if (v.g.visible) v.g.visible = false; continue; }
      nm++;
      v.g.visible = true;
      v.g.position.set(m.pos[0], m.pos[1], m.pos[2]);
      v.g.rotation.set(0, m.yaw, 0);
      const armed = t >= m.armT, tripped = m.tripT >= 0;
      const blink = tripped ? (Math.sin(t * 60) > 0 ? 1 : 0.2) : armed ? 0.75 : ((t * 4) % 1 < 0.5 ? 1 : 0.15);
      v.led.material.opacity = blink;
      v.laser.opacity = armed ? 0.2 + 0.05 * Math.sin(t * 7 + m.id) : 0.05;
    }

    // flash sprites
    for (const f of flashes) {
      const el = t - f.t0;
      const on = el >= 0 && el < f.dur;
      f.s.visible = on;
      if (on) { const k = 1 - el / f.dur; f.s.material.opacity = k; f.s.scale.setScalar(f.size * (0.6 + 0.4 * k)); }
    }

    // smoke puffs (clouds + bursts) -> sorted instance buffers
    syncLighting();
    const U = smokeMat.uniforms;
    const e = cam.matrixWorld.elements;
    U.uCamRight.value.set(e[0], e[1], e[2]).normalize();
    U.uCamUp.value.set(e[4], e[5], e[6]).normalize();
    U.uCamFwd.value.set(-e[8], -e[9], -e[10]).normalize();
    U.uCamPos.value.copy(camPos);
    const smokes = s.state.smokes || [];
    let n = 0;
    for (const id of clouds.keys()) clouds.get(id).seen = false;
    for (const sm of smokes) {
      const c = cloudOf(sm);
      c.seen = true;
      const age = t - sm.t0;
      const k = Math.min(1, age / EQUIP.SMOKE.BLOOM_S);
      const grow = 0.35 + 0.65 * (1 - (1 - k) * (1 - k));
      const fadeIn = Math.min(1, age / 0.5);
      const R = EQUIP.SMOKE.R;
      for (const p of c.puffs) {
        if (n >= MAX_PUFFS) break;
        const sw = Math.sin(t * 0.23 + p.drift) * 0.35, sw2 = Math.cos(t * 0.19 + p.drift * 1.3) * 0.35;
        let y = sm.pos[1] + p.oy * R * grow + age * 0.035;
        const size = p.size * (0.5 + 0.5 * grow) * (1 + age * 0.012);
        const gnd = sm.ground != null ? sm.ground : sm.pos[1] - EQUIP.SMOKE.LIFT_M;
        const floor = gnd + size * 0.16;
        if (y < floor) y = floor;
        tmpG[n] = gnd;
        tmpP[n * 3] = sm.pos[0] + p.ox * R * grow + sw;
        tmpP[n * 3 + 1] = y;
        tmpP[n * 3 + 2] = sm.pos[2] + p.oz * R * grow + sw2;
        tmpD[n * 4] = size;
        tmpD[n * 4 + 1] = Math.max(0, p.a) * sm.density * fadeIn;
        tmpD[n * 4 + 2] = p.drift;
        tmpD[n * 4 + 3] = p.rot + t * p.spin;
        n++;
      }
    }
    for (const id of [...clouds.keys()]) if (!clouds.get(id).seen) clouds.delete(id);
    for (let bi = bursts.length - 1; bi >= 0; bi--) {
      const b = bursts[bi];
      const el = t - b.t0;
      if (el < 0 || el > b.life) { bursts.splice(bi, 1); continue; }
      const k = el / b.life;
      const rnd = mulberry(b.seed);
      for (let j = 0; j < BURST_PUFFS && n < MAX_PUFFS; j++) {
        const a = rnd() * 6.28, rr = (0.3 + rnd() * 0.7) * b.r * (0.4 + 0.6 * Math.sqrt(k));
        tmpG[n] = b.pos[1] - 0.6;
        tmpP[n * 3] = b.pos[0] + Math.cos(a) * rr;
        tmpP[n * 3 + 1] = b.pos[1] + 0.25 + rnd() * 0.5 + k * 0.6;
        tmpP[n * 3 + 2] = b.pos[2] + Math.sin(a) * rr;
        tmpD[n * 4] = (0.7 + rnd() * 0.6) * (0.6 + k);
        tmpD[n * 4 + 1] = 0.42 * (1 - k) * (1 - k);
        tmpD[n * 4 + 2] = rnd();
        tmpD[n * 4 + 3] = rnd() * 6.28 + k;
        n++;
      }
    }
    // back-to-front
    for (let i = 0; i < n; i++) {
      order[i] = i;
      const dx = tmpP[i * 3] - camPos.x, dy = tmpP[i * 3 + 1] - camPos.y, dz = tmpP[i * 3 + 2] - camPos.z;
      dist[i] = dx * dx + dy * dy + dz * dz;
    }
    const ord = order.slice(0, n).sort((a, b) => dist[b] - dist[a]);
    const P = iPos.array, Dd = iData.array, Gg = iGround.array;
    for (let i = 0; i < n; i++) {
      const j = ord[i];
      Gg[i] = tmpG[j];
      P[i * 3] = tmpP[j * 3]; P[i * 3 + 1] = tmpP[j * 3 + 1]; P[i * 3 + 2] = tmpP[j * 3 + 2];
      Dd[i * 4] = tmpD[j * 4]; Dd[i * 4 + 1] = tmpD[j * 4 + 1]; Dd[i * 4 + 2] = tmpD[j * 4 + 2]; Dd[i * 4 + 3] = tmpD[j * 4 + 3];
    }
    if (n) {
      iPos.clearUpdateRanges(); iData.clearUpdateRanges(); iGround.clearUpdateRanges();
      iPos.addUpdateRange(0, n * 3); iData.addUpdateRange(0, n * 4); iGround.addUpdateRange(0, n);
      iPos.needsUpdate = true; iData.needsUpdate = true; iGround.needsUpdate = true;
    }
    geo.instanceCount = n;
    smokeMesh.visible = n > 0;

    // ---- player overlays
    const p = s.state.player;
    const alive = !!(p && p.alive);
    const fl = alive ? flashLevel(p, t) : 0;
    const st = alive ? stunLevel(p, t) : 0;
    flashEl.style.opacity = fl > 0.003 ? fl.toFixed(3) : "0";
    flashEl.style.backdropFilter = fl > 0.05 ? `blur(${(fl * 10).toFixed(1)}px)` : "";
    stunEl.style.opacity = st > 0.003 ? (st * (0.75 + 0.25 * Math.sin(t * 5.5))).toFixed(3) : "0";
    const veil = alive ? smokeDepthAt(s, [camPos.x, camPos.y, camPos.z]) : 0;
    veilEl.style.opacity = veil > 0.003 ? Math.min(0.92, veil * 0.95).toFixed(3) : "0";
    // concussion: the look slows (input) and the view sways (camera, view-only)
    const inp = D.input || ctx.input;
    if (inp) inp.lookMult = alive ? stunTurnMult(p, t) : 1;
    if (st > 0) {
      cam.rotateZ(Math.sin(t * 1.9) * 0.05 * st);
      cam.rotateX(Math.sin(t * 1.3 + 1) * 0.018 * st);
    }

    // ---- tactical chip (keyboard/pad; touch has its own TAC button)
    const kind = p && p.kit && p.kit.tactical;
    const cnt = p ? p.tactical | 0 : 0;
    const showTac = !!(kind && alive && s.state.phase !== "menu" && inp && inp.enabled);
    const glyph = inp && inp.glyph ? inp.glyph("tactical") : "E";
    const key = showTac ? kind + ":" + cnt + ":" + glyph : "";
    if (key !== tacKey) {
      tacKey = key;
      tacEl.className = showTac ? "on" + (cnt < 1 ? " empty" : "") : "";
      if (showTac) {
        tacEl.innerHTML = `<span class="k">${glyph}</span><span>${EQUIPMENT_NAMES[kind] || kind.toUpperCase()}</span>` +
          (TAC_ICON[kind] || "") + `<span class="n">×${cnt}</span>`;
      }
    }

    stats.puffs = n; stats.clouds = smokes.length; stats.cans = nc; stats.mines = nm;
    stats.lastMs = performance.now() - t0;
  }

  function clear() {
    for (const v of cans) v.g.visible = false;
    for (const v of mines) v.g.visible = false;
    for (const f of flashes) { f.s.visible = false; f.t0 = -9; }
    clouds.clear(); bursts.length = 0; geo.instanceCount = 0; smokeMesh.visible = false;
    flashEl.style.opacity = "0"; stunEl.style.opacity = "0"; veilEl.style.opacity = "0";
    tacKey = ""; tacEl.className = "";
    const inp = D.input || ctx.input;
    if (inp) inp.lookMult = 1;
  }

  const api = {
    attach(bridge) {
      clear();
      bridge.register("equip", onEquip);
      bridge.register("mission:start", () => clear());
    },
    update,
    clear,
    // one visible proxy per material — boot's prewarm draws them, then the
    // prewarm restores them to their parent (none), i.e. out of the scene
    prewarmables() { return [warm]; },
    stats() { return { ...stats }; },
    root,
  };
  // diagnostic seam (the __INPUT__ precedent): probes read stats(); nothing in the game does
  try { globalThis.__BR_EQUIPFX__ = api; } catch (e) { /* non-browser host */ }
  return api;
}
