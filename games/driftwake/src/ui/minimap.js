/**
 * Minimap — bottom-left, a live top-down read of the dunes around the rider
 * (owner 2026-08-05, combat prep: enemy pips land here when enemies exist —
 * `ping()` and the `blips` array are the ready seam).
 *
 * North-up fixed map, rotating player wedge — the ARPG standard, and the
 * cheap one: the terrain layer redraws only every REDRAW_MS on a small
 * offscreen grid (heightAt samples -> shaded ImageData, scaled up by the
 * canvas), while the wedge layer redraws every frame for free. Total cost:
 * ~1.6k height samples five times a second, nothing in the render path.
 *
 * Same polling/visibility contract as the rest of the play HUD; '#minimap'
 * is in the harness chrome-hider list.
 */

import { input } from "../core/input.js";

/** On-screen size, CSS px. */
const SIZE = 148;
/** World metres from centre to edge. */
const RANGE = 95;
/** Terrain grid resolution (samples per side) and refresh cadence. */
const GRID = 44;
const REDRAW_MS = 200;

const CSS = `
#minimap {
  position: fixed; left: 18px; bottom: 42px;
  width: ${SIZE}px; height: ${SIZE}px;
  z-index: 55;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 14px rgba(120, 180, 220, 0.06);
  background: rgba(8, 13, 19, 0.7);
}
#minimap.show { opacity: 0.92; }
#minimap canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#minimap .mm-n {
  position: absolute; top: 3px; left: 50%; transform: translateX(-50%);
  font: 600 9px/1 "Segoe UI", system-ui, sans-serif;
  color: rgba(205, 228, 244, 0.8);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
`;

export class Minimap {
    /**
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {import("../terrain/terrain.js").Terrain} terrain
     */
    constructor(controller, terrain) {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "minimap";
        el.innerHTML = '<canvas class="mm-t"></canvas><canvas class="mm-o"></canvas>' +
            '<span class="mm-n">N</span>';
        document.body.appendChild(el);
        this.el = el;
        this.controller = controller;
        this.terrain = terrain;

        /** Terrain layer: drawn from the offscreen grid every REDRAW_MS. */
        this._tc = el.querySelector(".mm-t");
        this._tc.width = this._tc.height = GRID;
        this._tctx = this._tc.getContext("2d");
        /** Overlay layer: player wedge + blips, every frame, at full res. */
        this._oc = el.querySelector(".mm-o");
        this._oc.width = this._oc.height = SIZE * 2;   // crisp on hidpi
        this._octx = this._oc.getContext("2d");

        this._img = this._tctx.createImageData(GRID, GRID);
        this._nextRedraw = 0;

        /**
         * Combat seam: world-space markers, drawn as pips. Enemies will push
         * {x, z, kind} here ('enemy' | 'boss' | 'ping'); nothing writes yet.
         * @type {{x: number, z: number, kind: string}[]}
         */
        this.blips = [];

        this.overlay = null;
        this._show = false;
    }

    /** @param {{ overlay?: any }} refs @returns {void} */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
    }

    /** One frame. Terrain layer refreshes on its own slower clock. */
    update() {
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        const panelUp = !!(this.overlay && this.overlay.visible);
        const show = input.locked && !shellUp && !panelUp;
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }
        if (!show) return;

        const c = this.controller;
        const now = performance.now();
        if (now >= this._nextRedraw) {
            this._nextRedraw = now + REDRAW_MS;
            this._redrawTerrain(c.position.x, c.position.z);
        }
        this._drawOverlay(c);
    }

    /**
     * Sample the height field around (cx, cz) into the small grid, shaded by
     * a cheap north-west sun slope — dunes read as dunes, not noise.
     */
    _redrawTerrain(cx, cz) {
        const t = this.terrain;
        const d = this._img.data;
        const step = (RANGE * 2) / (GRID - 1);
        // First pass: heights.
        const hs = this._hs || (this._hs = new Float32Array(GRID * GRID));
        for (let j = 0; j < GRID; j++) {
            const z = cz - RANGE + j * step;      // canvas y down = world +z? No:
            for (let i = 0; i < GRID; i++) {
                // North-up: canvas up (-y) = world -z; canvas x = world +x.
                hs[j * GRID + i] = t.heightAt(cx - RANGE + i * step, cz - RANGE + j * step);
            }
        }
        for (let j = 0; j < GRID; j++) {
            for (let i = 0; i < GRID; i++) {
                const h = hs[j * GRID + i];
                const hx = hs[j * GRID + Math.min(GRID - 1, i + 1)] - h;
                const hz = hs[Math.min(GRID - 1, j + 1) * GRID + i] - h;
                // Slope-lit frost-paper: lit from NW, blue in the hollows.
                const lit = 0.62 + 0.5 * (hx * -0.7 + hz * -0.7) / step;
                const l = Math.max(0.25, Math.min(1, lit));
                const o = (j * GRID + i) * 4;
                d[o] = 158 * l + 22;
                d[o + 1] = 184 * l + 26;
                d[o + 2] = 208 * l + 34;
                d[o + 3] = 235;
            }
        }
        this._tctx.putImageData(this._img, 0, 0);
    }

    /** Player wedge + blips, full-res layer. */
    _drawOverlay(c) {
        const g = this._octx;
        const S2 = SIZE * 2;
        g.clearRect(0, 0, S2, S2);
        const toPx = (wx, wz) => [
            ((wx - c.position.x) / RANGE) * (S2 / 2) + S2 / 2,
            ((wz - c.position.z) / RANGE) * (S2 / 2) + S2 / 2,
        ];

        // Blips first, wedge on top.
        for (const b of this.blips) {
            const [x, y] = toPx(b.x, b.z);
            if (x < 6 || y < 6 || x > S2 - 6 || y > S2 - 6) continue;
            g.fillStyle = b.kind === "boss" ? "rgba(255,140,90,0.95)" : "rgba(255,90,70,0.9)";
            g.beginPath();
            g.arc(x, y, b.kind === "boss" ? 7 : 4.5, 0, Math.PI * 2);
            g.fill();
        }

        // The rider: a frost wedge pointing along facing. PORT FRAME: forward
        // at facing f is (sin f, -cos f) in world xz; canvas y IS world z.
        const f = c.facing;
        const dx = Math.sin(f), dz = -Math.cos(f);
        g.save();
        g.translate(S2 / 2, S2 / 2);
        g.rotate(Math.atan2(dz, dx) + Math.PI / 2);
        g.beginPath();
        g.moveTo(0, -11);
        g.lineTo(7.5, 8);
        g.lineTo(0, 3.5);
        g.lineTo(-7.5, 8);
        g.closePath();
        g.fillStyle = "rgba(213, 238, 252, 0.95)";
        g.strokeStyle = "rgba(10, 18, 26, 0.9)";
        g.lineWidth = 2;
        g.fill();
        g.stroke();
        g.restore();
    }
}
