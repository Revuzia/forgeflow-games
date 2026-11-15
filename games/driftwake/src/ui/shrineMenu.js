/**
 * The SHRINE MENU — shrines become the hub (_spec/QUEST_DESIGN.md §5, the
 * Ghost of Tsushima / Souls-bonfire beat). Opened with E at an ACTIVATED
 * shrine; pauses (the second and last modal, §7):
 *
 *   Rest       full heal + mana; this shrine becomes the respawn point
 *              (progression.lastShrineId, saved).
 *   Travel     fast travel to any activated shrine in any UNLOCKED realm.
 *              Same realm: a teleport to that shrine's STAND point (never the
 *              anchor — the monolith stands there). Another realm: the one
 *              `ctx.enterRealm(token)`, then — once `world/shrine.js` has
 *              re-grounded the network on the new landform, which is when the
 *              stand points are re-chosen for that realm — the same placement.
 *   Boons      every pair: choose a pending pick, or swap within a chosen
 *              pair for free (QUEST §4.1). Pending Driftmarks too.
 *   Relics     equip / swap / remove into the 2 (3) slots (§4.2).
 *   Shop       Vitality / Wellspring I-V, Boon Reroll, Relic Slot 3 and the
 *              six Wake Trails (§4.3), paid in Wake Glass.
 *   Chronicle  closes the menu and emits 'ui:open' {panel:'journal',
 *              tab:'lore'} — the journal is lane U's panel.
 *
 * WHICH SHRINES ARE ACTIVATED is progression's fact (lane Q v4:
 * `isShrineLit(realm, id)` / `litShrines(realm)`, persisted as
 * `shrinesLit`). This module never keeps a second copy.
 *
 * THE E HOOK (for lane U / the integrator): `open(id)` refuses anything but
 * an activated shrine in the current realm. `reach` is kept current by
 * `update(dt)` — the id of the activated shrine within SHRINE_REACH of the
 * player, or null — so the interact key is one line:
 *     if (interactPressed && shrineMenu.reach) shrineMenu.open(shrineMenu.reach);
 * or, over the bus, emit 'ui:open' {panel:'shrine'} (optionally with `id`).
 *
 * CONTROLS: mouse, or keys — ↑↓ (W S) move, 1-6 jump to a page, Enter /
 * Space / E select, → (D) into a page, ← (A) / Backspace back, Esc closes.
 * Keys are taken in the capture phase and stopped while open (the shared
 * pause pattern in ui/boonPick.js), so no spell fires behind the menu.
 *
 * Also exported: `GlassCounter`, the HUD's Wake Glass readout "beside mana"
 * (QUEST §4.3) — a pill under hud.js's mana bar, same show rule as the HUD.
 *
 * MODULE SHAPE: constructor(ctx) after Boons/Relics/Shop, update(dt),
 * setRealm(token). Self-registers as `ctx.shrineMenu`.
 */

import { STORY } from "../quests/storyText.js";
import { PAIR_KEYS, PAIR_LABEL } from "../progression/boons.js";
import { relicInfo, RELICS_BY_REALM, SLOT_MAX } from "../progression/relics.js";
import { TRAILS, RANK_PRICES, shopInfo } from "../progression/shop.js";
import {
    ensureRewardsCss, modalOpen, modalClose, esc, accentOf,
} from "./boonPick.js";

/** Interact reach around an activated shrine's anchor, m. The respawn stand
 *  point is 4.5 m out and progression's touch radius 6 m; 7 m lets a player
 *  standing anywhere at the formation open it. */
export const SHRINE_REACH = 7;

const REALM_ORDER = ["cold", "sand", "ash"];
const ROMAN = ["I", "II", "III", "IV", "V"];

const NAV = [
    { k: "rest", fb: "Rest" }, { k: "travel", fb: "Travel" },
    { k: "boons", fb: "Boons" }, { k: "relics", fb: "Relics" },
    { k: "shop", fb: "Shop" }, { k: "chronicle", fb: "Chronicle" },
];

const MENU_CSS = `
#dw-shrine .dwr-panel { width: 820px; padding: 20px 22px 14px; }
#dw-shrine .dwr-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
#dw-shrine .dwr-title { margin: 6px 0 14px; }
#dw-shrine .dwr-purse {
  flex: none; margin-bottom: 14px; padding: 6px 12px; border-radius: 14px;
  font: 600 13px/1 "Segoe UI", system-ui, sans-serif;
  border: 1px solid rgba(160, 205, 235, 0.28);
  background: linear-gradient(180deg, rgba(20, 32, 44, 0.6), rgba(10, 16, 24, 0.7));
}
#dw-shrine .dwr-purse svg, .dw-glass svg {
  width: 12px; height: 14px; vertical-align: -2px; margin-right: 6px;
  fill: none; stroke: var(--dwr-accent, #a8dcf5); stroke-width: 1.6;
}
#dw-shrine .dwr-body { display: flex; gap: 16px; min-height: 360px; }
#dw-shrine .dwr-nav { width: 168px; flex: none; display: flex; flex-direction: column; gap: 6px; }
#dw-shrine .dwr-navb {
  position: relative; text-align: left; cursor: pointer; color: inherit;
  padding: 10px 12px 10px 34px; border-radius: 8px;
  font: 600 14px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.02em;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.5), rgba(8, 13, 19, 0.6));
  border: 1px solid rgba(160, 205, 235, 0.18);
  transition: border-color 140ms ease, background 140ms ease;
}
#dw-shrine .dwr-navb span {
  position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
  font: 700 10px/1 "Segoe UI", system-ui, sans-serif; color: rgba(205, 228, 244, 0.6);
}
#dw-shrine .dwr-navb.cur { border-color: var(--dwr-accent); color: var(--dwr-accent);
  background: linear-gradient(180deg, rgba(24, 38, 52, 0.7), rgba(12, 20, 30, 0.8)); }
#dw-shrine .dwr-navb.cur.zone { box-shadow: 0 0 12px rgba(160, 225, 255, 0.22); }
#dw-shrine .dwr-pane {
  flex: 1; min-width: 0; max-height: 440px; overflow-y: auto;
  padding: 4px 6px 4px 2px;
}
/* Short windows (a 960x540 probe window cropped the title): the pane, not
   the panel, gives up height — ~170 px is the panel's head + foot + padding. */
@media (max-height: 640px) {
  #dw-shrine .dwr-body { min-height: 0; }
  #dw-shrine .dwr-pane { max-height: calc(100vh - 170px); }
}
#dw-shrine .dwr-sec {
  margin: 12px 0 7px; font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.16em; text-transform: uppercase; color: rgba(205, 228, 244, 0.62);
}
#dw-shrine .dwr-sec:first-child { margin-top: 2px; }
#dw-shrine .dwr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#dw-shrine .dwr-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
#dw-shrine .dwr-status {
  min-height: 16px; margin-top: 12px;
  font: 600 12px/1.3 "Segoe UI", system-ui, sans-serif; color: var(--dwr-accent);
}
.dwr-btn {
  cursor: pointer; color: inherit; padding: 9px 16px; border-radius: 8px;
  font: 600 13px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.03em;
  background: linear-gradient(180deg, rgba(28, 46, 62, 0.8), rgba(14, 24, 34, 0.86));
  border: 1px solid var(--dwr-accent, rgba(160, 205, 235, 0.5));
}
.dwr-btn.dim { opacity: 0.4; cursor: default; }
#dw-shrine .dwr-shoprow {
  display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin-bottom: 6px;
  border-radius: 8px; border: 1px solid rgba(160, 205, 235, 0.14);
  background: rgba(10, 16, 24, 0.45);
}
#dw-shrine .dwr-shoprow .dwr-sname { flex: 1; min-width: 0; }
#dw-shrine .dwr-shoprow .dwr-sname b { display: block; font: 600 13.5px/1.25 "Segoe UI", system-ui, sans-serif; }
#dw-shrine .dwr-shoprow .dwr-sname i { display: block; font: 500 11.5px/1.35 "Segoe UI", system-ui, sans-serif;
  font-style: normal; color: rgba(205, 228, 244, 0.7); }
#dw-shrine .dwr-pips { flex: none; letter-spacing: 3px; color: rgba(205, 228, 244, 0.35); font-size: 12px; }
#dw-shrine .dwr-pips b { color: var(--dwr-accent); font-weight: 700; }
#dw-shrine .dwr-slot {
  min-height: 62px; box-sizing: border-box; padding: 9px 11px; border-radius: 8px;
  border: 1px dashed rgba(160, 205, 235, 0.3); cursor: pointer; color: inherit; text-align: left; font: inherit;
  background: rgba(10, 16, 24, 0.45);
}
#dw-shrine .dwr-slot.full { border-style: solid; }
#dw-shrine .dwr-slot.pick { border-color: var(--dwr-accent); box-shadow: inset 0 0 12px rgba(160, 225, 255, 0.14); }
#dw-shrine .dwr-slot.lock { opacity: 0.45; cursor: default; }
#dw-shrine .dwr-slot b { display: block; font: 600 13px/1.25 "Segoe UI", system-ui, sans-serif; }
#dw-shrine .dwr-slot i { display: block; font: 500 11px/1.35 "Segoe UI", system-ui, sans-serif;
  font-style: normal; color: rgba(205, 228, 244, 0.7); margin-top: 2px; }
.dw-glass {
  position: fixed; left: 18px; top: 70px; z-index: 55; pointer-events: none;
  padding: 4px 11px 4px 9px; border-radius: 11px;
  font: 600 11px/1.1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.03em;
  color: rgba(240, 248, 253, 0.94); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
  opacity: 0; transition: opacity 200ms ease;
}
.dw-glass.show { opacity: 0.95; }
@keyframes dw-glass-bump { 0% { transform: scale(1.12); } 100% { transform: scale(1); } }
.dw-glass.bump { animation: dw-glass-bump 260ms ease-out; }
`;

/** A hexagonal crystal glyph — the spellbar's bolt shape, the Wake Glass mark. */
const GLASS_SVG = '<svg viewBox="0 0 12 14" aria-hidden="true">' +
    '<path d="M6 1l4.4 2.6v6.8L6 13 1.6 10.4V3.6z"/><path d="M1.6 3.6L6 6.2l4.4-2.6M6 6.2V13"/></svg>';

let _menuCss = false;
function ensureMenuCss() {
    ensureRewardsCss();
    if (_menuCss) return;
    _menuCss = true;
    const s = document.createElement("style");
    s.textContent = MENU_CSS;
    document.head.appendChild(s);
}

/** "The Rime Shelf" etc. — realms.js `label`, else the chronicle's. */
function realmLabel(ctx, t) {
    const R = ctx.realms && ctx.realms.realm ? ctx.realms.realm(t) : null;
    if (R && R.label) return R.label;
    const c = STORY && STORY.chronicle ? STORY.chronicle[t] : null;
    return c ? c.title.replace(/^Chronicle of /, "") : t;
}

/** Shrine display name (lane N's per-realm names). */
export function shrineName(realm, id) {
    const r = STORY && STORY.shrines ? STORY.shrines[realm] : null;
    const s = r ? r[id] : null;
    return s ? s.name : id;
}

export class ShrineMenu {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureMenuCss();
        this.ctx = ctx;
        this.S = ctx.S;
        this.bus = ctx.bus || null;
        this.progression = ctx.progression || null;

        const el = document.createElement("div");
        el.id = "dw-shrine";
        el.className = "dwr-modal";
        el.innerHTML =
            '<div class="dwr-scrim"></div><div class="dwr-panel">' +
            '<div class="dwr-head"><div><div class="dwr-kicker"></div><div class="dwr-title"></div></div>' +
            '<div class="dwr-purse"></div></div>' +
            '<div class="dwr-body"><div class="dwr-nav"></div><div class="dwr-pane"></div></div>' +
            '<div class="dwr-foot">↑ ↓ move · 1-6 page · Enter select · Backspace back · Esc leave the shrine</div>' +
            "</div>";
        document.body.appendChild(el);
        this.el = el;
        this._kicker = el.querySelector(".dwr-kicker");
        this._title = el.querySelector(".dwr-title");
        this._purse = el.querySelector(".dwr-purse");
        this._nav = el.querySelector(".dwr-nav");
        this._pane = el.querySelector(".dwr-pane");
        const labels = STORY && STORY.ui && STORY.ui.shrineMenu ? STORY.ui.shrineMenu : {};
        this._nav.innerHTML = NAV.map((n, i) =>
            '<button class="dwr-navb" data-tab="' + i + '"><span>' + (i + 1) + "</span>" +
            esc(labels[n.k] || n.fb) + "</button>").join("");
        this._navBtns = this._nav.querySelectorAll(".dwr-navb");

        this.isOpen = false;
        /** @type {string|null} the shrine the menu is open at */
        this.shrineId = null;
        /** Current realm while open. */
        this.realm = "cold";
        this.tab = 0;
        /** "nav" | "pane" — which column the keys drive. */
        this.zone = "nav";
        this.focus = 0;
        /** Relic slot the next relic click fills. */
        this.slotSel = 0;
        this._status = "";
        this._travelling = false;
        /** Activated shrine id within reach (current realm), or null. */
        this.reach = null;
        /** @type {HTMLElement[]} */
        this._items = [];

        this._onKey = (e) => this._key(e);
        el.addEventListener("click", (e) => this._click(e));

        ctx.shrineMenu = this;

        if (this.bus) {
            this.bus.on("ui:open", (p) => {
                if (!p || p.panel !== "shrine" || this.isOpen) return;
                const id = p.id || this.reach || this.shrineInReach();
                if (id) this.open(id);
            });
            this.bus.on("glass:changed", () => { if (this.isOpen) this._renderPurse(); });
        }
    }

    // =================================================================
    // Queries
    // =================================================================

    /** @returns {string} */
    currentRealm() {
        const g = this.ctx.getRealm;
        const t = typeof g === "function" ? g() : null;
        if (REALM_ORDER.indexOf(t) >= 0) return t;
        const P = this.progression;
        return P && P.realm ? P.realm : "cold";
    }

    /** @param {string} realm @param {string} id @returns {boolean} */
    isLit(realm, id) {
        const P = this.progression;
        if (P && typeof P.isShrineLit === "function") return P.isShrineLit(realm, id);
        return realm === "cold" && id === "cold_spawn";   // pre-v4 progression
    }

    /** @param {string} realm @returns {string[]} */
    litList(realm) {
        const P = this.progression;
        if (P && typeof P.litShrines === "function") return P.litShrines(realm);
        return realm === "cold" ? ["cold_spawn"] : [];
    }

    /** Is a realm open for travel (unlocked, or TEST mode)? @param {string} realm */
    realmOpen(realm) {
        const P = this.progression;
        if (!P) return realm === "cold";
        if (P.testMode) return true;
        return Array.isArray(P.realmsUnlocked) && P.realmsUnlocked.indexOf(realm) >= 0;
    }

    /** @param {string} id @returns {number} index in `shrine.positions` */
    _indexOf(id) {
        const pos = this.ctx.shrine ? this.ctx.shrine.positions : null;
        if (!pos) return -1;
        for (let i = 0; i < pos.length; i++) if (pos[i].id === id) return i;
        return -1;
    }

    /**
     * The activated shrine within SHRINE_REACH of the player, current realm.
     * Allocation-free. @returns {string|null}
     */
    shrineInReach() {
        const pos = this.ctx.shrine ? this.ctx.shrine.positions : null;
        const c = this.ctx.character;
        if (!pos || !c) return null;
        const realm = this.currentRealm();
        const px = c.position.x, pz = c.position.z;
        let best = null, bd = SHRINE_REACH * SHRINE_REACH;
        for (let i = 0; i < pos.length; i++) {
            const dx = pos[i].x - px, dz = pos[i].z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 < bd && this.isLit(realm, pos[i].id)) { bd = d2; best = pos[i].id; }
        }
        return best;
    }

    // =================================================================
    // Open / close
    // =================================================================

    /**
     * Open the menu at an ACTIVATED shrine of the current realm.
     * @param {string} shrineId @returns {boolean}
     */
    open(shrineId) {
        if (this.isOpen || this._travelling || !shrineId) return false;
        const P = this.progression;
        if (P && P.dead) return false;
        const realm = this.currentRealm();
        if (!this.isLit(realm, shrineId) || this._indexOf(shrineId) < 0) return false;
        this.isOpen = true;
        this.shrineId = shrineId;
        this.realm = realm;
        this.tab = 0;
        this.zone = "nav";
        this.focus = 0;
        this._status = "";
        this.el.style.setProperty("--dwr-accent", accentOf(this.ctx, realm));
        this._kicker.textContent = realmLabel(this.ctx, realm) + " · Shrine";
        this._title.textContent = shrineName(realm, shrineId);
        this._renderPurse();
        this._render();
        this.el.classList.add("open");
        window.addEventListener("keydown", this._onKey, true);
        modalOpen(this.S);
        if (this.bus) this.bus.emit("ui:open", { panel: "shrine", id: shrineId });
        return true;
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.el.classList.remove("open");
        window.removeEventListener("keydown", this._onKey, true);
        modalClose(this.S);
        if (this.bus) this.bus.emit("ui:close", { panel: "shrine" });
    }

    // =================================================================
    // Actions (also the probe / API surface)
    // =================================================================

    /** Rest: full pools, respawn here. @returns {boolean} */
    rest() {
        const c = this.ctx.character;
        const P = this.progression;
        if (!this.isOpen || !c) return false;
        c.health = c.healthMax;
        c.mana = c.manaMax;
        if (P) {
            P.lastShrineId = this.shrineId;
            if (P.save) P.save();
        }
        this._status = "Rested. Wounds closed, mana full — you will return here if you fall.";
        return true;
    }

    /**
     * Fast travel to an activated shrine. Holds the pause through a realm
     * change, then places the player on the shrine's stand point facing the
     * monument and closes the menu.
     * @param {string} realm @param {string} id
     * @returns {Promise<{ok:boolean, reason?:string, realm?:string, id?:string}>}
     */
    async travel(realm, id) {
        if (this._travelling) return { ok: false, reason: "already travelling" };
        if (!this.realmOpen(realm)) return { ok: false, reason: "that shard is not yet open" };
        if (!this.isLit(realm, id)) return { ok: false, reason: "that shrine is dormant" };
        const idx = this._indexOf(id);
        if (idx < 0) return { ok: false, reason: "unknown shrine" };
        const fromRealm = this.currentRealm();
        const fromId = this.shrineId;
        const heldHere = this.isOpen;
        // Hold the pause for the whole transfer even when called as an API.
        if (!heldHere) modalOpen(this.S);
        this._travelling = true;
        this._status = "Travelling to " + shrineName(realm, id) + "…";
        if (this.isOpen) this._render();
        let result = { ok: true, realm, id };
        try {
            if (realm !== fromRealm) {
                if (typeof this.ctx.enterRealm !== "function") throw new Error("no enterRealm");
                await this.ctx.enterRealm(realm);
                await this._waitReground(realm);
            }
            this._place(idx, id);
            // One real frame so the camera snap and the ground seat land.
            await nextFrame();
        } catch (e) {
            console.error("[shrineMenu] travel failed:", e);
            result = { ok: false, reason: String(e && e.message ? e.message : e) };
        } finally {
            this._travelling = false;
        }
        if (heldHere) this.close(); else modalClose(this.S);
        if (result.ok && this.bus) {
            this.bus.emit("shrine:travelled", { realm, id, fromRealm, fromId });
        }
        return result;
    }

    /** Wait until world/shrine.js has re-grounded the network in `realm`
     *  (its stand points are re-chosen there). Bounded. @param {string} realm */
    async _waitReground(realm) {
        const sh = this.ctx.shrine;
        for (let f = 0; f < 240; f++) {
            if (!sh || (sh.realm === realm && !(sh._regroundIn > 0))) return;
            await nextFrame();
        }
    }

    /** @param {number} idx @param {string} id */
    _place(idx, id) {
        const ctx = this.ctx;
        const p = ctx.shrine.positions[idx];
        const c = ctx.character;
        const x = Number.isFinite(p.sx) ? p.sx : p.x + 4.5;
        const z = Number.isFinite(p.sz) ? p.sz : p.z;
        const y = ctx.terrain && ctx.terrain.heightAt ? ctx.terrain.heightAt(x, z) : c.position.y;
        c.position.set(x, y, z);
        c.velocity.set(0, 0, 0);
        c.vertVel = 0;
        c.airborne = false;
        c.airHeight = 0;
        // Face the monument. PORT FRAME: forward = (sin f, 0, -cos f).
        const f = Math.atan2(p.x - x, -(p.z - z));
        c.facing = f;
        const rig = ctx.rig;
        if (rig) {
            rig.yaw = f;
            // The rig's spring would swoop 350 m after a teleport; its own
            // first-frame path copies the pivot instead.
            rig._first = true;
            if (rig.pivotVel) rig.pivotVel.set(0, 0, 0);
        }
        const P = this.progression;
        if (P) {
            P.lastShrineId = id;
            if (P.save) P.save();
        }
    }

    /** @param {number} tab */
    _setTab(tab) {
        this.tab = Math.max(0, Math.min(NAV.length - 1, tab));
        this.focus = 0;
        this._status = "";
        this._render();
    }

    /** @param {string} act */
    _act(act) {
        const a = act.split(":");
        const ctx = this.ctx;
        switch (a[0]) {
            case "rest":
                this.rest();
                break;
            case "travel":
                this.travel(a[1], a[2]).then((r) => {
                    if (!r.ok && this.isOpen) { this._status = "Cannot travel: " + r.reason + "."; this._render(); }
                });
                return;
            case "choose": {
                const ok = ctx.boons && ctx.boons.choose(a[1], +a[2]);
                this._status = ok ? "Boon taken." : "";
                break;
            }
            case "swap": {
                const r = ctx.boons ? ctx.boons.respec(a[1], +a[2], { atShrine: true }) : { ok: false };
                this._status = r.ok ? "Boon changed. The shrine asks nothing for it." : "Cannot change that boon.";
                break;
            }
            case "mark": {
                const ok = ctx.mods && ctx.mods.pickDriftmark(a[1]);
                this._status = ok ? "Driftmark set." : "That mark is full.";
                break;
            }
            case "slot":
                this.slotSel = +a[1];
                break;
            case "unequip":
                if (ctx.relics) ctx.relics.unequip(+a[1]);
                break;
            case "relic": {
                const R = ctx.relics;
                if (!R) break;
                let s = this.slotSel;
                if (!(s >= 0 && s < R.slotCount)) s = 0;
                // A relic clicked while its own slot is selected comes off.
                if (R.equipped[s] === a[1]) { R.unequip(s); break; }
                if (R.equip(a[1], s)) {
                    this._status = relicInfo(a[1]).name + " — worn.";
                    // Next click fills the next empty slot, if any.
                    for (let k = 0; k < R.slotCount; k++) if (!R.equipped[k]) { this.slotSel = k; break; }
                }
                break;
            }
            case "buy": {
                const r = ctx.shop ? ctx.shop.buy(a[1]) : { ok: false, reason: "no shop" };
                this._status = r.ok ? shopInfo(a[1]).name + " — bought." : "Cannot buy: " + r.reason + ".";
                break;
            }
            case "equip":
                if (ctx.shop) ctx.shop.equipTrail(a[1] === "none" ? null : a[1]);
                break;
            case "chronicle":
                this.close();
                if (this.bus) this.bus.emit("ui:open", { panel: "journal", tab: "lore" });
                return;
            default:
                return;
        }
        if (this.isOpen) this._render();
    }

    // =================================================================
    // Rendering (event-scoped: open, a key, a click, a purchase)
    // =================================================================

    _renderPurse() {
        const shop = this.ctx.shop;
        const cur = STORY && STORY.ui ? STORY.ui.currency : "Wake Glass";
        this._purse.innerHTML = GLASS_SVG + (shop ? shop.glass : 0) + " " + esc(cur);
    }

    _render() {
        for (let i = 0; i < this._navBtns.length; i++) {
            this._navBtns[i].classList.toggle("cur", i === this.tab);
            this._navBtns[i].classList.toggle("zone", i === this.tab && this.zone === "nav");
        }
        const k = NAV[this.tab].k;
        let html = "";
        if (k === "rest") html = this._paneRest();
        else if (k === "travel") html = this._paneTravel();
        else if (k === "boons") html = this._paneBoons();
        else if (k === "relics") html = this._paneRelics();
        else if (k === "shop") html = this._paneShop();
        else html = this._paneChronicle();
        html += '<div class="dwr-status">' + esc(this._status) + "</div>";
        this._pane.innerHTML = html;
        this._items = Array.from(this._pane.querySelectorAll("[data-act]:not(.dim)"));
        if (this.focus >= this._items.length) this.focus = Math.max(0, this._items.length - 1);
        this._paintFocus();
        this._renderPurse();
    }

    _paintFocus() {
        for (let i = 0; i < this._items.length; i++) {
            this._items[i].classList.toggle("focus", this.zone === "pane" && i === this.focus);
        }
        if (this.zone === "pane" && this._items[this.focus] && this._items[this.focus].scrollIntoView) {
            this._items[this.focus].scrollIntoView({ block: "nearest" });
        }
    }

    _paneRest() {
        const c = this.ctx.character;
        return '<div class="dwr-sec">Rest</div>' +
            '<div class="dwr-note">Rest against the anchor. Your wounds close, your mana returns, ' +
            "and the stone keeps your place if you fall.</div>" +
            '<div style="margin:14px 0 6px"><button class="dwr-btn" data-act="rest">Rest here</button></div>' +
            '<div class="dwr-note">Health ' + Math.round(c.health) + " / " + c.healthMax +
            " · Mana " + Math.round(c.mana) + " / " + c.manaMax + "</div>";
    }

    _paneTravel() {
        const c = this.ctx.character;
        let html = "";
        let any = false;
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const realm = REALM_ORDER[r];
            if (!this.realmOpen(realm)) continue;
            const lit = this.litList(realm);
            html += '<div class="dwr-sec">' + esc(realmLabel(this.ctx, realm)) + "</div>";
            if (lit.length === 0) {
                html += '<div class="dwr-note">No shrine awakened here yet.</div>';
                continue;
            }
            html += '<div class="dwr-grid">';
            for (let i = 0; i < lit.length; i++) {
                const id = lit[i];
                const here = realm === this.realm && id === this.shrineId;
                let sub = realm === this.realm ? "" : "Across the Drift";
                if (realm === this.realm && !here) {
                    const idx = this._indexOf(id);
                    const p = idx >= 0 ? this.ctx.shrine.positions[idx] : null;
                    if (p) sub = Math.round(Math.hypot(p.x - c.position.x, p.z - c.position.z)) + " m away";
                }
                if (here) sub = "You are here";
                html += '<button class="dwr-chip' + (here ? " dim on" : "") + '"' +
                    (here ? "" : ' data-act="travel:' + realm + ":" + id + '"') + "><b>" +
                    esc(shrineName(realm, id)) + "</b><i>" + esc(sub) + "</i></button>";
                any = true;
            }
            html += "</div>";
        }
        if (!any) html += '<div class="dwr-note">Awaken more shrines to travel between them.</div>';
        return html;
    }

    _paneBoons() {
        const b = this.ctx.boons;
        const m = this.ctx.mods;
        let html = '<div class="dwr-sec">Boons · swap within a pair freely at any shrine</div>';
        if (!b) return html + '<div class="dwr-note">—</div>';
        html += '<div class="dwr-rows" style="min-width:0">';
        for (let r = 0; r < PAIR_KEYS.length; r++) {
            const k = PAIR_KEYS[r];
            const st = b.stateOf(k);
            html += '<div class="dwr-row"><div class="dwr-rowlabel">' + esc(PAIR_LABEL[k]) + "</div>";
            if (st === "locked") {
                html += '<div class="dwr-note" style="flex:1">Break this Warden to earn a boon.</div></div>';
                continue;
            }
            const pair = b.pair(k);
            for (let i = 0; i < 2; i++) {
                const on = st === "chosen" && b.picks[k] === i;
                const act = st === "pending" ? "choose:" + k + ":" + i : on ? "" : "swap:" + k + ":" + i;
                html += '<button class="dwr-chip' + (on ? " on" : "") + '"' +
                    (act ? ' data-act="' + act + '"' : "") + "><b>" + esc(pair[i].name) +
                    (st === "pending" ? " · choose" : "") + "</b><i>" + esc(pair[i].effect) +
                    "</i></button>";
            }
            html += "</div>";
        }
        html += "</div>";
        const pend = m ? m.driftmarkPending() : 0;
        if (pend > 0) {
            const P = STORY && STORY.driftmarks ? STORY.driftmarks.picks : {};
            html += '<div class="dwr-sec">Driftmarks · ' + pend + " to place</div><div class=\"dwr-grid3\">";
            const kinds = ["dmg", "hp", "surf"];
            for (let i = 0; i < kinds.length; i++) {
                const full = kinds[i] === "surf" && !m.canPickSurf();
                const p = P[kinds[i]] || { name: kinds[i], effect: "" };
                html += '<button class="dwr-chip' + (full ? " dim" : "") + '"' +
                    (full ? "" : ' data-act="mark:' + kinds[i] + '"') + "><b>" + esc(p.name) +
                    "</b><i>" + esc(full ? "At its cap" : p.effect) + "</i></button>";
            }
            html += "</div>";
        }
        return html;
    }

    _paneRelics() {
        const R = this.ctx.relics;
        if (!R) return '<div class="dwr-note">—</div>';
        if (!(this.slotSel >= 0 && this.slotSel < R.slotCount)) this.slotSel = 0;
        let html = '<div class="dwr-sec">Worn</div><div class="dwr-grid3">';
        for (let s = 0; s < SLOT_MAX; s++) {
            if (s >= R.slotCount) {
                html += '<div class="dwr-slot lock"><b>Slot 3 — sealed</b><i>Opens when the Sand realm ' +
                    "Warden falls, or for 400 Wake Glass in the Shop.</i></div>";
                continue;
            }
            const id = R.equipped[s];
            const info = id ? relicInfo(id) : null;
            html += '<button class="dwr-slot' + (id ? " full" : "") + (s === this.slotSel ? " pick" : "") +
                '" data-act="slot:' + s + '"><b>' + (info ? esc(info.name) : "Empty slot") +
                "</b><i>" + (info ? esc(info.effect) : "Choose a relic below") + "</i></button>";
        }
        html += "</div>";
        const worn = R.equipped.filter((x) => !!x);
        const occupied = R.equipped[this.slotSel];
        if (occupied) {
            html += '<div style="margin:8px 0 2px"><button class="dwr-btn" data-act="unequip:' +
                this.slotSel + '">Take off ' + esc(relicInfo(occupied).name) + "</button></div>";
        }
        html += '<div class="dwr-sec">Found · ' + R.owned.length + " / 12</div>";
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const list = RELICS_BY_REALM[REALM_ORDER[r]];
            html += '<div class="dwr-grid" style="margin-bottom:8px">';
            for (let i = 0; i < list.length; i++) {
                const id = list[i];
                if (!R.has(id)) {
                    html += '<div class="dwr-chip dim"><b>???</b><i>' +
                        esc(realmLabel(this.ctx, REALM_ORDER[r])) + "</i></div>";
                    continue;
                }
                const info = relicInfo(id);
                const on = worn.indexOf(id) >= 0;
                html += '<button class="dwr-chip' + (on ? " on" : "") + '" data-act="relic:' + id +
                    '"><b>' + esc(info.name) + (on ? " · slot " + (R.equipped.indexOf(id) + 1) : "") +
                    "</b><i>" + esc(info.effect) + "</i></button>";
            }
            html += "</div>";
        }
        return html;
    }

    _paneShop() {
        const shop = this.ctx.shop;
        if (!shop) return '<div class="dwr-note">—</div>';
        const g = shop.glass;
        const row = (id, pipsHtml, note) => {
            const info = shopInfo(id);
            const price = shop.price(id);
            const can = price !== null && price <= g;
            const label = price === null ? "Owned" : "◆ " + price;
            return '<div class="dwr-shoprow"><div class="dwr-sname"><b>' + esc(info.name) +
                "</b><i>" + esc(note || info.effect) + "</i></div>" + (pipsHtml || "") +
                '<button class="dwr-btn' + (can ? "" : " dim") + '"' +
                (can ? ' data-act="buy:' + id + '"' : "") + ">" + label + "</button></div>";
        };
        const pips = (id) => {
            const r = shop.rank(id);
            let s = '<div class="dwr-pips">';
            for (let i = 0; i < RANK_PRICES.length; i++) s += i < r ? "<b>" + ROMAN[i] + "</b> " : ROMAN[i] + " ";
            return s + "</div>";
        };
        let html = '<div class="dwr-sec">Shrine wares</div>';
        html += row("shop.vitality", pips("shop.vitality"));
        html += row("shop.wellspring", pips("shop.wellspring"));
        html += row("shop.reroll", '<div class="dwr-pips">held <b>' + shop.rerolls + "</b></div>",
            "A token to change a boon away from a shrine");
        const rel = this.ctx.relics;
        html += row("shop.slot3", "", rel && rel.slot3Unlocked && !shop.rank("shop.slot3")
            ? "Already open — the Sand realm Warden gave it" : null);
        html += '<div class="dwr-sec">Wake trails · ◆ 40 each</div><div class="dwr-grid3">';
        html += '<button class="dwr-chip' + (shop.trail === null ? " on" : "") +
            '" data-act="equip:none"><b>Plain wake</b><i>The realm\'s own colour</i></button>';
        for (let i = 0; i < TRAILS.length; i++) {
            const id = TRAILS[i].id;
            const info = shopInfo(id);
            const owned = shop.rank(id) > 0;
            const worn = shop.trail === id;
            const can = !owned && g >= 40;
            const act = owned ? (worn ? "" : "equip:" + id) : can ? "buy:" + id : "";
            html += '<button class="dwr-chip' + (worn ? " on" : "") + (!owned && !can ? " dim" : "") + '"' +
                (act ? ' data-act="' + act + '"' : "") + "><b>" + esc(info.name) + "</b><i>" +
                (worn ? "Worn" : owned ? "Wear it" : "◆ 40") + "</i></button>";
        }
        html += "</div>";
        return html;
    }

    _paneChronicle() {
        return '<div class="dwr-sec">Chronicle</div>' +
            '<div class="dwr-note">The lore you have gathered, in the journal.</div>' +
            '<div style="margin-top:14px"><button class="dwr-btn" data-act="chronicle">Open the Chronicle</button></div>';
    }

    // =================================================================
    // Input
    // =================================================================

    /** @param {MouseEvent} e */
    _click(e) {
        if (this._travelling) return;
        const t = /** @type {any} */ (e.target);
        if (!t || !t.closest) return;
        const nb = t.closest(".dwr-navb");
        if (nb) {
            this.zone = "nav";
            const tab = +nb.dataset.tab;
            if (NAV[tab].k === "chronicle") { this._act("chronicle"); return; }
            this._setTab(tab);
            return;
        }
        const a = t.closest("[data-act]");
        if (a && !a.classList.contains("dim")) {
            this.zone = "pane";
            const at = this._items.indexOf(a);
            if (at >= 0) this.focus = at;
            this._act(a.dataset.act);
            return;
        }
        if (t.classList && t.classList.contains("dwr-scrim")) this.close();
    }

    /** @param {KeyboardEvent} e */
    _key(e) {
        if (!this.isOpen) return;
        const c = e.code;
        if (c === "F1" || c === "F3" || c === "F5" || c === "F11" || c === "F12" || c === "Backquote") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat || this._travelling) return;
        const d = /^Digit([1-6])$/.exec(c);
        if (d) {
            const tab = +d[1] - 1;
            if (NAV[tab].k === "chronicle") { this._act("chronicle"); return; }
            this.zone = "nav";
            this._setTab(tab);
            return;
        }
        const up = c === "ArrowUp" || c === "KeyW";
        const down = c === "ArrowDown" || c === "KeyS";
        const left = c === "ArrowLeft" || c === "KeyA";
        const right = c === "ArrowRight" || c === "KeyD";
        const ok = c === "Enter" || c === "NumpadEnter" || c === "Space" || c === "KeyE";
        if (this.zone === "nav") {
            if (c === "Escape") { this.close(); return; }
            if (up) this._setTab((this.tab + NAV.length - 1) % NAV.length);
            else if (down) this._setTab((this.tab + 1) % NAV.length);
            else if (ok || right) {
                if (NAV[this.tab].k === "chronicle") { this._act("chronicle"); return; }
                if (this._items.length) { this.zone = "pane"; this.focus = 0; this._render(); }
            }
            return;
        }
        // zone === "pane". Esc LEAVES THE SHRINE from anywhere (QUEST §7 "Esc
        // closes any open panel"; the footer promises it) — after a mouse
        // click the keys are in the pane, and a first Esc that only hopped
        // back to the page list read as a dead key. Backspace / ← step back.
        if (c === "Escape") { this.close(); return; }
        if (c === "Backspace" || (left && this.focus === 0)) {
            this.zone = "nav";
            this._render();
            return;
        }
        const n = this._items.length;
        if (up || left) { this.focus = Math.max(0, this.focus - 1); this._paintFocus(); }
        else if (down || right) { this.focus = Math.min(n - 1, this.focus + 1); this._paintFocus(); }
        else if (ok && this._items[this.focus]) this._act(this._items[this.focus].dataset.act);
    }

    // =================================================================
    // Frame
    // =================================================================

    /** Keeps `reach` current for the interact prompt / E hook. Allocation-
     *  free (seven squared distances and a lit lookup). @param {number} dt */
    update(dt) {
        if (dt === 0) return;
        this.reach = this.isOpen ? null : this.shrineInReach();
    }

    /** @param {string} token */
    setRealm(token) {
        this.reach = null;
    }
}

/** Resolve on the next animation frame. @returns {Promise<void>} */
function nextFrame() {
    return new Promise((res) => requestAnimationFrame(() => res()));
}

// ---------------------------------------------------------------------------
// The HUD's Wake Glass readout (QUEST §4.3: "the HUD shows current Wake Glass
// beside mana") — a pill directly under hud.js's mana bar.
// ---------------------------------------------------------------------------

export class GlassCounter {
    /** @param {any} ctx needs shop (ctx.shop), input, overlay, bus */
    constructor(ctx) {
        ensureMenuCss();
        this.ctx = ctx;
        const el = document.createElement("div");
        el.className = "dw-glass";
        el.id = "dw-glass";
        document.body.appendChild(el);
        this.el = el;
        this._show = false;
        this._write();
        if (ctx.bus) {
            ctx.bus.on("glass:changed", (p) => {
                this._write();
                if (p && p.delta > 0) {
                    el.classList.remove("bump");
                    void el.offsetWidth;
                    el.classList.add("bump");
                }
            });
        }
    }

    _write() {
        const shop = this.ctx.shop;
        this.el.innerHTML = GLASS_SVG + (shop ? shop.glass : 0);
        this.el.style.setProperty("--dwr-accent", accentOf(this.ctx));
    }

    /** Same visibility rule as ui/hud.js. Pure poll. @param {number} [dt] */
    update(dt) {
        const inp = this.ctx.input;
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        const ov = this.ctx.overlay;
        const show = !!(inp && inp.locked) && !shellUp && !(ov && ov.visible);
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }
    }

    /** @param {string} token */
    setRealm(token) { this.el.style.setProperty("--dwr-accent", accentOf(this.ctx, token)); }
}
