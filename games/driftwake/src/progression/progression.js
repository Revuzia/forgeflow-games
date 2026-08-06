/**
 * Progression — XP, levels, unlocks, Driftmarks, rested XP, death/respawn and
 * the versioned save blob (_spec/PROGRESSION_DESIGN.md; P1.1 + P1.2 + the
 * §8.1 respawn rule, built against the Damageable registry's event ring).
 *
 * CONSUMES, per damageable.js's contract: the registry's per-frame EVENT RING
 * ("kill" events, type 1), drained by polling — `update()` runs once per frame
 * from `main.js`, AFTER combat updates and BEFORE `registry.endFrame()`
 * clears the ring. Same polled philosophy as the rest of the engine; the
 * steady-frame path allocates nothing (saving allocates, but a save is an
 * event — ding, death, the 30 s timer — never a frame).
 *
 * EVERY NUMBER here traces to _spec/PROGRESSION_DESIGN.md:
 *   §2.1  XP curve: 50 at L1 (flat override), round(85·L^1.9) for 2..29, cap 30
 *   §3.1  BaseKillXP = round(10·L^1.25); min(enemyL, playerL) con base;
 *         per-kill cap = max(12.5% of XP_to_next, BaseKillXP(playerL)) — the
 *         floor is what exempts the early levels (it only binds at L1)
 *   §3.2  tier mults = budget cost ÷ 3 (fodder 1/3 … elite 8/3, boss 10);
 *         boss FIRST kills pay flat 20% (miniboss) / 35% (realm boss) of
 *         XP_to_next, once, tracked in `bossesKilled`, exempt from the cap
 *   §3.3  con colors/multipliers, one table (×1.5 … ×0.05 gray floor)
 *   §3.4  streak +3%/kill from the 5th, 4 s window, cap ×1.5; rested banks
 *         50% of XP_to_next per 8 h away, cap 150%, ×2 pay draining 1:1
 *   §4    ding: full heal+mana; +9% dmg / +7% HP / +5% mana / +3% regen per
 *         level, compounding, anchored at L10 = 100 HP / 100 mana / 9 regen
 *   §7    unlock schedule (internal spell ids per ui/spellbar.js):
 *         L1 Bolt(2)+Wave(1) · L2 Mini-Vortex(3) · L4 Spikes(4) · L6 Great
 *         Vortex(5)
 *   §8.1  death: knockdown fade 1.5 s → respawn at last shrine (cold spawn
 *         defaults, never null), full pools, 2 s grace; no XP loss
 *   §9    Driftmarks: overflow at cap, cost(n) = round(20000·1.05^(n-1)),
 *         cap 100
 *
 * Multiplier stacking order (§3.4): base × tier × con × streak × rested,
 * then the §3.1 per-kill cap. Boss first-kill flat grants are the single
 * cap exemption (§3.2).
 *
 * SAVE BLOB v2 — localStorage `driftwake_save` (P1.2, schema bumped to 2 for
 * the `deaths` counter): {schemaVer, level, xp, driftmarks, spellsUnlocked,
 * boons, realmsUnlocked, bossesKilled, lastShrineId, restedBank, lastSeenTs,
 * objectiveState, deaths}. Loaded on construct; saved on ding, death, boss
 * first-kill and every 30 s. Restore is at the shrine, never exact position
 * (no save-inside-hazard).
 */

import { TIER } from "../combat/damageable.js";

/** The one localStorage key. */
export const SAVE_KEY = "driftwake_save";
/** Current save schema. v1 blobs load with defaulted new fields. */
export const SCHEMA_VER = 2;

/**
 * Spell unlock levels by INTERNAL spell id (§7 mapped through the owner
 * binds — combat doc §1.1: LMB/id 2 = Frost Bolt, key 1/id 1 = Wave,
 * key 2/id 3 = Mini-Vortex, key 3/id 4 = Spikes, key 4/id 5 = Great Vortex).
 * The spellbar renders its `.locked` level tags from this same table, so the
 * tag and the gate can never disagree.
 * @type {Record<number, number>}
 */
export const UNLOCK_LEVEL = { 2: 1, 1: 1, 3: 2, 4: 4, 5: 6 };

/**
 * Every tunable in one bag, so a data override (or a future realm variant)
 * swaps numbers without touching logic. Values are the spec's, cited above.
 */
export const DEFAULT_DATA = {
    levelCap: 30,                       // §1
    xpL1: 50,                           // §2.1 flat override
    xpCoef: 85, xpExp: 1.9,             // §2.1
    killXP: {
        baseCoef: 10, baseExp: 1.25,    // §3.1
        /** §3.2 — budget cost ÷ 3, indexed by TIER; BOSS row = repeat mult. */
        tierMult: [1 / 3, 2 / 3, 1, 5 / 3, 8 / 3, 10],
        capFrac: 0.125,                 // §3.1 per-kill cap (EQ 1/8 rule)
        firstKill: { miniboss: 0.20, boss: 0.35 },  // §3.2 / §3.5
        streak: { start: 5, per: 0.03, window: 4, cap: 1.5 },  // §3.4
        rested: { hours: 8, frac: 0.5, capFrac: 1.5 },         // §3.4
    },
    growth: {                           // §4, anchored at L10 (§1)
        anchor: 10,
        hp: 1.07, hpAnchor: 100,
        mana: 1.05, manaAnchor: 100,
        regen: 1.03, regenAnchor: 9,
        dmg: 1.09,
    },
    driftmarks: { baseCost: 20000, growth: 1.05, cap: 100 },   // §9
    deathFadeSec: 1.5,                  // §8.1 knockdown fade
    respawnGraceSec: 2,                 // §8.1 i-frame grace
    autosaveSec: 30,                    // P1.2 interval
};

/**
 * XP required to leave level L (§2.1). Undefined past the cap by design; the
 * cap's analog for grants/caps is the Driftmark cost (§9 — "Driftmark XP
 * still obeys con/gray rules"), served by Progression._need().
 * @param {number} L @param {typeof DEFAULT_DATA} [d] @returns {number}
 */
export function xpToNext(L, d) {
    const dd = d || DEFAULT_DATA;
    if (L <= 1) return dd.xpL1;
    return Math.round(dd.xpCoef * Math.pow(L, dd.xpExp));
}

/**
 * Base kill value at a level (§3.1) — medium tier, even con.
 * @param {number} L @param {typeof DEFAULT_DATA} [d] @returns {number}
 */
export function baseKillXP(L, d) {
    const dd = d || DEFAULT_DATA;
    return Math.round(dd.killXP.baseCoef * Math.pow(L, dd.killXP.baseExp));
}

/**
 * Con multiplier from level difference (§3.3 — the same table the UI colors
 * from, so the color can never lie). diff = enemyLevel − playerLevel.
 * @param {number} diff @returns {number}
 */
export function conMult(diff) {
    if (diff >= 5) return 1.5;      // skull
    if (diff >= 3) return 1.25;     // orange
    if (diff >= -3) return 1.0;     // yellow / white
    if (diff === -4) return 0.75;   // green
    if (diff === -5) return 0.5;    // green
    if (diff === -6) return 0.25;   // green
    return 0.05;                    // gray — 5% floor, never 0 (D2 rule)
}

/**
 * Driftmark n's cost (§9), n = 1-based mark index.
 * @param {number} n @param {typeof DEFAULT_DATA} [d] @returns {number}
 */
export function driftmarkCost(n, d) {
    const dm = (d || DEFAULT_DATA).driftmarks;
    return Math.round(dm.baseCost * Math.pow(dm.growth, n - 1));
}

export class Progression {
    /**
     * @param {import("../character/controller.js").CharacterController} controller
     *   Owns the pools this system grows (`healthMax`/`manaMax`/`manaRegen`)
     *   and the position the respawn writes. `controller.terrain` supplies
     *   the respawn ground height.
     * @param {import("../combat/damageable.js").DamageableRegistry|null} registry
     *   Kill-event source. Null is legal (enemies not built yet) — every
     *   registry read is guarded, so this file ships ahead of the substrate.
     * @param {typeof DEFAULT_DATA} [data] Number overrides; defaults to the
     *   spec table above.
     */
    constructor(controller, registry, data) {
        this.controller = controller;
        this.registry = registry || null;
        this.data = data || DEFAULT_DATA;

        // ------------------------------------------------- persisted state
        this.level = 1;
        /** XP into the current level (overflow-to-Driftmarks at cap, §9). */
        this.xp = 0;
        this.driftmarks = 0;
        this.deaths = 0;
        /**
         * Unlocked INTERNAL spell ids. IDENTITY IS STABLE — `attach()` hands
         * this exact Set to the spell system's dispatch gate and the spellbar,
         * so it is only ever mutated, never reassigned.
         * @type {Set<number>}
         */
        this.unlocked = new Set();
        /** @type {string[]} shrine boon picks (§8.3; P3.3 populates). */
        this.boons = [];
        /** @type {string[]} */
        this.realmsUnlocked = ["cold"];
        /** @type {Record<string, boolean>} first-kill flags, by boss name (§3.2). */
        this.bossesKilled = {};
        /** §8.1 — defaults to the cold spawn shrine, never null. */
        this.lastShrineId = "cold_spawn";
        /** Banked rested XP (§3.4), drained 1:1 while it pays ×2. */
        this.restedBank = 0;
        /** Wall-clock ms of the last save; rested accrual reads the delta. */
        this.lastSeenTs = Date.now();
        /** @type {Record<string, number>} per-realm objective chain node (P3.1). */
        this.objectiveState = {};

        // ------------------------------------------------- live state
        /**
         * Known shrines: id → world position. The cold spawn is the origin
         * area where main.js places the character; the shrine network (P0.2)
         * registers the rest through `addShrine()`.
         * @type {Record<string, {x:number, z:number}>}
         */
        this.shrines = { cold_spawn: { x: 0, z: 0 } };
        /** Player spell-damage multiplier, 1.09^(L−10) (§4). SpellSystem
         *  scales outgoing damage by this — pushed into `spells.damageMult`
         *  on attach and on every ding. */
        this.damageMult = 1;
        /** Game-time i-frame deadline after a respawn (§8.1). The enemy
         *  runtime must skip player damage while `isInvulnerable()`. */
        this.graceUntil = 0;
        /** True from hp≤0 until the respawn lands (the §8.1 fade window). */
        this.dead = false;
        /** Monotonic ding counter — the XP HUD polls it for the flash edge. */
        this.dingCount = 0;
        /** Current level's XP requirement (or next Driftmark cost at cap) —
         *  maintained here so the HUD polls two numbers, no formulas. */
        this.xpNeed = xpToNext(1, this.data);
        /** Last grant, for debug probes and the future floater layer. */
        this.lastXP = 0;
        this.lastXPWhy = "";

        /** @type {{unlocked?:Set<number>, damageMult?:number}|null} */
        this.spells = null;
        /** @type {{ding?:() => void}|null} */
        this.hud = null;

        this.time = 0;
        this._saveTimer = 0;
        this._deathT = 0;
        this._streak = 0;
        this._streakAt = -Infinity;

        this.load();
        // Fresh session restore: pools at the loaded level, filled (P1.2
        // restores at the shrine with full pools; position is the integrator's
        // spawn placement, which IS the cold spawn shrine).
        this._applyLevelStats(true);
    }

    /**
     * Late-bind the systems that consume progression state.
     * @param {{spells?: any, hud?: any}} refs `spells` gets the live
     *   `unlocked` Set and `damageMult` pushed onto it (its dispatch gate and
     *   damage scaling read them); `hud` is the XP HUD — its `ding()` hook is
     *   optional because it also polls `dingCount`.
     * @returns {void}
     */
    attach(refs) {
        if (refs.spells) {
            this.spells = refs.spells;
            refs.spells.unlocked = this.unlocked;
            refs.spells.damageMult = this.damageMult;
        }
        if (refs.hud) this.hud = refs.hud;
    }

    /**
     * Register a shrine and mark it as the respawn target (§8.1 activation
     * by touch — P0.2's network calls this).
     * @param {string} id @param {number} x @param {number} z
     * @returns {void}
     */
    addShrine(id, x, z) {
        this.shrines[id] = { x, z };
        this.lastShrineId = id;
        this.save();
    }

    /** §8.1 respawn grace / death window — enemies must not damage through
     *  it. @returns {boolean} */
    isInvulnerable() {
        return this.dead || this.time < this.graceUntil;
    }

    /**
     * One frame: drain kill events, watch for death, tick the autosave.
     * Runs AFTER combat updates and BEFORE `registry.endFrame()` (the
     * damageable.js consumer contract). Allocates nothing.
     * @param {number} dt @returns {void}
     */
    update(dt) {
        this.time += dt;

        // ---- kill events → XP (registry may not exist yet; guarded).
        const r = this.registry;
        if (r) {
            const n = r.eventCount;
            for (let e = 0; e < n; e++) {
                if (r.evType[e] === 1) this._onKill(r.evId[e], r.evTier[e]);
            }
        }

        // ---- death → fade → respawn (§8.1).
        const c = this.controller;
        if (!this.dead && c.health <= 0) {
            this.dead = true;
            this._deathT = 0;
            this.deaths++;
        }
        if (this.dead) {
            this._deathT += dt;
            if (this._deathT >= this.data.deathFadeSec) this._respawn();
        }

        // ---- autosave (30 s of game time; frozen frames don't count).
        this._saveTimer += dt;
        if (this._saveTimer >= this.data.autosaveSec) {
            this._saveTimer = 0;
            this.save();
        }
    }

    /**
     * Grant XP. Kills arrive here pre-multiplied and pre-capped from
     * `_onKill`; objective/shrine grants (§3.5) call this directly. Handles
     * level-ups (the ding), the cap overflow into Driftmarks, and saving.
     * @param {number} n whole XP
     * @param {string} [why] provenance tag ("kill", "boss-first", "shrine"…)
     * @returns {void}
     */
    addXP(n, why) {
        if (!(n > 0)) return;
        this.lastXP = n;
        this.lastXPWhy = why || "";
        this.xp += n;

        const cap = this.data.levelCap;
        if (this.level >= cap) {
            this._mintDriftmarks();
            return;
        }
        let dinged = false;
        while (this.level < cap && this.xp >= this.xpNeed) {
            this.xp -= this.xpNeed;
            this.level++;
            dinged = true;
            this._refreshNeed();
            this._unlockCheck();
        }
        if (dinged) {
            // §4 — full heal + full mana, stat growth, no modal.
            this._applyLevelStats(true);
            this.dingCount++;
            if (this.hud && this.hud.ding) this.hud.ding();
            if (this.level >= cap) this._mintDriftmarks();
            this.save();
        }
    }

    /** Persist the v2 blob. Event-scoped — never on the steady frame path.
     *  @returns {void} */
    save() {
        this.lastSeenTs = Date.now();
        const blob = {
            schemaVer: SCHEMA_VER,
            level: this.level,
            xp: this.xp,
            driftmarks: this.driftmarks,
            spellsUnlocked: Array.from(this.unlocked),
            boons: this.boons,
            realmsUnlocked: this.realmsUnlocked,
            bossesKilled: this.bossesKilled,
            lastShrineId: this.lastShrineId,
            restedBank: Math.round(this.restedBank),
            lastSeenTs: this.lastSeenTs,
            objectiveState: this.objectiveState,
            deaths: this.deaths,
        };
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
        } catch (e) {
            // Storage denied/full: play continues, persistence degrades.
        }
    }

    /**
     * Load the blob (v1 or v2 — v1 lacks `deaths`/`objectiveState`, which
     * default). A missing or corrupt blob is a fresh character; a corrupt one
     * is never partially applied. Rested accrual (§3.4) runs here off the
     * `lastSeenTs` delta: 50% of XP_to_next per 8 h away, capped at 150%.
     * @returns {void}
     */
    load() {
        let b = null;
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (raw) b = JSON.parse(raw);
        } catch (e) {
            b = null;
        }
        if (!b || typeof b !== "object" || typeof b.level !== "number") {
            this._refreshNeed();
            this._unlockCheck();
            return;
        }

        const cap = this.data.levelCap;
        this.level = Math.max(1, Math.min(cap, Math.floor(b.level)));
        this.xp = Math.max(0, +b.xp || 0);
        this.driftmarks = Math.max(0, Math.min(this.data.driftmarks.cap,
            Math.floor(+b.driftmarks || 0)));
        this.deaths = Math.max(0, Math.floor(+b.deaths || 0));
        this.boons = Array.isArray(b.boons) ? b.boons : [];
        this.realmsUnlocked = Array.isArray(b.realmsUnlocked) && b.realmsUnlocked.length
            ? b.realmsUnlocked : ["cold"];
        this.bossesKilled = (b.bossesKilled && typeof b.bossesKilled === "object")
            ? b.bossesKilled : {};
        this.lastShrineId = typeof b.lastShrineId === "string" && b.lastShrineId
            ? b.lastShrineId : "cold_spawn";
        this.objectiveState = (b.objectiveState && typeof b.objectiveState === "object")
            ? b.objectiveState : {};

        this._refreshNeed();

        // Rested accrual from time away (§3.4). Continuous, pro-rated.
        const rest = this.data.killXP.rested;
        const then = +b.lastSeenTs || Date.now();
        const hoursAway = Math.max(0, (Date.now() - then) / 3600000);
        const accrued = (hoursAway / rest.hours) * rest.frac * this.xpNeed;
        this.restedBank = Math.min(
            Math.max(0, +b.restedBank || 0) + accrued,
            rest.capFrac * this.xpNeed
        );

        // Schedule unlocks for the loaded level, then union the saved list
        // (future boon/augment grants outside the schedule survive).
        this._unlockCheck();
        if (Array.isArray(b.spellsUnlocked)) {
            for (let i = 0; i < b.spellsUnlocked.length; i++) {
                const id = +b.spellsUnlocked[i];
                if (id >= 1 && id <= 5) this.unlocked.add(id);
            }
        }
    }

    // ------------------------------------------------------------- internals

    /**
     * One kill event → one XP grant, the full §3 pipeline:
     * base(min level) × tier × con × streak × rested, then the per-kill cap —
     * except a boss FIRST kill, which pays the flat §3.2 grant, uncapped.
     * @param {number} id registry id @param {number} tier evTier
     * @returns {void}
     */
    _onKill(id, tier) {
        const r = this.registry;
        const k = this.data.killXP;
        const pl = this.level;

        // The slot usually still exists on the kill frame (removal is the
        // owning body's, later). If it is already gone, the honest fallback
        // is an even-con non-boss kill at the event's recorded tier.
        let el = pl, kind = null, name = null;
        const s = r.slot(id);
        if (s >= 0) {
            el = r.level[s];
            kind = r.kind[s];
            name = r.name[s];
        }

        // Streak window (§3.4): chained kills within 4 s; expiry resets.
        if (this.time - this._streakAt <= k.streak.window) this._streak++;
        else this._streak = 1;
        this._streakAt = this.time;

        // Boss first kill → flat percentage grant, once, cap-exempt (§3.2).
        if (kind === "boss") {
            const key = name || "boss#" + id;
            if (!this.bossesKilled[key]) {
                this.bossesKilled[key] = true;
                const frac = tier === TIER.BOSS
                    ? k.firstKill.boss : k.firstKill.miniboss;
                this.addXP(Math.round(frac * this._need()), "boss-first");
                this.save(); // the flag itself must not be lost to a crash
                return;
            }
        }

        // §3.1 formula. min() base: above-level enemies pay YOUR base.
        const base = baseKillXP(Math.min(el, pl), this.data);
        const tm = k.tierMult[tier] !== undefined ? k.tierMult[tier] : 1;
        const cm = conMult(el - pl);
        const sm = this._streak >= k.streak.start
            ? Math.min(k.streak.cap,
                1 + k.streak.per * (this._streak - k.streak.start + 1))
            : 1;
        let xp = base * tm * cm * sm;

        // Rested (§3.4): ×2 while the bank holds, draining 1:1 — implemented
        // as a bonus equal to the pre-rested pay, clipped to the bank, so the
        // last charge pays a partial double instead of a cliff.
        if (this.restedBank > 0) {
            const bonus = Math.min(this.restedBank, xp);
            this.restedBank -= bonus;
            xp += bonus;
        }

        // §3.1 per-kill cap with the BaseKillXP floor (the floor is why an
        // even-con medium kill is never capped, and why L1 works at all).
        const capAmt = Math.max(k.capFrac * this._need(), baseKillXP(pl, this.data));
        this.addXP(Math.round(Math.min(xp, capAmt)), "kill");
    }

    /**
     * The level's XP requirement — or, at cap, the next Driftmark's cost,
     * which is §9's analog for every percentage grant and cap.
     * @returns {number}
     */
    _need() {
        return this.xpNeed;
    }

    /** Recompute `xpNeed` for the current level / mark. @returns {void} */
    _refreshNeed() {
        const d = this.data;
        this.xpNeed = this.level >= d.levelCap
            ? driftmarkCost(Math.min(this.driftmarks + 1, d.driftmarks.cap), d)
            : xpToNext(this.level, d);
    }

    /** Convert overflow XP into Driftmarks at cap (§9). @returns {void} */
    _mintDriftmarks() {
        const dm = this.data.driftmarks;
        let minted = false;
        while (this.driftmarks < dm.cap) {
            const cost = driftmarkCost(this.driftmarks + 1, this.data);
            if (this.xp < cost) break;
            this.xp -= cost;
            this.driftmarks++;
            minted = true;
        }
        if (minted) {
            this._refreshNeed();
            this.dingCount++; // the bar flashes for a mark too (§9 UI)
            if (this.hud && this.hud.ding) this.hud.ding();
            this.save();
        }
    }

    /** Add every schedule unlock at or below the current level (§7).
     *  Mutates the live Set — never reassigns it. @returns {void} */
    _unlockCheck() {
        for (const idStr in UNLOCK_LEVEL) {
            const id = +idStr;
            if (UNLOCK_LEVEL[id] <= this.level) this.unlocked.add(id);
        }
    }

    /**
     * Apply §4 growth to the controller's pools, anchored at L10 (§1: at 10
     * the game IS the combat doc — 100 HP, 100 mana, 9 regen, ×1.0 damage).
     * Spec snapshots hold: L1 = 54 HP ×0.46 dmg, L20 = 197 ×2.37,
     * L30 = 387 ×5.60.
     * @param {boolean} heal true = the ding's full heal + mana refill
     * @returns {void}
     */
    _applyLevelStats(heal) {
        const g = this.data.growth;
        const c = this.controller;
        const dL = this.level - g.anchor;
        c.healthMax = Math.round(g.hpAnchor * Math.pow(g.hp, dL));
        c.manaMax = Math.round(g.manaAnchor * Math.pow(g.mana, dL));
        c.manaRegen = g.regenAnchor * Math.pow(g.regen, dL);
        this.damageMult = Math.pow(g.dmg, dL);
        if (this.spells) this.spells.damageMult = this.damageMult;
        if (heal) {
            c.health = c.healthMax;
            c.mana = c.manaMax;
        } else {
            c.health = Math.min(c.health, c.healthMax);
            c.mana = Math.min(c.mana, c.manaMax);
        }
    }

    /**
     * §8.1 respawn: at the last activated shrine (cold spawn by default),
     * full pools, velocity zeroed, 2 s grace. No XP or currency loss.
     * @returns {void}
     */
    _respawn() {
        const c = this.controller;
        const sh = this.shrines[this.lastShrineId] || this.shrines.cold_spawn;
        c.position.x = sh.x;
        c.position.z = sh.z;
        if (c.terrain && c.terrain.heightAt) {
            c.position.y = c.terrain.heightAt(sh.x, sh.z);
        }
        c.velocity.set(0, 0, 0);
        c.vertVel = 0;
        c.airborne = false;
        c.airHeight = 0;
        c.health = c.healthMax;
        c.mana = c.manaMax;
        this.graceUntil = this.time + this.data.respawnGraceSec;
        this.dead = false;
        this._deathT = 0;
        this._streak = 0; // a death breaks the chain
        this.save();
    }
}
