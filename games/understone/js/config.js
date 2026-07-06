// Single source of truth for tuned constants.
// [R] = verified against research/terraria docs (decompile + wiki cross-checked).
// [T] = our own tuning. Units: px, t (ticks, 60/s), tile = 16 px.

export const TILE = 16;                 // [R]

// --- world dimensions (Terraria "small" is 4200x1200; we run wide + shallow) ---
// Width drives biome band size: each ring band = (mid - oceanW)/4, so 3400 gives
// ~375-tile bands (~12 screens each) — much slower forest→graveyard→desert→snow ramp.
export const WORLD_W = 3400;            // [T] tiles
export const WORLD_H = 600;             // [T] tiles

// --- layer boundaries as fraction of world height ---
export const LAYERS = {
  space: 0.00,        // [T]
  surfaceTop: 0.15,   // [T] average surface line sits ~here
  underground: 0.28,  // [T] dirt→stone transition band
  cavern: 0.42,       // [T]
  underworld: 0.88,   // [T] bottom strip
};

// --- player physics: research/terraria/01-physics-collision.md (all [R]) ---
export const PHYS = {
  gravity: 0.4,            // px/t^2
  maxFall: 10,             // px/t
  runAccel: 0.08,          // px/t^2, air control = ground control at base speed
  runSlow: 0.2,            // ground friction px/t^2; airborne friction = 0.1 (runSlow * 0.5)
  maxRun: 3,               // px/t (= 15 mph)
  jumpSpeed: 5.01,         // px/t — velocity PINNED at -5.01 while jump held (not impulse)
  jumpHold: 15,            // t of sustain
  playerW: 14, playerH: 42,// px hitbox — fits a 1-tile (16px) dug shaft so you never wedge in
                           // narrow tunnels (was 20 = 1.25 tiles, too wide to fit; sprite still 40px, drawn centered)
  safeFallTiles: 25,       // fall damage = (tilesFallen - 25) * 10
  fallDmgPerTile: 10,
  hurtIFrames: 40,         // t of immunity after taking damage
  hurtKnockX: 4.5,         // px/t — replaces velocity on hit
  hurtKnockY: -3.5,
  // liquids: velocity computed at full scale, POSITION integrates scaled
  waterMoveFactor: 0.5, honeyMoveFactor: 0.25,
  waterGravity: 0.2, waterMaxFall: 5, waterJumpSpeed: 6.01, waterJumpHold: 30,
  breathMax: 200, breathLossEvery: 7, drownDmgEvery: 7, drownDmg: 2, breathRegenPerTick: 3,
  lavaDamage: 80,
  maxSubStep: 4,           // anti-tunnel: any move faster than this is sub-stepped into <=4px
                           // increments — well under a 16px tile even at knockback / grapple (11px/t) speed
};

// --- interaction (research 03; placement range marked pending final confirm) ---
export const REACH = {
  tilesX: 5, tilesY: 4,    // [R placeholder — confirm vs research 03]
};

// --- day/night (Terraria: day 15 min, night 9 min real time) ---
export const DAY_TICKS = 54000;         // [R]
export const NIGHT_TICKS = 32400;       // [R]
export const CYCLE_TICKS = DAY_TICKS + NIGHT_TICKS;

// --- combat baseline ---
export const COMBAT = {
  playerBaseHP: 100,       // [R]
  playerBaseMana: 20,      // [R]
  respawnTicks: 600,       // [R] 10 s
};

// --- elements: cycle fire > ice > lightning > water > fire; shadow half-off-cycle ---
// attacker element vs defender element → damage multiplier ([T] tuned, research 08)
const BEATS = { fire: 'ice', ice: 'lightning', lightning: 'water', water: 'fire', shadow: 'none' };
export function elementMult(atk, def) {
  if (!atk || atk === 'none' || !def || def === 'none') {
    return atk && atk !== 'none' && (!def || def === 'none') ? (atk === 'shadow' ? 1.15 : 1) : 1;
  }
  if (atk === def) return 0.5;             // resist own element
  if (BEATS[atk] === def) return 1.35;     // advantage
  if (BEATS[def] === atk) return 0.7;      // disadvantage
  return 1;
}

// --- to-hit layer (D&D flavor over Terraria collision combat) ---
// research 08 design: only NIMBLE enemies dodge (capped 10%), pity-reroll blocks
// consecutive dodges, bosses never dodge, no dodging during hitstun.
export const ROLLS = {
  baseCrit: 0.04,          // [R] Terraria base crit
  critMult: 2,             // [R]
  defaultDodge: 0,         // most enemies never dodge
};

// --- rendering ---
export const CHUNK = 32;                // [T] tiles per chunk edge
export const ZOOM_DEFAULT = 2;          // [T] screen px per world px
