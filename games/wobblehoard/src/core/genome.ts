// Genome = everything that makes one squishy look, feel and sound different. It is the seam the later modules hang on:
//   * collection  — a shelf is a list of SquishyInstance
//   * blend       — blendGenomes(parents[], seed) mixes these numbers (module BLEND, not built yet)
//   * trade       — an instance is the unit of trade; the genome travels with it as a compact share string
// Every number is stored QUANTISED to 1/255 (hue to whole degrees) so encode/decode is lossless and a genome can be
// compared, hashed and stored server-side without float drift.
//
// CANONICAL FORM. quantizeGenome is the one canonicaliser: encodeGenome quantises before it writes (so a genome and its quantised
// copy share one string), decodeGenome accepts only the string encodeGenome would write for the result (no alias spellings), and
// genomeEquals compares canonical forms. One genome <=> one share string, so a code can serve as an identity or dedupe key.
import { mulberry32, clamp, hashString } from './rng.ts';
// The species list lives in the leaf module src/data/species.ts (append-only: position = idx = the byte stored in share strings).
// Both this file and src/data/catalog.ts import it, so there is no genome <-> catalog import cycle.
import { SPECIES } from '../data/species.ts';
import type { SpeciesId } from '../data/species.ts';
export { SPECIES };
export type { SpeciesId };

export const GENOME_VERSION = 1 as const;
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

/** Every field of a Genome, in a fixed order (canonicalGenome copies exactly these; extra keys are dropped). */
const GENOME_KEYS = [
  'v', 'species', 'seed', 'hue', 'chroma', 'lightness', 'coreHue', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size',
  'glitter', 'speckle', 'pattern', 'eyeStyle', 'eyeSpacing', 'eyeSize', 'eyeHeight',
] as const satisfies readonly (keyof Genome)[];

/** The unit of ownership and trade. `id` is globally unique and never reused. */
export interface SquishyInstance {
  id: string;
  genome: Genome;
  name: string;
  bornAt: number;            // epoch ms
  /** 'restock' (additive, COLLECTION.md 3.5 item 1 / DESIGN 7.1): a Daily Restock pick. */
  origin: { kind: 'starter' | 'drop' | 'task' | 'blend' | 'trade' | 'restock'; parents?: string[] };
  tradeCount: number;        // incremented by the server on every completed trade (never client-side)
}

/** Unit field onto the 1/255 grid. A non-finite value (NaN, a missing field) becomes the neutral 0.5; +-Infinity clamps to 1 / 0. */
const q255 = (v: number): number => (typeof v !== 'number' || Number.isNaN(v) ? 0.5 : Math.round(clamp(v, 0, 1) * 255) / 255);
/** Degrees onto whole degrees 0..359 (wrapping). A non-finite value (or a non-number) becomes 0. */
const qDeg = (v: number): number => (typeof v === 'number' && Number.isFinite(v) ? ((Math.round(v) % 360) + 360) % 360 : 0);

const UNIT_KEYS = [
  'chroma', 'lightness', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size',
  'glitter', 'speckle', 'eyeSpacing', 'eyeSize', 'eyeHeight',
] as const;

/**
 * Snap every numeric field onto its storage grid (the canonical form). All constructors below return quantised genomes, and
 * quantizeGenome is idempotent. Non-finite numbers get defined values (unit fields 0.5, hues 0, seed 0) so the result is always
 * finite; the enum fields (species, pattern, eyeStyle) and `v` are copied as they are (encodeGenome validates them).
 */
export function quantizeGenome(g: Genome): Genome {
  const out: Genome = { ...g, seed: typeof g.seed === 'number' && Number.isFinite(g.seed) ? g.seed >>> 0 : 0, hue: qDeg(g.hue), coreHue: qDeg(g.coreHue) };
  for (const k of UNIT_KEYS) out[k] = q255(g[k]);
  return out;
}

/** True when `x` has the version and enum fields a share string can carry (the numbers are canonicalised, never rejected). */
function encodable(x: Genome): boolean {
  return x.v === GENOME_VERSION && SPECIES.includes(x.species) && PATTERNS.includes(x.pattern) && EYE_STYLES.includes(x.eyeStyle);
}

/**
 * Strict validation for genomes that come from outside (a save, a merge request, another player): an object with v = 1, a known
 * species / pattern / eye style, and a FINITE number in every numeric field. Returns its canonical (quantised) form, or null.
 * Unlike quantizeGenome it never invents a value: NaN, a missing field or a string is a rejection, not a default.
 */
export function canonicalGenome(x: unknown): Genome | null {
  if (!x || typeof x !== 'object') return null;
  const g = x as Record<string, unknown>;
  for (const k of ['seed', 'hue', 'coreHue', ...UNIT_KEYS]) if (typeof g[k] !== 'number' || !Number.isFinite(g[k])) return null;
  const c = quantizeGenome(x as Genome);
  const out = {} as Record<string, unknown>;
  for (const k of GENOME_KEYS) out[k] = (c as unknown as Record<string, unknown>)[k];
  return encodable(out as unknown as Genome) ? (out as unknown as Genome) : null;
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

/**
 * The share string of a genome. Quantises first (quantizeGenome), so a genome and its quantised copy encode identically and hue,
 * NaN or out-of-range numbers can never produce a string that decodeGenome would reject. Throws a RangeError for a genome that has
 * no share string at all (wrong version, unknown species / pattern / eye style): that is a programming error, never player input.
 */
export function encodeGenome(g: Genome): string {
  const q = quantizeGenome(g);
  if (!encodable(q)) throw new RangeError(`encodeGenome: not a v${GENOME_VERSION} genome with a known species / pattern / eyeStyle (${String(q.species)} / ${String(q.pattern)} / ${String(q.eyeStyle)})`);
  const b = new Uint8Array(4 + 4 + 2 + 2 + UNIT_KEYS.length);
  b[0] = q.v; b[1] = SPECIES.indexOf(q.species); b[2] = PATTERNS.indexOf(q.pattern); b[3] = EYE_STYLES.indexOf(q.eyeStyle);
  const s = q.seed;
  b[4] = s & 255; b[5] = (s >>> 8) & 255; b[6] = (s >>> 16) & 255; b[7] = (s >>> 24) & 255;
  b[8] = q.hue & 255; b[9] = q.hue >> 8; b[10] = q.coreHue & 255; b[11] = q.coreHue >> 8;
  UNIT_KEYS.forEach((k, i) => { b[12 + i] = Math.round(q[k] * 255); });
  return 'g1.' + toB64Url(b);
}

/**
 * Returns null for anything that is not a valid, CANONICAL v1 share string (never throws; the input may come from another player).
 * Canonical = exactly the string encodeGenome writes for the decoded genome: 26 bytes give 35 base64url characters whose last one
 * carries 2 unused bits, and a string with those bits set (or any other alias spelling) is refused rather than silently accepted.
 */
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
  return encodeGenome(g) === code ? g : null;
}

/**
 * Canonical equality: true iff the two genomes have the same canonical (quantised) form, i.e. for any encodable genome iff their share
 * strings are equal. Independent of key order and of float noise below the storage grid (genomeEquals(g, quantizeGenome(g)) is true).
 * Total: never throws, also for genomes that cannot be encoded (those compare field by field after quantisation).
 */
export function genomeEquals(a: Genome, b: Genome): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const qa = quantizeGenome(a) as unknown as Record<string, unknown>, qb = quantizeGenome(b) as unknown as Record<string, unknown>;
  return GENOME_KEYS.every((k) => qa[k] === qb[k]); // === (not Object.is): -0 and 0 encode to the same byte
}

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
