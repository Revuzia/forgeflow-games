/**
 * The boon pick — QUEST_DESIGN §4.1 / §7: one of the only two modals in the
 * game (the other is ui/shrineMenu.js). Two cards, pick one; the game is
 * paused while it is up. Plus the Driftmark TOAST (§4.4), which is NOT a
 * modal: a one-click, three-chip strip that never pauses.
 *
 * Same construction rules and identity as `ui/hud.js` / `ui/spellbar.js`:
 * DOM + CSS only, nothing in the render path, frost-glass panels (the
 * rgba(14,22,30) → rgba(8,13,19) gradient, the rgba(160,205,235,.26) hairline,
 * the top sheen, Segoe UI), accent tinted per realm. DOM is written on EVENTS
 * (an offer, a key, a click) — `update(dt)` only runs the open delay.
 *
 * THE PAUSE PATTERN (QUEST §7, main.js onPause/onResume): opening sets
 * `S.freezeTime = true` and releases pointer lock; closing restores the
 * freeze state it found and asks for the lock back. Shared by both modals
 * through `modalOpen` / `modalClose` (a depth counter, so the shrine menu
 * opening a pick never double-restores). `anyModalOpen()` is exported for
 * main.js's `pointerlockchange` → `shell.pause()` handler, which must skip
 * the pause while a reward modal owns the release (see the lane report).
 *
 * KEYS while a modal is open are taken in the CAPTURE phase on window and
 * stopped, so they never reach `core/input.js` (a "1" here must not cast the
 * Frost Arc) or the shell's Escape. Key-UPs are left alone so input.js can
 * clear anything held when the modal opened. When closed, nothing listens.
 *
 *   pick:   1 / 2, ← → (A D) select · Enter / Space / E confirm ·
 *           Esc = decide later (the offer stays pending; take it at any
 *           activated shrine's Boons page — a pick is never lost)
 *   respec: `openRespec()` — the field swap that costs a reroll token
 *           (boons.js header), for the journal / pause surfaces
 *
 * EVENTS: consumes 'boon:offer' (opens 1.5 s of GAME time later, so the
 * kill's hit-stop and death land first; never over another modal or a shell
 * pause), 'ui:open' {panel:'boon'}; 'driftmark:offer' for the toast. Emits
 * 'ui:open' / 'ui:close' {panel:'boon'}.
 *
 * MODULE SHAPE: constructor(ctx) (after Boons), update(dt), setRealm(token).
 */

import { STORY } from "../quests/storyText.js";
import { PAIR_KEYS, PAIR_LABEL } from "../progression/boons.js";

/** Seconds of game time between the kill and the pick screen. */
const OPEN_DELAY = 1.5;
/** How long the Driftmark toast stays up, s of wall time, when ignored. */
const TOAST_MS = 14000;

/** Realm accent (cold = the HUD's own frost accent). */
const ACCENT = { cold: "#9fd8f5", sand: "#ecc98a", ash: "#f2a36b" };

// ---------------------------------------------------------------------------
// Shared: CSS (once) and the pause helpers
// ---------------------------------------------------------------------------

const CSS = `
.dwr-modal {
  position: fixed; inset: 0; z-index: 90;
  display: none; align-items: center; justify-content: center;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: rgba(240, 248, 253, 0.94);
  --dwr-accent: #9fd8f5;
}
.dwr-modal.open { display: flex; animation: dwr-in 180ms ease-out; }
@keyframes dwr-in { from { opacity: 0; } to { opacity: 1; } }
.dwr-scrim {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(6, 12, 20, 0.30), rgba(4, 8, 14, 0.80));
}
.dwr-panel {
  position: relative;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.82), rgba(8, 13, 19, 0.90));
  border: 1px solid rgba(160, 205, 235, 0.30);
  box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55), inset 0 0 26px rgba(120, 180, 220, 0.06);
  padding: 22px 26px 18px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
}
.dwr-panel::after {
  content: ""; position: absolute; left: 14px; right: 14px; top: 1px; height: 1px;
  background: rgba(230, 245, 255, 0.28); border-radius: 1px;
}
.dwr-kicker {
  font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--dwr-accent);
}
.dwr-title {
  font: 600 22px/1.25 "Segoe UI", system-ui, sans-serif;
  margin: 7px 0 16px; letter-spacing: 0.01em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.dwr-foot {
  margin-top: 14px; text-align: center;
  font: 500 11px/1.4 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.04em; color: rgba(205, 228, 244, 0.62);
}
.dwr-cards { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.dwr-card {
  position: relative; width: 262px; min-height: 196px;
  box-sizing: border-box; padding: 18px 18px 16px; text-align: left;
  border-radius: 10px; cursor: pointer; color: inherit; font: inherit;
  background: linear-gradient(180deg, rgba(20, 32, 44, 0.74), rgba(10, 16, 24, 0.84));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 12px rgba(120, 180, 220, 0.05);
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}
.dwr-card.sel {
  border-color: var(--dwr-accent);
  transform: translateY(-3px);
  box-shadow: 0 0 20px rgba(160, 225, 255, 0.30), inset 0 0 16px rgba(160, 225, 255, 0.10);
}
.dwr-cname { font: 600 19px/1.2 "Segoe UI", system-ui, sans-serif; }
.dwr-ceff {
  font: 600 14px/1.35 "Segoe UI", system-ui, sans-serif;
  color: var(--dwr-accent); margin: 10px 0 12px;
}
.dwr-cflav {
  font: italic 400 12.5px/1.5 "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.72);
}
.dwr-key {
  position: absolute; right: 10px; top: 9px;
  font: 700 10px/1 "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.85);
  border: 1px solid rgba(160, 205, 235, 0.35); border-radius: 4px; padding: 3px 6px;
}
.dwr-rows { display: flex; flex-direction: column; gap: 10px; min-width: 520px; }
.dwr-row { display: flex; align-items: center; gap: 10px; }
.dwr-rowlabel {
  width: 150px; flex: none;
  font: 600 11px/1.3 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase; color: rgba(205, 228, 244, 0.7);
}
.dwr-chip {
  flex: 1; min-width: 0; box-sizing: border-box; cursor: pointer;
  padding: 8px 11px; border-radius: 8px; text-align: left; color: inherit; font: inherit;
  background: linear-gradient(180deg, rgba(20, 32, 44, 0.62), rgba(10, 16, 24, 0.74));
  border: 1px solid rgba(160, 205, 235, 0.22);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.dwr-chip b { display: block; font: 600 13px/1.25 "Segoe UI", system-ui, sans-serif; }
.dwr-chip i {
  display: block; font: 500 11.5px/1.35 "Segoe UI", system-ui, sans-serif;
  font-style: normal; color: rgba(205, 228, 244, 0.72); margin-top: 2px;
}
.dwr-chip.on { border-color: var(--dwr-accent); box-shadow: inset 0 0 12px rgba(160, 225, 255, 0.14); }
.dwr-chip.on b { color: var(--dwr-accent); }
.dwr-chip.dim { opacity: 0.42; cursor: default; }
.dwr-chip.focus, .dwr-card.focus, .dwr-btn.focus {
  outline: 1px solid rgba(234, 250, 255, 0.85); outline-offset: 2px;
}
.dwr-note {
  font: 500 12px/1.4 "Segoe UI", system-ui, sans-serif; color: rgba(205, 228, 244, 0.7);
}

/* The Driftmark toast — non-modal, above the XP bar. */
#dw-driftmark {
  position: fixed; left: 50%; bottom: 146px; transform: translate(-50%, 8px);
  z-index: 56; display: none; opacity: 0;
  font-family: "Segoe UI", system-ui, sans-serif; color: rgba(240, 248, 253, 0.94);
  padding: 10px 12px 11px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.80), rgba(8, 13, 19, 0.88));
  border: 1px solid rgba(160, 205, 235, 0.30);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  transition: opacity 220ms ease, transform 220ms ease;
  --dwr-accent: #9fd8f5;
}
#dw-driftmark.show { display: block; }
#dw-driftmark.in { opacity: 1; transform: translate(-50%, 0); }
#dw-driftmark .dwr-kicker { text-align: center; margin-bottom: 8px; }
#dw-driftmark .dwr-chips { display: flex; gap: 8px; }
#dw-driftmark .dwr-chip { flex: none; width: 150px; pointer-events: auto; }
#dw-driftmark .dwr-chip b span {
  display: inline-block; margin-right: 6px; padding: 1px 5px; border-radius: 3px;
  border: 1px solid rgba(160, 205, 235, 0.4); font-size: 10px;
}
`;

let _cssDone = false;
/** Inject the shared rewards CSS once. @returns {void} */
export function ensureRewardsCss() {
    if (_cssDone) return;
    _cssDone = true;
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.appendChild(s);
}

let _depth = 0;
let _freezeBefore = false;

/**
 * Enter the modal pause: freeze time, release the pointer. Nested calls
 * stack (only the outermost restores). @param {any} S @returns {void}
 */
export function modalOpen(S) {
    if (_depth++ === 0) {
        _freezeBefore = !!S.freezeTime;
        S.freezeTime = true;
        try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* none held */ }
    }
}

/** Leave the modal pause: restore the freeze state found, re-lock.
 *  @param {any} S @returns {void} */
export function modalClose(S) {
    if (_depth === 0) return;
    if (--_depth > 0) return;
    S.freezeTime = _freezeBefore;
    if (_freezeBefore) return;
    const cv = document.getElementById("view");
    if (!cv || document.pointerLockElement === cv) return;
    try {
        const p = /** @type {any} */ (cv.requestPointerLock());
        if (p && p.catch) p.catch(() => {});
    } catch (e) { /* no gesture: input.js re-locks on the next canvas click */ }
}

/** Is a reward modal holding the pause? (main.js pointerlockchange guard) */
export function anyModalOpen() {
    return _depth > 0;
}

/** Keys a modal never swallows (panels / browser function keys). */
function passThrough(code) {
    return code === "F1" || code === "F3" || code === "F5" || code === "F11" ||
        code === "F12" || code === "Backquote";
}

/** Realm token for the accent. @param {any} ctx @returns {string} */
function realmOf(ctx) {
    const g = ctx.getRealm;
    const t = typeof g === "function" ? g() : "cold";
    return ACCENT[t] ? t : "cold";
}

/**
 * The realm's own UI accent — `realms.js` row `accent.edge` (the shell /
 * HUD / crosshair accent), falling back to the table above.
 * @param {any} ctx @param {string} [token] @returns {string}
 */
export function accentOf(ctx, token) {
    const t = token || realmOf(ctx);
    const R = ctx.realms && ctx.realms.realm ? ctx.realms.realm(t) : null;
    return R && R.accent && R.accent.edge ? R.accent.edge : (ACCENT[t] || ACCENT.cold);
}

/** Minimal HTML escape for story strings. @param {any} s @returns {string} */
export function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// The boon pick modal
// ---------------------------------------------------------------------------

export class BoonPick {
    /** @param {any} ctx needs `boons` (ctx.boons), S, bus */
    constructor(ctx) {
        ensureRewardsCss();
        this.ctx = ctx;
        this.S = ctx.S;
        this.bus = ctx.bus || null;

        const el = document.createElement("div");
        el.id = "dw-boonpick";
        el.className = "dwr-modal";
        el.innerHTML =
            '<div class="dwr-scrim"></div>' +
            '<div class="dwr-panel"><div class="dwr-kicker"></div>' +
            '<div class="dwr-title"></div><div class="dwr-body"></div>' +
            '<div class="dwr-foot"></div></div>';
        document.body.appendChild(el);
        this.el = el;
        this._kicker = el.querySelector(".dwr-kicker");
        this._title = el.querySelector(".dwr-title");
        this._body = el.querySelector(".dwr-body");
        this._foot = el.querySelector(".dwr-foot");

        this.isOpen = false;
        /** "pick" | "respec" */
        this.mode = "pick";
        /** @type {string|null} the pair on screen (pick mode) */
        this.key = null;
        this.sel = 0;
        /** Offers waiting for the open delay: [key, bossName, secondsLeft]. */
        this._queue = [];
        /** Respec mode focus: [row, pick]. */
        this._rf = 0;

        this._onKey = (e) => this._key(e);
        el.addEventListener("click", (e) => this._click(e));
        el.addEventListener("mousemove", (e) => {
            const c = e.target && e.target.closest ? e.target.closest(".dwr-card") : null;
            if (c && this.mode === "pick") this._select(+c.dataset.pick);
        });

        if (this.bus) {
            this.bus.on("boon:offer", (p) => {
                if (!p || !p.bossKey) return;
                this._queue.push({ key: p.bossKey, boss: p.boss || null, t: OPEN_DELAY });
            });
            this.bus.on("ui:open", (p) => {
                if (!p || p.panel !== "boon" || this.isOpen) return;
                const b = this.ctx.boons;
                const k = p.bossKey || (b && b.pending.length ? b.pending[0] : null);
                if (k) this.open(k); else this.openRespec();
            });
        }
    }

    /**
     * Counts the open delay down on GAME time; never opens over another
     * modal, a shell menu, or the settings overlay.
     * @param {number} dt @returns {void}
     */
    update(dt) {
        if (dt === 0 || this.isOpen || this._queue.length === 0) return;
        const q = this._queue[0];
        q.t -= dt;
        if (q.t > 0) return;
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        if (anyModalOpen() || (shell && shell.phase !== "playing")) return;
        const ov = this.ctx.overlay;
        if (ov && ov.visible) return;
        this._queue.shift();
        const b = this.ctx.boons;
        if (b && b.stateOf(q.key) === "pending") this.open(q.key, q.boss);
    }

    /** @param {string} token */
    setRealm(token) { /* the accent is read at open */ }

    /**
     * Open the pick for a pending pair.
     * @param {string} key @param {string|null} [bossName] @returns {boolean}
     */
    open(key, bossName) {
        const b = this.ctx.boons;
        if (this.isOpen || !b || b.stateOf(key) !== "pending") return false;
        const pair = b.pair(key);
        if (!pair) return false;
        this.mode = "pick";
        this.key = key;
        this.sel = 0;
        this.el.style.setProperty("--dwr-accent", accentOf(this.ctx));
        this._kicker.textContent = "A Warden falls · " + (PAIR_LABEL[key] || key);
        this._title.textContent = (bossName ? bossName + " — " : "") + "choose a boon";
        this._body.innerHTML = '<div class="dwr-cards">' + pair.map((p, i) =>
            '<button class="dwr-card" data-pick="' + i + '">' +
            '<span class="dwr-key">' + (i + 1) + "</span>" +
            '<div class="dwr-cname">' + esc(p.name) + "</div>" +
            '<div class="dwr-ceff">' + esc(p.effect) + "</div>" +
            '<div class="dwr-cflav">' + esc(p.flavor) + "</div></button>"
        ).join("") + "</div>";
        this._foot.textContent =
            "1 / 2 or ← → to choose · Enter to take it · Esc to decide later at any shrine";
        this._cards = this._body.querySelectorAll(".dwr-card");
        this._select(0);
        this._show("boon");
        return true;
    }

    /**
     * The field respec — swap within an earned pair for one reroll token
     * (free at a shrine: use the shrine menu there). @returns {boolean}
     */
    openRespec() {
        const b = this.ctx.boons;
        if (this.isOpen || !b) return false;
        this.mode = "respec";
        this.key = null;
        this._rf = 0;
        this.el.style.setProperty("--dwr-accent", accentOf(this.ctx));
        this._kicker.textContent = "Boons";
        this._title.textContent = "Change a boon";
        this._renderRespec();
        this._show("boon");
        return true;
    }

    /** Close without choosing (Esc): an offer stays pending. */
    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.el.classList.remove("open");
        window.removeEventListener("keydown", this._onKey, true);
        modalClose(this.S);
        if (this.bus) this.bus.emit("ui:close", { panel: "boon" });
    }

    /** Take pick `i` of the pair on screen. @param {number} i */
    choose(i) {
        const b = this.ctx.boons;
        if (!this.isOpen || this.mode !== "pick" || !b) return false;
        const ok = b.choose(this.key, i);
        if (ok) this.close();
        return ok;
    }

    // ------------------------------------------------------------- internals

    _show(panel) {
        this.isOpen = true;
        this.el.classList.add("open");
        window.addEventListener("keydown", this._onKey, true);
        modalOpen(this.S);
        if (this.bus) this.bus.emit("ui:open", { panel });
    }

    /** @param {number} i */
    _select(i) {
        if (!this._cards) return;
        this.sel = i === 1 ? 1 : 0;
        for (let k = 0; k < this._cards.length; k++) {
            this._cards[k].classList.toggle("sel", k === this.sel);
        }
    }

    _renderRespec() {
        const b = this.ctx.boons;
        const shop = this.ctx.shop;
        const tokens = shop ? shop.rerolls : 0;
        let html = '<div class="dwr-rows">';
        let row = 0;
        for (let r = 0; r < PAIR_KEYS.length; r++) {
            const k = PAIR_KEYS[r];
            if (b.stateOf(k) !== "chosen") continue;
            const pair = b.pair(k);
            html += '<div class="dwr-row"><div class="dwr-rowlabel">' + esc(PAIR_LABEL[k]) + "</div>";
            for (let i = 0; i < 2; i++) {
                const on = b.picks[k] === i;
                html += '<button class="dwr-chip' + (on ? " on" : "") + '" data-act="respec:' +
                    k + ":" + i + '" data-row="' + row + '"><b>' + esc(pair[i].name) +
                    "</b><i>" + esc(pair[i].effect) + "</i></button>";
            }
            html += "</div>";
            row++;
        }
        if (row === 0) html += '<div class="dwr-note">No boons yet — each Warden you break offers one.</div>';
        html += "</div>";
        this._body.innerHTML = html;
        this._foot.textContent = "Reroll tokens: " + tokens +
            " · away from a shrine a swap costs one token (free at any activated shrine) · Esc to close";
        this._chips = this._body.querySelectorAll(".dwr-chip");
        this._focusChip(Math.min(this._rf, Math.max(0, this._chips.length - 1)));
    }

    /** @param {number} i */
    _focusChip(i) {
        if (!this._chips) return;
        this._rf = i;
        for (let k = 0; k < this._chips.length; k++) this._chips[k].classList.toggle("focus", k === i);
    }

    /** @param {string} act */
    _act(act) {
        const parts = act.split(":");
        if (parts[0] === "respec") {
            const r = this.ctx.boons.respec(parts[1], +parts[2], { atShrine: false });
            this._renderRespec();
            if (!r.ok && r.reason) this._foot.textContent = "Cannot swap: " + r.reason + ".";
        }
    }

    /** @param {MouseEvent} e */
    _click(e) {
        const t = /** @type {any} */ (e.target);
        if (!t || !t.closest) return;
        const card = t.closest(".dwr-card");
        if (card && this.mode === "pick") { this.choose(+card.dataset.pick); return; }
        const a = t.closest("[data-act]");
        if (a) { this._act(a.dataset.act); return; }
        if (t.classList && t.classList.contains("dwr-scrim") && this.mode === "respec") this.close();
    }

    /** @param {KeyboardEvent} e */
    _key(e) {
        if (!this.isOpen || passThrough(e.code)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        const c = e.code;
        if (c === "Escape" || c === "Backspace") { this.close(); return; }
        if (this.mode === "pick") {
            if (c === "Digit1" || c === "Numpad1") { this.choose(0); return; }
            if (c === "Digit2" || c === "Numpad2") { this.choose(1); return; }
            if (c === "ArrowLeft" || c === "KeyA") this._select(0);
            else if (c === "ArrowRight" || c === "KeyD") this._select(1);
            else if (c === "Enter" || c === "NumpadEnter" || c === "Space" || c === "KeyE") this.choose(this.sel);
            return;
        }
        const n = this._chips ? this._chips.length : 0;
        if (n === 0) return;
        if (c === "ArrowDown" || c === "KeyS") this._focusChip(Math.min(n - 1, this._rf + 2));
        else if (c === "ArrowUp" || c === "KeyW") this._focusChip(Math.max(0, this._rf - 2));
        else if (c === "ArrowRight" || c === "KeyD") this._focusChip(Math.min(n - 1, this._rf + 1));
        else if (c === "ArrowLeft" || c === "KeyA") this._focusChip(Math.max(0, this._rf - 1));
        else if (c === "Enter" || c === "NumpadEnter" || c === "Space" || c === "KeyE") {
            const a = this._chips[this._rf];
            if (a && a.dataset.act) this._act(a.dataset.act);
        }
    }
}

// ---------------------------------------------------------------------------
// The Driftmark toast (QUEST §4.4 — "a one-click toast, not a modal")
// ---------------------------------------------------------------------------

/** The toast's chip keys: free of every game bind (WASD, Space, Shift, Tab,
 *  E/J/M, digits 1-7, F-keys, Esc). */
const MARK_KEYS = { KeyZ: "dmg", KeyX: "hp", KeyC: "surf" };

export class DriftmarkToast {
    /** @param {any} ctx needs `mods` (ctx.mods), bus */
    constructor(ctx) {
        ensureRewardsCss();
        this.ctx = ctx;
        this.bus = ctx.bus || null;
        const P = STORY && STORY.driftmarks ? STORY.driftmarks.picks : null;
        const row = (k, key) => {
            const p = P ? P[k] : null;
            return '<button class="dwr-chip" data-mark="' + k + '"><b><span>' + key +
                "</span>" + esc(p ? p.name : k) + "</b><i>" + esc(p ? p.effect : "") + "</i></button>";
        };
        const el = document.createElement("div");
        el.id = "dw-driftmark";
        el.innerHTML = '<div class="dwr-kicker"></div><div class="dwr-chips">' +
            row("dmg", "Z") + row("hp", "X") + row("surf", "C") + "</div>";
        document.body.appendChild(el);
        this.el = el;
        this._kicker = el.querySelector(".dwr-kicker");
        this._surfChip = el.querySelector('[data-mark="surf"]');
        this.visible = false;
        this._hideAt = 0;
        this._timer = 0;
        this._onKey = (e) => {
            const k = MARK_KEYS[e.code];
            if (!k || !this.visible || anyModalOpen() || e.repeat) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.pick(k);
        };
        el.addEventListener("click", (e) => {
            const t = /** @type {any} */ (e.target);
            const b = t && t.closest ? t.closest("[data-mark]") : null;
            if (b) this.pick(b.dataset.mark);
        });
        if (this.bus) this.bus.on("driftmark:offer", () => this.show());
    }

    /** Show (or refresh) the toast while picks are pending. */
    show() {
        const m = this.ctx.mods;
        const n = m ? m.driftmarkPending() : 0;
        if (n <= 0) { this.hide(); return; }
        const base = STORY && STORY.driftmarks ? STORY.driftmarks.toast : "Driftmark earned. Choose one.";
        this._kicker.textContent = base + (n > 1 ? "  (" + n + " waiting)" : "");
        this._surfChip.classList.toggle("dim", !m.canPickSurf());
        this.el.style.setProperty("--dwr-accent", accentOf(this.ctx));
        if (!this.visible) {
            this.visible = true;
            this.el.classList.add("show");
            window.addEventListener("keydown", this._onKey, true);
            // next frame, so the transition runs from the hidden pose
            requestAnimationFrame(() => { if (this.visible) this.el.classList.add("in"); });
        }
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => this.hide(), TOAST_MS);
    }

    hide() {
        if (!this.visible) return;
        this.visible = false;
        this.el.classList.remove("in", "show");
        window.removeEventListener("keydown", this._onKey, true);
        if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
    }

    /** @param {"dmg"|"hp"|"surf"} kind @returns {boolean} */
    pick(kind) {
        const m = this.ctx.mods;
        const ok = !!(m && m.pickDriftmark(kind));
        if (ok) {
            if (m.driftmarkPending() > 0) this.show(); else this.hide();
        }
        return ok;
    }

    update(dt) { /* event-driven */ }
    setRealm(token) { /* accent read at show */ }
}
