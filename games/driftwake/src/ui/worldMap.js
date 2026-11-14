/**
 * THE WORLD MAP (M) — _spec/QUEST_DESIGN.md §7: a full-screen top-down of the
 * current realm with the player, activated vs dormant shrines, discovered
 * relic caches (opened / unopened), the Wake Trials, the known bounties, boss
 * arenas once revealed, the portal once open, and the tracked waypoint. Realm
 * tabs for every unlocked realm. Click a shrine to MARK it: 'waypoint:pin'
 * (quests/events.js lane U block) — the quest tracker then steers the beacon,
 * the compass and the minimap to it until the rider arrives or unmarks it.
 *
 * TERRAIN: the minimap's approach (ui/minimap.js — heightAt samples shaded
 * by a north-west sun slope) over the WHOLE play disc on a 128 x 128 grid,
 * baked ONCE per realm per terrain bake (`terrain.rebakeCount`) into its own
 * small canvas and scaled up; only the live realm's heightfield exists, so a
 * realm that has not been charted this session shows a plain disc ("not yet
 * charted") under its markers. Markers are redrawn at most 15 times a second
 * while open (the rider can still move); the marker TABLES are rebuilt on
 * open, on a realm tab, and on a relevant bus event — never per frame.
 *
 * NOT A MODAL (§7): the world keeps its clock. A cursor panel through the
 * input.js panel stack (no game key fires behind it; Esc closes it before the
 * pause menu). Closes itself when a reward modal or the journal opens.
 *
 * KEYS: 1-3 realm tab · C clear the mark · J journal · M, Esc close.
 *
 * MODULE SHAPE: constructor(ctx), update(dt), setRealm(token), open(realm),
 * close(), plus `markers` (the last built table, for probes) and `pinShrine`.
 * ctx: bus, input, overlay, terrain, character, shrine, progression, caches,
 * trials, bounties, bosses, portal, questTracker, realms, getRealm.
 */

import {
    input as coreInput, openPanel, closePanel, requestLock,
} from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";
import { anyModalOpen, esc } from "./boonPick.js";
import { realmLabel, realmAccent, shellPlaying } from "./questTracker.js";
import { ensurePanelCss, panelMayOpen, openRealms } from "./journal.js";

/** Terrain grid per side (the whole play disc). */
export const MAP_GRID = 128;
/** Marker redraw cadence while open, s (wall-agnostic: game dt or 1/15). */
const MARK_PERIOD = 1 / 15;
/** Shrine click radius, CSS px. */
export const PICK_PX = 16;
const REALMS = ["cold", "sand", "ash"];
const SPAWN = "cold_spawn";
const MEDAL = ["rgba(205, 228, 244, 0.85)", "#e3a877", "#d9e6f0", "#ffd98a"];
/** Realm ground tint for the shaded relief (multiplies the slope light). */
const TINT = { cold: [0.86, 0.94, 1.0], sand: [1.0, 0.86, 0.62], ash: [0.62, 0.56, 0.56] };

const CSS = `
#dw-map .dwu-card { width: min(1200px, calc(100vw - 32px)); height: min(780px, calc(100vh - 32px)); }
#dw-map .dwm-realms { display: flex; gap: 6px; }
#dw-map .dwm-wrap { flex: 1; min-height: 0; display: flex; gap: 16px; margin-top: 12px; }
#dw-map .dwm-stage { position: relative; flex: none; border-radius: 50%; overflow: hidden;
  background: radial-gradient(circle at 50% 50%, rgba(18, 30, 42, 0.9), rgba(6, 10, 15, 0.95));
  border: 1px solid rgba(160, 205, 235, 0.3);
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.5), inset 0 0 40px rgba(0, 0, 0, 0.55); cursor: crosshair; }
#dw-map .dwm-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#dw-map .dwm-uncharted { position: absolute; left: 0; right: 0; top: 46%; text-align: center;
  font: 600 12px/1.4 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(205, 228, 244, 0.45); pointer-events: none; display: none; }
#dw-map .dwm-stage.uncharted .dwm-uncharted { display: block; }
#dw-map .dwm-side { flex: 1; min-width: 200px; overflow-y: auto; }
#dw-map .dwm-leg { display: flex; align-items: center; gap: 9px; margin: 6px 0;
  font: 500 12px/1.3 "Segoe UI", system-ui, sans-serif; color: rgba(214, 234, 246, 0.85); }
#dw-map .dwm-leg svg { width: 18px; height: 18px; flex: none; }
#dw-map .dwm-leg b { margin-left: auto; font-weight: 700; color: var(--dwu-accent); font-variant-numeric: tabular-nums; }
#dw-map .dwm-mark { margin-top: 14px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid rgba(255, 214, 140, 0.4); background: rgba(40, 30, 14, 0.3); display: none; }
#dw-map .dwm-mark.on { display: block; }
#dw-map .dwm-mark b { display: block; font: 600 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #ffe2a6; }
#dw-map .dwm-mark i { display: block; font: 500 11.5px/1.4 "Segoe UI", system-ui, sans-serif; font-style: normal;
  color: rgba(214, 234, 246, 0.75); margin-top: 3px; }
#dw-map .dwm-mark button { margin-top: 8px; cursor: pointer; color: inherit; padding: 6px 12px; border-radius: 7px;
  font: 600 12px/1 "Segoe UI", system-ui, sans-serif; background: rgba(28, 46, 62, 0.8);
  border: 1px solid rgba(255, 214, 140, 0.5); }
`;

let _cssDone = false;
function ensureCss() {
    ensurePanelCss();
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-map-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

/** Small legend glyphs (SVG). */
const GLYPH = {
    lit: '<svg viewBox="0 0 18 18"><path d="M9 1.5l6 7.5-6 7.5-6-7.5z" fill="var(--dwu-accent)" stroke="#06121a" stroke-width="1.5"/></svg>',
    dormant: '<svg viewBox="0 0 18 18"><path d="M9 1.5l6 7.5-6 7.5-6-7.5z" fill="none" stroke="rgba(190,210,225,.8)" stroke-width="1.6"/></svg>',
    cache: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="4.5" fill="#ffde96" stroke="#281a08" stroke-width="1.4"/></svg>',
    opened: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="4.5" fill="none" stroke="rgba(255,222,150,.55)" stroke-width="1.6"/></svg>',
    trial: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6" fill="none" stroke="#ffd98a" stroke-width="2.4"/></svg>',
    bounty: '<svg viewBox="0 0 18 18"><path d="M9 2l7 7-7 7-7-7z" fill="#ff6e50"/><circle cx="9" cy="9" r="2" fill="#1e0804"/></svg>',
    boss: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="none" stroke="#ff8c5a" stroke-width="2" stroke-dasharray="3 2"/><circle cx="9" cy="9" r="2.4" fill="#ff8c5a"/></svg>',
    portal: '<svg viewBox="0 0 18 18"><ellipse cx="9" cy="9" rx="4.5" ry="7" fill="none" stroke="#c8a6ff" stroke-width="2.2"/></svg>',
    wp: '<svg viewBox="0 0 18 18"><path d="M9 1l2.2 5.8L17 9l-5.8 2.2L9 17l-2.2-5.8L1 9l5.8-2.2z" fill="#ebfaff" stroke="#06121a" stroke-width="1.2"/></svg>',
    you: '<svg viewBox="0 0 18 18"><path d="M9 2l5.5 13L9 11.5 3.5 15z" fill="#d5eefc" stroke="#0a121a" stroke-width="1.4"/></svg>',
};

export class WorldMap {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;

        const el = document.createElement("div");
        el.id = "dw-map";
        el.className = "dwu-panel";
        el.innerHTML =
            '<div class="dwu-scrim"></div><div class="dwu-card">' +
            '<div class="dwu-head"><div><div class="dwu-kicker">World Map</div>' +
            '<div class="dwu-title"></div></div><div class="dwm-realms"></div></div>' +
            '<div class="dwm-wrap"><div class="dwm-stage"><canvas class="dwm-t"></canvas>' +
            '<canvas class="dwm-m"></canvas><div class="dwm-uncharted">Not yet charted</div></div>' +
            '<div class="dwm-side"><div class="dwm-legend"></div>' +
            '<div class="dwm-mark"><b class="dwm-mn"></b><i class="dwm-ms"></i>' +
            '<button data-act="unpin">Clear mark (C)</button></div></div></div>' +
            '<div class="dwu-foot">Click a shrine to mark it · 1-3 realm · C clear the mark · J journal · M or Esc close</div></div>';
        document.body.appendChild(el);
        this.el = el;
        this._title = el.querySelector(".dwu-title");
        this._realmsEl = el.querySelector(".dwm-realms");
        this._stage = el.querySelector(".dwm-stage");
        this._tc = el.querySelector(".dwm-t");
        this._mc = el.querySelector(".dwm-m");
        this._legend = el.querySelector(".dwm-legend");
        this._markBox = el.querySelector(".dwm-mark");
        this._markName = el.querySelector(".dwm-mn");
        this._markSub = el.querySelector(".dwm-ms");
        this._tctx = this._tc.getContext ? this._tc.getContext("2d") : null;
        this._mctx = this._mc.getContext ? this._mc.getContext("2d") : null;
        this._tc.width = this._tc.height = MAP_GRID;

        this.isOpen = false;
        /** The realm the map shows (a tab may show another than the live one). */
        this.realm = "cold";
        /** CSS size of the square stage, and the marks canvas scale. */
        this._size = 600;
        this._dpr = 1;
        this._font = '11px "Segoe UI", system-ui, sans-serif';
        /** Per-realm baked relief: {canvas, bake} (offscreen canvases). */
        this._relief = { cold: null, sand: null, ash: null };
        /** The marker table (rebuilt on events): see _buildMarkers. */
        this.markers = null;
        this._dirty = false;
        this._markT = 0;
        this._bossState = "";
        this._portalOpen = false;
        /** Probe surface. */
        this.stats = { opens: 0, closes: 0, bakes: 0, builds: 0, draws: 0, pins: 0, lastPick: null, closedBy: "" };

        this._onKey = (e) => this._key(e);
        el.addEventListener("click", (e) => this._click(e));

        const B = this.bus;
        const dirty = () => { if (this.isOpen) this._dirty = true; };
        this._offs = [
            B.on("ui:open", (p) => {
                if (!p) return;
                if (p.panel === "map") { if (!this.isOpen) this.open(p.realm); return; }
                if (this.isOpen && (p.panel === "boon" || p.panel === "shrine" || p.panel === "journal")) {
                    this.close(p.panel);
                }
            }),
        ];
        const evs = ["shrine:activated", "cache:discovered", "cache:opened", "trial:finished",
            "bounty:revealed", "bounty:killed", "quest:waypoint", "waypoint:pin", "realm:entered",
            "boss:killed", "portal:entered", "shrine:travelled"];
        for (let i = 0; i < evs.length; i++) this._offs.push(B.on(evs[i], dirty));
        ctx.worldMap = this;
    }

    /** @param {string} [realm] the tab to show (default: the live realm) */
    open(realm) {
        if (this.isOpen) { if (realm) this.showRealm(realm); return true; }
        if (!panelMayOpen(this.ctx)) return false;
        this.isOpen = true;
        this.stats.opens++;
        const live = this._live();
        this.realm = REALMS.indexOf(realm) >= 0 && openRealms(this.ctx).indexOf(realm) >= 0 ? realm : live;
        this.el.classList.add("open");
        openPanel("map", this._onKey, { cursor: true });
        this._layout();
        this._showRealm();
        this.bus.emit("ui:open", { panel: "map", realm: this.realm });
        return true;
    }

    /** @param {string} [by] */
    close(by) {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.stats.closes++;
        this.stats.closedBy = by || "api";
        this.el.classList.remove("open");
        closePanel("map");
        this.bus.emit("ui:close", { panel: "map" });
        if ((by === "key" || by === "click") && !anyModalOpen() && !this.input.panel && shellPlaying()) {
            requestLock();
        }
    }

    toggle(realm) { if (this.isOpen) this.close("key"); else this.open(realm); }

    /** Switch the realm tab. @param {string} realm */
    showRealm(realm) {
        if (openRealms(this.ctx).indexOf(realm) < 0) return false;
        this.realm = realm;
        this._showRealm();
        return true;
    }

    /**
     * Mark a shrine (the click path, exposed for probes / the journal).
     * Marking the already-marked shrine unmarks it.
     * @param {string} realm @param {string} id @returns {boolean} marked
     */
    pinShrine(realm, id) {
        const pos = this.ctx.shrine ? this.ctx.shrine.positions : null;
        let p = null;
        if (pos) for (let i = 0; i < pos.length; i++) if (pos[i].id === id) p = pos[i];
        if (!p) return false;
        const tr = this.ctx.questTracker;
        if (tr && tr.pin.on && tr.pin.id === id && tr.pin.realm === realm) {
            this.bus.emit("waypoint:pin", null);
            this.stats.lastPick = { realm, id, unpinned: true };
            return false;
        }
        const r = STORY.shrines && STORY.shrines[realm] ? STORY.shrines[realm][id] : null;
        this.bus.emit("waypoint:pin", { x: p.x, z: p.z, realm, label: r ? r.name : id, id });
        this.stats.pins++;
        this.stats.lastPick = { realm, id };
        return true;
    }

    /** @param {number} dt */
    update(dt) {
        if (!this.isOpen) {
            if (dt !== 0 && this.input.mapPressed && panelMayOpen(this.ctx) && !this.input.panel) this.open();
            return;
        }
        // An arena arming or a gate opening is not a bus event: two compares.
        const Bo = this.ctx.bosses, G = this.ctx.portal;
        const bs = Bo ? Bo.state : "", po = !!(G && G.isOpen);
        if (bs !== this._bossState || po !== this._portalOpen) {
            this._bossState = bs;
            this._portalOpen = po;
            this._dirty = true;
        }
        if (this._dirty) {
            this._dirty = false;
            this._buildMarkers();
            this._drawMarks();
            return;
        }
        // The rider keeps moving under a non-modal panel: redraw the marks
        // layer (no allocation) at MARK_PERIOD.
        this._markT += dt > 0 ? dt : 0;
        if (this._markT >= MARK_PERIOD && this.realm === this._live()) {
            this._markT = 0;
            this._drawMarks();
        }
    }

    /** @param {string} token */
    setRealm(token) { if (this.isOpen) this._dirty = true; }

    dispose() {
        this.close("api");
        for (let i = 0; i < this._offs.length; i++) this._offs[i]();
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }

    // ============================================================ internals

    _live() { return this.ctx.getRealm ? this.ctx.getRealm() : "cold"; }

    _R() {
        const T = this.ctx.terrain;
        return T && T.playRadius > 0 ? T.playRadius : 620;
    }

    /** Size the stage square to the card (CSS px) and the marks canvas. */
    _layout() {
        const W = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1280;
        const H = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 720;
        const cardW = Math.min(1200, W - 32), cardH = Math.min(780, H - 32);
        // head ~64, foot ~30, padding ~44: what is left is the stage height.
        const s = Math.max(240, Math.min(cardH - 150, cardW - 44 - 16 - 230));
        this._size = Math.floor(s);
        this._stage.style.width = this._size + "px";
        this._stage.style.height = this._size + "px";
        this._dpr = Math.min(2, typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1);
        this._mc.width = this._mc.height = Math.round(this._size * this._dpr);
        this._font = Math.round(11 * this._dpr) + 'px "Segoe UI", system-ui, sans-serif';
    }

    _showRealm() {
        const realm = this.realm;
        this.el.style.setProperty("--dwu-accent", realmAccent(this.ctx, realm));
        this._title.textContent = realmLabel(this.ctx, realm) + (realm === this._live() ? "" : "  ·  across the Drift");
        // Realm tabs.
        const open = openRealms(this.ctx);
        let h = "";
        for (let i = 0; i < open.length; i++) {
            h += '<button class="dwu-tab' + (open[i] === realm ? " cur" : "") + '" data-realm="' + open[i] +
                '"><span>' + (REALMS.indexOf(open[i]) + 1) + "</span>" + esc(realmLabel(this.ctx, open[i])) + "</button>";
        }
        this._realmsEl.innerHTML = h;
        this._bakeRelief(realm);
        this._buildMarkers();
        this._drawMarks();
    }

    /** Shade the realm's relief once per terrain bake (live realm only). */
    _bakeRelief(realm) {
        const g = this._tctx;
        const T = this.ctx.terrain;
        let rel = this._relief[realm];
        const live = realm === this._live();
        const bake = T && typeof T.rebakeCount === "number" ? T.rebakeCount : 0;
        if (live && T && T.heightAt && (!rel || rel.bake !== bake)) {
            rel = this._relief[realm] = this._shade(realm, bake);
        }
        this._stage.classList.toggle("uncharted", !rel);
        if (!g) return;
        g.clearRect(0, 0, MAP_GRID, MAP_GRID);
        if (rel && rel.img) g.putImageData(rel.img, 0, 0);
    }

    /** @param {string} realm @param {number} bake */
    _shade(realm, bake) {
        const T = this.ctx.terrain;
        const N = MAP_GRID;
        const R = this._R();
        const step = (R * 2) / (N - 1);
        // A 4-tap box average per cell: a ~10 m grid point-sampled aliases
        // the sastrugi into noise (run 1 screenshot); the map wants landforms.
        const q = step * 0.3;
        const hs = new Float32Array(N * N);
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j < N; j++) {
            const z = -R + j * step;
            for (let i = 0; i < N; i++) {
                const x = -R + i * step;
                const h = 0.25 * (T.heightAt(x - q, z - q) + T.heightAt(x + q, z - q) +
                    T.heightAt(x - q, z + q) + T.heightAt(x + q, z + q));
                hs[j * N + i] = h;
                if (x * x + z * z <= R * R) {
                    if (h < lo) lo = h;
                    if (h > hi) hi = h;
                }
            }
        }
        const g = this._tctx;
        const img = g && g.createImageData ? g.createImageData(N, N) : { data: new Uint8ClampedArray(N * N * 4) };
        const d = img.data;
        const tint = TINT[realm] || TINT.cold;
        const span = hi - lo > 1e-3 ? hi - lo : 1;
        for (let j = 0; j < N; j++) {
            const jm = j > 0 ? j - 1 : j, jp = j < N - 1 ? j + 1 : j;
            for (let i = 0; i < N; i++) {
                const o = (j * N + i) * 4;
                const x = -R + i * step, z = -R + j * step;
                if (x * x + z * z > R * R) { d[o + 3] = 0; continue; }
                const im = i > 0 ? i - 1 : i, ip = i < N - 1 ? i + 1 : i;
                const h = hs[j * N + i];
                // Central differences; a north-west sun (the minimap's).
                const hx = (hs[j * N + ip] - hs[j * N + im]) / ((ip - im) * step);
                const hz = (hs[jp * N + i] - hs[jm * N + i]) / ((jp - jm) * step);
                const lit = Math.max(0.55, Math.min(1.12, 0.86 + 1.6 * (hx * -0.7 + hz * -0.7)));
                // Hypsometric base: hollows deep blue-grey, crests bright.
                const e = 0.42 + 0.58 * ((h - lo) / span);
                const v = (58 + 172 * e) * lit;
                d[o] = Math.min(255, v * 0.86 * tint[0] + 8);
                d[o + 1] = Math.min(255, v * 0.94 * tint[1] + 12);
                d[o + 2] = Math.min(255, v * tint[2] + 22);
                d[o + 3] = 240;
            }
        }
        this.stats.bakes++;
        return { img, bake, lo, hi };
    }

    /**
     * The marker table for the shown realm (event-rate; list() calls
     * allocate). Every entry: {k: kind, x, z, s: state, label, id}.
     */
    _buildMarkers() {
        const ctx = this.ctx;
        const realm = this.realm;
        const live = realm === this._live();
        const P = ctx.progression;
        const m = { realm, shrines: [], caches: [], trials: [], bounties: [], bosses: [], portal: null, counts: {} };
        const pos = ctx.shrine && ctx.shrine.positions ? ctx.shrine.positions : [];
        let lit = 0;
        for (let i = 0; i < pos.length; i++) {
            const p = pos[i];
            const on = P && P.isShrineLit ? P.isShrineLit(realm, p.id) : false;
            if (on) lit++;
            const r = STORY.shrines && STORY.shrines[realm] ? STORY.shrines[realm][p.id] : null;
            m.shrines.push({ k: "shrine", x: p.x, z: p.z, s: on ? 1 : 0, label: r ? r.name : p.id, id: p.id });
        }
        const C = ctx.caches;
        let seen = 0, opened = 0;
        if (C && C.list) {
            const L = C.list(realm);
            for (let i = 0; i < L.length; i++) {
                if (L[i].opened) opened++;
                if (!L[i].discovered && !L[i].opened) continue;
                seen++;
                m.caches.push({ k: "cache", x: L[i].x, z: L[i].z, s: L[i].opened ? 0 : 1,
                    label: L[i].landmark || "", id: String(L[i].site) });
            }
        }
        const T = ctx.trials;
        if (T && T.list) {
            const L = T.list(realm);
            for (let i = 0; i < L.length; i++) {
                if (!L[i].built || L[i].x === null) continue;
                m.trials.push({ k: "trial", x: L[i].x, z: L[i].z, s: L[i].medal | 0, label: L[i].name, id: L[i].id });
            }
        }
        const Bn = ctx.bounties;
        const known = !P || !P.isShrineLit || P.isShrineLit(realm, SPAWN);
        if (Bn && Bn.list && known) {
            const L = Bn.list(realm);
            for (let i = 0; i < L.length; i++) {
                if (L[i].x === null) continue;
                m.bounties.push({ k: "bounty", x: L[i].x, z: L[i].z, s: L[i].killed ? 0 : 1, label: L[i].name, id: L[i].id });
            }
        }
        const Bo = ctx.bosses;
        if (live && Bo && typeof Bo.armedArena === "function") {
            const kinds = ["mini", "realm"];
            for (let i = 0; i < 2; i++) {
                if (!Bo.armedArena(kinds[i])) continue;
                const st = Bo.stats;
                m.bosses.push({ k: "boss", x: Bo.ax, z: Bo.az, s: 1, label: st && st.name ? st.name : "Arena", id: kinds[i] });
            }
        }
        const G = ctx.portal;
        if (live && G && G.isOpen) m.portal = { k: "portal", x: G.x, z: G.z, s: 1, label: "Portal", id: "portal" };
        m.counts = { lit, shrines: pos.length, cachesSeen: seen, cachesOpened: opened,
            trials: m.trials.length, bounties: m.bounties.length, bosses: m.bosses.length, portal: !!m.portal };
        this.markers = m;
        this.stats.builds++;
        this._writeLegend();
    }

    _writeLegend() {
        const m = this.markers;
        const c = m.counts;
        const row = (g, label, n) => '<div class="dwm-leg">' + g + "<span>" + esc(label) + "</span>" +
            (n !== undefined ? "<b>" + esc(n) + "</b>" : "") + "</div>";
        let h = "";
        if (m.realm === this._live()) h += row(GLYPH.you, "You", undefined);
        h += row(GLYPH.lit, "Shrine, awakened", c.lit + " / " + c.shrines);
        h += row(GLYPH.dormant, "Shrine, dormant", String(c.shrines - c.lit));
        h += row(GLYPH.cache, "Relic cache", String(c.cachesSeen - c.cachesOpened));
        h += row(GLYPH.opened, "Cache, opened", String(c.cachesOpened));
        h += row(GLYPH.trial, "Wake Trial start", String(c.trials));
        h += row(GLYPH.bounty, "Bounty", String(c.bounties));
        if (c.bosses) h += row(GLYPH.boss, "Warden's arena", String(c.bosses));
        if (c.portal) h += row(GLYPH.portal, "Portal", undefined);
        h += row(GLYPH.wp, "Tracked waypoint", undefined);
        this._legend.innerHTML = h;
        const tr = this.ctx.questTracker;
        const pin = tr ? tr.pin : null;
        const on = !!(pin && pin.on);
        this._markBox.classList.toggle("on", on);
        if (on) {
            this._markName.textContent = "Marked · " + pin.label;
            this._markSub.textContent = (pin.realm === this._live() ? "" : realmLabel(this.ctx, pin.realm) + " · ") +
                "The beacon and the compass lead there until you arrive.";
        }
    }

    /** World (x, z) -> marks-canvas px. */
    _px(x) { return ((x / this._R()) * 0.5 + 0.5) * this._size * this._dpr; }

    /** Draw every marker + the rider (allocation-free). */
    _drawMarks() {
        const g = this._mctx;
        const m = this.markers;
        if (!g || !m) return;
        this.stats.draws++;
        const S = this._size * this._dpr;
        const u = this._dpr;
        g.clearRect(0, 0, S, S);
        // The storm edge ring.
        g.beginPath();
        g.arc(S / 2, S / 2, S / 2 - 2 * u, 0, Math.PI * 2);
        g.lineWidth = 3 * u;
        g.strokeStyle = "rgba(170, 200, 225, 0.25)";
        g.stroke();
        const accent = realmAccent(this.ctx, m.realm);
        // Caches.
        for (let i = 0; i < m.caches.length; i++) {
            const c = m.caches[i];
            const x = this._px(c.x), y = this._px(c.z);
            g.beginPath();
            g.arc(x, y, 4.5 * u, 0, Math.PI * 2);
            if (c.s) {
                g.fillStyle = "#ffde96"; g.fill();
                g.lineWidth = 1.4 * u; g.strokeStyle = "#281a08"; g.stroke();
            } else {
                g.lineWidth = 1.6 * u; g.strokeStyle = "rgba(255, 222, 150, 0.55)"; g.stroke();
            }
        }
        // Trials.
        for (let i = 0; i < m.trials.length; i++) {
            const t = m.trials[i];
            g.beginPath();
            g.arc(this._px(t.x), this._px(t.z), 7 * u, 0, Math.PI * 2);
            g.lineWidth = 2.6 * u; g.strokeStyle = MEDAL[Math.min(3, t.s)]; g.stroke();
        }
        // Bounties.
        for (let i = 0; i < m.bounties.length; i++) {
            const b = m.bounties[i];
            const x = this._px(b.x), y = this._px(b.z);
            g.beginPath();
            g.moveTo(x, y - 7 * u); g.lineTo(x + 7 * u, y); g.lineTo(x, y + 7 * u); g.lineTo(x - 7 * u, y);
            g.closePath();
            g.fillStyle = b.s ? "#ff6e50" : "rgba(150, 150, 150, 0.6)"; g.fill();
            if (b.s) { g.beginPath(); g.arc(x, y, 2 * u, 0, Math.PI * 2); g.fillStyle = "#1e0804"; g.fill(); }
        }
        // Boss arenas.
        for (let i = 0; i < m.bosses.length; i++) {
            const b = m.bosses[i];
            const x = this._px(b.x), y = this._px(b.z);
            g.beginPath(); g.arc(x, y, 11 * u, 0, Math.PI * 2);
            g.lineWidth = 2.4 * u; g.strokeStyle = "#ff8c5a"; g.stroke();
            g.beginPath(); g.arc(x, y, 3.5 * u, 0, Math.PI * 2); g.fillStyle = "#ff8c5a"; g.fill();
        }
        if (m.portal) {
            const x = this._px(m.portal.x), y = this._px(m.portal.z);
            g.beginPath(); g.ellipse(x, y, 6 * u, 10 * u, 0, 0, Math.PI * 2);
            g.lineWidth = 2.6 * u; g.strokeStyle = "#c8a6ff"; g.stroke();
        }
        // Shrines with their names.
        g.font = this._font;
        g.textAlign = "center";
        for (let i = 0; i < m.shrines.length; i++) {
            const s = m.shrines[i];
            const x = this._px(s.x), y = this._px(s.z);
            g.beginPath();
            g.moveTo(x, y - 10 * u); g.lineTo(x + 8 * u, y); g.lineTo(x, y + 10 * u); g.lineTo(x - 8 * u, y);
            g.closePath();
            g.lineWidth = 2 * u;
            if (s.s) { g.fillStyle = accent; g.fill(); g.strokeStyle = "#06121a"; }
            else g.strokeStyle = "rgba(190, 210, 225, 0.8)";
            g.stroke();
            g.fillStyle = s.s ? "rgba(240, 248, 253, 0.92)" : "rgba(205, 228, 244, 0.55)";
            g.fillText(s.label, x, y + 24 * u);
        }
        // The tracked waypoint (pin or quest), this realm only.
        const tr = this.ctx.questTracker;
        const t = tr ? tr.target : null;
        if (t && t.valid && t.realm === m.realm) {
            // A pin: the star rides 16 px above the point on a stem, so it
            // never hides the shrine (or pack, or gate) it marks.
            const x = this._px(t.x), y0 = this._px(t.z), y = y0 - 16 * u;
            g.beginPath();
            g.moveTo(x, y0); g.lineTo(x, y + 6 * u);
            g.lineWidth = 2 * u; g.strokeStyle = t.pinned ? "#ffeeb0" : "#ebfaff"; g.stroke();
            g.beginPath();
            for (let j = 0; j < 8; j++) {
                const a = j * (Math.PI / 4) - Math.PI / 2;
                const r = ((j & 1) ? 4 : 11) * u;
                if (j === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
                else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            }
            g.closePath();
            g.fillStyle = t.pinned ? "#ffeeb0" : "#ebfaff"; g.fill();
            g.lineWidth = 1.6 * u; g.strokeStyle = "#06121a"; g.stroke();
        }
        // The rider.
        const c = this.ctx.character;
        if (c && m.realm === this._live()) {
            const x = this._px(c.position.x), y = this._px(c.position.z);
            const f = c.facing || 0;
            g.save();
            g.translate(x, y);
            // PORT FRAME (minimap.js): forward = (sin f, -cos f); canvas y = world z.
            g.rotate(Math.atan2(-Math.cos(f), Math.sin(f)) + Math.PI / 2);
            g.beginPath();
            g.moveTo(0, -12 * u); g.lineTo(8 * u, 9 * u); g.lineTo(0, 4 * u); g.lineTo(-8 * u, 9 * u);
            g.closePath();
            g.fillStyle = "#d5eefc"; g.fill();
            g.lineWidth = 2 * u; g.strokeStyle = "#0a121a"; g.stroke();
            g.restore();
        }
    }

    /**
     * The shrine nearest a stage point (CSS px from the stage's top-left), if
     * within PICK_PX. @param {number} px @param {number} py
     * @returns {{realm:string, id:string}|null}
     */
    shrineAt(px, py) {
        const m = this.markers;
        if (!m) return null;
        const R = this._R();
        let best = null, bd = PICK_PX * PICK_PX;
        for (let i = 0; i < m.shrines.length; i++) {
            const s = m.shrines[i];
            const x = ((s.x / R) * 0.5 + 0.5) * this._size;
            const y = ((s.z / R) * 0.5 + 0.5) * this._size;
            const d = (x - px) * (x - px) + (y - py) * (y - py);
            if (d < bd) { bd = d; best = { realm: m.realm, id: s.id }; }
        }
        return best;
    }

    /** @param {MouseEvent} e */
    _click(e) {
        const t = /** @type {any} */ (e.target);
        if (!t || !t.closest) return;
        const rb = t.closest("[data-realm]");
        if (rb) { this.showRealm(rb.dataset.realm); return; }
        const a = t.closest("[data-act]");
        if (a && a.dataset.act === "unpin") { this.bus.emit("waypoint:pin", null); return; }
        if (t === this._mc || t === this._tc || t === this._stage) {
            const r = this._stage.getBoundingClientRect();
            const px = (e.clientX - r.left) * (this._size / (r.width || this._size));
            const py = (e.clientY - r.top) * (this._size / (r.height || this._size));
            const hit = this.shrineAt(px, py);
            if (hit) this.pinShrine(hit.realm, hit.id);
            return;
        }
        if (t.classList && t.classList.contains("dwu-scrim")) this.close("click");
    }

    /** @param {KeyboardEvent} e */
    _key(e) {
        if (!this.isOpen || e.repeat) return;
        const c = e.code;
        if (c === "Escape" || c === "KeyM") { this.close(c === "Escape" ? "esc" : "key"); return; }
        if (c === "KeyJ") {
            this.close("journal");
            this.bus.emit("ui:open", { panel: "journal" });
            return;
        }
        if (c === "KeyC") { this.bus.emit("waypoint:pin", null); return; }
        const d = /^Digit([1-3])$/.exec(c);
        if (d) this.showRealm(REALMS[+d[1] - 1]);
    }
}
