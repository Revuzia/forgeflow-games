// Procedural textures, drawn rather than photographed: flat fills in two or three tones, joints and
// grain as wobbly ink line-work in a dark cousin of the fill, highlights as shapes. Everything is
// painted into canvases at level load - no image files.
//
// Every level surface of a theme lives in ONE array texture (a layer per paint, layer 0 blank
// white for vertex-coloured props), so all static geometry of a level area is a single draw call
// whatever mix of materials it uses. Each swatch is 512 px = 2 m and tiles in both directions;
// lines are never thinner than ~2 cm, so they blur away with distance instead of shimmering.

import * as THREE from '../../vendor/three.module.min.js';
import { paintFor } from './themes.js';

export const SWATCH = 512;         // pixels per swatch
export const SWATCH_M = 2;         // metres per swatch

// small deterministic RNG so textures look the same on every run
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function shade(hex, k) {
  const [r, g, b] = rgbOf(hex), f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
function mixHex(a, b, t) { const A = rgbOf(a), B = rgbOf(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`; }

/** A wobble that repeats exactly once per swatch (integer harmonics), so inked joints tile. */
function wobble(r, amp) {
  const k1 = 1 + Math.floor(r() * 2), k2 = 3 + Math.floor(r() * 3), p1 = r() * 6.283, p2 = r() * 6.283, a2 = 0.45 + r() * 0.3;
  return (t) => amp * (Math.sin(t * 6.2832 * k1 + p1) + a2 * Math.sin(t * 6.2832 * k2 + p2)) / (1 + a2);
}

/**
 * A hand-inked line right across the swatch along one axis (horizontal when `horiz`), at `at` px,
 * between u0 and u1 (px). Its weight swells and thins, and it wobbles; both repeat per swatch.
 */
function inkAcross(x, r, horiz, at, u0, u1, w, color, amp = 1.6) {
  const S = SWATCH, wob = wobble(r, amp), wv = wobble(r, 0.28);
  x.strokeStyle = color; x.lineCap = 'round'; x.lineJoin = 'round';
  const step = 16;
  for (let u = u0; u < u1; u += step) {
    const a = u, b = Math.min(u1, u + step);
    x.lineWidth = Math.max(1.5, w * (1 + wv((a + b) / 2 / S)));
    x.beginPath();
    if (horiz) { x.moveTo(a, at + wob(a / S)); x.lineTo(b, at + wob(b / S)); }
    else { x.moveTo(at + wob(a / S), a); x.lineTo(at + wob(b / S), b); }
    x.stroke();
  }
}

/** Draw `fn` so that anything spilling over an edge comes back on the opposite one. */
function wrapped(x, fn) {
  const S = SWATCH;
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { x.save(); x.translate(dx, dy); fn(); x.restore(); }
}

/** A few broad, dry brush strokes over a rectangle: the "painted" grain. */
function brush(x, r, px, py, w, h, color, n = 2, along = 0) {
  x.save(); x.beginPath(); x.rect(px, py, w, h); x.clip();
  x.strokeStyle = color; x.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = along + (r() - 0.5) * 0.5, len = Math.max(w, h) * (0.5 + r() * 0.6);
    const cx = px + r() * w, cy = py + r() * h;
    x.lineWidth = 3 + r() * Math.min(w, h) * 0.12;
    x.beginPath(); x.moveTo(cx - Math.cos(a) * len / 2, cy - Math.sin(a) * len / 2);
    x.quadraticCurveTo(cx + (r() - 0.5) * 10, cy + (r() - 0.5) * 10, cx + Math.cos(a) * len / 2, cy + Math.sin(a) * len / 2);
    x.stroke();
  }
  x.restore();
}

/** The drawn highlight of a glazed tile: a short bright stroke and a dot, top-left. */
function shine(x, px, py, w, h, a) {
  if (a <= 0) return;
  x.strokeStyle = `rgba(255,255,255,${a})`; x.lineCap = 'round'; x.lineWidth = Math.max(3, Math.min(w, h) * 0.07);
  x.beginPath(); x.moveTo(px + w * 0.16, py + h * 0.34); x.quadraticCurveTo(px + w * 0.18, py + h * 0.18, px + w * 0.36, py + h * 0.16); x.stroke();
  x.fillStyle = `rgba(255,255,255,${a})`; x.beginPath(); x.arc(px + w * 0.47, py + h * 0.16, x.lineWidth * 0.55, 0, 7); x.fill();
}

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

// ---------------------------------------------------------------------------- swatch painters
// Each takes (x, r, paint) and fills the whole SWATCH x SWATCH canvas.

const KINDS = {
  /** Square glazed tiles, 0.5 m, with a little diamond inset where four meet. */
  tile(x, r, p) {
    const S = SWATCH, N = 4, T = S / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const base = p.tones[(i + j) % 2 ? 0 : 1 % p.tones.length];
      x.fillStyle = r() < 0.3 ? pick(r, p.tones) : base; x.fillRect(i * T, j * T, T, T);
      brush(x, r, i * T, j * T, T, T, 'rgba(255,255,255,0.07)', 2, 0.7);
      brush(x, r, i * T, j * T, T, T, rgba(p.line, 0.06), 1, 0.7);
      shine(x, i * T + 6, j * T + 6, T - 12, T - 12, p.shine || 0);
    }
    for (let k = 0; k < N; k++) { inkAcross(x, r, true, k * T, 0, S, 6, p.line); inkAcross(x, r, false, k * T, 0, S, 6, p.line); }
    wrapped(x, () => { inkAcross(x, rng(5), true, 0, 0, S, 6, p.line); inkAcross(x, rng(6), false, 0, 0, S, 6, p.line); });
    if (p.inset) {
      wrapped(x, () => {
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const cx = i * T, cy = j * T, d = 17;
          x.fillStyle = p.inset; x.strokeStyle = p.line; x.lineWidth = 4.5; x.lineJoin = 'round';
          x.beginPath(); x.moveTo(cx, cy - d); x.lineTo(cx + d, cy); x.lineTo(cx, cy + d); x.lineTo(cx - d, cy); x.closePath(); x.fill(); x.stroke();
        }
      });
    }
  },
  /** Wall tiles in a half bond, 0.5 m x 0.25 m, with the odd accent tile. */
  subway(x, r, p) { courses(x, r, p, 8, 2, true); },
  /** Running-bond brick, 0.5 m x 0.25 m (`big`: 1 m x 0.5 m pavers). */
  brick(x, r, p) { courses(x, r, p, p.big ? 4 : 8, p.big ? 2 : 4, false); },
  /** Floorboards along x, butt joints, a couple of grain lines and a knot now and then. */
  planks(x, r, p) { boards(x, r, p, true); },
  /** Upright boards (partitions, beams). */
  boards(x, r, p) { boards(x, r, p, false); },
  /** Limewashed plaster: broad brush sweeps, a crack or two, a patch where the brick shows. */
  plaster(x, r, p) {
    const S = SWATCH;
    x.fillStyle = p.tones[0]; x.fillRect(0, 0, S, S);
    wrapped(x, () => {
      const q = rng(71);
      for (let i = 0; i < 16; i++) {
        x.strokeStyle = i % 2 ? rgba(p.tones[1] || p.tones[0], 0.7) : 'rgba(255,255,255,0.35)'; x.lineCap = 'round'; x.lineWidth = 16 + q() * 26;
        const cx = q() * S, cy = q() * S, a = -0.5 + q() * 0.6, len = 80 + q() * 150;
        x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5 - 22, cx + Math.cos(a) * len, cy + Math.sin(a) * len); x.stroke();
      }
      for (let i = 0; i < 3; i++) {                     // hairline cracks, drawn
        let px = q() * S, py = q() * S;
        x.strokeStyle = rgba(p.line, 0.75); x.lineWidth = 3; x.lineJoin = 'round'; x.beginPath(); x.moveTo(px, py);
        for (let s = 0; s < 4; s++) { px += (q() - 0.5) * 46; py += 14 + q() * 34; x.lineTo(px, py); }
        x.stroke();
      }
      if (p.patch) {
        // one bare patch per swatch: three courses of brick, ringed in ink
        const px = 300, py = 120, w = 130, h = 84;
        x.save(); x.beginPath(); x.ellipse(px, py, w / 2, h / 2, -0.2, 0, 7); x.clip();
        x.fillStyle = shade(p.patch, 0.9); x.fillRect(px - w, py - h, w * 2, h * 2);
        x.strokeStyle = shade(p.patch, 0.55); x.lineWidth = 4;
        for (let j = -2; j <= 2; j++) { x.beginPath(); x.moveTo(px - w, py + j * 28); x.lineTo(px + w, py + j * 28); x.stroke(); for (let i = -2; i <= 2; i++) { const bx = px + i * 56 + (j & 1) * 28; x.beginPath(); x.moveTo(bx, py + j * 28); x.lineTo(bx, py + j * 28 + 28); x.stroke(); } }
        x.restore();
        x.strokeStyle = p.line; x.lineWidth = 5; x.beginPath(); x.ellipse(px, py, w / 2, h / 2, -0.2, 0, 7); x.stroke();
      }
    });
  },
  /** Stone flags: courses of slabs of uneven width, inked joints. */
  slab(x, r, p) {
    const S = SWATCH, rows = 4, H = S / rows;
    for (let j = 0; j < rows; j++) {
      const cuts = [0];
      let u = 0;
      while (u < S - 150) { u += 110 + Math.floor(r() * 4) * 30; if (u < S - 70) cuts.push(u); }
      cuts.push(S);
      const off = Math.floor(r() * 5) * 24;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const tone = pick(r, p.tones);
        wrapped(x, () => {
          x.fillStyle = tone; x.fillRect(cuts[i] + off, j * H, cuts[i + 1] - cuts[i], H);
        });
        wrapped(x, () => {
          const q = rng(900 + j * 31 + i);
          brush(x, q, cuts[i] + off, j * H, cuts[i + 1] - cuts[i], H, 'rgba(255,255,255,0.08)', 2, 0.3);
          brush(x, q, cuts[i] + off, j * H, cuts[i + 1] - cuts[i], H, rgba(p.line, 0.08), 2, 0.3);
        });
      }
      for (let i = 0; i + 1 < cuts.length; i++) {
        const q = rng(400 + j * 17 + i);
        wrapped(x, () => inkAcross(x, rng(q() * 1e6 | 0), false, cuts[i] + off, j * H, (j + 1) * H, 6, p.line, 1.2));
      }
    }
    for (let j = 0; j < rows; j++) wrapped(x, () => inkAcross(x, rng(40 + j), true, j * H, 0, S, 6.5, p.line));
  },
  /** Coping stones: big plain slabs, one joint each way. */
  cap(x, r, p) {
    const S = SWATCH, T = S / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      x.fillStyle = p.tones[(i + j) % p.tones.length]; x.fillRect(i * T, j * T, T, T);
      brush(x, r, i * T, j * T, T, T, 'rgba(255,255,255,0.1)', 3, 0.4);
      brush(x, r, i * T, j * T, T, T, rgba(p.line, 0.07), 2, 0.4);
    }
    for (let k = 0; k < 2; k++) wrapped(x, () => { inkAcross(x, rng(11 + k), true, k * T, 0, S, 6.5, p.line); inkAcross(x, rng(21 + k), false, k * T, 0, S, 6.5, p.line); });
  },
  /** Iron or brass plate: a panel a metre square, a drawn border and a rivet in each corner. */
  metal(x, r, p) {
    const S = SWATCH, T = S / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      x.fillStyle = p.tones[(i + j) % p.tones.length]; x.fillRect(i * T, j * T, T, T);
      brush(x, r, i * T, j * T, T, T, 'rgba(255,255,255,0.12)', 3, -0.8);
      x.strokeStyle = rgba(p.line, 0.45); x.lineWidth = 4; x.strokeRect(i * T + 20, j * T + 20, T - 40, T - 40);
      for (const [cx, cy] of [[36, 36], [T - 36, 36], [36, T - 36], [T - 36, T - 36]]) {
        x.fillStyle = p.rivet || '#ffffff'; x.strokeStyle = p.line; x.lineWidth = 4;
        x.beginPath(); x.arc(i * T + cx, j * T + cy, 8, 0, 7); x.fill(); x.stroke();
      }
    }
    for (let k = 0; k < 2; k++) wrapped(x, () => { inkAcross(x, rng(31 + k), true, k * T, 0, S, 7, p.line, 0.8); inkAcross(x, rng(41 + k), false, k * T, 0, S, 7, p.line, 0.8); });
  },
  /** Enamelled wall panels with a bright stud at each corner (the switch room). */
  panel(x, r, p) {
    const S = SWATCH, T = S / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      x.fillStyle = p.tones[(i + j) % p.tones.length]; x.fillRect(i * T, j * T, T, T);
      brush(x, r, i * T, j * T, T, T, 'rgba(255,255,255,0.06)', 2, 1.2);
      x.strokeStyle = rgba(p.line, 0.6); x.lineWidth = 4; x.strokeRect(i * T + 26, j * T + 26, T - 52, T - 52);
    }
    for (let k = 0; k < 2; k++) wrapped(x, () => { inkAcross(x, rng(51 + k), true, k * T, 0, S, 7, p.line, 0.8); inkAcross(x, rng(61 + k), false, k * T, 0, S, 7, p.line, 0.8); });
    wrapped(x, () => {
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { x.fillStyle = p.stud || '#ffffff'; x.strokeStyle = p.line; x.lineWidth = 4; x.beginPath(); x.arc(i * T, j * T, 9, 0, 7); x.fill(); x.stroke(); }
    });
  },
  /** Leather-hard clay: flat, with thumb sweeps. */
  clay(x, r, p) {
    const S = SWATCH;
    x.fillStyle = p.tones[0]; x.fillRect(0, 0, S, S);
    wrapped(x, () => {
      const q = rng(111);
      for (let i = 0; i < 12; i++) {
        x.strokeStyle = i % 2 ? rgba(p.line, 0.16) : 'rgba(255,255,255,0.16)'; x.lineWidth = 8 + q() * 10; x.lineCap = 'round';
        const cx = q() * S, cy = q() * S, rad = 50 + q() * 70, a = q() * 6.28;
        x.beginPath(); x.arc(cx, cy, rad, a, a + 0.9 + q()); x.stroke();
      }
    });
  },
};

/** Courses of tiles or bricks (rows x perRow), half bond. */
function courses(x, r, p, rows, perRow, glazed) {
  const S = SWATCH, H = S / rows, W = S / perRow;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * W / 2;
    for (let i = -1; i < perRow + 1; i++) {
      const accent = p.accent && r() < (p.accentP || 0);
      x.fillStyle = accent ? p.accent : pick(r, p.tones);
      const px = i * W + off;
      x.fillRect(px, j * H, W, H);
      brush(x, r, px, j * H, W, H, 'rgba(255,255,255,0.09)', 1, 0);
      if (!glazed && r() < 0.3) brush(x, r, px, j * H, W, H, rgba(p.line, 0.13), 1, 0.2);
      if (glazed) shine(x, px + 5, j * H + 4, W - 10, H - 8, 0.2);
      if (p.glow && r() < 0.16) { x.fillStyle = rgba(p.glow, 0.5); x.fillRect(px, j * H + H - 7, W, 7); }   // ember light caught in a joint
      inkAcross(x, r, false, px, j * H, (j + 1) * H, 5.5, p.line, 1.1);
    }
  }
  for (let j = 0; j < rows; j++) wrapped(x, () => inkAcross(x, rng(70 + j), true, j * H, 0, S, 6, p.line));
}

function boards(x, r, p, horiz) {
  const S = SWATCH, rows = 8, H = S / rows;
  const rect = (u, v, lu, lv) => (horiz ? [u, v, lu, lv] : [v, u, lv, lu]);
  for (let j = 0; j < rows; j++) {
    let u = -r() * 180;
    while (u < S) {
      const len = horiz ? 170 + r() * 230 : S + 200;
      const tone = pick(r, p.tones);
      x.fillStyle = tone; x.fillRect(...rect(u, j * H, len, H));
      // grain: two or three long drawn lines that bend round a knot
      x.strokeStyle = rgba(p.line, 0.3); x.lineWidth = 2.6; x.lineCap = 'round';
      const knot = r() < 0.3 ? u + 30 + r() * (len - 60) : -1e4;
      for (let k = 0; k < 2 + (r() < 0.5 ? 1 : 0); k++) {
        const g = j * H + H * (0.25 + 0.25 * k + r() * 0.12);
        x.beginPath();
        for (let s = 0; s <= 8; s++) {
          const uu = u + 8 + (len - 16) * s / 8, bend = Math.exp(-(((uu - knot) / 34) ** 2)) * (g < j * H + H / 2 ? -1 : 1) * 7;
          const pt = horiz ? [uu, g + bend + Math.sin(s * 1.9 + k) * 1.3] : [g + bend + Math.sin(s * 1.9 + k) * 1.3, uu];
          if (s === 0) x.moveTo(pt[0], pt[1]); else x.lineTo(pt[0], pt[1]);
        }
        x.stroke();
      }
      if (knot > -1e3) { x.fillStyle = rgba(p.line, 0.55); x.beginPath(); const c = horiz ? [knot, j * H + H / 2] : [j * H + H / 2, knot]; x.ellipse(c[0], c[1], horiz ? 8 : 5, horiz ? 5 : 8, 0, 0, 7); x.fill(); }
      if (horiz) {
        inkAcross(x, r, false, u, j * H, (j + 1) * H, 5, p.line, 0.8);
        for (const nu of [u + 12, u + len - 12]) { x.fillStyle = p.line; x.beginPath(); x.arc(nu, j * H + H * 0.3, 3, 0, 7); x.arc(nu, j * H + H * 0.72, 3, 0, 7); x.fill(); }
      }
      u += len;
    }
  }
  for (let j = 0; j < rows; j++) wrapped(x, () => inkAcross(x, rng(90 + j), horiz, j * H, 0, S, 5.5, p.line, 1.1));
}

function paintSwatch(p) {
  const c = canvas(SWATCH, SWATCH), x = c.getContext('2d', { willReadFrequently: true });
  const r = rng(hashStr(JSON.stringify(p)));
  (KINDS[p.kind] || KINDS.tile)(x, r, p);
  return x;
}

// ---------------------------------------------------------------------------- the surface array
const arrays = new Map();          // theme name -> { tex, layer }
const KEEP = 2;                    // themes kept in GPU memory (a campaign's neighbouring chapters)

/**
 * The array texture holding every surface of a theme: { tex, layer(paintName) -> index }.
 * Layer 0 is plain white (vertex-coloured geometry). Painted on first use; the least recently used
 * theme is dropped when a third is asked for.
 */
export function surfaceArray(theme) {
  let a = arrays.get(theme.name);
  if (a) { arrays.delete(theme.name); arrays.set(theme.name, a); return a; }
  const names = Object.keys(theme.paints), n = names.length + 1, S = SWATCH;
  const data = new Uint8Array(S * S * 4 * n);
  data.fill(255, 0, S * S * 4);
  const index = { '': 0 };
  names.forEach((name, i) => {
    const x = paintSwatch(paintFor(theme, name));
    data.set(x.getImageData(0, 0, S, S).data, S * S * 4 * (i + 1));
    index[name] = i + 1;
  });
  const tex = new THREE.DataArrayTexture(data, S, S, n);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType; tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  a = { tex, layer: (name) => (Object.prototype.hasOwnProperty.call(index, name) ? index[name] : index.floor) };
  arrays.set(theme.name, a);
  while (arrays.size > KEEP) { const [old, v] = arrays.entries().next().value; v.tex.dispose(); arrays.delete(old); }
  return a;
}

// ---------------------------------------------------------------------------- one-off textures

/** Cracked glass, drawn: a pale wash, two bold shine strokes, cracks in white with an ink shadow. */
function paneTexture() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  const r = rng(41);
  x.clearRect(0, 0, S, S);
  x.fillStyle = 'rgba(190,236,250,0.42)'; x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineCap = 'round';
  x.lineWidth = 16; x.beginPath(); x.moveTo(36, 110); x.lineTo(104, 30); x.stroke();
  x.lineWidth = 8; x.beginPath(); x.moveTo(70, 132); x.lineTo(132, 58); x.stroke();
  for (const [col, w, o] of [['rgba(30,70,110,0.75)', 5, 1.5], ['rgba(255,255,255,0.98)', 3, 0]]) {
    const q = rng(43);
    x.strokeStyle = col; x.lineJoin = 'round';
    for (const [cx, cy] of [[92, 156], [182, 74]]) {
      for (let k = 0; k < 7; k++) {
        let a = (k / 7) * Math.PI * 2 + q() * 0.5, px = cx + o, py = cy + o;
        x.lineWidth = w; x.beginPath(); x.moveTo(px, py);
        const segs = 2 + (q() * 3 | 0);
        for (let s = 0; s < segs; s++) { a += (q() - 0.5) * 0.7; const len = 20 + q() * 38; px += Math.cos(a) * len; py += Math.sin(a) * len; x.lineTo(px, py); }
        x.stroke();
      }
    }
  }
  void r;
  x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 14; x.strokeRect(0, 0, S, S);
  x.strokeStyle = 'rgba(40,90,130,0.9)'; x.lineWidth = 5; x.strokeRect(9, 9, S - 18, S - 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

/** Painted swirls for the floor far below the level (mist, a furnace bed, the night): 3 flat tones, tiles. */
function abyssTexture(a) {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  x.fillStyle = a.base; x.fillRect(0, 0, S, S);
  const q = rng(77);
  const blobs = [];
  for (let i = 0; i < 9; i++) blobs.push([q() * S, q() * S, 26 + q() * 40, q() < 0.5]);
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    for (const [bx, by, rad, deep] of blobs) {
      x.fillStyle = deep ? mixHex(a.base, a.deep, 0.4) : mixHex(a.base, a.swirl, 0.4);      // quiet: it is the floor of the picture, not its subject
      x.beginPath(); x.ellipse(bx + dx, by + dy, rad * 1.5, rad * 0.62, 0.2, 0, 7); x.fill();
      x.fillStyle = a.base; x.beginPath(); x.ellipse(bx + dx + rad * 0.3, by + dy + rad * 0.2, rad * 0.9, rad * 0.3, 0.2, 0, 7); x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
const abyssCache = new Map();
export function abyssFor(theme) {
  if (!abyssCache.has(theme.name)) abyssCache.set(theme.name, abyssTexture(theme.abyss));
  return abyssCache.get(theme.name);
}

/**
 * The cel ramp every lit material shares: three flat bands with soft edges. Read by the toon
 * material with (N.L * 0.5 + 0.5): faces turned from the light get none of the key (they show the
 * ambient colour alone - the coloured shadow), grazing faces half, the rest all of it.
 */
function toonRamp() {
  const N = 128, data = new Uint8Array(N);
  const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    data[i] = Math.round(255 * (0.56 * ss(0.49, 0.53, u) + 0.44 * ss(0.69, 0.735, u)));
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

let cache = null;
export function getTextures() {
  if (cache) return cache;
  cache = { ramp: toonRamp(), get pane() { const v = paneTexture(); Object.defineProperty(this, 'pane', { value: v }); return v; } };
  return cache;
}

export { mixHex };
