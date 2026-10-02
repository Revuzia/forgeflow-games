// WOBBLEHOARD material families: the "what does it feel / look / sound like in the hand" table.
//
// A FAMILY is a material (slow-rise foam, jelly gel, putty ...). A GENOME instance picks a position inside a bounded band
// around its family (firmer / bouncier / stretchier / bigger / glossier), never a different character.
// Research, the maths of every axis and the solver mapping are in _spec/SQUISHY_SCIENCE.md. Units match src/physics/params.ts
// (smOmega rad/s, edgeAlphaT in XPBD alpha-tilde units, intDamp 1/s, maxPull in rest radii) so PHYS can adopt `solver` as is.
//
// Pure TypeScript: no three, no DOM, no Math.random, no Date. Runs under plain node type-stripping.
import type { Genome } from '../core/genome.ts';
import { clamp } from '../core/rng.ts';

/* ───────────────────────────────────────────── ids ───────────────────────────────────────────── */

/** Every family id, in roster order. `MATERIAL_FAMILIES` (below) is the table keyed by these. */
export const MATERIAL_FAMILY_IDS = [
  'slowrise', 'marshmallow', 'mochidough', 'jellygel', 'waterfill', 'putty',
  'stickystretch', 'slimegoo', 'firmsilicone', 'popdome', 'gummy', 'beadsqueeze',
] as const;
export type MaterialFamilyId = (typeof MATERIAL_FAMILY_IDS)[number];
/** The family used when an id is unknown. At a neutral genome it reproduces the slice's DOLLOP tuning (see probe_materials). */
export const DEFAULT_FAMILY_ID: MaterialFamilyId = 'jellygel';

export function isMaterialFamilyId(id: unknown): id is MaterialFamilyId {
  return typeof id === 'string' && (MATERIAL_FAMILY_IDS as readonly string[]).includes(id);
}

/* ───────────────────────────────────────── physics axes ───────────────────────────────────────── */

/**
 * The physics axes of a material. Every field has a unit and a documented range (PHYSICS_AXES holds the same ranges as data).
 * "Dormant" fields (e.g. airReturnTau when volBleedMax is 0) still carry a neutral in-range value; the distance metric ignores them.
 */
export interface MaterialParams {
  /** rad/s, 8..48. Relaxed shape-matching stiffness (the permanent, elastic arm). Same meaning as SoftParams.smOmega. */
  smOmega: number;
  /** rad/s, 10..700 (log). Natural frequency of the volume-constraint spring. Compressibility: SoftParams.volKappa = 1/(volOmega*H)^2. ~500 = the current DOLLOP (nearly incompressible). */
  volOmega: number;
  /** fraction, 0..0.7. How much of its rest volume it can lose under a sustained squeeze (air leaves). 0 = conserves volume (gel). */
  volBleedMax: number;
  /** s, 0.05..3. Time constant of the volume target coming back after release (air returning through the skin). Slow-rise foam ~1.5. */
  airReturnTau: number;
  /** damping ratio of the volume spring, 0..1.5. Air-flow resistance: a fast squeeze meets a firmer cushion than a slow one. */
  airDamp: number;
  /** ratio k2/k1, 0..8. Stiffness of the viscoelastic memory arm relative to smOmega^2. Instantaneous stiffness = (1+memStiff) x relaxed: rate stiffening. */
  memStiff: number;
  /** s, 0.05..4. Relaxation time of the memory arm (Zener/standard-linear-solid tau). Retardation (recovery) time = memTau x (1+memStiff). */
  memTau: number;
  /** fraction of rest radius, 0..0.3. Slider strength of the memory arm: below this misfit the memory does not flow (plastic hold). 0 = purely viscoelastic. */
  yieldStrain: number;
  /** s, 0.3..60. Time constant with which a held (plastic) dent heals back to the true rest shape. 60 = effectively never. */
  healTau: number;
  /** 1/s, 1..32 (log). LOCAL (non-affine) internal damping: the peak flop and surface ripples. Low = jiggles, high = dead. Same meaning as SoftParams.intDamp. */
  intDamp: number;
  /** 1/s, 4..60 (log). GLOBAL (affine squash/stretch/shear) damping: whether the whole body rebounds like a ball. Same meaning as SoftParams.affDamp. */
  affDamp: number;
  /** XPBD alpha-tilde at the nominal step, 0.03..0.9. Skin compliance (higher = stretchier, softer skin). Same as SoftParams.edgeAlphaT. */
  edgeAlphaT: number;
  /** strain, 0.05..0.7. Edge strain beyond which the skin hardens. Same as SoftParams.edgeSoftStrain. */
  edgeSoftStrain: number;
  /** rest radii, 0.6..3.2. Maximum pull distance of a grab. Same as SoftParams.maxPull. */
  maxPull: number;
  /** Coulomb coefficient, 0.3..1.5. Table friction (the current solver default is 0.6). */
  tableMu: number;
  /** 0..1. Surface tack: strength of finger/table adhesion (soft materials with low storage modulus are tacky). */
  tack: number;
  /** 0..1. How staggered the adhesive bonds break (1 = many thin strings). Only meaningful with tack. */
  stringiness: number;
  /** fraction of body mass, 0..0.6. Mass of the sloshing liquid/beads. 0 = none. */
  sloshMass: number;
  /** Hz, 1..8 (log). Slosh natural frequency at size 0.5. */
  sloshHz: number;
  /** damping ratio, 0.03..0.8. Slosh damping (liquid 0.1, beads 0.35). */
  sloshZeta: number;
  /** 0..1. Progressive hardening with compression (foam densification, bead jamming): stiffness x (1 + 6 jam c^2). */
  jam: number;
  /** 0..1. Bistable dome: 0 = none, 1 = pops between two shapes. */
  snap: number;
}

export type PhysicsKey = keyof MaterialParams;

export interface AxisSpec { key: PhysicsKey; unit: string; min: number; max: number; log: boolean }

/** Ranges, units and scale of every physics axis. The probe uses these as the single source of truth. */
export const PHYSICS_AXES: readonly AxisSpec[] = [
  { key: 'smOmega', unit: 'rad/s', min: 8, max: 48, log: false },
  { key: 'volOmega', unit: 'rad/s', min: 10, max: 700, log: true },
  { key: 'volBleedMax', unit: 'fraction', min: 0, max: 0.7, log: false },
  { key: 'airReturnTau', unit: 's', min: 0.05, max: 3, log: true },
  { key: 'airDamp', unit: 'zeta', min: 0, max: 1.5, log: false },
  { key: 'memStiff', unit: 'ratio', min: 0, max: 8, log: false },
  { key: 'memTau', unit: 's', min: 0.05, max: 4, log: true },
  { key: 'yieldStrain', unit: 'R0', min: 0, max: 0.3, log: false },
  { key: 'healTau', unit: 's', min: 0.3, max: 60, log: true },
  { key: 'intDamp', unit: '1/s', min: 1, max: 32, log: true },
  { key: 'affDamp', unit: '1/s', min: 4, max: 60, log: true },
  { key: 'edgeAlphaT', unit: 'alpha~', min: 0.03, max: 0.9, log: false },
  { key: 'edgeSoftStrain', unit: 'strain', min: 0.05, max: 0.7, log: false },
  { key: 'maxPull', unit: 'R0', min: 0.6, max: 3.2, log: false },
  { key: 'tableMu', unit: 'mu', min: 0.3, max: 1.5, log: false },
  { key: 'tack', unit: '0..1', min: 0, max: 1, log: false },
  { key: 'stringiness', unit: '0..1', min: 0, max: 1, log: false },
  { key: 'sloshMass', unit: 'mass fraction', min: 0, max: 0.6, log: false },
  { key: 'sloshHz', unit: 'Hz', min: 1, max: 8, log: true },
  { key: 'sloshZeta', unit: 'zeta', min: 0.03, max: 0.8, log: false },
  { key: 'jam', unit: '0..1', min: 0, max: 1, log: false },
  { key: 'snap', unit: '0..1', min: 0, max: 1, log: false },
];

/* ───────────────────────────────────────────── look ───────────────────────────────────────────── */

/** Visual numbers (RENDER lane). Centres + spans: the genome picks a position inside the span, so a foam can never turn glassy. */
export interface MaterialLook {
  /** 0..1 centre of the translucency band (1 = glassy). genome.translucency moves it within +/- translucencySpan. */
  translucency: number;
  /** 0..0.4 half-width of the translucency band. */
  translucencySpan: number;
  /** 0..1 centre of the clearcoat/gloss band. genome.gloss moves it within +/- glossSpan. */
  gloss: number;
  /** 0..0.4 half-width of the gloss band. */
  glossSpan: number;
  /** 0.02..1 base-layer micro roughness (1 = chalky, 0.03 = wet). */
  roughness: number;
  /** 0..1 subsurface tint / thickness-absorption strength (colour deepens with thickness). */
  subsurface: number;
  /** 0..1 velvet/sheen at grazing angles (foam skin, marshmallow dust). 0 = none. */
  fuzz: number;
  /** 0..1 surface micro-texture strength (foam pores, bead lumps, dusted mochi). Drives a procedural normal/bump. */
  grain: number;
  /** 0.2..1.6 scale of the transmission thickness (how deep the colour goes when looking through it). */
  thickness: number;
  /** 0..1 pressure blush: compressed regions (strain < 1) saturate and warm. */
  blush: number;
  /** 0..1 stretched regions (strain > 1) go paler and clearer. */
  stretchPale: number;
  /** 0..1.5 multiplier on genome.coreGlow (an opaque foam hides its core). */
  coreGlow: number;
  /** 0..1.5 multiplier on genome.glitter (suspended sparkle needs a clear medium). */
  glitter: number;
}

export interface FieldSpec { key: string; min: number; max: number }
export const LOOK_FIELDS: readonly FieldSpec[] = [
  { key: 'translucency', min: 0, max: 1 }, { key: 'translucencySpan', min: 0, max: 0.4 },
  { key: 'gloss', min: 0, max: 1 }, { key: 'glossSpan', min: 0, max: 0.4 },
  { key: 'roughness', min: 0.02, max: 1 }, { key: 'subsurface', min: 0, max: 1 },
  { key: 'fuzz', min: 0, max: 1 }, { key: 'grain', min: 0, max: 1 },
  { key: 'thickness', min: 0.2, max: 1.6 }, { key: 'blush', min: 0, max: 1 },
  { key: 'stretchPale', min: 0, max: 1 }, { key: 'coreGlow', min: 0, max: 1.5 }, { key: 'glitter', min: 0, max: 1.5 },
];

/* ───────────────────────────────────────────── sound ───────────────────────────────────────────── */

/**
 * Numbers for the squelch voice (AUDIO lane). They are BEFORE the genome's pitchRatio: the audio lane still divides bubble radii and
 * multiplies frequencies by pitchRatio(genome), so size/firmness pitch is not applied twice here.
 */
export interface MaterialSound {
  /** x, 0.05..3. Multiplier on the squish voice's bubble rate (the voice's base Poisson rate is ~70/s at full speed). */
  bubbleRate: number;
  /** mm, 0.2..8. Smallest Minnaert bubble radius (f0 ~ 3.26 / r Hz, r in metres: 1 mm ~ 3.3 kHz). */
  bubbleRadiusMinMm: number;
  /** mm, 0.2..8. Largest bubble radius (big = low gloopy). Must be >= bubbleRadiusMinMm. */
  bubbleRadiusMaxMm: number;
  /** Hz, 300..7000. Centre of the band-passed noise skin/rustle. */
  noiseHz: number;
  /** 0..1. Noise colour: 0 = dark brown rumble, 1 = bright white hiss. */
  noiseColor: number;
  /** 0..1. Mix of wet bubble stream (1) versus dry rustle (0). */
  wet: number;
  /** 0..1. Breathy "fff" of air leaving/entering (foam, marshmallow). */
  airPuff: number;
  /** 0..1. Rate of tiny "tck" adhesive releases during a peel (tack and stringing). */
  stickyStrings: number;
  /** x, 0.5..1.8. Pitch multiplier of the poke/land body thump. */
  bodyPitch: number;
  /** 0..1. Resonant "boing" ring after a poke/release (bouncy materials high, dead ones 0). */
  ring: number;
  /** dB, -8..4. Level trim relative to the wet-gel baseline (dry materials are quieter). */
  levelDb: number;
}
export const SOUND_FIELDS: readonly FieldSpec[] = [
  { key: 'bubbleRate', min: 0.05, max: 3 }, { key: 'bubbleRadiusMinMm', min: 0.2, max: 8 }, { key: 'bubbleRadiusMaxMm', min: 0.2, max: 8 },
  { key: 'noiseHz', min: 300, max: 7000 }, { key: 'noiseColor', min: 0, max: 1 }, { key: 'wet', min: 0, max: 1 },
  { key: 'airPuff', min: 0, max: 1 }, { key: 'stickyStrings', min: 0, max: 1 }, { key: 'bodyPitch', min: 0.5, max: 1.8 },
  { key: 'ring', min: 0, max: 1 }, { key: 'levelDb', min: -8, max: 4 },
];

/* ───────────────────────────────────────────── the table ───────────────────────────────────────────── */

export interface MaterialFamily {
  id: MaterialFamilyId;
  /** Short display name (original). */
  name: string;
  /** One line a designer can recognise: what it feels like in the hand. */
  blurb: string;
  physics: MaterialParams;
  look: MaterialLook;
  sound: MaterialSound;
}

const P = (
  smOmega: number, volOmega: number, volBleedMax: number, airReturnTau: number, airDamp: number,
  memStiff: number, memTau: number, yieldStrain: number, healTau: number, intDamp: number, affDamp: number,
  edgeAlphaT: number, edgeSoftStrain: number, maxPull: number, tableMu: number,
  tack: number, stringiness: number, sloshMass: number, sloshHz: number, sloshZeta: number, jam: number, snap: number,
): MaterialParams => ({
  smOmega, volOmega, volBleedMax, airReturnTau, airDamp, memStiff, memTau, yieldStrain, healTau, intDamp, affDamp,
  edgeAlphaT, edgeSoftStrain, maxPull, tableMu, tack, stringiness, sloshMass, sloshHz, sloshZeta, jam, snap,
});

const L = (
  translucency: number, translucencySpan: number, gloss: number, glossSpan: number, roughness: number, subsurface: number,
  fuzz: number, grain: number, thickness: number, blush: number, stretchPale: number, coreGlow: number, glitter: number,
): MaterialLook => ({
  translucency, translucencySpan, gloss, glossSpan, roughness, subsurface, fuzz, grain, thickness, blush, stretchPale, coreGlow, glitter,
});

const S = (
  bubbleRate: number, bubbleRadiusMinMm: number, bubbleRadiusMaxMm: number, noiseHz: number, noiseColor: number, wet: number,
  airPuff: number, stickyStrings: number, bodyPitch: number, ring: number, levelDb: number,
): MaterialSound => ({
  bubbleRate, bubbleRadiusMinMm, bubbleRadiusMaxMm, noiseHz, noiseColor, wet, airPuff, stickyStrings, bodyPitch, ring, levelDb,
});

// Argument order of P(): smOmega volOmega bleed airTau airDamp | memStiff memTau yield heal intDamp affDamp | edgeA edgeSoft maxPull mu |
//                        tack string sloshM sloshHz sloshZ jam snap
export const MATERIAL_FAMILIES: Record<MaterialFamilyId, MaterialFamily> = {
  slowrise: {
    id: 'slowrise', name: 'Slow-Rise Foam',
    blurb: 'Sinks in like a sponge, then creeps back up over several seconds; light, dry, no bounce, a little crunch of air.',
    physics: P(20, 38, 0.55, 1.45, 0.9, 2.0, 0.5, 0, 60, 18, 40, 0.22, 0.20, 1.0, 0.70, 0.10, 0, 0, 3, 0.4, 0.35, 0),
    look: L(0.04, 0.04, 0.35, 0.15, 0.7, 0.15, 0.35, 0.55, 0.3, 0.1, 0.1, 0.15, 0),
    sound: S(0.25, 0.3, 1.0, 3800, 0.8, 0.1, 0.95, 0.1, 0.95, 0.05, -3),
  },
  marshmallow: {
    id: 'marshmallow', name: 'Marshmallow Puff',
    blurb: 'Featherlight and powdery; squashes flat with almost no push-back and puffs up again in a second.',
    physics: P(13, 28, 0.35, 0.28, 0.35, 0.5, 0.25, 0, 60, 12, 34, 0.35, 0.28, 1.3, 0.75, 0.20, 0.1, 0, 3, 0.4, 0.10, 0),
    look: L(0.05, 0.05, 0.08, 0.06, 0.95, 0.35, 0.8, 0.3, 0.3, 0.15, 0.1, 0.1, 0),
    sound: S(0.2, 0.3, 0.9, 4800, 0.9, 0.05, 0.55, 0.15, 1.0, 0, -4.5),
  },
  mochidough: {
    id: 'mochidough', name: 'Mochi Dough',
    blurb: 'Soft, heavy dough: it stretches, keeps a thumb-print for a few seconds, then slowly smooths itself out.',
    physics: P(14, 150, 0.05, 0.3, 0.1, 3.0, 0.45, 0.045, 2.5, 16, 40, 0.55, 0.50, 2.1, 0.80, 0.30, 0.15, 0, 3, 0.4, 0.10, 0),
    look: L(0.18, 0.12, 0.2, 0.15, 0.85, 0.55, 0.55, 0.5, 0.8, 0.35, 0.45, 0.4, 0.1),
    sound: S(0.5, 0.8, 2.5, 1500, 0.35, 0.35, 0.1, 0.35, 0.85, 0, -2),
  },
  jellygel: {
    id: 'jellygel', name: 'Jelly Gel',
    blurb: 'Glossy, translucent and bouncy: squashes without losing volume, bulges around your finger, wobbles for a while.',
    physics: P(23, 480, 0, 0.1, 0.02, 0.1, 0.2, 0, 60, 4.6, 21, 0.41, 0.36, 1.73, 0.60, 0.15, 0, 0, 3, 0.4, 0, 0),
    look: L(0.82, 0.18, 0.88, 0.12, 0.08, 0.7, 0, 0, 1.0, 0.85, 0.75, 1.0, 1.0),
    sound: S(1.0, 0.6, 4.0, 2200, 0.5, 0.8, 0, 0.15, 1.0, 0.55, 0),
  },
  waterfill: {
    id: 'waterfill', name: 'Liquid Core',
    blurb: 'A thin skin around a sloshing liquid: it bulges where you do not press and keeps swaying after you let go.',
    physics: P(11, 650, 0, 0.1, 0.05, 0.1, 0.3, 0, 60, 3.2, 14, 0.30, 0.22, 1.5, 0.55, 0.05, 0, 0.45, 2.6, 0.10, 0, 0),
    look: L(0.93, 0.07, 0.95, 0.05, 0.04, 0.35, 0, 0, 1.4, 0.45, 0.3, 0.9, 1.4),
    sound: S(1.6, 1.0, 6.0, 1200, 0.3, 1.0, 0, 0.05, 0.8, 0.35, 1.5),
  },
  putty: {
    id: 'putty', name: 'Bounce Putty',
    blurb: 'Firm and dead when you poke it fast, flows like taffy when you lean on it, and keeps the dent you leave.',
    physics: P(12, 300, 0, 0.1, 0.05, 5.0, 0.5, 0.07, 40, 12, 30, 0.60, 0.45, 2.3, 0.70, 0.20, 0.3, 0, 3, 0.4, 0, 0),
    look: L(0.08, 0.08, 0.55, 0.15, 0.45, 0.2, 0.1, 0.1, 0.5, 0.2, 0.25, 0.25, 0.2),
    sound: S(0.45, 1.2, 3.5, 700, 0.2, 0.3, 0, 0.25, 0.75, 0.1, -1.5),
  },
  stickystretch: {
    id: 'stickystretch', name: 'Sticky Stretch',
    blurb: 'Clingy and stretchy: it grabs your fingertip, pulls into long thin strings, then snaps back with a tack.',
    physics: P(16, 400, 0, 0.1, 0.05, 0.8, 0.35, 0, 60, 3.4, 18, 0.75, 0.65, 2.9, 1.10, 0.90, 0.85, 0, 3, 0.4, 0, 0),
    look: L(0.6, 0.25, 0.78, 0.15, 0.12, 0.6, 0.05, 0, 0.9, 0.6, 0.9, 0.8, 0.7),
    sound: S(0.9, 0.5, 2.5, 2800, 0.6, 0.55, 0, 0.9, 1.05, 0.2, -0.5),
  },
  slimegoo: {
    id: 'slimegoo', name: 'Slime Goo',
    blurb: 'A wet, sticky glob: it oozes after every squeeze, drips into strings and takes ages to pull itself together.',
    physics: P(9.5, 350, 0, 0.1, 0.05, 3.0, 0.8, 0, 60, 16, 40, 0.70, 0.50, 2.7, 0.95, 0.75, 1.0, 0, 3, 0.4, 0, 0),
    look: L(0.7, 0.25, 0.96, 0.04, 0.03, 0.8, 0, 0, 1.1, 0.5, 0.8, 0.8, 1.3),
    sound: S(1.9, 1.5, 6.0, 900, 0.25, 1.0, 0, 0.85, 0.7, 0, 1),
  },
  firmsilicone: {
    id: 'firmsilicone', name: 'Firm Silicone',
    blurb: 'Dense, grippy rubber: pushes back hard, snaps back instantly and keeps rebounding.',
    physics: P(38, 600, 0.02, 0.06, 0.02, 0.05, 0.1, 0, 60, 2.0, 8, 0.12, 0.12, 1.15, 0.90, 0.10, 0, 0, 3, 0.4, 0.15, 0),
    look: L(0.25, 0.2, 0.45, 0.2, 0.35, 0.4, 0.05, 0.1, 0.6, 0.3, 0.3, 0.5, 0.3),
    sound: S(0.35, 0.4, 1.5, 3200, 0.6, 0.2, 0.05, 0.1, 1.3, 0.85, -1),
  },
  popdome: {
    id: 'popdome', name: 'Pop Dome',
    blurb: 'A stiff silicone dome that resists, then suddenly gives with a pop and flips inside out.',
    physics: P(44, 70, 0.30, 0.06, 0.1, 0, 0.1, 0, 60, 2.4, 8, 0.08, 0.08, 0.8, 0.80, 0, 0, 0, 3, 0.4, 0.5, 1),
    look: L(0.35, 0.2, 0.7, 0.2, 0.2, 0.25, 0, 0, 0.4, 0.15, 0.1, 0.6, 0.2),
    sound: S(0.1, 0.3, 0.8, 5200, 1.0, 0, 0.2, 0, 1.5, 1.0, 0),
  },
  gummy: {
    id: 'gummy', name: 'Gummy Jelly',
    blurb: 'Firm and chewy: a quick, slightly sticky spring-back with very little wobble, like candy.',
    physics: P(30, 520, 0, 0.1, 0.02, 0.35, 0.3, 0, 60, 8, 22, 0.20, 0.16, 1.25, 0.70, 0.30, 0.1, 0, 3, 0.4, 0.10, 0),
    look: L(0.9, 0.1, 0.8, 0.15, 0.15, 0.85, 0, 0, 1.2, 0.8, 0.6, 0.9, 0.5),
    sound: S(0.55, 0.6, 2.0, 2600, 0.55, 0.35, 0, 0.3, 1.1, 0.4, -1.5),
  },
  beadsqueeze: {
    id: 'beadsqueeze', name: 'Bead Squeeze',
    blurb: 'A bag of tiny beads: it yields, rearranges with a crunch, firms up as it jams, and stays a little lumpy.',
    physics: P(15, 36, 0.18, 0.5, 0.3, 2.0, 0.25, 0.05, 2.5, 14, 36, 0.40, 0.35, 1.4, 0.65, 0, 0, 0.2, 3.5, 0.35, 0.85, 0),
    look: L(0.5, 0.3, 0.5, 0.3, 0.3, 0.3, 0, 0.9, 1.0, 0.25, 0.2, 0.5, 1.2),
    sound: S(2.4, 0.3, 0.7, 5400, 1.0, 0, 0, 0, 0.9, 0, -2),
  },
};

/** The same table as an ordered array (roster order). */
export const MATERIAL_LIST: readonly MaterialFamily[] = MATERIAL_FAMILY_IDS.map((id) => MATERIAL_FAMILIES[id]);

/* ─────────────────────────────────── derived numbers, distance, feel ─────────────────────────────────── */

const LN20 = Math.log(20);
/** Must equal H in src/physics/params.ts (1/(60*6)). Used only to convert volOmega to the solver's volKappa. */
export const NOMINAL_SUBSTEP_S = 1 / 360;
/** Maximum plastic displacement of the memory shape from the true rest shape, in rest radii (Mueller's c_max). */
export const MEM_MAX_R0 = 0.6;

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Position of `v` in an axis range, 0..1 (log axes in log space). */
export function normalizeAxis(spec: AxisSpec, v: number): number {
  const lo = spec.log ? Math.log(spec.min) : spec.min, hi = spec.log ? Math.log(spec.max) : spec.max;
  const x = spec.log ? Math.log(Math.max(v, 1e-9)) : v;
  return clamp((x - lo) / (hi - lo), 0, 1);
}

/** How active a parameter is: dormant parameters (no bleed, no memory, no tack, no slosh) must not make two families look different. */
function activation(p: MaterialParams, key: PhysicsKey): number {
  switch (key) {
    case 'airReturnTau': case 'airDamp': return Math.min(1, p.volBleedMax / 0.12);
    case 'memTau': return Math.min(1, p.memStiff / 0.3);
    case 'yieldStrain': return Math.min(1, p.memStiff / 0.3);
    case 'healTau': return Math.min(1, (p.memStiff * p.yieldStrain) / 0.03);
    case 'stringiness': return Math.min(1, p.tack / 0.2);
    case 'sloshHz': case 'sloshZeta': return Math.min(1, p.sloshMass / 0.1);
    default: return 1;
  }
}

/** Normalised, activation-gated feature vector over PHYSICS_AXES (each 0..1). */
export function materialVector(p: MaterialParams): number[] {
  return PHYSICS_AXES.map((a) => normalizeAxis(a, p[a.key]) * activation(p, a.key));
}

/** RMS distance between two materials' vectors, 0..1. 0.1 ~ "half a range on one axis, or a third of a range on two". */
export function materialDistance(a: MaterialParams, b: MaterialParams): number {
  const va = materialVector(a), vb = materialVector(b);
  let s = 0;
  for (let i = 0; i < va.length; i++) s += (va[i] - vb[i]) * (va[i] - vb[i]);
  return Math.sqrt(s / va.length);
}

/** Heuristic Poisson ratio from the bulk-to-shape stiffness ratio r = (volOmega/smOmega)^2: nu = (3r - 2) / (2 (3r + 1)). Design-level, uncalibrated. */
export function effectivePoisson(p: MaterialParams): number {
  const r = (p.volOmega / p.smOmega) ** 2;
  return clamp((3 * r - 2) / (2 * (3 * r + 1)), 0, 0.4999);
}

/** Depth (rest radii) of a dent the material keeps: the restoring spring pulls with k1 x against a slider of strength k2 y, so x ~ memStiff * yield. */
export const dentHoldDepth = (p: MaterialParams): number => p.memStiff * p.yieldStrain;

/** Approximate time (s) for the squeeze to be ~95% recovered after release. Slowest of: air return, viscoelastic retardation, plastic heal, bounce ring-down. */
export function recoverySeconds95(p: MaterialParams): number {
  const air = p.volBleedMax >= 0.04 ? LN20 * p.airReturnTau : 0;
  const visco = p.memStiff > 0.3 ? LN20 * p.memTau * (1 + p.memStiff) : 0;
  const heal = dentHoldDepth(p) > 0.02 ? LN20 * p.healTau : 0;
  const ring = (2 * LN20) / p.intDamp;
  return Math.min(60, Math.max(air, visco, heal, ring));
}

/** Nine 0..1 scores for UI bars and design reviews ("touch feel"). */
export interface FeelVector {
  firm: number; squashy: number; slowRise: number; holdsDent: number; bouncy: number;
  stretchy: number; tacky: number; sloshy: number; snappy: number;
}
export function feelOf(p: MaterialParams): FeelVector {
  const ax = (k: PhysicsKey): AxisSpec => PHYSICS_AXES.find((a) => a.key === k) as AxisSpec;
  return {
    firm: normalizeAxis(ax('smOmega'), p.smOmega),
    squashy: Math.max(clamp(p.volBleedMax / 0.5, 0, 1), 1 - normalizeAxis(ax('volOmega'), p.volOmega)),
    slowRise: clamp(recoverySeconds95(p) / 8, 0, 1),
    holdsDent: clamp(dentHoldDepth(p) / 0.35, 0, 1),
    bouncy: 1 - normalizeAxis(ax('intDamp'), p.intDamp),
    stretchy: normalizeAxis(ax('maxPull'), p.maxPull),
    tacky: p.tack,
    sloshy: clamp(p.sloshMass / 0.45, 0, 1) * (1 - 0.5 * normalizeAxis(ax('sloshZeta'), p.sloshZeta)),
    snappy: p.snap,
  };
}

/* ─────────────────────────────────── resolve: family x genome -> numbers ─────────────────────────────────── */

/** Everything the physics lane needs, in the units of src/physics/params.ts plus the new features. All no-ops at neutral values. */
export interface SolverMaterial {
  // same names and units as SoftParams
  smOmega: number; edgeAlphaT: number; edgeSoftStrain: number; volKappa: number; intDamp: number; affDamp: number; intDamp2: number;
  drag: number; tableMu: number; maxPull: number;
  // volume target (air bleed): V* in [volFloor, 1]; falls toward the current volume with volOutTau, returns with volInTau
  volFloor: number; volOutTau: number; volInTau: number; volDampZeta: number;
  // memory arm (viscoelastic + plastic)
  memStiff: number; memTau: number; memYield: number; memHealTau: number; memMax: number;
  // nonlinear stiffening, adhesion, slosh, snap
  jam: number; tack: number; tackBreakR0: number; tackAlphaT: number; stringiness: number;
  sloshMass: number; sloshHz: number; sloshZeta: number; snap: number;
}

export interface ResolvedLook {
  translucency: number; gloss: number; roughness: number; subsurface: number; fuzz: number; grain: number;
  thickness: number; blush: number; stretchPale: number; coreGlow: number; glitter: number;
}

export interface ResolvedMaterial {
  /** The family actually used (the gel family when the requested id is not a family). */
  familyId: MaterialFamilyId;
  requestedId: string;
  fellBack: boolean;
  name: string;
  blurb: string;
  physics: MaterialParams;
  look: ResolvedLook;
  sound: MaterialSound;
  solver: SolverMaterial;
  derived: { effectivePoisson: number; dentHoldDepth: number; recoverySeconds95: number; rateStiffening: number; feel: FeelVector };
}

/** Genome field in 0..1, 0.5 when missing or not finite (hostile share strings never reach here, but a half-built genome might). */
const unit = (v: unknown): number => clamp(num(v, 0.5), 0, 1);
/** 1.25^s: the symmetric +/-25% band (x0.8 .. x1.25) for a signed signal s in [-1, 1]. */
const band = (s: number): number => Math.pow(1.25, s);

/**
 * The bounded per-instance modulation. Neutral genome (all 0.5) returns the family base unchanged.
 *   firmness  -> smOmega x1.25^+, volOmega x1.5^+, volBleedMax x(1 -/+ 15%), edgeAlphaT x1.2^-   (firmer => never softer)
 *   bounce    -> intDamp, affDamp x1.6^-                                                                (bouncier => less damping)
 *   stretch   -> maxPull x1.25^+, edgeAlphaT x1.3^+, edgeSoftStrain x1.25^+
 *   size      -> airReturnTau x1.25^+ (longer air path), sloshHz x1.25^-/2 (slower in a bigger body)
 */
function modulate(b: MaterialParams, f: number, bo: number, s: number, z: number): MaterialParams {
  const fs = 2 * f - 1, bs = 2 * bo - 1, ss = 2 * s - 1, zs = 2 * z - 1;
  const raw: MaterialParams = {
    ...b,
    smOmega: b.smOmega * band(fs),
    volOmega: b.volOmega * Math.pow(1.5, fs),
    volBleedMax: b.volBleedMax * (1 - 0.15 * fs),
    airReturnTau: b.airReturnTau * band(zs),
    intDamp: b.intDamp * Math.pow(1.6, -bs),
    affDamp: b.affDamp * Math.pow(1.6, -bs),
    edgeAlphaT: b.edgeAlphaT * Math.pow(1.2, -fs) * Math.pow(1.3, ss),
    edgeSoftStrain: b.edgeSoftStrain * band(ss),
    maxPull: b.maxPull * band(ss),
    sloshHz: b.sloshHz * Math.pow(1.25, -zs / 2),
  };
  const out = { ...raw } as Record<PhysicsKey, number>;
  for (const a of PHYSICS_AXES) out[a.key] = clamp(num(raw[a.key], (a.min + a.max) / 2), a.min, a.max);
  return out;
}

/**
 * Family x genome -> concrete numbers for physics, render and audio. Total (never throws, any family id, any half-built genome),
 * deterministic (no randomness, no clock) and monotone: raising firmness never lowers smOmega or volOmega, never raises
 * volBleedMax or edgeAlphaT; raising bounce never raises intDamp; raising stretch never lowers maxPull; and so on.
 */
export function resolveMaterial(familyId: string, genome: Genome): ResolvedMaterial {
  const known = isMaterialFamilyId(familyId);
  const id: MaterialFamilyId = known ? familyId : DEFAULT_FAMILY_ID;
  const fam = MATERIAL_FAMILIES[id];
  const g = (genome ?? {}) as Partial<Genome>;
  const f = unit(g.firmness), bo = unit(g.bounce), s = unit(g.stretch), z = unit(g.size);
  const t = unit(g.translucency), gl = unit(g.gloss);

  const physics = modulate(fam.physics, f, bo, s, z);
  const fl = fam.look;
  const look: ResolvedLook = {
    translucency: clamp(fl.translucency + fl.translucencySpan * (2 * t - 1), 0, 1),
    gloss: clamp(fl.gloss + fl.glossSpan * (2 * gl - 1), 0, 1),
    roughness: fl.roughness, subsurface: fl.subsurface, fuzz: fl.fuzz, grain: fl.grain, thickness: fl.thickness,
    blush: fl.blush, stretchPale: fl.stretchPale,
    coreGlow: clamp(unit(g.coreGlow) * fl.coreGlow, 0, 1),
    glitter: clamp(unit(g.glitter) * fl.glitter, 0, 1),
  };
  const sound: MaterialSound = { ...fam.sound, ring: clamp(fam.sound.ring * (1 + 0.25 * (2 * bo - 1)), 0, 1) };

  const kappa = clamp(1 / ((physics.volOmega * NOMINAL_SUBSTEP_S) ** 2), 0.05, 1e4);
  const solver: SolverMaterial = {
    smOmega: physics.smOmega, edgeAlphaT: physics.edgeAlphaT, edgeSoftStrain: physics.edgeSoftStrain, volKappa: kappa,
    intDamp: physics.intDamp, affDamp: physics.affDamp,
    // velocity-proportional damping of the release spike: PHYS maps bounce 0..1 -> intDamp 11..1.6 and intDamp2 9..2.5, i.e. intDamp2 ~ 9 (intDamp/11)^0.66
    intDamp2: clamp(9 * Math.pow(physics.intDamp / 11, 0.66), 1, 30),
    drag: 0.18, tableMu: physics.tableMu, maxPull: physics.maxPull,
    volFloor: 1 - physics.volBleedMax, volOutTau: Math.max(0.04, 0.12 * physics.airReturnTau), volInTau: physics.airReturnTau,
    volDampZeta: physics.airDamp,
    memStiff: physics.memStiff, memTau: physics.memTau, memYield: physics.yieldStrain, memHealTau: physics.healTau, memMax: MEM_MAX_R0,
    jam: physics.jam, tack: physics.tack, tackBreakR0: 0.15 + 0.75 * physics.tack, tackAlphaT: 0.9 - 0.82 * physics.tack,
    stringiness: physics.stringiness, sloshMass: physics.sloshMass, sloshHz: physics.sloshHz, sloshZeta: physics.sloshZeta, snap: physics.snap,
  };
  return {
    familyId: id, requestedId: String(familyId), fellBack: !known, name: fam.name, blurb: fam.blurb,
    physics, look, sound, solver,
    derived: {
      effectivePoisson: effectivePoisson(physics), dentHoldDepth: dentHoldDepth(physics),
      recoverySeconds95: recoverySeconds95(physics), rateStiffening: 1 + physics.memStiff, feel: feelOf(physics),
    },
  };
}
