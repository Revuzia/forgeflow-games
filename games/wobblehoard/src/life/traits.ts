// Personality: five traits as a pure function of the genome (LIFE.md 2). Never stored, so a merged, traded or restocked squishy carries its
// personality. Owned by PG_LIFE.
import type { Genome } from '../core/genome.ts';
import { MATERIAL_FAMILIES, MATERIAL_FAMILY_IDS, feelOf } from '../data/materials.ts';
import type { FeelVector } from '../data/materials.ts';
import { speciesDef } from '../data/catalog.ts';
import { SALTS } from '../data/life.ts';

/** Trait order (TRAIT_WORDS in src/data/life.ts). */
export const TRAIT = { bouncy: 0, curious: 1, cuddly: 2, chatty: 3, dozy: 4 } as const;
/** How much an eye style notices, and how sleepy it looks (LIFE 2). */
export const EYE_NOTICE: Readonly<Record<string, number>> = { wide: 1, oval: 0.6, dot: 0.45, sleepy: 0.15 };
export const EYE_SLEEP: Readonly<Record<string, number>> = { sleepy: 1, oval: 0.25, dot: 0.2, wide: 0 };
/** The seeded twist's half width. */
export const TWIST = 0.08;

const FEEL: readonly FeelVector[] = MATERIAL_FAMILY_IDS.map((id) => feelOf(MATERIAL_FAMILIES[id].physics));

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One mulberry32 draw from a state held in a 1-element array (no closure). */
function draw(st: Uint32Array): number {
  const a = (st[0] + 0x6d2b79f5) >>> 0;
  st[0] = a;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ST = new Uint32Array(1);

/** The five traits of a genome into out[off..off+4] (bouncy, curious, cuddly, chatty, dozy), each 0..1. twist = false gives the spec's
 *  untwisted spreads (LIFE 2's table was measured without the twist). */
export function traitsOf(g: Genome, out: Float32Array, off: number, twist: boolean = true): void {
  const d = speciesDef(g.species);
  const fv = FEEL[MATERIAL_FAMILY_IDS.indexOf(d.family)];
  const notice = EYE_NOTICE[g.eyeStyle] ?? 0.45, sleep = EYE_SLEEP[g.eyeStyle] ?? 0.2;
  ST[0] = (g.seed ^ SALTS.trait) >>> 0;
  const j = (): number => (twist ? (draw(ST) * 2 - 1) * TWIST : 0);
  out[off] = clamp01(0.55 * g.bounce + 0.35 * fv.bouncy + 0.1 * (d.signature === 'poke' ? 1 : 0) + j());
  out[off + 1] = clamp01(0.45 * g.stretch + 0.35 * notice + 0.2 * fv.stretchy + j());
  out[off + 2] = clamp01(0.5 * (1 - g.firmness) + 0.3 * fv.squashy + 0.2 * (d.signature === 'squeeze' ? 1 : 0) + j());
  out[off + 3] = clamp01(0.25 + 0.35 * notice + 0.25 * g.gloss + j());
  out[off + 4] = clamp01(0.6 * sleep + 0.4 * fv.slowRise + j());
}

/** The loved touch's TOUCH kinds (catalog signature: poke, squeeze, pull) as a small code: 1 poke, 2 squeeze, 3 pull. */
export function signatureCode(g: Genome): number {
  const s = speciesDef(g.species).signature;
  return s === 'poke' ? 1 : s === 'squeeze' ? 2 : 3;
}
