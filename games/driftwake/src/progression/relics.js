/**
 * Relics — twelve curated keepsakes, never random (_spec/QUEST_DESIGN.md §4.2).
 *
 * SOURCES, exactly four per realm, fixed by index so a realm's relics can
 * never repeat or go missing (`relicFor(realm, source, index)` is the one
 * mapping — world lanes should ask it rather than invent ids):
 *
 *     relic cache #0  → the realm's relic 0      (QUEST §3.1: 2 RELIC caches)
 *     relic cache #1  → the realm's relic 1
 *     trial gold      → the realm's relic 2      (§3.2: third trial's gold)
 *     third bounty    → the realm's relic 3      (§3.3)
 *
 * The realm's order is lane N's STORY.relics order (Cold: Rime Heart,
 * Frostglass Lens, Keel of the First, Warm Hands — §4.2's own order).
 *
 * GRANTS arrive as 'reward' {kind: 'relic', id?, realm?, source?, index?}
 * from the world lanes (caches, trials, bounties). A known `id` is granted
 * as-is; otherwise `source`/`index` resolve through `relicFor`; otherwise the
 * realm's first unowned relic. `payload.granted === true` marks a
 * notification this lane already applied and is ignored. When the payload
 * lacked id/name/desc they are filled in on the same object, so a toast
 * listener subscribed after this module can name the relic.
 *
 * SLOTS (§4.2): two from the start; the third unlocks after the SAND realm
 * boss ('boss:killed' {realm:'sand', kind:'realm'} — also inferred from
 * `realmsUnlocked` containing 'ash', which only that kill writes) or when
 * bought (shop "shop.slot3", 400 Wake Glass).
 *
 * EQUIP: at an activated shrine (ui/shrineMenu.js). A newly found relic is
 * ALSO dropped into an EMPTY unlocked slot on the spot — never displacing a
 * choice — because a find that does nothing until a ride back to a shrine
 * reads as a label (lane report: spec reading).
 *
 * Effects live in modifiers.js RELIC_FX; this module hands the equipped ids
 * over with `mods.setRelics(ids)`.
 *
 * SAVE: section "relics" = {owned: [id], equipped: [id|null ×3], slot3: bool}
 * (QUEST §8 verbatim). MODULE SHAPE: constructor(ctx), update(dt),
 * setRealm(token); self-registers as `ctx.relics`.
 */

import { STORY } from "../quests/storyText.js";
import { RELIC_FX, registerSection } from "./modifiers.js";

/** Realm → its four relic ids, in source order. */
export const RELICS_BY_REALM = (() => {
    const out = { cold: [], sand: [], ash: [] };
    const src = STORY && STORY.relics ? STORY.relics : null;
    if (src) {
        for (const id in src) {
            const r = src[id];
            if (out[r.realm] && RELIC_FX[id]) out[r.realm].push(id);
        }
    }
    const fallback = {
        cold: ["relic.rimeHeart", "relic.frostglassLens", "relic.keelOfTheFirst", "relic.warmHands"],
        sand: ["relic.brassBuckle", "relic.sandGlass", "relic.duneRunner", "relic.scorpionsPatience"],
        ash: ["relic.emberCoil", "relic.plateShard", "relic.furnaceCore", "relic.wakemender"],
    };
    for (const k in out) if (out[k].length !== 4) out[k] = fallback[k];
    return out;
})();

/** Every relic id, cold → ash. */
export const RELIC_IDS = Object.freeze(
    RELICS_BY_REALM.cold.concat(RELICS_BY_REALM.sand, RELICS_BY_REALM.ash));

/** Source → index into the realm's four. */
const SOURCE_INDEX = { cache: 0, trial: 2, bounty: 3 };

/**
 * @param {string} id
 * @returns {{id:string, name:string, effect:string, flavor:string, realm:string}}
 */
export function relicInfo(id) {
    const s = STORY && STORY.relics ? STORY.relics[id] : null;
    let realm = "cold";
    for (const k in RELICS_BY_REALM) if (RELICS_BY_REALM[k].indexOf(id) >= 0) realm = k;
    return {
        id,
        name: s ? s.name : id.replace(/^relic\./, ""),
        effect: s ? s.effect : "",
        flavor: s ? s.flavor : "",
        realm,
    };
}

export const SLOT_MAX = 3;

export class Relics {
    /** @param {any} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.bus = ctx.bus || null;
        this.mods = ctx.mods || null;
        this.progression = ctx.progression || null;

        /** @type {string[]} */
        this.owned = [];
        /** @type {(string|null)[]} */
        this.equipped = [null, null, null];
        /** Slot 3 earned or bought (the Sand-boss inference is live, below). */
        this.slot3 = false;

        ctx.relics = this;

        if (this.bus) {
            this._offReward = this.bus.on("reward", (p) => {
                if (!p || p.granted || p.kind !== "relic") return;
                const id = this.grant(p.id, p);
                if (id) {
                    const info = relicInfo(id);
                    try {
                        // Fill the emitter's payload for later listeners
                        // (toasts). Never STORY's frozen rows — the payload.
                        if (p.id !== id) p.id = id;
                        if (!p.name) p.name = info.name;
                        if (!p.desc) p.desc = info.effect;
                    } catch (e) { /* a frozen payload keeps its fields */ }
                }
            });
            this._offBoss = this.bus.on("boss:killed", (p) => {
                if (p && p.realm === "sand" && p.kind === "realm") this.unlockSlot3("sand-boss");
            });
        }

        this._offSave = registerSection(this.progression, "relics", {
            serialize: () => ({
                owned: this.owned.slice(),
                equipped: this.equipped.slice(),
                slot3: this.slot3,
            }),
            deserialize: (v) => {
                const ok = v && typeof v === "object";
                this.owned = [];
                this.equipped = [null, null, null];
                this.slot3 = !!(ok && v.slot3);
                if (ok && Array.isArray(v.owned)) {
                    for (let i = 0; i < v.owned.length; i++) {
                        const id = v.owned[i];
                        if (RELIC_FX[id] && this.owned.indexOf(id) < 0) this.owned.push(id);
                    }
                }
                if (ok && Array.isArray(v.equipped)) {
                    for (let s = 0; s < SLOT_MAX && s < v.equipped.length; s++) {
                        const id = v.equipped[s];
                        if (id && this.owned.indexOf(id) >= 0 &&
                            this.equipped.indexOf(id) < 0) this.equipped[s] = id;
                    }
                }
                if (!this.slot3Unlocked) this.equipped[2] = null;
                this._apply();
            },
        });
        this._apply();
    }

    // ------------------------------------------------------------- queries

    /** Is the third slot open (bought, earned, or Ash already unlocked)? */
    get slot3Unlocked() {
        if (this.slot3) return true;
        const P = this.progression;
        return !!(P && Array.isArray(P.realmsUnlocked) && P.realmsUnlocked.indexOf("ash") >= 0);
    }

    /** @returns {number} 2 or 3 */
    get slotCount() {
        return this.slot3Unlocked ? 3 : 2;
    }

    /**
     * The one source → relic mapping (see the header).
     * @param {string} realm @param {"cache"|"trial"|"bounty"} source
     * @param {number} [index] cache 0|1 @returns {string|null}
     */
    relicFor(realm, source, index) {
        const list = RELICS_BY_REALM[realm];
        if (!list) return null;
        let i = SOURCE_INDEX[source];
        if (i === undefined) return null;
        if (source === "cache") i = (index | 0) === 1 ? 1 : 0;
        return list[i];
    }

    /** @param {string} id @returns {boolean} */
    has(id) { return this.owned.indexOf(id) >= 0; }

    // ------------------------------------------------------------- actions

    /**
     * Grant a relic. Resolution order: a known id; `source`/`index` through
     * `relicFor`; the realm's first unowned. Returns the id granted, or null
     * when there is nothing left to give (already owned).
     * @param {string|null|undefined} id
     * @param {{realm?:string, source?:string, index?:number}} [hint]
     * @returns {string|null}
     */
    grant(id, hint) {
        let rid = id && RELIC_FX[id] ? id : null;
        const realm = (hint && typeof hint.realm === "string" && RELICS_BY_REALM[hint.realm])
            ? hint.realm : this._realm();
        if (!rid && hint && hint.source) rid = this.relicFor(realm, hint.source, hint.index);
        if (!rid) {
            const list = RELICS_BY_REALM[realm] || RELIC_IDS;
            for (let i = 0; i < list.length; i++) {
                if (!this.has(list[i])) { rid = list[i]; break; }
            }
        }
        if (!rid || this.has(rid)) return null;
        this.owned.push(rid);
        // Straight into an EMPTY unlocked slot — never displacing a choice.
        for (let s = 0; s < this.slotCount; s++) {
            if (!this.equipped[s]) { this.equipped[s] = rid; break; }
        }
        this._apply();
        this._save();
        const at = this.equipped.indexOf(rid);
        if (at >= 0 && this.bus) this.bus.emit("relic:equipped", { id: rid, slot: at });
        return rid;
    }

    /**
     * Equip an owned relic into a slot (a relic already worn elsewhere moves;
     * whatever the target slot held goes back to the bag, or swaps into the
     * vacated slot when the relic was moving).
     * @param {string} id @param {number} slot @returns {boolean}
     */
    equip(id, slot) {
        if (!this.has(id) || !(slot >= 0 && slot < this.slotCount)) return false;
        const from = this.equipped.indexOf(id);
        if (from === slot) return true;
        const displaced = this.equipped[slot];
        this.equipped[slot] = id;
        if (from >= 0) this.equipped[from] = displaced;
        this._apply();
        this._save();
        if (this.bus) this.bus.emit("relic:equipped", { id, slot });
        return true;
    }

    /** @param {number} slot @returns {boolean} */
    unequip(slot) {
        if (!(slot >= 0 && slot < SLOT_MAX) || !this.equipped[slot]) return false;
        this.equipped[slot] = null;
        this._apply();
        this._save();
        if (this.bus) this.bus.emit("relic:equipped", { id: null, slot });
        return true;
    }

    /** @param {string} why @returns {boolean} true if newly unlocked */
    unlockSlot3(why) {
        if (this.slot3) return false;
        this.slot3 = true;
        this._save();
        return true;
    }

    update(dt) { /* event-driven */ }

    /** @param {string} token */
    setRealm(token) { /* relics follow the player everywhere */ }

    /** Unsubscribe from the bus and the save (tests / teardown). */
    dispose() {
        if (this._offReward) this._offReward();
        if (this._offBoss) this._offBoss();
        if (this._offSave) this._offSave();
        this._offReward = this._offBoss = this._offSave = null;
    }

    // ------------------------------------------------------------- internals

    _realm() {
        const g = this.ctx.getRealm;
        const t = typeof g === "function" ? g() : null;
        return RELICS_BY_REALM[t] ? t : "cold";
    }

    _apply() {
        // A slot that closed (a NEW RUN) cannot keep its relic in force.
        const worn = this.slotCount;
        for (let s = worn; s < SLOT_MAX; s++) {
            if (s >= 2 && !this.slot3Unlocked) this.equipped[s] = null;
        }
        if (this.mods) this.mods.setRelics(this.equipped);
    }

    _save() {
        const P = this.progression;
        if (P && typeof P.save === "function") P.save();
    }
}
