/**
 * Wake Glass — the currency with a sink (_spec/QUEST_DESIGN.md §4.3).
 *
 * THE WALLET API other systems call (also reachable as `ctx.shop`):
 *   grant(n, why)  → adds, emits 'glass:changed' {total, delta, why}
 *   spend(n, why)  → false if short; else subtracts and emits the same
 *   glass          → the balance (int)
 *
 * EARNING (§4.3 "caches, trials, bounties, boss first-kills (100/150), and a
 * small trickle from elites (3 each)"):
 *   'reward' {kind: 'glass', amount}  — the world lanes' caches, trials and
 *       bounties. Treated as a GRANT REQUEST: this module applies it. A
 *       payload with `granted: true` is a notification of glass this module
 *       already paid (it emits those itself, below) and is ignored — so no
 *       reward is ever paid twice and no emitter needs a shop handle.
 *   'boss:killed' {kind, first: true} — +100 (mini) / +150 (realm), paid
 *       here, announced as 'reward' {kind:'glass', amount, granted:true}.
 *   'enemy:killed' {tier: ELITE, bounty: null} — +3, silently (a toast per
 *       elite would be noise; the bounty's own 40 is the world lane's).
 *   'reward' {kind: 'trail', id?} — a silver-medal wake trail (the next
 *       unowned colour when the id is missing).
 *   'reward' {kind: 'reroll', amount?} — a boon reroll token from any lane.
 *   'reward' {kind: 'lore', id: 'lore.<realm>.<n>'} — counted (deduped) so
 *       the 12th shard of a realm pays the Chronicle's free reroll token
 *       (§3.4) exactly once, announced as 'reward' {kind:'reroll',
 *       id:'chronicle.<realm>', granted:true}. Nobody else pays it (the world
 *       lane grants shards, the journal shows them), so the ledger lives
 *       here, persisted as section "chronicleRerolls" {seen, paid}.
 *
 * THE SHOP (§4.3 prices verbatim), spent at an activated shrine
 * (ui/shrineMenu.js calls `buy()`):
 *   shop.vitality   I-V   60/90/130/180/240  +4% max HP each
 *   shop.wellspring I-V   60/90/130/180/240  +4% max mana each
 *   shop.reroll     80    one boon reroll token (see boons.js respec)
 *   trail.*         40    six cosmetic wake colours, owned once, equippable
 *   shop.slot3      400   the third relic slot early (free after the Sand
 *                         realm boss — relics.js)
 * Rank effects are folded by modifiers.js (SHOP_RANK_FX) — `mods.setShop()`.
 *
 * WAKE TRAILS are real, not a label: the equipped colour tints the surf
 * wake's albedo uniform (`wake.wakeUniforms.uWakeAlbedo`, which
 * `surfWake.applyRealm` writes from the realm row), re-applied by
 * `setRealm()` after every realm swap. Needs `ctx.wake`; without it a trail
 * is owned and equipped but draws nothing (reported, not hidden).
 *
 * SAVE (QUEST §8 keys, lane Q v4 sections): "wakeGlass" (int), "shop"
 * ({itemId: rank} — trails and slot 3 as rank 1), "rerolls" (int), plus two
 * additive to §8: "wakeTrail" (equipped trail id | null) and
 * "chronicleRerolls" (the ledger above).
 *
 * MODULE SHAPE: constructor(ctx) after `Modifiers`; update(dt);
 * setRealm(token). Self-registers as `ctx.shop`.
 */

import { TIER } from "../combat/damageable.js";
import { STORY } from "../quests/storyText.js";
import { registerSection } from "./modifiers.js";

/** Rank prices (QUEST §4.3). */
export const RANK_PRICES = Object.freeze([60, 90, 130, 180, 240]);
export const REROLL_PRICE = 80;
export const TRAIL_PRICE = 40;
export const SLOT3_PRICE = 400;
/** Boss first-kill payouts (QUEST §4.3). */
export const BOSS_GLASS = Object.freeze({ mini: 100, realm: 150 });
/** Elite trickle (QUEST §4.3). */
export const ELITE_GLASS = 3;

/** The six wake trail colours: STORY ids, linear-RGB hue (luma-normalised). */
export const TRAILS = Object.freeze([
    { id: "trail.frost", rgb: [0.55, 0.80, 1.00] },
    { id: "trail.aurora", rgb: [0.42, 1.00, 0.62] },
    { id: "trail.brass", rgb: [1.00, 0.78, 0.36] },
    { id: "trail.dusk", rgb: [0.74, 0.52, 1.00] },
    { id: "trail.ember", rgb: [1.00, 0.52, 0.22] },
    { id: "trail.garnet", rgb: [0.95, 0.28, 0.34] },
]);
/** How far a trail pulls the wake toward its hue (0 = realm albedo). */
const TRAIL_MIX = 0.55;
/** Albedo ceiling for a tinted wake (the brightest realm row is 0.965). */
const ALBEDO_MAX = 0.98;
/** QUEST §3.4 — lore shards per realm (one per non-relic cache). */
const LORE_PER_REALM = 12;

/** Every buyable id, in shop order. */
export const SHOP_ORDER = Object.freeze([
    "shop.vitality", "shop.wellspring", "shop.reroll", "shop.slot3",
].concat(TRAILS.map((t) => t.id)));

/** @param {string} id @returns {{id:string, name:string, effect:string, flavor:string}} */
export function shopInfo(id) {
    const s = STORY && STORY.shop ? STORY.shop[id] : null;
    if (s) return { id, name: s.name, effect: s.effect, flavor: s.flavor || "" };
    const t = STORY && STORY.trails ? STORY.trails[id] : null;
    if (t) return { id, name: t.name, effect: "Wake Trail", flavor: t.desc || "" };
    return { id, name: id, effect: "", flavor: "" };
}

export class Shop {
    /** @param {any} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.bus = ctx.bus || null;
        this.mods = ctx.mods || null;
        this.progression = ctx.progression || null;
        this.wake = ctx.wake || null;
        this.realms = ctx.realms || null;

        this._glass = 0;
        /** itemId → rank (trails / slot 3: 1 = owned). @type {Record<string, number>} */
        this.ranks = {};
        this.rerolls = 0;
        /** @type {string|null} */
        this.trail = null;
        this._realm = "cold";
        /** Chronicle ledger (section "chronicleRerolls"). @type {string[]} */
        this._loreSeen = [];
        /** @type {string[]} realms whose Chronicle token was paid */
        this._chroniclePaid = [];

        ctx.shop = this;

        if (this.bus) {
            this._offs = [
                this.bus.on("reward", (p) => this._onReward(p)),
                this.bus.on("boss:killed", (p) => {
                    if (!p || !p.first) return;
                    const n = BOSS_GLASS[p.kind] || 0;
                    if (n > 0) {
                        this.grant(n, "boss:" + p.realm + "." + p.kind);
                        this.bus.emit("reward", {
                            kind: "glass", id: "glass.boss", name: STORY.ui ? STORY.ui.currency : "Wake Glass",
                            desc: "", amount: n, granted: true,
                        });
                    }
                }),
                this.bus.on("enemy:killed", (p) => {
                    if (!p || p.bounty) return;
                    if (p.tier === TIER.ELITE || p.tier === "elite") this.grant(ELITE_GLASS, "elite");
                }),
                // The trail re-tint after a realm swap. main.js should ALSO
                // call setRealm(token) right after wake.applyRealm (which
                // rewrites the albedo) — this listener covers an integration
                // that only publishes the bus fact. Idempotent.
                this.bus.on("realm:entered", (p) => {
                    if (p && typeof p.realm === "string") this.setRealm(p.realm);
                }),
            ];
        }

        /** Save-section unregister handles (dispose). @type {(() => void)[]} */
        this._offSaves = [];
        const section = (name, impl) => {
            const off = registerSection(this.progression, name, impl);
            if (off) this._offSaves.push(off);
        };
        section("wakeGlass", {
            serialize: () => this._glass,
            deserialize: (v) => {
                this._glass = Math.max(0, Math.floor(+v || 0));
                this._changed(0, "load");
            },
        });
        section("shop", {
            serialize: () => Object.assign({}, this.ranks),
            deserialize: (v) => {
                this.ranks = {};
                if (v && typeof v === "object") {
                    for (const k in v) {
                        const r = Math.floor(+v[k] || 0);
                        if (r > 0 && this._maxRank(k) > 0) this.ranks[k] = Math.min(r, this._maxRank(k));
                    }
                }
                if (this.ranks["shop.slot3"] && this.ctx.relics) this.ctx.relics.unlockSlot3("shop");
                this._applyRanks();
            },
        });
        section("rerolls", {
            serialize: () => this.rerolls,
            deserialize: (v) => { this.rerolls = Math.max(0, Math.floor(+v || 0)); },
        });
        section("chronicleRerolls", {
            serialize: () => ({ seen: this._loreSeen.slice(), paid: this._chroniclePaid.slice() }),
            deserialize: (v) => {
                const ok = v && typeof v === "object";
                this._loreSeen = ok && Array.isArray(v.seen)
                    ? v.seen.filter((s) => typeof s === "string") : [];
                this._chroniclePaid = ok && Array.isArray(v.paid)
                    ? v.paid.filter((s) => s === "cold" || s === "sand" || s === "ash") : [];
            },
        });
        section("wakeTrail", {
            serialize: () => this.trail,
            deserialize: (v) => {
                this.trail = typeof v === "string" && this.ranks[v] ? v : null;
                this._applyTrail();
            },
        });
        this._applyRanks();
    }

    // ------------------------------------------------------------- wallet

    /** @returns {number} */
    get glass() { return this._glass; }

    /**
     * @param {number} n whole Wake Glass (non-positive is ignored)
     * @param {string} [why] provenance, carried on 'glass:changed'
     * @returns {number} the new balance
     */
    grant(n, why) {
        n = Math.floor(+n || 0);
        if (n <= 0) return this._glass;
        this._glass += n;
        this._changed(n, why || "");
        // Big grants are save points; the elite trickle rides the heartbeat.
        if (n >= 20) this._save();
        return this._glass;
    }

    /** @param {number} n @param {string} [why] @returns {boolean} */
    spend(n, why) {
        n = Math.floor(+n || 0);
        if (n < 0 || n > this._glass) return false;
        if (n === 0) return true;
        this._glass -= n;
        this._changed(-n, why || "");
        this._save();
        return true;
    }

    /** Spend one boon reroll token (boons.js field respec). @returns {boolean} */
    useReroll() {
        if (this.rerolls <= 0) return false;
        this.rerolls--;
        this._save();
        return true;
    }

    // ------------------------------------------------------------- shop

    /** @param {string} id @returns {number} ranks the item has (0 = unknown) */
    _maxRank(id) {
        if (id === "shop.vitality" || id === "shop.wellspring") return RANK_PRICES.length;
        if (id === "shop.slot3") return 1;
        if (id === "shop.reroll") return 0;           // consumable: never a rank
        for (let i = 0; i < TRAILS.length; i++) if (TRAILS[i].id === id) return 1;
        return 0;
    }

    /** @param {string} id @returns {number} current rank / owned flag */
    rank(id) { return this.ranks[id] | 0; }

    /**
     * The price of the NEXT purchase of `id`, or null when it cannot be
     * bought again (maxed, owned, or slot 3 already open).
     * @param {string} id @returns {number|null}
     */
    price(id) {
        if (id === "shop.reroll") return REROLL_PRICE;
        const r = this.rank(id);
        if (id === "shop.vitality" || id === "shop.wellspring") {
            return r < RANK_PRICES.length ? RANK_PRICES[r] : null;
        }
        if (id === "shop.slot3") {
            const rel = this.ctx.relics;
            return r > 0 || (rel && rel.slot3Unlocked) ? null : SLOT3_PRICE;
        }
        if (this._maxRank(id) === 1) return r > 0 ? null : TRAIL_PRICE;
        return null;
    }

    /**
     * Buy the next rank / unit of `id`.
     * @param {string} id @returns {{ok: boolean, reason?: string, rank?: number}}
     */
    buy(id) {
        const p = this.price(id);
        if (p === null) return { ok: false, reason: this._maxRank(id) || id === "shop.reroll" ? "maxed" : "unknown" };
        if (!this.spend(p, "shop:" + id)) return { ok: false, reason: "not enough Wake Glass" };
        let rank = 0;
        if (id === "shop.reroll") {
            this.rerolls++;
            rank = this.rerolls;
        } else {
            rank = this.rank(id) + 1;
            this.ranks[id] = rank;
            if (id === "shop.slot3" && this.ctx.relics) this.ctx.relics.unlockSlot3("shop");
            if (this._isTrail(id)) this.equipTrail(id);
            this._applyRanks();
        }
        this._save();
        if (this.bus) this.bus.emit("shop:bought", { itemId: id, rank, cost: p });
        return { ok: true, rank };
    }

    // ------------------------------------------------------------- trails

    /** @param {string} id @returns {boolean} */
    _isTrail(id) {
        for (let i = 0; i < TRAILS.length; i++) if (TRAILS[i].id === id) return true;
        return false;
    }

    /**
     * Own a trail without paying (a silver medal). The next unowned colour
     * when `id` is missing or unknown. @param {string} [id] @returns {string|null}
     */
    ownTrail(id) {
        let tid = id && this._isTrail(id) && !this.ranks[id] ? id : null;
        if (!tid) {
            for (let i = 0; i < TRAILS.length; i++) {
                if (!this.ranks[TRAILS[i].id]) { tid = TRAILS[i].id; break; }
            }
        }
        if (!tid) return null;
        this.ranks[tid] = 1;
        if (!this.trail) this.equipTrail(tid);
        this._save();
        return tid;
    }

    /** @param {string|null} id owned trail, or null for the realm's own wake */
    equipTrail(id) {
        if (id !== null && !(this._isTrail(id) && this.ranks[id])) return false;
        this.trail = id;
        this._applyTrail();
        this._save();
        return true;
    }

    // ------------------------------------------------------------- frame

    update(dt) { /* event-driven */ }

    /** Unsubscribe from the bus and the save (tests / teardown). */
    dispose() {
        if (this._offs) for (let i = 0; i < this._offs.length; i++) this._offs[i]();
        for (let i = 0; i < this._offSaves.length; i++) this._offSaves[i]();
        this._offs = null;
        this._offSaves = [];
    }

    /** Re-tint after `wake.applyRealm` rewrote the realm albedo.
     *  @param {string} token */
    setRealm(token) {
        if (typeof token === "string") this._realm = token;
        this._applyTrail();
    }

    // ------------------------------------------------------------- internals

    /** @param {any} p */
    _onReward(p) {
        if (!p || p.granted) return;
        if (p.kind === "glass") {
            this.grant(p.amount, p.id || "reward");
        } else if (p.kind === "trail") {
            const tid = this.ownTrail(p.id);
            if (tid) {
                try { if (p.id !== tid) p.id = tid; } catch (e) { /* frozen payload */ }
            }
        } else if (p.kind === "reroll") {
            this.rerolls += Math.max(1, Math.floor(+p.amount || 1));
            this._save();
        } else if (p.kind === "lore") {
            this._onLore(p.id);
        }
    }

    /**
     * QUEST §3.4: all 12 lore shards of a realm pay one free boon REROLL
     * token (the journal's Chronicle page is lane U's). Nobody else pays it —
     * the world lane grants shards, the journal shows them — so the ledger
     * lives here: which shard ids were seen, which realms were paid. Once.
     * @param {string} id "lore.<realm>.<n>"
     */
    _onLore(id) {
        if (typeof id !== "string") return;
        const m = /^lore\.(cold|sand|ash)\.\d+$/.exec(id);
        if (!m || this._loreSeen.indexOf(id) >= 0) return;
        this._loreSeen.push(id);
        const realm = m[1];
        if (this._chroniclePaid.indexOf(realm) >= 0) return;
        let n = 0;
        for (let i = 0; i < this._loreSeen.length; i++) {
            if (this._loreSeen[i].indexOf("lore." + realm + ".") === 0) n++;
        }
        if (n < LORE_PER_REALM) return;
        this._chroniclePaid.push(realm);
        this.rerolls++;
        this._save();
        if (this.bus) {
            this.bus.emit("reward", {
                kind: "reroll", id: "chronicle." + realm, amount: 1, granted: true,
                name: "Boon Reroll", desc: "The " + realm + " Chronicle is complete",
            });
        }
    }

    _applyRanks() {
        if (this.mods) this.mods.setShop(this.ranks);
    }

    _applyTrail() {
        const w = this.wake;
        if (!w || !w.wakeUniforms || !w.wakeUniforms.uWakeAlbedo) return;
        const u = w.wakeUniforms.uWakeAlbedo.value;
        // The realm's authored albedo is the base every time — never the
        // current (possibly already tinted) value, so swaps never compound.
        let base = [0.895, 0.920, 0.965];
        const R = this.realms && this.realms.realm ? this.realms.realm(this._realm) : null;
        if (R && R.ground && R.ground.wakeAlbedo) base = R.ground.wakeAlbedo;
        let tr = null;
        for (let i = 0; i < TRAILS.length; i++) if (TRAILS[i].id === this.trail) tr = TRAILS[i];
        if (!tr) {
            u[0] = base[0]; u[1] = base[1]; u[2] = base[2];
            return;
        }
        const lb = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
        const lt = 0.2126 * tr.rgb[0] + 0.7152 * tr.rgb[1] + 0.0722 * tr.rgb[2];
        const k = lb / Math.max(1e-3, lt);
        for (let c = 0; c < 3; c++) {
            u[c] = base[c] * (1 - TRAIL_MIX) + tr.rgb[c] * k * TRAIL_MIX;
        }
        // An ALBEDO never exceeds 1: luma-matching a saturated hue against
        // bright snow pushed Ember's red to 1.24 (measured by qa_rewards.py),
        // a surface reflecting more light than it receives. Scale the whole
        // colour down (hue kept, a little luma given up) instead.
        const mx = u[0] > u[1] ? (u[0] > u[2] ? u[0] : u[2]) : (u[1] > u[2] ? u[1] : u[2]);
        if (mx > ALBEDO_MAX) {
            const s = ALBEDO_MAX / mx;
            u[0] *= s; u[1] *= s; u[2] *= s;
        }
    }

    /** @param {number} delta @param {string} why */
    _changed(delta, why) {
        if (this.bus) this.bus.emit("glass:changed", { total: this._glass, delta, why });
    }

    _save() {
        const P = this.progression;
        if (P && typeof P.save === "function") P.save();
    }
}
