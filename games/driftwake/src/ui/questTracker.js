/**
 * QUEST TRACKER — top-right, "the free corner" (_spec/QUEST_DESIGN.md §7):
 * the tracked main step's title + tracker text + the live distance to the
 * waypoint, the level-floor line when a Warden step is under-level (§2), and
 * up to two smaller side lines below (a running Wake Trial, a live bounty,
 * the realm's relic caches).
 *
 * ALSO THE OWNER OF "WHERE AM I GOING". The quest engine emits its waypoint
 * ('quest:waypoint'); the world map can MARK a shrine ('waypoint:pin', lane U
 * addition in quests/events.js). `target` is the EFFECTIVE one — the pin while
 * it stands, else the quest's — preallocated and mutated in place, and it is
 * what the compass tick (ui/compass.js), the minimap pip (ui/minimap.js) and
 * this tracker's distance read. The beacon (world/beacon.js) listens to
 * 'quest:waypoint' on its own; while a pin stands this module re-points it at
 * the pin (an x/z compare per frame, `beacon.set` only on a mismatch). A pin
 * clears when the rider comes within BEACON_NEAR (15 m) of it.
 *
 * Same identity and visibility contract as ui/hud.js: frost glass, Segoe UI,
 * shown only under pointer lock with no shell menu, no F1/F3 panel and no
 * lane-U panel up. DOM is written on EVENTS (a step, a waypoint, a side fact)
 * and the distance readout only when its rounded metre changes; `update()`
 * allocates nothing.
 *
 * MODULE SHAPE: constructor(ctx), update(dt), setRealm(token). The visibility
 * poll runs at any dt (a paused frame must hide the HUD under the pause menu,
 * exactly as hud.js does); everything else is a no-op at dt === 0.
 * ctx: bus, input, overlay, character, quests (optional: its last `tracked`
 * and `waypoint` seed the panel), beacon, caches, trials, bounties, realms,
 * getRealm. Self-registers as `ctx.questTracker`.
 */

import { input as coreInput } from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";

/** QUEST §7a: the beacon fades inside 15 m — a pin is "reached" there too. */
export const PIN_REACH = 15;

const REALMS = ["cold", "sand", "ash"];

const CSS = `
#dw-tracker {
  position: fixed; right: 18px; top: 16px;
  width: 292px; box-sizing: border-box;
  z-index: 55; pointer-events: none;
  padding: 10px 13px 11px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.58), rgba(8, 13, 19, 0.70));
  border: 1px solid rgba(160, 205, 235, 0.24);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 12px rgba(120, 180, 220, 0.05);
  font-family: "Segoe UI", system-ui, sans-serif;
  color: rgba(240, 248, 253, 0.94);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  opacity: 0; transition: opacity 200ms ease;
  --qt-accent: #a8dcf5;
}
#dw-tracker.show { opacity: 0.95; }
#dw-tracker::after {
  content: ""; position: absolute; left: 10px; right: 10px; top: 1px; height: 1px;
  background: rgba(230, 245, 255, 0.24); border-radius: 1px;
}
#dw-tracker .qt-kicker {
  font: 600 9.5px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--qt-accent);
}
#dw-tracker .qt-title {
  font: 600 15px/1.25 "Segoe UI", system-ui, sans-serif;
  margin-top: 5px; letter-spacing: 0.01em;
}
#dw-tracker.flash .qt-title { animation: qt-flash 900ms ease-out; }
@keyframes qt-flash {
  0% { color: #ffffff; text-shadow: 0 0 12px rgba(190, 235, 255, 0.9), 0 1px 2px #000; }
  100% { color: rgba(240, 248, 253, 0.94); }
}
#dw-tracker .qt-text {
  font: 500 12px/1.35 "Segoe UI", system-ui, sans-serif;
  color: rgba(214, 234, 246, 0.86); margin-top: 3px;
}
#dw-tracker .qt-under {
  display: none; margin-top: 5px;
  font: 600 11.5px/1.3 "Segoe UI", system-ui, sans-serif; color: #ffcf8a;
}
#dw-tracker.under .qt-under { display: block; }
#dw-tracker .qt-progrow { display: none; align-items: center; gap: 9px; margin-top: 7px; }
#dw-tracker.prog .qt-progrow { display: flex; }
#dw-tracker .qt-prog {
  flex: 1; position: relative; height: 4px;
  border-radius: 2px; overflow: hidden;
  background: rgba(6, 10, 15, 0.7); border: 1px solid rgba(160, 205, 235, 0.2);
}
#dw-tracker .qt-fill {
  position: absolute; inset: 0; transform-origin: left center; transform: scaleX(0);
  background: linear-gradient(90deg, #6cc3ea, var(--qt-accent));
  transition: transform 220ms ease-out;
}
#dw-tracker .qt-meta {
  display: flex; justify-content: space-between; gap: 8px; margin-top: 6px;
  font: 600 11px/1.2 "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.78); font-variant-numeric: tabular-nums;
}
#dw-tracker .qt-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
#dw-tracker .qt-label b { color: var(--qt-accent); font-weight: 700; margin-right: 5px; }
#dw-tracker .qt-dist { flex: none; color: rgba(240, 248, 253, 0.94); }
#dw-tracker .qt-count { flex: none; font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
  color: rgba(214, 234, 246, 0.86); font-variant-numeric: tabular-nums; }
#dw-tracker .qt-meta:empty, #dw-tracker .qt-meta.none { display: none; }
#dw-tracker .qt-side { margin-top: 8px; border-top: 1px solid rgba(160, 205, 235, 0.14); padding-top: 6px; }
#dw-tracker .qt-side:empty { display: none; }
#dw-tracker .qt-sl {
  font: 500 11px/1.35 "Segoe UI", system-ui, sans-serif; color: rgba(205, 228, 244, 0.8);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#dw-tracker .qt-sl b { font-weight: 700; color: rgba(240, 248, 253, 0.92); margin-right: 5px; }
@media (max-width: 1100px) { #dw-tracker { width: 252px; } }
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-tracker-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

/** Is the FFG shell absent (automation) or in play? */
export function shellPlaying() {
    const shell = globalThis.FFG ? globalThis.FFG.shell : null;
    return !shell || shell.phase === "playing";
}

/**
 * The play HUD's visibility rule (ui/hud.js) plus "no lane-U panel up".
 * Allocation-free. @param {any} input @param {any} overlay @returns {boolean}
 */
export function hudShown(input, overlay) {
    const inp = input || coreInput;
    return !!inp.locked && shellPlaying() && !(overlay && overlay.visible) && !inp.panel;
}

/** "The Rime Shelf" — realms.js row label, else the chronicle's.
 *  @param {any} ctx @param {string} t @returns {string} */
export function realmLabel(ctx, t) {
    const R = ctx && ctx.realms && ctx.realms.realm ? ctx.realms.realm(t) : null;
    if (R && R.label) return R.label;
    const c = STORY.chronicle ? STORY.chronicle[t] : null;
    return c ? c.title.replace(/^Chronicle of /, "") : t;
}

/** The realm's HUD accent (realms.js `accent.edge`). @param {any} ctx @param {string} t */
export function realmAccent(ctx, t) {
    const R = ctx && ctx.realms && ctx.realms.realm ? ctx.realms.realm(t) : null;
    if (R && R.accent && R.accent.edge) return R.accent.edge;
    return t === "sand" ? "#ecc98a" : t === "ash" ? "#f2a36b" : "#a8dcf5";
}

/** Fill a "{token}" template. @param {string} s @param {Record<string, any>} v */
export function fill(s, v) {
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
}

export class QuestTracker {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;
        this.realm = REALMS.indexOf(ctx.getRealm ? ctx.getRealm() : "cold") >= 0
            ? ctx.getRealm() : "cold";

        /**
         * The EFFECTIVE waypoint (pin over quest), mutated in place — read by
         * the compass, the minimap and this panel. `valid` false = none.
         */
        this.target = { valid: false, x: 0, z: 0, realm: "", label: "", kind: "", pinned: false, id: "" };
        /** The quest engine's last waypoint payload (or null). */
        this.questWp = null;
        /** The map pin, preallocated: on/x/z/realm/label/id. */
        this.pin = { on: false, x: 0, z: 0, realm: "", label: "", id: "" };
        /** The last 'quest:step' payload. */
        this.step = null;
        /** Stats for probes. */
        this.stats = { steps: 0, waypoints: 0, pins: 0, pinReached: 0, distWrites: 0, sideBuilds: 0 };

        // Side facts (event-fed).
        this._trial = null;            // {id, name, gate, of}
        /** Live bounties in this realm: id -> {name, place}. */
        this._bounties = new Map();
        this._sideDirty = true;

        // ------------------------------------------------------------ DOM
        const el = document.createElement("div");
        el.id = "dw-tracker";
        el.innerHTML =
            '<div class="qt-kicker"></div><div class="qt-title"></div>' +
            '<div class="qt-text"></div><div class="qt-under"></div>' +
            '<div class="qt-progrow"><div class="qt-prog"><div class="qt-fill"></div></div>' +
            '<span class="qt-count"></span></div>' +
            '<div class="qt-meta"><span class="qt-label"></span>' +
            '<span class="qt-dist"></span></div><div class="qt-side"></div>';
        document.body.appendChild(el);
        this.el = el;
        this._kicker = el.querySelector(".qt-kicker");
        this._title = el.querySelector(".qt-title");
        this._text = el.querySelector(".qt-text");
        this._under = el.querySelector(".qt-under");
        this._fill = el.querySelector(".qt-fill");
        this._label = el.querySelector(".qt-label");
        this._meta = el.querySelector(".qt-meta");
        this._count = el.querySelector(".qt-count");
        this._dist = el.querySelector(".qt-dist");
        this._side = el.querySelector(".qt-side");
        this._show = false;
        /** Last written whole metre (-1 = blank). */
        this._m = -2;
        this._flashT = 0;
        el.style.setProperty("--qt-accent", realmAccent(ctx, this.realm));

        // ------------------------------------------------------------ bus
        const B = this.bus;
        this._offs = [
            B.on("quest:step", (p) => this._onStep(p)),
            B.on("quest:waypoint", (p) => this._onQuestWp(p)),
            B.on("waypoint:pin", (p) => this._onPin(p)),
            B.on("realm:entered", (p) => { if (p && p.realm) this.setRealm(p.realm); }),
            B.on("trial:started", (p) => {
                if (!p) return;
                this._trial = { id: p.id, name: p.name || p.id, gate: 1, of: p.gates || 0 };
                this._sideDirty = true;
            }),
            B.on("trial:gate", (p) => {
                if (!p || !this._trial || p.id !== this._trial.id) return;
                this._trial.gate = p.gate; this._trial.of = p.of;
                this._sideDirty = true;
            }),
            B.on("trial:finished", () => { this._trial = null; this._sideDirty = true; }),
            B.on("trial:failed", () => { this._trial = null; this._sideDirty = true; }),
            B.on("bounty:revealed", (p) => {
                if (!p || !p.id) return;
                const list = ctx.bounties && ctx.bounties.list ? ctx.bounties.list(p.realm) : null;
                let place = "";
                if (list) for (let i = 0; i < list.length; i++) if (list[i].id === p.id) place = list[i].place;
                this._bounties.set(p.id, { name: p.name || p.id, place });
                this._sideDirty = true;
            }),
            B.on("bounty:killed", (p) => {
                if (p && this._bounties.delete(p.id)) this._sideDirty = true;
            }),
            B.on("cache:opened", () => { this._sideDirty = true; }),
        ];
        ctx.questTracker = this;

        // Seed from an engine constructed before us.
        const Q = ctx.quests;
        if (Q && Q.tracked) this._onStep(Q.tracked);
        if (Q && Q.waypoint) this._onQuestWp(Q.waypoint);
        else this._resolve();
    }

    // ================================================================ frame

    /**
     * Visibility (any dt) + distance / pin bookkeeping (dt > 0). Allocates
     * only when a shown string changes.
     * @param {number} dt
     */
    update(dt) {
        const show = hudShown(this.input, this.ctx.overlay) && this.step !== null;
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }
        if (dt === 0) return;

        if (this._flashT > 0) {
            this._flashT -= dt;
            if (this._flashT <= 0) this.el.classList.remove("flash");
        }
        if (this._sideDirty) this._buildSide();

        const t = this.target;
        const c = this.ctx.character;
        let m = -1;
        if (t.valid && c && t.realm === this.realm) {
            const dx = t.x - c.position.x, dz = t.z - c.position.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            m = Math.round(d);
            // A pin is reached at the beacon's own fade radius.
            if (t.pinned && d < PIN_REACH) {
                this.stats.pinReached++;
                this.bus.emit("waypoint:pin", null);
                return;
            }
        }
        if (m !== this._m) {
            this._m = m;
            this.stats.distWrites++;
            this._dist.textContent = m >= 0 ? m + " m" : "";
        }
        // Hold the beacon on the pin (order-independent of the bus).
        const P = this.pin;
        const bc = this.ctx.beacon;
        if (P.on && bc && bc.target && (!bc.target.on || bc.target.x !== P.x || bc.target.z !== P.z)) {
            bc.set(P);
        }
    }

    /** @param {string} token */
    setRealm(token) {
        if (REALMS.indexOf(token) < 0) return;
        this.realm = token;
        this.el.style.setProperty("--qt-accent", realmAccent(this.ctx, token));
        this._bounties.clear();
        this._trial = null;
        this._sideDirty = true;
        this._m = -2;
        this._writeKicker();
    }

    /** Unmark the map pin (the journal / map "clear" action). */
    clearPin() {
        if (this.pin.on) this.bus.emit("waypoint:pin", null);
    }

    dispose() {
        for (let i = 0; i < this._offs.length; i++) this._offs[i]();
        this._offs.length = 0;
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }

    // ============================================================= events

    /** @param {any} p 'quest:step' */
    _onStep(p) {
        if (!p) return;
        const prevId = this.step ? this.step.stepId : null;
        this.step = p;
        this.stats.steps++;
        const st = p.stepId && STORY.steps ? STORY.steps[p.stepId] : null;
        this._title.textContent = p.title || (st ? st.title : "");
        // Under-level: the engine swaps the tracker for the floor line; the
        // objective itself stays on screen, the floor line goes under it.
        const under = p.underLevel > 0;
        this._text.textContent = under && st ? st.tracker : (p.tracker || "");
        this._under.textContent = under ? p.tracker : "";
        this.el.classList.toggle("under", under);
        const pr = p.progress;
        const prog = !!(pr && pr.need > 0);
        this.el.classList.toggle("prog", prog);
        if (prog) {
            const f = Math.max(0, Math.min(1, pr.have / pr.need));
            this._fill.style.transform = "scaleX(" + f.toFixed(3) + ")";
            this._count.textContent = pr.have + " / " + pr.need;
        } else {
            this._count.textContent = "";
        }
        this._writeKicker();
        if (prevId !== p.stepId && prevId !== null) {
            this.el.classList.remove("flash");
            void this.el.offsetWidth;
            this.el.classList.add("flash");
            this._flashT = 0.9;
        }
    }

    _writeKicker() {
        const p = this.step;
        if (!p) { this._kicker.textContent = ""; return; }
        if (!p.realm) {
            this._kicker.textContent = STORY.ending ? STORY.ending.playerTitle : "";
            return;
        }
        this._kicker.textContent = realmLabel(this.ctx, p.realm) +
            (p.total > 0 ? "  ·  " + (p.index + 1) + " / " + p.total : "");
    }

    /** @param {any} p 'quest:waypoint' payload or null */
    _onQuestWp(p) {
        this.questWp = p || null;
        this.stats.waypoints++;
        this._resolve();
    }

    /** @param {any} p 'waypoint:pin' payload or null */
    _onPin(p) {
        const P = this.pin;
        if (p && Number.isFinite(+p.x) && Number.isFinite(+p.z)) {
            P.on = true; P.x = +p.x; P.z = +p.z;
            P.realm = p.realm || this.realm; P.label = p.label || ""; P.id = p.id || "";
            this.stats.pins++;
            if (this.ctx.beacon) this.ctx.beacon.set(P);
        } else {
            if (!P.on) return;
            P.on = false;
            // Hand the beacon back to the quest's own target.
            if (this.ctx.beacon) this.ctx.beacon.set(this.questWp);
        }
        this._resolve();
    }

    /** Recompute the effective target and its label (event-rate). */
    _resolve() {
        const t = this.target;
        const P = this.pin;
        const q = this.questWp;
        if (P.on) {
            t.valid = true; t.x = P.x; t.z = P.z; t.realm = P.realm;
            t.label = P.label; t.kind = "pin"; t.pinned = true; t.id = P.id;
        } else if (q && Number.isFinite(+q.x)) {
            t.valid = true; t.x = +q.x; t.z = +q.z; t.realm = q.realm || this.realm;
            t.label = q.label || ""; t.kind = q.kind || ""; t.pinned = false; t.id = "";
        } else {
            t.valid = false; t.pinned = false; t.label = ""; t.kind = ""; t.id = "";
        }
        this._label.innerHTML = "";
        this._meta.classList.toggle("none", !t.valid);
        if (t.valid) {
            if (t.pinned) {
                const b = document.createElement("b");
                b.textContent = "Marked";
                this._label.appendChild(b);
            }
            this._label.appendChild(document.createTextNode(t.label));
        }
        this._m = -2;   // force the distance write
    }

    /** Up to two side lines: running trial, live bounty, realm caches. */
    _buildSide() {
        this._sideDirty = false;
        this.stats.sideBuilds++;
        const lines = [];
        const tr = this._trial;
        if (tr) {
            lines.push(["Wake Trial", tr.name + (tr.of ? "  ·  gate " + tr.gate + " / " + tr.of : "")]);
        }
        if (lines.length < 2 && this._bounties.size > 0) {
            for (const v of this._bounties.values()) {
                lines.push(["Bounty", v.name + (v.place ? "  ·  near the " + v.place : "")]);
                break;
            }
        }
        const C = this.ctx.caches;
        if (lines.length < 2 && C && typeof C.counts === "function") {
            const n = C.counts(this.realm);
            const tpl = STORY.ui && STORY.ui.side ? STORY.ui.side.caches : "Relic caches found {found}/{total}";
            lines.push(["", fill(tpl, { found: n.found, total: n.total })]);
        }
        this._side.innerHTML = "";
        for (let i = 0; i < lines.length && i < 2; i++) {
            const d = document.createElement("div");
            d.className = "qt-sl";
            if (lines[i][0]) {
                const b = document.createElement("b");
                b.textContent = lines[i][0];
                d.appendChild(b);
            }
            d.appendChild(document.createTextNode(lines[i][1]));
            this._side.appendChild(d);
        }
    }
}
