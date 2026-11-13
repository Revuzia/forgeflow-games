/**
 * ASCENDANT — runtime/player/viewmodel.js
 * ---------------------------------------------------------------------------
 * First-person arms + gloves, and the player's contact shadow. CONTRACT §15.
 *
 *   export class Viewmodel {
 *     constructor(scene, camera, theme);   // scene/camera = engine.overlayScene / overlayCamera
 *     update(dt, player);
 *     setTheme(theme);
 *     setVisible(v);
 *   }
 *   export class ContactShadow { ... }     // soft blob under the player, in the WORLD scene
 *
 * Everything is procedural — no GLB, no image files.
 *
 * Build, per hand:
 *   • tapered forearm            LatheGeometry profile (sleeve lip → belly → wrist)
 *   • wrist cuff                 closed LatheGeometry ring, brushed metal
 *   • cuff trim                  raised LatheGeometry crown, per-theme emissive accent
 *   • bevelled palm              chamfered box + knuckle plates + thumb wedge, merged
 *   • 4 fingers + thumb          3 tapered segments each, ALL 30 segments in ONE
 *                                InstancedMesh so the whole viewmodel is 9 draw calls
 *
 * Draw-call budget: 4 meshes × 2 hands + 1 instanced finger mesh = 9. Lights are
 * parented into the viewmodel root so they follow the arms and vanish with them.
 *
 * The root copies the overlay camera's world transform every frame, so the arms are
 * effectively camera-local no matter where the engine parks its overlay camera, and
 * it compensates for the overlay FOV so framing is stable if that FOV ever moves.
 *
 * No per-frame heap allocation in update(): every temporary lives at module scope.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNE } from '../core/tuning.js';
import { clamp, lerp, damp, smoothstep, mulberry32 } from '../core/util.js';

/* ═══════════════════════════════ constants ═══════════════════════════════ */

const DEG = Math.PI / 180;

// Framing reference. core/engine.js runs the viewmodel overlay at a fixed 55° vertical
// FOV, so the pose below is authored for 55° and the compensation factor is exactly 1
// in the real game — the arms stay life-size (a forearm really is ~0.34 m). If the
// overlay FOV ever changes, _fovComp rescales the placement to hold the framing.
const REF_FOV_TAN = Math.tan(55 * DEG * 0.5);

// arm placement in camera space (right arm; the left mirrors on X).
// Puts the wrists near (±0.20, -0.19, -0.40) and the fingertips ~68 % down the
// frame, ~40 % out — hands in the lower thirds, angled inward.
const ARM_X  =  0.274;
const ARM_Y  = -0.262;
const ARM_Z  = -0.076;
const ARM_RX =  0.220;   // tilt the forearm up into frame
const ARM_RY =  0.220;   // ...and inward toward the centre
const ARM_RZ = -0.220;   // roll so the palm faces down / inward

const FOREARM_LEN = 0.340;

// bob / pump
const STRIDE_SLOW = 3.6;   // must match runtime/player/camera.js — used only as a fallback
const STRIDE_FAST = 6.4;   // when the FPCamera handle is not reachable
const BOB_MIN_SPEED = 0.55;

// finger curl
const CURL_REST      = 0.42;   // relaxed running curl
const CURL_APEX      = 0.16;   // opens at the jump apex
const CURL_CLENCH    = 0.82;   // clench on landing
const CURL_SPREAD    = 0.24;   // splayed while falling / reaching for a wall
const CURL_MAX_ANGLE = 100 * DEG;
const JOINT_CURL     = [0.62, 0.95, 0.80];
const THUMB_CURL     = [0.45, 0.70, 0.60];

// digit layout, right hand, palm-local metres (palm faces -Y, fingers run -Z)
const DIGITS = [
  { x: -0.0300, y:  0.0030, z: -0.0860, spread:  0.115, curlBias: 0.00,
    lens: [0.0300, 0.0240, 0.0190], rads: [0.0116, 0.0102, 0.0088] },
  { x: -0.0100, y:  0.0040, z: -0.0905, spread:  0.030, curlBias: 0.05,
    lens: [0.0325, 0.0260, 0.0200], rads: [0.0121, 0.0107, 0.0091] },
  { x:  0.0100, y:  0.0030, z: -0.0870, spread: -0.055, curlBias: 0.10,
    lens: [0.0295, 0.0240, 0.0182], rads: [0.0114, 0.0100, 0.0086] },
  { x:  0.0290, y:  0.0015, z: -0.0790, spread: -0.140, curlBias: 0.17,
    lens: [0.0245, 0.0195, 0.0150], rads: [0.0099, 0.0088, 0.0076] },
];
const THUMB = {
  x: -0.0430, y: -0.0055, z: -0.0250,
  lens: [0.0265, 0.0215, 0.0170], rads: [0.0136, 0.0117, 0.0099],
};

const SEGS_PER_HAND = 15;
const SEG_TOTAL     = SEGS_PER_HAND * 2;

// theme accent fallbacks (used when a bare theme id is handed in)
const THEME_ACCENT = {
  neon:    0x35e2ff,
  foundry: 0xff7a2a,
  spire:   0x9fe4ff,
  temple:  0xffd489,
  hub:     0x7ef0ff,
};
const DEFAULT_ACCENT = 0x6fd8ff;

/* ═══════════════════════════════ scratch ═══════════════════════════════ */

const _m4a  = new THREE.Matrix4();
const _m4b  = new THREE.Matrix4();
const _vScl = new THREE.Vector3();
const _v3a  = new THREE.Vector3();
const _v3b  = new THREE.Vector3();
const _v3c  = new THREE.Vector3();
const _qa   = new THREE.Quaternion();
const _col  = new THREE.Color();
const _box3 = new THREE.Box3();
const _hits = [];

const DOWN     = new THREE.Vector3(0, -1, 0);
const PLANE_N  = new THREE.Vector3(0, 0, 1);
const AXIS_TMP  = [0, 0, 0];
const _rayO     = [0, 0, 0];
const _rayD     = [0, 0, 0];
const _rayHalf  = [0, 0, 0];

/* ═══════════════════════════ procedural textures ═══════════════════════════ */

let _texCache = null;
let _assetRefs = 0;

function dataTexture(size, bytes, srgb) {
  const t = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tileable value-noise field in [0,1]. `freq` lattice cells across the map. */
function noiseField(size, freq, seed) {
  const rng = mulberry32(seed >>> 0);
  const g = new Float32Array(freq * freq);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(size * size);
  const s = freq / size;
  for (let y = 0; y < size; y++) {
    const fy = y * s;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ry0 = ((y0 % freq) + freq) % freq;
    const ry1 = (ry0 + 1) % freq;
    for (let x = 0; x < size; x++) {
      const fx = x * s;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const rx0 = ((x0 % freq) + freq) % freq;
      const rx1 = (rx0 + 1) % freq;
      const a = g[ry0 * freq + rx0], b = g[ry0 * freq + rx1];
      const c = g[ry1 * freq + rx0], d = g[ry1 * freq + rx1];
      const top = a + (b - a) * sx;
      const bot = c + (d - c) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

/** Anisotropic tileable noise — `fx` cells across, `fy` cells down. Brushed-metal streaks. */
function noiseFieldAniso(size, fx, fy, seed) {
  const rng = mulberry32(seed >>> 0);
  const g = new Float32Array(fx * fy);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(size * size);
  const sxr = fx / size, syr = fy / size;
  for (let y = 0; y < size; y++) {
    const vy = y * syr;
    const y0 = Math.floor(vy);
    const ty = vy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ry0 = ((y0 % fy) + fy) % fy;
    const ry1 = (ry0 + 1) % fy;
    for (let x = 0; x < size; x++) {
      const vx = x * sxr;
      const x0 = Math.floor(vx);
      const tx = vx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const rx0 = ((x0 % fx) + fx) % fx;
      const rx1 = (rx0 + 1) % fx;
      const a = g[ry0 * fx + rx0], b = g[ry0 * fx + rx1];
      const c = g[ry1 * fx + rx0], d = g[ry1 * fx + rx1];
      const top = a + (b - a) * sx;
      const bot = c + (d - c) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

function fbm(size, baseFreq, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, f = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const layer = noiseField(size, Math.max(2, Math.round(f)), seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  const inv = 1 / norm;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** Height field → tangent-space normal map bytes (tileable, wrapped sampling). */
function heightToNormal(height, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = ((x - 1) + size) % size;
      const xp = (x + 1) % size;
      const l = height[y * size + xm];
      const r = height[y * size + xp];
      const d = height[ym * size + x];
      const u = height[yp * size + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      out[i]     = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Technical-glove weave: interleaved warp/weft threads, fine grain, stitch seams.
 * Returns { height, albedo, rough } byte buffers / float field.
 */
function buildGloveMaps(size) {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const rough  = new Uint8Array(size * size * 4);

  const grain = fbm(size, 26, 4, 0x51f7);
  const blotch = fbm(size, 5, 3, 0x2ac1);

  const W = 14;                 // weave cells across the tile
  const stitchRows = 3;

  for (let y = 0; y < size; y++) {
    const v = (y / size) * W;
    const cv = v - Math.floor(v);
    const iv = Math.floor(v);
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const u = (x / size) * W;
      const cu = u - Math.floor(u);
      const iu = Math.floor(u);

      // rounded thread cross-sections
      const tu = Math.sin(Math.PI * cu);
      const tv = Math.sin(Math.PI * cv);
      const over = ((iu + iv) & 1) === 0;
      let h = over ? (tu * 0.92 + tv * 0.30) : (tv * 0.92 + tu * 0.30);
      h *= 0.62;

      // fine fibre grain + slow wear blotches
      h += (grain[idx] - 0.5) * 0.30;
      const wear = blotch[idx];

      // stitch seams — raised double lines across the tile
      let stitch = 0;
      for (let s = 0; s < stitchRows; s++) {
        const sy = (s + 0.5) / stitchRows;
        const dy = Math.abs((y / size) - sy);
        const dd = Math.min(dy, 1 - dy);
        if (dd < 0.016) {
          const dash = ((x / size) * 42) % 1 < 0.62 ? 1 : 0.25;
          stitch = Math.max(stitch, (1 - dd / 0.016) * dash);
        }
      }
      h += stitch * 0.55;
      height[idx] = h;

      // albedo — dark blue-charcoal technical fabric
      const shade = 0.62 + h * 0.42 - (1 - wear) * 0.10;
      const r = clamp(0.116 * shade + stitch * 0.085, 0, 1);
      const g = clamp(0.128 * shade + stitch * 0.090, 0, 1);
      const b = clamp(0.152 * shade + stitch * 0.100, 0, 1);
      const o = idx * 4;
      albedo[o]     = Math.round(Math.pow(r, 1 / 2.2) * 255);
      albedo[o + 1] = Math.round(Math.pow(g, 1 / 2.2) * 255);
      albedo[o + 2] = Math.round(Math.pow(b, 1 / 2.2) * 255);
      albedo[o + 3] = 255;

      // roughness — spec says 0.55; weave valleys polish slightly, stitches are matte
      const rgh = clamp(0.55 - h * 0.11 + (wear - 0.5) * 0.09 + stitch * 0.14, 0.30, 0.86);
      const rb = Math.round(rgh * 255);
      rough[o] = rb; rough[o + 1] = rb; rough[o + 2] = rb; rough[o + 3] = 255;
    }
  }
  return { height, albedo, rough };
}

/** Brushed metal: circumferential streaks + micro pitting. */
function buildMetalMaps(size) {
  const height = new Float32Array(size * size);
  const rough  = new Uint8Array(size * size * 4);

  const streak = noiseFieldAniso(size, 4, 148, 0x77a2);
  const streak2 = noiseFieldAniso(size, 9, 72, 0x1de4);
  const pits = fbm(size, 40, 3, 0x9f31);

  for (let i = 0; i < size * size; i++) {
    const s = streak[i] * 0.62 + streak2[i] * 0.38;
    const h = (s - 0.5) * 0.75 + (pits[i] - 0.5) * 0.22;
    height[i] = h;
    const rgh = clamp(0.25 + (s - 0.5) * 0.20 + (pits[i] - 0.5) * 0.10, 0.10, 0.52);
    const rb = Math.round(rgh * 255);
    const o = i * 4;
    rough[o] = rb; rough[o + 1] = rb; rough[o + 2] = rb; rough[o + 3] = 255;
  }
  return { height, rough };
}

function getTextures() {
  if (_texCache) return _texCache;
  const GS = 256, MS = 128;

  const glove = buildGloveMaps(GS);
  const metal = buildMetalMaps(MS);

  _texCache = {
    gloveMap:    dataTexture(GS, glove.albedo, true),
    gloveNormal: dataTexture(GS, heightToNormal(glove.height, GS, 2.6), false),
    gloveRough:  dataTexture(GS, glove.rough, false),
    metalNormal: dataTexture(MS, heightToNormal(metal.height, MS, 1.7), false),
    metalRough:  dataTexture(MS, metal.rough, false),
  };
  return _texCache;
}

/* ═══════════════════════════ geometry helpers ═══════════════════════════ */

function scaleUV(geo, su, sv) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geo;
}

/** LatheGeometry from [radius, along] pairs, re-aimed so it runs along -Z. */
function latheAlongZ(profile, segments, su, sv) {
  const pts = [];
  for (let i = 0; i < profile.length; i++) pts.push(new THREE.Vector2(profile[i][0], profile[i][1]));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(-Math.PI / 2);          // +Y → -Z (rotate transforms normals too)
  scaleUV(g, su, sv);
  return g;
}

/**
 * Chamfered box — 6 inset faces, 12 edge bevels, 8 corner triangles.
 * Non-indexed so computeVertexNormals() gives crisp per-facet shading.
 * Winding is fixed by testing each facet normal against its centroid (convex, origin-centred).
 */
function chamferBoxGeometry(w, h, d, c, uvScale = 26) {
  const hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
  const cc = Math.min(c, hw * 0.9, hh * 0.9, hd * 0.9);
  const pos = [];

  // corner vertex triples: A on ±X plane, B on ±Y plane, C on ±Z plane
  const A = (sx, sy, sz) => [sx * hw, sy * (hh - cc), sz * (hd - cc)];
  const B = (sx, sy, sz) => [sx * (hw - cc), sy * hh, sz * (hd - cc)];
  const C = (sx, sy, sz) => [sx * (hw - cc), sy * (hh - cc), sz * hd];

  const pushTri = (p0, p1, p2) => {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const cx = (p0[0] + p1[0] + p2[0]) / 3;
    const cy = (p0[1] + p1[1] + p2[1]) / 3;
    const cz = (p0[2] + p1[2] + p2[2]) / 3;
    if (nx * cx + ny * cy + nz * cz < 0) { const t = p1; p1 = p2; p2 = t; }
    pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
  };
  const pushQuad = (q0, q1, q2, q3) => { pushTri(q0, q1, q2); pushTri(q0, q2, q3); };

  // ── 6 faces ──
  for (const sx of [-1, 1]) {
    pushQuad(A(sx, -1, -1), A(sx, -1, 1), A(sx, 1, 1), A(sx, 1, -1));
  }
  for (const sy of [-1, 1]) {
    pushQuad(B(-1, sy, -1), B(1, sy, -1), B(1, sy, 1), B(-1, sy, 1));
  }
  for (const sz of [-1, 1]) {
    pushQuad(C(-1, -1, sz), C(1, -1, sz), C(1, 1, sz), C(-1, 1, sz));
  }

  // ── 12 edge bevels ──
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {            // along Z
    pushQuad(A(sx, sy, -1), A(sx, sy, 1), B(sx, sy, 1), B(sx, sy, -1));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {            // along Y
    pushQuad(A(sx, -1, sz), A(sx, 1, sz), C(sx, 1, sz), C(sx, -1, sz));
  }
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) {            // along X
    pushQuad(B(-1, sy, sz), B(1, sy, sz), C(1, sy, sz), C(-1, sy, sz));
  }

  // ── 8 corners ──
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pushTri(A(sx, sy, sz), B(sx, sy, sz), C(sx, sy, sz));
  }

  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(pos);
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();

  // triplanar-ish UVs from the dominant normal axis of each triangle
  const nAttr = g.getAttribute('normal');
  const uv = new Float32Array((arr.length / 3) * 2);
  for (let t = 0; t < arr.length / 9; t++) {
    const i0 = t * 3;
    const nx = Math.abs(nAttr.getX(i0)), ny = Math.abs(nAttr.getY(i0)), nz = Math.abs(nAttr.getZ(i0));
    let a = 0, b = 1;
    if (nx >= ny && nx >= nz) { a = 2; b = 1; }
    else if (ny >= nx && ny >= nz) { a = 0; b = 2; }
    else { a = 0; b = 1; }
    for (let k = 0; k < 3; k++) {
      const vi = i0 + k;
      uv[vi * 2]     = arr[vi * 3 + a] * uvScale;
      uv[vi * 2 + 1] = arr[vi * 3 + b] * uvScale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/* ── shared geometry (built once, ref-counted) ────────────────────────────── */

let _geoCache = null;

function buildGeometry() {
  if (_geoCache) return _geoCache;

  // forearm: rolled sleeve lip at the elbow, belly, taper into the wrist
  const forearm = latheAlongZ([
    [0.0000, 0.0000],
    [0.0480, 0.0000],
    [0.0575, 0.0090],
    [0.0620, 0.0210],
    [0.0562, 0.0400],
    [0.0578, 0.0900],
    [0.0566, 0.1450],
    [0.0524, 0.2050],
    [0.0472, 0.2620],
    [0.0442, 0.2980],
    [0.0432, 0.3180],
    [0.0330, 0.3340],
    [0.0000, 0.3400],
  ], 26, 9, 9);

  // wrist cuff: closed annulus shell, brushed metal
  const cuff = latheAlongZ([
    [0.0462, 0.0000],
    [0.0540, 0.0060],
    [0.0566, 0.0160],
    [0.0566, 0.0340],
    [0.0540, 0.0442],
    [0.0462, 0.0500],
    [0.0436, 0.0500],
    [0.0424, 0.0340],
    [0.0424, 0.0160],
    [0.0436, 0.0060],
    [0.0462, 0.0000],
  ], 28, 10, 1);

  // emissive accent crown proud of the cuff
  const trim = latheAlongZ([
    [0.0572, 0.0180],
    [0.0614, 0.0222],
    [0.0622, 0.0250],
    [0.0614, 0.0278],
    [0.0572, 0.0320],
    [0.0572, 0.0180],
  ], 28, 8, 1);

  // finger segment: unit length along -Z, unit radius, rounded both ends
  const seg = latheAlongZ([
    [0.00, 0.00],
    [0.55, 0.02],
    [0.85, 0.05],
    [0.98, 0.10],
    [0.96, 0.35],
    [0.90, 0.65],
    [0.82, 0.85],
    [0.72, 0.93],
    [0.48, 0.98],
    [0.00, 1.00],
  ], 12, 2, 1);

  // palm assemblies (thumb wedge side differs, so one per hand)
  const palms = {};
  for (const side of [1, -1]) {
    const parts = [];

    const block = chamferBoxGeometry(0.0880, 0.0340, 0.0930, 0.0105);
    block.translate(0, 0, -0.0455);
    parts.push(block);

    // knuckle plates across the back of the hand (+Y)
    const kx = [-0.0295, -0.0098, 0.0098, 0.0288];
    const kz = [-0.0770, -0.0800, -0.0775, -0.0705];
    const kw = [0.0186, 0.0192, 0.0180, 0.0158];
    for (let i = 0; i < 4; i++) {
      const kn = chamferBoxGeometry(kw[i], 0.0105, 0.0250, 0.0038, 34);
      kn.translate(kx[i] * side, 0.0192, kz[i]);
      parts.push(kn);
    }

    // wrist guard bridging the sleeve into the hand — corners peek out of the round
    // sleeve, which is what sells the junction as hardware rather than a seam
    const wp = chamferBoxGeometry(0.0860, 0.0300, 0.0260, 0.0090);
    wp.translate(0, 0.0010, 0.0040);
    parts.push(wp);

    // thenar / thumb-base wedge
    const tb = chamferBoxGeometry(0.0300, 0.0290, 0.0440, 0.0090);
    tb.rotateY(side * 0.32);
    tb.rotateZ(side * 0.16);
    tb.translate(-0.0335 * side, -0.0022, -0.0300);
    parts.push(tb);

    // palm pad (underside, -Y)
    const pad = chamferBoxGeometry(0.0700, 0.0080, 0.0560, 0.0032, 34);
    pad.translate(0, -0.0175, -0.0500);
    parts.push(pad);

    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    merged.computeVertexNormals();
    palms[side] = merged;
  }

  _geoCache = { forearm, cuff, trim, seg, palmR: palms[1], palmL: palms[-1] };
  return _geoCache;
}

function resolveAccent(theme) {
  if (theme && typeof theme === 'object') {
    const p = theme.palette;
    const a = p && (p.accent !== undefined ? p.accent : p.checkpointOn);
    if (a !== undefined && a !== null) return a;
    if (theme.id && THEME_ACCENT[theme.id] !== undefined) return THEME_ACCENT[theme.id];
  } else if (typeof theme === 'string' && THEME_ACCENT[theme] !== undefined) {
    return THEME_ACCENT[theme];
  }
  return DEFAULT_ACCENT;
}

/* ═══════════════════════════════ spring ═══════════════════════════════ */

/** Second-order spring. Substepped so a long frame can never destabilise it. */
class Spring {
  constructor(k, zeta, x = 0) {
    this.k = k; this.z = zeta;
    this.c = 2 * zeta * Math.sqrt(k);   // hoisted: no Math.sqrt per substep
    this.x = x; this.v = 0; this.t = x;
  }
  set(x) { this.x = x; this.v = 0; }
  kick(v) { this.v += v; }
  step(dt) {
    const k = this.k;
    const c = this.c;
    let left = dt;
    while (left > 1e-6) {
      const h = left > 0.004166 ? 0.004166 : left;
      left -= h;
      this.v += (-k * (this.x - this.t) - c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

function shortestAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ═══════════════════════════════ Viewmodel ═══════════════════════════════ */

export class Viewmodel {
  /**
   * @param {THREE.Scene}  scene   engine.overlayScene
   * @param {THREE.Camera} camera  engine.overlayCamera
   * @param {object|string} theme  ThemeDef (or a theme id)
   */
  constructor(scene, camera, theme = null) {
    this.scene  = scene;
    this.camera = camera;

    _assetRefs++;
    const tex = getTextures();
    const geo = buildGeometry();
    this._tex = tex;
    this._geo = geo;

    this._accent = new THREE.Color(resolveAccent(theme));

    // ── materials (3, shared by both hands) ────────────────────────────────
    this.gloveMat = new THREE.MeshPhysicalMaterial({
      map: tex.gloveMap,
      normalMap: tex.gloveNormal,
      roughnessMap: tex.gloveRough,
      roughness: 0.55,
      metalness: 0.06,
      sheen: 0.6,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0x2a3446),
      normalScale: new THREE.Vector2(0.85, 0.85),
      envMapIntensity: 0.6,
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0x6d7684,
      normalMap: tex.metalNormal,
      roughnessMap: tex.metalRough,
      roughness: 0.25,
      metalness: 0.90,
      emissive: this._accent.clone().multiplyScalar(0.055),
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: this._accent.clone().multiplyScalar(0.38),
      emissive: this._accent.clone(),
      emissiveIntensity: 0.55,
      roughness: 0.34,
      metalness: 0.0,
      toneMapped: true,
    });

    // ── hierarchy ──────────────────────────────────────────────────────────
    this.root = new THREE.Object3D();
    this.root.name = 'viewmodel';
    this.root.matrixAutoUpdate = true;
    this.root.frustumCulled = false;

    this.sway = new THREE.Object3D();
    this.sway.name = 'viewmodel.sway';
    this.root.add(this.sway);

    this.fingerMesh = new THREE.InstancedMesh(geo.seg, this.gloveMat, SEG_TOTAL);
    this.fingerMesh.frustumCulled = false;
    this.fingerMesh.castShadow = false;
    this.fingerMesh.receiveShadow = false;
    this.fingerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.fingerMesh);

    this._segs = new Array(SEG_TOTAL);
    this.arms = [this._buildArm(1), this._buildArm(-1)];

    this._buildLights();

    // ── motion state ───────────────────────────────────────────────────────
    this.swayX   = new Spring(260, 0.68);   // lag-then-catch-up: underdamped on purpose
    this.swayY   = new Spring(260, 0.68);
    this.swayRX  = new Spring(220, 0.66);
    this.swayRY  = new Spring(220, 0.66);
    this.swayRZ  = new Spring(200, 0.68);
    this.tuck    = new Spring(150, 0.90);
    this.spread  = new Spring(110, 0.85);
    this.landS   = new Spring(420, 0.68);   // peak 1.0 at v0 = 44, ~2 % residual by 280 ms
    this.crouchS = new Spring(150, 0.95);
    this.moveS   = new Spring(90, 1.00);
    this.sprintS = new Spring(70, 1.00);
    this.curlS   = new Spring(190, 0.80, CURL_REST);
    this._springs = [
      this.swayX, this.swayY, this.swayRX, this.swayRY, this.swayRZ,
      this.tuck, this.spread, this.landS, this.crouchS, this.moveS, this.sprintS, this.curlS,
    ];

    this._t = 0;
    this._bobPhase = 0;
    this._lastYaw = null;
    this._lastPitch = null;
    this._wasGrounded = true;
    this._prevVy = 0;
    this._fovComp = 1;
    this._visible = true;

    this.scene.add(this.root);
    this._syncToCamera();
    this._writeSegments();
  }

  /* ─────────────────────────── construction ─────────────────────────── */

  _buildArm(side) {
    const geo = this._geo;
    const g = new THREE.Object3D();
    g.name = side > 0 ? 'arm.R' : 'arm.L';
    this.sway.add(g);

    const forearm = new THREE.Mesh(geo.forearm, this.gloveMat);
    forearm.frustumCulled = false;
    g.add(forearm);

    const cuff = new THREE.Mesh(geo.cuff, this.metalMat);
    cuff.position.set(0, 0, -0.268);
    cuff.frustumCulled = false;
    g.add(cuff);

    const trim = new THREE.Mesh(geo.trim, this.trimMat);
    trim.position.copy(cuff.position);
    trim.frustumCulled = false;
    g.add(trim);

    // wrist joint at the end of the forearm
    const wrist = new THREE.Object3D();
    wrist.position.set(0, 0, -FOREARM_LEN + 0.006);
    g.add(wrist);

    const hand = new THREE.Object3D();
    wrist.add(hand);

    const palm = new THREE.Mesh(side > 0 ? geo.palmR : geo.palmL, this.gloveMat);
    palm.frustumCulled = false;
    hand.add(palm);

    // digits
    const base = side > 0 ? 0 : SEGS_PER_HAND;
    let n = base;
    const digits = [];
    for (let f = 0; f < DIGITS.length; f++) {
      const d = DIGITS[f];
      const chain = [];
      let parent = hand;
      for (let j = 0; j < 3; j++) {
        const joint = new THREE.Object3D();
        if (j === 0) {
          joint.position.set(d.x * side, d.y, d.z);
          joint.rotation.set(0, d.spread * side, 0);
        } else {
          joint.position.set(0, 0, -d.lens[j - 1]);
        }
        parent.add(joint);
        parent = joint;
        this._segs[n] = { joint, len: d.lens[j], rad: d.rads[j] };
        chain.push({ joint, factor: JOINT_CURL[j], restY: j === 0 ? d.spread * side : 0 });
        n++;
      }
      digits.push({ chain, curlBias: d.curlBias, isThumb: false });
    }
    {
      const d = THUMB;
      const chain = [];
      let parent = hand;
      for (let j = 0; j < 3; j++) {
        const joint = new THREE.Object3D();
        if (j === 0) {
          joint.position.set(d.x * side, d.y, d.z);
          joint.rotation.set(0.22, side * 0.62, side * 0.78);
        } else {
          joint.position.set(0, 0, -d.lens[j - 1]);
        }
        parent.add(joint);
        parent = joint;
        this._segs[n] = { joint, len: d.lens[j], rad: d.rads[j] };
        chain.push({ joint, factor: THUMB_CURL[j], restY: 0 });
        n++;
      }
      digits.push({ chain, curlBias: 0.0, isThumb: true, baseRot: [0.22, side * 0.62, side * 0.78] });
    }

    return {
      side, group: g, wrist, hand, digits,
      reach: new Spring(120, 0.85),
      basePos: [ARM_X * side, ARM_Y, ARM_Z],
      baseRot: [ARM_RX, ARM_RY * side, ARM_RZ * side],
    };
  }

  /**
   * Key + rim, parented into the viewmodel root so they travel with the arms
   * and leave with them on setVisible(false).
   *
   * Two DIRECTIONALS for two forearms, plus one hemisphere. It used to be four
   * — key, rim, a dim blue bounce directional and a hemisphere — and every one
   * was evaluated per fragment across the whole overlay pass.
   *
   * The bounce directional is gone: what it contributed was underside fill,
   * which is exactly what a hemisphere's GROUND colour is, so it folds into
   * this one light instead of costing a second shadowless directional. A flat
   * AmbientLight was tried first (cheaper still — three folds it into a single
   * uniform rather than a loop term) and rejected on the screenshots: it
   * flattened the knuckles, because the top-to-underside gradient is most of
   * what reads as form on a glove that only ever faces the camera.
   *
   * Guarded: these are tuned for an EMPTY overlay scene. If this Viewmodel is
   * handed a populated world scene instead of engine.overlayScene, injecting
   * lights would wreck that scene's lighting and blow its light budget — so in
   * that case we skip them and let the host scene light the arms.
   */
  _buildLights() {
    if (!this._sceneIsOverlay()) { this.lights = null; return; }
    const key = new THREE.DirectionalLight(0xfff1dc, 1.60);
    key.position.set(0.62, 0.95, 0.30);
    key.castShadow = false;
    const keyT = new THREE.Object3D();
    keyT.position.set(-0.05, -0.28, -0.55);
    key.target = keyT;
    this.root.add(key, keyT);

    const rim = new THREE.DirectionalLight(this._accent.clone(), 1.00);
    rim.position.set(-0.85, 0.30, -1.15);
    rim.castShadow = false;
    const rimT = new THREE.Object3D();
    rimT.position.set(0.02, -0.24, -0.42);
    rim.target = rimT;
    this.root.add(rim, rimT);

    /* one hemisphere carrying BOTH the old hemi (0x3d556e/0x11151c @ 0.55) and
     * the old bounce directional (0x5f7fa8 @ 0.75, aimed up from below): the
     * bounce lives in the ground colour, lifted to match. */
    const hemi = new THREE.HemisphereLight(0x3d556e, 0x2c3d55, 0.78);
    this.root.add(hemi);

    this.lights = { key, rim, hemi, bounce: null, ambient: null };
  }

  /** True when `scene` looks like a dedicated viewmodel overlay rather than the world. */
  _sceneIsOverlay() {
    const s = this.scene;
    if (!s) return false;
    if (s.name === 'viewmodel') return true;          // core/engine.js names it this
    const kids = s.children;
    if (!kids) return true;
    let solid = 0;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o || o.isCamera) continue;                 // engine parks overlayCamera here
      if (o === this.root) continue;
      solid++;
    }
    return solid === 0;
  }

  /* ─────────────────────────── public API ─────────────────────────── */

  setTheme(theme) {
    const accent = resolveAccent(theme);
    this._accent.set(accent);
    this.trimMat.color.copy(this._accent).multiplyScalar(0.38);
    this.trimMat.emissive.copy(this._accent);
    this.metalMat.emissive.copy(this._accent).multiplyScalar(0.055);
    if (this.lights && this.lights.rim) {
      this.lights.rim.color.copy(this._accent).lerp(_col.set(0xffffff), 0.35);
    }
    this.trimMat.needsUpdate = true;
    this.metalMat.needsUpdate = true;
  }

  /** Hard on/off — removes the whole subtree so it costs nothing while hidden. */
  setVisible(v) {
    const want = !!v;
    if (want === this._visible) return;
    this._visible = want;
    if (want) {
      this.scene.add(this.root);
      this._lastYaw = null;
      this._lastPitch = null;
      for (let i = 0; i < this._springs.length; i++) { this._springs[i].v = 0; this._springs[i].x = this._springs[i].t; }
      this._syncToCamera();
      this._writeSegments();
    } else {
      this.scene.remove(this.root);
    }
  }

  get visible() { return this._visible; }

  /* ─────────────────────────── update ─────────────────────────── */

  update(dt, player) {
    if (!this._visible) return;
    const d = clamp(Number(dt) || 0, 0, 1 / 15);
    this._t += d;

    // ── read the player ────────────────────────────────────────────────────
    let hSpeed = 0, vy = 0, grounded = true, sprinting = false, crouching = false, wallSliding = false;
    let yaw = this._lastYaw === null ? 0 : this._lastYaw;
    let pitch = this._lastPitch === null ? 0 : this._lastPitch;
    let fp = null;

    if (player) {
      if (player.vel) {
        hSpeed = Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);
        vy = player.vel.y;
      }
      grounded    = !!player.grounded;
      sprinting   = !!player.sprinting;
      crouching   = !!player.crouching;
      wallSliding = !!player.wallSliding;
      if (typeof player.yaw === 'number') yaw = player.yaw;
      if (typeof player.pitch === 'number') pitch = player.pitch;
      fp = player.fpCamera || null;
    }

    // ── bob phase: lock to the camera's when reachable, else mirror its rule ──
    if (fp && typeof fp.bobPhase === 'number') {
      this._bobPhase = fp.bobPhase;
    } else if (grounded && hSpeed > BOB_MIN_SPEED) {
      const stride = lerp(STRIDE_SLOW, STRIDE_FAST, clamp(hSpeed / TUNE.speedSprint, 0, 1));
      this._bobPhase = (this._bobPhase + (Math.PI * 2) * (hSpeed * d) / stride) % (Math.PI * 2);
    }

    // ── look-delta sway ────────────────────────────────────────────────────
    if (this._lastYaw === null) { this._lastYaw = yaw; this._lastPitch = pitch; }
    const invDt = d > 1e-5 ? 1 / d : 0;
    const dYaw = shortestAngle(this._lastYaw, yaw) * invDt;      // rad/s
    const dPitch = (pitch - this._lastPitch) * invDt;
    this._lastYaw = yaw;
    this._lastPitch = pitch;

    this.swayX.t  = clamp(dYaw * 0.0130, -0.060, 0.060);
    this.swayY.t  = clamp(dPitch * 0.0110, -0.048, 0.048);
    this.swayRY.t = clamp(dYaw * 0.0420, -0.180, 0.180);
    this.swayRX.t = clamp(-dPitch * 0.0360, -0.150, 0.150);
    this.swayRZ.t = clamp(-dYaw * 0.0230, -0.110, 0.110);

    // ── locomotion / air state ─────────────────────────────────────────────
    const speed01 = clamp(hSpeed / TUNE.speedRun, 0, 1.35);
    this.moveS.t   = grounded ? speed01 : speed01 * 0.25;
    this.sprintS.t = (sprinting && grounded) ? clamp((hSpeed - TUNE.speedRun) /
                       Math.max(0.001, TUNE.speedSprint - TUNE.speedRun), 0, 1) : 0;
    this.crouchS.t = crouching ? 1 : 0;

    const airborne = !grounded;
    this.tuck.t   = (airborne && vy > 0.4) ? clamp(vy / 6, 0.25, 1) : 0;
    this.spread.t = (airborne && vy < -1.5) ? clamp(-vy / 18, 0, 1) : 0;

    // landing detection (event-free, so it can never double-fire with Game)
    if (grounded && !this._wasGrounded) {
      const impact = clamp(Math.abs(this._prevVy) / 26, 0, 1);
      if (impact > 0.04) {
        this.landS.x = 0;
        this.landS.kick(impact * 44);
        this.curlS.x = Math.max(this.curlS.x, lerp(CURL_REST, CURL_CLENCH, impact));
      }
    }
    this._wasGrounded = grounded;
    if (airborne || Math.abs(vy) > 0.05) this._prevVy = vy;
    this.landS.t = 0;

    // wall slide — pick the hand nearest the wall
    let reachSide = 0;
    if (wallSliding) {
      reachSide = 1;
      const n = (player && player.wallNormal) ||
                (player && player.walls && player.walls[0] && player.walls[0].normal) || null;
      if (n) {
        _v3a.set(Math.cos(yaw), 0, -Math.sin(yaw));                // camera right
        const dot = _v3a.x * n.x + _v3a.z * n.z;
        if (Math.abs(dot) > 0.05) reachSide = dot > 0 ? -1 : 1;    // normal points away from the wall
      }
    }
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i];
      arm.reach.t = (wallSliding && arm.side === reachSide) ? 1 : 0;
      arm.reach.step(d);
    }

    // ── finger curl ────────────────────────────────────────────────────────
    let curlTarget = CURL_REST;
    if (airborne) {
      const apex = 1 - clamp(Math.abs(vy) / 6, 0, 1);          // 1 exactly at the apex
      curlTarget = lerp(CURL_REST, CURL_APEX, apex);
      if (vy < -3) curlTarget = lerp(curlTarget, CURL_SPREAD, clamp(-vy / 18, 0, 1));
    } else {
      curlTarget = lerp(CURL_REST, CURL_REST - 0.10, this.sprintS.x);
    }
    if (wallSliding) curlTarget = lerp(curlTarget, CURL_SPREAD, 0.7);
    if (crouching) curlTarget = lerp(curlTarget, CURL_REST + 0.10, 0.6);
    this.curlS.t = curlTarget;

    // ── step every spring once ─────────────────────────────────────────────
    for (let i = 0; i < this._springs.length; i++) this._springs[i].step(d);

    // ── follow the overlay camera + FOV compensation ───────────────────────
    this._syncToCamera();
    const k = this._fovComp;

    // ── sway group: shared offsets ─────────────────────────────────────────
    const idle = 1 - clamp(this.moveS.x, 0, 1);
    const breathY = Math.sin(this._t * 1.15) * 0.0045 * idle;
    const breathX = Math.sin(this._t * 0.83 + 1.1) * 0.0032 * idle;
    const breathR = Math.sin(this._t * 1.15 + 0.6) * 0.9 * DEG * idle;

    const landDrop = this.landS.x;                             // ~0.0 → 0.1 impulse
    this.sway.position.set(
      (this.swayX.x + breathX) * k,
      (this.swayY.x + breathY - landDrop * 0.040) * k,
      landDrop * 0.014
    );
    this.sway.rotation.set(
      this.swayRX.x + breathR + landDrop * 0.120,
      this.swayRY.x,
      this.swayRZ.x
    );

    // ── per-arm pose ───────────────────────────────────────────────────────
    for (let i = 0; i < this.arms.length; i++) this._poseArm(this.arms[i], k);

    // ── digits ─────────────────────────────────────────────────────────────
    const curl = this.curlS.x;
    for (let i = 0; i < this.arms.length; i++) {
      const digits = this.arms[i].digits;
      for (let f = 0; f < digits.length; f++) {
        const dg = digits[f];
        const c = clamp(curl + dg.curlBias * 0.55, 0, 1.15);
        const a = -c * CURL_MAX_ANGLE;                          // palm faces -Y ⇒ curl is -X
        for (let j = 0; j < dg.chain.length; j++) {
          const link = dg.chain[j];
          if (dg.isThumb && j === 0) {
            link.joint.rotation.set(dg.baseRot[0] + a * link.factor, dg.baseRot[1], dg.baseRot[2]);
          } else if (j === 0) {
            link.joint.rotation.set(a * link.factor, link.restY, 0);
          } else {
            link.joint.rotation.set(a * link.factor, 0, 0);
          }
        }
      }
    }

    this._writeSegments();
  }

  /* ─────────────────────────── internals ─────────────────────────── */

  _syncToCamera() {
    const cam = this.camera;
    const root = this.root;
    if (cam) {
      cam.updateMatrixWorld();
      root.position.setFromMatrixPosition(cam.matrixWorld);
      root.quaternion.setFromRotationMatrix(cam.matrixWorld);
      if (cam.isPerspectiveCamera && cam.fov) {
        this._fovComp = clamp(Math.tan(cam.fov * DEG * 0.5) / REF_FOV_TAN, 0.70, 1.60);
      }
    }
  }

  _poseArm(arm, k) {
    const side = arm.side;
    const bp = arm.basePos, br = arm.baseRot;

    // arm pump, anti-phase to the head bob and opposed between the two arms
    const phase = this._bobPhase + (side > 0 ? Math.PI : 0);
    const amp = clamp(this.moveS.x, 0, 1.35) * (0.0165 + 0.0110 * this.sprintS.x);
    const pumpZ = Math.sin(phase) * amp;
    const pumpY = (0.6366 - Math.abs(Math.cos(phase))) * amp * 0.70;   // mean-zero, 2f
    const pumpR = Math.sin(phase) * clamp(this.moveS.x, 0, 1.35) * (0.150 + 0.100 * this.sprintS.x);

    const tuck   = this.tuck.x;
    const spread = this.spread.x;
    const land   = this.landS.x;
    const crouch = this.crouchS.x;
    const reach  = arm.reach.x;

    let px = bp[0], py = bp[1], pz = bp[2];
    let rx = br[0], ry = br[1], rz = br[2];

    // running pump
    px += pumpZ * 0.16 * side;
    py += pumpY;
    pz += pumpZ;
    rx += pumpR;

    // jump tuck — arms pull in and up
    py += tuck * 0.052;
    pz += tuck * 0.034;
    px -= tuck * 0.016 * side;
    rx += tuck * 0.34;
    rz -= tuck * 0.10 * side;

    // fall spread — arms fly out and back
    px += spread * 0.050 * side;
    py -= spread * 0.030;
    pz += spread * 0.020;
    rx -= spread * 0.18;
    rz += spread * 0.38 * side;
    ry -= spread * 0.16 * side;

    // landing compress — fast squash, then settle
    py -= land * 0.055;
    pz += land * 0.020;
    rx += land * 0.340;

    // crouch — the camera drops, so the arms rise relative to it and pull in
    py += crouch * 0.030;
    pz += crouch * 0.020;
    rx += crouch * 0.10;

    // wall slide — the near hand reaches out and plants on the wall
    px += reach * 0.085 * side;
    py += reach * 0.075;
    pz -= reach * 0.120;
    ry -= reach * 0.62 * side;
    rx += reach * 0.30;
    rz -= reach * 0.38 * side;

    arm.group.position.set(px * k, py * k, pz);
    arm.group.rotation.set(rx, ry, rz);
    arm.group.scale.setScalar(k);

    // a touch of wrist follow-through on impacts and tucks
    arm.wrist.rotation.set(land * 0.240 - tuck * 0.22 + spread * 0.16, 0, 0);
  }

  /**
   * Push every finger-segment joint into the shared InstancedMesh.
   * Instance matrices are root-local: root⁻¹ · jointWorld, then scaled to the
   * segment's radius/length (the unit segment spans z ∈ [-1, 0], radius 1).
   */
  _writeSegments() {
    // poses were written into the joint hierarchy AFTER the last matrix pass, so
    // refresh the whole subtree before reading any joint's world matrix
    this.root.updateMatrixWorld(true);
    const mesh = this.fingerMesh;
    _m4a.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < SEG_TOTAL; i++) {
      const s = this._segs[i];
      if (!s) continue;
      _m4b.multiplyMatrices(_m4a, s.joint.matrixWorld);
      _vScl.set(s.rad, s.rad, s.len);
      _m4b.scale(_vScl);
      mesh.setMatrixAt(i, _m4b);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /* ─────────────────────────── teardown ─────────────────────────── */

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.gloveMat.dispose();
    this.metalMat.dispose();
    this.trimMat.dispose();
    this.fingerMesh.dispose();
    _assetRefs = Math.max(0, _assetRefs - 1);
    if (_assetRefs === 0) {
      if (_geoCache) {
        for (const key of Object.keys(_geoCache)) _geoCache[key].dispose();
        _geoCache = null;
      }
      if (_texCache) {
        for (const key of Object.keys(_texCache)) _texCache[key].dispose();
        _texCache = null;
      }
    }
    this._geo = null;
    this._tex = null;
    this._segs.length = 0;
  }
}

/* ═══════════════════════════ ContactShadow ═══════════════════════════ */

let _shadowTex = null;

function shadowTexture(size = 128) {
  if (_shadowTex) return _shadowTex;
  const bytes = new Uint8Array(size * size * 4);
  const grain = fbm(size, 6, 3, 0x3c9a);
  const half = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      let r = Math.sqrt(dx * dx + dy * dy);
      // organic edge: nudge the radius by a little low-frequency noise
      r *= 0.93 + grain[y * size + x] * 0.14;
      // dense core, long soft tail
      const core = 1 - smoothstep(0.0, 0.52, r);
      const tail = 1 - smoothstep(0.10, 1.0, r);
      const a = clamp(core * 0.62 + tail * tail * 0.52, 0, 1);
      const i = (y * size + x) * 4;
      bytes[i] = 255; bytes[i + 1] = 255; bytes[i + 2] = 255;
      bytes[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  _shadowTex = t;
  return t;
}

/**
 * Soft radial blob projected onto whatever is under the player. This is the
 * player's own presence when they look down — the one thing a first-person
 * character otherwise has none of.
 *
 * Ground is found with a downward sweep: `sweepGround` from collide.js when that
 * module exposes one, otherwise an OBB slab sweep over the broadphase (identical
 * result, just done here), otherwise a throttled raycast.
 */
export class ContactShadow {
  /**
   * @param {THREE.Scene} scene  the WORLD scene (not the overlay)
   * @param {object} [opts] {world, radius, maxDist, opacity, color}
   */
  constructor(scene, opts = {}) {
    this.scene   = scene;
    this.world   = opts.world || null;
    this.radius  = opts.radius  !== undefined ? opts.radius  : 0.44;
    this.maxDist = opts.maxDist !== undefined ? opts.maxDist : 6.0;
    this.maxOpacity = opts.opacity !== undefined ? opts.opacity : 0.62;

    this.geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      color: new THREE.Color(opts.color !== undefined ? opts.color : 0x04060b),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'contactShadow';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = true;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._visible = true;
    this._opacity = 0;
    this._scale = this.radius * 2;
    this._rayT = 0;
    this._sweepFn = undefined;      // undefined = not resolved yet, null = unusable
    this._sweepMiss = 0;
    this._raycaster = null;
    this._hitPoint = new THREE.Vector3();
    this._hitNormal = new THREE.Vector3(0, 1, 0);
    this._hasHit = false;

    this._loadSweep();
  }

  setWorld(world) { this.world = world || null; }

  setTheme(theme) {
    // Warm worlds want a slightly warmer shadow so it does not read as a blue hole.
    const t = (theme && typeof theme === 'object') ? theme : null;
    const fog = t && t.fog && t.fog.color;
    if (fog !== undefined && fog !== null) {
      _col.set(fog);
      this.mat.color.copy(_col).multiplyScalar(0.10);
    } else {
      this.mat.color.set(0x04060b);
    }
  }

  setVisible(v) {
    const want = !!v;
    if (want === this._visible) return;
    this._visible = want;
    if (want) { this.scene.add(this.mesh); }
    else { this.mesh.visible = false; if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
  }

  /**
   * @param {number} dt
   * @param {object} player  needs .pos (feet) / .renderPos and optionally .dead
   * @param {object} [world] {broadphase, killVolumes} — overrides the stored world
   */
  update(dt, player, world = null) {
    if (!this._visible) return;
    if (world) this.world = world;
    const mesh = this.mesh;
    const p = player && (player.renderPos || player.pos);
    if (!p || (player && player.dead)) { mesh.visible = false; return; }

    const d = clamp(Number(dt) || 0, 0, 1 / 15);
    this._rayT += d;

    const found = this._sweep(p.x, p.y + 0.18, p.z);
    if (!found) {
      this._opacity = damp(this._opacity, 0, 14, d);
      if (this._opacity < 0.004) { mesh.visible = false; return; }
    }

    const gp = this._hitPoint;
    const gn = this._hitNormal;
    const dist = Math.max(0, p.y - gp.y);
    const t = clamp(dist / this.maxDist, 0, 1);
    const fade = 1 - smoothstep(0, 1, t);

    // spread and soften with altitude, tighten and darken on contact
    const wantScale = this.radius * 2 * (1 + t * 1.35);
    const wantOp = found ? this.maxOpacity * fade * fade : 0;

    this._scale   = damp(this._scale, wantScale, 16, d);
    this._opacity = damp(this._opacity, wantOp, 16, d);

    if (this._opacity < 0.004) { mesh.visible = false; return; }
    mesh.visible = true;
    this.mat.opacity = this._opacity;

    // lift along the ground normal so it can never z-fight with the surface
    mesh.position.set(gp.x + gn.x * 0.02, gp.y + gn.y * 0.02, gp.z + gn.z * 0.02);
    _qa.setFromUnitVectors(PLANE_N, gn);
    mesh.quaternion.copy(_qa);
    mesh.scale.set(this._scale, this._scale, 1);
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this._raycaster = null;
  }

  /* ── ground finding ── */

  _loadSweep() {
    // collide.js is written by another module; pull its sweep in without a static
    // binding so a signature we cannot see can never take the whole game down.
    import('./collide.js').then((m) => {
      const fn = (m && (m.sweepGround || (m.default && m.default.sweepGround))) || null;
      this._sweepFn = (typeof fn === 'function') ? fn : null;
    }).catch(() => { this._sweepFn = null; });
  }

  _sweep(ox, oy, oz) {
    const fn = this._sweepFn;
    if (typeof fn === 'function') {
      try {
        _v3b.set(ox, oy, oz);
        // collide.js: sweepGround(pos, world, maxDist)
        const r = fn(_v3b, this.world, this.maxDist + 0.4);
        if (this._parseSweep(r)) { this._sweepMiss = 0; return true; }
      } catch (_) {
        this._sweepFn = null;                  // wrong arity / throws — stop asking
      }
    }
    // A miss can mean "no ground here", which is legitimate; only conclude the
    // import is unusable when our own sweep keeps finding ground that it did not.
    const own = this._sweepBroadphase(ox, oy, oz);
    if (own && typeof this._sweepFn === 'function' && ++this._sweepMiss >= 5) this._sweepFn = null;
    if (own) return true;
    return this._sweepRaycast(ox, oy, oz);
  }

  _parseSweep(r) {
    if (r === null || r === undefined || r === false) return false;
    // collide.js returns a REUSED result object that is always populated; `hit` is
    // the only thing that says whether the point means anything.
    if (typeof r === 'object' && r.hit === false) return false;
    if (typeof r === 'number') {
      if (!isFinite(r)) return false;
      this._hitPoint.set(0, r, 0);
      this._hitNormal.set(0, 1, 0);
      this._hasHit = true;
      return true;
    }
    if (typeof r !== 'object') return false;
    const pt = r.point || r.p || r.position ||
               (typeof r.x === 'number' && typeof r.y === 'number' ? r : null);
    if (!pt || typeof pt.y !== 'number') return false;
    this._hitPoint.set(pt.x || 0, pt.y, pt.z || 0);
    const n = r.normal || r.n;
    if (n && typeof n.y === 'number') this._hitNormal.set(n.x || 0, n.y, n.z || 0).normalize();
    else this._hitNormal.set(0, 1, 0);
    this._hasHit = true;
    return true;
  }

  /** Downward OBB slab sweep over the broadphase. Allocation-free. */
  _sweepBroadphase(ox, oy, oz) {
    const w = this.world;
    const bp = w && w.broadphase;
    if (!bp || typeof bp.query !== 'function') return false;

    const reach = this.maxDist + 0.4;
    _box3.min.set(ox - 0.6, oy - reach, oz - 0.6);
    _box3.max.set(ox + 0.6, oy + 0.2, oz + 0.6);
    _hits.length = 0;
    let list = _hits;
    try {
      const r = bp.query(_box3, _hits);
      if (Array.isArray(r)) list = r;
    } catch (_) { return false; }
    if (!list || list.length === 0) return false;

    let bestT = Infinity;
    let bestAxis = 1, bestSign = 1, bestCol = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.active === false || c.solid === false || !c.center || !c.half) continue;
      const t = this._rayCollider(c, ox, oy, oz, reach);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestAxis = AXIS_TMP[0];
        bestSign = AXIS_TMP[1];
        bestCol = c;
      }
    }
    if (!bestCol || !isFinite(bestT)) return false;

    this._hitPoint.set(ox, oy - bestT, oz);
    if (bestAxis < 0) {
      this._hitNormal.set(0, 1, 0);
    } else {
      this._hitNormal.set(0, 0, 0);
      if (bestAxis === 0) this._hitNormal.x = bestSign;
      else if (bestAxis === 1) this._hitNormal.y = bestSign;
      else this._hitNormal.z = bestSign;
      if (bestCol.quat) this._hitNormal.applyQuaternion(bestCol.quat);
      if (this._hitNormal.y < 0.02) this._hitNormal.set(0, 1, 0);
    }
    this._hasHit = true;
    return true;
  }

  /**
   * Ray (origin, straight down) vs an oriented box collider.
   * Returns the hit distance, or -1. Face axis/sign land in AXIS_TMP.
   */
  _rayCollider(c, ox, oy, oz, maxDist) {
    _v3a.set(ox - c.center.x, oy - c.center.y, oz - c.center.z);
    _v3c.copy(DOWN);
    if (c.quat) {
      _qa.copy(c.quat).invert();
      _v3a.applyQuaternion(_qa);
      _v3c.applyQuaternion(_qa);
    }
    const o = _rayO;    o[0] = _v3a.x; o[1] = _v3a.y; o[2] = _v3a.z;
    const dir = _rayD;  dir[0] = _v3c.x; dir[1] = _v3c.y; dir[2] = _v3c.z;
    const half = _rayHalf; half[0] = c.half.x; half[1] = c.half.y; half[2] = c.half.z;

    let tmin = 0, tmax = maxDist, axis = -1, sign = 1;
    for (let a = 0; a < 3; a++) {
      const da = dir[a], oa = o[a], ha = half[a];
      if (Math.abs(da) < 1e-8) {
        if (oa < -ha || oa > ha) return -1;
        continue;
      }
      const inv = 1 / da;
      let tNear = (-ha - oa) * inv;
      let tFar  = (ha - oa) * inv;
      let s = -1;
      if (tNear > tFar) { const tt = tNear; tNear = tFar; tFar = tt; s = 1; }
      if (tNear > tmin) { tmin = tNear; axis = a; sign = s; }
      if (tFar < tmax) tmax = tFar;
      if (tmin > tmax) return -1;
    }
    if (tmin > maxDist) return -1;
    AXIS_TMP[0] = axis;
    AXIS_TMP[1] = sign;
    return tmin;
  }

  /**
   * Last-resort raycast against the stage group. Throttled to ~12 Hz because
   * Raycaster allocates; only reached when no broadphase and no sweepGround exist.
   */
  _sweepRaycast(ox, oy, oz) {
    const w = this.world;
    const target = (w && (w.group || (w.stage && w.stage.group))) || this.scene;
    if (!target) return false;
    if (this._rayT < 0.083 && this._hasHit) return true;
    this._rayT = 0;
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    const rc = this._raycaster;
    _v3b.set(ox, oy, oz);
    rc.set(_v3b, DOWN);
    rc.far = this.maxDist + 0.4;
    rc.near = 0;
    let res = null;
    try { res = rc.intersectObject(target, true); } catch (_) { return this._hasHit; }
    if (!res || res.length === 0) { this._hasHit = false; return false; }
    for (let i = 0; i < res.length; i++) {
      const h = res[i];
      if (!h.object || h.object === this.mesh || h.object.visible === false) continue;
      this._hitPoint.copy(h.point);
      if (h.normal) {
        this._hitNormal.copy(h.normal);
        if (h.object.matrixWorld) {
          this._hitNormal.transformDirection(h.object.matrixWorld);
        }
        if (this._hitNormal.y < 0.02) this._hitNormal.set(0, 1, 0);
      } else {
        this._hitNormal.set(0, 1, 0);
      }
      this._hasHit = true;
      return true;
    }
    this._hasHit = false;
    return false;
  }
}

export default Viewmodel;
