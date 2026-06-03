/**
 * FFG runtime — 3d/ffg_tactics3d.js  (ES module)
 * 3D ISOMETRIC tactical renderer (XCOM-style) on the ffg_kernel_3d substrate.
 * Consumes the SAME tactics mission content (grid + player_units + enemy_units)
 * as the 2D renderer, but draws it as a lit 3D scene with an angled, rotatable
 * camera — the presentation the 2D top-down grid couldn't deliver.
 *
 * Phase 1 (this file): 3D board (floor / walls / cover / hazard), 3D soldier
 * units, iso camera (right-drag rotate, WASD pan, scroll zoom), select → move →
 * fire against the shared tactical_grid sim, DOM HUD, win/lose. Deeper XCOM
 * systems (overwatch, flanking crit, classes/abilities) layer onto the sim next.
 */
import * as THREE from "three";
// Resolve from the SAME (version-matched) URLs the boot used — a bare import is a
// different kernel instance (empty genre registry) and a cache-stale sim.
const _V = new URL(import.meta.url).search;
await import("../sim/tactical_grid.js" + _V); // sets window.FFG.sim.TacticalBattle
const { register3d } = await import("./ffg_kernel_3d.js" + _V);
// Procedural DARK MILITARISTIC SCI-FI score — version-matched like the kernel so a
// stale cache can't load an old copy. Unique per game (no shared audio asset).
const { createTacticalMusic } = await import("./ffg_voidmusic.js" + _V);

const T = 2.4;            // world units per tile
const TILE_TINT = { 0: 0x1b2738, 1: 0x39506b, 2: 0x6b5a30, 3: 0x877046, 4: 0x401818 };

function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  const c = (v) => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

// ── PBR uplift layer (Tier 2/3) ──────────────────────────────────────────────
// The "low-poly look" is the SHADING, not the poly count: flat high-roughness
// boxes never catch the IBL sky, so the world reads matte + dead. This layer
// gives world props/buildings/units cheap procedural NORMAL maps + sensible,
// VARIED roughness + envMapIntensity so the prefiltered sky environment actually
// shows up (micro relief + grazing reflections). Generated ONCE and cached — no
// per-frame allocation; the normal textures + materials are reused everywhere.
//
// Roles (roughness / metalness / which normal / envMapIntensity):
//   concrete   — buildings, enterable walls, jersey barriers, plinths (matte, micro-pitted)
//   metal      — shipping containers, dumpsters, AC units, deck rails, weapons (semi-reflective)
//   painted    — car/vehicle bodies (clear-coat-ish: low rough, faint metal, strong env)
//   glass      — car windows, kiosk/billboard faces (very low rough, high env -> mirror sky)
//   deck       — rooftop slabs / second-storey floor plates (worn, mild relief)
//   unit_armor — SWAT trooper plating (kept dark, mild metal so the sky grazes it)
//   unit_bot   — robot enemies (machined metal, brighter env so they read as hardware)
const _normTexCache = {};
function _procNormalTex(kind) {
  if (_normTexCache[kind]) return _normTexCache[kind];
  const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d");
  // 1) paint a tileable greyscale HEIGHT field per surface kind, then 2) emboss
  //    it into a tangent-space normal via a Sobel pass (same trick the ground uses).
  let seed = ((kind.charCodeAt(0) || 7) * 2654435761) >>> 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  g.fillStyle = "#808080"; g.fillRect(0, 0, S, S); // mid height
  if (kind === "concrete") {
    // fine aggregate speckle + a few hairline cracks
    for (let i = 0; i < 2600; i++) { const v = 110 + (rnd() * 70 | 0); g.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; g.fillRect(rnd() * S | 0, rnd() * S | 0, 1, 1); }
    g.strokeStyle = "rgba(60,60,60,0.7)"; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { g.beginPath(); let x = rnd() * S, y = rnd() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 26; y += (rnd() - 0.5) * 26; g.lineTo(x, y); } g.stroke(); }
  } else if (kind === "metal") {
    // brushed horizontal striations + occasional panel seam + rivets
    for (let y = 0; y < S; y++) { const v = 120 + (rnd() * 26 | 0); g.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.5)"; g.fillRect(0, y, S, 1); }
    g.fillStyle = "rgba(70,70,70,0.8)"; for (let x = 16; x < S; x += 32) g.fillRect(x, 0, 1, S);
    g.fillStyle = "rgba(200,200,200,0.7)"; for (let x = 8; x < S; x += 32) for (let y = 8; y < S; y += 32) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
  } else { // "panel" — subtle plate grid, the default for decks / slabs
    g.strokeStyle = "rgba(70,70,70,0.6)"; g.lineWidth = 1;
    for (let i = 16; i < S; i += 24) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    for (let i = 0; i < 900; i++) { const v = 120 + (rnd() * 40 | 0); g.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; g.fillRect(rnd() * S | 0, rnd() * S | 0, 1, 1); }
  }
  const img = g.getImageData(0, 0, S, S).data;
  const lum = (x, y) => { const i = (((y + S) % S) * S + ((x + S) % S)) * 4; return img[i]; };
  const ncv = document.createElement("canvas"); ncv.width = ncv.height = S; const ng = ncv.getContext("2d"); const nd = ng.createImageData(S, S);
  const str = kind === "metal" ? 1.4 : 2.0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const dx = (lum(x + 1, y) - lum(x - 1, y)) / 255, dy = (lum(x, y + 1) - lum(x, y - 1)) / 255;
    let nx = -dx * str, ny = -dy * str, nz = 1; const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= il; ny *= il; nz *= il;
    nd.data[i] = (nx * 0.5 + 0.5) * 255; nd.data[i + 1] = (ny * 0.5 + 0.5) * 255; nd.data[i + 2] = (nz * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
  }
  ng.putImageData(nd, 0, 0);
  const tex = new THREE.CanvasTexture(ncv);
  if (THREE.NoColorSpace) tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; tex.needsUpdate = true;
  _normTexCache[kind] = tex; return tex;
}
// role -> {rough, metal, norm, env, nscale, repeat} (repeat = normal-map tiling)
const PBR_ROLES = {
  concrete:   { rough: 0.82, metal: 0.04, norm: "concrete", env: 0.7,  nscale: 0.7,  repeat: 1.6 },
  metal:      { rough: 0.45, metal: 0.62, norm: "metal",    env: 1.15, nscale: 0.5,  repeat: 2.0 },
  painted:    { rough: 0.34, metal: 0.45, norm: "metal",    env: 1.25, nscale: 0.28, repeat: 1.4 },
  glass:      { rough: 0.08, metal: 0.20, norm: null,       env: 1.5,  nscale: 0,    repeat: 1 },
  deck:       { rough: 0.7,  metal: 0.12, norm: "panel",    env: 0.85, nscale: 0.5,  repeat: 1.3 },
  // units: NO tiling normal map (character UVs would smear a brushed pattern at
  // the wrong scale) — just roughness/metalness/env so the SWAT armor + robot
  // hulls catch the IBL sky and stop looking flat-shaded. Identity/tint preserved.
  unit_armor: { rough: 0.52, metal: 0.32, norm: null,       env: 1.0,  nscale: 0,    repeat: 1 },
  unit_bot:   { rough: 0.38, metal: 0.6,  norm: null,       env: 1.2,  nscale: 0,    repeat: 1 },
};
// Apply a PBR role to a single material (roughness/metalness/envMapIntensity +
// an optional shared normal map). `vary` jitters roughness deterministically per
// placement so a row of identical props isn't uniformly matte (the dead-flat tell).
function _applyRoleToMaterial(mat, role, vary) {
  if (!mat || !mat.isMeshStandardMaterial) return; // only PBR materials read IBL
  const R = PBR_ROLES[role]; if (!R) return;
  const v = (vary == null) ? 0 : (((vary % 7) / 7) - 0.5) * 0.18; // +/-0.09 roughness wobble
  mat.roughness = Math.max(0.04, Math.min(1, R.rough + v));
  mat.metalness = R.metal;
  if ("envMapIntensity" in mat) mat.envMapIntensity = R.env;
  if (R.norm && !mat.normalMap) {
    mat.normalMap = _procNormalTex(R.norm);
    if (mat.normalScale) mat.normalScale.set(R.nscale, R.nscale);
  }
  mat.needsUpdate = true;
}
// Walk an Object3D (a single mesh OR a group of Kenney GLB parts) and uplift
// every PBR material to `role`. For vehicles/props we auto-route dark, bluish
// sub-materials to the GLASS role so windows mirror the sky. Cheap; runs once.
function pbrApply(obj, role, vary) {
  if (!obj) return;
  obj.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.isMeshStandardMaterial) continue;
      let r = role;
      if ((role === "painted" || role === "metal") && m.color) {
        const nm = (m.name || "").toLowerCase();
        const isGlass = /glass|window|windshield|screen/.test(nm) || (m.color.b > m.color.r && (m.color.r + m.color.g + m.color.b) < 0.6);
        if (isGlass) r = "glass";
      }
      _applyRoleToMaterial(m, r, vary);
    }
  });
}


// One tileable tech-panel tile drawn to a canvas; repeated gridW×gridH over the
// floor plane so a big map stays one draw-call. Edge-symmetric so seams line up.
let _floorTex = null;
function makeFloorTexture() {
  if (_floorTex) return _floorTex;
  const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, "#26313f"); grd.addColorStop(0.5, "#2d3a4a"); grd.addColorStop(1, "#222c39");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // faint diagonal panel hatching
  g.strokeStyle = "rgba(255,255,255,0.025)"; g.lineWidth = 1;
  for (let i = -S; i < S * 2; i += 14) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); }
  // beveled tile border (split so the seam is symmetric across edges)
  const b = 6;
  g.fillStyle = "rgba(120,170,210,0.16)"; g.fillRect(0, 0, S, b); g.fillRect(0, 0, b, S);
  g.fillStyle = "rgba(0,0,0,0.30)"; g.fillRect(0, S - b, S, b); g.fillRect(S - b, 0, b, S);
  // inner inset frame + corner bolts
  g.strokeStyle = "rgba(95,208,255,0.10)"; g.lineWidth = 2; g.strokeRect(18, 18, S - 36, S - 36);
  g.fillStyle = "rgba(159,196,255,0.22)";
  for (const [bx, by] of [[24, 24], [S - 24, 24], [24, S - 24], [S - 24, S - 24]]) { g.beginPath(); g.arc(bx, by, 3.2, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; _floorTex = tex; return tex;
}

// Grid-AWARE baked ground: ONE texture for the whole plot drawn from the tile
// grid, so the ground itself reads as a city — asphalt streets, concrete
// sidewalks ringing every building, grass in the parks — instead of a uniform
// sci-fi panel tiled everywhere. The single biggest "real place vs blocks on a
// void" lever (XCOM research: dense, grounded, consistent surfaces).
function makeGroundTexture(grid, gw, gh) {
  const PX = 16, W = gw * PX, H = gh * PX;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const isB = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && grid[y][x] === 1;
  const near = (x, y) => isB(x - 1, y) || isB(x + 1, y) || isB(x, y - 1) || isB(x, y + 1) ||
    isB(x - 1, y - 1) || isB(x + 1, y - 1) || isB(x - 1, y + 1) || isB(x + 1, y + 1);
  // deterministic speckle (asphalt/concrete grain) — seeded so it's stable
  let s = (gw * 73856093 ^ gh * 19349663) >>> 0;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const t = grid[y][x];
    let base;
    if (t === 4) base = ["#2c4528", "#314c2b", "#26401f"][((x ^ y) % 3 + 3) % 3];        // park grass
    else if (t === 1 || near(x, y)) base = ["#44454b", "#494a51", "#3f4046"][((x + y) % 3)]; // concrete sidewalk/foundation
    else base = ["#2a2a30", "#2d2d33", "#26262b"][((x * 3 + y) % 3)];                       // asphalt street
    g.fillStyle = base; g.fillRect(x * PX, y * PX, PX, PX);
    // grain
    for (let k = 0; k < 5; k++) {
      const gx = x * PX + (rnd() * PX | 0), gy = y * PX + (rnd() * PX | 0);
      g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.10)";
      g.fillRect(gx, gy, 1, 1);
    }
    if (t === 4) for (let k = 0; k < 3; k++) { g.fillStyle = "rgba(120,170,90,0.18)"; g.fillRect(x * PX + (rnd() * PX | 0), y * PX + (rnd() * PX | 0), 1, 2); }
    // occasional MANHOLE on asphalt streets (dark disc + ring)
    if (t === 0 && !near(x, y) && rnd() < 0.05) {
      const cx = x * PX + PX / 2, cy = y * PX + PX / 2, r = PX * 0.3;
      g.fillStyle = "#161616"; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.strokeStyle = "rgba(90,90,96,0.6)"; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    }
    // subtle tactical grid seam (so tiles stay readable for movement)
    g.strokeStyle = "rgba(0,0,0,0.16)"; g.lineWidth = 1; g.strokeRect(x * PX + 0.5, y * PX + 0.5, PX - 1, PX - 1);
  }
  // faint dashed lane markings down long open street runs (horizontal + vertical)
  g.fillStyle = "rgba(196,176,96,0.30)";
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    if (grid[y][x] !== 0) continue;
    const hRoad = grid[y][x - 1] === 0 && grid[y][x + 1] === 0 && (isB(x, y - 2) || isB(x, y + 2));
    if (hRoad && (x % 3 === 0)) g.fillRect(x * PX + PX * 0.3, y * PX + PX * 0.46, PX * 0.4, 1.5);
  }
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; tex.needsUpdate = true;
  // PBR companions: a NORMAL map (micro surface relief from the albedo grain +
  // tile seams as grooves) and a ROUGHNESS map (asphalt rough, with scattered WET
  // patches that go smooth → they catch the IBL sky = the wet-dusk-street look).
  // Built by reading the albedo back, so detail lines up with what you see.
  let normalMap = null, roughnessMap = null;
  try {
    const img = g.getImageData(0, 0, W, H).data;
    const lum = (x, y) => { const i = (((y + H) % H) * W + ((x + W) % W)) * 4; return (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114); };
    const ncv = document.createElement("canvas"); ncv.width = W; ncv.height = H; const ng = ncv.getContext("2d"); const nd = ng.createImageData(W, H);
    const rcv = document.createElement("canvas"); rcv.width = W; rcv.height = H; const rg = rcv.getContext("2d"); const rd = rg.createImageData(W, H);
    let ws = (gw * 2654435761 ^ gh * 40503) >>> 0; const wr = () => (ws = (ws * 1103515245 + 12345) >>> 0) / 4294967296;
    // sparse wet-puddle centres on the open streets
    const puddles = []; for (let i = 0; i < Math.max(6, (gw * gh) / 90); i++) puddles.push([wr() * W, wr() * H, (10 + wr() * 26)]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Sobel-ish normal from albedo luminance (cheap emboss)
      const dx = (lum(x + 1, y) - lum(x - 1, y)) / 255, dy = (lum(x, y + 1) - lum(x, y - 1)) / 255;
      const str = 2.2; let nx = -dx * str, ny = -dy * str, nz = 1;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= il; ny *= il; nz *= il;
      nd.data[i] = (nx * 0.5 + 0.5) * 255; nd.data[i + 1] = (ny * 0.5 + 0.5) * 255; nd.data[i + 2] = (nz * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
      // roughness: base rough; wet puddles smooth (low) so they mirror the sky
      let rough = 0.82; for (const p of puddles) { const d = Math.hypot(x - p[0], y - p[1]); if (d < p[2]) rough = Math.min(rough, 0.26 + 0.5 * (d / p[2])); }
      // MANHOLE iron (the near-black #161616 discs baked into the albedo) reads as
      // polished cast metal: drop its roughness hard so it grazes the IBL sky.
      if (img[i] < 28 && img[i + 1] < 28 && img[i + 2] < 28) rough = 0.22;
      const rv = (rough * 255) | 0; rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = rv; rd.data[i + 3] = 255;
    }
    ng.putImageData(nd, 0, 0); rg.putImageData(rd, 0, 0);
    normalMap = new THREE.CanvasTexture(ncv); roughnessMap = new THREE.CanvasTexture(rcv);
    for (const m of [normalMap, roughnessMap]) { if (THREE.NoColorSpace) m.colorSpace = THREE.NoColorSpace; m.anisotropy = 8; m.needsUpdate = true; }
  } catch (e) {}
  return { map: tex, normalMap: normalMap, roughnessMap: roughnessMap };
}

// Building facades as a small CACHED set of textures (a window grid baked once),
// not a mesh per window pane — so a 60×60 map of towers stays a few thousand
// draw-calls instead of tens of thousands. Returns {map, glow} pairs: `map` is a
// neutral grey wall + windows (tinted per-building via material.color); `glow` is
// black walls + white lit windows for the emissiveMap (only windows bloom).
let _facades = null;
function buildingFacades() {
  if (_facades) return _facades;
  _facades = [];
  for (let v = 0; v < 6; v++) {
    const Wd = 96, Ht = 128, cols = 3, rows = 4;
    const cMap = document.createElement("canvas"); cMap.width = Wd; cMap.height = Ht;
    const cGlow = document.createElement("canvas"); cGlow.width = Wd; cGlow.height = Ht;
    const m = cMap.getContext("2d"), gl = cGlow.getContext("2d");
    m.fillStyle = "#5a626e"; m.fillRect(0, 0, Wd, Ht);          // neutral wall (tinted by material.color)
    m.fillStyle = "rgba(0,0,0,0.18)"; for (let i = 0; i < Wd; i += 6) m.fillRect(i, 0, 1, Ht); // faint vertical seams
    gl.fillStyle = "#000"; gl.fillRect(0, 0, Wd, Ht);
    const pad = 12, gw = (Wd - pad * (cols + 1)) / cols, gh = (Ht - pad * (rows + 1)) / rows;
    let seed = (v * 2654435761) >>> 0;
    const nx = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = pad + c * (gw + pad), y = pad + r * (gh + pad);
      const lit = nx() > 0.66;
      m.fillStyle = lit ? "#cfe6ff" : "#1a2632"; m.fillRect(x, y, gw, gh);
      m.strokeStyle = "rgba(10,16,24,0.7)"; m.lineWidth = 2; m.strokeRect(x, y, gw, gh);
      gl.fillStyle = lit ? "#ffffff" : "#000000"; gl.fillRect(x, y, gw, gh);
    }
    const map = new THREE.CanvasTexture(cMap), glow = new THREE.CanvasTexture(cGlow);
    if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = glow.wrapS = glow.wrapT = THREE.RepeatWrapping;
    _facades.push({ map, glow });
  }
  return _facades;
}

// Dusk SKY gradient (steel-blue twilight — the XCOM 2 city/slums look): a tall
// vertical canvas gradient used as scene.background, warm haze at the horizon.
const _skyCache = {};
function makeSkyTexture(night) {
  const key = night ? "night" : "dusk";
  if (_skyCache[key]) return _skyCache[key];
  const c = document.createElement("canvas"); c.width = 8; c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  if (night) {
    grd.addColorStop(0.00, "#05080f"); // near-black zenith
    grd.addColorStop(0.45, "#0a1426"); // deep night blue
    grd.addColorStop(0.76, "#16243f"); // horizon indigo
    grd.addColorStop(0.92, "#243450"); // moonlit haze
    grd.addColorStop(1.00, "#33415c"); // cool horizon glow
  } else {
    grd.addColorStop(0.00, "#060d1c"); // deep moody zenith
    grd.addColorStop(0.45, "#102038"); // mid sky
    grd.addColorStop(0.78, "#1b3150"); // horizon steel-blue (darker, no whiteout)
    grd.addColorStop(0.92, "#283142"); // muted haze band
    grd.addColorStop(1.00, "#372c2a"); // dim warm dusk at the very bottom
  }
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  _skyCache[key] = tex; return tex;
}

register3d("tactics3d", async (kernel, content) => {
  const scene = kernel.scene;
  const TB = window.FFG.sim.TacticalBattle;
  const missions = (content.missions && content.missions.length) ? content.missions : [content];
  // Strategic meta-layer (Phase 4): a persistent campaign decides WHICH mission
  // deploys and WHO is in the squad. Falls back to a one-off if unavailable.
  const campaign = (window.FFG && window.FFG.Campaign && missions.length > 1)
    ? new window.FFG.Campaign(content.slug || "tactics", missions) : null;
  const campaignRun = !!(campaign && campaign.isActive());
  let missionIndex = campaignRun ? campaign.currentMission()
    : Math.max(0, Math.min((window.__FFG_TACTICS_MISSION__ | 0), missions.length - 1));
  let mission = missions[missionIndex];
  // squad that actually deploys this mission (campaign roster overlay, or content)
  const deployUnits = campaignRun ? campaign.rosterForMission(mission) : mission.player_units;

  const gridH = mission.grid.length, gridW = mission.grid[0].length;
  const W = gridW * T, H = gridH * T;
  // world position of a tile centre (board centred on origin; +z = "south")
  const cell = (x, y) => new THREE.Vector3((x + 0.5) * T - W / 2, 0, (y + 0.5) * T - H / 2);

  // TIME OF DAY — warm DUSK (low sun) vs cool MOONLIT NIGHT (darker, lit windows
  // pop). Night falls on odd missions + the finale, so a campaign cycles day/night
  // like XCOM. We only RECOLOUR the existing lights here — never ADD a runtime
  // light (that recompiles every shader and freezes the game); the mood swing is
  // colour + sky + fog + exposure + a celestial disc.
  const _night = (missionIndex % 2 === 1) || (missionIndex === missions.length - 1);
  const TOD = _night
    ? { fog: 0x070e1c, fogD: 0.0072, key: 0xaec6ff, keyI: 1.35, fill: 0x35507e, fillI: 0.32, rim: 0x6fb0d8, rimI: 0.8, hemiS: 0x3c5070, hemiG: 0x121020, hemiI: 0.6, amb: 0x46566f, ambI: 0.26, exp: 1.0, disc: 0xe2e9ff, discR: 2.0, discO: 0.95 }
    : { fog: 0x101c30, fogD: 0.0066, key: 0xffd7a0, keyI: 1.95, fill: 0x6b88c0, fillI: 0.42, rim: 0x9fd8e8, rimI: 1.0, hemiS: 0x8aa0c4, hemiG: 0x241f24, hemiI: 0.78, amb: 0x7e8ea8, ambI: 0.36, exp: 1.04, disc: 0xffce93, discR: 2.6, discO: 0.78 };
  scene.background = makeSkyTexture(_night);
  // IBL — light every PBR material from the sky (sky-tinted ambient + faint
  // reflections), the biggest "not flat-lit" jump. Modest intensity so it adds
  // material realism without washing out the moody key/shadow contrast.
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, _night ? 0.35 : 0.55);
  scene.fog = new THREE.FogExp2(TOD.fog, TOD.fogD);
  try { kernel.renderer.shadowMap.type = THREE.PCFSoftShadowMap; } catch (e) {}
  const key = new THREE.DirectionalLight(TOD.key, TOD.keyI); key.position.set(58, 44, 24); key.castShadow = true; // sun (dusk) / moon (night), low angle
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -60; key.shadow.camera.right = 60; key.shadow.camera.top = 60; key.shadow.camera.bottom = -60; key.shadow.camera.far = 240;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.045; scene.add(key);
  scene.add(new THREE.DirectionalLight(TOD.fill, TOD.fillI).translateX(-46).translateY(38).translateZ(-20)); // cool sky fill
  const rim = new THREE.DirectionalLight(TOD.rim, TOD.rimI); rim.position.set(-24, 30, -72); scene.add(rim); // cool teal-ish rim (ADVENT)
  scene.add(new THREE.HemisphereLight(TOD.hemiS, TOD.hemiG, TOD.hemiI)); // sky-fill tinted to the hour
  const _amb = new THREE.AmbientLight(TOD.amb, TOD.ambI); scene.add(_amb); // lower → deep XCOM shadows (NV boosts this)
  kernel.renderer.toneMapping = THREE.ACESFilmicToneMapping; kernel.renderer.toneMappingExposure = TOD.exp;
  // Tier-3 post: GTAO (preferred over SSAO) + tight bloom + SMAA edge AA. Bloom
  // kept inside the no-whiteout envelope (strength <= 0.35, threshold >= 0.85) so
  // only true highlights bloom; GTAO grounds props/units, SMAA cleans silhouettes.
  if (kernel.enableBloom) kernel.enableBloom({ strength: _night ? 0.34 : 0.3, radius: 0.6, threshold: _night ? 0.85 : 0.86, ssao: true, gtao: false, ssaoRadius: 1.1, aoIntensity: 0.9, smaa: true }); // GTAO dropped — too costly; SSAO+SMAA+bloom kept
  // SUN / MOON disc high in the sky, in the key-light direction (emissive billboard,
  // NOT a light). fog:false so it stays crisp; bloom turns it into a soft glow.
  try {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(T * TOD.discR, 32),
      new THREE.MeshBasicMaterial({ color: TOD.disc, transparent: true, opacity: TOD.discO, fog: false }));
    disc.position.set(W * 0.42, H * 0.6, -H * 0.66); disc.lookAt(0, 0, 0); scene.add(disc);
  } catch (e) {}
  // Cinematic vignette (DOM overlay under the HUD) — frames the action + adds depth.
  try {
    const _vig = document.createElement("div");
    Object.assign(_vig.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "4",
      background: "radial-gradient(135% 115% at 50% 46%, rgba(0,0,0,0) 62%, rgba(2,6,14,0.34) 100%)" });
    kernel.parent.appendChild(_vig);
  } catch (e) {}

  // ── NIGHT VISION (toggle: V / the HUD chip) ─────────────────────────────────
  // Brightens the field with a green-phosphor wash so you can fight in the dark —
  // boosts the EXISTING ambient light + tone-map exposure (never adds a runtime
  // light) and lays a green NV overlay. Auto-armed on night missions as a hint.
  let _nvOn = false, _nvOverlay = null, _nvChip = null;
  const _baseExp = TOD.exp, _baseAmbI = TOD.ambI;
  // Night vision is LOOT-GATED (XCOM-style): you can only use it once the squad has
  // recovered NIGHT OPTICS — from a field loot drop this mission, or the campaign
  // inventory (a prior recovery). Not a free toggle.
  function _hasNightOptics() {
    try { if (sim && sim.hasSalvage && sim.hasSalvage("night_optics")) return true; } catch (e) {}
    try { if (campaignRun && campaign.state.inventory && campaign.state.inventory.some((it) => it.def === "night_optics")) return true; } catch (e) {}
    return false;
  }
  function _updateNVChip() {
    if (!_nvChip) return;
    if (!_hasNightOptics()) { _nvChip.textContent = "◐ NIGHT VISION 🔒"; _nvChip.style.color = "#6b7b92"; _nvChip.style.borderColor = "#2a3a52"; _nvChip.title = "Recover Night Optics from a fallen enemy to unlock"; return; }
    _nvChip.textContent = "◐ NIGHT VISION " + (_nvOn ? "ON" : "OFF") + "  (V)";
    _nvChip.style.color = _nvOn ? "#39ff9a" : "#9fb6d8"; _nvChip.style.borderColor = _nvOn ? "#39ff9a" : "#2a3a52";
  }
  function setNightVision(on) {
    _nvOn = !!on;
    try { kernel.renderer.toneMappingExposure = _nvOn ? _baseExp * 1.7 : _baseExp; } catch (e) {}
    if (_amb) _amb.intensity = _nvOn ? _baseAmbI * 2.7 : _baseAmbI;
    if (_nvOn && !_nvOverlay) {
      _nvOverlay = document.createElement("div");
      Object.assign(_nvOverlay.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "5", mixBlendMode: "screen",
        background: "radial-gradient(120% 100% at 50% 48%, rgba(46,255,150,0.12), rgba(0,38,16,0.20))",
        boxShadow: "inset 0 0 160px rgba(0,40,18,0.6)" });
      kernel.parent.appendChild(_nvOverlay);
    }
    if (_nvOverlay) _nvOverlay.style.display = _nvOn ? "block" : "none";
    _updateNVChip();
  }
  function toggleNightVision() {
    if (!_nvOn && !_hasNightOptics()) { try { setHUD("◐ No NIGHT OPTICS — recover one from a fallen enemy in the field"); } catch (e) {} return; }
    setNightVision(!_nvOn);
  }
  try {
    _nvChip = document.createElement("button");
    Object.assign(_nvChip.style, { position: "absolute", right: "14px", bottom: "62px", zIndex: "50", cursor: "pointer",
      font: "600 12px 'Segoe UI',monospace", color: "#9fb6d8", background: "rgba(10,16,24,0.72)", border: "1px solid #2a3a52", borderRadius: "7px", padding: "6px 10px" });
    _nvChip.textContent = "◐ NIGHT VISION 🔒";
    _nvChip.onclick = toggleNightVision;
    kernel.parent.appendChild(_nvChip);
  } catch (e) {}

  // ── TACTICAL MAP / minimap (TAB) ────────────────────────────────────────────
  // A top-down 2D overview of the whole plot: terrain, objective, loot, your squad
  // (cyan) and any SPOTTED hostiles (red; boss = bright red). The navigation read
  // XCOM-scale maps need. Toggle with TAB or the chip; redraws live while open.
  let _miniOn = false, _miniWrap = null, _miniCv = null, _miniAcc = 0;
  function _drawMinimap() {
    if (!_miniCv || !sim) return;
    const g = sim.grid, H = g.length, W = g[0].length, cv = _miniCv, cx = cv.getContext("2d"), ps = cv.width / W;
    cx.fillStyle = "#070b12"; cx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = g[y][x]; let c = null;
      if (t === 0 || t === 4) c = "#1a2434"; else if (t === 2 || t === 3) c = "#3a4760";
      else if (t === 1) c = "#0e141d"; else if (t === 5) c = "#283750"; else if (t === 6 || t === 7 || t === 8) c = "#46618a";
      if (c) { cx.fillStyle = c; cx.fillRect(x * ps, y * ps, Math.ceil(ps), Math.ceil(ps)); }
    }
    const goal = sim.goal;
    if (goal && goal.target) { cx.fillStyle = "#34d6e8"; cx.fillRect(goal.target.x * ps - 1, goal.target.y * ps - 1, ps + 2, ps + 2); }
    ((goal && goal.evac) || []).forEach((p) => { cx.fillStyle = "#3ddc84"; cx.fillRect(p.x * ps, p.y * ps, ps + 1, ps + 1); });
    (sim.loot || []).forEach((L) => { cx.fillStyle = "#ffd27a"; cx.fillRect(L.x * ps, L.y * ps, ps + 1, ps + 1); });
    const dot = (u, col, r) => { cx.fillStyle = col; cx.beginPath(); cx.arc(u.x * ps + ps / 2, u.y * ps + ps / 2, r, 0, 7); cx.fill(); };
    sim.aliveAllies().forEach((u) => dot(u, u === selected ? "#ffffff" : "#4fd0ff", Math.max(1.8, ps * 0.7)));
    sim.aliveEnemies().forEach((u) => { if (sim.podRevealed(u.pod)) dot(u, u.boss ? "#ff2a3a" : "#ff6a4a", Math.max(1.8, ps * (u.boss ? 1.0 : 0.7))); });
  }
  function toggleMinimap(force) {
    if (!sim) return;
    _miniOn = (force != null) ? force : !_miniOn;
    if (_miniOn && !_miniWrap) {
      try {
        const g = sim.grid, W = g[0].length, H = g.length, scale = Math.max(2.2, Math.min(280 / W, 230 / H, 6));
        _miniWrap = document.createElement("div");
        Object.assign(_miniWrap.style, { position: "absolute", top: "54px", right: "14px", zIndex: "60", padding: "9px", background: "rgba(8,12,20,0.9)", border: "1px solid #34d6e8", borderRadius: "10px", boxShadow: "0 10px 34px rgba(0,0,0,0.55)" });
        const ttl = document.createElement("div"); Object.assign(ttl.style, { font: "700 11px 'Segoe UI',monospace", letterSpacing: "2px", color: "#34d6e8", marginBottom: "6px" }); ttl.textContent = "◰ TACTICAL MAP  (TAB)"; _miniWrap.appendChild(ttl);
        _miniCv = document.createElement("canvas"); _miniCv.width = Math.round(W * scale); _miniCv.height = Math.round(H * scale); _miniCv.style.display = "block"; _miniWrap.appendChild(_miniCv);
        kernel.parent.appendChild(_miniWrap);
      } catch (e) { _miniOn = false; return; }
    }
    if (_miniWrap) _miniWrap.style.display = _miniOn ? "block" : "none";
    if (_miniOn) _drawMinimap();
  }
  kernel.onUpdate((dt) => { if (!_miniOn) return; _miniAcc += dt; if (_miniAcc < 0.3) return; _miniAcc = 0; _drawMinimap(); });

  let sim, events = [], busy = false, selected = null, phase = "menu";
  // ONE procedural tactical-music instance for the whole session. Started on the
  // Play click (the audio gesture), stopped/restarted on pause/resume + end. This
  // REPLACES the shell's file-music (shell `music:` is set to null below) so we
  // never double up audio — the owner already hit a double-audio bug elsewhere.
  const tacticalMusic = createTacticalMusic(0.14); // dark droning pad + minor ostinato + sparse war-drum
  const unitViews = {}; // id -> { group, ring, hpFill, base }
  let highlights = [], rangeTargets = [];
  let abilityMode = null;     // armed ability id (Phase 3) — next click resolves it
  const coverTiles = {};      // "x,y" -> [meshes] so frag can shred cover visually
  const buildingTiles = {};   // "x,y" -> [meshes] so frag can demolish a wall
  // Combat + UI audio — resolves a name from content.sfx and plays via the
  // kernel (which scales by the Settings SFX-volume slider, no-ops if missing).
  function sfx(name, vol) { const u = content.sfx && content.sfx[name]; if (u) kernel.playSound(u, vol == null ? 0.55 : vol); }

  // Field LOOT pool (XCOM 2 model): a kill MAY drop one of these as a timed marker
  // you must reach with a soldier. Night Optics is what UNLOCKS night vision.
  const LOOT_TABLE = [
    { id: "night_optics",   name: "Night Optics" },
    { id: "combat_scope",   name: "Combat Scope" },
    { id: "battle_scanner", name: "Battle Scanner" },
    { id: "ap_rounds",      name: "AP Rounds" },
    { id: "alloy_plating",  name: "Alloy Plating" },
    { id: "elerium_core",   name: "Elerium Core" },
  ];
  // DIFFICULTY (XCOM Rookie/Veteran/Commander). Per research_xcom_deep difficulty_knobs,
  // the top levers are enemy HP + aim (pod size is fixed by the generator). The sim is
  // built at init (menu backdrop) BEFORE the player picks, so we scale the live enemy
  // units in place from their stored BASE stats — applied at build AND when PLAY is
  // chosen. Persisted so auto-advanced campaign missions keep the choice.
  const DIFF = { rookie: { aim: 0.85, hp: 0.8 }, veteran: { aim: 1.0, hp: 1.0 }, commander: { aim: 1.12, hp: 1.25 } };
  let difficulty = "veteran";
  try { difficulty = (window.localStorage.getItem("ffg_void_difficulty") || "veteran").toLowerCase(); } catch (e) {}
  if (!DIFF[difficulty]) difficulty = "veteran";
  function applyDifficulty() {
    if (!sim) return;
    const k = DIFF[difficulty] || DIFF.veteran;
    (sim.enemy_units || []).forEach((e) => {
      if (e._baseAim == null) { e._baseAim = e.aim; e._baseMaxHp = e.maxHp; } // stamp base once
      if (e._baseAim != null) e.aim = Math.max(0.2, Math.min(0.95, e._baseAim * k.aim));
      e.maxHp = Math.max(1, Math.round(e._baseMaxHp * k.hp));
      e.hp = e.maxHp; // full health at mission start (only ever called pre-battle)
    });
  }
  function buildSim() {
    events = [];
    sim = new TB({
      grid: mission.grid, upper: mission.upper || null, player_units: deployUnits, enemy_units: mission.enemy_units,
      seed: content.seed != null ? content.seed : 12345,
      goal: mission.goal || {},
      lootTable: LOOT_TABLE, lootChance: 0.4, lootTurns: 3,
      onEvent: (type, payload) => events.push({ type, payload }),
    });
    applyDifficulty(); // scale the freshly-built enemy roster to the current difficulty
  }

  // ── Board ─────────────────────────────────────────────────────────────────
  // Big maps: ONE tiled floor plane + a single invisible ground plane for
  // raycasting (convert hit point -> tile), instead of a mesh per tile. Keeps
  // draw-calls + hit-testing cheap so the map can be XCOM-scale.
  const FT = 0.16; // floor-top height
  let groundPlane = null;
  function tileAt(px, pz) {
    const x = Math.floor((px + W / 2) / T), y = Math.floor((pz + H / 2) / T);
    return (x >= 0 && y >= 0 && x < gridW && y < gridH) ? { x, y } : null;
  }
  // Distant CITY SKYLINE: the town CONTINUES past the playfield as organized
  // BLOCKS — rows of window-faced towers separated by street gaps, receding into
  // the dusk fog — not boxes scattered at random. Towers carry the same baked
  // window facade as the play-area buildings (dim/distant) so the backdrop reads
  // as a real city, taller toward the back. A handful of SHARED materials + ONE
  // shared box geometry keep this to a few dozen extra draw calls + materials.
  function buildSkyline() {
    const hx = W / 2, hz = H / 2, gap = T * 8, margin = T * 40;
    const blk = T * 7, road = T * 3.2, cell2 = blk + road; // block + street pitch
    let seed = 0x1234abcd;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const facs = buildingFacades();
    // a small SHARED material set (window facade, tinted to a few concrete tones),
    // reused across every distant tower — keeps material count tiny.
    const tones = [0x16202f, 0x1a2434, 0x131b29, 0x1e2638];
    const skyMats = tones.map((c, i) => {
      const f = facs[i % facs.length];
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0.06, map: f.map, emissive: 0xffc070, emissiveIntensity: 0.05, emissiveMap: f.glow });
      m.map.repeat.set(1, 2); m.emissiveMap && m.emissiveMap.repeat && m.emissiveMap.repeat.set(1, 2);
      return m;
    });
    let n = 0;
    for (let px = -hx - margin; px <= hx + margin; px += cell2) {
      for (let pz = -hz - margin; pz <= hz + margin; pz += cell2) {
        if (Math.abs(px) <= hx + gap && Math.abs(pz) <= hz + gap) continue; // keep the playfield clear
        if (rnd() > 0.82) continue;            // a few empty lots
        // farther from the centre → taller towers (a real skyline rises behind you)
        const dist = Math.max(Math.abs(px), Math.abs(pz)) - hx;
        const tier = Math.max(0, Math.min(1, dist / (margin * 0.9)));
        // 1–3 towers per block (a clustered block, not one lonely box)
        const towers = 1 + (rnd() * 2 | 0);
        for (let t = 0; t < towers; t++) {
          const tw = blk * (0.34 + rnd() * 0.3), td = blk * (0.34 + rnd() * 0.3);
          const th = T * (4 + tier * 12 + rnd() * 7);
          const m = new THREE.Mesh(geo, skyMats[(n + t) % skyMats.length]);
          m.scale.set(tw, th, td);
          m.position.set(px + (rnd() - 0.5) * blk * 0.5, th / 2 - T * 0.5, pz + (rnd() - 0.5) * blk * 0.5);
          m.castShadow = false; m.receiveShadow = false; // distant backdrop — never in the shadow pass
          scene.add(m); n++;
        }
      }
    }
  }
  // Ambient dusk atmosphere: warm dust motes / embers drifting up through the
  // low sun — slow additive points. Cheap, adds "lived-in air".
  function buildAmbientMotes() {
    const N = 90, geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * W; pos[i * 3 + 1] = Math.random() * T * 9; pos[i * 3 + 2] = (Math.random() - 0.5) * H; }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffcf9a, size: T * 0.07, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(pts);
    kernel.onUpdate((dt) => { const p = geo.attributes.position.array; for (let i = 0; i < N; i++) { p[i * 3 + 1] += dt * T * 0.35; if (p[i * 3 + 1] > T * 9) p[i * 3 + 1] = 0; } geo.attributes.position.needsUpdate = true; });
  }
  // ── CITY ANALYSIS — turn the raw tile grid into an URBAN-AWARE model so props
  //    land where they belong in a real town (cars parallel to the curb, hydrants
  //    along sidewalks, dumpsters in alleys, cones at intersections) instead of
  //    scattered at random angles. Computed ONCE per map (deterministic), then
  //    read by buildCover / scatterDecor / buildCurbs. The owner's core fix.
  let _ci = null; // city info: { solid, isStreet, front[], axis[], alley[], inter[], frontage[] }
  function analyzeCity() {
    if (_ci) return _ci;
    const grid = mission.grid;
    const solid = (x, y) => { const t = (grid[y] || [])[x]; return t === 1 || t === 5; }; // a building face blocks/anchors props
    const open = (x, y) => (grid[y] || [])[x] === 0;
    const front = [], axis = [], alley = [], inter = [], curbDir = [];
    const CARD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // run length of open tiles through (x,y) along an axis (how "street-like" it is)
    const run = (x, y, dx, dy) => { let n = 0; for (let k = 1; k <= 6; k++) { if (open(x + dx * k, y + dy * k)) n++; else break; } for (let k = 1; k <= 6; k++) { if (open(x - dx * k, y - dy * k)) n++; else break; } return n; };
    for (let y = 0; y < gridH; y++) {
      front[y] = []; axis[y] = []; alley[y] = []; inter[y] = []; curbDir[y] = [];
      for (let x = 0; x < gridW; x++) {
        if (!open(x, y)) { front[y][x] = null; continue; }
        // nearest building face (the curb the sidewalk hugs). Prefer a face that is
        // exactly 1 tile away (true curb tile); record its direction.
        let fd = null, walls = 0;
        for (const [dx, dy] of CARD) { if (solid(x + dx, y + dy)) { if (!fd) fd = [dx, dy]; walls++; } }
        front[y][x] = fd; curbDir[y][x] = fd;
        // road axis: the longer open run is the direction traffic flows
        const rh = run(x, y, 1, 0), rv = run(x, y, 0, 1);
        axis[y][x] = rh >= rv ? "h" : "v";
        // alley: hemmed in by buildings on 3+ sides → back-of-house (dumpsters)
        alley[y][x] = walls >= 3;
        // intersection: a broad opening (long runs BOTH ways, no adjacent wall) → cones/barriers
        inter[y][x] = (rh >= 4 && rv >= 4 && walls === 0);
      }
    }
    _ci = { solid, open, front, axis, alley, inter, curbDir, run };
    return _ci;
  }
  // Raised concrete CURBS + painted CROSSWALKS — physical street geometry along the
  // building frontages so the sidewalk reads as a real raised kerb, not a paint
  // line. Thin shared-geometry boxes (no shadow casting; instanced material) laid
  // on the open side of every building face. The single cheapest "real concrete"
  // tell after the baked ground. Visual only — no cover, no collision.
  function buildCurbs() {
    const ci = analyzeCity(), grid = mission.grid;
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x5b5f67, roughness: 0.92, metalness: 0.05, envMapIntensity: 0.7 });
    const curbTopMat = new THREE.MeshStandardMaterial({ color: 0x6a6e76, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.7 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xb9b08a, roughness: 0.85, metalness: 0.04, emissive: 0x423d2a, emissiveIntensity: 0.12 });
    const curbGeoH = new THREE.BoxGeometry(T, T * 0.1, T * 0.12); // curb segment spanning X (faces N/S)
    const curbGeoV = new THREE.BoxGeometry(T * 0.12, T * 0.1, T);  // curb segment spanning Z (faces E/W)
    const capGeoH = new THREE.BoxGeometry(T, T * 0.03, T * 0.13);
    const capGeoV = new THREE.BoxGeometry(T * 0.13, T * 0.03, T);
    const stripeGeo = new THREE.BoxGeometry(T * 0.16, 0.02, T * 0.5);
    let placed = 0;
    for (let y = 1; y < gridH - 1; y++) for (let x = 1; x < gridW - 1; x++) {
      if (!ci.open(x, y)) continue;
      const w = cell(x, y);
      // a curb on every open edge that borders a building face (the kerb line)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!ci.solid(x + dx, y + dy)) continue;
        const horiz = dx === 0; // wall is N/S of us → curb runs E-W (spanning X)
        const curb = new THREE.Mesh(horiz ? curbGeoH : curbGeoV, curbMat);
        curb.position.set(w.x + dx * T * 0.46, FT + T * 0.05, w.z + dy * T * 0.46);
        curb.receiveShadow = true; curb.castShadow = false; scene.add(curb);
        const cap = new THREE.Mesh(horiz ? capGeoH : capGeoV, curbTopMat);
        cap.position.set(w.x + dx * T * 0.46, FT + T * 0.105, w.z + dy * T * 0.46);
        cap.castShadow = false; scene.add(cap);
        placed++;
      }
      // CROSSWALK: zebra stripes across intersections (broad openings)
      if (ci.inter[y][x] && ((x + y) % 5 === 0)) {
        for (let s = -2; s <= 2; s++) {
          const st = new THREE.Mesh(stripeGeo, stripeMat);
          st.position.set(w.x + s * T * 0.2, FT + 0.012, w.z); st.castShadow = false; scene.add(st);
        }
      }
    }
    return placed;
  }
  async function buildBoard() {
    await preloadCity(); // load the real CC0 models before placing tiles
    analyzeCity();       // urban-aware placement model (curbs, road axes, alleys)
    buildSkyline();
    buildAmbientMotes();
    const plat = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.6, H + 1.4),
      new THREE.MeshStandardMaterial({ color: 0x0c1626, roughness: 0.9, metalness: 0.2 }));
    plat.position.set(0, -0.35, 0); plat.receiveShadow = true; scene.add(plat);
    // Grid-aware baked city ground (asphalt streets + concrete sidewalks + grass).
    const gtex = makeGroundTexture(mission.grid, gridW, gridH);
    const fmat = new THREE.MeshStandardMaterial({ map: gtex.map, color: 0xb9bcc4, roughness: 1.0, metalness: 0.14, envMapIntensity: 0.95 });
    if (gtex.normalMap) { fmat.normalMap = gtex.normalMap; fmat.normalScale = new THREE.Vector2(0.55, 0.55); } // micro surface relief
    if (gtex.roughnessMap) fmat.roughnessMap = gtex.roughnessMap; // wet patches go reflective (mirror the IBL sky)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), fmat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, FT, 0); floor.receiveShadow = true; scene.add(floor);
    groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ visible: false }));
    groundPlane.rotation.x = -Math.PI / 2; groundPlane.position.set(0, FT + 0.02, 0); scene.add(groundPlane);

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const t = mission.grid[y][x];
        const w = cell(x, y);
        if (t === 1) { buildStructure(x, y, w); continue; }
        if (t === 5) { buildWall(x, y, w); continue; } // enterable building: low open-top wall
        if (t === 6) { buildDeck(x, y, w); continue; }  // raised rooftop deck (high ground)
        if (t === 7) { buildRamp(x, y, w); continue; }  // ramp/stairs up to a deck
        if (t === 8) { buildStairBase(x, y, w); continue; } // ground-floor foot of an interior staircase
        if (t === 2 || t === 3) buildCover(x, y, w, t === 3);
        else if (t === 4) buildHazard(w);
      }
    }
    buildUpperFloor(); // raised second storey (rooms above rooms), if this map has one
    buildCurbs();      // raised concrete kerbs along every building frontage + crosswalks
    scatterDecor();
    scatterAdvent();
    // PERF: small ground clutter doesn't need to cast shadows — the shadow pass was
    // re-rendering ~2600 casters/frame. Keep shadows only on sizable objects
    // (buildings/walls/decks); units (built later) keep theirs. Big FPS win.
    try {
      let _off = 0;
      scene.traverse((o) => {
        if (!o.isMesh || !o.castShadow) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const bs = o.geometry.boundingSphere;
        const r = (bs ? bs.radius : 0) * Math.max(o.scale.x, o.scale.y, o.scale.z);
        if (r < T * 0.75) { o.castShadow = false; _off++; }
      });
    } catch (e) {}
  }
  // The ground-floor footprint of a staircase cell (type 8): a small base plinth so
  // the stairwell reads as built-in. The climbing steps themselves are in buildUpperFloor.
  function buildStairBase(x, y, w) {
    const base = _bx(T * 0.96, T * 0.12, T * 0.96, 0x3b3f47, 0.85, 0.14);
    base.position.set(w.x, FT + 0.06, w.z); base.receiveShadow = true; pbrApply(base, "deck", (x ^ y)); scene.add(base);
  }
  // Signature ADVENT propaganda KIOSK — the cyan-teal tech pillar that is the
  // single most "XCOM" environmental cue. Procedural (concrete pillar + glowing
  // #34d6e8 screens + beacon). Placed in open plazas. Visual only.
  function _adventKiosk() {
    const g = new THREE.Group();
    const base = _bx(T * 0.82, T * 0.12, T * 0.82, 0x1c2027, 0.8, 0.2); base.position.y = T * 0.06; base.castShadow = true; pbrApply(base, "metal", 3); g.add(base);
    const pillar = _bx(T * 0.5, T * 2.3, T * 0.5, 0x2a2f38, 0.6, 0.45); pillar.position.y = T * 1.2; pillar.castShadow = true; pbrApply(pillar, "metal", 5); g.add(pillar); // brushed-metal tech pillar grazes the sky env (the signature ADVENT accent)
    for (const zf of [1, -1]) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.42, T * 1.3),
        new THREE.MeshStandardMaterial({ color: 0x08222c, emissive: 0x34d6e8, emissiveIntensity: 1.0, roughness: 0.3 }));
      screen.position.set(0, T * 1.45, zf * T * 0.262); if (zf < 0) screen.rotation.y = Math.PI; g.add(screen);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(T * 0.15, 12, 12), new THREE.MeshBasicMaterial({ color: 0x7ff2ff }));
    beacon.position.y = T * 2.5; g.add(beacon);
    return g;
  }
  // Backlit BILLBOARD on posts (iconic urban prop) — warm or teal LCD face.
  function _billboard() {
    const g = new THREE.Group();
    for (const px of [-T * 0.45, T * 0.45]) { const post = _bx(T * 0.08, T * 1.6, T * 0.08, 0x1c2027, 0.7, 0.3); post.position.set(px, T * 0.8, 0); post.castShadow = true; pbrApply(post, "metal", 1); g.add(post); }
    const panel = _bx(T * 1.2, T * 0.72, T * 0.09, 0x14181f, 0.5, 0.2); panel.position.y = T * 1.72; panel.castShadow = true; pbrApply(panel, "metal", 2); g.add(panel);
    const teal = (((g.uuid.charCodeAt(0) || 0) + Math.round(g.position.x)) & 1) === 0;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(T * 1.12, T * 0.64), new THREE.MeshStandardMaterial({ color: 0x10202a, emissive: teal ? 0x34d6e8 : 0xffb24d, emissiveIntensity: 0.85, roughness: 0.4 }));
    face.position.set(0, T * 1.72, T * 0.05); g.add(face);
    return g;
  }
  function scatterAdvent() {
    const grid = mission.grid, cand = [];
    for (let y = 3; y < gridH - 3; y++) for (let x = 3; x < gridW - 3; x++) {
      if (grid[y][x] !== 0) continue;
      let open = true;
      for (let dy = -2; dy <= 2 && open; dy++) for (let dx = -2; dx <= 2; dx++) { const t = (grid[y + dy] || [])[x + dx]; if (t === 1 || t === 5) { open = false; break; } }
      if (open) cand.push([x, y]);
    }
    if (!cand.length) return;
    const n = Math.min(5, Math.max(2, (cand.length / 130) | 0));
    for (let i = 0; i < n; i++) { const [x, y] = cand[Math.floor((i + 0.5) * cand.length / n)]; const g = (i % 2 === 0) ? _adventKiosk() : _billboard(); const w = cell(x, y); g.position.set(w.x, FT, w.z); g.rotation.y = (i * 1.7) % (Math.PI * 2); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g); }
  }
  // STREET FURNITURE placed where a real town puts it (the core "not randomly
  // scattered" fix). Walks CURB tiles (open, against a building face) and places by
  // ROLE at REGULAR intervals along each frontage — lampposts on a fixed cadence,
  // hydrants offset between them, trees/planters on the wider sidewalk runs, cones
  // by intersections. All hug the kerb (offset to the building edge, rotated to
  // face the street) so units never stand in them. VISUAL ONLY — not cover.
  function scatterDecor() {
    const ci = analyzeCity(), grid = mission.grid;
    const place = (name, x, y, dx, dy, rotY, role) => {
      const g = new THREE.Group();
      if (!placeCity(name, g, rotY)) return;
      const w = cell(x, y); g.position.set(w.x + dx * T * 0.4, FT, w.z + dy * T * 0.4);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      pbrApply(g, role, ((x * 2654435761) ^ (y * 40503)) >>> 0);
      scene.add(g);
    };
    for (let y = 1; y < gridH - 1; y++) for (let x = 1; x < gridW - 1; x++) {
      if (grid[y][x] !== 0) continue;
      const fd = ci.curbDir[y][x]; if (!fd) continue;        // only kerb tiles get furniture
      const [dx, dy] = fd;
      // rotate the prop so its "front" faces AWAY from the wall (into the street).
      const faceStreet = Math.atan2(-dx, -dy);
      // a coordinate that runs ALONG the frontage (so spacing is even down a block)
      const along = (dx === 0) ? x : y;
      const cross = (dx === 0) ? y : x;
      // cones cluster at intersections; everything else lines the kerb on a cadence
      if (ci.inter[y][x]) {
        if ((x + y) % 3 === 0) place("car/cone-traffic.glb", x, y, dx, dy, faceStreet, "metal");
        continue;
      }
      // deterministic cadence keyed to the frontage coordinate — a steady rhythm of
      // posts, not noise. Phase by the cross coord so opposite kerbs aren't mirrored.
      const phase = (cross * 2) >>> 0;
      const slot = (along + phase);
      if (slot % 6 === 0)      place("grave/grave-lightpost-single.glb", x, y, dx, dy, faceStreet, "metal"); // lamppost every 6 tiles
      else if (slot % 6 === 3) place("hydrant-quaternius.glb", x, y, dx, dy, faceStreet, "metal");           // hydrant between lamps
      else if (slot % 4 === 1) place("suburban/tree-small.glb", x, y, dx, dy, 0, "concrete");                 // street trees
      else if (slot % 4 === 2) place("suburban/planter.glb", x, y, dx, dy, faceStreet, "concrete");           // planters
    }
  }
  function _smat(col, r, m) { return new THREE.MeshStandardMaterial({ color: col, roughness: r == null ? 0.75 : r, metalness: m == null ? 0.2 : m }); }
  function _bx(wd, ht, dp, col, r, m) { return new THREE.Mesh(new THREE.BoxGeometry(wd, ht, dp), _smat(col, r, m)); }

  // ── Real CC0 city MODELS (Kenney + Quaternius) — replace the box geometry with
  // actual low-poly models (cars, dumpsters, walls with real windows/doors,
  // furniture). 1 model-unit = 1 tile in the source kits; we auto-scale each to a
  // target tile footprint + seat it on the ground, then clone per placement.
  const CITY = new URL("./city/", import.meta.url).href;
  const _city = {};
  async function loadCityModel(name, tiles) {
    try {
      const g = await kernel.loadGLTF(CITY + name);
      let box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      const maxH = Math.max(size.x, size.z) || 1;
      g.scale.setScalar((tiles * T) / maxH);
      g.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(g);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      _city[name] = { tpl: g, baseY: -box.min.y };
    } catch (e) { _city[name] = null; }
  }
  function placeCity(name, group, rotY) {
    const e = _city[name]; if (!e || !e.tpl) return false;
    const m = e.tpl.clone();
    m.position.set(0, e.baseY || 0, 0);
    if (rotY) m.rotation.y = rotY;
    group.add(m); return true;
  }
  // cover model pools: {n: file, t: target tiles across}
  // paths are kit-subfoldered so each GLB's relative Textures/colormap.png resolves
  // to the RIGHT Kenney palette (car/ = car colormap, grave/ = graveyard); Quaternius
  // props are self-contained (flat); walls/furniture use solid colors (flat, no atlas).
  const FULL_COVER = [ {n:"car/sedan.glb",t:1.55}, {n:"car/suv.glb",t:1.6}, {n:"car/van.glb",t:1.7}, {n:"car/truck.glb",t:1.9}, {n:"car/taxi.glb",t:1.55}, {n:"dumpster-quaternius.glb",t:1.15}, {n:"shipping-container-quaternius.glb",t:1.9}, {n:"grave/grave-pillar-square.glb",t:0.7} ];
  const HALF_COVER = [ {n:"car/box-crate.glb",t:0.95}, {n:"barrier-traffic-quaternius.glb",t:1.1}, {n:"grave/grave-bench.glb",t:1.1}, {n:"ac-unit-quaternius.glb",t:0.95}, {n:"market-stalls-quaternius.glb",t:1.6}, {n:"grave/grave-iron-fence.glb",t:1.0} ];
  const FURNITURE = [ {n:"desk.glb",t:0.95}, {n:"bookcaseClosed.glb",t:0.7}, {n:"kitchenCabinet.glb",t:0.7}, {n:"table.glb",t:0.95}, {n:"loungeSofa.glb",t:1.0}, {n:"cardboardBoxClosed.glb",t:0.55} ];
  const WALLS = [ {n:"wall.glb",t:1.0}, {n:"wallWindow.glb",t:1.0}, {n:"wallDoorway.glb",t:1.0}, {n:"wallHalf.glb",t:1.0}, {n:"wallCorner.glb",t:1.0} ];
  // solid backdrop towers (Kenney City Kit Commercial; commercial/ has its colormap)
  const BUILDINGS = [ {n:"commercial/building-a.glb",t:1.0}, {n:"commercial/building-b.glb",t:1.0}, {n:"commercial/building-skyscraper-a.glb",t:1.0}, {n:"commercial/building-skyscraper-b.glb",t:1.0} ];
  // decorative street furniture (non-blocking, visual only) — fills the city
  const DECOR = [ {n:"hydrant-quaternius.glb",t:0.45}, {n:"car/cone-traffic.glb",t:0.4}, {n:"grave/grave-lightpost-single.glb",t:0.5}, {n:"suburban/planter.glb",t:0.6}, {n:"suburban/tree-small.glb",t:0.7} ];
  async function preloadCity() {
    const all = [...FULL_COVER, ...HALF_COVER, ...FURNITURE, ...WALLS, ...BUILDINGS, ...DECOR];
    await Promise.all(all.map((m) => loadCityModel(m.n, m.t)));
  }
  function _tilesOf(list, name) { const e = list.find((m) => m.n === name); return e ? e.t : 1; }
  // Cover tiles render as recognisable STREET OBJECTS (XCOM-style), not identical
  // crates: full cover = cars / dumpsters / shipping containers; half cover =
  // jersey barriers / planters / sandbags / sci-fi crates. All are non-walkable
  // (the sim already treats 2/3 as solid) so a car genuinely IS the cover.
  // A cover tile is "indoors" if it's enclosed by building walls (type 5) on ≥2
  // sides within a few tiles — those get FURNITURE (desks/shelves) as cover, the
  // "stuff in the buildings"; outdoor tiles get street props (cars/dumpsters).
  function isIndoor(x, y) {
    const grid = mission.grid; let walls = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= 3; r++) {
        const nx = x + dx * r, ny = y + dy * r;
        const t = (ny >= 0 && ny < gridH && nx >= 0 && nx < gridW) ? grid[ny][nx] : 0;
        if (t === 5) { walls++; break; }
        if (t === 1) break;
      }
    }
    return walls >= 2;
  }
  // Pick the right cover PROP for a tile's urban role + orient it like a real city
  // would: parked cars PARALLEL to the kerb nudged to the curb, dumpsters/containers
  // in alleys, AC units flat against a building face, barriers square to the street.
  // Returns { name, rotY, ox, oz } (ox/oz = small on-tile nudge toward the kerb).
  function _coverPlacement(x, y, full, hsh) {
    const ci = analyzeCity();
    const fd = ci.curbDir[y][x];           // direction to the nearest building face
    const alley = ci.alley[y][x];
    const axis = ci.axis[y][x];            // 'h' = E-W road, 'v' = N-S road
    // angle that runs ALONG the road (so a car body lies parallel to traffic)
    const alongRot = axis === "h" ? Math.PI / 2 : 0; // car model long-axis is X at rot0
    if (full) {
      // ALLEY → dumpster / shipping container, shoved against the back wall
      if (alley) {
        const name = (hsh & 1) ? "dumpster-quaternius.glb" : "shipping-container-quaternius.glb";
        const r = fd ? Math.atan2(-fd[0], -fd[1]) : alongRot;
        return { name, rotY: r, ox: fd ? fd[0] * 0.16 : 0, oz: fd ? fd[1] * 0.16 : 0 };
      }
      // KERB → PARKED CAR parallel to the road, nudged to the curb (the big fix)
      if (fd) {
        const cars = ["car/sedan.glb", "car/suv.glb", "car/van.glb", "car/truck.glb", "car/taxi.glb"];
        const name = cars[hsh % cars.length];
        // car lies along the road; pull it toward the kerb side
        return { name, rotY: alongRot, ox: fd[0] * 0.14, oz: fd[1] * 0.14 };
      }
      // open street full cover → a car parked along the lane (still parallel)
      const cars = ["car/sedan.glb", "car/suv.glb", "car/taxi.glb"];
      return { name: cars[hsh % cars.length], rotY: alongRot, ox: 0, oz: 0 };
    }
    // HALF COVER
    if (fd) {
      // against a building face: AC unit (flat to the wall) or a planter/bench
      const r = Math.atan2(-fd[0], -fd[1]);
      const opts = ["ac-unit-quaternius.glb", "grave/grave-bench.glb", "barrier-traffic-quaternius.glb"];
      const name = opts[hsh % opts.length];
      return { name, rotY: name.indexOf("barrier") >= 0 ? alongRot : r, ox: fd[0] * 0.16, oz: fd[1] * 0.16 };
    }
    // open ground half cover: jersey barrier square to the road, or a market stall
    const opts = ["barrier-traffic-quaternius.glb", "market-stalls-quaternius.glb", "car/box-crate.glb", "grave/grave-iron-fence.glb"];
    const name = opts[hsh % opts.length];
    return { name, rotY: name.indexOf("barrier") >= 0 || name.indexOf("fence") >= 0 ? alongRot : (hsh % 2) * (Math.PI / 2), ox: 0, oz: 0 };
  }
  function buildCover(x, y, w, full) {
    const hsh = ((x * 374761393) ^ (y * 668265263)) >>> 0;
    const g = new THREE.Group();
    let name, rotY = 0, ox = 0, oz = 0;
    if (isIndoor(x, y)) {
      // indoor cover = the furniture in the room (unchanged: desks/shelves/sofas)
      const pick = FURNITURE[hsh % FURNITURE.length]; name = pick.n; rotY = (hsh % 4) * (Math.PI / 2);
    } else {
      const p = _coverPlacement(x, y, full, hsh); name = p.name; rotY = p.rotY; ox = p.ox; oz = p.oz;
    }
    if (!placeCity(name, g, rotY)) {
      // fallback box if a model failed to load
      if (full) _propContainer(g, hsh); else _propBarrier(g, hsh);
    }
    g.position.set(w.x + ox * T, FT, w.z + oz * T); // small on-tile kerb nudge — the cover tile is unchanged for the sim
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // PBR role from the prop kind: painted clear-coat on vehicles (catch the sky),
    // brushed metal on containers/dumpsters/AC/barriers, matte concrete on grave
    // stone + furniture. Vehicle windows auto-route to glass inside pbrApply.
    pbrApply(g, _coverRole(name), hsh);
    scene.add(g); coverTiles[x + "," + y] = [g];
  }
  // Map a cover-prop filename to a PBR role (vehicles = painted, metal props =
  // metal, stone/wood/fabric = concrete-ish matte).
  function _coverRole(name) {
    name = name || "";
    if (/^car\//.test(name) && !/box-crate|cone/.test(name)) return "painted"; // sedan/suv/van/truck/taxi
    if (/container|dumpster|ac-unit|barrier-traffic|iron-fence/.test(name)) return "metal";
    return "concrete"; // graves, market stalls, crates, furniture (desks/sofas read close enough matte)
  }
  function _propCar(g, hsh) {
    const cols = [0x9a3b3b, 0x35506e, 0x6e6a35, 0x49505a, 0x2f6e4f, 0x7a4a2c];
    const col = cols[hsh % cols.length];
    g.rotation.y = (hsh & 1) ? 0 : Math.PI / 2; // sit along the street
    const body = _bx(T * 0.84, T * 0.32, T * 0.44, col, 0.42, 0.5); body.position.set(0, T * 0.3, 0); g.add(body);
    const cabin = _bx(T * 0.5, T * 0.26, T * 0.4, shade(col, 0.12), 0.35, 0.4); cabin.position.set(-T * 0.02, T * 0.55, 0); g.add(cabin);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(T * 0.46, T * 0.2, T * 0.42), _smat(0x16242f, 0.1, 0.7)); glass.position.set(-T * 0.02, T * 0.56, 0); g.add(glass);
    for (const wx of [-T * 0.3, T * 0.3]) for (const wz of [-T * 0.18, T * 0.18]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.1, T * 0.1, T * 0.08, 12), _smat(0x101316, 0.85, 0.1));
      wheel.rotation.x = Math.PI / 2; wheel.position.set(wx, T * 0.12, wz); g.add(wheel);
    }
  }
  function _propDumpster(g, hsh) {
    const col = [0x2f7a4a, 0x7a5a2c, 0x6e3030][hsh % 3];
    const body = _bx(T * 0.66, T * 0.6, T * 0.5, col, 0.7, 0.3); body.position.set(0, T * 0.35, 0); g.add(body);
    const lid = _bx(T * 0.7, T * 0.08, T * 0.54, shade(col, 0.18), 0.6, 0.3); lid.position.set(0, T * 0.66, -T * 0.04); lid.rotation.x = -0.18; g.add(lid);
  }
  function _propContainer(g, hsh) {
    const col = [0x9c4f30, 0x355f80, 0x3d6e52, 0x86773a][hsh % 4]; // muted shipping-container tones
    const body = _bx(T * 0.92, T * 0.62, T * 0.5, col, 0.78, 0.25); body.position.y = T * 0.36; g.add(body);
    // corrugation ridges
    for (let i = -3; i <= 3; i++) { const rib = _bx(T * 0.02, T * 0.58, T * 0.5, shade(col, -0.25), 0.8, 0.2); rib.position.set(i * T * 0.12, T * 0.36, T * 0.255); g.add(rib); }
    const door = _bx(T * 0.04, T * 0.5, T * 0.46, shade(col, -0.15), 0.7, 0.3); door.position.set(T * 0.46, T * 0.34, 0); g.add(door);
  }
  function _propBarrier(g, hsh) {
    // concrete jersey barrier (low, angled sides)
    const base = _bx(T * 0.72, T * 0.18, T * 0.34, 0x8a8f96, 0.9, 0.05); base.position.y = T * 0.11; g.add(base);
    const top = _bx(T * 0.5, T * 0.3, T * 0.18, 0x969aa3, 0.9, 0.05);
    top.position.y = T * 0.3; g.add(top);
  }
  function _propPlanter(g, hsh) {
    const pot = _bx(T * 0.5, T * 0.3, T * 0.5, 0x6f6257, 0.85, 0.1); pot.position.y = T * 0.17; g.add(pot);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(T * 0.18, 8, 8), _smat([0x47583a, 0x55663f, 0x3c4a30][i % 3], 0.95, 0)); // muted olive, not toy-green
      leaf.position.set((i - 1) * T * 0.14, T * 0.42 + (i % 2) * T * 0.06, (i % 2 ? 1 : -1) * T * 0.08); leaf.scale.y = 1.2; g.add(leaf);
    }
  }
  function _propSandbags(g) {
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3 - r; i++) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(T * 0.1, T * 0.22, 4, 8), _smat([0x9a8b5e, 0x8a7c52][(i + r) % 2], 0.95, 0));
      bag.rotation.z = Math.PI / 2; bag.position.set((i - (2 - r) / 2) * T * 0.24 + r * T * 0.12, T * 0.1 + r * T * 0.2, 0); g.add(bag);
    }
  }
  function _propCrate(g) {
    const base = _bx(T * 0.6, T * 0.5, T * 0.6, 0x33414f, 0.5, 0.6); base.position.y = T * 0.3; g.add(base);
    const cap = _bx(T * 0.62, T * 0.08, T * 0.62, shade(0x33414f, 0.35), 0.4, 0.7); cap.position.y = T * 0.56; g.add(cap);
    const trim = _bx(T * 0.62, T * 0.05, T * 0.62, 0x2a3340, 0.5, 0.55); trim.position.y = T * 0.4; g.add(trim); // dark metal banding (was a glowing cyan sci-fi line)
  }
  // Frag shredded this tile: full(3)->half(2) rebuilds smaller; half(2)->floor(0)
  // removes it. Mirrors the sim's grid mutation so visuals stay truthful.
  function shredCoverVisual(x, y, toType) {
    const key = x + "," + y, meshes = coverTiles[key];
    if (meshes) { meshes.forEach((mm) => scene.remove(mm)); delete coverTiles[key]; }
    if (toType === 2) buildCover(x, y, cell(x, y), false); // downgraded to half cover
  }
  // A grenade blew a hole in this wall: remove the building, drop a rubble pile +
  // dust, and leave the floor (continuous floor plane) exposed + walkable.
  function demolishBuilding(x, y) {
    const key = x + "," + y, meshes = buildingTiles[key];
    if (!meshes) return;
    meshes.forEach((mm) => scene.remove(mm)); delete buildingTiles[key];
    const w = cell(x, y);
    for (let i = 0; i < 5; i++) {
      const r = _bx(T * (0.18 + Math.random() * 0.22), T * (0.12 + Math.random() * 0.2), T * (0.18 + Math.random() * 0.22), [0x3a4048, 0x4d473d, 0x2b3442][i % 3], 0.95, 0.1);
      r.position.set(w.x + (Math.random() - 0.5) * T * 0.7, T * 0.12 + Math.random() * T * 0.1, w.z + (Math.random() - 0.5) * T * 0.7);
      r.rotation.set(Math.random(), Math.random(), Math.random()); r.castShadow = true; scene.add(r);
    }
    // dust puff
    const dust = new THREE.Mesh(new THREE.SphereGeometry(T * 0.5, 10, 10), new THREE.MeshBasicMaterial({ color: 0x9a958c, transparent: true, opacity: 0.6 }));
    dust.position.set(w.x, T * 0.8, w.z); scene.add(dust);
    kernel.tween({ target: dust.scale, to: { x: 2.6, y: 2.6, z: 2.6 }, duration: 0.6 });
    kernel.tween({ target: dust.material, to: { opacity: 0 }, duration: 0.6, onComplete: () => scene.remove(dust) });
  }
  function buildHazard(w) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(T * 0.96, 0.32, T * 0.96),
      new THREE.MeshStandardMaterial({ color: 0x2a0f0f, emissive: 0xff4010, emissiveIntensity: 0.35, roughness: 0.8 }));
    tile.position.set(w.x, 0.04, w.z); scene.add(tile);
    let tt = Math.random() * 6;
    kernel.onUpdate((dt) => { tt += dt; tile.material.emissiveIntensity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(tt * 3)); });
  }
  let terminalMesh = null;
  // Objective markers: pulsing green EVAC pads + a cyan hack TERMINAL console.
  function buildObjective() {
    const g = mission.goal || {};
    (g.evac || []).forEach((t) => {
      const w = cell(t.x, t.y);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.92, T * 0.92),
        new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(w.x, 0.27, w.z); scene.add(pad);
      const ring = new THREE.Mesh(new THREE.RingGeometry(T * 0.3, T * 0.42, 24), new THREE.MeshBasicMaterial({ color: 0x9dffb6, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, 0.3, w.z); scene.add(ring);
      let tt = Math.random() * 6; kernel.onUpdate((dt) => { tt += dt; const s = 1 + 0.12 * Math.sin(tt * 3); ring.scale.set(s, s, s); pad.material.opacity = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(tt * 3)); });
    });
    if (g.target) {
      const w = cell(g.target.x, g.target.y);
      const base = _bx(T * 0.5, T * 0.5, T * 0.5, 0x223240, 0.5, 0.6); base.position.set(w.x, T * 0.3, w.z); base.castShadow = true; scene.add(base);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.4, T * 0.3), new THREE.MeshBasicMaterial({ color: 0x5fd0ff }));
      screen.position.set(w.x, T * 0.5, w.z + T * 0.26); scene.add(screen);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(T * 0.12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x5fd0ff }));
      beacon.position.set(w.x, T * 0.78, w.z); scene.add(beacon);
      terminalMesh = { base, screen, beacon };
      let tt = 0; kernel.onUpdate((dt) => { tt += dt; const lit = sim.goal && sim.goal.hacked; const c = lit ? 0x3ddc84 : 0x5fd0ff; screen.material.color.setHex(c); beacon.material.color.setHex(c); beacon.position.y = T * 0.78 + (lit ? 0 : 0.06 * Math.sin(tt * 4)); });
    }
  }
  // Buildings come in 3 silhouettes — tall office tower, mid-rise, low storefront
  // — across a varied concrete/brick/tan palette, so the skyline reads like a
  // real city block instead of a uniform box-forest. Lit window rows + a
  // ground-floor accent (storefront on the low ones, with an awning).
  // Solid backdrop tower (tile type 1): a real Kenney building model per tile
  // (commercial buildings + skyscrapers). Clusters of type-1 tiles read as a
  // building block. Frag-destructible (tracked in buildingTiles).
  function buildStructure(x, y, w) {
    const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const grid = mission.grid;
    const g = new THREE.Group();
    // FACE THE STREET: a real building fronts the road, not a random direction.
    // Kenney commercial facades face +Z at rot0, so rotate the front toward the
    // nearest OPEN tile (the street). Interior block tiles (no adjacent street)
    // get a deterministic rotation so the block isn't uniform.
    const openAt = (xx, yy) => ((grid[yy] || [])[xx] === 0);
    let faceRot = null;
    if (openAt(x, y + 1)) faceRot = 0;            // street to the south → face +Z
    else if (openAt(x, y - 1)) faceRot = Math.PI; // street to the north → face -Z
    else if (openAt(x + 1, y)) faceRot = Math.PI / 2;  // street to the east
    else if (openAt(x - 1, y)) faceRot = -Math.PI / 2; // street to the west
    const rotY = faceRot != null ? faceRot : (hsh % 4) * (Math.PI / 2);
    const tall = (hsh % 5 < 2);
    const name = tall ? (hsh & 1 ? "commercial/building-skyscraper-a.glb" : "commercial/building-skyscraper-b.glb")
                      : (hsh & 1 ? "commercial/building-a.glb" : "commercial/building-b.glb");
    if (!placeCity(name, g, rotY)) {
      const bh = T * (tall ? 3 : 1.5); // fallback box if the model failed
      const b = new THREE.Mesh(new THREE.BoxGeometry(T, bh, T), _smat(0x39414c, 0.85, 0.2));
      b.position.y = bh / 2; g.add(b);
    }
    g.position.set(w.x, FT, w.z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    pbrApply(g, "concrete", hsh); // micro-pitted concrete relief + sky-grazed roughness so towers aren't flat slabs
    scene.add(g); buildingTiles[x + "," + y] = [g];
  }

  // Enterable-building WALL (tile type 5): a low concrete wall + lit window band,
  // OPEN-TOP so the iso camera sees down into the furnished room behind it. Reads
  // as a real building you walk into (through the door gaps), full cover + sight-
  // blocking in the sim, and frag-destructible (tracked in buildingTiles).
  function buildWall(x, y, w) {
    const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const grid = mission.grid;
    const wallish = (xx, yy) => { const t = (yy >= 0 && yy < gridH && xx >= 0 && xx < gridW) ? grid[yy][xx] : 5; return t === 5 || t === 1; };
    const g = new THREE.Group();
    const horiz = wallish(x - 1, y) || wallish(x + 1, y);
    const vert = wallish(x, y - 1) || wallish(x, y + 1);
    const name = (hsh % 10 < 7) ? "wallWindow.glb" : "wall.glb"; // mostly windowed
    let ok = false;
    if (horiz) ok = placeCity(name, g, 0) || ok;                 // wall slab spanning X
    if (vert) ok = placeCity(name, g, Math.PI / 2) || ok;        // spanning Z (corner gets both)
    if (!horiz && !vert) ok = placeCity(name, g, 0) || ok;
    if (!ok) { const b = _bx(T, T * 1.3, T * 0.16, 0x4a4e57, 0.9, 0.06); b.position.y = T * 0.65; g.add(b); }
    g.position.set(w.x, FT, w.z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    pbrApply(g, "concrete", hsh); // concrete relief on the building face; windowed GLBs keep their lit panes
    scene.add(g); buildingTiles[x + "," + y] = [g];
  }

  // ── Verticality: rooftop decks (tile 6) + ramps (tile 7) ────────────────────
  const DECK_H = T * 1.3; // rooftop height — units climb up for high-ground advantage
  const FLOOR_H = T * 2.7; // SECOND-STOREY height (floor 1) — a full interior storey above ground
  function _tileLift(x, y) { const t = (mission.grid[y] || [])[x]; return (t === 6 || t === 7) ? DECK_H : 0; }
  // Floor-aware world-Y lift: floor 1 = full storey; floor 0 keeps deck/ramp logic.
  function _floorLift(x, y, floor) { return (floor === 1) ? FLOOR_H : _tileLift(x, y); }
  const _upper = mission.upper || null; // optional FLOOR-1 grid (second storey)
  function buildDeck(x, y, w) {
    const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const support = _bx(T, DECK_H, T, 0x33373f, 0.88, 0.18); support.position.set(w.x, DECK_H / 2, w.z); support.castShadow = true; support.receiveShadow = true; pbrApply(support, "concrete", hsh); scene.add(support);
    const slab = _bx(T * 1.0, T * 0.14, T * 1.0, 0x6a6e77, 0.8, 0.15); slab.position.set(w.x, DECK_H + 0.07, w.z); slab.receiveShadow = true; pbrApply(slab, "deck", hsh); scene.add(slab);
    // parapet on edges that face a non-deck tile (so the roof reads as an edge)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nt = (mission.grid[y + dy] || [])[x + dx];
      if (nt === 6 || nt === 7) continue;
      const horiz = dy !== 0;
      const rail = _bx(horiz ? T : T * 0.12, T * 0.3, horiz ? T * 0.12 : T, 0x4a4e57, 0.85, 0.1);
      rail.position.set(w.x + dx * T * 0.46, DECK_H + 0.28, w.z + dy * T * 0.46); rail.castShadow = true; pbrApply(rail, "metal", dx + dy); scene.add(rail); // metal rail catches the sky = visible IBL accent
    }
  }
  function buildRamp(x, y, w) {
    // a landing at deck height + stairs descending toward the ground foot
    const land = _bx(T * 0.92, T * 0.14, T * 0.92, 0x62666e, 0.82, 0.15); land.position.set(w.x, DECK_H + 0.07, w.z); land.receiveShadow = true; pbrApply(land, "deck", (x + y)); scene.add(land);
    // find the ground-side direction (a neighbour that is NOT deck/ramp)
    let gx = 0, gz = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const nt = (mission.grid[y + dy] || [])[x + dx]; if (nt !== 6 && nt !== 7 && nt !== 1 && nt !== 5) { gx = dx; gz = dy; break; } }
    for (let i = 0; i < 3; i++) {
      const h = DECK_H * (1 - (i + 1) / 4);
      const step = _bx(gx ? T * 0.34 : T * 0.7, T * 0.16, gz ? T * 0.34 : T * 0.7, 0x52565e, 0.85, 0.12);
      step.position.set(w.x + gx * (i + 1) * T * 0.3, h, w.z + gz * (i + 1) * T * 0.3); step.castShadow = true; scene.add(step);
    }
  }

  // ── SECOND STOREY (floor 1) ────────────────────────────────────────────────
  // Reads the optional `mission.upper` grid and builds a raised, OPEN-TOP interior
  // level you climb to via stairs (type 8) and fight on/inside (type 9 floor, plus
  // 5=wall, 2/3=cover). No roof => the camera sees both storeys at once (the XCOM
  // dollhouse cross-section). Slab is inset so the ground floor stays visible below.
  const _up = (x, y) => (_upper && _upper[y]) ? _upper[y][x] : 0;
  // CUTAWAY tracking: the raised STRUCTURE (slabs+columns) vs the see-in OCCLUDERS
  // (parapets, rails, balcony cover). applyCutaway() fades these by which floor the
  // player is looking at so a multi-storey building never hides the action (XCOM).
  const _upperSlabs = [], _upperWalls = [];
  function _regU(mesh, isSlab) { mesh.material.transparent = true; (isSlab ? _upperSlabs : _upperWalls).push(mesh); }
  // Looking at the UPPER floor → keep its slabs solid but drop the see-in occluders
  // (parapets/rails/balcony cover) so you can read the room. Looking at the GROUND
  // (or nothing selected) → make the upper slabs translucent so the floor below is
  // never hidden. This is the XCOM dynamic cutaway, done with opacity (no shader
  // recompiles — materials were flagged transparent at build time).
  function applyCutaway(focusFloor) {
    if (!_upper) return;
    const slabOp = focusFloor === 1 ? 1.0 : 0.34;
    const wallOp = focusFloor === 1 ? 0.18 : 0.12;
    for (const m of _upperSlabs) m.material.opacity = slabOp;
    for (const m of _upperWalls) m.material.opacity = wallOp;
  }
  function buildUpperFloor() {
    if (!_upper) return;
    const slabMat = { c: 0x7c6f5d, r: 0.8, m: 0.12 }; // WARM interior floorboards — distinct from grey street/walls
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0c2a30, emissive: 0x34d6e8, emissiveIntensity: 0.9, roughness: 0.4 }); // teal ADVENT trim
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const t = _up(x, y);
        if (t !== 9 && t !== 8 && t !== 5 && t !== 3 && t !== 2) continue;
        const w = cell(x, y);
        // interior floor slab (also under stairs landings, walls, cover)
        if (t === 9 || t === 8 || t === 5 || t === 2 || t === 3) {
          const slab = _bx(T * 0.98, T * 0.16, T * 0.98, slabMat.c, slabMat.r, slabMat.m);
          slab.position.set(w.x, FLOOR_H + 0.08, w.z); slab.receiveShadow = true; slab.castShadow = true; pbrApply(slab, "deck", (x ^ y)); scene.add(slab); _regU(slab, true);
        }
        // support columns + glowing edge trim on OUTER edges (neighbour not part of the storey)
        if (t === 9 || t === 8) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nt = _up(x + dx, y + dy);
            if (nt === 9 || nt === 8 || nt === 5 || nt === 2 || nt === 3) continue; // interior edge — no column
            const col = _bx(T * 0.18, FLOOR_H, T * 0.18, 0x262a32, 0.82, 0.25);
            col.position.set(w.x + dx * T * 0.45, FLOOR_H / 2, w.z + dy * T * 0.45); col.castShadow = true; pbrApply(col, "concrete", x + y); scene.add(col); _regU(col, true);
            const horiz = dy !== 0;
            // glowing teal floor-edge strip (reads the raised plate's footprint instantly)
            const edge = new THREE.Mesh(new THREE.BoxGeometry(horiz ? T : T * 0.08, T * 0.1, horiz ? T * 0.08 : T), edgeMat);
            edge.position.set(w.x + dx * T * 0.47, FLOOR_H + 0.2, w.z + dy * T * 0.47); scene.add(edge);
            const rail = _bx(horiz ? T : T * 0.1, T * 0.3, horiz ? T * 0.1 : T, 0x4a4e57, 0.85, 0.12);
            rail.position.set(w.x + dx * T * 0.46, FLOOR_H + 0.34, w.z + dy * T * 0.46); rail.castShadow = true; pbrApply(rail, "metal", dx - dy); scene.add(rail); _regU(rail, false);
          }
        }
        // interior walls (5) — a KNEE-HIGH parapet so the storey stays an OPEN
        // raised platform (never occludes the camera; you always see units on it).
        // Sim-side these still block LOS/cover; visually they're a low lip.
        if (t === 5) {
          const wl = _bx(T * 0.96, T * 0.5, T * 0.96, 0x5f636b, 0.86, 0.12);
          wl.position.set(w.x, FLOOR_H + 0.16 + T * 0.25, w.z); wl.castShadow = true; wl.receiveShadow = true; pbrApply(wl, "concrete", (x * 3 + y)); scene.add(wl); _regU(wl, false);
        }
        // interior cover (2 half / 3 full) — low blocks on the slab
        if (t === 2 || t === 3) {
          const ch = t === 3 ? T * 0.7 : T * 0.42;
          const cb = _bx(T * 0.62, ch, T * 0.62, t === 3 ? 0x6b5340 : 0x5a6470, 0.8, 0.15);
          cb.position.set(w.x, FLOOR_H + 0.13 + ch / 2, w.z); cb.castShadow = true; cb.receiveShadow = true; pbrApply(cb, "concrete", (x + y * 3)); scene.add(cb); _regU(cb, false);
        }
        // STAIRCASE in a type-8 cell: ~6 steps rising ground -> FLOOR_H, run aimed
        // toward an adjacent interior(9) cell (else +x). A handrail on one side.
        if (t === 8) {
          let rx = 1, rz = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (_up(x + dx, y + dy) === 9) { rx = dx; rz = dy; break; } }
          const N = 6;
          for (let i = 0; i < N; i++) {
            const h = FLOOR_H * (i + 1) / N;
            const along = (i - (N - 1) / 2) * (T * 0.92 / N);
            const step = _bx(rx ? T * 0.92 / N : T * 0.6, T * 0.12, rz ? T * 0.92 / N : T * 0.6, 0x52565e, 0.85, 0.12);
            step.position.set(w.x + rx * along, h, w.z + rz * along); step.castShadow = true; step.receiveShadow = true; scene.add(step);
          }
        }
      }
    }
    applyCutaway(null); // establishing view: upper storey translucent so both floors read
  }

  // ── Units (REAL rigged + animated characters) ───────────────────────────────
  // Players = an animated soldier; enemies come in distinct animated species —
  // a combat robot (drones), a heavy cyborg (defenders), and a beast (stalkers)
  // — so the player faces visibly different, escalating threats.
  const CHAR_BASE = new URL("./characters/", import.meta.url).href;
  // Quaternius CC0 rigged + animated models (adventurer soldier + escalating
  // robot/alien/mech foes). Native heights vary a lot, so each carries its own
  // measured height for correct scaling; clip names are bare (the kernel aliases
  // the FBX "Armature|Idle" prefix) except the alien, whose clips are "Alien_*".
  const MODELS = {
    //  PLAYERS = three distinct humanoid bodies (so the squad isn't one re-tinted
    //  soldier). swat + adventurer share the Quaternius "CharacterArmature" rig —
    //  identical full clip set (Idle_Gun/Walk/Death/Gun_Shoot/HitRecieve) + a
    //  Wrist.R bone for the rifle. soldier.glb is a Mixamo body (only Idle/Run/Walk,
    //  bone "mixamorig:RightHand"); we resolve clips defensively + the death falls
    //  back to a topple tween, so it still reads correctly. Measured native heights.
    //  ENEMIES = a cohesive weaponized ROBOT army (drone -> walker -> heavy).
    swat:       { url: "swat.glb",       h: 1.854, th: T * 1.52, clips: { idle: "Idle_Gun", walk: "Walk", die: "Death", attack: "Gun_Shoot", hurt: "HitRecieve" } },
    adventurer: { url: "adventurer.glb", h: 1.827, th: T * 1.52, clips: { idle: "Idle_Gun", walk: "Walk", die: "Death", attack: "Gun_Shoot", hurt: "HitRecieve" } },
    grunt:      { url: "soldier.glb",    h: 1.832, th: T * 1.55, clips: { idle: "Idle", walk: "Walk", die: "Death", attack: "Gun_Shoot", hurt: "HitRecieve" } }, // Mixamo: only idle/walk resolve; die/attack/hurt fall back gracefully
    soldier:    { url: "swat.glb",       h: 1.854, th: T * 1.52, clips: { idle: "Idle_Gun", walk: "Walk", die: "Death", attack: "Gun_Shoot", hurt: "HitRecieve" } }, // legacy alias (kept so any old reference still resolves)
    drone:   { url: "robot_enemy_flying_gun.glb", h: 0.696, th: T * 1.15, clips: { idle: "Idle", walk: "Walk", die: "Dead",  attack: "Shoot" } }, // NB: death clip is "Dead"
    walker:  { url: "robot_enemy_legs_gun.glb",   h: 0.952, th: T * 1.45, clips: { idle: "Idle", walk: "Walk", die: "Death", attack: "Shoot" } },
    heavy:   { url: "robot_enemy_large_gun.glb",  h: 1.279, th: T * 1.95, clips: { idle: "Idle", walk: "Walk", die: "Death", attack: "Shoot" } },
  };
  // PER-CLASS player body + scale. Bodies are assigned so ADJACENT roster roles
  // never share a body (vanguard→sharpshooter→specialist→ranger→grenadier =
  // swat→adventurer→grunt→adventurer→swat), and the two most combat-forward
  // shooters sit on the fully-animated Quaternius rigs. grenadier is bulkier,
  // ranger/sharpshooter leaner — silhouette scale on top of the procedural gear.
  const PLAYER_CLASS = {
    vanguard:     { model: "swat",       scale: 1.04 }, // Assault — armored breacher
    sharpshooter: { model: "adventurer", scale: 0.97 }, // lean marksman
    specialist:   { model: "grunt",      scale: 1.0  }, // field medic (Mixamo body, distinct proportions)
    ranger:       { model: "adventurer", scale: 0.96 }, // agile scout
    grenadier:    { model: "swat",       scale: 1.16 }, // heavy weapons — bulkiest
  };
  function playerKind(u) {
    const k = PLAYER_CLASS[(u.cls || "").toLowerCase()] || { model: "swat", scale: 1 };
    return { model: k.model, scale: k.scale };
  }
  // enemy class -> model + tint. The bots already read as menacing (red eyes,
  // gun arms); tint is very light just for faction warmth.
  function enemyKind(u) {
    const s = ((u.sprite || "") + " " + (u.name || "")).toLowerCase();
    // TIER escalation: later missions field visibly bigger, hotter-glowing
    // "upgraded" variants of each bot — the threat reads as it ramps (XCOM ADVENT
    // Mk I→III). A `boss` enemy is a single oversized command unit.
    const tier = Math.min(2, Math.floor(missionIndex / 3)); // 0 early, 1 mid, 2 late
    const boss = !!u.boss || /avatar|boss|overlord|sectopod/.test(s);
    let k;
    if (boss) k = { model: "heavy", tint: 0xff2a3a, scale: 1.7, boss: true };          // command unit
    else if (/defender|heavy|mech|tank|brute|titan|elite/.test(s)) k = { model: "heavy",  tint: 0xff6a4a, scale: 1.1 };
    else if (/sniper|scout|stalker|beast|hound|ranger|marksman/.test(s)) k = { model: "walker", tint: 0xffae5a, scale: 1.0 };
    else if (/drone|assault/.test(s)) k = { model: "drone", tint: 0xff7a5a, scale: 1.05 };
    else k = { model: "drone", tint: 0xff6a5a, scale: 1.0 };
    if (!boss) { k.scale *= 1 + tier * 0.1; if (tier >= 2) k.tint = 0xff4030; } // late-game bots bigger + angrier
    return k;
  }
  function unitColor(u) { return u.tint != null ? new THREE.Color(u.tint).getHex() : (u.side === "player" ? 0x3aa0ff : 0xff5a4a); }
  function resolveClip(char, name) { return (name && char.actions[name]) ? name : (char.animations[0] && char.animations[0].name) || null; }

  // ── Per-class PROCEDURAL GEAR (real silhouette difference) ──────────────────
  // Each class gets a distinct kit built from THREE primitives, parented to the
  // UNIT GROUP (world-scale, so sizing is identical across the swat/adventurer/
  // grunt bodies regardless of their internal rig scale). Landmarks are derived
  // from the unit's RENDERED height (targetH) so gear sits on head/shoulders/back
  // for any body. Gear is class-accent coloured (reinforces team id) BUT the
  // SHAPES differ enough to name the class in grayscale. Small props → no shadow
  // casting + no PBR normal maps (kept off the heavy passes per the perf budget).
  // Geometry + materials are CACHED per (class+accent) so 5 units don't re-alloc.
  const _gearCache = {};
  function _gmat(hex, rough, metal) { return new THREE.MeshStandardMaterial({ color: hex, roughness: rough == null ? 0.6 : rough, metalness: metal == null ? 0.3 : metal, envMapIntensity: 0.9 }); }
  function _gearGroup(cls, accentHex, targetH) {
    const key = cls + ":" + accentHex + ":" + targetH.toFixed(3);
    if (_gearCache[key]) return _gearCache[key].clone(true);
    const G = new THREE.Group();
    const A = accentHex;                          // class accent (team identity)
    const dk = shade(A, -0.55), lt = shade(A, 0.18);
    const matte = 0x2a2e36, darkMatte = 0x202329; // neutral kit base (armor/cloth)
    const matA = _gmat(A, 0.5, 0.35), matDk = _gmat(dk, 0.7, 0.2), matLt = _gmat(lt, 0.45, 0.4);
    const matBase = _gmat(matte, 0.78, 0.12), matDark = _gmat(darkMatte, 0.82, 0.1);
    // body landmarks (world Y; model feet ~0.05, head top ~targetH)
    const headY = targetH * 0.9, headTop = targetH * 0.98, shoY = targetH * 0.80, backY = targetH * 0.6, chestY = targetH * 0.66;
    const headR = targetH * 0.11, shoX = targetH * 0.18;
    const box = (w, h, d, m) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = false; x.receiveShadow = false; return x; };
    const cyl = (rt, rb, h, m, seg) => { const x = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), m); x.castShadow = false; x.receiveShadow = false; return x; };
    const sph = (r, m) => { const x = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m); x.castShadow = false; x.receiveShadow = false; return x; };
    const con = (r, h, m, seg) => { const x = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 12), m); x.castShadow = false; x.receiveShadow = false; return x; };

    if (cls === "vanguard") {
      // ASSAULT: combat helmet (dome + brim) + chunky shoulder pads + chest plate.
      const dome = sph(headR * 1.18, matBase); dome.scale.y = 0.82; dome.position.set(0, headTop - headR * 0.5, 0); G.add(dome);
      const brim = box(headR * 2.2, headR * 0.28, headR * 1.1, matDark); brim.position.set(0, headTop - headR * 0.7, headR * 0.55); G.add(brim);
      const stripe = box(headR * 2.0, headR * 0.34, headR * 0.34, matA); stripe.position.set(0, headTop - headR * 0.1, 0); G.add(stripe); // accent crest
      for (const sx of [-1, 1]) { const pad = box(shoX * 0.9, targetH * 0.12, targetH * 0.16, matBase); pad.position.set(sx * shoX, shoY, 0); G.add(pad); const trim = box(shoX * 0.92, targetH * 0.03, targetH * 0.17, matA); trim.position.set(sx * shoX, shoY + targetH * 0.06, 0); G.add(trim); }
      const plate = box(targetH * 0.2, targetH * 0.22, targetH * 0.07, matBase); plate.position.set(0, chestY, targetH * 0.11); G.add(plate);
      const plTrim = box(targetH * 0.1, targetH * 0.05, targetH * 0.02, matA); plTrim.position.set(0, chestY + targetH * 0.04, targetH * 0.15); G.add(plTrim);
    } else if (cls === "sharpshooter") {
      // MARKSMAN: pointed ghillie HOOD (cowl cone) + forward scope/visor optic.
      const hood = con(headR * 1.7, targetH * 0.34, matDark, 10); hood.position.set(0, headTop - targetH * 0.05, -headR * 0.1); G.add(hood);
      const cowl = con(headR * 2.0, targetH * 0.2, matBase, 10); cowl.position.set(0, shoY + targetH * 0.04, -headR * 0.2); G.add(cowl); // cowl draping onto shoulders
      const visor = box(headR * 1.9, headR * 0.5, headR * 0.5, matDark); visor.position.set(0, headY, headR * 0.7); G.add(visor);
      const scope = cyl(headR * 0.26, headR * 0.26, headR * 1.6, matA, 10); scope.rotation.x = Math.PI / 2; scope.position.set(headR * 0.5, headY + headR * 0.05, headR * 1.3); G.add(scope); // monocular optic jutting forward
      const lens = sph(headR * 0.28, matLt); lens.position.set(headR * 0.5, headY + headR * 0.05, headR * 2.0); G.add(lens);
    } else if (cls === "specialist") {
      // FIELD MEDIC: square backpack with a RED CROSS + headset/antenna.
      const pack = box(targetH * 0.26, targetH * 0.3, targetH * 0.16, matBase); pack.position.set(0, backY, -targetH * 0.13); G.add(pack);
      const crossMat = _gmat(0xe23b3b, 0.5, 0.1); // unmistakable red medic cross (NOT the team accent)
      const cv = box(targetH * 0.06, targetH * 0.17, targetH * 0.02, crossMat); cv.position.set(0, backY + targetH * 0.02, -targetH * 0.215); G.add(cv);
      const ch = box(targetH * 0.15, targetH * 0.06, targetH * 0.02, crossMat); ch.position.set(0, backY + targetH * 0.02, -targetH * 0.215); G.add(ch);
      const band = cyl(headR * 1.12, headR * 1.12, headR * 0.4, matA, 14); band.scale.z = 0.72; band.position.set(0, headY + headR * 0.2, 0); G.add(band); // headset band
      const earcup = box(headR * 0.4, headR * 0.5, headR * 0.4, matDark); earcup.position.set(headR * 0.95, headY, 0); G.add(earcup);
      const ant = cyl(headR * 0.05, headR * 0.05, targetH * 0.16, matDark, 6); ant.position.set(headR * 0.95, headY + targetH * 0.12, 0); G.add(ant);
      const tip = sph(headR * 0.12, matA); tip.position.set(headR * 0.95, headY + targetH * 0.2, 0); G.add(tip); // glowing antenna tip
      tip.material = _gmat(lt, 0.3, 0.1); tip.material.emissive = new THREE.Color(A).multiplyScalar(0.6);
    } else if (cls === "ranger") {
      // SCOUT: low beret + a back-slung KNIFE over the shoulder; no heavy armor.
      const beret = cyl(headR * 1.15, headR * 1.05, headR * 0.5, matA, 12); beret.scale.y = 0.7; beret.rotation.z = 0.18; beret.position.set(headR * 0.12, headTop - headR * 0.25, 0); G.add(beret);
      const tab = box(headR * 0.3, headR * 0.3, headR * 0.3, matLt); tab.position.set(-headR * 0.7, headTop - headR * 0.1, 0); G.add(tab); // beret flash
      const hood = box(headR * 1.9, targetH * 0.14, headR * 1.6, matDark); hood.position.set(0, shoY + targetH * 0.03, -headR * 0.3); G.add(hood); // light shoulder hood/scarf
      // back-mounted blade jutting up past the shoulder (the agile-knife read)
      const sheath = box(targetH * 0.05, targetH * 0.24, targetH * 0.03, matDark); sheath.position.set(-targetH * 0.14, backY + targetH * 0.05, -targetH * 0.1); sheath.rotation.z = 0.32; G.add(sheath);
      const blade = box(targetH * 0.035, targetH * 0.2, targetH * 0.012, matLt); blade.position.set(-targetH * 0.2, backY + targetH * 0.2, -targetH * 0.1); blade.rotation.z = 0.32; G.add(blade);
      const hilt = box(targetH * 0.09, targetH * 0.03, targetH * 0.03, matA); hilt.position.set(-targetH * 0.11, backY - targetH * 0.06, -targetH * 0.1); hilt.rotation.z = 0.32; G.add(hilt);
    } else if (cls === "grenadier") {
      // HEAVY WEAPONS: oversized pauldrons + a big back CANISTER/grenade rack.
      for (const sx of [-1, 1]) { const pad = box(shoX * 1.15, targetH * 0.17, targetH * 0.2, matBase); pad.position.set(sx * shoX * 1.12, shoY + targetH * 0.02, 0); G.add(pad); const ridge = box(shoX * 1.16, targetH * 0.05, targetH * 0.06, matA); ridge.position.set(sx * shoX * 1.12, shoY + targetH * 0.1, 0); G.add(ridge); const stud = sph(targetH * 0.04, matDark); stud.position.set(sx * shoX * 1.35, shoY + targetH * 0.02, 0); G.add(stud); }
      const tank = cyl(targetH * 0.11, targetH * 0.11, targetH * 0.34, matBase, 14); tank.position.set(0, backY + targetH * 0.02, -targetH * 0.14); G.add(tank); // back canister
      const tankCap = cyl(targetH * 0.115, targetH * 0.115, targetH * 0.04, matA, 14); tankCap.position.set(0, backY + targetH * 0.2, -targetH * 0.14); G.add(tankCap);
      for (let i = 0; i < 3; i++) { const nade = sph(targetH * 0.045, matDark); nade.position.set((i - 1) * targetH * 0.1, chestY - targetH * 0.04, targetH * 0.12); G.add(nade); const pin = sph(targetH * 0.018, matA); pin.position.set((i - 1) * targetH * 0.1, chestY + targetH * 0.0, targetH * 0.12); G.add(pin); } // grenade bandolier
      const collar = box(targetH * 0.3, targetH * 0.08, targetH * 0.22, matBase); collar.position.set(0, shoY - targetH * 0.02, 0); G.add(collar); // bulky armored collar
    }
    // light team-accent emissive so the gear reads in the dark dusk board (no light added)
    G.traverse((o) => { if (o.isMesh && o.material && o.material.emissive && o.material.color && o.material.color.getHex() === A) o.material.emissive = new THREE.Color(A).multiplyScalar(0.18); });
    _gearCache[key] = G;
    return G.clone(true);
  }

  async function makeUnit(u) {
    const w = cell(u.x, u.y);
    const g = new THREE.Group(); g.position.set(w.x, 0.2 + _floorLift(u.x, u.y, u.floor || 0), w.z);
    const col = unitColor(u), dark = shade(col, -0.5);
    // faction base ring (selection + team id)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.36, T * 0.36, 0.1, 26),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.5 }));
    ring.position.y = 0.06; g.add(ring);

    const isPlayer = u.side === "player";
    const kind = isPlayer ? playerKind(u) : enemyKind(u); // per-class body+scale for players; species for enemies
    const def = MODELS[kind.model];
    let char = null, unitGear = null; // unitGear = per-class procedural kit (silhouette)
    try { char = await kernel.loadCharacter(CHAR_BASE + def.url); } catch (e) { char = null; }
    // resolve this model's actual clip names (some models name clips differently)
    let clips = { idle: null, walk: null, die: null, attack: null };
    if (char) {
      clips = {
        idle: resolveClip(char, def.clips.idle), walk: resolveClip(char, def.clips.walk),
        die: def.clips.die && char.actions[def.clips.die] ? def.clips.die : null,
        attack: def.clips.attack && char.actions[def.clips.attack] ? def.clips.attack : null,
        hurt: def.clips.hurt && char.actions[def.clips.hurt] ? def.clips.hurt : null,
      };
      const mdl = char.scene;
      g.add(mdl);
      // Skinned-mesh clones carry stale bounding volumes -> the renderer culls
      // them even when on-screen (and Box3.setFromObject mis-measures them). Use
      // the models' KNOWN native heights (feet at origin) for a correct scale.
      mdl.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
      const NATIVE_H = def.h;
      const targetH = def.th * (kind.scale || 1);
      mdl.scale.setScalar(targetH / NATIVE_H);
      mdl.position.y = 0.05; // model origin is at the feet -> sit on the base ring
      // Give the trooper a RIFLE in the right hand (the models ship no weapon mesh).
      // Parented to the right-hand BONE so it follows the hands through every
      // animation. Quaternius rigs (swat/adventurer) name it "Wrist.R"; the Mixamo
      // body (grunt) names it "mixamorig:RightHand" and lives in cm-scale joint
      // space, so we size the rifle to the bone's own world scale. The medic
      // (specialist=grunt) carries no rifle — a field-medic read (medkit instead).
      const noRifle = isPlayer && kind.model === "grunt"; // medic stays unarmed
      if (isPlayer && !noRifle) {
        try {
          let wrist = null; mdl.traverse((o) => { if (o.isBone && (o.name === "Wrist.R" || o.name === "mixamorig:RightHand")) wrist = o; });
          if (wrist) {
            // size the rifle to the bone's WORLD scale so it's the same real size on
            // any rig (Quaternius bone ~1u; Mixamo bone ~0.01u → big local numbers).
            wrist.updateWorldMatrix(true, false);
            const bs = new THREE.Vector3(); wrist.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), bs);
            const inv = 1 / Math.max(1e-4, (bs.x + bs.y + bs.z) / 3);
            const rifle = new THREE.Group();
            rifle.add(_bx(0.06, 0.46, 0.1, 0x202327, 0.5, 0.4)).position.y = 0.18;        // receiver/stock
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 8), _smat(0x141518, 0.4, 0.6)); barrel.position.y = 0.46; rifle.add(barrel);
            const mag = _bx(0.05, 0.13, 0.06, 0x16181c, 0.6, 0.3); mag.position.set(0, 0.06, -0.09); rifle.add(mag);
            rifle.position.set(0.0, 0.03, 0.03);
            rifle.scale.setScalar(inv);            // normalise to world size across rigs
            pbrApply(rifle, "metal", 4); // gunmetal: low roughness + metal so the weapon glints under the sky env
            wrist.add(rifle);
          }
        } catch (e) {}
      }
      // ── PER-CLASS GEAR — the real silhouette difference (owner: "must look
      //    different, not just colours"). Attached to the UNIT GROUP at body
      //    landmarks scaled to the rendered height, so it fits every body the same.
      if (isPlayer && u.cls) {
        try {
          const renderedH = def.th * (kind.scale || 1);   // world-space unit height
          const gear = _gearGroup((u.cls || "").toLowerCase(), col, renderedH);
          gear.position.y = 0.05;                          // align with model feet
          g.add(gear);
          unitGear = gear; // so HUNKER squash can scale it with the body
        } catch (e) {}
      }
      // enemy class tint; players get a faint team-coloured emissive so the dark
      // camo soldier reads against the dark board.
      const accent = isPlayer ? col : (kind.tint || 0xff6a5a);
      const unitRole = isPlayer ? "unit_armor" : "unit_bot";
      let _uv = 0;
      mdl.traverse((o) => {
        if ((o.isMesh || o.isSkinnedMesh) && o.material) {
          o.material = o.material.clone();
          if (!isPlayer && o.material.color) o.material.color.lerp(new THREE.Color(accent), 0.32); // light menace tint — keep model identity
          // PLAYERS: the night map is dark, so LIFT the (near-black) camo armor to a
          // readable steel — the armor + class silhouette read instead of a flat
          // black blob — and apply only a FAINT team-colour emissive accent (the old
          // 0.22 cyan emissive washed the whole body monochrome = "no armour/colour").
          if (isPlayer && o.material.color) o.material.color.lerp(new THREE.Color(0x8c98a6), 0.34);
          o.material.emissive = new THREE.Color(accent).multiplyScalar(isPlayer ? 0.05 : 0.18);
          // PBR pass: armor/hull roughness + metalness + envMapIntensity so the
          // sky env grazes the units (no longer flat-shaded). Per-mesh roughness
          // wobble keeps plates/joints from reading as one uniform surface.
          _applyRoleToMaterial(o.material, unitRole, _uv++);
        }
      });
      char.play(clips.idle, { fade: 0 });
    } else {
      // fallback: simple capsule so the unit still exists if the GLB fails
      const body = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.16, T * 0.22, T * 0.8, 10), new THREE.MeshStandardMaterial({ color: col }));
      body.position.y = T * 0.5; g.add(body);
    }
    // HP bar (billboard)
    const hpY = T * 1.7;
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.62, 0.16), new THREE.MeshBasicMaterial({ color: 0x0a0f17 }));
    const hpFill = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.58, 0.1), new THREE.MeshBasicMaterial({ color: 0x3ddc84 }));
    hpBg.position.set(0, hpY, 0); hpFill.position.set(0, hpY, 0.01);
    g.add(hpBg); g.add(hpFill);
    // Cover-shield badge (the iconic XCOM read): solid = full cover, half = half.
    const cover = makeShieldSprite(); cover.position.set(0, hpY + 0.55, 0); cover.visible = false; g.add(cover);
    scene.add(g);
    kernel.onUpdate(() => { hpBg.quaternion.copy(kernel.camera.quaternion); hpFill.quaternion.copy(kernel.camera.quaternion); cover.quaternion.copy(kernel.camera.quaternion); });
    unitViews[u.id] = { group: g, ring, hpFill, cover, base: col, dark, hpW: T * 0.58, char, clips, gear: unitGear, dead: false };
    faceUnit(u, isPlayer ? -1 : 1); // players look "north" toward the enemy, enemies "south"
    updateCover(u);
    // Fog of war: an enemy whose pod isn't revealed stays hidden until spotted.
    // Enemies are VISIBLE on the map from the start (you can see your targets —
    // an empty board reads as "no game"). Concealment stays a GAMEPLAY state
    // (ambush + they don't act until spotted), it no longer hides them visually.
    // Unspotted foes are dimmed slightly so a revealed CONTACT still reads.
    if (!isPlayer && !sim.podRevealed(u.pod)) {
      g.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.material) { o.material.transparent = true; o.material.opacity = 0.82; } });
    }
  }
  // Reveal a pod's units in the scene (called from the sim's "reveal" event).
  function revealPodView(ids) {
    (ids || []).forEach((id) => { const v = unitViews[id]; if (v) { v.group.visible = true; const u = sim.getUnit(id); if (u) { const w = cell(u.x, u.y); floatText({ x: w.x, y: T * 1.9, z: w.z }, "CONTACT!", 0xff5a3c); } } });
  }
  // Show each unit's best available cover as an XCOM-style shield over its head.
  function updateCover(u) {
    const v = unitViews[u.id]; if (!v || !v.cover) return;
    if (u.hp <= 0) { v.cover.visible = false; return; }
    const cov = sim.coverAt(u); // 0 none / 1 half / 2 full (best adjacent)
    // HUNKER pose: player soldiers squash down behind cover (feet planted) — a
    // crouch read without a dedicated crouch clip. Full cover crouches lower.
    if (v.char && v.char.scene && u.side === "player") {
      const baseS = v.char.scene.scale.x || 1;
      const sq = (cov === 2 ? 0.74 : cov === 1 ? 0.84 : 1);
      v.char.scene.scale.y = baseS * sq;
      if (v.gear) v.gear.scale.y = sq; // squash the kit with the body so it stays seated (gear is group-parented, not bone-parented)
    }
    if (cov === 0) { v.cover.visible = false; return; }
    v.cover.visible = true; v.cover.material.map = shieldTex(cov === 2); v.cover.material.needsUpdate = true;
  }
  function refreshAllCover() { sim.allUnits().forEach((u) => { if (u.hp > 0) updateCover(u); }); }
  function faceUnit(u, dir) { const v = unitViews[u.id]; if (v && v.char) { const a = dir > 0 ? 0 : Math.PI; v.char.scene.rotation.y = a; if (v.gear) v.gear.rotation.y = a; } } // turn the kit with the body (gear is group-parented)
  function faceToward(u, tx, ty) {
    const v = unitViews[u.id]; if (!v || !v.char) return;
    const a = Math.atan2(tx - u.x, ty - u.y); // grid +z is "down"; model faces +z at rot 0
    v.char.scene.rotation.y = a;
    if (v.gear) v.gear.rotation.y = a; // keep helmet/scope/backpack aligned to facing
  }
  function anim(u, intent, opts) { const v = unitViews[u.id]; if (v && v.char && v.clips[intent]) v.char.play(v.clips[intent], opts); }
  // ── Game feel (juice) ───────────────────────────────────────────────────────
  // Canvas screen-shake via a CSS transform on the renderer element — decoupled
  // from the orbit camera so it never fights the controls. Decays over ~260ms.
  function screenShake(mag) {
    const el = kernel.renderer && kernel.renderer.domElement; if (!el || !mag) return;
    const reduce = (window.FFG && window.FFG.reducedMotion) ? 0.3 : 1;
    const start = performance.now(), dur = 260;
    (function frame(now) {
      const p = (now - start) / dur;
      if (p >= 1) { el.style.transform = ""; return; }
      const k = mag * (1 - p) * reduce;
      el.style.transform = `translate(${(Math.random() * 2 - 1) * k}px, ${(Math.random() * 2 - 1) * k}px)`;
      requestAnimationFrame(frame);
    })(start);
  }
  // Muzzle flash — a brief additive warm burst at the shooter's gun (NO point
  // light; that would recompile shaders). Nudged toward the target.
  function muzzleFlash(shooterPos, targetPos) {
    const m = shooterPos.clone(); m.y = T * 0.62;
    if (targetPos) { const d = targetPos.clone().sub(shooterPos); d.y = 0; if (d.lengthSq() > 0.001) m.add(d.normalize().multiplyScalar(T * 0.42)); }
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.copy(m); scene.add(f);
    kernel.tween({ target: f.scale, to: { x: 2.8, y: 2.8, z: 2.8 }, duration: 0.11 });
    kernel.tween({ target: f.material, to: { opacity: 0 }, duration: 0.11, onComplete: () => scene.remove(f) });
  }
  // Impact spark/debris burst — small bits fly out + fall, fading. Sells hits.
  function sparkBurst(pos, color, n) {
    const c = color || 0xffd27a, count = n || 6;
    for (let i = 0; i < count; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.06, 5, 4),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.copy(pos); scene.add(s);
      const a = Math.random() * Math.PI * 2, sp = 0.7 + Math.random() * 1.1, up = 0.6 + Math.random() * 1.0;
      kernel.tween({ target: s.position, to: { x: pos.x + Math.cos(a) * sp, y: pos.y + up, z: pos.z + Math.sin(a) * sp }, duration: 0.42, ease: (t) => 1 - (1 - t) * (1 - t) });
      kernel.tween({ target: s.material, to: { opacity: 0 }, duration: 0.42, onComplete: () => scene.remove(s) });
    }
  }
  // Hit-react: play the model's flinch clip if it has one, else a quick punch.
  function flinch(u) {
    const v = unitViews[u.id]; if (!v || v.dead) return;
    if (v.char && v.clips.hurt) { v.char.play(v.clips.hurt, { once: true, fade: 0.06 }); setTimeout(() => { if (!v.dead) anim(u, "idle", { fade: 0.16 }); }, 460); }
    else { const g = v.group, oy = g.position.y; kernel.tween({ target: g.position, to: { y: oy + 0.1 }, duration: 0.05, onComplete: () => kernel.tween({ target: g.position, to: { y: oy }, duration: 0.13 }) }); }
  }
  function refreshUnit(u) {
    const v = unitViews[u.id]; if (!v) return;
    if (u.hp <= 0) { killUnit(u); return; }
    const pct = Math.max(0, u.hp / u.maxHp);
    v.hpFill.scale.x = Math.max(0.001, pct);
    v.hpFill.position.x = -(v.hpW * (1 - pct)) / 2;
    v.hpFill.material.color.setHex(pct > 0.5 ? 0x3ddc84 : pct > 0.25 ? 0xf5c518 : 0xff5a5a);
    updateCover(u);
  }
  function killUnit(u) {
    const v = unitViews[u.id]; if (!v || v.dead) return; v.dead = true;
    v.hpFill.visible = false;
    if (v.char && v.clips.die) { v.char.play(v.clips.die, { once: true, fade: 0.15 }); kernel.tween({ target: v.group.position, to: { y: v.group.position.y }, duration: 1.0, onComplete: () => fadeOut(v) }); }
    else { kernel.tween({ target: v.group.rotation, to: { z: Math.PI / 2 }, duration: 0.5 }); kernel.tween({ target: v.group.position, to: { y: -0.4 }, duration: 0.8, onComplete: () => fadeOut(v) }); }
  }
  function fadeOut(v) { setTimeout(() => { v.group.visible = false; }, 700); }

  // ── Camera (cinematic, rotatable) ───────────────────────────────────────────
  // Frame CLOSE behind the squad at a low XCOM-style angle so soldiers read
  // large and you're down in the streets — not a tiny diorama seen from orbit.
  // The player can still scroll out to the full-map overview (maxDistance) or
  // WASD-glide across the board.
  const span = Math.max(W, H);
  let scx = 0, scy = 0;
  for (const u of deployUnits) { scx += u.x; scy += u.y; }
  scx = deployUnits.length ? scx / deployUnits.length : gridW / 2;
  scy = deployUnits.length ? scy / deployUnits.length : gridH / 2;
  const focus = cell(Math.round(scx), Math.round(scy)); focus.y = 0;
  const camDist = T * 17; // close enough that a soldier fills a good chunk of frame
  kernel.camera.fov = 40; kernel.camera.updateProjectionMatrix();
  kernel.camera.position.set(focus.x + camDist * 0.6, camDist * 0.62, focus.z + camDist * 0.8);
  const orbit = kernel.enableOrbit({
    target: { x: focus.x, y: 0, z: focus.z },
    minDistance: T * 7, maxDistance: span * 2.2,
    minPolarAngle: 0.22, maxPolarAngle: Math.PI * 0.47,
    rotateButton: "right", wasdPan: true, panSpeed: span * 0.7,
    autoRotate: true, autoRotateSpeed: 0.32,
  });

  // ── Cinematic kill-cam ──────────────────────────────────────────────────────
  // On a kill, swoop CLOSE to frame the shooter→victim, hold, then glide back to
  // the tactical camera. The updater runs AFTER OrbitControls.update() so it can
  // override the camera while active; orbit input is paused for the duration.
  const reducedMotionKC = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let kc = null; // { t, dur, savedPos, savedTarget, cinePos, focus }
  function triggerKillCam(shooterPos, targetPos) {
    if (kc || reducedMotionKC || phase !== "battle") return false;
    const dir = new THREE.Vector3().subVectors(targetPos, shooterPos); dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const cinePos = targetPos.clone()
      .addScaledVector(dir, -T * 2.4)      // back toward the shooter
      .addScaledVector(side, T * 1.7)      // off to one side
      .add(new THREE.Vector3(0, T * 1.7, 0)); // raised
    kc = {
      t: 0, dur: 1.15,
      savedPos: kernel.camera.position.clone(),
      savedTarget: kernel.controls.target.clone(),
      cinePos, focus: targetPos.clone().add(new THREE.Vector3(0, T * 0.4, 0)),
    };
    kernel.controls.enabled = false;
    return true;
  }
  const _kcTmp = new THREE.Vector3();
  kernel.onUpdate((dt) => {
    if (!kc) return;
    kc.t += dt;
    const p = Math.min(1, kc.t / kc.dur);
    const ease = (a) => a * a * (3 - 2 * a);
    if (p < 0.32) { const k = ease(p / 0.32); _kcTmp.lerpVectors(kc.savedPos, kc.cinePos, k); }      // swoop in
    else if (p < 0.72) { _kcTmp.copy(kc.cinePos); }                                                   // hold
    else { const k = ease((p - 0.72) / 0.28); _kcTmp.lerpVectors(kc.cinePos, kc.savedPos, k); }       // glide back
    kernel.camera.position.copy(_kcTmp);
    const f = p < 0.72 ? kc.focus : kc.focus.clone().lerp(kc.savedTarget, ease((p - 0.72) / 0.28));
    kernel.camera.lookAt(f);
    if (p >= 1) {
      kernel.camera.position.copy(kc.savedPos);
      kernel.controls.target.copy(kc.savedTarget);
      kernel.controls.enabled = true; kernel.controls.update();
      kc = null;
    }
  });

  // ── Highlights + selection ──────────────────────────────────────────────────
  function clearHighlights() { highlights.forEach((h) => scene.remove(h)); highlights = []; rangeTargets = []; }
  // Yellow ACTIVE-SOLDIER chevron (the XCOM "this is the unit you control" marker)
  // — a spinning gold cone bobbing above the selected soldier.
  let _chevron = null;
  function ensureChevron() {
    if (_chevron) return _chevron;
    const m = new THREE.Mesh(new THREE.ConeGeometry(T * 0.2, T * 0.34, 4), new THREE.MeshBasicMaterial({ color: 0xffe24a }));
    m.rotation.x = Math.PI; m.visible = false; scene.add(m);
    kernel.onUpdate((dt) => {
      if (!m.visible || !m._target) return;
      m._t = (m._t || 0) + dt; const p = m._target.position;
      m.position.set(p.x, T * 2.05 + Math.sin(m._t * 3) * 0.12, p.z); m.rotation.z = m._t * 1.6;
    });
    _chevron = m; return m;
  }
  function selectUnit(u) {
    if (!u || u.side !== "player" || u.hp <= 0) return;
    const reselect = selected === u;
    selected = u; abilityMode = null; clearHighlights();
    if (!reselect) sfx("select", 0.4);
    const v = unitViews[u.id]; if (v) v.ring.material.emissiveIntensity = 1.0;
    const ch = ensureChevron(); ch.visible = true; ch._target = v ? v.group : null;
    (sim.reachableTiles(u) || []).forEach((r) => {
      const w = cell(r.x, r.y);
      const up = (r.floor || 0) === 1; // upper-storey reachable tile → warm marker, raised to the slab
      const m = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.84, T * 0.84),
        new THREE.MeshBasicMaterial({ color: up ? 0xffc04a : 0x4fd0ff, transparent: true, opacity: u.actionPoints > 0 ? (up ? 0.3 : 0.22) : 0.08, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(w.x, up ? FLOOR_H + 0.22 : 0.24, w.z); scene.add(m); highlights.push(m);
    });
    applyCutaway(u.floor || 0); // cut away the storey the player isn't on so the action stays visible
    setHUD();
  }
  function deselect() {
    if (selected) { const v = unitViews[selected.id]; if (v) v.ring.material.emissiveIntensity = 0.35; }
    selected = null; abilityMode = null; clearHighlights(); if (_chevron) _chevron.visible = false; applyCutaway(null); setHUD();
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  // Class identity for the HUD + roster bar (role label, icon, colour, signature power).
  const CLASS_INFO = {
    vanguard:     { role: "Assault",      icon: "▲", color: "#3aa0ff", power: "Suppression" },
    sharpshooter: { role: "Sharpshooter", icon: "◎", color: "#ff9a3c", power: "Headshot" },
    specialist:   { role: "Specialist",   icon: "✚", color: "#3ddc84", power: "Field Medic" },
    ranger:       { role: "Ranger",       icon: "⚔", color: "#22d3ee", power: "Slash" },
    grenadier:    { role: "Grenadier",    icon: "✸", color: "#a3e635", power: "Frag Grenade" },
  };
  function classInfo(cls) { return CLASS_INFO[cls] || { role: cls || "Soldier", icon: "•", color: "#9fb4d0", power: "" }; }
  function setHUD(msg) {
    const me = sim.aliveAllies().length, foe = sim.aliveEnemies().length;
    const ph = sim.currentPhase === "player";
    const banner = msg || (ph ? "Your phase — select a soldier" : "Enemy phase…");
    const bc = ph ? "#7CFC9A" : "#ffb454";
    let sel = "";
    if (selected) {
      const ci = classInfo(selected.cls);
      const col = "#" + unitViews[selected.id].base.toString(16).padStart(6, "0");
      sel = `<div style="margin-top:6px;background:rgba(8,18,32,.8);border-left:3px solid ${ci.color};padding:6px 12px;border-radius:5px;font-size:12px;max-width:360px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">
          <span style="font-size:16px;color:${ci.color}">${ci.icon}</span>
          <b style="font-size:13px">${selected.name}</b>
          <span style="color:${ci.color};font-weight:700;letter-spacing:1px;font-size:11px">${ci.role.toUpperCase()}</span>
        </div>
        <span style="opacity:.9">HP ${selected.hp}/${selected.maxHp} &nbsp;·&nbsp; AP ${selected.actionPoints}/${selected.maxAP} &nbsp;·&nbsp; AIM ${Math.round(selected.aim * 100)}% &nbsp;·&nbsp; RANGE ${selected.range || 1}</span>
        ${ci.power ? `<div style="margin-top:3px;font-size:11px;opacity:.75">⚡ Special power: <b style="color:${ci.color}">${ci.power}</b> — see the ability bar below</div>` : ""}
      </div>`;
    }
    kernel.hud(`
      <div style="position:absolute;top:12px;left:14px;font-family:'Segoe UI',system-ui,monospace">
        <div style="font-size:19px;font-weight:800;letter-spacing:2px;text-shadow:0 2px 10px #000">${content.title || "Operation"}</div>
        <div style="margin-top:6px;display:inline-block;background:rgba(8,18,32,.72);border:1px solid ${bc}55;border-left:3px solid ${bc};border-radius:4px;padding:5px 13px;font-size:13px">
          ${missions.length > 1 ? `<span style="opacity:.7">Mission ${missionIndex + 1}/${missions.length}</span> · ` : ""}<span style="opacity:.7">Turn ${sim.turnNumber}</span> · <span style="color:${bc};font-weight:700">${banner}</span>${sim.concealed ? ` · <span style="color:#9fe6c0;font-weight:700;letter-spacing:1px">◑ CONCEALED</span>` : ""}
        </div>${sel}
      </div>
      <div style="position:absolute;top:12px;right:14px;font-family:'Segoe UI',monospace;background:rgba(8,18,32,.62);border:1px solid #2a4458;border-radius:9px;padding:9px 13px;text-align:right;font-size:12px">
        <div style="color:#7CFC9A">SQUAD ${me}</div><div style="color:#ff7a6a;margin-top:3px">HOSTILES ${foe}</div>
        ${(sim.goal && sim.goal.turnLimit != null) ? `<div style="margin-top:3px;color:${sim.turnNumber > sim.goal.turnLimit - 2 ? "#ff6a5a" : "#ffd27a"};font-weight:700">⏱ ${Math.max(0, sim.goal.turnLimit - sim.turnNumber + 1)} turns left</div>` : ""}
        ${(sim.goal && sim.goal.type === "hack") ? `<div style="margin-top:3px;color:${sim.goal.hacked ? "#3ddc84" : "#5fd0ff"}">TERMINAL: ${sim.goal.hacked ? "HACKED ✓" : "reach it"}</div>` : ""}
        ${(sim.goal && sim.goal.type === "evac") ? `<div style="margin-top:3px;color:#9dffb6">EVAC: get all soldiers to the pad</div>` : ""}
        <div style="font-size:11px;opacity:.6;margin-top:5px">Objective: ${mission.objective || "Eliminate all hostiles"}</div>
      </div>
      <div style="position:absolute;bottom:10px;left:14px;font-size:11px;opacity:.55;font-family:monospace">Click soldier → move/shoot · Right-drag: rotate · WASD: move · Esc: pause</div>
    `);
    renderEndBtn(ph);
  }
  let endBtnEl = null, owBtnEl = null, hkBtnEl = null;
  function renderEndBtn(show) {
    if (!endBtnEl) {
      endBtnEl = document.createElement("button");
      Object.assign(endBtnEl.style, { position: "absolute", right: "16px", bottom: "16px", zIndex: "50", font: "bold 13px 'Segoe UI',monospace", letterSpacing: "1px", padding: "10px 20px", borderRadius: "7px", cursor: "pointer", color: "#06101c", background: "linear-gradient(#9dffb6,#4fe084)", border: "1px solid #7CFC9A" });
      endBtnEl.textContent = "END TURN";
      endBtnEl.onclick = () => endTurn();
      kernel.parent.appendChild(endBtnEl);
      owBtnEl = document.createElement("button");
      Object.assign(owBtnEl.style, { position: "absolute", right: "140px", bottom: "16px", zIndex: "50", font: "bold 13px 'Segoe UI',monospace", letterSpacing: "1px", padding: "10px 18px", borderRadius: "7px", cursor: "pointer", color: "#06101c", background: "linear-gradient(#bfe6ff,#5fb0e0)", border: "1px solid #9fd0ff" });
      owBtnEl.textContent = "OVERWATCH (Y)";
      owBtnEl.onclick = () => overwatchSelected();
      kernel.parent.appendChild(owBtnEl);
      hkBtnEl = document.createElement("button");
      Object.assign(hkBtnEl.style, { position: "absolute", right: "286px", bottom: "16px", zIndex: "50", font: "bold 13px 'Segoe UI',monospace", letterSpacing: "1px", padding: "10px 18px", borderRadius: "7px", cursor: "pointer", color: "#0c0a04", background: "linear-gradient(#ffe6a0,#e0b24f)", border: "1px solid #ffd27a" });
      hkBtnEl.textContent = "HUNKER (H)";
      hkBtnEl.onclick = () => hunkerSelected();
      kernel.parent.appendChild(hkBtnEl);
    }
    const playable = show && phase === "battle" && !busy && !sim.ended;
    endBtnEl.style.display = playable ? "block" : "none";
    owBtnEl.style.display = (playable && selected && selected.actionPoints > 0) ? "block" : "none";
    hkBtnEl.style.display = (playable && selected && selected.actionPoints > 0) ? "block" : "none";
    renderAbilityBar(playable);
    renderRosterBar(playable);
  }
  // Bottom-centre ability bar — one button per class ability of the selected
  // soldier, with hotkey, charges/cooldown, and an armed (highlighted) state.
  let abilityBarEl = null;
  function renderAbilityBar(playable) {
    if (!abilityBarEl) {
      abilityBarEl = document.createElement("div");
      Object.assign(abilityBarEl.style, { position: "absolute", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: "50", display: "flex", gap: "8px", fontFamily: "'Segoe UI',monospace" });
      kernel.parent.appendChild(abilityBarEl);
    }
    const abils = (playable && selected) ? sim.abilitiesFor(selected.id) : [];
    if (!abils.length) { abilityBarEl.style.display = "none"; abilityBarEl.innerHTML = ""; return; }
    abilityBarEl.style.display = "flex";
    abilityBarEl.innerHTML = "";
    for (const a of abils) {
      const armed = abilityMode === a.id;
      const meta = a.charges != null ? ("×" + a.charges) : (a.cooldown > 0 ? ("CD " + a.cooldown) : "");
      const b = document.createElement("button");
      b.title = a.desc;
      b.innerHTML = `<div style="font-weight:700"><span style="font-size:10px;opacity:.7">[${a.key}]</span> ${a.name}${meta ? ` <span style="opacity:.7;font-size:11px">${meta}</span>` : ""}</div>` +
        `<div style="font-size:10px;opacity:.72;font-weight:400;max-width:150px;white-space:normal;line-height:1.2;margin-top:2px">${a.desc || ""}</div>`;
      Object.assign(b.style, {
        font: "600 12px 'Segoe UI',monospace", letterSpacing: ".5px", padding: "8px 12px", borderRadius: "7px", textAlign: "left",
        cursor: a.ready ? "pointer" : "not-allowed", color: a.ready ? (armed ? "#06101c" : "#e8f2ff") : "#5b6b7e",
        background: armed ? "linear-gradient(#ffd27a,#ffae5a)" : (a.ready ? "rgba(20,38,58,.92)" : "rgba(16,24,34,.7)"),
        border: "1px solid " + (armed ? "#ffd27a" : a.ready ? "#3a5e7e" : "#26303d"),
        boxShadow: armed ? "0 0 14px rgba(255,180,90,.6)" : "none",
      });
      b.onclick = () => { if (a.ready) armAbility(a.id); };
      abilityBarEl.appendChild(b);
    }
  }
  // ── Soldier ROSTER bar (XCOM-style): a card per squad member showing class,
  // role, HP, action points; the active soldier is highlighted; click to select.
  let rosterBarEl = null;
  function renderRosterBar(playable) {
    if (!rosterBarEl) {
      rosterBarEl = document.createElement("div");
      Object.assign(rosterBarEl.style, { position: "absolute", left: "14px", bottom: "54px", zIndex: "50", display: "flex", gap: "6px", fontFamily: "'Segoe UI',monospace" });
      kernel.parent.appendChild(rosterBarEl);
    }
    const squad = sim.allUnits().filter((u) => u.side === "player");
    if (!squad.length || phase !== "battle") { rosterBarEl.style.display = "none"; return; }
    rosterBarEl.style.display = "flex";
    rosterBarEl.innerHTML = "";
    for (const u of squad) {
      const ci = classInfo(u.cls), dead = u.hp <= 0, isSel = selected && selected.id === u.id;
      const hpPct = Math.max(0, u.hp / (u.maxHp || 1)), apN = dead ? 0 : (u.actionPoints || 0), apMax = u.maxAP || 2;
      const card = document.createElement("div");
      card.title = dead ? `${ci.role} — KIA` : `${ci.role} · power: ${ci.power}`;
      const pips = Array.from({ length: apMax }, (_, i) => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:2px;background:${i < apN ? ci.color : "#26303d"}"></span>`).join("");
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:15px;color:${ci.color}">${ci.icon}</span>
          <div style="font-size:10px;font-weight:800;color:${ci.color};letter-spacing:.5px">${ci.role.toUpperCase()}</div>
        </div>
        <div style="height:4px;background:#0a141f;border-radius:2px;margin:4px 0 3px;overflow:hidden"><div style="height:100%;width:${hpPct * 100}%;background:${hpPct > 0.5 ? "#3ddc84" : hpPct > 0.25 ? "#f5c518" : "#ff5a5a"}"></div></div>
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="opacity:.6;font-size:9px">${dead ? "KIA" : "HP " + u.hp}</span><span>${pips}</span></div>`;
      Object.assign(card.style, {
        minWidth: "78px", padding: "6px 8px", borderRadius: "7px", cursor: (!dead && playable) ? "pointer" : "default",
        background: isSel ? "rgba(28,50,72,.96)" : "rgba(8,18,32,.82)", border: "1px solid " + (isSel ? ci.color : "#2a4458"),
        boxShadow: isSel ? `0 0 12px ${ci.color}99` : "none", opacity: dead ? "0.4" : "1", transition: "all .12s",
      });
      if (!dead && playable) card.onclick = () => selectUnit(u);
      rosterBarEl.appendChild(card);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function onTileClick(x, y) {
    if (phase !== "battle" || busy || sim.ended || sim.currentPhase !== "player") return;
    if (abilityMode) { useAbilityAt(x, y); return; } // an ability is armed
    const occupant = sim.allUnits().find((u) => u.hp > 0 && u.x === x && u.y === y);
    if (occupant && occupant.side === "player") { selectUnit(occupant); return; }
    if (!selected) return;
    if (occupant && occupant.side === "enemy") { tryAttack(occupant); return; }
    tryMove(x, y);
  }
  // All actions flow through the sim then animate the resulting EVENT queue, so
  // reaction fire (enemy overwatch on a player move) is shown automatically.
  function afterAction(u) {
    busy = false; refreshAllCover();
    if (sim.ended) return showEnd();
    autoSelectNext(u); // keep u if it still has actions, else jump to the next ready soldier
  }
  // Auto-advance selection so the player never has to hunt for the next unit:
  // keep the just-acted soldier while it still has actions, otherwise select the
  // remaining soldier with the MOST movement (then most actions). When the whole
  // squad is spent, deselect + nudge the player to End Turn.
  function autoSelectNext(keep) {
    if (phase !== "battle" || sim.ended || sim.currentPhase !== "player") return;
    if (keep && keep.hp > 0 && keep.actionPoints > 0 && keep.side === "player") { selectUnit(keep); return; }
    const ready = sim.aliveAllies().filter((u) => u.actionPoints > 0);
    if (!ready.length) { deselect(); setHUD("All soldiers have acted — End Turn"); return; }
    ready.sort((a, b) => ((b.movement || 0) - (a.movement || 0)) || (b.actionPoints - a.actionPoints));
    selectUnit(ready[0]);
  }
  function tryMove(x, y, floor) {
    const u = selected; if (!u || u.actionPoints < 1) return;
    let cands = (sim.reachableTiles(u) || []).filter((r) => r.x === x && r.y === y);
    if (floor != null) cands = cands.filter((r) => (r.floor || 0) === floor);
    if (!cands.length) return;
    // ambiguous cell reachable on BOTH storeys (a stairwell): prefer the floor the
    // unit is NOT on, so a click climbs up / steps down intuitively.
    let pick = cands[0];
    if (cands.length > 1) pick = cands.find((r) => (r.floor || 0) !== (u.floor || 0)) || cands[0];
    const path = sim.moveUnit(u.id, x, y, pick.floor || 0); if (!path) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  function tryAttack(target) {
    const u = selected; if (!u || u.actionPoints < 1) return;
    const r = sim.attackUnit(u.id, target.id); if (!r || !r.success) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  function overwatchSelected() {
    const u = selected; if (!u || u.actionPoints < 1 || busy || sim.ended) return;
    if (!sim.overwatchUnit(u.id)) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  function hunkerSelected() {
    const u = selected; if (!u || u.actionPoints < 1 || busy || sim.ended) return;
    const r = sim.hunkerUnit(u.id); if (!r || !r.success) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }

  // ── Class abilities (Phase 3) ───────────────────────────────────────────────
  function abilityDef(id) { return (sim.abilitiesFor(selected ? selected.id : "") || []).find((a) => a.id === id); }
  function armAbility(id) {
    if (!selected || busy || sim.ended) return;
    const a = abilityDef(id); if (!a || !a.ready) { if (a && !a.ready) flashToast(a.name + " not ready"); return; }
    abilityMode = (abilityMode === id) ? null : id; // toggle
    clearHighlights();
    if (abilityMode) { sfx("confirm", 0.4); showAbilityTargets(a); } else selectUnit(selected);
    setHUD(abilityMode ? "Pick a target for " + a.name : null);
  }
  function disarmAbility() { if (abilityMode) { abilityMode = null; if (selected) selectUnit(selected); } }
  // Highlight valid targets for the armed ability (enemies / allies / tiles).
  function showAbilityTargets(a) {
    const u = selected; if (!u) return;
    const within = (tx, ty) => (Math.abs(u.x - tx) + Math.abs(u.y - ty)) <= (a.range != null ? a.range : u.range);
    if (a.target === "enemy") {
      sim.aliveEnemies().forEach((e) => { if (within(e.x, e.y) && (a.id === "slash" || sim.hasLineOfSight(u.x, u.y, e.x, e.y))) markTile(e.x, e.y, 0xff5a3c); });
    } else if (a.target === "ally") {
      sim.aliveAllies().forEach((p) => { if (p.id === u.id || within(p.x, p.y)) markTile(p.x, p.y, 0x3ddc84); });
    } else if (a.target === "tile") {
      const R = a.range != null ? a.range : 6;
      for (let yy = u.y - R; yy <= u.y + R; yy++) for (let xx = u.x - R; xx <= u.x + R; xx++) {
        if (!sim.inBounds(xx, yy)) continue;
        if ((Math.abs(u.x - xx) + Math.abs(u.y - yy)) <= R && sim.grid[yy][xx] !== 1) markTile(xx, yy, 0xffae5a, 0.16);
      }
    }
  }
  function markTile(x, y, color, opacity) {
    const w = cell(x, y);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.86, T * 0.86),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity != null ? opacity : 0.34, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(w.x, 0.26, w.z); scene.add(m); highlights.push(m);
  }
  function useAbilityAt(x, y) {
    const u = selected, id = abilityMode; if (!u || !id) return;
    const a = abilityDef(id); if (!a) { disarmAbility(); return; }
    const occ = sim.allUnits().find((v) => v.hp > 0 && v.x === x && v.y === y);
    let opts = null;
    if (a.target === "enemy") { if (occ && occ.side === "enemy") opts = { targetId: occ.id }; }
    else if (a.target === "ally") { if (occ && occ.side === "player") opts = { targetId: occ.id }; }
    else if (a.target === "tile") { opts = { tileX: x, tileY: y }; }
    if (!opts) { flashToast("Invalid target"); return; }
    const r = sim.useAbility(u.id, id, opts);
    if (!r || !r.success) { flashToast(r && r.reason ? r.reason : "Can't do that"); return; }
    abilityMode = null; busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  let toastEl = null;
  function flashToast(txt) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      Object.assign(toastEl.style, { position: "absolute", left: "50%", top: "72px", transform: "translateX(-50%)", zIndex: "60", background: "rgba(20,10,10,.85)", color: "#ffd27a", font: "600 13px 'Segoe UI',monospace", padding: "7px 16px", borderRadius: "6px", border: "1px solid #6a4a2a", pointerEvents: "none", transition: "opacity .3s", opacity: "0" });
      kernel.parent.appendChild(toastEl);
    }
    toastEl.textContent = txt; toastEl.style.opacity = "1";
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => { toastEl.style.opacity = "0"; }, 1400);
  }
  function floatText(pos, txt, color) {
    const spr = makeTextSprite(txt, color);
    spr.position.copy(pos); spr.position.y += 1.2; scene.add(spr);
    kernel.tween({ target: spr.position, to: { y: spr.position.y + 1.6 }, duration: 0.8 });
    kernel.tween({ target: spr.material, to: { opacity: 0 }, duration: 0.8, onComplete: () => scene.remove(spr) });
  }
  function endTurn() {
    if (phase !== "battle" || busy || sim.ended || sim.currentPhase !== "player") return;
    deselect(); busy = true; setHUD("Enemy phase…");
    sim.endTurn();
    drainEvents(() => { busy = false; refreshAllCover(); if (sim.ended) return showEnd(); setHUD(); autoSelectNext(); });
  }
  function drainEvents(done) {
    const q = events.slice(); events = []; let i = 0;
    const next = () => {
      if (i >= q.length) return done && done();
      const e = q[i++]; const d = playEvent(e); setTimeout(next, d);
    };
    next();
  }
  // Field-loot markers (glowing crate + beam + spinning ring) keyed by the sim's
  // marker object so loot_grab / loot_expire can remove the exact one.
  const lootMeshes = new Map();
  function makeLootMarker(L) {
    const w = cell(L.x, L.y), lift = _floorLift(L.x, L.y, L.floor || 0);
    const g = new THREE.Group(); g.position.set(w.x, lift, w.z);
    const crate = _bx(T * 0.34, T * 0.28, T * 0.34, 0xb9892f, 0.5, 0.5);
    crate.position.y = T * 0.2; crate.castShadow = true;
    crate.material.emissive = new THREE.Color(0xffc24a); crate.material.emissiveIntensity = 0.75; g.add(crate);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.12, T * 0.2, T * 3.2, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = T * 1.7; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(T * 0.42, T * 0.52, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; g.add(ring);
    let sp = 0; kernel.onUpdate((dt) => { sp += dt; ring.rotation.z = sp; crate.position.y = T * 0.2 + Math.sin(sp * 2) * 0.05; });
    scene.add(g); return g;
  }
  function playEvent(e) {
    if (e.type === "loot_drop") {
      const L = e.payload.loot, m = makeLootMarker(L); lootMeshes.set(L, m);
      const w = cell(L.x, L.y); floatText({ x: w.x, y: T * 2.0 + _floorLift(L.x, L.y, L.floor || 0), z: w.z }, "◆ LOOT", 0xffd27a); sfx("select", 0.35);
      return 240;
    }
    if (e.type === "loot_grab") {
      const L = e.payload.loot, m = lootMeshes.get(L); if (m) { scene.remove(m); lootMeshes.delete(L); }
      const w = cell(L.x, L.y); floatText({ x: w.x, y: T * 2.0 + _floorLift(L.x, L.y, L.floor || 0), z: w.z }, "ACQUIRED: " + ((L.item && L.item.name) || "GEAR"), 0x6cff9a); sfx("victory", 0.3);
      if (L.item && L.item.id === "night_optics") _updateNVChip();
      return 300;
    }
    if (e.type === "loot_expire") {
      const L = e.payload.loot, m = lootMeshes.get(L); if (m) { scene.remove(m); lootMeshes.delete(L); }
      const w = cell(L.x, L.y); floatText({ x: w.x, y: T * 1.8 + _floorLift(L.x, L.y, L.floor || 0), z: w.z }, "LOOT LOST", 0x8aa0bc);
      return 180;
    }
    if (e.type === "boss_ability") { // PSI SLAM — expanding red shockwave + AoE damage
      const p = e.payload, w = cell(p.x, p.y);
      const ring = new THREE.Mesh(new THREE.RingGeometry(T * 0.2, T * 0.5, 28),
        new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.72, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, 0.3 + _floorLift(p.x, p.y, (p.unit && p.unit.floor) || 0), w.z); scene.add(ring);
      let s = 0, done = false;
      kernel.onUpdate((dt) => { if (done) return; s += dt; const r = 1 + s * ((p.radius || 3) * 2.0); ring.scale.set(r, r, r); ring.material.opacity = Math.max(0, 0.72 - s * 0.85); if (s > 0.85) { done = true; scene.remove(ring); } });
      screenShake(0.6);
      (p.hits || []).forEach((h) => { const u = sim.getUnit(h.id); if (!u) return; const c = cell(u.x, u.y); floatText({ x: c.x, y: T * 1.8, z: c.z }, "-" + h.damage, 0xff5a3c); refreshUnit(u); if (h.killed) killUnit(u); });
      sfx("hit", 0.6);
      return 720;
    }
    if (e.type === "boss_phase") { // ENRAGE at 50% HP — flash the boss red
      const u = e.payload.unit, w = cell(u.x, u.y);
      floatText({ x: w.x, y: T * 2.3, z: w.z }, "◆ ENRAGED ◆", 0xff2a3a);
      const v = unitViews[u.id]; if (v && v.char && v.char.scene) v.char.scene.traverse((o) => { if (o.material && o.material.emissive) { o.material.emissive = new THREE.Color(0xff2a2a); o.material.emissiveIntensity = 0.55; } });
      screenShake(0.7); sfx("hit", 0.5);
      return 640;
    }
    if (e.type === "move") {
      const mu = e.payload.unit, v = unitViews[mu.id], path = e.payload.path || [];
      if (v && path.length) {
        const last = path[path.length - 1], w = cell(last.x, last.y);
        faceToward(mu, last.x, last.y); anim(mu, "walk", { fade: 0.15 });
        const dur = Math.max(0.3, Math.min(1.1, path.length * 0.16));
        const endLift = 0.2 + _floorLift(last.x, last.y, (last.floor != null ? last.floor : (mu.floor || 0)));
        kernel.tween({ target: v.group.position, to: { x: w.x, y: endLift, z: w.z }, duration: dur, onComplete: () => anim(mu, "idle", { fade: 0.2 }) });
        return dur * 1000 + 60;
      }
      return 30;
    }
    if (e.type === "attack") {
      const p = e.payload, au = p.attacker, tu = p.target;
      const a = unitViews[au.id], t = unitViews[tu.id];
      if (a && t) {
        faceToward(au, tu.x, tu.y);
        if (a.clips && a.clips.attack) { anim(au, "attack", { once: true, fade: 0.1 }); setTimeout(() => { if (!a.dead) anim(au, "idle", { fade: 0.2 }); }, 520); }
        else { const gp = a.group.position, ox = gp.x, oz = gp.z, dx = Math.sign(tu.x - au.x) * 0.18, dz = Math.sign(tu.y - au.y) * 0.18; kernel.tween({ target: gp, to: { x: ox - dx, z: oz - dz }, duration: 0.07, onComplete: () => kernel.tween({ target: gp, to: { x: ox, z: oz }, duration: 0.13 }) }); }
        const pa = a.group.position.clone(); pa.y = T * 0.6; const pb = t.group.position.clone(); pb.y = T * 0.6;
        const col = p.reaction ? 0x9fd0ff : p.crit ? 0xff5a3c : p.hit ? 0xffe066 : 0x8aa0bc;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), new THREE.LineBasicMaterial({ color: col, transparent: true }));
        scene.add(line); kernel.tween({ target: line.material, to: { opacity: 0 }, duration: 0.3, onComplete: () => scene.remove(line) });
        sfx("shot", p.reaction ? 0.4 : 0.55);
        muzzleFlash(a.group.position, t.group.position);
        setTimeout(() => sfx(p.hit ? (p.crit || p.killed ? "hit_heavy" : "hit") : "miss", p.hit ? 0.6 : 0.5), 120);
        if (p.reaction) floatText({ x: pa.x, y: pa.y + 0.4, z: pa.z }, "OVERWATCH!", 0x9fd0ff);
        if (p.hit) {
          const big = !!p.crit;
          screenShake(big ? 13 : 6);
          sparkBurst(pb, big ? 0xff7a4a : 0xffd27a, big ? 10 : 6);
          const burst = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.6 : 0.4, 12, 12), new THREE.MeshBasicMaterial({ color: big ? 0xff5a3c : 0xffd27a }));
          burst.position.copy(pb); scene.add(burst);
          kernel.tween({ target: burst.scale, to: { x: big ? 4 : 3, y: big ? 4 : 3, z: big ? 4 : 3 }, duration: 0.3 });
          kernel.tween({ target: burst.material, to: { opacity: 0 }, duration: 0.3, onUpdate: () => { burst.material.transparent = true; }, onComplete: () => scene.remove(burst) });
          floatText(pb, (p.crit ? "CRIT −" : "−") + (p.damage != null ? p.damage : ""), p.crit ? 0xff5a3c : 0xff7a6a);
          if (p.flanked && !p.crit) floatText({ x: pb.x, y: pb.y + 0.5, z: pb.z }, "FLANKED", 0xffae5a);
          refreshUnit(tu);
          if (p.killed) {
            screenShake(15);
            floatText({ x: pb.x, y: pb.y + 0.8, z: pb.z }, "ELIMINATED", 0xffffff);
            if (au.side === "player" && !p.reaction && triggerKillCam(a.group.position, t.group.position)) return 1250;
          } else flinch(tu);
        } else floatText(pb, "MISS", 0xaab4c8);
      }
      return p.crit ? 460 : 340;
    }
    if (e.type === "overwatch") {
      const v = unitViews[e.payload.unit.id];
      if (v) floatText({ x: v.group.position.x, y: T, z: v.group.position.z }, "OVERWATCH", 0x9fd0ff);
      sfx("overwatch", 0.5);
      return 150;
    }
    if (e.type === "hunker") {
      const v = unitViews[e.payload.unit.id];
      if (v) floatText({ x: v.group.position.x, y: T, z: v.group.position.z }, "HUNKERED", 0xffd27a);
      sfx("overwatch", 0.45);
      return 150;
    }
    if (e.type === "mark") {
      const v = unitViews[e.payload.target.id];
      if (v) floatText({ x: v.group.position.x, y: T * 1.4, z: v.group.position.z }, "MARKED!", 0xff5a3c);
      sfx("hit", 0.4);
      return 220;
    }
    if (e.type === "reveal") {
      revealPodView(e.payload.units);
      sfx("overwatch", 0.5); // a sharp "contact" cue
      setHUD();
      return 360;
    }
    if (e.type === "objective") {
      sfx("confirm", 0.7); setHUD();
      const v = unitViews[e.payload.unit];
      if (v) floatText({ x: v.group.position.x, y: T * 1.7, z: v.group.position.z }, "TERMINAL HACKED", 0x5fd0ff);
      return 320;
    }
    if (e.type === "ability") return playAbilityEvent(e.payload);
    if (e.type === "end") { return 100; }
    return 20;
  }
  // VFX per class ability — a distinct, readable signature for each.
  function playAbilityEvent(p) {
    const a = unitViews[p.attacker.id];
    const apos = a ? a.group.position.clone() : cell(p.attacker.x, p.attacker.y);
    if (p.ability === "slash") {
      const t = unitViews[p.target.id];
      faceToward(p.attacker, p.target.x, p.target.y);
      sfx("hit_heavy", 0.6);
      anim(p.attacker, a && a.clips && a.clips.attack ? "attack" : "idle", { once: true, fade: 0.1 });
      if (t) {
        const tp = t.group.position.clone(); tp.y = T * 0.7;
        const arc = new THREE.Mesh(new THREE.TorusGeometry(T * 0.55, 0.06, 6, 16, Math.PI),
          new THREE.MeshBasicMaterial({ color: 0x9fe6ff }));
        arc.position.copy(tp); arc.rotation.x = Math.PI / 2; arc.rotation.z = Math.random() * 6; scene.add(arc);
        kernel.tween({ target: arc.scale, to: { x: 2.4, y: 2.4, z: 2.4 }, duration: 0.3 });
        kernel.tween({ target: arc.material, to: { opacity: 0 }, duration: 0.3, onUpdate: () => { arc.material.transparent = true; }, onComplete: () => scene.remove(arc) });
        floatText(tp, (p.crit ? "CRIT −" : "−") + p.damage, p.crit ? 0xff5a3c : 0x9fe6ff);
        refreshUnit(p.target);
        if (p.killed) {
          floatText({ x: tp.x, y: tp.y + 0.8, z: tp.z }, "ELIMINATED", 0xffffff);
          if (a && triggerKillCam(a.group.position, t.group.position)) return 1300;
        }
      }
      return 480;
    }
    if (p.ability === "headshot") {
      const t = unitViews[p.target.id];
      faceToward(p.attacker, p.target.x, p.target.y);
      sfx("shot", 0.6); setTimeout(() => sfx(p.hit ? "hit_heavy" : "miss", 0.6), 130);
      if (t) {
        const pa = apos.clone(); pa.y = T * 0.65; const pb = t.group.position.clone(); pb.y = T * 0.65;
        const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]),
          new THREE.LineBasicMaterial({ color: p.hit ? 0xffd27a : 0x8aa0bc, transparent: true }));
        scene.add(beam); kernel.tween({ target: beam.material, to: { opacity: 0 }, duration: 0.45, onComplete: () => scene.remove(beam) });
        if (a && t) muzzleFlash(a.group.position, t.group.position);
        if (p.hit) {
          screenShake(p.crit ? 16 : 8);
          sparkBurst(pb, p.crit ? 0xff7a4a : 0xffd27a, p.crit ? 11 : 7);
          const burst = new THREE.Mesh(new THREE.SphereGeometry(p.crit ? 0.7 : 0.5, 12, 12), new THREE.MeshBasicMaterial({ color: p.crit ? 0xff5a3c : 0xffd27a }));
          burst.position.copy(pb); scene.add(burst);
          kernel.tween({ target: burst.scale, to: { x: 4, y: 4, z: 4 }, duration: 0.32 });
          kernel.tween({ target: burst.material, to: { opacity: 0 }, duration: 0.32, onUpdate: () => { burst.material.transparent = true; }, onComplete: () => scene.remove(burst) });
          floatText(pb, (p.crit ? "HEADSHOT −" : "−") + p.damage, p.crit ? 0xff5a3c : 0xffd27a);
          refreshUnit(p.target);
          if (p.killed) {
            screenShake(15);
            floatText({ x: pb.x, y: pb.y + 0.8, z: pb.z }, "ELIMINATED", 0xffffff);
            if (a && triggerKillCam(a.group.position, t.group.position)) return 1300;
          } else flinch(p.target);
        } else floatText(pb, "MISS", 0xaab4c8);
      }
      return 520;
    }
    if (p.ability === "heal") {
      const t = unitViews[p.target.id];
      sfx("heal", 0.6);
      if (t) {
        const tp = t.group.position.clone();
        const ring = new THREE.Mesh(new THREE.RingGeometry(T * 0.2, T * 0.5, 24), new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(tp.x, 0.3, tp.z); scene.add(ring);
        kernel.tween({ target: ring.scale, to: { x: 2.2, y: 2.2, z: 2.2 }, duration: 0.5 });
        kernel.tween({ target: ring.material, to: { opacity: 0 }, duration: 0.5, onComplete: () => scene.remove(ring) });
        floatText({ x: tp.x, y: T * 0.8, z: tp.z }, "+" + p.heal, 0x3ddc84);
        refreshUnit(p.target);
      }
      return 460;
    }
    if (p.ability === "frag") {
      const w = cell(p.tileX, p.tileY);
      sfx("explosion", 0.75); screenShake(17);
      // lobbed grenade -> blast sphere + shockwave ring
      const blast = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 14), new THREE.MeshBasicMaterial({ color: 0xffae5a }));
      blast.position.set(w.x, T * 0.4, w.z); scene.add(blast);
      kernel.tween({ target: blast.scale, to: { x: 6, y: 6, z: 6 }, duration: 0.4 });
      kernel.tween({ target: blast.material, to: { opacity: 0 }, duration: 0.4, onUpdate: () => { blast.material.transparent = true; }, onComplete: () => scene.remove(blast) });
      const ring = new THREE.Mesh(new THREE.RingGeometry(T * 0.3, T * (0.4 + (p.radius || 1)), 28), new THREE.MeshBasicMaterial({ color: 0xff7a3c, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, 0.3, w.z); scene.add(ring);
      kernel.tween({ target: ring.material, to: { opacity: 0 }, duration: 0.5, onComplete: () => scene.remove(ring) });
      (p.shredded || []).forEach((c) => { if (c.from === 1) demolishBuilding(c.x, c.y); else shredCoverVisual(c.x, c.y, c.to); });
      (p.hits || []).forEach((h) => {
        const u = sim.getUnit(h.id); if (!u) return;
        const hp = cell(u.x, u.y); refreshUnit(u);
        floatText({ x: hp.x, y: T * 0.7, z: hp.z }, "−" + h.damage, h.side === "player" ? 0xff9a9a : 0xff7a6a);
        if (h.killed) floatText({ x: hp.x, y: T * 1.2, z: hp.z }, "ELIMINATED", 0xffffff);
      });
      refreshAllCover();
      return 560;
    }
    if (p.ability === "suppress") {
      const t = unitViews[p.target.id];
      faceToward(p.attacker, p.target.x, p.target.y);
      sfx("shot", 0.35); setTimeout(() => sfx("shot", 0.3), 110); setTimeout(() => sfx("shot", 0.28), 220);
      if (t) {
        const pa = apos.clone(); pa.y = T * 0.6; const pb = t.group.position.clone(); pb.y = T * 0.6;
        for (let i = 0; i < 4; i++) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), new THREE.LineBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.7 }));
          scene.add(line); kernel.tween({ target: line.material, to: { opacity: 0 }, duration: 0.25 + i * 0.08, onComplete: () => scene.remove(line) });
        }
        floatText({ x: pb.x, y: T * 0.9, z: pb.z }, "SUPPRESSED", 0xffc04a);
      }
      return 420;
    }
    return 200;
  }

  // ── Pointer ─────────────────────────────────────────────────────────────────
  const dom = kernel.renderer.domElement; dom.style.touchAction = "none";
  let down = null;
  dom.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; });
  dom.addEventListener("pointerup", (ev) => {
    if (!down) return; const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y); const left = down.b === 0; down = null;
    if (!left || moved > 6) return; // right/drag = camera
    if (!groundPlane) return;
    const hit = kernel.raycast(ev.clientX, ev.clientY, [groundPlane]);
    if (!hit.length) return;
    const tile = tileAt(hit[0].point.x, hit[0].point.z);
    if (tile) onTileClick(tile.x, tile.y);
  });
  // Hover hit-preview: standing over an enemy with a soldier selected shows the
  // shot odds + FLANKED, the XCOM targeting read.
  let hoverTip = null;
  dom.addEventListener("pointermove", (ev) => {
    if (phase !== "battle" || busy || sim.ended || sim.currentPhase !== "player" || !selected) { if (hoverTip) { scene.remove(hoverTip); hoverTip = null; } return; }
    if (!groundPlane) return;
    const hit = kernel.raycast(ev.clientX, ev.clientY, [groundPlane]);
    if (hoverTip) { scene.remove(hoverTip); hoverTip = null; }
    if (!hit.length) return;
    const tile = tileAt(hit[0].point.x, hit[0].point.z); if (!tile) return;
    const { x, y } = tile;
    const occ = sim.allUnits().find((u) => u.hp > 0 && u.x === x && u.y === y && u.side === "enemy");
    if (!occ) return;
    const bd = sim.hitBreakdown(selected, occ); const los = sim.hasLineOfSight(selected.x, selected.y, occ.x, occ.y);
    // full XCOM targeting read: hit% + WHY (flank / cover level / exposed) + crit flag
    const mod = bd.flanked ? " ⚑FLANK" : bd.cover === 2 ? " ▮FULL COVER" : bd.cover === 1 ? " ▯HALF COVER" : " ◦EXPOSED";
    const crit = bd.critChance >= 0.5 ? "  ✱CRIT" : "";
    const hunk = bd.hunkered ? " ⛊HUNKERED" : "";
    const label = !los ? "NO LOS" : !bd.inRange ? "OUT OF RANGE" : (Math.round(bd.chance * 100) + "%" + mod + hunk + crit);
    const col = !los || !bd.inRange ? 0xff8888 : bd.flanked ? 0xffae5a : bd.chance >= 0.7 ? 0x88ff88 : 0xffe066;
    hoverTip = makeTextSprite(label, col); const w = cell(x, y); hoverTip.position.set(w.x, T * 1.9, w.z);
    hoverTip.scale.set(Math.max(3.4, label.length * 0.42), 0.85, 1); scene.add(hoverTip);
  });
  window.addEventListener("keydown", (e) => {
    const _kk = (e.key || "").toLowerCase();
    if (_kk === "v") { e.preventDefault(); toggleNightVision(); return; } // NV works any time
    if (_kk === "tab") { e.preventDefault(); toggleMinimap(); return; }    // tactical map
    if (phase !== "battle" || sim.ended) return;
    const k = (e.key || "").toLowerCase();
    if (k === "y") { e.preventDefault(); overwatchSelected(); }
    else if (k === "h") { e.preventDefault(); hunkerSelected(); }
    else if (k === "escape") {
      if (abilityMode) { e.stopImmediatePropagation(); e.preventDefault(); disarmAbility(); setHUD(); }
      else if (selected) { e.stopImmediatePropagation(); e.preventDefault(); deselect(); }
    } else if (selected && /^[1-5]$/.test(k)) { // ability hotkeys
      const a = (sim.abilitiesFor(selected.id) || []).find((x) => x.key === k);
      if (a) { e.preventDefault(); armAbility(a.id); }
    }
  });

  // ── Boot ────────────────────────────────────────────────────────────────────
  buildSim(); await buildBoard(); buildObjective();
  // FINALE BOSS: on the last mission, the toughest enemy becomes an oversized
  // command unit — a real bullet-sponge fight to cap the campaign (XCOM Avatar).
  if (missionIndex === missions.length - 1) {
    const foes = sim.aliveEnemies();
    if (foes.length) {
      const bz = foes.reduce((m, e) => (e.hp > m.hp ? e : m), foes[0]);
      bz.boss = true; bz.name = "Avatar Sentinel"; bz.maxHp = Math.round(bz.maxHp * 2.4); bz.hp = bz.maxHp;
      bz.atk = Math.round(bz.atk * 1.3); bz.def = (bz.def || 0) + 3;
    }
  }
  for (const u of sim.allUnits()) await makeUnit(u); // load + instance the animated models
  sim.allUnits().forEach(refreshUnit);

  // BOSS HEALTH BAR (top-centre HUD) — reveals when the Avatar boss is spotted,
  // tracks its HP, hides on death. Only exists on a mission that has a boss.
  let _bossUnit = sim.allUnits().find((u) => u.boss) || null, _bossBar = null, _bossFill = null;
  if (_bossUnit) {
    try {
      _bossBar = document.createElement("div");
      Object.assign(_bossBar.style, { position: "absolute", top: "56px", left: "50%", transform: "translateX(-50%)", zIndex: "45", width: "min(440px,70%)", display: "none", fontFamily: "'Segoe UI',monospace", textAlign: "center" });
      const label = document.createElement("div");
      Object.assign(label.style, { font: "800 13px 'Segoe UI'", letterSpacing: "2px", color: "#ff5a5a", textShadow: "0 1px 5px #000", marginBottom: "4px" });
      label.textContent = "◆ " + (_bossUnit.name || "BOSS").toUpperCase() + " ◆";
      const track = document.createElement("div");
      Object.assign(track.style, { height: "13px", background: "rgba(8,10,16,0.85)", border: "1px solid #ff5a5a", borderRadius: "7px", overflow: "hidden", boxShadow: "0 0 18px rgba(255,60,60,0.4)" });
      _bossFill = document.createElement("div");
      Object.assign(_bossFill.style, { height: "100%", width: "100%", background: "linear-gradient(90deg,#ff2a3a,#ff7a4a)", transition: "width 0.25s ease" });
      track.appendChild(_bossFill); _bossBar.appendChild(label); _bossBar.appendChild(track);
      kernel.parent.appendChild(_bossBar);
      let _bacc = 0;
      kernel.onUpdate((dt) => {
        _bacc += dt; if (_bacc < 0.2) return; _bacc = 0;
        if (!_bossUnit) return;
        const show = sim.podRevealed(_bossUnit.pod) && _bossUnit.hp > 0 && phase === "battle";
        _bossBar.style.display = show ? "block" : "none";
        if (show) _bossFill.style.width = Math.max(0, (_bossUnit.hp / _bossUnit.maxHp) * 100) + "%";
      });
    } catch (e) {}
  }

  let shell = null, endShown = false;
  function beginBattle() { phase = "battle"; orbit.autoRotate = false; setHUD(); autoSelectNext(); try { _updateNVChip(); } catch (e) {} try { tacticalMusic.start(); } catch (e) {} }
  // ── STORY: mission BRIEFING card (XCOM-style) ───────────────────────────────
  // Shown between the title and the battle on a real PLAY (not __test, so gates
  // stay unblocked). Premise on the first op, per-mission flavor + the live
  // objective, doom-clock, and squad-vs-hostiles read, then BEGIN MISSION.
  const BRIEFINGS = [
    "ADVENT patrols flood the downtown grid. Slip in, hit hard, and vanish before reinforcements lock the sector.",
    "The market district has gone dark. Resistance cells report an alien advance party staging in the plaza.",
    "Rail-yard intel points to a weapons cache. Secure it before the garrison moves the shipment.",
    "The substation feeds half the city's surveillance net. Reach the relay and pull the plug.",
    "Old Town's holdouts are pinned. Punch a corridor through the occupation and relieve them.",
    "The extraction window is narrow. Fight to the LZ and get every soldier aboard the Skyranger.",
    "The Avatar spire looms over the skyline. End the Project — whatever it costs.",
  ];
  const PREMISE = "Earth is occupied. ADVENT rules the cities; the aliens rule ADVENT. You command what's left of XCOM. Take the streets back — one operation at a time.";
  function showBriefing(onContinue) {
    let card;
    try {
      const wrap = document.createElement("div");
      Object.assign(wrap.style, { position: "absolute", inset: "0", zIndex: "80", display: "flex", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(120% 120% at 50% 30%, rgba(8,16,28,0.72), rgba(2,5,10,0.92))", fontFamily: "'Segoe UI',system-ui,monospace" });
      card = document.createElement("div");
      Object.assign(card.style, { width: "min(560px,86%)", padding: "26px 28px", borderRadius: "14px", color: "#dfe9f5",
        background: "linear-gradient(180deg,rgba(16,24,38,0.96),rgba(10,16,26,0.96))", border: "1px solid #34d6e8", boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 0 60px rgba(52,214,232,0.06)" });
      const opNo = missionIndex + 1, opTot = missions.length;
      const doom = campaignRun ? `<span style="color:#ff8a5a">DOOM ${campaign.state.doom}/${campaign.state.doomMax}</span> · ` : "";
      card.innerHTML =
        `<div style="font:600 12px 'Segoe UI';letter-spacing:3px;color:#34d6e8">OPERATION ${opNo} / ${opTot}</div>` +
        `<div style="font:800 26px 'Segoe UI';margin:4px 0 2px">${(mission.name || content.title || "Operation").toUpperCase()}</div>` +
        `<div style="font-size:12px;color:#8ea6c4;margin-bottom:14px">${doom}${sim.aliveAllies().length} OPERATIVES · ${sim.aliveEnemies().length} HOSTILES</div>` +
        (missionIndex === 0 ? `<div style="font-size:13px;line-height:1.5;color:#9fb6d8;margin-bottom:10px">${PREMISE}</div>` : "") +
        `<div style="font-size:14px;line-height:1.55;margin-bottom:14px">${BRIEFINGS[missionIndex % BRIEFINGS.length]}</div>` +
        `<div style="font-size:12px;color:#34d6e8;letter-spacing:1px;margin-bottom:18px">▸ OBJECTIVE: ${(mission.objective || "Eliminate all hostile contacts").toUpperCase()}</div>`;
      const btn = document.createElement("button");
      Object.assign(btn.style, { font: "700 14px 'Segoe UI'", color: "#04222a", background: "#34d6e8", border: "0", borderRadius: "9px", padding: "11px 22px", cursor: "pointer", letterSpacing: "1px" });
      btn.textContent = "BEGIN MISSION ▸";
      btn.onclick = () => { try { kernel.parent.removeChild(wrap); } catch (e) {} onContinue(); };
      card.appendChild(btn); wrap.appendChild(card); kernel.parent.appendChild(wrap);
    } catch (e) { onContinue(); }
  }
  function showEnd() {
    if (endShown) return; endShown = true;
    try { tacticalMusic.stop(); } catch (e) {} // battle's over — fade the score (no music over the result screen)
    const win = !!sim.victory; // objective-aware (evac/hack wins keep allies alive)
    sfx(win ? "victory" : "defeat", 0.6);
    window.__FFG_RESULT__ = { victory: win, turns: sim.turnNumber };
    // Campaign run: record permadeath/XP/doom, then show the Barracks debrief
    // (which deploys the next op or ends the campaign). Otherwise a one-off result.
    if (campaignRun) {
      try { if (sim.salvage && sim.salvage.length) campaign.addSalvage(sim.salvage); } catch (e) {} // recovered field loot → permanent gear/resources
      campaign.recordMissionResult(sim.player_units, win);
      campaign.renderBarracks(kernel.parent, {});
      return;
    }
    if (shell) shell.end(win, win ? "Mission complete · " + sim.turnNumber + " turns" : "Squad eliminated");
  }
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      parent: kernel.parent, title: content.title || "Operation",
      tagline: content.tagline || "Lead the squad. Take the map.",
      music: null, // Void Skirmish uses the procedural createTacticalMusic loop, NOT a file track (unique audio, no double-play)
      menuImage: (content.assets && content.assets.menu_image) || null,
      // XCOM difficulty: scales enemy HP + aim (Rookie easiest, Commander hardest).
      difficulties: ["Rookie", "Veteran", "Commander"], defaultDifficulty: "Veteran",
      howTo: [
        { h: "GOAL", p: (mission.objective || "Eliminate all hostiles") + "." },
        { h: "ORDERS", p: "Click a soldier to select, click a glowing tile to move, click an enemy in range to fire. Hold <b>OVERWATCH (Y)</b> to fire on movers, or <b>HUNKER (H)</b> to brace behind cover. Each soldier has action points (AP)." },
        { h: "ABILITIES", p: "Every class has a signature skill on the bottom bar (hotkeys 1–5): Slash, Headshot, Field Medic, Frag Grenade, Suppression. Click to arm, then pick a target." },
        { h: "COVER", p: "Stand beside cover (crates/walls) to cut the enemy's hit chance. Move carefully — open ground is deadly. Frag grenades shred cover." },
        { h: "CAMERA", p: "<b>Right-drag</b> rotate, <b>WASD</b> move, scroll zoom. <b>Esc</b> pauses." },
      ],
      onPlay: (d) => { // difficulty scales enemy hp/aim (in place, from base), persist, then briefing -> fight
        difficulty = String(d || "veteran").toLowerCase(); if (!DIFF[difficulty]) difficulty = "veteran";
        try { window.localStorage.setItem("ffg_void_difficulty", difficulty); } catch (e) {}
        applyDifficulty(); showBriefing(beginBattle);
      },
      onPause: () => { kernel.stop(); try { tacticalMusic.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { tacticalMusic.start(); } catch (e) {} },
    });
    // After a Barracks "Deploy", we reload straight into the next op — skip the
    // title menu and drop the player into the fight.
    let autostart = false;
    try { const k = "ffg_autostart_" + (content.slug || "tactics"); autostart = window.sessionStorage.getItem(k) === "1"; if (autostart) window.sessionStorage.removeItem(k); } catch (e) {}
    if (autostart) { shell.hide(); shell.phase = "playing"; if (shell._playMusic) shell._playMusic(); beginBattle(); }
    else shell.start();
  } else { beginBattle(); }

  const controller = {
    sim,
    __test: {
      start: () => { if (shell) { shell.hide(); shell.phase = "playing"; } beginBattle(); },
      state: () => ({ phase, turn: sim.turnNumber, ended: sim.ended, allies: sim.aliveAllies().length, enemies: sim.aliveEnemies().length, sceneChildren: scene.children.length }),
      select: (id) => { selectUnit(sim.getUnit(id)); return !!sim.getUnit(id); },
      move: (id, x, y, floor) => { selectUnit(sim.getUnit(id)); return !!sim.moveUnit(id, x, y, floor); },
      attack: (aid, tid) => sim.attackUnit(aid, tid),
      // animated path (drives drainEvents -> playEvent -> kill-cam) for verification
      attackAnimated: (aid, tid) => { selectUnit(sim.getUnit(aid)); tryAttack(sim.getUnit(tid)); },
      killCamActive: () => !!kc,
      ability: (uid, abId, opts) => sim.useAbility(uid, abId, opts),
      // animated ability path (drives playAbilityEvent -> demolish/shred VFX)
      abilityAnimated: (uid, abId, opts) => { selectUnit(sim.getUnit(uid)); abilityMode = abId; useAbilityAt((opts && opts.tileX), (opts && opts.tileY)); },
      abilitiesFor: (uid) => sim.abilitiesFor(uid),
      overwatch: (id) => { if (id) selectUnit(sim.getUnit(id)); overwatchSelected(); },
      hunker: (id) => { if (id) selectUnit(sim.getUnit(id)); hunkerSelected(); },
      mark: (aid, tid) => sim.markUnit(aid, tid),
      endTurn: () => endTurn(),
      debrief: () => showEnd(), // force the end/barracks screen (test affordance)
      campaign: () => campaign ? { active: campaign.isActive(), mission: campaign.currentMission(), doom: campaign.state.doom, doomMax: campaign.state.doomMax, supplies: campaign.state.supplies, roster: campaign.state.roster.map((s) => s && { cls: s.cls, rank: s.rank, xp: s.xp, kills: s.kills }) } : null,
      autoResolve: (maxTurns) => {
        let n = 0;
        while (!sim.ended && n++ < (maxTurns || 40)) {
          if (sim.currentPhase !== "player") { sim.endTurn(); continue; }
          const allies = sim.aliveAllies();
          for (const ai of allies) {
            const u = sim.getUnit(ai.id); let guard = 0;
            while (u.actionPoints > 0 && guard++ < 4 && !sim.ended) {
              const es = sim.aliveEnemies(); if (!es.length) break;
              es.sort((p, q) => (Math.abs(p.x - u.x) + Math.abs(p.y - u.y)) - (Math.abs(q.x - u.x) + Math.abs(q.y - u.y)));
              const e = es[0], d = Math.abs(e.x - u.x) + Math.abs(e.y - u.y);
              if (d <= u.range && sim.hasLineOfSight(u.x, u.y, e.x, e.y)) { sim.attackUnit(u.id, e.id); }
              else { const p = sim.findPath(u.x, u.y, e.x, e.y); if (!p || !p.length) break; const s = Math.min(p.length, u.movement); let dst = p[s - 1]; if (dst.x === e.x && dst.y === e.y) { if (s < 2) break; dst = p[s - 2]; } if (!sim.moveUnit(u.id, dst.x, dst.y)) break; }
            }
          }
          sim.endTurn();
        }
        sim.allUnits().forEach(refreshUnit);
        if (sim.ended) showEnd();
        return { ended: sim.ended, victory: sim.aliveAllies().length > 0, turns: sim.turnNumber };
      },
    },
  };
  return controller;
});

function makeTextSprite(text, colorHex) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "bold 44px 'Segoe UI',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#000"; ctx.fillText(text, 130, 36);
  ctx.fillStyle = "#" + (colorHex || 0xffffff).toString(16).padStart(6, "0"); ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(2.6, 0.65, 1);
  return spr;
}

// XCOM-style cover shield: a crisp white shield, full (solid) or half (split).
const _shieldTexCache = {};
function shieldTex(full) {
  const key = full ? "full" : "half";
  if (_shieldTexCache[key]) return _shieldTexCache[key];
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  function shieldPath() { ctx.beginPath(); ctx.moveTo(32, 6); ctx.lineTo(56, 16); ctx.lineTo(56, 34); ctx.quadraticCurveTo(56, 52, 32, 60); ctx.quadraticCurveTo(8, 52, 8, 34); ctx.lineTo(8, 16); ctx.closePath(); }
  // glow backing
  ctx.shadowColor = full ? "#bfe9ff" : "#ffd27a"; ctx.shadowBlur = 10;
  shieldPath(); ctx.fillStyle = full ? "#dff4ff" : "#3a2c14"; ctx.fill();
  ctx.shadowBlur = 0;
  if (!full) { ctx.save(); shieldPath(); ctx.clip(); ctx.fillStyle = "#ffcf6a"; ctx.fillRect(0, 34, 64, 30); ctx.restore(); }
  shieldPath(); ctx.lineWidth = 4; ctx.strokeStyle = full ? "#7fd6ff" : "#ffb454"; ctx.stroke();
  const tex = new THREE.CanvasTexture(c); _shieldTexCache[key] = tex; return tex;
}
function makeShieldSprite() {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: shieldTex(true), transparent: true, depthTest: false }));
  spr.scale.set(0.9, 0.9, 1);
  return spr;
}
