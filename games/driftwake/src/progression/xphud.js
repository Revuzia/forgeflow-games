/**
 * XP bar + level chip — the ding's on-screen half (PROGRESSION_DESIGN.md
 * P1.1: "slim XP bar directly above the spellbar, full spellbar width,
 * bottom-center; level numeral on the left cap; ding = bar flash").
 *
 * Same construction rules as `ui/crosshair.js` and `ui/hud.js`, same frost
 * identity: DOM + CSS only, nothing in the render path; POLLED, not
 * subscribed — `update()` runs once per frame from `main.js`, every DOM
 * write gated behind a cached value. The fill is a scaleX transform (no
 * layout), the numeral only rewrites when the ROUNDED state moves, and the
 * ding flash restarts a CSS animation on the level-change EDGE only (XP
 * moves on kills, so even the fill write is event-rate, not frame-rate).
 *
 * Geometry is derived from `ui/spellbar.js`, not invented: the bar is the
 * spellbar's full width (5×46 px slots + 4×9 px gaps = 266 px) and sits
 * directly above it (spellbar bottom 42 px + 46 px slots + 8 px seam).
 *
 * At the level cap the bar recolors to ember and the chip reads
 * `30 · Mk n` — §9's Driftmark presentation; the fill then tracks progress
 * toward the next mark (Progression keeps `xpNeed` pointing at its cost).
 *
 * States, all on `#xphud`:
 *   (none)   hidden — pointer not locked, shell menu/pause up, panel open
 *   .show    visible during locked play
 *   .ding    ~620 ms flash, retriggered on every level-up / Driftmark edge
 *   .capped  ember recolor at the level cap (§9)
 *
 * VISUAL PARITY: '#xphud' shows only under `input.locked`, which automation
 * never holds — add it to the `_harness/shoot.py` chrome-hider list alongside
 * '#hud' and '#spellbar' when the harness list is next touched.
 */

import { input } from "../core/input.js";

/** Ding flash duration, ms. Matches the CSS animation. */
const DING_MS = 620;

/**
 * Con color for a level difference (PROGRESSION_DESIGN.md §3.3 — the SAME
 * banding as `progression.js`'s `conMult`, so the color the UI paints and
 * the multiplier the grant pays can never disagree). Exported for the target
 * frame / enemy bars (P2.2) and anything else that cons an enemy.
 * @param {number} diff enemyLevel − playerLevel
 * @returns {string} CSS color
 */
export function conColor(diff) {
    if (diff >= 5) return "#ff5040";   // skull-red — flee or earn it
    if (diff >= 3) return "#ff9a3d";   // orange — stretch goal
    if (diff >= 1) return "#ffd75e";   // yellow — the intended fight
    if (diff >= -3) return "#f0f6fb";  // white — fair fight, full pay
    if (diff >= -6) return "#6fd66f";  // green — outgrowing it
    return "#9aa5ad";                  // gray — trivial (5% floor)
}

const CSS = `
#xphud {
  position: fixed; left: 50%; bottom: 96px;
  transform: translateX(-50%);
  width: 266px;
  z-index: 55; /* with #hud and #spellbar, under #crosshair (60) */
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
#xphud.show { opacity: 0.92; }

/* The bar: hud.js's frost glass, one third the height. */
.xp-bar {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45), inset 0 1px 2px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.xp-fill {
  position: absolute; inset: 1px;
  border-radius: 2px;
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 160ms ease-out;
  background: linear-gradient(180deg, #a8dcf5, #5d9fc7 60%, #3d7396);
  box-shadow: inset 0 1px 1px rgba(220, 245, 255, 0.4);
}
/* §9: the bar recolors at cap — Driftmark progress wears ember. */
#xphud.capped .xp-fill {
  background: linear-gradient(180deg, #e89a66, #b35c33 60%, #8a4426);
  box-shadow: inset 0 1px 1px rgba(255, 220, 190, 0.35);
}
/* The frost sheen, scaled down from .hud-bar::after. */
.xp-bar::after {
  content: "";
  position: absolute; left: 4px; right: 4px; top: 0; height: 1px;
  background: rgba(230, 245, 255, 0.28);
  border-radius: 1px;
}

/* Level chip on the left cap, hanging off the bar's end. */
.xp-level {
  position: absolute; right: 100%; top: 50%;
  transform: translate(-7px, -50%);
  padding: 2px 7px 3px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.58), rgba(8, 13, 19, 0.72));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  font: 700 11px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.04em;
  color: rgba(240, 248, 253, 0.94);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  white-space: nowrap;
}
#xphud.capped .xp-level { color: #f2c9a8; }

/* The ding: bar and chip pop bright together, one flash, no modal (§4). */
@keyframes xp-ding-bar {
  0%   { border-color: rgba(234, 250, 255, 0.95);
         box-shadow: 0 0 14px rgba(174, 232, 255, 0.65); }
  100% { border-color: rgba(160, 205, 235, 0.26);
         box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); }
}
@keyframes xp-ding-chip {
  0%   { transform: translate(-7px, -50%) scale(1.25);
         border-color: rgba(234, 250, 255, 0.95);
         box-shadow: 0 0 12px rgba(174, 232, 255, 0.6); }
  100% { transform: translate(-7px, -50%) scale(1);
         border-color: rgba(160, 205, 235, 0.26);
         box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); }
}
#xphud.ding .xp-bar {
  animation: xp-ding-bar ${DING_MS}ms cubic-bezier(0.3, 0, 0.2, 1);
}
#xphud.ding .xp-level {
  animation: xp-ding-chip ${DING_MS}ms cubic-bezier(0.3, 0, 0.2, 1);
}
`;

export class XpHud {
    /**
     * @param {{ overlay?: { visible: boolean },
     *           progression?: import("./progression.js").Progression }} [refs]
     *   Live systems the poll reads. Optional so construction order is not
     *   load-bearing; see `attach()`.
     */
    constructor(refs) {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "xphud";
        el.innerHTML =
            '<div class="xp-bar"><div class="xp-fill"></div>' +
            '<span class="xp-level"></span></div>';
        document.body.appendChild(el);
        this.el = el;

        this._fill = el.querySelector(".xp-fill");
        this._chip = el.querySelector(".xp-level");

        this.overlay = refs?.overlay ?? null;
        this.progression = refs?.progression ?? null;

        /** Cached DOM state, so steady frames write nothing. */
        this._show = false;
        this._frac = -1;
        this._chipTxt = "";
        this._capped = false;
        /** Last seen ding counter; −1 = never polled (no flash on load). */
        this._dings = -1;
        /** `performance.now()` deadline of the running flash; 0 = none. */
        this._dingUntil = 0;
    }

    /**
     * Late-bind the systems the poll reads.
     * @param {{ overlay?: any, progression?: any }} refs
     * @returns {void}
     */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
        if (refs.progression) this.progression = refs.progression;
    }

    /**
     * Explicit ding hook (Progression calls it if attached). The poll below
     * also catches `dingCount` on its own, so wiring this is optional — the
     * hook only makes the flash land on the ding's exact frame instead of
     * the next poll. Re-entry safe: the poll's cache is synced first.
     * @returns {void}
     */
    ding() {
        if (this.progression) this._dings = this.progression.dingCount;
        this._flash();
    }

    /**
     * One frame. Pure poll; allocates nothing on a steady frame (the chip
     * string only builds when level/marks change — kill-rate, not frame-rate).
     * @returns {void}
     */
    update() {
        // Visibility — the crosshair's exact contract: pointer locked, no
        // shell menu/pause, no panel. Each checked in its own right.
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        const panelUp = !!(this.overlay && this.overlay.visible);
        const show = input.locked && !shellUp && !panelUp;
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }

        const p = this.progression;
        if (!p) return;

        // Fill, as a cached scaleX — clamped: at 100 Driftmarks the bank can
        // exceed the (final) cost and the bar simply sits full.
        const frac = Math.max(0, Math.min(1, p.xp / Math.max(1, p.xpNeed)));
        const q = Math.round(frac * 1000) / 1000; // sub-0.1% writes are invisible
        if (q !== this._frac) {
            this._frac = q;
            this._fill.style.transform = `scaleX(${q})`;
        }

        // Cap recolor + chip text (§9: numeral shows "30 · Mk n" at cap).
        const capped = p.level >= p.data.levelCap;
        if (capped !== this._capped) {
            this._capped = capped;
            this.el.classList.toggle("capped", capped);
        }
        const txt = capped ? `${p.level} · Mk ${p.driftmarks}` : String(p.level);
        if (txt !== this._chipTxt) {
            this._chipTxt = txt;
            this._chip.textContent = txt;
        }

        // Ding flash on the counter's edge. First poll after load seeds the
        // cache silently — restoring a save is not a level-up.
        if (this._dings === -1) {
            this._dings = p.dingCount;
        } else if (p.dingCount !== this._dings) {
            this._dings = p.dingCount;
            this._flash();
        }
        if (this._dingUntil !== 0 && performance.now() >= this._dingUntil) {
            this._dingUntil = 0;
            this.el.classList.remove("ding");
        }
    }

    /** Restart the flash animation (the standard remove/reflow/add).
     *  Edge-scoped — a level-up, never a frame. @returns {void} */
    _flash() {
        this._dingUntil = performance.now() + DING_MS;
        this.el.classList.remove("ding");
        void this.el.offsetWidth;
        this.el.classList.add("ding");
    }
}
