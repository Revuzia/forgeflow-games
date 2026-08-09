/**
 * Spell 3 — Bloom.
 *
 * A targeted eruption. A column of powder and water bursts up out of the drift,
 * blowing a crater with a raised rim, then falls back as a slow glittering
 * curtain of fallout.
 *
 * Three things run on different clocks and that is the whole design:
 *
 *   the column   fast. Up in a third of a second, held for a beat, then it
 *                collapses back down its own axis rather than fading — the mass
 *                goes back where it came from.
 *   the crater   instant, and permanent. One brush, at the moment of the burst.
 *   the fallout  slow. Seconds of it, and it is what the player is actually
 *                looking at for most of the spell. A burst with no fallout is a
 *                flash; a burst with fallout is weather.
 *
 * The column leans. A perfectly vertical cylinder of water reads as a rendered
 * primitive no matter what is on it, and two degrees of drift with a little sway
 * takes that away completely.
 */

import { PROFILE_TUBE } from "./waterBody.js";
import { clamp01, smooth01, bell, transport, rand } from "./bending.js";

const COLS = 34;
/** Full height of the column at peak, metres. */
const HEIGHT = 5.6;
/**
 * Radius of the column at its widest, metres.
 *
 * An eruption is a *mass* of material leaving the ground, and the aspect ratio is
 * most of what says so. The water material's absorption is keyed to the radius as
 * well, so a thin column is also a colourless one.
 */
const GIRTH = 0.66;
/** Seconds from cast to the column being gone. */
const LIFE = 1.75;
/** Seconds of fallout after that. */
const FALLOUT = 3.4;

const _rgt = new Float32Array(3);

export class Bloom {
    /** @param {import("./spellSystem.js").SpellContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.active = false;
        this.strand = -1;

        this.t = 0;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this._leanX = 0;
        this._leanZ = 0;
        this._burst = false;
        this._curtainOwed = 0;
    }

    /** @param {number} x @param {number} y @param {number} z ground target */
    trigger(x, y, z) {
        if (this.strand < 0) this.strand = this.ctx.water.acquire();
        this.x = x;
        this.y = y;
        this.z = z;
        this.t = 0;
        this._burst = false;
        this._curtainOwed = 0;
        // A different lean each cast, so two Blooms in the same place are not the
        // same object twice.
        const a = rand() * Math.PI * 2;
        this._leanX = Math.cos(a) * 0.16;
        this._leanZ = Math.sin(a) * 0.16;
        this.active = true;
    }

    /** @param {number} dt */
    update(dt) {
        if (!this.active) return;
        this.t += dt;

        if (this.t >= LIFE + FALLOUT) {
            this._end();
            return;
        }

        // ---- the burst -----------------------------------------------------
        // Fires ONCE, on the frame the column reaches the surface. Everything that
        // happens at that instant — the crater, the ring of thrown snow, the light
        // spike — happens here rather than at trigger time, so they are all the
        // same event.
        if (!this._burst && this.t >= 0.10) {
            this._burst = true;
            this._crater();
            this._throw();
        }

        this._column();
        this._curtain(dt);
    }

    /**
     * The column.
     *
     * Radius runs wide at the base, waists in the middle and flares at the head,
     * which is what a real ejection does: the mass at the top has had the longest
     * to spread and the least to hold it together.
     */
    _column() {
        const ctx = this.ctx;
        const water = ctx.water;
        const s = this.strand;
        if (s < 0) return;

        const t = this.t;
        // Rise, hold, collapse. The COLLAPSE RUNS THE HEIGHT BACK DOWN rather than
        // fading the alpha, so the column withdraws into the crater.
        const rise = smooth01((t - 0.10) / 0.34);
        const drop = 1 - smooth01((t - 0.95) / 0.80);
        const env = rise * drop;
        if (env <= 0.002) {
            water.setParams(s, PROFILE_TUBE, 0.5, 0, 0);
            return;
        }

        const top = HEIGHT * env;
        const sway = Math.sin(t * 3.1) * 0.12;

        let px = 0, py = 0, pz = 0;
        let rx = 1, ry = 0, rz = 0;
        let t0x = 0, t0y = 1, t0z = 0;

        for (let c = 0; c < COLS; c++) {
            const u = c / (COLS - 1);
            // Column 0 is the HEAD, so `u` runs downward. That matches every other
            // strand in the project — u is always "distance behind the leading
            // edge" — and keeps the relief field drifting the right way.
            const h = 1 - u;
            const y = this.y + top * h;
            const lean = h * h;              // quadratic: the top leans, the foot does not
            const x = this.x + (this._leanX + sway) * lean * top * 0.5;
            const z = this.z + (this._leanZ - sway * 0.6) * lean * top * 0.5;

            if (c > 0) {
                let t1x = x - px, t1y = y - py, t1z = z - pz;
                const l = Math.hypot(t1x, t1y, t1z) || 1e-4;
                t1x /= l; t1y /= l; t1z /= l;
                transport(_rgt, 0, rx, ry, rz, t0x, t0y, t0z, t1x, t1y, t1z);
                rx = _rgt[0]; ry = _rgt[1]; rz = _rgt[2];
                t0x = t1x; t0y = t1y; t0z = t1z;
            } else {
                // Seed frame points DOWN the column, since column 0 is the top.
                rx = 1; ry = 0; rz = 0;
                t0x = 0; t0y = -1; t0z = 0;
            }

            // Flared head, waisted middle, broad foot.
            const shape =
                0.42 + 0.58 * bell(clamp01(h * 1.15))       // waist
                + 0.55 * smooth01((h - 0.72) / 0.28)        // flare at the head
                + 0.75 * (1 - smooth01(h / 0.22));          // broad foot
            // The sin term is a travelling bulge along the column.
            const rad = GIRTH * shape * env * (0.9 + 0.2 * Math.sin(u * 9 + t * 6));

            // The head is where it is coming apart; the foot is where it is
            // grinding against the crater rim.
            const foam = clamp01(0.30 + 0.55 * smooth01((h - 0.55) / 0.45)
                               + 0.4 * (1 - smooth01(h / 0.18)));

            water.column(
                s, c, x, y, z, rad,
                rx, ry, rz, t * 1.5 + u * 4,
                u * top, u, foam, 1
            );

            px = x; py = y; pz = z;
        }

        // Cold 0.42 — a column of powder and water you can see into. Sand and
        // Ash are 0.62 / 0.66: a grit jet and a smoke column occlude far
        // harder, which is what turns the same integral into a blowout and a
        // fumarole rather than a tinted snow bloom.
        const R = ctx.realm;
        water.setParams(s, PROFILE_TUBE, R.milk.bloom, clamp01(env * 1.5), COLS);

        // TWO lights: one down in the crater, one riding the head at 92% of its
        // height. The crater one is what actually lights the rim and the fallout
        // around the base, and it is the reason the effect reads as a hole full of
        // light rather than a bright column standing on dark ground.
        //
        // IN ASH THAT STOPS BEING A LIGHTING TRICK AND BECOMES THE VENT. Held
        // orange at 1.45x, the crater light is what makes the hole read as
        // OPEN rather than shadowed — a fumarole with an incandescent throat.
        // Same two calls, same two slots; only the rgb and the gain move.
        const L = R.light;
        ctx.lights.add(
            this.x, this.y + 0.35, this.z,
            11.0, 0.44 * L.r, 0.78 * L.g, 1.0 * L.b, 22.0 * env * L.mult
        );
        ctx.lights.add(
            this.x + this._leanX * top * 0.5,
            this.y + top * 0.92,
            this.z + this._leanZ * top * 0.5,
            7.5, 0.55 * L.r, 0.82 * L.g, 1.0 * L.b, 9.0 * env * L.mult
        );
    }

    /** The crater: one deep brush, plus a broken outer ring. */
    _crater() {
        const ctx = this.ctx;
        const f = ctx.deform;
        if (f) {
            f.brush(
                this.x, this.z,
                1.15,
                0.52,   // depression
                0.40,   // rim — the mass has to go somewhere and this is where
                0.72,   // packed by the blast
                0.30 * ctx.realm.ice,   // and partly glazed — cold only
                rand() * Math.PI,
                1.15,   // very slightly oval, so it is not a stamped circle
                1.0
            );
            // FOUR smaller brushes rather than one wide one: a crater with a
            // perfectly even rim is the tell that gives a single radial brush away.
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2 + rand() * 1.2;
                const d = 1.5 + rand() * 0.7;
                f.brush(
                    this.x + Math.cos(a) * d, this.z + Math.sin(a) * d,
                    0.5 + rand() * 0.35,
                    0, 0.20 + rand() * 0.14, 0.15, 0,
                    a, 1.4, 1.0
                );
            }
        }
        ctx.rig.addTrauma(0.28);
    }

    /** The instant of the burst: a hard ring of thrown snow and water. */
    _throw() {
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp) return;
        const n = (430 * ctx.sprayScale) | 0;
        const S = ctx.realm.spray;

        for (let k = 0; k < n; k++) {
            const a = rand() * Math.PI * 2;
            // Biased toward the RIM, because that is where the mass leaves.
            const r = 0.35 + Math.sqrt(rand()) * 1.25;
            const up = 5.5 + rand() * 8.5;
            const out = 1.6 + rand() * 5.0;
            // SAND raises the clod share: the blowout throws bleached-bronze
            // glass shards that tumble and catch the sun, not powder.
            const clod = rand() < 0.26 + S.clodBias ? 1 : 0;

            sp.emit(
                this.x + Math.cos(a) * r,
                this.y + 0.10 + rand() * 0.5,
                this.z + Math.sin(a) * r,
                Math.cos(a) * out,
                up * (clod ? 0.7 : 1.0),
                Math.sin(a) * out,
                (clod ? 0.028 + rand() * 0.038 : 0.075 + rand() * 0.115) * S.sizeMul,
                (clod ? 1.1 + rand() * 0.8 : 1.4 + rand() * 1.5) * S.lifeMul,
                clod,
                // BALLISTIC, or it never leaves the crater.
                (clod ? 0.65 : 1.1 + rand() * 0.8) * S.grainDragMul
            );
        }
    }

    /**
     * The fallout curtain.
     *
     * Fine, slow, high drag, and emitted ABOVE THE PLAYER'S EYE LINE over a wide
     * disc, so it drifts down through the frame rather than sitting in a cone over
     * the crater. This is the part of the spell that lasts, and it is where the
     * glinting has the best chance of being seen, since every grain of it is lit
     * by the crater light from below.
     */
    _curtain(dt) {
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp) return;

        const t = this.t;
        // Ramps in over 0.25..0.75 s and decays over 0.9..3.96 s.
        const k = smooth01((t - 0.25) / 0.5) * (1 - smooth01((t - 0.9) / (FALLOUT * 0.9)));
        if (k <= 0.01) return;

        const rate = 360 * ctx.sprayScale * k;
        this._curtainOwed += dt * rate;
        let count = this._curtainOwed | 0;
        if (count <= 0) return;
        this._curtainOwed -= count;
        if (count > 60) count = 60;

        const S = ctx.realm.spray;
        for (let i = 0; i < count; i++) {
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(rand()) * 3.6;   // uniform over a 3.6 m disc
            sp.emit(
                this.x + Math.cos(a) * r,
                this.y + 2.2 + rand() * 4.2,
                this.z + Math.sin(a) * r,
                (rand() - 0.5) * 0.9,
                0.2 + rand() * 1.1,
                (rand() - 0.5) * 0.9,
                (0.028 + rand() * 0.055) * S.sizeMul,
                (1.6 + rand() * 1.9) * S.lifeMul,
                0,
                // HIGH drag: this is meant to hang and settle, not to fly. 4.6
                // is already the highest drag in the project, and the SAND
                // blowout pushes it higher still (x1.25) — a desert blowout's
                // fallout hangs longer than a snow bloom's, which is the one
                // thing that separates the two silhouettes at a distance.
                4.6 * S.dustDragMul
            );
        }
    }

    _end() {
        this.active = false;
        if (this.strand >= 0) {
            this.ctx.water.release(this.strand);
            this.strand = -1;
        }
    }

    /** Every realm read here is live off `ctx.realm`; nothing to migrate. */
    setRealm() {}

    cancel() {
        this._end();
    }
}
