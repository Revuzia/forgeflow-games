// core/level/materials.js [A3] — PBR material library for Meridian Ward.
// Architecture §3.12 (frozen export makeMaterials(ctx)); VT §3 (roughness
// VARIANCE on every hero surface, anti-tiling, metres/TILE UVs, grime);
// LD §5.4 (wetness pulls baked at setup, puddle masks via the 'aowet'
// vertex attribute, ripple normals, R18 planar/env hook).
//
// Sources (BUILD_PLAN Part 4): Poly Haven asphalt/cobble sets + FFG
// generated-materials, prepped to WebP by tools/prep_level_assets.py
// (normals Sobel-generated from displacement — sets ship no normal maps),
// PLUS three authored sets from tools/a3_gen_surface_sets.py —
// concrete_formed (walls/trim/interior), wall_render (facades: cement render
// over brick), metal_panel (painted steel). Everything else is
// canvas-procedural, generated ONCE here at construction (prewarm-friendly:
// all materials exist in-scene before the phase-5 compileAsync passes, so no
// mission-time program compiles).
//
// TEXEL DENSITY (doctrine §3, VT §3) — read this before adding a material.
// The tile scale is the `tile` option below, in METRES PER TILE, and the
// shader projects its own uv from world position; it does NOT come from
// texture.repeat applied to whatever uv attribute the geometry happens to
// carry. That indirection is what produced iter04's worst D3 tells — the
// generators disagree about uv units (level.js emits metres, props.js passes
// BoxGeometry 0..1 straight through), and `concreteInterior` shipped at 1
// m/tile beside `concreteWall` at 4.6 simply by not calling a helper.
// A material with a tiling map and no `tile` is a bug.
//
// Shared shader layer (onBeforeCompile, one static variant per material —
// no runtime defines flip, so the program count is fixed at boot):
//   - world-space grunge overlay at three NON-INTEGER scales → roughness
//     variance + albedo mottle on every large surface (anti-tiling a+b);
//   - analytic MACRO STRUCTURE in world metres, amplitudes `seam` and `wear`:
//     form-work board courses and panel joints on walls, slab joints on
//     floors, thresholded aggregate chips, drainage runs down vertical faces,
//     and ground-contact splash grime. All of it moves ROUGHNESS as well as
//     albedo (a seam that only darkens is paint), and all of it fades out
//     past ~40 m so it cannot alias into shimmer;
//   - optional 'aowet' vec3 vertex attribute: r = baked AO/macro tint,
//     g = puddle mask (roughness→0.04, ripple normal, planar blend),
//     b = wet/grime streak factor (wall bases, gutters);
//   - ground materials expose GROUND_HOOKS uniforms for A6's reflect.js:
//     set planarTex/planarMat/planarStrength to feed the 3 hero puddles
//     (512 px pass, LD §5.4); strength 0 ⇒ envMap fallback (R18 cube via
//     scene.environment — A6). time drives the rain-agitated ripple.
//
// Vertex-color channels are NOT used for tint (three would multiply
// diffuse); the custom attribute keeps semantics explicit.

import * as THREE from "three";

let CACHE = null;

// ---------------------------------------------------------------- canvas
function cnv(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// deterministic rng for texture synthesis (fixed seed — battery-stable)
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoiseCanvas(size, octaves, seed, contrast = 1) {
  const rnd = mulberry(seed);
  const c = cnv(size, size), g = c.getContext("2d");
  const img = g.createImageData(size, size);
  // layered wrapped value noise
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o, grid = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) grid[i] = rnd();
    layers.push({ n, grid, amp: 1 / (1 << o) });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, tot = 0;
      for (const L of layers) {
        const fx = (x / size) * L.n, fy = (y / size) * L.n;
        const x0 = Math.floor(fx) % L.n, y0 = Math.floor(fy) % L.n;
        const x1 = (x0 + 1) % L.n, y1 = (y0 + 1) % L.n;
        const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
        const a = L.grid[y0 * L.n + x0], b = L.grid[y0 * L.n + x1];
        const cc = L.grid[y1 * L.n + x0], d = L.grid[y1 * L.n + x1];
        v += ((a + (b - a) * tx) + ((cc + (d - cc) * tx) - (a + (b - a) * tx)) * ty) * L.amp;
        tot += L.amp;
      }
      v = (v / tot - 0.5) * contrast + 0.5;
      const p = (y * size + x) * 4, b8 = Math.max(0, Math.min(255, v * 255)) | 0;
      img.data[p] = b8; img.data[p + 1] = b8; img.data[p + 2] = b8; img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// THREE independent noises packed into r/g/b for the grunge overlay.
// b was a constant 128 until iter05; it now carries a high-octave noise so the
// micro tap can drive SPARSE aggregate chips (thresholded) instead of the
// uniform full-coverage crackle all three iter04 critics read as TV static —
// a third channel on a tap we were already paying for.
function grungeCanvas(size) {
  const a = valueNoiseCanvas(size, 5, 101, 1.35);
  const b = valueNoiseCanvas(size, 3, 707, 1.6);
  const d = valueNoiseCanvas(size, 6, 313, 1.5);
  const c = cnv(size, size), g = c.getContext("2d");
  const ia = a.getContext("2d").getImageData(0, 0, size, size);
  const ib = b.getContext("2d").getImageData(0, 0, size, size);
  const id = d.getContext("2d").getImageData(0, 0, size, size);
  const out = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4] = ia.data[i * 4];
    out.data[i * 4 + 1] = ib.data[i * 4];
    out.data[i * 4 + 2] = id.data[i * 4];
    out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return c;
}

// rain-agitated ripple normal map (rg = xy, b = z)
function rippleCanvas(size) {
  const rnd = mulberry(4242);
  const h = new Float32Array(size * size);
  for (let k = 0; k < 90; k++) {
    const cx = rnd() * size, cy = rnd() * size, r = 4 + rnd() * 22, amp = 0.4 + rnd() * 0.6;
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y < cy + r; y++) {
      for (let x = Math.floor(cx - r); x < cx + r; x++) {
        const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const xi = ((x % size) + size) % size, yi = ((y % size) + size) % size;
        h[yi * size + xi] += Math.sin((d / r) * Math.PI * 2.5) * amp * (1 - d / r);
      }
    }
  }
  const c = cnv(size, size), g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const at = (x, y) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 0.8;
      const ny = (at(x, y - 1) - at(x, y + 1)) * 0.8;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      const p = (y * size + x) * 4;
      img.data[p] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[p + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[p + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// 4×4 decal atlas — grime/AO/rust/oil/paper breakup (VT §3: the grime pass
// is not optional). Cell layout is exported as DECAL_UV.
function decalAtlasCanvas(size) {
  const c = cnv(size, size), g = c.getContext("2d");
  const cs = size / 4;
  g.clearRect(0, 0, size, size);
  const rnd = mulberry(9001);
  const cell = (cx, cy, fn) => {
    g.save();
    g.translate(cx * cs, cy * cs);
    g.beginPath(); g.rect(0, 0, cs, cs); g.clip();
    fn();
    g.restore();
  };
  const radial = (r0, r1, a0, a1, col = "0,0,0") => {
    const gr = g.createRadialGradient(cs / 2, cs / 2, cs * r0, cs / 2, cs / 2, cs * r1);
    gr.addColorStop(0, `rgba(${col},${a0})`);
    gr.addColorStop(1, `rgba(${col},${a1})`);
    g.fillStyle = gr; g.fillRect(0, 0, cs, cs);
  };
  const speckle = (n, col, a, rMax) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${col},${a * (0.4 + rnd() * 0.6)})`;
      const r = 1 + rnd() * rMax;
      g.beginPath();
      g.arc(cs * 0.15 + rnd() * cs * 0.7, cs * 0.15 + rnd() * cs * 0.7, r, 0, 7);
      g.fill();
    }
  };
  cell(0, 0, () => { radial(0.05, 0.48, 0.62, 0); speckle(70, "20,16,12", 0.35, 3); });          // ao_blob
  cell(1, 0, () => { radial(0.22, 0.5, 0.0, 0.55); radial(0.0, 0.3, 0.5, 0.1); speckle(90, "28,22,14", 0.4, 2.5); }); // grime_ring
  cell(2, 0, () => { radial(0.1, 0.45, 0.45, 0); speckle(160, "50,30,16", 0.5, 2); });            // rust_ring
  cell(3, 0, () => { radial(0.08, 0.46, 0.5, 0); speckle(120, "38,32,20", 0.45, 3.5); });         // dirt_ring
  cell(0, 1, () => { radial(0.02, 0.42, 0.72, 0); speckle(50, "8,8,8", 0.5, 4); });               // scorch_ring
  cell(1, 1, () => {                                                                              // edge_chip
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(30,28,24,${0.25 + rnd() * 0.4})`;
      g.fillRect(rnd() * cs, cs * 0.3 + rnd() * cs * 0.5, 2 + rnd() * 10, 2 + rnd() * 5);
    }
    radial(0.1, 0.5, 0.3, 0);
  });
  cell(2, 1, () => {                                                                              // rust_streak (vertical)
    for (let i = 0; i < 16; i++) {
      const x = cs * 0.25 + rnd() * cs * 0.5, w = 1 + rnd() * 4, l = cs * (0.4 + rnd() * 0.55);
      const gr = g.createLinearGradient(0, 0, 0, l);
      gr.addColorStop(0, `rgba(70,40,18,${0.4 + rnd() * 0.3})`);
      gr.addColorStop(1, "rgba(70,40,18,0)");
      g.fillStyle = gr; g.fillRect(x, 0, w, l);
    }
  });
  cell(3, 1, () => {                                                                              // drip_stain (under sills)
    for (let i = 0; i < 12; i++) {
      const x = cs * 0.15 + rnd() * cs * 0.7, w = 2 + rnd() * 5, l = cs * (0.3 + rnd() * 0.6);
      const gr = g.createLinearGradient(0, 0, 0, l);
      gr.addColorStop(0, `rgba(25,25,28,${0.35 + rnd() * 0.25})`);
      gr.addColorStop(1, "rgba(25,25,28,0)");
      g.fillStyle = gr; g.fillRect(x, 0, w, l);
    }
  });
  cell(0, 2, () => { radial(0.03, 0.4, 0.66, 0, "10,10,14"); radial(0.0, 0.18, 0.25, 0.05, "40,40,60"); }); // oil_stain
  cell(1, 2, () => {                                                                              // paper_a
    for (let i = 0; i < 7; i++) {
      g.save();
      g.translate(cs / 2 + (rnd() - 0.5) * cs * 0.6, cs / 2 + (rnd() - 0.5) * cs * 0.6);
      g.rotate(rnd() * 6.28);
      g.fillStyle = `rgba(190,186,175,${0.75 + rnd() * 0.2})`;
      g.fillRect(-9, -6, 18, 12);
      g.fillStyle = "rgba(60,60,60,0.5)";
      for (let r = 0; r < 4; r++) g.fillRect(-7, -4 + r * 3, 14, 1);
      g.restore();
    }
  });
  cell(2, 2, () => { radial(0.3, 0.5, 0, 0.35, "16,20,26"); radial(0.28, 0.34, 0.3, 0.05, "60,70,84"); }); // tide_ring
  cell(3, 2, () => {                                                                              // crack
    g.strokeStyle = "rgba(12,12,12,0.65)"; g.lineWidth = 2;
    let x = cs * 0.1, y = cs * (0.3 + rnd() * 0.4);
    g.beginPath(); g.moveTo(x, y);
    while (x < cs * 0.9) { x += 6 + rnd() * 14; y += (rnd() - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
    g.strokeStyle = "rgba(12,12,12,0.4)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cs * 0.45, y); g.lineTo(cs * 0.55, y - cs * 0.3); g.stroke();
  });
  cell(0, 3, () => {                                                                              // wear_edge (hand height)
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(60,58,54,${0.15 + rnd() * 0.25})`;
      g.fillRect(rnd() * cs, cs * 0.42 + (rnd() - 0.5) * cs * 0.15, 4 + rnd() * 16, 2 + rnd() * 3);
    }
  });
  cell(1, 3, () => { radial(0.02, 0.5, 0.5, 0, "30,26,20"); speckle(200, "44,40,30", 0.35, 1.6); }); // splat
  cell(2, 3, () => {                                                                              // stencil 9 (gate)
    g.fillStyle = "rgba(214,200,160,0.85)";
    g.font = `bold ${Math.round(cs * 0.7)}px Arial Narrow, Arial, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("9", cs / 2, cs * 0.55);
  });
  cell(3, 3, () => { radial(0.05, 0.35, 0.6, 0, "18,16,14"); });                                  // small blob
  return c;
}

export const DECAL_UV = {
  ao_blob: [0, 0], grime_ring: [1, 0], rust_ring: [2, 0], dirt_ring: [3, 0],
  scorch_ring: [0, 1], edge_chip: [1, 1], rust_streak: [2, 1], drip_stain: [3, 1],
  oil_stain: [0, 2], paper: [1, 2], tide_ring: [2, 2], crack: [3, 2],
  wear_edge: [0, 3], splat: [1, 3], stencil9: [2, 3], blob_s: [3, 3],
};

function glowCanvas(size) {
  const c = cnv(size, size), g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(0.25, "rgba(255,255,255,0.35)");
  gr.addColorStop(0.6, "rgba(255,255,255,0.08)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

function poolCanvas(size) {
  const c = cnv(size, size), g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.45, "rgba(255,255,255,0.22)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

// interior tile floor (arcade) — grid + grout + wear
function tileCanvas(size) {
  const rnd = mulberry(313);
  const c = cnv(size, size), g = c.getContext("2d");
  g.fillStyle = "#4a453d"; g.fillRect(0, 0, size, size);
  const n = 8, t = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 62 + (rnd() * 26) | 0;
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = `rgba(30,28,24,${rnd() * 0.25})`;
        g.fillRect(x * t + 3 + rnd() * (t - 8), y * t + 3 + rnd() * (t - 8), 2 + rnd() * 6, 1 + rnd() * 3);
      }
    }
  }
  return c;
}

// corrugated shutter/steel sheet (albedo; used with strong grunge overlay)
function corrugatedCanvas(size) {
  const c = cnv(size, size), g = c.getContext("2d");
  for (let x = 0; x < size; x++) {
    const ph = Math.sin((x / size) * Math.PI * 24);
    const v = 92 + ph * 26;
    g.fillStyle = `rgb(${v | 0},${(v * 0.98) | 0},${(v * 0.94) | 0})`;
    g.fillRect(x, 0, 1, size);
  }
  const rnd = mulberry(88);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(52,38,24,${0.1 + rnd() * 0.3})`;
    g.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 8, 6 + rnd() * 40);
  }
  return c;
}

// burlap / sandbag weave
function burlapCanvas(size) {
  const rnd = mulberry(55);
  const c = cnv(size, size), g = c.getContext("2d");
  g.fillStyle = "#6d6250"; g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 3) {
    g.fillStyle = `rgba(40,34,24,${0.18 + rnd() * 0.1})`;
    g.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 3) {
    g.fillStyle = `rgba(90,82,64,${0.14 + rnd() * 0.1})`;
    g.fillRect(x, 0, 1, size);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(30,26,18,${0.08 + rnd() * 0.16})`;
    g.beginPath(); g.arc(rnd() * size, rnd() * size, 4 + rnd() * 18, 0, 7); g.fill();
  }
  return c;
}

// striped kiosk awning fabric
function awningCanvas(size, colA, colB) {
  const c = cnv(size, size), g = c.getContext("2d");
  const n = 8, w = size / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? colA : colB;
    g.fillRect(i * w, 0, w, size);
  }
  const rnd = mulberry(21);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(20,18,16,${0.05 + rnd() * 0.18})`;
    g.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 10, 2 + rnd() * 26);
  }
  return c;
}

// lit / dark window atlas: 4 lit variants (top row) + 4 dark (bottom row)
function windowCanvas(size) {
  const rnd = mulberry(1234);
  const c = cnv(size, size / 2), g = c.getContext("2d");
  const cs = size / 4;
  for (let i = 0; i < 4; i++) {
    // lit: warm interior with curtain/frame structure
    const x0 = i * cs;
    const warm = ["#ffc88a", "#ffbe74", "#f2cf9a", "#ffd9a8"][i];
    g.fillStyle = warm; g.fillRect(x0 + 3, 3, cs - 6, cs - 6);
    g.fillStyle = "rgba(120,70,30,0.55)";
    if (rnd() > 0.4) g.fillRect(x0 + 3, 3, cs * (0.2 + rnd() * 0.3), cs - 6);        // curtain
    if (rnd() > 0.5) g.fillRect(x0 + 3, cs * 0.55, cs - 6, cs * 0.45 - 3);           // half blind
    g.fillStyle = "rgba(30,22,14,0.9)";
    g.fillRect(x0 + cs / 2 - 1, 3, 2, cs - 6); g.fillRect(x0 + 3, cs / 2 - 1, cs - 6, 2);
  }
  for (let i = 0; i < 4; i++) {
    // dark: deep blue-black with faint sky reflection gradient
    const x0 = i * cs, y0 = cs;
    const gr = g.createLinearGradient(0, y0, 0, y0 + cs);
    gr.addColorStop(0, "#141a24"); gr.addColorStop(1, "#080a0e");
    g.fillStyle = gr; g.fillRect(x0 + 3, y0 + 3, cs - 6, cs - 6);
    g.fillStyle = "rgba(90,110,140,0.10)";
    g.fillRect(x0 + 4 + rnd() * 6, y0 + 4, cs * 0.22, cs - 8);
    g.fillStyle = "rgba(10,8,6,0.9)";
    g.fillRect(x0 + cs / 2 - 1, y0 + 3, 2, cs - 6); g.fillRect(x0 + 3, y0 + cs / 2 - 1, cs - 6, 2);
  }
  return c;
}

// neon sign texture: tube-core text with halo (emissive; bloom does the rest)
export function makeNeonCanvas(text, hex, w = 512, h = 128) {
  const c = cnv(w, h), g = c.getContext("2d");
  g.fillStyle = "rgba(4,5,8,1)"; g.fillRect(0, 0, w, h);
  g.font = `bold ${Math.round(h * 0.55)}px "Arial Narrow", Arial, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = hex; g.shadowBlur = h * 0.22;
  g.strokeStyle = hex; g.lineWidth = 3;
  g.strokeText(text, w / 2, h / 2);
  g.shadowBlur = h * 0.1;
  g.fillStyle = "#ffffff";
  g.font = `bold ${Math.round(h * 0.53)}px "Arial Narrow", Arial, sans-serif`;
  g.fillText(text, w / 2, h / 2);
  return c;
}

// painted wall sign (invented brands — IP hygiene LD §7)
export function makeSignCanvas(lines, fg, bg, w = 256, h = 128) {
  const c = cnv(w, h), g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  const fs = Math.round(h / (lines.length + 1) * 0.9);
  g.font = `bold ${fs}px "Arial Narrow", Arial, sans-serif`;
  lines.forEach((t, i) => g.fillText(t, w / 2, (h / (lines.length + 1)) * (i + 1)));
  const rnd = mulberry(text2seed(lines.join("")));
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(20,16,12,${0.08 + rnd() * 0.2})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 14, 1 + rnd() * 6);
  }
  return c;
}
function text2seed(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// ---------------------------------------------------------- shader layer
export const GROUND_HOOKS = {
  planarTex: { value: null },              // A6 reflect.js: 512px mirrored pass
  planarMat: { value: new THREE.Matrix4() }, // texture-projection matrix
  planarStrength: { value: 0.0 },          // 0 ⇒ envMap fallback (dynres floor)
  time: { value: 0.0 },                    // ripple phase (level.js drives)
};

function augment(mat, o = {}) {
  const opts = {
    grunge: 0.35,      // roughness variance amplitude (VT §3 — never 0 on large surfaces)
    mottle: 0.12,      // albedo variance
    aowet: false,      // consume the 'aowet' vertex attribute
    puddle: false,     // puddle mask + ripple + planar (ground only)
    // metres per texture TILE. > 0 switches the material off the geometry's
    // own uv attribute and onto a world-space metre projection (see below) —
    // this is doctrine §3 "UVs in metres/TILE" enforced at SHADE time instead
    // of trusting every generator to emit them.
    tile: 0,
    seam: 0,           // form-work seam / slab-joint amplitude (0 = none)
    wear: 0,           // drainage runs + ground-contact grime + spall chips
    ...o,
  };
  mat.userData.a3 = opts;
  const W = opts.tile > 0;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrunge = { value: TEX.grunge };
    sh.uniforms.uGrungeAmp = { value: opts.grunge };
    sh.uniforms.uMottle = { value: opts.mottle };
    sh.uniforms.uSeam = { value: opts.seam };
    sh.uniforms.uWear = { value: opts.wear };
    if (W) sh.uniforms.uTileScale = { value: 1 / opts.tile };
    if (opts.puddle) {
      if (!GROUND_HOOKS.planarTex.value) GROUND_HOOKS.planarTex.value = TEX.black;
      sh.uniforms.uRipple = { value: TEX.ripple };
      // live shared uniform objects — A6's reflect.js writes .value directly
      sh.uniforms.uPlanarTex = GROUND_HOOKS.planarTex;
      sh.uniforms.uPlanarMat = GROUND_HOOKS.planarMat;
      sh.uniforms.uPlanarStrength = GROUND_HOOKS.planarStrength;
      sh.uniforms.uTime = GROUND_HOOKS.time;
    }
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;
varying vec3 vWN;
${opts.aowet ? "attribute vec3 aowet; varying vec3 vAowet;" : ""}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
{
  vec3 a3n = objectNormal;
  #ifdef USE_INSTANCING
  a3n = mat3( instanceMatrix ) * a3n;
  #endif
  vWN = normalize( mat3( modelMatrix ) * a3n );
}`)
      .replace("#include <project_vertex>", `#include <project_vertex>
{
  vec4 wp4 = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  wp4 = instanceMatrix * wp4;
  #endif
  vWPos = ( modelMatrix * wp4 ).xyz;
}
${opts.aowet ? "vAowet = aowet;" : ""}`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;
varying vec3 vWN;
uniform sampler2D uGrunge;
uniform float uGrungeAmp;
uniform float uMottle;
uniform float uSeam;
uniform float uWear;
${W ? "uniform float uTileScale;" : ""}
${opts.aowet ? "varying vec3 vAowet;" : ""}
${opts.puddle ? `uniform sampler2D uRipple;
uniform sampler2D uPlanarTex;
uniform mat4 uPlanarMat;
uniform float uPlanarStrength;
uniform float uTime;` : ""}`)
      // ------------------------------------------------------------------
      // TEXEL DENSITY, FIXED BY CONSTRUCTION (iter04 ranked fix #4a).
      //
      // Critics measured "two adjacent panels of the SAME wall at wildly
      // different texel densities" and "the noise scale visibly shifting
      // across one flat plane". Root cause, verified in this file: the tile
      // scale lived in `texture.repeat`, applied to whatever uv attribute the
      // GENERATOR happened to emit — and the generators disagree. level.js
      // projects metre UVs for boxGeo, but props.js ships BoxGeometry/
      // CylinderGeometry 0..1 UVs straight through `ensureUV` (which only
      // fills MISSING uvs), so a 0.07 m post and a 30 m string course both got
      // one full tile. And `concreteInterior`/`tileInterior` never called the
      // `uv()` helper at all, so they shaded the SHARED texture instances at
      // repeat (1,1) = 1 m/tile against concreteWall's 4.6 — a 4.6x mismatch
      // on the same concrete, in the arcade interior, which is exactly where
      // the S4 hero material close-up is posed.
      //
      // The fix removes the generator from the loop: every tiled material
      // projects its own uv from WORLD POSITION in metres, per dominant world
      // axis of the surface normal, and `tile` is the metres-per-tile scalar.
      // Redirecting three's uv varyings with a macro (rather than rewriting
      // each map chunk) means map, roughnessMap, normalMap AND the derivative
      // tangent frame in <normal_fragment_begin> all move together — a
      // hand-rewritten map chunk would have left the TBN reading the old uv.
      // On box architecture the normal is constant per face, so the axis
      // choice is constant per face and no switch seam can appear inside one
      // surface.
      .replace("void main() {", `float a3edge(float x, float period, float w) {
  float f = abs(fract(x / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(0.0, w, f);
}
${W ? `vec2 a3uv_() {
  vec3 an = abs(vWN);
  vec2 p = (an.y >= an.x && an.y >= an.z) ? vWPos.xz
         : (an.x >= an.z) ? vec2(vWPos.z, vWPos.y)
         : vec2(vWPos.x, vWPos.y);
  return p * uTileScale;
}
#define vMapUv a3uv_()
#define vRoughnessMapUv a3uv_()
#define vNormalMapUv a3uv_()` : ""}
void main() {`)
      // ------------------------------------------------------------------
      // MATERIAL STRUCTURE (ranked fix #4b/c/d). Everything below is drawn in
      // TRUE WORLD METRES, so it never has to divide into a texture tile and
      // never beats against the tiling. It is the register the critics found
      // missing: "no seams, no bolt lines, no rust runs, no drip marks ... a
      // single-frequency monochrome crackle with identical specular response
      // across every square metre".
      .replace("#include <map_fragment>", `#include <map_fragment>
vec2 gruv = vWPos.xz + vWPos.y * vec2(0.71, 0.37);
vec3 gA = texture2D(uGrunge, gruv * 0.0619).rgb;        // macro   (~16 m)
vec3 gB = texture2D(uGrunge, gruv * 0.0143 + 0.29).rgb; // super   (~70 m)
// close-range tap (~1.2 m period): micro-breakup so surfaces survive the
// S4 close crop — without it the two macro taps read as smooth clay <3 m
vec3 gC = texture2D(uGrunge, gruv * 0.83 + 0.61).rgb;
float g1 = gA.r, g2 = gB.g, g3 = gC.g;

vec3 a3N = normalize(vWN);
float a3wall = 1.0 - smoothstep(0.34, 0.82, abs(a3N.y));   // 1 vertical, 0 floor
// analytic structure aliases into shimmer at range, so fade it out well
// before it can: past ~40 m the macro/mottle terms carry the surface alone
float a3near = 1.0 - smoothstep(14.0, 42.0, distance(vWPos, cameraPosition));

// form-work board courses + panel joints on walls; slab joints on floors
float a3seam = uSeam * a3near * mix(
  max(a3edge(vWPos.x, 2.85, 0.022), a3edge(vWPos.z, 2.85, 0.022)) * 0.8,
  max(a3edge(vWPos.y + 0.13, 1.22, 0.020),
      a3edge(dot(vWPos.xz, vec2(0.94, 0.34)), 2.45, 0.024)),
  a3wall);

// sparse aggregate chips / spall — THRESHOLDED, so ~15% of the surface has
// them and 85% does not. Full-coverage micro noise is the tell; sparsity is
// the fix.
float a3chip = uWear * a3near * smoothstep(0.60, 0.84, gC.b);

// drainage: grime running DOWN vertical faces, strongest under the roofline
float a3run = texture2D(uGrunge,
  vec2(dot(vWPos.xz, vec2(0.82, 0.57)) * 0.52, vWPos.y * 0.030) + 0.17).r;
float a3runm = uWear * a3wall * smoothstep(0.56, 0.92, a3run)
             * smoothstep(9.5, 2.0, vWPos.y);

// ground-contact grime: the splash zone every real wall has, and the edge
// wear VT §3 asks for at ground contacts — applied off WORLD height so it
// also lands on props and on any geometry that skipped the aowet attribute
float a3base = uWear * a3wall * smoothstep(1.25, 0.0, vWPos.y);

diffuseColor.rgb *= (1.0 + uMottle * ((g1 - 0.5) * 1.7 + (g2 - 0.5) * 1.2 + (g3 - 0.5) * 0.55));
diffuseColor.rgb *= (1.0 - a3seam * 0.40 - a3chip * 0.15 - a3base * 0.24);
diffuseColor.rgb = mix(diffuseColor.rgb,
  diffuseColor.rgb * vec3(1.32, 0.80, 0.46), a3runm * 0.42);
${opts.aowet ? `diffuseColor.rgb *= vAowet.r;
diffuseColor.rgb *= (1.0 - vAowet.b * 0.30);` : ""}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor * (1.0 + uGrungeAmp * (g1 - 0.5) * 2.2)
    + uGrungeAmp * 0.55 * (g2 - 0.5)
    + uGrungeAmp * 0.30 * (g3 - 0.5)
    // structure moves ROUGHNESS, not just albedo — a seam that only darkens
    // is paint. Chips expose smoother broken face, runs and the splash zone
    // are matte. This is what makes the specular response stop being
    // "identical across every square metre".
    + a3seam * 0.15 + a3runm * 0.26 + a3base * 0.11 - a3chip * 0.19,
  0.03, 1.0);
${opts.aowet ? "roughnessFactor = clamp(roughnessFactor * (1.0 - vAowet.b * 0.45), 0.03, 1.0);" : ""}
${opts.puddle ? "float pud = vAowet.g; roughnessFactor = mix(roughnessFactor, 0.04, pud);" : ""}`);
    if (opts.puddle) {
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
vec2 ripA = texture2D(uRipple, vWPos.xz * 0.45 + vec2(uTime * 0.030, uTime * 0.021)).xy * 2.0 - 1.0;
vec2 ripB = texture2D(uRipple, vWPos.xz * 0.31 - vec2(uTime * 0.026, uTime * 0.037)).xy * 2.0 - 1.0;
vec2 rip = (ripA + ripB) * 0.5;
normal = normalize(normal + vec3(rip * 0.35, 0.0) * pud);`)
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>
if (pud > 0.001 && uPlanarStrength > 0.001) {
  // uPlanarMat = bias(0.5) * proj * viewInverse (reflect.js) — the 0..1
  // remap is IN the matrix; a second *0.5+0.5 here double-biased the lookup
  vec4 pc = uPlanarMat * vec4(vWPos, 1.0);
  vec2 puv = pc.xy / max(pc.w, 1e-4);
  if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0 && pc.w > 0.0) {
    vec3 pr = texture2D(uPlanarTex, puv + rip * 0.03).rgb;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, pr, pud * uPlanarStrength * 0.85);
  }
}`);
    }
  };
  // ONE program per injected-code variant: grunge/mottle amplitudes are
  // UNIFORMS (never in the key), only the aowet/puddle code paths fork.
  // Keying on values would fork a program per material — measured 120
  // programs vs the ≤70 budget before this key was value-free.
  // `tile` forks the code (the uv macro block), `seam`/`wear`/amplitudes do
  // NOT — they are uniforms, so a per-material tile scale costs no program.
  mat.customProgramCacheKey = () => `a3w${opts.aowet ? 1 : 0}p${opts.puddle ? 1 : 0}t${W ? 1 : 0}`;
  return mat;
}

// ------------------------------------------------------------- textures
const TEX = {}; // filled in makeMaterials (module-cached)

function canvasTex(c, { srgb = true, wrap = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- main
export function makeMaterials(ctx = {}) {
  if (CACHE) return CACHE;
  const V = ctx.V || "";
  const loader = new THREE.TextureLoader();

  // -- canvas textures (generate once)
  TEX.grunge = canvasTex(grungeCanvas(512), { srgb: false });
  TEX.ripple = canvasTex(rippleCanvas(256), { srgb: false });
  TEX.decal = canvasTex(decalAtlasCanvas(1024), { wrap: false });
  TEX.glow = canvasTex(glowCanvas(128), { wrap: false });
  TEX.pool = canvasTex(poolCanvas(256), { wrap: false });
  TEX.tile = canvasTex(tileCanvas(512));
  TEX.corrugated = canvasTex(corrugatedCanvas(256));
  TEX.burlap = canvasTex(burlapCanvas(256));
  TEX.awningA = canvasTex(awningCanvas(256, "#7e2f2f", "#cfc4ae"));
  TEX.awningB = canvasTex(awningCanvas(256, "#2f4a5e", "#c9c9bd"));
  TEX.window = canvasTex(windowCanvas(512), { wrap: false });
  TEX.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  TEX.black.needsUpdate = true;

  // -- file texture sets (prepped by tools/prep_level_assets.py).
  // loader.load fills the SAME texture instance on arrival; the promise
  // resolves from the onLoad callback so M.ready is an honest gate
  // (buildLevel awaits it — prewarm then uploads real texels, no
  // first-use upload hitch).
  const pending = [];
  const fileTex = (url, { srgb = false } = {}) => {
    let done;
    pending.push(new Promise((res) => { done = res; }));
    const t = loader.load(url, done, undefined, (e) => {
      console.warn(`[materials] texture failed: ${url}`, e && e.message);
      done();
    });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8; // grazing-angle ground reads (S4/S5) go mush at 4
    return t;
  };
  const set = (name) => ({
    map: fileTex(`./assets/textures/${name}_albedo.webp${V}`, { srgb: true }),
    roughnessMap: fileTex(`./assets/textures/${name}_rough.webp${V}`),
    normalMap: fileTex(`./assets/textures/${name}_normal.webp${V}`),
  });
  const S_ASPHALT = set("asphalt_worn");
  const S_CONCRETE = set("concrete_yard");
  // (wall_plaster retired: see the plaster material below. Left out of the
  //  load list so it does not cost 3 texture fetches and delay M.ready.)
  const S_COBBLE = set("cobble");
  const S_WOOD = set("wood");
  // (iron_plate retired with metalPainted -> metal_panel; leaving the set()
  //  call in place would keep loading 3 unused textures and inflate M.ready)
  // Authored by tools/a3_gen_surface_sets.py (VT §3 source priority 2 — there
  // is no concrete-wall or painted-steel set on disk). `concrete_yard` is
  // polyhaven ASPHALT_04: correct for the yard apron it is named after, and
  // the whole reason the walls read as "TV static" to all three iter04
  // critics — road aggregate magnified on a vertical surface. The formed set
  // carries pour patches, staining, spall, bugholes and hairline cracks; the
  // panel set carries seams, bolt rows, a weld bead and rust runs.
  const S_CONC_FORMED = set("concrete_formed");
  const S_METAL_PANEL = set("metal_panel");
  const S_WALL_RENDER = set("wall_render");

  const std = (p) => new THREE.MeshStandardMaterial(p);
  // NOTE: the old `uv(m, sx, sy)` helper (clone each map, set repeat) is gone.
  // Tile scale is now the `tile` option on augment() — a per-material uniform
  // consumed by the world-space projection — so the file textures are shared
  // instances with no clones, and a material CANNOT silently ship at the
  // wrong density by forgetting to call a helper (which is exactly how
  // concreteInterior ended up at 1 m/tile beside concreteWall at 4.6).

  // ---- grounds (exterior = WET per LD §5.4: roughness pulled, albedo ×0.7)
  // `tile` = metres per texture tile, projected from world position in the
  // shader. Roads get seam:0 (asphalt has no slab joints); the concrete yard
  // and the arcade slab do get them.
  const asphalt = augment(std({
    ...S_ASPHALT, color: 0xb4b4b4, roughness: 0.46, metalness: 0.0,
    normalScale: new THREE.Vector2(1.3, 1.3), envMapIntensity: 1.15,
  }), { tile: 7.3, aowet: true, puddle: true, grunge: 0.4, mottle: 0.14, seam: 0, wear: 0.7 });

  const asphaltTram = augment(std({
    ...S_ASPHALT, color: 0x9fa4a8, roughness: 0.5, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.1,
  }), { tile: 9.1, aowet: true, puddle: true, grunge: 0.42, mottle: 0.12, seam: 0, wear: 0.6 });

  const cobble = augment(std({
    ...S_COBBLE, color: 0x8e8e93, roughness: 0.5, metalness: 0.0,
    normalScale: new THREE.Vector2(1.15, 1.15), envMapIntensity: 1.25,
  }), { tile: 3.7, aowet: true, puddle: true, grunge: 0.38, mottle: 0.16, seam: 0, wear: 0.55 });

  const concreteYard = augment(std({
    ...S_CONCRETE, color: 0xa8a8a4, roughness: 0.55, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.0,
  }), { tile: 6.1, aowet: true, puddle: true, grunge: 0.45, mottle: 0.12, seam: 0.85, wear: 0.85 });

  // interiors stay dry
  const tileInterior = augment(std({
    map: TEX.tile, color: 0xffffff, roughness: 0.78, metalness: 0.0,
  }), { tile: 2.4, aowet: true, puddle: true, grunge: 0.3, mottle: 0.1, seam: 0, wear: 0.5 });

  // Was the single worst texel-density offender in the build: no `uv()` call
  // meant it shaded the shared S_CONCRETE instances at repeat (1,1) = 1 m per
  // tile, against concreteWall's 4.6 — and S4, the contracted hero material
  // close-up, is posed in this exact interior. It now runs the formed-concrete
  // set at an explicit 4.2 m/tile.
  const concreteInterior = augment(std({
    ...S_CONC_FORMED, color: 0x8f8f8c, roughness: 0.86, metalness: 0.0,
    normalScale: new THREE.Vector2(0.85, 0.85),
  }), { tile: 4.2, aowet: true, puddle: true, grunge: 0.4, mottle: 0.12, seam: 0.9, wear: 1.0 });
  // (gallery roof leaks — puddle channel used for the two leak pools)

  // ---- walls
  // mottle pulled 0.20 → 0.13: at the corrected exposure the albedo-variance
  // term stopped being subtle breakup and started reading as lichen blotching
  // on every wall (iter81 S4/S5). Roughness variance (`grunge`) is the term
  // that should carry surface history — it is lit, so it moves with the key —
  // while albedo variance is flat paint and gets the smaller share.
  // wall_plaster (polyhaven beige_wall_001) is a near-solid beige swatch —
  // prep_level_assets.py measures its albedo std at 0.5/255 and says so in a
  // comment. All of its apparent detail was coming from a Sobel normal map
  // that measured 70.2 deg mean slope, i.e. amplified JPEG noise; with that
  // bake fixed the material would be literally featureless clay. wall_render
  // is cement render over brick with trowel sweep, crazing, staining and
  // spalled patches that show the brick courses through.
  const plaster = augment(std({
    ...S_WALL_RENDER, color: 0xa39c92, roughness: 0.8, metalness: 0.0,
    normalScale: new THREE.Vector2(0.9, 0.9),
  }), { tile: 2.7, aowet: true, grunge: 0.44, mottle: 0.10, seam: 0.4, wear: 0.9 });

  // Facade tints are a MULTIPLIER on wall_plaster_albedo (measured linear mean
  // 0.342/0.265/0.186), so the shipped effective albedo was 0.053/0.038/0.024 —
  // an eighth of the mid-value VT §3 asks for, and the other half of iter03's
  // "buildings are flat black slabs". Lifted to ~0.088/0.063/0.038: still
  // visibly the soot-stained variant next to `plaster`, but now with enough
  // reflectance for the window grid, sills and grime to survive at ambient.
  const plasterDark = augment(std({
    ...S_WALL_RENDER, color: 0x8f8880, roughness: 0.82, metalness: 0.0,
    normalScale: new THREE.Vector2(1.0, 1.0),
  // 3.5 m/tile, not 2.6: the spall patches are the highest-contrast thing in
  // the set, so the number of times the tile repeats across a facade is what
  // decides whether they read as damage or as a pattern (S8's hero box showed
  // the repeat at ~4.6 tiles across). Fewer, larger tiles + lower spall
  // contrast keeps D3's 'visible texture repeat at play distance -> max 6'
  // cap from firing on a feature that was added to help.
  }), { tile: 3.5, aowet: true, grunge: 0.48, mottle: 0.12, seam: 0.45, wear: 1.0 });

  // Retiling to 4.6 m and dropping normalScale (iter04) reduced the frequency
  // of the crackle but could not remove it, because the map itself was
  // polyhaven ASPHALT_04 — a road, on a wall. W3 recorded the leftover as an
  // open item; this is the actual fix: the authored formed-concrete set, whose
  // albedo carries decimetre history (pours, stains, spall, bugholes,
  // hairlines) rather than sub-pixel aggregate.
  const concreteWall = augment(std({
    ...S_CONC_FORMED, color: 0x92928d, roughness: 0.82, metalness: 0.0,
    normalScale: new THREE.Vector2(0.9, 0.9),
  }), { tile: 4.6, aowet: true, grunge: 0.42, mottle: 0.12, seam: 1.0, wear: 1.0 });

  // Trim carries every parapet cap, string course, window jamb, sill and
  // downpipe — i.e. it is the second-largest visible surface in the frame after
  // the walls, and it shipped as a bare untextured colour. Unmapped, it read as
  // clean white piping on top of textured walls (iter81 S8: parapets at 38/51/74
  // against a 54/52/50 wall). Concrete map + a value UNDER the wall it sits on
  // keeps cast trim reading as cast trim, and the mottle/grunge amplitudes push
  // it hard so no two metres of ledge look alike.
  // 0.8 m/tile was authored on the assumption that the greeble carried metre
  // UVs; it does not (props/greeble geometry ships BoxGeometry 0..1), which is
  // why the C1 string courses read as coarse rock chunks beside a fine-speckle
  // wall. With the world projection the number finally means what it says —
  // 1.6 m/tile of cast concrete, seams pulled back so ledges do not stripe.
  const trim = augment(std({
    ...S_CONC_FORMED, color: 0x5f6167, roughness: 0.72, metalness: 0.0,
    normalScale: new THREE.Vector2(0.85, 0.85),
  // 3.2 m/tile: trim ABUTS the wall on every parapet, string course and sill,
  // and the whole D3 complaint was adjacent panels at mismatched density. At
  // 1.6 it ran 640 texels/m against plasterDark's 293 (2.2x, visible); 3.2
  // puts it at 320 (1.09x) while still reading as a finer casting than the
  // wall it sits on.
  }), { tile: 3.2, aowet: true, grunge: 0.5, mottle: 0.16, seam: 0.45, wear: 1.0 });

  // ---- props
  // same trap as plasterDark: iron_plate_albedo is a DARK sheet (linear 0.036),
  // so 0x777d80 on top of it landed at 0.0066 effective — every painted-metal
  // prop (shutters, kiosks, containers, lamp posts) read as a black cut-out
  // rather than a surface. 0xa8aeb2 puts it at ~0.016, still plainly grimy
  // industrial paint and still well under the VT §3 snow ceiling.
  // iron_plate is a flat sheet with no fabrication history. The authored panel
  // set gives every shutter, kiosk, container and lamp post the seams, bolt
  // rows, weld bead and rust runs critic-b listed by name as missing. seam:0 —
  // the panel lines are IN the map at a scale that divides the tile, so the
  // analytic grid would beat against them.
  const metalPainted = augment(std({
    ...S_METAL_PANEL, color: 0xa8aeb2, roughness: 0.62, metalness: 0.0,
    normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 0.9,
  }), { tile: 2.0, grunge: 0.5, mottle: 0.22, seam: 0, wear: 1.0 });

  const steel = augment(std({
    color: 0x9aa0a6, roughness: 0.3, metalness: 1.0, envMapIntensity: 1.2,
  }), { grunge: 0.45, mottle: 0.1 });

  const rail = augment(std({
    color: 0x565c60, roughness: 0.42, metalness: 1.0, envMapIntensity: 1.0,
  }), { grunge: 0.4, mottle: 0.08 });

  const carPaint = augment(std({
    color: 0xffffff, roughness: 0.32, metalness: 0.0, envMapIntensity: 1.5,
  }), { grunge: 0.42, mottle: 0.1 });

  // vehicle greenhouse + trim (props.js splits the GLB body by height band —
  // a one-material body is the "white clay car" tell, VT §3 / iter01 S1)
  const carGlass = augment(std({
    color: 0x0b1118, roughness: 0.08, metalness: 0.0, envMapIntensity: 2.2,
  }), { grunge: 0.15, mottle: 0.04 });
  const carTrim = augment(std({
    color: 0x16181b, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.8,
  }), { grunge: 0.35, mottle: 0.1 });

  const rubber = augment(std({
    color: 0x141414, roughness: 0.92, metalness: 0.0,
  }), { grunge: 0.25, mottle: 0.06 });

  const wood = augment(std({
    ...S_WOOD, color: 0xa08a70, roughness: 0.8, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8),
  }), { tile: 1.1, grunge: 0.4, mottle: 0.24, seam: 0, wear: 0.8 });

  const woodDark = augment(std({
    ...S_WOOD, color: 0x6b5a44, roughness: 0.85, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8),
  }), { tile: 1.1, grunge: 0.42, mottle: 0.26, seam: 0, wear: 0.8 });

  const corrugated = augment(std({
    map: TEX.corrugated, color: 0x8e9296, roughness: 0.55, metalness: 0.0,
    envMapIntensity: 0.9,
  }), { grunge: 0.55, mottle: 0.3 });
  TEX.corrugated.repeat.set(1 / 1.9, 1 / 2.6);

  const burlap = augment(std({
    map: TEX.burlap, color: 0x9a8f78, roughness: 0.94, metalness: 0.0,
  }), { grunge: 0.35, mottle: 0.2 });
  TEX.burlap.repeat.set(1 / 0.9, 1 / 0.9);

  const dirt = burlap; // sandbags/dirt piles share the weave read at night

  const tarp = augment(std({
    map: TEX.burlap, color: 0x3d4c55, roughness: 0.7, metalness: 0.0,
  }), { grunge: 0.5, mottle: 0.3 });

  const glass = augment(std({
    color: 0x10161d, roughness: 0.12, metalness: 0.0, envMapIntensity: 1.7,
  }), { grunge: 0.18, mottle: 0.05 });

  const plasticDark = augment(std({
    color: 0x22262a, roughness: 0.55, metalness: 0.0,
  }), { grunge: 0.35, mottle: 0.12 });

  const trashBag = augment(std({
    color: 0x191b1d, roughness: 0.38, metalness: 0.0, envMapIntensity: 1.2,
  }), { grunge: 0.5, mottle: 0.2 });

  // ---- water (canal) — dark, sky-spec, rippled via the puddle path
  const water = augment(std({
    color: 0x0a1016, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.8,
  }), { grunge: 0.1, mottle: 0.04 });

  // ---- emissive kit (fakes are emissive + glow card + pool decal — LD §3.3)
  const emissive = (color, intensity, extra = {}) => std({
    color: 0x0a0a0a, roughness: 0.6, metalness: 0.0,
    emissive: new THREE.Color(color), emissiveIntensity: intensity, ...extra,
  });
  const glowMat = (color, opacity = 0.5) => new THREE.SpriteMaterial({
    map: TEX.glow, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poolMat = (color, opacity = 0.3) => new THREE.MeshBasicMaterial({
    map: TEX.pool, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  // 2.8 was tuned against the pre-fix exposure, where the frame's median pixel
  // sat at 9/255; against the corrected key it blew a 1.25 m window into a
  // half-facade glare bloom (iter81 S5/S8). Still authored above 1.0 so AgX
  // rolls it and the bloom threshold picks it up — just no longer the brightest
  // thing in the ward by an order of magnitude.
  const windowLit = std({
    map: TEX.window, color: 0x1a1a1a,
    emissive: 0xffffff, emissiveIntensity: 1.35, emissiveMap: TEX.window,
    roughness: 0.4, metalness: 0.0,
  });
  const windowDark = std({
    map: TEX.window, color: 0x555a60, roughness: 0.14, metalness: 0.0,
    envMapIntensity: 1.6,
  });

  const decalMat = new THREE.MeshBasicMaterial({
    map: TEX.decal, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    color: 0xffffff, opacity: 1.0,
  });

  // Separate material for the props.js generator-placed GRIME scatter, so its
  // weight can be tuned without touching the mandatory base decals or the
  // combat impact decals in core/fx/decals.js. Pushed further off the surface
  // than decalMat (-3 vs -1) because it is laid on top of the base decals,
  // and rendered after them.
  const decalGrimeMat = new THREE.MeshBasicMaterial({
    map: TEX.decal, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    color: 0xffffff, opacity: 0.85,
  });

  const cableMat = std({ color: 0x0c0d0e, roughness: 0.7, metalness: 0.0 });

  CACHE = {
    // frozen vocabulary keys (architecture §3.12)
    concrete: concreteYard, metal: metalPainted, dirt, asphalt, wood, glass,
    // grounds
    asphaltTram, cobble, concreteYard, concreteInterior, tileInterior, water,
    // walls
    plaster, plasterDark, concreteWall, trim,
    // props
    steel, rail, carPaint, carGlass, carTrim, rubber, woodDark, corrugated,
    burlap, tarp, plasticDark, trashBag, cableMat,
    // emissive kit + factories
    emissive, glowMat, poolMat, windowLit, windowDark, decalMat, decalGrimeMat,
    makeNeonCanvas, makeSignCanvas, canvasTex,
    awning: [TEX.awningA, TEX.awningB],
    tex: TEX,
    hooks: GROUND_HOOKS,
    DECAL_UV,
    ready: Promise.all(pending),
  };
  return CACHE;
}
