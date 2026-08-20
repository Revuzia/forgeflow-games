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

// ---------------------------------------------------------------------------
// DARK-GLASS PANE ATLAS  (iter06 strike item #8: "every window pane on every
// facade carries the SAME diagonal highlight at the SAME angle").
//
// iter05 shipped four authored dark variants x a per-pane horizontal UV mirror.
// The measurement said 8 reflections; the eye said one, because all four
// variants carried ONE slanted cloud band inside a ~0.85 rad window and the
// mirror only flips the sign — the ANGLE never changed, so the stamp survived
// pane by pane. The fix is structural, not statistical:
//
//   * 32 cells, not 4. Eight columns x four rows.
//   * Cells 0..23 are glass, in FOUR ORIENTATION FAMILIES of six. The family
//     is chosen by the facade's normal, so an east-facing wall mirrors a
//     different sky sector (different brightness, different dominant band
//     angle) than the north-facing wall across the street from it. That is the
//     physical behaviour the critic asked for: what a pane reflects depends on
//     what is opposite it.
//   * Inside a family the six cells differ in band COUNT (0..3), band ANGLE
//     (drawn across the family's range plus +/-0.17 rad of jitter, and the
//     families do not overlap), band width, band height, softness and alpha —
//     plus a reflected opposite-mass silhouette with its own skyline, its own
//     rain streaking, its own grime field and one of five mullion layouts.
//     Some cells carry NO band at all.
//   * Cells 24..31 are interiors: blinds at varying pitch and drop, curtains,
//     a dim warm room, boarded-from-behind ply.
//
// Cell choice at the call site is driven off the pane's WORLD POSITION and is
// then forced to differ from the pane to its left and the pane below it, so
// "two adjacent panes carry the same highlight" is impossible by construction
// rather than improbable by sampling.
//
// Still bound as map AND emissiveMap: the 128 px baked cube is far too coarse
// to carry a sky reflection through the envMap path alone (that is what made
// iter04's panes measure RGB 9/10/15), so the painted layer sets the base and
// the per-material envMap (three roughness/intensity tiers) supplies the
// view-dependent specular on top.
const GLASS_COLS = 8, GLASS_ROWS = 4, GLASS_FAMN = 6, GLASS_INTERIOR0 = 24;

function glassPaneAtlas(cs = 160) {
  const c = document.createElement("canvas");
  c.width = GLASS_COLS * cs; c.height = GLASS_ROWS * cs;
  const g = c.getContext("2d");
  g.fillStyle = "#05070a"; g.fillRect(0, 0, c.width, c.height);

  // one family per facade normal: sky ramp colours + a NON-OVERLAPPING band
  // angle range, so two facades of the same building cannot draw the same slant
  const FAMILY = [
    { sky: ["#7e93b9", "#252d3c"], lift: 0.50, ang: [-1.22, -0.66], glow: 0.55 }, // +x
    { sky: ["#465573", "#1a2130"], lift: 0.24, ang: [0.12, 0.58], glow: 0.22 },   // -x
    { sky: ["#5e739b", "#1c2331"], lift: 0.38, ang: [-0.30, 0.10], glow: 0.40 },  // +z
    { sky: ["#3b4864", "#161c27"], lift: 0.20, ang: [0.66, 1.24], glow: 0.16 },   // -z
  ];
  const BAND_TINT = ["156,176,210", "138,158,196", "176,192,216", "120,142,180", "196,206,224"];

  for (let idx = 0; idx < GLASS_COLS * GLASS_ROWS; idx++) {
    const x0 = (idx % GLASS_COLS) * cs, y0 = ((idx / GLASS_COLS) | 0) * cs;
    const r = rng((Math.imul(idx + 17, 2654435761) ^ 0x9e3779b9) >>> 0);
    const interior = idx >= GLASS_INTERIOR0;
    const fam = FAMILY[interior ? (idx - GLASS_INTERIOR0) % 4 : (idx / GLASS_FAMN) | 0];

    const inset = Math.max(3, cs * 0.030);
    const gx = x0 + inset, gy = y0 + inset, gw = cs - inset * 2, gh = cs - inset * 2;
    const clip = () => { g.save(); g.beginPath(); g.rect(gx, gy, gw, gh); g.clip(); };

    // ---- 1. sky ramp: bright where the pane sees the storm dome, dark at the
    // cill where it sees the street. Stop position varies per cell.
    const stop = Math.min(0.94, 0.24 + fam.lift * (0.70 + r() * 0.80));
    const gr = g.createLinearGradient(0, gy, 0, gy + gh);
    gr.addColorStop(0, fam.sky[0]);
    gr.addColorStop(stop, fam.sky[1]);
    gr.addColorStop(1, fam.sky[1]);
    g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);

    // ---- 2. the mass opposite: a reflected skyline with a couple of lit
    // rooms in it. Different silhouette per cell = different reflection.
    if (!interior) {
      clip();
      const baseY = gy + gh * (0.54 + r() * 0.32);
      let sx = gx - gw * 0.1;
      while (sx < gx + gw) {
        const w = gw * (0.10 + r() * 0.30);
        const top = baseY - gh * (r() * 0.26);
        g.fillStyle = `rgba(${7 + ((r() * 10) | 0)},${9 + ((r() * 10) | 0)},${15 + ((r() * 12) | 0)},${0.62 + r() * 0.2})`;
        g.fillRect(sx, top, w + 1, gy + gh - top);
        if (r() < 0.26) { // a lit room in the reflected block
          g.fillStyle = `rgba(255,${170 + ((r() * 50) | 0)},${90 + ((r() * 70) | 0)},${0.20 + r() * 0.28})`;
          g.fillRect(sx + w * 0.25, top + gh * (0.06 + r() * 0.2), w * 0.28, gh * 0.07);
        }
        sx += w;
      }
      g.restore();
    }

    // ---- 3. interior states (cells 24..31): blind / curtain / dim room / ply
    if (interior) {
      clip();
      const kind = (idx - GLASS_INTERIOR0) >> 1; // 0..3
      if (kind === 0) {                    // venetian blind, partial drop
        const drop = gh * (0.55 + r() * 0.45);
        g.fillStyle = `rgb(${118 + ((r() * 34) | 0)},${114 + ((r() * 30) | 0)},${100 + ((r() * 28) | 0)})`;
        g.fillRect(gx, gy, gw, drop);
        const pitch = gh * (0.035 + r() * 0.035);
        g.fillStyle = "rgba(46,42,34,0.42)";
        for (let y = gy + pitch; y < gy + drop; y += pitch) g.fillRect(gx, y, gw, Math.max(1, pitch * 0.3));
        g.fillStyle = "rgba(30,28,24,0.55)";
        g.fillRect(gx, gy + drop - 2, gw, 3);
      } else if (kind === 1) {             // curtains, off-centre, soft folds
        const wLeft = gw * (0.18 + r() * 0.34), wRight = gw * (0.14 + r() * 0.36);
        for (const [cxs, cw] of [[gx, wLeft], [gx + gw - wRight, wRight]]) {
          const cgr = g.createLinearGradient(cxs, 0, cxs + cw, 0);
          cgr.addColorStop(0, "rgba(96,90,82,0.94)");
          cgr.addColorStop(0.45, "rgba(140,132,120,0.90)");
          cgr.addColorStop(1, "rgba(70,66,60,0.86)");
          g.fillStyle = cgr; g.fillRect(cxs, gy, cw, gh);
          g.fillStyle = "rgba(40,38,34,0.22)";
          for (let f = 0; f < 3; f++) g.fillRect(cxs + cw * (0.2 + f * 0.3), gy, Math.max(1, cw * 0.05), gh);
        }
      } else if (kind === 2) {             // dim room, light spilling in low
        g.fillStyle = "rgba(10,9,8,0.86)"; g.fillRect(gx, gy, gw, gh);
        const rg = g.createRadialGradient(
          gx + gw * (0.25 + r() * 0.5), gy + gh * (0.72 + r() * 0.2), 1,
          gx + gw * 0.5, gy + gh * 0.8, gw * (0.5 + r() * 0.4));
        rg.addColorStop(0, `rgba(255,${168 + ((r() * 46) | 0)},96,${0.28 + r() * 0.24})`);
        rg.addColorStop(1, "rgba(255,150,80,0)");
        g.fillStyle = rg; g.fillRect(gx, gy, gw, gh);
      } else {                             // boarded from behind, horizontal ply
        g.fillStyle = "rgba(74,64,52,0.95)"; g.fillRect(gx, gy, gw, gh);
        const bh = gh / (2 + ((r() * 3) | 0));
        for (let y = gy; y < gy + gh; y += bh) {
          g.fillStyle = `rgba(${58 + ((r() * 40) | 0)},${50 + ((r() * 32) | 0)},${40 + ((r() * 26) | 0)},0.9)`;
          g.fillRect(gx, y, gw, bh - 1);
          g.fillStyle = "rgba(22,18,14,0.55)"; g.fillRect(gx, y + bh - 2, gw, 2);
        }
      }
      g.restore();
    }

    // ---- 4. cloud bands. Count, ANGLE, width, offset, softness and tint all
    // per cell; the family range keeps facades apart, the jitter keeps panes
    // apart. Zero bands is a legal outcome — an overcast pane with no slant.
    const nBands = interior ? ((r() < 0.45) ? 1 : 0) : [0, 1, 1, 2, 2, 3][(r() * 6) | 0];
    for (let b = 0; b < nBands; b++) {
      const ang = fam.ang[0] + r() * (fam.ang[1] - fam.ang[0]) + (r() - 0.5) * 0.34;
      const bh = gh * (0.05 + r() * 0.30);
      const off = (r() - 0.5) * gh * 1.0;
      const a = (0.09 + r() * 0.28) * (interior ? 0.45 : 1) * (0.55 + fam.glow);
      const soft = 0.10 + r() * 0.34;      // 0.1 = hard-ish edge, 0.44 = haze
      const tint = BAND_TINT[(r() * BAND_TINT.length) | 0];
      g.save();
      g.beginPath(); g.rect(gx, gy, gw, gh); g.clip();
      g.translate(gx + gw / 2, gy + gh / 2);
      g.rotate(ang);
      const bg = g.createLinearGradient(0, off - bh / 2, 0, off + bh / 2);
      bg.addColorStop(0, `rgba(${tint},0)`);
      bg.addColorStop(soft, `rgba(${tint},${a})`);
      bg.addColorStop(1 - soft, `rgba(${tint},${a * (0.5 + r() * 0.6)})`);
      bg.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = bg;
      g.fillRect(-cs, off - bh / 2, cs * 2, bh);
      g.restore();
    }

    // ---- 5. rain streaking: vertical (gravity does not care about the
    // family), per-cell count from 0 to ~14, varying length and opacity
    clip();
    const nStreak = (r() * (interior ? 5 : 15)) | 0;
    for (let s = 0; s < nStreak; s++) {
      const sxp = gx + r() * gw, y1 = gy + r() * gh * 0.55;
      const len = Math.min(gy + gh - y1, gh * (0.18 + r() * 0.85));
      const w = 1 + r() * 2.4;
      const sg = g.createLinearGradient(0, y1, 0, y1 + len);
      sg.addColorStop(0, "rgba(196,212,236,0)");
      sg.addColorStop(0.25, `rgba(196,212,236,${0.04 + r() * 0.14})`);
      sg.addColorStop(1, "rgba(196,212,236,0)");
      g.fillStyle = sg; g.fillRect(sxp, y1, w, len);
      if (r() < 0.4) { g.fillStyle = "rgba(210,224,244,0.16)"; g.fillRect(sxp - 0.5, y1 + len - 3, w + 1, 3); }
    }
    // ---- 6. grime: blotch field + a dirt wedge in one lower corner
    const nGrime = 3 + ((r() * 10) | 0);
    for (let q = 0; q < nGrime; q++) {
      const px = gx + r() * gw, py = gy + r() * gh, rad = gw * (0.07 + r() * 0.28);
      const bg = g.createRadialGradient(px, py, 0, px, py, rad);
      bg.addColorStop(0, `rgba(${16 + ((r() * 22) | 0)},${16 + ((r() * 20) | 0)},${14 + ((r() * 18) | 0)},${0.05 + r() * 0.2})`);
      bg.addColorStop(1, "rgba(20,20,18,0)");
      g.fillStyle = bg; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    {
      const left = r() < 0.5;
      const cg = g.createLinearGradient(left ? gx : gx + gw, gy + gh, left ? gx + gw * 0.55 : gx + gw * 0.45, gy + gh * 0.35);
      cg.addColorStop(0, `rgba(14,14,13,${0.22 + r() * 0.3})`);
      cg.addColorStop(1, "rgba(14,14,13,0)");
      g.fillStyle = cg; g.fillRect(gx, gy, gw, gh);
    }
    g.restore();

    // ---- 7. mullions: five layouts, varying bar weight and rail height, so
    // the pane's own drawing changes cell to cell as well as its reflection
    const bar = Math.max(1.6, cs * (0.011 + r() * 0.013));
    g.fillStyle = `rgba(${5 + ((r() * 10) | 0)},${7 + ((r() * 10) | 0)},${11 + ((r() * 12) | 0)},0.94)`;
    const L = (r() * 5) | 0;
    if (L === 0) {                         // two over two
      const my = gy + gh * (0.36 + r() * 0.26);
      g.fillRect(gx + gw / 2 - bar / 2, gy, bar, gh);
      g.fillRect(gx, my, gw, bar * 1.3);
    } else if (L === 1) {                  // single meeting rail
      g.fillRect(gx, gy + gh * (0.28 + r() * 0.42), gw, bar * 1.5);
    } else if (L === 2) {                  // three vertical lites
      g.fillRect(gx + gw / 3 - bar / 2, gy, bar, gh);
      g.fillRect(gx + (2 * gw) / 3 - bar / 2, gy, bar, gh);
    } else if (L === 3) {                  // two over one, off-centre post
      const mx = gx + gw * (0.34 + r() * 0.3), my = gy + gh * (0.52 + r() * 0.22);
      g.fillRect(mx, gy, bar, my - gy + bar);
      g.fillRect(gx, my, gw, bar * 1.3);
    }                                      // L === 4: one big lite, no mullion

    // ---- 8. frame shadow inside the reveal — per-side depth, so the implied
    // key direction differs cell to cell too
    const ft = cs * 0.034;
    g.fillStyle = "rgba(3,5,9,0.93)";
    g.fillRect(x0, y0, cs, ft * (0.9 + r() * 1.5));
    g.fillRect(x0, y0 + cs - ft, cs, ft);
    g.fillRect(x0, y0, ft * (0.7 + r() * 1.7), cs);
    g.fillRect(x0 + cs - ft, y0, ft, cs);
  }
  return c;
}

// FNV-1a over the pane's quantised world position — the cell a pane draws is a
// property of WHERE IT IS, not of a repeating UV counter, so a facade cannot
// fall into a period.
function paneHash(x, y, z) {
  let h = 2166136261;
  for (const v of [Math.round(x * 8) | 0, Math.round(y * 8) | 0, Math.round(z * 8) | 0]) {
    h ^= v & 255; h = Math.imul(h, 16777619);
    h ^= (v >> 8) & 255; h = Math.imul(h, 16777619);
    h ^= (v >> 16) & 255; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
  // ---- WET-ALBEDO BAKE (VT §4.2 "albedo x 0.8 (darkening)"), LaneC/iter05.
  // materials.js authors the DRY swatches bright — asphalt 0xb4b4b4 is linear
  // 0.451, i.e. fresh concrete, and cobble 0x8e8e93 is 0.27. That is why the
  // iter04 battery measured the road band at luma 103 against a 54 sky: a
  // 0.45-albedo road under a strong ambient cannot be anything but pale grey,
  // whatever the lights do. Real rain-soaked asphalt at night sits near 0.05.
  // The multiplier is baked per-vertex into aowet.r (the shader already does
  // `diffuseColor.rgb *= vAowet.r`) rather than by editing the swatches, so
  // the DRY material vocabulary stays honest and the wetness is a property of
  // THIS level's weather — turn the rain off and the bake is the only thing
  // that has to change. Interiors stay near-dry; they are under a roof.
  const WET_ALBEDO = {
    asphalt: 0.40, asphalt_worn: 0.40, asphalt_tram: 0.42,
    plaza_cobble: 0.44, concrete_quay: 0.50, concrete_yard: 0.50,
    concrete_interior: 0.70, tile_interior: 0.74,
  };
  const INDOOR_KIND = { concrete_interior: 1, tile_interior: 1 };
  // Drainage sheen, 0..1 — the field that decides where the wet film SITS.
  // Two non-commensurate low-frequency terms give slow damp/dry patches, a
  // higher-frequency term breaks the boundary so the sheen has an edge rather
  // than a gradient, and the caller adds kerb proximity (water runs to the
  // edge of the camber). Consumed twice: aowet.b here (materials.js darkens
  // 0.30x and pulls roughness 0.45x off it) and the wet-specular streak layer
  // below, so the streaks break up on exactly the same drainage the surface
  // does — one field, two consumers, they cannot disagree.
  const sheenAt = (x, z) => {
    const n1 = Math.sin(x * 0.21 + z * 0.09) * Math.cos(x * 0.062 - z * 0.148);
    const n2 = Math.sin(x * 0.63 - z * 0.41) * Math.cos(z * 0.55 + x * 0.19);
    const v = 0.5 + 0.44 * n1 + 0.17 * n2;
    return Math.min(1, Math.max(0, (v - 0.28) / 0.56));
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
      const wetAlb = WET_ALBEDO[r.kind] ?? 0.45;
      const indoor = !!INDOOR_KIND[r.kind];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        uv[i * 2] = x; uv[i * 2 + 1] = z;
        // macro tint variance (anti-tiling b) + contact AO
        const m = 0.92 + 0.14 * Math.abs(Math.sin(x * 0.53 + z * 0.71) * Math.cos(x * 0.11 - z * 0.17));
        const ao = aoAt(x, z);
        const pud = puddleAt(x, z);
        // kerb proximity: aoAt is 0.62 hard against a solid, 1.0 beyond 1.4 m
        const kerb = Math.min(1, Math.max(0, (1 - ao) / 0.38));
        const wet = indoor ? 0 : Math.min(0.95, 0.20 + 0.55 * sheenAt(x, z) + 0.42 * kerb);
        // standing water is darker still — what you see in a puddle is the
        // REFLECTION, not the bed, so the bed must not compete with it.
        a[i * 3] = ao * m * wetAlb * (1 - 0.32 * pud);
        a[i * 3 + 1] = pud;
        a[i * 3 + 2] = wet;
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

  // ============================================ 1b. WET SPECULAR STREAKS
  // RANKED FIX #7 — "the contracted payoff of the entire rain-at-blue-hour
  // premise never arrives: wetness reads only as darkening. There is not one
  // elongated specular streak." All three iter04 critics reached the same
  // mechanism independently: "a round blob means the ground is sampling a
  // diffuse pool DECAL, not a specular reflection."
  //
  // They are right, and it cannot be fixed by making the decals prettier: a
  // decal is painted in WORLD space and a reflection lives in VIEW space, so a
  // prettier decal is still a sticker that does not move when the player does.
  // This computes the reflection. On a flat wet plane the mirror image of a
  // lamp at height h sits at -h, and the specular response at a ground point is
  // the alignment between the reflected view ray and the direction to the lamp.
  //
  // ONE ground-plane mesh over the exterior roads, one draw, with the
  // practicals passed as a uniform array — NOT a quad per lamp. Two reasons,
  // both measured: per-lamp quads bounded every streak at the quad's own edge
  // fade (streaks died around 12 m and read as blobs again), and 15
  // overlapping 50 m quads pay their fill cost several times on the same
  // pixels. A single sheet covers each road pixel exactly once.
  //
  // No lights are created here (doctrine §3 — A6 owns the pool); this is a
  // shading term, not a light.
  //
  // Acceptance (the critics' own pixel probe, VT §4.2): a contiguous bright
  // region on the ground beneath a lamp whose VERTICAL extent is at least 3x
  // its horizontal extent.
  const SPEC_SLOTS = 12;
  {
    const EXTERIOR = {
      concrete_quay: 1, asphalt_worn: 1, asphalt: 1,
      plaza_cobble: 1, asphalt_tram: 1, concrete_yard: 1,
    };
    // Slot priority, documented because 23 poles do not fit 12 slots and the
    // choice is a look decision: every REAL practical first (they are the lit
    // zones the level design is built around), then the neon signage — the
    // frame's only warm/cool colour contrast, and "puddle reflections of
    // signage" was asked for by name — then the sodium fakes standing over
    // open road. Anything indoors or under a canopy is excluded: it has no wet
    // road to reflect in.
    const SKIP = { fake_platform_strip: 1, fake_gatehouse: 1 };
    const poles = (layout.lightPoles || []).filter((p) => !SKIP[p.id]);
    const rank = (p) => (p.real ? 0 : p.kind === "neon" ? 1 : 2);
    const chosen = poles.slice().sort((a, b) => rank(a) - rank(b)).slice(0, SPEC_SLOTS);
    const REACH = { flood: 40, neon_bounce: 26, sodium: 30, skylight: 16, fluorescent: 18, neon: 13, interior: 10 };
    const GAIN = { flood: 1.30, neon_bounce: 0.55, sodium: 1.0, skylight: 0.5, fluorescent: 0.6, neon: 0.42, interior: 0.4 };
    // Five saturated neon signs on one wall summed into a magenta film over the
    // whole plaza the first time this ran (the same "flat pink wash" critic-a
    // flagged in iter04 S4). A reflection off wet stone is markedly less
    // saturated than its source — the same physical fact lighting.js already
    // encodes as BOUNCE_SAT for the plaza aggregate — so signage reflections
    // keep their hue and give up most of their chroma.
    const SIGN_SAT = 0.58;
    const uPos = [], uCol = [];
    for (let i = 0; i < SPEC_SLOTS; i++) {
      const p = chosen[i];
      if (!p) { uPos.push(new THREE.Vector4(0, -500, 0, 1)); uCol.push(new THREE.Color(0, 0, 0)); continue; }
      const gn = GAIN[p.kind] ?? 1.0;
      const c = new THREE.Color(p.color);
      if (p.kind === "neon" || p.kind === "neon_bounce") {
        const lm = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        c.setRGB(lm + (c.r - lm) * SIGN_SAT, lm + (c.g - lm) * SIGN_SAT, lm + (c.b - lm) * SIGN_SAT);
      }
      uPos.push(new THREE.Vector4(p.pos[0], p.pos[1], p.pos[2], REACH[p.kind] ?? 20));
      uCol.push(c.multiplyScalar(gn));
    }

    // Ground sheet: the exterior roads only, re-tessellated at ~2.5 m so the
    // baked wetness interpolates smoothly.
    //
    // BOUNDARY FADE, and it is not cosmetic. The sheet ends where the road
    // rects end, and an additive layer that stops dead paints a perfectly
    // STRAIGHT bright boundary across open ground — critic-a's iter04 note
    // ("a hard-edged flat pink/magenta wash with a STRAIGHT boundary and no
    // source anywhere in frame ... straight-edged means it is a decal quad,
    // not light") applies word for word, and the first run of this sheet
    // reproduced it across the S9 plaza. Fading only at the OUTER edge of the
    // road network — probed by asking whether the neighbourhood is still road
    // — keeps interior rect-to-rect joins seamless.
    const onExtRoad = (x, z) => {
      for (const r of layout.roads) {
        if (!EXTERIOR[r.kind]) continue;
        if (x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]) return true;
      }
      return false;
    };
    const edgeFade = (x, z) => {
      let n = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (onExtRoad(x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2)) n++;
      }
      return n / 8;
    };
    const geos = [];
    for (const r of layout.roads) {
      if (!EXTERIOR[r.kind]) continue;
      const w = r.max[0] - r.min[0], d = r.max[1] - r.min[1];
      const sx = Math.max(2, Math.round(w / 2.5)), sz = Math.max(2, Math.round(d / 2.5));
      const g = new THREE.PlaneGeometry(w, d, sx, sz);
      g.rotateX(-Math.PI / 2);
      g.translate(r.min[0] + w / 2, 0.014, r.min[1] + d / 2);
      const pa = g.getAttribute("position");
      const aW = new Float32Array(pa.count);
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i);
        const ao = aoAt(x, z);
        const kerb = Math.min(1, Math.max(0, (1 - ao) / 0.38));
        // The SAME drainage field the albedo bake uses, so the sheen breaks up
        // exactly where the surface is dry — "sheen breaking up along
        // drainage" was asked for by name, and one shared field is the only
        // way the two can never contradict each other. Floor is 0.35, not 0:
        // at 0.16 the dry patches chopped every streak into short segments
        // that measured as blobs again.
        aW[i] = Math.min(1, 0.35 + 0.45 * sheenAt(x, z) + 0.26 * kerb + 0.55 * puddleAt(x, z))
              * ao * edgeFade(x, z);
      }
      g.deleteAttribute("normal");
      g.deleteAttribute("uv");
      g.setAttribute("aWet", new THREE.BufferAttribute(aW, 1));
      geos.push(g);
    }
    if (geos.length) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: GROUND_HOOKS.time,
          uGain: { value: 2.3 },
          uAR: { value: 0.30 },   // radial roughness of the water film
          uAT: { value: 0.075 },  // tangential roughness — the streak's WIDTH
          uLPos: { value: uPos },
          uLCol: { value: uCol },
        },
        vertexShader: /* glsl */ `
          attribute float aWet;
          varying vec3 vW; varying float vWet;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vW = wp.xyz; vWet = aWet;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uGain, uAR, uAT;
          uniform vec4 uLPos[${SPEC_SLOTS}];
          uniform vec3 uLCol[${SPEC_SLOTS}];
          varying vec3 vW; varying float vWet;
          void main() {
            if (vWet < 0.02) discard;
            vec3 toC = cameraPosition - vW;
            vec3 V = toC / max(length(toC), 1e-4);
            // Rain-agitated micro-tilt of the water film: two scrolling wave
            // trains perturb the SURFACE NORMAL (not the reflected ray), which
            // is what a real film does and what makes the streak shiver and
            // ladder instead of sitting there like paint.
            float r1 = sin(vW.x * 3.10 + uTime * 1.7) * sin(vW.z * 2.70 - uTime * 1.3);
            float r2 = sin(vW.x * 7.30 - uTime * 2.9) * sin(vW.z * 6.10 + uTime * 2.2);
            vec3 N = normalize(vec3((r1 + 0.55 * r2) * 0.020 * vWet, 1.0,
                                    (r2 - 0.55 * r1) * 0.020 * vWet));
            // grazing gain: a wet surface is a Fresnel mirror at low angles and
            // nearly matte from straight above — which is why this payoff
            // belongs to the street-level camera and stays quiet in top-downs.
            float graze = 0.22 + 0.78 * smoothstep(0.0, 0.55, 1.0 - abs(V.y));
            vec3 sum = vec3(0.0);
            for (int i = 0; i < ${SPEC_SLOTS}; i++) {
              vec4 LP = uLPos[i];
              vec3 Lv = LP.xyz - vW;
              float dl = length(Lv);
              if (dl > LP.w) continue;
              vec3 L = Lv / max(dl, 1e-4);
              // ANISOTROPIC lobe, and the anisotropy IS the fix. An isotropic
              // lobe cannot make a streak: measured on iter67/68 it painted a
              // patch at 1.10:1 and 0.36:1 vertical-to-horizontal against the
              // contract's >= 3:1, because a lobe slack enough to still be
              // alive 25 m down the road is also about 2.4 m WIDE by the time
              // it gets there. Splitting the half-vector's tangent-plane tilt
              // into its RADIAL part (along the ground line to the lamp) and
              // its TANGENTIAL part, and running the tangential axis ~4x
              // tighter, keeps the reach and collapses the width. Not a cheat:
              // a rain-struck water film has flow-stretched microfacets, and
              // that is the physical reason wet-road reflections streak.
              vec3 H = normalize(V + L);
              float NoH = dot(N, H);
              if (NoH <= 0.0) continue;
              vec3 Hn = H - N * NoH;
              vec3 T = normalize(vec3(L.x, 0.0, L.z) + vec3(1e-5, 0.0, 1e-5));
              vec3 B = vec3(-T.z, 0.0, T.x);
              float ht = dot(Hn, T) / uAR;
              float hb = dot(Hn, B) / uAT;
              float q = ht * ht + hb * hb;
              // three nested widths off ONE anisotropic distance: the mirror
              // image of the lamp head, the streak, and a halo that ties the
              // streak to the road it is lying on
              float lobe = exp(-q / 0.09) * 0.85 + exp(-q) * 0.85 + exp(-q / 4.0) * 0.018;
              float atten = 1.0 - smoothstep(LP.w * 0.55, LP.w, dl);
              sum += uLCol[i] * lobe * atten;
            }
            gl_FragColor = vec4(sum * (vWet * graze * uGain), 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.name = "wet_specular";
      mesh.renderOrder = 8; // under the fog discs (9) and head glows (11)
      mesh.frustumCulled = false;
      if (mesh.layers) mesh.layers.enable(3); // seen by the planar mirror pass
      group.add(mesh);
      console.log(`[level] wet-specular sheet: ${geos.length} road panels, ` +
        `${chosen.length}/${SPEC_SLOTS} practical slots (VT §4.2 streak payoff)`);
    }
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
    // The level's ONE ripple clock hangs off this mesh, and three other
    // consumers now read it (puddle ripple normals, the wet-specular streak
    // layer, the tide rings). A culled driver is a stopped clock, so this
    // mesh opts out of frustum culling — it is a 24x12 grid, the cheapest
    // possible always-on draw, and it sits at the map edge where it was
    // visible in most framings anyway.
    mesh.frustumCulled = false;
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
  // Generator-placed facade grime, filled by the building pass and consumed by
  // section 7. VT §3: "no 4 m² of surface without at least one unique breakup
  // element" — iter03/iter81 facades had exactly zero, because the only wall
  // decals authored were four door jambs and one perimeter run.
  // Each entry: [x, y, z, w, h, ry, kind].
  const facadeDecalQ = [];
  {
    const wallGeos = { a: [], b: [], c: [] };
    const trimGeos = [], roofGeos = [];
    const wr = rng(90210);
    let litCount = 0;

    // ---- WINDOW STATES (ranked fix #9; VT §1 amateur tell #3 "the dead black
    // window texture"). iter04 measured facade windows at RGB 9/10/15 across a
    // whole building, and all three critics named it independently: "dozens of
    // dead flat-black window rectangles with no glass, no frame depth and no
    // interior shell, repeated in identical grid rows".
    //
    // Two separate defects hide inside that one sentence and they need
    // different fixes. (1) The panes were BLACK: windowDark is a 0x555a60 tint
    // over a 0x141a24..0x080a0e atlas, which multiplies out near 0.005 linear —
    // black by construction, whatever the lighting does. (2) There were only
    // TWO states in the whole ward, lit and dead, at a flat 12% coin flip.
    // A real block at midnight shows warm rooms, blue TV/fluorescent rooms,
    // rooms lit through a blind, empty rooms whose glass mirrors the sky, and
    // boarded openings — and the lit ones CLUSTER, because a lit room usually
    // has a lit neighbour.
    //
    // Six states, built as clones of A3's two so the atlas, the fog flag and
    // the vocabulary all stay single-sourced. The unlit ones are never black:
    // glassA/glassB are low-roughness dielectrics with a strong envMap, so
    // they mirror the storm sky and the city glow — that IS the "interior
    // shell" read, at zero geometry, and it is what real glass does at night.
    const WIN = (() => {
      const mk = (base, f) => { const m = base.clone(); f(m); return m; };
      const glassTex = M.canvasTex(glassPaneAtlas(160), { wrap: false });
      // The three glass tiers differ in how they RESPOND, not only in what is
      // painted on them: roughness and envMapIntensity set how much of the
      // view-dependent cube reflection each pane carries, so a clean pane and
      // the grimy one next to it break differently as the camera moves.
      const dark = (color, rough, env, emi) => mk(M.windowDark, (m) => {
        m.map = glassTex; m.color.set(color);
        m.roughness = rough; m.envMapIntensity = env;
        m.emissiveMap = glassTex; m.emissive.set(0xffffff); m.emissiveIntensity = emi;
      });
      return {
        lit_warm: M.windowLit,
        lit_cool: mk(M.windowLit, (m) => {
          m.emissive.set(0xc4d8ff); m.emissiveIntensity = 1.05; // fluorescent / screen
        }),
        lit_dim: mk(M.windowLit, (m) => {
          m.emissive.set(0xffbe78); m.emissiveIntensity = 0.40; // hall light through a door
        }),
        // blind/curtain/dim-room/ply cells (atlas row 3) — lit by the world,
        // barely a mirror at all
        blind: mk(M.windowDark, (m) => {
          m.map = glassTex; m.color.set(0x8d887c);
          m.roughness = 0.66; m.envMapIntensity = 0.40;
          m.emissiveMap = glassTex; m.emissive.set(0xffffff); m.emissiveIntensity = 0.05;
        }),
        glassA: dark(0x2c3546, 0.05, 3.0, 0.185),  // clean: sharp mirror
        glassB: dark(0x39424f, 0.16, 2.0, 0.120),  // grimy: dimmer, softer
        glassC: dark(0x333b46, 0.31, 1.15, 0.080), // old/pitted: scatters it
      };
    })();
    const winByState = {
      lit_warm: [], lit_cool: [], lit_dim: [], blind: [], glassA: [], glassB: [], glassC: [],
    };
    const LIT_STATE = { lit_warm: 1, lit_cool: 1, lit_dim: 1 };
    // fam = which orientation family of the glass atlas this face reflects.
    // Two faces of the SAME building now mirror different sky sectors.
    const faceDirs = [
      { n: [1, 0], ax: "z", fam: 0 }, { n: [-1, 0], ax: "z", fam: 1 },
      { n: [0, 1], ax: "x", fam: 2 }, { n: [0, -1], ax: "x", fam: 3 },
    ];
    for (const b of layout.buildings) {
      if (!b.box) continue;
      const key = ["a", "b", "c"][(b.id.charCodeAt(4) || 0) % 3];
      // ---- per-building window RHYTHM. The "perfect copy-paste rows at
      // identical spacing" tell was literal: column pitch 2.70, floor pitch
      // 2.95 and pane 1.25x1.55 were four GLOBAL constants, so every mass in
      // the ward was drawn on the same graph paper and two adjacent facades
      // lined up to the millimetre. Buildings put up by different people in
      // different decades do not. Derived from the building's own id so the
      // rhythm is stable across runs (R21) and unique per mass.
      let _bh = 2166136261;
      for (let i = 0; i < b.id.length; i++) { _bh ^= b.id.charCodeAt(i); _bh = Math.imul(_bh, 16777619); }
      const bSeed = rng(_bh >>> 0);
      const colPitch = 2.30 + bSeed() * 0.95;   // 2.30 – 3.25 m
      const floorPitch = 2.72 + bSeed() * 0.55; // 2.72 – 3.27 m
      const winW = 0.95 + bSeed() * 0.55;       // 0.95 – 1.50 m
      const winH = 1.30 + bSeed() * 0.50;       // 1.30 – 1.80 m
      // rhythm breakers: paired openings (tight inner gap, wide outer) on some
      // masses, and a per-building sill height. An even comb of identical gaps
      // is half of what "same stamp" means.
      const paired = bSeed() < 0.45;
      const pairJit = paired ? colPitch * (0.14 + bSeed() * 0.13) : 0;
      const winY0 = 2.00 + bSeed() * 0.35;
      const hw = winW / 2, hh = winH / 2;
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
      // ---- plinth: a 55 cm splash course round the base of EVERY mass,
      // including the low sheds that get no windows and no string course and
      // therefore shipped as literally bare boxes (iter81 S8, near building).
      // It grounds the mass, gives the splash-zone grime something to sit on,
      // and costs four merged boxes.
      trimGeos.push(boxGeo([min[0] - 0.09, 0, min[2] - 0.09], [max[0] + 0.09, 0.55, min[2] + 0.02]));
      trimGeos.push(boxGeo([min[0] - 0.09, 0, max[2] - 0.02], [max[0] + 0.09, 0.55, max[2] + 0.09]));
      trimGeos.push(boxGeo([min[0] - 0.09, 0, min[2]], [min[0] + 0.02, 0.55, max[2]]));
      trimGeos.push(boxGeo([max[0] - 0.02, 0, min[2]], [max[0] + 0.09, 0.55, max[2]]));
      // splash-zone grime every ~6 m along the two long faces
      for (let sx = min[0] + 3; sx < max[0] - 1; sx += 6.2) {
        facadeDecalQ.push([sx + wr() * 2, 1.15, max[2] + 0.03, 1.5, 1.9, 0, "drip_stain"]);
        facadeDecalQ.push([sx + wr() * 2, 1.15, min[2] - 0.03, 1.5, 1.9, Math.PI, "drip_stain"]);
      }

      // ---- string courses: a shallow ledge at every floor line, all round.
      // The cheapest possible fix for "buildings read as untextured boxes":
      // a 12 cm proud, 18 cm tall band catches the moon on its top face and
      // throws a hard shadow on the wall under it, so one flat plane becomes
      // three tonal bands with a real horizon of its own. Merged into the SAME
      // trim batch — no extra draw call, no extra material.
      const bFloors = b.floors || 1;
      for (let fl = 1; fl < bFloors; fl++) {
        const cy = 0.7 + fl * floorPitch; // tracks the window rows, per building
        if (cy > max[1] - 0.9) break;
        trimGeos.push(boxGeo([min[0] - 0.12, cy, min[2] - 0.12], [max[0] + 0.12, cy + 0.18, min[2] + 0.02]));
        trimGeos.push(boxGeo([min[0] - 0.12, cy, max[2] - 0.02], [max[0] + 0.12, cy + 0.18, max[2] + 0.12]));
        trimGeos.push(boxGeo([min[0] - 0.12, cy, min[2]], [min[0] + 0.02, cy + 0.18, max[2]]));
        trimGeos.push(boxGeo([max[0] - 0.02, cy, min[2]], [max[0] + 0.12, cy + 0.18, max[2]]));
      }
      // ---- downpipes at the two street-facing corners, with a rust runnel
      // under each: vertical silhouette breakers, and the wet-wall streak they
      // justify is the single most photographic piece of grime on a facade.
      if (max[1] >= 5) {
        for (const [px, pz] of [[min[0] + 0.34, max[2] + 0.14], [max[0] - 0.34, max[2] + 0.14]]) {
          const pipe = new THREE.CylinderGeometry(0.085, 0.085, max[1] - 0.2, 7);
          pipe.translate(px, (max[1] - 0.2) / 2, pz);
          worldUV(pipe);
          trimGeos.push(withAowet(pipe));
          // collar brackets
          for (let by = 1.6; by < max[1] - 1.0; by += 2.95) {
            trimGeos.push(boxGeo([px - 0.14, by, pz - 0.16], [px + 0.14, by + 0.1, pz + 0.02]));
          }
          facadeDecalQ.push([px + 0.02, 1.9, pz + 0.05, 0.55, 3.2, 0, "rust_streak"]);
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
        const cols = Math.floor((span - winW - 1.2) / colPitch) + 1;
        if (cols < 1) continue;
        const pad = (span - (cols - 1) * colPitch) / 2;
        // one blank bay on longer faces — a service riser or a stair core.
        // Nothing breaks a copy-paste comb like a missing tooth.
        const blankCol = (cols > 4 && wr() < 0.42) ? 1 + ((wr() * (cols - 2)) | 0) : -1;
        // the cell each column drew on the floor BELOW, so a pane can be forced
        // to differ from its neighbour underneath as well as its neighbour left
        const belowCell = new Array(cols).fill(-1);
        let prevLit = false;
        for (let fl = 0; fl < floors; fl++) {
          const wy = winY0 + fl * floorPitch;
          if (wy + hh + 0.15 > max[1] - 0.6) break;
          prevLit = false; // a new floor starts a new occupancy run
          let leftCell = -1;
          for (let cJ = 0; cJ < cols; cJ++) {
            if (cJ === blankCol) { prevLit = false; leftCell = -1; belowCell[cJ] = -1; continue; }
            const wc = lo + pad + cJ * colPitch + (paired ? (cJ % 2 ? -pairJit : pairJit) : 0);
            // VT §1 / D7-10: "every window either lit or honestly dark". At
            // 19 lit windows across the whole ward, a long facade (S5) had none
            // and the street read abandoned rather than working-late. The flat
            // 12% coin flip that replaced it sprinkled them instead: lit rooms
            // cluster, so a lit neighbour raises the odds sharply.
            const pLit = prevLit ? 0.44 : 0.085;
            let state, boarded = false;
            if (litCount < 46 && wr() < pLit) {
              const t = wr();
              state = t < 0.56 ? "lit_warm" : t < 0.82 ? "lit_dim" : "lit_cool";
              litCount++; prevLit = true;
            } else {
              prevLit = false;
              const t = wr();
              if (t < 0.055) { state = "glassA"; boarded = true; }
              else if (t < 0.27) state = "blind";
              else if (t < 0.53) state = "glassA";
              else if (t < 0.79) state = "glassB";
              else state = "glassC";
            }
            const lit = !!LIT_STATE[state];
            // A boarded opening keeps its reveal but loses its pane — the
            // cheapest possible break in a facade's rhythm, and every derelict
            // port block has a few.
            if (boarded) {
              leftCell = -1; belowCell[cJ] = -1; // no pane here to match against
              const bd = 0.06;
              if (f.n[0]) {
                const s = f.n[0] > 0 ? 1 : -1;
                trimGeos.push(boxGeo([facePos + (s > 0 ? 0 : -bd), wy - hh, wc - hw],
                                     [facePos + (s > 0 ? bd : 0), wy + hh, wc + hw]));
              } else {
                const s = f.n[1] > 0 ? 1 : -1;
                trimGeos.push(boxGeo([wc - hw, wy - hh, facePos + (s > 0 ? 0 : -bd)],
                                     [wc + hw, wy + hh, facePos + (s > 0 ? bd : 0)]));
              }
            } else {
              const g = new THREE.PlaneGeometry(winW, winH);
              const wpx = f.n[0] ? facePos : wc, wpz = f.n[0] ? wc : facePos;
              const h = paneHash(wpx, wy, wpz);
              const flip = (h & 8) !== 0;
              const uv = g.getAttribute("uv");
              let cell;
              if (lit) {
                // lit panes still live on materials.js's 4×2 window atlas
                // (row 0 = the four warm interiors)
                cell = h % 4;
                if (cell === leftCell) cell = (cell + 1) % 4;
                for (let i = 0; i < uv.count; i++) {
                  const u = flip ? 1 - uv.getX(i) : uv.getX(i);
                  uv.setXY(i, (cell + u) / 4, 0.5 + uv.getY(i) / 2);
                }
              } else {
                // glass/interior panes live on the 8×4 pane atlas. The
                // orientation family comes from the FACE, the cell inside it
                // from the pane's world position — then it is forced away from
                // the pane on its left and the pane below, so "two adjacent
                // panes carry the same highlight" cannot happen.
                const isInt = state === "blind";
                const base = isInt ? GLASS_INTERIOR0 : f.fam * GLASS_FAMN;
                const span2 = isInt ? (GLASS_COLS * GLASS_ROWS - GLASS_INTERIOR0) : GLASS_FAMN;
                let k = h % span2;
                for (let guard = 0; guard < span2; guard++) {
                  cell = base + k;
                  if (cell !== leftCell && cell !== belowCell[cJ]) break;
                  k = (k + 1) % span2;
                }
                const cx = cell % GLASS_COLS, cyr = (cell / GLASS_COLS) | 0;
                for (let i = 0; i < uv.count; i++) {
                  const u = flip ? 1 - uv.getX(i) : uv.getX(i);
                  uv.setXY(i, (cx + u) / GLASS_COLS,
                    (GLASS_ROWS - 1 - cyr + uv.getY(i)) / GLASS_ROWS);
                }
              }
              leftCell = cell; belowCell[cJ] = cell;
              if (f.n[0] > 0) { g.rotateY(Math.PI / 2); g.translate(facePos + 0.03, wy, wc); }
              else if (f.n[0] < 0) { g.rotateY(-Math.PI / 2); g.translate(facePos - 0.03, wy, wc); }
              else if (f.n[1] > 0) { g.translate(wc, wy, facePos + 0.03); }
              else { g.rotateY(Math.PI); g.translate(wc, wy, facePos - 0.03); }
              winByState[state].push(g);
            }
            if (lit) litWindows.push([f.n[0] ? facePos + f.n[0] * 0.03 : wc, wy, f.n[1] ? facePos + f.n[1] * 0.03 : wc, f.n]);
            // ---- reveal: jambs + lintel standing 11 cm proud of the wall,
            // opening exactly the glass size. The glass then sits at the BACK
            // of a real box, so the key throws a hard jamb shadow across it and
            // the lintel shades its top — a window reads as an opening in a
            // thick wall instead of a sticker on a flat plane (iter03/81 tell).
            const rp = 0.11, jw = 0.13, sw = winW + 0.15;
            const yb = wy - hh - 0.075, yt = wy + hh + 0.125;
            const n0 = f.n[0], n1 = f.n[1];
            const lo0 = (n) => facePos + Math.min(0, n * rp) - 0.01;
            const hi0 = (n) => facePos + Math.max(0, n * rp) + 0.01;
            if (n0) {
              const a = lo0(n0), bx = hi0(n0);
              // jambs
              trimGeos.push(boxGeo([a, yb, wc - hw - jw], [bx, yt, wc - hw]));
              trimGeos.push(boxGeo([a, yb, wc + hw], [bx, yt, wc + hw + jw]));
              // lintel
              trimGeos.push(boxGeo([a, wy + hh, wc - hw - jw], [bx, yt, wc + hw + jw]));
              // sill (sloped read: sits proud of the jambs)
              trimGeos.push(boxGeo([a - 0.04, yb - 0.05, wc - sw / 2], [bx + 0.04, yb + 0.06, wc + sw / 2]));
              facadeDecalQ.push([facePos + n0 * 0.02, wy - hh - 0.85, wc, winW, 1.4, n0 > 0 ? Math.PI / 2 : -Math.PI / 2, "drip_stain"]);
            } else {
              const a = lo0(n1), bz = hi0(n1);
              trimGeos.push(boxGeo([wc - hw - jw, yb, a], [wc - hw, yt, bz]));
              trimGeos.push(boxGeo([wc + hw, yb, a], [wc + hw + jw, yt, bz]));
              trimGeos.push(boxGeo([wc - hw - jw, wy + hh, a], [wc + hw + jw, yt, bz]));
              trimGeos.push(boxGeo([wc - sw / 2, yb - 0.05, a - 0.04], [wc + sw / 2, yb + 0.06, bz + 0.04]));
              facadeDecalQ.push([wc, wy - hh - 0.85, facePos + n1 * 0.02, winW, 1.4, n1 > 0 ? 0 : Math.PI, "drip_stain"]);
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
    // Six merged window meshes (was two). +4 draw calls out of ~244 buys the
    // whole "a living building" read; the panes stay merged per state so the
    // batch count never scales with window count.
    let winTotal = 0;
    for (const k of Object.keys(winByState)) {
      const arr = winByState[k];
      if (!arr.length) continue;
      winTotal += arr.length;
      const m = new THREE.Mesh(mergeGeometries(arr, false), WIN[k]);
      m.name = `windows_${k}`;
      m.castShadow = false;
      m.receiveShadow = true;
      group.add(m);
    }
    console.log(`[level] windows ${winTotal} panes in 7 states, ${litCount} lit ` +
      `(warm/dim/cool); glass atlas ${GLASS_COLS}x${GLASS_ROWS} = ` +
      `${GLASS_COLS * GLASS_ROWS} cells (4 orientation families x ${GLASS_FAMN} + ` +
      `${GLASS_COLS * GLASS_ROWS - GLASS_INTERIOR0} interiors), cell chosen by world ` +
      `position and forced != left/below neighbour (iter06 strike #8)`);
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

  // Bounce light off wet stone is markedly LESS saturated than the source that
  // threw it (same physical fact lighting.js's BOUNCE_SAT encodes). Feeding the
  // sign's own hex straight into an additive pool painted iter03 S4 as a flat
  // pure-red gel with no surface under it — a colour filter laid over the
  // ground, not light landing on it. 0.5 chroma retention, normalised so
  // desaturating is not also a dimmer.
  const POOL_SAT = 0.32;
  function poolTint(color) {
    const c = new THREE.Color(color);
    const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    c.r = luma + (c.r - luma) * POOL_SAT;
    c.g = luma + (c.g - luma) * POOL_SAT;
    c.b = luma + (c.b - luma) * POOL_SAT;
    return c.multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-5));
  }
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
    const col = poolTint(color);
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
        // iter03 S7: this was a 6.2 m PlaneGeometry with a flat emissive
        // MeshStandardMaterial — from inside the arcade it read as a hard-edged
        // white trapezoid pasted into the roof, the single worst artefact in
        // the battery. A skylight is not a light-box: it is HAZE hanging in the
        // shaft under a hole. Same footprint, but additive with a radial
        // falloff (TEX.pool), so it has no edge to give the plane away, and it
        // sums with the god-ray cone instead of competing with it.
        const rim = M.poolMat(0xffffff, 0.42);
        rim.vertexColors = true; // share light_pools' exact program variant
        const rg = new THREE.PlaneGeometry(6.2, 6.2);
        rg.rotateX(Math.PI / 2); // faces down into the lightwell
        rg.translate(-32, 8.13, -8);
        {
          const tint = poolTint(0x9fb0cf);
          const rp = rg.getAttribute("position");
          const rc = new Float32Array(rp.count * 3);
          for (let i = 0; i < rp.count; i++) { rc[i * 3] = tint.r; rc[i * 3 + 1] = tint.g; rc[i * 3 + 2] = tint.b; }
          rg.setAttribute("color", new THREE.BufferAttribute(rc, 3));
        }
        const rmesh = new THREE.Mesh(rg, rim);
        rmesh.name = "skylight_glow";
        rmesh.renderOrder = 2;
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
      const col = poolTint(color);
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
      // discs + the real spot into the iter01 S4 orange-soup wash.
      // 0.18 -> 0.10 (LaneC/iter05): this decal IS the "round blob" all three
      // iter04 critics identified — "S5's lamp throws a soft ROUND blob on the
      // street, not a streak", "round blob gradients under each lamp, which
      // read as painted ground decals rather than reflected light". It was
      // also outshining the new wet-specular layer, so the streak had nothing
      // to be seen against. Kept, not deleted: a real sodium head does throw a
      // diffuse pool. It just has to sit UNDER the reflection, not over it.
      const mat = M.poolMat(0xffffff, 0.10);
      mat.vertexColors = true;
      const m = new THREE.Mesh(mergeGeometries(poolStatic, false), mat);
      m.name = "light_pools";
      m.renderOrder = 2;
      group.add(m);
    }
    if (poolPlaza.length) {
      // 0.18 → 0.11: the plaza pools overlap 5 signs' worth of spill on one
      // patch of cobble, and at the corrected exposure the stack read as a
      // saturated gel laid over the stones rather than light landing on them
      // (iter81 S4). Additive spill has to stay UNDER the surface it lands on
      // or the surface stops existing.
      const mat = M.poolMat(0xffffff, 0.075);
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
    // generator-placed facade grime: a sill drip under EVERY window and a rust
    // runnel beside every downpipe, emitted by the building pass (section 3).
    for (const d of facadeDecalQ) wq(d[0], d[1], d[2], d[3], d[4], d[5], d[6]);
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
