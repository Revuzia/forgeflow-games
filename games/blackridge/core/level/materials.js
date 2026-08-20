// core/level/materials.js [A3] — PBR material library for Meridian Ward.
// Architecture §3.12 (frozen export makeMaterials(ctx)); VT §3 (roughness
// VARIANCE on every hero surface, anti-tiling, metres/TILE UVs, grime);
// LD §5.4 (wetness pulls baked at setup, puddle masks via the 'aowet'
// vertex attribute, ripple normals, R18 planar/env hook).
//
// Sources (BUILD_PLAN Part 4): Poly Haven asphalt/wall sets + FFG
// generated-materials, prepped to WebP by tools/prep_level_assets.py
// (normals Sobel-generated from displacement — sets ship no normal maps).
// Everything else is canvas-procedural, generated ONCE here at construction
// (prewarm-friendly: all materials exist in-scene before the phase-5
// compileAsync passes, so no mission-time program compiles).
//
// Shared shader layer (onBeforeCompile, one static variant per material —
// no runtime defines flip, so the program count is fixed at boot):
//   - world-space grunge overlay at two NON-INTEGER scales → roughness
//     variance + albedo mottle on every large surface (anti-tiling a+b);
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

// two independent noises packed into r/g for the grunge overlay
function grungeCanvas(size) {
  const a = valueNoiseCanvas(size, 5, 101, 1.35);
  const b = valueNoiseCanvas(size, 3, 707, 1.6);
  const c = cnv(size, size), g = c.getContext("2d");
  const ia = a.getContext("2d").getImageData(0, 0, size, size);
  const ib = b.getContext("2d").getImageData(0, 0, size, size);
  const out = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4] = ia.data[i * 4];
    out.data[i * 4 + 1] = ib.data[i * 4];
    out.data[i * 4 + 2] = 128;
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
    ...o,
  };
  mat.userData.a3 = opts;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrunge = { value: TEX.grunge };
    sh.uniforms.uGrungeAmp = { value: opts.grunge };
    sh.uniforms.uMottle = { value: opts.mottle };
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
${opts.aowet ? "attribute vec3 aowet; varying vec3 vAowet;" : ""}`)
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
uniform sampler2D uGrunge;
uniform float uGrungeAmp;
uniform float uMottle;
${opts.aowet ? "varying vec3 vAowet;" : ""}
${opts.puddle ? `uniform sampler2D uRipple;
uniform sampler2D uPlanarTex;
uniform mat4 uPlanarMat;
uniform float uPlanarStrength;
uniform float uTime;` : ""}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
vec2 gruv = vWPos.xz + vWPos.y * vec2(0.71, 0.37);
float g1 = texture2D(uGrunge, gruv * 0.0619).r;
float g2 = texture2D(uGrunge, gruv * 0.0143 + 0.29).g;
// close-range tap (~1.2 m period): micro-breakup so surfaces survive the
// S4 close crop — without it the two macro taps read as smooth clay <3 m
float g3 = texture2D(uGrunge, gruv * 0.83 + 0.61).g;
diffuseColor.rgb *= (1.0 + uMottle * ((g1 - 0.5) * 1.6 + (g2 - 0.5) + (g3 - 0.5) * 0.8));
${opts.aowet ? `diffuseColor.rgb *= vAowet.r;
diffuseColor.rgb *= (1.0 - vAowet.b * 0.30);` : ""}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor * (1.0 + uGrungeAmp * (g1 - 0.5) * 2.0)
    + uGrungeAmp * 0.5 * (g2 - 0.5)
    + uGrungeAmp * 0.55 * (g3 - 0.5),
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
  mat.customProgramCacheKey = () => `a3w${opts.aowet ? 1 : 0}p${opts.puddle ? 1 : 0}`;
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

// texture clones share the image source but keep their own version counter —
// they must be re-marked for upload once the source image actually arrives
const CLONES = [];

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
  const S_PLASTER = set("wall_plaster");
  const S_COBBLE = set("cobble");
  const S_WOOD = set("wood");
  const S_IRON = set("iron_plate");

  const std = (p) => new THREE.MeshStandardMaterial(p);
  const uv = (m, sx, sy) => {
    for (const k of ["map", "roughnessMap", "normalMap"]) {
      if (m[k]) {
        m[k] = m[k].clone();
        m[k].repeat.set(sx, sy);
        CLONES.push(m[k]); // re-marked for upload once the source image lands
      }
    }
    return m;
  };

  // ---- grounds (exterior = WET per LD §5.4: roughness pulled, albedo ×0.7)
  // metres/TILE: repeat = 1/tileMetres; geometry UVs are authored in metres.
  const asphalt = augment(uv(std({
    ...S_ASPHALT, color: 0xb4b4b4, roughness: 0.46, metalness: 0.0,
    normalScale: new THREE.Vector2(1.3, 1.3), envMapIntensity: 1.15,
  }), 1 / 7.3, 1 / 7.3), { aowet: true, puddle: true, grunge: 0.4, mottle: 0.14 });

  const asphaltTram = augment(uv(std({
    ...S_ASPHALT, color: 0x9fa4a8, roughness: 0.5, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.1,
  }), 1 / 9.1, 1 / 9.1), { aowet: true, puddle: true, grunge: 0.42, mottle: 0.12 });

  const cobble = augment(uv(std({
    ...S_COBBLE, color: 0x8e8e93, roughness: 0.5, metalness: 0.0,
    normalScale: new THREE.Vector2(1.15, 1.15), envMapIntensity: 1.25,
  }), 1 / 3.7, 1 / 3.7), { aowet: true, puddle: true, grunge: 0.38, mottle: 0.16 });

  const concreteYard = augment(uv(std({
    ...S_CONCRETE, color: 0xa8a8a4, roughness: 0.55, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.0,
  }), 1 / 6.1, 1 / 6.1), { aowet: true, puddle: true, grunge: 0.45, mottle: 0.12 });

  // interiors stay dry
  const tileInterior = augment(std({
    map: TEX.tile, color: 0xffffff, roughness: 0.78, metalness: 0.0,
  }), { aowet: true, puddle: true, grunge: 0.3, mottle: 0.1 });
  TEX.tile.repeat.set(1 / 2.4, 1 / 2.4);

  const concreteInterior = augment(std({
    ...S_CONCRETE, color: 0x8f8f8c, roughness: 0.86, metalness: 0.0,
    normalScale: new THREE.Vector2(0.5, 0.5),
  }), { aowet: true, puddle: true, grunge: 0.34, mottle: 0.1 });
  // (gallery roof leaks — puddle channel used for the two leak pools)

  // ---- walls
  const plaster = augment(uv(std({
    ...S_PLASTER, color: 0x9a938a, roughness: 0.8, metalness: 0.0,
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), 1 / 2.1, 1 / 2.1), { aowet: true, grunge: 0.4, mottle: 0.2 });

  const plasterDark = augment(uv(std({
    ...S_PLASTER, color: 0x6e6a64, roughness: 0.82, metalness: 0.0,
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), 1 / 1.7, 1 / 1.7), { aowet: true, grunge: 0.44, mottle: 0.22 });

  const concreteWall = augment(uv(std({
    ...S_CONCRETE, color: 0x7e7e7a, roughness: 0.8, metalness: 0.0,
    normalScale: new THREE.Vector2(0.6, 0.6),
  }), 1 / 3.1, 1 / 3.1), { aowet: true, grunge: 0.42, mottle: 0.15 });

  const trim = augment(std({
    color: 0x4a4c50, roughness: 0.6, metalness: 0.0,
  }), { grunge: 0.5, mottle: 0.2 });

  // ---- props
  const metalPainted = augment(uv(std({
    ...S_IRON, color: 0x777d80, roughness: 0.62, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.9,
  }), 1 / 1.3, 1 / 1.3), { grunge: 0.5, mottle: 0.25 });

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

  const wood = augment(uv(std({
    ...S_WOOD, color: 0xa08a70, roughness: 0.8, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8),
  }), 1 / 1.1, 1 / 1.1), { grunge: 0.4, mottle: 0.24 });

  const woodDark = augment(uv(std({
    ...S_WOOD, color: 0x6b5a44, roughness: 0.85, metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8),
  }), 1 / 0.8, 1 / 0.8), { grunge: 0.42, mottle: 0.26 });

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

  const windowLit = std({
    map: TEX.window, color: 0x1a1a1a,
    emissive: 0xffffff, emissiveIntensity: 2.8, emissiveMap: TEX.window,
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
    emissive, glowMat, poolMat, windowLit, windowDark, decalMat,
    makeNeonCanvas, makeSignCanvas, canvasTex,
    awning: [TEX.awningA, TEX.awningB],
    tex: TEX,
    hooks: GROUND_HOOKS,
    DECAL_UV,
    ready: Promise.all(pending).then(() => {
      for (const c of CLONES) c.needsUpdate = true;
    }),
  };
  return CACHE;
}
