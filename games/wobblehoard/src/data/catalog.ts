// WOBBLEHOARD catalog: the roster of 50 squishies, their tiers, material families, rest shapes and base looks (_spec/DESIGN.md 5.2, 5.3).
//
// ═══════════════════════════════════ IDX STABILITY: APPEND-ONLY, FOREVER ═══════════════════════════════════
// A species' position in SPECIES (== its `idx`) is written into every share string (one byte, src/core/genome.ts), every save and,
// later, every server row. Therefore:
//   1. NEVER reorder, rename the id of, delete, or reuse an entry. A species that must disappear stays here with its idx.
//   2. New species are APPENDED at the end of SPECIES and at the end of CATALOG (idx = previous length, max 255), in any tier.
//   3. `name`, `blurb`, `tags`, the look and the shape of an existing species MAY be tuned (they are not stored in share strings),
//      but a tier or family change moves a species in the economy: do it only with a design decision, never silently.
//   4. probe_catalog.ts holds a locked copy of the id list (IDX_LOCK) and fails if any existing position changes; when you append,
//      append to IDX_LOCK in the same commit.
// The module also asserts rules 1-2 at load time (CATALOG[i].id === SPECIES[i] === idx i), so a bad edit cannot ship.
//
// Everything here is DATA plus pure functions (no DOM, no three, no clock, no Math.random): a server can import it unchanged.
// What the SERVER must also recompute: speciesBaseGenome(species, seed) (the capsule roll hands the client only a species id and a
// genome seed; the client and the server derive the same genome from them).
//
// Structure of the roster (why the families sit where they do):
//   DESIGN 5.2 reserves a family-by-tier GRID with six columns (A..F). The physics lane built twelve material families, so each
//   column is a LANE of two related families: an everyday one and a signature one. The signature family always has the higher mean
//   tier ("higher tiers favour the more distinctive feels", and it is the family with the larger distance to all others in
//   materialDistance); probe_catalog.ts checks the grid cell by cell and the lane rule.
//        lane  letter  everyday family  ->  signature family     grid column of DESIGN 5.2 (Common..Mythic)
//        jelly   A     jellygel             stickystretch         3 2 2 1 1 1
//        fill    B     waterfill            beadsqueeze           3 2 2 1 1 1
//        chew    C     gummy                slimegoo              2 2 2 1 1 1
//        foam    D     marshmallow          slowrise              2 2 2 1 1 0
//        dough   E     mochidough           putty                 2 2 1 1 1 0
//        rubber  F     firmsilicone         popdome               2 1 1 2 0 0
//   Letters differ from the example mapping in DESIGN 5.2 on purpose: the three columns that hold a Mythic (A, B, C) are the jelly,
//   fill and chew lanes, because a Mythic's inner light and iridescence need a translucent body; opaque foam and dough lanes stop at
//   Epic/Legendary. The six lanes cover every example family named in DESIGN 5.2 (foam, mochi/dough, jelly, liquid-filled, slime, putty).
//
// Tier language shows in the data itself, not only in the label (DESIGN 5.3): coreGlow, glitter, translucency, patterning and the
// number of features in the silhouette all rise with tier, and the inner-light hue (coreHue) is the tier's tell colour (cream,
// lagoon, dusk violet, ember coral, sodium amber; Mythic cycles), with body hues kept within the +-110 degrees the renderer allows
// between body and core, so the stored coreHue is the hue that is actually drawn.
//
// ORIGINALITY: every name, blurb and palette below is invented for this game. probe_catalog.ts runs a 200+ word denylist of real
// brands, characters, toy lines and games (edit distance 1 included) and a language-safety list over names, ids and blurbs.
import type { Genome, EyeStyleId, PatternId } from '../core/genome.ts';
import { quantizeGenome, GENOME_VERSION } from '../core/genome.ts';
import { mulberry32, hashString } from '../core/rng.ts';
import type { MaterialFamilyId } from './materials.ts';
import type { TierId } from '../core/rarity.ts';
import { TIERS, tierIndex } from '../core/rarity.ts';
import type { ShapeRecipe } from './shapes.ts';
import { DOLLOP_RECIPE, shape, bump as B, dent as D, ridge as R } from './shapes.ts';

/* ───────────────────────────────────────────── the append-only registry ───────────────────────────────────────────── */

/** Species ids in IDX ORDER. APPEND ONLY. Position = idx = the byte stored in share strings. */
export const SPECIES = [
  // common (0..13)
  'dollop', 'plumpet', 'twangle', 'puddlo', 'glubbin', 'crumbit', 'chunkle', 'munchip', 'wisplet', 'cushlet', 'crimpo', 'thumbly', 'sproink', 'dimpla',
  // uncommon (14..24)
  'nuzzo', 'flickum', 'swishel', 'granulo', 'peakum', 'wrigglo', 'fluffnut', 'capnap', 'knubby', 'kneadle', 'hooplet',
  // rare (25..34)
  'spirelo', 'zingle', 'petalop', 'burrbin', 'marigel', 'gloopsy', 'hushpuff', 'drowsel', 'thudge', 'diademo',
  // epic (35..41)
  'taffelin', 'maracon', 'cindergoo', 'selenuff', 'pastrel', 'flipdome', 'caromel',
  // legendary (42..46)
  'ambrosel', 'tidelume', 'glimglop', 'somnuff', 'fossilo',
  // mythic (47..49)
  'skeinara', 'constello', 'prismelo',
] as const;
export type SpeciesId = (typeof SPECIES)[number];
export const SPECIES_COUNT = SPECIES.length;
/** Highest idx a share string can carry (one byte). */
export const MAX_SPECIES_IDX = 255;

/* ───────────────────────────────────────────────────── types ───────────────────────────────────────────────────── */

/** The six columns of the DESIGN 5.2 family-by-tier grid (A..F in order). */
export const LANES = [
  { id: 'jelly', letter: 'A', name: 'Jelly', everyday: 'jellygel', signature: 'stickystretch' },
  { id: 'fill', letter: 'B', name: 'Fill', everyday: 'waterfill', signature: 'beadsqueeze' },
  { id: 'chew', letter: 'C', name: 'Chew', everyday: 'gummy', signature: 'slimegoo' },
  { id: 'foam', letter: 'D', name: 'Foam', everyday: 'marshmallow', signature: 'slowrise' },
  { id: 'dough', letter: 'E', name: 'Dough', everyday: 'mochidough', signature: 'putty' },
  { id: 'rubber', letter: 'F', name: 'Rubber', everyday: 'firmsilicone', signature: 'popdome' },
] as const satisfies ReadonlyArray<{ id: string; letter: string; name: string; everyday: MaterialFamilyId; signature: MaterialFamilyId }>;
export type LaneId = (typeof LANES)[number]['id'];

/** The touch this species is known for (hint text and a small look bias in its genome roll; it never changes drop odds). */
export type Signature = 'poke' | 'squeeze' | 'pull';

/** A base look: every Genome field except the version, species and seed. */
export type LookBase = Omit<Genome, 'v' | 'species' | 'seed'>;

/** Half-widths (+-) of the cosmetic variation between two instances of one species. Fields not listed never vary (pattern, eyeStyle). */
export interface LookBands {
  hue: number; chroma: number; lightness: number; coreHue: number; coreGlow: number; translucency: number; gloss: number;
  firmness: number; bounce: number; stretch: number; size: number; glitter: number; speckle: number;
  eyeSpacing: number; eyeSize: number; eyeHeight: number;
}

export interface SpeciesDef {
  /** Stable index 0..255 = position in SPECIES. Written into share strings. Never reused. */
  readonly idx: number;
  /** Stable slug (lowercase letters). Server and share-string key. */
  readonly id: SpeciesId;
  /** Display name (invented, 4-12 letters). May be tuned later; never stored in a share string. */
  readonly name: string;
  readonly tier: TierId;
  readonly family: MaterialFamilyId;
  readonly lane: LaneId;
  readonly signature: Signature;
  /** One phrase for the designer: what the silhouette is. */
  readonly silhouette: string;
  readonly shape: ShapeRecipe;
  readonly look: LookBase;
  readonly bands: LookBands;
  /** One friendly original line, at most 90 characters. */
  readonly blurb: string;
  readonly tags: readonly string[];
}

/* ───────────────────────────────────────────────── helper builders ───────────────────────────────────────────────── */

/** Default cosmetic bands: small enough that two species of a tier never overlap in colour (probe_catalog.ts checks the gap). */
const BANDS: LookBands = {
  hue: 4, chroma: 0.04, lightness: 0.035, coreHue: 8, coreGlow: 0.06, translucency: 0.06, gloss: 0.06,
  firmness: 0.08, bounce: 0.08, stretch: 0.08, size: 0.07, glitter: 0.08, speckle: 0.12,
  eyeSpacing: 0.06, eyeSize: 0.06, eyeHeight: 0.06,
};

type LookIn = Pick<LookBase, 'hue' | 'chroma' | 'lightness' | 'coreHue' | 'coreGlow'> & Partial<LookBase>;
const look = (o: LookIn): LookBase => ({
  translucency: 0.5, gloss: 0.6, firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5, glitter: 0, speckle: 0,
  pattern: 'plain' as PatternId, eyeStyle: 'dot' as EyeStyleId, eyeSpacing: 0.5, eyeSize: 0.5, eyeHeight: 0.5, ...o,
});

type DefIn = Omit<SpeciesDef, 'idx' | 'bands'> & { bands?: Partial<LookBands> };

/* ───────────────────────────────────────────────────── the roster ───────────────────────────────────────────────────── */
// Axes: x = left/right, y = up, z = toward the camera (the face is on +Z; the front stays smooth so the eyes sit on a clean patch).
// Hue is the genome wheel (the renderer adds 28 degrees: genome 32 = apricot, 10 = ember coral).

/** Rest-shape recipes, one per species (kept together so the silhouettes can be compared at a glance). */
const SHAPES: Record<SpeciesId, ShapeRecipe> = {
  // ── common ──
  dollop: DOLLOP_RECIPE,
  plumpet: shape([0.95, 1.15, 0.95], []),
  twangle: shape([0.72, 1.1, 0.72], [B([0, 1, 0], 0.6, 0.42), D([0, -1, 0], 0.1, 0.7)]),
  puddlo: shape([1.45, 0.5, 1.3], []),
  glubbin: shape([1.25, 0.8, 0.8], [D([0, 1, 0], 0.4, 0.8), B([1, -0.2, 0.15], 0.25, 0.6, true)]),
  crumbit: shape([0.75, 1.1, 0.75], [B([0, -1, 0.05], 0.6, 1.0), B([0, 1, 0], 0.1, 0.4)]),
  chunkle: shape([0.8, 1.2, 0.65], [B([1, 1, 0], 0.4, 0.6, true), B([1, -1, 0], 0.4, 0.6, true)]),
  munchip: shape([1.0, 0.9, 0.62], [D([0, 1, 0], 0.45, 0.45), B([0.65, 0.75, 0], 0.45, 0.55, true)]),
  wisplet: shape([1.2, 0.55, 0.8], [B([0.75, 0.6, 0], 0.85, 0.5, true), B([0, 1, 0], 0.75, 0.5)]),
  cushlet: shape([0.75, 0.78, 0.75], [B([1, 1, 1], 0.7, 0.55, true), B([1, -1, 1], 0.7, 0.55, true), B([1, 1, -1], 0.7, 0.55, true), B([1, -1, -1], 0.7, 0.55, true)]),
  crimpo: shape([1.3, 0.68, 0.78], [R([0, 1, 0], [1, 0, 0], 0.3, 0.36, 1.3), B([1, -0.15, 0], 0.3, 0.5, true)]),
  thumbly: shape([1.1, 0.85, 0.95], [B([0.8, -0.2, 0.45], 0.65, 0.55, true), D([0, 1, 0.25], 0.1, 0.4)]),
  sproink: shape([0.78, 0.8, 1.3], [B([0, 0.2, -1], 0.2, 0.5)]),
  dimpla: shape([1.2, 0.62, 1.2], [B([0, 1, 0], 0.55, 0.7)]),
  // ── uncommon ──
  nuzzo: shape([0.95, 0.9, 0.95], [B([0.75, 0.65, -0.05], 0.8, 0.42, true)]),
  flickum: shape([0.85, 0.95, 0.9], [B([0, 0.1, -1], 1.0, 0.38), D([0, -1, 0], 0.08, 0.6)]),
  swishel: shape([1.0, 0.95, 1.0], [D([0, 1, 0], 0.55, 0.7)]),
  granulo: shape([0.7, 0.7, 0.55], [B([0, 1, 0], 0.9, 0.45), B([0.951, 0.309, 0], 0.9, 0.45, true), B([0.588, -0.809, 0], 0.9, 0.45, true)]),
  peakum: shape([1.0, 0.8, 0.9], [B([0.45, 1, -0.3], 1.0, 0.36, true)]),
  wrigglo: shape([1.3, 0.66, 0.7], [B([1, 0.45, 0], 0.38, 0.5), D([-0.3, 1, 0], 0.2, 0.6)]),
  fluffnut: shape([0.95, 0.85, 0.95], [B([0, 0.5, 0], 0.4, 1.1), B([0, 1, 0.1], 0.7, 0.36)]),
  capnap: shape([1.25, 0.75, 1.25], [D([0.85, -0.55, 0], 0.5, 0.7, true), D([0, -0.55, 0.85], 0.3, 0.7), D([0, -0.55, -0.85], 0.5, 0.7)]),
  knubby: shape([0.95, 1.0, 0.78], [B([1, 0.1, 0.1], 0.65, 0.45), D([-1, 0, 0], 0.1, 0.6)]),
  kneadle: shape([1.1, 0.8, 0.95], [B([-0.6, 0.5, -0.3], 0.6, 0.55), D([0.7, 0.9, 0.3], 0.25, 0.5)]),
  hooplet: shape([1.15, 0.7, 1.15], [D([0, 1, 0], 0.4, 0.55), D([0, -1, 0], 0.3, 0.6)]),
  // ── rare ──
  spirelo: shape([0.88, 0.9, 0.88], [B([0, 1, 0.25], 1.0, 0.36), B([0.95, -0.1, 0.3], 0.35, 0.5, true)]),
  zingle: shape([0.8, 1.0, 0.9], [R([0, 1, 0], [0, 0, 1], 0.55, 0.4, 1.3), B([0, 0.1, -1], 0.85, 0.4), D([0, -1, 0], 0.08, 0.6)]),
  petalop: shape([0.85, 0.85, 0.6], [B([0, 1, 0], 0.7, 0.52), B([1, 0.1, 0], 0.65, 0.52, true)]),
  burrbin: shape([0.9, 0.9, 0.9], [B([0, 1, 0], 0.5, 0.42), B([0.85, 0.55, 0], 0.5, 0.4, true), B([0, 0.4, -1], 0.5, 0.4), B([0.7, 0.4, -0.6], 0.5, 0.4, true), B([1, -0.1, 0], 0.5, 0.4, true)]),
  marigel: shape([0.8, 0.8, 0.5], [B([0.383, 0.924, 0], 0.6, 0.36, true), B([0.924, 0.383, 0], 0.6, 0.36, true), B([0.924, -0.383, 0], 0.6, 0.36, true), B([0.383, -0.924, 0], 0.6, 0.36, true)]),
  gloopsy: shape([1.0, 0.8, 0.9], [B([0.8, 0.6, 0], 0.6, 0.5, true), B([0, 1, 0], 0.55, 0.5), B([0.6, -0.3, -0.8], 0.4, 0.4, true)]),
  hushpuff: shape([1.0, 0.9, 0.95], [B([0.8, 0.65, -0.15], 0.7, 0.45, true), B([0.9, -0.2, 0.4], 0.4, 0.5, true), B([0, 1, -0.1], 0.4, 0.4)]),
  drowsel: shape([1.2, 0.75, 0.85], [B([-0.35, 0.8, -0.2], 0.95, 0.7), B([0.95, 0.3, 0.2], 0.4, 0.45)]),
  thudge: shape([1.1, 0.85, 1.0], [B([-0.7, 0.6, 0], 0.5, 0.5), B([0.6, 0.7, -0.5], 0.45, 0.5), B([0.2, 0.1, -1], 0.45, 0.45), D([0.5, 0.3, 0.9], 0.12, 0.5)]),
  diademo: shape([1.05, 0.7, 1.05], [B([0, 1, 0], 1.0, 0.4), B([0.6, 0.8, 0], 0.9, 0.38, true), B([0.35, 0.8, -0.55], 0.85, 0.38, true)]),
  // ── epic ──
  taffelin: shape([0.8, 0.85, 1.1], [R([0, 0.3, -1], [0, 1, 0], 0.65, 0.42, 1.1), B([1, 0, -0.2], 0.4, 0.4, true), B([0.9, -0.25, 0.3], 0.3, 0.45, true)]),
  maracon: shape([0.9, 0.95, 0.9], [B([0, 1, 0], 0.55, 0.4), B([0.9, 0.5, -0.4], 0.5, 0.4, true), B([0, 0.3, -1], 0.5, 0.4), D([0.9, 0.2, 0.4], 0.2, 0.45, true)]),
  cindergoo: shape([0.8, 0.85, 0.8], [B([0, 1, 0], 0.6, 0.55), B([0, 1, 0], 0.45, 0.35), B([0.6, 0.8, 0], 0.4, 0.36, true), B([0.8, -0.2, 0.2], 0.4, 0.45, true)]),
  selenuff: shape([1.0, 0.9, 0.85], [B([0.6, 0.85, -0.15], 0.9, 0.38, true), D([0, 0.95, 0.2], 0.35, 0.55), B([0, 0.25, -1], 0.45, 0.5)]),
  pastrel: shape([1.25, 0.65, 0.8], [D([0, -1, 0], 0.36, 0.7), B([0.95, 0.2, 0.2], 0.4, 0.4, true), R([0, 1, 0], [1, 0, 0], 0.3, 0.35, 1.2)]),
  flipdome: shape([1.05, 0.75, 1.05], [B([0, 1, 0], 0.6, 0.55), R([1, 0, 0], [0, 1, 0], 0.3, 0.4, 1.3, true), B([0, 0.5, -1], 0.5, 0.4)]),
  caromel: shape([0.9, 0.9, 0.9], [B([0.7, 0.7, 0], 0.6, 0.45, true), B([0.6, -0.1, -0.8], 0.55, 0.42, true), B([0, 0.2, -1], 0.55, 0.42)]),
  // ── legendary ──
  ambrosel: shape([0.9, 0.9, 0.9], [B([0, 1, 0], 0.85, 0.36), B([0.5, 0.85, 0], 0.7, 0.36, true), B([0.9, 0.35, -0.2], 0.7, 0.4, true), B([0, 0.2, -1], 0.65, 0.4)]),
  tidelume: shape([0.75, 0.85, 1.0], [R([0, 1, -0.2], [0, 0, 1], 0.5, 0.4, 1.4), B([1, 0, 0.2], 0.8, 0.45, true), B([0, 0.2, -1], 0.5, 0.45)]),
  glimglop: shape([1.0, 0.85, 0.9], [B([0.4, 1, 0], 0.9, 0.37, true), R([0, 1, 0], [0, 0, 1], 0.3, 0.45, 1.2), B([0.9, -0.1, -0.3], 0.5, 0.45, true), B([0, -0.2, -1], 0.6, 0.4)]),
  somnuff: shape([0.95, 0.95, 0.95], [B([0.95, 0.2, -0.2], 0.8, 0.4, true), B([0, 1, 0], 0.5, 0.5), B([0, 0.1, -1], 0.6, 0.5), R([0, 1, -0.1], [0, 0, 1], 0.3, 0.4, 1.1)]),
  fossilo: shape([1.1, 0.9, 0.95], [B([0.3, 1, 0], 0.9, 0.36), B([-0.8, 0.5, -0.3], 0.5, 0.5), B([0.5, 0.3, -0.9], 0.5, 0.45), D([0.7, 0.4, 0.7], 0.12, 0.5)], { amp: 0.05, lobes: 2, twist: 4, fadeIn: [0.3, 0.8], fadeOut: [1.9, 2.5] }),
  // ── mythic ──
  skeinara: shape([0.75, 0.8, 0.85], [R([0, 1, 0], [0, 0, 1], 0.4, 0.4, 1.5), R([0, 0.5, -1], [0, 1, 0], 0.7, 0.42, 1.1), B([1, 0, -0.1], 0.5, 0.4, true), B([0.6, 0.9, 0.1], 0.5, 0.38, true), B([0.55, 0.1, -0.8], 0.3, 0.4, true)]),
  constello: shape([0.9, 0.9, 0.85], [B([0, 1, 0], 0.7, 0.38), B([0.6, 0.8, 0], 0.7, 0.38, true), B([0.95, 0.15, 0.1], 0.55, 0.4, true), B([0.55, 0.3, -0.8], 0.55, 0.4, true), B([0, 0.2, -1], 0.6, 0.4)]),
  prismelo: shape([0.85, 0.95, 0.8], [B([0, 1, 0], 0.7, 0.4), B([0.75, 0.55, 0], 0.7, 0.4, true), B([0.95, -0.2, 0], 0.6, 0.42, true), B([0.5, 0.2, -0.85], 0.6, 0.4, true), R([0, 0.4, -1], [0, 1, 0], 0.5, 0.4, 1.0)]),
};

const RAW: readonly DefIn[] = [
  /* ══════════════ COMMON (14): one smooth volume, at most a couple of features, dim inner light, no sparkle ══════════════ */
  {
    id: 'dollop', name: 'Dollop', tier: 'common', family: 'jellygel', lane: 'jelly', signature: 'poke',
    silhouette: 'squat dome with a leaning swirl-peak on top', shape: SHAPES.dollop,
    look: look({ hue: 32, chroma: 0.82, lightness: 0.64, coreHue: 10, coreGlow: 0.8, translucency: 0.78, gloss: 0.88, firmness: 0.38, bounce: 0.74, stretch: 0.62, size: 0.5, glitter: 0.3 }),
    blurb: 'A whipped swirl of apricot jelly with a wobbly peak. Poke the tip and watch it flop.',
    tags: ['starter', 'dome', 'peaked', 'glossy'],
  },
  {
    id: 'plumpet', name: 'Plumpet', tier: 'common', family: 'jellygel', lane: 'jelly', signature: 'squeeze',
    silhouette: 'plump upright egg', shape: SHAPES.plumpet,
    look: look({ hue: 308, chroma: 0.81, lightness: 0.23, coreHue: 43, coreGlow: 0.3, translucency: 0.55, gloss: 0.75, firmness: 0.45, bounce: 0.7, stretch: 0.45, size: 0.55, eyeStyle: 'oval', eyeSpacing: 0.55 }),
    blurb: 'Plump as an egg and bright as an orchid. Squeeze it and it bounces right back.',
    tags: ['round', 'plump', 'bouncy'],
  },
  {
    id: 'twangle', name: 'Twangle', tier: 'common', family: 'stickystretch', lane: 'jelly', signature: 'pull',
    silhouette: 'tall teardrop with a pointed top', shape: SHAPES.twangle,
    look: look({ hue: 78, chroma: 0.57, lightness: 0.32, coreHue: 43, coreGlow: 0.28, translucency: 0.5, gloss: 0.7, firmness: 0.35, bounce: 0.55, stretch: 0.8, size: 0.4, eyeStyle: 'wide', eyeHeight: 0.58 }),
    blurb: 'A mustard-gold drop with a pointy top. Pull the tip and let go: it answers with a twang.',
    tags: ['tall', 'drop', 'stretchy', 'pull'],
  },
  {
    id: 'puddlo', name: 'Puddlo', tier: 'common', family: 'waterfill', lane: 'fill', signature: 'poke',
    silhouette: 'wide flat pancake', shape: SHAPES.puddlo,
    look: look({ hue: 177, chroma: 0.28, lightness: 0.18, coreHue: 82, coreGlow: 0.2, translucency: 0.45, gloss: 0.85, firmness: 0.3, bounce: 0.6, stretch: 0.5, size: 0.7, eyeStyle: 'sleepy', eyeSpacing: 0.62, eyeHeight: 0.45 }),
    blurb: 'A deep teal puddle that never spills. Poke the middle and the whole thing sloshes.',
    tags: ['flat', 'wide', 'liquid'],
  },
  {
    id: 'glubbin', name: 'Glubbin', tier: 'common', family: 'waterfill', lane: 'fill', signature: 'squeeze',
    silhouette: 'bean with a dip along the top', shape: SHAPES.glubbin,
    look: look({ hue: 7, chroma: 0.38, lightness: 0.37, coreHue: 56, coreGlow: 0.3, translucency: 0.55, gloss: 0.8, firmness: 0.35, bounce: 0.65, stretch: 0.55, size: 0.45, eyeStyle: 'oval' }),
    blurb: 'A terracotta bean full of water. It goes glub when you squeeze and wobbles for ages.',
    tags: ['bean', 'liquid', 'long'],
  },
  {
    id: 'crumbit', name: 'Crumbit', tier: 'common', family: 'beadsqueeze', lane: 'fill', signature: 'squeeze',
    silhouette: 'pear, wide at the base', shape: SHAPES.crumbit,
    look: look({ hue: 53, chroma: 0.27, lightness: 0.5, coreHue: 88, coreGlow: 0.25, translucency: 0.5, gloss: 0.4, firmness: 0.5, bounce: 0.4, stretch: 0.4, size: 0.5, eyeStyle: 'wide', eyeSize: 0.55 }),
    blurb: 'A sandy pear stuffed with tiny beads. Squeeze it and it crunches into a new shape.',
    tags: ['pear', 'beads', 'crunchy'],
  },
  {
    id: 'chunkle', name: 'Chunkle', tier: 'common', family: 'gummy', lane: 'chew', signature: 'squeeze',
    silhouette: 'tall rounded rectangle, a standing pillow', shape: SHAPES.chunkle,
    look: look({ hue: 360, chroma: 0.88, lightness: 0.37, coreHue: 56, coreGlow: 0.25, translucency: 0.6, gloss: 0.7, firmness: 0.6, bounce: 0.45, stretch: 0.35, size: 0.5, eyeSpacing: 0.45 }),
    blurb: 'A tomato-red chewy pillow with a very serious face. Soft corners, firm heart.',
    tags: ['block', 'square', 'chewy'],
  },
  {
    id: 'munchip', name: 'Munchip', tier: 'common', family: 'gummy', lane: 'chew', signature: 'poke',
    silhouette: 'soft heart facing you', shape: SHAPES.munchip,
    look: look({ hue: 133, chroma: 0.55, lightness: 0.27, coreHue: 56, coreGlow: 0.3, translucency: 0.65, gloss: 0.65, firmness: 0.65, bounce: 0.55, stretch: 0.3, size: 0.45, eyeStyle: 'oval', eyeSize: 0.45 }),
    blurb: 'A leaf-green gummy heart. It springs right back as if nothing happened.',
    tags: ['heart', 'flat', 'springy'],
  },
  {
    id: 'wisplet', name: 'Wisplet', tier: 'common', family: 'marshmallow', lane: 'foam', signature: 'squeeze',
    silhouette: 'low cloud of three puffs', shape: SHAPES.wisplet,
    look: look({ hue: 342, chroma: 0.13, lightness: 0.51, coreHue: 56, coreGlow: 0.15, translucency: 0.5, gloss: 0.3, firmness: 0.3, bounce: 0.35, stretch: 0.45, size: 0.6, eyeStyle: 'sleepy', eyeHeight: 0.42 }),
    blurb: 'A tiny ash-rose cloud. It squashes flat and puffs back up in a blink.',
    tags: ['cloud', 'puffy', 'soft'],
  },
  {
    id: 'cushlet', name: 'Cushlet', tier: 'common', family: 'marshmallow', lane: 'foam', signature: 'squeeze',
    silhouette: 'chunky cube with rounded corners', shape: SHAPES.cushlet,
    look: look({ hue: 332, chroma: 0.11, lightness: 0.21, coreHue: 56, coreGlow: 0.15, translucency: 0.45, gloss: 0.3, firmness: 0.3, bounce: 0.3, stretch: 0.4, size: 0.7, eyeStyle: 'sleepy', eyeSpacing: 0.6 }),
    blurb: 'A dusty-mauve cube of foam, soft as a cushion. It sighs a little when squeezed.',
    tags: ['block', 'cube', 'soft'],
  },
  {
    id: 'crimpo', name: 'Crimpo', tier: 'common', family: 'mochidough', lane: 'dough', signature: 'pull',
    silhouette: 'half-moon dumpling with a crimped seam', shape: SHAPES.crimpo,
    look: look({ hue: 67, chroma: 0.63, lightness: 0.62, coreHue: 32, coreGlow: 0.3, translucency: 0.4, gloss: 0.3, firmness: 0.4, bounce: 0.3, stretch: 0.6, size: 0.55, eyeStyle: 'dot', eyeSpacing: 0.55 }),
    blurb: 'A toast-gold dumpling with a crimped edge. It stretches, then slowly settles back.',
    tags: ['dumpling', 'halfmoon', 'doughy'],
  },
  {
    id: 'thumbly', name: 'Thumbly', tier: 'common', family: 'mochidough', lane: 'dough', signature: 'poke',
    silhouette: 'wide face with chubby cheeks and a thumb dimple', shape: SHAPES.thumbly,
    look: look({ hue: 351, chroma: 0.48, lightness: 0.64, coreHue: 56, coreGlow: 0.3, translucency: 0.45, gloss: 0.35, firmness: 0.45, bounce: 0.35, stretch: 0.55, size: 0.5, eyeStyle: 'oval', eyeSize: 0.55 }),
    blurb: 'A salmon-pink face with chubby cheeks. Press a thumb in and the dent smooths out slowly.',
    tags: ['cheeks', 'wide', 'doughy'],
  },
  {
    id: 'sproink', name: 'Sproink', tier: 'common', family: 'firmsilicone', lane: 'rubber', signature: 'poke',
    silhouette: 'rounded bullet pointing at you', shape: SHAPES.sproink,
    look: look({ hue: 141, chroma: 0.35, lightness: 0.58, coreHue: 56, coreGlow: 0.3, translucency: 0.35, gloss: 0.55, firmness: 0.75, bounce: 0.85, stretch: 0.3, size: 0.4, eyeStyle: 'wide', eyeSize: 0.5 }),
    blurb: 'A rubbery seafoam bullet that stares straight at you. Poke it and it boings back.',
    tags: ['bullet', 'long', 'rubbery', 'bouncy'],
  },
  {
    id: 'dimpla', name: 'Dimpla', tier: 'common', family: 'popdome', lane: 'rubber', signature: 'poke',
    silhouette: 'wide button dome', shape: SHAPES.dimpla,
    look: look({ hue: 109, chroma: 0.22, lightness: 0.37, coreHue: 56, coreGlow: 0.25, translucency: 0.45, gloss: 0.7, firmness: 0.7, bounce: 0.6, stretch: 0.25, size: 0.35, eyeStyle: 'dot', eyeSpacing: 0.58 }),
    blurb: 'A sage-green button dome. Press the middle and feel it push back.',
    tags: ['button', 'dome', 'wide'],
  },

  /* ══════════════ UNCOMMON (11): two features, warmer inner light, a few glitter flecks, slightly clearer bodies ══════════════ */
  {
    id: 'nuzzo', name: 'Nuzzo', tier: 'uncommon', family: 'jellygel', lane: 'jelly', signature: 'squeeze',
    silhouette: 'round body with two round ears', shape: SHAPES.nuzzo,
    look: look({ hue: 207, chroma: 0.45, lightness: 0.61, coreHue: 172, coreGlow: 0.52, translucency: 0.7, gloss: 0.8, firmness: 0.4, bounce: 0.65, stretch: 0.5, size: 0.35, glitter: 0.2, eyeStyle: 'oval', eyeSpacing: 0.5 }),
    blurb: 'A sky-blue jelly with round ears. It nudges into your palm and stays there.',
    tags: ['eared', 'round', 'glossy'],
  },
  {
    id: 'flickum', name: 'Flickum', tier: 'uncommon', family: 'stickystretch', lane: 'jelly', signature: 'pull',
    silhouette: 'body with a long knobbed tail', shape: SHAPES.flickum,
    look: look({ hue: 123, chroma: 0.78, lightness: 0.41, coreHue: 172, coreGlow: 0.5, translucency: 0.55, gloss: 0.75, firmness: 0.35, bounce: 0.6, stretch: 0.8, size: 0.45, glitter: 0.18, eyeStyle: 'dot', eyeSpacing: 0.45 }),
    blurb: 'An emerald drop with a long knobbed tail. Stretch the tail and it flicks back.',
    tags: ['tailed', 'stretchy', 'pull'],
  },
  {
    id: 'swishel', name: 'Swishel', tier: 'uncommon', family: 'waterfill', lane: 'fill', signature: 'poke',
    silhouette: 'round bowl with a deep dish on top', shape: SHAPES.swishel,
    look: look({ hue: 184, chroma: 0.32, lightness: 0.06, coreHue: 149, coreGlow: 0.58, translucency: 0.7, gloss: 0.9, firmness: 0.3, bounce: 0.6, stretch: 0.55, size: 0.6, glitter: 0.25, eyeStyle: 'sleepy', eyeHeight: 0.52 }),
    blurb: 'An ocean-teal bowl of water with a dish on top. Poke it and the dish ripples.',
    tags: ['bowl', 'dish', 'liquid'],
  },
  {
    id: 'granulo', name: 'Granulo', tier: 'uncommon', family: 'beadsqueeze', lane: 'fill', signature: 'squeeze',
    silhouette: 'chunky five-point star facing you',
    shape: SHAPES.granulo,
    look: look({ hue: 71, chroma: 0.82, lightness: 0.86, coreHue: 166, coreGlow: 0.5, translucency: 0.55, gloss: 0.45, firmness: 0.5, bounce: 0.4, stretch: 0.45, size: 0.4, glitter: 0.3, eyeStyle: 'wide', eyeSpacing: 0.4 }),
    bands: { chroma: 0.02, lightness: 0.015 },
    blurb: 'A sunshine-yellow star stuffed with beads. Every point gives a crunchy crackle.',
    tags: ['star', 'beads', 'lobed'],
  },
  {
    id: 'peakum', name: 'Peakum', tier: 'uncommon', family: 'gummy', lane: 'chew', signature: 'poke',
    silhouette: 'round body with twin peaks swept back like tufts', shape: SHAPES.peakum,
    look: look({ hue: 98, chroma: 0.74, lightness: 0.57, coreHue: 172, coreGlow: 0.55, translucency: 0.75, gloss: 0.75, firmness: 0.55, bounce: 0.6, stretch: 0.4, size: 0.5, glitter: 0.2, eyeStyle: 'oval', eyeSize: 0.5 }),
    blurb: 'A lime gummy with two backswept tufts. Flick one and they wiggle together.',
    tags: ['peaks', 'chewy', 'lime'],
  },
  {
    id: 'wrigglo', name: 'Wrigglo', tier: 'uncommon', family: 'slimegoo', lane: 'chew', signature: 'pull',
    silhouette: 'long worm with a raised head', shape: SHAPES.wrigglo,
    look: look({ hue: 159, chroma: 0.44, lightness: 0.47, coreHue: 194, coreGlow: 0.55, translucency: 0.7, gloss: 0.95, firmness: 0.25, bounce: 0.35, stretch: 0.85, size: 0.6, glitter: 0.25, eyeStyle: 'dot', eyeSpacing: 0.4 }),
    blurb: 'A long aqua wiggler that oozes after each squeeze and slowly gathers itself up.',
    tags: ['worm', 'long', 'oozy', 'pull'],
  },
  {
    id: 'fluffnut', name: 'Fluffnut', tier: 'uncommon', family: 'marshmallow', lane: 'foam', signature: 'squeeze',
    silhouette: 'wide acorn: broad cap and a tall stem', shape: SHAPES.fluffnut,
    look: look({ hue: 256, chroma: 0.49, lightness: 0.36, coreHue: 172, coreGlow: 0.45, translucency: 0.5, gloss: 0.3, firmness: 0.3, bounce: 0.3, stretch: 0.5, size: 0.45, glitter: 0.15, eyeStyle: 'sleepy', eyeHeight: 0.46 }),
    blurb: 'A periwinkle puff with a wide cap and a tall stem. Featherlight and a little shy.',
    tags: ['acorn', 'capped', 'puffy'],
  },
  {
    id: 'capnap', name: 'Capnap', tier: 'uncommon', family: 'slowrise', lane: 'foam', signature: 'squeeze',
    silhouette: 'mushroom: wide cap on a narrow stalk', shape: SHAPES.capnap,
    look: look({ hue: 258, chroma: 0.61, lightness: 0.04, coreHue: 172, coreGlow: 0.5, translucency: 0.45, gloss: 0.35, firmness: 0.35, bounce: 0.2, stretch: 0.4, size: 0.55, glitter: 0.1, eyeStyle: 'sleepy', eyeSize: 0.55, eyeHeight: 0.42 }),
    blurb: 'A sleepy indigo mushroom cap. Press it down and it takes its time to rise.',
    tags: ['mushroom', 'capped', 'slow'],
  },
  {
    id: 'knubby', name: 'Knubby', tier: 'uncommon', family: 'mochidough', lane: 'dough', signature: 'poke',
    silhouette: 'mitten: one big thumb-lump on the side', shape: SHAPES.knubby,
    look: look({ hue: 79, chroma: 0.38, lightness: 0.09, coreHue: 172, coreGlow: 0.45, translucency: 0.5, gloss: 0.35, firmness: 0.45, bounce: 0.35, stretch: 0.55, size: 0.5, glitter: 0.1, eyeStyle: 'dot', eyeHeight: 0.6 }),
    blurb: 'A khaki dough glove with one big thumb. Poke the thumb and the whole glove nods.',
    tags: ['gourd', 'stacked', 'doughy'],
  },
  {
    id: 'kneadle', name: 'Kneadle', tier: 'uncommon', family: 'putty', lane: 'dough', signature: 'squeeze',
    silhouette: 'lumpy loaf with one shoulder up and one dimple', shape: SHAPES.kneadle,
    look: look({ hue: 228, chroma: 0.17, lightness: 0.17, coreHue: 172, coreGlow: 0.5, translucency: 0.55, gloss: 0.6, firmness: 0.5, bounce: 0.25, stretch: 0.5, size: 0.5, glitter: 0.2, eyeStyle: 'oval', eyeSpacing: 0.55 }),
    blurb: 'Slate-blue putty in a lumpy loaf. It keeps every fingerprint and flows like taffy.',
    tags: ['lumpy', 'putty', 'dent'],
  },
  {
    id: 'hooplet', name: 'Hooplet', tier: 'uncommon', family: 'firmsilicone', lane: 'rubber', signature: 'poke',
    silhouette: 'donut pillow with deep dimples top and bottom', shape: SHAPES.hooplet,
    look: look({ hue: 223, chroma: 0.65, lightness: 0.16, coreHue: 172, coreGlow: 0.55, translucency: 0.5, gloss: 0.7, firmness: 0.7, bounce: 0.8, stretch: 0.35, size: 0.45, glitter: 0.25, eyeStyle: 'wide', eyeSpacing: 0.6 }),
    blurb: 'A firm cobalt ring-pillow with a dimple on each side. It springs back faster than a blink.',
    tags: ['donut', 'ring', 'rubbery'],
  },

  /* ══════════════ RARE (10): three features, a visible glowing seed, speckle or swirl layer, deep transmission ══════════════ */
  {
    id: 'spirelo', name: 'Spirelo', tier: 'rare', family: 'jellygel', lane: 'jelly', signature: 'poke',
    silhouette: 'one tall forward horn and chubby cheeks', shape: SHAPES.spirelo,
    look: look({ hue: 283, chroma: 0.89, lightness: 0.19, coreHue: 248, coreGlow: 0.68, translucency: 0.8, gloss: 0.85, firmness: 0.45, bounce: 0.75, stretch: 0.55, size: 0.5, glitter: 0.35, speckle: 0.35, pattern: 'speckle', eyeStyle: 'wide', eyeSize: 0.55 }),
    blurb: 'A violet jelly with one proud horn and chubby cheeks. Poke the horn and the head wobbles.',
    tags: ['horned', 'cheeks', 'glowing'],
  },
  {
    id: 'zingle', name: 'Zingle', tier: 'rare', family: 'stickystretch', lane: 'jelly', signature: 'pull',
    silhouette: 'crested back and a long tail knob', shape: SHAPES.zingle,
    look: look({ hue: 319, chroma: 0.84, lightness: 0.38, coreHue: 272, coreGlow: 0.7, translucency: 0.7, gloss: 0.8, firmness: 0.4, bounce: 0.65, stretch: 0.85, size: 0.45, glitter: 0.4, speckle: 0.5, pattern: 'swirl', eyeStyle: 'oval', eyeSpacing: 0.5 }),
    blurb: 'A magenta-pink stretcher with a crest down its back. Pull the tail and it goes zing.',
    tags: ['crested', 'tailed', 'stretchy', 'pull'],
  },
  {
    id: 'petalop', name: 'Petalop', tier: 'rare', family: 'waterfill', lane: 'fill', signature: 'poke',
    silhouette: 'three-petal flower facing you', shape: SHAPES.petalop,
    look: look({ hue: 222, chroma: 0.87, lightness: 0.04, coreHue: 272, coreGlow: 0.72, translucency: 0.85, gloss: 0.9, firmness: 0.3, bounce: 0.65, stretch: 0.55, size: 0.55, glitter: 0.4, speckle: 0.3, pattern: 'speckle', eyeStyle: 'sleepy', eyeSpacing: 0.45 }),
    blurb: 'A royal-blue flower of water. Poke one petal and the others sway out.',
    tags: ['flower', 'petals', 'liquid'],
  },
  {
    id: 'burrbin', name: 'Burrbin', tier: 'rare', family: 'beadsqueeze', lane: 'fill', signature: 'squeeze',
    silhouette: 'round burr with ten blunt studs',
    shape: SHAPES.burrbin,
    look: look({ hue: 290, chroma: 0.58, lightness: 0.06, coreHue: 255, coreGlow: 0.7, translucency: 0.65, gloss: 0.5, firmness: 0.55, bounce: 0.4, stretch: 0.35, size: 0.5, glitter: 0.45, speckle: 0.6, pattern: 'speckle', eyeStyle: 'wide', eyeSize: 0.6 }),
    blurb: 'A plum burr covered in blunt little studs. It crackles when squeezed.',
    tags: ['spiky', 'studs', 'beads'],
  },
  {
    id: 'marigel', name: 'Marigel', tier: 'rare', family: 'gummy', lane: 'chew', signature: 'poke',
    silhouette: 'round flower, eight petals around the face', shape: SHAPES.marigel,
    look: look({ hue: 9, chroma: 0.78, lightness: 0.47, coreHue: 274, coreGlow: 0.68, translucency: 0.85, gloss: 0.8, firmness: 0.6, bounce: 0.5, stretch: 0.4, size: 0.4, glitter: 0.35, speckle: 0.4, pattern: 'swirl', eyeStyle: 'oval', eyeSize: 0.5 }),
    blurb: 'A marigold gummy flower with chewy petals around a glowing heart.',
    tags: ['flower', 'petals', 'chewy', 'glowing'],
  },
  {
    id: 'gloopsy', name: 'Gloopsy', tier: 'rare', family: 'slimegoo', lane: 'chew', signature: 'pull',
    silhouette: 'three-lobed blob with drips at the back', shape: SHAPES.gloopsy,
    look: look({ hue: 174, chroma: 0.48, lightness: 0.35, coreHue: 269, coreGlow: 0.72, translucency: 0.8, gloss: 0.96, firmness: 0.25, bounce: 0.4, stretch: 0.8, size: 0.55, glitter: 0.45, speckle: 0.5, pattern: 'swirl', eyeStyle: 'dot', eyeSpacing: 0.55 }),
    blurb: 'A bright teal goo with three lobes and drippy feet. It stretches into silky strings.',
    tags: ['lobed', 'drippy', 'gooey', 'pull'],
  },
  {
    id: 'hushpuff', name: 'Hushpuff', tier: 'rare', family: 'marshmallow', lane: 'foam', signature: 'squeeze',
    silhouette: 'fluffy body with ears, cheeks and a tuft', shape: SHAPES.hushpuff,
    look: look({ hue: 257, chroma: 0.22, lightness: 0.06, coreHue: 292, coreGlow: 0.66, translucency: 0.6, gloss: 0.35, firmness: 0.25, bounce: 0.3, stretch: 0.5, size: 0.65, glitter: 0.3, speckle: 0.4, pattern: 'speckle', eyeStyle: 'sleepy', eyeSize: 0.55, eyeHeight: 0.44 }),
    blurb: 'A dusky grey-violet puff with tufted ears. Squeeze it gently: it hushes the room.',
    tags: ['eared', 'cheeks', 'fluffy', 'tufted'],
  },
  {
    id: 'drowsel', name: 'Drowsel', tier: 'rare', family: 'slowrise', lane: 'foam', signature: 'squeeze',
    silhouette: 'snail: shell on the back, head up front', shape: SHAPES.drowsel,
    look: look({ hue: 279, chroma: 0.41, lightness: 0.54, coreHue: 244, coreGlow: 0.65, translucency: 0.6, gloss: 0.4, firmness: 0.3, bounce: 0.2, stretch: 0.4, size: 0.6, glitter: 0.2, speckle: 0.55, pattern: 'swirl', eyeStyle: 'sleepy', eyeSpacing: 0.4, eyeHeight: 0.5 }),
    blurb: 'A lilac snail with a swirl for a shell. It sinks under your hand and rises slowly.',
    tags: ['snail', 'shell', 'slow'],
  },
  {
    id: 'thudge', name: 'Thudge', tier: 'rare', family: 'putty', lane: 'dough', signature: 'squeeze',
    silhouette: 'boulder with four uneven lumps', shape: SHAPES.thudge,
    look: look({ hue: 348, chroma: 0.41, lightness: 0.11, coreHue: 272, coreGlow: 0.68, translucency: 0.6, gloss: 0.7, firmness: 0.55, bounce: 0.2, stretch: 0.35, size: 0.6, glitter: 0.3, speckle: 0.6, pattern: 'speckle', eyeStyle: 'oval', eyeSize: 0.6 }),
    blurb: 'A brick-rose boulder of putty. It lands with a thud and keeps the dent you leave.',
    tags: ['lumpy', 'boulder', 'putty'],
  },
  {
    id: 'diademo', name: 'Diademo', tier: 'rare', family: 'popdome', lane: 'rubber', signature: 'poke',
    silhouette: 'low dome wearing a five-point crown', shape: SHAPES.diademo,
    look: look({ hue: 196, chroma: 0.55, lightness: 0.5, coreHue: 272, coreGlow: 0.72, translucency: 0.7, gloss: 0.85, firmness: 0.75, bounce: 0.55, stretch: 0.3, size: 0.4, glitter: 0.4, speckle: 0.5, pattern: 'bands', eyeStyle: 'wide', eyeSpacing: 0.6 }),
    blurb: 'An azure dome wearing a tiny crown. It resists, resists, then gives with a pop.',
    tags: ['crowned', 'dome', 'popping'],
  },

  /* ══════════════ EPIC (7): four features, two-tone swirl or bands, a blooming core, glitter that drifts ══════════════ */
  {
    id: 'taffelin', name: 'Taffelin', tier: 'epic', family: 'stickystretch', lane: 'jelly', signature: 'pull',
    silhouette: 'long comet: a tail sweeping up the back, side fins and cheeks', shape: SHAPES.taffelin,
    look: look({ hue: 336, chroma: 0.96, lightness: 0.11, coreHue: 11, coreGlow: 0.84, translucency: 0.85, gloss: 0.85, firmness: 0.4, bounce: 0.7, stretch: 0.9, size: 0.5, glitter: 0.55, speckle: 0.6, pattern: 'swirl', eyeStyle: 'oval', eyeSpacing: 0.5 }),
    blurb: 'A crimson comet with a tail that sweeps up its back. Stretch it long and it hums.',
    tags: ['comet', 'tailed', 'finned', 'stretchy'],
  },
  {
    id: 'maracon', name: 'Maracon', tier: 'epic', family: 'beadsqueeze', lane: 'fill', signature: 'squeeze',
    silhouette: 'round rattle with a top knob, side nubs and a back tail', shape: SHAPES.maracon,
    look: look({ hue: 28, chroma: 0.82, lightness: 0.49, coreHue: 353, coreGlow: 0.8, translucency: 0.8, gloss: 0.6, firmness: 0.5, bounce: 0.5, stretch: 0.4, size: 0.5, glitter: 0.6, speckle: 0.7, pattern: 'bands', eyeStyle: 'wide', eyeSize: 0.6 }),
    blurb: 'An amber rattle ball with stripes. Each squeeze shakes out a hundred tiny beads of sound.',
    tags: ['rattle', 'knobbed', 'beads', 'striped'],
  },
  {
    id: 'cindergoo', name: 'Cindergoo', tier: 'epic', family: 'slimegoo', lane: 'chew', signature: 'pull',
    silhouette: 'flame: one tall tapered tip, two flicker tips, side drips', shape: SHAPES.cindergoo,
    look: look({ hue: 13, chroma: 0.95, lightness: 0.29, coreHue: 338, coreGlow: 0.88, translucency: 0.85, gloss: 0.97, firmness: 0.3, bounce: 0.5, stretch: 0.85, size: 0.55, glitter: 0.6, speckle: 0.5, pattern: 'swirl', eyeStyle: 'dot', eyeSpacing: 0.5 }),
    blurb: 'An ember-orange goo shaped like a flame. It glows brighter the harder you pull.',
    tags: ['flame', 'crested', 'gooey', 'pull'],
  },
  {
    id: 'selenuff', name: 'Selenuff', tier: 'epic', family: 'marshmallow', lane: 'foam', signature: 'squeeze',
    silhouette: 'crescent moon: two big curled horns around a dip', shape: SHAPES.selenuff,
    look: look({ hue: 254, chroma: 0.64, lightness: 0.21, coreHue: 349, coreGlow: 0.82, translucency: 0.75, gloss: 0.4, firmness: 0.3, bounce: 0.4, stretch: 0.55, size: 0.6, glitter: 0.65, speckle: 0.6, pattern: 'swirl', eyeStyle: 'sleepy', eyeHeight: 0.46 }),
    blurb: 'A moon-violet puff with two curled horns. It hums a lullaby when you squeeze it.',
    tags: ['crescent', 'horned', 'fluffy', 'glowing'],
  },
  {
    id: 'pastrel', name: 'Pastrel', tier: 'epic', family: 'mochidough', lane: 'dough', signature: 'pull',
    silhouette: 'croissant arch with curled ends and a seam', shape: SHAPES.pastrel,
    look: look({ hue: 34, chroma: 0.67, lightness: 0.11, coreHue: 359, coreGlow: 0.8, translucency: 0.7, gloss: 0.4, firmness: 0.4, bounce: 0.4, stretch: 0.6, size: 0.55, glitter: 0.5, speckle: 0.65, pattern: 'bands', eyeStyle: 'oval', eyeSpacing: 0.55 }),
    blurb: 'A toasted-bronze pastry arch, warm to hold. Pull an end and flaky bands ripple past.',
    tags: ['arch', 'curled', 'doughy', 'striped'],
  },
  {
    id: 'flipdome', name: 'Flipdome', tier: 'epic', family: 'popdome', lane: 'rubber', signature: 'poke',
    silhouette: 'high dome with side seams and a back knob', shape: SHAPES.flipdome,
    look: look({ hue: 117, chroma: 0.76, lightness: 0.02, coreHue: 22, coreGlow: 0.85, translucency: 0.8, gloss: 0.85, firmness: 0.8, bounce: 0.65, stretch: 0.25, size: 0.45, glitter: 0.55, speckle: 0.7, pattern: 'bands', eyeStyle: 'wide', eyeSpacing: 0.55 }),
    blurb: 'An emerald dome that flips inside out with a satisfying pop, then flips back.',
    tags: ['dome', 'popping', 'seamed'],
  },
  {
    id: 'caromel', name: 'Caromel', tier: 'epic', family: 'firmsilicone', lane: 'rubber', signature: 'poke',
    silhouette: 'round body with studded shoulders and a back stud', shape: SHAPES.caromel,
    look: look({ hue: 90, chroma: 0.91, lightness: 0.71, coreHue: 2, coreGlow: 0.82, translucency: 0.75, gloss: 0.7, firmness: 0.8, bounce: 0.9, stretch: 0.35, size: 0.45, glitter: 0.5, speckle: 0.6, pattern: 'swirl', eyeStyle: 'wide', eyeSize: 0.55 }),
    blurb: 'A citrus-bright studded ball that ricochets off everything and loves it.',
    tags: ['ball', 'studded', 'bouncy'],
  },

  /* ══════════════ LEGENDARY (5): five features in matched pairs, an aurora swirl inside, dense glitter, a bright core ══════════════ */
  {
    id: 'ambrosel', name: 'Ambrosel', tier: 'legendary', family: 'jellygel', lane: 'jelly', signature: 'poke',
    silhouette: 'tall crown of three points, little wings and a tail', shape: SHAPES.ambrosel,
    look: look({ hue: 47, chroma: 0.94, lightness: 0.68, coreHue: 12, coreGlow: 0.94, translucency: 0.9, gloss: 0.95, firmness: 0.45, bounce: 0.8, stretch: 0.6, size: 0.6, glitter: 0.8, speckle: 0.7, pattern: 'swirl', eyeStyle: 'oval', eyeSize: 0.6 }),
    blurb: 'A sunflower-gold jelly with a crown, wings and a bright heart. It glows for you alone.',
    tags: ['crowned', 'winged', 'tailed', 'aurora'],
  },
  {
    id: 'tidelume', name: 'Tidelume', tier: 'legendary', family: 'waterfill', lane: 'fill', signature: 'poke',
    silhouette: 'long finned body: dorsal crest, side fins, fan tail', shape: SHAPES.tidelume,
    look: look({ hue: 147, chroma: 0.74, lightness: 0.79, coreHue: 52, coreGlow: 0.95, translucency: 0.95, gloss: 0.97, firmness: 0.3, bounce: 0.7, stretch: 0.55, size: 0.65, glitter: 0.85, speckle: 0.6, pattern: 'bands', eyeStyle: 'sleepy', eyeHeight: 0.55 }),
    blurb: 'A sea-glass swimmer with a tide of light inside. Squeeze it and the glow races tailward.',
    tags: ['finned', 'crested', 'tailed', 'aurora', 'liquid'],
  },
  {
    id: 'glimglop', name: 'Glimglop', tier: 'legendary', family: 'slimegoo', lane: 'chew', signature: 'pull',
    silhouette: 'tall goo with twin drips, a crest, side blobs and a trailing glob', shape: SHAPES.glimglop,
    look: look({ hue: 348, chroma: 0.91, lightness: 0.03, coreHue: 42, coreGlow: 0.96, translucency: 0.9, gloss: 0.98, firmness: 0.3, bounce: 0.5, stretch: 0.85, size: 0.6, glitter: 0.85, speckle: 0.8, pattern: 'swirl', eyeStyle: 'dot', eyeSpacing: 0.52 }),
    blurb: 'A ruby goo with a galaxy swirling inside. It glimmers every time it glops.',
    tags: ['drippy', 'crested', 'gooey', 'aurora'],
  },
  {
    id: 'somnuff', name: 'Somnuff', tier: 'legendary', family: 'slowrise', lane: 'foam', signature: 'squeeze',
    silhouette: 'drooping side-ears, top tuft, back tail and a crest', shape: SHAPES.somnuff,
    look: look({ hue: 298, chroma: 0.92, lightness: 0.41, coreHue: 33, coreGlow: 0.92, translucency: 0.8, gloss: 0.5, firmness: 0.3, bounce: 0.25, stretch: 0.45, size: 0.7, glitter: 0.7, speckle: 0.6, pattern: 'swirl', eyeStyle: 'sleepy', eyeSize: 0.6, eyeHeight: 0.48 }),
    blurb: 'An orchid dream-cloud, always half asleep. It sinks into your hands and rises slowly.',
    tags: ['eared', 'tailed', 'crested', 'dreamy'],
  },
  {
    id: 'fossilo', name: 'Fossilo', tier: 'legendary', family: 'putty', lane: 'dough', signature: 'squeeze',
    silhouette: 'ridged boulder with one tall horn and two shoulder lumps', shape: SHAPES.fossilo,
    look: look({ hue: 11, chroma: 0.62, lightness: 0.12, coreHue: 46, coreGlow: 0.9, translucency: 0.7, gloss: 0.85, firmness: 0.55, bounce: 0.2, stretch: 0.4, size: 0.65, glitter: 0.7, speckle: 0.8, pattern: 'swirl', eyeStyle: 'oval', eyeSpacing: 0.5 }),
    blurb: 'A copper oil-slick putty that keeps every dent you give it. Each thumbprint stays.',
    tags: ['horned', 'lumpy', 'ridged', 'putty'],
  },

  /* ══════════════ MYTHIC (3): the most intricate silhouettes, thin-film light, a constellation inside, prism core ══════════════ */
  {
    id: 'skeinara', name: 'Skeinara', tier: 'mythic', family: 'stickystretch', lane: 'jelly', signature: 'pull',
    silhouette: 'comet with a long crest, ribbon tail, two fins and ear tufts', shape: SHAPES.skeinara,
    look: look({ hue: 236, chroma: 0.93, lightness: 0.29, coreHue: 316, coreGlow: 1.0, translucency: 0.95, gloss: 0.98, firmness: 0.4, bounce: 0.7, stretch: 0.95, size: 0.65, glitter: 1.0, speckle: 0.8, pattern: 'swirl', eyeStyle: 'oval', eyeSize: 0.62, eyeSpacing: 0.5 }),
    bands: { chroma: 0.02, lightness: 0.02 },
    blurb: 'A thread-weaver of pure light. Stretch it and the threads shimmer every colour at once.',
    tags: ['crested', 'tailed', 'finned', 'iridescent', 'pull'],
  },
  {
    id: 'constello', name: 'Constello', tier: 'mythic', family: 'beadsqueeze', lane: 'fill', signature: 'squeeze',
    silhouette: 'crowned orb ringed with seven star points', shape: SHAPES.constello,
    look: look({ hue: 239, chroma: 0.99, lightness: 0.09, coreHue: 159, coreGlow: 1.0, translucency: 0.95, gloss: 0.9, firmness: 0.5, bounce: 0.55, stretch: 0.45, size: 0.7, glitter: 1.0, speckle: 0.95, pattern: 'speckle', eyeStyle: 'wide', eyeSize: 0.6, eyeSpacing: 0.5 }),
    bands: { chroma: 0.02, lightness: 0.02 },
    blurb: 'A midnight sack of beads where every grain is a star. It rustles like night waves.',
    tags: ['crowned', 'starry', 'iridescent', 'beads'],
  },
  {
    id: 'prismelo', name: 'Prismelo', tier: 'mythic', family: 'gummy', lane: 'chew', signature: 'poke',
    silhouette: 'cut gem: crown, four facet points and a back fin', shape: SHAPES.prismelo,
    look: look({ hue: 180, chroma: 0.89, lightness: 0.61, coreHue: 260, coreGlow: 1.0, translucency: 0.95, gloss: 0.98, firmness: 0.55, bounce: 0.65, stretch: 0.5, size: 0.6, glitter: 1.0, speckle: 0.9, pattern: 'bands', eyeStyle: 'oval', eyeSize: 0.6, eyeSpacing: 0.5 }),
    bands: { chroma: 0.02, lightness: 0.02 },
    blurb: 'A cut-glass gummy that splits the light into rainbows. Poke a facet and it chimes.',
    tags: ['gem', 'faceted', 'iridescent', 'chewy'],
  },
];

/* ───────────────────────────────────────────────── build and verify ───────────────────────────────────────────────── */

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** Per-species salt for the genome roll (a hash of the id, so reordering never changes a species' rolls). */
const SALT: Record<string, number> = Object.create(null);

/** The roster in idx order. Frozen. CATALOG[i].idx === i === SPECIES.indexOf(CATALOG[i].id). */
export const CATALOG: readonly SpeciesDef[] = deepFreeze(RAW.map((d, i): SpeciesDef => ({ ...d, idx: i, bands: { ...BANDS, ...(d.bands ?? {}) } })));

// Load-time integrity check of the append-only rules (a bad edit fails on import, in the browser and on the server alike).
if (CATALOG.length !== SPECIES.length || CATALOG.length > MAX_SPECIES_IDX + 1) throw new Error(`catalog: ${CATALOG.length} entries but ${SPECIES.length} registered ids`);
for (let i = 0; i < CATALOG.length; i++) {
  if (CATALOG[i].id !== SPECIES[i]) throw new Error(`catalog: position ${i} is "${CATALOG[i].id}" but SPECIES[${i}] is "${SPECIES[i]}" (append-only: never reorder)`);
  SALT[CATALOG[i].id] = hashString(CATALOG[i].id);
}

const BY_ID: Record<string, SpeciesDef> = Object.create(null);
for (const d of CATALOG) BY_ID[d.id] = d;

/** Lookup by id. The object has no prototype, so hostile ids ('__proto__', 'constructor') find nothing. */
export const SPECIES_BY_ID: Readonly<Record<SpeciesId, SpeciesDef>> = Object.freeze(BY_ID) as Readonly<Record<SpeciesId, SpeciesDef>>;

export const isSpeciesId = (x: unknown): x is SpeciesId => typeof x === 'string' && x in BY_ID;
/** Safe lookup for ids that came from outside (a save, a share string, a server row). */
export const getSpecies = (id: unknown): SpeciesDef | undefined => (typeof id === 'string' ? BY_ID[id] : undefined);
export function speciesDef(id: SpeciesId): SpeciesDef {
  const d = BY_ID[id];
  if (!d) throw new RangeError(`unknown species "${String(id)}"`);
  return d;
}
/** idx of a species (its position in SPECIES; what a share string stores). */
export const speciesIdx = (id: SpeciesId): number => speciesDef(id).idx;

export const tierOf = (id: SpeciesId): TierId => speciesDef(id).tier;
export const tierIndexOf = (id: SpeciesId): number => tierIndex(speciesDef(id).tier);
export const familyOf = (id: SpeciesId): MaterialFamilyId => speciesDef(id).family;

/** Species of each tier, indexed by tier index (Common = 0), in idx order. */
export const SPECIES_BY_TIER: readonly (readonly SpeciesDef[])[] = deepFreeze(TIERS.map((t) => CATALOG.filter((d) => d.tier === t)));
export const speciesInTier = (t: TierId): readonly SpeciesDef[] => SPECIES_BY_TIER[tierIndex(t)];
/** Number of species per tier, indexed by tier index. */
export const TIER_SIZES: readonly number[] = SPECIES_BY_TIER.map((a) => a.length);

/* ───────────────────────────────────────────────── instance genomes ───────────────────────────────────────────────── */

/** Tiny centre shifts by signature touch (DESIGN 5.2: "a small look bias in its genome roll"). Cosmetic: no effect on drop odds. */
export const SIGNATURE_BIAS: Readonly<Record<Signature, Partial<Pick<LookBase, 'bounce' | 'firmness' | 'stretch'>>>> = {
  poke: { bounce: 0.04 }, squeeze: { firmness: 0.04 }, pull: { stretch: 0.04 },
};

/**
 * The species' own look with no cosmetic roll: the centre of its bands, genome.seed 0. Stable, so the Hoard can draw one canonical
 * icon per species (and the palette probe measures this colour). Quantised; round-trips through encodeGenome.
 */
export function speciesTemplateGenome(speciesId: SpeciesId): Genome {
  const d = speciesDef(speciesId);
  return quantizeGenome({ v: GENOME_VERSION, species: d.id, seed: 0, ...d.look });
}

/**
 * The genome of one INSTANCE of a species, from a seed. Deterministic: same (species, seed) gives the same genome on every machine, so
 * the capsule roll only has to carry a species id and a uint32 and the server can recompute and compare. The result is quantised
 * with quantizeGenome (it round-trips through encodeGenome / decodeGenome). Two instances of one species differ only inside the
 * species' cosmetic bands (a few degrees of hue, a few percent of the other numbers); pattern and eye style never vary. A field whose
 * base value is 0 (no glitter, no speckle) stays 0 so Common squishies never grow sparkle by chance.
 * Draw order is FIXED (16 triangular draws, one per band, in the order below); do not reorder.
 * `seed` becomes genome.seed (speckle layout, glitter layout, eye timing).
 */
export function speciesBaseGenome(speciesId: SpeciesId, seed: number): Genome {
  const d = speciesDef(speciesId);
  const s = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  const r = mulberry32((s ^ SALT[d.id] ^ 0x5bd1e995) >>> 0);
  const j = (): number => r() + r() - 1; // triangular in (-1, 1)
  const L = d.look, B2 = d.bands, bias = SIGNATURE_BIAS[d.signature];
  const around = (base: number, band: number, shift = 0): number => base + shift + j() * band;
  const hue = around(L.hue, B2.hue);
  const chroma = around(L.chroma, B2.chroma);
  const lightness = around(L.lightness, B2.lightness);
  const coreHue = around(L.coreHue, B2.coreHue);
  const coreGlow = around(L.coreGlow, B2.coreGlow);
  const translucency = around(L.translucency, B2.translucency);
  const gloss = around(L.gloss, B2.gloss);
  const firmness = around(L.firmness, B2.firmness, bias.firmness ?? 0);
  const bounce = around(L.bounce, B2.bounce, bias.bounce ?? 0);
  const stretch = around(L.stretch, B2.stretch, bias.stretch ?? 0);
  const size = around(L.size, B2.size);
  const glitter = around(L.glitter, B2.glitter);
  const speckle = around(L.speckle, B2.speckle);
  const eyeSpacing = around(L.eyeSpacing, B2.eyeSpacing);
  const eyeSize = around(L.eyeSize, B2.eyeSize);
  const eyeHeight = around(L.eyeHeight, B2.eyeHeight);
  return quantizeGenome({
    v: GENOME_VERSION, species: d.id, seed: s,
    hue, chroma, lightness, coreHue, coreGlow, translucency, gloss, firmness, bounce, stretch, size,
    glitter: L.glitter === 0 ? 0 : glitter, speckle: L.speckle === 0 ? 0 : speckle,
    pattern: L.pattern, eyeStyle: L.eyeStyle, eyeSpacing, eyeSize, eyeHeight,
  });
}
