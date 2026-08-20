// core/level/props.js [A3] — InstancedMesh prop batches (architecture §3.12,
// ≤40 instanced batches). Placement comes VERBATIM from layout.js
// computePlacements() — the same data tools/probe_props.mjs gates (LD §4.1:
// analytic ground raycast, 1.5 cm sink, float/clip fail, mandatory base
// decals) — so what the probe passes is exactly what renders.
//
// Mesh sources (BUILD_PLAN Part 4): Kenney/Quaternius cc0-city GLBs
// (repacked by tools/prep_level_assets.py: textures stripped, quantized)
// for vehicles + generic street furniture; disciplined procedural
// hard-surface builds for the map-specific dressing (doctrine §7 allows
// procedural props/architecture behind the visual gate). NO lights are
// created here — emissive materials + additive cards only.
//
// buildProps(layout, ctx) is SYNCHRONOUS (frozen signature): level.js
// awaits loadPropLibrary() inside buildLevel (boot awaits buildLevel before
// calling buildProps), so the GLB geometry cache is always warm here.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { computePlacements } from "./layout.js";
import { makeMaterials, DECAL_UV } from "./materials.js";

let LIB = null; // kind -> {geo, mats, size:[w,h,d]}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- helpers
// De-quantize a (possibly KHR_mesh_quantization) geometry to plain float32
// so applyMatrix4 + merge are exact.
function toFloatGeo(src) {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const size = a.itemSize, out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      out[i * size] = a.getX(i);
      if (size > 1) out[i * size + 1] = a.getY(i);
      if (size > 2) out[i * size + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  else g.setIndex([...Array(g.getAttribute("position").count).keys()]); // index parity for merges
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  return g;
}

function ensureUV(g) {
  if (!g.getAttribute("uv")) {
    const p = g.getAttribute("position");
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getZ(i); }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
  return g;
}

// Materials with the 'aowet' option read a vertex attribute; an unbound
// attribute samples (0,0,0) in WebGL2 and would multiply diffuse to black.
// Every prop geometry therefore carries a neutral aowet = (1, 0, 0).
function ensureAowet(g) {
  if (!g.getAttribute("aowet")) {
    const n = g.getAttribute("position").count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a[i * 3] = 1;
    g.setAttribute("aowet", new THREE.BufferAttribute(a, 3));
  }
  return g;
}

// merge [{geo, mat}] into ONE geometry with groups + a material array
function mergeParts(parts) {
  const byMat = new Map();
  for (const p of parts) {
    ensureUV(p.geo);
    ensureAowet(p.geo);
    if (!byMat.has(p.mat)) byMat.set(p.mat, []);
    byMat.get(p.mat).push(p.geo);
  }
  const mats = [], merged = [];
  for (const [mat, geos] of byMat) {
    mats.push(mat);
    merged.push(geos.length > 1 ? mergeGeometries(geos, false) : geos[0]);
  }
  const geo = mergeGeometries(merged, true);
  return { geo, mats };
}

// normalize a merged geometry: centre XZ, floor to y=0; return size
function normalize(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  geo.translate(-cx, -b.min.y, -cz);
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
}

const B = (mat, w, h, d, x = 0, y = 0, z = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return { geo: g, mat };
};
const CYL = (mat, rT, rB, h, x = 0, y = 0, z = 0, seg = 10) => {
  const g = new THREE.CylinderGeometry(rT, rB, h, seg);
  g.translate(x, y, z);
  return { geo: g, mat };
};
const SPH = (mat, r, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return { geo: g, mat };
};

// ------------------------------------------------------ GLB prop library
const GLB_KINDS = {
  car: "car_sedan", van: "van", truck: "truck",
  dumpster: "dumpster", crate: "crate", planter: "planter", ac_unit: "ac_unit",
};

function classifyGlbMat(kind, meshName, matName, M) {
  const n = (meshName || "").toLowerCase();
  if (n.includes("wheel")) return M.rubber;
  if (kind === "car" || kind === "van" || kind === "truck") return M.carPaint;
  if (kind === "crate") return M.wood;
  if (kind === "planter") return M.concrete;
  return M.metal; // dumpster / ac_unit / fallback
}

// The cc0-city vehicle GLBs ship ONE "body" mesh with one palette material
// (textures stripped by prep) — rendered whole with carPaint it reads as an
// untextured clay shell (iter01 S1 tell). Split the body's triangles into
// paint / glass / trim by height band + face slope so the greenhouse reads
// as dark wet glass and the skirt/bumpers as trim. Heuristic, verified
// against live captures (no part names or UVs survive the prep to split on).
function splitVehicleBody(geo, M) {
  const pos = geo.getAttribute("position");
  const idx = geo.index ? Array.from(geo.index.array) : [...Array(pos.count).keys()];
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const h = Math.max(1e-6, bb.max.y - bb.min.y);
  const out = { paint: [], glass: [], trim: [] };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t]);
    b.fromBufferAttribute(pos, idx[t + 1]);
    c.fromBufferAttribute(pos, idx[t + 2]);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac).normalize();
    const relY = ((a.y + b.y + c.y) / 3 - bb.min.y) / h;
    const ny = Math.abs(n.y);
    let bucket = "paint";
    if (relY < 0.14) {
      bucket = "trim";                       // skirt + bumper band
    } else if (relY > 0.47 && ny < 0.8) {
      // greenhouse band: vertical side/rear panes + sloped windshields;
      // roof (ny≈1) and hood/trunk (below the band) stay paint
      bucket = "glass";
    }
    out[bucket].push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const mats = { paint: M.carPaint, glass: M.carGlass, trim: M.carTrim };
  const parts = [];
  for (const k of ["paint", "glass", "trim"]) {
    if (!out[k].length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", geo.getAttribute("position"));
    if (geo.getAttribute("normal")) g.setAttribute("normal", geo.getAttribute("normal"));
    if (geo.getAttribute("uv")) g.setAttribute("uv", geo.getAttribute("uv"));
    g.setIndex(out[k]); // stays INDEXED — mergeParts requires index parity
    parts.push({ geo: g, mat: mats[k] });
  }
  return parts.length ? parts : [{ geo, mat: M.carPaint }];
}

export async function loadPropLibrary(ctx) {
  if (LIB) return LIB;
  const M = makeMaterials(ctx);
  const V = (ctx && ctx.V) || "";
  const loader = new GLTFLoader();
  LIB = {};
  await Promise.all(Object.entries(GLB_KINDS).map(async ([kind, file]) => {
    try {
      const gltf = await loader.loadAsync(`./assets/props/${file}.glb${V}`);
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      const vehicle = kind === "car" || kind === "van" || kind === "truck";
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = toFloatGeo(o.geometry);
        g.applyMatrix4(o.matrixWorld);
        const nm = (o.name || "").toLowerCase();
        if (vehicle && nm.includes("body")) {
          parts.push(...splitVehicleBody(g, M)); // paint/glass/trim (VT §3)
        } else {
          parts.push({ geo: g, mat: classifyGlbMat(kind, o.name, o.material && o.material.name, M) });
        }
      });
      if (!parts.length) throw new Error("empty GLB");
      if (kind === "ac_unit") {
        // LD §4.1 rule 5: wall-mounted props carry a flush mount plate
        const { geo: probe } = mergeParts(parts.map(p => ({ geo: p.geo.clone(), mat: p.mat })));
        probe.computeBoundingBox();
        const bb = probe.boundingBox;
        parts.push(B(M.trim, (bb.max.x - bb.min.x) * 0.9, (bb.max.y - bb.min.y) * 0.9,
          0.04, (bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.min.z + 0.02));
      }
      const { geo, mats } = mergeParts(parts);
      const size = normalize(geo);
      LIB[kind] = { geo, mats, size };
    } catch (e) {
      // honest fallback: procedural stand-in (never silent) — props are not
      // hero assets, so this is a console warning, not a ship blocker.
      console.warn(`[props] GLB '${file}' failed (${e.message}) — procedural stand-in`);
      const parts = [B(M.metal, 1, 1, 1, 0, 0.5, 0)];
      const { geo, mats } = mergeParts(parts);
      LIB[kind] = { geo, mats, size: normalize(geo) };
    }
  }));
  return LIB;
}

// ------------------------------------------------- procedural kind builds
// Each returns [{geo, mat}] built at the LAYOUT footprint size (sx, h, sz)
// so per-instance scale stays ~1 (materials keep metre-true texel density).
function buildKind(kind, s, M) {
  const [w, h, d] = s;
  switch (kind) {
    case "barrier": { // jersey profile: tapered extrusion
      const shape = new THREE.Shape();
      const b = d / 2, t = d * 0.24, kY = h * 0.28;
      shape.moveTo(-b, 0); shape.lineTo(b, 0); shape.lineTo(b * 0.82, kY);
      shape.lineTo(t, h * 0.92); shape.lineTo(t * 0.8, h); shape.lineTo(-t * 0.8, h);
      shape.lineTo(-t, h * 0.92); shape.lineTo(-b * 0.82, kY); shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      return [{ geo: g, mat: M.concreteWall }];
    }
    case "sandbags": {
      const parts = [];
      const r = rng(11);
      const bw = w / 2.2, bd = d / 1.4;
      for (let row = 0; row < 3; row++) {
        const n = row === 2 ? 1 : 2;
        for (let i = 0; i < n; i++) {
          parts.push(SPH(M.burlap, 0.5,
            (i - (n - 1) / 2) * bw + (r() - 0.5) * 0.06,
            h * (0.18 + row * 0.3), (r() - 0.5) * 0.12,
            bw * 1.05, h * 0.42, bd));
        }
      }
      return parts;
    }
    case "kiosk": {
      const parts = [];
      parts.push(B(M.woodDark, w * 0.92, h * 0.62, d * 0.92, 0, h * 0.31, 0));     // body
      parts.push(B(M.wood, w * 0.98, 0.06, d * 0.98, 0, h * 0.64, 0));             // counter
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        parts.push(B(M.trim, 0.07, h, 0.07, sx * w * 0.44, h / 2, sz * d * 0.44)); // posts
      const awn = new THREE.BoxGeometry(w * 1.16, 0.035, d * 0.7);
      awn.rotateX(-0.28);
      awn.translate(0, h * 0.96, d * 0.34);
      const awnMat = new THREE.MeshStandardMaterial({
        map: M.awning[0], color: 0xd8d8d8, roughness: 0.75, metalness: 0,
      });
      parts.push({ geo: awn, mat: awnMat });
      // kiosk string bulbs (2400 K, fake — LD §3.3)
      const bulbMat = M.emissive(0xffb46b, 2.4);
      for (let i = 0; i < 4; i++)
        parts.push(SPH(bulbMat, 0.03, (i - 1.5) * w * 0.26, h * 0.9, d * 0.52));
      return parts;
    }
    case "stall": { // arcade shuttered shop stall
      const parts = [];
      parts.push(B(M.woodDark, w, 0.08, d, 0, h - 0.04, 0));                       // top
      parts.push(B(M.woodDark, w, 0.1, d, 0, 0.05, 0));                            // base
      parts.push(B(M.corrugated, w * 0.94, h - 0.2, 0.04, 0, h / 2, d * 0.28));    // shutter
      for (const sx of [-1, 1]) parts.push(B(M.wood, 0.08, h, d, sx * (w / 2 - 0.04), h / 2, 0));
      return parts;
    }
    case "bollard":
      return [CYL(M.metal, w * 0.4, w * 0.46, h * 0.9, 0, h * 0.45, 0),
              SPH(M.metal, w * 0.4, 0, h * 0.9, 0, 1, 0.6, 1)];
    case "pallet": {
      const parts = [];
      for (let i = 0; i < 5; i++)
        parts.push(B(M.wood, w, 0.02 + 0.02, d / 7, 0, h * 0.16, (i - 2) * d / 5));
      for (const sx of [-1, 0, 1]) parts.push(B(M.woodDark, w / 9, h * 0.14, d, sx * w * 0.42, h * 0.07, 0));
      parts.push(B(M.wood, w, 0.04, d, 0, h * 0.2, 0));
      // half-height crate stack on top reads as "pallet stack" (LD)
      parts.push(B(M.woodDark, w * 0.8, h * 0.7, d * 0.8, 0, h * 0.22 + h * 0.35, 0));
      return parts;
    }
    case "newsbox":
      return [
        B(M.plasticDark, w, h * 0.82, d, 0, h * 0.59, 0),
        B(M.glass, w * 0.8, h * 0.3, 0.02, 0, h * 0.62, d / 2),
        B(M.metal, w * 0.8, h * 0.18, d * 0.8, 0, h * 0.09, 0),
      ];
    case "trash_bags": {
      const parts = []; const r = rng(5);
      for (let i = 0; i < 3; i++) {
        parts.push(SPH(M.trashBag, 0.5, (r() - 0.5) * w * 0.5, h * 0.35 * (0.8 + r() * 0.4),
          (r() - 0.5) * d * 0.5, w * 0.42, h * 0.62, d * 0.42));
      }
      parts.push(B(M.woodDark, w * 0.5, h * 0.3, d * 0.32, w * 0.22, h * 0.15, -d * 0.2, 0.4)); // cardboard
      return parts;
    }
    case "steam_vent":
      return [
        CYL(M.steel, w * 0.5, w * 0.55, h, 0, h / 2, 0, 12),
        CYL(M.metal, w * 0.34, w * 0.34, h + 0.012, 0, (h + 0.012) / 2, 0, 12),
      ];
    case "bench": {
      // built long-axis X; the instance loop's proportion-swap orients it
      const along = Math.max(w, d), across = Math.min(w, d);
      const parts = [];
      for (let i = 0; i < 3; i++)
        parts.push(B(M.woodDark, along, 0.04, across / 3.6, 0, h * 0.52, (i - 1) * across / 3.2));
      for (const sx of [-1, 1])
        parts.push(B(M.metal, 0.05, h * 0.5, across * 0.8, sx * along * 0.4, h * 0.25, 0));
      parts.push(B(M.woodDark, along, 0.04, 0.05, 0, h * 0.86, -across * 0.4)); // backrest
      return parts;
    }
    case "shelving": {
      const parts = [];
      for (let i = 0; i < 4; i++) parts.push(B(M.metal, w, 0.03, d, 0, 0.1 + i * (h - 0.15) / 3, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        parts.push(B(M.metal, 0.04, h, 0.04, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02)));
      const r = rng(31);
      for (let i = 0; i < 5; i++)
        parts.push(B(M.woodDark, 0.2 + r() * 0.2, 0.15 + r() * 0.2, Math.min(d * 0.8, 0.3),
          (r() - 0.5) * w * 0.7, 0.12 + (i % 3) * (h - 0.15) / 3 + 0.12, 0));
      return parts;
    }
    case "rope":
      return [(() => {
        const g = new THREE.TorusGeometry(w * 0.42, w * 0.16, 6, 14);
        g.rotateX(Math.PI / 2);
        g.translate(0, h * 0.5, 0);
        return { geo: g, mat: M.burlap };
      })()];
    case "scaffold": {
      const parts = [];
      const levels = Math.max(2, Math.round(h / 2));
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        parts.push(CYL(M.steel, 0.035, 0.035, h, sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05), 6));
      for (let l = 1; l <= levels; l++) {
        const y = (h / levels) * l - 0.05;
        parts.push(B(M.wood, w, 0.05, d, 0, y, 0));
        parts.push(B(M.steel, 0.04, 0.04, d, w / 2 - 0.05, y - 0.5, 0)); // brace
      }
      // tarp wrap on one face (LD: scaffold bays with tarps)
      parts.push(B(M.tarp, 0.02, h * 0.7, d * 0.96, -w / 2 + 0.01, h * 0.5, 0));
      return parts;
    }
    case "phone_booth":
      return [
        B(M.metal, w, 0.1, d, 0, 0.05, 0),
        B(M.metal, w, 0.25, d, 0, h - 0.13, 0),
        B(M.glass, 0.02, h - 0.5, d * 0.86, w / 2 - 0.02, h / 2 - 0.1, 0),
        B(M.glass, 0.02, h - 0.5, d * 0.86, -w / 2 + 0.02, h / 2 - 0.1, 0),
        B(M.glass, w * 0.86, h - 0.5, 0.02, 0, h / 2 - 0.1, -d / 2 + 0.02),
        B(M.metal, 0.06, h, 0.06, w / 2 - 0.04, h / 2, d / 2 - 0.04),
        B(M.metal, 0.06, h, 0.06, -w / 2 + 0.04, h / 2, d / 2 - 0.04),
        B(M.plasticDark, w * 0.5, 0.5, 0.12, 0, h * 0.55, -d / 2 + 0.1),
      ];
    case "ticket_machine":
      return [
        B(M.metal, w, h * 0.95, d, 0, h * 0.48, 0),
        { geo: (() => { const g = new THREE.PlaneGeometry(w * 0.6, h * 0.2); g.translate(0, h * 0.68, d / 2 + 0.005); return g; })(),
          mat: M.emissive(0x39424e, 0.6) },
        B(M.plasticDark, w * 0.7, h * 0.16, 0.03, 0, h * 0.4, d / 2 + 0.01),
      ];
    case "route_board":
      return [
        CYL(M.metal, 0.04, 0.04, h, -w * 0.35, h / 2, 0, 8),
        CYL(M.metal, 0.04, 0.04, h, w * 0.35, h / 2, 0, 8),
        B(M.plasticDark, w, h * 0.5, 0.06, 0, h * 0.7, 0),
      ];
    case "bin":
      return [CYL(M.metal, w * 0.5, w * 0.42, h, 0, h / 2, 0, 12),
              CYL(M.plasticDark, w * 0.52, w * 0.52, 0.06, 0, h - 0.03, 0, 12)];
    case "guard_hut":
      return [
        B(M.corrugated, w, h * 0.92, d, 0, h * 0.46, 0),
        B(M.metal, w * 1.08, 0.08, d * 1.08, 0, h * 0.96, 0),
        B(M.glass, w * 0.55, h * 0.3, 0.02, 0, h * 0.62, d / 2 + 0.005),
      ];
    case "fuel_drums": {
      const parts = []; const r = rng(77);
      const pos = [[-w * 0.26, -d * 0.2], [w * 0.24, -d * 0.22], [-w * 0.1, d * 0.24], [w * 0.3, d * 0.2]];
      for (const [x, z] of pos) {
        const drumMat = new THREE.MeshStandardMaterial({
          color: [0x6e3a2a, 0x54513e, 0x3e4854, 0x6e3a2a][(r() * 4) | 0],
          roughness: 0.55, metalness: 0.0,
        });
        parts.push(CYL(drumMat, 0.29, 0.29, h, x, h / 2, z, 12));
        parts.push(CYL(M.metal, 0.3, 0.3, 0.02, x, h * 0.33, z, 12));
        parts.push(CYL(M.metal, 0.3, 0.3, 0.02, x, h * 0.66, z, 12));
      }
      return parts;
    }
    case "flood_tower": {
      const parts = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        parts.push(CYL(M.steel, 0.05, 0.07, h, sx * w * 0.36, h / 2, sz * d * 0.36, 6));
      for (let l = 1; l < 4; l++) {
        parts.push(B(M.steel, w * 0.78, 0.05, 0.05, 0, (h / 4) * l, d * 0.36));
        parts.push(B(M.steel, w * 0.78, 0.05, 0.05, 0, (h / 4) * l, -d * 0.36));
        parts.push(B(M.steel, 0.05, 0.05, d * 0.78, w * 0.36, (h / 4) * l, 0));
        parts.push(B(M.steel, 0.05, 0.05, d * 0.78, -w * 0.36, (h / 4) * l, 0));
      }
      parts.push(B(M.metal, w * 1.1, 0.08, d * 1.1, 0, h - 0.04, 0));               // head platform
      const lensMat = M.emissive(0xdce8ff, 5.0);
      for (const sx of [-0.28, 0.28]) {
        parts.push(B(M.metal, 0.34, 0.3, 0.24, sx * w, h + 0.14, 0));                // housings
        const lens = new THREE.PlaneGeometry(0.28, 0.24);
        lens.rotateX(-Math.PI / 2 + 0.9);                                            // aimed down-south
        lens.translate(sx * w, h + 0.1, 0.16);
        parts.push({ geo: lens, mat: lensMat });
      }
      return parts;
    }
    case "tram_shelter": {
      const along = Math.max(w, d), rot = d >= w ? 0 : Math.PI / 2;
      return [
        B(M.steel, 0.07, h, 0.07, -w * 0.42, h / 2, -d * 0.42),
        B(M.steel, 0.07, h, 0.07, -w * 0.42, h / 2, d * 0.42),
        B(M.steel, 0.07, h, 0.07, w * 0.42, h / 2, -d * 0.42),
        B(M.steel, 0.07, h, 0.07, w * 0.42, h / 2, d * 0.42),
        B(M.glass, 0.02, h * 0.7, d * 0.9, -w * 0.42, h * 0.45, 0),
        B(M.glass, w * 0.9, h * 0.7, 0.02, 0, h * 0.45, -d * 0.42),
        B(M.plasticDark, w * 1.1, 0.05, d * 1.15, 0, h - 0.02, 0),
        B(M.woodDark, w * 0.7, 0.05, 0.3, 0, h * 0.34, d * 0.1),
      ];
    }
    case "fence": { // chain-link panel run (q_gate)
      const parts = [];
      const posts = Math.max(2, Math.round(w / 2));
      for (let i = 0; i <= posts; i++)
        parts.push(CYL(M.steel, 0.03, 0.03, h, -w / 2 + (w / posts) * i, h / 2, 0, 6));
      parts.push(B(M.steel, w, 0.04, 0.04, 0, h - 0.02, 0));
      const mesh = new THREE.PlaneGeometry(w, h * 0.94);
      mesh.translate(0, h * 0.48, 0);
      const linkMat = new THREE.MeshStandardMaterial({
        color: 0x3a3e42, roughness: 0.6, metalness: 1.0,
        transparent: true, opacity: 0.42, side: THREE.DoubleSide,
      });
      parts.push({ geo: mesh, mat: linkMat });
      return parts;
    }
    case "transformer_pole": {
      const parts = [
        CYL(M.woodDark, 0.14, 0.18, h, 0, h / 2, 0, 8),
        B(M.woodDark, 1.4, 0.1, 0.1, 0, h * 0.92, 0),
        CYL(M.metal, 0.22, 0.24, 0.75, 0.35, h * 0.78, 0, 10),   // transformer can
        CYL(M.plasticDark, 0.05, 0.05, 0.16, -0.4, h * 0.95, 0, 6),
        CYL(M.plasticDark, 0.05, 0.05, 0.16, 0.1, h * 0.95, 0, 6),
      ];
      return parts;
    }
    case "table": // CINDERLOCK handoff table (beat 4)
      return [
        B(M.woodDark, w, 0.05, d, 0, h - 0.03, 0),
        B(M.woodDark, 0.06, h - 0.05, 0.06, w / 2 - 0.05, (h - 0.05) / 2, d / 2 - 0.05),
        B(M.woodDark, 0.06, h - 0.05, 0.06, -w / 2 + 0.05, (h - 0.05) / 2, d / 2 - 0.05),
        B(M.woodDark, 0.06, h - 0.05, 0.06, w / 2 - 0.05, (h - 0.05) / 2, -d / 2 + 0.05),
        B(M.woodDark, 0.06, h - 0.05, 0.06, -w / 2 + 0.05, (h - 0.05) / 2, -d / 2 + 0.05),
        B(M.plasticDark, 0.55, 0.16, 0.38, 0.1, h + 0.08, 0),    // the case
        { geo: (() => { const g = new THREE.PlaneGeometry(0.04, 0.04); g.rotateX(-Math.PI / 2); g.translate(0.28, h + 0.165, 0.1); return g; })(),
          mat: M.emissive(0x46ff8a, 3.0) },                      // status LED
      ];
    case "chairs": {
      const parts = []; const r = rng(3);
      for (let i = 0; i < 4; i++) {
        const y = i * (h / 4.4);
        parts.push(B(M.plasticDark, w * 0.8, 0.05, d * 0.8, (r() - 0.5) * 0.06, y + 0.25, (r() - 0.5) * 0.06));
        parts.push(B(M.plasticDark, w * 0.8, h / 4, 0.05, 0, y + 0.36, -d * 0.36));
      }
      return parts;
    }
    case "ceiling_fan":
      return [
        CYL(M.plasticDark, 0.05, 0.05, 0.22, 0, h - 0.11, 0, 8),
        CYL(M.plasticDark, 0.09, 0.09, 0.08, 0, h * 0.4, 0, 10),
        B(M.woodDark, w * 0.96, 0.02, 0.12, 0, h * 0.36, 0),
        B(M.woodDark, 0.12, 0.02, w * 0.96, 0, h * 0.36, 0),
      ];
    case "mop_bucket":
      return [CYL(M.plasticDark, w * 0.5, w * 0.4, h * 0.8, 0, h * 0.4, 0, 10),
              CYL(M.metal, 0.02, 0.02, h * 1.6, w * 0.3, h * 0.8, 0, 6)];
    case "breaker_box":
      return [B(M.metal, w, h, d, 0, h / 2, 0),
              B(M.trim, w * 0.8, h * 0.8, 0.015, 0, h / 2, d / 2)];
    default:
      return [B(M.metal, w, h, d, 0, h / 2, 0)];
  }
}

// per-kind instance tint palettes (deterministic — battery-stable)
const PALETTES = {
  car: [0x6a7076, 0x4a4f55, 0x5c5348, 0x3c434c, 0x565049, 0x4e565e],
  van: [0x707478, 0x5a5f52],
  truck: [0x4e5450, 0x5a534a],
  dumpster: [0x3e5244, 0x37454e, 0x4e463c],
  crate: [0xa89678, 0x968468, 0xb0a088],
  trash_bags: [0xffffff, 0xd8d8e0, 0xc8ccc8],
  kiosk: [0xffffff, 0xe8e0d4, 0xd8dce0],
  stall: [0xffffff, 0xe0d8cc, 0xccd4d8],
};

// ---------------------------------------------------------------- build
export function buildProps(layout, ctx) {
  const M = makeMaterials(ctx);
  const group = new THREE.Group();
  group.name = "props";
  if (!LIB) {
    console.warn("[props] library not loaded — buildLevel must run first (boot order)");
    LIB = {};
  }
  const placements = computePlacements(layout);
  const byKind = new Map();
  for (const p of placements) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }

  const r = rng(7);
  let batches = 0;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(),
    pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const staticParts = []; // low-count kinds → one merged mesh per material

  for (const [kind, list] of byKind) {
    if (kind === "ceiling_fan") {
      // individual meshes: one fan turns slowly (LD §4.2 arcade dressing)
      for (const p of list) {
        const { geo, mats } = mergeParts(buildKind(kind, p.size, M));
        normalize(geo);
        const m = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
        m.position.set(p.pos[0], p.pos[1], p.pos[2]);
        m.name = `props_fan_${p.id}`;
        if (p.flags && p.flags.turning) {
          m.onBeforeRender = () => { m.rotation.y += 0.9 / 60; };
        }
        group.add(m);
      }
      continue;
    }
    const lib = LIB[kind];
    const proto = lib || (() => {
      const { geo, mats } = mergeParts(buildKind(kind, list[0].size, M));
      return { geo, mats, size: normalize(geo) };
    })();
    const [bw, bh, bd] = proto.size;
    const pal = PALETTES[kind];
    const instanced = list.length >= 3 || lib; // GLB kinds always instanced
    let mesh = null;
    if (instanced) {
      mesh = new THREE.InstancedMesh(proto.geo, proto.mats.length === 1 ? proto.mats[0] : proto.mats, list.length);
      mesh.name = `props_${kind}`;
      batches++;
    }
    list.forEach((p, i) => {
      let rot = p.rot, sx = p.size[0], sz = p.size[2];
      // proportion-swap fit (e.g. the gallery dumpster authored rotated 90°)
      if ((sx < sz) !== (bw < bd)) { rot += Math.PI / 2; const t = sx; sx = sz; sz = t; }
      let y = p.pos[1];
      if (p.mount === "wall" && p.flags && p.flags.n) {
        rot = Math.atan2(p.flags.n[0], p.flags.n[1]); // +z of the model faces out
      }
      q.setFromAxisAngle(up, rot);
      pos.set(p.pos[0], y, p.pos[2]);
      scl.set(sx / bw, p.size[1] / bh, sz / bd);
      mtx.compose(pos, q, scl);
      if (instanced) {
        mesh.setMatrixAt(i, mtx);
        if (pal) {
          const c = new THREE.Color(pal[(r() * pal.length) | 0]);
          c.offsetHSL(0, 0, (r() - 0.5) * 0.05);
          mesh.setColorAt(i, c);
        }
      } else {
        for (let gi = 0; gi < proto.mats.length; gi++) {
          const sub = proto.geo.clone();
          // keep only this material's group range
          const g0 = proto.geo.groups[gi];
          const idx = proto.geo.index.array.slice(g0.start, g0.start + g0.count);
          sub.setIndex(Array.from(idx));
          sub.clearGroups();
          sub.applyMatrix4(mtx);
          staticParts.push({ geo: sub, mat: proto.mats[gi] });
        }
      }
    });
    if (instanced) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Instance-aware bounds. Without this three falls back to
      // geometry.boundingSphere — the SINGLE prototype's sphere at the object
      // origin (e.g. props_van: centre 0,0.7,0 r 1.5) — for both frustum
      // culling and raycasts, while the instances themselves sit tens of
      // metres away. Batches therefore pop out whenever the origin sphere
      // leaves the frustum, and nothing can raycast them at all (verified in
      // the live scene: a screen-centre ray through a van passed straight
      // through it and hit the ground behind).
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      // turning ceiling fan / flagged animations are handled in level.js
      group.add(mesh);
    }
  }

  if (staticParts.length) {
    const byMat = new Map();
    for (const p of staticParts) {
      if (!byMat.has(p.mat)) byMat.set(p.mat, []);
      byMat.get(p.mat).push(p.geo);
    }
    for (const [mat, geos] of byMat) {
      const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
      m.name = "props_static";
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---- mandatory base decals (LD §4.1 rule 3) — ONE merged mesh
  {
    const quads = [];
    const rr = rng(23);
    for (const p of placements) {
      if (!p.baseDecal) continue;
      const cell = DECAL_UV[p.baseDecal.kind] || DECAL_UV.ao_blob;
      if (p.mount === "wall") {
        // rust/drip streak on the wall below the unit
        const n = (p.flags && p.flags.n) || [0, 1];
        const wdt = p.size[0] * 0.95, hgt = Math.min(1.3, p.pos[1]);
        const g = new THREE.PlaneGeometry(wdt, hgt);
        g.rotateY(Math.atan2(n[0], n[1]));
        g.translate(p.pos[0] + n[0] * 0.03, p.pos[1] - hgt / 2, p.pos[2] + n[1] * 0.03);
        setCellUV(g, cell);
        quads.push(g);
      } else {
        const rad = p.baseDecal.r;
        const g = new THREE.PlaneGeometry(rad * 2, rad * 2);
        g.rotateX(-Math.PI / 2);
        g.rotateY(rr() * Math.PI * 2);
        g.translate(p.pos[0], p.pos[1] + p.sink + 0.006, p.pos[2]);
        setCellUV(g, cell);
        quads.push(g);
      }
    }
    if (quads.length) {
      const dm = new THREE.Mesh(mergeGeometries(quads, false), M.decalMat);
      dm.name = "props_base_decals";
      dm.renderOrder = 2;
      group.add(dm);
    }
  }

  // ---- steam plumes on flagged vents (LD §4.2; S2 hero ingredient)
  {
    const plumes = [];
    for (const p of placements) {
      if (!p.flags || !p.flags.steam) continue;
      for (let i = 0; i < 3; i++) {
        const w0 = 0.5 + i * 0.55, h0 = 1.1 + i * 0.7;
        const g = new THREE.PlaneGeometry(w0, h0);
        g.translate(0, h0 / 2, 0);
        g.rotateY((i * Math.PI) / 3);
        g.translate(p.pos[0], p.pos[1] + p.size[1] + i * 0.75, p.pos[2]);
        plumes.push(g);
      }
    }
    if (plumes.length) {
      const steamMat = new THREE.MeshBasicMaterial({
        map: M.tex.glow, color: 0xb8c4cc, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const sm = new THREE.Mesh(mergeGeometries(plumes, false), steamMat);
      sm.name = "props_steam";
      sm.renderOrder = 3;
      let t0 = 0;
      sm.onBeforeRender = () => {
        // slow breathing drift — deterministic off wall-clock-free sim reads
        t0 = (t0 + 1 / 60) % 1000;
        steamMat.opacity = 0.13 + 0.05 * Math.sin(t0 * 1.7);
      };
      group.add(sm);
    }
  }

  return { group, batches };
}

function setCellUV(geo, cell) {
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (cell[0] + uv.getX(i)) / 4, (3 - cell[1] + uv.getY(i)) / 4);
  }
  uv.needsUpdate = true;
}
