/**
 * The idle water weave — a thin strand of live water the rider plays with
 * while the hand-wave idle (or a carve, or a cast) has the palms free.
 *
 * Owner direction 2026-08-05: the first pass used spray droplets and read as
 * SNOW; "see what we do for spell 2". So this is literally spell 2's
 * renderer: one WaterBody strand (PROFILE_TUBE, near-clear milkiness), a
 * spine woven between the two palms with a travelling figure-eight, radius
 * pinched to ~0 at each palm so the tube reads as held at the hands. The
 * whole effect is one strand out of the eight, costs nothing in the render
 * path beyond the columns it writes, and releases the strand the moment the
 * blend dies so spells never starve.
 *
 * Driven by `controller.idleFx` (written by meshChar: idle weight, carve
 * presence, cast weight — whichever has the hands free and expressive).
 */

import { PROFILE_TUBE } from "./waterBody.js";
import { clamp01, expDamp } from "./bending.js";

/** Spine columns. 26 of the strand table's 64 — plenty for a 1 m weave. */
const COLS = 26;

const _hL = new Float32Array(3);
const _hR = new Float32Array(3);

export class HandWeave {
    /** @param {import("./spellSystem.js").SpellContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.strand = -1;
        /** Eased 0..1 presence — never a switch. */
        this.blend = 0;
        this._phase = 0;
    }

    /**
     * @param {number} dt
     * @param {number} fx 0..1 gate from the controller (meshChar writes it)
     * @returns {void}
     */
    update(dt, fx) {
        const want = fx > 0.3 ? clamp01((fx - 0.3) / 0.5) : 0;
        this.blend = expDamp(this.blend, want, want > this.blend ? 5.0 : 7.0, dt);

        if (this.blend < 0.02) {
            if (this.strand >= 0) {
                this.ctx.water.release(this.strand);
                this.strand = -1;
            }
            return;
        }
        if (this.strand < 0) this.strand = this.ctx.water.acquire();
        if (this.strand < 0) return;   // pool exhausted: spells win, we wait

        this._phase += dt;
        const ctx = this.ctx;
        ctx.handPosition(0, _hL, 0);
        ctx.handPosition(1, _hR, 0);

        // Axis between the palms, and a horizontal perpendicular for the
        // weave plane. Degenerate axis (palms together) falls back to world X.
        let axx = _hR[0] - _hL[0], axy = _hR[1] - _hL[1], axz = _hR[2] - _hL[2];
        const axl = Math.hypot(axx, axy, axz);
        if (axl > 1e-4) { axx /= axl; axy /= axl; axz /= axl; }
        else { axx = 1; axy = 0; axz = 0; }
        // perpendicular = axis x up, then re-derived up = perp x axis
        let pxv = -axz, pyv = 0, pzv = axx;
        const pl = Math.hypot(pxv, pyv, pzv) || 1;
        pxv /= pl; pzv /= pl;

        const s = this.strand;
        const t = this._phase;
        const w = ctx.water;
        const amp = 0.085 * this.blend;
        let px = _hL[0], py = _hL[1], pz = _hL[2];
        let dist = 0;
        for (let c = 0; c < COLS; c++) {
            const u = c / (COLS - 1);
            // Palm-to-palm base path, eased so the ends dwell at the hands.
            const e = u * u * (3 - 2 * u);
            let x = _hL[0] + (_hR[0] - _hL[0]) * e;
            let y = _hL[1] + (_hR[1] - _hL[1]) * e;
            let z = _hL[2] + (_hR[2] - _hL[2]) * e;
            // Travelling figure-eight about the axis, pinned at the palms by
            // the sin(pi*u) envelope: lateral out-of-line sway plus a vertical
            // loop at twice the rate — the classic lissajous water play.
            const env = Math.sin(Math.PI * u);
            const ph = t * 2.6 + u * Math.PI * 2.0;
            const lat = Math.sin(ph) * amp * env;
            const ver = Math.sin(ph * 2.0 + 0.7) * amp * 0.7 * env;
            x += pxv * lat; z += pzv * lat; y += ver;

            // Mass conservation read: thin where the weave moves fast (the
            // middle), fuller near the palms where it gathers.
            const radius = (0.010 + 0.020 * env) * this.blend;
            const seg = Math.hypot(x - px, y - py, z - pz);
            dist += seg;
            px = x; py = y; pz = z;

            w.column(
                s, c, x, y, z, radius,
                pxv, 0, pzv,                       // reference right
                ph * 0.35,                          // section roll travels
                dist,
                u,                                  // age along the strand
                0.08 * env,                         // faint foam mid-weave
                1.0                                 // round section
            );
        }
        // Near-clear water, spell-2's own look (its held tube runs 0.12-0.14).
        w.setParams(s, PROFILE_TUBE, 0.12, clamp01(this.blend * 1.2), COLS);
    }
}
