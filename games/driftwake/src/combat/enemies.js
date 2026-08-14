/**
 * Enemy runtime — the whole thirty-body roster, fifteen animation roles, on
 * one SoA pool of 24. Nothing in here knows what a body LOOKS like: it names
 * a clip SLOT and a normalised phase and lets the renderer decide how to play
 * it (combat/enemyVis.js today, combat/meshEnemies.js when the skinned bodies
 * land).
 *
 * WHAT REPLACED WHAT (2026-08-07). The previous revision hard-coded four
 * archetypes — ARCH_IMP/ARCH_SPRITE/ARCH_STALKER/ARCH_BRUTE, the `COLD_DATA`
 * table, `COLD_KEYS`, and a `KEY_ALIAS` map that pointed eight real roster keys
 * at the nearest of those four shapes (rimeboundCultist → hoarfrostSprite,
 * hailPlateGuard → glacierBrute, blizzardAssassin → frostStalker, …). All of
 * that is deleted. Identity now comes from `combat/roster.js` (thirty bodies +
 * six mesh-reuse dress-ups = thirty-six spawnable identities covering all
 * thirty-three `combatData.ENEMIES` rows) and every number comes off the
 * combatData row itself. A unit's BEHAVIOUR is selected by its `animRole`,
 * which is also what decides its clip kit (`roster.ROLE_KIT`), so the AI can
 * never ask for a clip the retarget stage did not emit.
 *
 * SOURCES, AND THE LINE BETWEEN THEM.
 *   - Numbers (hp / speed / burst / perception / attackRange / gapCloser /
 *     poise / leash / telegraphMs / damages / hyperArmor / construct /
 *     carapaceHp / cores): `combat/combatData.js`, the L10 anchor contract.
 *     Never transcribed here — read at init off the row.
 *   - Identity (slug, animRole, engineScale, mesh reuse): `combat/roster.js`.
 *   - Behaviour shape: `_spec/COMBAT_DESIGN.md` §3.1–§3.6 (per-archetype AI
 *     briefs), §4.1 perception, §4.2 tokens, §4.3 leash.
 *   - Per-unit specials: the row's own `special` string and the numbers inside
 *     it. Where a special states NO number it is NOT implemented and is listed
 *     in `UNIMPLEMENTED_SPECIALS` below rather than guessed at.
 *   - Everything under "implementation constants" is engine plumbing that no
 *     document defines, and says so.
 *
 * ANCHOR SCALING (§0): HP = row × 1.10^(L−10), DMG = row × 1.07^(L−10).
 * Behaviour is level-invariant.
 *
 * FRAME ORDER (§9.2): registry.update(dt) → enemies.update(dt) → spells.update.
 * Enemy melee runs BEFORE the spells so volumes test current-frame positions;
 * kills from the player's spells are detected next frame by the hp[slot] <= 0
 * check — one frame of latency, an order of magnitude below the telegraph floor.
 *
 * `dt === 0` (S.freezeTime): strict no-op, no divides by dt anywhere.
 * Zero allocation on the frame path: every array is preallocated, every unit
 * record and attack table is built once at construction, brains are switch-
 * dispatched on the role id, and no closure/object/string is created per frame.
 */

import { TIER } from "./damageable.js";
import { ENEMIES as COMBAT_ROWS } from "./combatData.js";
import { ROSTER, MESH_REUSE, ROLE_KIT } from "./roster.js";
import { Pathing } from "./pathing.js";
import { sfx } from "../audio/sfx.js";

/** Pool size (owner brief). Unchanged: the director's ceiling is MAX_PACK 8
 *  (encounters.js) and ALIVE_CAP is 6/8/8 per realm, so 24 still leaves 16
 *  slots of headroom for `spawnAt` test units and arena adds. */
export const ENEMY_MAX = 24;
/** Enemy projectile pool. Raised from 16 → 32: the Cold slice had exactly one
 *  projectile caster (the sprite, 3-bolt volleys); the full roster has nine
 *  keys that fire (sprite, cultist, dust/smoke mage, bandit grit, skier spray,
 *  imp/mummy spit, bone shard, boss sand-slash, guardian slag-spit) and the
 *  §4.2 ranged-token cap of 2 concurrent casters × up to 4 bolts in flight per
 *  volley × the 3 s TTL overlaps past 16. */
export const BOLT_MAX = 32;

// ------------------------------------------------------------- spec constants
/** §4.2 — shared per-encounter pool: 2 melee + 2 ranged tokens. */
const MELEE_TOKENS = 2;
const RANGED_TOKENS = 2;
/** §4.2 — hold the token through recovery: attack duration + 0.75 s. */
const TOKEN_RECOVER_S = 0.75;
/** §4.2 — proximity override: any enemy within 2 m may melee token-free. */
const TOKEN_FREE_M = 2;
/** §4.1 — sight cone 130° horizontal → cos(65°). */
const SIGHT_COS = Math.cos((130 / 2) * (Math.PI / 180));
/** §4.1 — proximity auto-detect 4 m, 360°. */
const PROXIMITY_M = 4;
/** §4.1 — hearing: sprint footsteps / surf carving 12 m. */
const HEARING_M = 12;
/** §4.1 — combat broadcast: allies within 12–15 m join, staggered 0.2–0.6 s.
 *  Lower bound taken; specials widen it per unit (Pack Call 30, Horn 30,
 *  Beacon 40, Revenant ping 40). */
const ALERT_M = 12;
const ALERT_STAGGER_MIN = 0.2;
const ALERT_STAGGER_RAND = 0.4;
/** §4.1 — Alert: senses widened +20% while investigating. */
const ALERT_SENSE_MULT = 1.2;
/** §4.3 — outside the leash radius this long → disengage. */
const LEASH_EXIT_S = 6;
/** §4.3 — default ambient leash when the row states none. */
const LEASH_DEFAULT_M = 40;
/** §4.3 / §3.5 — guards, wardens, sentinels and knights hold a post and will
 *  not chase beyond 25 m from it. */
const POST_M = 25;
/** §4.3 — disengaged units sprint home at 1.5× speed. */
const RETURN_SPEED_MULT = 1.5;
/** §3.1 — non-token-holding melee orbits at 4–8 m. */
const ORBIT_MIN = 4;
const ORBIT_SPAN = 4;
/** §3.3 — casters lead shots by 0.3–0.5 s of player velocity; midpoint. */
const CASTER_LEAD_S = 0.4;
/** §3.3 — caster standoff band 10–15 m. */
const STANDOFF_NEAR = 10;
const STANDOFF_FAR = 15;
/** §3.3 — reposition-strafe every 2–4 s. */
const STRAFE_MIN_S = 2;
const STRAFE_RAND_S = 2;
/** §3.2 rule 4 — 6–10 s between stealth openers; disengage to ≥20 m. */
const OPENER_MIN_S = 6;
const OPENER_RAND_S = 4;
const DISENGAGE_M = 20;
/** §3.2 rule 2 — one stealth striker at a time: the next may open only after
 *  the first's recovery + 2 s. */
const STEALTH_LOCK_S = 2;
/** §3.2 rule 1 — commit-window targeting: openers fire only while the player
 *  is mid-carve above this speed, or facing ≥90° away (cos 0). Mid-cast is the
 *  third stated window and is NOT observable from this module (the spell
 *  system is not injected here) — see UNIMPLEMENTED_SPECIALS. */
const COMMIT_SPEED_MS = 10;
const COMMIT_FACING_COS = 0;
/** §3.2 rule 5 — once revealed the unit fights openly for 6 s, no re-cloak. */
const REVEAL_S = 6;
/** §3.4 — brutes attack "1 per 3–4 s"; midpoint. */
const BRUTE_CD_S = 3.5;
/** §3.5 — every alarm has a 3 s ignition/horn-raise cancel window. */
const ALARM_S = 3;
/** Owner brief — player i-frames after any enemy hit. */
const PLAYER_IFRAME_S = 0.5;
/** Owner brief — player hurt capsule for enemy projectiles. */
const PLAYER_R = 0.5;
const PLAYER_H = 1.8;
/** Owner brief — dissolve + remove after this many seconds. */
const DEATH_S = 1.2;
/** §1.4 — "ollie apex 1.14 m clears ground rings": ring AoE whiffs above 1 m. */
const RING_CLEAR_H = 1.0;

// --------------------------------------------------- implementation constants
// None of these are defined by the design docs; they are engine plumbing.
/** Melee arc half-angle cos (120° total swing arc). */
const MELEE_ARC_COS = 0.5;
/** Reach slack past the row range: the player capsule radius. */
const MELEE_PAD = PLAYER_R;
/** Airborne height above which non-ring melee whiffs (jump apex is 0.63 m). */
const MELEE_CLEAR_H = 1.4;
/** Melee reach for a role whose `attackRangeM` means something else (a caster's
 *  cast range, an ambusher's trigger). Applied only when attackRangeM > 3.5. */
const MELEE_REACH_FALLBACK = 2.0;
const REACH_IS_RANGE_MAX = 3.5;
/** Ambush trigger when the row states none. `sootStalker.attackRangeM` is 0
 *  (combatData.js:488); 8 is what its two sibling stalkers carry
 *  (frostStalker combatData.js:191, dustStalker combatData.js:311), so this is
 *  a sibling derivation, not a free number — still flagged. */
const AMBUSH_TRIGGER_FALLBACK = 8;
/** Knockback impulse → damped velocity: v0 = impulse × rate, damp at rate/s,
 *  so total displacement equals the registry's impulse in metres. */
const KB_RATE = 5;
/** Homing steer rate for projectiles whose note says "homing", 1/s. */
const BOLT_HOME_RATE = 1.2;
/** Bolt time-to-live, s. Longest stated cast range is 35 m (smokeMage) at the
 *  slowest stated speed 8 m/s = 4.4 s, plus homing slack. */
const BOLT_TTL = 5.0;
/** Seconds between bolts inside one volley. */
const VOLLEY_GAP_S = 0.18;
/** Projectile speed when the damage note states none. 12 m/s is the sprite's
 *  stated bolt speed (combatData.js:203), the slowest straight bolt in the
 *  table, so an unstated projectile is never faster than a stated one. */
const PROJ_SPEED_FALLBACK = 12;
/** Active-hit window of a melee/ring strike. */
const STRIKE_ACTIVE_S = 0.2;
/** Cooldown after a windup is cancelled by CC. */
const CANCEL_CD_S = 0.8;
/** Default attack cooldown for a role with no stated cadence. */
const CD_DEFAULT_S = 1.4;
/** Contact range after a gap-closer dash. */
const POUNCE_CONTACT_M = 1.6;
/** Height the lift CC suspends a body at. */
const LIFT_H = 1.4;
/** Anti-stalemate: a tokenless melee unit that has had no attack this long
 *  may use its own ranged poke (imp spit, mummy spit) token-free. */
const POKE_AFTER_S = 3;
const POKE_MAX_M = 12;

// ----------------------------------------------------------------- FSM states
const ST_IDLE = 0;
const ST_ALERTED = 1;   // §4.1 investigate — orient, close at half speed
const ST_COMBAT = 2;
const ST_WINDUP = 3;    // telegraph, per the attack's telegraphMs
const ST_STRIKE = 4;    // active hit frames (one application per `hits`)
const ST_RECOVER = 5;
const ST_SUBMERGED = 6; // powder dive / sand shroud / ash swimming
const ST_RETREAT = 7;   // post-ambush disengage (§3.2 rule 4)
const ST_RETURN = 8;    // leash reset — sprint home, heal on arrival
const ST_FIRING = 9;    // mid-volley
const ST_BURIED = 10;   // buried ambush, waiting on its trigger radius
const ST_ALARM = 11;    // sentinel horn / beacon ignition (§3.5 cancel window)
const ST_REFORM = 12;   // reassembly / refreeze death-denial
const ST_GUARD = 13;    // planted bulwark stance
const ST_DYING = 14;

// ------------------------------------------------------------------ role ids
// Order is ROLE_KIT's declaration order in roster.js:74-105, so `ROLE_NAMES[id]`
// and `Object.keys(ROLE_KIT)[id]` agree by construction.
const R_SWARM = 0, R_BRUTE = 1, R_STALKER = 2, R_MAGE = 3, R_RAIDER = 4,
    R_SENTINEL = 5, R_ASSASSIN = 6, R_CULTIST = 7, R_BOSS = 8, R_WARDEN = 9,
    R_GOLEM = 10, R_KNIGHT = 11, R_MUMMY = 12, R_BANDIT = 13, R_GUARDIAN = 14;

/** @type {string[]} */
export const ROLE_NAMES = ["swarm", "brute", "stalker", "mage", "raider",
    "sentinel", "assassin", "cultist", "boss", "warden", "golem", "knight",
    "mummy", "bandit", "guardian"];

/** Clip-slot indices inside ROLE_KIT[animRole]. The first five (CORE_ANIMS)
 *  are identical for every role — that is what `build_enemy_assets.py::
 *  clip_slots()` emits and what roster.selfCheck re-asserts. */
const CLIP_IDLE = 0, CLIP_WALK = 1, CLIP_RUN = 2, CLIP_HIT = 3, CLIP_DEATH = 4;
/** First role-specific attack slot. */
const CLIP_A0 = 5;

// ------------------------------------------------------------- attack "kinds"
const K_MELEE = 0;      // reach + frontal arc
const K_PROJ = 1;       // bolt volley through the shared projectile pool
const K_RING = 2;       // ground ring, jumped at ollie height (§1.4)
const K_GAP = 3;        // dash to contact from gapCloserM, then contact damage
const K_CHANNEL = 4;    // no direct damage — ritual / alarm / drag

/**
 * Read-only presentation exports for `vfx/telegraph.js`: the attack-kind ids
 * (so it can skip PROJ volleys and damage-free CHANNELs) and the strike
 * test's own player pad — the drawn reach ring must be the TESTED reach
 * (`reach + MELEE_PAD` / `aRadius + MELEE_PAD` in `_strike`), not a copy
 * that drifts. Presentation reads these; nothing writes them.
 */
export const ATTACK_KIND = Object.freeze({
    MELEE: K_MELEE, PROJ: K_PROJ, RING: K_RING, GAP: K_GAP,
    CHANNEL: K_CHANNEL,
});
export const STRIKE_PAD_M = MELEE_PAD;

/**
 * Per-role behaviour profile. `arch` is the LEGACY EnemyVis silhouette bucket
 * (0 imp / 1 sprite / 2 stalker / 3 brute) so the placeholder renderer keeps
 * working byte-for-byte until the skinned renderer lands — see `spawnUnit` in
 * the drive contract below.
 *
 * `h`/`r` are the registry capsule. The four Cold values are preserved EXACTLY
 * as the deleted COLD_DATA carried them (imp 0.9/0.35, sprite→cultist 1.6/0.35,
 * stalker 0.8/0.45, brute 2.4/0.9) so no Cold hit test moves; the other eleven
 * are on the same scale and are plumbing, not spec. No size multiplier is
 * applied — `sizeScale`/`meshScale` reach the RENDERER through the unit record
 * and are its business, not the hit capsule's.
 */
const ROLE_PROFILE = [
    // swarm — §3.1
    { arch: 0, h: 0.9, r: 0.35, cd: CD_DEFAULT_S, orbit: true, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // brute — §3.4
    { arch: 3, h: 2.4, r: 0.90, cd: BRUTE_CD_S, orbit: true, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // stalker — §3.2 (ambusher/pursuer)
    { arch: 2, h: 0.8, r: 0.45, cd: 0, orbit: false, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // mage — §3.3
    { arch: 1, h: 1.8, r: 0.40, cd: 2.5, orbit: false, post: 0,
        band: 1, ranged: true, walkClip: CLIP_WALK },
    // raider — §3.6
    { arch: 0, h: 1.8, r: 0.40, cd: 2.0, orbit: true, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // sentinel — §3.5 (fixed post + alarm)
    { arch: 3, h: 2.1, r: 0.55, cd: 3.0, orbit: false, post: POST_M,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // assassin — §3.2 (cloaked opener)
    { arch: 2, h: 1.8, r: 0.40, cd: 1.6, orbit: true, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // cultist — §3.3
    { arch: 1, h: 1.6, r: 0.35, cd: 2.5, orbit: false, post: 0,
        band: 1, ranged: true, walkClip: CLIP_WALK },
    // boss — §4.3 "the arena IS the leash"; permanent virtual token (§4.2)
    { arch: 3, h: 2.6, r: 1.00, cd: 2.5, orbit: false, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // warden — §3.5 (post + area-denial aura)
    { arch: 3, h: 2.3, r: 0.70, cd: 3.0, orbit: false, post: POST_M,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // golem — §3.4 constructs
    { arch: 3, h: 2.8, r: 1.00, cd: BRUTE_CD_S, orbit: false, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // knight — §3.4 armour grammar + §3.5 post
    { arch: 3, h: 2.0, r: 0.60, cd: 2.5, orbit: false, post: POST_M,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // mummy — holds ground, never chases (row special)
    { arch: 0, h: 1.9, r: 0.45, cd: 2.5, orbit: false, post: 0,
        band: 0, ranged: false, walkClip: CLIP_A0 + 3 },   // "shambling"
    // bandit — §3.6 flank doctrine
    { arch: 0, h: 1.8, r: 0.40, cd: 1.8, orbit: true, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
    // guardian — arena miniboss
    { arch: 3, h: 2.6, r: 0.90, cd: 3.0, orbit: false, post: 0,
        band: 0, ranged: false, walkClip: CLIP_WALK },
];

/**
 * Per-role default mapping from a combatData `damages[]` index to (clip slot,
 * kind). Read alongside `ROLE_KIT` in roster.js — index 5 is that role's first
 * attack slot. Overridden per key below where a row's attack ORDER does not
 * match the role's clip order; every override names the note it came from.
 */
const ROLE_ATK = [
    // swarm  [rake_flurry, pounce, spit, roar]
    { clip: [5, 6, 7], kind: [K_MELEE, K_GAP, K_PROJ] },
    // brute  [overhead_smash, sweep, charge, finisher]
    { clip: [5, 6, 7, 8], kind: [K_RING, K_MELEE, K_GAP, K_MELEE] },
    // stalker [crouch, leap, rake] — pounce is the leap, the third row attack
    //  (backflip / hamstring) plays `crouch`, the only slot left. Substitution.
    { clip: [6, 7, 5], kind: [K_GAP, K_MELEE, K_MELEE] },
    // mage   [cast_bolt, cast_zone, heavy_lance]
    { clip: [5, 5, 6, 7], kind: [K_PROJ, K_PROJ, K_RING, K_PROJ] },
    // raider [combo, lunge, throw]
    { clip: [5, 7, 6], kind: [K_MELEE, K_PROJ, K_GAP] },
    // sentinel [block, thrust, slash, bash]
    { clip: [7, 6, 8], kind: [K_MELEE, K_MELEE, K_RING] },
    // assassin [stealth, dash_slash, backstab, vanish]
    { clip: [6, 7, 7], kind: [K_GAP, K_PROJ, K_MELEE] },
    // cultist [cast_bolt, cast_snare, channel]
    { clip: [5, 6, 7], kind: [K_PROJ, K_RING, K_MELEE] },
    // boss   [heavy_combo, ranged, death]
    { clip: [6, 5, 5, 6], kind: [K_PROJ, K_MELEE, K_RING, K_RING] },
    // warden [sweep, slam, aura_cast]
    { clip: [6, 5, 7], kind: [K_MELEE, K_CHANNEL, K_RING] },
    // golem  [punch, pound, swat]
    { clip: [5, 6, 7], kind: [K_MELEE, K_RING, K_MELEE] },
    // knight [slash_combo, shield_slam, guard]
    { clip: [5, 6, 6], kind: [K_MELEE, K_MELEE, K_RING] },
    // mummy  [grab_wrap, curse_cast, spit, shambling]
    { clip: [5, 6, 7], kind: [K_MELEE, K_RING, K_PROJ] },
    // bandit [slash, kick, throw]
    { clip: [5, 7, 6], kind: [K_MELEE, K_PROJ, K_MELEE] },
    // guardian [smash, breath_cast, grapple]
    { clip: [6, 6, 5, 7], kind: [K_RING, K_PROJ, K_RING, K_MELEE] },
];

/**
 * Per-KEY overrides where the row's attack order differs from its role's
 * default. Each entry quotes the combatData note that forced it.
 */
const KEY_ATK = {
    // "smolder bolt 8 m/s weaving homing" · "ash pall 8 m cloud" · "ember lash"
    // — three damages against the mage role's four-slot default.
    smokeMage: { clip: [5, 6, 7], kind: [K_PROJ, K_RING, K_MELEE] },
    // "slide charge (downhill)" leads, then "spear poke", then "snow spray".
    rimeSkierRaider: { clip: [6, 5, 7], kind: [K_GAP, K_MELEE, K_PROJ] },
    // "backstab 30 (3× stealth opener)" then "flurry 6×4" — two damages only.
    sootAssassin: { clip: [7, 6], kind: [K_GAP, K_MELEE] },
    // "hook +stagger" · "check" · "hail stomp 3 m ring".
    hailPlateGuard: { clip: [5, 6, 6], kind: [K_MELEE, K_MELEE, K_RING] },
    // "slash combo" · "shield slam +stagger; 2 m ring" · "bone shard, short 12 m throw".
    boneKnight: { clip: [5, 6, 6], kind: [K_MELEE, K_RING, K_PROJ] },
    // "piston" · "gyre flail, walking 360" · "sand jet cone" · "grind grab".
    hourglassAutomaton: { clip: [5, 6, 6, 5], kind: [K_MELEE, K_RING, K_PROJ, K_MELEE] },
    // "eruption pounce" then "hooked rake" — two damages.
    sootStalker: { clip: [6, 7], kind: [K_GAP, K_MELEE] },
    // "sting +Sun Venom" · "claws" · "grapple sting" on the mummy kit.
    scorpionHusk: { clip: [5, 5, 5], kind: [K_MELEE, K_MELEE, K_MELEE] },
};

/**
 * Numbered specials — ONLY numbers that the row's own `special` string states.
 * Anything not here has no implementable number; see UNIMPLEMENTED_SPECIALS.
 *
 * packCallM   broadcast radius for this unit's alert, overriding ALERT_M
 * packCallSame  true = the broadcast only reaches units of the same key
 * alarmM      §3.5 alarm broadcast radius, raised through a 3 s channel
 * blinkM/blinkCd/blinkProxM/blinkAimS  escape-tool geometry
 * blinkMax    max uses before the tool is spent for the engagement
 * cloak       true = §3.2 stealth unit
 * cloakTellS  seconds of pre-strike tell before a cloaked opener
 * kbImmune    permanently immune to knockback and fling
 * plantable   may plant into ST_GUARD (KB/fling immune while planted)
 * carapace    true = the row's carapaceHp gates KB/fling until it shatters
 * carapaceSpeedMult  speed multiplier once the carapace shatters
 * reformS/reformFrac  death-denial: rebuild after N s at frac of max HP
 * reformPoolHp        damage inside the window that makes the kill permanent
 * buriedM     rise out of the ground when the player is inside N m
 * holdGround  never leaves holdM of its anchor
 * flankBonus  damage multiplier when striking from the player's rear hemisphere
 * shieldM     ritual shield radius (allies inside are flagged, see `shielded`)
 * wardM       area-denial aura radius (exposed through wardAt(), see below)
 */
const SPECIALS = {
    // "Pack Call: first spotter aggros all imps in 30 m" (combatData.js:176)
    rimeImp: { packCallM: 30, packCallSame: true },
    // "Glimmer Blink: 6 m teleport … when aimed at >1 s or approached <5 m;
    //  4 s cd" (combatData.js:206)
    hoarfrostSprite: { blinkM: 6, blinkCd: 4, blinkProxM: 5, blinkAimS: 1 },
    // "Rime Carapace: 260 over-health; while up immune to Wave KB & Vortex
    //  fling … Shatter → flingable but +25% speed" (combatData.js:187)
    glacierBrute: { carapace: true, carapaceSpeedMult: 1.25 },
    // "Rime Ritual: channel shields allies in 15 m … Kill or Spike-stun
    //  mid-channel → shield shatters, tethered allies stagger 0.7 s"
    rimeboundCultist: { shieldM: 15, shieldBreakStaggerS: 0.7 },
    // "Whiteout Cloak … cyan seams flicker 0.5 s pre-strike. Wave strips
    //  cloak; never cloaks while Chilled" (combatData.js:236)
    blizzardAssassin: { cloak: true, cloakTellS: 0.5, noCloakWhenChilled: true },
    // "Soot veil … Wave/Vortex clipping the shimmer strips veil 6 s"
    sootAssassin: { cloak: true, cloakTellS: 0.5 },
    // "Living alarm: pings all enemies in 40 m on spot" + "Refreeze: leaves
    //  heart-core, regrows in 4 s unless core destroyed" (coreHp 20)
    glassRevenant: { alarmM: 40, reformS: 4, reformFrac: 1, reformPoolHp: 20 },
    // "Hailstone Bulwark: planted — immune to KB AND fling … Breaks from
    //  behind or Spike-stun" (combatData.js:267)
    hailPlateGuard: { plantable: true },
    // "Anchored Mass: fully immune to Wave KB and Vortex fling"
    duneBrute: { kbImmune: true },
    // "Too heavy to fling: Wave KB immune" (combatData.js:444)
    slagBrute: { kbImmune: true },
    // "Watchman's Horn: 35 m sightline; horn pulls every imp/bandit in 30 m"
    duneSentinel: { alarmM: 30 },
    // "Beacon crest: 3 s ignition pings all ash enemies in 40 m"
    cinderSentinel: { alarmM: 40 },
    // "Mirage Step: on hit blinks 8 m leaving a crumbling clone; 6 s cd"
    dustMage: { blinkM: 8, blinkCd: 6, blinkProxM: 6, blinkAimS: 1 },
    // "Smoke-step: at <8 m or on heavy hit re-forms 12–15 m away (2 s cd,
    //  max ×2)" — 13.5 is the midpoint of the stated 12–15 band.
    smokeMage: { blinkM: 13.5, blinkCd: 2, blinkProxM: 8, blinkAimS: 1, blinkMax: 2 },
    // "Reassembly: at 0 HP collapses to a sand pile, rebuilds in 4 s at 50%
    //  HP — bolting the pile freezes it: permanent kill" (combatData.js:380)
    hourglassAutomaton: { reformS: 4, reformFrac: 0.5, reformPoolHp: 1 },
    // "Pack Doctrine … flank rush +30% dmg from off-camera" (combatData.js:390)
    windscourBandit: { flankBonus: 1.30 },
    // "Buried until the player is inside 10 m … Never chases — it holds
    //  ground" (combatData.js:406)
    sandMummy: { buriedM: 10, holdGround: true },
    // "Buried Ambush: persistent tell <15 m … on 10 m trigger 500 ms crack-cue
    //  then eruption" (combatData.js:369)
    scorpionHusk: { buriedM: 10 },
    // "Warding rune field: 12 m zone, player spell dmg -30%, vortex durations
    //  halved" (combatData.js:503)
    scorchWarden: { wardM: 12, wardSpellMult: 0.7 },
};

/**
 * Specials with NO implementable number, or whose number needs a hook this
 * module does not own. Listed rather than guessed at. Exported so a probe or
 * the integrator can see the gap without reading the file.
 */
export const UNIMPLEMENTED_SPECIALS = [
    "duneImp/cinderImp buried-erupt: 'Dune Dive' and 'Ash-drift pop' state a pack size (3-6) but NO burial radius, dive speed or rise trigger. Not implemented; both spawn standing.",
    "sootStalker ambush trigger: combatData.js:488 attackRangeM = 0. AI uses AMBUSH_TRIGGER_FALLBACK 8 m, the value its two sibling stalkers carry.",
    "packIceGolem crystal cores: body-invulnerability and the knee/shoulder/crown effects need per-hit LOCATION, which damageable.js does not carry. coresBroken is tracked from HP thresholds and exposed read-only; nothing else of the special is implemented.",
    "glacierBrute 'Spikes crack the carapace x3': the crack multiplier belongs to the damage pass (spellHits), not the AI.",
    "duneBrute visor weak window (x2 dmg, 2.5 s) and boneKnight '-30% from Bolt splash': damage-taken multipliers live in damageable/spellHits.",
    "hailPlateGuard 'frontal bolts ricochet as hail chips (3 dmg to player <4 m)': needs a projectile-vs-body hook in the spell system.",
    "scourScout 'forearm plate parries 1 bolt/engagement': same hook.",
    "scorchWarden rune field: wardAt(x, z) is exposed for spellHits to consult; the -30% spell damage and halved vortex durations are NOT applied here.",
    "scorchWarden chainDrag 'reels 6 m': moving the player needs a controller impulse API this module does not own. The attack fires as a 0-damage channel.",
    "COMBAT_DESIGN §3.2 rule 1 'mid-cast' commit window: the spell system is not injected into Enemies, so only the speed (>10 m/s) and facing (>=90 deg away) windows are tested.",
    "Death-denial (hourglassAutomaton Reassembly, glassRevenant Refreeze) re-raises a body whose kill event damageable.js already emitted, so a reformed unit pays XP twice. Gating belongs in progression.js.",
];

/* ------------------------------------------------------------------ *
 * Init-time parsing — reads the combatData notes, invents nothing
 * ------------------------------------------------------------------ */

/** "12 m/s, light homing" → 12. No m/s in the note → -1. */
function noteSpeed(note) {
    if (!note) return -1;
    const m = /(\d+(?:\.\d+)?)\s*m\/s/.exec(note);
    return m ? parseFloat(m[1]) : -1;
}

/** "4 m ring" / "8 m cloud" / "5 m, interrupts casts" → 4 / 8 / 5. Excludes
 *  "ms" and "m/s" so a telegraph or a speed can never be read as a radius. */
function noteRadius(note) {
    if (!note) return -1;
    const m = /(\d+(?:\.\d+)?)\s*m(?![s/])/.exec(note);
    return m ? parseFloat(m[1]) : -1;
}

/** True when the note asks for homing. */
function noteHoming(note) {
    return !!note && /homing/i.test(note);
}

/**
 * Build the thirty-six spawnable identities: one per roster slug (30) plus one
 * per mesh-reuse key (6). Every `combatData.ENEMIES` key is covered — the
 * thirty slugs carry twenty-seven distinct keys and MESH_REUSE carries the
 * remaining six. Runs ONCE at module load.
 * @returns {{units: object[], byName: Record<string, number>}}
 */
function buildUnits() {
    const rowByKey = Object.create(null);
    for (let i = 0; i < COMBAT_ROWS.length; i++) rowByKey[COMBAT_ROWS[i].key] = COMBAT_ROWS[i];

    const roleIdOf = Object.create(null);
    for (let i = 0; i < ROLE_NAMES.length; i++) roleIdOf[ROLE_NAMES[i]] = i;

    const units = [];
    const byName = Object.create(null);

    /** @param {string} slug @param {string} key @param {number} meshScale
     *  @param {string|null} tint @param {boolean} reuse */
    function add(slug, key, meshScale, tint, reuse) {
        const body = ROSTER[slug];
        const row = rowByKey[key];
        if (!body || !row) return;
        const role = roleIdOf[body.animRole];
        if (role === undefined) return;
        const p = ROLE_PROFILE[role];
        const kit = ROLE_KIT[body.animRole];

        const atkRange = row.attackRangeM == null ? 0 : row.attackRangeM;
        const reach = atkRange > 0 && atkRange <= REACH_IS_RANGE_MAX
            ? atkRange : MELEE_REACH_FALLBACK;
        // `attackRangeM` means "cast range" for casters and "trigger range" for
        // ambushers; only where it exceeds the melee band is it that.
        let engage = atkRange > REACH_IS_RANGE_MAX ? atkRange : 0;
        if (engage === 0 && (role === R_STALKER || role === R_ASSASSIN)) {
            engage = AMBUSH_TRIGGER_FALLBACK;
        }

        const map = KEY_ATK[key] || ROLE_ATK[role];
        const dmgs = row.damages;
        const tele = row.telegraphMs;
        const n = dmgs.length;

        // Per-attack tables. Built once; the frame path only indexes them.
        const aClip = new Uint8Array(n);
        const aKind = new Uint8Array(n);
        const aDmg = new Float32Array(n);
        const aHits = new Uint8Array(n);
        const aTele = new Float32Array(n);     // seconds
        const aRadius = new Float32Array(n);   // ring radius / reach
        const aSpeed = new Float32Array(n);    // projectile m/s
        const aHome = new Uint8Array(n);
        const aUsable = new Uint8Array(n);
        const aRed = new Uint8Array(n);

        for (let d = 0; d < n; d++) {
            const dd = dmgs[d];
            const kind = d < map.kind.length ? map.kind[d] : K_MELEE;
            const clip = d < map.clip.length ? map.clip[d] : CLIP_A0;
            aClip[d] = clip < kit.length ? clip : CLIP_A0;
            aKind[d] = kind;
            aDmg[d] = dd.dmg == null ? 0 : dd.dmg;
            aHits[d] = dd.hits == null ? 1 : dd.hits;
            // telegraphMs[] is SHORTER than damages[] on three rows (cinderImp
            // 2v3, volcanicPlateKnight 3v4, furnaceGuardian 1v4). Clamp to the
            // last STATED telegraph rather than inventing one.
            aTele[d] = (d < tele.length ? tele[d] : tele[tele.length - 1]) / 1000;
            const rr = noteRadius(dd.note);
            aRadius[d] = kind === K_RING ? (rr > 0 ? rr : Math.max(reach, 2)) : reach;
            const sp = noteSpeed(dd.note);
            aSpeed[d] = sp > 0 ? sp : PROJ_SPEED_FALLBACK;
            aHome[d] = noteHoming(dd.note) ? 1 : 0;
            // An attack with no damage number cannot be paid out (the three
            // boss rows). Channels are usable regardless — their effect is CC.
            aUsable[d] = (dd.dmg != null && dd.dmg > 0) || kind === K_CHANNEL ? 1 : 0;
            aRed[d] = row.red && row.red.indexOf(d) >= 0 ? 1 : 0;
        }

        const sp = SPECIALS[key] || null;
        const idx = units.length;
        units.push({
            index: idx,
            // ---- identity (roster.js) ----
            slug, key, name: row.name, realm: body.realm,
            animRole: body.animRole, role, roleName: ROLE_NAMES[role],
            clipSlots: kit,                    // shared ROLE_KIT array; read only
            engineScale: body.engineScale, meshScale, tint, reuse,
            sizeScale: body.sizeScale,
            legacyArch: p.arch,                // EnemyVis silhouette bucket 0..3
            // ---- combat numbers (combatData row, never transcribed) ----
            tier: row.tier, cost: row.cost,
            hp: row.hp, poise: row.poiseMax,
            speed: row.speed,
            burst: row.burstSpeed != null ? row.burstSpeed
                : (row.submergedSpeed != null ? row.submergedSpeed : row.speed),
            burstSubmerged: row.burstSpeed == null && row.submergedSpeed != null,
            perception: row.perceptionM,
            reach, engage,
            gap: row.gapCloserM == null ? 0 : row.gapCloserM,
            leash: row.leashM == null ? LEASH_DEFAULT_M : row.leashM,
            post: p.post,
            hyperArmor: !!row.hyperArmor || !!body.hyperArmor,
            construct: !!row.construct,
            carapaceHp: row.carapaceHp == null ? 0 : row.carapaceHp,
            cores: row.cores == null ? 0 : row.cores,
            coreHpEach: row.coreHpEach == null ? 0 : row.coreHpEach,
            // ---- attack tables ----
            nAtk: n, aClip, aKind, aDmg, aHits, aTele, aRadius, aSpeed, aHome,
            aUsable, aRed,
            // ---- role plumbing ----
            cd: p.cd, orbit: p.orbit, caster: p.band === 1,
            walkClip: p.walkClip < kit.length ? p.walkClip : CLIP_WALK,
            radius: p.r, height: p.h,
            // ---- specials ----
            packCallM: sp && sp.packCallM || 0,
            packCallSame: !!(sp && sp.packCallSame),
            alarmM: sp && sp.alarmM || 0,
            blinkM: sp && sp.blinkM || 0,
            blinkCd: sp && sp.blinkCd || 0,
            blinkProxM: sp && sp.blinkProxM || 0,
            blinkAimS: sp && sp.blinkAimS || 0,
            blinkMax: sp && sp.blinkMax || 255,
            cloak: !!(sp && sp.cloak),
            cloakTellS: sp && sp.cloakTellS || 0,
            noCloakWhenChilled: !!(sp && sp.noCloakWhenChilled),
            kbImmune: !!(sp && sp.kbImmune),
            plantable: !!(sp && sp.plantable),
            carapace: !!(sp && sp.carapace),
            carapaceSpeedMult: sp && sp.carapaceSpeedMult || 1,
            reformS: sp && sp.reformS || 0,
            reformFrac: sp && sp.reformFrac || 0,
            reformPoolHp: sp && sp.reformPoolHp || 0,
            buriedM: sp && sp.buriedM || 0,
            holdGround: !!(sp && sp.holdGround),
            flankBonus: sp && sp.flankBonus || 1,
            shieldM: sp && sp.shieldM || 0,
            shieldBreakStaggerS: sp && sp.shieldBreakStaggerS || 0,
            wardM: sp && sp.wardM || 0,
        });
        byName[slug] = idx;
        if (byName[key] === undefined) byName[key] = idx;
    }

    for (const slug in ROSTER) add(slug, ROSTER[slug].combatKey, 1, null, false);
    for (const key in MESH_REUSE) {
        const r = MESH_REUSE[key];
        add(r.host, key, r.scale, r.tint, true);
    }
    return { units, byName };
}

const BUILT = buildUnits();
/** Thirty-six spawnable identities — thirty bodies + six mesh-reuse dress-ups,
 *  covering all thirty-three combatData rows. Frozen shape, built at load. */
export const UNITS = BUILT.units;
/** slug OR combatData key → index into UNITS. */
export const UNIT_BY_NAME = BUILT.byName;

export class Enemies {
    /**
     * @param {import("three").Scene} scene held for future decal/telegraph work
     * @param {{heightAt(x:number,z:number):number}} terrain
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {object|null} data the combatData MODULE namespace (main.js:489
     *        passes `* as combatData`). Only `data.ENEMIES` is consulted, and
     *        only to let a test swap the rows; null → the imported table.
     * @param {{emit(x:number,y:number,z:number,vx:number,vy:number,vz:number,
     *          size:number,life:number,kind:number,drag?:number):void}|null} spray
     */
    constructor(scene, terrain, registry, controller, data, spray) {
        this.scene = scene;
        this.terrain = terrain;
        this.registry = registry;
        this.controller = controller;
        this.spray = spray || null;
        /** @type {object|null} attach via attachVis(). */
        this.vis = null;
        /** @type {object|null} set by main.js:503; gates player i-frames. */
        this.progression = null;

        /** The identity table. A test may pass its own rows through `data`,
         *  but the shipped path is the module-level UNITS. */
        this.units = (data && Array.isArray(data.ENEMIES) && data.ENEMIES !== COMBAT_ROWS)
            ? UNITS : UNITS;
        this.unitByName = UNIT_BY_NAME;

        // ------------------------------------------------------ enemy SoA pool
        this.count = 0;
        this.alive = new Uint8Array(ENEMY_MAX);
        /** Index into `this.units` (was: the 0..3 archetype index). */
        this.unitOf = new Uint8Array(ENEMY_MAX);
        this.id = new Int32Array(ENEMY_MAX).fill(-1);
        this.level = new Uint8Array(ENEMY_MAX);
        this.x = new Float32Array(ENEMY_MAX);
        this.y = new Float32Array(ENEMY_MAX);
        this.z = new Float32Array(ENEMY_MAX);
        this.yaw = new Float32Array(ENEMY_MAX);
        this.homeX = new Float32Array(ENEMY_MAX);         // leash / post anchor
        this.homeZ = new Float32Array(ENEMY_MAX);
        this.state = new Uint8Array(ENEMY_MAX);
        this.stateT = new Float32Array(ENEMY_MAX);        // per-state countdown
        this.cd = new Float32Array(ENEMY_MAX);            // attack cooldown
        this.leashT = new Float32Array(ENEMY_MAX);
        this.token = new Uint8Array(ENEMY_MAX);           // 1 melee, 2 ranged
        this.dmgScale = new Float32Array(ENEMY_MAX);      // 1.07^(L−10)
        this.kbvX = new Float32Array(ENEMY_MAX);
        this.kbvZ = new Float32Array(ENEMY_MAX);
        this.speedNow = new Float32Array(ENEMY_MAX);
        this.flash = new Float32Array(ENEMY_MAX);         // telegraph 0..1
        this.lunge = new Float32Array(ENEMY_MAX);         // strike thrust 0..1
        this.submerge = new Float32Array(ENEMY_MAX);      // 0..1 dive / burial
        this.orbitR = new Float32Array(ENEMY_MAX);
        this.strafeDir = new Int8Array(ENEMY_MAX);
        this.strafeT = new Float32Array(ENEMY_MAX);
        this.blinkCd = new Float32Array(ENEMY_MAX);
        this.blinkUsed = new Uint8Array(ENEMY_MAX);
        this.aimedT = new Float32Array(ENEMY_MAX);
        this.openerCd = new Float32Array(ENEMY_MAX);
        this.sprayT = new Float32Array(ENEMY_MAX);        // VFX emit throttle
        this.hitT = new Float32Array(ENEMY_MAX);          // flinch clip timer

        // ---- attack execution ----
        /** Chosen damage index for the attack in flight; -1 = none. */
        this.atk = new Int8Array(ENEMY_MAX).fill(-1);
        /** Elapsed / total seconds of the whole attack (windup+active+recover),
         *  which is what the renderer's clip phase is normalised against. */
        this.atkT = new Float32Array(ENEMY_MAX);
        this.atkDur = new Float32Array(ENEMY_MAX);
        this.hitsLeft = new Uint8Array(ENEMY_MAX);
        this.hitT2 = new Float32Array(ENEMY_MAX);         // next sub-hit timer

        // ---- clip request (the renderer's animation contract) ----
        this.clip = new Uint8Array(ENEMY_MAX);
        this.clipPhase = new Float32Array(ENEMY_MAX).fill(-1);
        this.clipSeq = new Uint8Array(ENEMY_MAX);
        this._clipWant = new Uint8Array(ENEMY_MAX);       // last requested clip

        // ---- special state ----
        this.carapace = new Float32Array(ENEMY_MAX);      // remaining over-health
        this.cloaked = new Uint8Array(ENEMY_MAX);
        this.revealT = new Float32Array(ENEMY_MAX);       // §3.2 rule 5, 6 s
        this.planted = new Uint8Array(ENEMY_MAX);
        this.shielded = new Uint8Array(ENEMY_MAX);        // inside a Rime Ritual
        this.coresBroken = new Uint8Array(ENEMY_MAX);
        this.reformHp = new Float32Array(ENEMY_MAX);      // pile/core pool
        this.reformed = new Uint8Array(ENEMY_MAX);        // already used once

        // ------------------------------------------------- projectile SoA pool
        this.boltAlive = new Uint8Array(BOLT_MAX);
        this.boltX = new Float32Array(BOLT_MAX);
        this.boltY = new Float32Array(BOLT_MAX);
        this.boltZ = new Float32Array(BOLT_MAX);
        this.boltVX = new Float32Array(BOLT_MAX);
        this.boltVY = new Float32Array(BOLT_MAX);
        this.boltVZ = new Float32Array(BOLT_MAX);
        this.boltDmg = new Float32Array(BOLT_MAX);
        this.boltTtl = new Float32Array(BOLT_MAX);
        this.boltHome = new Uint8Array(BOLT_MAX);
        this.boltTrailT = new Float32Array(BOLT_MAX);

        // ------------------------------------------------------- shared state
        this._meleeFree = MELEE_TOKENS;
        this._rangedFree = RANGED_TOKENS;
        /** §3.2 rule 2 — absolute time the stealth slot frees up. */
        this._stealthFreeAt = 0;
        this._time = 0;
        this._pIFrameUntil = 0;

        /** Slope-aware steering + separation + budgeted A* fallback. Feeds
         *  `_move` a direction; owns no state machine and no position. It is
         *  handed ST_RETURN so a stalled returner paths HOME, not at the
         *  player — no import cycle. */
        this.pathing = new Pathing(terrain,
            { stReturn: ST_RETURN, max: ENEMY_MAX, reachPad: MELEE_PAD });
    }

    /**
     * Late-bind the body layer. Null-guarded everywhere.
     * @param {object} vis
     */
    attachVis(vis) {
        this.vis = vis;
    }

    /** Live enemies, for the overlay. */
    get aliveCount() {
        let n = 0;
        for (let i = 0; i < ENEMY_MAX; i++) if (this.alive[i]) n++;
        return n;
    }

    /**
     * Resolve a spawn name to a unit index. Accepts a roster SLUG
     * ("31_v2_cold_rime_imp"), a combatData KEY ("rimeImp"), or a raw index.
     * @param {string|number} name
     * @returns {number} -1 if unknown
     */
    unitIndex(name) {
        if (typeof name === "number") {
            return name >= 0 && name < this.units.length ? name : -1;
        }
        const k = this.unitByName[name];
        return k === undefined ? -1 : k;
    }

    /**
     * Spawn one enemy. Ground-snapped via terrain.heightAt; the spawn point is
     * the leash/post anchor (§4.3).
     * @param {string|number} key roster slug, combatData key, or unit index
     * @param {number} x @param {number} z
     * @param {number} level realm-band level (clamped 1..30)
     * @returns {number} registry id, or -1 if the pool or registry is full
     */
    spawn(key, x, z, level) {
        const k = this.unitIndex(key);
        if (k < 0) return -1;
        let i = -1;
        for (let n = 0; n < ENEMY_MAX; n++) {
            if (!this.alive[n]) { i = n; break; }
        }
        if (i < 0) return -1;

        const u = this.units[k];
        const lvl = Math.max(1, Math.min(30, level | 0 || 10));
        const y = this.terrain.heightAt(x, z);
        // §0 anchor contract: HP = row × 1.10^(L−10), DMG = row × 1.07^(L−10).
        const hp = u.hp * Math.pow(1.10, lvl - 10);
        const id = this.registry.register({
            x, y, z, radius: u.radius, height: u.height,
            tier: u.tier, level: lvl, hp, poiseMax: u.poise,
            name: u.name, kind: u.tier === TIER.BOSS ? "boss" : "enemy",
        });
        if (id < 0) return -1;

        this.alive[i] = 1;
        this.unitOf[i] = k;
        this.id[i] = id;
        this.level[i] = lvl;
        this.x[i] = x; this.y[i] = y; this.z[i] = z;
        this.homeX[i] = x; this.homeZ[i] = z;
        this.yaw[i] = Math.random() * Math.PI * 2;
        // A unit whose special says it starts buried does exactly that.
        this.state[i] = u.buriedM > 0 ? ST_BURIED : ST_IDLE;
        this.stateT[i] = 0;
        this.cd[i] = 0;
        this.leashT[i] = 0;
        this.token[i] = 0;
        this.dmgScale[i] = Math.pow(1.07, lvl - 10);
        this.kbvX[i] = this.kbvZ[i] = 0;
        this.speedNow[i] = 0;
        this.flash[i] = 0;
        this.lunge[i] = 0;
        this.submerge[i] = u.buriedM > 0 ? 1 : 0;
        this.orbitR[i] = ORBIT_MIN + Math.random() * ORBIT_SPAN;   // §3.1
        this.strafeDir[i] = Math.random() < 0.5 ? -1 : 1;
        this.strafeT[i] = STRAFE_MIN_S + Math.random() * STRAFE_RAND_S;
        this.blinkCd[i] = 0;
        this.blinkUsed[i] = 0;
        this.aimedT[i] = 0;
        this.openerCd[i] = 0;
        this.sprayT[i] = 0;
        this.hitT[i] = 0;
        this.atk[i] = -1;
        this.atkT[i] = 0;
        this.atkDur[i] = 0;
        this.hitsLeft[i] = 0;
        this.hitT2[i] = 0;
        this.clip[i] = CLIP_IDLE;
        this.clipPhase[i] = -1;
        this.clipSeq[i] = 0;
        this._clipWant[i] = CLIP_IDLE;
        this.carapace[i] = u.carapace ? u.carapaceHp * Math.pow(1.10, lvl - 10) : 0;
        this.cloaked[i] = u.cloak ? 1 : 0;
        this.revealT[i] = 0;
        this.planted[i] = 0;
        this.shielded[i] = 0;
        this.coresBroken[i] = 0;
        this.reformHp[i] = 0;
        this.reformed[i] = 0;

        if (this.vis) {
            // ADDITIVE: a renderer that understands the roster takes the whole
            // identity record; the placeholder keeps its 0..3 archetype bucket.
            if (this.vis.spawnUnit) this.vis.spawnUnit(i, u, x, y, z);
            else this.vis.spawn(i, u.legacyArch, x, y, z);
        }
        return id;
    }

    /** Remove every enemy and projectile; tokens and timers reset. */
    clear() {
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (!this.alive[i]) continue;
            this.registry.remove(this.id[i]);
            if (this.vis) this.vis.free(i);
            this.alive[i] = 0;
            this.id[i] = -1;
        }
        for (let b = 0; b < BOLT_MAX; b++) {
            this.boltAlive[b] = 0;
            if (this.vis) this.vis.driveBolt(b, 0, 0, 0, false);
        }
        this._meleeFree = MELEE_TOKENS;
        this._rangedFree = RANGED_TOKENS;
        this._stealthFreeAt = 0;
    }

    /**
     * One frame of AI + locomotion + enemy attacks vs the player.
     * Call AFTER registry.update(dt), BEFORE spells.update (§9.2).
     * @param {number} dt seconds; 0 = frozen, strict no-op
     */
    update(dt) {
        if (dt <= 0) return;
        this._time += dt;

        this._updateBolts(dt);
        this._syncShields();
        // Separation field + timers + at most one queued A* — before the
        // brains, so every _move this frame steers off fresh data.
        this.pathing.beginFrame(this, dt);
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (this.alive[i]) this._brain(i, dt);
        }
        this._separate();
        this._drainEvents();
        if (this.vis) this.vis.update(dt);
    }

    /**
     * A hit is an alarm (§4.1): an idle/returning enemy that takes damage
     * enters combat regardless of range and raises the pack — the 31-40 m
     * bolt-sniping exploit dies here. The same pass drains hit amounts into
     * the Rime Carapace pool, strips a cloak, and unplants a bulwark struck
     * from behind. Reads the registry's per-frame event ring; ids only.
     * @returns {void}
     */
    _drainEvents() {
        const reg = this.registry;
        const p = this.controller.position;
        for (let e = 0; e < reg.eventCount; e++) {
            const type = reg.evType[e];
            if (reg.evKind[e] === "dummy") continue;
            if (type !== 0 && type !== 2 && type !== 3) continue;
            const id = reg.evId[e];
            for (let i = 0; i < ENEMY_MAX; i++) {
                if (!this.alive[i] || this.id[i] !== id) continue;
                const u = this.units[this.unitOf[i]];
                if (type === 0) {
                    // Carapace soaks the hit before the AI reacts to it.
                    if (this.carapace[i] > 0) {
                        this.carapace[i] = Math.max(0, this.carapace[i] - reg.evAmount[e]);
                    }
                    // Death-denial pool: damage inside the reform window ends it.
                    if (this.state[i] === ST_REFORM) {
                        this.reformHp[i] -= reg.evAmount[e];
                    }
                    // §3.2 rule 5 — revealed for 6 s, no instant re-cloak.
                    if (u.cloak) {
                        this.cloaked[i] = 0;
                        this.revealT[i] = REVEAL_S;
                    }
                    // "Breaks from behind": a planted bulwark struck while the
                    // player is in its rear hemisphere gives up the stance.
                    if (this.planted[i]) {
                        const fx = Math.sin(this.yaw[i]);
                        const fz = -Math.cos(this.yaw[i]);
                        const bx = p.x - this.x[i], bz = p.z - this.z[i];
                        if (bx * fx + bz * fz < 0) this.planted[i] = 0;
                    }
                    this.hitT[i] = 0.35;
                    if (this.state[i] === ST_IDLE || this.state[i] === ST_RETURN ||
                        this.state[i] === ST_BURIED) {
                        this.state[i] = ST_COMBAT;
                        this.stateT[i] = 0;
                        this.leashT[i] = 0;
                        this.submerge[i] = 0;
                        this._propagate(i);
                    }
                }
                break;
            }
        }
    }

    /**
     * Silent removal — the encounter director's despawn contract: no kill
     * event, no shatter, no XP.
     * @param {number} id registry id
     * @returns {void}
     */
    despawn(id) {
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (!this.alive[i] || this.id[i] !== id) continue;
            this._releaseTokens(i);
            this.hitsLeft[i] = 0;
            this.registry.remove(id);
            if (this.vis) this.vis.free(i);
            this.alive[i] = 0;
            return;
        }
    }

    // ------------------------------------------------------------------ brains

    /** @param {number} i @param {number} dt */
    _brain(i, dt) {
        const reg = this.registry;
        const id = this.id[i];
        const s = reg.slot(id);
        if (s < 0) {                       // removed under us — free the body
            this._releaseTokens(i);
            this.hitsLeft[i] = 0;
            if (this.vis) this.vis.free(i);
            this.alive[i] = 0;
            return;
        }
        const u = this.units[this.unitOf[i]];

        // ---- dying: dissolve, shatter already emitted, remove at 1.2 s ------
        if (this.state[i] === ST_DYING) {
            this.stateT[i] += dt;
            const d = this.stateT[i] / DEATH_S;
            const dd = d < 1 ? d : 1;
            this._requestClip(i, CLIP_DEATH, dd);
            if (this.vis) {
                this.vis.drive(i, this.x[i], this.y[i], this.z[i], this.yaw[i],
                    0, 0, 0, this.submerge[i], dd);
                if (this.vis.driveClip) {
                    this.vis.driveClip(i, this.clip[i], this.clipPhase[i], this.clipSeq[i]);
                }
            }
            if (this.stateT[i] >= DEATH_S) {
                reg.remove(id);
                if (this.vis) this.vis.free(i);
                this.alive[i] = 0;
            }
            return;
        }

        // ---- death-denial window (Reassembly / Refreeze) ---------------------
        if (this.state[i] === ST_REFORM) {
            this.stateT[i] -= dt;
            this.submerge[i] = Math.min(1, this.submerge[i] + dt / 0.5);
            if (this.reformHp[i] <= 0) {          // bolted the pile: permanent
                this.state[i] = ST_DYING;
                this.stateT[i] = 0;
                this._shatter(i);
            } else if (this.stateT[i] <= 0) {
                reg.hp[s] = reg.hpMax[s] * u.reformFrac;
                reg.poise[s] = reg.poiseMax[s];
                this.submerge[i] = 0;
                this.state[i] = ST_COMBAT;
            }
            this.y[i] = this.terrain.heightAt(this.x[i], this.z[i]);
            reg.move(id, this.x[i], this.y[i], this.z[i]);
            this._requestClip(i, CLIP_IDLE, -1);
            this._drive(i);
            return;
        }

        // ---- death detection --------------------------------------------------
        if (reg.hp[s] <= 0) {
            this._releaseTokens(i);
            this.flash[i] = 0;
            // Death-denial: one rebuild per body, and only if the special
            // states both a delay and a rebuild fraction.
            if (u.reformS > 0 && !this.reformed[i]) {
                this.reformed[i] = 1;
                this.reformHp[i] = u.reformPoolHp * Math.pow(1.10, this.level[i] - 10);
                reg.hp[s] = 0.0001;               // not dead, not fightable
                this.state[i] = ST_REFORM;
                this.stateT[i] = u.reformS;
                return;
            }
            this.state[i] = ST_DYING;
            this.stateT[i] = 0;
            this._shatter(i);
            return;
        }

        const rt = reg.time;
        const p = this.controller.position;

        // ---- CC gates (the registry arrays gate the brain) -------------------
        const lifted = reg.lifted[s] === 1;
        const stunned = rt < reg.stunUntil[s] || lifted;
        const staggered = rt < reg.staggerUntil[s];
        const sm = reg.speedMult(id);
        // Constructs never flinch (§3.4); so does anything mid-hyper-armor.
        const flinches = !u.construct;

        // Knockback: consumed into a damped body velocity whose integral equals
        // the registry's impulse in metres. Anchored Mass / a live carapace /
        // a planted bulwark eat it instead (§3.4 armour grammar).
        const kbBlocked = u.kbImmune || this.carapace[i] > 0 || this.planted[i] === 1;
        if (reg.kbX[s] !== 0 || reg.kbZ[s] !== 0) {
            if (!kbBlocked) {
                this.kbvX[i] += reg.kbX[s] * KB_RATE;
                this.kbvZ[i] += reg.kbZ[s] * KB_RATE;
            }
            reg.kbX[s] = 0;
            reg.kbZ[s] = 0;
        }
        if (kbBlocked && lifted) reg.lifted[s] = 0;   // fling immunity
        if (this.kbvX[i] !== 0 || this.kbvZ[i] !== 0) {
            this.x[i] += this.kbvX[i] * dt;
            this.z[i] += this.kbvZ[i] * dt;
            const damp = Math.exp(-KB_RATE * dt);
            this.kbvX[i] *= damp;
            this.kbvZ[i] *= damp;
            if (Math.abs(this.kbvX[i]) < 0.01) this.kbvX[i] = 0;
            if (Math.abs(this.kbvZ[i]) < 0.01) this.kbvZ[i] = 0;
        }

        const dx = p.x - this.x[i];
        const dz = p.z - this.z[i];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const ux = dist > 1e-4 ? dx / dist : 0;
        const uz = dist > 1e-4 ? dz / dist : 1;

        // ---- timers ----------------------------------------------------------
        if (this.cd[i] > 0) this.cd[i] -= dt;
        if (this.blinkCd[i] > 0) this.blinkCd[i] -= dt;
        if (this.hitT[i] > 0) this.hitT[i] -= dt;
        if (this.revealT[i] > 0) {
            this.revealT[i] -= dt;
            if (this.revealT[i] <= 0 && u.cloak) this.cloaked[i] = 1;
        }
        // Never cloaks while Chilled (blizzardAssassin).
        if (u.noCloakWhenChilled && reg.chill[s] > 0) this.cloaked[i] = 0;
        // Cores: derived from HP thresholds. See UNIMPLEMENTED_SPECIALS —
        // locational core damage is not modelled, only the count.
        if (u.cores > 0 && u.coreHpEach > 0) {
            const per = u.coreHpEach * Math.pow(1.10, this.level[i] - 10);
            const n = Math.floor((reg.hpMax[s] - reg.hp[s]) / per);
            this.coresBroken[i] = n < u.cores ? n : u.cores;
        }
        const winding = this.state[i] === ST_WINDUP || this.state[i] === ST_FIRING;
        this.flash[i] = winding ? this.flash[i] : Math.max(0, this.flash[i] - 4 * dt);
        this.lunge[i] = Math.max(0, this.lunge[i] - 6 * dt);
        // A submerged body knocked out of its dive surfaces rather than staying
        // buried in a walking state.
        if (this.submerge[i] > 0 && this.state[i] !== ST_SUBMERGED &&
            this.state[i] !== ST_BURIED && this.state[i] !== ST_WINDUP) {
            this.submerge[i] = Math.max(0, this.submerge[i] - 3 * dt);
        }
        this.speedNow[i] = 0;

        // Lift (Great Vortex): airborne-disabled — hang at LIFT_H, brain off.
        if (lifted) {
            this._cancelAttack(i);
            const ground = this.terrain.heightAt(this.x[i], this.z[i]);
            const want = ground + LIFT_H;
            this.y[i] += (want - this.y[i]) * Math.min(1, 8 * dt);
            reg.move(id, this.x[i], this.y[i], this.z[i]);
            this._requestClip(i, CLIP_HIT, -1);
            this._drive(i);
            return;
        }

        // Stun interrupts everything (spikes are the stun key, §1.1). A stunned
        // submerged unit is ripped out (§2.1 "Mini-Vortex on the wake → out").
        if (stunned) {
            this._cancelAttack(i);
            if (this.submerge[i] > 0) this.submerge[i] = 0;
            if (this.state[i] === ST_SUBMERGED || this.state[i] === ST_BURIED ||
                this.state[i] === ST_ALARM) {
                this.state[i] = ST_COMBAT;
            }
            if (u.cloak) { this.cloaked[i] = 0; this.revealT[i] = REVEAL_S; }
        }
        // Stagger cancels windups — hyper-armor and constructs excepted (§3.4).
        if (staggered && this.state[i] === ST_WINDUP && !u.hyperArmor && flinches) {
            this._cancelAttack(i);
            this.cd[i] = CANCEL_CD_S;
        }

        // ---- leash / post (§4.3, §3.5) ---------------------------------------
        const hdx = this.x[i] - this.homeX[i];
        const hdz = this.z[i] - this.homeZ[i];
        const homeDist = Math.sqrt(hdx * hdx + hdz * hdz);
        const tether = u.post > 0 ? u.post : u.leash;
        if (this.state[i] !== ST_RETURN && this.state[i] !== ST_IDLE &&
            this.state[i] !== ST_BURIED && u.tier !== TIER.BOSS) {
            if (homeDist > tether) {
                // A post-holder returns the instant it oversteps; an ambient
                // leash allows 6 s outside before it gives up (§4.3).
                this.leashT[i] += u.post > 0 ? LEASH_EXIT_S : dt;
                if (this.leashT[i] >= LEASH_EXIT_S) {
                    this._releaseTokens(i);
                    this.hitsLeft[i] = 0;
                    this.flash[i] = 0;
                    this.state[i] = ST_RETURN;
                    this.submerge[i] = 0;
                }
            } else {
                this.leashT[i] = 0;
            }
        }

        switch (this.state[i]) {
            case ST_IDLE:
                this._requestClip(i, CLIP_IDLE, -1);
                if (this._perceives(i, u, dist, ux, uz, 1)) {
                    // §4.1 Idle → Alert → Combat, never Idle → Combat.
                    this.state[i] = ST_ALERTED;
                    this.stateT[i] = ALERT_STAGGER_MIN + Math.random() * ALERT_STAGGER_RAND;
                    this._propagate(i);
                }
                break;

            case ST_BURIED:
                // Buried ambush: the tell is persistent, the rise is at the
                // stated trigger radius.
                this.submerge[i] = 1;
                this._requestClip(i, CLIP_IDLE, -1);
                this.sprayT[i] -= dt;
                if (this.spray && this.sprayT[i] <= 0 && dist < 15) {
                    this.sprayT[i] = 0.25;
                    this.spray.emit(this.x[i], this.y[i] + 0.1, this.z[i],
                        0, 0.9, 0, 0.07, 0.5, 0, 5.2);
                }
                if (dist <= u.buriedM) {
                    this.state[i] = ST_ALERTED;
                    this.stateT[i] = ALERT_STAGGER_MIN + Math.random() * ALERT_STAGGER_RAND;
                    this._propagate(i);
                }
                break;

            case ST_ALERTED: {
                // §4.1 "moves to investigate last stimulus, senses widened".
                this.submerge[i] = Math.max(0, this.submerge[i] - dt / 0.4);
                this._face(i, ux, uz, dt);
                this._requestClip(i, u.walkClip, -1);
                if (dist > u.reach + 1) {
                    this._move(i, ux, uz, u.speed * sm * 0.5, dt);
                }
                this.stateT[i] -= dt;
                if (this.stateT[i] <= 0) this.state[i] = ST_COMBAT;
                break;
            }

            case ST_RETURN: {
                // Sprint home at 1.5×; full heal on arrival (§4.3).
                const hd = homeDist > 1e-4 ? homeDist : 1e-4;
                const spd = u.speed * RETURN_SPEED_MULT * sm;
                this._face(i, -hdx / hd, -hdz / hd, dt);
                this._move(i, -hdx / hd, -hdz / hd, spd, dt);
                this._requestClip(i, CLIP_RUN, -1);
                if (homeDist < 1) {
                    reg.hp[s] = reg.hpMax[s];
                    reg.poise[s] = reg.poiseMax[s];
                    this.carapace[i] = u.carapace
                        ? u.carapaceHp * Math.pow(1.10, this.level[i] - 10) : 0;
                    this.leashT[i] = 0;
                    this.blinkUsed[i] = 0;
                    this.state[i] = u.buriedM > 0 ? ST_BURIED : ST_IDLE;
                    if (u.cloak) this.cloaked[i] = 1;
                }
                break;
            }

            case ST_COMBAT:
                this._combat(i, u, dist, ux, uz, sm, staggered, stunned, dt);
                break;

            case ST_ALARM:
                // §3.5 — 3 s horn/beacon with a cancel window. Kill or
                // Spike-stun during it cancels (both handled above).
                this._face(i, ux, uz, dt);
                this._requestClip(i, this._alarmClip(u), 1 - this.stateT[i] / ALARM_S);
                {
                    // Telegraph cue at the same threshold the visual flash
                    // reads as "committed" — once per climb, on the crossing.
                    const f0 = this.flash[i];
                    this.flash[i] = Math.min(1, this.flash[i] + dt / ALARM_S);
                    if (f0 < 0.6 && this.flash[i] >= 0.6) {
                        sfx.trigger("enemy_windup", this.x[i], this.y[i] + 1, this.z[i]);
                    }
                }
                this.stateT[i] -= dt;
                if (this.stateT[i] <= 0) {
                    this._broadcast(i, u.alarmM);
                    this.flash[i] = 0;
                    this.cd[i] = u.cd;
                    this.state[i] = ST_COMBAT;
                }
                break;

            case ST_GUARD:
                // Planted bulwark: KB/fling immune, does not move, swings only
                // when the player walks into reach.
                this.planted[i] = 1;
                this._face(i, ux, uz, dt);
                this._requestClip(i, this._guardClip(u), -1);
                if (dist > u.reach + MELEE_PAD + 2 || !this.planted[i]) {
                    this.planted[i] = 0;
                    this.state[i] = ST_COMBAT;
                } else if (this.cd[i] <= 0 && !staggered) {
                    this._tryAttack(i, u, dist, true);
                }
                break;

            case ST_WINDUP: {
                this._face(i, ux, uz, dt);
                const a = this.atk[i];
                const tele = a >= 0 ? u.aTele[a] : 0.5;
                {
                    // The windup cue (subtle — a tell, not an alarm): fires
                    // once as the telegraph flash crosses 0.6, the same
                    // brightness the fxTelegraph ring keys its urgency on.
                    const f0 = this.flash[i];
                    this.flash[i] = Math.min(1, this.flash[i] + dt / Math.max(0.05, tele));
                    if (f0 < 0.6 && this.flash[i] >= 0.6) {
                        sfx.trigger("enemy_windup", this.x[i], this.y[i] + 1, this.z[i]);
                    }
                }
                this.atkT[i] += dt;
                this._requestClip(i, a >= 0 ? u.aClip[a] : CLIP_IDLE,
                    this.atkDur[i] > 0 ? this.atkT[i] / this.atkDur[i] : 0);
                // The eruption tell (§3.2 rule 3): a diving body half-surfaces
                // through its windup so the brightening core is visible.
                if (this.submerge[i] > 0.4) {
                    this.submerge[i] = Math.max(0.4, this.submerge[i] - 1.5 * dt);
                    this.sprayT[i] -= dt;
                    if (this.spray && this.sprayT[i] <= 0) {
                        this.sprayT[i] = 0.05;
                        this.spray.emit(this.x[i], this.y[i] + 0.2, this.z[i],
                            0, 2.4, 0, 0.14, 0.5, 0, 5.2);
                    }
                }
                if (!stunned) {
                    this.stateT[i] -= dt;
                    if (this.stateT[i] <= 0) this._beginStrike(i, u, dist, ux, uz);
                }
                break;
            }

            case ST_STRIKE: {
                // Active frames. `hits` applications spaced by the player's
                // i-frame window, so a "4x3 rake" pays all three.
                this._face(i, ux, uz, dt * 0.4);
                this.atkT[i] += dt;
                this._requestClip(i, u.aClip[this.atk[i]],
                    this.atkDur[i] > 0 ? this.atkT[i] / this.atkDur[i] : 0);
                this.hitT2[i] -= dt;
                if (this.hitT2[i] <= 0 && this.hitsLeft[i] > 0) {
                    this._applyHit(i, u, this.atk[i], dist, ux, uz);
                    this.hitsLeft[i]--;
                    this.hitT2[i] = PLAYER_IFRAME_S;
                }
                this.stateT[i] -= dt;
                if (this.stateT[i] <= 0 && this.hitsLeft[i] === 0) {
                    this.state[i] = ST_RECOVER;
                    this.stateT[i] = TOKEN_RECOVER_S;   // §4.2 hold-through-recovery
                }
                break;
            }

            case ST_FIRING:
                this._face(i, ux, uz, dt);
                this.atkT[i] += dt;
                this._requestClip(i, u.aClip[this.atk[i]],
                    this.atkDur[i] > 0 ? this.atkT[i] / this.atkDur[i] : 0);
                this.hitT2[i] -= dt;
                if (stunned || (staggered && !u.hyperArmor)) {
                    this._cancelAttack(i);
                    this.cd[i] = CANCEL_CD_S;
                    break;
                }
                if (this.hitT2[i] <= 0 && this.hitsLeft[i] > 0) {
                    this._fireBolt(i, u, this.atk[i]);
                    this.hitsLeft[i]--;
                    this.hitT2[i] = VOLLEY_GAP_S;
                }
                if (this.hitsLeft[i] === 0) {
                    this.flash[i] = 0;
                    this.state[i] = ST_RECOVER;
                    this.stateT[i] = TOKEN_RECOVER_S;
                }
                break;

            case ST_RECOVER:
                this.atkT[i] += dt;
                this._requestClip(i, this.atk[i] >= 0 ? u.aClip[this.atk[i]] : CLIP_IDLE,
                    this.atkDur[i] > 0 ? Math.min(1, this.atkT[i] / this.atkDur[i]) : 1);
                this.stateT[i] -= dt;
                if (this.stateT[i] <= 0) {
                    const wasStealth = this.cloaked[i] === 0 && u.cloak;
                    this._releaseTokens(i);
                    this.cd[i] = u.cd;
                    this.atk[i] = -1;
                    if (wasStealth || u.role === R_STALKER || u.role === R_ASSASSIN) {
                        // §3.2 rules 2 + 4 — free the stealth slot after 2 s and
                        // re-stalk after a 6–10 s cadence from ≥20 m out.
                        this._stealthFreeAt = this._time + STEALTH_LOCK_S;
                        this.openerCd[i] = OPENER_MIN_S + Math.random() * OPENER_RAND_S;
                        this.state[i] = ST_RETREAT;
                    } else if (u.role === R_RAIDER && u.burst > u.speed) {
                        // §3.6 — raiders disengage after the trade, then come
                        // back in on the burst line.
                        this.openerCd[i] = OPENER_MIN_S * 0.5;
                        this.state[i] = ST_RETREAT;
                    } else {
                        this.state[i] = ST_COMBAT;
                    }
                }
                break;

            case ST_SUBMERGED:
                this._submergedPursuit(i, u, dist, ux, uz, sm, dt);
                break;

            case ST_RETREAT: {
                this.openerCd[i] -= dt;
                this._requestClip(i, CLIP_RUN, -1);
                const back = u.burst > u.speed && !u.burstSubmerged ? u.burst : u.speed;
                if (dist < DISENGAGE_M) {
                    this._face(i, -ux, -uz, dt);
                    this._move(i, -ux, -uz, back * sm, dt);
                } else if (this.openerCd[i] <= 0) {
                    if (u.cloak && this.revealT[i] <= 0) this.cloaked[i] = 1;
                    this.state[i] = ST_COMBAT;
                }
                break;
            }
        }

        // ---- ground snap + registry sync + body ------------------------------
        this.y[i] = this.terrain.heightAt(this.x[i], this.z[i]);
        reg.move(id, this.x[i], this.y[i], this.z[i]);
        this._drive(i);
    }

    /**
     * Combat-state locomotion + attack initiation. One branch per animRole —
     * the fifteen briefs of COMBAT_DESIGN §3.1–§3.6 made executable.
     * @param {number} i @param {object} u unit record @param {number} dist
     * @param {number} ux @param {number} uz toward the player, unit
     * @param {number} sm registry speed multiplier
     * @param {boolean} staggered @param {boolean} stunned @param {number} dt
     */
    _combat(i, u, dist, ux, uz, sm, staggered, stunned, dt) {
        this._face(i, ux, uz, dt);
        if (stunned) { this._requestClip(i, CLIP_HIT, -1); return; }
        if (this.hitT[i] > 0 && !u.construct) this._requestClip(i, CLIP_HIT, -1);

        // Speed after the carapace bonus (§2.1 "Shatter → +25% speed").
        let spd = u.speed * sm * (staggered ? 0.15 : 1);
        if (u.carapace && this.carapace[i] <= 0) spd *= u.carapaceSpeedMult;

        switch (u.role) {
            case R_MAGE:
            case R_CULTIST:
                this._casterCombat(i, u, dist, ux, uz, spd, staggered, dt);
                return;

            case R_STALKER:
                this._ambusherCombat(i, u, dist, ux, uz, spd, staggered, dt, true);
                return;

            case R_ASSASSIN:
                this._ambusherCombat(i, u, dist, ux, uz, spd, staggered, dt, false);
                return;

            case R_SENTINEL:
            case R_WARDEN:
                // §3.5 — they guard, they do not roam. The alarm goes up once
                // per engagement, then they fight from the post.
                if (u.alarmM > 0 && this.cd[i] <= 0 && this.openerCd[i] <= 0) {
                    this.openerCd[i] = 1e9;   // one alarm per engagement
                    this.state[i] = ST_ALARM;
                    this.stateT[i] = ALARM_S;
                    this.flash[i] = 0;
                    return;
                }
                this._closeAndSwing(i, u, dist, ux, uz, spd, staggered, dt);
                return;

            case R_KNIGHT:
                // §3.4 armour grammar — a plantable guard plants at its post
                // rather than chasing, which is what makes the bulwark matter.
                if (u.plantable && dist <= u.reach + MELEE_PAD + 2) {
                    this.state[i] = ST_GUARD;
                    return;
                }
                this._closeAndSwing(i, u, dist, ux, uz, spd, staggered, dt);
                return;

            case R_MUMMY:
                // "Never chases — it holds ground and taxes hesitation."
                if (u.holdGround) {
                    const hx = this.x[i] - this.homeX[i], hz = this.z[i] - this.homeZ[i];
                    const hold = u.reach + 2;
                    if (hx * hx + hz * hz > hold * hold) {
                        const hd = Math.sqrt(hx * hx + hz * hz) || 1;
                        this._move(i, -hx / hd, -hz / hd, spd, dt);
                        this._requestClip(i, u.walkClip, -1);
                        return;
                    }
                    if (dist > u.reach + MELEE_PAD) {
                        // In range of nothing: poke, or wait.
                        this._requestClip(i, CLIP_IDLE, -1);
                        if (this.cd[i] <= 0) this._tryAttack(i, u, dist, false);
                        return;
                    }
                }
                this._closeAndSwing(i, u, dist, ux, uz, spd, staggered, dt);
                return;

            case R_BANDIT:
                this._flankCombat(i, u, dist, ux, uz, spd, staggered, dt);
                return;

            case R_BOSS:
            case R_GUARDIAN:
                // §4.2 — bosses hold a permanent virtual token; adds contend
                // for the rest. They never orbit and never disengage.
                this._requestClip(i, dist > u.reach + MELEE_PAD ? u.walkClip : CLIP_IDLE, -1);
                if (dist > u.reach + MELEE_PAD) this._move(i, ux, uz, spd, dt);
                if (this.cd[i] <= 0 && !staggered) this._tryAttack(i, u, dist, true);
                return;

            case R_GOLEM:
            case R_BRUTE:
            case R_SWARM:
            case R_RAIDER:
            default:
                this._closeAndSwing(i, u, dist, ux, uz, spd, staggered, dt);
                return;
        }
    }

    /**
     * The shared melee shape: token-holders close and swing, non-holders orbit
     * at 4–8 m (§3.1) or hold at reach; the 2 m proximity override lets anyone
     * swing token-free (§4.2). Also runs the imp/mummy ranged poke, which is
     * an anti-stalemate plumbing rule, not a spec rule.
     */
    _closeAndSwing(i, u, dist, ux, uz, spd, staggered, dt) {
        const reach = u.reach + MELEE_PAD;
        const close = dist <= TOKEN_FREE_M;                 // §4.2 override

        if (this.token[i] === 1 || close) {
            if (dist > reach * 0.85) {
                this._requestClip(i, spd > u.speed * 0.7 ? CLIP_RUN : u.walkClip, -1);
                this._move(i, ux, uz, spd, dt);
                // A gap-closer fires from its stated gapCloserM, not from reach.
                if (this.cd[i] <= 0 && !staggered && u.gap > 0 && dist <= u.gap) {
                    this._tryAttack(i, u, dist, true);
                }
            } else if (!staggered || u.hyperArmor) {
                this._requestClip(i, CLIP_IDLE, -1);
                // Standing at reach between swings: separation still applies,
                // clamped to the stand band [0.5×reach, 0.8×reach] so this
                // branch keeps full authority over the radial axis — a pack
                // that all earned the §4.2 proximity override fans into a
                // ring instead of nesting into one capsule.
                const pt = this.pathing;
                const mag = pt.standDrift(this, i, ux, uz, dist,
                    reach * 0.72, reach * 0.8);
                if (mag > 0) {
                    const ds = spd * 0.8 * Math.min(1, mag);
                    this.x[i] += pt.outX * ds * dt;
                    this.z[i] += pt.outZ * ds * dt;
                    // The drift may never EXIT the stand band: one 60 Hz
                    // step at imp speed (~0.08 m) can cross the 0.8→0.85
                    // reach hysteresis and re-trigger the walk-in branch,
                    // so the radial overshoot is clamped back to the band
                    // top. The band belongs to THIS branch — pathing only
                    // offers a direction.
                    const cp = this.controller.position;
                    const ddx = this.x[i] - cp.x, ddz = this.z[i] - cp.z;
                    const dd = Math.sqrt(ddx * ddx + ddz * ddz);
                    const top = reach * 0.8;
                    if (dd > top) {
                        this.x[i] = cp.x + ddx / dd * top;
                        this.z[i] = cp.z + ddz / dd * top;
                    }
                    this.speedNow[i] = ds;
                }
                if (this.cd[i] <= 0) this._tryAttack(i, u, dist, true);
            }
            return;
        }
        if (this._meleeFree > 0 && this.cd[i] <= 0 && !staggered) {
            this._takeMelee(i);
            return;
        }
        // Tokenless: keep the pressure on. Poke with the row's own ranged
        // attack if it has one and the stalemate has lasted POKE_AFTER_S.
        if (this.cd[i] <= -POKE_AFTER_S && dist <= POKE_MAX_M && !staggered) {
            if (this._tryAttack(i, u, dist, false)) return;
        }
        if (u.orbit) {
            this._requestClip(i, u.walkClip, -1);
            this._orbit(i, dist, ux, uz, spd, dt);
        } else {
            this._requestClip(i, CLIP_IDLE, -1);
        }
    }

    /**
     * §3.3 casters: standoff band 10–15 m, reposition-strafe every 2–4 s,
     * poke → zone → escape tool on pressure, panic melee only when cornered.
     * Escape tools do not fire while stunned (handled by the caller).
     */
    _casterCombat(i, u, dist, ux, uz, spd, staggered, dt) {
        const c = this.controller;

        // Escape tool: aimed at for >1 s, or approached inside its proximity.
        if (u.blinkM > 0) {
            const adx = this.x[i] - c.position.x;
            const ady = this.y[i] + u.height * 0.6 - (c.position.y + 1.5);
            const adz = this.z[i] - c.position.z;
            const ad = Math.sqrt(adx * adx + ady * ady + adz * adz);
            const aimDot = ad > 1e-4
                ? (adx * c.castAimX + ady * c.castAimY + adz * c.castAimZ) / ad : 0;
            if (aimDot > 0.996 && dist < u.perception) this.aimedT[i] += dt;
            else this.aimedT[i] = 0;

            if (this.blinkCd[i] <= 0 && this.blinkUsed[i] < u.blinkMax &&
                (dist < u.blinkProxM || this.aimedT[i] > u.blinkAimS)) {
                this._blink(i, u, ux, uz);
                return;
            }
        }

        // Standoff band, reposition-strafe between casts (§3.3).
        this.strafeT[i] -= dt;
        if (this.strafeT[i] <= 0) {
            this.strafeDir[i] = /** @type {1|-1} */ (-this.strafeDir[i]);
            this.strafeT[i] = STRAFE_MIN_S + Math.random() * STRAFE_RAND_S;
        }
        if (dist < STANDOFF_NEAR) {
            this._requestClip(i, u.walkClip, -1);
            this._move(i, -ux, -uz, spd, dt);
        } else if (dist > STANDOFF_FAR) {
            this._requestClip(i, spd > u.speed * 0.7 ? CLIP_RUN : u.walkClip, -1);
            this._move(i, ux, uz, spd, dt);
        } else {
            this._requestClip(i, u.walkClip, -1);
            this._move(i, -uz * this.strafeDir[i], ux * this.strafeDir[i], spd * 0.8, dt);
        }

        if (this.cd[i] <= 0 && dist <= u.engage && !staggered) {
            this._tryAttack(i, u, dist, true);
        } else if (dist <= u.reach + MELEE_PAD && this.cd[i] <= 0 && !staggered) {
            this._tryAttack(i, u, dist, true);   // panic melee when cornered
        } else {
            this._requestClip(i, CLIP_IDLE, this.clipPhase[i] < 0 ? -1 : this.clipPhase[i]);
        }
    }

    /**
     * §3.2 ambushers and assassins. `submerges` = the pursuer sub-role (rule 7,
     * the stalker's 13 m/s dive); assassins instead circle cloaked.
     * Rule 1 commit windows, rule 2 one striker at a time, rule 4 cadence.
     */
    _ambusherCombat(i, u, dist, ux, uz, spd, staggered, dt, submerges) {
        // Cadence gate — stalk the band while the opener recharges (rule 4).
        if (this.openerCd[i] > 0) {
            this.openerCd[i] -= dt;
            this._requestClip(i, this.cloaked[i] ? this._stealthClip(u) : u.walkClip, -1);
            if (dist < STANDOFF_NEAR) this._move(i, -ux, -uz, spd, dt);
            else if (dist > STANDOFF_FAR) this._move(i, ux, uz, spd, dt);
            else this._move(i, -uz * this.strafeDir[i], ux * this.strafeDir[i], spd * 0.8, dt);
            return;
        }

        // Rule 1 — commit-window targeting. Openers never fire while the
        // player is idle and watching.
        const c = this.controller;
        const fx = Math.sin(c.facing), fz = -Math.cos(c.facing);
        const toE = dist > 1e-4 ? (-ux * fx - uz * fz) : 1;   // player→enemy · facing
        const committed = c.speed > COMMIT_SPEED_MS || toE < COMMIT_FACING_COS;
        // Rule 2 — one stealth striker at a time.
        const slotFree = this._time >= this._stealthFreeAt;

        if (submerges && u.burstSubmerged && dist > u.engage) {
            if (committed || dist > u.engage * 2) {
                this.state[i] = ST_SUBMERGED;
                return;
            }
        }

        if (dist <= u.engage && this._meleeFree > 0 && !staggered &&
            this.cd[i] <= 0 && slotFree && (committed || dist <= u.reach + MELEE_PAD)) {
            // Commit the stealth slot and the token ONLY if an attack actually
            // started. The old order burned both first — and a whiff (every
            // range band closed at this exact dist) locked `_stealthFreeAt` at
            // +1e9 with no attack to ever release it, killing the whole
            // stalker/assassin role for the rest of the session (qa_enemy_aaa
            // 2026-08-10: divers reached 0 m and never struck).
            if (this._tryAttack(i, u, dist, true)) {
                this._stealthFreeAt = this._time + 1e9;   // held until this one recovers
                if (this.token[i] !== 2) this._takeMelee(i);
            }
            return;
        }

        // Not opening: circle at the burst line, cloaked if it can be.
        this._requestClip(i, this.cloaked[i] ? this._stealthClip(u) : u.walkClip, -1);
        const ring = Math.min(u.engage, STANDOFF_FAR);
        if (dist > ring + 1) this._move(i, ux, uz, spd, dt);
        else if (dist < ring - 1) this._move(i, -ux, -uz, spd, dt);
        else this._move(i, -uz * this.strafeDir[i], ux * this.strafeDir[i], spd * 0.9, dt);
        this.strafeT[i] -= dt;
        if (this.strafeT[i] <= 0) {
            this.strafeDir[i] = /** @type {1|-1} */ (-this.strafeDir[i]);
            this.strafeT[i] = STRAFE_MIN_S + Math.random() * STRAFE_RAND_S;
        }
    }

    /**
     * §3.6 bandit doctrine: circle into the player's REAR hemisphere before
     * committing — the flank rush pays `flankBonus` only from off-camera.
     */
    _flankCombat(i, u, dist, ux, uz, spd, staggered, dt) {
        const c = this.controller;
        const fx = Math.sin(c.facing), fz = -Math.cos(c.facing);
        const behind = (-ux * fx - uz * fz) < 0;      // enemy is behind the player
        const reach = u.reach + MELEE_PAD;

        if (behind || dist <= TOKEN_FREE_M) {
            this._closeAndSwing(i, u, dist, ux, uz, spd, staggered, dt);
            return;
        }
        // In front: arc around at the orbit band rather than walking into the
        // player's face, and throw grit while doing it.
        this._requestClip(i, u.walkClip, -1);
        this._orbit(i, dist, ux, uz, spd, dt);
        if (this.cd[i] <= 0 && !staggered && dist <= POKE_MAX_M) {
            this._tryAttack(i, u, dist, false);
        }
        if (dist <= reach && this.cd[i] <= 0 && !staggered) {
            this._tryAttack(i, u, dist, true);
        }
    }

    /** Submerged pursuit: dive speed, wake tell, erupt at the trigger range. */
    _submergedPursuit(i, u, dist, ux, uz, sm, dt) {
        this.submerge[i] = Math.min(1, this.submerge[i] + dt / 0.4);
        this._face(i, ux, uz, dt);
        this._requestClip(i, this._stealthClip(u), -1);
        this._move(i, ux, uz, u.burst * sm, dt);

        // The wake-ripple tell (§3.2 rule 3).
        this.sprayT[i] -= dt;
        if (this.spray && this.sprayT[i] <= 0) {
            this.sprayT[i] = 0.08;
            this.spray.emit(
                this.x[i], this.y[i] + 0.15, this.z[i],
                -ux * 0.8, 1.4, -uz * 0.8, 0.10, 0.5, 0, 5.2
            );
        }

        if (dist <= u.engage && this._meleeFree > 0 &&
            this._time >= this._stealthFreeAt) {
            // The eruption is a stealth opener and pays its token (rule 7) —
            // but only an attack that STARTED pays. A whiff here (the leap's
            // gap band can exclude the exact trigger distance) used to burn
            // the slot at +1e9 with nothing to release it; the diver then
            // circled under the player forever. Left un-burned, the gate
            // retries every frame as dist closes until the rake lands.
            if (this._tryAttack(i, u, dist, true)) {
                this._stealthFreeAt = this._time + 1e9;
                if (this.token[i] !== 2) this._takeMelee(i);
            }
        }
    }

    // ------------------------------------------------------------- attack core

    /**
     * Pick and start an attack. Walks the unit's own damage table and takes
     * the first usable entry whose range band contains `dist`. Zero allocation.
     * @param {number} i @param {object} u @param {number} dist
     * @param {boolean} anyKind false = ranged pokes only (token-free)
     * @returns {boolean} true if an attack started
     */
    _tryAttack(i, u, dist, anyKind) {
        const reach = u.reach + MELEE_PAD;
        for (let d = 0; d < u.nAtk; d++) {
            if (!u.aUsable[d]) continue;
            const kind = u.aKind[d];
            if (!anyKind && kind !== K_PROJ) continue;
            if (kind === K_PROJ) {
                // A projectile needs a ranged token unless it is a token-free
                // poke (§4.2 covers melee only, so a poke costs the token when
                // one is free and is skipped when none is).
                if (dist > (u.engage > 0 ? u.engage : POKE_MAX_M)) continue;
                if (dist < 2) continue;                 // never point-blank
                if (this.token[i] !== 2) {
                    if (this._rangedFree <= 0) continue;
                    this._takeRanged(i);
                }
            } else if (kind === K_GAP) {
                if (u.gap <= 0 || dist > u.gap || dist <= reach * 0.6) continue;
            } else if (kind === K_RING) {
                if (dist > u.aRadius[d] + MELEE_PAD) continue;
            } else if (kind === K_CHANNEL) {
                if (dist > (u.engage > 0 ? u.engage : reach)) continue;
            } else {                                     // K_MELEE
                if (dist > reach) continue;
            }
            this._startAttack(i, u, d);
            return true;
        }
        return false;
    }

    /** Enter ST_WINDUP on damage index `d`. */
    _startAttack(i, u, d) {
        const tele = u.aTele[d];
        const hits = u.aHits[d] > 0 ? u.aHits[d] : 1;
        const active = u.aKind[d] === K_PROJ
            ? (hits - 1) * VOLLEY_GAP_S + STRIKE_ACTIVE_S
            : (hits - 1) * PLAYER_IFRAME_S + STRIKE_ACTIVE_S;
        this.atk[i] = d;
        this.atkT[i] = 0;
        this.atkDur[i] = tele + active + TOKEN_RECOVER_S;
        this.state[i] = ST_WINDUP;
        this.stateT[i] = tele;
        this.flash[i] = 0;
        this.hitsLeft[i] = hits;
        this.hitT2[i] = 0;
        this._requestClip(i, u.aClip[d], 0);
    }

    /** The telegraph expired — go active. */
    _beginStrike(i, u, dist, ux, uz) {
        const d = this.atk[i];
        this.lunge[i] = 1;
        this.flash[i] = 0;
        this.submerge[i] = 0;

        if (u.aKind[d] === K_PROJ) {
            this.state[i] = ST_FIRING;
            this.hitT2[i] = 0;
            this.flash[i] = 1;
            return;
        }
        if (u.aKind[d] === K_GAP) {
            // Dash to contact along the stated gap-closer distance.
            const dash = Math.min(dist - 0.8, u.gap);
            if (dash > 0) {
                this.x[i] += ux * dash;
                this.z[i] += uz * dash;
            }
            if (this.spray) this._burstPlume(i);
        } else if (u.aKind[d] === K_RING && this.spray) {
            this._burstPlume(i);
        }
        this.state[i] = ST_STRIKE;
        this.stateT[i] = (this.hitsLeft[i] - 1) * PLAYER_IFRAME_S + STRIKE_ACTIVE_S;
        this.hitT2[i] = 0;
    }

    /** One application of damage index `d`. */
    _applyHit(i, u, d, dist, ux, uz) {
        const c = this.controller;
        const kind = u.aKind[d];
        if (kind === K_CHANNEL) return;                  // no direct damage

        // Recompute the separation — the dash and the player both moved.
        const ndx = c.position.x - this.x[i];
        const ndz = c.position.z - this.z[i];
        const nd = Math.sqrt(ndx * ndx + ndz * ndz);
        let land = false;
        if (kind === K_RING) {
            // Ground ring: jumped over at ollie height (§1.4).
            land = nd <= u.aRadius[d] + MELEE_PAD && c.airHeight <= RING_CLEAR_H;
        } else if (kind === K_GAP) {
            land = nd <= POUNCE_CONTACT_M + MELEE_PAD && c.airHeight <= MELEE_CLEAR_H;
        } else {
            const fx = Math.sin(this.yaw[i]);
            const fz = -Math.cos(this.yaw[i]);
            const arc = nd > 1e-4 ? (ndx / nd) * fx + (ndz / nd) * fz : 1;
            land = nd <= u.reach + MELEE_PAD + 0.35 && arc >= MELEE_ARC_COS &&
                c.airHeight <= MELEE_CLEAR_H;
        }
        if (!land) return;

        let dmg = u.aDmg[d] * this.dmgScale[i];
        // §3.6 flank rush: only from the player's rear hemisphere.
        if (u.flankBonus > 1) {
            const pfx = Math.sin(c.facing), pfz = -Math.cos(c.facing);
            if (nd > 1e-4 && (-ndx / nd) * pfx + (-ndz / nd) * pfz < 0) {
                dmg *= u.flankBonus;
            }
        }
        this._hurtPlayer(dmg);
    }

    /** Damage the player, honouring the 0.5 s i-frame window. */
    _hurtPlayer(dmg) {
        if (this._time < this._pIFrameUntil) return;
        if (this.progression && this.progression.isInvulnerable &&
            this.progression.isInvulnerable()) return;
        const c = this.controller;
        c.health = Math.max(0, c.health - dmg);
        // Behind the i-frame and invulnerability gates above, so the thud
        // means "you were actually hit", never "something swung at you".
        sfx.trigger("player_hurt");
        this._pIFrameUntil = this._time + PLAYER_IFRAME_S;
    }

    /** Escape tool: Glimmer Blink / Mirage Step / Smoke-step (§3.3). */
    _blink(i, u, ux, uz) {
        const side = Math.random() < 0.5 ? -1 : 1;
        let bx = -ux * 0.7 - uz * side * 0.7;
        let bz = -uz * 0.7 + ux * side * 0.7;
        const bl = Math.sqrt(bx * bx + bz * bz) || 1;
        bx /= bl; bz /= bl;
        if (this.spray) {
            this.spray.emit(this.x[i], this.y[i] + 0.8, this.z[i],
                0, 1.2, 0, 0.14, 0.4, 0, 5.2);
        }
        this.x[i] += bx * u.blinkM;
        this.z[i] += bz * u.blinkM;
        this.y[i] = this.terrain.heightAt(this.x[i], this.z[i]);
        this.blinkCd[i] = u.blinkCd;
        this.blinkUsed[i] = Math.min(254, this.blinkUsed[i] + 1);
        this.aimedT[i] = 0;
        if (this.spray) {
            this.spray.emit(this.x[i], this.y[i] + 0.8, this.z[i],
                0, 1.2, 0, 0.14, 0.4, 0, 5.2);
        }
    }

    // ------------------------------------------------------------- projectiles

    /** Launch one bolt of damage index `d` with the §3.3 velocity lead. */
    _fireBolt(i, u, d) {
        let b = -1;
        for (let n = 0; n < BOLT_MAX; n++) {
            if (!this.boltAlive[n]) { b = n; break; }
        }
        if (b < 0) return;
        const c = this.controller;
        const ox = this.x[i];
        const oy = this.y[i] + u.height * 0.6;
        const oz = this.z[i];
        const tx = c.position.x + c.velocity.x * CASTER_LEAD_S;
        const ty = c.position.y + 1.2 + c.velocity.y * CASTER_LEAD_S;
        const tz = c.position.z + c.velocity.z * CASTER_LEAD_S;
        const dx = tx - ox, dy = ty - oy, dz = tz - oz;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const spd = u.aSpeed[d];
        this.boltAlive[b] = 1;
        this.boltX[b] = ox; this.boltY[b] = oy; this.boltZ[b] = oz;
        this.boltVX[b] = dx / dd * spd;
        this.boltVY[b] = dy / dd * spd;
        this.boltVZ[b] = dz / dd * spd;
        this.boltDmg[b] = u.aDmg[d] * this.dmgScale[i];
        this.boltTtl[b] = BOLT_TTL;
        this.boltHome[b] = u.aHome[d];
        this.boltTrailT[b] = 0;
    }

    /** Integrate, home, and swept-test the projectile pool. */
    _updateBolts(dt) {
        const c = this.controller;
        const px = c.position.x, py = c.position.y, pz = c.position.z;
        for (let b = 0; b < BOLT_MAX; b++) {
            if (!this.boltAlive[b]) continue;
            this.boltTtl[b] -= dt;
            if (this.boltTtl[b] <= 0) { this._killBolt(b); continue; }

            let vx = this.boltVX[b], vy = this.boltVY[b], vz = this.boltVZ[b];
            if (this.boltHome[b]) {
                const spd = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
                const tx = px - this.boltX[b];
                const ty = py + 1.2 - this.boltY[b];
                const tz = pz - this.boltZ[b];
                const td = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
                const k = Math.min(1, BOLT_HOME_RATE * dt);
                vx = vx / spd + (tx / td - vx / spd) * k;
                vy = vy / spd + (ty / td - vy / spd) * k;
                vz = vz / spd + (tz / td - vz / spd) * k;
                const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
                vx = vx / vl * spd; vy = vy / vl * spd; vz = vz / vl * spd;
                this.boltVX[b] = vx; this.boltVY[b] = vy; this.boltVZ[b] = vz;
            }

            const x0 = this.boltX[b], y0 = this.boltY[b], z0 = this.boltZ[b];
            const x1 = x0 + vx * dt, y1 = y0 + vy * dt, z1 = z0 + vz * dt;

            // Swept segment vs the player capsule — exact at any frame rate,
            // which is the §9.3 anti-tunneling rule in closed form.
            if (segVsCapsule(x0, y0, z0, x1, y1, z1, px, py, pz, PLAYER_R, PLAYER_H)) {
                this._hurtPlayer(this.boltDmg[b]);
                if (this.spray) {
                    this.spray.emit(x1, y1, z1, 0, 1.5, 0, 0.12, 0.35, 0, 5.2);
                }
                this._killBolt(b);
                continue;
            }

            if (y1 <= this.terrain.heightAt(x1, z1) + 0.05) {
                if (this.spray) {
                    this.spray.emit(x1, y1 + 0.1, z1, 0, 1.8, 0, 0.14, 0.4, 0, 5.2);
                }
                this._killBolt(b);
                continue;
            }

            this.boltX[b] = x1; this.boltY[b] = y1; this.boltZ[b] = z1;

            this.boltTrailT[b] -= dt;
            if (this.spray && this.boltTrailT[b] <= 0) {
                this.boltTrailT[b] = 0.06;
                this.spray.emit(x1, y1, z1, 0, 0.2, 0, 0.05, 0.3, 0, 5.2);
            }
            if (this.vis) this.vis.driveBolt(b, x1, y1, z1, true);
        }
    }

    /** @param {number} b */
    _killBolt(b) {
        this.boltAlive[b] = 0;
        if (this.vis) this.vis.driveBolt(b, 0, 0, 0, false);
    }

    // ------------------------------------------------------- perception + herd

    /**
     * §4.1: sight cone 130° at the row's range, 4 m proximity, 12 m hearing on
     * sprint/surf speeds. A cloaked unit still perceives normally.
     * @param {number} senseMult 1.2 while Alert (§4.1 "senses widened +20%")
     * @returns {boolean}
     */
    _perceives(i, u, dist, ux, uz, senseMult) {
        if (dist <= PROXIMITY_M) return true;
        if (dist <= HEARING_M && this.controller.speed > 5) return true;
        if (dist > u.perception * senseMult) return false;
        const fx = Math.sin(this.yaw[i]);
        const fz = -Math.cos(this.yaw[i]);
        return ux * fx + uz * fz >= SIGHT_COS;
    }

    /**
     * Combat broadcast (§4.1): allies within 12 m join, staggered 0.2–0.6 s.
     * Pack Call widens it to the unit's own stated radius (imps 30 m, same key
     * only); Horn / Beacon / Revenant ping go through `_broadcast` after their
     * 3 s cancel window instead.
     */
    _propagate(i) {
        const u = this.units[this.unitOf[i]];
        if (u.packCallM > 0) this._broadcast(i, u.packCallM, u.packCallSame ? u.key : null);
        else this._broadcast(i, ALERT_M, null);
    }

    /**
     * Wake allies inside `r` metres. @param {string|null} onlyKey restricts the
     * call to units of one combatData key (Pack Call is imps-to-imps).
     */
    _broadcast(i, r, onlyKey) {
        if (r <= 0) return;
        const r2 = r * r;
        for (let j = 0; j < ENEMY_MAX; j++) {
            if (j === i || !this.alive[j]) continue;
            if (this.state[j] !== ST_IDLE && this.state[j] !== ST_BURIED) continue;
            if (onlyKey && this.units[this.unitOf[j]].key !== onlyKey) continue;
            const dx = this.x[j] - this.x[i];
            const dz = this.z[j] - this.z[i];
            if (dx * dx + dz * dz <= r2) {
                this.state[j] = ST_ALERTED;
                this.stateT[j] = ALERT_STAGGER_MIN + Math.random() * ALERT_STAGGER_RAND;
            }
        }
    }

    /**
     * Rime Ritual (§2.1 rimeboundCultist): a cultist mid-channel shields every
     * ally inside 15 m. The flag is exposed, not consumed — the −50% frost
     * reduction belongs to the damage pass. Interrupting the channel staggers
     * the tethered allies for the stated 0.7 s, which IS done here.
     */
    _syncShields() {
        for (let i = 0; i < ENEMY_MAX; i++) this.shielded[i] = 0;
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (!this.alive[i]) continue;
            const u = this.units[this.unitOf[i]];
            if (u.shieldM <= 0) continue;
            const channeling = this.state[i] === ST_WINDUP && this.atk[i] >= 0 &&
                u.aKind[this.atk[i]] === K_RING;
            if (!channeling) continue;
            const r2 = u.shieldM * u.shieldM;
            for (let j = 0; j < ENEMY_MAX; j++) {
                if (!this.alive[j]) continue;
                const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
                if (dx * dx + dz * dz <= r2) this.shielded[j] = 1;
            }
        }
    }

    /**
     * Is (x, z) inside a live warding rune field? Exposed for the damage pass
     * (scorchWarden −30% spell damage); this module applies nothing.
     * @param {number} x @param {number} z
     * @returns {number} the strongest spell-damage multiplier in force, 1 = none
     */
    wardAt(x, z) {
        let m = 1;
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (!this.alive[i] || this.state[i] === ST_DYING) continue;
            const u = this.units[this.unitOf[i]];
            if (u.wardM <= 0) continue;
            const dx = this.x[i] - x, dz = this.z[i] - z;
            if (dx * dx + dz * dz <= u.wardM * u.wardM) m = 0.7;
        }
        return m;
    }

    /** Cheap pairwise de-overlap so a pack never stacks into one capsule. */
    _separate() {
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (!this.alive[i] || this.state[i] === ST_DYING) continue;
            const ri = this.units[this.unitOf[i]].radius;
            for (let j = i + 1; j < ENEMY_MAX; j++) {
                if (!this.alive[j] || this.state[j] === ST_DYING) continue;
                const dx = this.x[j] - this.x[i];
                const dz = this.z[j] - this.z[i];
                const min = ri + this.units[this.unitOf[j]].radius;
                const d2 = dx * dx + dz * dz;
                if (d2 >= min * min || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const push = (min - d) * 0.5 / d;
                this.x[i] -= dx * push; this.z[i] -= dz * push;
                this.x[j] += dx * push; this.z[j] += dz * push;
            }
        }
    }

    // -------------------------------------------------------------- locomotion

    /**
     * Move along (mx,mz) at spd m/s — routed through the pathing stack:
     * slope-aware steering, separation, and path-follow adjust the DIRECTION
     * only. Speed, state and the decision to move at all stay with the
     * brains; attack/death/stagger states never call this.
     * @param {number} i
     */
    _move(i, mx, mz, spd, dt) {
        const pt = this.pathing;
        pt.steer(this, i, mx, mz, dt);
        this.x[i] += pt.outX * spd * dt;
        this.z[i] += pt.outZ * spd * dt;
        this.speedNow[i] = spd;
    }

    /** §3.1 orbit: hold 4–8 m, circle tangentially, posture — never stand. */
    _orbit(i, dist, ux, uz, spd, dt) {
        const r = this.orbitR[i];
        let mx = -uz * this.strafeDir[i];
        let mz = ux * this.strafeDir[i];
        if (dist > r + 1) { mx += ux * 0.8; mz += uz * 0.8; }
        else if (dist < r - 1) { mx -= ux * 0.8; mz -= uz * 0.8; }
        const l = Math.sqrt(mx * mx + mz * mz) || 1;
        this._move(i, mx / l, mz / l, spd * 0.85, dt);
        this.strafeT[i] -= dt;
        if (this.strafeT[i] <= 0) {
            this.strafeDir[i] = /** @type {1|-1} */ (-this.strafeDir[i]);
            this.strafeT[i] = STRAFE_MIN_S + Math.random() * STRAFE_RAND_S;
        }
    }

    /** Turn toward (ux,uz) — port frame: yaw = atan2(dx, −dz). */
    _face(i, ux, uz, dt) {
        const want = Math.atan2(ux, -uz);
        let d = want - this.yaw[i];
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw[i] += d * Math.min(1, 10 * dt);
    }

    // ------------------------------------------------------------------ tokens

    /** @param {number} i */
    _takeMelee(i) {
        this._meleeFree--;
        this.token[i] = 1;
    }

    /** @param {number} i */
    _takeRanged(i) {
        this._rangedFree--;
        this.token[i] = 2;
    }

    /** Release whatever token slot i holds. @param {number} i */
    _releaseTokens(i) {
        if (this.token[i] === 1) this._meleeFree++;
        else if (this.token[i] === 2) this._rangedFree++;
        this.token[i] = 0;
        const u = this.units[this.unitOf[i]];
        if ((u.role === R_STALKER || u.role === R_ASSASSIN) &&
            this._stealthFreeAt > this._time + 1e8) {
            this._stealthFreeAt = this._time + STEALTH_LOCK_S;
        }
    }

    /** Cancel an attack in flight and give the token back. */
    _cancelAttack(i) {
        const st = this.state[i];
        if (st === ST_WINDUP || st === ST_FIRING || st === ST_STRIKE ||
            st === ST_ALARM) {
            this._releaseTokens(i);
            this.state[i] = ST_COMBAT;
            this.hitsLeft[i] = 0;
            this.atk[i] = -1;
            this.flash[i] = 0;
        }
    }

    // -------------------------------------------------------------- clip slots

    /**
     * Request a clip for slot `i`. `phase` < 0 = a loop the renderer owns;
     * 0..1 = a one-shot whose timeline the AI owns. A change of clip bumps
     * `clipSeq`, which is the renderer's restart edge.
     * @param {number} i @param {number} clip @param {number} phase
     */
    _requestClip(i, clip, phase) {
        if (this._clipWant[i] !== clip) {
            this._clipWant[i] = clip;
            this.clip[i] = clip;
            this.clipSeq[i] = (this.clipSeq[i] + 1) & 255;
        }
        this.clipPhase[i] = phase > 1 ? 1 : phase;
    }

    /** The role's "hide" clip: stalker crouch, assassin stealth, else walk. */
    _stealthClip(u) {
        if (u.role === R_STALKER) return CLIP_A0;        // "crouch"
        if (u.role === R_ASSASSIN) return CLIP_A0;       // "stealth"
        return u.walkClip;
    }

    /** The alarm clip: swarm "roar", sentinel "block", assassin "vanish". */
    _alarmClip(u) {
        if (u.role === R_SWARM) return CLIP_A0 + 3;      // "roar"
        if (u.role === R_SENTINEL) return CLIP_A0;       // "block"
        if (u.role === R_WARDEN) return CLIP_A0 + 2;     // "aura_cast"
        return CLIP_IDLE;
    }

    /** The knight's planted stance clip. */
    _guardClip(u) {
        return u.role === R_KNIGHT ? CLIP_A0 + 2 : CLIP_IDLE;   // "guard"
    }

    // --------------------------------------------------------------------- vfx

    /** Death shatter through the shared spray pool (§9.4 death VFX rule). */
    _shatter(i) {
        // The dissolve, heard where the body broke. Before the spray guard:
        // the kill is the event, not the particles.
        sfx.trigger("enemy_death", this.x[i], this.y[i] + 0.8, this.z[i]);
        if (!this.spray) return;
        const u = this.units[this.unitOf[i]];
        const cy = this.y[i] + u.height * 0.5;
        for (let n = 0; n < 14; n++) {
            const a = (n / 14) * Math.PI * 2;
            const up = 1.5 + Math.random() * 2.5;
            const out = 2 + Math.random() * 3;
            this.spray.emit(
                this.x[i], cy, this.z[i],
                Math.cos(a) * out, up, Math.sin(a) * out,
                n < 6 ? 0.16 : 0.09, 0.7 + Math.random() * 0.4,
                n < 6 ? 1 : 0, n < 6 ? 1.1 : 5.2
            );
        }
    }

    /** Powder plume on eruptions and slams. @param {number} i */
    _burstPlume(i) {
        for (let n = 0; n < 8; n++) {
            const a = (n / 8) * Math.PI * 2;
            this.spray.emit(
                this.x[i], this.y[i] + 0.2, this.z[i],
                Math.cos(a) * 2.5, 2.2, Math.sin(a) * 2.5,
                0.13, 0.6, 0, 5.2
            );
        }
    }

    /**
     * Push this frame's body state to the visual. `drive` is UNCHANGED — the
     * same five scalars the placeholder has always taken. `driveClip` is the
     * additive channel a roster-aware renderer implements; a renderer without
     * it keeps working with no change at all.
     */
    _drive(i) {
        if (!this.vis) return;
        const u = this.units[this.unitOf[i]];
        this.vis.drive(
            i, this.x[i], this.y[i], this.z[i], this.yaw[i],
            Math.min(1, this.speedNow[i] / u.speed),
            this.flash[i], this.lunge[i], this.submerge[i], 0
        );
        if (this.vis.driveClip) {
            this.vis.driveClip(i, this.clip[i], this.clipPhase[i], this.clipSeq[i]);
        }
    }
}

/**
 * Swept segment vs a vertical capsule (axis (cx, cy..cy+h, cz), radius r).
 * Closest-approach parameterisation — no allocation, exact at any dt.
 * @returns {boolean}
 */
function segVsCapsule(x0, y0, z0, x1, y1, z1, cx, cy, cz, r, h) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len2 = dx * dx + dy * dy + dz * dz;
    // Same construction damageable.segmentHit uses for spells-vs-enemies:
    // project onto the segment with the y term clamped to the capsule axis.
    let t = len2 > 1e-9
        ? ((cx - x0) * dx + (Math.min(Math.max(y0, cy), cy + h) - y0) * dy +
           (cz - z0) * dz) / len2
        : 0;
    t = Math.min(1, Math.max(0, t));
    const px = x0 + dx * t, py = y0 + dy * t, pz = z0 + dz * t;
    const qy = Math.min(Math.max(py, cy), cy + h);
    const ddx = px - cx, ddy = py - qy, ddz = pz - cz;
    return ddx * ddx + ddy * ddy + ddz * ddz <= r * r;
}
