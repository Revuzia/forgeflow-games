// WOBBLEHOARD rarity: the six tiers, their PUBLIC capsule odds, display names, and the visual / reveal / haptic language of each tier
// as DATA (_spec/DESIGN.md 5.1, 5.2, 5.3, 6.1, 6.3, 6.7). The render, audio and UI lanes consume these tables; nothing here draws anything.
//
// Pure TypeScript: no DOM, no clock, no randomness. A server can import this file unchanged.
//
// What the SERVER must also know: TIER_ODDS (the odds are public, so the server draws with exactly these numbers) and
// TIER_SPECIES_COUNTS (checked against the catalog by probe_catalog.ts).

export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type TierId = (typeof TIERS)[number];
/** Number of tiers (6). Tier INDEX 0..5 is the order of TIERS and the index into every per-tier array in the economy code. */
export const TIER_COUNT = TIERS.length;
export const TOP_TIER_INDEX = TIER_COUNT - 1;

export const tierIndex = (t: TierId): number => TIERS.indexOf(t);
export const tierFromIndex = (i: number): TierId | undefined => TIERS[i];
export const isTierId = (x: unknown): x is TierId => typeof x === 'string' && (TIERS as readonly string[]).includes(x);

/** Display names (generic English, never a brand). */
export const TIER_NAMES: Readonly<Record<TierId, string>> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic',
};

/** Species per tier (DESIGN 5.2). The catalog must contain exactly this many of each (probe_catalog.ts enforces it). */
export const TIER_SPECIES_COUNTS: readonly number[] = [14, 11, 10, 7, 5, 3];
export const TOTAL_SPECIES: number = TIER_SPECIES_COUNTS.reduce((a, b) => a + b, 0);

/**
 * PUBLIC capsule odds per tier as fractions (DESIGN 5.1/5.2): 76.3 / 13 / 6 / 2.8 / 1.4 / 0.5 percent. These are the numbers the game shows
 * the player, so they are the numbers the drop code uses; there is no hidden adjustment (no pity, no streak bonus, no affinity: DESIGN 5.5).
 */
export const TIER_ODDS: readonly number[] = [0.763, 0.13, 0.06, 0.028, 0.014, 0.005];
/** The same odds as the percent numbers shown in the UI. */
export const TIER_ODDS_PERCENT: readonly number[] = [76.3, 13, 6, 2.8, 1.4, 0.5];

/** Odds of one specific species of a tier per capsule (uniform inside the tier). */
export const oddsPerSpecies = (t: TierId): number => TIER_ODDS[tierIndex(t)] / TIER_SPECIES_COUNTS[tierIndex(t)];

/** Display text of the public odds, e.g. "Common 76.3%". Percent numbers print without a trailing .0. */
export function oddsLabel(t: TierId): string {
  const p = TIER_ODDS_PERCENT[tierIndex(t)];
  return `${TIER_NAMES[t]} ${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

/* ────────────────────────────────────── visual language per tier (DESIGN 5.3) ────────────────────────────────────── */

export type GemShape = 'circle' | 'diamond' | 'hexagon' | 'star4' | 'star6' | 'prism8';
export type BodyLook = 'plain-jelly' | 'more-translucent' | 'deep-transmission' | 'two-tone-gradient' | 'aurora-gradient' | 'thin-film-iridescence';
export type CoreLook = 'dim' | 'warm' | 'glowing-seed' | 'bloom' | 'bright-pillar' | 'prism';
export type AuraLook = 'contact-shadow' | 'tinted-light-pool' | 'soft-rim-halo' | 'orbiting-motes-caustic-ring' | 'pulsing-floor-ring' | 'light-dome-satellites';
export type SparkleLook = 'none' | 'few-flecks' | 'moderate-glitter' | 'glitter-drifts-up' | 'dense-glitter-spark-trail' | 'fixed-star-constellation';
export type IdleMotion = 'blink-breathe' | 'core-pulse-slow' | 'motes-trail' | 'settle-wobble-ring' | 'hum-glow-breathe';

export interface TierStyle {
  id: TierId;
  name: string;
  /** DESIGN 5.3 table cells as keys the render lane switches on. */
  body: BodyLook;
  core: CoreLook;
  aura: AuraLook;
  sparkle: SparkleLook;
  idle: IdleMotion;
  /** UI gem silhouette (rarity is never colour-only: shape + label + sound). */
  gem: GemShape;
  /** Number of points of the gem (circle = 0). */
  gemPoints: number;
  /** UI frame colour token (hex from CONTRACT.md section 7; Rare is the lifted dusk-violet so the frame reads on the ink background; Mythic cycles `prismHex`). */
  frameHex: string;
  /** The colour of the light that leaks through the capsule cracks at B1 (DESIGN 6.3): "the tell". */
  tellHex: string;
  /** Mythic only: the colours the prism frame and dome slowly cycle through (never faster than 0.25 Hz). */
  prismHex?: readonly string[];
  /** Numeric knobs for the tier FX pass, all 0 for Common. Magnitudes are relative; the render lane owns the final scale. */
  fx: {
    /** 0..1 added rim-light strength on the body. */
    rimHalo: number;
    /** Slow orbiting motes around the body (count; 0 = none). */
    motes: number;
    /** 0..1 extra glitter density multiplier on top of the genome's own glitter. */
    glitterBoost: number;
    /** Core pulse frequency in Hz (0 = steady). Always under 0.5 Hz (flash budget, DESIGN 6.6). */
    corePulseHz: number;
    /** Table ring pulse frequency in Hz (0 = none). 0.25 Hz for Legendary. */
    ringPulseHz: number;
    /** A faint vertical light pillar on idle. */
    pillar: boolean;
    /** 0..1 thin-film hue shift with view angle (Mythic). */
    iridescence: number;
    /** Small orbiting satellite spheres (Mythic). */
    satellites: number;
    /** Fixed star points inside the body (Mythic). */
    constellationPoints: number;
  };
  /** Capsule open and merge ceremony budgets (DESIGN 6.1, 6.3, 6.4); the tap-to-skip rule is the shell's. */
  reveal: {
    openSeconds: number;
    /** A repeat of an owned Common / Uncommon may play this short version (0 = no short version). */
    openSecondsRepeat: number;
    mergeSeconds: number;
    /** Audio and visual pre-roll before the burst, seconds. */
    preRollSeconds: number;
    /** Round motes at the burst. */
    motes: number;
    glitter: number;
    /** Extra particles: spiral trails (Epic), ribbons (Legendary), star points (Mythic). 0 if none. */
    specialParticles: number;
    rings: number;
    /** Camera push in percent of the framing distance, and the arc in degrees. */
    cameraPushPercent: number;
    cameraArcDegrees: number;
    /** Slow-motion at the burst: scale and duration (ms). scale 1 = none. */
    timeScale: number;
    timeScaleMs: number;
    /** Audio duck before the swell, ms (Mythic only). */
    audioDuckMs: number;
  };
  /** navigator.vibrate pattern for the reveal (DESIGN 6.7), ms. Optional; nothing depends on it. */
  haptic: readonly number[];
  /** Sound signature key (DESIGN 6.5) for the audio lane. */
  soundKey: 'bloop' | 'bloop-chime-third' | 'bell-cluster-fifth' | 'saw-swell-arp' | 'choir-pad-bells' | 'mythic-motif';
}

const style = (s: TierStyle): TierStyle => s;

export const TIER_STYLE: Readonly<Record<TierId, TierStyle>> = {
  common: style({
    id: 'common', name: 'Common', body: 'plain-jelly', core: 'dim', aura: 'contact-shadow', sparkle: 'none', idle: 'blink-breathe',
    gem: 'circle', gemPoints: 0, frameHex: '#fff1d6', tellHex: '#ffe6b8',
    fx: { rimHalo: 0, motes: 0, glitterBoost: 0, corePulseHz: 0, ringPulseHz: 0, pillar: false, iridescence: 0, satellites: 0, constellationPoints: 0 },
    reveal: { openSeconds: 1.6, openSecondsRepeat: 0.8, mergeSeconds: 2.2, preRollSeconds: 0, motes: 12, glitter: 0, specialParticles: 0, rings: 0, cameraPushPercent: 0, cameraArcDegrees: 0, timeScale: 1, timeScaleMs: 0, audioDuckMs: 0 },
    haptic: [12], soundKey: 'bloop',
  }),
  uncommon: style({
    id: 'uncommon', name: 'Uncommon', body: 'more-translucent', core: 'warm', aura: 'tinted-light-pool', sparkle: 'few-flecks', idle: 'blink-breathe',
    gem: 'diamond', gemPoints: 4, frameHex: '#59d6e6', tellHex: '#59d6e6',
    fx: { rimHalo: 0.1, motes: 0, glitterBoost: 0.15, corePulseHz: 0, ringPulseHz: 0, pillar: false, iridescence: 0, satellites: 0, constellationPoints: 0 },
    reveal: { openSeconds: 2.0, openSecondsRepeat: 0.8, mergeSeconds: 2.6, preRollSeconds: 0, motes: 24, glitter: 6, specialParticles: 0, rings: 0, cameraPushPercent: 2, cameraArcDegrees: 0, timeScale: 1, timeScaleMs: 0, audioDuckMs: 0 },
    haptic: [12, 60, 8], soundKey: 'bloop-chime-third',
  }),
  rare: style({
    id: 'rare', name: 'Rare', body: 'deep-transmission', core: 'glowing-seed', aura: 'soft-rim-halo', sparkle: 'moderate-glitter', idle: 'core-pulse-slow',
    gem: 'hexagon', gemPoints: 6, frameHex: '#8a67b8', tellHex: '#a07be0',
    fx: { rimHalo: 0.45, motes: 0, glitterBoost: 0.4, corePulseHz: 0.4, ringPulseHz: 0, pillar: false, iridescence: 0, satellites: 0, constellationPoints: 0 },
    reveal: { openSeconds: 2.6, openSecondsRepeat: 0, mergeSeconds: 3.2, preRollSeconds: 0.3, motes: 40, glitter: 12, specialParticles: 0, rings: 1, cameraPushPercent: 4, cameraArcDegrees: 6, timeScale: 1, timeScaleMs: 0, audioDuckMs: 0 },
    haptic: [10, 50, 14, 50, 18], soundKey: 'bell-cluster-fifth',
  }),
  epic: style({
    id: 'epic', name: 'Epic', body: 'two-tone-gradient', core: 'bloom', aura: 'orbiting-motes-caustic-ring', sparkle: 'glitter-drifts-up', idle: 'motes-trail',
    gem: 'star4', gemPoints: 4, frameHex: '#ff5a4d', tellHex: '#ff5a4d',
    fx: { rimHalo: 0.6, motes: 4, glitterBoost: 0.65, corePulseHz: 0.3, ringPulseHz: 0, pillar: false, iridescence: 0, satellites: 0, constellationPoints: 0 },
    reveal: { openSeconds: 3.2, openSecondsRepeat: 0, mergeSeconds: 3.8, preRollSeconds: 0.5, motes: 70, glitter: 0, specialParticles: 24, rings: 2, cameraPushPercent: 6, cameraArcDegrees: 10, timeScale: 0.6, timeScaleMs: 250, audioDuckMs: 0 },
    haptic: [14, 40, 18, 40, 22, 40, 26, 80, 30], soundKey: 'saw-swell-arp',
  }),
  legendary: style({
    id: 'legendary', name: 'Legendary', body: 'aurora-gradient', core: 'bright-pillar', aura: 'pulsing-floor-ring', sparkle: 'dense-glitter-spark-trail', idle: 'settle-wobble-ring',
    gem: 'star6', gemPoints: 6, frameHex: '#ffb347', tellHex: '#ffb347',
    fx: { rimHalo: 0.8, motes: 5, glitterBoost: 0.9, corePulseHz: 0.25, ringPulseHz: 0.25, pillar: true, iridescence: 0, satellites: 0, constellationPoints: 0 },
    reveal: { openSeconds: 3.9, openSecondsRepeat: 0, mergeSeconds: 4.5, preRollSeconds: 0.8, motes: 120, glitter: 0, specialParticles: 24, rings: 3, cameraPushPercent: 8, cameraArcDegrees: 15, timeScale: 0.5, timeScaleMs: 350, audioDuckMs: 0 },
    haptic: [10, 20, 14, 20, 18, 20, 22, 20, 26, 20, 30, 120, 45], soundKey: 'choir-pad-bells',
  }),
  mythic: style({
    id: 'mythic', name: 'Mythic', body: 'thin-film-iridescence', core: 'prism', aura: 'light-dome-satellites', sparkle: 'fixed-star-constellation', idle: 'hum-glow-breathe',
    gem: 'prism8', gemPoints: 8, frameHex: '#e9f4ff', tellHex: '#d8c8ff',
    prismHex: ['#59d6e6', '#a07be0', '#ff8fb0', '#ffd27a'],
    fx: { rimHalo: 1, motes: 0, glitterBoost: 1, corePulseHz: 0.2, ringPulseHz: 0, pillar: false, iridescence: 1, satellites: 2, constellationPoints: 24 },
    reveal: { openSeconds: 4.5, openSecondsRepeat: 0, mergeSeconds: 5.2, preRollSeconds: 1.0, motes: 200, glitter: 0, specialParticles: 24, rings: 3, cameraPushPercent: 10, cameraArcDegrees: 25, timeScale: 0.4, timeScaleMs: 500, audioDuckMs: 250 },
    haptic: [10, 25, 12, 25, 14, 25, 16, 25, 18, 25, 20, 25, 22, 250, 60, 60, 60], soundKey: 'mythic-motif',
  }),
};

/** The tiers as an ordered array of styles (Common first). */
export const TIER_STYLES: readonly TierStyle[] = TIERS.map((t) => TIER_STYLE[t]);

/** The tier above `t`, or undefined for Mythic (a Mythic cannot merge: nothing above it). */
export const nextTier = (t: TierId): TierId | undefined => TIERS[tierIndex(t) + 1];
