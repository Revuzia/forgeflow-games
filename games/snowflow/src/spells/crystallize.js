/**
 * Spell 4 — Crystallise.
 *
 * Water snaps to ice. A formation grows out of the drift at the aim point, and
 * the patch it grew from stays glazed long after the prisms have gone.
 *
 * Two mechanisms, and the split matters:
 *
 *   the formation   geometry, in `crystals.js`. It grows over about a second and
 *                   a half, stands for half a minute, and sublimates back into
 *                   the drift. This is the thing the player looks at.
 *   the glaze       the ice channel of the terrain state buffer, which decays on
 *                   a fifteen-minute constant. This is what satisfies
 *                   "permanently altering the surface": the snow shader answers
 *                   it with a roughness of 0.07 and a genuinely reflective
 *                   surface, so a Crystallise patch stays visible from across the
 *                   field as a slick of ice.
 *
 * This is the only spell that does not touch the water body.
 *
 * The prisms are planted along a short SPIRAL rather than in a disc. A random
 * scatter reads as scattered; a spiral with the crystals getting shorter as they
 * go out reads as something that grew from a centre, which is what it is.
 */

import { smooth01, rand } from "./bending.js";

/** Seconds the whole cast takes to finish planting. */
const PLANT_TIME = 0.85;
/** Crystals in one formation. */
const COUNT = 34;
/** Seconds the formation stands at full size before sublimating. */
const STAND = 34;

export class Crystallize {
    /** @param {import("./spellSystem.js").SpellContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.active = false;
        this.t = 0;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this._planted = 0;
        this._seed = 0;
    }

    /** @param {number} x @param {number} y @param {number} z ground target */
    trigger(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.t = 0;
        this._planted = 0;
        this._seed = rand() * 1000;
        this.active = true;

        // The glaze goes down IMMEDIATELY, under where the formation will be, so
        // the ground has already changed material by the time the first prism is
        // tall enough to see. Doing it as the crystals land instead leaves a beat
        // where ice is standing on ordinary snow.
        //
        // ice = 1.0 on the central brush, and the ice channel is taken as a MAX
        // rather than added, so this is a saturating write.
        const f = this.ctx.deform;
        if (!f) return;
        f.brush(x, z, 1.55, 0.10, 0.16, 0.85, 1.0, rand() * Math.PI, 1.2, 0.85);
        for (let i = 0; i < 3; i++) {
            const a = rand() * Math.PI * 2;
            const d = 1.1 + rand() * 1.3;
            f.brush(
                x + Math.cos(a) * d, z + Math.sin(a) * d,
                0.55 + rand() * 0.5,
                0.04, 0.10, 0.5, 0.75, a, 1.5, 1.0
            );
        }
    }

    /** @param {number} dt */
    update(dt) {
        if (!this.active) return;
        const ctx = this.ctx;
        this.t += dt;

        // ---- planting ------------------------------------------------------
        // Spread over most of a second rather than all at once, so the formation
        // grows OUTWARD from the centre instead of appearing on one frame.
        const want = Math.min(COUNT, Math.ceil((this.t / PLANT_TIME) * COUNT));
        while (this._planted < want) {
            this._plantOne(this._planted);
            this._planted++;
        }

        // ---- light ---------------------------------------------------------
        // Bright and tight while it is forming, then a low ember that lasts as
        // long as the spell does. Ice does not emit, but the snow around a cluster
        // of refracting prisms under a low sun genuinely does pick up caustic
        // light, and a small amount of it here is what stops the formation looking
        // like it was pasted on.
        const form = 1 - smooth01((this.t - PLANT_TIME) / 0.9);
        const ember = 0.10 + 0.06 * Math.sin(this.t * 1.7);
        const k = 0.35 + 12.0 * form;
        ctx.lights.add(this.x, this.y + 0.55, this.z, 7.5, 0.52, 0.80, 1.0, k * (1 + ember));

        // ---- frost spray ---------------------------------------------------
        if (this.t < PLANT_TIME + 0.4) this._frost(dt);

        // The SPELL is done once the last prism is in; the CRYSTALS age on their
        // own clock from there.
        if (this.t > PLANT_TIME + 1.6) this.active = false;
    }

    /**
     * One prism, on the spiral.
     *
     * The golden angle (2.39996323 rad, about 137.508 degrees) is doing real work:
     * it is the one rotation that never repeats a radial line, so no two crystals
     * in a formation line up with each other however many there are. Any rational
     * fraction of a turn gives visible spokes.
     */
    _plantOne(i) {
        const ctx = this.ctx;
        const n01 = i / (COUNT - 1);
        const ang = i * 2.39996323 + this._seed;
        const r = 0.18 + Math.sqrt(n01) * 2.05;      // sqrt -> uniform areal density

        const x = this.x + Math.cos(ang) * r + (rand() - 0.5) * 0.16;
        const z = this.z + Math.sin(ang) * r + (rand() - 0.5) * 0.16;
        const y = ctx.terrain.heightAt(x, z) - 0.06;  // base SUNK 6 cm into the drift

        // Tall in the middle, low at the edges, with enough scatter that the
        // envelope is not a readable cone. The centre crystals are chest height on
        // the character, deliberately — a knee-height cluster is something the
        // player walks past.
        const scale = (1 - n01 * 0.58) * (0.6 + rand() * 0.8);
        const height = 1.75 * scale;
        const radius = 0.15 * scale * (0.7 + rand() * 0.7);

        // Leaning OUTWARD, more so further out — the way a real cluster grows
        // toward the space it has. The y component of the axis is always 1; the
        // tilt lives entirely in ax/az.
        const tilt = 0.10 + n01 * 0.42 * (0.6 + rand() * 0.8);
        const ax = Math.cos(ang) * tilt + (rand() - 0.5) * 0.12;
        const az = Math.sin(ang) * tilt + (rand() - 0.5) * 0.12;

        ctx.crystals.plant(
            x, y, z, ax, 1, az,
            height, radius,
            0.45 + rand() * 0.55,
            STAND + rand() * 8              // 34..42 s
        );

        // A little snow pushed aside where each one broke the surface — every
        // OTHER crystal only.
        if ((i & 1) === 0 && ctx.deform) {
            ctx.deform.brush(
                x, z, radius * 3.2,
                0.05, 0.09, 0.4, 0.9, ang, 1.2, 1.0
            );
        }
    }

    /** Frost thrown off as the ice breaks the surface. */
    _frost(dt) {
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp) return;
        const count = ((60 * ctx.sprayScale) * dt) | 0;
        for (let k = 0; k < count; k++) {
            const a = rand() * Math.PI * 2;
            const r = rand() * 1.8;
            sp.emit(
                this.x + Math.cos(a) * r,
                this.y + 0.05 + rand() * 0.5,
                this.z + Math.sin(a) * r,
                Math.cos(a) * (0.6 + rand() * 1.4),
                0.9 + rand() * 2.4,
                Math.sin(a) * (0.6 + rand() * 1.4),
                0.012 + rand() * 0.020,
                0.7 + rand() * 0.9,
                rand() < 0.4 ? 1 : 0,
                2.4
            );
        }
    }

    /** Planted crystals are NOT retired — they age out on their own clock. */
    cancel() {
        this.active = false;
    }
}
