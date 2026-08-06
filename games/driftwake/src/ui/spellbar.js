/**
 * The spell toolbar — five slots along the bottom edge, one per spell, with
 * live keybinds (owner remap 2026-08-05: LMB holds the Stream, keys 1-4 are
 * Wave / Bloom / Spikes / Vortex).
 *
 * Same construction rules as `ui/crosshair.js`, and deliberately the same
 * frost identity: DOM + CSS only, nothing in the render path; POLLED, not
 * subscribed — `update()` runs once per frame from `main.js`, every DOM
 * write gated behind a cached value, so a steady frame costs a few property
 * reads. The cast flash restarts a CSS animation on the cast EDGE only.
 *
 * States, all CSS classes on the slots:
 *   #spellbar.show   visible — pointer locked, no shell menu, no panel
 *   .sb-slot.held    the Stream while LMB is down: accent glow + charge sheen
 *   .sb-slot.cast    ~340 ms flash, retriggered on that spell's cast edge
 *
 * VISUAL PARITY: '#spellbar' joins '#crosshair' and '#hint' in the harness
 * chrome-hider list (`_harness/shoot.py`), and like the crosshair it can only
 * show under pointer lock, which an automated page never holds.
 */

import { input } from "../core/input.js";

/** Flash duration, ms. Matches the CSS animation. */
const FLASH_MS = 340;

/**
 * Slot order on screen. `id` is the INTERNAL spell id (never remapped);
 * `bind` is the label the player reads. Glyphs are inline SVG strokes.
 */
const SLOTS = [
    { id: 2, bind: "LMB", name: "stream",
      glyph: '<path d="M4 9c3-2.6 5 2.6 8 0s5 2.6 8 0"/>' +
             '<path d="M4 14c3-2.6 5 2.6 8 0s5 2.6 8 0"/>' +
             '<path d="M6.5 19c2.2-2 3.8 2 6.5 0s3.4 1.4 4.5.6"/>' },
    { id: 1, bind: "1", name: "wave",
      glyph: '<path d="M3 16C6 8 12 5 21 7c-5 1-8 4-9.5 9"/>' +
             '<path d="M5 19.5c4-1.8 8-2 12-.8"/>' },
    { id: 3, bind: "2", name: "bloom",
      glyph: '<circle cx="12" cy="12" r="3.2"/>' +
             '<path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3' +
             'M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18"/>' },
    { id: 4, bind: "3", name: "spikes",
      glyph: '<path d="M5 20L8 8l2.6 8L14 4l2.8 10L19 12l1 8z"/>' },
    { id: 5, bind: "4", name: "vortex",
      glyph: '<path d="M12 12c0-1.8 2.6-2 3.6-.6 1.3 1.8-.2 4.6-2.6 5' +
             '-3.4.6-6.3-2.4-6-6C7.4 6 11.6 3.8 15.4 5.4c2.9 1.2 4.6 4 4.3 7"/>' },
];

const CSS = `
#spellbar {
  position: fixed; left: 50%; bottom: 42px;
  transform: translateX(-50%);
  display: flex; gap: 9px;
  z-index: 55; /* over #hint (50), under #crosshair (60) and #overlay (80) */
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
#spellbar.show { opacity: 0.92; }

.sb-slot {
  position: relative;
  width: 46px; height: 46px;
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.58), rgba(8, 13, 19, 0.72));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 10px rgba(120, 180, 220, 0.05);
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.sb-slot svg {
  position: absolute; left: 50%; top: 50%;
  width: 26px; height: 26px; margin: -14px 0 0 -13px;
  fill: none;
  stroke: var(--frost, #cfe4f2);
  stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
  opacity: 0.9;
  filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.8));
  transition: stroke 160ms ease, opacity 160ms ease;
}
.sb-bind {
  position: absolute; right: 4px; bottom: 2px;
  font: 600 9px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.04em;
  color: rgba(205, 228, 244, 0.78);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}

/* LMB held: the stream is live — accent up, a slow charge sheen. */
@keyframes sb-sheen {
  0%   { box-shadow: 0 1px 6px rgba(0,0,0,0.45), inset 0 0 8px rgba(160,225,255,0.18); }
  50%  { box-shadow: 0 1px 6px rgba(0,0,0,0.45), inset 0 0 15px rgba(160,225,255,0.42); }
  100% { box-shadow: 0 1px 6px rgba(0,0,0,0.45), inset 0 0 8px rgba(160,225,255,0.18); }
}
.sb-slot.held {
  border-color: rgba(174, 232, 255, 0.85);
  transform: translateY(-2px);
  animation: sb-sheen 1.6s ease-in-out infinite;
}
.sb-slot.held svg { stroke: var(--accent, #9fd8f5); opacity: 1; }

/* Cooldown: a clockwise conic wipe of frost-dark glass over the slot,
   driven by the --cd custom property (remaining fraction), with the
   remaining seconds printed while it runs. */
.sb-cd {
  position: absolute; inset: 0;
  border-radius: 8px;
  background: conic-gradient(rgba(5, 9, 14, 0.82) calc(var(--cd, 0) * 1turn),
              transparent calc(var(--cd, 0) * 1turn));
  opacity: 0;
  transition: opacity 140ms ease;
  pointer-events: none;
}
.sb-slot.cooling .sb-cd { opacity: 1; }
.sb-slot.cooling svg { opacity: 0.45; }
.sb-cds {
  position: absolute; left: 0; right: 0; top: 50%;
  transform: translateY(-52%);
  text-align: center;
  font: 700 13px/1 "Segoe UI", system-ui, sans-serif;
  color: #e9f5fd;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
  opacity: 0;
  transition: opacity 140ms ease;
}
.sb-slot.cooling .sb-cds { opacity: 1; }

/* Cast flash: one sharp frost pop on the slot that fired. */
@keyframes sb-cast {
  0%   { border-color: rgba(234, 250, 255, 0.95); transform: scale(1.12);
         box-shadow: 0 0 14px rgba(174, 232, 255, 0.55); }
  100% { border-color: rgba(160, 205, 235, 0.26); transform: scale(1);
         box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45); }
}
.sb-slot.cast { animation: sb-cast ${FLASH_MS}ms cubic-bezier(0.3, 0, 0.2, 1); }
`;

export class SpellBar {
    /**
     * @param {{ overlay?: { visible: boolean },
     *           spells?: { ribbon: { held: boolean } } }} [refs]
     */
    constructor(refs) {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "spellbar";
        el.innerHTML = SLOTS.map((s) =>
            `<div class="sb-slot" data-spell="${s.id}">` +
            `<svg viewBox="0 0 24 24" aria-hidden="true">${s.glyph}</svg>` +
            `<div class="sb-cd"></div><span class="sb-cds"></span>` +
            `<span class="sb-bind">${s.bind}</span></div>`
        ).join("");
        document.body.appendChild(el);
        this.el = el;

        /** @type {Record<number, HTMLElement>} slot elements by spell id. */
        this._slot = {};
        for (const div of el.children) {
            this._slot[+div.dataset.spell] = div;
        }

        this.overlay = refs?.overlay ?? null;
        this.spells = refs?.spells ?? null;

        this._show = false;
        this._held = false;
        /** Deadline of the running flash per spell id; 0 = none. */
        this._flashUntil = { 1: 0, 3: 0, 4: 0, 5: 0 };
        /** Cached cooldown fraction + seconds text per spell id. */
        this._cdFrac = { 1: -1, 3: -1, 4: -1, 5: -1 };
        this._cdText = { 1: "", 3: "", 4: "", 5: "" };
    }

    /** @param {{ overlay?: any, spells?: any }} refs @returns {void} */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
        if (refs.spells) this.spells = refs.spells;
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

        // Stream slot mirrors the ribbon hold (LMB), not the raw input, so
        // it agrees with what the spell system actually accepted.
        const held = !!(this.spells && this.spells.ribbon.held);
        if (held !== this._held) {
            this._held = held;
            this._slot[2].classList.toggle("held", held);
        }

        // Cooldown wipes: fraction to 2 decimal places (sub-percent writes
        // are invisible), countdown in whole seconds.
        const sp = this.spells;
        if (sp && sp.cooldownFrac) {
            for (const idStr of ["1", "3", "4", "5"]) {
                const id = +idStr;
                const slot = this._slot[id];
                if (!slot) continue;
                const f = Math.round(sp.cooldownFrac(id) * 100) / 100;
                if (f !== this._cdFrac[id]) {
                    this._cdFrac[id] = f;
                    slot.style.setProperty("--cd", f);
                    slot.classList.toggle("cooling", f > 0);
                }
                const txt = f > 0 ? String(Math.ceil(sp.cooldownLeft(id))) : "";
                if (txt !== this._cdText[id]) {
                    this._cdText[id] = txt;
                    slot.querySelector(".sb-cds").textContent = txt;
                }
            }
        }

        // Cast flash on the edge. `spellPressed` carries the INTERNAL id and
        // is cleared by endFrame() after us — a keypress, not a per-frame cost.
        const id = input.spellPressed;
        if (id && this._slot[id]) {
            this._flashUntil[id] = performance.now() + FLASH_MS;
            const s = this._slot[id];
            s.classList.remove("cast");
            void s.offsetWidth;
            s.classList.add("cast");
        }
        for (const k in this._flashUntil) {
            const t = this._flashUntil[k];
            if (t !== 0 && performance.now() >= t) {
                this._flashUntil[k] = 0;
                this._slot[k].classList.remove("cast");
            }
        }
    }
}
