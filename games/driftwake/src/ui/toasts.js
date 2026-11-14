/**
 * TOASTS — every beat pays something, and the player sees it paid
 * (_spec/QUEST_DESIGN.md §7 "TOASTS", §4):
 *
 *   QUEST BANNER   "Quest Complete — <title>" top-centre for 3 s, the rewards
 *                  listed under it ('quest:complete'). At top 142 px: below
 *                  the Wake Trial timer (lane W, top 58 px, ~75 px tall) so a
 *                  completion during a run never covers the clock.
 *   TOAST STACK    right column under the quest tracker, newest on top, at
 *                  most four: Shrine Awakened ('shrine:activated' first),
 *                  Relic Found (name + effect), Lore Shard Found, Chronicle
 *                  Unlocked (the realm's 12th shard), <Medal> Medal ('trial:
 *                  finished'), Bounty Claimed ('bounty:killed'), +N Wake Glass
 *                  ('glass:changed' delta > 0, coalesced over 2.5 s so an elite
 *                  trickle is one rolling toast), Wake Trail, Boon Reroll, Boon
 *                  Chosen ('boon:chosen', not a respec).
 *   HINT STRIP     the onboarding prompts ('hint' / 'hint:clear' from the quest
 *                  engine: "Hold RMB to surf", "LMB — Bolt", "1 — Frost Arc",
 *                  "J — Journal, M — Map, E — Interact"), stacked above the
 *                  crosshair; ttl hints expire on their own clock here too.
 *
 * The Driftmark pick toast (§4.4, one click) is lane R's `DriftmarkToast`
 * (ui/boonPick.js) — not duplicated here.
 *
 * Words come from storyText.js (STORY.ui.toasts templates). DOM nodes are
 * created per EVENT (a toast is born) and removed at expiry; lifetimes run on
 * GAME time, so a toast shown just before the boon pick is still there after
 * it. `update()` allocates nothing.
 *
 * MODULE SHAPE: constructor(ctx), update(dt), setRealm(token). ctx: bus,
 * input, overlay, caches (Chronicle check), relics (relic name resolve),
 * realms, getRealm.
 */

import { input as coreInput } from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";
import { hudShown, realmAccent, realmLabel, fill } from "./questTracker.js";

/** QUEST §7: the banner holds 3 s. */
export const BANNER_S = 3.0;
/** A stack toast's life, s of game time, and the fade at its end. */
export const TOAST_S = 4.5;
const FADE_S = 0.35;
/** Wake Glass gains this close together share one toast. */
export const GLASS_MERGE_S = 2.5;
const STACK_MAX = 4;

const MEDAL_CLASS = ["", "m1", "m2", "m3"];

const CSS = `
#dw-banner {
  position: fixed; left: 50%; top: 142px;
  transform: translate(-50%, -8px);
  min-width: 300px; max-width: calc(100vw - 32px); box-sizing: border-box;
  z-index: 57; pointer-events: none; text-align: center;
  padding: 10px 26px 12px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(16, 26, 36, 0.80), rgba(8, 13, 19, 0.86));
  border: 1px solid var(--tb-accent, rgba(160, 205, 235, 0.5));
  box-shadow: 0 0 22px rgba(150, 215, 255, 0.22), 0 6px 22px rgba(0, 0, 0, 0.45);
  font-family: "Segoe UI", system-ui, sans-serif; color: rgba(240, 248, 253, 0.96);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  opacity: 0; transition: opacity 240ms ease, transform 240ms ease;
  --tb-accent: #a8dcf5;
}
#dw-banner.show { opacity: 1; transform: translate(-50%, 0); }
#dw-banner .tb-kick {
  font: 600 10px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.26em;
  text-transform: uppercase; color: var(--tb-accent);
}
#dw-banner .tb-title { font: 600 19px/1.25 "Segoe UI", system-ui, sans-serif; margin-top: 6px; }
#dw-banner .tb-rew {
  margin-top: 6px; font: 600 12px/1.2 "Segoe UI", system-ui, sans-serif;
  color: rgba(214, 236, 248, 0.85); letter-spacing: 0.04em;
}
#dw-banner .tb-rew:empty { display: none; }
#dw-toasts {
  position: fixed; right: 18px; top: 196px; width: 292px;
  z-index: 56; pointer-events: none;
  display: flex; flex-direction: column-reverse; gap: 7px;
  opacity: 0; transition: opacity 180ms ease;
}
#dw-toasts.show { opacity: 1; }
.dw-toast {
  position: relative; box-sizing: border-box;
  padding: 8px 12px 9px 14px; border-radius: 9px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.78), rgba(8, 13, 19, 0.86));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
  font-family: "Segoe UI", system-ui, sans-serif; color: rgba(240, 248, 253, 0.95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  animation: dw-toast-in 220ms ease-out;
  transition: opacity 300ms ease;
}
.dw-toast.out { opacity: 0; }
@keyframes dw-toast-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
.dw-toast::before {
  content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px; border-radius: 2px;
  background: var(--tt-accent, #a8dcf5);
}
.dw-toast .tt-kick {
  font: 600 9.5px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--tt-accent, #a8dcf5);
}
.dw-toast .tt-main { font: 600 13.5px/1.3 "Segoe UI", system-ui, sans-serif; margin-top: 4px; }
.dw-toast .tt-sub { font: 500 11.5px/1.35 "Segoe UI", system-ui, sans-serif; color: rgba(205, 228, 244, 0.78); margin-top: 2px; }
.dw-toast .tt-sub:empty { display: none; }
.dw-toast.relic, .dw-toast.m3 { --tt-accent: #ffd98a; border-color: rgba(255, 214, 140, 0.45); }
.dw-toast.m2 { --tt-accent: #d9e6f0; }
.dw-toast.m1 { --tt-accent: #e3a877; }
.dw-toast.bounty { --tt-accent: #ff9a6e; }
#dw-hints {
  position: fixed; left: 50%; top: calc(50% - 116px);
  transform: translateX(-50%);
  z-index: 56; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  opacity: 0; transition: opacity 200ms ease;
}
#dw-hints.show { opacity: 1; }
.dw-hint {
  padding: 6px 14px 7px; border-radius: 16px; white-space: nowrap;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.62), rgba(8, 13, 19, 0.74));
  border: 1px solid rgba(174, 232, 255, 0.42);
  box-shadow: 0 0 14px rgba(150, 215, 255, 0.16), 0 1px 6px rgba(0, 0, 0, 0.45);
  font: 600 13px/1.2 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.05em;
  color: rgba(235, 248, 255, 0.96); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  animation: dw-hint-in 300ms ease-out;
}
@keyframes dw-hint-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-toasts-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

/** STORY.ui.toasts[key] filled, with a fallback. */
function tpl(key, fb, v) {
    const T = STORY.ui && STORY.ui.toasts ? STORY.ui.toasts : null;
    return fill(T && T[key] ? T[key] : fb, v || {});
}

/** Format seconds as 29.8 s / 1:04.2. @param {number} s */
export function fmtTime(s) {
    if (!(s >= 0)) return "";
    if (s < 60) return s.toFixed(1) + " s";
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
}

export class Toasts {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;

        // Banner.
        const b = document.createElement("div");
        b.id = "dw-banner";
        b.innerHTML = '<div class="tb-kick"></div><div class="tb-title"></div><div class="tb-rew"></div>';
        document.body.appendChild(b);
        this.banner = b;
        this._bKick = b.querySelector(".tb-kick");
        this._bTitle = b.querySelector(".tb-title");
        this._bRew = b.querySelector(".tb-rew");
        /** Pending banners: {kick, title, rew}. */
        this._bq = [];
        this._bT = 0;            // remaining on the banner on screen (0 = none)

        // Stack.
        const st = document.createElement("div");
        st.id = "dw-toasts";
        document.body.appendChild(st);
        this.stack = st;
        /** Live toasts, oldest first: {el, t, kind, glass}. */
        this.live = [];

        // Hints.
        const h = document.createElement("div");
        h.id = "dw-hints";
        document.body.appendChild(h);
        this.hintsEl = h;
        /** Live hints: {id, el, ttl (-1 = until 'hint:clear')}. */
        this.hints = [];

        this._show = false;
        /** Probe surface: counts per kind, the last texts. */
        this.stats = { banners: 0, toasts: 0, hints: 0, byKind: {}, lastBanner: "", lastToast: "" };

        const B = this.bus;
        this._offs = [
            B.on("quest:complete", (p) => this._onQuest(p)),
            B.on("shrine:activated", (p) => {
                if (!p || !p.first) return;
                const r = STORY.shrines && STORY.shrines[p.realm] ? STORY.shrines[p.realm][p.id] : null;
                this.push("shrine", tpl("shrineAwakened", "Shrine Awakened"), r ? r.name : p.id, "");
            }),
            B.on("reward", (p) => this._onReward(p)),
            B.on("glass:changed", (p) => { if (p && p.delta > 0) this._glass(p.delta); }),
            B.on("trial:finished", (p) => this._onTrial(p)),
            B.on("bounty:killed", (p) => {
                if (!p) return;
                this.push("bounty", tpl("bountyClaimed", "Bounty Claimed — {name}", { name: p.name || p.id }), "", "");
            }),
            B.on("boon:chosen", (p) => {
                if (!p || p.respec || !p.boon) return;
                this.push("boon", tpl("boonChosen", "Boon Chosen — {name}", { name: p.boon.name || p.boon.id }),
                    p.boon.effect || "", "");
            }),
            B.on("hint", (p) => this._onHint(p)),
            B.on("hint:clear", (p) => { if (p) this._dropHint(p.id); }),
        ];
        this.setRealm(ctx.getRealm ? ctx.getRealm() : "cold");
    }

    // ================================================================ API

    /**
     * Push a stack toast. Event-rate (allocates its node).
     * @param {string} kind css + stats key @param {string} kick
     * @param {string} main @param {string} sub @returns {any} the node
     */
    push(kind, kick, main, sub) {
        const el = document.createElement("div");
        el.className = "dw-toast " + kind;
        const k = document.createElement("div"); k.className = "tt-kick"; k.textContent = kick;
        const m = document.createElement("div"); m.className = "tt-main"; m.textContent = main || "";
        const s = document.createElement("div"); s.className = "tt-sub"; s.textContent = sub || "";
        el.appendChild(k);
        if (main) el.appendChild(m);
        el.appendChild(s);
        // Newest on top: the stack is a column-REVERSE flexbox.
        this.stack.appendChild(el);
        const t = { el, t: TOAST_S, kind, glass: 0, main: m, kick: k };
        this.live.push(t);
        while (this.live.length > STACK_MAX) this._remove(0);
        this.stats.toasts++;
        this.stats.byKind[kind] = (this.stats.byKind[kind] || 0) + 1;
        this.stats.lastToast = kick + (main ? " | " + main : "") + (sub ? " | " + sub : "");
        return t;
    }

    /** @param {number} dt */
    update(dt) {
        const show = hudShown(this.input, this.ctx.overlay);
        if (show !== this._show) {
            this._show = show;
            this.stack.classList.toggle("show", show);
            this.hintsEl.classList.toggle("show", show);
            if (!show) this.banner.classList.remove("show");
            else if (this._bT > 0) this.banner.classList.add("show");
        }
        if (dt === 0) return;

        // Banner clock.
        if (this._bT > 0) {
            this._bT -= dt;
            if (this._bT <= 0) {
                this._bT = 0;
                this.banner.classList.remove("show");
            }
        } else if (this._bq.length > 0) {
            this._showBanner(this._bq.shift());
        }

        // Stack clocks (oldest first; removal walks backwards).
        for (let i = this.live.length - 1; i >= 0; i--) {
            const t = this.live[i];
            const before = t.t;
            t.t -= dt;
            if (before > FADE_S && t.t <= FADE_S) t.el.classList.add("out");
            if (t.t <= 0) this._remove(i);
        }

        // Timed hints (indexed walk: no iterator per frame).
        for (let i = this.hints.length - 1; i >= 0; i--) {
            const h = this.hints[i];
            if (h.ttl < 0) continue;
            h.ttl -= dt;
            if (h.ttl <= 0) this._dropHint(h.id);
        }
    }

    /** @param {string} token */
    setRealm(token) {
        this.banner.style.setProperty("--tb-accent", realmAccent(this.ctx, token));
        this.stack.style.setProperty("--tt-accent", realmAccent(this.ctx, token));
    }

    dispose() {
        for (let i = 0; i < this._offs.length; i++) this._offs[i]();
        for (const el of [this.banner, this.stack, this.hintsEl]) {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    }

    // ============================================================= events

    /** @param {any} p 'quest:complete' */
    _onQuest(p) {
        if (!p) return;
        const parts = [];
        if (p.xp > 0) parts.push("+" + p.xp + " XP");
        const rw = Array.isArray(p.rewards) ? p.rewards : [];
        for (let i = 0; i < rw.length; i++) {
            const r = rw[i];
            if (!r || r.kind === "xp") continue;
            parts.push((r.amount > 1 ? "+" + r.amount + " " : "") + (r.name || r.kind));
        }
        const b = {
            // The template's head ("Quest Complete — {title}" -> "Quest
            // Complete"): the banner sets the title on its own line.
            kick: tpl("questComplete", "Quest Complete — {title}", { title: "" }).replace(/\s*—\s*$/, ""),
            title: p.title || "",
            rew: parts.join("  ·  "),
            full: tpl("questComplete", "Quest Complete — {title}", { title: p.title || "" }),
        };
        this.stats.banners++;
        this.stats.lastBanner = b.full + (b.rew ? " | " + b.rew : "");
        if (this._bT > 0 || this._bq.length > 0) this._bq.push(b);
        else this._showBanner(b);
    }

    _showBanner(b) {
        this._bKick.textContent = b.kick;
        this._bTitle.textContent = b.title;
        this._bRew.textContent = b.rew;
        // Queued completions share the beat: 3 s alone, 2.2 s when stacked.
        this._bT = this._bq.length > 0 ? 2.2 : BANNER_S;
        if (this._show) {
            this.banner.classList.remove("show");
            void this.banner.offsetWidth;
            this.banner.classList.add("show");
        }
    }

    /** @param {any} p 'reward' */
    _onReward(p) {
        if (!p || !p.kind) return;
        switch (p.kind) {
            case "relic": {
                let id = p.id || null;
                const R = this.ctx.relics;
                if (!id && R && typeof R.relicFor === "function") {
                    const r = R.relicFor(p.realm, p.source, p.index);
                    id = r && r.id ? r.id : (typeof r === "string" ? r : null);
                }
                const info = id && STORY.relics ? STORY.relics[id] : null;
                this.push("relic", tpl("relicFound", "Relic Found"),
                    info ? info.name : (p.name || "A relic"), info ? info.effect : (p.desc || ""));
                break;
            }
            case "lore": {
                this.push("lore", tpl("loreFound", "Lore Shard Found"), p.name || "", "");
                const C = this.ctx.caches;
                if (C && typeof C.loreCollected === "function") {
                    const realm = C.realm || (this.ctx.getRealm ? this.ctx.getRealm() : "cold");
                    const total = STORY.lore && STORY.lore[realm] ? STORY.lore[realm].length : 12;
                    if (C.loreCollected(realm).length >= total) {
                        const ch = STORY.chronicle ? STORY.chronicle[realm] : null;
                        this.push("lore", tpl("chronicle", "Chronicle Unlocked"),
                            ch ? ch.title : realmLabel(this.ctx, realm), "Read it in the journal (J)");
                    }
                }
                break;
            }
            case "trail": {
                const tr = p.id && STORY.trails ? STORY.trails[p.id] : null;
                this.push("trail", "Wake Trail", tr ? tr.name : (p.name || "A new wake colour"),
                    "Wear it at any shrine's Shop");
                break;
            }
            case "reroll":
                this.push("reroll", "Boon Reroll", "+" + (p.amount || 1) + " token", "Change a boon away from a shrine");
                break;
            default:
                break;   // glass: 'glass:changed' is the single source; xp: the XP bar
        }
    }

    /** Coalesce Wake Glass gains. @param {number} n */
    _glass(n) {
        const top = this.live.length ? this.live[this.live.length - 1] : null;
        if (top && top.kind === "glass" && TOAST_S - top.t < GLASS_MERGE_S) {
            top.glass += n;
            top.t = TOAST_S;
            top.el.classList.remove("out");
            top.kick.textContent = tpl("wakeGlass", "+{amount} Wake Glass", { amount: top.glass });
            this.stats.lastToast = top.kick.textContent;
            return;
        }
        const t = this.push("glass", tpl("wakeGlass", "+{amount} Wake Glass", { amount: n }), "", "");
        t.glass = n;
    }

    /** @param {any} p 'trial:finished' */
    _onTrial(p) {
        if (!p || !(p.medal > 0)) return;
        const medals = STORY.ui && STORY.ui.medals ? STORY.ui.medals : ["Bronze", "Silver", "Gold"];
        const sub = fmtTime(p.time) + (p.newBest ? "  ·  new best" : "  ·  best " + fmtTime(p.best));
        this.push("trial " + MEDAL_CLASS[Math.min(3, p.medal)],
            tpl("trialMedal", "{medal} Medal — {name}", { medal: medals[p.medal - 1], name: p.name || p.id }),
            "", sub);
    }

    /** @param {any} p 'hint' */
    _onHint(p) {
        if (!p || !p.id || this._hintIndex(p.id) >= 0) return;
        const el = document.createElement("div");
        el.className = "dw-hint";
        el.textContent = p.text || "";
        this.hintsEl.appendChild(el);
        this.hints.push({ id: p.id, el, ttl: p.ttl > 0 ? p.ttl : -1 });
        this.stats.hints++;
    }

    /** @param {string} id */
    _dropHint(id) {
        const i = this._hintIndex(id);
        if (i < 0) return;
        const h = this.hints[i];
        if (h.el.parentNode) h.el.parentNode.removeChild(h.el);
        this.hints.splice(i, 1);
    }

    /** @param {string} id @returns {number} */
    _hintIndex(id) {
        for (let i = 0; i < this.hints.length; i++) if (this.hints[i].id === id) return i;
        return -1;
    }

    /** @param {number} i */
    _remove(i) {
        const t = this.live[i];
        if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
        this.live.splice(i, 1);
    }
}
