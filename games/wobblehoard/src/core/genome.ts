// Genome = everything that makes one squishy look, feel and sound different. It is the seam the later modules hang on:
//   * collection  — a shelf is a list of SquishyInstance
//   * blend       — blendGenomes(parents[], seed) mixes these numbers (module BLEND, not built yet)
//   * trade       — an instance is the unit of trade; the genome travels with it as a compact share string
// Every number is stored QUANTISED to 1/255 (hue to whole degrees) so encode/decode is lossless and a genome can be
// compared, hashed and stored server-side without float drift.
import { mulberry32, clamp, hashString } from './rng.ts';

export const GENOME_VERSION = 1 as const;

export const SPECIES = ['dollop'] as const;
export type SpeciesId = (typeof SPECIES)[number];
export const PATTERNS = ['plain', 'speckle', 'swirl', 'bands'] as const;
export type PatternId = (typeof PATTERNS)[number];
export const EYE_STYLES = ['dot', 'oval', 'sleepy', 'wide'] as const;
export type EyeStyleId = (typeof EYE_STYLES)[number];

export interface Genome {
  v: typeof GENOME_VERSION;
  species: SpeciesId;        // rest-shape family. 'dollop' = squat swirl-peaked blob (the slice squishy)
  seed: number;              // uint32: cosmetic micro-variation (speckle layout, glitter layout, eye idle timing)
  hue: number;               // 0..359 body hue, degrees
  chroma: number;            // 0..1 body colour strength
  lightness: number;         // 0..1
  coreHue: number;           // 0..359 hue of the glowing core seed inside the body
  coreGlow: number;          // 0..1
  translucency: number;      // 0..1 (1 = glassy gummy, 0 = near-opaque dumpling)
  gloss: number;             // 0..1 clearcoat / smoothness
  firmness: number;          // 0..1 soft(0) .. springy-firm(1)  -> shape-matching stiffness
  bounce: number;            // 0..1 how long it jiggles after release (internal damping)
  stretch: number;           // 0..1 how far it pulls before it resists
  size: number;              // 0..1 -> 0.8x .. 1.25x radius
  glitter: number;           // 0..1 suspended sparkle density
  speckle: number;           // 0..1 pattern strength
  pattern: PatternId;
  eyeStyle: EyeStyleId;
  eyeSpacing: number;        // 0..1
  eyeSize: number;           // 0..1
  eyeHeight: number;         // 0..1
}

/** The unit of ownership and trade. `id` is globally unique and never reused. */
export interface SquishyInstance {
  id: string;
  genome: Genome;
  name: string;
  bornAt: number;            // epoch ms
  origin: { kind: 'starter' | 'drop' | 'task' | 'blend' | 'trade'; parents?: string[] };
  tradeCount: number;        // incremented by the server on every completed trade (never client-side)
}

const q255 = (v: number): number => Math.round(clamp(v, 0, 1) * 255) / 255;
const qDeg = (v: number): number => ((Math.round(v) % 360) + 360) % 360;

const UNIT_KEYS = [
  'chroma', 'lightness', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size',
  'glitter', 'speckle', 'eyeSpacing', 'eyeSize', 'eyeHeight',
] as const;

/** Snap every field onto its storage grid. All constructors below return quantised genomes. */
export function quantizeGenome(g: Genome): Genome {
  const out: Genome = { ...g, seed: g.seed >>> 0, hue: qDeg(g.hue), coreHue: qDeg(g.coreHue) };
  for (const k of UNIT_KEYS) out[k] = q255(g[k]);
  return out;
}

/** The slice's one hand-made squishy: DOLLOP, a translucent apricot-amber swirl-peaked blob with an ember-coral core. */
export function makeStarterGenome(): Genome {
  return quantizeGenome({
    v: GENOME_VERSION, species: 'dollop', seed: 0x0d011009,
    hue: 32, chroma: 0.82, lightness: 0.64,
    coreHue: 10, coreGlow: 0.8,
    translucency: 0.78, gloss: 0.88,
    firmness: 0.38, bounce: 0.74, stretch: 0.62, size: 0.5,
    glitter: 0.3, speckle: 0, pattern: 'plain',
    eyeStyle: 'dot', eyeSpacing: 0.5, eyeSize: 0.5, eyeHeight: 0.5,
  });
}

/** A varied, always-pleasant genome from a seed (used by ?genome=<seed> and, later, drops). Deterministic. */
export function randomGenome(seed: number): Genome {
  const r = mulberry32(seed ^ 0x9e3779b9);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const hue = Math.floor(r() * 360);
  const coreOffset = 30 + r() * 120;
  const dir = r() < 0.5 ? -1 : 1;
  return quantizeGenome({
    v: GENOME_VERSION, species: 'dollop', seed: Math.floor(r() * 4294967296) >>> 0,
    hue, chroma: 0.55 + r() * 0.4, lightness: 0.5 + r() * 0.22,
    coreHue: hue + dir * coreOffset, coreGlow: 0.35 + r() * 0.65,
    translucency: 0.4 + r() * 0.6, gloss: 0.55 + r() * 0.45,
    firmness: r(), bounce: 0.3 + r() * 0.7, stretch: r(), size: r(),
    glitter: r() < 0.4 ? 0 : r(), speckle: r() < 0.5 ? 0 : r(),
    pattern: pick(PATTERNS), eyeStyle: pick(EYE_STYLES),
    eyeSpacing: r(), eyeSize: r(), eyeHeight: r(),
  });
}

/** Voice pitch ratio for this squishy (audio lane multiplies its base frequencies by it). Bigger = lower, firmer = higher. */
export function pitchRatio(g: Genome): number {
  const r = mulberry32(g.seed ^ 0x51ed270b);
  const semis = -(g.size - 0.5) * 7 + (g.firmness - 0.5) * 4 + (r() - 0.5) * 1.5;
  return Math.pow(2, semis / 12);
}

// ---- share string: "g1." + base64url(bytes). 26 bytes -> 35 chars + prefix = 38. ----
// byte layout: [version][species][pattern][eyeStyle][seed u32 LE][hue u16 LE][coreHue u16 LE][14 unit fields u8]
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += B64[n & 63];
  }
  return s;
}

function fromB64Url(s: string): Uint8Array | null {
  const vals: number[] = [];
  for (const ch of s) {
    const i = B64.indexOf(ch);
    if (i < 0) return null;
    vals.push(i);
  }
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const n = (vals[i] << 18) | ((vals[i + 1] ?? 0) << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
    out.push((n >> 16) & 255);
    if (i + 2 < vals.length) out.push((n >> 8) & 255);
    if (i + 3 < vals.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

export function encodeGenome(g: Genome): string {
  const b = new Uint8Array(4 + 4 + 2 + 2 + UNIT_KEYS.length);
  b[0] = g.v; b[1] = SPECIES.indexOf(g.species); b[2] = PATTERNS.indexOf(g.pattern); b[3] = EYE_STYLES.indexOf(g.eyeStyle);
  const s = g.seed >>> 0;
  b[4] = s & 255; b[5] = (s >>> 8) & 255; b[6] = (s >>> 16) & 255; b[7] = (s >>> 24) & 255;
  b[8] = g.hue & 255; b[9] = g.hue >> 8; b[10] = g.coreHue & 255; b[11] = g.coreHue >> 8;
  UNIT_KEYS.forEach((k, i) => { b[12 + i] = Math.round(clamp(g[k], 0, 1) * 255); });
  return 'g1.' + toB64Url(b);
}

/** Returns null for anything that is not a valid v1 share string (never throws; the input may come from another player). */
export function decodeGenome(code: string): Genome | null {
  if (typeof code !== 'string' || !code.startsWith('g1.')) return null;
  const b = fromB64Url(code.slice(3));
  const len = 12 + UNIT_KEYS.length;
  if (!b || b.length !== len || b[0] !== GENOME_VERSION) return null;
  const species = SPECIES[b[1]], pattern = PATTERNS[b[2]], eyeStyle = EYE_STYLES[b[3]];
  if (!species || !pattern || !eyeStyle) return null;
  const hue = b[8] | (b[9] << 8), coreHue = b[10] | (b[11] << 8);
  if (hue > 359 || coreHue > 359) return null;
  const g = {
    v: GENOME_VERSION, species, pattern, eyeStyle,
    seed: (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0, hue, coreHue,
  } as Genome;
  UNIT_KEYS.forEach((k, i) => { g[k] = b[12 + i] / 255; });
  return g;
}

/** Canonical equality (key order and float noise independent): two genomes are equal iff their share strings are. */
export const genomeEquals = (a: Genome, b: Genome): boolean => encodeGenome(a) === encodeGenome(b);

/** Fresh instance. `id` and `now` are injectable so tests stay deterministic. */
export function newInstance(
  genome: Genome,
  origin: SquishyInstance['origin'] = { kind: 'starter' },
  name = 'Dollop',
  id: string = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
  now: number = Date.now(),
): SquishyInstance {
  return { id, genome, name, bornAt: now, origin, tradeCount: 0 };
}

/** Parse the ?genome= URL value: "g1.xxxx" share string, or a number/word used as a seed. Falls back to the starter. */
export function genomeFromParam(value: string | null | undefined): Genome {
  if (!value) return makeStarterGenome();
  const decoded = decodeGenome(value);
  if (decoded) return decoded;
  const n = Number(value);
  if (Number.isFinite(n)) return randomGenome(n >>> 0);
  return randomGenome(hashString(value));
}
