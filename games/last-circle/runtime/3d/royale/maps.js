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
    sun: { pos: [90, 130, 60], color: 0xfff4e0, intensity: 2.05 }, hemi: { sky: 0xdcefff, ground: 0x86a06a, intensity: 1.25 } },
  ashgrid:   { name: "Savanna", theme: "savanna", sky: "#e5cf9f", zenith: "#6585ab", cloud: 0.54, fog: 0.0019, themeColor: "#e0854a", water: false,
    sun: { pos: [-120, 105, 45], color: 0xffe6b4, intensity: 2.25 }, hemi: { sky: 0xf0e3c4, ground: 0xb59a63, intensity: 1.15 } },
  deepwood:  { name: "Deepwood", theme: "forest", sky: "#acc5dc", zenith: "#506e9b", cloud: 0.72, fog: 0.0020, themeColor: "#7fb069", water: true,
    sun: { pos: [-60, 150, -80], color: 0xfff6e6, intensity: 1.95 }, hemi: { sky: 0xd2e7ff, ground: 0x63705a, intensity: 1.35 } },
};

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
const KIND_TEX = { shingle: shingleTex, plank: plankTex, metal: metalTex, block: blockTex };

function waterNormalTex(aniso) {
  if (_texCache.waterN) return _texCache.waterN;
  const t = _fieldTex("water_f", 256,
    (u, v) => _tfbm(u * 6, v * 6, 31, 3) * 0.6 + (Math.sin(u * 22 + v * 15) * 0.5 + 0.5) * 0.4,
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
export const MAP_GEN_VERSION = 3;                   // see map.genVersion (3 = Wave 7: Savanna's towns; an old client has no export and counts as 1)
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
    if (h > 58) return rgb(o, 0.42, 0.38, 0.36);                  // volcano rock
    if (h > 34) return rgb(o, 0.48 + n * 0.1, 0.44, 0.38);
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

export async function buildMap(W, mapId) {
  const K = MAPS[mapId] || MAPS.isla_viva;
  const seed = W.seed;
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
    kn.renderer.toneMappingExposure = 1.15;
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
          const ring = Math.abs(c.ci - ci) <= 1 && Math.abs(c.cj - cj) <= 1;
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
        const ring = Math.abs(c.ci - _lodCi) <= 1 && Math.abs(c.cj - _lodCj) <= 1;
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
    scaleBoxUV(geo, w, h, d, STRUCT_TILE);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, cy, cz);
    // batch key carries the texture KIND (opts.tex: shingle/plank/metal/block;
    // default "s" = the struct brick) — the merge loop below splits it back out
    const bkey = color + "|" + (opts.tex || "s");
    pushGeo(bkey, geo);
    if (opts.collide !== false) boxColliders(cx, cy, cz, w, h, d, opts.rotY || 0);
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
      if (f === 0) {
        const dw = 1.8;
        addBox(x - W2 / 2 - dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color, { tex: "block" });
        addBox(x + W2 / 2 + dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color, { tex: "block" });
        addBox(x, fy + FH - 0.5, z + W2, dw, 1, T, color, { tex: "block" });
        addBox(x, fy + FH / 2, z - W2, fw, FH, T, color, { tex: "block" });
        addBox(x - W2, fy + FH / 2, z, T, FH, fw, color, { tex: "block" });
        addBox(x + W2, fy + FH / 2, z, T, FH, fw, color, { tex: "block" });
      } else {
        addBox(x, SILL_Y, z + W2, fw, SILL_H, T, color, { tex: "block" }); addBox(x, HEAD_Y, z + W2, fw, HEAD_H, T, color, { tex: "block" });
        addBox(x, SILL_Y, z - W2, fw, SILL_H, T, color, { tex: "block" }); addBox(x, HEAD_Y, z - W2, fw, HEAD_H, T, color, { tex: "block" });
        addBox(x - W2, SILL_Y, z, T, SILL_H, fw, color, { tex: "block" }); addBox(x - W2, HEAD_Y, z, T, HEAD_H, fw, color, { tex: "block" });
        addBox(x + W2, SILL_Y, z, T, SILL_H, fw, color, { tex: "block" }); addBox(x + W2, HEAD_Y, z, T, HEAD_H, fw, color, { tex: "block" });
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
    addBox(x, y + floors * FH + 0.7, z + fw / 2 - 0.2, fw, 1.1, 0.35, shade(color, 0.6)); // parapet
    addBox(x, y + floors * FH + 0.7, z - fw / 2 + 0.2, fw, 1.1, 0.35, shade(color, 0.6));
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
    if (rng() < 0.6) chest(x, y + 0.6, z + len * 0.35, poi);
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
      it.y += Math.min(0.3, Math.max(0, hi - y0 + (PROP_EMBED[kind] || 0.1) - 0.85));
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
  const roadGeos = [];                                  // merged into one asphalt mesh after structures
  const roadQueue = [];                                 // { x0, z0, x1, z1, width } dry sections waiting for the bake
  const lotQueue = [];                                  // { cx, cz, w, d } parking lots waiting for the bake
  const ROAD_STEP = 2;      // metres between cross-sections (the lattice pitch is 2.63: the ribbon samples the ground at its own resolution)
  const ROAD_LIFT = 0.06;   // above the mesh; well under STEP_UP (0.55) either way
  const ROAD_XS = [-1, -0.5, 0, 0.5, 1];   // cross-section offsets, x half-width
  const ROAD_DRY = 0.35;    // a road section needs its centreline this far above the waterline
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
    const n = Math.max(1, Math.ceil(len / ROAD_STEP));
    const ux = dx / len, uz = dz / len;      // along
    const px = -uz, pz = ux;                 // perpendicular
    const hw = width / 2, W2 = ROAD_XS.length;
    const posA = new Float32Array((n + 1) * W2 * 3);
    const uvA = new Float32Array((n + 1) * W2 * 2);
    const idx = [];
    let k = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = x0 + dx * t, cz = z0 + dz * t;
      for (let j = 0; j < W2; j++) {
        const vx = cx + px * ROAD_XS[j] * hw, vz = cz + pz * ROAD_XS[j] * hw;
        // The ribbon's triangles span 2 m x 1.75 m, the lattice cells 2.63 m: on a CURVED stretch (a pad's falloff, a road cut into a slope) the
        // ground half-way between two vertices bulges above the straight chord and pokes through. A vertex is lifted by the largest bulge of
        // the chords that end at it (the ground at their midpoint minus the mean of their ends): 0 on a plane, so a slope costs nothing.
        const sa = len / n, sc = hw * 0.5, g0 = heightAt0(vx, vz);
        let lift = 0, b;
        b = heightAt0(vx + ux * sa * 0.5, vz + uz * sa * 0.5) - 0.5 * (g0 + heightAt0(vx + ux * sa, vz + uz * sa)); if (b > lift) lift = b;
        b = heightAt0(vx - ux * sa * 0.5, vz - uz * sa * 0.5) - 0.5 * (g0 + heightAt0(vx - ux * sa, vz - uz * sa)); if (b > lift) lift = b;
        b = heightAt0(vx + px * sc * 0.5, vz + pz * sc * 0.5) - 0.5 * (g0 + heightAt0(vx + px * sc, vz + pz * sc)); if (b > lift) lift = b;
        b = heightAt0(vx - px * sc * 0.5, vz - pz * sc * 0.5) - 0.5 * (g0 + heightAt0(vx - px * sc, vz - pz * sc)); if (b > lift) lift = b;
        posA[k * 3] = vx; posA[k * 3 + 1] = g0 + Math.min(0.15, lift * 0.4) + ROAD_LIFT; posA[k * 3 + 2] = vz;
        uvA[k * 2] = vx / ROAD_TILE; uvA[k * 2 + 1] = vz / ROAD_TILE;   // world-planar, same texel density as before
        k++;
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < W2 - 1; j++) {
      const a = i * W2 + j, b = a + 1, c = a + W2, dI = c + 1;
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
    for (const r of roadQueue) { roadRibbon(r.x0, r.z0, r.x1, r.z1, r.width); roadLog.push(r); }
    for (const l of lotQueue) lotPlane(l.cx, l.cz, l.w, l.d);
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
    const y = groundPad(x, z, (rc * (w + 0.7) + rs * (d + 0.7)) / 2 + 0.05, (rs * (w + 0.7) + rc * (d + 0.7)) / 2 + 0.05, { gen: "house" });
    const segW = w / 2 - doorW / 2, segD = d / 2 - winW / 2;
    const jamb = d / 4 + winW / 4, pier = w / 4 + doorW / 4;
    // WAVE 7 (7A2) `o.style`: a styled building (the Savanna city's) gets facade windows, a roof shape, a canopy / awning and a chimney, all cosmetic (no collider),
    // and its door is 2.7 m under the lintel whatever its height (a two-storey house or a shop would otherwise have a 6 m door; the wall above is filled in).
    const st = (o && o.style) || null;
    addBoxR(x, z, -pier, -d / 2, y + H / 2, segW, H, T, wallC, rot);                // back, L of back door
    addBoxR(x, z, pier, -d / 2, y + H / 2, segW, H, T, wallC, rot);                 // back, R of back door
    addBoxR(x, z, 0, -d / 2, st ? y + 3.05 : y + H - 0.35, doorW, 0.7, T, wallC, rot);              // back door lintel
    if (st && H > 3.4 + 1e-6) addBoxR(x, z, 0, -d / 2, y + (3.4 + H) / 2, doorW, H - 3.4, T, wallC, rot);
    for (const sx of [-1, 1]) {                                                     // side walls with a window band
      addBoxR(x, z, sx * w / 2, -jamb, y + H / 2, T, H, segD, wallC, rot);
      addBoxR(x, z, sx * w / 2, jamb, y + H / 2, T, H, segD, wallC, rot);
      addBoxR(x, z, sx * w / 2, 0, y + 0.60, T, 1.20, winW, wallC, rot);            // sill  (y+0.00..y+1.20)
      if (o && o.H) addBoxR(x, z, sx * w / 2, 0, y + 2.30 + (H - 2.30) / 2, T, H - 2.30, winW, wallC, rot);   // header (y+2.30..y+H)
      else addBoxR(x, z, sx * w / 2, 0, y + 2.85, T, 1.10, winW, wallC, rot);       // header (y+2.30..y+3.40)
    }
    addBoxR(x, z, -pier, d / 2, y + H / 2, segW, H, T, wallC, rot);                 // front L of door
    addBoxR(x, z, pier, d / 2, y + H / 2, segW, H, T, wallC, rot);                  // front R of door
    addBoxR(x, z, 0, d / 2, st ? y + 3.05 : y + H - 0.35, doorW, 0.7, T, wallC, rot);               // door lintel
    if (st && H > 3.4 + 1e-6) addBoxR(x, z, 0, d / 2, y + (3.4 + H) / 2, doorW, H - 3.4, T, wallC, rot);
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
    if (st.chimney) addBoxR(x, z, st.chimney * w * 0.3, -d * 0.2, ry + (st.roof === 2 ? 0.9 : 1.2), 0.9, st.roof === 2 ? 1.8 : 2.4, 0.9, shade(wallC, 0.72), rot, NC);
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
      if (f > 0) for (const sx of [-1, 1]) addBoxR(x, z, sx * x1, 0, wy, 0.05, 1.15, 1.2, glass, rot, NC);   // an upper storey's side windows (the ground floor's are the apertures)
    }
    if (st.shopfront) {                                                                   // glass front: one tall pane in each pier, a sign band over the door
      const gw = Math.max(0.8, segW - 0.5);
      for (const sx of [-1, 1]) addBoxR(x, z, sx * pier, z1, y + 1.55, gw, 2.0, 0.05, glass, rot, NC);
      addBoxR(x, z, 0, z1 + 0.04, y + 3.78, Math.min(w - 0.6, doorW + 2.4), 0.5, 0.08, st.sign || shade(roofC, 0.9), rot, NC);
    }
    if (st.awning) {
      const aw = Math.min(w - 0.8, w * 0.82);
      addBoxR(x, z, 0, d / 2 + 0.85, y + 3.2, aw, 0.1, 1.7, st.awning, rot, NC);
      addBoxR(x, z, 0, d / 2 + 1.72, y + 3.0, aw, 0.32, 0.08, shade(st.awning, 0.8), rot, NC);
    } else if (st.porch) {
      addBoxR(x, z, 0, d / 2 + 0.8, y + 2.85, doorW + 1.0, 0.14, 1.6, shade(roofC, 0.92), rot, NC);
    }
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
  const cityBld = [];               // [x0, z0, x1, z1]: every town / compound building footprint (and kit shells): wild loot and portals keep out
  const cityRoadLog = [];           // [x0, z0, x1, z1, width]: every street and link, for the grass mask and the minimap
  let city = null;                  // { TG, CK, lay, kit: [citykit list], stats } - set in the ashgrid branch
  const inRects = (list, x, z, pad) => { for (let i = 0; i < list.length; i++) { const r = list[i]; if (x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad) return true; } return false; };
  const inCity = (x, z, pad) => cityFoot.length > 0 && inRects(cityFoot, x, z, pad || 0);
  const SAV = {
    walls: { house: ["#d9c7a5", "#cfae86", "#c4966f", "#e2d8c3", "#b3ad94", "#cba08f", "#bfa27a"], shop: ["#d8a766", "#86a9b9", "#c4b88d", "#cf8068", "#a9b7a0", "#d6c08a"],
      big: ["#8fa4b8", "#a7b3bd", "#c6b79c", "#9fae9d", "#b69883", "#8197ad", "#b9b5aa", "#7b8fa3", "#a89684"], hall: ["#b8ad94", "#a5a79b", "#c3b49a", "#9b9a8c"], shed: ["#a68f62", "#b08968", "#93805e"],
      barn: ["#a8553c", "#8f4a38", "#b9a27a", "#7e6a58"],
      core: ["#6d8aa5", "#5f7a93", "#7d93a8", "#8a7a6c", "#9aa8b4", "#6e7c8a", "#b09a84", "#74897b"] },     // (downtown towers: deeper, glassier tones than the town walls so the skyline reads from the plane, none so dark it goes black in shade)
    roofs: ["#b5643c", "#9a4a36", "#7b5a48", "#8a6a50", "#a8523a", "#6c5a52", "#c07a48", "#5e6b73", "#8b5a3c", "#a3452f"],
    awnings: ["#c0563a", "#3a7a9a", "#d6a23a", "#5a8a5a", "#9a3a4a", "#d8d2c0"],
    glass: ["#34495e", "#2f4256", "#3d5266", "#2b3b4a"],
    mullions: ["#323c48", "#3a4a5a", "#2c3a30", "#4a3a34", "#2f3a52"],
    fences: [["#9a7a4a", 1.0], ["#d9d2c0", 1.1], ["#7d8288", 1.3], ["#6b4f33", 0.9]],
    // [floor-item chance, chest chance] per building. 7A2: the city has 40 % more buildings than stage A and a chest is TWO draw calls (base + lid, no instancing): the chest chances are
    // about 60 % of stage A's so a downtown view does not pay 30 calls for chests (seed 1: 18 chests in the drop view); floor items keep their stage-A odds
    loot: { house: [0.5, 0.12], shop: [0.8, 0.2], hall: [0.9, 0.3], shed: [0.35, 0.05], cmpHouse: [0.40, 0.12], cmpShed: [0.30, 0.05] },   // (the ~60 wild spots that moved: 30 compounds x ~2 points)
    tower: { core: { loot: 0.75, chest: 0.33, mullion: "#323c48" }, town: { loot: 0.6, chest: 0.25, mullion: "#3a3f46" } },
  };
  const SHELL_CENTRE = { "suburban/building-type-q": [0, 0.15] };   // the only kit building whose visual box is not centred on its origin (manifest bbox_min_m / bbox_max_m)
  const CITY_SW_LIFT = 0.10, CITY_MK_LIFT = 0.115;   // sidewalk and paint heights over the ground (the road ribbon is ROAD_LIFT = 0.06 over it)

  // WAVE 7 (7A2): the import is tried twice. A browser remembers a FAILED module fetch under its URL, so the retry asks for the same two files under another URL
  // (`&retry=1`: neither file imports anything, so it is the same code; it still carries the boot module's ?v=). If both tries fail the match is still played on
  // the Wave-6 Savanna layout - but then THIS client builds a different world from a squad host that loaded the towns, and the squad guard (which compares the
  // exported MAP_GEN_VERSION in the lobby, before any map exists) cannot see it. So the fallback is loud: console.error, `map.genVersion` = MAP_GEN_VERSION - 1,
  // `map.fallback` = { reason, genVersion, wanted }, and a "mapFallback" event on W.events (see the end of buildMap).
  let cityFallback = null;
  async function prepareCity() {
    let TG, CK, err = null;
    for (let attempt = 0; attempt < 2 && !TG; attempt++) {
      try {
        if (attempt) await new Promise((res) => setTimeout(res, 400));
        const q = attempt ? _V + (_V ? "&" : "?") + "retry=1" : _V;
        [TG, CK] = await Promise.all([import("./towngen.js" + q), import("./citykit.js" + q)]);
      } catch (e) { err = e; TG = CK = undefined; console.warn("[maps] the town generator did not load (try " + (attempt + 1) + " of 2):", e && e.message || e); }
    }
    if (!TG) {
      cityFallback = { reason: String(err && err.message || err || "import failed").slice(0, 200), genVersion: MAP_GEN_VERSION - 1, wanted: MAP_GEN_VERSION };
      console.error("[maps] towngen.js / citykit.js failed to load twice: Savanna is built on its Wave-6 layout (genVersion " + cityFallback.genVersion + ", not " + MAP_GEN_VERSION + "); a squad host with the towns builds a different map.");
      return null;
    }
    // landmarks that stay: the overpass (pillars, decks, the access ramp, the station) and the crane with its jib ramp
    const op = pois.find((q) => q.id === "overpass"), cr = pois.find((q) => q.id === "crane");
    const reserve = [[op.x - 106, op.z - 8, op.x + 108, op.z + 8], [cr.x - 6, cr.z - 20, cr.x + 10, cr.z + 24]];
    const lay = TG.layoutMap(seed, "ashgrid", pois.map((q) => ({ id: q.id, x: q.x, z: q.z, r: q.r })), baseH, waterY, { reserve });
    const HP = TG.PITCH / 2;
    for (const T of lay.towns) for (const b of T.blocks) cityFoot.push([b.cx - HP - 5, b.cz - HP - 5, b.cx + HP + 5, b.cz + HP + 5]);
    for (const T of lay.compounds.concat(lay.towns.filter((q) => !q.blocks.length && q.compound && q.parcels.length))) { const q = T.compound.bounds; cityFoot.push([q[0] - 6, q[1] - 6, q[2] + 6, q[3] + 6]); }   // (a POI whose grid did not fit falls back to a lane cluster)
    for (const T of lay.towns.concat(lay.compounds)) for (const p of T.parcels) if (p.building) { const a = p.building.aabb; cityBld.push([a[0], a[1], a[2], a[3]]); }
    for (const T of lay.compounds) for (const q of T.compound.props) cityBld.push(q.kind === "container" ? [q.x - 3.4, q.z - 3.4, q.x + 3.4, q.z + 3.4] : [q.x - 5, q.z - 5, q.x + 5, q.z + 5]);   // (silo / water tower / containers: wild loot keeps out)
    return { TG, CK, lay, kit: [], stats: lay.stats, lights: 0, kitStats: null };
  }
  // the streets and the links between towns go into the ground field NOW (before any pad), as ROAD_W-wide corridors
  function registerCityRoads() {
    const { TG, lay } = city;
    for (const T of lay.towns) for (const s of T.roads.streets) { road(s.x0, s.z0, s.x1, s.z1, TG.ROAD_W); cityRoadLog.push([s.x0, s.z0, s.x1, s.z1, TG.ROAD_W]); }
    for (const l of lay.links) { road(l.ax, l.az, l.bx, l.bz, TG.ROAD_W); cityRoadLog.push([l.ax, l.az, l.bx, l.bz, TG.ROAD_W]); }
  }
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
        if (T.compound && T.parcels.length) { const q = T.compound.bounds, r = [q[0], q[1], q[2], q[3]]; groundPad((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, { gen: "yard", level: medianOf([r]) }); }
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
  function buildCityBuildings() {
    const { TG, lay } = city;
    const cell = 600;                     // (7A2: compounds share a district per 600 m cell, was 300 m: a compound is 3-5 small buildings, and every district costs 2-3 structure draw calls (twice with the shadow pass) in every view that sees it - 9 compound districts were 36 calls of a seed-1 drop view)
    city.looks = new Map();               // "<town>:<parcel>" -> one string naming everything that distinguishes the building's look (the gates count distinct looks per town)
    padReuse = true;
    for (const T of lay.towns.concat(lay.compounds)) {
      const isCmp = T.id.startsWith("cmp"), grid = T.blocks.length > 0, clus = !!T.compound && !grid;     // clus: a compound, or a POI whose grid did not fit (a lane)
      const c0 = isCmp ? [T.compound.entry.x, T.compound.entry.z] : T.centre;
      const did = isCmp ? "cmp:" + Math.floor((c0[0] + HALF) / cell) + "," + Math.floor((c0[1] + HALF) / cell) : "town:" + T.id;
      useDistrict(did);
      const dim = T.theme === "ruin" ? 0.8 : 1;
      const core = T.kind === "core";
      const blockLoot = new Map(), blockHome = new Map();       // block id -> loot points it holds / its first enterable building (every block ends up holding loot)
      for (const p of T.parcels) {
        const b = p.building;
        if (!b) continue;
        const nLoot0 = lootPoints.length + chestPoints.length;
        const wallKey = b.arch === "shop" ? "shop" : (b.gen === "tower" ? "big" : b.use === "barn" ? "barn" : b.use === "hall" ? "hall" : b.use === "shed" ? "shed" : "house");
        const PAL = cityPalette(T, isCmp ? -1 : p.block, core), cr = TG.subRng(seed, T.id, "col" + p.id), sr = TG.subRng(seed, T.id, "sty" + p.id);
        const q1 = cr(), q2 = cr(), q3 = cr();
        const wallC = shade(q1 < 0.55 ? PAL[wallKey][0] : q1 < 0.84 ? PAL[wallKey][1] : SAV.walls[wallKey][Math.floor(q3 * SAV.walls[wallKey].length)], dim);
        const roofC = shade(q2 < 0.5 ? PAL.roof[0] : q2 < 0.84 ? PAL.roof[1] : SAV.roofs[Math.floor(q3 * SAV.roofs.length)], dim);
        let look = wallC + roofC;
        if (b.gen === "shell") {
          const ctr = SHELL_CENTRE[b.kit] || [0, 0], q = b.turn, cs = [1, 0, -1, 0][q], sn = [0, 1, 0, -1][q];
          const hx = (b.aabb[2] - b.aabb[0]) / 2, hz = (b.aabb[3] - b.aabb[1]) / 2, y = groundPad(b.cx, b.cz, hx, hz, { gen: "shell" });
          city.kit.push({ type: b.kit, x: b.cx - (ctr[0] * cs + ctr[1] * sn), y, z: b.cz - (-ctr[0] * sn + ctr[1] * cs), rot: q, district: did, palette: b.palette && b.palette.variant ? b.palette.variant : undefined });
          look = b.kit + "|" + (b.palette && b.palette.variant || "");
        } else if (b.gen === "tower") {
          const base = core ? SAV.tower.core : SAV.tower.town, mull = SAV.mullions[Math.floor(sr() * SAV.mullions.length)];
          const y = towerTurn(b.cx, b.cz, b.floors, b.w, wallC, T.id, b.turn, { loot: base.loot, chest: base.chest, mullion: mull });
          towerCrown(b, y, sr, core);
          look += mull + b.floors + "x" + b.w;
        } else {
          const lt = isCmp ? (b.use === "shed" ? SAV.loot.cmpShed : SAV.loot.cmpHouse) : (SAV.loot[b.use] || SAV.loot.house);
          const o = { loot: lt[0], chest: lt[1], doorW: 2.26 };       // the 2.26 m door of the layout (wallDoorwayWide): a 1.4 m door leaves a capsule 0.5 m a side
          const fh = b.floorH || 3.4;
          const storeys = (b.use === "house" || b.use === "shop") && b.floors >= 2 && sr() < 0.75 ? 2 : 1;      // a two-storey front on the big houses and shops (one real floor inside until Wave 8)
          const st = { storeys, floorH: fh, glass: SAV.glass[Math.floor(sr() * SAV.glass.length)] };
          if (b.use === "shop") { st.shopfront = true; st.roof = 2; st.awning = sr() < 0.75 ? (sr() < 0.6 ? PAL.awning[0] : PAL.awning[1]) : null; st.sign = shade(roofC, 0.9); st.unit = sr() < 0.4 ? (sr() < 0.5 ? -1 : 1) : 0; }
          else if (b.use === "hall") { st.roof = 2; st.blindBack = true; st.unit = sr() < 0.6 ? 1 : 0; }
          else if (b.use === "barn") { st.roof = 0; st.blindBack = true; }
          else if (b.use === "shed") { st.roof = sr() < 0.5 ? 0 : 1; st.blindBack = true; }
          else { const rr = sr(); st.roof = rr < 0.42 ? 0 : rr < 0.64 ? 1 : rr < 0.8 ? 3 : 2; st.chimney = sr() < 0.4 ? (sr() < 0.5 ? -1 : 1) : 0; st.porch = sr() < 0.55; st.unit = st.roof === 2 && sr() < 0.5 ? 1 : 0; }
          o.style = st;
          o.H = fh * storeys;
          o.flat = st.roof === 2;
          house(b.cx, b.cz, b.w, b.d, b.rot, wallC, roofC, T.id, o);
          look += st.roof + "" + storeys + (st.chimney ? "c" : "") + (st.porch ? "p" : "") + (st.awning || "") + b.w + "x" + b.d + st.glass;
        }
        city.looks.set(T.id + ":" + p.id, look);
        blockLoot.set(p.block, (blockLoot.get(p.block) || 0) + (lootPoints.length + chestPoints.length - nLoot0));
        if (b.enterable && b.gen !== "shell" && !blockHome.has(p.block)) blockHome.set(p.block, b);
      }
      for (const [bid, home] of blockHome) if (!blockLoot.get(bid)) loot(home.cx, heightAt0(home.cx, home.cz) + 0.5, home.cz, T.id);   // a block the dice left empty gets one floor item
      if (clus) {
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
      }
      if (grid) {
        // pocket parks get two acacias (the map's own instanced tree, with its baked trunk collider), at two of the lot's four corners
        for (const p of T.parcels) {
          if (p.use !== "lot" || p.lot !== "park") continue;
          const tr = TG.subRng(seed, T.id, "tree" + p.id), r = p.rect, cx4 = [[r[0] + 5, r[1] + 5], [r[2] - 5, r[1] + 5], [r[0] + 5, r[3] - 5], [r[2] - 5, r[3] - 5]];
          for (let k = 0; k < 2; k++) {
            const c = cx4.splice(Math.floor(tr() * cx4.length), 1)[0], sc = 0.85 + tr() * 0.4, ry = tr() * Math.PI * 2;
            props.tree.push({ x: c[0], y: heightAt0(c[0], c[1]), z: c[1], s: sc, ry });
          }
        }
        // back-yard acacias (7A2): a house, and a shop with room behind it, in a town or village block gets one at a back corner of its lot, 45 % of the time
        if (!core) for (const p of T.parcels) {
          const b = p.building;
          if (!b || b.gen === "shell" || b.gen === "tower" || (b.use !== "house" && b.use !== "shop")) continue;
          const tr = TG.subRng(seed, T.id, "yard" + p.id);
          if (tr() > 0.45) continue;
          const r = p.rect, [fx, fz] = p.facing, a = b.aabb, ux = tr() < 0.5 ? 1 : -1;
          const tx = fz ? (ux > 0 ? r[2] - 2.6 : r[0] + 2.6) : (fx > 0 ? r[0] + 2.6 : r[2] - 2.6), tz = fz ? (fz > 0 ? r[1] + 2.6 : r[3] - 2.6) : (ux > 0 ? r[3] - 2.6 : r[1] + 2.6);
          if (tx > a[0] - 2.4 && tx < a[2] + 2.4 && tz > a[1] - 2.4 && tz < a[3] + 2.4) continue;          // (the building's own footprint, with a crown's room)
          props.tree.push({ x: tx, y: heightAt0(tx, tz), z: tz, s: 0.8 + tr() * 0.35, ry: tr() * Math.PI * 2 });
        }
        // street dressing: kit lights, hydrants, benches, planters, parked cars, lot dressing (towngen's data; y = the ground each one stands on)
        for (const e of TG.streetProps(T, seed)) {
          const onRoad = e.kind === "car", y = cityKitY(e.type, e.x, e.z, e.rot, onRoad ? ROAD_LIFT - 0.02 : CITY_SW_LIFT - 0.01);
          city.kit.push({ type: e.type, x: e.x, y, z: e.z, rot: e.rot, district: did, tint: e.tint });
          if (e.kind === "light") { const fa = [[0, 1], [1, 0], [0, -1], [-1, 0]][e.rot]; lampPts.push({ x: e.x - fa[0] * 1.6, y: y + (e.type === "props/light-square" ? 5.2 : 5.9), z: e.z - fa[1] * 1.6 }); city.lights++; }
        }
      }
    }
    sink = batches;
    padReuse = false;
    for (const it of city.kit) for (const c of city.CK.colliderFor(it.type, it.x, it.y, it.z, it.rot)) cityKitBoxes.push(c);
  }
  // rooftop dressing of an enterable tower: a pair of units on the roof's -X side (away from the chest in the middle and the access ramp along +X) and, on a core
  // tower, an antenna mast. Cosmetic, no collider; the dice are the parcel's own style stream.
  function towerCrown(b, y, sr, core) {
    const ry = y + b.floors * 4 + 0.3, rot = b.rot, fw = b.w, NC = { collide: false };
    const u1 = sr(), u2 = sr(), u3 = sr(), mast = sr();
    addBoxR(b.cx, b.cz, -fw * 0.3, -fw * 0.28, ry + 0.55, 1.9, 1.1, 1.4, "#8f969c", rot, NC);
    if (u1 < 0.7) addBoxR(b.cx, b.cz, -fw * 0.3, fw * 0.08 + u2 * fw * 0.1, ry + 0.45, 1.3, 0.9, 1.3, "#a6acb1", rot, NC);
    if (u3 < 0.35) addBoxR(b.cx, b.cz, -fw * 0.12, -fw * 0.3, ry + 1.1, 2.2, 2.2, 2.2, shade("#8d949a", 0.9), rot, NC);      // a stair / lift head
    if (core ? mast < 0.6 : mast < 0.2) {
      const mh = 3 + u2 * 5;
      addBoxR(b.cx, b.cz, -fw * 0.34, fw * 0.3, ry + mh / 2, 0.28, mh, 0.28, "#5d6268", rot, NC);
      addBoxR(b.cx, b.cz, -fw * 0.34, fw * 0.3, ry + mh * 0.8, 1.6, 0.16, 0.16, "#5d6268", rot, NC);
    }
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
    const quad = (T, x0, z0, x1, z1, lift, hex) => {
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
    const LOTC = { parking: "#55585d", park: "#7f9a58", yard: "#a9a18c" };
    // 7A2: the sidewalk ring is the lightest thing in a town (it frames every block against the dark asphalt from the plane); the ground inside a block is not one
    // plaza any more: each BUILT parcel has its own paving / packed earth / dry-lawn tone (a hash of its id), the industrial yards a darker concrete.
    const RING = "#cdc7b6", PLAZA = "#a39d8d", WHITE = "#efece0";
    const PARCEL_TONES = { core: ["#a39d8d", "#9a968a", "#aaa596", "#9fa095"], town: ["#aaa58f", "#a39f86", "#b2a98e", "#9c9d86", "#a7a490", "#b5ae98"], yard: ["#8e8c84", "#999690", "#85857f"] };
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
      for (const e of T.roads.edges) {
        const A = N[e.a], B = N[e.b], len = e.len, ux = e.axis === "x" ? Math.sign(B.x - A.x) : 0, uz = e.axis === "z" ? Math.sign(B.z - A.z) : 0;
        for (let t = 11.5; t + 3 <= len - 11.5 + 1e-6; t += 6) {
          const ax = A.x + ux * t, az = A.z + uz * t, bx = A.x + ux * (t + 3), bz = A.z + uz * (t + 3);
          strip(paint, Math.min(ax, bx) - (uz ? 0.1 : 0), Math.min(az, bz) - (ux ? 0.1 : 0), Math.max(ax, bx) + (uz ? 0.1 : 0), Math.max(az, bz) + (ux ? 0.1 : 0), CITY_MK_LIFT, WHITE);
        }
        if (len >= 24) { legs.set(e.a + ":" + ux + ":" + uz, [A, ux, uz]); legs.set(e.b + ":" + -ux + ":" + -uz, [B, -ux, -uz]); }
      }
      for (const [, [n, dx, dz]] of legs) {
        for (let k = -3; k <= 3; k++) {
          const cx = n.x + dx * 7.7 + (-dz) * k * 1.25, cz = n.z + dz * 7.7 + dx * k * 1.25, hl = dx ? 1.5 : 0.28, hw = dx ? 0.28 : 1.5;
          quad(paint, cx - hl, cz - hw, cx + hl, cz + hw, CITY_MK_LIFT, WHITE);
        }
      }
    }
    // a compound's yard is packed earth: a decal over its rectangle (the fence and the houses stand around it)
    for (const T of lay.compounds.concat(lay.towns.filter((q) => !q.blocks.length && q.compound))) {
      const y = T.compound.yard;
      const nx = Math.max(1, Math.round((y[2] - y[0]) / 2.5)), nz = Math.max(1, Math.round((y[3] - y[1]) / 2.5));
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) quad(slab, y[0] + (y[2] - y[0]) * i / nx, y[1] + (y[3] - y[1]) * j / nz, y[0] + (y[2] - y[0]) * (i + 1) / nx, y[1] + (y[3] - y[1]) * (j + 1) / nz, CITY_SW_LIFT, "#d9c18f");
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
      try { const gt = groundTex(aniso); mat.map = gt.map; mat.normalMap = gt.normal; mat.normalScale = new THREE.Vector2(0.3, 0.3); } catch (e) { /* flat vertex colour */ }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = name;
      g.add(mesh);
    };
    emit(slab, "city:ground", -1);
    emit(paint, "city:paint", -3);
    city.paintStats = { slabQuads: slab.idx.length / 6, paintQuads: paint.idx.length / 6 };
  }
  // roads, blocks and buildings on the minimap canvas (the HUD draws the town names from map.pois)
  function drawCityOnMinimap(ctx) {
    const S = 512 / SIZE, X = (x) => (x + HALF) * S;
    ctx.save && ctx.save();
    ctx.globalAlpha = 1;
    for (const T of city.lay.towns) for (const b of T.blocks) { ctx.fillStyle = T.kind === "core" ? "#e0d8bf" : "#cfc8b4"; ctx.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); }
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
    return m;
  }
  // The district meshes (every town and compound has one per texture kind, with its own bounding sphere): three already frustum-culls them, so what is left is
  // the DISTANCE: beyond 1,100 m the fog has taken 95 % of a district (FogExp2 0.0019) and it is not drawn at all, and a district more than 170 m from the camera
  // casts no shadow (the sun's shadow camera covers +-55 m around the player; a mesh outside it was already culled from that pass, this also keeps a spectator's
  // or the plane's far camera from re-drawing every district's walls into the depth map). Checked twice a second, for the districts only (~40 meshes).
  function installCityCull() {
    const meshes = [];
    g.traverse((o) => { if (o.isMesh && o.userData.district) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); meshes.push(o); } });
    if (!meshes.length) return;
    let t = 9;
    trackUpdater((dt) => {
      t += dt; if (t < 0.5) return; t = 0;
      const cam = W.camera; if (!cam) return;
      for (const m of meshes) {
        const bs = m.geometry.boundingSphere, dx = bs.center.x - cam.position.x, dy = bs.center.y - cam.position.y, dz = bs.center.z - cam.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - bs.radius;
        m.visible = d < 1100;
        m.castShadow = d < 170;
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
        for (let i = 0; i < 4; i++) {
          const rx = x + (rng() - 0.5) * 14, rz = z + (rng() - 0.5) * 14, ry2 = heightAt0(rx, rz);
          const fw = 3.5 + rng() * 3, fh = 2.2 + rng() * 1.4, fc = shade(wallCs[0], 0.8 + Math.floor(rng() * 4) * 0.1), fr = rng() * Math.PI;   // same draws, same order
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
      const w = 6.2 - i * 0.7, hw = w / 2, c = i % 2 ? "#dcdcdc" : "#c23b3b", cy = y + i * sh + sh / 2;
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
    buildRoads(7);                                // connect every POI into a road network (cosmetic ribbons; the corridors go into the ground NOW, before anything is built on them)
    // C-PAD ORDER: three towers below (the Cliff Temples keep, the Coco Village market hall, the volcano-rim observatory) are built AFTER things that
    // stand where their pads reshape the ground (the five temple cubes and their ramps, the rim slabs). Their pads - the very rectangles tower()
    // asks for, so tower() finds them and builds on the same level - are laid first, under the same dry-land conditions.
    if (baseH(pois[4].x, pois[4].z) > waterY + 0.8) groundPad(pois[4].x, pois[4].z, 12 / 2 + 0.4, 12 / 2 + 0.4, { gen: "tower" });
    if (baseH(pois[1].x, pois[1].z - 40) > waterY + 0.8) groundPad(pois[1].x, pois[1].z - 40, 14 / 2 + 0.4, 14 / 2 + 0.4, { gen: "tower" });
    if (baseH(pois[2].x - 88, pois[2].z + 30) > waterY + 0.8) groundPad(pois[2].x - 88, pois[2].z + 30, 11 / 2 + 0.4, 11 / 2 + 0.4, { gen: "tower" });
    // villages → real towns (houses on a street with front doors to the road)
    town(pois[0], [C_WOODP, C_BAMBOO], "#c0563a", { along: "z", nPer: 4, signature: "depot" });        // Palm Bay
    town(pois[1], [C_BAMBOO, C_WOODP], "#cf6b3a", { along: "x", nPer: 5 });                            // Coco Village (its market hall is the tower below)
    town(pois[6], [C_WOODP, C_BAMBOO], "#b5503a", { along: "x", nPer: 4, layout: "crossroads" });       // Jungle Market
    farmland(pois[7], { minH: 0.6 });                                          // Banana Farm → actual farmland
    lighthouse(pois[3].x - 55, pois[3].z + 55, pois[3].id);                     // Shipwreck Cove lighthouse (coastal landmark)
    // cliff temples: stone block structures
    const templeBlockers = [];       // the cubes' caps and their ramp planks, [x0, x1, z0, z1]: the keep's roof ramp keeps clear of them
    {
      const p = pois[4];
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
      const keepOn = baseH(p.x, p.z) > waterY + 0.8;                         // the keep below is only built on dry ground
      const keep = keepOn ? [p.x - 6.8, p.x + 8.9, p.z - 6.8, p.z + 6.8] : null;   // its walls (+- 6.2), plus its exterior roof ramp along the +X wall, plus a capsule
      for (let i = 0; i < 5; i++) {
        const { x, z, s } = temples[i];
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
    if (baseH(pois[4].x, pois[4].z) > waterY + 0.8) tower(pois[4].x, pois[4].z, 3, 12, C_STONE, pois[4].id, templeBlockers);          // Cliff Temples keep
    if (baseH(pois[1].x, pois[1].z - 40) > waterY + 0.8) tower(pois[1].x, pois[1].z - 40, 2, 14, C_BAMBOO, pois[1].id); // Coco Village market hall
    // Volcano Rim: an r=130 named landing zone that emitted FOUR CHESTS and no
    // geometry at all — and because scatterTrees rejects nearPoi(x, z, 26) it also
    // cleared every tree out to 156 m, so the drop screen advertised a place that
    // was bare open slope. Worse, the chests sat on a 150 m ring, i.e. OUTSIDE the
    // circle they belong to. Obsidian slabs on the rim for cover (Rubble Row's
    // fragment pattern retinted, same quantised shade so the batch key stays
    // stable), an observatory to hold, and the chests pulled inside the POI.
    {
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
    // shipwreck: hull from planks
    {
      const p = pois[3]; const y = waterY + 0.2;
      addBox(p.x, y + 1.6, p.z, 6, 3.2, 18, "#7a5233", { rotY: 0.6 });
      addBox(p.x + 3, y + 4.2, p.z + 2, 0.5, 6, 0.5, "#6b4326", { rotY: 0.6 });
      addRamp(p.x - 4.2, y, p.z - 8.6, 2.4, 3.5, 7.5, 2, "#6b4326"); // boarding plank to the deck chest
      // the two loose points used to sit 6.7 m off the hull centreline, inside the old rotated-AABB phantom
      // wall; the hull collider is its true outline now, so they would hover over open water. Hull-local
      // (+1.4, -4.5) / (-1.4, +4.5) puts them on the deck (rotY 0.6: x' = lx c + lz s, z' = -lx s + lz c).
      const wc = Math.cos(0.6), ws = Math.sin(0.6);
      chest(p.x, y + 3.4, p.z, p.id);
      chest(p.x + 1.4 * wc - 4.5 * ws, y + 3.4, p.z - 1.4 * ws - 4.5 * wc, p.id);
      loot(p.x - 1.4 * wc + 4.5 * ws, y + 4.0, p.z + 1.4 * ws + 4.5 * wc, p.id);
    }
    // docks
    pier(120, 640, 22, 0.2, C_WOODP, "lagoon_docks");
    pier(160, 610, 16, -0.3, C_WOODP, "lagoon_docks");
    // (90,590) is below sea level on every seed sampled; hut() now stilts itself
    // over water, so the shack stays ON the dock instead of being ring-searched
    // up to 56 m inland (which still landed in water on 89.2% of seeds anyway).
    hut(90, 590, 5, 4.4, 0, C_WOODP, "lagoon_docks");
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
      for (let k = 0; k < 6; k++) {
        const kx = p.x + (rng() - 0.5) * p.r * 1.6, kz = p.z + (rng() - 0.5) * p.r * 1.6;
        const n = 5 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const x = kx + (rng() - 0.5) * 22, z = kz + (rng() - 0.5) * 22;
          const y = heightAt0(x, z);
          // The tint is QUANTISED to 4 steps on purpose: addBox keys its batches by
          // the colour string and shade() returns a hex, so a continuous multiplier
          // gave every wall a unique key — one merged mesh each, with its own
          // MeshStandardMaterial + map + normalMap, for one pile of rubble.
          // This is the only shade() call site in the file that passes a random k.
          const fw = 3.5 + rng() * 3, fh = 1.8 + rng() * 1.6, fc = shade(C_BRICKB, 0.8 + Math.floor(rng() * 4) * 0.1), fr = rng() * Math.PI;   // same draws, same order
          if (inCity(x, z, 3)) continue;                    // (Wave 7: no rubble inside the village's blocks)
          addBox(x, Math.min(y + 0.9, lowGround(x, z, fw, 0.5, fr) + fh / 2), z, fw, fh, 0.5, fc, { rotY: fr });
        }
        if (k % 2 === 0 && !inRects(cityBld, kx, kz, 2) && (!city || openSpot(kx, heightAt0(kx, kz) + 0.5, kz))) loot(kx, heightAt0(kx, kz) + 0.5, kz, p.id);
      }
      for (let i = 0; i < 2; i++) {
        const cx = p.x + (rng() - 0.5) * p.r, cz = p.z + (rng() - 0.5) * p.r;
        if (!inRects(cityBld, cx, cz, 2) && (!city || openSpot(cx, heightAt0(cx, cz) + 0.6, cz))) chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);       // was sampled at the POI centre — floated on the slope
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
    buildRoads(7);
    // logging camp → a small mill town (+ its signature log piles)
    town(pois[0], [C_LOG, C_PLANK], "#7a4a2a", { along: "x", nPer: 4 });
    {
      const p = pois[0];
      for (let i = 0; i < 8; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.5, z = p.z + (rng() - 0.5) * p.r * 1.5;
        const y = heightAt0(x, z);
        const lr = rng() * Math.PI;
        addBox(x, Math.min(y + 0.5, lowGround(x, z, 1, 4.5, lr) + 0.5), z, 1, 1, 4.5, shade(C_LOG, 0.9), { rotY: lr }); // log piles
      }
    }
    // ranger ridge + fire watch towers
    rangerTower(pois[1].x - 20, pois[1].z, C_PLANK, "ranger");
    rangerTower(pois[1].x + 45, pois[1].z + 35, C_PLANK, "ranger");
    rangerTower(pois[6].x, pois[6].z, C_PLANK, "firewatch");
    // lakeside cabins → a lakeside town (+ its pier)
    town(pois[2], [C_PLANK, C_LOG], "#6a4028", { along: "x", nPer: 4, minH: waterY + 0.6, layout: "crossroads" });
    pier(pois[2].x + 40, pois[2].z + 60, 18, 0.3, C_PLANK, pois[2].id);
    // hunter's hollow: blinds (elevated boxes)
    {
      const p = pois[3];
      for (let i = 0; i < 4; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.4, z = p.z + (rng() - 0.5) * p.r * 1.4;
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
        props.rocks.push({ x, y, z, s: 1.6 + rng() * 1.8, ry: rng() * Math.PI * 2 });
      }
      chest(p.x, heightAt0(p.x, p.z) + 0.6, p.z, p.id);
      hut(p.x + 40, p.z - 30, 6, 5, 0, C_STONE, p.id);
    }
    // riverside mill
    {
      const p = pois[5];
      tower(p.x, p.z, 2, 10, C_PLANK, p.id);
      hut(p.x - 24, p.z + 14, 6, 5, 0, C_LOG, p.id);
    }
    // meadow farm → actual farmland (crop rows + barn + silo + fence)
    farmland(pois[7], { minH: 0.6 });
    steeple(pois[5].x + 48, pois[5].z + 42, pois[5].id);                        // Riverside Mill chapel steeple (landmark)
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
  photo = await photoPromise;
  buildTerrain();
  emitRoads();
  if (city) buildCityGround();
  for (let i = 0; i < lootPoints.length; i++) { const p = lootPoints[i], d = p.y - lootG[i]; if (d >= 0 && d <= 1) p.y += heightAt0(p.x, p.z) - lootG[i]; }
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
    portals.push({ x: px, y: py, z: pz, obj: grp });
  }
  {
    const nIsl = 5 + Math.floor(rng() * 3);
    const grassC = mapId === "ashgrid" ? "#a7ad55" : mapId === "deepwood" ? "#3f7a3f" : "#3fae62";
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
    for (let i = 0; i < nIsl; i++) {
      const ang = rng() * Math.PI * 2;
      const rr = 180 + rng() * (HALF - 320);
      const ix = Math.cos(ang) * rr, iz = Math.sin(ang) * rr;
      const groundH = baseH(ix, iz);
      if (groundH < waterY - 2) continue;                      // not over deep ocean
      const topY = Math.max(groundH, waterY) + 26 + rng() * 26; // 26-52m up
      const rad = 9 + rng() * 8;
      // grassy top disc — TILE = 8 m per texture tile, same density as the terrain
      const topGeo = new THREE.CylinderGeometry(rad, rad * 0.92, 1.6, 9);
      const top = new THREE.Mesh(topGeo, islMat(grassC, 0.95, topGeo, (rad * 2) / TILE));
      top.position.set(ix, topY - 0.8, iz);
      top.castShadow = true; top.receiveShadow = true;
      g.add(top);
      // hanging rock cone underneath
      const rockGeo = new THREE.ConeGeometry(rad * 0.9, rad * 1.5, 14);   // 8 radial segments read as a paper dart from below; +12 tris each
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
      // walkable top collider — 0.92·rad matches the visible disc's octagon flat-to-flat
      // (was 0.86·rad, leaving the outer ~14% of grass unsupported → rim fall-through on
      // a hero feature that carries premium loot).
      // The 9-sided disc (circumradius `rad`, 0.94 .. 1.0 rad to its edge) used to get ONE square 0.92 rad each side: its corners stood 1.30 rad from
      // the centre, so every island carried ~19% of its area as invisible floor out over the void at four diagonals (a player could stand on air).
      // The plan's plus of TWO arms alone (0.95 x 0.42) leaves 15% of the walkable disc without a collider = rim fall-through, the thing the
      // 0.92 widening was made to cure. Two arms (0.95 x 0.55) plus a 0.78 hub are three plain boxes (contract C-COLL), measured on the real
      // 9-gon (offline fit over the polygon's area): invisible floor 19% -> 10% of the disc area, disc (r <= 0.94) without support 0.86% -> 0.00%.
      for (const [hx, hz] of [[0.95, 0.55], [0.55, 0.95], [0.78, 0.78]])
        colliders.push(mkCollider("box", ix - rad * hx, ix + rad * hx, topY - 2.2, topY, iz - rad * hz, iz + rad * hz, -1, null, -1, 0));
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
    for (let i = 0; i < Math.min(4, pois.length); i++) {
      const p = pois[Math.floor(rng() * pois.length)];
      const px = p.x + 14 + (rng() - 0.5) * 24, pz = p.z + 14 + (rng() - 0.5) * 24;
      const py = heightAt0(px, pz);
      if (baseH(px, pz) < waterY + 0.5 || inRects(cityBld, px, pz, 3.5)) continue;
      addPortal(px, py, pz, rng() * Math.PI * 2);
    }
  }

  // scattered wilderness loot (all maps). 130 LAND spots, not 130 attempts: the
  // old loop spent its attempts on ocean too, so isla_viva (an island in a square
  // of sea) got ~50 spots against ~120 on the inland maps, and ended with 1.4 guns
  // per player (audit M2). This is the LAST rng consumer in buildMap (nothing after
  // it draws), so taking more draws here moves no building, prop or portal.
  // WAVE 7 (Savanna): 70 wild spots, not 130 - the other ~60 live in the compounds' buildings now (house() rolls their loot); a wild spot never lands inside a building.
  const wildN = city ? 70 : 130;
  for (let i = 0, tries = 0; i < wildN && tries < wildN * 6; tries++) {
    const x = (rng() * 2 - 1) * (HALF - 60), z = (rng() * 2 - 1) * (HALF - 60);
    const y = heightAt0(x, z);
    if (baseH(x, z) < waterY + 0.5 || (cityBld.length && (inRects(cityBld, x, z, 1.2) || !openSpot(x, y + 0.5, z) || onProp(x, z)))) continue;
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
  const EMIT = { "#ffe9a8": 0xffe9a8, "#fff2b0": 0xfff2b0 };
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
  function structMaterial(tkind) {
    let mat = structMats[tkind];
    if (mat) return mat;
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0.04 });
    let tx = null;
    try { tx = KIND_TEX[tkind] ? KIND_TEX[tkind](aniso) : _st; } catch (e) { tx = _st; }
    if (tx) { mat.map = tx.map; mat.normalMap = tx.normal; mat.normalScale = new THREE.Vector2(0.5, 0.5); }
    return (structMats[tkind] = mat);
  }
  /** Merge one batch set (colour|kind -> geometries) into one mesh per texture kind plus one per emissive colour. `tag` = "" for the map-wide set, else the district id. */
  function mergeBatchSet(bset, tag) {
    const kindGroups = {};                        // tkind -> [geometry with a color attribute]
    for (const bkey in bset) {
      const bar = bkey.lastIndexOf("|");
      const color = bkey.slice(0, bar);
      const tkind = tag && bkey.slice(bar + 1) === "block" ? "s" : bkey.slice(bar + 1);       // (7A2: a Savanna district draws its tower walls with the brick struct texture too: one structure draw call fewer per town, two with the shadow pass)
      if (EMIT[color]) continue;                    // built below, one mesh per colour
      _vc.set(color);
      const list = kindGroups[tkind] || (kindGroups[tkind] = []);
      for (const geo of bset[bkey]) {
        const n = geo.attributes.position.count, ca = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { ca[i * 3] = _vc.r; ca[i * 3 + 1] = _vc.g; ca[i * 3 + 2] = _vc.b; }
        geo.setAttribute("color", new THREE.BufferAttribute(ca, 3));
        list.push(geo);
      }
    }
    for (const tkind in kindGroups) {
      const merged = BufferGeometryUtils.mergeGeometries(kindGroups[tkind], false);
      const mesh = new THREE.Mesh(merged, structMaterial(tkind));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = "structures:" + tkind + (tag ? "@" + tag : "");
      if (tag) mesh.userData.district = tag;
      g.add(mesh);
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
      if (tag) { mesh.name = "structures:emit@" + tag; mesh.userData.district = tag; }
      g.add(mesh);
    }
  }
  mergeBatchSet(batches, "");
  for (const [did, sk] of districtSinks) mergeBatchSet(sk, did);
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
  const NLAMP = (W.settings && W.settings.graphics === "low") ? 0 : 4;
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
    const roadCol = mapId === "ashgrid" ? "#3d4045" : mapId === "deepwood" ? "#5f4f3c" : "#7c6a4e";
    const rmerged = BufferGeometryUtils.mergeGeometries(roadGeos, false);
    const rmat = new THREE.MeshStandardMaterial({ color: roadCol, roughness: 0.98, metalness: 0 });
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
    const rmesh = new THREE.Mesh(rmerged, rmat);
    rmesh.receiveShadow = true; rmesh.name = "roads";
    g.add(rmesh);
  }

  // ── instanced props from GLBs ─────────────────────────────────────────────
  const propStats = finalizeProps();   // slope rejection + ground fit for every placed prop (see the grounding block above scatterTrees)
  if (yardInfo) propStats.yard = yardInfo;
  const instRefs = {};   // kind -> [{inst, baseMatrixes}]
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
      const meshes = [];
      root.traverse((o) => { if (o.isMesh) meshes.push(o); });
      instRefs[kind] = [];
      for (const m of meshes) {
        const inst = new THREE.InstancedMesh(m.geometry, m.material, list.length);
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
        if (mats) shadowSrc.push({ kind, list, geo: m.geometry, mat: m.material, mats });
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
    const NEAR_N = 64, NEAR_R2 = 110 * 110;
    const nearCasters = shadowSrc.map((ref) => {
      const im = new THREE.InstancedMesh(ref.geo, ref.mat, NEAR_N);
      im.castShadow = true; im.receiveShadow = false; im.count = 0;
      im.frustumCulled = false;   // rebuilt around the focus; its own bounding sphere is stale by design
      g.add(im);
      return { im, ref };
    });
    let _fx = 1e9, _fz = 1e9;
    W._foliageDirty = true;
    if (nearCasters.length) trackUpdater(() => {
      const f = W._camFocus || W.player; if (!f) return;
      const dx = f.pos.x - _fx, dz = f.pos.z - _fz;
      if (!W._foliageDirty && dx * dx + dz * dz < 400) return;    // 20 m threshold
      _fx = f.pos.x; _fz = f.pos.z; W._foliageDirty = false;
      for (const nc of nearCasters) {
        const { list, mats } = nc.ref;
        let n = 0;
        for (let i = 0; i < list.length && n < NEAR_N; i++) {
          const it = list[i];
          if (it.dead) continue;
          const ax = it.x - _fx, az = it.z - _fz;
          if (ax * ax + az * az > NEAR_R2) continue;
          nc.im.setMatrixAt(n++, mats[i]);
        }
        nc.im.count = n;
        nc.im.instanceMatrix.needsUpdate = true;
      }
    });
  }
  if (city) { await placeCityKit(); installCityCull(); }
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
    const CL_N = 1400, CL_R = 55;
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
    const clutter = new THREE.InstancedMesh(clGeo, clMat, CL_N);
    clutter.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CL_N * 3), 3);
    clutter.castShadow = false; clutter.receiveShadow = false;
    clutter.frustumCulled = false; clutter.name = "clutter";
    g.add(clutter);
    const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3(), _cp = new THREE.Vector3();
    const _cy = new THREE.Vector3(0, 1, 0), _hide = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4);
    const _clC = [0, 0, 0];                           // colorAt out (a rebuild colours up to 1,400 tufts)
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
    const FADE0 = 40;                                 // full size to here, shrink to 0 by CL_R
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
          clutter.instanceColor.setXYZ(n, c[0] * 0.82, c[1] * 0.82, c[2] * 0.82);   // contact darkening
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
  const CELL = city ? 8 : 16;
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
  function queryColliders(x, z, r, out) {
    const o = out || qOut;
    let n = 0;
    const stamp = ++qStamp;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const l = chash.get(cKey(cx, cz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (!c.dead && c._qs !== stamp) { c._qs = stamp; o[n++] = c; }
      }
    }
    if (n === 0 && !out) return Q_EMPTY;
    if (o.length !== n) o.length = n;
    return o;
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
  function losBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  }

  const lootAll = lootPoints.concat(chestPoints);
  // What is underfoot, for footstep audio. The recorded Kenney steps are per
  // surface, and a boardwalk that sounds like grass is worse than no sample at
  // all. Cheap by construction: it reuses the SAME snow term the vertex colour
  // uses (deepwood's northern zone, maps.js colorAt), so what you hear always
  // matches what you see, and falls back to the map's base ground otherwise.
  // Structures are checked first — standing on a deck or a roof reads as wood.
  const BASE_SURF = { isla_viva: "grass", ashgrid: "concrete", deepwood: "grass" };
  function surfaceAt(x, z) {
    const gy = heightAt0(x, z);
    const near = queryColliders(x, z, 0.6);
    for (const c of near) {
      // only count something we could actually be standing ON, not a wall beside us
      if (c.maxY > gy + 0.35 && c.maxY < gy + 6) return "wood";
    }
    if (mapId === "deepwood") {
      const edge = 0;
      const snow = Math.max(0, Math.min(1, (-z - 100 + edge) / 260));
      if (snow > 0.35) return "snow";
    }
    return BASE_SURF[mapId] || "grass";
  }

  if (cityFallback) { try { W.events && W.events.emit && W.events.emit("mapFallback", { map: mapId, genVersion: cityFallback.genVersion, wanted: cityFallback.wanted, reason: cityFallback.reason }); } catch (e) { /* a listener's problem */ } }
  return {
    id: mapId, K, half: HALF * 0.98, size: SIZE, waterY,
    heightAt: heightAt0, groundAt: heightAt0, surfaceAt,
    colliders, queryColliders, destroyProp,
    // the placed prop lists ({x, y, z, s, ry, ...} per kind: the ANCHOR, the final base y, the seeded scale and yaw) and what the slope
    // limits dropped - read-only, for the placement / collision gates (_harness) and for debugging
    propInstances: props, propStats,
    lootPoints: lootAll, pois, portals,
    randomGroundPos, losBlocked,
    minimap: mm, themeColor: K.themeColor,
    terrain, water: mapWater, sky: K.sky,
    // C-PAD (Wave 6): what the ground is made of - read-only, for the gates and for debugging. `genVersion` names the world GENERATOR: 1 = the
    // Wave-5 build (analytic ground, the terrain built before any POI), 2 = baked lattice + pads + road corridors. Two clients with different
    // versions build different ground from the same seed - the squad-room handshake should compare it (net.js, lane 7C).
    genVersion: cityFallback ? cityFallback.genVersion : MAP_GEN_VERSION,       // (WAVE 7, 7A2: a Savanna built on its fallback layout says so: see prepareCity)
    fallback: cityFallback,                                                     // null, or { reason, genVersion, wanted }: the towns did not load, this is the Wave-6 Savanna
    // WAVE 7: the Savanna city as built (null on the other maps): towngen's layout (towns, compounds, links, stats), the citykit list and what it placed, the
    // decals - read-only, for the gates (citycheck, placementcheck, perf_district) and for debugging
    city: city ? { version: city.TG.VERSION, layout: city.lay, looks: city.looks, stats: city.stats, kit: city.kit, kitStats: city.kitStats, paintStats: city.paintStats, lights: city.lights, footprints: cityBld, roads: cityRoadLog } : null,
    ground: { lattice: field.lat, latN: LAT_N, pitch: LAT_PITCH, pads: field.pads.length, corridors: field.corridors, corridorSegments: field.segs.length, bakeMs, roads: roadStats, roadSections: roadLog, padLog },
    // the look to restore to when the camera surfaces (underwater overrides it)
    fogSurface: { color: K.sky, density: K.fog },
  };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return "#" + c.getHexString();
}
