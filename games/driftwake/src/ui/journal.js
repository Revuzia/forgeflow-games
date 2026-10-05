/**
 * THE JOURNAL (J) — _spec/QUEST_DESIGN.md §7: tabs Main / Side / Lore / Stats.
 *
 *   Main   every realm's chain with done / current / locked — the quest
 *          engine's own snapshot (`quests.journal()`); a realm whose chain is
 *          not open yet shows its steps as "???" (no spoilers past the gate).
 *   Side   per open realm: relic caches found x/15 (and how many seen), the
 *          three Wake Trials with their medal and best time, and the bounty
 *          board — listed from the moment the realm's spawn shrine is lit
 *          (§3.3) — with "last seen near …", claimed / at large, and which
 *          one carries the realm's relic.
 *   Lore   the collected shards in order, uncollected ones "???"; a realm's
 *          Chronicle page once all twelve of its shards are read (§3.4).
 *   Stats  level, deaths, play time, completion % (and what it counts), plus
 *          the ledgers behind it; the "Wakecaster" title after the ending.
 *
 * NOT A MODAL (§7 names only the boon pick and the shrine menu): the world
 * keeps its clock. It IS a cursor panel — it releases the pointer lock (tabs
 * and the scroll are mouse-driven too) and takes the keyboard through the
 * input.js panel stack, so no spell or move key fires behind it and Esc
 * closes it before the pause menu can open. It closes itself when a reward
 * modal opens ('ui:open' boon / shrine) or the world map opens (M from here
 * switches panels).
 *
 * KEYS: 1-4 or ← → (A D) tab · ↑ ↓ (W S) / PgUp PgDn scroll · J, Esc close ·
 * M the map.
 *
 * Content is built on OPEN, on a tab switch, and on a relevant bus event while
 * open (DOM allocation at event rate); `update()` allocates nothing.
 *
 * MODULE SHAPE: constructor(ctx), update(dt), setRealm(token), open(tab),
 * close(), plus the exported pure `completion(ctx)`. ctx: bus, input, overlay,
 * S, quests, progression, caches, trials, bounties, relics, boons, shop,
 * realms, getRealm. Self-registers as `ctx.journal`.
 */

import {
    input as coreInput, openPanel, closePanel, requestLock,
} from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";
import { anyModalOpen, esc } from "./boonPick.js";
import { realmLabel, realmAccent, fill, shellPlaying } from "./questTracker.js";
import { fmtTime } from "./toasts.js";

export const TABS = ["main", "side", "lore", "stats"];
const REALMS = ["cold", "sand", "ash"];
const SPAWN = "cold_spawn";
const SCROLL_STEP = 64;

/** What completion % counts, and the totals. Exported for probes. */
export const COMPLETION_PARTS = Object.freeze({
    main: 20, shrines: 21, caches: 45, trials: 9, bounties: 9,
});

// ---------------------------------------------------------------------------
// Shared panel CSS (the world map uses it too)
// ---------------------------------------------------------------------------

const PANEL_CSS = `
.dwu-panel {
  position: fixed; inset: 0; z-index: 85;
  display: none; align-items: center; justify-content: center;
  font-family: "Segoe UI", system-ui, sans-serif; color: rgba(240, 248, 253, 0.94);
  --dwu-accent: #a8dcf5;
}
.dwu-panel.open { display: flex; animation: dwu-in 160ms ease-out; }
@keyframes dwu-in { from { opacity: 0; } to { opacity: 1; } }
.dwu-scrim { position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(6, 12, 20, 0.45), rgba(4, 8, 14, 0.86)); }
.dwu-card {
  position: relative; display: flex; flex-direction: column;
  width: min(980px, calc(100vw - 32px)); height: min(660px, calc(100vh - 40px));
  box-sizing: border-box; padding: 18px 22px 12px; border-radius: 12px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.88), rgba(8, 13, 19, 0.94));
  border: 1px solid rgba(160, 205, 235, 0.30);
  box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55), inset 0 0 26px rgba(120, 180, 220, 0.06);
}
.dwu-card::after { content: ""; position: absolute; left: 14px; right: 14px; top: 1px; height: 1px;
  background: rgba(230, 245, 255, 0.28); border-radius: 1px; }
.dwu-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.dwu-kicker { font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--dwu-accent); }
.dwu-title { font: 600 21px/1.25 "Segoe UI", system-ui, sans-serif; margin-top: 6px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }
.dwu-chip-title { font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.16em;
  text-transform: uppercase; padding: 5px 10px; border-radius: 12px; color: #ffe2a6;
  border: 1px solid rgba(255, 214, 140, 0.55); background: rgba(255, 200, 110, 0.08); }
.dwu-tabs { display: flex; gap: 6px; margin: 14px 0 10px; flex-wrap: wrap; }
.dwu-tab {
  cursor: pointer; color: inherit; padding: 8px 16px 8px 30px; position: relative;
  border-radius: 8px; font: 600 13px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.04em;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.5), rgba(8, 13, 19, 0.6));
  border: 1px solid rgba(160, 205, 235, 0.18);
}
.dwu-tab span { position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  font: 700 10px/1 "Segoe UI", system-ui, sans-serif; color: rgba(205, 228, 244, 0.55); }
.dwu-tab.cur { border-color: var(--dwu-accent); color: var(--dwu-accent);
  background: linear-gradient(180deg, rgba(24, 38, 52, 0.7), rgba(12, 20, 30, 0.8)); }
.dwu-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 8px 8px 2px; }
.dwu-panel ::-webkit-scrollbar { width: 8px; }
.dwu-panel ::-webkit-scrollbar-track { background: rgba(6, 10, 15, 0.35); border-radius: 4px; }
.dwu-panel ::-webkit-scrollbar-thumb { background: rgba(160, 205, 235, 0.32); border-radius: 4px; }
.dwu-panel ::-webkit-scrollbar-thumb:hover { background: rgba(190, 225, 245, 0.5); }
.dwu-panel ::-webkit-scrollbar-button { display: none; height: 0; }
.dwu-body, .dwm-side { scrollbar-width: thin; scrollbar-color: rgba(160, 205, 235, 0.32) rgba(6, 10, 15, 0.35); }
.dwu-foot { margin-top: 8px; text-align: center; font: 500 11px/1.4 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.04em; color: rgba(205, 228, 244, 0.6); }
.dwu-sec { margin: 16px 0 8px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase;
  color: rgba(205, 228, 244, 0.7); border-bottom: 1px solid rgba(160, 205, 235, 0.14); padding-bottom: 6px; }
.dwu-sec:first-child { margin-top: 2px; }
.dwu-sec b { color: var(--dwu-accent); font-weight: 700; }
.dwu-sub { margin: 10px 0 6px; font: 600 10.5px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.14em; text-transform: uppercase; color: rgba(205, 228, 244, 0.55); }
.dwu-row { display: flex; gap: 10px; align-items: flex-start; padding: 7px 10px; margin-bottom: 4px;
  border-radius: 8px; border: 1px solid rgba(160, 205, 235, 0.10); background: rgba(10, 16, 24, 0.42); }
.dwu-row .ic { flex: none; width: 18px; text-align: center; font: 700 12px/18px "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.5); }
.dwu-row .tx { flex: 1; min-width: 0; }
.dwu-row .tx b { display: block; font: 600 13.5px/1.3 "Segoe UI", system-ui, sans-serif; }
.dwu-row .tx i { display: block; font: 500 12px/1.4 "Segoe UI", system-ui, sans-serif; font-style: normal;
  color: rgba(205, 228, 244, 0.72); margin-top: 1px; }
.dwu-row .rt { flex: none; text-align: right; font: 600 11.5px/1.3 "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.75); font-variant-numeric: tabular-nums; }
.dwu-row.done .ic { color: #9fe3b0; }
.dwu-row.done .tx b { color: rgba(220, 236, 246, 0.78); }
.dwu-row.cur { border-color: var(--dwu-accent); background: rgba(24, 40, 56, 0.55); }
.dwu-row.cur .ic { color: var(--dwu-accent); }
.dwu-row.lock { opacity: 0.45; }
.dwu-pill { display: inline-block; padding: 2px 7px; border-radius: 9px; font: 700 10px/1.3 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid rgba(160, 205, 235, 0.35); color: rgba(205, 228, 244, 0.8); }
.dwu-pill.m1 { color: #e3a877; border-color: rgba(227, 168, 119, 0.6); }
.dwu-pill.m2 { color: #d9e6f0; border-color: rgba(217, 230, 240, 0.6); }
.dwu-pill.m3 { color: #ffd98a; border-color: rgba(255, 217, 138, 0.7); }
.dwu-pill.ok { color: #9fe3b0; border-color: rgba(159, 227, 176, 0.55); }
.dwu-pill.bad { color: #ff9a6e; border-color: rgba(255, 154, 110, 0.55); }
.dwu-pill.relic { color: #ffd98a; border-color: rgba(255, 217, 138, 0.55); margin-left: 6px; }
.dwu-lore { padding: 9px 12px; margin-bottom: 6px; border-radius: 8px;
  border: 1px solid rgba(160, 205, 235, 0.12); background: rgba(10, 16, 24, 0.42); }
.dwu-lore b { display: block; font: 600 13px/1.3 "Segoe UI", system-ui, sans-serif; color: var(--dwu-accent); }
.dwu-lore p { margin: 4px 0 0; font: italic 400 13px/1.5 "Segoe UI", system-ui, sans-serif; color: rgba(225, 240, 250, 0.88); }
.dwu-lore.insc p { font-style: normal; letter-spacing: 0.06em; font-variant: small-caps; }
.dwu-lore.lock { opacity: 0.4; }
.dwu-lore.chron { border-color: rgba(255, 214, 140, 0.45); background: rgba(40, 30, 14, 0.35); }
.dwu-lore.chron b { color: #ffd98a; }
.dwu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.dwu-stat { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(160, 205, 235, 0.14);
  background: rgba(10, 16, 24, 0.45); }
.dwu-stat i { display: block; font: 600 10px/1 "Segoe UI", system-ui, sans-serif; font-style: normal;
  letter-spacing: 0.16em; text-transform: uppercase; color: rgba(205, 228, 244, 0.6); }
.dwu-stat b { display: block; margin-top: 6px; font: 600 20px/1.1 "Segoe UI", system-ui, sans-serif;
  font-variant-numeric: tabular-nums; }
.dwu-stat small { display: block; margin-top: 3px; font: 500 11px/1.3 "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.6); }
.dwu-bar { height: 6px; border-radius: 3px; margin-top: 8px; overflow: hidden;
  background: rgba(6, 10, 15, 0.7); border: 1px solid rgba(160, 205, 235, 0.2); }
.dwu-bar div { height: 100%; background: linear-gradient(90deg, #6cc3ea, var(--dwu-accent)); }
.dwu-note { font: 500 12.5px/1.45 "Segoe UI", system-ui, sans-serif; color: rgba(205, 228, 244, 0.7); }
@media (max-height: 640px) { .dwu-card { padding-top: 12px; } .dwu-tabs { margin: 10px 0 6px; } }
`;

let _panelCss = false;
/** Inject the shared journal / map panel CSS once. */
export function ensurePanelCss() {
    if (_panelCss || typeof document === "undefined") return;
    _panelCss = true;
    const s = document.createElement("style");
    s.id = "dwu-panel-css";
    s.textContent = PANEL_CSS;
    document.head.appendChild(s);
}

/** May a cursor panel open right now (no modal, shell in play, no overlay)? */
export function panelMayOpen(ctx) {
    if (anyModalOpen() || !shellPlaying()) return false;
    const ov = ctx.overlay;
    return !(ov && ov.visible);
}

/** Realms whose chain is open (cold always; others once unlocked / stood in). */
export function openRealms(ctx) {
    const P = ctx.progression;
    const cur = ctx.getRealm ? ctx.getRealm() : "cold";
    const out = [];
    for (let i = 0; i < REALMS.length; i++) {
        const r = REALMS[i];
        const un = P && Array.isArray(P.realmsUnlocked) && P.realmsUnlocked.indexOf(r) >= 0;
        if (r === "cold" || r === cur || un || (P && P.testMode)) out.push(r);
    }
    return out;
}

/**
 * Completion: main steps + shrines lit + caches opened + trials medalled +
 * bounties claimed, over COMPLETION_PARTS (104). Allocates (a panel call).
 * @param {any} ctx @returns {{pct:number, done:number, total:number, parts:Record<string, number[]>}}
 */
export function completion(ctx) {
    const P = ctx.progression;
    const Q = ctx.quests;
    const parts = {};
    let mainDone = 0;
    if (Q && typeof Q.journal === "function") mainDone = Q.journal().mainDone | 0;
    parts.main = [mainDone, COMPLETION_PARTS.main];
    let lit = 0;
    if (P && typeof P.litShrines === "function") {
        for (let i = 0; i < REALMS.length; i++) lit += P.litShrines(REALMS[i]).length;
    }
    parts.shrines = [Math.min(lit, 21), COMPLETION_PARTS.shrines];
    let caches = 0;
    const C = ctx.caches;
    if (C && typeof C.counts === "function") {
        for (let i = 0; i < REALMS.length; i++) caches += C.counts(REALMS[i]).found;
    }
    parts.caches = [caches, COMPLETION_PARTS.caches];
    let trials = 0;
    const T = ctx.trials;
    if (T && typeof T.record === "function" && STORY.trials) {
        for (let i = 0; i < REALMS.length; i++) {
            const defs = STORY.trials[REALMS[i]] || [];
            for (let k = 0; k < defs.length; k++) if (T.record(defs[k].id).medal > 0) trials++;
        }
    }
    parts.trials = [trials, COMPLETION_PARTS.trials];
    let bounties = 0;
    const B = ctx.bounties;
    if (B && typeof B.isKilled === "function" && STORY.bounties) {
        for (let i = 0; i < REALMS.length; i++) {
            const defs = STORY.bounties[REALMS[i]] || [];
            for (let k = 0; k < defs.length; k++) if (B.isKilled(defs[k].id)) bounties++;
        }
    }
    parts.bounties = [bounties, COMPLETION_PARTS.bounties];
    let done = 0, total = 0;
    for (const k in parts) { done += parts[k][0]; total += parts[k][1]; }
    return { pct: total ? Math.floor((done / total) * 1000) / 10 : 0, done, total, parts };
}

/** h m s for the Stats tab. @param {number} s */
export function fmtPlay(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h > 0 ? h + "h " : "") + (h > 0 || m > 0 ? m + "m " : "") + r + "s";
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

export class Journal {
    /** @param {any} ctx */
    constructor(ctx) {
        ensurePanelCss();
        this.ctx = ctx;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;

        const labels = STORY.ui && STORY.ui.journalTabs ? STORY.ui.journalTabs : {};
        const el = document.createElement("div");
        el.id = "dw-journal";
        el.className = "dwu-panel";
        el.innerHTML =
            '<div class="dwu-scrim"></div><div class="dwu-card">' +
            '<div class="dwu-head"><div><div class="dwu-kicker">Journal</div>' +
            '<div class="dwu-title"></div></div><div class="dwu-badge"></div></div>' +
            '<div class="dwu-tabs">' + TABS.map((t, i) =>
                '<button class="dwu-tab" data-tab="' + t + '"><span>' + (i + 1) + "</span>" +
                esc(labels[t] || t) + "</button>").join("") + "</div>" +
            '<div class="dwu-body"></div>' +
            '<div class="dwu-foot">1-4 or ← → tabs · ↑ ↓ scroll · M map · J or Esc close</div></div>';
        document.body.appendChild(el);
        this.el = el;
        this._title = el.querySelector(".dwu-title");
        this._badge = el.querySelector(".dwu-badge");
        this._body = el.querySelector(".dwu-body");
        this._tabs = el.querySelectorAll(".dwu-tab");

        this.isOpen = false;
        this.tab = "main";
        this._dirty = false;
        this._statsT = 0;
        /** Probe surface. */
        this.stats = { opens: 0, closes: 0, renders: 0, lastTab: "", closedBy: "" };

        this._onKey = (e) => this._key(e);
        el.addEventListener("click", (e) => this._click(e));

        const B = this.bus;
        const dirty = () => { if (this.isOpen) this._dirty = true; };
        this._offs = [
            B.on("ui:open", (p) => {
                if (!p) return;
                if (p.panel === "journal") { if (!this.isOpen) this.open(p.tab); else if (p.tab) this.setTab(p.tab); return; }
                if (this.isOpen && (p.panel === "boon" || p.panel === "shrine" || p.panel === "map")) {
                    this.close(p.panel);
                }
            }),
        ];
        const evs = ["quest:step", "quest:complete", "cache:opened", "cache:discovered",
            "trial:finished", "bounty:killed", "bounty:revealed", "shrine:activated",
            "glass:changed", "relic:equipped", "boon:chosen", "player:levelup", "ending:done"];
        for (let i = 0; i < evs.length; i++) this._offs.push(B.on(evs[i], dirty));
        ctx.journal = this;
    }

    /**
     * Open at a tab. @param {string} [tab] @returns {boolean}
     */
    open(tab) {
        if (this.isOpen) { if (tab) this.setTab(tab); return true; }
        if (!panelMayOpen(this.ctx)) return false;
        this.isOpen = true;
        this.stats.opens++;
        this.tab = TABS.indexOf(tab) >= 0 ? tab : this.tab;
        const realm = this.ctx.getRealm ? this.ctx.getRealm() : "cold";
        this.el.style.setProperty("--dwu-accent", realmAccent(this.ctx, realm));
        this.el.classList.add("open");
        openPanel("journal", this._onKey, { cursor: true });
        this._render();
        this.bus.emit("ui:open", { panel: "journal", tab: this.tab });
        return true;
    }

    /**
     * @param {string} [by] why it closed ('key' re-locks the pointer;
     *   another panel / modal opening does not)
     */
    close(by) {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.stats.closes++;
        this.stats.closedBy = by || "api";
        this.el.classList.remove("open");
        closePanel("journal");
        this.bus.emit("ui:close", { panel: "journal" });
        if ((by === "key" || by === "click") && !anyModalOpen() && !this.input.panel && shellPlaying()) {
            requestLock();
        }
    }

    toggle(tab) { if (this.isOpen) this.close("key"); else this.open(tab); }

    /** @param {string} tab */
    setTab(tab) {
        if (TABS.indexOf(tab) < 0) return;
        this.tab = tab;
        this._body.scrollTop = 0;
        this._render();
    }

    /** @param {number} dt */
    update(dt) {
        if (!this.isOpen) {
            if (dt !== 0 && this.input.journalPressed && panelMayOpen(this.ctx) && !this.input.panel) {
                this.open();
            }
            return;
        }
        if (this.tab === "stats") {
            this._statsT += dt;
            if (this._statsT >= 1) { this._statsT = 0; this._dirty = true; }
        }
        if (this._dirty) { this._dirty = false; this._render(); }
    }

    /** @param {string} token */
    setRealm(token) {
        this.el.style.setProperty("--dwu-accent", realmAccent(this.ctx, token));
        if (this.isOpen) this._dirty = true;
    }

    dispose() {
        this.close("api");
        for (let i = 0; i < this._offs.length; i++) this._offs[i]();
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }

    // ============================================================ render

    _render() {
        this.stats.renders++;
        this.stats.lastTab = this.tab;
        for (let i = 0; i < this._tabs.length; i++) {
            this._tabs[i].classList.toggle("cur", this._tabs[i].dataset.tab === this.tab);
        }
        const ctx = this.ctx;
        const Q = ctx.quests;
        const jn = Q && typeof Q.journal === "function" ? Q.journal() : null;
        const realm = ctx.getRealm ? ctx.getRealm() : "cold";
        this._title.textContent = realmLabel(ctx, realm);
        const title = jn && jn.playerTitle ? jn.playerTitle : null;
        this._badge.innerHTML = title ? '<span class="dwu-chip-title">' + esc(title) + "</span>" : "";
        let html = "";
        if (this.tab === "main") html = this._main(jn);
        else if (this.tab === "side") html = this._side();
        else if (this.tab === "lore") html = this._lore();
        else html = this._statsTab(jn);
        this._body.innerHTML = html;
    }

    _main(jn) {
        if (!jn) return '<div class="dwu-note">The journal is empty.</div>';
        const locked = STORY.ui ? STORY.ui.locked : "???";
        let h = "";
        for (let r = 0; r < jn.realms.length; r++) {
            const R = jn.realms[r];
            const steps = R.steps;
            const done = Math.min(R.current, steps.length);
            h += '<div class="dwu-sec"><span>' + esc(realmLabel(this.ctx, R.realm)) + "</span><span><b>" +
                done + "</b> / " + steps.length + (R.complete ? " · complete" : "") + "</span></div>";
            for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                if (!R.open && s.status !== "done") {
                    h += '<div class="dwu-row lock"><div class="ic">·</div><div class="tx"><b>' +
                        esc(locked) + "</b></div></div>";
                    continue;
                }
                const cls = s.status === "done" ? "done" : s.status === "current" ? "cur" : "lock";
                const ic = s.status === "done" ? "✓" : s.status === "current" ? "◆" : "·";
                h += '<div class="dwu-row ' + cls + '" data-step="' + esc(s.id) + '"><div class="ic">' + ic +
                    '</div><div class="tx"><b>' + esc(s.title) + "</b>" +
                    (s.status === "current" ? "<i>" + esc(this._trackerFor(s)) + "</i>" : "") +
                    "</div></div>";
            }
        }
        if (jn.endingSeen) {
            h += '<div class="dwu-sec"><span>' + esc(STORY.ending ? STORY.ending.card : "The Drift is mended.") +
                "</span></div><div class=\"dwu-note\">" +
                esc(STORY.trackers && STORY.trackers.postGame ? STORY.trackers.postGame.text : "") + "</div>";
        }
        return h;
    }

    /** The live tracker line for the current step (progress-aware). */
    _trackerFor(s) {
        const Q = this.ctx.quests;
        const t = Q && Q.tracked && Q.tracked.stepId === s.id ? Q.tracked : null;
        if (!t) return s.tracker;
        let line = t.underLevel > 0 ? s.tracker + " — " + t.tracker : t.tracker;
        if (t.progress && t.progress.need > 0) line += "  (" + t.progress.have + " / " + t.progress.need + ")";
        return line;
    }

    _side() {
        const ctx = this.ctx;
        const P = ctx.progression;
        const C = ctx.caches, T = ctx.trials, B = ctx.bounties;
        const medals = STORY.ui && STORY.ui.medals ? STORY.ui.medals : ["Bronze", "Silver", "Gold"];
        const side = STORY.ui && STORY.ui.side ? STORY.ui.side : {};
        const realms = openRealms(ctx);
        let h = "";
        for (let r = 0; r < realms.length; r++) {
            const realm = realms[r];
            h += '<div class="dwu-sec"><span>' + esc(realmLabel(ctx, realm)) + "</span></div>";
            // Caches.
            if (C && typeof C.counts === "function") {
                const n = C.counts(realm);
                h += '<div class="dwu-row"><div class="ic">◇</div><div class="tx"><b>' +
                    esc(fill(side.caches || "Relic caches found {found}/{total}", { found: n.found, total: n.total })) +
                    "</b><i>" + n.seen + " spotted · every unopened cache glints within 90 m</i></div>" +
                    '<div class="rt">' + n.found + " / " + n.total + "</div></div>";
            }
            // Trials.
            h += '<div class="dwu-sub">' + esc(side.trials || "Wake Trials") + "</div>";
            const tl = T && typeof T.list === "function" ? T.list(realm) : (STORY.trials[realm] || []).map((d) => ({
                id: d.id, name: d.name, desc: d.desc, medal: 0, best: null, relic: null }));
            for (let i = 0; i < tl.length; i++) {
                const t = tl[i];
                const m = t.medal | 0;
                h += '<div class="dwu-row' + (m > 0 ? " done" : "") + '" data-trial="' + esc(t.id) +
                    '"><div class="ic">○</div><div class="tx"><b>' + esc(t.name) +
                    (t.relic ? '<span class="dwu-pill relic">Relic on gold</span>' : "") + "</b><i>" + esc(t.desc) +
                    "</i></div><div class=\"rt\">" +
                    (m > 0 ? '<span class="dwu-pill m' + m + '">' + esc(medals[m - 1]) + "</span><br>" +
                        "best " + esc(fmtTime(t.best)) : "not yet run") +
                    (t.par ? "<br>par " + esc(fmtTime(t.par)) : "") + "</div></div>";
            }
            // Bounties: listed from the moment the realm's spawn shrine is lit.
            h += '<div class="dwu-sub">' + esc(side.bounties || "Bounties") + "</div>";
            const known = !P || typeof P.isShrineLit !== "function" || P.isShrineLit(realm, SPAWN);
            if (!known) {
                h += '<div class="dwu-note">Touch this land\'s first shrine to learn who the Drift has sent.</div>';
                continue;
            }
            const bl = B && typeof B.list === "function" ? B.list(realm) : (STORY.bounties[realm] || []).map((d) => ({
                id: d.id, name: d.name, desc: d.desc, killed: false, lastSeen: "", relic: null }));
            for (let i = 0; i < bl.length; i++) {
                const b = bl[i];
                h += '<div class="dwu-row' + (b.killed ? " done" : "") + '" data-bounty="' + esc(b.id) +
                    '"><div class="ic">' + (b.killed ? "✓" : "✕") + '</div><div class="tx"><b>' + esc(b.name) +
                    (b.relic ? '<span class="dwu-pill relic">Carries a relic</span>' : "") + "</b><i>" +
                    esc(b.desc) + "</i>" + (b.lastSeen && !b.killed ? "<i>" + esc(b.lastSeen) + "</i>" : "") +
                    '</div><div class="rt">' + (b.killed ? '<span class="dwu-pill ok">Claimed</span>'
                        : '<span class="dwu-pill bad">At large</span>') + "</div></div>";
            }
        }
        return h;
    }

    _lore() {
        const ctx = this.ctx;
        const C = ctx.caches;
        const open = openRealms(ctx);
        const locked = STORY.ui ? STORY.ui.locked : "???";
        let h = "";
        for (let r = 0; r < REALMS.length; r++) {
            const realm = REALMS[r];
            const shards = STORY.lore[realm] || [];
            const got = C && typeof C.loreCollected === "function" ? C.loreCollected(realm) : [];
            h += '<div class="dwu-sec"><span>' + esc(realmLabel(ctx, realm)) + "</span><span><b>" +
                got.length + "</b> / " + shards.length + "</span></div>";
            if (open.indexOf(realm) < 0 && got.length === 0) {
                h += '<div class="dwu-note">' + esc(locked) + " — this shard of the world is still beyond the Drift.</div>";
                continue;
            }
            const ch = STORY.chronicle ? STORY.chronicle[realm] : null;
            if (ch && got.length >= shards.length && shards.length > 0) {
                h += '<div class="dwu-lore chron" data-chronicle="' + realm + '"><b>' + esc(ch.title) + "</b>" +
                    ch.lines.map((l) => "<p>" + esc(l) + "</p>").join("") + "</div>";
            }
            for (let i = 0; i < shards.length; i++) {
                const s = shards[i];
                if (got.indexOf(s.id) < 0) {
                    h += '<div class="dwu-lore lock"><b>' + esc(locked) + "</b></div>";
                    continue;
                }
                h += '<div class="dwu-lore' + (s.voice === "inscription" ? " insc" : "") + '" data-lore="' +
                    esc(s.id) + '"><b>' + esc(s.title) + "</b>" + s.lines.map((l) => "<p>" + esc(l) + "</p>").join("") +
                    "</div>";
            }
            if (ch && got.length < shards.length) {
                h += '<div class="dwu-note">Read all ' + shards.length + " shards of this land to unlock its Chronicle.</div>";
            }
        }
        return h;
    }

    _statsTab(jn) {
        const ctx = this.ctx;
        const P = ctx.progression || {};
        const comp = completion(ctx);
        const relics = ctx.relics;
        const boons = ctx.boons;
        const shop = ctx.shop;
        let picks = 0;
        if (boons && boons.picks) for (const k in boons.picks) if (boons.picks[k] === 0 || boons.picks[k] === 1) picks++;
        const surf = jn ? jn.surfM : 0;
        const card = (label, value, small, bar) =>
            '<div class="dwu-stat"><i>' + esc(label) + "</i><b>" + esc(value) + "</b>" +
            (small ? "<small>" + esc(small) + "</small>" : "") +
            (bar !== undefined ? '<div class="dwu-bar"><div style="width:' + Math.max(0, Math.min(100, bar)).toFixed(1) +
                '%"></div></div>' : "") + "</div>";
        const pp = comp.parts;
        let h = '<div class="dwu-sec"><span>Record</span></div><div class="dwu-grid">';
        h += card("Level", String(P.level || 1), P.driftmarks ? P.driftmarks + " Driftmarks" : "");
        h += card("Deaths", String(P.deaths || 0), "");
        h += card("Play time", fmtPlay(P.playTime), "");
        h += card("Completion", comp.pct.toFixed(1) + "%", comp.done + " of " + comp.total, comp.pct);
        h += "</div>";
        h += '<div class="dwu-sec"><span>What completion counts</span></div><div class="dwu-grid">';
        h += card("Main quest", pp.main[0] + " / " + pp.main[1], "steps", (pp.main[0] / pp.main[1]) * 100);
        h += card("Shrines", pp.shrines[0] + " / " + pp.shrines[1], "awakened", (pp.shrines[0] / pp.shrines[1]) * 100);
        h += card("Relic caches", pp.caches[0] + " / " + pp.caches[1], "opened", (pp.caches[0] / pp.caches[1]) * 100);
        h += card("Wake Trials", pp.trials[0] + " / " + pp.trials[1], "with a medal", (pp.trials[0] / pp.trials[1]) * 100);
        h += card("Bounties", pp.bounties[0] + " / " + pp.bounties[1], "claimed", (pp.bounties[0] / pp.bounties[1]) * 100);
        h += "</div>";
        h += '<div class="dwu-sec"><span>Treasury</span></div><div class="dwu-grid">';
        h += card(STORY.ui ? STORY.ui.currency : "Wake Glass", String(shop ? shop.glass : 0),
            shop ? shop.rerolls + " boon reroll token" + (shop.rerolls === 1 ? "" : "s") : "");
        h += card("Relics", (relics && relics.owned ? relics.owned.length : 0) + " / 12",
            relics ? relics.slotCount + " slots" : "");
        h += card("Boons", picks + " / 6", "one per Warden broken");
        h += card("Surfed", surf >= 1000 ? (surf / 1000).toFixed(2) + " km" : Math.round(surf) + " m", "");
        h += "</div>";
        return h;
    }

    // ============================================================= input

    /** @param {MouseEvent} e */
    _click(e) {
        const t = /** @type {any} */ (e.target);
        if (!t || !t.closest) return;
        const tb = t.closest(".dwu-tab");
        if (tb) { this.setTab(tb.dataset.tab); return; }
        if (t.classList && t.classList.contains("dwu-scrim")) this.close("click");
    }

    /** @param {KeyboardEvent} e */
    _key(e) {
        if (!this.isOpen || e.repeat && !/^(Arrow|Page|Key[WS])/.test(e.code)) return;
        const c = e.code;
        if (c === "Escape" || c === "KeyJ") { this.close(c === "Escape" ? "esc" : "key"); return; }
        if (c === "KeyM") {
            this.close("map");
            this.bus.emit("ui:open", { panel: "map" });
            return;
        }
        const d = /^Digit([1-4])$/.exec(c);
        if (d) { this.setTab(TABS[+d[1] - 1]); return; }
        const i = TABS.indexOf(this.tab);
        if (c === "ArrowLeft" || c === "KeyA" || c === "KeyQ") { this.setTab(TABS[(i + 3) % 4]); return; }
        if (c === "ArrowRight" || c === "KeyD" || c === "KeyE" || c === "Tab") { this.setTab(TABS[(i + 1) % 4]); return; }
        const b = this._body;
        if (c === "ArrowDown" || c === "KeyS") b.scrollTop += SCROLL_STEP;
        else if (c === "ArrowUp" || c === "KeyW") b.scrollTop -= SCROLL_STEP;
        else if (c === "PageDown") b.scrollTop += SCROLL_STEP * 5;
        else if (c === "PageUp") b.scrollTop -= SCROLL_STEP * 5;
    }
}
