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
export const MAPS = {
  isla_viva: { name: "Isla Viva", theme: "tropical", sky: "#7fd4f0", fog: 0.00042, themeColor: "#22d3a0", water: true },
  ashgrid:   { name: "Savanna", theme: "savanna", sky: "#e7cf98", fog: 0.00045, themeColor: "#e0854a", water: false },
  deepwood:  { name: "Deepwood", theme: "forest", sky: "#9fc7e8", fog: 0.00052, themeColor: "#7fb069", water: true },
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
function waterNormalTex(aniso) {
  if (_texCache.waterN) return _texCache.waterN;
  const t = _fieldTex("water_f", 256,
    (u, v) => _tfbm(u * 6, v * 6, 31, 3) * 0.6 + (Math.sin(u * 22 + v * 15) * 0.5 + 0.5) * 0.4,
    (h) => h, aniso, 1.4).normal;
  _texCache.waterN = t; return t;
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
export async function buildMap(W, mapId) {
  const K = MAPS[mapId] || MAPS.isla_viva;
  const seed = W.seed;
  const rng = W.SIM.mulberry32(seed ^ 0xabcdef);
  const heightAt0 = mkHeightFn(mapId, seed);
  const waterY = K.water ? 0 : -999;

  const g = W.group("map");
  g.clear();
  // remove the PREVIOUS map's per-frame updaters (cloud/bird/water drift) before
  // rebuilding — g.clear() drops the sprites but the kernel keeps the closures,
  // which then run every frame over detached arrays and retain them (leak/CPU
  // that compounds each match). trackUpdater registers + records for next cleanup.
  if (W._mapUpdaters && W.kernel._updaters) {
    for (const fn of W._mapUpdaters) { const idx = W.kernel._updaters.indexOf(fn); if (idx >= 0) W.kernel._updaters.splice(idx, 1); }
  }
  W._mapUpdaters = [];
  const trackUpdater = (fn) => { W._mapUpdaters.push(fn); W.kernel.onUpdate(fn); };
  W.scene.background = new THREE.Color(K.sky);
  if (W.scene.fog) { W.scene.fog.color = new THREE.Color(K.sky); W.scene.fog.density = K.fog; }
  // BRIGHT daytime match lighting. The render looked dim/muddy vs the bright, vibrant
  // Final Drop reference — a bright blue sky over dark green ground. Strong warm sun +
  // a much brighter, lighter-ground hemisphere fill so shadowed sides read as daylight
  // (not dusk), plus a touch more exposure. Also overrides any leaked menu light (D1).
  if (W._lightDefaults) {
    const kn = W.kernel;
    // ACES Filmic tonemapping was crushing + desaturating the whole scene into a
    // muddy dusk. NoToneMapping keeps colours bright + saturated like the reference.
    kn.renderer.toneMapping = THREE.NoToneMapping;
    kn.renderer.toneMappingExposure = 1.0;
    kn.sun.intensity = 2.05; kn.sun.color.setHex(0xfff4e0);
    kn.sun.position.set(90, 130, 60);
    let hemi = null; W.scene.traverse((o) => { if (o.isHemisphereLight) hemi = o; });
    if (hemi) { hemi.intensity = 1.25; hemi.color.setHex(0xdcefff); hemi.groundColor.setHex(0x7c8672); }
    if (kn.bloom) kn.bloom.strength = 0.14;   // crisp match — minimal bloom haze
  }

  // ── terrain mesh (vertex-colored biome tint × tiled grain texture) ────────
  const aniso = W._texAniso || 4;
  const SEG = 220;
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

  // ── water ─────────────────────────────────────────────────────────────────
  if (K.water) {
    const wgeo = new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshStandardMaterial({
      color: mapId === "isla_viva" ? 0x2ec9d6 : 0x2f7d8a, transparent: true, opacity: 0.86, roughness: 0.13, metalness: 0.3,
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
    trackUpdater((dt, t) => {
      water.position.y = waterY + Math.sin(t * 0.7) * 0.12;
      if (wN) { wN.offset.x = t * 0.015; wN.offset.y = t * 0.011; }   // drifting ripples
    });
  }

  // ── SKY: gradient dome + drifting clouds + looping birds ──────────────────
  // (owner: "we should have a real sky, with real clouds, and birds")
  {
    const horizon = new THREE.Color(K.sky);
    const zenith = horizon.clone().lerp(new THREE.Color(0x2f74c8), 0.55).multiplyScalar(0.9);
    const skyGeo = new THREE.SphereGeometry(SIZE * 0.82, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: zenith }, bot: { value: horizon } },
      vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying vec3 vp; uniform vec3 top; uniform vec3 bot; void main(){ float h = clamp(normalize(vp).y, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, pow(h, 0.62)), 1.0); }",
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
    const cloudTex = new THREE.CanvasTexture(ccv);
    const clouds = [];
    for (let i = 0; i < 24; i++) {
      const grp = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
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
    const birdTex = new THREE.CanvasTexture(bcv);
    const flocks = [];
    for (let f = 0; f < 3; f++) {
      const flock = new THREE.Group();
      const n = 5 + Math.floor(rng() * 5);
      for (let b = 0; b < n; b++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: birdTex, transparent: true, depthWrite: false, fog: false }));
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

  // ── structures: batched boxes + colliders ─────────────────────────────────
  const colliders = [];             // {kind:'box'|'ramp', minX..maxZ, dir?, top}
  const batches = {};               // colorHex -> geometry list
  function addBox(cx, cy, cz, w, h, d, color, opts) {
    opts = opts || {};
    const geo = new THREE.BoxGeometry(w, h, d);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, cy, cz);
    (batches[color] = batches[color] || []).push(geo);
    if (opts.collide !== false) {
      // AABB of the (possibly rotated) box — conservative
      const hw = opts.rotY ? (Math.abs(Math.cos(opts.rotY)) * w + Math.abs(Math.sin(opts.rotY)) * d) / 2 : w / 2;
      const hd = opts.rotY ? (Math.abs(Math.sin(opts.rotY)) * w + Math.abs(Math.cos(opts.rotY)) * d) / 2 : d / 2;
      colliders.push({ kind: "box", minX: cx - hw, maxX: cx + hw, minY: cy - h / 2, maxY: cy + h / 2, minZ: cz - hd, maxZ: cz + hd });
    }
  }
  function addRamp(cx, cy, cz, w, h, d, dir, color) {
    // w = width across, d = run length along the travel axis, h = climb.
    // The rendered slab MUST rise the same way supportAt's math does
    // (dir 0=+X, 1=−X, 2=+Z, 3=−Z) — the old version rendered dir 2/3
    // inverted and dir 0/1 flat, so players "walked inside walls" while the
    // (correct) collider carried them.
    const geo = new THREE.BoxGeometry(w, 0.3, Math.sqrt(d * d + h * h));
    geo.rotateX(-Math.atan2(h, d));              // +Z end rises
    if (dir === 0) geo.rotateY(Math.PI / 2);     // up-end → +X
    else if (dir === 1) geo.rotateY(-Math.PI / 2); // up-end → −X
    else if (dir === 3) geo.rotateY(Math.PI);    // up-end → −Z
    geo.translate(cx, cy + h / 2, cz);
    (batches[color] = batches[color] || []).push(geo);
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
  function loot(x, y, z, poi) { lootPoints.push({ x, y, z, kind: "floor", poi }); }
  function chest(x, y, z, poi) { chestPoints.push({ x, y, z, kind: "chest", poi }); }

  // — building generators (shared) —
  function hut(x, z, w, d, rot, color, poi) {
    const y = heightAt0(x, z);
    const H = 3.2, T = 0.35;
    // 4 walls with a door gap on the front
    addBox(x, y + H / 2, z - d / 2, w, H, T, color, { rotY: rot });          // back
    addBox(x - w / 2, y + H / 2, z, T, H, d, color, { rotY: rot });          // left
    addBox(x + w / 2, y + H / 2, z, T, H, d, color, { rotY: rot });          // right
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
        const hz0 = pdir === 2 ? z + 0.2 : z - rrun * 0.55;
        const hz1 = pdir === 2 ? z + rrun * 0.55 : z - 0.2;
        addSlabHole(x, fy + 0.15, z, fw, 0.3, shade(color, 0.8), rx - 1.6, rx + 1.6, hz0, hz1);
      }
      // 4 walls with window band gap + door gap on ground
      const wallH = FH - (f > 0 ? 1.2 : 0);  // upper floors leave open window band
      const wy = fy + wallH / 2 + (f > 0 ? 0 : 0);
      if (f === 0) {
        const dw = 1.8;
        addBox(x - W2 / 2 - dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color);
        addBox(x + W2 / 2 + dw / 4, fy + FH / 2, z + W2, W2 - dw / 2, FH, T, color);
        addBox(x, fy + FH - 0.5, z + W2, dw, 1, T, color);
        addBox(x, fy + FH / 2, z - W2, fw, FH, T, color);
        addBox(x - W2, fy + FH / 2, z, T, FH, fw, color);
        addBox(x + W2, fy + FH / 2, z, T, FH, fw, color);
      } else {
        addBox(x, wy, z + W2, fw, wallH, T, color);
        addBox(x, wy, z - W2, fw, wallH, T, color);
        addBox(x - W2, wy, z, T, wallH, fw, color);
        addBox(x + W2, wy, z, T, wallH, fw, color);
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
    for (const [dx, dz, w, d] of [[0, -(P + 1.2) / 2, P + 1.4, 0.3], [0, (P + 1.2) / 2, P + 1.4, 0.3], [-(P + 1.2) / 2, 0, 0.3, P + 1.4], [(P + 1.2) / 2, 0, 0.3, P + 1.4]])
      addBox(x + dx, y + H + 0.9, z + dz, w, 1.2, d, color);
    addBox(x, y + H + 2.6, z, P + 2, 0.25, P + 2, shade(color, 0.7), { collide: false }); // little roof
    addRamp(x, y, z + P + 3.4, 2.0, H + 0.3, 6.4, 3, shade(color, 0.8));      // access ramp
    chest(x, y + H + 0.6, z, poi);
  }

  function pier(x, z, len, rot, color, poi) {
    const y = waterY + 0.5;
    addBox(x, y, z, 3, 0.3, len, color, { rotY: rot });
    loot(x, y + 0.6, z, poi);
    if (rng() < 0.6) chest(x, y + 0.6, z + len * 0.35, poi);
  }

  // ── per-map POIs + props plan (props = pure scenery + cover collision) ────
  const pois = [];
  const props = { palm: [], tree: [], pine: [], birch: [], bush: [], rocks: [], car: [], container: [], barrel: [] };
  function scatterTrees(kind, n, minH, maxH) {
    for (let i = 0; i < n; i++) {
      const x = (rng() * 2 - 1) * (HALF - 40), z = (rng() * 2 - 1) * (HALF - 40);
      const h = heightAt0(x, z);
      if (h < minH || h > maxH) continue;
      if (nearPoi(x, z, 26)) continue;
      const s = 0.8 + rng() * 0.9;
      props[kind].push({ x, y: h, z, s, ry: rng() * Math.PI * 2 });
    }
  }
  function nearPoi(x, z, pad) {
    for (const p of pois) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + pad) return true; }
    return false;
  }
  function poi(id, name, x, z, r) { pois.push({ id, name, x, z, r }); }

  // ── roads + towns (Final-Drop density) ────────────────────────────────────
  // Roads are COSMETIC flat ribbons laid on the terrain (no collider — you walk
  // over them). Towns place houses in lots along a street with front doors to the
  // road + a coloured roof, replacing the old "identical huts at random offsets".
  const roadGeos = [];                                  // merged into one asphalt mesh after structures
  function road(x0, z0, x1, z1, width) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 1) return;
    const steps = Math.max(1, Math.ceil(len / 9));
    const ang = Math.atan2(dx, dz);                     // rotate the run (local +Z) onto the segment dir
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps, mx = x0 + dx * t, mz = z0 + dz * t;
      const geo = new THREE.BoxGeometry(width, 0.14, len / steps + 0.5);
      geo.rotateY(ang); geo.translate(mx, heightAt0(mx, mz) + 0.07, mz);
      roadGeos.push(geo);
    }
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
    const geo = new THREE.BoxGeometry(w, 0.12, d); geo.translate(cx, heightAt0(cx, cz) + 0.07, cz); roadGeos.push(geo);
    for (let i = 0; i < 4; i++) {
      const px = cx - w / 2 + 3 + (i % 2) * (w - 6), pz = cz - d / 2 + 3 + Math.floor(i / 2) * (d - 6);
      props.car.push({ x: px, y: heightAt0(px, pz), z: pz, s: 2.1, ry: 0 });
    }
  }
  // a house: textured walls + a distinct COLOURED roof (reads as a town from the air)
  function house(x, z, w, d, rot, wallC, roofC, poiId) {
    const y = heightAt0(x, z), H = 3.4, T = 0.32, doorW = 1.4;
    addBox(x, y + H / 2, z - d / 2, w, H, T, wallC, { rotY: rot });                 // back
    addBox(x - w / 2, y + H / 2, z, T, H, d, wallC, { rotY: rot });                 // left
    addBox(x + w / 2, y + H / 2, z, T, H, d, wallC, { rotY: rot });                 // right
    addBox(x - w / 4 - doorW / 4, y + H / 2, z + d / 2, w / 2 - doorW / 2, H, T, wallC, { rotY: rot });  // front L of door
    addBox(x + w / 4 + doorW / 4, y + H / 2, z + d / 2, w / 2 - doorW / 2, H, T, wallC, { rotY: rot });  // front R of door
    addBox(x, y + H - 0.35, z + d / 2, doorW, 0.7, T, wallC, { rotY: rot });        // door lintel
    addBox(x, y + H + 0.35, z, w + 0.7, 0.3, d + 0.7, roofC, { rotY: rot });        // roof deck (overhangs)
    addBox(x, y + H + 0.85, z, w * 0.5, 0.7, d + 0.5, shade(roofC, 0.88), { rotY: rot }); // ridge cap
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
    const span = R * 1.5, step = span / nPer;
    for (const side of [-1, 1]) {
      for (let i = 0; i < nPer; i++) {
        const a0 = -span / 2 + (i + 0.5) * step + (rng() - 0.5) * 3, set = side * (11.5 + rng() * 2);
        const hx = A ? p.x + a0 : p.x + set, hz = A ? p.z + set : p.z + a0;
        if (heightAt0(hx, hz) < minH) continue;
        const rot = A ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);   // door faces the street
        house(hx, hz, 6 + rng() * 2, 5 + rng() * 1.5, rot, wallCs[i % wallCs.length], roofC, p.id);
      }
    }
    parkingLot(A ? p.x + R * 0.78 : p.x, A ? p.z : p.z + R * 0.78, 15, 13, p);
    streetFurniture(p.x, p.z, A, span, minH);
    for (let i = 0; i < 2; i++) chest(p.x + (rng() - 0.5) * R * 0.6, heightAt0(p.x, p.z) + 0.6, p.z + (rng() - 0.5) * R * 0.6, p.id);
  }
  // ── hero landmarks (one distinctive silhouette per biome, like Final Drop's
  //    lighthouse / domes) — procedural, textured via the batch, with a base chest.
  function lighthouse(x, z, poi) {
    const y = heightAt0(x, z), H = 22, seg = 6, sh = H / seg;
    for (let i = 0; i < seg; i++) { const w = 6.2 - i * 0.7; addBox(x, y + i * sh + sh / 2, z, w, sh + 0.12, w, i % 2 ? "#dcdcdc" : "#c23b3b"); }  // red/white bands
    addBox(x, y + H + 1.2, z, 4, 2.4, 4, "#2a3138");                    // light room
    addBox(x, y + H + 1.2, z, 3, 1.3, 3, "#fff2b0");                    // the light
    addBox(x, y + H + 2.7, z, 5, 0.6, 5, shade("#2a3138", 0.8));        // cap
    chest(x + 4, y + 0.6, z, poi); loot(x - 4, y + 0.5, z, poi);
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
  function steeple(x, z, poi) {
    const y = heightAt0(x, z);
    addBox(x, y + 4, z, 8, 8, 11, "#8f8a80");                          // church body
    addBox(x, y + 8.6, z, 8.6, 1, 11.6, "#7a4a2a");                    // roof
    addBox(x, y + 9, z - 4.5, 4.2, 18, 4.2, "#9a9488");                // bell tower
    for (let i = 0; i < 4; i++) addBox(x, y + 18 + i * 1.6, z - 4.5, 3.2 - i * 0.75, 1.7, 3.2 - i * 0.75, "#6a4028");  // tapered spire
    chest(x, y + 0.6, z, poi); loot(x + 4, y + 0.5, z, poi);
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
      addBox(bx, by + 2.4, bz, 8, 4.8, 12, "#b0623c");                   // red barn
      addBox(bx, by + 5.4, bz, 8.5, 1.2, 12.5, shade("#b0623c", 0.8));   // barn roof
      addRamp(bx, by, bz + 7, 3, 5.1, 9, 3, "#8a4d2f");                  // hay ramp to the roof chest
      chest(bx, by + 5.4, bz, p.id);
      const sx = bx, sz = bz - 15, sy = heightAt0(sx, sz);
      addBox(sx, sy + 5, sz, 4, 10, 4, "#c8b48a");                       // silo
      addBox(sx, sy + 10.4, sz, 4.6, 1.2, 4.6, shade("#c8b48a", 0.72));
    }
    const F = R * 0.95, fh = 1.0;                                        // cosmetic fence (never traps players)
    addBox(cx, heightAt0(cx, cz - F) + fh / 2, cz - F, F * 2, fh, 0.2, "#9a7a4a", { collide: false });
    addBox(cx, heightAt0(cx, cz + F) + fh / 2, cz + F, F * 2, fh, 0.2, "#9a7a4a", { collide: false });
    addBox(cx - F, heightAt0(cx - F, cz) + fh / 2, cz, 0.2, fh, F * 2, "#9a7a4a", { collide: false });
    addBox(cx + F, heightAt0(cx + F, cz) + fh / 2, cz, 0.2, fh, F * 2, "#9a7a4a", { collide: false });
    for (let i = 0; i < 2; i++) chest(cx + (rng() - 0.5) * R, heightAt0(cx, cz) + 0.6, cz + (rng() - 0.5) * R, p.id);
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
    // villages → real towns (houses on a street with front doors to the road)
    town(pois[0], [C_WOODP, C_BAMBOO], "#c0563a", { along: "z", nPer: 4 });   // Palm Bay
    town(pois[1], [C_BAMBOO, C_WOODP], "#cf6b3a", { along: "x", nPer: 5 });   // Coco Village
    town(pois[6], [C_WOODP, C_BAMBOO], "#b5503a", { along: "x", nPer: 4 });   // Jungle Market
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
        addRamp(x, y, z + s / 2 + s * 0.75, 2.4, s, s * 1.5, 3, shade(C_STONE, 0.9));
      }
    }
    // volcano rim chests (high-risk high ground)
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2;
      chest(40 + Math.cos(a) * 150, heightAt0(40 + Math.cos(a) * 150, -60 + Math.sin(a) * 150) + 0.6, -60 + Math.sin(a) * 150, "volcano_rim");
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
    hut(90, 590, 5, 4.4, 0, C_WOODP, "lagoon_docks");
    scatterTrees("palm", 420, 0.6, 26, "wood");
    scatterTrees("tree", 260, 2, 40, "wood");
    scatterTrees("bush", 280, 0.6, 30, null);
    scatterTrees("rocks", 120, 1, 70, "brick");
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
    }
    // container yard (metal farm)
    {
      const p = pois[3];
      for (let i = 0; i < 14; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.6, z = p.z + (rng() - 0.5) * p.r * 1.6;
        const y = heightAt0(x, z);
        props.container.push({ x, y, z, s: 1.6 + rng() * 0.6, ry: Math.floor(rng() * 4) * Math.PI / 2 });
      }
      for (let i = 0; i < 3; i++) chest(p.x + (rng() - 0.5) * p.r, heightAt0(p.x, p.z) + 0.6, p.z + (rng() - 0.5) * p.r, p.id);
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
      for (let i = 0; i < 16; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.7, z = p.z + (rng() - 0.5) * p.r * 1.7;
        const y = heightAt0(x, z);
        addBox(x, y + 0.9, z, 3.5 + rng() * 3, 1.8 + rng() * 1.6, 0.5, shade(C_BRICKB, 0.8 + rng() * 0.3), { rotY: rng() * Math.PI });
      }
      for (let i = 0; i < 2; i++) chest(p.x + (rng() - 0.5) * p.r, heightAt0(p.x, p.z) + 0.6, p.z + (rng() - 0.5) * p.r, p.id);
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
    town(pois[8], ["#c8a06a", "#b98f5a"], "#b5643c", { along: "x", nPer: 5 });
    waterTower(pois[0].x + 100, pois[0].z + 70, pois[0].id);                    // Downtown water tower (skyline landmark)
    scatterTrees("tree", 190, 1, 25, "wood");
    scatterTrees("bush", 160, 0.6, 26, null);
    scatterTrees("rocks", 110, 1, 40, "brick");
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
    town(pois[2], [C_PLANK, C_LOG], "#6a4028", { along: "x", nPer: 4, minH: waterY + 0.6 });
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
    scatterTrees("pine", 720, 1.2, 46, "wood");
    scatterTrees("birch", 260, 1.2, 40, "wood");
    scatterTrees("bush", 220, 0.8, 40, null);
    scatterTrees("rocks", 80, 2, 60, "brick");
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
  function addPortal(px, py, pz, faceYaw) {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.16, 10, 28),
      new THREE.MeshStandardMaterial({ color: 0x37e0ff, emissive: 0x1ec8f0, emissiveIntensity: 1.6, roughness: 0.4 })
    );
    grp.add(ring);
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.22, 0.06, 8, 26),
      new THREE.MeshStandardMaterial({ color: 0xb26bff, emissive: 0x9b4dff, emissiveIntensity: 1.4, roughness: 0.4 })
    );
    grp.add(ring2);
    const swirl = new THREE.Mesh(
      new THREE.CircleGeometry(1.35, 24),
      new THREE.MeshBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    grp.add(swirl);
    grp.position.set(px, py + 1.8, pz);
    grp.rotation.y = faceYaw;
    g.add(grp);
    portals.push({ x: px, y: py, z: pz, obj: grp });
  }
  {
    const nIsl = 5 + Math.floor(rng() * 3);
    const grassC = mapId === "ashgrid" ? "#a7ad55" : mapId === "deepwood" ? "#3f7a3f" : "#3fae62";
    const rockC = "#7a6a58";
    for (let i = 0; i < nIsl; i++) {
      const ang = rng() * Math.PI * 2;
      const rr = 180 + rng() * (HALF - 320);
      const ix = Math.cos(ang) * rr, iz = Math.sin(ang) * rr;
      const groundH = heightAt0(ix, iz);
      if (groundH < waterY - 2) continue;                      // not over deep ocean
      const topY = Math.max(groundH, waterY) + 26 + rng() * 26; // 26-52m up
      const rad = 9 + rng() * 8;
      // grassy top disc
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad * 0.92, 1.6, 9),
        new THREE.MeshStandardMaterial({ color: grassC, roughness: 0.95 })
      );
      top.position.set(ix, topY - 0.8, iz);
      top.castShadow = true; top.receiveShadow = true;
      g.add(top);
      // hanging rock cone underneath
      const rock = new THREE.Mesh(
        new THREE.ConeGeometry(rad * 0.9, rad * 1.5, 8),
        new THREE.MeshStandardMaterial({ color: rockC, roughness: 1 })
      );
      rock.rotation.x = Math.PI;
      rock.position.set(ix, topY - 1.4 - rad * 0.75, iz);
      rock.castShadow = true;
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
  for (const color in batches) {
    const merged = BufferGeometryUtils.mergeGeometries(batches[color], false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.04 });
    if (_st) { mat.map = _st.map; mat.normalMap = _st.normal; mat.normalScale = new THREE.Vector2(0.5, 0.5); }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
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
      inst.castShadow = kind !== "bush";
      inst.receiveShadow = true;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
      const meshLocal = new THREE.Matrix4().copy(m.matrixWorld); // transform within GLB
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const s = norm * it.s;
        M.compose(P.set(it.x, it.y - bbox.min.y * s, it.z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry || 0), S.set(s, s, s));
        M.multiply(meshLocal);
        inst.setMatrixAt(i, M);
      }
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
      instRefs[kind].push(inst);
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
    const steps = Math.min(60, Math.max(6, Math.floor(len / 3)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (heightAt0(x, z) > y) return true;
      const near = queryColliders(x, z, 0.5);
      for (const c of near) {
        if (c.kind !== "box") continue;
        if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) return true;
      }
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
  }

  const lootAll = lootPoints.concat(chestPoints);
  return {
    id: mapId, K, half: HALF * 0.98, size: SIZE, waterY,
    heightAt: heightAt0, groundAt: heightAt0,
    colliders, queryColliders, destroyProp,
    lootPoints: lootAll, pois, portals,
    randomGroundPos, losBlocked,
    minimap: mm, themeColor: K.themeColor,
    terrain,
  };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return "#" + c.getHexString();
}
