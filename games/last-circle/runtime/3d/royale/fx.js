/**
 * royale/fx.js — particles, tracers, damage numbers, camera shake.
 *
 * ONE InstancedMesh pool of camera-facing soft quads (single draw call, 1,024 slots)
 * drives every burst: muzzle flash, impacts, explosions, harvest chips, storm sparkles,
 * dust. Tracers are the same pool: a thin quad stretched along the round's flight
 * direction and billboarded around that axis. Damage numbers are DOM elements
 * projected from world space (crisp text, no canvas blur — the shroud-font lesson).
 *
 * WAVE 4 (plan P1.4): the pool used to be 1,024 flat unlit CUBES — a hit drew a
 * coloured box and a tracer a flat yellow stick, which broke the "no primitives as
 * final art" rule. Now: a 2x2 texture atlas (spark star / soft puff / round glow /
 * tracer streak) from assets/fx/*.png (contract C-ART-FX, Kenney Light Masks, CC0), with
 * a procedural canvas fallback for any missing file so there are STILL no cubes; a
 * premultiplied-alpha ShaderMaterial where each instance carries an "additive"
 * fraction (alpha 0 = pure additive, 1 = normal blend), so sparks glow and smoke
 * still darkens in the same single draw. renderOrder 7: above the storm wall (5) and
 * the loot beams / rings (>= 6, contract C-LOOT-RENDER).
 */
import * as THREE from "three";

const N = 1024;
const parts = [];         // {alive, pos, vel, life, life0, size, gravity, drag, dir, dirV, stretch, st, spin, spinV, a0, idx}
let inst = null;
let iAttr = null;         // per-instance vec4: x atlas cell (0 spark, 1 puff, 2 glow, 3 tracer), y alpha, z additive 0..1, w spin (rad)
let atlas = null, atlasCv = null, atlasCtx = null;
const atlasSrc = { spark: "procedural", puff: "procedural", glow: "procedural", tracer: "procedural" };
// Scratch colour for spawn(). This used to be `new THREE.Color(...)` on EVERY
// particle — 49 bots fire through the same global shotFired event, so a busy
// firefight fed the GC a Color per muzzle cube (feel-juice-ui G15).
const _col = new THREE.Color();
const _tdir = new THREE.Vector3();
let dmgLayer = null;

// ── particle styles ──────────────────────────────────────────────────────────
// qs = quad size / "size" (a soft sprite reads smaller than a cube of the same edge, so the
// quad is larger); s1 = size multiplier at the end of life (<1 shrinks, >1 grows);
// add = additive fraction (1 = light, 0 = ordinary alpha, so smoke and dust can DARKEN);
// gain = colour multiplier (HDR; the glare bar: emissives ~3-8x the surface, START LOW).
const ST_FLASH = 0, ST_HALO = 1, ST_SPARK = 2, ST_HOT = 3, ST_CHIP = 4, ST_DUST = 5, ST_SMOKE = 6, ST_TRACER = 7, ST_BRASS = 8, ST_SPLASH = 9, ST_BLOOD = 10, ST_FSPARK = 11;
//                         cell add   a0   s1   gain qs   fadeIn spin
const STYLE_TAB = [
  // FLASH / HALO gains were 1.00 / 0.85: measured 9.47x the surface behind (peak lum 1.95 over 0.13, stormfx_fx run a2-1),
  // over the glare bar's 8x. Halved: the core + halo now add ~0.5 scene-linear luminance at the hottest pixel.
  /* FLASH  */ [0, 1.00, 1.00, 1.50, 0.26, 3.4, 0, 0],   // star 0.48 -> 0.26. The glare check reads the brightest flash pixel against the surface under it. Measured by switching each piece off (peak additive lum ~1.3): 3 sparks ~0.5, star ~0.25, halo ~0.2
  /* HALO   */ [2, 1.00, 0.55, 1.80, 0.34, 3.2, 0, 0],
  /* SPARK  */ [0, 1.00, 1.00, 0.25, 1.00, 2.6, 0, 3],
  /* HOT    */ [2, 1.00, 1.00, 0.30, 1.00, 2.3, 0, 0],
  /* CHIP   */ [2, 0.25, 0.95, 0.35, 1.00, 2.1, 0, 0],
  /* DUST   */ [1, 0.00, 0.42, 2.30, 1.00, 3.4, 1, 1.2],
  /* SMOKE  */ [1, 0.00, 0.60, 2.50, 1.00, 3.2, 1, 0.8],
  /* TRACER */ [3, 1.00, 1.00, 1.00, 1.15, 1.0, 0, 0],
  /* BRASS  */ [2, 0.00, 1.00, 0.60, 1.00, 2.4, 0, 0],
  /* SPLASH */ [2, 0.35, 0.85, 0.50, 1.00, 2.3, 0, 0],
  /* BLOOD  */ [2, 0.00, 0.90, 0.40, 1.00, 2.2, 0, 0],
  /* FSPARK */ [0, 1.00, 1.00, 0.25, 0.30, 2.6, 0, 3],   // the 3 MUZZLE sparks only (same look as SPARK, dimmer): they spawn stacked at the barrel and made up ~0.5 of the flash's ~1.3 peak
];
const sCell = new Float32Array(STYLE_TAB.length), sAdd = new Float32Array(STYLE_TAB.length), sA0 = new Float32Array(STYLE_TAB.length),
  sS1 = new Float32Array(STYLE_TAB.length), sGain = new Float32Array(STYLE_TAB.length), sQs = new Float32Array(STYLE_TAB.length),
  sFadeIn = new Float32Array(STYLE_TAB.length), sSpin = new Float32Array(STYLE_TAB.length);
STYLE_TAB.forEach((r, i) => { sCell[i] = r[0]; sAdd[i] = r[1]; sA0[i] = r[2]; sS1[i] = r[3]; sGain[i] = r[4]; sQs[i] = r[5]; sFadeIn[i] = r[6]; sSpin[i] = r[7]; });

// ── view size (contract C1) ──────────────────────────────────────────────────
// kernel.viewW/viewH are the ResizeObserver-cached CSS size (L3). Until that
// lands, keep our own RO cache: reading canvas.clientWidth every frame forced a
// layout whenever anything in the DOM had changed since the last frame
// (fx.js:564 was one of the two per-frame layout reads the frame lane measured).
let _vw = 0, _vh = 0, _vro = null;
function viewSize(W) {
  const k = W.kernel;
  if (k && k.viewW > 0 && k.viewH > 0) { _vw = k.viewW; _vh = k.viewH; return; }
  if (!_vro) {
    const el = k.renderer.domElement;
    _vw = el.clientWidth || window.innerWidth; _vh = el.clientHeight || window.innerHeight;   // once, at first use
    if (typeof ResizeObserver !== "undefined") {
      _vro = new ResizeObserver((ents) => {
        const r = ents[ents.length - 1].contentRect;
        if (r.width > 0 && r.height > 0) { _vw = r.width; _vh = r.height; }
      });
      _vro.observe(el);
    } else _vro = true;
  }
  if (_vro === true) { const el = k.renderer.domElement; _vw = el.clientWidth; _vh = el.clientHeight; }
}

// ── the atlas: 2 x 2 cells of 128 px, alpha only (RGB white, tinted per instance) ────────────
// Cell c sits at u offset (c % 2) / 2 and v offset floor(c / 2) / 2 (v up). The canvas is uploaded with
// flipY, so texture v = 0 is the BOTTOM canvas row: cell c's canvas rect is x = (c % 2) * CELL,
// y = (1 - floor(c / 2)) * CELL (top edge, canvas y runs down).
const CELL = 128;
const CELL_NAME = ["spark", "puff", "glow", "tracer"];
const cellX = (c) => (c % 2) * CELL;
const cellY = (c) => (1 - Math.floor(c / 2)) * CELL;
function smooth(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

/** The procedural alpha mask of one cell: the fallback for a missing / blocked PNG, and the picture before the PNGs arrive. */
function makeMask(c) {
  const id = atlasCtx.createImageData(CELL, CELL);
  const d = id.data;
  let sd = 0x1234abcd + c * 7919;
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const blobs = [];
  if (c === 1) for (let i = 0; i < 7; i++) { const a = rnd() * 6.2832, r = Math.sqrt(rnd()) * 0.38; blobs.push([Math.cos(a) * r, Math.sin(a) * r, 0.20 + rnd() * 0.16]); }
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      // canvas row y runs DOWN; the texture's v runs UP, so the picture's own "up" is -y
      const u = (x + 0.5 - CELL / 2) / (CELL / 2), v = -(y + 0.5 - CELL / 2) / (CELL / 2);   // -1..1
      const r = Math.hypot(u, v);
      let a = 0;
      if (c === 0) {            // 4-point star: hot core + two thin arms
        const core = Math.exp(-r * r * 16);
        const arm = Math.max(Math.exp(-Math.abs(v) * 20) * Math.pow(Math.max(0, 1 - Math.abs(u)), 2.2), Math.exp(-Math.abs(u) * 20) * Math.pow(Math.max(0, 1 - Math.abs(v)), 2.2));
        a = Math.min(1, core + 0.75 * arm) * (1 - smooth((r - 0.8) / 0.2));
      } else if (c === 1) {     // mottled soft puff
        let sm = 0;
        for (const b of blobs) { const dd = Math.hypot(u - b[0], v - b[1]); sm += Math.exp(-(dd * dd) / (b[2] * b[2])); }
        a = Math.min(1, sm * 0.55) * 0.75 * (1 - smooth((r - 0.62) / 0.38));
      } else if (c === 2) {     // round soft glow
        a = Math.pow(Math.max(0, 1 - r), 2.2);
      } else {                  // tracer: u along the streak (tail 0 -> head at 0.86 -> cut), v across
        const ux = (x + 0.5) / CELL;
        const along = ux < 0.86 ? Math.pow(ux / 0.86, 1.6) : Math.pow(Math.max(0, 1 - (ux - 0.86) / 0.14), 1.5);
        a = along * Math.exp(-v * v * 9) * (1 - smooth((Math.abs(v) - 0.85) / 0.15));
        if (x < 2 || x > CELL - 3) a = 0;
      }
      const i = (y * CELL + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }
  return id;
}

function buildAtlas() {
  atlasCv = document.createElement("canvas"); atlasCv.width = atlasCv.height = CELL * 2;
  atlasCtx = atlasCv.getContext("2d", { willReadFrequently: false });
  for (let c = 0; c < 4; c++) atlasCtx.putImageData(makeMask(c), cellX(c), cellY(c));
  atlas = new THREE.CanvasTexture(atlasCv);
  atlas.colorSpace = THREE.NoColorSpace;          // alpha-only data
  atlas.premultiplyAlpha = false;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = true;
  atlas.needsUpdate = true;
}

/** Replace a cell with its shipped PNG when it loads (contract C-ART-FX). Any failure leaves the procedural mask in place. */
function loadAtlasPngs(W) {
  if (typeof Image === "undefined") return;
  const base = (W && W.assetBase) || "";
  CELL_NAME.forEach((name, c) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const x = cellX(c), y = cellY(c);
          atlasCtx.clearRect(x, y, CELL, CELL);
          atlasCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x + 2, y + 2, CELL - 4, CELL - 4);   // 2 px gutter of alpha 0: filtering never reads the neighbour cell
          atlas.needsUpdate = true;
          atlasSrc[name] = "assets/fx/" + name + ".png";
        } catch (e) { /* a tainted or odd image: the procedural cell stays */ }
      };
      img.onerror = () => { /* absent: the procedural cell stays */ };
      img.src = base + "assets/fx/" + name + ".png";
    } catch (e) { /* procedural */ }
  });
}

const FX_VS = /* glsl */`
attribute vec4 iA;        // x cell, y alpha, z additive fraction, w spin
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vAdd;
varying float vCell;
void main() {
  vec3 c = instanceMatrix[3].xyz;
  float size = length( instanceMatrix[0].xyz );
  vec3 wp;
  vec2 uv2 = uv;
  if ( iA.x > 2.5 ) {
    // tracer: a streak along the flight axis (column 2 = direction * length), billboarded AROUND that axis
    vec3 ax = instanceMatrix[2].xyz;
    float len = max( length( ax ), 1e-5 );
    vec3 dir = ax / len;
    vec3 toCam = cameraPosition - c;
    vec3 side = cross( dir, toCam );
    float sl = length( side );
    side = sl > 1e-5 ? side / sl : normalize( cross( dir, vec3( 0.0, 1.0, 0.01 ) ) );
    wp = c + side * ( position.x * size ) + dir * ( position.y * len );
    uv2 = vec2( position.y + 0.5, position.x + 0.5 );          // u runs ALONG the streak: tail 0 -> bright head ~0.86
  } else {
    float cs = cos( iA.w ), sn = sin( iA.w );
    vec2 q = vec2( cs * position.x - sn * position.y, sn * position.x + cs * position.y );
    vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
    vec3 up = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
    wp = c + ( right * q.x + up * q.y ) * size;
  }
  vUv = uv2;
  vCol = instanceColor;
  vA = iA.y;
  vAdd = iA.z;
  vCell = iA.x;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

const FX_FS = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vAdd;
varying float vCell;
void main() {
  float cell = floor( vCell + 0.5 );
  vec2 off = vec2( mod( cell, 2.0 ), floor( cell * 0.5 ) ) * 0.5;
  vec2 uv = off + ( vec2( 0.012 ) + vUv * 0.976 ) * 0.5;       // tiny inset: linear filtering never reads the neighbour cell
  float t = texture2D( map, uv ).a;
  float a = t * vA;
  gl_FragColor = vec4( vCol * a, a * ( 1.0 - vAdd ) );          // premultiplied: alpha 0 = pure additive light, alpha = a = ordinary blend
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function init(W) {
  buildAtlas();
  loadAtlasPngs(W);
  const geo = new THREE.PlaneGeometry(1, 1);
  iAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  iAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iA", iAttr);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas } },
    vertexShader: FX_VS, fragmentShader: FX_FS,
    transparent: true, premultipliedAlpha: true, blending: THREE.NormalBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
  });
  mat.name = "FxQuads";
  inst = new THREE.InstancedMesh(geo, mat, N);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  inst.instanceColor.setUsage(THREE.DynamicDrawUsage);
  inst.count = N;
  inst.frustumCulled = false;
  inst.renderOrder = 7;                           // above the storm wall (5) and the loot beams / rings (>= 6)
  inst.name = "fx-quads";
  const m = inst.instanceMatrix.array;
  for (let i = 0; i < N; i++) {
    // dirV is the slot's OWN stretch axis: tracers used to hand in a fresh
    // Vector3 per round (fx.js:247); now the handler copies into this one.
    parts.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, life0: 1, size: 0.1, gravity: 0, drag: 0, dir: null, dirV: new THREE.Vector3(), stretch: 0, idx: i,
                 st: ST_SPARK, spin: 0, spinV: 0, a0: 1 });
    parkSlot(m, i);
  }
  W.group("fx").add(inst);
  W.camShake = 0;

  // DOM damage-number layer + its fixed node pool (built once, never grown)
  dmgLayer = document.createElement("div");
  Object.assign(dmgLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden", zIndex: 30 });
  W.kernel.parent.appendChild(dmgLayer);
  buildDmgPool();

  wireEvents(W);
}

/** A dead slot: zero-size matrix at the origin and alpha 0 (a degenerate quad rasterises nothing). */
function parkSlot(m, i) {
  const o = i * 16;
  for (let j = 0; j < 16; j++) m[o + j] = 0;
  m[o + 15] = 1;
  const a = iAttr.array, q = i * 4;
  a[q] = 0; a[q + 1] = 0; a[q + 2] = 1; a[q + 3] = 0;
}

let cursor = 0;
/** Positional spawn — no option object, no allocation. `dir` (optional) is
 *  COPIED into the slot's own vector. `st` is a particle style (ST_*). */
function spawnRaw(x, y, z, vx, vy, vz, color, size, life, gravity, drag, dir, stretch, st) {
  // The slot index IS the pre-bump cursor. This used to be `parts.indexOf(p)`,
  // a 1024-entry linear scan to recover an index we were already holding — a
  // 26-particle explosion paid 26 of them. Capture BEFORE the bump: reading
  // cursor after it would colour the next slot instead of this one.
  const i = cursor;
  const p = parts[cursor];
  cursor = (cursor + 1) % N;
  if (st === undefined) st = ST_SPARK;
  p.alive = true;
  p.pos.set(x, y, z);
  p.vel.set(vx, vy, vz);
  p.life = p.life0 = life || 0.6;
  p.size = size || 0.12;
  p.gravity = gravity != null ? gravity : -9;
  p.drag = drag != null ? drag : 0.5;
  if (dir) { p.dirV.copy(dir); p.dir = p.dirV; } else p.dir = null;   // stretch along dir (tracers)
  p.stretch = stretch || 0;
  p.idx = i;
  p.st = st;
  p.a0 = sA0[st];
  p.spin = Math.random() * 6.2832;
  p.spinV = sSpin[st] * (Math.random() < 0.5 ? -1 : 1);
  _col.set(color != null ? color : 0xffcc66);
  const g = sGain[st], ca = inst.instanceColor.array, q = i * 3;
  ca[q] = _col.r * g; ca[q + 1] = _col.g * g; ca[q + 2] = _col.b * g;
  inst.instanceColor.needsUpdate = true;
  const ia = iAttr.array, w = i * 4;
  ia[w] = sCell[st]; ia[w + 1] = p.a0; ia[w + 2] = sAdd[st]; ia[w + 3] = p.spin;
}
function spawn(o) {
  spawnRaw(o.x, o.y, o.z, o.vx || 0, o.vy || 0, o.vz || 0, o.color, o.size, o.life, o.gravity, o.drag, o.dir || null, o.stretch, o.st);
}

function burst(o) {
  const n = o.n || 8;
  const multi = Array.isArray(o.color);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
    const s = (o.speed || 5) * (0.4 + Math.random() * 0.8);
    spawnRaw(o.x, o.y, o.z,
      Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + (o.up || 2), Math.sin(a) * Math.cos(e) * s,
      multi ? o.color[i % o.color.length] : o.color,
      (o.size || 0.12) * (0.6 + Math.random() * 0.9),
      (o.life || 0.7) * (0.6 + Math.random() * 0.8),
      o.gravity, o.drag, null, 0, o.st);
  }
}

// ── event wiring ─────────────────────────────────────────────────────────────
// Per-weapon firing kick. Firing had NO physical feedback at all: `camShake =`
// existed in exactly two places in this file (explosion, player-hurt) and neither
// is your own gun, so at the SMG's 720 rpm you pulled a trigger every 83 ms and
// nothing on screen moved. Magnitudes track the audio gains, and the 1.8/s decay
// keeps every one of them SHORTER than that weapon's own fire interval (smg 25 ms
// vs 83 ms, ar 39 ms vs 182 ms, sniper 144 ms vs 1714 ms), so sustained fire
// punches instead of accumulating into a permanent wobble.
// MUZZLE FLASH: a soft 4-point star + a round halo at the barrel (billboards, no cubes) and three tiny forward
// sparks. Start-low brightness (gain 0.48 / 0.42, see STYLE_TAB) and a 55-70 ms life: it must read as a flash, not a lamp.
const FLASH_K = { pistol: 0.8, smg: 0.85, ar: 1.0, shotgun: 1.5, sniper: 1.3, glauncher: 1.4 };
function muzzleFlash(x, y, z, dir, weaponId) {
  const k = FLASH_K[weaponId] || 1;
  spawnRaw(x, y, z, 0, 0, 0, 0xffe9a8, 0.14 * k, 0.055, 0, 0, null, 0, ST_FLASH);
  spawnRaw(x + dir.x * 0.06, y + dir.y * 0.06, z + dir.z * 0.06, 0, 0, 0, 0xffb85c, 0.12 * k, 0.07, 0, 0, null, 0, ST_HALO);
  for (let i = 0; i < 3; i++) {
    spawnRaw(x, y, z, dir.x * 7 + (Math.random() - 0.5) * 3, dir.y * 7 + (Math.random() - 0.3) * 3, dir.z * 7 + (Math.random() - 0.5) * 3,
      i ? 0xfff2b0 : 0xffb84d, 0.035, 0.09, 0, 4, null, 0, ST_FSPARK);
  }
}

const SHOT_SHAKE = { pistol: 0.06, smg: 0.045, ar: 0.07, shotgun: 0.20, sniper: 0.26, glauncher: 0.18 };
const SHOT_FOV   = { pistol: 2, smg: 2, ar: 2.5, shotgun: 5, sniper: 5, glauncher: 4.5 };

// Explosion flash. A 95-damage launcher round with a 3.5 m splash resolved as 40
// cubes and a low-passed thump. A real PointLight would force a shader recompile
// across every material in the scene on the first blast (a visible hitch on a
// browser GPU) — at the match bloom of 0.14 an additive sprite reads as a flash
// for free. loot.js builds its chest glow the same way.
// Bullet decals: one InstancedMesh of camera-independent quads oriented to the
// impact normal, ring-buffered. Instances park at scale 0 until used; a fresh
// match clears the fx group, so re-adoption also re-parks every slot (old
// map's holes must not reappear floating in the new map).
const DECAL_N = 64;
let decalMesh = null, decalCursor = 0;
const _dM = new THREE.Matrix4(), _dQ = new THREE.Quaternion(), _dQ2 = new THREE.Quaternion();
const _dN = new THREE.Vector3(), _dP = new THREE.Vector3(), _dS = new THREE.Vector3();
const _dZ = new THREE.Vector3(0, 0, 1);
function ensureDecals(W) {
  if (decalMesh) {
    if (!decalMesh.parent) {
      _dM.makeScale(0, 0, 0);
      for (let i = 0; i < DECAL_N; i++) decalMesh.setMatrixAt(i, _dM);
      decalMesh.instanceMatrix.needsUpdate = true;
      decalCursor = 0;
      W.group("fx").add(decalMesh);
    }
    return;
  }
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const c2 = cv.getContext("2d");
  const gr = c2.createRadialGradient(32, 32, 3, 32, 32, 30);
  gr.addColorStop(0, "rgba(18,14,10,0.9)");
  gr.addColorStop(0.5, "rgba(24,19,14,0.45)");
  gr.addColorStop(1, "rgba(24,19,14,0)");
  c2.fillStyle = gr; c2.beginPath(); c2.arc(32, 32, 30, 0, 7); c2.fill();
  const tex = new THREE.CanvasTexture(cv);
  decalMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.14, 0.14),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    DECAL_N);
  decalMesh.frustumCulled = false;   // 64 quads scattered map-wide: one sphere would span the map anyway
  _dM.makeScale(0, 0, 0);
  for (let i = 0; i < DECAL_N; i++) decalMesh.setMatrixAt(i, _dM);
  decalMesh.instanceMatrix.needsUpdate = true;
  W.group("fx").add(decalMesh);
}

let flashTex = null, blastCursor = 0;
const blasts = [];
function ensureBlasts(W) {
  if (blasts.length) return;
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const c2 = cv.getContext("2d");
  const gr = c2.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,255,235,1)");
  gr.addColorStop(0.35, "rgba(255,190,90,0.55)");
  gr.addColorStop(1, "rgba(255,120,30,0)");
  c2.fillStyle = gr; c2.fillRect(0, 0, 128, 128);
  flashTex = new THREE.CanvasTexture(cv); flashTex.colorSpace = THREE.SRGBColorSpace;
  // RingGeometry lies in XY, so rotation.x = -PI/2 is what lays the shockwave
  // flat on the ground; its outer radius is 1, so the scale IS the world radius.
  const rg = new THREE.RingGeometry(0.82, 1, 28);
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    sp.visible = false; ring.visible = false;
    sp.renderOrder = 8; ring.renderOrder = 7;     // above the storm wall (5) and the loot beams / rings (>= 6)
    blasts.push({ sp, ring, t: 99, R: 3.5 });
  }
}

// Enemies never reacted to being hit: 4 cubes at size 0.08 and a floating number,
// nothing on the body itself. Two traps here, both already paid for in player.js.
//   * NOT emissive — player.js records that Meshy's emissiveMap was
//     deliberately stripped (it re-added albedo through an unlit path and made
//     every actor fullbright in shade); raising it back is that bug renamed.
//   * NOT a lerp toward white — player.js multiplies each actor's base
//     colour by BODY_GAIN 3.2, so channels sit around 1.6-2.9 and blending toward
//     (1,1,1) would DARKEN the model. Scale the saved colour UP instead.
// Safe per-actor because player.js clones every source material into a
// per-actor Map, so writing .color on one actor cannot tint another wearing the
// same skin. Colour split (shield blue / health red) is the one the particles use.
const FLASH_S = 0.07;
const flashing = [];
function flashActor(a, toShield) {
  if (!a || !a.rig || !a.rig.scene) return;
  if (!a._flashMats) {
    const seen = new Set(); a._flashMats = [];
    a.rig.scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.material || !o.material.color || seen.has(o.material)) return;
      seen.add(o.material);
      // player.js's zone-tint shader divides material.color back out, so writing
      // .color here changed nothing at all — the flash shipped invisible on 100%
      // of actors. Tinted materials expose userData.zFlash; drive that uniform
      // and keep the .color path only for meshes that have no zone tint.
      a._flashMats.push({ m: o.material, c: o.material.color.clone(),
                          u: (o.material.userData && o.material.userData.zFlash) || null });
    });
  }
  if (!a._flashMats.length) return;
  a._flashT = FLASH_S; a._flashShield = !!toShield;
  if (flashing.indexOf(a) < 0) flashing.push(a);
}

function wireEvents(W) {
  W.events.on("shotFired", (a, weaponId, muzzle, dir) => {
    // muzzle flash at the BARREL (weapons.js now passes the weapon muzzle world
    // position, not the eye) — bright and chunky enough to register at gameplay FOV
    const mx = muzzle.x + dir.x * 0.12, my = muzzle.y + dir.y * 0.12, mz = muzzle.z + dir.z * 0.12;
    muzzleFlash(mx, my, mz, dir, weaponId);
    // Gating on `a === W.player` is mandatory: shotFired is the GLOBAL event and
    // all 49 bots fire through it (audio.js gates its own gunshot the same way), so an
    // ungated kick would shake the camera on every gunshot on the island.
    // fovPunch is the camera's kick channel — inert until updateCamera consumes it.
    if (a === W.player) {
      W.camShake = Math.max(W.camShake, SHOT_SHAKE[weaponId] || 0.05);
      W.fovPunch = Math.max(W.fovPunch || 0, SHOT_FOV[weaponId] || 2);
    }
    // One brass casing per shot — the only thing this game leaves behind after a
    // firefight. Ejected right-and-back: right = dir x up(0,1,0) = (-dz, 0, dx).
    // Fires once per trigger pull, not per pellet, because weapons.js emits
    // shotFired once per fire() — so a shotgun throws one shell, correctly.
    if (weaponId !== "glauncher") {
      spawn({
        x: mx, y: my - 0.05, z: mz,
        vx: -dir.z * 1.6 - dir.x * 0.8, vy: 1.7, vz: dir.x * 1.6 - dir.z * 0.8,
        color: 0xc9a227, size: 0.045, life: 1.5, gravity: -9, drag: 0.2, st: ST_BRASS,
      });
    }
  });

  // one bright bolt PER PROJECTILE that FLIES with the round (owner: "when
  // shooting i dont see bullets") — a hot stretched streak sweeping downrange
  // beats the old static muzzle blink; bots' shots use the same global event
  const TRACER_COLOR = { sniper: 0x9fe0ff, glauncher: 0xffb060, shotgun: 0xffc46a };
  W.events.on("tracer", (pr) => {
    const speed = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    const dx = pr.vx / speed, dy = pr.vy / speed, dz = pr.vz / speed;
    // short punchy bolt (owner: streaks were "too long") — a compact dash,
    // not a laser beam
    const len = pr.weaponId === "sniper" ? 7 : pr.weaponId === "glauncher" ? 3 : 4;
    // COSMETIC speed cap: hitscan rounds (999 m/s) cross the screen in one
    // frame — the eye never sees them. The damage ray is already resolved;
    // the bolt flies at a readable pace instead.
    const vs = Math.min(speed, 200);
    _tdir.set(dx, dy, dz);    // copied into the slot's own dirV by spawnRaw
    spawnRaw(pr.x + dx * 1.4, pr.y + dy * 1.4, pr.z + dz * 1.4,
      dx * vs, dy * vs, dz * vs,
      TRACER_COLOR[pr.weaponId] || 0xffd24a,
      0.12, 0.22, 0, 0, _tdir, len, ST_TRACER);
  });

  // weapons.js emits exactly four surfaces: flesh, wood, stone, dirt. The old
  // ternary chain tested "build" — dead residue of the removed building system —
  // and had no "wood" arm at all, so tree hits fell through to the dirt default
  // and threw brown chips while audio.js played the wood tick. The pale 0xd7c08a
  // the dead branch was sitting on is the right wood tone, so it just moves over.
  const IMPACT_COLOR = { flesh: 0xc23b3b, wood: 0xd7c08a, stone: 0xa9a9a9, dirt: 0x9a7f4f };
  W.events.on("impact", (pos, surface) => {
    const c = IMPACT_COLOR[surface] || 0x9a7f4f;
    burst({ x: pos.x, y: pos.y, z: pos.z, n: 5, color: c, speed: 3.5, size: 0.08, life: 0.4, st: surface === "stone" ? ST_HOT : surface === "flesh" ? ST_BLOOD : ST_CHIP });
    // PERMANENCE: a bullet hole where the round actually landed. Before this,
    // the world was bit-identical after a firefight — the roadmap's cited tell.
    // Wood/stone only (weapons.js sends the entry-face normal for those; dirt
    // is grass-covered and flesh is a body). 64-slot ring buffer, oldest
    // overwritten — no per-frame cost, no timers.
    if ((surface === "stone" || surface === "wood") && (pos.nx || pos.ny || pos.nz)) {
      ensureDecals(W);
      _dN.set(pos.nx, pos.ny, pos.nz).normalize();
      _dQ.setFromUnitVectors(_dZ, _dN);
      _dQ2.setFromAxisAngle(_dZ, Math.random() * Math.PI * 2);
      _dQ.multiply(_dQ2);
      const ds = 0.8 + Math.random() * 0.55;
      _dS.set(ds, ds, ds);
      // 12mm off the face — under polygonOffset alone, distant walls z-fight
      _dP.set(pos.x + _dN.x * 0.012, pos.y + _dN.y * 0.012, pos.z + _dN.z * 0.012);
      _dM.compose(_dP, _dQ, _dS);
      decalMesh.setMatrixAt(decalCursor % DECAL_N, _dM);
      decalCursor++;
      decalMesh.instanceMatrix.needsUpdate = true;
    }
  });

  W.events.on("explosion", (pos, R) => {
    burst({ x: pos.x, y: pos.y, z: pos.z, n: 26, color: [0xffd28a, 0xff8a3c, 0xff5522], speed: 11, up: 5, size: 0.28, life: 0.8, drag: 1.5, st: ST_HOT });
    burst({ x: pos.x, y: pos.y + 0.5, z: pos.z, n: 14, color: [0x555555, 0x333333], speed: 4, up: 4, size: 0.4, life: 1.4, gravity: -1.5, drag: 1.2, st: ST_SMOKE });
    ensureBlasts(W);
    const b = blasts[(blastCursor++) % blasts.length];
    b.t = 0; b.R = R || 3.5;
    b.sp.position.set(pos.x, pos.y + 0.4, pos.z);
    b.ring.position.set(pos.x, pos.y + 0.12, pos.z);
    b.sp.visible = true; b.ring.visible = true;
    // startMatch clears every scene group — re-adopt, the
    // same reason the particle InstancedMesh is re-parented in update()
    if (!b.sp.parent) W.group("fx").add(b.sp, b.ring);
    const d = W.player ? Math.hypot(W.player.pos.x - pos.x, W.player.pos.z - pos.z) : 999;
    if (d < 40) W.camShake = Math.max(W.camShake, (1 - d / 40) * 0.5);
    if (d < 8) W.hitstopT = Math.max(W.hitstopT || 0, 0.07);
  });

  W.events.on("swimState", (a, swimming) => {
    if (!swimming) return;
    burst({ x: a.pos.x, y: W.map.waterY + 0.1, z: a.pos.z, n: 8, color: [0xbfe8f5, 0x7fc9e0], speed: 3, up: 2.5, size: 0.1, life: 0.6, gravity: -6, st: ST_SPLASH });
  });
  W.events.on("swimStroke", (a) => {
    burst({ x: a.pos.x, y: W.map.waterY + 0.05, z: a.pos.z, n: 4, color: 0xbfe8f5, speed: 2, up: 1.5, size: 0.08, life: 0.4, gravity: -5, st: ST_SPLASH });
  });

  W.events.on("actorHurt", (victim, info) => {
    burst({ x: victim.pos.x, y: victim.pos.y + 1.2, z: victim.pos.z, n: 4, color: info.toShield > 0 ? 0x4aa8ff : 0xc23b3b, speed: 2.4, size: 0.08, life: 0.35, st: info.toShield > 0 ? ST_HOT : ST_BLOOD });
    flashActor(victim, info.toShield > 0);
    // SHIELD BREAK — the one hit that changes the fight had no visual beat at
    // all: `info.broke` was read only by audio.js (feel-juice-ui G8), and the
    // breaking hit drew the same blue chip as any other. A burst of shield-blue
    // shards off the chest, from the same particle pool (no new draw call).
    // Distance-gated like the other world bursts; your own and your attacker's
    // breaks always show.
    if (info.broke) {
      const mine = W.player && (info.attackerId === W.player.id || victim === W.player);
      if (mine || nearCam(victim.pos.x, victim.pos.z, 80)) {
        burst({ x: victim.pos.x, y: victim.pos.y + 1.25, z: victim.pos.z, n: 18, color: SHARD_COLORS, speed: 6.5, up: 2.2, size: 0.13, life: 0.6, gravity: -7, drag: 1.4, st: ST_HOT });
        shieldBreaks++;
        lastBreak = { id: victim.id, t: W.t };
      }
    }
    if (info.attackerId === (W.player && W.player.id)) {
      if (info.isHead) W.hitstopT = Math.max(W.hitstopT || 0, 0.03);
      // ONE accumulating number per victim (feel-juice-ui G1). A shotgun
      // blast (nine events in one frame) and an SMG burst (one per 83 ms) both
      // fold into the same pooled node, which re-pops as its value grows.
      dmgHit(W, victim, info);
    }
    if (victim === W.player) W.camShake = Math.max(W.camShake, 0.12);
  });

  // player.js emits actorDied as (victim, killerId, weaponId); this listener only ever
  // declared (victim), so the kill's owner was thrown away here.
  W.events.on("actorDied", (victim, killerId) => {
    burst({ x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z, n: 12, color: [0xffffff, 0x9fd7ff], speed: 5, up: 4, size: 0.14, life: 0.8, st: ST_HOT });
    // your own kill gets the longest beat — 50 ms at 0.12x is ~6 ms of world time
    if (W.player && killerId === W.player.id && victim !== W.player) {
      W.hitstopT = Math.max(W.hitstopT || 0, 0.05);
      dmgKill(victim);      // the killing number turns red and pops bigger
    }
  });

  // propBreak had NO fx listener — this file wires nine events and it was not
  // among them, so a felled tree vanished with only audio.js's two-blip break
  // to mark it. Only TREE kinds can reach here: maps.js gives hp to
  // barrel/tree/pine/palm/birch and nothing else, and barrels take the explosion
  // path in weapons.js, so the palette is trunk + foliage, never stone.
  const nearCam = (x, z, max) => !W.player || Math.hypot(W.player.pos.x - x, W.player.pos.z - z) < max;
  W.events.on("propBreak", (p2) => {
    if (!nearCam(p2.x, p2.z, 120)) return;
    burst({ x: p2.x, y: p2.y + 1.4, z: p2.z, n: 14, color: [0x9a7f4f, 0x6b5335, 0x4e7a3a], speed: 4.5, up: 3, size: 0.18, life: 1.1, drag: 1.2, st: ST_CHIP });
  });
  // hardLand and landed (both emitted from player.js) already had audio
  // and no visual at all. Distance-gated because "landed" fires once for every
  // one of 50 actors at the end of the drop.
  W.events.on("hardLand", (a, speed) => {
    // the impact speed was already being passed and used for particle count, but
    // nothing ever moved the CAMERA — so a 20 m drop and a 2 m hop felt identical
    // from behind the eyes. Player-only: a bot's landing must not shake your view.
    if (a === W.player) W.camShake = Math.max(W.camShake, Math.min(0.22, 0.05 + speed * 0.006));
    if (!nearCam(a.pos.x, a.pos.z, 60)) return;
    burst({ x: a.pos.x, y: a.pos.y + 0.06, z: a.pos.z, n: Math.min(12, 4 + Math.round(speed * 0.3)), color: [0xa08b63, 0x8a7550], speed: 2.2, up: 0.8, size: 0.1, life: 0.5, gravity: -5, drag: 2, st: ST_DUST });
  });
  // ordinary touchdown — every jump, every step off a roof. Scales with impact so
  // a hop kicks up almost nothing and a two-storey drop actually puffs.
  W.events.on("touchdown", (a, speed) => {
    if (!nearCam(a.pos.x, a.pos.z, 40)) return;
    const k = Math.min(1, speed / 14);
    burst({ x: a.pos.x, y: a.pos.y + 0.05, z: a.pos.z, n: 2 + Math.round(k * 5), color: [0x9a8562, 0xb0a184],
            speed: 1.1 + k * 1.2, up: 0.35 + k * 0.5, size: 0.07 + k * 0.03, life: 0.3 + k * 0.2, gravity: -5, drag: 2.6, st: ST_DUST });
  });
  // takeoff — nothing was drawn here at all
  W.events.on("mantle", (a) => {
    // a puff of scuff dust at the hands as the pull-up starts (sweep finding:
    // the emit had no FX listener)
    burst({ x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z, n: 5, color: 0xbfae8f, speed: 1.8, up: 1.2, size: 0.07, life: 0.5, gravity: -3, st: ST_DUST });
  });
  W.events.on("jump", (a) => {
    if (!nearCam(a.pos.x, a.pos.z, 34)) return;
    burst({ x: a.pos.x, y: a.pos.y + 0.04, z: a.pos.z, n: 3, color: 0x9a8562, speed: 1.0, up: 0.5, size: 0.06, life: 0.26, gravity: -5, drag: 3, st: ST_DUST });
  });
  W.events.on("landed", (a) => {
    if (!nearCam(a.pos.x, a.pos.z, 45)) return;
    burst({ x: a.pos.x, y: a.pos.y + 0.05, z: a.pos.z, n: 6, color: 0x9a8562, speed: 1.6, up: 0.6, size: 0.09, life: 0.45, gravity: -5, drag: 2.5, st: ST_DUST });
  });

  W.events.on("chestOpened", (a, c) => {
    burst({ x: c.pos.x, y: c.pos.y + 0.8, z: c.pos.z, n: 12, color: [0xffd700, 0xfff2b0], speed: 3.5, up: 4, size: 0.1, life: 0.9, gravity: -3, st: ST_HOT });
  });
}

// ── damage numbers: ONE accumulating number per victim, from a fixed pool ────
// Before: one new DOM node per hit (fx.js:391), no pool, no cap, always 26 px,
// spawned at the name-tag height — a 1 s SMG burst stacked "18 20 22 21 22 19"
// in an unreadable column over the victim's name (feel-juice-ui G1; 30 nodes
// created for 30 hits). Now: while a victim keeps taking YOUR damage inside
// DMG_WINDOW, the same node re-pops and its value grows (18 -> 38 -> 60 ...);
// after the window it floats up and fades, and the slot returns to the pool.
// Size is a damage TIER (transform scale, so no layout per frame); colour
// precedence kill red > head yellow > shield blue > body white; the hit that
// breaks a shield carries a BREAK tag. Placed BESIDE the name tag (screen-right
// of the head at ~1.6 m), never on it — the tag sprite spans y 2.0-2.5 m.
const DMG_POOL = 12, DMG_WINDOW = 0.8, DMG_FLOAT = 0.5, DMG_POP = 0.12, DMG_Y = 1.6;
const dmgPool = [];           // fixed: built once in init()
let dmgCreated = 0, dmgSpawned = 0, dmgPops = 0;
const SHARD_COLORS = [0x4aa8ff, 0x9fd7ff, 0xe8f6ff, 0x2f7fd6];
let shieldBreaks = 0, lastBreak = null;
const DMG_COL = { kill: "#ff4d4d", head: "#ffd54a", shield: "#6db9ff", body: "#ffffff" };
function buildDmgPool() {
  if (dmgPool.length) {           // a re-init (never expected) re-parents, never rebuilds
    for (const d of dmgPool) if (d.el.parentNode !== dmgLayer) dmgLayer.appendChild(d.el);
    return;
  }
  for (let i = 0; i < DMG_POOL; i++) {
    const el = document.createElement("div");
    const num = document.createElement("span");
    const tag = document.createElement("span");
    dmgCreated += 3;
    el.dataset.lc = "dmgnum";
    Object.assign(el.style, {
      position: "absolute", left: "0", top: "0", display: "none", opacity: "0",
      fontWeight: "900", fontFamily: "system-ui, sans-serif", fontSize: "26px", lineHeight: "1",
      whiteSpace: "nowrap", transformOrigin: "0 50%", willChange: "transform, opacity",
      textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5)",
      WebkitTextStroke: "1px rgba(0,0,0,0.55)",
    });
    Object.assign(tag.style, {
      display: "none", marginLeft: "5px", fontSize: "12px", letterSpacing: "1.5px", verticalAlign: "middle",
      color: "#9fd7ff", WebkitTextStroke: "0", textShadow: "0 1px 4px rgba(0,0,0,0.95)",
    });
    tag.textContent = "BREAK";
    el.appendChild(num); el.appendChild(tag);
    dmgLayer.appendChild(el);
    dmgPool.push({
      el, num, tag, live: false, victim: null, vid: null, pos: new THREE.Vector3(),
      value: 0, kill: false, head: false, shield: false, broke: false,
      age: 0, popT: 9, shown: "", shownVal: -1, col: "", tagOn: false, op: "", tf: "", disp: false,
    });
  }
}
function dmgFind(victim) {
  for (const d of dmgPool) if (d.live && d.victim === victim) return d;
  return null;
}
function dmgAlloc() {
  let best = null;
  for (const d of dmgPool) {
    if (!d.live) return d;
    if (!best || d.age > best.age) best = d;   // pool full: steal the oldest
  }
  return best;
}
function dmgHit(W, victim, info) {
  if (!dmgPool.length) return;
  let d = dmgFind(victim);
  if (d && d.age > DMG_WINDOW) {
    // already floating off: RESTART the count on the same node — still one
    // live number for this victim, never a second one stacked on it
    d.value = 0; d.kill = d.head = d.shield = d.broke = false;
  }
  if (!d) {
    d = dmgAlloc();
    d.live = true; d.victim = victim; d.vid = victim.id;
    d.value = 0; d.kill = d.head = d.shield = d.broke = false;
    dmgSpawned++;
  } else dmgPops++;
  d.value += info.dmg || 0;
  if (info.isHead) d.head = true;
  // the colour tracks the LATEST hit's layer: a burst that chews through the
  // shield and into health turns from blue to white as it crosses over
  d.shield = (info.toShield || 0) > 0 && (info.toShield || 0) >= (info.dmg || 0) * 0.5;
  if (info.broke) d.broke = true;
  d.age = 0; d.popT = 0;
  d.pos.set(victim.pos.x, victim.pos.y, victim.pos.z);
}
function dmgKill(victim) {
  const d = dmgFind(victim);
  if (!d) return;
  d.kill = true;
  d.age = 0; d.popT = 0;
}
function dmgPark(d) {
  d.live = false; d.victim = null; d.vid = null;
  if (d.disp) { d.el.style.display = "none"; d.disp = false; }
  d.op = ""; d.tf = "";
}
/** Damage-number tier: size by the ACCUMULATED value (a 105 sniper body shot
 *  used to be the same 26 px as an 18 pistol chip). */
function dmgScale(d) {
  const v = d.value;
  const s = v < 20 ? 0.85 : v < 45 ? 1 : v < 90 ? 1.2 : 1.4;
  return d.kill ? Math.max(1.3, s + 0.15) : s;
}

// ── frame update ─────────────────────────────────────────────────────────────
const proj = new THREE.Vector3();
// last frame's camShake, so the decay below can tell "still ringing" from
// "raised by an event that the camera has not read yet" (see update())
let shakePrev = 0;

/** World-space celebration burst for the victory hold — same particle pool, no
 *  new subsystem. Exported because burst() is module-private and the orchestrator
 *  owns the victory beat. */
let fwCursor = 0;
const FW_COLORS = [[0xffd54a, 0xfff2b0], [0x7ad0ff, 0xbfe8f5], [0x4ade80, 0xbdf5cf], [0xff7ab8, 0xffd0e6]];
/** SHADER PRE-WARM. Lazy program compilation stalls the frame the first time
 *  a material is actually drawn — the Claude-of-Duty writeup measured
 *  728-1236 ms one-offs that median-fps stats hid completely, and our first
 *  explosion/decal is exactly that shape. renderer.compile() only sees
 *  VISIBLE objects (projectObject skips visible=false), so the blast pool is
 *  toggled on at epsilon scale for the one compile pass. Called from
 *  startMatch after the map + actor models exist, so every standard-material
 *  program compiles here instead of mid-firefight. */
export function prewarm(W) {
  ensureBlasts(W);
  ensureDecals(W);
  uploadTextures(W);
  const toggled = [];
  for (const b of blasts) {
    // ensureBlasts CREATES the pool but the sprites only join the scene on
    // their first explosion (the lazy re-adopt in the handler) — an object not
    // in the graph is invisible to renderer.compile no matter what its
    // visibility flag says, which made the first version of this toggle a
    // no-op (sweep finding). Adopt them here; the handler's parent check
    // makes its own adopt idempotent.
    if (!b.sp.parent) W.group("fx").add(b.sp, b.ring);
    if (!b.sp.visible) {
      b.sp.visible = b.ring.visible = true;
      b.sp.scale.setScalar(1e-4); b.ring.scale.setScalar(1e-4);
      toggled.push(b);
    }
  }
  try {
    if (W.kernel && W.kernel.renderer && W.kernel.renderer.compile) {
      W.kernel.renderer.compile(W.scene, W.kernel.camera);
    }
  } catch (e) { /* prewarm is an optimization — never let it block a match */ }
  for (const b of toggled) { b.sp.visible = b.ring.visible = false; }
}

export function fireworks(W, x, y, z) {
  burst({ x, y, z, n: 30, color: FW_COLORS[(fwCursor++) % FW_COLORS.length], speed: 9, up: 1.5, size: 0.16, life: 1.6, gravity: -4, drag: 0.6, st: ST_HOT });
}

/** Park every damage number still floating when a match ends — the pool nodes
 *  stay (they are reused next match), only their state and victim refs go. */
export function reset() {
  for (const d of dmgPool) dmgPark(d);
  // actors are rebuilt every match, so a live entry would pin a discarded roster
  flashing.length = 0;
  for (const b of blasts) { b.t = 99; b.sp.visible = false; b.ring.visible = false; }
  shakePrev = 0;
  lastBreak = null;
}

/** Contract C8: per-match teardown. Everything fx owns is SESSION-scoped and
 *  pooled (particle InstancedMesh, 64 decals, 4 blast sprites, their two
 *  CanvasTextures, the 12 damage-number nodes) — none of it is re-created per
 *  match, so there is nothing to free; what must not survive a match is state
 *  that references the old roster (victims, flashing actors' material lists)
 *  and live particles/decals drawn in the old map. */
export function disposeMatch(W) {
  reset();
  if (inst) {
    const m = inst.instanceMatrix.array;
    for (let i = 0; i < N && parts.length; i++) {
      const p = parts[i];
      if (!p.alive) continue;
      p.alive = false;
      parkSlot(m, i);
    }
    inst.count = 0; inst.instanceMatrix.needsUpdate = true; iAttr.needsUpdate = true;
  }
  if (decalMesh) {
    _dM.makeScale(0, 0, 0);
    for (let i = 0; i < DECAL_N; i++) decalMesh.setMatrixAt(i, _dM);
    decalMesh.instanceMatrix.needsUpdate = true;
    decalCursor = 0;
  }
  if (W) W.camShake = 0;
}

/** The blast flash (fx.js:190) and decal (:164) CanvasTextures are SESSION
 *  objects, made once — but a texture reaches the GPU only on its first draw,
 *  so the blast sprite's went up mid-firefight on the first explosion of the
 *  session. renderer.compile() builds programs and uploads nothing, so under
 *  the old prewarm the leak census saw it appear at the match-2 lobby
 *  (m1/m2/m3 = 0/1/1, "growth" +1: VERIFY item 18) — a one-time upload,
 *  not a per-match leak. Uploading both here makes them resident from the
 *  first lobby (flat census) and takes the upload out of the first blast. */
function uploadTextures(W) {
  const r = W && W.kernel && W.kernel.renderer;
  if (!r || typeof r.initTexture !== "function") return;
  try {
    if (flashTex) r.initTexture(flashTex);
    const dm = decalMesh && decalMesh.material && decalMesh.material.map;
    if (dm) r.initTexture(dm);
    if (atlas) r.initTexture(atlas);
  } catch (e) { /* an optimization — never block a match on it */ }
}

/** Contract C7: the objects whose programs must exist before the first drop
 *  frame. L3's warmup forces them visible / un-culled / count >= 1 for one real
 *  composer.render() and restores them exactly, so this only has to make sure
 *  every pool EXISTS and is in the scene graph (an object outside the graph is
 *  invisible to compile no matter its flags — the old prewarm's first bug). */
export function warmObjects(W) {
  ensureBlasts(W);
  ensureDecals(W);
  uploadTextures(W);
  const g = W.group("fx");
  if (inst && !inst.parent) g.add(inst);
  for (const b of blasts) if (!b.sp.parent) g.add(b.sp, b.ring);
  const out = [];
  if (inst) out.push(inst);
  if (decalMesh) out.push(decalMesh);
  for (const b of blasts) out.push(b.sp, b.ring);
  // (the supply-crate balloon's program is linked where the balloon is made: loot.js makeSupplyCrate() / warmObjects - one source, Wave 7 round D1)
  return out;
}

/** Contract C9 read-back (merged into __LC__.feel() by L4). Cheap: no DOM reads. */
export function readback(W) {
  const nums = [];
  const per = {};
  let live = 0, maxPer = 0;
  for (const d of dmgPool) {
    if (!d.live) continue;
    live++;
    per[d.vid] = (per[d.vid] || 0) + 1;
    if (per[d.vid] > maxPer) maxPer = per[d.vid];
    nums.push({
      victim: d.vid, text: d.shown, value: Math.round(d.value), kill: d.kill, head: d.head, shield: d.shield, broke: d.broke,
      color: d.col, scale: +dmgScale(d).toFixed(2), ageMs: Math.round(d.age * 1000), floating: d.age > DMG_WINDOW,
      opacity: d.op === "" ? 0 : +d.op,
    });
  }
  let pLive = 0;
  for (let i = 0; i < parts.length; i++) if (parts[i].alive) pLive++;
  return {
    dmg: { live, maxPerVictim: maxPer, perVictim: per, numbers: nums, pool: dmgPool.length,
           nodesCreated: dmgCreated, spawned: dmgSpawned, pops: dmgPops, windowMs: DMG_WINDOW * 1000 },
    shieldBreaks, lastShieldBreak: lastBreak,
    particles: { live: pLive, cap: N, geometry: inst ? inst.geometry.type : null, verts: inst ? inst.geometry.attributes.position.count : 0,
                 material: inst ? inst.material.type : null, renderOrder: inst ? inst.renderOrder : null, atlas: atlasSrc },
    camShake: W ? +(W.camShake || 0).toFixed(3) : 0,
  };
}

function updateDmg(W, dt) {
  let any = false;
  for (let i = 0; i < dmgPool.length; i++) if (dmgPool[i].live) { any = true; break; }
  if (!any) return;
  viewSize(W);
  const cam = W.camera;
  cam.updateMatrixWorld();   // also refreshes matrixWorldInverse for project()
  const focal = _vh / (2 * Math.tan((cam.fov * Math.PI / 180) / 2));
  for (let i = 0; i < dmgPool.length; i++) {
    const d = dmgPool[i];
    if (!d.live) continue;
    d.age += dt; d.popT += dt;
    const fl = d.age > DMG_WINDOW ? (d.age - DMG_WINDOW) / DMG_FLOAT : 0;
    if (fl >= 1) { dmgPark(d); continue; }
    // follow the victim while the count is live; the anchor freezes once it floats
    const v = d.victim;
    if (v && fl === 0 && v.pos) d.pos.set(v.pos.x, v.pos.y, v.pos.z);
    proj.set(d.pos.x, d.pos.y + DMG_Y + fl * 0.55, d.pos.z);
    const dist = Math.max(1, cam.position.distanceTo(proj));
    proj.project(cam);
    if (proj.z > 1) {                         // behind the camera
      if (d.op !== "0") { d.el.style.opacity = "0"; d.op = "0"; }
      continue;
    }
    // beside the tag: ~0.62 m to the screen-right of the head, in px, clamped so
    // a far victim's number still clears the body and a near one stays close
    const off = Math.max(18, Math.min(80, 0.62 * focal / dist));
    const sx = (proj.x * 0.5 + 0.5) * _vw + off, sy = (-proj.y * 0.5 + 0.5) * _vh;
    const pk = d.popT < DMG_POP ? 1 - d.popT / DMG_POP : 0;
    const s = dmgScale(d) * (1 + (d.kill ? 0.5 : 0.35) * pk);
    const rv = Math.round(d.value);
    if (rv !== d.shownVal) { d.shownVal = rv; d.shown = String(rv); d.num.textContent = d.shown; }
    const col = d.kill ? DMG_COL.kill : d.head ? DMG_COL.head : d.shield ? DMG_COL.shield : DMG_COL.body;
    if (col !== d.col) { d.el.style.color = col; d.col = col; }
    const tagOn = d.broke && !d.kill;         // the kill supersedes the BREAK tag
    if (tagOn !== d.tagOn) { d.tag.style.display = tagOn ? "inline" : "none"; d.tagOn = tagOn; }
    if (!d.disp) { d.el.style.display = "block"; d.disp = true; }
    const tf = "translate(" + sx.toFixed(0) + "px," + sy.toFixed(0) + "px) translateY(-50%) scale(" + s.toFixed(2) + ")";
    if (tf !== d.tf) { d.el.style.transform = tf; d.tf = tf; }
    const op = fl > 0 ? (1 - fl).toFixed(2) : "1";
    if (op !== d.op) { d.el.style.opacity = op; d.op = op; }
  }
}

export function update(W, dt) {
  // startMatch clears every scene group — re-adopt the particle mesh or NO
  // particle (muzzle flash / tracer / impact / explosion) ever renders
  // in a match (root cause of "when shooting i dont see bullets")
  if (inst && !inst.parent) W.group("fx").add(inst);
  // particles. Matrices are written straight into the instance array (no Object3D, no quaternion, no
  // allocation): a billboard needs only a position and a size (the vertex shader faces the camera), a
  // tracer a size (width), a position and its axis (direction * length) in column 2.
  let nLive = 0;
  const m = inst.instanceMatrix.array, ia = iAttr.array;
  for (let i = 0; i < N; i++) {
    const p = parts[i];
    if (!p.alive) continue;
    p.life -= dt;
    const o = i * 16, q = i * 4;
    if (p.life <= 0) {
      p.alive = false;
      parkSlot(m, i);
      continue;
    }
    nLive++;
    p.vel.y += p.gravity * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.pos.addScaledVector(p.vel, dt);
    const k = p.life / p.life0;
    const st = p.st;
    m[o + 12] = p.pos.x; m[o + 13] = p.pos.y; m[o + 14] = p.pos.z; m[o + 15] = 1;
    if (p.dir) {
      // tracer: width in column 0, flight axis * length in column 2; holds full strength, then a quick fade
      const len = p.stretch;
      m[o] = p.size; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = 0; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = p.dir.x * len; m[o + 9] = p.dir.y * len; m[o + 10] = p.dir.z * len; m[o + 11] = 0;
      ia[q + 1] = p.a0 * (k > 0.25 ? 1 : k * 4);
    } else {
      const sz = p.size * sQs[st] * (sS1[st] + (1 - sS1[st]) * k);
      m[o] = sz; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = sz; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = sz; m[o + 11] = 0;
      // dust / smoke fade IN quickly then out; sparks and chips just fade out
      ia[q + 1] = p.a0 * (sFadeIn[st] ? Math.min(1, (1 - k) * 12) * k : (k < 0.6 ? k / 0.6 : 1));
      p.spin += p.spinV * dt;
      ia[q + 3] = p.spin;
    }
  }
  // The pool used to submit all 1024 boxes (12,288 tris) and re-upload the full
  // 64 KB instance matrix EVERY frame — ~3.9 MB/s at 60 fps sitting on the menu
  // with not one particle alive. count 0 makes three.js skip the draw call
  // outright, and the upload now only costs anything on a frame that actually
  // wrote a matrix. Parked matrices written on a skipped frame are still in the
  // CPU-side array, so the next needsUpdate ships them. It has to be all-or-
  // nothing (N, not a live high-water mark): spawn() wraps around the ring, so
  // live particles are scattered across the whole index range, not packed low.
  if (nLive === 0) {
    inst.count = 0;
  } else {
    inst.count = N;
    inst.instanceMatrix.needsUpdate = true;
    iAttr.needsUpdate = true;
  }

  // explosion flash + ground shockwave (pooled, 4 concurrent)
  for (const b of blasts) {
    if (b.t > 0.45) continue;
    b.t += dt;
    const k = Math.min(1, b.t / 0.09);
    const s = b.R * 2.2 * (0.25 + 0.75 * k);
    b.sp.scale.set(s, s, 1);
    b.sp.material.opacity = b.t < 0.09 ? 1 : Math.max(0, 1 - (b.t - 0.09) / 0.16);
    const rk = Math.min(1, b.t / 0.25);
    const rs = b.R * (0.2 + 1.4 * rk);
    b.ring.scale.set(rs, rs, rs);
    b.ring.material.opacity = 0.55 * (1 - rk);
    if (b.t > 0.45) { b.sp.visible = false; b.ring.visible = false; }
  }

  // hit flash — scale the SAVED colour up (never lerp to white: BODY_GAIN 3.2
  // already puts these channels above 1, so blending toward white darkens them)
  for (let i = flashing.length - 1; i >= 0; i--) {
    const a = flashing[i];
    a._flashT -= dt;
    const k = Math.max(0, a._flashT / FLASH_S);
    for (const e of a._flashMats) {
      const g  = k > 0 ? 1 + 1.1 * k : 1;
      const mb = k > 0 && a._flashShield ? 1 + 0.5 * k : 1;
      const mr = k > 0 && !a._flashShield ? 1 + 0.6 * k : 1;
      if (e.u) { e.u.value.set(g * mr, g, g * mb); }        // zone-tinted: uniform
      else {                                                 // untinted: legacy path
        e.m.color.copy(e.c);
        if (k > 0) { e.m.color.multiplyScalar(g); e.m.color.r *= mr; e.m.color.b *= mb; }
      }
    }
    if (k <= 0) flashing.splice(i, 1);
  }

  // damage numbers (pooled, one per victim) — only style writes, never a
  // layout read: the view size comes from the C1 cache
  updateDmg(W, dt);

  // Camera shake is CONSUMED by player.js's updateCamera and decayed here, and the frame
  // order in ffg_royale3d.js is player(camera) → weapons(emits shotFired,
  // which raises camShake) → fx. So a kick raised this frame is not read by the
  // camera until the NEXT frame, and the decay used to run unconditionally in
  // between: at 60 fps an SMG kick of 0.045 reached the camera as 0.015 (67%
  // eaten), and at 20 fps the decay term is 0.09 — every pistol/SMG/AR kick was
  // erased to zero before it ever rendered. Skipping the decay on the frame the
  // value ROSE gives the camera one full-strength read. Explosion and hurt shake
  // lost the same frame before; they were just large enough to hide it.
  // Decay lives in player.js updateCamera, which runs BEFORE fx in the frame
  // order, so a kick raised this frame reaches the camera undecayed. Decaying
  // here as well ran it twice per frame and halved every shake's DURATION —
  // measured: sniper 150ms -> 83ms, explosion 283ms -> 150ms. Peak was correct;
  // only the tail was being eaten.
}
