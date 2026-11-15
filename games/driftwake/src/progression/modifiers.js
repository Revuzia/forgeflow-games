/**
 * Reward modifiers — THE ONE AGGREGATOR (_spec/QUEST_DESIGN.md §4, numbers
 * per _spec/PROGRESSION_DESIGN.md §8.3 / §9).
 *
 * Every reward channel that changes a number — the six shrine boons, the
 * equipped relics, the Wake Glass shop ranks and the post-cap Driftmark picks
 * — folds into the flat fields of this one object. Consumers read ONE field
 * (or call one pure method) at the moment they need it; nothing here runs a
 * per-frame recompute. `recompute()` is event-scoped: a boon chosen, a relic
 * equipped, a rank bought, a Driftmark picked, a save restored.
 *
 * STACKING (QUEST §4.2: "stacking multiplicatively with boons"): every
 * multiplier from every source is a product. Additive channels are only the
 * ones the spec states additively: shop ranks are "+4% each" (1 + 0.04·rank),
 * Driftmarks are "+0.5% / +0.3% each" (1 + k·n), the surf Driftmark channel
 * capped at +10% (PROGRESSION §9 "speed capped at +10% total" — read as the
 * Driftmark channel's cap: a boon + relic already reach +14.5%, so a cap on
 * TOTAL surf speed would make the Keel/Sandstep picks partly labels).
 *
 * WHERE EACH EFFECT BECOMES REAL (one read per consumer, grep "mods"):
 *
 *   damage (element / target state)  combat/spellHits.js — every damage()
 *       call multiplies by `hitMult(reg, slot, kind)`. The player's kit is
 *       FROST at heart (COMBAT_DESIGN names it Frost Bolt / Frost Wave; the
 *       realm swap is fiction only, spellSystem REALM_PALETTE "the mechanic
 *       is constant"), so Rime Edge's "+8% frost damage" is every kit hit in
 *       every realm. Ember Coil's ignite is the one FIRE-element damage and
 *       is not boosted by Rime Edge.
 *   chill stacks / duration / Frost Nova   spellHits → `onChillHit()` after
 *       each chill-applying hit (bolt, arc).
 *   wave damage + knockback          spellHits `_waveApply` (kind WAVE).
 *   vortex radius                    spellSystem.update writes
 *       `ctx.vortexScale`; spells/vortex.js scales its ring, helices and
 *       grains by it, and spellHits `_vortex` hits on that same `vx.ring` —
 *       the ring that is drawn is the ring that hits.
 *   vortex duration                  spellSystem.update → `vortexClock(t)`
 *       dilates the vortex's own clock through its HOLD phase only.
 *   cooldowns                        spellSystem `cooldown(key, base)`.
 *   bolt range                       spellSystem `_fireBolt` leash + aim cap.
 *   max HP / max mana                controller `healthMax` / `manaMax`
 *       accessors multiply the progression-written base.
 *   mana regen, surf speed, surf jump   controller.update / _surfStep.
 *   mote heal (Wakemender)           this.update(): each new pickup counted on
 *       `motes.stats.picked` gets the extra +50% of the base 10% heal.
 *   damage taken from heavies, Undying Wake   thin instance wrappers on the
 *       enemy runtime's `_applyHit` / `_hurtPlayer` / `_fireBolt` (see
 *       `_attachEnemies`) — the ONLY path player damage takes (grep
 *       `_hurtPlayer`: enemies.js is its only writer of controller.health).
 *   Scorpion's Patience              a DODGE-SURF is a surf ollie (SPACE while
 *       carving: the move that clears ground rings, enemies.js RING_CLEAR_H);
 *       +10% damage for 2 s from take-off.
 *   Ember Coil                       spellHits bolt direct hit →
 *       `onBoltHit(id)`; this.update() ticks 3 dmg/s for 2 s (L10 anchor,
 *       scaled by the level damage multiplier like every player number).
 *
 * MODULE SHAPE (QUEST contract): constructor(ctx), update(dt) (no-op at
 * dt === 0), setRealm(token). Self-registers as `ctx.mods`. Persists the
 * Driftmark picks through `progression.registerSaveSection("driftmarkPicks")`.
 *
 * Allocation: none on the frame path (update, hitMult, cooldown, vortexClock,
 * onChillHit, onBoltHit, the enemy wrappers). `stats` allocates — probes only.
 */

import { TIER } from "../combat/damageable.js";
import { combatData } from "../combat/combatData.js";
import { STORY } from "../quests/storyText.js";

// ---------------------------------------------------------------------------
// The effect tables — every boon, relic and shop row as NUMBERS. The text the
// player reads comes from lane N's STORY (storyText.js); these are the values
// that text promises. A row here with no consumer would be a label: every key
// below is read by exactly one consumer named in the header.
// ---------------------------------------------------------------------------

/** QUEST §4.1 — the twelve boons (PROGRESSION §8.3 priced pairs). */
export const BOON_FX = Object.freeze({
    "boon.rimeEdge": { dmgFrost: 1.08 },
    "boon.deepChill": { chillMax: 6 },
    "boon.glacialGuard": { maxHp: 1.10 },
    "boon.frostNova": { arcChills: 2 },
    "boon.quickenedSpikes": { cdFlat: [4, 2] },          // spell key 4 = Spikes, −2 s
    "boon.tidalForce": { waveKnock: 1.30, waveDmg: 1.08 },
    "boon.sandstep": { surfSpeed: 1.08 },
    "boon.sunder": { dmgVsStaggered: 1.12 },
    "boon.cinderbrand": { dmgVsChilled: 1.08 },
    "boon.greatVortex": { vortexRadius: 1.15 },
    "boon.heartOfTheDrift": { dmgAll: 1.12 },
    "boon.undyingWake": { undying: 1 },
});

/** QUEST §4.2 — the twelve relics, four per realm. */
export const RELIC_FX = Object.freeze({
    "relic.rimeHeart": { chillExtend: 1.0 },
    "relic.frostglassLens": { boltRange: 1.20 },
    "relic.keelOfTheFirst": { surfSpeed: 1.06 },
    "relic.warmHands": { manaRegen: 1.20 },
    "relic.brassBuckle": { heavyTaken: 0.85 },
    "relic.sandGlass": { cdMult: 0.92 },
    "relic.duneRunner": { surfJump: 1.25 },
    "relic.scorpionsPatience": { dodgeDmg: 1.10 },
    "relic.emberCoil": { igniteDps: 3 },
    "relic.plateShard": { maxHp: 1.15 },
    "relic.furnaceCore": { vortexDuration: 1.20 },
    "relic.wakemender": { moteHeal: 1.50 },
});

/** Shop ranks that change numbers (QUEST §4.3): +4% per rank, additive. */
export const SHOP_RANK_FX = Object.freeze({
    "shop.vitality": { key: "maxHp", per: 0.04 },
    "shop.wellspring": { key: "maxMana", per: 0.04 },
});

/** PROGRESSION §9 / QUEST §4.4 — Driftmark picks. */
export const DRIFTMARK = Object.freeze({
    dmgPer: 0.005, hpPer: 0.005, surfPer: 0.003, surfCap: 0.10,
});

/** Damage kinds for `hitMult` — ints, never strings, on the hit path. */
export const KIND_KIT = 0;     // any frost-kit hit
export const KIND_WAVE = 1;    // the wave (Tidal Force)
export const KIND_FIRE = 2;    // Ember Coil's ignite (not frost)

/** Chill's registry refresh window, s (damageable.js hard-codes 3). */
const CHILL_WINDOW = 3;
/** The registry's native stack cap (damageable.js `chill < 5`). */
const CHILL_NATIVE_MAX = 5;
/** Scorpion's Patience window, s (QUEST §4.2 "for 2 s after a dodge-surf"). */
const DODGE_WINDOW = 2;
/** Undying Wake: a FIGHT ends after this long without taking a hit, provided
 *  no boss event is live (the boss event is one fight however long it runs). */
const FIGHT_QUIET_S = 10;
/** Ember Coil: 2 s burn, ticked at 2 Hz so a floater reads every half second. */
const IGNITE_S = 2;
const IGNITE_TICK = 0.5;
const IGNITE_SLOTS = 16;
/** motes.js HEAL_FRAC (not exported) — COMBAT_DESIGN §1.4 "+10% max HP". */
const MOTE_HEAL_FRAC = 0.10;
/** Surf-carve threshold the controller itself uses (`this.surf > 0.5`). */
const SURF_ON = 0.5;
/** The registry damage options, allocated ONCE: an object literal per
 *  ignite tick / Frost Nova re-chill is a per-frame allocation in a fight
 *  (measured by _harness/qa_rewards_ui_node.mjs ALLOCATION). The registry
 *  only reads these fields. */
const OPT_IGNITE = Object.freeze({ tag: "ignite" });
const OPT_RECHILL = Object.freeze({ chill: true, tag: "chill" });

/**
 * Register a persisted section through lane Q's v4 save contract. Absent
 * (older progression.js) → the section simply does not persist, loudly.
 * @param {any} progression @param {string} name
 * @param {{serialize: () => any, deserialize: (o: any) => void}} handler
 * @returns {(() => void)|null} the unregister handle (null = not persisted)
 */
export function registerSection(progression, name, handler) {
    if (progression && typeof progression.registerSaveSection === "function") {
        const off = progression.registerSaveSection(name, handler);
        return typeof off === "function" ? off : () => {};
    }
    console.warn("[rewards] progression.registerSaveSection is missing — section '" +
        name + "' will not persist until lane Q's v4 save lands");
    return null;
}

export class Modifiers {
    /**
     * @param {any} ctx the shared meaning-layer ctx (QUEST contract). Reads
     *   character, spells, spellHits (falls back to `spells.bolt.assist`,
     *   which IS the SpellHits instance — it self-installs there), registry,
     *   enemies, bosses, motes, progression, bus.
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.character = ctx.character;
        this.progression = ctx.progression || null;
        this.registry = ctx.registry || null;
        this.bus = ctx.bus || null;
        this.bosses = ctx.bosses || null;
        this.motes = ctx.motes || null;
        this.spells = ctx.spells || null;
        this.spellHits = ctx.spellHits ||
            (ctx.spells && ctx.spells.bolt && ctx.spells.bolt.assist) || null;

        // ---------------------------------------------- the final multipliers
        // Written only by recompute(). Every field has its identity value so
        // an unwired game behaves exactly as before this module existed.
        this.dmgAll = 1;
        this.dmgFrost = 1;
        this.dmgVsChilled = 1;
        this.dmgVsStaggered = 1;
        this.waveDmg = 1;
        this.waveKnock = 1;
        this.dodgeDmg = 1;
        this.maxHp = 1;
        this.maxMana = 1;
        this.manaRegen = 1;
        this.surfSpeed = 1;
        /** Surf-ollie HEIGHT multiplier ("surf jump +25%" read as apex height —
         *  the quantity a player perceives); the controller reads the
         *  velocity form below. */
        this.surfJump = 1;
        this.surfJumpVel = 1;
        this.cdMult = 1;
        /** Flat cooldown cuts, s, by internal spell key (0..7). */
        this.cdFlat = new Float32Array(8);
        this.chillMax = CHILL_NATIVE_MAX;
        this.chillExtend = 0;
        this.arcChills = 1;
        this.vortexRadius = 1;
        this.vortexDuration = 1;
        this.boltRange = 1;
        this.moteHeal = 1;
        this.heavyTaken = 1;
        this.undying = false;
        this.igniteDps = 0;
        /** `hitMultInto`'s out-slot (read `hm[0]` right after the call). */
        this.hm = new Float64Array(1);

        // ---------------------------------------------- sources (event-scoped)
        /** @type {string[]} */ this._boonIds = [];
        /** @type {string[]} */ this._relicIds = [];
        /** @type {Record<string, number>} */ this._shopRanks = {};
        /** Driftmark picks (persisted as section "driftmarkPicks"). */
        this.driftPicks = { dmg: 0, hp: 0, surf: 0 };
        /** Driftmarks progression had minted at the last offer, for the edge. */
        this._marksSeen = -1;

        // ---------------------------------------------- live state
        this._wasAir = false;
        this._dodgeUntil = -1;
        this._srcTier = -1;
        this._undyingArmed = true;
        this._lastHurt = -1e9;
        this._wasDead = false;
        this._motesSeen = this.motes && this.motes.stats ? this.motes.stats.picked : 0;
        this._igId = new Int32Array(IGNITE_SLOTS).fill(-1);
        /** Burn seconds still to accrue per ignite slot. The burn is paid on
         *  ACCRUED time, clipped to the window — so it is exactly 4 ticks
         *  (6 damage at the L10 anchor) at 60 fps and at 4 fps alike. */
        this._igLeft = new Float64Array(IGNITE_SLOTS);
        this._igOwed = new Float64Array(IGNITE_SLOTS);
        /** Probe counters — never read by the game. */
        this.counters = {
            undyingSaves: 0, igniteTicks: 0, igniteDamage: 0,
            moteBonusHealed: 0, dodges: 0, heavyHitsScaled: 0,
        };

        // ---------------------------------------------- self-wiring
        // One field per consumer; null there = identity, so the order main.js
        // constructs things in never produces a half-applied state.
        if (this.character) this.character.mods = this;
        if (this.spells) this.spells.mods = this;
        if (this.spellHits) this.spellHits.mods = this;
        this._attachEnemies(ctx.enemies || null);
        ctx.mods = this;
        // Burns and dodge windows do not follow the player across a realm —
        // heard on the bus as well as through setRealm (idempotent).
        this._offRealm = this.bus
            ? this.bus.on("realm:entered", (p) => { if (p && p.realm) this.setRealm(p.realm); })
            : null;

        this._offSave = registerSection(this.progression, "driftmarkPicks", {
            serialize: () => ({
                dmg: this.driftPicks.dmg, hp: this.driftPicks.hp,
                surf: this.driftPicks.surf,
            }),
            deserialize: (o) => {
                const ok = o && typeof o === "object";
                this.driftPicks.dmg = ok ? Math.max(0, Math.floor(+o.dmg || 0)) : 0;
                this.driftPicks.hp = ok ? Math.max(0, Math.floor(+o.hp || 0)) : 0;
                this.driftPicks.surf = ok ? Math.max(0, Math.floor(+o.surf || 0)) : 0;
                this._marksSeen = -1;   // re-offer anything still unpicked
                this.recompute();
            },
        });
        this.recompute();
    }

    // ===================================================================
    // Sources → recompute
    // ===================================================================

    /** @param {string[]} ids boon ids currently in effect */
    setBoons(ids) {
        this._boonIds = ids.slice();
        // A newly taken Undying Wake starts charged.
        if (ids.indexOf("boon.undyingWake") >= 0 && !this.undying) this._undyingArmed = true;
        this.recompute();
    }

    /** @param {(string|null)[]} ids equipped relic ids (nulls skipped) */
    setRelics(ids) {
        const out = [];
        for (let i = 0; i < ids.length; i++) if (ids[i]) out.push(ids[i]);
        this._relicIds = out;
        this.recompute();
    }

    /** @param {Record<string, number>} ranks shop item id → rank */
    setShop(ranks) {
        this._shopRanks = Object.assign({}, ranks);
        this.recompute();
    }

    /**
     * Fold every source into the flat fields. Event-scoped. Keeps the
     * player's CURRENT pools honest across a max change: a raised max adds
     * the difference (a bought Vitality rank never reads as damage), a
     * lowered one clamps; a dead player is never healed by a respec.
     * @returns {void}
     */
    recompute() {
        const c = this.character;
        const hp0 = c ? c.healthMax : 0;
        const mp0 = c ? c.manaMax : 0;

        const f = {
            dmgAll: 1, dmgFrost: 1, dmgVsChilled: 1, dmgVsStaggered: 1,
            waveDmg: 1, waveKnock: 1, dodgeDmg: 1, maxHp: 1, maxMana: 1,
            manaRegen: 1, surfSpeed: 1, surfJump: 1, cdMult: 1,
            chillMax: CHILL_NATIVE_MAX, chillExtend: 0, arcChills: 1,
            vortexRadius: 1, vortexDuration: 1, boltRange: 1, moteHeal: 1,
            heavyTaken: 1, undying: 0, igniteDps: 0,
        };
        const flat = this.cdFlat;
        flat.fill(0);
        const fold = (fx) => {
            if (!fx) return;
            for (const k in fx) {
                const v = fx[k];
                if (k === "cdFlat") { flat[v[0]] += v[1]; continue; }
                if (k === "chillMax" || k === "arcChills") { f[k] = Math.max(f[k], v); continue; }
                if (k === "chillExtend" || k === "igniteDps") { f[k] += v; continue; }
                if (k === "undying") { f.undying = 1; continue; }
                f[k] *= v;
            }
        };
        for (let i = 0; i < this._boonIds.length; i++) fold(BOON_FX[this._boonIds[i]]);
        for (let i = 0; i < this._relicIds.length; i++) fold(RELIC_FX[this._relicIds[i]]);
        for (const id in SHOP_RANK_FX) {
            const r = this._shopRanks[id] | 0;
            if (r > 0) f[SHOP_RANK_FX[id].key] *= 1 + SHOP_RANK_FX[id].per * r;
        }
        const dp = this.driftPicks;
        f.dmgAll *= 1 + DRIFTMARK.dmgPer * dp.dmg;
        f.maxHp *= 1 + DRIFTMARK.hpPer * dp.hp;
        f.surfSpeed *= 1 + Math.min(DRIFTMARK.surfCap, DRIFTMARK.surfPer * dp.surf);

        this.dmgAll = f.dmgAll; this.dmgFrost = f.dmgFrost;
        this.dmgVsChilled = f.dmgVsChilled; this.dmgVsStaggered = f.dmgVsStaggered;
        this.waveDmg = f.waveDmg; this.waveKnock = f.waveKnock;
        this.dodgeDmg = f.dodgeDmg; this.maxHp = f.maxHp; this.maxMana = f.maxMana;
        this.manaRegen = f.manaRegen; this.surfSpeed = f.surfSpeed;
        this.surfJump = f.surfJump; this.surfJumpVel = Math.sqrt(f.surfJump);
        this.cdMult = f.cdMult; this.chillMax = f.chillMax;
        this.chillExtend = f.chillExtend; this.arcChills = f.arcChills;
        this.vortexRadius = f.vortexRadius; this.vortexDuration = f.vortexDuration;
        this.boltRange = f.boltRange; this.moteHeal = f.moteHeal;
        this.heavyTaken = f.heavyTaken; this.undying = f.undying === 1;
        this.igniteDps = f.igniteDps;

        if (c) {
            const hp1 = c.healthMax, mp1 = c.manaMax;
            if (c.health > 0) {
                if (hp1 > hp0) c.health = Math.min(hp1, c.health + (hp1 - hp0));
                else if (c.health > hp1) c.health = hp1;
            }
            if (mp1 > mp0) c.mana = Math.min(mp1, c.mana + (mp1 - mp0));
            else if (c.mana > mp1) c.mana = mp1;
        }
    }

    // ===================================================================
    // Consumer reads (allocation-free)
    // ===================================================================

    /**
     * The reward damage factor for ONE hit on registry slot `slot`, read
     * BEFORE the hit lands (the target's chill / stagger state as it stood).
     * Convenience form of `hitMultInto` for probes and cold paths: a double
     * RETURNED from a call V8 did not inline is boxed (one HeapNumber), so
     * the hit paths (spellHits `_rm`, the Ember Coil tick) use the out-slot.
     * @param {import("../combat/damageable.js").DamageableRegistry} reg
     * @param {number} slot registry slot, or -1 (state terms skipped)
     * @param {number} kind KIND_KIT | KIND_WAVE | KIND_FIRE
     * @returns {number}
     */
    hitMult(reg, slot, kind) {
        this.hitMultInto(reg, slot, kind);
        return this.hm[0];
    }

    /**
     * `hitMult` without a returned double: the factor lands in `this.hm[0]`
     * (a Float64Array store — never a heap allocation, inlined or not).
     * Measured by _harness/qa_rewards_ui_node.mjs ALLOC-PROFILE: the returned
     * form was one boxed double per Ember Coil tick.
     * @param {import("../combat/damageable.js").DamageableRegistry} reg
     * @param {number} slot @param {number} kind @returns {void}
     */
    hitMultInto(reg, slot, kind) {
        let m = this.dmgAll;
        if (kind !== KIND_FIRE) m *= this.dmgFrost;
        if (kind === KIND_WAVE) m *= this.waveDmg;
        if (slot >= 0) {
            const t = reg.time;
            if (this.dmgVsChilled !== 1 &&
                ((reg.chill[slot] > 0 && t - reg.chillAt[slot] <= CHILL_WINDOW) ||
                 t < reg.brittleUntil[slot])) {
                m *= this.dmgVsChilled;
            }
            if (this.dmgVsStaggered !== 1 && t < reg.staggerUntil[slot]) {
                m *= this.dmgVsStaggered;
            }
        }
        // Scorpion's Patience is the CASTER's state, not the target's.
        if (this.dodgeDmg !== 1 && reg && reg.time < this._dodgeUntil) m *= this.dodgeDmg;
        this.hm[0] = m;
    }

    /**
     * A spell's modified cooldown, s. Flat cuts first (Quickened Spikes),
     * then the multiplier (Sand Glass). Floored at 25% of base so no stack of
     * future rewards can strobe an AoE.
     * @param {number} key internal spell key @param {number} base s
     * @returns {number}
     */
    cooldown(key, base) {
        if (!(base > 0)) return base;
        let c = base - (key >= 0 && key < 8 ? this.cdFlat[key] : 0);
        c *= this.cdMult;
        const floor = base * 0.25;
        return c < floor ? floor : c;
    }

    /**
     * Furnace Core: the Great Vortex's clock rate at spell time `t`. The
     * extra duration lives entirely in the HOLD (the ramp and the fade keep
     * their feel): total real duration = (ramp + hold + fade) × vortexDuration.
     * @param {number} t the vortex's own clock, s @returns {number} rate ≤ 1
     */
    vortexClock(t) {
        if (this.vortexDuration === 1) return 1;
        const V = combatData.vortex;
        if (t < V.ramp || t >= V.ramp + V.hold) return 1;
        const extra = (this.vortexDuration - 1) * (V.ramp + V.hold + V.fade);
        return V.hold / (V.hold + extra);
    }

    /**
     * After a chill-applying hit (bolt, arc) — Frost Nova's second
     * application, Deep Chill's sixth stack and overflow, Rime Heart's +1 s.
     * `c0` is the target's stack count BEFORE the hit, so "held at the cap
     * during Brittle" is told apart from "just climbed to 5".
     * @param {import("../combat/damageable.js").DamageableRegistry} reg
     * @param {number} slot @param {number} id @param {number} c0 @param {boolean} arc
     * @returns {void}
     */
    onChillHit(reg, slot, id, c0, arc) {
        if (slot < 0) return;
        this._chillFix(reg, slot, c0);
        if (arc) {
            for (let k = 1; k < this.arcChills; k++) {
                const c1 = reg.chill[slot];
                // Zero damage, the registry's OWN chill rule (stack, refresh,
                // Brittle + its event) — never a re-implementation. The 0-dmg
                // hit event merges into this frame's floater for the target.
                reg.damage(id, 0, OPT_RECHILL);
                this._chillFix(reg, slot, c1);
            }
        }
    }

    /** @param {any} reg @param {number} slot @param {number} c0 */
    _chillFix(reg, slot, c0) {
        if (this.chillMax > CHILL_NATIVE_MAX) {
            const c = reg.chill[slot];
            if (c === 0 && c0 >= CHILL_NATIVE_MAX - 1 && reg.time < reg.brittleUntil[slot]) {
                // Brittle fired on this hit and the registry zeroed the stacks:
                // the stack that overflowed the cap carries over.
                reg.chill[slot] = 1;
            } else if (c === CHILL_NATIVE_MAX && c0 >= CHILL_NATIVE_MAX &&
                       reg.time < reg.brittleUntil[slot]) {
                // Held at the native cap through Brittle: the sixth stack lands.
                reg.chill[slot] = Math.min(this.chillMax, c0 + 1);
            }
        }
        if (this.chillExtend > 0) reg.chillAt[slot] = reg.time + this.chillExtend;
    }

    /**
     * Ember Coil — a direct bolt hit ignites (refreshing an existing burn).
     * @param {number} id registry id @returns {void}
     */
    onBoltHit(id) {
        if (!(this.igniteDps > 0) || !this.registry) return;
        let free = -1;
        for (let k = 0; k < IGNITE_SLOTS; k++) {
            if (this._igId[k] === id) { free = k; break; }
            if (free < 0 && this._igId[k] < 0) free = k;
        }
        if (free < 0) return;
        if (this._igId[free] !== id) this._igOwed[free] = 0;
        this._igId[free] = id;
        this._igLeft[free] = IGNITE_S;   // a fresh hit refreshes the burn
    }

    // ===================================================================
    // Frame
    // ===================================================================

    /**
     * Ember Coil ticks, the dodge-surf edge, the Undying Wake re-arm, the
     * Wakemender bonus and the Driftmark offer edge. Place it right after
     * `spellHits.update(dt)` so an ignite kill reaches every event-ring
     * consumer (floaters, motes, XP) this same frame.
     * @param {number} dt @returns {void}
     */
    update(dt) {
        if (dt === 0) return;
        const reg = this.registry;
        const c = this.character;
        const now = reg ? reg.time : 0;

        // ---- dodge-surf: the surf ollie's take-off edge.
        if (c) {
            const air = !!c.airborne;
            if (air && !this._wasAir && c.surf > SURF_ON) {
                this._dodgeUntil = now + DODGE_WINDOW;
                this.counters.dodges++;
            }
            this._wasAir = air;
        }

        // ---- Ember Coil burns. Paid on accrued burn time, clipped to the
        // window, so the total is frame-rate independent (4 ticks × 1.5).
        if (reg && this.igniteDps > 0) {
            const dm = this.spellHits ? this.spellHits.damageMult : 1;
            for (let k = 0; k < IGNITE_SLOTS; k++) {
                const id = this._igId[k];
                if (id < 0) continue;
                const slot = reg.slot(id);
                if (slot < 0 || reg.hp[slot] <= 0) { this._igId[k] = -1; continue; }
                const d = dt < this._igLeft[k] ? dt : this._igLeft[k];
                this._igLeft[k] -= d;
                this._igOwed[k] += d;
                while (this._igOwed[k] >= IGNITE_TICK - 1e-6 && reg.hp[slot] > 0) {
                    this._igOwed[k] -= IGNITE_TICK;
                    this.hitMultInto(reg, slot, KIND_FIRE);
                    const amt = this.igniteDps * IGNITE_TICK * dm * this.hm[0];
                    const dealt = reg.damage(id, amt, OPT_IGNITE);
                    this.counters.igniteTicks++;
                    this.counters.igniteDamage += dealt;
                }
                if (this._igLeft[k] <= 1e-6) this._igId[k] = -1;
            }
        }

        // ---- Undying Wake: once per FIGHT. Re-arms on respawn, or once a
        // fight is over (FIGHT_QUIET_S without a hit and no live boss event).
        const P = this.progression;
        const dead = !!(P && P.dead);
        if (this._wasDead && !dead) this._undyingArmed = true;
        this._wasDead = dead;
        if (!this._undyingArmed && now - this._lastHurt >= FIGHT_QUIET_S &&
            !(this.bosses && this.bosses.state === "live")) {
            this._undyingArmed = true;
        }

        // ---- Wakemender: +50% on every mote picked since last frame.
        const m = this.motes;
        if (m && m.stats) {
            const picked = m.stats.picked;
            if (picked !== this._motesSeen) {
                const n = picked - this._motesSeen;
                this._motesSeen = picked;
                if (n > 0 && this.moteHeal > 1 && c && c.health > 0) {
                    const max = c.healthMax;
                    const before = c.health;
                    c.health = Math.min(max, c.health + max * MOTE_HEAL_FRAC * (this.moteHeal - 1) * n);
                    this.counters.moteBonusHealed += c.health - before;
                }
            }
        }

        // ---- Driftmarks: offer on every newly minted mark (edge, not level).
        if (P) {
            const marks = P.driftmarks | 0;
            if (marks !== this._marksSeen) {
                this._marksSeen = marks;
                const pending = this.driftmarkPending();
                if (pending > 0 && this.bus) {
                    this.bus.emit("driftmark:offer", { pending, marks });
                }
            }
        }
    }

    /** @param {string} token @returns {void} */
    setRealm(token) {
        // Burns and dodge windows do not follow the player across a realm.
        this._igId.fill(-1);
        this._dodgeUntil = -1;
    }

    /** Unsubscribe from the bus and the save (tests / teardown). The
     *  consumers' `mods` fields go back to null = identity. */
    dispose() {
        if (this._offRealm) this._offRealm();
        if (this._offSave) this._offSave();
        this._offRealm = this._offSave = null;
        if (this.character && this.character.mods === this) this.character.mods = null;
        if (this.spells && this.spells.mods === this) this.spells.mods = null;
        if (this.spellHits && this.spellHits.mods === this) this.spellHits.mods = null;
    }

    // ===================================================================
    // Driftmarks (PROGRESSION §9, QUEST §4.4)
    // ===================================================================

    /** Unspent Driftmark picks. @returns {number} */
    driftmarkPending() {
        const P = this.progression;
        const dp = this.driftPicks;
        const have = P ? (P.driftmarks | 0) : 0;
        return Math.max(0, have - (dp.dmg + dp.hp + dp.surf));
    }

    /** Is the surf pick still worth anything (the +10% cap)? @returns {boolean} */
    canPickSurf() {
        return DRIFTMARK.surfPer * (this.driftPicks.surf + 1) <= DRIFTMARK.surfCap + 1e-9;
    }

    /**
     * Spend one pending Driftmark. @param {"dmg"|"hp"|"surf"} kind
     * @returns {boolean} true if applied
     */
    pickDriftmark(kind) {
        if (kind !== "dmg" && kind !== "hp" && kind !== "surf") return false;
        if (this.driftmarkPending() <= 0) return false;
        if (kind === "surf" && !this.canPickSurf()) return false;
        this.driftPicks[kind]++;
        this.recompute();
        if (this.progression && this.progression.save) this.progression.save();
        if (this.bus) {
            const info = STORY.driftmarks && STORY.driftmarks.picks
                ? STORY.driftmarks.picks[kind] : null;
            this.bus.emit("driftmark:chosen", {
                pick: kind, count: this.driftPicks[kind],
                name: info ? info.name : kind, pending: this.driftmarkPending(),
            });
        }
        return true;
    }

    // ===================================================================
    // The enemy runtime seam (damage TAKEN) — see the header
    // ===================================================================

    /**
     * Wrap the three enemy-runtime methods that decide player damage, on the
     * INSTANCE (enemies.js is untouched):
     *   _applyHit(i, u, …)  records the striking unit's tier for the call;
     *   _fireBolt(i, u, d)  pre-scales a HEAVY's projectile at launch;
     *   _hurtPlayer(dmg,…)  scales a heavy melee hit (Brass Buckle), then
     *                       Undying Wake converts a lethal result to 1 HP.
     * Every path that reduces controller.health from combat goes through
     * `_hurtPlayer` (its two call sites: melee `_applyHit`, bolts
     * `_updateBolts`), so this is complete. Idempotent.
     * @param {any} en the Enemies runtime @returns {void}
     */
    _attachEnemies(en) {
        if (!en || en.__rewardsWrapped) return;
        const self = this;
        const hit0 = en._applyHit;
        const hurt0 = en._hurtPlayer;
        const bolt0 = en._fireBolt;
        if (typeof hit0 === "function") {
            en._applyHit = function (i, u, d, dist, ux, uz) {
                self._srcTier = u ? u.tier : -1;
                try {
                    hit0.call(this, i, u, d, dist, ux, uz);
                } finally {
                    self._srcTier = -1;
                }
            };
        }
        if (typeof bolt0 === "function" && en.boltAlive && en.boltDmg) {
            const snap = new Uint8Array(en.boltAlive.length);
            en._fireBolt = function (i, u, d) {
                const heavy = u && u.tier === TIER.HEAVY && self.heavyTaken !== 1;
                if (heavy) snap.set(this.boltAlive);
                bolt0.call(this, i, u, d);
                if (heavy) {
                    for (let b = 0; b < snap.length; b++) {
                        if (this.boltAlive[b] && !snap[b]) {
                            this.boltDmg[b] *= self.heavyTaken;
                            self.counters.heavyHitsScaled++;
                        }
                    }
                }
            };
        }
        if (typeof hurt0 === "function") {
            en._hurtPlayer = function (dmg, sx, sz) {
                const c = self.character;
                const before = c.health;
                let d = dmg;
                if (self._srcTier === TIER.HEAVY && self.heavyTaken !== 1) {
                    d *= self.heavyTaken;
                    self.counters.heavyHitsScaled++;
                }
                hurt0.call(this, d, sx, sz);
                if (c.health < before) {
                    self._lastHurt = self.registry ? self.registry.time : 0;
                    self._undyingSave(before);
                }
            };
        }
        en.__rewardsWrapped = true;
    }

    /** Undying Wake: a hit that took the player from >0 to ≤0 leaves 1 HP. */
    _undyingSave(before) {
        const c = this.character;
        if (!(c.health <= 0 && before > 0 && this.undying && this._undyingArmed)) return;
        c.health = 1;
        this._undyingArmed = false;
        this.counters.undyingSaves++;
        if (this.bus) {
            const b = STORY.boons["boon.undyingWake"];
            this.bus.emit("boon:triggered", {
                id: "boon.undyingWake", name: b ? b.name : "Undying Wake",
            });
        }
    }

    /** Is Undying Wake charged right now? (probe/UI) @returns {boolean} */
    get undyingArmed() {
        return this.undying && this._undyingArmed;
    }

    /** Probe snapshot — allocates; never call on the frame path. */
    get stats() {
        return {
            dmgAll: this.dmgAll, dmgFrost: this.dmgFrost,
            dmgVsChilled: this.dmgVsChilled, dmgVsStaggered: this.dmgVsStaggered,
            waveDmg: this.waveDmg, waveKnock: this.waveKnock, dodgeDmg: this.dodgeDmg,
            maxHp: this.maxHp, maxMana: this.maxMana, manaRegen: this.manaRegen,
            surfSpeed: this.surfSpeed, surfJump: this.surfJump, cdMult: this.cdMult,
            cdFlat: Array.from(this.cdFlat), chillMax: this.chillMax,
            chillExtend: this.chillExtend, arcChills: this.arcChills,
            vortexRadius: this.vortexRadius, vortexDuration: this.vortexDuration,
            boltRange: this.boltRange, moteHeal: this.moteHeal,
            heavyTaken: this.heavyTaken, undying: this.undying,
            undyingArmed: this.undyingArmed, igniteDps: this.igniteDps,
            driftPicks: Object.assign({}, this.driftPicks),
            driftPending: this.driftmarkPending(),
            boons: this._boonIds.slice(), relics: this._relicIds.slice(),
            shop: Object.assign({}, this._shopRanks),
            counters: Object.assign({}, this.counters),
        };
    }
}
