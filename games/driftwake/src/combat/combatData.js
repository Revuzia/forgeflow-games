/**
 * THE numbers table — every combat/progression constant, transcribed from
 * `_spec/COMBAT_DESIGN.md` (v2.0) and `_spec/PROGRESSION_DESIGN.md`. Plain
 * data + pure helpers; no Three, no DOM, no per-call allocation in helpers.
 *
 * ANCHOR CONTRACT (progression §1): every enemy stat here is a FINAL
 * enemy-level-10 snapshot. In play: HP = row × 1.10^(L−10), DMG = row ×
 * 1.07^(L−10) — use scaleHP()/scaleDmg(). Behavior fields (telegraphs,
 * perception, speed, poise, ranges) are level-invariant and never scale.
 *
 * Key mapping (combat §0): SPELLS are keyed by the OWNER binds
 * (LMB/1/2/3/4); each row carries `engineKey` (spellSystem's 1..5) and
 * `strikeDelay` mirroring spellSystem's STRIKE_DELAY table verbatim
 * ({1:0.71, 3:0.66, 4:0.95, 5:0.98}; Bolt = engine key 2, no delay —
 * fires on release, tap auto-releases after 0.15 s wind).
 *
 * Tier ids come from damageable.js's exported TIER — the registry's CC
 * matrix indexes with the same numbers, so rows feed register() directly.
 */

import { TIER } from "./damageable.js";

export { TIER };

/* ------------------------------------------------------------------ *
 * Player anchor (combat §1.3–1.4; progression §4)
 * ------------------------------------------------------------------ */

export const PLAYER = {
    hpMax: 100,                 // L10 anchor pool
    hpRegenPerS: 10,            // after 6 s undamaged; disabled in arenas
    hpRegenDelayS: 6,
    healthMotePctMaxHp: 10,     // +10% max HP per mote (=+10 at L10)
    moteDropPct: { fodder: 35, elite: 100 },
    manaMax: 100,
    manaRegenPerS: 6,           // standing
    manaRegenSurfPerS: 18,      // while surfing >= surfRegenMinSpeed
    surfRegenMinSpeed: 10,      // m/s
    knockdownIFrameS: 0.75,
    hardCcTokenS: 6,            // 1 hard CC per 6 s, encounter-wide
    envHardCcCapS: 4,           // environmental hard CC: 1 per 4 s
    envJuggleGuardS: 2,         // no env hard CC within 2 s of a token CC
    slowCapPct: 40,             // chill/slow on the player never exceeds -40%
    respawnGraceS: 2,
    /** Per-level compounding growth (progression §4). */
    perLevel: { dmg: 1.09, hp: 1.07, mana: 1.05, manaRegen: 1.03 },
};

/* ------------------------------------------------------------------ *
 * SPELLS — combat §1.1–§1.2, §5.1 poise row; strike delays = spellSystem
 * ------------------------------------------------------------------ */

export const SPELLS = {
    /** Frost Bolt — Ribbon thrown phase (engine key 2). */
    LMB: {
        name: "Frost Bolt", engineKey: 2, strikeDelay: 0,
        tapWindS: 0.15,             // tap auto-release wind
        dmg: 12, varancePct: 10,    // ±10% max, no crits (§5.3 invariant 3)
        fireCycleS: 0.45,           // 26.7 DPS planted
        projectileSpeedMS: 21, rangeM: 40, fallbackM: 18, tipSnapM: 0.6,
        /** Anti-kite tax (§1.1): above 12 m/s at release. */
        falloff: { speedThresholdMS: 12, reducedDmg: 7, restoreDelayS: 0.4,
            chillSuppressed: true },
        cc: null,
        chill: { stacks: 1, maxStacks: 5, slowPctPerStack: 6, refreshS: 3,
            brittle: { dmgTakenMult: 1.2, durS: 4 } },
        splash: { dmg: 4, rMinM: 0.6, rMaxM: 1.2 },
        whip: { dmgPerTick: 6, ticksPerS: 4, nudgeM: 1 },
        poise: 10, mana: 0, cooldown: 0,
    },
    /** Frost Wave — Sweep (engine key 1). */
    1: {
        name: "Frost Wave", engineKey: 1, strikeDelay: 0.71,
        dmg: 20,                    // arc center, bell-tapered to 0 at horns, ×env
        falloff: { rule: "bell(u) to 0 at horns; ×env; one hit per enemy per cast" },
        cc: { type: "knockback", dur: 0.4, mag: 4 },   // 4 m KB + 0.4 s stagger
        poise: 25, mana: 15, cooldown: 4,
        reachM: 13.6, lifeS: 2.4,
    },
    /** Mini-Vortex — Bloom (engine key 3). */
    2: {
        name: "Mini-Vortex", engineKey: 3, strikeDelay: 0.66,
        dmg: 35, dmgRim: 18,        // linear falloff center→rim
        falloff: { innerFullFrac: 0.4, rule: "100% inside inner 40% of radius, linear 35→18 to rim" },
        burstRadiusM: 2.0, rangeM: 22, fallbackM: 13,
        column: { dps: 8, radiusM: 0.66, heightM: 5.6, lifeS: 1.75 },
        cc: { type: "slow", dur: 1.5, mag: 0.4 },      // 40% slow 1.5 s
        staggerS: 0.7,
        revealStunS: 1.5,           // submerged/stealthed ripped out stunned
        poise: 30, mana: 25, cooldown: 6,
    },
    /** Crystal Spikes — Crystallize (engine key 4). */
    3: {
        name: "Crystal Spikes", engineKey: 4, strikeDelay: 0.95,
        dmg: 30,                    // one-shot per enemy caught by the disc
        falloff: { rule: "none — disc r 0.18→2.23 m over 0.85 s, per-prism test" },
        // ccMag 40: damageable converts stun on ELITE/BOSS to poise ×1.5
        // → exactly the §5.2 "60 stance dmg instead" row.
        cc: { type: "stun", dur: 1.5, mag: 40 },
        poise: 60,                  // the stance-break tool
        hazard: { standSMin: 34, standSMax: 42, slowPct: 25, shatterDmg: 4,
            flingImpactDmg: 15, flingImpactStunS: 1 },
        mana: 30, cooldown: 10,
    },
    /** Great Vortex — Vortex (engine key 5). */
    4: {
        name: "Great Vortex", engineKey: 5, strikeDelay: 0.98,
        dmg: 15,                    // DPS inside ring, ×env (~55 over a full hold)
        totalApproxDmg: 55, flingImpactDmg: 20,
        falloff: { rule: "none inside ring; DoT tick mirrors 45 Hz _strip throttle" },
        cc: { type: "lift", dur: 0, mag: 0 },
        flingRangeM: [8, 12],       // along aim on release/fade
        wallImpact: { dmg: 15, stunS: 1 },
        ringM: [0.9, 3.1], heightM: 4.8,
        durS: { ramp: 0.55, hold: 3.0, fade: 1.1, total: 4.65 },
        poise: 8,                   // per tick
        mana: 45, cooldown: 14,
    },
};

/** Spell unlock levels (progression §7), keyed like SPELLS. */
export const UNLOCKS = { LMB: 1, 1: 1, 2: 2, 3: 4, 4: 6 };

/** Augment unlock levels (progression §7): L9 Bolt, 12 Wave, 15 Spikes,
 *  20 Mini-Vortex, 25 Great Vortex. */
export const AUGMENTS = { LMB: 9, 1: 12, 3: 15, 2: 20, 4: 25 };

/* ------------------------------------------------------------------ *
 * TIER table — combat §2.0 bands, §5.1 poise, §6.1 costs;
 * tierMult = cost/3 (progression §3.2; boss 10 = realm-boss repeat rule)
 * ------------------------------------------------------------------ */

/** Indexed by TIER.* (damageable ids). */
export const TIER_TABLE = [
    { name: "fodder", hpBand: [24, 40], dmgBand: [3, 9], cost: 1,
        tierMult: 1 / 3, poiseBand: [10, 20], poiseRegenS: 4 },
    { name: "light", hpBand: [40, 75], dmgBand: [4, 18], cost: 2,
        tierMult: 2 / 3, poiseBand: [15, 35], poiseRegenS: 5 },
    { name: "medium", hpBand: [80, 110], dmgBand: [6, 14], cost: 3,
        tierMult: 1, poiseBand: [15, 35], poiseRegenS: 5 },
    { name: "heavy", hpBand: [260, 480], dmgBand: [12, 28], cost: 5,
        tierMult: 5 / 3, poiseBand: [90, 140], poiseRegenS: 6 },
    { name: "elite", hpBand: [380, 680], dmgBand: [14, 30], cost: 8,
        tierMult: 8 / 3, poiseBand: [110, 150], poiseRegenS: 8 },
    // Boss: stance meter, Sekiro drain (20/s after 3 s without poise
    // damage); tierMult 10 is the REPEAT-kill rule; first kills pay the
    // flat % grants in BOSSES/XP.objectivePct instead.
    { name: "boss", hpBand: [760, 3000], dmgBand: [0, 0], cost: 25,
        costMax: 40, tierMult: 10, poiseBand: [220, 300], poiseRegenS: 0,
        stanceDrainPerS: 20, stanceIdleS: 3 },
];

/** Miniboss repeat-kill XP multiplier (progression §3.2). */
export const MINIBOSS_REPEAT_MULT = 8 / 3;

/* ------------------------------------------------------------------ *
 * ENEMIES — all 30 roster rows (combat §2.1–2.3), level-10 anchor.
 * `cost` is the per-unit §6.1 budget cost (drives XP: mult = cost/3 —
 * sprites budget as casters 3, ambushers 3, assassins 4, brutes 5,
 * automaton/sentinels 8). telegraphMs[] follows the doc column order,
 * aligned with damages[] where lengths match; `red` = indices with a
 * red (unblockable/must-move) cue. Field variants only — boss-arena
 * variants live in BOSSES (§2.4).
 * ------------------------------------------------------------------ */

export const ENEMIES = [
    // -------- Cold (realm 1, band 1–10) --------
    { key: "rimeImp", name: "Rime Imp", realm: "cold", archetype: "swarm-melee",
        tier: TIER.FODDER, cost: 1, hp: 24, speed: 6.2, perceptionM: 25,
        attackRangeM: 1.2, gapCloserM: 4, poiseMax: 10,
        damages: [
            { name: "rake", dmg: 4, hits: 3 },
            { name: "pounce", dmg: 8, note: "+15% slow 1.5 s" },
            { name: "spit", dmg: 3 }],
        telegraphMs: [500, 650, 600],
        special: "Pack Call: first spotter aggros all imps in 30 m; +15% atk speed per nearby imp (cap 3)" },

    { key: "glacierBrute", name: "Glacier Brute", realm: "cold", archetype: "tank",
        tier: TIER.ELITE, cost: 5, hp: 520, carapaceHp: 260,
        speed: 3.2, burstSpeed: 4.0, perceptionM: 18,
        attackRangeM: 2.5, gapCloserM: 8, poiseMax: 120, hyperArmor: true,
        damages: [
            { name: "slam", dmg: 22, note: "4 m ring" },
            { name: "sweep", dmg: 16, note: "+launch" },
            { name: "ram", dmg: 18 }],
        telegraphMs: [1200, 900, 1000], red: [2],
        special: "Rime Carapace: 260 over-health; while up immune to Wave KB & Vortex fling; Spikes crack ×3. Shatter → flingable but +25% speed" },

    { key: "frostStalker", name: "Frost Stalker", realm: "cold", archetype: "ambusher-pursuer",
        tier: TIER.LIGHT, cost: 3, hp: 50, speed: 7.0, submergedSpeed: 13,
        leashM: 60, perceptionM: 15, attackRangeM: 8, poiseMax: 20,
        damages: [
            { name: "pounce", dmg: 18 },
            { name: "rake", dmg: 7, hits: 2 },
            { name: "backflip", dmg: 9 }],
        telegraphMs: [700, 550, 500],
        special: "Powder Dive: submerged wake-ripple, bolt-immune; pursues at 13 m/s up to 60 m. Erupts when player <10 m/s or <8 m. Mini-Vortex on the wake → out, stunned 1.5 s" },

    { key: "hoarfrostSprite", name: "Hoarfrost Sprite", realm: "cold", archetype: "ranged-caster",
        tier: TIER.FODDER, cost: 3, hp: 28, speed: 4.5, perceptionM: 30,
        attackRangeM: 25, poiseMax: 10,
        damages: [
            { name: "bolt", dmg: 5, hits: 3, note: "12 m/s, light homing" },
            { name: "shardNova", dmg: 9 }],
        telegraphMs: [600, 500],
        special: "Glimmer Blink: 6 m teleport (chime tell) when aimed at >1 s or approached <5 m; 4 s cd. Death: 2 m slow-field" },

    { key: "moraineColossus", name: "Moraine Colossus", realm: "cold", archetype: "elite",
        tier: TIER.ELITE, cost: 8, hp: 640, speed: 3.0, perceptionM: 22,
        attackRangeM: 3, gapCloserM: 20, poiseMax: 150, hyperArmor: true,
        damages: [
            { name: "haymaker", dmg: 26 },
            { name: "stomp", dmg: 18, note: "+pop-up" },
            { name: "crush", dmg: 22 }],
        telegraphMs: [1300, 1000, 1100], red: [1],
        special: "Avalanche Charge: 20 m line, 1500 ms red; steered into rock/ice = 4 s stun — the only fling window. Boss variant: Moraine Elder" },

    { key: "rimeboundCultist", name: "Rimebound Cultist", realm: "cold", archetype: "ranged-caster",
        tier: TIER.LIGHT, cost: 3, hp: 55, speed: 4.6, perceptionM: 30,
        attackRangeM: 30, poiseMax: 25,
        damages: [
            { name: "runeBolt", dmg: 8, hits: 2, note: "16 m/s" },
            { name: "glyphSnare", dmg: 14, note: "+root 1.5 s, 1200 ms decal" },
            { name: "lash", dmg: 10 }],
        telegraphMs: [700, 1200, 500],
        special: "Rime Ritual: channel shields allies in 15 m (-50% frost dmg). Kill or Spike-stun mid-channel → shield shatters, tethered allies stagger 0.7 s" },

    { key: "blizzardAssassin", name: "Blizzard Assassin", realm: "cold", archetype: "assassin",
        tier: TIER.LIGHT, cost: 4, hp: 48, speed: 8.0, burstSpeed: 16,
        perceptionM: 12, attackRangeM: 10, poiseMax: 15,
        damages: [
            { name: "dashSlash", dmg: 16 },
            { name: "needles", dmg: 4, hits: 3, note: "+Chill; 14 m range" },
            { name: "execution", dmg: 8, hits: 4, note: "= 32 stealth opener" }],
        telegraphMs: [500, 550, 600],
        special: "Whiteout Cloak: near-invisible circling; cyan seams flicker 0.5 s pre-strike. Wave strips cloak; never cloaks while Chilled" },

    { key: "glassRevenant", name: "Glass Revenant", realm: "cold", archetype: "skirmisher-scout",
        tier: TIER.LIGHT, cost: 2, hp: 45, coreHp: 20, speed: 6.4,
        perceptionM: 35, attackRangeM: 1.5, gapCloserM: 4, poiseMax: 20,
        damages: [
            { name: "slash", dmg: 8, hits: 2 },
            { name: "shardLance", dmg: 14 },
            { name: "prismFlurry", dmg: 6, hits: 4 }],
        telegraphMs: [500, 800, 700],
        special: "Refreeze: leaves heart-core, regrows in 4 s unless core destroyed; Wave scatters shards (+2 s). Living alarm: pings all enemies in 40 m on spot" },

    { key: "packIceGolem", name: "Pack-Ice Golem", realm: "cold", archetype: "tank-golem",
        tier: TIER.HEAVY, cost: 5, hp: 300, cores: 5, coreHpEach: 60,
        speed: 2.0, perceptionM: 16, attackRangeM: 3, poiseMax: 0,
        construct: true,
        damages: [
            { name: "piston", dmg: 20 },
            { name: "pound", dmg: 16, note: "5 m ring, +launch" },
            { name: "swat", dmg: 14 }],
        telegraphMs: [900, 1300, 1000],
        special: "Crystal Cores: body invulnerable, bolts deflect; only the 5 crystals damage. Knee → -50% speed; shoulder → arm lost; crown → kill. Boss variant: Shrinebreaker" },

    { key: "hailPlateGuard", name: "Hail Plate Guard", realm: "cold", archetype: "warden-tank",
        tier: TIER.HEAVY, cost: 5, hp: 300, speed: 3.0, perceptionM: 30,
        attackRangeM: 1.8, gapCloserM: 4, poiseMax: 100,
        damages: [
            { name: "hook", dmg: 18, note: "+stagger" },
            { name: "check", dmg: 12 },
            { name: "hailStomp", dmg: 14, note: "3 m ring" }],
        telegraphMs: [800, 700, 1100],
        special: "Hailstone Bulwark: planted — immune to KB AND fling; frontal bolts ricochet as hail chips (3 dmg to player <4 m). Breaks from behind or Spike-stun" },

    // -------- Sand (realm 2, band 8–20) --------
    { key: "duneImp", name: "Dune Imp", realm: "sand", archetype: "swarm-melee",
        tier: TIER.FODDER, cost: 1, hp: 30, speed: 6.2, perceptionM: 18,
        attackRangeM: 1.2, gapCloserM: 4, poiseMax: 10,
        damages: [
            { name: "rake", dmg: 5, hits: 2 },
            { name: "pounce", dmg: 9 },
            { name: "gritFling", dmg: 0, note: "1 s aim-blur; pack bite +25% w/ 3+ latched" }],
        telegraphMs: [500, 650, 550],
        special: "Dune Dive: pack submerges, travels as mounds, resurfaces surrounding the player. Wave/Vortex scatters the ring" },

    { key: "duneBrute", name: "Dune Brute", realm: "sand", archetype: "tank",
        tier: TIER.ELITE, cost: 5, hp: 680, speed: 2.2, perceptionM: 22,
        attackRangeM: 2.5, gapCloserM: 12, poiseMax: 140, hyperArmor: true,
        damages: [
            { name: "slam", dmg: 26, note: "3 m ring" },
            { name: "sweep", dmg: 20 },
            { name: "bulldoze", dmg: 24 },
            { name: "grabHurl", dmg: 28 }],
        telegraphMs: [1300, 1000, 1500, 900], red: [2],
        special: "Anchored Mass: fully immune to Wave KB and Vortex fling; Spike-stun is the ONLY opener (visor weak window ×2 dmg, 2.5 s). Boss variant: Gatekeeper of Brass" },

    { key: "dustStalker", name: "Dust Stalker", realm: "sand", archetype: "ambusher-pursuer",
        tier: TIER.LIGHT, cost: 3, hp: 55, speed: 7.8, submergedSpeed: 13,
        leashM: 60, perceptionM: 12, attackRangeM: 8, poiseMax: 15,
        damages: [
            { name: "opener", dmg: 26, note: "~3× stealth opener" },
            { name: "flurry", dmg: 6, hits: 3 },
            { name: "hamstring", dmg: 10, note: "+2 s surf-slow" }],
        telegraphMs: [600, 500, 550],
        special: "Sand Shroud: dust-ripple stalking; pursues submerged 13 m/s up to 60 m; goggle-immune to blinds/spray. Mini-Vortex on the ripple → out, stunned 1.5 s" },

    { key: "dustMage", name: "Dust Mage", realm: "sand", archetype: "mage",
        tier: TIER.LIGHT, cost: 3, hp: 60, speed: 4.6, perceptionM: 32,
        attackRangeM: 28, poiseMax: 25,
        damages: [
            { name: "gritBolt", dmg: 9, note: "14 m/s" },
            { name: "sandblast", dmg: 12, note: "+KB" },
            { name: "dustDevil", dmg: 4, note: "per s, chases 6 s" },
            { name: "glassLance", dmg: 22, note: "30 m/s; 1500 ms red channel, interruptible" }],
        telegraphMs: [700, 550, 800, 1500], red: [3],
        special: "Mirage Step: on hit blinks 8 m leaving a crumbling clone; 6 s cd — Mini-Vortex covers the radius; sustained pressure wins" },

    { key: "scourScout", name: "Scour Scout", realm: "sand", archetype: "skirmisher",
        tier: TIER.MEDIUM, cost: 3, hp: 95, speed: 6.5, perceptionM: 20,
        attackRangeM: 1.5, gapCloserM: 12, poiseMax: 35,
        damages: [
            { name: "slash", dmg: 8, hits: 2 },
            { name: "gritKnife", dmg: 7 },
            { name: "slideKick", dmg: 10, note: "ducks under Wave" }],
        telegraphMs: [550, 600, 700],
        special: "Wind Sprint: lateral bursts break bolt tracking. Hunts in pairs, one flanking. Forearm plate parries 1 bolt/engagement" },

    { key: "duneSentinel", name: "Dune Sentinel", realm: "sand", archetype: "sentinel",
        tier: TIER.ELITE, cost: 8, hp: 380, speed: 3.2, perceptionM: 35,
        attackRangeM: 3.5, poiseMax: 110,
        damages: [
            { name: "sweep", dmg: 18 },
            { name: "chop", dmg: 30 },
            { name: "stompQuake", dmg: 14, note: "4 m, interrupts casts" }],
        telegraphMs: [900, 1400, 1000], red: [1],
        special: "Watchman's Horn: 35 m sightline; horn pulls every imp/bandit in 30 m. Kill first from 36–40 m — the pick-off lesson" },

    { key: "duneWarden", name: "Dune Warden", realm: "sand", archetype: "boss",
        tier: TIER.BOSS, cost: 25, hp: 2400, speed: 4.8, perceptionM: 35,
        attackRangeM: 2.5, poiseMax: 220,
        damages: [
            { name: "sandSlash", dmg: 18, note: "crescent arc projectile, 14 m/s — anti-camp, active from bell" },
            { name: "khopeshChain", dmg: 12, hits: 3, note: "chain 12/12/16 @700 ms; P3 adds a 4th hit" },
            { name: "wardensSlam", dmg: null, note: "leaping point-blank AoE knockdown (CC token); §7.4 defines no damage number" },
            { name: "geyser", dmg: 10, note: "+launch; environmental, 1.2 s decal, 4 s cycle (P3)" }],
        telegraphMs: [800, 700, 1100, 1200], red: [2],
        special: "Sand Ward dome (eats outside bolts; Mini-Vortex collapses 12 s) + Decree troop command. Full script: BOSSES.duneWarden / §7.4" },

    { key: "scorpionHusk", name: "Scorpion Husk", realm: "sand", archetype: "ambusher",
        tier: TIER.LIGHT, cost: 3, hp: 50, speed: 6.8, perceptionM: 10,
        attackRangeM: 2, poiseMax: 15,
        damages: [
            { name: "sting", dmg: 12, note: "+Sun Venom 3/s × 5 s, -25% surf" },
            { name: "claws", dmg: 6, hits: 2 },
            { name: "grappleSting", dmg: 16, note: "break with Wave" }],
        telegraphMs: [500, 500, 700],
        special: "Buried Ambush: persistent tell <15 m (trickle plume + shimmer + chitin tick); on 10 m trigger 500 ms crack-cue then eruption. Venom makes fleeing wrong, Spike-stun right" },

    { key: "hourglassAutomaton", name: "Hourglass Automaton", realm: "sand", archetype: "elite-golem",
        tier: TIER.HEAVY, cost: 8, hp: 420, speed: 2.8, perceptionM: 30,
        attackRangeM: 3, poiseMax: 120, construct: true,
        damages: [
            { name: "piston", dmg: 20 },
            { name: "gyreFlail", dmg: 12, note: "per rev, walking 360" },
            { name: "sandJet", dmg: 8, note: "cone" },
            { name: "grindGrab", dmg: 18, note: "break with Wave" }],
        telegraphMs: [800, 1200, 700, 900],
        special: "Reassembly: at 0 HP collapses to a sand pile, rebuilds in 4 s at 50% HP — bolting the pile freezes it: permanent kill" },

    { key: "windscourBandit", name: "Windscour Bandit", realm: "sand", archetype: "skirmisher",
        tier: TIER.MEDIUM, cost: 3, hp: 90, speed: 5.0, perceptionM: 26,
        attackRangeM: 1.8, gapCloserM: 10, poiseMax: 30,
        damages: [
            { name: "slash", dmg: 9, hits: 2 },
            { name: "gritBlind", dmg: 0, note: "1.5 s blind" },
            { name: "bootShove", dmg: 6, note: "+KB; flank rush +30% dmg from off-camera" }],
        telegraphMs: [600, 550, 500],
        special: "Pack Doctrine: never alone — 3–5 strong, one circling off-camera, one blinding frontally. Great Vortex is the designed wipe" },

    // -------- Ash (realm 3, band 18–30) --------
    { key: "cinderImp", name: "Cinder Imp", realm: "ash", archetype: "swarm-melee",
        tier: TIER.FODDER, cost: 1, hp: 34, speed: 6.2, perceptionM: 16,
        attackRangeM: 1.0, gapCloserM: 3.5, poiseMax: 10,
        damages: [
            { name: "rake", dmg: 5, hits: 2 },
            { name: "lunge", dmg: 8 },
            { name: "frenzyBite", dmg: 2, note: "DoT per s, 3+ latched" }],
        telegraphMs: [500, 600],
        special: "Ash-drift pop: sleeps buried, erupts in packs of 3–6; death cinder puff 3 dmg point-blank — kill at range" },

    { key: "slagBrute", name: "Slag Brute", realm: "ash", archetype: "tank",
        tier: TIER.ELITE, cost: 5, hp: 560, speed: 2.2, perceptionM: 22,
        attackRangeM: 2.5, gapCloserM: 8, poiseMax: 140, hyperArmor: true,
        damages: [
            { name: "slam", dmg: 28, note: "3 m stagger ring" },
            { name: "backhand", dmg: 22, note: "+hard KB" },
            { name: "slagCharge", dmg: 26 }],
        telegraphMs: [1300, 900, 1200], red: [2],
        special: "Too heavy to fling: Wave KB immune; Great Vortex only slows 50%. Charge into rock/Spike wall = 1.5 s self-stagger; Spike-stun = the window" },

    { key: "scorchRaider", name: "Scorch Raider", realm: "ash", archetype: "skirmisher-pursuer",
        tier: TIER.LIGHT, cost: 2, hp: 75, speed: 6.6, burstSpeed: 17,
        leashM: 60, perceptionM: 30, attackRangeM: 1.5, gapCloserM: 12,
        poiseMax: 25,
        damages: [
            { name: "combo", dmg: 7, hits: 3, note: "side-stepping" },
            { name: "emberFlick", dmg: 8, note: "+burn 1/s × 3" },
            { name: "cuttingLunge", dmg: 14, note: "punishes cast commits" }],
        telegraphMs: [550, 600, 650],
        special: "Slope-chaser: pursues at near-surf speed (toboggan 17 m/s downslope), flanking both sides — Ash's anti-kite answer" },

    { key: "smokeMage", name: "Smoke Mage", realm: "ash", archetype: "mage",
        tier: TIER.LIGHT, cost: 3, hp: 65, speed: 3.4, perceptionM: 35,
        attackRangeM: 35, poiseMax: 20,
        damages: [
            { name: "smolderBolt", dmg: 12, note: "8 m/s weaving homing — break LoS or Wave-detonate" },
            { name: "ashPall", dmg: 5, note: "per s × 6 s; 8 m cloud, hides allies; 1200 ms lob decal" },
            { name: "emberLash", dmg: 14 }],
        telegraphMs: [800, 1200, 550],
        special: "Smoke-step: at <8 m or on heavy hit re-forms 12–15 m away (2 s cd, max ×2). Spike-stun interrupts: stun → burst" },

    { key: "cinderSentinel", name: "Cinder Sentinel", realm: "ash", archetype: "sentinel",
        tier: TIER.HEAVY, cost: 8, hp: 260, speed: 4.8, perceptionM: 35,
        attackRangeM: 4, poiseMax: 90,
        damages: [
            { name: "sweep", dmg: 16 },
            { name: "advancingThrust", dmg: 20, note: "beats backpedal — side-dodge" },
            { name: "crestBash", dmg: 12, note: "interrupts casts <3 m" }],
        telegraphMs: [900, 800, 600],
        special: "Beacon crest: 3 s ignition pings all ash enemies in 40 m; kill or Spike-stun during ignition cancels. Fixed patrols; snipe window 36–40 m" },

    { key: "sootAssassin", name: "Soot Assassin", realm: "ash", archetype: "assassin",
        tier: TIER.LIGHT, cost: 4, hp: 40, speed: 8.5, burstSpeed: 17,
        perceptionM: 12, attackRangeM: 8, poiseMax: 12,
        damages: [
            { name: "backstab", dmg: 30, note: "3× stealth opener" },
            { name: "flurry", dmg: 6, hits: 4, note: "soot slip dodges next projectile" }],
        telegraphMs: [500, 550],
        special: "Soot veil: heat-shimmer-only visibility while stationary/walking; punishes cast/carve commits. Wave/Vortex clipping the shimmer strips veil 6 s" },

    { key: "sootStalker", name: "Soot Stalker", realm: "ash", archetype: "ambusher",
        tier: TIER.LIGHT, cost: 3, hp: 70, speed: 7.0, submergedSpeed: 13,
        perceptionM: 20, attackRangeM: 0, poiseMax: 18,
        damages: [
            { name: "eruptionPounce", dmg: 18, note: "knocks off surf line" },
            { name: "hookedRake", dmg: 8, hits: 2, note: "+Shredded: +15% dmg taken 4 s" }],
        telegraphMs: [550, 500],
        special: "Ash-swimming: moving mound under the crust; untargetable submerged except Mini-Vortex on the mound (out, stunned). Pairs alternate opposite-side pounces" },

    { key: "scorchWarden", name: "Scorch Warden", realm: "ash", archetype: "warden",
        tier: TIER.HEAVY, cost: 5, hp: 480, speed: 3.0, perceptionM: 35,
        attackRangeM: 2.5, poiseMax: 130,
        damages: [
            { name: "maceSlam", dmg: 26, note: "2 m splash" },
            { name: "chainDrag", dmg: 0, note: "reels 6 m — break with perpendicular dash; 14 m range" },
            { name: "suppressionStomp", dmg: 16, note: "5 m, interrupts casts" }],
        telegraphMs: [1100, 1000, 900], red: [1],
        special: "Warding rune field: 12 m zone, player spell dmg -30%, vortex durations halved. Bolts from OUTSIDE hit full — range discipline" },

    { key: "volcanicPlateKnight", name: "Volcanic Plate Knight", realm: "ash", archetype: "boss",
        tier: TIER.BOSS, cost: 40, hp: 3000, speed: 1.8, perceptionM: 35,
        attackRangeM: 3, poiseMax: 300,
        damages: [
            { name: "seismicPunch", dmg: null, note: "12 m traveling fissure, ground line decal; §7.6 defines no damage number" },
            { name: "magmaVeinSweep", dmg: null, note: "200° low scythe — jump it (ollie clears); §7.6 defines no damage number" },
            { name: "basaltLob", dmg: null, note: "2.0 s full-flight lead, 2 m airburst, 5 m burst, 30 m range, 1.0 s shadow read; §7.6 defines no damage number" },
            { name: "cracklineEruption", dmg: 8, note: "per s per re-ignited scar line, 4 s — environmental, no hard CC" }],
        telegraphMs: [1200, 1400, 1500], red: [1, 2],
        special: "Progressive Fracture 3-stage enrage; scar-economy arena. Full script: BOSSES.volcanicPlateKnight / §7.6" },

    { key: "furnaceGuardian", name: "Furnace Guardian", realm: "ash", archetype: "boss",
        tier: TIER.BOSS, cost: 25, hp: 2200, speed: 2.0, perceptionM: 25,
        attackRangeM: 5, poiseMax: 260,
        damages: [
            { name: "furnaceVent", dmg: null, note: "8 m cone, doubles to 16 m × 2 s sustain at white heat; §7.5 defines no damage number" },
            { name: "slagSpit", dmg: 16, note: "+burn 1/s × 3; leads target, 1.5 s flight, 4 m decal (anti-camp >12 m)" },
            { name: "stokePulse", dmg: null, note: "10 m heat ring at white, 1000 ms red (P2+); §7.5 defines no damage number" },
            { name: "grateGrapple", dmg: 6, note: "per 0.5 s channel, grabs <2.5 m, mash out (CC token)" }],
        telegraphMs: [1000], red: [0],
        special: "Furnace core duel: core stokes dim→orange→white ~30 s; bolts through the grate douse it — 3 stages = 5 s stun + ×1.5 weak point. Full script: BOSSES.furnaceGuardian / §7.5" },
];

/* ------------------------------------------------------------------ *
 * BOSSES — 6 summary rows (combat §7, §2.4; progression §3.2/§5.4)
 * ------------------------------------------------------------------ */

/** Shared boss structure (combat §7 preamble + §5.1 boss poise row). */
export const BOSS_COMMON = {
    transitionInvulnS: [2, 4],
    addRespawnMinS: 25,
    attackRateMultWithAdds: 0.6,   // boss attack rate −40% while adds live
    stanceDrainPerS: 20, stanceIdleS: 3,   // Sekiro drain model
    breakWindowS: [3, 5], breakDmgMult: [1.5, 2],
    hardCcImmune: true,
    hpMultVsRegular: [8, 12], dmgMultVsRegular: 1.5,   // progression §5.4
};

export const BOSSES = [
    { key: "shrinebreaker", name: "Pack-Ice Golem, 'The Shrinebreaker'",
        realm: "cold", kind: "miniboss", baseKey: "packIceGolem",
        hp: 760, coreHp: { crown: 200, shoulder: 140, knee: 140 },   // 200+2×140+2×140
        stance: null,           // core-gated, no stance meter
        arenaM: 28, phaseCores: [2, 4],   // escalation after 2 and 4 cores broken
        firstKillPct: 20, repeatTierMult: MINIBOSS_REPEAT_MULT,
        antiCamp: { name: "Shrine Masonry Lob", dmg: 18, staggerS: 0.5,
            triggerM: 15, triggerS: 4, flightS: 2, decalM: 5, cadenceS: 6 },
        targetMin: [2, 3] },

    { key: "moraineElder", name: "Moraine Colossus, 'The Moraine Elder'",
        realm: "cold", kind: "realmBoss", baseKey: "moraineColossus",
        hp: 2000, stance: 240, arenaM: 34, fixedLevel: 10,
        phasePct: [70, 40], pillars: 6,   // 6 wall-stuns total; fling only during stun (+80)
        firstKillPct: 35, repeatTierMult: 10,
        antiCamp: { name: "Ice Boulder Mortar", dmg: null, triggerM: 20,
            triggerS: 6, flightS: 2, decalM: 5 },
        targetMin: [2.5, 3] },

    { key: "gatekeeperOfBrass", name: "Dune Brute, 'Gatekeeper of Brass'",
        realm: "sand", kind: "miniboss", baseKey: "duneBrute",
        hp: 1500, stance: 220, arenaM: 25, phasePct: [50],
        firstKillPct: 20, repeatTierMult: MINIBOSS_REPEAT_MULT,
        antiCamp: { name: "Brass Slab Throw", dmg: 20, knockdown: true,
            triggerM: 14, triggerS: 4, speedMS: 14, cueMs: 900 },
        targetMin: [2, 2] },

    { key: "duneWarden", name: "Dune Warden, 'Warden of the Sundered Gate'",
        realm: "sand", kind: "realmBoss", baseKey: "duneWarden",
        hp: 2400, stance: 220, arenaM: 36, fixedLevel: 20,
        phasePct: [70, 40],
        firstKillPct: 35, repeatTierMult: 10,
        antiCamp: { name: "Sand Slash", dmg: 18, speedMS: 14, cueMs: 800 },
        targetMin: [3.5, 4] },

    { key: "furnaceGuardian", name: "Furnace Guardian",
        realm: "ash", kind: "miniboss", baseKey: "furnaceGuardian",
        hp: 2200, stance: 260, arenaM: 26, phasePct: [60, 30],
        douse: { stages: 3, stunS: 5, weakMult: 1.5, stokeCycleS: 30 },
        firstKillPct: 20, repeatTierMult: MINIBOSS_REPEAT_MULT,
        antiCamp: { name: "Slag Spit", dmg: 16, burnPerS: 1, burnS: 3,
            triggerM: 12, triggerS: 4, flightS: 1.5, decalM: 4 },
        targetMin: [3, 3] },

    { key: "volcanicPlateKnight", name: "Volcanic Plate Knight",
        realm: "ash", kind: "realmBoss", baseKey: "volcanicPlateKnight",
        hp: 3000, stance: 300, arenaM: 40, fixedLevel: 30,
        phasePct: [65, 35],
        fracture: { dmgTakenMult: 1.2, atkSpeedMult: 1.12, scarBurnS: [4, 7, 10] },
        firstKillPct: 35, repeatTierMult: 10,
        antiCamp: { name: "Basalt Lob", dmg: null, rangeM: 30, flightS: 2,
            burstM: 5, airburstM: 2, readS: 1 },
        targetMin: [4, 5] },
];

/* ------------------------------------------------------------------ *
 * XP — progression §2–§3
 * ------------------------------------------------------------------ */

export const XP = {
    // Curve: XP_to_next(1) = 50 flat; round(85 × L^1.9) for L 2..29; cap 30.
    curveCoef: 85, curveExp: 1.9, level1Override: 50, levelCap: 30,
    // Kill: BaseKillXP(L) = round(10 × L^1.25); min(eL, pL) con base.
    killCoef: 10, killExp: 1.25,
    /** Per-kill cap: max(12.5% of xpToNext(pL), baseKillXP(pL)). The flat
     *  boss/objective grants (§3.5) are the only exemption. */
    perKillCapFrac: 0.125,
    /** tierMult by TIER index = budget cost / 3 (boss 10 = realm-boss
     *  repeat rule; miniboss repeats use MINIBOSS_REPEAT_MULT). Per-enemy
     *  costs override via killXP's `cost` arg (sprite/ambusher 3 → ×1,
     *  assassin 4 → ×4/3, brute 5 → ×5/3). */
    tierMult: [1 / 3, 2 / 3, 1, 5 / 3, 8 / 3, 10],
    /** Con table (§3.3) — first row where diff >= min wins; one table
     *  feeds both color and multiplier so the UI can never lie. */
    conTable: [
        { min: 5, color: "skull", mult: 1.5 },
        { min: 3, color: "orange", mult: 1.25 },
        { min: 1, color: "yellow", mult: 1.0 },
        { min: -3, color: "white", mult: 1.0 },
        { min: -4, color: "green", mult: 0.75 },
        { min: -5, color: "green", mult: 0.5 },
        { min: -6, color: "green", mult: 0.25 },
        { min: -Infinity, color: "gray", mult: 0.05 },
    ],
    /** §3.4 momentum multipliers (stack: base × tier × con × streak ×
     *  rested, then the per-kill cap). */
    streak: { startAtKill: 5, pctPerKill: 3, windowS: 4, capMult: 1.5 },
    rested: { mult: 2, bankPctPer8h: 50, bankCapPctOfLevel: 150 },
    /** §3.5 objective grants, % of xpToNext at player level (first-kill
     *  boss grants are once-per-boss via bossesKilled flags). */
    objectivePct: { shrineFirstActivation: 12, objectiveStep: 15,
        minibossFirstKill: 20, realmBossFirstKill: 35 },
    dummyFirstBloodXp: 20,
};

/* ------------------------------------------------------------------ *
 * SCALING — progression §5–§6
 * ------------------------------------------------------------------ */

export const SCALING = {
    hpPerLevel: 1.10, dmgPerLevel: 1.07, anchorLevel: 10,
    bands: { cold: [1, 10], sand: [8, 20], ash: [18, 30] },
    /** Regular-spawn offset variance: −1 (25%) | 0 (50%) | +1 (25%). */
    spawnOffsets: [-1, 0, 1], spawnOffsetOdds: [0.25, 0.75],   // cdf cuts
    eliteOffset: 2, eliteOverBandMax: 2,     // clamp(pL+2, min, max+2)
    minibossOffset: 2, minibossOverBandMin: 2, // clamp(pL+2, min+2, max)
    // Realm bosses: FIXED at bandMax (progression §5.4).
};

/* ------------------------------------------------------------------ *
 * Helpers — pure, allocation-free
 * ------------------------------------------------------------------ */

/**
 * XP required to go from level L to L+1 (progression §2.1).
 * @param {number} L player level (1..30)
 * @returns {number} 0 at/above cap
 */
export function xpToNext(L) {
    if (L >= XP.levelCap) return 0;
    if (L <= 1) return XP.level1Override;
    return Math.round(XP.curveCoef * Math.pow(L, XP.curveExp));
}

/**
 * BaseKillXP(L) = round(10 × L^1.25) — even-con medium kill value.
 * @param {number} L @returns {number}
 */
export function baseKillXP(L) {
    return Math.round(XP.killCoef * Math.pow(Math.max(1, L), XP.killExp));
}

/** Walk the con table; first row where diff >= min. @returns {number} row idx */
function _conRow(diff) {
    const t = XP.conTable;
    for (let i = 0; i < t.length; i++) if (diff >= t[i].min) return i;
    return t.length - 1;
}

/**
 * Con multiplier for an enemy vs the player (§3.3; capped ×1.5).
 * @param {number} playerL @param {number} enemyL @returns {number}
 */
export function conMult(playerL, enemyL) {
    return XP.conTable[_conRow(enemyL - playerL)].mult;
}

/**
 * Con color name — same table as conMult, so the UI can never lie.
 * @param {number} playerL @param {number} enemyL
 * @returns {"skull"|"orange"|"yellow"|"white"|"green"|"gray"}
 */
export function conColor(playerL, enemyL) {
    return XP.conTable[_conRow(enemyL - playerL)].color;
}

/**
 * Kill XP through the §3.1 formula: BaseKillXP(min(eL, pL)) × tierMult ×
 * conMult, then the per-kill cap max(12.5% of xpToNext(pL),
 * baseKillXP(pL)). Streak/rested multiply the RETURN of this before the
 * caller re-applies the same cap (or fold them in and cap once — the cap
 * is the last step per §3.4). First-kill boss flats are NOT this
 * function — they are XP.objectivePct grants gated on bossesKilled.
 * @param {number} enemyLevel
 * @param {number} tier TIER.* index (boss index applies the realm-boss
 *   repeat mult 10; pass MINIBOSS_REPEAT_MULT via `cost` 8 for miniboss
 *   repeats)
 * @param {number} playerLevel
 * @param {number} [cost] per-enemy §6.1 budget cost (ENEMIES[].cost) —
 *   overrides the tier mult with cost/3 (sprites 3, assassins 4, ...)
 * @returns {number} whole XP
 */
export function killXP(enemyLevel, tier, playerLevel, cost) {
    const mult = cost != null ? cost / 3 : XP.tierMult[tier] || 1;
    const base = baseKillXP(Math.min(enemyLevel, playerLevel));
    const raw = Math.round(base * mult * conMult(playerLevel, enemyLevel));
    const cap = Math.max(Math.round(XP.perKillCapFrac * xpToNext(playerLevel)),
        baseKillXP(playerLevel));
    return Math.min(raw, cap);
}

/**
 * Enemy HP at level eL from an L10 anchor row (progression §5.2).
 * @param {number} base row HP @param {number} eL @returns {number}
 */
export function scaleHP(base, eL) {
    return base * Math.pow(SCALING.hpPerLevel, eL - SCALING.anchorLevel);
}

/**
 * Enemy per-hit damage at level eL from an L10 anchor row.
 * @param {number} base row damage @param {number} eL @returns {number}
 */
export function scaleDmg(base, eL) {
    return base * Math.pow(SCALING.dmgPerLevel, eL - SCALING.anchorLevel);
}

/**
 * Spawn level for a realm (progression §5.1). Regular spawns roll the
 * −1/0/+1 (25/50/25) offset; pass `roll` for determinism (tests, seeded
 * spawners), else Math.random() — spawn-time only, never per-frame.
 * @param {"cold"|"sand"|"ash"} realm
 * @param {number} playerL
 * @param {number} [roll] 0..1
 * @param {"regular"|"elite"|"miniboss"|"boss"} [kind]
 * @returns {number} enemy level
 */
export function enemyLevelFor(realm, playerL, roll, kind) {
    const band = SCALING.bands[realm];
    const min = band[0], max = band[1];
    if (kind === "boss") return max;                       // fixed capstone
    if (kind === "elite") {
        return Math.min(max + SCALING.eliteOverBandMax,
            Math.max(min, playerL + SCALING.eliteOffset));
    }
    if (kind === "miniboss") {
        return Math.min(max,
            Math.max(min + SCALING.minibossOverBandMin,
                playerL + SCALING.minibossOffset));
    }
    const r = roll == null ? Math.random() : roll;
    const off = r < SCALING.spawnOffsetOdds[0] ? -1 :
        r < SCALING.spawnOffsetOdds[1] ? 0 : 1;
    return Math.min(max, Math.max(min, playerL + off));
}


/**
 * COMPATIBILITY AGGREGATE for combat/spellHits.js — the flat per-spell
 * shape its damage pass reads (recovered from the build fleet's parallel
 * author; values agree with SPELLS above — if you change one, change
 * both, or better: derive). Engine geometry constants (curve/arc/peak/
 * sink/envGate...) quote the spell sources the spec itself quotes.
 */
export const combatData = {
    /**
     * LMB — Frost Bolt (Ribbon thrown phase). COMBAT_DESIGN §1.1 Bolt row,
     * poise §5.1, hook §9.3.
     */
    bolt: {
        damage: 12,          // per hit, planted
        damageMoving: 7,     // §1.1 speed falloff: while horizontal speed > gate
        speedGate: 12,       // m/s — the anti-kite tax threshold
        regrace: 0.4,        // s below the gate before full damage restores
        variance: 0.10,      // ±10% max (§1.1; §5.3 keeps hit-counts exact)
        poise: 10,           // §5.1 per-hit poise
        chill: true,         // 1 stack per hit — suppressed above the gate
        splashDamage: 4,     // §1.1 on-hit splash, adjacent targets only
        splashRadius: 1.2,   // §1.1 "micro-AoE 0.6–1.2 m" — outer bound used
        padRadius: 0.205,    // projectile radius = ribbon tube RADIUS (§1.1 quotes 0.205 m)
    },

    /** Hold-LMB — held-whip mode. COMBAT_DESIGN §1.1 Bolt row, last line. */
    whip: {
        damage: 6,           // per tick
        tickRate: 4,         // ticks per second
        nudge: 1,            // m of knockback per tick
        radius: 0.205,       // capsule radius = the ribbon tube (§1.1: "tube radius 0.205 m")
    },

    /**
     * 1 — Frost Wave (Sweep). COMBAT_DESIGN §1.1 Wave row; the crescent
     * geometry is the spec quoting sweep.js (CURVE/ARC0/ARC1/PEAK/LIFE).
     */
    wave: {
        damage: 20,          // at arc centre, bell-tapered to 0 at the horns, ×env
        poise: 25,           // §5.1
        kbMag: 4,            // knockback 4 m (tier fractions live in the registry)
        curve: 5.5,          // crescent curvature radius (sweep.js CURVE)
        thick: 0.7,          // crest thickness ±0.7 m (§1.1)
        arc0: 0.52,          // half-angle at cast (sweep.js ARC0)
        arc1: 0.96,          // half-angle at full spread (sweep.js ARC1)
        peak: 2.15,          // crest height ×env — the "base below crest" gate (§1.1)
        life: 2.4,           // s (sweep.js LIFE)
        sink: 0.13,          // crest base sunk into the drift (sweep.js)
        envGate: 0.05,       // §9.3: hit test gated env ≥ 0.05, same as _plough
    },

    /** 2 — Mini-Vortex (Bloom). COMBAT_DESIGN §1.1 Mini-Vortex row. */
    bloom: {
        burstDamage: 35,     // at epicentre
        burstRim: 18,        // linear falloff target at the rim
        burstRadius: 2.0,    // one-shot sphere radius, m
        innerFrac: 0.4,      // 100% damage inside the inner 40% of the radius
        poise: 30,           // §5.1
        stagger: 0.7,        // s — direct SoA write (registry has no bare-stagger cc)
        slowFrac: 0.4,       // 40% slow
        slowDur: 1.5,        // s
        columnDps: 8,        // lingering column contact DPS
        columnRadius: 0.66,  // tube radius (bloom.js GIRTH)
        columnHeight: 5.6,   // ×env (bloom.js HEIGHT)
        columnLife: 1.75,    // s (bloom.js LIFE)
    },

    /** 3 — Crystal Spikes (Crystallize). COMBAT_DESIGN §1.1 Spikes row, §9.3. */
    spikes: {
        damage: 30,          // one-shot per enemy caught by the expanding disc
        poise: 60,           // §5.1 — the stance-break tool
        stunDur: 1.5,        // s (registry's §5.2 matrix scales it per tier)
        r0: 0.18,            // disc radius at first prism (§1.1: r 0.18→2.23)
        r1: 2.23,            // disc radius at last prism
        plantTime: 0.85,     // s (crystallize.js PLANT_TIME)
        count: 34,           // prisms per formation (crystallize.js COUNT)
        prismHeight: 1.75,   // tallest prism (crystallize.js) — vertical extent of the test
        baseSink: 0.25,      // mechanical slack below the epicentre for the capsule overlap
    },

    /** 4 — Great Vortex (Vortex). COMBAT_DESIGN §1.1 Great Vortex row, §9.3. */
    vortex: {
        dps: 15,             // ×env inside the ring
        poisePerSec: 8,      // §5.1 "Vortex 8/tick" read as per-second — see spellHits note
        tickHz: 45,          // per-enemy accumulator mirrors the 45 Hz _strip throttle
        tickCap: 0.05,       // s — same frame-spike clamp _strip uses
        flingDamage: 20,     // +20 fling impact on release
        flingMin: 8,         // flung 8–12 m along the player's aim
        flingMax: 12,
        liftEnvGate: 0.5,    // §9.3: lift flag while inside ×env ≥ 0.5
        slowFrac: 0.5,       // §5.2: heavy tier 50% slow only (elite likewise "slow only")
        bossSlowFrac: 0.25,  // §5.2: boss slow 25% only
        slowRenew: 0.25,     // s — mechanical renewal window while inside (re-applied per tick)
        ramp: 0.55,          // vortex.js RAMP  (§1.1 quotes 0.55 + 3.0 + 1.1 = 4.65 s)
        hold: 3.0,           // vortex.js HOLD
        fade: 1.1,           // vortex.js FADE
        top: 4.8,            // column height ×env (vortex.js TOP)
    },
};
