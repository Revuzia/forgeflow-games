// core/level/level.js [A3] — visual build of Meridian Ward FROM layout.js
// (architecture §3.12: colliders.js and level.js read the SAME single source,
// so visuals and collision can never drift). Emits staticLightSpecs for A6's
// pool binding — this file NEVER creates a THREE.Light (hard rule).
//
// Implements: LD §2 (metre-exact zone visuals), §3.3 practicals (8 real
// leases emitted as specs; every fake = emissive head + additive glow card +
// baked ground-pool decal — zero real lights), §4 dressing surfaces (grime
// decal pass, catenaries, signage, windows), §5.4 wetness (vertex 'aowet'
// puddle masks, gutter strips, planar/env hook via materials.GROUND_HOOKS);
// VT §1 (vertex AO / contact darkening), §3 (metres/TILE UVs on every
// generated face, anti-tiling via the shared grunge shader layer).
//
// Extra outputs (additive fields — frozen return keys {group,
// staticLightSpecs} untouched):
//   practicals    registry A6 uses for the beat-3 blackout (emissive mats,
//                 glow sprites, the plaza-circuit pool mesh) and flicker
//   rainOcclusion 4 interior AABBs for A6 weather.js (LD §5.3)
//   hooks         materials.GROUND_HOOKS (planar reflection uniforms — A6
//                 reflect.js writes planarTex/planarMat/planarStrength)
// The same registry rides on group.userData.level for ctx-only consumers.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeMaterials, GROUND_HOOKS, DECAL_UV, makeNeonCanvas, makeSignCanvas } from "./materials.js";
// props.js is imported DYNAMICALLY with ctx.V inside buildLevel: boot loads
// modules as `<file>.js?v=N`, so a bare static import here would create a
// SECOND props.js instance and the GLB library would land in the wrong one
// (module identity = full URL).

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// world-space metre UVs per face (doctrine §3: metres/TILE by construction)
function worldUV(geo) {
  const p = geo.getAttribute("position"), n = geo.getAttribute("normal");
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

// box between min/max with metre UVs + aowet (r=AO/tint, g=puddle, b=streak)
function boxGeo(min, max, tint = 1) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  worldUV(g);
  const p = g.getAttribute("position");
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) - min[1];
    a[i * 3] = tint;
    a[i * 3 + 1] = 0;
    a[i * 3 + 2] = h > 2 ? Math.max(0, 1 - y) * 0.65 : 0; // splash-zone streak <1 m
  }
  g.setAttribute("aowet", new THREE.BufferAttribute(a, 3));
  return g;
}

function planeXZ(w, d) { // helper for decal/pool quads
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  return g;
}

// merged batches must agree on attribute sets — pad any non-box geometry
// that joins a boxGeo batch with a neutral aowet
function withAowet(g) {
  if (!g.getAttribute("aowet")) {
    const n = g.getAttribute("position").count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a[i * 3] = 1;
    g.setAttribute("aowet", new THREE.BufferAttribute(a, 3));
  }
  return g;
}

function setCellUV(geo, cell) {
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (cell[0] + uv.getX(i)) / 4, (3 - cell[1] + uv.getY(i)) / 4);
  }
}

// ---------------------------------------------------------------- main
export async function buildLevel(ctx) {
  const layout = ctx.layout;
  const M = makeMaterials(ctx);
  await M.ready;
  // warm the GLB cache buildProps reads (sync) — SAME module instance as
  // boot's. boot's buildLevel ctx carries no V, so derive it from THIS
  // module's own URL (boot loaded us as level.js?v=N).
  const V = new URL(import.meta.url).search;
  const propsMod = await import(`./props.js${V}`);
  await propsMod.loadPropLibrary({ ...ctx, V });

  const group = new THREE.Group();
  group.name = "level";
  const registry = {
    // A6 blackout set-piece handles (LD §6 beat 3): kill/relight these only —
    // intensity/emissive animation, the light POOL never resizes.
    blackout: { emissiveMats: [], sprites: [], poolMesh: null },
    flicker: [],   // {mat, sprite, base} — platform fluorescent etc. (A6 may drive; level self-drives a fallback)
    practicals: {},
  };

  const solids = [];
  for (const b of layout.buildings) if (b.box) solids.push(b.box);
  for (const w of layout.walls) solids.push({ min: w.min, max: w.max });
  for (const p of layout.props) if (p.solid && p.aabb) solids.push(p.aabb);

  // ============================================================ 1. GROUNDS
  // visual puddle authoring (LD §4.2 table) — circles {x,z,r} + wet rects
  const PUDDLES = [
    ...layout.terrain.heroPuddles.map((h) => ({ x: h.pos[0], z: h.pos[1], r: h.r })), // plaza hero group
    { x: -23, z: -15, r: 0.9 }, { x: 13, z: -16, r: 0.8 }, { x: -24, z: 10, r: 1.0 },
    { x: 12, z: 16, r: 0.8 }, { x: -9, z: 17, r: 0.7 }, { x: 4, z: -17, r: 0.9 },   // plaza satellites
    { x: -56, z: 30, r: 0.8 }, { x: -49.5, z: 24.5, r: 0.6 }, { x: -55, z: 12, r: 0.9 },
    { x: -50.5, z: 4, r: 0.7 }, { x: -44, z: -2.5, r: 0.6 }, { x: -53, z: -13, r: 0.8 },
    { x: -46, z: -18, r: 0.6 }, { x: -43, z: 34, r: 0.7 },                            // alley (8)
    { x: -30, z: 52.6, r: 1.4 }, { x: -18, z: 46, r: 0.9 }, { x: 26, z: 50, r: 1.0 }, // dock smalls
    { x: 36, z: 20, r: 0.55 }, { x: 35.6, z: 4, r: 0.5 }, { x: 36.3, z: -12, r: 0.6 },
    { x: 35.8, z: -28, r: 0.5 },                                                      // blvd crown ruts
    { x: -8, z: -43, r: 1.3 }, { x: 4, z: -47.5, r: 1.5 }, { x: 14, z: -44, r: 1.1 },
    { x: -2, z: -52, r: 1.2 }, { x: 18, z: -51, r: 1.0 },                             // customs ruts
    { x: -32, z: -8, r: 1.0 },                                                        // arcade lightwell (skylight drip)
    { x: 19, z: -27, r: 0.6 }, { x: 21.5, z: -5, r: 0.6 },                            // gallery leaks
  ];
  const WET_RECTS = [
    { min: [-35, 52], max: [-25, 54], g: 0.85 },      // quay-edge sheet 10×2
    { min: [28.05, -40], max: [28.65, 42], g: 0.55 }, // blvd gutters (both edges)
    { min: [45.35, -40], max: [45.95, 42], g: 0.55 },
  ];
  const puddleAt = (x, z) => {
    let g = 0;
    for (const p of PUDDLES) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.25) {
        const t = 1 - Math.max(0, (d - p.r * 0.55) / (p.r * 0.7));
        g = Math.max(g, Math.min(1, t));
      }
    }
    for (const r of WET_RECTS) {
      if (x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]) g = Math.max(g, r.g);
    }
    return g;
  };
  // contact AO against nearby solids (VT §1: corner darkening grounds geometry)
  const aoSolids = solids.filter((s) => s.max[1] - s.min[1] > 0.9);
  const aoAt = (x, z) => {
    let d2min = 4;
    for (const s of aoSolids) {
      const dx = Math.max(s.min[0] - x, 0, x - s.max[0]);
      const dz = Math.max(s.min[2] - z, 0, z - s.max[2]);
      const d2 = dx * dx + dz * dz;
      if (d2 < d2min) d2min = d2;
      if (d2min === 0) break;
    }
    const d = Math.sqrt(d2min);
    return d >= 1.4 ? 1 : 0.62 + 0.38 * (d / 1.4);
  };
  const GROUND_MAT = {
    concrete_quay: M.concreteYard, asphalt_worn: M.asphalt, asphalt: M.asphalt,
    plaza_cobble: M.cobble, concrete_interior: M.concreteInterior,
    asphalt_tram: M.asphaltTram, concrete_yard: M.concreteYard,
    tile_interior: M.tileInterior,
  };
  {
    const byMat = new Map();
    const tintNoise = rng(500);
    for (const r of layout.roads) {
      const w = r.max[0] - r.min[0], d = r.max[1] - r.min[1];
      const sx = Math.max(2, Math.round(w / 1.5)), sz = Math.max(2, Math.round(d / 1.5));
      const g = new THREE.PlaneGeometry(w, d, sx, sz);
      g.rotateX(-Math.PI / 2);
      g.translate(r.min[0] + w / 2, 0, r.min[1] + d / 2);
      const p = g.getAttribute("position");
      const uv = new Float32Array(p.count * 2);
      const a = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        uv[i * 2] = x; uv[i * 2 + 1] = z;
        // macro tint variance (anti-tiling b) + contact AO
        const m = 0.92 + 0.14 * Math.abs(Math.sin(x * 0.53 + z * 0.71) * Math.cos(x * 0.11 - z * 0.17));
        a[i * 3] = aoAt(x, z) * m;
        a[i * 3 + 1] = puddleAt(x, z);
        a[i * 3 + 2] = 0;
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("aowet", new THREE.BufferAttribute(a, 3));
      const mat = GROUND_MAT[r.kind] || M.asphalt;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(g);
    }
    for (const [mat, geos] of byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.name = "ground";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    void tintNoise;
  }

  // ---- canal water (S1: skyglow spec over the freight canal)
  {
    const g = new THREE.PlaneGeometry(340, 110, 24, 12);
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.55, 54 + 55);
    const p = g.getAttribute("position");
    const uv = new Float32Array(p.count * 2), a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getZ(i);
      a[i * 3] = 1; a[i * 3 + 1] = 0.9; a[i * 3 + 2] = 0;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("aowet", new THREE.BufferAttribute(a, 3));
    const mesh = new THREE.Mesh(g, M.water);
    mesh.name = "canal_water";
    group.add(mesh);
    // ripple time driver (shared GROUND_HOOKS.time — fixed step, battery-stable)
    mesh.onBeforeRender = () => { GROUND_HOOKS.time.value = (GROUND_HOOKS.time.value + 1 / 60) % 3600; };
  }

  // ========================================================== 2. WALL LIST
  {
    const byMat = new Map();
    const put = (mat, g) => { if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat).push(g); };
    const tintR = rng(41);
    for (const w of layout.walls) {
      if (w.kind === "rail") { // lightwell balcony railing: posts + bars
        const cx = (w.min[0] + w.max[0]) / 2, cz = (w.min[2] + w.max[2]) / 2;
        const alongX = (w.max[0] - w.min[0]) > (w.max[2] - w.min[2]);
        const len = alongX ? w.max[0] - w.min[0] : w.max[2] - w.min[2];
        const nPost = Math.max(2, Math.round(len / 1.2));
        for (let i = 0; i <= nPost; i++) {
          const t = i / nPost;
          const x = alongX ? w.min[0] + len * t : cx;
          const z = alongX ? cz : w.min[2] + len * t;
          put(M.rail, boxGeo([x - 0.02, w.min[1], z - 0.02], [x + 0.02, w.max[1], z + 0.02]));
        }
        for (const yy of [w.max[1] - 0.02, w.min[1] + 0.45]) {
          put(M.rail, alongX
            ? boxGeo([w.min[0], yy - 0.02, cz - 0.02], [w.max[0], yy + 0.02, cz + 0.02])
            : boxGeo([cx - 0.02, yy - 0.02, w.min[2]], [cx + 0.02, yy + 0.02, w.max[2]]));
        }
        continue;
      }
      if (w.id === "canal_edge") { // low coping + open railing (S1 reads over it)
        put(M.concreteWall, boxGeo([w.min[0], 0, w.min[2]], [w.max[0], 0.45, w.min[2] + 0.9], 0.95));
        const n = Math.round((w.max[0] - w.min[0]) / 2.6);
        for (let i = 0; i <= n; i++) {
          const x = w.min[0] + ((w.max[0] - w.min[0]) / n) * i;
          put(M.rail, boxGeo([x - 0.03, 0.45, w.min[2] + 0.25], [x + 0.03, 1.15, w.min[2] + 0.31]));
        }
        put(M.rail, boxGeo([w.min[0], 1.1, w.min[2] + 0.25], [w.max[0], 1.16, w.min[2] + 0.31]));
        put(M.rail, boxGeo([w.min[0], 0.72, w.min[2] + 0.26], [w.max[0], 0.76, w.min[2] + 0.3]));
        continue;
      }
      if (w.kind === "gate") { // Gate 9: corrugated leaves + frame + gantry panel
        put(M.steel, boxGeo([w.min[0] - 0.15, 0, w.min[2]], [w.min[0], 3.2, w.max[2]]));
        put(M.steel, boxGeo([w.max[0], 0, w.min[2]], [w.max[0] + 0.15, 3.2, w.max[2]]));
        put(M.steel, boxGeo([w.min[0] - 0.15, 3.0, w.min[2]], [w.max[0] + 0.15, 3.25, w.max[2]]));
        const mid = (w.min[2] + w.max[2]) / 2;
        put(M.corrugated, boxGeo([w.min[0], 0.04, mid - 0.05], [(w.min[0] + w.max[0]) / 2 - 0.02, w.max[1], mid + 0.05]));
        put(M.corrugated, boxGeo([(w.min[0] + w.max[0]) / 2 + 0.02, 0.04, mid - 0.05], [w.max[0], w.max[1], mid + 0.05]));
        // gantry sign panel above the beam (carries the GATE 9 plate)
        put(M.corrugated, boxGeo([w.min[0], 3.25, mid - 0.06], [w.max[0], 3.95, mid + 0.06]));
        continue;
      }
      const mat = w.surface === "metal" ? M.metal
        : w.kind === "roof" || w.kind === "slab" || w.kind === "deck" ? M.concreteWall
        : w.kind === "step" ? M.concreteYard
        : M.concreteWall;
      // tint 1.0 — adjacent wall pieces share planes; the world-space grunge
      // layer varies them identically so coincident faces can never shimmer
      put(mat, boxGeo(w.min, w.max, 1));
      void tintR;
    }
    for (const [mat, geos] of byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.name = "walls";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ---- skylight rim + broken glass shards (arcade lightwell)
  {
    const trim = [];
    trim.push(boxGeo([-35.1, 8.14, -11.1], [-28.9, 8.24, -10.9]));
    trim.push(boxGeo([-35.1, 8.14, -5.1], [-28.9, 8.24, -4.9]));
    trim.push(boxGeo([-35.1, 8.14, -11.1], [-34.9, 8.24, -4.9]));
    trim.push(boxGeo([-29.1, 8.14, -11.1], [-28.9, 8.24, -4.9]));
    const t = new THREE.Mesh(mergeGeometries(trim, false), M.trim);
    t.name = "skylight_rim";
    group.add(t);
    const shards = [];
    const sr = rng(66);
    for (let i = 0; i < 4; i++) {
      const g = new THREE.PlaneGeometry(0.7 + sr() * 0.9, 0.5 + sr() * 0.6);
      g.rotateX(-Math.PI / 2 + (sr() - 0.5) * 0.5);
      g.rotateY(sr() * Math.PI);
      g.translate(-34.7 + sr() * 1.2 + (i % 2) * 4.6, 8.18, -10.6 + sr() * 1.0 + (i > 1 ? 4.4 : 0));
      shards.push(g);
    }
    const sm = new THREE.Mesh(mergeGeometries(shards, false), M.glass);
    sm.name = "skylight_shards";
    group.add(sm);
  }

  // ========================================================= 3. BUILDINGS
  const litWindows = []; // world positions of lit windows (for pool decals)
  {
    const wallGeos = { a: [], b: [], c: [] };
    const trimGeos = [], winLit = [], winDark = [], roofGeos = [];
    const wr = rng(90210);
    let litCount = 0;
    const faceDirs = [
      { n: [1, 0], ax: "z" }, { n: [-1, 0], ax: "z" },
      { n: [0, 1], ax: "x" }, { n: [0, -1], ax: "x" },
    ];
    for (const b of layout.buildings) {
      if (!b.box) continue;
      const key = ["a", "b", "c"][(b.id.charCodeAt(4) || 0) % 3];
      // 1 cm XZ inset kills coplanar z-fighting where two building boxes
      // share a plane (visual only — colliders keep the authored extents)
      const bMin = [b.box.min[0] + 0.01, b.box.min[1], b.box.min[2] + 0.01];
      const bMax = [b.box.max[0] - 0.01, b.box.max[1], b.box.max[2] - 0.01];
      wallGeos[key].push(boxGeo(bMin, bMax, 0.9 + wr() * 0.16));
      const { min, max } = b.box;
      // parapet cap
      trimGeos.push(boxGeo([min[0] - 0.06, max[1] - 0.18, min[2] - 0.06], [max[0] + 0.06, max[1] + 0.06, min[2] + 0.12]));
      trimGeos.push(boxGeo([min[0] - 0.06, max[1] - 0.18, max[2] - 0.12], [max[0] + 0.06, max[1] + 0.06, max[2] + 0.06]));
      trimGeos.push(boxGeo([min[0] - 0.06, max[1] - 0.18, min[2]], [min[0] + 0.12, max[1] + 0.06, max[2]]));
      trimGeos.push(boxGeo([max[0] - 0.12, max[1] - 0.18, min[2]], [max[0] + 0.06, max[1] + 0.06, max[2]]));
      // roof clutter for the skyline (S5)
      if (max[1] >= 9) {
        const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
        roofGeos.push(boxGeo([cx - 1.2, max[1], cz - 1.0], [cx + 0.4, max[1] + 1.1, cz + 0.6]));
        const tank = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 10);
        tank.translate(cx + 2.2, max[1] + 0.7, cz - 1.4);
        worldUV(tank);
        roofGeos.push(withAowet(tank));
        if (wr() > 0.5) {
          roofGeos.push(boxGeo([cx - 0.04, max[1], cz + 1.6], [cx + 0.04, max[1] + 2.4, cz + 1.68]));
        }
      }
      // window grids per face
      const floors = b.floors || 1;
      if (max[1] < 4) continue;
      for (const f of faceDirs) {
        const horiz = f.ax === "x";
        const lo = horiz ? min[0] : min[2], hi = horiz ? max[0] : max[2];
        const span = hi - lo;
        if (span < 3) continue;
        const facePos = f.n[0] > 0 ? max[0] : f.n[0] < 0 ? min[0] : f.n[1] > 0 ? max[2] : min[2];
        // skip faces at the map boundary (never seen from inside)
        if (Math.abs(facePos) >= 57.5) continue;
        const cols = Math.floor((span - 1.4) / 2.7);
        if (cols < 1) continue;
        const pad = (span - cols * 2.7) / 2 + 1.35;
        for (let fl = 0; fl < floors; fl++) {
          const wy = 2.15 + fl * 2.95;
          if (wy + 0.85 > max[1] - 0.6) break;
          for (let cJ = 0; cJ < cols; cJ++) {
            const wc = lo + pad + cJ * 2.7;
            const lit = litCount < 19 && wr() < 0.085;
            if (lit) litCount++;
            const g = new THREE.PlaneGeometry(1.25, 1.55);
            const cell = lit ? (wr() * 4) | 0 : 4 + ((wr() * 4) | 0);
            // atlas: 4 lit cells (row 0), 4 dark (row 1) on a 4×2 sheet
            const uv = g.getAttribute("uv");
            for (let i = 0; i < uv.count; i++) {
              uv.setXY(i, ((cell % 4) + uv.getX(i)) / 4, cell < 4 ? 0.5 + uv.getY(i) / 2 : uv.getY(i) / 2);
            }
            if (f.n[0] > 0) { g.rotateY(Math.PI / 2); g.translate(facePos + 0.03, wy, wc); }
            else if (f.n[0] < 0) { g.rotateY(-Math.PI / 2); g.translate(facePos - 0.03, wy, wc); }
            else if (f.n[1] > 0) { g.translate(wc, wy, facePos + 0.03); }
            else { g.rotateY(Math.PI); g.translate(wc, wy, facePos - 0.03); }
            (lit ? winLit : winDark).push(g);
            if (lit) litWindows.push([f.n[0] ? facePos + f.n[0] * 0.03 : wc, wy, f.n[1] ? facePos + f.n[1] * 0.03 : wc, f.n]);
            // sill
            const sw = 1.4;
            if (f.n[0]) {
              trimGeos.push(boxGeo([facePos + Math.min(0, f.n[0] * 0.1) - 0.02, wy - 0.85, wc - sw / 2],
                [facePos + Math.max(0, f.n[0] * 0.1) + 0.02, wy - 0.77, wc + sw / 2]));
            } else {
              trimGeos.push(boxGeo([wc - sw / 2, wy - 0.85, facePos + Math.min(0, f.n[1] * 0.1) - 0.02],
                [wc + sw / 2, wy - 0.77, facePos + Math.max(0, f.n[1] * 0.1) + 0.02]));
            }
          }
        }
      }
    }
    const wallMats = { a: M.plaster, b: M.plasterDark, c: M.concreteWall };
    for (const k of ["a", "b", "c"]) {
      if (!wallGeos[k].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(wallGeos[k], false), wallMats[k]);
      mesh.name = `buildings_${k}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (trimGeos.length) {
      const t = new THREE.Mesh(mergeGeometries(trimGeos, false), M.trim);
      t.name = "building_trim";
      t.castShadow = true;
      group.add(t);
    }
    if (roofGeos.length) {
      const rm = new THREE.Mesh(mergeGeometries(roofGeos, false), M.metal);
      rm.name = "roof_clutter";
      rm.castShadow = true;
      group.add(rm);
    }
    if (winDark.length) {
      const wd = new THREE.Mesh(mergeGeometries(winDark, false), M.windowDark);
      wd.name = "windows_dark";
      group.add(wd);
    }
    if (winLit.length) {
      const wl = new THREE.Mesh(mergeGeometries(winLit, false), M.windowLit);
      wl.name = "windows_lit";
      group.add(wl);
    }
  }

  // ================================================= 4. BOULEVARD FURNITURE
  {
    // tram tracks — inset steel, gloss (gutter reflections run the S5 depth)
    const rails = [];
    for (const x of [35.05, 36.65]) rails.push(boxGeo([x, 0.002, -40], [x + 0.3, 0.018, 42]));
    const rm = new THREE.Mesh(mergeGeometries(rails, false), M.rail);
    rm.name = "tram_tracks";
    rm.receiveShadow = true;
    group.add(rm);
    // catenary gantries every 20 m + platform deck warning strip
    const gantry = [];
    for (const z of [-30, -10, 10, 30]) {
      gantry.push(boxGeo([28.5, 0, z - 0.12], [28.74, 6.5, z + 0.12]));
      gantry.push(boxGeo([45.3, 0, z - 0.12], [45.54, 6.5, z + 0.12]));
      gantry.push(boxGeo([28.6, 6.3, z - 0.06], [45.44, 6.46, z + 0.06]));
    }
    gantry.push(boxGeo([28.2, 4.5, -44.3], [44.5, 4.56, -44.05], 1)); // deck edge strip base
    const gm = new THREE.Mesh(mergeGeometries(gantry, false), M.steel);
    gm.name = "gantries";
    gm.castShadow = true;
    group.add(gm);
  }

  // ======================================================== 5. CATENARIES
  const cableGeos = [];
  const lampSpots = []; // {x,y,z,lit}
  function addCatenary(p0, p1, sag, segs = 12) {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const pt = (t) => [
        p0[0] + (p1[0] - p0[0]) * t,
        p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t),
        p0[2] + (p1[2] - p0[2]) * t,
      ];
      const a = pt(t0), b = pt(t1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const g = new THREE.CylinderGeometry(0.016, 0.016, len, 4, 1, true);
      g.translate(0, len / 2, 0);
      const m = new THREE.Matrix4().lookAt(
        new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(0, 1, 0));
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(m).setPosition(new THREE.Vector3(...a)));
      cableGeos.push(g);
    }
  }
  {
    // plaza: 6 spans wall-to-wall with hanging lamps — 2 lit fake, 4 dead.
    // Anchor columns chosen where BOTH ends have building mass at z ±18
    // (south faces: bld_s1 x[-41,-14], bld_s2 x[-6,15]; north: bld_nw2
    // x[-25,-12.5], bld_nea/neb x[0,15]) — never over the street/ramp gaps.
    const lampX = [-22, -17, 1, 5, 9, 13];
    lampX.forEach((x, i) => {
      addCatenary([x, 7.4, 17.9], [x, 7.0, -17.9], 1.25);
      const y = 7.2 - 1.25; // mid sag
      lampSpots.push({ x, y: y - 0.25, z: 0, lit: i === 2 || i === 4, plaza: true });
    });
    // alley: laundry ×2 + power runs ×4
    addCatenary([-48.05, 5.4, 20], [-41.05, 5.1, 20.6], 0.5, 8);
    addCatenary([-48.05, 5.6, 15.2], [-41.05, 5.3, 15.8], 0.55, 8);
    addCatenary([-52, 5.4, 24], [-48, 5.2, -4], 0.9);
    addCatenary([-48, 5.2, -4], [-44, 5.6, -20], 0.8);
    addCatenary([-58, 6.2, 34], [-52, 5.4, 24], 0.7);
    addCatenary([-44, 5.6, -20], [-41.2, 6.0, -27.5], 0.5, 8);
    // quay crane cable with 2 dead hanging lamps
    addCatenary([-44, 6.6, 43], [-16, 6.8, 43.2], 1.5);
    lampSpots.push({ x: -34, y: 6.7 - 1.4, z: 43.05, lit: false });
    lampSpots.push({ x: -25, y: 6.7 - 1.45, z: 43.1, lit: false });
    // tram catenary: 2 wires, 5 spans across the 4 gantries (S5 vanishing point)
    const zs = [-40, -30, -10, 10, 30, 42];
    for (const x of [35.2, 36.8]) {
      for (let i = 0; i < zs.length - 1; i++) addCatenary([x, 6.28, zs[i]], [x, 6.28, zs[i + 1]], 0.4, 8);
    }
    const cm = new THREE.Mesh(mergeGeometries(cableGeos, false), M.cableMat);
    cm.name = "cables";
    group.add(cm);
  }

  // ================================================ 6. PRACTICALS + SIGNAGE
  const glowSprites = [];
  const poolStatic = [], poolPlaza = [];
  const poleGeos = [], headGeos = [];
  const sodiumHead = M.emissive(0xff9a3c, 3.2);
  const coolLens = M.emissive(0xdce8ff, 4.0);
  const fluorMat = M.emissive(0xcfe0d8, 2.6);
  const warmBulb = M.emissive(0xffc88a, 2.6);

  function addGlow(x, y, z, color, scale, opacity = 0.5) {
    const s = new THREE.Sprite(M.glowMat(color, opacity));
    s.position.set(x, y, z);
    s.scale.setScalar(scale);
    glowSprites.push(s);
    group.add(s);
    return s;
  }
  function addPool(x, z, r, color, plazaCircuit = false, y = 0.012) {
    const g = planeXZ(r * 2, r * 2);
    const col = new THREE.Color(color);
    const p = g.getAttribute("position");
    const carr = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { carr[i * 3] = col.r; carr[i * 3 + 1] = col.g; carr[i * 3 + 2] = col.b; }
    g.setAttribute("color", new THREE.BufferAttribute(carr, 3));
    g.translate(x, y, z);
    (plazaCircuit ? poolPlaza : poolStatic).push(g);
  }
  function sodiumPole(lp) {
    const [x, y, z] = lp.pos;
    poleGeos.push(boxGeo([x - 0.09, 0, z - 0.09], [x + 0.09, y, z + 0.09]));
    const ax = lp.aim ? lp.aim[0] : x, az = lp.aim ? lp.aim[2] : z;
    const dx = Math.sign(ax - x) * 0.55, dz = Math.sign(az - z) * 0.55;
    poleGeos.push(boxGeo([Math.min(x, x + dx) - 0.05, y - 0.12, Math.min(z, z + dz) - 0.05],
      [Math.max(x, x + dx) + 0.05, y - 0.04, Math.max(z, z + dz) + 0.05]));
    const hx = x + dx, hz = z + dz;
    headGeos.push(boxGeo([hx - 0.22, y - 0.3, hz - 0.22], [hx + 0.22, y - 0.05, hz + 0.22]));
    return { hx, hz, headY: y - 0.3 };
  }

  // Intensities re-tuned against live captures (iter00): with the doubled
  // additive glow/pool wash removed, the REAL spots have to carry the LD
  // §3.4 zone plan — plaza is the 100% money zone, floods 80%, pockets dim.
  const specById = {
    L_QUAY: { intensity: 38, distance: 18, penumbra: 0.42 },
    L_ALLEY_A: { intensity: 34, distance: 15, penumbra: 0.45 },
    L_PLAZA_KEY: { intensity: 130, distance: 26, penumbra: 0.55 },
    L_ARCADE_SKY: { intensity: 34, distance: 14, penumbra: 0.3 },
    L_BLVD_1: { intensity: 34, distance: 16, penumbra: 0.42 },
    L_BLVD_3: { intensity: 34, distance: 16, penumbra: 0.42 },
    L_FLOOD_W: { intensity: 110, distance: 34, penumbra: 0.35 },
    L_FLOOD_E: { intensity: 110, distance: 34, penumbra: 0.35 },
  };
  const staticLightSpecs = [];

  for (const lp of layout.lightPoles) {
    const [x, y, z] = lp.pos;
    const reg = { emissives: [], sprites: [] };
    registry.practicals[lp.id] = reg;
    if (lp.real) {
      staticLightSpecs.push({
        kind: "spot", id: lp.id, pos: lp.pos.slice(), aim: (lp.aim || [x, 0, z]).slice(),
        color: lp.color, angleDeg: lp.cone || 50, godRay: !!lp.godRay,
        blackout: lp.blackout || null, ...specById[lp.id],
      });
    }
    switch (lp.kind) {
      case "sodium": {
        // head glow comes from lighting.js's instanced glow pass — a second
        // sprite here doubled every halo (the iter01 S4 orange-soup tell)
        const h = sodiumPole(lp);
        const lensMat = sodiumHead;
        reg.emissives.push(lensMat);
        void h;
        addPool(lp.aim ? lp.aim[0] : x, lp.aim ? lp.aim[2] : z, 2.8, lp.color, false);
        break;
      }
      case "flood": {
        // towers are props; lighting.js draws the head glow — pools only here
        addPool(lp.aim[0], lp.aim[2], 5.0, lp.color, false);
        break;
      }
      case "skylight": {
        const rim = M.emissive(0x7c8fb8, 1.1);
        const rg = new THREE.PlaneGeometry(6.2, 6.2);
        rg.rotateX(Math.PI / 2); // faces down into the lightwell
        rg.translate(-32, 8.13, -8);
        const rmesh = new THREE.Mesh(rg, rim);
        rmesh.name = "skylight_glow";
        group.add(rmesh);
        reg.emissives.push(rim);
        addPool(-32, -8, 2.4, lp.color, false, 0.02);
        break;
      }
      case "fluorescent": {
        const tube = new THREE.CylinderGeometry(0.035, 0.035, 9, 6);
        tube.rotateZ(Math.PI / 2);
        tube.translate(x, y, z);
        const tm = new THREE.Mesh(tube, fluorMat);
        tm.name = "platform_fluor";
        group.add(tm);
        reg.emissives.push(fluorMat); // head glow: lighting.js instanced pass
        addPool(x, z, 3.4, lp.color, false, 4.512); // pools ON the deck (y 4.5)
        if (lp.flicker) registry.flicker.push({ mat: fluorMat, base: 2.6 });
        break;
      }
      case "interior": { // gatehouse — lit window on the yard-facing east face
        const wg = new THREE.PlaneGeometry(0.9, 1.0);
        wg.rotateY(Math.PI / 2);
        wg.translate(11.03, 1.7, -52.5); // gatehouse box x[5,11] z[-55,-50]
        // lit-cell UVs (cell 1, top row of the 4×2 window atlas)
        const uvw = wg.getAttribute("uv");
        for (let i = 0; i < uvw.count; i++) uvw.setXY(i, (1 + uvw.getX(i)) / 4, 0.5 + uvw.getY(i) / 2);
        const wmesh = new THREE.Mesh(wg, M.windowLit);
        wmesh.name = "gatehouse_window";
        group.add(wmesh);
        addPool(12.2, -52.5, 2.0, lp.color, false); // glow: lighting.js pass
        break;
      }
      case "neon_bounce": break; // L_PLAZA_KEY — aggregate; signs are the visuals
      case "neon": break;        // built in the signage pass below
    }
  }

  // pole + head merged meshes
  if (poleGeos.length) {
    const pm = new THREE.Mesh(mergeGeometries(poleGeos, false), M.metal);
    pm.name = "lamp_poles";
    pm.castShadow = true;
    group.add(pm);
  }
  if (headGeos.length) {
    const hm = new THREE.Mesh(mergeGeometries(headGeos, false), sodiumHead);
    hm.name = "lamp_heads";
    group.add(hm);
  }

  // hanging catenary lamps (plaza 6 + quay 2)
  {
    const shades = [], bulbsLit = [], bulbsDead = [];
    for (const l of lampSpots) {
      const cone = new THREE.CylinderGeometry(0.06, 0.24, 0.22, 10, 1, true);
      cone.translate(l.x, l.y + 0.1, l.z);
      worldUV(cone);
      shades.push(cone);
      const bulb = new THREE.SphereGeometry(0.055, 8, 6);
      bulb.translate(l.x, l.y - 0.02, l.z);
      (l.lit ? bulbsLit : bulbsDead).push(bulb);
      if (l.lit) {
        addGlow(l.x, l.y - 0.05, l.z, 0xffc88a, 1.3, 0.38);
        addPool(l.x, l.z, 2.4, 0xffc88a, !!l.plaza);
      }
    }
    const sm = new THREE.Mesh(mergeGeometries(shades, false), M.metal);
    sm.name = "lamp_shades";
    group.add(sm);
    if (bulbsLit.length) {
      const bm = new THREE.Mesh(mergeGeometries(bulbsLit, false), warmBulb);
      bm.name = "lamp_bulbs_lit";
      group.add(bm);
      registry.blackout.emissiveMats.push(warmBulb);
    }
    if (bulbsDead.length) {
      const bd = new THREE.Mesh(mergeGeometries(bulbsDead, false), M.plasticDark);
      bd.name = "lamp_bulbs_dead";
      group.add(bd);
    }
  }

  // ---- neon signage wall (LD §3.3 invented brands — the S3 hero backdrop).
  // FIXTURES, not floating glyphs (iter01 S1 tell): each sign is an emissive
  // face inside a metal cabinet flush-mounted on the gallery wall (LD §4.1
  // rule 5), with a frame, a mount plate, and an additive spill pool on the
  // LOCAL WALL (so the sign visibly lights the surface that carries it) plus
  // the ground pool. All spill dies with the plaza circuit in the blackout.
  {
    const wallFaceX = 15.5; // gallery west wall (layout: gallery X 15.5..24.5)
    const housingGeos = [], frameGeos = [], plateGeos = [];
    const wallPoolQ = [];
    const wallPool = (x, y, z, w, h, color) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(-Math.PI / 2);
      g.translate(x, y, z);
      const col = new THREE.Color(color);
      const p = g.getAttribute("position");
      const carr = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { carr[i * 3] = col.r; carr[i * 3 + 1] = col.g; carr[i * 3 + 2] = col.b; }
      g.setAttribute("color", new THREE.BufferAttribute(carr, 3));
      wallPoolQ.push(g);
    };
    for (const lp of layout.lightPoles) {
      if (lp.kind !== "neon") continue;
      const [x, y, z] = lp.pos;
      const text = lp.sign || "ZAROV";
      const wdt = Math.max(1.6, text.length * 0.42), hgt = text === "+" ? 1.4 : 0.95;
      const faceX = x - 0.09; // sign face proud of the cabinet front
      // cabinet: from the wall face out to the sign plane
      housingGeos.push(boxGeo([faceX + 0.015, y - hgt / 2 - 0.09, z - wdt / 2 - 0.11],
        [wallFaceX + 0.02, y + hgt / 2 + 0.09, z + wdt / 2 + 0.11]));
      // mount plate: slightly larger, flush against the wall
      plateGeos.push(boxGeo([wallFaceX - 0.015, y - hgt / 2 - 0.16, z - wdt / 2 - 0.18],
        [wallFaceX + 0.035, y + hgt / 2 + 0.16, z + wdt / 2 + 0.18]));
      // frame lips around the face
      const fx0 = faceX - 0.015, fx1 = faceX + 0.05;
      frameGeos.push(boxGeo([fx0, y + hgt / 2 + 0.03, z - wdt / 2 - 0.11], [fx1, y + hgt / 2 + 0.09, z + wdt / 2 + 0.11]));
      frameGeos.push(boxGeo([fx0, y - hgt / 2 - 0.09, z - wdt / 2 - 0.11], [fx1, y - hgt / 2 - 0.03, z + wdt / 2 + 0.11]));
      frameGeos.push(boxGeo([fx0, y - hgt / 2 - 0.09, z - wdt / 2 - 0.11], [fx1, y + hgt / 2 + 0.09, z - wdt / 2 - 0.05]));
      frameGeos.push(boxGeo([fx0, y - hgt / 2 - 0.09, z + wdt / 2 + 0.05], [fx1, y + hgt / 2 + 0.09, z + wdt / 2 + 0.11]));
      const tex = new THREE.CanvasTexture(makeNeonCanvas(text, lp.color, text === "+" ? 128 : 512, 128));
      tex.colorSpace = THREE.SRGBColorSpace;
      const nm = new THREE.MeshStandardMaterial({
        color: 0x060708, roughness: 0.5, metalness: 0,
        emissive: 0xffffff, emissiveIntensity: 4.6, emissiveMap: tex, map: tex,
      });
      const sg = new THREE.PlaneGeometry(wdt, hgt);
      sg.rotateY(-Math.PI / 2);
      sg.translate(faceX, y, z);
      const sMesh = new THREE.Mesh(sg, nm);
      sMesh.name = `neon_${lp.id}`;
      group.add(sMesh);
      const glow = addGlow(faceX - 0.4, y, z, lp.color, Math.max(1.6, wdt * 0.6), 0.22);
      registry.practicals[lp.id] = { emissives: [nm], sprites: [glow] };
      registry.blackout.emissiveMats.push(nm);
      registry.blackout.sprites.push(glow);
      // spill: local wall pool (1.5 cm proud of the wall) + plaza ground pool
      wallPool(wallFaceX - 0.015, y, z, wdt + 2.6, hgt + 2.3, lp.color);
      addPool(x - 2.0, z, 2.6, lp.color, true);
    }
    if (housingGeos.length) {
      const hm = new THREE.Mesh(mergeGeometries(housingGeos, false), M.metal);
      hm.name = "neon_housings";
      hm.castShadow = true;
      group.add(hm);
      const fm = new THREE.Mesh(mergeGeometries(frameGeos, false), M.trim);
      fm.name = "neon_frames";
      group.add(fm);
      const pm2 = new THREE.Mesh(mergeGeometries(plateGeos, false), M.plasticDark);
      pm2.name = "neon_plates";
      group.add(pm2);
    }
    if (wallPoolQ.length) {
      const mat = M.poolMat(0xffffff, 0.16);
      mat.vertexColors = true;
      const m = new THREE.Mesh(mergeGeometries(wallPoolQ, false), mat);
      m.name = "neon_wall_pools";
      m.renderOrder = 2;
      group.add(m);
      registry.blackout.sprites.push(mat); // dies with the plaza circuit
    }
  }

  // ---- painted signs (invented brands only — LD §7 IP hygiene)
  {
    const signs = [
      { lines: ["MERIDIAN WARD", "МЕРИДИАН"], fg: "#d8d2c0", bg: "#2e3438", pos: [-25.03, 5.8, -6], ry: Math.PI / 2, w: 2.6, h: 1.0 },
      { lines: ["PALE LANTERN", "ПАССАЖ"], fg: "#e8d8b0", bg: "#463a2e", pos: [-25.03, 3.1, -12], ry: Math.PI / 2, w: 2.2, h: 0.9 },
      { lines: ["ZAROV FREIGHT", "ГРУЗОВОЙ ПОРТ"], fg: "#c8ccd0", bg: "#33393e", pos: [-14, 7.2, 42.03], ry: 0, w: 3.4, h: 1.1 },
      { lines: ["CUSTOMS", "ZONE 9"], fg: "#d9a441", bg: "#2a2e33", pos: [14, 4.2, -57.94], ry: 0, w: 2.4, h: 1.2 },
      { lines: ["TANNERY LANE"], fg: "#b8b2a2", bg: "#3a3632", pos: [-41.03, 4.6, 8], ry: -Math.PI / 2, w: 2.0, h: 0.7 },
      { lines: ["GATE 9"], fg: "#dcdcd4", bg: "#5a2e2a", pos: [0, 3.6, -58.92], ry: 0, w: 1.8, h: 0.6 },
    ];
    for (const s of signs) {
      const tex = new THREE.CanvasTexture(makeSignCanvas(s.lines, s.fg, s.bg));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 });
      const g = new THREE.PlaneGeometry(s.w, s.h);
      if (s.ry) g.rotateY(s.ry);
      g.translate(...s.pos);
      const m = new THREE.Mesh(g, mat);
      m.name = "sign";
      group.add(m);
    }
    // arcade hanging shop signs ×6 — the LD §3.4 "warm tungsten stalls" 25%
    // interior read: lit sign faces + a warm bulb glow + a floor pool each
    // (iter00 S4: the interior was pitch black around the skylight shaft)
    const shopNames = [["ЧАЙ • KAVA"], ["ТКАНИ"], ["REMONT"], ["ЛАВКА 12"], ["РЫБА"], ["FOTO ZAROV"]];
    for (let i = 0; i < 6; i++) {
      const x = -37.5 + (i % 3) * 4.2, z = i < 3 ? -15.5 : 1.2;
      const tex = new THREE.CanvasTexture(makeSignCanvas(shopNames[i], "#e0cfa8", "#332b22", 256, 96));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.8, metalness: 0,
        emissive: 0xffc88a, emissiveIntensity: 0.85, emissiveMap: tex,
      });
      const g = new THREE.PlaneGeometry(1.2, 0.45);
      g.translate(x, 3.15, z);
      const m = new THREE.Mesh(g, mat);
      m.name = "shop_sign";
      group.add(m);
      const hang = boxGeo([x - 0.02, 3.38, z - 0.02], [x + 0.02, 3.95, z + 0.02]);
      const hm = new THREE.Mesh(hang, M.trim);
      group.add(hm);
      addGlow(x, 3.0, z + 0.12, 0xffc88a, 0.9, 0.3);
      addPool(x, z + 0.4, 1.7, 0xffc88a, false, 0.014);
    }
  }

  // ---- car headlights + alarm blink dots (from layout prop flags)
  {
    for (const p of layout.props) {
      if (p.flags && p.flags.headlights) {
        const [x, , z] = p.pos;
        // abandoned car beams into the rain (LD §3.3) — pure glow cards,
        // pinned tight to the lamp housings so they read as headlights
        addGlow(x - 0.62, 0.68, z + 2.05, 0xfff2cc, 1.0, 0.45);
        addGlow(x + 0.62, 0.68, z + 2.05, 0xfff2cc, 1.0, 0.45);
        addPool(x, z + 3.8, 2.8, 0xfff2cc, false);
      }
      if (p.flags && p.flags.alarmBlink) {
        const s = addGlow(p.pos[0], 1.02, p.pos[2], 0xff3020, 0.34, 0.85);
        registry.flicker.push({ sprite: s, blink: 1.35, base: 0.85 });
      }
    }
  }

  // pool decal meshes (vertex-colored, one static + one plaza-circuit)
  {
    if (poolStatic.length) {
      // 0.18: at 0.3 the sodium ground pools stacked with lighting.js's fog
      // discs + the real spot into the iter01 S4 orange-soup wash
      const mat = M.poolMat(0xffffff, 0.18);
      mat.vertexColors = true;
      const m = new THREE.Mesh(mergeGeometries(poolStatic, false), mat);
      m.name = "light_pools";
      m.renderOrder = 2;
      group.add(m);
    }
    if (poolPlaza.length) {
      const mat = M.poolMat(0xffffff, 0.18);
      mat.vertexColors = true;
      const m = new THREE.Mesh(mergeGeometries(poolPlaza, false), mat);
      m.name = "light_pools_plaza";
      m.renderOrder = 2;
      group.add(m);
      registry.blackout.poolMesh = m;
    }
  }

  // ============================================================ 7. DECALS
  {
    const groundQ = [], wallQ = [];
    const dr = rng(6001);
    const gq = (x, z, r, kind, ry = dr() * Math.PI * 2, y = 0.016) => {
      const g = planeXZ(r * 2, r * 2);
      g.rotateY(ry);
      g.translate(x, y, z);
      setCellUV(g, DECAL_UV[kind]);
      groundQ.push(g);
    };
    const wq = (x, y, z, w, h, ry, kind) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(ry);
      g.translate(x, y, z);
      setCellUV(g, DECAL_UV[kind]);
      wallQ.push(g);
    };
    // oil stains — boulevard car edges + customs truck lane
    for (const [x, z] of [[30.5, 3], [44, -10], [30.4, -20], [44.2, 14], [-12, -50], [14, -47], [4, -42], [30.5, 30]]) {
      gq(x + (dr() - 0.5), z + (dr() - 0.5) * 2, 1.1 + dr() * 0.8, "oil_stain");
    }
    // scattered paper — plaza ×10, boulevard drift ×8 (LD §4.2)
    for (let i = 0; i < 10; i++) gq(-20 + dr() * 33, -16 + dr() * 32, 0.65, "paper");
    for (let i = 0; i < 8; i++) gq(29 + dr() * 16, -38 + dr() * 76, 0.6, "paper");
    // cracks
    for (const [x, z] of [[-10, -6], [6, 8], [-18, 4], [9, -12]]) gq(x, z, 1.5, "crack");
    for (const [x, z] of [[-50, 20], [-46, 2], [-52, -8]]) gq(x, z, 1.3, "crack");
    for (const [x, z] of [[-4, -44], [10, -52], [20, -44]]) gq(x, z, 1.4, "crack");
    for (const [x, z] of [[-40, 47], [10, 49]]) gq(x, z, 1.6, "crack");
    // tide marks around the hero puddles (VT: wetness must READ, not just darken)
    for (const h of layout.terrain.heroPuddles) gq(h.pos[0], h.pos[1], h.r * 1.18, "tide_ring", 0, 0.014);
    // splats near dumpsters
    for (const p of layout.props) {
      if (p.kind === "dumpster") gq(p.pos[0] + (dr() - 0.5) * 2, p.pos[2] + (dr() - 0.5) * 2, 0.9, "splat");
    }
    // rust streaks under every pole bracket (LD §4.1 rule 3)
    for (const lp of layout.lightPoles) {
      if (lp.kind !== "sodium") continue;
      const [x, y, z] = lp.pos;
      wq(x + 0.1, y - 1.1, z, 0.5, 1.8, dr() * Math.PI * 2, "rust_streak");
    }
    // wear at door jambs (arcade east doors, gallery doors)
    wq(-24.97, 1.2, -12, 1.4, 2.2, Math.PI / 2, "wear_edge");
    wq(-24.97, 1.2, 2, 1.4, 2.2, Math.PI / 2, "wear_edge");
    wq(16.97, 1.2, 10, 1.6, 2.2, Math.PI / 2, "wear_edge");
    wq(23.03, 1.2, -30, 1.6, 2.2, -Math.PI / 2, "wear_edge");
    // splash-zone drips along the long perimeter walls (breakup per 4 m²)
    for (let x = -54; x < 54; x += 9) wq(x + dr() * 3, 1.4, -57.94, 1.2, 2.4, 0, "drip_stain");
    const gm = new THREE.Mesh(mergeGeometries(groundQ, false), M.decalMat);
    gm.name = "decals_ground";
    gm.renderOrder = 2;
    group.add(gm);
    const wm = new THREE.Mesh(mergeGeometries(wallQ, false), M.decalMat);
    wm.name = "decals_wall";
    wm.renderOrder = 2;
    group.add(wm);
  }

  // ============================================== 8. SELF-DRIVEN ANIMATION
  // Flicker/blink are cosmetic view-side effects (no sim reads, no lights).
  // A6 may take these over via registry.flicker; until then level drives them.
  {
    let t = 0;
    const drive = () => {
      t += 1 / 60;
      for (const f of registry.flicker) {
        if (f.blink) {
          f.sprite.material.opacity = (t % f.blink) < 0.12 ? f.base : 0.0;
        } else {
          const n = Math.sin(t * 31.7) * Math.sin(t * 7.3) > -0.72 ? 1 : 0.35;
          if (f.mat) f.mat.emissiveIntensity = f.base * n;
          if (f.sprite) f.sprite.material.opacity = 0.4 * n;
        }
      }
    };
    const carrier = group.children.find((c) => c.name === "walls") || group.children[0];
    if (carrier) {
      const prev = carrier.onBeforeRender;
      carrier.onBeforeRender = (...args) => { if (prev) prev(...args); drive(); };
    }
  }

  // ---------------------------------------------------------- outputs
  const rainOcclusion = [
    { id: "arcade", min: [-41, 0, -20], max: [-25, 8.2, 6], skylight: { min: [-35, -11], max: [-29, -5] } },
    { id: "gallery", min: [15.5, 0, -34], max: [24.5, 5.0, 14] },
    { id: "gatehouse", min: [5, 0, -55], max: [11, 3.2, -50] },
    { id: "platform_canopy", min: [30, 4.5, -52], max: [44, 7.3, -48] },
  ];
  group.userData.level = { practicals: registry, rainOcclusion, hooks: GROUND_HOOKS };
  return {
    group,
    staticLightSpecs,
    practicals: registry,
    rainOcclusion,
    hooks: GROUND_HOOKS,
  };
}
