// OKLCH -> linear sRGB (Bjorn Ottosson's OKLab matrices) with chroma-reduction gamut mapping, plus the genome ->
// colour palette the whole look hangs on. Pure TypeScript (no three import): it returns plain linear-sRGB triples.
//
// Hue mapping: genome.hue is a 0..359 wheel position. We rotate it by HUE_OFFSET before treating it as an OKLCH hue so
// that the hand-made starter (hue 32 = "apricot-amber") really lands on apricot (OKLCH ~60 deg) and its core (hue 10)
// on ember-coral (OKLCH ~38 deg). Every other genome simply sees a rotated wheel, which is still the whole wheel.
import type { Genome } from '../core/genome.ts';

export type Rgb = [number, number, number];

export const HUE_OFFSET = 28;
const DEG = Math.PI / 180;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** OKLCH (L 0..1, C ~0..0.37, h degrees) to LINEAR sRGB, reducing chroma until the colour is inside the sRGB gamut. */
export function oklchToLinear(L: number, C: number, hDeg: number): Rgb {
  const h = hDeg * DEG;
  const ch = Math.cos(h), sh = Math.sin(h);
  let c = Math.max(0, C);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 28; i++) {
    const a = c * ch, bb = c * sh;
    const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
    const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const eps = 0.0008;
    if (r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps) break;
    c *= 0.94;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** LINEAR sRGB to OKLCH [L, C, h degrees]. */
export function linearToOklch(c: Rgb): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) / DEG) % 360 + 360) % 360];
}

/**
 * Colour harmony between a LIGHT inside / under the body (its core, a tier's tint) and the body colour: 0 while the light's hue is
 * within 35 degrees of the body's, rising to 1 at 110 degrees and beyond. A light far round the wheel from the body mixes with it to
 * mud (an amber core in a sage or teal jelly reads olive-brown, a coral one in a green jelly brown), so such lights are drawn paler.
 * A near-white light (OKLCH chroma under 0.03) is never far. `bodyHue` is the body's OKLCH hue (JellyPalette.hue).
 */
export function hueFar(light: Rgb, bodyHue: number): number {
  const [, C, h] = linearToOklch(light);
  if (C < 0.03) return 0;
  const d = Math.abs(((h - bodyHue) % 360 + 540) % 360 - 180);
  const t = clamp01((d - 35) / 75);
  return t * t * (3 - 2 * t) * clamp01((C - 0.03) / 0.05);
}

/** Linear -> sRGB-encoded 0..1 (only used by tests / debug printing). */
export const linearToSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export interface JellyPalette {
  body: Rgb;          // base diffuse colour
  attenuation: Rgb;   // Beer-law absorption colour (deeper, more saturated than the body)
  blush: Rgb;         // compressed regions: saturated and warmed up
  pale: Rgb;          // stretched regions: paler, less chroma
  patA: Rgb;          // pattern colour A (swirl / bands: a hue-shifted lighter tone)
  tone2: Rgb;         // Epic's second body tone (saturated, a gentle hue shift)
  patB: Rgb;          // pattern colour B (speckle flecks: cream)
  glow: Rgb;          // inner scatter tint (body colour pushed lighter/warmer)
  core: Rgb;          // core blob colour (HDR-ready: multiply by intensity)
  coreHot: Rgb;       // hot centre of the core
  pool: Rgb;          // light pool tint (fake caustic)
  glitter: Rgb;       // glitter tint
  dust: Rgb;          // landing dust tint
  /** OKLCH hue (degrees) and chroma of the body colour (for colour-harmony decisions). */
  hue: number;
  chroma: number;
}

const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Everything colour-related that depends on the genome. Called once per setBody. */
export function genomePalette(g: Genome): JellyPalette {
  const h = g.hue + HUE_OFFSET;
  // starter 0.64 -> 0.78 (light apricot). Yellow-greens turn olive-drab when dark, so they get a little extra lightness.
  const hk = ((h % 360) + 360) % 360;
  const yg = Math.max(0, 1 - Math.abs(hk - 115) / 55);
  const L = 0.5 + 0.43 * g.lightness + 0.05 * yg;
  const C = 0.03 + 0.2 * g.chroma;                 // starter 0.82 -> 0.194 (gamut clipped at this L/h)
  const body = oklchToLinear(L, C, h);
  const attenuation = oklchToLinear(Math.max(0.3, L - 0.16 + 0.06 * yg), Math.min(0.32, C * 1.25 + 0.03), h - 4);
  const blush = oklchToLinear(Math.max(0.3, L - 0.07), Math.min(0.33, C * 1.45 + 0.03), h - 14);
  const pale = oklchToLinear(Math.min(0.97, L + 0.1), C * 0.35, h + 6);
  const patA = oklchToLinear(Math.min(0.95, L + 0.1), Math.min(0.32, C * 1.3), h + 44);
  const patB = oklchToLinear(0.97, 0.035, h + 20);
  const tone2 = oklchToLinear(Math.min(0.93, L + 0.03), Math.min(0.3, C * 1.2), h + 36);
  const glow = oklchToLinear(Math.min(0.92, L + 0.05), Math.min(0.28, C * 1.2), h - 6);
  // Render hue of the core: keep it within +-110 degrees of the body hue. A near-complementary core would be absorbed by
  // the jelly and cancel the body tint toward grey; this keeps every genome's colours pleasant.
  let dh = (((g.coreHue - g.hue) % 360) + 540) % 360 - 180;
  dh = Math.max(-110, Math.min(110, dh));
  const ch = g.hue + dh + HUE_OFFSET;
  const core = oklchToLinear(0.7, 0.22, ch);
  const coreHot = oklchToLinear(0.95, 0.08, ch + 8);
  const pool = oklchToLinear(0.74, Math.min(0.26, C * 1.5), h - 4);
  const glitter = mix3(oklchToLinear(0.97, 0.05, h + 12), [1, 0.93, 0.78], 0.55);
  const dust = mix3(oklchToLinear(0.86, 0.06, h + 10), [0.95, 0.85, 0.75], 0.5);
  return { body, attenuation, blush, pale, patA, tone2, patB, glow, core, coreHot, pool, glitter, dust, hue: hk, chroma: C };
}

/**
 * The palette the renderer DRAWS with: genomePalette (which stays the catalog's colour record, CATALOG.md swatches) with colour harmony
 * applied to the inner light. A core whose hue sits far round the wheel from the body's (hueFar) glows paler and leans toward the body
 * hue, so it lights the jelly from inside without muddying it (measured on the 50-species gallery: sage, teal and emerald bodies with
 * the Common amber core read olive-brown before). Near cores are unchanged (the starter's ember-coral core in an apricot body).
 */
export function renderPalette(g: Genome): JellyPalette {
  const p = genomePalette(g);
  const far = hueFar(p.core, p.hue);
  if (far <= 0) return p;
  const [cL, cC, cH] = linearToOklch(p.core);
  const dh = ((p.hue - cH) % 360 + 540) % 360 - 180;
  const h2 = cH + dh * 0.45 * far;
  const core = oklchToLinear(Math.min(0.82, cL + 0.06 * far), cC * (1 - 0.68 * far), h2);
  const coreHot = oklchToLinear(0.95, 0.08 * (1 - 0.5 * far), h2 + 8);
  return { ...p, core, coreHot };
}

/** How much of a tier's tint (TierStyle.coreTint / coreWarm) a body takes: all of it near the body hue, 40% of it far round the wheel. */
export const tintShare = (light: Rgb, p: JellyPalette): number => 1 - 0.6 * hueFar(light, p.hue);
