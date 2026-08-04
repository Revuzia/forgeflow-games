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

/* The dot. A faint dark halo on everything so the hairlines read on bright
   snow and in shadow alike. Sized in whole px and centred with -px/2 margins
   off the 0x0 anchor, so the browser lands it subpixel-centred on any
   viewport parity. */
#crosshair .ch-dot {
  position: absolute; left: 0; top: 0;
  width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: var(--frost, #dbe6f2);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.9), 0 0 1px rgba(0, 0, 0, 0.9);
  transition: background 140ms ease;
}

/* Four hairline ticks, one element rotated into each cardinal. The rotate
   spins the tick about its own centre (which sits on the anchor), then the
   translateY pushes it out along the rotated axis — so one transform pair
   serves all four, and the active spread only changes the push. */
#crosshair .ch-tick {
  position: absolute; left: 0; top: 0;
  width: 1px; height: 5px; margin: -2.5px 0 0 -0.5px;
  background: var(--frost, #dbe6f2);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
  transition: transform 140ms cubic-bezier(0.4, 0, 0.2, 1), background 140ms ease;
}
#crosshair .ch-n { transform: rotate(0deg)   translateY(-6px); }
#crosshair .ch-e { transform: rotate(90deg)  translateY(-6px); }
#crosshair .ch-s { transform: rotate(180deg) translateY(-6px); }
#crosshair .ch-w { transform: rotate(270deg) translateY(-6px); }

#crosshair.active .ch-n { transform: rotate(0deg)   translateY(-8px); }
#crosshair.active .ch-e { transform: rotate(90deg)  translateY(-8px); }
#crosshair.active .ch-s { transform: rotate(180deg) translateY(-8px); }
#crosshair.active .ch-w { transform: rotate(270deg) translateY(-8px); }

#crosshair.active .ch-dot,
#crosshair.active .ch-tick { background: var(--accent, #8fc4e8); }

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
            '<div class="ch-dot"></div>' +
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
