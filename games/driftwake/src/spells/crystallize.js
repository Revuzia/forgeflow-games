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
        // rather than added, so this is a saturating write. The realm scales it:
        // cold glazes to ice (1), sand sinters to desert glass (0.55), ash
        // leaves a cooled lava skin and no glaze at all (0).
        const R = this.ctx.realm;
        const f = this.ctx.deform;
        if (!f) return;
        f.brush(x, z, 1.55, 0.10, 0.16, 0.85, 1.0 * R.ice, rand() * Math.PI, 1.2, 0.85);
        for (let i = 0; i < 3; i++) {
            const a = rand() * Math.PI * 2;
            const d = 1.1 + rand() * 1.3;
            f.brush(
                x + Math.cos(a) * d, z + Math.sin(a) * d,
                0.55 + rand() * 0.5,
                0.04, 0.10, 0.5, 0.75 * R.ice, a, 1.5, 1.0
            );
        }

        if (R.spikeCrater) this._crater(x, z, f);

        // The detonation shell (vfx/burst.js) on the plant instant — the ice
        // snap in Cold, the SAND EXPLOSION's fireball-of-grit in Sand, the
        // columns' eruption in Ash. 2.6 m wraps the disc's 2.23 m full reach.
        if (this.ctx.fx) {
            this.ctx.fx.burst.spawn(
                x, y + 0.35, z, 2.6, 0.7, 0.7, R
            );
        }
    }

    /**
     * SAND EXPLOSION — the crater, and it is a real one.
     *
     * The owner asked specifically that this "show properly in collision/sand
     * leaving a mark". That mark is NOT a decal: it is written into the same
     * persistent depression/berm/compression field that already remembers the
     * player's footprints for about a minute, through the same `deform.brush`
     * the Bloom's crater and the Sweep's channel use. The terrain mesh is
     * displaced by it, the snow shader shades it, and the character walks in
     * it — which is the entire difference between a decal and a hole.
     *
     * The shape is depth PLUS AN OUTWARD BERM, because the mass has to go
     * somewhere: a central depression of 0.66 (deeper than the Bloom's 0.52 —
     * this is a detonation, not an eruption) with its own rim, then a broken
     * ring of berm-only brushes at 2.1-2.9 m that raises the lip without
     * cutting it. Broken rather than continuous for the reason the Bloom's
     * crater gives: a perfectly even rim is the tell that gives a single
     * radial brush away.
     *
     * The MECHANIC is untouched. The expanding disc, its 0.18 -> 2.23 m radii,
     * the 34 prisms, the 30 damage, the 1.5 s stun and the 60 poise are all
     * still exactly what `combatData.spikes` says, in every realm — this adds
     * ground displacement and a detonation of spray, and nothing else.
     * @param {number} x @param {number} z
     * @param {{brush:Function}} f
     */
    _crater(x, z, f) {
        f.brush(
            x, z,
            1.90,
            0.66,   // depression — deeper than the Bloom's 0.52
            0.52,   // its own rim
            0.88,   // blast-packed hardpan at the floor
            0,      // sand does not glaze; the ice channel stays out of this
            rand() * Math.PI,
            1.12,   // barely oval, so it is not a stamped circle
            1.0
        );
        // The outward berm: SEVEN brushes with zero depth, so they raise the
        // lip without re-cutting the floor they sit on.
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2 + rand() * 0.7;
            const d = 2.1 + rand() * 0.8;
            f.brush(
                x + Math.cos(a) * d, z + Math.sin(a) * d,
                0.62 + rand() * 0.4,
                0,                      // NO depth — this is thrown material
                0.34 + rand() * 0.18,   // ...landing as a berm
                0.20, 0,
                a, 1.45, 1.0
            );
        }

        // The detonation itself: one hard low ring of grit, thrown outward
        // rather than up, on the frame the disc starts expanding.
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp) return;
        const S = ctx.realm.spray;
        const n = (520 * ctx.sprayScale) | 0;
        for (let k = 0; k < n; k++) {
            const a = rand() * Math.PI * 2;
            const r = 0.3 + Math.sqrt(rand()) * 1.7;
            const out = 4.5 + rand() * 9.5;
            const clod = rand() < 0.3 + S.clodBias ? 1 : 0;
            sp.emit(
                x + Math.cos(a) * r,
                this.y + 0.08 + rand() * 0.4,
                z + Math.sin(a) * r,
                Math.cos(a) * out,
                2.2 + rand() * 5.5,          // LOW: a blast, not a fountain
                Math.sin(a) * out,
                (clod ? 0.026 + rand() * 0.034 : 0.055 + rand() * 0.09) * S.sizeMul,
                (0.9 + rand() * 1.3) * S.lifeMul,
                clod,
                (clod ? 0.7 : 1.5) * S.grainDragMul
            );
        }
        ctx.rig.addTrauma(0.30);
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
        //
        // In ASH the same light stops being a caustic trick and becomes the
        // cinder-orange still glowing in the joints between the basalt columns
        // — same call, same slot, different rgb and 1.45x the intensity.
        const R = ctx.realm;
        const L = R.light;
        const form = 1 - smooth01((this.t - PLANT_TIME) / 0.9);
        const ember = 0.10 + 0.06 * Math.sin(this.t * 1.7);
        const k = 0.35 + 12.0 * form;
        ctx.lights.add(
            this.x, this.y + 0.55, this.z, 7.5,
            0.52 * L.r, 0.80 * L.g, 1.0 * L.b,
            k * (1 + ember) * L.mult
        );

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
                0.05, 0.09, 0.4, 0.9 * ctx.realm.ice, ang, 1.2, 1.0
            );
        }
    }

    /** Frost thrown off as the ice breaks the surface. */
    _frost(dt) {
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp) return;
        const S = ctx.realm.spray;
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
                (0.012 + rand() * 0.020) * S.sizeMul,
                (0.7 + rand() * 0.9) * S.lifeMul,
                rand() < 0.4 + S.clodBias ? 1 : 0,
                2.4 * S.grainDragMul
            );
        }
    }

    /** Every realm read here is live off `ctx.realm`; nothing to migrate. */
    setRealm() {}

    /** Planted crystals are NOT retired — they age out on their own clock. */
    cancel() {
        this.active = false;
    }
}
