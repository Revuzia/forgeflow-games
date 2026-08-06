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
            '<span class="hud-val"></span></div>';
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
        this._show = false;
        this._h = -1;
        this._m = -1;
        this._denyUntil = 0;
    }

    /** @param {{ overlay?: any }} refs @returns {void} */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
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
        if (this._denyUntil && performance.now() >= this._denyUntil) {
            this._denyUntil = 0;
            this._manaBar.classList.remove("deny");
        }
    }
}
