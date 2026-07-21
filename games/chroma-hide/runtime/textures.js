/**
 * CHROMA HIDE — runtime/textures.js (browser)
 * Procedural surface textures drawn to canvases at load: brick + mortar, wood planks,
 * checkerboard tile, damask wallpaper, suspended ceiling grid, concrete, carpet.
 *
 * Flat single-colour walls and floors were the biggest visual gap against the real
 * thing — those rooms read as patterned surfaces (wallpaper, brick, plank, tile), and
 * the paint mechanic itself is about matching a SURFACE, so surfaces need detail.
 * Everything is generated (no downloads), deterministic, and CACHED by key so a map
 * with 400 props still uploads only a handful of textures.
 */
import * as THREE from "three";

const _cache = new Map();
const hex = (c) => "#" + (c >>> 0).toString(16).padStart(6, "0").slice(-6);

function shade(c, f) {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

function makeCanvas(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, x: c.getContext("2d") };
}

// deterministic per-texture noise
function rnd(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

function speckle(ctx, size, n, alpha, seed) {
  const R = rnd(seed);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(R() * 90);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(R() * size, R() * size, 1 + R() * 2, 1 + R() * 2);
  }
}


/** Wear layer: damp stains, drips, hairline cracks and scuffs. Applied on top of a
 *  finished surface so every wall kind gets the same believable age. */
function grime(x, size, seed, amount = 0.2) {
  const R = rnd((seed ^ 0xa17c3) >>> 0);
  const n = Math.round(amount * 22);
  for (let i = 0; i < n; i++) {                       // damp blooms
    const r = size * (0.06 + R() * 0.20), px = R() * size, py = R() * size;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const dark = R() < 0.7;
    g.addColorStop(0, `rgba(${dark ? "40,34,28" : "255,255,255"},${0.05 + R() * 0.09})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < Math.round(amount * 9); i++) {  // drips from the top edge
    const px = R() * size, len = size * (0.08 + R() * 0.3);
    x.fillStyle = `rgba(30,26,22,${0.05 + R() * 0.07})`;
    x.fillRect(px, 0, 1 + R() * 2, len);
  }
  for (let i = 0; i < Math.round(amount * 7); i++) {  // hairline cracks
    let px = R() * size, py = R() * size;
    x.strokeStyle = `rgba(0,0,0,${0.10 + R() * 0.14})`; x.lineWidth = 0.6 + R() * 0.9;
    x.beginPath(); x.moveTo(px, py);
    const steps = 3 + Math.floor(R() * 5);
    for (let k = 0; k < steps; k++) { px += (R() - 0.5) * size * 0.16; py += (R() - 0.3) * size * 0.14; x.lineTo(px, py); }
    x.stroke();
  }
  for (let i = 0; i < Math.round(amount * 14); i++) { // scuffs near floor level
    x.fillStyle = `rgba(20,18,16,${0.04 + R() * 0.06})`;
    x.fillRect(R() * size, size * (0.72 + R() * 0.26), size * (0.03 + R() * 0.12), 1 + R() * 3);
  }
}

const BUILD = {
  brick(base, size) {
    const { c, x } = makeCanvas(size);
    const mortar = shade(base, 1.45);
    x.fillStyle = hex(mortar); x.fillRect(0, 0, size, size);
    const rows = 8, bh = size / rows, bw = size / 4;
    const R = rnd(base);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let i = -1; i < 5; i++) {
        const bx = i * bw + off + 1.5, by = r * bh + 1.5;
        x.fillStyle = hex(shade(base, 0.86 + R() * 0.3));
        x.fillRect(bx, by, bw - 3, bh - 3);
      }
    }
    speckle(x, size, 900, 0.06, base);
    grime(x, size, base, 0.3);
    return c;
  },
  wood(base, size) {
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    const planks = 6, pw = size / planks, R = rnd(base);
    for (let i = 0; i < planks; i++) {
      x.fillStyle = hex(shade(base, 0.74 + R() * 0.46));
      x.fillRect(i * pw, 0, pw - 1.5, size);
      // grain
      x.strokeStyle = `rgba(0,0,0,0.20)`; x.lineWidth = 1.4;
      for (let g = 0; g < 5; g++) {
        const gx = i * pw + 3 + R() * (pw - 6);
        x.beginPath(); x.moveTo(gx, 0);
        x.bezierCurveTo(gx + 4, size * 0.33, gx - 4, size * 0.66, gx + 2, size);
        x.stroke();
      }
      x.fillStyle = "rgba(0,0,0,0.42)"; x.fillRect(i * pw + pw - 2.5, 0, 2.5, size); // seam
    }
    return c;
  },
  checker(base, size) {
    const { c, x } = makeCanvas(size);
    const light = shade(base, 1.55), dark = shade(base, 0.42);
    const n = 8, s = size / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      x.fillStyle = hex((i + j) % 2 ? dark : light);
      x.fillRect(i * s, j * s, s, s);
    }
    x.strokeStyle = "rgba(0,0,0,0.12)"; x.lineWidth = 1;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, size); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(size, i * s); x.stroke(); }
    return c;
  },
  damask(base, size) {
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    const ink = shade(base, 1.5);
    x.strokeStyle = hex(ink); x.fillStyle = hex(ink);
    x.globalAlpha = 0.5;
    const motif = (cx, cy, s) => {                     // a simple damask-ish fleur
      x.beginPath();
      x.ellipse(cx, cy, s * 0.28, s * 0.48, 0, 0, Math.PI * 2); x.fill();
      x.beginPath();
      x.ellipse(cx - s * 0.42, cy, s * 0.16, s * 0.3, 0.5, 0, Math.PI * 2); x.fill();
      x.beginPath();
      x.ellipse(cx + s * 0.42, cy, s * 0.16, s * 0.3, -0.5, 0, Math.PI * 2); x.fill();
      x.lineWidth = 2;
      x.beginPath(); x.arc(cx, cy + s * 0.6, s * 0.3, Math.PI * 0.15, Math.PI * 0.85); x.stroke();
    };
    const h = size / 2;
    motif(h * 0.5, h * 0.5, h * 0.5); motif(h * 1.5, h * 0.5, h * 0.5);
    motif(h * 0.5, h * 1.5, h * 0.5); motif(h * 1.5, h * 1.5, h * 0.5);
    motif(h, h, h * 0.42);
    x.globalAlpha = 1;
    speckle(x, size, 500, 0.05, base);
    return c;
  },
  ceiling(base, size) {                                 // suspended panel grid
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(shade(base, 1.12)); x.fillRect(0, 0, size, size);
    const n = 2, s = size / n;
    x.fillStyle = hex(shade(base, 0.72));
    for (let i = 0; i <= n; i++) { x.fillRect(i * s - 3, 0, 6, size); x.fillRect(0, i * s - 3, size, 6); }
    speckle(x, size, 1400, 0.05, base);
    return c;
  },
  concrete(base, size) {
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    speckle(x, size, 3000, 0.09, base);
    const R = rnd(base ^ 0x9e3779b9);
    x.strokeStyle = "rgba(0,0,0,0.10)"; x.lineWidth = 1;
    for (let i = 0; i < 5; i++) {                        // hairline cracks / control joints
      x.beginPath(); const sx = R() * size, sy = R() * size;
      x.moveTo(sx, sy); x.lineTo(sx + (R() - 0.5) * size * 0.6, sy + (R() - 0.5) * size * 0.6); x.stroke();
    }
    grime(x, size, base, 0.24);
    return c;
  },
  carpet(base, size) {
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    speckle(x, size, 6000, 0.12, base);
    return c;
  },
  /** Glazed wall tile with grout — kitchens, washrooms, laundromat, chilled aisles. */
  tile(base, size) {
    const { c, x } = makeCanvas(size);
    const R = rnd(base ^ 0x71ca3);
    x.fillStyle = hex(shade(base, 0.72)); x.fillRect(0, 0, size, size);   // grout
    const n = 6, cell = size / n, gap = Math.max(1.5, size / 150);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      x.fillStyle = hex(shade(base, 0.94 + R() * 0.12));
      x.fillRect(i * cell + gap, j * cell + gap, cell - gap * 2, cell - gap * 2);
      if (R() < 0.30) {                                    // specular sheen on some tiles
        const g = x.createLinearGradient(i * cell, j * cell, i * cell + cell, j * cell + cell);
        g.addColorStop(0, "rgba(255,255,255,.13)"); g.addColorStop(0.55, "rgba(255,255,255,0)");
        x.fillStyle = g; x.fillRect(i * cell + gap, j * cell + gap, cell - gap * 2, cell - gap * 2);
      }
    }
    grime(x, size, base ^ 0x1a, 0.16);
    return c;
  },
  /** Painted breeze block — stockrooms, back-of-house, service corridors. */
  block(base, size) {
    const { c, x } = makeCanvas(size);
    const R = rnd(base ^ 0x3d1a7);
    x.fillStyle = hex(shade(base, 0.80)); x.fillRect(0, 0, size, size);
    const rows = 5, rh = size / rows, cw = size / 2.5;
    for (let j = 0; j < rows; j++) {
      const off = (j % 2) * cw * 0.5;
      for (let i = -1; i < 4; i++) {
        x.fillStyle = hex(shade(base, 0.93 + R() * 0.14));
        x.fillRect(i * cw + off + 1.5, j * rh + 1.5, cw - 3, rh - 3);
      }
    }
    speckle(x, size, 2600, 0.05, base);
    grime(x, size, base, 0.22);
    return c;
  },
  /** Striped wallpaper — reception, lounges, anywhere that should feel decorated. */
  wallpaper(base, size) {
    const { c, x } = makeCanvas(size);
    const R = rnd(base ^ 0x9e2b1);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    const sw = size / 8;
    for (let i = 0; i < 8; i += 2) { x.fillStyle = hex(shade(base, 1.10)); x.fillRect(i * sw, 0, sw, size); }
    for (let i = 0; i < 8; i++) {                       // hairline between stripes
      x.fillStyle = `rgba(0,0,0,.05)`; x.fillRect(i * sw, 0, 1, size);
    }
    if (R() < 0.9) grime(x, size, base, 0.10);
    return c;
  },
  /** Vertical timber panelling / wainscot boards. */
  panel(base, size) {
    const { c, x } = makeCanvas(size);
    const R = rnd(base ^ 0x4c8f2);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    const bw = size / 5;
    for (let i = 0; i < 5; i++) {
      x.fillStyle = hex(shade(base, 0.92 + R() * 0.16));
      x.fillRect(i * bw, 0, bw - 1, size);
      x.fillStyle = "rgba(0,0,0,.22)"; x.fillRect(i * bw + bw - 2, 0, 2, size);   // groove
      x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(i * bw, 0, 1.5, size);
    }
    grime(x, size, base, 0.12);
    return c;
  },
  plaster(base, size) {
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    const R = rnd(base ^ 0x5bf03);
    for (let i = 0; i < 26; i++) {            // soft mottling -> walls read as a surface
      const r = size * (0.08 + R() * 0.22);
      const g = x.createRadialGradient(R() * size, R() * size, 0, R() * size, R() * size, r);
      g.addColorStop(0, `rgba(255,255,255,${0.05 + R() * 0.05})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, size, size);
    }
    speckle(x, size, 1800, 0.05, base);
    grime(x, size, base, 0.26);
    return c;
  },
};

/**
 * Get a cached CanvasTexture. kind = brick|wood|checker|damask|ceiling|concrete|carpet|plaster|tile|block|wallpaper|panel
 * `repeat` tiles it across the surface (world-size driven by the caller).
 */
export function surfaceTexture(kind, baseColor, repeatX = 1, repeatY = 1, size = 256) {
  const key = `${kind}|${baseColor}|${repeatX}|${repeatY}|${size}`;
  if (_cache.has(key)) return _cache.get(key);
  const build = BUILD[kind];
  if (!build) return null;
  const tex = new THREE.CanvasTexture(build(baseColor, size));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _cache.set(key, tex);
  return tex;
}

export function clearTextureCache() {
  for (const t of _cache.values()) t.dispose();
  _cache.clear();
}
