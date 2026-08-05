/**
 * Centre-screen reticle.
 *
 * Spells aim along the camera rig's forward, so while the pointer is locked the
 * aim point IS the centre of the screen — a fixed centre reticle is exactly
 * correct, not an approximation. DOM + CSS only: zero GPU cost, nothing in the
 * render path.
 *
 * POLLED, NOT SUBSCRIBED. `update()` runs once per frame from `main.js` and
 * reads live state — `input.locked`, the overlay's `visible`, the shell's
 * `phase`, the spell system's held/active flags. Nothing allocates in that
 * path: every DOM write is gated behind a cached boolean, so a steady frame
 * costs a handful of property reads and no classList calls at all. The one
 * exception is the cast pulse, which restarts a CSS animation on the cast
 * EDGE (a keypress, not a frame), where a reflow is fine.
 *
 * States, all CSS classes on `#crosshair`:
 *   (none)   hidden — pointer not locked, shell menu/pause up, or a panel open
 *   .show    at rest while locked: dot + four hairline ticks, frost, dimmed
 *   .active  a spell is held or in flight: ticks spread, accent colour up
 *   .pulse   ~240 ms scale pulse, retriggered on every cast edge (keys 1-5)
 *
 * VISUAL PARITY: '#crosshair' is in the chrome-hider list in
 * `_harness/shoot.py` (BOOTSTRAP block), so it can never land in a comparison
 * shot. It is also hidden by construction under the harness: it shows only
 * while `input.locked` is true, and an automated page can never acquire
 * pointer lock — but the hider entry stays, because "cannot happen today" is
 * not a guarantee the next probe keeps.
 */

import { input } from "../core/input.js";

/** How long the cast pulse runs, ms. Matches the CSS animation duration. */
const PULSE_MS = 240;

const CSS = `
#crosshair {
  position: fixed; left: 50%; top: 50%;
  width: 0; height: 0;
  z-index: 60; /* over #hint (50), under #overlay (80) and #boot (100) */
  pointer-events: none;
  opacity: 0;
  transition: opacity 160ms ease;
}
#crosshair.show { opacity: 0.82; }
#crosshair.show.active { opacity: 1; }

/* The core: a small frost diamond. Gradient catches the ice identity; the
   dark halo keeps it readable on bright snow and in shadow alike. Centred
   with -px/2 margins off the 0x0 anchor for subpixel parity. */
#crosshair .ch-core {
  position: absolute; left: 0; top: 0;
  width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #f2f8ff, var(--frost, #c9e2f5));
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.9), 0 0 7px rgba(150, 210, 255, 0.35);
  transition: background 140ms ease, box-shadow 140ms ease;
}

/* Four ice shards, one element rotated into each cardinal, tips toward the
   centre. The rotate spins the shard about its own centre (on the anchor),
   the translateY pushes it out along the rotated axis — one transform pair
   serves all four, and the active spread only changes the push. */
#crosshair .ch-tick {
  position: absolute; left: 0; top: 0;
  width: 3px; height: 8px; margin: -4px 0 0 -1.5px;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  background: linear-gradient(180deg, var(--frost, #dbe6f2), rgba(219, 230, 242, 0.35));
  filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.85));
  transition: transform 140ms cubic-bezier(0.4, 0, 0.2, 1), background 140ms ease;
}
#crosshair .ch-n { transform: rotate(180deg) translateY(-9px); }
#crosshair .ch-e { transform: rotate(270deg) translateY(-9px); }
#crosshair .ch-s { transform: rotate(0deg)   translateY(-9px); }
#crosshair .ch-w { transform: rotate(90deg)  translateY(-9px); }

#crosshair.active .ch-n { transform: rotate(180deg) translateY(-12px); }
#crosshair.active .ch-e { transform: rotate(270deg) translateY(-12px); }
#crosshair.active .ch-s { transform: rotate(0deg)   translateY(-12px); }
#crosshair.active .ch-w { transform: rotate(90deg)  translateY(-12px); }

#crosshair.active .ch-core {
  background: linear-gradient(135deg, #eafaff, var(--accent, #9fd8f5));
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.9), 0 0 10px rgba(160, 225, 255, 0.65);
}
#crosshair.active .ch-tick {
  background: linear-gradient(180deg, var(--accent, #9fd8f5), rgba(159, 216, 245, 0.3));
}

/* The charge ring: two thin opposing arcs that fade in while a spell is
   live and SPIN while the ribbon is held — water gathering in the hand has
   a visible clock on screen. Border-arc trick: a circle with two transparent
   sides is two arcs, one element, no SVG. */
#crosshair .ch-ring {
  position: absolute; left: 0; top: 0;
  width: 26px; height: 26px; margin: -13px 0 0 -13px;
  border-radius: 50%;
  border: 1px solid transparent;
  border-top-color: rgba(174, 232, 255, 0.85);
  border-bottom-color: rgba(174, 232, 255, 0.55);
  filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.7));
  opacity: 0;
  transition: opacity 180ms ease;
}
#crosshair.active .ch-ring { opacity: 0.6; }
@keyframes ch-spin { to { transform: rotate(360deg); } }
#crosshair.charging .ch-ring {
  opacity: 0.9;
  animation: ch-spin 1.6s linear infinite;
}

/* The container is a 0x0 box whose transform-origin is the anchor itself, so
   a scale here scales every child's offset about screen centre. */
@keyframes ch-pulse {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.45); }
  100% { transform: scale(1); }
}
#crosshair.pulse { animation: ch-pulse ${PULSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1); }
`;

export class Crosshair {
    /**
     * @param {{ overlay?: { visible: boolean },
     *           spells?: { ribbon: { held: boolean }, activeCount: number } }} [refs]
     *   Live systems the visibility poll reads. Optional so construction order
     *   is not load-bearing; see `attach()`.
     */
    constructor(refs) {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "crosshair";
        el.innerHTML =
            '<div class="ch-ring"></div>' +
            '<div class="ch-core"></div>' +
            '<div class="ch-tick ch-n"></div>' +
            '<div class="ch-tick ch-e"></div>' +
            '<div class="ch-tick ch-s"></div>' +
            '<div class="ch-tick ch-w"></div>';
        document.body.appendChild(el);
        this.el = el;

        this.overlay = refs?.overlay ?? null;
        this.spells = refs?.spells ?? null;

        /** Cached DOM state, so steady frames write nothing. */
        this._show = false;
        this._active = false;
        this._charging = false;
        /** `performance.now()` deadline of the running pulse; 0 = none. */
        this._pulseUntil = 0;
    }

    /**
     * Late-bind the systems the poll reads.
     * @param {{ overlay?: any, spells?: any }} refs
     * @returns {void}
     */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
        if (refs.spells) this.spells = refs.spells;
    }

    /**
     * One frame of the reticle. Pure poll; allocates nothing.
     * @returns {void}
     */
    update() {
        // Hidden unless the pointer is locked, and locked play is the only
        // state the shell menu/pause and the panels are absent from — but each
        // is checked in its own right, because Esc-to-pause and pointer-unlock
        // are two events and a frame can sit between them.
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        const panelUp = !!(this.overlay && this.overlay.visible);
        const show = input.locked && !shellUp && !panelUp;
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }

        // Active while a spell is held (Ribbon) or any cast is still in
        // flight. `activeCount` is a five-element scan, not an allocation.
        const sp = this.spells;
        const active = !!(sp && (sp.ribbon.held || sp.activeCount > 0));
        if (active !== this._active) {
            this._active = active;
            this.el.classList.toggle("active", active);
        }
        // The charge ring spins only while the ribbon is actually held.
        const charging = !!(sp && sp.ribbon.held);
        if (charging !== this._charging) {
            this._charging = charging;
            this.el.classList.toggle("charging", charging);
        }

        // Cast pulse. `spellPressed` is a one-frame edge (main.js runs this
        // before `endFrame()` clears it), so this branch is a keypress, not a
        // steady-state cost. The remove/reflow/add is the standard CSS
        // animation restart — without it a second cast inside 240 ms would not
        // pulse at all.
        if (input.spellPressed) {
            this._pulseUntil = performance.now() + PULSE_MS;
            this.el.classList.remove("pulse");
            void this.el.offsetWidth;
            this.el.classList.add("pulse");
        } else if (this._pulseUntil !== 0 && performance.now() >= this._pulseUntil) {
            this._pulseUntil = 0;
            this.el.classList.remove("pulse");
        }
    }
}
