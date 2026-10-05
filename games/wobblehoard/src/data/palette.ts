// WOBBLEHOARD palette contract: genome -> the BODY and CORE colours a squishy is drawn with, as plain numbers (OKLCH in, linear sRGB
// and OKLab out). Pure TypeScript: no three, no DOM, no clock, no randomness.
//
// Why it lives in src/data: the catalog's colour rules (two species of a tier never share a colour, an instance never strays from its
// species colour, a blurb's colour word tells the truth, a merge result stays nearest its own species colour) are DATA rules, and they
// must not move when the render lane retunes a shader. This module is the stated contract for the two colours those rules are about.
// src/render/oklch.ts genomePalette must draw `body` and `core` with exactly these formulas; _harness/probe_catalog.ts compares the
// two every run (a SEAM check) so any drift is reported by name instead of silently invalidating the catalog's colour gates.
//
// Formulas (identical to src/render/oklch.ts at the time of writing):
//   h = genome.hue + 28 (HUE_OFFSET: genome 32 = apricot, 10 = ember coral)
//   L = 0.5 + 0.43 * lightness + 0.05 * yellowGreenBoost(h)        C = 0.03 + 0.2 * chroma
//   body = OKLCH(L, C, h), chroma reduced until inside the sRGB gamut
//   core = OKLCH(0.7, 0.22, hue + clamp(coreHue - hue, -110, 110) + 28), gamut-mapped the same way
import type { Genome } from '../core/genome.ts';

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

/** Degrees added to genome.hue before it is used as an OKLCH hue. */
export const HUE_OFFSET = 28;
/** The renderer keeps the core within this many degrees of the body hue (a near-complementary core would grey the jelly out). */
export const CORE_HUE_MAX_DELTA = 110;
const DEG = Math.PI / 180;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** OKLCH (L 0..1, C ~0..0.37, h degrees) to LINEAR sRGB, reducing chroma (x0.94 per step, up to 28 steps) until inside the gamut. */
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

/** Linear sRGB -> OKLab (Ottosson). */
export function linearToOklab(lin: readonly number[]): Lab {
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Euclidean OKLab distance (about 0.02 = just noticeable side by side; the catalog keeps species of one tier >= 0.075 apart). */
export const labDistance = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Linear -> sRGB-encoded 0..1. */
export const linearToSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** Linear sRGB triple -> '#rrggbb'. */
export const linearToHex = (lin: readonly number[]): string => '#' + lin.map((v) => Math.round(255 * clamp01(linearToSrgb(v))).toString(16).padStart(2, '0')).join('');

type Colour = Pick<Genome, 'hue' | 'chroma' | 'lightness'>;

/** The body colour of a genome, in linear sRGB (what the renderer uses as the jelly's base colour). */
export function bodyLinear(g: Colour): Rgb {
  const h = g.hue + HUE_OFFSET;
  const hk = ((h % 360) + 360) % 360;
  const yg = Math.max(0, 1 - Math.abs(hk - 115) / 55); // yellow-greens turn olive-drab when dark: a little extra lightness
  const L = 0.5 + 0.43 * g.lightness + 0.05 * yg;
  const C = 0.03 + 0.2 * g.chroma;
  return oklchToLinear(L, C, h);
}

/** The body colour in OKLab (the space every catalog colour rule is measured in). */
export const bodyLab = (g: Colour): Lab => linearToOklab(bodyLinear(g));

/** The core blob colour of a genome, in linear sRGB (core hue kept within CORE_HUE_MAX_DELTA of the body hue). */
export function coreLinear(g: Pick<Genome, 'hue' | 'coreHue'>): Rgb {
  let dh = (((g.coreHue - g.hue) % 360) + 540) % 360 - 180;
  dh = Math.max(-CORE_HUE_MAX_DELTA, Math.min(CORE_HUE_MAX_DELTA, dh));
  return oklchToLinear(0.7, 0.22, g.hue + dh + HUE_OFFSET);
}
