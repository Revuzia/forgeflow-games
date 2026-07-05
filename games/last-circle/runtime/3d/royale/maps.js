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

export const MAPS = {
  isla_viva: { name: "Isla Viva", theme: "tropical", sky: "#7fd4f0", fog: 0.0011, themeColor: "#22d3a0", water: true },
  ashgrid:   { name: "Ashgrid", theme: "urban", sky: "#aab6c4", fog: 0.0013, themeColor: "#e0685a", water: false },
  deepwood:  { name: "Deepwood", theme: "forest", sky: "#9fc7e8", fog: 0.0016, themeColor: "#7fb069", water: true },
  practice_range: { name: "Proving Grounds", theme: "range", sky: "#8fd0f5", fog: 0.0008, themeColor: "#f2c14e", water: false },
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
  // practice range: flat with a couple of berms
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
    const g = 0.42 + n * 0.14;
    if (h > 18) return [0.5, 0.47, 0.44];
    return [g, g, g + 0.02];                                      // asphalt/concrete
  }
  if (mapId === "deepwood") {
    if (h < 0.6) return [0.55, 0.5, 0.38];                        // river mud
    if (h > 44) return [0.5, 0.48, 0.45];                         // rocky tops
    return [0.12 + n * 0.1, 0.4 + n * 0.14, 0.16];                // deep green
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
  W.scene.background = new THREE.Color(K.sky);
  if (W.scene.fog) { W.scene.fog.color = new THREE.Color(K.sky); W.scene.fog.density = K.fog; }

  // ── terrain mesh (vertex-colored) ─────────────────────────────────────────
  const SEG = 220;
  const terrGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  terrGeo.rotateX(-Math.PI / 2);
  const pos = terrGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt0(x, z);
    pos.setY(i, h);
    const c = colorAt(mapId, h, x, z, seed);
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
  }
  terrGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  terrGeo.computeVertexNormals();
  const terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const terrain = new THREE.Mesh(terrGeo, terrMat);
  terrain.receiveShadow = true;
  terrain.name = "terrain";
  g.add(terrain);

  // ── water ─────────────────────────────────────────────────────────────────
  if (K.water) {
    const wgeo = new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshStandardMaterial({
      color: mapId === "isla_viva" ? 0x1899b8 : 0x2a6b7a, transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1,
    });
    const water = new THREE.Mesh(wgeo, wmat);
    water.position.y = waterY;
    water.name = "water";
    g.add(water);
    W.kernel.onUpdate((dt, t) => { water.position.y = waterY + Math.sin(t * 0.7) * 0.12; });
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
    // rendered as a rotated slab; collider is kind:'ramp' (walkable slope)
    const geo = new THREE.BoxGeometry(w, 0.3, Math.sqrt(d * d + h * h));
    const ang = Math.atan2(h, d);
    if (dir === 0) { geo.rotateZ(-ang); geo.rotateY(Math.PI / 2); }
    else if (dir === 1) { geo.rotateZ(ang); geo.rotateY(Math.PI / 2); }
    else if (dir === 2) geo.rotateX(ang);
    else geo.rotateX(-ang);
    geo.translate(cx, cy + h / 2, cz);
    (batches[color] = batches[color] || []).push(geo);
    colliders.push({ kind: "ramp", minX: cx - w / 2, maxX: cx + w / 2, minY: cy, maxY: cy + h, minZ: cz - d / 2, maxZ: cz + d / 2, dir });
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
      // slab (skip ground floor slab)
      if (f > 0) addBox(x, fy + 0.15, z, fw, 0.3, fw, shade(color, 0.8));
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

  if (mapId === "isla_viva") {
    const C_BAMBOO = "#c9a86a", C_STONE = "#8f8a80", C_WOODP = "#a8794f";
    poi("palm_bay", "Palm Bay", -520, 90, 90);
    poi("coco_village", "Coco Village", -60, 350, 110);
    poi("volcano_rim", "Volcano Rim", 40, -60, 130);
    poi("shipwreck", "Shipwreck Cove", 470, -430, 95);
    poi("cliff_temples", "Cliff Temples", 480, 60, 110);
    poi("lagoon_docks", "Lagoon Docks", 120, 620, 100);
    poi("jungle_market", "Jungle Market", -350, -380, 100);
    poi("banana_farm", "Banana Farm", -430, 480, 90);
    // villages/shacks
    for (const p of [pois[0], pois[1], pois[6], pois[7]]) {
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, d = rng() * p.r * 0.7;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (heightAt0(x, z) < 0.8) continue;
        hut(x, z, 4.5 + rng() * 2.5, 4 + rng() * 2, 0, i % 2 ? C_BAMBOO : C_WOODP, p.id);
      }
      for (let i = 0; i < 3; i++) chest(p.x + (rng() - 0.5) * p.r, heightAt0(p.x, p.z) + 0.6, p.z + (rng() - 0.5) * p.r, p.id);
    }
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
      chest(p.x, y + 3.4, p.z, p.id); chest(p.x + 4, y + 0.8, p.z - 6, p.id);
      loot(p.x - 4, y + 0.8, p.z + 6, p.id);
    }
    // docks
    pier(120, 640, 22, 0.2, C_WOODP, "lagoon_docks");
    pier(160, 610, 16, -0.3, C_WOODP, "lagoon_docks");
    hut(90, 590, 5, 4.4, 0, C_WOODP, "lagoon_docks");
    scatterTrees("palm", 420, 0.6, 26, "wood");
    scatterTrees("tree", 260, 2, 40, "wood");
    scatterTrees("bush", 200, 0.6, 30, null);
    scatterTrees("rocks", 90, 1, 70, "brick");
  } else if (mapId === "ashgrid") {
    const C_CONC = "#9aa0a6", C_CONC2 = "#7d8489", C_BRICKB = "#9c6b5a", C_METAL = "#6f7d8a";
    poi("downtown", "Downtown Core", 0, 0, 150);
    poi("metro", "Metro Plaza", 60, -430, 110);
    poi("overpass", "The Overpass", 430, 80, 120);
    poi("yard", "Container Yard", 420, 430, 110);
    poi("mall", "Old Mall", -430, -60, 120);
    poi("crane", "Crane Heights", -380, -430, 90);
    poi("rubble", "Rubble Row", -60, 430, 110);
    poi("motorpool", "Motor Pool", -430, 380, 90);
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
      addRamp(p.x - 78, heightAt0(p.x - 78, p.z), p.z, 9, 8.2, 26, 0, C_CONC);
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
    scatterTrees("tree", 110, 1, 25, "wood");
    scatterTrees("rocks", 60, 1, 40, "brick");
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
    // logging camp
    {
      const p = pois[0];
      for (let i = 0; i < 4; i++) hut(p.x + (rng() - 0.5) * p.r, p.z + (rng() - 0.5) * p.r, 6, 5, 0, C_LOG, p.id);
      for (let i = 0; i < 8; i++) {
        const x = p.x + (rng() - 0.5) * p.r * 1.5, z = p.z + (rng() - 0.5) * p.r * 1.5;
        const y = heightAt0(x, z);
        addBox(x, y + 0.5, z, 1, 1, 4.5, shade(C_LOG, 0.9), { rotY: rng() * Math.PI }); // log piles
      }
      chest(p.x, heightAt0(p.x, p.z) + 0.6, p.z, p.id);
    }
    // ranger ridge + fire watch towers
    rangerTower(pois[1].x - 20, pois[1].z, C_PLANK, "ranger");
    rangerTower(pois[1].x + 45, pois[1].z + 35, C_PLANK, "ranger");
    rangerTower(pois[6].x, pois[6].z, C_PLANK, "firewatch");
    // lakeside cabins
    {
      const p = pois[2];
      for (let i = 0; i < 5; i++) hut(p.x + (rng() - 0.5) * p.r, p.z + (rng() - 0.5) * p.r * 0.6, 5.5, 4.5, 0, C_PLANK, p.id);
      pier(p.x + 40, p.z + 60, 18, 0.3, C_PLANK, p.id);
      chest(p.x, heightAt0(p.x, p.z) + 0.6, p.z, p.id);
    }
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
    // meadow farm
    {
      const p = pois[7];
      hut(p.x, p.z, 9, 7, 0, C_PLANK, p.id);
      addBox(p.x - 30, heightAt0(p.x - 30, p.z) + 2.4, p.z, 8, 4.8, 12, "#b0623c"); // barn
      chest(p.x - 30, heightAt0(p.x - 30, p.z) + 5.4, p.z, p.id);
    }
    scatterTrees("pine", 720, 1.2, 46, "wood");
    scatterTrees("birch", 260, 1.2, 40, "wood");
    scatterTrees("bush", 220, 0.8, 40, null);
    scatterTrees("rocks", 80, 2, 60, "brick");
  } else {
    // practice range
    poi("range", "Shooting Range", 0, -80, 80);
    poi("longlane", "Long Lane", -120, 60, 60);
    poi("course", "Movement Course", 120, 60, 70);
    // target stands
    for (let i = 0; i < 8; i++) {
      const x = -70 + i * 20, z = -140;
      addBox(x, heightAt0(x, z) + 1.2, z, 1.6, 2.4, 0.3, "#d9553f");
      loot(x, heightAt0(x, z) + 0.5, z - 40, "range");
    }
    for (let d = 1; d <= 4; d++) addBox(0, heightAt0(0, -80 - d * 50) + 0.4, -80 - d * 50, 12, 0.8, 0.6, "#f2c14e"); // distance markers
    // movement course: hop platforms
    for (let i = 0; i < 8; i++) addBox(120 + Math.sin(i * 1.2) * 26, heightAt0(120, 60) + 1 + i * 1.1, 30 + i * 14, 3.4, 0.5, 3.4, "#7fb069");
    for (let i = 0; i < 10; i++) loot((rng() - 0.5) * 200, heightAt0(0, 0) + 0.5, (rng() - 0.5) * 200, "range");
    for (let i = 0; i < 4; i++) chest((rng() - 0.5) * 220, heightAt0(0, 0) + 0.6, (rng() - 0.5) * 220, "range");
    scatterTrees("tree", 60, 0.5, 30, "wood");
  }

  // scattered wilderness loot (all maps)
  const wildN = mapId === "practice_range" ? 0 : 130;
  for (let i = 0; i < wildN; i++) {
    const x = (rng() * 2 - 1) * (HALF - 60), z = (rng() * 2 - 1) * (HALF - 60);
    const y = heightAt0(x, z);
    if (y < waterY + 0.5) continue;
    loot(x, y + 0.5, z, null);
    if (rng() < 0.12) chest(x, y + 0.6, z, null);
  }

  // ── merge batched boxes into one mesh per color ───────────────────────────
  for (const color in batches) {
    const merged = BufferGeometryUtils.mergeGeometries(batches[color], false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  }

  // ── instanced props from GLBs ─────────────────────────────────────────────
  const instRefs = {};   // kind -> [{inst, baseMatrixes}]
  const propColliderKinds = { palm: 0.5, tree: 0.6, pine: 0.55, birch: 0.5, rocks: 1.4, car: 1.6, container: 2.2 };
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
      for (const it of list) {
        colliders.push({ kind: "box", minX: it.x - rad, maxX: it.x + rad, minY: it.y, maxY: it.y + (kind === "car" ? 1.6 : kind === "container" ? 2.8 : 6), minZ: it.z - rad, maxZ: it.z + rad, prop: kind });
      }
    }
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
      if (l) for (const c of l) { if (!seen.has(c)) { seen.add(c); out.push(c); } }
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

  const lootAll = lootPoints.concat(chestPoints);
  return {
    id: mapId, K, half: HALF * 0.98, size: SIZE, waterY,
    heightAt: heightAt0, groundAt: heightAt0,
    colliders, queryColliders,
    lootPoints: lootAll, pois,
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
