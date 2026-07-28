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
// cloud/bird sprites all set `fog: false`, and both maps are 2D canvases.
export const MAPS = {
  isla_viva: { name: "Isla Viva", theme: "tropical", sky: "#7fd4f0", zenith: "#2f8fd8", fog: 0.0018, themeColor: "#22d3a0", water: true,
    sun: { pos: [90, 130, 60], color: 0xfff4e0, intensity: 2.05 }, hemi: { sky: 0xdcefff, ground: 0x86a06a, intensity: 1.25 } },
  ashgrid:   { name: "Savanna", theme: "savanna", sky: "#e7cf98", zenith: "#4f86bd", fog: 0.0019, themeColor: "#e0854a", water: false,
    sun: { pos: [-120, 105, 45], color: 0xffe6b4, intensity: 2.25 }, hemi: { sky: 0xf0e3c4, ground: 0xb59a63, intensity: 1.15 } },
  deepwood:  { name: "Deepwood", theme: "forest", sky: "#9fc7e8", zenith: "#3a6fae", fog: 0.0020, themeColor: "#7fb069", water: true,
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

// ── palette / biome coloring per map ────────────────────────────────────────
function colorAt(mapId, h, x, z, seed) {
  const n = fbm(x / 60, z / 60, seed + 51, 2, 2, 0.5);
  if (mapId === "isla_viva") {
    if (h < 0.4) return [0.93, 0.87, 0.64];                       // sand
    if (h < 2.2) return [0.90 - n * 0.1, 0.84, 0.58];
    if (h > 58) return [0.42, 0.38, 0.36];                        // volcano rock
    if (h > 34) return [0.48 + n * 0.1, 0.44, 0.38];
    return [0.18 + n * 0.15, 0.62 + n * 0.18, 0.28];              // lush grass
  }
  if (mapId === "ashgrid") {
    // SAVANNA split into a green west and an arid DESERT east — a GEOGRAPHIC zone
    // (guaranteed every seed) with an organic noisy boundary. Final Drop-style.
    const edge = fbm(x / 260, z / 260, seed + 61, 2, 2, 0.5) * 120;
    const desert = Math.max(0, Math.min(1, (x - 40 + edge) / 320));   // 1 = desert dunes (east)
    const m = fbm(x / 130, z / 130, seed + 77, 2, 2, 0.5);            // local green/gold patches
    if (h < 0.5) return [0.85, 0.74, 0.5];                            // sandy dry wash
    if (h > 28) return [0.55 + n * 0.08, 0.44, 0.31];                 // sun-baked bluffs
    const green = [0.58 + n * 0.12, 0.70 + m * 0.20, 0.30 + n * 0.08]; // savanna grass (brighter, greener)
    const sand = [0.90 + n * 0.07, 0.78 + n * 0.06, 0.50];            // desert sand (bright)
    return [green[0] + (sand[0] - green[0]) * desert, green[1] + (sand[1] - green[1]) * desert, green[2] + (sand[2] - green[2]) * desert];
  }
  if (mapId === "deepwood") {
    // FOREST with a distinct northern SNOW biome — a GEOGRAPHIC zone (guaranteed
    // every seed) with an organic noisy edge. Snow is intentionally bright bluish-white.
    const edge = fbm(x / 240, z / 240, seed + 91, 2, 2, 0.5) * 90;
    const snow = Math.max(0, Math.min(1, (-z - 100 + edge) / 260));   // 1 = deep snow (far north)
    let base;
    if (h < 0.6) base = [0.55, 0.5, 0.38];                            // river mud
    else if (h > 44) base = [0.5, 0.48, 0.45];                        // rocky tops
    else base = [0.12 + n * 0.1, 0.4 + n * 0.14, 0.16];              // deep green
    if (snow > 0.01) {
      const sc = [0.90 + n * 0.06, 0.94 + n * 0.05, 0.98];           // snow (crisp bright white, faint blue)
      return [base[0] + (sc[0] - base[0]) * snow, base[1] + (sc[1] - base[1]) * snow, base[2] + (sc[2] - base[2]) * snow];
    }
    return base;
  }
  return [0.5 + n * 0.1, 0.62, 0.42];
}

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
export function disposeMapResources(W) {
  const g = W._groups && W._groups.map;
  if (!g) return { geometries: 0, materials: 0, textures: 0 };
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
  const heightAt0 = mkHeightFn(mapId, seed);
  const waterY = K.water ? 0 : -999;

  const g = W.group("map");
  let mapWater = null;   // exposed on the returned map so the camera can test submersion
  g.clear();
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
  const aniso = W._texAniso || 4;
  // 220 segments over 1600 m is 7.27 m per vertex — coarse enough that the grid
  // stairstep is visible on the Isla Viva volcano silhouette from the air. 300 is
  // 5.33 m/vertex for ~180k triangles on the SAME single draw call. The mesh is
  // PURELY VISUAL: gameplay reads the analytic heightAt0 (returned as heightAt /
  // groundAt) and nothing in runtime/ consumes map.terrain, so raising this cannot
  // move a collision surface. Do NOT go past ~320 — the per-vertex loop calls
  // heightAt0 + colorAt (both fbm) and geometry is ~44 bytes/vertex (301² ≈ 4.0 MB
  // here vs 2.1 MB at 220).
  const SEG = 300;
  const terrGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  terrGeo.rotateX(-Math.PI / 2);
  const pos = terrGeo.attributes.position;
  const uv = terrGeo.attributes.uv;
  const cols = new Float32Array(pos.count * 3);
  const TILE = 8;                                   // meters per texture tile
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt0(x, z);
    pos.setY(i, h);
    const c = colorAt(mapId, h, x, z, seed);
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
    uv.setXY(i, x / TILE, z / TILE);               // world-planar UV → texture tiles every 8m
  }
  terrGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  uv.needsUpdate = true;
  terrGeo.computeVertexNormals();
  const terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  try {
    const gt = groundTex(aniso);
    terrMat.map = gt.map; terrMat.normalMap = gt.normal;
    terrMat.normalScale = new THREE.Vector2(0.55, 0.55);
  } catch (e) { /* canvas unavailable → flat vertex-color fallback */ }
  const terrain = new THREE.Mesh(terrGeo, terrMat);
  terrain.receiveShadow = true;
  terrain.name = "terrain";
  g.add(terrain);
  await yieldPhase();                                // phase 1/3 done — let the loader paint

  // ── water ─────────────────────────────────────────────────────────────────
  if (K.water) {
    const wgeo = new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6, 1, 1);
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
      color: mapId === "isla_viva" ? 0x2ec9d6 : 0x2f7d8a, transparent: true, opacity: 0.86,
      roughness: 0.30, metalness: 0.0, side: THREE.DoubleSide,
    });
    let wN = null;
    try {
      wN = waterNormalTex(aniso);
      wN.repeat.set(90, 90);
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

  // ── SKY: gradient dome + drifting clouds + looping birds ──────────────────
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
      uniforms: { top: { value: zenith }, bot: { value: horizon }, sunDir: { value: sunDir } },
      vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying vec3 vp; uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; void main(){ vec3 d = normalize(vp); float h = clamp(d.y, 0.0, 1.0); vec3 col = mix(bot, top, pow(h, 0.62)); float s = max(dot(d, sunDir), 0.0); col += vec3(1.0, 0.94, 0.80) * (pow(s, 1200.0) * 1.6 + pow(s, 10.0) * 0.18); gl_FragColor = vec4(col, 1.0); }",
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false; sky.name = "sky";
    g.add(sky);

    // soft cloud-puff sprite texture
    const ccv = document.createElement("canvas"); ccv.width = ccv.height = 128;
    const cx2 = ccv.getContext("2d");
    const cgrad = cx2.createRadialGradient(64, 64, 4, 64, 64, 62);
    cgrad.addColorStop(0, "rgba(255,255,255,0.95)"); cgrad.addColorStop(0.5, "rgba(255,255,255,0.45)"); cgrad.addColorStop(1, "rgba(255,255,255,0)");
    cx2.fillStyle = cgrad; cx2.fillRect(0, 0, 128, 128);
    const cloudTex = new THREE.CanvasTexture(ccv); cloudTex.colorSpace = THREE.SRGBColorSpace;
    // ONE material for all ~96 puffs. Every puff used to allocate its own
    // identical SpriteMaterial (24 clouds x 3-5 puffs), which is 96 distinct
    // materials and 96 shader-program lookups a frame for what is one billboard.
    // disposeMapResources dedupes by identity, so teardown is unaffected.
    const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
    const clouds = [];
    for (let i = 0; i < 24; i++) {
      const grp = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Sprite(cloudMat);
        const sc = 46 + rng() * 70;
        s.scale.set(sc, sc * 0.58, 1);
        s.position.set((rng() - 0.5) * sc * 1.7, (rng() - 0.5) * sc * 0.28, (rng() - 0.5) * sc * 1.3);
        grp.add(s);
      }
      const ang = rng() * Math.PI * 2, rad = 180 + rng() * (HALF * 0.85);
      grp.position.set(Math.cos(ang) * rad, 320 + rng() * 140, Math.sin(ang) * rad); // 320-460m: above the drop/portal ceiling so you never pass THROUGH a cloud (billboards read as cards up close; fluffy from below)
      grp.userData.drift = 2.5 + rng() * 4;
      g.add(grp); clouds.push(grp);
    }

    // bird "V" sprite texture + a few looping flocks
    const bcv = document.createElement("canvas"); bcv.width = bcv.height = 32;
    const bx = bcv.getContext("2d"); bx.strokeStyle = "rgba(38,40,52,0.92)"; bx.lineWidth = 3; bx.lineCap = "round";
    bx.beginPath(); bx.moveTo(4, 21); bx.lineTo(16, 11); bx.lineTo(28, 21); bx.stroke();
    const birdTex = new THREE.CanvasTexture(bcv); birdTex.colorSpace = THREE.SRGBColorSpace;
    const birdMat = new THREE.SpriteMaterial({ map: birdTex, transparent: true, depthWrite: false, fog: false });  // shared, same reason as cloudMat
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
      for (const c of clouds) { c.position.x += c.userData.drift * dt; if (c.position.x > HALF * 1.15) c.position.x = -HALF * 1.15; }
      for (const fl of flocks) {
        const u = fl.userData, a = t * u.spd + u.ph;
        fl.position.set(u.cx + Math.cos(a) * u.fr * 6, u.cy + Math.sin(a * 0.7) * 7, u.cz + Math.sin(a) * u.fr * 6);
        for (const s of fl.children) s.position.set((s.userData.ix - fl.children.length / 2) * 4.5, Math.sin(t * 6 + s.userData.ph) * 1.6, (s.userData.ix % 2) * 3);
      }
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
  const colliders = [];             // {kind:'box'|'ramp', minX..maxZ, dir?, top}
  const batches = {};               // colorHex -> geometry list
  function addBox(cx, cy, cz, w, h, d, color, opts) {
    opts = opts || {};
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, STRUCT_TILE);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, cy, cz);
    // batch key carries the texture KIND (opts.tex: shingle/plank/metal/block;
    // default "s" = the struct brick) — the merge loop below splits it back out
    const bkey = color + "|" + (opts.tex || "s");
    (batches[bkey] = batches[bkey] || []).push(geo);
    if (opts.collide !== false) {
      // AABB of the (possibly rotated) box — conservative
      const hw = opts.rotY ? (Math.abs(Math.cos(opts.rotY)) * w + Math.abs(Math.sin(opts.rotY)) * d) / 2 : w / 2;
      const hd = opts.rotY ? (Math.abs(Math.sin(opts.rotY)) * w + Math.abs(Math.cos(opts.rotY)) * d) / 2 : d / 2;
      colliders.push({ kind: "box", minX: cx - hw, maxX: cx + hw, minY: cy - h / 2, maxY: cy + h / 2, minZ: cz - hd, maxZ: cz + hd });
    }
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
    (batches[color + "|s"] = batches[color + "|s"] || []).push(geo);   // ramps keep the struct grain
    // collider footprint: run axis is X for dir 0/1, Z for dir 2/3
    const hx = (dir === 0 || dir === 1) ? d / 2 : w / 2;
    const hz = (dir === 0 || dir === 1) ? w / 2 : d / 2;
    colliders.push({ kind: "ramp", minX: cx - hx, maxX: cx + hx, minY: cy, maxY: cy + h, minZ: cz - hz, maxZ: cz + hz, dir });
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
  function loot(x, y, z, poi) { if (y < waterY + 0.4) return; lootPoints.push({ x, y, z, kind: "floor", poi }); }
  function chest(x, y, z, poi) { if (y < waterY + 0.4) return; chestPoints.push({ x, y, z, kind: "chest", poi }); }

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
    const y = submerged ? waterY + 0.35 : ground;
    const T = 0.35;
    if (submerged) {
      const legY = (ground + y) / 2, legH = Math.max(0.6, y - ground);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        addBox(x + sx * (w / 2 - 0.3), legY, z + sz * (d / 2 - 0.3), 0.32, legH, 0.32, shade(color, 0.7));
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
    if (rng() < 0.5) chest(x + (rng() - 0.5) * w * 0.5, y + 0.6, z + (rng() - 0.5) * d * 0.5, poi);
  }

  function tower(x, z, floors, fw, color, poi) {
    const y = heightAt0(x, z);
    const FH = 4, T = 0.4, W2 = fw / 2;
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
        const hz0 = pdir === 2 ? z - rrun * 0.10 : z - rrun * 0.55;
        const hz1 = pdir === 2 ? z + rrun * 0.55 : z + rrun * 0.10;
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
        addBox(x - W2 / 2 - dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color);
        addBox(x + W2 / 2 + dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color);
        addBox(x, fy + FH - 0.5, z + W2, dw, 1, T, color);
        addBox(x, fy + FH / 2, z - W2, fw, FH, T, color);
        addBox(x - W2, fy + FH / 2, z, T, FH, fw, color);
        addBox(x + W2, fy + FH / 2, z, T, FH, fw, color);
      } else {
        addBox(x, SILL_Y, z + W2, fw, SILL_H, T, color); addBox(x, HEAD_Y, z + W2, fw, HEAD_H, T, color);
        addBox(x, SILL_Y, z - W2, fw, SILL_H, T, color); addBox(x, HEAD_Y, z - W2, fw, HEAD_H, T, color);
        addBox(x - W2, SILL_Y, z, T, SILL_H, fw, color); addBox(x - W2, HEAD_Y, z, T, HEAD_H, fw, color);
        addBox(x + W2, SILL_Y, z, T, SILL_H, fw, color); addBox(x + W2, HEAD_Y, z, T, HEAD_H, fw, color);
      }
      // interior ramp to next floor
      if (f < floors - 1) addRamp(x + (f % 2 ? -fw / 4 : fw / 4), fy, z, 2.2, FH, fw * 0.7, f % 2 ? 3 : 2, shade(color, 0.7));
      loot(x + (rng() - 0.5) * fw * 0.5, fy + 0.5, z + (rng() - 0.5) * fw * 0.5, poi);
    }
    addBox(x, y + floors * FH + 0.15, z, fw, 0.3, fw, shade(color, 0.65)); // roof slab
    addBox(x, y + floors * FH + 0.7, z + fw / 2 - 0.2, fw, 1.1, 0.35, shade(color, 0.6)); // parapet
    addBox(x, y + floors * FH + 0.7, z - fw / 2 + 0.2, fw, 1.1, 0.35, shade(color, 0.6));
    chest(x, y + floors * FH + 0.6, z, poi);                                  // roof chest
    loot(x, y + 0.5, z, poi);
    // exterior ramp along the +X wall up to the roof — rooftop chests must be
    // reachable on foot (playtest: "are there ramps to get up there?"); ends
    // short of the parapet so you can step sideways onto the slab
    addRamp(x + W2 + 1.15, y, z - 0.8, 2.2, floors * FH + 0.45, fw - 1.6, 2, shade(color, 0.72));
  }

  function rangerTower(x, z, color, poi) {
    const y = heightAt0(x, z);
    const H = 11, P = 3.4;
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]])
      addBox(x + dx, y + H / 2, z + dz, 0.4, H, 0.4, color);
    addBox(x, y + H + 0.15, z, P + 1.4, 0.3, P + 1.4, shade(color, 0.85));    // deck
    // The +Z rail is split into two 1.6 m stubs to leave a gateway where the ramp
    // arrives. It used to be one solid 4.8 m rail across all four sides: the ramp
    // top ended at z+3.6 while the deck edge is z+2.4, so you climbed 11 m, hit a
    // 1.15 m gap of air and then a 1.2 m wall. STEP_UP is 0.55 (player.js) and the
    // jump apex is 1.38 m, so the deck chest on all three Deepwood towers was
    // unreachable on foot. The ramp start moves to z+P+2.2 to meet the deck edge.
    for (const [dx, dz, w, d] of [[0, -(P + 1.2) / 2, P + 1.4, 0.3], [-(P + 1.4) / 2 + 0.8, (P + 1.2) / 2, 1.6, 0.3], [(P + 1.4) / 2 - 0.8, (P + 1.2) / 2, 1.6, 0.3], [-(P + 1.2) / 2, 0, 0.3, P + 1.4], [(P + 1.2) / 2, 0, 0.3, P + 1.4]])
      addBox(x + dx, y + H + 0.9, z + dz, w, 1.2, d, color);
    addBox(x, y + H + 2.6, z, P + 2, 0.25, P + 2, shade(color, 0.7), { collide: false }); // little roof
    addRamp(x, y, z + P + 2.2, 2.0, H + 0.3, 6.4, 3, shade(color, 0.8));      // access ramp
    chest(x, y + H + 0.6, z, poi);
  }

  function pier(x, z, len, rot, color, poi) {
    const y = waterY + 0.5;
    addBox(x, y, z, 3, 0.3, len, color, { rotY: rot, tex: "plank" });   // a dock reads as boards, not brick
    loot(x, y + 0.6, z, poi);
    if (rng() < 0.6) chest(x, y + 0.6, z + len * 0.35, poi);
  }

  // ── per-map POIs + props plan (props = pure scenery + cover collision) ────
  const pois = [];
  const landmarks = [];             // {x,z,r} unnamed inter-POI structures — trees keep clear
  const lampPts = [];               // {x,y,z} emissive lamp heads — the near-lamp light pool follows these
  const props = { palm: [], tree: [], pine: [], birch: [], bush: [], rocks: [], car: [], container: [], barrel: [] };
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
      const h = heightAt0(x, z);
      if (h < minH || h > maxH) continue;
      if (nearPoi(x, z, 26) || nearLandmark(x, z)) continue;
      const s = 0.8 + rng() * 0.9;
      props[kind].push({ x, y: h, z, s, ry: rng() * Math.PI * 2 });
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
      if (heightAt0(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) > minH) k++;
      n++;
    }
    if (heightAt0(cx, cz) > minH) k++;
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
  const roadGeos = [];                                  // merged into one asphalt mesh after structures
  // The rendered terrain is a LINEAR interpolation of heightAt0 sampled on the SEG
  // grid, not heightAt0 itself — over one 5.3 m cell the two differ by up to ~0.12 m
  // on curved ground. Ground-hugging geometry that samples heightAt0 directly
  // therefore buries itself in every ridge; sample the same bilinear surface the
  // terrain mesh actually draws.
  const CELLW = SIZE / SEG;
  function meshY(x, z) {
    const gx = (x + HALF) / CELLW, gz = (z + HALF) / CELLW;
    const i0 = Math.floor(gx), j0 = Math.floor(gz);
    const fx = gx - i0, fz = gz - j0;
    const x0 = i0 * CELLW - HALF, z0 = j0 * CELLW - HALF, x1 = x0 + CELLW, z1 = z0 + CELLW;
    const h00 = heightAt0(x0, z0), h10 = heightAt0(x1, z0), h01 = heightAt0(x0, z1), h11 = heightAt0(x1, z1);
    return (h00 + (h10 - h00) * fx) * (1 - fz) + (h01 + (h11 - h01) * fx) * fz;
  }
  // Roads used to be a chain of BoxGeometry slabs, one per ~9 m, each rotated in
  // YAW ONLY and dropped at heightAt0(midpoint)+0.07. On anything but flat ground
  // that is a staircase of floating rectangles: the Ranger Ridge network read as
  // scattered brown slabs and the Isla Viva volcano climb as a dashed line. One
  // conforming ribbon instead — the terrain is sampled at EVERY cross-section
  // vertex, so the surface bends with the ground and no edge can float. Roads carry
  // no collider (they only ever reach roadGeos), so this is pure render.
  const ROAD_STEP = 4;      // metres between cross-sections
  const ROAD_LIFT = 0.06;   // above the mesh; well under STEP_UP (0.55) either way
  const ROAD_XS = [-1, -0.5, 0, 0.5, 1];   // cross-section offsets, x half-width
  function road(x0, z0, x1, z1, width) {
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
        posA[k * 3] = vx; posA[k * 3 + 1] = meshY(vx, vz) + ROAD_LIFT; posA[k * 3 + 2] = vz;
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
  // greedy nearest-neighbour tree over the POIs → a connected road network
  function buildRoads(width) {
    for (let i = 1; i < pois.length; i++) {
      let best = -1, bd = 1e9;
      for (let j = 0; j < i; j++) { const d = Math.hypot(pois[i].x - pois[j].x, pois[i].z - pois[j].z); if (d < bd) { bd = d; best = j; } }
      if (best >= 0) road(pois[i].x, pois[i].z, pois[best].x, pois[best].z, width || 7);
    }
  }
  function parkingLot(cx, cz, w, d, poi) {
    // Same defect as road(): one flat slab dropped at the centre's height floated
    // (or buried) at every corner on a sloped lot. A subdivided conforming plane.
    const nx = Math.max(2, Math.round(w / 4)), nz = Math.max(2, Math.round(d / 4));
    const geo = new THREE.PlaneGeometry(w, d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const pp = geo.attributes.position, pu = geo.attributes.uv;
    for (let i = 0; i < pp.count; i++) {
      const vx = cx + pp.getX(i), vz = cz + pp.getZ(i);
      pp.setY(i, meshY(vx, vz) + ROAD_LIFT);
      pu.setXY(i, vx / ROAD_TILE, vz / ROAD_TILE);
    }
    geo.translate(cx, 0, cz);
    geo.computeVertexNormals();
    roadGeos.push(geo);
    for (let i = 0; i < 4; i++) {
      const px = cx - w / 2 + 3 + (i % 2) * (w - 6), pz = cz - d / 2 + 3 + Math.floor(i / 2) * (d - 6);
      props.car.push({ x: px, y: heightAt0(px, pz), z: pz, s: 2.1, ry: 0 });
    }
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
  function house(x, z, w, d, rot, wallC, roofC, poiId) {
    const y = heightAt0(x, z), H = 3.4, T = 0.32, doorW = 1.4, winW = 1.2;
    const segW = w / 2 - doorW / 2, segD = d / 2 - winW / 2;
    const jamb = d / 4 + winW / 4, pier = w / 4 + doorW / 4;
    addBoxR(x, z, -pier, -d / 2, y + H / 2, segW, H, T, wallC, rot);                // back, L of back door
    addBoxR(x, z, pier, -d / 2, y + H / 2, segW, H, T, wallC, rot);                 // back, R of back door
    addBoxR(x, z, 0, -d / 2, y + H - 0.35, doorW, 0.7, T, wallC, rot);              // back door lintel
    for (const sx of [-1, 1]) {                                                     // side walls with a window band
      addBoxR(x, z, sx * w / 2, -jamb, y + H / 2, T, H, segD, wallC, rot);
      addBoxR(x, z, sx * w / 2, jamb, y + H / 2, T, H, segD, wallC, rot);
      addBoxR(x, z, sx * w / 2, 0, y + 0.60, T, 1.20, winW, wallC, rot);            // sill  (y+0.00..y+1.20)
      addBoxR(x, z, sx * w / 2, 0, y + 2.85, T, 1.10, winW, wallC, rot);            // header (y+2.30..y+3.40)
    }
    addBoxR(x, z, -pier, d / 2, y + H / 2, segW, H, T, wallC, rot);                 // front L of door
    addBoxR(x, z, pier, d / 2, y + H / 2, segW, H, T, wallC, rot);                  // front R of door
    addBoxR(x, z, 0, d / 2, y + H - 0.35, doorW, 0.7, T, wallC, rot);               // door lintel
    addBoxR(x, z, 0, 0, y + H + 0.35, w + 0.7, 0.3, d + 0.7, roofC, rot, { tex: "shingle" });   // roof deck (overhangs)
    addBoxR(x, z, 0, 0, y + H + 0.85, w * 0.5, 0.7, d + 0.5, shade(roofC, 0.88), rot, { tex: "shingle" }); // ridge cap
    loot(x, y + 0.5, z, poiId);
    if (rng() < 0.5) chest(x + (rng() - 0.5) * w * 0.4, y + 0.6, z + (rng() - 0.5) * d * 0.4, poiId);
  }
  // street dressing along a town's main street: lamp posts, market stalls, benches,
  // hydrants (all cosmetic — collide:false — so they add life without snagging players).
  function streetFurniture(cx, cz, A, span, minH) {
    const half = span / 2;
    for (const s of [-1, 1]) {
      for (let t = -half + 8; t <= half - 8; t += 16) {
        const lx = A ? cx + t : cx + s * 5.5, lz = A ? cz + s * 5.5 : cz + t, y = heightAt0(lx, lz);
        if (y < minH) continue;
        addBox(lx, y + 2.4, lz, 0.22, 4.8, 0.22, "#3a3d42", { collide: false });   // lamp pole
        addBox(lx, y + 4.9, lz, 0.5, 0.3, 0.5, "#ffe9a8", { collide: false });      // warm lamp head
        lampPts.push({ x: lx, y: y + 4.9, z: lz });
      }
    }
    for (let i = 0; i < 2; i++) {                                                    // market stalls
      const sx = A ? cx + (i ? 12 : -12) : cx + 9, sz = A ? cz + 9 : cz + (i ? 12 : -12), y = heightAt0(sx, sz);
      if (y < minH) continue;
      for (const [dx, dz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) addBox(sx + dx, y + 1.1, sz + dz, 0.15, 2.2, 0.15, "#8a6a3a", { collide: false });
      addBox(sx, y + 2.4, sz, 3.6, 0.2, 2.6, i ? "#c0563a" : "#3a7a9a", { collide: false });  // awning
      addBox(sx, y + 0.9, sz - 1, 3.4, 0.7, 0.5, "#a8794f", { collide: false });               // counter
      loot(sx, y + 0.5, sz, null);
    }
    for (let i = 0; i < 4; i++) {                                                    // benches + hydrants
      const t = -half + rng() * span, s = rng() < 0.5 ? -1 : 1;
      const bx = A ? cx + t : cx + s * 7.5, bz = A ? cz + s * 7.5 : cz + t, y = heightAt0(bx, bz);
      if (y < minH) continue;
      if (rng() < 0.55) { addBox(bx, y + 0.5, bz, 2, 0.28, 0.6, "#8a6a3a", { collide: false }); addBox(bx, y + 0.9, bz - 0.25, 2, 0.55, 0.15, "#8a6a3a", { collide: false }); }
      else addBox(bx, y + 0.5, bz, 0.4, 1.0, 0.4, "#c23b3b", { collide: false });    // hydrant
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
          if (heightAt0(tx, tz) >= minH) { hx = tx; hz = tz; okSet = true; break; }
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
    const sy = heightAt0(p.x, p.z);
    if (opts.signature === "clocktower" && sy >= minH) {
      tower(p.x, p.z - 26, 2, 7, wallCs[0], p.id);
      addBox(p.x, heightAt0(p.x, p.z - 26) + 8.9, p.z - 26 + 3.6, 3, 3, 0.3, "#e8e0c8");   // clock face, visible down the street
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
      if (heightAt0(x, z) < minH) continue;
      if (nearPoi(x, z, 60)) continue;
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
          addBox(rx, ry2 + 1.1, rz, 3.5 + rng() * 3, 2.2 + rng() * 1.4, 0.5, shade(wallCs[0], 0.8 + Math.floor(rng() * 4) * 0.1), { rotY: rng() * Math.PI });
        }
        loot(x, y + 0.5, z, null);
      } else {                                              // fenced paddock (cosmetic, never traps)
        const F = 11, fh = 1.0;
        addBox(x, heightAt0(x, z - F) + fh / 2, z - F, F * 2, fh, 0.2, "#9a7a4a", { collide: false });
        addBox(x, heightAt0(x, z + F) + fh / 2, z + F, F * 2, fh, 0.2, "#9a7a4a", { collide: false });
        addBox(x - F, heightAt0(x - F, z) + fh / 2, z, 0.2, fh, F * 2, "#9a7a4a", { collide: false });
        addBox(x + F, heightAt0(x + F, z) + fh / 2, z, 0.2, fh, F * 2, "#9a7a4a", { collide: false });
        hut(x, z, 4.5, 4, 0, wallCs[0], null);
      }
      const lx = x + (rng() - 0.5) * 16, lz = z + (rng() - 0.5) * 16;
      loot(lx, heightAt0(lx, lz) + 0.5, lz, null);
      if (rng() < 0.25) chest(x + 8, heightAt0(x + 8, z) + 0.6, z, null);
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
    const y = heightAt0(x, z), H = 22, seg = 6, sh = H / seg, T = 0.4;
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
    const y = heightAt0(x, z), legH = 12;
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) addBox(x + dx, y + legH / 2, z + dz, 0.5, legH, 0.5, "#8a8378");
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
    const y = heightAt0(x, z), T = 0.4, NW = 8, ND = 11, WH = 8, dw = 2;
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
      if (y < minH) continue;
      props.bush.push({ x, y, z, s: 0.45 + rng() * 0.3, ry: rng() * Math.PI });
    }
    const bx = cx + R * 0.9, bz = cz, by = heightAt0(bx, bz);
    if (by >= minH) {
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
      addRamp(bx, by, bz + 3, 2.2, 2.75, 5.5, 3, "#8a4d2f");             // loft ramp, in the open front half
      addBox(bx, by + 5.4, bz, 8.5, 1.2, 12.5, shade("#b0623c", 0.8));   // barn roof
      // The hay ramp used to start at bz+7 and run 9 m, which put its top INSIDE the
      // barn — fine against a solid block, but it now cuts straight through the cart
      // door and the front gable. Pushed out so its top lands at the wall face.
      addRamp(bx, by, bz + 11, 3, 5.1, 9, 3, "#8a4d2f");                 // hay ramp to the roof chest
      chest(bx, by + 5.4, bz, p.id);
      loot(bx, by + 0.5, bz + 3, p.id); loot(bx, by + 3.1, bz - 3, p.id);   // barn floor + hayloft
      const sx = bx, sz = bz - 15, sy = heightAt0(sx, sz);
      addBox(sx, sy + 5, sz, 4, 10, 4, "#c8b48a");                       // silo
      addBox(sx, sy + 10.4, sz, 4.6, 1.2, 4.6, shade("#c8b48a", 0.72));
    }
    const F = R * 0.95, fh = 1.0;                                        // cosmetic fence (never traps players)
    addBox(cx, heightAt0(cx, cz - F) + fh / 2, cz - F, F * 2, fh, 0.2, "#9a7a4a", { collide: false });
    addBox(cx, heightAt0(cx, cz + F) + fh / 2, cz + F, F * 2, fh, 0.2, "#9a7a4a", { collide: false });
    addBox(cx - F, heightAt0(cx - F, cz) + fh / 2, cz, 0.2, fh, F * 2, "#9a7a4a", { collide: false });
    addBox(cx + F, heightAt0(cx + F, cz) + fh / 2, cz, 0.2, fh, F * 2, "#9a7a4a", { collide: false });
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
    // villages → real towns (houses on a street with front doors to the road)
    town(pois[0], [C_WOODP, C_BAMBOO], "#c0563a", { along: "z", nPer: 4, signature: "depot" });        // Palm Bay
    town(pois[1], [C_BAMBOO, C_WOODP], "#cf6b3a", { along: "x", nPer: 5 });                            // Coco Village (its market hall is the tower below)
    town(pois[6], [C_WOODP, C_BAMBOO], "#b5503a", { along: "x", nPer: 4, layout: "crossroads" });       // Jungle Market
    farmland(pois[7], { minH: 0.6 });                                          // Banana Farm → actual farmland
    lighthouse(pois[3].x - 55, pois[3].z + 55, pois[3].id);                     // Shipwreck Cove lighthouse (coastal landmark)
    // cliff temples: stone block structures
    {
      const p = pois[4];
      for (let i = 0; i < 5; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.2, z = p.z + (rng() - 0.5) * p.r * 1.2;
        const y = heightAt0(x, z);
        const s = 3 + rng() * 3;
        addBox(x, y + s / 2, z, s, s, s, C_STONE);
        addBox(x, y + s + 0.8, z, s * 1.3, 1.6, s * 1.3, shade(C_STONE, 0.85));
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
        addRamp(x, y, z + s * 0.65 + trun / 2, 2.4, s + 1.6, trun, 3, shade(C_STONE, 0.9));
      }
    }
    // Isla Viva had NOT ONE multi-storey interior: the whole branch was towns of
    // 3.4 m single rooms, solid landmark blocks and five solid temple cubes, so
    // the map had no interior vertical fight at all while Savanna and Deepwood
    // both do. tower() already emits per-floor slabs, a stairwell hole over each
    // interior ramp and a roof chest. Guarded on dry ground so these do not
    // repeat the Lagoon Docks waterline bug — the coast is close at both spots.
    if (heightAt0(pois[4].x, pois[4].z) > waterY + 0.8) tower(pois[4].x, pois[4].z, 3, 12, C_STONE, pois[4].id);          // Cliff Temples keep
    if (heightAt0(pois[1].x, pois[1].z - 40) > waterY + 0.8) tower(pois[1].x, pois[1].z - 40, 2, 14, C_BAMBOO, pois[1].id); // Coco Village market hall
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
        addBox(x, y + 1.1, z, 3.5 + rng() * 3, 2.2 + rng() * 1.6, 0.6, shade(C_OBS, 0.8 + Math.floor(rng() * 4) * 0.1), { rotY: rng() * Math.PI });
        if (i % 3 === 0) loot(x + 2, y + 0.5, z, p.id);
      }
      const ox = p.x - 88, oz = p.z + 30;
      if (heightAt0(ox, oz) > waterY + 0.8) tower(ox, oz, 2, 11, C_STONE, p.id);   // rim observatory
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
      chest(p.x, y + 3.4, p.z, p.id); chest(p.x + 4, y + 0.8, p.z - 6, p.id);
      loot(p.x - 4, y + 0.8, p.z + 6, p.id);
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
    // downtown towers
    const dt = pois[0];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4, d = 55 + rng() * 70;
      const x = dt.x + Math.cos(a) * d, z = dt.z + Math.sin(a) * d;
      tower(x, z, 2 + Math.floor(rng() * 3), 10 + rng() * 4, i % 2 ? C_CONC : C_CONC2, dt.id);
    }
    // metro plaza: low halls
    for (let i = 0; i < 3; i++) hut(pois[1].x + (i - 1) * 26, pois[1].z + (rng() - 0.5) * 30, 9, 7, 0, C_BRICKB, "metro");
    tower(pois[1].x, pois[1].z - 50, 2, 12, C_CONC2, "metro");
    // overpass: elevated road on pillars
    {
      const p = pois[2];
      for (let s = -2; s <= 2; s++) {
        const x = p.x + s * 30;
        addBox(x, heightAt0(x, p.z) + 4, p.z, 3, 8, 3, C_CONC2);
        addBox(x, heightAt0(x, p.z) + 8.6, p.z, 32, 1.2, 9, C_CONC);
      }
      // ramp must reach the DECK TOP (nearest pillar deck center+8.6 + half-thick 0.6
      // ≈ ground+9.2); the old fixed 8.2 climb left a ~1m step > STEP_UP so the deck
      // + its rooftop loot were unreachable on foot.
      {
        const gBase = heightAt0(p.x - 78, p.z);
        const deckTop = heightAt0(p.x - 60, p.z) + 9.2;
        addRamp(p.x - 78, gBase, p.z, 9, Math.max(8.2, deckTop - gBase), 26, 0, C_CONC);
      }
      chest(p.x, heightAt0(p.x, p.z) + 9.9, p.z, p.id);
      loot(p.x + 30, heightAt0(p.x + 30, p.z) + 9.9, p.z, p.id);
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
      const base = [];
      for (let i = 0; i < 40; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.6, z = p.z + (rng() - 0.5) * p.r * 1.6;
        const y = heightAt0(x, z);
        props.container.push({ x, y, z, s: 1.6 + rng() * 0.6, ry: Math.floor(rng() * 4) * Math.PI / 2 });
        base.push({ x, y, z });
      }
      for (let i = 0; i < base.length; i += 3) {
        const b = base[i];
        props.container.push({ x: b.x, y: b.y + 2.8, z: b.z, s: 1.6 + rng() * 0.6, ry: Math.floor(rng() * 4) * Math.PI / 2 });
        addRamp(b.x, b.y, b.z + 6.5, 2.2, 2.8, 6, 3, shade(C_METAL, 0.8));
        if (i % 6 === 0) loot(b.x, b.y + 3.0, b.z, p.id);
      }
      for (let i = 0; i < 3; i++) {
        const cx = p.x + (rng() - 0.5) * p.r, cz = p.z + (rng() - 0.5) * p.r;
        chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);       // was sampled at the POI centre — floated on the slope
      }
    }
    // mall: big box with internal slabs
    tower(pois[4].x, pois[4].z, 2, 22, C_BRICKB, "mall");
    hut(pois[4].x - 30, pois[4].z + 20, 8, 6, 0, C_CONC2, "mall");
    // crane heights: tallest structure
    {
      const p = pois[5]; const y = heightAt0(p.x, p.z);
      addBox(p.x, y + 14, p.z, 3.4, 28, 3.4, "#c8b24a");
      addBox(p.x, y + 28.6, p.z + 8, 2.6, 1.2, 26, "#c8b24a");
      addRamp(p.x + 5, y, p.z, 2.6, 28, 34, 2, "#a89432");
      chest(p.x, y + 29.6, p.z + 14, p.id);
      tower(p.x + 40, p.z + 20, 3, 11, C_CONC, p.id);
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
          addBox(x, y + 0.9, z, 3.5 + rng() * 3, 1.8 + rng() * 1.6, 0.5, shade(C_BRICKB, 0.8 + Math.floor(rng() * 4) * 0.1), { rotY: rng() * Math.PI });
        }
        if (k % 2 === 0) loot(kx, heightAt0(kx, kz) + 0.5, kz, p.id);
      }
      for (let i = 0; i < 2; i++) {
        const cx = p.x + (rng() - 0.5) * p.r, cz = p.z + (rng() - 0.5) * p.r;
        chest(cx, heightAt0(cx, cz) + 0.6, cz, p.id);       // was sampled at the POI centre — floated on the slope
      }
    }
    // motor pool (cars = metal)
    {
      const p = pois[7];
      for (let i = 0; i < 10; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.6, z = p.z + (rng() - 0.5) * p.r * 1.6;
        const y = heightAt0(x, z);
        props.car.push({ x, y, z, s: 2.2, ry: rng() * Math.PI * 2 });
      }
      hut(p.x, p.z - 40, 10, 8, 0, C_METAL, p.id);
    }
    // street cars + barrels scattered
    for (let i = 0; i < 26; i++) {
      const x = (rng() * 2 - 1) * (HALF - 80), z = (rng() * 2 - 1) * (HALF - 80);
      if (nearPoi(x, z, 10)) continue;
      const y = heightAt0(x, z);
      props.car.push({ x, y, z, s: 2.2, ry: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 40; i++) {
      const x = (rng() * 2 - 1) * (HALF - 60), z = (rng() * 2 - 1) * (HALF - 60);
      const y = heightAt0(x, z);
      props.barrel.push({ x, y, z, s: 1.4, ry: rng() * Math.PI });
    }
    // savanna outpost: an adobe/sandstone residential town on a street
    town(pois[8], ["#c8a06a", "#b98f5a"], "#b5643c", { along: "x", nPer: 5, signature: "clocktower" });
    waterTower(pois[0].x + 100, pois[0].z + 70, pois[0].id);                    // Downtown water tower (skyline landmark)
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
    // logging camp → a small mill town (+ its signature log piles)
    town(pois[0], [C_LOG, C_PLANK], "#7a4a2a", { along: "x", nPer: 4 });
    {
      const p = pois[0];
      for (let i = 0; i < 8; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.5, z = p.z + (rng() - 0.5) * p.r * 1.5;
        const y = heightAt0(x, z);
        addBox(x, y + 0.5, z, 1, 1, 4.5, shade(C_LOG, 0.9), { rotY: rng() * Math.PI }); // log piles
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
        addBox(x - 1, y + 1.4, z, 0.4, 2.8, 0.4, shade(C_PLANK, 0.8));
        addBox(x + 1, y + 1.4, z, 0.4, 2.8, 0.4, shade(C_PLANK, 0.8));
        addRamp(x, y, z + 3.4, 1.6, 3.8, 4.4, 3, shade(C_PLANK, 0.85));
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

  // connect every POI into a road network (cosmetic ribbons on the terrain)
  buildRoads(mapId === "ashgrid" ? 8 : 7);

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
      const groundH = heightAt0(ix, iz);
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
      colliders.push({ kind: "box", minX: ix - rad * 0.92, maxX: ix + rad * 0.92, minY: topY - 2.2, maxY: topY, minZ: iz - rad * 0.92, maxZ: iz + rad * 0.92 });
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
      if (py < waterY + 0.5) continue;
      addPortal(px, py, pz, rng() * Math.PI * 2);
    }
  }

  // scattered wilderness loot (all maps)
  const wildN = 130;
  for (let i = 0; i < wildN; i++) {
    const x = (rng() * 2 - 1) * (HALF - 60), z = (rng() * 2 - 1) * (HALF - 60);
    const y = heightAt0(x, z);
    if (y < waterY + 0.5) continue;
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
  for (const bkey in batches) {
    const merged = BufferGeometryUtils.mergeGeometries(batches[bkey], false);
    const bar = bkey.lastIndexOf("|");
    const color = bkey.slice(0, bar), tkind = bkey.slice(bar + 1);
    const emit = EMIT[color];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: emit ? 0.5 : 0.88, metalness: emit ? 0 : 0.04 });
    // 1.4 already clipped to white on screen, so the extra headroom costs nothing
    // visible on the lamp itself — but the bloom pass samples the HDR render target
    // BEFORE OutputPass tonemaps it, so values above the 0.72 threshold are what
    // actually produce the glow. 2.8 makes street lamps and the lighthouse lens read
    // as light sources at distance. Do NOT chase this with kn.bloom.strength instead:
    // a global raise blooms the Deepwood snow and the Savanna sand, which is exactly
    // the "bloom haze" that 0.14 was tuned to prevent.
    if (emit) { mat.emissive = new THREE.Color(emit); mat.emissiveIntensity = 2.8; mat.toneMapped = false; }
    else {
      // per-kind relief: shingle/plank/metal/block get their own pattern, "s"
      // keeps the struct brick. Built through the same _texCache, so dispose
      // treats them as shared, same as ground/struct.
      let tx = null;
      try { tx = KIND_TEX[tkind] ? KIND_TEX[tkind](aniso) : _st; } catch (e) { tx = _st; }
      if (tx) { mat.map = tx.map; mat.normalMap = tx.normal; mat.normalScale = new THREE.Vector2(0.5, 0.5); }
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
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
    const rmesh = new THREE.Mesh(rmerged, rmat);
    rmesh.receiveShadow = true; rmesh.name = "roads";
    g.add(rmesh);
  }

  // ── instanced props from GLBs ─────────────────────────────────────────────
  const instRefs = {};   // kind -> [{inst, baseMatrixes}]
  const propColliderKinds = { palm: 0.5, tree: 0.6, pine: 0.55, birch: 0.5, rocks: 1.4, car: 1.6, container: 2.2, barrel: 0.55 };
  // destructible props: hp per prop; 0/undefined = indestructible cover (rock/car/container).
  // barrel hp 1 = pops on any hit (explodes); trees take a few rounds then fall.
  const propHP = { barrel: 1, tree: 46, pine: 58, palm: 42, birch: 40 };
  const SHADOW_KINDS = { palm: 1, tree: 1, pine: 1, birch: 1 };
  const shadowSrc = [];   // {kind, list, geo, mat, mats} — source for the near-caster proxies
  for (const kind in props) {
    const list = props[kind];
    if (!list.length) continue;
    const url = W.assetBase + "assets/props/" + kind + ".glb";
    let root;
    try { root = await W.kernel.loadGLTF(url); } catch (e) { console.warn("[maps] prop load failed", kind, e); continue; }
    root.updateMatrixWorld(true);
    // normalize: find overall bbox to scale to a sane base height
    const bbox = new THREE.Box3().setFromObject(root);
    const size = bbox.getSize(new THREE.Vector3());
    const baseH = { palm: 7, tree: 6.5, pine: 8, birch: 7, bush: 1.4, rocks: 2.2, car: 1.6, container: 2.8, barrel: 1.1 }[kind] || 3;
    // trees normalize by height; compact/wide props (rock clusters, cars) by
    // their LARGEST dimension — height-normalizing a flat rock cluster blew it
    // up into a house-sized blob
    const compact = kind === "rocks" || kind === "bush" || kind === "car" || kind === "container" || kind === "barrel";
    const norm = baseH / Math.max(0.001, compact ? Math.max(size.x, size.y, size.z) : size.y);
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
        const s = norm * it.s;
        M.compose(P.set(it.x, it.y - bbox.min.y * s, it.z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry || 0), S.set(s, s, s));
        M.multiply(meshLocal);
        inst.setMatrixAt(i, M);
        if (mats) mats.push(M.clone());
      }
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
      instRefs[kind].push(inst);
      if (mats) shadowSrc.push({ kind, list, geo: m.geometry, mat: m.material, mats });
    }
    // colliders for solid props
    const rad = propColliderKinds[kind];
    if (rad) {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const topY = it.y + (kind === "car" ? 1.6 : kind === "container" ? 2.8 : kind === "barrel" ? 1.6 : 6);
        colliders.push({ kind: "box", minX: it.x - rad, maxX: it.x + rad, minY: it.y, maxY: topY, minZ: it.z - rad, maxZ: it.z + rad, prop: kind, idx: i, hp: propHP[kind] || 0 });
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
  await yieldPhase();                                // phase 3/3 done

  // ── ground clutter ────────────────────────────────────────────────────────
  // Every frame captured for the benchmark showed empty coloured expanses: the
  // ground carries a grain normal map and nothing else, so at 1.7 m eye height
  // there is no near-field detail at all. A cross-quad tuft layer instanced in a
  // ring around the camera fills it for ~5,600 triangles and ONE draw call — this
  // is the highest visual return per triangle available in the whole file.
  // Refreshed on a timer rather than per frame, and only when the camera moved.
  {
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
      if (Math.hypot(cam.position.x - clAX, cam.position.z - clAZ) < CELL && clT < 6) return;
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
          // rim scale-fade: full to FADE0, smoothstep down to 0 by CL_R, so a tuft
          // is sub-pixel at the instant it enters or leaves the ring — no visible pop
          const d = Math.sqrt(d2);
          let fade = 1;
          if (d > FADE0) { const t = 1 - (d - FADE0) / (CL_R - FADE0); fade = t * t * (3 - 2 * t); }
          const s = (0.75 + h * 0.7) * fade;
          if (s < 0.02) continue;
          _cm.compose(_cp.set(x, y, z), _cq.setFromAxisAngle(_cy, h2 * 6.283), _cs.set(s, s, s));
          clutter.setMatrixAt(n, _cm);
          const c = colorAt(mapId, y, x, z, seed);
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
  const CELL = 16;
  const chash = new Map();
  function cKey(cx, cz) { return cx + "," + cz; }
  colliders.forEach((c, idx) => {
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = cKey(cx, cz);
      if (!chash.has(k)) chash.set(k, []);
      chash.get(k).push(c);
    }
  });
  function queryColliders(x, z, r) {
    const out = [];
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    const seen = new Set();
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const l = chash.get(cKey(cx, cz));
      if (l) for (const c of l) { if (!c.dead && !seen.has(c)) { seen.add(c); out.push(c); } }
    }
    return out;
  }

  // ── LOS (coarse march vs terrain + static boxes) ──────────────────────────
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
    const SPAN = 24;
    const spans = Math.max(1, Math.ceil(len / SPAN));
    for (let i = 0; i < spans; i++) {
      const t0 = i / spans, t1 = (i + 1) / spans;
      const x0 = ax + dx * t0, y0 = ay + dy * t0, z0 = az + dz * t0;
      const x1 = ax + dx * t1, y1 = ay + dy * t1, z1 = az + dz * t1;
      const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 0.6;
      const cols = queryColliders((x0 + x1) / 2, (z0 + z1) / 2, r);
      if (cols.length && S.segmentColliders(x0, y0, z0, x1, y1, z1, cols)) return true;
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

  return {
    id: mapId, K, half: HALF * 0.98, size: SIZE, waterY,
    heightAt: heightAt0, groundAt: heightAt0, surfaceAt,
    colliders, queryColliders, destroyProp,
    lootPoints: lootAll, pois, portals,
    randomGroundPos, losBlocked,
    minimap: mm, themeColor: K.themeColor,
    terrain, water: mapWater, sky: K.sky,
    // the look to restore to when the camera surfaces (underwater overrides it)
    fogSurface: { color: K.sky, density: K.fog },
  };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return "#" + c.getHexString();
}
