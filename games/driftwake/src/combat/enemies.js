/**
 * Cold-realm enemy runtime — the four-archetype slice of COMBAT_DESIGN.md §2.1
 * on placeholder shard-construct bodies (combat/enemyVis.js; Meshy meshes come
 * later and replace the visual layer only — nothing in here knows what a body
 * looks like).
 *
 * SoA pool of MAX 24, allocation-free steady frames (ARCHITECTURE §0.3): every
 * array is preallocated in the constructor, brains are switch-dispatched per
 * archetype index, and no closure, object or string is created on the frame
 * path. All hit tests are analytic (dist/arc/segment-vs-capsule), per the
 * §9.1 contract.
 *
 * WHAT IS IMPLEMENTED, AND FROM WHERE (numbers are quoted, never invented):
 *   - Roster rows (§2.1): Rime Imp #1, Glacier Brute #2, Frost Stalker #3,
 *     Hoarfrost Sprite #4 — HP / damage / speed / perception / ranges /
 *     telegraph ms / poise are the table's L10 snapshots.
 *   - Anchor scaling (§0): HP = row × 1.10^(L−10), DMG = row × 1.07^(L−10).
 *     Behavior is level-invariant.
 *   - Perception FSM (§4.1): 130° sight cone at per-enemy range, 4 m proximity
 *     auto-detect, 12 m hearing on sprint/surf, alert propagation with the
 *     0.2–0.6 s per-ally stagger. (The intermediate "investigate" Alert state
 *     is deferred — Idle goes straight to Combat; flagged in the build notes.)
 *   - Attack tokens (§4.2): 2 melee slots global (+2 ranged for casters);
 *     acquire → attack → hold through recovery (+0.75 s) → release.
 *   - Melee telegraph: windup per the row's telegraph ms, then the strike
 *     tests range + arc against the player and takes controller.health down by
 *     the level-scaled damage; 0.5 s player i-frames after any enemy hit.
 *   - Enemy projectile pool (16): sprite 3-bolt volleys at 12 m/s with light
 *     homing (§2.1 #4), swept segment vs the player capsule r 0.5 h 1.8.
 *   - Leash (§4.3): 40 m from the spawn anchor (60 m for the stalker — the
 *     designated pursuer), 6 s outside → disengage, sprint home at 1.5×,
 *     full heal on arrival.
 *   - CC gates: stun/lift/slow through registry.speedMult(); stagger cancels
 *     windups (brute hyper-armor excepted, §3.4); knockback impulses consumed
 *     from registry.kbX/kbZ into a damped body velocity.
 *   - Death: registry.damage() already emitted the "kill" event (XP/floaters
 *     drain the ring); this file plays the 1.2 s dissolve + spray shatter and
 *     then registry.remove()s the slot.
 *
 * FRAME ORDER (§9.2): registry.update(dt) → enemies.update(dt) → spells.update.
 * Enemy melee runs BEFORE the spells so volumes test current-frame positions;
 * kills from the player's spells (which land later in the frame) are detected
 * next frame by the hp[slot] <= 0 check — robust against consumption order and
 * one frame of latency is below the telegraph floor by an order of magnitude.
 *
 * `dt === 0` (S.freezeTime): strict no-op, no divides by dt anywhere.
 */

import { TIER } from "./damageable.js";

/** Pool size for the Cold slice (owner brief). */
export const ENEMY_MAX = 24;
/** Enemy projectile pool (owner brief; §9.7 preallocates 64 for the full game). */
const BOLT_MAX = 16;

// ------------------------------------------------------------- spec constants
/** §4.2 — shared per-encounter pool: 2 melee + 2 ranged tokens. */
const MELEE_TOKENS = 2;
const RANGED_TOKENS = 2;
/** §4.2 — hold the token through recovery: attack duration + 0.75 s. */
const TOKEN_RECOVER_S = 0.75;
/** §4.1 — sight cone 130° horizontal → cos(65°). */
const SIGHT_COS = Math.cos((130 / 2) * (Math.PI / 180));
/** §4.1 — proximity auto-detect 4 m, 360°. */
const PROXIMITY_M = 4;
/** §4.1 — hearing: sprint footsteps / surf carving 12 m. */
const HEARING_M = 12;
/** §4.1 — combat broadcast: allies join staggered 0.2–0.6 s. */
const ALERT_STAGGER_MIN = 0.2;
const ALERT_STAGGER_RAND = 0.4;
/** §4.3 — outside the leash radius this long → disengage. */
const LEASH_EXIT_S = 6;
/** §4.3 — disengaged units sprint home at 1.5× speed. */
const RETURN_SPEED_MULT = 1.5;
/** §3.1 — non-token-holding swarm orbits at 4–8 m. */
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
/** Knockback impulse → damped velocity: v0 = impulse × rate, damp at rate/s,
 *  so total displacement equals the registry's impulse in metres. */
const KB_RATE = 5;
/** Light homing steer rate for sprite bolts, 1/s blend toward the target. */
const BOLT_HOME_RATE = 1.2;
/** Bolt time-to-live: cast range 25 m ÷ 12 m/s, plus homing slack. */
const BOLT_TTL = 3.0;
/** Seconds between bolts inside one 3-bolt volley. */
const VOLLEY_GAP_S = 0.18;
/** Sprite volley telegraph (weave-hands windup; ≥500 ms floor honoured). */
const SPRITE_WINDUP_S = 0.6;
/** Sprite volley cooldown (poke cadence; §3.3 gives a pattern, not a number). */
const SPRITE_CD_S = 2.5;
/** Imp attack cooldown (swarm chip cadence; tokens are the real limiter). */
const IMP_CD_S = 1.4;
/** §3.4 — brutes attack "1 per 3–4 s"; midpoint. */
const BRUTE_CD_S = 3.5;
/** Cooldown after a windup is cancelled by CC. */
const CANCEL_CD_S = 0.8;
/** Contact range after the stalker's eruption dash. */
const POUNCE_CONTACT_M = 1.6;
/** Height the lift CC suspends a body at. */
const LIFT_H = 1.4;

// ----------------------------------------------------------------- FSM states
const ST_IDLE = 0;
const ST_ALERTED = 1;   // joining combat after the propagation stagger
const ST_COMBAT = 2;
const ST_WINDUP = 3;
const ST_RECOVER = 4;
const ST_SUBMERGED = 5; // stalker Powder Dive pursuit
const ST_RETREAT = 6;   // stalker post-ambush disengage (§3.2 rule 4)
const ST_RETURN = 7;    // leash reset — sprint home, heal on arrival
const ST_FIRING = 8;    // sprite mid-volley
const ST_DYING = 9;

/** Archetype indices — align with enemyVis.js silhouettes. */
export const ARCH_IMP = 0;
export const ARCH_SPRITE = 1;
export const ARCH_STALKER = 2;
export const ARCH_BRUTE = 3;

/** Spawn keys, in archetype order. */
export const COLD_KEYS = ["rime_imp", "hoarfrost_sprite", "frost_stalker", "glacier_brute"];

/**
 * The Cold data slice — COMBAT_DESIGN.md §2.1, L10 snapshots, quoted verbatim.
 * A future shared combatData module may be passed to the constructor instead;
 * it must carry these fields per key.
 *
 * Registry tiers follow the §5.2 matrix as damageable.js implements it:
 * imps/sprites are fodder-band (§2.0), the stalker is light, and the Glacier
 * Brute takes the KB/lift-immune brute column (TIER.ELITE index 4 — "Rime
 * Carapace: immune to wave KB & vortex fling"; spike stuns convert to ×1.5
 * poise there, which is exactly the §3.4 stance-break opener).
 */
export const COLD_DATA = {
    rime_imp: {         // §2.1 #1 — swarm-melee
        name: "Rime Imp", arch: ARCH_IMP, tier: TIER.FODDER,
        hp: 24, poise: 10, speed: 6.2, perception: 25,
        atkRange: 1.2, dmg: 4, telegraphMs: 500, ring: 0,
        alertRadius: 30,    // Pack Call: first spotter aggros all imps in 30 m
        leash: 40, cooldown: IMP_CD_S,
        radius: 0.35, height: 0.9, hyperArmor: false,
    },
    hoarfrost_sprite: { // §2.1 #4 — ranged-caster
        name: "Hoarfrost Sprite", arch: ARCH_SPRITE, tier: TIER.FODDER,
        hp: 28, poise: 10, speed: 4.5, perception: 30,
        castRange: 25, dmg: 5, volley: 3, projSpeed: 12, telegraphMs: 600,
        blinkRange: 6, blinkCd: 4, blinkProx: 5, aimedS: 1,   // Glimmer Blink
        alertRadius: 12, leash: 40, cooldown: SPRITE_CD_S,
        radius: 0.35, height: 1.6, hyperArmor: false,
    },
    frost_stalker: {    // §2.1 #3 — ambusher / pursuer
        name: "Frost Stalker", arch: ARCH_STALKER, tier: TIER.LIGHT,
        hp: 50, poise: 20, speed: 7.0, subSpeed: 13, perception: 15,
        trigger: 8,         // erupts when the player closes within 8 m
        dmg: 18, telegraphMs: 700,   // pounce 18, eruption tell 700 ms
        alertRadius: 12,
        leash: 60,          // §4.3 — designated pursuers leash-extend to 60 m
        cooldown: 0,
        radius: 0.45, height: 0.8, hyperArmor: false,
    },
    glacier_brute: {    // §2.1 #2 — tank
        name: "Glacier Brute", arch: ARCH_BRUTE, tier: TIER.ELITE,
        hp: 520, poise: 120, speed: 3.2, perception: 18,
        atkRange: 2.5, dmg: 22, telegraphMs: 1200,
        ring: 4,            // slam 22 lands as a 4 m ring
        alertRadius: 12, leash: 40, cooldown: BRUTE_CD_S,
        radius: 0.9, height: 2.4, hyperArmor: true,   // §3.4 windup hyper-armor
    },
};

export class Enemies {
    /**
     * @param {import("three").Scene} scene held for future decal/telegraph work
     * @param {{heightAt(x:number,z:number):number}} terrain
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {Record<string, object>|null} data combatData Cold slice
     *        (COLD_DATA shape); null → the in-file spec table
     * @param {{emit(x:number,y:number,z:number,vx:number,vy:number,vz:number,
     *          size:number,life:number,kind:number,drag?:number):void}|null} spray
     */
    constructor(scene, terrain, registry, controller, data, spray) {
        this.scene = scene;
        this.terrain = terrain;
        this.registry = registry;
        this.controller = controller;
        this.spray = spray || null;
        /** @type {import("./enemyVis.js").EnemyVis|null} attach via attachVis(). */
        this.vis = null;

        const src = data || COLD_DATA;
        /** Archetype rows, indexed ARCH_*. @type {object[]} */
        this._rows = new Array(COLD_KEYS.length);
        for (let k = 0; k < COLD_KEYS.length; k++) {
            this._rows[k] = src[COLD_KEYS[k]] || COLD_DATA[COLD_KEYS[k]];
        }

        // ------------------------------------------------------ enemy SoA pool
        this.count = 0;                                   // live slots (dense scan)
        this.alive = new Uint8Array(ENEMY_MAX);
        this.key = new Uint8Array(ENEMY_MAX);             // archetype index
        this.id = new Int32Array(ENEMY_MAX).fill(-1);     // registry id
        this.level = new Uint8Array(ENEMY_MAX);
        this.x = new Float32Array(ENEMY_MAX);
        this.y = new Float32Array(ENEMY_MAX);
        this.z = new Float32Array(ENEMY_MAX);
        this.yaw = new Float32Array(ENEMY_MAX);
        this.homeX = new Float32Array(ENEMY_MAX);         // leash anchor (§4.3)
        this.homeZ = new Float32Array(ENEMY_MAX);
        this.state = new Uint8Array(ENEMY_MAX);
        this.stateT = new Float32Array(ENEMY_MAX);        // per-state countdown
        this.cd = new Float32Array(ENEMY_MAX);            // attack cooldown
        this.leashT = new Float32Array(ENEMY_MAX);        // seconds outside leash
        this.token = new Uint8Array(ENEMY_MAX);           // 1 melee, 2 ranged
        this.dmgScale = new Float32Array(ENEMY_MAX);      // 1.07^(L−10)
        this.kbvX = new Float32Array(ENEMY_MAX);          // consumed knockback vel
        this.kbvZ = new Float32Array(ENEMY_MAX);
        this.speedNow = new Float32Array(ENEMY_MAX);      // for vis speed01
        this.flash = new Float32Array(ENEMY_MAX);         // telegraph 0..1
        this.lunge = new Float32Array(ENEMY_MAX);         // strike thrust 0..1
        this.submerge = new Float32Array(ENEMY_MAX);      // 0..1 powder dive
        this.orbitR = new Float32Array(ENEMY_MAX);        // 4–8 m orbit radius
        this.strafeDir = new Int8Array(ENEMY_MAX);
        this.strafeT = new Float32Array(ENEMY_MAX);
        this.blinkCd = new Float32Array(ENEMY_MAX);       // sprite Glimmer Blink
        this.aimedT = new Float32Array(ENEMY_MAX);        // seconds under the aim
        this.openerCd = new Float32Array(ENEMY_MAX);      // stalker §3.2 rule 4
        this.volleyLeft = new Uint8Array(ENEMY_MAX);
        this.volleyT = new Float32Array(ENEMY_MAX);
        this.sprayT = new Float32Array(ENEMY_MAX);        // VFX emit throttle

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
        this.boltTrailT = new Float32Array(BOLT_MAX);

        // ------------------------------------------------------- shared state
        this._meleeFree = MELEE_TOKENS;
        this._rangedFree = RANGED_TOKENS;
        this._time = 0;
        this._pIFrameUntil = 0;   // absolute _time the player is hittable again
    }

    /**
     * Late-bind the placeholder body layer. Null-guarded everywhere, same
     * pattern as ctx.deform / ctx.spray in the spell system.
     * @param {import("./enemyVis.js").EnemyVis} vis
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
     * Spawn one enemy. Ground-snapped via terrain.heightAt; the spawn point is
     * the leash anchor (§4.3).
     * @param {string|number} key COLD_KEYS name or ARCH_* index
     * @param {number} x @param {number} z
     * @param {number} level realm-band level (Cold 1–10; clamped 1..30)
     * @returns {number} registry id, or -1 if the pool or registry is full
     */
    spawn(key, x, z, level) {
        const k = typeof key === "number" ? key : COLD_KEYS.indexOf(key);
        if (k < 0 || k >= this._rows.length) return -1;
        let i = -1;
        for (let n = 0; n < ENEMY_MAX; n++) {
            if (!this.alive[n]) { i = n; break; }
        }
        if (i < 0) return -1;

        const row = this._rows[k];
        const lvl = Math.max(1, Math.min(30, level | 0 || 10));
        const y = this.terrain.heightAt(x, z);
        // §0 anchor contract: HP = row × 1.10^(L−10), DMG = row × 1.07^(L−10).
        const hp = row.hp * Math.pow(1.10, lvl - 10);
        const id = this.registry.register({
            x, y, z, radius: row.radius, height: row.height,
            tier: row.tier, level: lvl, hp, poiseMax: row.poise,
            name: row.name, kind: "enemy",
        });
        if (id < 0) return -1;

        this.alive[i] = 1;
        this.key[i] = k;
        this.id[i] = id;
        this.level[i] = lvl;
        this.x[i] = x; this.y[i] = y; this.z[i] = z;
        this.homeX[i] = x; this.homeZ[i] = z;
        this.yaw[i] = Math.random() * Math.PI * 2;
        this.state[i] = ST_IDLE;
        this.stateT[i] = 0;
        this.cd[i] = 0;
        this.leashT[i] = 0;
        this.token[i] = 0;
        this.dmgScale[i] = Math.pow(1.07, lvl - 10);
        this.kbvX[i] = this.kbvZ[i] = 0;
        this.speedNow[i] = 0;
        this.flash[i] = 0;
        this.lunge[i] = 0;
        this.submerge[i] = 0;
        this.orbitR[i] = ORBIT_MIN + Math.random() * ORBIT_SPAN;   // §3.1
        this.strafeDir[i] = Math.random() < 0.5 ? -1 : 1;
        this.strafeT[i] = STRAFE_MIN_S + Math.random() * STRAFE_RAND_S;
        this.blinkCd[i] = 0;
        this.aimedT[i] = 0;
        this.openerCd[i] = 0;
        this.volleyLeft[i] = 0;
        this.volleyT[i] = 0;
        this.sprayT[i] = 0;

        if (this.vis) this.vis.spawn(i, k, x, y, z);
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
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (this.alive[i]) this._brain(i, dt);
        }
        this._separate();
        if (this.vis) this.vis.update(dt);
    }

    // ------------------------------------------------------------------ brains

    /** @param {number} i @param {number} dt */
    _brain(i, dt) {
        const reg = this.registry;
        const id = this.id[i];
        const s = reg.slot(id);
        if (s < 0) {                       // removed under us — free the body
            if (this.vis) this.vis.free(i);
            this.alive[i] = 0;
            return;
        }

        // ---- dying: dissolve, shatter already emitted, remove at 1.2 s ------
        if (this.state[i] === ST_DYING) {
            this.stateT[i] += dt;
            const d = Math.min(1, this.stateT[i] / DEATH_S);
            if (this.vis) {
                this.vis.drive(i, this.x[i], this.y[i], this.z[i], this.yaw[i],
                    0, 0, 0, this.submerge[i], d);
            }
            if (this.stateT[i] >= DEATH_S) {
                reg.remove(id);
                if (this.vis) this.vis.free(i);
                this.alive[i] = 0;
            }
            return;
        }

        // ---- death detection: the registry's damage() emitted the kill event;
        //      this is the body noticing its hp column hit zero -----------------
        if (reg.hp[s] <= 0) {
            this._releaseTokens(i);
            this.state[i] = ST_DYING;
            this.stateT[i] = 0;
            this.flash[i] = 0;
            this._shatter(i);
            return;
        }

        const row = this._rows[this.key[i]];
        const rt = reg.time;
        const p = this.controller.position;

        // ---- CC gates (the registry arrays gate the brain) -------------------
        const lifted = reg.lifted[s] === 1;
        const stunned = rt < reg.stunUntil[s] || lifted;
        const staggered = rt < reg.staggerUntil[s];
        const sm = reg.speedMult(id);       // chill + slow + stun/lift → 0

        // Knockback: consume the impulse into a damped body velocity whose
        // integral equals the impulse metres (registry doc: "bodies consume it").
        if (reg.kbX[s] !== 0 || reg.kbZ[s] !== 0) {
            this.kbvX[i] += reg.kbX[s] * KB_RATE;
            this.kbvZ[i] += reg.kbZ[s] * KB_RATE;
            reg.kbX[s] = 0;
            reg.kbZ[s] = 0;
        }
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
        const dist = Math.hypot(dx, dz);
        const ux = dist > 1e-4 ? dx / dist : 0;
        const uz = dist > 1e-4 ? dz / dist : 1;

        if (this.cd[i] > 0) this.cd[i] -= dt;
        if (this.blinkCd[i] > 0) this.blinkCd[i] -= dt;
        this.flash[i] = this.state[i] === ST_WINDUP || this.state[i] === ST_FIRING
            ? this.flash[i] : Math.max(0, this.flash[i] - 4 * dt);
        this.lunge[i] = Math.max(0, this.lunge[i] - 6 * dt);
        // A stalker knocked out of its dive (stun mid-windup, leash reset)
        // surfaces rather than staying a buried body in a walking state.
        if (this.submerge[i] > 0 && this.state[i] !== ST_SUBMERGED &&
            this.state[i] !== ST_WINDUP) {
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
            this._drive(i);
            return;
        }

        // Stun interrupts everything (spikes are the stun key, §1.1).
        if (stunned) this._cancelAttack(i);
        // Stagger cancels windups — except the brute's hyper-armor (§3.4).
        if (staggered && this.state[i] === ST_WINDUP && !row.hyperArmor) {
            this._cancelAttack(i);
            this.cd[i] = CANCEL_CD_S;
        }

        // ---- leash (§4.3) ----------------------------------------------------
        const hdx = this.x[i] - this.homeX[i];
        const hdz = this.z[i] - this.homeZ[i];
        const homeDist = Math.hypot(hdx, hdz);
        if (this.state[i] !== ST_RETURN && this.state[i] !== ST_IDLE) {
            if (homeDist > row.leash) {
                this.leashT[i] += dt;
                if (this.leashT[i] >= LEASH_EXIT_S) {
                    // Release ANY held token — a holder can disengage from the
                    // approach, not just from mid-windup.
                    this._releaseTokens(i);
                    this.volleyLeft[i] = 0;
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
                if (this._perceives(i, dist, ux, uz)) {
                    this.state[i] = ST_COMBAT;
                    this._propagate(i);
                }
                break;

            case ST_ALERTED:
                this.stateT[i] -= dt;
                if (this.stateT[i] <= 0) this.state[i] = ST_COMBAT;
                break;

            case ST_RETURN: {
                // Sprint home at 1.5×; full heal on arrival (§4.3).
                const hd = Math.max(homeDist, 1e-4);
                const spd = row.speed * RETURN_SPEED_MULT * sm;
                this._move(i, -hdx / hd, -hdz / hd, spd, dt);
                if (homeDist < 1) {
                    reg.hp[s] = reg.hpMax[s];
                    reg.poise[s] = reg.poiseMax[s];
                    this.leashT[i] = 0;
                    this.state[i] = ST_IDLE;
                }
                break;
            }

            case ST_COMBAT:
                this._combat(i, row, dist, ux, uz, sm, staggered, stunned, dt);
                break;

            case ST_WINDUP:
                this._face(i, ux, uz, dt);
                this.flash[i] = Math.min(1,
                    this.flash[i] + dt / Math.max(0.05, row.telegraphMs / 1000));
                // The eruption tell (§3.2 rule 3): the stalker half-surfaces
                // through its windup under a churning powder plume, so the
                // brightening core is actually visible before the pounce.
                if (this.key[i] === ARCH_STALKER && this.submerge[i] > 0.4) {
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
                    if (this.stateT[i] <= 0) this._strike(i, row, dist, ux, uz);
                }
                break;

            case ST_RECOVER:
                this.stateT[i] -= dt;
                if (this.stateT[i] <= 0) {
                    this._releaseTokens(i);
                    this.cd[i] = row.cooldown;
                    if (this.key[i] === ARCH_STALKER) {
                        // §3.2 rule 4: disengage and re-stalk.
                        this.openerCd[i] = OPENER_MIN_S + Math.random() * OPENER_RAND_S;
                        this.state[i] = ST_RETREAT;
                    } else {
                        this.state[i] = ST_COMBAT;
                    }
                }
                break;

            case ST_SUBMERGED:
                this._submergedPursuit(i, row, dist, ux, uz, sm, dt);
                break;

            case ST_RETREAT: {
                this.openerCd[i] -= dt;
                if (dist < DISENGAGE_M) {
                    this._move(i, -ux, -uz, row.speed * sm, dt);
                } else if (this.openerCd[i] <= 0) {
                    this.state[i] = ST_COMBAT;
                }
                break;
            }

            case ST_FIRING:
                this._face(i, ux, uz, dt);
                this.volleyT[i] -= dt;
                if (stunned || staggered) {          // volley dies with the caster's poise
                    this._cancelAttack(i);
                    this.cd[i] = CANCEL_CD_S;
                    break;
                }
                if (this.volleyT[i] <= 0 && this.volleyLeft[i] > 0) {
                    this._fireBolt(i, row);
                    this.volleyLeft[i]--;
                    this.volleyT[i] = VOLLEY_GAP_S;
                }
                if (this.volleyLeft[i] === 0) {
                    this._releaseTokens(i);
                    this.cd[i] = row.cooldown;
                    this.flash[i] = 0;
                    this.state[i] = ST_COMBAT;
                }
                break;
        }

        // ---- ground snap + registry sync + body ------------------------------
        this.y[i] = this.terrain.heightAt(this.x[i], this.z[i]);
        reg.move(id, this.x[i], this.y[i], this.z[i]);
        this._drive(i);
    }

    /**
     * Combat-state locomotion + attack initiation, per archetype.
     * @param {number} i @param {object} row @param {number} dist
     * @param {number} ux @param {number} uz toward the player, unit
     * @param {number} sm registry speed multiplier
     * @param {boolean} staggered @param {boolean} stunned @param {number} dt
     */
    _combat(i, row, dist, ux, uz, sm, staggered, stunned, dt) {
        const k = this.key[i];
        this._face(i, ux, uz, dt);
        if (stunned) return;

        if (k === ARCH_SPRITE) {
            this._spriteCombat(i, row, dist, ux, uz, sm, staggered, dt);
            return;
        }

        if (k === ARCH_STALKER) {
            // Powder Dive: submerge and pursue whenever an opener is available
            // and the prey is outside trigger range (§2.1 #3).
            if (this.openerCd[i] > 0) {
                this.openerCd[i] -= dt;
                // Stalk the edge of the band while the opener recharges.
                if (dist < STANDOFF_NEAR) this._move(i, -ux, -uz, row.speed * sm, dt);
                else if (dist > STANDOFF_FAR) this._move(i, ux, uz, row.speed * sm, dt);
                return;
            }
            if (dist > row.trigger) {
                this.state[i] = ST_SUBMERGED;
                return;
            }
            // Already inside trigger range: erupt now if a token is free.
            if (this._meleeFree > 0 && !staggered && this.cd[i] <= 0) {
                this._takeMelee(i);
                this.state[i] = ST_WINDUP;
                this.stateT[i] = row.telegraphMs / 1000;
                this.flash[i] = 0;
            }
            return;
        }

        // Imp + brute: token melee (§4.2). Holders close and swing; the rest
        // orbit at 4–8 m (§3.1) — never idle-stand.
        const reach = (row.ring > 0 ? row.ring : row.atkRange) + MELEE_PAD;
        if (this.token[i] === 1) {
            if (dist > reach * 0.85) {
                this._move(i, ux, uz, row.speed * sm * (staggered ? 0.15 : 1), dt);
            } else if (!staggered || row.hyperArmor) {
                this.state[i] = ST_WINDUP;
                this.stateT[i] = row.telegraphMs / 1000;
                this.flash[i] = 0;
            }
            return;
        }
        if (this._meleeFree > 0 && this.cd[i] <= 0 && !staggered) {
            this._takeMelee(i);
            return;
        }
        this._orbit(i, dist, ux, uz, row.speed * sm * (staggered ? 0.15 : 1), dt);
    }

    /** Hoarfrost Sprite: standoff band, strafe, Glimmer Blink, 3-bolt volleys. */
    _spriteCombat(i, row, dist, ux, uz, sm, staggered, dt) {
        const c = this.controller;

        // Glimmer Blink (§2.1 #4): aimed at >1 s or approached <5 m; 4 s cd.
        // "Aimed at" reads the cast-aim ray the spell system writes every frame.
        const adx = this.x[i] - c.position.x;
        const ady = this.y[i] + row.height * 0.6 - (c.position.y + 1.5);
        const adz = this.z[i] - c.position.z;
        const ad = Math.hypot(adx, ady, adz);
        const aimDot = ad > 1e-4
            ? (adx * c.castAimX + ady * c.castAimY + adz * c.castAimZ) / ad : 0;
        if (aimDot > 0.996 && dist < row.perception) this.aimedT[i] += dt;
        else this.aimedT[i] = 0;

        if (this.blinkCd[i] <= 0 &&
            (dist < row.blinkProx || this.aimedT[i] > row.aimedS)) {
            this._blink(i, row, ux, uz);
            return;
        }

        // Standoff band 10–15 m, reposition-strafe between casts (§3.3).
        this.strafeT[i] -= dt;
        if (this.strafeT[i] <= 0) {
            this.strafeDir[i] = /** @type {1|-1} */ (-this.strafeDir[i]);
            this.strafeT[i] = STRAFE_MIN_S + Math.random() * STRAFE_RAND_S;
        }
        const spd = row.speed * sm * (staggered ? 0.15 : 1);
        if (dist < STANDOFF_NEAR) {
            this._move(i, -ux, -uz, spd, dt);
        } else if (dist > STANDOFF_FAR) {
            this._move(i, ux, uz, spd, dt);
        } else {
            this._move(i, -uz * this.strafeDir[i], ux * this.strafeDir[i], spd * 0.8, dt);
        }

        // Volley: ranged token (§4.2 — max 2 casters firing; non-holders
        // visibly charge, which the telegraph flash covers).
        if (this.cd[i] <= 0 && dist <= row.castRange && !staggered &&
            this._rangedFree > 0) {
            this.token[i] = 2;
            this._rangedFree--;
            this.state[i] = ST_WINDUP;
            this.stateT[i] = SPRITE_WINDUP_S;
            this.flash[i] = 0;
        }
    }

    /** Frost Stalker submerged pursuit: 13 m/s wake, erupt at trigger range. */
    _submergedPursuit(i, row, dist, ux, uz, sm, dt) {
        this.submerge[i] = Math.min(1, this.submerge[i] + dt / 0.4);
        this._face(i, ux, uz, dt);
        this._move(i, ux, uz, row.subSpeed * sm, dt);

        // The wake-ripple tell (§3.2 rule 3): powder shed along the dive.
        this.sprayT[i] -= dt;
        if (this.spray && this.sprayT[i] <= 0) {
            this.sprayT[i] = 0.08;
            this.spray.emit(
                this.x[i], this.y[i] + 0.15, this.z[i],
                -ux * 0.8, 1.4, -uz * 0.8, 0.10, 0.5, 0, 5.2
            );
        }

        if (dist <= row.trigger && this._meleeFree > 0) {
            // Eruption is a stealth opener and pays its token (§3.2 rule 7).
            this._takeMelee(i);
            this.state[i] = ST_WINDUP;
            this.stateT[i] = row.telegraphMs / 1000;
            this.flash[i] = 0;
        }
    }

    // ------------------------------------------------------------- attack core

    /** The telegraphed hit lands (or whiffs) NOW. @param {number} i */
    _strike(i, row, dist, ux, uz) {
        const k = this.key[i];
        const c = this.controller;
        this.lunge[i] = 1;

        if (k === ARCH_STALKER) {
            // Eruption pounce: burst out of the powder onto the prey.
            this.submerge[i] = 0;
            const dash = Math.min(dist - 0.8, row.trigger);
            if (dash > 0) {
                this.x[i] += ux * dash;
                this.z[i] += uz * dash;
            }
            const ndx = c.position.x - this.x[i];
            const ndz = c.position.z - this.z[i];
            if (Math.hypot(ndx, ndz) <= POUNCE_CONTACT_M + MELEE_PAD &&
                c.airHeight <= MELEE_CLEAR_H) {
                this._hurtPlayer(row.dmg * this.dmgScale[i]);
            }
            if (this.spray) this._burstPlume(i);
        } else if (row.ring > 0) {
            // Brute slam: a ground ring — jumped over at ollie height (§1.4).
            if (dist <= row.ring + MELEE_PAD && c.airHeight <= RING_CLEAR_H) {
                this._hurtPlayer(row.dmg * this.dmgScale[i]);
            }
            if (this.spray) this._burstPlume(i);
        } else {
            // Imp rake: reach + frontal arc.
            const fx = Math.sin(this.yaw[i]);
            const fz = -Math.cos(this.yaw[i]);
            const arc = ux * fx + uz * fz;
            if (dist <= row.atkRange + MELEE_PAD + 0.35 && arc >= MELEE_ARC_COS &&
                c.airHeight <= MELEE_CLEAR_H) {
                this._hurtPlayer(row.dmg * this.dmgScale[i]);
            }
        }

        this.flash[i] = 0;
        if (this.token[i] === 2) {
            // Sprite: the windup rolls into the volley, token still held.
            this.state[i] = ST_FIRING;
            this.volleyLeft[i] = row.volley;
            this.volleyT[i] = 0;
            this.flash[i] = 1;
        } else {
            this.state[i] = ST_RECOVER;
            this.stateT[i] = TOKEN_RECOVER_S;   // §4.2 hold-through-recovery
        }
    }

    /** Damage the player, honouring the 0.5 s i-frame window. */
    _hurtPlayer(dmg) {
        if (this._time < this._pIFrameUntil) return;
        const c = this.controller;
        c.health = Math.max(0, c.health - dmg);
        this._pIFrameUntil = this._time + PLAYER_IFRAME_S;
    }

    /** Glimmer Blink: 6 m sideways-away teleport, 4 s cd (§2.1 #4). */
    _blink(i, row, ux, uz) {
        const side = Math.random() < 0.5 ? -1 : 1;
        // Half away from the player, half perpendicular — reads as a dodge.
        let bx = -ux * 0.7 - uz * side * 0.7;
        let bz = -uz * 0.7 + ux * side * 0.7;
        const bl = Math.hypot(bx, bz) || 1;
        bx /= bl; bz /= bl;
        if (this.spray) {
            this.spray.emit(this.x[i], this.y[i] + 0.8, this.z[i],
                0, 1.2, 0, 0.14, 0.4, 0, 5.2);
        }
        this.x[i] += bx * row.blinkRange;
        this.z[i] += bz * row.blinkRange;
        this.y[i] = this.terrain.heightAt(this.x[i], this.z[i]);
        this.blinkCd[i] = row.blinkCd;
        this.aimedT[i] = 0;
        if (this.spray) {
            this.spray.emit(this.x[i], this.y[i] + 0.8, this.z[i],
                0, 1.2, 0, 0.14, 0.4, 0, 5.2);
        }
    }

    // ------------------------------------------------------------- projectiles

    /** Launch one sprite bolt with §3.3 velocity lead. */
    _fireBolt(i, row) {
        let b = -1;
        for (let n = 0; n < BOLT_MAX; n++) {
            if (!this.boltAlive[n]) { b = n; break; }
        }
        if (b < 0) return;
        const c = this.controller;
        const ox = this.x[i];
        const oy = this.y[i] + row.height * 0.6;
        const oz = this.z[i];
        // Lead the chest point by 0.4 s of player velocity (§3.3: 0.3–0.5).
        const tx = c.position.x + c.velocity.x * CASTER_LEAD_S;
        const ty = c.position.y + 1.2 + c.velocity.y * CASTER_LEAD_S;
        const tz = c.position.z + c.velocity.z * CASTER_LEAD_S;
        let dx = tx - ox, dy = ty - oy, dz = tz - oz;
        const d = Math.hypot(dx, dy, dz) || 1;
        const spd = row.projSpeed;
        this.boltAlive[b] = 1;
        this.boltX[b] = ox; this.boltY[b] = oy; this.boltZ[b] = oz;
        this.boltVX[b] = dx / d * spd;
        this.boltVY[b] = dy / d * spd;
        this.boltVZ[b] = dz / d * spd;
        this.boltDmg[b] = row.dmg * this.dmgScale[i];
        this.boltTtl[b] = BOLT_TTL;
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

            // Light homing: blend the velocity direction toward the chest.
            let vx = this.boltVX[b], vy = this.boltVY[b], vz = this.boltVZ[b];
            const spd = Math.hypot(vx, vy, vz) || 1;
            let tx = px - this.boltX[b];
            let ty = py + 1.2 - this.boltY[b];
            let tz = pz - this.boltZ[b];
            const td = Math.hypot(tx, ty, tz) || 1;
            const k = Math.min(1, BOLT_HOME_RATE * dt);
            vx = vx / spd + (tx / td - vx / spd) * k;
            vy = vy / spd + (ty / td - vy / spd) * k;
            vz = vz / spd + (tz / td - vz / spd) * k;
            const vl = Math.hypot(vx, vy, vz) || 1;
            vx = vx / vl * spd; vy = vy / vl * spd; vz = vz / vl * spd;
            this.boltVX[b] = vx; this.boltVY[b] = vy; this.boltVZ[b] = vz;

            const x0 = this.boltX[b], y0 = this.boltY[b], z0 = this.boltZ[b];
            const x1 = x0 + vx * dt, y1 = y0 + vy * dt, z1 = z0 + vz * dt;

            // Swept segment vs the player capsule (r 0.5, h 1.8) — exact at any
            // frame rate, which is the §9.3 anti-tunneling rule in closed form.
            if (segVsCapsule(x0, y0, z0, x1, y1, z1, px, py, pz, PLAYER_R, PLAYER_H)) {
                this._hurtPlayer(this.boltDmg[b]);
                if (this.spray) {
                    this.spray.emit(x1, y1, z1, 0, 1.5, 0, 0.12, 0.35, 0, 5.2);
                }
                this._killBolt(b);
                continue;
            }

            // Ground kill.
            if (y1 <= this.terrain.heightAt(x1, z1) + 0.05) {
                if (this.spray) {
                    this.spray.emit(x1, y1 + 0.1, z1, 0, 1.8, 0, 0.14, 0.4, 0, 5.2);
                }
                this._killBolt(b);
                continue;
            }

            this.boltX[b] = x1; this.boltY[b] = y1; this.boltZ[b] = z1;

            // A sparse powder trail keeps the bolt readable against the sky.
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
     * sprint/surf speeds.
     * @returns {boolean}
     */
    _perceives(i, dist, ux, uz) {
        const row = this._rows[this.key[i]];
        if (dist <= PROXIMITY_M) return true;
        if (dist <= HEARING_M && this.controller.speed > 5) return true;
        if (dist > row.perception) return false;
        const fx = Math.sin(this.yaw[i]);
        const fz = -Math.cos(this.yaw[i]);
        return ux * fx + uz * fz >= SIGHT_COS;
    }

    /**
     * Combat broadcast (§4.1): allies join staggered 0.2–0.6 s. Imp spotters
     * reach every imp in 30 m — Pack Call (§2.1 #1); everyone else 12 m.
     */
    _propagate(i) {
        const impCall = this.key[i] === ARCH_IMP;
        for (let j = 0; j < ENEMY_MAX; j++) {
            if (j === i || !this.alive[j] || this.state[j] !== ST_IDLE) continue;
            const r = impCall && this.key[j] === ARCH_IMP
                ? this._rows[ARCH_IMP].alertRadius : 12;
            const dx = this.x[j] - this.x[i];
            const dz = this.z[j] - this.z[i];
            if (dx * dx + dz * dz <= r * r) {
                this.state[j] = ST_ALERTED;
                this.stateT[j] = ALERT_STAGGER_MIN + Math.random() * ALERT_STAGGER_RAND;
            }
        }
    }

    /** Cheap pairwise de-overlap so a pack never stacks into one capsule. */
    _separate() {
        for (let i = 0; i < ENEMY_MAX; i++) {
            if (!this.alive[i] || this.state[i] === ST_DYING) continue;
            const ri = this._rows[this.key[i]].radius;
            for (let j = i + 1; j < ENEMY_MAX; j++) {
                if (!this.alive[j] || this.state[j] === ST_DYING) continue;
                const dx = this.x[j] - this.x[i];
                const dz = this.z[j] - this.z[i];
                const min = ri + this._rows[this.key[j]].radius;
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

    /** @param {number} i move along (mx,mz) at spd m/s */
    _move(i, mx, mz, spd, dt) {
        this.x[i] += mx * spd * dt;
        this.z[i] += mz * spd * dt;
        this.speedNow[i] = spd;
    }

    /** §3.1 orbit: hold 4–8 m, circle tangentially, posture — never stand. */
    _orbit(i, dist, ux, uz, spd, dt) {
        const r = this.orbitR[i];
        let mx = -uz * this.strafeDir[i];
        let mz = ux * this.strafeDir[i];
        if (dist > r + 1) { mx += ux * 0.8; mz += uz * 0.8; }
        else if (dist < r - 1) { mx -= ux * 0.8; mz -= uz * 0.8; }
        const l = Math.hypot(mx, mz) || 1;
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

    /** Release whatever token slot i holds. @param {number} i */
    _releaseTokens(i) {
        if (this.token[i] === 1) this._meleeFree++;
        else if (this.token[i] === 2) this._rangedFree++;
        this.token[i] = 0;
    }

    /** Cancel a windup/volley in flight and give the token back. */
    _cancelAttack(i) {
        if (this.state[i] === ST_WINDUP || this.state[i] === ST_FIRING) {
            this._releaseTokens(i);
            this.state[i] = ST_COMBAT;
            this.volleyLeft[i] = 0;
            this.flash[i] = 0;
        }
    }

    // --------------------------------------------------------------------- vfx

    /** Death shatter through the shared spray pool (§9.4 death VFX rule). */
    _shatter(i) {
        if (!this.spray) return;
        const row = this._rows[this.key[i]];
        const cy = this.y[i] + row.height * 0.5;
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

    /** Push this frame's body state to the placeholder visual. */
    _drive(i) {
        if (!this.vis) return;
        const row = this._rows[this.key[i]];
        this.vis.drive(
            i, this.x[i], this.y[i], this.z[i], this.yaw[i],
            Math.min(1, this.speedNow[i] / row.speed),
            this.flash[i], this.lunge[i], this.submerge[i], 0
        );
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
