#!/usr/bin/env node
// bake_prop_colliders.mjs - generates assets/props/prop_colliders.json (Wave 5, lane 5A)
//
//   node games/last-circle/_tools/bake_prop_colliders.mjs            write assets/props/prop_colliders.json
//   node games/last-circle/_tools/bake_prop_colliders.mjs --check    exit 1 when the file is stale (GLB or config changed) or maps.js's baseH differs
//   node games/last-circle/_tools/bake_prop_colliders.mjs --print    print the table, write nothing
//
// WHY. runtime/3d/royale/maps.js used to build a prop's collider from a fixed per-kind radius and a fixed top (palm 0.5 / 6 m, rocks 1.4 /
// 6 m, car 1.6 / 1.6 m, container 2.2 / 2.8 m ...) and only AFTER the GLB had loaded. The radius had nothing to do with the mesh, the top was
// wrong by up to 5 m, and a squad client whose GLB request failed (maps.js `catch ... continue`) built NO colliders for that kind while its
// squad-mates did. The table is the single measured source: footprint, anchor, drawn height, base-contact points and collider parts, per
// kind, in METRES AT it.s = 1 (multiply by the instance's seeded scale `it.s`), derived offline from the GLB vertices with the same
// normalisation maps.js uses to draw them:
//     norm = baseH / (compact ? max(bbox size) : bbox size.y)      (bbox of the whole GLB scene, node transforms applied)
//     metres = raw GLB units * norm
//
// Frame of every coordinate below: x/z relative to the INSTANCE ANCHOR, y = 0 at the lowest mesh vertex (the drawn base). For `recentre`
// kinds (rocks) the anchor is the footprint centre (maps.js subtracts it, rotated by ry, so a rock is drawn on the spot its collider and
// the nearPoi check already use); for every other kind the anchor is the GLB origin and trees NEVER move their mesh (palm/birch bbox
// centres are canopy-weighted: a bbox re-centre would push the trunk away from its collider).
//
// Part kinds (every one becomes an axis-aligned box from mkCollider; contract C-COLL: no new collider shape):
//   round  a trunk: ONE box, half-size r, centred on the trunk (rotates with ry, never grows with it)
//   rect   a rectangle (car, container, barrel): exact AABB at quarter turns, otherwise a chain of <= 3 boxes along the long axis;
//          with `prof` (the car) always a chain, one box per slice, each as tall as its slice
//   hull   a convex outline (one per rock sub-mesh): the AABB of the outline rotated by ry; `peak` = x/z of its highest vertex
//          with `lip` (rocks) the main body of a cluster also gets a COMPANION part: the same outline, `top` lower by lip.drop (see "LIP" below)
//
// LIP (rocks, Wave 5 leftovers 3b "rock stairs"). The mover (runtime/3d/royale/player.js) decides "this box is a step, not a wall" in TWO places that
// disagree by 6 mm: blockedIn() lets the capsule into a box whose top is <= feet + STEP_UP (0.55) with the feet as they were BEFORE this tick, and the
// support test that lifts the capsule onto it runs AFTER gravity (-22 * dt = 6 mm lower on the ground). A box top 0.544 .. 0.550 m above the feet is
// therefore "not a wall" and "not liftable": the capsule walks into the box, is never raised, and sinks down through it. Measured by replaying the
// real mover over every isolated rock of 3 maps x 3 seeds (8,640 sprints): 119 end more than 0.2 m inside the drawn rock, 110 of them this way
// (isla_viva rock 11: the small rock's box top 0.547 m under the big one's; isla_viva rock 0: the big box 0.546 m above the slope the capsule
// arrives on). Terrain does it as much as a neighbouring part: a rock sits 0.2 .. 0.4 m below its uphill side, so a 0.8 m rock is a ~0.55 m rise
// exactly where a walker arrives. A `lip` part is the same outline 3 cm lower: for a rise in that window the lip is the box the support test CAN
// lift onto (its rise is 3 cm smaller), the capsule stands on it, and the main box is then a 3 cm step; for a rise over 0.550 the main box is a wall
// and the lip is unreachable behind it. No new collider shape (one more axis-aligned box per tall rock: +1 collider per rock cluster); the 119
// become 13. If player.js makes its two tests consistent (probe the support from max(feet, feet before gravity): the 119 become 9) the lip is
// redundant and `lip` can be dropped from the config.
// Only a part that can be a wall at the instance scales (table top >= lip.minTop: the big rock of a cluster, 0.73 m at s = 1) gets one; the
// smaller parts are steps whatever the terrain does.
//
// A TRUNK THAT IS NOT A STRAIGHT POST (the crooked birch, the tree that bends at 2 m) is baked as a `hull` too (config type "footprint"):
// the convex outline of the SOLID (bark) vertices that lie in the player's body band, so the one box maps.js builds is the tight AABB of that
// outline at any yaw. The old `round` box was a square around the trunk's base only and left the leaning stem outside it (birch: 78 % of the
// instances clipped the body > 25 cm into the drawn trunk; the leaning stem is 0.6 m off the base at the player's head height).
//   * what blocks the 1.8 m capsule is the part of the trunk below 1.8 m of WORLD height (probe_collision.js uses 0.15 .. 1.8), and `it.s`
//     (maps.js scatterTrees: s = 0.8 + rng() * 0.9) stretches every table coordinate, so the TABLE height that band reaches is 0.15 / s ..
//     1.8 / s: 0.19 .. 2.25 at s = 0.8, 0.09 .. 1.06 at s = 1.7. The footprint therefore depends on the instance scale.
//   * `hull` (always written): the outline for the median scale `ref` = 1.25 (band 0.12 .. 1.44). It is the only footprint a maps.js that
//     scales every part linearly can use: exact at s ~ 1.25, too short on a smaller tree (the stem leaves the box above the band), too long on
//     a bigger one. Measured (collisioncheck, deepwood seed 7, 321 birches): clip > 25 cm 78 % -> 34 %, sprints into the drawn trunk 47/64 -> 26/64.
//   * `byScale` (config `byScale`): the same outline for every tabulated s (0.8, 0.9 .. 1.7). A maps.js that reads it (hull branch of
//     pushPropColliders: take the two tabulated scales around it.s and interpolate the box extents) builds the tight box for THIS instance's
//     body band: still ONE box per prop, no new collider shape. Older maps.js ignores the key. Measured with that reader (sandbox, same seed):
//     birch clip p95 0.65 -> 0.08 m, 0 % > 25 cm, gap excess over the tightest box p95 0.08 m, sprints 47/64 -> 1/64; tree (isla_viva, ashgrid)
//     clip p95 0.35 / 0.41 -> 0.02 / 0.03 m, sprints 9/64 -> 0/64.
//   * SOLID = the sub-meshes whose material is not foliage (same rule as probe_collision.js SOFT: green / leaf / foliage / frond / needle).
//     A leaf cluster is walk-through and shoot-through, so it is not in the footprint.
// `chain` > 1 would cut the band into that many boxes along the lean (each still one axis-aligned `hull` part). It stays 1: maps.js
// destroyProp() kills ONE collider, so a destructible tree (propHP) with several boxes would leave invisible boxes standing after it falls
// (and chains measured no better than one box: the scale spread, not the lean, is what a single footprint cannot follow).
//
// Pure function of the GLB bytes and the config below: no timestamps, no randomness (the file is byte-stable).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "..");
const PROPS = path.join(GAME, "assets", "props");
const OUT = path.join(PROPS, "prop_colliders.json");
const MAPS_JS = path.join(GAME, "runtime", "3d", "royale", "maps.js");

// ── config: MUST match the `baseH` table in maps.js (this tool checks it) ───────────────────────────────────────────
// `compact` kinds normalise by their LARGEST dimension, trees by height. The car used to be 1.6 (longest side) = a 3.5 x 1.5 x 1.0 m toy at
// the s = 2.2 every call site uses; 2.05 gives 4.5 x 1.9 x 1.3 m.
const BASE_H = { palm: 7, tree: 6.5, pine: 8, birch: 7, bush: 1.4, rocks: 2.2, car: 2.05, container: 2.8, barrel: 1.1 };
// Per kind: `compact` (normalise by the largest side), `recentre` (anchor = footprint centre; rocks only) and `parts` (the collider parts, see
// the header). Trunk bands are metres above the base at it.s = 1, read where the trunk is a trunk (above the root flare, below the first
// branches); `prim` limits the vertices to one glTF primitive (the pine's foliage starts at 0.97 m, so only its trunk primitive is read).
const KINDS = {
  palm:      { compact: false, parts: { type: "round", band: [0.8, 1.3] } },     // leaning stylised palm
  tree:      { compact: false, parts: { type: "footprint", body: [0.15, 1.8], ref: 1.25, chain: 1, byScale: { min: 0.8, max: 1.7, step: 0.1 } } },
  pine:      { compact: false, parts: { type: "round", band: [1.0, 1.2], prim: 0 } },
  birch:     { compact: false, parts: { type: "footprint", body: [0.15, 1.8], ref: 1.25, chain: 1, byScale: { min: 0.8, max: 1.7, step: 0.1 } } },   // crooked trunk
  bush:      { compact: true,  parts: null },                                    // no collider (walk-through scenery)
  rocks:     { compact: true,  recentre: true, parts: { type: "hull", by: "node", lip: { minTop: 0.5, drop: 0.03 } } },
  car:       { compact: true,  parts: { type: "rect", profile: 3 } },            // hood / cabin / trunk: three boxes, each as tall as its slice
  container: { compact: true,  parts: { type: "rect" } },
  barrel:    { compact: true,  parts: { type: "rect" } },                        // a drum lying on its side (axis along x)
};
const BASE_BAND = 0.12;      // m at it.s = 1: vertices this close to the lowest vertex are base-contact candidates
const HULL_MAX = 16;         // points kept per outline
const BASE_MAX = 36;

// ── tiny GLB reader (positions + node transforms; nothing else is needed) ────────────────────────────────────────────
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0, 2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
// soft foliage: a material named like leaves is walk-through and shoot-through (the same rule as _harness/probe_collision.js SOFT)
const SOFT = /green|leaf|leaves|foliage|frond|needle/i;
const app = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
function readGLB(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(file + ": not a GLB");
  const jl = b.readUInt32LE(12), J = JSON.parse(b.slice(20, 20 + jl).toString("utf8")), bin = b.slice(20 + jl + 8);
  if ((J.extensionsUsed || []).length) throw new Error(file + ": uses glTF extensions " + J.extensionsUsed + " (this reader handles plain float POSITION accessors only)");
  const subs = [];
  const walk = (ni, pm) => {
    const n = J.nodes[ni], m = mul(pm, trs(n));
    if (n.mesh !== undefined) {
      const V = [], primOf = [], softOf = [];
      for (const [pi, pr] of J.meshes[n.mesh].primitives.entries()) {
        const a = J.accessors[pr.attributes.POSITION], bv = J.bufferViews[a.bufferView];
        if (a.componentType !== 5126 || a.type !== "VEC3") throw new Error(file + ": POSITION is not float VEC3");
        const st = bv.byteStride || 12, off = (bv.byteOffset || 0) + (a.byteOffset || 0);
        const mat = pr.material !== undefined && J.materials ? J.materials[pr.material] : null, soft = !!(mat && SOFT.test(mat.name || ""));
        for (let i = 0; i < a.count; i++) { V.push(app(m, [bin.readFloatLE(off + i * st), bin.readFloatLE(off + i * st + 4), bin.readFloatLE(off + i * st + 8)])); primOf.push(pi); softOf.push(soft); }
      }
      subs.push({ node: n.name || ("node" + ni), V, primOf, softOf });
    }
    for (const c of n.children || []) walk(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of J.scenes[J.scene || 0].nodes) walk(r, I);
  return subs;
}

// ── 2D helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
function hull2(pts) {                                    // monotone chain, CCW, no duplicate end point
  const P = pts.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = P.filter((p, i) => !i || p[0] !== P[i - 1][0] || p[1] !== P[i - 1][1]);
  if (uniq.length < 3) return uniq;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of uniq) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = uniq.length - 1; i >= 0; i--) { const p = uniq[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function area2(h) { let a = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
function simplify(h, max) {                              // drop the vertices that change the outline least until <= max remain
  h = h.slice();
  while (h.length > max) {
    let bi = 0, ba = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = h[(i + h.length - 1) % h.length], b = h[i], c = h[(i + 1) % h.length];
      const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      if (ar < ba) { ba = ar; bi = i; }
    }
    h.splice(bi, 1);
  }
  return h;
}
const r4 = (v) => { const x = Math.round(v * 10000) / 10000; return x === 0 ? 0 : x; };   // 0.1 mm, no -0

// ── bake one kind ────────────────────────────────────────────────────────────────────────────────────────────────────
function bakeKind(kind) {
  const cfg = KINDS[kind], file = path.join(PROPS, kind + ".glb");
  const subs = readGLB(file), all = subs.flatMap((s) => s.V);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of all) for (let i = 0; i < 3; i++) { if (v[i] < lo[i]) lo[i] = v[i]; if (v[i] > hi[i]) hi[i] = v[i]; }
  const size = hi.map((h, i) => h - lo[i]);
  const baseH = BASE_H[kind];
  const norm = baseH / Math.max(0.001, cfg.compact ? Math.max(size[0], size[1], size[2]) : size[1]);
  // metres at it.s = 1; x/z absolute (GLB origin), y relative to the lowest vertex
  const M = (v) => [v[0] * norm, (v[1] - lo[1]) * norm, v[2] * norm];
  const anchor = cfg.recentre ? [((lo[0] + hi[0]) / 2) * norm, ((lo[2] + hi[2]) / 2) * norm] : [0, 0];
  const rel = (p) => [p[0] - anchor[0], p[2] - anchor[1]];            // M(v) -> instance frame x/z
  const out = {
    baseH, compact: !!cfg.compact, norm: +norm.toFixed(6),
    bboxMin: lo.map((v) => +v.toFixed(5)), bboxMax: hi.map((v) => +v.toFixed(5)),
    anchor: anchor.map(r4), height: r4(size[1] * norm), recentre: !!cfg.recentre,
  };
  // base-contact points: outline of the lowest vertices (per node so each rock of a cluster rests on its own ground), the centroid and the edge midpoints
  const baseSets = cfg.parts && cfg.parts.by === "node" ? subs : [{ V: all }];
  const basePts = [];
  for (const s of baseSets) {
    const lowY = Math.min(...s.V.map((v) => v[1]));
    const low = s.V.filter((v) => (v[1] - lowY) * norm <= BASE_BAND).map((v) => rel(M(v)));
    if (!low.length) continue;
    // the outline (<= 8 points, fewer for a cluster: every point costs one heightAt per placed prop at build time, and a savanna match places
    // ~2,900) and the centroid; the 0.10-0.15 m embed covers the curvature between the samples
    const h = simplify(hull2(low), Math.min(8, Math.max(4, Math.floor(30 / baseSets.length))));
    for (const p of h) basePts.push(p);
    basePts.push([low.reduce((a, p) => a + p[0], 0) / low.length, low.reduce((a, p) => a + p[1], 0) / low.length]);
  }
  const bp = [], seen = new Set();
  for (const p of basePts) { const k = r4(p[0]) + "," + r4(p[1]); if (!seen.has(k)) { seen.add(k); bp.push([r4(p[0]), r4(p[1])]); } }
  if (bp.length > BASE_MAX) throw new Error(kind + ": " + bp.length + " base points > " + BASE_MAX);
  out.base = bp;
  // collider parts
  if (cfg.parts) {
    const parts = [];
    const P = cfg.parts;
    if (P.type === "round") {
      const primAll = subs.flatMap((sb) => sb.primOf);
      const sel = all.map(M).filter((m, i) => m[1] >= P.band[0] && m[1] <= P.band[1] && (P.prim == null || primAll[i] === P.prim)).map((m) => [m[0] - anchor[0], m[2] - anchor[1]]);
      if (sel.length < 4) throw new Error(kind + ": trunk band holds " + sel.length + " vertices");
      const x0 = Math.min(...sel.map((p) => p[0])), x1 = Math.max(...sel.map((p) => p[0])), z0 = Math.min(...sel.map((p) => p[1])), z1 = Math.max(...sel.map((p) => p[1]));
      parts.push({ t: "round", c: [r4((x0 + x1) / 2), r4((z0 + z1) / 2)], r: r4(Math.max(x1 - x0, z1 - z0) / 2), top: out.height });
    } else if (P.type === "footprint") {
      // the convex outline of the SOLID (non-foliage) vertices inside a body band [b0, b1] (table heights at it.s = 1); see the header
      const solid = [];
      for (const sb of subs) sb.V.forEach((v, i) => { if (sb.softOf[i]) return; const m = M(v); solid.push([m[0] - anchor[0], m[2] - anchor[1], m[1]]); });
      const inBand = (b0, b1, last) => solid.filter((p) => p[2] >= b0 && (last ? p[2] <= b1 : p[2] < b1));
      const outlineOf = (sel, what) => {
        if (sel.length < 4) throw new Error(kind + ": footprint " + what + " holds " + sel.length + " solid vertices");
        return simplify(hull2(sel), HULL_MAX).map((p) => [r4(p[0]), r4(p[1])]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
      };
      // (1) the fallback `hull`: the band cut at the reference scale, `chain` equal sub-bands (1 = one box)
      const yLo = P.body[0] / P.ref, yHi = P.body[1] / P.ref, nCh = Math.max(1, P.chain || 1);
      for (let k = 0; k < nCh; k++) {
        const a0 = yLo + (yHi - yLo) * k / nCh, a1 = yLo + (yHi - yLo) * (k + 1) / nCh, sel = inBand(a0, a1, k === nCh - 1);
        const topV = sel.reduce((b, p) => (p[2] > b[2] ? p : b), sel[0] || [0, 0, 0]);        // the highest vertex of the band (only a tilted prop reads `peak`)
        const part = { t: "hull", name: nCh > 1 ? "trunk" + k : "trunk", hull: outlineOf(sel, "band " + a0.toFixed(2) + ".." + a1.toFixed(2)), peak: [r4(topV[0]), r4(topV[1])], top: out.height };
        // (2) `byScale`: the same outline for every tabulated instance scale s (band 0.15 .. 1.8 m of WORLD height = table height 0.15 / s .. 1.8 / s)
        if (P.byScale && nCh === 1) {
          part.byScale = [];
          const nS = Math.round((P.byScale.max - P.byScale.min) / P.byScale.step);
          for (let j = 0; j <= nS; j++) { const sj = r4(P.byScale.min + P.byScale.step * j); part.byScale.push({ s: sj, hull: outlineOf(inBand(P.body[0] / sj, P.body[1] / sj, true), "byScale " + sj) }); }
        }
        parts.push(part);
      }
    } else if (P.type === "rect") {
      const m = all.map(M);
      const x0 = Math.min(...m.map((p) => p[0] - anchor[0])), x1 = Math.max(...m.map((p) => p[0] - anchor[0])), z0 = Math.min(...m.map((p) => p[2] - anchor[1])), z1 = Math.max(...m.map((p) => p[2] - anchor[1]));
      const part = { t: "rect", c: [r4((x0 + x1) / 2), r4((z0 + z1) / 2)], h: [r4((x1 - x0) / 2), r4((z1 - z0) / 2)], top: out.height };
      if (P.profile) {
        // height profile along the LONG axis, from its negative end to its positive end (the same order maps.js lays the boxes out in): a car
        // is 0.83 m at the hood, 1.30 m over the cabin, 0.89 m at the trunk (s = 2.2), and body-height shots pass over the hood
        const along = (x1 - x0) >= (z1 - z0) ? 0 : 2, lo2 = along === 0 ? x0 : z0, hi2 = along === 0 ? x1 : z1, prof = new Array(P.profile).fill(0);
        for (const v of all.map(M)) { const t = ((along === 0 ? v[0] : v[2]) - anchor[along === 0 ? 0 : 1] - lo2) / (hi2 - lo2), k = Math.min(P.profile - 1, Math.max(0, Math.floor(t * P.profile))); if (v[1] > prof[k]) prof[k] = v[1]; }
        part.prof = prof.map(r4);
      }
      parts.push(part);
    } else if (P.type === "hull") {
      for (const s of subs) {
        const pts = s.V.map(M);
        const outline = simplify(hull2(pts.map((p) => [p[0] - anchor[0], p[2] - anchor[1]])), HULL_MAX);
        const rounded = outline.map((p) => [r4(p[0]), r4(p[1])]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
        const topV = pts.reduce((b, p) => (p[1] > b[1] ? p : b), pts[0]);       // the highest vertex: where a tilted rock's top actually is
        const peak = [r4(topV[0] - anchor[0]), r4(topV[2] - anchor[1])];
        parts.push({ t: "hull", name: s.node, hull: rounded, peak, top: r4(topV[1]) });
        // the companion (see LIP in the header): same outline, a lower top, so maps.js builds a second box of exactly the same footprint
        if (P.lip && topV[1] >= P.lip.minTop) parts.push({ t: "hull", name: s.node + "_lip", hull: rounded, peak, top: r4(topV[1] - P.lip.drop) });
      }
    }
    out.parts = parts;
  }
  return out;
}

// ── serialise: stable key order, numbers arrays on one line ──────────────────────────────────────────────────────────
function ser(v, ind) {
  const pad = "  ".repeat(ind);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "number" || (Array.isArray(x) && x.every((y) => typeof y === "number")))) return "[" + v.map((x) => (Array.isArray(x) ? "[" + x.join(",") + "]" : x)).join(",") + "]";
    return "[\n" + v.map((x) => pad + "  " + ser(x, ind + 1)).join(",\n") + "\n" + pad + "]";
  }
  if (v && typeof v === "object") {
    const ks = Object.keys(v);
    return "{\n" + ks.map((k) => pad + "  " + JSON.stringify(k) + ": " + ser(v[k], ind + 1)).join(",\n") + "\n" + pad + "}";
  }
  return JSON.stringify(v);
}
function build() {
  const kinds = {}, src = {};
  for (const k of Object.keys(KINDS)) {
    kinds[k] = bakeKind(k);
    const b = fs.readFileSync(path.join(PROPS, k + ".glb"));
    src[k] = { bytes: b.length, sha1: crypto.createHash("sha1").update(b).digest("hex").slice(0, 16) };
  }
  return ser({
    version: 1,
    generator: "games/last-circle/_tools/bake_prop_colliders.mjs",
    note: "GENERATED - do not edit. Metres at it.s = 1, x/z relative to the instance anchor, y = 0 at the drawn base. See the tool header.",
    src, kinds,
  }, 0) + "\n";
}

// ── maps.js baseH must equal BASE_H (the runtime draws with it when the table is absent) ─────────────────────────────
function checkMapsBaseH() {
  const src = fs.readFileSync(MAPS_JS, "utf8");
  const m = src.match(/const baseH = (\{[^}]*\})/);
  if (!m) return "maps.js: could not find `const baseH = {...}`";
  let got;
  try { got = Function("return (" + m[1] + ")")(); } catch (e) { return "maps.js: baseH literal does not parse: " + e.message; }
  const bad = Object.keys(BASE_H).filter((k) => got[k] !== BASE_H[k]);
  return bad.length ? "maps.js baseH differs from the bake config for: " + bad.map((k) => k + " (maps.js " + got[k] + ", tool " + BASE_H[k] + ")").join(", ") : null;
}

const arg = process.argv[2];
const text = build();
const mapsErr = checkMapsBaseH();
if (arg === "--print") { process.stdout.write(text); process.exit(mapsErr ? 1 : 0); }
if (arg === "--check") {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;   // git autocrlf may hand a checkout CRLF line ends
  const stale = cur !== text;
  if (stale) console.error("prop_colliders.json is STALE or missing: run  node games/last-circle/_tools/bake_prop_colliders.mjs");
  if (mapsErr) console.error(mapsErr);
  if (!stale && !mapsErr) console.log("prop_colliders.json is current (" + text.length + " bytes), maps.js baseH agrees");
  process.exit(stale || mapsErr ? 1 : 0);
}
fs.writeFileSync(OUT, text);
console.log("wrote " + path.relative(process.cwd(), OUT) + " (" + text.length + " bytes)");
if (mapsErr) { console.error(mapsErr); process.exit(1); }
