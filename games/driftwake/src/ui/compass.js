/**
 * THE COMPASS TICK — QUEST_DESIGN §7 "WAYPOINT (b): a small HUD compass tick
 * at the top edge of the screen showing its bearing when it is off-screen".
 *
 * The world-space beacon (world/beacon.js) is the guide while the target is
 * in view; the moment its bearing leaves the camera's horizontal field of
 * view this tick appears on the top edge, slid toward the side to turn to:
 * bearing 0 is the centre, +-90 deg and beyond pin it to the ends of a rail
 * kept clear of the vitals (top-left) and the quest tracker (top-right), with
 * the chevron turned outward when the target is behind. A small distance
 * readout rides under it.
 *
 * Reads `ctx.questTracker.target` (the effective waypoint: a map pin over the
 * quest's own) and the camera's world matrix — no projection, no terrain
 * sample: the beacon is a 110 m column, so "on screen" is a bearing test
 * against the horizontal half-FOV. Allocation-free; the DOM is written only
 * when the whole-pixel offset, the behind flag or the whole metre changes.
 *
 * MODULE SHAPE: constructor(ctx), update(dt) — the visibility poll runs at
 * any dt (the HUD rule), the rest only when dt > 0. ctx: rig, character,
 * questTracker, input, overlay, getRealm.
 */

import { input as coreInput } from "../core/input.js";
import { hudShown, realmAccent } from "./questTracker.js";

/** Rail half-width cap, px, and the clearance kept at each screen side. */
const RAIL_MAX = 360;
const SIDE_CLEAR = 330;
/** The tick hides a little INSIDE the FOV edge so it never doubles the beacon
 *  at the very edge of the frame. */
const FOV_MARGIN = 0.9;

const CSS = `
#dw-compass {
  position: fixed; left: 50%; top: 6px; width: 0; height: 0;
  z-index: 56; pointer-events: none;
  opacity: 0; transition: opacity 160ms ease;
  --cp-accent: #a8dcf5;
}
#dw-compass.show { opacity: 0.95; }
#dw-compass .cp-tick {
  position: absolute; left: 0; top: 0;
  width: 0; height: 0; will-change: transform;
}
#dw-compass svg {
  position: absolute; left: -11px; top: 0; width: 22px; height: 16px;
  fill: var(--cp-accent); stroke: rgba(6, 12, 18, 0.9); stroke-width: 1.4;
  filter: drop-shadow(0 0 4px rgba(150, 215, 255, 0.55));
  transition: transform 160ms ease;
}
#dw-compass.left svg { transform: rotate(90deg); }
#dw-compass.right svg { transform: rotate(-90deg); }
#dw-compass .cp-dist {
  position: absolute; left: -40px; top: 17px; width: 80px; text-align: center;
  font: 600 10.5px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.04em;
  color: rgba(240, 248, 253, 0.92); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  font-variant-numeric: tabular-nums;
}
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-compass-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

/**
 * Pure bearing math (exported for the Node probe): the signed angle of the
 * target off the camera's flat forward (radians, + = to the right) and
 * whether it is inside the horizontal half-FOV.
 * @param {Float32Array|number[]} e camera matrixWorld.elements
 * @param {number} tx @param {number} tz target
 * @param {number} halfH horizontal half-FOV, radians
 * @param {{rel:number, onScreen:boolean}} out
 * @returns {{rel:number, onScreen:boolean}}
 */
export function bearingOf(e, tx, tz, halfH, out) {
    const dx = tx - e[12], dz = tz - e[14];
    // Camera right = +X column, forward = -Z column (Three's convention).
    let rx = e[0], rz = e[2];
    let fx = -e[8], fz = -e[10];
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    const fl = Math.sqrt(fx * fx + fz * fz) || 1;
    rx /= rl; rz /= rl; fx /= fl; fz /= fl;
    const lat = dx * rx + dz * rz;
    const ahead = dx * fx + dz * fz;
    const rel = Math.atan2(lat, ahead);
    out.rel = rel;
    out.onScreen = Math.abs(rel) < halfH * FOV_MARGIN;
    return out;
}

/**
 * Rail offset, px, for a bearing: linear to +-90 deg, pinned beyond.
 * @param {number} rel radians @param {number} railHalf px @returns {number}
 */
export function railX(rel, railHalf) {
    let u = rel / (Math.PI / 2);
    if (u > 1) u = 1; else if (u < -1) u = -1;
    return Math.round(u * railHalf);
}

export class Compass {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.input = ctx.input || coreInput;
        const el = document.createElement("div");
        el.id = "dw-compass";
        el.innerHTML = '<div class="cp-tick"><svg viewBox="0 0 22 16" aria-hidden="true">' +
            '<path d="M2 2h18L11 14z"/></svg><div class="cp-dist"></div></div>';
        document.body.appendChild(el);
        this.el = el;
        this._tick = el.querySelector(".cp-tick");
        this._distEl = el.querySelector(".cp-dist");
        this._show = false;
        this._px = 1e9;
        this._side = 0;          // -1 left (behind), 0 none, +1 right (behind)
        this._m = -2;
        this._b = { rel: 0, onScreen: true };
        this._realm = "";
        /** Probe surface: the last computed bearing and visibility. */
        this.stats = { rel: 0, onScreen: true, px: 0, visible: false, writes: 0 };
    }

    /** @param {number} dt */
    update(dt) {
        const tr = this.ctx.questTracker;
        const t = tr ? tr.target : null;
        const realm = this.ctx.getRealm ? this.ctx.getRealm() : (tr ? tr.realm : "cold");
        let want = hudShown(this.input, this.ctx.overlay) && !!t && t.valid && t.realm === realm;
        if (want && dt !== 0) {
            const rig = this.ctx.rig;
            const cam = rig ? rig.camera : null;
            if (!cam) {
                want = false;
            } else {
                const vh = (cam.fov * Math.PI) / 180;
                const halfH = Math.atan(Math.tan(vh / 2) * (cam.aspect || 1.7778));
                const b = bearingOf(cam.matrixWorld.elements, t.x, t.z, halfH, this._b);
                this.stats.rel = b.rel;
                this.stats.onScreen = b.onScreen;
                if (b.onScreen) {
                    want = false;
                } else {
                    const W = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1280;
                    const half = Math.max(80, Math.min(RAIL_MAX, W / 2 - SIDE_CLEAR));
                    const px = railX(b.rel, half);
                    if (px !== this._px) {
                        this._px = px;
                        this.stats.px = px;
                        this.stats.writes++;
                        this._tick.style.transform = "translateX(" + px + "px)";
                    }
                    const behind = Math.abs(b.rel) > Math.PI / 2;
                    const side = behind ? (b.rel > 0 ? 1 : -1) : 0;
                    if (side !== this._side) {
                        this._side = side;
                        this.el.classList.toggle("left", side < 0);
                        this.el.classList.toggle("right", side > 0);
                    }
                    const c = this.ctx.character;
                    if (c) {
                        const dx = t.x - c.position.x, dz = t.z - c.position.z;
                        const m = Math.round(Math.sqrt(dx * dx + dz * dz));
                        if (m !== this._m) {
                            this._m = m;
                            this._distEl.textContent = m + " m";
                        }
                    }
                }
            }
        } else if (dt === 0) {
            // Paused: keep whatever the last live frame decided, unless the
            // HUD itself is hidden.
            want = want && this._show;
        }
        if (realm !== this._realm) {
            this._realm = realm;
            this.el.style.setProperty("--cp-accent", realmAccent(this.ctx, realm));
        }
        if (want !== this._show) {
            this._show = want;
            this.stats.visible = want;
            this.el.classList.toggle("show", want);
        }
    }

    /** @param {string} token */
    setRealm(token) { this._realm = ""; }

    dispose() {
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
}
