/**
 * CHROMA HIDE — runtime/sim/util.js
 * PURE helpers, no three, no DOM. Node-importable so selftest can exercise them.
 * Anything used by both the sim and the renderer that needs zero browser lives here.
 */

/** Deterministic PRNG (mulberry32). seed:int -> ()=>float in [0,1). */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit string hash (FNV-1a) — stable seeds from room codes / names. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, v) { return b === a ? 0 : clamp((v - a) / (b - a), 0, 1); }
export function pick(rng, arr) { return arr[(rng() * arr.length) | 0]; }

/** seconds -> "M:SS" */
export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + (s < 10 ? "0" + s : "" + s);
}

// ── Color helpers (paint system + eyedropper share these) ──────────────────
export function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgbToHex(r, g, b) {
  const to = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}
/** r,g,b 0..255 -> {h:0..360, s:0..1, v:0..1} */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}
/** h:0..360, s:0..1, v:0..1 -> {r,g,b} 0..255 */
export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Where a body's centre sits, in WORLD metres, when it is standing on a surface `elev`
 *  metres up (0 = the floor). `bodyY` is the body-local centre height, scaled by the pose
 *  (poseScaleY) and the build (bodyScale).
 *
 *  The elevation term is deliberately OUTSIDE the scaling. The renderer used to compute
 *  `position.y = py * bodyScale` with the cling height folded into py, which scaled the
 *  world elevation too: a SMALL build standing on a 1.95m shelf rendered at 1.72 — below
 *  the surface it was on — while a standard build on the same shelf sat correctly. */
export function restingBodyY(elev, bodyY, poseScaleY, bodyScale) {
  return (elev || 0) + bodyY * (poseScaleY || 1) * (bodyScale || 1);
}
