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
 *
 * QUEST PIPS (lane U, _spec/QUEST_DESIGN.md §7): `attachQuest(ctx)` adds the
 * meaning layer's markers under the enemy pips — shrines (lit = filled realm
 * diamond, dormant = hollow), discovered unopened relic caches, Wake Trial
 * start gates (ringed in their best medal's colour), known living bounties,
 * and the tracked waypoint (ui/questTracker.js `target`, a map pin over the
 * quest's own), which is pinned to the rim when it is out of range. The pip
 * tables are preallocated typed arrays REFRESHED ON EVENTS (a shrine lit, a
 * cache found or opened, a bounty revealed or killed, a trial medal, a realm
 * change, or one of the side systems becoming ready for the realm) — the
 * frame only draws them. The draw path allocates nothing (no per-pip arrays,
 * no iterator: the enemy pips use the same inline projection).
 */

import { input } from "../core/input.js";

/** On-screen size, CSS px. */
const SIZE = 178;
/** World metres from centre to edge. */
const RANGE = 105;
/** Quest pip table sizes: 7 shrines, 15 caches, 3 trials, 3 bounties. */
const Q_SHRINES = 7, Q_CACHES = 15, Q_TRIALS = 3, Q_BOUNTIES = 3;
const MEDAL_RING = ["rgba(205, 228, 244, 0.75)", "#e3a877", "#d9e6f0", "#ffd98a"];
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
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 14px rgba(120, 180, 220, 0.06);
  background: rgba(8, 13, 19, 0.7);
}
#minimap.show { opacity: 0.92; }
#minimap canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#minimap .mm-n {
  position: absolute; top: 7px; left: 50%; transform: translateX(-50%);
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
        /** @type {{targetId:number}|null} set by main.js — TAB selection, so
         *  the selected body's pip is unmistakable on the map. */
        this.targeting = null;

        this.overlay = null;
        this._show = false;

        // ---- lane U quest pips (attachQuest) -----------------------------
        /** @type {any} the meaning-layer ctx, null until attachQuest(). */
        this.quest = null;
        /** x, z, flag per pip. Shrines: flag 1 lit / 0 dormant / -1 none.
         *  Caches: 1 = discovered and unopened (drawn). Trials: flag = 1 +
         *  best medal (0 = not built). Bounties: 1 = known and alive. */
        this._qs = new Float32Array(Q_SHRINES * 3);
        this._qc = new Float32Array(Q_CACHES * 3);
        this._qt = new Float32Array(Q_TRIALS * 3);
        this._qb = new Float32Array(Q_BOUNTIES * 3);
        this._qDirty = false;
        /** The rider's x, z for the pip pass: written by `_drawOverlay`, read by
         *  `_drawQuest` — a typed slot, so no double crosses the call (a
         *  call V8 declines to inline boxes every double argument). */
        this._qv = new Float64Array(2);
        /** readyRealm values last seen (caches / trials / bounties). */
        this._qReady = ["", "", ""];
        this._accent = "rgba(168, 220, 245, 0.95)";
        /** Probe surface: pip counts as last refreshed. */
        this.questStats = { refreshes: 0, shrinesLit: 0, shrines: 0, caches: 0, trials: 0, bounties: 0, wp: false };
    }

    /** @param {{ overlay?: any }} refs @returns {void} */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
    }

    /**
     * Lane U: draw the meaning layer's pips. `ctx` is the shared module ctx
     * (shrine, progression, caches, trials, bounties, questTracker, bus,
     * getRealm, realms). Safe to call before any of those exist.
     * @param {any} ctx @returns {void}
     */
    attachQuest(ctx) {
        this.quest = ctx;
        const B = ctx.bus;
        if (B) {
            const dirty = () => { this._qDirty = true; };
            const evs = ["shrine:activated", "cache:discovered", "cache:opened", "realm:entered",
                "bounty:revealed", "bounty:killed", "trial:finished", "shrine:travelled"];
            for (let i = 0; i < evs.length; i++) B.on(evs[i], dirty);
        }
        this._qDirty = true;
    }

    /** Rebuild the quest pip tables (event-rate; list() calls allocate). */
    _refreshQuest() {
        const q = this.quest;
        this._qDirty = false;
        this.questStats.refreshes++;
        const realm = q.getRealm ? q.getRealm() : "cold";
        const R = q.realms && q.realms.realm ? q.realms.realm(realm) : null;
        this._accent = R && R.accent && R.accent.edge ? R.accent.edge : "rgba(168, 220, 245, 0.95)";
        const P = q.progression;
        // Shrines.
        const pos = q.shrine && q.shrine.positions ? q.shrine.positions : null;
        let lit = 0, ns = 0;
        for (let i = 0; i < Q_SHRINES; i++) {
            const p = pos ? pos[i] : null;
            const o = i * 3;
            if (!p) { this._qs[o + 2] = -1; continue; }
            ns++;
            this._qs[o] = p.x; this._qs[o + 1] = p.z;
            const on = P && P.isShrineLit ? P.isShrineLit(realm, p.id) : false;
            this._qs[o + 2] = on ? 1 : 0;
            if (on) lit++;
        }
        this.questStats.shrines = ns;
        this.questStats.shrinesLit = lit;
        // Caches: discovered and still closed.
        this._qc.fill(0);
        let nc = 0;
        const C = q.caches;
        if (C && C.readyRealm === realm && C.list) {
            const L = C.list(realm);
            for (let i = 0; i < L.length && i < Q_CACHES; i++) {
                const o = i * 3;
                this._qc[o] = L[i].x; this._qc[o + 1] = L[i].z;
                this._qc[o + 2] = L[i].discovered && !L[i].opened ? 1 : 0;
                if (this._qc[o + 2]) nc++;
            }
        }
        this.questStats.caches = nc;
        // Trials: start gates.
        this._qt.fill(0);
        let nt = 0;
        const T = q.trials;
        if (T && T.list) {
            const L = T.list(realm);
            for (let i = 0; i < L.length && i < Q_TRIALS; i++) {
                if (!L[i].built || L[i].x === null) continue;
                const o = i * 3;
                this._qt[o] = L[i].x; this._qt[o + 1] = L[i].z;
                this._qt[o + 2] = 1 + (L[i].medal | 0);
                nt++;
            }
        }
        this.questStats.trials = nt;
        // Bounties: known (the realm's spawn shrine is lit) and alive.
        this._qb.fill(0);
        let nb = 0;
        const Bn = q.bounties;
        const known = P && P.isShrineLit ? P.isShrineLit(realm, "cold_spawn") : true;
        if (Bn && Bn.list && known) {
            const L = Bn.list(realm);
            for (let i = 0; i < L.length && i < Q_BOUNTIES; i++) {
                if (L[i].killed || L[i].x === null) continue;
                const o = i * 3;
                this._qb[o] = L[i].x; this._qb[o + 1] = L[i].z; this._qb[o + 2] = 1;
                nb++;
            }
        }
        this.questStats.bounties = nb;
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
        const q = this.quest;
        if (q !== null) {
            // A side system becoming ready for the realm (caches placed, the
            // trial lines built, bounties sited) is not an event: three
            // string compares a frame catch it.
            const a = q.caches ? q.caches.readyRealm || "" : "";
            const b = q.trials ? q.trials.readyRealm || "" : "";
            const d = q.bounties ? q.bounties.readyRealm || "" : "";
            const r = this._qReady;
            if (a !== r[0] || b !== r[1] || d !== r[2]) {
                r[0] = a; r[1] = b; r[2] = d;
                this._qDirty = true;
            }
            if (this._qDirty) this._refreshQuest();
        }
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

    /** Player wedge + blips, full-res layer. Allocation-free: projection is
     *  inline (world metres -> overlay px around the rider), no per-pip
     *  array, indexed loops. */
    _drawOverlay(c) {
        const g = this._octx;
        const S2 = SIZE * 2;
        const H = S2 / 2;
        const k = H / RANGE;
        const cx = c.position.x, cz = c.position.z;
        g.clearRect(0, 0, S2, S2);

        // Lane U quest pips under the enemy pips.
        if (this.quest !== null) {
            this._qv[0] = cx;
            this._qv[1] = cz;
            this._drawQuest(g);
        }

        // Blips, wedge on top.
        const tgtId = this.targeting ? this.targeting.targetId : -1;
        const bl = this.blips;
        for (let i = 0; i < bl.length; i++) {
            const b = bl[i];
            const x = (b.x - cx) * k + H;
            const y = (b.z - cz) * k + H;
            if (x < 6 || y < 6 || x > S2 - 6 || y > S2 - 6) continue;
            const isTgt = tgtId >= 0 && b.id === tgtId;
            g.fillStyle = b.kind === "boss" ? "rgba(255,140,90,0.95)" : "rgba(255,90,70,0.9)";
            g.beginPath();
            g.arc(x, y, b.kind === "boss" ? 7 : 4.5, 0, Math.PI * 2);
            g.fill();
            if (isTgt) {
                g.strokeStyle = "rgba(200, 242, 255, 0.95)";
                g.lineWidth = 2.5;
                g.beginPath();
                g.arc(x, y, 8, 0, Math.PI * 2);
                g.stroke();
            }
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

    /**
     * Lane U: shrines, caches, trials, bounties, then the waypoint (rim-
     * pinned). The rider's position comes from `_qv` (see the constructor).
     * @param {CanvasRenderingContext2D} g
     */
    _drawQuest(g) {
        const H = SIZE;                 // half of the 2x overlay canvas
        const k = H / RANGE;            // px per metre
        const cx = this._qv[0], cz = this._qv[1];
        const R2 = (H - 8) * (H - 8);
        // Shrines: diamonds.
        const qs = this._qs;
        for (let i = 0; i < Q_SHRINES; i++) {
            const o = i * 3;
            if (qs[o + 2] < 0) continue;
            const x = (qs[o] - cx) * k + H, y = (qs[o + 1] - cz) * k + H;
            const dx = x - H, dy = y - H;
            if (dx * dx + dy * dy > R2) continue;
            g.beginPath();
            g.moveTo(x, y - 8); g.lineTo(x + 6.5, y); g.lineTo(x, y + 8); g.lineTo(x - 6.5, y);
            g.closePath();
            g.lineWidth = 2;
            if (qs[o + 2] > 0) {
                g.fillStyle = this._accent;
                g.fill();
                g.strokeStyle = "rgba(6, 12, 18, 0.9)";
            } else {
                g.strokeStyle = "rgba(190, 210, 225, 0.75)";
            }
            g.stroke();
        }
        // Caches: small gold points.
        const qc = this._qc;
        for (let i = 0; i < Q_CACHES; i++) {
            const o = i * 3;
            if (qc[o + 2] === 0) continue;
            const x = (qc[o] - cx) * k + H, y = (qc[o + 1] - cz) * k + H;
            const dx = x - H, dy = y - H;
            if (dx * dx + dy * dy > R2) continue;
            g.beginPath();
            g.arc(x, y, 4, 0, Math.PI * 2);
            g.fillStyle = "rgba(255, 222, 150, 0.95)";
            g.fill();
            g.lineWidth = 1.5;
            g.strokeStyle = "rgba(40, 26, 8, 0.85)";
            g.stroke();
        }
        // Trials: start-gate rings in the best medal's colour.
        const qt = this._qt;
        for (let i = 0; i < Q_TRIALS; i++) {
            const o = i * 3;
            if (qt[o + 2] === 0) continue;
            const x = (qt[o] - cx) * k + H, y = (qt[o + 1] - cz) * k + H;
            const dx = x - H, dy = y - H;
            if (dx * dx + dy * dy > R2) continue;
            g.beginPath();
            g.arc(x, y, 6.5, 0, Math.PI * 2);
            g.lineWidth = 3;
            g.strokeStyle = MEDAL_RING[Math.min(3, (qt[o + 2] | 0) - 1)];
            g.stroke();
        }
        // Bounties: a red diamond with a dark core.
        const qb = this._qb;
        for (let i = 0; i < Q_BOUNTIES; i++) {
            const o = i * 3;
            if (qb[o + 2] === 0) continue;
            const x = (qb[o] - cx) * k + H, y = (qb[o + 1] - cz) * k + H;
            const dx = x - H, dy = y - H;
            if (dx * dx + dy * dy > R2) continue;
            g.beginPath();
            g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y);
            g.closePath();
            g.fillStyle = "rgba(255, 110, 80, 0.95)";
            g.fill();
            g.beginPath();
            g.arc(x, y, 2.2, 0, Math.PI * 2);
            g.fillStyle = "rgba(30, 8, 4, 0.95)";
            g.fill();
        }
        // The tracked waypoint: a bright star, rim-pinned when out of range.
        const tr = this.quest.questTracker;
        const t = tr ? tr.target : null;
        const realm = this.quest.getRealm ? this.quest.getRealm() : "cold";
        const wp = !!(t && t.valid && t.realm === realm);
        this.questStats.wp = wp;
        if (!wp) return;
        let x = (t.x - cx) * k, y = (t.z - cz) * k;
        const d2 = x * x + y * y;
        const rim = H - 10;
        if (d2 > rim * rim) {
            const sc = rim / Math.sqrt(d2);
            x *= sc; y *= sc;
        }
        x += H; y += H;
        g.beginPath();
        for (let j = 0; j < 8; j++) {
            const a = j * (Math.PI / 4) - Math.PI / 2;
            const r = (j & 1) ? 3.6 : 9;
            if (j === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
        g.fillStyle = t.pinned ? "rgba(255, 236, 170, 0.98)" : "rgba(235, 250, 255, 0.98)";
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = "rgba(6, 12, 18, 0.9)";
        g.stroke();
    }
}
