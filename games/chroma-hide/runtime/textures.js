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
    return c;
  },
  carpet(base, size) {
    const { c, x } = makeCanvas(size);
    x.fillStyle = hex(base); x.fillRect(0, 0, size, size);
    speckle(x, size, 6000, 0.12, base);
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
    return c;
  },
};

/**
 * Get a cached CanvasTexture. kind = brick|wood|checker|damask|ceiling|concrete|carpet|plaster
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
