/**
 * Shrine boons — the six pick-of-two choices (_spec/QUEST_DESIGN.md §4.1,
 * _spec/PROGRESSION_DESIGN.md §8.3 / §3.2).
 *
 * THE PAIRS are keyed `<realm>.<kind>` — "cold.mini", "cold.realm", … — the
 * exact `realm` + `kind` of the 'boss:killed' event, and lane N's
 * `STORY.boonPairs` table. The key is what the save calls `bossKey` (QUEST
 * §8: `boons: [{bossKey, pick}]`). The Warden a pair belongs to is NAMED from
 * the live roster (`BOSS_NAMES`, below): Cold = The Icewall / Shrinebreaker,
 * Sand = Gatekeeper of Brass / Warden of the Sundered Gate, Ash = Furnace
 * Guardian / Volcanic Plate Knight — the six bosses the arenas really field
 * (the spec's "Moraine Elder" is not one of them).
 *
 * FLOW
 *   'boss:killed' {realm, kind, first: true}  → `offer(key)`: the pair joins
 *       `pending` (persisted) and 'boon:offer' {bossKey, pair} fires; the
 *       boon-pick modal (ui/boonPick.js) opens on it. First kills only — the
 *       same first-kill flag §3.2's flat XP rides (re-kills mint nothing).
 *   `choose(key, pick)`  → 'boon:chosen' {bossKey, boon}. The modal's Esc
 *       defers instead: the offer stays pending and is taken at any shrine.
 *   `respec(key, pick, {atShrine})`  → free at an activated shrine (QUEST
 *       §4.1). AWAY from a shrine it spends one boon REROLL token (QUEST §3.4 /
 *       §4.3) — the spec's pairs are fixed and shrine respec is free, so the
 *       one thing a token can buy that a shrine does not already give is the
 *       swap without the ride back (see the lane report: spec ambiguity).
 *
 * EFFECTS are not here: `modifiers.js` BOON_FX holds the numbers and every
 * consumer reads the folded multiplier. This module only decides WHICH boon
 * ids are in force and hands them over with `mods.setBoons(ids)`.
 *
 * SAVE (lane Q v4 sections): "boons" = [{bossKey, pick: 0|1}] exactly as §8
 * draws it (a v1-v3 blob's always-empty `boons: []` lands here intact), and
 * "boonOffers" = [bossKey…] — first kills whose pick is still pending, so a
 * crash or an Esc never loses a boon.
 *
 * MODULE SHAPE: constructor(ctx) (after `Modifiers`, which it reads as
 * `ctx.mods`), update(dt), setRealm(token). Self-registers as `ctx.boons`.
 */

import { STORY } from "../quests/storyText.js";
import { ROSTER } from "../combat/roster.js";
import { BOON_FX, registerSection } from "./modifiers.js";

/** The six pair keys in play order. */
export const PAIR_KEYS = Object.freeze([
    "cold.mini", "cold.realm", "sand.mini", "sand.realm", "ash.mini", "ash.realm",
]);

/**
 * Pair key → [boonIdA, boonIdB]. Lane N's table when present (it is the
 * story source of truth), with the spec's order as the fallback.
 */
const PAIRS = (STORY && STORY.boonPairs) || {
    "cold.mini": ["boon.rimeEdge", "boon.deepChill"],
    "cold.realm": ["boon.glacialGuard", "boon.frostNova"],
    "sand.mini": ["boon.quickenedSpikes", "boon.tidalForce"],
    "sand.realm": ["boon.sandstep", "boon.sunder"],
    "ash.mini": ["boon.cinderbrand", "boon.greatVortex"],
    "ash.realm": ["boon.heartOfTheDrift", "boon.undyingWake"],
};

/**
 * The six Wardens the game REALLY spawns, by pair key — derived from the live
 * roster (combat/roster.js `bossKind` rows) with exactly the loop
 * bossEncounters.js uses to build BOSS_BY_REALM (first row per realm+kind
 * wins) and its `bossTitle` cut (the name up to the parenthetical). So the
 * label can never name a boss the arena does not field (orchestrator
 * decision: the spec's "Moraine Elder" is not live; Cold's mini is The
 * Icewall, Cold's realm boss is Shrinebreaker).
 * @type {Readonly<Record<string, string>>}
 */
export const BOSS_NAMES = (() => {
    const out = {};
    for (const slug in ROSTER) {
        const r = ROSTER[slug];
        if (!r.bossKind || r.bossKind === "none") continue;
        const key = r.realm + "." + (r.bossKind === "realm_boss" ? "realm" : "mini");
        if (out[key]) continue;
        const n = r.bossName || r.name || "";
        const cut = n.indexOf(" (");
        out[key] = (cut > 0 ? n.slice(0, cut) : n).trim();
    }
    return Object.freeze(out);
})();

const REALM_WORD = { cold: "Cold", sand: "Sand", ash: "Ash" };

/** A pair's label for lists: "Cold · The Icewall". */
export const PAIR_LABEL = Object.freeze(Object.fromEntries(PAIR_KEYS.map((k) => {
    const realm = k.split(".")[0];
    return [k, REALM_WORD[realm] + " · " + (BOSS_NAMES[k] || "Warden")];
})));

/**
 * A boon's display row. STORY first; the effect table's id is the fallback
 * name so a missing story row can never render blank.
 * @param {string} id @returns {{id:string, name:string, effect:string, flavor:string}}
 */
export function boonInfo(id) {
    const s = STORY && STORY.boons ? STORY.boons[id] : null;
    return {
        id,
        name: s ? s.name : id.replace(/^boon\./, ""),
        effect: s ? s.effect : "",
        flavor: s ? s.flavor : "",
    };
}

export class Boons {
    /** @param {any} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.bus = ctx.bus || null;
        this.mods = ctx.mods || null;
        this.progression = ctx.progression || null;

        /** Pair key → chosen pick (0|1). @type {Record<string, number>} */
        this.picks = {};
        /** Offered, not yet chosen (in offer order). @type {string[]} */
        this.pending = [];

        ctx.boons = this;

        if (this.bus) {
            this._offBoss = this.bus.on("boss:killed", (p) => {
                if (!p || !p.first) return;
                this.offer(p.realm + "." + p.kind, p.name || null);
            });
        }

        this._offSave = registerSection(this.progression, "boons", {
            serialize: () => {
                const out = [];
                for (let i = 0; i < PAIR_KEYS.length; i++) {
                    const k = PAIR_KEYS[i];
                    if (this.picks[k] === 0 || this.picks[k] === 1) {
                        out.push({ bossKey: k, pick: this.picks[k] });
                    }
                }
                return out;
            },
            deserialize: (v) => {
                this.picks = {};
                if (Array.isArray(v)) {
                    for (let i = 0; i < v.length; i++) {
                        const e = v[i];
                        if (e && typeof e === "object" && PAIRS[e.bossKey] &&
                            (e.pick === 0 || e.pick === 1)) {
                            this.picks[e.bossKey] = e.pick;
                        } else if (typeof e === "string" && BOON_FX[e]) {
                            // A bare boon id (the v1-v3 field's documented
                            // type) — find its pair.
                            for (const k in PAIRS) {
                                const at = PAIRS[k].indexOf(e);
                                if (at >= 0) this.picks[k] = at;
                            }
                        }
                    }
                }
                this._apply();
            },
        });
        this._offSave2 = registerSection(this.progression, "boonOffers", {
            serialize: () => this.pending.slice(),
            deserialize: (v) => {
                this.pending = [];
                if (Array.isArray(v)) {
                    for (let i = 0; i < v.length; i++) {
                        const k = v[i];
                        if (typeof k === "string" && PAIRS[k] &&
                            this.picks[k] === undefined && this.pending.indexOf(k) < 0) {
                            this.pending.push(k);
                        }
                    }
                }
            },
        });
        this._apply();
    }

    // ------------------------------------------------------------- queries

    /** @param {string} key @returns {ReturnType<typeof boonInfo>[]|null} */
    pair(key) {
        const p = PAIRS[key];
        return p ? [boonInfo(p[0]), boonInfo(p[1])] : null;
    }

    /** The boon ids in force, in pair order. @returns {string[]} */
    activeIds() {
        const out = [];
        for (let i = 0; i < PAIR_KEYS.length; i++) {
            const k = PAIR_KEYS[i];
            const p = this.picks[k];
            if (p === 0 || p === 1) out.push(PAIRS[k][p]);
        }
        return out;
    }

    /** @param {string} key @returns {"chosen"|"pending"|"locked"} */
    stateOf(key) {
        if (this.picks[key] === 0 || this.picks[key] === 1) return "chosen";
        return this.pending.indexOf(key) >= 0 ? "pending" : "locked";
    }

    // ------------------------------------------------------------- actions

    /**
     * Offer a pair (a first boss kill). No-op if already chosen or pending.
     * @param {string} key @param {string|null} [bossName] @returns {boolean}
     */
    offer(key, bossName) {
        if (!PAIRS[key]) return false;
        if (this.picks[key] !== undefined || this.pending.indexOf(key) >= 0) return false;
        this.pending.push(key);
        this._save();
        if (this.bus) {
            this.bus.emit("boon:offer", {
                bossKey: key, pair: this.pair(key),
                boss: bossName || BOSS_NAMES[key] || PAIR_LABEL[key] || key,
            });
        }
        return true;
    }

    /**
     * Take the pick for a pending (or, at a shrine, chosen) pair.
     * @param {string} key @param {number} pick 0|1 @returns {boolean}
     */
    choose(key, pick) {
        if (!PAIRS[key] || (pick !== 0 && pick !== 1)) return false;
        const at = this.pending.indexOf(key);
        if (at < 0) return false;
        this.pending.splice(at, 1);
        this.picks[key] = pick;
        this._apply();
        this._save();
        if (this.bus) {
            this.bus.emit("boon:chosen", { bossKey: key, boon: boonInfo(PAIRS[key][pick]) });
        }
        return true;
    }

    /**
     * Swap within a pair. Free at a shrine; one reroll token elsewhere.
     * @param {string} key @param {number} pick
     * @param {{atShrine?: boolean}} [opt]
     * @returns {{ok: boolean, reason?: string}}
     */
    respec(key, pick, opt) {
        if (!PAIRS[key] || (pick !== 0 && pick !== 1)) return { ok: false, reason: "bad pick" };
        if (this.picks[key] === undefined) return { ok: false, reason: "not earned" };
        if (this.picks[key] === pick) return { ok: true };
        const atShrine = !!(opt && opt.atShrine);
        if (!atShrine) {
            const shop = this.ctx.shop;
            if (!shop || !shop.useReroll()) return { ok: false, reason: "no reroll token" };
        }
        this.picks[key] = pick;
        this._apply();
        this._save();
        if (this.bus) {
            this.bus.emit("boon:chosen", {
                bossKey: key, boon: boonInfo(PAIRS[key][pick]), respec: true,
            });
        }
        return { ok: true };
    }

    /** Frame hook (module shape) — the boon layer has no per-frame work. */
    update(dt) { /* event-driven */ }

    /** @param {string} token */
    setRealm(token) { /* boons follow the player everywhere */ }

    /** Unsubscribe from the bus and the save (tests / teardown). */
    dispose() {
        if (this._offBoss) this._offBoss();
        if (this._offSave) this._offSave();
        if (this._offSave2) this._offSave2();
        this._offBoss = this._offSave = this._offSave2 = null;
    }

    // ------------------------------------------------------------- internals

    _apply() {
        const ids = this.activeIds();
        if (this.mods) this.mods.setBoons(ids);
        // The v1-v3 field's documented meaning ("shrine boon picks"), kept
        // live for any reader of the core object; v4 persists the section.
        if (this.progression) this.progression.boons = ids;
    }

    _save() {
        const P = this.progression;
        if (P && typeof P.save === "function") P.save();
    }
}
