/**
 * royale/maps.js — terrain, POIs, props, colliders, loot points, minimap for
 * the three Last Circle maps. Everything is SEEDED off W.seed so a match seed
 * reproduces the identical world (multiplayer clients build the same map).
 *
 * Exposes on the returned map object:
 *   half, waterY, heightAt(x,z), groundAt(x,z) [terrain only],
 *   colliders (static AABBs + ramps), queryColliders(x,z,r),
 *   lootPoints [{x,y,z,kind,poi}], pois [{id,name,x,z,r}],
 *   randomGroundPos(rng), losBlocked(ax,ay,az,bx,by,bz),
 *   minimap (canvas), themeColor
 */
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// The ?v= query this module was loaded with (ffg_royale3d.js imports every royale module with the SAME query as the boot module, so a deploy can never
// serve stale JS next to fresh JS). A relative `import` drops the query - the new import edges below (towngen.js, citykit.js) are DYNAMIC and carry it.
const _V = (() => { try { return new URL(import.meta.url).search || ""; } catch (e) { return ""; } })();

// Practice uses a random battle map (no dedicated range — owner direction).
// `sun` / `hemi` / `zenith` are per map because all three maps used to share ONE
// hard-coded key light (2.05 warm sun from (90,130,60), grey-green ground bounce)
// — the tropical island, the savanna-desert and the snow-capped forest were lit
// identically, so map identity was carried by a sky hex and a 24% fog spread and
// nothing else. Two constraints on these numbers:
//   • the sun vector must stay ~170 m long — ffg_royale3d.js:263 clones it as the
//     shadow offset and the shadow camera's far plane is 250 (ffg_kernel_3d.js:78),
//     so a longer vector silently drops every shadow in the match.
//   • `zenith` used to be DERIVED as lerp(sky, 0x2f74c8, 0.55) * 0.9. Feeding
//     Savanna's sand horizon (#e7cf98) through that lands on #9d9dac — a grey-
//     lavender ceiling instead of sky. Authored per map now.
// fog is FogExp2: blend = 1 - exp(-(d·density)^2). At the old 0.00045 a POI 800 m
// out was 12% blended — no aerial perspective at all, so the horizon rendered as
// saturated as your feet and distant terrain cut a hard line against the sky.
// At 0.0018: 4.6% at 120 m (engagement range), 12% at 200 m (sniper full-damage
// range), 25% at 300 m, 87% at 800 m. The per-map ORDERING is preserved.
// Nothing gameplay-critical hides behind it — the storm wall, the sky dome and the
// bird sprites all set `fog: false`, and both maps are 2D canvases.
// SKY lane (Wave 4, plan P4.2 step A): the sky / zenith / water hues below were
// desaturated toward steel-blue and muted teal to remove the cyan cast (the
// prototype recipe: pull each channel toward the colour's luma by 35% in LINEAR
// space, 42% for Isla Viva's water, 30% for Deepwood's — it reproduces the plan's
// #9ed0e3 / #5c8dc1 / #80c2ca exactly). Grass, roofs, characters, loot, hemisphere/sun
// colours, exposure and the Neutral tone mapper are deliberately untouched. Savanna
// keeps its golden sand horizon (only a 10% pull; its zenith gets the full 35%)
// because its identity is the dust haze, not a cyan sky. `cloud` is the baked-cloud
// coverage 0..1 (P1.7), per map for identity.
export const MAPS = {
  isla_viva: { name: "Isla Viva", theme: "tropical", sky: "#9ed0e3", zenith: "#5c8dc1", cloud: 0.66, fog: 0.0018, themeColor: "#22d3a0", water: true,
    sun: { pos: [90, 130, 60], color: 0xfff4e0, intensity: 2.05 }, hemi: { sky: 0xdcefff, ground: 0x86a06a, intensity: 1.25 },
    grade: { exposure: 0.72, ground: 0.6, water: 0.6 } },
  ashgrid:   { name: "Savanna", theme: "savanna", sky: "#e5cf9f", zenith: "#6585ab", cloud: 0.54, fog: 0.0019, themeColor: "#e0854a", water: false,
    sun: { pos: [-120, 105, 45], color: 0xffe6b4, intensity: 2.25 }, hemi: { sky: 0xf0e3c4, ground: 0xb59a63, intensity: 1.15 },
    grade: { exposure: 0.80, ground: 0.6, water: 0.6 } },
  deepwood:  { name: "Deepwood", theme: "forest", sky: "#acc5dc", zenith: "#506e9b", cloud: 0.72, fog: 0.0020, themeColor: "#7fb069", water: true,
    sun: { pos: [-60, 150, -80], color: 0xfff6e6, intensity: 1.95 }, hemi: { sky: 0xd2e7ff, ground: 0x63705a, intensity: 1.35 },
    grade: { exposure: 1.14, ground: 0.6, water: 0.6 } },
};
// LC-04 / owner decision OD-2 (2026-10-20, grade "G2 Balanced" from the P1-G A/B sheets): the drop view was 2-2.5x the reference's luminance (0.67-0.81 vs
// 0.32). G2 darkens the GROUND and the WATER (terrain, city ground and tufts x `ground`, water x `water`) and cuts the exposure a little, leaving the sun, the
// sky fill and the environment as they were, so a room keeps its light (the other grades took Isla Viva's interiors to 0.07-0.08). Target: the drop view's
// mean luminance 0.45-0.50 per map (Deepwood measured on its forest half: its snow half stays near-white on purpose), interiors >= 0.15. `exposure` replaces
// the old global 1.15 (NeutralToneMapping is unchanged). The minimap keeps the undarkened palette (it is a 2D map read at a glance, not a lit surface).

const SIZE = 1600;               // meters, square
const HALF = SIZE / 2;

// ── seeded value noise ───────────────────────────────────────────────────────
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
function fbm(x, z, seed, octaves, lac, gain) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}

// ── procedural surface textures (canvas → CanvasTexture) ──────────────────────
// Built once, cached, reused across matches. Gives the flat vertex-colored world
// real texel detail + normal-mapped relief ("high textures") with NO external
// assets and NO credit spend. Albedo is near-WHITE grain so it MULTIPLIES the
// existing per-vertex biome colour / structure colour instead of replacing it.
const _texCache = {};
function _thash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177); return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
function _tfbm(x, y, s, oct) {
  let a = 1, f = 1, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const ix = Math.floor(x * f), iy = Math.floor(y * f), fx = x * f - ix, fy = y * f - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const s00 = _thash(ix, iy, s + i), s10 = _thash(ix + 1, iy, s + i), s01 = _thash(ix, iy + 1, s + i), s11 = _thash(ix + 1, iy + 1, s + i);
    sum += ((s00 + (s10 - s00) * sx) * (1 - sy) + (s01 + (s11 - s01) * sx) * sy) * a;
    n += a; a *= 0.5; f *= 2;
  }
  return sum / n;
}
// Build a tiling height field [0..1], then derive a grayscale albedo + a normal
// map (Sobel, wrap-around so tiles seam). Returns { map, normal } CanvasTextures.
function _fieldTex(key, size, heightFn, albedoFn, aniso, normalStrength) {
  if (_texCache[key]) return _texCache[key];
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = heightFn(x / size, y / size);
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
  // albedo
  const ca = mk(), ga = ca.getContext("2d"), ida = ga.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const g = Math.max(0, Math.min(255, Math.round(albedoFn(H[i]) * 255))); ida.data[i * 4] = g; ida.data[i * 4 + 1] = g; ida.data[i * 4 + 2] = g; ida.data[i * 4 + 3] = 255; }
  ga.putImageData(ida, 0, 0);
  const map = new THREE.CanvasTexture(ca); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = aniso || 4;
  // Three r152+ defaults a CanvasTexture to NoColorSpace, i.e. it is sampled as
  // LINEAR. These canvases are painted in sRGB, so every albedo in the game was
  // being fed to the shader un-decoded: the ground and every structure rendered
  // washed out and flat, which is why the "procedural PBR terrain" read as a
  // single pale green plane on screen. Normal maps must STAY linear (below).
  map.colorSpace = THREE.SRGBColorSpace;
  // normal from height (wrap-around Sobel)
  const cn = mk(), gn = cn.getContext("2d"), idn = gn.createImageData(size, size);
  const at = (x, y) => H[((y % size) + size) % size * size + (((x % size) + size) % size)];
  const st = normalStrength != null ? normalStrength : 2.0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * st, dy = (at(x, y - 1) - at(x, y + 1)) * st;
    let nx = dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4; idn.data[i] = (nx * 0.5 + 0.5) * 255; idn.data[i + 1] = (ny * 0.5 + 0.5) * 255; idn.data[i + 2] = (nz * 0.5 + 0.5) * 255; idn.data[i + 3] = 255;
  }
  gn.putImageData(idn, 0, 0);
  const normal = new THREE.CanvasTexture(cn); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.anisotropy = aniso || 4;
  const out = { map, normal }; _texCache[key] = out; return out;
}
function groundTex(aniso) {
  return _fieldTex("ground", 256,
    (u, v) => _tfbm(u * 9, v * 9, 11, 4) * 0.7 + _tfbm(u * 44, v * 44, 17, 2) * 0.3,
    (h) => 0.84 + h * 0.16, aniso, 3.2);                 // grain 0.84..1.0
}
function structTex(aniso) {
  return _fieldTex("struct", 256,
    (u, v) => {                                          // brick/panel relief
      const R = 6, row = Math.floor(v * R), off = (row % 2) * 0.5, bu = u * 3 + off;
      const mortar = (Math.abs(((v * R) % 1) - 0.5) > 0.42 || Math.abs(((bu % 1) + 1) % 1 - 0.5) > 0.45) ? 1 : 0;
      const grain = _tfbm(u * 16, v * 16, 23, 3);
      return (1 - mortar) * (0.58 + grain * 0.42);
    },
    (h) => 0.88 + h * 0.12, aniso, 4.2);                 // grain 0.88..1.0, brick faces bright
}
// ── kind textures (variety pass) ─────────────────────────────────────────────
// One "struct" brick grain used to dress EVERY box in the world — roofs, piers,
// stalls, towers — which is exactly the "shared procedural canvas textures"
// finding the visuals refuter held the band on. Same _fieldTex machinery, four
// genuinely different relief patterns; albedo stays near-white so batch colors
// keep doing the tinting.
function shingleTex(aniso) {
  return _fieldTex("shingle", 256,
    (u, v) => {                                          // overlapping rows, per-row column stagger
      const R = 7, row = Math.floor(v * R), off = (row % 2) * 0.5;
      const rv = 1 - (((v * R) % 1));                    // each row: high at its top edge, tapering
      const col = ((u * 5 + off) % 1);
      const gap = col > 0.94 ? 0.55 : 1;                 // vertical slits between shingles
      return rv * 0.75 * gap + _tfbm(u * 22, v * 22, 31, 2) * 0.25;
    },
    (h) => 0.86 + h * 0.14, aniso, 3.6);
}
function plankTex(aniso) {
  return _fieldTex("plank", 256,
    (u, v) => {                                          // vertical boards, grain runs along v
      const B = 6, board = Math.floor(u * B);
      const edge = Math.abs(((u * B) % 1) - 0.5) > 0.44 ? 0.35 : 1;   // grooves between boards
      const grain = _tfbm(u * 40 + board * 7, v * 6, 41 + board, 3);  // stretched grain, per-board phase
      return edge * (0.55 + grain * 0.45);
    },
    (h) => 0.85 + h * 0.15, aniso, 3.8);
}
function metalTex(aniso) {
  return _fieldTex("metal", 256,
    (u, v) => {                                          // corrugation ridges + panel seams
      const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 9);
      const seam = (Math.abs(((v * 2) % 1) - 0.5) > 0.47) ? 0.4 : 1;
      return ridge * seam * 0.85 + _tfbm(u * 12, v * 12, 53, 2) * 0.15;
    },
    (h) => 0.9 + h * 0.1, aniso, 3.0);
}
function blockTex(aniso) {
  return _fieldTex("block", 256,
    (u, v) => {                                          // large cut stone, tighter mortar than struct
      const R = 3.5, row = Math.floor(v * R), off = (row % 2) * 0.33, bu = u * 2 + off;
      const mortar = (Math.abs(((v * R) % 1) - 0.5) > 0.45 || Math.abs(((bu % 1) + 1) % 1 - 0.5) > 0.47) ? 1 : 0;
      const face = _tfbm(u * 10 + row * 3, v * 10, 61 + row, 3);
      return (1 - mortar) * (0.5 + face * 0.5);
    },
    (h) => 0.87 + h * 0.13, aniso, 4.4);
}
function stuccoTex(aniso) {
  // Wave 7b (Isla Viva's resort walls): smooth trowelled plaster - a fine grain and soft trowel swirls, no joints (the brick relief read as a council estate under pastel paint)
  return _fieldTex("stucco", 256,
    (u, v) => _tfbm(u * 30, v * 30, 71, 3) * 0.55 + _tfbm(u * 7, v * 7, 73, 2) * 0.45,
    (h) => 0.93 + h * 0.07, aniso, 1.4);
}
const KIND_TEX = { shingle: shingleTex, plank: plankTex, metal: metalTex, block: blockTex, stucco: stuccoTex };

// LC-39: a PERIODIC fbm - the lattice indices wrap at the tile's own period (per x 2^octave cells), so the field at u = 1 is the field at u = 0. The water's
// ripple field was _tfbm (lattice hashes at unwrapped integers) plus sin(u * 22 + v * 15) (22 and 15 are not multiples of 2 pi): neither wrapped, so the
// tile edge was a seam every ~28 m, a square grid across the whole sea in the drop view's sun sheen. The sine is now 2 pi x (3, 2) cycles a tile,
// and a minor term (0.18) under a 4-octave fbm, so the sheen reads as ripples, not ridges.
function _tpfbm(u, v, s, oct, per) {
  let a = 1, f = per, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const x = u * f, y = v * f, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), w = (k) => ((k % f) + f) % f;
    const s00 = _thash(w(ix), w(iy), s + i), s10 = _thash(w(ix + 1), w(iy), s + i), s01 = _thash(w(ix), w(iy + 1), s + i), s11 = _thash(w(ix + 1), w(iy + 1), s + i);
    sum += ((s00 + (s10 - s00) * sx) * (1 - sy) + (s01 + (s11 - s01) * sx) * sy) * a;
    n += a; a *= 0.5; f *= 2;
  }
  return sum / n;
}
function waterNormalTex(aniso) {
  if (_texCache.waterN) return _texCache.waterN;
  const t = _fieldTex("water_p", 256,
    (u, v) => _tpfbm(u, v, 31, 4, 6) * 0.82 + (Math.sin((u * 3 + v * 2) * Math.PI * 2) * 0.5 + 0.5) * 0.18,   // (the swell sine 0.4 -> 0.18: at 0.4 the sun sheen read as parallel zebra ridges from the drop)
    (h) => h, aniso, 1.4).normal;
  _texCache.waterN = t; return t;
}
// Grass-tuft alpha card for the ground-clutter layer. Cached in _texCache like the
// other procedural textures, so disposeMapResources treats it as SHARED and does
// not free it between matches (freeing it would leave the next match sampling a
// dead GPU handle — the same reason groundTex/structTex are cached).
function clutterTex() {
  if (_texCache.clutter) return _texCache.clutter;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g2 = c.getContext("2d");
  g2.clearRect(0, 0, 64, 64);
  g2.fillStyle = "#ffffff";
  for (let i = 0; i < 7; i++) {                     // tapered blades fanning from the base
    const bx = 8 + i * 7.5, lean = (i - 3) * 3.2;
    g2.beginPath(); g2.moveTo(bx - 2.2, 64); g2.quadraticCurveTo(bx + lean * 0.4, 34, bx + lean, 6 + (i % 3) * 7);
    g2.quadraticCurveTo(bx + lean * 0.4 + 2.4, 34, bx + 2.2, 64); g2.closePath(); g2.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  _texCache.clutter = t; return t;
}

// ── P2.5 textured ground (Wave 6, lane 6A) ────────────────────────────────────────────────────────────────────────
// Poly Haven CC0 photographs, 1024 px, in assets/tex/ (CREDITS.md): ground_grass_rock, ground_beach, ground_sand under the terrain, road_asphalt
// under the road ribbons. They are DETAIL, not colour: the biome tint every consumer already agrees on (the vertex colour, the minimap, the
// grass tufts, the footstep surface) stays the hue of the ground, and the photograph only modulates it - the sampled texel is divided by the
// texture's own average colour, so a ground that was tinted C still averages C and the minimap / clutter / tufts still match what is drawn.
// ZERO extra draw calls (one terrain material, as before), no extra programs on the drop frame (the patched program is the terrain program from
// the first frame; customProgramCacheKey makes every match reuse it), and the three terrain photographs are cached for the page session in
// _texCache (disposeMapResources leaves those). Three fetches per fragment at most, each only where its weight is non-zero; a 'low' tier,
// a missing renderer (the Node gates) or a failed download falls back to the procedural grain alone.
const PHOTO_FILES = {
  photoGrass: { url: "assets/tex/ground_grass_rock.jpg", avg: [0.1712, 0.1233, 0.0273] },   // avg = the LINEAR mean of the file (tools: numpy over the decoded pixels)
  photoBeach: { url: "assets/tex/ground_beach.jpg", avg: [0.2826, 0.2384, 0.1956] },
  photoSand: { url: "assets/tex/ground_sand.jpg", avg: [0.3523, 0.263, 0.2243] },
  photoAsphalt: { url: "assets/tex/road_asphalt.jpg", avg: [0.1397, 0.1261, 0.1422] },
};
let _photoLoad = null;
async function loadPhotoTextures(W) {
  const r = W.kernel && W.kernel.renderer;
  if (!r || typeof THREE.TextureLoader !== "function" || (W.settings && W.settings.graphics === "low")) return null;
  const have = (k) => !!_texCache[k];
  if (!Object.keys(PHOTO_FILES).every(have)) {
    if (!_photoLoad) {
      _photoLoad = (async () => {
        const loader = new THREE.TextureLoader();
        const maxA = r.capabilities && r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 4;
        await Promise.all(Object.keys(PHOTO_FILES).map(async (k) => {
          if (_texCache[k]) return;
          const ac = typeof AbortController === "function" ? new AbortController() : null;
          let to = 0;
          const url = (W.assetBase || "") + PHOTO_FILES[k].url;
          try {
            const t = await Promise.race([loader.loadAsync(url), new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timeout")), 25000); })]);
            t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = Math.min(maxA, Math.max(2, W._texAniso || 4));
            _texCache[k] = t;
          } catch (err) { console.warn("[maps] ground photo " + k + " unavailable, procedural ground only:", err && err.message || err); }
          finally { if (to) clearTimeout(to); }
        }));
      })();
    }
    await _photoLoad; _photoLoad = null;
  }
  if (!_texCache.photoGrass || !_texCache.photoBeach || !_texCache.photoSand) return null;
  return { grass: _texCache.photoGrass, beach: _texCache.photoBeach, sand: _texCache.photoSand, asphalt: _texCache.photoAsphalt || null };
}
const PH_LUM = "vec3(0.2126, 0.7152, 0.0722)";
const glslV3 = (a) => "vec3(" + a.map((v) => v.toFixed(5)).join(", ") + ")";
/** Patch a MeshStandardMaterial so `map_fragment` also multiplies the albedo by the photo detail (see the block above). */
function patchTerrainPhoto(mat, ph) {
  mat.userData.photo = true;
  mat.customProgramCacheKey = () => "lc-terrain-photo-v1";
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrass = { value: ph.grass }; sh.uniforms.tBeach = { value: ph.beach }; sh.uniforms.tSand = { value: ph.sand };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSplat = splat;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vSplat;
uniform sampler2D tGrass; uniform sampler2D tBeach; uniform sampler2D tSand;
vec3 lcDetail(sampler2D t, vec2 p, vec3 avg, float chroma, float gain) {
  vec3 r = clamp(texture2D(t, p).rgb / avg, 0.25, 3.0);
  r = 1.0 + (r - 1.0) * gain;                            // contrast of the photograph (the beach is nearly flat: gain > 1)
  return mix(vec3(dot(r, ${PH_LUM})), r, chroma);        // mostly its light/dark, a share of its hue drift (the biome tint stays the hue)
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
{
  vec2 wxz = vMapUv * 8.0;                                // world metres (the terrain's grain uv is world / 8)
  float ws = vSplat.x + vSplat.y + vSplat.z;
  if (ws > 0.003) {
    vec3 d = vec3(0.0);
    if (vSplat.x > 0.003) {                               // grass / rock: two samples at unrelated scales + a turn, so the tile never reads
      vec3 a = lcDetail(tGrass, wxz / 15.0, ${glslV3(PHOTO_FILES.photoGrass.avg)}, 0.15, 1.1);
      vec3 b = lcDetail(tGrass, mat2(0.8, 0.6, -0.6, 0.8) * wxz / 23.0 + 0.37, ${glslV3(PHOTO_FILES.photoGrass.avg)}, 0.15, 1.1);
      d += vSplat.x * (0.5 * (a + b));
    }
    if (vSplat.y > 0.003) d += vSplat.y * lcDetail(tBeach, wxz / 18.0, ${glslV3(PHOTO_FILES.photoBeach.avg)}, 0.3, 2.4);
    if (vSplat.z > 0.003) d += vSplat.z * lcDetail(tSand, wxz / 21.0, ${glslV3(PHOTO_FILES.photoSand.avg)}, 0.25, 0.8);
    diffuseColor.rgb *= mix(vec3(1.0), d / ws, min(1.0, ws));
  }
}`);
  };
}
// ── P2/P3 WORLD SHADER LAYER (parity lane maps: LC-17 wear + grime, LC-41 contact AO, LC-74 cloud shadows, LC-38 wind, LC-39 water depth) ────────────
// One set of LIVE uniform objects at module scope, shared by every material this file patches (the terrain, the roads, the city ground, the structure
// materials, the foliage and grass clones, the water): buildMap sets their values once per match and the sky updater advances uLcT. Every feature is a
// #define on the material, chosen at map BUILD time from the graphics tier (so a mid-match ladder step never recompiles anything) and compiled in the warm
// frame with the rest of the map. Per tier: LOW = none of them (the materials are not patched at all); MEDIUM / HIGH / ULTRA = all of them. ZERO extra draw
// calls: every one is a few lines in programs the map already draws with.
const LCU = {
  uLcT: { value: 0 },                                                   // seconds (the map's own clock)
  uLcCloud: { value: null },                                            // the sky's baked cloud noise (R shape, G detail)
  uLcCloudK: { value: new THREE.Vector4(0, 0, 0.62, 0) },              // xy = sun.xz / sun.y (the deck projects along the sun), z = noise threshold, w = strength (fraction of the SUN removed)
  uLcCloudOff: { value: new THREE.Vector2() },                          // drift (uv)
  uLcHgt: { value: null },                                              // the baked ground lattice as a half-float texture (wear band, water depth)
  uLcHgtK: { value: new THREE.Vector4(0, 0, 0, 0) },                   // uv = xz * x + y
  uLcAO: { value: null },                                               // blurred footprint occupancy of everything standing on the ground (contact AO)
  uLcAOK: { value: new THREE.Vector4(0, 0, 0, 0) },                    // uv = xz * x + y; z = indirect strength, w = direct strength
  uLcWind: { value: new THREE.Vector4(0.8, 0.6, 1, 0) },               // xy = wind direction, z = strength (0 = still)
  uLcGrime: { value: null },                                            // the CC0 wall photograph (detail, divided by its own mean)
  uLcGrimeK: { value: new THREE.Vector4(0, 1 / 6, 0, 0) },             // x = gain (0 = off), y = 1 / the photo's tile (m, world-planar)
  uLcWear: { value: new THREE.Vector2(0.30, 0.85) },                    // x = how much darker the base of a wall is at the ground, y = the band's height (m)
  uLcWater: { value: new THREE.Vector4(0, 0, 0, 0) },                  // x = water y
  uLcShallow: { value: new THREE.Color() }, uLcDeep: { value: new THREE.Color() },
};
const GRIME_FILE = { url: "assets/tex/wall_grime.jpg", avg: [0.6339, 0.4989, 0.3582] };   // Poly Haven "Concrete Wall 003" (CC0), 1k diffuse JPG (265 KB); avg = its LINEAR mean (numpy over the decoded sRGB pixels)
let _grimeLoad = null;
async function loadGrimeTexture(W) {
  if (_texCache.grime) return _texCache.grime;
  const r = W.kernel && W.kernel.renderer;
  if (!r || typeof THREE.TextureLoader !== "function") return null;
  if (!_grimeLoad) _grimeLoad = (async () => {
    let to = 0;
    try {
      const t = await Promise.race([new THREE.TextureLoader().loadAsync((W.assetBase || "") + GRIME_FILE.url), new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timeout")), 25000); })]);
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(r.capabilities && r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 4, Math.max(2, W._texAniso || 4));
      _texCache.grime = t;
    } catch (err) { console.warn("[maps] wall grime photo unavailable, procedural walls only:", err && err.message || err); }
    finally { if (to) clearTimeout(to); _grimeLoad = null; }
    return _texCache.grime || null;
  })();
  return _grimeLoad;
}
const LC_VERT_HEAD = `
varying vec3 vLcW;
varying vec3 vLcN;
#ifdef LC_WIND
uniform float uLcT; uniform vec4 uLcWind;
#endif`;
// wind: a sway of the whole crown (the square of the height over the kind's height, so the base never moves) under a slow gust front that crosses the map,
// plus a fine leaf flutter; computed in WORLD metres, carried back into the instance's own frame (rotation x uniform scale: transpose / scale^2)
const LC_VERT_WIND = `
#ifdef LC_WIND
{
  vec4 lwp = vec4( transformed, 1.0 ); mat3 lim = mat3( 1.0 ); vec3 lorg = vec3( 0.0 );
  #ifdef USE_INSTANCING
    lwp = instanceMatrix * lwp; lim = mat3( instanceMatrix ); lorg = instanceMatrix[ 3 ].xyz;
  #endif
  float lhn = max( 0.0, lwp.y - lorg.y ) / LC_WIND_H;
  float lph = dot( lorg.xz, vec2( 0.071, 0.053 ) );
  float lsw = sin( uLcT * 1.27 + lph ) * 0.62 + sin( uLcT * 2.13 + lph * 1.7 ) * 0.38;
  float lgu = 0.62 + 0.38 * sin( uLcT * 0.33 - dot( lorg.xz, uLcWind.xy ) * 0.006 );
  float lfl = sin( uLcT * 6.3 + dot( lwp.xyz, vec3( 1.7, 2.3, 1.1 ) ) ) * LC_WIND_FLUT;
  vec3 lwd = vec3( uLcWind.x, 0.0, uLcWind.y ) * ( LC_WIND_A * lhn * lhn * ( lsw * lgu + 0.45 ) ) + vec3( lfl, lfl * 0.45, lfl * 0.7 ) * lhn;
  transformed += ( transpose( lim ) * ( lwd * uLcWind.z ) ) / max( 1e-8, dot( lim[ 0 ], lim[ 0 ] ) );
}
#endif`;
// the leaves catching the light: the same flutter tilts the crown's shading normals a little (x3 the flutter, by height), so a crown shimmers as a whole, not
// only along its silhouette (a low-poly crown's facets slide over themselves and barely change a pixel: Deepwood's pines moved 1.4-1.5 % of a forest-edge frame).
// Injected after beginnormal_vertex (the depth materials have no normal: no-op there); grass (flutter 0) is untouched.
const LC_NRM_WIND = `
#ifdef LC_WIND
{
  vec3 lnp = position; vec3 lno = vec3( 0.0 );
  #ifdef USE_INSTANCING
    lnp = ( instanceMatrix * vec4( position, 1.0 ) ).xyz; lno = instanceMatrix[ 3 ].xyz;
  #endif
  float lnh = clamp( ( lnp.y - lno.y ) / LC_WIND_H, 0.0, 1.0 );
  float lsh = LC_WIND_FLUT * 3.0 * lnh * uLcWind.z;
  objectNormal = normalize( objectNormal + lsh * vec3( sin( uLcT * 5.1 + dot( lnp, vec3( 2.1, 1.3, 1.7 ) ) ), 0.0, cos( uLcT * 4.3 + dot( lnp, vec3( 1.1, 2.7, 1.9 ) ) ) ) );
}
#endif`;
const LC_VERT_WORLD = `
{
  vec4 lw = vec4( transformed, 1.0 ); vec3 ln = objectNormal;
  #ifdef USE_BATCHING
    lw = batchingMatrix * lw; ln = mat3( batchingMatrix ) * ln;
  #endif
  #ifdef USE_INSTANCING
    lw = instanceMatrix * lw; ln = mat3( instanceMatrix ) * ln;
  #endif
  lw = modelMatrix * lw; vLcW = lw.xyz; vLcN = normalize( mat3( modelMatrix ) * ln );
}`;
const LC_FRAG_HEAD = `
varying vec3 vLcW;
varying vec3 vLcN;
#ifdef LC_CLOUD
uniform sampler2D uLcCloud; uniform vec4 uLcCloudK; uniform vec2 uLcCloudOff;
#endif
#ifdef LC_HGT
uniform sampler2D uLcHgt; uniform vec4 uLcHgtK;
float lcGround( vec2 xz ) { return texture2D( uLcHgt, xz * uLcHgtK.x + uLcHgtK.y ).r; }
#endif
#ifdef LC_AO
uniform sampler2D uLcAO; uniform vec4 uLcAOK;
#endif
#ifdef LC_GRIME
uniform sampler2D uLcGrime; uniform vec4 uLcGrimeK;
#endif
#ifdef LC_WEAR
uniform vec2 uLcWear;
#endif
#ifdef LC_WATER
uniform vec4 uLcWater; uniform vec3 uLcShallow; uniform vec3 uLcDeep;
#endif`;
// albedo terms (after map_fragment): the wall-base wear band (a vertical face within uLcWear.y m of the ground under it, darker by up to uLcWear.x) and the
// grime photograph (its light / dark only, divided by its own mean so a wall still averages its colour)
const LC_FRAG_ALBEDO = `
#ifdef LC_WEAR
{
  float lvert = 1.0 - abs( vLcN.y );
  float lhb = vLcW.y - lcGround( vLcW.xz );
  float lband = ( 1.0 - smoothstep( 0.0, uLcWear.y, lhb ) ) * smoothstep( 0.25, 0.75, lvert ) * step( -0.6, lhb );
  diffuseColor.rgb *= 1.0 - uLcWear.x * lband;
}
#endif
#ifdef LC_GRIME
{
  // world-space planar mapping (a wall's own plane, a floor's / roof's xz), so every structure mesh - the procedural batches, the district merges AND the
  // furnished houses' BatchedMeshes, whose UVs are per-material - wears the photograph at one scale: uLcGrimeK.y = 1 / its tile (m)
  vec3 lan = abs( vLcN );
  vec2 lgp = ( lan.y > 0.7 ? vLcW.xz : ( lan.x > lan.z ? vLcW.zy : vLcW.xy ) ) * uLcGrimeK.y;
  vec3 lg1 = texture2D( uLcGrime, lgp ).rgb, lg2 = texture2D( uLcGrime, mat2( 0.8, 0.6, -0.6, 0.8 ) * lgp * 0.53 + 0.29 ).rgb;
  float lgl = dot( ( lg1 + lg2 ) * 0.5 / ${glslV3(GRIME_FILE.avg)}, ${PH_LUM} );
  diffuseColor.rgb *= clamp( 1.0 + ( lgl - 1.0 ) * uLcGrimeK.x, 0.55, 1.35 );
}
#endif
#ifdef LC_WATER
{
  float ldep = uLcWater.x - lcGround( vLcW.xz );
  float lk = smoothstep( 0.0, 7.0, ldep );
  diffuseColor.rgb = mix( uLcShallow, uLcDeep, lk );
  // surf lines follow the depth contours (so they run along the shore and roll in), broken into ~12 m patches; once a band is under ~2 px (the drop
  // view) its sine is replaced by its mean, so the plane sees a soft white rim, not stripes (was one world-space diagonal sine: zebra bands from the air)
  float lph = ldep * 11.0 - uLcWater.y * 1.6;
  float law = clamp( fwidth( lph ) - 0.6, 0.0, 1.0 );
  float lbr = 0.62 + 0.38 * sin( dot( vLcW.xz, vec2( 0.45, 0.27 ) ) + 2.0 * sin( vLcW.z * 0.083 + vLcW.x * 0.031 ) );
  float lfoam = ( 1.0 - smoothstep( 0.0, 0.55, ldep ) ) * mix( 0.55 + 0.45 * sin( lph ), 0.5, law ) * lbr;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.94 ), clamp( lfoam, 0.0, 1.0 ) * 0.75 );
  diffuseColor.a = mix( 0.62, diffuseColor.a, smoothstep( 0.0, 2.5, ldep ) );
}
#endif`;
// light terms (after lights_fragment_end): a cloud's shadow takes a share of the SUN only (the sky fill stays: a shadowed field reads as overcast, not night),
// contact AO darkens the sky fill most and the sun a little
const LC_FRAG_LIGHT = `
#ifdef LC_CLOUD
{
  vec2 lcp = ( vLcW.xz + uLcCloudK.xy * ( 380.0 - vLcW.y ) ) * 0.00105 + uLcCloudOff;
  float lcn = texture2D( uLcCloud, lcp ).r * 0.72 + texture2D( uLcCloud, lcp * 2.9 + 0.31 ).g * 0.28;
  float lcs = 1.0 - uLcCloudK.w * smoothstep( uLcCloudK.z, uLcCloudK.z + 0.2, lcn );
  reflectedLight.directDiffuse *= lcs; reflectedLight.directSpecular *= lcs;
}
#endif
#ifdef LC_AO
{
  float lao = texture2D( uLcAO, vLcW.xz * uLcAOK.x + uLcAOK.y ).r;
  reflectedLight.indirectDiffuse *= 1.0 - uLcAOK.z * lao; reflectedLight.directDiffuse *= 1.0 - uLcAOK.w * lao;
}
#endif`;
const LC_UNIFORMS = { LC_WIND: ["uLcT", "uLcWind"], LC_CLOUD: ["uLcCloud", "uLcCloudK", "uLcCloudOff"], LC_HGT: ["uLcHgt", "uLcHgtK"], LC_AO: ["uLcAO", "uLcAOK"],
  LC_GRIME: ["uLcGrime", "uLcGrimeK"], LC_WEAR: ["uLcWear"], LC_WATER: ["uLcWater", "uLcShallow", "uLcDeep"] };
/** Patch a MeshStandardMaterial (or a MeshDepthMaterial for the wind) with the world-shader layer. `defs` = { LC_CLOUD: "", LC_WEAR: "", LC_WIND_H: "6.5", ... }
 *  (LC_WEAR and LC_WATER need LC_HGT, which is added). Chains any onBeforeCompile the material already had (the terrain photo, the struct mix); the program
 *  cache key carries the previous key and the define set, so every match reuses the same programs. Idempotent per material. */
function lcPatch(mat, defs) {
  if (!mat || mat.userData.lcPatched) return mat;
  defs = Object.assign({}, defs);
  if (defs.LC_WEAR !== undefined || defs.LC_WATER !== undefined) defs.LC_HGT = "";
  const keys = Object.keys(defs).sort();
  if (!keys.length) return mat;
  mat.userData.lcPatched = keys.join(",");
  mat.defines = Object.assign({}, mat.defines || {}, defs);
  const prevKey = mat.customProgramCacheKey && mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  const prevCompile = mat.onBeforeCompile && mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? mat.onBeforeCompile : null;
  const sig = "lcw-v1:" + keys.map((k) => k + "=" + defs[k]).join(";");
  mat.customProgramCacheKey = () => (prevKey ? prevKey() + "|" : "") + sig;
  const depth = !!mat.isMeshDepthMaterial || !!mat.isMeshDistanceMaterial;
  mat.onBeforeCompile = (sh, r) => {
    // ours FIRST: a previous patch may expand an #include it replaces (the struct mix rewrites map_fragment's text), and ours anchors on the #include tokens
    for (const d of keys) for (const u of LC_UNIFORMS[d] || []) sh.uniforms[u] = LCU[u];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + LC_VERT_HEAD)
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + LC_NRM_WIND)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + LC_VERT_WIND);
    if (!depth) {
      sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + LC_VERT_WORLD);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + LC_FRAG_HEAD)
        .replace("#include <map_fragment>", "#include <map_fragment>\n" + LC_FRAG_ALBEDO)
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n" + LC_FRAG_LIGHT);
    }
    if (prevCompile) prevCompile.call(mat, sh, r);
  };
  mat.needsUpdate = true;
  return mat;
}
/** the graphics tier this map is built for (lane boot's C-GFX W.gfxTier, else the stored setting): low | medium | high | ultra */
function gfxTierOf(W) { const t = W.gfxTier || (W.settings && W.settings.graphics) || (W._gfx && W._gfx.tier) || "medium"; return t === "low" || t === "medium" || t === "high" || t === "ultra" ? t : "medium"; }

/** the photo splat of a terrain vertex: weights of (grass/rock, beach, sand) - the same biome zones colorAt tints, so the detail and the colour agree */
function splatAt(mapId, h, x, z, seed, out) {
  let g = 1, b = 0, s = 0;
  if (mapId === "isla_viva") {
    b = h <= 1.4 ? 1 : h >= 2.6 ? 0 : 1 - smooth((h - 1.4) / 1.2);                  // the sand band of colorAt (h < 2.2) fades into the grass
    g = 1 - b;
  } else if (mapId === "ashgrid") {
    const edge = fbm(x / 260, z / 260, seed + 61, 2, 2, 0.5) * 120;
    const desert = Math.max(0, Math.min(1, (x - 40 + edge) / 320));                    // colorAt's savanna -> desert blend
    s = desert; if (h < 0.5) s = 1; g = 1 - s;
  } else if (mapId === "deepwood") {
    const edge = fbm(x / 240, z / 240, seed + 91, 2, 2, 0.5) * 90;
    const snow = Math.max(0, Math.min(1, (-z - 100 + edge) / 260));                    // the snow biome: the smooth beach photograph reads as packed snow
    b = snow; g = 1 - snow;
  }
  out[0] = g; out[1] = b; out[2] = s;
  return out;
}

/** EVERY static collider is built here, with every field it will ever carry present
 *  from birth and in one order, so all of them share ONE hidden class. They were
 *  four object-literal shapes (box, ramp, island box, prop box) that then grew
 *  `_qs` (queryColliders' stamp) and `dead` at run time: 6-8 shapes at every site
 *  that reads c.minX..c.maxZ. Past 4 shapes V8 goes megamorphic, and a megamorphic
 *  load of a number field returns a freshly boxed copy - a heap allocation per
 *  field read, at the hottest reads in the game (bot path search, wall probes,
 *  bullets, sight lines, player support). Same values as before: a box has dir -1
 *  (only ramps read it), a non-prop has prop null / idx -1 / hp 0 (every reader
 *  tests `c.prop == null`, `!c.prop`, `c.hp > 0`), dead false, _qs 0 (stamps
 *  start at 1). */
function mkCollider(kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp) {
  return { kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp, dead: false, _qs: 0 };
}

// ── baked prop collider table (Wave 5, lane 5A) ──────────────────────────────────────────────────────────────────
// assets/props/prop_colliders.json is generated offline from the prop GLBs by _tools/bake_prop_colliders.mjs: per kind the footprint
// anchor, the drawn height, the base-contact points and the collider parts, in metres at it.s = 1. Colliders and ground-fitting are
// built FROM THE TABLE, never from the loaded GLB: before this a squad client whose GLB request failed (the `catch ... continue` in the
// instancing loop) built no colliders for that kind while its squad-mates did, and every prop box was a fixed radius that had nothing to
// do with the mesh (rocks 1.4 m radius x 6 m tall around a mesh that was 0.7 m tall and drawn 35 m away).
// Fetched once per page session (the file is immutable within a build), with `cache: "no-cache"` so a deploy that changes the table is
// revalidated and never served stale. Two attempts, then the legacy fixed-radius colliders and centre-height placement: a missing table
// must never stop a match from starting (it can only make this client disagree with squad-mates that did load it, the pre-Wave-5
// situation; the squad-room version guard of Wave 7 is the real fix for cross-build rooms).
const PROP_TABLE_URL = "assets/props/prop_colliders.json";
let _propTable = null;                 // { url, table }
async function loadPropTable(W) {
  const url = (W.assetBase || "") + PROP_TABLE_URL;
  if (_propTable && _propTable.url === url) return _propTable.table;
  let table = null;
  for (let attempt = 0; attempt < 2 && !table; attempt++) {
    try {
      const ac = typeof AbortController === "function" ? new AbortController() : null;
      const t = ac ? setTimeout(() => ac.abort(), W.kernel && W.kernel.loadTimeoutMs > 0 ? W.kernel.loadTimeoutMs : 30000) : 0;
      let r;
      try { r = await fetch(url, ac ? { cache: "no-cache", signal: ac.signal } : { cache: "no-cache" }); } finally { clearTimeout(t); }
      if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "none"));
      const j = await r.json();
      if (!j || j.version !== 1 || !j.kinds || typeof j.kinds !== "object") throw new Error("not a version-1 prop table");
      for (const k in j.kinds) { const e = j.kinds[k]; if (!(e.norm > 0) || !Array.isArray(e.base) || !e.base.length || !Array.isArray(e.anchor)) throw new Error("kind " + k + " is malformed"); }
      table = j;
    } catch (e) { console.warn("[maps] prop collider table " + (attempt ? "unavailable, using legacy prop colliders" : "failed, retrying") + ":", e && e.message || e); }
  }
  if (table) _propTable = { url, table };
  return table;
}

// ── near-LOD terrain skirt (Wave 5, lane 5A) ───────────────────────────────────────────────────────────────────────
/** Hang a vertical wall SKIRT_DEPTH under the perimeter of a near-LOD terrain chunk, inside the SAME BufferGeometry (no extra draw call, 4 x seg
 *  vertices and 8 x seg triangles per chunk; 5.5k triangles for the whole 3 x 3 ring). The chunk's own surface stays exactly heightAt0 on the
 *  lattice, so the drawn ground and the physics ground agree up to the 2.6 m triangle interpolation; the wall only has to close the sliver
 *  between this edge and the far-LOD neighbour's, whose edge is a linear interpolation of the same function (up to ~0.12 m off). Leadwerks'
 *  terrain notes call this the standard cure for LOD cracks: "a small skirt around every patch". `vAt` maps lattice (ix, iz) to a vertex index. */
const SKIRT_DEPTH = 0.8;
function addSkirt(geo, vAt, seg) {
  const S1 = seg + 1, loop = [];
  for (let i = 0; i < seg; i++) loop.push(vAt[i]);                       // iz = 0,   ix = 0 .. seg-1   (west -> east along the north edge)
  for (let j = 0; j < seg; j++) loop.push(vAt[j * S1 + seg]);            // ix = seg, iz = 0 .. seg-1   (north -> south along the east edge)
  for (let i = seg; i > 0; i--) loop.push(vAt[seg * S1 + i]);            // iz = seg, ix = seg .. 1
  for (let j = seg; j > 0; j--) loop.push(vAt[j * S1]);                  // ix = 0,   iz = seg .. 1
  const L = loop.length, n0 = geo.attributes.position.count, n1 = n0 + L;
  const grow = (name, comps) => {
    const src = geo.attributes[name].array, out = new Float32Array(n1 * comps);
    out.set(src);
    for (let k = 0; k < L; k++) for (let c = 0; c < comps; c++) out[(n0 + k) * comps + c] = src[loop[k] * comps + c];
    return out;
  };
  const pos = grow("position", 3), nrm = grow("normal", 3), col = grow("color", 3), uv = grow("uv", 2), spl = geo.attributes.splat ? grow("splat", 3) : null;
  for (let k = 0; k < L; k++) pos[(n0 + k) * 3 + 1] -= SKIRT_DEPTH;
  const old = geo.index.array, idx = new (n1 > 65535 ? Uint32Array : Uint16Array)(old.length + L * 6);
  idx.set(old);
  let o = old.length;
  for (let k = 0; k < L; k++) {                                          // loop order runs clockwise seen from above: (a, b, b') faces OUTWARD on every edge
    const a = loop[k], b = loop[(k + 1) % L], a2 = n0 + k, b2 = n0 + (k + 1) % L;
    idx[o++] = a; idx[o++] = b; idx[o++] = b2;
    idx[o++] = a; idx[o++] = b2; idx[o++] = a2;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (spl) geo.setAttribute("splat", new THREE.BufferAttribute(spl, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
}

// ── height functions per map ────────────────────────────────────────────────
function mkHeightFn(mapId, seed) {
  if (mapId === "isla_viva") {
    return (x, z) => {
      const d = Math.sqrt(x * x + z * z) / HALF;          // 0 center → 1 edge
      const islandMask = Math.max(0, 1 - Math.pow(d * 1.12, 2.6));
      let h = fbm(x / 220, z / 220, seed, 4, 2.1, 0.5) * 46 * islandMask;
      // volcano cone near center with crater dip
      const dv = Math.sqrt((x - 40) * (x - 40) + (z + 60) * (z + 60));
      if (dv < 240) {
        const cone = (1 - dv / 240);
        h += cone * cone * 85;
        if (dv < 42) h -= (1 - dv / 42) * 34;             // crater
      }
      h -= 7;                                             // sea floor below 0 at edges
      return h;
    };
  }
  if (mapId === "ashgrid") {
    return (x, z) => {
      let h = fbm(x / 340, z / 340, seed, 3, 2.0, 0.5) * 9 + 2;
      h += fbm(x / 40, z / 40, seed + 7, 2, 2.0, 0.5) * 1.6;   // rubble roughness
      // Measured relief across the full 1600 m span was 29.9 m at a mean 0.12 m per
      // 7.27 m heightfield quad — a 1.7% grade, the flattest map in the game and the
      // one with the most open ground beyond cover range. Crossing it broke no line
      // of sight anywhere. A ridged octave adds berms AND gullies at a ~28 m
      // wavelength; +/-2.5 m fully hides a standing 1.8 m capsule. The MEAN (~0.25)
      // is subtracted deliberately — without that this raises the whole map ~1.25 m,
      // and ASHGRID ONLY for the same reason: every waterline guard in this file
      // (hut() stilts, town() minH, the tower guards, randomGroundPos, the minimap
      // water test) is calibrated against the coastline of the two WATER maps.
      const rg = 0.5 - Math.abs(fbm(x / 28, z / 28, seed + 9, 2, 2, 0.5) - 0.5);
      h += (rg - 0.25) * 10;
      // gentle bowl so downtown reads as the low arena
      const d = Math.sqrt(x * x + z * z) / HALF;
      h += d * d * 14;
      return h;
    };
  }
  if (mapId === "deepwood") {
    return (x, z) => {
      let h = fbm(x / 260, z / 260, seed, 5, 2.05, 0.52) * 58 + 4;
      // river: carve along a sine path running west→east
      const rz = Math.sin(x / 210) * 130 + 40;
      const dr = Math.abs(z - rz);
      if (dr < 46) h -= (1 - dr / 46) * (h + 3.5);        // cut to below water
      // lake in the south
      const dl = Math.sqrt((x + 260) * (x + 260) + (z - 430) * (z - 430));
      if (dl < 150) h -= (1 - dl / 150) * (h + 4);
      return h;
    };
  }
  // fallback: gentle plains
  return (x, z) => 1 + fbm(x / 200, z / 200, seed, 2, 2, 0.5) * 2;
}

// ═══════════════════════════════════════════════════════════════════════════
// C-PAD: TERRAIN GROUND TRUTH (Wave 6, lane 6A)
// ═══════════════════════════════════════════════════════════════════════════
// The ground used to be an analytic function (mkHeightFn) that gameplay read directly while the screen drew a LINEAR interpolation of it
// sampled on per-chunk lattices (the physics floor and the drawn floor differed by up to 0.04 m, 0.28 m before the Wave-5 skirt fix), and the
// terrain mesh was built BEFORE any building existed, so every house, hut and tower was dropped on whatever slope was there (86-94 % of
// houses and 98-100 % of towers had a base edge more than 10 cm off the ground, towers up to 6 m).
//
// Now ONE function is the ground everywhere. TerrainField holds the analytic base plus the pads and road corridors the generators register,
// and `bake()` evaluates all of it once on the 609 x 609 lattice that the near-ring terrain chunks draw (2.63 m pitch; the far chunks draw
// every second node). `at(x, z)` is TRIANGLE-EXACT on that lattice with the diagonal three's PlaneGeometry uses, so physics, loot, bots,
// props, roads and the drawn surface are the same numbers (what Unreal calls collision mip 0 and Unity's TerrainCollider "matches the
// geometry of the Terrain").
//
//   registerPad(shape, height, falloffM)    shape = { x0, x1, z0, z1 } (a rectangle) or { poly: [[x, z], ...] } or [[x, z], ...]
//        a FLAT area at `height` under the shape - a rectangle grown out to the lattice nodes of every cell it touches (so each of those cells is
//        exactly level; a polygon is grown by one pitch) - then a smoothstep falloff to the natural ground over `falloffM` metres (3 on level
//        ground; 12 is the working maximum: the falloff slope is 1.5 x cut/fill / falloffM, so pick it from the cut: buildMap's groundPad() uses
//        2.5 + 2.2 x cut). Pads win over corridors, and a pad's own core is exact (the other pads' weights are raised to the 32nd power, so a
//        neighbour's falloff at 70 % moves a core by 0.001 % of the height difference). Two cores that share a lattice node must share a level:
//        groundPad() joins the later one to the earlier.
//   registerCorridor(polyline, width, opts) a road: the cross-slope is removed across `width` (+ one lattice pitch) and the centreline follows
//        a SMOOTHED profile of the natural ground (+-16 m moving average, at most 2.5 m from it), then a falloff that grows with the lateral
//        cut (4-12 m, per vertex). One nearest segment per corridor decides at a point.
//   live(x, z)        base + everything registered so far (generation time: lets a generator read the ground its neighbours already shaped)
//   bake()            freeze into the Float32 lattice; from then on at(x, z) is the ground
// Everything is deterministic: pads come from the seeded layout only and the bake is plain IEEE arithmetic (+, -, *, /, sqrt), the same on
// every client.
export const MAP_GEN_VERSION = 6;                   // see map.genVersion (6 = Wave 8: every enterable town / compound building on all three maps is a furnished housegen.js house - its walls, floors, roofs, furniture and colliders; 5 = Wave 7b: Isla Viva's resort towns, docks village and crater-rim village, Deepwood's lodge villages and mill-and-bridge compound; Savanna's world is identical to 4; 4 = Wave 7 completion: Savanna's polished city - taller downtown, parcel palettes, richer compounds, landmarks, merged street dressing; 3 = Wave 7: Savanna's towns; 2 = Wave 6 layout; an old client has no export and counts as 1)
const FALLBACK_GEN_VERSION = { ashgrid: 2, isla_viva: 4, deepwood: 4 };   // the generator version of the layout a page plays when towngen.js / citykit.js do not load (see prepareCity): Savanna's Wave-6 layout is 2; Isla Viva's and Deepwood's pre-7b worlds are 4 (their maps were identical in 2, 3 and 4, only the loot settled differently from 3)
export const LAT_CELLS = 608;                       // 8 chunks x 76 near-LOD cells (see CHUNKS / NEAR_SEG in buildMap)
export const LAT_N = LAT_CELLS + 1;                 // 609 nodes per side
export const LAT_PITCH = SIZE / LAT_CELLS;          // 2.6316 m
const PAD_MARGIN = LAT_PITCH + 0.01;                // a footprint point's lattice cell has all four corners within one pitch of it
const PAD_HASH = 32;                                // metres per spatial-hash cell
const CORR_STEP = 4;                                // metres between profile samples along a corridor
export class TerrainField {
  constructor(baseFn, size) {
    this.base = baseFn;
    this.size = size || SIZE; this.half = this.size / 2;
    this.pads = [];                                 // { x0, x1, z0, z1, poly, h, fo, bb } in registration order
    this.segs = [];                                 // corridor segments { ax, az, bx, bz, ha, hb, hw, fo }
    this.corridors = 0;
    this._ph = new Map(); this._sh = new Map();    // spatial hashes: cell key -> [pad | seg]
    this.lat = null;
  }
  /** lattice node position (metres) of index k along either axis */
  static node(k) { return (k * SIZE) / LAT_CELLS - SIZE / 2; }
  /** the rectangle grown outward to the nearest lattice nodes (the nodes of every cell the rectangle touches) */
  static snapRect(x0, x1, z0, z1) {
    const k = LAT_CELLS / SIZE, lo = (v) => Math.max(0, Math.floor((v + 800) * k - 1e-9)), hi = (v) => Math.min(LAT_CELLS, Math.ceil((v + 800) * k + 1e-9));
    return { x0: TerrainField.node(lo(x0)), x1: TerrainField.node(hi(x1)), z0: TerrainField.node(lo(z0)), z1: TerrainField.node(hi(z1)) };
  }
  _bucket(map, bb, item) {
    const c = PAD_HASH, kx0 = Math.floor(bb[0] / c), kx1 = Math.floor(bb[1] / c), kz0 = Math.floor(bb[2] / c), kz1 = Math.floor(bb[3] / c);
    for (let kx = kx0; kx <= kx1; kx++) for (let kz = kz0; kz <= kz1; kz++) {
      const k = (kx + 512) * 1024 + (kz + 512);
      const l = map.get(k);
      if (l) l.push(item); else map.set(k, [item]);
    }
  }
  /** Flatten the ground under `shape` to `height`; returns the height as stored (rounded to float32, so a caller that builds on it
   *  agrees with the lattice to the last bit). */
  registerPad(shape, height, falloffM) {
    const fo = Math.max(1, +falloffM || 3), h = Math.fround(height);
    const pad = { x0: 0, x1: 0, z0: 0, z1: 0, poly: null, h, fo, bb: null, id: this.pads.length };
    const pts = Array.isArray(shape) ? shape : shape.poly || null;
    if (pts) {
      pad.poly = pts.map((p) => [p[0], p[1]]);
      let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
      for (const p of pad.poly) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0]; if (p[1] < c) c = p[1]; if (p[1] > d) d = p[1]; }
      pad.x0 = a; pad.x1 = b; pad.z0 = c; pad.z1 = d;
    } else {
      // a rectangle's flat core is the footprint SNAPPED OUT to the lattice nodes (every cell that touches the footprint is level, no more):
      // on average 1.3 m beyond the footprint instead of a full pitch, so two buildings 5 m apart no longer fight over the same nodes
      const s = TerrainField.snapRect(shape.x0, shape.x1, shape.z0, shape.z1);
      pad.x0 = s.x0; pad.x1 = s.x1; pad.z0 = s.z0; pad.z1 = s.z1;
    }
    const r = PAD_MARGIN + fo;
    pad.bb = [pad.x0 - r, pad.x1 + r, pad.z0 - r, pad.z1 + r];
    this.pads.push(pad);
    this._bucket(this._ph, pad.bb, pad);
    return h;
  }
  /** the natural ground along a polyline, resampled every CORR_STEP m: [{ x, z, s, b, p }] with b the base height and p the smoothed
   *  profile (a +-16 m moving average, never more than 2.5 m from b). Pure: reads only the analytic base. */
  profile(poly) {
    const out = [];
    let run = 0;
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = poly[i][0], az = poly[i][1], bx = poly[i + 1][0], bz = poly[i + 1][1];
      const L = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)), n = Math.max(1, Math.ceil(L / CORR_STEP - 1e-9));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) { const t = k / n; out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: run + L * t, b: 0, p: 0 }); }
      run += L;
    }
    for (const q of out) q.b = this.base(q.x, q.z);
    const W = 4;
    for (let i = 0; i < out.length; i++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(out.length - 1, i + W); j++) { s += out[j].b; n++; }
      const m = s / n, b = out[i].b;
      out[i].p = Math.abs(m - b) > 2.5 ? b + Math.sign(m - b) * 2.5 : m;
    }
    return out;
  }
  /** Flatten a road across `width` along `polyline` ([[x, z], ...], world metres). `profile` (optional) = the points profile() returned,
   *  to register only part of it (the dry sections). */
  registerCorridor(polyline, width, opts) {
    opts = opts || {};
    const prof = opts.profile || this.profile(polyline);
    if (prof.length < 2) return 0;
    const hw = width / 2, off = hw + PAD_MARGIN;
    // the falloff follows the cut the flat road bed asks for: the natural ground at the edge of the core (both sides, every sample) against the
    // profile height. 4 m on level ground, +2.4 m per metre of departure beyond 0.5 m, 12 m at most; smoothed (max over +-2 samples) and
    // interpolated along each segment, so the nearest-segment switch at a joint never jumps.
    const n = prof.length, fv = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const L = Math.sqrt(dx * dx + dz * dz) || 1; dx /= L; dz /= L;
      let dev = 0;
      for (const sd of [-1, 1]) dev = Math.max(dev, Math.abs(this.base(prof[i].x - dz * off * sd, prof[i].z + dx * off * sd) - prof[i].p));
      fv[i] = Math.min(12, Math.max(opts.falloff || 4, (opts.falloff || 4) + 2.4 * Math.max(0, dev - 0.5)));
    }
    const fs = fv.map((v, i) => { let m = v; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (fv[k] > m) m = fv[k]; return m; });
    for (let i = 0; i + 1 < n; i++) {
      const A = prof[i], B = prof[i + 1], r = off + Math.max(fs[i], fs[i + 1]);
      const sg = { ax: A.x, az: A.z, bx: B.x, bz: B.z, ha: Math.fround(A.p), hb: Math.fround(B.p), hw, fa: fs[i], fb: fs[i + 1], cid: this.corridors };
      this.segs.push(sg);
      this._bucket(this._sh, [Math.min(A.x, B.x) - r, Math.max(A.x, B.x) + r, Math.min(A.z, B.z) - r, Math.max(A.z, B.z) + r], sg);
    }
    this.corridors++;
    return prof.length - 1;
  }
  /** base + corridors + pads registered so far */
  live(x, z) {
    let h = this.base(x, z);
    const key = (Math.floor(x / PAD_HASH) + 512) * 1024 + (Math.floor(z / PAD_HASH) + 512);
    const sl = this._sh.get(key);
    if (sl !== undefined) {
      // ONE segment per corridor decides: the nearest (a corridor's segments are consecutive in the cell list). Averaging every segment inside
      // the core instead blurred the profile by a different amount at every offset from the centreline and put a 0.25 m dip across the road.
      let sw = 0, swh = 0, mw = 0, cid = -1, bd2 = 1e18, bt = 0, bs = null;
      for (let i = 0; i <= sl.length; i++) {
        const s = i < sl.length ? sl[i] : null;
        if (s === null || s.cid !== cid) {
          if (bs !== null) {
            let d = Math.sqrt(bd2) - (bs.hw + PAD_MARGIN);
            const fo = bs.fa + (bs.fb - bs.fa) * bt;
            if (d < fo) {
              if (d < 0) d = 0;
              const u = 1 - d / fo, w = u * u * (3 - 2 * u), w2 = w * w, w4 = w2 * w2, w8 = w4 * w4, w16 = w8 * w8, w32 = w16 * w16;
              sw += w32; swh += w32 * (bs.ha + (bs.hb - bs.ha) * bt);
              if (w > mw) mw = w;
            }
          }
          if (s === null) break;
          cid = s.cid; bd2 = 1e18; bs = null;
        }
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (s.ax + dx * t), ez = z - (s.az + dz * t), d2 = ex * ex + ez * ez;
        if (d2 < bd2) { bd2 = d2; bt = t; bs = s; }
      }
      if (mw > 0 && sw > 0) h += (swh / sw - h) * mw;
    }
    const pl = this._ph.get(key);
    if (pl !== undefined) {
      let sw = 0, swh = 0, mw = 0, cw = 0, cwh = 0;          // cw / cwh: the pads whose flat CORE holds this point (they alone decide it)
      for (let i = 0; i < pl.length; i++) {
        const p = pl[i];
        let d;
        if (p.poly === null) {
          const ex = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0;
          const ez = z < p.z0 ? p.z0 - z : z > p.z1 ? z - p.z1 : 0;
          d = Math.sqrt(ex * ex + ez * ez);
        } else d = TerrainField._polyDist(p.poly, x, z) - PAD_MARGIN;
        if (d >= p.fo) continue;
        if (d <= 0) { cw += 1; cwh += p.h; continue; }
        const u = 1 - d / p.fo, w = u * u * (3 - 2 * u), w2 = w * w, w4 = w2 * w2, w8 = w4 * w4, w16 = w8 * w8, w32 = w16 * w16;
        sw += w32; swh += w32 * p.h;
        if (w > mw) mw = w;
      }
      // inside a flat core ONLY the cores count: a neighbour's wide falloff (up to 12 m) would still pull a core by 0.01-0.03 m through the
      // 32nd-power blend (two huts 12 m apart on a 3 m step), and a footprint must be level to 0.02 m
      if (cw > 0) h += (cwh / cw - h);
      else if (mw > 0 && sw > 0) h += (swh / sw - h) * mw;
    }
    return h;
  }
  /** GENERATION-TIME ground: `live` sampled on the lattice nodes and interpolated exactly the way at() will, so a generator that reads the ground
   *  here sees what the baked ground will hold at that spot (a pad's falloff is a steep smoothstep, and its straight lattice interpolation
   *  differs from the smooth curve by up to 0.5 m, which hung every lamp post on a falloff slope in the air). Exact wherever no pad or
   *  corridor is registered afterwards. */
  liveLat(x, z) {
    let fx = (x + 800) * (LAT_CELLS / SIZE), fz = (z + 800) * (LAT_CELLS / SIZE);
    fx = fx < 0 ? 0 : fx > LAT_CELLS ? LAT_CELLS : fx; fz = fz < 0 ? 0 : fz > LAT_CELLS ? LAT_CELLS : fz;
    let ix = fx | 0, iz = fz | 0;
    if (ix >= LAT_CELLS) ix = LAT_CELLS - 1;
    if (iz >= LAT_CELLS) iz = LAT_CELLS - 1;
    const u = fx - ix, v = fz - iz;
    const x0 = TerrainField.node(ix), x1 = TerrainField.node(ix + 1), z0 = TerrainField.node(iz), z1 = TerrainField.node(iz + 1);
    if (u + v <= 1) {
      const h00 = Math.fround(this.live(x0, z0));
      return h00 + u * (Math.fround(this.live(x1, z0)) - h00) + v * (Math.fround(this.live(x0, z1)) - h00);
    }
    const h11 = Math.fround(this.live(x1, z1));
    return h11 + (1 - u) * (Math.fround(this.live(x0, z1)) - h11) + (1 - v) * (Math.fround(this.live(x1, z0)) - h11);
  }
  /** The earliest registered pad whose flat core shares a lattice node with the core of a footprint [x0, x1] x [z0, z1] ({ pad, same } with
   *  same = the cores are identical; `all` = every pad touched), or null. Two buildings that close can only both stand on exactly level ground if they share one level. */
  overlapPad(x0, x1, z0, z1) {
    const c = PAD_HASH, s = TerrainField.snapRect(x0, x1, z0, z1);
    let best = null;
    const all = [];
    for (let kx = Math.floor((s.x0 - 1) / c); kx <= Math.floor((s.x1 + 1) / c); kx++) for (let kz = Math.floor((s.z0 - 1) / c); kz <= Math.floor((s.z1 + 1) / c); kz++) {
      const l = this._ph.get((kx + 512) * 1024 + (kz + 512));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const p = l[i];
        if (p.poly === null && s.x0 <= p.x1 && p.x0 <= s.x1 && s.z0 <= p.z1 && p.z0 <= s.z1) {       // the flat cores share a node
          if (all.indexOf(p) < 0) all.push(p);
          if (best === null || p.id < best.id) best = p;
        }
      }
    }
    return best === null ? null : { pad: best, all, same: best.x0 === s.x0 && best.x1 === s.x1 && best.z0 === s.z0 && best.z1 === s.z1 };
  }
  /** distance from (x, z) to the polygon: 0 inside, else to the nearest edge */
  static _polyDist(poly, x, z) {
    let inside = false, best = 1e18;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (ax + dx * t), ez = z - (az + dz * t), d2 = ex * ex + ez * ez;
      if (d2 < best) best = d2;
    }
    return inside ? 0 : Math.sqrt(best);
  }
  /** evaluate everything on the lattice (Float32). After this at() is the ground. */
  bake() {
    const L = new Float32Array(LAT_N * LAT_N);
    for (let iz = 0; iz < LAT_N; iz++) {
      const z = TerrainField.node(iz);
      for (let ix = 0; ix < LAT_N; ix++) L[iz * LAT_N + ix] = this.live(TerrainField.node(ix), z);
    }
    this.lat = L;
    return L;
  }
  /** Triangle-exact ground height: the lattice cell (ix, iz) is two triangles split along the diagonal (ix, iz+1)-(ix+1, iz) exactly as
   *  three's PlaneGeometry indexes them ((a, b, d) where u + v <= 1, then (b, c, d)); outside the lattice the edge value is held. */
  at(x, z) {
    const L = this.lat;
    let fx = (x + 800) * (LAT_CELLS / SIZE), fz = (z + 800) * (LAT_CELLS / SIZE);
    fx = fx < 0 ? 0 : fx > LAT_CELLS ? LAT_CELLS : fx; fz = fz < 0 ? 0 : fz > LAT_CELLS ? LAT_CELLS : fz;
    let ix = fx | 0, iz = fz | 0;
    if (ix >= LAT_CELLS) ix = LAT_CELLS - 1;
    if (iz >= LAT_CELLS) iz = LAT_CELLS - 1;
    const u = fx - ix, v = fz - iz, i = iz * LAT_N + ix;
    if (u + v <= 1) return L[i] + u * (L[i + 1] - L[i]) + v * (L[i + LAT_N] - L[i]);
    const h11 = L[i + LAT_N + 1];
    return h11 + (1 - u) * (L[i + LAT_N] - h11) + (1 - v) * (L[i + 1] - h11);
  }
}

// ── palette / biome coloring per map ────────────────────────────────────────
function colorAt(mapId, h, x, z, seed, out) {
  // `out` (optional) receives the colour and is returned - the clutter ring
  // recolours up to 1,400 tufts per rebuild. Same arithmetic as the old literal
  // returns, term for term.
  const o = out || [0, 0, 0];
  const n = fbm(x / 60, z / 60, seed + 51, 2, 2, 0.5);
  if (mapId === "isla_viva") {
    if (h < 0.4) return rgb(o, 0.93, 0.87, 0.64);                 // sand
    if (h < 2.2) return rgb(o, 0.90 - n * 0.1, 0.84, 0.58);
    if (h > 34) {                                                  // volcano rock (Wave 7b stage B: dark basalt with rust strata, darker toward the rim - was a pale grey that read as dust, not rock)
      const t = Math.min(1, (h - 34) / 30), band = 0.5 + 0.5 * Math.sin(h * 0.45 + n * 4.0);
      return rgb(o, 0.19 - 0.04 * t + band * 0.12 + n * 0.05, 0.16 - 0.035 * t + band * 0.05 + n * 0.04, 0.145 - 0.03 * t + band * 0.02 + n * 0.035);   // (linear: ~#776e6a basalt, rust bands to ~#9a7c6a)
    }
    return rgb(o, 0.18 + n * 0.15, 0.62 + n * 0.18, 0.28);        // lush grass
  }
  if (mapId === "ashgrid") {
    // SAVANNA split into a green west and an arid DESERT east — a GEOGRAPHIC zone
    // (guaranteed every seed) with an organic noisy boundary. Final Drop-style.
    const edge = fbm(x / 260, z / 260, seed + 61, 2, 2, 0.5) * 120;
    const desert = Math.max(0, Math.min(1, (x - 40 + edge) / 320));   // 1 = desert dunes (east)
    const m = fbm(x / 130, z / 130, seed + 77, 2, 2, 0.5);            // local green/gold patches
    if (h < 0.5) return rgb(o, 0.85, 0.74, 0.5);                      // sandy dry wash
    if (h > 28) return rgb(o, 0.55 + n * 0.08, 0.44, 0.31);           // sun-baked bluffs
    const g0 = 0.58 + n * 0.12, g1 = 0.70 + m * 0.20, g2 = 0.30 + n * 0.08;   // savanna grass (brighter, greener)
    const s0 = 0.90 + n * 0.07, s1 = 0.78 + n * 0.06, s2 = 0.50;           // desert sand (bright)
    return rgb(o, g0 + (s0 - g0) * desert, g1 + (s1 - g1) * desert, g2 + (s2 - g2) * desert);
  }
  if (mapId === "deepwood") {
    // FOREST with a distinct northern SNOW biome — a GEOGRAPHIC zone (guaranteed
    // every seed) with an organic noisy edge. Snow is intentionally bright bluish-white.
    const edge = fbm(x / 240, z / 240, seed + 91, 2, 2, 0.5) * 90;
    const snow = Math.max(0, Math.min(1, (-z - 100 + edge) / 260));   // 1 = deep snow (far north)
    let b0, b1, b2;
    if (h < 0.6) { b0 = 0.55; b1 = 0.5; b2 = 0.38; }                  // river mud
    else if (h > 44) { b0 = 0.5; b1 = 0.48; b2 = 0.45; }              // rocky tops
    else { b0 = 0.12 + n * 0.1; b1 = 0.4 + n * 0.14; b2 = 0.16; }    // deep green
    if (snow > 0.01) {
      const c0 = 0.90 + n * 0.06, c1 = 0.94 + n * 0.05, c2 = 0.98;   // snow (crisp bright white, faint blue)
      return rgb(o, b0 + (c0 - b0) * snow, b1 + (c1 - b1) * snow, b2 + (c2 - b2) * snow);
    }
    return rgb(o, b0, b1, b2);
  }
  return rgb(o, 0.5 + n * 0.1, 0.62, 0.42);
}
function rgb(o, r, g, b) { o[0] = r; o[1] = g; o[2] = b; return o; }

// ═══════════════════════════════════════════════════════════════════════════
/** Release the GPU resources the LAST map allocated.
 *  Match teardown was `group.clear()`, which detaches meshes but frees nothing:
 *  the 221x221 terrain plane (~2.1 MB of vertex data), every merged structure
 *  batch, the road mesh, the sky dome and its ShaderMaterial and a fresh cloud
 *  CanvasTexture were orphaned EVERY match — and ?v=65 made PLAY AGAIN the
 *  expected flow, so it compounds without ever passing through a reload.
 *
 *  Scoped deliberately: maps.js writes only into W.group("map"), while fx, loot,
 *  weapons and player own their own groups, so nothing pooled or shared lives
 *  under here. The one thing that DOES survive across matches is the procedural
 *  texture cache (_texCache, built once per page session on purpose) — those are
 *  excluded by identity, because disposing them would leave the next match
 *  rendering with dead GPU handles. */
/** C8 teardown contract: the map's per-match GPU objects (idempotent; see below). */
export function disposeMatch(W) { return disposeMapResources(W); }

/** C-WARM (Wave 4): maps.js creates NO objects after the map is built — the sky dome, its baked cloud
 *  texture and the birds are all in the scene when kernel.warmup runs — so there is nothing extra to
 *  warm. Exported so the orchestrator can call every module's warmObjects feature-detected. */
export function warmObjects(W) { return []; }

export function disposeMapResources(W) {
  // C-SKY handles belong to the map being torn down: never leave a consumer (STORMFX's storm tint)
  // holding the uniforms of a disposed dome between matches. Done before the idempotence guard.
  W.skyUniforms = null; W.skyDome = null;
  if (W._lcOwned) { for (const t of W._lcOwned) { try { t.dispose(); } catch (e) { /* gone */ } } W._lcOwned = null; LCU.uLcHgt.value = null; LCU.uLcAO.value = null; }
  const g = W._groups && W._groups.map;
  if (W._cityKit) { try { W._cityKit.dispose(); } catch (e) { /* already gone */ } W._cityKit = null; }   // WAVE 7: the instanced districts' matrix buffers, palette textures and proxies (a group traverse frees none of them)
  if (!g) return { geometries: 0, materials: 0, textures: 0 };
  // Idempotent per build (disposeMatch and the orchestrator's direct call may both
  // run in one teardown); buildMap re-arms it.
  if (g.userData.disposed) return { geometries: 0, materials: 0, textures: 0 };
  g.userData.disposed = true;
  const shared = new Set();
  for (const k in _texCache) {
    const v = _texCache[k];
    if (!v) continue;
    if (v.isTexture) shared.add(v);
    else { if (v.map) shared.add(v.map); if (v.normal) shared.add(v.normal); }
  }
  const seenG = new Set(), seenM = new Set(), seenT = new Set();
  let geometries = 0, materials = 0, textures = 0;
  g.traverse((o) => {
    // (Wave 8 fix round, lane K1) a BatchedMesh (the furnished houses' insides) owns its geometry AND two data textures (instance matrices, indirection): dispose() frees all three
    if (o.isBatchedMesh && o.geometry && !seenG.has(o.geometry)) { seenG.add(o.geometry); try { o.dispose(); } catch (e) { /* already gone */ } geometries++; textures += 2; }
    if (o.geometry && !seenG.has(o.geometry)) { seenG.add(o.geometry); o.geometry.dispose(); geometries++; }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || seenM.has(m)) continue;
      seenM.add(m);
      for (const slot of ["map", "normalMap", "roughnessMap", "alphaMap", "emissiveMap", "aoMap"]) {
        const t = m[slot];
        if (t && t.isTexture && !shared.has(t) && !seenT.has(t)) { seenT.add(t); t.dispose(); textures++; }
      }
      m.dispose(); materials++;
    }
  });
  return { geometries, materials, textures };
}

// ── city themes (Wave 7b): the colour / loot tables of the town builder, one per map ───────────────────────────────────────────────────────────
// ashgrid is the Wave-7 Savanna table VERBATIM (its world must hash identically); isla_viva and deepwood are the O2 themes: a pastel resort and a timber lodge village.
const CITY_THEME_TABLES = {
  ashgrid: {
    // (D2: the house and shop lists were all tans: a block of them was one colour from the plane. Sage, sky blue, terracotta, white, mustard, teal, rose and brick red join them; a block still takes
    //  only TWO of its list, so a street stays one family and the next street is another)
    walls: { house: ["#d9c7a5", "#cfae86", "#c4966f", "#e2d8c3", "#b3ad94", "#cba08f", "#bfa27a", "#9fb394", "#a9c0cf", "#c4725a", "#ebe6d6", "#d6b55a", "#7fa7a3", "#d9a7a0", "#a85a45"],
      shop: ["#d8a766", "#86a9b9", "#c4b88d", "#cf8068", "#a9b7a0", "#d6c08a", "#e0d6b8", "#7fa7a3", "#c4725a", "#d6b55a", "#8c9fb8"],
      big: ["#8fa4b8", "#a7b3bd", "#c6b79c", "#9fae9d", "#b69883", "#8197ad", "#b9b5aa", "#7b8fa3", "#a89684"], hall: ["#b8ad94", "#a5a79b", "#c3b49a", "#9b9a8c"], shed: ["#a68f62", "#b08968", "#93805e"],
      barn: ["#a8553c", "#8f4a38", "#b9a27a", "#7e6a58"],
      core: ["#6d8aa5", "#5f7a93", "#7d93a8", "#8a7a6c", "#9aa8b4", "#6e7c8a", "#b09a84", "#74897b"] },     // (downtown towers: deeper, glassier tones than the town walls so the skyline reads from the plane, none so dark it goes black in shade)
    roofs: ["#b5643c", "#9a4a36", "#7b5a48", "#8a6a50", "#a8523a", "#6c5a52", "#c07a48", "#5e6b73", "#8b5a3c", "#a3452f",
      "#4c5865", "#3e4a58", "#6e8796", "#d8d3c4", "#587a5c", "#8e3b38", "#2f3d4c", "#b9553a"],     // (D2: slate, blue-grey, white flat deck, patina green, oxblood: roofs are what a 330 m drop view sees of a house)
    awnings: ["#c0563a", "#3a7a9a", "#d6a23a", "#5a8a5a", "#9a3a4a", "#d8d2c0"],
    glass: ["#34495e", "#2f4256", "#3d5266", "#2b3b4a"],
    mullions: ["#323c48", "#3a4a5a", "#2c3a30", "#4a3a34", "#2f3a52"],
    fences: [["#9a7a4a", 1.0], ["#d9d2c0", 1.1], ["#7d8288", 1.3], ["#6b4f33", 0.9]],
    // [floor-item chance, chest chance] per building. 7A2: the city has 40 % more buildings than stage A and a chest is TWO draw calls (base + lid, no instancing): the chest chances are
    // about 60 % of stage A's so a downtown view does not pay 30 calls for chests (seed 1: 18 chests in the drop view); floor items keep their stage-A odds
    loot: { house: [0.5, 0.12], shop: [0.8, 0.2], hall: [0.9, 0.3], shed: [0.35, 0.05], cmpHouse: [0.40, 0.12], cmpShed: [0.30, 0.05] },   // (the ~60 wild spots that moved: 30 compounds x ~2 points)
    tower: { core: { loot: 0.75, chest: 0.33, mullion: "#323c48" }, town: { loot: 0.6, chest: 0.25, mullion: "#3a3f46" } },
  },
  // Isla Viva: a coastal RESORT. Whitewash, cream, peach and seafoam walls under coral, teal and aqua roofs; striped awnings; white picket and driftwood fences.
  isla_viva: {
    walls: { house: ["#f7aa94", "#aae2cc", "#90d4e4", "#fce498", "#faf4e8", "#f0aaba", "#f2cdb2", "#bfe3dc", "#f6f1e6", "#f3bba6"],     // (the first six are the kit palettes' colourways: coral, mint, lagoon, sun, shell, rose - lane B3's theme_colours.js)
      shop: ["#faf4e8", "#fce498", "#aae2cc", "#f7aa94", "#90d4e4", "#f0aaba", "#f2c9a0", "#cfe6e0"],
      big: ["#f4efe4", "#efe3cd", "#dff0ee", "#f2d8c4", "#e8d9c2", "#d9ebe8"], hall: ["#efe5d0", "#d9e8e4", "#f1ddb8", "#e6d3bd"], shed: ["#c9a97a", "#b89a6e", "#d6b88a", "#ae8f63"],
      barn: ["#b9553d", "#a2503c", "#c9a27a", "#8f6a48"],
      core: ["#f4efe4", "#efe3cd", "#dff0ee", "#f2d8c4"] },
    roofs: ["#c0583e", "#22808c", "#2e60a8", "#dc6e3c", "#c8ced4", "#b44a3a", "#e2674a", "#2f9aa0", "#3aa6a4", "#d98a3c", "#e58a6a", "#2c8f95", "#f0efe6", "#c85c46"],
    awnings: ["#e2574c", "#1f9aa6", "#f2b53c", "#f4f1e8", "#e87fa0", "#3ea06a"],
    glass: ["#4a7f93", "#3f7389", "#5a93a3", "#34687c"],
    mullions: ["#e8e2d2", "#d9d2c0", "#f3efe4", "#cfc8b4"],
    fences: [["#f4efe4", 1.0], ["#d9b98a", 1.0], ["#c9a97a", 0.9], ["#e3d6bd", 1.1]],
    // (stage A cut the chest rolls to ~1/3 of Savanna's because a chest was FIVE draw calls; since loot.js draws every chest as an instance of one pool (Wave 7b stage B: 3 calls for all
    //  of them) the rolls are Savanna's or a little more: Isla Viva's chests were 31-44 per match against 51-69 at the live build. Floor items and wild spots as before.)
    loot: { house: [0.58, 0.24], shop: [0.88, 0.34], hall: [0.92, 0.44], shed: [0.42, 0.1], cmpHouse: [0.48, 0.24], cmpShed: [0.36, 0.1] },     // (a little above Savanna's: the resort has ~230 buildings a match, Savanna ~410)
    tower: { core: { loot: 0.78, chest: 0.45, mullion: "#e8e2d2" }, town: { loot: 0.68, chest: 0.35, mullion: "#f3efe4" } },
    // the ground of a resort town: a plank boardwalk for the sidewalk ring, sun-bleached paving inside the blocks, beach-white lane lines
    ground: { ring: "#c19a6a", plaza: "#d9ccae", white: "#fbf6e8", road: "#5b5a58",          // (stage B: dark asphalt, was a pale "#8a8070" - the street grid vanished into the drop view's sea haze)
      lot: { parking: "#a39d8e", park: "#56a05a", yard: "#dccfa9", plaza: "#efe6d0", market: "#cfa56e", gas: "#9a9484", court: "#c26a50", beach: "#eadcae", pool: "#5fb6c4", garden: "#62a85c" },
      tones: { core: ["#e0d4b8", "#d9ccae", "#e6dac0"], town: ["#e3d7bb", "#dccfae", "#e8dcc2", "#d6c9a8", "#e0d2b2", "#eadfc6"], yard: ["#b9ae96", "#c4b99f", "#aea38c"] },
      minimap: { block: "#efe2c0" } },
  },
  // Deepwood: a timber LODGE village. Log and plank walls in browns under dark green, oxblood and bark roofs; a red barn; split-rail and plank fences.
  deepwood: {
    walls: { house: ["#bc8c56", "#96543a", "#624430", "#8a5a33", "#9c9280", "#7a4e2d", "#4a6c54", "#9a6a3f", "#9c3a2e", "#a07445", "#6f4a2e", "#85583a"],     // (pine, cedar, walnut, driftwood, forest, barn: lane B3's lodge colourways)
      shop: ["#bc8c56", "#9a6a3f", "#96543a", "#a8794f", "#9c9280", "#b08a5e"],
      big: ["#7a5a3a", "#6a4c34", "#8a6a48", "#7d6446"], hall: ["#6f4a2e", "#7d5a3a", "#5e4630", "#8a6a48"], shed: ["#6b4f33", "#5c4430", "#7a5c3c", "#85673f"],
      barn: ["#8c3b2e", "#7a3328", "#9a4636", "#6e4a38"],
      core: ["#7a5a3a", "#6a4c34", "#8a6a48"] },
    roofs: ["#2f5a3c", "#3a6a44", "#27503a", "#35604a", "#8e3b2e", "#a3452f", "#7a3326", "#4a3a2c", "#5a4636", "#3c4650", "#2e4f45", "#6e2f26"],
    awnings: ["#8e3b2e", "#2f5a3c", "#c9a24a", "#6a4a32"],
    glass: ["#3b4a52", "#2f3d44", "#42535b"],
    mullions: ["#3a2a1e", "#2e2118", "#4a3626"],
    fences: [["#6b4f33", 1.0], ["#5c4430", 1.1], ["#7a5c3c", 0.9], ["#85673f", 1.0]],
    loot: { house: [0.58, 0.12], shop: [0.88, 0.2], hall: [0.92, 0.3], shed: [0.42, 0.05], cmpHouse: [0.48, 0.12], cmpShed: [0.36, 0.05] },     // (Savanna's chest rolls: see the resort table)
    tower: { core: { loot: 0.78, chest: 0.33, mullion: "#3a2a1e" }, town: { loot: 0.68, chest: 0.25, mullion: "#4a3626" } },
    // the ground of a lodge village: gravel kerbs, trodden earth inside the blocks, pine-needle brown lanes (no lane paint, no zebra crossings: noMarkings)
    ground: { noMarkings: true, ring: "#9a8f7a", plaza: "#6f6850", white: "#d8cfba", road: "#5f4f3c",
      lot: { parking: "#6d6a5c", park: "#4a7a45", yard: "#7d7157", plaza: "#a89d84", market: "#8d7556", gas: "#6d6a5c", court: "#7a4a38", woodyard: "#6b5a40", campfire: "#4f4636", garden: "#4f8048" },
      tones: { core: ["#6f6850", "#7a735a", "#665f4a"], town: ["#6e6a52", "#77705a", "#645f4a", "#7a7560", "#6a654e", "#736d56"], yard: ["#5f5944", "#6a634c", "#58523f"] },
      minimap: { block: "#c9bd9c" } },
  },
};

// LC-89: one kind's cull pass, at MODULE level (the hot loop optimised, like bakeContactAO below). PL = the 6 frustum planes as [nx, ny, nz, c] x 6;
// Q = [camera x, y, z, draw distance^2, fade start, 1 / fade length] (a Float64Array: doubles passed as plain arguments are boxed per call);
// out = [instances drawn, LOD instances drawn].
function lcCullKind(list, cxA, cyA, czA, crA, hid, parts, PL, Q, out) {
  const n = list.length, px = Q[0], py = Q[1], pz = Q[2], D2 = Q[3], F0 = Q[4], FK = Q[5];
  let nOut = 0, nLod = 0;
  for (let i = 0; i < n; i++) {
    if (list[i].dead) continue;
    const cx = cxA[i], cy = cyA[i], cz = czA[i], r = crA[i];
    const dx = cx - px, dy = cy - py, dz = cz - pz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > D2) continue;
    const d = Math.sqrt(d2), pad = -(r + 4 + d * 0.07);
    if (PL[0] * cx + PL[1] * cy + PL[2] * cz + PL[3] < pad || PL[4] * cx + PL[5] * cy + PL[6] * cz + PL[7] < pad || PL[8] * cx + PL[9] * cy + PL[10] * cz + PL[11] < pad ||
        PL[12] * cx + PL[13] * cy + PL[14] * cz + PL[15] < pad || PL[16] * cx + PL[17] * cy + PL[18] * cz + PL[19] < pad || PL[20] * cx + PL[21] * cy + PL[22] * cz + PL[23] < pad) continue;
    const fade = d > F0 ? Math.max(0, 1 - (d - F0) * FK) : 1;
    const skipLod = hid !== null && hid.has(i);
    for (let k = 0; k < parts.length; k++) {
      const pt = parts[k];
      if (pt.lod && skipLod) continue;
      const o = (pt.lod ? nLod : nOut) * 16, a = pt.arr, sv = pt.src, si = i * 16;
      if (fade === 1) for (let j = 0; j < 16; j++) a[o + j] = sv[si + j];
      else { for (let j = 0; j < 12; j++) a[o + j] = (j & 3) === 3 ? sv[si + j] : sv[si + j] * fade; a[o + 12] = sv[si + 12]; a[o + 13] = sv[si + 13]; a[o + 14] = sv[si + 14]; a[o + 15] = sv[si + 15]; }
    }
    nOut++;
    if (!skipLod) nLod++;
  }
  out[0] = nOut; out[1] = nLod;
}
/** LC-41: the contact-AO mask (see buildMap). A module-level function, not a block inside buildMap: buildMap is far past V8's optimising-compiler size
 *  limit, so a hot loop written inline there runs in the baseline tier (the 16 M-texel blur measured 1.6-3.3 s in the page vs 0.16 s optimised).
 *  `gyc[i]` = the ground under collider i's centre (the caller's heightAt). Returns the R8 texels, the colliders rasterised and the raster's ms. */
function bakeContactAO(colliders, gyc, N, size) {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const half = size / 2, inv = N / size, occ = new Float32Array(N * N), rowHas = new Uint8Array(N);
  let nAO = 0;
  for (let ci = 0; ci < colliders.length; ci++) {
    const c = colliders[ci];
    if (c.dead || c.kind !== "box") continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (w * d > 6000 || w < 0.05 || d < 0.05) continue;
    const gy = gyc[ci];
    if (c.minY > gy + 0.35 || c.maxY < gy + 0.5) continue;
    const hk = Math.min(1, (c.maxY - Math.max(c.minY, gy)) / 2.5);
    const fx0 = (c.minX + half) * inv, fx1 = (c.maxX + half) * inv, fz0 = (c.minZ + half) * inv, fz1 = (c.maxZ + half) * inv;
    const i0 = Math.max(0, Math.floor(fx0)), i1 = Math.min(N - 1, Math.floor(fx1)), j0 = Math.max(0, Math.floor(fz0)), j1 = Math.min(N - 1, Math.floor(fz1));
    for (let j = j0; j <= j1; j++) {
      const cz = Math.min(j + 1, fz1) - Math.max(j, fz0);
      if (cz <= 0) continue;
      rowHas[j] = 1;
      for (let i = i0; i <= i1; i++) {
        const cx = Math.min(i + 1, fx1) - Math.max(i, fx0);
        if (cx <= 0) continue;
        const v = cx * cz * hk, k = j * N + i;
        if (v > occ[k]) occ[k] = v;
      }
    }
    nAO++;
  }
  const t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  // the blur: two 3-texel boxes (~ a 1.6 m soft edge) = ONE separable 5-tap [1 2 3 2 1] / 9 per axis, edges clamped; only the rows the raster touched (+-2)
  // are filtered (the rest of the map stays 0) and the vertical pass writes the bytes directly
  const tmp = new Float32Array(N * N), px = new Uint8Array(N * N), k9 = 1 / 9;
  for (let r = 0; r < N; r++) {
    if (!rowHas[r]) continue;
    const o = r * N;
    for (let c = 0; c < N; c++) {
      const cm2 = c < 2 ? 0 : c - 2, cm1 = c < 1 ? 0 : c - 1, cp1 = c > N - 2 ? N - 1 : c + 1, cp2 = c > N - 3 ? N - 1 : c + 2;
      tmp[o + c] = (occ[o + cm2] + 2 * occ[o + cm1] + 3 * occ[o + c] + 2 * occ[o + cp1] + occ[o + cp2]) * k9;
    }
  }
  for (let r = 0; r < N; r++) {
    const rm2 = r < 2 ? 0 : r - 2, rm1 = r < 1 ? 0 : r - 1, rp1 = r > N - 2 ? N - 1 : r + 1, rp2 = r > N - 3 ? N - 1 : r + 2;
    if (!rowHas[rm2] && !rowHas[rm1] && !rowHas[r] && !rowHas[rp1] && !rowHas[rp2]) continue;
    const o = r * N, a = rm2 * N, b = rm1 * N, d = rp1 * N, e = rp2 * N;
    for (let c = 0; c < N; c++) {
      const v = (tmp[a + c] + 2 * tmp[b + c] + 3 * tmp[o + c] + 2 * tmp[d + c] + tmp[e + c]) * k9;
      px[o + c] = v >= 1 ? 255 : v <= 0 ? 0 : (v * 255 + 0.5) | 0;
    }
  }
  return { px, nAO, rasterMs: Math.round((t1 - t0) * 10) / 10 };
}

export async function buildMap(W, mapId) {
  const K = MAPS[mapId] || MAPS.isla_viva;
  const seed = W.seed;
  // C-GFX: the tier this map is BUILT for (fixed for the match: the in-match ladder only moves bloom / DPR). LCFX = the world-shader layer (LCU) and the photo
  // wall detail: off on low. ULTRA (lane boot) = the longest draw / foliage / grass / furniture distances and the 5 x 5 near terrain ring (see TIER_Q).
  const TIER = gfxTierOf(W), LCFX = TIER !== "low";
  const TIER_Q = {
    low:    { propD: 600, nearR: 110, nearN: 64, clR: 55, clN: 1400, distD: 1100, furnD: 60, ring: 1, lamps: 0 },
    medium: { propD: 780, nearR: 110, nearN: 64, clR: 55, clN: 1400, distD: 1100, furnD: 60, ring: 1, lamps: 4 },
    high:   { propD: 1000, nearR: 125, nearN: 72, clR: 60, clN: 1700, distD: 1300, furnD: 70, ring: 1, lamps: 4 },
    ultra:  { propD: 1650, nearR: 165, nearN: 112, clR: 78, clN: 2900, distD: 1750, furnD: 95, ring: 2, lamps: 6 },
  }[TIER];
  const GRADE = K.grade || { exposure: 1.15, ground: 1, water: 1 };   // LC-04 / OD-2 (see MAPS)
  const grimePromise = LCFX ? loadGrimeTexture(W).catch(() => null) : Promise.resolve(null);   // LC-17: the CC0 wall photograph (medium and up)
  // the world-shader layer's per-match textures (the ground lattice, the contact-AO mask): no material slot holds them (they are uniforms), so the map
  // disposes them itself - the previous match's first (a rebuild without a teardown), the rest in disposeMapResources
  if (W._lcOwned) { for (const t of W._lcOwned) { try { t.dispose(); } catch (e) { /* gone */ } } }
  W._lcOwned = [];
  const lcOwn = (t) => { W._lcOwned.push(t); return t; };
  LCU.uLcHgt.value = null; LCU.uLcAO.value = null; LCU.uLcAOK.value.set(0, 0, 0, 0);
  W._lcU = LCU;                                       // (read-only handle for the gates: the world-shader layer's live uniforms)
  const rng = W.SIM.mulberry32(seed ^ 0xabcdef);
  const baseH = mkHeightFn(mapId, seed);
  const field = new TerrainField(baseH, SIZE);          // C-PAD: the analytic ground + the pads and corridors the generators register (see the section above mkHeightFn's palette)
  // GENERATION-TIME ground = base + every pad / corridor registered so far. After the bake (below, once every POI, building and road has
  // registered) this is rebound to the lattice, and from then on it IS the ground: physics, bots, loot, props, roads and the drawn surface.
  let heightAt0 = (x, z) => field.liveLat(x, z);
  // DECISIONS that gate a seeded random draw (does this lot / landmark / tree / portal / loot spot exist?) read baseH, the analytic ground, NOT
  // heightAt0: a pad, a corridor or the lattice interpolation moves a height by a few cm, which near a waterline flips a yes/no, and one
  // conditional draw more or less reshuffles every placement after it (the shared map RNG stream must see the same draws in the same order as
  // the Wave-5 build: worldcheck rng-stream). Positions that are BUILT on read heightAt0.
  const waterY = K.water ? 0 : -999;
  const propTablePromise = loadPropTable(W);   // never rejects (null = legacy colliders); awaited just before the first placement
  const photoPromise = loadPhotoTextures(W).catch(() => null);   // P2.5: the ground photographs (null = procedural grain only); awaited before the terrain is built

  if (W._cityKit) { try { W._cityKit.dispose(); } catch (e) { /* already gone */ } W._cityKit = null; }
  const g = W.group("map");
  let mapWater = null;   // exposed on the returned map so the camera can test submersion
  g.clear();
  g.userData.disposed = false;
  // The match build blocks the main thread for ~1,934 ms warm (all GLBs cached) with
  // exactly one await in front of it, so the loading screen's shimmer bar and its
  // 300 ms progress interval are frozen for the whole build — the tab looks hung,
  // and PLAY AGAIN makes that the expected flow rather than a once-per-session cost.
  // Yielding between phases does not make the build faster, it makes it ANIMATE, and
  // it lets the browser service input instead of banking a jank score. Safe to yield
  // here because the royale frame gate returns early unless phase is match/drop/over,
  // so nothing steps the world inside the gaps.
  const yieldPhase = () => new Promise((r) => setTimeout(r, 0));
  // remove the PREVIOUS map's per-frame updaters (cloud/bird/water drift) before
  // rebuilding — g.clear() drops the sprites but the kernel keeps the closures,
  // which then run every frame over detached arrays and retain them (leak/CPU
  // that compounds each match). trackUpdater registers + records for next cleanup.
  if (W._mapUpdaters && W.kernel._updaters) {
    for (const fn of W._mapUpdaters) { const idx = W.kernel._updaters.indexOf(fn); if (idx >= 0) W.kernel._updaters.splice(idx, 1); }
  }
  W._mapUpdaters = [];
  // ── IBL — scene.environment from THIS map's palette ────────────────────────
  // scene.environment was null for the game's whole life; four separate comments
  // across hud/maps/player note the consequence (metalness surfaces lose their
  // diffuse and gain no reflection in exchange). No HDR asset: a throwaway scene
  // (vertex-gradient sky dome from K.zenith/K.sky + hot sun disc + ground bounce)
  // goes through PMREM once per map build (~ms). Reflections agree with the world
  // because they are literally built from the same palette the background uses.
  // Intensity 0.5: the sun/hemi rig above stays the DOMINANT light — the env is
  // fill and reflections, not a relight.
  function buildEnvironment(W2, KK) {
    const r = W2.kernel && W2.kernel.renderer;
    if (!r) return;
    const pmrem = new THREE.PMREMGenerator(r);
    const es = new THREE.Scene();
    const skyG = new THREE.SphereGeometry(50, 24, 16);
    const posA = skyG.attributes.position, cols = new Float32Array(posA.count * 3);
    const cz = new THREE.Color(KK.zenith), ch = new THREE.Color(KK.sky);
    const cg = new THREE.Color(KK.sky).multiplyScalar(0.32);   // below-horizon bounce, same hue family
    const c = new THREE.Color();
    for (let i = 0; i < posA.count; i++) {
      const y = posA.getY(i) / 50;
      if (y >= 0) c.lerpColors(ch, cz, Math.min(1, y * 1.35));
      else c.lerpColors(ch, cg, Math.min(1, -y * 2.4));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    skyG.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
    es.add(sky);
    // sun disc positioned to agree with the shadow-casting sun's azimuth (kernel
    // sun sits +x/+z-ish high) so speculars land on the lit side of objects
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.93, 0.82).multiplyScalar(5) }));
    sun.position.set(30, 34, 16); sun.lookAt(0, 0, 0);
    es.add(sun);
    if (W2._envRT) W2._envRT.dispose();
    W2._envRT = pmrem.fromScene(es, 0.04);
    W2.scene.environment = W2._envRT.texture;
    W2.scene.environmentIntensity = 0.5;
    pmrem.dispose(); skyG.dispose(); sky.material.dispose();
    sun.geometry.dispose(); sun.material.dispose();
  }
  const trackUpdater = (fn) => { W._mapUpdaters.push(fn); W.kernel.onUpdate(fn); };
  W.scene.background = new THREE.Color(K.sky);
  if (W.scene.fog) { W.scene.fog.color = new THREE.Color(K.sky); W.scene.fog.density = K.fog; }
  buildEnvironment(W, K);
  // BRIGHT daytime match lighting. The render looked dim/muddy vs the bright, vibrant
  // Final Drop reference — a bright blue sky over dark green ground. Strong warm sun +
  // a much brighter, lighter-ground hemisphere fill so shadowed sides read as daylight
  // (not dusk), plus a touch more exposure. Also overrides any leaked menu light (D1).
  if (W._lightDefaults) {
    const kn = W.kernel;
    // ACES Filmic was crushing + desaturating the whole scene into a muddy dusk, so
    // this was set to NoToneMapping — which fixed the mud but removed the highlight
    // roll-off entirely: everything above 1.0 clamps to the same #ffffff, so the
    // Deepwood snow biome renders as a featureless blown sheet and lit skin goes
    // flat. NeutralToneMapping (Khronos PBR Neutral, three r165+) is the middle
    // term: near-identity below ~0.76 and far more saturation-preserving than ACES,
    // but it compresses instead of clipping above it. Note NoToneMapping also meant
    // toneMappingExposure was ignored outright — with the composer active the tone
    // map is applied by OutputPass, whose NoToneMapping path never multiplies by
    // exposure at all — so 1.15 is a real +15% mid-tone lift, not a re-statement.
    // The menu is untouched: hud.js restores ACES 1.12 for the menu diorama.
    kn.renderer.toneMapping = THREE.NeutralToneMapping;
    kn.renderer.toneMappingExposure = K.grade ? K.grade.exposure : 1.15;
    const sunK = K.sun || MAPS.isla_viva.sun, hemiK = K.hemi || MAPS.isla_viva.hemi;
    kn.sun.intensity = sunK.intensity; kn.sun.color.setHex(sunK.color);
    kn.sun.position.set(sunK.pos[0], sunK.pos[1], sunK.pos[2]);
    let hemi = null; W.scene.traverse((o) => { if (o.isHemisphereLight) hemi = o; });
    if (hemi) { hemi.intensity = hemiK.intensity; hemi.color.setHex(hemiK.sky); hemi.groundColor.setHex(hemiK.ground); }
    if (kn.bloom) kn.bloom.strength = 0.14;   // crisp match — minimal bloom haze
  }

  // ── terrain mesh (vertex-colored biome tint × tiled grain texture) ────────
  // CHUNKED TERRAIN (2026-07-28). 8x8 chunks of 200 m: FAR LOD draws every SECOND lattice node (~5.3 m), a lazy 3x3 near ring around the
  // camera rebuilds at EVERY node (~2.6 m) for the close-up silhouette. WAVE 6 (lane 6A): the chunks are built from the baked ground lattice
  // (TerrainField.bake: the analytic ground + every pad and road corridor), AFTER the whole layout exists - they used to be built first,
  // before any POI, from the bare analytic function. A near chunk's vertices ARE lattice nodes and TerrainField.at() is triangle-exact on
  // them with PlaneGeometry's diagonal, so the drawn near surface and the physics ground are the same numbers (p99 <= 1e-4 m, was
  // 0.012-0.037); the far LOD is the same surface sampled at every second node. Near-LOD perimeters keep their TRUE height and a 0.8 m
  // skirt (addSkirt) closes the crack against a far neighbour. Normals are central differences ON THE LATTICE (apron of one vertex step
  // beyond the chunk, clamped at the map edge), so lighting is identical across chunks and LODs.
  const aniso = W._texAniso || 4;
  const CHUNKS = 8, CSZ = SIZE / CHUNKS;
  const FAR_SEG = 38, NEAR_SEG = 76;                 // ~5.3 / ~2.6 m per vertex; NEAR_SEG * CHUNKS === LAT_CELLS
  const TILE = 8;                                    // meters per texture tile
  const terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  terrMat.color.setScalar(GRADE.ground);               // LC-04 (OD-2 G2): the ground's albedo (the vertex colours stay the biome palette the minimap and the tufts share)
  try {
    const gt = groundTex(aniso);
    terrMat.map = gt.map; terrMat.normalMap = gt.normal;
    terrMat.normalScale = new THREE.Vector2(0.55, 0.55);
  } catch (e) { /* canvas unavailable → flat vertex-color fallback */ }
  const _tn = new THREE.Vector3();
  const _sp = [1, 0, 0];
  let photo = null;                                  // set by buildTerrain before the first chunk
  let terrain = null;
  function buildChunk(ci, cj, seg, skirt) {
    const L = field.lat, step = NEAR_SEG / seg;      // lattice nodes per vertex step: 1 near, 2 far
    const gx0 = ci * NEAR_SEG, gz0 = cj * NEAR_SEG;  // lattice index of the chunk's low corner
    const pitch = CSZ / seg;
    const N = seg + 3;                               // apron grid dimension (one vertex step beyond the chunk on every side)
    const H = new Float32Array(N * N);
    for (let gz = 0; gz < N; gz++) {
      let iz = gz0 + (gz - 1) * step; iz = iz < 0 ? 0 : iz > LAT_CELLS ? LAT_CELLS : iz;
      for (let gx = 0; gx < N; gx++) {
        let ix = gx0 + (gx - 1) * step; ix = ix < 0 ? 0 : ix > LAT_CELLS ? LAT_CELLS : ix;
        H[gz * N + gx] = L[iz * LAT_N + ix];
      }
    }
    const geo = new THREE.PlaneGeometry(CSZ, CSZ, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const posA = geo.attributes.position, uvA = geo.attributes.uv;
    const cols = new Float32Array(posA.count * 3);
    const nrm = new Float32Array(posA.count * 3);
    const spl = photo ? new Float32Array(posA.count * 3) : null;
    const S1 = seg + 1;
    const vAt = skirt ? new Int32Array(S1 * S1) : null;   // lattice (ix, iz) -> vertex index, for the skirt loop below
    for (let i = 0; i < posA.count; i++) {
      const vx = i % S1, vz = (i / S1) | 0;               // PlaneGeometry order: rows (z) outer, columns (x) inner
      const gx = vx + 1, gz = vz + 1;
      const x = TerrainField.node(gx0 + vx * step), z = TerrainField.node(gz0 + vz * step);
      const h = H[gz * N + gx];
      // the vertex sits EXACTLY on its lattice node (float32 of the double node position: <= 3e-5 m)
      posA.setXYZ(i, x, h, z);
      if (vAt) vAt[vz * S1 + vx] = i;
      const c = colorAt(mapId, h, x, z, seed);
      cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
      if (spl) { splatAt(mapId, h, x, z, seed, _sp); spl[i * 3] = _sp[0]; spl[i * 3 + 1] = _sp[1]; spl[i * 3 + 2] = _sp[2]; }
      uvA.setXY(i, x / TILE, z / TILE);              // world-planar UV → tiles every 8m
      _tn.set(H[gz * N + gx - 1] - H[gz * N + gx + 1], 2 * pitch, H[(gz - 1) * N + gx] - H[(gz + 1) * N + gx]).normalize();
      nrm[i * 3] = _tn.x; nrm[i * 3 + 1] = _tn.y; nrm[i * 3 + 2] = _tn.z;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    if (spl) geo.setAttribute("splat", new THREE.BufferAttribute(spl, 3));
    uvA.needsUpdate = true;
    if (skirt) addSkirt(geo, vAt, seg);
    const mesh = new THREE.Mesh(geo, terrMat);
    mesh.receiveShadow = true;
    return mesh;
  }
  function buildTerrain() {
    if (photo && terrMat.map) patchTerrainPhoto(terrMat, photo); else photo = null;     // the splat attribute only exists with the patched program
    if (LCFX) lcPatch(terrMat, { LC_CLOUD: "", LC_AO: "" });                              // LC-74 cloud shadows + LC-41 contact AO (medium and up)
    terrain = new THREE.Group();
    terrain.name = "terrain";
    const tChunks = [];
    for (let cj = 0; cj < CHUNKS; cj++) for (let ci = 0; ci < CHUNKS; ci++) {
      const farM = buildChunk(ci, cj, FAR_SEG, false);
      terrain.add(farM);
      tChunks.push({ ci, cj, far: farM, near: null });
    }
    g.add(terrain);
    // near-ring LOD swapper: ring follows the camera-focus cell; high-LOD chunks
    // build LAZILY at most one per frame (a 77x77 lattice fill is a fraction of a ms - queued,
    // never a burst), then swap by visibility flips only.
    let _lodCi = -9, _lodCj = -9;
    const _lodQueue = [];
    trackUpdater(() => {
      const f = W._camFocus || W.player;
      if (!f || !f.pos) return;
      const ci = Math.max(0, Math.min(CHUNKS - 1, Math.floor((f.pos.x + SIZE / 2) / CSZ)));
      const cj = Math.max(0, Math.min(CHUNKS - 1, Math.floor((f.pos.z + SIZE / 2) / CSZ)));
      if (ci !== _lodCi || cj !== _lodCj) {
        _lodCi = ci; _lodCj = cj;
        for (const c of tChunks) {
          const ring = Math.abs(c.ci - ci) <= TIER_Q.ring && Math.abs(c.cj - cj) <= TIER_Q.ring;   // (ULTRA: a 5 x 5 near ring, 2.6 m terrain to ~500 m)
          if (ring && !c.near && _lodQueue.indexOf(c) < 0) _lodQueue.push(c);
          const useNear = ring && !!c.near;
          c.far.visible = !useNear;
          if (c.near) c.near.visible = useNear;
        }
      }
      if (_lodQueue.length) {
        const c = _lodQueue.shift();
        c.near = buildChunk(c.ci, c.cj, NEAR_SEG, true);
        terrain.add(c.near);
        const ring = Math.abs(c.ci - _lodCi) <= TIER_Q.ring && Math.abs(c.cj - _lodCj) <= TIER_Q.ring;
        c.near.visible = ring;
        if (ring) c.far.visible = false;
      }
    });
  }

  // ── water ─────────────────────────────────────────────────────────────────
  if (K.water) {
    // P1.10 (SKY lane): the plane was SIZE*1.6 = 2560 m, i.e. its far edge only ~560 m past the island's coast. Full-strength
    // fog hid that, but with the fog thinned at altitude it showed as a hard band against the dome (measured on Deepwood: seam
    // step 2.4x the baseline). SIZE*3.5 = 5600 m puts the edge beyond the camera's 2000 m far plane from anywhere on the map,
    // where even the thinned fog is >= 96% blended, so the horizon is the far-plane clip instead. 2 triangles either way; the
    // ripple repeat below scales with the plane so the tile stays ~28 m.
    const WATER_W = SIZE * 3.5;
    const wgeo = new THREE.PlaneGeometry(WATER_W, WATER_W, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    // roughness 0.13 + metalness 0.3 was two bugs at once. (a) With NoToneMapping
    // (line 276) nothing compresses highlights, and GGX at roughness 0.13 pushes
    // the specular lobe well past 1.0 over a wide angle — everything above 1.0
    // clamps to the same #ffffff, so the sun glint read as a hard-edged flat white
    // patch that crawled as the normal map scrolled. (b) scene.environment is never
    // set anywhere in this game, so the 0.3 metal fraction was subtracted from the
    // diffuse and reflected pure black. 0.30/0.0 keeps a wide sheen under 1.0.
    const wmat = new THREE.MeshStandardMaterial({
      // DoubleSide so the surface also exists as a ceiling seen from BELOW — the
      // camera routinely dips under waterY while swimming, and a single-sided
      // plane simply vanished, which is half of why underwater read as "blank".
      // P4.2 step A (SKY lane): muted teal. Was 0x2ec9d6 / 0x2f7d8a (42% / 30% linear-space desaturation).
      color: mapId === "isla_viva" ? 0x80c2ca : 0x4b7a84, transparent: true, opacity: 0.86,
      roughness: 0.30, metalness: 0.0, side: THREE.DoubleSide,
    });
    wmat.color.multiplyScalar(GRADE.water);                                              // LC-04 (OD-2 G2)
    // LC-39 (P3 half): depth colour + shoreline foam from the baked ground (LCU.uLcHgt): shallow water shows the sand under it, deep water the grade's colour
    if (LCFX) {
      LCU.uLcShallow.value.copy(wmat.color).lerp(new THREE.Color(mapId === "isla_viva" ? 0x9fe0d2 : 0x7fa89a), 0.55);
      LCU.uLcDeep.value.copy(wmat.color).multiplyScalar(mapId === "isla_viva" ? 0.55 : 0.62);
      lcPatch(wmat, { LC_WATER: "" });
    }
    let wN = null;
    try {
      wN = waterNormalTex(aniso);
      wN.repeat.set(90 * WATER_W / (SIZE * 1.6), 90 * WATER_W / (SIZE * 1.6));
      wmat.normalMap = wN; wmat.normalScale = new THREE.Vector2(0.35, 0.35);
    } catch (e) { /* no canvas → flat water */ }
    const water = new THREE.Mesh(wgeo, wmat);
    water.position.y = waterY;
    water.name = "water";
    g.add(water);
    mapWater = water;
    trackUpdater((dt, t) => {
      water.position.y = waterY + Math.sin(t * 0.7) * 0.12;
      if (wN) { wN.offset.x = t * 0.015; wN.offset.y = t * 0.011; }   // drifting ripples
    });
  }

  // ── SKY: gradient dome + baked-texture clouds + looping birds ─────────────
  // (owner: "we should have a real sky, with real clouds, and birds")
  {
    const horizon = new THREE.Color(K.sky);
    // Zenith is AUTHORED per map now (MAPS table) — deriving it as
    // lerp(sky, 0x2f74c8, 0.55) * 0.9 turned Savanna's sand horizon into a grey
    // #9d9dac ceiling. The ramp also had no directional term at all, so the sky
    // gave you no cue where the sun was even though every shadow on the ground
    // pointed at it; the disc + halo below is fragment-only on a 24x16 dome.
    const zenith = new THREE.Color(K.zenith || MAPS.isla_viva.zenith);
    const sp = (K.sun || MAPS.isla_viva.sun).pos;
    const sunDir = new THREE.Vector3(sp[0], sp[1], sp[2]).normalize();

    // ── P1.7 (SKY lane, Wave 4): clouds baked into a tiling texture ───────────
    // The 24 sprite-cloud groups (96 transparent billboards, ~43 draw calls in view)
    // are gone. Clouds are shaded in the dome fragment shader, ported from three's
    // examples/jsm/objects/Sky.js (MIT) — but the fbm is NOT evaluated per pixel: a
    // procedural fbm measured 7.0-12.8 ms full-screen on this iGPU against
    // 0.65-4.4 ms for sampling a baked texture. So the noise is baked ONCE per
    // page session into a 256 px periodic DataTexture (kept in _texCache, so the
    // per-match teardown treats it as shared and never frees it) and the shader
    // samples two scrolling layers of it. Channels: R = cloud shape (4 cells per
    // tile, 5 octaves), G = detail (8 cells, 4 octaves), B = large-scale coverage
    // variation (2 cells, 3 octaves). Every lattice period divides 256 and the
    // lattice indices wrap, so the texture tiles with no seam.
    const bakeCloudNoise = (anisoN) => {
      if (_texCache.skyNoise) return _texCache.skyNoise;
      const N = 256, px = new Uint8Array(N * N * 4);
      const CH = [[4, 5, 101], [8, 4, 577], [2, 3, 933]];          // [cells per tile, octaves, seed]
      const fields = CH.map(([base, oct, seed]) => {
        const f = new Float32Array(N * N);
        let amp = 1, per = base;
        for (let o = 0; o < oct; o++) {
          const lat = new Float32Array(per * per), cell = N / per;
          for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) lat[j * per + i] = _thash(i, j, seed + o * 31);
          for (let y = 0; y < N; y++) {
            const gy = y / cell, j0 = Math.floor(gy), fy = gy - j0, sy = fy * fy * (3 - 2 * fy), r0 = j0 * per, r1 = ((j0 + 1) % per) * per;
            for (let x = 0; x < N; x++) {
              const gx = x / cell, i0 = Math.floor(gx), fx = gx - i0, sx = fx * fx * (3 - 2 * fx), i1 = (i0 + 1) % per;
              const a = lat[r0 + i0], b = lat[r0 + i1], c = lat[r1 + i0], d = lat[r1 + i1];
              f[y * N + x] += ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * amp;
            }
          }
          amp *= 0.5; per *= 2;
        }
        // stretch to the full 0..1 range, then a soft S-curve: fbm of uniform lattice values is a narrow bell, and the
        // shader's coverage threshold needs real contrast to carve cloud edges
        let lo = 1e9, hi = -1e9;
        for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
        const k = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < f.length; i++) { const v = (f[i] - lo) * k; f[i] = v * v * (3 - 2 * v); }
        return f;
      });
      for (let i = 0; i < N * N; i++) {
        px[i * 4] = Math.round(fields[0][i] * 255); px[i * 4 + 1] = Math.round(fields[1][i] * 255);
        px[i * 4 + 2] = Math.round(fields[2][i] * 255); px[i * 4 + 3] = 255;
      }
      const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      t.anisotropy = anisoN || 4;       // the cloud deck is seen at grazing angles; mip blur would erase the streaking
      t.needsUpdate = true;
      _texCache.skyNoise = t;
      return t;
    };
    // Cloud placement is cosmetic but still seeded off the match seed (a separate stream, so the world rng below is untouched).
    const skyRng = W.SIM.mulberry32(seed ^ 0x5c10d5);
    const cloudOff = new THREE.Vector2(skyRng(), skyRng());
    // "low" tier: one cloud layer (a #define, fixed for the whole match, so no mid-match recompile).
    const twoLayers = (W.settings && W.settings.graphics) !== "low";

    // The dome is recentred on the camera every frame but the water plane is
    // SIZE*1.6 wide, so at radius SIZE*0.82 (1312 m) the sphere intersected the
    // waterline in a visible 24-gon — a hard-edged pale polygon floating on the
    // Isla Viva horizon. 1.15 (1840 m) pushes the intersection past anything that
    // reads, and 48x24 kills the faceted gradient banding. Ceiling is the camera's
    // 2000 m far plane: anything at or above SIZE*1.25 gets clipped into a hole in
    // the sky. Do not enlarge the water plane to compensate — at the current fog
    // density water past ~1500 m is fully blended to the dome's own horizon stop.
    const skyGeo = new THREE.SphereGeometry(SIZE * 1.15, 48, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      defines: { CLOUD_LAYERS: twoLayers ? 2 : 1 },
      // THREE.Uniform objects: W.skyUniforms (contract C-SKY) hands out exactly these live objects
      uniforms: {
        top: new THREE.Uniform(zenith), bot: new THREE.Uniform(horizon), sunDir: new THREE.Uniform(sunDir),
        tNoise: new THREE.Uniform(bakeCloudNoise(W._texAniso)), cloudT: new THREE.Uniform(0),
        cloudOff: new THREE.Uniform(cloudOff), cloudCov: new THREE.Uniform(K.cloud != null ? K.cloud : 0.45),
      },
      vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `varying vec3 vp;
        uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir;
        uniform sampler2D tNoise; uniform float cloudT; uniform vec2 cloudOff; uniform float cloudCov;
        void main(){
          vec3 d = normalize(vp);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(bot, top, pow(h, 0.62));
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.94, 0.80) * (pow(s, 1200.0) * 1.6 + pow(s, 10.0) * 0.18);
          if (d.y > 0.0) {
            // flat cloud deck (Sky.js): project the view ray onto a plane; +0.12 keeps the zenith finite and the horizon from exploding
            vec2 uv = d.xz / (d.y + 0.12);
            vec2 uA = uv * 0.50 + cloudOff + cloudT * vec2(0.0035, 0.0014);
            float n = texture2D(tNoise, uA).r;
            float region = texture2D(tNoise, uv * 0.07 + cloudOff * 0.37).b;   // big clearings / overcast patches
            #if CLOUD_LAYERS > 1
              vec2 uB = uv * 1.15 + cloudOff.yx + 0.37 - cloudT * vec2(0.0022, 0.0050);
              n = n * 0.72 + texture2D(tNoise, uB).g * 0.28;                    // second, finer layer drifting the other way
            #endif
            float cov = clamp(cloudCov + (region - 0.5) * 0.55, 0.0, 1.0);
            float th = 1.0 - cov;
            float m = smoothstep(th, th + 0.40, n) * smoothstep(0.0, 0.10, d.y);
            float depth = max(0.0, n - th);
            float beer = exp(-depth * 4.0), powder = 1.0 - beer * beer;
            float shade = mix(0.70, 1.0, clamp(beer * powder * 2.6, 0.0, 1.0));   // darker, denser cores
            vec3 cc = mix(bot, vec3(1.0), 0.80) * shade;
            cc += vec3(1.0, 0.95, 0.85) * clamp(0.51 / pow(1.49 - s * 1.4, 1.5), 0.0, 3.0) * m * (1.0 - m) * 0.35;   // silver lining toward the sun
            cc = mix(cc, bot, pow(1.0 - h, 6.0) * 0.6);                           // haze the deck into the horizon
            float a = (1.0 - exp(-depth * 5.0)) * m;
            col = mix(col, cc, clamp(a * 1.6, 0.0, 0.92));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    // LC-74 cloud shadows + LC-38 wind (the world-shader layer, LCU): the ground reads the SAME baked cloud noise the dome draws, projected along the sun onto a
    // deck ~380 m up and drifting with the wind; the wind's direction is seeded per match (a separate stream: the world rng is untouched). Cloud cover per map
    // sets how much of the ground is under a cloud (Deepwood's 0.72 -> ~40 %, Savanna's 0.54 -> ~25 %); a cloud takes 50 % of the sun.
    {
      const wr = W.SIM.mulberry32(seed ^ 0x77d1a5), wa = wr() * Math.PI * 2;
      LCU.uLcWind.value.set(Math.cos(wa), Math.sin(wa), LCFX ? 1 : 0, 0);
      LCU.uLcCloud.value = skyMat.uniforms.tNoise.value;
      LCU.uLcCloudK.value.set(sunDir.x / Math.max(0.2, sunDir.y), sunDir.z / Math.max(0.2, sunDir.y), 1.02 - (K.cloud != null ? K.cloud : 0.5) * 0.62, LCFX ? 0.5 : 0);
      LCU.uLcCloudOff.value.copy(cloudOff);
    }
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false; sky.name = "sky";
    g.add(sky);
    // Contract C-SKY (SKY -> STORMFX): the live uniform objects + the dome mesh. Cleared again in disposeMapResources.
    W.skyUniforms = { top: skyMat.uniforms.top, bot: skyMat.uniforms.bot };
    W.skyDome = sky;

    // The sprite clouds consumed rng() here (24 groups: 1 + 4 per puff + 4 draws each), BEFORE the towns, props and loot
    // are placed. Deleting them without replacing the draws would reshuffle every seeded world (POIs, loot, bot spawns).
    // Burning the identical number of draws keeps every placement byte-identical to the shipped build.
    for (let i = 0; i < 24; i++) { const puffs = 3 + Math.floor(rng() * 3); for (let k = 0; k < puffs * 4 + 4; k++) rng(); }

    // bird "V" sprite texture + a few looping flocks
    const bcv = document.createElement("canvas"); bcv.width = bcv.height = 32;
    const bx = bcv.getContext("2d"); bx.strokeStyle = "rgba(38,40,52,0.92)"; bx.lineWidth = 3; bx.lineCap = "round";
    bx.beginPath(); bx.moveTo(4, 21); bx.lineTo(16, 11); bx.lineTo(28, 21); bx.stroke();
    const birdTex = new THREE.CanvasTexture(bcv); birdTex.colorSpace = THREE.SRGBColorSpace;
    const birdMat = new THREE.SpriteMaterial({ map: birdTex, transparent: true, depthWrite: false, fog: false });  // ONE shared material for every bird (a SpriteMaterial per bird was 96 program lookups a frame)
    const flocks = [];
    for (let f = 0; f < 3; f++) {
      const flock = new THREE.Group();
      const n = 5 + Math.floor(rng() * 5);
      for (let b = 0; b < n; b++) {
        const s = new THREE.Sprite(birdMat);
        s.scale.setScalar(3 + rng() * 2.5);
        s.userData.ph = rng() * Math.PI * 2; s.userData.ix = b;
        flock.add(s);
      }
      flock.userData = { cx: (rng() - 0.5) * HALF, cz: (rng() - 0.5) * HALF, cy: 120 + rng() * 60, fr: 22 + rng() * 34, spd: 0.05 + rng() * 0.05, ph: rng() * Math.PI * 2 }; // 120-180m: clear of the sky-islands (~52m) and the volcano
      g.add(flock); flocks.push(flock);
    }

    trackUpdater((dt, t) => {
      // keep the sky dome centered on the camera — a skybox should follow the viewer,
      // else it parallaxes as you move and its far shell clips the 2000m far-plane at map corners
      if (W.camera) sky.position.copy(W.camera.position);
      skyMat.uniforms.cloudT.value = t;    // scrolls both baked cloud layers (replaces the sprite drift)
      LCU.uLcT.value = t; LCU.uLcWater.value.y = t;
      LCU.uLcCloudOff.value.set(cloudOff.x + t * 0.0072 * LCU.uLcWind.value.x, cloudOff.y + t * 0.0072 * LCU.uLcWind.value.y);   // ~7 m/s of drift
      for (const fl of flocks) {
        const u = fl.userData, a = t * u.spd + u.ph;
        fl.position.set(u.cx + Math.cos(a) * u.fr * 6, u.cy + Math.sin(a * 0.7) * 7, u.cz + Math.sin(a) * u.fr * 6);
        for (const s of fl.children) s.position.set((s.userData.ix - fl.children.length / 2) * 4.5, Math.sin(t * 6 + s.userData.ph) * 1.6, (s.userData.ix % 2) * 3);
      }
    });

    // ── P1.10 (SKY lane, Wave 4): altitude-scaled fog ───────────────────────────
    // FogExp2.density is a plain uniform, so thinning the haze with camera height needs NO shader recompile (measured: a
    // runtime density change leaves the program count unchanged; forcing a real height-fog shader recompiled 1,501
    // materials). Full density at/below FOG_LO m above the terrain (ground play is unchanged), FOG_MIN of it from FOG_HI m
    // up, smoothstep between: from the plane and the glide the island reads crisply out to the coast instead of a milky haze.
    // Yields to: the menu / lobby (hud.js owns that fog), and player.js underwaterFx while submerged (it owns density then
    // and restores fogSurface.density == K.fog itself on surfacing, which this updater then re-scales).
    const FOG_LO = 40, FOG_HI = 250, FOG_MIN = 0.5;
    trackUpdater(() => {
      const fog = W.scene.fog, cam = W.camera, ph = W.phase;
      if (!fog || !cam || (ph !== "drop" && ph !== "match" && ph !== "over")) return;
      if (W._underwater || W._uw > 0.001) return;
      const ag = cam.position.y - Math.max(heightAt0(cam.position.x, cam.position.z), waterY);   // metres above terrain / water
      const u = ag <= FOG_LO ? 0 : ag >= FOG_HI ? 1 : (ag - FOG_LO) / (FOG_HI - FOG_LO);
      fog.density = K.fog * (1 - (1 - FOG_MIN) * (u * u * (3 - 2 * u)));
    });
  }

  // ── constant texel density ────────────────────────────────────────────────
  // BoxGeometry gives every face UV 0..1 no matter how big the box is, and all
  // boxes of a colour merge into ONE mesh sharing ONE brick/panel texture. So a
  // 0.22m lamp post wore the entire brick pattern crushed onto it while a 24m
  // warehouse wall wore that same pattern stretched across the whole face — the
  // texture read as noise up close and as flat colour at distance. Rescaling UVs
  // by world size gives every surface the same metres-per-tile.
  // Vertex order for a 1-segment box is +X,-X,+Y,-Y,+Z,-Z, 4 verts per face.
  const UV_FACE_SPANS = [[2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1]];   // indices into [w,h,d]
  function scaleBoxUV(geo, w, h, d, tile) {
    const uv = geo.attributes.uv;
    if (!uv || uv.count < 24) return;                    // not a plain 1-segment box
    const dim = [w, h, d];
    for (let f = 0; f < 6; f++) {
      const su = dim[UV_FACE_SPANS[f][0]] / tile, sv = dim[UV_FACE_SPANS[f][1]] / tile;
      for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    uv.needsUpdate = true;
  }
  const STRUCT_TILE = 2.6;    // metres of wall per brick/panel tile
  let structTile = STRUCT_TILE;   // D2: the Savanna city sets this per building (1.9 / 2.6 / 3.6 / 5.0 m: small brick, the default, big panels, render) - one texture, four looks, no extra draw call
  const ROAD_TILE = 6.0;      // asphalt tiles slower — it is a broad flat surface

  // ── structures: batched boxes + colliders ─────────────────────────────────
  const PT = await propTablePromise;    // baked prop collider table (null = legacy fixed-radius prop colliders)
  const colliders = [];             // mkCollider(): {kind:'box'|'ramp', minX..maxZ, dir, prop, idx, hp, dead, _qs}
  const batches = {};               // colorHex -> geometry list
  // WAVE 7: where addBox / addRamp / addFenceBoard put their geometry. The legacy structures (landmarks, huts, props' ramps) go to `batches` - ONE mesh per
  // texture kind for the whole map. Savanna's town and compound buildings go to a sink per DISTRICT (a town, or a 200 m cell of compounds), merged into
  // meshes of their own with their own bounding spheres: three culls a district that is off screen, and the shadow camera (+-55 m around the player)
  // draws only the districts it can see instead of every building of the map. `cap` (set by towerTurn) also collects what a generator just emitted.
  let sink = batches, cap = null;
  const districtSinks = new Map();  // district id -> batch set (insertion order = build order)
  const distParts = new Map();      // Wave 7b (themed maps): compound-cell district id -> [[x, z, r], ...] of its compounds (the shadow test reads them, not the 600 m cell's sphere)
  function useDistrict(id) {
    let sk = districtSinks.get(id);
    if (!sk) districtSinks.set(id, sk = {});
    sink = sk;
  }
  function pushGeo(key, geo) {
    const l = sink[key];
    if (l) l.push(geo); else sink[key] = [geo];
    if (cap) cap.push(geo);
  }
  // LC-52: what a structure collider is MADE of, for surfaceAt (a side table keyed by the collider object: the colliders keep their one hidden class, see
  // mkCollider). From the texture kind the geometry is drawn with: planks / shingles -> wood, metal -> metal, block / plaster -> concrete; the brick / stone
  // grain ("s") by its colour: a warm, saturated tint (the huts' and docks' timber) -> wood, otherwise stone.
  const colSurf = new Map();
  const _tsC = new THREE.Color();
  function surfOfTex(tex, color) {
    if (tex === "plank" || tex === "shingle") return "wood";
    if (tex === "metal") return "metal";
    if (tex === "block" || tex === "stucco") return "concrete";
    try { _tsC.set(color); } catch (e) { return "stone"; }
    const mx = Math.max(_tsC.r, _tsC.g, _tsC.b), mn = Math.min(_tsC.r, _tsC.g, _tsC.b);
    return mx > 0.02 && (mx - mn) / mx > 0.35 && _tsC.r >= _tsC.b ? "wood" : "stone";
  }
  function tagSurf(n0, tex, color) {
    if (n0 >= colliders.length) return;
    const sf = surfOfTex(tex, color);
    for (let i = n0; i < colliders.length; i++) colSurf.set(colliders[i], sf);
  }
  // Axis-aligned colliders for a (possibly yawed) box. A quarter turn is exact. Any other yaw used to become ONE AABB of the rotated box: 8.4 m
  // of invisible wall beside the 18 m shipwreck hull, 1,100-2,500 m2 of phantom collider per match, and the invisible walkable floor beside
  // a rotated pier deck. Contract C-COLL: no OBB narrowphase and no new collider shape, so the box is cut into small AABBs whose union hugs
  // it. The error of an AABB piece against the rotated box is at most its edge / 2 (a 1 m cell turned 45 degrees pokes out 0.5 m), so
  //   * a THIN box (<= 1 m across: walls, planks, log piles) is a chain of <= 1 m segments along its length, same height;
  //   * a WIDE box (the hull, a pier deck) is cut into strips <= 0.5 m deep across the SHORTER of its two extents, each strip as wide as the
  //     box is inside that slice (a strip's error is at most its depth, whatever the angle of the box's edges).
  // What is left over is a staircase of at most ~0.5 m (was up to 8.4 m).
  function boxColliders(cx, cy, cz, w, h, d, rotY) {
    let c = Math.cos(rotY), s = Math.sin(rotY);
    if (Math.abs(s) < 1e-9) s = 0;
    if (Math.abs(c) < 1e-9) c = 0;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    if (s === 0 || c === 0) {
      const hw = (Math.abs(c) * w + Math.abs(s) * d) / 2, hd = (Math.abs(s) * w + Math.abs(c) * d) / 2;
      colliders.push(mkCollider("box", cx - hw, cx + hw, y0, y1, cz - hd, cz + hd, -1, null, -1, 0));
      return;
    }
    if (Math.min(w, d) <= 1.0) {                                           // thin: chain along the long axis
      const longX = w >= d, L = longX ? w : d, n = Math.max(1, Math.ceil(L - 1e-9));
      const sa = L / n / 2, sb = (longX ? d : w) / 2;                                      // segment half-length (along) / half-width (across)
      const ax = Math.abs(c) * (longX ? sa : sb) + Math.abs(s) * (longX ? sb : sa);      // AABB half extents of one segment
      const az = Math.abs(s) * (longX ? sa : sb) + Math.abs(c) * (longX ? sb : sa);
      for (let k = 0; k < n; k++) {
        const u = -L / 2 + (k + 0.5) * (L / n);                                            // offset along the long axis, box-local
        const ox = longX ? u * c : u * s, oz = longX ? -u * s : u * c;                    // rotateY(rotY): x' = x c + z s, z' = -x s + z c
        colliders.push(mkCollider("box", cx + ox - ax, cx + ox + ax, y0, y1, cz + oz - az, cz + oz + az, -1, null, -1, 0));
      }
      return;
    }
    // wide: strips across the shorter AABB extent. Corners of the rotated rectangle:
    const P = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => [cx + lx * c + lz * s, cz - lx * s + lz * c]);
    const ex = (Math.abs(c) * w + Math.abs(s) * d), ez = (Math.abs(s) * w + Math.abs(c) * d);
    const U = ex <= ez ? 0 : 1, V = 1 - U;                                 // U = the slicing axis (0 = x, 1 = z)
    let umin = Infinity, umax = -Infinity;
    for (const q of P) { if (q[U] < umin) umin = q[U]; if (q[U] > umax) umax = q[U]; }
    const n = Math.min(64, Math.max(1, Math.ceil((umax - umin) / 0.5 - 1e-9)));
    const rangeAt = (u, out) => {                                          // [vmin, vmax] of the rectangle on the line U = u
      for (let i = 0; i < 4; i++) {
        const a = P[i], b = P[(i + 1) % 4];
        if (a[U] === b[U]) { if (a[U] === u) { out[0] = Math.min(out[0], a[V], b[V]); out[1] = Math.max(out[1], a[V], b[V]); } continue; }
        if ((a[U] - u) * (b[U] - u) > 0) continue;
        const t = (u - a[U]) / (b[U] - a[U]), v = a[V] + t * (b[V] - a[V]);
        if (v < out[0]) out[0] = v;
        if (v > out[1]) out[1] = v;
      }
    };
    for (let k = 0; k < n; k++) {
      const u0 = umin + (umax - umin) * k / n, u1 = umin + (umax - umin) * (k + 1) / n, r = [Infinity, -Infinity];
      rangeAt(u0, r); rangeAt(u1, r);
      for (const q of P) if (q[U] > u0 && q[U] < u1) { if (q[V] < r[0]) r[0] = q[V]; if (q[V] > r[1]) r[1] = q[V]; }
      if (!(r[1] > r[0])) continue;
      if (U === 0) colliders.push(mkCollider("box", u0, u1, y0, y1, r[0], r[1], -1, null, -1, 0));
      else colliders.push(mkCollider("box", r[0], r[1], y0, y1, u0, u1, -1, null, -1, 0));
    }
  }
  function addBox(cx, cy, cz, w, h, d, color, opts) {
    opts = opts || {};
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, structTile);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, cy, cz);
    // batch key carries the texture KIND (opts.tex: shingle/plank/metal/block;
    // default "s" = the struct brick) — the merge loop below splits it back out
    const bkey = color + "|" + (opts.tex || "s");
    pushGeo(bkey, geo);
    if (opts.collide !== false) { const n0 = colliders.length; boxColliders(cx, cy, cz, w, h, d, opts.rotY || 0); tagSurf(n0, opts.tex || "s", color); }
  }
  // addBox rotates a box about its OWN centre (rotateY then translate on an
  // origin-centred BoxGeometry), so a caller that also wants the box MOVED around
  // an anchor has to rotate the offset itself. house() passed pre-offset WORLD
  // centres, so its rot was applied to the slabs but never to their positions:
  // Palm Bay (town along:"z", rot ±PI/2) came out as a pinwheel of loose
  // intersecting planks under a mismatched roof, and rot=PI — a geometric no-op on
  // a symmetric box — left the door gap on +Z, so every x-aligned town presented a
  // blank wall to its own street on one side. ax/az = anchor, dx/dz = LOCAL offset.
  function addBoxR(ax, az, dx, dz, cy, w, h, d, color, rot, opts) {
    const c = Math.cos(rot), s = Math.sin(rot);   // matches THREE rotateY: x' = x·cos + z·sin, z' = -x·sin + z·cos
    addBox(ax + dx * c + dz * s, cy, az - dx * s + dz * c, w, h, d, color, Object.assign({ rotY: rot }, opts || {}));
  }
  function addRamp(cx, cy, cz, w, h, d, dir, color) {
    // w = width across, d = run length along the travel axis, h = climb.
    // The rendered slab MUST rise the same way supportAt's math does
    // (dir 0=+X, 1=−X, 2=+Z, 3=−Z) — the old version rendered dir 2/3
    // inverted and dir 0/1 flat, so players "walked inside walls" while the
    // (correct) collider carried them.
    const run = Math.sqrt(d * d + h * h);
    const geo = new THREE.BoxGeometry(w, 0.3, run);
    scaleBoxUV(geo, w, 0.3, run, STRUCT_TILE);
    geo.rotateX(-Math.atan2(h, d));              // +Z end rises
    if (dir === 0) geo.rotateY(Math.PI / 2);     // up-end → +X
    else if (dir === 1) geo.rotateY(-Math.PI / 2); // up-end → −X
    else if (dir === 3) geo.rotateY(Math.PI);    // up-end → −Z
    geo.translate(cx, cy + h / 2, cz);
    pushGeo(color + "|s", geo);   // ramps keep the struct grain
    // collider footprint: run axis is X for dir 0/1, Z for dir 2/3
    const hx = (dir === 0 || dir === 1) ? d / 2 : w / 2;
    const hz = (dir === 0 || dir === 1) ? w / 2 : d / 2;
    colliders.push(mkCollider("ramp", cx - hx, cx + hx, cy, cy + h, cz - hz, cz + hz, dir, null, -1, 0));
    tagSurf(colliders.length - 1, "s", color);
  }
  // C-RAMP authoring (Wave 5, lane 5A). A ramp is a 0.3 m sloped slab: walkable from its low edge, 45 degrees at most, and it must meet the
  // thing it climbs to. The old call sites passed the height at the BUILDING CENTRE as the ramp's foot, so on any slope the low edge hung
  // in the air or was buried (start step > 0.55 m on 11 / 22 / 14 ramps of 83 / 222 / 70, up to 5.9 m), 17-39 ramps per map climbed
  // steeper than 45 degrees (a ranger tower: 11.3 m in 6.4 m = 60), and the tops stopped short of the deck or at its face.
  // addRampSnap takes the deck FACE: (faceX, faceZ) = the centre of the edge the ramp climbs onto, `topY` = the surface it lands on, `run` = the
  // preferred length, `dir` = the direction it rises (0 +X, 1 -X, 2 +Z, 3 -Z). It puts the low edge on the lowest ground under the foot (5 points
  // across the width, on the edge and 0.3 m beyond it: lip <= 0.02 m), lengthens the run until the slope is <= 45 degrees (the foot moves out
  // and the ground there is re-read; 4 passes), and runs the high end `o` metres ONTO the deck. `o` is the most the capsule can still walk
  // over: the deck's side face is a wall for a capsule (r 0.45) whose feet are more than STEP_UP (0.55) under the deck top, and at the moment
  // it touches that face the ramp is (o + 0.45) x slope under the top, so o = 0.5 / slope - 0.45, clamped to 0.02 .. 0.3 (walked with the real
  // mover: 0.2 m of overlap on a 43-degree ramp left every ranger-tower leg 0.03 m short of the landing). `opts.o` overrides (0 = the ramp
  // ends exactly at the face, e.g. beside a roof edge it is stepped onto sideways), `opts.keepRun` (inside a building, where the length is
  // fixed) only snaps the foot, `opts.cy` fixes the foot height (a landing slab, a floor), `opts.maxCy` caps it (a ground-floor stair under
  // a slab: its stairwell hole is placed for a ramp that starts at the BUILDING-CENTRE height, and a foot raised 0.9 m above that leaves a
  // climber's head 0.05 m into the slab edge before the hole: walked, the Mill tower stair on a slope stopped 1.8 m short). Returns { cy, rise, run, cx, cz }.
  const RAMP_DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const rectsMeet = (a, b) => !(a[1] <= b[0] || a[0] >= b[1] || a[3] <= b[2] || a[2] >= b[3]);   // two [x0, x1, z0, z1] rectangles overlap
  const rampOverlap = (slope) => Math.min(0.3, Math.max(0.02, 0.5 / Math.max(0.05, slope) - 0.45));
  function addRampSnap(faceX, faceZ, w, topY, run, dir, color, opts) {
    const rp = planRampSnap(faceX, faceZ, w, topY, run, dir, opts);
    addRamp(rp.cx, rp.cy, rp.cz, w, rp.rise, rp.run, dir, color);
    return rp;
  }
  // The ramp addRampSnap would build, without building it (pure: reads the terrain only): { cy, rise, run, cx, cz } (cx, cz = the centre).
  // A caller that must know where a ramp will run BEFORE it lays other things out (the container yard) plans first and adds after.
  function planRampSnap(faceX, faceZ, w, topY, run, dir, opts) {
    opts = opts || {};
    const dx = RAMP_DIR[dir][0], dz = RAMP_DIR[dir][1], px = -dz, pz = dx;
    let r = run, cy = topY - 1;
    for (let pass = 0; pass < 4; pass++) {
      const fx = faceX - dx * r, fz = faceZ - dz * r;
      let g = Infinity;
      for (let k = 0; k < 5; k++) for (const o of [0, 0.3]) g = Math.min(g, heightAt0(fx + px * (k / 4 - 0.5) * w - dx * o, fz + pz * (k / 4 - 0.5) * w - dz * o));
      cy = opts.cy != null ? opts.cy : opts.maxCy != null ? Math.min(g, opts.maxCy) : g;
      const rise = Math.max(0.3, topY - cy);
      if (opts.keepRun || rise <= r + 1e-6) break;               // already <= 45 degrees
      r = rise * 1.02;
    }
    const rise = Math.max(0.3, topY - cy), o = opts.o != null ? opts.o : rampOverlap(rise / r);
    const run2 = r + o, cx = faceX + dx * o - dx * run2 / 2, cz = faceZ + dz * o - dz * run2 / 2;   // the foot stays where it was; the high end moves o past the face
    return { cy, rise, run: run2, cx, cz };
  }
  // The lowest ground under an axis-aligned rectangle (centre + 4 corners), and a vertical post that reaches down to it: legs, stilts and poles
  // were cut at ONE height sampled at the structure's centre, so on a slope the downhill ones hung in the air.
  const gMinRect = (x, z, hx, hz) => Math.min(heightAt0(x, z), heightAt0(x - hx, z - hz), heightAt0(x + hx, z - hz), heightAt0(x - hx, z + hz), heightAt0(x + hx, z + hz));
  function addStilt(x, z, w, top, color, collide) {
    const g0 = gMinRect(x, z, w / 2, w / 2) - 0.06;
    addBox(x, (g0 + top) / 2, z, w, top - g0, w, color, collide ? undefined : { collide: false });
  }
  // A cosmetic board between two world points, standing on the ground at both ends: a box h tall and t thick whose long axis follows the 3D
  // vector a -> b (pitched with the ground, never rolled), no collider. Fences used to be ONE level box per side, 22 m (paddock) to 150 m (farm)
  // long, at the height of its midpoint: floating at one end and buried at the other on any slope (up to 5.7 m of float at the far end).
  const _fbM = new THREE.Matrix4(), _fbU = new THREE.Vector3(), _fbN = new THREE.Vector3(), _fbS = new THREE.Vector3(), _fbUp = new THREE.Vector3(0, 1, 0);
  function addFenceBoard(ax, ay, az, bx, by, bz, h, t, color) {
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    if (L < 1e-3) return;
    _fbU.set((bx - ax) / L, (by - ay) / L, (bz - az) / L);
    _fbN.copy(_fbUp).addScaledVector(_fbU, -_fbU.y).normalize();            // "up", perpendicular to the board's long axis
    _fbS.crossVectors(_fbU, _fbN);
    const geo = new THREE.BoxGeometry(L, h, t);
    scaleBoxUV(geo, L, h, t, STRUCT_TILE);
    geo.applyMatrix4(_fbM.makeBasis(_fbU, _fbN, _fbS));
    geo.translate((ax + bx) / 2 + _fbN.x * h / 2, (ay + by) / 2 + _fbN.y * h / 2, (az + bz) / 2 + _fbN.z * h / 2);
    pushGeo(color + "|s", geo);
  }
  // a fence run in <= 3 m panels, each standing 5 cm into the ground at both of its ends
  function addFence(x0, z0, x1, z1, h, t, color) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3));
    for (let k = 0; k < n; k++) {
      const ax = x0 + (x1 - x0) * k / n, az = z0 + (z1 - z0) * k / n, bx = x0 + (x1 - x0) * (k + 1) / n, bz = z0 + (z1 - z0) * (k + 1) / n;
      addFenceBoard(ax, heightAt0(ax, az) - 0.05, az, bx, heightAt0(bx, bz) - 0.05, bz, h, t, color);
    }
  }

  // A square floor slab MINUS a rectangular stairwell hole (world coords), built
  // as ≤4 border strips so the hole has no geometry AND no collider — the player
  // can climb an interior ramp up through it. Falls back to a full slab if the
  // hole misses the footprint.
  function addSlabHole(cx, cy, cz, size, thick, color, hx0, hx1, hz0, hz1) {
    const x0 = cx - size / 2, x1 = cx + size / 2, z0 = cz - size / 2, z1 = cz + size / 2;
    hx0 = Math.max(x0, hx0); hx1 = Math.min(x1, hx1); hz0 = Math.max(z0, hz0); hz1 = Math.min(z1, hz1);
    if (hx1 <= hx0 || hz1 <= hz0) { addBox(cx, cy, cz, size, thick, size, color); return; }
    if (hx0 > x0) addBox((x0 + hx0) / 2, cy, cz, hx0 - x0, thick, size, color);              // left of hole
    if (hx1 < x1) addBox((hx1 + x1) / 2, cy, cz, x1 - hx1, thick, size, color);              // right of hole
    if (hz0 > z0) addBox((hx0 + hx1) / 2, cy, (z0 + hz0) / 2, hx1 - hx0, thick, hz0 - z0, color); // in front of hole
    if (hz1 < z1) addBox((hx0 + hx1) / 2, cy, (hz1 + z1) / 2, hx1 - hx0, thick, z1 - hz1, color); // behind hole
  }

  const lootPoints = [];
  const chestPoints = [];
  // loot.js clamps anything that would SINK (spawnItem/spawnChest both Math.max
  // against heightAt), but it has no notion of the waterline at all — measured over
  // 300 seeds, 64% of Palm Bay's, 40% of Lakeside Cabins' and 39% of Banana Farm's
  // town chests spawned under the sea. Guarding on the AUTHORED y rather than on the
  // ground under it is deliberate: it drops the submerged town/farm placements while
  // keeping every INTENTIONAL over-water one — pier loot sits at waterY+1.1, the
  // stilt hut's at waterY+0.85/0.95 and the shipwreck's at waterY+0.8 and +3.4.
  // C-PAD: loot authored `heightAt0(x, z) + offset` was authored against the generation-time ground (analytic + the pads registered so far),
  // and the ground players stand on is the baked lattice, up to a few cm different between lattice nodes. lootG/chestG keep the ground each
  // point was authored on; after the bake a point that sat 0-1 m above it (terrain loot) is re-seated by the difference, so a floor item
  // or a chest rests on the ground it will be tested against. Loot on a floor, a roof or a pad is unchanged (its ground did not move).
  const lootG = [], chestG = [];
  function loot(x, y, z, poi) { if (y < waterY + 0.4) return; lootPoints.push({ x, y, z, kind: "floor", poi }); lootG.push(heightAt0(x, z)); }
  function chest(x, y, z, poi) { if (y < waterY + 0.4) return; chestPoints.push({ x, y, z, kind: "chest", poi }); chestG.push(heightAt0(x, z)); }

  // — building generators (shared) —
  function hut(x, z, w, d, rot, color, poi) {
    const ground = heightAt0(x, z);
    // hut() never guarded the waterline, so the Lagoon Docks hut — the only
    // building at that POI — was built on terrain measured at -0.55 to -5.20 m
    // on every seed: floor loot underwater, walls submerged on the deep ones.
    //
    // The first attempt at this simply refused to build under water, which is
    // worse than the bug it replaced: measured over 2000 seeds, Deepwood's
    // Riverside Mill anchor is dry on ZERO of them and Lagoon Docks on 10.8%,
    // so the guard silently deleted a POI's only building — and its floor loot —
    // on essentially every match. A ring-search for dry land does not rescue it
    // either (still underwater on 89.2% of seeds at a 56 m radius) and drags the
    // building away from the dock it belongs to.
    //
    // So build it on STILTS instead: deck at the waterline, posts down to the
    // seabed. The building always exists, its loot is always reachable, and a
    // shack on posts over the water is what a dock should have looked like.
    const submerged = ground < waterY + 0.6;
    // C-PAD: a hut on dry land stands on a level pad under its roof (a stilt hut over water has no pad)
    // The deck of a stilt hut is at the waterline, or at the highest bank under it when part of the footprint is dry land (Riverside Mill's hut:
    // the centre 0.2 m, the door side 1.6 m up a river bank, so the door was 1.2 m clear of the ground - under the capsule). Each leg now reaches
    // the ground under ITSELF.
    let yDeck = waterY + 0.35;
    if (submerged) for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) yDeck = Math.max(yDeck, heightAt0(x - w / 2 + w * i / 4, z - d / 2 + d * j / 4));
    const y = submerged ? yDeck : groundPad(x, z, w / 2 + 0.4, d / 2 + 0.4, { gen: "hut" });
    const T = 0.35;
    if (submerged) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lx = x + sx * (w / 2 - 0.3), lz = z + sz * (d / 2 - 0.3), gl = heightAt0(lx, lz) - 0.3, legH = Math.max(0.6, y - gl);
        addBox(lx, y - legH / 2, lz, 0.32, legH, 0.32, shade(color, 0.7));
      }
      addBox(x, y - 0.12, z, w + 0.5, 0.24, d + 0.5, shade(color, 0.85));   // deck
    }
    const H = 3.2;
    // 4 walls with a door gap on the front and a window band in each side wall.
    // Same aperture as house(): 1.20 m sill (standing eye y+1.62 clears it, crouched
    // eye y+0.97 does not), header from y+2.30, so it is a firing port you cannot
    // step or jump through. NOTE these still use addBox, not addBoxR: hut() has the
    // same rotate-the-offset latency as house() had, but all 6+ call sites pass
    // rot = 0, so it is unexposed and rewriting it would be churn.
    const winW = 1.2, segD = d / 2 - winW / 2, jamb = d / 4 + winW / 4;
    addBox(x, y + H / 2, z - d / 2, w, H, T, color, { rotY: rot });          // back
    for (const sx of [-1, 1]) {
      addBox(x + sx * w / 2, y + H / 2, z - jamb, T, H, segD, color, { rotY: rot });
      addBox(x + sx * w / 2, y + H / 2, z + jamb, T, H, segD, color, { rotY: rot });
      addBox(x + sx * w / 2, y + 0.60, z, T, 1.20, winW, color, { rotY: rot });   // sill
      addBox(x + sx * w / 2, y + 2.75, z, T, 0.90, winW, color, { rotY: rot });   // header (y+2.30..y+3.20)
    }
    const doorW = 1.4;
    addBox(x - w / 4 - doorW / 4, y + H / 2, z + d / 2, w / 2 - doorW / 2, H, T, color, { rotY: rot });
    addBox(x + w / 4 + doorW / 4, y + H / 2, z + d / 2, w / 2 - doorW / 2, H, T, color, { rotY: rot });
    addBox(x, y + H - 0.4, z + d / 2, doorW, 0.8, T, color, { rotY: rot }); // lintel
    addBox(x, y + H + 0.15, z, w + 0.6, 0.3, d + 0.6, shade(color, 0.75));  // roof
    loot(x, y + 0.5, z, poi);
    // A hut has no floor slab: its chest rests on the terrain at ITS OWN spot. Sampling the hut centre hung it 0.70 m over the slope
    // (deepwood seed 1, wild hut near 320, 213). Same two rng draws in the same order, so nothing else in the world moves.
    if (rng() < 0.5) {
      const cx = x + (rng() - 0.5) * w * 0.5, cz = z + (rng() - 0.5) * d * 0.5;
      chest(cx, (submerged ? y : heightAt0(cx, cz)) + 0.6, cz, poi);
    }
  }

  // STAIRWELL HEADROOM (Wave 5 leftovers, lane L2). How far back from a stair's TOP end the hole in the slab above it must begin, measured along the
  // run, so that a capsule going DOWN the stair at a sprint is already under the slab-edge-clear zone when its leading edge reaches the strip beyond
  // the hole. The mover does not snap to a ramp going down (player.js: x/z first, then y by gravity, onGround only when the feet reach the support):
  // on a ramp of slope m = rise / run a capsule at speed v is carried off the surface and falls 0.5 g t^2 while the surface drops m v t, so it
  // flies in arcs up to (m v)^2 / 2 g above the stair (0.6 m walking, 1.05 m sprinting on the 7 m clock-tower stair, m 0.85). Its head (height h)
  // then meets the slab edge although the stair itself had headroom: blockedIn jams the capsule on the strip's face, a human's auto-mantle reads
  // that as a ledge and lifts the player onto the upper floor, and the stair "cannot be walked down" (ashgrid (221.75, 224), all 5 seeds). The
  // old fixed edge (0.10 x run before the middle of the stair) only cleared a stair whose slope is low enough that the arc stays under ~0.3 m.
  // The capsule centre is at most d - r from the top end when its leading edge touches the strip (r = radius), and the stair surface is then
  // m (d - r) under the slab: the head clears the edge when m (d - r) >= h + arc + a 0.1 m margin, i.e. d = (h + arc + 0.1) / m + r. Never nearer
  // the top than the old edge (long gentle stairs keep their hole), and capped by the slab footprint (addSlabHole clamps): a very steep short
  // stair opens its whole run.
  const MV_ = (W.SIM && W.SIM.MOVE) || { sprint: 8, gravity: -22 }, PK_ = (W.SIM && W.SIM.PLAYERK) || { height: 1.8, radius: 0.45 };
  function stairHeadroomRun(rise, run) {
    const m = Math.max(0.05, rise / run), mv = m * MV_.sprint, arc = mv * mv / (2 * Math.abs(MV_.gravity));
    return (PK_.height + arc + 0.10) / m + PK_.radius;
  }

  // `o` (Wave 7, optional): { loot, chest } = the probability of each floor item / of the roof chest and of the ground-floor item (legacy: always).
  function tower(x, z, floors, fw, color, poi, avoid, o) {
    const FH = 4, T = 0.4, W2 = fw / 2;
    const y = groundPad(x, z, W2 + 0.4, W2 + 0.4, { gen: "tower" });     // C-PAD: the whole footprint on one level (towers stood up to 6 m off the ground on slopes)
    let stair = null;       // the interior ramp of the floor below: { rise, run } as BUILT (the ground-floor one is snapped to the terrain: rise >= FH)
    for (let f = 0; f < floors; f++) {
      const fy = y + f * FH;
      // slab (skip ground floor slab). For upper floors, cut a stairwell hole over
      // the interior ramp that climbs from the floor below (built during f-1) —
      // the old full-footprint slab dead-ended that ramp into its underside, so
      // interiors were unreachable and towers were roof-only (via the exterior ramp).
      if (f > 0) {
        const pdir = (f - 1) % 2 ? 3 : 2;                       // ramp below: up-end -Z (3) or +Z (2)
        const rx = x + ((f - 1) % 2 ? -fw / 4 : fw / 4);        // its X offset
        const rrun = fw * 0.7;                                  // its Z run
        // The hole must begin where a climber's HEAD is still below the slab,
        // or blockedHoriz jams the capsule against the hole's near edge and the
        // ramp dead-ends 1.4 m short of the floor above. Worked example (fw 12,
        // rrun 8.4, FH 4): the capsule (r 0.45, h 1.85) reaches the old z+0.2
        // edge at z+0.65, where the ramp has risen only 2.31 m — head at 4.16,
        // slab top at 4.30, overlap -> stuck. Starting the hole at z-0.1*rrun
        // puts the edge where the capsule top is still UNDER the slab (3.66 <
        // 4.00), so you pass beneath the lip and rise through the opening.
        // Going DOWN needs more (the capsule flies in arcs, see stairHeadroomRun): the near edge is the nearer of the old one and that one.
        const nearD = stairHeadroomRun(stair ? stair.rise : FH, stair ? stair.run : rrun);
        let hz0, hz1;
        if (pdir === 2) { hz0 = Math.min(z - rrun * 0.10, z + rrun / 2 - nearD); hz1 = z + rrun * 0.55; }     // up-end at z + rrun/2: the near (foot) side is -Z
        else { hz0 = z - rrun * 0.55; hz1 = Math.max(z + rrun * 0.10, z - rrun / 2 + nearD); }               // up-end at z - rrun/2: the near side is +Z
        addSlabHole(x, fy + 0.15, z, fw, 0.3, shade(color, 0.8), rx - 1.6, rx + 1.6, hz0, hz1);
      }
      // 4 walls with a window band on upper floors + a door gap on the ground floor.
      //
      // The band used to be one wall of height FH-1.2 = 2.80 sitting at fy..fy+2.80,
      // leaving the gap at fy+2.80..fy+4.00. addSlabHole puts the floor SURFACE at
      // fy+0.30, so the standing eyeline is fy+1.92 and the crouched one fy+1.27 —
      // the opening was 0.88 m above the tallest thing that could look through it.
      // No tower interior in the game could be seen or shot out of, and tower() is
      // the only multi-floor generator (12 calls a match). Split into a SILL and a
      // HEADER so the aperture lands on the eyeline instead: fy+1.40..fy+2.50 is
      // 0.52 m below standing eye and 0.13 m above crouched, so crouching behind the
      // sill is real cover. It stays a firing port, not an exit: the 1.10 m sill top
      // is over STEP_UP (0.55) so you cannot step out, and at the 1.38 m jump apex
      // the capsule spans fy+1.68..fy+3.48, which overlaps the header (minY fy+2.50)
      // so blockedHoriz still stops you.
      const SILL_H = 1.40, SILL_Y = fy + 0.70;      // spans fy+0.00..fy+1.40
      const HEAD_H = 1.50, HEAD_Y = fy + 3.25;      // spans fy+2.50..fy+4.00
      const WT = { tex: (o && o.wallTex) || "block" };                 // (Wave 7b stage B: a themed tower wears its theme's walls - stucco on the resort, planks in the lodge village - not the brick "block")
      if (f === 0) {
        const dw = 1.8;
        addBox(x - W2 / 2 - dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color, WT);
        addBox(x + W2 / 2 + dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color, WT);
        addBox(x, fy + FH - 0.5, z + W2, dw, 1, T, color, WT);
        addBox(x, fy + FH / 2, z - W2, fw, FH, T, color, WT);
        addBox(x - W2, fy + FH / 2, z, T, FH, fw, color, WT);
        addBox(x + W2, fy + FH / 2, z, T, FH, fw, color, WT);
      } else {
        addBox(x, SILL_Y, z + W2, fw, SILL_H, T, color, WT); addBox(x, HEAD_Y, z + W2, fw, HEAD_H, T, color, WT);
        addBox(x, SILL_Y, z - W2, fw, SILL_H, T, color, WT); addBox(x, HEAD_Y, z - W2, fw, HEAD_H, T, color, WT);
        addBox(x - W2, SILL_Y, z, T, SILL_H, fw, color, WT); addBox(x - W2, HEAD_Y, z, T, HEAD_H, fw, color, WT);
        addBox(x + W2, SILL_Y, z, T, SILL_H, fw, color, WT); addBox(x + W2, HEAD_Y, z, T, HEAD_H, fw, color, WT);
        if (o && o.balcony) {                                            // (stage B) a balcony along the front of every upper floor: a 0.2 m slab 1.3 m deep, a 1.0 m rail; exact colliders
          const bw = fw * 0.7, bz = z + W2 + T / 2, rc = o.balcony;
          addBox(x, fy + 0.1, bz + 0.65, bw, 0.2, 1.3, shade(color, 0.85), WT);
          addBox(x, fy + 0.7, bz + 1.25, bw, 1.0, 0.1, rc);
          addBox(x - bw / 2 + 0.05, fy + 0.7, bz + 0.65, 0.1, 1.0, 1.2, rc); addBox(x + bw / 2 - 0.05, fy + 0.7, bz + 0.65, 0.1, 1.0, 1.2, rc);
        }
        // Wave 7 (`o.mullion` = a colour): thin window posts between sill and header, so the open band reads as a row of windows from the street. Cosmetic: no collider
        // (the band stays the firing port it always was), and each post touches the sill below and the header above.
        if (o && o.mullion) {
          const nm = Math.max(2, Math.round(fw / 2.6)), MY = fy + (SILL_H + (FH - HEAD_H)) / 2, MH = FH - HEAD_H - SILL_H;
          for (let k = 1; k < nm; k++) {
            const u = -fw / 2 + fw * k / nm;
            addBox(x + u, MY, z + W2, 0.28, MH, 0.3, o.mullion, { collide: false }); addBox(x + u, MY, z - W2, 0.28, MH, 0.3, o.mullion, { collide: false });
            addBox(x + W2, MY, z + u, 0.3, MH, 0.28, o.mullion, { collide: false }); addBox(x - W2, MY, z + u, 0.3, MH, 0.28, o.mullion, { collide: false });
          }
        }
      }
      // interior ramp to next floor
      if (f < floors - 1) {
        // (the ground-floor ramp's foot is snapped to the terrain it starts on; the upper ones start on a slab, unchanged)
        const rx2 = x + (f % 2 ? -fw / 4 : fw / 4), rdir = f % 2 ? 3 : 2, rrun2 = fw * 0.7;
        if (f === 0) { const rp = addRampSnap(rx2, z + (rdir === 2 ? rrun2 / 2 : -rrun2 / 2), 2.2, fy + FH, rrun2, rdir, shade(color, 0.7), { keepRun: true, o: 0, maxCy: fy }); stair = { rise: rp.rise, run: rp.run }; }
        else { addRamp(rx2, fy, z, 2.2, FH, rrun2, rdir, shade(color, 0.7)); stair = { rise: FH, run: rrun2 }; }
      }
      if (!(o && o.loot != null) || rng() < o.loot) loot(x + (rng() - 0.5) * fw * 0.5, fy + 0.5, z + (rng() - 0.5) * fw * 0.5, poi);
    }
    addBox(x, y + floors * FH + 0.15, z, fw, 0.3, fw, shade(color, 0.65)); // roof slab
    const PC = (o && o.parapetC) || shade(color, 0.6);
    addBox(x, y + floors * FH + 0.7, z + fw / 2 - 0.2, fw, 1.1, 0.35, PC); // parapet
    addBox(x, y + floors * FH + 0.7, z - fw / 2 + 0.2, fw, 1.1, 0.35, PC);
    if (!(o && o.chest != null) || rng() < o.chest) chest(x, y + floors * FH + 0.6, z, poi);   // roof chest
    if (!(o && o.loot != null) || rng() < o.loot) loot(x, y + 0.5, z, poi);
    // exterior ramp along the +X wall up to the roof — rooftop chests must be
    // reachable on foot (playtest: "are there ramps to get up there?"); ends
    // short of the parapet so you can step sideways onto the slab
    // (foot on the terrain it starts on; lengthened until it climbs <= 45 degrees: a 3-storey tower was 12.45 m in 9.4 m = 53)
    // `avoid` ([x0, x1, z0, z1] rectangles, optional): the ramp keeps this +X side unless its corridor (the plank, 0.5 m either side, 0.6 m beyond the
    // foot) meets one of them (the Cliff Temples keep stands among five random stone cubes whose caps overhang a 12.5 m plank: isla_viva seed 12 could
    // not be climbed to the roof); it then tries the -X wall, then both walls rising the other way. No random draw, so nothing else moves.
    {
      const topY = y + floors * FH + 0.45, run0 = fw - 1.6;
      let pick = null;
      for (const [sx, dir] of [[1, 2], [-1, 2], [1, 3], [-1, 3]]) {
        const rp = planRampSnap(x + sx * (W2 + 1.15), dir === 2 ? z + fw / 2 - 1.6 : z - fw / 2 + 1.6, 2.2, topY, run0, dir, { o: 0 });
        if (!pick) pick = { dir, rp };                                                    // the original +X ramp is the fallback
        let clear = true;
        if (avoid && avoid.length) {
          const corr = [rp.cx - 1.6, rp.cx + 1.6, rp.cz - rp.run / 2 - (dir === 2 ? 0.6 : 0), rp.cz + rp.run / 2 + (dir === 3 ? 0.6 : 0)];
          for (const r of avoid) if (rectsMeet(corr, r)) { clear = false; break; }
        }
        if (clear) { pick = { dir, rp }; break; }
      }
      addRamp(pick.rp.cx, pick.rp.cy, pick.rp.cz, 2.2, pick.rp.rise, pick.rp.run, pick.dir, shade(color, 0.72));
    }
    return y;
  }

  // A tower turned by a quarter turn (turn 0..3: its door, +Z, then faces +Z, +X, -Z, -X like house() with rot = turn * PI/2). tower() has no rotation of its own, and
  // threading one through its ~60 boxes, 4 stair ramps and slab holes would touch every line; instead it builds in its own frame and what it emitted is turned about
  // its centre afterwards: the geometry by an exact matrix, every collider as an exact box (a ramp's direction is remapped), every loot point. While it builds, the
  // ground it reads (the stair feet, the exterior ramp's foot, loot heights) is the ground under the place each piece will END UP, so the ramps still start on the
  // dirt they will stand on. Frames in the stack stay `tower` / `addBox` (the placement gates read the generator's name off the call stack).
  const _RAMP_TURN = [[0, 1, 2, 3], [3, 2, 0, 1], [1, 0, 3, 2], [2, 3, 1, 0]];     // dir 0 +X, 1 -X, 2 +Z, 3 -Z  ->  the direction after the turn
  const _qM = new THREE.Matrix4();
  function towerTurn(x, z, floors, fw, color, poi, turn, o) {
    turn = ((turn % 4) + 4) % 4;
    if (!turn) return tower(x, z, floors, fw, color, poi, undefined, o);
    const c = [1, 0, -1, 0][turn], s = [0, 1, 0, -1][turn];
    const nc = colliders.length, nl = lootPoints.length, nk = chestPoints.length, real = heightAt0, prevCap = cap, mine = [];
    cap = mine;
    heightAt0 = (px, pz) => real(x + (px - x) * c + (pz - z) * s, z - (px - x) * s + (pz - z) * c);
    let y;
    try { y = tower(x, z, floors, fw, color, poi, undefined, o); } finally { heightAt0 = real; cap = prevCap; }
    _qM.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
    for (const geo of mine) { geo.translate(-x, 0, -z); geo.applyMatrix4(_qM); geo.translate(x, 0, z); }
    if (prevCap) for (const geo of mine) prevCap.push(geo);
    const rot = (px, pz) => [x + (px - x) * c + (pz - z) * s, z - (px - x) * s + (pz - z) * c];
    for (let i = nc; i < colliders.length; i++) {
      const q = colliders[i], a = rot(q.minX, q.minZ), b = rot(q.maxX, q.maxZ);
      q.minX = Math.min(a[0], b[0]); q.maxX = Math.max(a[0], b[0]); q.minZ = Math.min(a[1], b[1]); q.maxZ = Math.max(a[1], b[1]);
      if (q.kind === "ramp") q.dir = _RAMP_TURN[turn][q.dir];
    }
    for (let i = nl; i < lootPoints.length; i++) { const q = lootPoints[i], a = rot(q.x, q.z); q.x = a[0]; q.z = a[1]; }
    for (let i = nk; i < chestPoints.length; i++) { const q = chestPoints[i], a = rot(q.x, q.z); q.x = a[0]; q.z = a[1]; }
    return y;
  }

  function rangerTower(x, z, color, poi) {
    const H = 11, P = 3.4;
    const y = groundPad(x, z, 2.1, 2.1, { gen: "rangerTower" });         // C-PAD: the four legs (+-1.4 m) on one level; every leg still reaches the ground under itself
    // each 11 m leg reaches the ground under ITSELF (all four were cut at the centre height: a leg in the air on 21-28% of the towers)
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]])
      addStilt(x + dx, z + dz, 0.4, y + H, color, true);
    addBox(x, y + H + 0.15, z, P + 1.4, 0.3, P + 1.4, shade(color, 0.85));    // deck
    // The +Z rail is split into two 1.6 m stubs to leave a gateway where the ramp
    // arrives. It used to be one solid 4.8 m rail across all four sides: the ramp
    // top ended at z+3.6 while the deck edge is z+2.4, so you climbed 11 m, hit a
    // 1.15 m gap of air and then a 1.2 m wall. STEP_UP is 0.55 (player.js) and the
    // jump apex is 1.38 m, so the deck chest on all three Deepwood towers was
    // unreachable on foot. (The access is now a switchback that arrives on that gateway, see below.)
    for (const [dx, dz, w, d] of [[0, -(P + 1.2) / 2, P + 1.4, 0.3], [-(P + 1.4) / 2 + 0.8, (P + 1.2) / 2, 1.6, 0.3], [(P + 1.4) / 2 - 0.8, (P + 1.2) / 2, 1.6, 0.3], [-(P + 1.2) / 2, 0, 0.3, P + 1.4], [(P + 1.2) / 2, 0, 0.3, P + 1.4]])
      addBox(x + dx, y + H + 0.9, z + dz, w, 1.2, d, color);
    addBox(x, y + H + 2.6, z, P + 2, 0.25, P + 2, shade(color, 0.7), { collide: false }); // little roof
    // ...which floated 0.97 m above the rails on nothing: four corner posts carry it from the deck to its underside (y+H+2.475)
    for (const [dx, dz] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) addBox(x + dx, y + H + 1.4, z + dz, 0.25, 2.2, 0.25, shade(color, 0.9), { collide: false });
    // ACCESS: a two-leg switchback. The single ramp climbed 11.3 m in 6.4 m (60 degrees); C-RAMP walks 45 at most. Lower leg: foot beside
    // the tower, rising AWAY from it (+Z) to a landing at half the climb; upper leg: from the landing back toward the tower, on the
    // gateway lane, onto the deck. Legs are 1.6 m wide (the gateway), side by side with a 0.2 m slot between; the landing is 3.8 x 3.1 m.
    {
      const deckTop = y + H + 0.3, LW = 1.6, xU = x, xL = x + 1.8, zFoot = z + 2.9;
      let g = Infinity;
      for (let k = 0; k < 5; k++) for (const o of [0, 0.3]) g = Math.min(g, heightAt0(xL + (k / 4 - 0.5) * LW, zFoot - o));
      const landing = g + (deckTop - g) / 2;                                    // landing surface: half the climb above the lower foot
      const runL = Math.max(6.0, (landing - g) * 1.03), zTop = zFoot + runL;    // 6 m on level ground; longer when the foot is downhill (<= 45 degrees)
      const oL = rampOverlap((landing - g) / runL);
      addRamp(xL, g, zFoot + (runL + oL) / 2, LW, landing - g, runL + oL, 2, shade(color, 0.8));   // lower leg, rises toward +Z, ends oL onto the landing
      addBox(x + 0.9, landing - 0.15, zTop + 1.55, 3.8, 0.3, 3.1, shade(color, 0.85));      // landing slab: z = zTop .. zTop+3.1, its top = the legs' ends
      for (const px of [x - 0.85, x + 2.65]) addStilt(px, zTop + 2.9, 0.3, landing - 0.3, color, true);   // landing posts (far corners)
      const zLow = zTop + 1.5, zFace = z + 2.4;                                                 // upper leg: low edge on the landing, high end onto the deck's +Z edge
      const rU = zLow - zFace, oU = rampOverlap((deckTop - landing) / rU);
      addRamp(xU, landing, (zLow + zFace - oU) / 2, LW, deckTop - landing, rU + oU, 3, shade(color, 0.8));  // rises toward -Z
    }
    chest(x, y + H + 0.6, z, poi);
  }

  function pier(x, z, len, rot, color, poi) {
    const y = waterY + 0.5;
    addBox(x, y, z, 3, 0.3, len, color, { rotY: rot, tex: "plank" });   // a dock reads as boards, not brick
    // piles: the deck hovered 0.35 m over the water on nothing at all. A pair every ~4.5 m, from the seabed (or the shore) up into the deck's
    // underside; cosmetic like the deck's other trim (a swimmer clipping a 0.3 m pile is not worth a collider)
    {
      const c = Math.cos(rot), sn = Math.sin(rot);
      const n = Math.max(2, Math.round(len / 4.5) + 1);
      for (let k = 0; k < n; k++) for (const lat of [-1.35, 1.35]) {
        const u = -len / 2 + 0.6 + k * (len - 1.2) / (n - 1);                  // along the deck, box-local; rotateY(rot): x' = x c + z s, z' = -x s + z c
        const px = x + lat * c + u * sn, pz = z - lat * sn + u * c, bot = heightAt0(px, pz) - 0.3, top = y - 0.1;
        if (top - bot > 0.3) addBox(px, (bot + top) / 2, pz, 0.3, top - bot, 0.3, shade(color, 0.7), { collide: false });
      }
    }
    loot(x, y + 0.6, z, poi);
    // (Wave 7b, a map with a city layout: the deck may be turned, and the chest goes on its centreline - at z + 0.35 len it fell off the edge of a deck turned 0.3 rad)
    if (rng() < 0.6) { if (city && rot) chest(x + len * 0.35 * Math.sin(rot), y + 0.6, z + len * 0.35 * Math.cos(rot), poi); else chest(x, y + 0.6, z + len * 0.35, poi); }
  }

  // ── per-map POIs + props plan (props = pure scenery + cover collision) ────
  const pois = [];
  const landmarks = [];             // {x,z,r} unnamed inter-POI structures — trees keep clear
  const lampPts = [];               // {x,y,z} emissive lamp heads — the near-lamp light pool follows these
  const props = { palm: [], tree: [], pine: [], birch: [], bush: [], rocks: [], car: [], container: [], barrel: [] };
  let yardInfo = null;               // ashgrid's container yard: what the ramp-corridor pass dropped (see the yard block)

  // ── prop grounding (Wave 5, lane 5A) ──────────────────────────────────────────────────────────────────────────────
  // Every placed prop is {x, y, z, s, ry} where (x, z) is its ANCHOR: the spot the seeded generator picked, the one nearPoi() tested and
  // the one its collider belongs to. Its y was the ground at that single point, so a prop on a slope hung in the air on the downhill side
  // (palms 11-16%, bushes 12-18%, cars 18-63%, containers 89% of instances had a base vertex more than 10 cm above the drawn ground).
  // finalizeProps() runs ONCE after all placement and
  //   1. drops a `rej` entry whose ground is steeper than its kind tolerates (Unreal's foliage "Ground Slope Angle"). The seeded draws
  //      (x, z, s, ry) already happened, so the shared map RNG stream is untouched and every client drops the same entries;
  //   2. sets y = (lowest ground under the baked base-contact points) - embed: nothing floats, and the high side sinks a few cm (Unreal's
  //      foliage "Z Offset"). Trees 0.12 m, bushes and rocks 0.15 m (the near-ring triangles can sit 0.17 m under heightAt on a steep curve: one bush in 7,000 measured 0.27 m up at 0.10), hard props 0.05 m;
  //   3. for cars (8 degrees) and rock clusters (35) fits a plane through those points and tilts the mesh to it, about the
  //      anchor. The colliders stay axis-aligned boxes (contract C-COLL), each spanning the lowest and highest point of its part.
  // Everything is a pure function of (kind, x, z, s, ry) and the baked table.
  const PROP_EMBED = { palm: 0.12, tree: 0.12, pine: 0.12, birch: 0.12, bush: 0.15, rocks: 0.15, car: 0.05, container: 0.05, barrel: 0.05 };
  const PROP_SLOPE_MAX = { palm: 40, tree: 35, pine: 42, birch: 35, bush: 50, rocks: 55, car: 14, barrel: 22 };   // degrees
  // Max tilt to the ground plane, degrees. Cars are rigid and upright: 8. CONTAINERS ARE LEVEL (no entry): a container's collider is an axis-aligned
  // box, and a container leaned up to 8 degrees onto a slope has its walls 0.14 m off vertical per metre of height, so at body height the drawn
  // wall stuck out of the level box (collisioncheck: clip p95 0.152 m, 6 of 64 sprints ended inside the drawn mesh). A level container rests on
  // the LOWEST ground under its base (settleProp: y = lowest contact point - embed) and the uphill end sinks into the slope, which is what a
  // container set on a graded yard looks like and what the box can honour exactly (collider top = drawn top, every wall vertical).
  // A rock cluster laid flat on a hillside buries its
  // uphill rocks (at 25 degrees the whole cluster vanished into the slope), so it follows the slope up to 35 degrees like boulders do.
  const PROP_TILT_DEG = { car: 8, rocks: 35 };
  const _sx = new Float64Array(64), _sz = new Float64Array(64), _sg = new Float64Array(64);
  function groundSlopeDeg(x, z) {
    const e = 1.5, gx = (heightAt0(x + e, z) - heightAt0(x - e, z)) / (2 * e), gz = (heightAt0(x, z + e) - heightAt0(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
  }
  function settleProp(kind, it) {
    if (it.set) return;
    it.set = true;
    const tk = PT && PT.kinds[kind];
    if (!tk) { it.y = heightAt0(it.x, it.z); return; }          // legacy: ground at the anchor
    const ry = it.ry || 0, c = Math.cos(ry), sn = Math.sin(ry), sc = it.s, B = tk.base, n = B.length;
    const vx = _sx, vz = _sz, g = _sg;                                       // shared scratch (n <= 36): no allocation per placed prop
    for (let i = 0; i < n; i++) {
      const u = B[i][0] * sc, w = B[i][1] * sc;
      vx[i] = u * c + w * sn; vz[i] = -u * sn + w * c;                       // rotateY(ry): x' = x c + z s, z' = -x s + z c
      g[i] = heightAt0(it.x + vx[i], it.z + vz[i]);
    }
    let gx = 0, gz = 0;
    const tiltDeg = PROP_TILT_DEG[kind];
    if (tiltDeg && !it.flat) {
      // least-squares plane  g = a + gx*vx + gz*vz  through the contact points (3x3 normal equations, Cramer); collinear points -> no tilt
      let sx = 0, sz = 0, sxx = 0, sxz = 0, szz = 0, sg = 0, sxg = 0, szg = 0;
      for (let i = 0; i < n; i++) { sx += vx[i]; sz += vz[i]; sxx += vx[i] * vx[i]; sxz += vx[i] * vz[i]; szz += vz[i] * vz[i]; sg += g[i]; sxg += vx[i] * g[i]; szg += vz[i] * g[i]; }
      const det3 = (a, b, cc, d, e, f, gg, h, i2) => a * (e * i2 - f * h) - b * (d * i2 - f * gg) + cc * (d * h - e * gg);
      const D = det3(n, sx, sz, sx, sxx, sxz, sz, sxz, szz);
      if (Math.abs(D) > 1e-6) {
        gx = det3(n, sg, sz, sx, sxg, sxz, sz, szg, szz) / D;
        gz = det3(n, sx, sg, sx, sxx, sxg, sz, sxz, szg) / D;
        const mag = Math.hypot(gx, gz), cap = Math.tan(tiltDeg * Math.PI / 180);
        if (mag > cap) { gx *= cap / mag; gz *= cap / mag; }
      }
    }
    let y0 = Infinity;
    for (let i = 0; i < n; i++) {
      const dy = gx * vx[i] + gz * vz[i];                                      // height of this base point above the instance origin once tilted
      if (g[i] - dy < y0) y0 = g[i] - dy;
    }
    it.y = y0 - (PROP_EMBED[kind] || 0.1);
    if (kind === "container" && it.flat && it.reliefMax === undefined && !it.onTop && city) {
      // WAVE 7 (7A2): a yard STACK BASE stays whatever the slope (it carries its upper container, ramp and loot) and sat on the lowest corner, so its uphill end sank by the whole relief
      // (one base of 41 sank 1.19 m on a slope: placementcheck props-sunk 2.4 % > 2 %). It now rides up to 0.3 m higher, so the uphill end sinks <= ~0.9 m and the low end floats <= 0.2 m.
      let hi = -Infinity;
      for (let i = 0; i < n; i++) { const t = g[i] - (gx * vx[i] + gz * vz[i]); if (t > hi) hi = t; }
      it.y += Math.min(0.2, Math.max(0, hi - y0 + (PROP_EMBED[kind] || 0.1) - 0.85));       // (D2: 0.2, was 0.3: the low end of one base floated 0.254 m on a seed of the Wave-7 completion round, over the 0.25 m bar; the uphill end now sinks up to ~1.0 m on the steepest base)
    }
    it.tx = gx; it.tz = gz;                                                    // the ground plane's slope (0 = untilted); the instance matrix and the collider boxes both read it
  }
  // How much the ground rises under a prop's base contact points (highest minus lowest). A LEVEL prop (containers) sits on the lowest point, so
  // this is how deep its uphill end sinks (plus the embed): finalizeProps drops an entry that asks for a `reliefMax` smaller than this.
  function groundRelief(kind, it) {
    const tk = PT && PT.kinds[kind];
    if (!tk) return 0;
    const ry = it.ry || 0, c = Math.cos(ry), sn = Math.sin(ry), sc = it.s, B = tk.base;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < B.length; i++) {
      const u = B[i][0] * sc, w = B[i][1] * sc, g = heightAt0(it.x + u * c + w * sn, it.z - u * sn + w * c);
      if (g < lo) lo = g; if (g > hi) hi = g;
    }
    return hi - lo;
  }
  function finalizeProps() {
    const stats = {};
    for (const kind in props) {
      const list = props[kind];
      if (!list.length) continue;
      const lim = PROP_SLOPE_MAX[kind], keep = [];
      for (const it of list) { if (it.drop || (it.rej && lim != null && groundSlopeDeg(it.x, it.z) > lim) || (it.reliefMax != null && groundRelief(kind, it) > it.reliefMax)) continue; keep.push(it); }
      props[kind] = keep;
      for (const it of keep) settleProp(kind, it);
      stats[kind] = { generated: list.length, rejected: list.length - keep.length };
    }
    return stats;
  }
  // Scatter is STRATIFIED (grid-jittered), not uniform-random: `g` is a grid
  // dimension, not an attempt count. Uniform placement left huge holes — measured
  // on Ashgrid seed 1234, mean distance from open ground to the nearest solid-collider
  // prop was 48 m with 56% of open ground more than 40 m from any cover. Stratifying
  // bounds the worst case (one candidate per cell) and measures 23 m / 8% at the grid
  // dims the call sites now pass. Deliberately NOT clustered: replicating the
  // generator with the audit's "40-60 cluster seeds of 6-12 props" measured 143 m and
  // 88% — 3x WORSE — because ~42 clusters over 2.56 km² sit ~247 m apart, not the
  // 40 m the recommendation assumed.
  function scatterTrees(kind, g, minH, maxH) {
    const EX = HALF - 40, step = (EX * 2) / g;
    for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
      const x = -EX + (i + rng()) * step, z = -EX + (j + rng()) * step;
      const h = baseH(x, z);
      if (h < minH || h > maxH) continue;
      if (nearPoi(x, z, 26) || nearLandmark(x, z) || inCity(x, z, 6)) continue;
      const s = 0.8 + rng() * 0.9;
      // `rej`: this entry may be dropped on a slope too steep for the kind (finalizeProps). Both draws above happen first, and the
      // rejection happens after ALL placement, so the shared map RNG stream is exactly what it was.
      props[kind].push({ x, y: h, z, s, ry: rng() * Math.PI * 2, rej: 1 });
    }
  }
  function nearPoi(x, z, pad) {
    for (const p of pois) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + pad) return true; }
    return false;
  }
  function nearLandmark(x, z) {
    for (const l of landmarks) { if (Math.hypot(x - l.x, z - l.z) < l.r) return true; }
    return false;
  }
  function poi(id, name, x, z, r) { pois.push({ id, name, x, z, r }); }
  // The POI table is HARDCODED but the terrain is seeded, so most of Isla Viva's
  // named landing zones sit under water on most seeds — measured across 8 seeds,
  // Palm Bay's centre ground ranges -3.8..+0.9 m and Cliff Temples' -2.4..+2.0 m.
  // Consequence measured over 40 seeds: Palm Bay built 13% of its 8 houses and
  // Jungle Market 23%, and the Cliff Temples keep built on 2 of 8 seeds. Snapping
  // the centre to the nearest mostly-dry lot takes those to 69% / 63% / 8-of-8 at a
  // mean move of 78-88 m. Deterministic (no Math.random) — the map must stay
  // seed-reproducible because every multiplayer client rebuilds it from W.seed.
  function dryFrac(cx, cz, R, minH) {
    let k = 0, n = 0;
    for (let ring = 1; ring <= 3; ring++) for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + ring * 0.4, rr = R * ring / 3;
      if (baseH(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) > minH) k++;
      n++;
    }
    if (baseH(cx, cz) > minH) k++;
    n++;
    return k / n;
  }
  function snapPoiToLand(p, minH) {
    const R = p.r * 0.6;
    if (dryFrac(p.x, p.z, R, minH) >= 0.6) return;
    for (let ring = 20; ring <= 260; ring += 20) for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + ring * 0.11;
      const cx = p.x + Math.cos(a) * ring, cz = p.z + Math.sin(a) * ring;
      if (dryFrac(cx, cz, R, minH) >= 0.6) { p.x = cx; p.z = cz; return; }
    }
  }

  // ── roads + towns (Final-Drop density) ────────────────────────────────────
  // Roads are COSMETIC flat ribbons laid on the terrain (no collider — you walk
  // over them). Towns place houses in lots along a street with front doors to the
  // road + a coloured roof, replacing the old "identical huts at random offsets".
  //
  // WAVE 6 (lane 6A, C-PAD): a road is two things now. road() registers a CORRIDOR in the ground field (the cross-slope is flattened across
  // the width and the centreline follows a smoothed profile of the natural ground, so the ribbon has no berm or gully to float over or
  // poke through - 16 % of Savanna's road triangles floated more than 10 cm over the drawn ground), and queues the ribbon. The ribbons
  // are BUILT after the bake (emitRoads), their vertices on the same triangle-exact ground the player stands on. Only the DRY sections are
  // kept: a street used to run into the sea (Jungle Market's was partly under water in 99.5 % of seeds); a section whose smoothed
  // centreline is below waterY + 0.35 is dropped, and a stub shorter than 8 m with it.
  // LC-52: the paved / laid ground of the map as a 1 m raster (2.56 MB, freed with the map): 0 = bare terrain (surfaceAt reads the biome zones), else what was
  // DRAWN there - the road ribbons and parking lots (asphalt), the towns' sidewalks / plazas / parcels (paving), the compounds' yards and crop fields (earth),
  // a park lot (grass). Painted by the code that lays each of them, so the footstep under a player is the surface under them, never a neighbour's.
  const SG_CONCRETE = 1, SG_DIRT = 2, SG_GRASS = 3, SG_NAMES = [null, "concrete", "dirt", "grass"];
  const SGN = SIZE, surfG = new Uint8Array(SGN * SGN);
  function surfRect(x0, z0, x1, z1, code) {
    const i0 = Math.max(0, Math.floor(x0 + HALF)), i1 = Math.min(SGN - 1, Math.floor(x1 + HALF)), j0 = Math.max(0, Math.floor(z0 + HALF)), j1 = Math.min(SGN - 1, Math.floor(z1 + HALF));
    for (let j = j0; j <= j1; j++) { const o = j * SGN; for (let i = i0; i <= i1; i++) surfG[o + i] = code; }
  }
  function surfSeg(x0, z0, x1, z1, width, code) {
    const hw = width / 2, dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
    const i0 = Math.max(0, Math.floor(Math.min(x0, x1) - hw + HALF)), i1 = Math.min(SGN - 1, Math.floor(Math.max(x0, x1) + hw + HALF));
    const j0 = Math.max(0, Math.floor(Math.min(z0, z1) - hw + HALF)), j1 = Math.min(SGN - 1, Math.floor(Math.max(z0, z1) + hw + HALF));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i + 0.5 - HALF - x0, pz = j + 0.5 - HALF - z0, t = Math.max(0, Math.min(1, (px * dx + pz * dz) / L2));
      const ex = px - dx * t, ez = pz - dz * t;
      if (ex * ex + ez * ez <= hw * hw) surfG[j * SGN + i] = code;
    }
  }
  const _sgC = new THREE.Color();
  /** a town ground decal's surface by its tint: greys = paving, a green = lawn, any other saturated tint = packed earth / a field */
  function surfOfHex(hex) {
    try { _sgC.set(hex); } catch (e) { return SG_CONCRETE; }
    const mx = Math.max(_sgC.r, _sgC.g, _sgC.b), mn = Math.min(_sgC.r, _sgC.g, _sgC.b);
    if (mx <= 0 || (mx - mn) / mx < 0.3) return SG_CONCRETE;
    return _sgC.g >= _sgC.r && _sgC.g >= _sgC.b ? SG_GRASS : SG_DIRT;
  }
  const roadGeos = [];                                  // merged into one asphalt mesh after structures
  const roadQueue = [];                                 // { x0, z0, x1, z1, width } dry sections waiting for the bake
  const lotQueue = [];                                  // { cx, cz, w, d } parking lots waiting for the bake
  const ROAD_STEP = 2;      // metres between cross-sections (the lattice pitch is 2.63: the ribbon samples the ground at its own resolution)
  const ROAD_LIFT = 0.06;   // above the mesh; well under STEP_UP (0.55) either way
  const ROAD_XS = [-1, -0.5, 0, 0.5, 1];   // cross-section offsets, x half-width
  const ROAD_DRY = 0.35;    // a road section needs its centreline this far above the waterline
  const themedRoads = mapId !== "ashgrid";   // Wave 7b: see roadRibbon
  const ROAD_XS_T = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];   // (the themed maps: nine cross-section vertices, so a triangle is 1.2 m across the ground's shoulder instead of 2.5 m)
  const roadStats = { registered: 0, sections: 0, droppedWet: 0, metres: 0, metresDropped: 0 };
  const roadLog = [];       // the dry sections as built, kept for the gates and the screenshot tools
  function road(x0, z0, x1, z1, width) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1) return;
    roadStats.registered++;
    const prof = field.profile([[x0, z0], [x1, z1]]);
    let run = [];
    const flush = () => {
      if (run.length >= 3) {                              // >= 8 m
        field.registerCorridor(null, width, { profile: run });
        const a = run[0], b = run[run.length - 1];
        roadQueue.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, width });
        roadStats.sections++; roadStats.metres += b.s - a.s;
      } else if (run.length) { roadStats.droppedWet++; roadStats.metresDropped += run[run.length - 1].s - run[0].s; }
      run = [];
    };
    for (const q of prof) { if (q.p >= waterY + ROAD_DRY) run.push(q); else flush(); }
    flush();
  }
  // the ribbon itself: one conforming strip, the ground sampled at EVERY cross-section vertex of the lattice ground (never at a centre)
  function roadRibbon(x0, z0, x1, z1, width) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 1) return;
    const n = Math.max(1, Math.ceil(len / (themedRoads ? 1.6 : ROAD_STEP)));
    const ux = dx / len, uz = dz / len;      // along
    const px = -uz, pz = ux;                 // perpendicular
    const XS = themedRoads ? ROAD_XS_T : ROAD_XS, hw = width / 2, W2 = XS.length;
    const posA = new Float32Array((n + 1) * W2 * 3);
    const uvA = new Float32Array((n + 1) * W2 * 2);
    const idx = [];
    let k = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = x0 + dx * t, cz = z0 + dz * t;
      for (let j = 0; j < W2; j++) {
        const vx = cx + px * XS[j] * hw, vz = cz + pz * XS[j] * hw;
        // The ribbon's triangles span 2 m x 1.75 m, the lattice cells 2.63 m: on a CURVED stretch (a pad's falloff, a road cut into a slope) the
        // ground half-way between two vertices bulges above the straight chord and pokes through. A vertex is lifted by the largest bulge of
        // the chords that end at it (the ground at their midpoint minus the mean of their ends): 0 on a plane, so a slope costs nothing.
        const sa = len / n, sc = hw * (themedRoads ? 0.25 : 0.5), g0 = heightAt0(vx, vz);
        let lift = 0, b;
        b = heightAt0(vx + ux * sa * 0.5, vz + uz * sa * 0.5) - 0.5 * (g0 + heightAt0(vx + ux * sa, vz + uz * sa)); if (b > lift) lift = b;
        b = heightAt0(vx - ux * sa * 0.5, vz - uz * sa * 0.5) - 0.5 * (g0 + heightAt0(vx - ux * sa, vz - uz * sa)); if (b > lift) lift = b;
        // (Wave 7b, the themed maps: an EDGE vertex does not look outward across the kerb - the ground falls away there on a fill side, and that outward chord alone lifted the whole
        //  edge 0.06 m: roads-float 1.5 % on Isla Viva's hills. Savanna keeps the rule it was built with: its world must hash identically)
        if (!(themedRoads && j === W2 - 1)) { b = heightAt0(vx + px * sc * 0.5, vz + pz * sc * 0.5) - 0.5 * (g0 + heightAt0(vx + px * sc, vz + pz * sc)); if (b > lift) lift = b; }
        if (!(themedRoads && j === 0)) { b = heightAt0(vx - px * sc * 0.5, vz - pz * sc * 0.5) - 0.5 * (g0 + heightAt0(vx - px * sc, vz - pz * sc)); if (b > lift) lift = b; }
        posA[k * 3] = vx; posA[k * 3 + 1] = g0 + Math.min(0.15, lift * 0.4) + ROAD_LIFT; posA[k * 3 + 2] = vz;
        uvA[k * 2] = vx / ROAD_TILE; uvA[k * 2 + 1] = vz / ROAD_TILE;   // world-planar, same texel density as before
        k++;
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < W2 - 1; j++) {
      const a = i * W2 + j, b = a + 1, c = a + W2, dI = c + 1;
      if (houses.length && (underHouse(posA[a * 3], posA[a * 3 + 2]) || underHouse(posA[b * 3], posA[b * 3 + 2]) || underHouse(posA[c * 3], posA[c * 3 + 2]) || underHouse(posA[dI * 3], posA[dI * 3 + 2]))) continue;   // (WAVE 8: no piece of ribbon over a house's floor)
      idx.push(a, b, c, b, dI, c);           // winding gives +Y normals (p x u = +Y)
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvA, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    roadGeos.push(geo);
  }
  function lotPlane(cx, cz, w, d) {
    // A subdivided conforming plane on the (padded, level) ground.
    const nx = Math.max(2, Math.round(w / 4)), nz = Math.max(2, Math.round(d / 4));
    const geo = new THREE.PlaneGeometry(w, d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const pp = geo.attributes.position, pu = geo.attributes.uv;
    for (let i = 0; i < pp.count; i++) {
      const vx = cx + pp.getX(i), vz = cz + pp.getZ(i);
      pp.setY(i, heightAt0(vx, vz) + ROAD_LIFT);
      pu.setXY(i, vx / ROAD_TILE, vz / ROAD_TILE);
    }
    geo.translate(cx, 0, cz);
    geo.computeVertexNormals();
    roadGeos.push(geo);
  }
  // runs once, after the bake: every queued ribbon and lot on the final ground
  function emitRoads() {
    for (const r of roadQueue) { roadRibbon(r.x0, r.z0, r.x1, r.z1, r.width); roadLog.push(r); surfSeg(r.x0, r.z0, r.x1, r.z1, r.width, SG_CONCRETE); }
    for (const l of lotQueue) { lotPlane(l.cx, l.cz, l.w, l.d); surfRect(l.cx - l.w / 2, l.cz - l.d / 2, l.cx + l.w / 2, l.cz + l.d / 2, SG_CONCRETE); }
    roadQueue.length = 0; lotQueue.length = 0;
  }
  // greedy nearest-neighbour tree over the POIs → a connected road network
  function buildRoads(width) {
    for (let i = 1; i < pois.length; i++) {
      let best = -1, bd = 1e9;
      for (let j = 0; j < i; j++) { const d = Math.hypot(pois[i].x - pois[j].x, pois[i].z - pois[j].z); if (d < bd) { bd = d; best = j; } }
      if (best >= 0) road(pois[i].x, pois[i].z, pois[best].x, pois[best].z, width || 7);
    }
  }
  function parkingLot(cx, cz, w, d, poi) {
    // a level pad under the whole lot (the plane used to hug a slope; before that one slab dropped at the centre floated or buried at the
    // corners); the asphalt is laid after the bake
    // a lot that is partly under water is not built (Palm Bay's lay in the surf on a third of the seeds: asphalt and cars below the waterline)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (heightAt0(cx + (i - 1) * w / 2, cz + (j - 1) * d / 2) < waterY + 0.25) return;
    // ...nor one that touches two pads on different levels (it can join only one level, and the other building would then stand 0.1 m off a level
    // floor: Savanna Outpost seed 53 - a lot is asphalt and four cars, a building is never moved or dropped for it)
    const op = field.overlapPad(cx - w / 2 - 0.3, cx + w / 2 + 0.3, cz - d / 2 - 0.3, cz + d / 2 + 0.3);
    if (op !== null && op.all.some((q) => Math.abs(q.h - op.pad.h) > 0.02)) return;
    groundPad(cx, cz, w / 2 + 0.3, d / 2 + 0.3, { gen: "parkingLot" });
    lotQueue.push({ cx, cz, w, d });
    for (let i = 0; i < 4; i++) {
      const px = cx - w / 2 + 3 + (i % 2) * (w - 6), pz = cz - d / 2 + 3 + Math.floor(i / 2) * (d - 6);
      props.car.push({ x: px, y: heightAt0(px, pz), z: pz, s: 2.1, ry: 0 });
    }
  }
  // ── C-PAD in the generators ───────────────────────────────────────────────────────────────────────────────────────
  // groundPad(cx, cz, hx, hz): level the ground under an axis-aligned footprint (centre + half extents; every building here is a quarter
  // turn, so its footprint is a rectangle) at the MEDIAN of a 5 x 5 sample of the ground under it, and return that height: the generator
  // builds on it (y = groundPad(...)), so walls, floors, door lintels and loot are authored on the level the lattice really holds under
  // them (the lattice cell is flat there: PAD_MARGIN). The falloff grows with the cut/fill the flat core asks for (the worst departure of the
  // natural ground from the pad level over footprint + margin): 3 m on level ground, 4.7 m at 1 m, 9 m at 3 m, capped at 12 m. The steepest
  // slope of a smoothstep falloff is 1.5 x cut / falloff, so a 4 m cut ends at ~0.65 (a 6.5 m cap left a steeple on a river bank in a 72 degree wall). A lot is never rejected or moved for its relief: that would change which
  // houses exist and with them the loot census. `gen` only labels the pad in the stats.
  const padLog = [];
  let padReuse = false;      // WAVE 7 (the Savanna city): a footprint whose flat core lies INSIDE an earlier pad's core registers nothing and stands on that pad (a block-wide plateau carries its buildings)
  // THE C-PAD CONTRACT (6A provides; 6B's towngen output and Wave-7 wiring call these): both must run BEFORE `field.bake()` below (that is
  // "before the terrain is built"); they return the stored height / the number of corridor segments. A polygon pad takes `{ poly: [[x, z], ...] }`.
  //   registerPad(shape, height, falloffM)        a flat area; shape = { x0, x1, z0, z1 } | { poly } | [[x, z], ...]
  //   registerCorridor(polyline, width, opts)     a road; opts.profile = TerrainField.profile() samples to register part of one
  const registerPad = (shape, height, falloffM) => field.registerPad(shape, height, falloffM);
  const registerCorridor = (polyline, width, opts) => field.registerCorridor(polyline, width, opts);
  void registerPad; void registerCorridor;                 // (groundPad() and road() are the callers: the Wave-7 city's plateaus, yards and streets go through them too)
  function groundPad(cx, cz, hx, hz, opts) {
    opts = opts || {};
    const hs = [];
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const h = heightAt0(cx - hx + (2 * hx) * i / 4, cz - hz + (2 * hz) * j / 4);
      hs.push(h); if (h < lo) lo = h; if (h > hi) hi = h;
    }
    hs.sort((a, b) => a - b);
    // A footprint whose flat core shares a lattice node with an earlier pad's joins that level, whatever the difference: one node cannot hold
    // two heights, so two buildings that close (a house at the corner of a crossroads stood 1.5 m up one doorway when each pad kept its own
    // median; two huts 5 m apart on a slope left one 0.14 m off) are either one level or neither is exact. The same core asked for twice (a tower
    // whose pad was laid early, see the isla_viva branch) is the same pad.
    const op = field.overlapPad(cx - hx, cx + hx, cz - hz, cz + hz);
    if (op !== null && op.same) return op.pad.h;
    if (padReuse && op !== null) {
      const sr = TerrainField.snapRect(cx - hx, cx + hx, cz - hz, cz + hz);
      if (op.pad.poly === null && op.pad.x0 <= sr.x0 && op.pad.x1 >= sr.x1 && op.pad.z0 <= sr.z0 && op.pad.z1 >= sr.z1) return op.pad.h;
    }
    const lvl = op !== null ? op.pad.h : null;
    const H = lvl !== null ? lvl : (opts.level != null ? opts.level : hs[12]), relief = hi - lo;
    // the cut / fill the flat core really asks for: the ground over the footprint AND the margin that makes the lattice cells level (7 x 7 samples)
    const mg = LAT_PITCH + 0.01;
    let cut = 0;
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) cut = Math.max(cut, Math.abs(heightAt0(cx - hx - mg + (2 * (hx + mg)) * i / 6, cz - hz - mg + (2 * (hz + mg)) * j / 6) - H));
    const fo = Math.min(12, Math.max(3, 2.5 + 2.2 * cut));
    const h = field.registerPad({ x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz }, H, fo);
    padLog.push({ gen: opts.gen || "?", x: cx, z: cz, hx, hz, h, relief, fo, merged: lvl !== null, cut });
    return h;
  }
  // The lowest ground under a turned w x d box (5 x 3 samples over its outline): a wall or a plank cut from there never hangs in the air
  // on the downhill end (rubble slabs, log piles and ruin fragments hung up to 0.9 m over a slope at their centre height).
  function lowGround(cx, cz, w, d, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    let lo = Infinity;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const u = (i / 4 - 0.5) * w, v = (j / 2 - 0.5) * d;
      const g = heightAt0(cx + u * c + v * s, cz - u * s + v * c);
      if (g < lo) lo = g;
    }
    return lo;
  }
  // a house: textured walls + a distinct COLOURED roof (reads as a town from the air)
  // Every wall goes through addBoxR in LOCAL space so `rot` moves the slab as well
  // as turning it (see addBoxR). Two structural changes on top of that: the side
  // walls carry a real window aperture and the back wall carries a second door.
  // Before, a house was four solid walls with ONE door — a blind box with a single
  // entrance, unroofable (the roof deck spans y+3.60..y+3.90 against a maximum
  // mountable height of jumpV²/2|g| + STEP_UP = 7.8²/44 + 0.55 = 1.93 m) and, with
  // building permanently removed, impossible to hold or push. Aperture geometry:
  // standing eye y+1.62 clears the 1.20 m sill by 0.42 m while crouched eye y+0.97
  // is 0.23 m below it, so crouching behind the wall is real cover; the sill top
  // exceeds STEP_UP (0.55) so you cannot step through, and a 1.38 m jump apex puts
  // the capsule at y+1.38..y+3.18, overlapping the header at y+2.30 — blockedHoriz
  // still blocks. It is a firing port; the back door is the second entrance.
  // `o` (Wave 7, optional - the legacy callers pass none and get exactly the old building): { H wall height (default 3.4; halls, barns and sheds differ),
  // flat (no ridge cap: a shop or a hall), loot (probability of the floor item), chest (probability of the chest) }. With `o.loot` set the loot comes from
  // those two probabilities instead of the legacy "always one item, a chest half the time".
  function house(x, z, w, d, rot, wallC, roofC, poiId, o) {
    const H = (o && o.H) || 3.4, T = 0.32, doorW = (o && o.doorW) || 1.4, winW = 1.2;
    // C-PAD: the roof deck (w + 0.7 by d + 0.7, turned by the quarter turn `rot`) is the widest thing in the footprint
    const rc = Math.abs(Math.cos(rot)), rs = Math.abs(Math.sin(rot));
    // Wave 7b: o.y0 = the floor stands on a DECK (the docks village): no pad, the walls start at y0; o.wallTex = the texture kind of the walls (a lodge: "plank")
    const y = o && o.y0 != null ? o.y0 : groundPad(x, z, (rc * (w + 0.7) + rs * (d + 0.7)) / 2 + 0.05, (rs * (w + 0.7) + rc * (d + 0.7)) / 2 + 0.05, { gen: "house" });
    const WO = o && o.wallTex ? { tex: o.wallTex } : undefined;
    const segW = w / 2 - doorW / 2, segD = d / 2 - winW / 2;
    const jamb = d / 4 + winW / 4, pier = w / 4 + doorW / 4;
    // WAVE 7 (7A2) `o.style`: a styled building (the Savanna city's) gets facade windows, a roof shape, a canopy / awning and a chimney, all cosmetic (no collider),
    // and its door is 2.7 m under the lintel whatever its height (a two-storey house or a shop would otherwise have a 6 m door; the wall above is filled in).
    const st = (o && o.style) || null;
    // Wave 7b stage B `o.upper` (themed two-storey houses / shops): a REAL upper floor at y + UP (UP = the storey height): a slab with a stairwell, an interior ramp along one side wall,
    // a second window opening in each side wall and a floor item upstairs - the two-storey front stops being a fake. Savanna never passes it.
    const UP = o && o.upper && st && st.storeys === 2 ? (st.floorH || 3.4) : 0;
    addBoxR(x, z, -pier, -d / 2, y + H / 2, segW, H, T, wallC, rot, WO);                // back, L of back door
    addBoxR(x, z, pier, -d / 2, y + H / 2, segW, H, T, wallC, rot, WO);                 // back, R of back door
    addBoxR(x, z, 0, -d / 2, st ? y + 3.05 : y + H - 0.35, doorW, 0.7, T, wallC, rot, WO);              // back door lintel
    if (st && H > 3.4 + 1e-6) addBoxR(x, z, 0, -d / 2, y + (3.4 + H) / 2, doorW, H - 3.4, T, wallC, rot, WO);
    for (const sx of [-1, 1]) {                                                     // side walls with a window band
      addBoxR(x, z, sx * w / 2, -jamb, y + H / 2, T, H, segD, wallC, rot, WO);
      addBoxR(x, z, sx * w / 2, jamb, y + H / 2, T, H, segD, wallC, rot, WO);
      addBoxR(x, z, sx * w / 2, 0, y + 0.60, T, 1.20, winW, wallC, rot, WO);            // sill  (y+0.00..y+1.20)
      if (UP) {                                                                       // two openings: the lintel + upper sill (y+2.30..y+UP+1.20), the upper header (y+UP+2.30..y+H)
        addBoxR(x, z, sx * w / 2, 0, y + (2.30 + UP + 1.20) / 2, T, UP + 1.20 - 2.30, winW, wallC, rot, WO);
        addBoxR(x, z, sx * w / 2, 0, y + UP + 2.30 + (H - UP - 2.30) / 2, T, H - UP - 2.30, winW, wallC, rot, WO);
      } else if (o && o.H) addBoxR(x, z, sx * w / 2, 0, y + 2.30 + (H - 2.30) / 2, T, H - 2.30, winW, wallC, rot, WO);   // header (y+2.30..y+H)
      else addBoxR(x, z, sx * w / 2, 0, y + 2.85, T, 1.10, winW, wallC, rot, WO);       // header (y+2.30..y+3.40)
    }
    if (UP) houseUpper(x, z, w, d, rot, y, UP, T, wallC, poiId, o);
    addBoxR(x, z, -pier, d / 2, y + H / 2, segW, H, T, wallC, rot, WO);                 // front L of door
    addBoxR(x, z, pier, d / 2, y + H / 2, segW, H, T, wallC, rot, WO);                  // front R of door
    addBoxR(x, z, 0, d / 2, st ? y + 3.05 : y + H - 0.35, doorW, 0.7, T, wallC, rot, WO);               // door lintel
    if (st && H > 3.4 + 1e-6) addBoxR(x, z, 0, d / 2, y + (3.4 + H) / 2, doorW, H - 3.4, T, wallC, rot, WO);
    // The deck used to sit at y+H+0.35 (spanning H+0.20..H+0.50): a 20 cm slit of daylight between the walls' top (y+H) and the roof, on every
    // house in every match. Resting it ON the walls (H+0.00..H+0.30) puts the roof surface 0.20 m lower, the ridge cap with it.
    addBoxR(x, z, 0, 0, y + H + 0.15, w + 0.7, 0.3, d + 0.7, roofC, rot, { tex: "shingle" });   // roof deck (overhangs)
    if (!st && !(o && o.flat)) addBoxR(x, z, 0, 0, y + H + 0.65, w * 0.5, 0.7, d + 0.5, shade(roofC, 0.88), rot, { tex: "shingle" }); // ridge cap
    if (st) houseStyle(x, z, w, d, rot, y, H, T, doorW, segW, pier, wallC, roofC, st, o);
    if (o && o.loot != null) {
      if (rng() < o.loot) loot(x, y + 0.5, z, poiId);
      if (rng() < o.chest) chest(x + (rng() - 0.5) * w * 0.4, y + 0.6, z + (rng() - 0.5) * d * 0.4, poiId);
      return y;
    }
    loot(x, y + 0.5, z, poiId);
    if (rng() < 0.5) chest(x + (rng() - 0.5) * w * 0.4, y + 0.6, z + (rng() - 0.5) * d * 0.4, poiId);
  }
  // WAVE 7 (7A2): the cosmetic dressing of a styled building (see house()): roof shape (0 gable along the depth, 1 gable across, 2 flat with a parapet, 3 stepped hip),
  // chimney, rooftop unit, front / back / side windows on every storey, a shop's glass front and awning, a house's door canopy. Nothing here collides: the walls, doors
  // and window apertures of house() stay exactly as they were; panes sit 2.5 cm proud of the wall faces.
  function houseStyle(x, z, w, d, rot, y, H, T, doorW, segW, pier, wallC, roofC, st, o) {
    const NC = { collide: false }, ry = y + H + 0.3, roofD = shade(roofC, 0.88);
    const fh = st.floorH || 3.4, storeys = st.storeys || 1;
    if (st.roof === 0) addBoxR(x, z, 0, 0, ry + 0.35, w * 0.5, 0.7, d + 0.5, roofD, rot, { tex: "shingle", collide: false });
    else if (st.roof === 1) addBoxR(x, z, 0, 0, ry + 0.35, w + 0.5, 0.7, d * 0.5, roofD, rot, { tex: "shingle", collide: false });
    else if (st.roof === 3) {
      addBoxR(x, z, 0, 0, ry + 0.3, w * 0.74, 0.6, d * 0.74, shade(roofC, 0.95), rot, { tex: "shingle", collide: false });
      addBoxR(x, z, 0, 0, ry + 0.85, w * 0.4, 0.5, d * 0.4, roofD, rot, { tex: "shingle", collide: false });
    } else {                                                                              // flat: a parapet round the deck
      const px = (w + 0.7) / 2 - 0.11, pz = (d + 0.7) / 2 - 0.11, pc = shade(wallC, 0.86);
      addBoxR(x, z, 0, pz, ry + 0.28, w + 0.7, 0.56, 0.22, pc, rot, NC); addBoxR(x, z, 0, -pz, ry + 0.28, w + 0.7, 0.56, 0.22, pc, rot, NC);
      addBoxR(x, z, px, 0, ry + 0.28, 0.22, 0.56, d + 0.7 - 0.44, pc, rot, NC); addBoxR(x, z, -px, 0, ry + 0.28, 0.22, 0.56, d + 0.7 - 0.44, pc, rot, NC);
    }
    if (st.trim) {                                                                        // a cornice band round the wall tops (cream or dark), proud of the walls by 5 cm
      const tc = st.trim === 1 ? shade(wallC, 1.22) : shade(wallC, 0.6), tz = d / 2 + T / 2 + 0.06, tx = w / 2 + T / 2 + 0.06, ty = y + H - 0.22;
      addBoxR(x, z, 0, tz, ty, w + 0.4, 0.4, 0.14, tc, rot, NC); addBoxR(x, z, 0, -tz, ty, w + 0.4, 0.4, 0.14, tc, rot, NC);
      addBoxR(x, z, tx, 0, ty, 0.14, 0.4, d + 0.4, tc, rot, NC); addBoxR(x, z, -tx, 0, ty, 0.14, 0.4, d + 0.4, tc, rot, NC);
    }
    if (st.chimney) addBoxR(x, z, st.chimney * w * 0.3, -d * 0.2, ry + (st.roof === 2 ? 0.9 : 1.2), 0.9, st.roof === 2 ? 1.8 : 2.4, 0.9, st.chimneyC || shade(wallC, 0.72), rot, NC);
    if (st.unit) addBoxR(x, z, -st.unit * w * 0.26, d * 0.2, ry + 0.55, 1.5, 1.1, 1.1, "#8f969c", rot, NC);                 // (a unit stands ON the deck: 1.1 m tall, centre ry + 0.55)
    const glass = st.glass || "#34495e", sill = shade(wallC, 0.7);
    const z1 = d / 2 + T / 2 + 0.025, z0 = -d / 2 - T / 2 - 0.025, x1 = w / 2 + T / 2 + 0.025;
    const wd = Math.min(1.6, segW - 0.9);
    for (let f = 0; f < storeys; f++) {
      const wy = y + f * fh + 1.6;
      if (wd >= 0.6) for (const sx of [-1, 1]) {
        if (!(f === 0 && st.shopfront)) {
          addBoxR(x, z, sx * pier, z1, wy, wd, 1.15, 0.05, glass, rot, NC);                  // front panes, one in each pier beside the door
          addBoxR(x, z, sx * pier, z1 + 0.04, wy - 0.68, wd + 0.3, 0.09, 0.16, sill, rot, NC);
        }
        if (!st.blindBack) addBoxR(x, z, sx * pier, z0, wy, wd, 1.15, 0.05, glass, rot, NC);  // back panes
      }
      if (f > 0 && !(o && o.upper)) for (const sx of [-1, 1]) addBoxR(x, z, sx * x1, 0, wy, 0.05, 1.15, 1.2, glass, rot, NC);   // an upper storey's side windows (the ground floor's are the apertures; a real upper floor has apertures too)
    }
    if (st.shopfront) {                                                                   // glass front: one tall pane in each pier, a sign band over the door
      const gw = Math.max(0.8, segW - 0.5);
      for (const sx of [-1, 1]) addBoxR(x, z, sx * pier, z1, y + 1.55, gw, 2.0, 0.05, glass, rot, NC);
      addBoxR(x, z, 0, z1 + 0.04, y + 3.78, Math.min(w - 0.6, doorW + 2.4), 0.5, 0.08, st.sign || shade(roofC, 0.9), rot, NC);
    }
    if (st.balcony && storeys >= 2) {
      // (stage B) a balcony across the upper floor's front: a 0.2 m slab 1.3 m deep at the floor level, a 1.0 m rail on its three open sides; exact colliders (a glider can land on it).
      // Its floor meets the front wall; there is no door onto it (the upper floor's windows are in the side walls): a balcony to look at, cover for whoever lands there.
      const bw = Math.min(w - 1.2, 7.0), bd = 1.3, by = y + fh, zf = d / 2 + T / 2, rc = st.railC || "#f4f1e8";
      addBoxR(x, z, 0, zf + bd / 2, by + 0.1, bw, 0.2, bd, shade(wallC, 0.85), rot);
      addBoxR(x, z, 0, zf + bd - 0.05, by + 0.7, bw, 1.0, 0.1, rc, rot);
      for (const sx of [-1, 1]) addBoxR(x, z, sx * (bw / 2 - 0.05), zf + bd / 2, by + 0.7, 0.1, 1.0, bd - 0.1, rc, rot);
      addBoxR(x, z, 0, zf + 0.2, by - 0.15, bw, 0.3, 0.4, shade(wallC, 0.75), rot, NC);                            // the beam it is cantilevered from (a band under its root)
    }
    if (st.awning) {
      const aw = Math.min(w - 0.8, w * 0.82);
      addBoxR(x, z, 0, d / 2 + 0.85, y + 3.2, aw, 0.1, 1.7, st.awning, rot, NC);
      addBoxR(x, z, 0, d / 2 + 1.72, y + 3.0, aw, 0.32, 0.08, shade(st.awning, 0.8), rot, NC);
    } else if (st.porch) {
      addBoxR(x, z, 0, d / 2 + 0.8, y + 2.85, doorW + 1.0, 0.14, 1.6, shade(roofC, 0.92), rot, NC);
    }
  }
  /** the real upper floor of a two-storey house (see house() `o.upper`): local frame of house() (door at +z, quarter turn `rot`). A 0.3 m slab over the whole inside at y + UP .. y + UP + 0.3
   *  minus a stairwell; a 2.0 m ramp along the -x or +x side wall (the parcel's own style stream does not decide it: the side is the one away from the house's x, so neighbours alternate)
   *  rising from the front (+z, by the door) toward the back onto the slab (a 0.3 m step at its top, under STEP_UP); the stairwell hole starts where a climber's head is still under the slab
   *  (stairHeadroomRun, as tower()). Every piece is an exact box (a quarter turn); the ramp's direction is turned with the house. Loot upstairs: one floor item with the house's floor odds. */
  function houseUpper(x, z, w, d, rot, y, UP, T, wallC, poiId, o) {
    const turn = ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4, c = [1, 0, -1, 0][turn], s = [0, 1, 0, -1][turn];
    const ix = w / 2 - T / 2, iz = d / 2 - T / 2;                                       // the inside faces of the walls
    const side = ((Math.round(x * 2) + Math.round(z * 2)) & 1) ? 1 : -1, rw = 2.0, rx = side * (ix - 0.15 - rw / 2);
    // the ramp: foot at zf (front), top at zt (back), rising toward -z. Its foot stands 1.75 m inside the front wall: the run-up along its axis is inside the room (a capsule 1.2 m before the foot
    // clears the wall; with 0.6 m the straight approach started behind the wall - collisioncheck ramps-climb, 16 of 42)
    // (Wave 7b stage C) a LANDING at the foot: 2.6 m of floor between the foot and the front wall wherever the room is deep enough to keep the full run (1.35 x UP, 36.5 degrees), never less
    // than stage B's 1.75. With 1.75 m a body beside the stair near its foot stood 2.8 m from the front wall: a healer backing off along the stair met that wall after ~1.8 m and curled round the foot
    // (navcheck heal-pockets: 200 side:0.8 placements on Isla Viva / Deepwood moved 1.91-1.94 m in 2 s); the 10 m-deep houses keep their run and a 1.4-2.6 m strip behind the stair's top.
    const foot = Math.min(2.6, Math.max(1.75, 2 * iz - 0.3 - 1.35 * UP));
    const zf = iz - foot, run = Math.min(zf + iz - 0.3, 1.35 * UP), zt = zf - run;
    const nearD = stairHeadroomRun(UP, run);
    const hz0 = Math.max(-iz, zt - 0.05 * run), hz1 = Math.min(iz, Math.max(zt + 0.6 * run, zt + nearD)), hx0 = rx - rw / 2 - 0.15, hx1 = rx + rw / 2 + 0.15;
    const sc = mapId === "deepwood" ? "#8a6a48" : "#b08a5e", yc = y + UP + 0.15;               // (a boarded floor: the plank texture, a warm wood)
    const slab = (x0, x1, z0, z1) => { if (x1 - x0 > 0.05 && z1 - z0 > 0.05) addBoxR(x, z, (x0 + x1) / 2, (z0 + z1) / 2, yc, x1 - x0, 0.3, z1 - z0, sc, rot, { tex: "plank" }); };
    slab(-ix, Math.max(-ix, hx0), -iz, iz); slab(Math.min(ix, hx1), ix, -iz, iz);       // the strips left and right of the hole (full depth)
    slab(Math.max(-ix, hx0), Math.min(ix, hx1), -iz, hz0); slab(Math.max(-ix, hx0), Math.min(ix, hx1), hz1, iz);      // behind and in front of it
    const mz = (zf + zt) / 2, wx = x + rx * c + mz * s, wz = z - rx * s + mz * c;
    addRamp(wx, y, wz, rw, UP, run, _RAMP_TURN[turn][3], shade(wallC, 0.7));
    if (o && o.loot != null) { if (rng() < o.loot) { const lx = -rx * 0.5, lz = -iz * 0.35; loot(x + lx * c + lz * s, y + UP + 0.8, z - lx * s + lz * c, poiId); } }
  }
  // street dressing along a town's main street: lamp posts, market stalls, benches,
  // hydrants (all cosmetic — collide:false — so they add life without snagging players).
  // Street dressing is cosmetic (collide:false) but it is what the eye measures the ground against, and every piece used to hang off ONE
  // height sampled at its centre: lamp posts, stall posts and bench seats floated 10-40 cm on a slope (benches had no legs at all, the awning
  // sat 10 cm above its posts, the counter 55 cm above the ground). Now each leg / post / pole reaches down to the ground under ITSELF, and a
  // slab sits on the lowest ground under its footprint.
  function streetFurniture(cx, cz, A, span, minH) {
    const half = span / 2;
    for (const s of [-1, 1]) {
      for (let t = -half + 8; t <= half - 8; t += 16) {
        const lx = A ? cx + t : cx + s * 5.5, lz = A ? cz + s * 5.5 : cz + t, y = heightAt0(lx, lz);
        if (baseH(lx, lz) < minH) continue;
        addStilt(lx, lz, 0.22, y + 4.8, "#3a3d42", false);                                  // lamp pole
        addBox(lx, y + 4.9, lz, 0.5, 0.3, 0.5, "#ffe9a8", { collide: false });      // warm lamp head
        lampPts.push({ x: lx, y: y + 4.9, z: lz });
      }
    }
    for (let i = 0; i < 2; i++) {                                                    // market stalls
      const sx = A ? cx + (i ? 12 : -12) : cx + 9, sz = A ? cz + 9 : cz + (i ? 12 : -12), y = heightAt0(sx, sz);
      if (baseH(sx, sz) < minH) continue;
      for (const [dx, dz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) addStilt(sx + dx, sz + dz, 0.15, y + 2.35, "#8a6a3a", false);   // posts run up INTO the awning (2.30..2.50)
      addBox(sx, y + 2.4, sz, 3.6, 0.2, 2.6, i ? "#c0563a" : "#3a7a9a", { collide: false });  // awning
      const cg = gMinRect(sx, sz - 1, 1.7, 0.25) - 0.06;                                       // counter: a solid from the ground up to 1.25 m
      addBox(sx, (cg + y + 1.25) / 2, sz - 1, 3.4, y + 1.25 - cg, 0.5, "#a8794f", { collide: false });
      loot(sx, y + 0.5, sz, null);
    }
    for (let i = 0; i < 4; i++) {                                                    // benches + hydrants
      const t = -half + rng() * span, s = rng() < 0.5 ? -1 : 1;
      const bx = A ? cx + t : cx + s * 7.5, bz = A ? cz + s * 7.5 : cz + t, y = heightAt0(bx, bz);
      if (baseH(bx, bz) < minH) continue;
      if (rng() < 0.55) {
        // seat on two legs (the seat is 0.36..0.64 above the centre ground); each leg reaches the ground under it; the backrest rests on the seat
        for (const lxo of [-0.8, 0.8]) {
          const lg = gMinRect(bx + lxo, bz, 0.06, 0.25) - 0.06;
          addBox(bx + lxo, (lg + y + 0.4) / 2, bz, 0.12, y + 0.4 - lg, 0.5, "#8a6a3a", { collide: false });
        }
        addBox(bx, y + 0.5, bz, 2, 0.28, 0.6, "#8a6a3a", { collide: false }); addBox(bx, y + 0.9, bz - 0.25, 2, 0.55, 0.15, "#8a6a3a", { collide: false });
      } else {                                                                      // hydrant
        const hg = gMinRect(bx, bz, 0.2, 0.2) - 0.06;
        addBox(bx, (hg + y + 1.0) / 2, bz, 0.4, y + 1.0 - hg, 0.4, "#c23b3b", { collide: false });
      }
    }
  }
  // a town: a main street through the POI with houses in lots on both sides facing
  // the road, plus a parking lot. `along` = street axis ("x" or "z").
  function town(p, wallCs, roofC, opts) {
    opts = opts || {};
    const R = p.r, minH = opts.minH != null ? opts.minH : 0.8, A = (opts.along || "x") === "x", nPer = opts.nPer || 4;
    if (A) road(p.x - R * 0.95, p.z, p.x + R * 0.95, p.z, 7); else road(p.x, p.z - R * 0.95, p.x, p.z + R * 0.95, 7);
    const span = R * 1.5;
    // town() and farmland() between them build 8 of the 25 POIs across all three
    // maps, and the only per-call variation was colours, street axis and house
    // count — so beyond the one hero landmark each map gets, no town had a
    // silhouette of its own on approach. `layout` and `signature` are the two
    // cheapest knobs that fix that without a new generator.
    const cross = opts.layout === "crossroads";
    if (cross) { if (A) road(p.x, p.z - R * 0.95, p.x, p.z + R * 0.95, 7); else road(p.x - R * 0.95, p.z, p.x + R * 0.95, p.z, 7); }
    houseRow(A, cross ? Math.max(2, Math.ceil(nPer / 2)) : nPer);
    if (cross) houseRow(!A, Math.max(2, Math.floor(nPer / 2)));
    function houseRow(A, nPer) {
    const step = span / nPer;
    for (const side of [-1, 1]) {
      for (let i = 0; i < nPer; i++) {
        const a0 = -span / 2 + (i + 0.5) * step + (rng() - 0.5) * 3, base = 11.5 + rng() * 2;
        // Retry the SETBACK outward before giving up on a house. A lot that steps
        // into the lake used to just drop the house and leave a gap in the street:
        // measured over 40 seeds, Lakeside Cabins built 64% of its 8 houses that way
        // (the POI snap does not help it — its centre is dry, its lots are not).
        // With the retry it builds 98%, and dry towns never enter the loop's second
        // iteration at all (Logging Camp and Savanna Outpost measure 100% either way).
        let hx = 0, hz = 0, okSet = false;
        for (const mul of [1, 1.5, 2.1, 2.7]) {
          const set = side * base * mul;
          const tx = A ? p.x + a0 : p.x + set, tz = A ? p.z + set : p.z + a0;
          if (baseH(tx, tz) >= minH) { hx = tx; hz = tz; okSet = true; break; }
        }
        if (!okSet) continue;
        const rot = A ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);   // door faces the street
        house(hx, hz, 6 + rng() * 2, 5 + rng() * 1.5, rot, wallCs[i % wallCs.length], roofC, p.id);
      }
    }
    }
    parkingLot(A ? p.x + R * 0.78 : p.x, A ? p.z : p.z + R * 0.78, 15, 13, p);
    streetFurniture(p.x, p.z, A, span, minH);
    if (cross) streetFurniture(p.x, p.z, !A, span, minH);
    // one distinctive structure per town, drawn from the kit already in this file
    const sy = baseH(p.x, p.z);
    if (opts.signature === "clocktower" && sy >= minH) {
      const ty = tower(p.x, p.z - 26, 2, 7, wallCs[0], p.id);
      addBox(p.x, ty + 8.9, p.z - 26 + 3.6, 3, 3, 0.3, "#e8e0c8");   // clock face, visible down the street
    } else if (opts.signature === "depot" && sy >= minH) {
      for (let c = 0; c < 3; c++) {
        const dx = p.x + (c - 1) * 7, dz = p.z - 30;
        for (let b = 0; b < 4; b++) props.barrel.push({ x: dx + (b % 2) * 1.6, y: heightAt0(dx, dz), z: dz + Math.floor(b / 2) * 1.6, s: 1.4, ry: rng() * Math.PI });
      }
      for (const [cx2, cz2] of [[-8, -36], [8, -36], [-8, -24], [8, -24]]) addBox(p.x + cx2, heightAt0(p.x + cx2, p.z + cz2) + 2.4, p.z + cz2, 0.3, 4.8, 0.3, "#6a6258");
      addBox(p.x, heightAt0(p.x, p.z - 30) + 5.0, p.z - 30, 18, 0.35, 13, "#8a8378");        // canopy
      chest(p.x, heightAt0(p.x, p.z - 30) + 0.6, p.z - 30, p.id);
    }
    // Sample the CHEST's own ground, not the POI centre's. loot.js clamps anything
    // that would sink but nothing pulls a chest DOWN, so an offset chest on a slope
    // hovered: measured over 300 seeds, 10% of Palm Bay's, 20% of Coco Village's and
    // 25% of Logging Camp's chests floated more than 1 m, worst case 5.3 m.
    for (let i = 0; i < 2; i++) {
      const cx = p.x + (rng() - 0.5) * R * 0.6, cz = p.z + (rng() - 0.5) * R * 0.6;
      chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);
    }
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE 7 (lane 7A): THE SAVANNA CITY
  // ═══════════════════════════════════════════════════════════════════════════
  // Savanna (map id "ashgrid") used to be nine hand-placed POIs: a ring of six lone towers, a four-house town, a few huts. Now towngen.js lays out real towns
  // (a 3 x 3 block core on Downtown Core, 2 x 2 / 3 x 2 towns on the other POIs, two industrial yards, ~30 compounds between them) as DATA, and this section
  // builds them: the streets register their corridors in the ground field before anything stands on them, every building is the existing enterable
  // house() / tower() generator on its parcel (turned a quarter turn to face its street, so its collider stays an exact box), the closed skyline shells and
  // the street furniture are citykit instances with exact colliders, sidewalks / lane lines / crosswalks are conforming decals, and the wilderness (trees,
  // rocks, scattered cars, wild loot, minor landmarks) keeps out of the city's footprints. isla_viva and deepwood never enter any of this: `city` stays null
  // there and every guard below is a no-op, so their shared-rng stream and their world are exactly the Wave-6 build's.
  // DETERMINISM: towngen draws only from its own sub-RNGs (mulberry32(seed ^ hash(id))); the only shared-`rng` draws are house() / tower() loot rolls, made in a
  // fixed building order, so every squad client rebuilds the same city from W.seed (genVersion 3).
  // Loot keeps out of everything solid. openSpot(x, y, z): is a point (a loot item at that height) clear of every collider box built so far and of the kit's boxes
  // (a linear scan: called for a few dozen points a match)? onProp(x, z): a wild loot spot never lands under a placed car / barrel / rock / container / tree
  // (their colliders are built later, from these anchors). Both only matter on Savanna (the callers test `city` first), so the other maps' streams are untouched.
  const PROP_CLEAR = { car: 3.2, barrel: 1.4, rocks: 3.6, container: 4.2, tree: 1.0, palm: 1.0, pine: 1.0, birch: 1.0 };
  const onProp = (x, z) => { for (const kind in PROP_CLEAR) { const r = PROP_CLEAR[kind], l = props[kind]; if (l) for (let i = 0; i < l.length; i++) { const dx = l[i].x - x, dz = l[i].z - z; if (dx * dx + dz * dz < r * r) return true; } } return false; };
  const cityKitBoxes = [];          // the colliders citykit WILL add (a pure function of the kit list, computed when the buildings are done): loot keeps clear of them too
  const openSpot = (x, y, z) => {
    for (let i = 0; i < colliders.length; i++) { const c = colliders[i]; if (c.kind !== "ramp" && x > c.minX - 0.05 && x < c.maxX + 0.05 && z > c.minZ - 0.05 && z < c.maxZ + 0.05 && y > c.minY - 0.05 && y < c.maxY + 0.05) return false; }
    for (let i = 0; i < cityKitBoxes.length; i++) { const c = cityKitBoxes[i]; if (x > c.minX - 0.05 && x < c.maxX + 0.05 && z > c.minZ - 0.05 && z < c.maxZ + 0.05 && y > c.minY - 0.05 && y < c.maxY + 0.05) return false; }
    return true;
  };
  const cityFoot = [];              // [x0, z0, x1, z1]: where the wilderness must not put anything (a town's blocks + roads, a compound's fence)
  const cityDecks = [];             // [x0, z0, x1, z1]: the docks village's deck slabs (a floor item beside one would sit half under its edge): wild loot keeps out like it does of a building
  const cityBld = [];               // [x0, z0, x1, z1]: every town / compound building footprint (and kit shells): wild loot and portals keep out
  const cityRoadLog = [];           // [x0, z0, x1, z1, width]: every street and link, for the grass mask and the minimap
  const cityKeepClear = [];         // (stage B) [x0, z0, x1, z1]: where no launch ring may stand (the mill bridge's deck and 14 m approaches); empty on Savanna
  let city = null;                  // { TG, CK, lay, kit: [citykit list], stats } - set in the ashgrid branch
  const inRects = (list, x, z, pad) => { for (let i = 0; i < list.length; i++) { const r = list[i]; if (x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad) return true; } return false; };
  const inCity = (x, z, pad) => cityFoot.length > 0 && inRects(cityFoot, x, z, pad || 0);
  const cityReserveExtra = [];      // [x0, z0, x1, z1] rectangles a map keeps clear of the layout for its own landmarks (Isla Viva's Cliff Temples keep); filled before prepareCity()
  /** Wave 7b: is this spot (grown by pad) in a block, yard or village footprint of the layout, or on a building? The draw-then-reject test of a map's own landmarks. */
  const cityBlocks = (x, z, pad) => inCity(x, z, pad) || (cityBld.length > 0 && inRects(cityBld, x, z, pad)) || (cityDecks.length > 0 && inRects(cityDecks, x, z, pad));
  /** Wave 7b: the first shoreline spot (ground within [lo, hi] of the sea level, water within 22 m on one side and dry land on another, nothing of the layout within `clear`) on rings round (cx, cz); null when there is none. Pure function of the ground. */
  function shoreSpot(cx, cz, maxR, lo, hi, clear, avoid) {
    lo = lo == null ? waterY + 0.6 : lo; hi = hi == null ? waterY + 2.2 : hi; clear = clear || 12;
    for (let ring = 0; ring <= maxR; ring += 10) for (let i = 0; i < (ring ? 16 : 1); i++) {
      const a = i / 16 * Math.PI * 2 + ring * 0.13, x = cx + Math.cos(a) * ring, z = cz + Math.sin(a) * ring, h = baseH(x, z);
      if (!(h >= lo && h <= hi) || cityBlocks(x, z, clear)) continue;
      if (avoid && Math.hypot(x - avoid[0], z - avoid[1]) < avoid[2]) continue;
      let wet = 0, dry = 0;
      for (let k = 0; k < 8; k++) { const q = baseH(x + Math.cos(k * Math.PI / 4) * 22, z + Math.sin(k * Math.PI / 4) * 22); if (q < waterY - 0.1) wet++; else if (q > waterY + 0.8) dry++; }
      if (wet > 0 && dry > 0) return [x, z];
    }
    return null;
  }
  const SAV = CITY_THEME_TABLES[mapId] || CITY_THEME_TABLES.ashgrid;   // the active theme's tables (Savanna / resort / lodge): see CITY_THEME_TABLES above buildMap
  const SHELL_CENTRE = { "suburban/building-type-q": [0, 0.15] };   // the only kit building whose visual box is not centred on its origin (manifest bbox_min_m / bbox_max_m)
  const CITY_SW_LIFT = 0.10, CITY_MK_LIFT = 0.115;   // sidewalk and paint heights over the ground (the road ribbon is ROAD_LIFT = 0.06 over it)

  // WAVE 7 (7A2): the import is tried twice. A browser remembers a FAILED module fetch under its URL, so the retry asks for the same two files under another URL
  // (`&retry=1`: neither file imports anything, so it is the same code; it still carries the boot module's ?v=). If both tries fail the match is still played on
  // the Wave-6 Savanna layout - but then THIS client builds a different world from a squad host that loaded the towns, and the squad guard (which compares the
  // exported MAP_GEN_VERSION in the lobby, before any map exists) cannot see it. So the fallback is loud: console.error, `map.genVersion` = MAP_GEN_VERSION - 1,
  // `map.fallback` = { reason, genVersion, wanted }, and a "mapFallback" event on W.events (see the end of buildMap).
  let cityFallback = null;
  async function prepareCity() {
    let TG, CK, HG, err = null;
    for (let attempt = 0; attempt < 2 && !TG; attempt++) {
      try {
        if (attempt) await new Promise((res) => setTimeout(res, 400));
        const q = attempt ? _V + (_V ? "&" : "?") + "retry=1" : _V;
        // (WAVE 8: housegen.js - the furnished houses - is one of the city modules: a page without it builds the pre-city layout, like a page without towngen.js)
        [TG, CK, HG] = await Promise.all([import("./towngen.js" + q), import("./citykit.js" + q), import("./housegen.js" + q)]);
      } catch (e) { err = e; TG = CK = HG = undefined; console.warn("[maps] the town generator did not load (try " + (attempt + 1) + " of 2):", e && e.message || e); }
    }
    if (!TG) {
      cityFallback = { reason: String(err && err.message || err || "import failed").slice(0, 200), genVersion: FALLBACK_GEN_VERSION[mapId] || 2, wanted: MAP_GEN_VERSION };
      console.error("[maps] towngen.js / citykit.js / housegen.js failed to load twice: " + K.name + " is built on its pre-city layout (genVersion " + cityFallback.genVersion + ", not " + MAP_GEN_VERSION + "); a squad host with the towns builds a different map.");
      return null;
    }
    // landmarks that stay: Savanna's overpass (pillars, decks, the access ramp, the station) and the crane with its jib ramp. The other maps keep their landmarks by drawing
    // them first and dropping what overlaps the city (the draw-then-reject rule), or by placing them after the layout on a free spot.
    let reserve = cityReserveExtra.slice();
    if (mapId === "ashgrid") {
      const op = pois.find((q) => q.id === "overpass"), cr = pois.find((q) => q.id === "crane");
      reserve = [[op.x - 106, op.z - 8, op.x + 108, op.z + 8], [cr.x - 6, cr.z - 20, cr.x + 10, cr.z + 24]];
    }
    const lay = TG.layoutMap(seed, mapId, pois.map((q) => ({ id: q.id, x: q.x, z: q.z, r: q.r })), baseH, waterY, { reserve });
    // Isla Viva and Deepwood (Wave 7b): a town the generator had to move (a coastal POI on open water, a river bank, a steep slope) takes its POI with it, so the named place,
    // the drop-screen label, the bots' targets and the citycheck attribution all sit where the buildings are. Savanna's POIs never move.
    if (mapId !== "ashgrid") for (const T of lay.towns) {
      const p = pois.find((q) => q.id === T.id), c = T.centre;
      if (p && c && (T.blocks.length || T.parcels.length) && Math.hypot(c[0] - p.x, c[1] - p.z) > 8) { p.x = Math.round(c[0] * 10) / 10; p.z = Math.round(c[1] * 10) / 10; }
    }
    const HP = TG.PITCH / 2;
    for (const T of lay.towns) for (const b of T.blocks) cityFoot.push([b.cx - HP - 5, b.cz - HP - 5, b.cx + HP + 5, b.cz + HP + 5]);
    for (const T of lay.compounds.concat(lay.towns.filter((q) => !q.blocks.length && q.compound && q.parcels.length && q.kind !== "crater"))) { const q = T.compound.bounds; cityFoot.push([q[0] - 6, q[1] - 6, q[2] + 6, q[3] + 6]); }   // (a POI whose grid did not fit falls back to a lane cluster)
    for (const T of lay.towns.concat(lay.compounds)) for (const p of T.parcels) if (p.building) { const a = p.building.aabb; cityBld.push([a[0], a[1], a[2], a[3]]); }
    for (const T of lay.towns) if (T.kind === "docks" && T.docks) for (const dk of T.docks.decks) cityDecks.push([dk.rect[0], dk.rect[1], dk.rect[2], dk.rect[3]]);
    for (const T of lay.compounds) for (const q of T.compound.props) cityBld.push(q.kind === "container" ? [q.x - 3.4, q.z - 3.4, q.x + 3.4, q.z + 3.4] : [q.x - 5, q.z - 5, q.x + 5, q.z + 5]);   // (silo / water tower / containers: wild loot keeps out)
    return { TG, CK, HG, lay, kit: [], stats: lay.stats, lights: 0, kitStats: null, skyline: [], landmarks: [] };
  }
  // the streets and the links between towns go into the ground field NOW (before any pad), as ROAD_W-wide corridors
  function registerCityRoads() {
    const { TG, lay } = city;
    for (const T of lay.towns) for (const s of T.roads.streets) { road(s.x0, s.z0, s.x1, s.z1, TG.ROAD_W); cityRoadLog.push([s.x0, s.z0, s.x1, s.z1, TG.ROAD_W]); }
    for (const l of lay.links) {
      // Wave 7b: a link on a map with water carries `path`, a polyline round the water (towngen routeLink); Savanna's links are the straight segments they were
      const pts = l.path && l.path.length > 1 ? l.path : [[l.ax, l.az], [l.bx, l.bz]];
      for (let k = 0; k + 1 < pts.length; k++) { road(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], TG.ROAD_W); cityRoadLog.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], TG.ROAD_W]); }
    }
  }
  // Wave 7b: the special layouts - the docks village (a boardwalk on stilts), the crater-rim village and the mill-and-bridge compound - register their pads and footprints here, right
  // after the plateaus and before any building, like everything that shapes the ground (the C-PAD order rule)

  // every town is ONE plateau: each block's square (grown to the road's outer edge) is a pad at the town's level - the median of the live ground under all its blocks
  // - so streets, sidewalks and every building are exactly level and the town's whole edge is one falloff; a compound's yard (its fence rectangle) is one pad too.
  // Registered right after the roads and BEFORE any landmark, so everything built later reads the shaped ground (the C-PAD order rule).
  function registerCityPlateaus() {
    const { TG, lay } = city, HPm = TG.PITCH / 2 + TG.ROAD_W / 2;
    const medianOf = (rects) => {
      const hs = [];
      for (const r of rects) for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) hs.push(heightAt0(r[0] + (r[2] - r[0]) * i / 6, r[1] + (r[3] - r[1]) * j / 6));
      hs.sort((a, b) => a - b);
      return hs[hs.length >> 1];
    };
    for (const T of lay.towns) {
      if (!T.blocks.length) {                       // (a POI with no grid fits falls back to a lane / yard cluster: its bounds are one plateau too)
        if (T.compound && T.parcels.length && !SPECIAL_KINDS[T.kind]) { const q = T.compound.bounds, r = [q[0], q[1], q[2], q[3]]; groundPad((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, { gen: "yard", level: medianOf([r]) }); }
        continue;
      }
      const rects = T.blocks.map((b) => [b.cx - HPm, b.cz - HPm, b.cx + HPm, b.cz + HPm]), H = medianOf(rects);
      for (const r of rects) groundPad((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, { gen: "plateau", level: H });
    }
    for (const T of lay.compounds) {
      const q = T.compound.bounds, r = [q[0], q[1], q[2], q[3]];
      groundPad((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, { gen: "yard", level: medianOf([r]) });
    }
  }
  /** a kit instance standing on the ground under its footprint: y = the lowest ground under the type's footprint + `lift` */
  function cityKitY(type, x, z, rot, lift) {
    const fp = city.CK.footprintFor(type, x, z, rot);
    const x0 = fp.minX, x1 = fp.maxX, z0 = fp.minZ, z1 = fp.maxZ;
    const gy = Math.min(heightAt0(x0, z0), heightAt0(x1, z0), heightAt0(x0, z1), heightAt0(x1, z1), heightAt0((x0 + x1) / 2, (z0 + z1) / 2));
    return (gy - gy === 0 ? gy : waterY) + lift;                         // (7A2: a non-finite ground sample never reaches a kit instance)
  }
  // Per-block / per-compound palette: two wall colours per building class and two roof colours, drawn from the block's own stream (TG.subRng(seed, town, "pal<block>")),
  // so a block reads as one street of related colours while the next block differs; each parcel then takes one of the two (or, one time in six, any colour of the class)
  // from ITS OWN stream ("col<parcel>"): no draw order couples one building's colour to another's.
  const cityPalCache = new Map();
  function cityPalette(T, blockId, core) {
    const key = T.id + ":" + blockId;
    let P = cityPalCache.get(key);
    if (P) return P;
    const r = city.TG.subRng(seed, T.id, "pal" + blockId);
    const two = (a) => { const i = Math.floor(r() * a.length); let j = Math.floor(r() * (a.length - 1)); if (j >= i) j++; return [a[i], a[j]]; };
    P = { house: two(SAV.walls.house), shop: two(SAV.walls.shop), big: two(core ? SAV.walls.core : SAV.walls.big), hall: two(SAV.walls.hall), shed: two(SAV.walls.shed), barn: two(SAV.walls.barn), roof: two(SAV.roofs), awning: two(SAV.awnings) };
    cityPalCache.set(key, P);
    return P;
  }
  // â”€â”€ D2 (Wave 7 completion): landmark lots and compound dressing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Everything here is addBox into the town's (or compound cell's) own structure sink: the same mesh, the same texture, ZERO extra draw calls; only what a player can walk into
  // or shelter behind collides (pillars, pumps, a kiosk, a clock tower's shaft, the court's stands). towngen decides WHICH lot is a gas station / market / plaza / court (a
  // pure function of the seed); the shapes are drawn from the lot's own sub-stream ("lm<parcel>"). A lot too small for its landmark stays an (empty) yard.
  const LM_MIN = { gas: [18, 14], market: [17, 13], plaza: [14, 14], court: [24, 15] };
  function buildLandmark(T, p) {
    const m = LM_MIN[p.lot], r = p.rect, w = r[2] - r[0], d = r[3] - r[1], cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
    const alongX = w >= d, L = alongX ? w : d, Wd = alongX ? d : w;
    if (!m || L < m[0] || Wd < m[1]) return false;
    const rr = city.TG.subRng(seed, T.id, "lm" + p.id), NC = { collide: false };
    const fv = alongX ? p.facing[1] : p.facing[0], sv = fv < 0 ? -1 : 1;                   // which way (along the lot's short axis) the street is
    const y0 = heightAt0(cx, cz) + CITY_SW_LIFT;
    // u runs along the lot's long side, v across it toward the street (sv); B places a box by (u, v, height of its centre, size u, size y, size v)
    // (a box that stands on the paving reaches down through the 10 cm slab to the ground: a piece hovering 10 cm over the terrain is a floating piece to the placement gates)
    const B = (u, v, yc, bu, bh, bv, col, o) => { let c = yc, h = bh; if (yc - bh / 2 < 0.06) { const top = yc + bh / 2; c = (top - CITY_SW_LIFT) / 2; h = top + CITY_SW_LIFT; } return addBox(alongX ? cx + u : cx + v, y0 + c, alongX ? cz + v : cz + u, alongX ? bu : bv, h, alongX ? bv : bu, col, o); };
    if (p.lot === "gas") {
      const cv = sv * (Wd / 2 - 4.9), kv = -sv * (Wd / 2 - 3.6), uu = Math.min(L / 2 - 1.5, 5.4), accent = rr() < 0.5 ? "#c8382e" : "#2f6fb0", cw = Math.min(11, 2 * uu);
      B(0, cv, 4.85, cw, 0.5, 6.4, "#dcdad0", NC); B(0, cv, 4.5, cw + 0.1, 0.34, 6.5, accent, NC);
      for (const su of [-1, 1]) for (const sw of [-1, 1]) B(su * (cw / 2 - 0.8), cv + sw * 2.3, 2.3, 0.5, 4.6, 0.5, "#b9b9b4");
      for (const su of [-1, 1]) { B(su * 1.9, cv, 0.8, 0.8, 1.6, 0.55, "#e3e0d6"); B(su * 1.9, cv, 1.68, 0.84, 0.16, 0.59, accent, NC); }
      B(0, kv, 1.6, 5.6, 3.2, 3.6, "#e8e2cf"); B(0, kv, 3.35, 6.0, 0.4, 4.0, "#3e4a58", NC); B(0, kv + sv * 1.84, 1.7, 4.4, 1.5, 0.06, "#27384a", NC);
      const su = (rr() < 0.5 ? -1 : 1) * (L / 2 - 1.6);
      B(su, sv * (Wd / 2 - 1.1), 3.5, 0.3, 7, 0.3, "#4a4d52", NC); B(su, sv * (Wd / 2 - 1.1), 7.5, 2.2, 1.7, 0.3, "#f1c232", NC); B(su, sv * (Wd / 2 - 1.1), 8.2, 2.3, 0.4, 0.34, accent, NC);
    } else if (p.lot === "market") {
      const n = Math.max(2, Math.min(4, Math.floor((L - 3) / 5.4))), pitch = 5.4, v0 = -sv * Math.min(2.2, Wd / 2 - 4.5), AW = SAV.awnings, off = Math.floor(rr() * AW.length);
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * pitch, col = AW[(k + off) % AW.length];
        for (const su of [-1, 1]) for (const sw of [-1, 1]) B(u + su * 1.7, v0 + sw * 1.15, 1.2, 0.14, 2.4, 0.14, "#8a6a3a", NC);
        B(u, v0, 2.45, 3.9, 0.18, 2.8, col, NC); B(u, v0 + sv * 1.4, 2.3, 3.9, 0.34, 0.08, shade(col, 0.8), NC);
        B(u, v0 - sv * 0.5, 0.55, 3.3, 1.1, 0.7, "#a8794f", NC); B(u - 1.0, v0 - sv * 0.5, 1.3, 0.8, 0.5, 0.6, "#c8a45a", NC); B(u + 0.9, v0 - sv * 0.5, 1.25, 0.9, 0.4, 0.6, "#b4553c", NC);
      }
      for (let k = 0; k < 3; k++) B((rr() - 0.5) * (L - 6), sv * (Wd / 2 - 2.2), 0.3, 0.8, 0.6, 0.8, "#b58a4a", NC);
    } else if (p.lot === "plaza") {
      const h = 15 + rr() * 5, cap = rr() < 0.5 ? "#6a3b30" : "#3e5a52";
      B(0, 0, 0.3, 6.4, 0.6, 6.4, "#b7b3a4", NC);
      B(0, 0, h / 2, 3.4, h, 3.4, "#cdbb9c"); B(0, 0, 1.0, 4.0, 2.0, 4.0, "#a99e85", NC);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const fy = y0 + h - 3.4;
        addBox(cx + dx * 1.78, fy, cz + dz * 1.78, dx ? 0.22 : 2.7, 2.7, dz ? 0.22 : 2.7, "#efe6cf", NC);                                   // the clock plate
        addBox(cx + dx * 1.92, fy + 0.4, cz + dz * 1.92, dx ? 0.1 : 0.14, 1.05, dz ? 0.1 : 0.14, "#2a2a2a", NC);                         // minute hand
        addBox(cx + dx * 1.92 + (dz ? 0.35 : 0), fy, cz + dz * 1.92 + (dx ? 0.35 : 0), dx ? 0.1 : 0.8, 0.14, dz ? 0.1 : 0.8, "#2a2a2a", NC); // hour hand
      }
      B(0, 0, h + 0.4, 4.4, 0.8, 4.4, cap, NC); B(0, 0, h + 1.3, 3.0, 1.0, 3.0, shade(cap, 1.1), NC); B(0, 0, h + 2.3, 1.7, 1.0, 1.7, cap, NC); B(0, 0, h + 4.0, 0.22, 2.4, 0.22, "#3a3a3a", NC);
      for (const [bu, bv, ro] of [[-4.6, 0, 1], [4.6, 0, 1], [0, -4.6, 0], [0, 4.6, 0]]) B(bu, bv, 0.25, ro ? 0.6 : 2.0, 0.5, ro ? 2.0 : 0.6, "#8a6a3a", NC);
    } else if (p.lot === "court") {
      const bl = Math.min(L - 8, 20);
      for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) B(0, sd * (Wd / 2 - 1.0 - k * 0.8), 0.28 * (3 - k), bl, 0.56 * (3 - k), 0.8, "#aeb0b4");       // (three steps, the highest on the outside)
      for (const su of [-1, 1]) {
        const u = su * (Math.min(L - 8, 28) / 2 - 0.6);
        B(u, 0, 2.1, 0.2, 4.2, 0.2, "#55585d", NC); B(u - su * 0.15, 0, 3.7, 0.1, 1.0, 1.7, "#ececec", NC);
        for (const sd of [-1, 1]) { B(su * (L / 2 - 1.2), sd * (Wd / 2 - 1.2), 4.5, 0.25, 9, 0.25, "#4a4d52", NC); B(su * (L / 2 - 1.2), sd * (Wd / 2 - 1.2), 9.2, 1.4, 0.5, 0.9, "#f3efd0", NC); }
      }
    }
    city.landmarks.push({ kind: p.lot, town: T.id, x: cx, z: cz });
    return true;
  }
  // a compound's loose dressing (hay, a wood pile, a trough, rubble, crates) in its yard, and a windbreak of acacias round it: collide:false boxes on free spots (clear of cars, props
  // and buildings), so it never snags a player and never hides behind a wall. The dice are the compound's own sub-stream ("dec").
  function buildCompoundDecor(T) {
    const C = T.compound, y = C.yard, rr = city.TG.subRng(seed, T.id, "dec"), NC = { collide: false }, ruin = T.theme === "ruin", V = C.variant || "homestead";
    const free = (x, z, rad) => {
      for (const c of C.cars) if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) < (rad + 2.8) * (rad + 2.8)) return false;
      for (const q of C.props) { const pr = q.kind === "container" ? 4.4 : q.kind === "watertower" ? 5.2 : 3.6; if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < (rad + pr) * (rad + pr)) return false; }
      for (const p of T.parcels) { const a = p.building.aabb; if (x > a[0] - rad && x < a[2] + rad && z > a[1] - rad && z < a[3] + rad) return false; }
      return x > y[0] + rad && x < y[2] - rad && z > y[1] + rad && z < y[3] - rad;
    };
    const spot = (rad) => { for (let k = 0; k < 12; k++) { const x = y[0] + rad + rr() * (y[2] - y[0] - 2 * rad), z = y[1] + rad + rr() * (y[3] - y[1] - 2 * rad); if (free(x, z, rad)) return [x, z]; } return null; };
    const at = (x, z, dy, w, h, d, col) => { let c = dy, hh = h; if (dy - h / 2 < 0.06) { const top = dy + h / 2; c = (top - CITY_SW_LIFT) / 2; hh = top + CITY_SW_LIFT; } return addBox(x, heightAt0(x, z) + CITY_SW_LIFT + c, z, w, hh, d, col, NC); };
    const hay = ["#d6b052", "#c9a24a", "#dcbb62"];
    const themedYard = mapId !== "ashgrid" && (T.theme === "resort" || T.theme === "lodge");
    if (themedYard && !ruin) {
      const s = spot(2.6);
      if (s && T.theme === "resort") {
        const cc = ["#e8705a", "#2aa6a8", "#f3c34a", "#e892a6"][Math.floor(rr() * 4)];
        at(s[0], s[1], 1.1, 0.1, 2.2, 0.1, "#d9d4c8"); at(s[0], s[1], 2.25, 2.6, 0.12, 2.6, cc);
        at(s[0] - 1.4, s[1] + 1.5, 0.2, 0.7, 0.3, 1.9, "#f2f0ea"); at(s[0] + 1.4, s[1] + 1.5, 0.2, 0.7, 0.3, 1.9, "#8fd0d8");
      } else if (s) {
        at(s[0], s[1], 0.1, 1.1, 0.2, 1.1, "#3d3a34");
        for (const [ox, oz, ww, dd] of [[-1.5, 0, 0.45, 1.5], [1.5, 0, 0.45, 1.5], [0, -1.5, 1.5, 0.45], [0, 1.5, 1.5, 0.45]]) at(s[0] + ox, s[1] + oz, 0.22, ww, 0.44, dd, "#6b4a2e");
      }
    }
    if (!ruin && V !== "depot" && !themedYard) for (let k = 0, n = V === "farmstead" ? 2 : 1; k < n; k++) {
      const s = spot(2.4); if (!s) continue;
      at(s[0] - 0.9, s[1], 0.6, 1.6, 1.2, 1.2, hay[k % 3]); at(s[0] + 0.9, s[1], 0.6, 1.6, 1.2, 1.2, hay[(k + 1) % 3]); at(s[0], s[1] + 0.1, 1.8, 1.6, 1.2, 1.2, hay[(k + 2) % 3]);
    }
    const wp = spot(1.6);
    if (wp) { at(wp[0], wp[1], 0.35, 2.2, 0.7, 0.9, "#7a5a3a"); at(wp[0], wp[1] + 0.95, 0.35, 2.2, 0.7, 0.9, "#6c4f33"); at(wp[0] + 0.1, wp[1] + 0.45, 1.0, 2.0, 0.6, 0.9, "#84633f"); }
    if (V === "farmstead") { const s = spot(1.6); if (s) { at(s[0], s[1], 0.35, 2.4, 0.7, 0.9, "#6b7f8c"); at(s[0], s[1], 0.68, 2.2, 0.08, 0.7, "#4f7da0"); } }
    if (ruin) for (let k = 0; k < 4; k++) { const s = spot(1.4); if (!s) continue; const q = 0.9 + rr() * 1.0; at(s[0], s[1], q / 2, q * 1.4, q, q * 1.1, k % 2 ? "#8d877a" : "#77726a"); if (k === 0) at(s[0] + 1.6, s[1], 0.7, 3.2, 1.4, 0.4, "#9a9487"); }
    if (V === "depot") for (let k = 0; k < 3; k++) { const s = spot(1.2); if (!s) continue; at(s[0], s[1], 0.5, 1.0, 1.0, 1.0, "#b58a4a"); at(s[0] + 1.05, s[1], 0.5, 1.0, 1.0, 1.0, "#a37a3f"); at(s[0] + 0.5, s[1], 1.5, 1.0, 1.0, 1.0, "#c29a56"); }
    // a windbreak of three to five acacias round the fence (the map's own instanced tree, with its trunk collider): a green clump a pilot can see from the plane
    const b = C.bounds, nT = ruin ? 2 : mapId === "ashgrid" ? 3 + Math.floor(rr() * 3) : 2 + Math.floor(rr() * 2);
    for (let k = 0; k < nT; k++) {
      const side = Math.floor(rr() * 4), t = rr(), off = 4.5 + rr() * 3;
      const tx = side < 2 ? b[0] + (b[2] - b[0]) * t : (side === 2 ? b[0] - off : b[2] + off), tz = side < 2 ? (side === 0 ? b[1] - off : b[3] + off) : b[1] + (b[3] - b[1]) * t;
      if (C.gate && (tx - C.gate[0]) * (tx - C.gate[0]) + (tz - C.gate[1]) * (tz - C.gate[1]) < 100) continue;
      props[cityTree].push({ x: tx, y: heightAt0(tx, tz), z: tz, s: 0.8 + rr() * 0.45, ry: rr() * Math.PI * 2 });
    }
    city.landmarks.push({ kind: "compound:" + V, town: T.id, x: (y[0] + y[2]) / 2, z: (y[1] + y[3]) / 2 });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE 7b: THE THEMED CITIES - what Isla Viva (a resort) and Deepwood (a timber lodge) add to the Savanna section above
  // ═══════════════════════════════════════════════════════════════════════════
  // The same towngen layouts, the same pads, the same house() / tower() generators on parcels, the same kit and decals: only the tables (CITY_THEME_TABLES), the style dice
  // (themedStyle), the street dressing and the special layouts differ. Three layouts have shapes of their own and are built here from their data: the docks village (decks and
  // posts over the shallows, houses ON the decks), the crater-rim village (levelled terrace plots, ruined stone houses, retaining walls, a plaza, broken arches, columns and rubble)
  // and the mill-and-bridge compound. Savanna never enters any of this: every call is guarded by the layout's `kind` (core / town / village / yard / compound only exist there).
  const SPECIAL_KINDS = { docks: 1, crater: 1, mill: 1 };
  const RUIN_STONE = ["#8f8a80", "#9a9488", "#847e72", "#a49d8f", "#7d786d", "#968f82"];
  const TG_subRng = (id, salt) => city.TG.subRng(seed, id, salt);
  const cityTree = mapId === "isla_viva" ? "palm" : mapId === "deepwood" ? "pine" : "tree";    // the instanced tree of a windbreak, a pocket park, a back yard (Savanna: the acacia, as before)
  /** [lowest, highest] ground under a turned w x d box (5 x 3 samples over its outline) */
  function groundRange(cx, cz, w, d, rot) {
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    let lo = Infinity, hi = -Infinity;
    const ni = Math.min(41, Math.max(5, Math.ceil(w / 1.2) + 1)), nj = Math.min(11, Math.max(3, Math.ceil(d / 1.2) + 1));      // (a sample every ~1.2 m: a long wall on a 30 degree slope has no low corner between the old five)
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const u = (i / (ni - 1) - 0.5) * w, v = (j / (nj - 1) - 0.5) * d, g = heightAt0(cx + u * c + v * s, cz - u * s + v * c);
      if (g < lo) lo = g; if (g > hi) hi = g;
    }
    return [lo, hi];
  }
  /** a stone box `h` tall over the HIGHEST ground under it, standing 0.35 m into the LOWEST: cover that is at least h tall wherever you meet it (a turned box is cut into <= 1 m colliders by addBox) */
  function stoneBox(cx, cz, w, d, rot, h, color, opts) {
    const [lo, hi] = groundRange(cx, cz, w, d, rot), y0 = lo - 0.35, y1 = hi + h;
    addBox(cx, (y0 + y1) / 2, cz, w, y1 - y0, d, color, Object.assign({ rotY: rot || 0, tex: "block" }, opts || {}));
    return y1;
  }
  // The cosmetic style of a resort / lodge house (see houseStyle for the shapes): roof, porch / awning, chimney, trim. `sr` = the parcel's own style stream.
  function themedStyle(b, sr, PAL, roofC, fh) {
    const lodge = mapId === "deepwood", st = { storeys: 1, floorH: fh, glass: SAV.glass[Math.floor(sr() * SAV.glass.length)] };
    const two = (b.use === "house" || b.use === "shop") && b.floors >= 2 && (sr() < (lodge ? 0.6 : 0.65) || b.arch === "villa" || b.arch === "lodge2");      // (Wave 7b stage B: 0.4 / 0.5 -> 0.6 / 0.65 - a real upper floor now, see house() o.upper; villas and lodges always)
    if (two) st.storeys = 2;
    const villa = b.arch === "villa" || b.arch === "lodge2";
    const r1 = sr(), r2 = sr(), r3 = sr();
    if (lodge) {
      st.roof = b.use === "hall" || b.use === "barn" ? 0 : r1 < 0.46 ? 0 : r1 < 0.88 ? 1 : 3;
      st.chimney = b.use === "shed" ? 0 : r2 < 0.78 ? (r3 < 0.5 ? -1 : 1) : 0;
      st.chimneyC = "#6f6a62";
      st.porch = b.use !== "shed" && r3 < 0.82;
      if (b.use === "shop") { st.porch = true; st.sign = "#c9a24a"; }
      if (b.use === "hall" || b.use === "barn") st.blindBack = true;
      st.trim = 0;
    } else {
      if (b.use === "shop") { st.shopfront = true; st.roof = 2; st.awning = r1 < 0.9 ? (r2 < 0.5 ? PAL.awning[0] : PAL.awning[1]) : null; st.sign = shade(roofC, 0.9); st.unit = 0; }
      else if (b.use === "hall") { st.roof = r1 < 0.6 ? 3 : 2; st.awning = r2 < 0.5 ? PAL.awning[0] : null; }
      else if (b.use === "shed") { st.roof = r1 < 0.5 ? 0 : 1; st.porch = true; st.blindBack = true; }
      else { st.roof = r1 < 0.34 ? 3 : r1 < 0.58 ? 2 : r1 < 0.8 ? 1 : 0; st.chimney = 0; st.porch = r2 < 0.65; st.awning = r3 < 0.28 ? PAL.awning[1] : null; st.unit = 0; }
      st.trim = (b.use === "house" || b.use === "shop") ? (r3 < 0.35 ? 1 : 0) : 0;
    }
    if (villa) {                                                                       // (stage B) the villa / the two-storey lodge: a balcony across the upper floor's front, no awning or porch roof under it
      st.balcony = true; st.awning = null; st.porch = false;
      if (!lodge) { st.roof = r1 < 0.55 ? 2 : 3; st.trim = 1; st.railC = "#f4f1e8"; }        // a flat roof with a parapet or a low hip roof, a cream cornice, a white rail
      else { st.roof = r1 < 0.6 ? 0 : 1; st.railC = "#5a4430"; st.chimney = st.chimney || 1; }
    }
    return st;
  }
  // wall texture of a resort / lodge building: a lodge is all timber (plank); a resort cottage / beach hut is clapboard half the time, the shops and halls plaster ("s" at the block's tile)
  const themedWallTex = (b, v) => (mapId === "deepwood" ? "plank" : b.arch === "villa" ? "stucco" : (b.use === "shed" || (b.use === "house" && v < 0.5)) ? "plank" : "stucco");     // (resort: clapboard or smooth stucco, never brick; a villa is whitewashed stucco)

  // ── the docks village: decks over the shallows, posts down to the seabed (cosmetic), houses ON the decks (house() takes y0) ────────────────────────────────────────────
  function buildDockDecks(T) {
    const D = T.docks, top = D.top, pc = "#a8794f", dark = shade("#a8794f", 0.62);
    const decks = D.decks.map((dk) => dk.rect);
    // every deck: a 0.3 m slab (top = the deck level), exact box, plank texture
    for (const r of decks) addBox((r[0] + r[2]) / 2, top - 0.15, (r[1] + r[3]) / 2, r[2] - r[0], 0.3, r[3] - r[1], pc, { tex: "plank" });
    // the gangway: the beach at the landing may stand more than a step (0.55 m) under the deck (a low beach after the link road's corridor has been cut beside it): a 3.2 m plank ramp from the
    // lowest sand under it up to the boardwalk's first edge, so the village is never an island for a walker or a bot
    {
      const sp0 = decks[0], alongX = sp0[2] - sp0[0] > sp0[3] - sp0[1], sg = alongX ? Math.sign(D.dir[0]) : Math.sign(D.dir[1]), RL = 3.2;
      const fx = alongX ? (sg > 0 ? sp0[0] : sp0[2]) : (sp0[0] + sp0[2]) / 2, fz = alongX ? (sp0[1] + sp0[3]) / 2 : (sg > 0 ? sp0[1] : sp0[3]);
      const gx = fx - (alongX ? sg * RL / 2 : 0), gz = fz - (alongX ? 0 : sg * RL / 2);
      const lo = groundRange(gx - (alongX ? sg * 0.4 : 0), gz - (alongX ? 0 : sg * 0.4), alongX ? RL + 0.8 : 2.4, alongX ? 2.4 : RL + 0.8, 0)[0], rise = top - lo;     // (the ground 0.4 m before the foot too: the lip gate)
      if (rise > 0.12 && rise < RL) addRamp(gx, lo, gz, 2.4, rise, RL, alongX ? (sg > 0 ? 0 : 1) : (sg > 0 ? 2 : 3), "#a8794f");
    }
    // posts: down to the seabed (0.3 m into it) at the corners and every 4 m round every deck, each reaching the ground under ITSELF; cosmetic (a swimmer is not worth a collider)
    const seen = new Set();
    const post = (x, z) => {
      const k = Math.round(x * 2) + "," + Math.round(z * 2);
      if (seen.has(k)) return;
      seen.add(k);
      const g = heightAt0(x, z) - 0.3;
      if (top - 0.3 - g > 0.25) addBox(x, (g + top - 0.3) / 2, z, 0.32, top - 0.3 - g, 0.32, dark, { collide: false });
    };
    for (const r of decks) {
      const nx = Math.max(1, Math.round((r[2] - r[0]) / 4)), nz = Math.max(1, Math.round((r[3] - r[1]) / 4));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { if (i && j && i < nx && j < nz) continue; post(r[0] + 0.3 + (r[2] - r[0] - 0.6) * i / nx, r[1] + 0.3 + (r[3] - r[1] - 0.6) * j / nz); }
    }
    // a low kerb board along the two long sides of the spine so the boardwalk reads as one (cosmetic)
    const sp = decks[0], alongX = sp[2] - sp[0] > sp[3] - sp[1];
    for (const side of [0, 1]) {
      if (alongX) addBox((sp[0] + sp[2]) / 2, top + 0.25, side ? sp[3] - 0.1 : sp[1] + 0.1, sp[2] - sp[0], 0.5, 0.15, shade(pc, 0.8), { collide: false });
      else addBox(side ? sp[2] - 0.1 : sp[0] + 0.1, top + 0.25, (sp[1] + sp[3]) / 2, 0.15, 0.5, sp[3] - sp[1], shade(pc, 0.8), { collide: false });
    }
    // the head of the boardwalk: a chest and a floor item (what pier() always gave a dock)
    const head = D.decks.find((dk) => dk.role === "head");
    if (head) { const r = head.rect, mx = (r[0] + r[2]) / 2, mz = (r[1] + r[3]) / 2; loot(mx, top + 0.5, mz, T.id); chest(mx + (alongX ? 0 : 3), top + 0.6, mz + (alongX ? 3 : 0), T.id); }
  }

  // ── the crater-rim village ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** A ruined stone house: the walls of house() (door 2.26 m, a window opening in each side wall, a back breach half the time) built in segments, the roofed half whole and the other half
   *  broken down to 1.3-3.0 m, a roof deck over the whole half only (so nothing floats and the room stays a room), rubble beside the breaches, the loot of any house. `rr` = the
   *  building's own sub-RNG (nothing here touches the shared stream except the loot rolls, made last in a fixed order). */
  function ruinHouse(x, z, w, d, rot, wallC, roofC, poiId, rr, o) {
    const H = 3.4, T = 0.34, doorW = 2.26, winW = 1.2, WT = { tex: "block" };
    const rc = Math.abs(Math.cos(rot)), rs = Math.abs(Math.sin(rot));
    const y = groundPad(x, z, (rc * (w + 0.7) + rs * (d + 0.7)) / 2 + 0.05, (rs * (w + 0.7) + rc * (d + 0.7)) / 2 + 0.05, { gen: "house" });
    const roofSide = rr() < 0.5 ? -1 : 1;                       // the half that keeps its roof: local x > -0.12 w (right) or x < 0.12 w (left)
    const under = (u0, u1) => (roofSide > 0 ? u1 > -0.12 * w : u0 < 0.12 * w);          // does a front / back wall segment [u0, u1] stand under the roof deck?
    // one front / back wall segment on the wall at local z = v: whole under the roof, otherwise whole 40 % of the time and else broken down to 1.3 - 3.0 m
    const seg = (u0, u1, v) => {
      if (u1 - u0 < 0.15) return H;
      const full = under(u0, u1) || rr() < 0.4, hb = full ? H : 1.3 + rr() * 1.7;
      addBoxR(x, z, (u0 + u1) / 2, v, y + hb / 2, u1 - u0, hb, T, wallC, rot, WT);
      return hb;
    };
    const fL = seg(-w / 2, -doorW / 2, d / 2), fR = seg(doorW / 2, w / 2, d / 2);
    if (fL === H && fR === H) addBoxR(x, z, 0, d / 2, y + 3.05, doorW, 0.7, T, wallC, rot, WT);
    if (rr() < 0.5) { const bu = (rr() - 0.5) * (w - 4.6); seg(-w / 2, bu - 1.3, -d / 2); seg(bu + 1.3, w / 2, -d / 2); }          // a 2.6 m breach in the back wall
    else { seg(-w / 2, 0, -d / 2); seg(0, w / 2, -d / 2); }
    for (const sx of [-1, 1]) {                                                                              // side walls: a window opening in the middle; the one under the roof is whole
      const side = (u0, u1) => {
        const full = sx === roofSide || rr() < 0.3, hb = full ? H : 1.3 + rr() * 1.7;
        addBoxR(x, z, sx * w / 2, (u0 + u1) / 2, y + hb / 2, T, hb, u1 - u0, wallC, rot, WT);
        return hb;
      };
      const a = side(-d / 2, -winW / 2), b2 = side(winW / 2, d / 2);
      addBoxR(x, z, sx * w / 2, 0, y + 0.6, T, 1.2, winW, wallC, rot, WT);
      if (a === H && b2 === H) addBoxR(x, z, sx * w / 2, 0, y + 2.3 + (H - 2.3) / 2, T, H - 2.3, winW, wallC, rot, WT);
    }
    // the roof deck over the roofed 62 % (w * 0.62 + 0.35 wide, the full depth + 0.7, resting on the whole walls)
    const rw = w * 0.62 + 0.35, ru = roofSide * (w / 2 - rw / 2 + 0.35);
    addBoxR(x, z, ru, 0, y + H + 0.15, rw, 0.3, d + 0.7, roofC, rot, { tex: "shingle" });
    // rubble just outside: three blocks 1.2 - 1.7 m tall on the broken side (cover; clear of the walls)
    const cr = Math.cos(rot), sr2 = Math.sin(rot);
    for (let k = 0; k < 3; k++) {
      const su = -roofSide * (0.2 + rr() * 0.3) * w, sv = (rr() < 0.5 ? -1 : 1) * (d / 2 + 1.7 + rr() * 1.4), bw = 1.4 + rr() * 1.0, bh = 1.2 + rr() * 0.5, tn = 0.86 + rr() * 0.14;
      stoneBox(x + su * cr + sv * sr2, z - su * sr2 + sv * cr, bw, bw * 0.8, rot, bh, shade(wallC, tn));
    }
    if (o && o.loot != null) {
      if (rng() < o.loot) loot(x, y + 0.5, z, poiId);
      if (rng() < o.chest) chest(x + (rng() - 0.5) * w * 0.4, y + 0.6, z + (rng() - 0.5) * d * 0.4, poiId);
    } else { loot(x, y + 0.5, z, poiId); if (rng() < 0.5) chest(x + (rng() - 0.5) * w * 0.4, y + 0.6, z + (rng() - 0.5) * d * 0.4, poiId); }
    return y;
  }
  // the terrace plots' pads, the plaza's, and the village's footprints (the wilderness keeps out of them); runs from registerCityExtras, before any building
  function registerCrater(T) {
    const C = T.crater;
    for (const p of C.plots) { const r = p.rect; groundPad((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, { gen: "terrace", level: p.level }); cityFoot.push([r[0] - 5, r[1] - 5, r[2] + 5, r[3] + 5]); }
    groundPad(C.plaza.x, C.plaza.z, C.plaza.r, C.plaza.r, { gen: "plaza", level: C.plaza.level });
    // the four stair lines are graded like roads (a 3.6 m bed, the profile smoothed along the line, level across it): the 8 m ramps laid on them then meet the ground at both ends and have no
    // cross-slope to be half buried in on the cone's lumps and the terraces' cut banks
    for (const st of C.stairs) registerCorridor([[st.cx + st.dx * st.r0, st.cz + st.dz * st.r0], [st.cx + st.dx * st.r1, st.cz + st.dz * st.r1]], 3.6, { falloff: 3 });
    cityFoot.push([C.plaza.x - 22, C.plaza.z - 22, C.plaza.x + 22, C.plaza.z + 22]);
    for (const q of C.pieces) cityFoot.push([q.x - 3, q.z - 3, q.x + 3, q.z + 3]);
    for (const q of C.arches) cityFoot.push([q.x - 5, q.z - 5, q.x + 5, q.z + 5]);
    for (const q of C.towers || []) cityFoot.push([q.x - 5, q.z - 5, q.x + 5, q.z + 5]);
  }
  /** the walls, arches, plaza and free pieces of the crater village (after its houses): all exact stone boxes (the free fragments turned), cover wherever you meet them */
  function buildCrater(T) {
    const C = T.crater, col = RUIN_STONE, pr = TG_subRng(T.id, "pieces");
    useDistrict("town:" + T.id);
    for (const w of C.walls) {
      const c = col[Math.floor(pr() * col.length)];
      if (w.axis === 0) stoneBox(w.x, w.z, w.len, w.th, 0, w.h, c); else stoneBox(w.x, w.z, w.th, w.len, 0, w.h, c);
    }
    // broken arches: two pillars and a lintel over the 3.4 m gap, the lintel's underside >= 2.6 m over the highest ground under the gateway; a broken one has a short pillar and half a lintel
    for (const a of C.arches) {
      const c = col[Math.floor(pr() * col.length)], sepX = a.axis === 0, off = a.gap / 2 + 0.6;
      const p0 = sepX ? [a.x - off, a.z] : [a.x, a.z - off], p1 = sepX ? [a.x + off, a.z] : [a.x, a.z + off];
      const [g0, h0] = groundRange(p0[0], p0[1], 1.2, 1.2, 0), [g1, h1] = groundRange(p1[0], p1[1], 1.2, 1.2, 0), hi = Math.max(h0, h1, heightAt0(a.x, a.z));       // (a pillar stands 0.35 m into the LOWEST ground under its 1.2 m foot)
      const lintelBottom = hi + 2.6, lintelTop = lintelBottom + 0.9;
      addBox(p0[0], (g0 - 0.35 + lintelTop) / 2, p0[1], 1.2, lintelTop - g0 + 0.35, 1.2, c, { tex: "block" });
      const top1 = a.broken ? h1 + 2.1 : lintelTop;
      addBox(p1[0], (g1 - 0.35 + top1) / 2, p1[1], 1.2, top1 - g1 + 0.35, 1.2, c, { tex: "block" });
      const s0 = (sepX ? p0[0] : p0[1]) - 0.6, s1 = a.broken ? (sepX ? a.x : a.z) + 0.4 : (sepX ? p1[0] : p1[1]) + 0.6, len = s1 - s0, mid = (s0 + s1) / 2;
      addBox(sepX ? mid : a.x, lintelBottom + 0.45, sepX ? a.z : mid, sepX ? len : 1.2, 0.9, sepX ? 1.2 : len, shade(c, 0.92), { tex: "block" });
    }
    // the plaza: eight broken columns round an altar of three steps with two chests
    const P = C.plaza;
    for (const q of P.columns) stoneBox(q[0], q[1], 0.9, 0.9, 0, q[2], col[Math.floor(pr() * col.length)]);
    const ax = P.altar.x, az = P.altar.z, y0 = heightAt0(ax, az);
    addBox(ax, y0 + 0.2, az, 5.0, 0.4, 4.0, "#a49d8f", { tex: "block" }); addBox(ax, y0 + 0.65, az, 3.6, 0.5, 2.8, "#9a9488", { tex: "block" }); addBox(ax, y0 + 1.15, az, 2.2, 0.5, 1.6, "#8f8a80", { tex: "block" });
    chest(ax - 0.5, y0 + 1.4, az, T.id); chest(ax + 0.5, y0 + 1.4, az, T.id); loot(ax, y0 + 0.5, az + 3.2, T.id); loot(ax, y0 + 0.5, az - 3.2, T.id);
    // the free pieces
    useDistrict("town:" + T.id);
    for (const q of C.pieces) {
      const c = col[Math.floor(pr() * col.length)], tint = shade(c, 0.82 + Math.floor(pr() * 4) * 0.06);
      stoneBox(q.x, q.z, q.w, q.d, q.rot, q.h, q.kind === "column" ? c : tint);
    }
    // (stage B) the ruined watchtowers: a hollow 4.6 m stone shaft, 0.5 m walls from 0.35 m into the lowest ground to `h` over the highest, a 2.3 m doorway toward the axis (a lintel over it), a
    // slit window on each other side; a broken one has lost a corner of its top; merlons on the rest of the rim (cosmetic); a floor item inside. Exact boxes.
    for (const tw of C.towers || []) {
      const [lo, hi] = groundRange(tw.x, tw.z, tw.w, tw.w, 0), y0 = lo - 0.35, top = hi + tw.h, Wt = tw.w, t = 0.5, c = RUIN_STONE[Math.floor(pr() * RUIN_STONE.length)], sh = shade(c, 0.9);
      const face = tw.face;                                            // 0 +z, 1 +x, 2 -z, 3 -x: the wall with the door
      for (let k = 0; k < 4; k++) {
        const nx = [0, 1, 0, -1][k], nz = [1, 0, -1, 0][k], cx = tw.x + nx * (Wt / 2 - t / 2), cz = tw.z + nz * (Wt / 2 - t / 2), along = nx ? Wt : Wt;      // the wall facing (nx, nz)
        const wx = nx ? t : along, wz = nx ? along : t, wallTop = tw.broken && k === (face + 2) % 4 ? hi + tw.h * 0.6 : top;
        if (k === face) {                                              // the doorway: two jambs and a lintel
          const jl = (Wt - 2.3) / 2;
          for (const sd of [-1, 1]) { const ox = nx ? 0 : sd * (2.3 / 2 + jl / 2), oz = nx ? sd * (2.3 / 2 + jl / 2) : 0; addBox(cx + ox, (y0 + wallTop) / 2, cz + oz, nx ? t : jl, wallTop - y0, nx ? jl : t, c, { tex: "block" }); }
          addBox(cx, (hi + 2.6 + wallTop) / 2, cz, nx ? t : 2.3, wallTop - hi - 2.6, nx ? 2.3 : t, sh, { tex: "block" });
        } else addBox(cx, (y0 + wallTop) / 2, cz, wx, wallTop - y0, wz, c, { tex: "block" });
        if (k !== face) addBox(cx + nx * 0.03, hi + tw.h * 0.55, cz + nz * 0.03, nx ? t + 0.04 : 0.35, 1.2, nx ? 0.35 : t + 0.04, "#2a2622", { collide: false });   // a dark slit window
      }
      for (const [mx, mz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {   // merlons round the rim (not on the broken side)
        const bx = tw.x + mx * (Wt / 2 - 0.35), bz = tw.z + mz * (Wt / 2 - 0.35);
        const bk = (face + 2) % 4;                                     // the broken wall: 0 +z, 1 +x, 2 -z, 3 -x
        if (tw.broken && (bk === 0 ? mz > 0 : bk === 2 ? mz < 0 : bk === 1 ? mx > 0 : mx < 0)) continue;
        addBox(bx, top + 0.45, bz, 0.7, 0.9, 0.7, sh, { collide: false, tex: "block" });
      }
      loot(tw.x, heightAt0(tw.x, tw.z) + 0.5, tw.z, T.id);
    }
    // (stage B) the braziers along the stair lines: a 1.0 m stone pedestal (an exact collider), an iron bowl, a fire (emissive: the near-lamp pool lights it at dusk)
    for (const bz of C.braziers || []) {
      const top = stoneBox(bz[0], bz[1], 0.7, 0.7, 0, 1.0, "#7d786d");
      addBox(bz[0], top + 0.12, bz[1], 0.95, 0.24, 0.95, "#3a3430", { collide: false });
      flameAt(bz[0], top + 0.2, bz[1], 1, "#ffb050", pr() * Math.PI);                 // (LC-73: a flame with tongues, was one 6-sided cone; same batch, same draw)
      lampPts.push({ x: bz[0], y: top + 0.6, z: bz[1] });
    }
    // the stair flights: the four axis lines through the volcano's axis, from the outer ring to the plaza, in 8 m ramps that follow the ground (the foot of each on the lowest ground
    // under its width, its top on the ground at the next station: so the flight is one continuous staircase hugging the slope, never a viaduct, and no piece climbs more than its run)
    useDistrict("town:" + T.id);
    for (const st of C.stairs) {
      const ux = st.dx, uz = st.dz, px = -uz, pz = ux, RUN = 4, n = Math.floor((st.r1 - st.r0) / RUN);
      const gAt = (r) => { let lo = Infinity; for (let k = -2; k <= 2; k++) { const g = heightAt0(st.cx + ux * r + px * k * 0.55, st.cz + uz * r + pz * k * 0.55); if (g < lo) lo = g; } return lo; };
      for (let k = 0; k < n; k++) {
        const ra = st.r0 + k * RUN, rb = ra + RUN, ga = gAt(ra), gb = gAt(rb), up = gb > ga;                // the ramp rises toward the far end (rb) when that is the higher
        // the foot stands 9 cm over the lowest ground under its width 0.3 m BEFORE its edge (the collision gate reads the ground there: a foot at the edge's own level hangs slope x 0.3 m over it
        // on a 30 degree slope; 9 cm is under its 10 cm lip bar, and the walker descending still reaches the foot within the worldlive tolerance); the top meets the ground at the other station
        const foot = (up ? gAt(ra - 0.3) : gAt(rb + 0.3)) + 0.0, topG = up ? gb : ga, rise = topG - foot;
        if (rise < 0.3 || rise > RUN * 0.92) continue;                                                // (flat; or steeper than the run's 43 degrees: the bare slope is the way there)
        const mx = st.cx + ux * (ra + rb) / 2, mz = st.cz + uz * (ra + rb) / 2;
        const dirV = up ? [ux, uz] : [-ux, -uz], dir = dirV[0] > 0 ? 0 : dirV[0] < 0 ? 1 : dirV[1] > 0 ? 2 : 3;
        addRamp(mx, foot, mz, 2.4, rise, RUN, dir, "#8f8a80");
      }
    }
  }
  // ── Wave 7b stage B: cosmetic geometry at any pose (no collider: the colliders go in beside them as exact boxes) ──────────────────────────────────────────────────────────
  // A box, a cylinder (a log: its cut ends a lighter colour) or a gable prism under a world matrix, into the current sink with the same batch keys as addBox (so a district stays one
  // mesh per texture kind). Used where a box on the axes cannot draw the shape: a water wheel, round logs, a pitched roof, a boulder.
  const _gM = new THREE.Matrix4(), _gR = new THREE.Matrix4(), _gT = new THREE.Matrix4(), _vA = new THREE.Vector3();
  function boxAt(m, w, h, d, color, tex, out) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, structTile);
    geo.applyMatrix4(m);
    if (out) out.push([geo, color]); else pushGeo(color + "|" + (tex || "s"), geo);
    return geo;
  }
  function cylAt(m, r, len, seg, color, tex, capColor) {
    const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, true), uv = geo.attributes.uv, su = 2 * Math.PI * r / structTile, sv = len / structTile;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    geo.applyMatrix4(m);
    pushGeo(color + "|" + (tex || "s"), geo);
    if (capColor) for (const sg of [1, -1]) {
      const cap = new THREE.CircleGeometry(r, seg), cu = cap.attributes.uv;
      cap.rotateX(sg > 0 ? -Math.PI / 2 : Math.PI / 2); cap.translate(0, sg * len / 2, 0);
      for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * 2 * r / structTile, cu.getY(i) * 2 * r / structTile);
      cap.applyMatrix4(m);
      pushGeo(capColor + "|" + (tex || "s"), cap);
    }
  }
  /** a gable roof: a prism w wide (x), h high (apex at y = h, base at y = 0), d long (z, the ridge), flat-shaded, indexed (it merges with the boxes) */
  function prismGeo(w, h, d) {
    const hw = w / 2, hd = d / 2, sl = Math.hypot(hw, h), nx = h / sl, ny = hw / sl;
    const pos = [], nor = [], uv = [], idx = [];
    const quad = (a, b, c, e, n, uw, uh) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...e); for (let i = 0; i < 4; i++) nor.push(...n); uv.push(0, 0, uw, 0, uw, uh, 0, uh); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    const tri = (a, b, c, n) => { const k = pos.length / 3; pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) nor.push(...n); uv.push(0, 0, w / structTile, 0, w / 2 / structTile, h / structTile); idx.push(k, k + 1, k + 2); };
    quad([-hw, 0, hd], [-hw, 0, -hd], [0, h, -hd], [0, h, hd], [-nx, ny, 0], d / structTile, sl / structTile);      // the -x slope (outward normal up and to -x)
    quad([hw, 0, -hd], [hw, 0, hd], [0, h, hd], [0, h, -hd], [nx, ny, 0], d / structTile, sl / structTile);        // the +x slope
    tri([-hw, 0, hd], [0, h, hd], [hw, 0, hd], [0, 0, 1]);                                                           // the gable ends
    tri([hw, 0, -hd], [0, h, -hd], [-hw, 0, -hd], [0, 0, -1]);
    quad([-hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd], [0, -1, 0], w / structTile, d / structTile);       // the soffit
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  /** the colliders under a gable roof (base y0, ridge along the z of a quarter-turned frame): `n` stacked boxes, each as wide as the roof is at its middle height (the drawn slope is within h / 2n of them) */
  function gableColliders(cx, cz, w, d, alongX, y0, h, n) {
    for (let k = 0; k < n; k++) {
      const yb = y0 + h * k / n, ym = h * (k + 0.5) / n, ww = w * (1 - ym / h);
      if (ww < 0.4) continue;
      boxColliders(cx, yb + h / n / 2, cz, alongX ? d : ww, h / n, alongX ? ww : d, 0);
    }
  }
  // ── Wave 7b stage B: the themed towns' street life (Isla Viva: a beach bar, a pool deck, café umbrellas at the shops; Deepwood: a campfire circle, a woodyard) ──────────────────────
  // The layout's lots are parking / park / yard on every themed map (towngen); here a resort town's park becomes a beach bar and its yard a pool deck (the pool is a decal of buildCityGround),
  // a lodge town's park a campfire circle and its yard a woodyard. Everything is boxes, cones and cylinders in the town's district (no draw call of its own); what a player can walk into or
  // land on collides (a counter, a back bar, the thatch over a kiosk as stacked boxes, the log piles, the stools are too small to matter). The dice are each lot's own sub-stream.
  /** a cone (apex up) or a 4-sided pyramid (seg 4), base at y, cosmetic */
  function coneAt(x, y, z, r, h, seg, color, rotY, tex) {
    const geo = new THREE.ConeGeometry(r, h, seg, 1, false), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r / structTile, uv.getY(i) * h / structTile);
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y + h / 2, z);
    pushGeo(color + "|" + (tex || "s"), geo);
  }
  // LC-73: a fire as a flame, not a cone - a lathed body (a round belly that narrows to a licking tip) and three smaller tongues leaning out round it, in
  // the same emissive batch the cone was in (0 extra draw calls). No random draw: the tongues' turn is the caller's rotY.
  const FLAME_P = [[0, 0], [0.22, 0.05], [0.33, 0.17], [0.31, 0.31], [0.2, 0.5], [0.09, 0.72], [0, 0.98]];
  function flameAt(x, y, z, sc, color, rotY) {
    const mk = (k) => new THREE.LatheGeometry(FLAME_P.map((q) => new THREE.Vector2(q[0] * k * sc, q[1] * k * sc)), 9);
    const body = mk(1); body.rotateY(rotY || 0); body.translate(x, y, z); pushGeo(color + "|s", body);
    for (let t = 0; t < 3; t++) {
      const a = (rotY || 0) + t * 2.094, g = mk(0.52 + 0.1 * t);
      g.rotateZ(0.32); g.translate(0.15 * sc, 0, 0); g.rotateY(a); g.translate(x, y + 0.02, z);
      pushGeo(color + "|s", g);
    }
  }
  /** a café / beach umbrella over a little table with two chairs, standing on the ground at (x, z) (cosmetic: a pole you walk round, like the street furniture) */
  function umbrella(x, z, color, rr, table) {
    const gr = heightAt0(x, z), g0 = gr + CITY_SW_LIFT - 0.02, NC = { collide: false };
    addBox(x, (gr - 0.05 + g0 + 2.4) / 2, z, 0.09, g0 + 2.4 - gr + 0.05, 0.09, "#e8e4da", NC);                 // (the pole reaches through the paving into the ground)
    coneAt(x, g0 + 2.0, z, 1.3, 0.55, 8, color, rr() * Math.PI);
    coneAt(x, g0 + 2.55, z, 0.12, 0.18, 6, shade(color, 0.8));
    if (!table) return;
    addBox(x, g0 + 0.74, z, 0.8, 0.06, 0.8, "#f2efe6", NC);
    for (const [cx, cz] of [[0.75, 0], [-0.75, 0]]) { const a = rr() * 0.6 - 0.3, px = x + cx * Math.cos(a), pz = z + cx * Math.sin(a) + cz, pg = heightAt0(px, pz) - 0.04; addBox(px, (pg + g0 + 0.46) / 2, pz, 0.42, g0 + 0.46 - pg, 0.42, "#d9d2c0", NC); }
  }
  function lounger(x, z, rot, color) {
    const gr = heightAt0(x, z) - 0.04, g0 = gr + 0.04 + CITY_SW_LIFT - 0.02;
    addBox(x, (gr + g0 + 0.36) / 2, z, 0.7, g0 + 0.36 - gr, 1.9, color, { collide: false, rotY: rot });
    const c = Math.cos(rot), s = Math.sin(rot);
    addBox(x + 0.75 * s, g0 + 0.45, z + 0.75 * c, 0.7, 0.5, 0.4, color, { collide: false, rotY: rot });
  }
  function themedLots(T, did) {
    const resort = mapId === "isla_viva", NC = { collide: false };
    const kitPts = city.kit.filter((e) => e.district === did).map((e) => [e.x, e.z]);
    const clearOfKit = (x, z, r) => { for (const q of kitPts) if ((q[0] - x) * (q[0] - x) + (q[1] - z) * (q[1] - z) < r * r) return false; return true; };
    for (const p of T.parcels) {
      const rr = TG_subRng(T.id, "tl" + p.id), r = p.rect, cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, w = r[2] - r[0], d = r[3] - r[1];
      const [fx, fz] = p.facing, y0 = heightAt0(cx, cz) + CITY_SW_LIFT;
      if (p.use === "lot" && w >= 12 && d >= 12) {
        if (resort && (p.lot === "park" || (p.lot === "parking" && (city.TG.hash32(T.id + ":" + p.id) & 1)))) {          // (half the car parks too: a resort has few lots)
          // the beach bar: a kiosk (counter to the street, a back bar, four posts, a thatched pyramid roof), four stools, two umbrellas with tables, two loungers
          const ux = fz ? 1 : 0, uz = fz ? 0 : 1, vx = fx, vz = fz;                        // u along the frontage, v toward the street
          const P = (u, v) => [cx + ux * u + vx * v, cz + uz * u + vz * v];
          const box = (u, v, yc, bu, h, bv, col, o) => {                                      // (a box standing on the paving reaches through it to the ground under it)
            const q = P(u, v);
            let c = y0 + yc, hh = h;
            if (yc - h / 2 < 0.06) { const g = Math.min(heightAt0(q[0], q[1]), heightAt0(q[0] + (ux ? bu : bv) / 2, q[1] + (ux ? bv : bu) / 2), heightAt0(q[0] - (ux ? bu : bv) / 2, q[1] - (ux ? bv : bu) / 2)) - 0.05, top = y0 + yc + h / 2; c = (g + top) / 2; hh = top - g; }
            addBox(q[0], c, q[1], ux ? bu : bv, hh, ux ? bv : bu, col, o);
          };
          box(0, 1.2, 0.55, 3.6, 1.1, 0.6, "#a8794f", { tex: "plank" });
          box(0, -1.1, 0.9, 3.6, 1.8, 0.45, "#8a6a48", { tex: "plank" });
          box(0, 1.2, 1.13, 3.8, 0.06, 0.75, "#f2efe6", NC);
          for (const [u, v] of [[-1.9, 1.5], [1.9, 1.5], [-1.9, -1.4], [1.9, -1.4]]) box(u, v, 1.3, 0.16, 2.6, 0.16, "#7a5a3a", NC);
          coneAt(cx, y0 + 2.6, cz, 3.25, 1.5, 4, "#d6b36a", Math.PI / 4);
          for (let k = 0; k < 3; k++) { const ym = (k + 0.5) / 3, sz = 4.4 * (1 - ym); boxColliders(cx, y0 + 2.6 + 0.5 * k + 0.25, cz, sz, 0.5, sz, 0); }   // (the pyramid: three square tiers under it)
          for (const u of [-1.2, -0.4, 0.4, 1.2]) { const q = P(u, 2.1), g = heightAt0(q[0], q[1]) + CITY_SW_LIFT; _gT.makeTranslation(q[0], g + 0.36, q[1]); cylAt(_gT, 0.2, 0.72, 8, "#c9a46a", "plank"); }
          const AW = SAV.awnings;
          for (const [u, v] of [[-4.4, 4.2], [4.4, 4.0]]) { const q = P(u, v); if (Math.abs(u) < w / 2 - 1.5) umbrella(q[0], q[1], AW[Math.floor(rr() * AW.length)], rr, true); }
          for (const u of [-3.2, 3.2]) { const q = P(u, -4.6); lounger(q[0], q[1], Math.atan2(vx, vz) + Math.PI, "#f4f1e8"); }
          city.landmarks.push({ kind: "beachbar", town: T.id, x: cx, z: cz });
        } else if (resort && p.lot === "yard") {
          // the pool deck (the pool and its rim are drawn by buildCityGround): loungers and umbrellas along its two long sides
          const px0 = r[0] + 3.5, px1 = r[2] - 3.5, pz0 = r[1] + 3.5, pz1 = r[3] - 3.5, alongX = px1 - px0 >= pz1 - pz0;
          const n = Math.max(2, Math.min(4, Math.floor((alongX ? px1 - px0 : pz1 - pz0) / 4)));
          for (const sd of [-1, 1]) for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            const x = alongX ? px0 + (px1 - px0) * t : (sd < 0 ? px0 - 1.7 : px1 + 1.7), z = alongX ? (sd < 0 ? pz0 - 1.7 : pz1 + 1.7) : pz0 + (pz1 - pz0) * t;
            if (k % 2) lounger(x, z, alongX ? 0 : Math.PI / 2, "#f4f1e8"); else umbrella(x, z, SAV.awnings[Math.floor(rr() * SAV.awnings.length)], rr, false);
          }
          city.landmarks.push({ kind: "pool", town: T.id, x: cx, z: cz });
        } else if (!resort && p.lot === "park") {
          // the campfire circle: a ring of stones round a fire of three logs over embers, four log benches round it
          for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, x = cx + Math.cos(a) * 1.0, z = cz + Math.sin(a) * 1.0; addBox(x, y0 + 0.08, z, 0.4, 0.3, 0.32, RUIN_STONE[k % RUIN_STONE.length], { collide: false, rotY: a, tex: "block" }); }
          { const gl = Math.min(heightAt0(cx - 0.7, cz - 0.7), heightAt0(cx + 0.7, cz + 0.7), heightAt0(cx - 0.7, cz + 0.7), heightAt0(cx + 0.7, cz - 0.7)) - 0.04; addBox(cx, (gl + y0 + 0.05) / 2, cz, 1.4, y0 + 0.05 - gl, 1.4, "#3a3530", NC); }
          addBox(cx, y0 + 0.1, cz, 0.7, 0.12, 0.7, "#e8742c", NC);
          for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + rr(); _gT.makeTranslation(cx + Math.cos(a) * 0.28, y0 + 0.45, cz + Math.sin(a) * 0.28); _gR.makeRotationAxis(_vA.set(-Math.sin(a), 0, Math.cos(a)), 0.55); cylAt(_gT.multiply(_gR), 0.09, 1.1, 6, "#5e4128", "plank", "#c49c62"); }
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; fallenLog({ x: cx + Math.cos(a) * 3.4, z: cz + Math.sin(a) * 3.4, w: 2.6, d: 0.62, rot: a + Math.PI / 2 }, "#6b4a2e"); }
          city.landmarks.push({ kind: "campfire", town: T.id, x: cx, z: cz });
        } else if (!resort && p.lot === "yard") {
          // the woodyard: two round log piles, a chopping stump with an axe in it, a sawhorse
          const alongX = w >= d;
          logPile({ x: cx + (alongX ? -3.2 : 0), z: cz + (alongX ? 0 : -3.2), w: 3.6, d: 1.7, rot: alongX ? 0 : Math.PI / 2 }, "#6b4a2e", rr);
          logPile({ x: cx + (alongX ? 2.2 : 2.6), z: cz + (alongX ? 2.6 : 2.2), w: 3.2, d: 1.6, rot: alongX ? Math.PI / 2 : 0 }, "#5e4128", rr);
          const sx = cx + (alongX ? 2.6 : -2.6), sz = cz + (alongX ? -2.4 : 2.6), sg = heightAt0(sx, sz) + CITY_SW_LIFT - 0.05;
          _gT.makeTranslation(sx, sg + 0.32, sz); cylAt(_gT, 0.38, 0.64, 10, "#6b4a2e", "plank", "#c9a46a");
          boxColliders(sx, sg + 0.32, sz, 0.6, 0.64, 0.6, 0);
          city.landmarks.push({ kind: "woodyard", town: T.id, x: cx, z: cz });
        }
        continue;
      }
      // café umbrellas: a resort shop puts two on the sidewalk in front of it, either side of its door (clear of the kit's lights, benches and hydrants)
      const b = p.building;
      if (!resort || !b || p.use !== "shop" || b.gen === "shell") continue;
      const fxw = b.facing[0], fzw = b.facing[1], ux = fzw ? 1 : 0, uz = fzw ? 0 : 1;
      const edge = fzw ? (fzw > 0 ? r[3] : r[1]) : (fxw > 0 ? r[2] : r[0]);
      for (const sgn of [-1, 1]) {
        const u = sgn * Math.min(3.0, b.w / 2 - 0.6), x = (fzw ? b.cx + ux * u : edge + fxw * 1.5), z = (fzw ? edge + fzw * 1.5 : b.cz + uz * u);
        if (!clearOfKit(x, z, 2.2)) continue;
        umbrella(x, z, SAV.awnings[Math.floor(rr() * SAV.awnings.length)], rr, true);
      }
    }
  }
  const millWheels = [];          // the turning wheels: [{ geos: [[geo, colour]], pivot, axis }] - meshes made after the merge (their material is the plank structure material)
  // ── the mill-and-bridge village (Deepwood): terrace plots on both banks like the crater's, a road bridge, the water mill, a mill hall, round log piles and boulders ────────────
  function registerMill(T) {
    const M = T.mill;
    for (const p of M.plots) { const r = p.rect; groundPad((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, { gen: "terrace", level: p.level }); cityFoot.push([r[0] - 5, r[1] - 5, r[2] + 5, r[3] + 5]); }
    cityFoot.push(M.axis === 0 ? [M.deck[0] - 10, M.deck[1] - 4, M.deck[2] + 10, M.deck[3] + 4] : [M.deck[0] - 4, M.deck[1] - 10, M.deck[2] + 4, M.deck[3] + 10]);
    cityKeepClear.push(M.axis === 0 ? [M.deck[0] - 4, M.deck[1] - 24, M.deck[2] + 4, M.deck[3] + 24] : [M.deck[0] - 24, M.deck[1] - 4, M.deck[2] + 24, M.deck[3] + 4]);   // (a launch ring stood 7 m off the s1 deck end: it flings whoever walks off the bridge)
    for (const q of M.pieces) cityFoot.push([q.x - 3, q.z - 3, q.x + 3, q.z + 3]);
    if (M.wheel) { const r = M.wheel.rect; cityFoot.push([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3]); }     // (the water mill: the wilderness keeps out)
    planBridge(M);
  }
  /** (Wave 7b stage C) The bridge is fitted to its banks HERE, at registration (before anything round it is built): the wet interval [a, b] round the layout's middle on the ground as it is
   *  now (base + road corridors + the plots' terrace pads), the deck level `top`, and a STAGGERED end on each bank. Stage B ran the whole 8.5 m deck out to where its CENTRELINE met the
   *  bank; the river runs ~30 degrees off any quarter turn, so the bank's contour crosses the deck's width diagonally (5 m along the deck over its 8.5 m), and one outer lane ended 0.6-1.8 m
   *  over the ground (a walker stood under the deck's end face, in the water) while the other ran 1-3 m into the bank. Now the deck is cut into NSTRIP strips across its width and each strip
   *  runs out from the river's middle until ITS OWN lanes meet the bank (the highest of three sub-lanes within 0.05 m of the deck top), then 0.1 m on: every lane of the full width leaves
   *  the deck onto its own bank within a step (the deck end follows the bank like planks cut to fit), and the banks are not touched (only the channel bed under the deck, below) - a levelled landing was tried first and its falloff
   *  (3-7 m cuts on these steep valley sides) filled the channel and dammed the river beside the bridge. (t = along the deck: z for a N-S bridge (M.axis 0), x for an E-W one.) */
  const NSTRIP = 12;                                        // (0.71 m strips: the bank rises <= 0.2 m across one)
  function planBridge(M) {
    const ax = M.a, NS = M.axis === 0, BH = (M.width || 4.5) / 2, mid = (M.water[0] + M.water[1]) / 2;
    const G = (u, t) => (NS ? heightAt0(ax + u, t) : heightAt0(t, ax + u));         // u: across the deck from its axis, t: along it
    const Gb = (u, t) => (NS ? baseH(ax + u, t) : baseH(t, ax + u));                  // the analytic ground: the river as the map carves it
    // THE CHANNEL under the deck: what makes this a bridge is the river a swimmer must swim (the endgame gate reads a bridge as >= 8 m of swim-deep water along it). Square to the river the
    // deep part of the channel is 7.5-9 m along the deck on some seeds (seed 15: 7.5 m on the lattice), so the bed under the deck is dredged: four flat pads, one per quarter of the deck's
    // width, at waterY - 2.4, each core laid on the lattice nodes INSIDE that quarter's own deep run (a rectangle is snapped OUT to the nodes: asked for as the deep run itself, plus a 1 m margin,
    // the cores reached the banks and their falloff cut them back - the deck grew to 28 m and lanes ended in the cut), a 4 m falloff that widens the deep water by a metre or two into the
    // shallows, never into a bank. They follow the river's skew quarter by quarter; one level, so their shared nodes agree. The deep run is read on the ANALYTIC ground (baseH): a link road's
    // corridor ending near a bridge head spills its falloff into the river (seed 86: the south half of the channel filled 3-4 m, 4 m of deep water left under the outer lanes), and the
    // channel under the deck is the river's, so the bed goes back to it there.
    const KL = LAT_CELLS / SIZE, nodeGE = (v) => TerrainField.node(Math.ceil((v + HALF) * KL - 1e-9)), nodeLE = (v) => TerrainField.node(Math.floor((v + HALF) * KL + 1e-9));
    const chan = [];
    for (let q = 0; q < 4; q++) {
      const u0 = -BH + (q * BH) / 2, u1 = u0 + BH / 2, um = (u0 + u1) / 2;
      let dA = null, dB = null;
      for (let t = mid - 30; t <= mid + 30 + 1e-9; t += 0.5) if (Gb(um, t) < waterY - 1.15) { if (dA === null) dA = t; dB = t; }
      if (dA === null) continue;
      const n0 = nodeGE(dA), n1 = nodeLE(dB);
      if (n1 - n0 < LAT_PITCH - 1e-6) continue;                                                       // (less than one cell of deep water in this quarter: nothing to lay on)
      const r = NS ? { x0: ax + u0, x1: ax + u1, z0: n0 + 0.01, z1: n1 - 0.01 } : { x0: n0 + 0.01, x1: n1 - 0.01, z0: ax + u0, z1: ax + u1 };
      const op = field.overlapPad(r.x0, r.x1, r.z0, r.z1);
      const h = field.registerPad(r, waterY - 2.4, 4);
      padLog.push({ gen: "bridgechannel", x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, hx: (r.x1 - r.x0) / 2, hz: (r.z1 - r.z0) / 2, h, relief: 0, fo: 4, merged: !!(op && op.pad.h !== h), cut: 0 });
      chan.push([+n0.toFixed(2), +n1.toFixed(2), op && op.pad.h !== h ? "CLASH" : ""]);
    }
    // the wet interval round the layout's middle and the deck level, on the ground as it is now (after the channel)
    const hh = (t) => G(0, t);
    let a = mid, b = mid;
    while (hh(a - 1) < waterY && mid - a < 60) a -= 1;
    while (hh(b + 1) < waterY && b - mid < 60) b += 1;
    const top = Math.min(4.5, Math.max(M.top, Math.min(hh(a - 1.5), hh(b + 1.5)) + 0.1));
    const SW = (2 * BH) / NSTRIP, strips = [];
    for (let k = 0; k < NSTRIP; k++) {
      const u0 = -BH + k * SW, u1 = u0 + SW, us = [u0 + 0.05, (u0 + u1) / 2, u1 - 0.05];
      // out until its highest sub-lane meets the deck top AND its lowest is within a step under it: a gap under a strip's end face is a wall to a walker coming off the bank (a terrain
      // cliff across one strip - the edge of a road corridor's or the channel's falloff - left one sub-lane 1.2 m under the end on 4 of 200 seeds); a corner of the run-out under the bank's
      // grass is not (the walker rises with the ground)
      const open = (t) => { const g0 = G(us[0], t), g1 = G(us[1], t), g2 = G(us[2], t); return Math.max(g0, g1, g2) < top - 0.05 || Math.min(g0, g1, g2) < top - 0.45; };
      let tA = mid, tB = mid;
      while (open(tA) && mid - tA < 60) tA -= 0.1;
      while (open(tB) && tB - mid < 60) tB += 0.1;
      strips.push({ u0, u1, tA: tA - 0.1, tB: tB + 0.1 });
    }
    let t0 = Infinity, t1 = -Infinity, cA = -Infinity, cB = Infinity;
    for (const s of strips) { if (s.tA < t0) t0 = s.tA; if (s.tB > t1) t1 = s.tB; if (s.tA > cA) cA = s.tA; if (s.tB < cB) cB = s.tB; }
    M.plan = { a, b, top, t0, t1, cA, cB, strips, chan };                 // (cA..cB: the span every strip covers - the deck's main slab)
  }
  /** the bridge (an 8.5 m timber road deck at M.top over the sea level, stone piers from the river bed, stone abutments, heavy rails, lanterns at its four corners), the water mill, the plots'
   *  retaining walls and the free pieces - round log piles, fallen logs, boulders (after the houses) */
  function buildMill(T) {
    const M = T.mill, col = RUIN_STONE, pr = TG_subRng(T.id, "pieces");
    useDistrict("town:" + T.id);                                    // (one district per endgame village: the bridge, walls, pieces and houses were four - 6-8 draw calls more in every endgame view)
    // the deck is fitted to the ground AS IT IS NOW (the base ground plus every pad and road corridor registered so far - the plots' pads and the link road to the bridge head move the
    // banks by a metre or three): the wet interval round the layout's middle, the level over it (1.8 m, higher when the banks at the water's edge stand higher), the ends where the ground meets it
    // (t = the coordinate along the deck: z for a N-S bridge (M.axis 0), x for an E-W one; `ax` = the fixed one)
    // (stage C: the wet interval, the level and the staggered ends are planned at registration - planBridge)
    const ax = M.a, NS = M.axis === 0;
    const BW = M.width || 4.5, BH = BW / 2;                        // (Wave 7b stage B: an 8.5 m road bridge, was a 4.5 m footbridge)
    const { a, b, top, t0, t1, cA, cB, strips } = M.plan, len = t1 - t0, tc = (t0 + t1) / 2;
    const G = (u, t) => (NS ? heightAt0(ax + u, t) : heightAt0(t, ax + u));
    const dk = NS ? [ax - BH, t0, ax + BH, t1] : [t0, ax - BH, t1, ax + BH];
    M.deckBuilt = { rect: dk, top, water: [a, b], axis: M.axis, width: BW, strips: strips.map((s) => [s.u0, s.u1, s.tA, s.tB]) };
    const AT = (u, t) => (NS ? [u, t] : [t, u]);                     // (across, along) -> world x, z
    const boxUT = (u, y, t, wu, h, wt, color, o) => { const p = AT(u, t); addBox(p[0], y, p[1], NS ? wu : wt, h, NS ? wt : wu, color, o); };
    // the deck: the main slab over the span every strip covers, and each strip's own run-out to its bank at both ends (exact boxes, one top)
    boxUT(ax, top - 0.15, (cA + cB) / 2, BW, 0.3, cB - cA, "#9a6c43", { tex: "plank" });
    for (const s of strips) {
      if (cA - s.tA > 0.01) boxUT(ax + (s.u0 + s.u1) / 2, top - 0.15, (s.tA + cA) / 2, s.u1 - s.u0, 0.3, cA - s.tA, "#9a6c43", { tex: "plank" });
      if (s.tB - cB > 0.01) boxUT(ax + (s.u0 + s.u1) / 2, top - 0.15, (cB + s.tB) / 2, s.u1 - s.u0, 0.3, s.tB - cB, "#9a6c43", { tex: "plank" });
    }
    // three stringer beams under the deck over the water (cosmetic: they read as a timber bridge from the banks), and a darker kerb plank along both edges (each over its own edge strip)
    for (const su of [-1, 0, 1]) boxUT(ax + su * (BH - 0.9), top - 0.55, (a + b) / 2, 0.4, 0.5, b - a + 2, "#5e4430", { tex: "plank", collide: false });
    const edgeS = [strips[0], strips[strips.length - 1]];
    for (const [su, s] of [[-1, edgeS[0]], [1, edgeS[1]]]) boxUT(ax + su * (BH - 0.2), top + 0.06, (s.tA + s.tB) / 2, 0.4, 0.12, s.tB - s.tA, "#6b4a2e", { tex: "plank", collide: false });
    // the abutments: where a strip runs out over a bank that falls away under it, solid stone causeway blocks (<= 2.5 m long) carry it from the ground to its underside - nothing hangs in the air over a
    // bank, and the block faces read as a stone abutment. Per PAIR of strips (2.1 m wide), from the lowest ground under the pair (stage B: under the centreline only - a bank that falls away across
    // the deck left a block's low corner in the air).
    for (let k = 0; k + 1 < strips.length; k += 2) {
      const sa = strips[k], sb = strips[k + 1], u0 = sa.u0, u1 = sb.u1, um = (u0 + u1) / 2;
      const low = (t) => Math.min(G(u0 + 0.05, t), G(um, t), G(u1 - 0.05, t));
      // from the pair's longer run-out (under its shorter strip that stretch is bank above the block's top) to where the ground under the pair goes into the water (its own water's edge: on the
      // bank's high side that is well inside the centreline's wet interval)
      const mA = Math.min(sa.tA, sb.tA), mB = Math.max(sa.tB, sb.tB);
      let wA = mA, wB = mB;
      while (low(wA) >= waterY + 0.25 && wA < (a + b) / 2) wA += 0.25;
      while (low(wB) >= waterY + 0.25 && wB > (a + b) / 2) wB -= 0.25;
      for (const [s0, s1] of [[mA, wA], [wB, mB]]) {
        if (s1 - s0 < 0.2) continue;
        const nB = Math.max(1, Math.ceil((s1 - s0) / 2.5));
        for (let j = 0; j < nB; j++) {
          const v0 = s0 + (s1 - s0) * j / nB, v1 = s0 + (s1 - s0) * (j + 1) / nB, g = Math.min(low(v0), low(v1), low((v0 + v1) / 2)) - 0.3, y1 = top - 0.3;
          if (y1 - g < 0.25) continue;
          boxUT(ax + um, (g + y1) / 2, (v0 + v1) / 2, u1 - u0 - 0.05, y1 - g, Math.abs(v1 - v0) + 0.1, "#8f8a80", { tex: "block" });
        }
      }
    }
    {                                                                                                    // piers: the river bed to the deck's underside, exact boxes (cover in the river), one every ~8 m of water
      const nP = Math.max(1, Math.round((b - a) / 8)), pu = BW - 1.1, pt2 = 2.8;
      for (let i = 1; i <= nP; i++) {
        const pt = a + (b - a) * i / (nP + 1), p = AT(ax, pt), g = groundRange(p[0], p[1], NS ? pu : pt2, NS ? pt2 : pu, 0)[0] - 0.5, y1 = top - 0.3;
        boxUT(ax, (g + y1) / 2, pt, pu, y1 - g, pt2, "#8f8a80", { tex: "block" });
        boxUT(ax, y1 - 0.25, pt, pu + 0.5, 0.5, pt2 + 0.5, "#7d786d", { tex: "block", collide: false });       // (a cap stone a little wider than the pier)
      }
    }
    // rails over the water and 3 m onto each bank, on both sides of the deck: a 1.25 m panel (0.2 thick, a collider: cover) between every two posts (a post every 3 m, cosmetic), a top rail over them;
    // the panels are 2.6 m long, so none is a "slab" of its own (the deck is the only walkable slab of the bridge)
    for (const sx of [-1, 1]) {
      const side = ax + sx * (BH - 0.12);                                                                // the rail's fixed coordinate (x for a N-S deck, z for an E-W one)
      const es = sx < 0 ? edgeS[0] : edgeS[1], r0 = Math.max(a - 3, es.tA + 0.3), r1 = Math.min(b + 3, es.tB - 0.3);     // (stage C: never past its own edge strip's run-out - on the bank's high side the strip meets the bank sooner)
      for (let t = r0; t < r1 - 0.2; t += 3) {
        const l = Math.min(2.6, r1 - t - 0.4);
        boxUT(side, top + 0.75, t, 0.32, 1.5, 0.32, "#4e3a28", { collide: false });
        if (l > 0.6) boxUT(side, top + 0.625, t + 0.35 + l / 2, 0.2, 1.25, l, "#7a5a3a", { tex: "plank" });
      }
      boxUT(side, top + 1.42, (r0 + r1) / 2 - 0.1, 0.36, 0.16, r1 - r0 - 0.2, "#5a4430", { tex: "plank", collide: false });
      // lanterns at both ends of the rails: a post down to the ground (or the deck) and a lamp head (the near-lamp light pool lights the crossing)
      for (const te of [r0 - 0.6, r1 + 0.6]) {
        const p = AT(side, te), g = heightAt0(p[0], p[1]);
        if (g < waterY + 0.3 || g > top + 0.6) continue;
        const y0 = Math.min(g, top) - 0.06;
        boxUT(side, (y0 + top + 2.9) / 2, te, 0.26, top + 2.9 - y0, 0.26, "#3a2c20", { collide: false });
        boxUT(side, top + 3.05, te, 0.5, 0.36, 0.5, "#ffe9a8", { collide: false });
        lampPts.push({ x: p[0], y: top + 3.05, z: p[1] });
      }
    }
    buildWaterMill(T, M);
    // the plots' retaining walls (dry stone) and the free pieces
    useDistrict("town:" + T.id);
    for (const w of M.walls) { const c = col[Math.floor(pr() * col.length)]; if (w.axis === 0) stoneBox(w.x, w.z, w.len, w.th, 0, w.h, c); else stoneBox(w.x, w.z, w.th, w.len, 0, w.h, c); }
    useDistrict("town:" + T.id);
    for (const q of M.pieces) {
      const c = q.kind === "boulder" ? col[Math.floor(pr() * col.length)] : shade(["#6b4a2e", "#7a5636", "#5e4128"][Math.floor(pr() * 3)], 1);
      if (q.kind === "woodpile") logPile(q, c, pr);
      else if (q.kind === "log") fallenLog(q, c);
      else boulder(q, c);
    }
    // the mill's own loot: a chest at the bridge's middle (the crossing is what the village is for)
    chest(NS ? ax + 1.0 : (a + b) / 2, top + 0.6, NS ? (a + b) / 2 : ax + 1.0, T.id);
  }
  /** a stacked pile of round logs (4 + 3 + 2 + 1, its long side along the piece's quarter turn), each bottom log on the ground under its own line, each upper one on the two logs under it; the cut
   *  ends pale. Colliders: two exact boxes (the lower two rows full depth, the upper two half depth), from 0.3 m into the lowest ground under the pile. */
  function logPile(q, c, pr) {
    const alongX = Math.abs(Math.cos(q.rot)) > 0.5, L = q.w, D = q.d, r = D / 8, ux = alongX ? 1 : 0, uz = alongX ? 0 : 1, vx = uz, vz = ux;
    const lineG = (o) => { let sum = 0; for (let k = 0; k <= 4; k++) { const t = (k / 4 - 0.5) * L * 0.9; sum += heightAt0(q.x + ux * t + vx * o, q.z + uz * t + vz * o); } return sum / 5; };
    let lo = Infinity;
    for (let k = 0; k <= 4; k++) for (let j = 0; j <= 2; j++) { const t = (k / 4 - 0.5) * L, o = (j / 2 - 0.5) * D, g = heightAt0(q.x + ux * t + vx * o, q.z + uz * t + vz * o); if (g < lo) lo = g; }
    const ys = [];
    let top = lo;
    for (let row = 0; row < 4; row++) {
      const n = 4 - row, cur = [];
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 2 * r;
        const y = row === 0 ? lineG(o) + r - 0.07 : Math.max(ys[row - 1][i], ys[row - 1][i + 1]) + 2 * r * 0.866;
        cur.push(y);
        const ll = L * (0.9 + pr() * 0.1), sh = (pr() - 0.5) * 0.3;
        _gT.makeTranslation(q.x + ux * sh + vx * o, y, q.z + uz * sh + vz * o);
        _gR.makeRotationZ(Math.PI / 2);
        if (!alongX) _gR.premultiply(_gM.makeRotationY(Math.PI / 2));
        cylAt(_gT.multiply(_gR), r * 0.97, ll, 9, shade(c, 0.9 + pr() * 0.2), "plank", "#c9a46a");
        top = Math.max(top, y + r);
      }
      ys.push(cur);
    }
    const y2 = Math.max(...ys[1]) + r;                                         // the top of the second row
    boxColliders(q.x, (lo - 0.3 + y2) / 2, q.z, alongX ? L * 0.95 : D, y2 - lo + 0.3, alongX ? D : L * 0.95, 0);      // the two lower rows, the pile's full depth
    boxColliders(q.x, (lo - 0.3 + top) / 2, q.z, alongX ? L * 0.9 : 4 * r, top - lo + 0.3, alongX ? 4 * r : L * 0.9, 0);   // its core, as deep as the third row, from the ground to the top log (one box: cover as tall as the pile)
  }
  /** a fallen trunk: one round log lying on the ground along its yaw, pitched to the ground at its two ends; colliders = <= 1 m pieces along it, each at its own height */
  function fallenLog(q, c) {
    const L = q.w, r = Math.min(0.45, q.d / 2), ux = Math.cos(q.rot), uz = -Math.sin(q.rot);                     // (the yaw turns +x like rotateY: x' = x c, z' = -x s)
    const gA = heightAt0(q.x - ux * L * 0.45, q.z - uz * L * 0.45), gB = heightAt0(q.x + ux * L * 0.45, q.z + uz * L * 0.45), gM = heightAt0(q.x, q.z);
    const yA = gA + r - 0.12, yB = gB + r - 0.12, yM = Math.min((yA + yB) / 2, gM + r - 0.05);
    const pitch = Math.atan2(yB - yA, L * 0.9);
    _gT.makeTranslation(q.x, yM, q.z);
    _gR.makeRotationZ(-Math.PI / 2 + pitch).premultiply(_gM.makeRotationY(q.rot));
    cylAt(_gT.multiply(_gR), r, L, 10, c, "plank", "#c49c62");
    const n = Math.max(1, Math.ceil(L));
    for (let k = 0; k < n; k++) {
      const t = -L / 2 + (k + 0.5) * L / n, y = yM + Math.tan(pitch) * t;
      boxColliders(q.x + ux * t, y, q.z + uz * t, L / n, 2 * r * 0.92, 2 * r * 0.92, q.rot);
    }
  }
  /** a boulder: a faceted, flattened icosahedron the piece's size, sunk into the ground; the collider is the box inside its waist (0.8 of the footprint) */
  function boulder(q, c) {
    const [lo] = groundRange(q.x, q.z, q.w, q.d, q.rot), gc = heightAt0(q.x, q.z), base = Math.max(lo, gc - 0.4);
    const geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.9 + 0.2 * (((Math.round(p.getX(i) * 31) * 7 + Math.round(p.getY(i) * 37) * 13 + Math.round(p.getZ(i) * 29) * 5) & 15) / 15); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }   // (keyed by the vertex position: shared corners move together, the facets stay closed)
    geo.computeVertexNormals();
    const idx = []; for (let i = 0; i < p.count; i++) idx.push(i);
    geo.setIndex(idx);
    const ry = Math.max(q.h * 0.62, 0.6);
    geo.scale(q.w / 2 * 1.04, ry, q.d / 2 * 1.04); geo.rotateY(q.rot || 0); geo.translate(q.x, base + q.h - ry, q.z);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * q.w / structTile * 2, uv.getY(i) * q.h / structTile * 2);
    pushGeo(c + "|block", geo);
    const yt = base + q.h * 0.92;
    const n0 = colliders.length;
    boxColliders(q.x, (lo - 0.35 + yt) / 2, q.z, q.w * 0.8, yt - lo + 0.35, q.d * 0.8, q.rot || 0);
    for (let i = n0; i < colliders.length; i++) colSurf.set(colliders[i], "stone");      // LC-52: a boulder is rock (the untagged default is timber)
  }
  /** The water mill beside the bridge (towngen's L.mill.wheel): a two-storey timber millhouse on a stone base that stands in the river's edge, a gable roof, an overshot wheel on its side wall
   *  (it TURNS: one mesh of its own, turned about its axle every frame within 320 m of the camera), the axle into the base, a flume on trestles from a stone sluice up the bank to the wheel's top.
   *  Frame: X = from the wheel to the house (the across-the-deck axis, away from the bridge), Z = X x up, `q` = metres inland from the water's edge (local z = zs q). Every part of the house and
   *  the flume that collides is an exact box (the frame is a quarter turn); the wheel collides as three stacked boxes round its disc. */
  function buildWaterMill(T, M) {
    const W0 = M.wheel;
    if (!W0) return;
    const NS = M.axis === 0, R = W0.r || 3.6, land = W0.land, sd = W0.side, u = W0.u;
    const hu = (t) => (NS ? heightAt0(u, t) : heightAt0(t, u));
    let te = W0.te;                                                                                     // the water's edge on the ground as built (the pads and the link road moved the banks a little)
    for (let k = 0; k < 8 && hu(te) < waterY + 0.2; k++) te += land;
    for (let k = 0; k < 8 && hu(te - land) >= waterY + 0.2; k++) te -= land;
    const o = NS ? [u, te] : [te, u];
    const Xw = new THREE.Vector3(NS ? sd : 0, 0, NS ? 0 : sd), Yw = new THREE.Vector3(0, 1, 0), Zw = new THREE.Vector3().crossVectors(Xw, Yw);
    const inl = NS ? [0, land] : [land, 0], zs = (Zw.x * inl[0] + Zw.z * inl[1]) >= 0 ? 1 : -1;
    const F = new THREE.Matrix4().makeBasis(Xw, Yw, Zw).setPosition(o[0], 0, o[1]);
    const WP = (lx, q) => [o[0] + Xw.x * lx + Zw.x * zs * q, o[1] + Xw.z * lx + Zw.z * zs * q];
    const G = (lx, q) => { const p = WP(lx, q); return heightAt0(p[0], p[1]); };
    const ext = (wx, dq) => [Math.abs(Xw.x) * wx + Math.abs(Zw.x) * dq, Math.abs(Xw.z) * wx + Math.abs(Zw.z) * dq];
    // an axis-aligned part in the frame: (lx, q) centre, wx along X, dq along q (exact in the world: the frame is a quarter turn); colOnly = the collider without a drawn box
    const part = (lx, y, q, wx, h, dq, color, opts) => { const p = WP(lx, q), e = ext(wx, dq); addBox(p[0], y, p[1], e[0], h, e[1], color, opts); };
    const colOnly = (lx, y, q, wx, h, dq) => { const p = WP(lx, q), e = ext(wx, dq); boxColliders(p[0], y, p[1], e[0], h, e[1], 0); };
    const at = (lx, y, q, rx) => { _gT.makeTranslation(lx, y, zs * q); if (rx) _gT.multiply(_gR.makeRotationX(rx)); return _gM.multiplyMatrices(F, _gT); };
    const NC = { collide: false };
    // the millhouse: X 1.2 .. 9.6, q -3 .. 7 (its river end on the stone base in the water)
    const HX = 5.4, HW = 8.4, HQ = 2, HD = 10;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 8; j++) { const g = G(HX - HW / 2 + HW * i / 6, HQ - HD / 2 + HD * j / 8); if (g < lo) lo = g; if (g > hi) hi = g; }
    const fy = Math.max(hi + 0.25, waterY + 2.4), BH2 = 5.6, roofH = 3.1;
    part(HX, (lo - 0.35 + fy) / 2, HQ, HW + 0.4, fy - lo + 0.35, HD + 0.4, "#8a857a", { tex: "block" });                       // the stone base
    part(HX, fy + BH2 / 2, HQ, HW, BH2, HD, "#7a5636", { tex: "plank" });                                                     // the timber body (closed: the mill's machinery)
    for (const [px, pq] of [[HX - HW / 2, HQ - HD / 2], [HX + HW / 2, HQ - HD / 2], [HX - HW / 2, HQ + HD / 2], [HX + HW / 2, HQ + HD / 2]]) part(px, fy + BH2 / 2, pq, 0.4, BH2, 0.4, "#4a3626", NC);   // corner posts
    part(HX, fy + 2.85, HQ, HW + 0.12, 0.25, HD + 0.12, "#4a3626", NC);                                                        // the floor beam between the storeys
    for (const fl of [0, 1]) {
      const wy = fy + 1.6 + fl * 2.85;
      for (const qq of [-2.2, 1, 4.2]) part(HX + HW / 2 + 0.03, wy, HQ + qq - 1, 0.06, 1.2, 1.1, "#2f3d44", NC);              // the long side's windows (away from the wheel)
      for (const xx of [-2.4, 2.4]) { part(HX + xx, wy, HQ - HD / 2 - 0.03, 1.1, 1.2, 0.06, "#2f3d44", NC); if (fl) part(HX + xx, wy, HQ + HD / 2 + 0.03, 1.1, 1.2, 0.06, "#2f3d44", NC); }
    }
    part(HX, fy + 1.15, HQ + HD / 2 + 0.04, 1.6, 2.3, 0.08, "#3a2a1e", NC);                                                    // the door on the uphill end (painted: the mill is shut)
    part(HX, fy + 2.5, HQ + HD / 2 + 0.3, 2.4, 0.12, 0.6, "#6e2f26", NC);                                                      // its little canopy
    // the gable roof: ridge along q, 0.5 m eaves; colliders: 5 stacked boxes under the slopes
    pushGeo("#6e2f26|shingle", prismGeo(HW + 1.0, roofH, HD + 1.0).applyMatrix4(at(HX, fy + BH2, HQ)));
    { const c = WP(HX, HQ), ridgeX = Math.abs(Zw.x) > 0.5; gableColliders(c[0], c[1], HW + 1.0, HD + 1.0, ridgeX, fy + BH2, roofH, 5); }
    { const cy0 = fy + BH2 - 0.05, cy1 = fy + BH2 + roofH * 0.48 + 1.4; part(HX + 2.2, (cy0 + cy1) / 2, HQ + 2.6, 0.8, cy1 - cy0, 0.8, "#6f6a62", NC); }   // a chimney (from the top of the walls up through the roof)
    { const a2 = WP(HX - HW / 2, HQ - HD / 2), b2 = WP(HX + HW / 2, HQ + HD / 2); cityBld.push([Math.min(a2[0], b2[0]), Math.min(a2[1], b2[1]), Math.max(a2[0], b2[0]), Math.max(a2[1], b2[1])]); }
    // the wheel: centre over the water 2.2 m out from the edge, its bottom 0.9 m under the surface, 1.5 m wide; rims of 20 segments, 20 paddles, 8 spokes a rim, a hub (its own mesh: it turns)
    const qW = -2.2, hubY = waterY + R - 0.9, WG = [];
    for (const rx of [-0.75, 0.75]) {
      for (let i = 0; i < 20; i++) { const th = i * Math.PI * 2 / 20; _gT.makeTranslation(rx, hubY, zs * qW).multiply(_gR.makeRotationX(th)).multiply(_gM.makeTranslation(0, R, 0)); boxAt(new THREE.Matrix4().multiplyMatrices(F, _gT), 0.22, 0.34, 2 * Math.PI * R / 20 * 1.08, "#4f3b29", "plank", WG); }
      for (let k = 0; k < 4; k++) boxAt(at(rx, hubY, qW, k * Math.PI / 4), 0.18, 2 * R - 0.25, 0.18, "#6b5038", "plank", WG);
    }
    for (let i = 0; i < 20; i++) { const th = (i + 0.5) * Math.PI * 2 / 20; _gT.makeTranslation(0, hubY, zs * qW).multiply(_gR.makeRotationX(th)).multiply(_gM.makeTranslation(0, R - 0.42, 0)); boxAt(new THREE.Matrix4().multiplyMatrices(F, _gT), 1.56, 0.78, 0.1, "#5e4630", "plank", WG); }
    boxAt(at(0, hubY, qW), 1.9, 0.8, 0.8, "#3a2c20", "plank", WG);
    const piv = WP(0, qW);
    millWheels.push({ geos: WG, pivot: [piv[0], hubY, piv[1]], axis: [Xw.x, 0, Xw.z] });
    part(0.25, hubY, qW, 2.3, 0.36, 0.36, "#2e2620", NC);                                                                       // the axle (it does not turn: a round shaft reads the same)
    for (const [y0, y1, hw] of [[-0.92, -0.38, 0.62], [-0.38, 0.38, 0.95], [0.38, 0.92, 0.62]]) colOnly(0, hubY + R * (y0 + y1) / 2, qW, 1.6, R * (y1 - y0), 2 * R * hw);   // the disc
    { // the wheel pit: a masonry sill on the river bed under the wheel (0.15 m under its paddles) and a low wall on its open side, so the wheel turns in a stone race, not over bare mud
      let bed = Infinity; for (let i = 0; i <= 4; i++) for (const lx of [-1, 0, 1]) bed = Math.min(bed, G(lx, qW - R + i * R / 2));
      const sTop = hubY - R - 0.15;                                                                // (2 cm into the rim's lowest segment: the wheel rests in its race)
      if (sTop - bed > -0.2) part(0, (bed - 0.35 + sTop) / 2, qW, 2.2, sTop - bed + 0.35, 2 * R * 0.9, "#7d786d", { tex: "block", collide: false });
      const wTop = Math.max(waterY + 0.25, hubY - R + 1.2);
      let wbed = Infinity; for (let i = 0; i <= 4; i++) wbed = Math.min(wbed, G(-1.25, qW - R + i * R / 2));
      part(-1.25, (wbed - 0.35 + wTop) / 2, qW, 0.5, wTop - wbed + 0.35, 2 * R * 0.95, "#8a857a", { tex: "block" });
    }
    // the flume: a trough on trestles from q 15 (a stone sluice head up the bank) down to the wheel's top, falling 0.8 m, water in it; posts every 3 m from the bank (exact colliders)
    const fTop0 = hubY + R + 0.35, q0f = qW + 0.7, q1f = 15, nSeg = 7;
    for (let k = 0; k < nSeg; k++) {
      const qa = q0f + (q1f - q0f) * k / nSeg, qb = q0f + (q1f - q0f) * (k + 1) / nSeg, qm = (qa + qb) / 2, yb = fTop0 + 0.8 * (qm - q0f) / (q1f - q0f), L = qb - qa + 0.04;
      part(0, yb, qm, 1.1, 0.14, L, "#6b4a2e", { tex: "plank" });
      for (const sx of [-0.5, 0.5]) part(sx, yb + 0.33, qm, 0.1, 0.52, L, "#5e4128", { tex: "plank" });
      part(0, yb + 0.2, qm, 0.88, 0.06, L, "#5f97b3", NC);
    }
    for (let q = 1; q <= 14.01; q += 3) {
      const yb = fTop0 + 0.8 * (q - q0f) / (q1f - q0f) - 0.07;
      for (const sx of [-0.5, 0.5]) { const g = G(sx, q) - 0.06; if (yb - g > 0.3) part(sx, (g + yb) / 2, q, 0.24, yb - g, 0.24, "#4e3a28"); }
      part(0, yb - 0.08, q, 1.3, 0.16, 0.2, "#4e3a28", NC);
    }
    part(0.86, fTop0 - 0.07, 0, 0.8, 0.16, 0.3, "#4e3a28", NC);                                                                  // a bracket from the trough to the house wall
    { const g = Math.min(G(0, 15.8), G(0.9, 15.8), G(-0.9, 15.8)) - 0.35, yt = fTop0 + 0.8 + 0.6; part(0, (g + yt) / 2, 15.9, 2.0, yt - g, 1.8, "#8a857a", { tex: "block" }); }
  }
  // the docks: a stilt house on a deck stands over ground the navigation grid reads as terrain only where a walker could stand (shallower than 1.08 m) and not under a deck (a floor 0.9 m over
  // the sand leaves no head room). A building tile (the roof + 2 m) is baked on its own and its flood fill starts from the terrain nodes IN it: a tile with none keeps its floors; a tile with
  // some seeds from them - and if the deck stands more than a step (0.55 m) over every one of them (a sand flat at 0.1 - 0.3 m under a deck at 0.9, or only wading nodes round it) the deck
  // is pruned as an island and the rooms on it are unreachable for a bot. So under each platform house: a seabed that is mostly wading (no dry ground outside the decks) is dug to 2.6 m under
  // the surface (the tile then holds no terrain at all), and ground that is dry is levelled at waterY + 0.5 (a 0.4 m step up to the deck: the sand seeds the flood and the deck is reached).
  // The flat 5 m round the house is a pad; its edge slopes away.
  function registerDocks(T) {
    const decks = T.docks.decks.map((dk) => dk.rect);
    const onDeck = (x, z) => { for (const r of decks) if (x > r[0] - 0.6 && x < r[2] + 0.6 && z > r[1] - 0.6 && z < r[3] + 0.6) return true; return false; };
    for (const p of T.parcels) {
      const b = p.building;
      if (!b.deck) continue;
      const a = b.aabb;
      let dry = 0, shallow = 0;
      for (let x = a[0] - 3.0; x <= a[2] + 3.0; x += 0.75) for (let z = a[1] - 3.0; z <= a[3] + 3.0; z += 0.75) {
        if (onDeck(x, z)) continue;
        const h = heightAt0(x, z);
        if (h >= waterY) dry++; else if (h >= waterY - 1.5) shallow++;
      }
      if (dry + shallow === 0) continue;
      const lvlWant = dry > 0 ? waterY + 0.5 : waterY - 2.6, op = field.overlapPad(a[0] - 5, a[2] + 5, a[1] - 5, a[3] + 5);
      if (op !== null && Math.abs(op.pad.h - lvlWant) > 0.3) continue;                          // (a pad of another level is already there - a town's plateau beside the landing: joining it would bury the deck)
      groundPad((a[0] + a[2]) / 2, (a[1] + a[3]) / 2, (a[2] - a[0]) / 2 + 5, (a[3] - a[1]) / 2 + 5, { gen: "dockbed", level: dry > 0 ? waterY + 0.5 : waterY - 2.6 });
    }
  }
  /** a row of palms (resort) / pines (lodge) along the streets of a grid town: every 64 m, alternating sides, 7.4 m from the centreline (on the sidewalk's outer edge), never within 16 m of a
   *  junction or on a building / lot rectangle; the instanced tree with its trunk collider, like the pocket parks'. Savanna keeps its bare streets (its world is untouched). */
  function streetTrees(T) {
    const N = T.roads.nodes, tr = TG_subRng(T.id, "streettrees");
    let k = 0;
    for (const e of T.roads.edges) {
      const A = N[e.a], B = N[e.b], ux = e.axis === "x" ? Math.sign(B.x - A.x) : 0, uz = e.axis === "z" ? Math.sign(B.z - A.z) : 0;
      for (let t = 20 + tr() * 10; t <= e.len - 20; t += (mapId === "isla_viva" ? 42 : 52)) {          // (stage B: every 42 m on the resort - a palm-lined promenade - and 52 m in the lodge village: the far palms / pines are the coarse LOD copy now, was 76 / 64 m)
        const side = (k++ % 2) ? 1 : -1, off = 7.4 + (tr() - 0.5) * 0.8, sc = 0.8 + tr() * 0.35, ry = tr() * Math.PI * 2;
        const x = A.x + ux * t + (-uz) * side * off, z = A.z + uz * t + ux * side * off;
        if (inRects(cityBld, x, z, 3.0) || inRects(cityDecks, x, z, 2.0) || heightAt0(x, z) < waterY + 0.6) continue;
        props[cityTree].push({ x, y: heightAt0(x, z), z, s: sc, ry, street: true });      // (street: drawn by the map-wide mesh, never a near-field shadow caster - see the casters below)
      }
    }
  }
  function registerCityExtras() {
    for (const T of city.lay.towns) {
      if (T.kind === "docks" && T.docks) registerDocks(T);
      if (T.kind === "crater" && T.crater) registerCrater(T);
      else if (T.kind === "mill" && T.mill) registerMill(T);
    }
  }

  // ── WAVE 8 (stage B, lane I1): the furnished houses ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Every enterable building of a town / compound parcel (house, shop, hall, shed, barn, mid-rise, tower; the crater village's ruins and the docks' stilt houses too) is ONE
  // housegen.js house: walls, floors, stairs, roofs, glass, furniture and every collider come from its data (generate at y 0 -> the pad under everything it stands on ->
  // translateY onto the pad). Drawing:
  //  - the OUTSIDE of the structure (every face with open air in front of it: facades, roofs, trim, porches) goes into the district's sink as pre-coloured geometry
  //    ("vc|<kind>": the struct textures, no new material and no new draw call - the district's mix mesh, which casts the shadows);
  //  - the INSIDE (the faces that look into the house: room walls, floors, ceilings, stair steps, door leaves, lamp panels) and the furniture (authored pieces + the
  //    Kenney kit GLBs baked in, see buildHouseFurniture) go into ONE mesh per 32 m chunk with the same mix material (textured, the same program), drawn within
  //    HG_FURN_DIST of the camera, no shadow pass. The inside is darkened by HG_INDOOR (the hemisphere light and the IBL are not occluded indoors: without the term
  //    a room under a roof is as bright as the street in the shade); lamp panels keep their colour;
  //  - the glass panes of every house: ONE transparent mesh for the whole map (one draw call, no collider: the cover rule - bullets and eyes pass, bodies do not),
  //    clear near the camera and turning to dark sky-lit glass with distance (beyond the inside's 60 m an empty house would otherwise show through its windows).
  // Colliders: collidersOf(house) in its fixed order (structure boxes, ramps - the stairs AND the pitched roofs' planks, see house.roofRamps -, furniture), nothing else.
  // Loot: housegen's points reach loot.js as map.houses (lane I3's per-room pass): no house point is added to map.lootPoints here.
  // DETERMINISM: generate() is a pure function of the parcel (towngen's record + the map seed); nothing here draws from the shared `rng`.
  const houses = [];                 // map.houses: the housegen records as built, in build order (+ town, parcel, district, chunk, index, cols, roofRamps)
  const hgChunks = new Map();        // inside / furniture chunk key -> { key, x0, z0, x1, z1, y0, y1, pos, nor, uv, col, tki, idx, kit: [{ type, x, y, z, rot, min, max }] }
  const hgGlass = { pos: [], nor: [], col: [], idx: [] };
  // housegen palette material -> the struct texture kind its faces wear (district merge: s / plank / stucco share the mix mesh; no metal mesh)
  const HG_COLSURF = { brick: "stone", stone: "stone", roof: "stone", roof_flat: "concrete", floor_tile: "concrete", floor_concrete: "concrete", lamp: "concrete", sheet: "metal", metal: "metal",
    glass: "concrete", plaster: "concrete", stucco: "concrete", fabric: "concrete", ceramic: "concrete", plank: "wood", plank_in: "wood", floor_wood: "wood", wood: "wood" };   // LC-52 (surfaceAt)
  // a pitched "roof" is clay tile (stone) unless its tint is a DARK warm brown: the timber lodges' and cabins' shingles (wood)
  const _hgC = new THREE.Color();
  function hgSurf(pe) {
    if (!pe) return "concrete";
    if (pe.mat === "roof") { try { _hgC.set(pe.color); } catch (e) { return "stone"; } if (Math.max(_hgC.r, _hgC.g, _hgC.b) < 0.2 && _hgC.r >= _hgC.g && _hgC.g >= _hgC.b) return "wood"; }
    return HG_COLSURF[pe.mat] || "concrete";
  }
  const HG_MAT_KIND = { brick: "s", stone: "s", roof: "s", roof_flat: "s", floor_tile: "s", floor_concrete: "s", lamp: "s", sheet: "s", metal: "s", glass: "s",
    plaster: "stucco", stucco: "stucco", fabric: "stucco", ceramic: "stucco", plank: "plank", plank_in: "plank", floor_wood: "plank", wood: "plank" };
  // the indoor ambient term: interior faces and furniture take this share of their colour (lamp panels keep theirs). Deepwood's forest light is darker than the
  // other maps' and its lodges are timber inside: at 0.8 a third of a lodge room's pixels read near-black from its doorway (interiorcheck light: dark share 0.31-0.36)
  const HG_INDOOR = mapId === "deepwood" ? 0.95 : 0.8;
  const HG_TKI = { s: 0, plank: 1, stucco: 2 };   // dualStructMaterial's texture index per struct kind (furniture wears the near-flat stucco grain unless it is wood)
  const HG_FURN_CELL = 32, HG_FURN_DIST = TIER_Q.furnD;    // (60 m; high 70, ULTRA 95)
  const _hgc = new THREE.Color(), hgColCache = new Map();
  const hgCol = (hex) => { let v = hgColCache.get(hex); if (!v) { _hgc.set(hex); v = [_hgc.r, _hgc.g, _hgc.b]; hgColCache.set(hex, v); } return v; };
  const hgStack = () => new Error().stack;
  // is (x, z) inside a furnished house's walls (its outer faces, minus an L plan's cut)? The ground decals and the road ribbons drawn there would lie OVER the house's
  // floor (5 cm over its pad; a ribbon is 6 cm over the ground, a decal 10 cm): they are not drawn inside a house. Hash built on the first call (the houses are done by then).
  let hgUH = null;
  const HG_QC = [1, 0, -1, 0], HG_QS = [0, 1, 0, -1];
  function underHouse(x, z) {
    if (!houses.length) return false;
    if (!hgUH) {
      hgUH = new Map();
      for (const H of houses) { const a = H.aabb; for (let i = Math.floor(a.min[0] / 16); i <= Math.floor(a.max[0] / 16); i++) for (let j = Math.floor(a.min[2] / 16); j <= Math.floor(a.max[2] / 16); j++) { const k = i * 4096 + j; if (!hgUH.has(k)) hgUH.set(k, []); hgUH.get(k).push(H); } }
    }
    const l = hgUH.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16));
    if (l) for (const H of l) {
      const dx = x - H.cx, dz = z - H.cz, c = HG_QC[H.turn], sn = HG_QS[H.turn], u = dx * c - dz * sn, v = dx * sn + dz * c, hw = H.W / 2 + 0.12, hd = H.D / 2 + 0.12;
      if (u <= -hw || u >= hw || v <= -hd || v >= hd) continue;
      if (H.cut) { const cu0 = -H.W / 2 + H.cut[0] * H.U, cv0 = -H.D / 2 + H.cut[1] * H.U, cu1 = -H.W / 2 + H.cut[2] * H.U, cv1 = -H.D / 2 + H.cut[3] * H.U; if (u > cu0 + 0.12 && u < cu1 - 0.12 && v > cv0 + 0.12 && v < cv1 - 0.12) continue; }
      return true;
    }
    return false;
  }   // (the placement census reads the generator's name from the frame under this one: "hgHouse")
  /** The shared-`rng` draws the live generators (house() / towerTurn() / ruinHouse() and house()'s upper floor) made for this building - their loot rolls - made
   *  again and thrown away: the furnished house's loot comes from its own stream (loot.js), and with these draws everything the shared stream places after the
   *  towns (props, landmarks, portals, wild loot) is what the live build placed. Same branches and probabilities as the live code below. */
  function legacyRolls(T, b, isCmp, core, sr, PAL, roofC) {
    if (b.gen === "tower") {
      const base = core ? SAV.tower.core : SAV.tower.town;
      for (let f = 0; f < b.floors; f++) if (rng() < base.loot) { rng(); rng(); }          // a floor item per storey (+ its x / z jitter)
      rng(); rng();                                                                         // the roof chest, the ground-floor item
      return;
    }
    const lt = isCmp ? (b.use === "shed" ? SAV.loot.cmpShed : SAV.loot.cmpHouse) : (SAV.loot[b.use] || SAV.loot.house);
    if (mapId !== "ashgrid" && T.kind !== "crater" && !b.deck && themedStyle(b, sr, PAL, roofC, b.floorH || 3.4).storeys === 2) rng();   // the upper floor's item
    rng();                                                                                  // the floor item
    if (rng() < lt[1]) { rng(); rng(); }                                                    // the chest (+ its jitter)
  }
  // (Wave 8 fix round, lane K1) the other buildings round a parcel (every town / compound building's layout footprint, + 0.3 m): housegen opens no street / back
  // door onto one closer than its DOOR_OUT (verify_b: 11 Savanna downtown back doors faced a tower wall 1-3 m across an alley - a door nobody can approach)
  let hgNearAll = null;
  function hgNear(b) {
    if (!hgNearAll) { hgNearAll = []; for (const T of city.lay.towns.concat(city.lay.compounds)) for (const q of T.parcels) if (q.building && q.building.aabb) hgNearAll.push(q.building.aabb); }
    const a = b.aabb, M = 6, out = [];
    if (!a) return out;
    for (const r of hgNearAll) { if (r === a || r[2] < a[0] - M || r[0] > a[2] + M || r[3] < a[1] - M || r[1] > a[3] + M) continue; out.push([r[0] - 0.3, r[1] - 0.3, r[2] + 0.3, r[3] + 0.3]); }
    return out;
  }
  /** One parcel building -> one furnished house. Returns { H, look, roofTop }. */
  function hgHouse(T, p, b, did, wallC, roofC) {
    const HG = city.HG;
    const use = p.use && HG.USES.indexOf(p.use) >= 0 ? p.use : (b.use && HG.USES.indexOf(b.use) >= 0 ? b.use : "house");
    const theme = T.theme || (mapId === "isla_viva" ? "resort" : mapId === "deepwood" ? "lodge" : "city");
    const par = { id: T.id + "@" + p.id, cx: b.cx, cz: b.cz, y: 0, w: b.w, d: b.d, turn: b.turn, theme, storeys: Math.max(1, b.floors || 1), seed: seed >>> 0, use, fh: b.floorH, near: hgNear(b) };
    // Savanna's towns keep their block palettes (cityPalette: a block's two wall colours and two roof colours, the colours the live towns wear): the city theme's own
    // colours are brick reds and plasters only
    if (mapId === "ashgrid" && theme === "city" && wallC && roofC) { par.facadeColor = parseInt(wallC.slice(1), 16); par.roofColor = parseInt(roofC.slice(1), 16); }
    const H0 = HG.generate(par);
    // the pad: the old roof-deck rectangle (the parcel + 0.4 m) and everything the house stands on the ground with (walls, porch decks, stoops, steps)
    const rc = Math.abs(Math.cos(b.rot || 0)), rs = Math.abs(Math.sin(b.rot || 0));
    const ohx = (rc * (b.w + 0.7) + rs * (b.d + 0.7)) / 2 + 0.05, ohz = (rs * (b.w + 0.7) + rc * (b.d + 0.7)) / 2 + 0.05;
    let x0 = b.cx - ohx, x1 = b.cx + ohx, z0 = b.cz - ohz, z1 = b.cz + ohz;
    for (const bx of H0.boxes) {
      if (bx.min[1] > 0.6 || bx.p === "glass" || bx.p === "deco" || bx.p === "skin" || bx.p === "furn") continue;
      if (bx.min[0] - 0.05 < x0) x0 = bx.min[0] - 0.05;
      if (bx.max[0] + 0.05 > x1) x1 = bx.max[0] + 0.05;
      if (bx.min[2] - 0.05 < z0) z0 = bx.min[2] - 0.05;
      if (bx.max[2] + 0.05 > z1) z1 = bx.max[2] + 0.05;
    }
    const y = b.deck && b.y0 != null ? b.y0 : groundPad((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, { gen: "house" });
    const H = HG.translateY(H0, y);
    // the inside / furniture chunk of this house (by its centre: a house's inside shows and hides as one)
    const ck = Math.floor(b.cx / HG_FURN_CELL) + "," + Math.floor(b.cz / HG_FURN_CELL);
    let C = hgChunks.get(ck);
    if (!C) hgChunks.set(ck, C = { key: ck, x0: 1e9, z0: 1e9, x1: -1e9, z1: -1e9, y0: 1e9, y1: -1e9, parts: [], inside: [], kit: [] });
    C.x0 = Math.min(C.x0, H.aabb.min[0]); C.x1 = Math.max(C.x1, H.aabb.max[0]); C.z0 = Math.min(C.z0, H.aabb.min[2]); C.z1 = Math.max(C.z1, H.aabb.max[2]);
    C.y0 = Math.min(C.y0, H.aabb.min[1]); C.y1 = Math.max(C.y1, H.aabb.max[1]);
    const toChunk = (a, k, tki, inside) => { if (a.idx.length) (inside ? C.inside : C.parts).push(a, k, tki); };   // (copied once into the chunk's typed arrays, see buildHouseFurniture; K1: the insides and the furniture apart)
    // structure: the outside -> the district sink, the inside -> the chunk
    // (K1 re-run: ns - a ruin's wreckage comes keyed "<mat>#ns" and goes to the district's no-shadow twin, "vcn|<kind>", see mergeBatchSet)
    const md = HG.meshData(H, hgCol, { interior: true, ns: true });
    for (const [key, a] of md.groups.walls) {
      if (!a.idx.length) continue;
      const nsK = key.endsWith("#ns"), key0 = nsK ? key.slice(0, -3) : key;
      const bar = key0.indexOf("|"), mat = bar < 0 ? key0 : key0.slice(0, bar), kind = HG_MAT_KIND[mat] || "s";
      if (bar >= 0) { toChunk(a, mat === "lamp" ? 1 : HG_INDOOR, HG_TKI[kind] || 0, true); continue; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(a.nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(a.col, 3));
      geo.setIndex(a.idx);
      pushGeo((nsK ? "vcn|" : "vc|") + kind, geo);
    }
    for (const [, a] of md.groups.glass) {
      const base = hgGlass.pos.length / 3;
      for (let i = 0; i < a.pos.length; i++) { hgGlass.pos.push(a.pos[i]); hgGlass.nor.push(a.nor[i]); hgGlass.col.push(a.col[i]); }
      for (let i = 0; i < a.idx.length; i++) hgGlass.idx.push(a.idx[i] + base);
    }
    for (const [key, a] of md.groups.furniture) { const mat = key.split("|")[0]; toChunk(a, HG_INDOOR, mat === "wood" ? 1 : 2); }
    for (const f of H.furniture) if (f.src === "kit") C.kit.push({ type: f.kit.type, x: f.kit.x, y: f.kit.y, z: f.kit.z, rot: f.kit.rot, min: f.min, max: f.max });
    // colliders: structure boxes, ramps (stairs + roof planks), furniture - housegen's order
    const c0 = colliders.length, nBox = H.boxes.reduce((n, q) => n + (q.c ? 1 : 0), 0), roofRamps = [];
    for (const c of HG.collidersOf(H, mkCollider)) colliders.push(c);
    {                                                // LC-52: what each house collider is made of (its top face's palette material; stairs are timber; a roof plank its roof's material)
      let k = c0;
      for (const b of H.boxes) if (b.c) { const pe = H.palette[b.f && b.f[2]]; colSurf.set(colliders[k++], hgSurf(pe)); }
      let roofS = "stone";
      for (const pe of H.palette) if (pe.mat === "roof" || pe.mat === "roof_flat" || pe.mat === "sheet") { roofS = hgSurf(pe); break; }
      for (const r of H.ramps) { if (k < colliders.length) colSurf.set(colliders[k++], r.roof ? roofS : "wood"); }
      for (; k < colliders.length; k++) colSurf.set(colliders[k], "wood");             // (furniture: tables, beds, crates)
    }
    H.ramps.forEach((r, k) => { if (r.roof) roofRamps.push(c0 + nBox + k); });
    H.town = T.id; H.parcel = p.id; H.district = did; H.chunk = ck; H.index = houses.length;
    H.cols = [c0, nBox + H.ramps.length, colliders.length - c0];      // [first collider, structure colliders (boxes + ramps), all of the house's]
    H.roofRamps = roofRamps;
    houses.push(H);
    // the house's loot points are listed on map.lootPoints too, tagged `house` (loot.js spawns a house's loot from map.houses and SKIPS these; bots.assignDrops reads
    // lootPoints for its landing spots - a spot qualifies when a gun lies within 1.8 m of it - and its per-POI cap). `w` = this house's expected loot units (lane I3's
    // per-room budget: min(3, 0.6 + 0.12 x rooms with points) + a chest slot's 0.4 x 2) spread over its points, so a cap can weigh a town by what it will hold
    {
      const rooms = new Set(H.loot.map((l) => l.room)), E = Math.min(3, 0.6 + 0.12 * rooms.size) + (H.chests.length ? 0.8 : 0), w = H.loot.length ? Math.round(E / H.loot.length * 1000) / 1000 : 0;
      for (const l of H.loot) { lootPoints.push({ x: l.x, y: l.y, z: l.z, kind: "floor", poi: T.id, house: H.index, room: l.room, w }); lootG.push(heightAt0(l.x, l.z)); }
    }
    cityBld.push([H.aabb.min[0], H.aabb.min[2], H.aabb.max[0], H.aabb.max[2]]);
    // the placement census (Node gate only: globalThis.__LC_BOXES is null in the game) sees every drawn structure box with this generator's name on its stack
    if (globalThis.__LC_BOXES) {
      const st = hgStack();
      // (the attic's gable layers and the ramps - the roof planks a chimney or a ridge rests on, the stairs - are structure too: their boxes join the record)
      // (a roof plank is drawn hv above and below its ramp's walk line - housegen rampHalfV - and the ridge cap rests on the DRAWN plank: its box is the ramp's grown by hv)
      const planks = H.ramps.map((r) => { const hv = r.roof ? HG.rampHalfV(r) : 0; return { p: "ramp", min: [r.min[0], r.min[1] - hv, r.min[2]], max: [r.max[0], r.max[1] + hv, r.max[2]] }; });
      for (const bx of H.boxes.concat(planks)) {
        if (bx.p === "glass" || bx.p === "deco" || bx.p === "furn") continue;
        const P = [];
        for (const xi of [bx.min[0], bx.max[0]]) for (const yi of [bx.min[1], bx.max[1]]) for (const zi of [bx.min[2], bx.max[2]]) P.push(xi, yi, zi);
        globalThis.__LC_BOXES.push({ geo: { attributes: { position: { count: 8, getX: (k) => P[k * 3], getY: (k) => P[k * 3 + 1], getZ: (k) => P[k * 3 + 2] } } }, w: bx.max[0] - bx.min[0], h: bx.max[1] - bx.min[1], d: bx.max[2] - bx.min[2], stack: st });
      }
    }
    const fc = H.facade || {}, look = "hg:" + (fc.mat || "") + (fc.color != null ? fc.color.toString(16) : "") + "|" + H.roof + "|" + H.storeys + "|" + b.w + "x" + b.d + "|" + H.plan + "|" + (H.trim != null ? H.trim.toString(16) : "");
    return { H, look, roofTop: H.floors[H.floors.length - 1].ceil + HG.SLAB };
  }
  /** WAVE 8: the furniture chunks and the map's glass, after the kit (its GLBs are the kit's: one parse, the same lazy loader). Kit pieces are baked into the
   *  chunk mesh (their GLB triangles, the GLB materials' colours as vertex colours, x HG_INDOOR); a type whose GLB did not load (or a page on the ultra-low tier)
   *  draws its collider box instead - the collider never depends on the GLB. One MeshStandardMaterial (vertex colours) for every chunk: one program,
   *  compiled in the warm frame (it forces the hidden chunks visible). */
  async function buildHouseFurniture() {
    if (!houses.length) return;
    const kit = W._cityKit, low = W.settings && W.settings.graphics === "ultra-low";
    const types = new Set();
    for (const C of hgChunks.values()) for (const e of C.kit) types.add(e.type);
    const tpl = new Map();                                                     // type -> [{ pos (the GLB mesh's matrix applied), nor, idx, col [r, g, b] }] | null
    const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
    if (kit && !low && typeof kit.parts === "function") {
      for (const t of types) {
        let rec = null;
        try { rec = await kit.parts(t); } catch (e) { rec = null; }
        if (!rec || rec.failed || !rec.parts) { tpl.set(t, null); continue; }
        const out = [];
        for (const pt of rec.parts) {
          const gp = pt.geometry.attributes.position, gn = pt.geometry.attributes.normal, gi = pt.geometry.index;
          if (!gp) continue;
          _nm.getNormalMatrix(pt.local);
          const pos = new Float32Array(gp.count * 3), nor = new Float32Array(gp.count * 3);
          for (let i = 0; i < gp.count; i++) {
            _v.set(gp.getX(i), gp.getY(i), gp.getZ(i)).applyMatrix4(pt.local); pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
            if (gn) _n.set(gn.getX(i), gn.getY(i), gn.getZ(i)).applyMatrix3(_nm).normalize(); else _n.set(0, 1, 0);
            nor[i * 3] = _n.x; nor[i * 3 + 1] = _n.y; nor[i * 3 + 2] = _n.z;
          }
          const idx = gi ? Array.from(gi.array) : Array.from({ length: gp.count }, (_, i) => i);
          const m = Array.isArray(pt.material) ? pt.material[0] : pt.material, c = m && m.color ? [m.color.r, m.color.g, m.color.b] : [0.6, 0.6, 0.6];
          out.push({ pos, nor, idx, col: c });
        }
        tpl.set(t, out.length ? out : null);
      }
    }
    const COSQ = [1, 0, -1, 0], SINQ = [0, 1, 0, -1];
    const mat = dualStructMaterial();                                         // (the district meshes' material: one program for the town, its insides and its furniture)
    const meshes = [];
    let kitBoxes = 0;
    const BOXV = 20, BOXI = 30;                                               // (a collider-box stand-in: five faces, no underside)
    // size of a part list (housegen's inside faces / authored furniture) + kit pieces (their GLB parts, or a box)
    const sizeOf = (parts, kitL) => {
      let nv = 0, ni = 0;
      for (let q = 0; q < parts.length; q += 3) { nv += parts[q].pos.length / 3; ni += parts[q].idx.length; }
      for (const e of kitL) { const kp = tpl.get(e.type); if (kp) for (const t of kp) { nv += t.pos.length / 3; ni += t.idx.length; } else { nv += BOXV; ni += BOXI; } }
      return [nv, ni];
    };
    // (Wave 8 fix round, lane K1) TWO BatchedMeshes per map: the houses' INSIDES ("houses:inside@all": room walls, floors, ceilings, stair steps, door leaves, lamp
    // panels - structure) and their FURNITURE ("houses:pieces@all": authored pieces and the baked kit GLBs, lcPart furniture); the 32 m chunks are their instances,
    // each shown / hidden by the distance check below (the same chunks, the same triangles, the same 60 m rule; three culls each instance by the frustum too).
    //  - the 32 m chunk meshes were one geometry each: 131-220 per map, and how many depended on the seed's layout (Isla Viva 158-193 over five seeds) - every lobby
    //    held a different count (hud_cycle: lobby geometries 324-386 between rounds, the bar +-30, ~1.7x the live build). A batch is one geometry (+ its two small
    //    data textures: instance matrices, draw ids), one material, one multi-draw call: every map holds exactly two, whatever the seed (a batch per region made the
    //    texture count follow the layout instead).
    //  - a chunk mixed both, so whoever reads the drawn triangles (interiorcheck's page judge) had to guess by box which triangle was furniture: a piece's own faces
    //    lie ON its box, read as walls, and hid the piece and what stood behind it (verify_b furniture-view 148/150). Two meshes say which is which.
    const regions = new Map();                                                // region key -> { key, chunks: [[C, insideSize, piecesSize]], sizes, bm: { inside, pieces } }
    for (const C of hgChunks.values()) {
      const si = sizeOf(C.inside, []), sp = sizeOf(C.parts, C.kit);
      if (!si[1] && !sp[1]) continue;
      const rk = "all";
      let Rg = regions.get(rk);
      if (!Rg) regions.set(rk, Rg = { key: rk, chunks: [], n: { inside: [0, 0, 0], pieces: [0, 0, 0] }, bm: {} });
      Rg.chunks.push([C, si, sp]);
      if (si[1]) { Rg.n.inside[0]++; Rg.n.inside[1] += si[0]; Rg.n.inside[2] += si[1]; }
      if (sp[1]) { Rg.n.pieces[0]++; Rg.n.pieces[1] += sp[0]; Rg.n.pieces[2] += sp[1]; }
    }
    const lod = [];                                                           // per chunk: { box, on, inst: [[bm, iid], ...] }
    const batches = [];
    for (const Rg of regions.values()) for (const kind of ["inside", "pieces"]) {
      const [nI, nV, nIdx] = Rg.n[kind];
      if (!nI) continue;
      const bm = new THREE.BatchedMesh(nI, nV, nIdx, mat);
      bm.name = "houses:" + kind + "@" + Rg.key; bm.castShadow = false; bm.receiveShadow = true;
      bm.sortObjects = false;                                                  // (opaque chunks: no per-frame depth sort and its garbage; per-chunk frustum culling stays on)
      bm.userData.hgChunk = kind + ":" + Rg.key; bm.userData.lcPart = kind === "pieces" ? "furniture" : "inside";
      Rg.bm[kind] = bm; batches.push(bm);
    }
    const n8 = (x) => (x >= 1 ? 127 : x <= -1 ? -127 : Math.round(x * 127)), c8 = (x) => (x >= 1 ? 255 : x <= 0 ? 0 : Math.round(x * 255));
    // one chunk's part list + kit list -> a BufferGeometry in the batches' layout (never drawn itself: copied into the batch)
    const chunkGeo = (parts, kitL, nv, ni) => {
      const P = new Float32Array(nv * 3), N = new Int8Array(nv * 3), UV = new Float32Array(nv * 2), CO = new Uint8Array(nv * 3), TK = new Uint8Array(nv), ID = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let v = 0, ii = 0;
      for (let q = 0; q < parts.length; q += 3) {
        const a = parts[q], k = parts[q + 1], tki = parts[q + 2], n = a.pos.length / 3, base = v;
        for (let i = 0; i < n * 3; i++) { P[v * 3 + i] = a.pos[i]; N[v * 3 + i] = n8(a.nor[i]); CO[v * 3 + i] = c8(a.col[i] * k); }
        for (let i = 0; i < n * 2; i++) UV[v * 2 + i] = a.uv[i];
        TK.fill(tki, v, v + n);
        for (let i = 0; i < a.idx.length; i++) ID[ii++] = a.idx[i] + base;
        v += n;
      }
      for (const e of kitL) {
        const kp = tpl.get(e.type), c = COSQ[e.rot & 3], sn = SINQ[e.rot & 3];
        if (kp) {
          for (const t of kp) {
            const base = v, cr = c8(t.col[0] * HG_INDOOR), cg = c8(t.col[1] * HG_INDOOR), cb = c8(t.col[2] * HG_INDOOR);
            for (let i = 0; i < t.pos.length; i += 3) {
              const lx = t.pos[i], ly = t.pos[i + 1], lz = t.pos[i + 2], px = e.x + lx * c + lz * sn, py = e.y + ly, pz = e.z - lx * sn + lz * c;
              const nx = t.nor[i], ny = t.nor[i + 1], nz = t.nor[i + 2], wx = nx * c + nz * sn, wz = -nx * sn + nz * c;
              P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz;
              N[v * 3] = n8(wx); N[v * 3 + 1] = n8(ny); N[v * 3 + 2] = n8(wz);
              CO[v * 3] = cr; CO[v * 3 + 1] = cg; CO[v * 3 + 2] = cb;
              // a planar uv on the face's dominant axis (the stucco grain at 2 m a tile: the pieces read as painted / upholstered, not as flat plastic)
              const ax = Math.abs(wx), ay = Math.abs(ny), az = Math.abs(wz);
              if (ay >= ax && ay >= az) { UV[v * 2] = px / 2; UV[v * 2 + 1] = pz / 2; } else if (ax >= az) { UV[v * 2] = pz / 2; UV[v * 2 + 1] = py / 2; } else { UV[v * 2] = px / 2; UV[v * 2 + 1] = py / 2; }
              TK[v] = 2; v++;
            }
            for (let i = 0; i < t.idx.length; i++) ID[ii++] = t.idx[i] + base;
          }
        } else {                                                                 // the collider box, five faces (no underside), a neutral brown
          kitBoxes++;
          const x0 = e.min[0], y0 = e.min[1], z0 = e.min[2], x1 = e.max[0], y1 = e.max[1], z1 = e.max[2], cc = hgCol(0x8a7560);
          const quad = (a, b2, c2, d, n) => {
            const base = v;
            for (const w of [a, b2, c2, d]) {
              P[v * 3] = w[0]; P[v * 3 + 1] = w[1]; P[v * 3 + 2] = w[2]; N[v * 3] = n[0] * 127; N[v * 3 + 1] = n[1] * 127; N[v * 3 + 2] = n[2] * 127;
              CO[v * 3] = c8(cc[0] * HG_INDOOR); CO[v * 3 + 1] = c8(cc[1] * HG_INDOOR); CO[v * 3 + 2] = c8(cc[2] * HG_INDOOR);
              UV[v * 2] = n[1] ? w[0] / 2 : n[0] ? w[2] / 2 : w[0] / 2; UV[v * 2 + 1] = n[1] ? w[2] / 2 : w[1] / 2; TK[v] = 1; v++;
            }
            ID[ii++] = base; ID[ii++] = base + 1; ID[ii++] = base + 2; ID[ii++] = base; ID[ii++] = base + 2; ID[ii++] = base + 3;
          };
          quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
          quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
          quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
          quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
          quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(N, 3, true));
      geo.setAttribute("color", new THREE.BufferAttribute(CO, 3, true));
      geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
      geo.setAttribute("tki", new THREE.BufferAttribute(TK, 1));
      geo.setIndex(new THREE.BufferAttribute(ID, 1));
      return geo;
    };
    for (const Rg of regions.values()) for (const [C, si, sp] of Rg.chunks) {
      const L = { box: [C.x0, C.y0, C.z0, C.x1, C.y1, C.z1], on: false, inst: [] };
      for (const [kind, sz, parts, kitL] of [["inside", si, C.inside, []], ["pieces", sp, C.parts, C.kit]]) {
        if (!sz[1]) continue;
        // (copied into the region's batch: the chunk geometry is never drawn, never uploaded)
        const bm = Rg.bm[kind], gid = bm.addGeometry(chunkGeo(parts, kitL, sz[0], sz[1])), iid = bm.addInstance(gid);
        bm.setVisibleAt(iid, false);                                           // (shown by the distance check below once a camera exists; the warm frame draws the batch - its program and buffers)
        L.inst.push([bm, iid]);
      }
      C.kit.length = 0; C.parts.length = 0; C.inside.length = 0;
      lod.push(L);
    }
    for (const bm of batches) { bm.computeBoundingBox(); bm.computeBoundingSphere(); g.add(bm); meshes.push(bm); }
    if (hgGlass.idx.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(hgGlass.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(hgGlass.nor, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(hgGlass.col, 3));
      geo.setIndex(hgGlass.idx);
      geo.computeBoundingSphere();
      const gm = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.05, metalness: 0 });
      gm.name = "houses:glass";
      // clear (0.3) up to 35 m, a dark glazing (0.9, the sky's reflection) from 60 m: past HG_FURN_DIST the inside of a house is not drawn
      gm.customProgramCacheKey = () => "lc-house-glass-v1";
      gm.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", "diffuseColor.a = mix(diffuseColor.a, 0.9, smoothstep(35.0, 60.0, length(vViewPosition)));\n#include <opaque_fragment>");
      };
      const glass = new THREE.Mesh(geo, gm);
      glass.name = "houses:glass"; glass.castShadow = false; glass.receiveShadow = false; glass.renderOrder = 2; glass.userData.lcPart = "glass";
      g.add(glass);
      hgGlass.pos = hgGlass.nor = hgGlass.col = hgGlass.idx = null;
    }
    // furniture beyond HG_FURN_DIST of the camera is not drawn (distance to the chunk's box), checked 4 times a second
    let t = 9;
    trackUpdater((dt) => {
      t += dt; if (t < 0.25) return;
      const cam = W.camera; if (!cam) return;
      t = 0;
      const px = cam.position.x, py = cam.position.y, pz = cam.position.z, D2 = HG_FURN_DIST * HG_FURN_DIST;
      for (let i = 0; i < lod.length; i++) {
        const L = lod[i], bx = L.box;
        const dx = px < bx[0] ? bx[0] - px : px > bx[3] ? px - bx[3] : 0, dy = py < bx[1] ? bx[1] - py : py > bx[4] ? py - bx[4] : 0, dz = pz < bx[2] ? bx[2] - pz : pz > bx[5] ? pz - bx[5] : 0;
        const on = dx * dx + dy * dy + dz * dz <= D2;
        if (on !== L.on) { L.on = on; for (const q of L.inst) q[0].setVisibleAt(q[1], on); }
      }
    });
    city.furniture = { chunks: lod.length, regions: batches.length, kitTypes: types.size, kitBaked: [...tpl.values()].filter(Boolean).length, kitBoxes };
  }
  function buildCityBuildings() {
    const { TG, lay } = city;
    const cell = mapId === "ashgrid" ? 600 : 300;   // (Wave 7b: a themed map's compounds share a district per 300 m cell - fewer compounds per mesh: the frustum drops the ones behind a street camera and the shadow pass the far ones) (7A2: compounds share a district per 600 m cell, was 300 m: a compound is 3-5 small buildings, and every district costs 2-3 structure draw calls (twice with the shadow pass) in every view that sees it - 9 compound districts were 36 calls of a seed-1 drop view)
    city.looks = new Map();               // "<town>:<parcel>" -> one string naming everything that distinguishes the building's look (the gates count distinct looks per town)
    padReuse = true;
    for (const T of lay.towns.concat(lay.compounds)) {
      const isCmp = T.id.startsWith("cmp"), grid = T.blocks.length > 0, clus = !!T.compound && !grid;     // clus: a compound, or a POI whose grid did not fit (a lane)
      const c0 = isCmp ? [T.compound.entry.x, T.compound.entry.z] : T.centre;
      const did = isCmp ? "cmp:" + Math.floor((c0[0] + HALF) / cell) + "," + Math.floor((c0[1] + HALF) / cell) : "town:" + T.id;
      if (isCmp && mapId !== "ashgrid") { const q = T.compound.bounds; if (!distParts.has(did)) distParts.set(did, []); distParts.get(did).push([(q[0] + q[2]) / 2, (q[1] + q[3]) / 2, Math.hypot(q[2] - q[0], q[3] - q[1]) / 2 + 6]); }
      useDistrict(did);
      if (T.kind === "docks" && T.docks) buildDockDecks(T);                  // (Wave 7b: the decks and posts exist before the houses that stand on them: one connected structure to the seabed)
      const dim = T.theme === "ruin" ? 0.8 : 1;
      const core = T.kind === "core";
      const blockLoot = new Map(), blockHome = new Map();       // block id -> loot points it holds / its first enterable building (every block ends up holding loot)
      for (const p of T.parcels) {
        // (Wave 7b stage B: a layout's building record carries no `use` - the parcel does - so every `b.use` test below read undefined: on the themed maps every shop, hall, shed and barn
        //  was styled, textured and looted as a house (no shop fronts, no awnings). The themed maps read the parcel's use; Savanna keeps what it built (its world must hash as the live one).)
        const b = mapId !== "ashgrid" && p.building && p.building.use == null ? Object.assign({}, p.building, { use: p.use }) : p.building;
        if (!b) continue;
        const nLoot0 = lootPoints.length + chestPoints.length;
        let nHouseLoot = 0;                                       // (WAVE 8: a housegen house's own points - loot.js lays them - count as the block's loot)
        const wallKey = b.arch === "shop" ? "shop" : (b.gen === "tower" ? "big" : b.use === "barn" ? "barn" : b.use === "hall" ? "hall" : b.use === "shed" ? "shed" : "house");
        const PAL = cityPalette(T, isCmp ? -1 : p.block, core), cr = TG.subRng(seed, T.id, "col" + p.id), sr = TG.subRng(seed, T.id, "sty" + p.id);
        const q1 = cr(), q2 = cr(), q3 = cr(), q4 = cr(), vr = TG.subRng(seed, T.id, "var" + p.id), v1 = vr(), v2 = vr();
        structTile = q4 < 0.2 ? 1.9 : q4 < 0.6 ? 2.6 : q4 < 0.85 ? 3.6 : 5.0;                  // (D2: brick size varies per building: the one texture reads as four wall finishes)
        let wallC = shade(q1 < 0.55 ? PAL[wallKey][0] : q1 < 0.84 ? PAL[wallKey][1] : SAV.walls[wallKey][Math.floor(q3 * SAV.walls[wallKey].length)], dim);
        let roofC = shade(q2 < 0.5 ? PAL.roof[0] : q2 < 0.84 ? PAL.roof[1] : SAV.roofs[Math.floor(q3 * SAV.roofs.length)], dim);
        if (T.kind === "crater") {                                                                          // Wave 7b: the crater-rim village is dry-stone, its roofs dark old timber, each house in its own district quarter
          wallC = RUIN_STONE[Math.floor(q1 * RUIN_STONE.length) % RUIN_STONE.length]; roofC = q2 < 0.5 ? "#5b4a3d" : "#6c6256";
          // (one district for the whole village: four quarter districts were 4-8 draw calls of every endgame view for ~2 k triangles each)
        }
        let look = wallC + roofC;
        if (b.gen === "shell") {
          const ctr = SHELL_CENTRE[b.kit] || [0, 0], q = b.turn, cs = [1, 0, -1, 0][q], sn = [0, 1, 0, -1][q];
          const hx = (b.aabb[2] - b.aabb[0]) / 2, hz = (b.aabb[3] - b.aabb[1]) / 2, y = groundPad(b.cx, b.cz, hx, hz, { gen: "shell" });
          city.kit.push({ type: b.kit, x: b.cx - (ctr[0] * cs + ctr[1] * sn), y, z: b.cz - (-ctr[0] * sn + ctr[1] * cs), rot: q, district: did, palette: b.palette && b.palette.variant ? b.palette.variant : undefined, sy: b.sy });
          look = b.kit + "|" + (b.palette && b.palette.variant || "") + "|" + (b.sy || 1);
          if (b.height > 30) city.skyline.push({ x: b.cx, z: b.cz, h: b.height, kind: "shell", town: T.id });
        } else if (city.HG) {
          // WAVE 8: a furnished housegen house (see hgHouse); a tower / mid-rise keeps its rooftop crown (the units, a mast, Savanna's curtain-wall shaft, a resort terrace)
          // standing on the housegen roof (the crown functions measure from y + floors x 4 + 0.3: they are handed the y that puts that on the roof slab's top)
          legacyRolls(T, b, isCmp, core, sr, PAL, roofC);
          const hr = hgHouse(T, p, b, did, wallC, roofC);
          look = hr.look;
          nHouseLoot += hr.H.loot.length + hr.H.chests.length;
          if (b.gen === "tower") {
            const yc = hr.roofTop - b.floors * 4 - 0.3;
            const shaftH = mapId === "ashgrid" ? towerCrown(b, yc, sr, core, wallC, T.id) : themedCrown(b, yc, sr);
            look += shaftH ? "s" + Math.round(shaftH / 6) : "";
          }
        } else if (b.gen === "tower") {
          const base = core ? SAV.tower.core : SAV.tower.town, mull = SAV.mullions[Math.floor(sr() * SAV.mullions.length)];
          const tO = { loot: base.loot, chest: base.chest, mullion: mull };
          if (mapId !== "ashgrid") {                                                                         // (stage B: a resort apartment block / a timber lodge, not a brick car park)
            if (mapId === "isla_viva") { tO.wallTex = "stucco"; tO.balcony = "#f4f1e8"; tO.parapetC = "#f2efe6"; }
            else { tO.wallTex = "plank"; tO.balcony = "#5a4430"; tO.parapetC = "#4a3626"; }
          }
          const y = towerTurn(b.cx, b.cz, b.floors, b.w, wallC, T.id, b.turn, tO);
          const shaftH = mapId === "ashgrid" ? towerCrown(b, y, sr, core, wallC, T.id) : themedCrown(b, y, sr);
          look += mull + b.floors + "x" + b.w + (shaftH ? "s" + Math.round(shaftH / 6) : "");
        } else {
          const lt = isCmp ? (b.use === "shed" ? SAV.loot.cmpShed : SAV.loot.cmpHouse) : (SAV.loot[b.use] || SAV.loot.house);
          const o = { loot: lt[0], chest: lt[1], doorW: 2.26 };       // the 2.26 m door of the layout (wallDoorwayWide): a 1.4 m door leaves a capsule 0.5 m a side
          const fh = b.floorH || 3.4;
          let storeys, st;
          if (mapId !== "ashgrid") {                                                                          // Wave 7b: a resort / a lodge: its own style dice (themedStyle), its wall texture
            st = themedStyle(b, sr, PAL, roofC, fh); storeys = st.storeys;
            const wt = themedWallTex(b, v2); if (wt) o.wallTex = wt;
            if (storeys === 2 && T.kind !== "crater" && !b.deck) o.upper = true;                          // (Wave 7b stage B: the two-storey houses and shops get their real upper floor; not the ruins, not a stilt house on the docks)
          } else {
          storeys = (b.use === "house" || b.use === "shop") && b.floors >= 2 && sr() < 0.75 ? 2 : 1;      // a two-storey front on the big houses and shops (one real floor inside until Wave 8)
          if (storeys === 2 && b.w >= 12.5 && v1 < 0.3) storeys = 3;                                          // D2: a few three-storey fronts (a 10 m façade: height variety in a street)
          st = { storeys, floorH: fh, glass: SAV.glass[Math.floor(sr() * SAV.glass.length)] };
          if (b.use === "shop") { st.shopfront = true; st.roof = 2; st.awning = sr() < 0.75 ? (sr() < 0.6 ? PAL.awning[0] : PAL.awning[1]) : null; st.sign = shade(roofC, 0.9); st.unit = sr() < 0.4 ? (sr() < 0.5 ? -1 : 1) : 0; }
          else if (b.use === "hall") { st.roof = 2; st.blindBack = true; st.unit = sr() < 0.6 ? 1 : 0; }
          else if (b.use === "barn") { st.roof = 0; st.blindBack = true; }
          else if (b.use === "shed") { st.roof = sr() < 0.5 ? 0 : 1; st.blindBack = true; }
          else { const rr = sr(); st.roof = rr < 0.42 ? 0 : rr < 0.64 ? 1 : rr < 0.8 ? 3 : 2; st.chimney = sr() < 0.4 ? (sr() < 0.5 ? -1 : 1) : 0; st.porch = sr() < 0.55; st.unit = st.roof === 2 && sr() < 0.5 ? 1 : 0; }
          st.trim = (b.use === "house" || b.use === "shop") ? (v2 < 0.3 ? 1 : v2 < 0.5 ? 2 : 0) : 0;         // D2: a cornice band (cream / dark) under the roof edge
          }
          o.style = st;
          o.H = fh * storeys;
          o.flat = st.roof === 2;
          if (T.kind === "crater") ruinHouse(b.cx, b.cz, b.w, b.d, b.rot, wallC, roofC, T.id, TG_subRng(T.id, "ruin" + p.id), o);
          else { if (b.deck) o.y0 = b.y0; house(b.cx, b.cz, b.w, b.d, b.rot, wallC, roofC, T.id, o); }
          look += st.roof + "" + storeys + (st.chimney ? "c" : "") + (st.porch ? "p" : "") + (st.awning || "") + b.w + "x" + b.d + st.glass + structTile + st.trim;
        }
        city.looks.set(T.id + ":" + p.id, look);
        blockLoot.set(p.block, (blockLoot.get(p.block) || 0) + (lootPoints.length + chestPoints.length - nLoot0) + nHouseLoot);
        if (b.enterable && b.gen !== "shell" && !blockHome.has(p.block)) blockHome.set(p.block, b);
      }
      structTile = STRUCT_TILE;
      if (T.kind === "crater") buildCrater(T);
      else if (T.kind === "mill" && T.mill) buildMill(T);
      for (const [bid, home] of blockHome) if (!blockLoot.get(bid)) loot(home.cx, heightAt0(home.cx, home.cz) + 0.5, home.cz, T.id);   // a block the dice left empty gets one floor item
      if (clus && !SPECIAL_KINDS[T.kind]) {
        const fr = TG.subRng(seed, T.id, "fence"), fs = SAV.fences[Math.floor(fr() * SAV.fences.length)];
        for (const f of T.compound.fence) addFence(f[0], f[1], f[2], f[3], fs[1], 0.2, fs[0]);
        for (const cr2 of T.compound.cars) props.car.push({ x: cr2.x, y: heightAt0(cr2.x, cr2.z), z: cr2.z, s: 2.2, ry: cr2.turn * Math.PI / 2 });
        for (const q of T.compound.props) {                    // the farmstead's silo, the water tower of a homestead, a depot's shipping containers
          if (q.kind === "silo") {
            const sy = groundPad(q.x, q.z, 2.4, 2.4, { gen: "silo" });
            addBox(q.x, sy + 5.5, q.z, 4.4, 11, 4.4, "#cfc4a2"); addBox(q.x, sy + 11.4, q.z, 5, 0.8, 5, "#7a5a44", { collide: false });
            addBox(q.x, sy + 11.9, q.z, 2.4, 0.9, 2.4, "#8a6a50", { collide: false });
          } else if (q.kind === "watertower") waterTower(q.x, q.z, T.id);
          else if (q.kind === "container") city.kit.push({ type: "props/shipping-container", x: q.x, y: cityKitY("props/shipping-container", q.x, q.z, q.rot, CITY_SW_LIFT - 0.01), z: q.z, rot: q.rot, district: did });
        }
        buildCompoundDecor(T);
      }
      if (grid) {
        // pocket parks get two acacias (the map's own instanced tree, with its baked trunk collider), at two of the lot's four corners
        for (const p of T.parcels) {
          if (p.use !== "lot" || p.lot !== "park") continue;
          const tr = TG.subRng(seed, T.id, "tree" + p.id), r = p.rect, cx4 = [[r[0] + 5, r[1] + 5], [r[2] - 5, r[1] + 5], [r[0] + 5, r[3] - 5], [r[2] - 5, r[3] - 5]];
          for (let k = 0; k < 2; k++) {
            const c = cx4.splice(Math.floor(tr() * cx4.length), 1)[0], sc = 0.85 + tr() * 0.4, ry = tr() * Math.PI * 2;
            props[cityTree].push({ x: c[0], y: heightAt0(c[0], c[1]), z: c[1], s: sc, ry });
          }
        }
        if (mapId !== "ashgrid") streetTrees(T);
        for (const p of T.parcels) if (p.use === "lot" && LM_MIN[p.lot]) buildLandmark(T, p);          // D2: gas stations, markets, clock-tower plazas, courts
        // back-yard acacias (7A2): a house, and a shop with room behind it, in a town or village block gets one at a back corner of its lot, 45 % of the time
        if (!core) for (const p of T.parcels) {
          const b = p.building;
          if (!b || b.gen === "shell" || b.gen === "tower" || (b.use !== "house" && b.use !== "shop")) continue;
          const tr = TG.subRng(seed, T.id, "yard" + p.id);
          if (tr() > (mapId === "ashgrid" ? 0.45 : 0.22)) continue;                 // (Wave 7b: a palm / pine is dearer in triangles than the acacia: the themed back yards keep half as many)
          const r = p.rect, [fx, fz] = p.facing, a = b.aabb, ux = tr() < 0.5 ? 1 : -1;
          const tx = fz ? (ux > 0 ? r[2] - 2.6 : r[0] + 2.6) : (fx > 0 ? r[0] + 2.6 : r[2] - 2.6), tz = fz ? (fz > 0 ? r[1] + 2.6 : r[3] - 2.6) : (ux > 0 ? r[3] - 2.6 : r[1] + 2.6);
          if (tx > a[0] - 2.4 && tx < a[2] + 2.4 && tz > a[1] - 2.4 && tz < a[3] + 2.4) continue;          // (the building's own footprint, with a crown's room)
          props[cityTree].push({ x: tx, y: heightAt0(tx, tz), z: tz, s: 0.8 + tr() * 0.35, ry: tr() * Math.PI * 2 });
        }
        // street dressing: kit lights, hydrants, benches, planters, parked cars, lot dressing (towngen's data; y = the ground each one stands on)
        for (const e of TG.streetProps(T, seed)) {
          const onRoad = e.kind === "car", y = cityKitY(e.type, e.x, e.z, e.rot, onRoad ? ROAD_LIFT - 0.02 : CITY_SW_LIFT - 0.01);
          city.kit.push({ type: e.type, x: e.x, y, z: e.z, rot: e.rot, district: did, tint: e.tint });
          if (e.kind === "light") { const fa = [[0, 1], [1, 0], [0, -1], [-1, 0]][e.rot]; lampPts.push({ x: e.x - fa[0] * 1.6, y: y + (e.type === "props/light-square" ? 5.2 : 5.9), z: e.z - fa[1] * 1.6 }); city.lights++; }
        }
        if (mapId !== "ashgrid") themedLots(T, did);                                                       // (stage B: beach bars, pool decks, café umbrellas / campfires, woodyards)
      }
    }
    sink = batches;
    padReuse = false;
    for (const it of city.kit) for (const c of city.CK.colliderFor(it.type, it.x, it.y, it.z, it.rot, undefined, it.sy)) cityKitBoxes.push(c);
  }
  /** (stage B) the roof of a themed tower: a resort's roof terrace (a parasol, two loungers, a white stair head on the -X side, away from the chest in the middle and the ramp on +X); a lodge's
   *  timber water tank on four legs and a stone chimney. Cosmetic; the parcel's style stream. No curtain-wall shaft: that is Savanna's skyline. */
  function themedCrown(b, y, sr) {
    const ry = y + b.floors * 4 + 0.3, rot = b.rot, fw = b.w, NC = { collide: false }, d1 = sr(), d2 = sr();
    if (mapId === "isla_viva") {
      addBoxR(b.cx, b.cz, -fw * 0.3, -fw * 0.3, ry + 1.1, 2.0, 2.2, 2.2, "#f2efe6", rot, NC);
      const px = -fw * 0.28, pz = fw * 0.24, c = Math.cos(rot), s = Math.sin(rot), wx = b.cx + px * c + pz * s, wz = b.cz - px * s + pz * c;
      addBox(wx, ry + 1.1, wz, 0.09, 2.2, 0.09, "#e8e4da", NC); coneAt(wx, ry + 1.95, wz, 1.4, 0.55, 8, SAV.awnings[Math.floor(d1 * SAV.awnings.length)], d2 * Math.PI);
      for (const k of [-1, 1]) addBoxR(b.cx, b.cz, -fw * 0.28 + k * 1.0, fw * 0.24 - 1.9, ry + 0.18, 0.7, 0.36, 1.9, "#f4f1e8", rot, NC);
    } else {
      for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) addBoxR(b.cx, b.cz, -fw * 0.3 + lx, -fw * 0.28 + lz, ry + 0.9, 0.2, 1.8, 0.2, "#4a3626", rot, NC);
      addBoxR(b.cx, b.cz, -fw * 0.3, -fw * 0.28, ry + 2.6, 2.4, 1.8, 2.4, "#6b4a2e", rot, { collide: false, tex: "plank" });
      addBoxR(b.cx, b.cz, -fw * 0.3, -fw * 0.28, ry + 3.6, 2.7, 0.2, 2.7, "#3a2c20", rot, NC);
      addBoxR(b.cx, b.cz, -fw * 0.32, fw * 0.3, ry + 1.0, 1.0, 2.0, 1.0, "#6f6a62", rot, { collide: false, tex: "block" });
    }
    return 0;
  }
  // rooftop dressing of an enterable tower: a pair of units on the roof's -X side (away from the chest in the middle and the access ramp along +X) and, on a core
  // tower, an antenna mast. Cosmetic, no collider; the dice are the parcel's own style stream.
  function towerCrown(b, y, sr, core, wallC, townId) {
    const ry = y + b.floors * 4 + 0.3, rot = b.rot, fw = b.w, NC = { collide: false };
    const u1 = sr(), u2 = sr(), u3 = sr(), mast = sr();
    const shaft = towerShaft(b, ry, sr, core, wallC, townId);
    if (shaft) return shaft;                                  // (the slab stands where the crown's units would: it is the crown)
    addBoxR(b.cx, b.cz, -fw * 0.3, -fw * 0.28, ry + 0.55, 1.9, 1.1, 1.4, "#8f969c", rot, NC);
    if (u1 < 0.7) addBoxR(b.cx, b.cz, -fw * 0.3, fw * 0.08 + u2 * fw * 0.1, ry + 0.45, 1.3, 0.9, 1.3, "#a6acb1", rot, NC);
    if (u3 < 0.35) addBoxR(b.cx, b.cz, -fw * 0.12, -fw * 0.3, ry + 1.1, 2.2, 2.2, 2.2, shade("#8d949a", 0.9), rot, NC);      // a stair / lift head
    if (core ? mast < 0.6 : mast < 0.2) {
      const mh = 3 + u2 * 5;
      addBoxR(b.cx, b.cz, -fw * 0.34, fw * 0.3, ry + mh / 2, 0.28, mh, 0.28, "#5d6268", rot, NC);
      addBoxR(b.cx, b.cz, -fw * 0.34, fw * 0.3, ry + mh * 0.8, 1.6, 0.16, 0.16, "#5d6268", rot, NC);
    }
    return 0;
  }
  // D2 (Wave 7 completion) the tall shaft of an enterable tower: the roof is a walkable deck (a chest in the middle, the access ramp on the +X flank), so a skyscraper cannot
  // simply stand on it - but a SLAB can stand on its -X strip (the crown's units already live there), leaving two thirds of the deck for the chest, the ramp and a fight. The shaft is
  // solid (one exact box collider, a wall to the roof's players), drawn with dark glass ribbons every 3.6 m so it reads as a curtain-wall tower from the plane, a cap and a mast. Core
  // towers 70 % of the time (18-72 m of shaft over the 12 m roof: 30-84 m in all), town mid-rises 30 % (8-24 m). The dice come after the crown's own, on the parcel's style stream.
  function towerShaft(b, ry, sr, core, wallC, townId) {
    const d1 = sr(), d2 = sr(), d3 = sr(), d4 = sr();
    if (d1 > (core ? 0.7 : 0.3)) return 0;
    const fw = b.w, rot = b.rot, NC = { collide: false };
    const sw = Math.min(fw * 0.42, Math.round((5 + d2 * 3) * 2) / 2), dep = fw - 1.4, H = core ? 18 + d3 * 54 : 8 + d3 * 16, lx = -fw / 2 + 0.55 + sw / 2;
    // four curtain-wall schemes [body, ribbon]: blue glass between pale floor bands, a pale tower with blue glass ribbons, brick red with cream bands, slate with steel bands - every one a
    // value contrast the 330 m haze does not erase (a tan tower on tan haze was the Wave-7 skyline)
    const sch = [["#3f5f7e", "#a9b8c6"], ["#d2cfc4", "#4d6a84"], ["#8a4a39", "#c8aa90"], ["#55606b", "#8fa0b0"]][Math.floor(d4 * 4) % 4], body = sch[0], glass = sch[1];
    addBoxR(b.cx, b.cz, lx, 0, ry + H / 2, sw, H, dep, body, b.rot, { tex: "block" });
    for (let t = 2.2; t + 0.9 <= H - 0.8; t += 3.6) addBoxR(b.cx, b.cz, lx, 0, ry + t + 0.45, sw + 0.12, 0.9, dep + 0.12, glass, rot, NC);
    addBoxR(b.cx, b.cz, lx, 0, ry + H + 0.25, sw + 0.5, 0.5, dep + 0.5, shade(body, 0.62), rot, NC);
    if (core && d2 > 0.3) addBoxR(b.cx, b.cz, lx, 0, ry + H + 0.5 + 2 + d3 * 3, 0.3, 4 + d3 * 6, 0.3, "#5d6268", rot, NC);
    city.skyline.push({ x: b.cx, z: b.cz, h: Math.round((b.floors * 4 + 0.3 + H + 0.5) * 10) / 10, kind: "shaft", town: townId });
    return H;
  }
  // ── the paint: sidewalks, plazas, lots, lane lines, crosswalks (after the bake: every vertex on the ground the player stands on) ──────────────────────
  // Two merged meshes, vertex-coloured, wearing the same grain texture as the roads so they share ONE program with the structures: "city:ground" (the 3 m
  // sidewalk ring and the plaza of every block, the parking / park / yard lots) and "city:paint" (centre dashes, zebra crossings). Each quad is lifted
  // above the ground under its own four corners and centre (a quad that spans a bulge in the 2.63 m lattice is raised by the bulge), and the materials
  // carry a polygon offset so a pebble of terrain can never win the depth test over a decal.
  function buildCityGround() {
    const { TG, lay } = city, BH = TG.BLOCK_HALF, SWW = TG.SIDEWALK_W;
    const mk = () => ({ pos: [], nor: [], col: [], idx: [], uv: [] });
    const slab = mk(), paint = mk(), _c = new THREE.Color();
    // A vertex is lifted by `lift` over the ground under IT, plus the amount its four neighbours 1.25 m away rise above it (a valley vertex between two bumps):
    // a pure function of (x, z), so quads that share a corner share its height exactly (no crack between cells) and a chord across a dip is not pierced.
    const vlMemo = new Map();                                              // (a sidewalk vertex is shared by four quads: sampled once)
    const vl = (x, z) => {
      const k = (Math.round(x * 16) + 16384) * 65536 + (Math.round(z * 16) + 16384);
      let v = vlMemo.get(k);
      if (v === undefined) {
        const h = heightAt0(x, z), m = (heightAt0(x + 1.25, z) + heightAt0(x - 1.25, z) + heightAt0(x, z + 1.25) + heightAt0(x, z - 1.25)) / 4;
        v = h + Math.min(0.2, Math.max(0, m - h));
        if (!(v - v === 0)) v = waterY;                                  // (7A2: never a NaN vertex)
        vlMemo.set(k, v);
      }
      return v;
    };
    // WAVE 8: a furnished house has its own floor (5 cm over its pad); the block's paving / a yard's earth (10 cm over the ground) drawn inside its walls lay OVER that
    // floor (lane I3 found it hiding the floor loot's rings in a Palm Bay shop). A slab cell whose centre is inside a house's walls is not drawn.
    const quad = (T, x0, z0, x1, z1, lift, hex) => {
      if (T === slab && houses.length && underHouse((x0 + x1) / 2, (z0 + z1) / 2)) return;
      if (T === slab) surfRect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1) - 1e-3, Math.max(z0, z1) - 1e-3, surfOfHex(hex));       // LC-52
      const y00 = vl(x0, z0), y10 = vl(x1, z0), y01 = vl(x0, z1), y11 = vl(x1, z1);
      const dx = x1 - x0, dz = z1 - z0, gx = ((y10 + y11) - (y00 + y01)) / (2 * dx), gz = ((y01 + y11) - (y00 + y10)) / (2 * dz), il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      _c.set(hex);
      const b = T.pos.length / 3;
      const V = [[x0, y00, z0], [x0, y01, z1], [x1, y11, z1], [x1, y10, z0]];
      for (const v of V) { T.pos.push(v[0], v[1] + lift, v[2]); T.nor.push(-gx * il, il, -gz * il); T.col.push(_c.r, _c.g, _c.b); T.uv.push(v[0] / ROAD_TILE, v[2] / ROAD_TILE); }
      T.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    // the curb: a wall under the outer edge of a block's sidewalk, from its top (the slab's own edge vertices) down 0.25 m below the ground, so the step
    // between the sidewalk and the road ribbon beside it (their lifts differ by a few cm) shows a riser, never a slit of terrain
    const skirt = (T, ax, az, bx, bz, nx, nz, hex) => {
      _c.set(hex);
      const ya = vl(ax, az) + CITY_SW_LIFT, yb = vl(bx, bz) + CITY_SW_LIFT, ga = heightAt0(ax, az) - 0.25, gb = heightAt0(bx, bz) - 0.25;
      const b = T.pos.length / 3;
      for (const v of [[ax, ya, az], [ax, ga, az], [bx, gb, bz], [bx, yb, bz]]) { T.pos.push(v[0], v[1], v[2]); T.nor.push(nx, 0, nz); T.col.push(_c.r * 0.8, _c.g * 0.8, _c.b * 0.8); T.uv.push(v[0] / ROAD_TILE, v[2] / ROAD_TILE); }
      // winding: the face normal (b - a) x (c - a) must point along (nx, nz)
      const e1 = [bx - ax, 0, bz - az], e2 = [0, ya - ga, 0];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cz = e1[0] * e2[1] - e1[1] * e2[0];
      if (cx * nx + cz * nz >= 0) T.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else T.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    // a long thin rectangle, cut into <= 1.5 m pieces along its long axis so it follows the ground
    const strip = (T, x0, z0, x1, z1, lift, hex) => {
      const lx = x1 - x0, lz = z1 - z0, n = Math.max(1, Math.ceil(Math.max(lx, lz) / 1.5));
      for (let k = 0; k < n; k++) {
        if (lx >= lz) quad(T, x0 + lx * k / n, z0, x0 + lx * (k + 1) / n, z1, lift, hex);
        else quad(T, x0, z0 + lz * k / n, x1, z0 + lz * (k + 1) / n, lift, hex);
      }
    };
    const GR = SAV.ground || null;                                                          // Wave 7b: the resort / lodge ground tones (Savanna: none, the literals below)
    const LOTC = GR ? GR.lot : { parking: "#4a4e54", park: "#5d8b44", yard: "#a9a18c", plaza: "#c9c5b6", market: "#b08a5c", gas: "#5b5f64", court: "#9e4a38" };
    // 7A2: the sidewalk ring is the lightest thing in a town (it frames every block against the dark asphalt from the plane); the ground inside a block is not one
    // plaza any more: each BUILT parcel has its own paving / packed earth / dry-lawn tone (a hash of its id), the industrial yards a darker concrete.
    // D2: the town ground reads against the tan haze of the drop view as COOL concrete (a bluish-grey plaza inside a pale kerb ring) instead of one more tan: the parcels' tones
    // are greys with a hue drift (blue-grey, warm grey, green-grey), the downtown the coolest
    const RING = GR ? GR.ring : "#d9dad4", PLAZA = GR ? GR.plaza : "#8d9197", WHITE = GR ? GR.white : "#f2f0e6";
    const PARCEL_TONES = GR ? GR.tones : { core: ["#868c94", "#7d848d", "#92979c", "#838a8f", "#8f8f90"], town: ["#999a92", "#8f9189", "#a2a095", "#8a9189", "#9a9890", "#a6a498"], yard: ["#767672", "#82827e", "#6f716f"] };
    const cols = [], c0 = -BH;
    { let u = c0; cols.push([u, u + SWW]); u += SWW; for (let k = 0; k < 16; k++) { cols.push([u, u + 2.5]); u += 2.5; } cols.push([u, u + SWW]); }
    for (const T of lay.towns) {
      if (!T.blocks.length) continue;
      const tones = PARCEL_TONES[T.kind === "core" ? "core" : T.kind === "yard" ? "yard" : "town"];
      const pcol = T.parcels.map((p) => (p.use === "lot" ? LOTC[p.lot] || PLAZA : tones[city.TG.hash32(T.id + ":" + p.id) % tones.length]));
      for (const b of T.blocks) {
        const ps = []; for (let k = 0; k < T.parcels.length; k++) if (T.parcels[k].block === b.id) ps.push(k);
        for (let j = 0; j < cols.length; j++) for (let i = 0; i < cols.length; i++) {
          const x0 = b.cx + cols[i][0], x1 = b.cx + cols[i][1], z0 = b.cz + cols[j][0], z1 = b.cz + cols[j][1], mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          let hex = PLAZA;
          if (i === 0 || j === 0 || i === cols.length - 1 || j === cols.length - 1) hex = RING;
          else for (const k of ps) { const r = T.parcels[k].rect; if (mx >= r[0] && mx <= r[2] && mz >= r[1] && mz <= r[3]) { hex = pcol[k]; break; } }
          quad(slab, x0, z0, x1, z1, CITY_SW_LIFT, hex);
        }
        for (let i = 0; i < cols.length; i++) {                          // the curb walls along the four outer edges (cell by cell, the same vertices as the slab)
          const u0 = cols[i][0], u1 = cols[i][1];
          skirt(slab, b.cx + u0, b.cz - BH, b.cx + u1, b.cz - BH, 0, -1, RING);
          skirt(slab, b.cx + u0, b.cz + BH, b.cx + u1, b.cz + BH, 0, 1, RING);
          skirt(slab, b.cx - BH, b.cz + u0, b.cx - BH, b.cz + u1, -1, 0, RING);
          skirt(slab, b.cx + BH, b.cz + u0, b.cx + BH, b.cz + u1, 1, 0, RING);
        }
      }
      // centre dashes of every street edge, a zebra crossing on every leg of every junction
      const N = T.roads.nodes, legs = new Map();
      if (!(GR && GR.noMarkings)) for (const e of T.roads.edges) {
        const A = N[e.a], B = N[e.b], len = e.len, ux = e.axis === "x" ? Math.sign(B.x - A.x) : 0, uz = e.axis === "z" ? Math.sign(B.z - A.z) : 0;
        for (let t = 11.5; t + 3 <= len - 11.5 + 1e-6; t += 6) {
          const ax = A.x + ux * t, az = A.z + uz * t, bx = A.x + ux * (t + 3), bz = A.z + uz * (t + 3);
          strip(paint, Math.min(ax, bx) - (uz ? 0.1 : 0), Math.min(az, bz) - (ux ? 0.1 : 0), Math.max(ax, bx) + (uz ? 0.1 : 0), Math.max(az, bz) + (ux ? 0.1 : 0), CITY_MK_LIFT, WHITE);
        }
        if (len >= 24) { legs.set(e.a + ":" + ux + ":" + uz, [A, ux, uz]); legs.set(e.b + ":" + -ux + ":" + -uz, [B, -ux, -uz]); }
      }
      if (!(GR && GR.noMarkings)) for (const [, [n, dx, dz]] of legs) {
        for (let k = -3; k <= 3; k++) {
          const cx = n.x + dx * 7.7 + (-dz) * k * 1.25, cz = n.z + dz * 7.7 + dx * k * 1.25, hl = dx ? 1.5 : 0.28, hw = dx ? 0.28 : 1.5;
          quad(paint, cx - hl, cz - hw, cx + hl, cz + hw, CITY_MK_LIFT, WHITE);
        }
      }
      // the white lines of a sports court (a landmark lot, see buildLandmark): the outline of the playing area between the two stands, the half-way line and the two keys
      for (const p of T.parcels) {
        if (p.lot !== "court") continue;
        const r = p.rect, w = r[2] - r[0], d = r[3] - r[1], alongX = w >= d, L = alongX ? w : d, Wd = alongX ? d : w;
        if (L < LM_MIN.court[0] || Wd < LM_MIN.court[1]) continue;
        const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, hu = Math.min(L - 8, 28) / 2, hv = Math.max(2.5, Wd / 2 - 4.0), ln = 0.14;
        const seg = (u0, v0, u1, v1) => { const x0 = alongX ? cx + u0 : cx + v0, x1 = alongX ? cx + u1 : cx + v1, z0 = alongX ? cz + v0 : cz + u0, z1 = alongX ? cz + v1 : cz + u1; strip(paint, Math.min(x0, x1) - ln, Math.min(z0, z1) - ln, Math.max(x0, x1) + ln, Math.max(z0, z1) + ln, CITY_MK_LIFT, WHITE); };
        seg(-hu, -hv, hu, -hv); seg(-hu, hv, hu, hv); seg(-hu, -hv, -hu, hv); seg(hu, -hv, hu, hv); seg(0, -hv, 0, hv);
        for (const s of [-1, 1]) { seg(s * hu, -hv * 0.45, s * (hu - 5.8), -hv * 0.45); seg(s * hu, hv * 0.45, s * (hu - 5.8), hv * 0.45); seg(s * (hu - 5.8), -hv * 0.45, s * (hu - 5.8), hv * 0.45); }
      }
    }
    // (stage B) a resort town's yard lot is a pool deck: a white rim and the pool, 3.5 m in from the lot's edges (decals; the loungers and umbrellas round it are themedLots')
    if (mapId === "isla_viva") for (const T of lay.towns) for (const p of T.parcels) {
      if (p.use !== "lot" || p.lot !== "yard") continue;
      const r = p.rect; if (r[2] - r[0] < 12 || r[3] - r[1] < 12) continue;
      const x0 = r[0] + 3.5, x1 = r[2] - 3.5, z0 = r[1] + 3.5, z1 = r[3] - 3.5;
      strip(slab, x0 - 0.6, z0 - 0.6, x1 + 0.6, z1 + 0.6, CITY_SW_LIFT + 0.004, "#f2efe6");
      strip(slab, x0, z0, x1, z1, CITY_SW_LIFT + 0.008, "#3fa6c4");
      strip(slab, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, CITY_SW_LIFT + 0.012, "#58bcd4");
    }
    // a compound's yard is packed earth: a decal over its rectangle (the fence and the houses stand around it)
    for (const T of lay.compounds.concat(lay.towns.filter((q) => !q.blocks.length && q.compound && q.kind !== "mill"))) {     // (Wave 7b stage B: not the mill - its "yard" is the bridge deck: the decal lay on the banks under both deck ends as two tan wedges)
      const y = T.compound.yard, yc = T.theme === "ruin" ? "#8d8777" : T.compound.variant === "depot" ? "#6d6c68" : "#a98f62";      // (D2: dark packed earth / rubble / a depot's tarmac: the pale "#d9c18f" vanished into the haze)
      const nx = Math.max(1, Math.round((y[2] - y[0]) / 2.5)), nz = Math.max(1, Math.round((y[3] - y[1]) / 2.5));
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) quad(slab, y[0] + (y[2] - y[0]) * i / nx, y[1] + (y[3] - y[1]) * j / nz, y[0] + (y[2] - y[0]) * (i + 1) / nx, y[1] + (y[3] - y[1]) * (j + 1) / nz, CITY_SW_LIFT, yc);
    }
    // D2: crop fields beside the farmsteads and some homesteads - 24-32 x 14-20 m of alternating green and gold rows lying on the ground (decals: no draw call, no collider), on the side of
    // the fence where the ground is level and dry and no street, link or other compound is in the way; they are what turns a compound from "two houses on open grass" into a farm
    for (const T of lay.compounds) {
      const C = T.compound, V = C.variant || "homestead", fr = city.TG.subRng(seed, T.id, "fld"), nF = T.theme === "ruin" || V === "depot" || V === "hamlet" ? 0 : V === "farmstead" ? 2 : (fr() < 0.5 ? 1 : 0);
      const b = C.bounds, mid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], order = [0, 1, 2, 3].sort(() => 0), pals = [["#86a34a", "#a9a041"], ["#b3a23d", "#8a9a45"], ["#6f9a47", "#b6a845"], ["#9db04e", "#c1ac45"]];
      for (let k = 3; k > 0; k--) { const j = Math.floor(fr() * (k + 1)); const t = order[k]; order[k] = order[j]; order[j] = t; }
      let made = 0;
      for (const side of order) {
        if (made >= nF) break;
        const long = 24 + fr() * 8, short = 14 + fr() * 6, horiz = side < 2, ww = horiz ? long : short, dd = horiz ? short : long, gap = 3.5;
        const x0 = horiz ? mid[0] - ww / 2 : (side === 2 ? b[0] - gap - ww : b[2] + gap), z0 = horiz ? (side === 0 ? b[1] - gap - dd : b[3] + gap) : mid[1] - dd / 2, x1 = x0 + ww, z1 = z0 + dd;
        let lo = 1e9, hi = -1e9, bad = false;
        for (let i = 0; i <= 4 && !bad; i++) for (let j = 0; j <= 4; j++) { const h = heightAt0(x0 + ww * i / 4, z0 + dd * j / 4); if (!(h - h === 0)) { bad = true; break; } if (h < lo) lo = h; if (h > hi) hi = h; }
        if (bad || lo < waterY + 1.2 || hi - lo > 2.4) continue;
        for (const q of cityRoadLog) { if (x1 > Math.min(q[0], q[2]) - q[4] / 2 - 4 && x0 < Math.max(q[0], q[2]) + q[4] / 2 + 4 && z1 > Math.min(q[1], q[3]) - q[4] / 2 - 4 && z0 < Math.max(q[1], q[3]) + q[4] / 2 + 4) { bad = true; break; } }
        if (bad) continue;
        for (const T2 of lay.compounds) { if (T2 === T) continue; const q = T2.compound.bounds; if (x1 > q[0] - 3 && x0 < q[2] + 3 && z1 > q[1] - 3 && z0 < q[3] + 3) { bad = true; break; } }
        if (bad) continue;
        for (const T2 of lay.towns) for (const bk of T2.blocks) if (x1 > bk.cx - 38 && x0 < bk.cx + 38 && z1 > bk.cz - 38 && z0 < bk.cz + 38) { bad = true; }
        if (bad) continue;
        const pal = pals[Math.floor(fr() * pals.length)], pitch = 2.4, n = Math.max(2, Math.floor((horiz ? dd : ww) / pitch));
        quad(slab, x0, z0, x1, z1, CITY_SW_LIFT - 0.025, "#9b8660");                                                            // (the headland: a rim of bare earth round the rows)
        for (let r = 0; r < n; r++) {
          const a = (horiz ? dd : ww) * r / n, a2 = (horiz ? dd : ww) * (r + 1) / n - 0.35;
          if (horiz) strip(slab, x0 + 0.8, z0 + a + 0.2, x1 - 0.8, z0 + a2, CITY_SW_LIFT, pal[r % 2]); else strip(slab, x0 + a + 0.2, z0 + 0.8, x0 + a2, z1 - 0.8, CITY_SW_LIFT, pal[r % 2]);
        }
        city.landmarks.push({ kind: "field", town: T.id, x: (x0 + x1) / 2, z: (z0 + z1) / 2 });
        made++;
      }
    }
    // the links between towns: centre dashes too
    for (const l of lay.links) {
      const dx = l.bx - l.ax, dz = l.bz - l.az, len = Math.sqrt(dx * dx + dz * dz), ux = dx / len, uz = dz / len;
      if (Math.abs(ux) < 0.999 && Math.abs(uz) < 0.999) continue;                   // (a diagonal link has no axis-aligned dash)
      for (let t = 12; t + 3 <= len - 12; t += 6) {
        const ax = l.ax + ux * t, az = l.az + uz * t, bx = l.ax + ux * (t + 3), bz = l.az + uz * (t + 3);
        strip(paint, Math.min(ax, bx) - (Math.abs(uz) > 0.5 ? 0.1 : 0), Math.min(az, bz) - (Math.abs(ux) > 0.5 ? 0.1 : 0), Math.max(ax, bx) + (Math.abs(uz) > 0.5 ? 0.1 : 0), Math.max(az, bz) + (Math.abs(ux) > 0.5 ? 0.1 : 0), CITY_MK_LIFT, WHITE);
      }
    }
    const emit = (T, name, offset) => {
      if (!T.idx.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(T.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(T.nor, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(T.col, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(T.uv, 2));
      geo.setIndex(T.idx);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
      mat.color.setScalar(GRADE.ground);                                                   // LC-04 (OD-2 G2): the town ground is ground too
      try { const gt = groundTex(aniso); mat.map = gt.map; mat.normalMap = gt.normal; mat.normalScale = new THREE.Vector2(0.3, 0.3); } catch (e) { /* flat vertex colour */ }
      if (LCFX) lcPatch(mat, { LC_CLOUD: "", LC_AO: "" });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = name;
      g.add(mesh);
    };
    // D2: ONE mesh, not two: the paint (dashes, zebra stripes) lies on the road ribbon (lift 0.115 over a ribbon at 0.06), the slab on the sidewalks and lots (0.10); the
    // widest stripe reaches 4.03 m from a street's axis and the sidewalk starts at 5.0, so the two never overlap and one polygon offset (the paint's, -3) serves both
    city.paintStats = { slabQuads: slab.idx.length / 6, paintQuads: paint.idx.length / 6 };
    for (const k of ["pos", "nor", "col", "uv"]) for (const v of paint[k]) slab[k].push(v);
    const pb = slab.pos.length / 3 - paint.pos.length / 3;
    for (const i of paint.idx) slab.idx.push(i + pb);
    emit(slab, "city:ground", -3);
  }
  // roads, blocks and buildings on the minimap canvas (the HUD draws the town names from map.pois)
  function drawCityOnMinimap(ctx) {
    const S = 512 / SIZE, X = (x) => (x + HALF) * S;
    ctx.save && ctx.save();
    ctx.globalAlpha = 1;
    const MM = SAV.ground && SAV.ground.minimap ? SAV.ground.minimap : null;                  // Wave 7b: the resort / lodge minimap colours (Savanna: the literals below)
    for (const T of city.lay.towns) for (const b of T.blocks) { ctx.fillStyle = MM ? MM.block : T.kind === "core" ? "#e0d8bf" : "#cfc8b4"; ctx.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); }
    ctx.fillStyle = "#34373c";
    for (const r of cityRoadLog) {
      const w = Math.max(2, r[4] * S * 0.75);
      if (Math.abs(r[2] - r[0]) >= Math.abs(r[3] - r[1])) ctx.fillRect(X(Math.min(r[0], r[2])) - w / 2, X(r[1]) - w / 2, Math.abs(r[2] - r[0]) * S + w, w);
      else ctx.fillRect(X(r[0]) - w / 2, X(Math.min(r[1], r[3])) - w / 2, w, Math.abs(r[3] - r[1]) * S + w);
    }
    ctx.fillStyle = "#6f6659";
    for (const a of cityBld) ctx.fillRect(X(a[0]), X(a[1]), Math.max(1, (a[2] - a[0]) * S), Math.max(1, (a[3] - a[1]) * S));
    // the compounds (7A2): the fenced yard as a pale square with a dark rim, a dot where the gate side is - 30 of them were invisible on the map
    ctx.lineWidth = 1;
    for (const T of city.lay.compounds) {
      const q = T.compound.bounds, w = Math.max(5, (q[2] - q[0]) * S), h = Math.max(5, (q[3] - q[1]) * S), cx = X((q[0] + q[2]) / 2) - w / 2, cz = X((q[1] + q[3]) / 2) - h / 2;
      ctx.fillStyle = "#e6d2a0"; ctx.fillRect(cx, cz, w, h);
      ctx.strokeStyle = "#5e4f3a"; ctx.strokeRect(cx + 0.5, cz + 0.5, w - 1, h - 1);
      ctx.fillStyle = "#6f6659"; ctx.fillRect(cx + w / 2 - 1.5, cz + h / 2 - 1.5, 3, 3);
    }
    ctx.restore && ctx.restore();
  }
  // grass tufts keep off the city: a 4 m mask of every block (with its roads), street, link, compound yard and building
  function buildCityMask() {
    const M = 400, m = new Uint8Array(M * M), cs = SIZE / M;
    const mark = (x0, z0, x1, z1) => {
      const i0 = Math.max(0, Math.floor((x0 + HALF) / cs)), i1 = Math.min(M - 1, Math.floor((x1 + HALF) / cs)), j0 = Math.max(0, Math.floor((z0 + HALF) / cs)), j1 = Math.min(M - 1, Math.floor((z1 + HALF) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m[j * M + i] = 1;
    };
    for (const T of city.lay.towns) for (const b of T.blocks) mark(b.x0 - 5, b.z0 - 5, b.x1 + 5, b.z1 + 5);
    for (const r of cityRoadLog) { const hw = r[4] / 2 + 1; mark(Math.min(r[0], r[2]) - hw, Math.min(r[1], r[3]) - hw, Math.max(r[0], r[2]) + hw, Math.max(r[1], r[3]) + hw); }
    for (const T of city.lay.compounds.concat(city.lay.towns.filter((q) => !q.blocks.length && q.compound))) { const q = T.compound.bounds; mark(q[0] - 2, q[1] - 2, q[2] + 2, q[3] + 2); }
    for (const a of cityBld) mark(a[0] - 2, a[1] - 2, a[2] + 2, a[3] + 2);
    // (Wave 8 fix round, lane K1) and the trodden approach of every street / back door of a furnished house: 6 m out, 4 m wide. A room's floor seen from above
    // shows the ground through its doorway well past the 2 m ring (interiorcheck grass-indoors: a crater-rim ruin room on the slope, 255 px of tufts)
    // ... and round a house whose ground falls away below its floor (a terrace on a slope: the crater-rim village): a window or a doorway on the downhill side
    // looks down past the 2 m ring at grass far below the floor (grass-indoors: volcano_rim@p40.f0r0 255 px) - the ring widens 2 m per metre of drop (<= 10 m)
    for (const H of houses) {
      const a = H.aabb, y = H.y0;
      let lo = Infinity;
      for (const [sx, sz] of [[a.min[0] - 3, a.min[2] - 3], [a.max[0] + 3, a.min[2] - 3], [a.min[0] - 3, a.max[2] + 3], [a.max[0] + 3, a.max[2] + 3], [(a.min[0] + a.max[0]) / 2, a.min[2] - 3], [(a.min[0] + a.max[0]) / 2, a.max[2] + 3], [a.min[0] - 3, (a.min[2] + a.max[2]) / 2], [a.max[0] + 3, (a.min[2] + a.max[2]) / 2]]) lo = Math.min(lo, heightAt0(sx, sz));
      const drop = y - lo;
      if (drop > 0.5) { const M = Math.min(10, 2 + 2 * drop); mark(a.min[0] - M, a.min[2] - M, a.max[0] + M, a.max[2] + M); }
    }
    for (const H of houses) for (const d of H.doors) {
      if (!d.rooms || d.rooms[1] != null || d.floor !== 0) continue;
      let nx = d.nx || 0, nz = d.nz || 0;
      if (d.out) { const ox = d.out[0] - d.x, oz = d.out[1] - d.z, l = Math.hypot(ox, oz); if (l > 1e-6) { nx = ox / l; nz = oz / l; } }
      const ex = d.x + nx * 6, ez = d.z + nz * 6, wx = Math.abs(nz) * 2 + 0.5, wz = Math.abs(nx) * 2 + 0.5;
      mark(Math.min(d.x, ex) - wx, Math.min(d.z, ez) - wz, Math.max(d.x, ex) + wx, Math.max(d.z, ez) + wz);
    }
    return m;
  }
  // The district meshes (every town and compound has one per texture kind, with its own bounding sphere): three already frustum-culls them, so what is left is
  // the DISTANCE: beyond 1,100 m the fog has taken 95 % of a district (FogExp2 0.0019) and it is not drawn at all, and a district more than 170 m from the camera
  // casts no shadow (the sun's shadow camera covers +-55 m around the player; a mesh outside it was already culled from that pass, this also keeps a spectator's
  // or the plane's far camera from re-drawing every district's walls into the depth map). Checked twice a second, for the districts only (~40 meshes).
  function installCityCull() {
    const meshes = [];
    g.traverse((o) => { if (o.isMesh && o.userData.district) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); meshes.push(o); } });
    // Wave 7b stage B: the kit's instanced meshes get the same 170 m shadow test (a kit district far from the camera cast into the shadow pass whenever its sphere touched the
    // sun's shadow box: Savanna s31337's endgame view drew the Mall's kit 5 times in the shadow pass). [world x, y, z, r] of each mesh's own instance sphere (citykit computes it
    // tight: the box of its instance centres + the farthest instance), and the cast flag citykit gave it (buildings and cars cast, small props never do).
    const kitM = [];
    g.traverse((o) => {
      if (!o.isInstancedMesh || !o.userData.kitDistrict || !o.boundingSphere || !o.castShadow) return;
      o.updateWorldMatrix(true, false);
      const c = o.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
      kitM.push([o, c.x, c.y, c.z, o.boundingSphere.radius]);
    });
    if (!meshes.length && !kitM.length) return;
    let t = 9;
    trackUpdater((dt) => {
      t += dt; if (t < 0.5) return; t = 0;
      const cam = W.camera; if (!cam) return;
      for (let i = 0; i < kitM.length; i++) {
        const k = kitM[i], dx = k[1] - cam.position.x, dy = k[2] - cam.position.y, dz = k[3] - cam.position.z;
        k[0].castShadow = Math.sqrt(dx * dx + dy * dy + dz * dz) - k[4] < 170;
      }
      for (const m of meshes) {
        const bs = m.geometry.boundingSphere, dx = bs.center.x - cam.position.x, dy = bs.center.y - cam.position.y, dz = bs.center.z - cam.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - bs.radius;
        m.visible = d < TIER_Q.distD;                     // (1,100 m; high 1,300, ULTRA 1,750)
        // (Wave 7b: a compound cell's sphere spans its 600 m cell, so the 170 m test passed from anywhere near it and the shadow pass drew every compound of the cell (15 k
        //  triangles of a Coco Village street view's shadow map for compounds 300 m away): a themed cell casts when one of ITS compounds is within 170 m)
        const P = m.userData.parts;
        let ds = d;
        if (P) { ds = Infinity; for (const p of P) { const e = Math.hypot(p[0] - cam.position.x, p[1] - cam.position.z) - p[2]; if (e < ds) ds = e; } }
        m.castShadow = !m.userData.noCast && ds < 170;          // (K1 re-run: a district's no-shadow twin never casts)
      }
    });
  }
  // citykit: the shells, lights, hydrants, benches, planters and parked cars of every district. Colliders come back in list order (a pure function of the list,
  // identical on every client whether or not the GLBs load) and join the map's; a type whose GLB fails is drawn as its collider boxes.
  async function placeCityKit() {
    const { CK, lay } = city;
    if (!city.kit.length) return;
    const tier = W.settings && W.settings.graphics;
    const kit = CK.createCityKit({ THREE, kernel: W.kernel, assetBase: W.assetBase || "" });
    W._cityKit = kit;
    const districts = {};
    for (const it of city.kit) if (!districts[it.district]) districts[it.district] = { theme: "city" };
    let res;
    try { res = await kit.place(city.kit, { parent: g, districts, draw: tier === "ultra-low" ? false : undefined }); }
    catch (e) { console.warn("[maps] citykit place failed, the city draws without its kit:", e && e.message || e); res = await kit.place(city.kit, { draw: false }); }
    for (const c of res.colliders) colliders.push(c);
    city.kitStats = { entries: city.kit.length, colliders: res.colliders.length, failed: res.failed, skipped: res.skipped, districts: res.districts.length };
    void lay;
  }

  // ── unnamed inter-POI landmarks ───────────────────────────────────────────
  // Summing pi*r^2 over Isla Viva's eight POIs gives 271,200 m2 = 10.6% of the
  // 2.56 km2 map, and every structure-emitting call in this file is anchored to a
  // pois[i] — so 89% of the square had no built content at all beyond sky islands
  // and loose loot points. Rotations were a walk across nothing. These are drawn
  // ONLY from generators that already exist, are seeded off the same rng, and are
  // recorded in `landmarks` so scatterTrees does not grow a pine through the roof.
  // MUST be called after every poi() and BEFORE that branch's scatterTrees block.
  // (Wave 8 fix round, lane K1) FREE WALL FRAGMENTS NEVER MEET. A fragment at a free yaw collides as a stepped chain of ~1 m AABBs (boxColliders), and two
  // fragments that touch or cross (a T, a V, an X) leave junction pockets narrower than a capsule where the chains of BOTH walls overlap a body: a bot that came
  // down into one (a glider has no side collision) stood inside the chain with every way out but one blocked by the other wall (verify_b: Savanna seed 51002,
  // a ruin's two fragments in a T at (489, -153), a bot wedged ~200 s). Every fragment keeps its draws; where its footprint grown by FRAG_GAP / 2 meets an
  // earlier fragment of the same cluster it is pushed away from the cluster's centre in 0.75 m steps (no draw) until it clears (cover stays, the junction goes).
  const FRAG_GAP = 1.2;                                                     // > the capsule's 0.9 m: the gap between two fragments is a walkway, not a pocket
  function fragClearOf(list, x, z, w, d, rot) {
    const c = Math.cos(rot), s = Math.sin(rot), ax = [[c, -s], [s, c]];          // the fragment's local x / z axes in the world (three's rotateY)
    for (const f of list) {
      const axes = ax.concat(f.ax);
      let sep = false;
      for (const n of axes) {
        const ra = (w / 2) * Math.abs(ax[0][0] * n[0] + ax[0][1] * n[1]) + (d / 2) * Math.abs(ax[1][0] * n[0] + ax[1][1] * n[1]);
        const rb = (f.w / 2) * Math.abs(f.ax[0][0] * n[0] + f.ax[0][1] * n[1]) + (f.d / 2) * Math.abs(f.ax[1][0] * n[0] + f.ax[1][1] * n[1]);
        if (Math.abs((f.x - x) * n[0] + (f.z - z) * n[1]) > ra + rb + FRAG_GAP) { sep = true; break; }
      }
      if (!sep) return false;
    }
    return true;
  }
  /** the spot a fragment of the cluster `list` (centre ox, oz) stands at: (x, z) when it clears the others, else pushed outward; recorded in list. null = no room */
  function fragSpot(list, ox, oz, x, z, w, d, rot) {
    let dx = x - ox, dz = z - oz;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) { dx = Math.cos(rot); dz = -Math.sin(rot); } else { dx /= l; dz /= l; }
    for (let k = 0; k <= 16; k++) {
      const px = x + dx * 0.75 * k, pz = z + dz * 0.75 * k;
      if (fragClearOf(list, px, pz, w, d, rot)) { list.push({ x: px, z: pz, w, d, ax: [[Math.cos(rot), -Math.sin(rot)], [Math.sin(rot), Math.cos(rot)]] }); return [px, pz]; }
    }
    return null;
  }
  function minorLandmarks(n, wallCs, roofC, opts) {
    opts = opts || {};
    const minH = opts.minH != null ? opts.minH : waterY + 1.0;
    let placed = 0;
    for (let tries = 0; tries < n * 14 && placed < n; tries++) {
      const x = (rng() * 2 - 1) * (HALF - 90), z = (rng() * 2 - 1) * (HALF - 90);
      if (baseH(x, z) < minH) continue;
      if (nearPoi(x, z, 60) || inCity(x, z, 40)) continue;
      let tooClose = false;
      for (const l of landmarks) { if (Math.hypot(x - l.x, z - l.z) < 120) { tooClose = true; break; } }
      if (tooClose) continue;
      landmarks.push({ x, z, r: 22 });
      placed++;
      const kind = Math.floor(rng() * 5), y = heightAt0(x, z);
      if (kind === 0) {
        house(x, z, 6 + rng() * 2, 5 + rng() * 1.5, Math.floor(rng() * 4) * Math.PI / 2, wallCs[0], roofC, null);
      } else if (kind === 1) {                              // two-hut camp
        hut(x, z, 5, 4.4, 0, wallCs[0], null);
        hut(x + 9 + rng() * 4, z + 6, 4.5, 4, 0, wallCs[1 % wallCs.length], null);
      } else if (kind === 2) {
        rangerTower(x, z, wallCs[1 % wallCs.length], null);
      } else if (kind === 3) {                              // ruin — same fragment pattern as Rubble Row
        const frags = [];
        for (let i = 0; i < 4; i++) {
          const rx0 = x + (rng() - 0.5) * 14, rz0 = z + (rng() - 0.5) * 14;
          const fw = 3.5 + rng() * 3, fh = 2.2 + rng() * 1.4, fc = shade(wallCs[0], 0.8 + Math.floor(rng() * 4) * 0.1), fr = rng() * Math.PI;   // same draws, same order
          const sp = fragSpot(frags, x, z, rx0, rz0, fw, 0.5, fr);         // (K1: never a junction with the ruin's other fragments)
          if (!sp) continue;
          const rx = sp[0], rz = sp[1], ry2 = heightAt0(rx, rz);
          addBox(rx, Math.min(ry2 + 1.1, lowGround(rx, rz, fw, 0.5, fr) + fh / 2), rz, fw, fh, 0.5, fc, { rotY: fr });
        }
        if (!city || openSpot(x, y + 0.5, z)) loot(x, y + 0.5, z, null);
      } else {                                              // fenced paddock (cosmetic, never traps)
        const F = 11, fh = 1.0;
        addFence(x - F, z - F, x + F, z - F, fh, 0.2, "#9a7a4a");
        addFence(x - F, z + F, x + F, z + F, fh, 0.2, "#9a7a4a");
        addFence(x - F, z - F, x - F, z + F, fh, 0.2, "#9a7a4a");
        addFence(x + F, z - F, x + F, z + F, fh, 0.2, "#9a7a4a");
        hut(x, z, 4.5, 4, 0, wallCs[0], null);
      }
      const lx = x + (rng() - 0.5) * 16, lz = z + (rng() - 0.5) * 16;
      if (!city || openSpot(lx, heightAt0(lx, lz) + 0.5, lz)) loot(lx, heightAt0(lx, lz) + 0.5, lz, null);          // (Savanna: never inside a wall of the landmark itself)
      if (rng() < 0.25 && (!city || openSpot(x + 8, heightAt0(x + 8, z) + 0.6, z))) chest(x + 8, heightAt0(x + 8, z) + 0.6, z, null);
    }
  }
  // ── hero landmarks (one distinctive silhouette per biome, like Final Drop's
  //    lighthouse / domes) — procedural, textured via the batch, with a base chest.
  // The most memorable silhouette on the map used to be six stacked SOLID boxes —
  // visible from anywhere and impossible to do anything with, which inverts the
  // reason a landmark is valuable. Each band is now a shell of 4 slabs around a
  // hollow core with a door at the base, so it is an enclosed room a fight can be
  // predicted inside. Deliberately NOT stairs to the light room: the shaft tapers
  // to 2.7 m by the top band, which only fits a ~66-degree flight — a wall you
  // happen to be able to walk up. The interior loot is on the floor.
  function lighthouse(x, z, poi) {
    const H = 22, seg = 6, sh = H / seg, T = 0.4;
    const y = groundPad(x, z, 3.5, 3.5, { gen: "lighthouse" });          // C-PAD: the 6.2 m base band on one level
    for (let i = 0; i < seg; i++) {
      // (Wave 7b, S1 request, applied in stage C) the TOP band keeps the width of the band under it: tapered, it left a 0.35 m ledge on band 4's wall tops (19.4 m up) roofed by the
      // 4 m light room 3.6 m above - navcheck's room survey reads that unreachable ledge as a 4th-storey ROOM the planner can never reach (isla_viva seed 21: top-floor-paths 0/4 there)
      const w = 6.2 - Math.min(i, seg - 2) * 0.7, hw = w / 2, c = i % 2 ? "#dcdcdc" : "#c23b3b", cy = y + i * sh + sh / 2;
      if (i === 0) {                                    // door gap on the -Z face of the bottom band
        const dw = 1.5, sw = (w - dw) / 2;
        addBox(x - (dw + sw) / 2, cy, z - hw, sw, sh + 0.12, T, c);
        addBox(x + (dw + sw) / 2, cy, z - hw, sw, sh + 0.12, T, c);
        addBox(x, y + sh - 0.35, z - hw, dw, 0.7, T, c);
      } else addBox(x, cy, z - hw, w, sh + 0.12, T, c);
      addBox(x, cy, z + hw, w, sh + 0.12, T, c);
      addBox(x - hw, cy, z, T, sh + 0.12, w, c);
      addBox(x + hw, cy, z, T, sh + 0.12, w, c);
    }
    addBox(x, y + H + 1.2, z, 4, 2.4, 4, "#2a3138");                    // light room
    addBox(x, y + H + 1.2, z, 3, 1.3, 3, "#fff2b0", { collide: false }); // the light
    lampPts.push({ x, y: y + H + 1.2, z });
    addBox(x, y + H + 2.7, z, 5, 0.6, 5, shade("#2a3138", 0.8));        // cap
    chest(x, y + 0.6, z, poi); loot(x - 4, y + 0.5, z, poi); loot(x, y + 0.5, z, poi);
  }
  function waterTower(x, z, poi) {
    const legH = 12;
    const y = groundPad(x, z, 3.5, 3.5, { gen: "waterTower" });          // C-PAD: the four legs (+-3 m) on one level
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) addStilt(x + dx, z + dz, 0.5, y + legH, "#8a8378", true);   // each leg reaches the ground under ITSELF
    addBox(x, y + legH * 0.55, z - 3, 6.6, 0.3, 0.3, "#8a8378", { collide: false });
    addBox(x, y + legH * 0.55, z + 3, 6.6, 0.3, 0.3, "#8a8378", { collide: false });
    addBox(x, y + legH + 2.6, z, 8.2, 5.2, 8.2, "#b6ad8c");            // tank
    addBox(x, y + legH + 5.5, z, 8.8, 1, 8.8, shade("#b6ad8c", 0.78)); // roof
    chest(x, y + 0.6, z, poi); loot(x + 5, y + 0.5, z, poi);
  }
  // Was a SOLID 8x8x11 block plus a solid bell tower — the biggest silhouette on
  // Deepwood and you could not get inside it. Four walls around an 8 x 11 nave with
  // a door at each gable end, and a ramp inside the bell tower up to a deck.
  // LC-90 (P3): Deepwood had no map-scale landmark (Isla Viva has the lighthouse and the volcano, Savanna the downtown skyline, the water tower and the crane;
  // Deepwood's tallest thing was the 18 m chapel tower, lost among 15 m pines). A FIRE LOOKOUT on the highest free hill of the forest half: four 0.5 m timber
  // legs to a 29 m cab, cross-braced on every face, a glazed cab (its windows the warm emissive the lamps use, so it reads from the plane at dusk too), a
  // hipped roof and a mast. The cab is a SOLID block (no room nobody can reach: navcheck's room survey), the legs are exact colliders, the braces cosmetic.
  // A chest stands between the legs. Placed by a deterministic search (no random draw: the world stream is untouched): a 40 m grid over the forest half,
  // within 520 m of the centre, dry, below the rocky tops, clear of towns / POIs / roads / landmarks, nearly flat across 10 m; the highest wins. The trees, bushes and rocks the scatter
  // put within 7 m of it are dropped (drop flag: finalizeProps' own path, no stream change). WORLD CHANGE (colliders, one chest, dropped props): the
  // MAP_GEN_VERSION bump is the integrator's.
  function lookoutTower() {
    let best = null;
    for (let gx = -HALF + 140; gx <= HALF - 140; gx += 40) for (let gz = -60; gz <= HALF - 140; gz += 40) {
      const h = baseH(gx, gz);
      if (gx * gx + gz * gz > 520 * 520) continue;                                   // (inside the playable heart: a beacon on the map's rim orients nobody)
      if (h < waterY + 4 || h > 40 || (best && h <= best.h)) continue;
      if (nearPoi(gx, gz, 45) || nearLandmark(gx, gz) || cityBlocks(gx, gz, 40)) continue;
      let lm = false;
      for (const l of landmarks) if (Math.hypot(gx - l.x, gz - l.z) < (l.r || 20) + 40) { lm = true; break; }
      if (lm) continue;
      let flat = true;
      for (const [ox, oz] of [[5, 0], [-5, 0], [0, 5], [0, -5], [5, 5], [-5, -5], [5, -5], [-5, 5]]) if (Math.abs(baseH(gx + ox, gz + oz) - h) > 2.2) { flat = false; break; }
      if (!flat) continue;
      let road = false;
      for (const r of roadQueue) {
        const dx = r.x1 - r.x0, dz = r.z1 - r.z0, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((gx - r.x0) * dx + (gz - r.z0) * dz) / L2));
        if (Math.hypot(gx - r.x0 - dx * t, gz - r.z0 - dz * t) < r.width / 2 + 14) { road = true; break; }
      }
      if (road) continue;
      best = { x: gx, z: gz, h };
    }
    if (!best) return null;
    const x = best.x, z = best.z, LEG = 2.7, LT = 0.5, TOP = 29, CAB = 3.2, W2 = 7.0;
    const y = groundPad(x, z, 4.6, 4.6, { gen: "lookout" });
    const C_TIM = "#6e4a2c", C_TIM2 = "#5a3b22", C_CAB = "#8a5a33", C_ROOF = "#3f3a36", NC = { collide: false };
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(x + sx * LEG, y + TOP / 2 - 0.3, z + sz * LEG, LT, TOP + 0.6, LT, C_TIM, { tex: "plank" });   // (0.3 m into the ground)
    // cross bracing on the four faces, 5 storeys (cosmetic boards: thin, a capsule never needs to stand on one)
    const BR = [0, 5.8, 11.6, 17.4, 23.2, TOP - 0.4];
    for (let k = 0; k + 1 < BR.length; k++) {
      const ya = y + BR[k], yb = y + BR[k + 1];
      for (const f of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        const ax = x + f[0] * LEG, az = z + f[1] * LEG, bx = x + f[2] * LEG, bz = z + f[3] * LEG;
        addFenceBoard(ax, ya, az, bx, yb, bz, 0.22, 0.14, C_TIM2);
        addFenceBoard(bx, ya, bz, ax, yb, az, 0.22, 0.14, C_TIM2);
        addFenceBoard(ax, yb, az, bx, yb, bz, 0.26, 0.16, C_TIM2);              // the girt at each storey
      }
    }
    // the cab: a solid block (floor to roof plate) with a glazed band and a catwalk ledge under it
    addBox(x, y + TOP + 0.15, z, W2 + 1.6, 0.3, W2 + 1.6, C_TIM2, { tex: "plank" });                          // catwalk deck
    addBox(x, y + TOP + 0.3 + 0.45, z, W2, 0.9, W2, C_CAB, { tex: "plank" });                                // lower wall
    addBox(x, y + TOP + 1.2 + 0.75, z, W2 - 0.1, 1.5, W2 - 0.1, "#ffe9a8", NC);                             // the windows (lit glass band)
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(x + sx * (W2 / 2 - 0.12), y + TOP + 1.95, z + sz * (W2 / 2 - 0.12), 0.26, 1.5, 0.26, C_CAB, NC);   // corner posts
    addBox(x, y + TOP + 1.2 + 0.75, z, W2 - 0.4, 1.5, W2 - 0.4, C_CAB);                                     // (the collider body inside the glass)
    addBox(x, y + TOP + CAB - 0.25, z, W2 + 0.2, 0.5, W2 + 0.2, C_CAB, { tex: "plank" });                    // eaves plate
    for (const sx of [-1, 1]) addBox(x + sx * (W2 / 2 + 0.75), y + TOP + 0.75, z, 0.08, 0.9, W2 + 1.6, C_TIM2, NC);   // catwalk rails
    for (const sz of [-1, 1]) addBox(x, y + TOP + 0.75, z + sz * (W2 / 2 + 0.75), W2 + 1.6, 0.9, 0.08, C_TIM2, NC);
    coneAt(x, y + TOP + CAB, z, (W2 + 1.4) * 0.72, 2.6, 4, C_ROOF, Math.PI / 4, "shingle");                   // hipped roof
    addBox(x, y + TOP + CAB + 4.7, z, 0.16, 9.8, 0.16, "#9a9a96", NC);                                      // mast: stepped on the eaves plate, up through the roof (it stood on the cone's apex: placementcheck structure-contact read a 2.6 m hover)
    addBox(x, y + TOP + CAB + 2.6 + 7.1, z, 0.5, 0.5, 0.5, "#ffe9a8", NC);                                  // the beacon
    chest(x, y + 0.4, z, null);
    // the scatter's props under it go (finalizeProps drops a `drop` entry): nothing grows through the legs or the bracing
    for (const kind in props) for (const it of props[kind]) if (Math.abs(it.x - x) < 7 && Math.abs(it.z - z) < 7) it.drop = 1;
    lookout = { x, z, y, top: y + TOP + CAB + 2.6 + 7.4 };
    return lookout;
  }
  let lookout = null;
  function steeple(x, z, poi) {
    const T = 0.4, NW = 8, ND = 11, WH = 8, dw = 2;
    const y = groundPad(x, z - 0.5, 4.6, 6.5, { gen: "steeple" });       // C-PAD: nave + bell tower (x +-4.3, z -6.8 .. +5.9)
    const sw = (NW - dw) / 2;
    for (const sz of [-1, 1]) {                                         // gable ends, door gap in each
      addBox(x - (dw + sw) / 2, y + WH / 2, z + sz * ND / 2, sw, WH, T, "#8f8a80");
      addBox(x + (dw + sw) / 2, y + WH / 2, z + sz * ND / 2, sw, WH, T, "#8f8a80");
      addBox(x, y + WH - 1.6, z + sz * ND / 2, dw, 3.2, T, "#8f8a80");  // over the 4.8 m doorway
    }
    addBox(x - NW / 2, y + WH / 2, z, T, WH, ND, "#8f8a80");            // nave sides
    addBox(x + NW / 2, y + WH / 2, z, T, WH, ND, "#8f8a80");
    addBox(x, y + 8.6, z, 8.6, 1, 11.6, "#7a4a2a");                     // roof
    // Bell tower is a SHELL rather than 18 m of solid stone — its ground floor opens
    // into the nave, so the interior is one connected room. Deliberately NOT ramped
    // to the belfry: a 4.2 m footprint can only fit a ~70-degree flight, which reads
    // as a wall you happen to be able to walk up. The reward stays on the floor.
    const TW = 4.2, TH = 18, tz = z - 4.5;
    addBox(x, y + 9, tz - TW / 2, TW, TH, T, "#9a9488");
    addBox(x - TW / 2, y + 9, tz, T, TH, TW, "#9a9488");
    addBox(x + TW / 2, y + 9, tz, T, TH, TW, "#9a9488");
    addBox(x, y + 13.5, tz + TW / 2, TW, 9, T, "#9a9488");              // open below y+9 so the nave feeds it
    // The tapered spire's first stage (3.2 m wide) hovered 0.15 m over the shell's top AND sat inside the 4.2 m shell's hollow, touching nothing: a
    // belfry cap (4.6 m, resting on the wall tops at y+18) now carries it, and the stages overlap the cap and each other.
    addBox(x, y + 18.15, tz, TW + 0.4, 0.3, TW + 0.4, "#8a8478", { collide: false });
    for (let i = 0; i < 4; i++) addBox(x, y + 19 + i * 1.6, tz, 3.2 - i * 0.75, 1.7, 3.2 - i * 0.75, "#6a4028", { collide: false });  // tapered spire (cosmetic cap)
    chest(x, y + 0.6, z, poi); loot(x, y + 0.5, z, poi); loot(x + 4, y + 0.5, z, poi);
  }
  // a farm: a fenced field of crop rows + a red barn (hay-ramp roof chest) + a silo.
  // Gives the "Farm" POIs actual farmland (they had farm names but no farm geometry).
  function farmland(p, opts) {
    opts = opts || {};
    const R = p.r * 0.75, cx = p.x, cz = p.z, minH = opts.minH != null ? opts.minH : 0.6;
    const N = 8, step = (R * 1.5) / N;                                   // crop-row grid of low bushes
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = cx - R * 0.75 + i * step + (rng() - 0.5), z = cz - R * 0.75 + j * step + (rng() - 0.5);
      const y = heightAt0(x, z);
      if (baseH(x, z) < minH) continue;
      props.bush.push({ x, y, z, s: 0.45 + rng() * 0.3, ry: rng() * Math.PI });
    }
    const bx = cx + R * 0.9, bz = cz;
    if (baseH(bx, bz) >= minH) {
      const by = groundPad(bx, bz, 4.6, 6.6, { gen: "farmland" });         // C-PAD: the barn (8.5 x 12.5 roof) on one level
      // Was a SOLID 8 x 4.8 x 12 box whose only affordance was the hay ramp to a
      // roof chest — the barn you can see from the whole field and not walk into.
      // Four walls around the same footprint with a 3 m cart door on the +Z gable,
      // plus a hayloft slab at by+2.6 reached by the existing hay ramp (addSlabHole
      // so the ramp is not dead-ended into the loft's underside).
      const BW = 8, BD = 12, BH = 4.8, BT = 0.35, cart = 3, bs = (BW - cart) / 2;
      addBox(bx, by + BH / 2, bz - BD / 2, BW, BH, BT, "#b0623c");       // back gable
      addBox(bx - BW / 2, by + BH / 2, bz, BT, BH, BD, "#b0623c");       // sides
      addBox(bx + BW / 2, by + BH / 2, bz, BT, BH, BD, "#b0623c");
      addBox(bx - (cart + bs) / 2, by + BH / 2, bz + BD / 2, bs, BH, BT, "#b0623c");   // front, L of cart door
      addBox(bx + (cart + bs) / 2, by + BH / 2, bz + BD / 2, bs, BH, BT, "#b0623c");   // front, R
      addBox(bx, by + BH - 0.6, bz + BD / 2, cart, 1.2, BT, "#b0623c");  // header over the 3.6 m opening
      addBox(bx, by + 2.6, bz - 3, BW - BT * 2, 0.3, 6, shade("#b0623c", 0.9));       // hayloft over the back half
      // loft ramp: foot on the barn floor, top 0.2 m ONTO the loft slab (it ended 0.25 m short of it)
      addRampSnap(bx, bz, 2.2, by + 2.75, 5.5, 3, "#8a4d2f", { keepRun: true });             // face = the loft slab's front edge (z = bz)
      addBox(bx, by + 5.4, bz, 8.5, 1.2, 12.5, shade("#b0623c", 0.8));   // barn roof
      // The hay ramp used to start at bz+7 and run 9 m, which put its top INSIDE the
      // barn — fine against a solid block, but it now cuts straight through the cart
      // door and the front gable. Pushed out so its top lands at the wall face.
      // The roof slab is 1.2 m thick (by+4.8 .. by+6.0) but the ramp stopped at by+5.1, 0.9 m under its top, against its side face (STEP_UP is
      // 0.55) and the chest was authored INSIDE the slab: the ramp now lands on the roof top, 0.3 m onto the slab, and the chest sits on it.
      addRampSnap(bx, bz + 6.25, 3, by + 6.0, 9, 3, "#8a4d2f");          // hay ramp to the roof chest; face = the roof slab's front edge (z = bz + 6.25)
      chest(bx, by + 6.6, bz, p.id);
      loot(bx, by + 0.5, bz + 3, p.id); loot(bx, by + 3.1, bz - 3, p.id);   // barn floor + hayloft
      const sx = bx, sz = bz - 15, sy = groundPad(sx, sz, 2.6, 2.6, { gen: "farmland" });   // the silo
      addBox(sx, sy + 5, sz, 4, 10, 4, "#c8b48a");                       // silo
      addBox(sx, sy + 10.4, sz, 4.6, 1.2, 4.6, shade("#c8b48a", 0.72));
    }
    const F = R * 0.95, fh = 1.0;                                        // cosmetic fence (never traps players); follows the ground in 3 m panels
    addFence(cx - F, cz - F, cx + F, cz - F, fh, 0.2, "#9a7a4a");
    addFence(cx - F, cz + F, cx + F, cz + F, fh, 0.2, "#9a7a4a");
    addFence(cx - F, cz - F, cx - F, cz + F, fh, 0.2, "#9a7a4a");
    addFence(cx + F, cz - F, cx + F, cz + F, fh, 0.2, "#9a7a4a");
    // per-chest ground sample — Meadow Farm measured the worst floaters in the game
    // (27% of its chests over 1 m up, worst case 5.3 m) off the POI-centre height
    for (let i = 0; i < 2; i++) {
      const kx = cx + (rng() - 0.5) * R, kz = cz + (rng() - 0.5) * R;
      chest(kx, heightAt0(kx, kz) + 0.6, kz, p.id);
    }
  }

  if (mapId === "isla_viva") {
    const C_BAMBOO = "#c9a86a", C_STONE = "#8f8a80", C_WOODP = "#a8794f";
    poi("palm_bay", "Palm Bay", -520, 90, 90);
    poi("coco_village", "Coco Village", -60, 350, 110);
    poi("volcano_rim", "Volcano Rim", 40, -60, 130);
    poi("shipwreck", "Shipwreck Cove", 470, -430, 95);
    poi("cliff_temples", "Cliff Temples", 480, 60, 110);
    poi("lagoon_docks", "Lagoon Docks", 120, 620, 100);
    poi("jungle_market", "Jungle Market", -350, -380, 100);
    poi("banana_farm", "Banana Farm", -340, 360, 90);   // pulled inland — the old -430,480 sat on the waterline (farmland skipped)
    // Snap the INLAND POIs onto land before anything is built on them (see
    // snapPoiToLand). Shipwreck Cove and Lagoon Docks are deliberately coastal — a
    // hull and a stilt hut on a pier — and Volcano Rim is always ~50 m up, so those
    // three are left where the table puts them. pois[] is only read afterwards
    // (bots.js, the drop-screen heat map, the minimap), so each picks up the move.
    for (const id of ["palm_bay", "coco_village", "cliff_temples", "jungle_market", "banana_farm"]) {
      const p = pois.find((q) => q.id === id);
      if (p) snapPoiToLand(p, waterY + 0.8);
    }
    // WAVE 7b: the resort towns, the docks village and the crater-rim village come from towngen like Savanna's city (see the city section above). The Cliff Temples keep and its
    // five cubes stay where the table put them (`keepAt`, the POI's spot before the layout moves it): the layout keeps its 36 x 28 m clear and the cubes are drawn first and
    // dropped where they would stand in a street or a yard (the draw-then-reject rule). A page whose towngen.js did not load plays the pre-7b layout below.
    const keepAt = { x: pois[4].x, z: pois[4].z, r: pois[4].r, id: pois[4].id, on: baseH(pois[4].x, pois[4].z) > waterY + 0.8 };
    if (keepAt.on) cityReserveExtra.push([keepAt.x - 17, keepAt.z - 14, keepAt.x + 19, keepAt.z + 14]);
    city = await prepareCity();
    if (city) { registerCityRoads(); registerCityPlateaus(); registerCityExtras(); buildCityBuildings(); } else buildRoads(7);   // (connect every POI into a road network (cosmetic ribbons; the corridors go into the ground NOW, before anything is built on them))
    // C-PAD ORDER: three towers below (the Cliff Temples keep, the Coco Village market hall, the volcano-rim observatory) are built AFTER things that
    // stand where their pads reshape the ground (the five temple cubes and their ramps, the rim slabs). Their pads - the very rectangles tower()
    // asks for, so tower() finds them and builds on the same level - are laid first, under the same dry-land conditions.
    if (keepAt.on) groundPad(keepAt.x, keepAt.z, 12 / 2 + 0.4, 12 / 2 + 0.4, { gen: "tower" });
    if (!city && baseH(pois[1].x, pois[1].z - 40) > waterY + 0.8) groundPad(pois[1].x, pois[1].z - 40, 14 / 2 + 0.4, 14 / 2 + 0.4, { gen: "tower" });
    if (!city && baseH(pois[2].x - 88, pois[2].z + 30) > waterY + 0.8) groundPad(pois[2].x - 88, pois[2].z + 30, 11 / 2 + 0.4, 11 / 2 + 0.4, { gen: "tower" });
    // villages → real towns (houses on a street with front doors to the road)
    if (!city) {
      town(pois[0], [C_WOODP, C_BAMBOO], "#c0563a", { along: "z", nPer: 4, signature: "depot" });        // Palm Bay
      town(pois[1], [C_BAMBOO, C_WOODP], "#cf6b3a", { along: "x", nPer: 5 });                            // Coco Village (its market hall is the tower below)
      town(pois[6], [C_WOODP, C_BAMBOO], "#b5503a", { along: "x", nPer: 4, layout: "crossroads" });       // Jungle Market
      farmland(pois[7], { minH: 0.6 });                                          // Banana Farm → actual farmland
    }
    let lhSpot = null;
    { const ls = city ? shoreSpot(pois[3].x, pois[3].z, 160) : null; lhSpot = ls; if (ls) lighthouse(ls[0], ls[1], pois[3].id); else lighthouse(pois[3].x - 55, pois[3].z + 55, pois[3].id); }   // Shipwreck Cove lighthouse (coastal landmark)
    // cliff temples: stone block structures
    const templeBlockers = [];       // the cubes' caps and their ramp planks, [x0, x1, z0, z1]: the keep's roof ramp keeps clear of them
    {
      const p = keepAt;
      // All five cubes are drawn first (the same draws in the same order: nothing between them consumes the stream), then built: a cube's ramp
      // must know where the keep (below) and the other cubes stand. Its ramp (up to 10 m long since the <= 45 degree rule) used to be fixed on the
      // +Z face and ran through the keep's wall or under its first-floor slab on 2 seeds of 5 (isla_viva 1234, 31337: the ramp could not be
      // climbed and the keep's own ground-floor stair came out onto it). The ramp now takes the first face (+Z, -Z, +X, -X) whose corridor is
      // clear of the keep and of the other cubes; no further draw is made, so the stream and every anchor are unchanged.
      const temples = [];
      for (let i = 0; i < 5; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.2, z = p.z + (rng() - 0.5) * p.r * 1.2;
        const s = 3 + rng() * 3;
        temples.push({ x, z, s });
        templeBlockers.push([x - s * 0.65, x + s * 0.65, z - s * 0.65, z + s * 0.65]);
      }
      const keepOn = keepAt.on;                                              // the keep below is only built on dry ground
      const keep = keepOn ? [p.x - 6.8, p.x + 8.9, p.z - 6.8, p.z + 6.8] : null;   // its walls (+- 6.2), plus its exterior roof ramp along the +X wall, plus a capsule
      for (let i = 0; i < 5; i++) {
        const { x, z, s } = temples[i];
        if (city && cityBlocks(x, z, s * 0.65 + 5)) continue;                  // (Wave 7b: a cube that would stand in a street, a yard or a building of the layout is not built; its draws were made)
        const y = groundPad(x, z, s * 0.65 + 0.2, s * 0.65 + 0.2, { gen: "temple" });   // C-PAD: the cube and its 1.3 x cap on one level
        addBox(x, y + s / 2, z, s, s, s, C_STONE, { tex: "block" });
        addBox(x, y + s + 0.8, z, s * 1.3, 1.6, s * 1.3, shade(C_STONE, 0.85), { tex: "block" });
        if (i % 2 === 0) chest(x, y + s + 1.9, z, p.id);
        // The old ramp rose only to the CUBE top (height s) — but the cap sits
        // directly on that top, 1.6 m tall and 30% wider, so the ramp's last
        // metre ran UNDER the cap's overhang with headroom shrinking to zero:
        // every even-index temple chest (three per match) was visible, marked,
        // and physically unreachable on foot. The ramp now rises to the CAP TOP
        // (s + 1.6) and its up-end lands at the cap's face (z + 0.65s), flush
        // with the top surface, so the walk-off steps straight onto the cap.
        // Run lengthened to keep the old ~34-degree slope.
        const trun = s * 1.5 + 2.4;
        // faces: dir 3 = the cap's +Z face (the foot lies toward +Z), 2 = -Z, 1 = +X, 0 = -X. corridor = plank + a capsule's width either side + 0.6 m
        // beyond the foot. The first face with a clear corridor wins; none clear (never measured) keeps the old +Z one.
        let pick = null;
        for (const dir of [3, 2, 1, 0]) {
          const dx = RAMP_DIR[dir][0], dz = RAMP_DIR[dir][1], f = s * 0.65;
          const rp = planRampSnap(x - dx * f, z - dz * f, 2.4, y + s + 1.6, trun, dir);
          const alongX = dir < 2, hr = rp.run / 2;
          const corr = alongX ? [rp.cx - hr - (dx > 0 ? 0.6 : 0), rp.cx + hr + (dx < 0 ? 0.6 : 0), rp.cz - 1.7, rp.cz + 1.7]
                              : [rp.cx - 1.7, rp.cx + 1.7, rp.cz - hr - (dz > 0 ? 0.6 : 0), rp.cz + hr + (dz < 0 ? 0.6 : 0)];
          let clear = !(keep && rectsMeet(corr, keep));
          for (let j = 0; clear && j < 5; j++) if (j !== i) { const o = temples[j], h = o.s * 0.65; if (rectsMeet(corr, [o.x - h, o.x + h, o.z - h, o.z + h])) clear = false; }
          if (clear) { pick = { dir, rp }; break; }
          if (!pick && dir === 3) pick = { dir, rp, fallback: true };
        }
        addRamp(pick.rp.cx, pick.rp.cy, pick.rp.cz, 2.4, pick.rp.rise, pick.rp.run, pick.dir, shade(C_STONE, 0.9));
        { const hr = pick.rp.run / 2; templeBlockers.push(pick.dir < 2 ? [pick.rp.cx - hr, pick.rp.cx + hr, pick.rp.cz - 1.2, pick.rp.cz + 1.2] : [pick.rp.cx - 1.2, pick.rp.cx + 1.2, pick.rp.cz - hr, pick.rp.cz + hr]); }
      }
    }
    // Isla Viva had NOT ONE multi-storey interior: the whole branch was towns of
    // 3.4 m single rooms, solid landmark blocks and five solid temple cubes, so
    // the map had no interior vertical fight at all while Savanna and Deepwood
    // both do. tower() already emits per-floor slabs, a stairwell hole over each
    // interior ramp and a roof chest. Guarded on dry ground so these do not
    // repeat the Lagoon Docks waterline bug — the coast is close at both spots.
    if (keepAt.on) tower(keepAt.x, keepAt.z, 3, 12, C_STONE, keepAt.id, templeBlockers);          // Cliff Temples keep
    if (!city && baseH(pois[1].x, pois[1].z - 40) > waterY + 0.8) tower(pois[1].x, pois[1].z - 40, 2, 14, C_BAMBOO, pois[1].id); // Coco Village market hall
    // Volcano Rim: an r=130 named landing zone that emitted FOUR CHESTS and no
    // geometry at all — and because scatterTrees rejects nearPoi(x, z, 26) it also
    // cleared every tree out to 156 m, so the drop screen advertised a place that
    // was bare open slope. Worse, the chests sat on a 150 m ring, i.e. OUTSIDE the
    // circle they belong to. Obsidian slabs on the rim for cover (Rubble Row's
    // fragment pattern retinted, same quantised shade so the batch key stays
    // stable), an observatory to hold, and the chests pulled inside the POI.
    // (Wave 7b: the crater-rim village of the layout is that place now; this block is the pre-7b fallback)
    if (!city) {
      const p = pois[2], C_OBS = "#5a5048";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rng() * 0.5, rr = 60 + rng() * 50;
        const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr, y = heightAt0(x, z);
        // (the same draws in the same order: width, height, tint, yaw) - lowered to the ground under the DOWNHILL end when the slope would leave it hanging
        const fw = 3.5 + rng() * 3, fh = 2.2 + rng() * 1.6, fc = shade(C_OBS, 0.8 + Math.floor(rng() * 4) * 0.1), fr = rng() * Math.PI;
        addBox(x, Math.min(y + 1.1, lowGround(x, z, fw, 0.6, fr) + fh / 2), z, fw, fh, 0.6, fc, { rotY: fr });
        if (i % 3 === 0) loot(x + 2, y + 0.5, z, p.id);
      }
      const ox = p.x - 88, oz = p.z + 30;
      if (baseH(ox, oz) > waterY + 0.8) tower(ox, oz, 2, 11, C_STONE, p.id);   // rim observatory
      for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2, rr = p.r * 0.6;
        const cx = p.x + Math.cos(a) * rr, cz = p.z + Math.sin(a) * rr;
        chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);
      }
    }
    // shipwreck: hull from planks (Wave 7b: on the layout's shore, beside the ruined hamlet: the POI moved there with it)
    {
      let p = pois[3]; const y = waterY + 0.2;
      if (city) { const hs = shoreSpot(p.x, p.z, 120, waterY - 0.3, waterY + 0.9, 14, lhSpot ? [lhSpot[0], lhSpot[1], 34] : null); if (hs) p = { x: hs[0], z: hs[1], id: p.id }; }
      const hr = city ? 0 : 0.6;                                    // (Wave 7b: with a city layout the hull stands square to the axes, so the axis-aligned boarding plank runs alongside it and meets its deck; the fallback keeps 0.6)
      addBox(p.x, y + 1.6, p.z, 6, 3.2, 18, "#7a5233", { rotY: hr });
      addBox(p.x + 3, y + 4.2, p.z + 2, 0.5, 6, 0.5, "#6b4326", { rotY: hr });
      addRamp(p.x - 4.2, y, p.z - 8.6, 2.4, 3.5, 7.5, 2, "#6b4326"); // boarding plank to the deck chest
      // the two loose points used to sit 6.7 m off the hull centreline, inside the old rotated-AABB phantom
      // wall; the hull collider is its true outline now, so they would hover over open water. Hull-local
      // (+1.4, -4.5) / (-1.4, +4.5) puts them on the deck (rotY 0.6: x' = lx c + lz s, z' = -lx s + lz c).
      const wc = Math.cos(hr), ws = Math.sin(hr);
      chest(p.x, y + 3.4, p.z, p.id);
      chest(p.x + 1.4 * wc - 4.5 * ws, y + 3.4, p.z - 1.4 * ws - 4.5 * wc, p.id);
      loot(p.x - 1.4 * wc + 4.5 * ws, y + 4.0, p.z + 1.4 * ws + 4.5 * wc, p.id);
    }
    // docks (Wave 7b: the docks village of the layout replaces them)
    if (!city) {
      pier(120, 640, 22, 0.2, C_WOODP, "lagoon_docks");
      pier(160, 610, 16, -0.3, C_WOODP, "lagoon_docks");
      // (90,590) is below sea level on every seed sampled; hut() now stilts itself
      // over water, so the shack stays ON the dock instead of being ring-searched
      // up to 56 m inland (which still landed in water on 89.2% of seeds anyway).
      hut(90, 590, 5, 4.4, 0, C_WOODP, "lagoon_docks");
    }
    minorLandmarks(14, [C_WOODP, C_BAMBOO], "#b5503a", { minH: waterY + 1.2 });
    // grid dims, not attempt counts (see scatterTrees). Measured on 2 seeds:
    // 134 -> 263 props, mean distance to nearest cover 36 m -> 22 m, open ground
    // beyond 40 m from any prop 37% -> 7%.
    scatterTrees("palm", 30, 0.6, 26, "wood");
    scatterTrees("tree", 22, 2, 40, "wood");
    scatterTrees("bush", 22, 0.6, 30, null);
    scatterTrees("rocks", 14, 1, 70, "brick");
  } else if (mapId === "ashgrid") {
    // warm sandstone/adobe outpost palette (was cold grey concrete — clashed with the golden savanna)
    const C_CONC = "#c3ad84", C_CONC2 = "#a68f62", C_BRICKB = "#a5705a", C_METAL = "#93805e";
    poi("downtown", "Downtown Core", 0, 0, 150);
    poi("metro", "Metro Plaza", 60, -430, 110);
    poi("overpass", "The Overpass", 430, 80, 120);
    poi("yard", "Container Yard", 420, 430, 110);
    poi("mall", "Old Mall", -430, -60, 120);
    poi("crane", "Crane Heights", -380, -430, 90);
    poi("rubble", "Rubble Row", -60, 430, 110);
    poi("motorpool", "Motor Pool", -430, 380, 90);
    poi("outpost", "Savanna Outpost", 220, 250, 95);
    // WAVE 7: the towns come from towngen (see the Savanna city section above); the Wave-6 layout below is the fallback if that module does not load
    city = await prepareCity();
    if (city) { registerCityRoads(); registerCityPlateaus(); buildCityBuildings(); } else buildRoads(8);   // (the towns' buildings first: everything the landmarks and the wild loot place after them can see their colliders)
    // downtown towers
    const dt = pois[0];
    if (!city) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4, d = 55 + rng() * 70;
      const x = dt.x + Math.cos(a) * d, z = dt.z + Math.sin(a) * d;
      tower(x, z, 2 + Math.floor(rng() * 3), 10 + rng() * 4, i % 2 ? C_CONC : C_CONC2, dt.id);
    }
    // metro plaza: low halls
    if (!city) {
      for (let i = 0; i < 3; i++) hut(pois[1].x + (i - 1) * 26, pois[1].z + (rng() - 0.5) * 30, 9, 7, 0, C_BRICKB, "metro");
      tower(pois[1].x, pois[1].z - 50, 2, 12, C_CONC2, "metro");
    }
    // overpass: elevated road on pillars
    {
      const p = pois[2];
      const hP = {};                                   // C-PAD: each pillar stands on its own level pad; the deck above it is built off the same height
      for (let s = -2; s <= 2; s++) {
        const x = p.x + s * 30;
        const gy = hP[s] = groundPad(x, p.z, 1.7, 1.7, { gen: "overpass" });
        addBox(x, gy + 4, p.z, 3, 8, 3, C_CONC2);
        addBox(x, gy + 8.6, p.z, 32, 1.2, 9, C_CONC);
      }
      // ramp must reach the DECK TOP (nearest pillar deck center+8.6 + half-thick 0.6
      // ≈ ground+9.2); the old fixed 8.2 climb left a ~1m step > STEP_UP so the deck
      // + its rooftop loot were unreachable on foot.
      {
        const gBase = heightAt0(p.x - 78, p.z);
        const deckTop = hP[-2] + 9.2;
        // The ramp's high end used to be 11 m INSIDE the first deck's footprint: its surface met the deck's west face 5 m below the deck top
        // and then rose under the deck's underside (head clearance gone 2.4 m later), so nobody could climb the last 8 m. It now climbs to the
        // deck's WEST FACE (x = p.x - 76, deck spans p.x - 76 .. p.x - 44) and lands on the deck top.
        addRampSnap(p.x - 76, p.z, 9, Math.max(gBase + 8.2, deckTop), 26, 0, C_CONC);
      }
      chest(p.x, hP[0] + 9.9, p.z, p.id);
      loot(p.x + 30, hP[1] + 9.9, p.z, p.id);
      // a station building under the deck — the POI was five pillars and a slab,
      // i.e. nothing to fight over once you had taken the deck. Slotted between the
      // pillars at p.x and p.x+30 (both 3 m square) so it fouls neither.
      hut(p.x + 15, p.z, 8, 6, 0, C_BRICKB, p.id);
    }
    // container yard (metal farm)
    {
      const p = pois[3];
      // 14 containers over ~38,000 m2 was a name, not a place. ~40 on the ground and
      // a second tier over a third of them, each stack given a ramp so the high
      // ground is holdable on foot. The +2.8 lift matches the collider top offset
      // the instancing loop already uses for this kind.
      // A stack is laid out from the REAL lower container (baked table: height 1.277 x s, half length 1.40 x s, half width 0.628 x s). The
      // upper used to sit at b.y + 2.8 whatever the lower's scale was (the lower is 2.04 .. 2.81 m tall, median gap 0.39 m, up to 0.76),
      // the ramp ended 0.4-2.5 m short of the lower's end face, and the loot was authored inside the upper container.
      const CT = PT && PT.kinds.container;
      const cH = CT ? CT.height : 1.277, cL = CT ? CT.parts[0].h[0] : 1.4, cW = CT ? CT.parts[0].h[1] : 0.628;
      const base = [], yardClash = [];
      yardInfo = null;
      for (let i = 0; i < 40; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.6, z = p.z + (rng() - 0.5) * p.r * 1.6;
        const it = { x, y: heightAt0(x, z), z, s: 1.6 + rng() * 0.6, ry: Math.floor(rng() * 4) * Math.PI / 2 };
        if (inCity(x, z, 4)) it.drop = true;          // (Wave 7: a container never stands in the yard town's blocks; the draws above already happened)
        if (i % 3 !== 0) it.reliefMax = 0.9;     // a single container is LEVEL now: on ground that rises more than this under its base it would be half buried, so it is dropped (a stack base carries its upper, ramp and loot and stays)
        props.container.push(it);
        base.push(it);
      }
      // The yard's other containers are scattered by the seeded generator without knowing where a stack's ramp will run (6 m, longer on a slope), so
      // on 3 seeds of 5 a container lay across a ramp's foot, its side or its plank and the ramp could not be climbed or descended (ashgrid seeds
      // 1234, 31337: 5 ramps, measured with the real mover). PLAN every stack first (settle its base, plan its ramp: both pure), clear the corridor
      // of each ramp (the plank, a capsule's width either side, 0.6 m of approach beyond the foot), THEN build. Draw first, drop after, like the
      // trees' `rej`: every random draw happens in the same order (the build pass draws for a dropped stack too), so the shared RNG stream and
      // every kept container's anchor are exactly what they were; only the colliders of a dropped container go.
      //   * a single container (index not a multiple of 3) whose footprint meets a corridor is dropped (finalizeProps);
      //   * a stack whose base meets another stack's corridor or plank loses ITS ramp, upper and base only if it carries no loot (every
      //     second stack does, i % 6 === 0: its loot point is part of the seeded world and stays); two looted stacks that clash stay, and are counted in yardClash.
      const half = (it) => [(Math.abs(Math.cos(it.ry)) * cL + Math.abs(Math.sin(it.ry)) * cW) * it.s, (Math.abs(Math.sin(it.ry)) * cL + Math.abs(Math.cos(it.ry)) * cW) * it.s];
      const LAT = 0.5, FOOT = 0.6;                                                    // a capsule's radius + slack either side; the approach beyond the foot
      const stacks = [];
      for (let i = 0; i < base.length; i += 3) {
        const b = base[i];
        b.flat = true;                                                   // a stack base stays level
        // D2: a base on ground that rises more than 0.8 m under its footprint slides (in 1.5 m steps, up to 6 m, to the flattest spot of eight directions) before it is settled: a level
        // 6 m container on such a slope either floats at its low end or sinks at its high one, and a single base of 45 did both within a hair of the placement gates' bars
        if (groundRelief("container", b) > 0.8) {
          const ox = b.x, oz = b.z;
          let best = groundRelief("container", b), bx = ox, bz = oz;
          for (let rr2 = 1.5; rr2 <= 6 && best > 0.8; rr2 += 1.5) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            b.x = ox + dx * rr2; b.z = oz + dz * rr2;
            const q = groundRelief("container", b);
            if (q < best - 0.02) { best = q; bx = b.x; bz = b.z; }
          }
          b.x = bx; b.z = bz;
        }
        settleProp("container", b);
        const topY = b.y + cH * b.s;                                     // the real top of the lower container
        const alongZ = Math.abs(Math.sin(b.ry)) > 0.5, hl = cL * b.s;    // long axis along z when yawed a quarter turn; half length
        // the ramp comes up the + end of the long axis (+Z for a container lying along z, +X for one along x) and lands 0.3 m onto the roof
        const rp = alongZ ? planRampSnap(b.x, b.z + hl, 2.2, topY, 6, 3) : planRampSnap(b.x + hl, b.z, 2.2, topY, 6, 1);
        const plank = alongZ ? [b.x - 1.1, b.x + 1.1, rp.cz - rp.run / 2, rp.cz + rp.run / 2] : [rp.cx - rp.run / 2, rp.cx + rp.run / 2, b.z - 1.1, b.z + 1.1];   // [x0, x1, z0, z1]
        const corr = alongZ ? [plank[0] - LAT, plank[1] + LAT, plank[2], plank[3] + FOOT] : [plank[0], plank[1] + FOOT, plank[2] - LAT, plank[3] + LAT];
        stacks.push({ i, b, topY, alongZ, hl, rp, plank, corr, looted: i % 6 === 0, dead: inCity(b.x, b.z, 14) || inCity(rp.cx, rp.cz, 14) });
      }
      const meets = (r, it) => { const [hx, hz] = half(it); return !(it.x + hx <= r[0] || it.x - hx >= r[1] || it.z + hz <= r[2] || it.z - hz >= r[3]); };
      for (let a = 0; a < stacks.length; a++) for (let c = a + 1; c < stacks.length; c++) {
        const A = stacks[a], B = stacks[c];
        if (A.dead || B.dead) continue;
        if (!(meets(A.corr, B.b) || meets(B.corr, A.b) || rectsMeet(A.corr, B.plank) || rectsMeet(B.corr, A.plank))) continue;
        if (!B.looted) B.dead = true; else if (!A.looted) A.dead = true; else yardClash.push([A.i, B.i]);
      }
      for (const S of stacks) {
        if (S.dead) continue;
        for (let j = 0; j < base.length; j++) if (j % 3 !== 0 && meets(S.corr, base[j])) base[j].drop = true;
      }
      for (const S of stacks) {
        const { i, b, topY, alongZ, hl, rp } = S;
        const s2 = 1.6 + rng() * 0.6;
        rng();                                                           // (the upper's old random yaw: still drawn, so the stream is unchanged; the upper now lies along its base)
        if (S.dead) { b.drop = true; continue; }
        // the upper container: along the base, never wider than it, set back so the last 1.2 m of the base's top (at the ramp end) stays free
        const sUp = Math.min(s2, b.s - 0.43), tc = hl - 1.2 - cL * sUp;
        props.container.push({ x: b.x + (alongZ ? 0 : tc), y: topY, z: b.z + (alongZ ? tc : 0), s: sUp, ry: b.ry, flat: true, set: true, onTop: true });   // onTop: rests on the lower container, not on the ground
        addRamp(rp.cx, rp.cy, rp.cz, 2.2, rp.rise, rp.run, alongZ ? 3 : 1, shade(C_METAL, 0.8));
        if (i % 6 === 0) loot(alongZ ? b.x : b.x + hl - 0.6, topY + 0.5, alongZ ? b.z + hl - 0.6 : b.z, p.id);
      }
      yardInfo = { stacks: stacks.length, stacksDropped: stacks.filter((S) => S.dead).length, singlesDropped: base.filter((o, j) => j % 3 !== 0 && o.drop).length, singlesTooSteep: base.filter((o) => !o.drop && o.reliefMax != null && groundRelief("container", o) > o.reliefMax).length, unresolvedClashes: yardClash };   // (read by the gates via propStats.yard)
      for (let i = 0; i < 3; i++) {
        const cx = p.x + (rng() - 0.5) * p.r, cz = p.z + (rng() - 0.5) * p.r;
        if (!city || openSpot(cx, heightAt0(cx, cz) + 0.6, cz)) chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);       // was sampled at the POI centre — floated on the slope
      }
    }
    // mall: big box with internal slabs
    if (!city) {
      tower(pois[4].x, pois[4].z, 2, 22, C_BRICKB, "mall");
      hut(pois[4].x - 30, pois[4].z + 20, 8, 6, 0, C_CONC2, "mall");
    }
    // crane heights: tallest structure
    {
      const p = pois[5]; const y = groundPad(p.x, p.z, 2.2, 2.2, { gen: "crane" });
      addBox(p.x, y + 14, p.z, 3.4, 28, 3.4, "#c8b24a");
      addBox(p.x, y + 28.6, p.z + 8, 2.6, 1.2, 26, "#c8b24a");
      // the ramp ran up BESIDE the jib (2.4 m of air between its top and the jib's side, and the jib is 1.2 m higher): it now climbs to the jib's
      // top (y+29.2) and a short gangway joins its high end to the jib
      addRampSnap(p.x + 5, p.z + 17, 2.6, y + 29.2, 34, 2, "#a89432", { o: 0 });
      addBox(p.x + 2.6, y + 28.6, p.z + 16.6, 3.2, 1.2, 2.6, "#c8b24a");
      chest(p.x, y + 29.6, p.z + 14, p.id);
      if (!city) tower(p.x + 40, p.z + 20, 3, 11, C_CONC, p.id);
    }
    // rubble row: broken walls (cover playground)
    {
      const p = pois[6];
      // 16 fragments spread over +/-93 m is ~46 m of mean spacing — every piece of
      // cover on its own, which is scattered debris rather than a fight space. ~35
      // in 6 KNOTS of 5-7 instead: inside a knot the pieces interlock, and the gaps
      // between knots are the rotations.
      // (Wave 8 fix round, lane K1: the pieces of a knot stand CLOSE, never touching - fragSpot - so a knot is a maze of walkways >= 1.2 m, not of junction pockets)
      const frags = [];
      for (let k = 0; k < 6; k++) {
        const kx = p.x + (rng() - 0.5) * p.r * 1.6, kz = p.z + (rng() - 0.5) * p.r * 1.6;
        const n = 5 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const x0 = kx + (rng() - 0.5) * 22, z0 = kz + (rng() - 0.5) * 22;
          // The tint is QUANTISED to 4 steps on purpose: addBox keys its batches by
          // the colour string and shade() returns a hex, so a continuous multiplier
          // gave every wall a unique key — one merged mesh each, with its own
          // MeshStandardMaterial + map + normalMap, for one pile of rubble.
          // This is the only shade() call site in the file that passes a random k.
          const fw = 3.5 + rng() * 3, fh = 1.8 + rng() * 1.6, fc = shade(C_BRICKB, 0.8 + Math.floor(rng() * 4) * 0.1), fr = rng() * Math.PI;   // same draws, same order
          if (inCity(x0, z0, 3)) continue;                  // (Wave 7: no rubble inside the village's blocks)
          const sp = fragSpot(frags, kx, kz, x0, z0, fw, 0.5, fr);
          if (!sp) continue;
          if (inCity(sp[0], sp[1], 3)) { frags.pop(); continue; }
          const x = sp[0], z = sp[1], y = heightAt0(x, z);
          addBox(x, Math.min(y + 0.9, lowGround(x, z, fw, 0.5, fr) + fh / 2), z, fw, fh, 0.5, fc, { rotY: fr });
        }
        if (k % 2 === 0 && !inRects(cityBld, kx, kz, 2) && !inRects(cityDecks, kx, kz, 2) && (!city || openSpot(kx, heightAt0(kx, kz) + 0.5, kz))) loot(kx, heightAt0(kx, kz) + 0.5, kz, p.id);
      }
      for (let i = 0; i < 2; i++) {
        const cx = p.x + (rng() - 0.5) * p.r, cz = p.z + (rng() - 0.5) * p.r;
        if (!inRects(cityBld, cx, cz, 2) && !inRects(cityDecks, cx, cz, 2) && (!city || openSpot(cx, heightAt0(cx, cz) + 0.6, cz))) chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);       // was sampled at the POI centre — floated on the slope
      }
    }
    // motor pool (cars = metal)
    {
      const p = pois[7];
      for (let i = 0; i < 10; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.6, z = p.z + (rng() - 0.5) * p.r * 1.6;
        const y = heightAt0(x, z);
        if (inCity(x, z, 3)) continue;
        props.car.push({ x, y, z, s: 2.2, ry: rng() * Math.PI * 2 });
      }
      if (!city) hut(p.x, p.z - 40, 10, 8, 0, C_METAL, p.id);
    }
    // street cars + barrels scattered
    for (let i = 0; i < 26; i++) {
      const x = (rng() * 2 - 1) * (HALF - 80), z = (rng() * 2 - 1) * (HALF - 80);
      if (nearPoi(x, z, 10) || inCity(x, z, 3)) continue;
      const y = heightAt0(x, z);
      props.car.push({ x, y, z, s: 2.2, ry: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 40; i++) {
      const x = (rng() * 2 - 1) * (HALF - 60), z = (rng() * 2 - 1) * (HALF - 60);
      if (inCity(x, z, 3)) continue;
      const y = heightAt0(x, z);
      props.barrel.push({ x, y, z, s: 1.4, ry: rng() * Math.PI });
    }
    // savanna outpost: an adobe/sandstone residential town on a street
    if (!city) town(pois[8], ["#c8a06a", "#b98f5a"], "#b5643c", { along: "x", nPer: 5, signature: "clocktower" });
    {
      // the Downtown water tower (skyline landmark): at (+100, +70) of the core in the Wave-6 layout; in the city the first free spot on a ring around it
      let wx = pois[0].x + 100, wz = pois[0].z + 70;
      if (city) {
        wx = NaN;
        for (let r = 120; r <= 220 && !(wx === wx); r += 20) for (let k = 0; k < 16; k++) {
          const a = 0.5 + k * Math.PI / 8, tx = pois[0].x + Math.cos(a) * r, tz = pois[0].z + Math.sin(a) * r;
          if (!inCity(tx, tz, 22) && !inRects(cityBld, tx, tz, 22)) { wx = tx; wz = tz; break; }
        }
      }
      if (wx === wx) waterTower(wx, wz, pois[0].id);
    }
    minorLandmarks(14, [C_CONC2, C_BRICKB], "#b5643c", { minH: 1.0 });
    // grid dims, not attempt counts. Measured on 2 seeds: 232 -> 821 props, mean
    // distance to nearest cover 48 m -> 23 m, open ground beyond 40 m 56% -> 8%.
    // 821 is BELOW Deepwood's already-shipping 845, so it is inside the proven
    // performance envelope rather than new ground.
    scatterTrees("tree", 26, 1, 25, "wood");
    scatterTrees("bush", 16, 0.6, 26, null);
    scatterTrees("rocks", 20, 1, 40, "brick");
  } else if (mapId === "deepwood") {
    const C_LOG = "#8a5a33", C_PLANK = "#a8794f", C_STONE = "#8f8a80";
    poi("logging", "Logging Camp", -430, -380, 110);
    poi("ranger", "Ranger Ridge", 300, -80, 120);
    poi("lakeside", "Lakeside Cabins", -260, 430, 130);
    poi("hollow", "Hunter's Hollow", 430, -430, 100);
    poi("quarry", "Old Quarry", -480, 60, 110);
    poi("mill", "Riverside Mill", 40, 40, 90);
    poi("firewatch", "Fire Watch", 60, -520, 80);
    poi("meadow", "Meadow Farm", 430, 430, 100);
    // WAVE 7b: the lodge villages and the mill-and-bridge compound come from towngen like Savanna's city (see the city section above); a page whose towngen.js did not load plays the
    // pre-7b layout below. The hamlets' landmarks (ranger towers, the lake pier, the hunters' blinds, the quarry rocks, the chapel) are drawn first / placed after the layout and
    // dropped or moved where they would stand in a street or a yard.
    city = await prepareCity();
    if (city) { registerCityRoads(); registerCityPlateaus(); registerCityExtras(); buildCityBuildings(); } else buildRoads(7);
    // logging camp → a small mill town (+ its signature log piles)
    if (!city) town(pois[0], [C_LOG, C_PLANK], "#7a4a2a", { along: "x", nPer: 4 });
    if (!city) {
      const p = pois[0];
      for (let i = 0; i < 8; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.5, z = p.z + (rng() - 0.5) * p.r * 1.5;
        const y = heightAt0(x, z);
        const lr = rng() * Math.PI;
        addBox(x, Math.min(y + 0.5, lowGround(x, z, 1, 4.5, lr) + 0.5), z, 1, 1, 4.5, shade(C_LOG, 0.9), { rotY: lr }); // log piles
      }
    }
    // ranger ridge + fire watch towers
    if (city) {
      // (Wave 7b: a ranger tower needs a 6 x 14 m clearing for its switchback: the first free spot of a ring round the POI, 20-90 m out; the Fire Watch tower stands on the Fire Watch green)
      const free = (cx, cz, rmin, rmax) => { for (let r = rmin; r <= rmax; r += 10) for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6 + r * 0.37, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (baseH(x, z) > waterY + 1.5 && !cityBlocks(x, z, 14)) return [x, z]; } return null; };
      const a1 = free(pois[1].x, pois[1].z, 30, 110), a2 = free(pois[1].x + 20, pois[1].z + 30, 40, 120), a3 = free(pois[6].x, pois[6].z, 24, 90);
      if (a1) rangerTower(a1[0], a1[1], C_PLANK, "ranger");
      if (a2) rangerTower(a2[0], a2[1], C_PLANK, "ranger");
      if (a3) rangerTower(a3[0], a3[1], C_PLANK, "firewatch");
    } else {
    rangerTower(pois[1].x - 20, pois[1].z, C_PLANK, "ranger");
    rangerTower(pois[1].x + 45, pois[1].z + 35, C_PLANK, "ranger");
    rangerTower(pois[6].x, pois[6].z, C_PLANK, "firewatch");
    }
    // lakeside cabins → a lakeside town (+ its pier)
    if (!city) town(pois[2], [C_PLANK, C_LOG], "#6a4028", { along: "x", nPer: 4, minH: waterY + 0.6, layout: "crossroads" });
    if (city) { const ps = shoreSpot(pois[2].x, pois[2].z, 150, waterY + 0.3, waterY + 1.6, 12); if (ps) pier(ps[0], ps[1], 18, 0.3, C_PLANK, pois[2].id); }   // (Wave 7b: the pier starts on the shore beside the lodge town)
    else pier(pois[2].x + 40, pois[2].z + 60, 18, 0.3, C_PLANK, pois[2].id);
    // hunter's hollow: blinds (elevated boxes)
    {
      const p = pois[3];
      for (let i = 0; i < 4; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.4, z = p.z + (rng() - 0.5) * p.r * 1.4;
        if (city && cityBlocks(x, z, 7)) continue;                              // (Wave 7b: a blind in a yard or on a street is not built; its draws were made)
        const y = heightAt0(x, z);
        addBox(x, y + 2.6, z, 2.6, 2.4, 2.6, C_PLANK);
        addStilt(x - 1, z, 0.4, y + 2.8, shade(C_PLANK, 0.8), true);      // legs reach the ground under each one
        addStilt(x + 1, z, 0.4, y + 2.8, shade(C_PLANK, 0.8), true);
        addRampSnap(x, z + 1.3, 1.6, y + 3.8, 4.4, 3, shade(C_PLANK, 0.85));   // face = the blind's front (z + 1.3)
        if (i % 2 === 0) chest(x, y + 4.2, z, p.id);
      }
    }
    // quarry: rock bowl (brick farm)
    {
      const p = pois[4];
      for (let i = 0; i < 12; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.5, z = p.z + (rng() - 0.5) * p.r * 1.5;
        const y = heightAt0(x, z);
        const s = 1.6 + rng() * 1.8, ry = rng() * Math.PI * 2;                                       // (the same draws in the same order as before)
        // Wave 7b (a map with a city layout): a quarry rock is dropped where the ground under its base rises more than 1.2 m (finalizeProps' reliefMax) - the quarry lane's pads cut
        // 2.7 - 3.3 m banks, and a 3 m rock on one stood with its drawn hull 1.5 m over its own low collider box (rocksweep, Deepwood s1); plus the scattered rocks' slope rule (`rej`)
        props.rocks.push(city ? { x, y, z, s, ry, rej: 1, reliefMax: 1.2 } : { x, y, z, s, ry });
      }
      if (!city) { chest(p.x, heightAt0(p.x, p.z) + 0.6, p.z, p.id); hut(p.x + 40, p.z - 30, 6, 5, 0, C_STONE, p.id); }
    }
    // riverside mill (Wave 7b: the mill-and-bridge compound of the layout replaces the tower and the hut)
    if (!city) {
      const p = pois[5];
      tower(p.x, p.z, 2, 10, C_PLANK, p.id);
      hut(p.x - 24, p.z + 14, 6, 5, 0, C_LOG, p.id);
    }
    // meadow farm → actual farmland (crop rows + barn + silo + fence)
    if (!city) farmland(pois[7], { minH: 0.6 });
    if (city) {                                                                  // the Riverside Mill chapel steeple (landmark): the first free dry spot of a ring round the compound
      const p = pois[5];
      for (let r = 100; r <= 190; r += 10) { let done = false; for (let k = 0; k < 12 && !done; k++) { const a = k * Math.PI / 6 + 0.9, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (baseH(x, z) > waterY + 2.5 && !cityBlocks(x, z, 14) && baseH(x + 8, z) > waterY + 2.5 && baseH(x - 8, z) > waterY + 2.5 && baseH(x, z + 10) > waterY + 2.5 && baseH(x, z - 10) > waterY + 2.5) { steeple(x, z, p.id); done = true; } } if (done) break; }
    } else steeple(pois[5].x + 48, pois[5].z + 42, pois[5].id);                 // Riverside Mill chapel steeple (landmark)
    minorLandmarks(14, [C_LOG, C_PLANK], "#6a4028", { minH: waterY + 1.2 });
    // grid dims, not attempt counts. Deepwood was already the densest map (845
    // props, mean distance to cover 26 m), so it is the one map where stratifying
    // ADDS load rather than fixing a hole. pine is 26 rather than the 30 the other
    // measurements used: that lands ~900 total instead of ~1,160, keeping this map
    // near its shipped prop budget while the same pass adds a clutter layer and a
    // lamp-light pool. Cover distance still improves (26 m -> ~21 m).
    scatterTrees("pine", 26, 1.2, 46, "wood");
    scatterTrees("birch", 20, 1.2, 40, "wood");
    scatterTrees("bush", 16, 0.8, 40, null);
    scatterTrees("rocks", 12, 2, 60, "brick");
    lookoutTower();                                  // LC-90: the map-scale landmark Deepwood lacked (after the scatter: it draws nothing from the world stream)
    if (lookout) lookoutBeacon(lookout);
  }
  // LC-90: the lookout's BEACON reads through the haze. From the plane the timber tower is 83 % fog at 700 m (FogExp2), a grey ghost (lm_probe crops); a
  // lamp is what carries through haze, so the beacon gets a warm additive glow that ignores the fog: a sprite whose size follows the camera distance so it
  // stays ~10 px across from 75 m out (1.2 m up close: a lit lamp, not a halo), with a slow 0.5 Hz pulse. One sprite, one draw call, the birds' sprite
  // program (no new shader); every tier (a landmark is not a quality feature). Cosmetic: no collider, no world-stream draw.
  function lookoutBeacon(L) {
    if (typeof document === "undefined") return;
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const cx = cv.getContext("2d"), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,246,214,1)"); gr.addColorStop(0.18, "rgba(255,214,130,0.9)"); gr.addColorStop(0.5, "rgba(255,170,70,0.28)"); gr.addColorStop(1, "rgba(255,150,40,0)");
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const sp = new THREE.Sprite(mat);
    sp.name = "lookout:beacon"; sp.position.set(L.x, L.top - 0.15, L.z); sp.renderOrder = 2;
    g.add(sp);
    trackUpdater((dt, t) => {
      const c = W.camera; if (!c) return;
      const d = c.position.distanceTo(sp.position);
      sp.scale.setScalar(Math.min(20, Math.max(1.2, d * 0.016)));
      mat.opacity = (0.82 + 0.18 * Math.sin(t * 3.1)) * Math.min(1, 0.35 + d / 160);
    });
  }

  // P23 / LC-47: rotation cover (towngen.js rotationCover): the holes the wild scatter left between the POIs get a rock outcrop, a ruined wall or (beside a road) an abandoned
  // car - only where nothing that stops a bullet stands within 15.5 m. Built with what the map already draws (the instanced rocks / cars and their baked colliders, quarter-turn
  // box walls in the structure batches): no new mesh, program or draw call. towngen draws from its own per-cell sub-streams: the shared `rng` is never touched.
  if (city && typeof city.TG.rotationCover === "function") {
    const RAD = { palm: 0.5, tree: 0.6, pine: 0.55, birch: 0.5, rocks: 1.4, car: 1.6, container: 2.2 };
    const have = [];
    for (const k in RAD) for (const it of props[k] || []) have.push([it.x, it.z, RAD[k] * (it.s || 1)]);
    for (const r of cityBld) have.push([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2, Math.min(r[2] - r[0], r[3] - r[1]) / 2]);
    const free = (x, z, pad) => !(nearPoi(x, z, pad) || nearLandmark(x, z) || inCity(x, z, pad) || inRects(cityBld, x, z, pad) || inRects(cityDecks, x, z, pad));
    const cov = city.TG.rotationCover(seed, mapId, { half: HALF, waterY, h: (x, z) => heightAt0(x, z), free, cover: have, roads: cityRoadLog });
    for (const c of cov.pieces) {
      if (c.kind === "rocks") props.rocks.push({ x: c.x, y: heightAt0(c.x, c.z), z: c.z, s: c.s, ry: c.ry, rej: 1, reliefMax: 1.2 });
      else if (c.kind === "car") props.car.push({ x: c.x, y: heightAt0(c.x, c.z), z: c.z, s: 2.2, ry: c.ry, rej: 1 });
      else if (c.kind === "wall") {
        const ry = c.quarter ? Math.PI / 2 : 0;
        addBox(c.x, lowGround(c.x, c.z, c.w, c.d, ry) + c.h / 2 - 0.15, c.z, c.w, c.h + 0.3, c.d, c.tone, { rotY: ry });
      }
    }
    city.cover = cov.stats; city.coverPieces = cov.pieces;            // (the gates / shot tools read them)
  }

  // (the road network between the POIs is registered right after each branch declares its POIs, above: its corridors must be in the ground
  // BEFORE any building or piece of street furniture is built on it)

  // ── C-PAD: BAKE THE GROUND ─────────────────────────────────────────────────────────────────────────────────────────
  // Every POI, building and road has registered its pad or corridor. Freeze base + pads + corridors into the 609 x 609 Float32 lattice;
  // from here heightAt0 IS the lattice (triangle-exact, the diagonal three's PlaneGeometry draws), and everything that follows reads it:
  // the terrain chunks, the road ribbons, sky islands, wild loot, prop grounding, bots, the camera, the minimap.
  const _bk0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  field.bake();
  const bakeMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - _bk0;
  heightAt0 = (x, z) => field.at(x, z);
  // the world-shader layer's ground (LCU.uLcHgt): the baked lattice as a 609 x 609 half-float texture, linear-filtered, so the drawn ground height at any
  // fragment is one fetch (the walls' wear band, the water's depth colour and foam). Medium and up; freed with the map.
  if (LCFX) {
    const L = field.lat, hp = new Uint16Array(LAT_N * LAT_N);
    for (let i = 0; i < hp.length; i++) hp[i] = THREE.DataUtils.toHalfFloat(L[i]);
    const ht = new THREE.DataTexture(hp, LAT_N, LAT_N, THREE.RedFormat, THREE.HalfFloatType);
    ht.minFilter = ht.magFilter = THREE.LinearFilter; ht.generateMipmaps = false; ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping; ht.needsUpdate = true;
    lcOwn(ht);
    LCU.uLcHgt.value = ht;
    LCU.uLcHgtK.value.set(LAT_CELLS / (SIZE * LAT_N), (HALF * LAT_CELLS / SIZE + 0.5) / LAT_N, 0, 0);
    LCU.uLcWater.value.x = waterY;
  }
  photo = await photoPromise;
  buildTerrain();
  emitRoads();
  if (city) buildCityGround();
  for (let i = 0; i < lootPoints.length; i++) { const p = lootPoints[i], d = p.y - lootG[i]; if (p.house == null && d >= 0 && d <= 1) p.y += heightAt0(p.x, p.z) - lootG[i]; }   // (WAVE 8: a house point lies on its floor / furniture: as given)
  for (let i = 0; i < chestPoints.length; i++) { const p = chestPoints[i], d = p.y - chestG[i]; if (d >= 0 && d <= 1) p.y += heightAt0(p.x, p.z) - chestG[i]; }
  await yieldPhase();                                // phase 1/3 done — let the loader paint

  // ── FLOATING SKY-ISLANDS (Final Drop's signature look) ────────────────────
  // Hovering rock islands with grassy tops, trees, and premium loot. Each one
  // carries a LAUNCH PORTAL ring: step through → flung back into the
  // atmosphere with the parachute (falling off is survivable, the portal is
  // the stylish exit).
  const islandTrees = [];   // {kind, x, y, z, s, ry} — cloned GLBs, placed later
  const portals = [];       // {x, y, z} — walk-in launch rings
  // Every portal is the identical three meshes, and addPortal runs 9-12 times a
  // match (one per sky island plus up to four on the ground) — it used to build
  // two fresh TorusGeometry, a CircleGeometry and three materials on every call.
  // Built once per map instead; disposeMapResources dedupes by identity, so the
  // shared instances are still freed exactly once at teardown.
  let _pGeo = null, _pMat = null;
  function addPortal(px, py, pz, faceYaw) {
    if (!_pGeo) {
      _pGeo = {
        ring: new THREE.TorusGeometry(1.5, 0.16, 10, 28),
        ring2: new THREE.TorusGeometry(1.22, 0.06, 8, 26),
        swirl: new THREE.CircleGeometry(1.35, 24),
      };
      _pMat = {
        ring: new THREE.MeshStandardMaterial({ color: 0x37e0ff, emissive: 0x1ec8f0, emissiveIntensity: 1.6, roughness: 0.4 }),
        ring2: new THREE.MeshStandardMaterial({ color: 0xb26bff, emissive: 0x9b4dff, emissiveIntensity: 1.4, roughness: 0.4 }),
        swirl: new THREE.MeshBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
      };
    }
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(_pGeo.ring, _pMat.ring));
    grp.add(new THREE.Mesh(_pGeo.ring2, _pMat.ring2));
    grp.add(new THREE.Mesh(_pGeo.swirl, _pMat.swirl));
    grp.position.set(px, py + 1.8, pz);
    grp.rotation.y = faceYaw;
    g.add(grp);
    portals.push({ x: px, y: py, z: pz, obj: grp, kind: _pKind });
  }
  let _pKind = "island";          // LC-51: every portal record says where it stands ("island" | "ground"), for the big map (hud) and the gates
  {
    const nIsl = 5 + Math.floor(rng() * 3);
    const grassC = new THREE.Color(mapId === "ashgrid" ? "#a7ad55" : mapId === "deepwood" ? "#3f7a3f" : "#3fae62").multiplyScalar(Math.min(1, GRADE.ground * 1.25));   // (LC-04: the turf takes the ground grade, a little lighter: it is lit from above, the terrain mostly grazed)
    const turfSideC = new THREE.Color("#7a5f45").multiplyScalar(Math.min(1, GRADE.ground * 1.25)), islWhite = new THREE.Color(1, 1, 1);   // (LC-73: the turf's earth-and-root side)
    // #7a6a58 is linear ~(0.19, 0.14, 0.10). The cone is rotated 180 degrees below,
    // so its lit faces all point DOWN and the only light reaching them is the
    // hemisphere's groundColor — at that albedo the signature feature of the map
    // read as a flat black triangle in the sky. ~60% brighter here, plus a fixed
    // skylight term on the material (below).
    const rockC = "#9a8a75";
    // The islands were the ONLY untextured surfaces in the world — terrain, roads,
    // water and every structure carry the procedural grain + normal map, these two
    // carried flat vertex colour. On the feature the code calls the signature look.
    // UVs are scaled on the GEOMETRY (below) rather than by cloning the texture: a
    // clone shares .source with the _texCache entry and disposeMapResources would
    // free it as non-shared, killing the GPU upload the NEXT match still needs.
    let _islTex = null;
    try { _islTex = groundTex(aniso); } catch (e) { _islTex = null; }
    const islMat = (color, rough, geo, span) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
      if (_islTex) {
        m.map = _islTex.map; m.normalMap = _islTex.normal;
        m.normalScale = new THREE.Vector2(0.5, 0.5);
        const uv = geo.attributes.uv;
        if (uv) { for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * span, uv.getY(i) * span); uv.needsUpdate = true; }
      }
      return m;
    };
    const isl = (mapId === "ashgrid" || city) ? { tops: [], rocks: [] } : null;     // (Wave 7b: the themed maps bake their islands too - a drop view over Deepwood saw 4-6 islands = 8-12 draw calls)
    // LC-73 (P3): the islands were a 9-gon disc on a 14-gon cone. Now the grass top is a 27-gon whose rim wanders between 0.95 and 1.0 of the radius (inside
    // the three collider boxes' cover, which is unchanged) with a slight dome, and the underside is a lathed mass: a lip of earth under the turf, a bulge,
    // strata, then a long irregular taper, its every vertex pushed in / out by a seeded-by-index (no random draw) noise of angle and depth, plus three
    // hanging spurs merged in. Same meshes (the baked tops / rocks on the themed maps, one each), so 0 extra draw calls; ~1.5 k triangles an island.
    const _iN = (a, b, k) => Math.sin(a * 1.7 + k * 12.9898) * 0.5 + Math.sin(a * 3.1 + b * 2.3 + k * 4.1) * 0.3 + Math.sin(a * 6.7 - b * 4.9 + k * 7.7) * 0.2;
    const islandTopGeo = (rad, k) => {
      const g = new THREE.CylinderGeometry(rad, rad * 0.93, 1.6, 27, 1);
      const P = g.attributes.position;
      for (let v = 0; v < P.count; v++) {
        const x = P.getX(v), y = P.getY(v), z = P.getZ(v), r = Math.hypot(x, z);
        if (r < 1e-4) { if (y > 0) P.setY(v, y + 0.18); continue; }                    // (the cap centre: a gentle dome)
        const a = Math.atan2(z, x), f = 0.975 + 0.025 * _iN(a, 0, k);
        P.setX(v, x * f); P.setZ(v, z * f);
      }
      g.computeVertexNormals();
      // LC-73: the turf's 1.6 m side read as a bright green slab edge (the top one flat colour): the side is a dark earth-and-root band, the cap rim a little
      // darker than its crown, as vertex colours x the material (no extra draw)
      // (the material is white: the vertex colour IS the colour - turf on the cap, earth on the side)
      const N = g.attributes.normal, col = new Float32Array(P.count * 3);
      for (let v = 0; v < P.count; v++) {
        const up = N.getY(v), r = Math.hypot(P.getX(v), P.getZ(v)) / rad;
        const c = up > 0.5 ? grassC : turfSideC, f = up > 0.5 ? (r < 1e-3 ? 1.06 : 0.86) : 1;
        col[v * 3] = c.r * f; col[v * 3 + 1] = c.g * f; col[v * 3 + 2] = c.b * f;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    const islandRockGeo = (rad, k) => {
      // the profile, top (y = 0, under the turf) to the tip (y = -1): radius x rad
      const prof = [[0.93, 0.0], [0.97, -0.04], [0.9, -0.09], [0.94, -0.15], [0.82, -0.24], [0.86, -0.31], [0.7, -0.42], [0.56, -0.55], [0.44, -0.66], [0.3, -0.78], [0.17, -0.89], [0.0, -1.0]];
      const H = rad * 1.5;
      const g = new THREE.LatheGeometry(prof.slice().reverse().map((q) => new THREE.Vector2(q[0] * rad, q[1] * H)), 22);     // (tip first: y increasing, so the faces point outward)
      const P = g.attributes.position;
      for (let v = 0; v < P.count; v++) {
        const x = P.getX(v), y = P.getY(v), z = P.getZ(v), r = Math.hypot(x, z);
        if (r < 1e-4) continue;
        const a = Math.atan2(z, x), d = -y / H, f = 1 + (0.06 + 0.22 * d) * _iN(a * 1.3, d * 5, k) + 0.05 * Math.sin(d * 31 + k);
        P.setX(v, x * f); P.setZ(v, z * f);
        P.setY(v, y - H * 0.18 * d * d * Math.max(0, _iN(a * 2.1, 0, k + 3)));       // (the lower half hangs further on some sides: an uneven tip)
      }
      // the lathe's top is y = 0, its tip y = -H; the caller flips it (rotateX PI) and places it as the old cone (centre at the cone's half height)
      g.translate(0, H / 2, 0);
      g.rotateX(Math.PI);                                                               // (pre-flip: the caller's rotateX(PI) puts the mass back under the top)
      const parts = [g];
      for (let t = 0; t < 3; t++) {
        const a = k * 1.9 + t * 2.1, rr = rad * (0.42 + 0.12 * t), h2 = H * (0.35 + 0.08 * t);
        const sp = new THREE.ConeGeometry(rad * (0.2 - 0.03 * t), h2, 7, 1);
        sp.rotateX(Math.PI); sp.translate(Math.cos(a) * rr, -H * 0.18 - h2 / 2, Math.sin(a) * rr);
        sp.translate(0, H / 2, 0); sp.rotateX(Math.PI);
        parts.push(sp);
      }
      const m = BufferGeometryUtils.mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q), false);
      for (const q of parts) q.dispose();
      m.computeVertexNormals();
      return m;
    };
    const islScaleUV = (geo, span) => { if (!_islTex) return; const uv = geo.attributes.uv; if (uv) { for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * span, uv.getY(i) * span); uv.needsUpdate = true; } };
    for (let i = 0; i < nIsl; i++) {
      const ang = rng() * Math.PI * 2;
      const rr = 180 + rng() * (HALF - 320);
      const ix = Math.cos(ang) * rr, iz = Math.sin(ang) * rr;
      const groundH = baseH(ix, iz);
      if (groundH < waterY - 2) continue;                      // not over deep ocean
      if (mapId !== "ashgrid" && city && cityBlocks(ix, iz, 30)) continue;     // (Wave 7b: an island never floats over a town - a mid-rise's shaft reaches 34 m and the island's loot ended up inside it)
      const topY = Math.max(groundH, waterY) + 26 + rng() * 26; // 26-52m up
      const rad = 9 + rng() * 8;
      // grassy top disc — TILE = 8 m per texture tile, same density as the terrain
      const topGeo = islandTopGeo(rad, i);
      // D2 (Savanna only): the islands' discs and rocks are baked into ONE mesh each after the loop (a drop view over the whole map saw five islands = ten draw calls); they cast no
      // shadow there (a floating island 26-52 m up never shadows anything a player can see: the shadow box is +-55 m around the player and the merged mesh would sit in it for ever)
      const top = isl ? null : new THREE.Mesh(topGeo, Object.assign(islMat(islWhite, 0.95, topGeo, (rad * 2) / TILE), { vertexColors: true }));
      if (isl) { islScaleUV(topGeo, (rad * 2) / TILE); topGeo.translate(ix, topY - 0.8, iz); isl.tops.push(topGeo); }
      else {
        top.position.set(ix, topY - 0.8, iz);
        top.castShadow = true; top.receiveShadow = true;
        g.add(top);
      }
      // hanging rock cone underneath
      const rockGeo = islandRockGeo(rad, i);                              // LC-73: a jagged stratified mass with hanging spurs (was a 14-gon cone: a paper dart from below)
      if (isl) { islScaleUV(rockGeo, (rad * 2) / TILE); rockGeo.rotateX(Math.PI); rockGeo.translate(ix, topY - 1.4 - rad * 0.75, iz); isl.rocks.push(rockGeo); }
      else {
      const rock = new THREE.Mesh(rockGeo, islMat(rockC, 1, rockGeo, (rad * 2) / TILE));
      // A fixed skylight term at ~6% of the map's horizon colour lifts the fully
      // downward-facing underside without touching the rest of the scene's lighting,
      // and costs no extra light in the shader.
      rock.material.emissive.set(K.sky);
      rock.material.emissiveIntensity = 0.12;
      rock.rotation.x = Math.PI;
      rock.position.set(ix, topY - 1.4 - rad * 0.75, iz);
      // receiveShadow was missing, so the cone never darkened under the disc that
      // physically overhangs it — the island read as two unrelated lit objects.
      rock.castShadow = true; rock.receiveShadow = true;
      g.add(rock);
      }
      // walkable top collider — 0.92·rad matches the visible disc's octagon flat-to-flat
      // (was 0.86·rad, leaving the outer ~14% of grass unsupported → rim fall-through on
      // a hero feature that carries premium loot).
      // The 9-sided disc (circumradius `rad`, 0.94 .. 1.0 rad to its edge) used to get ONE square 0.92 rad each side: its corners stood 1.30 rad from
      // the centre, so every island carried ~19% of its area as invisible floor out over the void at four diagonals (a player could stand on air).
      // The plan's plus of TWO arms alone (0.95 x 0.42) leaves 15% of the walkable disc without a collider = rim fall-through, the thing the
      // 0.92 widening was made to cure. Two arms (0.95 x 0.55) plus a 0.78 hub are three plain boxes (contract C-COLL), measured on the real
      // 9-gon (offline fit over the polygon's area): invisible floor 19% -> 10% of the disc area, disc (r <= 0.94) without support 0.86% -> 0.00%.
      for (const [hx, hz] of [[0.95, 0.55], [0.55, 0.95], [0.78, 0.78]])
        { colliders.push(mkCollider("box", ix - rad * hx, ix + rad * hx, topY - 2.2, topY, iz - rad * hz, iz + rad * hz, -1, null, -1, 0)); colSurf.set(colliders[colliders.length - 1], "grass"); }
      // premium loot: every island gets a chest + a couple of floor items
      chest(ix + (rng() - 0.5) * rad * 0.6, topY + 0.4, iz + (rng() - 0.5) * rad * 0.6, "sky_island");
      loot(ix + (rng() - 0.5) * rad, topY + 0.3, iz + (rng() - 0.5) * rad, "sky_island");
      loot(ix + (rng() - 0.5) * rad, topY + 0.3, iz + (rng() - 0.5) * rad, "sky_island");
      // a tree or two on top (cloned, not instanced — few of them)
      const kind = mapId === "isla_viva" ? "palm" : mapId === "deepwood" ? "pine" : "tree";
      islandTrees.push({ kind, x: ix + (rng() - 0.5) * rad * 0.7, y: topY, z: iz + (rng() - 0.5) * rad * 0.7, s: 0.9 + rng() * 0.5, ry: rng() * Math.PI * 2 });
      if (rng() < 0.5) islandTrees.push({ kind, x: ix + (rng() - 0.5) * rad * 0.7, y: topY, z: iz + (rng() - 0.5) * rad * 0.7, s: 0.7 + rng() * 0.4, ry: rng() * Math.PI * 2 });
      // orange crystal landmark (Meshy deco — tolerant if absent)
      if (i % 2 === 0) islandTrees.push({ kind: "crystal", x: ix, y: topY, z: iz - rad * 0.4, s: 1, ry: rng() * Math.PI * 2 });
      // launch portal at the island rim, facing the center
      const pAng = rng() * Math.PI * 2;
      addPortal(ix + Math.cos(pAng) * rad * 0.55, topY, iz + Math.sin(pAng) * rad * 0.55, -pAng + Math.PI / 2);
    }
    // ground launch portals at POIs: quick rotation + the way UP to islands
    _pKind = "ground";
    // LC-51: a portal never stands in the city kit's street dressing (a parked van ran through Isla Viva's first ground portal: the kit is placed after the
    // portals, from city.kit). A kit-blocked draw still burns its yaw draw, so the world stream is byte-identical; the top-up below replaces it.
    const nearKit = (x, z, r) => {
      if (!city || !city.kit.length) return false;
      for (let k = 0; k < city.kit.length; k++) { const e = city.kit[k]; if (/building|shell/.test(e.type)) continue; const dx = e.x - x, dz = e.z - z; if (dx * dx + dz * dz < r * r) return true; }
      return false;
    };
    for (let i = 0; i < Math.min(4, pois.length); i++) {
      const p = pois[Math.floor(rng() * pois.length)];
      const px = p.x + 14 + (rng() - 0.5) * 24, pz = p.z + 14 + (rng() - 0.5) * 24;
      const py = heightAt0(px, pz);
      if (baseH(px, pz) < waterY + 0.5 || inRects(cityBld, px, pz, 3.5) || (cityKeepClear.length && inRects(cityKeepClear, px, pz, 3))) continue;
      if (nearKit(px, pz, 7.5)) { rng(); continue; }
      addPortal(px, py, pz, rng() * Math.PI * 2);
    }
    // LC-51: the four draws above are kept exactly (the world stream feeds everything after them), but each one is skipped when it lands in the sea or in a
    // town, so a match had 0-4 ground portals (the audit: scarce, and none at most POIs). The shortfall is topped up to FOUR from a stream of its own (the
    // world stream is untouched): a spot on a ring round a POI, dry, outside every building / kept-clear rectangle, clear of every standing collider by 3 m,
    // on ground flat to 0.6 m across the ring, and 60 m or more from any other ground portal. WORLD CHANGE (new portals = new nav blockers): MAP_GEN_VERSION
    // is the integrator's.
    {
      const prt = W.SIM.mulberry32((seed ^ 0x51a7e5) >>> 0);
      let nG = 0;
      for (const q of portals) if (q.kind === "ground") nG++;
      for (let tries = 0; nG < 4 && tries < 120 && pois.length; tries++) {
        const p = pois[Math.floor(prt() * pois.length)], a = prt() * Math.PI * 2, rr = (p.r || 40) * (0.5 + prt() * 0.45) + 8;
        const px = p.x + Math.cos(a) * rr, pz = p.z + Math.sin(a) * rr, fy = prt() * Math.PI * 2;
        if (Math.abs(px) > HALF - 60 || Math.abs(pz) > HALF - 60) continue;
        if (baseH(px, pz) < waterY + 0.8 || heightAt0(px, pz) < waterY + 0.8 || inRects(cityBld, px, pz, 4) || (cityKeepClear.length && inRects(cityKeepClear, px, pz, 4))) continue;
        if (houses.length && underHouse(px, pz)) continue;
        if (nearKit(px, pz, 7.5)) continue;
        const py = heightAt0(px, pz);
        let flat = true;
        for (let k = 0; k < 6 && flat; k++) { const b = k / 6 * Math.PI * 2; if (Math.abs(heightAt0(px + Math.cos(b) * 2.2, pz + Math.sin(b) * 2.2) - py) > 0.6) flat = false; }
        if (!flat) continue;
        let far = true;
        for (const q of portals) if (q.kind === "ground" && (q.x - px) * (q.x - px) + (q.z - pz) * (q.z - pz) < 60 * 60) { far = false; break; }
        if (!far) continue;
        let clear = true;
        for (let ci = 0; ci < colliders.length; ci++) {
          const c = colliders[ci];
          if (c.maxX < px - 3 || c.minX > px + 3 || c.maxZ < pz - 3 || c.minZ > pz + 3 || c.maxY < py + 0.2 || c.minY > py + 4) continue;
          clear = false; break;
        }
        if (!clear) continue;
        addPortal(px, py, pz, fy);
        nG++;
      }
    }
    _pKind = "island";
    if (isl && isl.tops.length) {
      const nullGeo = { attributes: {} };                                           // (islMat only scales a UV it finds: the baked geometries carry their own)
      const topM = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(isl.tops, false), Object.assign(islMat(islWhite, 0.95, nullGeo, 1), { vertexColors: true }));
      topM.name = "island:tops"; topM.castShadow = false; topM.receiveShadow = true; g.add(topM);
      const rockMat = islMat(rockC, 1, nullGeo, 1);
      rockMat.emissive.set(K.sky); rockMat.emissiveIntensity = 0.12;
      const rockM = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(isl.rocks, false), rockMat);
      rockM.name = "island:rocks"; rockM.castShadow = false; rockM.receiveShadow = true; g.add(rockM);
    }
  }

  // scattered wilderness loot (all maps). 130 LAND spots, not 130 attempts: the
  // old loop spent its attempts on ocean too, so isla_viva (an island in a square
  // of sea) got ~50 spots against ~120 on the inland maps, and ended with 1.4 guns
  // per player (audit M2). This is the LAST rng consumer in buildMap (nothing after
  // it draws), so taking more draws here moves no building, prop or portal.
  // WAVE 7 (Savanna): 70 wild spots, not 130 - the other ~60 live in the compounds' buildings now (house() rolls their loot); a wild spot never lands inside a building.
  const wildN = city ? (mapId === "ashgrid" ? 70 : 100) : 130;               // (Wave 7b: the themed maps keep 100 wild spots: floor items out on the map are one draw each, a chest in a town street five)
  for (let i = 0, tries = 0; i < wildN && tries < wildN * 6; tries++) {
    const x = (rng() * 2 - 1) * (HALF - 60), z = (rng() * 2 - 1) * (HALF - 60);
    const y = heightAt0(x, z);
    if (baseH(x, z) < waterY + 0.5 || (cityBld.length && (inRects(cityBld, x, z, 1.2) || inRects(cityDecks, x, z, 1.2) || !openSpot(x, y + 0.5, z) || onProp(x, z)))) continue;
    i++;
    loot(x, y + 0.5, z, null);
    if (rng() < 0.12) chest(x, y + 0.6, z, null);
  }

  // ── merge batched boxes into one mesh per color (colour × tiled brick/panel) ─
  let _st = null;
  try { _st = structTex(aniso); } catch (e) { _st = null; }
  // Two of the ~30 batch colours are LIGHT SOURCES, not surfaces: the street-lamp
  // heads (streetFurniture) and the lighthouse lens. One material template served
  // every colour, so both rendered as dull cream boxes wearing the brick normal
  // map — mortar lines on a lamp lens — and neither fed the bloom pass.
  // Deliberately NOT doing the metal half of this (crane/water-tower steel at
  // roughness 0.42 / metalness 0.6): scene.environment is still null everywhere in
  // this game, so a metal lobe would reflect pure black and look worse, not better.
  const EMIT = { "#ffe9a8": 0xffe9a8, "#fff2b0": 0xfff2b0, "#ffb050": 0xff9a3c };      // (stage B: the crater village's brazier fires)
  // ONE MESH PER TEXTURE KIND, colour per VERTEX (lane S, 2026-10). The batches
  // were one merged mesh per colour x kind — ~30 meshes, each spanning the whole
  // map, so neither the camera nor the shadow camera could ever reject one: ~30
  // main-pass and ~30 shadow-pass draw calls a frame for ~9 k triangles, 29 of the
  // drop cluster's 39 shadow:map calls. Every non-emissive batch already shares
  // roughness/metalness/normalScale and differs only in colour and texture kind,
  // so the colour moves into a vertex attribute (linear, exactly what the material
  // colour converted to) and the kinds merge: diffuse = white x vColor x texel,
  // the same product as colour x texel, pixel for pixel. Same program family as
  // the terrain (vertexColors + map + normalMap). The two emissive colours keep
  // their own mesh each: emissive is a uniform.
  const _vc = new THREE.Color();
  const structMats = {};                          // tkind -> the ONE material every structure mesh of that kind shares (the map-wide batches and the Wave-7 district meshes)
  // LC-17 (P2-C): per-kind surface response. Every procedural wall was roughness 0.88 / metalness 0.04: brick, planks, plaster, shingles and corrugated steel
  // all caught the sun the same way. Now plaster is the most matte, shingles a little glossier, and metal a real metal (0.45 / 0.5: the IBL exists since the
  // look plan, so a metal lobe reflects the map's sky instead of black). Plus, on medium and up (LCFX), the world-shader layer: the wall-base wear band
  // (vertical faces within 0.85 m of the ground under them, up to 30 % darker at the ground: the 0.1-0.5 m band ~ 20 %), the CC0 grime photograph (stains / weathering, its light / dark only, a 6 m
  // tile and a turned second sample) and the cloud shadows. Same draw calls (the same meshes), one program per kind as before.
  const KIND_PBR = { s: [0.86, 0.03], plank: [0.9, 0.0], shingle: [0.8, 0.02], metal: [0.45, 0.5], block: [0.84, 0.02], stucco: [0.93, 0.0] };
  const STRUCT_LC = { LC_CLOUD: "", LC_WEAR: "" };
  const grimeTex = await grimePromise;
  if (grimeTex) { LCU.uLcGrime.value = grimeTex; LCU.uLcGrimeK.value.set(0.7, 1 / 6.0, 0, 0); STRUCT_LC.LC_GRIME = ""; }
  else LCU.uLcGrimeK.value.set(0, 1 / 6.0, 0, 0);
  function structMaterial(tkind) {
    let mat = structMats[tkind];
    if (mat) return mat;
    const pbr = KIND_PBR[tkind] || KIND_PBR.s;
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: pbr[0], metalness: pbr[1] });
    let tx = null;
    try { tx = KIND_TEX[tkind] ? KIND_TEX[tkind](aniso) : _st; } catch (e) { tx = _st; }
    if (tx) { mat.map = tx.map; mat.normalMap = tx.normal; mat.normalScale = new THREE.Vector2(0.5, 0.5); }
    if (LCFX) lcPatch(mat, STRUCT_LC);
    return (structMats[tkind] = mat);
  }
  /** Wave 7b: the brick/stone ("s") and plank textures in one material - vertex attribute `tki` 0 = s, 1 = plank (both 256 px tiling canvases, identity transforms, the same UVs) */
  let dualMat = null;
  function dualStructMaterial() {
    if (dualMat) return dualMat;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0.04 });
    let pk = null, sc = null;
    try { pk = plankTex(aniso); sc = stuccoTex(aniso); } catch (e) { pk = sc = null; }
    if (_st && pk && sc) {
      mat.map = _st.map; mat.normalMap = _st.normal; mat.normalScale = new THREE.Vector2(0.5, 0.5);
      const SC = THREE.ShaderChunk;
      // tki 0 = s (brick / stone), 1 = plank, 2 = stucco: weights from the flat per-vertex index (no interpolation across a box: every vertex of a box has the same index)
      const pick3 = (a, b, c, uv) => "( texture2D( " + a + ", " + uv + " ) * ( 1.0 - step( 0.5, vTki ) ) + texture2D( " + b + ", " + uv + " ) * ( step( 0.5, vTki ) - step( 1.5, vTki ) ) + texture2D( " + c + ", " + uv + " ) * step( 1.5, vTki ) )";
      mat.customProgramCacheKey = () => "lc-struct-mix-v3";
      mat.onBeforeCompile = (sh) => {
        // LC-17: the per-kind roughness of the three kinds this material mixes (brick / stone, plank, plaster: KIND_PBR)
        sh.fragmentShader = sh.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = vTki < 0.5 ? " + KIND_PBR.s[0].toFixed(3) + " : ( vTki < 1.5 ? " + KIND_PBR.plank[0].toFixed(3) + " : " + KIND_PBR.stucco[0].toFixed(3) + " );");
        sh.uniforms.map2 = { value: pk.map }; sh.uniforms.normalMap2 = { value: pk.normal }; sh.uniforms.map3 = { value: sc.map }; sh.uniforms.normalMap3 = { value: sc.normal };
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float tki;\nvarying float vTki;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvTki = tki;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D map2;\nuniform sampler2D normalMap2;\nuniform sampler2D map3;\nuniform sampler2D normalMap3;\nvarying float vTki;")
          .replace("#include <map_fragment>", SC.map_fragment.split("texture2D( map, vMapUv )").join(pick3("map", "map2", "map3", "vMapUv")))
          .replace("#include <normal_fragment_maps>", SC.normal_fragment_maps.split("texture2D( normalMap, vNormalMapUv )").join(pick3("normalMap", "normalMap2", "normalMap3", "vNormalMapUv")));     // (every occurrence: the chunk samples the normal map in its object-space AND its tangent-space branch)
      };
    }
    if (LCFX) lcPatch(mat, STRUCT_LC);
    return (dualMat = mat);
  }
  /** Merge one batch set (colour|kind -> geometries) into one mesh per texture kind plus one per emissive colour. `tag` = "" for the map-wide set, else the district id. */
  function mergeBatchSet(bset, tag) {
    const kindGroups = {};                        // tkind -> [geometry with a color attribute]
    const nsGroups = {};                          // (K1 re-run) tkind -> pre-coloured house geometry that casts no shadow (a ruin's wreckage, "vcn|<kind>")
    for (const bkey in bset) {
      const bar = bkey.lastIndexOf("|");
      const color = bkey.slice(0, bar);
      // (7A2: a Savanna district draws its tower walls with the brick struct texture too: one structure draw call fewer per town, two with the shadow pass.
      //  D2: and its roofs: a roof is a tinted terracotta / slate / tin slab seen from 30 m or more, and the "shingle" texture was a whole extra mesh per district -
      //  12 draw calls of a drop view over six towns and compound cells. The same goes for the Savanna landmarks' batch; the other maps keep every kind)
      const bk = bkey.slice(bar + 1);
      const tkind = (tag || city) && (bk === "block" || bk === "shingle") ? "s" : bk;
      if (EMIT[color]) continue;                    // built below, one mesh per colour
      if (color === "vcn") { const l = nsGroups[bk] || (nsGroups[bk] = []); for (const geo of bset[bkey]) l.push(geo); continue; }
      const list = kindGroups[tkind] || (kindGroups[tkind] = []);
      if (color === "vc") { for (const geo of bset[bkey]) list.push(geo); continue; }        // (WAVE 8: a housegen house's faces carry their own vertex colours)
      _vc.set(color);
      for (const geo of bset[bkey]) {
        const n = geo.attributes.position.count, ca = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { ca[i * 3] = _vc.r; ca[i * 3 + 1] = _vc.g; ca[i * 3 + 2] = _vc.b; }
        geo.setAttribute("color", new THREE.BufferAttribute(ca, 3));
        list.push(geo);
      }
    }
    // Wave 7b (a themed map's district): the brick/stone kind and the plank kind share ONE mesh - a lodge district is half plank walls, half stone and shingle, and the two
    // were two draw calls (four with the shadow pass) in every view that saw it: 10-13 districts in a Deepwood street view. A per-vertex texture index picks the texture
    // (dualStructMaterial: the same lighting, the same UVs and texture transforms, two samplers); Savanna keeps its kinds (its frames are untouched).
    const DUAL = [["s", 0], ["plank", 1], ["stucco", 2]];
    if (tag && city && (mapId !== "ashgrid" || houses.length) && DUAL.filter(([k]) => kindGroups[k]).length >= 2) {      // (WAVE 8: Savanna's districts too, now that its houses wear brick, plaster and plank in one district)
      const both = [];
      for (const [k, v] of DUAL) for (const geo of (kindGroups[k] || [])) { geo.setAttribute("tki", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(v), 1)); both.push(geo); }
      const mergedB = BufferGeometryUtils.mergeGeometries(both, false);
      if (mergedB) {
        for (const [k] of DUAL) delete kindGroups[k];
        const mesh = new THREE.Mesh(mergedB, dualStructMaterial());
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.name = "structures:mix@" + tag; mesh.userData.district = tag; mesh.userData.lcPart = "structure"; if (distParts.has(tag)) mesh.userData.parts = distParts.get(tag);
        g.add(mesh);
      }
    }
    for (const tkind in kindGroups) {
      const merged = BufferGeometryUtils.mergeGeometries(kindGroups[tkind], false);
      const mesh = new THREE.Mesh(merged, structMaterial(tkind));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = "structures:" + tkind + (tag ? "@" + tag : "");
      mesh.userData.lcPart = "structure";                                         // (WAVE 8: what the mesh IS, for the gates: a town called "yard" is not a yard decal)
      if (tag) { mesh.userData.district = tag; if (distParts.has(tag)) mesh.userData.parts = distParts.get(tag); }
      g.add(mesh);
    }
    // (K1 re-run) the district's NO-SHADOW twin: a ruin's wreckage (housegen ns boxes: rubble, remnants, scorch, burnt roof plates), the mix material and program,
    // receives shadow, never casts (installCityCull leaves it alone: userData.noCast) - the depth pass no longer re-draws ~375 triangles per ruin house
    const nsGeos = [];
    for (const [k, v] of DUAL) for (const geo of (nsGroups[k] || [])) { geo.setAttribute("tki", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(v), 1)); nsGeos.push(geo); }
    if (nsGeos.length) {
      const mergedN = BufferGeometryUtils.mergeGeometries(nsGeos, false);
      if (mergedN) {
        const mesh = new THREE.Mesh(mergedN, dualStructMaterial());
        mesh.castShadow = false; mesh.receiveShadow = true;
        mesh.name = "structures:mixns" + (tag ? "@" + tag : ""); mesh.userData.lcPart = "structure"; mesh.userData.noCast = true;
        if (tag) { mesh.userData.district = tag; if (distParts.has(tag)) mesh.userData.parts = distParts.get(tag); }
        g.add(mesh);
      }
    }
    for (const bkey in bset) {
      const color = bkey.slice(0, bkey.lastIndexOf("|"));
      const emit = EMIT[color];
      if (!emit) continue;                          // merged per kind above
      const merged = BufferGeometryUtils.mergeGeometries(bset[bkey], false);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 });
      // 1.4 already clipped to white on screen, so the extra headroom costs nothing
      // visible on the lamp itself — but the bloom pass samples the HDR render target
      // BEFORE OutputPass tonemaps it, so values above the 0.72 threshold are what
      // actually produce the glow. 2.8 makes street lamps and the lighthouse lens read
      // as light sources at distance. Do NOT chase this with kn.bloom.strength instead:
      // a global raise blooms the Deepwood snow and the Savanna sand, which is exactly
      // the "bloom haze" that 0.14 was tuned to prevent.
      mat.emissive = new THREE.Color(emit); mat.emissiveIntensity = 2.8; mat.toneMapped = false;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (tag) { mesh.name = "structures:emit@" + tag; mesh.userData.district = tag; if (distParts.has(tag)) mesh.userData.parts = distParts.get(tag); }
      g.add(mesh);
    }
  }
  mergeBatchSet(batches, "");
  for (const [did, sk] of districtSinks) mergeBatchSet(sk, did);
  // Wave 7b stage B: the turning mill wheels (buildWaterMill): one plank-material mesh each, turned about the axle (world pivot + axis) at 0.55 rad/s while the camera is within 320 m
  for (const wh of millWheels) {
    const list = [];
    for (const [geo, color] of wh.geos) {
      _vc.set(color);
      const n = geo.attributes.position.count, ca = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { ca[i * 3] = _vc.r; ca[i * 3 + 1] = _vc.g; ca[i * 3 + 2] = _vc.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(ca, 3));
      list.push(geo);
    }
    const merged = BufferGeometryUtils.mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, structMaterial("plank"));
    mesh.name = "mill:wheel"; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    g.add(mesh);
    const P = new THREE.Vector3(wh.pivot[0], wh.pivot[1], wh.pivot[2]), A = new THREE.Vector3(wh.axis[0], wh.axis[1], wh.axis[2]).normalize(), mR = new THREE.Matrix4(), mT = new THREE.Matrix4();
    let ang = 0;
    trackUpdater((dt) => {
      const cam = W.camera;
      if (cam && (cam.position.x - P.x) * (cam.position.x - P.x) + (cam.position.z - P.z) * (cam.position.z - P.z) > 320 * 320) return;
      ang = (ang + dt * 0.55) % (Math.PI * 2);
      mesh.matrix.makeTranslation(P.x, P.y, P.z).multiply(mR.makeRotationAxis(A, ang)).multiply(mT.makeTranslation(-P.x, -P.y, -P.z));
      mesh.matrixWorldNeedsUpdate = true;
    });
  }
  await yieldPhase();                                // phase 2/3 done

  // ── near-lamp point-light pool ────────────────────────────────────────────
  // Every emissive-looking prop in the world was an unlit box: a match scene holds
  // exactly one DirectionalLight and one HemisphereLight (grep for PointLight over
  // runtime/ returns one hit, the MENU diorama's fill), so a street lamp lit nothing
  // and POIs read as props rather than places. A FIXED-SIZE pool is what makes this
  // affordable — three recompiles every lit material when the light COUNT changes,
  // so the lights are created once and only ever MOVED, and intensity 0 is used to
  // park a spare rather than .visible (which would change the count). Capped at 4
  // rather than the 8 the audit suggested, and off entirely on 'low', because in a
  // forward renderer each one is evaluated per fragment on every lit material and
  // the performance dimension is also below parity.
  const NLAMP = TIER_Q.lamps;                         // (0 on low, 4; ULTRA 6: the count is fixed for the match, so no program ever changes)
  if (NLAMP && lampPts.length) {
    const pool = [];
    for (let i = 0; i < NLAMP; i++) {
      const pl = new THREE.PointLight(0xffdc9a, 0, 17, 2);   // intensity set per tick; distance bounds the falloff
      pl.castShadow = false; pl.position.set(0, -999, 0);
      g.add(pl); pool.push(pl);
    }
    let lampT = 9;
    trackUpdater((dt) => {
      lampT += dt; if (lampT < 0.5) return; lampT = 0;
      const cam = W.camera; if (!cam) return;
      const near = [];
      for (const p of lampPts) {
        const d2 = (p.x - cam.position.x) ** 2 + (p.z - cam.position.z) ** 2;
        if (d2 < 3600) near.push({ p, d2 });        // 60 m
      }
      near.sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < NLAMP; i++) {
        const n = near[i];
        if (n) { pool[i].position.set(n.p.x, n.p.y, n.p.z); pool[i].intensity = 6; }
        else pool[i].intensity = 0;
      }
    });
  }

  // ── merge roads + parking lots into one flat asphalt ribbon mesh ──────────
  if (roadGeos.length) {
    const roadCol = mapId === "ashgrid" ? "#3d4045" : city && SAV.ground ? SAV.ground.road : mapId === "deepwood" ? "#5f4f3c" : "#7c6a4e";
    const rmerged = BufferGeometryUtils.mergeGeometries(roadGeos, false);
    // (Wave 7b stage B: a depth bias, the decals' rule: where a ribbon chord dips a few cm under a terrain triangle - a diagonal link across a valley side - the road wins the depth test instead
    //  of showing grass slivers through it; a state, not a program variant)
    const rmat = new THREE.MeshStandardMaterial({ color: roadCol, roughness: 0.98, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    try { const gt = groundTex(aniso); rmat.map = gt.map; rmat.normalMap = gt.normal; rmat.normalScale = new THREE.Vector2(0.3, 0.3); } catch (e) {}
    if (photo && photo.asphalt && rmat.map) {
      // P2.5: the road_asphalt photograph as DETAIL over the road colour (the same divide-by-its-own-average rule as the terrain): grit and
      // wear in the road colour of the map, one tile per ROAD_TILE (6 m, the uv the ribbons already carry)
      const A = PHOTO_FILES.photoAsphalt.avg;
      rmat.customProgramCacheKey = () => "lc-road-photo-v1";
      rmat.onBeforeCompile = (sh) => {
        sh.uniforms.tAsph = { value: photo.asphalt };
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform sampler2D tAsph;")
          .replace("#include <map_fragment>", `#include <map_fragment>
{
  vec3 r = clamp(texture2D(tAsph, vMapUv).rgb / ${glslV3(A)}, 0.3, 2.6);
  diffuseColor.rgb *= mix(vec3(dot(r, ${PH_LUM})), r, 0.35);
}`);
      };
    }
    if (LCFX) lcPatch(rmat, { LC_CLOUD: "", LC_AO: "" });                                // LC-74 / LC-41: the roads are ground too
    const rmesh = new THREE.Mesh(rmerged, rmat);
    rmesh.receiveShadow = true; rmesh.name = "roads";
    g.add(rmesh);
  }

  // ── instanced props from GLBs ─────────────────────────────────────────────
  // WAVE 8: a tree whose crown would reach into a furnished house's upper storey (a palm 4 m from a two-storey wall put its fronds through the upstairs window:
  // interiorcheck kit-agree, Isla Viva s1) is not planted. Crown radius x the tree's scale: palm 4.2 m, broadleaf 3.8 m, pine / birch 2.2 m; one-storey houses keep their trees (the crown
  // overhangs the roof). Draw-then-reject: every tree was drawn before this filter, nothing else moves.
  let hgTreesDropped = 0;
  if (houses.length) {
    const tall = houses.filter((H) => H.storeys >= 2);
    for (const kind of ["palm", "tree", "pine", "birch"]) {
      const l = props[kind]; if (!l || !l.length || !tall.length) continue;
      const cr = kind === "palm" ? 4.2 : kind === "tree" ? 3.8 : 2.2;
      props[kind] = l.filter((it) => {
        const r = cr * (it.s || 1);
        for (const H of tall) { const a = H.aabb; const dx = Math.max(a.min[0] - it.x, 0, it.x - a.max[0]), dz = Math.max(a.min[2] - it.z, 0, it.z - a.max[2]); if (dx * dx + dz * dz < r * r) { hgTreesDropped++; return false; } }
        return true;
      });
    }
  }
  const propStats = finalizeProps();   // slope rejection + ground fit for every placed prop (see the grounding block above scatterTrees)
  if (houses.length) propStats.treesNearHouses = hgTreesDropped;
  if (yardInfo) propStats.yard = yardInfo;
  const instRefs = {};   // kind -> [{inst, baseMatrixes}]
  // ── LC-38 foliage wind (medium and up) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A map-local CLONE of a foliage GLB material (the GLB's own material is shared with the menu diorama and the probes' reference meshes) with the wind
  // vertex term (see LC_VERT_WIND): kind height, sway at the top, leaf flutter. Plus the cloud shadows. The near shadow casters get a depth material with the
  // same sway, so a tree's shadow moves with its crown.
  const WIND_K = { tree: [6.5, 0.42, 0.065], pine: [8, 0.34, 0.04], birch: [7, 0.46, 0.075], palm: [7, 0.6, 0.07], bush: [1.4, 0.09, 0.035], grass: [0.6, 0.12, 0] };   // [kind height m, crown sway m, leaf flutter m]
  const windDefs = (kind) => { const w = WIND_K[kind]; return { LC_WIND: "", LC_WIND_H: w[0].toFixed(2), LC_WIND_A: w[1].toFixed(3), LC_WIND_FLUT: w[2].toFixed(3) }; };
  const windMats = new Map(), windDepth = new Map();
  function windMat(kind, mat) {
    if (!LCFX || !WIND_K[kind] || !mat || Array.isArray(mat) || !mat.isMeshStandardMaterial) return mat;
    const key = kind + "|" + mat.uuid;
    let m = windMats.get(key);
    if (!m) { m = mat.clone(); m.name = (mat.name || kind) + ":wind"; lcPatch(m, Object.assign({ LC_CLOUD: "" }, windDefs(kind))); windMats.set(key, m); }
    return m;
  }
  function windDepthMat(kind) {
    if (!LCFX || !WIND_K[kind]) return undefined;
    let m = windDepth.get(kind);
    if (!m) { m = lcPatch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), windDefs(kind)); windDepth.set(kind, m); }
    return m;
  }
  // ── LC-89 per-instance culled prop draws ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // Every prop kind was ONE InstancedMesh spanning the whole map (bounding radii 850-1,011 m): three can never cull it, so every tree, bush, rock, car and
  // container of the map was drawn in every frame - 76-83 % of a ground frame's triangles (perf audit: 992 k of 1.31 M on Savanna, 1.19 M of 1.42 M on
  // Deepwood), most of them behind the camera or fogged out. Chunking into cells buys that back with far MORE draw calls; instead each map-wide mesh stays
  // the REFERENCE (invisible: every instance at its true matrix, index i = props[kind][i], what destroyProp, the placement / collision probes and the census
  // read) and a DRAWN twin holds only the instances inside the camera frustum and within the tier's draw distance, compacted to the front of its instance
  // buffer: the SAME one draw call per kind part, a fraction of the triangles. The cull re-runs only when it can matter (the camera moved > 2 m or turned
  // > 3 degrees, the draw distance moved, a prop died, the near-tree swap changed), against the frustum widened by 4 m + 4 degrees so a recull is never
  // late, and uploads only the live range. Distance: the tier's (low 600, medium 780, high 1,000, ULTRA 1,650 m), x up to 2.1 with height above the ground
  // (the drop sees the map's forests to the horizon); the last 12 % of it shrinks an instance to nothing (no pop). Allocation-free per frame.
  const culls = [];                                   // per kind: { list, parts: [{ draw, src, lod }], cx, cy, cz, cr, hid }
  let cullDirty = true, cullFn = null;              // (cullFn: the updater; map.cullNow() runs it at once - a camera CUT (spectate, a probe's pinned view) need not wait a frame)
  function addCulled(kind, list, ref, mat, lodPart) {
    let K2 = null;
    for (const q of culls) if (q.kind === kind) { K2 = q; break; }
    if (!K2) { K2 = { kind, list, parts: [], cx: null, cy: null, cz: null, cr: null, hid: null }; culls.push(K2); }
    const dg = ref.geometry.clone(); dg.userData = {};            // (no kind tag: the probes read the reference meshes only)
    const draw = new THREE.InstancedMesh(dg, mat, list.length);
    draw.castShadow = false; draw.receiveShadow = true; draw.frustumCulled = false; draw.count = 0;
    draw.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    draw.name = "props:" + kind; draw.userData.lcCulled = kind;
    g.add(draw);
    ref.visible = false; ref.userData.lcReference = true;
    K2.parts.push({ draw, arr: draw.instanceMatrix.array, src: ref.instanceMatrix.array.slice(0, list.length * 16), lod: !!lodPart, geo: ref.geometry });
    return draw;
  }
  function finishCulls() {
    const _sp = new THREE.Sphere(), _m = new THREE.Matrix4();
    for (const K2 of culls) {
      const n = K2.list.length;
      K2.cx = new Float32Array(n); K2.cy = new Float32Array(n); K2.cz = new Float32Array(n); K2.cr = new Float32Array(n);
      for (const pt of K2.parts) if (!pt.geo.boundingSphere) pt.geo.computeBoundingSphere();
      for (let i = 0; i < n; i++) {
        let cx = 0, cy = 0, cz = 0, r = -1;
        for (const pt of K2.parts) {
          _m.fromArray(pt.src, i * 16);
          _sp.copy(pt.geo.boundingSphere).applyMatrix4(_m);
          if (r < 0) { cx = _sp.center.x; cy = _sp.center.y; cz = _sp.center.z; r = _sp.radius; }
          else { const d = Math.sqrt((_sp.center.x - cx) ** 2 + (_sp.center.y - cy) ** 2 + (_sp.center.z - cz) ** 2) + _sp.radius; if (d > r) r = d; }
        }
        K2.cx[i] = cx; K2.cy[i] = cy; K2.cz[i] = cz; K2.cr[i] = Math.max(0.5, r);
      }
    }
    if (!culls.length) return;
    const _f = new THREE.Frustum(), _pv = new THREE.Matrix4();
    // the last cull's camera (x, y, z, fwd x, y, z, distance, aspect, fov) in a typed array: no boxed doubles in the closure; PL / CO: the planes, the counts
    const LS = new Float64Array([1e9, 1e9, 1e9, 0, 0, 0, 0, 0, 0]), PL = new Float64Array(24), CQ = new Float64Array(6), CO = new Int32Array(2);
    W._lcCullStats = { culls: 0, drawn: 0, total: 0, D: 0 };
    trackUpdater(cullFn = () => {
      const cam = W.camera;
      if (!cam || !cam.matrixWorld) return;
      const e = cam.matrixWorld.elements;
      if (!cullDirty) {                               // (the every-frame test, as few float ops as possible: under 2 m and 3 degrees nothing re-culls; the distance only
        const mx = e[12] - LS[0], my = e[13] - LS[1], mz = e[14] - LS[2];          //  changes with height, so it is re-derived on a re-cull only)
        if (mx * mx + my * my + mz * mz < 4 && e[8] * LS[3] + e[9] * LS[4] + e[10] * LS[5] < -0.99863 && cam.aspect === LS[7] && cam.fov === LS[8]) return;
      }
      const px = e[12], py = e[13], pz = e[14], fx = -e[8], fy = -e[9], fz = -e[10];
      const agl = py - Math.max(heightAt0(px, pz), waterY);
      const af = agl <= 40 ? 1 : agl >= 312 ? 2.1 : 1 + (agl - 40) / 247;
      const D = TIER_Q.propD * af;
      cullDirty = false; LS[0] = px; LS[1] = py; LS[2] = pz; LS[3] = fx; LS[4] = fy; LS[5] = fz; LS[6] = D; LS[7] = cam.aspect; LS[8] = cam.fov;
      _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _f.setFromProjectionMatrix(_pv);
      for (let k = 0; k < 6; k++) { const pl = _f.planes[k]; PL[k * 4] = pl.normal.x; PL[k * 4 + 1] = pl.normal.y; PL[k * 4 + 2] = pl.normal.z; PL[k * 4 + 3] = pl.constant; }
      CQ[0] = px; CQ[1] = py; CQ[2] = pz; CQ[3] = D * D; CQ[4] = D * 0.88; CQ[5] = 1 / (D * 0.12);
      let drawnN = 0, totalN = 0;
      for (let q = 0; q < culls.length; q++) {
        const K2 = culls[q], parts = K2.parts;
        totalN += K2.list.length;
        lcCullKind(K2.list, K2.cx, K2.cy, K2.cz, K2.cr, K2.hid, parts, PL, CQ, CO);
        const nOut = CO[0], nLod = CO[1];
        for (let k = 0; k < parts.length; k++) {
          const pt = parts[k], im = pt.draw.instanceMatrix, c = pt.lod ? nLod : nOut;
          pt.draw.count = c;
          im.clearUpdateRanges(); if (c) im.addUpdateRange(0, c * 16); im.needsUpdate = true;
        }
        drawnN += nOut;
      }
      const st = W._lcCullStats; st.culls++; st.drawn = drawnN; st.total = totalN; st.D = Math.round(D);
    });
  }
  // Which kinds collide. The SHAPE of every collider comes from the baked table (pushPropColliders); these radii are only the legacy
  // fallback for a client whose table did not load.
  const propColliderKinds = { palm: 0.5, tree: 0.6, pine: 0.55, birch: 0.5, rocks: 1.4, car: 1.6, container: 2.2, barrel: 0.55 };
  // destructible props: hp per prop; 0/undefined = indestructible cover (rock/car/container).
  // barrel hp 1 = pops on any hit (explodes); trees take a few rounds then fall.
  const propHP = { barrel: 1, tree: 46, pine: 58, palm: 42, birch: 40 };
  const SHADOW_KINDS = { palm: 1, tree: 1, pine: 1, birch: 1 };
  const shadowSrc = [];   // {kind, list, geo, mat, mats} — source for the near-caster proxies
  /** The colliders of one prop instance, from its baked table entry (contract C-COLL: every one an axis-aligned box from mkCollider).
   *  Metres in the table are at it.s = 1 and relative to the anchor (it.x, it.z); y = 0 is the drawn base. A part below 0.3 m cannot stop
   *  a walker (STEP_UP is 0.55) or a body-height bullet, so it gets no box. All of this is a pure function of (table, it): a squad client
   *  derives exactly the same boxes whether or not the GLB loaded. */
  function pushPropColliders(kind, tk, it, idx) {
    const hp = propHP[kind] || 0, sc = it.s, ry = it.ry || 0;
    let c = Math.cos(ry), sn = Math.sin(ry);
    if (Math.abs(sn) < 1e-9) sn = 0;
    if (Math.abs(c) < 1e-9) c = 0;                                        // quarter turns are EXACT
    const tg = it.tx || it.tz ? it : null;                                 // a prop laid on a ground plane (cars, containers): each box spans the lowest and highest point of its part
    // y range of a box centred (ox, oz) from the anchor with half extents (ex, ez): level, or the tilted part's own lowest .. highest point
    const yLo = (ox, oz, ex, ez) => it.y + (tg ? tg.tx * ox + tg.tz * oz - Math.abs(tg.tx) * ex - Math.abs(tg.tz) * ez : 0);
    const yHi = (ox, oz, ex, ez, top) => it.y + top + (tg ? tg.tx * ox + tg.tz * oz + Math.abs(tg.tx) * ex + Math.abs(tg.tz) * ez : 0);
    for (const p of tk.parts) {
      const top = p.top * sc;
      if (p.t === "round") {
        const cx = it.x + (p.c[0] * c + p.c[1] * sn) * sc, cz = it.z + (-p.c[0] * sn + p.c[1] * c) * sc, r = p.r * sc;   // a round trunk: the same square at any yaw
        colliders.push(mkCollider("box", cx - r, cx + r, it.y, it.y + top, cz - r, cz + r, -1, kind, idx, hp));
      } else if (p.t === "rect") {
        const hx = p.h[0] * sc, hz = p.h[1] * sc;
        const wx = it.x + (p.c[0] * c + p.c[1] * sn) * sc, wz = it.z + (-p.c[0] * sn + p.c[1] * c) * sc;
        if (!p.prof && (sn === 0 || c === 0)) {
          const ex = Math.abs(c) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(c) * hz, ox = wx - it.x, oz = wz - it.z;
          colliders.push(mkCollider("box", wx - ex, wx + ex, yLo(ox, oz, ex, ez), yHi(ox, oz, ex, ez, top), wz - ez, wz + ez, -1, kind, idx, hp));
        } else {
          // a yawed car: a chain of <= 3 boxes along the body instead of one AABB of the whole rotated rectangle. A part with a height profile
          // (the car: hood 0.83 m, cabin 1.30 m, trunk 0.89 m) is ALWAYS a chain of its slices, each box as tall as its slice, so a body-height
          // shot passes over the hood the way it passes over the drawn mesh. (At a quarter turn the same formulas give exact boxes.)
          const longX = hx >= hz, Lh = longX ? hx : hz, Sh = longX ? hz : hx;
          const n = p.prof ? p.prof.length : Math.min(3, Math.max(1, Math.ceil(Lh * 2 / 1.6))), sa = Lh / n;
          const ax = Math.abs(c) * (longX ? sa : Sh) + Math.abs(sn) * (longX ? Sh : sa);
          const az = Math.abs(sn) * (longX ? sa : Sh) + Math.abs(c) * (longX ? Sh : sa);
          for (let k = 0; k < n; k++) {
            const u = -Lh + (k + 0.5) * (2 * Lh / n), ox = longX ? u * c : u * sn, oz = longX ? -u * sn : u * c, tk2 = p.prof ? p.prof[k] * sc : top;
            colliders.push(mkCollider("box", wx + ox - ax, wx + ox + ax, yLo(wx - it.x + ox, wz - it.z + oz, ax, az), yHi(wx - it.x + ox, wz - it.z + oz, ax, az, tk2), wz + oz - az, wz + oz + az, -1, kind, idx, hp));
          }
        }
      } else if (p.t === "hull") {
        if (p.top * sc < 0.3) continue;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        if (p.byScale) {
          // a part with a footprint per instance scale (the crooked birch, the bending tree): the outline of the trunk inside the player's 1.8 m body band
          // depends on it.s (the band reaches table height 1.8 / s), so take the two tabulated scales around s and interpolate the box extents between them
          // (_tools/bake_prop_colliders.mjs `byScale`). Still ONE axis-aligned box per prop.
          const L = p.byScale; let k = 0; while (k < L.length - 1 && L[k + 1].s <= sc) k++;
          const A = L[k], B = L[Math.min(k + 1, L.length - 1)], f = B.s > A.s ? Math.min(1, Math.max(0, (sc - A.s) / (B.s - A.s))) : 0;
          const ext = (outline) => { let a = Infinity, b = -Infinity, e = Infinity, d = -Infinity; for (const q of outline) { const x = q[0] * c + q[1] * sn, z = -q[0] * sn + q[1] * c; if (x < a) a = x; if (x > b) b = x; if (z < e) e = z; if (z > d) d = z; } return [a, b, e, d]; };
          const ea = ext(A.hull), eb = ext(B.hull);
          x0 = (ea[0] + (eb[0] - ea[0]) * f) * sc; x1 = (ea[1] + (eb[1] - ea[1]) * f) * sc; z0 = (ea[2] + (eb[2] - ea[2]) * f) * sc; z1 = (ea[3] + (eb[3] - ea[3]) * f) * sc;
        } else {
          for (const q of p.hull) {
            const u = q[0] * sc, w = q[1] * sc, x = u * c + w * sn, z = -u * sn + w * c;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
          }
        }
        const ox = (x0 + x1) / 2, oz = (z0 + z1) / 2, ex = (x1 - x0) / 2, ez = (z1 - z0) / 2;
        // a tilted rock's top is its PEAK, not the high corner of its outline: lift the box top by the tilt at the peak
        const pk = p.peak, pdy = tg && pk ? tg.tx * ((pk[0] * c + pk[1] * sn) * sc) + tg.tz * ((-pk[0] * sn + pk[1] * c) * sc) : 0;
        colliders.push(mkCollider("box", it.x + x0, it.x + x1, yLo(ox, oz, ex, ez), it.y + top + pdy, it.z + z0, it.z + z1, -1, kind, idx, hp));
      }
    }
  }
  function mergePartsByMaterial(meshes) {
    const byMat = new Map(), out = [];
    for (const m of meshes) { const k = m.material; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(m); }
    for (const [mat, list] of byMat) {
      if (list.length === 1 || Array.isArray(mat)) { for (const m of list) out.push(m); continue; }
      const geos = list.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
      let merged = null;
      try { merged = BufferGeometryUtils.mergeGeometries(geos, false); } catch (e) { merged = null; }
      for (const q of geos) q.dispose();
      if (!merged) { for (const m of list) out.push(m); continue; }
      out.push({ geometry: merged, material: mat, matrixWorld: new THREE.Matrix4(), isMesh: true, merged: true });
    }
    return out;
  }
  const _upV = new THREE.Vector3(0, 1, 0), _qTilt = new THREE.Quaternion(), _vTilt = new THREE.Vector3(), _tAnch = new THREE.Matrix4();
  for (const kind in props) {
    const list = props[kind];
    if (!list.length) continue;
    const tk = PT && PT.kinds[kind];
    const url = W.assetBase + "assets/props/" + kind + ".glb";
    let root = null;
    // A failed GLB used to `continue` here and skip the colliders too, so that client alone had no cover from this kind. The colliders are
    // built from the baked table below, loaded or not; only the DRAWING is skipped.
    try { root = await W.kernel.loadGLTF(url); } catch (e) { console.warn("[maps] prop load failed", kind, e); }
    if (root) {
      root.updateMatrixWorld(true);
      // normalize: find overall bbox to scale to a sane base height
      const bbox = new THREE.Box3().setFromObject(root);
      const size = bbox.getSize(new THREE.Vector3());
      // car: 1.6 on the longest side made a 3.5 x 1.5 x 1.0 m toy at the s = 2.2 every call site uses; 2.05 is 4.5 x 1.9 x 1.3 m.
      // (_tools/bake_prop_colliders.mjs checks this literal against its own config.)
      const baseH = { palm: 7, tree: 6.5, pine: 8, birch: 7, bush: 1.4, rocks: 2.2, car: 2.05, container: 2.8, barrel: 1.1 }[kind] || 3;
      // trees normalize by height; compact/wide props (rock clusters, cars) by
      // their LARGEST dimension — height-normalizing a flat rock cluster blew it
      // up into a house-sized blob
      const compact = kind === "rocks" || kind === "bush" || kind === "car" || kind === "container" || kind === "barrel";
      const norm = baseH / Math.max(0.001, compact ? Math.max(size.x, size.y, size.z) : size.y);
      if (tk && Math.abs(tk.norm - norm) > 0.005 * norm) console.warn("[maps] prop table is stale for " + kind + " (norm " + tk.norm + " vs " + norm.toFixed(6) + "): run _tools/bake_prop_colliders.mjs");
      // The anchor (it.x, it.z) is the spot the seeded generator picked: the one nearPoi() tested and the one the collider belongs to. A GLB
      // whose origin sits far from its geometry (rocks.glb: its four rocks are modelled 27 m from the origin at norm scale) was drawn
      // there, 20-90 m from the collider and the loot logic around it: half the rocks hung in the air, a quarter were buried, every one
      // left an invisible 6 m pillar on empty grass. A re-centred kind is drawn ON its anchor (footprint centre minus the anchor, rotated
      // by ry). Trees NEVER move their mesh: palm/birch bbox centres are canopy-weighted, so a bbox re-centre would push the trunk away
      // from its collider; the trunk collider moves to the trunk instead (table part `c`).
      const recentre = tk ? !!tk.recentre : kind === "rocks";
      const anchor = !recentre ? [0, 0] : tk ? tk.anchor : [((bbox.min.x + bbox.max.x) / 2) * norm, ((bbox.min.z + bbox.max.z) / 2) * norm];
      let meshes = [];
      root.traverse((o) => { if (o.isMesh) meshes.push(o); });
      // D2 (Savanna only): a prop GLB made of several meshes that share ONE material (the car is 13 meshes of 7 materials, the rock cluster 4 of 1) is one InstancedMesh per
      // MESH - 13 draw calls for the cars alone in every view that sees the map-wide mesh. Meshes of one material are baked into one geometry (their GLB-local matrices
      // folded into the vertices), so a kind costs one call per material. Same triangles, same instance matrices, same colliders (those come from the baked table).
      if (mapId === "ashgrid") meshes = mergePartsByMaterial(meshes);
      // (the coarse trunk is added AFTER the canopy: the first InstancedMesh of a kind carries the GLB's own geometry, which the placement census reads the kind's local frame from)
      // Wave 7b stage B: the same far LOD for the themed maps' heavy tree - Isla Viva's palm (one 3,134-triangle mesh: 551 k triangles of an Isla Viva s31337 street view, 47 % of the frame)
      // and Deepwood's pine canopy (1,613). Savanna's acacia is unchanged.
      const LOD_KIND = mapId === "ashgrid" ? "tree" : mapId === "isla_viva" ? "palm" : mapId === "deepwood" ? "pine" : null;
      const isLod = (q) => kind === LOD_KIND && q.geometry.index && q.geometry.index.count / 3 > 1200;
      if (kind === LOD_KIND) meshes.sort((a, b) => (isLod(a) ? 1 : 0) - (isLod(b) ? 1 : 0));
      instRefs[kind] = [];
      // a kind whose ONLY mesh is the LOD part (the palm): a full-geometry twin with every instance goes first and is never drawn (visible = false) - it is the kind's instance list at the
      // GLB's own geometry (what the probes read a kind's frame and positions from, as the acacia's canopy is on Savanna); the coarse copy draws, the near proxies draw the near ones in full
      if (kind === LOD_KIND && mapId !== "ashgrid" && meshes.length && meshes.every(isLod)) {
        const m = meshes[0], full = new THREE.InstancedMesh(m.geometry, m.material, list.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
        for (let i = 0; i < list.length; i++) {
          const it = list[i], s = norm * it.s;
          Q.setFromAxisAngle(_upV, it.ry || 0);
          M.compose(P.set(it.x, it.y - bbox.min.y * s, it.z), Q, S.set(s, s, s));
          if (anchor[0] || anchor[1]) M.multiply(_tAnch.makeTranslation(-anchor[0] / norm, 0, -anchor[1] / norm));
          M.multiply(m.matrixWorld);
          full.setMatrixAt(i, M);
        }
        full.castShadow = false; full.receiveShadow = true; full.visible = false; full.name = "lod-full:" + kind;
        g.add(full);
        instRefs[kind].push(full);
      }
      for (const m of meshes) {
        // D2 (Savanna): the acacia's trunk is 2,360 triangles x ~456 trees, all drawn in every view (1.07 M of a 2.2 M triangle frame). The map-wide mesh draws a COARSE copy
        // (~560 triangles); the trees within 110 m of the camera focus are drawn from the full geometry by the near-caster proxies below, and are hidden here while they are
        const lodPart = isLod(m);
        const lodGeo = lodPart ? (mapId === "ashgrid" ? clusterSimplify(m.geometry, 24) : clusterSimplifyUV(m.geometry, 24)) : null;
        if (lodGeo && m.geometry.userData) lodGeo.userData.kind = m.geometry.userData.kind;                   // (the same kind tag as the geometry it stands in for)
        const inst = new THREE.InstancedMesh(lodGeo || m.geometry, m.material, list.length);
        // NOTHING map-wide casts any more. Each of these InstancedMeshes is sized to
        // the whole 1600 m map (measured bounding radii 850-1,011 m), so three derives
        // one bounding sphere spanning the map and the shadow camera's ±55 m frustum
        // can never reject it — the depth pass re-rendered EVERY car, container,
        // barrel, rock AND tree on the map every frame. The cars/rocks half was
        // already fixed by exempting them; trees were the deliberate exception,
        // because their canopy shadow is the one that matters for readability.
        // Toggling shadowMap.enabled on the Deepwood ground view moved the frame from
        // 3,716,659 to 2,379,359 triangles — 1,337,300 of them, which is the pine
        // (943,605) plus birch (344,208) instance totals almost exactly. A small mesh
        // rebuilt around the camera focus casts instead (built after this loop).
        inst.castShadow = false;
        inst.receiveShadow = true;
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
        const meshLocal = new THREE.Matrix4().copy(m.matrixWorld); // transform within GLB
        const mats = SHADOW_KINDS[kind] ? [] : null;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          const s = norm * it.s, ry = it.ry || 0;
          Q.setFromAxisAngle(_upV, ry);
          if (it.tx || it.tz) { _qTilt.setFromUnitVectors(_upV, _vTilt.set(-it.tx, 1, -it.tz).normalize()); Q.premultiply(_qTilt); }   // lay a car / container on its (<= 8 degree) ground plane
          // rotate (yaw, then the ground tilt) about the ANCHOR: translate the footprint centre to the origin first (raw GLB units: anchor / norm)
          M.compose(P.set(it.x, it.y - bbox.min.y * s, it.z), Q, S.set(s, s, s));
          if (anchor[0] || anchor[1]) M.multiply(_tAnch.makeTranslation(-anchor[0] / norm, 0, -anchor[1] / norm));
          M.multiply(meshLocal);
          inst.setMatrixAt(i, M);
          if (mats) mats.push(M.clone());
        }
        inst.instanceMatrix.needsUpdate = true;
        g.add(inst);
        instRefs[kind].push(inst);
        const drawMat = windMat(kind, m.material);                                 // LC-38 (medium and up: a wind clone; low: the GLB's own)
        addCulled(kind, list, inst, drawMat, lodPart);                               // LC-89: inst is now the invisible reference, a culled twin draws
        if (mats) shadowSrc.push({ kind, list, geo: m.geometry, mat: drawMat, mats, lo: lodPart ? inst : null, hid: new Set() });
      }
    }
    // colliders for solid props
    const rad = propColliderKinds[kind];
    if (rad) {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (tk && tk.parts) { pushPropColliders(kind, tk, it, i); continue; }
        const topY = it.y + (kind === "car" ? 1.6 : kind === "container" ? 2.8 : kind === "barrel" ? 1.6 : 6);       // legacy fixed boxes
        colliders.push(mkCollider("box", it.x - rad, it.x + rad, it.y, topY, it.z - rad, it.z + rad, -1, kind, i, propHP[kind] || 0));
      }
    }
  }
  // ── near-field foliage shadow casters ────────────────────────────────────
  // The proxies HAVE to be `visible` — three only renders casters that are — so
  // each also draws in the colour pass. That is free in practice: the geometry is
  // coincident with the map-wide mesh it was copied from and every foliage GLB is
  // alphaMode OPAQUE, so the second draw is depth-equal and changes no pixel. The
  // trade is ~8 extra instances and 2-6 extra draw calls against 1.3 M triangles
  // and ~20 draw calls of depth pass. Chunking the map-wide meshes instead would
  // buy the same triangles with far MORE colour-pass calls, on a frame the
  // scorecard proves is draw-call bound (64x36 costs the same as 1280x720).
  {
    const NEAR_N = TIER_Q.nearN, NEAR_R2 = TIER_Q.nearR * TIER_Q.nearR;     // (64 within 110 m; high 72 / 125 m, ULTRA 112 / 165 m)
    const nearCasters = shadowSrc.map((ref) => {
      const im = new THREE.InstancedMesh(ref.geo, ref.mat, NEAR_N);
      im.castShadow = true; im.receiveShadow = !!ref.lo; im.count = 0;       // (a near tree that replaces its coarse twin keeps receiving shadow, as that twin did)
      const wd = windDepthMat(ref.kind); if (wd) im.customDepthMaterial = wd;     // LC-38: its shadow sways with its crown
      im.frustumCulled = false;   // rebuilt around the focus; its own bounding sphere is stale by design
      g.add(im);
      // Wave 7b stage B: a LOD kind on a themed map also draws its STREET trees near the focus in full (the street palms / pines cast no near-field shadow, so the casters skip them;
      // without this they would stay coarse up close). Its own InstancedMesh, never a caster; a clone of the geometry without the kind tag (the probes read only the map-wide meshes).
      let street = null;
      if (ref.lo && mapId !== "ashgrid") {
        const sg = ref.geo.clone(); sg.userData = {};
        street = new THREE.InstancedMesh(sg, ref.mat, NEAR_N);
        street.castShadow = false; street.receiveShadow = true; street.count = 0; street.frustumCulled = false; street.name = "near-street:" + ref.kind;
        g.add(street);
      }
      return { im, ref, street };
    });
    let _fx = 1e9, _fz = 1e9;
    W._foliageDirty = true;
    if (nearCasters.length) trackUpdater(() => {
      const f = W._camFocus || W.player; if (!f) return;
      const dx = f.pos.x - _fx, dz = f.pos.z - _fz;
      if (!W._foliageDirty && dx * dx + dz * dz < 400) return;    // 20 m threshold
      _fx = f.pos.x; _fz = f.pos.z; W._foliageDirty = false;
      for (const nc of nearCasters) {
        const { list, mats, lo } = nc.ref;
        let n = 0, ns = 0;
        const cur = lo ? new Set() : null;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it.dead) continue;
          const ax = it.x - _fx, az = it.z - _fz;
          if (ax * ax + az * az > NEAR_R2) continue;
          if (it.street) {                             // (Wave 7b: a street palm / pine casts no near-field shadow: ~10 of them within 110 m of a Coco Village street were 50 k triangles of proxies, shadow pass + their depth-equal colour draw)
            if (nc.street && ns < NEAR_N) { nc.street.setMatrixAt(ns++, mats[i]); cur.add(i); }
            continue;
          }
          if (n >= NEAR_N) continue;
          nc.im.setMatrixAt(n++, mats[i]);
          if (cur) cur.add(i);
        }
        nc.im.count = n;
        nc.im.instanceMatrix.needsUpdate = true;
        if (nc.street) { nc.street.count = ns; nc.street.instanceMatrix.needsUpdate = true; }
        if (lo) {                                  // the coarse twin skips exactly the trees the near proxy draws in full
          // (LC-89: the map-wide mesh is the invisible REFERENCE now and keeps every true matrix; the culled draw mesh of the kind reads this set and leaves them out)
          nc.ref.hid = cur;
          for (const K2 of culls) if (K2.kind === nc.ref.kind) K2.hid = cur;
          cullDirty = true;
        }
      }
    });
  }
  finishCulls();                                     // LC-89: the culled twins' instance spheres + their updater (after the near-caster swap set exists)
  if (city) { await placeCityKit(); installCityCull(); await buildHouseFurniture(); }
  await yieldPhase();                                // phase 3/3 done

  // ── ground clutter ────────────────────────────────────────────────────────
  // Every frame captured for the benchmark showed empty coloured expanses: the
  // ground carries a grain normal map and nothing else, so at 1.7 m eye height
  // there is no near-field detail at all. A cross-quad tuft layer instanced in a
  // ring around the camera fills it for ~5,600 triangles and ONE draw call — this
  // is the highest visual return per triangle available in the whole file.
  // Refreshed on a timer rather than per frame, and only when the camera moved.
  {
    const cityMask = city ? buildCityMask() : null;
    const CL_N = TIER_Q.clN, CL_R = TIER_Q.clR;         // (1,400 tufts in 55 m; high 1,700 / 60 m, ULTRA 2,900 / 78 m)
    const q1 = new THREE.PlaneGeometry(0.55, 0.45); q1.translate(0, 0.225, 0);
    const q2 = q1.clone(); q2.rotateY(Math.PI / 2);
    const clGeo = BufferGeometryUtils.mergeGeometries([q1, q2], false);
    q1.dispose(); q2.dispose();
    // three's color_fragment chunk multiplies diffuseColor only under USE_COLOR /
    // USE_COLOR_ALPHA — USE_INSTANCING_COLOR alone feeds vColor in the VERTEX stage
    // and the fragment stage then ignores it. So per-instance tint needs
    // vertexColors AND a real color attribute; without the all-ones attribute the
    // unbound `color` input reads the WebGL generic default (0,0,0) and every tuft
    // renders black.
    clGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(clGeo.attributes.position.count * 3).fill(1), 3));
    const clMat = new THREE.MeshStandardMaterial({ map: clutterTex(), alphaTest: 0.5, roughness: 1, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
    if (LCFX) lcPatch(clMat, Object.assign({ LC_CLOUD: "", LC_AO: "" }, windDefs("grass")));     // LC-38 the tufts sway, LC-74 / LC-41 like the ground under them
    const clutter = new THREE.InstancedMesh(clGeo, clMat, CL_N);
    clutter.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CL_N * 3), 3);
    clutter.castShadow = false; clutter.receiveShadow = false;
    clutter.frustumCulled = false; clutter.name = "clutter";
    g.add(clutter);
    const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3(), _cp = new THREE.Vector3();
    const _cy = new THREE.Vector3(0, 1, 0), _hide = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4);
    const _clC = [0, 0, 0];                           // colorAt out (a rebuild colours up to 1,400 tufts)
    const CLK = 0.82 * GRADE.ground;
    // The tufts used to be a golden-angle spiral bolted to the CAMERA: instance i
    // always sat at (clX + cos(i*GA)*r, ...), so the offset depended only on i and
    // every tuft was rigidly parented to the camera anchor. Re-snapping that
    // anchor every 10 m teleported the ENTIRE field to new ground — the "grass
    // switches so quickly and looks terrible" the owner saw. Nothing was
    // world-anchored, so nothing held still.
    //
    // Now it is a WORLD-SPACE GRID HASH. Walk the fixed integer grid (CELL m) over
    // the disc around the camera; a cell's jitter, yaw and scale come from
    // hash2(cellX, cellZ) — so a tuft's world position, orientation and tint NEVER
    // change as the camera moves. A rebuild only adds cells entering the ring and
    // drops cells leaving it, and the rim scale-fade makes even that sub-pixel.
    const CELL = 2.6;                                 // ~0.148 tufts/m^2, matches the old density
    const FADE0 = CL_R - 15;                          // full size to here, shrink to 0 by CL_R (40 m at the default 55)
    let clT = 9, clAX = 1e9, clAZ = 1e9;
    trackUpdater((dt) => {
      clT += dt;
      const cam = W.camera; if (!cam) return;
      if (clT < 0.5) return;
      // rebuild only when the camera has walked far enough that the ring content
      // would actually change, or on a slow watchdog tick
      const mvx = cam.position.x - clAX, mvz = cam.position.z - clAZ;   // (Math.hypot allocates: rest args)
      if (mvx * mvx + mvz * mvz < CELL * CELL && clT < 6) return;
      clT = 0; clAX = cam.position.x; clAZ = cam.position.z;
      const cx0 = Math.floor((clAX - CL_R) / CELL), cx1 = Math.ceil((clAX + CL_R) / CELL);
      const cz0 = Math.floor((clAZ - CL_R) / CELL), cz1 = Math.ceil((clAZ + CL_R) / CELL);
      const R2 = CL_R * CL_R;
      let n = 0;
      for (let ix = cx0; ix <= cx1 && n < CL_N; ix++) {
        for (let iz = cz0; iz <= cz1 && n < CL_N; iz++) {
          const h = hash2(ix, iz, seed);
          const h2 = hash2(ix + 101, iz - 57, seed);
          // jitter inside the cell so the grid never reads as a lattice
          const x = (ix + 0.5 + (h - 0.5) * 0.9) * CELL;
          const z = (iz + 0.5 + (h2 - 0.5) * 0.9) * CELL;
          const dx = x - clAX, dz = z - clAZ, d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;                       // outside the disc
          const y = heightAt0(x, z);
          if (y < waterY + 0.35 || Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) continue;
          if (cityMask && cityMask[Math.floor((z + HALF) / (SIZE / 400)) * 400 + Math.floor((x + HALF) / (SIZE / 400))]) continue;   // no grass on streets, sidewalks, plazas or under buildings
          // rim scale-fade: full to FADE0, smoothstep down to 0 by CL_R, so a tuft
          // is sub-pixel at the instant it enters or leaves the ring — no visible pop
          const d = Math.sqrt(d2);
          let fade = 1;
          if (d > FADE0) { const t = 1 - (d - FADE0) / (CL_R - FADE0); fade = t * t * (3 - 2 * t); }
          const s = (0.75 + h * 0.7) * fade;
          if (s < 0.02) continue;
          _cm.compose(_cp.set(x, y, z), _cq.setFromAxisAngle(_cy, h2 * 6.283), _cs.set(s, s, s));
          clutter.setMatrixAt(n, _cm);
          const c = colorAt(mapId, y, x, z, seed, _clC);
          clutter.instanceColor.setXYZ(n, c[0] * CLK, c[1] * CLK, c[2] * CLK);   // contact darkening x the ground grade (the tufts match the darkened ground)
          n++;
        }
      }
      // InstancedMesh with frustumCulled=false honours a shrunken count, so hide
      // the tail rather than paying to draw it
      clutter.count = n;
      clutter.instanceMatrix.needsUpdate = true;
      clutter.instanceColor.needsUpdate = true;
    });
  }

  // ── sky-island decor: few enough to clone directly ───────────────────────
  // D2 (Savanna only): ONE InstancedMesh per material of each decor kind (the acacia is a trunk and a canopy, the crystal two parts) instead of a clone per tree - eight island trees
  // were sixteen draw calls (and sixteen shadow-pass calls) of a drop view. They cast no shadow (a floating island 26-52 m up shadows nothing a player sees).
  if ((mapId === "ashgrid" || city) && islandTrees.length) {          // (Wave 7b: the themed maps too - 6 island palms were 6 draw calls + 6 shadow calls of an Isla Viva drop view)
    const byKind = new Map();
    for (const t of islandTrees) { if (!byKind.has(t.kind)) byKind.set(t.kind, []); byKind.get(t.kind).push(t); }
    const IM = new THREE.Matrix4(), IP = new THREE.Vector3(), IQ = new THREE.Quaternion(), IS = new THREE.Vector3();
    for (const [kind, list] of byKind) {
      try {
        const m = await W.kernel.loadGLTF(kind === "crystal" ? W.assetBase + "assets/props/meshy/deco_crystal.glb" : W.assetBase + "assets/props/" + kind + ".glb");
        m.updateMatrixWorld(true);
        const bb2 = new THREE.Box3().setFromObject(m), sz2 = bb2.getSize(new THREE.Vector3());
        const baseH2 = kind === "crystal" ? 3.2 : kind === "palm" ? 7 : kind === "pine" ? 8 : 6.5;
        const meshes = [];
        m.traverse((o) => { if (o.isMesh) meshes.push(o); });
        for (const part of mergePartsByMaterial(meshes)) {
          const ig = part.geometry.clone();                                              // (a copy of its own, tagged as nothing: a sky-island tree is not a GROUND prop to the placement gates)
          ig.userData = {};
          const inst = new THREE.InstancedMesh(ig, windMat(kind, part.material), list.length);     // (LC-38: island trees sway too)
          inst.name = "island:" + kind;
          for (let i = 0; i < list.length; i++) {
            const t = list[i], s2 = (baseH2 / Math.max(0.001, sz2.y)) * t.s;
            IM.compose(IP.set(t.x, t.y - bb2.min.y * s2, t.z), IQ.setFromAxisAngle(_upV, t.ry), IS.set(s2, s2, s2)).multiply(part.matrixWorld);
            inst.setMatrixAt(i, IM);
          }
          inst.instanceMatrix.needsUpdate = true;
          inst.castShadow = false; inst.receiveShadow = true;
          g.add(inst);
        }
      } catch (e) { /* crystal GLB may not exist yet — islands still work */ }
    }
  } else
  for (const t of islandTrees) {
    try {
      const url = t.kind === "crystal"
        ? W.assetBase + "assets/props/meshy/deco_crystal.glb"
        : W.assetBase + "assets/props/" + t.kind + ".glb";
      const m = await W.kernel.loadGLTF(url);
      const bb2 = new THREE.Box3().setFromObject(m);
      const sz2 = bb2.getSize(new THREE.Vector3());
      const baseH2 = t.kind === "crystal" ? 3.2 : t.kind === "palm" ? 7 : t.kind === "pine" ? 8 : 6.5;
      const s2 = (baseH2 / Math.max(0.001, sz2.y)) * t.s;
      m.scale.setScalar(s2);
      m.position.set(t.x, t.y - bb2.min.y * s2, t.z);
      m.rotation.y = t.ry;
      g.add(m);
    } catch (e) { /* crystal GLB may not exist yet — islands still work */ }
  }

  // ── LC-41 baked contact AO (medium and up) ────────────────────────────────────────────────────────────────────────
  // Nothing darkened the ground where a wall, a rock, a car or a container stands on it: every base sat on fully lit ground (GTAO was cut: 268 -> 484
  // calls). Baked once per match instead: every box collider that stands ON the ground (its foot within 0.35 m of the terrain, at least 0.5 m tall) is
  // rasterised into a 2048 x 2048 occupancy mask over the map (0.78 m a texel, area-weighted at its edges, taller = denser up to 2.5 m), blurred by two
  // running-sum box passes (~1.6 m), and the ground materials (terrain, roads, town ground, grass tufts) take it as AO: the sky fill under it x (1 - 0.55 ao),
  // the sun x (1 - 0.2 ao). One R8 texture (4 MB + mips), one fetch per ground fragment, ZERO draw calls. A function of the colliders only: every client and
  // every seed replay bakes the same mask.
  if (LCFX) {
    const _ao0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const N = 2048, gyc = new Float32Array(colliders.length);
    for (let ci = 0; ci < colliders.length; ci++) { const c = colliders[ci]; gyc[ci] = c.dead || c.kind !== "box" ? 0 : heightAt0((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2); }
    const { px, nAO, rasterMs } = bakeContactAO(colliders, gyc, N, SIZE);
    const at = new THREE.DataTexture(px, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    at.minFilter = THREE.LinearMipmapLinearFilter; at.magFilter = THREE.LinearFilter; at.generateMipmaps = true; at.wrapS = at.wrapT = THREE.ClampToEdgeWrapping; at.needsUpdate = true;
    lcOwn(at);
    LCU.uLcAO.value = at;
    LCU.uLcAOK.value.set(1 / SIZE, 0.5, 0.55, 0.2);
    W._lcAOStats = { colliders: nAO, rasterMs, ms: Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - _ao0) * 10) / 10 };
  }

  // ── static collider spatial hash ──────────────────────────────────────────
  // queryColliders is the hottest function in the game: 423 calls a frame were
  // measured (movement support + wall tests for 50 actors, bullets, bot sight and
  // cover), and each one allocated an output array, a Set and 1-4 string keys.
  // Now: numeric cell keys, a per-query STAMP on each collider instead of a Set,
  // and a reused output array.
  //   CONTRACT: the returned array is shared scratch, valid until the NEXT call.
  //   A caller that must hold the list across another query (or recurse, as
  //   weapons.js explode does) passes its own `out` array as the 4th argument.
  // Result order is unchanged (cells x-major, then insertion order), so every
  // nearest-hit tie resolves exactly as before.
  // WAVE 7: Savanna's towns put 60-100 colliders into a 16 m cell (a house is ~20 boxes): every query returned them all and every caller slab-tested them. With a
  // city the cell is 8 m (a quarter of the candidates, the same colliders, the same insertion order inside a cell); the other maps keep 16 m, so their
  // nearest-hit tie-breaks (cells x-major, then insertion order) are exactly what they were.
  // WAVE 8: the furnished houses hold 60-680 colliders each (ashgrid ~61 k in all, was ~10 k): with 8 m cells a 0.6 m query at a room's centre returned 88
  // colliders on average (max 412), with 4 m cells 40 (max 177) - the mover, bullets and bots slab-test every one they get. Wide queries visit more cells
  // (r 16: 949 entries vs 782) - lane I2's bots use queryCollidersY / hasCollidersNear for those.
  const CELL = city ? (houses.length ? 4 : 8) : 16;
  const chash = new Map();
  const cKey = (cx, cz) => (cx + 8192) * 16384 + (cz + 8192);
  colliders.forEach((c, idx) => {
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = cKey(cx, cz);
      if (!chash.has(k)) chash.set(k, []);
      chash.get(k).push(c);
    }
  });
  let qStamp = 0;
  //   ALLOCATION (lane S, 2026-10): `o.length = 0` then push() made V8 drop the
  //   array's backing store on EVERY query and allocate a new one on the first
  //   push - ~2.7 KB a match frame of "push" garbage across ~110 queries. Results
  //   are now written by index into the kept backing store and the length is set
  //   once at the end; an empty result from the shared scratch is a frozen shared
  //   [] (every caller only reads it), so a miss never resets the scratch either.
  //   Same colliders, same order.
  const qOut = [];
  const Q_EMPTY = Object.freeze([]);
  // WAVE 8 (lane I2's proposal, lane I1): only the colliders whose box meets the query SQUARE are returned (a cell holds whole wall runs, a house's furniture;
  // every caller's own test needs a collider within its reach, so the answer of every caller is unchanged - lane I2: whole-match fingerprints identical on 3 maps).
  // (Wave 8 fix round, lane K1) an optional vertical band: queryColliders(x, z, r, out, y0, y1) returns only the colliders whose span meets [y0, y1] (the
  // mover's capsule band, a bullet segment's height range). A furnished house stacks two or three storeys, an attic and its roof over the same square metres:
  // a ground-floor mover query got every storey's walls, slabs, gables and furniture (Deepwood: 23 per r 1.6 query at a room, 11 of them on the actor's storey;
  // houseload collider-load-frame x1.371). Without y0 / y1 the answer is exactly what it was.
  function queryColliders(x, z, r, out, y0, y1) {
    if (y0 !== undefined) return queryCollidersY(x, z, r, y0, y1, out || qOut);
    const o = out || qOut;
    let n = 0;
    const stamp = ++qStamp;
    const qx0 = x - r, qx1 = x + r, qz0 = z - r, qz1 = z + r;
    const x0 = Math.floor(qx0 / CELL), x1 = Math.floor(qx1 / CELL);
    const z0 = Math.floor(qz0 / CELL), z1 = Math.floor(qz1 / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const l = chash.get(cKey(cx, cz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (!c.dead && c._qs !== stamp && c.maxX >= qx0 && c.minX <= qx1 && c.maxZ >= qz0 && c.minZ <= qz1) { c._qs = stamp; o[n++] = c; }
      }
    }
    if (n === 0 && !out) return Q_EMPTY;
    if (o.length !== n) o.length = n;
    return o;
  }

  // WAVE 8 (lane I1, for lane I2's bots and anyone else whose query covers whole houses): a furnished house holds 60-680 colliders (walls, slabs, stairs, roof
  // planks, furniture) in a few cells, so a 16 m query returns houses whole. Two cheaper forms, same cells, same order, same scratch contract as queryColliders:
  //   queryCollidersY(x, z, r, y0, y1, out?)  only the colliders whose vertical span meets [y0, y1] (one storey: [feet - 0.6, feet + 2.4]);
  //   hasCollidersNear(x, z, r)               true at the FIRST live collider of the cells the disc touches (an emptiness test returns nothing).
  const qOutY = [];
  function queryCollidersY(x, z, r, y0, y1, out) {
    const o = out || qOutY;
    let n = 0;
    const stamp = ++qStamp;
    const qx0 = x - r, qx1 = x + r, qz0 = z - r, qz1 = z + r;
    const x0 = Math.floor(qx0 / CELL), x1 = Math.floor(qx1 / CELL);
    const z0 = Math.floor(qz0 / CELL), z1 = Math.floor(qz1 / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const l = chash.get(cKey(cx, cz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (!c.dead && c._qs !== stamp && c.maxY >= y0 && c.minY <= y1 && c.maxX >= qx0 && c.minX <= qx1 && c.maxZ >= qz0 && c.minZ <= qz1) { c._qs = stamp; o[n++] = c; }
      }
    }
    if (n === 0 && !out) return Q_EMPTY;
    if (o.length !== n) o.length = n;
    return o;
  }
  function hasCollidersNear(x, z, r) {                // == queryColliders(x, z, r).length > 0, without building the list
    const qx0 = x - r, qx1 = x + r, qz0 = z - r, qz1 = z + r;
    const x0 = Math.floor(qx0 / CELL), x1 = Math.floor(qx1 / CELL);
    const z0 = Math.floor(qz0 / CELL), z1 = Math.floor(qz1 / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const l = chash.get(cKey(cx, cz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) { const c = l[i]; if (!c.dead && c.maxX >= qx0 && c.minX <= qx1 && c.maxZ >= qz0 && c.minZ <= qz1) return true; }
    }
    return false;
  }
  // WAVE 8: which house / storey / room a point is in (bots' "which room and floor am I on", loot, the footstep surface, the gates). houseAt(x, z, y?) ->
  // { house (index into map.houses), id, floor, room (a rooms[] index of that house, -1 = inside the walls but in no room: a stair strip's landing / a wall),
  // y (that storey's floor), surf ("wood" | "concrete") } or null outside every house. y = the feet (default: the ground storey). Rooms by their cell rects.
  const HOUSE_CELL = 16, houseHash = new Map(), houseFloors = [];
  const HG_SURF = { floor_wood: "wood", plank: "wood", plank_in: "wood", wood: "wood" };      // a floor slab's top material -> the footstep surface (else "concrete")
  houses.forEach((H, hi) => {
    const a = H.aabb, i0 = Math.floor(a.min[0] / HOUSE_CELL), i1 = Math.floor(a.max[0] / HOUSE_CELL), j0 = Math.floor(a.min[2] / HOUSE_CELL), j1 = Math.floor(a.max[2] / HOUSE_CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = cKey(i, j); if (!houseHash.has(k)) houseHash.set(k, []); houseHash.get(k).push(hi); }
    // the floor slabs (their walkable tops): [x0, z0, x1, z1, top, surf]
    const sl = [];
    for (const b of H.boxes) if (b.p === "slab" && b.c) { const pe = H.palette[b.f[2]]; sl.push([b.min[0], b.min[2], b.max[0], b.max[2], b.max[1], HG_SURF[pe && pe.mat] || "concrete"]); }
    houseFloors.push(sl);
  });
  const _ha = { house: -1, id: "", floor: 0, room: -1, y: 0, surf: "concrete" };
  function houseAt(x, z, y) {
    const l = houseHash.get(cKey(Math.floor(x / HOUSE_CELL), Math.floor(z / HOUSE_CELL)));
    if (!l) return null;
    for (let k = 0; k < l.length; k++) {
      const H = houses[l[k]], fl = houseFloors[l[k]];
      // inside the walls' outer faces: one of the house's floor slabs is under the point
      let best = -Infinity, surf = null;
      for (let i = 0; i < fl.length; i++) {
        const q = fl[i];
        if (x < q[0] || x > q[2] || z < q[1] || z > q[3]) continue;
        if (y == null) { if (surf === null || q[4] < best) { best = q[4]; surf = q[5]; } }                 // (no feet given: the ground storey)
        else if (q[4] <= y + 0.35 && (surf === null || q[4] > best)) { best = q[4]; surf = q[5]; }       // (the highest floor at or under the feet)
      }
      if (surf === null) continue;
      let f = 0;
      for (let i = 0; i < H.floors.length; i++) if (Math.abs(H.floors[i].y - best) < 0.2) f = i;
      let room = -1;
      for (let i = 0; i < H.rooms.length && room < 0; i++) {
        const R = H.rooms[i];
        if (R.floor !== f) continue;
        for (const r of R.rects) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) { room = i; break; }
      }
      _ha.house = l[k]; _ha.id = H.id; _ha.floor = f; _ha.room = room; _ha.y = H.floors[f].y; _ha.surf = surf;
      return _ha;
    }
    return null;
  }

  // ── LOS (coarse march vs terrain + static boxes) ──────────────────────────
  const losCols = [];
  function spanTouches(cols, x0, y0, z0, x1, y1, z1) {
    const lx = (x0 < x1 ? x0 : x1) - 0.01, hx = (x0 < x1 ? x1 : x0) + 0.01;
    const ly = (y0 < y1 ? y0 : y1) - 0.01, hy = (y0 < y1 ? y1 : y0) + 0.01;
    const lz = (z0 < z1 ? z0 : z1) - 0.01, hz = (z0 < z1 ? z1 : z0) + 0.01;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.maxX >= lx && c.minX <= hx && c.maxY >= ly && c.minY <= hy && c.maxZ >= lz && c.minZ <= hz) return true;
    }
    return false;
  }
  // C-SMOKE (LC-14, P2-C side): W.smokes = [{x, y, z, r, t0, t1}] (weapons.js keeps it; fx.js draws the clouds). A sight line whose CHORD through a live
  // smoke sphere (t0 <= W.t < t1) is longer than SMOKE_SEE m is blocked - through the middle of a cloud you see nothing, a line grazing its rim (a chord
  // under 1.5 m: the thin fringe fx draws) still sees. Two actors standing inside the same cloud closer than that still see each other. Tested FIRST: a
  // handful of spheres costs a few multiplies against the collider sweep below. `noSmoke` (7th argument) skips it: an explosion's splash is not stopped by
  // smoke (weapons.js blastBlocked should pass true - integrator note), nor is a sound.
  const SMOKE_SEE = 1.5;
  function smokeBlocks(ax, ay, az, dx, dy, dz, len) {
    const S2 = W.smokes;
    if (!S2 || !S2.length || !(len > 0)) return false;
    const t = W.t, il = 1 / len, ux = dx * il, uy = dy * il, uz = dz * il;
    for (let i = 0; i < S2.length; i++) {
      const s = S2[i];
      if (!s || !(t >= s.t0 && t < s.t1) || !(s.r > 0)) continue;
      const ox = s.x - ax, oy = s.y - ay, oz = s.z - az, p = ox * ux + oy * uy + oz * uz;
      const q2 = ox * ox + oy * oy + oz * oz - p * p, r2 = s.r * s.r;
      if (q2 >= r2) continue;
      const hcl = Math.sqrt(r2 - q2), t0 = Math.max(0, p - hcl), t1 = Math.min(len, p + hcl);
      if (t1 - t0 > SMOKE_SEE) return true;
    }
    return false;
  }
  function losBlocked(ax, ay, az, bx, by, bz, noSmoke) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!noSmoke && W.smokes && W.smokes.length && smokeBlocks(ax, ay, az, dx, dy, dz, len)) return true;
    // Terrain still needs sampling (it is a heightfield, not a solid), but
    // colliders are now SWEPT: the old point-sampled containment test shared the
    // bullet path's flaw, so a bot could see — and shoot — through any wall its
    // ~3 m samples happened to straddle, and through every ramp (kind !== box).
    const S = window.FFG.sim.Royale;
    // Sweep in SPANS rather than one query over the whole sightline: the grid is
    // 16 m, so a 200 m line queried whole would pull ~169 cells and slab-test
    // every collider in them, for every bot against every candidate target.
    // A span slightly larger than the cell keeps each query to a couple of cells
    // while the test stays a true sweep (no sampling gaps).
    const SPAN = city ? 12 : 24;
    const spans = Math.max(1, Math.ceil(len / SPAN));
    for (let i = 0; i < spans; i++) {
      const t0 = i / spans, t1 = (i + 1) / spans;
      const x0 = ax + dx * t0, y0 = ay + dy * t0, z0 = az + dz * t0;
      const x1 = ax + dx * t1, y1 = ay + dy * t1, z1 = az + dz * t1;
      const hx = x1 - x0, hz = z1 - z0;                   // (Math.hypot allocates: rest-args builtin)
      const r = Math.sqrt(hx * hx + hz * hz) / 2 + 0.6;
      const cols = queryColliders((x0 + x1) / 2, (z0 + z1) / 2, r, losCols);
      // segmentColliders is exact but costs a boxed call (6 doubles) and a result
      // object per hit; most spans have no collider whose box even overlaps the
      // span's box, and a slab test can only hit a box it overlaps, so those spans
      // skip it. Overlap is tested with a 1 cm margin (a superset), so the answer
      // is the same boolean as before.
      if (cols.length && spanTouches(cols, x0, y0, z0, x1, y1, z1) && S.segmentColliders(x0, y0, z0, x1, y1, z1, cols)) return true;
    }
    const steps = Math.min(60, Math.max(6, Math.floor(len / 3)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (heightAt0(ax + dx * t, az + dz * t) > ay + dy * t) return true;
    }
    return false;
  }

  // ── minimap canvas ────────────────────────────────────────────────────────
  const mm = document.createElement("canvas");
  mm.width = mm.height = 512;
  {
    const ctx = mm.getContext("2d");
    const img = ctx.createImageData(512, 512);
    for (let py = 0; py < 512; py++) for (let px = 0; px < 512; px++) {
      const x = (px / 512 - 0.5) * SIZE, z = (py / 512 - 0.5) * SIZE;
      const h = heightAt0(x, z);
      let c;
      if (h < waterY + 0.2 && K.water) c = [26, 110, 150];
      else { const cc = colorAt(mapId, h, x, z, seed); c = [cc[0] * 235, cc[1] * 235, cc[2] * 235]; }
      const shadeK = 0.75 + Math.min(0.5, Math.max(0, h / 90)) * 0.5;
      const o = (py * 512 + px) * 4;
      img.data[o] = c[0] * shadeK; img.data[o + 1] = c[1] * shadeK; img.data[o + 2] = c[2] * shadeK; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (city) drawCityOnMinimap(ctx);
  }

  function randomGroundPos(rng2) {
    for (let tries = 0; tries < 40; tries++) {
      const x = (rng2() * 2 - 1) * (HALF - 80), z = (rng2() * 2 - 1) * (HALF - 80);
      const y = heightAt0(x, z);
      if (y > waterY + 0.6) return { x, y, z };
    }
    return { x: 0, y: heightAt0(0, 0), z: 0 };
  }

  // runtime prop destruction: shrink the instanced mesh at this collider's idx to
  // nothing and kill the collider (queryColliders now skips it, so shots + players
  // pass through the gap). Weapons/explosions call this on shootable props.
  const _propZeroM = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4);
  function destroyProp(col) {
    if (!col || col.dead || col.prop == null) return;
    col.dead = true;
    const refs = instRefs[col.prop];
    if (refs) for (const inst of refs) { inst.setMatrixAt(col.idx, _propZeroM); inst.instanceMatrix.needsUpdate = true; }
    // The near-caster proxies hold their own copy of the matrices, so a felled tree
    // would keep casting until the focus moved 20 m. col.idx is the index into
    // props[kind] (the collider loop pushes `idx: i` over that same list), so the
    // entry can be marked directly and the proxies forced to rebuild next frame.
    const lst = props[col.prop];
    if (lst && lst[col.idx]) lst[col.idx].dead = true;
    W._foliageDirty = true;
    cullDirty = true;                                // LC-89: the culled twin drops it on its next pass
  }

  const lootAll = lootPoints.concat(chestPoints);
  // What is underfoot, for footstep audio. The recorded Kenney steps are per
  // surface, and a boardwalk that sounds like grass is worse than no sample at
  // all. Cheap by construction: it reuses the SAME snow term the vertex colour
  // uses (deepwood's northern zone, maps.js colorAt), so what you hear always
  // matches what you see, and falls back to the map's base ground otherwise.
  // Structures are checked first — standing on a deck or a roof reads as wood.
  // LC-52 (P2-C): the footstep surface used to be the map's base ground unless ANY collider within 0.6 m rose 0.35-6 m over the ground - a wall, a tree
  // trunk or a crate BESIDE the player read as "wood" (342 of 355 wood readings in the audit census), and all of Savanna read "concrete" (3,366 / 0 grass)
  // though its west is a grass savanna. Now, in order:
  //   1. a furnished house floor (Wave 8 houseAt, upstairs by the feet height);
  //   2. a collider the feet stand ON: its footprint contains (x, z) and its top is within 0.3 m below / 0.25 m above the feet (no feet given: a top
  //      0.35-6 m over the ground, the old rule but footprint-exact) - its material (colSurf: from the texture kind / tint it is drawn with), a prop's by
  //      its kind (rocks stone; car, container, barrel metal), a sky island's top grass;
  //   3. what is LAID on the ground there (the 1 m raster: asphalt / paving = concrete, yards and fields = dirt, a park = grass);
  //   4. shallow water over the terrain = "water";
  //   5. the terrain's own biome zone, the SAME tests colorAt / splatAt tint and texture the ground with: beach / dry-wash / desert sand = "sand",
  //      volcano basalt, bluffs and rocky tops = "stone", Deepwood's snow = "snow", its river mud = "dirt", else "grass".
  // Labels: wood, stone, concrete, metal, dirt, sand, snow, grass, water (audio.js keys wood / snow / stone + concrete today; the rest play its grass step
  // until lane audio adds samples - integrator note). Allocation-free (queryColliders fills a reused array).
  const PROP_SURF = { rocks: "stone", car: "metal", container: "metal", barrel: "metal", tree: "wood", palm: "wood", pine: "wood", birch: "wood" };
  const _sfCols = [], _sfW = [0, 0, 0];
  function surfaceAt(x, z, y) {
    if (houses.length) { const h = houseAt(x, z, y); if (h) return h.surf; }          // (WAVE 8: a house floor: its boards or its tiles / concrete, upstairs when the caller gives the feet)
    const gy = heightAt0(x, z), hasY = typeof y === "number" && y === y;
    const near = queryColliders(x, z, 0.05, _sfCols);
    let best = null, bestTop = -Infinity;
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (c.dead || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      let top = c.maxY;
      if (c.kind === "ramp") {                                     // the ramp's surface under (x, z): dir 0 +X, 1 -X, 2 +Z, 3 -Z rises
        const f = c.dir === 0 ? (x - c.minX) / (c.maxX - c.minX) : c.dir === 1 ? (c.maxX - x) / (c.maxX - c.minX) : c.dir === 2 ? (z - c.minZ) / (c.maxZ - c.minZ) : (c.maxZ - z) / (c.maxZ - c.minZ);
        top = c.minY + (c.maxY - c.minY) * Math.max(0, Math.min(1, f));
      }
      const on = hasY ? (top >= y - 0.3 && top <= y + 0.25) : (top > gy + 0.35 && top < gy + 6);
      if (on && top > bestTop) { bestTop = top; best = c; }
    }
    if (best) return colSurf.get(best) || (best.prop != null ? (PROP_SURF[best.prop] || "stone") : (city && mapId === "ashgrid" ? "concrete" : "wood"));
    if (K.water && gy < waterY - 0.05 && (!hasY || y <= waterY + 0.3)) return "water";             // (wading: the feet are at the waterline, above the sea bed; before the raster - a sunken lot edge is still water)
    if (!hasY || y <= gy + 0.6) {
      const i = Math.floor(x + HALF), j = Math.floor(z + HALF);
      if (i >= 0 && j >= 0 && i < SGN && j < SGN) { const k = surfG[j * SGN + i]; if (k) return SG_NAMES[k]; }
    }
    // the bare terrain: the DOMINANT layer of the splat the ground is textured with (splatAt: grass/rock, beach, sand - the same weights colorAt blends
    // its tint by), so the step sounds like the ground looks; then the zones colorAt paints outright (basalt, bluffs, rocky tops, river mud)
    const w = splatAt(mapId, gy, x, z, seed, _sfW);
    if (mapId === "isla_viva") return gy > 34 ? "stone" : w[1] >= 0.5 ? "sand" : "grass";
    if (mapId === "ashgrid") return gy > 28 ? "stone" : w[2] >= 0.5 ? "sand" : "grass";
    if (mapId === "deepwood") return w[1] >= 0.5 ? "snow" : gy < 0.6 ? "dirt" : gy > 44 ? "stone" : "grass";
    return "grass";
  }
  // LC-12 (P2-C export for lane bots): how hidden a point is INSIDE A BUSH, 0 (in the open) .. 1 (at a bush's heart). Bushes have no collider (adding one
  // would change collision and the baked collider table), so bot sight asks this instead: each bush's drawn bounds (its instance matrix x its mesh's box,
  // every part) as the ellipsoid inscribed in that box; conceal = 2 x (1 - q) clamped to 0..1, q = the point's normalised squared distance from the centre
  // (so the inner ~70 % of the bush volume reads >= 0.5). y = the point's height (a chest / eye); omitted = 0.7 m over the ground (a crouched chest). A
  // static 8 m hash, built once per match from the placed bushes; allocation-free.
  const CONCEAL_CELL = 8;
  let concealHash = null;
  function buildConceal() {
    const list = props.bush || [], refs = instRefs.bush || [];
    const n = list.length;
    const B = new Float32Array(n * 6), box = new THREE.Box3(), tb = new THREE.Box3(), m = new THREE.Matrix4();
    let nOk = 0;
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      box.makeEmpty();
      for (const inst of refs) {
        if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
        inst.getMatrixAt(i, m);
        tb.copy(inst.geometry.boundingBox).applyMatrix4(m);
        box.union(tb);
      }
      if (box.isEmpty()) continue;
      B[i * 6] = box.min.x; B[i * 6 + 1] = box.min.y; B[i * 6 + 2] = box.min.z; B[i * 6 + 3] = box.max.x; B[i * 6 + 4] = box.max.y; B[i * 6 + 5] = box.max.z;
      const ci0 = Math.floor((box.min.x + HALF) / CONCEAL_CELL), ci1 = Math.floor((box.max.x + HALF) / CONCEAL_CELL);
      const cj0 = Math.floor((box.min.z + HALF) / CONCEAL_CELL), cj1 = Math.floor((box.max.z + HALF) / CONCEAL_CELL);
      for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) { const key = cj * 1024 + ci; let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(i); }
      nOk++;
    }
    concealHash = { B, cells, n: nOk };
  }
  function concealAt(x, z, y) {
    if (!concealHash) return 0;
    const a = concealHash.cells.get(Math.floor((z + HALF) / CONCEAL_CELL) * 1024 + Math.floor((x + HALF) / CONCEAL_CELL));
    if (!a) return 0;
    const py = typeof y === "number" && y === y ? y : heightAt0(x, z) + 0.7, B = concealHash.B;
    let best = 0;
    for (let k = 0; k < a.length; k++) {
      const o = a[k] * 6;
      if (x < B[o] || x > B[o + 3] || z < B[o + 2] || z > B[o + 5] || py < B[o + 1] || py > B[o + 4]) continue;
      const hx = (B[o + 3] - B[o]) / 2, hy = (B[o + 4] - B[o + 1]) / 2, hz = (B[o + 5] - B[o + 2]) / 2;
      const ux = (x - B[o] - hx) / hx, uy = (py - B[o + 1] - hy) / hy, uz = (z - B[o + 2] - hz) / hz, q = ux * ux + uy * uy + uz * uz;
      const v = 2 * (1 - q);
      if (v > best) best = v >= 1 ? 1 : v;
      if (best === 1) break;
    }
    return best;
  }
  buildConceal();                                    // LC-12: the bushes' drawn bounds (the reference meshes' true matrices; here, after its consts)

  // D2 (squad fallback, with lane D1's net.js): after the map is built, a page that fell back says so on W.mapFallback { from, to, reason } (from = the version it advertised,
  // to = the version it really built: the Wave-6 layout is generator version 2) and on the "mapFallback" event; net.js leaves the squad room for such a client
  if (cityFallback) {
    W.mapFallback = { from: cityFallback.wanted, to: cityFallback.genVersion, reason: cityFallback.reason };
    try { W.events && W.events.emit && W.events.emit("mapFallback", { map: mapId, from: cityFallback.wanted, to: cityFallback.genVersion, genVersion: cityFallback.genVersion, wanted: cityFallback.wanted, reason: cityFallback.reason }); } catch (e) { /* a listener's problem */ }
  }
  return {
    id: mapId, K, half: HALF * 0.98, size: SIZE, waterY,
    heightAt: heightAt0, groundAt: heightAt0, surfaceAt, concealAt,
    colliders, queryColliders, destroyProp,
    // WAVE 8: the furnished houses (housegen records as built: rooms, doors, stairs, nav links, loot / chest points, furniture, cols = [first collider, structure
    // colliders, all], roofRamps = the collider indices of the pitched roofs' planks - a roof you land on, not a stair) and the queries over them
    houses, houseAt, queryCollidersY, hasCollidersNear,
    // the placed prop lists ({x, y, z, s, ry, ...} per kind: the ANCHOR, the final base y, the seeded scale and yaw) and what the slope
    // limits dropped - read-only, for the placement / collision gates (_harness) and for debugging
    propInstances: props, propStats,
    lootPoints: lootAll, pois, portals,
    landmark: lookout,                                                          // LC-90: Deepwood's fire lookout { x, z, y, top } (null elsewhere)
    randomGroundPos, losBlocked,
    cullNow: () => { if (cullFn) { cullDirty = true; cullFn(); } },          // LC-89: re-cull the prop twins against W.camera now (after a camera cut)
    minimap: mm, themeColor: K.themeColor,
    terrain, water: mapWater, sky: K.sky,
    // C-PAD (Wave 6): what the ground is made of - read-only, for the gates and for debugging. `genVersion` names the world GENERATOR: 1 = the
    // Wave-5 build (analytic ground, the terrain built before any POI), 2 = baked lattice + pads + road corridors. Two clients with different
    // versions build different ground from the same seed - the squad-room handshake should compare it (net.js, lane 7C).
    genVersion: cityFallback ? cityFallback.genVersion : MAP_GEN_VERSION,       // (WAVE 7, 7A2: a Savanna built on its fallback layout says so: see prepareCity)
    fallback: cityFallback,                                                     // null, or { reason, genVersion, wanted }: the towns did not load, this is the Wave-6 Savanna
    // WAVE 7: the Savanna city as built (null on the other maps): towngen's layout (towns, compounds, links, stats), the citykit list and what it placed, the
    // decals - read-only, for the gates (citycheck, placementcheck, perf_district) and for debugging
    city: city ? { version: city.TG.VERSION, layout: city.lay, looks: city.looks, skyline: city.skyline, landmarks: city.landmarks, stats: city.stats, kit: city.kit, kitStats: city.kitStats, paintStats: city.paintStats, lights: city.lights, footprints: cityBld, roads: cityRoadLog, furniture: city.furniture || null, houseVersion: city.HG ? city.HG.VERSION : null, cover: city.cover || null, coverPieces: city.coverPieces || null } : null,
    ground: { lattice: field.lat, latN: LAT_N, pitch: LAT_PITCH, pads: field.pads.length, corridors: field.corridors, corridorSegments: field.segs.length, bakeMs, roads: roadStats, roadSections: roadLog, padLog },
    // the look to restore to when the camera surfaces (underwater overrides it)
    fogSurface: { color: K.sky, density: K.fog },
  };
}

/** D2 (Savanna trees): a coarse copy of an indexed position + normal geometry by VERTEX CLUSTERING with quadric placement (Lindstrom / Garland-Heckbert): every vertex falls in a cell
 *  of (largest bbox extent / div); each cell keeps ONE vertex, put where the planes of the faces around it meet (the quadric minimum, pulled toward the cell's centroid by a small
 *  regulariser and clamped to the cell grown by half a cell) so a round trunk keeps its girth instead of shrinking to the centroid polygon; triangles that collapse are dropped,
 *  normals are re-derived from the surviving faces. Pure function of the input (Map insertion order = vertex order). The acacia's trunk (2,360 triangles) becomes ~560 at div 24. */
function clusterSimplify(geo, div) {
  const P = geo.attributes.position, I = geo.index;
  if (!I || !P || P.itemSize !== 3) return geo;
  const n = P.count;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const cell = Math.max(x1 - x0, y1 - y0, z1 - z0) / div;
  if (!(cell > 0)) return geo;
  const key = new Map(), cid = new Int32Array(n), cx = [], cy = [], cz = [], cn = [];
  for (let i = 0; i < n; i++) {
    const ix = Math.floor((P.getX(i) - x0) / cell), iy = Math.floor((P.getY(i) - y0) / cell), iz = Math.floor((P.getZ(i) - z0) / cell), k = (ix * 512 + iy) * 512 + iz;
    let c = key.get(k);
    if (c === undefined) { c = cn.length; key.set(k, c); cx.push(0); cy.push(0); cz.push(0); cn.push(0); }
    cid[i] = c; cx[c] += P.getX(i); cy[c] += P.getY(i); cz[c] += P.getZ(i); cn[c]++;
  }
  const m = cn.length, Q = new Float64Array(m * 10);              // the 10 unique terms of a symmetric 4x4 plane quadric: aa ab ac ad bb bc bd cc cd dd
  const idx = I.array, nt = I.count / 3;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a);
    const ux = P.getX(b) - ax, uy = P.getY(b) - ay, uz = P.getZ(b) - az, vx = P.getX(c) - ax, vy = P.getY(c) - ay, vz = P.getZ(c) - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(l > 1e-18)) continue;
    const w = l / 2; nx /= l; ny /= l; nz /= l;
    const d = -(nx * ax + ny * ay + nz * az), terms = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
    for (const v of [a, b, c]) { const o = cid[v] * 10; for (let j = 0; j < 10; j++) Q[o + j] += w * terms[j]; }
  }
  const rx = new Float32Array(m), ry = new Float32Array(m), rz = new Float32Array(m), reg = 1e-3;
  for (let c = 0; c < m; c++) {
    const o = c * 10, mx = cx[c] / cn[c], my = cy[c] / cn[c], mz = cz[c] / cn[c], tr = Q[o] + Q[o + 4] + Q[o + 7], lam = Math.max(tr, 1e-12) * reg;
    // (A + lam I) x = -b + lam * centroid     A = [[aa ab ac] [ab bb bc] [ac bc cc]]   b = [ad bd cd]
    const A00 = Q[o] + lam, A01 = Q[o + 1], A02 = Q[o + 2], A11 = Q[o + 4] + lam, A12 = Q[o + 5], A22 = Q[o + 7] + lam;
    const r0 = -Q[o + 3] + lam * mx, r1 = -Q[o + 6] + lam * my, r2 = -Q[o + 8] + lam * mz;
    const det = A00 * (A11 * A22 - A12 * A12) - A01 * (A01 * A22 - A12 * A02) + A02 * (A01 * A12 - A11 * A02);
    let sx = mx, sy = my, sz = mz;
    if (Math.abs(det) > 1e-30) {
      sx = (r0 * (A11 * A22 - A12 * A12) - A01 * (r1 * A22 - A12 * r2) + A02 * (r1 * A12 - A11 * r2)) / det;
      sy = (A00 * (r1 * A22 - A12 * r2) - r0 * (A01 * A22 - A12 * A02) + A02 * (A01 * r2 - r1 * A02)) / det;
      sz = (A00 * (A11 * r2 - r1 * A12) - A01 * (A01 * r2 - r1 * A02) + r0 * (A01 * A12 - A11 * A02)) / det;
    }
    const lim = cell * 0.75;
    rx[c] = Math.min(mx + lim, Math.max(mx - lim, sx)); ry[c] = Math.min(my + lim, Math.max(my - lim, sy)); rz[c] = Math.min(mz + lim, Math.max(mz - lim, sz));
  }
  const tri = [], seen = new Set();
  for (let t = 0; t < nt; t++) {
    const a = cid[idx[t * 3]], b = cid[idx[t * 3 + 1]], c = cid[idx[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    const so = [a, b, c].sort((p, q) => p - q), sk = (so[0] * m + so[1]) * m + so[2];          // (the same triangle twice is kept once)
    if (seen.has(sk)) continue;
    seen.add(sk); tri.push(a, b, c);
  }
  const pos = new Float32Array(m * 3), nor = new Float32Array(m * 3);
  for (let c = 0; c < m; c++) { pos[c * 3] = rx[c]; pos[c * 3 + 1] = ry[c]; pos[c * 3 + 2] = rz[c]; }
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nor[v * 3] += nx; nor[v * 3 + 1] += ny; nor[v * 3 + 2] += nz; }
  }
  for (let c = 0; c < m; c++) { const l = Math.hypot(nor[c * 3], nor[c * 3 + 1], nor[c * 3 + 2]) || 1; nor[c * 3] /= l; nor[c * 3 + 1] /= l; nor[c * 3 + 2] /= l; }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(new Uint16Array(tri), 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

/** Wave 7b stage B: clusterSimplify for a TEXTURED mesh (the palm samples a colour atlas): the same clusters and quadric positions, but a cluster is split by the atlas swatch its vertices
 *  sample (uv quantised to 1/64), each output vertex keeping a uv of its own swatch - clusterSimplify drops the uv, and the coarse palms sampled the atlas at (0, 0): pale grey trees. */
function clusterSimplifyUV(geo, div) {
  const UV = geo.attributes.uv, base = clusterSimplify(geo, div);
  if (!UV || base === geo) return base;
  // re-derive the cluster of every source vertex exactly as clusterSimplify did (same cell, same keys, same order), then split by uv swatch
  const P = geo.attributes.position, I = geo.index.array, n = P.count;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const cell = Math.max(x1 - x0, y1 - y0, z1 - z0) / div, key = new Map(), cid = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = (Math.floor((P.getX(i) - x0) / cell) * 512 + Math.floor((P.getY(i) - y0) / cell)) * 512 + Math.floor((P.getZ(i) - z0) / cell); let c = key.get(k); if (c === undefined) { c = key.size; key.set(k, c); } cid[i] = c; }
  const BP = base.attributes.position.array, outV = new Map(), pos = [], uv = [], tri = [], seen = new Set();
  const vOf = (i) => { const k = cid[i] * 4194304 + Math.round(UV.getX(i) * 64) * 2048 + Math.round(UV.getY(i) * 64); let o = outV.get(k); if (o === undefined) { o = pos.length / 3; outV.set(k, o); const c = cid[i]; pos.push(BP[c * 3], BP[c * 3 + 1], BP[c * 3 + 2]); uv.push(UV.getX(i), UV.getY(i)); } return o; };
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (cid[a] === cid[b] || cid[b] === cid[c] || cid[a] === cid[c]) continue;
    const va = vOf(a), vb = vOf(b), vc = vOf(c), so = [va, vb, vc].sort((p, q) => p - q), sk = so.join(",");
    if (seen.has(sk)) continue;
    seen.add(sk); tri.push(va, vb, vc);
  }
  const nor = new Float32Array(pos.length);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nor[v] += nx; nor[v + 1] += ny; nor[v + 2] += nz; }
  }
  for (let v = 0; v < nor.length; v += 3) { const l = Math.hypot(nor[v], nor[v + 1], nor[v + 2]) || 1; nor[v] /= l; nor[v + 1] /= l; nor[v + 2] /= l; }
  base.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(pos.length / 3 > 65535 ? new THREE.BufferAttribute(new Uint32Array(tri), 1) : new THREE.BufferAttribute(new Uint16Array(tri), 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return "#" + c.getHexString();
}
