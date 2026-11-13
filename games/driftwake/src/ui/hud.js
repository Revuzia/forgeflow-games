/**
 * Health + mana — top-left, the first piece of the combat HUD (owner
 * 2026-08-05: "prepare this game for BATTLE").
 *
 * Reads `controller.health / healthMax / mana / manaMax` every frame and
 * writes two bar fills via scaleX transforms — no layout, no text churn,
 * allocation-free steady frames, same polling contract as `ui/crosshair.js`.
 * Colour language: health is EMBER (the character's trim), mana is FROST
 * (the realm). A denied cast (not enough mana) flashes the mana bar via
 * `flashMana()`, wired from the spell system's cost gate.
 *
 * '#hud' is chrome-hidden by the harness (`_harness/shoot.py`), and like the
 * rest of the play HUD it shows only under pointer lock.
 *
 * WAKE GLASS (lane U, _spec/QUEST_DESIGN.md §4.3 "the HUD shows current Wake
 * Glass beside mana"): a small pill directly under the mana bar, inside
 * '#hud' so it shares the HUD's show/hide and never drifts from the bars.
 * Hidden until `attach({ shop, bus })` hands it the wallet; written on the
 * 'glass:changed' EVENT only (a bump on gains), never polled per frame.
 * (Lane R's `GlassCounter` in ui/shrineMenu.js is the same readout as a
 * standalone element: the integrator constructs ONE of the two.)
 */

import { input } from "../core/input.js";

const CSS = `
#hud {
  position: fixed; left: 18px; top: 16px;
  width: 276px;
  z-index: 55;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
#hud.show { opacity: 0.95; }

.hud-bar {
  position: relative;
  height: 19px;
  border-radius: 9px;
  margin-bottom: 8px;
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45), inset 0 1px 3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.hud-fill {
  position: absolute; inset: 1px;
  border-radius: 8px;
  transform-origin: left center;
  transition: transform 120ms ease-out;
}
#hud .hud-health .hud-fill {
  background: linear-gradient(180deg, #e89a66, #b35c33 60%, #8a4426);
  box-shadow: inset 0 1px 2px rgba(255, 220, 190, 0.35);
}
#hud .hud-mana .hud-fill {
  background: linear-gradient(180deg, #a8dcf5, #5d9fc7 60%, #3d7396);
  box-shadow: inset 0 1px 2px rgba(220, 245, 255, 0.4);
}
.hud-val {
  position: absolute; right: 9px; top: 50%;
  transform: translateY(-50%);
  font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.03em;
  color: rgba(240, 248, 253, 0.94);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
}

/* A thin frost sheen along the top of each bar sells the glass. */
.hud-bar::after {
  content: "";
  position: absolute; left: 6px; right: 6px; top: 1px; height: 1px;
  background: rgba(230, 245, 255, 0.28);
  border-radius: 1px;
}
.hud-glass {
  display: none; align-items: center; gap: 6px;
  width: max-content; height: 20px; box-sizing: border-box;
  padding: 0 10px 0 8px; margin-top: -1px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
  font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.03em;
  color: rgba(240, 248, 253, 0.94); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  font-variant-numeric: tabular-nums;
}
#hud.glass .hud-glass { display: flex; }
.hud-glass svg {
  width: 11px; height: 13px; fill: rgba(168, 220, 245, 0.18);
  stroke: var(--hud-accent, #a8dcf5); stroke-width: 1.5;
}
.hud-glass .hud-glass-l { color: rgba(205, 228, 244, 0.6); font-weight: 500; }
@keyframes hud-glass-bump { 0% { transform: scale(1.14); border-color: rgba(234, 250, 255, 0.9); } 100% { transform: scale(1); } }
.hud-glass.bump { animation: hud-glass-bump 280ms ease-out; transform-origin: left center; }
@keyframes hud-deny {
  0%, 100% { border-color: rgba(160, 205, 235, 0.26); }
  30%      { border-color: rgba(255, 120, 90, 0.9);
             box-shadow: 0 0 10px rgba(255, 120, 90, 0.4); }
}
#hud .hud-mana.deny { animation: hud-deny 320ms ease; }
`;

export class Hud {
    /** @param {import("../character/controller.js").CharacterController} controller */
    constructor(controller) {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "hud";
        el.innerHTML =
            '<div class="hud-bar hud-health"><div class="hud-fill"></div>' +
            '<span class="hud-val"></span></div>' +
            '<div class="hud-bar hud-mana"><div class="hud-fill"></div>' +
            '<span class="hud-val"></span></div>' +
            // Lane U: the Wake Glass pill (hidden until a shop is attached).
            '<div class="hud-glass"><svg viewBox="0 0 12 14" aria-hidden="true">' +
            '<path d="M6 1l4.4 2.6v6.8L6 13 1.6 10.4V3.6z"/>' +
            '<path d="M1.6 3.6L6 6.2l4.4-2.6M6 6.2V13" fill="none"/></svg>' +
            '<span class="hud-glass-n">0</span><span class="hud-glass-l">Wake Glass</span></div>';
        document.body.appendChild(el);
        this.el = el;
        this.controller = controller;

        this._healthFill = el.querySelector(".hud-health .hud-fill");
        this._manaFill = el.querySelector(".hud-mana .hud-fill");
        this._manaBar = el.querySelector(".hud-mana");
        this._healthVal = el.querySelector(".hud-health .hud-val");
        this._manaVal = el.querySelector(".hud-mana .hud-val");
        this._hTxt = "";
        this._mTxt = "";

        this.overlay = null;
        this._glassEl = el.querySelector(".hud-glass");
        this._glassN = el.querySelector(".hud-glass-n");
        /** @type {any} lane R's Shop (ctx.shop) once attached. */
        this.shop = null;
        this._glass = -1;
        this._offGlass = null;
        this._show = false;
        this._h = -1;
        this._m = -1;
        this._denyUntil = 0;
    }

    /**
     * @param {{ overlay?: any, shop?: any, bus?: any, accent?: string }} refs
     *   `shop` + `bus` switch the Wake Glass pill on (lane U).
     * @returns {void}
     */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
        if (refs.accent) this.el.style.setProperty("--hud-accent", refs.accent);
        if (refs.shop) {
            this.shop = refs.shop;
            this.el.classList.add("glass");
            this._writeGlass(false);
            if (refs.bus && !this._offGlass) {
                this._offGlass = refs.bus.on("glass:changed", (p) => {
                    this._writeGlass(!!(p && p.delta > 0));
                });
            }
        }
    }

    /** The Wake Glass readout, written on the event only.
     *  @param {boolean} bump @returns {void} */
    _writeGlass(bump) {
        const n = this.shop ? this.shop.glass | 0 : 0;
        if (n !== this._glass) {
            this._glass = n;
            this._glassN.textContent = String(n);
        }
        if (bump) {
            this._glassEl.classList.remove("bump");
            void this._glassEl.offsetWidth;
            this._glassEl.classList.add("bump");
        }
    }

    /** Not-enough-mana feedback; called from the spell system's gate. */
    flashMana() {
        this._denyUntil = performance.now() + 320;
        this._manaBar.classList.remove("deny");
        void this._manaBar.offsetWidth;
        this._manaBar.classList.add("deny");
    }

    /** One frame. Pure poll; allocates nothing. @returns {void} */
    update() {
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        const panelUp = !!(this.overlay && this.overlay.visible);
        const show = input.locked && !shellUp && !panelUp;
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }

        const c = this.controller;
        const h = Math.max(0, Math.min(1, c.health / c.healthMax));
        if (h !== this._h) {
            this._h = h;
            this._healthFill.style.transform = `scaleX(${h.toFixed(4)})`;
        }
        const m = Math.max(0, Math.min(1, c.mana / c.manaMax));
        if (m !== this._m) {
            this._m = m;
            this._manaFill.style.transform = `scaleX(${m.toFixed(4)})`;
        }
        // Numeric readouts, written only when the ROUNDED value moves.
        const hTxt = `${Math.round(c.health)} / ${c.healthMax}`;
        if (hTxt !== this._hTxt) {
            this._hTxt = hTxt;
            this._healthVal.textContent = hTxt;
        }
        const mTxt = `${Math.round(c.mana)} / ${c.manaMax}`;
        if (mTxt !== this._mTxt) {
            this._mTxt = mTxt;
            this._manaVal.textContent = mTxt;
        }
        // Wake Glass: the event writes it; this integer compare catches a
        // wallet restored by a save load / NEW RUN that emitted no event.
        if (this.shop !== null && (this.shop.glass | 0) !== this._glass) this._writeGlass(false);
        if (this._denyUntil && performance.now() >= this._denyUntil) {
            this._denyUntil = 0;
            this._manaBar.classList.remove("deny");
        }
    }
}
